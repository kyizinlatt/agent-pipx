// CLAIMS: AGENTS.md describes the project — this checks that the description is still true.
//
// Instructions rot silently. A script gets renamed, a directory moves, the project switches
// package manager, and AGENTS.md keeps saying what used to be right. An agent reads it as fact
// and runs a command that no longer exists; nothing in the repo fails until then. Unlike the
// structural checks, these findings return as the project changes — that is the point.
//
// Every check needs BOTH sides to be explicit: a claim written in AGENTS.md and evidence on disk.
// No claim, or nothing to compare it against, means no finding.
import path from 'node:path';
import { detectLockfile, exists, isFile, readText } from '../detect.js';

// Commands that resolve to a package.json script rather than to a file on disk.
const JS_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
// Subcommands of those runners that are built in, not scripts.
const RUNNER_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'update', 'up', 'exec', 'dlx', 'x', 'create', 'init',
  'publish', 'pack', 'audit', 'outdated', 'link', 'why', 'list', 'ls', 'view', 'info', 'run-script',
]);
// Interpreters whose first non-flag argument is a path that must exist.
const FILE_RUNNERS = new Set(['node', 'python', 'python3', 'sh', 'bash', 'zsh', 'ruby', 'deno']);
// A code span we cannot resolve without running it.
const SHELL_META = /[|&;<>$(){}]|\s--?\w+=/;

export function checkClaims(repo, content, findings) {
  checkDocumentedCommands(repo, content, findings);
  checkPackageManagerClaim(repo, content, findings);
  checkDependencyClaim(repo, content, findings);
  checkBoundaryPaths(repo, content, findings);
}

/** Backtick commands under a Commands-like heading should resolve to a script, target, or file. */
function checkDocumentedCommands(repo, content, findings) {
  // Every matching section, not just the first: repos routinely have both a "## Commands" list
  // and something like "## Harness (hooks + commands)", and the real commands may be in either.
  const sections = extractSections(content, (h) => /\b(commands?|scripts?|tasks?)\b/i.test(h));
  if (!sections.length) return;
  const section = sections.join('\n');

  const pkg = readJson(path.join(repo, 'package.json'));
  const makefile = ['Makefile', 'makefile', 'GNUmakefile']
    .map((f) => path.join(repo, f))
    .find((f) => isFile(f));

  const unresolved = [];
  let checked = 0;
  for (const cmd of codeSpans(section)) {
    const verdict = resolveCommand(repo, cmd, pkg, makefile);
    if (verdict === 'skip') continue;
    checked++;
    if (verdict === 'missing') unresolved.push(cmd);
    if (unresolved.length >= 8) break;
  }
  if (unresolved.length) {
    findings.warn(
      'Rules',
      `AGENTS.md documents command(s) that do not resolve: ${unresolved.map((c) => `\`${c}\``).join(', ')} — an agent will run these verbatim`,
      'AGENTS.md',
      'APX-RUL-018',
    );
  } else if (checked > 0) {
    findings.pass('Rules', `AGENTS.md commands resolve (${checked} checked)`, 'AGENTS.md');
  }
}

/** @returns {'ok'|'missing'|'skip'} */
function resolveCommand(repo, raw, pkg, makefile) {
  const cmd = raw.trim().replace(/^\$\s+/, '');
  if (!cmd || SHELL_META.test(cmd)) return 'skip';
  const tokens = cmd.split(/\s+/);
  const [head, ...rest] = tokens;

  if (JS_RUNNERS.has(head)) {
    if (!pkg) return 'skip';
    let script = rest[0];
    if (script === 'run' || script === 'run-script') script = rest[1];
    if (!script || script.startsWith('-') || RUNNER_BUILTINS.has(script)) return 'skip';
    const scripts = pkg.scripts || {};
    return scripts[script] ? 'ok' : 'missing';
  }

  if (head === 'make') {
    if (!makefile) return 'skip';
    const target = rest.find((t) => !t.startsWith('-'));
    if (!target) return 'skip';
    const text = readText(makefile);
    return new RegExp(`^\\.?${escapeRe(target)}\\s*:`, 'm').test(text) ? 'ok' : 'missing';
  }

  if (FILE_RUNNERS.has(head)) {
    const file = rest.find((t) => !t.startsWith('-'));
    // `node --test` and friends have no script argument to verify.
    if (!file || !looksLikePath(file)) return 'skip';
    return exists(path.join(repo, file)) ? 'ok' : 'missing';
  }

  if (head.startsWith('./') || head.startsWith('scripts/')) {
    return exists(path.join(repo, head)) ? 'ok' : 'missing';
  }

  // cargo, go, pytest, swift, docker… — real commands we cannot resolve without running them.
  return 'skip';
}

/** "Package manager: pnpm" while the repo carries a different lockfile. */
function checkPackageManagerClaim(repo, content, findings) {
  const m = content.match(/package[\s-]?manager\b[^\n]{0,20}?\b(npm|pnpm|yarn|bun)\b/i);
  if (!m) return;
  const claimed = m[1].toLowerCase();
  const lock = detectLockfile(repo);
  if (!lock || lock.manager === claimed) return;
  findings.warn(
    'Rules',
    `AGENTS.md says the package manager is ${claimed}, but the repo has ${lock.file} (${lock.manager})`,
    'AGENTS.md',
    'APX-RUL-019',
  );
}

/** A "zero dependencies" rule that package.json contradicts. */
function checkDependencyClaim(repo, content, findings) {
  // Both orders show up in practice: "zero runtime dependencies" and "dependencies at zero".
  const claims =
    /\b(zero|no)\b[^.\n]{0,24}\bruntime\s+dependenc/i.test(content) ||
    /\bzero\s+dependenc/i.test(content) ||
    /\bdependenc\w*\b[^.\n]{0,24}\bzero\b/i.test(content) ||
    /\bdependency[-\s]free\b/i.test(content);
  if (!claims) return;
  const pkg = readJson(path.join(repo, 'package.json'));
  if (!pkg) return;
  const deps = Object.keys(pkg.dependencies || {});
  if (deps.length === 0) return;
  findings.warn(
    'Rules',
    `AGENTS.md claims no runtime dependencies but package.json declares ${deps.length} (${deps.slice(0, 3).join(', ')}${deps.length > 3 ? ', …' : ''})`,
    'AGENTS.md',
    'APX-RUL-020',
  );
}

/** A do-not-touch boundary naming a path that no longer exists protects nothing. */
function checkBoundaryPaths(repo, content, findings) {
  const sections = extractSections(content, (h) => /boundar|do[\s-]?not[\s-]?touch|off[\s-]?limits|out[\s-]?of[\s-]?scope/i.test(h));
  if (!sections.length) return;
  const section = sections.join('\n');
  const missing = [];
  for (const rel of extractRepoPathsLocal(section)) {
    if (exists(path.join(repo, rel)) || exists(path.join(repo, rel.replace(/\/$/, '')))) continue;
    missing.push(rel);
    if (missing.length >= 8) break;
  }
  if (missing.length) {
    findings.warn(
      'Rules',
      `AGENTS.md boundary path(s) do not exist: ${missing.join(', ')} — the rule guards nothing, or the path moved`,
      'AGENTS.md',
      'APX-RUL-021',
    );
  }
}

/** Bodies of every heading whose title matches. */
export function extractSections(content, matches) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(\S.*)$/);
    if (!m || !matches(m[2])) continue;
    const level = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].match(/^(#{1,6})\s+/);
      if (next && next[1].length <= level) break;
      body.push(lines[j]);
    }
    out.push(body.join('\n'));
  }
  return out;
}

/** Body of the first heading whose title matches, or null. Shared shape with the layout check. */
export function extractSection(content, matches) {
  const [first] = extractSections(content, matches);
  return first === undefined ? null : first;
}

/** Backtick spans that read as commands (contain a space or a known runner). */
function codeSpans(text) {
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    if (!span || seen.has(span)) continue;
    seen.add(span);
    out.push(span);
  }
  return out;
}

function looksLikePath(token) {
  return token.includes('/') || /\.[a-z0-9]{1,8}$/i.test(token);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJson(file) {
  const text = readText(file);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Local copy of the path filter used for layout paths, minus the "must be a known top-level dir"
// shortcut: a boundary often names a directory this repo deliberately does not have yet.
function extractRepoPathsLocal(text) {
  const out = [];
  for (const span of codeSpans(text)) {
    if (/\s/.test(span) || /^[=~$@!]/.test(span)) continue;
    if (span.includes('://') || span.startsWith('/')) continue;
    if (/[*?…]|\.\.\./.test(span) || span.startsWith('[') || span.includes('{{')) continue;
    const p = span.replace(/^\.\//, '');
    if (!p.includes('/') && !/\.[a-z0-9]{1,8}$/i.test(p)) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}
