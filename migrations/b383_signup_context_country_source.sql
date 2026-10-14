-- b383_signup_context_country_source.sql — GOV-SPIN: WHERE THE ACCEPTED COUNTRY CAME FROM, on the agreement's own audit row.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (IF NOT EXISTS; CHECK added only when absent).
--    Until it runs nothing breaks: routes/signin.js names the column only once schema.hasColumn says it exists.
--
-- RLS: unchanged — signup_context stays WITHOUT RLS, support-only, never on a tenant route (b264's statement).
--
-- WHAT: signup_context.country_source — 'installation' (this ChitBridge states the country, b382) · 'browser' (the browser's time-zone
--    guess, M196) · 'chosen' (the registrant picked another country the constitution allows). Written by: verify (routes/signin.js) when
--    the register panel's reg-agree was ticked. Read by: support only. The shopkeeper's WORDS for the same fact stay in
--    entity_governance.setup_source.country (b299) — this is the code, that is the sentence.
--
-- UNDO (only on Athi's word): ALTER TABLE signup_context DROP COLUMN country_source;

-- ═════ STEP 1 · APPLY ══════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE signup_context ADD COLUMN IF NOT EXISTS country_source text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signup_context_country_source_ok') THEN
    ALTER TABLE signup_context ADD CONSTRAINT signup_context_country_source_ok
      CHECK (country_source IS NULL OR country_source IN ('installation', 'browser', 'chosen'));
  END IF;
END $$;

-- ═════ PROOFS (read-only) ═══════════════════════════════════════════════════════════════════════════════════════
SELECT count(*) AS country_source_column_must_be_1 FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'signup_context' AND column_name = 'country_source';
