-- b856_quick_key_audit_action_update.sql — CTR-226 (13 Nov 2026): quick_key_audit_action_check also allows 'update', so a recolour / reorder / schedule of a quick-key group is audited instead of refused.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres): SIT first, then production. Safe to repeat (DROP CONSTRAINT IF EXISTS, then ADD). Touches no row, no grant, no policy.
--    ORDER vs the deploy: either way is safe. The constraint only WIDENS (every value allowed before is allowed after), so the api before this file keeps working as today, and the api after it
--    needs it. Until it runs on a database, PATCH /api/quick-keys/groups/:id with {color | sort_order | suggest_on_start} answers 500 there (CTR-226). Run it FIRST, before the next deploy, so the fix is live the moment the api is.
--
-- WHY. lib/quick-keys.js:104 writes the audit action 'update' for every change of a group other than its name (lib/quick-keys.js:32 AUDIT_ACTIONS is the one list of the eight actions:
--    create rename update delete add remove move photo). The baseline constraint (000_baseline_2026-10-21.sql:4482) lists seven: 'update' is the only one missing, and no later migration adds it.
--    The audit INSERT lives in the same transaction as the change, so the whole PATCH rolls back and the shop sees INTERNAL. quick_key_audit has ONE writer (lib/quick-keys.js:37).
-- ROLL BACK (only if no 'update' row exists yet, else the re-add is refused; delete nothing, rather keep this file):
--    ALTER TABLE quick_key_audit DROP CONSTRAINT IF EXISTS quick_key_audit_action_check;
--    ALTER TABLE quick_key_audit ADD CONSTRAINT quick_key_audit_action_check CHECK (action = ANY (ARRAY['create','rename','delete','add','remove','move','photo']));
-- CHECK (read-only, one row): SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conrelid = 'public.quick_key_audit'::regclass AND conname = 'quick_key_audit_action_check';
--    Expect convalidated = true and def listing all eight: create, rename, update, delete, add, remove, move, photo.
-- RLS: unchanged. quick_key_audit stays ENABLED + FORCED with its entity policy; b838's insert-only grant is untouched.

BEGIN;
SET LOCAL lock_timeout = '5s';   -- the ALTER takes ACCESS EXCLUSIVE: fail fast instead of queueing behind a long read; a failed run changed nothing and is safe to run again

ALTER TABLE quick_key_audit DROP CONSTRAINT IF EXISTS quick_key_audit_action_check;
ALTER TABLE quick_key_audit ADD CONSTRAINT quick_key_audit_action_check
  CHECK (action = ANY (ARRAY['create'::text, 'rename'::text, 'update'::text, 'delete'::text, 'add'::text, 'remove'::text, 'move'::text, 'photo'::text]));

COMMIT;
