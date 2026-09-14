-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b156 — THE OPERATOR VIEW. Per-shop ACCOUNT facts, so we can serve a shop. Never a trade fact.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"each shops last status, when last sign-in? how many supplier link, how many walkin customer,
-- all the breakdown we need to have? so we can provide facility according to that?"*
--
-- ── ⭐⭐⭐ AND THE CLARIFICATION THAT DEFINES THE WHOLE FILE ─────────────────────────────────────────────────────
--
-- Athi then said *"what we need is the count, not the name or their relation etc."* — which was read as "no names
-- at all", and this file was briefly deleted and rebuilt as pure aggregates. That was wrong. The next sentence
-- settled it: *"cbinc customer are each registered entity, and their count and so on we want to see under their
-- name."*
--
-- ⭐ SO THE NAME IN QUESTION WAS NEVER THE SHOP'S. It was the names of the shop's OWN suppliers and customers —
-- their relations. Those are counted, never named. The SHOP's name stays, because a registered entity is CBINC's
-- customer and we are a party to that relationship. Every business knows who its customers are; none is entitled
-- to know who ITS customers trade with. That is the line, and it is one sentence:
--
--        ✅  WE MAY SEE:  our customer's name, and HOW MANY relations they have
--        ❌  WE MAY NOT:  WHO those relations are
--
-- ── ⚠️⚠️ WHY THIS IS A SEPARATE SCHEMA AND NOT FOUR MORE VIEWS IN `metrics` ─────────────────────────────────────
--
-- `metrics` has ONE invariant, and it is the entire reason it is safe to point a BI tool at: EVERY VIEW IS AN
-- AGGREGATE AND NO VIEW RETURNS AN entity_id. A dashboard that leaks shows "how many chits were sent on Tuesday".
--
-- What Athi is asking for here is PER-SHOP and therefore breaks that invariant. Adding it to `metrics` would
-- quietly turn the safe schema into a tenant list, and the next person to share a dashboard would not know the
-- rules had changed. So it goes in its own schema, with its own role, and the invariant on the other side of the
-- wall stays true. ⭐ The wall is the point. b151 built it deliberately; this file does not knock a hole in it.
--
-- ── ⭐⭐⭐ THE LINE: ACCOUNT FACTS vs TRADE FACTS ────────────────────────────────────────────────────────────────
--
-- Not "per-shop vs aggregate". The real line is what the fact is ABOUT:
--
--   ✅ ACCOUNT FACTS — about the RELATIONSHIP, and we are a party to it. We may hold these.
--        who they are · when they registered · when they were last active · how many seats · how many items
--        · how many suppliers linked · how many customers on file · whether they have ever sent a chit
--
--   ❌ TRADE FACTS — about THEIR BUSINESS. We may not hold these, at any grain, for any reason.
--        WHAT they sell · at WHAT price · to WHOM · for HOW MUCH · what is in a chit · who their suppliers ARE
--
-- ⚠️⚠️ THE COUNTS BELOW ARE THE EDGE, AND THEY ARE DELIBERATE. "How many suppliers" is account-shaped: it is the
--    size of their operation, which is what provisioning and plan-fit are decided on. "WHICH suppliers" is a trade
--    fact and is the customer's competitive information. THE COUNT IS IN; THE LIST IS OUT. If a column is ever
--    added here that names a counterparty, a product or a price, this file has been misused.
--
-- ⚠️ AND `display_name` IS IN, on purpose. An operator view you cannot act from is a report, not a tool — "some
--    shop went dormant" helps nobody. This is the same reasoning `test_result` uses for carrying `tester_name`
--    beside `tested_by`.
--
-- ⚠️ RUN b151 FIRST (it creates the pattern this follows). Independent of b154/b155.
-- ⚠️ REQUIRES b157. ops.accounts lists entity_kind = customer — NOT every identity row. Before b157 this
--    sheet would have been 2,163 lines of e2eco-mu0jzb0i929 with the 90 real shops buried in it.
--
-- Supabase → SQL Editor → paste → Run. Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS ops;

-- ── the operator role. Narrower than cb_metrics: this one sees entity_ids, so it is for US, never for a dashboard.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_ops') THEN
    -- ⚠️ SET A REAL PASSWORD when you run this. Do not leave the placeholder.
    EXECUTE 'CREATE ROLE cb_ops LOGIN PASSWORD ' || quote_literal('CHANGE-ME-' || gen_random_uuid()::text) ||
            ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cb_ops' AND rolbypassrls) THEN
    RAISE EXCEPTION 'cb_ops must NOT have BYPASSRLS';
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM cb_ops;
GRANT USAGE ON SCHEMA ops TO cb_ops;

-- ── ⭐ THE ACCOUNT SHEET — one row per shop, every column an account fact ───────────────────────────────────────
CREATE OR REPLACE FUNCTION ops.f_accounts()
RETURNS TABLE (
  entity_id      uuid,
  shop           text,
  registered     date,
  last_active    date,
  dormant_days   integer,
  standing       text,
  seats          bigint,
  items          bigint,
  suppliers      bigint,
  customers      bigint,
  chits_sent     bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.identity_id                                              AS entity_id,
         e.display_name                                             AS shop,
         e.created_at::date                                         AS registered,
         e.last_active_at::date                                     AS last_active,
         /* ⚠️ identities.last_active_at and .created_at are `timestamp WITHOUT time zone`, while now() is
            timestamptz. Subtracting them directly makes postgres coerce via the server timezone, which is a
            silent off-by-hours on a UTC database read from IST. now()::timestamp keeps both sides naive. */
         CASE WHEN e.last_active_at IS NULL THEN NULL
              ELSE extract(day FROM now()::timestamp - e.last_active_at)::integer END AS dormant_days,

         /* ⭐ THE STANDING IS THE ANSWER TO "each shop's last status". Ordered so the worst case wins: a shop that
            never came back after signing up is a different problem from one that used it and drifted away, and
            collapsing them into "inactive" loses the only distinction that changes what we should do about it. */
         CASE
           WHEN e.last_active_at IS NULL                              THEN 'a · never signed in'
           WHEN NOT EXISTS (SELECT 1 FROM chit_header h WHERE h.sender_entity_id = e.identity_id)
                AND NOT EXISTS (SELECT 1 FROM catalogue_items c
                                 WHERE c.entity_id = e.identity_id AND c.is_active)
                                                                      THEN 'b · registered, never used'
           WHEN e.last_active_at < now()::timestamp - interval '90 days' THEN 'c · lapsed (90d+)'
           WHEN e.last_active_at < now()::timestamp - interval '30 days' THEN 'd · drifting (30d+)'
           WHEN e.last_active_at < now()::timestamp - interval '7 days'  THEN 'e · quiet (7d+)'
           ELSE                                                               'f · active'
         END                                                         AS standing,

         /* ⚠️ `status = 'erased'` is excluded from seats. A person who was erased is not a seat, and counting
            them would over-state every shop against its plan cap — the exact number §3 of the design says we
            would bill from. The SHOP filter below excludes erased shops for the same reason. */
         (SELECT count(*) FROM identities a
           WHERE a.parent_entity_id = e.identity_id AND a.entity_kind = 'actor'
             AND coalesce(a.status, 'active') <> 'erased')                               AS seats,
         (SELECT count(*) FROM catalogue_items c
           WHERE c.entity_id = e.identity_id AND c.is_active)   AS items,
         /* ⚠️ supplier_list and customer_list key on owner_entity_id, NOT entity_id. */
         (SELECT count(*) FROM supplier_list s WHERE s.owner_entity_id = e.identity_id)  AS suppliers,
         (SELECT count(*) FROM customer_list k WHERE k.owner_entity_id = e.identity_id)  AS customers,
         /* ⚠️ DISTINCT chit_id: chit_header is one row PER PARTICIPANT COPY and a self-chit has two. Fifth time. */
         (SELECT count(DISTINCT h.chit_id) FROM chit_header h
           WHERE h.sender_entity_id = e.identity_id)                                     AS chits_sent
    FROM identities e
   WHERE e.entity_kind = 'customer'
     AND coalesce(e.status, 'active') <> 'erased'
$$;
CREATE OR REPLACE VIEW ops.accounts AS SELECT * FROM ops.f_accounts();

-- ── ⭐ THE ROLL-CALL — the same thing as a distribution, which is what you read first ───────────────────────────
CREATE OR REPLACE FUNCTION ops.f_standing()
RETURNS TABLE (standing text, shops bigint, seats bigint, items bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT standing, count(*) AS shops, sum(seats) AS seats, sum(items) AS items
    FROM ops.f_accounts() GROUP BY 1 ORDER BY 1
$$;
CREATE OR REPLACE VIEW ops.standing AS SELECT * FROM ops.f_standing();

-- ── ⭐ THE CUSTOMER MIX — "how many walk-in customers?" ─────────────────────────────────────────────────────────
-- ⚠️ The values of `customer_type` are NOT hard-coded here. Nothing in routes/ or lib/ pins them to a closed list,
--    so a CASE naming 'walkin' would silently report zero if the value is spelled 'walk_in' or 'guest'. This
--    GROUPs by whatever is actually in the column and lets the data name itself — the same reason b151 selects
--    `c.status` rather than asserting the funnel's stages.
CREATE OR REPLACE FUNCTION ops.f_customer_mix()
RETURNS TABLE (customer_type text, added_via text, customers bigint, shops bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(k.customer_type, '(unset)')::text AS customer_type,
         coalesce(k.added_via, '(unset)')::text     AS added_via,
         count(*)                                   AS customers,
         count(DISTINCT k.owner_entity_id)          AS shops
    FROM customer_list k
   GROUP BY 1, 2 ORDER BY 3 DESC
$$;
CREATE OR REPLACE VIEW ops.customer_mix AS SELECT * FROM ops.f_customer_mix();

GRANT SELECT ON ops.accounts, ops.standing, ops.customer_mix TO cb_ops;

-- ⚠️ NOT granted to cb_metrics. The BI role must never reach a view carrying entity_id — that is the wall.
REVOKE ALL ON SCHEMA ops FROM cb_metrics;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

SELECT * FROM ops.standing;                                    -- read this one first
SELECT * FROM ops.customer_mix;
SELECT * FROM ops.accounts ORDER BY last_active DESC NULLS LAST;
