-- b100: TRADE DOCUMENTS VAULT — the recurring inputs a business provides ONCE that pre-fill every authority form
-- (Commercial Invoice, Packing List, Certificate of Origin, ...). Stored as one jsonb on entity_profile, grouped:
--   identity · signatory · registrations · banking · logistics.
-- Additive + nullable → SELF-HEALING: getProfile() reads it in a separate guarded query (unaffected pre-migration);
-- saveVault() returns 503 VAULT_STORE_MISSING until this runs. entity_profile is already WITH RLS (per-entity).
ALTER TABLE entity_profile ADD COLUMN IF NOT EXISTS vault jsonb;
