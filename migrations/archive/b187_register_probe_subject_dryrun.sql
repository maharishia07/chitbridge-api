-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b187 (DRY RUN) — the one register Claude opened while diagnosing b185.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- READS ONLY. Run this, look at the row, then run b187_register_probe_subject_apply.sql.
--
-- ⚠️ WHY IT EXISTS. To find out whether register_attachable actually held rows, the cheapest test was to open a
-- register with type_key 'campaign' and see whether the foreign key refused it. It did not refuse — which is how
-- the missing constraint was found — so a real subject row is now sitting in the data.
--
-- ONE result set. It also confirms the row carries nothing: a subject with entries must not be deleted.

SELECT s.subject_id, s.type_key, s.name, s.opened_at, s.closed_at,
       (SELECT count(*) FROM register_entry e WHERE e.subject_id = s.subject_id) AS entries_on_it
  FROM register_subject s
 WHERE s.subject_id = '330fd30c-b327-4a11-889c-34f6730d315e'::uuid;
