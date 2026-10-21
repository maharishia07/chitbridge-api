-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b142 — A LINE BECOMES A ROW. The unit of work stops being the chit.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-12: *"for each line item if we can assign to an assist, a date, and maybe few others it will start
-- behaving like a division of labour — so multiple people, devices or anything can work at the same time."*
--
-- ── ⚠️ WHY A TABLE AND NOT A FIELD IN THE BLOB ──────────────────────────────────────────────────────────────────
-- Until now a line's only identity was its ARRAY INDEX inside `chit_detail.line_items`. Assignment, a due date and
-- a delivery all attach to a LINE, so with index-identity the first insert or reorder silently re-points every one
-- of them at a different product — on a chit that looks perfectly normal. Nothing would flag it, ever.
-- You cannot put a foreign key on a position in an array.
--
-- ── ⚠️ line_id IS THE SAME ACROSS COPIES, AND THAT IS THE POINT ─────────────────────────────────────────────────
-- Per-line ASSIGNMENT is private (Kumar never learns that Murugan has the onions). Per-line DELIVERY is shared —
-- it is the record. For the shared half to work, both parties' copies must agree on what "line 3" IS. So the row
-- is keyed by a surrogate and line_id is UNIQUE PER COPY, not globally: the same line_id appears once in my copy
-- and once in theirs, which is exactly what lets a co-held delivery event name a line both of us can see.
--
-- ── ⚠️ THE THREE REPRESENTATIONS, AND WHY EACH EXISTS ───────────────────────────────────────────────────────────
--   capture.raw_text + capture.structured  what they wrote, and what the reader first made of it — evidence
--   chit_detail.line_items                 what was DELIVERED — the frozen co-held payload, never edited
--   chit_line                              the LIVE line — amendable, assignable, deliverable
-- The first two already existed and are untouched. This adds the third. `chit_line` is stored rather than derived
-- because you cannot foreign-key to a computed value, and assignment/delivery must point at something real.
-- ONE writer keeps them honest: lib/amend.record() updates chit_line and appends the audit row in one transaction.
--
-- ── ⚠️ NO WIPE. Athi offered one; it is not needed. ─────────────────────────────────────────────────────────────
-- Existing lines are backfilled with a line_id derived DETERMINISTICALLY from (chit_id, position), so both copies
-- of an old chit independently compute the SAME id and stay co-held. A random uuid per copy would have silently
-- split every existing chit into two documents that no longer agree on what a line is.
--
-- Safe to re-run.

-- ── 1 · the table ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chit_line (
  row_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id       uuid NOT NULL,
  entity_id     uuid NOT NULL,
  -- Shared across copies. See the note above: this is what makes a co-held per-line delivery possible.
  line_id       uuid NOT NULL,
  -- ⚠️ EXPLICIT ORDER. "The one you selected comes as the last record" is what array order looks like when nothing
  -- declares the order. Gapped by 10 at mint so a line can be inserted between two others without renumbering.
  seq           integer NOT NULL DEFAULT 0,

  particulars   text,
  quantity      numeric(18,3),
  unit          text,
  unit_size     text,
  price         numeric(18,2),
  comment       text,

  -- What the sender ACTUALLY wrote, when the catalogue renamed it or overrode the unit. Evidence, not decoration:
  -- "we sent Tomato, they say they ordered thakkali" has to be settleable from the record.
  asked_as      text,
  asked_unit    text,
  raw_phrase    text,                       -- b141 fills this; the words that produced this line

  -- ⚠️ REMOVAL IS A STATE, NOT A DELETE. Athi: "old line deleted and new line is nothing." A removed line stays
  -- VISIBLE as evidence that it was asked for, and counts in NOTHING. That is not quantity 0, which is a real
  -- number saying "zero crates" and would leak into totals.
  removed       boolean NOT NULL DEFAULT false,
  removed_reason text,

  -- Flags the reader raised and a human still has to settle.
  needs_human   boolean NOT NULL DEFAULT false,
  flags         jsonb,                      -- qty_unverified, variant_unspecified, matched_by_spelling …

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One row per line per COPY. Makes co-holding structural instead of a convention.
  UNIQUE (entity_id, chit_id, line_id)
);

CREATE INDEX IF NOT EXISTS chit_line_chit  ON chit_line (entity_id, chit_id, seq);
CREATE INDEX IF NOT EXISTS chit_line_live  ON chit_line (entity_id, removed) WHERE removed = false;

ALTER TABLE chit_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_line FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chit_line_isolation ON chit_line;
CREATE POLICY chit_line_isolation ON chit_line
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON chit_line TO cb_app;

-- ── 2 · amendments re-key from array index to line_id ───────────────────────────────────────────────────────────
-- ⚠️ line_index STAYS, deliberately. It is how every pre-b142 amendment is addressed, and dropping it would strand
-- them. New rows carry line_id; the reader prefers line_id and falls back to line_index.
ALTER TABLE chit_line_amendment ADD COLUMN IF NOT EXISTS line_id uuid;
CREATE INDEX IF NOT EXISTS chit_line_amendment_lineid ON chit_line_amendment (entity_id, chit_id, line_id, seq);

-- ── 3 · backfill, deterministically ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ THE ID IS DERIVED FROM (chit_id, position), NOT RANDOM. Both copies of an old chit run this independently and
-- must arrive at the SAME line_id, or the chit quietly becomes two documents that disagree about what a line is.
CREATE OR REPLACE FUNCTION cb_line_id(p_chit uuid, p_pos int) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(p_chit::text || ':line:' || p_pos::text)::uuid;
$$;

INSERT INTO chit_line (chit_id, entity_id, line_id, seq, particulars, quantity, unit, unit_size, price, comment,
                       asked_as, asked_unit, needs_human, flags)
SELECT d.chit_id, d.entity_id,
       COALESCE(NULLIF(li.value->>'line_id','')::uuid, cb_line_id(d.chit_id, li.ord::int)),
       COALESCE((li.value->>'seq')::int, li.ord::int * 10),
       li.value->>'particulars',
       NULLIF(li.value->>'quantity','')::numeric,
       NULLIF(li.value->>'unit',''),
       NULLIF(li.value->>'unit_size',''),
       NULLIF(li.value->>'price','')::numeric,
       NULLIF(li.value->>'comment',''),
       NULLIF(li.value->>'asked_as',''),
       NULLIF(li.value->>'asked_unit',''),
       COALESCE((li.value->>'needs_human')::boolean, false),
       CASE WHEN li.value ? 'qty_unverified' OR li.value ? 'variant_unspecified'
            THEN jsonb_strip_nulls(jsonb_build_object(
                   'qty_unverified', li.value->'qty_unverified',
                   'variant_unspecified', li.value->'variant_unspecified'))
            ELSE NULL END
  FROM chit_detail d
  CROSS JOIN LATERAL jsonb_array_elements(d.line_items) WITH ORDINALITY AS li(value, ord)
 WHERE jsonb_typeof(d.line_items) = 'array'
ON CONFLICT (entity_id, chit_id, line_id) DO NOTHING;

-- Point existing amendments at the backfilled ids (they were addressed by 0-based array index).
UPDATE chit_line_amendment a
   SET line_id = cb_line_id(a.chit_id, a.line_index + 1)
 WHERE a.line_id IS NULL;

-- ── 4 · deliver writes the lines ────────────────────────────────────────────────────────────────────────────────
-- ⚠️ ENGINE CHANGE, ADDITIVE ONLY. The isolation gate at the top ("a tenant may only deliver chits it sends") and
-- every existing INSERT are untouched; this adds one more INSERT inside the SAME loop, so each copy gets its own
-- RLS-scoped rows in the same transaction that creates the copy. Nothing is relaxed.
CREATE OR REPLACE FUNCTION chit_deliver(p_chit_id uuid, p_clear_first boolean, p_copies jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  c jsonb;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'chit_deliver: no entity context (app.current_entity unset) — call inside withEntity(sender)';
  END IF;

  FOR c IN SELECT value FROM jsonb_array_elements(p_copies) AS value LOOP
    IF (c->>'sender_entity_id')::uuid IS DISTINCT FROM v_sender THEN
      RAISE EXCEPTION 'chit_deliver: copy sender % <> caller % (a tenant can only deliver chits it sends)',
        c->>'sender_entity_id', v_sender;
    END IF;
  END LOOP;

  IF p_clear_first THEN
    DELETE FROM state_log   WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_line   WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_detail WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_status WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_sender;
  END IF;

  FOR c IN SELECT value FROM jsonb_array_elements(p_copies) AS value LOOP
    INSERT INTO chit_header
      (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
       all_recipients, purpose, auto_subject, manual_subject, summary_json, business_json,
       schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, v_sender, c->>'sender_entity_bridge_id', c->>'sender_entity_display_name',
       COALESCE(c->'all_recipients', '[]'::jsonb), c->>'purpose', c->>'auto_subject', c->>'manual_subject',
       c->'summary_json', c->'business_json',
       c->>'schema_version', (c->>'schema_id')::uuid, (c->>'created_by_actor_id')::uuid,
       c->>'role', p_chit_id, c->>'direction', NOW(), NOW());

    INSERT INTO chit_detail
      (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items,
       direction, payload_delivered_at)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, c->>'detail_type', COALESCE((c->>'line_item_count')::int, 0),
       COALESCE((c->>'total_value')::numeric, 0), COALESCE(c->>'currency_code', 'INR'), c->'line_items',
       c->>'direction', CASE WHEN (c->>'payload_delivered') = 'true' THEN NOW() ELSE NULL END);

    -- ⭐ THE LINES, as rows, for THIS copy.
    IF jsonb_typeof(c->'line_items') = 'array' THEN
      INSERT INTO chit_line (chit_id, entity_id, line_id, seq, particulars, quantity, unit, unit_size, price,
                             comment, asked_as, asked_unit, raw_phrase, needs_human, flags)
      SELECT p_chit_id, (c->>'entity_id')::uuid,
             COALESCE(NULLIF(li.value->>'line_id','')::uuid, cb_line_id(p_chit_id, li.ord::int)),
             COALESCE((li.value->>'seq')::int, li.ord::int * 10),
             li.value->>'particulars',
             NULLIF(li.value->>'quantity','')::numeric,
             NULLIF(li.value->>'unit',''), NULLIF(li.value->>'unit_size',''),
             NULLIF(li.value->>'price','')::numeric, NULLIF(li.value->>'comment',''),
             NULLIF(li.value->>'asked_as',''), NULLIF(li.value->>'asked_unit',''),
             NULLIF(li.value->>'raw_phrase',''),
             COALESCE((li.value->>'needs_human')::boolean, false),
             CASE WHEN li.value ? 'qty_unverified' OR li.value ? 'variant_unspecified'
                  THEN jsonb_strip_nulls(jsonb_build_object(
                         'qty_unverified', li.value->'qty_unverified',
                         'variant_unspecified', li.value->'variant_unspecified'))
                  ELSE NULL END
        FROM jsonb_array_elements(c->'line_items') WITH ORDINALITY AS li(value, ord)
      ON CONFLICT (entity_id, chit_id, line_id) DO NOTHING;
    END IF;

    INSERT INTO chit_status (chit_id, entity_id, current_status, direction, priority_flag)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, c->>'current_status', c->>'direction',
       COALESCE(c->>'priority_flag', 'normal'));

    IF c ? 'log' AND c->'log' IS NOT NULL THEN
      INSERT INTO state_log
        (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
      VALUES
        (p_chit_id, (c->>'entity_id')::uuid, c->'log'->>'action', (c->'log'->>'action_by_identity_id')::uuid,
         c->'log'->>'action_by_display_name', c->'log'->>'new_status', c->'log'->>'detail');
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE n bigint; m bigint;
BEGIN
  SELECT count(*) INTO n FROM chit_line;
  SELECT count(*) INTO m FROM chit_line_amendment WHERE line_id IS NOT NULL;
  RAISE NOTICE 'b142: chit_line has % row(s) WITH RLS (FORCE); % amendment(s) re-keyed to line_id. No data was deleted.', n, m;
END $$;
