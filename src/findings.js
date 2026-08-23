// Finding model shared across all checks. A finding is a plain object; a Findings collector
// gathers them and computes the process exit code.

export const PASS = 'pass';
export const WARN = 'warn';
export const FAIL = 'fail';

export const CATEGORIES = ['Secrets', 'Config', 'Rules', 'Styles', 'Environment'];

export class Findings {
  constructor() {
    this.items = [];
  }

  // `id` is a stable rule ID from src/rules-registry.js. Warnings and failures must carry one
  // (a source-level test enforces it); passes are informational and do not need a rule.
  add(severity, category, message, file, id) {
    this.items.push({ severity, category, message, file: file || null, id: id || null });
  }

  pass(category, message, file, id) {
    this.add(PASS, category, message, file, id);
  }
  warn(category, message, file, id) {
    this.add(WARN, category, message, file, id);
  }
  fail(category, message, file, id) {
    this.add(FAIL, category, message, file, id);
  }

  count(severity) {
    return this.items.filter((f) => f.severity === severity).length;
  }

  summary() {
    return { pass: this.count(PASS), warn: this.count(WARN), fail: this.count(FAIL) };
  }

  // 0 = all pass, 1 = warnings only, 2 = one or more failures. Mirrors the bash checker.
  exitCode() {
    if (this.count(FAIL) > 0) return 2;
    if (this.count(WARN) > 0) return 1;
    return 0;
  }
}
