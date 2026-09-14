-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b240 — cbincroot SELLS A SERVICE, NOT GOODS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"in the cbinc, if we can distinguish between goods, service, both, it will be good, pure
-- service is helpdesk, incident management, testlab etc"* — and then, plainly: *"so even cbincroot is a
-- service"*.
--
-- The Scope table on the Platform tab put every entity's rules on one line, and the very first operator row
-- read:
--
--     cbincroot   no · no* · no · yes · yes · things · internal
--                                        ^^^^^^
--
-- `supplies = 'goods'`. We run support, requirement gathering, the test lab and billing. We do not ship
-- things. The row was a leftover from before there was anything but 'goods' to be.
--
-- ── ⭐ WHY THIS MATTERS BEYOND ONE ROW ─────────────────────────────────────────────────────────────────────────
--
-- `supplies` is what the shopkeeper's own Settings → Your business writes, and it is the field the catalogue
-- reads to decide whether a price list is even the right question. CBINC is tenant #1 and runs on the same
-- rail as every other shop — so the tenant that models the platform has to be modelled correctly, or the
-- first thing anybody checks the framework against is wrong.
--
-- ⭐ THE EIGHT STANDARDS STAY 'none'. ISO 9001, UCP 600, Incoterms and the rest are references, not vendors:
-- nothing is bought from them and nothing is booked with them. 'none' is already right and is left alone.
--
-- ⚠️ ONE ROW, NAMED BY user_id. Not `WHERE entity_kind = 'internal'` — that would sweep the eight standards
-- into 'services' as well and quietly assert that a standard can be engaged. The set here is exactly one.

BEGIN;

-- ⭐ say what it was, before changing it — a migration that reports nothing cannot be checked afterwards
SELECT user_id, display_name, entity_kind, supplies AS supplies_before
  FROM identities
 WHERE user_id = 'cbincroot';

UPDATE identities
   SET supplies = 'services'
 WHERE user_id = 'cbincroot'
   AND supplies IS DISTINCT FROM 'services';

-- ── the proof ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Expect exactly: cbincroot / internal / services, and the eight standards still 'none'.
SELECT COALESCE(user_id, display_name) AS who, entity_kind, supplies
  FROM identities
 WHERE entity_kind = 'internal'
 ORDER BY (user_id IS NULL), who;

COMMIT;
