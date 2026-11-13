# CON-ERP-IDEM · POST /api/connectors/erp-ingest: the lost effect and the key order (11 Nov 2026)
Source: a critic review of routes/connectors.js (processErpDocument) and docs/critique/API-4-connectors.md:8; IETF draft-ietf-httpapi-idempotency-key-header-08; Stripe idempotent requests.
(a) Assumptions checked
- A failed emit is finalised 'failed' and the door answers 200: TRUE (routes/connectors.js processErpDocument catch, then res.json). A retry is 'duplicate' with chit_id null, so the effect is lost.
- /ingest answers 503 CHIT_NOT_DELIVERED for the same fault: TRUE (routes/connectors.js ingest catch, tests/sec3-device-keys D1). Reuse that word and code.
- The global Idempotency-Key middleware covers this door: FALSE. It scopes by bearer token; the agent sends X-Bridge-Key, so it calls next() untouched. The door must key itself.
- connector_receipt can key on a header or doc_ref: FALSE. Its one unique index is (actor_id, payload_hash). A new column and index are needed (migration b852).
(b) Conflicts: none. The 422 reuses the registered IDEMPOTENCY_CONFLICT. No new money path; the chit emit is unchanged (emitSignalChit). money_writes is not touched.
(c) Simpler way: none that keeps a retry safe. Not storing 'failed' at all would lose the receipt ledger row.
(d) Risks
- b852 must run before the key order applies; before it, the door keys on the payload hash as today (schema check), but the 503 and the re-claim still hold.
- A stale 'pending' re-claim can double-emit if the first emit is merely slow: the limit (5 min, env) is far above one DB transaction.
- doc_ref as the key turns a same-ref different-body push into 422; the agent must park such an event, not retry it.
- Twin: no web change.
(e) VERDICT: BUILD WITH CHANGES (the key column; reuse CHIT_NOT_DELIVERED and IDEMPOTENCY_CONFLICT; keep the old behaviour until b852 has run).
- b853 (11 Nov, critic): the old unique index drops in its own file, 2 minutes or one restart after b852, so an instance with a cached 'no column' answer never writes a row the new index cannot see.
