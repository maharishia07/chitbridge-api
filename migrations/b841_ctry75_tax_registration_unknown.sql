-- b841_ctry75_tax_registration_unknown.sql — CTRY-75 (8 Nov 2026): the "not registered" that migration b299 ASSUMED goes back to unknown (SQL NULL).
--
-- ⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Athi decided option (c) on 7-8 Nov 2026.
--
-- WHY. b299 backfilled entity_governance.tax_registration = {"number": null, "scheme": null, "registered": false} for every shop with no GSTIN, and wrote
--    setup_source = {"tax": "backfill b299 (identities.gstn)", "country": "backfill b299 (today's facts)", ...}. Nobody told us those shops are not
--    registered: it is an assumed fact (rule R13, never default an unasked fact), and lib/country-setup.registrationOf reads it as "unregistered", so such a
--    shop bills at rate 0 and the counter never asks. NULL reads "unknown": routes/till.js answers 409 TAX_REGISTRATION_UNKNOWN with the question, and
--    lib/books-hooks.registrationWait parks a taxed sale with the words instead of posting it at rate 0.
--
-- WHICH ROWS (all four must hold, so an owner's own answer can never match):
--    1. setup_source->>'tax'     LIKE 'backfill b299%'   b299's own marker on the tax answer.
--    2. setup_source->>'country' LIKE 'backfill b299%'   ⚠️ the owner has NEVER saved Country setup. The web echoes the stored source back on save, so the
--                                                        'tax' marker above SURVIVES an owner's explicit "no"; but save() always flips a backfill country to
--                                                        'confirmed by the owner' (lib/country-setup.confirmedSource), so this line is what proves "untouched".
--    3. tax_registration->>'registered' = 'false'        (jsonb false, compared as text).
--    4. no number: tax_registration->>'number' is null or empty.
--    An owner's explicit "no" fails line 2 (and carries setup_source.tax = 'typed' or similar). NULL rows and registered:true rows fail line 3.
--
-- DRY RUN FIRST (read-only; paste the count and the ids back; the 21 Oct dump had 6):
--    SELECT count(*) AS to_reset, (array_agg(entity_id ORDER BY entity_id))[1:5] AS sample_ids
--      FROM entity_governance
--     WHERE setup_source->>'tax' LIKE 'backfill b299%' AND setup_source->>'country' LIKE 'backfill b299%'
--       AND tax_registration->>'registered' = 'false' AND COALESCE(tax_registration->>'number', '') = '';
--    And, to see nothing of an owner's is caught, the same WHERE without line 2 minus the one with it is the count of owner-confirmed rows left alone:
--    SELECT count(*) AS owner_confirmed_no_left_alone FROM entity_governance
--     WHERE setup_source->>'tax' LIKE 'backfill b299%' AND setup_source->>'country' NOT LIKE 'backfill b299%'
--       AND tax_registration->>'registered' = 'false' AND COALESCE(tax_registration->>'number', '') = '';
--
-- WHAT THE APP DOES AFTER IT. Nothing to deploy: the unknown state is already handled. registrationOf answers 'unknown' for a NULL stamp with no tax
--    number; the counter's taxed bill answers 409 TAX_REGISTRATION_UNKNOWN ("Is this business registered for GST? Answer it in Settings → Country setup.",
--    routes/till.js); books-hooks.registrationWait queues the sale instead of posting it at rate 0; Country setup shows the tax row as "not set yet" with
--    no default answer (web cap-country.js). The owner answers ONCE (yes with the number, or an explicit no) and that save is the owner's, never reset again.
--    A shop that has a GSTIN on identities still reads registered whatever this stamp says.
--    ⚠️ Tell the affected owners the step will ask once (Athi's hands).
--
-- SAFE TO RE-RUN: the UPDATE sets tax_registration to NULL, which fails line 3, so the second run finds nothing. It also drops the 'tax' marker.
--
-- ROLL BACK (exact, only for rows this file reset and the owner has not touched since: country still backfill, no 'tax' source, stamp NULL):
--    UPDATE entity_governance
--       SET tax_registration = '{"number": null, "scheme": null, "registered": false}'::jsonb,
--           setup_source = setup_source || '{"tax": "backfill b299 (identities.gstn)"}'::jsonb
--     WHERE tax_registration IS NULL AND setup_source->>'country' LIKE 'backfill b299%' AND NOT (setup_source ? 'tax');
--
-- RLS: entity_governance is FORCE RLS; this runs as postgres in the SQL editor, which bypasses it, so every shop's row is seen. No table, column or
--    policy is created or changed.

BEGIN;

UPDATE entity_governance
   SET tax_registration = NULL,
       setup_source = setup_source - 'tax'
 WHERE setup_source->>'tax' LIKE 'backfill b299%'
   AND setup_source->>'country' LIKE 'backfill b299%'
   AND tax_registration->>'registered' = 'false'
   AND COALESCE(tax_registration->>'number', '') = '';

COMMIT;
