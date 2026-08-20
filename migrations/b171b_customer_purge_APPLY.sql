-- b171b — APPLY. This DELETES. Run b171a_customer_purge_DRYRUN.sql first and read the numbers.
--
-- Athi, 2026-08-20: *"We can remove the old customer details, we are in testing phase, just drop them down."*
--
-- ⚠️⚠️ THIS DELETES EVERY CUSTOMER AND EVERYTHING ATTACHED TO THEM — orders, order lines, statuses, messages
-- and disputes. Not because that is desirable but because the foreign keys do not cascade: a customer cannot
-- be removed while a chit points at them. There is no version of this that keeps the orders.
--
-- ⚠️ IT DOES NOT TOUCH ENTITIES OR CO-ASSISTS. The WHERE clause is identity_type = 'customer' throughout, and
-- every dependent delete is scoped through that same set. A customer is the only kind of identity created
-- automatically by a storefront, which is what makes them safe to recreate — the humans are not.
--
-- ⚠️ WRAPPED IN A TRANSACTION AND IT ENDS WITH ROLLBACK, DELIBERATELY. Read the output, confirm the counts
-- match the dry run, then change the last line to COMMIT and run it again. A destructive migration that
-- commits on first run gives you nothing to reconsider.

BEGIN;

CREATE TEMP TABLE _cust ON COMMIT DROP AS
  SELECT identity_id FROM identities WHERE identity_type = 'customer';

\echo '=== deleting, children first ==='

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

\echo '=== after (should be 0 customers) ==='
SELECT count(*) AS customers_remaining FROM identities WHERE identity_type = 'customer';
SELECT count(*) AS entities_untouched  FROM identities WHERE identity_type = 'entity';
SELECT count(*) AS actors_untouched    FROM identities WHERE identity_type = 'actor';

-- ⚠️ CHANGE THIS TO COMMIT ONLY AFTER READING THE NUMBERS ABOVE.
ROLLBACK;
