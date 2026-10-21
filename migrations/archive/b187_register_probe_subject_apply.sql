-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b187 (APPLY) — remove the register Claude opened while diagnosing b185.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ RUN b187_register_probe_subject_dryrun.sql FIRST and read what it lists. This one deletes.
--
-- "Engine E-7 qualification", opened 2026-08-30 to test whether register_subject.type_key was actually
-- constrained by register_attachable. It was not, which is the bug b186 repairs.
--
-- ⚠️ REFUSES TO DELETE A SUBJECT THAT CARRIES ANYTHING. The NOT EXISTS is not decoration: if anyone has since
-- recorded a real entry against this register, the row stays and the count below comes back 0.
--
-- Safe to re-run: a second run deletes nothing and reports 0.

WITH gone AS (
  DELETE FROM register_subject s
   WHERE s.subject_id = '330fd30c-b327-4a11-889c-34f6730d315e'::uuid
     AND NOT EXISTS (SELECT 1 FROM register_entry e WHERE e.subject_id = s.subject_id)
  RETURNING s.subject_id
)
SELECT count(*)::int AS subjects_deleted,
       (SELECT count(*)::int FROM register_subject) AS subjects_remaining
  FROM gone;
