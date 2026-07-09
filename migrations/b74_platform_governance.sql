-- b74: PLATFORM / GOVERNANCE data model — makes "spin platform-N in <cloud> for <vertical> in <zone>" ONE ROW.
-- Everything is ATTRIBUTES (data) the engine reads; no governance content in code. WITHOUT RLS for shared catalogues
-- (installation), the per-entity stamp stays WITH RLS. Prereq: b72 (constitution) + b73 (entity_governance). Idempotent.
BEGIN;

-- 1) INSTALLATION (L1) — a platform instance. "Spin platform-1 in AWS for service-desk in MX" = INSERT one row.
CREATE TABLE IF NOT EXISTS installation (
  installation_key text PRIMARY KEY,
  label            text,
  purpose          text,
  cloud_provider   text,                                 -- aws · gcp · azure · railway ...
  region           text,                                 -- IN · US · MX ...
  zone             text,                                 -- ap-south-1 · mx-central-1 ...
  domain           text,
  currency         text,                                 -- default currency for entities on this installation
  timezone         text,
  languages        jsonb NOT NULL DEFAULT '[]'::jsonb,
  vertical_key     text,                                 -- the constitution/vertical this installation serves
  root_key_ref     text,                                 -- ref to the root<->platform key-pair (the sovereignty anchor)
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- the CURRENT live platform (India, base) + a DEMO Mexican service-desk platform (proves the "spin" is one row).
INSERT INTO installation (installation_key,label,purpose,cloud_provider,region,zone,domain,currency,timezone,languages,vertical_key,root_key_ref) VALUES
  ('platform-0','Main platform','the live installation','railway+vercel+supabase','IN','ap-south-1','chitandbridge.com','INR','Asia/Kolkata','["en"]'::jsonb,'base','root-key-0'),
  ('platform-1','Mexico Service Desk','service-desk for the Mexican area','aws','MX','mx-central-1','mx.chitandbridge.com','MXN','America/Mexico_City','["es"]'::jsonb,'service-desk','root-key-1')
ON CONFLICT (installation_key) DO UPDATE SET
  label=EXCLUDED.label, purpose=EXCLUDED.purpose, cloud_provider=EXCLUDED.cloud_provider, region=EXCLUDED.region,
  zone=EXCLUDED.zone, domain=EXCLUDED.domain, currency=EXCLUDED.currency, timezone=EXCLUDED.timezone,
  languages=EXCLUDED.languages, vertical_key=EXCLUDED.vertical_key, root_key_ref=EXCLUDED.root_key_ref;

-- 2) enrich CONSTITUTION with the universal BASICS + JURISDICTION (attributes; tighten-only source of truth).
UPDATE constitution SET governance = governance || '{
  "defaults":     {"currency":"INR","timezone":"Asia/Kolkata","region":"IN","languages":["en"]},
  "allowed":      {"currencies":["INR","USD","MXN","EUR"],"regions":["IN","US","MX","EU"],"timezones":["Asia/Kolkata","America/Mexico_City","America/New_York","Europe/London"],"languages":["en","es","ta","hi"]},
  "jurisdiction": {"mode":"supplier","custodian":false,"disclaimer":"The platform is the provider, not the custodian of the transaction; disputes are handled within the supplier''s jurisdiction."}
}'::jsonb WHERE constitution_key = 'base';

UPDATE constitution SET governance = governance || '{
  "defaults":     {"currency":"MXN","timezone":"America/Mexico_City","region":"MX","languages":["es"]},
  "jurisdiction": {"mode":"supplier","custodian":false,"disclaimer":"The platform is the provider, not the custodian of the transaction; disputes are handled within the supplier''s jurisdiction (MX)."}
}'::jsonb WHERE constitution_key = 'service-desk';

-- 3) tie each ENTITY to the platform it lives on (default the live one). Per-entity stamp = already WITH RLS (b73).
ALTER TABLE entity_governance ADD COLUMN IF NOT EXISTS installation_key text NOT NULL DEFAULT 'platform-0';

-- 4) also let capability declare its allowances (limits) as attributes (already has max_devices; add the rest).
UPDATE capability SET governance = jsonb_set(governance, '{open}',
  COALESCE(governance->'open','{}'::jsonb) || '{"max_devices":25,"max_endpoints":25}'::jsonb)
  WHERE capability_key = 'connector';

-- 5) grants — installation is shared reference (SELECT-only for cb_app; NO RLS, no entity_id).
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT ON installation TO cb_app';
END IF; END $$;

COMMIT;

-- ── PROOF ──────────────────────────────────────────────────────────────────────
-- installations (the "spin a platform" rows):  SELECT installation_key, cloud_provider, region, currency, vertical_key FROM installation;
-- a constitution's basics + jurisdiction:       SELECT constitution_key, governance->'defaults', governance->'jurisdiction' FROM constitution;
