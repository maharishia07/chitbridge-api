-- b218 · A SUPPLIER WHO NEVER REGISTERED
-- ============================================================================================================
-- Athi, 2026-09-10, in three goes — and each correction took OUT something I had added:
--
--   1. *"Still a non-CB person can be a supplier — we can set the flag again, he is not part of CB?"*
--   2. *"Still we need the user id, so we can attach item and so on against that id. We create id internally,
--       so the existing mechanism will not break."*
--   3. *"Follow the existing path. Only thing is he is not a recipient — so you can't bring him to the rail.
--       Otherwise for all practical purposes he is a bridge user. If you want, mark the user id as some char
--       prefixed with the entity id and then some marker, so we can identify — like our customer and so on."*
--   4. *"Keep some naming convention... entity user id-sup-nnnn, whatever, so he is specific to the user."*
--
-- ⭐⭐⭐ THE CORNER HARDWARE SHOP IS JUST AN ENTITY. My first draft made `supplier_entity_id` nullable; my second
-- invented `identity_type = 'local'`. Both made him a special case, and a special case has to be handled in every
-- place that addresses a supplier by id — adoption, purchases, spend, every screen that shows a bridge id. Athi's
-- version needs none of that: same table, same identity_type, same joins, nothing downstream changes at all.
--
-- ⭐ WHAT MARKS HIM IS HIS HANDLE, and the grammar lives with the other three in lib/handle.js:
--
--     acmetraders              an ENTITY       registered, the root of everything below
--     ravi@acmetraders         an EMPLOYEE     @ binds a person to their business
--     acmetraders.clothing     a NETWORK node  . binds a store to the network it was born in
--     ~acmetraders.sup-0001    a MINTED party  ~ says created BY acmetraders, never registered
--
--   ~            minted. Cannot sign in, cannot be sent a chit.
--   acmetraders  whose — the minting entity's USER ID, so the record is *"specific to the user"*.
--   sup-0001     what and which. Per business, per kind, from 0001. An ORDINAL: 0002 removed is never reused.
--
-- ⚠️ THE LEADING `~` IS THE ONE THING ADDED TO HIS FORM, and it earns its place: `acmetraders-sup-0001` is a
-- perfectly legal handle a stranger could REGISTER, whereas `~` has always been illegal in a claimable handle
-- (check() demands every label start with a letter or digit). Unforgeable by construction, not by a new rule.
--
-- ── ⭐ SO THIS MIGRATION IS SMALL, AND THAT IS THE POINT ─────────────────────────────────────────────────────
-- Following the existing path means the existing UNIQUE INDEX on lower(user_id) already guarantees one
-- `~acmetraders.sup-0001` on the platform. Nothing here creates the identity, the id or the sequence. What is
-- left is the one guarantee the handle can no longer give, now that it is a number instead of a name:
--
--   ⭐⭐ THE SAME SHOP, TYPED TWICE, MUST BE ONE ROW. Recording a fourth purchase from "corner hardware" has to
--   land on the id the first three did. Two rows would split a spend figure nobody adds up, and — this is the
--   part that makes it worth a constraint rather than a check in code — NOTHING ON SCREEN WOULD LOOK WRONG.
--
-- ⚠️ AND IT MUST BE PER KIND. A trader a shop both buys from and sells to is ordinary; without the kind in the
-- index their supplier record and their customer record would collide.
--
-- ⭐ WITH RLS unchanged. `identities` is the platform directory and is not entity-scoped; minted rows are fenced
-- by `parent_entity_id` plus the `~` refusals in the recipient resolver, the business search and the add routes.
-- ⚠️ RUN IN THE SUPABASE SQL EDITOR (cb_app owns nothing and cannot CREATE INDEX). Step 1 only looks. Re-runnable.
-- ============================================================================================================

-- ── 1 · LOOK FIRST. Nothing has been minted yet, so both counts should be 0 on a first run.
SELECT (SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_identities_minted_sup')   AS already_done,
       (SELECT count(*) FROM identities WHERE user_id LIKE '~%')                        AS minted_rows_today,
       (SELECT count(*) FROM supplier_list)                                             AS supplier_rows_today;

-- ⚠️ AND LOOK FOR THE ONE THING THAT WOULD MAKE STEP 2 FAIL: a shop that already has two suppliers of the same
--    name. It cannot happen before the feature ships, but re-running this after months of use could find one, and
--    a failed CREATE UNIQUE INDEX with no explanation is a bad way to learn that. Expect no rows.
SELECT parent_entity_id, lower(btrim(display_name)) AS name, count(*) AS rows
FROM identities WHERE user_id LIKE '~%.sup-%'
GROUP BY 1, 2 HAVING count(*) > 1;

-- ── 2 · THE CHANGE. Two indexes. No new column, no new type, no new table.
BEGIN;

-- ⭐⭐ ONE SUPPLIER PER NAME PER SHOP, case- and space-folded exactly as lib/local-identity.fold() folds it — if
--    the two ever disagree, one of them is inert and the guarantee quietly stops existing.
--    ⚠️ Partial to `.sup-` so a customer of the same name is a different record, which it is.
CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_minted_sup
  ON identities (parent_entity_id, lower(btrim(display_name)))
  WHERE user_id LIKE '~%.sup-%';

-- the supplier list is read by owner and split by kind on every paint (Trade tab / Other tab)
CREATE INDEX IF NOT EXISTS ix_supplier_list_owner_kind
  ON supplier_list (owner_entity_id, supply_kind);

COMMIT;

-- ── 3 · PROVE IT.
SELECT indexname, indexdef FROM pg_indexes
WHERE indexname IN ('uq_identities_minted_sup', 'ix_supplier_list_owner_kind') ORDER BY indexname;

-- ⭐ THE PRIVACY CHECK, run against the REAL filter the business search uses. A minted party must never appear
--    there: who supplies you is one of the few genuinely competitive facts a small business holds. Expect 0 — and
--    expect it to STAY 0 as suppliers are added, which is what tests/local-supplier.test.js guards in code.
SELECT count(*) FILTER (WHERE identity_type = 'entity' AND status = 'active'
                          AND COALESCE(sealed, false) = false)  AS pass_the_search_filter,
       count(*) FILTER (WHERE parent_entity_id IS NULL)         AS orphaned_no_owner,
       count(*)                                                 AS minted_rows
FROM identities WHERE user_id LIKE '~%';
-- ⚠️ pass_the_search_filter WILL be non-zero, and that is correct — a minted party IS an active entity, which was
--    the whole design. The search excludes them by the `~` test in routes/entities.js, not by these columns.
--    What must be 0 is orphaned_no_owner: a minted row with no parent belongs to nobody and can never be found.

-- ── AFTERWARDS: Suppliers shows two tabs — Trade and Other. "Add a supplier" takes a ChitBridge User ID or email,
--    or just a name; a name mints ~<your user id>.sup-nnnn, so items, purchases and spend attach to it exactly as
--    they do for anyone else. The Supplies rail item is retired.
