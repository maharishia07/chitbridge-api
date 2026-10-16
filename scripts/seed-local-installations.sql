-- scripts/seed-local-installations.sql — GOV-SPIN: three TEST installations, so ONE PC can be an Australian, Emirati or Indian spin.
--   LOCAL / TEST DATABASES ONLY — never production (tools/migrate.cjs does not chain it: it is not a bNNN file). Needs b382.
--   psql -X -v ON_ERROR_STOP=1 -d "$CB_REAL_DB" -f scripts/seed-local-installations.sql
--   then run the api with INSTALLATION_KEY=au-test (or ae-test · in-test): the register panel says "This ChitBridge runs in Australia".
-- RLS: none (installation is shared reference, b74). Idempotent (ON CONFLICT DO UPDATE).
INSERT INTO installation (installation_key, label, purpose, cloud_provider, region, zone, domain, currency, timezone, languages, vertical_key, country, active) VALUES
  ('au-test', 'Australia (test spin)', 'GOV-SPIN local test installation', 'local', 'AU', 'local', 'au.localhost', 'AUD', 'Australia/Sydney', '["en-AU"]'::jsonb, 'base', 'AU', true),
  ('ae-test', 'UAE (test spin)',       'GOV-SPIN local test installation', 'local', 'AE', 'local', 'ae.localhost', 'AED', 'Asia/Dubai',       '["en-AE","ar-AE"]'::jsonb, 'base', 'AE', true),
  ('in-test', 'India (test spin)',     'GOV-SPIN local test installation', 'local', 'IN', 'local', 'in.localhost', 'INR', 'Asia/Kolkata',     '["en-IN"]'::jsonb, 'base', 'IN', true),
  ('sg-test', 'Singapore (test spin)', 'GOV-SPIN local test installation', 'local', 'SG', 'local', 'sg.localhost', 'SGD', 'Asia/Singapore',   '["en-SG"]'::jsonb, 'base', 'SG', true),
  ('my-test', 'Malaysia (test spin)',  'GOV-SPIN local test installation', 'local', 'MY', 'local', 'my.localhost', 'MYR', 'Asia/Kuala_Lumpur', '["en-MY"]'::jsonb, 'base', 'MY', true),
  ('us-test', 'United States (test spin)', 'GOV-SPIN local test installation', 'local', 'US', 'local', 'us.localhost', 'USD', 'America/New_York', '["en-US"]'::jsonb, 'base', 'US', true),
  ('jp-test', 'Japan (test spin)',     'GOV-SPIN local test installation', 'local', 'JP', 'local', 'jp.localhost', 'JPY', 'Asia/Tokyo',       '["ja-JP","en-JP"]'::jsonb, 'base', 'JP', true)
ON CONFLICT (installation_key) DO UPDATE SET label = EXCLUDED.label, region = EXCLUDED.region, currency = EXCLUDED.currency,
  timezone = EXCLUDED.timezone, languages = EXCLUDED.languages, vertical_key = EXCLUDED.vertical_key, country = EXCLUDED.country, active = true;
