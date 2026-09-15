-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b242 — STANDING. Is this shop alive, and if not, which kind of not?
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"now bring b224 standing as a column"* — and, earlier: *"each shops last status, when last
-- sign-in?"*
--
-- ⭐⭐ THE ONE NUMBER THE PLATFORM SCREEN COULD NOT SHOW. Every column on it so far is an account fact: who they
-- are, when they registered, how many staff. None of them says whether the product WORKS for this shop. A shop
-- with 58 products, 20 staff and no chits is the most urgent row on the platform and looked identical to a
-- thriving one.
--
-- ── ⭐ WHY NOT JUST RUN b224 ────────────────────────────────────────────────────────────────────────────────────
--
-- b224 computes this ladder inside ops.f_accounts() and it has never reached a screen, for three reasons:
--
--   1. It filters `entity_kind = 'customer'`. Right for an account sheet, wrong for the Platform screen, which
--      lists network nodes, internal entities and test fixtures too.
--   2. It grants to cb_ops — a login role for a person at a psql prompt. The API cannot call it.
--   3. It returns eleven columns. The route already has ten of them from `identities`, and a function that
--      re-returns them is a second source that will drift from the first.
--
-- ── ⭐⭐ AND WHY THIS IS SQL AND NOT THREE LINES OF JAVASCRIPT ──────────────────────────────────────────────────
--
-- Everything the ladder needs is ALREADY on the client: quiet days from the row, chits and items from b241's
-- counting surface. Computing it there would have worked and would have been wrong — because the list is capped
-- at 100 rows. Sorted or filtered in the browser, "show me everyone who registered and never used it" searches
-- one page of 2,509 and answers confidently from 4% of the data. Standing has to be a column the DATABASE can
-- ORDER BY, or the question it exists to answer cannot be asked.
--
-- ── ⚠️ THE LADDER IS DEFINED ONCE ──────────────────────────────────────────────────────────────────────────────
--
-- ops.f_standing_of() is a scalar function, so the thresholds live in exactly one place. b224's inline CASE is
-- the same ladder written a second time; when b224 is run, that CASE should become a call to this. Two copies of
-- a threshold is how "lapsed" comes to mean 90 days on one screen and 60 on another.
--
-- ⚠️ ORDER MATTERS AND THE WORST CASE WINS. A shop that never came back after signing up is a different problem
--    from one that used the product and drifted away, and collapsing them loses the only distinction that
--    changes what we should do about it.
--
-- ⚠️ SORT PREFIXES ('a · ', 'b · ') ARE DELIBERATE. A plain ORDER BY standing then reads worst-first without a
--    CASE at every call site. The screen strips the prefix before showing it.
--
-- ⚠️ REQUIRES b241 for the schema and the grant pattern; safe to run without b224.
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Structure needs OWNERSHIP: CREATE/ALTER/GRANT and triggers are refused to a role that merely has
--    rights on the rows. The rule of thumb for this repo:
--        structure, or data read ACROSS shops  → WITHOUT RLS (as the owner)
--        data written FOR ONE shop             → WITH RLS, so the database refuses a row that lands in
--                                                the wrong shop
-- ⚠️ Being the owner is NOT the same as bypassing RLS. A table marked FORCE ROW LEVEL SECURITY applies its
--    policies to its owner too — that is the whole difference between ENABLE and FORCE — so a statement
--    touching chit_header, customer_list, catalogue_items or cb_attachment can still be refused here.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE SCHEMA IF NOT EXISTS ops;

-- ── ⭐ THE LADDER, ONCE ─────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ STABLE, not IMMUTABLE: it reads now(). Marking it IMMUTABLE would let postgres cache a verdict across
--    statements and a shop would stay 'active' for as long as the plan lived.
CREATE OR REPLACE FUNCTION ops.f_standing_of(p_last_active timestamp, p_chits bigint, p_items bigint)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_last_active IS NULL                                        THEN 'a · never signed in'
    /* ⭐ REGISTERED BUT NEVER USED — the most important rung. A registration count on its own flatters: every
       abandoned signup counts once and looks like growth. Signed in, but has neither sent a chit nor listed a
       product, is the shop we have not actually won yet. */
    WHEN coalesce(p_chits, 0) = 0 AND coalesce(p_items, 0) = 0        THEN 'b · registered, never used'
    WHEN p_last_active < now()::timestamp - interval '90 days'        THEN 'c · lapsed (90d+)'
    WHEN p_last_active < now()::timestamp - interval '30 days'        THEN 'd · drifting (30d+)'
    WHEN p_last_active < now()::timestamp - interval '7 days'         THEN 'e · quiet (7d+)'
    ELSE                                                                   'f · active'
  END
$$;

COMMENT ON FUNCTION ops.f_standing_of(timestamp, bigint, bigint) IS
  'The standing ladder, defined once. Worst case first. Anything needing a shop''s standing calls this rather '
  'than writing the thresholds again.';

-- ── ⭐ ONE ROW PER ENTITY ───────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ TWO AGGREGATE SCANS, NOT TWO SUBQUERIES PER ENTITY. Same shape as b241 and for the same reason: correlated
--    subqueries here would cost 2 × 2,509 executions to answer one column.
--
-- ⚠️ `identities.last_active_at` is `timestamp WITHOUT time zone` while now() is timestamptz. Subtracting them
--    directly makes postgres coerce via the server timezone — a silent off-by-hours on a UTC database read from
--    IST. now()::timestamp keeps both sides naive; that is why f_standing_of takes a plain timestamp.
-- ⚠️ DROP FIRST. `CREATE OR REPLACE` may change a body but NEVER a row type, so the first time this function
--    gains an output column it raises `42P13: cannot change return type of existing function`. Dropping also
--    drops the GRANT, which is why one is re-issued below — forget it and the function works in the SQL editor
--    and is invisible to cb_app.
DROP FUNCTION IF EXISTS ops.f_entity_standing();
CREATE OR REPLACE FUNCTION ops.f_entity_standing()
RETURNS TABLE (entity_id uuid, standing text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ch AS (
    SELECT sender_entity_id AS e, count(DISTINCT chit_id)::bigint AS n
      FROM chit_header WHERE sender_entity_id IS NOT NULL GROUP BY 1
  ), it AS (
    SELECT entity_id AS e, count(*)::bigint AS n
      FROM catalogue_items WHERE is_active AND entity_id IS NOT NULL GROUP BY 1
  )
  SELECT e.identity_id,
         ops.f_standing_of(e.last_active_at, ch.n, it.n)
    FROM identities e
    LEFT JOIN ch ON ch.e = e.identity_id
    LEFT JOIN it ON it.e = e.identity_id
   /* ⭐ EVERY KIND, unlike b224 — the Platform screen lists them all. */
   WHERE e.identity_type = 'entity' AND coalesce(e.status, 'active') <> 'erased'
$$;

COMMENT ON FUNCTION ops.f_entity_standing() IS
  'Per-entity standing for every kind. SECURITY DEFINER so it can see chit_header and catalogue_items, which '
  'are FORCE RLS. Returns a verdict and an entity id — never a chit, a product, or anything about either.';

GRANT USAGE   ON SCHEMA ops                       TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_entity_standing() TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_standing_of(timestamp, bigint, bigint) TO cb_app;

-- ⚠️ THE WALL STAYS UP. cb_metrics feeds dashboards and must never reach a row carrying entity_id.
REVOKE ALL ON SCHEMA ops FROM cb_metrics;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — the roll-call first, because a distribution is what you read before a list.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT s.standing, count(*) AS entities,
       count(*) FILTER (WHERE i.entity_kind = 'customer') AS real_customers
  FROM ops.f_entity_standing() s
  JOIN identities i ON i.identity_id = s.entity_id
 GROUP BY 1 ORDER BY 1;

-- ⚠️ THE ROWS THAT SHOULD WORRY US: real customers who signed in and never did anything.
SELECT i.display_name, i.user_id, i.created_at::date AS joined, i.last_active_at::date AS last_seen, s.standing
  FROM ops.f_entity_standing() s
  JOIN identities i ON i.identity_id = s.entity_id
 WHERE i.entity_kind = 'customer' AND s.standing < 'c'
 ORDER BY s.standing, i.created_at;
