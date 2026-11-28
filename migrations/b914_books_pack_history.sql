-- b914_books_pack_history.sql — a shop's rules are read under the VERSION in force on the day (pack pinning, batch 1138; every country).
--
-- ⚠️ NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (IF NOT EXISTS; the backfill touches only shops with no version stamp).
-- RUN ORDER  this file BEFORE the api that adopts engines pack AU 1.0.1 is deployed: that api reads a shop with no stamp as "the latest rules".
-- WHY  until now books_setting.pack_version was written but never read: every shop read the latest pack of its country, so adopting a new pack version would silently re-read every closed
--      and lodged period under it. lib/books-pack-pin.js now reads a day under the version in force on it: the dated history below, else the stamp, else the latest.
-- WHAT 1) books_setting.pack_history jsonb: dated rows [{ from, version, by, at }], appended only by the restamp (POST /setting { pack_version, pack_from }); each restamp also writes
--         one books_change_log row (insert-only), so the audit survives. Nothing here is edited by hand.
--      2) backfill: an Australian shop with no semver stamp is stamped 1.0.0 — the only AU rules there were until 1.0.1, so everything it posted, closed or lodged was made under them.
--         India (1.1.0 already reads as the latest, by design) and the UAE (one version) are left as they are: no stamp = the latest = what they read today.
-- RLS  unchanged: books_setting keeps its policy; no table is added.
-- ROLL BACK: ALTER TABLE books_setting DROP COLUMN IF EXISTS pack_history;   (the stamp backfill: UPDATE books_setting SET pack_version = NULL WHERE country = 'AU' AND pack_version = '1.0.0'; only before any restamp)
-- CHECK (read-only): SELECT count(*) FILTER (WHERE country = 'AU' AND pack_version IS NULL) AS au_unstamped FROM books_setting;   (0)
ALTER TABLE books_setting ADD COLUMN IF NOT EXISTS pack_history jsonb;
UPDATE books_setting SET pack_version = '1.0.0'
 WHERE country = 'AU' AND (pack_version IS NULL OR pack_version !~ '^\d+\.\d+\.\d+$');
