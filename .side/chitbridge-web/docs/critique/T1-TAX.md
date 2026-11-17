# T1-TAX — critique before build (rule 00)

**VERDICT: BUILD WITH CHANGES** — (1) the pin check covers EVERY engine both platforms pin, not only tax: it also found `rollup` (web 1.5.0, api 1.32.0 — the till still counts a despatch note as a bill) and `screen` (web 1.15.0, api 1.5.0). rollup is re-adopted at 1.32.0 here; `screen` is one NAMED exception with its reason (web is ahead, additive themes; the api moves in its own round) — the check fails if a new pair differs or the exception goes stale. (2) Engines: docs only (the matrix), so NO version bump and NO new tag. (3) The pack-content comparison goes in the api's tax-vendor test (twin api PR, same branch); the pin check is web's (`e2e/engines-pins-agree.cjs`), run in web CI with the api checked out the way walks.yml already does.

(a) Assumptions, checked
- web reg-* / regulation at 1.42 — TRUE: engines.lock.json `reg-in/reg-au/reg-ae/regulation: 1.42.0`; api at 1.45.0 (api engines.lock.json).
- 4260 fx_gain_loss + `pack.fx` arrive in v1.45.0 — TRUE: engines CHANGELOG v1.45.0 "Packs IN · AU · AE — ledger 4260".
- public/app/tax.js is a second copy — TRUE: lock `bundles` has public/engine/tax.js (packs+regulation+tax-packs+tax-slab+tax) AND public/app/tax.js (same minus tax-slab). Loaded by app.html:1693, accounts.html:325, finance.html:341, settings.html:82, crm.html:350 and 6 e2e harnesses.
- engines country-standard test RED on main — TRUE: COUNTRY-MATRIX.md line 1 says v1.44.1, package.json 1.45.0; only that line (and .json's) differ.
- "CI fails when pins differ" — web ci.yml has no sibling repo today (ci.yml:11-13); walks.yml already checks out chitbridge-api (public) with twin-branch logic → reuse that pattern.
- RECONCILIATION-2026-10-14.md — UNKNOWN: ../chitbridge-docs is empty on this runner; built from the brief.

(b) Conflicts: none with one-engine / adopt-only (files written only by tools/adopt.cjs; versions.json by api vendor-till with CB_WEB_DIR). One copy: pages switch to /engine/tax.js, which also carries tax-slab — app.html keeps /app/tax-slab.js (same pin 1.2.0, same global, no second answer).

(c) Simpler: none — re-adopt is a pin move + the tool; the check is ~40 lines reading two lock files.

(d) Risks: reg 1.45 adds a ledger and `pack.fx` (additive; no existing line moves — CHANGELOG). rollup 1.32 drops despatch/receive notes from the till's day count (matches the api). Twin landing: web first, then api (api tax-vendor reads web's bundle, works on either). No migration (b436–b438 unused). Engines serial: docs-only commit, no tag taken.
