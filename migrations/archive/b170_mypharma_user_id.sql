-- b170 — give "mypharma" the User ID it never got.
--
-- Athi created this entity on 2026-08-18, BEFORE registration started asking for a User ID. So the column is
-- NULL and every screen that needs a handle has been showing a guess made from the business name.
--
-- ⚠️ WHY SQL AND NOT THE SCREEN: the profile field would work — the repair path in PATCH /entities/profile
-- accepts one value when the column is NULL — but Athi asked for the SQL, and this leaves a migration record of
-- a change to an identity, which a form submission does not.
--
-- ⚠️ SET-ONCE IS ENFORCED HERE TOO, not just in the API. The WHERE clause requires user_id IS NULL, so running
-- this twice is a no-op rather than a silent overwrite of a live login. Athi, 2026-08-19: "the registered user
-- id cannot be changed. Are you able to change your Gmail id? The same way here."
--
-- ⚠️ AND IT REFUSES TO COLLIDE. The NOT EXISTS guard means that if someone else has already taken 'mypharma'
-- this updates zero rows and says so, rather than failing on the unique index with a message nobody can act on.
--
-- identities is WITHOUT ROW LEVEL SECURITY — the deliberate b54 carve-out for cross-tenant discovery.

BEGIN;

-- Before: show what is actually there, so the result is judged against fact rather than assumption.
SELECT 'BEFORE' AS stage, identity_id, bridge_id, display_name, user_id, identity_type, status
FROM identities
WHERE display_name = 'mypharma' OR bridge_id = 'CBZQK5DAH9';

UPDATE identities
   SET user_id = 'mypharma'
 WHERE bridge_id = 'CBZQK5DAH9'
   AND identity_type = 'entity'
   AND user_id IS NULL                                    -- set-once: never overwrite a live login
   AND NOT EXISTS (                                       -- and never collide with someone else's handle
         SELECT 1 FROM identities i2
          WHERE LOWER(i2.user_id) = 'mypharma'
       );

-- After: 1 row with user_id = mypharma means it worked. 0 rows changed means it was already set, or taken.
SELECT 'AFTER' AS stage, identity_id, bridge_id, display_name, user_id, identity_type, status
FROM identities
WHERE bridge_id = 'CBZQK5DAH9';

COMMIT;
