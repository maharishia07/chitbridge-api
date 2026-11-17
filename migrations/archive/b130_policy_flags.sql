-- b130 — POLICY FLAGS BECOME REAL. Athi, 2026-08-09: "make the policy flags real, move it to settings."
--
-- Until now Settings → Policy flags wrote to localStorage. It reported "set ✓" and nothing left the browser:
-- per device, lost on a cache clear, invisible to the server that is supposed to ENFORCE them. `self_copy_pref`
-- was the worst of it — a real, enforced column on identities sat right there, and the card wrote past it into
-- localStorage, so the one flag that DID have teeth was the one the UI quietly disconnected.
--
-- ⚠️ ONE COLUMN, NOT A TABLE. These are a handful of small scalars read on almost every send; a side table would
-- add a join to the hot path to store four values. jsonb keeps them with the entity they govern and lets a new
-- flag ship without a migration each time.
--
-- ⚠️ `self_copy_pref` IS NOT MOVED IN HERE. It keeps its own column because that is what /api/chits/send already
-- reads to suppress a copy. Two places holding the same fact is how they come to disagree — lib/policy.js proxies
-- that one key to the column so the API presents one surface over one truth.
--
-- SAFE TO RE-RUN. Adds nothing that exists, defaults to '{}', and changes no behaviour on its own: every flag
-- falls back to the same default it had before this ran.

ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS policy_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN identities.policy_flags IS
  'Per-entity policy flags (b130). Whitelisted + validated in lib/policy.js — never written raw from a request. self_copy_pref is NOT here; it keeps its own column, which is what chits/send reads.';
