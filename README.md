# agent-pipx

[![npm](https://img.shields.io/npm/v/agent-pipx)](https://www.npmjs.com/package/agent-pipx)
[![CI](https://github.com/kyizinlatt/agent-pipx/actions/workflows/ci.yml/badge.svg)](https://github.com/kyizinlatt/agent-pipx/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/agent-pipx)](https://www.npmjs.com/package/agent-pipx)
[![License](https://img.shields.io/npm/l/agent-pipx)](LICENSE)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](package.json)

<img width="1200" height="900" alt="agent-pipx — AGENTS.md config audit" src="https://raw.githubusercontent.com/kyizinlatt/agent-pipx/main/assets/agent-pipx-cover.png" />

Zero-dependency Node CLI that audits a repository's AI-agent configuration — config, rules,
styles, environment — against the [`AGENTS.md`](https://agents.md) standard, for any coding agent.

```sh
npx agent-pipx
```

No API key. `check` / `report` / `init` / `fix` run offline; only `upgrade` talks to npm.

## Why

Every agent tool has its own instruction files (`CLAUDE.md`, `GEMINI.md`, `.cursor/rules/`, …),
but they should express **one** set of rules. `AGENTS.md` is the cross-tool single source of truth
(Linux Foundation Agentic AI Foundation). Most tools read it natively; Claude Code bridges via a
thin `CLAUDE.md` (`@AGENTS.md` or symlink).

`agent-pipx` verifies that SSOT and those bridges — and, when present, skills, commands, settings,
and handoff protocol — so adapters do not drift into a second conflicting copy.

Findings: **fail** = mechanically broken · **warn** = judgement needed · **pass** = verified.
Exit codes `0` / `1` / `2` stay stable for CI.

## Install

```sh
npm install -g agent-pipx
npx agent-pipx
```

Node ≥ 18.

## Usage

```sh
agent-pipx                 # check (progress + summary; exit 0/1/2)
agent-pipx check --json    # machine-readable findings
agent-pipx check --sarif   # SARIF 2.1.0 (GitHub code scanning)
agent-pipx check --strict  # warnings → exit 2
agent-pipx report          # status + fix cards + judgement prompt
agent-pipx fix             # dry-run remediations; `--yes` applies (*.bak)
agent-pipx init            # scaffold AGENTS.md + bridge for detected / `--tool`
agent-pipx init --tool claude
agent-pipx baseline        # accept today's findings; `--yes` replaces an existing file
agent-pipx rules           # the rule catalogue (`--json` for the raw table)
agent-pipx upgrade         # npm version check; `--yes` installs -g
```

### Rule IDs

Every warning and failure carries a stable ID — `APX-CFG-006`, `APX-RUL-007` — listed by
`agent-pipx rules`. Messages get reworded between releases; IDs do not, so SARIF results stay
attached to the same rule in GitHub code scanning and dismissals survive an upgrade. IDs are
append-only: never renumbered, never reused.

### Baselines

Adopting a checker on an established repo usually means fixing everything on day one or leaving
the gate off. Instead, record what is already there and gate on what is new:

```sh
agent-pipx baseline                                  # writes .agent-pipx-baseline.json
agent-pipx check --baseline .agent-pipx-baseline.json
```

A baseline matches on rule ID + file, never on the message, so rewording a finding does not
silently un-accept it. Accepted findings are still counted in the summary (`N baselined`) — they
are acknowledged, not hidden — and a new finding still exits non-zero.

## What it checks

| Category | Checks |
|---|---|
| **Secrets** | Committed instruction/config files for credentials (AWS / GitHub / Slack / Google / AI keys, private keys). Type + line only — never the secret value. |
| **Config** | Adapters bridge to `AGENTS.md` (import or symlink). Gemini must not use `@~/…`. Cursor `.mdc` needs frontmatter. `.claude/settings.json` + hooks valid. When present: `SKILL.md` / slash-command frontmatter; `.claude/settings.local.json` gitignored; soft layering warn if AGENTS.md is long while skills exist. |
| **Extensions** | Skills copied between `.claude/skills` and `.agents/skills` that have drifted apart, two skills claiming one `name:`, and slash commands that read `$ARGUMENTS` without an `argument-hint`. |
| **Security** | MCP servers: unpinned package runners, plain-http endpoints, literal credentials in `env` / `headers` (key name only, never the value). Permissions: bypass mode as the default, unbounded `Bash(*)` rules, a committed `--dangerously-skip-permissions`, hooks that pipe a download into a shell. |
| **Rules** | `AGENTS.md` present (fail if adapters exist without it), no placeholders/stubs, lean (~200 lines), recommended signals: Commands, **Repository layout**, boundaries, sensitive-data. Tracked-findings / Progress / plan claims get protocol-hygiene warns when incomplete. |
| **Claims** | What `AGENTS.md` says, checked against the repo: documented commands resolve to a real script / make target / file, the stated package manager matches the lockfile, a "zero dependencies" rule matches `package.json`, and layout and boundary paths still exist. Both sides must be explicit — no claim, no finding. |
| **Styles** | Stack antipatterns (TS `any` / `console.log` / `@ts-ignore`; Swift `try!` / `as!` / `print`). Advisory. |
| **Environment** | Agent CLIs on `PATH`; lockfile matches package manager; CI or pre-commit gate. |

Tools: Claude Code, Cursor, Gemini, Copilot, Codex, Kimi, Antigravity, Windsurf. Per-tool facts
live in [`adapters/tools.js`](adapters/tools.js) (official docs cited) — checks never hard-code
tool conventions elsewhere. Entries require a real adapter path or bridge rule, not a marketing
supported-agents list.

### Managed blocks

`init` never edits a file that already exists, so a `CLAUDE.md` carrying its own rules used to be
a manual fix. `agent-pipx fix` now appends a marked block instead:

```markdown
<!-- agent-pipx:begin -->
@AGENTS.md
<!-- agent-pipx:end -->
```

Everything outside the markers is left byte-for-byte as written, the original is backed up to
`*.bak`, and re-running adds nothing — the block is already there.

## The AGENTS.md model

```
AGENTS.md  ← single source of truth
├── CLAUDE.md / .claude/CLAUDE.md  →  @AGENTS.md
├── GEMINI.md                      →  @./AGENTS.md  (never @~/…)
├── .cursor/rules/*.mdc            →  optional scoped rules
├── .agents/rules/                 →  optional scoped rules
├── .claude/skills/*/SKILL.md      →  on-demand (structure checked if present)
├── .cursor/skills/ · .agents/skills/
└── Codex / Kimi / Copilot / …     →  read AGENTS.md natively
```

`init` scaffolds Project / Stack / **Repository layout** / Commands / Rules / Tracked findings /
Boundaries / Sensitive data. Tracked findings: ledger = status; Progress = chronological evidence;
`CODE_COMPLETE` ≠ `CLOSED` without exit-gate evidence. The checker warns on incomplete claims — it
does not invent or close findings.

## Claude Code harness (optional)

[`claude-harness/`](claude-harness/) is Claude-only (hooks, `/ship` `/plan` `/handoff`
`/config-check`, subagents). Keep tool-neutral logic in `src/`. `/config-check` runs this CLI then
adds judgement. `/ship` follows `AGENTS.md` branch policy, or current branch only — never invents a
merge. See [claude-harness/README.md](claude-harness/README.md).

## Privacy & safety

Enforced by `test/safety.test.js`:

| Guarantee | Detail |
|---|---|
| **Offline by default** | `check` / `report` / `init` / `fix` — zero network; zero runtime deps |
| **Opt-in network** | `upgrade` only (`npm view`; `--yes` may `npm install -g`) |
| **No silent shell** | Offline commands do not spawn a shell; CLIs via `PATH` scan |
| **Read-only audit** | `check` / `report` never write files |
| **Explicit writes** | `init` creates missing files; `fix` only with `--yes` (+ `*.bak`) |
| **No content leaks** | Findings: counts, paths, messages — not file contents |

See [SECURITY.md](SECURITY.md).

## Contributing

Fork → branch → PR against `main`. Maintainers review; `main` is protected (`Test / Node 22`
must pass). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[LICENSE](LICENSE) (Apache-2.0).
