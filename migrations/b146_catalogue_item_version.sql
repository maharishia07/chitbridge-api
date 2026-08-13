-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b146 — WHAT THE ITEM WAS, AT ANY POINT IN TIME. And how it eventually leaves.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-13: *"it is like the boat is moving and we are trying to fix the base, and it always slips. So the
-- first thing is, at any point in time, what is the reference at this point in time — that fixes the base, and then
-- the amendment, capture, chit details etc. That is the total crux of the product."*
--
-- and, in the same breath, the half that keeps it alive:
--
-- *"we need to hold the item which has some live information — either the product count, price or some other means —
-- otherwise it has to retire and go away from the system. The system dies if it does not have a proper mechanism to
-- retire the data and move out of the system."*
--
-- ── ⚠️ WHY AN ID WAS NOT ENOUGH ─────────────────────────────────────────────────────────────────────────────────
-- `catalogue_items.item_id` says WHICH row. The row keeps moving — reprice it, rename it, take it out of stock —
-- so a chit holding only an id points at something that is no longer what was ordered, and nothing anywhere says it
-- changed. The ADOPTED catalogue already solved this (lib/container.js freezes {ref, content_version}); the shop's
-- OWN items had no version to point at. This is that missing half.
--
-- ── ⭐ WHY RETIREMENT IS SAFE HERE, AND THIS IS THE WHOLE ARGUMENT ───────────────────────────────────────────────
-- A chit line carries its OWN FROZEN COPY of the name, price and unit (chit_detail.line_items, and chit_line since
-- b142). History does not read through to the live catalogue row. That is precisely what lets a product leave the
-- system without taking six years of orders with it — the systems that die of their own data are the ones where
-- history DEPENDS on live rows, so nothing can ever be deleted and everything is kept forever "just in case".
-- Here the reference is provenance, never a lookup. So the catalogue can be pruned hard, and the record survives.
--
-- ── ⚠️ WILL IT GROW FOREVER? NO, AND THE MECHANISM IS DELIBERATE ────────────────────────────────────────────────
-- Three separate brakes, because "add a version table" on its own is how you build the next problem:
--
--   1. A VERSION IS CUT ON MEANINGFUL CHANGE, NOT ON WRITE. `updated_at` moves whenever anything touches the row —
--      a re-import that changes nothing, a stock feed, a description tweak. The trigger below compares the SIX
--      fields that define what was ordered (name · variant · unit · price · sku · status) and does nothing at all
--      when they are unchanged. Re-importing the same spreadsheet nightly produces ZERO versions.
--
--   2. A VERSION LIVES BECAUSE SOMETHING POINTS AT IT. The current version is the row. Every other version exists
--      to answer "what was this when that chit was made" — so when those chits retire under the existing retention
--      lifecycle, the version has nothing left to explain and becomes collectable. Growth is therefore bounded by
--      LIVE HISTORY, not by elapsed time. The collector is NOT in this migration (see 4).
--
--   3. THE PRODUCT LIST IS PRUNED BY LIVENESS, NOT BY AGE. An item is alive while it can still be ordered or still
--      says something true — a price, a stock figure, a recent order, a not-yet-retired status. `cb_catalogue_
--      liveness` below reports the ones that are none of those. Age alone is never the test: a product nobody has
--      ordered for two years but which still has a price and stock is a slow seller, not a dead record.
--
--   4. ⚠️ NOTHING IN THIS FILE DELETES ANYTHING. It creates a table, a trigger and a read-only view. The collector
--      and the retire-and-move-out step are DESTRUCTIVE and follow the standing rule for destructive work: their
--      own spec, a dry-run that reports what WOULD go, and a human gate. A migration that both starts recording
--      history and starts destroying it is a migration nobody can safely re-run.
--
-- Safe to re-run.

-- ── 1 · the six fields that define "what was ordered" ────────────────────────────────────────────────────────────
-- ⚠️ ONE DEFINITION, IN SQL, and the JS side READS it rather than recomputing. lib/itemmatch.stampOf() hashes the
-- same six fields for environments where this migration has not run, and two implementations of one rule is exactly
-- how `keyOf` drifted (it was rebuilt in a test fixture, dropped the variant, and two products shared a key). Once
-- b146 is applied, `version_no` from this table is authoritative and the JS hash is a fallback, not a second answer.
--
-- ⚠️ PRICE IS READ TOLERANTLY. A price is either a stamped {amount, currency} or a legacy bare number, and both are
-- live in the data today. Reading only one shape would cut a spurious version for every row the money migration
-- touches — thousands of "changes" that are the same price written differently.
CREATE OR REPLACE FUNCTION cb_item_fields(d jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'name',    COALESCE(d->>'name', ''),
    'variant', COALESCE(NULLIF(d->>'variant',''), NULLIF(d->>'grade',''), ''),
    'unit',    COALESCE(d->>'unit', ''),
    'price',   COALESCE(d->'price'->>'amount', d->>'price', ''),
    -- `code` is NOT read as an identifier: the starter set labels it "Code / HSN", so it may hold a customs
    -- classification rather than a SKU, and a version keyed on it would be keyed on the wrong fact.
    'sku',     COALESCE(NULLIF(d->>'sku',''), NULLIF(d->>'gtin',''), ''),
    -- An absent status means available — the same rule lib/itemstatus.statusOf() applies. Without this, the first
    -- status ever set on a legacy row would look like a change from nothing and cut a version saying so.
    'status',  COALESCE(NULLIF(d->>'status',''), 'available')
  );
$$;

-- ── 2 · the table ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue_item_version (
  version_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL,
  entity_id    uuid NOT NULL,

  -- Monotonic per ITEM, starting at 1. What a chit's `ref.version` points at.
  version_no   integer NOT NULL,

  -- ⚠️ THE WHOLE item_data, not only the six fields. The six decide WHEN to cut a version; the snapshot is what you
  -- read to answer "what did this say". Storing only the six would mean a dispute about a description, an HS code or
  -- a synonym list — every one of which travels on a real order — has nothing to read.
  snapshot     jsonb NOT NULL,

  -- The six, extracted, so the common questions ("what was the price then") are indexable rather than a jsonb dig.
  name         text,
  variant      text,
  unit         text,
  price        numeric(18,2),
  sku          text,
  status       text,

  -- ⚠️ A CLOSED INTERVAL, NOT A TIMESTAMP. "Which version was live when that chit was raised" is a range question,
  -- and answering it from created_at alone means ordering by time and taking the one before — which silently gives
  -- the wrong answer the moment two writes share a millisecond. valid_to IS NULL means "current".
  valid_from   timestamptz NOT NULL DEFAULT now(),
  valid_to     timestamptz,

  -- Who/what caused the change, when we know. Best-effort: never a reason to refuse to record the version.
  changed_by   text,

  created_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (entity_id, item_id, version_no)
);

-- The two questions this table exists to answer, both indexed.
CREATE INDEX IF NOT EXISTS cat_item_version_current ON catalogue_item_version (entity_id, item_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS cat_item_version_asof    ON catalogue_item_version (entity_id, item_id, valid_from DESC);

ALTER TABLE catalogue_item_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_item_version FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalogue_item_version_isolation ON catalogue_item_version;
CREATE POLICY catalogue_item_version_isolation ON catalogue_item_version
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON catalogue_item_version TO cb_app;

-- ── 3 · the trigger — no write path can miss it ─────────────────────────────────────────────────────────────────
-- ⚠️ A TRIGGER RATHER THAN APPLICATION CODE, DELIBERATELY. Items are written from at least five places today —
-- create, edit, status, availability, CSV import — and a sixth arrives the week after this ships. Versioning wired
-- per call site means the one that is forgotten produces a catalogue whose history has silent holes, and a hole in
-- an audit trail is worse than no trail because the trail is believed. The database cannot be bypassed.
CREATE OR REPLACE FUNCTION cb_catalogue_version_cut() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  f_new jsonb := cb_item_fields(NEW.item_data);
  f_old jsonb;
  v_next integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    f_old := cb_item_fields(OLD.item_data);
    -- ⭐ BRAKE 1. Nothing that defines what was ordered has changed, so there is nothing to record. A nightly
    -- re-import of an unchanged price list writes zero rows here.
    IF f_old IS NOT DISTINCT FROM f_new THEN
      RETURN NULL;
    END IF;
    UPDATE catalogue_item_version
       SET valid_to = now()
     WHERE entity_id = NEW.entity_id AND item_id = NEW.item_id AND valid_to IS NULL;
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next
    FROM catalogue_item_version
   WHERE entity_id = NEW.entity_id AND item_id = NEW.item_id;

  INSERT INTO catalogue_item_version
    (item_id, entity_id, version_no, snapshot, name, variant, unit, price, sku, status, valid_from, changed_by)
  VALUES
    (NEW.item_id, NEW.entity_id, v_next, NEW.item_data,
     NULLIF(f_new->>'name',''), NULLIF(f_new->>'variant',''), NULLIF(f_new->>'unit',''),
     NULLIF(f_new->>'price','')::numeric, NULLIF(f_new->>'sku',''), f_new->>'status',
     now(), NULLIF(current_setting('app.current_actor', true), ''))
  ON CONFLICT (entity_id, item_id, version_no) DO NOTHING;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS catalogue_item_version_trg ON catalogue_items;
CREATE TRIGGER catalogue_item_version_trg
  AFTER INSERT OR UPDATE OF item_data ON catalogue_items
  FOR EACH ROW EXECUTE FUNCTION cb_catalogue_version_cut();

-- ── 4 · backfill — every existing item gets version 1 ───────────────────────────────────────────────────────────
-- ⚠️ valid_from IS THE ROW'S OWN created_at, NOT now(). Stamping every historic item as "created during the
-- migration" would make every chit ever raised look older than the item it references — and the first as-of query
-- anyone ran would return nothing, which reads as data loss.
INSERT INTO catalogue_item_version
  (item_id, entity_id, version_no, snapshot, name, variant, unit, price, sku, status, valid_from, changed_by)
SELECT ci.item_id, ci.entity_id, 1, ci.item_data,
       NULLIF(cb_item_fields(ci.item_data)->>'name',''),
       NULLIF(cb_item_fields(ci.item_data)->>'variant',''),
       NULLIF(cb_item_fields(ci.item_data)->>'unit',''),
       NULLIF(cb_item_fields(ci.item_data)->>'price','')::numeric,
       NULLIF(cb_item_fields(ci.item_data)->>'sku',''),
       cb_item_fields(ci.item_data)->>'status',
       COALESCE(ci.created_at, now()), 'backfill:b146'
  FROM catalogue_items ci
 WHERE NOT EXISTS (SELECT 1 FROM catalogue_item_version v
                    WHERE v.entity_id = ci.entity_id AND v.item_id = ci.item_id)
ON CONFLICT (entity_id, item_id, version_no) DO NOTHING;

-- ── 5 · as-of — the question the whole table exists for ─────────────────────────────────────────────────────────
-- "What was this item when that chit was raised?"  SELECT * FROM cb_item_as_of(item_id, chit_created_at)
CREATE OR REPLACE FUNCTION cb_item_as_of(p_item uuid, p_when timestamptz)
RETURNS TABLE (version_no integer, snapshot jsonb, name text, price numeric, status text)
LANGUAGE sql STABLE AS $$
  SELECT v.version_no, v.snapshot, v.name, v.price, v.status
    FROM catalogue_item_version v
   WHERE v.item_id = p_item
     AND v.valid_from <= p_when
     AND (v.valid_to IS NULL OR v.valid_to > p_when)
   ORDER BY v.version_no DESC
   LIMIT 1;
$$;

-- ── 6 · LIVENESS — what is still alive, and what is only still here ─────────────────────────────────────────────
-- ⚠️ READ-ONLY. It PROPOSES; it removes nothing. Athi's test is "does it carry live information" — a price, a stock
-- figure, an orderable status — not "is it old". A product nobody has ordered in two years that still has a price
-- and stock is a slow seller; deleting it because of the calendar is how a system loses its long tail.
--
-- ⚠️ AND `retired` IS NOT THE SAME AS DEAD. Retiring is the OWNER saying "we stopped selling this"; this view is the
-- system saying "this row no longer asserts anything". A retired item that still has stock on the shelf is very much
-- live information — it is the one you most need to see.
CREATE OR REPLACE VIEW cb_catalogue_liveness AS
SELECT ci.entity_id,
       ci.item_id,
       ci.item_data->>'name'                                   AS name,
       COALESCE(NULLIF(ci.item_data->>'status',''), 'available') AS status,
       (COALESCE(ci.item_data->'price'->>'amount', ci.item_data->>'price') IS NOT NULL) AS has_price,
       (COALESCE((ci.item_data->'avail'->>'qty')::numeric, 0) > 0)                       AS has_stock,
       ci.updated_at,
       (SELECT MAX(v.version_no) FROM catalogue_item_version v
         WHERE v.entity_id = ci.entity_id AND v.item_id = ci.item_id)                    AS versions,
       -- The verdict, in the owner's words rather than a score nobody can argue with.
       CASE
         WHEN COALESCE((ci.item_data->'avail'->>'qty')::numeric, 0) > 0            THEN 'live · stock on hand'
         WHEN COALESCE(NULLIF(ci.item_data->>'status',''),'available') IN ('available','unavailable')
              AND COALESCE(ci.item_data->'price'->>'amount', ci.item_data->>'price') IS NOT NULL
                                                                                   THEN 'live · orderable, priced'
         WHEN COALESCE(NULLIF(ci.item_data->>'status',''),'available') = 'redundant' THEN 'superseded · points at a replacement'
         WHEN COALESCE(ci.item_data->'price'->>'amount', ci.item_data->>'price') IS NULL
              AND COALESCE((ci.item_data->'avail'->>'qty')::numeric, 0) = 0        THEN 'says nothing · retire candidate'
         ELSE 'retired · holds no live figure'
       END                                                                               AS verdict
  FROM catalogue_items ci
 WHERE ci.is_active = true;

GRANT SELECT ON cb_catalogue_liveness TO cb_app;

DO $$
DECLARE n bigint; v bigint; dead bigint;
BEGIN
  SELECT count(*) INTO n FROM catalogue_items;
  SELECT count(*) INTO v FROM catalogue_item_version;
  SELECT count(*) INTO dead FROM cb_catalogue_liveness WHERE verdict LIKE '%retire candidate%';
  RAISE NOTICE 'b146: % item(s) → % version row(s) WITH RLS (FORCE). % retire candidate(s) REPORTED, none removed.', n, v, dead;
  RAISE NOTICE 'b146: nothing was deleted. The collector and the retire-and-move-out step are destructive and gated.';
END $$;
