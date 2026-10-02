// @stage tested
// @stage-note [BOOKS v2] The owner's period-end entries (engines v1.14-v1.16): asset register, depreciation, closing stock, GST close and
// @stage-note challan, loans, accruals, contra. Every entry is BUILT BY THE POSTING ENGINE and written by postEntry; this file reads, asks, and shapes.
'use strict';
/**
 * lib/books-period.js — WHAT routes/books.js ASKS FOR AT A PERIOD END (PLAN "App wiring needed later"; year-book §9 gaps 1 and 4).
 *
 * ⭐ ONE CALCULATION. depreciationFor, gstSetOff, the closing-stock difference, the accrual's sides, the contra, the loan and
 *   the disposal are the posting engine's (lib/posting.js, adopted). Nothing here computes a line, a rate or a set-off: it
 *   READS the books (balanceAsAt) and the register, HANDS the engine what it asks for, and posts what the engine answers.
 * ⭐ COMPUTE ONCE, THEN READ (Athi, 2026-10-02): the figures a route shows are the engine's answer for the entry it posts.
 * ⭐ A CORRECTION ADDS A RECORD (DECISIONS, Books v2): nothing here edits an entry; a reversal is its own entry.
 * ⚠️ WHO MADE IT DECIDES THE SERIES (DECISIONS, voucher numbering): what a PERSON keys in — an asset, a disposal, a loan, an instalment, an
 *   accrual, a contra, a challan — goes through postEntry with `owner: true`, so its number is MJ/<fy>/<n> and the voucher TYPE beside it
 *   is whatever the engine's voucherTypeOf says for { manual: true } (Contra, Journal, Payment, Receipt, Purchase). What the ENGINE works out
 *   from the books — the year's depreciation, the month's GST set-off, the closing-stock difference, an accrual's reversal — is the system's
 *   JV/<fy>/<n> (the owner only presses the button). `strict_date: true`: a date typed into a locked month is REFUSED (PERIOD_LOCKED), never moved.
 * ⭐ A SECOND TAP NEVER POSTS TWICE: every entry carries a source_ref (the client_ref, or a natural key — the year's depreciation,
 *   the month's GST close, the challan number); postEntry answers a repeat with the FIRST entry and duplicate: true.
 */
const B = require('./books');
const E = require('./books-engines');
const S = require('./books-store');
const Assets = require('./books-assets');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FY = /^\d{4}-\d{2}$/;
const ask = (why) => { const e = new Error(why); e.code = 'BOOKS_BAD_REQUEST'; e.status = 400; return e; };
const refuse = (why, code) => { const e = new Error(why); e.code = code || 'BOOKS_REFUSED'; e.refused = true; return e; };
/* the shop's day, from the one reader the writer uses (typedDate), so a stubbed clock moves both */
const today = (s) => require('./books-hooks').dayOf(new Date(), (s && s.country) || 'IN');
const dp = (cur) => { try { const M = require('./money'); return M.decimals ? M.decimals(cur) : 2; } catch (_) { return 2; } };
const toMinor = (rupees, cur) => Math.round(Number(rupees) * Math.pow(10, dp(cur)));
const toRupees = (minor, cur) => Number(minor) / Math.pow(10, dp(cur));
const HEADS = ['cgst', 'sgst', 'igst', 'cess'];
const withEntity = (e, fn) => require('../db').withEntity(e, fn);

/** an amount in minor units (`<key>_minor`) or rupees (`<key>`) → a positive integer of minor units, else a plain question */
function amountOf(b, key, cur, opt) {
  const o = opt || {};
  let m = null;
  if (b[key + '_minor'] != null && b[key + '_minor'] !== '') m = Number(b[key + '_minor']);
  else if (b[key] != null && b[key] !== '') m = toMinor(b[key], cur);
  if (m == null) { if (o.optional) return null; throw ask(o.ask || 'How much?'); }
  if (!Number.isInteger(m) || m < 0 || (m === 0 && !o.zero)) throw ask(o.ask || 'The amount must be above nothing.');
  return m;
}
function dateOf(b, key, dflt) {
  const v = b[key || 'date'] == null || b[key || 'date'] === '' ? dflt : String(b[key || 'date']).slice(0, 10);
  if (!v || !DATE.test(v)) throw ask('Which date? Use YYYY-MM-DD.');
  return v;
}
const refOf = (b) => (b.client_ref ? String(b.client_ref).slice(0, 80) : null);

/** the one door every entry here goes through */
function postOwn(entity, ev, by, system) {
  return B.postEntry(null, entity, Object.assign({}, ev, { owner: !system, strict_date: true, by }));
}

/* ── reading the books through the engine ─────────────────────────────────────────────────────────────────────── */
/** the books as at a date: { accounts[code], byRole[role] } from CBLedger.balanceAsAt — never summed here */
async function balancesAt(h, entity, asOf) {
  const inp = await B.asAtInput(h, entity, asOf);
  const b = E.ledger().balanceAsAt(inp);
  const byRole = {};
  Object.keys(b.accounts || {}).forEach((c) => { const a = b.accounts[c]; if (a.role) byRole[a.role] = a; });
  return { accounts: b.accounts || {}, byRole, pack: inp.pack };
}
const netOf = (bal, role) => (bal.byRole[role] ? Number(bal.byRole[role].net_minor) : 0);

/** the month a date falls in must be open — the engine-side question is postingDateFor's, so the refusal is the same sentence */
async function mustBeOpen(h, entity, s, date) {
  await B.postingDateFor(h, entity, date, B.packOf(s), false, true, s);
}
function periodDates(s, fy, period) {
  if (!FY.test(String(fy || ''))) throw ask('Which financial year? e.g. 2026-27.');
  const p = Number(period);
  if (!Number.isInteger(p) || p < 1 || p > 12) throw ask('Which month of the year? 1 to 12.');
  const r = E.packs().periodRange(fy, p, B.packOf(s));
  if (!r) throw ask('That financial year or month is not one the books know.');
  return r;
}

/* ═══ 1. the asset register ═══════════════════════════════════════════════════════════════════════════════════════ */
const MODES = ['cash', 'bank', 'upi', 'card'];
function classOf(s, name) {
  const list = B.packOf(s).asset_classes || [];
  const c = list.find((x) => x.class === name);
  if (!c) throw ask('Which kind of asset? ' + list.map((x) => x.class).join(', ') + '.');
  return c;
}

/** GET /assets — the register, each asset's written-down value, and the books' own figure beside it */
async function listAssets(entity, s, asOf) {
  return withEntity(entity, async (h) => {
    await Assets.need(h, entity);
    const rows = await Assets.list(h, entity);
    const cur = (s && s.functional_currency) || 'INR';
    const live = rows.filter((a) => !a.disposed_on);
    const assets = rows.map((a) => Object.assign({}, a, { wdv_minor: a.disposed_on ? 0 : a.cost_minor - a.accumulated_minor }));
    const bal = await balancesAt(h, entity, asOf);
    const by = new Map();
    for (const a of live) {
      const c = by.get(a.asset_class) || { asset_class: a.asset_class, count: 0, cost_minor: 0, accumulated_minor: 0 };
      c.count += 1; c.cost_minor += a.cost_minor; c.accumulated_minor += a.accumulated_minor; by.set(a.asset_class, c);
    }
    const net_block = Array.from(by.values()).map((c) => {
      const def = classOf(s, c.asset_class);
      /* the books' own figures for the class, read through balanceAsAt: cost is a debit, accumulated depreciation a credit */
      const led_cost = netOf(bal, def.cost_role), led_acc = -netOf(bal, def.acc_role);
      return Object.assign({}, c, { wdv_minor: c.cost_minor - c.accumulated_minor, ledger_cost_minor: led_cost, ledger_accumulated_minor: led_acc,
        ledger_wdv_minor: led_cost - led_acc, agrees: led_cost === c.cost_minor && led_acc === c.accumulated_minor });
    });
    return { currency: cur, asOf, assets, net_block, total_wdv_minor: net_block.reduce((t, c) => t + c.wdv_minor, 0) };
  });
}

/** POST /assets — one added by hand: the engine's purchase_bill, accepted as an asset (cost to the class's PPE ledger), then the row */
async function addAsset(entity, s, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw ask('What is the asset called?');
  const cls = classOf(s, String(b.class || b.asset_class || ''));
  const cost = amountOf(b, 'cost', cur, { ask: 'What did it cost?' });
  const date = dateOf(b, 'date', today(s));
  const put = dateOf(b, 'put_to_use', date);
  if (put < date) throw ask('It cannot be put to use before it was bought.');
  const how = b.how == null ? '' : String(b.how);
  const party = b.party_id || b.party || null;
  if (!party && MODES.indexOf(how) < 0) throw ask('How was it paid? cash, bank, upi or card — or name the supplier it is owed to.');
  const ref = refOf(b);
  return withEntity(entity, async (h) => {
    await Assets.need(h, entity);
    const ev = { type: 'purchase_bill', accept: 'asset', asset_class: cls.class, date, currency: cur, ref: name,
      by_rate: [{ rate: 0, taxable: toRupees(cost, cur), cgst: 0, sgst: 0, igst: 0 }], paid: party ? {} : { [how]: toRupees(cost, cur) },
      narration: 'Asset bought: ' + name, source_ref: ref ? 'asset:' + ref : null };
    if (party) ev.party = String(party);
    const r = await postOwn(entity, ev, by);
    if (!r.ok) return r;
    const row = await Assets.add(h, entity, { name, asset_class: cls.class, cost_minor: cost, currency: cur, put_to_use: put, source_entry_id: r.entry_id, by });
    return Object.assign({}, r, { asset: row && Object.assign({}, row, { wdv_minor: row.cost_minor - row.accumulated_minor }) });
  });
}

/** POST /assets/:id/dispose — the engine's asset_disposal: accumulated and cost off, the balance a profit or a loss on sale */
async function disposeAsset(entity, s, id, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const date = dateOf(b, 'date', today(s));
  const proceeds = amountOf(b, 'proceeds', cur, { optional: true, zero: true, ask: 'What did it fetch?' }) || 0;
  const how = b.into == null ? (proceeds ? 'bank' : 'cash') : String(b.into);
  if (proceeds && MODES.indexOf(how) < 0 && !b.party_id) throw ask('Where did the money come in? cash, bank, upi or card.');
  return withEntity(entity, async (h) => {
    await Assets.need(h, entity);
    const a = await Assets.get(h, entity, id);
    if (!a) { const e = new Error('No such asset.'); e.code = 'BOOKS_NOT_FOUND'; throw e; }
    if (a.disposed_on) return { ok: true, duplicate: true, asset: a, entry_id: a.disposal_entry_id };
    if (date < a.put_to_use) throw ask('It cannot be disposed of before it was put to use (' + a.put_to_use + ').');
    const ev = { type: 'asset_disposal', asset_class: a.asset_class, cost: toRupees(a.cost_minor, a.currency), accumulated: toRupees(a.accumulated_minor, a.currency),
      proceeds: toRupees(proceeds, a.currency), date, currency: a.currency, ref: a.name, narration: (proceeds ? 'Asset sold: ' : 'Asset scrapped: ') + a.name,
      source_ref: 'asset-dispose:' + a.asset_id };
    if (b.party_id) ev.party = String(b.party_id); else if (proceeds) ev.into = how;
    const r = await postOwn(entity, ev, by);
    if (!r.ok) return r;
    await Assets.markDisposed(h, entity, a.asset_id, date, r.entry_id, proceeds);
    return Object.assign({}, r, { asset: Object.assign({}, a, { disposed_on: date, disposal_entry_id: r.entry_id, proceeds_minor: proceeds, wdv_minor: 0 }) });
  });
}

/* ═══ 2. depreciation ═════════════════════════════════════════════════════════════════════════════════════════════ */
/**
 * POST /depreciation/run { fy } — the register → the engine's depreciationFor → ONE entry at the year end.
 * ⚠️ The entity basis is Athi's OPEN decision: books.entity_basis if the shop has it, else 'proprietor' (Income-tax WDV) — and the
 *   answer SAYS which and why (basis_assumed), never guessed from a PAN. A company also needs its method (slm | wdv).
 */
async function runDepreciation(entity, s, b, by) {
  const fy = String(b.fy || '');
  if (!FY.test(fy)) throw ask('Which financial year? e.g. 2026-27.');
  const pack = B.packOf(s), rg = E.packs().fyRange(fy, pack);
  if (!rg) throw ask('That financial year is not one the books know.');
  const known = B.entityBasisOf(s);
  const basis = known || 'proprietor';
  const note = known ? null : 'The entity type is not set for this shop yet, so depreciation was worked as a proprietor (Income-tax Act written-down value). Set books.entity_basis to change it.';
  const source_ref = 'depreciation:' + fy;
  return withEntity(entity, async (h) => {
    await Assets.need(h, entity);
    const seen = await S.entryBySource(h, entity, source_ref);
    if (seen) return { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no, posting_date: E.ymd(seen.posting_date), fy, entity_basis: basis, basis_assumed: !known, entity_note: note };
    if (rg.end > today(s)) throw refuse('Depreciation for ' + fy + ' runs at the year end (' + rg.end + ') or after — the year has not ended.');
    const reg = await Assets.list(h, entity);
    const cur = (s && s.functional_currency) || 'INR';
    const inYear = reg.filter((a) => a.put_to_use <= rg.end && (!a.disposed_on || a.disposed_on >= rg.start));
    if (!inYear.length) return { ok: true, nothing_to_post: true, fy, entity_basis: basis, basis_assumed: !known, entity_note: note, why: 'There are no assets in the register for ' + fy + '.' };
    await mustBeOpen(h, entity, s, rg.end);
    const assets = inYear.map((a) => {
      const x = { id: a.asset_id, class: a.asset_class, cost: toRupees(a.cost_minor, a.currency), put_to_use: a.put_to_use };
      if (a.put_to_use < rg.start) x.opening_wdv = toRupees(a.cost_minor - a.accumulated_minor, a.currency);
      if (a.disposed_on) x.sold = { proceeds: toRupees(a.proceeds_minor || 0, a.currency) };
      return x;
    });
    const dep = E.posting().depreciationFor({ entity: basis, method: s && s.depreciation_method ? String(s.depreciation_method) : undefined, fiscal_year: fy, date: rg.end,
      ref: 'DEP-' + fy, assets, pack });
    if (!dep.ok) throw refuse(dep.why);
    const base = { ok: true, fy, entity_basis: basis, basis_assumed: !known, entity_note: note, basis_rule: dep.basis, by_class: dep.by_class, by_asset: dep.by_asset };
    if (!dep.event) return Object.assign(base, { nothing_to_post: true, why: 'Nothing to depreciate for ' + fy + '.' });
    const ev = Object.assign({}, dep.event, { currency: cur, narration: 'Depreciation ' + fy + ' (' + dep.basis + ')', source_ref });
    const r = await postOwn(entity, ev, by, true);
    if (!r.ok) return r;
    for (const a of dep.by_asset) await Assets.addDepreciation(h, entity, a.id, toMinor(a.amount, cur), fy);
    return Object.assign(base, r);
  });
}

/* ═══ 3. closing stock ════════════════════════════════════════════════════════════════════════════════════════════ */
/** POST /closing-stock { date, value_minor, nrv_minor?, method } — only the DIFFERENCE from the books posts (the engine reads `book`) */
async function closingStock(entity, s, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const date = dateOf(b, 'date');
  const mode = b.method == null ? 'manual' : String(b.method);
  if (mode !== 'manual' && mode !== 'automatic') throw ask("The closing stock is entered by hand ('manual'); 'automatic' needs quantities, which are not kept yet.");
  const value = amountOf(b, 'value', cur, { zero: true, ask: 'What is the stock on hand worth?' });
  const nrv = amountOf(b, 'nrv', cur, { optional: true, zero: true });
  const ref = refOf(b);
  return withEntity(entity, async (h) => {
    const bal = await balancesAt(h, entity, date);
    const book = netOf(bal, 'stock');
    const ev = { type: 'closing_stock', mode, date, currency: cur, book: toRupees(book, cur), method: b.cost_formula || undefined,
      narration: 'Closing stock ' + date, source_ref: ref ? 'stock:' + ref : null };
    if (nrv != null) { ev.cost = toRupees(value, cur); ev.nrv = toRupees(nrv, cur); } else ev.amount = toRupees(value, cur);
    const r = await postOwn(entity, ev, by, true);
    return Object.assign({ book_minor: book }, r);
  });
}

/* ═══ 4. GST month close and the challan ══════════════════════════════════════════════════════════════════════════ */
const minorHeads = (o, cur) => { const m = {}; HEADS.forEach((k) => { m[k + '_minor'] = toMinor(o[k] || 0, cur); }); return m; };
/** a balance is read at a month end (the books' rows) or at the shop's today — never at a mid-month day with later entries in that month, which the engine cannot cut */
function settledAsOf(s, date) {
  const pack = B.packOf(s), A = E.packs(), end = A.periodRange(A.fiscalYearOf(date, pack), A.periodOf(date, pack), pack).end;
  return end > today(s) ? today(s) : end;
}
async function gstBalances(h, entity, asOf) {
  const bal = await balancesAt(h, entity, asOf);
  const output = {}, input = {};
  HEADS.forEach((k) => {
    const o = netOf(bal, 'output_' + k), i = netOf(bal, 'input_' + k);
    output[k] = o < 0 ? -o : 0;       /* output tax is a credit balance; a debit one is nothing to set off against */
    input[k] = i > 0 ? i : 0;         /* input credit is a debit balance */
  });
  return { output, input };
}
/** POST /gst/close { fy, period } — the six head balances (+ cess) → gstSetOff (s.49 order) → the set-off entry; then what is left to pay by challan */
async function gstClose(entity, s, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const rg = periodDates(s, b.fy, b.period);
  const source_ref = 'gstclose:' + b.fy + ':' + Number(b.period);
  return withEntity(entity, async (h) => {
    if (rg.end > today(s)) throw refuse('Month ' + Number(b.period) + ' of ' + b.fy + ' ends on ' + rg.end + ' — close it once it has ended.');
    await mustBeOpen(h, entity, s, rg.end);
    const seen = await S.entryBySource(h, entity, source_ref);
    const g = await gstBalances(h, entity, rg.end);
    const rup = (o) => { const x = {}; HEADS.forEach((k) => { x[k] = toRupees(o[k], cur); }); if (!x.cess) delete x.cess; return x; };
    const hasCess = g.output.cess > 0 || g.input.cess > 0;
    const so = E.posting().gstSetOff({ ref: 'GSTSO-' + b.fy + '-P' + String(Number(b.period)).padStart(2, '0'), date: rg.end, period: Number(b.period), currency: cur,
      output: hasCess ? Object.assign(rup(g.output), { cess: toRupees(g.output.cess, cur) }) : rup(g.output), input: hasCess ? Object.assign(rup(g.input), { cess: toRupees(g.input.cess, cur) }) : rup(g.input) });
    if (!so.ok) throw refuse(so.why);
    const payable = {}, carried = {};
    HEADS.forEach((k) => { payable[k + '_minor'] = toMinor(so.payable[k] || 0, cur); carried[k + '_minor'] = toMinor(so.carried[k] || 0, cur); });
    const out = { fy: b.fy, period: Number(b.period), date: rg.end, utilised: so.utilised.map((u) => ({ from: u.from, against: u.against, amount_minor: toMinor(u.amount, cur) })),
      payable_minor: payable, carried_minor: carried, pay_total_minor: HEADS.reduce((t, k) => t + payable[k + '_minor'], 0) };
    if (seen) return Object.assign(out, { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no });
    if (!so.utilised.length) return Object.assign(out, { ok: true, nothing_to_set_off: true });
    const r = await postOwn(entity, Object.assign({}, so.event, { narration: 'GST set-off ' + b.fy + ' month ' + Number(b.period), source_ref }), by, true);
    return Object.assign(out, r);
  });
}
/** POST /gst/pay { fy, period, amounts: { cgst_minor … }, bank, challan_no, date? } → the engine's gst_payment (Dr output tax · Cr the bank) */
async function gstPay(entity, s, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const rg = periodDates(s, b.fy, b.period);
  const challan = String(b.challan_no || '').trim().slice(0, 40);
  if (!challan) throw ask('Which challan? Give its number (the CPIN).');
  const mode = String(b.bank || b.mode || 'bank');
  if (MODES.indexOf(mode) < 0) throw ask('Paid from where? bank, upi, cash or card.');
  const date = dateOf(b, 'date', rg.end);
  const am = b.amounts && typeof b.amounts === 'object' ? b.amounts : {};
  const heads = {}, minor = {};
  HEADS.forEach((k) => {
    const v = am[k + '_minor'] != null ? Number(am[k + '_minor']) : am[k] != null ? toMinor(am[k], cur) : 0;
    if (!Number.isInteger(v) || v < 0) throw ask('The ' + k.toUpperCase() + ' amount must be a plain amount, not below nothing.');
    if (v) { minor[k] = v; heads[k] = toRupees(v, cur); }
  });
  if (!Object.keys(heads).length) throw ask('How much was paid? Give the amount for at least one tax.');
  return withEntity(entity, async (h) => {
    await mustBeOpen(h, entity, s, date);
    const source_ref = 'gstpay:' + challan;
    if (!(await S.entryBySource(h, entity, source_ref))) {
      /* a slip of the finger (100x) is caught against what is owed — read from the books, never typed */
      const g = await gstBalances(h, entity, settledAsOf(s, date));
      const over = Object.keys(minor).filter((k) => minor[k] > g.output[k]);
      if (over.length) throw refuse('That is more than the tax owed — ' + over.map((k) => k.toUpperCase() + ' owed ' + toRupees(g.output[k], cur) + ', paid ' + toRupees(minor[k], cur)).join('; ') + '. Run the month close first, or correct the amount.');
    }
    const r = await postOwn(entity, { type: 'gst_payment', mode, heads, date, currency: cur, ref: challan, narration: 'GST challan ' + challan, source_ref }, by);
    return Object.assign({ challan_no: challan, paid_minor: minor }, r);
  });
}

/* ═══ 5. loans ════════════════════════════════════════════════════════════════════════════════════════════════════ */
const LOAN_ROLE = { secured: 'secured_loan', unsecured: 'unsecured_loan', overdraft: 'bank_od' };
const LOAN_ROLES = Object.keys(LOAN_ROLE).map((k) => LOAN_ROLE[k]);
/** POST /loans { ref|client_ref, lender, amount, into, rate?, kind? } — a loan TAKEN: Dr where the money came in · Cr the loan account */
async function takeLoan(entity, s, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const ref = String(b.ref || b.client_ref || '').trim().slice(0, 60);
  if (!ref) throw ask('Give the loan a reference you will know it by (the sanction letter or loan number).');
  const lender = String(b.lender || '').trim().slice(0, 120);
  if (!lender) throw ask('Who is the lender?');
  const amount = amountOf(b, 'amount', cur, { ask: 'How much was the loan?' });
  const into = String(b.into || b.bank || 'bank');
  if (MODES.indexOf(into) < 0) throw ask('Where did the money come in? bank, upi, cash or card.');
  const kind = b.kind == null ? 'secured' : String(b.kind);
  if (!LOAN_ROLE[kind]) throw ask('Is it secured, unsecured or an overdraft?');
  let rate = null;
  if (b.rate != null && b.rate !== '') { rate = Number(b.rate); if (!(rate >= 0 && rate <= 100)) throw ask('The interest rate is a percentage a year, between 0 and 100.'); }
  const date = dateOf(b, 'date', today(s));
  return postOwn(entity, { type: 'loan_taken', loan: LOAN_ROLE[kind], into, amount: toRupees(amount, cur), date, currency: cur, ref,
    narration: 'Loan from ' + lender + (rate != null ? ' at ' + rate + '% a year' : ''), source_ref: 'loan:' + ref }, by);
}
/** POST /loans/:ref/emi { principal, interest, from?, date, client_ref } — the bank's split AS GIVEN: Dr the loan · Dr interest · Cr the bank */
async function loanEmi(entity, s, ref, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const cref = refOf(b);
  if (!cref) throw ask('Give this instalment a reference (the month, or the bank\'s number) so a second tap does not record it twice.');
  const principal = amountOf(b, 'principal', cur, { optional: true, zero: true }) || 0;
  const interest = amountOf(b, 'interest', cur, { optional: true, zero: true }) || 0;
  if (!principal && !interest) throw ask('How much of the instalment was the loan and how much interest? Give the split from the bank.');
  const from = String(b.from || b.bank || 'bank');
  if (MODES.indexOf(from) < 0) throw ask('Paid from where? bank, upi, cash or card.');
  const date = dateOf(b, 'date', today(s));
  return withEntity(entity, async (h) => {
    const loan = await S.entryBySource(h, entity, 'loan:' + ref);
    if (!loan) { const e = new Error('No loan with that reference.'); e.code = 'BOOKS_NOT_FOUND'; throw e; }
    const full = await S.entry(h, entity, loan.entry_id), chart = await S.accounts(h, entity);
    const acct = (full.lines || []).map((l) => chart.find((a) => String(a.account_id) === String(l.account_id))).find((a) => a && LOAN_ROLES.indexOf(a.role) >= 0);
    if (!acct) throw refuse('That entry is not a loan.');
    return postOwn(entity, { type: 'loan_repaid', loan: acct.role, principal: toRupees(principal, cur), interest: toRupees(interest, cur), from, date, currency: cur, ref: ref + '/' + cref,
      narration: 'Instalment on loan ' + ref, source_ref: 'emi:' + ref + ':' + cref }, by);
  });
}

/* ═══ 6. accruals ═════════════════════════════════════════════════════════════════════════════════════════════════ */
const ACCRUALS = ['outstanding', 'prepaid', 'accrued_income', 'income_in_advance'];
/** the first day of the period after the one `date` falls in — where the accrual turns back */
function reversalDate(s, date) {
  const pack = B.packOf(s), A = E.packs(), fy = A.fiscalYearOf(date, pack), p = A.periodOf(date, pack);
  return B.addDays(A.periodRange(fy, p, pack).end, 1);
}
/** POST /accruals { ref|client_ref, kind, class, amount, date } — at a period end; it comes back on the first day of the next period (reverses_on) */
async function accrue(entity, s, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const ref = String(b.ref || b.client_ref || '').trim().slice(0, 60);
  if (!ref) throw ask('Give the accrual a reference (e.g. ELEC-2026-09).');
  const kind = String(b.kind || '');
  if (ACCRUALS.indexOf(kind) < 0) throw ask('Is it an outstanding expense, a prepaid expense, income accrued, or income received in advance?');
  const cls = String(b.class || '').trim();
  if (!cls) throw ask('Which expense or income ledger is it for?');
  const amount = amountOf(b, 'amount', cur, { ask: 'How much?' });
  const date = dateOf(b, 'date', today(s));
  const r = await postOwn(entity, { type: 'accrual', kind, class: cls, amount: toRupees(amount, cur), date, currency: cur, ref,
    narration: String(b.narration || '').trim().slice(0, 200) || 'Accrual ' + ref, source_ref: 'accrual:' + ref }, by);
  return Object.assign({ ref, kind, reverses_on: reversalDate(s, date) }, r);
}
/** POST /accruals/:ref/reverse { date?, client_ref? } — the engine's own reversal (reverse: true, reverses: ref); due from the first day of the next period */
async function reverseAccrual(entity, s, ref, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  return withEntity(entity, async (h) => {
    const head = await S.entryBySource(h, entity, 'accrual:' + ref);
    if (!head) { const e = new Error('No accrual with that reference.'); e.code = 'BOOKS_NOT_FOUND'; throw e; }
    const full = await S.entry(h, entity, head.entry_id), chart = await S.accounts(h, entity);
    const lines = (full.lines || []).map((l) => Object.assign({}, l, { acct: chart.find((a) => String(a.account_id) === String(l.account_id)) || {} }));
    const roles = lines.map((l) => l.acct.role);
    const kind = roles.indexOf('prepaid_expenses') >= 0 ? 'prepaid' : roles.indexOf('accrued_income') >= 0 ? 'accrued_income' : roles.indexOf('income_in_advance') >= 0 ? 'income_in_advance' : 'outstanding';
    const fixed = kind === 'prepaid' ? 'prepaid_expenses' : kind === 'accrued_income' ? 'accrued_income' : kind === 'income_in_advance' ? 'income_in_advance' : null;
    const other = lines.find((l) => (fixed ? l.acct.role !== fixed : (l.dr_minor > 0))) || lines[0];
    const due = reversalDate(s, E.ymd(full.posting_date));
    const date = dateOf(b, 'date', due);
    if (date < due) throw refuse('This accrual turns back on ' + due + ', the first day of the next month — not before.');
    if (date > today(s)) throw refuse('This accrual turns back on ' + date + ' — it is not due yet.');
    return postOwn(entity, { type: 'accrual', kind, class: other.acct.code, amount: toRupees(full.total_minor, cur), date, currency: cur, reverse: true, reverses: ref, ref: ref + '/rev',
      narration: 'Reversal of accrual ' + ref, source_ref: 'accrual-rev:' + ref }, by, true);
  });
}

/* ═══ 7. contra ═══════════════════════════════════════════════════════════════════════════════════════════════════ */
/** POST /contra { from, to, amount, date, client_ref } — cash ↔ bank ↔ UPI (the engine refuses the same account on both sides) */
async function contra(entity, s, b, by) {
  const cur = (s && s.functional_currency) || 'INR';
  const from = String(b.from || '').trim(), to = String(b.to || '').trim();
  if (!from || !to) throw ask('Moved from where, to where? cash, bank, upi or card.');
  const amount = amountOf(b, 'amount', cur, { ask: 'How much was moved?' });
  const date = dateOf(b, 'date', today(s));
  const ref = refOf(b);
  return postOwn(entity, { type: 'contra', from, to, amount: toRupees(amount, cur), date, currency: cur,
    narration: String(b.narration || '').trim().slice(0, 200) || 'Moved from ' + from + ' to ' + to, source_ref: ref ? 'contra:' + ref : null }, by);
}

module.exports = { listAssets, addAsset, disposeAsset, runDepreciation, closingStock, gstClose, gstPay, takeLoan, loanEmi, accrue, reverseAccrual, contra, reversalDate, ask };
