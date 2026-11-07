# Claude Code harness (optional adapter)

A reusable, rule-governed environment for **Claude Code**. Any repository — any stack — can link
this harness and immediately run under the same guardrails, workflows, and orchestration.

This ships **inside the `agent-pipx` tool** as its optional Claude Code integration. The
`agent-pipx` checker itself is tool-neutral and works for any agent; this harness adds the
hooks, commands, and subagents that are specific to Claude Code.

## Layers

The harness is four layers. A project consumes the layers it needs.

1. **Rules** — the repo's `AGENTS.md` is the single source of truth. Claude Code reads it via a
   thin `CLAUDE.md` (`@AGENTS.md`). Nearest instructions win.
2. **Guardrails** — Claude Code hooks. A stack-agnostic **core** plus optional per-stack
   **packs**. Hooks block or warn on unsafe actions (secrets, forced pushes, forbidden patterns)
   at the moment they happen.
3. **Workflows** — reusable slash commands (`/ship`, `/handoff`, `/plan`, `/config-check`) that
   behave the same in every repo.
4. **Orchestration** — reusable subagents (`reviewer`, `test-runner`, `config-auditor`) plus
   conventions for multi-step autonomous work.

## Config checking

`/config-check` and the `config-auditor` subagent both drive the `agent-pipx` CLI:

```
npx agent-pipx check      # human summary + exit 0/1/2 (CI-ready)
npx agent-pipx report     # JSON findings + a judgement prompt for the agent
```

The CLI does the deterministic pass (adapters bridge to `AGENTS.md`, settings/hooks valid,
style + environment checks); the subagent adds the judgement calls a linter cannot.

## Repository layout

```
claude-harness/
├── README.md               # this file
├── core/                   # stack-agnostic
│   ├── hooks/              # guard-secrets, guard-push, check-hygiene
│   ├── commands/          # ship, handoff, plan, config-check
│   ├── agents/            # reusable subagents (reviewer, test-runner, config-auditor)
│   ├── skills/            # extension point (empty by default; structure audited by agent-pipx)
│   └── settings.json      # base permissions + hook wiring (template)
├── packs/
│   ├── web-ts/            # any/console.log/@ts-ignore, proxy.ts, tailwind v4
│   └── swiftui/           # print/try!/as!, Xcode-managed files
└── install-harness.sh      # per-project installer (link | vendor)
```

## Core vs pack — the split rule

A check belongs in **core** if it is true for essentially every repository regardless of
language: no secrets in commits, no force-push over shared history, no unsafe push while CI is in
flight. A check belongs in a **pack** if it names a language, framework, or file that only some
repos have: `any`/`@ts-ignore`/`console.log`, `proxy.ts` vs `middleware.ts`, Tailwind v4 config,
SwiftUI lifecycle. When in doubt, start in a pack; promote to core once a rule proves universal.

## Install modes

A project's committed `.claude/settings.json` references hooks by
`$CLAUDE_PROJECT_DIR/.claude/hooks/...`. That forces a choice about where those hook files live:

- **link mode** (default) — `install-harness.sh` symlinks the repo's `.claude/hooks`,
  `.claude/commands`, etc. back to this harness. One edit propagates to every linked repo.
- **vendor mode** (repos that must be self-contained: shared, CI-run, teammate clones) — the
  installer copies the harness in and writes a manifest recording which pack and version.
  `install-harness.sh <repo> --update` refreshes a vendored repo.

## Plugin route (Claude Code plugins)

`core`, `packs/web-ts` and `packs/swiftui` are also Claude Code plugin roots. Each
`.claude-plugin/plugin.json` wires the same hooks as that root's `settings.json`, with
`${CLAUDE_PLUGIN_ROOT}/hooks/…` in place of `$CLAUDE_PROJECT_DIR/.claude/hooks/…`, and
`test/harness-plugin.test.js` fails if the two drift apart. A marketplace serves a root with a
`git-subdir` source pinned to a commit:

```json
{ "name": "core",
  "source": { "source": "git-subdir", "url": "https://github.com/kyizinlatt/agent-pipx.git",
              "path": "claude-harness/core", "ref": "main", "sha": "<commit>" } }
```

- The manifests carry **no `version`**, so the pinned commit is the version. A fixed `version`
  makes `claude plugin update` ignore a new `sha`.
- Plugin commands are namespaced (`/core:ship`, `/core:handoff`), so they sit next to a repo's own
  `.claude/commands` rather than replacing them.
- A plugin cannot carry `permissions`. Keep the `settings.json` allow/deny lists in the repo.
- Use one route per repo. If a repo still wires vendored hooks while the plugin is enabled, each
  hook runs twice.

## Per-project flow

```
install-harness.sh <repo> --pack web-ts [--mode link|vendor]
```

The installer ensures `<repo>/.claude/` exists, wires core hooks/commands/skills/agents (plus the
chosen pack), merges a base `settings.json` (preserving existing entries), records a manifest, and
seeds a thin `AGENTS.md` + `PROGRESS.md` from `project-template/` if absent (never overwriting).

## Non-goals

- Not a replacement for a project's own `AGENTS.md` — the harness enforces and automates; the
  project declares its stack, domain rules, and release policy.
- Not tool-neutral machinery — hooks/commands/agents target Claude Code. The tool-neutral checker
  is the `agent-pipx` CLI one level up.
- Not a secret store, CI system, or deploy tool. It guards those actions; it does not perform them.
