// Tests for secret scanning, --strict, SARIF output, expanded tool coverage, and `fix`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks, run } from '../src/cli.js';
import { renderSarif } from '../src/report.js';
import { doFix } from '../src/fix.js';
import { FAIL } from '../src/findings.js';

function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-feat-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}
const AGENTS = '# rules\n\nreal content long enough to pass the emptiness check here.\n';
const has = (f, sev, re) => f.items.some((x) => x.severity === sev && re.test(x.message));

test('secret scanning: a token committed in AGENTS.md → Secrets failure', () => {
  // Fake, pattern-shaped token — not a real credential.
  const fake = 'ghp_' + 'A'.repeat(36);
  const repo = mkrepo({ 'AGENTS.md': `${AGENTS}\ntoken: ${fake}\n` });
  const f = runChecks(repo);
  assert.ok(has(f, FAIL, /GitHub token committed/), JSON.stringify(f.items, null, 2));
});

test('secret scanning: clean config → Secrets pass, no false positive', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS });
  const f = runChecks(repo);
  assert.ok(has(f, 'pass', /no credentials found/));
  assert.equal(f.count(FAIL), 0);
});

test('--strict: a warning becomes a failure (exit 2)', async () => {
  // package.json with deps but no lockfile → an Environment warning.
  const repo = mkrepo({
    'AGENTS.md': AGENTS,
    'package.json': '{"name":"x","dependencies":{"left-pad":"1.0.0"}}\n',
  });
  const normal = await run(['check', '--path', repo]);
  const strict = await run(['check', '--strict', '--path', repo]);
  assert.equal(normal, 1, 'warnings → exit 1 normally');
  assert.equal(strict, 2, 'warnings → exit 2 under --strict');
});

test('SARIF: valid 2.1.0 shape, passes omitted, warn/fail mapped', () => {
  const repo = mkrepo({
    'AGENTS.md': AGENTS,
    'package.json': '{"name":"x","dependencies":{"left-pad":"1.0.0"}}\n',
  });
  const f = runChecks(repo);
  const sarif = JSON.parse(renderSarif(f, repo));
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].tool.driver.name, 'agent-pipx');
  assert.ok(sarif.runs[0].results.every((r) => ['error', 'warning'].includes(r.level)), 'only error/warning levels');
});

test('AGENTS.md alone: native SSOT pass, does not list every tool', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS });
  const f = runChecks(repo);
  assert.ok(has(f, 'pass', /AGENTS\.md present — native tools read it directly/), 'SSOT pass');
  assert.ok(!has(f, 'pass', /read natively by:.*Cursor/), 'does not enumerate unused tools');
  assert.ok(!has(f, 'pass', /tool adapters found/), 'no adapters claimed');
});

test('expanded coverage: Windsurf adapter detected when .windsurfrules present', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS, '.windsurfrules': 'x\n' });
  const f = runChecks(repo);
  assert.ok(has(f, 'pass', /tool adapters found:.*Windsurf/), 'windsurf listed among configured adapters');
});

test('zero-dep package.json: no lockfile warning', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS, 'package.json': '{"name":"x"}\n' });
  const f = runChecks(repo);
  assert.ok(has(f, 'pass', /no dependencies to pin/), 'zero-dep is fine without lockfile');
  assert.ok(!has(f, 'warn', /no lockfile/), 'no false lockfile warning');
});

test('styles: checker source does not self-match any / @ts-ignore patterns', () => {
  const repo = mkrepo({
    'AGENTS.md': AGENTS,
    'package.json': '{"name":"x"}\n',
    // Mimic the checker’s constructed regex style — must not count as real `any` / @ts-ignore.
    'src/scan.js':
      "const RE_ANY = new RegExp([':\\\\s*any\\\\b', '<' + 'any>', 'as ' + 'any\\\\b'].join('|'));\n" +
      "const RE_TS = new RegExp('@ts-' + '(ignore|nocheck)');\n",
  });
  const f = runChecks(repo);
  assert.ok(!has(f, 'warn', /use\(s\) of `any`/), 'no any false positive from pattern builders');
  assert.ok(!has(f, 'warn', /@ts-ignore/), 'no @ts-ignore false positive from pattern builders');
});

test('styles: real any / console still flagged', () => {
  const repo = mkrepo({
    'AGENTS.md': AGENTS,
    'package.json': '{"name":"x"}\n',
    'src/app.ts': 'export const x: any = 1;\nconsole.log(x);\n// @ts-ignore\n',
  });
  const f = runChecks(repo);
  assert.ok(has(f, 'warn', /1 use\(s\) of `any`/), 'real any counted');
  assert.ok(has(f, 'warn', /1 console\.log/), 'real console counted');
  assert.ok(has(f, 'warn', /1 @ts-ignore/), 'real @ts-ignore counted');
});

test('report: CLI UI, no JSON dump', async () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS });
  let out = '';
  const orig = console.log;
  console.log = (s) => {
    out += String(s) + '\n';
  };
  try {
    await run(['report', '--path', repo]);
  } finally {
    console.log = orig;
  }
  assert.match(out, /agent-pipx report/);
  assert.match(out, /\bFix\b/);
  assert.match(out, /Judgement/);
  assert.match(out, /Agent prompt/);
  assert.match(out, /Status/);
  assert.doesNotMatch(out, /```json/);
  assert.doesNotMatch(out, /"summary"\s*:/);
});

test('fix: dry-run does not modify; --yes rewrites @~/ and backs up', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS, 'GEMINI.md': '@~/somewhere/AGENTS.md\n' });
  const gem = path.join(repo, 'GEMINI.md');

  doFix(repo, { apply: false });
  assert.equal(fs.readFileSync(gem, 'utf8'), '@~/somewhere/AGENTS.md\n', 'dry-run must not modify');
  assert.ok(!fs.existsSync(gem + '.bak'), 'dry-run must not create a backup');

  doFix(repo, { apply: true });
  assert.equal(fs.readFileSync(gem, 'utf8'), '@./AGENTS.md\n', 'apply rewrites the import');
  assert.equal(fs.readFileSync(gem + '.bak', 'utf8'), '@~/somewhere/AGENTS.md\n', 'original backed up');

  const f = runChecks(repo);
  assert.equal(f.count(FAIL), 0, 'no failures after fix');
});

test('fix: refuses to write through GEMINI.md symlink (CWE-59)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-fix-sym-'));
  const outside = path.join(root, 'OUTSIDE.txt');
  fs.writeFileSync(outside, '@~/evil/AGENTS.md\nkeep-me\n');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), AGENTS);
  fs.symlinkSync(outside, path.join(repo, 'GEMINI.md'));

  doFix(repo, { apply: true });

  assert.equal(fs.readFileSync(outside, 'utf8'), '@~/evil/AGENTS.md\nkeep-me\n', 'outside target must be untouched');
  assert.ok(!fs.existsSync(path.join(repo, 'GEMINI.md.bak')), 'must not copy outside contents into .bak');
});

test('secret scanning: skips symlinked AGENTS.md (no out-of-repo read)', () => {
  // Pattern-shaped fake token — deliberate fixture, not a live credential.
  const fake = 'ghp_' + 'B'.repeat(36);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-sec-sym-'));
  const outside = path.join(root, 'leaked.env');
  fs.writeFileSync(outside, `token: ${fake}\n`);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  fs.symlinkSync(outside, path.join(repo, 'AGENTS.md'));

  const f = runChecks(repo);
  assert.ok(!has(f, FAIL, /GitHub token/), 'must not follow symlink to outside secrets');
});

test('secret scanning: skips symlinked .claude dir (no out-of-repo read)', () => {
  const fake = 'ghp_' + 'C'.repeat(36);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-sec-dirsym-'));
  const outsideDir = path.join(root, 'outside-claude');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'secrets.md'), `token: ${fake}\n`);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), AGENTS);
  fs.symlinkSync(outsideDir, path.join(repo, '.claude'));

  const f = runChecks(repo);
  assert.ok(!has(f, FAIL, /GitHub token/), 'must not walk symlinked TARGET_DIR outside the repo');
});

test('secret scanning: skips file under symlinked parent dir (CWE-59)', () => {
  const fake = 'ghp_' + 'D'.repeat(36);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-sec-parentsym-'));
  const outsideDir = path.join(root, 'outside-github');
  fs.mkdirSync(outsideDir);
  fs.writeFileSync(path.join(outsideDir, 'copilot-instructions.md'), `token: ${fake}\n`);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), AGENTS);
  fs.symlinkSync(outsideDir, path.join(repo, '.github'));

  const f = runChecks(repo);
  assert.ok(!has(f, FAIL, /GitHub token/), 'must not read TARGET_FILES through a symlinked parent');
});

test('--path rejects a file (must be a directory)', async () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS });
  const file = path.join(repo, 'AGENTS.md');
  await assert.rejects(
    () => run(['check', '--path', file]),
    /no such directory/,
  );
});

test('init: bridge file + import line come from the adapter table, not the tool id', async () => {
  const repo = mkrepo({});
  await run(['init', '--tool', 'gemini', '--path', repo]);
  assert.equal(fs.readFileSync(path.join(repo, 'GEMINI.md'), 'utf8'), '@./AGENTS.md\n');
  assert.ok(!fs.existsSync(path.join(repo, 'CLAUDE.md')), 'must not scaffold another tool’s bridge file');
  const f = runChecks(repo);
  assert.equal(f.count(FAIL), 0, JSON.stringify(f.items, null, 2));
});
