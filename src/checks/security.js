// SECURITY posture of the agent surface: how MCP servers are launched and authenticated, and
// whether the permission system is still doing its job.
//
// This is the part of a repo's agent config that nobody reads twice: an MCP entry is pasted from
// a README, a permission rule is widened once to unblock a session, and both are committed. The
// checks below are deliberately conservative — every one of them has a concrete escape hatch that
// a legitimate setup uses (an ${ENV} reference, a pinned version, localhost) so the honest case
// stays quiet.
//
// Values are never reported, only key names and paths (AGENTS.md: keep output free of contents).
import path from 'node:path';
import { mcpConfigFiles } from '../../adapters/tools.js';
import { isFile, readText } from '../detect.js';

// Runners that resolve a package at launch time; without a version they fetch whatever is newest.
const PACKAGE_RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'uvx', 'dlx']);
const RUNNER_FLAGS = /^-/;

const SECRETISH_KEY = /(token|secret|password|passwd|api[_-]?key|_key|credential|auth)/i;
// A value that is plainly not a live credential: an env reference, a path, or a placeholder.
const NOT_A_SECRET = /^(\$\{?\w|~\/|\.{0,2}\/|<|\{\{|x{3,}$|changeme|your[-_ ]|replace[-_ ]|todo|example|placeholder|none|null|true|false|\d+$)/i;

/** MCP servers: how they are launched, where they connect, and what they carry. */
export function checkMcpSecurity(repo, findings) {
  const files = mcpConfigFiles()
    .map((rel) => [rel, path.join(repo, rel)])
    .filter(([, abs]) => isFile(abs));
  if (!files.length) return;

  let servers = 0;
  for (const [rel, abs] of files) {
    let parsed;
    try {
      parsed = JSON.parse(readText(abs));
    } catch {
      findings.warn('Config', `${rel} is not valid JSON`, rel, 'APX-CFG-010');
      continue;
    }
    const defs = parsed.mcpServers || parsed.servers || {};
    for (const [name, def] of Object.entries(defs)) {
      if (!def || typeof def !== 'object') continue;
      servers++;
      auditServer(rel, name, def, findings);
    }
  }
  if (servers > 0) {
    findings.pass('Config', `${servers} MCP server(s) configured — review each tool's scope, prefer read-only`);
  }
}

function auditServer(rel, name, def, findings) {
  const spec = unpinnedSpec(def);
  if (spec) {
    findings.warn(
      'Config',
      `MCP server "${name}" runs ${spec} unpinned — every session fetches the latest publish; pin a version`,
      rel,
      'APX-CFG-030',
    );
  }

  const url = typeof def.url === 'string' ? def.url : '';
  if (/^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url)) {
    findings.warn(
      'Config',
      `MCP server "${name}" connects over plain http — tool traffic and any token travel unencrypted`,
      rel,
      'APX-CFG-031',
    );
  }

  for (const [source, bag] of [['env', def.env], ['headers', def.headers]]) {
    for (const key of literalSecretKeys(bag)) {
      findings.warn(
        'Secrets',
        `MCP server "${name}" has a literal value in ${source}.${key} — reference the environment (\${${key}}) instead of committing it`,
        rel,
        'APX-SEC-002',
      );
    }
  }
}

/** @returns {string|null} the package spec a runner would resolve fresh on every launch */
function unpinnedSpec(def) {
  const cmd = typeof def.command === 'string' ? path.basename(def.command) : '';
  if (!PACKAGE_RUNNERS.has(cmd)) return null;
  const args = Array.isArray(def.args) ? def.args : [];
  const pkg = args.find((a) => typeof a === 'string' && !RUNNER_FLAGS.test(a));
  if (!pkg) return null;
  // A scoped name starts with @, so look for a version separator after that first character.
  const versioned = pkg.lastIndexOf('@') > 0;
  return versioned ? null : pkg;
}

/** Key names (never values) whose content looks like a committed credential. */
function literalSecretKeys(bag) {
  if (!bag || typeof bag !== 'object') return [];
  return Object.entries(bag)
    .filter(([k, v]) => typeof v === 'string' && SECRETISH_KEY.test(k))
    .filter(([, v]) => v.trim().length >= 12 && !NOT_A_SECRET.test(v.trim()))
    // "Bearer ${TOKEN}" is an env reference with a prefix, not a literal.
    .filter(([, v]) => !/\$\{?\w/.test(v))
    .map(([k]) => k);
}

/**
 * The permission system only protects a repo while it still asks. These are the three ways it
 * gets switched off in practice: the default mode, an unbounded rule, and the escape-hatch flag.
 */
export function checkPermissions(repo, settings, hookCmds, tool, findings) {
  const model = tool && tool.permissions;
  if (!model) return;
  const rel = tool.settings;
  const perms = settings.permissions || {};

  if (perms.defaultMode === model.bypassMode) {
    findings.warn(
      'Config',
      `permissions.defaultMode is ${model.bypassMode} — every tool call runs unprompted for anyone who opens this repo`,
      rel,
      'APX-CFG-032',
    );
  }

  const unbounded = (Array.isArray(perms.allow) ? perms.allow : []).filter((r) => isUnboundedShell(r, model.shellTool));
  for (const rule of unbounded) {
    findings.warn(
      'Config',
      `permission rule ${rule} allows any shell command — scope it (e.g. ${model.shellTool}(npm run test:*))`,
      rel,
      'APX-CFG-033',
    );
  }

  for (const cmd of hookCmds) {
    if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?\S*\b(ba|z|k|fi)?sh\b/.test(cmd)) {
      findings.warn(
        'Config',
        'a hook pipes downloaded content straight into a shell — whatever that URL serves runs with your permissions',
        rel,
        'APX-CFG-035',
      );
    }
  }
}

/** `Bash`, `Bash(*)`, `Bash(:*)` — anything that matches every command. */
function isUnboundedShell(rule, shellTool) {
  if (typeof rule !== 'string') return false;
  const trimmed = rule.trim();
  if (trimmed === shellTool) return true;
  const m = trimmed.match(new RegExp(`^${shellTool}\\((.*)\\)$`));
  return Boolean(m) && /^[:*\s]*$/.test(m[1]);
}

/**
 * The flag that turns the whole permission system off. In a session it is the user's call; in a
 * committed file it is a decision made for everyone who clones the repo.
 * @param {string[]} candidates repo-relative files to scan
 */
export function checkSkipFlag(repo, candidates, skipFlag, findings) {
  for (const rel of candidates) {
    const abs = path.join(repo, rel);
    if (!isFile(abs)) continue;
    if (readText(abs).includes(skipFlag)) {
      findings.warn(
        'Config',
        `${rel} commits ${skipFlag} — it disables every permission prompt for anyone who runs it`,
        rel,
        'APX-CFG-034',
      );
    }
  }
}
