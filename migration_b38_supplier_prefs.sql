-- B3.8 Migration — Suppliers panel Stage B
-- Adds owner-side relationship fields to supplier_list: name them YOUR way (nickname),
-- mark PREFERRED (sort when there are many), and private NOTES.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS). Apply this BEFORE deploying the matching
-- relationships.js changes (GET/POST/PATCH reference these columns).

ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS nickname  VARCHAR(80);
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS preferred BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS notes     TEXT;

-- preferred-first ordering support
CREATE INDEX IF NOT EXISTS idx_supplier_list_owner_pref
  ON supplier_list (owner_entity_id, preferred DESC, created_at DESC);

-- Verify
SELECT 'supplier_list cols' AS t,
       string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
FROM information_schema.columns
WHERE table_name = 'supplier_list';
