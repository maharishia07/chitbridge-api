-- tests/b911-signin-link-bind.proof.sql — proof for migrations/b911 (M2, GF-platform-01). Run on a THROWAWAY database rebuilt from the chain
-- (or a schema-only pg_dump of SIT) AS a superuser:  psql -X -q -v mutant=false -f tests/b911-signin-link-bind.proof.sql
-- (mutant=true drops the trigger first: the two ATTACK rows must then be ACCEPTED, which proves the test bites). Expect, with the fix, the line "RESULT PASS".
\set ON_ERROR_STOP on
\i migrations/b911_signin_provider_link_identity_bind.sql
\if :mutant
DROP TRIGGER signin_provider_link_identity_bind ON signin_provider_link;
\endif
ALTER TABLE identities DISABLE TRIGGER ALL;   -- fixtures only: no population / parent FK rows needed
INSERT INTO identities (identity_id, bridge_id, identity_type, display_name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'PA', 'entity', 'shop A'), ('00000000-0000-0000-0000-00000000000b', 'PB', 'entity', 'shop B');
INSERT INTO identities (identity_id, bridge_id, identity_type, display_name, parent_entity_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'PB1', 'actor', 'person of B', '00000000-0000-0000-0000-00000000000b');
ALTER TABLE identities ENABLE TRIGGER ALL;
CREATE TEMP TABLE proof (what text, ok boolean);
DO $t$
DECLARE a uuid := '00000000-0000-0000-0000-00000000000a'; b uuid := '00000000-0000-0000-0000-00000000000b'; b1 uuid := '00000000-0000-0000-0000-0000000000b1'; refused boolean;
BEGIN
  INSERT INTO signin_provider_link (entity_id, identity_id, provider, issuer, subject) VALUES (b, b1, 'google', 'i', 's1');   -- own person
  INSERT INTO signin_provider_link (entity_id, identity_id, provider, issuer, subject) VALUES (b, b, 'google', 'i', 's2');    -- the entity itself
  INSERT INTO proof VALUES ('own person and the entity itself are accepted', true);
  BEGIN INSERT INTO signin_provider_link (entity_id, identity_id, provider, issuer, subject) VALUES (a, b1, 'microsoft', 'i', 's3'); refused := false;
  EXCEPTION WHEN check_violation THEN refused := true; END;
  INSERT INTO proof VALUES ('ATTACK: shop A entity with shop B person is refused', refused);
  BEGIN INSERT INTO signin_provider_link (entity_id, identity_id, provider, issuer, subject) VALUES (a, b1, 'google', 'i', 's9'); refused := false;
  EXCEPTION WHEN check_violation THEN refused := true; WHEN unique_violation THEN refused := false; END;   -- unique_violation = the existence oracle is open
  INSERT INTO proof VALUES ('ATTACK: no duplicate-key answer about another shop''s identity (bind check first)', refused);
  BEGIN UPDATE signin_provider_link SET entity_id = a WHERE subject = 's1'; refused := false;
  EXCEPTION WHEN check_violation THEN refused := true; END;
  INSERT INTO proof VALUES ('ATTACK: re-pointing a link to another entity is refused', refused);
END $t$;
SELECT * FROM proof;
SELECT CASE WHEN bool_and(ok) THEN 'RESULT PASS' ELSE 'RESULT FAIL' END FROM proof;
