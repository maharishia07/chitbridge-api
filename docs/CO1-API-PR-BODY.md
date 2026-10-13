**VERDICT: BUILD WITH CHANGES** (critique: web `docs/critique/CO1.md`) — consent lands as **b306** (designed as "b277", never written), the rights/grievance register as **b307**; b308 unused. **Owner runs both migrations** (until then: 503 `PRIVACY_NOT_MIGRATED`, never a 500).
Controls: K2 `party_contact_pref` append-only (REVOKE UPDATE/DELETE, the b276 pattern) + `lib/privacy.mayMessage` may/why · K4/K11 `privacy_request` with the legal due date per country (IN grievance 15 d · IN/AU/AE 30 d), owner answers once (trigger) · K9 public `GET /api/privacy/facts` (sub-processors + regions from code/env; notice + contact NULL "not published yet" until the owner sets them).
Reuse: crm-stub + `routes/crm.js` fence (`noKey`, `isOwner`, `partyOn`, `fail`), DATA.md §5 columns, b276 RLS/grant shape, `publicLimiter`. New paths: `lib/privacy.js` + `routes/privacy.js` (no consent/request/processor store existed — grep consent|grievance in lib/routes/migrations).
Trips: GET/POST contact-prefs 1 each · GET/POST privacy-requests, POST /:id/answer 1 each (ONE withEntity, by hand — 503 on the stub) · GET /api/privacy/facts 0. Budget lines by hand, `awaiting_client` since 13 Oct (no screen yet). No web-api contract entry: the web calls none of them yet.
Who may call: CRM routes — signed-in shop (no API key), viewer refused by the hat gate; answer — owner only; facts — anyone.
Checks: `tests/privacy.test.cjs` 15/15 · `node scripts/guards.cjs` 5054 checks all passed. Flow: L2C step 6. Better than Zoho/HubSpot consent flags because a withdrawal is a new row beside the yes — the proof DPDP s.6(10) asks for — and the server says why a send is refused.
Landing: this PR first, then web round/CO1-38350590643. No engines change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
