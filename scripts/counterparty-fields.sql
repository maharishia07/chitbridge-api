-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EVERYTHING KNOWABLE ABOUT A COUNTERPARTY, IN ONE PLACE — so placement can be decided by LOOKING.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"bring all the possible information under one roof, then we can think of placement"* ·
-- *"and rooting"* · *"we are not defining for ourselves, it should be usable by everyone"*
--
-- ⚠️ THIS IS AN EXPLORATION SCRIPT, NOT A MIGRATION AND NOT A VIEW. It creates nothing and changes nothing. Its
-- job is to answer "what do we actually have?" with real rows, so the column argument stops being theoretical.
--
-- ⚠️ AND IT IS DELIBERATELY SLOW. Seven correlated subqueries per row, which is exactly what a real panel must
-- NOT do — the whole round-trip problem. Whatever survives this into the panel becomes ONE grouped query.
--
-- Run with: railway run --service chitbridge-api -- node scripts/sql.cjs scripts/counterparty-fields.sql \
--             --entity <the viewing entity> --write
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

WITH me AS (SELECT '2b629cf5-25c4-4ee6-a4fc-4b335a67bfa2'::uuid AS id)   -- the viewer. Any entity works.
SELECT
  -- ── ① WHO THEY ARE ────────────────────────────────────────────────────────────────────────────────────────
  e.display_name                                         AS "who",
  e.user_id                                              AS "handle",
  e.bridge_id                                            AS "bridge",
  e.entity_kind                                          AS "kind",
  coalesce(e.city, '')                                   AS "city",
  coalesce(e.country, '')                                AS "cc",
  coalesce(e.currency_code, '')                          AS "ccy",
  e.business_status                                      AS "open/closed",
  e.plan                                                 AS "plan",            -- ⭐ what they are on

  -- ── ② THE RELATIONSHIP — how we are connected, and who chose it ───────────────────────────────────────────
  cl.added_via                                           AS "cust_added",
  cl.txn_count                                           AS "cust_txns",       -- ⭐ customer_list HAS this
  cl.last_txn_at::date                                   AS "cust_last",       -- ⭐ and this
  sl.added_via                                           AS "supp_added",
  sl.category                                            AS "supp_category",
  sl.preferred                                           AS "supp_preferred",
  -- ⚠️ NOTE THE ASYMMETRY: supplier_list has NO txn_count and NO last_txn_at. Anything about supplier activity
  --    has to be computed from chits, every time. That is the single biggest gap in this whole inventory.

  -- ── ③ ROOTING — where they sit on the network tree ────────────────────────────────────────────────────────
  cbe.path::text                                         AS "path",
  nlevel(cbe.path)                                       AS "depth",           -- 1 = a root of its own tree
  subpath(cbe.path, 0, 1)::text                          AS "tree_root",
  (SELECT count(*) FROM cb_entity k
    WHERE k.path <@ cbe.path AND k.path <> cbe.path)     AS "sub_nodes",       -- branches beneath them

  -- ── ④ GOVERNANCE — what they were minted under ────────────────────────────────────────────────────────────
  eg.constitution_key || '@' || coalesce(eg.constitution_version, '?') AS "constitution",
  eg.installation_key                                    AS "installation",

  -- ── ⑤ SCALE — how big is their operation ──────────────────────────────────────────────────────────────────
  (SELECT count(*) FROM catalogue_items c
    WHERE c.entity_id = e.identity_id AND c.is_active)   AS "items",
  (SELECT count(*) FROM identities a
    WHERE a.parent_entity_id = e.identity_id
      AND a.entity_kind = 'actor')                       AS "seats",
  (SELECT count(*) FROM supplier_list s2
    WHERE s2.owner_entity_id = e.identity_id)            AS "their_suppliers",
  (SELECT count(*) FROM customer_list c2
    WHERE c2.owner_entity_id = e.identity_id)            AS "their_customers",

  -- ── ⑥ TRADE WITH US — the only numbers that are about the RELATIONSHIP rather than about them ─────────────
  -- ⚠️ count(DISTINCT chit_id): chit_header is one row PER PARTICIPANT COPY. Sixth time this note is written.
  (SELECT count(DISTINCT h.chit_id) FROM chit_header h, me
    WHERE h.sender_entity_id = me.id)                    AS "_chits_i_sent_total",
  (SELECT max(h.created_at)::date FROM chit_header h
    WHERE h.sender_entity_id = e.identity_id)            AS "their_last_chit",

  -- ── ⑦ LIFE SIGNS ──────────────────────────────────────────────────────────────────────────────────────────
  e.created_at::date                                     AS "joined",
  e.last_active_at::date                                 AS "last_seen",
  CASE WHEN e.last_active_at IS NULL THEN NULL
       ELSE extract(day FROM now()::timestamp - e.last_active_at)::integer END AS "quiet_days"

FROM me
JOIN customer_list  cl0 ON cl0.owner_entity_id = me.id
JOIN identities     e   ON e.identity_id = cl0.customer_identity_id
LEFT JOIN customer_list cl  ON cl.owner_entity_id = me.id AND cl.customer_identity_id = e.identity_id
LEFT JOIN supplier_list sl  ON sl.owner_entity_id = me.id AND sl.supplier_entity_id  = e.identity_id
LEFT JOIN cb_entity     cbe ON cbe.bridge_id = e.bridge_id
LEFT JOIN entity_governance eg ON eg.entity_id = e.identity_id
ORDER BY e.last_active_at DESC NULLS LAST
LIMIT 8;
