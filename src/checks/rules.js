// RULES checks: the AGENTS.md single source of truth exists, is real (not template stubs), and
// is not missing while tool adapters expect it. Also advisory protocol hygiene when claimed.
import path from 'node:path';
import { detectAdapters, exists, readText } from '../detect.js';
import { agentsMdPath } from '../ssot.js';
import { checkProtocolArtifacts, checkProtocolSignals } from './protocol.js';

const PLACEHOLDER = /\{\{[A-Z_]+\}\}/; // {{PROJECT_NAME}} etc. left from scaffolding
const STUB = /\[(…|\.\.\.|one-line description|Framework \+ language|Domain rule|Entry point)/;

export function checkRules(repo, findings) {
  const agents = agentsMdPath(repo);
  const adapters = detectAdapters(repo);

  if (!agents) {
    if (adapters.length > 0) {
      findings.fail('Rules', 'tool adapters are present but there is no AGENTS.md — no single source of truth', null, 'APX-RUL-001');
    } else {
      findings.warn('Rules', 'no AGENTS.md — project rules are undocumented', null, 'APX-RUL-002');
    }
    // Progress-only repos can still get artifact hygiene without AGENTS.md.
    checkProtocolArtifacts(repo, null, findings);
    return;
  }

  findings.pass('Rules', 'AGENTS.md present (single source of truth)', 'AGENTS.md');
  const content = readText(agents);

  if (PLACEHOLDER.test(content)) {
    const lines = lineNumbers(content, PLACEHOLDER);
    findings.fail('Rules', `AGENTS.md still has {{PLACEHOLDER}} markers on line(s) ${lines}`, 'AGENTS.md', 'APX-RUL-003');
  }
  if (STUB.test(content)) {
    const lines = lineNumbers(content, STUB);
    findings.warn('Rules', `AGENTS.md has unfilled template stubs ([…]) on line(s) ${lines}`, 'AGENTS.md', 'APX-RUL-004');
  }
  if (content.trim().length < 80) {
    findings.warn('Rules', 'AGENTS.md is nearly empty — add real project rules', 'AGENTS.md', 'APX-RUL-005');
  }

  checkQuality(content, findings);
  checkCompleteness(content, findings);
  checkLayoutPaths(repo, content, findings);
  checkProtocolSignals(content, findings);
  checkProtocolArtifacts(repo, content, findings);
}

// Does AGENTS.md document the essentials an agent needs? One compact advisory line, low
// false-positive: only flags a section as missing when no reasonable signal for it appears.
function checkCompleteness(content, findings) {
  const missing = [];
  const hasCommands =
    /^#{1,6}\s+.*command/im.test(content) ||
    /\b(npm run|pnpm |yarn |make |cargo |go test|pytest|swift (build|test)|xcodebuild|npx )/i.test(content);
  const hasBoundaries =
    /do[\s-]?not[\s-]?touch|out[\s-]?of[\s-]?scope|boundar|must not|never (edit|modify|touch|change)/i.test(content);
  const hasSensitive = /secret|credential|sensitive|\.env|do[\s-]?not[\s-]?commit|token/i.test(content);
  // Layout: prefer an explicit section; also accept clear "where code lives" path map signals.
  const hasStructure =
    /^#{1,6}\s+.*(structure|layout|directories)\b/im.test(content) ||
    /\b(repository|project|repo)\s+layout\b/i.test(content) ||
    (/\bwhere\b.+\b(lives|belongs|live)\b/i.test(content) &&
      /\b(src\/|app\/|lib\/|bin\/|cmd\/|packages\/)/i.test(content));
  if (!hasCommands) missing.push('Commands (test/lint/build)');
  if (!hasStructure) missing.push('Repository layout / project structure');
  if (!hasBoundaries) missing.push('boundaries/do-not-touch');
  if (!hasSensitive) missing.push('sensitive-data note');
  if (missing.length) {
    findings.warn('Rules', `AGENTS.md is missing recommended section(s): ${missing.join('; ')}`, 'AGENTS.md', 'APX-RUL-006');
  }
}

/**
 * Soft-check: backtick paths inside a Repository layout / structure section should exist on disk.
 * Does not invent a canonical tree — only flags drift between docs and the repo.
 */
function checkLayoutPaths(repo, content, findings) {
  const section = extractLayoutSection(content);
  if (section == null) return;

  const paths = extractRepoPaths(section);
  const missing = [];
  for (const rel of paths) {
    const full = path.join(repo, rel);
    if (exists(full) || exists(full.replace(/\/$/, ''))) continue;
    if (!rel.endsWith('/') && exists(path.join(repo, `${rel}/`))) continue;
    missing.push(rel);
    if (missing.length >= 8) break;
  }
  if (missing.length) {
    findings.warn(
      'Rules',
      `AGENTS.md layout paths not found in the repo: ${missing.join(', ')} — update the layout or restore the paths`,
      'AGENTS.md',
    'APX-RUL-007');
  } else if (paths.length > 0) {
    findings.pass('Rules', 'AGENTS.md layout paths resolve on disk', 'AGENTS.md');
  }
}

/** @returns {string|null} body of the first structure/layout heading, or null if none */
function extractLayoutSection(content) {
  const lines = content.split('\n');
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(\S.*)$/);
    if (!m) continue;
    if (/(structure|layout|directories)\b/i.test(m[2]) || /\b(repository|project|repo)\s+layout\b/i.test(m[2])) {
      start = i + 1;
      level = m[1].length;
      break;
    }
  }
  if (start < 0) return null;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

/**
 * Backtick tokens that look like repo-relative paths (not commands or package names).
 * @returns {string[]}
 */
export function extractRepoPaths(text) {
  const out = [];
  const seen = new Set();
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(text))) {
    let p = m[1].trim();
    if (!p || /\s/.test(p)) continue;
    if (/^[=~$@!]/.test(p)) continue;
    if (/^https?:\/\//i.test(p) || p.includes('://')) continue;
    if (p.startsWith('/')) continue;
    if (/[*?…]|\.\.\./.test(p)) continue;
    if (p.startsWith('[') || p.includes('{{')) continue;
    p = p.replace(/^\.\//, '');
    // Path-like: contains / or a file extension, or a common top-level dir name.
    const pathLike =
      p.includes('/') ||
      /\.[a-z0-9]{1,8}$/i.test(p) ||
      /^(src|app|lib|bin|cmd|test|tests|docs|packages|adapters|templates|assets|claude-harness)$/i.test(p);
    if (!pathLike) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

// Quality-of-content checks on AGENTS.md: length and structure.
function checkQuality(content, findings) {
  const lines = content.split('\n');

  // Claude Code's docs recommend keeping instruction files under ~200 lines — longer files
  // consume more context and reduce how reliably the agent follows them.
  if (lines.length > 200) {
    findings.warn(
      'Rules',
      `AGENTS.md is ${lines.length} lines — agent adherence drops past ~200; split into scoped rule files`,
      'AGENTS.md',
    'APX-RUL-008');
  }

  // Empty sections: a leaf heading with no body before the next heading (or EOF) is dead weight.
  // A heading that merely contains sub-headings is a container, not empty; blockquotes count as body.
  const empties = [];
  const headings = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s+(\S.*)$/);
    if (m) headings.push({ i, level: m[1].length, title: m[2].trim() });
  });
  headings.forEach((h, idx) => {
    const next = headings[idx + 1];
    const end = next ? next.i : lines.length;
    const hasBody = lines.slice(h.i + 1, end).some((l) => l.trim().length > 0);
    const hasChild = next && next.level > h.level;
    if (!hasBody && !hasChild) empties.push(`"${h.title}" (line ${h.i + 1})`);
  });
  if (empties.length) {
    findings.warn('Rules', `AGENTS.md has empty section(s): ${empties.join(', ')} — fill or remove`, 'AGENTS.md', 'APX-RUL-009');
  }
}

function lineNumbers(content, re) {
  const g = new RegExp(re.source, 'g');
  const nums = [];
  content.split('\n').forEach((line, i) => {
    if (g.test(line)) nums.push(i + 1);
    g.lastIndex = 0;
  });
  return nums.join(',');
}
