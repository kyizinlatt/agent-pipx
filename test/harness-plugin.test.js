// The Claude Code harness ships two ways: install-harness.sh copies or links it into a repo and
// wires hooks through settings.json, and each harness root is also a Claude Code plugin whose
// plugin.json wires the same hooks through ${CLAUDE_PLUGIN_ROOT}. These tests keep the two wirings
// identical, so a hook added to one route cannot silently be missing from the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = path.join(ROOT, 'claude-harness');
const PLUGIN_ROOTS = { core: 'core', 'web-ts': 'packs/web-ts', swiftui: 'packs/swiftui' };

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// Rewrite every settings.json hook path to the path the plugin uses for the same script.
function toPluginPaths(value) {
  if (typeof value === 'string') {
    return value.replaceAll('$CLAUDE_PROJECT_DIR/.claude/hooks/', '${CLAUDE_PLUGIN_ROOT}/hooks/');
  }
  if (Array.isArray(value)) return value.map(toPluginPaths);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPluginPaths(v)]));
  }
  return value;
}

function hookCommands(hooks) {
  return Object.values(hooks).flat().flatMap((group) => group.hooks.map((h) => h.command));
}

for (const [name, rel] of Object.entries(PLUGIN_ROOTS)) {
  const dir = path.join(HARNESS, rel);
  const manifest = readJson(path.join(dir, '.claude-plugin', 'plugin.json'));
  const settings = readJson(path.join(dir, 'settings.json'));

  test(`${name}: plugin.json hooks match settings.json hooks`, () => {
    assert.deepEqual(manifest.hooks, toPluginPaths(settings.hooks));
  });

  test(`${name}: plugin name matches its marketplace entry`, () => {
    assert.equal(manifest.name, name);
  });

  // A fixed version stops `claude plugin update` from picking up a new commit (seen with
  // Claude Code 2.1.304). Without one, the pinned git sha is the version.
  test(`${name}: plugin.json has no version`, () => {
    assert.equal(Object.hasOwn(manifest, 'version'), false);
  });

  test(`${name}: every plugin hook points at an executable script in the root`, () => {
    for (const command of hookCommands(manifest.hooks)) {
      const prefix = '${CLAUDE_PLUGIN_ROOT}/';
      assert.ok(command.startsWith(prefix), `not under the plugin root: ${command}`);
      const script = path.join(dir, command.slice(prefix.length));
      assert.ok(fs.existsSync(script), `missing: ${script}`);
      fs.accessSync(script, fs.constants.X_OK);
    }
  });
}
