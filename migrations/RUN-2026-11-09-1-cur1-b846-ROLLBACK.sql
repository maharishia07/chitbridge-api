-- RUN-2026-11-09-1-cur1-b846-ROLLBACK.sql — undoes b846 and b847 (CUR-1 slice 3). Athi runs it by hand AS postgres; the chain skips RUN-* files.
-- Safe because nothing reads chit_header.currency_code / currency_source before slice 4. Rows the api wrote itself (source 'stated' or 'setup') exist only after slice 4.
-- DESTRUCTIVE: approved athi 2026-11-08 (CUR-1 questions answered, ATHI-DECISIONS 8 Nov: rollback file per migration file)
SET lock_timeout = '5s';   -- the DROP COLUMNs take ACCESS EXCLUSIVE: fail fast, nothing changed, run again
-- Only the backfill's own work first (b847 alone is undone by the first two statements; the rest undoes b846):
UPDATE chit_header SET currency_code = NULL, currency_source = NULL WHERE currency_source LIKE 'backfill\_%';
DELETE FROM chit_currency_review WHERE resolved_at IS NULL;
-- b846:
DROP TABLE IF EXISTS chit_currency_violation;
DROP TABLE IF EXISTS chit_currency_review;
ALTER TABLE chit_header DROP CONSTRAINT IF EXISTS chit_header_currency_source_chk;
ALTER TABLE chit_header DROP CONSTRAINT IF EXISTS chit_header_currency_shape;
ALTER TABLE chit_header DROP COLUMN IF EXISTS currency_source;
ALTER TABLE chit_header DROP COLUMN IF EXISTS currency_code;
