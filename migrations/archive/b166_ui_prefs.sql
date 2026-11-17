-- b166 · ui_prefs — the LOOK follows the person too, for the same reason the language does.
--
-- ⚠️ THE ARGUMENT IS THE ONE b165 ALREADY WON, applied to the other half of the same decision. Theme, text size
-- and motion live in localStorage, which is keyed by BROWSER PROFILE. So today someone who chose High Contrast
-- because they have low vision gets it on the shop tablet and not on their phone; someone who set Reduce Motion
-- because animation triggers migraine gets animation back the moment they open the app somewhere else.
--
-- For an ordinary preference that is an annoyance. For these it is not: the accessibility themes and the motion
-- setting exist because someone cannot comfortably use the product without them, and a setting that does not
-- travel is a setting they have to rediscover on every device — assuming they work out that it exists at all.
-- That is the same defect b165 closed for language, and it deserves the same answer rather than a smaller one.
--
-- ⚠️ A SECOND COLUMN, NOT A SECOND MECHANISM. The API route and the client pusher are GENERALISED in this same
-- change, not duplicated: one handler drives both columns off a whitelist map. Two near-identical prefs
-- endpoints would drift the first time one of them gained validation or an audit line, and the one nobody
-- remembered would be the one carrying somebody's accessibility setting.
--
-- ⚠️ AND NOT FOLDED INTO locale_prefs, which would have been the lazier way to avoid a migration. A theme is not
-- a locale. Putting them in one blob would mean the column's name stops describing its contents, and the next
-- person reading `locale_prefs` would have no reason to expect a motion setting inside it.
--
-- ⚠️ RLS: identities is WITHOUT ROW LEVEL SECURITY — the deliberate b54 carve-out, because cross-tenant
-- discovery (recipient search, messaging, the storefront) must read identity rows belonging to other tenants.
-- Scoping is APP-LAYER and unconditional, exactly as for b165: the PATCH writes WHERE identity_id = the id on
-- the verified token, never one taken from the body. There is no id parameter to get wrong.
--
-- ⚠️ PER PERSON, NOT PER ENTITY. An actor has their own identities row, so a co-assist with low vision keeps
-- High Contrast without imposing it on their employer — and, more to the point, without their employer's choice
-- overriding the one they need.
--
-- Additive and reversible. Default '{}' is exactly today's behaviour: nothing chosen, so nothing changes for
-- anyone until they choose something.

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identities_ui_prefs_is_object') THEN
    ALTER TABLE identities
      ADD CONSTRAINT identities_ui_prefs_is_object
      CHECK (jsonb_typeof(ui_prefs) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN identities.ui_prefs IS
  'Per-PERSON appearance choice (b166). Keys: theme, fs (text size), motion. '
  'Written only by PATCH /api/entities/me/prefs/ui, always WHERE identity_id = the authenticated caller. '
  'Empty object = follow the platform default, which is what every row starts as.';
