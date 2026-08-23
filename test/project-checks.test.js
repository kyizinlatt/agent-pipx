// AGENTS.md completeness, MCP awareness, and CI/pre-commit quality-gate checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../src/cli.js';
import { FAIL, WARN } from '../src/findings.js';

function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-proj-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}
const has = (f, sev, re) => f.items.some((x) => x.severity === sev && re.test(x.message));

const FULL_AGENTS = [
  '# Project', '',
  '## Commands', '- Test: `npm test`', '- Build: `npm run build`', '',
  '## Repository layout', '- `src/` owns the app; `test/` owns tests', '',
  '## Boundaries (do not touch)', '- generated/ is off limits', '',
  '## Sensitive data', '- never commit secrets or tokens', '',
].join('\n');

test('completeness: minimal AGENTS.md → warns about missing sections', () => {
  const repo = mkrepo({ 'AGENTS.md': '# P\n\nSome prose but no command, boundary, or secret guidance here at all.\n' });
  const f = runChecks(repo);
  assert.ok(has(f, WARN, /missing recommended section/), JSON.stringify(f.items.filter((i) => i.category === 'Rules'), null, 2));
  assert.ok(has(f, WARN, /Repository layout/), 'structure signal required');
});

test('completeness: full AGENTS.md → no missing-section warning', () => {
  const repo = mkrepo({ 'AGENTS.md': FULL_AGENTS });
  const f = runChecks(repo);
  assert.ok(!has(f, WARN, /missing recommended section/), 'no false positive when sections present');
});

test('completeness: missing only layout → warns for structure', () => {
  const md = [
    '# Project', '',
    '## Commands', '- Test: `npm test`', '',
    '## Boundaries (do not touch)', '- generated/', '',
    '## Sensitive data', '- never commit secrets', '',
  ].join('\n');
  const repo = mkrepo({ 'AGENTS.md': md });
  const f = runChecks(repo);
  assert.ok(has(f, WARN, /Repository layout \/ project structure/));
});

test('layout paths: missing on disk → warn', () => {
  const md = [
    '# Project', '',
    '## Commands', '- Test: `npm test`', '',
    '## Repository layout', '- `src/` owns the app', '- `does-not-exist-xyz/` is imaginary', '',
    '## Boundaries (do not touch)', '- generated/', '',
    '## Sensitive data', '- never commit secrets', '',
  ].join('\n');
  const repo = mkrepo({ 'AGENTS.md': md, 'src/.keep': '' });
  const f = runChecks(repo);
  assert.ok(has(f, WARN, /layout paths not found.*does-not-exist-xyz/), JSON.stringify(f.items.filter((i) => /layout/i.test(i.message)), null, 2));
});

test('layout paths: all resolve → pass', () => {
  const md = [
    '# Project', '',
    '## Commands', '- Test: `npm test`', '',
    '## Repository layout', '- `src/` owns the app', '- `bin/run.js` is the entry', '',
    '## Boundaries (do not touch)', '- generated/', '',
    '## Sensitive data', '- never commit secrets', '',
  ].join('\n');
  const repo = mkrepo({ 'AGENTS.md': md, 'src/.keep': '', 'bin/run.js': '#!/usr/bin/env node\n' });
  const f = runChecks(repo);
  assert.ok(has(f, 'pass', /layout paths resolve on disk/));
  assert.ok(!has(f, WARN, /layout paths not found/));
});

test('MCP: configured servers surface a review line', () => {
  const repo = mkrepo({
    'AGENTS.md': FULL_AGENTS,
    '.mcp.json': JSON.stringify({ mcpServers: { fs: { command: 'x' }, db: { command: 'y' } } }),
  });
  const f = runChecks(repo);
  assert.ok(has(f, 'pass', /2 MCP server\(s\) configured/), 'server count surfaced');
});

test('MCP: a token inside .mcp.json is caught by the secret scan', () => {
  const fake = 'ghp_' + 'B'.repeat(36);
  const repo = mkrepo({
    'AGENTS.md': FULL_AGENTS,
    '.mcp.json': JSON.stringify({ mcpServers: { api: { env: { TOKEN: fake } } } }),
  });
  const f = runChecks(repo);
  assert.ok(has(f, FAIL, /GitHub token committed in \.mcp\.json/), 'secret in mcp.json flagged');
});

test('quality gate: git repo with no CI/pre-commit → warns', () => {
  const repo = mkrepo({ 'AGENTS.md': FULL_AGENTS, '.git/config': '[core]\n' });
  const f = runChecks(repo);
  assert.ok(has(f, WARN, /no CI workflow or pre-commit/), 'missing gate warned');
});

test('quality gate: git repo with a CI workflow → passes', () => {
  const repo = mkrepo({ 'AGENTS.md': FULL_AGENTS, '.git/config': '[core]\n', '.github/workflows/ci.yml': 'name: CI\n' });
  const f = runChecks(repo);
  assert.ok(has(f, 'pass', /automated quality gate present/), 'gate detected');
  assert.ok(!has(f, WARN, /no CI workflow/), 'no false warning');
});

test('quality gate: linked worktree/submodule (.git is a file) is still a repo', () => {
  const repo = mkrepo({ 'AGENTS.md': FULL_AGENTS, '.git': 'gitdir: /elsewhere/.git/worktrees/wt\n' });
  const f = runChecks(repo);
  assert.ok(has(f, WARN, /no CI workflow or pre-commit/), 'gate must be evaluated, not skipped');
});
