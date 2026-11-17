# CO2 critique — security controls + evidence (K5 · K6 · K10, IN · AU · AE), written before any code

(a) What the brief and CO0 §7 assume, checked:
- "Extend the b172/b282 REVOKE to `state_log`" — **FALSE as written.** `state_log` has no UPDATE writer anywhere, but DELETE is used on purpose for DRAFT copies: draft purge (api `routes/chits.js:4605`), draft promote (`routes/chits.js:1400`, `chit_deliver` b300:48). REVOKE DELETE would break sending a draft. → REVOKE UPDATE; DELETE refused by trigger unless the copy is a Draft (the purge route's own rule, `chits.js:4602`).
- "`log.onCritical` has no sink" — TRUE (api `lib/logger.js:44`, only 2 `log.critical` calls, both at boot, `server.js:29,44`).
- "CSP off" — TRUE (api `server.js:160`; web `vercel.json` sets no headers). Web loads Railway API, Google Fonts, cdnjs, YouTube/Vimeo frames; `cb_api_base` override can point anywhere (`app.html:1747`).
- "Logs in India ≥ 1 year" — FALSE today: logs are Railway stdout; app.html:1737 says Railway runs in **Singapore**. Not code: owner/hosting action.
- "NTP to NIC/NPL" — host clock; the API cannot set it. Owner/hosting action (logger stamps UTC ISO, `lib/logger.js:49`).
- "Owner MFA" — methods exist (`lib/signin-events.js` METHODS) but no second factor is built. A real build (sign-in flow + migration) — too large for an honest S change here → Planned row.
- Standards register lacks AU/AE (`cap-standards.js:503`) — TRUE.

(b) Conflicts: one register = `cap-standards.js` (no new control page, no second log); incident register as a doc, not a table (no rows to store
yet — "a second log" avoided); e2e/standards-page.cjs hard-codes 61 rows / 34·15·12 — must widen to "the base rows + compliance additions".

(c) Simpler: CSP as **Report-Only** (+ the two directives nothing uses: `object-src 'none'`, `base-uri 'self'` enforced) — cannot break a screen;
enforce after a clean week. Alert sink = one env var (`CB_ALERT_WEBHOOK`) inside the existing logger, not a new module.

(d) Risks: migration number (b302 is taken twice on open branches → b303; CO1/CO3 may race it); CO1/CO3 also add register rows → merge conflict in
cap-standards.js + the walk's counts (counts made additive by `added` date); trigger on a hot table (DELETE only, drafts only — cheap);
the webhook must never block or throw (fire-and-forget, 3 s timeout); no engines change.

(e) VERDICT: **BUILD WITH CHANGES** — state_log: REVOKE UPDATE + Draft-only DELETE trigger (not REVOKE DELETE); CSP report-only + 2 enforced
directives; MFA, log sink in India, NTP, CERT-In PoC → Planned rows + OWNER-ACTIONS, not pretended done.
