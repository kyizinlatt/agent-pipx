// Detection utilities: filesystem probing, installed-CLI checks, and stack/adapter discovery.
// Pure Node built-ins — no runtime dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { TOOLS } from '../adapters/tools.js';

export function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function isDangling(p) {
  // A symlink whose target does not resolve.
  if (!isSymlink(p)) return false;
  try {
    fs.statSync(p); // follows the link; throws if the target is missing
    return false;
  } catch {
    return true;
  }
}

export function readlink(p) {
  try {
    return fs.readlinkSync(p);
  } catch {
    return '';
  }
}

// Equivalent to bash `a -ef b`: same device + inode after following symlinks.
export function sameFile(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

export function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** True only for a non-symlink regular file (lstat). Use before writes / untrusted reads. */
export function isRegularFile(p) {
  try {
    return fs.lstatSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve `abs` and ensure it stays inside `repo` (after realpath). Throws if outside or missing.
 * Symlinks: follows for the containment check — callers that must not write through links
 * should also require isRegularFile / !isSymlink first.
 */
export function assertInsideRepo(repo, abs) {
  const root = fs.realpathSync(repo);
  const real = fs.realpathSync(abs);
  const rel = path.relative(root, real);
  if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) {
    throw new Error(`path escapes repo: ${path.relative(repo, abs) || abs}`);
  }
  return real;
}

/** true when realpath(abs) stays inside realpath(repo). */
export function isInsideRepo(repo, abs) {
  try {
    assertInsideRepo(repo, abs);
    return true;
  } catch {
    return false;
  }
}

// Lockfile → package manager. One list: the environment check and the AGENTS.md claims check
// must never disagree about what this repo is actually using. bun writes bun.lock (text) or the
// older bun.lockb.
export const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

/** @returns {{file: string, manager: string}|null} */
export function detectLockfile(repo) {
  for (const [file, manager] of LOCKFILES) {
    if (isFile(path.join(repo, file))) return { file, manager };
  }
  return null;
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Is `name` an executable on PATH? PATH scan avoids spawning a shell.
export function hasBinary(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}

// Recursively list files under `dir`, skipping heavy/noise directories. Bounded and lazy-ish.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', 'generated', 'Pods', '.build', 'vendor',
]);

export function walk(dir, { exts = null, max = 20000 } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < max) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        if (!exts || exts.some((x) => e.name.endsWith(x))) out.push(full);
      }
    }
  }
  return out;
}

// Which language stack(s) does this repo look like?
export function detectStack(repo) {
  const webTs = isFile(path.join(repo, 'package.json')) || isFile(path.join(repo, 'tsconfig.json'));
  const swift = walk(repo, { exts: ['.swift'], max: 1 }).length > 0;
  return { webTs, swift };
}

// Which agent tools are CONFIGURED in this repo (their adapter files/dirs are present)?
export function detectAdapters(repo) {
  const present = [];
  for (const tool of TOOLS) {
    const found = (tool.projectFiles || []).filter((rel) => exists(path.join(repo, rel)));
    if (found.length) present.push({ tool, files: found });
  }
  return present;
}

// Which agent tool CLIs are installed on this machine?
export function detectInstalledClis() {
  const installed = [];
  for (const tool of TOOLS) {
    const bins = (tool.cli || []).filter((b) => hasBinary(b));
    if (bins.length) installed.push({ tool, bins });
  }
  return installed;
}
