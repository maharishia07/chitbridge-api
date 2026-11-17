-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b151 — the METRICS schema: operator dashboards that CANNOT read a tenant's order book.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-14: *"do we have any proper reporting tool like powerbi kind of which can be integrated … rather
-- than we handcraft something?"*
--
-- Yes — Metabase, self-hosted. But a BI tool connects with ONE database role and never calls
-- `set_config('app.current_entity', …)`. Pointed at these tables it either sees nothing (RLS denies) or, the way
-- people "fix" that, it is handed a BYPASSRLS role and sees EVERY tenant at once. The second outcome is the worst
-- failure this system can produce, and it arrives as a convenience.
--
-- ⚠️ SO THE REPORTING ROLE NEVER TOUCHES A TABLE. It is granted USAGE on `metrics` and SELECT on the views below,
-- and NOTHING else — no `public` schema access at all. Every view is an AGGREGATE: counts, sums, day buckets. No
-- particulars, no party names, no subjects, no amounts attributable to one entity. If Metabase is misconfigured,
-- if a dashboard is shared, if the password leaks — the blast radius is "how many chits were sent on Tuesday".
--
-- ⚠️ THIS RELAXES NOTHING. No policy is dropped, no FORCE ROW LEVEL SECURITY is removed, no existing grant widens.
-- `cb_app` is untouched. The definer functions are a NEW, NARROW hole shaped like a report — which is the only
-- honest way to answer a cross-tenant question on a per-tenant rail.
--
-- ── ⭐ THE ONE ARITHMETIC TRAP, FOR THE THIRD TIME ──────────────────────────────────────────────────────────────
-- `chit_header` and `chit_status` hold ONE ROW PER PARTICIPANT COPY. `count(*)` over them does not count chits —
-- it counts copies, and a self-chit has two. That mistake has now been made three times in this codebase: the
-- worklist showed every person double, b150 recorded every delivery twice, and it would land here as a platform
-- that looks twice as busy as it is. EVERY count below is `count(DISTINCT chit_id)`. Do not "simplify" one.
--
-- Safe to re-run. Run AFTER deploying nothing in particular — this migration is standalone.

CREATE SCHEMA IF NOT EXISTS metrics;

-- ── the reporting role ────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ Create it with a real password OUT OF BAND, then run this file. A password does not belong in a migration
-- that lives in git:
--     CREATE ROLE cb_metrics LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_metrics') THEN
    RAISE EXCEPTION 'b151: role cb_metrics does not exist. Create it first with a generated password (see header) — this migration deliberately does not set one.';
  END IF;
  -- Belt and braces: the report role must never be able to step over RLS on its own.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_metrics' AND rolbypassrls) THEN
    RAISE EXCEPTION 'b151: cb_metrics has BYPASSRLS. That defeats the entire point of this schema. ALTER ROLE cb_metrics NOBYPASSRLS;';
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM cb_metrics;
GRANT USAGE ON SCHEMA metrics TO cb_metrics;

-- ── ① VOLUME — chits per day, by purpose ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION metrics.f_chits_daily()
RETURNS TABLE (day date, purpose text, chits bigint, senders bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT date_trunc('day', h.created_at)::date       AS day,
         h.purpose::text                              AS purpose,
         count(DISTINCT h.chit_id)                    AS chits,     -- ⚠️ DISTINCT: one row per copy
         count(DISTINCT h.sender_entity_id)           AS senders
    FROM chit_header h
   GROUP BY 1, 2
$$;
CREATE OR REPLACE VIEW metrics.chits_daily AS SELECT * FROM metrics.f_chits_daily();

-- ── ② LIFECYCLE — where work is sitting right now ─────────────────────────────────────────────────────────────
-- The funnel Athi walks in the seed script: pending → accepted → in_progress → partial → completed / cancelled.
CREATE OR REPLACE FUNCTION metrics.f_lifecycle_now()
RETURNS TABLE (current_status text, chits bigint, oldest_days integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.current_status::text                                        AS current_status,
         count(DISTINCT s.chit_id)                                     AS chits,
         max(extract(day FROM now() - s.created_at))::integer          AS oldest_days
    FROM chit_status s
   WHERE s.deleted_at IS NULL
   GROUP BY 1
$$;
CREATE OR REPLACE VIEW metrics.lifecycle_now AS SELECT * FROM metrics.f_lifecycle_now();

-- ── ③ ADOPTION — entities and co-assists ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION metrics.f_entities_daily()
RETURNS TABLE (day date, identity_type text, created bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT date_trunc('day', i.created_at)::date AS day,
         i.identity_type::text                 AS identity_type,   -- entity vs actor (co-assist)
         count(*)                              AS created
    FROM identities i
   GROUP BY 1, 2
$$;
CREATE OR REPLACE VIEW metrics.entities_daily AS SELECT * FROM metrics.f_entities_daily();

-- ── ④ ⭐ THE CAPTURE FUNNEL — does a WhatsApp message actually become a chit? ──────────────────────────────────
-- This is the number the whole capture-connector thread is judged on, and nothing has ever displayed it.
CREATE OR REPLACE FUNCTION metrics.f_capture_funnel()
RETURNS TABLE (day date, channel text, status text, messages bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT date_trunc('day', c.created_at)::date AS day,
         c.channel::text                       AS channel,
         c.status::text                        AS status,          -- pending | converted | dismissed
         count(*)                              AS messages
    FROM capture c
   GROUP BY 1, 2, 3
$$;
CREATE OR REPLACE VIEW metrics.capture_funnel AS SELECT * FROM metrics.f_capture_funnel();

-- ── ⑤ AI SPEND — the platform-shared key, bounded by AI_GLOBAL_DAILY_USD ──────────────────────────────────────
-- ⚠️ `detail` is the skill_id, which is a closed vocabulary we author. It is NOT free text and carries no tenant
-- content — the only column here that could, and the reason it is named explicitly rather than `select *`.
CREATE OR REPLACE FUNCTION metrics.f_ai_daily()
RETURNS TABLE (day date, meter text, skill text, calls bigint, cost_usd numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT date_trunc('day', u.created_at)::date AS day,
         u.meter                               AS meter,
         u.detail                              AS skill,
         count(*)                              AS calls,
         round(sum(u.cost_usd), 4)             AS cost_usd
    FROM usage_ledger u
   GROUP BY 1, 2, 3
$$;
CREATE OR REPLACE VIEW metrics.ai_daily AS SELECT * FROM metrics.f_ai_daily();

-- ── ⑥ DELIVERY HEALTH — counts only, never a summed quantity ──────────────────────────────────────────────────
-- ⚠️ NO `sum(quantity)` ANYWHERE. Lines are ordered in kg, litre, piece and கட்டு, and a dashboard that adds them
-- prints a number nobody can act on — the exact bug just fixed in lib/deliverline.js, which would be reintroduced
-- here in a place with no tests. Counting lines is always honest; summing across units never is.
CREATE OR REPLACE FUNCTION metrics.f_delivery_health()
RETURNS TABLE (day date, lines_with_delivery bigint, delivery_events bigint, correcting_entries bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT date_trunc('day', d.delivered_at)::date          AS day,
         count(DISTINCT d.line_id)                        AS lines_with_delivery,
         count(DISTINCT d.delivery_id)                    AS delivery_events,
         count(DISTINCT d.delivery_id) FILTER (WHERE d.quantity < 0) AS correcting_entries
    FROM chit_line_delivery d
   GROUP BY 1
$$;
CREATE OR REPLACE VIEW metrics.delivery_health AS SELECT * FROM metrics.f_delivery_health();

-- ── grants: the views only. Never the functions, never public. ────────────────────────────────────────────────
GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO cb_metrics;   -- views count as tables here
ALTER DEFAULT PRIVILEGES IN SCHEMA metrics GRANT SELECT ON TABLES TO cb_metrics;

DO $$
DECLARE leaks int;
BEGIN
  -- ⚠️ A STANDING CHECK, not a one-off. The next person to add a view here will not read this header, so the
  -- migration asserts the property instead of describing it: nothing in `metrics` may expose a row identifier.
  SELECT count(*) INTO leaks
    FROM information_schema.columns
   WHERE table_schema = 'metrics'
     AND column_name IN ('entity_id', 'chit_id', 'line_id', 'identity_id', 'particulars',
                         'manual_subject', 'auto_subject', 'sender_entity_display_name', 'raw_text');
  IF leaks > 0 THEN
    RAISE EXCEPTION 'b151: a metrics view exposes % row-identifying column(s). Aggregate it or drop it — this schema is readable by a BI tool with no entity context.', leaks;
  END IF;
  RAISE NOTICE 'b151: metrics schema ready — 6 aggregate views, no row-identifying columns, cb_metrics has no access to public.';
END $$;

-- ── To verify the isolation actually holds (run as cb_metrics, expect ERROR then rows) ─────────────────────────
--   \c - cb_metrics
--   SELECT * FROM chit_header LIMIT 1;        -- must FAIL: permission denied for schema public
--   SELECT * FROM metrics.chits_daily;         -- must return aggregate rows
