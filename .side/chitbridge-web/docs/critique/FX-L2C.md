# Critique · FX-L2C (written before any code, 2026-10-13)

**VERDICT: BUILD WITH CHANGES** — (1) F2 ends the lead by the trade count, not a new `customer` membership group; (2) E-8 says the login's level in the server's words, not "CB Assist"; (3) F7 reads memberships into the timeline, writes no interaction.

## (a) What the brief assumes, checked
- "The server may accept a viewer's write" — **true, and worse than one route**: `api routes/actors.js:299-306` INSERTs `hat` but never `access_level`; `migrations/b173_access_level.sql:66` defaults the column to `editor`; `lib/access.js:52-54` returns the column's word first; so `middleware/hat-gate.js:143` lets a "viewer" through on EVERY mutating route (leads · stage · follow-ups · interactions · outcome · chits/send · …). The walk hid it: `e2e/lib/real-api.cjs:73` PATCHes the level after the POST.
- "lib/access.js levels; one check, every route" — **true already**: the gate runs inside `auth` (`middleware/auth.js:182-200`), fails closed. Nothing per-route is needed; the fix is the INSERT (+ the token/person shape so a screen can grey).
- "the stage becomes Customer (memberships: the ONE writer)" — **false as a slot**: `lib/memberships.js:15` KINDS has no `customer`; `b297` makes `membership_kind` read-only to the app, so a new group is a migration the owner runs — until then the bill→customer path would be dead. `lib/crm.js:154` already DERIVES stage `customer` from `txn_count > 0`, and `routes/crm.js:305` refuses a move on the same fact (IS_CUSTOMER). One place exists; the counter bill simply never bumps it (`routes/chits.js:1505-1525` counts receivers only; a counter bill is sent to self).
- "in the same transaction as the bill" — **possible**: `lib/mint.js:263` takes `opts.client`; the route can hold one `withEntity(sender)` around `chit_deliver` and the bump, the bump in a savepoint (`db.trySavepoint`) so D-065 ("a CRM write never fails a guaranteed chit", `routes/chits.js:1504`) still holds.
- "reuse the interactions/follow-ups store for the stage trail" — **wrong store**: `memberships` is already append-only history (who · when · to; "from" = the older row). Writing an interaction per move would be the second log the brief forbids. The trail is a READ: one statement in the timeline (`routes/crm.js:99`), kind `stage`.
- "co-assist → CB Assist (naming rule)" — **unknown/false**: no doc or screen in either repo names "CB Assist"; the products are CB CRM · CB Accounts · CB Finance, and `/api/assist` is the assistant. A login labelled "CB Assist" would read as a product. The server's own words for the level are `View-only` / editor (`hat-gate.js SAYS`, `access.js PRESETS`).

## (b) Conflicts with rules
- The server's may/why: the walk's L20 and `e2e/crm.cjs §7` assert a viewer sees NO action (hidden); the brief and SYSTEM say every action shown, greyed WITH the sentence. Both walks change to the rule. One sentence per bar, not six (design rule 3; ai-eye E-1).
- No new key: the timeline entry `kind: 'stage'` is a new value in an existing kind-specific list (contract example updated by the api's `--write`, byte-copied to web).

## (c) Simpler
Everything above is smaller than briefed: one INSERT column, one bump statement, one SELECT, no migration, no new route.

## (d) Risks
- b297 absent → the timeline's memberships read sits in the existing `soft()` savepoint; the bump runs only when the party is on the sender's customer list (UPDATE, never INSERT) and never for a receiver (no double count).
- The token claim `access_level` goes stale after a PATCH until re-sign-in — the page only greys from it; the server decides on the row.
- Twin landing: api first (the INSERT + the timeline kind), web second (reads the kind; greys from the claim). Web alone still works (no `stage` entries, no greying — today's state). The web branch carries the unmerged WX-L2C branch (merged in).
- Other rounds: `routes/chits.js` send path and `list-ctl.js` are hot files — changes are additive and local.

## (e) Verdict
BUILD WITH CHANGES, as listed in the first line.
