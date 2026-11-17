-- B3.6 Migration — Supplier List + Customer List
-- Safe to re-run (IF NOT EXISTS).

-- ── supplier_list : NO consent. Owner references a supplier by bridge_id ──
CREATE TABLE IF NOT EXISTS supplier_list (
  supplier_list_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entity_id     UUID NOT NULL REFERENCES identities(identity_id),
  supplier_entity_id  UUID NOT NULL REFERENCES identities(identity_id),
  category            VARCHAR(50),
  added_via           VARCHAR(20) NOT NULL DEFAULT 'manual'
                        CHECK (added_via IN ('manual','transaction','import')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_entity_id, supplier_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_list_owner ON supplier_list(owner_entity_id);

-- ── customer_list : auto-added on first transaction; type + segment ──
CREATE TABLE IF NOT EXISTS customer_list (
  customer_list_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entity_id      UUID NOT NULL REFERENCES identities(identity_id),
  customer_identity_id UUID NOT NULL REFERENCES identities(identity_id),
  customer_type        VARCHAR(20) NOT NULL CHECK (customer_type IN ('entity','end_customer')),
  segment_override     VARCHAR(20) CHECK (segment_override IN ('high_value','regular','new','inactive')),
  added_via            VARCHAR(20) NOT NULL DEFAULT 'transaction'
                         CHECK (added_via IN ('transaction','manual','import','catalogue')),
  txn_count            INT NOT NULL DEFAULT 0,
  last_txn_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_entity_id, customer_identity_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_list_owner ON customer_list(owner_entity_id);

-- Verify
SELECT 'supplier_list' AS t, COUNT(*) FROM supplier_list
UNION ALL SELECT 'customer_list', COUNT(*) FROM customer_list;
