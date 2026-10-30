// @stage tested
// OWNS  the period-end entries: closing stock · depreciation · accruals · the tax set-off and payment (gst/close · gst/pay, country-first) · the return read · year close.
// CALLED BY routes/books.js (the period-end routes).
// FLOW  route → the period's ledgers read → the pack's heads and words → one transaction of entries → the answer
// CARD 16-finance/month-and-year-end
// @stage-note [BOOKS v2] The owner's period-end entries (engines v1.14-v1.16): asset register, depreciation, closing stock, GST close and
// @stage-note challan, loans, accruals, contra. Every entry is BUILT BY THE POSTING ENGINE and written by postEntry; this file reads, asks, and shapes.
'use strict';
const CLOCK = require('./shop-clock');
const log = require('./logger');
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
/* CX2: a year is named the way its PACK names it — '2026-27' (IN · AU, a split year), '2026' (AE, the calendar year); India's answers unchanged */
const fyAsk = (pack) => ask('Which financial year? e.g. ' + E.packs().fyLabel(2026, pack) + '.');
const fyOk = (fy, pack) => /^\d{4}(-\d{2})?$/.test(fy) && E.packs().fyLabel(Number(fy.slice(0, 4)), pack) === fy;
const ask = (why) => {
  const e = new Error(why);
  e.code = 'BOOKS_BAD_REQUEST';
  e.status = 400;
  return e;
};
const refuse = (why, code) => {
  const e = new Error(why);
  e.code = code || 'BOOKS_REFUSED';
  e.refused = true;
  return e;
};
/* the shop's day, from the one reader the writer uses (typedDate), so a stubbed clock moves both */
const today = (s) => CLOCK.today(s); /* the shop's day; unstated → UTC (books-hooks.zoneOf), never India */
const dp = (currency) => {
  try {
    const M = require('./money');
    return M.decimals ? M.decimals(currency) : 2;
  } catch (e) {
    log.fellBack('books-period dp: the helper failed — counted as 2', e);
    return 2;
  }
};
const toMinor = (rupees, cur) => Math.round(Number(rupees) * Math.pow(10, dp(cur)));
const toRupees = (minor, cur) => Number(minor) / Math.pow(10, dp(cur));
const withEntity = (e, fn) => require('../db').withEntity(e, fn);

/** an amount in minor units (`<key>_minor`) or rupees (`<key>`) → a positive integer of minor units, else a plain question */
function amountOf(b, key, cur, opt) {
  const o = opt || {};
  let m = null;
  if (b[key + '_minor'] != null && b[key + '_minor'] !== '') m = Number(b[key + '_minor']);
  else if (b[key] != null && b[key] !== '') m = toMinor(b[key], cur);
  if (m == null) {
    if (o.optional) return null;
    throw ask(o.ask || 'How much?');
  }
  if (!Number.isInteger(m) || m < 0 || (m === 0 && !o.zero)) throw ask(o.ask || 'The amount must be above nothing.');
  return m;
}
function dateOf(b, key, dflt) {
  const v = b[key || 'date'] == null || b[key || 'date'] === '' ? dflt : String(b[key || 'date']).slice(0, 10);
  if (!v || !DATE.test(v)) throw ask('Which date? Use YYYY-MM-DD.');
  return v;
}
const refOf = (b) => (b.client_ref ? String(b.client_ref).slice(0, 80) : null);

/**
 * the one door every entry here goes through — ON THE CALLER'S HANDLE (M2, PAY-FIX): the asset / depreciation entry and the register
 * row commit together or not at all. `handle` null = a caller holding no transaction (a loan, an accrual, a contra): postEntry opens its own.
 */
function postOwn(handle, entity, ev, by, system) {
  return B.postEntry(handle, entity, Object.assign({}, ev, { owner: !system, strict_date: true, by }));
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
  Object.keys((b && b.accounts) || {}).forEach((item) => {
    const a = b.accounts[item];
    if (a.role) byRole[a.role] = a;
  });
  return { accounts: (b && b.accounts) || {}, byRole, pack };
}
const netOf = (bal, role) => (bal.byRole[role] ? Number(bal.byRole[role].net_minor) : 0);

/** the month a date falls in must be open — the engine-side question is postingDateFor's, so the refusal is the same sentence */
async function mustBeOpen(h, entity, s, date) {
  await B.postingDateFor(h, entity, date, B.packOf(s), false, true, s);
}
function periodDates(s, fy, period) {
  if (!fyOk(String(fy || ''), B.packOf(s))) throw fyAsk(B.packOf(s));
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
    const cur = B.curOf(s);
    const live = rows.filter((item) => !item.disposed_on);
    const assets = rows.map((item) => Object.assign({}, item, { wdv_minor: item.disposed_on ? 0 : item.cost_minor - item.accumulated_minor }));
    const bal = await balancesAt(h, entity, asOf);
    const by = new Map();
    for (const a of live) {
      const c = by.get(a.asset_class) || { asset_class: a.asset_class, count: 0, cost_minor: 0, accumulated_minor: 0 };
      c.count += 1;
      c.cost_minor += a.cost_minor;
      c.accumulated_minor += a.accumulated_minor;
      by.set(a.asset_class, c);
    }
    const net_block = Array.from(by.values()).map((item) => {
      const def = classOf(s, item.asset_class);
      /* the books' own figures for the class, read through balanceAsAt: cost is a debit, accumulated depreciation a credit */
      const led_cost = netOf(bal, def.cost_role),
        led_acc = -netOf(bal, def.acc_role);
      return Object.assign({}, item, {
        wdv_minor: item.cost_minor - item.accumulated_minor,
        ledger_cost_minor: led_cost,
        ledger_accumulated_minor: led_acc,
        ledger_wdv_minor: led_cost - led_acc,
        agrees: led_cost === item.cost_minor && led_acc === item.accumulated_minor
      });
    });
    return { currency: cur, asOf, assets, net_block, total_wdv_minor: net_block.reduce((total, item) => total + item.wdv_minor, 0) };
  });
}

/** POST /assets — one added by hand: the engine's purchase_bill, accepted as an asset (cost to the class's PPE ledger), then the row */
async function addAsset(entity, s, b, by) {
  const cur = B.curOf(s);
  const name = String(b.name || '')
    .trim()
    .slice(0, 120);
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
    const ev = {
      type: 'purchase_bill',
      accept: 'asset',
      asset_class: cls.class,
      date,
      currency: cur,
      ref: name,
      by_rate: [{ rate: 0, taxable: toRupees(cost, cur), cgst: 0, sgst: 0, igst: 0 }],
      paid: party ? {} : { [how]: toRupees(cost, cur) },
      narration: 'Asset bought: ' + name,
      source_ref: ref ? 'asset:' + ref : null
    };
    if (party) ev.party = String(party);
    const r = await postOwn(h, entity, ev, by);
    if (!r.ok) return r;
    const row = await Assets.add(h, entity, {
      name,
      asset_class: cls.class,
      cost_minor: cost,
      currency: cur,
      put_to_use: put,
      source_entry_id: r.entry_id,
      by
    });
    return Object.assign({}, r, { asset: row && Object.assign({}, row, { wdv_minor: row.cost_minor - row.accumulated_minor }) });
  });
}

/** POST /assets/:id/dispose — the engine's asset_disposal: accumulated and cost off, the balance a profit or a loss on sale */
async function disposeAsset(entity, s, id, b, by) {
  const cur = B.curOf(s);
  const date = dateOf(b, 'date', today(s));
  const proceeds = amountOf(b, 'proceeds', cur, { optional: true, zero: true, ask: 'What did it fetch?' }) || 0;
  const how = b.into == null ? (proceeds ? 'bank' : 'cash') : String(b.into);
  if (proceeds && MODES.indexOf(how) < 0 && !b.party_id) throw ask('Where did the money come in? cash, bank, upi or card.');
  return withEntity(entity, async (h) => {
    await Assets.need(h, entity);
    const a = await Assets.get(h, entity, id);
    if (!a) {
      const e = new Error('No such asset.');
      e.code = 'BOOKS_NOT_FOUND';
      throw e;
    }
    if (a.disposed_on) return { ok: true, duplicate: true, asset: a, entry_id: a.disposal_entry_id };
    if (date < a.put_to_use) throw ask('It cannot be disposed of before it was put to use (' + a.put_to_use + ').');
    const ev = {
      type: 'asset_disposal',
      asset_class: a.asset_class,
      cost: toRupees(a.cost_minor, a.currency),
      accumulated: toRupees(a.accumulated_minor, a.currency),
      proceeds: toRupees(proceeds, a.currency),
      date,
      currency: a.currency,
      ref: a.name,
      narration: (proceeds ? 'Asset sold: ' : 'Asset scrapped: ') + a.name,
      source_ref: 'asset-dispose:' + a.asset_id
    };
    if (b.party_id) ev.party = String(b.party_id);
    else if (proceeds) ev.into = how;
    const r = await postOwn(h, entity, ev, by);
    if (!r.ok) return r;
    await Assets.markDisposed(h, entity, a.asset_id, date, r.entry_id, proceeds);
    return Object.assign({}, r, { asset: Object.assign({}, a, { disposed_on: date, disposal_entry_id: r.entry_id, proceeds_minor: proceeds, wdv_minor: 0 }) });
  });
}

/* the basis's name in words. ⚠️ A pack carries the basis CODE (depreciation.entityBases) but no label yet — engines request queued (CX2): `depreciation.bases[code].label` */
const BASIS_WORDS = {
  it_act_wdv: 'Income-tax Act written-down value',
  schedule_ii: 'Companies Act Schedule II',
  div40: 'Division 40 effective life, ITAA 1997',
  ias16: 'IAS 16 useful life'
};
const basisWord = (code) => BASIS_WORDS[code] || String(code || "the pack's basis");
/* ═══ 2. depreciation ═════════════════════════════════════════════════════════════════════════════════════════════ */
/**
 * POST /depreciation/run { fy } — the register → the engine's depreciationFor → ONE entry at the year end.
 * ⚠️ The entity basis is Athi's OPEN decision: books.entity_basis if the shop has it, else 'proprietor' (Income-tax WDV) — and the
 *   answer SAYS which and why (basis_assumed), never guessed from a PAN. A company also needs its method (slm | wdv).
 */
async function runDepreciation(entity, s, b, by) {
  const fy = String(b.fy || '');
  const pack = B.packOf(s);
  if (!fyOk(fy, pack)) throw fyAsk(pack);
  const rg = E.packs().fyRange(fy, pack);
  if (!rg) throw ask('That financial year is not one the books know.');
  const known = B.entityBasisOf(s);
  /* CX2 (A5): the default is the pack's own one-owner entity (IN proprietor · AU sole_trader · AE sole_establishment — the first non-company basis it lists),
     and the note names that pack's basis — never India's Income-tax Act for an Australian or Emirati shop */
  const bases = pack.entity_bases || {},
    basis = known || Object.keys(bases).find((item) => item !== 'company') || Object.keys(bases)[0] || 'proprietor';
  const note = known
    ? null
    : 'The entity type is not set for this shop yet, so depreciation was worked as a ' +
      String(basis).replace(/_/g, ' ') +
      ' (' +
      basisWord((bases[basis] || {}).basis) +
      '). Set books.entity_basis to change it.';
  const source_ref = 'depreciation:' + fy;
  return withEntity(entity, async (h) => {
    await Assets.need(h, entity);
    const seen = await S.entryBySource(h, entity, source_ref);
    if (seen)
      return {
        ok: true,
        duplicate: true,
        entry_id: seen.entry_id,
        entry_no: seen.entry_no,
        posting_date: E.ymd(seen.posting_date),
        fy,
        entity_basis: basis,
        basis_assumed: !known,
        entity_note: note
      };
    if (rg.end > today(s)) throw refuse('Depreciation for ' + fy + ' runs at the year end (' + rg.end + ') or after — the year has not ended.');
    const reg = await Assets.list(h, entity);
    const cur = B.curOf(s);
    const inYear = reg.filter((item) => item.put_to_use <= rg.end && (!item.disposed_on || item.disposed_on >= rg.start));
    if (!inYear.length)
      return {
        ok: true,
        nothing_to_post: true,
        fy,
        entity_basis: basis,
        basis_assumed: !known,
        entity_note: note,
        why: 'There are no assets in the register for ' + fy + '.'
      };
    await mustBeOpen(h, entity, s, rg.end);
    const assets = inYear.map((item) => {
      const x = { id: item.asset_id, class: item.asset_class, cost: toRupees(item.cost_minor, item.currency), put_to_use: item.put_to_use };
      if (item.put_to_use < rg.start) x.opening_wdv = toRupees(item.cost_minor - item.accumulated_minor, item.currency);
      if (item.disposed_on) x.sold = { proceeds: toRupees(item.proceeds_minor || 0, item.currency) };
      return x;
    });
    const dep = E.posting().depreciationFor({
      entity: basis,
      method: s && s.depreciation_method ? String(s.depreciation_method) : undefined,
      fiscal_year: fy,
      date: rg.end,
      ref: 'DEP-' + fy,
      assets,
      pack
    });
    if (!dep.ok) throw refuse(dep.why);
    const base = {
      ok: true,
      fy,
      entity_basis: basis,
      basis_assumed: !known,
      entity_note: note,
      basis_rule: dep.basis,
      by_class: dep.by_class,
      by_asset: dep.by_asset
    };
    if (!dep.event) return Object.assign(base, { nothing_to_post: true, why: 'Nothing to depreciate for ' + fy + '.' });
    const ev = Object.assign({}, dep.event, { currency: cur, narration: 'Depreciation ' + fy + ' (' + dep.basis + ')', source_ref });
    const r = await postOwn(h, entity, ev, by, true);
    if (!r.ok) return r;
    for (const a of dep.by_asset) await Assets.addDepreciation(h, entity, a.id, toMinor(a.amount, cur), fy);
    return Object.assign(base, r);
  });
}

/* ═══ 3. closing stock ════════════════════════════════════════════════════════════════════════════════════════════ */
/** POST /closing-stock { date, value_minor, nrv_minor?, method } — only the DIFFERENCE from the books posts (the engine reads `book`)
 *  method 'manual' — the owner types the value · 'automatic' (T1-INV) — valued from the shop's OWN stock ledger as at the end of `date` */
async function closingStock(entity, s, b, by) {
  const cur = B.curOf(s);
  const date = dateOf(b, 'date');
  const mode = b.method == null ? 'manual' : String(b.method);
  if (mode !== 'manual' && mode !== 'automatic')
    throw ask("How is the closing stock found? 'manual' (you enter the value) or 'automatic' (valued from the stock ledger).");
  let value = mode === 'manual' ? amountOf(b, 'value', cur, { zero: true, ask: 'What is the stock on hand worth?' }) : null;
  const nrv = amountOf(b, 'nrv', cur, { optional: true, zero: true });
  const ref = refOf(b);
  return withEntity(entity, async (h) => {
    const ledger = mode === 'automatic' ? await ledgerValue(h, entity, s, date) : null;
    if (ledger) value = toMinor(ledger.value, cur);
    const bal = await balancesAt(h, entity, date);
    const book = netOf(bal, 'stock');
    /* ⚠️ the ENGINE's mode stays 'manual' (it is handed the value) until engines posting.js closing_stock accepts 'automatic' with a
       supplied amount — engines are serial and this round does not own them; the difference is still the engine's ONE calculation */
    const ev = {
      type: 'closing_stock',
      mode: 'manual',
      date,
      currency: cur,
      book: toRupees(book, cur),
      method: b.cost_formula || (ledger ? 'weighted_average' : undefined),
      narration: 'Closing stock ' + date + (ledger ? ' · from the stock ledger' : ''),
      source_ref: ref ? 'stock:' + ref : null
    };
    if (nrv != null) {
      ev.cost = toRupees(value, cur);
      ev.nrv = toRupees(nrv, cur);
    } else ev.amount = toRupees(value, cur);
    const r = await postOwn(h, entity, ev, by, true);
    return Object.assign({ book_minor: book }, ledger ? { from_ledger: { value_minor: value, lines: ledger.lines, movements: ledger.movements } } : {}, r);
  });
}

/**
 * ⭐⭐ THE LEDGER'S QUANTITIES, VALUED (T1-INV, 2026-10-14). The refusal used to say quantities are not kept — the shop's own
 * ledger (stock_movement → stock_balance) has kept them since b214. So 'automatic' replays it up to the END of the shop's day
 * (stock-store.asAt: weighted average, the log wins) and refuses ONLY when something is truly missing, NAMING it:
 *   STOCK_LEDGER_MISSING  the ledger is not on this server (b214 not run)
 *   STOCK_LEDGER_EMPTY    nothing received or sold up to the date
 *   STOCK_BELOW_ZERO      products sold beyond what was received — the shelf is unknown until counted
 *   STOCK_UNCOSTED        products on hand that came in with no cost — no value to put on them
 *   STOCK_UNREADABLE      products whose record does not replay (a movement the engine refuses) — the value would be short
 */
async function ledgerValue(h, entity, s, date) {
  const stock = require('./stock-store');
  if (!(await require('./schema').hasTable('stock_movement')))
    throw refuse(
      "The stock ledger is not set up on this server yet, so there are no quantities to value. Enter the value by hand ('manual').",
      'STOCK_LEDGER_MISSING'
    );
  const until = require('./books-hooks').dayBounds(date, s).to;
  /* R104: a dish made to order is not counted (lib/stocked), so it is not in `below_zero` and a tiffin shop can value from the ledger; the value is unchanged */
  const shelf = await stock.asAt(entity, (e, fn) => fn(h), until, { counted_only: true });
  if (!shelf.movements)
    throw refuse(
      'Nothing was received or sold up to ' + date + ', so the stock ledger has nothing to value. Receive the stock, or enter the value by hand.',
      'STOCK_LEDGER_EMPTY'
    );
  const named = async (ids) => {
    const r = await h.query(require('./catalogue-read').ITEM_NAMES_SQL, [entity, ids.slice(0, 20)]);
    const by = new Map(r.rows.map((x) => [x.id, x.name]));
    return ids.slice(0, 20).map((id) => by.get(id) || 'item ' + id.slice(0, 8));
  };
  const fail = async (ids, code, why) => {
    const items = await named(ids);
    const e = refuse(items.join(', ') + why, code);
    e.items = items;
    throw e;
  };
  if (shelf.unreadable.length)
    await fail(
      shelf.unreadable,
      'STOCK_UNREADABLE',
      ': the stock record does not add up (a movement in another unit), so it cannot be valued. Count ' +
        (shelf.unreadable.length === 1 ? 'it' : 'them') +
        ', or enter the value by hand.'
    );
  if (shelf.below_zero.length)
    await fail(
      shelf.below_zero,
      'STOCK_BELOW_ZERO',
      ' went below zero by ' + date + ' — the shelf is unknown. Count ' + (shelf.below_zero.length === 1 ? 'it' : 'them') + ', or enter the value by hand.'
    );
  if (shelf.uncosted.length)
    await fail(
      shelf.uncosted,
      'STOCK_UNCOSTED',
      ' came in with no cost, so the ledger cannot value ' + (shelf.uncosted.length === 1 ? 'it' : 'them') + '. Record the cost, or enter the value by hand.'
    );
  return { value: shelf.value, lines: shelf.rows.filter((x) => x.qty > 0).length, movements: shelf.movements };
}

/* ═══ 4. THE TAX PERIOD'S CLOSE AND THE STATUTORY PAYMENT — COUNTRY-FIRST (W2-BOOKS, 2026-10-15) ═════════════════════════════════════════════
   The pack decides everything a country owns: its heads and the ledger each side lands on (taxHeads · taxLedgers), the order of set-off (setOff), how
   reverse-charge tax is settled (rcmSettlement), the words (messages.paymentRef · setOffNarration), and WHICH PERIOD is closed — India a month (fy, period),
   a pack with a return (AU BAS · AE VAT201) the return's own period as GET /returns names it ('2026-Q1' · '2026-02/2026-04'). India's answers are unchanged.
   FLOW  close: closeSpan() → gstBalances() → CBPosting.gstSetOff (the pack's setOff) → closeAnswer() → postOwn(tax_setoff)
         pay:   closeSpan() → headAmounts() → refuseOverpay() (against gstBalances) → postOwn(tax_payment) */
const toMajorByHead = (nestedMinorByHead, heads, currency) => {
  const out = {};
  heads.forEach((head) => {
    out[head] = toRupees(nestedMinorByHead[head] || 0, currency);
  });
  return out;
};
/** the pack's tax heads with the ledger ROLE each side lands on — the ONE reader of taxHeads · taxLedgers (IN cgst/sgst/igst/cess · AU gst · AE vat) */
function headsOf(pack) {
  return (pack.taxHeads || []).map((head) => Object.assign({ head }, pack.taxLedgers[head] || {}));
}
const rcmHeadsOf = (pack) =>
  headsOf(pack)
    .filter((x) => x.rcm)
    .map((x) => x.head);
/** the pack's own words for a statutory payment (engines v1.48.0 messages.paymentRef) — a pack without them gets neutral words, never another country's */
function payWords(pack) {
  const m = (pack.messages && pack.messages.paymentRef) || {};
  return {
    label: m.label || 'Payment reference',
    ask: m.ask || 'Which payment? Give its reference.',
    hint: m.hint || 'The reference the authority gave',
    narration: m.narration || 'Tax payment'
  };
}
/** the event name this pack's accountants know a neutral rule by (eventAliases: IN · AU gst_payment; AE none → tax_payment) — the engine's aliasFor_, which it does not export */
const eventNameOf = (pack, neutral) => Object.keys(pack.eventAliases || {}).find((item) => pack.eventAliases[item] === neutral) || neutral;
/** a balance is read at a month end (the books' rows) or at the shop's today — never at a mid-month day with later entries in that month, which the engine cannot cut */
function settledAsOf(s, date) {
  const pack = B.packOf(s),
    A = E.packs(),
    end = A.periodRange(A.fiscalYearOf(date, pack), A.periodOf(date, pack), pack).end;
  return end > today(s) ? today(s) : end;
}
/** the pack's tax balances as at a day, by head: output (a credit balance), input credit (a debit balance), reverse-charge owed (a credit balance) — in minor units */
async function gstBalances(handle, entity, asOf, pre, pack) {
  if (!pack) throw refuse("The tax balances need the shop's country pack.");
  const bal = pre || (await balancesAt(handle, entity, asOf)); /* pre: balances already read (balancesOf) — F3 hands them in */
  const output = {},
    input = {},
    rcm = {};
  headsOf(pack).forEach((x) => {
    const o = netOf(bal, x.output),
      i = netOf(bal, x.input);
    output[x.head] = o < 0 ? -o : 0; /* output tax is a credit balance; a debit one is nothing to set off against */
    input[x.head] = i > 0 ? i : 0; /* input credit is a debit balance */
    /* reverse charge (engines v1.20.0): what the shop owes on purchases bought under reverse charge — the credit balance of the head's rcm ledger */
    if (x.rcm) {
      const r = netOf(bal, x.rcm);
      rcm[x.head] = r < 0 ? -r : 0;
    }
  });
  return { output, input, rcm };
}
/** the engine's set-off of the balances `g` — the pack's order; an optional head (IN cess) only when it has a figure; reverse charge beside it only when owed */
function setOffOf(pack, shop, balances, ref, date, period, currency) {
  const heads = headsOf(pack).map((x) => x.head),
    optional = pack.optionalHeads || [];
  const named = heads.filter((item) => optional.indexOf(item) < 0 || balances.output[item] > 0 || balances.input[item] > 0);
  const rcmHeads = rcmHeadsOf(pack),
    hasRcm = rcmHeads.some((item) => balances.rcm[item] > 0);
  return E.posting().gstSetOff({
    ref,
    date,
    period,
    currency: currency,
    country: (shop && shop.country) || undefined,
    output: toMajorByHead(balances.output, named, currency),
    input: toMajorByHead(balances.input, named, currency),
    rcm: hasRcm ? toMajorByHead(balances.rcm, rcmHeads, currency) : undefined
  });
}
/** the set-off's figures back in minor units, per head (every head named, zero included — the shape India has always answered: `<head>_minor` keys, or plain heads) */
function minorByHead(setOff, key, heads, currency, suffix) {
  const out = {};
  heads.forEach((headKey) => {
    out[headKey + (suffix == null ? '_minor' : suffix)] = toMinor(setOff[key][headKey] || 0, currency);
  });
  return out;
}
/**
 * ⭐ F3 (CB Finance · cash position): what the posted tax ledgers say is OWED as at a date, after the set-off — the SAME arithmetic gstClose posts
 * (gstBalances → CBPosting.gstSetOff in the pack's order; reverse charge joins in cash where the pack says so), READ and never written.
 * `pre` = the ledger balances already read (balancesOf), so the caller reads the ledger once. → { payable_minor, heads: { cgst_minor … } | null, rcm_minor | null, why }
 * A set-off the engine refuses answers payable_minor 0 with the engine's sentence in `why` — a cash forecast never invents a tax figure.
 */
async function gstPayableAt(handle, entity, s, asOf, pre) {
  const currency = B.curOf(s),
    pack = B.packOf(s),
    heads = headsOf(pack).map((x) => x.head);
  const balances = await gstBalances(handle, entity, asOf, pre, pack);
  const setOff = setOffOf(pack, s, balances, 'CASH-' + asOf, asOf, undefined, currency);
  if (!setOff.ok) return { payable_minor: 0, heads: null, rcm_minor: null, why: setOff.why || 'The tax set-off could not be worked out.' };
  const payable = minorByHead(setOff, 'payable', heads, currency);
  let total = heads.reduce((sum, headKey) => sum + payable[headKey + '_minor'], 0),
    rcm = null;
  if (setOff.rcm) {
    rcm = minorByHead(setOff, 'rcm', rcmHeadsOf(pack), currency);
    total += Object.keys(rcm).reduce((sum, headKey) => sum + rcm[headKey], 0);
  }
  return { payable_minor: total, heads: payable, rcm_minor: rcm, why: null };
}
/**
 * WHICH period a close or payment names — the pack decides: India (no return in the pack) a month { fy, period 1–12 }; a pack with a return the RETURN period
 * { period: '2026-Q1', frequency? | stagger? } from the pack's own table (returnPeriods — the same list GET /returns answers). → { key, ref, label, end, fields, form, period }
 */
function closeSpan(shop, body, pack) {
  /* CX0 (2026-10-13) kept: a shop on a FALLBACK chart (no pack of its own) is refused in words — never an Indian close on a borrowed chart */
  if (pack.fallback)
    throw refuse(
      'These books have no country pack of their own yet, so no tax close or payment can be posted. Finish the country setup first.',
      'NOT_FOR_COUNTRY'
    );
  const returnsDef = pack.returns;
  if (!returnsDef || !returnsDef.id) {
    const rg = periodDates(shop, body.fy, body.period),
      monthNo = Number(body.period);
    return {
      key: body.fy + ':' + monthNo,
      ref: 'GSTSO-' + body.fy + '-P' + String(monthNo).padStart(2, '0'),
      label: body.fy + ' month ' + monthNo,
      start: rg.start,
      end: rg.end,
      form: null,
      period: null,
      fields: { fy: body.fy, period: monthNo }
    };
  }
  const periodTable = returnPeriods(pack, body, today(shop));
  if (periodTable.needs) throw ask(periodTable.why);
  const want = String(body.period || ''),
    period = periodTable.periods.find((periodRow) => periodRow.period === want);
  if (!period) throw ask('Which ' + returnsDef.short + ' period? One of ' + periodTable.periods.map((periodRow) => (periodRow.label || periodRow.period) + ' (' + periodRow.period + ')').join(', ') + '.');
  return {
    key: returnsDef.id + ':' + period.period,
    ref: returnsDef.id + 'SO-' + period.period,
    label: period.label || period.period,
    start: period.start,
    end: period.end,
    form: returnsDef.id,
    period,
    fields: { period: period.period }
  };
}
/** the close's answer: the set-off, what is payable and carried per head, reverse charge beside it where owed; a pack with a return adds its form, heads and words (additive) */
function closeAnswer(pack, setOff, balances, span, currency) {
  const heads = headsOf(pack).map((x) => x.head),
    words = payWords(pack);
  const payable = minorByHead(setOff, 'payable', heads, currency),
    carried = minorByHead(setOff, 'carried', heads, currency);
  const out = Object.assign({}, span.fields, {
    date: span.end,
    utilised: setOff.utilised.map((item) => ({ from: item.from, against: item.against, amount_minor: toMinor(item.amount, currency) })),
    payable_minor: payable,
    carried_minor: carried,
    pay_total_minor: heads.reduce((total, headKey) => total + payable[headKey + '_minor'], 0)
  });
  if (setOff.rcm) {
    /* the reverse-charge liability joins the payment, in cash — the engine's own `cash` per head */
    out.rcm_minor = minorByHead(setOff, 'rcm', rcmHeadsOf(pack), currency, '');
    out.cash_minor = minorByHead(setOff, 'cash', rcmHeadsOf(pack), currency, '');
    out.pay_total_minor += Object.keys(out.rcm_minor).reduce((total, headKey) => total + out.rcm_minor[headKey], 0);
  }
  if (span.form) {
    /* a pack with a return: the words the screen paints come from the pack, never typed for a country */
    const netting = ((pack.presentation || {}).taxNetting || [])[0] || {};
    Object.assign(out, {
      form: span.form,
      heads,
      return_period: span.period,
      ref_label: words.label,
      ref_hint: words.hint,
      carried_word: netting.creditName || null
    });
  }
  return out;
}
/** a 'netted' pack (AE: Box 3 nets with Box 13 on the form) with reverse charge owed AND more recoverable than due tax: the engine's cash figure is not the form's — refused, never guessed */
function refuseUnnettedRcm(pack, setOff, balances, currency) {
  const owed = rcmHeadsOf(pack).some((headKey) => balances.rcm[headKey] > 0),
    carried = Object.keys(setOff.carried || {}).some((headKey) => toMinor(setOff.carried[headKey] || 0, currency) > 0);
  if (pack.rcmSettlement === 'netted' && owed && carried) {
    throw refuse(
      'Reverse-charge tax is owed this period and the recoverable tax is more than the due tax. The return nets them on the form; this close cannot post that netting yet — lodge from the return and record the payment by hand.',
      'RCM_NETTING_NOT_BUILT'
    );
  }
}
/**
 * ⭐ M1 (PAY-FIX): A CLOSED TAX PERIOD LOCKS THE MONTHS IT COVERS — soft (the owner opens one again with a reason), in the close's own
 * transaction, every open month from the span's start to its end. From then on a typed date in them is refused PERIOD_LOCKED and an
 * automatic entry (a late offline counter bill) MOVES to the first open month, said (`moved: true`) — the ledger's standing rule — so
 * the late tax is set off by the NEXT period's close instead of vanishing behind "Already closed". → [{ fiscal_year, period }] locked now.
 */
const CLOSE_LOCK_PREFIX = 'Tax period closed — ';
const CLOSE_LOCK_REASON = (span) => CLOSE_LOCK_PREFIX + span.label;
/* ACC-204 / E8 (critic B9): a month the tax close locked is known by the reason's PREFIX, never the label text — a pack may reword a period's
   label (engines #77 "FY27 Q1 (Jul–Sep 2026)") and a close made under the old words must still read closed; each month belongs to one tax period */
const lockedByTaxClose = (row) => !!row && row.status !== 'open' && String(row.reason || '').startsWith(CLOSE_LOCK_PREFIX);
/** the months a span covers, with the row the books hold for each: [{ fiscal_year, period, row }] — ONE periods read (or the caller's rows) */
async function monthsCovered(handle, entity, shop, span, rows0) {
  const packs = E.packs(),
    pack = B.packOf(shop),
    rows = rows0 || (await S.periods(handle, entity, null)),
    months = [];
  for (let day = String(span.start).slice(0, 7) + '-01'; day <= span.end; day = nextMonth(day)) {
    const fiscalYear = packs.fiscalYearOf(day, pack),
      period = Number(packs.periodOf(day, pack));
    months.push({ fiscal_year: fiscalYear, period, row: rows.find((row) => row.fiscal_year === fiscalYear && Number(row.period) === period) || null });
  }
  return months;
}
/* ACC-204: a month the owner locked by hand before the close is RE-STAMPED with the close's reason (the owner's words stay in the change log) — a close
   that had nothing to set off leaves no entry, so the months it covers are its only record and the year close reads them (closedBefore) */
async function lockCovered(handle, entity, shop, span, by) {
  const locked = [];
  for (const month of await monthsCovered(handle, entity, shop, span)) {
    if (!month.row || month.row.status === 'hard_locked' || lockedByTaxClose(month.row)) continue;
    await B.setPeriod(handle, entity, month.fiscal_year, month.period, 'soft_locked', by, CLOSE_LOCK_REASON(span));
    locked.push({ fiscal_year: month.fiscal_year, period: month.period });
  }
  return locked;
}
/** a close that posted no entry (nothing to set off) is still a close: every month it covers is locked by a tax close (the prefix, whatever label it carried then) */
async function closedBefore(handle, entity, shop, span, rows0) {
  const months = await monthsCovered(handle, entity, shop, span, rows0);
  return months.length > 0 && months.every((month) => lockedByTaxClose(month.row));
}
/* ── ACC-204 (Athi, 30 Oct 2026): THE YEAR CLOSE WAITS FOR EVERY TAX PERIOD OF THE YEAR ─────────────────────────────────────────── */
const TAX_CLOSE_SOURCE = 'gstclose:'; /* the HOME of a tax close: gstClose's source_ref (gstclose:<form>:<period> · IN gstclose:<fy>:<month>) */
/** the source_ref a period's close would have written — asked of books-store.postedSources (the one "has this source posted" read, as the day fold asks it) */
const closeSourceOf = (returnsDef, item) => TAX_CLOSE_SOURCE + returnsDef.id + ':' + item.period;
/** the closes the books hold for these periods, by their HOME → Set of source_ref (one read for every period asked, however many years) */
async function postedCloses(handle, entity, returnsDef, periods) {
  return new Set(await S.postedSources(handle, entity, periods.map((item) => closeSourceOf(returnsDef, item))));
}
/** does this pack read its return from the ledgers? (AU BAS, AE VAT201; IN's GSTR is read from the rail, a fallback chart closes no tax) */
const readsReturnFromBooks = (pack) => !pack.fallback && !!(pack.returns && pack.returns.id);
/** does the shop charge its tax — tax-shelf.chargesTax over the registration facts (never "has a tax id"); books-todo reads the same door */
async function shopChargesTax(handle, entity, setting) {
  const registration = await S.taxRegistration(handle, entity);
  return require('./tax-shelf').chargesTax(registration, require('./tax-packs').packFor(setting && setting.country));
}
/** the pack's return periods that touch financial year `fy` (an FTA stagger period may straddle a year end: it belongs to both) → { periods } | { needs, why } */
function yearReturnPeriods(pack, fiscalYear) {
  const range = E.packs().fyRange(fiscalYear, pack);
  if (!range) throw ask('Which financial year? e.g. ' + E.packs().fyLabel(2026, pack) + '.');
  const start = E.ymd(range.start),
    end = E.ymd(range.end),
    table = returnPeriods(pack, {}, end); /* the ONE table: this year and the one before */
  if (table.needs) return table;
  return { periods: table.periods.filter((item) => item.start <= end && item.end >= start) };
}
/**
 * ⭐ returnStateFor(handle, entity, setting, fiscalYear, known?) → WHICH tax periods of that year are closed — read from the closes' OWN records, never re-decided:
 *   the set-off entry (source_ref gstclose:<key>) or, for a close that had nothing to set off, the months it locked (lockedByTaxClose). The table is
 *   the pack's (returnPeriods, the list GET /returns answers: BAS quarterly as every reader assumes; a shop that closes monthly passes through its locked months).
 * → { applies, form, short, needs, why, periods: [{ key, period, label, start, end, ended, closed }], open: [label…] }
 *   applies false: the pack reads no return from the ledgers (IN), a fallback chart, or a shop that charges no tax — the year closes as before.
 *   needs 'stagger' (AE: nothing stores the FTA stagger yet): the table cannot be built — said, not guessed, and no refusal.
 *   `known` = { rows, closes, charges } a caller that already holds them (GET /periods over several years) hands in: no second read.
 */
async function returnStateFor(handle, entity, setting, fiscalYear, known) {
  const pack = B.packOf(setting),
    returnsDef = pack.returns || {},
    have = Object.assign({}, known),
    out = { applies: false, form: returnsDef.id || null, short: returnsDef.short || returnsDef.id || null, needs: null, why: null, periods: [], open: [] };
  if (!(await returnGateApplies(handle, entity, setting, have))) return out;
  const table = yearReturnPeriods(pack, fiscalYear);
  if (table.needs) return Object.assign(out, { needs: table.needs, why: table.why });
  have.rows = have.rows || (await S.periods(handle, entity, null));
  have.closes = have.closes || (await postedCloses(handle, entity, returnsDef, table.periods));
  const shopDay = today(setting);
  out.applies = true;
  for (const item of table.periods) out.periods.push(await taxPeriodState(handle, entity, setting, returnsDef, item, have, shopDay));
  out.open = out.periods.filter((item) => !item.closed).map((item) => item.label);
  return out;
}
/** the gate's first question: a pack whose return the ledgers close, for a shop that charges its tax (a caller that already knows hands `charges` in) */
async function returnGateApplies(handle, entity, setting, have) {
  if (!readsReturnFromBooks(B.packOf(setting))) return false;
  return typeof have.charges === 'boolean' ? have.charges : shopChargesTax(handle, entity, setting);
}
/** one period's state: closed by its set-off entry (the HOME) or by the months its close locked → { key, period, label, start, end, ended, closed } */
async function taxPeriodState(handle, entity, setting, returnsDef, item, have, shopDay) {
  const key = returnsDef.id + ':' + item.period,
    closed = have.closes.has(closeSourceOf(returnsDef, item)) || (await closedBefore(handle, entity, setting, { start: item.start, end: item.end }, have.rows));
  return { key, period: item.period, label: item.label || item.period, start: item.start, end: item.end, ended: item.end <= shopDay, closed };
}
/** the same for every financial year `rows` hold (GET /periods): the registration once, the closes of every year's periods in ONE read → Map fy → state (empty when the gate does not apply) */
async function returnStatesFor(handle, entity, setting, rows) {
  const states = new Map();
  if (!(await returnGateApplies(handle, entity, setting, {}))) return states;
  const pack = B.packOf(setting),
    years = Array.from(new Set(rows.map((row) => row.fiscal_year))),
    tables = years.map((fiscalYear) => yearReturnPeriods(pack, fiscalYear)),
    periods = [].concat(...tables.map((table) => table.periods || []));
  const known = { rows, closes: await postedCloses(handle, entity, pack.returns || {}, periods), charges: true };
  for (const fiscalYear of years) states.set(fiscalYear, await returnStateFor(handle, entity, setting, fiscalYear, known));
  return states;
}
/** POST /gst/close { fy, period } (IN) · { period, frequency? | stagger? } (a pack with a return) → the head balances → the pack's set-off → the set-off entry; then what is left to pay; the months lock (M1) */
async function gstClose(entity, s, b, by) {
  const pack = B.packOf(s),
    currency = B.curOf(s),
    span = closeSpan(s, b, pack);
  const source_ref = 'gstclose:' + span.key,
    narration = ((pack.messages || {}).setOffNarration || 'Tax set-off') + ' ' + span.label;
  return withEntity(entity, async (h) => {
    if (span.end > today(s)) throw refuse(span.label + ' ends on ' + span.end + ' — close it once it has ended.', 'PERIOD_NOT_ENDED');
    const seen = await S.entryBySource(h, entity, source_ref);
    const closed =
      !!seen ||
      (await closedBefore(h, entity, s, span)); /* M1: a period already closed is locked by its own close — the double tap still answers the figures */
    if (!closed) await mustBeOpen(h, entity, s, span.end);
    const balances = await gstBalances(h, entity, span.end, null, pack);
    const setOff = setOffOf(pack, s, balances, span.ref, span.end, span.fields.period, currency);
    if (!setOff.ok) throw refuse(setOff.why);
    refuseUnnettedRcm(pack, setOff, balances, currency);
    const out = closeAnswer(pack, setOff, balances, span, currency);
    if (seen) return Object.assign(out, { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no });
    if (closed) return Object.assign(out, { ok: true, duplicate: true, nothing_to_set_off: true });
    const posted = setOff.utilised.length
      ? await postOwn(h, entity, Object.assign({}, setOff.event, { narration, source_ref }), by, true)
      : { ok: true, nothing_to_set_off: true };
    if (!posted.ok) return Object.assign(out, posted);
    return Object.assign(out, posted, { locked: await lockCovered(h, entity, s, span, by) });
  });
}
/** the amounts typed per head → { heads (major, the engine's), minor } — a slip below nothing or a fraction of a minor unit is a plain question */
function headAmounts(body, heads, cur, what) {
  const am = body && typeof body === 'object' ? body : {},
    major = {},
    minor = {};
  heads.forEach((item) => {
    const v = am[item + '_minor'] != null ? Number(am[item + '_minor']) : am[item] != null ? toMinor(am[item], cur) : 0;
    if (!Number.isInteger(v) || v < 0) throw ask('The ' + what + item.toUpperCase() + ' amount must be a plain amount, not below nothing.');
    if (v) {
      minor[item] = v;
      major[item] = toRupees(v, cur);
    }
  });
  return { heads: major, minor };
}
/** a slip of the finger (100x) is caught against what is owed — read from the books, never typed */
async function refuseOverpay(handle, entity, s, pack, date, minor, rcmMinor, currency) {
  const balances = await gstBalances(handle, entity, settledAsOf(s, date), null, pack);
  const over = Object.keys(minor).filter((headKey) => minor[headKey] > balances.output[headKey]),
    overRcm = Object.keys(rcmMinor).filter((headKey) => rcmMinor[headKey] > balances.rcm[headKey]);
  if (overRcm.length)
    throw refuse(
      'That is more than the reverse-charge tax owed — ' +
        overRcm
          .map((headKey) => headKey.toUpperCase() + ' owed ' + toRupees(balances.rcm[headKey], currency) + ', paid ' + toRupees(rcmMinor[headKey], currency))
          .join('; ') +
        '.'
    );
  if (over.length)
    throw refuse(
      'That is more than the tax owed — ' +
        over
          .map((headKey) => headKey.toUpperCase() + ' owed ' + toRupees(balances.output[headKey], currency) + ', paid ' + toRupees(minor[headKey], currency))
          .join('; ') +
        '. Run the period close first, or correct the amount.'
    );
}
/** POST /gst/pay { fy, period | period, amounts: { <head>_minor … }, rcm?, bank, challan_no | payment_ref, date? } → the engine's tax payment (Dr output tax per head · Cr the bank) */
async function gstPay(entity, s, b, by) {
  const pack = B.packOf(s),
    cur = B.curOf(s),
    words = payWords(pack),
    span = closeSpan(s, b, pack);
  const ref = String(b.challan_no || b.payment_ref || '')
    .trim()
    .slice(0, 40);
  if (!ref) throw ask(words.ask);
  const mode = String(b.bank || b.mode || 'bank');
  if (MODES.indexOf(mode) < 0) throw ask('Paid from where? bank, upi, cash or card.');
  const date = dateOf(b, 'date', today(s)); /* M1: the challan is dated the day it is paid — the period's own months are locked by its close */
  const paid = headAmounts(
    b.amounts,
    headsOf(pack).map((x) => x.head),
    cur,
    ''
  );
  const rcm = headAmounts(
    b.rcm,
    rcmHeadsOf(pack),
    cur,
    'reverse-charge '
  ); /* reverse-charge liability paid by the same payment → Dr the rcm ledger · Cr the bank */
  if (!Object.keys(paid.heads).length && !Object.keys(rcm.heads).length) throw ask('How much was paid? Give the amount for at least one tax.');
  return withEntity(entity, async (h) => {
    await mustBeOpen(h, entity, s, date);
    const source_ref = 'gstpay:' + ref;
    if (!(await S.entryBySource(h, entity, source_ref))) await refuseOverpay(h, entity, s, pack, date, paid.minor, rcm.minor, cur);
    const r = await postOwn(
      h,
      entity,
      {
        type: eventNameOf(pack, 'tax_payment'),
        mode,
        heads: paid.heads,
        rcm: Object.keys(rcm.heads).length ? rcm.heads : undefined,
        date,
        currency: cur,
        ref,
        narration: words.narration + ' ' + ref,
        source_ref
      },
      by
    );
    const out = Object.assign(span.form ? { payment_ref: ref } : { challan_no: ref, payment_ref: ref }, { paid_minor: paid.minor });
    return Object.assign(out, Object.keys(rcm.minor).length ? { rcm_paid_minor: rcm.minor } : {}, r);
  });
}

/* ═══ 5. loans ════════════════════════════════════════════════════════════════════════════════════════════════════ */
const LOAN_ROLE = { secured: 'secured_loan', unsecured: 'unsecured_loan', overdraft: 'bank_od' };
const LOAN_ROLES = Object.keys(LOAN_ROLE).map((item) => LOAN_ROLE[item]);
/** POST /loans { ref|client_ref, lender, amount, into, rate?, kind? } — a loan TAKEN: Dr where the money came in · Cr the loan account */
async function takeLoan(entity, s, b, by) {
  const cur = B.curOf(s);
  const ref = String(b.ref || b.client_ref || '')
    .trim()
    .slice(0, 60);
  if (!ref) throw ask('Give the loan a reference you will know it by (the sanction letter or loan number).');
  const lender = String(b.lender || '')
    .trim()
    .slice(0, 120);
  if (!lender) throw ask('Who is the lender?');
  const amount = amountOf(b, 'amount', cur, { ask: 'How much was the loan?' });
  const into = String(b.into || b.bank || 'bank');
  if (MODES.indexOf(into) < 0) throw ask('Where did the money come in? bank, upi, cash or card.');
  const kind = b.kind == null ? 'secured' : String(b.kind);
  if (!LOAN_ROLE[kind]) throw ask('Is it secured, unsecured or an overdraft?');
  let rate = null;
  if (b.rate != null && b.rate !== '') {
    rate = Number(b.rate);
    if (!(rate >= 0 && rate <= 100)) throw ask('The interest rate is a percentage a year, between 0 and 100.');
  }
  const date = dateOf(b, 'date', today(s));
  return postOwn(
    null,
    entity,
    {
      type: 'loan_taken',
      loan: LOAN_ROLE[kind],
      into,
      amount: toRupees(amount, cur),
      date,
      currency: cur,
      ref,
      narration: 'Loan from ' + lender + (rate != null ? ' at ' + rate + '% a year' : ''),
      source_ref: 'loan:' + ref
    },
    by
  );
}
/** POST /loans/:ref/emi { principal, interest, from?, date, client_ref } — the bank's split AS GIVEN: Dr the loan · Dr interest · Cr the bank */
async function loanEmi(entity, s, ref, b, by) {
  const cur = B.curOf(s);
  const cref = refOf(b);
  if (!cref) throw ask("Give this instalment a reference (the month, or the bank's number) so a second tap does not record it twice.");
  const principal = amountOf(b, 'principal', cur, { optional: true, zero: true }) || 0;
  const interest = amountOf(b, 'interest', cur, { optional: true, zero: true }) || 0;
  if (!principal && !interest) throw ask('How much of the instalment was the loan and how much interest? Give the split from the bank.');
  const from = String(b.from || b.bank || 'bank');
  if (MODES.indexOf(from) < 0) throw ask('Paid from where? bank, upi, cash or card.');
  const date = dateOf(b, 'date', today(s));
  return withEntity(entity, async (h) => {
    const loan = await S.entryBySource(h, entity, 'loan:' + ref);
    if (!loan) {
      const e = new Error('No loan with that reference.');
      e.code = 'BOOKS_NOT_FOUND';
      throw e;
    }
    const full = await S.entry(h, entity, loan.entry_id),
      chart = await S.accounts(h, entity);
    const acct = (full.lines || [])
      .map((item) => chart.find((a) => String(a.account_id) === String(item.account_id)))
      .find((item) => item && LOAN_ROLES.indexOf(item.role) >= 0);
    if (!acct) throw refuse('That entry is not a loan.');
    return postOwn(
      h,
      entity,
      {
        type: 'loan_repaid',
        loan: acct.role,
        principal: toRupees(principal, cur),
        interest: toRupees(interest, cur),
        from,
        date,
        currency: cur,
        ref: ref + '/' + cref,
        narration: 'Instalment on loan ' + ref,
        source_ref: 'emi:' + ref + ':' + cref
      },
      by
    );
  });
}

/* ═══ 6. accruals ═════════════════════════════════════════════════════════════════════════════════════════════════ */
const ACCRUALS = ['outstanding', 'prepaid', 'accrued_income', 'income_in_advance'];
/** the first day of the period after the one `date` falls in — where the accrual turns back */
function reversalDate(s, date) {
  const pack = B.packOf(s),
    A = E.packs(),
    fy = A.fiscalYearOf(date, pack),
    p = A.periodOf(date, pack);
  return B.addDays(A.periodRange(fy, p, pack).end, 1);
}
/** POST /accruals { ref|client_ref, kind, class, amount, date } — at a period end; it comes back on the first day of the next period (reverses_on) */
async function accrue(entity, s, b, by) {
  const cur = B.curOf(s);
  const ref = String(b.ref || b.client_ref || '')
    .trim()
    .slice(0, 60);
  if (!ref) throw ask('Give the accrual a reference (e.g. ELEC-2026-09).');
  const kind = String(b.kind || '');
  if (ACCRUALS.indexOf(kind) < 0) throw ask('Is it an outstanding expense, a prepaid expense, income accrued, or income received in advance?');
  const cls = String(b.class || '').trim();
  if (!cls) throw ask('Which expense or income ledger is it for?');
  const amount = amountOf(b, 'amount', cur, { ask: 'How much?' });
  const date = dateOf(b, 'date', today(s));
  const r = await postOwn(
    null,
    entity,
    {
      type: 'accrual',
      kind,
      class: cls,
      amount: toRupees(amount, cur),
      date,
      currency: cur,
      ref,
      narration:
        String(b.narration || '')
          .trim()
          .slice(0, 200) || 'Accrual ' + ref,
      source_ref: 'accrual:' + ref
    },
    by
  );
  return Object.assign({ ref, kind, reverses_on: reversalDate(s, date) }, r);
}
/** POST /accruals/:ref/reverse { date?, client_ref? } — the engine's own reversal (reverse: true, reverses: ref); due from the first day of the next period */
async function reverseAccrual(entity, s, ref, b, by) {
  const cur = B.curOf(s);
  return withEntity(entity, async (h) => {
    const head = await S.entryBySource(h, entity, 'accrual:' + ref);
    if (!head) {
      const e = new Error('No accrual with that reference.');
      e.code = 'BOOKS_NOT_FOUND';
      throw e;
    }
    const full = await S.entry(h, entity, head.entry_id),
      chart = await S.accounts(h, entity);
    const lines = (full.lines || []).map((item) =>
      Object.assign({}, item, { acct: chart.find((a) => String(a.account_id) === String(item.account_id)) || {} })
    );
    const roles = lines.map((item) => item.acct.role);
    const kind =
      roles.indexOf('prepaid_expenses') >= 0
        ? 'prepaid'
        : roles.indexOf('accrued_income') >= 0
          ? 'accrued_income'
          : roles.indexOf('income_in_advance') >= 0
            ? 'income_in_advance'
            : 'outstanding';
    const fixed =
      kind === 'prepaid' ? 'prepaid_expenses' : kind === 'accrued_income' ? 'accrued_income' : kind === 'income_in_advance' ? 'income_in_advance' : null;
    const other = lines.find((item) => (fixed ? item.acct.role !== fixed : item.dr_minor > 0)) || lines[0];
    const due = reversalDate(s, E.ymd(full.posting_date));
    const date = dateOf(b, 'date', due);
    if (date < due) throw refuse('This accrual turns back on ' + due + ', the first day of the next month — not before.');
    if (date > today(s)) throw refuse('This accrual turns back on ' + date + ' — it is not due yet.');
    return postOwn(
      h,
      entity,
      {
        type: 'accrual',
        kind,
        class: other.acct.code,
        amount: toRupees(full.total_minor, cur),
        date,
        currency: cur,
        reverse: true,
        reverses: ref,
        ref: ref + '/rev',
        narration: 'Reversal of accrual ' + ref,
        source_ref: 'accrual-rev:' + ref
      },
      by,
      true
    );
  });
}

/* ═══ 7. contra ═══════════════════════════════════════════════════════════════════════════════════════════════════ */
/** POST /contra { from, to, amount, date, client_ref } — cash ↔ bank ↔ UPI (the engine refuses the same account on both sides) */
/** the engine's contra event for a typed move — ONE builder, read by the POST /contra route and by the "＋ Entry" preview */
function contraEvent(s, b) {
  const cur = B.curOf(s);
  const from = String(b.from || '').trim(),
    to = String(b.to || '').trim();
  if (!from || !to) throw ask('Moved from where, to where? cash, bank, upi or card.');
  const amount = amountOf(b, 'amount', cur, { ask: 'How much was moved?' });
  const date = dateOf(b, 'date', today(s));
  const ref = refOf(b);
  return {
    type: 'contra',
    from,
    to,
    amount: toRupees(amount, cur),
    date,
    currency: cur,
    narration:
      String(b.narration || '')
        .trim()
        .slice(0, 200) || 'Moved from ' + from + ' to ' + to,
    source_ref: ref ? 'contra:' + ref : null
  };
}
async function contra(entity, s, b, by) {
  return postOwn(null, entity, contraEvent(s, b), by);
}

/* ═══ THE SHOP'S OWN RETURN (BAS1, engines v1.39.0) — BAS (AU) · VAT201 (AE): a READ of the posted books, dispatched to the pack by gst-returns.returnFor ═══
   Nothing is recomputed here: the period's movements are the account_balance rows the writer already keeps (one per account per month), summed by code and
   handed to the engine by ROLE; the engine's `roles` on each box are joined back to the shop's chart so every figure opens the ledgers it counts.
   India is refused by name — its GSTR-1 / 3B are read from the frozen invoices on the rail (routes/tax.js GET /api/tax/gstr), not from the ledgers. */
const GR = () => require('./gst-returns');
const PREPARED = 'Prepared, not lodged';
const nextMonth = (ymd) => {
  const y = Number(ymd.slice(0, 4)),
    m = Number(ymd.slice(5, 7));
  return (m === 12 ? y + 1 : y) + '-' + String(m === 12 ? 1 : m + 1).padStart(2, '0') + '-01';
};
/** the pack's period table (gst-returns.periodsFor), for the year that holds `day` and the one before — AU by financial year, AE by the FTA stagger (never guessed) */
function returnPeriods(pack, q, day) {
  const A = E.packs(),
    R = pack.returns || {};
  if (R.id === 'BAS') {
    const fy = A.fiscalYearOf(day, pack),
      prev = A.fiscalYearOf(B.addDays(A.fyRange(fy, pack).start, -1), pack),
      frequency = q.frequency === 'monthly' ? 'monthly' : 'quarterly',
      out = [];
    for (const y of [prev, fy]) {
      const r = GR().periodsFor(pack, { fy: y, frequency });
      if (!r.ok) throw refuse(r.why);
      out.push(...r.periods);
    }
    return { periods: out, asked: { frequency } };
  }
  if (R.id === 'VAT201') {
    const stagger = q.stagger == null || q.stagger === '' ? null : String(q.stagger).toLowerCase(),
      year = Number(day.slice(0, 4)),
      out = [];
    if (!stagger) {
      const none = GR().periodsFor(pack, { year });
      return { periods: [], asked: { stagger: null }, needs: 'stagger', why: none.why };
    }
    for (const y of [year - 1, year]) {
      const r = GR().periodsFor(pack, { stagger, year: y });
      if (!r.ok) throw refuse(r.why);
      out.push(...r.periods);
    }
    return { periods: out, asked: { stagger: /^\d$/.test(stagger) ? Number(stagger) : stagger } };
  }
  return ownPeriods(pack, day);
}
/** R5: any other pack that names its periods (a new country's returns.periods reads { year }) — the year before and this one; none → no periods */
function ownPeriods(pack, onDay) {
  if (typeof (pack.returns || {}).periods !== 'function') return { periods: [], asked: {} };
  const year = Number(onDay.slice(0, 4)),
    periods = [];
  for (const y of [year - 1, year]) {
    const table = GR().periodsFor(pack, { year: y });
    if (!table.ok) throw refuse(table.why);
    periods.push(...table.periods);
  }
  return { periods, asked: {} };
}
/** the period's ledger MOVEMENTS by account — the monthly balance rows (party-less grain) of every month from `start` to `end`, summed by code; roles from the chart */
async function movementsBetween(h, entity, c, start, end) {
  const A = E.packs(),
    months = [],
    byCode = Object.create(null);
  for (let d = start.slice(0, 7) + '-01'; d <= end; d = nextMonth(d)) months.push({ fy: A.fiscalYearOf(d, c.pack), period: Number(A.periodOf(d, c.pack)) });
  for (const fy of Array.from(new Set(months.map((item) => item.fy)))) {
    if (c.years.length && c.years.indexOf(fy) < 0) continue; /* a year with no rows at all: nothing moved */
    (await S.yearRows(h, entity, fy))
      .map((item) => E.balanceOf(item, S.ZERO))
      .forEach((item) => {
        if (item.party || !months.some((m) => m.fy === fy && m.period === Number(item.period)))
          return; /* the account grain only — the party rows are the same money again */
        const a = byCode[item.code] || (byCode[item.code] = { dr: 0, cr: 0 });
        a.dr += Number(item.dr_minor);
        a.cr += Number(item.cr_minor);
      });
  }
  /* W2-BOOKS: the period's own set-off and statutory payment entries move the tax ledgers but are not sales or purchases — the form's boxes leave them out
     (1A is the GST on sales, not what was left after the set-off). One trip; the entries are counted so the return can say so. */
  const settled = await S.taxEntryLines(h, entity, start, end, taxEventNames(c.pack));
  settled.forEach((line) => {
    const sums = byCode[line.code];
    if (sums) {
      sums.dr -= Number(line.dr_minor);
      sums.cr -= Number(line.cr_minor);
    }
  });
  const rows = Object.keys(byCode)
    .sort()
    .map((code) => {
      const account = c.chart.find((x) => String(x.code) === code) || {};
      return { code, role: account.role || null, name: account.name || null, dr_minor: byCode[code].dr, cr_minor: byCode[code].cr };
    });
  return { rows, leftOut: new Set(settled.map((line) => line.entry_id)).size };
}
/** the one sentence the return carries when the period's own set-off / tax payment entries were left out of its boxes (W2-BOOKS) */
const settledNoteOf = (movements) =>
  movements.leftOut
    ? [
        "The period's own set-off and tax payment entries (" +
          movements.leftOut +
          ') are left out of the boxes: they settle the tax, they are not sales or purchases.'
      ]
    : [];
/** the return's notes: the engine's, then the one about the entries left out */
const notesOf = (answer, movements) => (answer.notes || []).concat(settledNoteOf(movements));
/** the event names a set-off and a tax payment are stored under in this pack's books — the neutral names and the pack's own aliases (IN · AU gst_setoff / gst_payment) */
const taxEventNames = (pack) =>
  Array.from(new Set(['tax_setoff', 'tax_payment'].reduce((all, neutral) => all.concat([neutral, eventNameOf(pack, neutral)]), [])));
/**
 * GET /returns?period&frequency&simpler&stagger&emirate → { currency, pack, form, name, short, authority, portal, prepared, asked, periods: [{ period, label, start, end, due,
 *   frequency, ended }], period, boxes: [{ code, label, amount_minor, tax_minor, roles, accounts: [{ code, name }], note }], payable_minor, refund_minor, net_minor, notes, cite,
 *   emirates? · staggers? (AE: the pack's own tables for the pickers) · needs: 'stagger' + why (AE, until the FTA stagger is given — nothing is guessed) }.
 * The chosen period: `period` as the pack names it ('2026-Q1' · '2026-07' · '2026-02/2026-04'), else the latest one that has ended, else the first. `simpler` (AU): '0' asks the
 * full BAS (G2 G3 G10 G11); default Simpler BAS. India → 422 RETURN_FROM_RAIL (its GSTR is read from the rail, GET /api/tax/gstr).
 */
/* PR1 (2026-10-13), additive: `q.on` (YYYY-MM-DD) asks for the period that CONTAINS that day (the parallel-run compare holds a snapshot's period end), and `h0` runs
   the read inside the caller's own transaction (the compare reads its statements and this return in one) — without either, unchanged */
async function taxReturn(entity, s, q, h0) {
  const cur = B.curOf(s),
    pack0 = B.packOf(s),
    on = q && /^\d{4}-\d{2}-\d{2}$/.test(String(q.on || '')) ? String(q.on) : null,
    day = on || today(s);
  if (!pack0.returns || !pack0.returns.id) {
    const e = refuse(
      pack0.id === 'IN'
        ? "India's GSTR-1 and GSTR-3B are read from the frozen invoices on the rail (GET /api/tax/gstr), not from the ledgers."
        : 'No return is built for the ' + pack0.id + ' pack yet.',
      'RETURN_FROM_RAIL'
    );
    e.pack = pack0.id;
    throw e;
  } /* the route answers this one as 200 form:null (TOUR-FIX1) */
  const run = async (h) => {
    const c = await B.ledgerCtx(h, entity),
      pack = c.pack,
      R = pack.returns;
    const base = { currency: cur, pack: pack.id, form: R.id, name: R.name, short: R.short, authority: R.authority, portal: R.portal, prepared: PREPARED };
    const pt = returnPeriods(pack, q || {}, day);
    const periods = pt.periods.map((item) => Object.assign({}, item, { ended: item.end <= today(s) }));
    if (pt.needs)
      return Object.assign(base, {
        asked: pt.asked,
        needs: pt.needs,
        why: pt.why,
        periods,
        period: null,
        boxes: [],
        payable_minor: 0,
        refund_minor: 0,
        net_minor: 0,
        notes: [],
        cite: null,
        emirates: R.emirates || [],
        staggers: R.staggers || {}
      });
    const want = String((q && q.period) || '');
    const period =
      periods.find((item) => item.period === want) ||
      (on ? periods.find((item) => item.start <= on && on <= item.end) : null) ||
      periods.filter((item) => item.ended).pop() ||
      periods[0];
    if (!period) throw refuse('No ' + R.short + ' period is known for ' + day + '.');
    const movements = await movementsBetween(h, entity, c, period.start, period.end);
    const opts = {};
    if (R.id === 'BAS') opts.simpler = !(q && (q.simpler === '0' || q.simpler === 'false' || q.simpler === false));
    if (R.id === 'VAT201') opts.emirate = q && q.emirate ? String(q.emirate) : null;
    const r = GR().returnFor(
      pack,
      period.period,
      movements.rows.filter((item) => item.role),
      opts
    );
    if (!r.ok) throw refuse(r.why);
    /* the box's ledgers in the ROLES' order (the form's: the amount ledgers, then the tax ledger), each once */
    const accountsOf = (roles) =>
      roles.reduce(
        (nestedOut, role) =>
          nestedOut.concat(c.chart.filter((item) => !item.is_group && item.role === role).map((item) => ({ code: String(item.code), name: item.name }))),
        []
      );
    const boxes = r.boxes.map((item) => ({
      code: item.code,
      label: item.label,
      amount_minor: item.amount_minor,
      tax_minor: item.tax_minor,
      roles: item.roles,
      accounts: accountsOf(item.roles),
      note: item.note
    }));
    const out = Object.assign(base, {
      asked: Object.assign({}, pt.asked, R.id === 'BAS' ? { simpler: opts.simpler } : { emirate: opts.emirate }),
      periods,
      period,
      boxes,
      payable_minor: r.payable_minor,
      refund_minor: r.refund_minor,
      net_minor: r.net_minor,
      notes: notesOf(r, movements),
      cite: r.cite
    });
    if (R.id === 'VAT201') {
      out.emirates = R.emirates || [];
      out.staggers = R.staggers || {};
    } /* the pack's own tables for the pickers: the seven Emirates, the four FTA staggers */
    return out;
  };
  return h0 ? run(h0) : withEntity(entity, run);
}

module.exports = {
  amountOf,
  dateOf,
  refOf,
  toRupees,
  today,
  contraEvent,
  listAssets,
  addAsset,
  disposeAsset,
  runDepreciation,
  closingStock,
  gstClose,
  returnPeriods,
  returnStateFor,
  returnStatesFor,
  shopChargesTax,
  gstPay,
  takeLoan,
  loanEmi,
  accrue,
  reverseAccrual,
  contra,
  reversalDate,
  ask,
  gstBalances,
  balancesOf,
  gstPayableAt,
  taxReturn
};
