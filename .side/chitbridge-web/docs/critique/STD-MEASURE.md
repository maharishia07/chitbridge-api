# Critique · STD-MEASURE (2026-10-15) — written before any code

(a) Assumptions checked
- "MAINT-1 measuring scope (vendored copies excluded)" — UNKNOWN: no MAINT-1 file in web/api/engines, and ../chitbridge-docs is empty on this runner. I rebuild the scope from the vendoring markers instead: web `public/engine/*` + `public/till.html` (engines.lock.json, "ADOPTED from" headers), api adopted `lib/*` copies (engines.lock.json), fixtures, lockfiles, images.
- "jscpd as in MAINT-1" — UNKNOWN: jscpd is in no package.json/lockfile and the brief forbids a new dependency → the script has its own 6-line-window duplicate finder (said in its header).
- "web tools/graph KG1" — TRUE: tools/graph/scan.cjs exports scanJs (functions, lines, params, requires). Reused for unit size / params / fan-in; not copied.
- "engines if reachable" — TRUE: ../chitbridge-engines exists beside the checkouts; the script takes any root.
- "existing CI workflows — add, never duplicate" — TRUE: no codeql.yml in either repo (web: ci, e2e, walks, build-round, batch-merge; api: ci, governance, backup-restore, uptime).
- Dependabot, SECURITY.md: web has no .github/dependabot.yml (checked) → SSDF row says so honestly.

(b) Conflicts: none with the chit/rail/money rules — nothing here touches product code. The CLAUDE.md "reuse" rule is met by scan.cjs reuse. Stars are a MEASUREMENT of a model (SIG bands as I recall them, not the licensed SIG model) — the doc says so; no certification claim.

(c) Simpler: stars from scan.cjs + line counts only. Chosen, with complexity counted by decision tokens on the lexer-blanked code (approximate; said so).

(d) Risks: CodeQL on a 1.5 MB inline-script app.html may be slow/noisy → report-only (no required check, `continue-on-error`). Weekly cron + main push only, so PR time is unaffected. No migration (b664–b666 unused). No engines change. Two PRs, independent; land in any order. Other rounds editing the same files: none (new files only, plus npm script line in web package.json).

(e) VERDICT: BUILD WITH CHANGES — rebuild the MAINT-1 scope from vendoring markers; no jscpd dependency (built-in duplicate finder, jscpd used if present); no web access, so SSDF/SIG bands are from memory and flagged for a person to confirm.
