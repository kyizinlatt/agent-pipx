// Stable rule IDs. A finding's message may be reworded at any time; its ID may not.
//
// The ID is what survives across releases: SARIF results carry it so GitHub code scanning can
// track (and dismiss) one rule over time, and `--baseline` fingerprints on it. That makes the
// registry an append-only ledger — IDs are never renumbered, never reused, and never deleted.
// A rule that goes away keeps its row with `retired: true` so an old baseline still reads.
//
// Blocks are per category (SEC/CFG/RUL/STY/ENV) with room to grow inside each.

export const RULE_DOC = 'https://github.com/kyizinlatt/agent-pipx#rule-ids';

export const RULES = [
  // ---- Secrets -------------------------------------------------------------------------
  { id: 'APX-SEC-001', category: 'Secrets', title: 'Credential committed in an agent config file' },
  { id: 'APX-SEC-002', category: 'Secrets', title: 'Literal credential in an MCP server definition' },

  // ---- Config: SSOT bridges ------------------------------------------------------------
  { id: 'APX-CFG-001', category: 'Config', title: 'No agent-tool configuration detected' },
  { id: 'APX-CFG-002', category: 'Config', title: 'Tool instruction file carries rules with no AGENTS.md SSOT' },
  { id: 'APX-CFG-003', category: 'Config', title: 'Bridge uses an import the tool cannot resolve' },
  { id: 'APX-CFG-004', category: 'Config', title: 'Bridge file present with no AGENTS.md to bridge to' },
  { id: 'APX-CFG-005', category: 'Config', title: 'Bridge imports AGENTS.md by absolute path' },
  { id: 'APX-CFG-006', category: 'Config', title: 'Bridge neither imports nor symlinks AGENTS.md (drift)' },
  { id: 'APX-CFG-007', category: 'Config', title: 'Cursor .mdc rule has no frontmatter' },
  { id: 'APX-CFG-008', category: 'Config', title: 'Plain .md in .cursor/rules is ignored by Cursor' },

  // ---- Config: Claude settings, hooks, MCP ---------------------------------------------
  { id: 'APX-CFG-009', category: 'Config', title: 'Config directory is a symlink outside the repo' },
  { id: 'APX-CFG-010', category: 'Config', title: 'MCP config file is not valid JSON' },
  { id: 'APX-CFG-011', category: 'Config', title: 'Dangling symlink under the tool config directory' },
  { id: 'APX-CFG-012', category: 'Config', title: 'Config directory exists but settings.json is missing' },
  { id: 'APX-CFG-013', category: 'Config', title: 'settings.json is not valid JSON' },
  { id: 'APX-CFG-014', category: 'Config', title: 'Hook script is missing' },
  { id: 'APX-CFG-015', category: 'Config', title: 'Hook script is not executable' },
  { id: 'APX-CFG-016', category: 'Config', title: 'Core harness hook is not wired' },

  // ---- Config: skills and commands -----------------------------------------------------
  { id: 'APX-CFG-017', category: 'Config', title: 'Skills directory is a symlink outside the repo' },
  { id: 'APX-CFG-018', category: 'Config', title: 'Dangling symlink in the skills directory' },
  { id: 'APX-CFG-019', category: 'Config', title: 'Skill directory has no SKILL.md' },
  { id: 'APX-CFG-020', category: 'Config', title: 'Skill has no YAML frontmatter' },
  { id: 'APX-CFG-021', category: 'Config', title: 'Skill frontmatter has no description' },
  { id: 'APX-CFG-022', category: 'Config', title: 'Skill name does not match its directory' },
  { id: 'APX-CFG-023', category: 'Config', title: 'Commands directory is a symlink outside the repo' },
  { id: 'APX-CFG-024', category: 'Config', title: 'Slash command has no YAML frontmatter' },
  { id: 'APX-CFG-025', category: 'Config', title: 'Slash command frontmatter has no description' },
  { id: 'APX-CFG-026', category: 'Config', title: 'Slash command allowed-tools is invalid' },
  { id: 'APX-CFG-027', category: 'Config', title: 'Slash command body is too long for an entry point' },
  { id: 'APX-CFG-028', category: 'Config', title: 'Local settings file is not gitignored' },
  { id: 'APX-CFG-029', category: 'Config', title: 'Always-on instructions long while skills exist' },

  { id: 'APX-CFG-036', category: 'Config', title: 'Copies of one skill have drifted apart' },
  { id: 'APX-CFG-037', category: 'Config', title: 'Two skills claim the same name' },
  { id: 'APX-CFG-038', category: 'Config', title: 'Slash command reads arguments with no argument-hint' },
  { id: 'APX-CFG-039', category: 'Config', title: 'File has more than one managed block' },

  // ---- Config: agent surface security --------------------------------------------------
  { id: 'APX-CFG-030', category: 'Config', title: 'MCP server runs an unpinned package spec' },
  { id: 'APX-CFG-031', category: 'Config', title: 'MCP server connects over plain http' },
  { id: 'APX-CFG-032', category: 'Config', title: 'Permission prompts disabled by default' },
  { id: 'APX-CFG-033', category: 'Config', title: 'Permission rule allows any shell command' },
  { id: 'APX-CFG-034', category: 'Config', title: 'Permission-skipping flag committed to the repo' },
  { id: 'APX-CFG-035', category: 'Config', title: 'Hook pipes downloaded content into a shell' },

  // ---- Rules: the AGENTS.md SSOT itself ------------------------------------------------
  { id: 'APX-RUL-001', category: 'Rules', title: 'Tool adapters present but no AGENTS.md' },
  { id: 'APX-RUL-002', category: 'Rules', title: 'No AGENTS.md — project rules undocumented' },
  { id: 'APX-RUL-003', category: 'Rules', title: 'AGENTS.md still has scaffold placeholders' },
  { id: 'APX-RUL-004', category: 'Rules', title: 'AGENTS.md has unfilled template stubs' },
  { id: 'APX-RUL-005', category: 'Rules', title: 'AGENTS.md is nearly empty' },
  { id: 'APX-RUL-006', category: 'Rules', title: 'AGENTS.md is missing recommended sections' },
  { id: 'APX-RUL-007', category: 'Rules', title: 'AGENTS.md layout paths do not exist' },
  { id: 'APX-RUL-008', category: 'Rules', title: 'AGENTS.md is oversized for reliable adherence' },
  { id: 'APX-RUL-009', category: 'Rules', title: 'AGENTS.md has empty sections' },

  // ---- Rules: does AGENTS.md still describe this repo? ---------------------------------
  { id: 'APX-RUL-018', category: 'Rules', title: 'Documented command does not resolve' },
  { id: 'APX-RUL-019', category: 'Rules', title: 'Documented package manager is not the one in use' },
  { id: 'APX-RUL-020', category: 'Rules', title: 'Dependency claim contradicted by package.json' },
  { id: 'APX-RUL-021', category: 'Rules', title: 'Boundary path does not exist' },

  // ---- Rules: tracked-findings / progress / plan discipline ----------------------------
  { id: 'APX-RUL-010', category: 'Rules', title: 'Tracked-findings section is missing role signals' },
  { id: 'APX-RUL-011', category: 'Rules', title: 'Progress log present without documented ledger roles' },
  { id: 'APX-RUL-012', category: 'Rules', title: 'Progress log has grown past scannable size' },
  { id: 'APX-RUL-013', category: 'Rules', title: 'Progress log referenced but not found' },
  { id: 'APX-RUL-014', category: 'Rules', title: 'Findings document referenced but not found' },
  { id: 'APX-RUL-015', category: 'Rules', title: 'Plan workflow described but no plan directory' },
  { id: 'APX-RUL-016', category: 'Rules', title: 'Plan directory is fragmented by topic' },
  { id: 'APX-RUL-017', category: 'Rules', title: 'Plan sections lack stable IDs or exit gates' },

  // ---- Styles --------------------------------------------------------------------------
  { id: 'APX-STY-001', category: 'Styles', title: 'Stray console logging outside tests' },
  { id: 'APX-STY-002', category: 'Styles', title: 'Untyped escape hatch outside tests' },
  { id: 'APX-STY-003', category: 'Styles', title: 'Type-check suppression outside tests' },
  { id: 'APX-STY-004', category: 'Styles', title: 'Force-try outside tests' },
  { id: 'APX-STY-005', category: 'Styles', title: 'Force-cast outside tests' },
  { id: 'APX-STY-006', category: 'Styles', title: 'Direct print call outside tests' },

  // ---- Environment ---------------------------------------------------------------------
  { id: 'APX-ENV-001', category: 'Environment', title: 'git is not on PATH' },
  { id: 'APX-ENV-002', category: 'Environment', title: 'node is not on PATH' },
  { id: 'APX-ENV-003', category: 'Environment', title: 'Declared package manager is not on PATH' },
  { id: 'APX-ENV-004', category: 'Environment', title: 'No lockfile — dependency versions unpinned' },
  { id: 'APX-ENV-005', category: 'Environment', title: 'Swift toolchain not on PATH' },
  { id: 'APX-ENV-006', category: 'Environment', title: 'No CI or pre-commit quality gate' },
];

const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export const ruleById = (id) => BY_ID.get(id) || null;
// One documented section for the whole catalogue — `agent-pipx rules` prints the live table.
export const helpUri = () => RULE_DOC;
