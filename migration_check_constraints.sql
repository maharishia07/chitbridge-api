-- migration_check_constraints.sql — enforce the two-copy direction invariant at the DB level.
-- NOT VALID = enforce on all NEW writes immediately, but never fail on existing rows.
-- Once existing data is confirmed clean, you can promote with:
--   ALTER TABLE chit_header VALIDATE CONSTRAINT chk_ch_direction;  (and the others)
DO $$ BEGIN ALTER TABLE chit_header ADD CONSTRAINT chk_ch_direction CHECK (direction IN ('sent','received')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chit_status ADD CONSTRAINT chk_cs_direction CHECK (direction IN ('sent','received')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chit_detail ADD CONSTRAINT chk_cd_direction CHECK (direction IN ('sent','received')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
