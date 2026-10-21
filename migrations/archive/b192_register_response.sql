-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b192 — the response CATEGORY: the four T's. One script, safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-31: *"add the 4 T's response category."*
--
-- ⭐⭐ WHY IT IS NOT `treatment`. `treatment` is free text — *"book the rig a week earlier"* — and answers what
-- we are doing. The CATEGORY answers what that decision IS, and it is the column every risk report pivots on:
-- *"how much of this register are we simply tolerating"* is a question prose cannot answer. PRINCE2 and the
-- UK-government risk guidance both use these four, and the register already had the free text without them.
--
--   tolerate   accept it and carry on — no action, but the decision is RECORDED
--   treat      do something to reduce likelihood or severity
--   transfer   move the exposure elsewhere — insure it, contract it out
--   terminate  stop doing the thing that carries the risk
--
-- ⚠️ THESE ARE FOR THREATS. PRINCE2's opportunity set is different (exploit · enhance · share · reject) and is
-- deliberately NOT folded in: sharing an upside and transferring a downside are opposite decisions, and one
-- column holding both would let a report count them together.
--
-- ⚠️ A COLUMN ON AN EXISTING TABLE, so no table probe can tell whether this has run — lib/raida.js asks
-- hasColumn('register_entry','response') and simply omits the column until it exists. Naming it before this is
-- run would be a 42703, which throws the WHOLE query rather than returning nothing.
--
-- ⚠️ NULLABLE, and it stays nullable. Most entries are not risks, and a risk nobody has decided about yet is a
-- real and common state — a NOT NULL with a default would record a decision nobody made.
-- ⚠️ NO RLS CHANGE. register_entry is already FORCE ROW LEVEL SECURITY with a NULLIF-guarded policy (b185).

ALTER TABLE register_entry ADD COLUMN IF NOT EXISTS response text;

DO $b192$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'register_entry'::regclass AND conname = 'register_entry_response_chk'
  ) THEN
    ALTER TABLE register_entry
      ADD CONSTRAINT register_entry_response_chk
      CHECK (response IS NULL OR response IN ('tolerate', 'treat', 'transfer', 'terminate'));
  END IF;
END
$b192$;

/* ⭐ The report groups on this, and a register worth reading has hundreds of rows. Partial, because the column
   is NULL for most of them — every entry that is not a risk, and every risk nobody has decided about. */
CREATE INDEX IF NOT EXISTS register_entry_response
  ON register_entry (entity_id, response) WHERE response IS NOT NULL;

-- ── what it looks like now — ONE result set ────────────────────────────────────────────────────────────────────
SELECT 'register_entry.response'                                              AS added,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'register_entry'
           AND column_name = 'response')                                      AS column_present,
       (SELECT count(*) FROM pg_constraint
         WHERE conrelid = 'register_entry'::regclass
           AND conname = 'register_entry_response_chk')                       AS check_present,
       (SELECT count(*) FROM pg_indexes
         WHERE tablename = 'register_entry' AND indexname = 'register_entry_response') AS index_present,
       (SELECT count(*) FROM register_entry WHERE response IS NOT NULL)       AS rows_answered,
       'the app picks it up within 60s — a NO is cached that long'            AS note;
