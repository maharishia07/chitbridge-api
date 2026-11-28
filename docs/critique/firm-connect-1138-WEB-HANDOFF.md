# WEB-HANDOFF · firm-connect-1138 (api branch fix/firm-connect-1138) · for the web lane · 2026-11-28

Everything below is built and tested on the api (no database test: tests/firm-connect-1138.test.cjs; real Postgres: tests/firm-connect-1138.realstack.cjs in CI). Nothing here is drawn yet. Firms only: a brand's (governance) request is NOT in any of these answers (coordinator ruling; backlog row for brands).
Words below are for the screen to say in the owner's own language; the api sends codes and short sentences, the screen owns the final copy (ui-copy). Never show "network parent".

## 1. Routes the web calls

| Route | Seat | Answer | Draw |
|---|---|---|---|
| `GET /api/network/asks` | owner only (staff and keys: 403 `OWNER_ONLY`, grey the card) | `{ to_me: [ask], by_me: [ask] }`, newest first | the card's two lists |
| `POST /api/network/connections` `{ parentHandle \| parentId, type: 'agency' }` (the SHOP asks its firm: the firm is the parent) or `{ childHandle \| childBridgeId \| childId, type: 'agency' }` (the FIRM asks a shop) | owner only now (a firm's staff seat gets 403 `OWNER_ONLY`) | the edge, state `requested` | "Ask to connect"; then the card says "Waiting for <firm> to answer" with Cancel (`POST /connections/:id/decline`, either side may) |
| `POST /api/network/connections/:id/approve` and `/decline` | owner only, the side that did NOT ask | unchanged | Accept / Refuse. Accept alone gives the firm NO access |
| `POST /api/network/firm-invites` `{ email }` (one key only) | owner only | `{ sent, delivered, message }` | say `message` as is; when `sent` is false the screen says it was NOT sent. Nothing connects |
| `GET /api/entities/search?q=` | signed in | unchanged | the finder (name, sign-in name, bridge id) |
| `PATCH /api/books-grants/:id` `{ expires_at?, can_see_costs?, consent?, posting?, posting_cap_* }` | owner only | the grant | change end date, costs choice, who posts on a live grant |
| `GET /api/books-grants/log` | owner only | `{ looks: [...], visits: [...] }` | draw `visits`, one row each; keep `looks` for the detail if needed |
| `GET /api/facts/network` | signed in, not a key | Home card answer | the Home "Do first" card |
| `GET /api/notifications?count=1` | signed in | `{ count (includes asks), asks, total, seen_at }` | the bell dot and its pinned row |

## 2. The ask (each element of `to_me[]` and `by_me[]`)
`edge_id` (use for Accept / Refuse / Cancel) · `kind` always `'firm'` today (branch on the code, never the words) · `i_am` `'shop'` or `'firm'` (the firm is ALWAYS the parent) · `name` · `bridge_id` · `country` (may be null) · `asked_at`.
Show: firm name, bridge id and country on the request, so the owner can tell a self-named firm from the real one. `to_me` = needs my answer (Accept / Refuse). `by_me` = I asked, I wait (Cancel).
Empty `to_me` and `by_me` for a staff seat is by design (the list is 403 for them: grey it with the sentence from `why`).

## 3. Refusals to show in words (all keep `code`, `detail`)
- `409 EXISTS` already asked / already connected.
- `409 FIRM_DIRECTION` the pair is already connected the other way round (the firm is always the one that looks after the books).
- `429 ASK_LIMIT` too many waiting or too many today, or that business has many requests waiting.
- `429 ASK_COOLING_OFF` refused a short while ago (1 hour); after that the ask works again. A request already waiting is still `EXISTS`.
- `429 INVITE_LIMIT` too many invitations today (20) or that address was invited this week.
- `403 OWNER_ONLY` staff seat or key: grey the control with the sentence.
- `404 CHILD_NOT_FOUND` / `PARENT_NOT_FOUND`, `400 SELF`.
- Costs change: `422 BOOKS_GRANT_CONSENT_NEEDED` (see 5), `503 BOOKS_GRANT_NOT_SWITCHED_ON` (b915 not run yet: say "Changing what your firm sees is not switched on yet").

## 4. Home card `network` (manifest: add `facts: "network"` to the Network entry; the card list is lib/home-facts CARDS)
Owner seat: `lines[0]` = `"N request(s) to connect"` with `tone: 'dn'` and `state: 'needs_you'` when something waits for the owner (count in `figures.requests`; `figures.waiting` = asks I made and wait on). Door: to the Network card in "Who can see my books" (the asks list). Nothing waiting: state `not_started`, `"No requests to connect"`. A staff seat reads 0 and no door.

## 5. The bell
- `GET /api/notifications?count=1` (the badge poll) now answers `{ count, asks, total, seen_at }`: `count` ALREADY INCLUDES `asks` (the owner's waiting firm requests, counted until answered, never cleared by "seen"). The dot reads `count`. `asks` alone says how many are requests (the bell may label the first row from it). A staff seat or a key gets `asks: 0`.
- The feed `GET /api/notifications` is UNCHANGED (no request rows, no extra trip on the feed): when `asks` > 0 the bell draws one pinned row "<N> request(s) to connect" at the top that opens the Network card, and the card's own `GET /api/network/asks` lists them (name, bridge id, country, Accept / Refuse). Speed rule: the asks count rides in the badge statement; the rows are read only when the owner opens the card.

## 6. Access I gave (UX-220)
Per grant row, in the row's own detail so nothing is hidden at 1366 px: who (firm), role (`preset`), end date (`expires_at`), reason (`purpose`), `can_see_costs` yes/no, `posting` (who posts, adviser only).
Change without ending the access: `PATCH /api/books-grants/:id`.
- RISE in costs (`can_see_costs` false to true) MUST send `consent: true` after the same plain-words confirm as giving (`GET /api/books-grants/consent?can_see_costs=true`); without it the server answers `422 BOOKS_GRANT_CONSENT_NEEDED`. A fall (true to false) needs no confirm.
- The change is logged before and after (access_events `books_grant_changed`); the firm's next read follows.

## 7. Who looked (visits)
`visits[]` newest first, one row per visit (a run of looks by the same person on the same grant with no gap over 30 minutes):
`{ grant_id, grantee_entity, actor_identity_id (may be null), actor_name (null when the log holds no person: show the firm alone), actor_entity_name (the firm), preset, from, to, pages (N pages), refused, pages_list: [{ route_pattern, count }] }`.
Column Who = firm, and the person where `actor_name` is not null. Row detail lists `pages_list`. The list is the latest 200 looks, grouped (the oldest visit may be cut short).

## 8. Words the owner screens must change (UX-215 line 3)
Give access with no firm connected: "Connect your bookkeeper or auditor first." + button "Find your firm" to the card. Empty list: "Nobody can see your books yet. Connect your bookkeeper or auditor, then give access." No owner screen or consent headline may contain "network parent".

## 9. Not here (said, not done)
Brand (governance) requests in Home, the bell and the list (accept moves the shop under the brand: needs its own consent; backlog). Audit events for asking and answering (access_events action CHECK needs a migration). Bulk onboarding. Verified-firm mark. b916 and the legacy `/api/connections` re-ask were dropped (coordinator).
Migration b915 (file only, Athi runs it, cb-db gates) opens `UPDATE (can_see_costs)`; until it runs the costs change answers 503 in words and everything else works.
