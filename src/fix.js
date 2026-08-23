// `agent-pipx fix` — apply only SAFE, mechanical remediations. It never merges, deletes, or
// guesses at your content: it backs up any file it touches (.bak) and, without --yes, does a
// dry-run that just prints what it would do. Content drift (a CLAUDE.md with its own rules) is
// reported as manual, never auto-rewritten.
//
// Writes never follow symlinks (CWE-59): only regular files whose realpath stays inside the repo.
import path from 'node:path';
import { agentsMdPath } from './ssot.js';
import { isRegularFile, readText } from './detect.js';
import { writeRepoFile } from './safe-write.js';

const IMPORT_TILDE = /^@~\/.*$/m;

// Each fixer: { detect(repo) -> {file, describe, apply()} | null }. Add more over time.
function fixers(repo) {
  const list = [];

  // Gemini's @import cannot expand ~ — rewrite the unresolvable @~/… line to a working relative
  // import of AGENTS.md. Only when AGENTS.md actually exists to point at.
  // Skip symlinks: writeFileSync would otherwise overwrite the link target outside the repo.
  const gemini = path.join(repo, 'GEMINI.md');
  if (isRegularFile(gemini) && agentsMdPath(repo)) {
    const content = readText(gemini);
    if (IMPORT_TILDE.test(content)) {
      list.push({
        file: 'GEMINI.md',
        describe: 'rewrite unresolvable @~/… import → @./AGENTS.md (Gemini cannot expand ~)',
        apply() {
          const fixed = content.replace(IMPORT_TILDE, '@./AGENTS.md');
          // Read→write backup (not copyFileSync) so a symlink .bak cannot redirect the copy.
          writeRepoFile(repo, gemini + '.bak', content);
          writeRepoFile(repo, gemini, fixed);
        },
      });
    }
  }

  return list;
}

export function doFix(repo, { apply = false } = {}) {
  const list = fixers(repo);
  if (list.length === 0) {
    console.log('Nothing to auto-fix. Content drift and missing rules need a human — run `agent-pipx check`.');
    return 0;
  }

  for (const f of list) {
    if (apply) {
      f.apply();
      console.log(`fixed ${f.file} — ${f.describe} (backup: ${f.file}.bak)`);
    } else {
      console.log(`would fix ${f.file} — ${f.describe}`);
    }
  }
  if (!apply) console.log('\nDry run. Re-run with --yes to apply (originals are backed up to *.bak).');
  return 0;
}
