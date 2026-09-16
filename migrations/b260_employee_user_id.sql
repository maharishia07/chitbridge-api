-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
--  b260 · THE EMPLOYEE ID, STORED — ravi@acmetraders.br
--
--  Athi, 2026-09-15:
--    "each employee must be having an employee id, which is his username what he types while creating the id,
--     username@entityid, now I am asking you to add .br and that information has to be stored in the table as
--     user id, which cannot be drifted… the user-id table will have three different ids: a) entity-id,
--     b) employee id, c) customer id with its own @ and .br or .cr differentiation."
--
--  Until now `identities.user_id` held ENTITIES only. An actor row carried `actor_key` + `parent_entity_id` and
--  no user_id at all, and `ravi@acmetraders` was composed at display time — which made an employee unaddressable:
--  nothing could look one up. This stamps every existing co-assist.
--
--  ── ⚠️⚠️ THE FORM MUST MATCH lib/mintuserid.js EXACTLY, CHARACTER FOR CHARACTER ──────────────────────────────
--
--      lower(actor_key) || '@' || coalesce(e.user_id, e.bridge_id) || '.br'
--
--  Note what is NOT lowercased: the business half. A `user_id` is already lowercase by construction, but a
--  BRIDGE ID is upper case, and the JS builder does not lowercase it either. This was learned the expensive way
--  on the CUSTOMER form — lowercasing the owner there would have failed to recognise every returning customer of
--  a pre-b170 shop, because the storefront looks that key up with an exact `WHERE email = $1`. Same rule here.
--
--  ── WHY IT CANNOT COLLIDE ────────────────────────────────────────────────────────────────────────────────────
--    · UNIQUE(actor_key, parent_entity_id) already makes one key unique per business
--    · the business half is itself globally unique
--    · an ENTITY can never collide: checkRoot forbids "@" in a registered handle
--    · a CUSTOMER can never collide: different suffix (.cr)
--  So the composed id is unique by construction. Section 3 proves it on the real data before section 4 writes,
--  and the whole thing is one transaction: if the proof fails, nothing is stamped.
--
--  IDEMPOTENT. Only rows with a NULL user_id are touched, so running it twice changes nothing the second time.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1 · WHAT IS THERE NOW ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n_actors bigint; n_null bigint; n_orphan bigint;
BEGIN
  SELECT count(*) INTO n_actors FROM identities WHERE identity_type = 'actor';
  SELECT count(*) INTO n_null   FROM identities WHERE identity_type = 'actor' AND user_id IS NULL;
  SELECT count(*) INTO n_orphan FROM identities a
    WHERE a.identity_type = 'actor' AND a.user_id IS NULL
      AND (a.actor_key IS NULL OR a.parent_entity_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM identities e WHERE e.identity_id = a.parent_entity_id));
  RAISE NOTICE 'b260 · actors=% · without a user_id=% · unstampable (no key or no parent)=%', n_actors, n_null, n_orphan;
END $$;

-- ── 2 · THE FORM, IN ONE PLACE ───────────────────────────────────────────────────────────────────────────────
-- ⚠️ A function, not a repeated expression: section 3 proves and section 4 writes, and if those two ever spelled
--    the id differently the proof would be of something other than what gets stored.
CREATE OR REPLACE FUNCTION ops.f_employee_user_id(p_actor_key text, p_owner_user_id text, p_owner_bridge_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(p_actor_key) || '@' || coalesce(nullif(trim(p_owner_user_id), ''), p_owner_bridge_id) || '.br';
$$;

COMMENT ON FUNCTION ops.f_employee_user_id(text, text, text) IS
  'The stored employee id. MUST stay identical to lib/mintuserid.js employee() — the business half is NOT '
  'lowercased, because a bridge id is upper case and the JS builder does not lowercase it either.';

-- ── 3 · PROVE IT BEFORE WRITING IT ───────────────────────────────────────────────────────────────────────────
-- ⚠️ A duplicate here would abort the whole UPDATE anyway, on the unique index — but it would abort with
--    "duplicate key value violates unique constraint", which says nothing about WHICH two rows or why. This
--    fails with the names in the message, because a migration that cannot be diagnosed is one nobody dares run.
DO $$
DECLARE d record; n int := 0;
BEGIN
  FOR d IN
    SELECT ops.f_employee_user_id(a.actor_key, e.user_id, e.bridge_id) AS uid, count(*) AS c
      FROM identities a JOIN identities e ON e.identity_id = a.parent_entity_id
     WHERE a.identity_type = 'actor' AND a.user_id IS NULL AND a.actor_key IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1
  LOOP
    RAISE WARNING 'b260 · % would be given to % employees', d.uid, d.c;
    n := n + 1;
  END LOOP;
  IF n > 0 THEN
    RAISE EXCEPTION 'b260 · % employee id(s) would collide — nothing stamped. Fix the duplicate actor_keys first.', n;
  END IF;

  -- and against the ids that already exist (entities, customers, older actors)
  FOR d IN
    SELECT ops.f_employee_user_id(a.actor_key, e.user_id, e.bridge_id) AS uid, count(*) AS c
      FROM identities a JOIN identities e ON e.identity_id = a.parent_entity_id
     WHERE a.identity_type = 'actor' AND a.user_id IS NULL AND a.actor_key IS NOT NULL
       AND EXISTS (SELECT 1 FROM identities x
                    WHERE lower(x.user_id) = lower(ops.f_employee_user_id(a.actor_key, e.user_id, e.bridge_id)))
     GROUP BY 1
  LOOP
    RAISE EXCEPTION 'b260 · % is already taken by an existing row — nothing stamped.', d.uid;
  END LOOP;
END $$;

-- ── 4 · STAMP ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE identities a
   SET user_id = ops.f_employee_user_id(a.actor_key, e.user_id, e.bridge_id)
  FROM identities e
 WHERE a.identity_type = 'actor'
   AND a.user_id IS NULL
   AND a.actor_key IS NOT NULL
   AND e.identity_id = a.parent_entity_id;

-- ── 5 · WHAT HAPPENED ────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n_done bigint; n_left bigint; sample text;
BEGIN
  SELECT count(*) INTO n_done FROM identities WHERE identity_type = 'actor' AND user_id LIKE '%.br';
  SELECT count(*) INTO n_left FROM identities WHERE identity_type = 'actor' AND user_id IS NULL;
  SELECT string_agg(user_id, ' · ') INTO sample
    FROM (SELECT user_id FROM identities WHERE identity_type = 'actor' AND user_id LIKE '%.br' ORDER BY created_at DESC LIMIT 3) t;
  RAISE NOTICE 'b260 · stamped=% · still without one=% (no actor_key, or no parent row)', n_done, n_left;
  RAISE NOTICE 'b260 · sample: %', coalesce(sample, '(none)');
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
--  ⚠️ AFTER THIS RUNS, ONE CLAIM IN docs/NAMESPACE.md §3 STOPS BEING TRUE: "identities.user_id never contains
--  an @". It now does, for every employee — which is the point. The separation between an employee handle and a
--  foreign address is no longer "one of them cannot be stored", it is the `.br` / `.cr` suffixes, exactly as
--  specified. docs/namespace.yaml and tests/namespace.test.cjs are updated in the same commit.
--
--  TO CHECK, after running:
--    SELECT user_id, actor_key, display_name FROM identities WHERE identity_type = 'actor' ORDER BY created_at DESC LIMIT 10;
--
--  TO UNDO (it stamps nothing else, so this is complete):
--    UPDATE identities SET user_id = NULL WHERE identity_type = 'actor' AND user_id LIKE '%.br';
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
