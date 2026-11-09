# SHARED CHECKS 1 AND 2 — INPUT BOUNDS, AND "IS IT MINE AND IS IT LIVE" (DESIGN ONLY, NO CODE)

2026-11-09 · M · owner cb-api · Athi approved 9 Nov: stop fixing input and ownership bugs route by route; close them through two shared checks. Check 3 (the money balance per document) is a separate brief for cb-finance and cb-accounting. Base: api origin/main 820d69cc.

**VERDICT: BUILD WITH CHANGES (revision 2, 2026-11-09: cb-critic returned CHANGE, https://github.com/maharishia07/chitbridge-api/pull/1073#issuecomment-6729793413; its eleven must-change points are folded in. Where section 0 and a later section disagree, section 0 wins).** Both checks are widenings of constructs that exist. Two facts in the register change the plan (section 2): the two columns Athi named do not measure what the bugs are, so adoption needs a new proof, not just the old column.

## 0. REVISION 2 — what the critic changed (authoritative)

1. **Reuse.** (A) `partiesOn` (books-store.js:1218) is NOT live-aware in #1071 (only `partyOn` is, and it returns `removed`); `partiesOn` returns `{customer, supplier}` only, with no `ledgered` and no UPI-waiting system party. Slice 0d widens `partiesOn` to `partyOn`'s one row (one SQL shape; `partyOn` becomes its one-id call). The party resolver takes a ROLE (customer or supplier), not "a party": write doors ask which. (B) **No `isCostBlind`/`dropCostKeys`.** lib/cost.js already has `writeRefusal`, `costKeyRefusal`, `isCostBlind`, `dropCostKeys`, `costBlindBody`; the gap is per door: OPS-119 (supplies purchase) is a WRITE door that never called `costKeyRefusal` (adopt it there, one line); search, export and books reads need `isCostBlind` plus `dropCostKeys` (named per door in slice C). (C) **`B.day` is not a third reader.** It is an ajv format registered over the existing `isDay`; `books-period.dateGiven` and the copy at network-offers.js:97-108 call it in the same PR (grep the primitive, not the feature). (D) **`B.uuid` is dropped.** Path ids stay 404 through `uuidParam` (API-10); body and query ids use `namedentity.UUID` as the one pattern, refused 422. (E) **`B.amount({currency})` is dropped:** the scale depends on a currency in the same body or the shop, a cross-field rule; the catalogue major-unit doors (CAT-308/320) call `money.decimals` (engines copy, read only) in the handler. (F) `chit-ceiling.COLUMNS`/`ceilingOf` are already exported (no widening step); the table has 3 chit columns, so every other ceiling is a new row plus a real-stack information_schema test, as RAIL-205.
2. **Formats.** validate.js builds ajv with `strict: false` and ajv-formats is not a dependency, so an unregistered `format` is silently ignored. Slice 0a registers EVERY format a contract may name (`calendar-day`, plus any other it keeps) and adds a test that fails when any contract (body, query or response schema) uses a format that is not registered (silence is the bug).
3. **Outward key-scope routes (S13).** A route in KEY_ROUTES (auth.js:173) that accepted a value yesterday and refuses it tomorrow is a breaking change (cb-critic note on #743, POST /pricing/price). Each slice lists its S13 routes and either gives them the S28 notice or keeps them in shadow; each slice widens its routes' declared 4xx to what is used (status_codes column).
4. **The 404 rule, tightened.** A request with several ids (a body list, `lines[]`) is refused WHOLE and never names which id failed (that would be an oracle). The `removed` word from #1071 never reaches a different answer for own-deleted versus foreign. `mineAndLive` runs ALL kinds, then answers (no short-circuit on the first failing kind: a timing oracle). Latency foreign versus unknown is MEASURED on SIT once per kind, not asserted. A generated register case runs on stand-ins and proves the middleware is mounted, not that the SQL isolates shops: **each resolver has a real-Postgres two-shop test** (S41 isolation_ci, like #1071's realstack file). Business rules of a kind (actor "active, able to take tasks", product "not soft-deleted") live in the OWNER's file (cb-people, cb-catalogue); `mine-and-live.js` calls them. Peer-signed doors (ctp.js): the `chit` kind has no meaning there (see 7).
5. **Columns are for roll-out only, with a fold.** `bounded_input` and `mine_and_live` are REPORTED columns until a **dated, forward-only fold constant** (a code constant read from the BASE checkout, so a field the PR writes can never decide it; the date is Athi's, question (c)). From slice 0 a route a PR adds or changes is held to the FOLDED definition (R2-5 held-file rule). After the fold, `strict_input` and `foreign_id_404` carry the wider definition, the two names are retired, and the fold is **one re-signing PR** (signed routes failing the wider definition turn partial, no grandfathering). The fold is not "when counts reach zero for money, accounting and offers": it covers all ~638 routes on the date.
6. **Shadow mode, specified.** It logs route, field path, kind of failure and a count, never a value (output-allowlist.js pattern: bounded Map, `reportDropped`). `/health` keys: `bounds_observed` and `mine_observed`. The Map is capped at 1000 routes x 20 paths; at 638 routes with several fields each the cap is reached, so the counter keeps a per-route total beyond the cap and an `overflow` count that must itself read 0 before a flip. **Hostile SIT traffic** (the hunt) fills the counter, which proves the check fires but makes 0 meaningless: the web walks and the till e2e run in a window SEPARATE from the hunt's (hunt window read for "fires", walk window read for "0"). One SIT week per slice does not fit 12 slices, so ALL slices' shadows run together and enforcement flips per area. **Flip owner: Athi**, reading /health (as LEGACY_TOKEN_REFUSE). `mineAndLive` in observe mode still lets the handler's own lookup run, so shadow never changes an answer.
7. **Slices.** Slice 0 is split: **0a** formats + sentences + bounds.js + unit tests (pure, no route, no register); **0b** register columns, lint, exact route table, the census (item 12) and body/query foreign-id minting in tests/lib/foreign-id-world.cjs (it mints path ids only today); **0c** shadow counter + /health; **0d** mine-and-live with the party kind only, after #1071, with the `partiesOn` widening; other kinds arrive with the slice that needs them. New lib files also go in tests/engine-manifest.js INFRA_LIBS, and seams --write runs from an LF checkout. **ACC-330 moves** from the books slice to the chit and till send slice. Connector kit fixtures (Tally, Zoho, Xero write-backs) are opened in **slice 1**, not 8: money doors are written by them; per connector door the slice says whether it is keyed-outward (`tolerant_outward`, exempt) or a closed-body inbound (a closed body cannot be applied to a provider that adds fields, e.g. e-mail inbound). **CTP inbound** (ctp.js, `inbound_validated`; a peer on another api version): bounds are accept-and-quarantine or shadow ONLY, never refuse (a refused chit sticks in the peer's outbox). Slices are capped by HANDLER LINES as well as route count (slice 4 holds the largest handler in the api).
8. **Numbers.** 110 and 18 are UPPER BOUNDS (the critic's sample misfiled 5 of 13). The route mentions are a union: the six sub-rows sum to 117 mentions, the union with repeats removed is ~94. Refiled out of the checks: **CMP-45** (two validators disagree on one tax id: country), **CTR-232** (a status transition: counter), **SET-79** (a cascade on deactivate: settings; mineAndLive would stop only a NEW set), **CON-124** (stored-state growth cap, not an input bound), **OPS-119** (a missing `costKeyRefusal` on a write door: one-line adoption in slice 1). Corrected: check 1 = at most **108** (110 minus CMP-45, CON-124); check 2 = at most **15** (18 minus CTR-232, SET-79, OPS-119). The slice-0b exact table is the source.
9. **The till queue does not park a 4xx; it retries for ever** (web public/till.html:5897-5925: a bill row keeps `_tries`, backs off to 5 minutes, "nothing here parks or drops it"; only 401/403 other than TILL_SEND_REFUSED stops the queue; `postNow` 5575-5583 makes a 4xx FINAL for small writes). My earlier mitigation "park and show the sentence" was wrong and is withdrawn. **Till bill doors (POST /api/till/send, and chits send reached by the till) are ACCEPT-AND-FLAG** for date, quantity and amount bounds (clamp the posting day with a flag the owner sees, as `number_check` accepts and reports, till.html:5835), never refuse, until cb-counter builds a parked state and the till is re-vendored (ledger CTRY-77). Small till writes (quick keys, flags) may refuse. Verdict handed to cb-counter before slice 5. Question (b) for Athi.
10. **Status codes.** DATE_INVALID (400, since 2026-11-08) and CHIT_AMOUNT_TOO_LARGE (400, since 2026-11-09) are one and zero days old, so "frozen" was the wrong word. Question (a) for Athi: fold both to 422 INVALID_INPUT now (recommended; grep web for `=== 400` first), else keep 400 and give `errors[]` ONE field code for the same fault. Until he answers, sections 3 and 4 keep them as written.
11. **Athi's three questions are filed OPEN** in C:/dev/PM/ATHI-DECISIONS.md ("Shared checks 1+2"): (a) fold DATE_INVALID and CHIT_AMOUNT_TOO_LARGE into 422 now: OPEN, recommend yes; (b) accept-and-flag on till bills: OPEN, recommend yes; (c) fold the two columns on a named date with one re-signing PR: OPEN, recommend yes.
12. **`B.text` and the census.** "No control characters" would refuse newlines and tabs in narration and notes; each field says which are allowed (narration and notes: newline and tab; names: none). Slice 0b emits a census per touched route of the field types the web, till and connector senders actually send (web-api.json master plus e2e fixtures; e.g. web app.html:9184 and :14920 send `quantity: +item.qty || 0`, so a blank qty reaches the api as 0 today and `B.qty` would refuse it); a route whose sender would break is held out of its slice. Engines: bounds that read the engine (decimals, cash step, legal tender) are read only; the rest are DB-column ceilings.


## 1. What exists (looked first, widened, never copied)

`node C:/dev/seams.cjs` run one word at a time: validate, isCalendarDay, strict, schema, bounded, owned, partyOn, knownParty, foreign.

| Piece | Home | What it already does | What it lacks |
|---|---|---|---|
| `schemaValidate(operation, options)` | middleware/validate.js (76 users) | ajv over the route's own OpenAPI body + url schema; every field named; 422 `INVALID_INPUT` with `errors[]` (`MISSING_FIELD`, `UNKNOWN_FIELD`, `WRONG_VALUE`); `options.status/code/legacy` keep an outward route on its frozen 400 | no shared vocabulary of bounds: of 76 contract files only products-contract (1) and quick-keys-contract (2) use `maximum`. `type: integer` accepts 1e300, and `sentenceOf` has no sentence for minimum, maximum, format or maxLength |
| body engine is exact-typed, url engine `coerceTypes` | validate.js | a body `"false"` for a boolean is refused WHEN a schema says boolean | the routes that do `!!payload[k]` (SET-75) or `String(x)` (CRM-237) have no schema field to refuse it |
| `isCalendarDay`, `isDay`, `queryDay` | validate.js | real YYYY-MM-DD, 2026-02-30 refused, query days answered 400 `VALIDATION_FAILED` | seams.cjs says "nothing" for isCalendarDay (a miss: the word is camel case, the index lower-cases); not an ajv format, so a body schema cannot say "day"; no sane range (year 0001 and 9999 pass, FIN-103, CMP-41, ACC-335) |
| `lib/chit-ceiling.js` | RAIL-205/191 | ceilings READ OFF the column types (10^(p-s)), `CHIT_AMOUNT_TOO_LARGE` 400, used by send, amend, deliver-lines; COLUMNS and ceilingOf already exported | chit columns only (3 rows); its header says "not behind this ceiling yet (RAIL-206)": connectors, pricing, supplies, books |
| `lib/amend.js withinColumns`, `catalogue-write` 1e12 cap (api #1051) | two other copies of "a number has a ceiling" | | a third and fourth ceiling constant is the trap this design avoids |
| books `DATE_INVALID` 400 (api #975, ACC-274, DONE) | books-period | one real-day rule on every books door | stays as the books door's frozen answer |
| `knownParty` (books.js:1249), `partyOn` (books-store.js:1208) | the stranger rule for parties | one refusal for a stranger | in PR #1071 (OPEN, under review, not touched here) `partyOn` becomes live-aware through `lib/party-live.js liveSql` (`hidden_at IS NULL`): a deleted party is refused exactly as a stranger, history reads stay |
| `lib/cost.js` + `COST_BLIND` | cost-write, entities-contract | `can_see_costs` fails closed, 403 `COST_BLIND` with key names | applied at write doors only; not on search, export, books reads (OPS-119 aside) |
| register: `strict_input`, `foreign_id_404` | tools/api-register.cjs:249-266, tools/api-contract-tests.cjs:343-387 | generated cases per route | see section 2 |

## 2. Two findings that decide the design

**F1. `strict_input` measures one of the five harms.** It is true when the schema has `additionalProperties: false` AND a generated case sent one undeclared key and saw it refused by name (api-register.cjs:249-253). It never sends a ceiling, a negative, an impossible day or a wrong type. The 44 failing routes (till 22, products 5, integrations 3, testing 3, connectors 2, ctp 2, capture 2, and 7 single routes) are all "unknown key" cases. Most of the SIT bugs sit on routes that already read yes: POST /api/books/payments is strict and still took `amount_minor: true` (FIN-79/104), a 2026-02-30 cheque (FIN-84) and 100.5 (FIN-82). So fixing the 44 closes at most a handful of the 110 input lines (those on till and products routes), and the column going green proves nothing about bounds.

**F2. `foreign_id_404` measures path ids only.** It applies when the path has `:` (202 routes, 13 failing: 12 chits sub-routes and network-offers `/:id/choice`) and passes when the generated case sees another shop's PATH id answered like an unknown one (api-register.cjs:266). An id in the BODY or QUERY (`line_id`, `assignee_actor_id`, `party_id`, `supplier_id`, the bill a credit note names) is invisible to it. ORD-79/80, CRM-246/247, OPS-103 are body-id bugs on routes that count as meeting. And "live" is not measured at all.

So adoption needs its own evidence. The helpers below are the fix; the register change (section 5) is what lets the ratchet hold them.

## 3. Check 1 — INPUT BOUNDS: `bounds` (lib/bounds.js) widening validate.js

**One helper, two parts, no new middleware.** The route keeps `schemaValidate(operation)`; what changes is that the schema is written with named fragments and the engine knows them.

```
lib/bounds.js   (pure; ajv fragments + ajv formats; no db)
  B.qty({column})         number, exclusiveMinimum 0, maximum = ceiling of the named column (read off lib/chit-ceiling COLUMNS, widened to export the table; scale as the column)
  B.minor({column,signed}) integer minor units, minimum 0 (signed only where a credit/refund legitimately is), maximum from the column; multipleOf 1  (a fraction of a minor unit is refused, ACC-276/311, FIN-82)
  (B.amount dropped, rev 2 #1E: cross-field; handlers call money.decimals)
  B.day({notFuture,notBefore}) string, format "calendar-day" = the registered ajv format over the existing isDay (dateGiven and network-offers call it too), range check (year >= 1900 by default, a door that allows a future date says so: due dates, opening)
  B.flag()                type boolean, no coercion ("false" is refused, 1 is refused)
  B.text({max})           string, maxLength (default 200; names 100, narration 2000, free text 5000), no control characters, the length cap is a REFUSAL, never a silent cut (CRM-232)
  (B.uuid dropped, rev 2 #1D: body/query ids use namedentity.UUID, refused 422; path ids stay 404 through uuidParam)
  B.page() / B.limit()    integer minimum 1; limit maximum 200; page maximum 10000 (PLT-88, ACC-317)
  B.list({of,max})        array, maxItems, items as given (CAT-311, CON-124)
  B.oneOf(words)          enum for query words (FIN-96, MKT-28: a junk status is refused, not "all")
validate.js (widened, one place):  bodyEngine/urlEngine addFormat('calendar-day', isDay), sentenceOf gains minimum, maximum, exclusiveMinimum, multipleOf, maxLength, maxItems, format (shopkeeper sentences: "<field> must be more than 0.", "<field> must be at most <max>.", "<field> must be a real date.").
```

**What it refuses, with which status and code (all already in docs/error-codes.json; no new code proposed):**

| Input | Door | Status · code | Shopkeeper sentence (register) |
|---|---|---|---|
| qty 1e308, 1e15, price past the column, 0 or negative qty, fraction of a minor unit, boolean as number, non-uuid id, junk page/limit, over-long text, array too long, unknown word | body | 422 `INVALID_INPUT` with `errors[]` of `WRONG_VALUE` (each field named, all of them) | "Some of what was sent is missing or not valid." · per field "A field has a value of the wrong kind." |
| the same on a url or query value | query/path | 422 `INVALID_INPUT` (urlEngine coerces "5" to 5 and refuses "abc") | same |
| a body or query day that is not a day | books doors | 400 `DATE_INVALID` kept through `options.status/code` (api #975, web callers test 400) | "That date is not a real day." |
| a chit send, amend or deliver line past its column | chits | 400 `CHIT_AMOUNT_TOO_LARGE` kept (chit-ceiling stays the chit answer; B.qty reads the SAME COLUMNS table so there is one number) | "A total, quantity or price is larger than a chit can hold, so nothing was saved." |
| an unknown key | body | 422 `UNKNOWN_FIELD` named (already S33); a door frozen on 400 keeps `UNKNOWN_FIELD` 400 | "Not saved: that detail cannot be changed here..." |
| a required field absent | body | 422 `MISSING_FIELD` | "A needed field was left out." |

A door that already answers a frozen 400 for these (books, chits, catalogue-write 1e12, definitions) uses `options.status/code/legacy`; nothing is re-statused in this work (S2: grep web first).

**Cross-field products (qty x price, 1e15 x 1e15) are NOT a schema fact.** The per-field maxima keep each factor inside its column; the product stays with chit-ceiling `overOf` and the money engine. Said so in section 8.

**How a route adopts it:** (1) its contract file (lib/<area>-contract.js) writes `B.*` fragments for every number, day, flag, id, text and list in its body, query and params, and `additionalProperties: false`; (2) it already has `schemaValidate` in front (76 do); (3) the route's handler code that did its own `Number()`, `!!` or `String()` on those fields loses that code (the schema owns it); (4) the area test adds the generated cases below. A route with no body or query is "no input" (the toolset keeps toolset/coverage/no-input-routes.json).

## 4. Check 2 — IS IT MINE AND IS IT LIVE: `mineAndLive` (lib/mine-and-live.js) widening books-store.partyOn and party-live

```
lib/mine-and-live.js
  mineAndLive(refs) -> express middleware, mounted AFTER schemaValidate (ids are already uuids), BEFORE the handler
    refs = [{ field, in: 'params'|'body'|'query', kind, scope?, history?: true }]
    kind: 'party' | 'supplier' | 'actor' | 'product' | 'chitLine' | 'chit'     (one RESOLVER per kind, in this file)
    scope: where "mine" is measured: shop (default), or 'chit:<param>' (a line must belong to THIS chit and this caller's copy of it)
    history: true = a reader of history (statement, timeline): "mine" is checked, "live" is not
  RESOLVERS = {
    party:    partiesOn(db, e, ids) (books-store, PR #1071: live-aware via party-live.liveSql, ONE statement for many ids)
    supplier: supplier_list live row (party-live.liveSql) — a removed supplier is not live and is not re-addable until restored (OPS-103)
    actor:    identities of this entity, active, able to take tasks where the route assigns (reads the same row as lib/actors) (ORD-80, PPL-37/42, SET-79)
    product:  catalogue item of this shop, not soft-deleted (CAT-319)
    chitLine: chit_line joined to the chit named in scope AND the caller's copy of it (ORD-79)
    chit:     the chit, the caller's own copy (RAIL-199)
  }
  one batched query per KIND per request (round-trip budget: at most +1 trip per kind, written in the route's round-trips budget line by hand)
```

**What it refuses, one answer:** an id that is not the caller's, or not live, gets exactly the answer an unknown id gets: **404 `NOT_FOUND`** ("We could not find that."), same body byte for byte (S35, OWASP API1: never 403, never the record). Where a route already has its own registered not-found (books `BOOKS_NOT_FOUND`, relationships `REL_PARTY_INVALID`), `mineAndLive` takes `{status, code}` through the same `options` shape as schemaValidate so the door's frozen answer does not move. A deleted party takes no WRITE and is refused as a stranger (the #1071 rule); a reader of history passes `history: true`.

**Third clause, "may this reader see it" (cost-blind):** not an id check, so not in `mineAndLive`. Rev 2: NO new helper; it reuses `isCostBlind` and `dropCostKeys` of `lib/cost.js` at the search, export and books-read doors (CAT-285, ACC-292, CON-155) and OPS-119 adopts `costKeyRefusal` at its write door. It answers the existing 403 `COST_BLIND` (or drops the cost column on an export, with the route saying so). Listed as slice C2c; the owner decides per route whether the answer is 403 or a column left out (behaviour question, cb-catalogue and cb-accounting).

**How a route adopts it:** its contract file marks each id field with `x-owned: { kind, scope, history }` beside its `namedentity.UUID` pattern; the route mounts `mineAndLive(refsFrom(operation))` (the refs are READ from the schema annotation, so there is one declaration, not a schema and a middleware that can drift); the handler's own stranger lookups (`knownParty` and friends) are deleted in the same PR.

## 5. How the register proves adoption and the ratchet holds it

Do not hide this in the old columns (F1, F2). Staged, so 537 "meets" routes do not flip to partial overnight:

1. **Slice 0 adds two REPORTED columns** (the same class as `bfla_role_check`, listed in the table, not in "meets"): `bounded_input` and `mine_and_live`. Shown in docs/API-REGISTER.md and the JSON, counted in docs/api-ratchet.json, and the ratchet fails when the count of routes failing either goes UP or a changed route fails them (a route a PR adds or changes must pass).
2. **`bounded_input` (static):** every number, integer, string, array, id and day field of the body, query and params carries the bound its type needs (the lint reads the operation; a field with `type: number|integer` and no `maximum`, or `string` with no `maxLength`, fails) AND (generated, tools/api-contract-tests.cjs, a new case beside strictInputCase): for each declared field class the route is sent one out-of-bound value (1e308, -1, 0, "2026-02-30", `true` for a number, a 10,001-character text, "abc" for an id) on the real app with the stand-in, and each must answer a 4xx Problem naming the field, never 200 and never 5xx. Evidence key `bounds` in api-hardening-evidence.json.
3. **`mine_and_live` (static + generated):** every id field is either `x-owned` or declared `x-public` (an id that is public by design: the existing api-hardening-scope.json `public_ids` list); the generated case sends another shop's id for EACH annotated field (path, body or query) and a deleted/removed one, and each must be answered like an unknown id (404 unless the door's registered answer). This subsumes `foreign_id_404` (path ids are annotated the same way), so the old column stays as is and is joined, not replaced.
4. **Promotion (end of rollout):** when both counts reach zero for the money, accounting and offers routes, fold `bounded_input` into `strict_input` and `mine_and_live` into `foreign_id_404` (one definition each, 13 columns still) and re-run the register: a signed route that fails after the fold is partial and needs the independent re-sign (no grandfathering, R2-1). Until then neither column can turn a signed route partial, so the roll-out is not blocked by routes it has not reached.
5. **Sign-off** (cb-api, a non-builder, dated): read the route's row in docs/api-register.json, check all 13 plus the two reported columns for the routes in the slice.

## 6. What each check closes (backlog lines raised 8-9 Nov, src hunt|SIT; classified by hand from the first lines, to be re-tagged by the slice-0 generator)

`backlog-lines.cjs` over origin/master gives **273** lines (raised 2026-11-08/09, src matching hunt|SIT; 312 when the whole line is matched; Athi's 298 did not reproduce with either filter, so counts below are against 273).

| | Lines | Open | P2 | Owners (lines) | Route mentions in those lines |
|---|---|---|---|---|---|
| **Check 1 input bounds** | **110** | 110 | 42 | finance 14, accounting 13, catalogue 12, crm 11, connect 8, orders 7, settings 7, people 7, rail 5, compliance 5, ai 5, others 16 | **~94** (about, from text) |
| of which numbers (ceiling, sign, fraction, type) | 33 | | | RAIL-210 212 222, ORD-91, CAT-305..310 312 320 322, CTR-236, OPS-102 120, ACC-276 311 318, FIN-79 82 101 104, SET-70 71 81, SEC-158, CON-129 151 153, CTRY-134 135, CON-152 | 28 |
| dates (impossible, far future/past, 500) | 20 | | | RAIL-213, CRM-227 228 242 250, CAT-327, OPS-104, ACC-322 329 330 333 334 335, FIN-83 84 89 103, PPL-38, CMP-41, CTRY-137 | 20 |
| wrong type, coerced ("false", {a:1}) | 24 | | | ORD-81 84 86, CRM-233 234 237 238 239 244, MKT-26, SEC-154 155, SET-72 73 75, FIN-105, ACC-315, CMP-45 56, CON-120, PPL-43, CAT-321, AI-30 35 | 31 |
| length and size | 16 | | | CRM-232, FIN-94, ACC-312, PPL-34 35 36 46, CON-124 150 154, AI-32 33 34, CMP-53, CAT-311, SET-82 | 13 |
| id shape to 500 | 7 | | | RAIL-209, ORD-77 78, FIN-86, PPL-39, CMP-43, NET-92 | 13 |
| query and paging | 10 | | | ORD-97, MKT-27 28, ACC-316 317, FIN-87 96 97, REP-61, PLT-88 | 12 |
| **Check 2 mine and live** | **18** | 18 | 12 | crm 4, people 3, orders 2, operations 2, catalogue 2, rail 1, settings 1, counter 1, accounting 1, connect 1 | **~42** |
| mine (another order's or shop's id) | 3 | | | RAIL-199 (8 of 29 chit sub-routes), ORD-79, ORD-80 | 8 |
| live (deleted, removed, retired, switched off) | 11 | | | CRM-229 246 247 248, OPS-103, CAT-319, PPL-37 42 44, SET-79, CTR-232 | 24 |
| may this reader see it (cost-blind) | 4 | | | OPS-119, CAT-285, ACC-292, CON-155 | 11 |

Register columns: `strict_input` failing **44** routes, `foreign_id_404` failing **13** (820d69cc, `api-register.json counts`). Check 1 closes the 44 only where the unknown-key case also gets its bounds (till 22, products 5, integrations 3, testing 3, connectors 2, ctp 2, capture 2, 7 single routes); check 2 closes the 13 (12 chits sub-routes + network-offers `/:id/choice`) with RAIL-199. Overlap: API-7 (the 19 crossing routes, incl. `GET /suppliers/:id/catalogue`) and API-8 (money, accounting and offers to 13/13).

Per-route counts are text mentions and over-count (a read route named as proof) or under-count (a route named by its screen); slice 0 emits the exact table (`route x check x backlog id`) from the register and the lines, and that table, not this section, is the slice plan's source.

## 7. Rollout (12 PRs, at most ~15 routes each; P1 money, accounting and offers first; each PR is one area's contract files)

| # | PR | Routes (about) | Closes |
|---|---|---|---|
| 0a-0d | (rev 2: split 0a formats+bounds.js, 0b register columns+lint+table+census, 0c shadow+/health, 0d mine-and-live party kind after #1071) helpers + register: `lib/bounds.js`, `lib/mine-and-live.js`, validate.js sentences + formats, the two reported columns, the generated cases, ratchet baseline, ERROR-CODES check (no new code), the exact route table. No route changes. **Lands only after #1071.** | 0 | nothing; prove on two worked routes (POST /api/books/payments, POST /api/chits/:id/assign-lines) |
| 1 | C1 books money doors (payments, write-off, terms, loans, opening, events, entries, accruals, periods) | 15 | FIN-79 82 83 84 86 88 94 101 104 105, ACC-276 311 312 315 318 329 |
| 2 | C1 books/tax dates and reads (daybook, dues, cashflow, gstr, packs, returns, ledger, invoice/build, tax/compute) | 15 | ACC-322 333 334 335 316 317, FIN-89 96 97 103 87, CTRY-134 137 |
| 3 | C1 pricing, offers, catalogue (pricing/price, offers/evaluate, products, availability, combo-templates, definitions) | 15 | CAT-305..312 320 321 322 327 311 |
| 4 | C1 chits, repeat, work (send, attachments, repeat, counter, assign-lines, amend, work list, entities/routing) + strict 1 | 15 | ACC-330 (moved here, rev 2), RAIL-209 210 212 213 222, ORD-77 78 81 84 86 91 97, CTR-236 |
| 5 | C1 supplies and counter (supplies issue/purchase, till strict_input first 11) | 15 | OPS-102 104 120 + till strict |
| 6 | C1 till strict_input rest (11) + products 5 | 16 | the remaining strict_input till and products |
| 7 | C1 crm, marketing, people, settings, compliance | 15 | CRM-227..250 (type, length), MKT-26 27 28, PPL-34..43, SET-70..82, CMP-41 43 53 56 |
| 8 | C1 connect, ai, security, platform, network (+ strict: connectors 2, integrations 3, ctp 2, capture 2, testing 3, assist, csp-report, events, governance) | 15 | CON-120..154, AI-30..35, SEC-154 155 158, PLT-88, NET-92, REP-61 |
| A | C2 chits sub-routes and network-offers choice (13 routes, `kind: chit`, `chitLine`) | 13 | foreign_id_404 13 to 0, RAIL-199, ORD-79 |
| B | C2 party and supplier live (adopt #1071 `partyOn`; crm, relationships, books, supplies, groups) | 15 | CRM-229 246 247 248, OPS-103 |
| C | C2 actors, product, settings live and cost-blind (`actor`, `product`, `isCostBlind`/`dropCostKeys`) | 15 | ORD-80, PPL-37 42 44, SET-79, CAT-319, CTR-232, OPS-119, CAT-285, ACC-292, CON-155 |

Order: 0, then 1-3 and A (money, accounting, offers: P1 via API-8), then B, 4, 5, 6, 7, C, 8. Each PR: a shadow run (section 9) on SIT first; the touched tests + guards.cjs; register `--write`; the ratchet; a non-builder cb-api sign-off. Area owners review their routes' business rules (what counts as a legitimate negative, a future due date). **Estimate:** PR 0 M, each slice S-M, about 12 PRs.

## 8. What this does NOT cover

- **Check 3**: the money balance per document (a write-off past what is owed FIN-78, a loan repaying more principal than owed FIN-92, credit notes with no cap ACC-284, mark-paid ignoring a credit note ACC-320): own brief.
- **Business state machines**: pay a rejected or voided bill (RAIL-219, FIN-80), withdraw after delivery (RAIL-217..221, ORD-82 90 95), forms on a rejected order (CMP-52). A state check, not a bound.
- **Authorisation by role** (viewer changes language SET-84, editor renames the business SET-85, staff makes a live offer CAT-276, token without session SEC-149): cb-security and the bfla column.
- **Duplicates and races** (same phone five times CRM-243, concurrent adds CRM-230/231, the opening posted again ACC-328): idempotency, `idempotent_money_write`.
- **Cross-field products** (qty x price) and relational rules (discount larger than its line ACC-282, a whole-piece unit RAIL-224, due date earlier than bill date): stay with the money engine and chit-ceiling.
- **Path-level URI errors** (`%E0%A4%A` 500, SEC-152) and server-wide body size: server.js handler, one fix, not a schema.
- **CSV parse faults** (CON-121/122), screen sweeps, UX, accessibility, DB baseline lines.
- **Rate limits** (CMP-40, CON-126): the rate_limited reported column.
- 145 of the 273 lines are outside both checks.

## 9. Risks

1. **TOP RISK — web callers send today's loose input.** The web and the vendored till send numbers as strings, a due date as "12", `groups: "VIP"`, `done: "false"`, and the offline till queue replays bodies saved weeks ago: a queued bill with a device date years ahead (ACC-330), a quantity of 0, an old shape. A bound that refuses them turns a working till into a stuck queue. Mitigation: (a) **shadow mode first** — `B.*` and `mineAndLive` take an `observe` option driven by the same bounded `reportDropped` pattern (lib/output-allowlist.js: log once per route and path, a count, never the value) and run a week on SIT with the walks before a route flips to enforce; (b) every PR greps web (`app.html`, till, e2e fixtures) for senders of the touched route and the web-api.json contract master is regenerated (`tests/web-api-contract.test.cjs --write`) with the byte copy in web; (c) WITHDRAWN: the till queue does NOT park a 4xx, it retries a bill for ever (section 0 #9); till bill doors accept-and-flag, verdict to cb-counter before slice 5; (d) frozen statuses stay (section 3) so web code that tests `status === 400` does not break; (e) the ceilings come from the DATABASE column types (the RAIL-205 rule), so nothing legitimate is above them.
2. **Connectors** (Tally, Zoho, Xero write-backs; erp-ingest; device ingest) send strings and whatever the ERP holds. The 3 `tolerant_outward` routes stay exempt (API-43; their list may only go down). For the rest, a connector refusal is a 422 Problem the connector log shows; slice 8 checks each connector kit's test fixtures.
3. **Mass flip.** Staged columns (section 5) avoid 537 routes turning partial at once; promotion happens per area when its count is zero.
4. **Round-trip budget.** `mineAndLive` adds one query per kind per request: written in each route's budget line by hand (round-trips-all.test.cjs, never `--write`); the party kind reuses `partiesOn` (one statement for many ids).
5. **404 for a dead-but-owned id** hides why a deleted party fails. The sentence stays "We could not find that."; a door that wants "this person was removed" is an owner decision per area (cb-crm decided "same as a stranger" in #1071).
6. **Twin landing / open work.** #1068-#1071 (k88) are not touched; slice 0 lands after #1071 because `mineAndLive` reads its `partiesOn`. A web-first adopt can red api CI (api-ci-tests-against-web-main): the web contract copy lands with each api slice.
7. **Classification is by hand** from the first lines of each backlog line; a mis-sorted line is found when slice 0 emits the exact table.

## 10. Industry check (recalled from memory, NOT fetched)

- **OWASP API Security Top 10, 2023**, as recalled: **API1 Broken Object Level Authorization** (check an object id against the caller on every request, including ids in the body and query; returning the same not-found for "not yours" and "does not exist" is the usual way not to leak existence) is the model for `mineAndLive` and S35. **API3 Broken Object Property Level Authorization** (excessive data exposure plus mass assignment: an allow-list in, an allow-list out, which is S33/S34 and the cost-blind column) is what `strict_input` and `isCostBlind`/`dropCostKeys` cover. **API4 Unrestricted Resource Consumption** (no ceiling on sizes, counts, page numbers, payloads) is the direct match for check 1: qty 1e308, a 100,000-character name, a 2,000-group definition, `page=9999999`. **API6** (sensitive business flows: duplicates, replays) is the neighbour left out (section 8).
- **JSON Schema 2020-12 / ajv**, as recalled: `minimum`, `maximum`, `exclusiveMinimum`, `multipleOf`, `maxLength`, `maxItems` and `enum` are validation keywords and cover most of check 1; `format` is an ANNOTATION by default and asserts only when the validator is told (ajv: `addFormat`), which is why `calendar-day` must be registered; `type: integer` accepts any integral double (1e300) so a `maximum` is mandatory; cross-field arithmetic is not expressible. This matches the choice to put bounds in the schema, keep the products in the engine.

## 11. Needs from other areas (advise; owners decide)

cb-counter: the till queue's behaviour on a 4xx Problem (before slice 5). cb-crm, cb-catalogue, cb-accounting, cb-finance, cb-operations, cb-people, cb-settings: the legitimate-negative and legitimate-future list per door (slice review). cb-security: the cost-blind answer (403 or a column left out). cb-finance and cb-accounting: check 3 brief. cb-docs: a FIELDS.md line for `x-owned` and the bound vocabulary, and the seams index miss for camel-case words (isCalendarDay).
