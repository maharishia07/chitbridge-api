-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b259 — DECLARING A PAIRING WITHOUT WRITING SQL
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- b258 gave a non-live world a list of installations it will accept envelopes from, and then nothing could
-- write it: `ops` grants cb_app EXECUTE on named functions and nothing else, so the API got
--
--     permission denied for table population
--
-- ⭐ WHICH IS THE RIGHT REFUSAL. ops is operator data and the application has no business writing it directly.
-- The answer is a door, not a GRANT on the table — the same shape b252's desk and b255's placement already use,
-- and the same rule Athi set for all of it: *"we should not write sql for all those, it should be configurable."*
--
-- ── ⚠️ WHAT IT REFUSES, AND WHY EACH ONE MATTERS ────────────────────────────────────────────────────────────────
--
--   · THE LIVE WORLD may never carry a pairing list. live↔live is allowed on the name alone because `live` means
--     the same thing on every installation; a second, weaker rule for the same question wins by accident the day
--     the two disagree. b258's CHECK already forbids it — this refuses earlier, with a sentence.
--   · AN UNKNOWN INSTALLATION cannot be named. A pairing with a typo is a pairing that silently never matches,
--     and the operator would be left believing two sandboxes are wired together. [[feedback-silence-is-the-bug]]
--   · AN INSTALLATION HOSTED HERE cannot be named either: it needs no pairing, it needs no wire, and naming it
--     suggests the crossing would happen when it never would.
--
-- ⚠️ AND IT IS ONE HALF OF A HANDSHAKE. This declares who WE will accept from; the other installation must
-- declare the same about us, in its own database. Neither side can grant itself entry — which is the whole point
-- of §7.1 and the reason two companies wiring their sandboxes together is a deliberate act on both sides.
--
-- ⚠️ REQUIRES b258. Idempotent.
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='ops' AND table_name='population' AND column_name='ctp_peers') THEN
    RAISE EXCEPTION 'b259 needs b258 — ops.population.ctp_peers does not exist. Run b258 first.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS ops.f_set_ctp_peers(text, text[]);
CREATE OR REPLACE FUNCTION ops.f_set_ctp_peers(p_population text, p_peers text[])
RETURNS TABLE (world text, peers text[], note text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
DECLARE v_live boolean; v_bad text; v_clean text[];
BEGIN
  SELECT p.is_live INTO v_live FROM ops.population p WHERE p.code = p_population;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no world called %', p_population USING ERRCODE = 'check_violation';
  END IF;
  IF v_live AND coalesce(array_length(p_peers, 1), 0) > 0 THEN
    RAISE EXCEPTION 'the live world needs no pairing — live reaches live on the name alone'
      USING HINT = 'Pairings exist because a sandbox code is a LOCAL name. `live` is not.',
            ERRCODE = 'check_violation';
  END IF;

  v_clean := coalesce(p_peers, '{}');

  /* ⚠️ every named installation must exist AND be remote, or the operator is told they have wired something up
     when they have wired up a typo. */
  SELECT string_agg(k, ', ') INTO v_bad
    FROM unnest(v_clean) AS k
   WHERE NOT EXISTS (SELECT 1 FROM installation i WHERE i.installation_key = k AND i.active);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'no active installation called %', v_bad
      USING HINT = 'A pairing with a name nothing answers to is one that silently never matches.',
            ERRCODE = 'check_violation';
  END IF;

  SELECT string_agg(k, ', ') INTO v_bad
    FROM unnest(v_clean) AS k
   WHERE EXISTS (SELECT 1 FROM installation i WHERE i.installation_key = k AND i.hosted_locally);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'installation % is hosted here — it needs no pairing and no wire', v_bad
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE ops.population SET ctp_peers = v_clean WHERE code = p_population;

  RETURN QUERY SELECT p_population, v_clean,
    CASE WHEN coalesce(array_length(v_clean, 1), 0) = 0
         THEN 'accepts nobody — the safe default'::text
         ELSE ('accepts ' || array_to_string(v_clean, ', ')
               || ' — and each of them must say the same about us, in their own database')::text END;
END
$fn$;

COMMENT ON FUNCTION ops.f_set_ctp_peers(text, text[]) IS
  'Declare which installations a NON-LIVE world accepts CTP envelopes from. One half of a handshake: the other '
  'side must declare the same about us. Refuses the live world, unknown installations, and any hosted here.';

GRANT USAGE   ON SCHEMA ops                                 TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_set_ctp_peers(text, text[]) TO cb_app;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — every sandbox accepts nobody until somebody says otherwise.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT code, is_live, ctp_peers FROM ops.population ORDER BY is_live DESC, code;
