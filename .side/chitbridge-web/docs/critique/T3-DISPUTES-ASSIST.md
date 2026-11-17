# Critique · T3-DISPUTES-ASSIST — Disputes and CB Assist review in tasks.html (written before any code)

(a) What the brief assumes, checked
- Workshop disputes list + raise/resolve exist — TRUE: `public/app/cap-dispute.js:243` paintDisputes, `:278` quickDispute, `:301` resolveDispute. But they are app.html globals (UI · modal · MODALS · listCtl · lazyWrap · chitIsSelf · nm) — the file cannot run bare in tasks.html.
- "server paging" — FALSE: `GET /api/chits/disputes/queue` (api routes/chits.js:4598) returns every OPEN dispute, no page/total, one roster query PER ROW.
- "raise/resolve with rail.can" — HALF: rail.can has `dispute` (api lib/rail.js:41 — level + held) = Raise. Resolve's raiser-only rule lives only in the route (chits.js:4520). Neither GET answers may/why.
- CBSheet shows a dispute — FALSE: the sheet's ⚑ calls `quickDispute` (chit-sheet.js:457, app.html-only) and paints no disputes.
- CBList "five controls, server paging" — HALF: remote mode hides the Filters control (list-ctl.js:459).
- Assist review = "what the assistant drafted, accept/reject" — FALSE as assumed: #/assistreview is the help desk's KB publish screen (cap-admin.js:6025); the accept/reject routes are retired (`/api/assist/gaps` → [], `/api/assist/resolve` → 410, routes/assist.js:551-561). No draft store exists.
- page-frame pattern (settings.html + cap-shop/cap-country) — TRUE. moveStatus — not involved: a dispute writes no chit status.
- Docs: `C:/dev` (../chitbridge-docs) is EMPTY on this runner — the 03/25 RECONCILIATION + SPECs could not be read.

(b) Conflicts
- Engines are serial and this round does not own them → Resolve's verdict is composed in the api (rail.can `dispute` for level/held, then raiser-only + still-open, each with a code). Queued for engines: rail ACTIONS + `resolve_dispute`.
- "Co-assist" in the manifest is the AI that helps fill a chit → renamed "CB Assist" (feedback-coassist-terminology); the co-assist REGISTRY (people · IoT acting for the shop) stays in Employees/workforce.

(c) Simpler
- CB Assist review without a new table: the published answers (CBList) + "✨ Draft" (existing ai-draft skill `assist-ask`) → Accept = Publish (existing route) · Reject = discard. Publish greyed with the server's why (widen `/assist/whoami` with `actions.publish`).
- Disputes: WIDEN the queue route (optional status · side · q · sort · page · limit; one roster read per page) instead of a new route; legacy callers get the same keys.

(d) Risks
- Queue widening must not change the no-parameter answer (cap-dispute, cap-admin MIS read it; core.js unwrap keeps it whole via `my_disputes`). Twin PRs: api first, then web. No migration (b493–b495 unused). Other rounds may touch tasks.html / manifest.json (merge on lines only).

(e) VERDICT: BUILD WITH CHANGES — server paging + may/why added to the api (twin PR); Resolve's rule composed in the api, engines change queued; CB Assist review = draft → publish/discard on the existing routes, not an accept/reject queue; CBList remote mode widened to show Filters.
