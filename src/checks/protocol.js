// PROTOCOL hygiene: optional tracked-findings / progress / plan discipline.
// Advisory only — absence is fine; claims or artifacts without role signals get warns.
import fs from 'node:fs';
import path from 'node:path';
import { isDir, isFile, readText, walk } from '../detect.js';

const PROGRESS_NAME = /^PROGRESS(?:[._-]|$)|\.PROGRESS\./i;
const ARCHIVE_HINT = /PROGRESS_ARCHIVE|archive|rotate|250\s*lines/i;
const STATE_TOKEN =
  /\b(OPEN|IN_PROGRESS|CODE_COMPLETE|PRODUCTION_PENDING|CLOSED|BLOCKED_DECISION|ACCEPTED_RISK|SUPERSEDED|SHIPPED|DEFERRED)\b/;

/** @returns {boolean} */
export function hasTrackedFindingsSection(content) {
  return (
    /^#{1,6}\s+.*tracked\s+findings/im.test(content) ||
    /\bremediation\s+ledger\b/i.test(content) ||
    /\btracked\s+findings?\b/i.test(content)
  );
}

/**
 * When AGENTS.md claims a tracked-findings protocol, require the core role signals.
 * @param {string} content
 * @param {import('../findings.js').Findings} findings
 */
export function checkProtocolSignals(content, findings) {
  if (!hasTrackedFindingsSection(content)) return;

  const missing = [];
  const hasLedgerRole =
    /\bledger\b/i.test(content) &&
    (/current\s+status/i.test(content) || /status\s+authority/i.test(content) || /own(?:s|ing)?\s+(?:stable\s+)?(?:finding\s+)?ids/i.test(content));
  const hasProgressRole =
    (/\bprogress\b/i.test(content) || /\bchangelog\b/i.test(content)) &&
    (/chronological/i.test(content) || /not\s+(?:the\s+)?(?:current\s+)?status/i.test(content) || /evidence\s+only/i.test(content));
  const hasCodeNeClosed =
    /\bCODE_COMPLETE\b/.test(content) ||
    /\bPRODUCTION_PENDING\b/.test(content) ||
    (/code(?:\/|\s+or\s+|\/tests?\s+)?(?:test(?:s)?|green)?/i.test(content) &&
      /\bCLOSED\b/.test(content) &&
      (/not\s+closed|≠|!=|never\s+close|do\s+not\s+(?:equate|treat)|distinguish/i.test(content)));
  const hasExitGate = /\bexit\s+gates?\b/i.test(content) || /\blive\/external\b/i.test(content) || /\bproduction\/(?:live|external)\b/i.test(content);
  const hasAcceptedRisk =
    /\bACCEPTED_RISK\b/.test(content) ||
    (/accepted\s+risks?/i.test(content) &&
      (/owner/i.test(content) || /decision\s+date/i.test(content)) &&
      (/expir/i.test(content) || /review/i.test(content) || /compensat/i.test(content)));

  if (!hasLedgerRole) missing.push('ledger as current status');
  if (!hasProgressRole) missing.push('progress/changelog as chronological evidence (not status)');
  if (!hasCodeNeClosed) missing.push('code/test complete ≠ CLOSED (e.g. CODE_COMPLETE / PRODUCTION_PENDING)');
  if (!hasExitGate) missing.push('exit gate / live evidence for closure');
  if (!hasAcceptedRisk) missing.push('accepted-risk owner + review/expiry');

  if (missing.length) {
    findings.warn(
      'Rules',
      `AGENTS.md tracked-findings section is missing recommended signal(s): ${missing.join('; ')}`,
      'AGENTS.md',
    'APX-RUL-010');
  } else {
    findings.pass('Rules', 'AGENTS.md tracked-findings protocol signals present', 'AGENTS.md');
  }
}

/**
 * Progress / plan / finding-doc hygiene when artifacts exist or are claimed.
 * @param {string} repo
 * @param {string|null} agentsContent
 * @param {import('../findings.js').Findings} findings
 */
export function checkProtocolArtifacts(repo, agentsContent, findings) {
  const content = agentsContent || '';
  const claimsProtocol = hasTrackedFindingsSection(content);
  const mentionsProgressFile = /\bPROGRESS\.md\b/i.test(content);
  const mentionsProgressRole = /\bprogress\s+files?\b/i.test(content);
  // Only treat Progress as "claimed" when the tracked-findings protocol is present.
  const claimsProgress = claimsProtocol && (mentionsProgressFile || mentionsProgressRole);
  const claimsPlanPath =
    /\.claude\/plans\b/i.test(content) || /\bPLAN\.md\b/.test(content) || /\bPLAN_ARCHIVE\.md\b/.test(content);

  const progressFiles = findProgressFiles(repo);
  const planDirs = findPlanDirs(repo);
  const findingDocs = findFindingDocs(repo);

  if (progressFiles.length) {
    if (!claimsProtocol) {
      findings.warn(
        'Rules',
        `progress log present (${progressFiles[0]}) but AGENTS.md does not document ledger-vs-progress roles — agents may treat Progress as status`,
        progressFiles[0],
      'APX-RUL-011');
    }
    for (const rel of progressFiles) {
      const text = readText(path.join(repo, rel));
      const lines = text.split('\n').length;
      if (lines > 250 && !ARCHIVE_HINT.test(text)) {
        findings.warn(
          'Rules',
          `${rel} is ${lines} lines — add an archive/rotation note (or split) so Progress stays scannable`,
          rel,
        'APX-RUL-012');
      }
    }
  } else if (claimsProgress) {
    findings.warn(
      'Rules',
      'AGENTS.md references a progress log but no PROGRESS-like file was found',
      'AGENTS.md',
    'APX-RUL-013');
  }

  if (claimsProtocol && findingDocs.length === 0 && !progressFiles.length) {
    // Protocol claimed with neither progress nor finding-doc artifacts — soft tip only when
    // the section looks "active" (mentions IDs) rather than the default template.
    if (/\bstable\s+(?:finding\s+)?ids?\b/i.test(content) && /\bledger\b/i.test(content)) {
      // Template-only repos are fine; only warn if they also point at a concrete review path.
      if (/docs\/|\.claude\/review|findings?\.(md|txt)/i.test(content)) {
        findings.warn(
          'Rules',
          'AGENTS.md points at a findings/review document but none with ledger-like states was found',
          'AGENTS.md',
        'APX-RUL-014');
      }
    }
  } else if (claimsProtocol && findingDocs.length === 0 && /docs\/|\.claude\/review/i.test(content)) {
    findings.warn(
      'Rules',
      'AGENTS.md points at a findings/review document but none with ledger-like states was found',
      'AGENTS.md',
    'APX-RUL-014');
  }

  if (planDirs.length || claimsPlanPath) {
    checkPlanHygiene(repo, planDirs, claimsPlanPath, findings);
  }
}

function findProgressFiles(repo) {
  const out = [];
  const rootCandidates = ['PROGRESS.md', 'docs/PROGRESS.md', 'docs/deployment/PROGRESS.md'];
  for (const rel of rootCandidates) {
    if (isFile(path.join(repo, rel))) out.push(rel);
  }
  // Bounded scan under docs/ for other PROGRESS* names.
  const docs = path.join(repo, 'docs');
  if (isDir(docs)) {
    for (const f of walk(docs, { exts: ['.md'], max: 500 })) {
      const name = path.basename(f);
      if (!PROGRESS_NAME.test(name) || /ARCHIVE/i.test(name)) continue;
      const rel = path.relative(repo, f);
      if (!out.includes(rel)) out.push(rel);
    }
  }
  return out;
}

function findPlanDirs(repo) {
  const dirs = [];
  for (const rel of ['.claude/plans', 'plans', 'docs/plans']) {
    if (isDir(path.join(repo, rel))) dirs.push(rel);
  }
  return dirs;
}

function findFindingDocs(repo) {
  const out = [];
  const roots = ['.claude/review', 'docs/review', 'docs/audits', 'docs/security'];
  for (const rel of roots) {
    const dir = path.join(repo, rel);
    if (!isDir(dir)) continue;
    for (const f of walk(dir, { exts: ['.md'], max: 200 })) {
      const text = readText(f);
      if (STATE_TOKEN.test(text) && /\bledger\b/i.test(text)) {
        out.push(path.relative(repo, f));
      }
    }
  }
  return out;
}

function checkPlanHygiene(repo, planDirs, claimsPlan, findings) {
  if (!planDirs.length) {
    if (claimsPlan) {
      findings.warn(
        'Rules',
        'AGENTS.md describes a durable plan/archive workflow but no plan directory was found',
        'AGENTS.md',
      'APX-RUL-015');
    }
    return;
  }

  for (const dirRel of planDirs) {
    const dir = path.join(repo, dirRel);
    let entries;
    try {
      entries = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));
    } catch {
      continue;
    }
    if (entries.length > 2) {
      findings.warn(
        'Rules',
        `${dirRel}/ has ${entries.length} markdown files — prefer one live plan + one lifecycle archive (not topic splits)`,
        dirRel,
      'APX-RUL-016');
    }
    for (const name of entries) {
      if (/archive|shipped/i.test(name)) continue;
      const rel = path.join(dirRel, name);
      const text = readText(path.join(repo, rel));
      const hasId = /\bID\s*:\s*\S+/i.test(text) || /\bPLN-\d+/i.test(text) || /\*\*ID:\*\*/i.test(text);
      const hasGate = /\bexit\s+gate\b/i.test(text);
      if (text.trim().length > 40 && (!hasId || !hasGate)) {
        const missing = [!hasId && 'stable ID', !hasGate && 'exit gate'].filter(Boolean).join(' + ');
        findings.warn(
          'Rules',
          `${rel} looks like a durable plan but is missing ${missing} on tracked sections`,
          rel,
        'APX-RUL-017');
      }
    }
  }
}
