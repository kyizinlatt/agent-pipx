// CLI dispatch for `agent-pipx`. Commands: check (default) | report | init | fix | upgrade.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Findings } from './findings.js';
import { checkSecrets } from './checks/secrets.js';
import { checkConfig } from './checks/config.js';
import { checkRules } from './checks/rules.js';
import { checkStyles } from './checks/styles.js';
import { checkEnvironment } from './checks/environment.js';
import { renderHuman, renderJson, renderReport, renderSarif } from './report.js';
import { CHECK_STEPS, createProgress } from './progress.js';
import { detectInstalledClis, exists, isDir } from './detect.js';
import { toolById } from '../adapters/tools.js';
import { doFix } from './fix.js';
import { doUpgrade } from './upgrade.js';
import { applyBaseline, writeBaselineFile, DEFAULT_BASELINE } from './baseline.js';
import { RULES } from './rules-registry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.dirname(HERE);

const HELP = `agent-pipx — audit a repo's AI-agent configuration against the AGENTS.md standard.

Usage:
  agent-pipx [check] [--path DIR] [--json] [--sarif] [--strict] [--baseline FILE]
                                               Run secrets/config/rules/styles/environment checks
  agent-pipx report [--path DIR]             status + fix cards + hybrid judgement/prompt
  agent-pipx fix [--yes] [--path DIR]        Safely remediate mechanical issues (dry-run without --yes)
  agent-pipx init [--tool ID] [--path DIR]   Scaffold AGENTS.md (SSOT) + a tool bridge
  agent-pipx baseline [--out FILE] [--yes]   Accept today's findings so CI gates on new ones only
  agent-pipx rules [--json]                  List every rule ID the checker can report
  agent-pipx upgrade [--yes]                 Query npm for a newer release (network); --yes installs -g
  agent-pipx --version | --help

Flags:
  --json     machine-readable findings
  --sarif    SARIF 2.1.0 output for GitHub code scanning
  --strict   treat warnings as failures (exit 2)
  --baseline accept-list of known findings to suppress (e.g. ${DEFAULT_BASELINE})
  --out      where the baseline command writes its accept-list
  --yes      apply fix/upgrade/baseline (otherwise dry-run)

Tools: claude, cursor, gemini, copilot, codex, kimi, antigravity, windsurf
Exit codes: 0 = pass, 1 = warnings, 2 = failures.`;

function parseArgs(argv) {
  const opts = {
    command: 'check', path: process.cwd(), json: false, sarif: false, strict: false,
    yes: false, tool: null, baseline: null, out: null,
  };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    opts.command = rest.shift();
  }
  while (rest.length) {
    const a = rest.shift();
    if (a === '--json') opts.json = true;
    else if (a === '--sarif') opts.sarif = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--path') {
      const next = rest.shift();
      if (!next || next.startsWith('-')) throw new Error('--path requires a directory argument');
      opts.path = path.resolve(next);
    } else if (a === '--baseline') {
      const next = rest.shift();
      if (!next || next.startsWith('-')) throw new Error('--baseline requires a file argument');
      opts.baseline = next;
    } else if (a === '--out') {
      const next = rest.shift();
      if (!next || next.startsWith('-')) throw new Error('--out requires a file argument');
      opts.out = next;
    } else if (a === '--tool') opts.tool = rest.shift();
    else if (a === '--version' || a === '-v') opts.command = 'version';
    else if (a === '--help' || a === '-h') opts.command = 'help';
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

const STEPS = [
  ['Secrets', checkSecrets],
  ['Config', checkConfig],
  ['Rules', checkRules],
  ['Styles', checkStyles],
  ['Environment', checkEnvironment],
];

/**
 * @param {string} repo
 * @param {{ onProgress?: { begin?: Function, start?: Function, done?: Function, end?: Function } }} [opts]
 */
export function runChecks(repo, opts = {}) {
  const progress = opts.onProgress || createProgress({ enabled: false });
  const findings = new Findings();
  const detail = Object.fromEntries(CHECK_STEPS.map((s) => [s.name, s.detail]));

  progress.begin?.(repo);
  for (const [name, fn] of STEPS) {
    progress.start?.(name, detail[name]);
    fn(repo, findings);
    progress.done?.(name);
  }
  progress.end?.();
  return findings;
}

// In --strict mode a warning is a failure: exit 2 whenever anything is not a clean pass.
function exitCode(findings, strict) {
  if (strict && findings.count('warn') > 0) return 2;
  return findings.exitCode();
}

export async function run(argv) {
  const opts = parseArgs(argv);

  if (opts.command === 'help') {
    console.log(HELP);
    return 0;
  }
  if (opts.command === 'version') {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    console.log(pkg.version);
    return 0;
  }
  if (opts.command === 'upgrade') {
    return doUpgrade({ apply: opts.yes });
  }
  if (opts.command === 'rules') {
    console.log(opts.json ? JSON.stringify(RULES, null, 2) : renderRuleTable());
    return 0;
  }

  const repo = path.resolve(opts.path);
  if (!exists(repo) || !isDir(repo)) throw new Error(`no such directory: ${repo}`);

  if (opts.command === 'init') return doInit(repo, opts.tool);
  if (opts.command === 'fix') return doFix(repo, { apply: opts.yes });

  if (opts.command !== 'check' && opts.command !== 'report' && opts.command !== 'baseline') {
    throw new Error(`unknown command: ${opts.command}`);
  }

  const machine = opts.json || opts.sarif;
  const showProgress = !machine && Boolean(process.stderr.isTTY) && !process.env.AGENT_PIPX_NO_PROGRESS;
  const findings = runChecks(repo, {
    onProgress: createProgress({ enabled: showProgress, stream: process.stderr }),
  });

  if (opts.command === 'baseline') {
    const res = writeBaselineFile(repo, findings, { out: opts.out, apply: opts.yes });
    if (!res.ok) {
      console.log(`${res.file} already exists — re-run with --yes to replace it (${res.count} current issue(s)).`);
      return 1;
    }
    console.log(`wrote ${res.file} — ${res.count} accepted finding(s); new ones still fail.`);
    console.log(`Use it with: agent-pipx check --baseline ${res.file}`);
    return 0;
  }

  // A baseline only ever removes known findings; it can never turn a new failure green.
  if (opts.baseline) applyBaseline(findings, path.resolve(repo, opts.baseline));

  if (opts.command === 'report') {
    console.log(renderReport(findings, repo));
  } else if (opts.sarif) {
    console.log(renderSarif(findings, repo));
  } else if (opts.json) {
    console.log(renderJson(findings, repo));
  } else {
    console.log(renderHuman(findings, repo));
  }
  return exitCode(findings, opts.strict);
}

// `agent-pipx rules` — the catalogue, so a finding ID in CI can be looked up without the source.
function renderRuleTable() {
  const width = Math.max(...RULES.map((r) => r.id.length));
  return RULES.map((r) => `${r.id.padEnd(width)}  ${r.category.padEnd(11)}  ${r.title}`).join('\n');
}

// Scaffold the SSOT and, for bridge tools, a thin adapter that references it. Never overwrites.
function doInit(repo, toolId) {
  const agents = path.join(repo, 'AGENTS.md');
  if (!exists(agents)) {
    const tmpl = fs.readFileSync(path.join(PKG_ROOT, 'templates', 'AGENTS.md'), 'utf8');
    fs.writeFileSync(agents, tmpl.replaceAll('{{PROJECT_NAME}}', path.basename(repo)));
    console.log('created AGENTS.md (single source of truth)');
  } else {
    console.log('AGENTS.md: kept existing');
  }

  // Which tools to bridge? Explicit --tool, else every installed agent CLI, else Claude.
  let ids;
  if (toolId) ids = [toolId];
  else {
    const installed = detectInstalledClis().map((i) => i.tool.id);
    ids = installed.length ? installed : ['claude'];
  }

  for (const id of ids) {
    const tool = toolById(id);
    if (!tool) {
      console.log(`skip unknown tool: ${id}`);
      continue;
    }
    if (tool.bridge === 'native') {
      console.log(`${tool.name}: reads AGENTS.md natively — no bridge file needed`);
      continue;
    }
    // import-or-symlink tools: which file to write, and the import it must contain, are
    // adapter facts (adapters/tools.js) — not something the CLI may guess per tool id.
    const { bridgeFile, importLine } = tool;
    if (!bridgeFile || !importLine) {
      console.log(`${tool.name}: adapter declares no bridge file — skipped`);
      continue;
    }
    const dest = path.join(repo, bridgeFile);
    if (exists(dest)) {
      console.log(`${bridgeFile}: kept existing`);
      continue;
    }
    fs.writeFileSync(dest, `${importLine}\n`);
    console.log(`created ${bridgeFile} → imports AGENTS.md (${tool.name})`);
  }
  return 0;
}
