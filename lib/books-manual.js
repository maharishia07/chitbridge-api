// @stage tested
// @stage-note [BOOKS v2] The "＋ Entry" events — what the owner keys in by hand: expense, other income, capital, drawings, staff advance. One builder each; the preview and the writer share it.
'use strict';
/**
 * lib/books-manual.js — THE EVENTS A PERSON KEYS IN (docs/design/manual-entry/REQUIREMENT.md; CLOUD-TASK-api.md).
 *
 * ⭐ ONE COMPOSITION. An event here is only a BUILDER: a typed request → the posting engine's own event (`expense`, `other_income`, `manual`,
 *   `contra`). Both doors then call lib/books.js — POST /events → postEntry, POST /preview → previewEntry — and BOTH run composeEntry, so the
 *   lines the screen shows are the lines that post. Nothing here computes a debit, a credit or a rupee of tax.
 * ⭐ TAX IS THE TAX ENGINE'S. A bill's lines go through tax-lines.invoiceFor (→ tax.determine → splitLineTax / lineHeads) and come back as
 *   heads; the heads are handed to the engine's `expense` as input_tax. The person never types a tax amount.
 * ⭐ THE GOLDEN RULES are posting.js's header ("personal: Dr the receiver, Cr the giver · real: Dr what comes in, Cr what goes out · nominal: Dr
 *   expenses and losses, Cr incomes and gains"); a line's TYPE is accounts-packs' (accountOf(...).type). GOLDEN below is those six sentences, so the
 *   preview can say which rule placed a line. It decides no side.
 * ⚠️ NO ENGINE EVENT EXISTS for capital, drawings, a staff advance or its recovery. Each is the engine's own `manual` event (owner-only, Dr = Cr, a
 *   narration) with the ledgers its roles name (`capital`, `drawings`, the mode's account) — a composition, not a new rule. `voucher_type` rides
 *   on the event so the entry reads Receipt / Payment beside its MJ number. PENDING lists what could not be composed (see below).
 * ⚠️ s.17(5): the engines carry no list of blocked credits, so the person DECLARES the head (`blocked_credit`); the tax then goes into the expense
 *   (it is a cost) and the preview says so. Asking to claim it anyway (`claim_credit: true`) is refused.
 * ⚠️ OWNER-ONLY. The posting route is owner-gated; the preview refuses a co-assist in words but still shows the lines.
 * ⭐ A SECOND TAP NEVER POSTS TWICE: client_ref → source_ref `ev:<kind>:<ref>`; postEntry answers a repeat with the first entry, duplicate: true.
 */
const B = require('./books');
const E = require('./books-engines');
const P = require('./books-period');

const ask = P.ask;
const refuse = (why, code) => { const e = new Error(why); e.code = code || 'BOOKS_REFUSED'; e.refused = true; return e; };
const MODES = ['cash', 'bank', 'upi', 'card'];            /* a cheque posts when it CLEARS (C3), never at issue — not offered here */
const GOLDEN = {
  personal: { dr: 'Dr the receiver', cr: 'Cr the giver' },
  real: { dr: 'Dr what comes in', cr: 'Cr what goes out' },
  nominal: { dr: 'Dr expenses and losses', cr: 'Cr incomes and gains' },
};
/** s.17(5) CGST Act — the heads a person may declare; the engines carry none (see the header) */
const BLOCKED = ['food', 'motor_vehicle', 'club', 'beauty_health', 'works_contract', 'personal_use', 'other'];
const BLOCKED_WORD = { food: 'food and drink', motor_vehicle: 'a motor vehicle', club: 'a club or membership', beauty_health: 'beauty or health', works_contract: 'a works contract',
  personal_use: 'personal use', other: 'a blocked item' };
/** what could not be composed from existing engine events — the PR names them; the grid does not offer them */
const PENDING = [
  { kind: 'drawings_goods', why: 'Goods taken out for the owner need an engine rule (stock side and GST on own use). Not composed here.' },
  { kind: 'advance_from_salary', why: 'Recovering an advance from salary needs a salary event with a deduction. Not composed here.' },
];

/* ── small readers ────────────────────────────────────────────────────────────────────────────────────────────── */
const modeOf = (b, key, dflt) => {
  const m = String(b[key] == null || b[key] === '' ? dflt || '' : b[key]).toLowerCase();
  if (MODES.indexOf(m) < 0) throw ask('How was it paid? cash, bank, upi or card.');
  return m;
};
const modeAcct = (m) => E.posting().MODE_ACCOUNT[m];          /* the engine's own mode → ledger role */
const narr = (b, dflt) => String(b.narration || '').trim().slice(0, 200) || dflt;
const sourceRef = (kind, b) => { const r = P.refOf(b); return r ? 'ev:' + kind + ':' + r : null; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the free journal's lines as the screen sends them — { code, dr_minor | cr_minor, party? } or rupees — into the engine's rows. The one reader; POST /entries uses it too. */
function givenLines(list) {
  const f = Math.pow(10, 2);
  return (Array.isArray(list) ? list : []).map((l) => ({ account: String(l.account || l.code || ''), dr: l.dr_minor != null ? Number(l.dr_minor) / f : Number(l.dr || 0),
    cr: l.cr_minor != null ? Number(l.cr_minor) / f : Number(l.cr || 0), party: UUID.test(String(l.party || l.party_id || '')) ? String(l.party || l.party_id) : undefined }));
}

/** the engine's `manual` event with the person's own voucher type beside it */
function manual(x, o) {
  return { type: 'manual', owner: true, voucher_type: o.voucher, date: o.date, currency: x.cur, narration: o.narration, lines: o.lines,
    source_ref: o.source_ref, strict_date: true, by: x.by };
}
const own = (x, ev) => Object.assign({ owner: true, strict_date: true, by: x.by }, ev);

/** a shop ledger under Loans & Advances (Asset) — picked, never typed: the person adds one per employee (POST /accounts) and picks it here */
async function staffLedger(x, b) {
  const code = String(b.ledger || b.code || '').trim();
  if (!code) throw ask('Which staff ledger? Add one for the person first.');
  const C = await B.chartOf(null, x.entity);
  const pack = E.packWith(B.packOf(x.s), C.chart);
  const a = E.packs().accountOf(pack, code);
  if (!a || a.group !== 'loans_advances_asset' || a.role) throw ask('Pick a ledger the shop added under Loans and advances.');
  return a;
}

/**
 * the bill's tax lines → heads, read by the tax engine (tax-lines.invoiceFor), never summed here.
 * ⚠️ Both states are needed: the tax engine says "nothing assumed" and returns no tax when it cannot tell CGST + SGST from IGST — so that is asked, not posted.
 */
function billHeads(x, bill, cur) {
  const T = require('./tax-lines');
  const lines = Array.isArray(bill.lines) ? bill.lines : [];
  if (!lines.length) throw ask('Add the bill\'s lines.');
  const sg = String(bill.supplier_gstin || '').trim(), bg = String(bill.my_gstin || '').trim();
  if (!sg) throw ask('The supplier\'s GST number is needed to claim GST.');
  const pos = String(bill.place_of_supply || '').trim() || T.stateOfGstin(bg);
  if (!pos) throw ask('Your GST number (or the place of supply) is needed to split the GST.');
  const buyer = Object.assign(T.partyOf({ gstn: bg || null, display_name: 'Shop' }), { Pos: pos, State: T.stateOfGstin(bg) || pos });
  const r = T.invoiceFor({ lines, seller: T.partyOf({ gstn: sg, display_name: String(bill.supplier_name || 'Supplier') }), buyer, currency: cur,
    priceIncludesTax: !!bill.price_includes_tax, at: bill.date || null, chit_id: bill.doc_no || null });
  if (r.unrated) throw ask('Every line of the bill needs its GST rate.');
  return T.heads(r.invoice);
}

/* ── the builders: a typed request → the engine's event ───────────────────────────────────────────────────────── */
const BUILD = {
  /** expense paid — the engine's `expense` (Dr the class + input tax · Cr what paid it, or the supplier on credit) */
  async expense(x, b) {
    const cls = String(b.class || b.expense_class || '').trim();
    if (!cls) throw ask('What was it for? Pick the kind of expense.');
    const date = P.dateOf(b, 'date', P.today(x.s));
    const ev = own(x, { type: 'expense', class: cls, date, currency: x.cur, narration: narr(b, 'Paid ' + cls), source_ref: sourceRef('expense', b) });
    const supplier = b.supplier || b.party_id || null;
    if (supplier) { if (!UUID.test(String(supplier))) throw ask('Which supplier?'); ev.supplier = String(supplier); }
    else ev.paid_from = modeOf(b, 'paid_from', b.how);
    const meta = { credit: null, bill: null };
    if (b.bill && typeof b.bill === 'object') {
      const h = billHeads(x, b.bill, x.cur);
      const reason = b.blocked_credit ? String(b.blocked_credit) : null;
      if (reason && BLOCKED.indexOf(reason) < 0) throw ask('Which blocked credit? ' + BLOCKED.join(', ') + '.');
      if (reason && b.claim_credit === true) throw refuse('The GST on ' + BLOCKED_WORD[reason] + ' cannot be claimed as input credit (s.17(5)). It goes into the expense.');
      meta.bill = { taxable: h.taxable, cgst: h.cgst, sgst: h.sgst, igst: h.igst, cess: h.cess, total: h.total };
      if (reason) {
        ev.amount = Math.round((h.taxable + h.tax) * 100) / 100;           /* the tax is a cost: the whole bill to the expense, no input credit */
        meta.credit = 'blocked'; meta.flag = 'The GST on ' + BLOCKED_WORD[reason] + ' is not claimable (s.17(5)). It goes into the expense.';
      } else {
        ev.amount = h.taxable; ev.input_tax = { cgst: h.cgst, sgst: h.sgst, igst: h.igst, cess: h.cess }; meta.credit = 'claimed';
      }
    } else {
      ev.amount = P.toRupees(P.amountOf(b, 'amount', x.cur, { ask: 'How much was it?' }), x.cur);
    }
    return { ev, meta };
  },
  /** other income received — the engine's `other_income` (Dr where it came in · Cr the income class) */
  async other_income(x, b) {
    const cls = String(b.class || b.income_class || '').trim();
    if (!cls) throw ask('What was it for? Pick the kind of income.');
    const ev = own(x, { type: 'other_income', class: cls, into: modeOf(b, 'into', b.how), date: P.dateOf(b, 'date', P.today(x.s)), currency: x.cur,
      amount: P.toRupees(P.amountOf(b, 'amount', x.cur, { ask: 'How much came in?' }), x.cur), narration: narr(b, 'Income received: ' + cls), source_ref: sourceRef('other_income', b) });
    return { ev, meta: {} };
  },
  /** capital introduced — Dr where it came in · Cr Capital (a Receipt) */
  async capital(x, b) {
    const m = modeOf(b, 'into', b.how), amt = P.toRupees(P.amountOf(b, 'amount', x.cur, { ask: 'How much did you put in?' }), x.cur);
    return { ev: manual(x, { voucher: 'Receipt', date: P.dateOf(b, 'date', P.today(x.s)), narration: narr(b, 'Capital put in'), source_ref: sourceRef('capital', b),
      lines: [{ account: modeAcct(m), dr: amt, cr: 0 }, { account: 'capital', dr: 0, cr: amt }] }), meta: {} };
  },
  /** drawings in cash — Dr Drawings · Cr where it left from (a Payment). Goods: see PENDING. */
  async drawings(x, b) {
    if (String(b.what || 'cash') === 'goods') throw refuse(PENDING[0].why);
    const m = modeOf(b, 'from', b.paid_from || b.how), amt = P.toRupees(P.amountOf(b, 'amount', x.cur, { ask: 'How much did you take?' }), x.cur);
    return { ev: manual(x, { voucher: 'Payment', date: P.dateOf(b, 'date', P.today(x.s)), narration: narr(b, 'Drawings'), source_ref: sourceRef('drawings', b),
      lines: [{ account: 'drawings', dr: amt, cr: 0 }, { account: modeAcct(m), dr: 0, cr: amt }] }), meta: {} };
  },
  /** a salary advance — Dr the staff ledger · Cr where it left from (a Payment) */
  async staff_advance(x, b) {
    const a = await staffLedger(x, b), m = modeOf(b, 'from', b.paid_from || b.how), amt = P.toRupees(P.amountOf(b, 'amount', x.cur, { ask: 'How much was the advance?' }), x.cur);
    return { ev: manual(x, { voucher: 'Payment', date: P.dateOf(b, 'date', P.today(x.s)), narration: narr(b, 'Advance: ' + a.name), source_ref: sourceRef('staff_advance', b),
      lines: [{ account: a.code, dr: amt, cr: 0 }, { account: modeAcct(m), dr: 0, cr: amt }] }), meta: {} };
  },
  /** an advance recovered in money — Dr where it came in · Cr the staff ledger (a Receipt) */
  async advance_recovered(x, b) {
    const a = await staffLedger(x, b), m = modeOf(b, 'into', b.how), amt = P.toRupees(P.amountOf(b, 'amount', x.cur, { ask: 'How much came back?' }), x.cur);
    return { ev: manual(x, { voucher: 'Receipt', date: P.dateOf(b, 'date', P.today(x.s)), narration: narr(b, 'Advance back: ' + a.name), source_ref: sourceRef('advance_recovered', b),
      lines: [{ account: modeAcct(m), dr: amt, cr: 0 }, { account: a.code, dr: 0, cr: amt }] }), meta: {} };
  },
  /** cash ↔ bank ↔ UPI — the engine's `contra`, built by books-period's own contraEvent (the POST /contra route's builder) */
  async contra(x, b) { return { ev: own(x, P.contraEvent(x.s, b)), meta: {} }; },
  /** "Write a journal" — the engine's `manual`, the lines as given (the POST /entries route's own builder) */
  async journal(x, b) {
    return { ev: manual(x, { voucher: b.voucher_type, date: P.dateOf(b, 'date', P.today(x.s)), narration: b.narration, source_ref: sourceRef('journal', b), lines: givenLines(b.lines) }), meta: {} };
  },
};

/* ── the grid (GET /events): what the screen draws, so it holds no rules ──────────────────────────────────────── */
const F = {
  amount: { key: 'amount', kind: 'amount', required: true },
  date: { key: 'date', kind: 'date', required: false, default: 'today' },
  note: { key: 'narration', kind: 'text', required: false },
  paid: (key, req) => ({ key, kind: 'pick', pick: 'mode', options: MODES, required: req !== false }),
};
const CATALOGUE = [
  { kind: 'expense', words: 'Pay expense', icon: 'receipt', band: 'paid', voucher: 'Payment', ledger_group: 'expense', bill: true,
    fields: [{ key: 'class', kind: 'pick', pick: 'expense_class', required: true }, F.amount, F.paid('paid_from'), F.date, F.note] },
  { kind: 'other_income', words: 'Other income', icon: 'coins', band: 'received', voucher: 'Receipt', ledger_group: 'income',
    fields: [{ key: 'class', kind: 'pick', pick: 'income_class', required: true }, F.amount, F.paid('into'), F.date, F.note] },
  { kind: 'capital', words: 'Put money in', icon: 'wallet-in', band: 'owner', voucher: 'Receipt', ledger_group: 'capital', fields: [F.amount, F.paid('into'), F.date, F.note] },
  { kind: 'drawings', words: 'Took money out', icon: 'wallet-out', band: 'owner', voucher: 'Payment', ledger_group: 'capital', fields: [F.amount, F.paid('from'), F.date, F.note] },
  { kind: 'staff_advance', words: 'Staff advance', icon: 'person-out', band: 'staff', voucher: 'Payment', ledger_group: 'loans_advances_asset',
    fields: [{ key: 'ledger', kind: 'pick', pick: 'ledger', group: 'loans_advances_asset', required: true }, F.amount, F.paid('from'), F.date, F.note] },
  { kind: 'advance_recovered', words: 'Advance back', icon: 'person-in', band: 'staff', voucher: 'Receipt', ledger_group: 'loans_advances_asset',
    fields: [{ key: 'ledger', kind: 'pick', pick: 'ledger', group: 'loans_advances_asset', required: true }, F.amount, F.paid('into'), F.date, F.note] },
  { kind: 'contra', words: 'Move money', icon: 'swap', band: 'money', voucher: 'Contra', ledger_group: null,
    fields: [F.paid('from'), F.paid('to'), F.amount, F.date, F.note] },
  { kind: 'journal', words: 'Write a journal', icon: 'pen', band: 'adjust', voucher: 'Journal', ledger_group: null,
    fields: [{ key: 'lines', kind: 'lines', required: true }, { key: 'narration', kind: 'text', required: true }, F.date] },
];
/** events with their own routes today (books-period) — listed so the grid is complete; the screen calls `route`, and there is no preview for them yet */
const ROUTED = [
  { kind: 'asset', words: 'Bought an asset', icon: 'box', band: 'bought', route: 'POST /assets', preview: false, ledger_group: 'fixed_assets' },
  { kind: 'loan', words: 'Loan taken', icon: 'bank', band: 'loan', route: 'POST /loans', preview: false, ledger_group: 'loans_liability' },
  { kind: 'loan_emi', words: 'Instalment paid', icon: 'bank', band: 'loan', route: 'POST /loans/:ref/emi', preview: false, ledger_group: 'loans_liability' },
  { kind: 'closing_stock', words: 'Closing stock', icon: 'stock', band: 'adjust', route: 'POST /closing-stock', preview: false, ledger_group: null },
  { kind: 'accrual', words: 'Owed or prepaid', icon: 'clock', band: 'adjust', route: 'POST /accruals', preview: false, ledger_group: null },
  { kind: 'depreciation', words: 'Depreciation', icon: 'trend-down', band: 'adjust', route: 'POST /depreciation/run', preview: false, ledger_group: null },
  { kind: 'write_off', words: 'Bad debt', icon: 'x', band: 'adjust', route: 'POST /write-off', preview: false, ledger_group: null },
];
/** GET /events → the grid. Expense and income classes are the pack's own (EXPENSE_CLASSES / INCOME_CLASSES), so a country with other classes changes nothing here. */
function catalogue(s) {
  const pack = B.packOf(s);
  const cls = (list) => (list || []).map((r) => ({ role: r.role, code: r.code, name: r.name }));
  return { events: CATALOGUE.map((e) => Object.assign({ preview: true, post: 'POST /events' }, e)).concat(ROUTED),
    picks: { mode: MODES, expense_class: cls(pack.expense_classes), income_class: cls(pack.income_classes), blocked_credit: BLOCKED },
    pending: PENDING, golden: GOLDEN };
}

/* ── the two doors ────────────────────────────────────────────────────────────────────────────────────────────── */
/** { kind } or a bare kind string, with the fields beside it (or inside `event`) → the engine's event, built */
async function eventOf(entity, s, input, by) {
  const raw = input && typeof input === 'object' ? input : {};
  const inner = raw.event && typeof raw.event === 'object' ? raw.event : null;
  const b = Object.assign({}, inner ? Object.assign({}, raw, inner) : raw);
  const kind = String((inner && (inner.kind || inner.type)) || (typeof raw.event === 'string' ? raw.event : '') || raw.kind || '').trim();
  if (!kind || !Object.prototype.hasOwnProperty.call(BUILD, kind)) throw ask('What happened? ' + Object.keys(BUILD).join(', ') + '.');
  const x = { entity, s, cur: (s && s.functional_currency) || 'INR', by: by || null };
  const r = await BUILD[kind](x, b);
  return Object.assign({ kind }, r);
}

/** POST /events — the entry, posted by the one writer. A repeat of the same client_ref answers the first entry, duplicate: true. */
async function post(entity, s, input, by) {
  const { kind, ev } = await eventOf(entity, s, input, by);
  const r = await B.postEntry(null, entity, ev);
  return Object.assign({ kind }, r);
}

/**
 * POST /preview — the journal the event WOULD post, from the same composeEntry; nothing is written and no number is taken.
 * → { ok, kind, voucher: { series, type }, date, lines: [{ code, ledger, party?, dr_minor, cr_minor, type, rule }], balanced, totals, credit, bill?, flags, refusals, code, duplicate }
 * A refusal (a locked month, a blocked credit, a missing answer, a co-assist) is a plain sentence in `refusals` with `ok: false` — a question the screen can show, not an error.
 */
async function preview(entity, s, input, who) {
  const w = who || {};
  const out = { ok: false, kind: null, voucher: null, date: null, lines: [], balanced: false, totals: { dr_minor: 0, cr_minor: 0 }, credit: null, bill: null, flags: [], refusals: [], code: null, duplicate: null };
  const refused = (e) => { out.refusals.push(e.message); out.code = out.code || (e.code && e.code !== 'BOOKS_REFUSED' && e.code !== 'BOOKS_BAD_REQUEST' ? e.code : null); };
  let built;
  try { built = await eventOf(entity, s, input, w.by); } catch (e) { if (e && (e.refused || e.code === 'BOOKS_BAD_REQUEST')) { refused(e); return out; } throw e; }
  out.kind = built.kind; out.credit = built.meta.credit || null; out.bill = built.meta.bill || null;
  if (built.meta.flag) out.flags.push(built.meta.flag);
  if (w.owner === false) out.refusals.push('Only the owner may record this.');
  let c;
  try { c = await B.previewEntry(null, entity, built.ev); }
  catch (e) { if (e && (e.refused || e.code === 'PERIOD_LOCKED' || e.code === 'BOOKS_REFUSED')) { refused(e); return out; } throw e; }
  if (c.off) { out.refusals.push('The ledger is off.'); return out; }
  const A = E.packs();
  out.voucher = { series: c.voucher.series, type: c.voucher.type };
  out.date = c.when.date; out.duplicate = c.duplicate;
  out.lines = c.lines.map((l) => {
    const a = A.accountOf(c.pack, l.code), side = l.dr_minor ? 'dr' : 'cr';
    return { code: l.code, ledger: (c.C.byCode.get(String(l.code)) || {}).name || (a && a.name) || l.code, party: l.party_id || undefined, dr_minor: l.dr_minor, cr_minor: l.cr_minor,
      type: a ? a.type : null, rule: a && GOLDEN[a.type] ? GOLDEN[a.type][side] : null };
  });
  out.totals = { dr_minor: c.posted.totals.dr_minor, cr_minor: c.posted.totals.cr_minor };
  out.balanced = out.totals.dr_minor === out.totals.cr_minor;
  out.ok = out.balanced && !out.refusals.length;
  return out;
}

module.exports = { BUILD, GOLDEN, BLOCKED, PENDING, MODES, catalogue, eventOf, post, preview, givenLines };
