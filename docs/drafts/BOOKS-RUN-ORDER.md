# Books v2 — the SQL to run, in order

Three files, in the Supabase SQL editor, one at a time, **in this order**. Each is safe to run twice. After each one, run
its check below — the editor shows only the last result, so each check is a single row.

Creating these tables changes nothing a shop sees: nothing is written to them until a shop's switch
(`books_setting.enabled`) is turned on, and the server keeps them out of every screen until then.

| # | File | What it adds |
|---|---|---|
| 1 | `migrations/b272_books_ledger.sql` | the switch per shop, the chart of accounts, the months, the number series, `ops.f_books_enabled()` |
| 2 | `migrations/b273_books_journal.sql` | the journal (insert-only), the monthly balances, the open items per party, payments, the waiting list, the change log |
| 3 | `migrations/b274_books_party.sql` | party number, legal name, credit days/limit, state, merged-into on the customer and supplier lists; tax ids; the handover packs |

## 1 · after b272 — expect `4 | 4 | 1`

```sql
SELECT
  (SELECT count(*) FROM pg_class WHERE relname IN ('books_setting','ledger_account','fiscal_period','books_counter')
     AND relrowsecurity AND relforcerowsecurity)                                                   AS forced_tables,
  (SELECT count(*) FROM pg_policies WHERE policyname = 'rls_entity'
     AND tablename IN ('books_setting','ledger_account','fiscal_period','books_counter'))           AS policies,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'ops' AND p.proname = 'f_books_enabled')                                    AS ops_function;
```

## 2 · after b273 — expect `7 | 7 | 5 | 0`

The last column is the proof that the journal cannot be changed: how many of the five insert-only tables `cb_app` may
UPDATE or DELETE — it must be **0**.

```sql
SELECT
  (SELECT count(*) FROM pg_class WHERE relname IN ('journal_entry','journal_line','account_balance','party_item',
     'books_payment','books_outbox','books_change_log') AND relrowsecurity AND relforcerowsecurity) AS forced_tables,
  (SELECT count(*) FROM pg_constraint WHERE conname IN ('journal_line_entry_fkey','journal_line_account_fkey',
     'journal_entry_reverses_fkey','account_balance_account_fkey','party_item_account_fkey','party_item_entry_fkey',
     'party_item_payment_fkey'))                                                                   AS foreign_keys,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('journal_entry_insert_only','journal_line_insert_only',
     'party_item_insert_only','books_change_log_insert_only','books_payment_insert_only'))        AS insert_only_triggers,
  (SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'cb_app'
     AND privilege_type IN ('UPDATE','DELETE') AND table_name IN ('journal_entry','journal_line','party_item',
     'books_payment','books_change_log'))                                                          AS cb_app_can_change;
```

## 3 · after b274 — expect `7 | 6 | 2 | 1 | <customers> | <suppliers>`

The last two are the row counts of the two lists — they must equal what they were before (nothing is removed; only
empty columns are added).

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'customer_list' AND column_name IN
     ('nickname','legal_name','party_no','credit_days','credit_limit_minor','state_code','merged_into'))   AS customer_cols,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'supplier_list' AND column_name IN
     ('legal_name','party_no','credit_days','credit_limit_minor','state_code','merged_into'))              AS supplier_cols,
  (SELECT count(*) FROM pg_class WHERE relname IN ('party_tax_id','books_pack')
     AND relrowsecurity AND relforcerowsecurity)                                                          AS forced_tables,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'party_tax_id_party_fkey')                          AS foreign_keys,
  (SELECT count(*) FROM customer_list)                                                                    AS customers,
  (SELECT count(*) FROM supplier_list)                                                                    AS suppliers;
```

## Then — nothing more until the switch

Books stay off for every shop. Turning them on for one shop is a separate, deliberate step (after the engines v1.8.0
are adopted and the server is deployed): `POST /api/books/enable` from that shop's owner account seeds its chart from
the India pack and its months, and sets the switch. There is no SQL for it.

⚠️ If any check shows a different number, stop and send the row — do not run the next file.

## After all three — one refresh, no SQL

The row-level-security snapshot (`db/rls-baseline.json`) is what the guards compare against; the 13 new tables are not
in it until it is taken again: `railway run node scripts/rls-census.cjs --save` (it only reads), then commit the file.
Until then the new tables are guarded by `tests/books-writer.test.cjs` instead (FORCE RLS in the SQL, and each table in
the server's tripwire list).
