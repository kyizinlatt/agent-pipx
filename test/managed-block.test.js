// `init` never touches an existing file, which left the most common finding — a bridge file with
// its own rules and no import — unfixable. A managed block adds the import without rewriting a
// single byte the user wrote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../src/cli.js';
import { doFix } from '../src/fix.js';
import { BEGIN, END, countBlocks } from '../src/managed-block.js';
import { WARN } from '../src/findings.js';

function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-block-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}
const AGENTS = '# Test project\n\nReal rules here that are clearly long enough to pass the emptiness check.\n';
const OWN_RULES = '# Claude\n\nMy own notes.\n\n- never delete this line\n';
const hasId = (f, id) => f.items.some((x) => x.id === id);

test('fix: appends a managed block and keeps every existing line', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS, 'CLAUDE.md': OWN_RULES });
  assert.ok(hasId(runChecks(repo), 'APX-CFG-006'), 'drift is reported before the fix');

  doFix(repo, { apply: true });
  const after = fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8');
  assert.ok(after.startsWith(OWN_RULES), 'the user’s content stays first and unchanged');
  assert.ok(after.includes('never delete this line'));
  assert.ok(after.includes(BEGIN) && after.includes(END) && after.includes('@AGENTS.md'));
  assert.equal(fs.readFileSync(path.join(repo, 'CLAUDE.md.bak'), 'utf8'), OWN_RULES, 'original backed up');

  assert.ok(!hasId(runChecks(repo), 'APX-CFG-006'), 'the finding is resolved');
});

test('fix: is idempotent — a second run has nothing to do', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS, 'CLAUDE.md': OWN_RULES });
  doFix(repo, { apply: true });
  const once = fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8');
  doFix(repo, { apply: true });
  assert.equal(fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), once, 'no second block');
  assert.equal(countBlocks(once), 1);
});

test('fix: leaves an already-bridged file alone', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS, 'CLAUDE.md': '@AGENTS.md\n' });
  doFix(repo, { apply: true });
  assert.equal(fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.ok(!fs.existsSync(path.join(repo, 'CLAUDE.md.bak')), 'nothing was touched');
});

test('fix: dry run reports the change without writing it', () => {
  const repo = mkrepo({ 'AGENTS.md': AGENTS, 'CLAUDE.md': OWN_RULES });
  doFix(repo, { apply: false });
  assert.equal(fs.readFileSync(path.join(repo, 'CLAUDE.md'), 'utf8'), OWN_RULES);
});

test('duplicate managed blocks are reported', () => {
  const doubled = `${OWN_RULES}\n${BEGIN}\n@AGENTS.md\n${END}\n\n${BEGIN}\n@AGENTS.md\n${END}\n`;
  const f = runChecks(mkrepo({ 'AGENTS.md': AGENTS, 'CLAUDE.md': doubled }));
  const finding = f.items.find((x) => x.id === 'APX-CFG-039');
  assert.ok(finding, 'a botched merge leaving two blocks is flagged');
  assert.equal(finding.severity, WARN);
});
