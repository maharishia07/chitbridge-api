# GOV-SPIN — critique before build (rule 00, 2026-10-14)

**(a) What the brief assumes, checked**
- `installation` has no country — TRUE: api migrations/b74_platform_governance.sql:7-21 (region is `IN · US · MX · EU`, a zone of governance, not a country — base allows `"EU"`, b74:34); lib/govresolve.js:30 selects no country.
- Register takes the country from the browser's time zone — TRUE: app/govcontext.js `countryOf` (zone first), register-form.js:129 sends `CBGov.payload`.
- GOV-AU1 removed the 'IN' default — TRUE: api migrations/b376_identities_country_no_default.sql; registerNew names NULL with no guess (routes/entities.js:107).
- "registerNew writes the ACCEPTED country" — HALF FALSE: the panel and reg-agree sit on the CODE step (register-form.js:84-86), AFTER the register POST. registerNew can only write the OFFER (installation first, else the browser); the acceptance (and a chosen other country) arrives at verify (routes/signin.js:469-511, the `agreed_at` + `signup_context` audit row). Moving the panel before the POST would move reg-agree and break mintEntity (e2e/fixtures.js:168).
- `toolset/local-stack.sh` / LOCAL-STACK.md — UNKNOWN here (C:/dev/toolset is not on the runner). The runner's local api is e2e/lib/real-stack.cjs, which already passes `process.env` through (real-stack.cjs `Object.assign({}, process.env, …)`): `INSTALLATION_KEY=au-test` works today; documented, not re-plumbed.
- Spin scripts exist — TRUE: api deploy/spin-lib.sh:100 sets `INSTALLATION_KEY=cbspin-<id>` but never writes its `installation` row → every spin resolves `fallback`. Widened: `CB_SPIN_COUNTRY` writes the row at migrate time.
- Packs carry the panel's defaults — MOSTLY: currency · fiscalYear.startMonth · locale.format/langs · tax.scheme are uniform; the tax-ID NAME is not (IN `export.taxScheme` 'GSTIN', AU `abn`, AE `trn`). Engines ask (not this round, rule 12): `pack.tax.idName`. Built from those keys meanwhile.

**(b) Conflicts found**
- verify's auto-mint stamps `installation_key` by vertical else the literal 'platform-0' (signin.js:526) — a spin's shops would be stamped India's platform. Fix: else `INSTALLATION_KEY`.
- cap-country.js:130 (CX0) lets the CLOCK's country win over the server's before setup is done — it would silently undo an accepted "This ChitBridge runs in Australia". Fix: the clock wins only when the server's country has no source.
- Tighten-only for country: the envelope has `allowed.regions`, no countries. Widen `allowed` with an optional `countries` (null = every registered pack) — no new store.

**(c) Simpler way** — no new route: widen the public `GET /entities/constitutions` (register-form already calls it before the code step) with `installation {key, country, name}`, `countries` (country-setup.countries(), widened with tax + languages) and `allowed_countries`. Source codes go in ONE new column (`signup_context.country_source`); the shopkeeper words stay in b299 `setup_source.country`.

**(d) Risks** — migration b382 (installation.country) + b383 (signup_context.country_source); code reads both behind `schema.hasColumn` so nothing breaks before they run. Seed rows au-test/ae-test/in-test go in `migrations/seed_local_installations.sql` (skipped by tools/migrate.cjs? — NO, it only chains `bNNN_`; the seed is applied by hand / the walk). Verify may CHANGE the country only while country setup is not done AND the shop holds nothing (country-setup.isConstituted) — no transaction can be moved. Twin landing: api first (web tolerates an api without the new keys).

**(e) VERDICT: BUILD WITH CHANGES** — acceptance stored at verify (offer at register); spin row via CB_SPIN_COUNTRY; CX0 fix; verify mint uses INSTALLATION_KEY; tax-ID name from pack keys until engines `tax.idName`.
