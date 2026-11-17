-- b285_books_payment_advice.sql — the payment ADVICE on a payment (M30, SPEC-payments-2026-10-05 §3 · §4.3 · §6; MASTER-BUILD row M30).
-- DRAFT — Athi runs it from main's migrations/ after the M30 api PR is merged. Safe to re-run (IF NOT EXISTS throughout).
--
-- ⚠️⚠️ RUN AS postgres IN THE SUPABASE SQL EDITOR — WITHOUT RLS (ALTER TABLE / CREATE INDEX; cb_app may not).
-- RLS: WITH — books_payment is already FORCE RLS per shop (b274 / routes/books.js:12); new columns inherit its policies. No new table, no new policy.
--
-- ⭐ THE ADVICE IS A CHIT (purpose 'general', business_json.kind 'payment_advice' — §3.1): the payer settles its own books and
--   informs; nothing posts on the payee side at send (M31 Accept posts). This migration only lets the PAYMENT remember which
--   chit carried its advice, and when it was shared off-rail instead. Everything else is the chit tables that exist.
-- ⭐ ONE ADVICE PER PAYMENT: lib/books-store setAdvice writes advice_chit_id with `WHERE advice_chit_id IS NULL OR = the same`
--   (first wins); a second different id is a 409 in the route. The partial index is the lookup "which payment did this chit advise".
-- ⭐ SAFE TO DEPLOY BEFORE THIS RUNS: lib/books-store adviceReady() asks schema.hasColumn (cached: a yes forever, a no for a
--   minute) and every reader answers advice state 'none' / "Advice not available yet" instead of 42703 — nothing 500s.
--
-- ── RUN ORDER ─────────────────────────────────────────────────────────────────────────────────────────────────
--   STEP 1 (preview, read-only) · STEP 2 (alter, one transaction) · STEP 3 (check, read-only)
--   Undo: ALTER TABLE books_payment DROP COLUMN advice_chit_id, DROP COLUMN advice_shared_at;  (re-derivable from the chits)

-- ═════ STEP 1 · PREVIEW (read-only) ═══════════════════════════════════════════════════════════════════════════
SELECT 'books_payment present (must be 1)' AS what, (to_regclass('public.books_payment') IS NOT NULL)::int AS n
UNION ALL SELECT 'advice_chit_id exists already (0 = new)', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books_payment' AND column_name = 'advice_chit_id')::int
UNION ALL SELECT 'advice_shared_at exists already (0 = new)', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books_payment' AND column_name = 'advice_shared_at')::int
UNION ALL SELECT 'payments recorded so far', (SELECT count(*) FROM books_payment)::int;

-- ═════ STEP 2 · ALTER (one transaction) ════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE books_payment ADD COLUMN IF NOT EXISTS advice_chit_id   uuid;          -- the chit that carried the advice (my sent copy's chit_id); null = none sent
ALTER TABLE books_payment ADD COLUMN IF NOT EXISTS advice_shared_at timestamptz;   -- off-rail: when the words were shared (copy / WhatsApp / e-mail) — no chit, no accept

COMMENT ON COLUMN books_payment.advice_chit_id   IS 'M30: the payment-advice chit (purpose general, business_json.kind payment_advice) this payment sent; one per payment, first wins';
COMMENT ON COLUMN books_payment.advice_shared_at IS 'M30: when the advice words were shared off-rail (the party is not on ChitBridge); null until shared';

-- which payment did this chit advise — only rows that sent one
CREATE INDEX IF NOT EXISTS books_payment_advice_ix ON books_payment (entity_id, advice_chit_id) WHERE advice_chit_id IS NOT NULL;

COMMIT;

-- ═════ STEP 3 · CHECK (read-only) ═════════════════════════════════════════════════════════════════════════════
-- expected: 1 | 1 | 1
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books_payment' AND column_name = 'advice_chit_id')::int   AS advice_chit_id,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'books_payment' AND column_name = 'advice_shared_at')::int AS advice_shared_at,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'books_payment_advice_ix')::int                                               AS advice_index;
