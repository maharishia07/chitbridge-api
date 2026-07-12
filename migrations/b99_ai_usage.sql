-- b99: AI usage METERING. The ANTHROPIC_API_KEY is platform-shared, so every AI draft logs per-entity usage (tokens +
-- estimated cost) → we can see each entity's spend and charge it back (feeds the entitlement/MIS layer). WITH RLS: an
-- entity sees only its own usage. Best-effort logging in lib/ai.js — drafting works even before this runs (just no meter).

CREATE TABLE IF NOT EXISTS ai_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,
  doc_type      text NOT NULL,
  model         text NOT NULL,
  input_tokens  int  NOT NULL DEFAULT 0,
  output_tokens int  NOT NULL DEFAULT 0,
  cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_entity ON ai_usage
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT ON ai_usage TO cb_app;
