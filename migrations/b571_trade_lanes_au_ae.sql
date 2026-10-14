-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- b571 — TRADE-SRV1 G1: Australia and the United Arab Emirates are trade lanes; "domestic" is derived, not stored.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- Shared reference (b91 `jurisdiction`): WITHOUT RLS, GRANT SELECT to cb_app as b91 set it. Idempotent: safe to re-run; nothing is dropped.
-- The code works BEFORE this runs: lib/readiness.js reads whatever rows `jurisdiction` has — an AU or AE shop simply sees no AU / AE lane
-- until the two rows exist, and every lane's `domestic` is computed as (destination == the shop's own country), never read from this table.
--
-- Why: b91 seeded EU · US · GULF · IN with IN named "Domestic (India)" and flagged domestic — true for an Indian exporter only. An Australian
-- shop's domestic lane is AU; a Dubai shop's is AE (the GULF lane stays: the GCC as a bloc for its common import rules).

-- 1 · the two countries as lanes (dest_key = ISO 3166-1 alpha-2, the same code identities.country carries)
INSERT INTO jurisdiction (dest_key, name, display_order, domestic) VALUES
 ('AU', 'Australia', 5, false),
 ('AE', 'United Arab Emirates', 6, false)
ON CONFLICT (dest_key) DO NOTHING;

-- 2 · India's lane is India — "Domestic" is a relation to the shop, not a name. The stored flag stays for b91 readers; nothing new reads it.
UPDATE jurisdiction SET name = 'India' WHERE dest_key = 'IN' AND name = 'Domestic (India)';
COMMENT ON COLUMN jurisdiction.domestic IS 'b571: superseded — a lane is domestic when dest_key equals the shop''s own identities.country (lib/readiness.js). Kept for b91 readers; not read by the lane matrix.';
