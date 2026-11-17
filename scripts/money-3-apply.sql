-- money-3-apply.sql — THE ONLY FILE THAT WRITES. Run it whole; it is one transaction and it guards itself.
--
-- ⚠ PRECONDITIONS — all three, not two:
--   1. money-1-inspect.sql section B returned ZERO rows.
--   2. money-2-dryrun.sql was READ, not just run.
--   3. The TOLERANT READER (lib/money.js `read()`) is DEPLOYED AND LIVE.
--
-- Precondition 3 is the one that will be tempting to skip and is the one that breaks production. The front end reads
-- prices as `+d.price || 0`. Given an object that yields NaN, and `NaN || 0` is 0 — so every product renders as FREE.
-- No exception, no log, a correct-looking page. Data must never change shape before the readers can read it.
--
-- Safe to re-run: it only touches jsonb numbers, and it writes objects. A second run finds nothing to do.

BEGIN;

-- ── GUARD 1 · no row may be stamped with an invalid currency ────────────────────────────────────────────────
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM catalogue_items ci JOIN identities i ON i.identity_id = ci.entity_id
  WHERE jsonb_typeof(ci.item_data->'price') = 'number'
    AND (i.currency_code IS NULL OR i.currency_code !~ '^[A-Z]{3}$');
  IF bad > 0 THEN
    RAISE EXCEPTION 'REFUSING: % priced item(s) belong to an entity with no valid currency_code. Fix those entities first — see money-1-inspect.sql section B. Inventing a currency here is the exact bug this migration exists to end.', bad;
  END IF;
END $$;

-- ── GUARD 2 · refuse a no-op, so a wrong connection cannot look like success ────────────────────────────────
-- Under the app role, RLS hides other entities' rows and this would silently "succeed" having done nothing.
DO $$
DECLARE todo int;
BEGIN
  SELECT count(*) INTO todo FROM catalogue_items WHERE jsonb_typeof(item_data->'price') = 'number';
  IF todo = 0 THEN
    RAISE EXCEPTION 'REFUSING: zero bare-number prices visible. Either the migration already ran (check catalogue_items_price_backup) or you are connected with a role that cannot see the rows. Verify before assuming success.';
  END IF;
  RAISE NOTICE 'stamping % item(s)', todo;
END $$;

-- ── BACKUP · the way back, written before the change ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogue_items_price_backup (
  item_id           uuid PRIMARY KEY,
  entity_id         uuid        NOT NULL,
  item_data_before  jsonb       NOT NULL,
  backed_up_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO catalogue_items_price_backup (item_id, entity_id, item_data_before)
SELECT item_id, entity_id, item_data
FROM catalogue_items
WHERE jsonb_typeof(item_data->'price') = 'number'
ON CONFLICT (item_id) DO NOTHING;   -- a re-run must not overwrite the ORIGINAL with an already-stamped row

-- ── THE STAMP ───────────────────────────────────────────────────────────────────────────────────────────────
UPDATE catalogue_items ci
SET item_data =
      jsonb_set(ci.item_data, '{price}',
        jsonb_build_object('amount', (ci.item_data->>'price')::numeric, 'currency', i.currency_code))
      || jsonb_build_object(
           'price_stamped_at',       to_jsonb(now()),
           'price_stamped_from',     to_jsonb('entity.currency_code'::text),
           -- Permanent, and the most important key here. It records that this denomination was INFERRED at migration
           -- time from a mutable setting — not declared by a person. Everything written after this migration will
           -- carry a DECLARED currency and no such flag, so the two are distinguishable forever.
           'price_currency_assumed', to_jsonb(true)
         )
FROM identities i
WHERE i.identity_id = ci.entity_id
  AND jsonb_typeof(ci.item_data->'price') = 'number'
  AND i.currency_code ~ '^[A-Z]{3}$';

-- ── VERIFY · inside the transaction, so a failure rolls itself back ─────────────────────────────────────────
DO $$
DECLARE remaining int; stamped int; backed int;
BEGIN
  SELECT count(*) INTO remaining FROM catalogue_items WHERE jsonb_typeof(item_data->'price') = 'number';
  SELECT count(*) INTO stamped   FROM catalogue_items WHERE jsonb_typeof(item_data->'price') = 'object';
  SELECT count(*) INTO backed    FROM catalogue_items_price_backup;
  IF remaining > 0 THEN
    RAISE EXCEPTION 'ROLLING BACK: % bare price(s) still present after the update. Nothing has been changed.', remaining;
  END IF;
  IF stamped > backed THEN
    RAISE EXCEPTION 'ROLLING BACK: % stamped but only % backed up — rollback would be incomplete.', stamped, backed;
  END IF;
  RAISE NOTICE 'OK — % item(s) now carry a currency, % row(s) recoverable from catalogue_items_price_backup', stamped, backed;
END $$;

COMMIT;

-- ── AFTER ───────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Re-run money-1-inspect.sql section A. Expect: price_shape = 'object' only (plus nulls for price-on-request).
-- 2. Open a storefront and confirm prices render. If any product shows as FREE, precondition 3 was not met —
--    roll back immediately using the query in money-2-dryrun.sql and deploy the reader first.
-- 3. Keep catalogue_items_price_backup. It is small, and it is the only record of what the prices looked like
--    before a currency was attributed to them. Do not drop it in the same session that created it.
