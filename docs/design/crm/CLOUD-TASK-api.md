# Cloud task — CB CRM, Phases 3 and 4, API side (Sonnet)

**Outcome (one):** the CB CRM's API for Phase 3 (read-only CRM) and Phase 4 (one add, logging, follow-ups), exactly as
`docs/design/crm/PLAN.md` §Phase 3 and §Phase 4 list them, on this branch (`cloud/crm-api`), in a PR against `main`.
Never push to `main`. No secrets, never call a live site, **never run SQL**.

The spec files in this folder were copied from chitbridge-web `docs/design/crm/` (merged there as PR #18 and the designer
handoff #20). Read PLAN.md first, then DATA.md, BRIDGE.md, FLOWS.md and the REQUIREMENT-* files the routes serve.

## Decisions to apply (Athi is asleep; these are the plan's own recommended answers, marked as provisional in the PR)
Q3 high value = top 10% of customers by 12-month bill value, ≥ 3 bills, shop can change it, override wins · Q4 a party on
both lists = ONE party, two roles, one netted dues figure · Q5 no party ownership; assignment on follow-ups only · Q8 keep
in-memory up to 5,000 parties · Q10 "Remove from my parties" only with no open dues, hides the row, deletes no history.
NOT in this task: Phase 5 (mail, consent: Q1, Q11 wait for Athi) and Phase 6 (merge, link, import/export: Q2 waits).

## Already done on main (don't redo)
Customers by name (api PR #13): POST /customers takes `name` (+ phone, gstin) and mints `~owner.cus-NNNN` through
`lib/local-identity.mint(..., {kind:'cus'})`. It writes entity_kind 'supplier' today (behaviour right, word wrong;
Athi's decision pending); don't change it. Party numbers (P-NNNNN) at add (api #10). Books engines v1.14.0 adopted (api #14).

## Build
- Phase 3: new `routes/crm.js` (reads only): `GET /api/crm/parties`, `/api/crm/parties/:id`, `/api/crm/parties/:id/timeline`,
  built on the reuse points PLAN.md names (party-fields.decorate, SEGMENT_SQL, select.counterparties, measure,
  books-store.parties). `lib/local-identity.mayTrade` wrapping onRail + population, used by tillMaySend and till.js:213
  (BRIDGE.md §2). First readers of `merged_into`. SSE `message` on an external chit message. `high_value` in SEGMENT_SQL.
  Money shown is READ (stored dues / summary_json.money), never recomputed (DECISIONS: "compute once, everyone reads").
- Phase 4: `POST /api/crm/parties/:id/interactions`; `/api/crm/followups` CRUD; the nightly follow-up sweep → bell
  `followup`; walk-in → party (mint + rewards.claim). Migration **b276** (`party_interaction`, `party_followup`) written as a
  file headed `DRAFT — NOT RUN · Athi runs it`. Code that needs those tables must answer a clear 503 "not migrated yet"
  until it exists (the books pattern: BOOKS_NOT_MIGRATED), never a 500.
- RLS: every new table in `db/index.js` RLS_TENANT_TABLES and `db/rls-baseline.json` (the rls-guard test checks it).

## Proof (exit codes; commit the outputs in the PR body)
`tests/crm-*.test.cjs` (offline, the repo's pattern): the read model (a both-roles party is ONE row; a merged party is never
listed; another population never listed; dues equal the stored figures), mayTrade, mint `cus`, interactions and follow-ups
(with the tables stubbed), the sweep, the 503 before migration. Then `node scripts/guards.cjs` (all pass; CI is red for an
unrelated reason: three books tests need the sibling engines repo; say so). Do not run the full suite.

## Do not touch
`tools/tally-connector/` (the counter), the books engines files (adopted; `node ../chitbridge-engines/tools/adopt.cjs` is not
available in the cloud), other migrations, `.env`. Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
