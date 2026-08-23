// Skills get copied between a tool-specific directory and the shared one. The copies drift, or
// two skills end up claiming one name — both invisible until an agent behaves differently in
// one tool than another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../src/cli.js';

function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-drift-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}
const hasId = (f, id) => f.items.some((x) => x.id === id);
const AGENTS = '# Test project\n\nReal rules here that are clearly long enough to pass the emptiness check.\n';
const skill = (name, body) => `---\nname: ${name}\ndescription: Does the ${name} thing when asked.\n---\n\n${body}\n`;

test('skills: copies of one skill that have drifted are flagged', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': AGENTS,
    '.claude/skills/deploy/SKILL.md': skill('deploy', 'Step one. Step two.'),
    '.agents/skills/deploy/SKILL.md': skill('deploy', 'Step one. Step two. Step three.'),
  }));
  assert.ok(hasId(f, 'APX-CFG-036'), 'drifted copies flagged');
});

test('skills: an identical mirror is not drift', () => {
  const body = skill('deploy', 'Step one. Step two.');
  const f = runChecks(mkrepo({
    'AGENTS.md': AGENTS,
    '.claude/skills/deploy/SKILL.md': body,
    '.agents/skills/deploy/SKILL.md': `${body}\n\n`,
  }));
  assert.ok(!hasId(f, 'APX-CFG-036'), 'trailing whitespace is not a difference');
  assert.ok(f.items.some((x) => /mirrored identically/.test(x.message)), 'the mirror is reported as verified');
});

test('skills: two different skills claiming one name are flagged', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': AGENTS,
    '.claude/skills/ship-web/SKILL.md': skill('release', 'Web release steps.'),
    '.claude/skills/ship-ios/SKILL.md': skill('release', 'iOS release steps.'),
  }));
  assert.ok(hasId(f, 'APX-CFG-037'), 'name collision flagged');
});

test('commands: reading $ARGUMENTS without an argument-hint is flagged', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': AGENTS,
    '.claude/commands/review.md': '---\ndescription: Review a pull request\n---\n\nReview PR $ARGUMENTS and report.\n',
  }));
  assert.ok(hasId(f, 'APX-CFG-038'), 'missing argument-hint flagged');

  const hinted = runChecks(mkrepo({
    'AGENTS.md': AGENTS,
    '.claude/commands/review.md': '---\ndescription: Review a pull request\nargument-hint: <pr-number>\n---\n\nReview PR $ARGUMENTS and report.\n',
  }));
  assert.ok(!hasId(hinted, 'APX-CFG-038'), 'a declared hint satisfies the check');

  const noArgs = runChecks(mkrepo({
    'AGENTS.md': AGENTS,
    '.claude/commands/status.md': '---\ndescription: Show status\n---\n\nSummarize the working tree.\n',
  }));
  assert.ok(!hasId(noArgs, 'APX-CFG-038'), 'a command taking no arguments needs no hint');
});
