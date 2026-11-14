// @stage tested
// @stage-note [BOOKS v2] The "＋ Entry" events — what the owner keys in by hand: expense, other income, capital, drawings, staff advance. One builder each; the preview and the writer share it.
'use strict';
/**
 * OWNS      the hand-keyed event builders (BUILD), the grid (catalogue) and the typed-lines reader givenLines (minor → major in the shop's currency, ACC-179).
 * CALLED BY routes/books.js (GET /events · POST /preview · POST /events · POST /entries givenLines)
 * FLOW      body ──▶ BUILD[kind] (givenLines · taxedInvoice) ──▶ the engine's event ──▶ lib/books postEntry | previewEntry
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
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
const books = require('./books');
const booksEngines = require('./books-engines');
const periodLib = require('./books-period');

const ask = periodLib.ask;
const refuse = (reason, code) => {
  const e = new Error(reason);
  e.code = code || 'BOOKS_REFUSED';
  e.refused = true;
  return e;
};
const MODES = ['cash', 'bank', 'upi', 'card']; /* a cheque posts when it CLEARS (C3), never at issue — not offered here */
const GOLDEN = {
  personal: { dr: 'Dr the receiver', cr: 'Cr the giver' },
  real: { dr: 'Dr what comes in', cr: 'Cr what goes out' },
  nominal: { dr: 'Dr expenses and losses', cr: 'Cr incomes and gains' }
};
/** s.17(5) CGST Act — the heads a person may declare; the engines carry none (see the header) */
const BLOCKED = ['food', 'motor_vehicle', 'club', 'beauty_health', 'works_contract', 'personal_use', 'other'];
const BLOCKED_WORD = {
  food: 'food and drink',
  motor_vehicle: 'a motor vehicle',
  club: 'a club or membership',
  beauty_health: 'beauty or health',
  works_contract: 'a works contract',
  personal_use: 'personal use',
  other: 'a blocked item'
};
/** what could not be composed from existing engine events — the PR names them; the grid does not offer them */
const PENDING = [
  { kind: 'drawings_goods', why: 'Goods taken out for the owner need an engine rule (stock side and GST on own use). Not composed here.' },
  { kind: 'advance_from_salary', why: 'Recovering an advance from salary needs a salary event with a deduction. Not composed here.' }
];

/* ── small readers ────────────────────────────────────────────────────────────────────────────────────────────── */
const modeOf = (body, key, dflt) => {
  const mode = String(body[key] == null || body[key] === '' ? dflt || '' : body[key]).toLowerCase();
  if (MODES.indexOf(mode) < 0) throw ask('How was it paid? cash, bank, upi or card.');
  return mode;
};
const modeAcct = (mode) => booksEngines.posting().MODE_ACCOUNT[mode]; /* the engine's own mode → ledger role */
const narr = (body, dflt) =>
  String(body.narration || '')
    .trim()
    .slice(0, 200) || dflt;
const sourceRef = (kind, body) => {
  const ref = periodLib.refOf(body);
  return ref ? 'ev:' + kind + ':' + ref : null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ACC-311 / ACC-276: an amount in minor units is a whole number (bounds.minor: a fraction is refused) below the one chit ceiling (chit-ceiling 'total' × the 2-digit scale = the engine's 10^15). Signed on
   purpose: a negative figure keeps the ledger engine's own refusal. */
const bounds = require('./bounds');
const WHOLE_MINOR = bounds.minor({ column: 'total', signed: true });
/** a typed minor-unit figure as given when it is a whole number inside the ceiling, else BOOKS_REFUSED (422) naming the field: never rounded to one, never cut to it. Text the engine cannot read is its own refusal. */
function wholeMinor(value, field) {
  const figure = Number(value);
  if (!Number.isFinite(figure) || bounds.holds(WHOLE_MINOR, figure)) return value;
  const reason = Number.isInteger(figure) ? 'is beyond what a ledger line holds' : 'is not a whole number of minor units (paise, cents): it is not rounded';
  throw refuse('The ' + field + ' ' + String(value).slice(0, 24) + ' ' + reason + '. Nothing was posted: send a whole number of minor units.');
}

/** the free journal's lines as the screen sends them — { code, dr_minor | cr_minor, party? } or rupees — into the engine's rows. The one reader; POST /entries uses it too. */
function givenLines(list, currency) {
  const cells = require('./currency-cells');
  cells.assertSame(cells.journalCellsOf(list), currency); /* CUR-1 · ACC-332: a line that names another currency than the shop's is refused, never booked as its money */
  const fromMinor = require('./books-cashflow').fromMinor; /* ACC-179: the currency's own decimals (it was Math.pow(10, 2) for every currency) */
  return (Array.isArray(list) ? list : []).map((item) => ({
    account: String(item.account || item.code || ''),
    dr: item.dr_minor != null ? fromMinor(wholeMinor(item.dr_minor, 'dr_minor'), currency) : Number(item.dr || 0),
    cr: item.cr_minor != null ? fromMinor(wholeMinor(item.cr_minor, 'cr_minor'), currency) : Number(item.cr || 0),
    party: UUID.test(String(item.party || item.party_id || '')) ? String(item.party || item.party_id) : undefined
  }));
}

/** the engine's `manual` event with the person's own voucher type beside it */
function manual(x, options) {
  return {
    type: 'manual',
    owner: true,
    voucher_type: options.voucher,
    date: options.date,
    currency: x.cur,
    narration: options.narration,
    lines: options.lines,
    source_ref: options.source_ref,
    strict_date: true,
    by: x.by
  };
}
const own = (x, event) => Object.assign({ owner: true, strict_date: true, by: x.by }, event);

/** a shop ledger under Loans & Advances (Asset) — picked, never typed: the person adds one per employee (POST /accounts) and picks it here */
async function staffLedger(x, body) {
  const code = String(body.ledger || body.code || '').trim();
  if (!code) throw ask('Which staff ledger? Add one for the person first.');
  const chart = await books.chartOf(null, x.entity);
  const pack = booksEngines.packWith(books.packOf(x.s), chart.chart);
  const account = booksEngines.packs().accountOf(pack, code);
  if (!account || account.group !== 'loans_advances_asset' || account.role) throw ask('Pick a ledger the shop added under Loans and advances.');
  return account;
}

/**
 * a typed bill's lines through the tax engine (tax-lines.invoiceFor) — THE one place a keyed-in bill is taxed; the expense's heads and the
 * debit note's rows both read it. → the engine's invoice. The tax word is the country's (tax-shelf.taxWordOf: GST, VAT …, else "tax").
 * ⚠️ Both states are needed: the tax engine says "nothing assumed" and returns no tax when it cannot tell CGST + SGST from IGST — so that is asked, not posted.
 * `o.taxed` false (every line at 0 %) asks for no tax number: a local supplier with none can still be noted.
 */
function taxedInvoice(x, bill, currency, opts) {
  const taxLines = require('./tax-lines');
  const taxWord = require('./tax-shelf').taxWordOf(x.s && x.s.country);
  const lines = Array.isArray(bill.lines) ? bill.lines : [];
  if (!lines.length) throw ask('Add the lines of ' + opts.what + '.');
  const numbers = taxNumbersOf(bill, opts, taxWord);
  /* CTRY-94: a typed bill is a local one — both parties are in the shop's country; the engines no longer read India when none is said */
  const shopCountry = (x.s && x.s.country) || null;
  const buyer = Object.assign(taxLines.partyOf({ gstn: numbers.mine || null, display_name: 'Shop', country: shopCountry }), { Pos: numbers.pos, State: taxLines.stateOfGstin(numbers.mine) || numbers.pos });
  const result = taxLines.invoiceFor({
    lines,
    seller: taxLines.partyOf({ gstn: numbers.theirs || null, display_name: String(bill.supplier_name || 'Supplier'), country: shopCountry }),
    buyer,
    currency,
    priceIncludesTax: !!bill.price_includes_tax,
    at: bill.date || null,
    bill_day: taxLines.billDayOf({ billed_at: bill.date }, opts.purpose, null, null), /* CTRY-139: the supplier's bill date (a day already); a note is never banded: the ONE rule */
    purpose: opts.purpose,
    chit_id: bill.doc_no || null
  });
  if (result.unrated) throw ask('Every line of ' + opts.what + ' needs its ' + taxWord + ' rate.');
  return result.invoice;
}
/** the two tax numbers and the place of supply a typed bill names — asked for only when the lines carry tax (opts.taxed) */
function taxNumbersOf(bill, opts, taxWord) {
  const theirs = String(bill.supplier_gstin || '').trim(),
    mine = String(bill.my_gstin || '').trim();
  if (opts.taxed && !theirs) throw ask("The supplier's " + taxWord + ' number is needed to ' + opts.taxWhy + ' ' + taxWord + '.');
  const pos = String(bill.place_of_supply || '').trim() || require('./tax-lines').stateOfGstin(mine);
  if (opts.taxed && !pos) throw ask('Your ' + taxWord + ' number (or the place of supply) is needed to split the ' + taxWord + '.');
  return { theirs, mine, pos };
}
/** the bill's tax lines → heads, never summed here */
function billHeads(x, bill, currency) {
  return require('./tax-lines').heads(taxedInvoice(x, bill, currency, { taxed: true, what: 'the bill', taxWhy: 'claim' }));
}
const UUID_ASK = (value, question) => {
  if (!UUID.test(String(value || ''))) throw ask(question);
  return String(value);
};
/** R106: what a debit note is for — the reason rides the narration; the lines say the money */
const DEBIT_REASONS = { rate: 'Rate difference', returned: 'Goods returned', other: 'Difference' };

/* ── the builders: a typed request → the engine's event ───────────────────────────────────────────────────────── */
const BUILD = {
  /** expense paid — the engine's `expense` (Dr the class + input tax · Cr what paid it, or the supplier on credit) */
  async expense(x, body) {
    const klass = String(body.class || body.expense_class || '').trim();
    if (!klass) throw ask('What was it for? Pick the kind of expense.');
    const date = periodLib.dateOf(body, 'date', periodLib.today(x.s));
    const event = own(x, { type: 'expense', class: klass, date, currency: x.cur, narration: narr(body, 'Paid ' + klass), source_ref: sourceRef('expense', body) });
    const supplier = body.supplier || body.party_id || null;
    if (supplier) {
      if (!UUID.test(String(supplier))) throw ask('Which supplier?');
      event.supplier = String(supplier);
    } else event.paid_from = modeOf(body, 'paid_from', body.how);
    const meta = { credit: null, bill: null };
    if (body.bill && typeof body.bill === 'object') {
      const heads = billHeads(x, body.bill, x.cur);
      const reason = body.blocked_credit ? String(body.blocked_credit) : null;
      if (reason && BLOCKED.indexOf(reason) < 0) throw ask('Which blocked credit? ' + BLOCKED.join(', ') + '.');
      if (reason && body.claim_credit === true)
        throw refuse('The GST on ' + BLOCKED_WORD[reason] + ' cannot be claimed as input credit (s.17(5)). It goes into the expense.');
      meta.bill = { taxable: heads.taxable, cgst: heads.cgst, sgst: heads.sgst, igst: heads.igst, cess: heads.cess, total: heads.total };
      if (reason) {
        event.amount = require('./money').round(heads.taxable + heads.tax); /* the tax is a cost: the whole bill to the expense, no input credit */
        meta.credit = 'blocked';
        meta.flag = 'The GST on ' + BLOCKED_WORD[reason] + ' is not claimable (s.17(5)). It goes into the expense.';
      } else {
        event.amount = heads.taxable;
        event.input_tax = { cgst: heads.cgst, sgst: heads.sgst, igst: heads.igst, cess: heads.cess };
        meta.credit = 'claimed';
      }
    } else {
      event.amount = periodLib.toRupees(periodLib.amountOf(body, 'amount', x.cur, { ask: 'How much was it?' }), x.cur);
    }
    return { ev: event, meta };
  },
  /** other income received — the engine's `other_income` (Dr where it came in · Cr the income class) */
  async other_income(x, body) {
    const klass = String(body.class || body.income_class || '').trim();
    if (!klass) throw ask('What was it for? Pick the kind of income.');
    const event = own(x, {
      type: 'other_income',
      class: klass,
      into: modeOf(body, 'into', body.how),
      date: periodLib.dateOf(body, 'date', periodLib.today(x.s)),
      currency: x.cur,
      amount: periodLib.toRupees(periodLib.amountOf(body, 'amount', x.cur, { ask: 'How much came in?' }), x.cur),
      narration: narr(body, 'Income received: ' + klass),
      source_ref: sourceRef('other_income', body)
    });
    return { ev: event, meta: {} };
  },
  /** capital introduced — Dr where it came in · Cr Capital (a Receipt) */
  async capital(x, body) {
    const mode = modeOf(body, 'into', body.how),
      amount = periodLib.toRupees(periodLib.amountOf(body, 'amount', x.cur, { ask: 'How much did you put in?' }), x.cur);
    return {
      ev: manual(x, {
        voucher: 'Receipt',
        date: periodLib.dateOf(body, 'date', periodLib.today(x.s)),
        narration: narr(body, 'Capital put in'),
        source_ref: sourceRef('capital', body),
        lines: [
          { account: modeAcct(mode), dr: amount, cr: 0 },
          { account: 'capital', dr: 0, cr: amount }
        ]
      }),
      meta: {}
    };
  },
  /** drawings in cash — Dr Drawings · Cr where it left from (a Payment). Goods: see PENDING. */
  async drawings(x, body) {
    if (String(body.what || 'cash') === 'goods') throw refuse(PENDING[0].why);
    const mode = modeOf(body, 'from', body.paid_from || body.how),
      amount = periodLib.toRupees(periodLib.amountOf(body, 'amount', x.cur, { ask: 'How much did you take?' }), x.cur);
    return {
      ev: manual(x, {
        voucher: 'Payment',
        date: periodLib.dateOf(body, 'date', periodLib.today(x.s)),
        narration: narr(body, 'Drawings'),
        source_ref: sourceRef('drawings', body),
        lines: [
          { account: 'drawings', dr: amount, cr: 0 },
          { account: modeAcct(mode), dr: 0, cr: amount }
        ]
      }),
      meta: {}
    };
  },
  /** a salary advance — Dr the staff ledger · Cr where it left from (a Payment) */
  async staff_advance(x, body) {
    const ledger = await staffLedger(x, body),
      mode = modeOf(body, 'from', body.paid_from || body.how),
      amount = periodLib.toRupees(periodLib.amountOf(body, 'amount', x.cur, { ask: 'How much was the advance?' }), x.cur);
    return {
      ev: manual(x, {
        voucher: 'Payment',
        date: periodLib.dateOf(body, 'date', periodLib.today(x.s)),
        narration: narr(body, 'Advance: ' + ledger.name),
        source_ref: sourceRef('staff_advance', body),
        lines: [
          { account: ledger.code, dr: amount, cr: 0 },
          { account: modeAcct(mode), dr: 0, cr: amount }
        ]
      }),
      meta: {}
    };
  },
  /** an advance recovered in money — Dr where it came in · Cr the staff ledger (a Receipt) */
  async advance_recovered(x, body) {
    const advanceLedger = await staffLedger(x, body),
      mode = modeOf(body, 'into', body.how),
      amount = periodLib.toRupees(periodLib.amountOf(body, 'amount', x.cur, { ask: 'How much came back?' }), x.cur);
    return {
      ev: manual(x, {
        voucher: 'Receipt',
        date: periodLib.dateOf(body, 'date', periodLib.today(x.s)),
        narration: narr(body, 'Advance back: ' + advanceLedger.name),
        source_ref: sourceRef('advance_recovered', body),
        lines: [
          { account: modeAcct(mode), dr: amount, cr: 0 },
          { account: advanceLedger.code, dr: 0, cr: amount }
        ]
      }),
      meta: {}
    };
  },
  /**
   * ⭐ R106 — a DEBIT NOTE I raise against a supplier's bill (a rate difference, goods sent back): the engine's own `purchase_return`, the SAME
   * event a supplier's credit-note chit posts (books-hooks) — Dr the supplier · Cr purchase returns per rate · Cr input tax back (the pack's rule).
   * Raised only against money BOOKED (OPS-60): a short delivery is never a debit note — the bill posts at the count with the gap noted.
   * `against_ref` (the bill's ref, as Payables lists it) sets it against that bill (postEntry → confirmItems); `client_ref` is REQUIRED so a
   * second tap never posts twice (ev:debit_note:<ref>). Lines are typed as the difference (qty × the rate difference), taxed by the one engine.
   */
  async debit_note(x, body) {
    const supplier = UUID_ASK(body.supplier || body.party_id, 'Which supplier?');
    const against_ref = String(body.against_ref || '').trim();
    if (!against_ref) throw ask('Which bill? Give its reference.');
    const source_ref = sourceRef('debit_note', body);
    if (!source_ref) throw ask('A reference (client_ref) is needed, so a second tap never posts twice.');
    const reason = DEBIT_REASONS[String(body.reason || 'other')] || DEBIT_REASONS.other;
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const taxed = lines.some((line) => Number(line.gst_rate) > 0);
    const invoice = taxedInvoice(x, Object.assign({}, body, { lines }), x.cur, { taxed, what: 'the difference', taxWhy: 'reverse', purpose: 'debit_note' });
    const by_rate = require('./books-hooks').byRateOf(invoice).rows;
    const date = periodLib.dateOf(body, 'date', periodLib.today(x.s));
    return {
      ev: own(x, { type: 'purchase_return', party: supplier, by_rate, date, currency: x.cur, against_ref, source_ref, narration: narr(body, reason + ' against bill ' + against_ref), note: reason + ', noted' }),
      meta: { against_ref, reason }
    };
  },
  /** cash ↔ bank ↔ UPI — the engine's `contra`, built by books-period's own contraEvent (the POST /contra route's builder) */
  async contra(x, body) {
    return { ev: own(x, periodLib.contraEvent(x.s, body)), meta: {} };
  },
  /** "Write a journal" — the engine's `manual`, the lines as given (the POST /entries route's own builder) */
  async journal(x, body) {
    return {
      ev: manual(x, {
        voucher: body.voucher_type,
        date: periodLib.dateOf(body, 'date', periodLib.today(x.s)),
        narration: body.narration,
        source_ref: sourceRef('journal', body),
        lines: givenLines(body.lines, x.cur)
      }),
      meta: {}
    };
  }
};

/* ── the grid (GET /events): what the screen draws, so it holds no rules ──────────────────────────────────────── */
const F = {
  amount: { key: 'amount', kind: 'amount', required: true },
  date: { key: 'date', kind: 'date', required: false, default: 'today' },
  note: { key: 'narration', kind: 'text', required: false },
  paid: (key, req) => ({ key, kind: 'pick', pick: 'mode', options: MODES, required: req !== false })
};
const CATALOGUE = [
  {
    kind: 'expense',
    words: 'Pay expense',
    icon: 'receipt',
    band: 'paid',
    voucher: 'Payment',
    ledger_group: 'expense',
    bill: true,
    fields: [{ key: 'class', kind: 'pick', pick: 'expense_class', required: true }, F.amount, F.paid('paid_from'), F.date, F.note]
  },
  {
    kind: 'other_income',
    words: 'Other income',
    icon: 'coins',
    band: 'received',
    voucher: 'Receipt',
    ledger_group: 'income',
    fields: [{ key: 'class', kind: 'pick', pick: 'income_class', required: true }, F.amount, F.paid('into'), F.date, F.note]
  },
  {
    kind: 'capital',
    words: 'Put money in',
    icon: 'wallet-in',
    band: 'owner',
    voucher: 'Receipt',
    ledger_group: 'capital',
    fields: [F.amount, F.paid('into'), F.date, F.note]
  },
  {
    kind: 'drawings',
    words: 'Took money out',
    icon: 'wallet-out',
    band: 'owner',
    voucher: 'Payment',
    ledger_group: 'capital',
    fields: [F.amount, F.paid('from'), F.date, F.note]
  },
  {
    kind: 'staff_advance',
    words: 'Staff advance',
    icon: 'person-out',
    band: 'staff',
    voucher: 'Payment',
    ledger_group: 'loans_advances_asset',
    fields: [{ key: 'ledger', kind: 'pick', pick: 'ledger', group: 'loans_advances_asset', required: true }, F.amount, F.paid('from'), F.date, F.note]
  },
  {
    kind: 'advance_recovered',
    words: 'Advance back',
    icon: 'person-in',
    band: 'staff',
    voucher: 'Receipt',
    ledger_group: 'loans_advances_asset',
    fields: [{ key: 'ledger', kind: 'pick', pick: 'ledger', group: 'loans_advances_asset', required: true }, F.amount, F.paid('into'), F.date, F.note]
  },
  {
    kind: 'debit_note',
    words: 'Note a difference',
    icon: 'receipt-minus',
    band: 'bought',
    voucher: 'Debit note',
    ledger_group: 'purchases',
    fields: [
      { key: 'supplier', kind: 'pick', pick: 'supplier', required: true },
      { key: 'against_ref', kind: 'text', required: true },
      { key: 'reason', kind: 'pick', pick: 'debit_reason', options: Object.keys(DEBIT_REASONS), required: false },
      { key: 'lines', kind: 'lines', required: true },
      F.date,
      F.note
    ]
  },
  {
    kind: 'contra',
    words: 'Move money',
    icon: 'swap',
    band: 'money',
    voucher: 'Contra',
    ledger_group: null,
    fields: [F.paid('from'), F.paid('to'), F.amount, F.date, F.note]
  },
  {
    kind: 'journal',
    words: 'Write a journal',
    icon: 'pen',
    band: 'adjust',
    voucher: 'Journal',
    ledger_group: null,
    fields: [{ key: 'lines', kind: 'lines', required: true }, { key: 'narration', kind: 'text', required: true }, F.date]
  }
];
/** events with their own routes today (books-period) — listed so the grid is complete; the screen calls `route`, and there is no preview for them yet */
const ROUTED = [
  { kind: 'asset', words: 'Bought an asset', icon: 'box', band: 'bought', route: 'POST /assets', preview: false, ledger_group: 'fixed_assets' },
  { kind: 'loan', words: 'Loan taken', icon: 'bank', band: 'loan', route: 'POST /loans', preview: false, ledger_group: 'loans_liability' },
  { kind: 'loan_emi', words: 'Instalment paid', icon: 'bank', band: 'loan', route: 'POST /loans/:ref/emi', preview: false, ledger_group: 'loans_liability' },
  { kind: 'closing_stock', words: 'Closing stock', icon: 'stock', band: 'adjust', route: 'POST /closing-stock', preview: false, ledger_group: null },
  { kind: 'accrual', words: 'Owed or prepaid', icon: 'clock', band: 'adjust', route: 'POST /accruals', preview: false, ledger_group: null },
  { kind: 'depreciation', words: 'Depreciation', icon: 'trend-down', band: 'adjust', route: 'POST /depreciation/run', preview: false, ledger_group: null },
  { kind: 'write_off', words: 'Bad debt', icon: 'x', band: 'adjust', route: 'POST /write-off', preview: false, ledger_group: null }
];
/** GET /events → the grid. Expense and income classes are the pack's own (EXPENSE_CLASSES / INCOME_CLASSES), so a country with other classes changes nothing here. */
function catalogue(settings) {
  const pack = books.packOf(settings);
  const klass = (list) => (list || []).map((item) => ({ role: item.role, code: item.code, name: item.name }));
  return {
    events: CATALOGUE.map((e) => Object.assign({ preview: true, post: 'POST /events' }, e)).concat(ROUTED),
    picks: { mode: MODES, expense_class: klass(pack.expense_classes), income_class: klass(pack.income_classes), blocked_credit: BLOCKED, debit_reason: Object.keys(DEBIT_REASONS) },
    pending: PENDING,
    golden: GOLDEN
  };
}

/* ── the two doors ────────────────────────────────────────────────────────────────────────────────────────────── */
/** { kind } or a bare kind string, with the fields beside it (or inside `event`) → the engine's event, built */
async function eventOf(entity, settings, input, by) {
  const payload = input && typeof input === 'object' ? input : {};
  const inner = payload.event && typeof payload.event === 'object' ? payload.event : null;
  const body = Object.assign({}, inner ? Object.assign({}, payload, inner) : payload);
  const kind = String((inner && (inner.kind || inner.type)) || (typeof payload.event === 'string' ? payload.event : '') || payload.kind || '').trim();
  if (!kind || !Object.prototype.hasOwnProperty.call(BUILD, kind)) throw ask('What happened? ' + Object.keys(BUILD).join(', ') + '.');
  const x = { entity, s: settings, cur: books.curOf(settings), by: by || null };
  const built = await BUILD[kind](x, body);
  return Object.assign({ kind }, built);
}

/** POST /events — the entry, posted by the one writer. A repeat of the same client_ref answers the first entry, duplicate: true. */
async function post(entity, settings, input, by) {
  const { kind, ev: event } = await eventOf(entity, settings, input, by);
  const posted = await books.postEntry(null, entity, event);
  return Object.assign({ kind }, posted);
}

/**
 * POST /preview — the journal the event WOULD post, from the same composeEntry; nothing is written and no number is taken.
 * → { ok, kind, voucher: { series, type }, date, lines: [{ code, ledger, party?, dr_minor, cr_minor, type, rule }], balanced, totals, credit, bill?, flags, refusals, code, duplicate }
 * A refusal (a locked month, a blocked credit, a missing answer, a co-assist) is a plain sentence in `refusals` with `ok: false` — a question the screen can show, not an error.
 */
async function preview(entity, settings, input, actor) {
  const actorInfo = actor || {};
  const out = {
    ok: false,
    kind: null,
    voucher: null,
    date: null,
    lines: [],
    balanced: false,
    totals: { dr_minor: 0, cr_minor: 0 },
    credit: null,
    bill: null,
    flags: [],
    refusals: [],
    code: null,
    duplicate: null
  };
  const refused = (e) => {
    out.refusals.push(e.message);
    out.code = out.code || (e.code && e.code !== 'BOOKS_REFUSED' && e.code !== 'BOOKS_BAD_REQUEST' ? e.code : null);
  };
  let built;
  try {
    built = await eventOf(entity, settings, input, actorInfo.by);
  } catch (e) {
    if (e && (e.refused || e.code === 'BOOKS_BAD_REQUEST')) {
      refused(e);
      return out;
    }
    throw e;
  }
  out.kind = built.kind;
  out.credit = built.meta.credit || null;
  out.bill = built.meta.bill || null;
  if (built.meta.flag) out.flags.push(built.meta.flag);
  if (actorInfo.owner === false) out.refusals.push('Only the owner may record this.');
  let c;
  try {
    c = await books.previewEntry(null, entity, built.ev);
  } catch (e) {
    if (e && (e.refused || e.code === 'PERIOD_LOCKED' || e.code === 'BOOKS_REFUSED')) {
      refused(e);
      return out;
    }
    throw e;
  }
  if (c.off) {
    out.refusals.push('The ledger is off.');
    return out;
  }
  const packs = booksEngines.packs();
  out.voucher = { series: c.voucher.series, type: c.voucher.type };
  out.date = c.when.date;
  out.duplicate = c.duplicate;
  out.lines = c.lines.map((item) => {
    const account = packs.accountOf(c.pack, item.code),
      side = item.dr_minor ? 'dr' : 'cr';
    return {
      code: item.code,
      ledger: (c.C.byCode.get(String(item.code)) || {}).name || (account && account.name) || item.code,
      party: item.party_id || undefined,
      dr_minor: item.dr_minor,
      cr_minor: item.cr_minor,
      type: account ? account.type : null,
      rule: account && GOLDEN[account.type] ? GOLDEN[account.type][side] : null
    };
  });
  out.totals = { dr_minor: c.posted.totals.dr_minor, cr_minor: c.posted.totals.cr_minor };
  out.balanced = out.totals.dr_minor === out.totals.cr_minor;
  out.ok = out.balanced && !out.refusals.length;
  return out;
}

module.exports = { BUILD, GOLDEN, BLOCKED, PENDING, MODES, DEBIT_REASONS, catalogue, eventOf, post, preview, givenLines };
