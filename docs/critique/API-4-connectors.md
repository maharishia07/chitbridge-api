# Critique · API-4 sweep: connectors (14 routes of routes/connectors.js) · written before the first route edit

(a) The brief assumes, checked against the code
- 14 routes, mounted at /api/connectors (server.js:412): TRUE. The register counts 14 rows of routes/connectors.js, all "not started".
- Two of them are read by programs we do not redeploy with the api: POST /ingest (a Pi or gateway with its X-Bridge-Key; scripts/connector-gateway-sim.js is the reference caller) and POST /erp-ingest (the ERP agent; scripts/erp-connector.js, the connector kit). A 2xx makes the agent move the event to sent/, a non-2xx keeps it for retry (SEC3). The readable agent code (tools/tally-connector/core.js `call`) parses the body as JSON whatever its content type and shows `j.message || j.error`; scripts/erp-connector.js does `reply.json()`. So a refusal that keeps `error`, `code` and `message` byte for byte and gains the Problem fields is read the same. Every status, key and word of these two doors stays.
- Every refusal is a bare `res.status(N).json({ error, message[, code] })` (about 40 sites) and every 5xx goes through safeErr, which answers one constant sentence: TRUE. The gate `requireConnector` and the key door `deviceActor` write raw too, so every gated route would stay "error_shape no" until those two speak Problem.
- The ingest 200 carries `folder_error` (line 450, filled at 392 with `e.message`) and `proof_err` (line 641, filled at 612 with `e.message`): raw exception text in a success. KNOWN FINDING, listed, not fixed (round-1 rule 1): POST /ingest is never signed at 7/7 whatever its columns say. For POST /erp-ingest the same trace shows NO raw text: `note` is built with safeErr, the one constant sentence.
- A second finding the trace gave (not fixed): POST /erp-ingest answers 200 `outcome: "failed"` when the outcome chit could not be delivered. The agent reads a 2xx as "sent", and a retry of the same document is the receipt's idempotent `duplicate` with no chit. For cb-connect (API-4c), the opposite of POST /ingest, which SEC3 made a 503 for this reason.
- POST / branches on `type` (iot or erp, line 169): FLAGGED. The same door makes two different things (an IoT device with or without a key, an ERP connector with a key). The schema names the fields; it is not split and the `type` enum is not declared, because the chain's `isIn` on an array value (`["iot"]`) passes and the handler then treats it as neither, so an enum in the schema would refuse something answered today.
- The "other" doors (GET /integrations/*, routes/integrations.js) read `health` from this file; unchanged.

(b) Conflicts with existing rules
- Existing tests that read this file keep passing unchanged (sec3-device-keys, connector-rows, honest-failures, write-route-gate, ingest-iot-offline).
- A body that is not an object is a new 400 on the five owner write routes (it was taken as an empty body). No web caller was found sending a list (cap-connector.js sends objects). The two device doors take a list or an object in the schema (`list: true`) so NOTHING new is refused on /ingest and /erp-ingest.
- Query paging (`page`, `limit`) is NOT declared on the three lists: a doubled value would become a new 400; it stays undocumented rather than refused.
- The step-up code (`verifyOtp`) answers its reason (OTP_WRONG, OTP_LOCKED, OTP_EXPIRED) only to the sign-in log, "never the body" (SEC-81: no "locked" on the door). The Problem's `code` would reveal a lock, so a wrong or locked code is one code (OTP_WRONG); only the expired one differs, as its sentence already does.

(c) Simpler way: none. lib/contract-kit.js, lib/products-contract.js (said, failed), middleware/validate.js (validateAsProblem: the same chains, the same "Validation failed" body, as a Problem) and tests/lib/problem-world.cjs are the construct of the merged sweeps. Widened, not forked: nothing. The express-validator chains stay the verdict (their words are the frozen words); the schema names the fields and refuses only what is not an object.

(d) Risks: SEC area (key door, step-up) and the outward agents. No code that issues, hashes or checks a key, the step-up code, chit minting or any success body is touched. `deviceActor` becomes a gate (`deviceKey`, with `addsStatuses`) that runs in the same place as before: after the validation, before the handler; same statuses, same words. A 5xx loses nothing it said (it said one constant sentence already).

(e) VERDICT: BUILD WITH CHANGES.
- 12 routes to all seven machine columns, signed by nobody (human{} stays unsigned).
- POST /ingest: built to the same columns but NOT 7/7 by rule (the 200's raw exception text), and connectors.js is not added to HELD_FILES for the same reason.
- A route that answers 200, 403 or a library 400 for an unknown id stays partial on error_tests (none expected: every `:actorId` door looks the row up under the caller's own shop first and answers one 404).
