# Custodian audit — settings + capabilities (CU1, 2026-10-13)

Owner, 13 Oct: *"can we specialise and see no slippage of functionality or redundant functionality anywhere?"*
Read with the repo tools, three repos side by side: `node tools/graph/graph.cjs build && … gaps`, `e2e/dup-functions.cjs`,
`e2e/missing-functions.cjs`, `e2e/ep-aliases.cjs`, plus two scans this round wrote and ran once (not committed — they are
greps, recorded here so the next round can repeat them):
- **dead** — every top-level `function NAME(` in web `public/` (vendored engine copies and till.html excluded) whose NAME
  occurs exactly once (its own declaration) across web + api, every file kind incl. e2e/tests/tools/docs. Same for api
  routes/lib/middleware/governance.
- **same body** — top-level functions whose body, with comments and whitespace stripped and parameters renamed, is identical
  in two different files (dup-functions only compares names).

Counts: **6 settings duplicates · 6 declared-not-enforced flags (+5 values that never reach the server) · 29 same-body
function groups (2 folded this round) + 17 policy_flags write sites + 12 endpoint aliases · 22 dead functions removed.**
Critique: docs/critique/CU1.md.

## 1 · Settings scatter

Layer: P platform · J jurisdiction · E entity (the shop) · W work-pattern · U the person · D this device.
Class (govKlass): bound · chosen · entity · advisory · inherited/frozen · — (none declared).

| key | where stored | layer | class | who writes | who reads | FIELDS | finding |
|---|---|---|---|---|---|---|---|
| the 30 policy flags (type · options · def) | api `lib/policy.js` FLAGS **and** web `cap-admin.js` POLICY_FLAGS | E | per flag | owner · `PATCH /entities/policy` (cap-admin `setPolFlag`) | `lib/policy.get` + each reader below | 4 of 30 (books, crm, system_folders, overdue_days) | **DUPLICATE declaration** — the web restates type/options/def; held together only by api tests/policy-defaults.test.js |
| `self_copy_pref` | `identities.self_copy_pref` (proxied by FLAGS.column) | E | entity | policy PATCH | routes/chits.js · lib/books-store.js | no | enforced (was the ignored flag) — KEEP |
| `trade_cover` | policy_flags | E | entity | Settings | web app.html (chit Summary) only | no | enforced client-side (presentation) — KEEP |
| `chit_expiry_days` | policy_flags | W | chosen | Settings (cap-admin) | **nobody** | no | **DECLARED-NOT-ENFORCED** — a live control that does nothing. Enforcing would expire chits for any shop that set it → listed |
| `match_tolerance_pct` | policy_flags | E | — | PATCH only, no screen | **nobody** | no | **DECLARED-NOT-ENFORCED** (says so itself, lib/policy.js) — list |
| `datatypes` · `pricing_models` · `price_origins` · `offer_kinds` | policy_flags | E | chosen | catsetup | web pickers only (cap-catsetup.js) | no | **NOT ENFORCED by the server** — the picker narrows, the write accepts anything (4 flags) |
| `connectors_in_use` | policy_flags | E | advisory | Settings › Integrations | web cap-admin `intInUse` (order of cards) | no | advisory by design — KEEP |
| `crm.high_value_pct` · `.high_value_min_bills` | policy_flags.crm | E | — | **nobody** (FIELDS: "settings route is Phase 5") | lib/crm.js `shopRule` | yes | read with no writer — every shop runs the default |
| `gst_registration` | policy_flags | J/E | entity | **three**: policy PATCH · lib/profile.js (profile import, reg_type) · lib/country-setup.js (set once) | tax-lines · tax · till · public-facts | no | **DUPLICATE editors** — one meaning written from three doors; country setup should own it, the others read |
| `ui_prefs.theme · fs · motion · stripes` | `identities.ui_prefs` + localStorage `cb_theme cb_fs cb_motion cb_stripes` | U | — | `PATCH /me/prefs/ui` (avatar.js via CBPrefs; till.html's avatar menu writes the same keys) | avatar.js `hydrate` | no | **savePrefSet REPLACES the column** (routes/entities.js) … |
| `ui_prefs.product_rows` | `identities.ui_prefs` | E (in a U column) | — | `PATCH /entities/profile` MERGE (app.html `prodRowsSave`) | app.html `prodRowsPref` | no | … **so changing the theme erases the product-rows choice.** Two writers, two semantics, one column; and a business choice parked in the appearance slot |
| `cb_font` · `cb_weight` | localStorage only | D | — | avatar.js `set` | avatar.js `apply` | no | **never reaches the server** (avatar.js:35 says so) — PREF_SETS.ui keys lack them |
| locale `lang langs region locale nu hc ca fw` | `identities.locale_prefs` + `cb_*` | U | — | `PATCH /me/prefs/locale` (CBLocale.push) · legacy `PATCH /me/locale` (kept for cached clients) | CBLocale.hydrate | no | two doors, deliberately (routes/entities.js comment) — KEEP, retire the legacy door later |
| `tz` · `workdays` | localStorage `cb_tz`, `cb_workdays` | U | — | CBLocale (`KEYS` includes them, push sends them) | CBLocale; cap-admin.js:4176/4209 reads `cb_locale`/`cb_tz` from localStorage directly | no | **sent, silently dropped** — PREF_SETS.locale keys omit `tz`, `workdays`; and a per-page read beside CBLocale |
| `timezone` | `identities.timezone` | E | — | profile | /me | no | **same meaning stored twice**: the shop's timezone (column) vs the person's (`cb_tz`, device only) — no rule says which a bill uses |
| `storefront_exposure` · `api_keys` · `counters` · `devices` · `profile_provenance` · `network_offers` · `network_catalogue` · `detail_design`\* | policy_flags sections outside FLAGS | E | — | own routes (exposure, keys, counters, person-session, profile, network-*) | their own libs | devices, counters only | valid sub-stores with their own validated doors — KEEP; each needs a FIELDS entry. (\*detail_design is in FLAGS) |
| `network_members` | policy_flags | E | — | nobody now | nobody ("retired", lib/network-membership.js) | no | stale data left in rows — list for a cleanup migration |
| `entity_governance` (constitution · fy · tax · sources · mark) | table | P/J | bound / frozen | lib/country-setup.js (once) | lib/govresolve.js (the one reader, by design) | no | the right shape — KEEP; FIELDS entry missing |
| `cb_gal_theme` | localStorage | D | — | screen-gallery.html | screen-gallery.html | — | a lab's own theme store beside `cb_theme` — low; lab only |
| view state: `cb_dact`, `cb.colw`, `cb_*Lw`, `cb_*_filter`, `cb_acc_navfold`, `cb_voice` … | localStorage | D | — | the screen | the screen | — | device view state, not settings — KEEP local |

**Settings duplicates (6):** flag declaration ×2 · ui_prefs two writers · gst_registration three editors · timezone shop vs person ·
locale two doors (deliberate) · lab theme store. **Declared-not-enforced (6):** chit_expiry_days · match_tolerance_pct · datatypes ·
pricing_models · price_origins · offer_kinds. **Never reach the server (5):** tz · workdays · font · weight · crm rule (no writer).
**SET1 note:** settings.html is not on main yet (SET1 is an open branch) — every row above is still edited inside app.html.

## 2 · Capability redundancy

| what | where ↔ where | class | keeper + the move |
|---|---|---|---|
| file icon / file size | app.html `attGlyph` · `fmtSize` ↔ attach-ui.js `cbAttachIcon` · `cbAttachSize` | **FIXED** | attach-ui.js (already loaded by app.html) |
| short date-time stamp | rail-advice.js `when` ↔ rail-thread.js `when` ↔ chit-sheet.js `when` | CONSOLIDATE | `CBLocale.datetime` (engines locale). Output gains a comma → visible, needs a walk |
| `fmtDateTime` | app.html tests `CBLocale.dateTime` (capital T — does not exist) | CONSOLIDATE | `CBLocale.datetime`; callers that `.split(' ')[0]` move to `CBLocale.date`. Today every caller prints the OS locale |
| `inr_` | helpers.js `inr_` (always INR) ↔ app.html `inr` (the shop's currency) | CONSOLIDATE | `inr`; `inr_`'s 2 callers (cap-chit2 `c2Money`, app.html `fmtLine`) show ₹ to a non-INR shop |
| `esc` ×21, `fill` ×2 | avatar, cart, kural, list-ctl, rail-*, shell, sides, signin-ui, step-flow, roadmap, network-app, cap-employees, cap-tasks, cap-cmdb, cap-definitions, attach-ui, standards, shop, network-shop … | KEEP for now | IIFE modules load standalone; one `CBDom.esc` would be a new shared file — needs the owner's yes |
| page shell trio | accounts.html ↔ crm.html ↔ finance.html: `railFit`, `session`, `openChitPage` | CONSOLIDATE | app/accounts-shell.js (all three load it) |
| standalone page api/session | authority-forms ↔ intake ↔ know-your-business `api`, `paintPill`; cmdb/record ↔ standards ↔ testing `session`; employees ↔ tasks `heard`, `give` | CONSOLIDATE | one small page-boot helper; or move the pages onto accounts-shell |
| test lab twins | cap-testing.js `testAgo`, `testShortKey`, `testEsc` ↔ testing.html `ago`, `shortKey`, `esc` | CONSOLIDATE | cap-testing.js; testing.html loads it (helpers.js `timeAgo` is the generic one) |
| back button ×3 | cap-books `bkBack` ↔ cap-categories `cbcatBack` ↔ cap-catsetup `catsetBack` | CONSOLIDATE | one `capBack` in helpers.js |
| open a chit from a row | cap-messages `rplOpenChit` ↔ cap-worklist `wlOpen` | CONSOLIDATE | `openChit` (Task's own, CLAUDE.md rule 5) |
| localStorage get | kural · one-person · shell `lsGet`; app.html `apGet` ↔ locale.js `get` | KEEP | 2-line guards inside IIFEs |
| misc twins | cart `doc` ↔ step-flow `doc`; cap-finance-terms `ftText` ↔ cap-register `rgVal`; cap-entry `enE` ↔ chit-sheet `E`; app.html ↔ shop.html `cbHasPrice`; embed ↔ shop `swatch` | CONSOLIDATE (low) | the older file's copy |
| money rounding in engine copies | offers.js · pricing.js · tax.js · variant.js `roundMoney_`; tax-slab ↔ tax `taxPacks_` | ENGINES (queued) | `CBMoney.round` — adopted copies, changed only in chitbridge-engines |
| engines dead | engines `src/gst-returns.js` `rupees_` (api adopted copy lib/gst-returns.js:99) | ENGINES (queued) | remove in engines, re-adopt |
| policy_flags writes | 17 `UPDATE identities SET policy_flags` in keys.js ×4, till.js ×2, entities.js, policy.js, profile.js ×3, network-offers ×2, network-catalogue ×3, person-session | CONSOLIDATE | `mergeFlag` exists in lib/network-offers.js → move to lib/policy.js as the one section writer |
| endpoint aliases (12, on baseline) | e.g. `wlAssign`/`c2AssignLines`, `wlDeliver`/`c2DeliverLines`, `chit`/`wlChit`, `actors`/`wlActors`, `misMsgs`/`msgInbox`, `shopStatus`/`saveProfile`, `testCaseAdd`/`testCaseWrite`, `catEnrich`/`aiDraft`, `register`/`ownerLogin`, `advance`/`status`, `assign`/`unassign` | CONSOLIDATE | the older name; drop the baseline line as each goes |
| dead functions (20) | attach-ui `cbAttachClearStage` `cbAttachStagedChips`; cap-chit2 `c2PickBadge`; cap-dispute `disputeBadge`; cap-testing `testResetCols` `testHov` `testReqPri` `testTechFold` `testHandCases`; list-ctl `persistRepaint`; table-resize `tblResetWidths` `tblHasWidths`; app.html `screenCodeHTML` `supStandingHTML` `dactPicked`; combo-lab `addCount` `delCount`; shop `priceSym`; testing `setMod` `jumpTo` | **REMOVED** | zero references in either repo; no dynamic dispatch builds them |

### Routes no screen calls (graph: 169, 148 untested) — an upper bound
The graph cannot see till.html's path helper or the storefront's path builders: 23 of 34 spot-checked "uncalled" paths are
literal in web. By file:

| group | class | why |
|---|---|---|
| till.js 22 · quick-keys.js 9 · counters.js 2 | KEEP | the counter (till.html, vendored) calls them |
| catalogue.js 17 (`/api/network/:bridge_id/…`) | KEEP | the storefront pages; literals present |
| signin.js 5 · work.js 3 · facts 1 (all tested) | KEEP | signin-ui / fact cards; graph miss |
| capture webhooks · ctp (.well-known, query, deliver) · integrations heartbeat/kit/books/profile · connectors erp-ingest · openapi ×2 | KEEP | called by providers, other nodes and the connector kit — never by a screen |
| entities `PATCH /me/locale` | KEEP → DEAD later | legacy door for cached clients (documented) |
| tax/compute · tax/rate · pricing/price · invoice/build · offers evaluate/explain/kinds · pricing/kinds | VERIFY | engine-as-a-service; owner decides KEEP (public API) or DEAD |
| testing.js changes/releases/vocabulary/cmdb seed+ci · events/stats · schemas/* · folders/rules/vocabulary · books loans/contra/check · governance ai-skills/ai-usage/vault-schema/track-record/conformance/reattest · relationships scorecard · chits costs/diagnosis/use/children/trace | VERIFY → DEAD | no path literal found in web; confirm with api tools/endpoint-usage.cjs before removal |

### Tables no route touches (graph: 34)
| tables | class | why |
|---|---|---|
| `too` · `ops` · `metrics` | not tables | scanner reads words in SQL comments / a schema name |
| idempotency_key · recurring_entry · retention_config · catalogue_item_schedule · chit_line_raida · membership_kind · dispute_participants · blueprints | KEEP | used by middleware / nightly / lib code the graph cannot reach |
| the 17 `cb_*` baseline tables (cb_building … cb_transaction_history, cb_chit, cb_task) | DEAD | "the OTHER schema (the cb_* prototype)" (lib/assign.js:272); no code reads them. Drop by migration after a row count |
| b296_todo · blueprint_source · blueprint_template · chit_amendment · test_result_month | VERIFY | migration-local or superseded (b138 line amendment) — check rows, then drop |

## 3 · Consolidation plan — in rounds, safest first

| round | area | size | what |
|---|---|---|---|
| CU2 | settings | S | **ui_prefs data loss**: `savePrefSet` merges, replacing only its own keys (`(col - keys) \|\| $1`); `product_rows` moves to a policy flag; FIELDS entries for ui_prefs + locale_prefs. api test |
| CU3 | settings | S | **values that never reach the server**: PREF_SETS.locale gains `tz`, `workdays`; ui gains `font`, `weight`; cap-admin reads CBLocale, not localStorage |
| CU4 | capabilities | S | **one date-time stamp**: rail `when` ×3 and `fmtDateTime` → `CBLocale.datetime`/`date`; `inr_` → `inr`. Walk the rail, chit sheet, product history in light/dark |
| CU5 | capabilities | S | **graph sight**: scan till.html's path helper and the storefront builders; skip SQL comments → a true dead-route/table list |
| CU6 | settings | M | **one flag declaration**: `GET /entities/policy` returns the FLAGS schema; cap-admin keeps label/help only (land after SET1 moves the rows to settings.html) |
| CU7 | settings | S | **declared-not-enforced**: chit_expiry_days + match_tolerance_pct hidden (default off, invisible) until enforced; the 4 catalogue sets checked on product write (owner's yes — it refuses writes today accepted); a writer for the crm rule in settings.html |
| CU8 | settings | M | **one policy_flags writer**: `mergeFlag` → lib/policy.js; the 17 write sites call it; gst_registration owned by country setup, others read |
| CU9 | capabilities | M | **dead routes + tables** from CU5's list; `cb_*` drop migration (owner runs) |
| CU10 | capabilities | S | **12 endpoint aliases** → one name each; ep-aliases baseline to 0 |
| CU11 | capabilities | M | **page shells**: accounts/crm/finance trio → accounts-shell.js; standalone page boot; test-lab twins; `capBack` |
| engines (queued) | engines | S | `roundMoney_` ×4 → CBMoney.round; `taxPacks_` ×2; gst-returns `rupees_` dead |
