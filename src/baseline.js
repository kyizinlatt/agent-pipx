// `--baseline` — accept the findings a repo already has so CI can gate on NEW ones only.
//
// Adopting a checker on an established repo otherwise means either fixing everything on day one
// or turning the gate off. A baseline records what was already there; anything new still fails.
// Suppressed findings are counted in the summary, never hidden silently.
import path from 'node:path';
import { FAIL, WARN } from './findings.js';
import { readText } from './detect.js';
import { writeRepoFile } from './safe-write.js';

export const DEFAULT_BASELINE = '.agent-pipx-baseline.json';

// A finding's identity across runs: WHICH rule fired and WHERE. Deliberately not the message —
// wording is rewritten between releases and often carries a count that changes on every edit.
export const fingerprint = (f) => `${f.id || f.category}|${f.file || ''}`;

const isIssue = (f) => f.severity === WARN || f.severity === FAIL;

/** Sorted, de-duplicated entries for every current warning/failure. */
export function collectEntries(findings) {
  const seen = new Map();
  for (const f of findings.items.filter(isIssue)) {
    seen.set(fingerprint(f), { id: f.id || null, category: f.category, file: f.file || null });
  }
  return [...seen.values()].sort((a, b) =>
    `${a.id}${a.file}`.localeCompare(`${b.id}${b.file}`),
  );
}

/** Serialize a baseline. No timestamps or tool versions: re-running must produce a stable file. */
export function serializeBaseline(findings) {
  return `${JSON.stringify({ version: 1, entries: collectEntries(findings) }, null, 2)}\n`;
}

/** @returns {Set<string>} fingerprints to suppress. Throws on an unreadable/invalid file. */
export function loadBaseline(file) {
  const text = readText(file);
  if (!text) throw new Error(`baseline not found or empty: ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`baseline is not valid JSON: ${file}`);
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`baseline has no entries array: ${file}`);
  }
  return new Set(parsed.entries.map((e) => fingerprint({ id: e.id, category: e.category, file: e.file })));
}

/**
 * Drop baselined warnings/failures from `findings` and record how many went. Passes are never
 * suppressed — a baseline hides known problems, it does not manufacture green.
 * @returns {number} how many findings were suppressed
 */
export function applyBaseline(findings, file) {
  const accepted = loadBaseline(file);
  const kept = findings.items.filter((f) => !(isIssue(f) && accepted.has(fingerprint(f))));
  const suppressed = findings.items.length - kept.length;
  findings.items = kept;
  findings.suppressed = suppressed;
  return suppressed;
}

/**
 * `agent-pipx baseline` — write the accept-list. Refuses to clobber an existing file without
 * --yes. Returns what happened; printing belongs to the CLI, not here.
 * @returns {{ ok: boolean, file: string, count: number, reason?: string }}
 */
export function writeBaselineFile(repo, findings, { out, apply = false } = {}) {
  const file = out || DEFAULT_BASELINE;
  const abs = path.isAbsolute(file) ? file : path.join(repo, file);
  const count = collectEntries(findings).length;
  if (readText(abs) && !apply) {
    return { ok: false, file, count, reason: 'exists' };
  }
  writeRepoFile(repo, abs, serializeBaseline(findings));
  return { ok: true, file, count };
}
