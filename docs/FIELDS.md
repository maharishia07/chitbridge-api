# FIELDS: response keys the API adds (dictionary)

A new key needs its entry here, in the same change. This file is being built; entries start from 2026-10-02.

> **Per ITEM, not per route:** the field ledger. `data/cmdb/CAP-FIELDS-PRODUCT*.json` (CMDB, open `/cmdb/record.html#CAP-FIELDS-PRODUCT-1` on the web app) lists every field of a PRODUCT with its meaning, origin, one source, who sets it, what checks it, where it is shown, what reads it, its test and its status. A new product column or form input without a row fails `tests/field-ledger.test.cjs`. Human table: `C:/dev/toolset/fields/FIELDS-product.md`. This file stays the dictionary of response keys.

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
| whoami `actions.publish` | `{ ok }` \| `{ ok:false, why: 'not_helpdesk'\|'not_read', say }` | The same entity_schemas test POST /assist/publish refuses with (its 403 now carries `why: 'not_helpdesk'`). |

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
| `waiting[].candidates` | `[{ name, party_no }]`, ≤ 3; `[]` on every row that is not `add_supplier` | Source: `books_outbox.event.candidates`, written by `postChit` (park) and refreshed by every retry (`outboxDone` merges the event) from `receiptFacts` → `books-store.supplierByName` (STD1: the ONE resolver, also behind `bill-use.linkParty`) — the shop's suppliers whose name or nickname CONTAINS the typed name, case aside, a prefix first (the counter's datalist rule). Names + party_no only — never an id or an amount. Read by: the Waiting row and the bill popup ("Is this Sri Ganesh Provisions (P-00001)?"), which link through `PUT /api/chits/:id/use { party: { party_no } }`. |

## PUT /api/chits/:id/use · `party` (FX-F10W, 2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| body `party` | `{ party_no }` or `{ name }` | Which of MY suppliers my receipt of their bill is from. Resolved by the server in my `supplier_list` (exactly one, else 404); only on a captured receipt (`tax-copy.capturedBill`), only while it is still to accept. Writes `business_json.party.party_id` + `.name` (the slot the counter's pick fills). Answer `party: { party_id, name, party_no }`. Read by: `books-hooks.receiptFacts` on the next try. |
| `/api/facts/accounts` `figures.accept · add_supplier · record` | integers | Derived: `books-store.waitingCount` — ONE `GROUP BY todo` over every open outbox row (no cap; STD1). `figures.waiting` stays the total. The same count as /health `todo` and Books' To do. |
| /health `total` · `page` · `limit` · `todo: { accept, add_supplier, record }` | integers | Derived (STD1): `waiting[]` is a page (limit 50, least-tried first, page 1); `total` and `todo` are `books-store.waitingCount` over every open row. Read by: CB Accounts (the Waiting tab's count, the To do notices), Home's alert. |
| GET /api/chits/:id `doc` | `bill_received` · `bill_issued` · `return` · `receipt` · `expense` · null | Derived (STD1): `folder-inventory.docOf(header, me)` — the Bills folders' own classification. Read by: the chit popup (`chit-sheet.js` model: billRx / captured), never guessed there. |
| GET /api/chits/:id `books_wait` | `{ todo, name, why, candidates }` or null | Derived (STD1): this chit's open `books_outbox` row (`books-store.waitOfChitSql`, a scalar in the read's one statement — 0 new trips). Read by: the chit popup (the books' sentence, "Is this …?", Add supplier). |
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
| `may[channel][purpose]` = `{ may, why }` on GET contact-prefs | — | derived (`lib/privacy.mayMessage`) | nobody | any sender (none yet), the record's privacy block |
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
| `kind` | `'person'` | a listed person session (a key is `'api_key'`; a legacy token has no `kind`). |
| `jti` | uuid | the session's id; alive only while listed under `device_id`. |
| `device_id` | string | the device the token is bound to; `X-Device-Id` must equal it (else 401 `DEVICE_MISMATCH`). |
| `surface` | `'till'` · `'index'` · `'app'` · … | where it was signed in; `till` lives 30 days, everything else 7 (D3). |
| `iat` · `exp` | seconds | the same values as the listed session. |

**Legacy tokens** (no `jti`): every token issued before M05, and every sign-in that names no device. Honoured exactly as
before until their own `exp` (≤ 7 days); not listed, not revocable; the request log carries `kind: 'legacy'` (a session:
`kind: 'person'`). `POST /api/signin/renew` with `X-Device-Id` turns one into a listed session.

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
| `/api/facts/rail` | `{ suppliers, customers, in, out, stuck }` — in/out = open chits to you / from you, stuck = open past the shop's `overdue_days` | `in`/`out`/`stuck` when the shop holds 5,000+ chit copies (a truncated count is a wrong one) |

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
| `business` | `{ name, legal_name, address, phone }` | `name` = `identities.display_name`; `legal_name` / `address` / `phone` = the profile vault's Business-identity tags, else the `identities` column. Any may be null. |
| `licences[]` | one row per gathered `entity_compliance` row, plus one per CORE scheme not yet held | Core rows not held have `days_left: null`, `valid_until: null`, `band: null` ("not added"). |
| `licences[].scheme` · `label` | string | The rule's scheme and label; for a row with no rule, its `standard_key` and humanised `doc_key`. |
| `licences[].number_masked` | string or null | `verification.number_masked` when the verifier stored one; else null. |
| `licences[].valid_until` · `days_left` | `YYYY-MM-DD` · integer, negative = expired, or null | `kyb.daysUntil` of `valid_until`. |
| `licences[].band` | `ok` · `due` · `soon` · `gone` or null | From the scheme rule's bands (default >120 ok, 91-120 due, 0-90 soon, expired gone). **null when no rule matches: days only.** |
| `licences[].core` | boolean | The scheme is in `core_by_vertical` for the shop's vertical (`lotfields.packFor` over `identities.vertical` and the profile sectors). |
| `licences[].renew_url` | string or null | From the rule; null without one. |
| `licences[].note` | string or null | The rule's late-fee sentence, only for the bands the rule names (FSSAI: `gone`). Carries no amount and no start day. Null when no rule. |
| `licences[].rule_verified` | boolean or null | `false` = the rule's source is not cited yet ("verify"); every rule is false today. Null when no rule. |
| `trade_ready.checks[]` | `{ key, label, done }` x 4 | `address` (an address whose rung is at least `copied`: profile provenance or vault row, not just typed) · `phone` (the PHONE identity document is `verified`) · `pan` (a PAN identity document is held, or the PAN is read from the GSTIN) · `gstin` (a GSTIN is on file). |
| `trade_ready.done` | boolean | All four are done. |

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
| `business_json.not_invoice` | `'shop_details'` or absent | Written by the counter (`till.html finish()` → `chitOf`) when a bill that charges tax was saved while the shop's GSTIN state and address disagree (`shopStateClash`, walk 2026-10-09 M41): the sale saves, but not as a tax invoice. Read back by `GET /api/till/bills` as `bills[].not_invoice`; the slip then prints BILL — NOT A TAX INVOICE (the same title as an unrated line), on the first print and every reprint. Money and the frozen `invoice` are unchanged. |

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
| `gst` | `{ payable_minor, due_date, counted, why }` or null | `books-period.gstPayableAt`: the posted GST ledgers after `CBPosting.gstSetOff` (the set-off the month close posts) + reverse charge in cash. `due_date` = the 20th of the month after `asOf` (GSTR-3B, r.61(1) — `books-cashflow.GST_DUE_DAY`, the pack has no return calendar yet). `counted` = it falls inside the horizon and is in `series`. `why` = the engine's sentence when the set-off was refused (then `payable_minor` 0). |
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
| `profile.invoiceParty().currency` (changed) | ISO-4217 or null | `identities.currency_code`, else the pack's, else null (was `INR`). |
| books refusal `NO_MONEY` (new code) | 422 `{ code, error, message }` | `books.enable` / `books-store.saveSetting` when neither Country setup nor the pack states the money or the year start (was `INR` / April). The sentence is `country-setup.MONEY_UNSTATED`. |
| `identities.currency_code` · `cb_entity.currency_code` (b400) | varchar(3) or NULL | DEFAULT 'INR' dropped (b400): a money nobody stated is NULL — registration names it (offerOf / acceptAtSignup), Country setup asks for it. Layer: entity, class chosen-then-fixed (fixed once constituted). |

## F10 / F11 · the counter receipt that carries their bill (2026-10-14)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `GET /api/till/snapshot` · `suppliers[]` | `{ party_id, name, nickname?, state?, party_no? }` | Source: `supplier_list ⋈ identities` (routes/till.js `OWN.suppliers`, in the snapshot's shared transaction). `state` = the GSTIN's first two digits, India only. Names only — never a balance (a counter never reads what the shop pays its suppliers). Written by: nobody (read). Read by: the till's Receive form (`paintSuppliers` · `rcvSupplierKnown`). |
| receipt chit `business_json.party.party_id` | uuid, optional | Source: the supplier the door picked (`rcvSupplierKnown`: exactly one name / nickname match). Written by: till `chitOfDoc` (page and shop PC). Read by: `tax-copy.capturedPartyId` → `partiesFor` (the seller of their bill) · `books-hooks.receiptFacts`. Absent → the typed `party.name` is matched against the supplier list when it posts. |
| receipt chit `line_items[].gst_rate` | number, optional | Source: the GST rate the door recorded from their bill (`rcvLineTax`). Written by: till `chitOfDoc`. Read by: `tax-lines.invoiceFor` (its existing line key) via `tax-copy.entryFor` — their bill is taxed by the one engine. |
| folder rule `their_bill` (`folder-inventory` DOC_RULES) | — | Derived: `purpose = 'receipt'` with `business_json.their_bill.no` AND `.total` → doc `bill_received` (Bills · Received, B-2100). `tax-copy.capturedBill` / `billReceived` make the same test. |

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
