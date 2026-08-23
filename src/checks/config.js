// CONFIG checks: per-tool adapters bridge to the AGENTS.md SSOT, and (for Claude Code) the
// .claude/settings.json + hooks are valid and live. Ports the logic from the original
// check-config.sh and adds multi-tool SSOT/drift verification.
import fs from 'node:fs';
import path from 'node:path';
import {
  detectAdapters, exists, isDir, isDangling, isFile, isInsideRepo, isSymlink, readlink, readText, walk,
} from '../detect.js';
import { agentsMdPath, verifyBridge } from '../ssot.js';
import { checkExtensions } from './extensions.js';

const CORE_HOOKS = ['guard-secrets.sh', 'guard-push.sh', 'guard-env.sh', 'check-hygiene.sh'];

export function checkConfig(repo, findings) {
  const agents = agentsMdPath(repo);

  // 1. Per-tool adapter → SSOT bridge verification.
  // Adapters are tool-specific files only (not AGENTS.md) — see adapters/tools.js.
  const adapters = detectAdapters(repo);
  if (!agents && adapters.length === 0) {
    findings.warn('Config', 'no agent-tool configuration detected (CLAUDE.md, AGENTS.md, .cursor/rules, …)', null, 'APX-CFG-001');
  }
  for (const entry of adapters) verifyBridge(repo, entry, agents, findings);

  // SSOT presence: native tools need nothing else; bridge tools are checked above if present.
  if (agents) {
    const configured = adapters.map((e) => e.tool.name);
    if (configured.length) {
      findings.pass(
        'Config',
        `AGENTS.md present — native tools read it directly; tool adapters found: ${configured.join(', ')}`,
      );
    } else {
      findings.pass('Config', 'AGENTS.md present — native tools read it directly (no tool-specific adapters)');
    }
  }

  // 2. Claude Code settings + hooks (only when a .claude/ dir exists inside the repo).
  const claudeDir = path.join(repo, '.claude');
  if (isDir(claudeDir)) {
    // Do not follow a .claude → outside symlink (CWE-59); secrets check already skips these.
    if (isSymlink(claudeDir) || !isInsideRepo(repo, claudeDir)) {
      findings.warn(
        'Config',
        '.claude/ is a symlink outside the repo — skipping Claude settings checks (CWE-59)',
        '.claude',
      'APX-CFG-009');
    } else {
      checkClaudeDir(repo, claudeDir, findings);
    }
  }

  // 3. MCP servers — surface how many are wired so their tool scope gets reviewed.
  checkMcp(repo, findings);

  // 4. Skills / commands structure + local-settings gitignore + soft layering.
  checkExtensions(repo, findings);
}

function checkMcp(repo, findings) {
  const files = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json']
    .map((f) => path.join(repo, f))
    .filter(isFile);
  if (!files.length) return;
  let servers = 0;
  for (const f of files) {
    try {
      const j = JSON.parse(readText(f));
      servers += Object.keys(j.mcpServers || j.servers || {}).length;
    } catch {
      findings.warn('Config', `${path.relative(repo, f)} is not valid JSON`, path.relative(repo, f), 'APX-CFG-010');
    }
  }
  if (servers > 0) {
    findings.pass('Config', `${servers} MCP server(s) configured — review each tool's scope, prefer read-only`);
  }
}

function checkClaudeDir(repo, claudeDir, findings) {
  // Dangling symlinks anywhere under .claude/ = a broken link-mode install.
  let dangling = 0;
  for (const f of walk(claudeDir).concat(listSymlinkDirs(claudeDir))) {
    if (isDangling(f)) {
      findings.fail('Config', `dangling symlink: ${path.relative(repo, f)} → ${readlink(f)}`, path.relative(repo, f), 'APX-CFG-011');
      dangling++;
    }
  }
  if (dangling === 0) findings.pass('Config', '.claude/ symlinks resolve (or none present)');

  const settingsPath = path.join(claudeDir, 'settings.json');
  if (!exists(settingsPath)) {
    findings.warn('Config', '.claude/ exists but settings.json is missing', null, 'APX-CFG-012');
    return;
  }

  let settings;
  try {
    settings = JSON.parse(readText(settingsPath));
  } catch {
    findings.fail('Config', 'settings.json is not valid JSON', '.claude/settings.json', 'APX-CFG-013');
    return;
  }
  findings.pass('Config', 'settings.json is valid JSON');

  // Every hook command that points into the repo must exist and be executable.
  const hookCmds = collectHookCommands(settings);
  for (const cmd of hookCmds) {
    let script = cmd.split(/\s+/)[0]
      .replaceAll('${CLAUDE_PROJECT_DIR}', repo)
      .replaceAll('$CLAUDE_PROJECT_DIR', repo);
    if (!script.startsWith(repo + path.sep) && !script.startsWith(repo + '/')) continue;
    const rel = path.relative(repo, script);
    if (!exists(script)) {
      findings.fail('Config', `hook script missing: ${rel}`, rel, 'APX-CFG-014');
    } else if (!isExecutable(script)) {
      findings.fail('Config', `hook script not executable: ${rel}`, rel, 'APX-CFG-015');
    } else {
      findings.pass('Config', `hook wired: ${rel}`);
    }
  }

  // Baseline: a harness-linked repo should wire the core guards. Only assert when the repo
  // clearly uses the harness (a manifest, or a known harness hook is wired).
  const wiredText = hookCmds.join('\n');
  const looksLikeHarness =
    exists(path.join(claudeDir, '.harness-manifest')) ||
    /guard-push\.sh|guard-write\.sh|check-forbidden\.sh|check-swift\.sh/.test(wiredText);
  if (looksLikeHarness) {
    for (const hook of CORE_HOOKS) {
      if (!wiredText.includes(hook)) {
        findings.warn('Config', `core hook ${hook} not wired (harness baseline) — repo may predate it; re-run install-harness.sh`, null, 'APX-CFG-016');
      }
    }
  }
}

function collectHookCommands(settings) {
  const out = [];
  const hooks = settings.hooks || {};
  for (const event of Object.values(hooks)) {
    if (!Array.isArray(event)) continue;
    for (const matcher of event) {
      for (const h of matcher.hooks || []) {
        if (h.type === 'command' && h.command) out.push(h.command);
      }
    }
  }
  return out;
}

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// walk() only returns regular files; symlinked directories won't be traversed, but a symlink to
// a dir is itself worth dangling-checking. Collect top-level symlink entries under .claude/.
function listSymlinkDirs(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isSymbolicLink()) out.push(full);
      else if (e.isDirectory()) stack.push(full);
    }
  }
  return out;
}
