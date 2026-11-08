-- READ-2026-11-09-1-cur1-census.sql
-- ===========================================================================================================
-- READ-ONLY. ONE statement, ONE result set. It writes nothing, creates nothing (no table, no temp table, no
-- function, no SET), and the migration runner skips every file named READ-*. CUR-1 slice 2: the CENSUS.
-- Plan PM/CUR-1-PLAN-2026-11-08.md (rev 2) section 2.0; Athi's answers Q3, Q4, Q5 (PM/ATHI-DECISIONS.md 29f84958).
--
-- WHY: engines PR #111 makes the currency code strict (the ISO 4217 list, 165 codes, head 4e6721f7). Before it is
-- released we learn what the data really holds: every distinct currency value in every currency column and every
-- json slot, the codes NOT on the list (withdrawn BGN, HRK, CUC, SLL, ZWL among them: Athi decides), money rows
-- with no currency, chits whose copies disagree, the Country-setup stamp date against the chits (Q4), and the
-- chits that would go to the review list, with the test ones marked (Q5).
--
-- WHO RUNS IT: Athi, in the Supabase SQL editor, as the editor's role (postgres, bypasses RLS). It is plain SELECT
-- so it is also safe as any other role, but under FORCE ROW LEVEL SECURITY a role that is not the owner and has no
-- app.current_entity sees ZERO rows: the first rows ('meta', ...) say who ran it and how many chit headers it could
-- see. If 'chit_header_rows_visible' is 0 on a database that has chits, the role was filtered: run it as postgres.
-- It reads only information_schema, catalog functions and the shop tables, and runs a few dozen small scans
-- (the jsonb part scans each jsonb column once). Mock data: seconds. Do not run it in a busy hour on a big DB.
--
-- STEPS (copy the output back):
--   1. Supabase dashboard > SQL Editor > New query. Paste this WHOLE file. Press Run.
--   2. The result grid has 6 columns: section, a, b, c, d, n. Click the grid's "Download CSV" / "Copy as CSV"
--      (top right of the results), or select all cells and copy.
--   3. Paste the whole text into a file named census.csv (any editor), or send it as is.
--   4. Give it to Claude, or run it yourself:   node tools/cur1-census-read.cjs census.csv
--      (api repo; the reader accepts CSV, tab-separated copy, or psql -A output) and paste ITS answer back.
--   5. Nothing else is needed. Do not edit any value in the pasted output.
--
-- OUTPUT SHAPE (one row per fact):
--   meta    a=what                 n=value
--   code    a=table.column|table.column:jsonkey   b=the value found   c=class   n=rows
--           class: ISO | WITHDRAWN | MARKER (XXX XTS) | CASE_OR_SPACE_OF_ISO | BAD_SHAPE | NOT_ISO | NULL | EMPTY | NON_STRING
--   nocur   a=table  b=the filter that makes the row a money row   n=rows (c='total' is every row of the table)
--   detail  a=what (chit_detail rows)  n=rows
--   bucket  a=bucket b=held_by(test|real) c=stamp_class d=copies('copies_disagree' | '') n=chit copies
--   review  a=what n=rows  (review-list size; the bucket rows add up to chit_headers)
--   stamp   a=what n=value (Country-setup stamp)
--   check   a=what n=value
-- A "chit copy" is one chit_header row (chit_id, entity_id, direction): what b846 will process.
-- ===========================================================================================================
WITH
iso AS (
  SELECT unnest(string_to_array(
    'BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF BHD IQD JOD KWD LYD OMR TND CLF UYW '
 || 'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW '
 || 'CNY COP COU CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GTQ GYD HKD HNL HTG HUF IDR '
 || 'ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV '
 || 'MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD '
 || 'SSP STN SVC SYP SZL THB TJS TMT TOP TRY TTD TWD TZS UAH USD USN UYU UZS VED VES WST XCD XCG YER ZAR ZMW ZWG', ' ')) AS code
),
withdrawn AS (
  SELECT unnest(string_to_array(
    'BGN HRK CUC SLL ZWL VEF MRO STD ZWD ZWN ZWR ZMK BYR GHC TRL AZM ROL RUR CSD YUM LTL LVL EEK CYP MTL SKK SIT '
 || 'DEM FRF ITL ESP NLG ATS BEF FIM GRD IEP PTE LUF XDR XAU XAG XPT XPD XBA XBB XBC XBD XSU XUA', ' ')) AS code
),
-- ---- codes: every currency-named text column of every public base table, by value ----------------------
cols AS (
  SELECT c.table_schema, c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public'
     AND c.data_type IN ('text', 'character varying', 'character')
     AND c.column_name ~* '(^|_)(currency|ccy|cur)(_code)?$'
),
colcen AS (
  SELECT c.table_name || '.' || c.column_name AS src,
         replace(replace(replace((xpath('/row/code/text()', r))[1]::text, '&lt;', '<'), '&gt;', '>'), '&amp;', '&') AS code,
         ((xpath('/row/n/text()', r))[1])::text::bigint AS n,
         (xpath('/row/k/text()', r))[1]::text AS kind
    FROM cols c
   CROSS JOIN LATERAL unnest(xpath('/table/row', query_to_xml(format(
          'SELECT CASE WHEN %1$I IS NULL THEN ''NULL'' WHEN btrim(%1$I::text) = '''' THEN ''EMPTY'' ELSE left(%1$I::text, 40) END AS code, '
       || 'CASE WHEN %1$I IS NULL THEN ''n'' WHEN btrim(%1$I::text) = '''' THEN ''e'' ELSE ''v'' END AS k, count(*) AS n '
       || 'FROM %2$I.%3$I GROUP BY 1, 2', c.column_name, c.table_schema, c.table_name), false, false, ''))) r
),
-- ---- codes: every currency-like KEY at any depth of every json/jsonb column (summary_json.money, business_json, line_items,
--      payment, refunds, proposals, ...). One scan per column; the keys are DISCOVERED, so a slot nobody listed shows up. ----
jcols AS (
  SELECT c.table_schema, c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public' AND c.data_type IN ('jsonb', 'json')
),
jcen AS (
  SELECT c.table_name || '.' || c.column_name || ':' || (xpath('/row/key/text()', r))[1]::text AS src,
         replace(replace(replace((xpath('/row/code/text()', r))[1]::text, '&lt;', '<'), '&gt;', '>'), '&amp;', '&') AS code,
         ((xpath('/row/n/text()', r))[1])::text::bigint AS n,
         (xpath('/row/k/text()', r))[1]::text AS kind
    FROM jcols c
   CROSS JOIN LATERAL unnest(xpath('/table/row', query_to_xml(format(
          'SELECT e.key AS key, '
       || 'CASE jsonb_typeof(e.value) WHEN ''string'' THEN (CASE WHEN btrim(e.value #>> ''{}'') = '''' THEN ''EMPTY'' ELSE left(e.value #>> ''{}'', 40) END) '
       || 'ELSE ''NONSTRING:'' || jsonb_typeof(e.value) END AS code, '
       || 'CASE jsonb_typeof(e.value) WHEN ''string'' THEN (CASE WHEN btrim(e.value #>> ''{}'') = '''' THEN ''e'' ELSE ''v'' END) ELSE ''x'' END AS k, '
       || 'count(*) AS n '
       || 'FROM %2$I.%3$I t, '
       || 'LATERAL jsonb_path_query(t.%1$I::jsonb, ''strict $.** ? (@.type() == "object")'') o, '
       || 'LATERAL jsonb_each(o) e '
       || 'WHERE e.key ~* ''^([a-z]+_)*(currency|currencies|ccy|forcur|cur)(_?code)?$'' GROUP BY 1, 2, 3',
          c.column_name, c.table_schema, c.table_name), false, false, ''))) r
),
allcodes AS (
  SELECT src, code, n, kind FROM colcen
  UNION ALL SELECT src, code, n, kind FROM jcen
),
-- ---- money rows in tables that carry NO currency column at all (the audit's register 1a): row counts, no values to census ----
nocur_defs(tbl, money_filter) AS (
  VALUES ('chit_line',               'price IS NOT NULL'),
         ('chit_line_delivery',      'amount IS NOT NULL'),
         ('catalogue_item_version',  'price IS NOT NULL'),
         ('combo_templates',         'price IS NOT NULL'),
         ('customer_list',           'credit_limit_minor IS NOT NULL'),
         ('supplier_list',           'credit_limit_minor IS NOT NULL'),
         ('stock_balance',           'value <> 0 OR avg_cost <> 0'),
         ('stock_movement',          'rate IS NOT NULL OR value_delta IS NOT NULL'),
         ('supply_item',             'last_cost IS NOT NULL'),
         ('reward_ledger',           'points <> 0'),
         ('entity_wallet',           'credits_usd <> 0'),
         ('cb_chit_item',            'price <> 0 OR total <> 0'),
         ('cb_transaction_history',  'amount <> 0 OR total <> 0'),
         ('cb_external_reference',   'contact_visit_value <> 0 OR referral_value <> 0')
),
nocur_live AS MATERIALIZED (
  SELECT tbl, money_filter FROM nocur_defs WHERE to_regclass('public.' || tbl) IS NOT NULL
),
nocur AS (
  SELECT d.tbl, d.money_filter,
         ((xpath('/row/total/text()', r))[1])::text::bigint AS total_rows,
         ((xpath('/row/money/text()', r))[1])::text::bigint AS money_rows
    FROM nocur_live d
   CROSS JOIN LATERAL unnest(xpath('/table/row', query_to_xml(format(
          'SELECT count(*) AS total, count(*) FILTER (WHERE %2$s) AS money FROM public.%1$I', d.tbl, d.money_filter), false, false, ''))) r
),
-- ---- chit copies: the bucket rule b846 will apply (plan 2.0 / 2.3), per chit_header row (chit_id, entity_id, direction) ----
te AS (                      -- a test entity: the SAME predicate as migrations/purge_test_entities_1_LIST.sql
  SELECT identity_id FROM identities
   WHERE identity_type = 'entity'
     AND ( email ILIKE '%@test.example' OR email ILIKE '%@test-cb.com'
        OR user_id ILIKE 'e2eco-%' OR display_name ILIKE 'e2eco-%'
        OR user_id ILIKE 'e2e.pool%' OR display_name ILIKE 'E2E Pool%' )
),
h AS (
  SELECT ch.chit_id, ch.entity_id, ch.direction, ch.sender_entity_id,
         coalesce(ch.sent_at, ch.created_at) AS chit_at,
         ARRAY(SELECT DISTINCT v FROM unnest(ARRAY[
                 NULLIF(btrim(ch.business_json->>'currency'), ''),
                 NULLIF(btrim(ch.summary_json->>'currency_code'), ''),
                 NULLIF(btrim(ch.summary_json->'money'->>'currency_code'), '')]) v
               WHERE v IS NOT NULL ORDER BY 1) AS stated,
         ((ch.summary_json ? 'money') OR NULLIF(ch.summary_json->>'total_value', '') IS NOT NULL) AS has_money
    FROM chit_header ch
),
d AS (
  SELECT chit_id, entity_id, direction,
         ARRAY(SELECT DISTINCT c FROM unnest(array_agg(currency_code)) c WHERE c IS NOT NULL ORDER BY 1) AS dcodes,
         bool_or(currency_code IS NULL) AS d_null,
         bool_or(coalesce(total_value, 0) <> 0) AS d_money
    FROM chit_detail GROUP BY chit_id, entity_id, direction
),
cc AS (                      -- one chit_id, copies in different currencies ("two documents", lib/mint.js:89)
  SELECT chit_id FROM chit_detail WHERE currency_code IS NOT NULL
   GROUP BY chit_id HAVING count(DISTINCT currency_code) > 1
),
gov AS (SELECT entity_id, country_setup_at FROM entity_governance),
copies AS (
  SELECT CASE
           WHEN cardinality(h.stated) > 1                                                       THEN 'stated_disagrees'
           WHEN cardinality(coalesce(d.dcodes, '{}')) > 1                                       THEN 'detail_rows_disagree'
           WHEN cardinality(h.stated) = 1 AND cardinality(coalesce(d.dcodes, '{}')) = 1
                AND h.stated[1] <> d.dcodes[1]                                                  THEN 'detail_vs_stated'
           WHEN cardinality(h.stated) = 1                                                       THEN 'stated'
           WHEN cardinality(coalesce(d.dcodes, '{}')) = 1 AND NOT d.d_null                      THEN 'detail'
           WHEN cardinality(coalesce(d.dcodes, '{}')) = 1                                       THEN 'detail_partly_null'
           WHEN h.has_money OR coalesce(d.d_money, false)                                       THEN 'money_without_currency'
           ELSE 'none' END AS bucket,
         CASE WHEN h.entity_id IN (SELECT identity_id FROM te) THEN 'test' ELSE 'real' END AS held_by,
         CASE WHEN g.entity_id IS NULL                                  THEN 'no_governance_row'
              WHEN g.country_setup_at IS NULL                           THEN 'stamp_null'
              WHEN h.chit_at IS NULL OR g.country_setup_at > h.chit_at  THEN 'stamp_after_chit'
              WHEN NULLIF(btrim(si.currency_code), '') IS NULL          THEN 'stamp_before_sender_currency_missing'
              ELSE 'stamp_before_chit' END AS stamp_class,
         CASE WHEN h.chit_id IN (SELECT chit_id FROM cc) THEN 'copies_disagree' ELSE '' END AS copies_flag,
         h.chit_id, h.entity_id
    FROM h
    LEFT JOIN d   ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id AND d.direction = h.direction
    LEFT JOIN gov g ON g.entity_id = h.sender_entity_id
    LEFT JOIN identities si ON si.identity_id = h.sender_entity_id
),
-- ---- the Country-setup stamp (Q4): entity_governance.country_setup_at, set when the owner completes Country setup ----
stampfacts AS (
  SELECT 'entities_with_governance_row' AS what, count(*)::text AS v FROM gov
  UNION ALL SELECT 'stamp_set',     count(*)::text FROM gov WHERE country_setup_at IS NOT NULL
  UNION ALL SELECT 'stamp_null',    count(*)::text FROM gov WHERE country_setup_at IS NULL
  UNION ALL SELECT 'stamp_earliest', coalesce(min(country_setup_at)::text, '') FROM gov
  UNION ALL SELECT 'stamp_latest',   coalesce(max(country_setup_at)::text, '') FROM gov
  UNION ALL SELECT 'entities_stamp_after_their_first_sent_chit', count(*)::text
    FROM gov g WHERE g.country_setup_at IS NOT NULL
     AND g.country_setup_at > (SELECT min(coalesce(x.sent_at, x.created_at)) FROM chit_header x WHERE x.sender_entity_id = g.entity_id)
  UNION ALL SELECT 'entities_with_identity_currency_null_or_empty', count(*)::text
    FROM identities WHERE identity_type = 'entity' AND NULLIF(btrim(currency_code), '') IS NULL
)
-- =========================== the one result set ===========================
SELECT section, a, b, c, d, n FROM (
  SELECT 1 AS o, 'meta' AS section, 'current_user' AS a, '' AS b, '' AS c, '' AS d, current_user::text AS n
  UNION ALL SELECT 1, 'meta', 'role_bypasses_rls', '', '', '', (SELECT rolbypassrls::text FROM pg_roles WHERE rolname = current_user)
  UNION ALL SELECT 1, 'meta', 'is_superuser', '', '', '', current_setting('is_superuser', true)
  UNION ALL SELECT 1, 'meta', 'server_version', '', '', '', current_setting('server_version')
  UNION ALL SELECT 1, 'meta', 'ran_at', '', '', '', now()::text
  UNION ALL SELECT 1, 'meta', 'iso_list_size', '', '', '', (SELECT count(*)::text FROM iso)
  UNION ALL SELECT 1, 'meta', 'iso_list_source', '', '', '', 'engines PR 111 head 4e6721f7 src/money.js ISO_4217'
  UNION ALL SELECT 1, 'meta', 'chit_header_rows_visible', '', '', '', (SELECT count(*)::text FROM chit_header)
  UNION ALL SELECT 1, 'meta', 'currency_text_columns_scanned', '', '', '', (SELECT count(*)::text FROM cols)
  UNION ALL SELECT 1, 'meta', 'json_columns_scanned', '', '', '', (SELECT count(*)::text FROM jcols)
  UNION ALL SELECT 2, 'code', a.src, a.code,
         CASE WHEN a.kind = 'n' THEN 'NULL' WHEN a.kind = 'e' THEN 'EMPTY' WHEN a.kind = 'x' THEN 'NON_STRING'
              WHEN a.code IN (SELECT code FROM iso) THEN 'ISO'
              WHEN a.code IN (SELECT code FROM withdrawn) THEN 'WITHDRAWN'
              WHEN a.code IN ('XXX', 'XTS') THEN 'MARKER'
              WHEN upper(btrim(a.code)) IN (SELECT code FROM iso) THEN 'CASE_OR_SPACE_OF_ISO'
              WHEN a.code !~ '^[A-Z]{3}$' THEN 'BAD_SHAPE'
              ELSE 'NOT_ISO' END,
         '', a.n::text
    FROM allcodes a
  UNION ALL SELECT 3, 'nocur', t.tbl, t.money_filter, 'money', '', t.money_rows::text FROM nocur t
  UNION ALL SELECT 3, 'nocur', t.tbl, '', 'total', '', t.total_rows::text FROM nocur t
  UNION ALL SELECT 4, 'detail', 'chit_detail_rows', '', '', '', (SELECT count(*)::text FROM chit_detail)
  UNION ALL SELECT 4, 'detail', 'chit_detail_money_rows_currency_null', '', '', '',
         (SELECT count(*)::text FROM chit_detail WHERE currency_code IS NULL AND coalesce(total_value, 0) <> 0)
  UNION ALL SELECT 4, 'detail', 'chit_detail_money_rows_currency_empty', '', '', '',
         (SELECT count(*)::text FROM chit_detail WHERE btrim(currency_code) = '' AND coalesce(total_value, 0) <> 0)
  UNION ALL SELECT 4, 'detail', 'chit_ids_copies_in_different_currencies', '', '', '', (SELECT count(*)::text FROM cc)
  UNION ALL SELECT 5, 'bucket', bucket, held_by, stamp_class, copies_flag, count(*)::text FROM copies GROUP BY bucket, held_by, stamp_class, copies_flag
  UNION ALL SELECT 6, 'review', 'review_copies_total', '', '', '',
         (SELECT count(*)::text FROM copies
           WHERE bucket IN ('stated_disagrees', 'detail_rows_disagree', 'detail_vs_stated', 'detail_partly_null', 'money_without_currency')
              OR copies_flag = 'copies_disagree')
  UNION ALL SELECT 6, 'review', 'review_copies_test_held', '', '', '',
         (SELECT count(*)::text FROM copies
           WHERE held_by = 'test'
             AND (bucket IN ('stated_disagrees', 'detail_rows_disagree', 'detail_vs_stated', 'detail_partly_null', 'money_without_currency')
               OR copies_flag = 'copies_disagree'))
  UNION ALL SELECT 6, 'review', 'review_chits_with_a_test_copy_and_a_real_copy', '', '', '',
         (SELECT count(*)::text FROM (
            SELECT chit_id FROM copies
             WHERE bucket IN ('stated_disagrees', 'detail_rows_disagree', 'detail_vs_stated', 'detail_partly_null', 'money_without_currency')
                OR copies_flag = 'copies_disagree'
             GROUP BY chit_id HAVING bool_or(held_by = 'test') AND bool_or(held_by = 'real')) x)
  UNION ALL SELECT 7, 'stamp', what, '', '', '', v FROM stampfacts
  UNION ALL SELECT 8, 'check', 'chit_headers', '', '', '', (SELECT count(*)::text FROM chit_header)
  UNION ALL SELECT 8, 'check', 'bucket_rows_total', '', '', '', (SELECT count(*)::text FROM copies)
) q
ORDER BY o, section, a, b, c, d;
