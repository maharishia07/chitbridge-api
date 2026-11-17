# Critique · W1-CRM (written before any code, 2026-10-15) — base: api integrate/1014d · web main

## (a) What the brief assumes, checked
- "M2: five writes with no transaction (crm.js:337-351 vs :262-273)" — FALSE on the base. CRM-MINT1 already landed: `api lib/local-identity.js:265 addCustomer` is the one local-party helper; `routes/crm.js:287-294` (lead) and `:362-377` (walk-in, points claim on the same handle via `inTx`) each run inside ONE `withEntity`. Proof on the base: `tests/crm-remove-walkin.test.cjs` 8 ok · `crm-leads.test.cjs` 10 ok · `one-writer.test.cjs` 13 ok. Nothing to build; no api PR.
- "M3: per-stage scripts and a Next button on the call screen" — TRUE, open. `web public/app/cap-crm-calls.js` paints the queue as a CBList whose row opens (caret) to the server's six outcome buttons and nothing else: no script, no Next. `api lib/crm-calls.js:19` OUTCOMES carries no script and the queue already sends each call's `stage` (`:64`).
- "crm-calls.js (api) is an owner of M3" — a script is COPY keyed by the server's stage; the page already owns the words for the server's keys (`CALL_WORD`, `CRM_STAGE` in cap-crm-leads.js:10). Nothing for the server to decide → no route, no contract change (api `docs/contracts/web-api.json` untouched).
- Area home `C:/dev/docs/11-crm-and-marketing/README.md` and `C:/dev/DISCIPLINES.md` — MISSING: ../chitbridge-docs has no commits on this runner; the inline DISCIPLINES in the brief apply.

## (b) Conflicts with DECISIONS-level rules and existing constructs
- Rule 5 (no new style): the "call screen" is NOT a new screen. The script goes in the row's existing next level (`CBList next(row)`, list-ctl.js:684) in the CRM page's existing `.next` block (crm.html:203, the record's Next block); Next is a button in that panel (`.act sm ghost`, cap-crm.js:627). No new CSS, no new route.
- The server's may/why: the outcome buttons stay the server's table (greyed with its sentence); Next writes nothing, so it carries no why.
- CBList gets ONE additive method `open(id, on)` (list-ctl.js mount api) so a page can open the next row without faking a caret click — widen, never copy.

## (c) A simpler way
- Web-only: `CALL_SCRIPT[stage]` + `crmCallScriptHTML` + `crmCallNext` in cap-crm-calls.js; after an outcome saves, the row that followed opens by itself. A later per-shop script lives on the server as `call.script` lines; the page would prefer them over the default (one widening point).

## (d) Risks
- Contract drift pre-exists: web main's `e2e/fixtures/web-api.contract.json` ≠ api 1014d's master (segments · groups · tax routes); `e2e/contract.cjs` check 2 already fails on the base and this round must not copy the master (web main has no stand-ins for those routes). Reported, not fixed here.
- No migration (b637–b639 unused), no engines change, no money. Parallel rounds may touch cap-crm.js; this round touches cap-crm-calls.js, list-ctl.js (additive), walk-x-l2c.cjs, flows.json.

## (e) VERDICT: BUILD WITH CHANGES
1. M2: nothing built — already done on the base (proof above). 2. M3: web-only, in the existing row next level; api untouched. 3. Walk: widen walk-x-l2c.cjs (script · Next · auto-advance · rule 13 on the Calls tab).
