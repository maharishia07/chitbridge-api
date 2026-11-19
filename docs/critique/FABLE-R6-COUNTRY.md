# FABLE-R6-COUNTRY (api half): the three HIGH findings of docs c183c323
Twin of chitbridge-engines docs/critique/FABLE-R6-COUNTRY.md (the full critique: assumptions, risks, sources). Written BEFORE the api code, 2026-11-14, cb-accounting. Rides batch H, after G and B6b (ACC-354).

(a) Assumptions checked in the api
- R6-01: walkIn fills only a MISSING buyer country (lib/tax-lines.js:181-205), so a real foreign party stays cross-border: TRUE. No chit slot says "export": TRUE (grep business_json.is_export: none). The engine copies in lib/tax.js are adopted files (never edited here): the answer changes at the adopt.
- R6-02: lib/bill-paper.js holds for the buyer only (heldOf): TRUE. The api holds no turnover, so the digit count is never checked here, presence only.
- R6-03: no api file outside the adopted copies reads rateOnMenu: TRUE. lib/tax-packs.js already carries it (adopted v1.86.0), so this half works before the adopt.
(b) Conflicts: one new chit key (`business_json.is_export`) with its docs/FIELDS entry; two new register codes (INVOICE_HELD_HSN, INVOICE_HELD_RATE) in docs/error-codes.json and ERROR-CODES.md; the held answer stays 200 with a CODE the till branches on, never prose. Held, not refused (Athi Q1 30 Oct: HELD). No second rate check: the one reader is tax-packs.rateOnMenu.
(c) Simpler way: none. bill-paper is the server's one reader of the paper at send; widen it, add no module.
(d) Risks: after the engines adopt, the IN registered-buyer tests of tests/bill-paper.test.cjs need an HSN on their lines (done now, harmless before); POST /api/tax/compute and /api/invoice/build take no export answer (COMPUTE_BODY is closed: a contract change for cb-api, named in the PR); the till and web have no export control (cb-counter); round trips unchanged (no query added).
(e) VERDICT: BUILD WITH CHANGES: (1) presence-only HSN here; (2) the export question left to the till's door, the api carries and reads the answer; (3) the two public compute routes wait for cb-api's contract sign-off.
