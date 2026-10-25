-- b795_customer_list_added_via_invite.sql — NET-40 (25 Oct 2026): a customer made by ACCEPTING an invitation is stamped customer_list.added_via = 'invite'.
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP CONSTRAINT IF EXISTS, then ADD). Touches no rows.
--    The SIT kit's migrate job runs it on the SIT VMs.
-- OWNER: lib/customer-invite.js (the accept hook)
--
-- WHY. customer_list_added_via_check lists transaction · manual · import · catalogue · system · lead (baseline :3261). The invitation hook writes 'invite'. No new table, no new column.
-- Until this has run the hook writes 'manual' instead (one savepoint, then the fallback insert): the customer exists either way, only the "how they came" word differs.
-- RLS: unchanged (customer_list is owner-scoped; this touches a constraint only).

BEGIN;

ALTER TABLE customer_list DROP CONSTRAINT IF EXISTS customer_list_added_via_check;
ALTER TABLE customer_list ADD CONSTRAINT customer_list_added_via_check
  CHECK (added_via::text = ANY (ARRAY['transaction', 'manual', 'import', 'catalogue', 'system', 'lead', 'invite']));

COMMIT;
