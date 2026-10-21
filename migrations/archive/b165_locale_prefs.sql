-- b165 · locale_prefs — make the reader's localisation choice belong to the PERSON, not to the browser.
--
-- ⚠️ THE DEFECT THIS CLOSES. Every localisation preference built on 2026-08-18 — language, number format,
-- numbering system, hour cycle, calendar, first day of week — lives in localStorage. localStorage is keyed by
-- BROWSER PROFILE, not by user. So today:
--
--   · the same person on their phone and their laptop sees two different products;
--   · clearing site data silently reverts an Arabic reader to English, left-to-right, Western digits;
--   · two people sharing a machine overwrite each other's choices;
--   · a new device starts every reader back at the en-IN default.
--
-- For a reader whose language is not the default, that is not a lost preference — it is the product becoming
-- unreadable on a device they have not yet visited. Localisation that does not follow the person is decoration.
--
-- ⚠️ WHY A COLUMN ON identities AND NOT A NEW TABLE. This is one small object per identity, read on every boot
-- alongside the row `/me` already fetches, and never queried across identities. A side table would add a join to
-- the hottest read on the platform to store data that has no independent life. When it needs history or
-- per-device variants it earns its own table; today it does not.
--
-- ⚠️ PER PERSON, NOT PER ENTITY — and on this table that distinction is real. An actor (a co-assist) has their
-- OWN identities row with parent_entity_id set, and `auth` puts that actor's own identity_id on the request. So
-- writing WHERE identity_id = <caller> stores the CLERK's choice, not their employer's. A Tamil-reading clerk at
-- an English-reading firm keeps Tamil. Had this hung off the entity, staff would inherit the owner's language —
-- which is precisely the failure this migration exists to prevent.
--
-- ⚠️ RLS: identities is WITHOUT ROW LEVEL SECURITY — the deliberate b54 carve-out, because cross-tenant
-- discovery (recipient search, messaging, the storefront) must read identity rows belonging to other tenants.
-- Scoping here is therefore APP-LAYER and unconditional: the PATCH writes `WHERE identity_id = $caller` with the
-- id taken from the verified token and never from the body, so a caller can only ever write their own row. That
-- is the same contract every other write to this table already honours (b54's stated model), not a new exception.
--
-- ⚠️ THE CHECK IS THE POINT OF USING jsonb AT ALL. These values are fed to Intl constructors and composed into a
-- BCP 47 -u- extension. A scalar or array stored here would break every read path that expects `prefs.nu`, so the
-- shape is enforced by the database rather than trusted from the API. The API validates the VALUES (each one is
-- smoke-tested through Intl before it is stored); the column guarantees the CONTAINER.
--
-- Additive and reversible. Default '{}' means every existing identity keeps exactly today's behaviour: an empty
-- object resolves to the same en-IN fallback the layer already uses, so nothing changes for anyone until they
-- choose something.

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS locale_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identities_locale_prefs_is_object') THEN
    ALTER TABLE identities
      ADD CONSTRAINT identities_locale_prefs_is_object
      CHECK (jsonb_typeof(locale_prefs) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN identities.locale_prefs IS
  'Per-PERSON localisation choice (b165). Keys: lang, locale, nu, hc, ca, fw — the BCP 47 subtags of UTS #35. '
  'Written only by PATCH /api/entities/me/locale, always WHERE identity_id = the authenticated caller. '
  'Empty object = follow the platform default (en-IN), which is what every row starts as.';
