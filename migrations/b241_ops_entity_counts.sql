-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b241 — THE COUNTING SURFACE. Numbers from any table; rows from none.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14:
--
--   *"customer count, supplier count and so on for each one of the entities"*
--   *"from any table we should be able to take the count, not the details — data cannot be read, but the metrics
--    should be. if we can't read the metrics, then how to support the platform? otherwise we need to gain
--    supervisory access to do that, or something else. technically this should be possible."*
--
-- It is possible, and this is the whole of it. ⭐⭐ THE LINE IS BETWEEN A COUNT AND A ROW, not between a table we
-- may touch and one we may not. We run the platform: we have to be able to say "this shop has 14 customers"
-- without ever being able to say who they are. Those are different powers and only one of them is ours.
--
-- ── ⚠️⚠️ WHY THE OBVIOUS SUBQUERY RETURNS ZERO, SILENTLY ───────────────────────────────────────────────────────
--
-- /api/entities/mis already counts `suppliers` inline and it works — because `supplier_list` has no RLS. That is
-- a hole (tracked in BACKLOG.md), not a licence. The identical line against `customer_list` reads:
--
--     (SELECT count(*) FROM customer_list k WHERE k.owner_entity_id = i.identity_id)   -- ⚠️ always 0
--
-- `customer_list` is ENABLE + FORCE ROW LEVEL SECURITY (b49), cb_app is NOBYPASSRLS, and the operator route sets
-- no `app.current_entity` because it reads ACROSS shops — which is the entire point of it. FORCE RLS with no
-- entity set does not raise. It returns nothing. Every shop would have shown 0 customers and the screen would
-- have looked finished. [[feedback-silence-is-the-bug]]
--
-- ── ⭐ A REGISTRY, NOT FIVE HAND-WRITTEN COUNTERS ──────────────────────────────────────────────────────────────
--
-- Five functions would answer today and rot tomorrow: the sixth table gets added and nobody remembers this file
-- exists. So what is countable is DATA — one row in `ops.countable` per (table, owner column) — and the function
-- reads that registry. A new table becomes countable by inserting a row, reviewed like any other row, and the
-- registry doubles as the written answer to "what does the platform get to see?"
--
-- ⚠️ THE REGISTRY IS THE WHITELIST. The function builds SQL with format(%I), so a table name can only name a
--    real identifier, and can only be one an owner put in the registry. It is not a general query surface and
--    must never be given one: no WHERE from the caller, no columns from the caller, no row ever returned.
--
-- ⚠️ ONE AGGREGATE SCAN PER TABLE, not one per entity. `GROUP BY owner` costs five scans for the whole platform;
--    a correlated subquery per entity would have cost five × 2,500. The shape matters at this size.
--
-- ── ⭐ WHERE IT LIVES, AND WHY NOT `metrics` ───────────────────────────────────────────────────────────────────
--
-- b223 put that schema's charter in writing: *"Every view below returns a DISTRIBUTION — a bucket and a count of
-- shops in it — and never an entity_id."* Per-entity counts are exactly what that wall keeps out. `ops` (b224) is
-- the schema on the other side of it: it may see entity_id because it is for us, never for a dashboard.
--
-- ⚠️ b224 grants to cb_ops — a login role for a person at a psql prompt — so nothing it computes has ever
--    reached a screen. This grants EXECUTE on one function to cb_app, and nothing else in the schema.
--
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Structure needs OWNERSHIP: CREATE/ALTER/GRANT and triggers are refused to a role that merely has
--    rights on the rows. The rule of thumb for this repo:
--        structure, or data read ACROSS shops  → WITHOUT RLS (as the owner)
--        data written FOR ONE shop             → WITH RLS, so the database refuses a row that lands in
--                                                the wrong shop
-- ⚠️ Being the owner is NOT the same as bypassing RLS. A table marked FORCE ROW LEVEL SECURITY applies its
--    policies to its owner too — that is the whole difference between ENABLE and FORCE — so a statement
--    touching chit_header, customer_list, catalogue_items or cb_attachment can still be refused here.
-- Idempotent; safe to re-run, and safe to run WITHOUT b224.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE SCHEMA IF NOT EXISTS ops;

-- ── ⭐ THE REGISTRY — what the platform may count, one row per answer ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops.countable (
  metric        text PRIMARY KEY,                 -- the name the screen shows: 'customers', 'items', …
  table_name    text        NOT NULL,             -- ⚠️ quoted with %I at use; never interpolated raw
  owner_column  text        NOT NULL,             -- the column holding the entity's uuid
  distinct_on   text,                             -- count(DISTINCT this) — see the chit_header note below
  /* ⭐ SUM, NOT COUNT. Athi: *"how much space the entity is using and so on … everything to be derived from
     the tables."* Space used is a sum of a byte column, not a row count, and it is the same question — a
     number about their data, never their data. One extra column here rather than a second function. */
  sum_column    text,                             -- sum(this) instead of count(*)
  where_sql     text,                             -- a fixed predicate, written HERE by us, never by a caller
  note          text        NOT NULL,             -- why this count is ours to have. Not optional.
  enabled       boolean     NOT NULL DEFAULT true,
  added_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ops.countable IS
  'What the platform operator may COUNT. Rows here are effectively code: each one widens what ops.f_entity_counts '
  'can see. Counts only — this table can never cause a row, a name or a value to be returned.';

-- ⚠️ the registry is ours. No app role may read it, let alone write it: a shop that could read this would learn
--    the shape of the platform's supervision, and one that could write it would choose its own auditor.
REVOKE ALL ON ops.countable FROM PUBLIC;

INSERT INTO ops.countable (metric, table_name, owner_column, distinct_on, sum_column, where_sql, note) VALUES
  ('people',    'identities',      'parent_entity_id', NULL, NULL,
   'entity_kind = ''actor'' AND coalesce(status, ''active'') <> ''erased''',
   'Seats against the plan cap. ⚠️ Erased people are not seats — counting them over-states every shop against '
   'the exact number a bill would be raised from.'),

  ('items',     'catalogue_items', 'entity_id',        NULL, NULL,
   'is_active',
   'Catalogue size. ⚠️ LIVE items only: a shop that listed 400 and retired 390 has a catalogue of ten, and a '
   'roadmap or billing decision taken on 400 would be wrong.'),

  ('suppliers', 'supplier_list',   'owner_entity_id',  NULL, NULL, NULL,
   'Who they buy from — the count only. ⚠️ supplier_list keys on owner_entity_id, not entity_id.'),

  ('customers', 'customer_list',   'owner_entity_id',  NULL, NULL, NULL,
   'Who they sell to — the count only. This is the one the inline subquery silently read as 0, and the reason '
   'this whole file exists.'),

  ('chits',     'chit_header',     'sender_entity_id', 'chit_id', NULL, NULL,
   '⚠️ DISTINCT chit_id. chit_header holds ONE ROW PER PARTICIPANT COPY and a self-chit has two, so count(*) '
   'counts copies and over-states every shop. Sixth time this has had to be written down.'),

  -- ── ⭐ STORAGE. Two numbers about the same thing: how many files, and how many bytes. ───────────────────────
  ('files',     'cb_attachment',   'entity_id',        NULL, NULL, NULL,
   'How many files this entity is holding.'),

  ('bytes',     'cb_attachment',   'entity_id',        NULL, 'size', NULL,
   'Space used, in bytes. ⭐ `size` is the byte count whether the bytes live in the row (`data`) or in the '
   'object store (`object_key`) — b159 kept ONE size column across both, so this number does not change on the '
   'day STORAGE_ADAPTER flips. ⚠️ It is the sum of what was UPLOADED; the object store''s own billing is the '
   'authority on what is paid for, and the two will differ while orphans exist.')
ON CONFLICT (metric) DO UPDATE
  SET table_name = EXCLUDED.table_name, owner_column = EXCLUDED.owner_column,
      distinct_on = EXCLUDED.distinct_on, sum_column = EXCLUDED.sum_column,
      where_sql = EXCLUDED.where_sql, note = EXCLUDED.note;

-- ── ⭐⭐ THE FUNCTION — long form, so a new metric needs no signature change ─────────────────────────────────────
--
-- (entity_id, metric, n). The route pivots it. A wide return type would have to be edited every time the
-- registry grew, which is the coupling the registry exists to remove.
CREATE OR REPLACE FUNCTION ops.f_entity_counts()
RETURNS TABLE (entity_id uuid, metric text, n bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r   record;
  agg text;
BEGIN
  FOR r IN SELECT * FROM ops.countable WHERE enabled ORDER BY metric LOOP
    /* ⚠️ EVERY IDENTIFIER GOES THROUGH quote_ident/%I and comes from the registry, never from a caller.
       where_sql is a fixed string written in this file by us — it is not, and must never become, a
       caller-supplied filter. */
    agg := CASE
             /* ⚠️ coalesce: sum() over a column that is all NULLs returns NULL, and a NULL here would reach
                the screen as "unknown" when the honest answer is nothing stored yet. */
             WHEN r.sum_column  IS NOT NULL THEN 'coalesce(sum(' || quote_ident(r.sum_column) || '), 0)'
             WHEN r.distinct_on IS NOT NULL THEN 'count(DISTINCT ' || quote_ident(r.distinct_on) || ')'
             ELSE                                'count(*)'
           END;

    /* ⚠️ ONE `WHERE`. The owner-not-null test is always there, so the registry's predicate joins it with AND —
       emitting a second WHERE would be a syntax error on every row that has a where_sql and on none that
       doesn't, which is the kind of break that passes a smoke test. */
    RETURN QUERY EXECUTE format(
      'SELECT t.%I::uuid, %L::text, %s::bigint FROM %I t WHERE t.%I IS NOT NULL%s GROUP BY 1',
      r.owner_column, r.metric, agg, r.table_name, r.owner_column,
      CASE WHEN r.where_sql IS NULL THEN '' ELSE ' AND (' || r.where_sql || ')' END);
  END LOOP;
END
$fn$;

COMMENT ON FUNCTION ops.f_entity_counts() IS
  'Per-entity counts for every metric in ops.countable. SECURITY DEFINER so it reads through FORCE RLS. '
  'Returns counts and entity ids — never a row, a name or a value from the counted table.';

-- ⚠️ the format() above puts where_sql before the owner-not-null test, so a registry row with a broken
--    predicate fails HERE, loudly, the first time it is called — not by quietly counting zero.

-- ── the grants ─────────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ USAGE lets cb_app call into the schema; it grants nothing on the objects. EXECUTE on ONE function is the
--    entire surface — cb_app cannot reach ops.countable, ops.accounts, or any counted table through it.
GRANT USAGE   ON SCHEMA ops                     TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_entity_counts() TO cb_app;

-- ⚠️ THE WALL STAYS UP. cb_metrics feeds dashboards and must never reach a row carrying entity_id.
REVOKE ALL ON SCHEMA ops FROM cb_metrics;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ① what the platform may count, and on whose authority
SELECT metric, table_name, owner_column,
       CASE WHEN sum_column IS NOT NULL THEN 'sum(' || sum_column || ')'
            WHEN distinct_on IS NOT NULL THEN 'count(distinct ' || distinct_on || ')'
            ELSE 'count(*)' END AS reads, enabled
  FROM ops.countable ORDER BY metric;

-- ② the shops that have actually done something. ⚠️ If `customers` is 0 on EVERY row, the function is not
--    reading through RLS and something above is wrong — that is the exact failure this file was written to stop.
SELECT i.display_name, i.user_id, i.entity_kind,
       max(c.n) FILTER (WHERE c.metric = 'people')    AS people,
       max(c.n) FILTER (WHERE c.metric = 'items')     AS items,
       max(c.n) FILTER (WHERE c.metric = 'suppliers') AS suppliers,
       max(c.n) FILTER (WHERE c.metric = 'customers') AS customers,
       max(c.n) FILTER (WHERE c.metric = 'chits')     AS chits,
       max(c.n) FILTER (WHERE c.metric = 'files')     AS files,
       pg_size_pretty(max(c.n) FILTER (WHERE c.metric = 'bytes')) AS space_used,
       /* ⭐ the directory allocated to this entity. It is not stored anywhere — it IS the entity id, by the
          convention in lib/storage-object.js: <entity_id>/<yyyy>/<mm>/<attachment_id>. Derived, so it cannot
          drift from where the bytes actually went. */
       i.identity_id::text || '/' AS storage_prefix
  FROM ops.f_entity_counts() c
  JOIN identities i ON i.identity_id = c.entity_id
 GROUP BY 1, 2, 3, i.identity_id
HAVING sum(c.n) > 0
 ORDER BY chits DESC NULLS LAST, customers DESC NULLS LAST
 LIMIT 40;
