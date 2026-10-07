# FIELDS: response keys the API adds (dictionary)

A new key needs its entry here, in the same change. This file is being built; entries start from 2026-10-02.

## GET /api/books/bs

| Key | Shape | Meaning |
|---|---|---|
| `schedule_iii` | object | The balance sheet as Schedule III prints it. A regrouping of what `CBLedger.balanceSheet()` returned; no second calculation. Added beside the old flat keys (`assets`, `liabilities`, `equity`, `total_assets_minor`, `total_liab_equity_minor`, `by_line`), which are unchanged. |
| `schedule_iii.equity_and_liabilities` / `.assets` | `{ heads: [{ line, label, total_minor, ledgers: [{ code, name, amount_minor }] }], total_minor }` | One side. `heads` follow the pack's Schedule III order. `total_minor` is the sum of that side's head totals. Amounts keep their sign. |
| `ledgers[].code` | string or null | null only for the year's profit line. |
| the profit line | `{ code: null, name: "Net profit" or "Net loss", amount_minor, role: "profit_to_date" }` | Sits in the `reserves_surplus` head (the owner's funds). Named "Net loss" when negative. |
| `schedule_iii.balanced` | boolean | `assets.total_minor === equity_and_liabilities.total_minor`. |
| `schedule_iii.difference_minor` | integer | `assets.total_minor - equity_and_liabilities.total_minor`. Never hidden; 0 when balanced. |

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

## chit header · `business_json.page` (N03, 2026-10-07 · decisions M-D6 / M-D7)

| Key | Shape | Source / derived · who writes it · who reads it |
|---|---|---|
| `business_json.page` | string `<kind>.<vertical>.<face>@<major.minor>`, e.g. `chit.base.detail@1.0` | Source. Which detail page the chit was made with. Written ONCE by `POST /api/chits/send` (`mint.page()`) on every copy that carries business data — sender, receivers, a bill copy; the sender may name one in `business_json.page` (a name alone takes its newest version), otherwise the base page. A promoted draft keeps its own unless the resend names one. Never written afterwards: every later `business_json` write is a merge-patch of its own key (`tests/page-name.test.cjs`). Read by the app's `CBPage.resolve()` to open the chit. |
| (refusal) `code: 'PAGE_UNKNOWN'` | 400 `{ error, code, message }` | A name or version the registry does not have, a reserved name (`sale.restaurant.table`, `service.repair.job`), or a non-string. Refused at mint only, before anything is written. Opening never refuses: an unknown name or version opens the base page with the note "made with X@v — page not installed". |
| the registry | `data/pages.json` `{ grammar, base, pages: [{ name, version, script, says }], reserved: [] }` | A byte copy of the master, chitbridge-web `public/app/pages.json`. One row per name@version; rows are kept when a version ships. minor = a compatible body change, major = a header or action change. |
| absent `page` | — | A chit minted before N03, or by a path that is not `/chits/send` (signal chits, network edges, storefront orders, the operator's redacted copy). Read as the base page — what it was made with — with no note. |
