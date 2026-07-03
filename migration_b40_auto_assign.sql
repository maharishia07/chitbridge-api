-- B4.0 Migration — Auto-assign on receipt + delegation · Decision D1
-- Entity picks ONE mode; a default assignee is the safety-net/overflow; least-loaded tie-break = last_assigned_at;
-- on-leave routes down a delegate chain (loop-prevented). Apply BEFORE deploying the matching chits.js/actors.js.

-- entity setting: mode + the default (overflow) assignee
ALTER TABLE entity_actor_settings ADD COLUMN IF NOT EXISTS auto_assign_mode VARCHAR(20) NOT NULL DEFAULT 'off'
  CHECK (auto_assign_mode IN ('off','default_assignee','least_loaded'));
ALTER TABLE entity_actor_settings ADD COLUMN IF NOT EXISTS default_assignee_actor_id UUID REFERENCES identities(identity_id);

-- per-actor: leave-cover delegate + the "least-recently-assigned" stamp used for the tie-break
ALTER TABLE identities ADD COLUMN IF NOT EXISTS delegate_actor_id UUID REFERENCES identities(identity_id);
ALTER TABLE identities ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ;

-- Verify
SELECT 'entity_actor_settings' AS t, string_agg(column_name, ', ' ORDER BY ordinal_position) AS cols
FROM information_schema.columns WHERE table_name='entity_actor_settings'
UNION ALL
SELECT 'identities(new)', 'delegate_actor_id, last_assigned_at';
