# Critique · T2-POLICY (POL1 + SET4) — written before any code, 2026-10-14
(a) What the brief assumes, checked
- Flags defined twice — TRUE: lib/policy.js:28 `FLAGS` and web public/app/cap-admin.js:5657 `POLICY_FLAGS` (14 rows: label · help · level · gov · labels · scale).
- ~17 direct writers of identities.policy_flags — TRUE, worse: 22 statements in 10 files (network-catalogue ×3, network-offers ×4, person-session, country-setup:231, profile ×3, counters:46, entities:744, till ×2, keys ×6). Most write NON-flag state (api_keys, counters, devices, network_*, profile_provenance, storefront_exposure) — so `patchKey` must take a PATH, not only a FLAGS key.
- `policy.set` exists, merges (`||`), but is not transaction-aware (no db handle) — TRUE (policy.js:451).
- Owner-only flags are hard-coded in the route (routes/entities.js:261-266, system_folders · books) — "who may change" is not data yet. TRUE.
- Tax ID/address in two stores, three writers — TRUE with a correction: governance.js:342 is PUT /profile/vault (the vault's Business identity rows tagged gstin/address = store 2); the column writers are entities.js:988, country-setup.js:230 and profile.applyProfileMap:261 (4th, the profile sync). Readers (invoiceParty, profileValues) prefer the VAULT row.
- GSTIN assumption — TRUE: entities.js:836 `isLength({max:15})` + "A GSTIN is 15 characters" for every country; country-setup.clean:157-171 already has the pack's check (IN checksum · AU abn.check · AE trn.check).
- MAINT-1 baseline doc / tools/maint1 / area READMEs — UNKNOWN: ../chitbridge-docs is an empty checkout on this runner. Metric commands are written into the new guard instead.
(b) Conflicts with standing rules
- Settings pack: "one place a flag is defined; the server decides may/why" → the card's labels/help/gov move INTO FLAGS (`ui`), owner-only into FLAGS (`may`); the web keeps rendering code only.
- Money/round-trips: none may rise — `patchKey` returns a SQL fragment so country-setup keeps ONE statement; keys/counters keep their one-statement concurrent merges (array element merge by id).
- e2e/policy-reachable.cjs counts a flag reachable if its key appears in web code; after the move the key comes from the server → the walk must also accept a FLAGS row with `ui`.
(c) Simpler way: none that also deletes the copy. Keep RFC-7386 null-deletes OFF by default: today's writers store `held_by: null` etc. and readers rely on it.
(d) Risks
- DATA/MONEY: flipping invoiceParty to read the column first would change a PRINTED tax invoice for any shop whose vault GSTIN differs from the column — unmeasurable here (no DB). So readers are unchanged this round; the vault save writes gstin/address THROUGH the one writer, so the column (the record) follows every edit and the two cannot drift further.
- Tightening: PATCH /entities/profile now applies the pack's tax-ID check (was: ≤15 chars). A wrong India check digit is refused in words, as country setup already does.
- SQL-shape stubs in tests (claim-series, person-session, bills-*, country-setup) must follow the new statements.
- No migration (b448–b450 unused). Twin: api first, web second (web reads `schema[k].ui`; an old api → card says "could not read").
(e) VERDICT: BUILD WITH CHANGES — patchKey takes a path (non-flag state included); readers keep their precedence (write-through instead of a reader flip); measurements from the guard, not MAINT-1.
