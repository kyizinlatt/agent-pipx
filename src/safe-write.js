// The one place that writes into a user's repo. Writes never follow symlinks (CWE-59) and never
// land outside the repo: a .bak or a config path could otherwise redirect a write to any file the
// user can reach. Every command that creates or rewrites a file goes through here.
import fs from 'node:fs';
import path from 'node:path';
import { assertInsideRepo, exists, isRegularFile, isSymlink } from './detect.js';

/** Write `content` to `abs` only if the path is a regular file (or new) inside `repo`. */
export function writeRepoFile(repo, abs, content) {
  if (isSymlink(abs)) {
    throw new Error(`${path.basename(abs)} is a symlink — refusing to write through it`);
  }
  if (exists(abs) && !isRegularFile(abs)) {
    throw new Error(`refusing to write non-regular file: ${path.basename(abs)}`);
  }
  if (exists(abs)) {
    assertInsideRepo(repo, abs);
  } else {
    assertInsideRepo(repo, path.dirname(abs));
  }
  fs.writeFileSync(abs, content);
}
