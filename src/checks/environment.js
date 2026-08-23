// ENVIRONMENT checks: which agent-tool CLIs are installed (informational), base tooling, and
// package-manager ↔ lockfile agreement.
import path from 'node:path';
import { detectInstalledClis, detectStack, hasBinary, isDir, isFile, readText, walk } from '../detect.js';

export function checkEnvironment(repo, findings) {
  checkQualityGate(repo, findings);
  // git is assumed by nearly everything.
  if (hasBinary('git')) findings.pass('Environment', 'git available');
  else findings.warn('Environment', 'git not on PATH', null, 'APX-ENV-001');

  // ripgrep speeds scans but is optional — the tool falls back to Node's own walk.
  if (!hasBinary('rg')) findings.pass('Environment', 'ripgrep optional (using built-in scan)');

  // Which agent CLIs are installed? Informational — helps explain which adapters matter.
  const installed = detectInstalledClis();
  if (installed.length) {
    findings.pass('Environment', `agent CLIs installed: ${installed.map((i) => i.tool.name).join(', ')}`);
  }

  const { webTs, swift } = detectStack(repo);
  if (webTs) {
    if (!hasBinary('node')) findings.warn('Environment', 'package.json present but node not on PATH', null, 'APX-ENV-002');
    const lockfiles = [
      ['pnpm-lock.yaml', 'pnpm'],
      ['package-lock.json', 'npm'],
      ['yarn.lock', 'yarn'],
      ['bun.lockb', 'bun'],
    ];
    const found = lockfiles.find(([f]) => isFile(path.join(repo, f)));
    if (found) {
      findings.pass('Environment', `${found[1]} lockfile present`);
      if (found[1] === 'pnpm' && !hasBinary('pnpm')) {
        findings.warn('Environment', 'pnpm-lock.yaml present but pnpm not on PATH', null, 'APX-ENV-003');
      }
    } else if (packageHasDeps(path.join(repo, 'package.json'))) {
      findings.warn('Environment', 'package.json but no lockfile — dependency versions unpinned', null, 'APX-ENV-004');
    } else {
      findings.pass('Environment', 'package.json has no dependencies to pin');
    }
  }
  if (swift) {
    if (!hasBinary('swift') && !hasBinary('xcodebuild')) {
      findings.warn('Environment', 'Swift sources present but neither swift nor xcodebuild on PATH', null, 'APX-ENV-005');
    }
  }
}

function packageHasDeps(pkgPath) {
  try {
    const pkg = JSON.parse(readText(pkgPath) || '{}');
    const keys = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ];
    return keys.length > 0;
  } catch {
    return false;
  }
}

// A git repo should have an automated quality gate: CI and/or pre-commit hooks.
function checkQualityGate(repo, findings) {
  // `.git` is a directory in a normal clone, but a regular file holding `gitdir: …` in a linked
  // worktree or a submodule — treating only the directory as a repo silently skipped this check.
  const dotGit = path.join(repo, '.git');
  if (!isDir(dotGit) && !isFile(dotGit)) return; // only meaningful inside a repo
  const wf = path.join(repo, '.github', 'workflows');
  const hasCI =
    (isDir(wf) && walk(wf, { exts: ['.yml', '.yaml'] }).length > 0) ||
    ['.gitlab-ci.yml', 'azure-pipelines.yml', '.circleci/config.yml'].some((f) => isFile(path.join(repo, f)));
  const hasPreCommit = ['.pre-commit-config.yaml', '.husky', 'lefthook.yml', '.lefthook.yml', 'lefthook.yaml']
    .some((f) => isFile(path.join(repo, f)) || isDir(path.join(repo, f)));
  if (hasCI || hasPreCommit) {
    findings.pass('Environment', 'automated quality gate present (CI and/or pre-commit)');
  } else {
    findings.warn('Environment', 'no CI workflow or pre-commit hooks found — add an automated quality gate', null, 'APX-ENV-006');
  }
}
