# STD2 critique — one reading per fact, no India for an unstated country (written before any code)
(a) Brief vs code. TRUE: two tax-ID readers — profile.js:278 `taxIdWordOf` ('GSTIN' with no pack) and country-setup.js:66 `taxIdOf` (null);
 web helpers.js:35 PACK_WORDS falls back to India; cap-shop.js:234 a CBLocale-region table; till.html:5879 its own `taxIdLabel`; cap-books.js:456
 a 4th (`p.abn ? ['ABN'…]`); till.html:20318 a 5th. TRUE: cap-shop.js:324 writes SESSION.country. TRUE: register-form.js:58/81 compute source
 and zone, :92 a months list, :70 an RTL regex, :174 `you@business.in`, :249 "(check endpoint / stage)". TRUE: settings.html:112 re-writes
 cb_sess without `duty`; signin-ui.js:154 `keep` is not exported. TRUE: books-store.js:34 `|| 4` / `|| 'INR'`, network-design.js:477 `|| 'INR'`,
 till.js:785 + profile.js:312 `|| 'INR'` (the till's money comes through invoiceParty — fixing till.js alone changes nothing). TRUE: till.js:438
 literal 'IN'. TRUE: 5 INSERTs repeat the country sub-select. TRUE: b382 header says govresolve probes `hasColumn`; govresolve.js:28 reads
 through to_jsonb (no probe). FALSE: `cb_entity.currency_code` — the shop's money column is `identities.currency_code` (db/schema.sql:23,
 000_baseline); cb_entity (net03) has the same default. b400 drops both (cb_entity only if it is a table).
 FALSE-ish: CBLocale's direction helper `dir()` (locale.js:526) takes no language — it answers for the page's language only, and locale.js is
 engines-owned (do not edit).
(b) Conflicts: the page cannot know the offered zone without the device zone → GET /entities/constitutions takes `?tz=` (public, validated by
 zoneOk) and each `countries[]` row carries `offer {timezone, from, source}` from offerOf + ONE `sourceOf` shared with acceptAtSignup.
 csuCountryName reads Country setup's own list → widened (additive) with an optional list. No new route, no new key on a stored slot.
(c) Simpler: the till gets the word from the server (`shop.tax_id_word` = profile.taxIdWordOf) instead of a second pack reader on the page;
 the language row isolates every own-name in `<bdi lang dir=auto>` — the browser's bidi does the direction, no list (engines ask: `dir(lang)`).
(d) Risks: money — a shop with no currency now gets `null` from invoiceParty/till /shop (the till's own `|| 'INR'` paints remain; ~40 api
 `|| 'INR'` readers of chit money are siblings NOT in this brief, listed in the PR). b400 is not run here (Athi). Twin landing: api first
 (constitutions offer, till tax_id_word), web second — the web falls back to 'chosen'/no-zone words on an older api. Engines untouched.
(e) VERDICT: BUILD WITH CHANGES — identities.currency_code (+ cb_entity guarded) in b400; `?tz=` on constitutions; dir via bdi auto (engines ask
 `CBLocale.dir(lang)`); cap-books + till 20318 copies also removed; profile.invoiceParty money fixed with till /shop.
