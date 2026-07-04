-- migration_b56_dispute_schema.sql — ensure the per-party dispute schema the code needs actually EXISTS.
--
-- WHY (2026-07-05): routes/chits.js writes to `dispute_participants` and to `chit_messages.is_dispute` /
-- `.dispute_id`, but NO prior migration creates them (they were added ad-hoc during the dispute build). The
-- dispute backend was stale in prod the whole session and only went live tonight (c9e1951), so this schema may
-- never have been applied. This migration creates anything missing — idempotently and SELF-ADAPTING: it matches
-- `chit_disputes.dispute_id`'s real type so FKs/joins line up whatever it is. If everything already exists this
-- is a NO-OP. Run as postgres (owner). Safe to run before dispute testing.
DO $$
DECLARE did_type text; cid_type text; eid_type text;
BEGIN
  -- chit_disputes already exists (b54 disables RLS on it). Discover real types to match.
  SELECT format_type(a.atttypid, a.atttypmod) INTO did_type
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relname='chit_disputes' AND a.attname='dispute_id' AND a.attnum>0 AND NOT a.attisdropped;
  IF did_type IS NULL THEN
    RAISE EXCEPTION 'chit_disputes.dispute_id not found — dispute base schema missing; stopping (need the base dispute tables first).';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO cid_type
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relname='chit_messages' AND a.attname='chit_id' AND a.attnum>0 AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO eid_type
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relname='chit_messages' AND a.attname='sender_entity_id' AND a.attnum>0 AND NOT a.attisdropped;
  cid_type := COALESCE(cid_type, 'uuid');
  eid_type := COALESCE(eid_type, 'uuid');

  -- 1) dispute_participants — per-party roster + status. App-layer scoped (NOT RLS), like chit_disputes.
  IF to_regclass('public.dispute_participants') IS NULL THEN
    EXECUTE format($f$
      CREATE TABLE dispute_participants (
        id             bigserial PRIMARY KEY,
        dispute_id     %s NOT NULL,
        chit_id        %s NOT NULL,
        entity_id      %s NOT NULL,
        display_name   text,
        role           text NOT NULL CHECK (role IN ('raiser','party')),
        dispute_status text NOT NULL DEFAULT 'open',
        resolved_at    timestamptz,
        created_at     timestamptz NOT NULL DEFAULT NOW(),
        UNIQUE (dispute_id, entity_id)
      )$f$, did_type, cid_type, eid_type);
    CREATE INDEX IF NOT EXISTS dp_dispute_idx ON dispute_participants(dispute_id);
    CREATE INDEX IF NOT EXISTS dp_chit_idx    ON dispute_participants(chit_id);
    CREATE INDEX IF NOT EXISTS dp_entity_idx  ON dispute_participants(entity_id);
    ALTER TABLE dispute_participants DISABLE ROW LEVEL SECURITY;  -- explicit: app-layer scoped
    RAISE NOTICE 'created dispute_participants (%,%,%)', did_type, cid_type, eid_type;
  ELSE
    RAISE NOTICE 'dispute_participants already present — skipped';
  END IF;

  -- 2) chit_messages.is_dispute + dispute_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chit_messages' AND column_name='is_dispute') THEN
    ALTER TABLE chit_messages ADD COLUMN is_dispute boolean NOT NULL DEFAULT false;
    RAISE NOTICE 'added chit_messages.is_dispute';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chit_messages' AND column_name='dispute_id') THEN
    EXECUTE format('ALTER TABLE chit_messages ADD COLUMN dispute_id %s', did_type);
    RAISE NOTICE 'added chit_messages.dispute_id';
  END IF;
END $$;

-- 3) grants — the app runs as cb_app (NOSUPERUSER); a freshly-created table has no cb_app access.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON dispute_participants TO cb_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cb_app';
    RAISE NOTICE 'granted dispute_participants to cb_app';
  END IF;
END $$;

-- verify (expect: dispute_participants = a table oid, and 2 dispute columns on chit_messages)
SELECT to_regclass('public.dispute_participants') AS dispute_participants,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='chit_messages' AND column_name IN ('is_dispute','dispute_id')) AS chit_msg_dispute_cols;
