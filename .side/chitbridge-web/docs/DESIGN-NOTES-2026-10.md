# Design notes — the shell, network, places, starter view, capabilities (2026-10)

**Status: DESIGN NOTES. Read-only investigation. Nothing here is built, migrated or changed.**
Plan row: **N16** (`C:\dev\MASTER-BUILD-2026-10.md` via `C:\dev\FIT-shell-enterprise-2026-10-07.md` row 92).
Answers the brief `C:\dev\designs-inbox\cb-shell-2026-10-07\cli-brief-network-shell-places-tiers.md` (Parts 1–5).
Gates: N17 (shell unit), N21 (registry + entitlement), N23 (`SPEC-places.md`), N24 (network-scope test).

**Decisions taken as given** (FIT §D, the recommended answers):
Q1 the shell is a unit (`CBShell.mount`) and `index.html` is its Home ·
Q5 no new word "tier": **plan** (b230's five) · **level** (core / included / add-on) · **entitlement** (off / trial / on / paused) · **view** (In use / Everything) — `tier` is deleted from the manifest ·
Q6 entitlement is report-only this cycle ·
Q7 Places = design only this cycle; a counter is never a place; a network node is never a place ·
Q11 Disputes = core, Network = core.

**How to read the evidence.** Paths are relative to the repo named by the prefix:
`api:` = `C:\dev\chitbridge-api` (main, tree of `c42a025`) · `web:` = `C:\dev\chitbridge-web` (main `eeeb341b`) · `eng:` = `C:\dev\chitbridge-engines` (main `2f4d50c`).
Every `file:line` was read or found with `grep -n`. "Not verified" means exactly that. Nothing was run against a database or a browser.
Gap ratings: **none** (works as asked) · **small** (one PR, no schema) · **structural** (needs a model change).

Reuse check done first: `node C:/dev/seams.cjs` for place, manifest, feature, entitlement, plan, event, cap, shell, ledger, vertical, policy_flags.
No existing seam for "place", an app manifest, `feature_use` or entitlement ("nothing — this may genuinely be new"). The reuse points named below are the ones that exist.

---

## Part 1 — Network and IAM: does the in-shop model hold for people outside the shop?

### 1.1 The six questions

| # | Question | Answer | Evidence | Gap |
|---|---|---|---|---|
| 1 | One person in several businesses, a different level in each? | **No, only as separate, unlinked rows.** A co-assist is an `identities` row with one `parent_entity_id`; the level, reach and money flags sit on that row. Two shops = two actor rows, two logins, nothing joins them. The person model (b283, M17) is design only. | `api:migrations/b173_access_level.sql:47-48` (`access_level`, `whole_entity` are columns on `identities`) · `:40-43` (cross-entity reach parked) · `api:db/schema.sql:15-38` (one `parent_entity_id`) · `api:routes/actors.js:317-325` (insert writes one parent) · `:98`, `:305` (`UNIQUE(actor_key, parent_entity_id)`) · `api:lib/access.js:49-56` (`levelOf` reads the row) · `api:middleware/auth.js:384` (`entityOf = parent_entity_id \|\| identity_id`: one token, one shop) · `C:\dev\IAM-SPEC.md:694-724` (§28 PARKED) · no `b283` file in any repo | **structural** — planned (M17 / b283) |
| 2 | Is a connection a grant with its own scope? | **No. A connection is a status, not a grant.** Two link systems, neither has a scope. Legacy `connections` (pending / accepted / rejected) is read by nothing outside its own route file. `cb_edge` has type + state, no scope; `cb_grant` does not exist. What a linked business sees is the catalogue tier (public / network / private), and "network" means "same root in the `cb_entity` path". That check is in route code and SECURITY DEFINER functions, not in table RLS. Supplier links are one-sided and see the public storefront. | `api:db/schema.sql:56-75` · grep `FROM/JOIN/UPDATE connections` outside `routes/connections.js` = 0 · `api:migrations/migration_b49_rls_policies.sql:46`, `:59` ("LATER (network): … connections") · `api:migrations/000_baseline_part2.sql:289-293` (`catalogue_items` policy: own entity or public; no network branch) · `api:migrations/net01_network.sql:18-33` (`cb_edge`, no scope) · `api:lib/catalogue-view.js:84-95` (`sameNetwork` = path root) · `:164-165` · `api:migrations/b122_network_search.sql:73-82` · `api:routes/relationships.js:76` ("STILL UNILATERAL") · `:338-341`, `:449-455` · `api:routes/connections.js:22`, `:161`, `:238` (uses `identity_id`, not `entityOf`: a co-assist connects as themself) · IAM-SPEC §14 `C:\dev\IAM-SPEC.md:381-396` (link-time tier rule) not enforced: `api:routes/connections.js:35-40`, `api:routes/relationships.js:139-143` | **structural** |
| 3 | Suspended / disconnected / settled: what happens to access, sessions, keys? | **Little.** Suspend flips `cb_edge.state` only; the path stays, so `sameNetwork` and `network_search` still treat the store as a member, while `isMemberSql` does not — two rules disagree. Disconnect re-roots and has a TODO for revoking grants. Legacy `connections` has no disconnect route. Entity tokens last 7 days and are not re-checked against the database. API keys are checked against `policy_flags.api_keys` only. Nothing writes `identities.status='suspended'`. | `api:src/services/network.js:182` (suspend = `_move`) · `:185-207`, TODO at `:207` · `api:src/routes/network.js:88-90` · `api:lib/catalogue-view.js:88-92` and `api:migrations/b122_network_search.sql:73`, `:80` (path root only) vs `api:lib/network-membership.js:31` (excludes suspended) · `api:routes/connections.js:13`, `:124`, `:148`, `:236` (request · pending · respond · list only) · `api:lib/identity-auth.js:212` (`expiresIn: '7d'`) · `api:middleware/auth.js:52-60` (entity built from the token) · `:84-95` (actor: own `break_status` only) · `:31-35`, `:355-363` (`keyListed`) · `api:routes/actors.js:742-751` (shop status checked at actor login only) · `api:db/schema.sql:33-34` (status `suspended` allowed, never written) | **structural** — sessions planned (M05); edge-state and shop suspension unplanned |
| 4 | Can cost or margin reach a connected business, a co-assist, a shared link? | **Connected business: no, in every path checked**, with one weakness: the outside strip is wrapped in `try {} catch (_) {}`, so a strip that throws still serves the view. **Shared link: no share routes exist.** **Co-assist: yes, on several routes** — the money gate (`cost.canRead`) is opt-in per route. Not cost, but a leak: the public stock route returns every item's `avail` whatever the shop's visibility. | Outside: `api:lib/exposure.js:28-34` ("COST IS NEVER A SWITCH", `delete d.cost`) · `api:lib/catalogue-view.js:396`, `:529` (try/catch) · `api:routes/network-design.js:892-911`, `api:routes/catalogue.js:459-475`, `api:lib/network-catalogue.js:38-52` (whitelists). Gated in-shop: `api:routes/chits.js:2595-2596` (`cost.canRead`, rule at `api:lib/cost.js:30-38`) · `api:routes/products.js:646` (`stripCosts`). **Not gated:** `api:routes/products.js:718` (`/workbook.xlsx`) and `:778` (`/export.csv`) → `catalogueRows` → `api:lib/sheet.js:89-96` `toSheet` copies every key; `HIDDEN` at `:47-53` has no `cost` · `api:routes/products.js:1525` (`/versions?at=` full snapshot) · `api:routes/till.js:2033` (`/stock`, `auth` + `requireScope('till')`), `avg_cost` at `:2052` · `api:routes/till.js:2413`, `:2452`, `:2525` (`landed`) · `api:routes/books.js`, `api:routes/supplies.js` (0 uses of `canRead`; rows not checked one by one). Public stock: `api:routes/integrations.js:461-466`, called by `web:public/shop.html:581-583` | **small** outside · **structural** inside the shop |
| 5 | Can a co-assist act without the shop's login? What does `access_events` record? | **Yes — own login** (`key@user_id`, OTP then PIN). RLS runs as the shop; the person is stamped as `app.current_actor`. `access_events` records **both**: `entity_id` = shop, `subject_identity_id` = whose access changed, `changed_by` = who changed it. It records **access changes only**, not actions, and has one writer (PATCH actors). Creation and removal are not written. `signin_events` does not exist yet (M06 / b282). Network edges store `requested_by` / `approved_by` as the business node, so the person who approved a link is lost. | `api:routes/actors.js:238-249` (handle) · `:698` on (login) · `api:middleware/auth.js:139-145` (`runWithActor`, "the actor is the person") · `api:middleware/hat-gate.js:126`, `:140` · `api:migrations/b172_access_events.sql:18-46` · `api:lib/access-events.js:34-45` (`ACTION_FOR`: level, hat, whole_entity, can_see_costs, break_status) · `api:routes/actors.js:512` (only call) · `:1195` (removal, no audit row) · `api:src/routes/network.js:16` (`actorOf` = node) · `api:src/services/network.js:153` | **small** in-shop · **structural** for acts across businesses |
| 6 | Is "trade ready" checked before a connection, or only shown? | **Only shown.** Linking checks `mayTrade` (active, on the rail, same population). Supplier-add answers "Supplier added" even when that fails. Supplier-acceptance records that a buyer looked; its header says no refusal. Clearances are copied onto a chit at send, never blocking it. | `api:routes/connections.js:35-62` · `api:src/services/network.js:112-131` · `api:routes/relationships.js:139-167` (`mayTrade` at `:162`, result ignored) · `api:lib/istest.js:140-154` · `api:routes/governance.js:460-499` (header `:462-464`, snapshot `:490-495`) · `api:routes/chits.js:1097-1108` ("never blocks the send") | **small** if display-only is the design (`governance.js:462-464` says it is) · **structural** if the network promises trade-ready parties — Athi to say which |

### 1.2 The three structural gaps, in order of risk

1. **Leaving does not take access away.** A suspended edge keeps the path, so network-tier catalogues stay visible (`api:src/services/network.js:182` vs `api:lib/catalogue-view.js:88-92`). No shop-level suspension exists; tokens (7 days) and API keys never look at shop status (`api:middleware/auth.js:52-60`, `:355-363`). Disconnect has a revoke TODO (`api:src/services/network.js:207`). Partly planned: M05 (revocable person sessions). The edge-state disagreement and shop suspension are not in the plan.
2. **No cross-business permission model.** A connection is a yes/no with no scope (`api:db/schema.sql:56-75`, `api:migrations/net01_network.sql:18-33`); one actor row = one shop (`api:migrations/b173_access_level.sql:47-48`); RLS has no cross-business branch (`api:migrations/000_baseline_part2.sql:289-293`); acts across businesses name the node, not the person (`api:src/services/network.js:153`). Any outside access added later would be invented route by route. M17 (persons) covers one person in many shops; nothing covers a *business* granting scope to another.
3. **The money gate is opt-in per route.** Export, workbook, versions, till stock and match, books and supplies return cost with no `can_see_costs` check (rows above). `lib/cost.js` says why the gate cannot be RLS: the co-assist *is* the entity to Postgres (`api:lib/cost.js:7-10`). So the fix is a test that lists every route returning a cost key, not a policy. N24 tests the outside half; the inside half has no row yet.

---

## Part 2 — The shell: applications that run alone and share one frame

### 2.1 Today's `cap-*.js`: who calls whose globals

31 files in `web:public/app/cap-*.js`. `web:public/app/MODULES.md:18` says 26 and has drifted (`node tools/gen-modules-doc.cjs --check` exits 1; missing cap-bank, cap-crm, cap-crm-record, cap-entry, cap-period).
Method: collect top-level definitions per file, search the other cap files, drop strings/comments/locals by reading each hit. About 115 real caller→callee pairs. Indented definitions inside IIFEs were not collected, so counts may be low.
"guarded" = the call sits behind `typeof X === 'function'` or `ensureCap(...)`.

| caller · lines | callee · defined at | guarded |
|---|---|---|
| cap-admin `:1885`, `:1886`, `:1898`, `:1998` | `CBIdDocs` · cap-iddocs `:18` | `:1885` only |
| cap-admin `:3799` | `stdCounts` · cap-standards `:683` | no |
| cap-admin `:4875` / `:5782` | `CATSET_DEFS` · cap-catsetup `:73`; `STANDARDS` · cap-standards `:30` | yes |
| cap-bank `:34`–`:193` | `bkDec` `:139`, `bkErr` `:156`, `bkToMinor` `:146`, `bkDate` `:147`, `bkMoney` `:140`, `bkDrCr` `:145`, `bkTab` `:504` · cap-books | no |
| cap-bank `:52`–`:186` | `peField` `:68`, `peSel` `:71`, `peBad` `:59`, `peOwner` `:41`, `peAmt` `:70`, `peBtn` `:73`, `peVal` `:40` · cap-period | no |
| cap-bank `:176`, `:177` | `enOpen` · cap-entry `:75` | yes |
| cap-books `:751` / `:788`, `:1163` / `:386` | `enOpen` · cap-entry `:75`; `enReverse` · cap-entry `:329`; `crmAfterEdit` · cap-crm-record `:306` | yes |
| cap-categories `:929`, `:933` / `:948` | `cbDefRegistries` · cap-definitions `:184`; `cbDefLabelOnce` `:1495` | yes |
| cap-catsetup `:93`–`:99`, `:197`, `:201`, `:1419` | `cbDefNew` `:742`, `cbDefEdit` `:755`, `cbDefSetStatus` `:1382`, `cbDefRetire` `:1420`, `cbDefRegistries` `:184`, `cbDefAfterChange` `:1350` · cap-definitions | `:93` via `ensureCap` |
| cap-chit2 `:390` | `adoptOpen` · cap-adopt `:24` | via `ensureCap` |
| cap-connector `:42`, `:49`, `:56`, `:99`, `:160` / `:83`, `:104` / `:93`, `:149` / `:141` | `paintAcDetail` `:464`, `_ago` `:427`, `acTypeOf` `:396`, `loadCoassists` `:670` · cap-workforce | `paintAcDetail`, `acTypeOf`: no |
| cap-crm-record (~25 names, ~60 sites) | `CRM` `:32`, `crmBar` `:213`, `crmLoad` `:184`, `crmGo` `:220`, `crmEdit` `:46`, … · cap-crm | mixed |
| cap-crm-record `:101`, `:179`, `:90`, `:250`, `:58`, `:280`, `:303`, `:413` | `bkDate`, `bkTime` `:287`, `bkMoney`, `bkToMinor`, `partyBooksHTML` `:202`, `partyEditOpen` `:332`, `payOpen` `:395` · cap-books | mixed |
| cap-crm `:55`, `:371` / `:60` / `:91` / `:168` | `bkDate`, `bkTime`, `partyDueChipHTML` `:188`, `bkDuesStore` `:161` · cap-books | no |
| cap-crm `:232` / `:506` | `crmRecordOpen` · cap-crm-record `:110`; `crmRecordClick` `:396` | `:232` no |
| cap-definitions `:1376`–`:1400` | `catsetDefsLoad` `:74`, `catsetPaintDetail` `:1569`, `CATSET` `:28`, `catsetPaint` `:1571` · cap-catsetup | yes |
| cap-entry `:77`–`:339` (12 sites) | `bkRef` `:54`, `booksDuesLoad` `:173`, `bkWhy` `:151`, `bkToday` `:148`, `bkPartyLabel` `:167`, `bkLtModel` `:839`, `bkOnce` `:47`, `bkHealthLoad` `:1675`, `bkTab` · cap-books | no |
| cap-legend `:774` / `:770`, `:783` / `:786` | `stdCounts` `:683`; `stdWhyHTML` `:645`; `stdRecordHTML` `:599` · cap-standards | `:774` no |
| cap-messages `:336`–`:348` | `wlLoad` `:53`, `wlRows` `:168`, `wlLine` `:669` · cap-worklist; `openChit2` · cap-chit2 `:62` | yes |
| cap-period (~15 names, ~60 sites) | `bkOnce`, `bkRef`, `bkFyNow` `:1416`, `bkPeriodsLoad` `:1427`, `bkIsOwner` `:1420`, `BK_MONTHS` `:1417`, `bkCur` `:138`, … · cap-books | `:41` only |
| cap-standards `:558` | `setSetSec` · cap-admin `:3649` | no |
| cap-workforce `:69`, `:206`, `:208`, `:250`, `:251` | `CBIdDocs` · cap-iddocs `:18` | mixed |
| cap-workforce `:70` | `_capShowDetail` · cap-admin `:289` | no |
| cap-workforce `:15`, `:16` / `:21` / `:198` / `:286`, `:287` | `acLoadDevices` `:24`, `piCockpit` `:92`, `_download` `:182`, `_buildInstaller` `:209` · cap-connector | yes |
| cap-worklist `:942`, `:943` / `:1598`, `:1599` | `rgQuickAdd` · cap-register `:739`; `openChit2` · cap-chit2 `:62` | yes |

(All lines above are in `web:public/app/cap-<name>.js`.)

**What the list says.**
- **cap-books is a library**, not an application: entry, period, bank, crm and crm-record call its `bk*` helpers unguarded. It must become a shared unit (or its helpers move to one) before any of those runs alone without loading the whole ledger.
- **cap-period is a form kit** for cap-bank (`pe*`).
- **Pairs that call each other both ways:** crm ↔ crm-record, definitions ↔ catsetup, connector ↔ workforce. Each pair is one application in two files.
- **Calls into `app.html`** (counted by files that use them): `modal` 23 (`web:public/app.html:15264`), `closeModal` 22 (`:15270`), `ensureCap` 19 (`:4814`), `renderApp` 13 (`:4881`), `confirmAsk` 13 (`:7145`), `SESSION` 11 (`:2090`), `openChit` 9 (`:16295`), `CFG` 8 (`:1722`), `MSG` 7 (`:3162`), `bgRenderApp` 7 (`:4854`), `navTo` 7 (`:5933`), `startDrag` 6 (`:17875`). Most tied: cap-admin (55 names), cap-workforce (38), cap-dispute (27), cap-chit2 (24), cap-network (23). Least: cap-bank (0), cap-period (2), cap-iddocs (2), cap-standards (2), cap-entry (3).
- No name is defined twice across cap files.

### 2.2 Can a capability load with no shell present?

**Yes, and three pages already do it.** `ensureCap` (`web:public/app.html:4814-4837`) injects `/app/cap-<name>.js?v=CB_BUILD` once per name (`:4832`); `CAP_OF` (`:4745`) maps screen → capability.
- `web:public/accounts.html:306-311` loads cap-folders, cap-books, cap-entry, cap-period, cap-bank with plain script tags, after core, accounts-shell, avatar, locale, helpers, list-ctl, list-legacy, tax, chit-sheet (`:294-305`). It supplies stand-ins: `CFG` `:280`, `SESSION` `:289`, `EP` `:290`, `UI` `:291`, `go()` `:292`, `navTo` `:408` and `openChit` `:409` (both send the person into app.html), `confirmAsk = CBConfirm` `:412`.
- `web:public/crm.html:315-319` (cap-folders, cap-books, cap-crm, cap-crm-record) with the same stand-ins (`:290`, `:299-302`, `:337-339`) plus its own `modal` / `closeModal` (`:342`, `:347`).
- `web:public/standards.html:153` (cap-standards) with its own `esc`, `tx`, `navTo` (`:146-149`).

**What breaks without app.html:** `ensureCap`, `renderApp`, `bgRenderApp`, `CAP_LOADED`, `hasCap`, `openAssist`, `meNow`, `MSG`, `startDrag`, `makeMovable`, `openChit2`, and `modal` unless the page brings one. Example: accounts.html defines no `modal` (grep = 0) but cap-books calls it at `web:public/app/cap-books.js:338` and `:398`. Whether those are reachable from accounts.html: not verified.
None of the stand-alone pages adds the `?v=` cache-buster that `ensureCap` adds.

**Session:** every page reads localStorage `cb_sess` (`{token, role, name, entity, bridgeId, duty, shop}`): written by `web:public/app.html:3932`, restored `:3905`; read by `web:public/accounts.html:355`, `web:public/crm.html:331`, `web:public/standards.html:163`, `web:public/till.html:4424`, `web:public/shop.html:79`, `web:public/product-lab.html:126`, `web:index.html:267`. Cleared on 401 by `web:public/app/core.js:999`. Exception: `know-your-business.html` keeps its own token in memory (`:66`, `:85`). This already meets the brief's rule "context travels by the session, not the address".

### 2.3 Where the header's data comes from today

**Four sources, no single one.**

| Item | Source today | Evidence |
|---|---|---|
| Shop name | session blob (`SESS.entity`), then `/api/entities/me` `display_name` | `web:index.html:392`, `:395-402`; `web:public/accounts.html:400-405`; `web:public/crm.html:361-367`; `web:public/app.html:5034` |
| Name · legal name · address · phone · GSTIN merged | `invoiceParty()` (identities row + vault "identity") via `GET /api/governance/profile` | `api:lib/profile.js:274`; `api:routes/governance.js:314` |
| Address, phone, GSTIN raw | `GET /api/entities/me` | `api:routes/entities.js:637`, SELECT `:699-702` |
| Licences | vault "licence" section; `entity_compliance` via `resolveReadiness`; `kyb.yourself()` with days left | `web:public/app/cap-admin.js:93`, `:103`; `api:lib/readiness.js:23`; `api:lib/kyb.js:29`; `api:routes/kyb.js:12` |
| Trade ready | `resolveReadiness` via `/api/governance/readiness` | `api:lib/readiness.js:83`; `api:routes/governance.js:262`, `:352` |
| Person (avatar) | session only | `web:public/app/avatar.js:426-430` |

Closest single read today: `/me?include=readiness,vault` (`api:routes/entities.js:881-888`). N19 (`GET /api/entities/header`) is the planned single source; it should be built over `invoiceParty` + `kyb.yourself`, not a new query.

### 2.4 The manifest shape

`tier` is removed (Q5). `needs` uses today's words. Part 5's fields are added (N21).

```
id        'accounts'                      stable key; same as the capability key in Part 5
name      'CB Accounts'
route     '/accounts.html'                a utility page, never app.html (I12); else state != built
icon      '₹'
area      selling | running | labs | setup
state     built | coming | workshop       workshop = exists only inside app.html (FIT Q3)
needs     { level?: 'viewer'|'commenter'|'editor', money?: true, owner?: true }
facts     '/api/accounts/facts'           a URL the shell GETs; returns ≤ 2 short lines. Not a function:
                                          the shell must not load the app's script to call it.
-- Part 5 (N21) --
key, purpose, faces (inward|outward|authority), level (core|included|add-on),
requires [keys], owns [tables], listens [events], pitch, promise (from_switch_on|backfilled)
```

Change from the brief: **`facts` is an endpoint, not a function.** The brief's own rule is "the shell never imports an application's code"; a `facts()` function would have to be imported. Today the index makes 7 reads for 3 boxes (`web:index.html:395-454`) including `/api/products?limit=500` to count items with no cost — a facts endpoint per app replaces that with one small read each.

Nothing like this exists. The nearest lists: `CAP_OF` / `CAP_GATED` / `CAP_TITLES` (`web:public/app.html:4745`, `:4747`, `:4793`), `CAP_CATALOGUE` (`web:public/app/cap-legend.js:13`, 18 entries), `CBSCREENS` (`web:public/app/screens.js`), `lib/plans.js` FEATURES (`api:lib/plans.js:14`, 9 modules) and FEATURE_DEPS (`:18`). The manifest should be the one list these are generated from or checked against, not a fifth.

### 2.5 Smallest change to render the index from manifests

Today the boxes are hand-written HTML: Till `web:index.html:156`, Catalogue `:164`, CB Accounts `:172-181`, labs `:185-221`, foot links `:226-236`. Facts attach to fixed ids (`f_till`, `f_cat`, `f_bk`, `st_*`; `:305-313`, `:474-478`).
Smallest change: one array of manifest entries; render `.main`, `.lgrid` and `.foot` from it before `open_()` (`:567`), keeping every id and `data-testid` so facts and e2e keep working. CB Accounts needs one special case (its `.ledact` block and badge).

### 2.6 Steps (each ships alone)

1. **Manifest file, read by nothing.** `public/app/manifest.json` listing today's apps with honest `state` (5 built, the rest `coming`/`workshop`). Add a check to `docs-guard` that every `cap-*.js` and utility page is listed. Changes nothing on screen.
2. **Regenerate MODULES.md** (it has drifted) from the same list.
3. **Index renders from the manifest** (2.5). Same ids, same tests, same look.
4. **Facts endpoints**, one per built app; the index switches from its 7 reads to them (I19 budget line each).
5. **Shared stand-ins become a unit.** The stand-ins accounts.html and crm.html each write (`CFG`, `SESSION`, `EP`, `UI`, `navTo`, `openChit`, `confirmAsk`, `modal`) become one small `host.js`; both pages load it. Removes the copy, and gives a third page what it needs.
6. **Split cap-books' helpers** (`bk*`) into a unit the others load, so bank/entry/period/crm stop loading the ledger to format a date.
7. **`CBShell.mount`** (N17) reads only the manifest + `/api`; Home = index (N18); utility apps mount it (N20).
8. Merge the two-way pairs (crm ↔ crm-record, definitions ↔ catsetup, connector ↔ workforce) only when one of them is next touched.

---

## Part 3 — Places: one idea behind tables, shelves, trays and cold rooms

### 3.1 Answers

**Q1. How a table is stored today, and what ties it to a bill.**
- A table is **free text, not a record.** `WORDS.subject = 'table'` (`eng:src/orders.js:68`); an order is `{id, subject, state, at, by, till, kind, lines, rounds}` (`:101-113`); the waiter types the subject (`web:public/till.html:19907-19911`, `:19709-19712`). "Same subject may not open twice" is a lower-cased text match (`eng:src/orders.js:90-99`).
- Orders live in **device memory** (`web:public/till.html:19546-19550`), in localStorage `cb_till_orders` (`:19575-19592`), or on the **shop-PC floor hub** on port 7071 (`api:tools/tally-connector/till.js:104-105`, routes `:1070-1090`, kept in `floor.json` `:709-723`). The hub's header says it is "the shop PC's memory today and a table in Postgres later" (`eng:src/orderhub.js:5-8`).
- The tie is **one way, order → bill**: settle stores `o.bill` (`eng:src/orderhub.js:126-128`; `web:public/till.html:19750-19780`).
- The bill carries `order: {type, table, kots}` (`web:public/till.html:20206-20209`), but `table` comes from a **second** free-text input `cb_till_table` (`:19461-19462`), not from the order's subject. No reader of `bill.order.table` exists (grep, three repos).
- The chit's subject is `'Counter sale ' + bill.no` (`web:public/till.html:5946`) and `business_json` (`:5948-5970`) carries no table. **The server never hears about a table** (`api:tools/tally-connector/till.js:703-705`).

*If a bill held only `place_id`:* `findOpen` compares ids, not text (`eng:src/orders.js:91-99`); the hub's `open` carries it (`eng:src/orderhub.js:68`); screens that paint `o.subject` (`web:public/till.html:19804`, `:19891`) and the KOT words (`:19948-19951`) need a lookup; the two table inputs become one; `chitOf` must carry it. There is no server row for the id to point at until the order hub is in Postgres.

**Q2. What stock holds for location.**
- `stock_movement.location text NOT NULL DEFAULT 'default'` (`api:migrations/b214_stock.sql:52`), and the migration says "v1 always writes 'default' … nothing reads it yet" (`:22-26`).
- `stock_balance` key is `(entity_id, item_id, location, lot)` (`api:migrations/b215_stock_by_batch.sql:51`).
- `api:lib/stock-store.js:27` `DEFAULT_LOCATION = 'default'`; every use is `|| DEFAULT_LOCATION` (`:34-38`, `:46-56`, `:79`, `:174`, `:202-207`, `:231`, `:276-280`, `:304`). No caller passes a location.
- A second stock number lives in `catalogue_items.item_data.avail` (`api:routes/products.js:1273-1274`); `availability.stamp` takes a location and drops it (`api:lib/availability.js:37-48`).
- The movement reasons have **no transfer**: `opening, purchase, sale_return, purchase_return, sale, damage, expiry, theft, sample, count_adjust, writedown` (`api:migrations/b214_stock.sql:72-74`).

**Q3. Does the model fit both without a special case?** Yes, with three choices made explicitly.

| Strain | What the model does |
|---|---|
| **Split bills** | A table holds the **order**, not the bill. One order settles into one or many bills (today: `o.bill`, `eng:src/orderhub.js:126-128`). The place frees when the order settles. No special case. |
| **Moving a table's order** | End the link to T4, start a link to T7 — two lines in history, the order untouched. |
| **A lot over two shelves** | The brief says "two lots". **Today's ledger says otherwise**: `stock_balance` already allows the same lot in two locations (`api:migrations/b215_stock_by_batch.sql:51`). Two options for Athi: (a) keep one lot, quantity per (lot, place) stays in `stock_balance` and the place link carries no quantity; (b) split the lot on put-away. (a) matches the brief's own line "quantity belongs to this lot in this place, not to the link" and needs no new lot key. **Recommend (a).** |
| Exclusive vs shared | `mode` on the place. Exclusive = at most one open link (a partial unique index). Shared = many. |
| Cold / dry fit | `provides[]` on the place; `needs[]` comes from the item (the lotfields pack, `api:lib/lotfields.js:41-57`, is the pattern). Check at put-in. |

**Q4. Location vs the quantity ledger — where is the line.** Real risk. `stock_balance` is keyed by location, so the day a location stops being `'default'`, a shelf-to-shelf move changes two balance rows. With no `transfer` reason, someone would post it as `count_adjust` ±, which books a loss and a gain that did not happen.
**The line:** quantity and value live only in `stock_movement` / `stock_balance`. A place stores references and times only. A move inside one shop is a **place event**, never a stock movement. So `stock_balance.location` stays `'default'` (or becomes the shop) and the "where" is answered by the place history. M55's column is "place (label)" (FIT Q7), read-only text until Places lands.

**Q5. Can place history double as the traceability record?** Half of it.
- Today's trace is **chit to chit** (who passed what to whom): `summary_json.trace` with `parents[], is_origin, product, qty, unit, base_qty, network` (`api:lib/trace.js:44-67`), written at `api:routes/chits.js:647-662`, read by `/trace*` (`:4722`, `:4815`, `:4844`, `:4937`) and `web:public/app/cap-traceability.js:70`, `:194`, `:203`. It records no place, no step, no lot.
- Place history is **where inside a shop**. Together they are EPCIS's two halves. So: Places writes place events; cap-traceability **reads** them beside the chit edges; the join key is the lot (`gs1.lotKey`, `eng:src/gs1.js:186-192`). No second tracker.
- `eng:src/gs1.js` has GTIN check digit and AIs `01/10/11/15/17/21` only (`:143-145`); GLN and SSCC appear in a comment (`:27`). EPCIS appears only as a roadmap entry (`web:public/app/catalogue-model.js:539`, "implement under our own names"). There is **no** aggregation or event model today.

### 3.2 Schema (draft — for N23; no SQL is run)

```
place          id uuid, entity_id, label text, kind text, parent_id uuid null,
               mode 'exclusive'|'shared', capacity int null, provides text[],
               state 'free'|'held'|'closed', created_at, archived_at
               -- label unique per (entity_id, parent_id); FORCE RLS on entity_id
               -- parent cannot be a descendant (checked on write; path kept as ltree for the check)

place_link     id, entity_id, place_id, holder_kind 'order'|'lot'|'place', holder_ref text,
               from_at, to_at null, by_identity_id
               -- a place inside a place is a link with holder_kind='place' (tray in rack)
               -- current = to_at IS NULL; exclusive places: unique (place_id) WHERE to_at IS NULL
               -- append-only: closing a link sets to_at once; nothing else is updated

place_event    id, entity_id, at, by_identity_id, action 'add'|'delete'|'observe',
               parent_place_id, child_kind, child_ref, step text, note
               -- the history the brief asks for; one row per put-in / take-out / move
```

"Where was this lot last Tuesday at 2pm": the link open at that time for the lot → its place; then the link open at that time for that place → its parent. Moving a tray = close one `place`→`place` link and open one. Nothing below is rewritten.
Core change: at most one nullable column, later — `order.place_id` in the hub (not on the chit), and nothing on `stock_movement`.

### 3.3 EPCIS mapping (adopt, do not invent)

| Our line | EPCIS 2.0 | Fields we fill |
|---|---|---|
| put a lot on a shelf | AggregationEvent, `action=ADD` | `parentID` = place, `childEPCs`/`childQuantityList` = lot (GTIN+lot from `gs1.js`), `bizStep=storing`, `bizLocation` = place |
| take it off | AggregationEvent, `action=DELETE` | same; `bizStep=picking` |
| move a tray / rack | ObjectEvent on the **parent**, `action=OBSERVE`, new `bizLocation` | children follow by aggregation — exactly "moving a place moves what is in it" |
| seat an order at a table | AggregationEvent ADD (parent = table, child = order ref) | not a goods event; we keep the shape, EPCIS export skips non-goods holders |
| receive / ship (already a chit) | ObjectEvent with `bizTransaction` = chit id | the trace edge already holds this; no new row |
| place id | `bizLocation` / `readPoint` as SGLN (GLN + AI 254 extension) | a shop with no GLN exports a local URN; GLN is optional |

Names stay ours on screen (put in · take out · move); EPCIS is the export and the vocabulary for `step`. Field names above are from the EPCIS 2.0 standard as recalled; check against the GS1 text in N23 before freezing (not verified here).

### 3.4 Yes or no, and what each side gives up

**Yes — one capability serves both.** It is design only this cycle (Q7).
- **Till gives up:** the free-text subject as identity (it becomes the place's label); the second `cb_till_table` input; and, first, its device-only hub — the order hub must reach Postgres before a `place_id` has anything to point at. Offline still works: the hub stays shop-local, the place list is cached.
- **Stock gives up:** `location` as a meaningful key. It stays `'default'`; "where" moves to place history. No `transfer` reason is added for in-shop moves.
- **Neither** gets a capability column on a core table. A counter is never a place; a network node is never a place (`cb_entity` / `cap-network.js` "place" placement is geography: `web:public/app/cap-network.js:36`, written to `identities` lat/lng by `api:routes/network-design.js:415-438`).

---

## Part 4 — Starter view: show what is used, keep the rest one step away

### 4.1 Answers

**Q1. Where the ledger folders are defined; any "enabled / used" today.**
- Full list: `eng:src/reg-in.js` — `GROUPS_IN` `:52` (28 groups, 15 primary), `LEDGERS_IN` `:91` (57), `EXPENSE_CLASSES_IN` `:154` (19), `INCOME_CLASSES_IN` `:178` (6), `ASSET_CLASSES_IN` `:193` (6); exported `:606-608`. `eng:src/accounts-packs.js:52` (`packFor`) is a facade; the API copy is adopted (`api:lib/accounts-packs.js:1`).
- At switch-on the **whole chart is seeded**: 28 groups + 81 leaves = **109 rows** per shop (`api:lib/books-engines.js:98-110` `chartRows`; `api:lib/books.js:554-583` `enable`, loop `:565-571`). The pack is chosen by **country**, not trade (`api:lib/books.js:559-560`).
- On screen: `BK_LT_BANDS` (4) `web:public/app/cap-books.js:816-821`, `BK_LT_GROUPS` (9 + Other) `:823-827`, `bkLtModel` `:839` (ignores `active`); accounts menu `NAV` 20 items `web:public/accounts.html:319-340`, `NAV_GROUPS` `:363-369`.
- **On/off today:** the Ledger switch is `books_setting.enabled` (`api:migrations/b272_books_ledger.sql:15-27`), routes `api:routes/books.js:68-75` (404 when off), `:87` enable, `:97` off, `:111` health; the web probes health once (`web:public/app.html:4979`, `web:public/accounts.html:603-607`). Each ledger has `ledger_account.active` (`api:migrations/b272_books_ledger.sql:51`) — read (`api:lib/books-store.js:40`, `api:lib/books-engines.js:115`) but **never written false**.
- **No "used" record exists anywhere** (`first_used`, `feature_use` — grep 0 in all three repos). `adoptPack` (M35) does not exist yet either.

**Q2. The `feature_use` record.**
It belongs in `identities.policy_flags` (jsonb, `api:migrations/b130_policy_flags.sql:19-23`), whose rule is "whitelisted in `lib/policy.js` — never written raw" (`api:lib/policy.js:9`; `FLAGS` `:27-283`; merge write `set()` `:428-447`, `policy_flags || $1` at `:440`; route `api:routes/entities.js:623-635`; read back by `/me` `:839`, `:856`).

```
policy_flags.feature_use = {
  "<list>.<item>": { state: "on" | "off" | "auto", first_used: "2026-10-07T…", by: "<identity_id>" }
}
-- key examples: "ledger.4410", "catalogue.field.hsn", "till.set.voice", "lab.combo", "index.crm"
-- "auto" = shown because it has data or the business type starts with it; nothing stored for "auto"
--          until the item is first used (absence = auto)
-- first_used is written once by the server on the first posting that touches the item
```

- `FLAGS` has no type for a per-key object (`enum, number, set, map, switches`; `switches` stores `{on, msg}`, `api:lib/policy.js:279-282`). Needs one new type, declared in `FLAGS`, plus a `docs/FIELDS.md` entry. Precedents to copy: `connectors_in_use` (`api:lib/policy.js:240-246`, shown first / rest folded at `web:public/app/cap-admin.js:4607-4609`, toggled at `:4681-4687`) and `system_folders` (`api:lib/policy.js:274-282`, `api:routes/folders.js:125-130`).
- For the **ledger only**, "in use" can be computed with no record: has a journal line, or has an opening balance, or `active` was set. The record is needed only for "the shop turned it on" and for lists with no activity table (fields, settings, labs).
- Not `ui_prefs` (`api:migrations/b166_ui_prefs.sql:35`): that is per-person look, this is per-shop state.

**Q3. Where a beginner meets too much at once** (ranked by how often a new shop sees it).

| Rank | Screen | What is shown | Evidence |
|---|---|---|---|
| 1 | Index | 3 boxes + 4 labs + 7 foot links (shell adds up to 14 cards) | `web:index.html:156-172`, `:191-213`, `:227-233` |
| 2 | Till settings | 7 sections, ~20 rows, plus a Switches dialog (row count approximate) | `web:public/till.html:3487-3685`, `:3709` |
| 3 | Product page (app.html) | 17 row-tabs; a per-shop picker exists but only 2 are fixed | `web:public/app.html:13097` `PROD_TABS`; `:13941-13948` |
| 4 | Ledger tree | 4 bands, 9 groups + Other, ~79 leaves, plus every party | `web:public/app/cap-books.js:816-842` |
| 5 | Accounts menu | 20 views in 5 groups | `web:public/accounts.html:319-369` |
| 6 | Settings (app.html) | 10 sections; Policy alone has 29 flags | `web:public/app/cap-admin.js:3601-3637`; `api:lib/policy.js:27-283` |
| 7 | Product Lab | ~216-row table (count from a comment), 6 columns | `web:public/product-lab.html:19`, `:332-333` |
| 8 | CRM | 11 columns (3 shown), 4 filters; record has 6 tabs | `web:public/app/cap-crm.js:246-262`, `:298`; `web:public/app/cap-crm-record.js:24` |
| 9 | Labs | 6 lab pages | `web:public/product-lab.html`, `offer-lab.html`, `offer-lab-next.html`, `combo-lab.html`, `conversion-lab.html`, `list-lab.html` |

The one shared mechanism is `CBList` (`web:public/app/list-ctl.js`; contract `:1-33`; toolbar `paintTools` `:419-445`; count text `:413-417`). "In use · Everything" is one more segment in `paintTools`, beside group and view. 37 `CBList.mount` calls would get it for free. The product page's row picker (`web:public/app.html:13938-13954`) is a second, older version of the same idea; it should fold into this.

**Q4. Does business type pick defaults today?** **No, not automatically.**
- `identities.vertical` (`api:migrations/b229_kind_correction_and_vertical.sql:93`, default `'general'`) is read only for reporting (`api:routes/entities.js:2492`, `:2535`) and platform filters; no writer besides the migration found (grep, not exhaustive). Registration picks a constitution, not this column (`web:public/app.html:3667-3678`).
- Trade-driven lists exist but are opt-in: `api:lib/lotfields.js:41-58` (by profile sector, not `vertical`); `api:lib/starter-fields.js:149` `starterFor` (`api:routes/products.js:1050-1061`); `web:public/app/catalogue-starter-categories.js:25-94` ("OPT-IN, NEVER AUTOMATIC", `:15`).
- So "the business type starts with it on" needs one rule table (vertical → keys), in data, read by the same mechanism. Two words for trade exist (`vertical` and profile sector); pick one before writing the table.

### 4.2 The trial

**The Ledger tree** (`bkLtModel`, `web:public/app/cap-books.js:839`), riding M42.
Why first: the biggest gap between "shown" (109 rows) and "used" (a new shop posts to maybe 10); "in use" can be computed from postings with no new record; it already uses CBList; nothing is hidden that a posting needs, because posting goes to the ledger by code, not by what is shown. The record (`feature_use`) is then added for the second list (Till settings).

---

## Part 5 — Capabilities as separate services

### 5.1 Answers

**Q1. Does entitlement exist today? Where read, how often.**

| Mechanism | What it is | Read where · how often | Evidence |
|---|---|---|---|
| `identities.plan` | test / free / silver / gold / platinum | reported only; b230's header says it enforces nothing; whether b230 has run on live: not verified | `api:migrations/000_baseline.sql:618`; `api:migrations/b230_plan_types.sql` header; `api:routes/governance.js:96` still defaults to `'free'` |
| `lib/plans.js` | FEATURES (9), FEATURE_DEPS, quotas all empty | `@stage held`, imported only by the entitlements route | `api:lib/plans.js:1-3`, `:14`, `:18`, `:46`, `:67`; `api:routes/entities.js:2487` |
| `governance/entitlements.js` | a second plan catalogue (`constitution.plan_menu`) | live for one quota (`max_entities`, platform scope) | `api:governance/entitlements.js:5`, `:17`; `api:routes/governance.js:108` |
| `GET /api/entities/entitlements` | per-shop report, `enforced:false` | per call; **no web caller** | `api:routes/entities.js:2484`, `:2539` |
| `lib/visibility-cap.js` | plan half needs `opts.enforcePlan`; no caller passes it (the outage note) | every `/me` and catalogue view | `api:lib/visibility-cap.js:85-99`, `:107`; callers `api:routes/entities.js:853` |
| **`identities.capabilities`** | the real per-shop add-on list, stamped at mint from packs | server: `requireConnector`, a DB read **per request**; web: once per session via `/me` | `api:migrations/migration_b55_connector_blueprint_and_capabilities.sql:19`, `:78`; `api:routes/connectors.js:55-63`; `web:public/app.html:4746` `CAP_GATED`, `:4812` `hasCap`, `:4983-4988` |
| **Ledger switch** | `books_setting.enabled` | server: a DB read **per request** (no cache); web: once per session | `api:routes/books.js:68-76`; `web:public/app.html:4977-4979`; hooks cached 60 s / 600 s `api:lib/books-hooks.js:55-67` |
| `lib/exposure.js`, `lib/availability.js` | per-item storefront switches; stock freshness | not entitlement | `api:lib/exposure.js:17-23`; `api:lib/availability.js:37-48` |

**Entitlement is not in the session.** The JWT holds identity fields only (`api:lib/identity-auth.js:181-212`); `/me` returns `capabilities` and the web keeps them in `SESSION`.

**Q2–Q3. Draft registry, from the code.** Level = the brief's guess with Disputes and Network moved to core (Q11). **Athi moves the rest.** "Core tables" = identities, chit_header / chit_detail / chit_status / chit_line, catalogue_items, state_log. "Events" = what it needs from the core; ✓ = a record exists today.

| key | faces | level | today's home · files | touches core tables directly | needs | exists today? | promise |
|---|---|---|---|---|---|---|---|
| till | inward | core | `till.html`; `api:routes/till.js` | identities W `:1781` (policy_flags), chit_header R `:1261`, catalogue_items W `:834` | bill rung | ✓ chit + state_log | — |
| catalogue | inward | core | app.html; `api:routes/products.js` | catalogue_items W `:428` / R `:297` | — | — | — |
| trade-ready | authority | core | `cap-readiness.js`; `api:lib/readiness.js` | entity_compliance (own) | — | — | — |
| **disputes** | outward | **core** (moved) | `cap-dispute.js`; `api:routes/chits.js:3794-4148` | chit_disputes + state_log `dispute_raised` | chit sent | ✓ | — |
| **network** | outward | **core** (moved) | `cap-network.js`, `network.html`; `api:routes/network-design.js` | identities W `:324` / R `:126`, catalogue_items R `:968` | connect / suspend | cb_edge (no person) | — |
| accounts (books) | inward | included | `accounts.html`, cap-books/entry/period/bank; `api:routes/books.js` | none directly; reads chit_header `api:lib/books-store.js:128`, chit_detail `:443` | bill, pay, purchase | bill ✓ · **pay ✗** (see 5.4) | backfilled (books_outbox, `api:migrations/b273_books_journal.sql:149`) |
| employees | inward | included | `cap-workforce.js` (app.html) | identities W `api:routes/actors.js:317` | — | access_events (changes only) | — |
| places: tables | inward | included | not built | — | order opened / settled | ✗ (device only) | from switch-on |
| stock | inward | included | app.html; `api:lib/stock-store.js` | none directly; posts from chits `api:routes/chits.js:1561` | bill, purchase | ✓ chit lines; stock_movement | backfilled (from chits) |
| crm + loyalty | inward | add-on | `crm.html`, cap-crm, cap-crm-record; `api:routes/crm.js` | identities W `:234` (otp_contact) | bill with customer | ✓ business_json.customer | backfilled |
| labs | inward | add-on | 6 lab pages | combo: catalogue_items W `api:routes/combo-templates.js:184` | — | — | — |
| places: stock rooms | inward | add-on | not built | — | lot received | ✓ stock_movement | from switch-on |
| traceability | authority | add-on | `cap-traceability.js`; `api:routes/chits.js:4698-4937` | chit_header.summary_json.trace W `:648` / R `:4705` | chit sent with parent | ✓ (in a core blob) | backfilled |
| co-assist | outward | add-on | `cap-workforce.js`; `api:routes/actors.js` | identities, chit_status W `:1161`, state_log W `:1449` | — | — | — |
| connectors | outward | add-on | `cap-connector.js`; `api:routes/connectors.js` | identities W `:101` (last_seen), chit_status W `:183` | bill, pay | bill ✓ · pay ✗ | from switch-on |
| know your business | inward | add-on | `know-your-business.html`; `api:routes/kyb.js` | none | — | — | — |
| storefront | outward | add-on | `shop.html`; `api:routes/catalogue.js` | identities W `:551`, chit_header W `:1171`, chit_detail W `:1177`, chit_status W `:1180` | — | — | — |
| orders, delivery, documents | outward | add-on | `authority-forms.html` (documents); rest later | — | — | — | — |
| *also in code, not in the brief:* register (RAIDA), adopt, intake, assist, keys/integrations, network-offers | — | **Athi to place** | `cap-register.js`, `cap-adopt.js`, `cap-intake.js`, `cap-legend.js`, `cap-admin.js` | register: chit_line_raida (own); adopt: chit_header R `api:routes/adopt.js:88`; keys: identities W `api:routes/keys.js:58`, `:111`; network-offers: identities W `api:lib/network-offers.js:39`, `:49` | | | |

The lib → core-table scan stopped part way (at `lib/instruments.js`); write sites above are complete, reads in later lib files may be missing.

**The core event log.** There is one append log, `state_log` (`api:migrations/000_baseline.sql:737-748`), with ~30 insert sites (created, delivered, assigned, amended, voided, dispute_raised, message_sent, …). There is no `chit_events`, `events` or `audit_log` table. Listeners: the SSE bell, process-local (`api:lib/events.js`, subscribe `:40`, emit `:91`); its header names an `emitNotify` that does not exist (`:17`). Other "listeners" are in-process calls after commit in `routes/chits.js` (meter `:1533`, stock `:1561`, books `:1587`, `:3339`, `:4127`). Pollers: `api:lib/books-nightly.js:138`, `api:lib/crm-followups.js:214`. **There is no subscriber registry; the core calls capabilities today, they do not listen.**

**Smallest set of facts the core must keep regardless** (so any capability can switch on later and backfill): chit created / sent / settled / voided (✓ state_log), the lines with qty and item (✓ chit_line), **paid** with method and amount (✗ — see 5.4), customer on a bill (✓ business_json.customer), parent chit (✓ summary_json.trace). Only "paid" is missing.

**Q4. Cost audit.**

*Capability data as columns on core tables:*

| Core table | Capability columns | Evidence |
|---|---|---|
| identities (~78 columns) | dispute: `dispute_handler_actor_id` · auto-assign: `delegate_actor_id`, `last_assigned_at` · connector: `connector_type`, `connector_config`, `site`, `last_seen`, `provision_key_hash` · money: `can_see_costs` · place (geography): `lat`, `lng`, `service_km`, `city` · fulfilment: `dispatch_days`, `ship_within_days`, `ship_beyond_days` · storefront: `storefront_access`, `catalogue_visibility`, `entity_visibility` · messaging: `message_type_mode`, `self_copy_pref` · plan: `capabilities`, `plan`, `params_override`, `governed_by`, `constitution_version` · workforce: `max_tasks`, `current_task_count` | `api:migration_dispute_routing.sql:7`; `api:migration_b40_auto_assign.sql:11-12`; `api:migrations/migration_b57_connector_actor.sql:9`; `api:migrations/b62_connector_config.sql:6-9`; `api:migrations/b145_line_cost.sql:76`; `api:migrations/b119_entity_place.sql:24-32`; `api:migrations/b120_fulfilment_days.sql:27-29`; `api:migrations/b77_storefront_access.sql:5`; `api:migrations/b114_catalogue_visibility.sql:20`; `api:migrations/b234_entity_visibility.sql:43`; `api:migration_fp01.sql:20`; `api:migrations/migration_b55_connector_blueprint_and_capabilities.sql:19`; `api:migrations/000_baseline.sql:615-618` |
| chit_status | cancel request/confirm (5), `folder_id`, `retire_at`, `retired_at`, `customer_priority(_locked)` | `api:migrations/b195_cancel_requested.sql:38-40`; `api:migrations/b197_cancel_confirmed.sql:33-34`; `api:migrations/b63_folders.sql:18`; `api:migrations/b105_retention_prep.sql:19-20`; `api:migration_fp01.sql:8-9` |
| chit_header | direction / role / schema only | — |
| chit_line, catalogue_items | **none** — capabilities already use side tables (`chit_line_cost`, `_delivery`, `_raida`, `_assignment`) | — |

*Capability data in jsonb on core rows:* `chit_header.summary_json.trace / .offers / .captured / .beckn`; `chit_header.business_json.till / invoice / tax_check / use / payment / books_request / customer`; `identities.policy_flags.api_keys / counters / network_offers / network_catalogue / storefront_exposure / crm`; `catalogue_items.item_data.tax_slab / offers_excluded / batch_tracked / avail / exposure / cost`. (Write sites: `api:routes/chits.js:648`, `:903`, `:3206`, `:3235`; `api:lib/tax-copy.js:202`; `api:lib/bill-use.js:140`; `api:routes/keys.js:111`; `api:routes/counters.js:43`.)

*Core reads that join capability tables:*

| Core read | What it joins | Evidence |
|---|---|---|
| Inbox and Sent lists | 6 correlated subqueries per row: 2× `chit_disputes`, 2× `chit_messages`, 2× `state_log` (+ identities) — 300 for a page of 50, paid whether or not disputes are used | `api:routes/chits.js:2032-2045`, `:1759` |
| Open a chit | `chit_line_amendment`, `chit_line_assignment`, `chit_line_delivery` (LEFT JOIN), `cb_attachment`, `chit_participants` | `api:routes/chits.js:2151` on |
| `/me` (the hottest route) | network public count (LIKE), governance resolve, constitution (memo 1 min), visibility-cap | `api:routes/entities.js:637` on |
| Product list | no stock join (good) | stock joins only in `api:lib/stock-store.js:303`, `api:routes/till.js:2036` |

*For a shop that uses none of them* (estimated, not measured): ~30 extra identities columns, about half NOT NULL with defaults that store bytes on every row; ~10 on chit_status; per inbox row ~6 subqueries; per chit open ~4–5 side reads; per `/me` ~3 extra queries; per send 3 after-commit hooks (meter insert, stock post, books `isOn` cached). Whether `chit_disputes` and `chit_messages` are indexed on `chit_id`: not verified. The largest single cost is the inbox subqueries, not the columns.

**Q5. Where the one door check goes.**
- **API:** inside `middleware/auth.js` beside the hat gate (`api:middleware/auth.js:130-143`), not an `app.use('/api')` in server.js — that runs before per-route `auth` and sees no identity (`:115-120`). Fold in the two existing doors: books `on` (`api:routes/books.js:68`) and `requireConnector` (`api:routes/connectors.js:55`). Mounts are at `api:server.js:271-356`.
- **Web:** `ensureCap` (`web:public/app.html:4814`) with `CAP_OF` `:4744`, `CAP_GATED` `:4746`, `hasCap` `:4812`, menu gate `:5234`; for utility pages, the shell's manifest `state`.
- **Session:** not in the JWT; `/me` carries `capabilities`. Keep it there (one read at sign-in), not in the token (a token cannot be revoked when a trial ends).

**Q6. Showing an OFF capability with sample data.** `DEMO-FIDELITY.md` exists only in a staging copy (`C:\dev\_cr_stage\chitbridge-api\docs\DEMO-FIDELITY.md`, 56 lines) and is stale: it describes a mock stage that `web:public/app.html:1717-1725` says is gone. The nearest mechanism is the population boundary (`api:migrations/b249_population_as_a_value.sql:113`) with the web `?lab=` flag (`web:public/app.html:4966-4971`). No "lab entity" code exists (grep 0). So: **yes in principle** — the Available card opens the capability's lab page on lab data, never the shop's rows (N05 pattern) — **not verified** that any capability can run on a lab population today.

### 5.2 Ordered plan (step 1 changes nothing)

1. **Registry as data, read by nothing.** Add the Part 5 fields to the manifest (2.4) for every row in 5.1; a docs-guard check that every `cap-*.js`, utility page and server mount appears once. No customer sees a change.
2. **Report.** `GET /api/entities/entitlements` lists per-capability state from `policy_flags.capabilities[key] = {state, since, until?}` (+ FIELDS entry), still `enforced:false`. The Ledger switch reports as `accounts: on|off` — an instance, not a second path (N21).
3. **Door helper, log only.** `capability.check(req, key)` in `middleware/auth.js` logs `CAP_WOULD_REFUSE` to the request log (M03) and lets the call through. Read the log for a week.
4. **Keep the one missing core fact.** Write "paid" to `state_log` correctly (5.4), so connectors and accounts can backfill pay.
5. **Stop the core reads paying for capabilities.** Inbox/Sent: move the dispute and message counts behind the capability (or one aggregate join), not 6 subqueries per row.
6. **Listeners, not calls.** Replace the three after-commit calls in `routes/chits.js` (`:1533`, `:1561`, `:1587`) with one `events.emit` that capabilities subscribe to (the bell's `lib/events.js` is the seam). Same behaviour.
7. **New capability tables only.** Places, feature_use, and anything new go to their own tables or `policy_flags` sections. Existing identities columns stay (moving them is a migration with no user benefit) — listed here so nothing is added beside them.
8. **Enforce, flagged** (NEXT). The door refuses for `off` behind a flag, one capability at a time, starting with one that has a real switch (accounts). Never before step 3's log is clean (`api:lib/visibility-cap.js:85-99`).

### 5.3 Decisions for Athi

- **Move the level column** (5.1). Start: core = till · catalogue · trade-ready · disputes · network. Open: is **employees** core (every shop has an owner and a phone, and IAM lives there)? Is **stock** included or add-on? Where do register (RAIDA), adopt, intake, assist, keys, network-offers sit?
- **Promise per capability:** "from switch-on" or "backfilled" (5.1 last column is a draft).
- **Part 1 Q6:** is trade-ready display-only by design, or a gate on connecting?
- **Part 3:** a lot over two shelves = one lot with two balance rows (recommended) or two lots?
- **Part 4:** one word for trade — `identities.vertical` or the profile sector — before the "starts with it on" table.
- **Faces** = inward / outward / authority (FIT Q12) — kept.

### 5.4 Found while reading (not part of the brief; nothing changed; none run)

| Finding | Evidence | Size |
|---|---|---|
| Payment's `state_log` insert names columns the table does not have (`from_status, to_status, note`) and omits `action` (NOT NULL); the error is swallowed, so pay is recorded only in `business_json.payment` | `api:routes/chits.js:3209` vs `api:migrations/000_baseline.sql:737-748` | small |
| `/me` reuses the main row for an owner's `capabilities`, but that SELECT deliberately leaves `capabilities` out, so an owner probably gets `[]` (connectors / disputes nav hidden for owners). Not run | `api:routes/entities.js:677-680`, `:698-703`, `:807-810` | small |
| `export.csv` and `workbook.xlsx` return `cost` to any signed-in co-assist | `api:routes/products.js:718`, `:778`; `api:lib/sheet.js:47-53`, `:89-96` | small (one strip call) |
| Public `GET /api/integrations/stock/:handle` ignores the shop's visibility and per-item exposure | `api:routes/integrations.js:461-466` | small |
| `MODULES.md` drifted (26 listed, 31 files) | `web:public/app/MODULES.md:18` | small |
| `stock-store.js` says "no route posts a movement yet"; routes do | `api:lib/stock-store.js:22-23` vs `api:routes/chits.js:1546-1561` | none (comment) |
| `DEMO-FIDELITY.md` describes a mock stage that no longer exists | staging copy only; `web:public/app.html:1717-1725` | none (doc) |
