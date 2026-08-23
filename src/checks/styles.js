// STYLES checks: repo-wide static scan for the antipatterns the language packs enforce, chosen by
// detected stack. Advisory (warnings) — a logger wrapper or a deliberate boundary `any` may be
// fine; the AI/report layer weighs them in context.
import path from 'node:path';
import { detectStack, readText, walk } from '../detect.js';

// Files where these patterns are legitimate (tests, stubs, CLI I/O surfaces).
const isExempt = (f) =>
  /(^|\/)(tests?|__tests__|scripts|bin)(\/|$)/i.test(f) ||
  /\.(test|spec)\.[jt]sx?$/.test(f) ||
  /\.d\.ts$/.test(f) ||
  /Tests\.swift$/.test(f) ||
  /(^|\/)logger\.[jt]sx?$/.test(f) ||
  /(^|\/)(cli|fix)\.[jt]sx?$/.test(f);

// Build patterns without embedding the forbidden tokens in this file's source — otherwise the
// styles scan false-positives on its own regex literals.
const RE_CONSOLE = /(^|[^.\w])console\.(log|debug|info)\(/;
const RE_ANY = new RegExp([':\\s*any\\b', '<' + 'any>', 'as ' + 'any\\b'].join('|'));
const RE_TS_IGNORE = new RegExp('@ts-' + '(ignore|nocheck)');
const RE_TRY_BANG = /(^|[^\w])try!/;
const RE_AS_BANG = /\sas!(\s|$)/;
const RE_PRINT = /(^|[^\w.])print\(/;

function countMatches(files, repo, re) {
  let n = 0;
  for (const f of files) {
    const rel = path.relative(repo, f);
    if (isExempt(rel)) continue;
    const text = readText(f);
    const g = new RegExp(re.source, 'gm');
    const m = text.match(g);
    if (m) n += m.length;
  }
  return n;
}

export function checkStyles(repo, findings) {
  const { webTs, swift } = detectStack(repo);

  if (webTs) {
    const files = walk(repo, { exts: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'] });
    const consoleN = countMatches(files, repo, RE_CONSOLE);
    if (consoleN > 0) findings.warn('Styles', `${consoleN} console.log/debug/info call(s) outside tests`, null, 'APX-STY-001');
    else findings.pass('Styles', 'no stray console logging');

    const anyN = countMatches(files, repo, RE_ANY);
    if (anyN > 0) findings.warn('Styles', `${anyN} use(s) of \`any\` outside tests`, null, 'APX-STY-002');

    const ignoreN = countMatches(files, repo, RE_TS_IGNORE);
    if (ignoreN > 0) {
      // Split tokens so this file's source does not match RE_TS_IGNORE.
      findings.warn('Styles', `${ignoreN} @ts-` + 'ignore/@ts-' + 'nocheck outside tests', null, 'APX-STY-003');
    }
  }

  if (swift) {
    const files = walk(repo, { exts: ['.swift'] });
    const tryN = countMatches(files, repo, RE_TRY_BANG);
    if (tryN > 0) findings.warn('Styles', `${tryN} force-try (try!) outside tests`, null, 'APX-STY-004');

    const castN = countMatches(files, repo, RE_AS_BANG);
    if (castN > 0) findings.warn('Styles', `${castN} force-cast (as!) outside tests`, null, 'APX-STY-005');

    const printN = countMatches(files, repo, RE_PRINT);
    if (printN > 0) findings.warn('Styles', `${printN} print() call(s) outside tests`, null, 'APX-STY-006');
  }

  if (!webTs && !swift) {
    findings.pass('Styles', 'no TypeScript/Swift sources to scan');
  }
}
