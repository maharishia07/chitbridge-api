-- b70: MINT the iot-signal WORK-PATTERN blueprint into the b60 catalogue, and carry its GOVERNANCE.
-- This turns the hardcoded blueprint (lib/workpattern.js BLUEPRINTS constant) into a MINTED artifact:
--   source (standard)  ->  template (requirement)  ->  blueprint (governance + version + provenance).
-- The resolution seam then reads THIS minted row (sealed/open/lifecycle) instead of the code constant, and stamps
-- `governed.pattern = 'iot-signal@v1'` onto each chit (version-frozen + provenanced). Self-healing: the seam falls back
-- to the code default until this runs, so nothing breaks before/after. Idempotent. Prereq: b60 (blueprint catalogue).
BEGIN;

-- 1) Carry the WORK-PATTERN governance on a blueprint row (sealed rules · open knobs · lifecycle · workflow).
ALTER TABLE blueprints ADD COLUMN IF NOT EXISTS governance jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) MINT iot-signal as a first-class blueprint — from the 'iot-telemetry' STANDARD (source) + the 'iot-signal'
--    TEMPLATE (both seeded in b60). This is the provenance: which standard + template it was assembled from.
SELECT register_blueprint(
  'iot-signal', 'IoT Signal — work pattern', 'iot-telemetry',
  '["iot-signal"]'::jsonb,                                              -- template_keys (provenance)
  '{"schema_name":"Device Signal","fields":[]}'::jsonb,                 -- pack
  '["routes/connectors.js: emitSignalChit","lib/workpattern.js: resolveWorkPattern"]'::jsonb,  -- requires
  '["connector capability"]'::jsonb,                                    -- prerequisites
  '[]'::jsonb, 'v1');

-- 3) Attach its GOVERNANCE (the static, minted, shared blueprint — sealed frozen · open declared · lifecycle · workflow).
UPDATE blueprints SET governance = '{
  "sealed":   { "copy": "both", "isolation": "per-copy", "lifecycle": ["acknowledge","resolve","close"] },
  "open":     { "folder": null, "counterparty": null, "default_assignee": null, "notify_email": null, "alert_cadence": 60 },
  "workflow": [
    { "done": true,  "t": "Signal received",           "d": "the device authenticates with its own key" },
    { "done": true,  "t": "Sealed as a co-held chit",  "d": "+ the governed audit stamped on it" },
    { "done": true,  "t": "Filed into its folder",     "d": "per-device, auto-created" },
    { "done": true,  "t": "Assigned to a co-assist",   "d": "owned + on someone''s radar" },
    { "done": true,  "t": "Notify external by email",  "d": "an off-rail notice to someone outside the system" },
    { "done": false, "t": "Alert a phone (SMS)",       "d": "escalate to a number — provider-pluggable" },
    { "done": false, "t": "AI triage",                 "d": "classify / summarise / recommend the next action" },
    { "done": false, "t": "Robot / actuator acts",     "d": "e.g. stop the line, close a valve" },
    { "done": false, "t": "Escalate if unacknowledged","d": "climb the ladder until someone owns it" },
    { "done": true,  "t": "Resolve -> Close, report up","d": "lifecycle done; health + events flow to governance" }
  ]
}'::jsonb
WHERE blueprint_key = 'iot-signal';

-- 4) The seam reads this as cb_app — ensure it can (belt-and-braces; the catalogue is shared reference data, no RLS).
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT ON blueprints TO cb_app';
END IF; END $$;

COMMIT;

-- ── PROOF ──────────────────────────────────────────────────────────────────────
-- minted blueprint + provenance:  SELECT blueprint_key, source_key, template_keys, version FROM blueprints WHERE blueprint_key='iot-signal';
-- its governance:                 SELECT governance FROM blueprints WHERE blueprint_key='iot-signal';
