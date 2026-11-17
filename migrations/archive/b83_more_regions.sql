-- b83: more region flavours for spin-the-globe (China/Japan/Spain/France/Germany). Additive INSERT into region_layer
-- (WITHOUT RLS, seeded by admin). Safe, idempotent (ON CONFLICT DO NOTHING).

INSERT INTO region_layer (region_code, currency, units, language, jurisdiction) VALUES
  ('CN','CNY','litre','zh','{"mode":"China","custodian":false}'::jsonb),
  ('JP','JPY','litre','ja','{"mode":"Japan","custodian":false}'::jsonb),
  ('ES','EUR','litre','es','{"mode":"Spain","custodian":false,"compliance":"CE / EU labeling"}'::jsonb),
  ('FR','EUR','litre','fr','{"mode":"France","custodian":false}'::jsonb),
  ('DE','EUR','litre','de','{"mode":"Germany","custodian":false}'::jsonb)
ON CONFLICT (region_code) DO NOTHING;
