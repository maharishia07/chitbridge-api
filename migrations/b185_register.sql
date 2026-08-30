-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b185 — THE REGISTER AS A CAPABILITY. Attaches to anything · owner · severity · disposition · acceptance · EDGE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-30: *"can you go autonomously and build all as per sequence … what I am looking at is a proper
-- closure, so we have an audit of what happened"* and, correcting the first draft of this file:
-- **"it is a capability, not per entity and it should be attached anywhere."**
--
-- Design: C:\dev\DESIGN-raida-and-cover.md §10 · https://claude.ai/code/artifact/90f36dd6-7b3c-4e9c-bc8f-43bf3f741fd0
-- Builds design steps 2–5. Step 1 (the closure gate) is a RULE and lives in code, not here.
--
-- ⚠️ EVERYTHING IS ADDITIVE. A rename, new tables, new nullable columns, one NOT NULL dropped. b182's rows keep
-- working untouched and are backfilled into subjects.
--
-- ── ⭐⭐ "ATTACHED ANYWHERE" — AND WHY THAT IS NOT A POLYMORPHIC FREE-FOR-ALL ────────────────────────────────────
-- My first draft had `subject_type CHECK IN ('chit','campaign','release',…)` — a closed enum, which means a new
-- attachable kind costs a migration and the capability is only as general as whatever I imagined on the day.
--
-- ⚠️ BUT THE OPPOSITE IS THE MISTAKE THIS CODEBASE ALREADY REJECTED: "everything is an entity" was considered and
-- refused, and the standing rule is that LAYERS STAY TYPED. An untyped `attach to any row anywhere` column is
-- that mistake wearing a different hat.
--
-- ⭐ So: a REGISTRY, not an enum and not a free-for-all. `register_attachable` declares what a register may hang
-- off; adding a kind is an INSERT, not a migration; and every subject still names a declared type. Exactly the
-- pattern already used for blueprints (packs = data), policy flags and the standards list.
--
-- ── ⭐⭐ THE RENAME, AND WHY IT IS WORTH THE CHURN ───────────────────────────────────────────────────────────────
-- `chit_line_raida` stops being true the moment an entry hangs off a test campaign or a recertification audit. A
-- table whose name contradicts its contents misleads every future reader; RENAME is atomic and indexes,
-- constraints and the RLS policy follow it automatically.
--
-- ── ⭐⭐ THREE ROW SHAPES, ONE TABLE, STILL APPEND-ONLY ──────────────────────────────────────────────────────────
--   ENTRY     neither revises_id nor closes_id  — the thing itself
--   REVISION  revises_id set                    — a field changed; what was believed before stays readable
--   CLOSING   closes_id set                     — how it ended, with the disposition and the evidence
-- ⚠️ WITHOUT REVISIONS, ADDING FIELDS WOULD HAVE BROKEN THE ONE PROPERTY THIS TABLE HAS. An owner or a severity
-- UPDATEd in place destroys what was believed at the time. Same chain shape as chit_line_assignment.
--
-- ── ⭐⭐ ONE REGISTER, MANY STANDARDS — Athi's own diagnosis of the real problem ──────────────────────────────────
-- *"each company handles risk register per standard and they keep rewriting just to cover the audit."*
-- `register_entry_standard` maps ONE entry to the clauses of ANY number of standards, so ISO 9001 and ISO 27001
-- become two READINGS of one set of facts instead of two documents kept in step by hand. The audit view is a
-- byproduct, never a rewrite — the same argument as compliance-by-catalogue.
--
-- ⚠️ `entity_id` on every table here is TENANCY — the RLS isolation floor — and is not what "per entity" meant
-- above. The capability is general; the DATA is still one company's and nobody else's.
--
-- Safe to re-run.

-- ── 1 · the rename ──────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chit_line_raida')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='register_entry')
  THEN
    ALTER TABLE chit_line_raida RENAME TO register_entry;
    /* ⚠️ THE POLICY FOLLOWS THE TABLE BUT KEEPS ITS OLD NAME. RLS, indexes and constraints all survive a
       RENAME — the table stays protected throughout — but a policy called chit_line_raida_isolation sitting on
       register_entry is the kind of stale label somebody later reads as evidence the table was not renamed
       properly. Renamed too, so the catalogue says one thing. */
    ALTER POLICY chit_line_raida_isolation ON register_entry RENAME TO register_entry_isolation;
  END IF;
END $$;

-- ── ⭐⭐ 2 · WHAT A REGISTER MAY HANG OFF — a registry, so a new kind is data ────────────────────────────────────
CREATE TABLE IF NOT EXISTS register_attachable (
  type_key   text PRIMARY KEY,
  label      text NOT NULL,
  /* Where the id points, for a reader that wants to follow it. Documentation, not a constraint — the register
     must never take a hard dependency on a table it is only pointing at. */
  points_at  text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO register_attachable (type_key, label, points_at) VALUES
  ('chit',           'Order',              'chit_header.chit_id'),
  ('line',           'Line item',          'chit_line.line_id'),
  ('campaign',       'Test campaign',      NULL),
  ('release',        'Release',            NULL),
  ('article',        'Article / unit',     NULL),
  ('audit',          'Audit',              NULL),
  ('standard',       'Standard',           'the standards register key'),
  ('catalogue_item', 'Catalogue item',     'catalogue_items.item_id'),
  ('network_node',   'Network node',       'network_design node'),
  ('supplier',       'Supplier',           'identities.identity_id'),
  ('entity',         'The business',       'identities.identity_id'),
  ('other',          'Other',              NULL)
ON CONFLICT (type_key) DO NOTHING;
GRANT SELECT ON register_attachable TO cb_app;
/* ⚠️ NO RLS — this is a platform registry, the same class as `constitution` and `capability`: it is written by
   migrations, read by everyone, and holds no entity's data. */

-- ── 3 · the subject: a register attached to something ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS register_subject (
  subject_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,                 -- tenancy, not scope
  type_key      text NOT NULL DEFAULT 'chit' REFERENCES register_attachable(type_key),
  /* The id of the thing it is attached to. NULL is legitimate: a campaign or an audit may exist in its own
     right before it points at anything. */
  ref_id        uuid,
  ref_label     text,
  name          text NOT NULL,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  /* ⚠️ THE GATE GUARDS THIS. A subject may not close while any entry is undispositioned — enforced in
     lib/raida.js rather than here, because the refusal has to NAME which entries are outstanding. */
  closed_at     timestamptz,
  closed_by_actor_id uuid,
  closed_by_name     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS register_subject_entity ON register_subject (entity_id, type_key, opened_at);
/* One register per attached thing. Two registers on one order is two answers to one question. */
CREATE UNIQUE INDEX IF NOT EXISTS register_subject_ref
  ON register_subject (entity_id, type_key, ref_id) WHERE ref_id IS NOT NULL;

ALTER TABLE register_subject ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_subject FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS register_subject_isolation ON register_subject;
CREATE POLICY register_subject_isolation ON register_subject
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON register_subject TO cb_app;

-- ── 4 · the entry gains what a standard asks for ────────────────────────────────────────────────────────────────
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS subject_id uuid;

/* Who answers for it. Every standard names this first, and "the supplier" is not an answer. */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS owner_actor_id uuid;
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS owner_name     text;
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS due_date       date;
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS review_date    date;

/* 1–5 each. ⚠️ What each level MEANS is the entity's to declare — a 4 in a workshop and a 4 on a launch pad are
   not the same thing, and baking one interpretation in would be a vertical assumption on a general capability. */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS likelihood smallint CHECK (likelihood BETWEEN 1 AND 5);
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS severity   smallint CHECK (severity   BETWEEN 1 AND 5);
/* The rating AFTER treatment — what makes "residual" a number rather than a word. MIL-STD-882 and FMEA both
   require the post-mitigation figure beside the original; either alone says nothing. */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS residual_likelihood smallint CHECK (residual_likelihood BETWEEN 1 AND 5);
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS residual_severity   smallint CHECK (residual_severity   BETWEEN 1 AND 5);

/* The PLAN, which is not the description. ISO 31000 separates them, and so does anyone who has read a register
   full of risks and found no answer to "so what are we doing about it". */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS treatment text;
/* The finite set from ISO/IEC/IEEE 15288 — how this will be closed, decided when it is raised. */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS verification_method text
  CHECK (verification_method IN ('test','analysis','inspection','demonstration'));

-- ── ⭐⭐ 5 · THE EDGE — four columns on a dependency, not a new table ────────────────────────────────────────────
-- "Pack cannot start until the inspector has seen inside the crate" is not a note ABOUT an edge, it IS the edge —
-- missing only somewhere to point. A dependency that points can be walked, and the walk is the impact.
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS rel_type text
  CHECK (rel_type IN ('finish_to_start','start_to_start','finish_to_finish','start_to_finish'));
/* ⚠️ The SAME registry as a subject, so the graph's ends are typed by the same list the capability attaches by —
   a polymorphic EDGE, never a polymorphic OBJECT. */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS to_type text REFERENCES register_attachable(type_key);
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS to_id     uuid;
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS to_label  text;
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS needed_by date;

-- ── 6 · how it ended — these live on the CLOSING row ────────────────────────────────────────────────────────────
/* ⚠️ ON THE CLOSING ROW, NOT THE ENTRY. The entry says what was believed; the closing row says how it ended.
   Putting the disposition on the entry means UPDATEing it, which destroys the first fact to record the second. */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS disposition text
  CHECK (disposition IN ('resolved','action','carried_forward','accepted','constraint','waived'));
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS carried_to_subject_id uuid;
/* What proves it. A machine closing its own finding writes a run id and an artefact hash here. */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS evidence_ref  text;
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS evidence_hash text;

-- ── 7 · the third row shape: a revision ─────────────────────────────────────────────────────────────────────────
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS revises_id uuid REFERENCES register_entry(raida_id);

-- ── 8 · chit_id becomes optional ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE register_entry ALTER COLUMN chit_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS register_entry_subject ON register_entry (entity_id, subject_id, created_at);
CREATE INDEX IF NOT EXISTS register_entry_edge    ON register_entry (entity_id, to_type, to_id) WHERE to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS register_entry_owner   ON register_entry (entity_id, owner_actor_id)
  WHERE closes_id IS NULL AND revises_id IS NULL;

-- ── 9 · the acceptance, which is a signature and not a column ───────────────────────────────────────────────────
/* ⚠️ RESIDUAL RISK IS ACCEPTED BY A PERSON, AT A LEVEL ITS SEVERITY DEMANDS. MIL-STD-882 makes the signature
   level a function of the Risk Assessment Code. "Nobody answered it" and "the chief engineer accepted it on the
   14th" are different facts, and only the second is a closure anyone can audit. */
CREATE TABLE IF NOT EXISTS register_acceptance (
  acceptance_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL,
  entry_id        uuid NOT NULL,
  accepted_by_actor_id uuid,
  accepted_by_name     text NOT NULL,
  authority_level text,
  rationale       text,
  /* ⚠️ An accepted risk that is never revisited is a forgotten one — and it is the shape that kills, because
     nothing else will ever raise it again. */
  review_by       date,
  accepted_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS register_acceptance_entry ON register_acceptance (entity_id, entry_id);
CREATE INDEX IF NOT EXISTS register_acceptance_due   ON register_acceptance (entity_id, review_by) WHERE review_by IS NOT NULL;

ALTER TABLE register_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_acceptance FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS register_acceptance_isolation ON register_acceptance;
CREATE POLICY register_acceptance_isolation ON register_acceptance
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON register_acceptance TO cb_app;

-- ── ⭐⭐ 10 · ONE ENTRY, MANY STANDARDS — the rewriting problem ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS register_entry_standard (
  entity_id    uuid NOT NULL,
  entry_id     uuid NOT NULL,
  /* Matches the keys the readiness screen already uses: iso-9001 · iso-14001 · iso-27000 · iso-45001 · haccp … */
  standard_key text NOT NULL,
  /* '' rather than NULL so the key works — a mapping to a whole standard is as legitimate as one to a clause,
     and NULL in a key column is a different kind of trouble. */
  clause       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, entry_id, standard_key, clause)
);
CREATE INDEX IF NOT EXISTS register_entry_standard_std ON register_entry_standard (entity_id, standard_key);

ALTER TABLE register_entry_standard ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_entry_standard FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS register_entry_standard_isolation ON register_entry_standard;
CREATE POLICY register_entry_standard_isolation ON register_entry_standard
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON register_entry_standard TO cb_app;

-- ── 11 · backfill: every chit that already carries entries becomes a subject ────────────────────────────────────
/* ⚠️ NOT every chit — only those with entries. Minting a subject for every order ever sent would fill the table
   with rows nothing points at, and "a subject exists" would stop meaning anything. */
INSERT INTO register_subject (entity_id, type_key, name, ref_id, opened_at)
SELECT DISTINCT e.entity_id, 'chit',
       COALESCE(NULLIF(h.manual_subject,''), NULLIF(h.auto_subject,''), 'Order'),
       e.chit_id, now()
  FROM register_entry e
  LEFT JOIN LATERAL (
    SELECT manual_subject, auto_subject FROM chit_header
     WHERE entity_id = e.entity_id AND chit_id = e.chit_id LIMIT 1
  ) h ON true
 WHERE e.chit_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM register_subject s
      WHERE s.entity_id = e.entity_id AND s.type_key = 'chit' AND s.ref_id = e.chit_id);

UPDATE register_entry e
   SET subject_id = s.subject_id
  FROM register_subject s
 WHERE e.subject_id IS NULL AND e.chit_id IS NOT NULL
   AND s.entity_id = e.entity_id AND s.type_key = 'chit' AND s.ref_id = e.chit_id;

-- ── ⭐⭐ 12 · THE LIBRARY — the same risk turns up everywhere, worded slightly differently ────────────────────────
--
-- Athi, 2026-08-30: *"same risk pop up in many places and it may slightly vary, the context is the same."*
--
-- ⭐⭐ THIS IS THE CATALOGUE PATTERN, AND THE PRODUCT ALREADY RUNS IT. A catalogue item is the golden record; a
-- chit_line is one instance of it on one order, carrying `asked_as` when the wording differed. A register
-- template is the golden record of a KNOWN risk; an entry is one instance of it on one subject, carrying its own
-- body when the context varied. Nothing new to learn, and the same discipline: **snapshot, never join.**
--
-- ⚠️ THE MAPPING IS COPIED AT RAISE, NOT LOOKED UP. If an instance READ its standards through the template, then
-- editing the template would silently rewrite what an audit was told last year. Every other record here is
-- per-copy for exactly that reason; a compliance mapping is the last place to make an exception.
--
-- ⭐ AND THIS IS WHERE THE REGISTER STARTS TO LEARN. Once a risk is a template, "this one has been raised 40
-- times, closed 31, and the residual usually lands at 2×3" is a plain query — the outside view, arriving free.
-- A register that cannot say that is a filing cabinet.

CREATE TABLE IF NOT EXISTS register_template (
  template_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,                 -- a library is a company's own; tenancy, as everywhere
  kind         text NOT NULL
               CHECK (kind IN ('risk','assumption','issue','dependency','action','decision')),
  /* Short and reusable — "Supplier may miss the shipment window". The wording that varies goes on the instance. */
  title        text NOT NULL,
  body         text,                          -- the default wording, copied into an instance and then editable
  likelihood   smallint CHECK (likelihood BETWEEN 1 AND 5),
  severity     smallint CHECK (severity   BETWEEN 1 AND 5),
  treatment    text,
  verification_method text
               CHECK (verification_method IN ('test','analysis','inspection','demonstration')),
  /* Which kinds of subject it usually applies to — a hint for the raise screen, never a restriction. */
  applies_to   text[],
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS register_template_entity ON register_template (entity_id, kind) WHERE active;

ALTER TABLE register_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_template FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS register_template_isolation ON register_template;
CREATE POLICY register_template_isolation ON register_template
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON register_template TO cb_app;

/* The standards a KNOWN risk answers to, authored once. Copied onto every instance at raise. */
CREATE TABLE IF NOT EXISTS register_template_standard (
  entity_id    uuid NOT NULL,
  template_id  uuid NOT NULL,
  standard_key text NOT NULL,
  clause       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, template_id, standard_key, clause)
);
ALTER TABLE register_template_standard ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_template_standard FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS register_template_standard_isolation ON register_template_standard;
CREATE POLICY register_template_standard_isolation ON register_template_standard
  USING       (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK  (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON register_template_standard TO cb_app;

/* Which library entry this instance came from. NULL is normal — a one-off finding needs no template, and
   forcing one would turn every unexpected thing into a taxonomy exercise at the worst moment. */
ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS template_id uuid;
CREATE INDEX IF NOT EXISTS register_entry_template ON register_entry (entity_id, template_id)
  WHERE template_id IS NOT NULL;

-- ⚠️ ONE RESULT SET, no RAISE NOTICE — this is run by hand in the Supabase SQL editor.
SELECT 'b185 applied' AS status,
       (SELECT count(*) FROM register_entry)                              AS entries,
       (SELECT count(*) FROM register_entry WHERE subject_id IS NOT NULL) AS entries_with_subject,
       (SELECT count(*) FROM register_subject)                            AS subjects,
       (SELECT count(*) FROM register_attachable WHERE active)            AS attachable_kinds,
       (SELECT count(*) FROM register_template WHERE active)               AS library_entries,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='register_entry')     AS entry_columns,
       (SELECT count(*) FROM pg_policies
         WHERE tablename IN ('register_entry','register_subject','register_acceptance',
                             'register_entry_standard','register_template','register_template_standard')) AS policies;
