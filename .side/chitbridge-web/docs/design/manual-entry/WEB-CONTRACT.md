# ＋ Entry — what the page asks of the API (web side, `public/app/cap-entry.js`)

The page holds no rules and computes no money. This file is READ FROM THE MERGED API (chitbridge-api #20: `routes/books.js`, `lib/books-manual.js`,
`tests/books-preview*.test.cjs`); the stand-in in `e2e/manual-entry.cjs` speaks exactly these shapes.

| Call | Page sends | Page reads |
|---|---|---|
| `GET /api/books/events` | – | `events[]`: `kind`, `words`, `icon` (a name), `band`, `voucher`, `fields[]` (`{key, kind: amount\|date\|text\|lines\|pick, pick: mode\|expense_class\|income_class\|ledger, options?, group?, required}`), `preview`, `post`; an event with `route` / `preview:false` (asset, loan …) is NOT offered on the sheet. `picks{mode[], expense_class[{role,code,name}], income_class[…]}`. |
| `POST /api/books/preview` | `{event: <kind>, <field keys>…, amount_minor, date, lines?[{code, dr_minor \| cr_minor}]}` | `{ok, voucher{series:'MJ', type}, lines[{code, ledger, dr_minor, cr_minor, type:'personal\|real\|nominal', rule}], balanced, totals, flags[], refusals[] (plain sentences), code}` — nothing is written; a locked month is `code:'PERIOD_LOCKED'`. |
| `POST /api/books/events` | the preview body + `client_ref` (one per sheet, reused on retry) | `{entry_id, entry_no, voucher}` (owner only; a repeat client_ref answers the first entry) |
| `POST /api/books/entries/:id/reverse` | `{client_ref}` | `{entry_no}` of the mirror |
| `GET /api/books/daybook` rows | – | `entry_id`, `entry_no`, `event_type`, `reverses_entry_id`; a row offers Reverse unless it is itself a reversal |

Save is enabled only when `balanced === true` and `refusals` is empty. The lock check at the date is a preview with what is filled in so far,
of which only `code === 'PERIOD_LOCKED'` is read. Staff ledgers are the shop's own ledgers (no role) under "Stock & advances"; the server
still refuses a wrong one in words. Not on this API: attachments, a supplier on credit, a `fix` object on a refusal (the page offers "Change it"
and, for a locked month, "Pick another date").
