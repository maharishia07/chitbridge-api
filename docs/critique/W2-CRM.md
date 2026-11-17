# Critique · W2-CRM (M1 Party record → 100%) — written before any code, 2026-10-15

**(a) What the brief assumes, checked on main (api 13b8…/web 13b8…)**
- "cap-crm.js:41-55 decides viewer rights on the client" — TRUE: `crmRole()` (cap-crm.js:62-65) is a regex over the token's hat; the server sends no `may` on GET /parties, /parties/:id or /followups (routes/crm.js:71-110, 217-223). Only /segments (`may`), /calls (`may` = migration only) and /privacy-requests (`may_answer`) carry one.
- "lists stop at 300 silently (crm.js:67-98)" — TRUE but the line is lib/crm-calls.js:61 (`LIMIT 300`, no total); lib/crm-followups.js:120 is `LIMIT 2000`, no total/page/limit (contract GET /api/crm/followups confirms). GET /parties IS on the one pager (routes/crm.js:74, total·page·limit). tests/list-paging-guard.test.cjs says "0 left" only because its scan needs `.rows` in the route body — a list built in lib is invisible to it.
- "snooze/follow-ups use the phone's clock" — HALF: the server already cuts late/today on the shop's day (`todayOf`/`dayOf`, crm-followups.js:96-111, crm-calls.js:39-66; crm-followups.js:12 is a stale "India +05:30" comment). The WEB still does: `crmSnoozeISO` (cap-crm.js:631, tomorrow/next week at the phone's 09:00), `crmFuSave` (:717, `date+'T09:00:00'` in the phone's zone) and the add-sheet presets (:737, phone's date).
- "prefs" — DONE: GET/POST /parties/:id/contact-prefs carry `may[channel][purpose] {may, code, why}` (T3-P3-CONSENT); nothing to add.

**(b) Conflicts with standing rules / existing constructs**
- One may/why: `lib/access.mayWrite(req)` → `{may, code, why}` (the rail's sentence) and `lib/owner.may(req)` → `{ok, code, why}` already exist; the CRM must answer THESE, not a third shape. Web must stop the hat regex once the server has spoken (the "sentence the client branches on ships with a code" rule).
- One pager: `lib/page-limit.pageArgs/pageOut` (not asked = every row, as FIELDS.md states) — the 300/2000 cuts become a page with a total; `count(*) OVER()` as routes/testing.js readPage does. Web reads pages through `CBList.every` (list-ctl.js:987), keeping the Follow-ups list's own filters/sorts/buckets (CBList `remote` would drop the bucket grouping — not touched).
- One day arithmetic: `books-engines.addDays` + `dayBounds`; the snooze words (today·tomorrow·3days·week) live in crm-calls OUTCOMES.presets today — lifted to ONE table in crm-followups (`AFTER`) that both the call desk and PATCH /followups read.

**(c) Simpler way** — none that keeps the server deciding: the web could keep its regex, but that is the defect named. The web sends words (`after: 'tomorrow'`) or a bare date; the server owns the day — no shop-zone logic in the browser.

**(d) Risks** — contract: GET /followups and /calls gain keys (additive; `--write` + byte copy to web). Budget: /followups stays 1 statement (window count in the same SELECT); /calls stays as is. No migration (b688-b690 unused). No engines change. Other rounds: W2-* touching routes/crm.js — additive edits only. Twin landing: api first (the web falls back to the hat regex until `may` arrives, so either order is safe).

**(e) VERDICT: BUILD WITH CHANGES** — (1) `may` answered on GET /parties, /parties/:id and /followups from `access.mayWrite` + `owner.may` (no new shape); (2) /followups + /calls on pageArgs/pageOut with `total`, the window count in the one statement; (3) PATCH /followups/:id takes `after` (the one AFTER table), POST takes a bare date, both answer `shop_day`; the web sends words/dates, never a phone instant; prefs reported done, not rebuilt.
