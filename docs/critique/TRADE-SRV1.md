# Critique · TRADE-SRV1 — trade lanes for every country and honest defaults (written before any code, 2026-10-14)

**VERDICT: BUILD WITH CHANGES** (the requirement doc CB-TRADE-REQUIREMENT.md is NOT in the runner — ../chitbridge-docs is an empty checkout; built from the brief's G1–G8 lines).

## (a) What the brief assumes, checked
- G1 "AU and AE lanes are missing" — TRUE: `migrations/b91_trade_lanes.sql:55-58` seeds only EU · US · GULF · IN; `jurisdiction.domestic` is a stored India flag (`'IN' … domestic=true`).
- G2 "India origin / paint sector are defaults" — TRUE, in five places: `lib/readiness.js:133,151,163,176` (`'paint'`, `'IN'`), `lib/profile.js:189-190,210,212` (`['paint']`, `['EU']`, `['IN']`), `lib/forms.js:42,104` (`fn:'india'` → "India"), web `cap-readiness.js:149,162,268,295-303` (`'IN'`, `'paint'`, `'EU'`, a hard-coded destination list, `_mapOrigin` folding AE into GULF and anything unknown into IN).
- G3 "no abroad read on the chit lists" — TRUE: `routes/chits.js:2007 chitFilters` (the one filter builder Order · Task · folders share) has folder · amount · date · priority · status · assignment · dispute, no counterparty-country term. `identities.country` + `chit_header.all_recipients[].entity_id` / `sender_entity_id` carry what it needs.
- G5 "papers are not read by deal" — TRUE: `lib/forms.js:209 listInstances` returns the last 100 with no `context_ref` filter and no `total/page/limit` (DISCIPLINES §2 — every list paginated).
- G7 "the day's rate from the server" — PARTLY: `lib/fx-rates.js:108 rateOn` is the one reader and `GET /api/books/fx-rates` lists rows, but nothing answers "the rate for THIS day" in one read, and the commercial-invoice form (`lib/forms.js:53`) carries no exchange-rate field.
- G8 "may/why on trade writes" — TRUE: `POST /governance/compliance|verify`, `PUT /governance/profile`, `POST /forms/:key/issue|sign|attach` take `auth` only; an API key or a viewer co-assist can write, and no GET says may/why (`fxMay`, `routes/books.js:1308`, and `lib/people.js:17 ok/no` are the pattern).
- G4 packing-list form / G6 fields — UNKNOWN without the doc: G6 done small (exchange rate · tax-id word per pack); G4 listed for next round.

## (b) Conflicts with DECISIONS and existing constructs
- "No silent India" (DECISIONS 2026-10-03, CS1 `lib/country-setup.js:8`): origin MUST come from `identities.country` or be asked — never `'IN'`. Siblings grepped: sector, destination list, "GSTIN" labels in forms, the "Domestic (India)" lane name.
- One place per thing: `domestic` is DERIVED (dest == origin), not stored; the abroad term lives in `chitFilters` only; may/why is ONE helper both routers call.
- The server decides: a sentence the client branches on ships with a code (`TRADE_ORIGIN_UNSTATED` · `TRADE_SECTOR_UNSTATED` · `TRADE_READ_ONLY` · `TRADE_KEY_NOT_ALLOWED`).
- Money: a rate is evidence (FX1) — the day's rate is READ by `rateOn`, never fetched or computed; the form shows it as a derived field with its source and day.

## (c) Simpler way
Same outcome, less: no new routes. `?on=` on the existing rates read; `?context_ref=` on the existing instances read; `abroad=1` as one more term in the shared builder; may/why as keys on the GETs the screens already call.

## (d) Risks
- Migration b571 only (b572/b573 unused); code works before it runs (AU/AE lanes simply absent; `schema.hasTable` not needed — reads already catch). Twin landing: api first (web paints the server's lanes/may; stand-ins carry the new keys), the contract re-written with `--write` and byte-copied to web.
- No engines change. Other rounds: `routes/chits.js` and `routes/books.js` are hot files — additive one-line edits only.
- Round-trips: lanes/readiness gain ONE read (the shop's country); budget lines added by hand.
