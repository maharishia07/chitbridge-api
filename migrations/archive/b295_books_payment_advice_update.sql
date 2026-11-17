-- b295_books_payment_advice_update.sql — let the payment remember its advice (M30-2: PATCH /api/books/payments/:id answered 500).
-- DRAFT — Athi runs it from main's migrations/ after the PR merges. Safe to re-run.
--
-- ⚠️ RUN AS postgres IN THE SUPABASE SQL EDITOR (function / trigger / GRANT need it; cb_app may not).
-- RLS: WITH — books_payment stays FORCE RLS per shop; no new table, no new policy.
--
-- WHY: b273 made books_payment insert-only twice over — a BEFORE UPDATE trigger (books_insert_only) AND REVOKE UPDATE FROM cb_app.
--   b285 added advice_chit_id / advice_shared_at to the same table but never opened them, so the one write the advice makes
--   (lib/books-store setAdvice, an UPDATE) was refused on live: "permission denied" → 500. The payment itself stays untouched.
-- WHAT: (1) a column-level GRANT UPDATE on ONLY those two columns; (2) the trigger lets an UPDATE through ONLY when every other
--   column is unchanged AND an advice column goes from null to a value (or stays) — first-wins, never overwritten, never cleared.
--   DELETE is still refused. Every other column of the payment is still insert-only.
-- Undo: REVOKE UPDATE (advice_chit_id, advice_shared_at) ON books_payment FROM cb_app; re-run the b273 trigger line.

BEGIN;

CREATE OR REPLACE FUNCTION books_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $t$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'advice_chit_id' - 'advice_shared_at') = (to_jsonb(OLD) - 'advice_chit_id' - 'advice_shared_at')
     AND (OLD.advice_chit_id   IS NULL OR NEW.advice_chit_id   IS NOT DISTINCT FROM OLD.advice_chit_id)
     AND (OLD.advice_shared_at IS NULL OR NEW.advice_shared_at IS NOT DISTINCT FROM OLD.advice_shared_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The books are insert-only: % on % is refused — correct with a reversing entry (Rule 3 audit trail).', TG_OP, TG_TABLE_NAME;
END $t$;

DROP TRIGGER IF EXISTS books_payment_insert_only ON books_payment;
CREATE TRIGGER books_payment_insert_only BEFORE UPDATE OR DELETE ON books_payment FOR EACH ROW EXECUTE FUNCTION books_payment_guard();

GRANT UPDATE (advice_chit_id, advice_shared_at) ON books_payment TO cb_app;

COMMIT;

-- CHECK (read-only), expected: 1 | 1
SELECT (SELECT count(*) FROM pg_trigger WHERE tgname = 'books_payment_insert_only' AND tgfoid = 'books_payment_guard'::regproc)::int AS guard_on,
       has_column_privilege('cb_app', 'books_payment', 'advice_chit_id', 'UPDATE')::int AS cb_app_may_update_advice;
