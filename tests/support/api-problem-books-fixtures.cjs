/**
 * tests/support/api-problem-books-fixtures.cjs — THE STAND-IN ANSWERS of tests/api-problem-books.test.cjs: the READY side of the reads, the writes' return literals, the ledger and statement patches, the Needs-you rows and the opening-balance rows.
 * OWNS      the constants the books problem-details scenarios feed the stand-in libraries (RETURN_* · ENTRY · JOURNAL · REVERSAL · PROPOSAL · ADVICE · CHART · LEDGER_* · ATTENTION_* · OPENING_*), each mirroring the real library's return literal key for key.
 * CALLED BY tests/api-problem-books.test.cjs (once, with the shop and party ids and the ledger setting row the scenarios already hold).
 * FLOW      fixtures({ SHOP, PARTY, SETTING_ROW, HERE }) ──▶ the constants, the same rows in the same order ──▶ the scenario table
 * CARD      api-hardening/books
 */
'use strict';
const path = require('path');

module.exports = ({ SHOP, PARTY, SETTING_ROW, HERE }) => {
const RAIL_STOP = (pack) => async () => { throw Object.assign(new Error('Read from the rail.'), { code: 'RETURN_FROM_RAIL', pack }); };
const RETURN_BASE = { currency: 'AUD', pack: 'AU', form: 'BAS', name: 'Business Activity Statement', short: 'BAS', authority: 'ATO', portal: 'https://example.invalid', prepared: 'prepared from the ledgers' };
const RETURN_READY = { patch: { period: { taxReturn: async () => Object.assign({}, RETURN_BASE, { asked: { simpler: true }, periods: [], period: { period: 'Q2' }, boxes: [], payable_minor: 0, refund_minor: 0, net_minor: 0, notes: [], cite: null }) } } };
const RETURN_NEEDS = { patch: { period: { taxReturn: async () => Object.assign({}, RETURN_BASE, { asked: {}, needs: 'period', why: 'Which period?', periods: [], period: null, boxes: [], payable_minor: 0, refund_minor: 0, net_minor: 0, notes: [], cite: null, emirates: [], staggers: {} }) } } };
const REVALUE_READY = { ready: true, date: '2026-09-30', reverses_on: '2026-10-01', functional: 'INR', rows: [], missing: [], gain_minor: 0, posted: null, event: { kind: 'fx_revalue' } };
/* ── API-8 (output allow-list), the writes and the id reads: each stand-in answer mirrors the library's own return literal key for key (the lib/books.js line is named), so the
   closed root is learned from the answer the real writer gives; the figures are placeholders, no posting runs ── */
const ENTRY = '33333333-3333-4333-8333-333333333333';
const ENTRY2 = '55555555-5555-4555-8555-555555555555';
const CHIT = '99999999-9999-4999-8999-999999999999';
const DAY = '2026-09-30';
/** l16 Needs you: the evidence counts of a range (and the entries behind one), and a party's bills page: what the real readers answer, handed over whole (the stand-in db cannot seat the ledger rows they read) */
const ATTENTION_COUNTS = { from: DAY, to: DAY, total: 3, no_tax_invoice: 1, no_file: 1, no_source: 0, open_queries: null, needs: 1 };
const ATTENTION_ENTRIES = Object.assign({}, ATTENTION_COUNTS, { kind: 'needs', entries: [{ entry_id: PARTY, entry_no: 'EX-1', posting_date: DAY, event_type: 'expense', narration: 'Rent', total_minor: 10000 }], count: 1, page: 1, limit: 25 });
const ATTENTION_PATCH = (answer) => ({ evidence: { attentionIn: async () => answer } });
const BILL_LATE = { ref: 'INV-1', bill_no: 'B-101', date: DAY, due_date: DAY, amount_minor: 50000, owed_minor: 30000, status: 'part', days_overdue: 12, band: '1-30', no_terms: false, disputed: false, reasons: ['no_tax_invoice', 'overdue'], why: 'no_tax_invoice', action: 'attach', entry_id: PARTY, chit_id: PARTY, mark: 'query', evidence_flag: 'no_tax_invoice' };
const BILL_QUIET = { ref: 'INV-2', bill_no: null, date: null, due_date: null, amount_minor: 20000, owed_minor: 20000, status: 'unpaid', days_overdue: null, band: null, no_terms: true, disputed: false, reasons: [], why: null, action: null, entry_id: null, chit_id: null, mark: null, evidence_flag: null };
const PARTY_BILLS = { currency: 'INR', party_id: PARTY, side: 'customer', asOf: DAY, tab: 'needs', why: null, state: 'open', band: null, sort: 'urgent', bills: [BILL_LATE, BILL_QUIET], counts: { needs: 1, open: 2, paid: 0, all: 2, in_order: 1 }, owed_minor: 50000, bands: { '1-30': 30000 }, on_account_minor: 0, mark_actions: null, checks: true, total: 2, page: 1, limit: 25 };
const BILLS_PATCH = { books: { knownParty: async () => true }, partybills: { read: async () => PARTY_BILLS } };
const PAY_ROW = { payment_id: PARTY, party_id: PARTY, direction: 'in', amount_minor: 1000, currency: 'INR', mode: 'cheque', reference: null, cheque_no: '1', cheque_bank: 'B', cheque_date: DAY, received_at: DAY, status: 'received', advice_chit_id: null, advice_shared_at: null };
const JOURNAL = { ok: true, entry_id: ENTRY, entry_no: 'MJ/2026-27/1', posting_date: DAY, doc_date: DAY, moved: null, lines: 2, items: 0, note: null }; /* writeJournal :452 */
const JOURNAL_MOVED = Object.assign({}, JOURNAL, { doc_date: '2026-09-28', moved: { from: '2026-09-28', to: DAY }, items: 1, note: 'Posted on the first open day.' });
const DUPLICATE = { ok: true, duplicate: true, entry_id: ENTRY, entry_no: 'MJ/2026-27/1', posting_date: DAY }; /* postEntry :239, the replay of a client_ref */
const OFF = { ok: false, off: true }; /* postEntry :233 */
const REVERSAL = { ok: true, entry_id: ENTRY2, entry_no: 'MJ/2026-27/2', posting_date: DAY, moved: null, reverses: 'MJ/2026-27/1', reverses_entry_id: ENTRY, items: 0, reopened: [], words: 'Reversed MJ/2026-27/1.' }; /* writeReversal :1434 */
const REVERSAL_REOPENS = Object.assign({}, REVERSAL, { items: 1, reopened: [{ against_ref: 'bill:1', bill_no: 'B/1' }] });
const ALLOCATION = { ok: true, items: 2, allocated_minor: 1000 }; /* writeAllocation :1174 */
const CHEQUE = (to, extra) => Object.assign({ ok: true, status: to, items: 1 }, extra); /* writeChequeStep :1229 */
const PROPOSAL = { currency: 'INR', account_id: PARTY, items: [], outstanding: { by_ref: {} }, open_minor: 0, proposal: [], apply_minor: 0, on_account_minor: 1000, skipped: [], why: null }; /* proposeFor :706 */
const PROPOSAL_SETTLES = Object.assign({}, PROPOSAL, { items: [{ ref: 'bill:1' }], open_minor: 1500, proposal: [{ against_ref: 'bill:1', bill_no: 'B/1', due_date: DAY, open_minor: 1500, apply_minor: 1000, disputed: false }], apply_minor: 1000, on_account_minor: 0, skipped: [{ against_ref: 'bill:2', why: 'disputed' }] });
/** adviceFor :1110 — may send (on the rail, nothing sent) or may share (off the rail, or already sent) */
const ADVICE = (sendOk) => ({
  payment_id: PARTY,
  party: { party_id: PARTY, name: 'Asha', on_rail: sendOk },
  advice: { chit_id: sendOk ? null : CHIT, state: sendOk ? 'none' : 'sent', shared_at: sendOk ? null : '2026-09-30T10:00:00.000Z' },
  may: sendOk ? { send_advice: { ok: true }, share_advice: { ok: false, why: 'on_rail', say: 'They are on ChitBridge.' } } : { send_advice: { ok: false, why: 'already_sent', say: 'An advice is already sent.' }, share_advice: { ok: true } },
  words: 'Paid Rs 10.00 by cheque.',
  body: sendOk ? { kind: 'payment_advice', to: PARTY } : null,
  share: sendOk ? null : { text: 'Paid Rs 10.00', wa: 'https://wa.me/?text=x', mailto: 'mailto:?body=x' }
});
const RECORDED = { payment: { payment_id: PARTY, status: 'recorded', duplicate: false }, posted: JOURNAL, allocation: null }; /* recordPayment :1332 */
const RECORDED_SETTLES = Object.assign({}, RECORDED, { allocation: { settled: [{ against_ref: 'bill:1', bill_no: 'B/1', amount_minor: 1000 }], items: 2, allocated_minor: 1000 } });
const REPLAY = { payment: { payment_id: PARTY, status: 'cheque_received', duplicate: true }, posted: { ok: true, duplicate: true } }; /* firstPayment :1259 */
const OUTCOME = { words: 'Paid.', settled: [], applied_minor: 0, on_account_minor: 1000, balance_minor: -1000, balance_words: 'They hold an advance.' }; /* paymentOutcome :1158 */
const ENABLED = { ok: true, accounts_added: 40, fiscal_year: '2026-27', parties_numbered: 0 }; /* enable :1546 */
const RETRIED = { tried: 2, posted: 1, still: 1 }; /* books-hooks retryOutbox :1632 */
const CHART = [
  { account_id: PARTY, code: '1300', name: 'Debtors', nature: 'asset', role: 'debtors', is_group: false, parent_id: null, tally_group: 'Sundry Debtors', active: true },
  { account_id: ENTRY, code: '4000', name: 'Income', nature: 'income', role: null, is_group: true, parent_id: null, tally_group: 'Sales', active: true }
];
const LEDGER_LINE = { posting_date: DAY, doc_date: DAY, narration: 'Sale', event_type: 'sale_bill', entry_no: 'S/1', entry_id: ENTRY, reverses_entry_id: null, reversed_by: null, source_chit_id: CHIT, party_id: PARTY, dr_minor: '1000', cr_minor: '0', period: 6, covers: 0, source_ref: null, src_chit_id: CHIT, src_ref: 'B/1', src_by: null, src_by_name: 'Asha', src_till: null, counter_id: null };
const LEDGER_LINE_BARE = Object.assign({}, LEDGER_LINE, { doc_date: null, narration: null, event_type: 'manual', entry_no: 'MJ/1', entry_id: ENTRY2, source_chit_id: null, party_id: null, dr_minor: '0', cr_minor: '1000', src_chit_id: null, src_ref: null, src_by_name: null });
const LEDGER_PATCH = { store: { accounts: async () => CHART, entryLines: async () => [LEDGER_LINE, LEDGER_LINE_BARE] }, books: { ledgerOf: async () => ({ opening_minor: 0, period0: false }) }, evidence: { attach: async () => {} } };
const LEDGER_PAGE_PATCH = { store: Object.assign({}, LEDGER_PATCH.store, { entryPage: async () => ({ rows: [LEDGER_LINE], limit: 10, next: null }), pageSums: async () => ({ before_dr: 0, before_cr: 0, dr: 1000, cr: 0, entries: 1 }) }), books: LEDGER_PATCH.books, evidence: LEDGER_PATCH.evidence };
const packIN = () => require(path.join(HERE, 'lib', 'books-engines')).packs().packFor('IN');
const ASSET_DISPOSED = { entity: SHOP, asset_id: PARTY, name: 'Press', asset_class: 'plant', cost_minor: 100000, currency: 'INR', put_to_use: '2025-04-01', source_entry_id: ENTRY, source_chit_id: null, accumulated_minor: 20000, last_dep_fy: '2025-26', disposed_on: DAY, disposal_entry_id: ENTRY, proceeds_minor: 0, created_by: SHOP, wdv_minor: 0 };
const COMPARE_READY = { store: { compareReady: async () => true } };
const COMPARE_PATCH = { store: { compareReady: async () => true, compareParts: async () => [{ snapshot_id: PARTY, part: 'tb', label: 'Tally Q2', source: 'tally', period_from: '2026-07-01', period_to: '2026-09-30', rows: [] }] } };
const STATEMENT_PATCH = { books: { ledgerCtx: async () => ({ s: SETTING_ROW, chart: CHART, pack: packIN(), years: [], cache: {} }), yearBalances: async () => ({}) }, store: { ledgerLines: async () => [], entryLines: async () => [] } };
const MANUAL_PREVIEW = { ok: true, kind: 'expense', voucher: { series: 'MJ', type: 'Journal' }, date: DAY, lines: [{ code: '5000', ledger: 'Rent', dr_minor: 1000, cr_minor: 0, type: 'expense', rule: 'expense' }], balanced: true, totals: { dr_minor: 1000, cr_minor: 1000 }, credit: null, bill: null, flags: [], refusals: [], code: null, duplicate: null }; /* books-manual preview :483 */
const SHOP_TERMS = { credit_days: 30, credit_limit_minor: null, interest: null, early: null };
const PAID = { party_id: PARTY, amount_minor: 1000, mode: 'cash' };
const PAYMENT_PATCH = (recorded) => ({ books: { recordPayment: async () => recorded, paymentOutcome: async () => OUTCOME, adviceFor: async () => ADVICE(true) }, store: { adviceReady: async () => true, payment: async () => PAY_ROW } });
const ADVICE_PATCH_READY = (sendOk, set) => ({ store: { payment: async () => PAY_ROW, adviceReady: async () => true, setAdvice: async () => set, adviceStates: async () => ({ [CHIT]: 'sent' }) }, books: { adviceFor: async () => ADVICE(sendOk) } });
const OPENING_REFUSAL = (words, code) => Object.assign(new Error(words), { code, refused: true });
const OPENING_PREVIEW = { currency: 'INR', date: DAY, debit_minor: 1000, credit_minor: 0, difference_minor: 1000, side: 'cr', bills: [], refusals: [], can_save: false };
const OPENING_SAVED = { date: DAY, dates: [DAY], default_date: DAY, currency: 'INR', pinned: [], entries: [], lines: [], suspense_minor: 0 };
const OPENING_CHANGE = { rows: [{ code: '1500', dr_minor: 1000 }, { code: '3000', cr_minor: 1000 }], date: DAY, reason: 'typing slip', client_ref: 'grid:c1' };
  /** FW2-03: POST /api/books/evidence (a receipt beside an entry: the owner, an editor, an adviser under a grant): lib/books-evidence-attach.put answers { ok } or { refuse } in the attachments contract's words; the scenarios of the 200, each refusal status and the missing file */
  const EV_BODY = { entry_id: ENTRY, name: 'receipt.png', data_base64: 'iVBORw0KGgo=' };
  const EV_REFUSES = (status, word) => ({ bea: { put: async () => ({ refuse: Object.assign({ status }, require(path.join(HERE, 'lib', 'attachments-contract')).words[word]()) }) } });
  const EVIDENCE_ROWS = (X) => [
    X('evidence-attached', 'POST /api/books/evidence', 200, { body: EV_BODY, patch: { bea: { put: async () => ({ ok: { id: PARTY, name: 'receipt.png', mime: 'image/png', size: 48, entry_id: ENTRY } }) } } }),
    ...[['seat', 403, 'notEntrySeat'], ['entry-not-here', 404, 'entryNotFound'], ['too-large', 413, 'tooLarge'], ['wrong-type', 415, 'typeNotAllowed'], ['not-ready', 503, 'entryNotReady']].map(([name, status, word]) => X('evidence-' + name, 'POST /api/books/evidence', status, { body: EV_BODY, patch: EV_REFUSES(status, word) })),
    X('evidence-fields-missing', 'POST /api/books/evidence', 400, { body: { entry_id: ENTRY, mime: 'image/png' } })
  ];
  return { EVIDENCE_ROWS, RAIL_STOP, RETURN_BASE, RETURN_READY, RETURN_NEEDS, REVALUE_READY, ENTRY, ENTRY2, CHIT, DAY, ATTENTION_COUNTS, ATTENTION_ENTRIES, ATTENTION_PATCH, BILL_LATE, BILL_QUIET, PARTY_BILLS, BILLS_PATCH, PAY_ROW, JOURNAL, JOURNAL_MOVED, DUPLICATE, OFF, REVERSAL, REVERSAL_REOPENS, ALLOCATION, CHEQUE, PROPOSAL, PROPOSAL_SETTLES, ADVICE, RECORDED, RECORDED_SETTLES, REPLAY, OUTCOME, ENABLED, RETRIED, CHART, LEDGER_LINE, LEDGER_LINE_BARE, LEDGER_PATCH, LEDGER_PAGE_PATCH, packIN, ASSET_DISPOSED, COMPARE_READY, COMPARE_PATCH, STATEMENT_PATCH, MANUAL_PREVIEW, SHOP_TERMS, PAID, PAYMENT_PATCH, ADVICE_PATCH_READY, OPENING_REFUSAL, OPENING_PREVIEW, OPENING_SAVED, OPENING_CHANGE };
};
