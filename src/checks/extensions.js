// Extension-surface checks: skills/, commands/, and local settings gitignore hygiene.
// Conventions come from adapters/tools.js (official docs cited there) — never hard-code tool facts.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TOOLS } from '../../adapters/tools.js';
import { isDir, isFile, isInsideRepo, isSymlink, readText } from '../detect.js';
import { agentsMdPath } from '../ssot.js';

const COMMAND_BODY_WARN_LINES = 40;

/**
 * @param {string} repo
 * @param {import('../findings.js').Findings} findings
 */
export function checkExtensions(repo, findings) {
  const seenSkillRoots = new Set();
  const seenCommandRoots = new Set();
  const skills = [];

  for (const tool of TOOLS) {
    for (const rel of tool.skillsDirs || []) {
      if (seenSkillRoots.has(rel)) continue;
      seenSkillRoots.add(rel);
      checkSkillsDir(repo, rel, tool, findings, skills);
    }
    if (tool.commandsDir && !seenCommandRoots.has(tool.commandsDir)) {
      seenCommandRoots.add(tool.commandsDir);
      checkCommandsDir(repo, tool.commandsDir, tool, findings);
    }
  }

  checkSkillCollisions(skills, findings);
  checkLocalSettingsGitignore(repo, findings);
  checkSoftLayering(repo, findings);
}

/**
 * Skills live in more than one directory (a tool-specific one and the shared `.agents/skills`),
 * so the same skill gets copied. Copies drift, and two skills claiming one name make it luck
 * which the agent loads. Both are invisible until an agent behaves differently in one tool.
 * @param {{folder: string, rel: string, name: string|null, hash: string}[]} skills
 */
function checkSkillCollisions(skills, findings) {
  const byFolder = new Map();
  for (const s of skills) {
    if (!byFolder.has(s.folder)) byFolder.set(s.folder, []);
    byFolder.get(s.folder).push(s);
  }
  for (const [folder, copies] of byFolder) {
    if (copies.length < 2) continue;
    const hashes = new Set(copies.map((c) => c.hash));
    if (hashes.size > 1) {
      findings.warn(
        'Config',
        `skill "${folder}" exists in ${copies.length} directories with different content (${copies.map((c) => c.rel).join(', ')}) — the copies have drifted`,
        copies[0].rel,
        'APX-CFG-036',
      );
    } else {
      findings.pass('Config', `skill "${folder}" is mirrored identically across ${copies.length} directories`, copies[0].rel);
    }
  }

  const byName = new Map();
  for (const s of skills) {
    if (!s.name) continue;
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }
  for (const [name, claimants] of byName) {
    const folders = new Set(claimants.map((c) => c.folder));
    if (folders.size < 2) continue;
    findings.warn(
      'Config',
      `skill name "${name}" is claimed by ${folders.size} different skills (${claimants.map((c) => c.rel).join(', ')}) — which one loads is not defined`,
      claimants[0].rel,
      'APX-CFG-037',
    );
  }
}

function checkSkillsDir(repo, relDir, tool, findings, skills = []) {
  const dir = path.join(repo, relDir);
  if (!isDir(dir)) return;
  if (isSymlink(dir) && !isInsideRepo(repo, dir)) {
    findings.warn('Config', `${relDir}/ is a symlink outside the repo — skipping skills checks (CWE-59)`, relDir, 'APX-CFG-017');
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const skillFile = tool.skillFile || 'SKILL.md';
  let checked = 0;
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    // Symlink dirs: still check they resolve; treat as skill folders when they are directories.
    let isDirectory = e.isDirectory();
    if (e.isSymbolicLink()) {
      try {
        isDirectory = fs.statSync(full).isDirectory();
      } catch {
        findings.fail('Config', `dangling symlink: ${path.join(relDir, e.name)}`, path.join(relDir, e.name), 'APX-CFG-018');
        continue;
      }
    }
    if (!isDirectory) continue;

    checked++;
    const skillPath = path.join(full, skillFile);
    const skillRel = path.join(relDir, e.name, skillFile);
    if (!isFile(skillPath)) {
      findings.fail('Config', `skill directory missing ${skillFile}: ${path.join(relDir, e.name)}`, path.join(relDir, e.name), 'APX-CFG-019');
      continue;
    }

    const content = readText(skillPath);
    // Record every skill so cross-directory drift and name collisions can be seen afterwards.
    // Whitespace-insensitive: a copy that differs only in trailing blank lines has not drifted.
    skills.push({
      folder: e.name,
      rel: skillRel,
      name: null,
      hash: crypto.createHash('sha256').update(content.replace(/\s+/g, ' ').trim()).digest('hex'),
    });
    const fm = parseFrontmatter(content);
    if (!fm) {
      findings.warn('Config', `${skillRel} has no YAML frontmatter — add description (and name) so the agent can match it`, skillRel, 'APX-CFG-020');
      continue;
    }
    const desc = (fm.description || '').trim();
    if (!desc) {
      findings.warn('Config', `${skillRel} frontmatter is missing a non-empty description`, skillRel, 'APX-CFG-021');
    }
    const name = (fm.name || '').trim();
    skills[skills.length - 1].name = name || null;
    if (name && name !== e.name) {
      findings.warn(
        'Config',
        `${skillRel} frontmatter name "${name}" does not match directory "${e.name}"`,
        skillRel,
      'APX-CFG-022');
    }
    if (desc && (!name || name === e.name)) {
      findings.pass('Config', `skill ok: ${path.join(relDir, e.name)}`, skillRel);
    }
  }

  if (checked === 0) {
    findings.pass('Config', `${relDir}/ present (no skill packages yet)`, relDir);
  }
}

function checkCommandsDir(repo, relDir, tool, findings) {
  const dir = path.join(repo, relDir);
  if (!isDir(dir)) return;
  if (isSymlink(dir) && !isInsideRepo(repo, dir)) {
    findings.warn('Config', `${relDir}/ is a symlink outside the repo — skipping commands checks (CWE-59)`, relDir, 'APX-CFG-023');
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const full = path.join(dir, e.name);
    const rel = path.join(relDir, e.name);
    const content = readText(full);
    const fm = parseFrontmatter(content);
    if (!fm) {
      findings.warn('Config', `${rel} has no YAML frontmatter — add a description for the slash command`, rel, 'APX-CFG-024');
      continue;
    }
    if (!(fm.description || '').trim()) {
      findings.warn('Config', `${rel} frontmatter is missing a non-empty description`, rel, 'APX-CFG-025');
    }
    if (fm['allowed-tools'] != null || fm.allowed_tools != null) {
      const raw = fm['allowed-tools'] ?? fm.allowed_tools;
      if (typeof raw === 'string' && raw.trim() && /:\s*$/.test(raw.trim())) {
        findings.warn('Config', `${rel} allowed-tools looks truncated or invalid`, rel, 'APX-CFG-026');
      }
    }
    // A command that reads arguments but never advertises them leaves the picker blank.
    const placeholder = tool.commandArgPlaceholder;
    const declaresHint = (tool.commandFrontmatter || []).includes('argument-hint');
    if (placeholder && declaresHint && placeholder.test(content) && !(fm['argument-hint'] || '').trim()) {
      findings.warn(
        'Config',
        `${rel} reads arguments but declares no argument-hint — the command picker shows no usage`,
        rel,
        'APX-CFG-038',
      );
    }

    const bodyLines = bodyLineCount(content);
    if (bodyLines > COMMAND_BODY_WARN_LINES) {
      findings.warn(
        'Config',
        `${rel} body is ${bodyLines} lines — slash commands should stay thin entry points (method belongs in a skill or AGENTS.md)`,
        rel,
      'APX-CFG-027');
    } else if ((fm.description || '').trim()) {
      findings.pass('Config', `command ok: ${rel}`, rel);
    }
  }
}

/** Warn when project-local Claude settings are not ignored. */
function checkLocalSettingsGitignore(repo, findings) {
  const claudeDir = path.join(repo, '.claude');
  if (!isDir(claudeDir)) return;
  if (isSymlink(claudeDir) && !isInsideRepo(repo, claudeDir)) return;

  const target = '.claude/settings.local.json';
  const ignored = pathIgnoredByGitignore(repo, target);
  if (ignored === false) {
    findings.warn(
      'Config',
      `${target} is not covered by .gitignore — local Claude settings/permissions can leak into commits`,
      target,
    'APX-CFG-028');
  } else if (ignored === true) {
    findings.pass('Config', `${target} is gitignored (or would be)`, target);
  }
}

/**
 * Soft layering: oversized always-on instructions while on-demand skills exist.
 * @param {string} repo
 * @param {import('../findings.js').Findings} findings
 */
function checkSoftLayering(repo, findings) {
  const agents = agentsMdPath(repo);
  if (!agents) return;
  const lines = readText(agents).split('\n').length;
  if (lines <= 200) return;

  let skillCount = 0;
  for (const tool of TOOLS) {
    for (const rel of tool.skillsDirs || []) {
      const dir = path.join(repo, rel);
      if (!isDir(dir)) continue;
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory() || (e.isSymbolicLink() && isDir(full))) skillCount++;
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (skillCount > 0) {
    findings.warn(
      'Config',
      `AGENTS.md is ${lines} lines while ${skillCount} skill package(s) exist — move on-demand workflows into skills so always-on instructions stay lean`,
      'AGENTS.md',
    'APX-CFG-029');
  }
}

/**
 * Minimal YAML frontmatter parse (key: value lines only). Returns null if no fence.
 * @param {string} content
 * @returns {Record<string, string>|null}
 */
export function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (!/^---\s*$/.test(lines[0] ?? '')) return null;
  const data = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^---\s*$/.test(line)) break;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m) data[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return data;
}

function bodyLineCount(content) {
  const lines = content.split('\n');
  if (!/^---\s*$/.test(lines[0] ?? '')) return lines.filter((l) => l.trim()).length;
  let i = 1;
  while (i < lines.length && !/^---\s*$/.test(lines[i])) i++;
  return lines.slice(i + 1).filter((l) => l.trim()).length;
}

/**
 * Best-effort gitignore match without spawning git. null = no .gitignore to consult.
 * @param {string} repo
 * @param {string} relPosix path with forward or native separators
 * @returns {boolean|null}
 */
export function pathIgnoredByGitignore(repo, relPosix) {
  const rel = relPosix.split(path.sep).join('/');
  const files = [path.join(repo, '.gitignore'), path.join(repo, '.claude', '.gitignore')];
  let saw = false;
  let ignored = false;
  for (const gi of files) {
    if (!isFile(gi)) continue;
    saw = true;
    const base = path.dirname(gi) === path.join(repo, '.claude') ? '.claude/' : '';
    for (const raw of readText(gi).split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const neg = line.startsWith('!');
      const pat = neg ? line.slice(1) : line;
      if (matchGitignorePattern(pat, rel, base)) {
        ignored = !neg;
      }
    }
  }
  if (!saw) {
    // If the local file does not exist yet, still warn when nothing would ignore it.
    // No gitignore at all → treat as not ignored when .claude/ exists (caller only runs then).
    return false;
  }
  return ignored;
}

/** Very small subset of gitignore globbing sufficient for settings.local.json. */
function matchGitignorePattern(pattern, rel, prefix) {
  let p = pattern.replace(/^\.\//, '');
  // Patterns in .claude/.gitignore are relative to that dir.
  const candidate = prefix ? (rel.startsWith(prefix) ? rel.slice(prefix.length) : rel) : rel;
  if (p.endsWith('/')) p = p.slice(0, -1);

  if (p === 'settings.local.json' || p.endsWith('/settings.local.json')) {
    return candidate === 'settings.local.json' || candidate.endsWith('/settings.local.json') || rel.endsWith('settings.local.json');
  }
  if (p === '.claude/settings.local.json' || p === '**/.claude/settings.local.json') {
    return rel === '.claude/settings.local.json' || rel.endsWith('/.claude/settings.local.json');
  }
  if (p === '*.local.json') {
    return /(?:^|\/)[^/]+\.local\.json$/.test(candidate) || /(?:^|\/)[^/]+\.local\.json$/.test(rel);
  }
  if (p === '*' || p === '**') return true;

  // Exact path match
  if (p === candidate || p === rel) return true;
  // Simple ** / * suffix
  if (p.startsWith('**/')) {
    const suf = p.slice(3);
    return candidate === suf || candidate.endsWith('/' + suf) || rel.endsWith('/' + suf) || rel === suf;
  }
  return false;
}
