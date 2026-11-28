# REQUIREMENT · firm-to-shop path (round firm-connect-1138) · 2026-11-28 · owner cb-network · size L

Source: cold Fable walk AU r2, PM/sim-year/FABLE-WALK-AU-R2-assignments-2026-11-27.md (rows O1, O2, O5, O6, B2); backlog UX-215, UX-216, UX-220 (docs/29-…/UXLOCALE-BACKLOG.md); design already written and design-critiqued: PM/firm-staff/FIRM-PARENT-DOOR-DESIGN-2026-11-18.md. Base api 8adbdc586, web 9c8d71893.

## The job
An auditor (or a bookkeeping practice) brings about 150 shops. The first thing they do with each shop is get connected and given access. The owner of a shop must be able to do that, in his own words, in the first 30 seconds, with no api call and no word he does not use ("network parent" is never shown).

## Who
- The OWNER of a shop (not staff, not a key: approve and decline are already owner-only).
- The FIRM's owner (partner) of a bookkeeping firm or an audit firm: a business like any other, with a sign-in name and a bridge id.

## What the person does, and the pass test (each line is one check on the box)
1. UX-215 owner finds a firm. Who can see my books has a card "Your bookkeeper or auditor". The owner types part of the firm's name or its sign-in name, sees the matches (name, sign-in name, bridge id), picks one and presses "Ask to connect". PASS: an agency edge (firm = parent, shop = child) is asked; the card then says "Waiting for <firm> to answer" with Cancel.
2. UX-215 owner invites a firm that is not on ChitBridge. The same card has "Not on ChitBridge yet? Invite by e-mail". PASS: one e-mail goes to the address (example.com in tests) naming the shop, its sign-in name and what to do; the owner is told it was sent (or, when mail is not configured, that it was NOT sent, never a false "sent"). Nothing connects until the firm signs up and asks, or is asked by name.
3. UX-215 the dead end. Give access with no firm connected no longer says "You have no network parent to give access to." PASS: it says "Connect your bookkeeper or auditor first." with a button "Find your firm" that goes to the card. The empty list says "Nobody can see your books yet. Connect your bookkeeper or auditor, then give access." No owner screen or consent headline contains "network parent".
4. UX-215 / B2 the firm adds a client. A firm with no client sees on its practice page "Add a client": the shop's sign-in name or bridge id, "Ask to connect" (agency edge, firm = parent). PASS: the shop's owner sees it as in line 5.
5. UX-216 the owner sees a request. A request addressed to him (from a firm, or a brand's invitation) shows: on Home in Do first (count and a door), in the bell (a row, counted in the dot, until answered), and as a list on the same card with Accept and Refuse (the server's refusal shown in words). PASS: with one pending firm request Home says "1 request to connect", the bell dot is 1, the card lists the firm by name with Accept and Refuse; after Accept all three go to 0 and the firm appears in Give access; Accept alone gives the firm NO access (a separate grant, as designed).
6. UX-216 a refused request may be asked again. PASS: shop owner Refuses; the firm asks again; a new request shows (network edges: proved by a test; legacy /api/connections: a refused pair can be asked again by either side, the old row stays as history). A request already waiting is still refused as "already asked".
7. UX-220 Access I gave shows, per grant, in one row: who (firm), role, end date, the reason, "sees costs and margins: yes/no", "who posts". The columns the list hides at 1366 px are shown in the row's own detail so nothing is out of reach. The owner can change the end date, the costs choice and who posts without ending the access (a rise in what the firm may see or do asks the same confirm as giving it). PASS: change costs on a live grant; the next read by the firm follows; the log (access_events) keeps before and after.
8. UX-220 Who looked has a Who column (firm, and the person where the log holds one), and one row per visit (a run of looks by the same person, same grant, within 30 minutes) with "N pages" and the pages listed in the row's detail, not one row per tab. PASS: 55 raw rows of two firms become a few rows, each naming the firm.

## Out of scope (said, not done)
Bulk onboarding of 150 shops in one paste; the verified-firm mark (decision D4); audit events for asking and answering a connection (needs a migration widening access_events_action_check, design 3.5); the firm's whole new home (B3, U1: UX-225); flipping the Network manifest entry to ready (cb-ux-locale / coordinator).

## What exists (reuse; each found with `node C:/dev/seams.cjs` or git grep on origin/main)
- Edge ask/approve/decline/disconnect: src/services/network.js requestConnect/approve/decline (agency type accepted; either side asks; the non-asker's owner answers; a declined edge does not block a new ask, only requested/active/suspended do). Routes in src/routes/network.js. Web keys netConnect/netApprove/netDecline exist in app.html (workshop only).
- Find a business: GET /api/entities/search (name or exact sign-in name or bridge id, signed-in). No new lookup.
- Mail: lib/notify.js sendEmail (dormant-safe, returns delivered).
- Grant: lib/books-grant.js give/change/revoke/looks, routes/books-grants.js; middleware/books-grant.js unchanged; lib/delegation untouched. NET004 screen: web public/app/books-grant-member.js (+ -words.js). The list ALREADY has Why, Until, Who posts, Costs columns, hidden by CBList priority at 1366; the log rows already carry actor_name, actor_entity_name, preset (b866).
- Home door: manifest "facts" -> lib/home-facts CARDS (state needs_you from tone dn); bell: routes/notifications.js feed + badgeOf.

## New (each justifies itself)
- lib/connect-asks.js: ONE reader of "requests waiting for this business" (edges in state requested whose asker is the other side) and "asked by us, waiting". Read by GET /api/network/asks (new route, owner only), the Home card `network`, and the bell feed and badge. Why not the existing GET /entities/:id/connections: needs the node id, returns no firm bridge id/country, no kind code, and three readers would each re-filter it.
- POST /api/network/firm-invites (new route, owner only, one e-mail, no table). Why no table: design rule "no new table"; the invite carries no authority (the firm must still be asked or ask, and the owner still accepts and then gives access).
- Ask route gets the owner-only gate (design 3.6): a firm's staff or a key can no longer ask 150 shops in the firm's name.
- Migrations (files only, Athi runs): b915 grants UPDATE (can_see_costs) on books_access_grant to cb_app; b916 replaces the legacy connections UNIQUE (from,to) by a unique index over live statuses so a refused pair can be asked again. Code tolerates both absent (words, never a 500).
- Web: public/app/firm-connect.js (one module: the find-and-ask form for both sides, the asks list, the e-mail invite), mounted in books-grant-member (owner) and books-practice (firm). Every element gets a code in the UI register.

## Better, not copied
Xero/QBO/MYOB: the client invites the advisor and the role is bundled with the invitation. Here the relationship and the data access are two consents, so an accepted request alone shows nothing and the owner chooses role, end date and costs separately.

## Risks
Enumeration of sign-in names by the finder (same as GET /entities/search today; no new exposure). An e-mail invite is not proof the firm is a firm. Staff seats lose the ability to ask (intended). The bell gains a row kind: web rail-bell-rows must draw it.
