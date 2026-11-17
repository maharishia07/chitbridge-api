# TEST-INGEST-IOT critique — written before any code (rule 00)

(a) What the brief assumes, checked
- PARTLY TRUE: ingest routes are `routes/connectors.js` `/ingest` (:319, IoT) and `/erp-ingest` (:409, Tally/Zoho/ERP). "No tests where there are none" is FALSE for part: `tests/sec3-device-keys.test.cjs` already covers capability off (B), foreign `to` (A), failed chit ≠ 200 (D), stats root-only (C3 "200 with counts"), Zoho tax list (F); `tests/move-in.test.cjs` covers the Xero/QBO CSV move-in.
- TRUE gaps: no test for a missing/unknown/inactive key (:`deviceActor` 401), malformed bodies (validate → 400), a non-object ERP payload, IoT key on /erp-ingest (409), ERP replay idempotency (`processErpDocument` ON CONFLICT → `duplicate`), a malformed `bridge_id` (404), the exact stats counts shape (`lib/events.js:118`).
- UNKNOWN: a "Zoho/Tally payload" route — there is none; Tally/Zoho arrive via the same `/erp-ingest` with an arbitrary `payload` object (adapters live in tools/tally-connector, tested via F in SEC3).
(b) Conflicts: none. Tests only; reuse SEC3's stand-in db pattern (no DB, no network). `/ingest` has no `auth` by design (device key).
(c) Simpler: extend sec3-device-keys instead of a new file — rejected, that file is already 200 lines and a guard; a sibling file `ingest-iot-offline.test.cjs` registered in scripts/guards.cjs is clearer.
(d) Risks: none for data/money/migrations (no migration). Other rounds may touch scripts/guards.cjs (one-line add, merge-trivial). Validation 400 has `details[]` but no top-level `message` — a test finding, noted, not changed unless a 200 appears.
(e) VERDICT: BUILD WITH CHANGES — new sibling test file for the gaps only; no route change unless a test finds a bug.
