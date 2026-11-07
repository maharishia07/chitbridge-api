-- b840_party_contact_backfill.sql — SEC-130 residual (7 Nov 2026): move the e-mail of every minted party into party_contact, then forbid it on identities.
--
-- ⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres) AFTER b839 is run AND the code that reads party_contact is deployed. One
--    transaction. Safe to re-run (ON CONFLICT DO NOTHING; the UPDATE finds nothing the second time; the constraint is added once).
--
-- DRY RUN FIRST (read-only): SELECT count(*) FROM identities WHERE LEFT(BTRIM(user_id), 1) = '~' AND email IS NOT NULL;   Report the number.
--
-- WHAT. "Minted" is lib/handle.isMinted(): the handle starts with '~' after trimming. The predicate below is that question as SQL (lib/party-contact
--    MINTED_SQL carries the same text; tests/sec-130r-party-contact.test.cjs compares all three).
--    1. copy each minted party's address to party_contact for the shop that minted it (parent_entity_id), lower-cased. A '...@x.cr' sign-in handle
--       that CARRIES an address ('xyz=gmail.com@shop.cr') gives it back as realEmail() does; one that carries a phone or nothing is no address, not copied.
--    2. clear identities.email of every minted party: the address is freed (it no longer blocks another account's) and nothing signs in from it.
--    3. the backstop: a minted party can never carry identities.email again. A code path that forgets writes 23514, not a silent sign-in.
--
-- ROLL BACK: UPDATE identities i SET email = pc.value FROM party_contact pc WHERE pc.party_id = i.identity_id AND pc.owner_entity_id = i.parent_entity_id
--    AND LEFT(BTRIM(i.user_id), 1) = '~' AND i.email IS NULL;  then ALTER TABLE identities DROP CONSTRAINT identities_minted_no_email;  (party_contact keeps its copy.)
-- RLS: runs as postgres, so FORCE RLS does not hide rows from step 1. Touches only rows whose user_id starts with '~'.

BEGIN;

INSERT INTO party_contact (owner_entity_id, party_id, channel, value)
SELECT owner_entity_id, party_id, 'email', addr
  FROM (SELECT parent_entity_id AS owner_entity_id, identity_id AS party_id,
               lower(CASE WHEN email ~* '^[^=@]+=[^@]*@[^.@[:space:]]+\.cr$'
                          THEN regexp_replace(email, '^([^=@]+)=([^@]*)@[^.@[:space:]]+\.cr$', '\1@\2') ELSE email END) AS addr
          FROM identities
         WHERE LEFT(BTRIM(user_id), 1) = '~'
           AND parent_entity_id IS NOT NULL
           AND email IS NOT NULL
           AND (email !~* '@[^.@[:space:]]+\.(cr|br)$' OR email ~* '^[^=@]+=[^@]*@[^.@[:space:]]+\.cr$')) found
 WHERE addr LIKE '%@%' AND char_length(addr) BETWEEN 3 AND 254
ON CONFLICT DO NOTHING;

UPDATE identities SET email = NULL WHERE LEFT(BTRIM(user_id), 1) = '~' AND email IS NOT NULL;

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_minted_no_email;
ALTER TABLE identities ADD CONSTRAINT identities_minted_no_email CHECK (NOT (LEFT(BTRIM(user_id), 1) = '~' AND email IS NOT NULL)) NOT VALID;
ALTER TABLE identities VALIDATE CONSTRAINT identities_minted_no_email;

COMMIT;
