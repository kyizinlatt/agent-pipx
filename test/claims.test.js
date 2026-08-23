// AGENTS.md describes the project; these checks prove the description is still true. The failure
// they catch is the everyday one: an agent copies a documented command that no longer exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../src/cli.js';

function mkrepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-claim-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}
const hasId = (f, id) => f.items.some((x) => x.id === id);
const msgFor = (f, id) => (f.items.find((x) => x.id === id) || {}).message || '';

const agents = (body) => `# Project\n\n${body}\n\n## Sensitive data\n\nNever commit secrets or .env contents.\n`;

test('commands: a documented npm script that does not exist is flagged', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': agents('## Commands\n\n- Test: `npm test`\n- Build: `npm run build`\n\n## Repository layout\n\n- `src/` owns the app\n\n## Boundaries\n\n- generated output is off limits'),
    'package.json': { scripts: { test: 'node --test' } },
    'src/index.js': '',
  }));
  assert.ok(hasId(f, 'APX-RUL-018'), 'missing script flagged');
  assert.match(msgFor(f, 'APX-RUL-018'), /npm run build/);
  assert.ok(!/npm test/.test(msgFor(f, 'APX-RUL-018')), 'the script that exists is not reported');
});

test('commands: scripts, make targets and file paths that resolve stay quiet', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': agents('## Commands\n\n- Test: `npm test`\n- Lint: `npm run lint`\n- Ship: `make release`\n- Run: `node bin/app.js`\n- Setup: `./scripts/setup.sh`\n\n## Repository layout\n\n- `bin/` owns the entry point'),
    'package.json': { scripts: { test: 'node --test', lint: 'eslint .' } },
    Makefile: 'release:\n\techo shipping\n',
    'bin/app.js': '',
    'scripts/setup.sh': '',
  }));
  assert.ok(!hasId(f, 'APX-RUL-018'), 'resolvable commands produce no finding');
  assert.ok(f.items.some((x) => /commands resolve \(5 checked\)/.test(x.message)), 'all five were verified');
});

test('commands: unverifiable commands are skipped, not guessed at', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': agents('## Commands\n\n- `cargo test`\n- `pytest -q`\n- `docker compose up`\n- `npm ci`\n- `node --test`\n- `swift build`\n\n## Repository layout\n\n- `src/` owns the app'),
    'package.json': { scripts: {} },
    'src/lib.rs': '',
  }));
  assert.ok(!hasId(f, 'APX-RUL-018'), 'commands we cannot resolve are never reported as missing');
});

test('package manager: a claim the lockfile contradicts is flagged', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': agents('Package manager: pnpm.\n\n## Commands\n\n- Test: `pnpm test`\n\n## Repository layout\n\n- `src/` owns the app'),
    'package.json': { scripts: { test: 'node --test' } },
    'package-lock.json': '{}',
    'src/index.js': '',
  }));
  assert.ok(hasId(f, 'APX-RUL-019'), 'claim vs lockfile mismatch flagged');
  assert.match(msgFor(f, 'APX-RUL-019'), /package-lock\.json/);
});

test('package manager: a matching claim, or no lockfile at all, stays quiet', () => {
  const match = runChecks(mkrepo({
    'AGENTS.md': agents('Package manager: npm.\n\n## Repository layout\n\n- `src/` owns the app'),
    'package.json': {}, 'package-lock.json': '{}', 'src/index.js': '',
  }));
  assert.ok(!hasId(match, 'APX-RUL-019'));

  const noLock = runChecks(mkrepo({
    'AGENTS.md': agents('Package manager: pnpm.\n\n## Repository layout\n\n- `src/` owns the app'),
    'package.json': {}, 'src/index.js': '',
  }));
  assert.ok(!hasId(noLock, 'APX-RUL-019'), 'nothing to compare against means no finding');
});

test('dependencies: a zero-dependency rule that package.json breaks is flagged', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': agents('## Rules\n\n- Keep runtime dependencies at **zero** — Node built-ins only.\n\n## Repository layout\n\n- `src/` owns the app'),
    'package.json': { dependencies: { chalk: '^5.0.0' } },
    'src/index.js': '',
  }));
  assert.ok(hasId(f, 'APX-RUL-020'), 'contradicted claim flagged');
  assert.match(msgFor(f, 'APX-RUL-020'), /chalk/);
});

test('dependencies: devDependencies do not break a runtime-dependency claim', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': agents('## Rules\n\n- Zero runtime dependencies.\n\n## Repository layout\n\n- `src/` owns the app'),
    'package.json': { devDependencies: { vitest: '^1.0.0' } },
    'src/index.js': '',
  }));
  assert.ok(!hasId(f, 'APX-RUL-020'), 'the claim is about runtime dependencies only');
});

test('boundaries: a do-not-touch path that no longer exists is flagged', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': agents('## Repository layout\n\n- `src/` owns the app\n\n## Boundaries (do not touch)\n\n- `legacy/vendor/` is frozen\n- `src/generated.js` is written by the codegen'),
    'src/index.js': '',
  }));
  assert.ok(hasId(f, 'APX-RUL-021'), 'stale boundary flagged');
  assert.match(msgFor(f, 'APX-RUL-021'), /legacy\/vendor\//);
  assert.ok(!/src\/index/.test(msgFor(f, 'APX-RUL-021')));
});

test('claims: a repo with no Commands section produces no claim findings', () => {
  const f = runChecks(mkrepo({
    'AGENTS.md': agents('Some prose only.\n\n## Repository layout\n\n- `src/` owns the app'),
    'src/index.js': '',
  }));
  for (const id of ['APX-RUL-018', 'APX-RUL-019', 'APX-RUL-020', 'APX-RUL-021']) {
    assert.ok(!hasId(f, id), `${id} must need an explicit claim`);
  }
});
