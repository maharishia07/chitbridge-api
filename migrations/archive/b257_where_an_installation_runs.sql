-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b257 — WHERE AN INSTALLATION ACTUALLY RUNS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- CTP step 2 (docs/CTP-DESIGN.md §11): `deliver()` gains an address resolver, every address still local, no wire
-- and no behaviour change. This is the one fact the resolver needs and the schema cannot currently state.
--
-- ── ⚠️⚠️ AN INSTALLATION IS NOT A MACHINE ───────────────────────────────────────────────────────────────────────
--
-- The obvious resolver is "installation_key = mine → local, else remote". It is wrong, and it would have broken
-- delivery the moment it shipped: `platform-1` is the MEXICAN CHARACTER — region MX, MXN, Spanish,
-- service-desk — and it runs in this very database. Biz Probe is stamped with it right now. Declaring that
-- entity remote would have sent its chits to a wire that does not exist.
--
-- ⭐ `installation` describes a WORLD'S CHARACTER, not its address. b74 gave it `domain` and `zone`, but those
-- were written aspirationally: platform-1 says `mx.chitandbridge.com` while living on ap-south-1 beside
-- everything else. A column that is sometimes a plan and sometimes a fact cannot be a routing decision.
--
-- ── ⭐ SO LOCALITY IS STATED, AND EVERYTHING EXISTING IS LOCAL ──────────────────────────────────────────────────
--
-- `hosted_locally` defaults TRUE, so after this migration every address in the product resolves exactly as it
-- does today and not one delivery changes. Remoteness becomes expressible; nothing becomes remote.
--
-- ⭐⭐ AND FLIPPING THIS BOOLEAN IS THE LIFT. docs/CTP-DESIGN.md §10 says moving a world onto its own machine
-- should be: stand it up, move its rows, add it to the directory — and every address that used to resolve local
-- now resolves remote, with nothing else changing. This column is that last step. If lifting a world ever needs
-- more than this, the transport boundary is in the wrong place and the design is wrong.
--
-- ⚠️ REQUIRES b74 (installation). Idempotent.
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='installation') THEN
    RAISE EXCEPTION 'b257 needs b74 — the installation table does not exist. Run b74 first.';
  END IF;
END $$;

ALTER TABLE installation ADD COLUMN IF NOT EXISTS hosted_locally boolean NOT NULL DEFAULT true;
ALTER TABLE installation ADD COLUMN IF NOT EXISTS ctp_endpoint   text;

COMMENT ON COLUMN installation.hosted_locally IS
  'True when this installation''s entities live in THIS database. Default true, so nothing is remote until '
  'somebody says so. ⚠️ Not derivable from installation_key or domain: platform-1 is the Mexican CHARACTER and '
  'runs here, and its domain column was written as a plan rather than a fact.';

COMMENT ON COLUMN installation.ctp_endpoint IS
  'Where envelopes for this installation are POSTed, when it is not hosted here. Null while hosted_locally. '
  '⚠️ Discovered from the installation''s own signed manifest in the long run (docs/CTP-DESIGN.md §5.1) — this '
  'column is the cache, never the authority.';

/**
 * ⚠️⚠️ A REMOTE INSTALLATION WITH NOWHERE TO SEND IS A BLACK HOLE. Without this, flipping hosted_locally to
 * false makes every chit to those entities resolve "remote" and then fail with no address — and because
 * lib/mint.deliver is the ONLY delivery path, that is every chit in the product for those entities.
 *
 * ⭐ The database refuses the half-finished state, so nobody can lift a world by flipping one boolean and
 * discovering the rest at delivery time.
 */
ALTER TABLE installation DROP CONSTRAINT IF EXISTS installation_remote_needs_endpoint;
ALTER TABLE installation ADD CONSTRAINT installation_remote_needs_endpoint CHECK (
  hosted_locally OR ctp_endpoint IS NOT NULL
);

/**
 * ── ⚠️⚠️ ASKING WHERE AN ENTITY LIVES IS A TOPOLOGY QUESTION, NOT A TENANT ONE ─────────────────────────────────
 *
 * lib/ctpaddress must read `entity_governance.installation_key` for the RECIPIENT of a chit — somebody else's
 * row, on a table that is FORCE ROW LEVEL SECURITY. A plain read answers NOTHING, which the resolver would read
 * as "not stamped, so local" and deliver a remote party's copy into this database.
 *
 * ⚠️ That is the worst shape of silent failure available here: it does not error, it does not warn, and it looks
 * exactly like the correct answer for the 2,485 entities that genuinely have no stamp. It was caught by
 * tests/rls-context.test.cjs — written the same afternoon, for exactly this. [[feedback-silence-is-the-bug]]
 *
 * ⭐ SO IT IS A SECURITY DEFINER FUNCTION THAT RETURNS ONE STRING. Not the row, not the constitution, not
 * anything else about the entity: the key of the installation it is stamped with, which is a fact about the
 * platform's shape and not about anybody's business. [[reference-cb-core-principle]]
 */
DROP FUNCTION IF EXISTS ops.f_installation_of(uuid);
CREATE OR REPLACE FUNCTION ops.f_installation_of(p_entity uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, ops, pg_temp AS $fn$
  SELECT g.installation_key FROM entity_governance g WHERE g.entity_id = p_entity;
$fn$;

COMMENT ON FUNCTION ops.f_installation_of(uuid) IS
  'The installation an entity is stamped with, for CTP address resolution. SECURITY DEFINER because the '
  'recipient''s stamp is not the sender''s to read, and a blind read would answer "unstamped" and route a '
  'remote copy locally. Returns one key and nothing else.';

GRANT USAGE   ON SCHEMA ops                          TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_installation_of(uuid) TO cb_app;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — everything must say LOCAL, or step 2 has changed behaviour it promised not to.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT installation_key, label, region, hosted_locally, coalesce(ctp_endpoint, '—') AS endpoint
  FROM installation ORDER BY installation_key;
