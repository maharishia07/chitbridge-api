# FIELDS: response keys the API adds (dictionary)

A new key needs its entry here, in the same change. This file is being built; entries start from 2026-10-02.

> **Per ITEM, not per route:** the field ledger. `data/cmdb/CAP-FIELDS-PRODUCT*.json` (CMDB, open `/cmdb/record.html#CAP-FIELDS-PRODUCT-1` on the web app) lists every field of a PRODUCT with its meaning, origin, one source, who sets it, what checks it, where it is shown, what reads it, its test and its status. A new product column or form input without a row fails `tests/field-ledger.test.cjs`. Human table: `C:/dev/toolset/fields/FIELDS-product.md`. This file stays the dictionary of response keys.

> **The shop's flags and the person's prefs (W1-SET · FLD2, 2026-10-15):** every key of `lib/policy.js` FLAGS (`policy_flags.<key>`) and of `routes/entities.js` PREF_SETS (`ui_prefs.<key>` · `locale_prefs.<key>`) must have a row in this file, spelled with its store (`policy_flags.trade_side`, never the bare word). `lib/field-ledger.undocumentedSettings` reads both sources and this file; `tests/field-ledger.test.cjs` fails by name when a 33rd flag arrives without its row.

## The chit reads · `cost_hidden` (RAIL-146, 2026-10-29)

| Route | Key | Meaning |
|---|---|---|
| `GET /api/chits/:chit_id` (top level) · `GET /api/chits/inbox` · `/sent` · `/folder` (each `chits[]` row) · `GET /api/chits/rollup` (each `groups[]` row) | `cost_hidden` | boolean · present and `true` ONLY when the server WITHHELD MONEY from this answer for a co-assist without `can_see_costs` (lib/cost-view); absent otherwise — absent on a sales chit even when a cost-named key was dropped from it (that is not the chit's money). The client branches on it (prints "hidden", never ₹0 or NaN), never on a sentence. What is taken on EVERY chit for such a reader: every cost-named key at any depth (`cost`, `cost_*`, `unit_cost`, `landed*`, `purchase_cost`, `last_cost` — lib/cost COST_KEYS; `cost_hidden` itself is exempt). What is taken, with the marker, unless the chit is POSITIVELY the reader's sale (a bill it issued, a payment received, a return or despatch it issued, income, an order or any chit it SENT to a party on its customer list only — never a sender-declared side, which can only hide more): a line keeps lib/cost-view LINE_KEEP only (name · quantity · unit · unit_size · gst_rate · cess_rate · tax names · hsn · sku · codes · ids · item_data without money) — so price, total, unit_price, line_total, mrp, rate, amount, taxable, discount, cgst/sgst/igst/cess all go; the header's `summary_json` and `business_json` and the detail lose every money key at any depth (lib/cost-view isMoneyKey: the money words and the `_minor` · `_amount` · `_total` · `_price` · `_value` · `_paid` · `_due` · `_tax` suffixes — the frozen invoice, their bill's total and tax, the payment amounts, the receipt's costs/goods/extras; their bill's number and the order link stay); the deliveries keep only the actor's own `added[].amount` (deliverline `added[].by_id`), and `charged` only when it is exactly his own sum. A service, inquiry, resale or general chit, a chit with no sender, an order to a party on no list: all hidden (unknown fails closed). A rollup group that holds more than 200 members answers `total_value: null` with `cost_hidden:true` — no plausible wrong number. The stored copy, its sealed body and the digest are never changed: the strip is on a copy of the answer. |
| `GET /api/chits/inbox` · `/sent` · `/folder` (top level) | `cost_params_ignored` | array of the query names a co-assist without `can_see_costs` asked for and the server did not honour — `amount_min`, `amount_max`, `sort` (when `sort=amount`): a filter or an order over a hidden total would let a reader search for it (lib/cost-view moneyParams). Present only when one was asked; the rest of the query is honoured as usual. |
| `GET /api/work/list` (each `rows[]`) · `GET /api/work/:chit_id` (top level) · `GET /api/work/facts?unbilled=1` (`figures.unbilled`) | `cost_hidden` | boolean · present and `true` ONLY when the server WITHHELD MONEY from this work answer for a co-assist without `can_see_costs` (RAIL-146b; the SAME side rule as the chit reads, lib/cost-view `costSideOf`: only a row that is POSITIVELY the reader's sale stays priced — an order from a party on its customer list only; a supplier's order, an order it SENT to a supplier, an unlisted party, a failed side read: hidden). A hidden row loses `total_minor` and every line's `price_minor` (the key is absent, never 0 or null) and, because the row is pruned by the work allowlist (lib/cost-view `WORK_ROW_KEEP`), typed prose too (`remark`, `address`, an assignment `note`); its quantities, stage, assignees and `actions` stay. `figures.unbilled` of a blind reader keeps `n` and answers `minor: null` unless EVERY order in it is a sale. Absent on a sale and for the owner. The client prints "hidden", never ₹0 or NaN. |
| `GET /api/till/tasks` (each `tasks[]`) · `GET /api/till/match` (each `orders[]`) | `cost_hidden` | boolean · present and `true` ONLY when the server WITHHELD MONEY from this till row for a co-assist without `can_see_costs` (RAIL-146c; the SAME side rule, lib/cost-view `costSideOf`: only an order that is POSITIVELY the reader's sale stays priced; a supplier's order, an order it SENT to a supplier, an unlisted party, a failed side read: hidden). A hidden task loses every line's `rate` and the online order's typed `address` / `remark`; a hidden match order loses every line `rate`, `ordered_total`, `received_total`, `invoiced_total`, `invoiced_from`, `money_gap`, each receipt's `landed` and the door's typed `reason` (the old `hideLanded` is folded in). Its quantities, `verdict` (the engine's word, no figure) and receipt numbers stay. The owner, a cost-allowed actor and the paired till KEY read the answer as before. Absent on a sale. The client prints "hidden", never ₹0 or NaN. |
| `GET /api/till/tasks` · `GET /api/till/match` (top level) | `cost_params_ignored` | array of the query names a co-assist without `can_see_costs` sent that the server took off (`amount_min`, `amount_max`, `sort` when it names money, in any encoding — lib/cost-view `moneyParams`); absent for everyone else and when nothing was sent. |
| `GET /api/facts/rail/chits` (each `items[]`) · `GET /api/notifications` (each `notifications[]`) · `GET /api/folders/groupsum` (top level) · `GET /api/invoice/:chit_id` · `GET /api/tax/invoice/:chit_id` (top level) | `cost_hidden` | boolean · present and `true` ONLY when the server WITHHELD MONEY from this answer for an actor without `can_see_costs` (RAIL-146g; the SAME side rule and prune as the chit reads, lib/cost-view `costSideOf` / `hideRowCosts`; a viewer login is cost-blind exactly when the flag is off, the level does not decide). What goes: an item's `value`; a bell row's `total_value` and `detail`; a group sum's price per line and the chits' money in `money` (the sum then counts the reader's own sales only); the tax invoice's `invoice` and `heads`. Absent on the reader's own sale and for the owner or a cost-allowed actor. |
| `GET /api/chits/rollup` · `groups[].total_value` | — | may be `null` for a co-assist without `can_see_costs` when the group held more members than lib/cost-view could judge (ROLLUP_MEMBER_CAP, 200); text otherwise, as SUM(numeric) arrives. |

## GET /api/network-offers · `store.networks[].may` · `brand.members[].may` · `brand_bridge_id` · `root_bridge_id` (NET-SRV1, carried over by NET-32, 2026-10-18)

Derived per read, never stored. Written by: nobody (answer only). Read by: the Network app (web public/app/network-app.js). Contract: docs/contracts/web-api.json `GET /api/network-offers` (captured by tests/support/contract-network.cjs over tests/support/network-world.cjs).

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `store.networks[].may` · `brand.members[].may` | `{ request, approve, decline, suspend, resume, disconnect }`, each `{ ok: boolean, code: string or null, why: string or null }` | Derived by `lib/network-membership.mayOn(row, node)` from the ONE rule table (`src/services/network.mayAct`: the sentence POST /api/network/connections/:id/* would refuse with) and the edge's state. `code` and `why` are null when `ok`; `code` is the word a screen branches on (BAD_STATE, NOT_ALLOWED...). A screen greys a refused action WITH the sentence. |
| `store.networks[].brand_bridge_id` | string or null | `identities.bridge_id` of the brand, read in `standing()`'s one statement. null when the brand has no node on the tree yet. |
| `store.networks[].root_bridge_id` | string or null | `cb_entity.bridge_id` of the TOP of the brand's tree, read in the same statement: the network store's address (GET /api/catalogue/network/:bridge_id). |
| `store.networks[]` (who is listed) | n/a | Every brand the store holds a commercial edge with (requested, active or suspended, whoever asked) plus the brands whose catalogue it sells. |

## POST /api/chits/:id/payment · the press's own key (PAY-FIX · H2, 2026-10-15)

| key | type | source / derived · who writes · who reads |
|---|---|---|
| body `client_ref` → `business_json.payment.client_ref` | string ≤ 80, optional | Source: the web mints one when the Mark-paid sheet opens (app.html `chitMarkPaid`, `press-<time>-<rand>`), so a retry of the same press carries the same ref and a second press carries a new one. Written by the route into the copy's `payment` slot beside `method · ref · amount · note · at · by`. Read by `lib/books-hooks.classify`: the books' key is `chitpay:<chit_id>:<client_ref>` (without it `chitpay:<chit_id>`, one payment per chit as before), through `books.recordPayment`'s one idempotency rule. |
| body `amount` → `business_json.payment.amount` | number or text spelling one, MORE than zero, optional (none = the quoted total) | Source: typed in the Mark-paid sheet. The contract refuses 0 (`lib/chits-input.js` POSITIVE_AMOUNT, 400 CHIT_INVALID, FIN-52); the door `lib/books-hooks.chitPaid` refuses a press that comes to 0 after the quote (422 BOOKS_REFUSED) and a party on neither list (`books.partyOnList`, FIN-55) BEFORE any wait — a refused press never marks the copy. Read by `classify` into `amount_minor` through `books.recordPayment`, the one recorder (it keeps its own `> 0` gate). |
| body `acknowledge[]` (also POST /api/books/payments) | `code` (string) or `{ code, over_minor }` | Source: the owner's one Yes to the books' 409 ALREADY_PAID question (FIN-53). A bare code (the Ledger's Receive/Pay sheet, an older client) acknowledges by code; `{ code, over_minor }` (the Mark-paid popup) acknowledges the FIGURE the person saw — `books.acknowledged` re-asks when the warning's `over_minor` differs (a colleague recorded in between). The 409's `warnings[]` W1/W2 carry `over_minor` and `over_words`; the web composes no money words. |
| response `replayed` · `message` | boolean · `Payment recorded` \| `Already recorded` | Derived: `books.payment.duplicate` — the press was the replay of a recorded one (the first answer is handed back, nothing posted twice). The web toasts `message`. |
| DELETE response `books.payments[]` · `books.words` | `[{ payment_id, entry_no }]` · sentence | Derived by `books-store.paymentsOfChit` (every key of the chit, oldest first): clearing the mark never undoes the books — the sentence names every entry to reverse. `payment_id` / `entry_no` stay the first one's (as before). |

## POST /api/chits/:id/deliver-lines · the replay key (PAY-FIX · H6, 2026-10-15)

| key | type | source / derived · who writes · who reads |
|---|---|---|
| row `client_ref` → `chit_line_delivery.client_ref` (b730) | string ≤ 120, optional | Source: the counter's drain stamps `<queue row no>:<position>` on each queued goods-in / despatch / online-delivery row (`till.html stampDeliveryRefs`), stable across retries. Written by `lib/deliverline.record` into `chit_line_event`'s 12th argument; a partial unique index (entity, chit, line, client_ref) makes a replay insert nothing. Read by nothing else. Not (reference, kind): "6 then 4" under one GRN is two real deliveries. |
| response `delivered[].replayed` · `replayed` | boolean | Derived: the key was already recorded — the first result stands; the route does not announce, advance or accept again. |
| till queue row `renumber_to` (PAY-FIX · H9) | string, local only | Source: `till.html rememberRenumber` stamps the number a collided bill is moving to on the OLD queue / bill rows before the four IndexedDB writes; `renumberBill` reuses it after a reload, so a sale keeps one number. Never sent to the server; removed from the new row. |

## Housekeeping refusals · `code` · `why` · list caps `capped` · `cap_note` (W2-RAIL · R2, 2026-10-15)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| 409 / 503 of DELETE /api/chits/:id · DELETE /api/chits/:id/purge · POST /api/chits/:id/archive | `{ error, message, code, why }` — `code` = `why` ∈ `co_held_record` (409: a sent or received copy is a record both parties hold; only a Draft moves to Trash or is purged) · `dispute_open` (409) · `disputes_unknown` (503: the open-dispute count could not be read — FAIL CLOSED, logged) | Derived by `lib/rail-actions.canHousekeep` (the words in `HOUSEKEEP_WHY`, the status in `HOUSEKEEP_STATUS`); the count by `lib/dispute-may.openOn` (one statement, savepointed, on the route's transaction). `message` is the sentence a person reads; a screen branches on `code`. Read by the web's delete / archive / purge toasts (MSG.fail); the web already offers Delete for drafts only. Not rail words (the adopted engine has none for delete/archive — queued in chitbridge-engines; until then they live beside the door, as dispute-may's do). |
| 403 / 404 of POST /api/chits/:id/reprice | `{ error, message, why }` — `why` the rail's word (`read_only` · `comment_only` · `not_participant`) | The route asks `railActions.can(…, 'amend')` (a reprice WRITES amendments), preview and apply alike — the answer GET /chits/:id gives for `amend` is this door's. |
| `capped` · `cap_note` beside a list's own key (`chits` on GET /api/chits/inbox · /sent · /folder · GET /api/folders/:id/chits, and every `pageOut` list) | `capped: true` (a code) · `cap_note`: `Showing <rows> of <total>. Narrow the search, or load the next page.` or, when the total is not known on this page (keyset), `A page shows at most <max>. Load the next page for more.` | Derived by `lib/page-limit.capOf` (`pageArgs` records `max` and `capped` = `?limit=` asked for more than the route's max; `pageOut` adds the words when rows were cut — by the ask, or by a route's own ceiling while no page was asked, e.g. folders /:id/chits at 100). ABSENT when the list is whole — the envelope of every uncut list is unchanged. Read by the web pager (app.html `pgFooter`: the sentence at the end of a cut list; core.js SIBS carries both). |

## POST /api/till/reward · the points come from the SERVER'S bill · 409 `BILL_NOT_RECORDED` (W2-REW · REW-T1, 2026-10-15)

| key | type | source / derived · who writes · who reads |
|---|---|---|
| body `ref` · `holder` · `spend` · `at` | string · `{ scheme, value }` · integer points · ISO string or absent | Source: the counter (till.html finish(), after `HOST.bill` answered). `net` · `gross` · `count` · `lines` are NOT read any more: the earning is `rewards.earnedOn` over the server's own chit under `client_ref = ref` (lib/counter-bill `byRef` → `basketOf`: `summary_json.money` + `chit_detail.line_items`), inside `reward-store.settle`'s one transaction. `at` = the bill's `billed_at` as the counter stamped it: the same number at another moment is another counter's bill (the /reconcile verdict) and is refused. |
| 409 `{ code: 'BILL_NOT_RECORDED', error: 'conflict', message }` | — | The server holds no chit under this number for this shop (or holds another counter's). Nothing is written — the spend included. The shop-PC queue retries it with backoff after the bill lands (drain); the web counter had the bill answered before it asked. The till master's `tillPost` refusal now carries `code` beside `why`. |
| `added` (response) | integer points | Derived: the server's own bill's earning. The counter's `rwEarns()` is only what it TELLS the customer before paying (and prints when the post is queued offline); the slip prints the server's `added` when the answer is in hand. |
| `GET /api/till/bills` `bills[].total` (unchanged value) | number | Now picked by lib/counter-bill `paidOf(summary_json)` — `money.total` else `money.net` else `total_value` — the same figure the reward earns from. |

## POST /api/books/gst/close · /gst/pay country-first · GET /api/books/returns `notes` · books_pack `manifest.retention` (W2-BOOKS, 2026-10-15)

| Field | Values | Source / derived · who writes · who reads |
|---|---|---|
| `period` (gst/close · gst/pay body and answer) | IN: the month 1–12 beside `fy` (unchanged) · a pack with a return: the RETURN period id exactly as GET /returns names it (`'2026-Q1'` · `'2026-02/2026-04'`), with `frequency` / `stagger` as that route takes them | Derived · the pack decides (lib/books-period `closeSpan`: no `returns` on the pack → a month; else gst-returns.periodsFor). Read by web cap-period.js `peGstClose` / `peGstPay`. |
| `form` · `heads` · `return_period` · `ref_label` · `ref_hint` · `carried_word` (gst/close answer, only for a pack with a return) | `'BAS'`/`'VAT201'` · the pack's tax heads (`['gst']`, `['vat']`) · `{ period, label, start, end, due }` · the pack's words for the payment reference (engines v1.48.0 `messages.paymentRef`) · the pack's name for carried credit (`presentation.taxNetting[0].creditName`) | Derived · lib/books-period `closeAnswer`. Read by web cap-period.js `peGstSetOff` / `peGstPayForm` (heads and labels come from here, never typed). India's answer is unchanged (no new keys). |
| `payable_minor` · `carried_minor` · `rcm_minor` · `cash_minor` (gst/close) | per head as before: `{ <head>_minor }` for payable/carried, `{ <head> }` for rcm/cash — the heads are the pack's | Unchanged shape; the keys follow `taxHeads` (IN cgst/sgst/igst/cess · AU gst · AE vat). |
| `payment_ref` (gst/pay body + answer) · `challan_no` | the authority's reference (≤ 40 chars). Body: either key; answer: `payment_ref` always, `challan_no` beside it for India only | Source · typed by the owner. lib/books-period `gstPay` (the entry's `ref`; `source_ref` gstpay:<ref> makes a replay the same entry). |
| `code` on a 422 of gst/close | `PERIOD_NOT_ENDED` · `RCM_NETTING_NOT_BUILT` (AE: reverse charge owed and recoverable > due — the engine cannot post the form's netting yet) · `NOT_FOR_COUNTRY` (a pack with neither a month close nor a return) | Derived · routes/books.js `fail` now carries any refusal's own code. The web greys / says the sentence by the code. |
| `refusals[].code` · `refusals[].periods` (GET /year/:fy/status · the 422 of POST /year/:fy/close) and the 422's own `code` | `return_open` carries `code: 'PERIOD_RETURN_OPEN'` and `periods: [label…]` — the tax periods of the year with no close yet, labelled as the pack names them (`'2026-27 Q1 (Jul–Sep 2026)'`); the 422 answers that code (else `YEAR_CLOSE_REFUSED`). Only a pack whose return the ledgers close (BAS · VAT201) for a shop that charges its tax; India unchanged | Derived · ACC-204 (Athi 30 Oct 2026) · lib/books-period `returnStateFor` reads the closes' own records (journal `source_ref gstclose:<key>`, or the months the close locked, by the reason's prefix) over the pack's period table; lib/books `yearState` adds the refusal. Read by web cap-period.js year view (`peYearFix` opens Tax close on the code). AE with no FTA stagger stored: the table cannot be built, no refusal (`needs: 'stagger'`). |
| `return` on a GET /periods row | `{ form, period, label, closed }` — the tax period the month ends in (`'BAS'`, `'2026-Q1'`, the pack's label) and whether its close has run; absent on the opening row and for a pack with no ledger return (India) or a shop that charges no tax | Derived · lib/books `periodAdvice` from `books-period.returnStatesFor`. The month lock stays allowed (DECISIONS 30 Oct Q2); the web month-lock list says "<form> <label> not closed yet" from it (cap-books.js). |
| `notes[]` (GET /api/books/returns) | + one sentence when the period holds its own set-off / tax payment entries, which the boxes leave out | Derived · lib/books-period `movementsBetween` subtracts the lines of `tax_setoff` / `tax_payment` entries (and the pack's aliases) — one trip, books-store `taxEntryLines`. |
| `manifest.retention` (books_pack; inside the sealed manifest) · `books_pack.delete_after` | `{ years, from, delete_after, cite, floor_years, why }` — `years` the PACK's `retentionYears` (IN 8 · AU 5 · AE 5, engines v1.48.0), `from` the year end (an exit pack: today), `floor_years` the platform's records floor (policy.RECORDS_FLOOR_YEARS); a pack with no number: `years`/`delete_after` null and `why` says so | Derived · lib/books-pack `retentionOf` (was a typed 8). Written once at build; read by GET /packs/:id (manifest) and the sweep policy. Nothing deletes on it today. |

## The platform door · GET /api/testing/cmdb paged (W1-SET · GOV2, 2026-10-15)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| 403 of POST /api/governance/source · POST /api/governance/entities · POST /api/governance/entities/:id/reattest · PATCH /api/entities/:id/erase | `{ error, code: 'NOT_PLATFORM', may: false, why: 'NOT_PLATFORM', message }` | `lib/platformroot.refuseUnlessPlatform` — the platform role = a platform-scoped login (`identity.owner_scope === 'platform'`, the token claim) OR the root entity (`isRoot`, a co-assist of the root included). Answered BEFORE any read. Was three inline `owner_scope` tests plus an open source door. Read by nothing in the web today (the runbook calls /source); a screen branches on `code`. |
| GET /api/testing/cmdb `total` · `page` · `limit` · `count` (new, top-level) | integers | Derived by routes/testing.js `readPage` (one statement carries the page and its `count(*) OVER ()`); `?page=` · `?limit=` (clamped by lib/page-limit, default and max `PAGE.cmdb` = 500). `records[]` is unchanged — web public/cmdb/record.html reads it. `count` = rows in this answer. |

## The shop's policy flags · `identities.policy_flags.<key>` (W1-SET · FLD2, 2026-10-15)

Every row: **layer E** (the entity's own settings, layer 7 of the GOV cascade) unless said; **class** = govKlass — `entity` (set freely by the shop) · `chosen` (tighten-only: the shop may only narrow what the layer above allows) · `bound` (platform, shown locked). ONE writer: `lib/policy.set` behind `PATCH /api/entities/policy` (any editor of the shop; a flag marked `may: 'owner'` refuses a co-assist with `OWNER_ONLY` — `refusalFor`). ONE reader: `lib/policy.get` / `flagOf` (the row's jsonb merged over `defaults()`). Shown and edited in CB Settings › Business rules (`cap-admin.js` paints `schema[key].ui`, the card rows defined on the flag — T2-POLICY). Absent = the default stated here. `bound` `dispute_scope` is not a flag (`BOUND`, never written).

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `policy_flags.showcase_template` | one of the registered `showcase.<vertical>.<template>@1.0` rows of data/pages.json; default the first | Source · class `entity`. Set in Settings › Showcase (web cap-showcase.js). Read by lib/catalogue-view (`shop.showcase`, the public shop page's template) and web showcase-templates.js. |
| `policy_flags.showcase_sections` | set ⊆ strip · facts · find · gallery · menu · specs · services · found (≤ 8); default `[]` = the template's own | Source · `entity`. Same writer. Read by lib/catalogue-view:567 (which sections the public page draws). An empty list is refused (the template's own stand). |
| `policy_flags.trade_side` | `sell` · `receive`; default `sell` | Source · `entity`. Business rules card. Read by lib/capture.js (an inbound message is priced from the catalogue only on the SELL side) and web cap-intake.js / cap-legend.js. |
| `policy_flags.trade_cover` | `off` · `on`; default `off` | Source · `entity`. Business rules card. Read by the web chit Summary only (clearances + FRM frame shown when on); no api reader. |
| `policy_flags.books_at` | `received` · `accepted` · `completed` · `manual`; default `accepted` | Source · `entity`. Business rules card. Read by routes/integrations.js (when a connector may book an order as a voucher; the reconciliation's "released at") and routes/till.js:882 (the counter's health panel). |
| `policy_flags.gst_registration` | `regular` · `composition` · `unregistered` · `sez`; default `regular` | Source · `entity` (the country pack decides whether the question is asked — IN only). Business rules card. Read by lib/tax.js · lib/tax-lines.js (what an invoice may charge, before any rate) · lib/profile.js · lib/public-facts.js · lib/country-setup.js · routes/till.js; the vendored till (tax-engine.browser) carries the same rule. **The ONE tax-not-applicable decision (SET-20):** `unregistered` and `composition` charge nothing, `sez` zero-rates; there is no second "tax off" switch and none may be added. Which engine rules apply and the slip wording belong to cb-country. |
| `policy_flags.detail_design` | `chit` · `lines`; default `chit` | Source · `entity`. Business rules card. Read by routes/chits.js:1469 and lib/mint.js — STAMPED on a chit at creation (`business_json.design`); changing it decides the NEXT chit, never an existing one. |
| `policy_flags.self_copy_pref` | `both` · `sent` · `received`; default `received` | Source · `entity`. PROXIED: the value lives in the column `identities.self_copy_pref` (read first, this default second — policy.js `column`). Written by the Business rules card (policy.set writes the column). Read by routes/chits.js (which copies a self-chit files into), lib/books-store.js, web cap-settings.js / cap-workforce.js / cap-legend.js. |
| `policy_flags.qty_zero_hides` | `off` · `on`; default `off` | Source · `entity`. Set on Settings › Policy (lib/policy.js CARD, 2026-10-16). Read by lib/availability.js:93 and lib/catalogue-view.js (a counted ZERO hides the line from the storefront when on — hides, never stamps) and routes/till.js:882. An absent count is unknown, not zero. |
| `policy_flags.price_includes_tax` | `yes` · `no`; default `yes` | Source · `entity`. Set on Settings › Policy (lib/policy.js CARD, 2026-10-16). Read by `flagOf` in lib/tax-copy.js · lib/services.js · lib/catalogue-view.js (`shop.price_includes_tax`) · routes/chits.js:1105; the till shows it on its health panel. ONE calculation downstream: tax-lines.invoiceFor splits the tax out of (or adds it on to) the shelf price. |
| `policy_flags.tol_weight_bp` | integer basis points 0–2000; default 50 (0.50 %) | Source · `entity`. Business rules card (`scale: 100`: the card shows a percentage, stores the integer). Read by routes/till.js GET /match (a short delivery of WEIGHED goods within it is absorbed; beyond it is named). |
| `policy_flags.tol_count_units` | integer whole units 0–100; default 0 | Source · `entity`. Same card and reader, for COUNTED goods. |
| `policy_flags.tol_rate_bp` | integer basis points 0–2000; default 0 | Source · `entity`. Same card and reader: how far a billed RATE may differ from the order. Keep 0 unless meant. |
| `policy_flags.chit_expiry_days` | integer days 0–3650; default 0 = no expiry | Source · layer **work-pattern**, class `chosen`. Business rules card. DECLARED, not enforced: no route reads it today (said here rather than implied). |
| `policy_flags.retention_days` | integer days 0–3650; default 0 = keep | Source · `chosen`. Business rules card. Read by routes/chits.js (the retention a SENDER asks of a copy) and lib/workpattern.js. The receiver's own floor is the next row. |
| `policy_flags.retention_floor_days` | integer days 0–3650; default 90 (b105's schema default) | Source · `chosen` (it only ever RAISES: `MAX(requested, floor)`). Read by routes/chits.js:1357 `retainDaysFor` at the mint and lib/retention.js `planRetirement`; under it the statutory records floor `RECORDS_FLOOR_DAYS` (9 years) that no flag can lower (CO3). |
| `policy_flags.units` | set ⊆ the 16 platform units (kg … bunch), ≤ 40; default = all | Source · `entity`. Settings › Catalogue setup (web cap-catsetup.js). Read by lib/defaults.js:85 and every unit picker downstream (the entity's slice of `CBCatalogue.UNITS`). Narrows what is OFFERED, never what is stored; an empty set is refused. |
| `policy_flags.unit_rules` | `{ <unit>: { decimals, tol, min_qty } }` over the same 16 units; default `{}` | Source · `entity`. Settings › Catalogue setup. Read by lib/catalogue-view.js:561 (the storefront / cart: may a unit be halved, and the flat rounding band). A count unit never accepts a fraction regardless. Not `tol_weight_bp` (that one is a delivery percentage). |
| `policy_flags.languages` | set ⊆ 27 ISO 639-1 codes; default `['en']` | Source · `entity`. Settings › Catalogue setup. Read by the web pickers only (which languages a product's text is offered in); lib/units.js normUnit folds EVERY language regardless. |
| `policy_flags.datatypes` | set ⊆ the field datatypes registry (text … composite), ≤ 40; default = all | Source · `entity`. Settings › Catalogue setup. Read by the web catalogue model / definitions (cap-catsetup.js · cap-definitions.js · catalogue-model.js: which datatypes a schema field may take). No api reader. |
| `policy_flags.pricing_models` | set ⊆ fixed · range · tiered · market-ref · negotiated; default = all | Source · `entity`. Same writer. Read by web cap-catsetup.js (the pricing picker's slice). No api reader. |
| `policy_flags.price_origins` | set ⊆ url · publisher · exchange · system · contract · manual; default = all | Source · `entity`. Same writer and reader. |
| `policy_flags.offer_kinds` | set ⊆ percent_off · amount_off · tier_price · threshold · buy_x_get_y · shipping · price_range; default = all | Source · `entity`. Same writer and reader (which offer kinds the Offer lab offers). |
| `policy_flags.facets` | set ⊆ identity · variants · units · standards · media · bom · pricing · loop · feedback; default = all | Source · `entity`. Same writer. Read by lib/catalogue-build.js and routes/catalogue-face.js (which facets of a product the catalogue builds and shows) and the web catalogue model. |
| `policy_flags.overdue_days` | integer 1–365; default 7 | Source · `entity`. Set on Settings › Policy (lib/policy.js CARD, 2026-10-16). Read by routes/folders.js (folder metrics), routes/relationships.js:704 (the counterparty scorecard), routes/crm.js:91 and lib/home-facts.js — how old an OPEN chit is before it counts as late; one number, never a constant in a report. |
| `policy_flags.came_back_days` | integer 1–90; default 14 | Source · `entity`. Set on Settings › Policy (lib/policy.js CARD, 22 Oct 2026). Read by lib/marketing-results.js (GET /api/marketing/came-back): a customer sent an offer "came back" when a bill naming them is filed within this many days after the send. One number, never a constant in the report. |
| `channel_outbound.party_id` · `purpose` · `send_ref` · `basis` (b776) | uuid · 'service'|'marketing' · text · `{ code, pref_id, at }` | Source · derived (MKT first slice, 22 Oct 2026): `party_id` = the identity the message went to (crm-groups.send passes it; NULL for a chit notice); `purpose` = what the one consent gate was asked; `send_ref` = one id per group send, shared by its sent AND refused rows; `basis` = the gate's code + the preference row it relied on (MKT-17, the consent proof per send). Written only by lib/whatsapp-out (_log · logRefused); read by lib/channels.listOutbound (Offers sent) and lib/marketing-results (Who came back). NULL = written before b776; the code checks the columns (42703) until it runs. |
| `policy_flags.match_tolerance_pct` | integer 0–50; default 2 | Source · `entity`. DECLARED, NOT ENFORCED: the three-way-match engine does not exist; nothing reads it (said in policy.js). |
| `policy_flags.connectors_in_use` | set ⊆ none · tally · zoho · csv · gofrugal, ≤ 12; default `[]`; `['none']` = unticked all | Source · `entity`. Settings › Integrations (web cap-settings.js · cap-admin.js show these first). Connects nothing; no api reader. |
| `policy_flags.stream_owner` | `{ products · stock · profile · order · purchase · receipt · party : kit_id }`; default `{}` | Source · `entity`. Written by routes/integrations.js on a connector's heartbeat (the first kit carrying a stream claims it) and by Settings › Integrations (a hand-over). Read by routes/integrations.js and lib/availability.js:57 (which kit's stock feed is THE record). |
| `policy_flags.books_overdue_hours` | integer hours 1–720; default 12 | Source · `entity`. Business rules card. Read by routes/integrations.js:439 (reconciliation: an order released by `books_at` and unbooked past this is overdue). |
| `policy_flags.quick_key_reset_at` | `business_day` · `shift_close`; default `business_day` | Source · `entity`. Business rules card. Read by lib/quick-keys.js (when a counter's sold-out marks clear). `shift_close` behaves as `business_day` until shifts exist — said on the card. |
| `policy_flags.system_folders` | `{ '<B-code>': 'on' \| 'off' \| { on, msg } }` over lib/folder-inventory's switchable codes; default `{}` = the inventory's default | Source · `entity`, **owner only** (`may: 'owner'` → OWNER_ONLY). Written by routes/folders.js PUT /inventory/:code. Read by lib/folder-inventory.js, lib/folder-views.js, lib/crm.js:31 (which system folders this shop shows; `msg` = the folder's messaging level, never above the inventory's ceiling). |

## CB CRM · `may` on the reads · follow-ups and calls on the one pager · `shop_day` · PATCH `after` (W2-CRM · M1 Party record, 2026-10-15)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| GET /api/crm/parties · GET /api/crm/parties/:id · GET /api/crm/followups `may` (new, top-level) | `{ write: { may, code: null\|'read_only'\|'comment_only', why }, remove: { ok, code: null\|'OWNER_ONLY', why } }` | Derived per request by routes/crm.js `crmMay`: `write` = `lib/access.mayWrite` (the owner or an editor; else the rail's sentence — the SAME answer middleware/hat-gate refuses every CRM write with, 403) · `remove` = `lib/owner.may` with the sentence DELETE /api/crm/parties/:id refuses with. Written by nobody. Read by web cap-crm.js `crmEdit` / `crmViewWhy` / `crmMayRemove`: every CRM action is shown, a refused one greyed WITH `why`; the browser no longer decides from the token's hat (cap-crm.js keeps the hat only as the guess before the first answer lands). |
| GET /api/crm/calls `may.write` (new, inside the existing `may`) | `{ may, code, why }` as above | The same `mayWrite`; `may.ok` / `may.why` stay what they were (may a stage move be written — b297). Read by web cap-crm-calls.js (the outcome buttons for a viewer). |
| GET /api/crm/followups `total` · `page` · `limit` (new, top-level) · GET /api/crm/calls `total` · `page` · `limit` (new) | integers | The one pager (lib/page-limit `pageArgs` / `pageOut`; default 300 · max 1000, routes/crm.js PAGE_DEFAULT · PAGE_MAX). No `?page=`/`?limit=` = every row, as before. The count rides the ONE statement as `count(*) OVER ()` (lib/crm-followups `readRows`, lib/crm-calls `queue`); a page past the end re-asks one row (`page-limit.totalOf`). `late` · `today` beside them now count the WHOLE set (window counts), not the page. Was: follow-ups cut at 2000 and the queue at 300, silently. Read by web cap-crm.js `crmFuLoad` / cap-crm-calls.js `crmCallsLoad` through `CBList.every` (pages until `total`). |
| GET /api/crm/followups `shop_day` · GET /api/crm/calls `shop_day` (new) | `'YYYY-MM-DD'` | Derived: `lib/crm-followups.todayOf` — the shop's calendar day (its zone, else its country, else UTC; never a national default). Read by web cap-crm.js (the add sheet's Today · Tomorrow · Next week presets fill the date from THIS day, not the phone's). |
| PATCH /api/crm/followups/:id body `after` (new) | `'today'` · `'tomorrow'` · `'3days'` · `'week'` | A snooze by WORD: `lib/crm-followups.AFTER` (the ONE table of "when?" words; lib/crm-calls OUTCOMES.presets lists which of them an outcome offers) → `afterDay` → the start of that shop day (`dueOf`). A foreign word → 400 `BAD_AFTER`. Written by web cap-crm.js Snooze · Tomorrow / Next week (was an ISO instant from the phone's clock at 09:00). |

## Every list GET · `total` · `page` · `limit` — the one pager (LIM2 · W1-PLAT, 2026-10-15)

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `total` · `page` · `limit` beside the list's own key (`actors` · `tasks` · `events` · `catalogues` · `handoffs` · `data` · `templates` · `requests` · `connections` · `receipts` · `connectors` · `definitions` · `folders` · `chits` · `rules` · `messages` · `documents` · `stock` · `people` · `suppliers` · `results` · `customers` · `bills` · `orders` · `products` · `batches` · `records` · `changes` · `releases` · `notifications` (page · limit) · `items` (page) · `entries` on the CRM timeline) | — | derived (`lib/page-limit.pageArgs` + `pageOut`, DISCIPLINES §2). **Not asked** (`?page=` and `?limit=` absent) = every row, as before — `total` = the rows, `page` 1, `limit` = `total`. **Asked** = the page: `limit` clamped to the file's server max (50 default · 200 max unless the route says otherwise), `page` ≥ 1, `total` = the whole. Every old key (`count`, `ok`, `migrated`…) stays. A not-migrated answer carries `total: 0, page: 1, limit: 0`. `tests/list-paging-guard.test.cjs` holds the unpaged count at 0; a non-list read is allowed there with its reason. | nobody | the web pager (PG / CBList remote / lazyWrap) |

## middleware/idempotency · `code` on a refusal · `X-Idempotency: unverified` (LIM2 · W1-PLAT, 2026-10-15)

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `code` on an Idempotency-Key refusal: 422 `IDEMPOTENCY_CONFLICT` (the key was used with another body) · 409 `IDEMPOTENCY_IN_PROGRESS` (the first request is still running) | — | derived (middleware/idempotency `answerExisting`); the sentence is only printed, the code is what an outbox branches on | nobody | the till's outbox, lib/autoraise callers |
| Header `X-Idempotency: unverified` (with `X-Idempotent-Replay: true` on a replay) | — | derived: the durable store (idempotency_key, b109) was OFF for this request — missing, erroring, or the body could not be fingerprinted — and the key was held in this process's memory instead (bounded 5 000, the same window). A retry is replayed or refused here, not proven across instances. Every such request also writes a `warn` line with the request id and the why. | nobody | the outbox (keep the record until a verified answer), the request log |

## lib/stock-from-chit `postFor` → `skipped[].code` · log `stock.from-chit` `refused[]` (STK-FIX1b, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `skipped[].code` (new) | `batch_unreadable` · `expiry_unreadable` · `no_cost` · `not_stock_use` · `not_stock_asset` | Derived per line by `movementsFor` (the sentence stays in `why`; a caller branches on `code`, never on the words). Written by: `stock-from-chit.lotOf` (the two unreadable codes) · the use / cost checks. Read by: `routes/chits.js` sendStock's log (`refused[]` = the two unreadable codes with `line_ref · item_id · code · why`). The postFor result is not a route answer today — the chit route posts stock after it has replied, so a refusal is in the log, not on the counter (the standing trade stated in stock-from-chit.js). |
| `stock_movement.lot` · `stock_balance.lot` (unchanged slot, corrected value) | the batch CODE, `lotfields.lotKey`-normalised (trimmed, upper-cased, ≤ 64); `''` for untracked stock | Written only by `stock-store.post` from `movementsFor`'s `lot`, a string from `gs1.lotOf` (door shape `item_data.lot.{batch,expiry}` · serial · bare code · typed GS1 `(10)…(17)…` · flat `item_data.batch/expiry`). Never an object. `expires_at` = the line's ISO expiry (or best-before), captured once (b215). Migrations b598 (report) · b599 (repair) for rows the old reader keyed `[OBJECT OBJECT]`. |

## GET /health `audit_lost` · GET /api/till/snapshot `limit` · the shared-board write refusal (SEC-SMALL, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| GET /health `audit_lost` | integer ≥ 0 | Derived: `lib/access-events.lostCount()` — IAM audit rows this process could not write since boot (each one is also a lib/logger ERROR line with the event kind and the database code, never a person's id). The action that caused it still succeeded. Written by nobody; read by a reviewer (the Standards page: not yet). Resets on restart — the log line is the durable record. |
| GET /api/till/snapshot `limit` | integer (DELTA_CAP, default 20000) | Source: `routes/till.js` DELTA_CAP. With `total` (sellable items right now), `more` (this answer stopped at `limit`) and `at` (the cursor: the LAST row carried when cut, else readAt) it is the snapshot's pager — a full read and a delta page by the one rule (deltaPage). Read by the till master `snapParts` (reads while `more`, then compares with `total`). |
| GET /api/till/snapshot `customers[].balance_minor` · `open_bills` (changed) | absent when the shop's open receivable dues exceed `limit` | Derived: absent already meant "unknown" (no ledger, or not read); now also "more dues than one answer carries" — never a short sum. The warn line `till.snapshot.dues.cut` names the shop. |
| 403 of POST /api/testing/cases/close · /cases/import · /cases/seed · /cases/gherkin · PUT /cmdb/:ci · POST /cmdb/seed | `{ error, code: 'NOT_BOARD_WRITER', message }` | `routes/testing.js boardRefused` → `lib/testboard.canWrite`: the board's own entity · TEST_BOARD_WRITERS · the platform root (lib/platformroot). Results, incidents, requirements, evidence, changes and releases are not gated. SEC-122: GET cases · cases/gherkin · results · runs · coverage · report · reliability · stale · engine · cmdb · cmdb/:ci ask the same door (`boardReadGate`) and answer 403 `NOT_BOARD_READER`; GET incidents · requirements · changes · releases · trace · vocabulary stay open. Read by the web test board (it shows `message`). |

## /api/actors · /api/people · `pin_state` · `email` · the owner refusal (SEC2, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| GET /api/actors `actors[].pin_state` | `none` · `pending` · `set` | Derived in the list SELECT: `set` = a PIN hash is stored; `pending` = a first code is stored and not expired; else `none`. REPLACES `otp_code` · `otp_expires_at` · `pin_set_at` in that answer (a colleague could read every pending code). Written by nobody. Read by web app.html mapApiActor → cap-workforce.js (the invite chip and the Login card). |
| GET /api/people `people[].email` | string or null | `identities.email` — the OWNER's answer only; null for anyone else. Written by POST /api/actors (the Add form) and PATCH /api/actors/:id `{ email }` (lowercased; empty clears it). Read by web cap-employees.js (the E-mail panel). |
| GET /api/people `people[].has_email` | boolean | Derived (`identities.email` is set). Read by the same screen; lib/people.js already used it for the reset-code refusal. |
| GET /api/people `people[].may.email` | `{ ok, why }` | lib/people.js — open for the owner, the owner-only sentence for anyone else (the same rule as the other four). |
| 403 of every people write | `{ error, code: 'OWNER_ONLY', may: false, why, message }` | lib/owner.js ownerOnly — POST / · PATCH /:id · DELETE /:id/pin · POST /:id/otp · PUT /:id/status · PUT /settings · PUT /:id/delegate · PUT /:id/tasks/route (and signin.js's owner routes). `why` = `message`. Read by web CBAction (shows `message`). |
| 409 of POST / · PATCH /:id | `{ error, code: 'EMAIL_TAKEN', message }` | identities_email_key (one e-mail per sign-in across the platform) — the owner's own address on a staff row is the usual case. |
| write answers `otp` · `login_instruction` (changed) | `otp` only through dev-otp.mayExposeOtp | lib/employee-code.deliver: no longer "whenever not sealed". `login_instruction` never carries a code. `delivery_note` for `none` now says to add an e-mail and send a new code. |

## People: sign-out, Remove, Away, the Home card (PEOPLE-SRV1, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `policy_flags.api_keys[].by` | identity_id | source. Written by routes/keys.js `mint` when a CO-ASSIST opens the key (a counter, a kit); absent for the owner's keys and for pairings. Read by `endKeysBy` (switch-off/remove). Keys minted before 2026-10-14 have none and are not ended. |
| PUT /api/actors/:id/status `signed_out` | `{ sessions, keys_closed, keys_revoked }` (numbers) | Derived — deactivate/remove: sessions the person opened that were unlisted (lib/person-session `closeBy`), counter keys closed (`till.closed_at` + `released`, as Release), other keys revoked (with the screens they paired). No reader yet (web cap-employees.js will say the switched-off sentence from it — a later WX round). |
| PUT /api/actors/:id/status `audit` · PUT /api/actors/break `audit` | `{ recorded, failed }` (numbers) — the PATCH /:id shape | Derived (second dispatch, compliance) — the `access_events` `break_changed` row the act wrote (lib/access-events via routes/actors `recordBreak`: before-state · after · changed_by · reason `deactivate`/`remove`/`reactivate`/`owner: <break_type>`/`own: <break_type>`), after the act's COMMIT. `failed` 1 = the act stood, the trail has a gap (logged). Read by GET /api/actors/access-events. |
| 400 of PUT /:id/status | `code: 'CONFIRM_REMOVE'` · `'TASKS_TO_ROUTE'` | remove without `confirm:'REMOVE'` · open jobs and no `task_action`. |
| PUT /api/actors/break `actor_id` (request) | uuid, optional | the OWNER names the person (G6); absent or the caller's own id = their own break. 403 OWNER_ONLY · 404 NOT_FOUND · 400 SWITCHED_OFF · NAME_THE_PERSON · COVER_CONFLICT · TASKS_TO_ROUTE. Answer adds `actor_id`, `state` (`away` · `on`). |
| GET /api/people `people[].may.away` | `{ ok, why, to: 'away'\|'on'\|null }` | lib/people.js — open for the owner unless switched off. `to` = what the button does. |
| GET /api/people `people[].may.remove` | `{ ok, why }` | lib/people.js — open for the owner (switched off too). |
| GET /api/people `people[].away` · `counts.away` | `'short_break'\|'leave'\|null` · number | Derived from `identities.break_status`; `counts.away` is inside `counts.on`. |
| GET /api/facts/people `figures` | `{ total, at_work, away, off }` | Derived — one grouped count over lib/people.peopleSql (the people GET /api/people lists), words by lib/people.stateOf. Read by web shell.js (the CB Employees Home card). |
| GET /api/facts/till `figures.sales` · `figures.takings` | major-unit decimals in `figures.currency` (REP-52, 2026-10-29) | Derived — lib/home-facts.booksDay over books-store.entryLines (the Day book's one read) for the shop's day: `sales` = net Dr − Cr on cash · upi · card · bank · debtors of the walk-in day, sale_bill, credit_given and return entries (bill value incl. tax, net of returns, paid or on credit — G-MONEY's "sold"); `takings` = the tender roles only (what came in across the counter), present only when the books hold the day (the summary fallback gives `sales` = gross − refunds and no `takings`). Lines "Sold {money} · n bills" and "Takings {money}". Read by web shell.js (the Till Home card) and toolset/lifecycle/09-books.cjs S9-9a. |

## POST /api/connectors/ingest · /erp-ingest · GET /api/events/stats — device keys in their shop and switch (SEC3, 2026-10-14)

Derived per call, never stored. Written by `routes/connectors.js` (deviceActor · deviceMayAddress · the ingest catch) and `lib/platformroot.refuseUnlessRoot`. Read by: the generated Pi agent (web `public/app/cap-connector.js` `_agentJs` — it branches on the HTTP status, logs the code) and `scripts/connector-gateway-sim.js`.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `code` on a refusal (new) | `NO_KEY` · `KEY_UNKNOWN` (401) · `CAPABILITY_OFF` · `DEVICE_TO_REFUSED` (403) · `CHIT_NOT_DELIVERED` (503) · a knownerr code (e.g. `POPULATION_BOUNDARY` 409) | Derived. Anything but 2xx = the device keeps the event and retries. `message` is the sentence a person reads; nothing branches on it. |
| `money_why` on a 200 ingest (new) | `{ code: 'NO_MONEY', why }` or null | Derived: set only when the shop states no money and its country has no pack (`country-setup.shopMoney` → null); `why` = `MONEY_UNSTATED`. The signal chit's `summary_json.currency_code` is then null (was always `INR`). |
| `GET /api/events/stats` refusal `code` (new) | `NOT_PLATFORM_ROOT` (403) · `NO_PLATFORM_ROOT` (404) | Derived from `PLATFORM_ROOT_ENTITY`. The same door now answers the entities.js operator routes (same codes added there). |

## GET /api/catalogue/:bridge_id `sign_in` · POST /chits/:id/deliver-lines `why` · GET /api/catalogue/enquiry · event `enquiry` (SEC4, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `sign_in` | `{ code: 'sign_in_first', say }` — present ONLY when the answer is cut to the card; the body is then `{ shop, sign_in }` and nothing else | Derived per read by routes/catalogue.js `signInFirst` from `identities.storefront_access = 'login'` when the reader is not this shop's customer, its owner/staff or a signed-in business. Same cut on the CTP pull (`want:'catalogue'`). Read by web shop.html `shopLoad` (sign-in gate) and embed.html — they branch on `code`, never `say`. |
| `shop` (card form) | `{ bridge_id, display_name, logo_url, address, is_verified, business_status, storefront_access, country }` | The same keys as the full `shop`, minus payment id, units, tax word and currency. |
| `why` (deliver-lines 403/404) | a rail WHY word: `read_only` · `comment_only` · `not_participant` | lib/rail-actions `canDeliver` (rail.byLevel + "I hold a copy"); `message` = the rail's sentence. |
| `enquiries[]` · `total` · `page` · `limit` | `{ item_id, item_name, about_mine, messages, askers, last_text, last_from_name, last_from_me, last_at }`, latest first; `?side=in\|out`; `migrated:false` before b161 | Derived per read from MY `chit_messages` copies (subject_type product, external), one row per product, plus `catalogue_items` name. Read by: the enquiry list screen (next round). |
| event `{ kind: 'enquiry', id: item_id, who }` | SSE `cb` event | Emitted by POST /api/catalogue/enquiry/:item_id to the product's OWNER (external, not my own item). Read by the bell (rail-bell.js / core.js re-read on any `cb`). |

## POST /api/tax/compute · GET /api/facts/tax-lab (TAX-SRV1, 2026-10-14)

Derived per call, never stored. Written by routes/tax.js (compute) and lib/home-facts.js taxLab. Read by: API-key callers; the Tax Lab screen (coming).

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `price_includes_tax` | `{ value: bool, source: 'caller'\|'shop' }` | The caller's flag when it said one, else the shop's policy `price_includes_tax` (services.shopOf → policy.flagOf — the counter's taxIncluded). |
| `priced[]` | `{ key, unit_price, source: 'caller'\|'shelf', structure?, why? }` | `source` `caller` (price sent) or `shelf` (services.priceLine — the one price reader, the product's structure at the qty). |
| `money` | the `summary_json.money` shape (tax.moneyOf) | gross · savings · net · taxable · tax · total · `by_rate` (keyed by RATE — contract `free`) · heads · `currency_code`. Same function as the chit and the counter. |
| `currency` | ISO code \| null | The seller's pack currency (tax-lines.currencyOf) — null when no pack, never the default's INR. |
| `pack` | `{ id, version, code, why }` | regulation.status(seller country): id + version, or `NO_COUNTRY_PACK` + its sentence. |
| `code` (400/422/500) | `NO_LINES` · `BAD_QTY` · `BAD_PRICE` · `BAD_RATE` · `NO_PRICE` · `BAD_FLAG` · `NO_COUNTRY` · `ITEM_NOT_FOUND` · `TAX_FAILED` (+ knownerr's) | A caller branches on `code`; `message` is for a person; `line` names the refused line's key. |
| facts `tax-lab` → `figures.products` · `figures.no_slab` | numbers | Derived: active catalogue items, and those whose slab resolves to `none` (tax-lines.resolveItem → tax-slab.resolve). Omitted (`unavailable`) for a GST shop with no GSTIN. |

## GET /api/chits/disputes/queue (widened) · GET /api/chits/:chit_id/disputes · GET /api/assist/whoami (T3-DISPUTES-ASSIST, 2026-10-14)

All derived per read, never stored. Read by: web tasks.html › Disputes and CB Assist (app/cap-dispute.js CBDispute, app/cap-assist.js) and the chit sheet's dispute section.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| queue `rows` · `total` · `page` · `limit` | list · int · int · int | The page asked by `?status=open\|resolved\|all&side=mine\|against&q=&sort=old\|new&page=&limit=` (lib/page-limit: 50, max 200). No page/limit = every matching row (the old answer); `disputes` · `my_disputes` · `other_disputes` · `total_open` keep their meaning (`total_open` = the open count). |
| queue `counts` | `{ open, resolved }` | My dispute copies by status (RLS = my copies). The tab counts; never the page's length. |
| queue `code` | `DISPUTES_NOT_SET_UP` | Only when the chit_disputes table is missing — the screen says so in words. |
| `rows[]` / `disputes[]` `.mine` | bool | `raised_by_entity_id` = me. |
| `rows[]` / `disputes[]` `.others` | `[{ entity_id, display_name, role, dispute_status }]` | The roster minus me ("with whom") — decided by the server, not by the page. |
| `rows[]` / `disputes[]` `.actions.resolve` | `{ ok }` \| `{ ok:false, why, say }` | lib/dispute-may.resolve: the rail's `dispute` level/held verdict, then `already_resolved`, then `not_raiser` — the same verdict PUT …/resolve refuses with (its 400/403 now carry `why`). |
| chit disputes `actions.raise` | `{ ok }` \| `{ ok:false, why, say }` | lib/dispute-may.raise = rail.can(`dispute`). |
| chit disputes `raise_parties` | `[{ entity_id, display_name, role }]` | The chit's `all_recipients` (my header copy) minus me, once each — who a new dispute may name (`participant_entity_ids`). |
| GET /api/facts/disputes `lines` · `figures` | `{ open, mine, against }` | lib/home-facts `disputes`: one count of my open dispute copies (RLS). Read by Home's Disputes card (manifest `disputes`). |
| GET /api/facts/assist `lines` · `figures` | `{ answers }` | lib/home-facts `assist`: active rows of assist_qa (the platform's library). Read by Home's CB Assist card (manifest `coassist`). |
| GET /api/facts/:card `state` (every card, rail too) | `needs_you` · `in_use` · `not_started` | Derived per call, never stored. A card says `not_started` from its own figure (nothing yet used: till no day sent and no counter; counters none; reports no chit; accounts/finance ledger off or never used; product-lab/tax-lab no product; operations no stock moved; combo-lab no saved set; offer-lab no offer; assist no answer; marketing no consent row; people none; rail no party and no chit). Otherwise lib/home-facts `withState`: `needs_you` if a line has tone `dn` (the rail: stuck > 0), else `in_use`. Written by lib/home-facts.js; read by web shell.js (Home card active / not active). |
| whoami `actions.publish` | `{ ok }` \| `{ ok:false, why: 'not_helpdesk'\|'not_read', say }` | The same entity_schemas test POST /assist/publish refuses with (its 403 now carries `why: 'not_helpdesk'`). |

## GET /api/signin/sessions · `may.devices` · GET /api/facts/account · GET /api/facts/reports (T3-P4-ACCOUNT, 2026-10-14)

CB Settings › Account (Sessions · API keys · Vault) and CB Finance › Reports. A client branches on `ok` / `code` / `current`, never on `why`.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `may.devices` (GET /api/signin/sessions, new) | `{ ok, code: null\|'OWNER_ONLY', why: string\|null }` | Derived per read by `lib/owner.may` — the same test and sentence as the `lib/owner.gate` on GET /api/signin/devices and on POST /api/signin/sessions/revoke `{ device_id }` (403 `code:'OWNER_ONLY'`, the same sentence). Written by nobody. Read by web cap-settings.js `account` (the Every device list and Remove this device are greyed with it). |
| `sessions[].current` (GET /api/signin/sessions, existing) | boolean | The session this request came with. Read by cap-settings.js: "Sign out" on the current row is greyed with the page's sentence (use the menu's Sign out) — a field, not prose. |
| `lines` · `figures` (GET /api/facts/account, new card) | `{ lines:[{ text, value }], figures:{ devices, keys } }` | Derived by `lib/home-facts.account` from the till card's REGISTER_SQL widened by `policy_flags->'devices'` (one trip): devices = not revoked and holding a session whose exp is ahead (GET /devices' own test); keys = the counters card's rule. Read by the Home card of manifest entry `account`. |
| `all.overdue` · `received.overdue` · `sent.overdue` (GET /api/folders/mis, changed) · `truncated` (new) | number · boolean | Derived by `lib/home-facts.railMeasure` (lib/measure + the rail's one rule: the shop's own notes are never overdue) — the same count as Home's rail `stuck` and CB CRM › Chits › Stuck. Before, the shop's own open notes counted as overdue here. `truncated` = the 5,000-row read was cut. Read by web cap-mis.js (CB Finance › Reports) and the workshop MIS (cap-admin.js). |
| `lines` · `figures` (GET /api/facts/reports, new card) | `{ lines:[{ text, value, tone? }], figures:{ open, overdue, overdue_days } }` | Derived by `lib/home-facts.reports`: the rail card's `railScope` read (overdue_days + select.rows, one batch) through `lib/measure` — the same engine GET /api/folders/mis answers CB Finance › Reports with; the shop's own notes are left out of the measure as the rail leaves them out. Omitted (`unavailable`) when the read is truncated. Read by the Home card of manifest entry `reports`. |

## GET /api/counters · `may.manage` · GET /api/entities/policy · `may` · GET /api/facts/counters (T3-SETTINGS, 2026-10-14)

CB Settings › Counters & keys / Policy greys an action with the server's answer; the client branches on `ok` / `code`, never on `why`.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `may.manage` (GET /api/counters, new) | `{ ok, code: null\|'OWNER_ONLY', why: string\|null }` | Derived per read by `lib/owner.may` — the same test and sentence as `lib/owner.gate`, which refuses every counters write (POST · PATCH · open · release · assign) with 403 `code:'OWNER_ONLY'`. Written by nobody. Read by web cap-settings.js (Add · Open on this PC · Release · Save the name). |
| `may[flag]` (GET /api/entities/policy, new) | `{ [flag]: { ok, code: null\|'OWNER_ONLY'\|'PLATFORM_BOUND', why } }` — one per `lib/policy` FLAGS key + each BOUND key | Derived per read by `policyMay` (routes/entities.js) from lib/policy `FLAGS[k].may · may_why` (the place the PATCH refuses from, 403 `code:'OWNER_ONLY'`) and `policy.BOUND`. Read by web cap-settings.js (Policy · the connectors-in-use switch). |
| `lines` · `figures` (GET /api/facts/counters, new card) | `{ lines:[{ text, value }], figures:{ counters, counters_open, keys } }` | Derived by `lib/home-facts.counters` from the till card's REGISTER_SQL (one trip) and its open rule. `keys` counts open non-till keys. Read by web shell.js (the manifest row `counters`). |

## GET /api/governance/lanes · /readiness · /api/forms · /forms/instances/all · chit lists `?abroad=1` (TRADE-SRV1, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `origin` · `vertical` (lanes, readiness?destination; changed) | ISO-2 \| null · sector \| null | Derived per read by `readiness.laneOf`: the query's value, else the shop's STATED country (`country-setup.status` — confirmed by Country setup; the column's 'IN' default is not a statement) and the governance profile's first sector (`entity_profile.sectors`). Never 'IN' / 'paint' by default. Read by web cap-readiness.js (next round: stop sending paint/IN). |
| `asked` · `code` · `why` (lanes, readiness?destination, profile readiness/path) | `['origin'\|'sector'\|'markets']` · `ORIGIN_UNSTATED` \| `SECTOR_UNSTATED` \| null · sentence | Derived (`readiness.asks`). A screen branches on `code`, never the sentence. No origin → `lanes: []` / no clearances. |
| `lanes[].domestic` · `domestic` (readiness?destination) | bool | Derived: the lane whose `dest_key` is the origin. Replaces the `jurisdiction.domestic` flag (it said India for every shop). |
| `may` (lanes, readiness) | `{ gather, verify }` each `{ may, code, why }` | Derived per request by `lib/access.mayWrite` (owner or editor; else `read_only` / `comment_only` + the rail's sentence). The same answer refuses POST /compliance · /verify · /supplier-acceptance with 403. |
| `may` (GET /api/forms, /forms/instances/all) | `{ issue, sign, attach }` each `{ may, code, why }` | As above; refuses POST issue · sign · attach. |
| `instances[].context_ref` · `context_ref` (forms/instances/all) | chit_id \| null | Stored: `form_instance.context_ref` (b108), written by issueForm. `?context_ref=` narrows to one deal's papers (400 `FORMS_BAD_CONTEXT` if not a chit id). |
| `fields[].note` · `fields[].code` (forms resolve, field `fx_rate` only) | sentence · `FX_RATE_OF_DAY` \| `FX_RATE_MISSING` | Derived by `forms.shopOf` from FX1 `fx-rates.rateOn` (the owner's rate for the invoice's day, deal currency → books' currency); missing = fx-rates' own sentence. Frozen into `form_instance.fields` when issued. |
| form `packing-list` (registry, new) | 12 fields | `lib/forms.js` registry (config, FORMS_REGISTRY overrides). Read by GET /api/forms. |
| chit lists `?abroad=1` (inbox · sent · folder; query, not a key) | filter | `country-setup.abroadSql`: the copy's `summary_json.currency_code` ≠ the shop's, or a party in `all_recipients` with `identities.country` ≠ the shop's. Unknown is never foreign. |

## GET /api/catalogue/:bridge_id · `items[].item_data.avail` · POST /api/books/closing-stock · `from_ledger` · `code`/`items` (T1-INV, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `items[].item_data.avail` (changed) | `{ qty, source, as_of }` — unchanged shape; `source` gains `ledger`; `qty` keeps 3 decimals | Derived per read (never written back) by `availability.withLedger` from `stock-store.onHand` (stock_balance summed across batches) when `availability.sourceOf(policy)` = `ledger` — i.e. no connector owns the shop's `stock` stream (`stream_owner.stock`). Otherwise the connector's stamp as before. Absent = unknown (never moved, or below zero). Read by web cart.js stock chip (`shop-stock`), qty_zero_hides. |
| `from_ledger` | `{ value_minor, lines, movements }` | Only on `method:'automatic'`. Derived: `stock-store.asAt` (the movement log replayed to the end of the shop's day, weighted average). Written by: nobody (answer only). Read by: the closing-stock screen (not yet). |
| `code` · `items` (422) | `STOCK_LEDGER_MISSING` · `STOCK_LEDGER_EMPTY` · `STOCK_BELOW_ZERO` · `STOCK_UNCOSTED` · `STOCK_UNREADABLE`; `items` = up to 20 product names | Derived by `books-period.ledgerValue` — a screen branches on `code`, never on the sentence. |

## POST /api/governance/ai-draft (skill `line-item-draft`) · POST /api/capture/:id/raise — the quantity guard (T1-AI, 2026-10-14)

Derived, never stored by the guard. Written by `lib/line-guard.js` (calls the engines' `numerals.verifyQuantity` / `negationIn`) over an AI reading. Read by: compose "✨ Fill" (app.html `ccAiFill`) and the raise screen.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `data.quantity_check` (ai-draft, line-item-draft only) | `{ code: 'QTY_OK'\|'QTY_NEEDS_CHECK', needs_human: n, quantity_rejected[], quantity_unverified[], refused[], unclear[] }` | Derived per call by `guardLines`. A screen branches on `code` / `needs_human`, never on the sentences. |
| `line_items[].raw_phrase` (line-item-draft, new) | string | The model's pointer at the words of the description (same contract as message-to-chit, b141). |
| `line_items[].qty_rejected` · `phrase_says` · `qty_unverified` · `needs_human` (line-item-draft, new; raise as before) | string · number · true · true | Same keys the raise already wrote; `qty` is null when rejected — never corrected. |
| `line_items[].refused` (ai-draft and raise, new) | true | The line's own words refuse it ("venam", "வேணாம்"). Flagged, never dropped. |
| `line_items[].negation_unclear` (ai-draft and raise, new) | string | `illa` — "or" and "not" both; the reason sentence (display only). |

## Column · `ai_skill.model` (b433, T1-AI)

| Column | Shape | Source · who writes it · who reads it |
|---|---|---|
| `ai_skill.model` | text or NULL | Stated by the platform owner per skill (slot). NULL = env `AI_MODEL`, else `lib/ai.js DEFAULT_MODEL`. Read only by `lib/ai.js modelFor()`; recorded per call in `usage_ledger.meta.model`. |

## GET /api/entities/constitutions · `installation` · `allowed_countries` · `countries` (GOV-SPIN, 2026-10-14)

PUBLIC (pre-auth), the register panel's one read. Additive beside `constitutions`. Written by: nobody (derived) — the installation row by migration / `deploy/spin-lib.sh` (CB_SPIN_COUNTRY) / `scripts/seed-local-installations.sql` (local only). Read by: web `app/register-form.js` (the gov panel).

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `installation` | `{ key, country, name, timezone }` | `key` = INSTALLATION_KEY (else `platform-0`). `country` = `installation.country` (b382, ISO-2) through govresolve's cascade (`basics.country`: null when none is stated or the constitution's `allowed.countries` excludes it — never a default). `name` = its English name (Intl), null with no country. `timezone` = the installation's zone (govresolve `basics.timezone`) — the zone registerNew stores for a several-zone country when the device's is not one of its own. |
| `allowed_countries` | `[ISO-2]` or null | The constitution's optional `governance.allowed.countries` (tighten-only, the `allowed` envelope's new key). null = every registered country pack. |
| `countries[]` | `country-setup.countries()` rows, filtered by `allowed_countries` | `{ code, name, currency, fy_start_month, zones, locale, books, tax: { scheme, id, return }, languages }` — every value from the engines pack (`tax.scheme` · the tax-ID name `tax.idName` when engines carries it, else IN `export.taxScheme` / AU `abn` / AE `trn` · `returns.name` · `locale.langs`). `tax` and `languages` added by GOV-SPIN; the Country setup screen's `countries` (GET /api/governance/country-setup) carries the same rows. |
| `countries[].offer` (STD2, 2026-10-14) | `{ timezone, from, source }` | Derived per request: `country-setup.offered(at, ?tz)` — `timezone` = the zone the server WILL store if this country is accepted (offerOf: the device zone `?tz=` when it is the pack's, else the pack's one zone, else the installation's when it is the pack's, else null); `from` = its words (offerOf `source.timezone`); `source` = `installation` · `browser` · `chosen`, the code verify WILL record (sourceOf, the rule acceptAtSignup uses). Written by nobody. Read by web `app/register-form.js` (the Time zone row, and `country_source` in verify's payload). `?tz=` is optional and only validated (zoneOk), never stored. |
| `countries[].tax.id` (changed, STD2) | string or null | Now `profile.taxIdWordOf(pack)` — the ONE tax-ID reader (country-setup.taxIdOf deleted). Same values (GSTIN · ABN · TRN), null when a pack names none. |

## Columns · `installation.country` (b382) · `signup_context.country_source` (b383) (GOV-SPIN)

| Column | Shape | Source · who writes it · who reads it |
|---|---|---|
| `installation.country` | varchar(2) ISO-2 or NULL | Stated, never derived. Layer: installation (L1), class bound — tighten-only under the constitution's `allowed.countries`. Written by a migration, `deploy/spin-lib.sh` spin_installation (CB_SPIN_COUNTRY) or the local seed. `platform-0` stays NULL. Read by `lib/govresolve` (cascade) → `country-setup.atSignup` → registerNew (the offer) · verify (acceptAtSignup) · GET /entities/constitutions. |
| `signup_context.country_source` | `installation` · `browser` · `chosen` or NULL | The SERVER's call at verify (`country-setup.acceptAtSignup`), from the facts — the installation's own country · the device zone's country · another allowed one. Written by verify only when reg-agree was ticked. Read by support only (b264: no tenant route). The shopkeeper's words for the same fact stay in `entity_governance.setup_source.country`. |

## GET /api/books/bs

| Key | Shape | Meaning |
|---|---|---|
| `schedule_iii` | object | The balance sheet as Schedule III prints it. A regrouping of what `CBLedger.balanceSheet()` returned; no second calculation. Added beside the old flat keys (`assets`, `liabilities`, `equity`, `total_assets_minor`, `total_liab_equity_minor`, `by_line`), which are unchanged. |
| `schedule_iii.equity_and_liabilities` / `.assets` | `{ heads: [{ line, label, total_minor, ledgers: [{ code, name, amount_minor }] }], total_minor }` | One side. `heads` follow the pack's Schedule III order. `total_minor` is the sum of that side's head totals. Amounts keep their sign. |
| `ledgers[].code` | string or null | null only for the year's profit line. |
| the profit line | `{ code: null, name: "Net profit" or "Net loss", amount_minor, role: "profit_to_date" }` | Sits in the `reserves_surplus` head (the owner's funds). Named "Net loss" when negative. |
| `schedule_iii.balanced` | boolean | `assets.total_minor === equity_and_liabilities.total_minor`. |
| `schedule_iii.difference_minor` | integer | `assets.total_minor - equity_and_liabilities.total_minor`. Never hidden; 0 when balanced. |

## GET /api/books/health · `year` · `country` (WX-R2R + CX2, 2026-10-13 — one shape, INT5b)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `year` | `{ fiscal_year, from, start_month }` | Derived, never stored: the shop's financial year today, from the pack on the books setting's `fy_start_month` (`B.packOf` · accounts-packs `fiscalYearOf` / `fyRange` — the same `fyStart` the TB / P&L / BS reads default to). `fiscal_year` "2026-27" (or "2026" for a January year) · `from` "YYYY-MM-DD", its first day · `start_month` 1–12 (the setting's own month, else its country pack's `fiscalYear.startMonth`: IN 4 · AU 7 · AE 1). Written by: nobody. Read by: CB Accounts (`cap-books.js` bkYear and `accounts.html` → `BK_FY0` — the Day book's "This FY", P&L / TB / BS default range, Month lock / GST close / Packs month names), so an AU (July) or calendar-year shop is never asked as April. CX2's top-level `fy_start_month` is this `start_month` (one slot). |
| `country` | the CS1 status object `{ books, code, why, required, country: { code, name }, pack, version }` (the same shape as `GET /api/books/status` `country`), or null | Derived: the `CS.gate` answer the `on` middleware already read (cached; 0 new queries). Read by web `accounts.html` → `SESSION.country` (CX0's reader), so the page's pack words (`shopReg`) are the shop's. |

## GET /api/books/health · `waiting[].todo` · `waiting[].candidates` (FX-F10W, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `waiting[].todo` | `accept` · `add_supplier` · `record` | Source (STD1): `books_outbox.event.todo`, written by `books-hooks.park` (the queue answer's own `todo` — buyerGate → accept, receiptBill "Who is …" → add_supplier — else record) and refreshed by every retry (`outboxDone` merges it). A row parked before STD1 is read by the ONE fragment `books-store.TODO_SQL` (its parked `waiting` kind) and written once by `backfillTodo` (the retry path). Never derived from the sentence by any client. Read by: CB Accounts (bkWaitTodo · bkTodoCounts · the Waiting rows), Home's alert, the chit popup (through `books_wait`). |
| `waiting[].name` | string or null | Source (STD1): `books_outbox.event.name` — the supplier name typed on the receipt, on an `add_supplier` row only (null otherwise). Old rows: `books-store.NAME_SQL`, once. Read by: the Waiting row's Add supplier and the popup's Add supplier (prefilled). |
| `waiting[].short` | `{ theirs_minor, ours_minor, short_minor }` (integers, minor units) or null | Source (R106 / OPS-60, 2026-10-24): `books_outbox.event.short`, written by `books-hooks.park` from `receiptBill` → `shortfallOf` when their bill's total is ABOVE what was counted (lib/their-bill `apart`, gap > 0): their figure, the counted figure, the gap. null on every other row (their figure below the count waits as before with no `short`). The row's `todo` stays `accept`, so the Accept action is open; accepting posts ONE purchase_bill at the count with the gap in its narration ("Bill SG-1022 from …: ₹250 short against their ₹2,940.") and on the bill's `party_item.note`. Read by: the Waiting row ("Accept at ₹2,690 (₹250 short, noted)" is painted from these three figures, never from the sentence) and the chit popup. |
| `waiting[].candidates` | `[{ name, party_no }]`, ≤ 3; `[]` on every row that is not `add_supplier` | Source: `books_outbox.event.candidates`, written by `postChit` (park) and refreshed by every retry (`outboxDone` merges the event) from `receiptFacts` → `books-store.supplierByName` (STD1: the ONE resolver, also behind `bill-use.linkParty`) — the shop's suppliers whose name or nickname CONTAINS the typed name, case aside, a prefix first (the counter's datalist rule). Names + party_no only — never an id or an amount. Read by: the Waiting row and the bill popup ("Is this Sri Ganesh Provisions (P-00001)?"), which link through `PUT /api/chits/:id/use { party: { party_no } }`. |

## PUT /api/chits/:id/use · `party` (FX-F10W, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| body `party` | `{ party_no }` or `{ name }` | Which of MY suppliers my receipt of their bill is from. Resolved by the server in my `supplier_list` (exactly one, else 404); only on a captured receipt (`tax-copy.capturedBill`), only while it is still to accept. Writes `business_json.party.party_id` + `.name` (the slot the counter's pick fills). Answer `party: { party_id, name, party_no }`. Read by: `books-hooks.receiptFacts` on the next try. |
| `/api/facts/accounts` `figures.accept · add_supplier · record` | integers | Derived: `books-store.waitingCount` — ONE `GROUP BY todo` over every open outbox row (no cap; STD1). `figures.waiting` stays the total. The same count as /health `todo` and Books' To do. |
| /health `total` · `page` · `limit` · `todo: { accept, add_supplier, record }` | integers | Derived (STD1): `waiting[]` is a page (limit 50, least-tried first, page 1); `total` and `todo` are `books-store.waitingCount` over every open row. Read by: CB Accounts (the Waiting tab's count, the To do notices), Home's alert. |
| GET /api/chits/:id `doc` | `bill_received` · `bill_issued` · `return` · `receipt` · `expense` · null | Derived (STD1): `folder-inventory.docOf(header, me)` — the Bills folders' own classification. Read by: the chit popup (`chit-sheet.js` model: billRx / captured), never guessed there. |
| GET /api/chits/:id `books_wait` | `{ todo, name, why, candidates, short }` or null (`short` = `{ theirs_minor, ours_minor, short_minor }` of a short delivery, else null; R106) | Derived (STD1): this chit's open `books_outbox` row (`books-store.waitOfChitSql`, a scalar in the read's one statement — 0 new trips). Read by: the chit popup (the books' sentence, "Is this …?", Add supplier). |
| GET /api/chits/:id `actions.accept` on a bill | `{ ok }` or `{ ok:false, why:'books_waiting', say, todo }` | Derived (STD1): `rail-actions.forBill` — a bill I received steps on my bill_step, so only the rail's LEVEL refusal applies; then the books' wait (`books_wait.todo` other than accept) refuses with its own sentence. Read by: the chit popup greys Accept from it. |

## GET /api/crm/parties · /parties/:id (CB CRM, 2026-10-02)

Every key is a READ of what exists; nothing is stored and no money is computed here (`lib/crm.js`). Written by: nobody (derived). Read by: the CB CRM page.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `parties[]` | one row per party | Derived: `customer_list ∪ supplier_list` on the identity id. A party on both lists is ONE row (Q4, provisional). A row with `merged_into`, `hidden_at`, or from another population is never listed. Read by the CRM home. |
| `roles` | `{ customer, supplier }` booleans | Derived: a live row exists on each list. |
| `kind` | `local` · `person` · `business` | Derived (DATA.md §7): a minted handle · a shopper / end customer · else. Walk-ins are their own rows (`kind: 'walk-in'`). |
| `on_chitbridge` · `may_trade` | boolean · `{ ok }` or `{ ok: false, why }` | Derived: `lib/local-identity.verdict` over `onRailSql` and `istest.sameWorldSql` (the one rule, b249). `why`: `local` · `inactive` · `shopper` · `other_population` · `unknown`. |
| `dues` | `{ balance_minor, oldest_due, side }` or null | The Ledger's STORED figures through `party-fields.decorate`. `+` they owe you. A party on both lists NETS once (the two signed figures added, as `/api/books/dues` does); `side` is `customer` · `supplier` · `both`. null when the Ledger is off. Never recomputed. |
| `customer.segment` | `high_value` · `regular` · `new` · `inactive` | `customer-groups.SEGMENT_SQL`. `high_value` (Q3, provisional): top `pct` % (default 10) by the last 12 months of Ledger bills (`party_item`), at least `min_bills` (default 3); `segment_override` wins. |
| `tax_ids` · `legal_name` · `nickname` · `state_code` · `terms` | as `party-fields.decorate` | Read from the party fields (b274). `terms` is per role. |
| `gstin` | `{ value, source, theirs, differs }` | The shop's GSTIN (`party_tax_id`) wins; theirs (`identities.gstn`) shows only when the shop has none; `differs` flags both present and unequal. |
| `phone` | string or null | `identities.phone`, else the sign-in target `otp_contact`. |
| body `phone` · `email` (PATCH `/api/relationships/customers|suppliers/:id`) | string or null (null clears) | R14: written by `party-fields.saveContact` to `identities.otp_contact` (phone, through `local-identity.phoneOf`) and `identities.email` (lower-case), only for a party this shop minted (else 403); an e-mail another account holds is 409 in fixed words that never name the holder. Read back as `phone` above and the party `email`. An unknown key on the customer PATCH is 400 `UNKNOWN_FIELD` with `fields[]`. |
| `walk_ins[]` | `{ walk_in: true, party_id: null, phone, points, last_activity }` | A phone that holds points nobody has claimed (`reward_ledger`, net above 0). |
| `merged_from` (record) | `{ party_id, party_no }` or null | The id asked for was merged away; the survivor is returned. |
| `relationship` (record) | `{ relationship, completion }` or null | `measure.scorecard` over `select.rows` — what `/relationships/scorecard/:id` answers. null for a local party (no chits). |
| `points` (record) | `{ programme, points, worth }` or null | `reward-store.balance`, customer role only. |
| `followups` · `migrated` (record) | list · boolean | Open follow-ups for the party; `migrated: false` before b276 (the record is otherwise complete). |

### GET /api/crm/parties/:id/timeline

`{ party_id, entries[], next_before, migrated }`, newest first, `?before=<iso>&limit=` (≤ 100). Entry kinds: `chit` (stored `value` / `currency` from `summary_json`) · `message` (latest external line per chit) · `dispute` · `ledger` (stored `amount_minor` from `party_item`) · `interaction` · `followup` · `followup_done` · `change` (owner only, `books_change_log`).

## New tables and columns — migration b276 (DRAFT, Athi runs it)

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `party_interaction.*` (interaction_id · owner_entity_id · party_id · kind · direction · body · at · by_user_id · mail_id · created_at) | b276 | source | `POST /api/crm/parties/:id/interactions` | the timeline |
| `party_followup.*` (followup_id · owner_entity_id · party_id · what · due_at · assignee_user_id · done_at · done_by · source · bell_day · created_at) | b276 | source | `/api/crm/followups` CRUD; the sweep writes `bell_day` only | follow-ups, the record's Next block, the timeline, the sweep |
| `customer_list.hidden_at` · `supplier_list.hidden_at` | b276 | source | `DELETE /api/crm/parties/:id` (owner, no open dues) | the CRM list (reads through `to_jsonb`) |
| `settings.crm.high_value_pct` · `.high_value_min_bills` | — | source: `identities.policy_flags.crm` (the slot `system_folders` already uses). Read now; the settings route is Phase 5. | nobody yet | `lib/crm.js shopRule` → `customer-groups.segmentSql` |
| bell event `followup` | — | derived by the sweep | `lib/crm-followups.sweep` | the app's bell: `{ kind: 'followup', for, today, late }` over SSE |
| bell event `message` | — | derived | `POST /api/chits/:id/messages` (external only) | the app's bell: `{ kind: 'message', id: chit_id, who }` |

## CO1 privacy — migrations b306 · b307 (DRAFT, Athi runs them) and the public facts (2026-10-13)

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `party_contact_pref.*` (pref_id · owner_entity_id · party_id · channel · purpose · allowed · basis · noted_at · noted_by · withdrawn_at) | b306 | source — append-only; the newest row per (party, channel, purpose) is the answer | `POST /api/crm/parties/:id/contact-prefs` | `GET` of the same; `lib/privacy.mayMessage` |
| `party_contact_pref.notice_version` (new beside the DATA.md §5 design) | b306 | source: env `PRIVACY_NOTICE_VERSION` at the moment the row is written (NULL until the owner publishes a notice) | `lib/privacy.notePref` | the consent history (proof under DPDP s.6(10)) |
| `may[channel][purpose]` = `{ may, why, code }` on GET contact-prefs | — | derived (`lib/privacy.mayMessage`); `code` (MKT-SRV1 G0) ∈ `CONSENT` · `LEGITIMATE_USE` · `NO_CONSENT` · `CONSENT_WITHDRAWN` · `SAID_NO` · `OPTED_OUT` — what a screen branches on; `why` is only printed | nobody | the record's privacy block, `lib/privacy.gate` (every sender) |
| `contact_prefs` = `{ migrated, may }` on a party (GET /api/crm/parties?with=consent · GET /parties/:id) | — | derived (MKT-SRV1 G1 · G5): `lib/privacy.LATEST_SQL` (newest b306 row per party × channel × purpose, ONE statement in lib/crm.rows' transaction) → `contactPrefsOf` → the SAME `may` map as GET contact-prefs. `migrated: false` before b306 (service may · offers NO_CONSENT) | nobody | CB CRM (list filter "may get offers", the record) |
| `unbilled` = `{ n, minor, currency }` on each party of GET /api/crm/parties (list only; absent when the shop has more copies than one read takes) | — | derived (CRM-32): `lib/work-rows.unbilledByParty` - the open orders in that no bill names yet (open-orders MARKS_SQL, the Tasks Billed tag), grouped by the order's counterparty, value = the order's own total in minor units; `minor` null across two currencies | nobody | CB CRM (the Dues column: "not billed yet" instead of "Settled") |
| `consent_migrated` (list, only with `?with=consent`) | — | derived: b306 readable | nobody | CB CRM — say "consent records not set up yet" in words |
| `total` · `page` · `limit` on GET /api/crm/parties and GET /api/crm/privacy-requests | — | derived (MKT-SRV1 G4, DISCIPLINES §2; `lib/page-limit`). Parties: no `?limit` = the whole list (CAP 5000), `count` = `total` kept for old readers. Requests: default 50, max 200; `open` · `late` count the whole register, not the page | nobody | the web pager (PG / CBList remote) |
| 403 `{ code, why }` on POST /parties/:id/interactions | — | derived (MKT-SRV1 G2): an OUT `call` (channel phone) or `message` (body `channel`, else whatsapp) for body `purpose` (else service) asks `lib/privacy.gate`; in-bound, visits and notes are never gated | nobody | the Log sheet: grey Save with `why` |
| `code` on a refused `lib/whatsapp-out.notify` result + `channel_outbound.reason` = the gate's `why` | — | derived (CO1-GATE): the gate asked by `party_id` when the caller knows it, else by the digits of `to_ref` against the shop's parties' phone / sign-in contact; unreadable → `CONSENT_UNREADABLE` (fail closed) | `lib/whatsapp-out` | the outbound log (lib/channels) |
| GET /api/facts/marketing → `lines[]` · `figures { agreed, said_no }` or `unavailable` | — | derived (MKT-SRV1 G3, `lib/home-facts.marketing`): a party AGREED when its newest marketing row on any channel is a yes; SAID NO when it has marketing rows and none is a standing yes. Before b306: `unavailable` in words, never 0 | nobody | a Home / CRM card (web round to come) |
| `law` on GET /api/crm/parties/:id/contact-prefs and GET /api/privacy/me → `{ country, known, law, short, authority, consent, rights, kinds[], note, due_days }` | — | derived (T3-P3-CONSENT, `lib/privacy.lawOf(shop country)` — ONE per-country table beside DUE_DAYS: IN DPDP Act 2023 · AU Privacy Act 1988 · AE PDPL; `known: false` + `note` for an unstated or unpacked country, every kind offered — never India's words). `kinds` is what a page draws request buttons from | nobody (config) | the CRM record's Consent block; the shopper's privacy sheet (shop.html) |
| `GET /api/privacy/me` → `shop { name, country }` · `law` · `held[] { key, label, value }` · `consent { migrated, history[], may }` · `requests { migrated, requests[], total }` · `may_consent` · `may_request` `{ may, code, why }` | — | derived (T3-P3-CONSENT, `lib/privacy.shopper`; a storefront token only — middleware/customer-auth; the shop = the token's parent, the party = the token's identity). `held` lists what the platform holds with a null said, never dropped. `may_*` carries `PRIVACY_NOT_MIGRATED` before b306 / b307 | nobody | the shopper's privacy sheet (shop.html, beside My orders) |
| `party_contact_pref.noted_by` = the PARTY's own id (via POST /api/privacy/me/consent) | b306 | source: "how given" — by them, online (noted_by = party_id) vs noted by the shop's staff (noted_by = an actor or the owner) — the same `notePref`, no second writer | `lib/privacy.notePref` | the CRM consent history ("by them" / "noted by"), GET /api/privacy/me |
| `party_contact_pref.source` · `source_ref` (b777) | 'staff' | 'self' | 'reply' · uuid | source: CON-2 (22 Oct 2026) - who made the row; for 'reply' the capture id of the inbound STOP (the proof). Written only by `lib/privacy.notePref` (optional `source`, `source_ref`; the columns only once b777 has run - before it the withdrawal is written without the label); read by `prefs` · `gate` (the withdrawn sentence names the reply, code stays CONSENT_WITHDRAWN) and painted by the CRM consent history. NULL = not recorded. | `lib/optout.fromReply` (via `notePref`) | the consent history, Offers sent (the gate's `why`) |
| `privacy.LAW[country].optout` `{ words[], line, done }` | n/a (code table) | source: CON-2 - the per-country STOP words (matched against the WHOLE reply only), the opt-out line the one sender appends to every offer, and the confirmation sentence (`{shop}`). English base words for every country; a shop with no country gets that base alone. Local-language words need cb-country sign-off. | `lib/privacy.js` | `lib/optout.js` · `lib/whatsapp-out.notify` |
| `privacy_request.*` (request_id · owner_entity_id · party_id · who · kind · country · received_at · due_at · answered_at · answered_by · outcome · answer · created_by · created_at) | b307 | source; `due_at` derived at insert from `lib/privacy.DUE_DAYS`; answered once (trigger) | `POST /api/crm/privacy-requests` · `/:id/answer` (owner) | `GET /api/crm/privacy-requests` |
| `late` · `answered_late` · `open` · `late` (list) · `may_answer` · `why` | — | derived by the server | nobody | the register's reader |
| `GET /api/privacy/facts` → `notice_version` · `notice` · `contact` · `contact_line` · `processors[]` (name · role · region · source · on) · `due_days` | — | `lib/privacy.FACTS` + env (`RAILWAY_REGION`, `PRIVACY_NOTICE_VERSION`, `PRIVACY_CONTACT`; a provider is `on` when its key is set) | nobody (config) | the Standards register's privacy rows (live check); web docs/compliance/ROPA.md |

## POST /api/books/payments/preview · POST /api/books/payments (M26, 2026-10-08 · SPEC-payments §2.4, §4.1, §4.2 · PAY D5 as written)

No money is computed here: the proposal is `CBReceivables.propose` through ONE function, `lib/books.js proposeFor` (preview, the one-call record and `/payments/:id/propose` all call it); the figures are the engine's `outstanding`; the words are built server-side once (`paymentOutcome`, `duplicateWarnings`) and the web paints them.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| request `allocate` | `'oldest_first'` · `'none'` · absent | Source (the person's choice). `oldest_first` with no `allocations` = the server's own proposal is applied. `none` = keep as an advance on purpose (W2 is then not raised). Absent = as before M26: nothing allocated. |
| request `allocations[]` | `[{ against_ref, amount_minor }]` | Source: the bills the person ticked. Judged by `confirmItems` inside the payment's own transaction; a refusal rolls the payment back (422, nothing recorded). Refused in words with a cheque (it settles bills when it clears). |
| request `acknowledge[]` | `['nothing_owed' \| 'excess' \| 'same_again' \| 'just_settled']` | Source: set only by the web's **Pay as advance** button. Every warning the server would raise must be in it, else 409. |
| preview `proposal[]` | `[{ against_ref, bill_no, due_date, open_minor, apply_minor, disputed }]` | Derived (`proposeFor`): every open bill of the party on that side, oldest due first; `apply_minor` what this amount takes; a disputed bill is listed with `apply_minor: 0`. Same shape as `/payments/:id/propose`. |
| preview `open_minor` · `apply_minor` · `on_account_minor` · `skipped[]` · `why` | integers (minor units) · `[{ against_ref, why }]` · string or null | Derived: every open bill (disputed included) · what the proposal applies · what stays as an advance · bills the engine skipped with its words · the engine's refusal (an uncleared cheque) or null. |
| preview `party` | `{ party_id, name }` | Read: the shop's list name (`on_rail` arrives with M30's `partyOnRail`). |
| preview `warnings[]` · 409 `warnings[]` | `[{ code, words, entry_no?, payment_id? }]` | Derived (`duplicateWarnings`, PAY D5 = W1–W4, 24-hour window on `created_at`): `nothing_owed` · `excess` · `same_again` (names the earlier payment's entry) · `just_settled` (names the entry that settled the bills now at 0). Codes are stable strings; words are the shop's. |
| preview `words` | string | Derived: "₹3,720.12 settles 4 bills · ₹1,279.88 stays with Kumar Traders as an advance" — the line under the bills table. |
| 409 `{ code: 'ALREADY_PAID', error: 'Already paid?', message, warnings }` | — | `POST /payments` when a warning is not acknowledged. `message` is the whole sentence ("Already paid? … Pay ₹5,000 again as an advance?"). Nothing is written. A replay of a known `client_ref` is answered 200 BEFORE the rule looks. |
| record `allocation` | `null` · `{ settled: [{ against_ref, amount_minor }], items, allocated_minor }` | Derived: what `settleBills` wrote in the same transaction as the entry. `null` when nothing was asked for, or a cheque is held. |
| record `outcome` | `{ words, settled: [{ against_ref, bill_no, amount_minor }], applied_minor, on_account_minor, balance_minor, balance_words }` | Derived, read back from the rows just written (same transaction). `words`: "Paid ₹5,000 cash to Kumar Traders. Settled 2 bills (₹1,720.12). ₹3,279.88 left with Kumar Traders as an advance — they owe you this." `balance_minor` signed as `/dues` (+ they owe you); `balance_words` never a minus ("they owe you ₹X" · "you owe ₹X" · "settled"). Absent on a replay (`duplicate: true`). |
| store read `paymentsSince` | `books_payment` rows by party · direction · `created_at >= since` | New read in `lib/books-store.js` (W3). The window is read from the real clock; W4 reads `party_item.payment_id` + `created_at`, already selected by `items`. |

## chit header · `business_json.page` (N03, 2026-10-07 · decisions M-D6 / M-D7)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `business_json.page` | string `<kind>.<vertical>.<face>@<major.minor>`, e.g. `chit.base.detail@1.0` | Source. Which detail page the chit was made with. Written ONCE by `POST /api/chits/send` (`mint.page()`) on every copy that carries business data — sender, receivers, a bill copy; the sender may name one in `business_json.page` (a name alone takes its newest version), otherwise the base page. A promoted draft keeps its own unless the resend names one. Never written afterwards: every later `business_json` write is a merge-patch of its own key (`tests/page-name.test.cjs`). Read by the app's `CBPage.resolve()` to open the chit. |
| (refusal) `code: 'PAGE_UNKNOWN'` | 400 `{ error, code, message }` | A name or version the registry does not have, a reserved name (`sale.restaurant.table`, `service.repair.job`), or a non-string. Refused at mint only, before anything is written. Opening never refuses: an unknown name or version opens the base page with the note "made with X@v — page not installed". |
| the registry | `data/pages.json` `{ grammar, base, pages: [{ name, version, script, says }], reserved: [] }` | A byte copy of the master, chitbridge-web `public/app/pages.json`. One row per name@version; rows are kept when a version ships. minor = a compatible body change, major = a header or action change. |
| absent `page` | — | A chit minted before N03, or by a path that is not `/chits/send` (signal chits, network edges, storefront orders, the operator's redacted copy). Read as the base page — what it was made with — with no note. |

## test board · `test_result.project` (migration b292, DRAFT — Athi runs it · 2026-10-07)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `test_result.project` | text, optional, ≤ 80 characters after trimming; e.g. `2026-10 build · Stage 1` | Source. The sprint or project a run belongs to. Written with the run, like `run_label`, by the ONE recorder `recordResults` (`routes/testing.js`) for both doors: `POST /api/testing/results` (a tap, body `project`) and `POST /api/testing/results/junit` (body `project`; CI passes `--project` / `CB_BOARD_PROJECT` through `chitbridge-web/e2e/post-results.cjs`). Blank = no project (NULL). Over 80 → 422. Rows from before b292 read `(before projects)`. Index `idx_test_result_project (entity_id, project, at DESC)`. |
| `?project=` on `GET /api/testing/results` · `/runs` · `/coverage` · `/report` | query string | Narrows every `test_result` read to that project's rows (the cases stay the board's). Each answer carries `project` (the filter it answered for, or null). |
| `runs[].project` · `report runs[].project` | string or null | Derived: `max(project)` of the run's rows. |
| `projects[]` on `GET /api/testing/runs` | `[{ project, runs, last_at }]`, newest first, ≤ 200 | Derived from the whole ledger (not the 50 runs), so an old sprint stays choosable. Read by testing.html's Project filter. |
| `project` · `project_not_written` on the two POSTs | string or null · string | `project` = what was written. ⚠️ Before b292 the column is missing: the run is recorded WITHOUT the project, `project_not_written` says so, and the server logs one warning. Detected once from `information_schema` (a "no" is asked again after 5 minutes, so b292 is picked up without a redeploy); a 42703 on the INSERT also flips it and retries without. |

## person sessions · `identities.policy_flags.devices` and the token claims (M05, 2026-10-07 · decisions D3 / D14)

No SQL. `devices` is a new top-level key in the shop's `identities.policy_flags` jsonb, beside `api_keys` and `counters`. It
lives on the SHOP's row (the entity; an employee's sessions sit under their parent). Every write locks the row (`FOR UPDATE`)
and replaces only this key (`jsonb_set(…, '{devices}', …)`). One engine: `lib/person-session.js`.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `policy_flags.devices` | `{ [device_id]: device }` | source. Written by `lib/person-session.js` (`open` at sign-in and renew · `close` at logout/revoke · `renew` · `revokeDevice`). Read by `middleware/auth.js` (`deviceListed`, cached ≤ 60 s per jti) and `/api/signin/sessions` · `/devices`. |
| `device_id` (the key) | string, 8–80 of `A-Z a-z 0-9 _ . : -` | Made by the page (`localStorage.cb_device_id`), sent as body `device_id` at sign-in and as `X-Device-Id` on every request. |
| `.label` · `.kind` | string or null · `'till'` \| `'web'` | `kind` from the first sign-in's surface (`till` → `'till'`, else `'web'`). `label` reserved for the owner's name for the device. |
| `.by` · `.first_seen` · `.seen` · `.ua` | identity_id · ISO time · ISO time · string ≤ 160 | who first signed in on it · when · last sign-in or renew · its user agent. |
| `.revoked_at` · `.revoked_by` | ISO time · identity_id | set by the owner (`POST /api/signin/sessions/revoke { device_id }`). A revoked device refuses every token (401 `DEVICE_REVOKED`) and every new sign-in (403 `DEVICE_REVOKED`). |
| `.sessions[]` | `{ jti, iat, exp, surface, by, renewed_from? }` | one per live session on the device (≤ 10; expired ones dropped on the next write). Logout/revoke/renew remove the jti. `renewed_from` = the jti this one replaced. |
| `.till` | `{ prefix, assigned_at, at, issued, counter?, engines? }` | M11: the phone's bill series. Written ONLY by `routes/keys.js claimSeries` (claimDevice) at `GET /api/till/snapshot`: `prefix` = the assigned counter label (D9, PHONE match) else the kept prefix else the next free `TILL_IDS`; `assigned_at` = when this prefix was first given; `counter` = the registered counter it holds; `issued` / `engines` as on a key's `till`. Read into `req.till.counter`. A revoked device's prefix stays reserved. |
| `chit_header.business_json.till.device_id` · `.by` · `.sent_by` | string · identity_id · identity_id | M11, on a bill sent by a PHONE session (`lib/holder.js tillClaimOf`, asked by `POST /api/chits/send` before the dedupe). `device_id` must be the session's device (else 400 `TILL_CLAIM_MISMATCH`); `by` = the person who MADE the bill on that device, kept as written; `sent_by` = the signed-in person who sent it, written (merge-patch) only when it differs from `by` — the request log then says `kind: 'sent_by_other'`. Missing `device_id` / `by` are filled from the session. A key's (shop PC's) bill is not checked or stamped. |
| `policy_flags.counters[id].assigned` | `{ phone, at, by }` or null | M11 (D9): the counter label is assigned to a PHONE NUMBER (`POST /api/counters/:id/assign`, owner only; `phone` normalised as the PHONE document is). Matched against the signed-in person's VERIFIED PHONE identity document (`identity_documents.value_hash`, `docHash`). `GET /api/counters` shows it masked. While a phone holds the label, `counters[id].held_by` = `'dev:'+device_id`. |

**Token claims a person session adds** (`lib/identity-auth.js issueToken / signToken`, only when the sign-in named a device):

| Claim | Shape | Meaning |
|---|---|---|
| `kind` | `'person'` · `'auto'` | a listed person session (a key is `'api_key'`; a legacy token has no `kind`). `'auto'` (K-SEC PR A): the shop's own auto-raise token from `lib/autoraise.js` — `auto: true`, a `jti`, 60 s; auth admits it only while it lives ≤ 120 s, never listed. |
| `jti` | uuid | the session's id; alive only while listed under `device_id`. |
| `device_id` | string | the device the token is bound to; `X-Device-Id` must equal it (else 401 `DEVICE_MISMATCH`). |
| `surface` | `'till'` · `'index'` · `'app'` · … | where it was signed in; `till` lives 30 days, everything else 7 (D3). |
| `iat` · `exp` | seconds | the same values as the listed session. |

**Legacy tokens** (no `jti`): every token issued before M05, and every sign-in that names no device. Honoured exactly as
before until their own `exp` (≤ 7 days); not listed, not revocable; the request log carries `kind: 'legacy'` (a session:
`kind: 'person'`). `POST /api/signin/renew` with `X-Device-Id` turns one into a listed session.
**K-SEC PR A (2026-10-21):** every web page now names its device (web `public/app/device-id.js`), so a sign-in there is a
session. A legacy person token is refused 401 `SESSION_UPGRADE` ("Sign in again") ONLY when the variable `LEGACY_TOKEN_REFUSE`
is `1`/`true` — off by default. A sign-in whose session cannot be listed answers 503 `SESSION_NOT_LISTED` (never a legacy token).

| GET /health key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `legacy_tokens` | `{ refusing, minted, customer_minted, used, refused }` | Derived, per process since boot: `lib/person-session.legacyCounts()`. `minted` = person tokens issued with no session; `customer_minted` = storefront customer tokens (exempt from the refusal, counted apart); `used` / `refused` = requests on a person legacy token. Written by issueToken and middleware/auth.js; read by Athi before setting `LEGACY_TOKEN_REFUSE` (7 days at `minted: 0`). |

**Response keys** — `POST /api/signin/renew` → `{ token, jti, exp, device_id, surface }` · `POST /api/signin/logout` →
`{ ok, removed, legacy? }` · `GET /api/signin/sessions` → `{ sessions: [{ jti, device_id, surface, iat, exp, current, device:
{ label, kind, seen } }], legacy }` · `GET /api/signin/devices` (owner) → `{ devices: [{ device_id, label, kind, by,
first_seen, seen, revoked_at, till_prefix, sessions }] }` (`sessions` = live count) · `POST /api/signin/sessions/revoke` →
`{ ok, revoked: 'session'|'device', removed? }`. Refusal codes: `DEVICE_MISMATCH` · `SESSION_EXPIRED` · `DEVICE_REVOKED` ·
`KEY_CANNOT_SIGN_IN` · `NO_DEVICE`. `req.till` gains `session: { jti, device_id, surface }` (null otherwise) and the holder
`'dev:'+device_id`.

## Home facts · `GET /api/facts/:card` (N18, 2026-10-08)

One read per Home card, behind auth, signed-in people only (a key gets 403). Built in `lib/home-facts.js` from the libs the old per-page reads used. **A figure the server cannot compute is omitted, never 0.** Cost never travels.

| Route | Answer | Omitted, and why |
|---|---|---|
| `/api/facts/till` | `{ lines:[{text,value?}], figures:{ day, bills, takings, currency, counters_open } }` — newest day sent up (named "today" only when it is the shop's day), and counters open | "bills not sent up" (the queue is on the counter's PC); `day`/`bills`/`takings` when no day summary exists |
| `/api/facts/accounts` | `{ lines, figures:{ last_check, waiting, accept, add_supplier, record } }` — `tone:'dn'` on a difference or anything waiting; the waiting line in To do words (FX-F10W) | everything (`lines:[]`, `unavailable`) when the ledger is off or not provisioned |
| `/api/facts/product-lab` | `{ lines, figures:{ items, no_cost } }` — a COUNT of items whose cost is unknown | `no_cost` for an actor without `can_see_costs`; no cost value is ever selected |
| `/api/facts/combo-lab` | `{ lines, figures:{ saved } }` — saved sets in the library | the combos/modifiers split (one table, one shape) |
| `/api/facts/offer-lab` | `{ lines, figures:{ drafts, live } }` | — |
| `/api/facts/rail` | `{ suppliers, customers, in, out, tasks, stuck }` — in / out / tasks = Tasks & Orders' folder counts (Orders in · Orders out · Tasks; derived by lib/work-rows classify · countsOf over the rail's own select read — written by lib/home-facts.rail, read by index.html's rail, TOUR-FIX1), stuck = open past the shop's `overdue_days` | `in`/`out`/`tasks`/`stuck` when the shop holds 5,000+ chit copies (a truncated count is a wrong one) |

`lines[i]` = `{ text, value?, tone? }` (`tone` is `'dn'` or absent); the shell draws the first two. Unknown card: 404. Trips: till 1 · accounts 1 · product-lab 1 (2 for an actor) · combo-lab 1 · offer-lab 1 · rail 2.
## GET /api/identity/documents · POST /api/identity/documents/:scheme/code · /verify (M18, 2026-10-07)

A phone or e-mail identity document is confirmed by a code sent to it (`lib/iddoc-verify.js`, on `lib/otp.js`). Written by: `POST .../verify` (stamps the existing `identity_documents` row; `PUT` clears it). Read by: the profile screen; N19's trade-ready check ("identity-docs verified PHONE/EMAIL/PAN").

| Key | Shape | Meaning |
|---|---|---|
| `documents[].verified` | boolean | `status === 'verified'` AND `verified_at` set. True for a PHONE/EMAIL only after its code was entered; true for PAN etc. only when the verifier stamped it. Changing the value (`PUT`) makes it false again. |
| `documents[].verified_at` | ISO time or null | When it was confirmed (already returned; null while unverified). `verified_by` says how: `otp:email` · `otp:phone` · `nsdl` · `manual:<actor>`. |
| `.../code` → `delivery` · `sent_to` · `expires_in` | `'sent'`/`'not_sent'` · masked · `'10 minutes'` | The code is never in the body of a sealed environment (`dev_otp` only where `mayExposeOtp()`). Refusals: `PHONE_DELIVERY_NOT_CONFIGURED` · `EMAIL_DELIVERY_NOT_CONFIGURED` (503) · `IDOC_NOT_CODE_VERIFIED` · `IDOC_NOT_FOUND`. |
| `.../verify` → `verified` · `verified_at` | true · ISO time | Refusals: `OTP_WRONG` (400) · `OTP_LOCKED` (429, after 5) · `OTP_EXPIRED` · `IDOC_NO_CODE`. |

The pending code is held on the row's existing `verification_ref` (hashed, with expiry and wrong-attempt count); it is never returned.

## GET /api/entities/header (N19, 2026-10-07)

The shell's header sheet in ONE read (`lib/entity-header.js`; one `readBatch` over the shop row, profile, `entity_compliance` and the identity-document verdicts; cold 3 trips with two cached schema probes, warm 1). Written by: nobody (derived). Read by: `public/app/shell.js` (N17). Bands, penalty words and which licences are core come from `lib/licence-rules.js` (data, country-keyed); the page computes none of them. The identity-document verdicts are read through `lib/iddoc-verify.js` only. `kyb.yourself()` is not called (it is many trips); the licence rows are the same `entity_compliance` rows, with `kyb.daysUntil`.

| Key | Shape | Meaning |
|---|---|---|
| `business` | `{ name, legal_name, address, phone, currency }` | `name` = `identities.display_name`; `legal_name` / `address` / `phone` = the profile vault's Business-identity tags, else the `identities` column. Any may be null. `currency` (AU-WORDS, 2026-10-15) = `identities.currency_code` (source; written by country-setup / registration), read by the web shell (`moneySymbol`): the money icon on Home and the area switcher is this currency's symbol, `¤` when null. |
| `licences[]` | one row per gathered `entity_compliance` row, plus one per CORE scheme not yet held | Core rows not held have `days_left: null`, `valid_until: null`, `band: null` ("not added"). |
| `licences[].scheme` · `label` | string | The rule's scheme and label; for a row with no rule, its `standard_key` and humanised `doc_key`. |
| `licences[].number_masked` | string or null | `verification.number_masked` when the verifier stored one; else null. |
| `licences[].valid_until` · `days_left` | `YYYY-MM-DD` · integer, negative = expired, or null | `kyb.daysUntil` of `valid_until`. |
| `licences[].band` | `ok` · `due` · `soon` · `gone` or null | From the scheme rule's bands (default >120 ok, 91-120 due, 0-90 soon, expired gone). **null when no rule matches: days only.** |
| `licences[].core` | boolean | The scheme is in `core_by_vertical` for the shop's vertical (`lotfields.packFor` over `identities.vertical` and the profile sectors). |
| `licences[].renew_url` | string or null | From the rule; null without one. |
| `licences[].note` | string or null | The rule's late-fee sentence, only for the bands the rule names (FSSAI: `gone`). Carries no amount and no start day. Null when no rule. |
| `licences[].rule_verified` | boolean or null | `false` = the rule's source is not cited yet ("verify"); every rule is false today. Null when no rule. |
| `trade_ready.checks[]` | `{ key, label, done }` — the shop's COUNTRY PACK's list (`lib/pack-words.tradeChecksFor`, AU-WORDS 2026-10-15) | `key` is the code a client may branch on; `label` the pack's word. IN: `address` (an address whose rung is at least `copied`: profile provenance or vault row, not just typed) · `phone` (the PHONE identity document is `verified`) · `pan` (a PAN identity document is held, or the PAN is read from the GSTIN) · `tax_id` ("GSTIN": the number is on file). AU: `address` · `phone` · `tax_id` ("ABN"). AE: `address` · `phone` · `tax_id` ("TRN") · `trade_licence` (a gathered `entity_compliance` row whose keys say trade licence / shops act). No country: `address` · `phone` · `tax_id` ("Tax number"). Was `gstin` × 4 fixed rows before 2026-10-15. |
| `trade_ready.done` | boolean | Every check of the pack's list is done. |

## GET /api/entities/policy · PATCH /api/entities/policy · GET /api/entities/sides — the pack's words (AU-WORDS, 2026-10-15)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| GET /policy `country` | ISO-2 or null | Source: `identities.country`, read in the same statement as the flags (`policy.read`, 1 trip). Read by nobody on the web yet (the schema already carries the pack's words); sent so a client can say which pack worded it. |
| GET /policy `schema.gst_registration.ui` | `{ label, options[], labels{}, help }` per pack (`policy.schemaFor` ← `lib/pack-words.registrationKindsFor`) | Derived. `options` is the subset of the STORED enum (`regular · composition · unregistered · sez`, unchanged) the pack offers: IN all four; AU and AE `regular · unregistered`; no pack `regular · unregistered`. `label` = "GST registration" (IN · AU) · "VAT registration" (AE) · "Tax registration" (none). Read by web cap-settings.js `policy` (CB Settings › Policy) and cap-admin.js polDefs. |
| GET /policy `schema.chit_expiry_days.ui.labels` · `schema.retention_days.ui.labels` | `{ "0": word }` | Derived: "No expiry" · "Keep — the law here asks N years" (the pack's `retentionYears`) or "Keep — at least 9 years" (policy.RECORDS_FLOOR_YEARS). Read by web cap-settings.js `shown` (a 0 is shown as its word). |
| `entity_actor_settings.default_max_tasks` ceiling on `identities.max_tasks` (POST and PATCH /actors 400 `code: 'MAX_TASKS_OVER_ENTITY'`) | integer 1-100; no entity ceiling = 1-100 only; a new person given none gets 10 | Chosen, tighten-only · `entity` layer. Settings › Work sets the entity ceiling; a person's `max_tasks` may be lower, never higher (SET-31, `routes/actors.js entityTaskCap`). The ceiling is read only when max_tasks is sent. No ceiling stored = the 1-100 validator only. Read by routes/chits.js (assignment). |
| PATCH /policy 400 `code: 'REG_KIND_NOT_OFFERED'` | `{ error, code, message }` | Derived: the patch named a `gst_registration` kind the shop's pack does not offer (`policy.kindRefusal`); `message` lists the pack's choices. One extra read (the country) only when the patch names that key. |
| GET /sides `impact.field` · `impact.tax_id_word` | `'tax_id'` · the pack's word (`GSTIN · ABN · TRN · Tax number`) | Derived (`lib/pack-words.wordsFor`). `impact.n` = "Your " + the word; the Filings row `m` = the pack's return short name + " · Name your " + the word (GSTR-3B · BAS · VAT return; none with no pack). Was `field: 'gstin'`, "Your GSTIN" for every shop. Read by web sides.js (paints `n` and `m` only). |

## `policy_flags.books.auto_post` (M34, 2026-10-08 · DECISIONS: "Nothing posts by itself")

No SQL: `books` is a key of the shop's `identities.policy_flags` jsonb, whitelisted in `lib/policy.js` FLAGS (type `switches`).

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `policy_flags.books.auto_post` | `'on'` or `'off'` (or `{ on: boolean }`); absent = OFF | source. Written by the OWNER only (`PATCH /api/entities/policy { books: { auto_post: 'on' } }`). Read by `lib/books-recurring.autoPostOn` (the nightly sweep) and `lib/books-todo`. OFF (the default, and on any failed read): the sweep posts nothing — an `auto` template and a due accrual reversal are only counted as proposals and show on the To-do. |
| `books/todo` `recurring_due.items[].auto` | boolean | derived: the template's `auto` AND the flag on. False reads as "ask me". |
| nightly `posted.recurring.proposed_reversals` | integer | derived: accrual reversals due that the sweep left for the To-do because the flag is OFF. |

## GET /api/books/party/:id/statement · POST /api/books/entries/:id/reverse (M29 reverse from the row, 2026-10-09 · SPEC-payments §4.4, §4.5)

Every statement line now names its entry, so a row can be reversed without opening the Day book; the reverse answer names the bills it reopened. All derived — written by nobody; read by the CB Accounts ledger (party view) and the CRM record's statement (`cap-books.js statementHTML`, `bkLgDetails`). One read per table, never per row (`routes/books.js`: lines with their reversal in one query, sources, the party's items once).

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `lines[].entry_id` · `entry_no` · `event_type` | uuid · `SV/2026-27/000001` · `payment_made` … | The line's own journal entry (`journal_entry`, via `books-store ledgerLines`). `entry_no` = `ref` (kept for the old reader). The web's Reverse action calls `POST /entries/:entry_id/reverse` with it. |
| `lines[].reverses_entry_id` | uuid or null | Set on a mirror (reversal) line: the entry it cancels. A line with it is never offered Reverse. |
| `lines[].reversed_by` · `reversed_why` | `MJ/2026-27/000012` or null · words or null | The FIRST entry whose `reverses_entry_id` is this line's entry (one `LEFT JOIN LATERAL … LIMIT 1` in `ledgerLines`), and the reason read back from its narration (`books.js reversalWhy` — the one writer's `'Reversal of <no> — <reason>'`). The row paints "reversed by MJ/… — reason"; a line with it is never offered Reverse. |
| `lines[].payment_id` | uuid or null | Derived from the entry's `source_ref` `pay:<payment_id>` (no query). Null on a line that is not a payment. |
| `lines[].unapplied_minor` | integer or null | `CBReceivables.outstanding(items).by_ref['pay:<id>']`, negated — the part of the payment still on account (the same figure the preview and the outcome use). 0 once reversed. Null on a non-payment line. |
| `lines[].advice` | `{ chit_id, state: none·sent·delivered·shared·disputed, shared_at }` or null | The payment-advice state (§3.6). `none` until the advice columns land (PR 6, migration b2xx `books_payment.advice_chit_id / advice_shared_at`); the shape is sent now so the row reads the same then. Null on a non-payment line. |
| reverse `reverses_entry_id` | uuid | The entry the mirror cancels (beside `reverses`, its number). |
| reverse `reopened[]` | `[{ against_ref, bill_no }]` | `CBReceivables.reopenedBy(rows)` (engines v1.31.0) over the party rows written in the SAME transaction — the bills whose allocation halves were reversed, each once; `bill_no` from `billNos` (one read), null when the bill is not a chit here. |
| reverse `words` | `Reversed PY/… — ₹1,500 — by MJ/…. Reopened 2 bills (KT-0007, KT-0008).` | The sentence a screen paints (`books.js writeReversal`); the web never composes it. |
| reverse 409 `{ code: 'ALREADY_REVERSED', error, message, entry_no, entry_id }` | — | A second Reverse of an entry already reversed (the writer's `source_ref 'reverse:<id>'` found it, M11): names the reversal in words. Not a replay: a reversal has no client_ref of its own. |

## POST /api/books/payments (`advice`) · GET /api/books/payments/:id/advice · PATCH /api/books/payments/:id · To-do `advices_to_send` (M30 advice OUT, 2026-10-09 · SPEC-payments §3, §4.3, §4.4, §4.7 · migration b285)

The advice is a CHIT the web sends (`POST /api/chits/send`, purpose `general`, `business_json.kind` `payment_advice` — §3.1, decision D2); the API composes the ready body ONCE (`lib/books.js adviceBody`) and answers MAY (`adviceMay`, the rule `PATCH` enforces). Nothing posts on the payee side at send (the hook classifies the kind as a queue until M31 Accept). Money: minor-unit integers are the source; a major-unit twin rides beside each for folders and the CRM timeline (`money.decimals`).

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `books_payment.advice_chit_id` | uuid or null | **b285**, source. Written ONCE by `PATCH /payments/:id { advice_chit_id }` after the web's `/chits/send` answered (store `setAdvice`: first wins — `WHERE advice_chit_id IS NULL OR = the same`; a different id → 409 `ADVICE_EXISTS`). Read by the statement (`lines[].advice.chit_id`), the advice read, the To-do. |
| `books_payment.advice_shared_at` | timestamptz or null | **b285**, source. Written once by `PATCH { advice_shared_at: true \| ISO }` when the words were shared off-rail (copy · WhatsApp · e-mail); `COALESCE` keeps the first moment. Read as `advice.shared_at` and state `shared`. |
| preview `party.on_rail` | boolean | Derived: `books-store parties` now carries `on_rail` = `local-identity.onRailSql` (an active business entity, never a `~` minted record, never a shopper). The popup says "X is not on ChitBridge" before anything is recorded. |
| record `advice` · GET `/payments/:id/advice` | `{ payment_id, party: { party_id, name, on_rail }, advice: { chit_id, state, shared_at }, may: { send_advice, share_advice }, words, body, share }` or `null` (a replay) | Derived (`adviceFor`): from the record just made (no second read of the bills) or one read each (payment · entry ×2 · party rows · items · billNos · my copy's chit status). The same block on both so the outcome panel sends without a second round trip. |
| `may.send_advice` · `may.share_advice` | `{ ok: true }` · `{ ok: false, why, say }` | Derived (`adviceMay`): `why` ∈ `read_only` · `comment_only` (the rail engine's ladder and its sentences, `lib/rail.js`) · `not_available` (b285 not run) · `cheque_held` · `not_posted` · `reversed` · `already_sent` · `off_rail` (send) · `on_rail` (share). The unit shows every action and greys a refused one WITH `say`; the PATCH refuses with the same word (403 for the level words, 409 otherwise, 503 `BOOKS_NOT_MIGRATED` before b285). |
| `words` | `Chola Auto Care paid you ₹2,000 cash on 5 Oct 2026 for bills TT-0001, TT-0002 (₹1,680) · ₹320 as an advance.` | Derived (`adviceBody`): the sender's shop name (the owner's identity, else `books-store shopName`), `bill-privacy.money`, `dateWords`. Direction in: "…received ₹X cash from you on …". The payee's To-do and the off-rail share text are this sentence. |
| `body` | the `POST /api/chits/send` body: `{ recipients: [{ entity_id: payee, role: 'to' }], purpose: 'general', manual_subject, client_ref: 'advice:pay:<payment_id>', line_items[], business_json }` or `null` when `may.send_advice` is refused | Derived. `client_ref` makes `/send` idempotent (a retry answers the first chit, `duplicate: true`). `line_items[]` = the bills settled: `{ particulars, quantity: 1, unit: 'bill', price, total, currency, ref_chit_id (the bill's chit_id — the same id on both copies), bill_no, applied, applied_minor }`. |
| `body.business_json` | `{ kind: 'payment_advice', currency, payment_advice: { action: 'paid' \| 'received', adviser_payment_id, adviser_entry_no, amount, amount_minor, currency, mode, reference, paid_on, applied_minor, on_account, on_account_minor, collected_by: null, reverses_advice_chit_id: null, words } }` | Derived; the one shape M31 classifies (`books-hooks` `kind === 'payment_advice'`). `collected_by` (M32) and `reverses_advice_chit_id` (M32 reversal advice) are carried null now so the shape never changes under M31. |
| `share` | `{ text, wa, mailto }` or `null` when `may.share_advice` is refused | Derived: `text` = `words`; `wa` = `https://wa.me/?text=<encoded>`; `mailto` = `mailto:?subject=Payment advice <no> — <shop>&body=<encoded>`. Off rail only — never a chit to nowhere (D7). |
| statement `lines[].advice.state` | `none` · `sent` · `delivered` · `shared` · `disputed` | Derived (`adviceState`): `advice_chit_id` set → my copy's `chit_status.current_status` (one read, `adviceStates`) delivered/read/accepted → `delivered`, else `sent`; an open `chit_disputes` row on it → `disputed`; no chit but `advice_shared_at` → `shared`. `none` for every line while b285 has not run (`adviceReady`). The payer NEVER reads the payee's accept (CORE PRINCIPLE). |
| PATCH 200 | `{ ok, payment_id, advice: { chit_id, state, shared_at } }` | The row after the merge-patch. Refusals: 400 (nothing named · not a uuid · not a date) · 403 `why` read_only/comment_only · 404 · 409 `code` ADVICE_EXISTS / OFF_RAIL / ON_RAIL / REVERSED / CHEQUE_HELD / NOT_POSTED · 503 BOOKS_NOT_MIGRATED, all with `message` in words. |
| To-do `advices_to_send` | `{ kind, count, words, action: { label: 'Send advice', screen: 'ledgers', call: 'PATCH /api/books/payments/:id' }, items: [{ payment_id, party_id, name, direction, amount_minor, currency, received_at }] }` | Derived (`books-todo`, store `paymentsNeedingAdvice`, one read): payments with no advice sent or shared, party on rail, posted, not reversed, a cheque only once cleared. Words: "1 payment has no advice yet — Tally Test does not know you paid." Left out before b285 (the count cannot be read). |

## GET /api/till/bills · counter bill chit (walk 2026-10-09, BF3/BF8)

| Key | Shape | Source / who writes it / who reads it |
|---|---|---|
| `business_json.order` | `{ type: dine, take or deliver, table, kots[] }` or absent | The order bar of the counter (lib/orders KINDS), written once by the counter on the chit (`till.html chitOf`); only when the shop runs an order pad / KOT. Read back by `GET /api/till/bills` as `bills[].order` so a reprint prints Dine-in (table) / Takeaway / Delivery. |
| `line_items[].mods` | `[{ group, option, price }]` or absent | The modifier choices on the sold line (lib/variant `clean()` shape), written by the counter, read back as `bills[].lines[].mods` and printed under the item on the slip. |
| `business_json.not_invoice` | `'shop_details'` · `'buyer_identity'` or absent | WHY this tax bill is NOT a tax invoice, recorded with it. Written by the counter (`till.html finish()` → `chitOf`): `'shop_details'` when a bill that charges tax was saved while the shop's GSTIN state and address disagree (`shopStateClash`, walk 2026-10-09 M41); `'buyer_identity'` when the shop's pack wants the buyer on a tax invoice of this total and nobody is named (reg-au `taxInvoice.buyer_identity_from_minor` A$1,000, GST Act s.29-70(1)(c)(ii); reg-in r.46(f)). Also written by the server at send (CTRY-76, `routes/chits.js sendPaper` → `lib/bill-paper paperOf`) when the counter left it absent and the pack's rule holds the bill — the first reason stands, never overwritten; the send answer then carries `not_invoice: { code: 'INVOICE_HELD_BUYER', not_invoice, why, cite }` (absent = silence, like `number_check`). A buyer tax id (`business_json.customer.gstin`) that fails the pack's one check (`profile.taxIdRefusal`, the same call shop setup runs) is refused 400 `BUYER_TAX_ID_BAD` instead. Read back by `GET /api/till/bills` as `bills[].not_invoice`; the slip then prints BILL — NOT A TAX INVOICE (the same title as an unrated line), on the first print and every reprint. Money and the frozen `invoice` are unchanged. Tests: tests/bill-paper.test.cjs. |

## Till round T2a (walk 2026-10-10, M126 / M127 / M130)

| Key | Shape | Source / who writes it / who reads it |
|---|---|---|
| `business_json.order.from` | uuid or absent | **M126**, source. Written by the counter (`till.html finish()`) when a bill was made from an ONLINE ORDER (`BILL_ORDER`): the order chit's id. `order.type` is `deliver` or `take` as the shopper chose. Read back by `GET /api/till/bills` (`bills[].order`, whole object) and the reprint. |
| `GET /api/till/tasks` · `tasks[].order` | `{ channel: 'online', fulfilment: 'delivery' or 'pickup', address, requested_delivery, remark }` or `null` | **M126**, derived (`orderOf`) from `summary_json.order_details`, which the storefront already writes (`routes/catalogue.js`). No new trip: `summary_json` is already in `select.rows`. Read by the till to bill an online order as ordered. |
| `GET /api/till/snapshot` · `shop.holds_stock` | boolean or `null` | **M127**, derived from the shop's OWN DATA (`holdsStockOf`): true when a `stock_movement` of reason `opening` or `purchase` exists (a Receive was made) or an active product says `item_data.batch_tracked = true`; false when neither; `null` = unknown (table not migrated / read failed), shown as usual. Never from sector words. `false` greys Despatch (never Receive) at the counter with its reason; the counter may override with its option `stock`. One extra read (see the PR), skipped when the table is absent.
| `GET /api/till/quick-keys/hidden` | `{ hidden: [] }` for a login that holds no counter | **M130**: was 403 for the shop login on every page load; now an empty list (a shop login has nothing hidden). Counter keys unchanged. |

## Leads · GET /api/crm/parties?view=leads · POST /api/crm/leads · POST /api/crm/parties/:id/stage (CB CRM L1, 2026-10-10)

A lead IS a party: a local identity on `customer_list` with `added_via = 'lead'`. Its stage is NOT a column: it is the latest row of the per-shop `memberships` table (b297, kind `lead_stage`). Written by: `lib/memberships.add` only. Read by: the CRM Leads tab and the record.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `parties[].lead` | `{ stage, since }` or null | Derived: null unless `added_via = 'lead'`. `stage` = the latest `memberships` row (`lead` · `demo` · `trial` · `parked` · `lost`), `lead` before any move, `customer` once the party has traded (`txn_count > 0` — the first trade flips it, nothing is stored). `since` = when that row was written. |
| `leads_migrated` | boolean (only with `view=leads`) | false until b297 runs; the Leads tab then says "Lead stages arrive after the next update". |
| `lead.moves` · `lead.may` (the record) | stages ≠ current · `{ ok }` or `{ ok: false, why }` | Server answer for "Move to…": greyed with `why` while b297 is not run. |
| `memberships` row | entity_id · item_type · item_id · kind · grp · at · by_user_id | Append-only; RLS on entity_id; `membership_kind` is the dictionary of kinds and their groups. |
| 503 `LEADS_NOT_MIGRATED` | `{ code, message }` | A write before b297: nothing is created. |

## GET /api/books/cashflow?days=7|30 · GET /api/books/cheques `pdc_reminders` (CB Finance F3 · cash position, 2026-10-12)

Every key is DERIVED by `lib/books-cashflow.project()` from what the books already hold — nothing is stored, nothing posts. Written by: nobody. Read by: the Finance page's Cash tab (`web:public/app/cap-finance-cash.js`). Owner only; 404 while the ledger is off. All money is an integer of minor units.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `asOf` · `days` · `from` · `to` | date · 7 or 30 · date · date | The shop's today (lib/shop-clock) and the horizon: `series` runs `from` (today) to `to` inclusive, `days` rows. |
| `opening_minor` · `opening[]` | integer · `[{ role, code, name, balance_minor }]` | `CBLedger.balanceAsAt` over `books.asAtInput` (the trial balance's input): the net of the cash ROLE ledgers (`cash · bank · upi · card`), one row per ledger the chart has. |
| `in_minor` · `out_minor` · `closing_minor` | integers | Σ over the series. `closing_minor = opening_minor + in_minor − out_minor`. |
| `lowest` | `{ date, balance_minor }` | The lowest running balance in the horizon (today counts). |
| `shortfall` | `{ date, short_minor, balance_minor, driver: { kind, ref, name, amount_minor } or null, words }` or null | The FIRST day the running balance is below zero; `driver` = the largest outgoing item that day (null when the opening itself is below zero). `words`: "On 18 Oct 2026 you will be ₹12,400 short — Sri Traders’ ₹30,000 is due that day." |
| `words` | string | `shortfall.words`, else "You stay above zero for the next 7 days. Lowest ₹X on 15 Oct 2026." The screen paints this sentence; it composes none. |
| `uncounted` | `{ overdue_in_minor, overdue_parties, disputed_in_minor, disputed_out_minor, words }` | What is NOT in the running balance and why: a receivable overdue with no promise (not counted until promised or paid — honest numbers), a disputed bill either way (C4). `words` names the overdue figure; '' when nothing is left out. |
| `gst` | `{ payable_minor, form, short, due_date, counted, why }` or null | `books-period.gstPayableAt`: the posted GST ledgers after `CBPosting.gstSetOff` (the set-off the month close posts) + reverse charge in cash. `form` · `short` (W1-FIN, 2026-10-15) = the pack's own words for its return — `GSTR-3B`/`GST` (IN) · `BAS`/`BAS` (AU) · `VAT201`/`VAT return` (AE), from `pack.returns` (`books-cashflow.returnWords`); the screen's chip and the shortfall sentence say `short`, never a typed "GST". `due_date` = WHEN what is owed at `asOf` falls due: the return of the period that holds `asOf`, by the pack's calendar (`books-cashflow.returnDueFor` → engines `gst-returns.dueDate` IN the 20th after · `periodsFor` AU the BAS quarter's 28th (monthly 21st) · AE the FTA stagger's 28th); null when the pack will not guess it (AE: no stagger stored yet) — then `why` says so. `counted` = it has a date inside the horizon and is in `series` (`name` = `short`). `why` = the engine's sentence when the set-off was refused (then `payable_minor` 0), else why the date is unknown, else null. |
| `series[]` | `[{ date, in_minor, out_minor, balance_minor, items[] }]` | One row per day, today first; a quiet day is a row with no items. `balance_minor` is the running balance after that day. |
| `series[].items[]` | `{ kind, ref, party_id, name, amount_minor, date, due_date, promised, overdue, cheque_no }` | `kind`: `due_in` (a customer's open bill, `CBReceivables.outstanding`, on its due date — or on the PROMISE day from the open Dues follow-up, `promised: true`) · `due_out` (a supplier's open bill on its due date; overdue → today, `overdue: true`) · `cheque_in` / `cheque_out` (a cheque still HELD, on its cheque date — C3; the bills it will settle are covered oldest-due-first by `CBReceivables.propose`, so nothing counts twice) · `gst`. `ref` = the bill's against_ref, `pay:<payment_id>`, or `gst:<date>`. |
| `GET /cheques` → `pdc_reminders[]` | `[{ payment_id, cheque_no, cheque_date, amount_minor, state }]` | `CBReceivables.pdcReminders` over the same rows as `cheques` (direction in, still `received`): `state` = `deposit_today` · `overdue_for_deposit` · `not_yet` (only within `PDC_LEAD_DAYS` = 7). The cheques list itself is unchanged. |

## GET /api/books/dues?side=supplier&finance=1 `payable` · `payables` · POST /api/books/entries `against_ref` (CB Finance F4 · payables, 2026-10-13)

Every key is DERIVED by `lib/books-payables.view()` — nothing is stored, nothing posts. Written by: nobody. Read by: the Finance page's Payables tab (`web:public/app/cap-finance-pay.js`) and the pay sheet (`web:public/app/cap-books.js payOpen`, its offer). Owner only (403 "Only the owner may see what you owe."); 404 while the ledger is off. Only on `side=supplier&finance=1` — Collections' answer is unchanged. All money is an integer of minor units.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `payables` | `{ total_minor }` | Σ `payable.total_minor`. The bills are F3's own (`books-cashflow.datedSide('out')`: undisputed, net of cheques written), so this IS the cash view's outgoing dues (`tests/books-payables.test.cjs` holds them equal). |
| `parties[].payable` | `{ total_minor, buckets, msme, msme_risk, msme_words, pay_by, group, terms, early, bills[] }` or null | One supplier's open bills. `buckets` `{ 0_30, 31_45, 46_60, 60_plus }` by the bill's age from its own date. `msme`: the supplier has a `UDYAM` id in `party_tax_id` AND the shop's pack carries `checks.msme` (India; a fallback pack never). `group`: `msme` (a bill at risk) · `overdue` · `week` (due in 7 days) · `later`. `pay_by`: the earliest of each bill's day 45 / due date. `terms`: `{ credit_days, early }` — the supplier's OWN (`supplier_list`, b298); the shop default is not a supplier's offer. `early`: the best valid offer (a bill's `early` + `ref`) or null. |
| `payable.bills[]` | `{ ref, date, due_date, open_minor, age_days, bucket, overdue, msme_day45, msme_days_left, msme_risk, msme_words, early }` | `msme_day45` = bill date + `limit_days` from `CBReceivables.msmeFlags` (min(agreed days, 45)); `msme_risk` = 7 days or less left (or past). `msme_words`: "Pay by 16 Oct 2026 — after that this bill cannot be claimed as an expense this year (Income-tax s.43B(h))." / "Day 45 was … — this bill is an expense only in the year you pay it …". |
| `bills[].note` | string or null | Source (R106, 2026-10-24): the bill's own `party_item.note` (the row where `ref = against_ref`), written ONCE by `postEntry` → `itemsFor` from the event's `note` — a receipt accepted short writes "₹250 short against their ₹2,940"; a hand-raised debit note writes "Rate difference, noted" on its own credit row (not on the bill). Read by: the Payables row and the Bills-received row (`books-payables.withNotes`). Never derived from the narration. |
| `bills[].disputed` · `bills[].held_words` | `true` + "Held — in dispute with you" — present ONLY on a held bill | Derived (R106, 2026-10-24): books-cashflow.datedSide `uncounted.disputed_bills` → books-payables.addHeld. The held bill is LISTED so Release has a row, but is in NO total, bucket, group or pay_by (C4: what-you-owe and cash do not move). Read by: Payables (Release). |
| `POST /api/books/parties/:id/dispute` → `words` · `against_ref` | `words`: `Held — in dispute with you` (disputed) · `Released — payable again` (undisputed) | Derived (R106): the books' ONE word for a held bill, from `routes/books.js STATUS_WORDS` by the status written (`party_status`, engine ITEM_STATUSES disputed / undisputed — there is no `held`). "Hold this bill" on ANY supplier (local or on the rail) calls this route with `side: 'supplier'`; the screen paints `words`, never its own. Absent when the ledger is off. |
| `POST /api/books/events` kind `debit_note` | `{ supplier (uuid), against_ref, lines[{ name, qty, unit_price, gst_rate }], reason: rate · returned · other, supplier_gstin?, my_gstin?, place_of_supply?, date?, narration?, client_ref (REQUIRED) }` | Source (R106 decision 4): `books-manual.BUILD.debit_note` → the engine's own `purchase_return` (Dr the supplier · Cr purchase returns per rate · Cr input tax back), set against the bill by `postEntry` → `confirmItems`; `source_ref` `ev:debit_note:<client_ref>` so a second tap answers the first entry. Raised only against money BOOKED (OPS-60): a short delivery is noted on the bill, never a debit note. Read by: the Payables row's "Note a rate difference" (web PR 2). |
| `bills[].early` | `{ pct, within_days, by, valid, save_minor, pay_minor, words, record, gst_note }` or null | `CBReceivables.earlyDiscount` on the open amount. `by` = bill date + within_days. `words`: "2% off if paid by 15 Oct 2026 — saves ₹600" / "Early-pay ended on 30 Sep 2026". `record` (valid only): `{ ok: true, body }` — the READY owner journal for POST /entries (Dr creditors · the supplier, against the bill · Cr `discount_received`, `client_ref` `early:<ref>`) — or `{ ok: false, why: 'no_ledger', say }`. `gst_note`: always `{ ok: false, why: 'owner_confirms', say }` — the supplier issues the credit note; the owner confirms it; nothing posts it here. |
| POST /entries body `against_ref` | string or absent | The bill a journal's party line settles (`books.itemsFor` → `CBReceivables.confirmItems`, as a write-off). Refused by the engine (disputed, already settled) → left on account, said in `note`. |

## Leads from a CSV · POST /api/crm/leads/import (CB CRM L3, 2026-10-12)

The browser parses the file and sends `rows` (≤ 500; more → 400 `TOO_MANY` "Import up to 500 leads at a time. Split the file."). No file reaches the server, no second contact list: a new row is the SAME party as Add lead makes (local-identity.mintMany · customer_list added_via 'lead' · memberships.addMany, the one writer). `lib/crm-leads.js`; who may: the owner or an editor-level login (lib/access.canEdit) — 403 `VIEW_ONLY` in words otherwise.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| body `rows[]` | `{ name, phone?, email?, business?, city?, source?, note? }` | Source: the CSV, after the Import sheet's column mapping (web cap-crm-leads.js). `phone` → rewards.holderOf (the one helper) → `identities.otp_contact` of the minted party; `business` → `customer_list.legal_name` (b274, when the column is there); `city` → `identities.city` (when there); `email` · `source` · `note` → ONE `party_interaction` note "Imported from …. Email …. …" (b276, when there) — never `identities.email` (a minted party has no account). |
| body `dry` | boolean | true = the plan only (the preview): the one SELECT, nothing written, 200. Absent/false = the import, 201. |
| `added` · `merged` | numbers | Derived by the server, once. `added` = new parties minted and listed; `merged` = parties the shop already had (same phone digits, or the same minted name) with no trade behind them, now leads: `customer_list.added_via` → 'lead' + a `lead` stage row. Read by the outcome card (large numbers). |
| `skipped[]` | `{ row, name, phone, why }` | `row` = the file's row number (1-based). `why` ∈ No name · That looks like an email · Phone does not look right · Name too long · Same phone as row N · Same name as row N · Already a customer · Already a lead · Already a supplier. Read by the outcome card and its "Download skipped" CSV. |
| `rows[]` | `{ row, name, phone, outcome, why, party_id }` | Every row's verdict: `outcome` ∈ add · merge · skip. The preview list paints this — it computes nothing. `party_id` = the matched party (merge/skip) or, after the import, the new one. |
| `identities` set-based insert | mintMany | The same columns and constants as mint(); handles `~<shop>.cus-NNNN` numbered after the shop's top number, ONE insert. |
| `books_counter` block | nextNo(…, count) | One move of the 'P' series by `count`; party numbers `P-NNNNN` assigned in that order (party-fields.ensureNos). |

## GET · PUT /api/governance/country-setup (CS2 · the constitution, the zone, the countries offered — 2026-10-13)

`lib/country-setup.js`. Owner only on PUT. Every key below is beside CS1's (`country · currency · fy_start_month · tax · timezone · source · pack · done · required`), none of which changes shape.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `constituted` | boolean (null on the gate's cached read) | Derived, once per read: `isConstituted(h, entity)` — ONE EXISTS over `catalogue_items` · `chit_header` · `journal_entry` (the last only once b273 exists, `schema.hasTable`). true = the shop holds a product or a transaction, so country and money are FIXED. Written by nobody. Read by the Country setup step (greys Country and Money with the reason) and by `save()` (the refusal). |
| `constituted_by` | `{ products, chits, entries }` booleans | The same read, per table — what fixed it; the refusal names it ("already has products"). |
| `zones` | `string[]` IANA names | The current pack's `timeZones` (engines v1.42.0; [] for a pack-less country or an older pack). One → the step sets it silently; several → the step ASKS, the browser's zone preselected when it is one of them. |
| `countries[]` | `[{ code, name, currency, fy_start_month, zones, locale, books }]` | `regulation.list()` — EXACTLY the registered packs (CS1's rule), whatever the browser's locale; `name` = Intl's region name (`nameOf`), `locale` = the pack's `locale.format` tag. The step's country picker reads this; CBLocale.REGIONS is only the offline fallback. |
| body `timezone` (PUT) | IANA name or absent | What the owner picked of `zones` (a multi-zone country). Validated by constructing an Intl formatter (an unknown zone → 400 in words, never stored). Written to `identities.timezone` (b176) — the ONE home M210 `books-hooks.dayOf` reads. A single-zone pack sets it from the pack whatever the body says. 400 `COUNTRY_SETUP_ZONE` names the zones when a multi-zone country is saved without one. |
| `rederived` (PUT, only when the country changed) | `{ from, to, chart, by, at }` | The country was CORRECTED before the shop was constituted: `derive()` set currency · fy · scheme · zone from the new pack; `chart` = ledgers seeded fresh by `books.reseedUnposted` (0 when no ledger row exists). `by` = the owner's identity id, `at` = now. The change is also logged to `books_change_log` (entity_governance · country / currency / timezone / fy_start_month) when the ledger tables exist. |
| 409 `COUNTRY_CHANGE_IS_NEW_ENTITY` | `{ code, error, message }` | After constitution, a different country OR a different currency: "This shop is set up for <country> and <money> and already has <products / chits / books entries> — country and money never change. Register a new business for <country>." No conversion path exists (DECISIONS 2026-10-03). |
| `source` (FX-AU1, 2026-10-14 — no new key, a new WRITER) | `{ country?, currency?, timezone?, fy_start_month?, tax? }` words | `entity_governance.setup_source` (b299). Now ALSO written at registration (`routes/entities.registerNew` → `CS.noteGuess`, only while `country_setup_at` is null) from the browser guess the governance panel showed — the words are the SERVER's (`CS.guessOf`): country "your time zone" only when the zone sent names it (govcontext ZONES), else "the language your browser reports"; currency "the usual currency in <country>" when it is that pack's money; zone "your device clock". The step's save overwrites it with the owner's answers. A registration with no guess stores none — `identities.country` is NULL (no column default since b376, GOV-AU1) and Country setup asks — never labelled "your registration". Read by the Country setup step (`cap-country.js` csuPrefill). |
| `rederived` re-seed (FX-AU1) | — | `books.reseedUnposted` now re-lays the year when its DATES are not the new pack's (IN and AU both name Oct 2026 "2026-27"), and is no longer in a swallowing savepoint: a failed re-seed fails the correction. `GET /api/books/accounts` no longer lists PARKED rows (`active` false — the old country's ledgers the new pack did not lay over; kept in the table, no DELETE grant b272). |

## Move in from Xero / QuickBooks · `ledger_account.source_code` · POST /api/books/move-in/{preflight,preview,import} (IM1, 2026-10-12 · migration b302, a FILE — Athi runs it)

The importer (`lib/move-in.js`) computes no money and no tax of its own: amounts go through `money.round` into minor units, a tax code becomes a rate only through the pack's `supplyKinds` (engines reg-au `moveIn`, v1.38.1), the opening entry is `lib/books postOpening` (the same door as POST /opening), a ledger is `addAccount`, a party is `local-identity.mint` + `party-fields.patch`, a product is `catalogue-write.writeItems`.

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `ledger_account.source_code` | **b302** | source: the code the ledger had in Xero (`*Code`) / QuickBooks (`Account number`), ≤ 20 chars, NULL on every ledger not moved in. OUR code stays the system's 4 digits. One per shop (partial unique index): a second claim is a code clash, refused in words. | `POST /api/books/accounts { source_code }` (widened) · the move-in `accounts` import (add: `insertAccount`; merge: `setSourceCode`) | `GET /api/books/accounts` (`accounts[].source_code`, present once b302 ran) · the `trial_balance` and `open_bills` imports (their code → our ledger) |
| `accounts[].source_code` · POST /accounts → `account.source_code` · `account.source_code_written` | — | derived from the column; `source_code_written: false` before b302 (nothing kept, said) | — | the Shop ledgers screen; the move-in outcome |
| preflight → `fields[]` · `guess[]` · `missing[]` · `ready` · `rows_total` · `sample[]` | — | derived (`move-in.guess`): per header `{ incoming, field \| null, how: known · exact · synonym · fuzzy · contains · unmatched, confidence, why }`. `ready` false whenever a person still has to confirm a similarity guess or a required column is missing. `sample[]` = the first 5 rows keyed by the file's headers (free-form). | nobody | the Columns step |
| preview → `counts { add, merge, skip }` · `rows[] { line, what, action, why, data }` · `refusal` · `notes[]` (+ `totals`, `control` on a trial balance) | — | derived, PURE (`move-in.plan`): the dry run. `data` is the planned write, keys by kind (free-form). `refusal` = the sentence that stops the whole file (an unbalanced trial balance) or null. | nobody | the Preview step |
| import → `added` · `merged` · `skipped` · `rows[] { line, what, why }` (the skipped) · `notes[]` · `entry { entry_no, entry_id, posting_date, suspense_minor, duplicate }` (trial balance · open bills) · `source_code_written` (accounts) | — | derived from what was written in ONE transaction; a refusal writes nothing (422). `entry.duplicate` = the file was already moved in (`client_ref` `movein:<tb\|receivable\|payable>:<as_at>`). | the import route | the Done step (the skipped rows download as .csv) |
| `party_tax_id.scheme = 'ABN'` | — (b274's table) | source: the Australian Business Number, 11 digits, checked by engines reg-au `abn.check` (modulus 89) in `party-fields.cleanTaxIds`; a wrong one is refused with that check's sentence | `PATCH /relationships/{customers,suppliers}/:id { tax_ids }` · the move-in `contacts` import | the party record · the `contacts` import's dedupe |
| `customer_list.added_via` / `supplier_list.added_via = 'move_in'` | — | source: how the party arrived (beside `manual`, `lead`) | the `contacts` import | the CRM list (reads through `to_jsonb`) |
| `item_data.cost.source` ∈ `xero` · `qbo` | — | source: `item-cost.SOURCES` widened; a purchase price moved in with the items file | the `items` import (`item-cost.setCost`) | Offer Lab (the only reader of cost) |
| `item_data.source_system` · `source_ref` | — | source: the connector kit's own stamps (`core.js syncProducts` shape): `xero` / `qbo` and their item code | the `items` import | nobody yet (the kit's receipts) |

### Move in W1 · the country gate, holds and the match proof (2026-10-18 · MOVE-IN-GAPS-REQUIREMENT W1 · migrations b765, b766 — FILES, Athi runs them)

The gate is `lib/move-in-gate.js` (engines `country.moveInFor` + `country.fingerprint`, v1.67.0): the SHOP's country (`books_setting.country`) and ITS pack's `moveIn` map only — never `accounts-packs` (which falls back to India). The proof is `lib/move-in-proof.js` (no money of its own: the plan's minor units, and their value against ours to SHOW a rounding).

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| body `source_country` (preview · import) | — | source: the two-letter country the OWNER states the file is from (W1.1b, DECISIONS:70). Blank → 422 `MOVE_IN_COUNTRY_UNSTATED`; a word ("Australia") → `MOVE_IN_COUNTRY_WORD` (W2.3 will read words); ≠ the shop's → `MOVE_IN_COUNTRY`. A connected source passes the country its company record says (`country_how: 'read'`: QBO `CompanyInfo.Country`, Xero `Organisation.CountryCode`). | the Move-in screen (web, to build) · tools/sandbox/load.cjs | `move-in-gate.gate` · the proof |
| body `source_company` | — | source: THEIR company id when known (QBO realmId · Xero OrganisationID · Zoho organization_id), ≤ 80. A different one already moved in for this shop and system → 422 `MOVE_IN_COMPANY` (W1.4; nothing to compare before b765). | the caller | `move-in-gate.company` · `move_in_import.company_id` |
| 422 codes `MOVE_IN_COUNTRY` · `MOVE_IN_COUNTRY_UNSTATED` · `MOVE_IN_COUNTRY_WORD` · `MOVE_IN_FOREIGN` · `MOVE_IN_COMPANY` | — | derived: the whole import refused before a row is read (0 planned, 0 written), `{ code, error, message }`. `MOVE_IN_COUNTRY` also: the shop has no pack, or its pack has no move-in map (US · IN today). `MOVE_IN_FOREIGN`: a tax code only another pack's map knows, or a tax ID only another pack's check passes. | `move-in-gate` | the screen branches on `code`, never the sentence |
| plan `action: 'hold'` + row `code` ∈ `tax_code` · `unit` · `bill_key` (· `country` · `rounding` reserved) | — | derived: a row that does not match is HELD — written nowhere, counted, listed with its code and sentence. `tax_code`: a code the shop's pack does not know (item sales tax, a document's line code). `unit`: their unit is not one of ours (lib/units). `bill_key`: that party's bill with that reference is already open in the books. `rounding` has no trigger at the file door (their files carry totals only; a sub-minor difference is SHOWN, never held — DECISIONS:65). | `move-in.plan` | preview / import `rows[]` · the proof `held[]` |
| preview → `counts { add, merge, skip, hold }` · `country { shop, source, how }` · `company_id` · `tax_codes[] { code, verdict: maps · no_tax · held, kind, rate }` (accounts · items · open_bills) | — | derived (pure plan) | — | the Preview step |
| import → `held` · `rows[].code` · `proof` · `proof_stored` · `import_id` | — | derived: `proof` = `move-in-proof.build` (below); `proof_stored` false before b765 (said in `notes`) | the import route | the Done step |
| import → `item_ids` (items only) | — | derived: the catalogue rows the move-in wrote; `move-in.afterCommit` meters them (catalogue.item) only after the transaction commits — a refused or rolled-back move-in meters nothing (`catalogue-write.meterItems`) | `move-in.applyItems_` | the import route (after commit) |
| `move_in_import` (table) · `import_id · source · company_id · source_country · country_how (stated · read) · kind · side · as_at · counts { added, merged, skipped, held } · proof · created_by · created_at` | **b765** | source: one row per import (one file, one kind) on the import's own transaction; insert-only (SELECT, INSERT for cb_app; RLS entity). | `move-in-proof.store` (via `move-in.apply`) | `GET /api/books/move-in/imports` (latest 20) · `move-in-proof.companies` (W1.4) |
| `proof { source, source_country, country_how, shop_country, company_id, kind, side, as_at, currency, counts, landed, held[] { line, what, code, why }, documents[] { line, what, action, code, why, bill_ref, ref_given, party_id, ours_minor (Dr +), rounded }, parties[] { party_id, documents, net_minor }, accounts[] { line, what, action, our_code, their_code, dr_minor, cr_minor }, tax_codes[], contacts[] { line, what, action, source_ref }, differences }` | b765 (`proof`) | derived: `rounded` = their value − ours, as a decimal string ("0.004"), null when none; `differences` = skipped + held (0 = everything that belongs landed). | `move-in-proof.build` | the import reply · `move_in_import.proof` |
| `customer_list.source_system` · `source_ref` · `supplier_list.source_system` · `source_ref` | **b766** | source: THEIR contact id (Xero ContactID · QBO Customer/Vendor Id) with its system — the same pair a moved-in product carries (C11, no new key name). One party per (shop, system, id): partial unique index; a second claim is kept off and logged. NULL when not moved in. | the move-in `contacts` import (add: on the new list row; merge: when the party has none) | the `contacts` and `open_bills` imports (their id first, then the name) |
| contacts column `source_ref` · open_bills columns `contact_ref` · `tax_codes` (`;`-separated) · items column `unit` | — | source: file columns (KINDS) | the person's file / the sandbox lanes | `move-in.plan` |
| open_bills `data.bill_ref` · `data.ref_given` | — | derived (X-1, W1.5): the bill's key is (party, reference). A reference two parties share (in the file, or already held by another party) is kept as `<ref> · <party no>`; no reference → `MI-<line> · <party no>`. `ref_given` = what their file said (null when blank). | `move-in.plan` | `books.postOpening` (the party item's ref) · the proof |
| `party_tax_id.scheme` = the PACK's tax-ID word (W1.3) | — (b274) | source: `country.taxId(pack).word` (ABN for AU) and its check `country.taxId(pack).check` — no longer reg-au `abn.check` by name. A pack with no check (India: GSTIN) keeps the value as typed; party-fields checks the scheme at the write. | the move-in `contacts` import | as before |
| `item_data.unit` from a move-in | — | source: their unit through `lib/units unitOf` (kgs → kg); blank → `unit` (their file has none); unknown → the item is HELD (`unit`) | the `items` import | the catalogue |

## Parallel run · `books_compare_part` · GET /api/books/compare · /compare/:id(/csv) · POST /compare/{preflight,snapshots} (PR1, 2026-10-13 · migration b309, a FILE — Athi runs it)

Their figures are kept as read and NEVER posted; ours come from the engines (trialBalance · profitAndLoss · balanceSheet · taxReturn · the rail's gstr3b). `lib/parallel-run.js` subtracts two minor-unit integers per line and names the reason — it computes no balance or tax. Who may: the owner, or the shop's auditor (whole entity + may see money); others 403 with the sentence.

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `books_compare_part` (snapshot_id · label · source · part · period_from · period_to · currency · file_name · rows · created_by) | **b309** | source: their period as read from a Tally / Xero / QBO export, one row per snapshot part (`tb` · `pl` · `bs` · `ret`); `rows[] { line, name, code, group, side, dr_minor, cr_minor, amount_minor, tax_minor }` in minor units of `currency`. Insert-only (no UPDATE / DELETE grant). | POST /compare/snapshots (`books-store.insertComparePart`) | GET /compare (`compareSnapshots`) · GET /compare/:id (`compareParts`) |
| GET /compare → `ready` · `why` · `may.load { may, why }` · `parts[] { part, label }` · `sources[] { source, label }` · `snapshots[] { snapshot_id, label, source, period_from, period_to, currency, parts[], lines, created_at }` | — | derived: `ready` = b309 exists (`schema.hasTable`); `may.load` is the server's answer the screen greys with | the route | CB Accounts › Parallel run (`cap-compare.js`) |
| preflight → `format` (`table` · `tally_xml`) + move-in's `headers · fields · guess · missing · ready · rows_total · sample` | — | derived: a table goes through move-in's matcher with this import's columns (`parallel-run.KINDS`); a Tally XML is read at once | the route | the Columns step |
| GET /compare/:id → `snapshot { snapshot_id, label, source, source_word, period_from, period_to, parts[] }` · `parts.{tb,pl,bs,ret} { part, title, from, to, file_name, source, lines[], counts { equal, different, gap, only_ours }, error, note, form }` | — | derived, PURE (`parallel-run.compare`); `error` = ours could not be read for that part (in words) | the route | the compare list |
| `lines[] { key, total?, status (equal · different · gap · only_ours), name, their_name, their_code, their_line, our_codes[], theirs_minor, ours_minor, diff_minor (ours − theirs), cause (rounding · rail_later · only_ours_entry · only_theirs · unexplained · mapping · total · box), why, entries[] { entry_id, entry_no, date, amount_minor, chit_id, ref, kind, rail }, entries_n, open { code, from, to } }` | — | derived: the map is move-in's chartIndex (their code → `source_code`, name, control role) + our group names + `tally_group`; their ledgers whose group maps are pooled per group. Trial-balance sign Dr +; P&L / balance sheet as printed. `entries[]` (≤ 5) are OUR entries behind the line, the matched ones first | the route | each row's next level; `open` opens the Ledgers view on that ledger for the period |
| `effort { from, to, entries, structured, keyed, by_kind {} }` | — | derived: the period's entries — structured = brought by a chit on the rail or a counter's day; keyed = typed here. PR2's hook (the trail) | the route | the compare's foot line |

## /api/repeat (REPEAT SUPPLY as an agreement both parties hold, RI1 2026-10-12)

Written by `lib/repeat-supply.js` (the table `repeat_supply`, b303 DRAFT); read by CB Finance › Repeat supply (`app/cap-repeat.js`) and the chit sheet. The agreement itself is a chit (purpose `subscription`): its lines, price and `summary_json.money` are the send path's own — nothing here computes money.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `agreements[]` · `agreement` | one row per agreement | Stored (`repeat_supply`): `agreement_id` · `chit_id` (the agreement chit) · `customer_entity_id` · `source_chit_id` (the invoice "Repeat this…" was pressed on) · `every` · `unit` (`daily` · `weekly` · `monthly`) · `anchor_day` · `next_on` · `end_on` · `runs_max` · `runs_done` · `mode` (`draft` · `send`) · `state` (`proposed` · `agreed` · `countered` · `declined` · `paused` · `ended`) · `terms` · `counter` · `skips[]` · `runs` · `last_run_on` · `state_by` · `state_at` · `state_note`. |
| `customer` · `money` · `currency` · `subject` | `{ entity_id, name }` · the chit's `summary_json.money` · string | Derived: READ off the agreement chit's header (one join) — the customer's name from `all_recipients`, the per-run money as the chit was frozen with. |
| `side` · `actions` · `words` · `due` | `seller` · `customer` · `{ <verb>: { ok } \| { ok:false, why, say } }` · string · boolean | Derived per caller (`may()`): the agreement's own step table. seller: pause · resume · end · skip · run · agree · refuse; customer: accept · counter · decline · skip. `why` ∈ `WHY` (not_seller · not_customer · ended · wrong_state · not_due · reason_needed); `say` is the sentence a screen greys the button with. |
| `terms.lines[]` | `{ line_id, quantity }` | The AGREED quantities over the chit's lines (a counter the seller agreed to). A run carries them; a changed line's frozen figures are dropped so the send path prices it. |
| `counter` | `{ lines?, every?, unit?, anchor_day?, start_on?, note, by, at }` or null | The customer's open proposal; cleared by agree · refuse · accept · decline. |
| `runs` · `skips[]` | `{ 'YYYY-MM-DD': chit_id }` · `{ date, by_entity_id, reason, at }` | Which day minted which invoice (client_ref `rep:<agreement_id>:<date>` — one chit per day, ever); the days let pass and why. |
| `migrated` (list) | boolean | false until b303 runs; the tab then says "Repeat supply arrives after the next update". |
| `ran[]` · `problems[]` (run · sweep) | `{ date, chit_id, duplicate }` · `{ agreement_id, date, why }` | What this press minted (a day already minted answers `duplicate: true`); a run the send path refused, named with its reason — the row stays put. |
| 503 `REPEAT_NOT_MIGRATED` · 422 `REPEAT_<WHY>` · 403 `{ why }` | `{ code, message }` | Before b303 · the step table's refusal in words · the rail engine's own level/copy refusal (read_only · comment_only · not_participant). |
| chit `business_json.repeat` | `{ agreement_id, every, unit, anchor_day, start_on, until: { runs, on }, mode, source_chit_id }` | Stamped on the agreement chit at send (both copies) — how a holder finds the agreement; the schedule as PROPOSED (the row is what it became). |
| chit `business_json.repeat_of` · `repeat_chit_id` · `repeat_run` | agreement_id · the agreement chit · `YYYY-MM-DD` | Stamped on each run's invoice: which agreement and which day minted it. |

## HX1 hosting keys (2026-10-13 · docs/HOSTING.md)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| table `schema_migrations` (b304, DRAFT — Athi runs it) | `filename text PK · sha256 text · applied_at timestamptz · applied_by text · source 'migrate'\|'recorded'\|'manual'` | Source. Written by `tools/migrate.cjs` (apply = `migrate`, `--record` = `recorded`) or the owner's INSERT (`manual`). Read by `tools/migrate.cjs` (`--status`, skip what is done). RLS on, no policy, no grant to cb_app. |
| `GET /health` → `web` | string or null | Derived from env `PUBLIC_WEB_BASE` (`lib/public-base.webBase`). Written by: nobody. Read by the counter program (`till.js`) when its `connector.json` has no `web`. |
| kit `connector.json` → `web` | string or null | Written by `GET /api/integrations/download/:id`: `PUBLIC_WEB_BASE`, else the requesting page's `Origin`. Read by `till.js` → `/config.js` `window.CB_WEB` → till.html `cbHome()`. |
| web `/config.js` → `window.CB_API` · `window.CB_WEB` | string · string or null | The web's `public/config.js` (committed value; the container writes it from `CB_API_BASE`) or `till.js` (from `connector.json`). Read by every page's api-base resolution (`CBShell.apiBase`, app.html `STAGES.dev.base`, stand-alone pages, till.html `CloudHost.api`). |

## `identities.ui_prefs.edition` · PATCH /api/entities/me/prefs/ui (AX1, 2026-10-13)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `ui_prefs.edition` | slug (`full` · `auditor` · …, `^[a-z][a-z0-9-]{0,23}$`) | Source: the person's choice in the avatar menu's Edition group (web `public/app/avatar.js`, `CBAvatar.set('edition')`), sent with theme · fs · motion · stripes (the set is REPLACED, so every key rides every push). Read by web `public/app/edition.js` (CBEdition) to pick which manifest entries Home draws; the list of editions is the web manifest's `editions` map. HIDES doors only — no route reads it for access. Absent = `full`. No migration (ui_prefs is jsonb, b166). |
## GET /api/books/bank/rail (BR1, 2026-10-13 · the rail leg of the bank reconciliation the DEVICE runs)

The statement never reaches the server. The page asks only for what the other party already TOLD us. `lib/books-store.js bankRailChits` does ONE bounded read of my copies. The engine (`bank-recon railPayments · explain`, engines v1.44.0) matches them on the device. No money is computed here.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `rail_chits[]` | `{ chit_id, direction, status, created_at, party: { id, name }, business_json: { kind, currency, payment_advice? \| bank_query? }, line_items: [{ ref_chit_id, bill_no, applied_minor }] }` | Source: my chit copies with `business_json.kind` `payment_advice` (M30, written by `adviceBody`) or `bank_query`, created within [from − 10 d, to + 10 d], not drafts, not deleted. `party` is the sender on a received copy, else the first recipient that is not me. Read by web `cap-bank.js` → `CBBankRecon.railPayments / explain`. Named `rail_chits`, not `chits`: the web's `api()` collapses a `chits` array (core.js `unwrap`). |
| `parties[]` | `{ party_id, name }` | Derived: `books-store parties()` filtered to `on_rail` (who may be ASKED on the rail). Read by the Ask picker. |
| `may.ask` | `{ ok }` or `{ ok: false, why, say }` | Derived: `lib/rail byLevel(level, 'ask')`. A viewer gets `read_only` and a commenter `comment_only`, with the rail's sentence. `POST /api/chits/send` decides again. Read by the Ask button (greyed with `say`). |
| `me` | string | The shop's name, the same one `meName` gives the advice. The ask's words name it. |

### New chit kind `business_json.kind = 'bank_query'` (BR1)

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `business_json.bank_query` `{ key, side, amount_minor, currency, date, ref, words }` | — (no migration; a chit's own JSON) | Derived on the device by `CBBankRecon.ask`. ONLY these facts travel: the date, the amount and the reference (never the narration). `key` = `lineKey` (date · side · amount · ref). `client_ref` = `bankask:<key>` (send dedupes). | web `cap-bank.js` through `POST /api/chits/send` (purpose `general`) | the receiver's thread (a message chit). The asker's `GET /bank/rail` → `explain` opts.asks (state `asked`). The ANSWER is the receiver's ordinary payment advice (M30) carrying the reference, so no new answer shape exists. |
## The person's prefs · `identities.ui_prefs` · `identities.locale_prefs` (CU2, 2026-10-13)

Both columns are written ONLY as an RFC 7386 merge-patch (`MERGE_PATCH_SQL`, routes/entities.js): a key not sent is untouched, a key sent as `null` (or `''` on /me/prefs) is removed, nothing replaces the whole store (`tests/prefs-merge.test.cjs`). Doors: `PATCH /api/entities/me/prefs/ui` · `/me/prefs/locale` · legacy `PATCH /me/locale` (all `savePrefSet`, whitelisted keys, the caller's own row) · `PATCH /api/entities/profile` body `ui_prefs` (the business row). Read back on `GET /api/entities/me` (`ui_prefs`, `locale_prefs`, `{}` when never chosen). Absent key = the default. Layer: the person (U), not governed (no GOV class) — except `product_rows`.

| Key | Shape | Source · who writes it · who reads it |
|---|---|---|
| `ui_prefs.theme` | slug, e.g. `light` · `dark` · `device` | Source. avatar.js `push` (app, CB Accounts, till's avatar menu) via CBPrefs → /me/prefs/ui. Read by avatar.js `hydrate`, app.html `appearanceHydrate`. |
| `ui_prefs.fs` | `s` · `m` · `l` · `xl` | Source. Text size; same writer and readers as `theme`. |
| `ui_prefs.motion` | `auto` · `reduce` · `full` | Source. Same writer and readers. |
| `ui_prefs.stripes` | `off` · `light` · `strong` | Source. Row stripes; same writer and readers. |
| `ui_prefs.font` | `default` · `grotesk` · `serif` · `wide` · `mono` | Source (CU3 — was device-only `cb_font`). Reading font; same writer and readers as `theme`. Closed list = avatar.js FONTS. |
| `ui_prefs.weight` | `normal` · `bold` | Source (CU3 — was device-only `cb_weight`). Bold text; same writer and readers. |
| `ui_prefs.product_rows` | array of product-page row keys | Source, the BUSINESS's choice (layer E, parked in the U column — to move to a policy flag with CU8's one writer). Written by app.html `prodRowsSave` → PATCH /profile `{ ui_prefs: { product_rows } }` (the patch only). Read by app.html `prodRowsPref`. Not writable through /me/prefs/ui. |
| device `cb_prefs_pending` (localStorage, web only — never sent) | `{ kind: value }`, kind ∈ theme · fs · motion · stripes · edition · font · weight | Source (FX-UX2, 2026-10-14): written by web `public/app/avatar.js` `set()` (the person's choice on THIS device, not yet on the server); a kind is removed when a push to `/me/prefs/ui` answers `ok:true` with that value (`{pending:true}` before b166, `{queued:true}` offline do not count), or when `GET /me` already holds it. Read by avatar.js `hydrate`: the server's ui_prefs is the truth — a kind ABSENT on the server resets the device to its default UNLESS it is pending here (then it is kept and pushed again). Layer: the person (U), not governed; no column, no migration. |
| `locale_prefs.lang` · `.locale` | BCP 47 tag | Source. CBLocale.push → /me/prefs/locale. Read by CBLocale.hydrate. ICU checks the combination. |
| `locale_prefs.langs` | up to 3 tags, comma-separated (RFC 4647 priority list) | Source. Same writer / reader. |
| `locale_prefs.region` | region subtag | Source. Same writer / reader. |
| `locale_prefs.nu` · `.hc` · `.ca` · `.fw` | UTS #35 keyword values | Source. Numbering system · hour cycle · calendar · first weekday. Same writer / reader. |
| `locale_prefs.tz` | IANA zone, e.g. `Asia/Kolkata` | Source (CU3 — sent and dropped before). The PERSON's reading zone; absent = the device's. Same writer / reader; ICU checks it. Not the shop's `identities.timezone` (which a bill uses is not ruled yet — audit row 38). |
| `locale_prefs.workdays` | ISO weekdays, comma-separated, e.g. `1,2,3,4,5,6` (1 = Monday) | Source (CU3 — sent and dropped before). Override of CLDR's week; absent = the region's. Same writer / reader (CBLocale.workdays · isWorkday). |
| `locale_prefs.langs_seen` | array of ≤ 3 tags | Source. The browser's languages at sign-up (routes/signin.js, one-key merge). Read by nobody yet. Kept by every locale save since CU2 (the old whole-column save erased it). |
## GET /api/catalogue/:bridge_id (the storefront, WX-O2C 2026-10-13)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `shop.price_includes_tax` | boolean | Source: the shop's policy flag `price_includes_tax` (lib/policy, default yes), read in `lib/catalogue-view.js` beside `unit_rules`. Written by: the owner (Profile › policy). Read by: `shop.html` → `CBCart.money({ priceIncludesTax })` so the basket's GST rows are split out of the price, never added on top (the server prices the order with `tax-lines.invoiceFor` the same way). |

## GET /api/catalogue/:bridge_id/my-orders (the shopper's own orders, WX-O2C 2026-10-13)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `orders[].shop_status` | rail status string or absent | Derived: the OTHER participant's (the shop's) `chit_status.current_status`, read through `chit_participants` (b50) in the same statement; absent before b50. The shopper's own `current_status` stays the rail's `delivered` (it reached the shop). Written by: the shop's status moves. Read by: `shop.html` My orders → `shopStatusWord(shop_status \|\| current_status)` (CBWorkflow.stageOf). |
## The storefront's `shop` block · GET /api/c/:handle and every caller of `catalogue-view.buildPublicView` (CX4 · S1/S2, 2026-10-13)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `shop.country` | ISO-3166 alpha-2 or null | Source: `identities.country`, read on the SAME row as `storefront_access · policy_flags` (no extra trip). Written by registration / Country setup. Read by shop.html (what the page knows of its country). |
| `shop.tax_id_word` | `GSTIN` · `ABN` · `TRN` | Derived: `profile.taxIdWordOf(country)` — the pack's own tax id (reg-au `abn`, reg-ae `trn`), `GSTIN` for India and for no pack. Written by nobody. Read by shop.html for the label beside `gstn` (the generic registration column). |
| `shop.upi_id` (changed) | string or null | Unchanged source (`profile.upiOf(policy_flags)`); now null when the shop's pack has no UPI mode (`pack.chart.paymentModes.upi`) — the storefront's "Pay by UPI" block is not drawn for an AU / AE shop. |

## STD2 · one reading per fact, no India for an unstated country (2026-10-14 · migration b400, a FILE — Athi runs it)

| Key / column | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `shop.tax_id_word` (changed) | `GSTIN` · `ABN` · `TRN` or null | `profile.taxIdWordOf` now answers null for no pack (was `GSTIN`). shop.html paints "Tax number" for null. |
| `GET /api/till/snapshot` · `shop.tax_id_word` (new) | `GSTIN` · `ABN` · `TRN` or null | Derived: `profile.taxIdWordOf(shop country)` — the counter's label for the tax number (was the till's own `taxIdLabel` copy). Written by nobody. Read by till.html `taxIdLabel()`; null → "Tax number". |
| `GET /api/till/snapshot` · `shop.currency` (changed) | ISO-4217 or null | The shop's `identities.currency_code`, else its pack's; neither → null (was `INR`). |
| `GET /api/till/snapshot` · `shop.money_why` (new) | `{ code: 'NO_MONEY', why }` or null | Derived: set only when `shop.currency` is null; `why` = `country-setup.MONEY_UNSTATED` (the one sentence). Read by till.html's shop dialog beside "Money is …". |
| `GET /api/catalogue/:bridge_id` (catalogue-view) · `shop.money_why` (new, T1-ORD) | `{ code: 'NO_MONEY', why }` or null | Derived: set only when `shop.currency_code` is null; `why` = `country-setup.MONEY_UNSTATED`. Read by web app/cart.js (the money block's footnote) through the page's `moneyWhy` option; shop.html passes it. |
| `GET /api/catalogue/:bridge_id/my-orders` · `my-documents` · `total` `page` `limit` (new, T1-ORD) | integers | Derived: the pager contract (DISCIPLINES §2); `limit` capped at 50; `count` stays = the rows on this page. Read by web shop.html shopMyOrders (Show more) and app.html's customer list (PG). |
| `profile.invoiceParty().currency` (changed) | ISO-4217 or null | `identities.currency_code`, else the pack's, else null (was `INR`). |
| books refusal `NO_MONEY` (new code) | 422 `{ code, error, message }` | `books.enable` / `books-store.saveSetting` when neither Country setup nor the pack states the money or the year start (was `INR` / April). The sentence is `country-setup.MONEY_UNSTATED`. |
| `identities.currency_code` · `cb_entity.currency_code` (b400) | varchar(3) or NULL | DEFAULT 'INR' dropped (b400): a money nobody stated is NULL — registration names it (offerOf / acceptAtSignup), Country setup asks for it. Layer: entity, class chosen-then-fixed (fixed once constituted). |

## Pages · GET /api/testing/cases · results · runs · requirements · incidents (T2-PAGING, 2026-10-14 · no migration)

DISCIPLINES §2's list contract on the test board's lists: `?page=` (≥ 1) and `?limit=` clamped by `lib/page-limit.limitOf` to the list's
server max, which is also its default — the size it answered before (cases · results 5000, a case's/run's history 500, runs 50,
requirements · incidents 500). Cut AFTER the order, in SQL (OFFSET). Who may: whoever may read the board — unchanged.

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `total` | integer | derived: rows the query (with its `?state=` / `?project=` / `?all=`) holds — `count(*) OVER ()` of the page read (routes/testing.js `readPage`). ⚠️ On /requirements and /incidents it USED to be every state; every state is now the sum of `counts` | the route | web `CBList.every` (the board reads every page) · PG (`testPgArm`) |
| `page` · `limit` | integers | derived: the page asked (≥ 1) · the limit the SERVER applied | the route | the same |
| /requirements · /incidents `counts` · `open` · `open_by_severity` | integers | derived: one `GROUP BY` over EVERY row (no cut) — before, they counted the 500 newest | the route | the view's filter chips; `Everything` = Σ `counts` (`testCountAll`) |

## F10 / F11 · the counter receipt that carries their bill (2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `GET /api/till/snapshot` · `suppliers[]` | `{ party_id, name, nickname?, state?, party_no? }` | Source: `supplier_list ⋈ identities` (routes/till.js `OWN.suppliers`, in the snapshot's shared transaction). `state` = the GSTIN's first two digits, India only. Names only — never a balance (a counter never reads what the shop pays its suppliers). Written by: nobody (read). Read by: the till's Receive form (`paintSuppliers` · `rcvSupplierKnown`). |
| receipt chit `business_json.party.party_id` | uuid, optional | Source: the supplier the door picked (`rcvSupplierKnown`: exactly one name / nickname match). Written by: till `chitOfDoc` (page and shop PC). Read by: `tax-copy.capturedPartyId` → `partiesFor` (the seller of their bill) · `books-hooks.receiptFacts`. Absent → the typed `party.name` is matched against the supplier list when it posts. |
| receipt chit `line_items[].gst_rate` | number, optional | Source: the GST rate the door recorded from their bill (`rcvLineTax`). Written by: till `chitOfDoc`. Read by: `tax-lines.invoiceFor` (its existing line key) via `tax-copy.entryFor` — their bill is taxed by the one engine. |
| folder rule `their_bill` (`folder-inventory` DOC_RULES) | — | Derived: `purpose = 'receipt'` with `business_json.their_bill.no` AND `.total` → doc `bill_received` (Bills · Received, B-2100). `tax-copy.capturedBill` / `billReceived` make the same test. |
| chit list rows `counterparty_id` · `counterparty_name` · `bill_no` (`lib/select` COLS: folder lists, Unpaid bills, CRM record chits, scorecard, home facts, work rows) | uuid or null · string · string or null | Derived (R124, 2026-10-24): WHO the other side is, by direction — a SELF-ADDRESSED copy (sender = first receiver = the holder) names its `business_json.customer` (a counter sale, WX-O2C) else its `business_json.party` (a paper bill received at the door: `party.party_id` when it is a uuid, `party.name`); a received copy its sender; a sent copy its first receiver. `bill_no` = `business_json.bill_no` (mine) else `their_bill.no` through `folder-inventory.theirNoSql` (theirs; the same spelling `books-store.billNos` uses for the pay sheet, R123). Never `business_json.invoice` — that is the frozen tax invoice. Read by web accounts.html (Supplier / Bill no columns), cap-books pay sheet (`proposal[].bill_no`). Tests: tests/select-received-party.test.cjs, tests/bills-truth.realstack.cjs. |

## Foreign currency · `fx_rate` · `journal_line` txn_currency · fx_rate_source · fx_rate_date · GET/POST /api/books/fx-rates(/import) · GET/POST /api/books/fx-revalue (FX1, 2026-10-14 · migrations b391 + b392, FILES — Athi runs them)

A rate is EVIDENCE the owner types or imports — never fetched, never assumed (`lib/fx-rates.js`). Every figure is CBPosting's (engines v1.45.0: the event's `fx_rate` conversion · `fx_settlement` · `fx_revalue` · `fxRevaluation`); the books stay in ONE functional currency. Who may: anyone who may read the books reads the rates; only the owner adds, imports or revalues (403 with the sentence).

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `fx_rate` (rate_date · from_ccy · to_ccy · rate · source · source_ref · entered_by) | **b391** | source: a rate the owner typed (`manual`), imported from a CSV (`import`), or quoted from the country's official rate (`official`, the pack's `fx.official_name`). Insert-only; the newest row for a day and pair is that day's rate. | POST /fx-rates · /fx-rates/import (`books-store.insertFxRates`) | `fx-rates.rateOn` (composeEntry, revaluation) · GET /fx-rates |
| `journal_line.txn_currency` | **b392** | source: the currency `amount_txn_minor` is in (USD on a USD bill's lines; the functional currency on every other). Null on lines before b392 (= `currency`). | postEntry (`books-store.insertLines`, once the column exists) | `books-store.foreignBalances` (a settlement's carried value · the revaluation · Receivables/Payables) |
| `journal_line.fx_rate_source` · `fx_rate_date` | **b392** | source: the rate's `source` and day as the `fx_rate` row said (`event` when the caller handed `fx_rate` in; `book` on a settlement's party line — the booked rate). | postEntry (`fx-rates.stampLine`) | the auditor, on the entry (Day book) |
| GET /fx-rates → `ready` · `why` · `may.add { may, why }` · `sources[]` · `rule { standard, tax_rate_rule, official_name }` · `rates[] { rate_id, date, from, to, rate, source, source_ref, entered_by, created_at }` | — | derived: `ready` = b391 exists; `rule` is the pack's `fx` (which rate the tax value of a foreign supply uses — never a number) | the route | CB Accounts › Setup › Rates |
| POST /fx-rates/import → `added` · `refused[] { line, why }` · `rates[]` | — | derived: each CSV row checked (date · currency · rate · source?); the good ones in ONE insert | the route | the Rates screen |
| GET /fx-revalue?fiscal_year&period → `ready` · `why` · `may.post` · `date` (the period's last day) · `reverses_on` · `functional` · `rows[] { account, code, party_id, party, txn_currency, rate, rate_date, rate_source, balance_txn_minor, carrying_minor, target_minor, diff_minor }` · `missing[]` · `gain_minor` (+ gain, − loss) · `posted { entry_id, entry_no } \| null` | — | derived, PURE (`posting.fxRevaluation`) over the open foreign debtors/creditors balances at the closing rate (the newest rate on or before the period's last day, within the period) | the route | Month lock › Foreign balances |
| `/dues` → `parties[].foreign[] { currency, balance_minor, carried_minor }` | — | derived: the party's open foreign balance (Dr +, its own minor units) beside what the books carry for it (functional). Present only for a party with one, after b392. | the route (`books-store.foreignBalances`) | Receivables · Payables ("USD 1,000 · ₹83,250") |
| a foreign event's refusal `code: FX_RATE_MISSING` | — | derived: "No USD rate for 14 Oct — add it in Accounts › Rates." — the hooks park it on Waiting with that sentence; it posts on the retry once the rate exists | composeEntry (`fx-rates.forEvent`) | Waiting · the payment sheet |

Limits (said, not hidden): a foreign PAYMENT settles at the party's open foreign balance's average carried rate (the booked rate of each bill when only one is open); one larger than what they owe in that currency is refused (record the extra as an advance). A foreign BANK ledger is not told apart from the shop's own bank yet, so revaluation covers debtors and creditors only.

## Pages · GET /api/books/daybook · /ledger/:account · /api/chits/inbox · /sent (PERF1, 2026-10-14 · migration b406, FILE — Athi runs it)

DISCIPLINES §2's list contract (top-level `total · page · limit`, a server-side maximum) on the books lists, keyset (never OFFSET). The page is
asked with `?limit=1..500` (default 100; `lib/page-limit.limitOf` — the one clamp) and `?after=` (the `next` of the page before); no page asked =
the whole range, exactly as before (the web adopts the pages in PERF2). Who may: whoever may read the books / the list — unchanged.

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `/daybook`, `/ledger/:account` → `total` | — | derived: how many entries [from, to] holds (a ledger: those with a line on it; period 0 left out where the opening holds it) — `books-store.pageSums` | the route, only when a page is asked | the pager (the count it shows) |
| … `page` · `limit` | — | derived: the client's page number echoed · the limit the SERVER applied (≤ 500) | the route | the pager |
| … `next` | — | derived: `YYYY-MM-DD\|ENTRY_NO` of the page's last entry — the next page's `?after=`; null on the last page (`books-store.entryPage` reads one entry more than asked) | the route | the pager |
| … `totals { dr_minor, cr_minor }` | — | derived: Σ Dr · Σ Cr of the whole range (a ledger: its lines; the Day book: every line) — the server's figure, never the loaded rows added up | `pageSums` | the list's footer |
| `/ledger/:account` → `page_opening_minor` | — | derived: the balance BEFORE this page's first line = `opening_minor` + Σ(Dr − Cr) of the range's lines before the cursor (one indexed SUM); `opening_minor` · `closing_minor` stay the RANGE's on every page | the route | the first running balance of a page |
| `/ledger/:account` → `lines[].entry_id · entry_no · event_type · reverses_entry_id · reversed_by` | — | source: the line's journal entry and its reversal — the party statement's M29 line keys, the same shape (`reversed_by` read once per statement, b406) | the route | the web: Reverse from the row (bkCanReverse · bkReverseLine) and the line's journal by `/daybook?entries=` |
| `/daybook?entries=<id>,…` | — | a READ of exactly those entries (≤ 500) — never the range's Day book for one line | — | the Ledger's opened line (cap-books.js bkLgJournal) |
| `/chits/inbox`, `/chits/sent` → `total` | — | derived: the COUNT, on page 1 only; `null` on a later page (app.html pgNext keeps page 1's) | routes/chits.js | the Task / Order pager |
| … `next` | — | derived: `<created_at UTC, µs>\|<chit_id>` of the page's last row — the next page's `?after=` (newest-first order only; another sort keeps `page` + OFFSET); null on a short page | routes/chits.js (`keysetOf` · `afterOf`) | app.html fetchPage |
| … `limit` | — | the server's: ≤ 200 (`LIST_MAX`) — `?limit=1000000` was obeyed before PERF1 | routes/chits.js | the pager |

## T2-POLICY (2026-10-14) · one writer of `identities.policy_flags`; one of the shop's `gstn` · `address`

No SQL, no new stored key. Who WRITES changed; what is stored did not.

| key | shape | source / derived · writer · readers |
|---|---|---|
| `identities.policy_flags` (every key) | jsonb | source. Written ONLY by `lib/policy.js` — `set()` for FLAGS keys, `patchKey(db, entity, path, value, { op })` / `patchSql` for everything else (api_keys · counters · devices · network_* · profile_provenance · storefront_exposure). Guard: tests/policy-one-writer.test.cjs (0 direct writers). Readers unchanged. |
| `FLAGS[key].ui` | `{ order, label, level, gov, help, labels?, options?, scale?, suffix?, step? }` | derived (code, lib/policy.js `CARD`). Not stored. Sent by `GET /api/entities/policy` as `schema[key].ui`; read by the web's Business rules card (cap-admin.js) — its former POLICY_FLAGS copy is gone. |
| `FLAGS[key].may` · `.may_why` | `'owner'` · sentence | derived (code). `system_folders`, `books`. Read by `policy.refusalFor` in `PATCH /api/entities/policy` (403 `OWNER_ONLY`). |
| `bound_schema` (GET /api/entities/policy) | `{ dispute_scope: { type, options, def, ui } }` | derived (code). Read by the card for its locked row. |
| `identities.gstn` · `identities.address` (the shop's own row) | text | source. Written ONLY through `lib/profile.js` `setShopIdentity` / `shopIdentitySql` (PATCH /entities/profile · country setup · the profile sync · a network store's place · the vault save's write-through). The tax number is checked by `profile.taxIdRefusal(country, number)` — the pack `taxIdWordOf` names (GSTIN checksum · ABN · TRN · ≤ 40 for no pack). A party's row (`parent_entity_id`) is the counterparty's, not this. |

## RAIL-LAB-SRV1 (2026-10-14) · the Rail Lab's may/why and the lab chit — `GET /api/facts/rail` · `POST /api/chits/send`

No SQL, no new column. The ONE "is this a lab shop" rule is b249's population axis (`lib/istest.js` `isLab` · `maySample`): a lab shop is a shop whose `identities.population` is not `live`; an unstated population is live (fail safe).

| key | shape | source / derived · writer · readers |
|---|---|---|
| `GET /api/facts/rail` `may_sample` (new) | `{ ok: true }` · `{ ok: false, why: 'live_shop', say }` | derived (code, `lib/istest.maySample` over the population read in `home-facts.railScope` — the overdue_days statement, no extra trip). Always present. Read by the Rail Lab (web, to come): the action shown, greyed with `say`; branches on `why`, never the words. |
| `summary_json.lab` (new rider) | `true` — absent on every other chit | derived from what the sender declares as `business_json.lab: true` (the `is_promotion` path). Written ONLY by routes/chits.js `sendSummary` through `mint.summary` (whitelist `lab`), after `sendLab` proved the shop may. Rides every co-held copy. Readers: the Rail Lab's own list (to come); the CRM / Task lists ignore it today. |
| 409 of `POST /api/chits/send` (new) | `{ error, code: 'LAB_CHIT_LIVE_SHOP', may: false, why: 'live_shop', message }` | derived: `sendLab` — a lab chit declared from a live shop, refused before anything is written (one identities read, only when `lab` is declared). `message` = `istest.LAB_WHY.live_shop`, the same sentence the facts card says. |

## RCM-POST (2026-10-14) · `line_items[].rcm_category` — a line says it is under reverse charge

No SQL, no route. One new line key; the invoice keys it switches on exist since engines v1.20.0 (INV-01 `RcmCd` · `RcmItc` · `RcmCgstAmt/RcmSgstAmt/RcmIgstAmt`, `TranDtls.RegRev`, `_cb.rcm[]`, `moneyOf(inv).rcm`).

| key | shape | source / derived · writer · readers |
|---|---|---|
| `line_items[].rcm_category` | string — the pack's category id (reg-in `rcm.categories[].id`: `gta` · `legal` · `rent_unregistered` · `cashew` …) | source. Written by whoever writes the line (a supplier's send, a captured bill's lines, later a catalogue item that carries it); nothing writes it yet by UI. Read by `lib/tax-lines.invoiceFor` (`rcmCategoryOf` → the engine's `rcm_category`, and `rcm: true` for the bill when any line names one) → `tax.determine` resolves it against the pack (`tax-packs.rcmCategoryFor`) and applies the registration tests. Frozen on `business_json.invoice` as the line's `RcmCd`; the books read `moneyOf(inv).rcm.rows` (books-hooks `rcmOf`), the sheet reads `moneyOf(inv).rcm` (web chit-sheet.js). Tests: tests/rcm-post.test.cjs. |

## Segments & groups · GET /api/crm/segments · POST /api/crm/groups · DELETE /groups/:name · POST /api/crm/segments/:key/send (T3-P2-CRM, 2026-10-14)

No migration: a segment is `lib/customer-groups` SEGMENT_SQL (read by `lib/crm.rows`, b273 for high value); a named group is `customer_list.groups[]` (b205) —
the SAME values an offer's "Only for" stores (`'group:<name>'` · `'<segment>'`). Who may: anyone signed in reads; the owner or an editor writes a group and
sends; the owner deletes. Every figure here is counted from the rows GET /parties answers (one reading); nothing is a second rule.

| Key | Number | Source or derived | Written by | Read by |
|---|---|---|---|---|
| `segments[] { key, name, rule, count, overrides, offers, reach }` | — | derived (`lib/crm-groups.overview`): the four segments in order new · regular · high_value · inactive; `rule` = the shop's own high-value numbers in words (`lib/crm.shopRule`); `count` = customers (never a lead) the list puts there; `overrides` = those the owner set by hand; `offers` = offers (live or draft) whose `rules.customer_group` names it — ONE grouped statement over `definition_version` | nobody | CB CRM › Groups & segments |
| `groups[] { key: 'group:<name>', name, count, offers, reach }` | — | derived: every name any customer carries (`customer-groups.namesOf` + the rows) | nobody | the same screen; `key` is what a send and an offer's "Only for" use |
| `reach { may, not, refused_by[] { code, n } }` | — | derived: `lib/privacy.mayAll`'s verdict per member for `channel` × `purpose` (whatsapp · marketing), counted BY CODE — the client branches on the code, never on a sentence; before b306 every member is `NO_CONSENT` | nobody | the screen's "n may be sent offers · m not (why)" |
| `groups_migrated` · `consent_migrated` · `customers` · `channel` · `purpose` | — | derived: b205 readable · b306 readable · how many customers were counted · the channel and purpose the reach was counted for | nobody | the screen says "not set up yet" in words |
| `may { group, send, delete } = { may, code, why }` | — | derived (`lib/crm-groups.mays`): the server's answer for this login — `VIEW_ONLY` · `OWNER_ONLY` · `OK` | nobody | every action shown, greyed with `why` |
| POST /groups → `{ name, added, removed, count }` | — | the group after the write: `added` / `removed` = rows actually changed (an id that is nobody's customer changes nothing); `count` = members now | `lib/crm-groups.setGroup` (ONE transaction; ≤ 500 ids; ≤ 20 groups per customer → `TOO_MANY_GROUPS`; before b205 → 409 `GROUPS_NOT_MIGRATED`) | the screen's refresh |
| DELETE /groups/:name → `{ name, removed }` | — | how many customers the group left; 404 `NOT_FOUND` when none carried it | `lib/crm-groups.dropGroup` | the screen |
| POST /segments/:key/send → `{ key, dry, channel, purpose, members, may, refused[] { party_id, name, code, why }, refused_by[], sent[] { party_id, name, status, reason }, sent_n, failed_n, refused_n }` | — | derived: `dry` = the verdict per member, nothing sent; a real send = `lib/whatsapp-out.notify` per allowed member (the ONE sender, which asks `lib/privacy.gate` again) — `status` sent · refused · failed with the sender's own `reason`; only WhatsApp is sendable today (`CHANNEL_NOT_SENDABLE`); > 100 allowed members → 400 `TOO_MANY` before any send | `lib/crm-groups.send` | the Send sheet: the count first, then the outcome per member |

## SET-WALK1 · W25 (2026-10-15) · the vault is saved as a merge-patch with a version — `GET /api/governance/profile` · `PUT /api/governance/profile/vault`

No migration: the version IS `entity_profile.updated_at` (b96), read as whole microseconds. Who may: any signed-in login of the shop (unchanged).

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `GET /api/governance/profile` `vault_version` (new) | text — `(extract(epoch from entity_profile.updated_at) * 1000000)::bigint` as a string; `null` before the first fill | derived (`lib/profile.readVault`, the same read as `vault`). Read by web cap-shop.js (kept on the model with the vault; sent back as `version` on Save). |
| `PUT /api/governance/profile/vault` body `{ version, patch }` (new shape) | `patch` = RFC 7386 merge-patch over the KEYED vault: `{ sections: { '<type>\|<label>': { label?, rows: { 't:<tag>' \| 'n:<name>': { name, value, tag? } \| null } } \| null } }` (lib/vault-patch: a repeated key gets `#2`) | source. Written by web cap-shop.js `saveVaultUI` (only the rows this screen changed; `null` removes). Applied by `lib/profile.patchVault` → `saveVault` with `expect` — the check and the write are ONE statement (`… WHERE updated_at = $3 RETURNING version`). The old whole body `{ vault: { sections: [] } }` is taken for a first fill, or with the current `version`. |
| `PUT /api/governance/profile/vault` → `{ vault, version }` | `version` as above, after the write | derived. Read by cap-shop.js (the model's version moves on). |
| 409 of `PUT /api/governance/profile/vault` | `{ code: 'VAULT_CHANGED', error, message: 'Changed since you opened it — reload?' }` · `{ code: 'VAULT_VERSION_REQUIRED', … }` (a whole body over an existing vault with no version) | derived. The web paints the sentence with a Reload button (CBAction onFail); nothing is written. |

## SET-WALK1 · W15 / W16 / W28 (2026-10-15) · the kinds a login may mint · a connector not yet for a country · the words for big numbers

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `GET /api/keys` `scopes` (changed) | the kinds THIS login may mint — `testing` only for the platform role (`lib/platformroot.isPlatform`) | derived (`routes/keys.scopesFor`). Read by web cap-settings.js (the "It may" picker offers exactly this list). `POST /api/keys` refuses a kind outside it: 403 `NOT_PLATFORM`. |
| `GET /api/integrations/catalogue` `connectors[].may.code` (new) | `null` · `NOT_FOR_COUNTRY` (Tally outside a Tally-XML pack) · `NOT_YET_FOR_COUNTRY` (Zoho Books: sold there, our kit is India-GST-shaped so far) · `NOT_YET` (Xero · MYOB: no kit; listed for the countries whose shops run them) | derived (`routes/integrations.mayFor`). The web words the row from the CODE ("Not for your country" · "Not yet for your country" · "Not built yet"), never from the sentence. The download answers 409 with the same code. |
| `policy_flags.number_words` | `pack` · `lakh` · `million`; default `pack` (= the money's own: INR lakh/crore, else million) | Source · layer E, class `entity`. Written by CB Settings › Country (W28, through the one writer PATCH /entities/policy). Read by the web's Country setup (the live example) and, when `CBMoney.words` lands in the engines, by every bill's words line. No `ui`: it is shown in ONE place (Country), not in the Policy list. |
| `ui_prefs.kural` | `auto` · `on` · `off`; default `auto` | Source (SET-WALK1 W7). The person's choice in the avatar menu's Thirukkural group (web avatar.js `CBAvatar.set('kural')`), synced like theme. Read by web kural.js `wanted()`: `auto` draws the band only where the shop reads Tamil (`CBLocale.langs` has `ta`). No migration (ui_prefs jsonb). |

## CRM-FIX (R4 · R5 · R9 · R10, 16 Oct 2026)
| key | shape | number · source · writer · reader |
|---|---|---|
| `dues.open_side` (GET /api/crm/parties · /parties/:id) | boolean | Derived in `lib/crm.net`: either stored side (customer / supplier) is non-zero, even when the netted `balance_minor` is 0. Read by `crm.removeParty` (HAS_DUES). |
| `calls[].may_call` · `call_why` · `call_code` (GET /api/crm/calls) | boolean · string/null · string/null | Derived per row from the newest `party_contact_pref` row for phone × service (`privacy.contactPrefsOf`); true before b306. The call desk greys the tap-to-call with `call_why`; POST outcome refuses 403 with `call_code`. |
| POST /api/crm/parties/:id/outcome `followup_id` | uuid, optional | The queue row's own follow-up — the only one the call closes. Absent (a new lead's row) closes none. |
| POST /api/supplies/purchase `books_posted` | boolean, always false | Written by `supply-store.purchase`: cost and stock only, no expense/payable/input tax is posted; the toast says "not in your books yet". Read by the supplies screen. |

## Table columns the dictionary did not name · identities · register_entry · chit_status · chit_disputes · chit_header · chit_messages (SCHEMA-FIX1 · FLD3, 16 Oct 2026)

Columns, not response keys: SCHEMA-ASSESSMENT-2026-10-16 §7 found 134 columns of these six tables that no row here named. Each row is the column as the database holds it (type from the schema built out of `migrations/`; the meaning is the schema's own `COMMENT ON COLUMN` where one exists). **Written by* lists the lib/ routes/ middleware files that hold an INSERT/UPDATE of the table AND name the column (a file that also reads it is listed here once); *read by* lists the other files that name it. Both lists are a grep, not a trace: a file that builds the column name at run time is not in them. The one writer per column is the open question of SCHEMA-ASSESSMENT fix 6/7.


### `identities`

| column | type | meaning · written by · read by |
|---|---|---|
| `email_verified` | boolean | no schema comment, the owning module names it · written by `routes/signin.js` · read by no file that names it |
| `identity_type` | character varying | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `lib/local-identity.js`, `lib/network-build-run.js`, `lib/source.js` +9 · read by `lib/access.js`, `lib/autoraise.js`, `lib/catalogue-view.js`, `lib/cost.js` +23 |
| `auth_method` | character varying | no schema comment, the owning module names it · written by `routes/catalogue.js` · read by no file that names it |
| `last_active_at` | timestamp without time zone | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `lib/otp.js`, `routes/actors.js`, `routes/entities.js` · read by `lib/people.js`, `routes/people.js` |
| `actor_key` | character varying | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `lib/network-build-run.js`, `routes/actors.js`, `routes/connectors.js` +3 · read by `lib/handle.js`, `lib/mintuserid.js`, `lib/people.js`, `lib/resolveuserid.js` +1 |
| `actor_type` | character varying | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `routes/actors.js`, `routes/connectors.js`, `routes/integrations.js` +1 · read by `lib/people.js`, `routes/till.js` |
| `user_id` | character varying | no schema comment, the owning module names it · written by `lib/crm-leads.js`, `lib/identity-auth.js`, `lib/local-identity.js`, `lib/network-build-run.js` +9 · read by `lib/bill-steps.js`, `lib/books-store.js`, `lib/crm.js`, `lib/handle.js` +17 |
| `actor_role` | character varying | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `routes/actors.js`, `routes/connectors.js`, `routes/integrations.js` +1 · read by `lib/people.js`, `lib/sides.js`, `routes/people.js` |
| `max_tasks` | integer | no schema comment, the owning module names it · written by `routes/actors.js`, `routes/connectors.js`, `routes/integrations.js`, `routes/signin.js` · read by `routes/chits.js` |
| `current_task_count` | integer | no schema comment, the owning module names it · written by `lib/assign-chit.js`, `routes/actors.js` · read by `lib/people.js`, `routes/chits.js`, `routes/people.js` |
| `break_type` | character varying | no schema comment, the owning module names it · written by `routes/actors.js` · read by no file that names it |
| `break_started_at` | timestamp without time zone | no schema comment, the owning module names it · written by `routes/actors.js` · read by no file that names it |
| `return_date` | date | no schema comment, the owning module names it · written by `routes/actors.js` · read by no file that names it |
| `deactivated_at` | timestamp without time zone | no schema comment, the owning module names it · written by `routes/actors.js` · read by no file that names it |
| `removed_at` | timestamp without time zone | no schema comment, the owning module names it · written by `routes/actors.js` · read by no file that names it |
| `deactivated_by` | uuid | no schema comment, the owning module names it · written by `routes/actors.js` · read by no file that names it |
| `removed_by` | uuid | no schema comment, the owning module names it · written by `routes/actors.js` · read by no file that names it |
| `otp_attempts` | integer | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `lib/network-build-run.js`, `lib/otp.js`, `routes/actors.js` +4 · read by no file that names it |
| `pin_hash` | character varying | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `routes/actors.js`, `routes/signin.js` · read by no file that names it |
| `pin_attempts` | integer | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `routes/actors.js`, `routes/signin.js` · read by no file that names it |
| `pin_locked_at` | timestamp without time zone | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `routes/actors.js`, `routes/signin.js` · read by no file that names it |
| `is_erased` | boolean | no schema comment, the owning module names it · written by `routes/entities.js` · read by `routes/chits.js` |
| `erased_at` | timestamp with time zone | no schema comment, the owning module names it · written by `routes/entities.js` · read by no file that names it |
| `governed_by` | uuid | no schema comment, the owning module names it · written by `routes/governance.js` · read by no file that names it |
| `constitution_version` | text | no schema comment, the owning module names it · written by `routes/governance.js`, `routes/signin.js` · read by `lib/govresolve.js` |
| `params_override` | jsonb | no schema comment, the owning module names it · written by `lib/network-build-run.js`, `routes/catalogue.js`, `routes/entities.js`, `routes/governance.js` +1 · read by `lib/catalogue-view.js`, `lib/visibility-cap.js` |
| `message_type_mode` | character varying | no schema comment, the owning module names it · written by no app file · read by no file that names it |
| `dispute_handler_actor_id` | uuid | no schema comment, the owning module names it · written by `routes/actors.js`, `routes/entities.js` · read by `routes/notifications.js` |
| `delegate_actor_id` | uuid | no schema comment, the owning module names it · written by `routes/actors.js` · read by `lib/people.js`, `routes/chits.js`, `routes/people.js` |
| `last_assigned_at` | timestamp with time zone | no schema comment, the owning module names it · written by `lib/assign-chit.js`, `routes/actors.js` · read by `routes/chits.js` |
| `capabilities` | jsonb | no schema comment, the owning module names it · written by `routes/connectors.js`, `routes/entities.js` · read by `lib/catalogue-view.js`, `lib/consolidate.js`, `lib/govresolve.js`, `lib/itemmatch.js` +1 |
| `connector_type` | text | no schema comment, the owning module names it · written by `routes/actors.js`, `routes/connectors.js`, `routes/integrations.js` · read by `lib/catalogue-view.js`, `lib/sides.js`, `routes/till.js` |
| `site` | text | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `routes/actors.js`, `routes/catalogue.js`, `routes/connectors.js` +2 · read by `lib/access.js`, `lib/amend.js`, `lib/catalogue-blueprint.js`, `lib/catalogue-write.js` +14 |
| `connector_config` | jsonb | no schema comment, the owning module names it · written by `routes/actors.js`, `routes/connectors.js`, `routes/integrations.js` · read by no file that names it |
| `provision_key_hash` | text | no schema comment, the owning module names it · written by `routes/connectors.js` · read by no file that names it |
| `last_seen` | timestamp with time zone | no schema comment, the owning module names it · written by `routes/actors.js`, `routes/connectors.js`, `routes/entities.js`, `routes/integrations.js` · read by `lib/catalogue-view.js`, `routes/testing.js` |
| `catalogue_visibility` | text | no schema comment, the owning module names it · written by `lib/network-build-run.js`, `routes/catalogue.js`, `routes/entities.js`, `routes/network-design.js` · read by `lib/catalogue-view.js`, `lib/network-build.js`, `lib/schema-bootstrap.js`, `lib/visibility-cap.js` |
| `sort_order` | integer | Where this store sits among its siblings in its network, set by the network build. NULL = not arranged (sorts last, by name). · written by `lib/network-build-run.js`, `routes/entities.js`, `routes/network-design.js` · read by `lib/network-build.js`, `lib/quick-keys.js`, `routes/quick-keys.js` |
| `lat` | numeric | Latitude, decimal degrees. NULL = not located (never 0 — that is a real place). · written by `lib/network-build-run.js`, `routes/entities.js`, `routes/network-design.js` · read by `lib/availability.js`, `lib/network-build.js` |
| `lng` | numeric | Longitude, decimal degrees. NULL = not located. · written by `lib/network-build-run.js`, `routes/entities.js`, `routes/network-design.js` · read by `lib/availability.js`, `lib/network-build.js` |
| `service_km` | integer | How far this store serves, km. NULL = not stated, which is not zero. · written by `lib/network-build-run.js`, `routes/entities.js`, `routes/network-design.js` · read by `lib/availability.js`, `lib/network-build.js` |
| `dispatch_days` | smallint | Days from order to goods leaving this store. 0 = same day. NULL = not declared, which is not the same as 0. · written by `lib/network-build-run.js`, `routes/network-design.js` · read by `lib/availability.js`, `lib/network-build.js` |
| `ship_within_days` | smallint | Transit days to a customer inside service_km. NULL = not declared. · written by `lib/network-build-run.js`, `routes/network-design.js` · read by `lib/availability.js`, `lib/network-build.js` |
| `ship_beyond_days` | smallint | Transit days to a customer beyond service_km — usually a different lane, not a longer drive. NULL = not declared. · written by `lib/network-build-run.js`, `routes/network-design.js` · read by `lib/availability.js`, `lib/network-build.js` |
| `notif_seen_at` | timestamp with time zone | no schema comment, the owning module names it · written by no app file · read by `routes/notifications.js` |
| `access_level` | character varying | no schema comment, the owning module names it · written by `lib/identity-auth.js`, `routes/actors.js`, `routes/entities.js` · read by `lib/access-events.js`, `lib/access.js`, `lib/people.js`, `lib/schema.js` +4 |
| `whole_entity` | boolean | no schema comment, the owning module names it · written by `routes/actors.js`, `routes/entities.js` · read by `lib/access-events.js`, `lib/access.js`, `lib/people.js`, `lib/schema.js` +2 |
| `entity_kind` | character varying | What this identity IS, declared at the mint. Closed vocabulary — see identities_entity_kind_chk. b225. · written by `lib/local-identity.js`, `lib/network-build-run.js`, `lib/source.js`, `routes/actors.js` +5 · read by `lib/crm.js`, `lib/entitykind.js`, `lib/istest.js`, `lib/rootlink.js` |
| `entity_visibility` | character varying | May this entity be FOUND and named as a counterparty. Distinct from catalogue_visibility, which is only about products. public = today's behaviour for everyone. internal = receive-only (b234). · written by `routes/entities.js` · read by no file that names it |
| `is_test` | boolean | Derived from population, kept so existing readers keep working. ⚠️ Never written — set `population`. · written by `routes/entities.js` · read by `lib/istest.js` |
| `serves_all_populations` | boolean | Infrastructure, not a counterparty: the platform operator and the standards. Exempt from the transaction boundary in both directions, so a test shop can raise a support incident to us. Internal entities only. · written by no app file · read by `lib/istest.js`, `lib/raiseticket.js` |

### `register_entry`

| column | type | meaning · written by · read by |
|---|---|---|
| `raida_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `routes/chits.js` |
| `closes_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `lib/sides.js` |
| `visibility` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/catalogue-view.js`, `lib/cost.js`, `lib/csv-preflight.js`, `lib/customer-groups.js` +17 |
| `dispute_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/dispute-may.js`, `routes/chits.js`, `routes/crm.js` |
| `created_by_actor_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/mint.js`, `lib/raiseticket.js`, `routes/catalogue.js`, `routes/chits.js` +2 |
| `created_by_name` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by no file that names it |
| `subject_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `routes/catalogue.js`, `routes/chits.js` |
| `owner_actor_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by no file that names it |
| `owner_name` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `lib/instruments.js`, `routes/chits.js` |
| `review_date` | date | no schema comment, the owning module names it · written by `lib/raida.js` · read by `routes/chits.js` |
| `likelihood` | smallint | no schema comment, the owning module names it · written by `lib/raida.js` · read by `routes/chits.js` |
| `severity` | smallint | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/csv-preflight.js`, `lib/impact.js`, `lib/kyb.js`, `lib/raiseticket.js` +6 |
| `residual_likelihood` | smallint | no schema comment, the owning module names it · written by `lib/raida.js` · read by no file that names it |
| `residual_severity` | smallint | no schema comment, the owning module names it · written by `lib/raida.js` · read by no file that names it |
| `treatment` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/gst-returns.js`, `lib/points.js`, `lib/sheet.js`, `routes/chits.js` |
| `verification_method` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by `routes/chits.js` |
| `rel_type` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `routes/chits.js` |
| `to_type` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `routes/chits.js` |
| `to_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `lib/sides.js`, `routes/chits.js`, `routes/connections.js` |
| `to_label` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `lib/sides.js`, `routes/chits.js` |
| `needed_by` | date | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `routes/chits.js` |
| `disposition` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by no file that names it |
| `carried_to_subject_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by no file that names it |
| `evidence_ref` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/entity-header.js`, `lib/kyb.js`, `lib/readiness.js`, `routes/governance.js` |
| `evidence_hash` | text | no schema comment, the owning module names it · written by `lib/raida.js` · read by no file that names it |
| `revises_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by `lib/impact.js`, `lib/sides.js` |
| `template_id` | uuid | no schema comment, the owning module names it · written by `lib/raida.js` · read by `routes/chits.js` |

### `chit_status`

| column | type | meaning · written by · read by |
|---|---|---|
| `status_id` | uuid | no schema comment, the owning module names it · written by no app file · read by no file that names it |
| `assigned_to_actor_id` | uuid | no schema comment, the owning module names it · written by `lib/assign-chit.js`, `routes/chits.js`, `routes/folders.js` · read by `lib/select.js`, `lib/work-rows.js`, `routes/actors.js`, `routes/notifications.js` |
| `assigned_to_actor_display_name` | character varying | no schema comment, the owning module names it · written by `lib/assign-chit.js`, `routes/chits.js` · read by `lib/select.js`, `lib/work-rows.js` |
| `assignment_type` | character varying | no schema comment, the owning module names it · written by `lib/assign-chit.js`, `routes/chits.js` · read by `routes/actors.js` |
| `read_at` | timestamp without time zone | no schema comment, the owning module names it · written by `routes/chits.js`, `routes/folders.js` · read by `lib/match.js`, `lib/measure.js`, `lib/mint.js`, `lib/select.js` +1 |
| `star_flag` | boolean | no schema comment, the owning module names it · written by `routes/chits.js` · read by no file that names it |
| `priority_flag` | character varying | no schema comment, the owning module names it · written by `routes/chits.js` · read by `lib/mint.js` |
| `snoozed_until` | timestamp without time zone | no schema comment, the owning module names it · written by no app file · read by no file that names it |
| `deleted_at` | timestamp without time zone | no schema comment, the owning module names it · written by `routes/chits.js`, `routes/folders.js` · read by `lib/assign.js`, `lib/books-store.js`, `lib/raida.js`, `lib/retention.js` +3 |
| `retention_expires_at` | timestamp with time zone | no schema comment, the owning module names it · written by `routes/chits.js` · read by `lib/policy.js` |
| `legal_hold` | boolean | no schema comment, the owning module names it · written by no app file · read by `lib/retention.js` |
| `customer_priority` | boolean | no schema comment, the owning module names it · written by `routes/chits.js` · read by no file that names it |
| `customer_priority_locked` | boolean | no schema comment, the owning module names it · written by `routes/chits.js` · read by no file that names it |
| `archived_at` | timestamp without time zone | no schema comment, the owning module names it · written by `routes/chits.js`, `routes/folders.js` · read by `lib/select.js` |
| `folder_id` | uuid | no schema comment, the owning module names it · written by `lib/folder-rules.js`, `lib/raiseticket.js`, `routes/chits.js`, `routes/connectors.js` +1 · read by `lib/folder-inventory.js`, `lib/folder-views.js`, `lib/groupsum.js`, `lib/select.js` +3 |
| `retire_at` | timestamp with time zone | no schema comment, the owning module names it · written by `routes/chits.js` · read by `lib/retention.js` |
| `retention_source` | text, NULL or `records_law` · `own_floor` · `sender_asked` (CHECK `chit_status_retention_source_chk`) | **b771, K-DB / SET-26 (21 Oct 2026).** Source · written once at the mint by `routes/chits.js` `retainDaysFor` (per copy: the winner of MAX(records-law floor `policy.RECORDS_FLOOR_DAYS`, the owner's `policy_flags.retention_floor_days`, the sender's `retention_days`)), only once b771 has run (`schema.hasColumn`). NULL = minted before b771. Read by: nobody yet (the audit answer to "why is this copy kept N days"). Owned data: each party's own, never in the shared `summary_json`. |
| `retired_at` | timestamp with time zone | no schema comment, the owning module names it · written by no app file · read by `lib/supply-store.js` |
| `cancel_requested_at` | timestamp without time zone | no schema comment, the owning module names it · written by `routes/chits.js` · read by no file that names it |
| `cancel_requested_by` | character varying | no schema comment, the owning module names it · written by `routes/chits.js` · read by no file that names it |
| `cancel_reason` | text | no schema comment, the owning module names it · written by `routes/chits.js` · read by no file that names it |
| `cancel_confirmed_at` | timestamp without time zone | no schema comment, the owning module names it · written by `routes/chits.js` · read by no file that names it |
| `cancel_confirmed_by` | character varying | no schema comment, the owning module names it · written by `routes/chits.js` · read by no file that names it |

### `chit_disputes`

| column | type | meaning · written by · read by |
|---|---|---|
| `dispute_id` | uuid | no schema comment, the owning module names it · written by no app file · read by `lib/dispute-may.js`, `lib/raida.js`, `routes/chits.js`, `routes/crm.js` |
| `raised_by_display_name` | character varying | no schema comment, the owning module names it · written by no app file · read by `lib/bill-steps.js`, `routes/chits.js` |
| `resolution_note` | text | no schema comment, the owning module names it · written by no app file · read by `routes/chits.js`, `routes/service.js` |
| `resolved_by_entity_id` | uuid | no schema comment, the owning module names it · written by no app file · read by no file that names it |
| `resolved_at` | timestamp with time zone | no schema comment, the owning module names it · written by no app file · read by `lib/bill-steps.js`, `lib/raiseticket.js`, `lib/sla.js`, `routes/connectors.js` +3 |
| `target_entity_id` | uuid | no schema comment, the owning module names it · written by no app file · read by `routes/chits.js` |
| `target_display_name` | character varying | no schema comment, the owning module names it · written by no app file · read by `routes/chits.js` |
| `scope` | character varying | no schema comment, the owning module names it · written by no app file · read by `db/index.js`, `lib/assist-kb.js`, `lib/catalogue-write.js`, `lib/conformance.js` +51 |
| `answerable` | boolean | no schema comment, the owning module names it · written by no app file · read by `lib/capture.js`, `lib/inventory.js`, `lib/lotfields.js`, `lib/match.js` +5 |
| `parity_state` | character varying | no schema comment, the owning module names it · written by no app file · read by `routes/chits.js` |
| `evidence_snapshot` | jsonb | no schema comment, the owning module names it · written by no app file · read by `routes/chits.js` |

### `chit_header`

| column | type | meaning · written by · read by |
|---|---|---|
| `header_id` | uuid | no schema comment, the owning module names it · written by no app file · read by no file that names it |
| `sender_entity_id` | uuid | no schema comment, the owning module names it · written by `lib/tax-copy.js`, `routes/catalogue.js`, `routes/chits.js` · read by `lib/bill-privacy.js`, `lib/books-hooks.js`, `lib/books-store.js`, `lib/counter-bill.js` +16 |
| `sender_entity_bridge_id` | character varying | no schema comment, the owning module names it · written by `routes/catalogue.js`, `routes/chits.js` · read by `lib/beckn-map.js`, `lib/mint.js`, `lib/raiseticket.js`, `routes/connectors.js` |
| `sender_entity_display_name` | character varying | no schema comment, the owning module names it · written by `routes/catalogue.js`, `routes/chits.js` · read by `lib/assign.js`, `lib/bill-steps.js`, `lib/books-store.js`, `lib/forms.js` +10 |
| `created_by_actor_id` | uuid | no schema comment, the owning module names it · written by `routes/catalogue.js`, `routes/chits.js` · read by `lib/mint.js`, `lib/raida.js`, `lib/raiseticket.js`, `routes/connectors.js` +1 |
| `created_by_actor_display_name` | character varying | no schema comment, the owning module names it · written by no app file · read by no file that names it |
| `auto_subject` | character varying | no schema comment, the owning module names it · written by `lib/tax-copy.js`, `routes/catalogue.js`, `routes/chits.js`, `routes/integrations.js` · read by `lib/assign.js`, `lib/books-store.js`, `lib/folder-rules.js`, `lib/home-facts.js` +14 |
| `chit_ref` | uuid | no schema comment, the owning module names it · written by `routes/catalogue.js`, `routes/chits.js` · read by `lib/beckn-map.js`, `lib/rollup.js` |
| `previous_chit_id` | uuid | no schema comment, the owning module names it · written by no app file · read by no file that names it |
| `sent_at` | timestamp with time zone | no schema comment, the owning module names it · written by `lib/tax-copy.js`, `routes/catalogue.js`, `routes/chits.js` · read by `lib/books-hooks.js`, `lib/books-store.js`, `lib/mint.js`, `lib/tax-lines.js` +1 |
| `schema_version` | character varying | no schema comment, the owning module names it · written by `routes/catalogue.js`, `routes/chits.js` · read by `lib/beckn-map.js`, `lib/container.js`, `lib/gst-returns.js`, `lib/mint.js` +1 |
| `schema_id` | uuid | no schema comment, the owning module names it · written by `routes/catalogue.js`, `routes/chits.js` · read by `lib/beckn-map.js`, `lib/catalogue-columns.js`, `lib/catalogue-view.js`, `lib/catalogue-write.js` +14 |

### `chit_messages`

| column | type | meaning · written by · read by |
|---|---|---|
| `message_id` | uuid | no schema comment, the owning module names it · written by no app file · read by `lib/beckn-map.js`, `lib/forms.js`, `lib/storage.js`, `routes/attachments.js` +4 |
| `sender_entity_id` | uuid | no schema comment, the owning module names it · written by no app file · read by `lib/bill-privacy.js`, `lib/books-hooks.js`, `lib/books-store.js`, `lib/counter-bill.js` +19 |
| `sender_display_name` | character varying | no schema comment, the owning module names it · written by no app file · read by `lib/mint.js`, `routes/catalogue.js`, `routes/chits.js`, `routes/crm.js` +1 |
| `thread_type` | character varying | no schema comment, the owning module names it · written by no app file · read by `middleware/hat-gate.js`, `routes/catalogue.js`, `routes/chits.js`, `routes/crm.js` +1 |
| `visibility_entity_id` | uuid | no schema comment, the owning module names it · written by no app file · read by `routes/attachments.js`, `routes/chits.js` |
| `message_text` | text | no schema comment, the owning module names it · written by no app file · read by `routes/catalogue.js`, `routes/chits.js`, `routes/crm.js`, `routes/folders.js` |
| `msg_type` | character varying | no schema comment, the owning module names it · written by no app file · read by `routes/catalogue.js`, `routes/chits.js`, `routes/folders.js` |
| `is_dispute` | boolean | no schema comment, the owning module names it · written by no app file · read by `routes/chits.js`, `routes/folders.js` |
| `dispute_id` | uuid | no schema comment, the owning module names it · written by no app file · read by `lib/dispute-may.js`, `lib/raida.js`, `routes/chits.js`, `routes/crm.js` |
| `read_at` | timestamp with time zone | no schema comment, the owning module names it · written by no app file · read by `lib/match.js`, `lib/measure.js`, `lib/mint.js`, `lib/select.js` +3 |
| `subject_id` | uuid | no schema comment, the owning module names it · written by no app file · read by `lib/impact.js`, `lib/raida.js`, `routes/catalogue.js`, `routes/chits.js` |

## GET /api/till/summary?compare=1 · GET /api/facts/till `figures.trend` (RPT2 · Reports › Trend, 2026-10-17)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `period` · `n` · `currency` · `fy_start_month` (GET /api/till/summary?compare=1, new) | `'week'\|'month'\|'quarter'\|'year'` · number · ISO code · 1-12 | Derived by `lib/till-summary.trend`: the shop's year = books_setting, else entity_governance, else the pack (`country-setup.fyStartOf`); money = `country-setup.shopMoney`. None → 422 `NO_COUNTRY` / `NO_MONEY`. Read by web cap-mis-trend.js. |
| `sales_from` · `sales_note` (GET /api/till/summary?compare=1, REP-48) | `'books'|'summaries'` · words or null | Derived by `lib/till-summary.trend`: the slots' sales are the Day book's SOLD per day (`books-store.soldByDay`: tenders + debtors of the walk-in day / bill / credit bill / return entries, reversals out — Home's Till card reads the same rule) put in `rollup.series` as stand-in summaries (till "The books"); `sales_from` 'summaries' + the words in `sales_note` when the books are off, not provisioned or empty (then the counters' day summaries, never a 0). Same words ride GET /api/facts/trend `lines[]`. Not P&L's Sales line: that is net of output tax, Sold is the bill value. Read by web cap-mis-trend.js (to paint the note). |
| `slots[]` (same route, new) | `[{ key, gross_minor\|null, total_minor\|null, bills\|null, coverage:{ expected, seen, short, partial }, last_year:{ key\|null, gross_minor\|null, short }, change_pct\|null }]`, newest last | Derived: `rollup.series` (engines v1.66.0) over the summary chits — unchanged by the route. Minor units; null = no record (never 0); change_pct null unless both slots are whole and closed and last year sold. Read by web cap-mis-trend.js (chart + table). |
| `figures.trend` (GET /api/facts/till, new) | `{ spark:[8 × gross_minor\|null], vs_last_year_pct:number\|null }` — omitted when there is no year, or < 2 weeks with a figure | Derived by `lib/till-summary.teaser`: `rollup.series('week', 8)`; vs_last_year_pct = the newest closed week's change_pct. Read by web shell.js (the Till card's sparkline). |

## GET /api/facts/connectors · governance · plan (SET-35, T3-SETTINGS 2nd run, 2026-10-19)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `figures` (GET /api/facts/connectors, new card) | `{ connectors, live }` | Derived by `lib/home-facts.connectors` over `lib/connector-rows.connectorsOf` — the statement GET /api/integrations/status answers with (one trip); `live` = the one `health` rule (routes/connectors). State `not_started` when none has checked in. Read by the Home card of manifest entry `connectors`. |
| `figures` (GET /api/facts/governance, new card) | `{ changed, rules }` | Derived: `lib/policy.get` against `lib/policy.defaults` — how many flags the shop set away from the default. Read by the Home card of manifest entry `governance`. |
| `figures` (GET /api/facts/plan, new card) | `{ plan, limits, used: { chits_today } }` | `plan` = `identities.plan`; `limits` = the active constitution's `plan_menu[plan]` (null when not declared — the line says so, never 0); `chits_today` = `routes/governance.countChitsToday`, the quota's own counter. The chits line is `dn` at the daily limit. Read by the Home card of manifest entry `plan`. |

## `ops.retention_flush_log` (b772, K-DB / DB-21 + PM-16, 21 Oct 2026)

One row per retention commit attempt. Written ONLY by `ops.f_retention_flush_event` (SECURITY DEFINER), called by `lib/retention.js`
`planRetirement({ commit: true })`; cb_app has no grant on the table; cb_ops reads it. Nothing in the app reads it yet (the audit answer to
"why is this copy gone, or why was nothing flushed").

| column | type | meaning · written by · read by |
|---|---|---|
| `mode` | text `BLOCKED` · `commit-not-wired` · `committed` | the answer planRetirement gave; `committed` is reserved for the human-gated commit path (not wired) |
| `reason` | text | why it was BLOCKED, in words (no archive receipt, a receipt that does not match, the guardrail); NULL when not blocked |
| `candidates` · `deleted` | integer | copies due at that moment · copies removed (always 0 until a commit path is wired) |
| `receipt` | jsonb object or NULL | the archive receipt the caller handed: `{ archive_ref, sha256, rows, at }` (DB-21: where the archive lives is Athi's call) |
| `guardrail` | jsonb | planRetirement's guardrail at that moment: `{ rows, total, pct, threshold_rows, threshold_pct, blocked }` |
| `run_by` · `at` | text · timestamptz | `session_user` of the caller · when |

## GET /api/till/snapshot `categories` vs `category_master` (TILL-114, duplicate key fixed)

| Field | Type | Meaning |
|---|---|---|
| `categories` | array of definition rows (`kind: 'category'`) | Source: `lib/tax-shelf.readShelf`. The TAX categories, each with `rules.default_slab`. Read by the counter only as `categories` into `CBTax.slab.resolve`. Never names. |
| `category_master` | array `{ id, name, status }` | Source: `lib/categories.listCategories`. The shop's own category master, id to name. Read by the till master `catRestamp`, which stamps `item.category` from `item.category_id`. Rides every snapshot (tens of rows). Tests: tests/snapshot-wire.test.js. |

## `item_data.stocked` · GET /api/till/stock?detail=1 `balances[].counted` · `not_counted` · stock skip code `not_stocked` (R104, 24 Oct 2026)

| Field | Type | Meaning |
|---|---|---|
| `item_data.stocked` (catalogue_items, JSONB) | `true` · `false` · absent | Is this item COUNTED AS STOCK? Absent = the trade's usual: `lib/stocked.stockedFor` answers not counted when `catalogue-blueprint.forVertical(govresolve.verticalOf(entity).key) === 'hotel'` (a dish made to order), counted otherwise or with no trade declared. The item overrides both ways, the precedent being `item_data.batch_tracked` (`lotfields.tracksBatch`). Read ONCE per chit or shelf by `stocked.flagsFor` (one query, both flags). Written by the catalogue item form "Stock" group (web, PR 2) through `catalogue-write` (merge). Never a setting: a product fact. Hazard: the declared sector word `food-service` also hits `lotfields.PACKS` food (batch + expiry asked on every dish) — declare `tiffin` / `restaurant`. |
| `balances[id].counted` (GET /api/till/stock?detail=1) | boolean | `false` = the shop does not count this item; its figure is the OLD balance (rows are never deleted, no SQL) — the screen greys it under "Not counted". The counter's plain call (no `detail`) is unchanged. |
| `not_counted` (GET /api/till/stock?detail=1) | integer | how many balances carry `counted: false` — the Stock screen says "N items made to order — not counted" (never silent). The WORDS (made to order vs not counted as stock) come from the trade: GET /api/products/lists `pick === 'hotel'`. |
| `result.skipped[].code = 'not_stocked'` (stock-from-chit postFor) | code | a sale, receipt or return line of a not-counted item moves nothing — a NAMED skip beside `not_stock_use` / `not_stock_asset` / `no_cost`, logged by routes/chits sendStock. `stock-store.onHand` / `asAt` take `{ counted_only: true }` (Home card · storefront · closing stock) or `{ counted: 'stamp' }` (Stock screen), so all four readers agree and `STOCK_BELOW_ZERO` no longer names a dish. |

## `/.well-known/ctp.json` · `membership` · `network_fingerprint` · the network asks (PLT-45 / RAIL-96 / RAIL-97, 25 Oct 2026)

Written by: `routes/ctp.js manifest()` from `lib/netmember` (`ownMembership`, `networkFingerprint`). Read by: a receiving installation's door (`lib/netmember.doorVerdict`) and a joining installation. Absent on a standalone installation.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `membership` | `{ cert, sealed: { alg, hash, sig } }` or absent | The pass the network master signed for THIS installation, published so a receiver needs no call to the master. `cert` = `{ v, serial, installation_key, domain, public_key_hash, accepts_populations, not_before, not_after, issued_by }`. Written by the master (`tools/network-cert.cjs issue`), fetched by the member (`lib/netsync.pullMember`), stored in `membership_certificate`. Read by the door of every installation that pinned the master (`lib/netcert.check`). |
| `network_fingerprint` | hex sha256 | On a MASTER only: the fingerprint of its network public key. The installer compares it with the fingerprint the operator was given before pinning. |
| ask `registry_changes` `{ after, limit }` → `{ changes[], entities, last_seq }` | `changes[]` = `{ seq, bridge_id, entity_type, population, status, change }` | The member's outbox (`registry_change`), ids and status only, answered ONLY to the pinned master (verified with the pinned key). `entities` = how many businesses the outbox has named (the master's gap check). Never a handle, name, contact, tax number or money. |
| ask `certificate` → `{ found, membership \| why }` | as above | The master's newest usable certificate for the asking installation; `why` says suspended / revoked / lapsed / never issued. A lapsed member may still ask. |
| ask `directory` → `{ directory, sealed }` | `directory` = `{ v, at, for, revoked[], peers[] }`, `peers[]` = `{ installation_key, domain, endpoint, country, label }` | Sealed by the network key; a member checks it against the pinned key. `revoked` = serials of suspended or revoked certificates; `peers` = the other certified members (default talk policy). |
| ask `locate` `{ bridge_id }` → `{ found, hints[] }` | `hints[]` = `{ installation_key, domain }` | A LIST (a bridge id is unique inside one database only). A hint is only a hint: the caller asks that domain to resolve it (`lib/netsync.locate`). Needs a valid certificate. |

Tables (b790): `installation.network_role` (`standalone` default · `member` · `master`), `installation.root_handle`, `installation.root_bridge_id`; `membership_certificate`, `network_revoked`, `registry_change` (written only by `ops.f_registry_change`), `registry_entry` (installation_key, bridge_id, entity_type, population, status), `registry_cursor` (last_seq, entities, pulled_at, last_error). Environment: `CB_NETWORK_ROOT_KEY` (master's private network key), `CB_MASTER_DOMAIN` · `CB_MASTER_INSTALLATION` · `CB_MASTER_KEY` (a member's pin), `CB_INSTALLER_TOKEN` · `CB_INSTALLER_HANDLE` (the one-time root seed; dead once a registered business is active).

| `entity_profile.trade_mode` (NET-39, 2026-10-25) | `'domestic'` (default) \| `'export'` | The ONE "sells outside" switch (Settings → Your business → Selling abroad). `export` also means the shop may be answered to ANOTHER installation (CTP `search` and `catalogue`); `domestic` is found on its own installation only. Read by `lib/profile.isExporter`, fails closed. No second field. |

## chit_proposal · the proposal mechanism's keys (RAIL-106 part 4, 2026-10-25) — GET/POST /api/chits/:id/proposals…

One mechanism on ONE chit for the seller's pro-forma, the buyer's counter, an amendment after agreement and a money-free agreement (lib/chit-proposal.js). The chit is round 1; every version after it is the next round.

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `chit_proposal.edits` | array of `{ line_index, line_id, line \| null, reason_code, reason }` (the lib/amend prepare shape) | Written by the SELLER's installation when it prices (lib/chit-proposal priceLines); applied on acceptance through lib/amend record, the one writer of corrections. Read by the same lib. |
| `chit_proposal.request` | `{ lines: [{ line_id, line_index, quantity, requested_price (TEXT), remove, note }] }` | A buyer's counter: what is asked, in text or numbers. Never priced, never an input to any calculation. Written by the asking party, read by the one who prices it. |
| `chit_proposal.terms` | flat object of text, numbers and flags (`date`, `scope`, …), at most 20 keys | A money-free round. Written by either party; on acceptance becomes `business_json.agreed`. |
| `chit_proposal.invoice` | the INV-01 invoice, as the seller's installation issued it | Written ONLY by the seller's installation (routes/chits moneyOfLines); stored as issued by every other copy and set into `business_json.invoice` on acceptance, byte for byte. null when the tax was not decided. |
| `chit_proposal.summary` | `{ money, total_value, jurisdiction }` | `money` = moneyOfInvoice(invoice) or the provisional block with `tax_state: 'not_decided'`; set into `summary_json` on acceptance (without `jurisdiction`). |
| `chit_proposal.tax_note` | sentence or null | "Tax not decided: …" when the seller has no country; null when the invoice was issued. Words, not money. |
| `business_json.deal_type` | `'rfq'` or absent | Chosen at compose (web: "Ask for a quote"), carried through the send untouched into both copies' business_json. `'rfq'` makes a DOMESTIC chit use rounds (quotation → accept / re-quote / reject) like an international deal does; absent = the cart, exactly as before 25 Oct. Any other value means nothing. Read by lib/chit-proposal `usesRfq`. |
| `business_json.agreed` | `{ round, terms, by, agreed_with, at }` | Written on acceptance of a money-free round, on both copies. Read by the chit sheet. |
| `business_json.jurisdiction` | `{ document: 'quotation' \| 'pro_forma', buyer_country, buyer_installation, seller_country, seller_currency, seller_installation, buyer_duty_and_taxes: 'not_included' }` | Stamped at send when the seller is on another installation (document: quotation); the seller's side adds its half on each priced round; the accepted round sets `document: 'pro_forma'`. The wording on the screen is the web's ("Quotation · priced under <seller country> rules · <buyer country>'s import duty and taxes not included"). The buyer's duty is never computed. |
| event `proposal` payload | `{ proposal_id, round, version: pro_forma \| change \| request \| terms, edits, request, terms, invoice, summary, currency_code, tax_note, base_hash, note, by_name, replaces, replaces_status }` | CTP return path (lib/ctpreturn onProposal / applyProposal). The receiver keeps it as issued. |
| event `proposal_decide` payload | `{ proposal_id, decision: accept \| reject, by_name, note }` | CTP return path (onProposalDecided / applyProposalDecision): the receiver applies the SAME stored version, never recomputing. |
