# Critique · STD1 (written before any code, 2026-10-14) — FX-F10W to standard (review MUST-FIX 1 · 2 · 5 · 6 + web #218)
Docs repo (`../chitbridge-docs`) is EMPTY on this runner: REVIEW-standards-2026-10-14, finance/counter READMEs and DISCIPLINES read from the brief only.

## (a) What the brief assumes, checked
1. park() writes the wait kind only as `waiting: acceptance|party|…` (`lib/books-hooks.js:553`, job at `:704`); `todo` is DERIVED from the sentence by regex (`todoOf`, `:925`) — TRUE. Web regexes: `cap-books.js` bkWaitTodo fallback + bkWaitFailed (`:2172`) + bkWaitWho (`:2199`), `chit-sheet.js:152-158` serverSaid, e2e `lib/books-api.cjs:65` — TRUE.
2. Counts: `waitingWhys` reads every sentence (`books-store.js:474`), books-todo counts the 200-row page (`books-todo.js:55`), Home counts the 50-row health page (`index.html:168`) — TRUE: >50 / >200 rows under-count.
3. Two supplier-by-name matches in the api: `receiptFacts` (`books-hooks.js:612-629`) and `bill-use.linkParty` (`bill-use.js:169-172`) — TRUE (same SQL twice). Till: `custKnown` (`till.html:7018`) and `rcvSupplierKnown` (`:6988`) both "exactly one by trimmed lower name" — TRUE.
4. "docOf on the chit read" and "the chit read's may/why" — PARTLY FALSE: GET /chits/:id answers rail `actions` (`routes/chits.js:2602`, rail.WHY vocabulary) but no doc class and nothing about the books' wait. The sheet guesses the class (`chit-sheet.js:62`) and greys from the global BK.waiting. → widen the read (0 new trips: one more scalar in the ONE_SHOT statement).
5. "The shared status map": the engine's `workflow.js` OPEN_NEW/CLOSED is not loaded on accounts/finance and engines are serial; chit-sheet already holds the three sets once in actionsFor (`:125`) while read()/move() repeat them as regexes (`:372,:406`) — lift to one map in the sheet.
6. Empty catches on changed lines: `chit-sheet.js:403,406,407`, `cap-books.js` bkLinkSupplier/bkAddSupplier `catch (_) {}` — TRUE. bkWaitAddSupplier repaints the whole view (`bkWaitingView`) — TRUE.

## (b) Conflicts with rules / constructs
- A code the client branches on: `todo` + `name` become DATA on the outbox row's event (park), never re-read from prose; old rows classified ONCE on the server (one SQL fragment, persisted by the retry path's backfill).
- The server's may/why: Accept's grey comes from the chit read's `actions.accept` ({ ok:false, why:'books_waiting', say }) — the rail stays pure; the read composes.
- DISCIPLINES §2: /health's waiting stays a page of 50, with top-level `total · page · limit` and `todo` counts from one GROUP BY.

## (c) Simpler way
- No migration: `todo`/`name` live in the existing `event` jsonb (b397-b399 unused). One SQL fragment (`TODO_SQL`) is the classifier for old rows in reads AND the backfill — no JS twin.

## (d) Risks
- Twin landing (web #218 + api #169, same branch name): land api first or together — the web reads `todo`/`total` that only the new api sends; the till copy must match (vendor-till).
- Contract: /health gains `total·page·limit·todo`, waiting[] gains `name`; chit read gains `doc`·`books_wait` → web-api.json --write + fixture byte copy.
- The ONE_SHOT read falls back whole if a table is missing: books_outbox exists since b273, so no new fallback risk; the fallback path sends `books_wait: null`.

## (e) VERDICT: BUILD WITH CHANGES
1. may/why for Accept is composed on the chit read (rail verdict, then the books' wait) — the rail engine is not changed. 2. Status sets: one map inside chit-sheet (the engine's map is not loadable there). 3. The 'not on your supplier list' wait (an on-rail seller) stays `record` — adding a local party by name would duplicate a rail party.
