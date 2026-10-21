-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b159 — an attachment can live in an object store instead of in the row.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-15: *"can we add a s3 bucket kind of in the current environment and create images if required."*
--
-- lib/storage.js was written with this in mind on day one — line 4: *"Default 'db' adapter keeps blobs in Postgres;
-- swap to S3/Azure/GCS via STORAGE_ADAPTER — callers only see opaque ids."* The only thing missing is somewhere to
-- put the key. This adds it.
--
-- ⚠️ ADDITIVE AND NULLABLE. Every existing row keeps its bytes in `data` and keeps working untouched. Nothing is
-- migrated, nothing is moved, and STORAGE_ADAPTER stays 'db' until Athi flips it deliberately.
--
-- ⚠️⚠️ THE READ PATH MUST HANDLE BOTH, FOREVER. A row written by the 'db' adapter has data and no object_key; a row
-- written by the object adapter has object_key and no data. If reading ever assumes one shape, every attachment
-- stored before the switch becomes unreadable on the day the flag flips — which is a silent, total loss of the
-- evidence this product exists to hold. lib/storage.js therefore branches on `data IS NOT NULL`, and that branch is
-- permanent, not transitional.
--
-- Safe to re-run.

ALTER TABLE cb_attachment ADD COLUMN IF NOT EXISTS object_key text;

-- Finding the orphans — objects whose row is gone, or rows whose object never landed — is a maintenance job that
-- needs this to be quick. Partial, because the overwhelming majority of rows will be NULL for a long time.
CREATE INDEX IF NOT EXISTS cb_attachment_object_key_idx
  ON cb_attachment (object_key) WHERE object_key IS NOT NULL;

-- ⚠️ NO CHECK CONSTRAINT REQUIRING EXACTLY ONE OF (data, object_key).
-- It is tempting and it is wrong: during a future migration a row may legitimately hold BOTH — bytes still in the
-- row, object already written, cut over only once verified. A constraint here would forbid the safe order of
-- operations and force the dangerous one (delete the bytes first, then hope).

DO $$
BEGIN
  RAISE NOTICE 'b159: cb_attachment.object_key added (nullable). Existing rows are untouched and still read from data.';
  RAISE NOTICE 'b159: STORAGE_ADAPTER stays db until you set it — this migration changes no behaviour by itself.';
END $$;
