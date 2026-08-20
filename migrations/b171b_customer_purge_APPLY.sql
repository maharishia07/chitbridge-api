-- b171b — APPLY. This DELETES. Run b171a_customer_purge_DRYRUN.sql first and read the numbers.
--
-- Athi, 2026-08-20: *"We can remove the old customer details, we are in testing phase, just drop them down."*
--
-- ⚠️⚠️ THIS DELETES EVERY CUSTOMER AND EVERYTHING ATTACHED TO THEM — orders, order lines, statuses, messages
-- and disputes. Not because that is desirable but because the foreign keys do not cascade: a customer cannot
-- be removed while a chit points at them. There is no version of this that keeps the orders.
--
-- ⚠️ IT DOES NOT TOUCH ENTITIES OR CO-ASSISTS. Every delete is scoped through identity_type = 'customer'.
-- A customer is the only kind of identity a storefront creates automatically, which is what makes them safe
-- to recreate. The humans are not.
--
-- ⚠️ NO psql META-COMMANDS — \echo failed in the Supabase SQL editor, which speaks SQL and not psql.
--
-- ⚠️⚠️ IT ENDS IN ROLLBACK, DELIBERATELY. Run it, read the counts, confirm they match the dry run, then
-- change the last line to COMMIT and run it again. A destructive migration that commits on its first run
-- gives you nothing to reconsider.

BEGIN;

CREATE TEMP TABLE _cust ON COMMIT DROP AS
  SELECT identity_id FROM identities WHERE identity_type = 'customer';

-- children first, or the foreign keys refuse
DELETE FROM chit_messages WHERE sender_entity_id     IN (SELECT identity_id FROM _cust)
                             OR visibility_entity_id IN (SELECT identity_id FROM _cust);
DELETE FROM chit_disputes WHERE raised_by_entity_id   IN (SELECT identity_id FROM _cust)
                             OR resolved_by_entity_id IN (SELECT identity_id FROM _cust)
                             OR target_entity_id      IN (SELECT identity_id FROM _cust);
DELETE FROM chit_status   WHERE entity_id IN (SELECT identity_id FROM _cust);
DELETE FROM chit_detail   WHERE entity_id IN (SELECT identity_id FROM _cust);
DELETE FROM chit_header   WHERE entity_id IN (SELECT identity_id FROM _cust);
DELETE FROM customer_list WHERE customer_identity_id IN (SELECT identity_id FROM _cust);

DELETE FROM identities WHERE identity_type = 'customer';

-- Read these three before deciding. customers_remaining must be 0; the other two must be UNCHANGED.
SELECT 'after' AS stage,
       (SELECT count(*) FROM identities WHERE identity_type = 'customer') AS customers_remaining,
       (SELECT count(*) FROM identities WHERE identity_type = 'entity')   AS entities_untouched,
       (SELECT count(*) FROM identities WHERE identity_type = 'actor')    AS actors_untouched;

-- ⚠️ CHANGE THIS TO COMMIT ONLY AFTER READING THE NUMBERS ABOVE.
ROLLBACK;
