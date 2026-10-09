-- b293_t60_reverse_py000002.sql — DRAFT — NOT RUN · Athi runs it. T60 test-data fix (2026-10-04): PY/2026-27/000002 was the SECOND posting of one ₹5,000.
--
-- WHY: before M26 the Pay popup recorded a payment the moment it opened a three-step, and a fresh client_ref per open caught nothing —
-- Chola Auto Care's books hold PY/2026-27/000001 AND PY/2026-27/000002 for one payment (REVIEW-accounts-crm R1, SPEC-payments §9 T60).
-- The fix is the books' own correction: a MIRROR entry (never an UPDATE, never a DELETE — b273's rule) that cancels 000002 and reopens the
-- bills it had settled. It is byte-for-byte what lib/books.js writeReversal + CBReceivables.reverseItems write when the owner presses
-- Reverse on the row (M29): the same lines swapped, the same party rows negated, each naming the row it reverses.
--
-- ⭐ PREFER THE ROW. With M29 deployed, Reverse on the statement row of PY/2026-27/000002 does exactly this through the one writer, with
--    the owner's reason and name on it. Run this file only if the fix must land before M29 is live or without a sign-in.
--
-- SAFE TO RE-RUN: it refuses unless exactly one PY/2026-27/000002 payment entry exists; it does nothing when that entry is already reversed
-- (a journal_entry with reverses_entry_id = it, or source_ref 'reverse:<id>'); every party row it would reverse that already has a reversal
-- row is skipped. It REFUSES (nothing written) when the entry's month is locked — the api would move the date to the next open month;
-- this file does not pretend to, so the owner reverses from the row instead.
--
-- RUN AS postgres IN THE SUPABASE SQL EDITOR (or `railway connect`), inside the transaction below. Needs b272 + b273 + b274.
-- Fill ONE value: the entity id of the shop (Chola Auto Care) at :entity — or leave the lookup by name in STEP 0 and check the NOTICE.

BEGIN;

DO $$
DECLARE
  v_entity   uuid;
  v_orig     journal_entry%ROWTYPE;
  v_n        bigint;
  v_entry_id uuid;
  v_entry_no text;
  v_status   text;
  v_lines    int;
  v_items    int;
  v_refs     text[];
BEGIN
  /* ── STEP 0 · the shop and the entry: exactly one PY/2026-27/000002 that is a payment, else refuse ── */
  SELECT h.entity_id INTO v_entity
    FROM journal_entry h
   WHERE h.entry_no = 'PY/2026-27/000002' AND h.event_type = 'payment_made' AND h.source_ref LIKE 'pay:%'
   GROUP BY h.entity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'T60: no PY/2026-27/000002 payment entry found — nothing to reverse'; END IF;
  IF (SELECT count(DISTINCT entity_id) FROM journal_entry WHERE entry_no = 'PY/2026-27/000002' AND event_type = 'payment_made') <> 1 THEN
    RAISE EXCEPTION 'T60: more than one shop holds a PY/2026-27/000002 — name the entity (set v_entity by hand) and re-run';
  END IF;
  SELECT * INTO v_orig FROM journal_entry WHERE entity_id = v_entity AND entry_no = 'PY/2026-27/000002' AND event_type = 'payment_made';
  RAISE NOTICE 'T60: shop % · entry % (%) % % %', v_entity, v_orig.entry_no, v_orig.entry_id, v_orig.posting_date, v_orig.total_minor, v_orig.currency;

  /* ── idempotent: already reversed → say so, write nothing ── */
  IF v_orig.reverses_entry_id IS NOT NULL THEN RAISE EXCEPTION 'T60: % is itself a reversal', v_orig.entry_no; END IF;
  SELECT entry_no INTO v_entry_no FROM journal_entry
   WHERE entity_id = v_entity AND (reverses_entry_id = v_orig.entry_id OR source_ref = 'reverse:' || v_orig.entry_id::text) LIMIT 1;
  IF FOUND THEN RAISE NOTICE 'T60: % was already reversed by % — nothing to do', v_orig.entry_no, v_entry_no; RETURN; END IF;

  /* ── the month must be open: the api moves a locked month's reversal to the next open date; this file does not pretend to ── */
  SELECT status INTO v_status FROM fiscal_period WHERE entity_id = v_entity AND fiscal_year = v_orig.fiscal_year AND period = v_orig.period;
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'T60: the month of % is % — reverse it from the statement row (M29) so the entry lands on the first open date', v_orig.entry_no, COALESCE(v_status, 'missing');
  END IF;

  /* ── STEP 1 · the number: the owner's correction takes the MJ series of the entry's year (lib/books.js voucherOf manual; books-store nextNo) ── */
  INSERT INTO books_counter (entity_id, series, fiscal_year, next_no) VALUES (v_entity, 'MJ', v_orig.fiscal_year, 2)
    ON CONFLICT (entity_id, series, fiscal_year) DO UPDATE SET next_no = books_counter.next_no + 1
    RETURNING next_no - 1 INTO v_n;
  v_entry_no := 'MJ/' || v_orig.fiscal_year || '/' || lpad(v_n::text, 6, '0');

  /* ── STEP 2 · the mirror entry (writeReversal: same date, same document date, source_ref reverse:<id>, event reversal, points back) ── */
  INSERT INTO journal_entry (entity_id, entry_no, series, voucher_type, posting_date, doc_date, fiscal_year, period, source_chit_id, source_ref,
                             event_type, rule_version, reverses_entry_id, is_opening, narration, currency, total_minor, created_by)
  VALUES (v_entity, v_entry_no, 'MJ', 'Journal', v_orig.posting_date, COALESCE(v_orig.doc_date, v_orig.posting_date), v_orig.fiscal_year, v_orig.period,
          v_orig.source_chit_id, 'reverse:' || v_orig.entry_id::text, 'reversal', v_orig.rule_version, v_orig.entry_id, v_orig.is_opening,
          'Reversal of ' || v_orig.entry_no || ' — Paid twice (T60 test-data fix, 2026-10-04)', v_orig.currency, v_orig.total_minor, NULL)
  RETURNING entry_id INTO v_entry_id;

  /* ── STEP 3 · the lines: the original's, debit and credit swapped, same accounts, same party ── */
  INSERT INTO journal_line (entity_id, entry_id, line_no, account_id, party_id, dr_minor, cr_minor, currency, amount_txn_minor, fx_rate, counter_id, tax_rate)
  SELECT entity_id, v_entry_id, line_no, account_id, party_id, cr_minor, dr_minor, currency, amount_txn_minor, fx_rate, counter_id, tax_rate
    FROM journal_line WHERE entity_id = v_entity AND entry_id = v_orig.entry_id ORDER BY line_no;
  GET DIAGNOSTICS v_lines = ROW_COUNT;

  /* ── STEP 4 · the monthly balances, both grains (books.js balanceRows: the account, and the account per party) ── */
  INSERT INTO account_balance (entity_id, account_id, party_key, currency, fiscal_year, period, dr_minor, cr_minor, line_count, updated_at)
  SELECT v_entity, l.account_id, g.party_key, l.currency, v_orig.fiscal_year, v_orig.period, sum(l.dr_minor), sum(l.cr_minor), count(*), now()
    FROM journal_line l
    CROSS JOIN LATERAL (SELECT '00000000-0000-0000-0000-000000000000'::uuid AS party_key
                        UNION ALL SELECT l.party_id WHERE l.party_id IS NOT NULL) g
   WHERE l.entity_id = v_entity AND l.entry_id = v_entry_id
   GROUP BY l.account_id, g.party_key, l.currency
  ON CONFLICT (entity_id, account_id, party_key, currency, fiscal_year, period)
  DO UPDATE SET dr_minor = account_balance.dr_minor + EXCLUDED.dr_minor, cr_minor = account_balance.cr_minor + EXCLUDED.cr_minor,
                line_count = account_balance.line_count + EXCLUDED.line_count, updated_at = now();

  /* ── STEP 5 · the party rows (CBReceivables.reverseItems): for every document the original's rows came from, every money row of that
        document — its own advance row and each allocation half — negated, naming the row it reverses; a row already reversed is skipped.
        This is what REOPENS the bills: the −amount against each bill comes back as +amount. ── */
  SELECT array_agg(DISTINCT ref) INTO v_refs FROM party_item WHERE entity_id = v_entity AND entry_id = v_orig.entry_id AND ref_kind <> 'status';
  INSERT INTO party_item (entity_id, party_id, account_id, side, ref, against_ref, ref_kind, kind, amount_minor, pending_minor, currency,
                          due_date, doc_date, status, reverses, reverses_kind, entry_id, payment_id, note, created_by)
  SELECT i.entity_id, i.party_id, i.account_id, i.side, i.ref, i.against_ref, 'reversal', i.kind, -i.amount_minor, NULL, i.currency,
         NULL, v_orig.posting_date, NULL, i.item_id::text, i.ref_kind, v_entry_id, NULL, NULL, NULL
    FROM party_item i
   WHERE i.entity_id = v_entity AND i.ref = ANY(COALESCE(v_refs, ARRAY[]::text[]))
     AND i.ref_kind NOT IN ('status', 'reversal') AND i.amount_minor <> 0
     AND EXISTS (SELECT 1 FROM party_item o WHERE o.entity_id = v_entity AND o.entry_id = v_orig.entry_id AND o.ref = i.ref
                                              AND o.party_id = i.party_id AND o.account_id = i.account_id)
     AND NOT EXISTS (SELECT 1 FROM party_item r WHERE r.entity_id = v_entity AND r.ref_kind = 'reversal' AND r.reverses = i.item_id::text)
   ORDER BY i.item_id;
  GET DIAGNOSTICS v_items = ROW_COUNT;

  RAISE NOTICE 'T60: % reversed by % — % lines mirrored, % party rows reversed (bills reopened: %)', v_orig.entry_no, v_entry_no, v_lines, v_items,
    (SELECT string_agg(DISTINCT against_ref, ', ') FROM party_item WHERE entity_id = v_entity AND entry_id = v_entry_id AND reverses_kind = 'allocation' AND against_ref <> ref);
END $$;

-- CHECK before COMMIT (the mirror and what it reopened):
--   SELECT entry_no, posting_date, narration, total_minor FROM journal_entry WHERE source_ref LIKE 'reverse:%' ORDER BY created_at DESC LIMIT 3;
--   SELECT against_ref, sum(amount_minor) AS outstanding_minor FROM party_item WHERE entity_id = '<entity>' GROUP BY against_ref ORDER BY 1;
-- Happy → COMMIT;   not → ROLLBACK;
COMMIT;
