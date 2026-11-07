-- b840_party_contact_backfill.sql — SEC-130 residual (7 Nov 2026): move the e-mail of every minted party into party_contact, then forbid it on identities.
--
-- ⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres).
-- ⚠️⚠️ ORDER, ALWAYS: b839 → DEPLOY the code that writes party_contact → b840. NEVER b840 before the deploy: the old code still writes the address to
--    identities.email, the CHECK below then refuses it (23514) and EVERY customer add or move-in row with an e-mail fails. (On SIT the migrate job must
--    run b839, then the deploy, then b840; or accept a short error window on SIT only.)
-- Two short transactions in this one file (b773 does the same): the first backfills, clears and adds the rule for NEW writes only (NOT VALID); the
--    second only VALIDATEs, so the lock ADD CONSTRAINT takes on identities is not held while the old rows are scanned. If VALIDATE finds a row (it should
--    not, step 2 cleared them all) it stops with the name and the rule stays NOT VALID; paste the error back, nothing is half-changed.
--    Safe to re-run (ON CONFLICT DO NOTHING; the UPDATE finds nothing the second time; the constraint is dropped and added again).
--
-- DRY RUN FIRST (read-only), report all three numbers:
--    SELECT count(*) FILTER (WHERE parent_entity_id IS NOT NULL) AS to_copy,
--           count(*) FILTER (WHERE parent_entity_id IS NULL)     AS orphans_nulled_without_copy,
--           count(*) FILTER (WHERE user_id ~ '^[[:space:]]*~' AND LEFT(BTRIM(user_id), 1) <> '~') AS tab_or_newline_before_tilde
--      FROM identities WHERE user_id ~ '^[[:space:]]*~' AND email IS NOT NULL;
--    Expect orphans 0 and the last number 0. An orphan is a minted handle with no shop (parent_entity_id NULL): there is no shop to scope its address
--    to, so it is NOT copied, only cleared (decision 7 Nov). If the number is not 0, look at those rows before applying.
--
-- WHAT. "Minted" is lib/handle.isMinted(): the handle starts with '~' after trimming ALL whitespace (JS trim()). The SQL form is user_id ~ '^[[:space:]]*~'
--    (BTRIM trims spaces only, so a tab or newline before the '~' would have slipped past it). lib/party-contact MINTED_SQL carries the same text;
--    tests/sec-130r-party-contact.test.cjs compares both with handle.isMinted. (Unicode spaces such as a no-break space are not in [[:space:]]: none
--    can be minted, mint() writes '~' first.)
--    1. copy each minted party's address to party_contact for the shop that minted it (parent_entity_id), lower-cased. A '...@x.cr' sign-in handle
--       that CARRIES an address ('xyz=gmail.com@shop.cr') gives it back as realEmail() does; one that carries a phone or nothing is no address, not copied.
--    2. clear identities.email of every minted party: the address is freed (it no longer blocks another account's) and nothing signs in from it.
--    3. the backstop: a minted party can never carry identities.email again. A code path that forgets writes 23514, not a silent sign-in.
--
-- ROLL BACK: UPDATE identities i SET email = pc.value FROM party_contact pc WHERE pc.party_id = i.identity_id AND pc.owner_entity_id = i.parent_entity_id
--    AND i.user_id ~ '^[[:space:]]*~' AND i.email IS NULL;  after ALTER TABLE identities DROP CONSTRAINT identities_minted_no_email;  (party_contact keeps its copy.)
-- RLS: runs as postgres, so FORCE RLS does not hide rows from step 1. Touches only rows whose user_id starts with '~'.

BEGIN;

INSERT INTO party_contact (owner_entity_id, party_id, channel, value)
SELECT owner_entity_id, party_id, 'email', addr
  FROM (SELECT parent_entity_id AS owner_entity_id, identity_id AS party_id,
               lower(CASE WHEN email ~* '^[^=@]+=[^@]*@[^.@[:space:]]+\.cr$'
                          THEN regexp_replace(email, '^([^=@]+)=([^@]*)@[^.@[:space:]]+\.cr$', '\1@\2') ELSE email END) AS addr
          FROM identities
         WHERE user_id ~ '^[[:space:]]*~'
           AND parent_entity_id IS NOT NULL
           AND email IS NOT NULL
           AND (email !~* '@[^.@[:space:]]+\.(cr|br)$' OR email ~* '^[^=@]+=[^@]*@[^.@[:space:]]+\.cr$')) found
 WHERE addr LIKE '%@%' AND char_length(addr) BETWEEN 3 AND 254
ON CONFLICT DO NOTHING;

UPDATE identities SET email = NULL WHERE user_id ~ '^[[:space:]]*~' AND email IS NOT NULL;

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_minted_no_email;
ALTER TABLE identities ADD CONSTRAINT identities_minted_no_email CHECK (NOT (user_id ~ '^[[:space:]]*~' AND email IS NOT NULL)) NOT VALID;

COMMIT;

BEGIN;

ALTER TABLE identities VALIDATE CONSTRAINT identities_minted_no_email;

COMMIT;
