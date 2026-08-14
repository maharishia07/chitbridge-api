-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b149 — a self-chit makes ONE copy by default, and it is the Task.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-14: *"self should create one copy only, no two copies, and you would be very specific about
-- direction."*
--
-- ── ⚠️ WHAT TWO COPIES ACTUALLY COST ────────────────────────────────────────────────────────────────────────────
-- `identities.self_copy_pref` defaulted to 'both', so every self-chit wrote a `sent` copy AND a `received` copy for
-- the SAME entity — two chit_header rows, two chit_detail rows, two sets of chit_line rows. It is not a display
-- quirk. Any cross-chit read that joins through chit_header on (entity_id, chit_id) — which has no unique
-- constraint — multiplies. The worklist showed four lines per person where two were assigned, and `due_on` and
-- `actor_id` looked broken while filtering perfectly, because they were filtering a doubled set. (The join itself
-- is now LATERAL … LIMIT 1 in lib/assign.js, so it can no longer multiply even where two copies legitimately
-- exist. This migration removes the reason they exist.)
--
-- ── ⭐ WHY `received`, NOT `sent` — the direction, stated plainly ────────────────────────────────────────────────
-- A self-chit exists because there is WORK TO DO. The Order/Sent list is the record of obligations placed on
-- SOMEONE ELSE, and a self-chit places none: filing it there asserts "I sent this to a counterparty", which is
-- false. Task asserts "this is mine to act on", which is true. It is also what the capture path already does — a
-- WhatsApp message becomes a Task, never an Order — so this makes a typed self-chit and a captured one agree
-- instead of differing by how they arrived.
--
-- ⚠️ THE COLUMN DEFAULT IS THE REAL FIX, NOT THE CODE FALLBACK. routes/chits.js reads
-- `self_copy_pref || 'received'`, which only fires when the value is NULL — and this column is NOT NULL with a
-- default, so for every existing and every new entity the code fallback was unreachable. A default that lives only
-- in application code, behind a column that is never null, is a default that never happens.
--
-- ── ⚠️ EXISTING ENTITIES ARE **NOT** REWRITTEN, DELIBERATELY ─────────────────────────────────────────────────────
-- 'both' is a legal, declared choice. An entity that set it on purpose keeps it; we cannot tell that apart from an
-- entity that merely inherited it, and silently changing a stored preference is exactly the kind of change nobody
-- can audit later. New entities get the better default; anyone who wants the old behaviour can still choose it,
-- and anyone stuck on 'both' can be moved deliberately with the (commented) statement at the bottom.
--
-- Nothing is deleted. Existing chits keep both their copies — the record of what was written stands.
--
-- Safe to re-run.

ALTER TABLE identities
  ALTER COLUMN self_copy_pref SET DEFAULT 'received';

-- The CHECK constraint already permits 'received' (b_baseline part 2: both | sent | received), so no constraint
-- change is needed. Asserted here rather than assumed, because a default the constraint rejects would fail at the
-- first INSERT rather than at migration time — the worst place to find out.
DO $$
DECLARE ok boolean;
BEGIN
  SELECT pg_get_constraintdef(oid) LIKE '%received%' INTO ok
    FROM pg_constraint WHERE conname = 'identities_self_copy_pref_check';
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'b149: identities_self_copy_pref_check does not permit ''received'' — refusing to set a default the constraint would reject';
  END IF;
END $$;

DO $$
DECLARE d text; n_both bigint; n_total bigint;
BEGIN
  SELECT column_default INTO d FROM information_schema.columns
   WHERE table_name = 'identities' AND column_name = 'self_copy_pref';
  SELECT count(*) INTO n_both  FROM identities WHERE self_copy_pref = 'both';
  SELECT count(*) INTO n_total FROM identities;
  RAISE NOTICE 'b149: default is now %', d;
  RAISE NOTICE 'b149: % of % identities still hold ''both'' — left UNCHANGED on purpose (a declared choice is not a gap).', n_both, n_total;
  RAISE NOTICE 'b149: new entities will write ONE self-chit copy, direction=received (a Task).';
END $$;

-- ── To move existing entities too, run this DELIBERATELY and separately ─────────────────────────────────────────
-- It rewrites a stored preference, so it is not part of the migration:
--
--   UPDATE identities SET self_copy_pref = 'received' WHERE self_copy_pref = 'both';
--
-- Existing chits are unaffected either way; this only changes what future self-chits write.
