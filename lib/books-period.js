// @stage tested
// @stage-note [BOOKS v2] The owner's period-end entries (engines v1.14-v1.16): asset register, depreciation, closing stock, GST close and
// @stage-note challan, loans, accruals, contra. Every entry is BUILT BY THE POSTING ENGINE and written by postEntry; this file reads, asks, and shapes.
'use strict';
const CLOCK = require('./shop-clock');
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
const today = (s) => require('./books-hooks').dayOf(CLOCK.now(), s || 'IN');
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
  return balancesOf(E.ledger().balanceAsAt(inp), inp.pack);
}
/** the engine's balanceAsAt answer shaped { accounts, byRole, pack } — F3 (lib/books-cashflow) reads the ledger ONCE and hands it in here, so there is no second read */
function balancesOf(b, pack) {
  const byRole = {};
  Object.keys((b && b.accounts) || {}).forEach((c) => { const a = b.accounts[c]; if (a.role) byRole[a.role] = a; });
  return { accounts: (b && b.accounts) || {}, byRole, pack };
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
async function gstBalances(h, entity, asOf, pre) {
  const bal = pre || await balancesAt(h, entity, asOf);   /* pre: balances already read (balancesOf) — F3 hands them in */
  const output = {}, input = {};
  HEADS.forEach((k) => {
    const o = netOf(bal, 'output_' + k), i = netOf(bal, 'input_' + k);
    output[k] = o < 0 ? -o : 0;       /* output tax is a credit balance; a debit one is nothing to set off against */
    input[k] = i > 0 ? i : 0;         /* input credit is a debit balance */
  });
  /* ⭐ REVERSE CHARGE (engines v1.20.0): what the shop owes on purchases it bought under reverse charge — the credit balance of 2204–2206. It is paid in CASH only
     (s.49(4), Rule 86(2)): no credit is used against it, so the engine adds it to the challan beside what the forward tax left. */
  const rcm = {};
  ['cgst', 'sgst', 'igst'].forEach((k) => { const r = netOf(bal, 'rcm_' + k); rcm[k] = r < 0 ? -r : 0; });
  return { output, input, rcm };
}
/**
 * ⭐ F3 (CB Finance · cash position): what the posted GST ledgers say is OWED as at a date, after the set-off — the SAME arithmetic gstClose posts
 * (gstBalances → CBPosting.gstSetOff in the pack's s.49 order; reverse charge joins in cash, never set off), READ and never written.
 * `pre` = the ledger balances already read (balancesOf), so the caller reads the ledger once. → { payable_minor, heads: { cgst_minor … } | null, rcm_minor | null, why }
 * A set-off the engine refuses answers payable_minor 0 with the engine's sentence in `why` — a cash forecast never invents a tax figure.
 */
async function gstPayableAt(h, entity, s, asOf, pre) {
  const cur = (s && s.functional_currency) || 'INR';
  const g = await gstBalances(h, entity, asOf, pre);
  const rup = (o) => { const x = {}; HEADS.forEach((k) => { x[k] = toRupees(o[k], cur); }); if (!x.cess) delete x.cess; return x; };
  const hasCess = g.output.cess > 0 || g.input.cess > 0, hasRcm = g.rcm.cgst > 0 || g.rcm.sgst > 0 || g.rcm.igst > 0;
  const so = E.posting().gstSetOff({ ref: 'CASH-' + asOf, date: asOf, currency: cur, country: (s && s.country) || undefined,
    output: hasCess ? Object.assign(rup(g.output), { cess: toRupees(g.output.cess, cur) }) : rup(g.output), input: hasCess ? Object.assign(rup(g.input), { cess: toRupees(g.input.cess, cur) }) : rup(g.input),
    rcm: hasRcm ? { cgst: toRupees(g.rcm.cgst, cur), sgst: toRupees(g.rcm.sgst, cur), igst: toRupees(g.rcm.igst, cur) } : undefined });
  if (!so.ok) return { payable_minor: 0, heads: null, rcm_minor: null, why: so.why || 'The GST set-off could not be worked out.' };
  const heads = {}; let total = 0;
  HEADS.forEach((k) => { heads[k + '_minor'] = toMinor(so.payable[k] || 0, cur); total += heads[k + '_minor']; });
  let rcm = null;
  if (hasRcm) { rcm = {}; ['cgst', 'sgst', 'igst'].forEach((k) => { rcm[k + '_minor'] = toMinor(so.rcm[k], cur); total += rcm[k + '_minor']; }); }
  return { payable_minor: total, heads, rcm_minor: rcm, why: null };
}
/* ⭐ CX0 (2026-10-13): the set-off order (s.49) and the CPIN challan are India's own (reg-in `setOff` · `messages`). Another country's shop
   is refused in words, not posted an Indian close on a fallback chart — its own return is read under Returns (BAS · VAT201). */
function indiaOnly(s, what) {
  const p = B.packOf(s);
  if (p.fallback || String(p.id || p.country || '').toUpperCase() !== 'IN') throw refuse(what + ' is India\'s GST (s.49). Your own return is prepared under Returns.', 'NOT_FOR_COUNTRY');
}
/** POST /gst/close { fy, period } — the six head balances (+ cess) → gstSetOff (s.49 order) → the set-off entry; then what is left to pay by challan */
async function gstClose(entity, s, b, by) {
  indiaOnly(s, 'The month\'s GST set-off');
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
    const hasRcm = g.rcm.cgst > 0 || g.rcm.sgst > 0 || g.rcm.igst > 0;
    const so = E.posting().gstSetOff({ ref: 'GSTSO-' + b.fy + '-P' + String(Number(b.period)).padStart(2, '0'), date: rg.end, period: Number(b.period), currency: cur,
      output: hasCess ? Object.assign(rup(g.output), { cess: toRupees(g.output.cess, cur) }) : rup(g.output), input: hasCess ? Object.assign(rup(g.input), { cess: toRupees(g.input.cess, cur) }) : rup(g.input),
      rcm: hasRcm ? { cgst: toRupees(g.rcm.cgst, cur), sgst: toRupees(g.rcm.sgst, cur), igst: toRupees(g.rcm.igst, cur) } : undefined });
    if (!so.ok) throw refuse(so.why);
    const payable = {}, carried = {};
    HEADS.forEach((k) => { payable[k + '_minor'] = toMinor(so.payable[k] || 0, cur); carried[k + '_minor'] = toMinor(so.carried[k] || 0, cur); });
    const out = { fy: b.fy, period: Number(b.period), date: rg.end, utilised: so.utilised.map((u) => ({ from: u.from, against: u.against, amount_minor: toMinor(u.amount, cur) })),
      payable_minor: payable, carried_minor: carried, pay_total_minor: HEADS.reduce((t, k) => t + payable[k + '_minor'], 0) };
    if (hasRcm) {       /* the reverse-charge liability joins the challan, in cash, never set off — the engine's own `cash` per head */
      out.rcm_minor = {}; out.cash_minor = {};
      ['cgst', 'sgst', 'igst'].forEach((k) => { out.rcm_minor[k] = toMinor(so.rcm[k], cur); out.cash_minor[k] = toMinor(so.cash[k], cur); });
      out.pay_total_minor += out.rcm_minor.cgst + out.rcm_minor.sgst + out.rcm_minor.igst;
    }
    if (seen) return Object.assign(out, { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no });
    if (!so.utilised.length) return Object.assign(out, { ok: true, nothing_to_set_off: true });
    const r = await postOwn(entity, Object.assign({}, so.event, { narration: 'GST set-off ' + b.fy + ' month ' + Number(b.period), source_ref }), by, true);
    return Object.assign(out, r);
  });
}
/** POST /gst/pay { fy, period, amounts: { cgst_minor … }, bank, challan_no, date? } → the engine's gst_payment (Dr output tax · Cr the bank) */
async function gstPay(entity, s, b, by) {
  indiaOnly(s, 'A GST challan payment');
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
  /* reverse-charge liability paid by the same challan: { rcm: { cgst_minor, sgst_minor, igst_minor } } → Dr RCM payable · Cr the bank */
  const rb = b.rcm && typeof b.rcm === 'object' ? b.rcm : {}, rcm = {}, rcmMinor = {};
  ['cgst', 'sgst', 'igst'].forEach((k) => {
    const v = rb[k + '_minor'] != null ? Number(rb[k + '_minor']) : rb[k] != null ? toMinor(rb[k], cur) : 0;
    if (!Number.isInteger(v) || v < 0) throw ask('The reverse-charge ' + k.toUpperCase() + ' amount must be a plain amount, not below nothing.');
    if (v) { rcmMinor[k] = v; rcm[k] = toRupees(v, cur); }
  });
  if (!Object.keys(heads).length && !Object.keys(rcm).length) throw ask('How much was paid? Give the amount for at least one tax.');
  return withEntity(entity, async (h) => {
    await mustBeOpen(h, entity, s, date);
    const source_ref = 'gstpay:' + challan;
    if (!(await S.entryBySource(h, entity, source_ref))) {
      /* a slip of the finger (100x) is caught against what is owed — read from the books, never typed */
      const g = await gstBalances(h, entity, settledAsOf(s, date));
      const over = Object.keys(minor).filter((k) => minor[k] > g.output[k]);
      const overRcm = Object.keys(rcmMinor).filter((k) => rcmMinor[k] > g.rcm[k]);
      if (overRcm.length) throw refuse('That is more than the reverse-charge tax owed — ' + overRcm.map((k) => k.toUpperCase() + ' owed ' + toRupees(g.rcm[k], cur) + ', paid ' + toRupees(rcmMinor[k], cur)).join('; ') + '.');
      if (over.length) throw refuse('That is more than the tax owed — ' + over.map((k) => k.toUpperCase() + ' owed ' + toRupees(g.output[k], cur) + ', paid ' + toRupees(minor[k], cur)).join('; ') + '. Run the month close first, or correct the amount.');
    }
    const r = await postOwn(entity, { type: 'gst_payment', mode, heads, rcm: Object.keys(rcm).length ? rcm : undefined, date, currency: cur, ref: challan, narration: 'GST challan ' + challan, source_ref }, by);
    return Object.assign({ challan_no: challan, paid_minor: minor }, Object.keys(rcmMinor).length ? { rcm_paid_minor: rcmMinor } : {}, r);
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
/** the engine's contra event for a typed move — ONE builder, read by the POST /contra route and by the "＋ Entry" preview */
function contraEvent(s, b) {
  const cur = (s && s.functional_currency) || 'INR';
  const from = String(b.from || '').trim(), to = String(b.to || '').trim();
  if (!from || !to) throw ask('Moved from where, to where? cash, bank, upi or card.');
  const amount = amountOf(b, 'amount', cur, { ask: 'How much was moved?' });
  const date = dateOf(b, 'date', today(s));
  const ref = refOf(b);
  return { type: 'contra', from, to, amount: toRupees(amount, cur), date, currency: cur,
    narration: String(b.narration || '').trim().slice(0, 200) || 'Moved from ' + from + ' to ' + to, source_ref: ref ? 'contra:' + ref : null };
}
async function contra(entity, s, b, by) { return postOwn(entity, contraEvent(s, b), by); }

/* ═══ THE SHOP'S OWN RETURN (BAS1, engines v1.39.0) — BAS (AU) · VAT201 (AE): a READ of the posted books, dispatched to the pack by gst-returns.returnFor ═══
   Nothing is recomputed here: the period's movements are the account_balance rows the writer already keeps (one per account per month), summed by code and
   handed to the engine by ROLE; the engine's `roles` on each box are joined back to the shop's chart so every figure opens the ledgers it counts.
   India is refused by name — its GSTR-1 / 3B are read from the frozen invoices on the rail (routes/tax.js GET /api/tax/gstr), not from the ledgers. */
const GR = () => require('./gst-returns');
const PREPARED = 'Prepared, not lodged';
const nextMonth = (ymd) => { const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)); return (m === 12 ? y + 1 : y) + '-' + String(m === 12 ? 1 : m + 1).padStart(2, '0') + '-01'; };
/** the pack's period table (gst-returns.periodsFor), for the year that holds `day` and the one before — AU by financial year, AE by the FTA stagger (never guessed) */
function returnPeriods(pack, q, day) {
  const A = E.packs(), R = pack.returns || {};
  if (R.id === 'BAS') {
    const fy = A.fiscalYearOf(day, pack), prev = A.fiscalYearOf(B.addDays(A.fyRange(fy, pack).start, -1), pack), frequency = q.frequency === 'monthly' ? 'monthly' : 'quarterly', out = [];
    for (const y of [prev, fy]) { const r = GR().periodsFor(pack, { fy: y, frequency }); if (!r.ok) throw refuse(r.why); out.push(...r.periods); }
    return { periods: out, asked: { frequency } };
  }
  if (R.id === 'VAT201') {
    const stagger = q.stagger == null || q.stagger === '' ? null : String(q.stagger).toLowerCase(), year = Number(day.slice(0, 4)), out = [];
    if (!stagger) { const none = GR().periodsFor(pack, { year }); return { periods: [], asked: { stagger: null }, needs: 'stagger', why: none.why }; }
    for (const y of [year - 1, year]) { const r = GR().periodsFor(pack, { stagger, year: y }); if (!r.ok) throw refuse(r.why); out.push(...r.periods); }
    return { periods: out, asked: { stagger: /^\d$/.test(stagger) ? Number(stagger) : stagger } };
  }
  return { periods: [], asked: {} };
}
/** the period's ledger MOVEMENTS by account — the monthly balance rows (party-less grain) of every month from `start` to `end`, summed by code; roles from the chart */
async function movementsBetween(h, entity, c, start, end) {
  const A = E.packs(), months = [], byCode = Object.create(null);
  for (let d = start.slice(0, 7) + '-01'; d <= end; d = nextMonth(d)) months.push({ fy: A.fiscalYearOf(d, c.pack), period: Number(A.periodOf(d, c.pack)) });
  for (const fy of Array.from(new Set(months.map((m) => m.fy)))) {
    if (c.years.length && c.years.indexOf(fy) < 0) continue;                                          /* a year with no rows at all: nothing moved */
    (await S.yearRows(h, entity, fy)).map((r) => E.balanceOf(r, S.ZERO)).forEach((r) => {
      if (r.party || !months.some((m) => m.fy === fy && m.period === Number(r.period))) return;        /* the account grain only — the party rows are the same money again */
      const a = byCode[r.code] || (byCode[r.code] = { dr: 0, cr: 0 }); a.dr += Number(r.dr_minor); a.cr += Number(r.cr_minor);
    });
  }
  return Object.keys(byCode).sort().map((code) => { const a = c.chart.find((x) => String(x.code) === code) || {}; return { code, role: a.role || null, name: a.name || null, dr_minor: byCode[code].dr, cr_minor: byCode[code].cr }; });
}
/**
 * GET /returns?period&frequency&simpler&stagger&emirate → { currency, pack, form, name, short, authority, portal, prepared, asked, periods: [{ period, label, start, end, due,
 *   frequency, ended }], period, boxes: [{ code, label, amount_minor, tax_minor, roles, accounts: [{ code, name }], note }], payable_minor, refund_minor, net_minor, notes, cite,
 *   emirates? · staggers? (AE: the pack's own tables for the pickers) · needs: 'stagger' + why (AE, until the FTA stagger is given — nothing is guessed) }.
 * The chosen period: `period` as the pack names it ('2026-Q1' · '2026-07' · '2026-02/2026-04'), else the latest one that has ended, else the first. `simpler` (AU): '0' asks the
 * full BAS (G2 G3 G10 G11); default Simpler BAS. India → 422 RETURN_FROM_RAIL (its GSTR is read from the rail, GET /api/tax/gstr).
 */
async function taxReturn(entity, s, q) {
  const cur = (s && s.functional_currency) || 'INR', pack0 = B.packOf(s), day = today(s);
  if (!pack0.returns || !pack0.returns.id) throw refuse(pack0.id === 'IN' ? 'India\'s GSTR-1 and GSTR-3B are read from the frozen invoices on the rail (GET /api/tax/gstr), not from the ledgers.' : 'No return is built for the ' + pack0.id + ' pack yet.', 'RETURN_FROM_RAIL');
  return withEntity(entity, async (h) => {
    const c = await B.ledgerCtx(h, entity), pack = c.pack, R = pack.returns;
    const base = { currency: cur, pack: pack.id, form: R.id, name: R.name, short: R.short, authority: R.authority, portal: R.portal, prepared: PREPARED };
    const pt = returnPeriods(pack, q || {}, day);
    const periods = pt.periods.map((p) => Object.assign({}, p, { ended: p.end <= day }));
    if (pt.needs) return Object.assign(base, { asked: pt.asked, needs: pt.needs, why: pt.why, periods, period: null, boxes: [], payable_minor: 0, refund_minor: 0, net_minor: 0, notes: [], cite: null, emirates: R.emirates || [], staggers: R.staggers || {} });
    const want = String((q && q.period) || '');
    const period = periods.find((p) => p.period === want) || periods.filter((p) => p.ended).pop() || periods[0];
    if (!period) throw refuse('No ' + R.short + ' period is known for ' + day + '.');
    const movements = await movementsBetween(h, entity, c, period.start, period.end);
    const opts = {};
    if (R.id === 'BAS') opts.simpler = !(q && (q.simpler === '0' || q.simpler === 'false' || q.simpler === false));
    if (R.id === 'VAT201') opts.emirate = q && q.emirate ? String(q.emirate) : null;
    const r = GR().returnFor(pack, period.period, movements.filter((m) => m.role), opts);
    if (!r.ok) throw refuse(r.why);
    /* the box's ledgers in the ROLES' order (the form's: the amount ledgers, then the tax ledger), each once */
    const accountsOf = (roles) => roles.reduce((out, role) => out.concat(c.chart.filter((a) => !a.is_group && a.role === role).map((a) => ({ code: String(a.code), name: a.name }))), []);
    const boxes = r.boxes.map((b) => ({ code: b.code, label: b.label, amount_minor: b.amount_minor, tax_minor: b.tax_minor, roles: b.roles, accounts: accountsOf(b.roles), note: b.note }));
    const out = Object.assign(base, { asked: Object.assign({}, pt.asked, R.id === 'BAS' ? { simpler: opts.simpler } : { emirate: opts.emirate }), periods, period,
      boxes, payable_minor: r.payable_minor, refund_minor: r.refund_minor, net_minor: r.net_minor, notes: r.notes, cite: r.cite });
    if (R.id === 'VAT201') { out.emirates = R.emirates || []; out.staggers = R.staggers || {}; }   /* the pack's own tables for the pickers: the seven Emirates, the four FTA staggers */
    return out;
  });
}

module.exports = { amountOf, dateOf, refOf, toRupees, today, contraEvent, listAssets, addAsset, disposeAsset, runDepreciation, closingStock, gstClose, gstPay, takeLoan, loanEmi, accrue, reverseAccrual, contra, reversalDate, ask, gstBalances, balancesOf, gstPayableAt, taxReturn };
