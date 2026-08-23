# agent-pipx

> This file is the single source of truth for AI coding agents working on this repo. Every tool
> (Codex, Cursor, Gemini, Kimi, Antigravity) reads it directly; Claude Code reads it via a
> `CLAUDE.md` that imports it. It also dogfoods the tool this repo builds.

## Project

`agent-pipx` — a zero-dependency Node CLI that audits a repository's AI-agent configuration
(config, rules, styles, environment) against the `AGENTS.md` standard, for any coding agent.
Package manager: npm.

## Stack

- Node.js ≥ 18, ES modules (`"type": "module"`)
- **No runtime dependencies** — Node built-ins only (`fs`, `path`, `child_process`, `node:test`)

## Repository layout

- `bin/agent-pipx.js` → `src/cli.js` (CLI entry)
- `src/checks/` — Secrets / Config / Rules / Styles / Environment (+ protocol, extensions, claims,
  security)
- `src/rules-registry.js` — the append-only rule-ID catalogue every warn/fail cites
- `adapters/tools.js` — per-tool conventions (docs-cited; single authority)
- `templates/` — `init` scaffolds; `project-template/` — harness seed files
- `claude-harness/` — optional Claude Code-only hooks, commands, agents
- `test/` — synthetic-repo tests (`node --test`)
- `assets/` — README cover art (not packaged to npm)

## Commands

- Run: `node bin/agent-pipx.js check` (or `report`, `init`)
- Test: `node --test`
- Package dry-run: `npm pack --dry-run`

## Rules

- Keep runtime dependencies at **zero** — reach for a Node built-in before ever adding a package.
- `adapters/tools.js` is the authority for every per-tool convention; each entry must cite the
  tool's official docs. Update it here, never hard-code tool facts in the checks.
- Findings are advisory data, not enforcement: `fail` = mechanically broken, `warn` = judgement
  needed, `pass` = verified. Exit codes 0/1/2 must stay stable (CI depends on them).
- Every warn/fail cites a rule ID from `src/rules-registry.js`, and the registry is append-only:
  never renumber, reuse, or delete an ID — a baseline and a code-scanning dismissal both key on it.
  A new rule ships as a `warn`; promoting one to `fail` breaks existing CI and waits for a major.
- Every new check needs a test in `test/` that builds a synthetic repo and asserts the finding.
- Never commit anything private (personal names, machine paths, private repo names) — this repo
  is public. Run the grep gate before shipping.

## Tracked findings (when this repository has audits or reviews)

- Keep stable finding IDs and one current remediation ledger in the finding document. The ledger is
  current status authority; treat progress or changelog files as chronological evidence, not status.
- Explicit states help handoffs: `OPEN`, `IN_PROGRESS`, `CODE_COMPLETE`, `PRODUCTION_PENDING`,
  `CLOSED`, `BLOCKED_DECISION`, `ACCEPTED_RISK`, `SUPERSEDED`. Distinguish `CODE_COMPLETE` /
  `PRODUCTION_PENDING` from `CLOSED`; close only after every applicable acceptance test and
  live/external exit gate has evidence.
- Check the ledger and current implementation before starting. Update the ledger with the fix, and
  never silently redo a closed finding—reopen it with contradictory evidence.
- Accepted risks need an owner, decision date, compensating controls, and review/expiry date.
- Optional: if this repo keeps a durable plan, use one live plan file plus one lifecycle archive
  (shipped index). Every tracked section needs a stable ID and an exit gate; "shipped" means that
  gate has evidence — code green or a progress entry alone is not enough.

## Boundaries (do not touch)

- Do not add runtime or dev dependencies — Node built-ins only.
- `claude-harness/` is the Claude Code-only adapter; keep the tool-neutral checker (`src/`) free
  of tool-specific machinery.

## Sensitive data

- This repo is public: never commit secrets, credentials, tokens, or `.env` contents. Keep the
  tool's output free of file contents — report counts, paths, and messages only.
