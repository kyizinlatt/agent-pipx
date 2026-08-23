// Stable rule IDs and the --baseline accept-list. These are the contract CI depends on: an ID
// must mean the same thing across releases, and a baseline must never hide a NEW finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, run } from '../src/cli.js';
import { renderSarif } from '../src/report.js';
import { FAIL, WARN } from '../src/findings.js';
import { RULES, ruleById } from '../src/rules-registry.js';
import { DEFAULT_BASELINE, fingerprint } from '../src/baseline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-rules-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

// A repo that trips several categories at once.
const MESSY = {
  'CLAUDE.md': '# Claude\n\nIts own duplicated rules, no import.\n',
  '.cursor/rules/style.md': 'plain md that Cursor ignores\n',
  '.claude/skills/thing/SKILL.md': 'no frontmatter here\n',
};

test('registry: IDs are unique and well-formed', () => {
  const seen = new Set();
  for (const r of RULES) {
    assert.match(r.id, /^APX-(SEC|CFG|RUL|STY|ENV)-\d{3}$/, `${r.id} is not a well-formed rule ID`);
    assert.ok(!seen.has(r.id), `${r.id} is declared twice`);
    seen.add(r.id);
    assert.ok(r.title && r.category, `${r.id} needs a category and title`);
  }
});

// Source-level guard: a warning or failure without an ID cannot be baselined or tracked in CI.
test('every warn/fail call site passes a registered rule ID', () => {
  const files = [];
  const stack = [path.join(ROOT, 'src')];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.name.endsWith('.js')) files.push(full);
    }
  }
  const offenders = [];
  const used = new Set();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/findings\.(warn|fail)\(/g)) {
      const call = sliceCall(src, src.indexOf('(', m.index));
      const id = call.match(/'(APX-[A-Z]{3}-\d{3})'/);
      if (!id) offenders.push(`${path.relative(ROOT, file)}: ${call.slice(0, 60)}…`);
      else {
        used.add(id[1]);
        const rule = ruleById(id[1]);
        assert.ok(rule, `${id[1]} is not in the registry (${path.relative(ROOT, file)})`);
        const category = call.match(/\(\s*'([A-Z]\w+)'/);
        if (category) {
          assert.equal(rule.category, category[1], `${id[1]} is reported as ${category[1]} but registered as ${rule.category}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'every findings.warn/fail must pass a rule ID as its last argument');
  const orphans = RULES.map((r) => r.id).filter((id) => !used.has(id));
  assert.deepEqual(orphans, [], 'registry must not carry IDs no check can emit');
});

// Balanced-paren slice that ignores parens inside strings and template literals.
function sliceCall(src, open) {
  let depth = 0;
  const stack = [];
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (stack.length && "'\"`".includes(stack[stack.length - 1])) {
      if (ch === '\\') i++;
      else if (ch === stack[stack.length - 1]) stack.pop();
      else if (stack[stack.length - 1] === '`' && ch === '$' && src[i + 1] === '{') { stack.push('{'); i++; }
    } else if ("'\"`".includes(ch)) stack.push(ch);
    else if (ch === '{') stack.push('{');
    else if (ch === '}') stack.pop();
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error('unbalanced call');
}

test('emitted warnings and failures all carry a registered ID', () => {
  const f = runChecks(mkrepo(MESSY));
  const issues = f.items.filter((x) => x.severity === WARN || x.severity === FAIL);
  assert.ok(issues.length > 0, 'the synthetic repo must produce findings');
  for (const issue of issues) {
    assert.ok(issue.id, `finding without an ID: ${issue.message}`);
    assert.ok(ruleById(issue.id), `unregistered ID ${issue.id}`);
  }
});

test('SARIF ships the full catalogue and points results at it', () => {
  const f = runChecks(mkrepo(MESSY));
  const sarif = JSON.parse(renderSarif(f, '/tmp/repo'));
  const rules = sarif.runs[0].tool.driver.rules;
  assert.equal(rules.length, RULES.length, 'every rule must be declared, not only the ones that fired');
  const result = sarif.runs[0].results[0];
  assert.match(result.ruleId, /^APX-/);
  assert.equal(rules[result.ruleIndex].id, result.ruleId, 'ruleIndex must resolve to the same rule');
});

test('baseline: accepts today’s findings, still reports new ones', async () => {
  const repo = mkrepo(MESSY);
  const before = runChecks(repo);
  assert.ok(before.count(WARN) + before.count(FAIL) > 0);

  assert.equal(await run(['baseline', '--path', repo]), 0);
  const file = path.join(repo, DEFAULT_BASELINE);
  assert.ok(fs.existsSync(file), 'baseline file written');

  assert.equal(await run(['check', '--path', repo, '--baseline', DEFAULT_BASELINE]), 0, 'known findings are accepted');

  // A brand-new problem must still break the build.
  fs.writeFileSync(path.join(repo, '.cursor', 'rules', 'other.md'), 'another ignored file\n');
  assert.equal(await run(['check', '--path', repo, '--baseline', DEFAULT_BASELINE]), 1, 'new finding still exits non-zero');
});

test('baseline: refuses to overwrite an existing accept-list without --yes', async () => {
  const repo = mkrepo(MESSY);
  await run(['baseline', '--path', repo]);
  const original = fs.readFileSync(path.join(repo, DEFAULT_BASELINE), 'utf8');
  fs.writeFileSync(path.join(repo, DEFAULT_BASELINE), '{"version":1,"entries":[]}\n');

  assert.equal(await run(['baseline', '--path', repo]), 1, 'must not clobber silently');
  assert.equal(fs.readFileSync(path.join(repo, DEFAULT_BASELINE), 'utf8'), '{"version":1,"entries":[]}\n');

  assert.equal(await run(['baseline', '--path', repo, '--yes']), 0);
  assert.equal(fs.readFileSync(path.join(repo, DEFAULT_BASELINE), 'utf8'), original, 'rewrite is deterministic');
});

test('baseline: fingerprint ignores the message, so rewording does not un-accept a finding', () => {
  const a = { id: 'APX-CFG-006', category: 'Config', file: 'CLAUDE.md', message: 'old wording' };
  const b = { id: 'APX-CFG-006', category: 'Config', file: 'CLAUDE.md', message: 'completely new wording' };
  assert.equal(fingerprint(a), fingerprint(b));
});

test('baseline never suppresses passes', async () => {
  const repo = mkrepo(MESSY);
  await run(['baseline', '--path', repo]);
  const f = runChecks(repo);
  const passes = f.count('pass');
  const { applyBaseline } = await import('../src/baseline.js');
  applyBaseline(f, path.join(repo, DEFAULT_BASELINE));
  assert.equal(f.count('pass'), passes, 'passes are untouched');
  assert.ok(f.suppressed > 0, 'suppressed count is reported, not hidden');
});
