-- b70: the MINTED WORK-PATTERN catalogue. Turns the hardcoded blueprint (lib/workpattern.js BLUEPRINTS constant) into
-- a MINTED, versioned, provenanced artifact. The resolution seam reads THIS row (sealed/open/lifecycle) instead of the
-- code constant, and stamps `governed.pattern = 'iot-signal@v1'` on each chit (version-frozen). Self-contained: no
-- dependency on b60's register_blueprint (which isn't installed). Shared reference data (one canonical row per
-- pattern@version) — NOT per-entity, so NO RLS. Idempotent / re-runnable.
BEGIN;

CREATE TABLE IF NOT EXISTS work_pattern (
  pattern_key   text NOT NULL,
  version       text NOT NULL DEFAULT 'v1',
  vertical      text,                                   -- the vertical/industry this targets (NULL = universal)
  source_key    text,                                   -- provenance: the STANDARD it derives from (e.g. iot-telemetry)
  template_keys jsonb NOT NULL DEFAULT '[]'::jsonb,     -- provenance: the templates assembled
  governance    jsonb NOT NULL DEFAULT '{}'::jsonb,     -- the STATIC blueprint: sealed · open · lifecycle · workflow
  active        boolean NOT NULL DEFAULT true,
  minted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pattern_key, version)
);
-- invariant: at most ONE active version per pattern (so a chit's blueprint@version is unambiguous)
CREATE UNIQUE INDEX IF NOT EXISTS work_pattern_active_idx ON work_pattern(pattern_key) WHERE active = true;

-- MINT iot-signal@v1 — provenance: standard 'iot-telemetry' + template 'iot-signal'; carries its governance.
INSERT INTO work_pattern (pattern_key, version, vertical, source_key, template_keys, governance) VALUES
  ('iot-signal', 'v1', NULL, 'iot-telemetry', '["iot-signal"]'::jsonb, '{
     "sealed":   { "copy": "both", "isolation": "per-copy", "lifecycle": ["acknowledge","resolve","close"] },
     "open":     { "folder": null, "counterparty": null, "default_assignee": null, "notify_email": null, "alert_cadence": 60 },
     "workflow": [
       { "done": true,  "t": "Signal received",            "d": "the device authenticates with its own key" },
       { "done": true,  "t": "Sealed as a co-held chit",   "d": "+ the governed audit stamped on it" },
       { "done": true,  "t": "Filed into its folder",      "d": "per-device, auto-created" },
       { "done": true,  "t": "Assigned to a co-assist",    "d": "owned + on someone''s radar" },
       { "done": true,  "t": "Notify external by email",   "d": "an off-rail notice to someone outside the system" },
       { "done": false, "t": "Alert a phone (SMS)",        "d": "escalate to a number — provider-pluggable" },
       { "done": false, "t": "AI triage",                  "d": "classify / summarise / recommend the next action" },
       { "done": false, "t": "Robot / actuator acts",      "d": "e.g. stop the line, close a valve" },
       { "done": false, "t": "Escalate if unacknowledged", "d": "climb the ladder until someone owns it" },
       { "done": true,  "t": "Resolve -> Close, report up","d": "lifecycle done; health + events flow to governance" }
     ]
  }'::jsonb)
ON CONFLICT (pattern_key, version) DO UPDATE SET
  vertical = EXCLUDED.vertical, source_key = EXCLUDED.source_key,
  template_keys = EXCLUDED.template_keys, governance = EXCLUDED.governance, active = true;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT ON work_pattern TO cb_app';
END IF; END $$;

COMMIT;

-- ── PROOF ──────────────────────────────────────────────────────────────────────
-- the minted blueprint + provenance:  SELECT pattern_key, version, source_key, template_keys FROM work_pattern;
-- its governance:                      SELECT governance FROM work_pattern WHERE pattern_key='iot-signal';
