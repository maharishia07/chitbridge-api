-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b252 — EACH POPULATION ANSWERS ITS OWN SUPPORT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"so now our test capture can send the test case, incident and requirement to CBinctst
-- entity so the same cycle can follow?"* — and, earlier and more sharply: *"it never over cross the boundary?"*
--
-- ── ⚠️⚠️ IT DID CROSS ───────────────────────────────────────────────────────────────────────────────────────────
--
-- Every 'platform' ticket resolved to ONE operator entity, so a finding raised by a test entity landed in the
-- live support queue beside a real shop's. b249 stamps a population on every entity and b248 inherits it to
-- children — and nothing downstream read either. A boundary that exists only in the reports is the weakest kind
-- there is.
--
-- ── ⚠️ AND WHAT THIS IS *NOT*, HAVING BEEN TALKED OUT OF IT TWICE ───────────────────────────────────────────────
--
-- ⚠️ NOT AN ENVIRONMENT VARIABLE. I first proposed PLATFORM_ROOT_ENTITY_TEST. Athi: *"we should not write sql
-- for all those"* — and he was right about more than SQL. A support desk is not deployment configuration; it is
-- a decision an operator makes and must be able to see, change and be wrong about without a deploy.
--
-- ⚠️ AND NOT A SUPPLIER LINK EITHER, which was the next idea. Athi: *"assume it is the supplier, that is how it
-- must be working?"* — then, to his credit: *"do not accept what i suggest, please think."* It does not survive
-- the thinking, for three reasons:
--
--   1. routes/relationships.js:414 already forbids it, in writing: adding a supplier is UNILATERAL, *"so being
--      'related' is SELF-ASSERTED and must NOT authorise anything beyond public… Do not add one until it does."*
--      A self-asserted row deciding where work LANDS means anyone can post into a desk that never agreed.
--   2. It makes the boundary opt-in. Every one of 2,485 test entities would need the right row; miss one and its
--      findings sit beside a real shop's. A boundary that depends on 2,485 correct rows is a hope.
--   3. supplier_list.supply_kind is CHECK (resale, own_use). Support is neither, and widening a constraint to
--      make a word fit is always the tell that the table is the wrong one.
--
-- ⭐ A POPULATION IS NOT A PREFERENCE — IT IS WHAT THE ENTITY IS. So the desk hangs off the population, every
-- entity carries its population already, and nobody can forget to set anything. The boundary becomes structural
-- instead of remembered. [[project-support-desks]]
--
-- ⭐ AND IT IS STILL CONFIGURABLE, WHICH WAS THE REAL REQUEST: one column on the registry b249 built, set from
-- the Platform screen by the operator. A row, not a migration; a screen, not an env var.
--
-- ── ⚠️ THE SUPPLIER IDEA IS NOT WRONG, IT IS EARLY ───────────────────────────────────────────────────────────────
--
-- A shop outsourcing its helpdesk to the firm down the road is a real case and this does not serve it. That one
-- needs BILATERAL consent, which `connections` already models (request → accept, routes/connections.js) and
-- supplier_list deliberately does not. When it is wanted, it is a third rung below this one — not a replacement
-- for it, because a fresh entity that has agreed nothing with anybody must still be able to ask for help.
--
-- ⚠️ REQUIRES b249.
-- Supabase → SQL Editor → paste → Run — ⭐ WITHOUT RLS (as `postgres`).
-- ⚠️ Structure needs OWNERSHIP: CREATE/ALTER/GRANT are refused to a role that merely has rights on the rows.
--    Being the owner is NOT the same as bypassing RLS — a table marked FORCE ROW LEVEL SECURITY applies its
--    policies to its owner too.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='ops' AND table_name='population') THEN
    RAISE EXCEPTION 'b252 needs b249 — ops.population does not exist yet. Run b249 first.';
  END IF;
END $$;

-- ── ① THE DESK ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE ops.population ADD COLUMN IF NOT EXISTS desk_entity_id uuid;

COMMENT ON COLUMN ops.population.desk_entity_id IS
  'The operator entity that answers support raised by entities in this population. Null means "use the live '
  'population''s desk" — so a new population is never a dead end, and Get help works on day one.';

/**
 * ── ⚠️⚠️ THE DESK MUST BE IN THE POPULATION IT SERVES ──────────────────────────────────────────────────────────
 *
 * Without this the column is a foot-gun that undoes the whole migration: pointing the TEST population at a LIVE
 * operator entity would route every test finding straight back into the live queue — the exact crossing this
 * exists to stop — and it would do it quietly, because the setting would look deliberate.
 *
 * ⭐ THE ONE EXCEPTION IS 'live' ITSELF, whose desk is the deployment root and is live by definition.
 *
 * ⚠️ A trigger rather than a CHECK, because it has to read another table. And it is deliberately NOT a foreign
 * key: identities is tenant data under FORCE RLS, and an FK from an ops table would tie a structural constraint
 * to a row the constraint cannot always see.
 */
CREATE OR REPLACE FUNCTION ops_population_desk_is_inside() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE theirs text; kind text;
BEGIN
  IF NEW.desk_entity_id IS NULL THEN RETURN NEW; END IF;

  SELECT coalesce(population, 'live'), identity_type INTO theirs, kind
    FROM identities WHERE identity_id = NEW.desk_entity_id;

  IF theirs IS NULL THEN
    RAISE EXCEPTION 'no such entity for the % desk', NEW.code
      USING HINT = 'Create the operator entity first, then name it here.', ERRCODE = 'check_violation';
  END IF;
  /* ⚠️ an actor or a shopper has no work queue of its own — it would accept the setting and swallow the tickets */
  IF kind IS DISTINCT FROM 'entity' THEN
    RAISE EXCEPTION 'the % desk must be a business, not a person', NEW.code
      USING ERRCODE = 'check_violation';
  END IF;
  IF theirs IS DISTINCT FROM NEW.code THEN
    RAISE EXCEPTION 'the % desk must itself be in the % population (it is in %)', NEW.code, NEW.code, theirs
      USING HINT = 'A desk outside the population it serves puts that population''s findings back into '
                   'somebody else''s queue, which is what the populations exist to prevent.',
            ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS ops_population_desk ON ops.population;
CREATE TRIGGER ops_population_desk
  BEFORE INSERT OR UPDATE OF desk_entity_id ON ops.population
  FOR EACH ROW EXECUTE FUNCTION ops_population_desk_is_inside();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⭐ READ IT — and how CBINCTST gets wired, with no SQL after this one.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
--   1. Create CBINCTST from cbincroot, choosing the TEST population. (Platform › Populations.)
--   2. Platform › Populations → Test → "Answers support" → CBINCTST.
--
-- That is all. Every test entity's Get help, requirement and finding then reaches CBINCTST instead of CBINC,
-- because each entity already carries its population and nothing had to be set on any of them.
--
-- ⚠️ THE ZERO-CONFIGURATION PATH IS UNCHANGED. A population with no desk falls back to the live one, so nothing
-- that works today stops working — and lib/platformroot SAYS when it fell back, so a gap can be seen instead of
-- assumed.
--
SELECT p.code, p.label, p.is_live,
       coalesce(d.display_name, '— falls back to the live desk') AS answers_support,
       (SELECT count(*) FROM identities i WHERE coalesce(i.population,'live') = p.code) AS entities
  FROM ops.population p
  LEFT JOIN identities d ON d.identity_id = p.desk_entity_id
 ORDER BY p.is_live DESC, p.code;
