# GOV-AU1 · critique (written before any code) — identities.country loses DEFAULT 'IN'

(a) Brief's assumptions, checked
- The default exists: TRUE — db/schema.sql:22 `country VARCHAR(2) DEFAULT 'IN'` (000_baseline). Registration names it only on a guess: TRUE — routes/entities.js:96–105 (FX-AU1).
- 12 writers: TRUE — lib/source.js:19 · lib/local-identity.js:111,180 · routes/integrations.js:255 · entities.js:104 · network-design.js:461 · catalogue.js:551,759,857 · connectors.js:101 · actors.js:309 · governance.js:118. Only entities (on a guess) and network-design name a country today.
- ≈7 `|| 'IN'` readers: TRUE, 13 — network-design:473 · till:2030 · kyb:37,94 · books-store:34 · books:54,866 · books-hooks:122 · books-todo:66 · entity-header:50 · licence-rules:36 · profile:297 · privacy:148. Zone readers (crm:83, crm-followups:38, books-pack:54, books-period:34, repeat-supply:246) feed `books-hooks.zoneOf`, which itself falls back to India's zone.
- A shop with no country is asked by Country setup: TRUE — lib/country-setup.js profile/gate (NO_COUNTRY via regulation.status(null)).
- A walk-in with no country takes the shop's: TRUE — lib/tax-lines.js:113 walkIn; tax-copy.partiesFor already passes NULL through (tax-copy.js:77). No change needed there.

(b) Conflicts
- None with DECISIONS 2026-10-03 (no silent India) — this finishes it. b299's backfill treated NULL as India; it has run already, so new NULL shops are not backfilled (correct: they get the step).
- The setting is identities.country (jurisdiction layer, bound once constituted) — no new key.

(c) Simpler way
- A guard (tests/identity-country.test.cjs, modelled on entity-kind.test) that every INSERT names `country` — replaces remembering, as entity_kind did.
- A party/actor a shop adds takes the shop's country in the SAME statement (`(SELECT country FROM identities WHERE identity_id = <shop>)`) — 0 new trips.

(d) Risks
- NOT NULL targets: privacy_request.country (b307) and books_setting.country (b272) are NOT NULL — a NULL shop must be REFUSED in words there, not 500.
- The day cut: zoneOf(null) = Asia/Kolkata (books-hooks:224). A day boundary, not a stated country — out of scope; queued (one line in the report).
- profile.js:191,211 hard-code origin 'IN' for export readiness — a literal, not a NULL fallback; queued.
- Migration number: b376 (reserved). No engines change. No web change (web has no `country || 'IN'`).

(d') Out of scope, stated: b174 identity_documents.country — its one writer (routes/identity-docs.js:248) names the shop's country (or '' when none); the default never fires: no bug. b272 books_setting.country — its one writer (books-store:34) wrote `|| 'IN'` in CODE: the same bug, small → fixed here (books.enable refuses NO_COUNTRY).

(e) VERDICT: BUILD WITH CHANGES — add the static guard; NOT NULL targets refuse in words; the zone fallback and the export-readiness 'IN' literal are queued, not built.
