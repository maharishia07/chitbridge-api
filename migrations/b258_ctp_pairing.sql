-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b258 — TWO SANDBOXES MAY TALK, BUT ONLY IF BOTH SAY SO
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- docs/CTP-DESIGN.md §7.1, and it was found by running the thing rather than by reading it.
--
-- ── ⚠️ WHAT THE LOOPBACK PROOF FOUND ────────────────────────────────────────────────────────────────────────────
--
-- A chit from a `test` entity was refused entry with *"population test may not deliver into live"*. The refusal
-- was right in spirit and the reason was wrong: routes/ctp.js asked `SELECT code FROM ops.population WHERE
-- is_live` and treated that one answer as "the world this installation is".
--
-- ⭐ AN INSTALLATION HOSTS MANY WORLDS. b254/b255 settled it in the other direction too — one population spans
-- many installations (live already spans India and Mexico), and one installation holds many populations. So
-- there is no such thing as "the population of this installation", and a door built on that idea refuses
-- everything that is not live.
--
-- ⭐ THE CHECK THAT IS ACTUALLY RIGHT: the envelope's population must match THE RECIPIENT'S. That is a fact
-- about the two parties, which is exactly what b247 enforces when both rows are in one database.
--
-- ── ⭐⭐ AND THEN THE HARD HALF: `test` IS A LOCAL NAME ──────────────────────────────────────────────────────────
--
-- Athi, 2026-09-15: *"only for LIVE to Live, test to test? is that correct?"* — right for live, a trap for the
-- rest. `live` means the same thing on every installation in the world. `test` on our engine and `test` on a
-- customer's engine are TWO UNRELATED SEALED WORLDS that happen to share a word, and matching on the string
-- would wire a stranger's sandbox to ours because both of us typed the obvious thing.
--
-- ⭐ SO A NON-LIVE WORLD NAMES THE INSTALLATIONS IT WILL ACCEPT FROM, and the other side must do the same. Two
-- companies deliberately wiring their sandboxes together to rehearse an integration before going live is a
-- thing people genuinely want — it just has to be SAID by both, rather than inferred from a name.
--
-- ⚠️ REQUIRES b249. Idempotent.
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='ops' AND table_name='population') THEN
    RAISE EXCEPTION 'b258 needs b249 — ops.population does not exist. Run b249 first.';
  END IF;
END $$;

ALTER TABLE ops.population ADD COLUMN IF NOT EXISTS ctp_peers text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN ops.population.ctp_peers IS
  'Installation keys this NON-LIVE world will accept CTP envelopes from. Empty means none, which is the default '
  'and the safe answer: a population code is a LOCAL name, so a shared word is not a shared world. ⚠️ Ignored '
  'for the live world, which is universally shared and needs no pairing.';

/**
 * ⚠️⚠️ THE LIVE WORLD NEVER NEEDS A PAIRING, AND MUST NEVER CARRY ONE.
 *
 * live↔live is allowed on the name alone because `live` means the same thing everywhere — that is what makes
 * cross-border commerce possible at all. A pairing list on the live world would be a second, weaker rule for
 * the same question, and the day the two disagree the weaker one wins by accident.
 */
ALTER TABLE ops.population DROP CONSTRAINT IF EXISTS ops_population_live_needs_no_peers;
ALTER TABLE ops.population ADD CONSTRAINT ops_population_live_needs_no_peers CHECK (
  NOT is_live OR ctp_peers = '{}'
);

/**
 * ⭐ May an envelope from `p_installation`, claiming world `p_population`, be written to a recipient in that
 * same world here?
 *
 * ⚠️ IT TAKES THE RECIPIENT'S WORLD AS THE SUBJECT, not "this installation's world" — there is no such thing.
 * ⚠️ AND IT IS DEFAULT-DENY. An unknown population, a missing row, a null anything: no.
 */
DROP FUNCTION IF EXISTS ops.f_ctp_may_deliver(text, text);
CREATE OR REPLACE FUNCTION ops.f_ctp_may_deliver(p_population text, p_installation text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
  SELECT COALESCE((
    SELECT CASE
             WHEN p.is_live THEN true                               -- live is universally shared
             WHEN p_installation IS NULL THEN false
             ELSE p_installation = ANY (p.ctp_peers)                -- a local name needs an explicit pairing
           END
      FROM ops.population p WHERE p.code = p_population
  ), false);
$fn$;

COMMENT ON FUNCTION ops.f_ctp_may_deliver(text, text) IS
  'May an envelope from this installation be written into this world? live: always. Anything else: only where '
  'the world names that installation in ctp_peers. Default-deny — an unknown world answers no.';

GRANT USAGE   ON SCHEMA ops                                 TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_ctp_may_deliver(text, text) TO cb_app;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — live accepts anyone; every sandbox accepts nobody until it is told.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT code, is_live, ctp_peers,
       ops.f_ctp_may_deliver(code, 'some-stranger') AS a_stranger_may_deliver
  FROM ops.population ORDER BY is_live DESC, code;
