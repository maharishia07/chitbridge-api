/**
 * e2e/lib/books-api.cjs — THE CB ACCOUNTS ANSWERS A STAND-IN SERVES, AS chitbridge-api SENDS THEM (routes/books.js).
 *
 * Every harness that answers a /api/books call with a few fields of its own used to invent the shape (a health with no `currency`, a statement with no
 * `from`). The contract (e2e/fixtures/web-api.contract.json) says what the API really sends; these builders return ALL of it, with the harness's own
 * values on top: books.health({ waiting: [..] }). e2e/lib/contract.cjs holds whatever a harness serves to the contract, builders or not.
 */
'use strict';
const TD = require('./today.cjs');
const ENGINES = { posting: 'injected', packs: 'injected', receivables: 'injected', ledger: 'injected', bookpack: 'injected', period: 'injected' };

/** GET /api/books/health */
/* only the API's keys: a harness's own bookkeeping on the row (stuck, last_posted_day …) stays in the harness, it is not part of the answer */
const only = (defaults, o) => { const out = Object.assign({}, defaults); Object.keys(o || {}).forEach((k) => { if (k in defaults) out[k] = o[k]; }); return out; };
/* year (WX-R2R) + country (CX2) — ONE /health shape (INT5b): the shop's financial year as the server defaults its reads, and the CS1 status the
   books gate read — an Indian shop on an April year unless the harness says otherwise */
const csStatus = (code, name) => ({ books: true, code: null, why: null, required: false, country: { code: code, name: name }, pack: code, version: '1.0.0' });
/* STD1: the waiting list is a page (limit 50) with its total, and `todo` is the server's ONE count (GROUP BY over every open row) — the stand-in
   counts its rows' own `todo` unless the harness gives the counts (a shop with more rows than the page says so) */
const healthCounts = (rows) => rows.reduce((a, w) => { const k = w && ['accept', 'add_supplier', 'record'].indexOf(w.todo) >= 0 ? w.todo : 'record'; a.todo[k]++; a.total++; return a; },
  { total: 0, page: 1, limit: 50, todo: { accept: 0, add_supplier: 0, record: 0 } });
const health = (o) => { const h = only({ enabled: true, currency: 'INR', country: csStatus('IN', 'India'), walkin_grain: 'day', last_check: null, engines: ENGINES, year: { fiscal_year: '2026-27', from: '2026-04-01', start_month: 4 }, waiting: [],
  total: 0, page: 1, limit: 50, todo: { accept: 0, add_supplier: 0, record: 0 } }, o); const c = healthCounts(h.waiting || []);
  if (!(o && 'total' in o)) h.total = c.total; if (!(o && 'todo' in o)) h.todo = c.todo; return h; };
/** GET /api/books/party/:id/statement */
/* M29: every line also names its entry (entry_id · entry_no · event_type), its reversal (reverses_entry_id · reversed_by · reversed_why) and, on a payment line, payment_id · unapplied_minor · advice — null = not a payment / not reversed */
const statement = (partyId, o) => { const s = Object.assign({ currency: 'INR', party_id: partyId, from: '2026-04-01', to: '2026-10-03', code: '1300', opening_minor: 0, closing_minor: 0, lines: [] }, o || {}); s.lines = s.lines.map((l) => Object.assign({ ref: null, source_chit_id: null, entry_id: null, entry_no: null, event_type: null, reverses_entry_id: null, reversed_by: null, reversed_why: null, payment_id: null, unapplied_minor: null, advice: null }, l, { source: l.source ? Object.assign({ chit_id: null, ref: null, kind: 'bill', counter: null, by: null, count: null, how: null, how_ref: null, split: null, doc_at: null, recorded_at: '2026-10-03T05:00:00.000Z' }, l.source) : null })); return s; };
/** one row of GET /api/books/dues (balance_minor: + they owe you) */
/* balance_words: the api adds the standing in words to each row (routes/books.js withBalanceWords → owesWords); a row that names its own keeps it */
/* the one ageing (W15-94): a stand-in row carries follow_up like the api; unless the case names one, the money not 'not_due' is put in 31–60 days */
const followOf = (b) => { const late = Object.keys(b).filter((k) => k !== 'not_due').reduce((s, k) => s + Math.abs(b[k] || 0), 0); return { not_due: Math.abs(b.not_due || 0), d0_30: 0, d31_60: late, d61_90: 0, d90_plus: 0, worst: late ? 'd31_60' : null, no_terms_minor: 0, terms: 'ok' }; };
/* the Needs-attention counts the api puts on every row and, per side, on the answer (the contract's `needs`): none waiting unless the case names them */
const noNeeds = () => ({ parties: 0, bills: 0, disputed: 0, query: 0, held: 0, no_tax_invoice: 0, no_terms: 0, overdue: 0, overdue_minor: 0 });
const dueRow = (o) => { const row = Object.assign({ party_no: 'P-00001', name: 'Party', party_id: 'pid', side: 'customer', balance_minor: 0, oldest_due: null, disputed_minor: 0 }, o || {}, { buckets: Object.assign({ not_due: 0, y1_2: 0, y2_3: 0, gt_3y: 0 }, (o && o.side === 'supplier') ? { lt_1y: 0 } : { lt_6m: 0, m6_1y: 0 }, (o && o.buckets) || {}) }); if (row.follow_up === undefined) row.follow_up = followOf(row.buckets); if (row.balance_words === undefined) row.balance_words = owesWords(row.balance_minor); if (row.needs === undefined) row.needs = noNeeds(); return row; };
/** GET /api/books/dues */
const dues = (parties, o) => Object.assign({ currency: 'INR', asOf: '2026-10-03', needs: { customer: noNeeds(), supplier: noNeeds() }, parties: (parties || []).map(dueRow), total_minor: (parties || []).reduce((t, p) => t + (p.balance_minor || 0), 0), aged_totals: { customer: { not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, worst: null, no_terms_minor: 0, terms: 'ok', balance_minor: 0 }, supplier: null } }, o || {});
/** one row of GET /api/books/periods */
const periodRow = (fy, period, status) => ({ entity_id: 'ent-M', status: status || 'open', fiscal_year: fy, period, start_date: '2026-04-01', end_date: '2026-04-30', entries: 0, sales_minor: 0, lock: { may: true, why: '' }, reopen: { may: false, why: null }, lock_trail: [] });   /* lock_trail: api #910 ACC-240 sends the lock, unlock and relock trail on every month */
/** GET /api/books/periods */
/* the api always names the year under review and lists the years (PERIOD, l17): a stand-in that has no case says the shop's current year and no years */
const periods = (rows, o) => Object.assign({ under_review: { fy: '2026-27', from: '2026-04-01', to: '2027-03-31' }, years: [], periods: rows || [] }, o || {});
module.exports = { ENGINES, health, csStatus, statement, dues, dueRow, periods, periodRow };

/* ── the period-end answers ── */
const DAY = TD.TODAY;
/** what every posting route answers beside its own keys: the entry made (lib/books postEntry → { ok, entry_id, entry_no, posting_date, doc_date, moved, lines, items, note }) */
const posted = (o) => Object.assign({ ok: true, entry_id: 'e1', entry_no: 'MJ/26-27/0001', posting_date: DAY, doc_date: DAY, moved: false, lines: 2, items: 0, note: null }, o || {});
/** the `source` of a day book entry or a ledger line (routes/books.js sourceOf): ALL these keys when there is one, null when the entry has no source chit */
const source = (o) => (o ? Object.assign({ chit_id: null, ref: null, kind: 'bill', counter: null, by: null, count: null, bills: null, how: null, how_ref: null, split: null, doc_at: null, recorded_at: '2026-10-03T05:00:00.000Z' }, o) : null);
/** GET /api/books/ledger/:account */
const ledger = (code, name, lines, o) => Object.assign({ currency: 'INR', account: { code, name, nature: 'asset' }, party: null, from: '2026-04-01', to: DAY, opening_minor: 0,
  lines: (function () { let run = (o && o.opening_minor) || 0; return (lines || []).map((l) => { run += (l.dr_minor || 0) - (l.cr_minor || 0); return Object.assign({ doc_date: l.date, party_id: null, running_minor: run,
    /* PERF1: a ledger line reads its own entry — entry_id · entry_no · event_type · the reversal pair (the API's keys, null when none) */
    entry_id: l.entry_id || ('e-' + (l.ref || l.date)), entry_no: l.entry_no || l.ref || null, event_type: l.event_type || null,
    reverses_entry_id: null, reversed_by: null, evidence: { doc: null, files: [], count: 0, flag: null }, other: null, party_name: null }, l, { source: source(l.source) }); }); })(), closing_minor: 0 }, o || {});
/** one asset register row (lib/books-assets) */
const assetRow = (o) => Object.assign({ entity: 'ent-M', asset_id: 'a1', name: 'Asset', asset_class: 'furniture', cost_minor: 0, currency: 'INR', put_to_use: DAY, source_entry_id: 'e1', source_chit_id: null,
  accumulated_minor: 0, last_dep_fy: null, disposed_on: null, disposal_entry_id: null, proceeds_minor: null, created_by: 'u1', wdv_minor: 0 }, o || {});
/** one repeating-entry template (lib/books-recurring) */
const recRow = (o) => Object.assign({ entity: 'ent-M', recurring_id: 'r1', name: 'Template', event: { kind: 'expense', class: 'rent', amount_minor: 100, paid_from: 'bank' }, frequency: 'monthly', next_on: DAY,
  anchor_day: 1, end_on: null, auto: false, active: true, last_done_on: null, created_by: 'u1', due: false }, o || {});
/** GET /api/books/todo rows always carry items and the action's call */
const todoRow = (x) => Object.assign({ items: [] }, x, { action: Object.assign({ call: 'GET /api/books/health' }, x.action || {}) });
/** GET /api/books/events: every event carries preview/post/ledger_group, every field `required` */
const eventsAnswer = (a) => Object.assign({ pending: [], golden: { personal: { dr: 'Dr the receiver', cr: 'Cr the giver' }, real: { dr: 'Dr what comes in', cr: 'Cr what goes out' }, nominal: { dr: 'Dr expenses and losses', cr: 'Cr incomes and gains' } } }, a, {
  events: (a.events || []).map((e) => Object.assign({ preview: true, post: 'POST /events', ledger_group: null, words: e.kind, icon: 'pen', band: 'adjust' }, e, e.fields ? { fields: e.fields.map((f) => Object.assign({ required: false }, f)) } : {})),
  picks: Object.assign({ mode: [], expense_class: [], income_class: [], blocked_credit: [], debit_reason: [] }, a.picks) });
/** the refusal body of a 4xx the page shows: { error, message } and a code when the API gives one */
const refusal = (msg, code) => Object.assign({ error: msg, message: msg }, code ? { code } : {});
/** GET /api/books/daybook */
const daybook = (entries, o) => Object.assign({ currency: 'INR', country: 'IN', from: DAY, to: DAY, entries: entries || [], count: (entries || []).length }, o || {});
/** a day book entry with every key the API sends (a missing doc_date is the posting date, no reversal, a line with no party / counter / rate says so) */
/* 17 Nov: the api now sends no_narration (a person wrote none) and recorded_at on EVERY day-book entry (routes/books.js daybook), and the shop's country on the answer */
const entry = (e) => Object.assign({ evidence: { doc: null, files: [], count: 0, flag: null }, posted_by: null, made_by: null, may_reverse: false, why: null, no_narration: false, recorded_at: '2026-10-03T05:00:00.000Z', doc_date: e.posting_date, reverses_entry_id: null, reversed_by: null, reversed_by_id: null }, e, { source: source(e.source), lines: (e.lines || []).map((l) => Object.assign({ party_id: null, party_name: null, counter: null, rate: null }, l)) });
/** GET /api/books/returns for a country whose return is not made from these books (India: GSTR-1 / 3B come from the bills, via the rail) - the contract's `GET /api/books/returns #rail` answer, every key */
const returnsRail = (o) => Object.assign({ form: null, pack: 'IN', code: 'RETURN_FROM_RAIL', why: "Your GSTR-1 and GSTR-3B are made from your bills, not from these books. Close and pay the month's GST here.", rail: '/api/tax/gstr' }, o || {});
/** the period answer of POST /periods/:fy/:p/lock|unlock */
const lockAnswer = (fy, period, status) => ({ ok: true, period: { fiscal_year: fy, period, status } });
Object.assign(module.exports, { entry, lockAnswer, source, posted, ledger, assetRow, recRow, todoRow, eventsAnswer, refusal, daybook, returnsRail });

/* ── the reads of the books ── */
/** one post waiting for the owner (lib/books-hooks waitingRow) */
/* STD1: `todo` (accept · add_supplier · record) and `name` are the row's DATA (the books parked them) — the harness says them; never read from `reason` */
/* R106: `short` = { theirs_minor, ours_minor, short_minor } (integers) when their bill is above the count, else null (FIELDS waiting[].short) */
const waitingRow = (o) => only({ id: 1, chit_id: null, ref: null, reason: 'Waiting', tries: 0, since: '2026-10-03T05:00:00.000Z', job: 'chit', todo: 'record', name: null, short: null, candidates: [], source: { chit_id: null, ref: null, kind: 'chit', counter: null, by: null } }, o);
/** GET /api/books/trial-balance */
const trialBalance = (rows, o) => { const r = (rows || []).map((x) => Object.assign({ group: 'group' }, x)); const dr = r.reduce((t, x) => t + (x.dr_minor || 0), 0), cr = r.reduce((t, x) => t + (x.cr_minor || 0), 0);
  return Object.assign({ currency: 'INR', asOf: DAY, rows: r, total_dr_minor: dr, total_cr_minor: cr, balanced: dr === cr }, o || {}); };
/** GET /api/books/pl */
const pl = (income, expense, o) => { const inc = (income || []).map((x) => Object.assign({ line: 'Revenue from operations' }, x)), exp = (expense || []).map((x) => Object.assign({ line: 'Other expenses' }, x));
  const ti = inc.reduce((t, x) => t + x.amount_minor, 0), te = exp.reduce((t, x) => t + x.amount_minor, 0);
  return Object.assign({ currency: 'INR', from: '2026-04-01', to: DAY, income: inc, expense: exp, total_income_minor: ti, total_expense_minor: te, profit_minor: ti - te, by_line: { income: [], expense: [] }, gross_profit: null, over_rule: null, profit_share_bp: null, total_income_share_bp: null, total_expense_share_bp: null, period: null, presets: [], compare: null /* 17 Nov: the api sends these on every P&L; null = nothing to show */ }, o || {}); };
/** GET /api/books/bs */
const bs = (assets, liabilities, equity, o) => { const a = (assets || []).map((x) => Object.assign({ line: 'Trade receivables' }, x)), l = (liabilities || []).map((x) => Object.assign({ line: 'Trade payables' }, x)), e = (equity || []).map((x) => Object.assign({ line: 'Reserves and surplus' }, x));
  const ta = a.reduce((t, x) => t + x.amount_minor, 0), tl = l.concat(e).reduce((t, x) => t + x.amount_minor, 0);
  return Object.assign({ currency: 'INR', asOf: DAY, assets: a, liabilities: l, equity: e, total_assets_minor: ta, total_liab_equity_minor: tl, profit_to_date_minor: 0, balanced: ta === tl, by_line: { assets: [], liabilities: [] },
    schedule_iii: { equity_and_liabilities: { heads: [], total_minor: tl }, assets: { heads: [], total_minor: ta }, balanced: ta === tl, difference_minor: ta - tl } }, o || {}); };
/** POST /api/books/enable */
const enable = (o) => Object.assign({ ok: true, accounts_added: 80, fiscal_year: '2026-27', parties_numbered: null }, o || {});
/** one account of GET /api/books/accounts */
const accountRow = (o) => Object.assign({ account_id: 'acc', code: '1000', name: 'Account', is_group: false, tally_group: 'Group', nature: 'asset', role: null, parent_code: null, active: true }, o || {});
/* GET /api/books/cheques (T3-P1-MONEY shape): the cheques in hand, the post-dated reminders and the owner's switch — the contract's keys, asOf = the one injected today */
const cheques = (o) => Object.assign({ currency: 'INR', asOf: DAY, cheques: [], pdc_reminders: [], remind: { on: true, lead_days: 7, from: null, may_set: true, why_not: null } }, o || {});
Object.assign(module.exports, { waitingRow, trialBalance, pl, bs, enable, accountRow, cheques });

/* ── payments (M26, chitbridge-api #57): the preview, the one-call record, the 409 ── */
const rs = (minor) => { const v = minor / 100; return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); };
/** the api's owesWords (lib/books.js), in the stand-in's rupee format */
const owesWords = (minor) => (!minor ? 'settled' : (minor > 0 ? 'they owe you ' + rs(minor) : 'you owe ' + rs(-minor)));
/** the oldest-due-first proposal: bills = [{ against_ref, bill_no, due_date, open_minor, disputed }] (open ones), amount_minor → { proposal, apply_minor, on_account_minor, open_minor } */
const payProposal = (bills, amount_minor) => {
  let left = amount_minor;
  const open = (bills || []).filter((b) => b.open_minor > 0).slice().sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || String(a.against_ref).localeCompare(String(b.against_ref)));
  const proposal = open.map((b) => { const a = b.disputed ? 0 : Math.min(left, b.open_minor); left -= a; return { against_ref: b.against_ref, bill_no: b.bill_no, due_date: b.due_date, open_minor: b.open_minor, due_minor: b.due_minor != null ? b.due_minor : b.open_minor, apply_minor: a, disputed: !!b.disputed }; });
  return { proposal, apply_minor: amount_minor - left, on_account_minor: left, open_minor: open.reduce((t, b) => t + b.open_minor, 0) };
};
/**
 * POST /api/books/payments/preview — as lib/books.js duplicateWarnings answers it:
 *   W1 nothing_owed  open == 0 AND the body means to settle bills (allocate 'oldest_first' or allocations) — owner 2026-10-08: not otherwise
 *   W2 excess        amount > open, unless allocate 'none'        W3/W4: pass them in o.extra (they read the shop's last 24 h, which only the harness knows)
 */
const payWarnings = (prop, body, name, o) => {
  const W = [], allocating = body.allocate === 'oldest_first' || (Array.isArray(body.allocations) && body.allocations.length > 0), out = body.direction === 'out';
  if (prop.open_minor === 0) { if (allocating) W.push({ code: 'nothing_owed', words: 'Nothing is owed ' + (out ? 'to ' : 'by ') + name + '.' }); }
  else if (body.allocate !== 'none' && body.amount_minor > prop.open_minor)
    W.push({ code: 'excess', words: rs(body.amount_minor) + ' is more than the ' + rs(prop.open_minor) + ' open — ' + rs(body.amount_minor - prop.open_minor) + (out ? ' would stay with ' + name + ' as an advance.' : ' would be kept as an advance from ' + name + '.') });
  return W.concat((o && o.extra) || []);
};
const payPreview = (bills, body, name, o) => {
  const prop = payProposal(bills, body.amount_minor), n = prop.proposal.filter((p) => p.apply_minor > 0).length, parts = [];
  if (n) parts.push(rs(prop.apply_minor) + ' settles ' + n + (n === 1 ? ' bill' : ' bills'));
  if (prop.on_account_minor > 0) parts.push(rs(prop.on_account_minor) + (body.direction === 'out' ? ' stays with ' + name + ' as an advance' : ' is kept as an advance from ' + name));
  return { currency: 'INR', party: { party_id: body.party_id, name, on_rail: !(o && o.on_rail === false) }, open_minor: prop.open_minor, proposal: prop.proposal, apply_minor: prop.apply_minor, on_account_minor: prop.on_account_minor,
    skipped: [], why: null, warnings: payWarnings(prop, body, name, o), words: parts.join(' · ') || 'Nothing to settle' };
};
/** the 409 a warning not named in acknowledge[] gets (nothing written) */
const alreadyPaid = (warnings, body) => ({ code: 'ALREADY_PAID', error: 'Already paid?', message: 'Already paid? ' + warnings.map((w) => w.words).join(' ')
  + (warnings.some((w) => w.code === 'nothing_owed' || w.code === 'excess') ? ' ' + (body.direction === 'out' ? 'Pay ' : 'Receive ') + rs(body.amount_minor) + ' again as an advance?' : ''), warnings });
/** the 200 of POST /payments: allocations = the list the body gave, else oldest first (allocate 'oldest_first'), else none. entry_no/payment_id/balance_minor from the harness. */
const payRecorded = (bills, body, name, o) => {
  o = o || {};
  const cheque = body.mode === 'cheque', noBills = cheque || body.allocate === 'none';
  const list = noBills ? [] : (Array.isArray(body.allocations) && body.allocations.length ? body.allocations
    : payProposal(bills, body.amount_minor).proposal.filter((p) => p.apply_minor > 0).map((p) => ({ against_ref: p.against_ref, amount_minor: p.apply_minor })));
  const no = (ref) => ((bills || []).find((b) => b.against_ref === ref) || {}).bill_no || null;
  const settled = list.map((a) => ({ against_ref: a.against_ref, bill_no: no(a.against_ref), amount_minor: a.amount_minor })), applied = settled.reduce((t, s) => t + s.amount_minor, 0);
  const on_account = cheque ? 0 : body.amount_minor - applied, out = body.direction === 'out', HOW = { cash: 'cash', upi: 'by UPI', bank: 'by bank', card: 'by card', cheque: 'by cheque' };
  let words = (out ? 'Paid ' : 'Received ') + rs(body.amount_minor) + ' ' + HOW[body.mode] + (out ? ' to ' : ' from ') + name + '.';
  if (cheque) words += ' Held until it clears — the bills are chosen then.';
  else if (settled.length) words += ' Settled ' + settled.length + (settled.length === 1 ? ' bill' : ' bills') + ' (' + rs(applied) + ').';
  if (on_account > 0) words += ' ' + rs(on_account) + (out ? ' left with ' + name + ' as an advance — they owe you this.' : ' kept as an advance from ' + name + ' — you owe them this.');
  const bal = o.balance_minor == null ? 0 : o.balance_minor;
  return { ok: true, payment: { payment_id: o.payment_id || 'pay1', status: cheque ? 'cheque_received' : 'recorded', duplicate: false },
    posted: posted({ entry_no: o.entry_no || 'PY/2026-27/000001' }), allocation: settled.length ? { settled: list, ok: true, items: settled.length * 2, allocated_minor: applied } : null,
    outcome: { words, settled, applied_minor: applied, on_account_minor: on_account, balance_minor: bal, balance_words: bal ? (bal > 0 ? 'they owe you ' : 'you owe ') + rs(Math.abs(bal)) : 'settled' },
    /* M30: the advice block rides on the record (payAdvice below); a harness without one sends null — the contract takes null as "not decided here" */
    advice: o.advice === undefined ? null : o.advice };
};
Object.assign(module.exports, { rs, payProposal, payWarnings, payPreview, alreadyPaid, payRecorded });

/* ── M30 · the payment advice OUT (chitbridge-api #60): the block on POST /payments (`advice`), GET /payments/:id/advice, PATCH /payments/:id ── */
const NO_SAY = { off_rail: (n) => n + ' is not on ChitBridge — share the advice instead.', on_rail: (n) => n + ' is on ChitBridge — send the advice instead.', already_sent: () => 'An advice is already sent for this payment.' };
const adviceNo = (why, name) => ({ ok: false, why, say: NO_SAY[why] ? NO_SAY[why](name) : why });
/** may, as lib/books.js adviceMay answers for a recorded, posted payment: send on rail · share off rail · both refused once sent */
const adviceMay = (name, o) => { const on = o.on_rail !== false, sent = /^(sent|delivered|disputed)$/.test(o.state || '');
  return { send_advice: sent ? adviceNo('already_sent') : on ? { ok: true } : adviceNo('off_rail', name), share_advice: sent ? adviceNo('already_sent') : on ? adviceNo('on_rail', name) : { ok: true } }; };
/**
 * the advice block (routes/books.js adviceFor): body = the payment as POST /payments took it; o = { on_rail, state, chit_id, shared_at, entry_no, settled: outcome.settled, me }
 * The words are the API's sentence shape ("<shop> paid you ₹2,000 cash on 5 Oct 2026 for bills KT-0007, KT-0008 (₹1,680) · ₹320 as an advance."); a harness that
 * asserts on them passes its own.
 */
const payAdvice = (payment_id, body, name, o) => {
  o = o || {}; const on = o.on_rail !== false, me = o.me || 'Mayur Bhavan', out = body.direction !== 'in', settled = o.settled || [], applied = settled.reduce((t, s) => t + s.amount_minor, 0);
  const on_account = Math.max(0, body.amount_minor - applied), HOW = { cash: 'cash', upi: 'by UPI', bank: 'by bank', card: 'by card', cheque: 'by cheque' };
  let words = o.words || (me + (out ? ' paid you ' : ' received ') + rs(body.amount_minor) + ' ' + (HOW[body.mode] || body.mode) + (out ? '' : ' from you') + ' on 5 Oct 2026'
    + (settled.length ? ' for ' + (settled.length === 1 ? 'bill ' : 'bills ') + settled.map((s) => s.bill_no || s.against_ref).join(', ') + ' (' + rs(applied) + ')' : '')
    + (on_account > 0 ? ' · ' + rs(on_account) + ' as an advance' : '') + '.');
  const may = o.may || adviceMay(name, o), entry_no = o.entry_no || 'PY/2026-27/000001';
  const chit = may.send_advice.ok ? { recipients: [{ entity_id: body.party_id, role: 'to' }], purpose: 'general', manual_subject: 'Payment advice ' + entry_no, client_ref: 'advice:pay:' + payment_id,
    line_items: settled.map((s) => ({ particulars: 'Bill ' + (s.bill_no || s.against_ref), quantity: 1, unit: 'bill', price: s.amount_minor / 100, total: s.amount_minor / 100, currency: 'INR', ref_chit_id: s.against_ref, bill_no: s.bill_no || null, applied: s.amount_minor / 100, applied_minor: s.amount_minor })),
    business_json: { kind: 'payment_advice', currency: 'INR', payment_advice: { action: out ? 'paid' : 'received', adviser_payment_id: payment_id, adviser_entry_no: entry_no, amount: body.amount_minor / 100, amount_minor: body.amount_minor, currency: 'INR',
      mode: body.mode, reference: body.reference || null, paid_on: '2026-10-05', applied_minor: applied, on_account: on_account / 100, on_account_minor: on_account, collected_by: null, reverses_advice_chit_id: null, words } } } : null;
  const share = may.share_advice.ok ? { text: words, wa: 'https://wa.me/?text=' + encodeURIComponent(words), mailto: 'mailto:?subject=' + encodeURIComponent('Payment advice ' + entry_no + ' — ' + me) + '&body=' + encodeURIComponent(words) } : null;
  return { payment_id, party: { party_id: body.party_id, name, on_rail: on }, advice: { chit_id: o.chit_id || null, state: o.state || 'none', shared_at: o.shared_at || null }, may, words, body: chit, share };
};
/** PATCH /api/books/payments/:id → the row after the merge-patch */
const payPatched = (payment_id, advice) => ({ ok: true, payment_id, advice: Object.assign({ chit_id: null, state: 'none', shared_at: null }, advice || {}) });
Object.assign(module.exports, { adviceMay, payAdvice, payPatched });
