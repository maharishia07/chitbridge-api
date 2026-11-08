-- b845_commercial_changed_at.sql — CAT-264a (CTR-212 prerequisite, 8 Nov 2026): catalogue_items.commercial_changed_at, the ONE stamp of "what a sale is charged by this row moved".
--
-- ⚠️ NOT RUN on production · Athi runs it (Supabase SQL editor, AS postgres), one step, after SIT has run it. Safe to repeat (column IF NOT EXISTS, the backfill runs only
--    when the column is new, functions CREATE OR REPLACE, trigger DROP IF EXISTS + CREATE). Code reads the column only behind a schema check (CAT-264b), so the api runs before and after.
--
-- WHY. A bill line must say, later, whether the catalogue moved under it. Today the only stamp is the JSON key item_data.price_changed_at: one writer (POST /price), erased by 4
--    replace-style doors, blind to rate, category, hsn, mrp and currency (PM/designs/CTR-212-CAT-264.CRITIC.md F1-F4). One real column, set by ONE BEFORE trigger, cannot be erased by a
--    REPLACE and covers every door (20 write sites, raw SQL included). item_data.price_changed_at stays as the human fact (was, by whom); no code compares it.
-- LOOKED AT (DISCIPLINES 4a): catalogue_item_version (valid_from is trigger-grade but cb_item_fields holds no currency/rate/category/hsn: widened here, not a second function),
--    item_data.price_changed_at (kept, not compared), catalogue_items.updated_at (set by the app, lib/catalogue-write.js:196/230/254; NO trigger on it; this file does not touch it).
--    OWNER module: lib/catalogue-write.js (the one writer of the row); the stamp itself is written only by cb_catalogue_stamp_commercial() below. FIELDS: docs/FIELDS.md (row added).
-- THE ONE KEY LIST: cb_item_commercial_keys() = till.html RECHECK_FIELDS (price mrp hsn tax_slab tax_slab_name gst_rate cess_rate categories category status) ∪ lib/rate-door.js RATE_KEYS
--    (tax_slab tax_slab_name gst_rate) plus currency (F3). tests/cat-264a-commercial-stamp.test.cjs fails when the list and those two JS lists drift (F7: lib/itemmatch.js STAMP_FIELDS
--    name/variant/unit/price/sku/status is the books-replay hash, a different fact; it is not a stamp key, so it stays as is).
-- RULES (cb_item_fields_differ): a key moves when its text differs after normalising. A number is compared as a NUMBER (100, "100.00", {amount:100} are one price: price, mrp, gst_rate,
--    cess_rate; F4). Absent, null and '' are one. Currency going from missing to present is NOT a move (the CUR-1 {amount,currency} backfill stamps nothing, cuts no version); a currency that
--    was present and now differs IS (INR to AUD at the same amount, F3). is_active is NOT a key: a soft remove / restore stamps nothing and, as today, never moves updated_at (F6, the stated
--    choice at lib/catalogue-write.js:196 stands; the trigger fires on UPDATE OF item_data and of the stamp column itself, which it pins to the old value).
-- ALSO CHANGES: cb_item_fields gains the keys above (and a canonical numeric price); cb_catalogue_version_cut keeps its body but its brake now uses the same compare, so the widened keys
--    cut a version on a rate/category/hsn change (a free rate history, accepted F7) and a currency appearing for the first time does not.
-- BACKFILL: existing rows get the valid_from of their open catalogue_item_version (else updated_at), BEFORE the trigger exists, so nothing stamps itself. Assistant-knowledge rows (qa_id) are left
--    at the migration time (they carry no price, and the update would fire trg_assist_project).
-- RLS: existing table, rls_entity (USING/WITH CHECK entity_id) is unchanged and FORCE stays on; cb_app already holds table-level SELECT/INSERT/UPDATE/DELETE, so the new column needs no grant.
--    The new functions are INVOKER, read only the row passed in, touch no table. No new index: the column is read by primary key (item_id) with the row, never filtered on.
-- COST: one BEFORE UPDATE OF item_data trigger per row (an UPDATE of the stamp column is pinned to its old value), two cb_item_fields calls; the 2000-row single statement (CAT-W1) stays one statement. Measured on SIT before production.
-- ROLL BACK: DROP TRIGGER IF EXISTS catalogue_commercial_stamp_trg ON catalogue_items; DROP FUNCTION IF EXISTS cb_catalogue_stamp_commercial();
--    ALTER TABLE catalogue_items DROP COLUMN IF EXISTS commercial_changed_at;   then re-apply the old cb_item_fields and cb_catalogue_version_cut bodies from
--    migrations/000_baseline_2026-10-21.sql:253 and :310, and DROP FUNCTION IF EXISTS cb_item_fields_differ(jsonb,jsonb,text[]), cb_item_commercial_keys(), cb_item_num(text).
-- CHECK (read-only): SELECT count(*) FROM catalogue_items WHERE commercial_changed_at IS NULL;   Expect 0 (NOT NULL).
--    SELECT tgname FROM pg_trigger WHERE tgrelid = 'catalogue_items'::regclass AND tgname = 'catalogue_commercial_stamp_trg';   Expect 1 row.
--    SELECT cb_item_commercial_keys();   Expect the 11 keys in this header.

-- ── 1 · the column (added with a default, so every row has a value; the backfill below makes it truthful) ──
DO $$
DECLARE fresh boolean;
BEGIN
  fresh := NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'catalogue_items'::regclass AND attname = 'commercial_changed_at' AND NOT attisdropped);
  IF fresh THEN
    ALTER TABLE catalogue_items ADD COLUMN commercial_changed_at timestamptz NOT NULL DEFAULT now();
    UPDATE catalogue_items ci
       SET commercial_changed_at = COALESCE(
             (SELECT v.valid_from FROM catalogue_item_version v
               WHERE v.item_id = ci.item_id AND v.entity_id = ci.entity_id AND v.valid_to IS NULL
               ORDER BY v.version_no DESC LIMIT 1),
             ci.updated_at)
     WHERE NOT (ci.item_data ? 'qa_id');
  END IF;
END $$;

COMMENT ON COLUMN catalogue_items.commercial_changed_at IS
  'When anything a sale is charged by last moved on this row (price, currency, mrp, hsn, tax slab and rate, category, status): set only by the trigger catalogue_commercial_stamp_trg, never by application code. A bill line carries the value it read; a later, larger value says the catalogue moved.';

-- ── 2 · helpers: a number as a number, the one key list, the one compare ──
CREATE OR REPLACE FUNCTION cb_item_num(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(COALESCE(t, '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
              THEN trim_scale(btrim(t)::numeric)::text
              ELSE COALESCE(t, '') END;
$$;

CREATE OR REPLACE FUNCTION cb_item_commercial_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['price','currency','mrp','hsn','tax_slab','tax_slab_name','gst_rate','cess_rate','categories','category','status']::text[];
$$;

-- ── 3 · cb_item_fields widened (baseline 000:310): the six old keys, a canonical price, and the commercial keys ──
CREATE OR REPLACE FUNCTION cb_item_fields(d jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'name',    COALESCE(d->>'name', ''),
    'variant', COALESCE(NULLIF(d->>'variant',''), NULLIF(d->>'grade',''), ''),
    'unit',    COALESCE(d->>'unit', ''),
    'price',   cb_item_num(COALESCE(d->'price'->>'amount', d->>'price', '')),
    -- `code` is NOT read as an identifier: the starter set labels it "Code / HSN", so it may hold a customs
    -- classification rather than a SKU, and a version keyed on it would be keyed on the wrong fact.
    'sku',     COALESCE(NULLIF(d->>'sku',''), NULLIF(d->>'gtin',''), ''),
    -- An absent status means available — the same rule lib/itemstatus.statusOf() applies. Without this, the first
    -- status ever set on a legacy row would look like a change from nothing and cut a version saying so.
    'status',  COALESCE(NULLIF(d->>'status',''), 'available'),
    -- CAT-264a: the rest of the commercial keys. currency lives inside the price object (CUR-1); a bare price has none.
    'currency',      COALESCE(d->'price'->>'currency', ''),
    'mrp',           cb_item_num(COALESCE(d->'mrp'->>'amount', d->>'mrp', '')),
    'hsn',           btrim(COALESCE(d->>'hsn', '')),
    'tax_slab',      COALESCE(d->>'tax_slab', ''),
    'tax_slab_name', COALESCE(d->>'tax_slab_name', ''),
    'gst_rate',      cb_item_num(COALESCE(d->>'gst_rate', '')),
    'cess_rate',     cb_item_num(COALESCE(d->>'cess_rate', '')),
    'categories',    COALESCE(d->>'categories', ''),
    'category',      COALESCE(d->>'category', '')
  );
$$;

-- did any of `keys` move between two cb_item_fields outputs? currency: missing to present is not a move (F4), present to anything else is (F3)
CREATE OR REPLACE FUNCTION cb_item_fields_differ(f_old jsonb, f_new jsonb, keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(keys) k
     WHERE CASE WHEN k = 'currency'
                THEN COALESCE(f_old->>k, '') <> '' AND COALESCE(f_old->>k, '') IS DISTINCT FROM COALESCE(f_new->>k, '')
                ELSE COALESCE(f_old->>k, '') IS DISTINCT FROM COALESCE(f_new->>k, '') END);
$$;

-- ── 4 · the version brake uses the one compare (body unchanged otherwise: baseline 000:253) ──
CREATE OR REPLACE FUNCTION cb_catalogue_version_cut() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  f_new jsonb := cb_item_fields(NEW.item_data);
  f_old jsonb;
  v_next integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    f_old := cb_item_fields(OLD.item_data);
    -- ⭐ BRAKE 1. Nothing that defines what was ordered has changed, so there is nothing to record. A nightly
    -- re-import of an unchanged price list writes zero rows here. (CAT-264a: the compare is cb_item_fields_differ,
    -- so "100" and "100.00" are one price and a currency appearing for the first time is not a change.)
    IF NOT cb_item_fields_differ(f_old, f_new, ARRAY(SELECT jsonb_object_keys(f_new))) THEN
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

-- ── 5 · the ONE writer of the stamp ──
CREATE OR REPLACE FUNCTION cb_catalogue_stamp_commercial() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF cb_item_fields_differ(cb_item_fields(OLD.item_data), cb_item_fields(NEW.item_data), cb_item_commercial_keys()) THEN
      NEW.commercial_changed_at := now();
    ELSE
      NEW.commercial_changed_at := OLD.commercial_changed_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS catalogue_commercial_stamp_trg ON catalogue_items;
CREATE TRIGGER catalogue_commercial_stamp_trg
  BEFORE UPDATE OF item_data, commercial_changed_at ON catalogue_items
  FOR EACH ROW
  EXECUTE FUNCTION cb_catalogue_stamp_commercial();
