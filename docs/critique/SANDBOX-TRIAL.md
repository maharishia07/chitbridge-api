# SANDBOX-TRIAL critique — local OAuth to three vendor sandboxes · raw pulls kept · replay through the move-in
**VERDICT: BUILD WITH CHANGES** (listed under e). Base: api `origin/main` 21769761. Full G1 + G2: C:/dev/docs/23-connectors-and-integrations/SANDBOX-TRIAL-REQUIREMENT.md.

(a) What the brief assumes, checked
- "reuse lib/dev-otp.js isSealed()" — TRUE (lib/dev-otp.js:52-53), but NOT ENOUGH: it trims NODE_ENV, and production once carried " development", which reads as unsealed. isLocalStack() (:60-65) also needs NODE_ENV development AND a 127.0.0.1 database.
- "run it through OUR existing move-in / connector mapping" — TRUE for Xero and QBO: lib/move-in.js plan/apply (:196, :437) take field-keyed rows (cells, :155). FALSE for Zoho: SOURCES is xero|qbo (:37) and the tax map is reg-au moveIn only (lib/reg-au.js:553). Zoho's mapping lives in tools/tally-connector/adapters/zoho.js (readProducts :116, readProfile).
- "C:/dev/samples is outside every repo" — FALSE: C:/dev is the docs repo; samples/ added to C:/dev/.gitignore.
- The local stack serves C:/dev/chitbridge-api (toolset/local-stack.sh CB_API_DIR), not this worktree — the morning step sets CB_API_DIR.

(b) Conflicts: none with the rail or the money unit — no amount or tax is computed here; amounts go through MI.toMinor, tax codes through moveIn.supplyKindFor, as the planners do. "sandbox" already names a test world (lib/istest); kept because the redirect URIs are registered with the vendors.

(c) Simpler: none. One OAuth helper for three vendors (lib/sandbox-oauth.js); the kit's Zoho tokenCall (adapters/zoho.js:28) stays in the kit, which ships standalone.

(d) Risks: secrets — read from .env.sandboxes at runtime, never logged or sent to the page. Data — tokens and pulls outside the api repo, ignored by the docs repo. server.js is shared — one guarded mount line. No migration, no engines change, no web change.

(e) Changes: (1) mount when !isSealed() AND isLocalStack(); (2) apply in ONE transaction that rolls back unless --keep; (3) Zoho replayed through its connector adapter with a fetch that serves the saved files.
