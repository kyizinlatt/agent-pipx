// Safety guarantees, enforced so they cannot silently regress:
//   1. `check` and `report` NEVER modify, create, or delete anything in the target repo.
//   2. `init` only CREATES missing files — it never overwrites or edits existing ones.
// These back the tool's privacy promise: it does not touch a user's files without their say-so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, run } from '../src/cli.js';
import { TOOLS } from '../adapters/tools.js';

// Snapshot every file under dir as path → content, so we can prove nothing changed.
function snapshot(dir) {
  const out = {};
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, 'utf8');
    }
  }
  return out;
}

function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-safety-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test('check writes nothing to the target repo', () => {
  const repo = mkrepo({
    'AGENTS.md': '# rules\n\nreal content that is clearly long enough here.\n',
    'CLAUDE.md': '@AGENTS.md\n',
    'src/app.ts': 'export const x: any = 1; console.log(x);\n',
  });
  const before = snapshot(repo);
  runChecks(repo);
  const after = snapshot(repo);
  assert.deepEqual(after, before, 'check must not add, remove, or modify any file');
});

test('report writes nothing to the target repo', async () => {
  const repo = mkrepo({ 'AGENTS.md': '# rules\n\nlong enough content to pass here.\n' });
  const before = snapshot(repo);
  await run(['report', '--path', repo]);
  const after = snapshot(repo);
  assert.deepEqual(after, before, 'report must be read-only');
});

test('init never overwrites existing files', async () => {
  const repo = mkrepo({
    'AGENTS.md': '# MY OWN RULES — do not touch\n',
    'CLAUDE.md': '# my own claude file, not an import\n',
  });
  const before = snapshot(repo);
  await run(['init', '--tool', 'claude', '--path', repo]);
  const after = snapshot(repo);
  assert.equal(after['AGENTS.md'], before['AGENTS.md'], 'existing AGENTS.md must be preserved verbatim');
  assert.equal(after['CLAUDE.md'], before['CLAUDE.md'], 'existing CLAUDE.md must be preserved verbatim');
});

test('init only creates the files it announces, nothing else', async () => {
  const repo = mkrepo({});
  await run(['init', '--tool', 'claude', '--path', repo]);
  const after = Object.keys(snapshot(repo)).sort();
  assert.deepEqual(after, ['AGENTS.md', 'CLAUDE.md'], 'init --tool claude creates exactly AGENTS.md + CLAUDE.md');
});

test('only upgrade.js may spawn processes (opt-in network surface)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const offenders = [];
  const stack = [path.join(root, 'src'), path.join(root, 'bin'), path.join(root, 'adapters')];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.js$/.test(e.name)) continue;
      const rel = path.relative(root, full);
      if (rel === path.join('src', 'upgrade.js')) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/node:child_process|spawnSync|execSync|execFileSync/.test(text)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], `spawn/exec must stay in src/upgrade.js only; found: ${offenders.join(', ')}`);
});

// AGENTS.md rule: adapters/tools.js is the authority for every per-tool convention. If the CLI
// names a bridge file itself, adding a new import-or-symlink tool silently writes the wrong file.
test('bridge facts live in the adapter table, never in the CLI', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const tool of TOOLS.filter((t) => t.bridge === 'import-or-symlink')) {
    assert.ok(tool.bridgeFile, `${tool.id}: adapter must declare bridgeFile`);
    assert.match(String(tool.importLine), /AGENTS\.md$/, `${tool.id}: adapter must declare importLine`);
  }
  const cli = fs.readFileSync(path.join(root, 'src', 'cli.js'), 'utf8');
  const leaked = TOOLS.map((t) => t.bridgeFile).filter((f) => f && cli.includes(`'${f}'`));
  assert.deepEqual(leaked, [], 'src/cli.js must read bridge file names from adapters/tools.js');
});
