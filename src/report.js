// Output renderers: human (default), JSON (--json), SARIF, and a polished CLI report
// (findings + fix cards + judgement panel + copyable agent prompt). Machine JSON stays
// on `check --json` / `check --sarif` only.
import { CATEGORIES, FAIL, PASS, WARN } from './findings.js';
import { RULES, helpUri } from './rules-registry.js';
import { renderCheckedSummary } from './progress.js';
import { remediationsFor } from './remediate.js';

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);

// Unicode via escapes so the source stays ASCII-safe across editors/tools.
const CHECK = '\u2713';
const WARN_MARK = '\u26A0';
const CROSS = '\u2717';
const BAR = '\u2500';
const BULLET = '\u2022';
const EM = '\u2014';
const ARROW = '\u2192';
const BOX_TL = '\u250C';
const BOX_TR = '\u2510';
const BOX_BL = '\u2514';
const BOX_BR = '\u2518';
const BOX_H = '\u2500';
const BOX_V = '\u2502';

const MARK = { [PASS]: () => c('32', CHECK), [WARN]: () => c('33', WARN_MARK), [FAIL]: () => c('31', CROSS) };
const ORDER = { [FAIL]: 0, [WARN]: 1, [PASS]: 2 };

const BOX_INNER = 58;

function rule(label, width = BOX_INNER) {
  const title = ` ${label} `;
  const fill = Math.max(0, width - title.length - 1);
  return c('2', `${BAR}${BAR}${title}${BAR.repeat(fill)}`);
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

/** Wrap plain text to `width` columns (word-aware; long tokens hard-split). */
function wrapPlain(text, width) {
  const out = [];
  for (const paragraph of String(text).split('\n')) {
    if (!paragraph) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (!word) continue;
      if (!line) {
        if (word.length <= width) {
          line = word;
        } else {
          for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
          line = '';
        }
        continue;
      }
      if (stripAnsi(line + word).length <= width) {
        line += word;
      } else {
        out.push(line.trimEnd());
        if (/^\s+$/.test(word)) {
          line = '';
        } else if (word.length <= width) {
          line = word;
        } else {
          for (let i = 0; i < word.length; i += width) {
            const chunk = word.slice(i, i + width);
            if (i + width < word.length) out.push(chunk);
            else line = chunk;
          }
        }
      }
    }
    if (line) out.push(line.trimEnd());
  }
  return out;
}

function boxLines(rows, { title = null, accent = '2' } = {}) {
  const inner = BOX_INNER;
  const contentWidth = inner - 2;
  const top =
    title != null
      ? `${BOX_TL}${BOX_H}${BOX_H} ${title} ${BOX_H.repeat(Math.max(0, inner - title.length - 4))}${BOX_TR}`
      : `${BOX_TL}${BOX_H.repeat(inner)}${BOX_TR}`;
  const bottom = `${BOX_BL}${BOX_H.repeat(inner)}${BOX_BR}`;
  const body = [];
  for (const row of rows) {
    const wrapped = wrapPlain(stripAnsi(row), contentWidth);
    for (const part of wrapped.length ? wrapped : ['']) {
      const padLen = Math.max(0, contentWidth - stripAnsi(part).length);
      body.push(`${c(accent, BOX_V)} ${part}${' '.repeat(padLen)} ${c(accent, BOX_V)}`);
    }
  }
  return [c(accent, top), ...body, c(accent, bottom)];
}

function statusTone(summary) {
  if (summary.fail > 0) return { code: '31', label: 'FAIL' };
  if (summary.warn > 0) return { code: '33', label: 'WARN' };
  return { code: '32', label: 'PASS' };
}

function renderFindingLines(findings) {
  const lines = [];
  for (const cat of CATEGORIES) {
    const items = findings.items
      .filter((f) => f.category === cat)
      .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    for (const f of items) {
      const msg = f.severity === PASS ? c('2', f.message) : f.message;
      const file = f.file ? c('2', `  ${f.file}`) : '';
      lines.push(`  ${MARK[f.severity]()} ${pad(cat, 11)} ${msg}${file}`);
    }
  }
  return lines;
}

function renderSummary(findings) {
  const s = findings.summary();
  const line = `  ${c('32', s.pass + ' passed')}   ${c('33', s.warn + ' warning(s)')}   ${c('31', s.fail + ' failure(s)')}`;
  // A baseline never disappears from the report: an accepted problem is still a problem.
  return findings.suppressed ? `${line}   ${c('2', findings.suppressed + ' baselined')}` : line;
}

function renderStatusBanner(findings) {
  const s = findings.summary();
  const tone = statusTone(s);
  // ASCII badge keeps box borders aligned (emoji often = 2 terminal columns).
  const badge = c('1', c(tone.code, `[${tone.label}]`));
  const counts = `${s.pass} passed ${BULLET} ${s.warn} warning${s.warn === 1 ? '' : 's'} ${BULLET} ${s.fail} failure${s.fail === 1 ? '' : 's'}`;
  return boxLines([badge, c('2', counts)], { title: 'Status', accent: tone.code });
}

function renderIssueCards(findings) {
  const items = remediationsFor(findings);
  if (!items.length) {
    return [
      '',
      rule('Fix'),
      '',
      `  ${c('32', CHECK)} Nothing to fix ${EM} mechanical checks are clean.`,
      '',
    ];
  }
  const lines = ['', rule('Fix'), ''];
  items.forEach(({ finding: f, tip }, i) => {
    const n = c('1', String(i + 1).padStart(2, ' '));
    lines.push(`  ${n}  ${MARK[f.severity]()} ${c('1', f.category)}`);
    lines.push(`      ${f.message}`);
    if (f.file) lines.push(`      ${c('2', f.file)}`);
    lines.push(`      ${c('36', ARROW)} ${tip}`);
    lines.push('');
  });
  return lines;
}

function renderPassedPanel(findings) {
  const passes = findings.items.filter((f) => f.severity === PASS);
  const issues = findings.items.filter((f) => f.severity !== PASS);
  const lines = ['', rule('Passed'), ''];
  if (!passes.length) {
    lines.push(`  ${c('2', 'No passing checks yet.')}`);
    lines.push('');
    return lines;
  }
  // When there are issues, keep passes compact; when clean, show the full list.
  if (issues.length) {
    const byCat = CATEGORIES.map((cat) => {
      const n = passes.filter((f) => f.category === cat).length;
      return n ? `${cat} ${c('2', '(' + n + ')')}` : null;
    }).filter(Boolean);
    lines.push(`  ${c('32', CHECK)} ${passes.length} check${passes.length === 1 ? '' : 's'} passed`);
    lines.push(`    ${c('2', byCat.join(`  ${BULLET}  `))}`);
  } else {
    for (const f of passes) {
      lines.push(`  ${MARK[PASS]()} ${pad(f.category, 11)} ${c('2', f.message)}`);
    }
  }
  lines.push('');
  return lines;
}

const JUDGEMENT_ALWAYS = {
  id: 'quality',
  title: 'AGENTS.md quality',
  detail: 'Real project rules, or generic filler?',
};

const JUDGEMENT_OPTIONAL = [
  {
    id: 'drift',
    title: 'Adapter drift',
    detail: 'Do CLAUDE.md / GEMINI.md / .cursor/rules duplicate or contradict AGENTS.md?',
    match: (f) =>
      f.category === 'Config' ||
      /CLAUDE\.md|GEMINI\.md|\.cursor\/rules|adapter|bridge|symlink|settings\.json|hook/i.test(f.message),
  },
  {
    id: 'fit',
    title: 'Tool fit',
    detail: 'Do configured tools match how this repo is actually built?',
    match: (f) => f.category === 'Environment' || /CLI|lockfile|CI|pre-commit|toolchain|PATH/i.test(f.message),
  },
  {
    id: 'health',
    title: 'Rule health',
    detail: 'Anything unenforceable, outdated, or in conflict?',
    match: (f) =>
      f.category === 'Rules' ||
      f.category === 'Styles' ||
      /placeholder|empty section|nearly empty|oversize|console\.|`any`|@ts-/i.test(f.message),
  },
  {
    id: 'secrets',
    title: 'Secret response',
    detail: 'Were flagged credentials rotated and purged from the file (and git history if committed)?',
    match: (f) => f.category === 'Secrets' || /credential|token|secret|private key/i.test(f.message),
  },
];

const JUDGEMENT_PASS_SET = [
  JUDGEMENT_ALWAYS,
  ...JUDGEMENT_OPTIONAL.filter((j) => j.id !== 'secrets'),
];

/** Hybrid: PASS ? full nuance set; issues ? always quality + items matching open findings. */
export function selectJudgementItems(findings) {
  const issues = findings.items.filter((f) => f.severity === FAIL || f.severity === WARN);
  if (!issues.length) return JUDGEMENT_PASS_SET;
  const selected = [JUDGEMENT_ALWAYS];
  for (const item of JUDGEMENT_OPTIONAL) {
    if (issues.some((f) => item.match(f))) selected.push(item);
  }
  return selected;
}

function issueSummaries(findings) {
  return findings.items
    .filter((f) => f.severity === FAIL || f.severity === WARN)
    .map((f) => {
      const where = f.file ? ` (${f.file})` : '';
      return `- [${f.severity.toUpperCase()}] ${f.category}: ${f.message}${where}`;
    });
}

function renderJudgementPanel(findings) {
  const items = selectJudgementItems(findings);
  const issues = findings.items.some((f) => f.severity !== PASS);
  const lines = ['', rule('Judgement'), ''];
  lines.push(
    c(
      '2',
      issues
        ? `  Focused on open issues (+ AGENTS.md quality) ${EM} ask your coding agent:`
        : `  Mechanical checks passed ${EM} still ask your coding agent about nuance:`,
    ),
  );
  lines.push('');
  items.forEach((item, i) => {
    lines.push(`  ${c('33', String(i + 1) + '.')} ${c('1', item.title)}`);
    lines.push(`     ${c('2', item.detail)}`);
  });
  lines.push('');
  return lines;
}

function buildJudgementPrompt(findings) {
  const items = selectJudgementItems(findings);
  const issues = issueSummaries(findings);
  const bullets = items.map((item) => `- ${item.title}: ${item.detail}`);

  if (!issues.length) {
    return [
      "Mechanical checks on this repo's AI-agent configuration passed. Still make these nuance calls:",
      '',
      ...bullets,
      '',
      'Read AGENTS.md and each adapter briefly, then give a one-line verdict. Do not edit unless asked.',
    ];
  }

  return [
    "You are auditing this repository's AI-agent configuration. agent-pipx reported these open issues:",
    '',
    ...issues,
    '',
    'Address those first, then make these judgement calls a linter cannot:',
    '',
    ...bullets,
    '',
    'Read AGENTS.md and each adapter, then report findings grouped under Config / Rules / Styles /',
    `Environment ${EM} each with file:line, what is wrong, why it matters, and the fix ${EM} then a one-line`,
    'verdict. Do not edit anything unless asked.',
  ];
}

function renderPromptPanel(findings) {
  // Plain text only: no box borders. Box-drawing chrome breaks copy-paste into agents.
  const promptRows = buildJudgementPrompt(findings);
  const lines = ['', rule('Agent prompt'), ''];
  lines.push(c('2', '  Copy the text below into your coding agent:'));
  lines.push('');
  for (const row of promptRows) {
    if (!row) {
      lines.push('');
      continue;
    }
    for (const part of wrapPlain(row, 72)) {
      lines.push(part);
    }
  }
  lines.push('');
  return lines;
}

export function renderHuman(findings, repo) {
  const lines = [];
  lines.push('');
  lines.push(`agent-pipx conformance ${EM} ${repo}`);
  lines.push(renderCheckedSummary());
  lines.push('');
  lines.push(...renderFindingLines(findings));
  lines.push('');
  lines.push(renderSummary(findings));
  lines.push('');
  return lines.join('\n');
}

export function renderJson(findings, repo) {
  const summary = { ...findings.summary(), suppressed: findings.suppressed || 0 };
  return JSON.stringify(
    { repo, summary, findings: findings.items },
    null,
    2,
  );
}

// SARIF 2.1.0 for GitHub code scanning. Passes are omitted; warn->warning, fail->error.
const SARIF_LEVEL = { [FAIL]: 'error', [WARN]: 'warning' };
export function renderSarif(findings, repo) {
  // The full catalogue ships in every run, not just the rules that fired: code scanning needs a
  // rule to exist to keep a dismissal attached to it when a later run stops reporting it.
  const rules = RULES.map((r) => ({
    id: r.id,
    name: r.id,
    shortDescription: { text: r.title },
    helpUri: helpUri(r.id),
    properties: { category: r.category },
  }));
  const indexOf = new Map(RULES.map((r, i) => [r.id, i]));

  const results = findings.items
    .filter((f) => f.severity !== PASS)
    .map((f) => {
      const result = {
        ruleId: f.id || `agent-pipx/${f.category.toLowerCase()}`,
        level: SARIF_LEVEL[f.severity],
        message: { text: f.message },
        locations: f.file
          ? [{ physicalLocation: { artifactLocation: { uri: f.file } } }]
          : [],
      };
      if (indexOf.has(f.id)) result.ruleIndex = indexOf.get(f.id);
      return result;
    });
  return JSON.stringify(
    {
      version: '2.1.0',
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      runs: [
        {
          tool: {
            driver: {
              name: 'agent-pipx',
              informationUri: 'https://github.com/kyizinlatt/agent-pipx',
              rules,
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  );
}

// Agent-facing CLI report: status + issues/fixes + passed summary + judgement + prompt.
export function renderReport(findings, repo) {
  const s = findings.summary();
  const action =
    s.fail > 0
      ? c('31', `Fix failures first ${EM} then re-run report for judgement.`)
      : s.warn > 0
        ? c('33', `Review Fix cards below ${EM} then run the agent prompt.`)
        : c('32', `Mechanical checks clean ${EM} still run the agent prompt for nuance.`);

  const lines = [];
  lines.push('');
  lines.push(c('1', 'agent-pipx report'));
  lines.push(c('2', repo));
  lines.push(renderCheckedSummary());
  lines.push('');
  lines.push(...renderStatusBanner(findings));
  lines.push(`  ${action}`);
  lines.push(...renderIssueCards(findings));
  lines.push(...renderPassedPanel(findings));
  lines.push(...renderJudgementPanel(findings));
  lines.push(...renderPromptPanel(findings));
  return lines.join('\n');
}
