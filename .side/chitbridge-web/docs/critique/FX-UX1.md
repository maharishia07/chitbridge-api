# Critique · FX-UX1 — Home's country notice (F1) · month-lock to-do from the ledger's first month (F2) · AU/AE number format (F6)

**VERDICT: BUILD WITH CHANGES** — F6's fix is a hydrate in the shell's one /me read, not new REGIONS rows (they exist); F2 is api-only.

## (a) What the brief assumes, checked
- F1 Home is silent on COUNTRY_SETUP_PENDING — TRUE: index.html `booksAlert` reads GET /api/books/health and `.catch(function(){})` drops every non-2xx; `read()` throws the status but not the body (index.html:132-139, 162-169). The 422 carries `{ code, message }` (api routes/books.js:56; sentence api lib/country-setup.js:265). CB Accounts already paints the same 422 as a card with the button to /settings.html#/country (accounts.html:650-657).
- F2 the month-lock to-do starts in April — TRUE: api lib/books-todo.js `endedMonths` lists every ended month of this FY and the last (:29-41) and `months_not_locked` counts all `open` ones (:96-100); `ensureYear` makes the FY's 12 periods whatever the day (lib/books.js:76-78). The ledger's first moment is `books_setting.enabled_at` (books-store.js:22), read as the shop's day by books-hooks.dayOf. The web only paints the server's list (no count of its own in cap-books*.js / accounts.html — grep `months_not_locked`).
- F6 "CBLocale.REGIONS has no AU (or AE) row" — FALSE: locale v1.42.0 (adopted, public/app/locale.js:98-104) has AU `en-AU` and AE `ar-AE`, and they equal the packs' own `locale` (engines reg-au.js:579, reg-ae.js:716). The real cause: only app.html calls `CBLocale.hydrate(locale_prefs, { country })` (app.html:4993). Home and the small apps never do, so `L.locale()` falls to FALLBACK `en-IN` (locale.js) → lakh grouping. The till's own note (till.html:4043) repeats the false claim; till is vendored from api — not touched here.
- "hydrate sets no region" — TRUE for the small apps only (no call), not for hydrate itself (locale.js:385-391 sets the country's region).

## (b) Conflicts with rules / existing constructs
- One read: CBAvatar.pull already GETs /api/entities/me on every shell page (avatar.js:198-209) and that row carries `country` + `locale_prefs` (api routes/entities.js:328-331). Widening pull to hand them to CBLocale.hydrate costs 0 trips; app.html (pull:false) keeps its own boot read.
- One sentence: Home shows the server's `message` verbatim; the button is the same door CB Accounts uses. locale.js is adopted — not edited; REGIONS stays the engines' table.

## (c) Simpler way
- F2 is one filter in the api (`month end ≥ first day of enabled_at's month`), not a web change; F6 is one line in avatar.js, not a locale-engine release.

## (d) Risks
- Twin landing: api (F2) and web (F1 · F6) are independent — either order. No migration (b367-b369 unused). No new route (round-trip budget unchanged; GET /todo stays one trip).
- F2's test rig enabled the ledger at a fixed 29 Sep — books-todo's "7 months open" now sets enabled_at to April (the case it meant) and a new check proves an October start counts October only.
- F6 on a first-ever visit: numbers painted before /me answers are en-IN for that one paint; every later paint (and visit) is the shop's format.
