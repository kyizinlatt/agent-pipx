// Map warn/fail findings to concrete remediation steps for the report UI.
// Prefer the stable rule ID; fall back to message patterns for rules that predate the registry.
// Keep tips short and actionable.
import { FAIL, WARN } from './findings.js';

const TIPS_BY_ID = {
  'APX-SEC-002': 'Move the value into your environment and reference it (`"${VAR_NAME}"`), then rotate the committed credential.',
  'APX-CFG-030': 'Pin the MCP server to a released version (`package@1.2.3`) so a new publish cannot change what runs.',
  'APX-CFG-031': 'Use the https endpoint, or keep the server on localhost — plain http exposes the token in transit.',
  'APX-CFG-032': 'Remove `defaultMode` (or set an asking mode) and grant specific tools instead of disabling every prompt.',
  'APX-CFG-033': 'Replace the wildcard with the commands you actually run, e.g. `Bash(npm run test:*)`.',
  'APX-CFG-034': 'Drop the flag from the committed file. If a CI job genuinely needs it, scope it to that job and say why.',
  'APX-RUL-018': 'Rename the command in AGENTS.md to the script that exists, or restore the script — an agent copies this line verbatim.',
  'APX-RUL-019': 'Update AGENTS.md to the package manager the lockfile proves, or switch the repo and delete the stale lockfile.',
  'APX-RUL-020': 'Either drop the dependency or drop the claim — a rule the repo already breaks trains agents to ignore the file.',
  'APX-RUL-021': 'Point the boundary at the path that exists now, or remove the rule if the directory is gone.',
  'APX-CFG-035': 'Vendor the script into the repo (reviewable, pinned) and run it from there instead of piping a URL into a shell.',
};

const TIPS = [
  {
    re: /possible .+ committed/i,
    tip: 'Rotate the credential immediately, remove it from the file (and git history if committed), then re-run check.',
  },
  {
    re: /core hook .+ not wired/i,
    tip: 'Re-run the harness installer (`claude-harness/install-harness.sh`) so the core hooks are wired in Claude settings.',
  },
  {
    re: /settings\.json is missing/i,
    tip: 'Add Claude settings under `.claude/` (or remove an unused `.claude/` dir). Optional: `claude-harness/install-harness.sh`.',
  },
  {
    re: /settings\.json is not valid JSON/i,
    tip: 'Fix syntax in Claude settings under `.claude/` (no trailing commas, comments, or unquoted keys).',
  },
  {
    re: /dangling symlink/i,
    tip: 'Repair or remove the broken symlink so the target exists, or re-run the harness installer.',
  },
  {
    re: /hook script missing|hook script not executable/i,
    tip: 'Restore the missing hook file and `chmod +x` it, or re-run `claude-harness/install-harness.sh`.',
  },
  {
    re: /@~\/|cannot resolve.*~ expansion/i,
    tip: 'Run `agent-pipx fix` (dry-run) then `agent-pipx fix --yes` to rewrite `@~/…` → `@./AGENTS.md`, or symlink GEMINI.md → AGENTS.md.',
  },
  {
    re: /may be duplicated and drift/i,
    tip: 'Replace the adapter body with a one-line `@AGENTS.md` (or `@./AGENTS.md` for Gemini) import, or symlink it to AGENTS.md.',
  },
  {
    re: /plain \.md in \.cursor\/rules|Cursor ignores it/i,
    tip: 'Rename to `.mdc` and add YAML frontmatter (`description`, `globs` / `alwaysApply`).',
  },
  {
    re: /\.mdc rule with no frontmatter/i,
    tip: 'Add a YAML frontmatter block at the top of the `.mdc` file with `description` and `globs` or `alwaysApply`.',
  },
  {
    re: /no AGENTS\.md|no single source of truth|project rules are undocumented/i,
    tip: 'Run `agent-pipx init` to scaffold AGENTS.md (and a Claude/Gemini bridge if needed).',
  },
  {
    re: /PLACEHOLDER|unfilled template stubs|nearly empty/i,
    tip: 'Replace template stubs in AGENTS.md with real project rules, commands, and boundaries.',
  },
  {
    re: /layout paths not found in the repo/i,
    tip: 'Fix stale paths in the Repository layout section, or restore the missing directories/files on disk.',
  },
  {
    re: /missing recommended section/i,
    tip: 'Add short Commands, Repository layout, Boundaries (do not touch), and Sensitive data sections to AGENTS.md.',
  },
  {
    re: /tracked-findings section is missing recommended signal/i,
    tip: 'Restore ledger-vs-progress roles, code≠CLOSED, exit-gate, and accepted-risk signals in the Tracked findings section.',
  },
  {
    re: /ledger-vs-progress roles|treat Progress as status/i,
    tip: 'Document in AGENTS.md that the remediation ledger owns status and Progress/changelog is chronological evidence only.',
  },
  {
    re: /references a progress log but no PROGRESS/i,
    tip: 'Add a PROGRESS.md (or adjust AGENTS.md so it does not claim a progress log that does not exist).',
  },
  {
    re: /add an archive\/rotation note/i,
    tip: 'Rotate old Progress entries into an archive file, or document the rotation rule in the progress log header.',
  },
  {
    re: /findings\/review document but none/i,
    tip: 'Add the review/audit document with a remediation ledger, or remove the stale path from AGENTS.md.',
  },
  {
    re: /durable plan\/archive workflow but no plan directory|missing .+ on tracked sections|one live plan \+ one lifecycle archive/i,
    tip: 'Keep one live plan + one lifecycle archive; give each tracked section a stable ID and an exit gate.',
  },
  {
    re: /skill directory missing/i,
    tip: 'Add SKILL.md with YAML frontmatter (`description`, and `name` matching the directory) inside the skill folder.',
  },
  {
    re: /has no YAML frontmatter|frontmatter is missing a non-empty description|frontmatter name .+ does not match/i,
    tip: 'Add YAML frontmatter with a non-empty description; if `name` is set, it must match the parent directory.',
  },
  {
    re: /slash commands should stay thin entry points/i,
    tip: 'Keep the command as a thin entry point; move methodology into a skill or AGENTS.md.',
  },
  {
    re: /settings\.local\.json is not covered by \.gitignore/i,
    tip: 'Add `settings.local.json` (or `.claude/settings.local.json`) to `.gitignore` so local Claude settings are not committed.',
  },
  {
    re: /move on-demand workflows into skills/i,
    tip: 'Trim always-on AGENTS.md; put task-specific workflows in skills so they load only when relevant.',
  },
  {
    re: /empty section/i,
    tip: 'Fill each empty heading in AGENTS.md with real guidance, or delete the unused heading.',
  },
  {
    re: /lines — agent adherence drops|oversize|split into scoped/i,
    tip: 'Trim AGENTS.md toward ~200 lines; move scoped detail into `.cursor/rules/*.mdc` or similar.',
  },
  {
    re: /console\.log\/debug\/info/i,
    tip: 'Remove debug `console.log`/`debug`/`info` from non-test code, or route through a shared logger module.',
  },
  {
    re: /use\(s\) of `any`/i,
    tip: 'Replace `any` with a concrete type, `unknown` + narrowing, or a shared domain type.',
  },
  {
    re: new RegExp('@ts-' + '(ignore|nocheck)', 'i'),
    tip: 'Remove the suppressions and fix the underlying type error, or isolate them behind a typed boundary.',
  },
  {
    re: /force-try|force-cast|print\(\) call/i,
    tip: 'Replace force-try/force-cast with typed error handling; swap `print` for a logger in non-test Swift.',
  },
  {
    re: /no lockfile/i,
    tip: 'Commit the lockfile for your package manager (`pnpm install` / `npm install` / `yarn`) so dependency versions stay pinned.',
  },
  {
    re: /no CI workflow or pre-commit/i,
    tip: 'Add a CI workflow under `.github/workflows/` (or pre-commit / husky / lefthook) that runs tests.',
  },
  {
    re: /git not on PATH/i,
    tip: 'Install git and ensure it is on PATH.',
  },
  {
    re: /node not on PATH/i,
    tip: 'Install Node.js ≥ 18 and ensure `node` is on PATH.',
  },
  {
    re: /pnpm-lock\.yaml present but pnpm not/i,
    tip: 'Install pnpm (`corepack enable` or `npm i -g pnpm`) to match the lockfile.',
  },
  {
    re: /Swift sources present but neither swift nor xcodebuild/i,
    tip: 'Install Xcode / Swift toolchain, or run checks on a machine that has them.',
  },
  {
    re: /not valid JSON/i,
    tip: 'Fix the JSON syntax in the reported file and re-run check.',
  },
];

/** @returns {string|null} remediation tip, or null if none matched */
export function tipForFinding(finding) {
  if (finding.severity !== WARN && finding.severity !== FAIL) return null;
  if (finding.id && TIPS_BY_ID[finding.id]) return TIPS_BY_ID[finding.id];
  for (const { re, tip } of TIPS) {
    if (re.test(finding.message)) return tip;
  }
  return 'Review the finding, fix the underlying config/source, then re-run `agent-pipx check`.';
}

/** Pair each warn/fail with its tip (stable order: fails first, then warns). */
export function remediationsFor(findings) {
  const order = { [FAIL]: 0, [WARN]: 1 };
  return findings.items
    .filter((f) => f.severity === FAIL || f.severity === WARN)
    .sort((a, b) => order[a.severity] - order[b.severity] || a.category.localeCompare(b.category))
    .map((f) => ({ finding: f, tip: tipForFinding(f) }));
}
