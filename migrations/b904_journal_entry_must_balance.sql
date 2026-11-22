-- b904_journal_entry_must_balance.sql — the database itself refuses a journal entry whose debits and credits differ (VERIFY-EL-DB A7, batch 1128).
--
-- ⚠️ WAITING FOR ATHI'S YES (money rule: a new rule on the ledger) · NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat.
-- WHY  journal_line has a one-sided CHECK per row and an insert-only trigger, but nothing that an ENTRY adds up: a code bug posting debit 118000 against credit 100000 minor
--      would be stored, and only the trial balance would show it. Standard double-entry practice is to enforce it at commit, so the lines of one entry may arrive in any order
--      inside one transaction (lib/books-store.js insertLines writes one entry's lines in a single INSERT, inside the posting transaction).
-- WHAT a DEFERRABLE INITIALLY DEFERRED constraint trigger on journal_line: at COMMIT, for every entry that got a line in the transaction, SUM(dr_minor) must equal SUM(cr_minor)
--      (base-currency minor units, the columns the trial balance uses) or the whole transaction fails (23514). It looks only at entries touched in the transaction, so
--      existing rows are never re-checked and nothing is changed or deleted. It does NOT compare journal_entry.total_minor.
-- BEFORE YOU RUN (read-only, tells you whether history already has an unbalanced entry; none is touched either way):
--        SELECT entry_id, sum(dr_minor) AS dr, sum(cr_minor) AS cr FROM journal_line GROUP BY entry_id HAVING sum(dr_minor) <> sum(cr_minor);
-- ORDER api first or database first both work: the api already posts balanced entries (lib/books.js). Test helpers that wrote one line per statement were changed in the same batch.
-- RLS: no table, no policy, no grant changes. The function is SECURITY INVOKER: it reads the entry's own lines, which the posting role can see under its entity binding.
-- ROLL BACK: DROP TRIGGER IF EXISTS journal_line_balanced ON public.journal_line;  DROP FUNCTION IF EXISTS public.journal_entry_must_balance();
-- CHECK (read-only): SELECT tgname, tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = 'journal_line_balanced' AND NOT tgisinternal;   (one row, t, t)
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.journal_entry_must_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE d bigint; c bigint;
BEGIN
  SELECT coalesce(sum(dr_minor), 0), coalesce(sum(cr_minor), 0) INTO d, c FROM public.journal_line WHERE entry_id = NEW.entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'journal entry % does not balance: debit % <> credit % (minor units)', NEW.entry_id, d, c USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS journal_line_balanced ON public.journal_line;
CREATE CONSTRAINT TRIGGER journal_line_balanced AFTER INSERT ON public.journal_line
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.journal_entry_must_balance();
COMMIT;
