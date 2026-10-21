-- b84: India-local language regions for spin-the-globe — Tamil (TN) and Hindi (HI). Both INR/litre (India), just the
-- LANGUAGE differs, to attract local customers. Additive, idempotent.

INSERT INTO region_layer (region_code, currency, units, language, jurisdiction) VALUES
  ('TN','INR','litre','ta','{"mode":"India (Tamil Nadu)","custodian":false}'::jsonb),
  ('HI','INR','litre','hi','{"mode":"India (Hindi)","custodian":false}'::jsonb)
ON CONFLICT (region_code) DO NOTHING;
