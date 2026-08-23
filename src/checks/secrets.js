// SECRETS check: catch credentials accidentally committed into agent config/instruction files.
// These files are meant to be shared/committed, so a live secret here is a real leak.
//
// High-confidence, low-false-positive patterns only (mirrors the harness guard-secrets hook).
// It reports the SECRET TYPE and line — never the secret value itself.
import fs from 'node:fs';
import path from 'node:path';
import { isDir, isInsideRepo, isRegularFile, isSymlink, walk } from '../detect.js';
import { mcpConfigFiles } from '../../adapters/tools.js';

const PATTERNS = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, 'private key block'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{40,}/, 'GitHub fine-grained PAT'],
  [/xox[baprs]-[A-Za-z0-9-]{12,}/, 'Slack token'],
  [/sk-(ant-)?[A-Za-z0-9_-]{24,}/, 'AI provider API key (sk-)'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
];

// Config/instruction files that are committed and should never contain secrets.
const TARGET_FILES = [
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CLAUDE.local.md',
  '.github/copilot-instructions.md',
  // MCP paths come from the adapter table so this scan and the config audit cannot disagree.
  ...mcpConfigFiles(),
];
const TARGET_DIRS = ['.claude', '.cursor/rules', '.agents/rules', '.windsurf/rules'];

export function checkSecrets(repo, findings) {
  const seen = new Set();
  const files = [];
  for (const rel of TARGET_FILES) {
    const abs = path.join(repo, rel);
    // Regular files only — do not follow symlinks out of the repo (CWE-59).
    if (isRegularFile(abs) && isInsideRepo(repo, abs)) files.push(abs);
  }
  for (const rel of TARGET_DIRS) {
    const abs = path.join(repo, rel);
    // Skip symlink roots (stat follows; a .claude → ~/.ssh would otherwise be walked).
    if (!isDir(abs) || isSymlink(abs) || !isInsideRepo(repo, abs)) continue;
    for (const f of walk(abs, { exts: ['.md', '.mdc', '.json', '.txt', '.yaml', '.yml'] })) {
      if (isInsideRepo(repo, f)) files.push(f);
    }
  }

  let clean = true;
  for (const abs of files) {
    if (seen.has(abs)) continue;
    seen.add(abs);
    const rel = path.relative(repo, abs);
    const lines = safeRead(abs).split('\n');
    lines.forEach((line, i) => {
      for (const [re, label] of PATTERNS) {
        if (re.test(line)) {
          findings.fail('Secrets', `possible ${label} committed in ${rel}:${i + 1} — rotate it and remove from the file`, rel, 'APX-SEC-001');
          clean = false;
        }
      }
    });
  }

  if (clean && files.length) findings.pass('Secrets', `no credentials found in ${files.length} config file(s)`);
}

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
