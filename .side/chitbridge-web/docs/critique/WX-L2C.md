# Critique · WX-L2C (walk Lead-to-customer, width and depth, on a real stack) — written before any code

**VERDICT: BUILD WITH CHANGES** (two scope corrections, no blocker).

## (a) What the brief assumes, checked
- "money moves → books post → reports show it" — FALSE for L2C: every step's ledger is `none` (docs/process/flows.json, L2C steps 1–5; `L2C.md` rows). Depth ends at step 5: the first bill makes the lead a customer (`api:lib/crm.js:154`, `routes/crm.js:280` IS_CUSTOMER). The walk proves THAT, not TB/P&L.
- "two parties where two-sided" — FALSE: a lead is a minted local party (`routes/crm.js:233` `L.mint … kind 'cus'`), never on ChitBridge; one shop, one login.
- "`--country AU` second run for R2R/O2C" — not this flow; one IN load only.
- The screens exist and route: Leads/Calls tabs (`cap-crm.js:256-302`), Add lead (`cap-crm-leads.js:89`), Move to… (`:115`), call outcomes (`cap-crm-calls.js:79`), record (`cap-crm-record.js:137`) — TRUE.
- Real stack is reachable: `sim-load --schema` applies b297/b299/b300 (`migrations/` has b297_memberships…b301) — TRUE; `crm.html:323` honours `cb_api_base`, so the api can sit on any port; CORS needs `ALLOWED_ORIGINS` (`server.js:57`).
- A view-only login: sim-load makes no staff; `routes/actors.js:171` POST / + `/login` can mint one — UNKNOWN until tried; fixture mode (e2e/crm.cjs §7) already covers the viewer.

## (b) Conflicts with DECISIONS-level rules
- Server decides may/why: the Leads moves list comes from `rec.lead.moves` — the api's `one()` must send it or Move to… shows an empty sheet; a finding, not a web-side rule. No engines touched (L2C uses none).
- One place per thing: the walk reuses `e2e/lib/walk.cjs` (step · shot · finish), `e2e/lib/crm-api.cjs` for the fixture answers, no new static server.

## (c) Simpler way
Fixture mode = e2e/crm.cjs's stand-in (already holds leads/calls shapes); only `--real` is new: spawn `server.js` as a child, drive `CBSignin` with the loader's login. No new fixture file.

## (d) Risks
- Docker/Postgres on the runner: image pulled OK; the api needs JWT_SECRET ≥ 32 chars, DEV_OTP, RATE_LIMIT_MAX (sim-load sets them in-process; the walk must set the same for its child).
- Bill-to-lead for step 5 reuses the loader's chit shape (`tools/sim-load.cjs` chitOf); if the counter shape refuses a lead recipient, that is itself a finding.
- Other rounds touch cap-crm-*.js (TO1 wlAssign in cap-tasks only) — low overlap.
- No api/engines change planned; if a finding needs one, it is a row with files, not a fix here.
