# CO2 PR bodies (gh pr create was refused: token lacks pull-request permission — open these by hand)

## web · round/CO2-38349134971 → main
Title: CO2: security controls in Standards (IN·AU·AE), report-only CSP, incident runbook

VERDICT: BUILD WITH CHANGES (docs/critique/CO2.md) — CSP report-only, plus 2 enforced directives; MFA, an India log sink, NTP and the CERT-In contact are Planned or owner actions, not claimed as done.
Register (`cap-standards.js`): 7 rows with legal refs for IN · AU · AE (CERT-In 2022, DPDP s.8(5)-(6), Privacy Act s.26WE-WL, UAE FDL 45/2021, ISO 27001 A.8.15/A.8.5, CSP L3). 6 are Partly, 1 Planned. `STD_COUNTRIES` gains AU and AE, and `standards.html` now groups any country.
`vercel.json`: `object-src 'none'` and `base-uri 'self'` enforced; the full CSP is report-only; nosniff; referrer policy. `docs/compliance/`: INCIDENT-RUNBOOK (6 h / 72 h / 30 d / UAE clocks), INCIDENT-REGISTER (empty, kept), OWNER-ACTIONS (run b303, set CB_ALERT_WEBHOOK, CERT-In contact, logs in India: the API runs in Singapore today).
Checks: guard-static, token-guard, dup-functions, check-syntax and app-parses pass. contract.cjs has 1 failure that is already on main (fixture drift; no route touched). Walk `e2e/standards-page.cjs`: 150 passed, 0 failed, AA in all themes at 1366 and 390 px. The walk now counts compliance rows by date, so the CO1/CO3 rounds add rows without reopening the counts.
Better than Xero/QuickBooks because each control row shows its proof (a test, a migration check) and what is missing, instead of a trust-page claim. Twin: api round/CO2-38349134971 (b303) lands first.
🤖 Generated with [Claude Code](https://claude.com/claude-code)

## api · round/CO2-38349134971 → main
Title: CO2: critical alerts webhook + state_log append-only (b303)

VERDICT: BUILD WITH CHANGES (critique: web docs/critique/CO2.md) — state_log keeps DELETE for drafts; REVOKE DELETE would break sending a draft.
K6: `migrations/b303_state_log_append_only.sql` (FILE, owner runs): REVOKE UPDATE from cb_app + a BEFORE DELETE trigger that allows only a Draft copy (the purge route's own rule). RLS unchanged. Flow: R2R (record integrity).
K5: `lib/logger.js` widened. `log.critical` POSTs to `CB_ALERT_WEBHOOK` (fire-and-forget, 3 s timeout, never throws). Platform plumbing, so no flow step. Reused the existing `onCritical` hook; no new module.
Evidence: `tests/co2-controls.test.cjs` (10 checks), added to the offline gate plus a board case. `node scripts/guards.cjs`: 5021 checks, all pass. No route, no new dependency, no secret (`.env.example` holds an empty key).
Landing order: this api PR before the web PR, so the Standards rows point at b303 and the test. Web CO0 (research doc) lands first of all.
🤖 Generated with [Claude Code](https://claude.com/claude-code)
