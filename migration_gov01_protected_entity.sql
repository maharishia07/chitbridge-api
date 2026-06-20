-- migration_gov01_protected_entity.sql
-- Additive / forward-only (expand-contract, ED-GAP-3 doctrine). No drops, no destructive change.
-- Safe to run alongside live traffic. Wrap in a transaction; re-runnable (IF NOT EXISTS guards).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- 1) Protected root: a sealed singleton anchor (the protected entity).
CREATE TABLE IF NOT EXISTS platform_root (
  root_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text        NOT NULL DEFAULT 'CB protected root',
  sealed     boolean     NOT NULL DEFAULT true,
  singleton  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- exactly one root row, ever
CREATE UNIQUE INDEX IF NOT EXISTS platform_root_singleton ON platform_root ((singleton));

-- 2) Versioned constitution: append-only; exactly one active per root.
CREATE TABLE IF NOT EXISTS platform_constitution (
  constitution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  root_id    uuid        NOT NULL REFERENCES platform_root(root_id),
  version    text        NOT NULL,
  as_of      date        NOT NULL DEFAULT current_date,
  params     jsonb       NOT NULL,                       -- defaults / allowed / policy / invariants
  plan_menu  jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- entitlement tiers
  is_active  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  UNIQUE (root_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_constitution_one_active
  ON platform_constitution (root_id) WHERE is_active;

-- 3) Flagged exceptions (Class C — never silent).
CREATE TABLE IF NOT EXISTS governance_exceptions (
  exception_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id  uuid        NOT NULL,
  klass      text        NOT NULL,           -- e.g. 'C_ADVISORY'
  key        text,
  detail     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS governance_exceptions_entity_idx ON governance_exceptions (entity_id);

-- 4) Governance columns on the business-entity table (identities).
--    Soft reference for now: identities has dual-uuid hygiene issues (ATH-86);
--    promote governed_by to a hard FK after that cleanup.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS governed_by          uuid;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS constitution_version text;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS params_override      jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS plan                 text  NOT NULL DEFAULT 'free';
CREATE INDEX IF NOT EXISTS identities_governed_by_idx ON identities (governed_by);

-- 5) Change-control: the ONLY sanctioned way to flip the active version.
--    Keeps is_active out of open UPDATEs; forward-only by construction.
CREATE OR REPLACE FUNCTION activate_constitution(p_root uuid, p_version text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE platform_constitution SET is_active = false WHERE root_id = p_root AND is_active;
  UPDATE platform_constitution SET is_active = true  WHERE root_id = p_root AND version = p_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'constitution % not found for root %', p_version, p_root;
  END IF;
END $fn$;

COMMIT;

-- =====================================================================
-- SEED (run once, after the migration): root + constitution v0.1, then activate.
-- =====================================================================
BEGIN;

INSERT INTO platform_root (label)
SELECT 'CB protected root'
WHERE NOT EXISTS (SELECT 1 FROM platform_root);

INSERT INTO platform_constitution (root_id, version, params, plan_menu, created_by)
SELECT (SELECT root_id FROM platform_root LIMIT 1),
  '0.1',
  $params${
    "defaults": {"currency_code":"INR","default_language":"en","exposure_default":"private","region":"IN","default_timezone":"Asia/Kolkata"},
    "allowed":  {"languages":["en"],"exposure_tiers":["private","restricted","public"],"regions_reference":["IN","LK","AE"]},
    "policy":   {"override_rule":"tighten_only"},
    "invariants":["no_orphans","default_deny","most_restrictive_wins","carry_lineage","freeze_append_only","forward_only","complete_or_cleanly_stop"]
  }$params$::jsonb,
  $plans${
    "free":       {"max_entities":5,   "chits_per_day":10,  "max_networks":1,  "network_depth":1, "public_facing":false,"mode":"b2b_only"},
    "pro":        {"max_entities":50,  "chits_per_day":500, "max_networks":10, "network_depth":3, "public_facing":true, "mode":"b2b_b2c"},
    "enterprise": {"max_entities":null,"chits_per_day":null,"max_networks":null,"network_depth":null,"public_facing":true,"mode":"b2b_b2c"}
  }$plans$::jsonb,
  'genesis'
WHERE NOT EXISTS (
  SELECT 1 FROM platform_constitution WHERE version = '0.1'
);

SELECT activate_constitution((SELECT root_id FROM platform_root LIMIT 1), '0.1');

COMMIT;

-- To test version applicability later (v0.2: currency USD, languages en/ta/hi):
--   INSERT a new row with version '0.2' (same shape), then
--   SELECT activate_constitution((SELECT root_id FROM platform_root LIMIT 1), '0.2');
-- Existing entities keep their stamped version until re-attested (forward-only).
