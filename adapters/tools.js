// Per-tool configuration conventions — the single authority the checker reasons from.
//
// Every entry is grounded in the tool's OFFICIAL docs (see links). The pivotal fact: AGENTS.md
// is the cross-tool single source of truth (formalized Aug 2025; Linux Foundation Agentic AI
// Foundation since Dec 2025). Most tools read AGENTS.md natively; Claude Code is the holdout that
// reads CLAUDE.md and must BRIDGE to AGENTS.md via an `@AGENTS.md` import or a symlink.
//
// Only tools with real adapter paths and/or bridge rules belong here — not every name that
// appears on a supported-agents marketing list. Native AGENTS.md readers with no projectFiles
// still work when AGENTS.md exists; they need an entry only when we detect a CLI or adapter.
//
// bridge:
//   'native'             → tool reads AGENTS.md directly; the SSOT being present is sufficient.
//   'import-or-symlink'  → tool reads its own file, which must reference AGENTS.md (no duplication).
//                          Such a tool also declares bridgeFile (the adapter `init` scaffolds) and
//                          importLine (the exact import that tool resolves). Never hard-code either
//                          in the CLI — a new bridge tool must work from this table alone.
//
// projectFiles lists tool-SPECIFIC adapter paths only — never AGENTS.md itself. Presence of the
// SSOT is handled by rules.js / checkConfig separately so we don't pretend every native reader
// is "configured" just because AGENTS.md exists.

export const SSOT = 'AGENTS.md';

export const TOOLS = [
  {
    id: 'claude',
    name: 'Claude Code',
    cli: ['claude'],
    // Claude reads CLAUDE.md, NOT AGENTS.md — docs: https://code.claude.com/docs/en/memory
    projectFiles: ['CLAUDE.md', '.claude/CLAUDE.md'],
    settings: '.claude/settings.json',
    // Project-scoped MCP servers — docs: https://code.claude.com/docs/en/mcp
    mcpFile: '.mcp.json',
    // Permission model — docs: https://code.claude.com/docs/en/iam
    permissions: {
      bypassMode: 'bypassPermissions', // defaultMode that stops asking before every tool call
      shellTool: 'Bash', // rule prefix for shell commands, e.g. Bash(npm run test:*)
      skipFlag: '--dangerously-skip-permissions',
    },
    // Skills + slash commands — docs: https://code.claude.com/docs/en/skills
    // and https://code.claude.com/docs/en/slash-commands
    skillsDirs: ['.claude/skills'],
    commandsDir: '.claude/commands',
    skillFile: 'SKILL.md',
    skillFrontmatter: ['name', 'description'],
    readsAgentsMd: false,
    bridge: 'import-or-symlink',
    bridgeFile: 'CLAUDE.md',
    importLine: '@AGENTS.md', // Claude resolves a bare repo-relative import
    importSupportsTilde: true, // Claude's @import expands ~ and absolute paths (depth 4)
    globalPaths: ['~/.claude/CLAUDE.md'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    cli: ['cursor-agent'],
    // Reads AGENTS.md natively AND .cursor/rules/*.mdc — docs: https://cursor.com/docs/context/rules
    projectFiles: ['.cursor/rules'],
    rulesDir: '.cursor/rules',
    rulesExt: '.mdc', // plain .md in this dir is IGNORED by Cursor
    rulesFrontmatter: ['description', 'globs', 'alwaysApply'],
    // MCP servers — docs: https://cursor.com/docs/context/mcp
    mcpFile: '.cursor/mcp.json',
    // Agent Skills — docs: https://cursor.com/docs/skills
    skillsDirs: ['.cursor/skills', '.agents/skills'],
    skillFile: 'SKILL.md',
    skillFrontmatter: ['name', 'description'],
    readsAgentsMd: true,
    bridge: 'native',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    cli: ['gemini'],
    projectFiles: ['GEMINI.md'],
    readsAgentsMd: true, // via the AGENTS.md standard
    bridge: 'import-or-symlink',
    bridgeFile: 'GEMINI.md',
    importLine: '@./AGENTS.md', // Gemini's import needs the explicit ./ prefix
    importSupportsTilde: false, // Gemini's memory @import resolves relative/absolute only — NOT ~
    globalPaths: ['~/.gemini/GEMINI.md'],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    cli: ['copilot'],
    projectFiles: ['.github/copilot-instructions.md'],
    // MCP servers are configured in the VS Code workspace file — docs:
    // https://code.visualstudio.com/docs/copilot/chat/mcp-servers
    mcpFile: '.vscode/mcp.json',
    readsAgentsMd: true,
    bridge: 'native',
    globalPaths: ['~/.copilot/copilot-instructions.md'],
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    cli: ['codex'],
    projectFiles: [], // AGENTS.md alone; no tool-specific adapter
    readsAgentsMd: true,
    bridge: 'native',
    globalPaths: ['~/.codex/AGENTS.md'],
  },
  {
    id: 'kimi',
    name: 'Kimi Code',
    cli: ['kimi'],
    // Reads AGENTS.md + .kimi/AGENTS.md (merged root→cwd)
    projectFiles: ['.kimi/AGENTS.md'],
    readsAgentsMd: true,
    bridge: 'native',
    globalPaths: ['~/.kimi-code/AGENTS.md', '~/.agents/AGENTS.md'],
  },
  {
    id: 'antigravity',
    name: 'Google Antigravity',
    cli: [],
    // AGENTS.md support since v1.20.3; workspace rules in .agents/rules/
    projectFiles: ['.agents/rules'],
    rulesDir: '.agents/rules',
    // Shared Agent Skills location also used by Cursor — docs: https://cursor.com/docs/skills
    skillsDirs: ['.agents/skills'],
    skillFile: 'SKILL.md',
    skillFrontmatter: ['name', 'description'],
    readsAgentsMd: true,
    bridge: 'native',
    globalPaths: ['~/.gemini/AGENTS.md', '~/.gemini/GEMINI.md'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    cli: ['windsurf'],
    projectFiles: ['.windsurf/rules', '.windsurfrules'],
    rulesDir: '.windsurf/rules',
    readsAgentsMd: true,
    bridge: 'native',
  },
];

// Lookup helpers.
export const toolById = (id) => TOOLS.find((t) => t.id === id);

// Every per-tool MCP config path. One list, so the secrets scan and the config audit can never
// disagree about which files describe MCP servers.
export const mcpConfigFiles = () => TOOLS.map((t) => t.mcpFile).filter(Boolean);
