// @stage tested
// OWNS  the period-end entries: closing stock · depreciation · accruals · the tax set-off and payment (gst/close · gst/pay, country-first) · the return read · year close.
// CALLED BY routes/books.js (the period-end routes).
// FLOW  route → the period's ledgers read → the pack's heads and words → one transaction of entries → the answer
// CARD 16-finance/month-and-year-end
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
/* CX2: a year is named the way its PACK names it — '2026-27' (IN · AU, a split year), '2026' (AE, the calendar year); India's answers unchanged */
const fyAsk = (pack) => ask('Which financial year? e.g. ' + E.packs().fyLabel(2026, pack) + '.');
const fyOk = (fiscalYear, pack) => /^\d{4}(-\d{2})?$/.test(fiscalYear) && E.packs().fyLabel(Number(fiscalYear.slice(0, 4)), pack) === fiscalYear;
const ask = (reason) => {
  const e = new Error(reason);
  e.code = 'BOOKS_BAD_REQUEST';
  e.status = 400;
  return e;
};
const refuse = (reason, code) => {
  const e = new Error(reason);
  e.code = code || 'BOOKS_REFUSED';
  e.refused = true;
  return e;
};
/* the shop's day, from the one reader the writer uses (typedDate), so a stubbed clock moves both */
const today = (shop) => CLOCK.today(shop); /* the shop's day; unstated → UTC (books-hooks.zoneOf), never India */
/* major ↔ minor: the api's ONE pair (books-cashflow toMinor · fromMinor — money.round and the currency's own decimals), lazy: that module reads this one (ACC-179 fold) */
const toMinor = (rupees, currency) => require('./books-cashflow').toMinor(rupees, currency);
const toRupees = (minor, currency) => require('./books-cashflow').fromMinor(minor, currency);
const withEntity = (e, fn) => require('../db').withEntity(e, fn);

/** an amount in minor units (`<key>_minor`) or rupees (`<key>`) → a positive integer of minor units, else a plain question */
function amountOf(body, key, currency, opt) {
  const options = opt || {};
  let minor = null;
  if (body[key + '_minor'] != null && body[key + '_minor'] !== '') minor = Number(body[key + '_minor']);
  else if (body[key] != null && body[key] !== '') minor = toMinor(body[key], currency);
  if (minor == null) {
    if (options.optional) return null;
    throw ask(options.ask || 'How much?');
  }
  if (!Number.isInteger(minor) || minor < 0 || (minor === 0 && !options.zero)) throw ask(options.ask || 'The amount must be above nothing.');
  return minor;
}
/* FIN-103 / ACC-333: the years the books can hold. A day is read through the shop's zone and its next day is built from it (books-hooks.dayBounds); year 0001 and
   9999 answer "Invalid time value" there (a 500). 1900–2100 is a trading life with a century of room. A day outside it is not a day the books hold:
   refused by name, never clamped. */
const YEAR_FIRST = 1900;
const YEAR_LAST = 2100;
/** a real calendar day written YYYY-MM-DD (2026-02-30 is not one) in a year the books hold: the shape alone let it through to a database 22008 or a RangeError */
const isCalendarDay = (text) => {
  if (!DATE.test(text)) return false;
  const [year, month, dayOfMonth] = text.split('-').map(Number);
  if (year < YEAR_FIRST || year > YEAR_LAST) return false;
  const moment = new Date(Date.UTC(year, month - 1, dayOfMonth)); /* the parts read back unchanged only for a real day (no private date reader: natdef-guard) */
  return moment.getUTCFullYear() === year && moment.getUTCMonth() === month - 1 && moment.getUTCDate() === dayOfMonth;
};
/**
 * ACC-274: THE one reader of a date a caller may send (routes/books.js dateQ and dateOf below both come here).
 * `field` is the name the caller used; a query reader that does not know it passes null and refusalOf finds it by the value given.
 * ABSENT (undefined · null · '') → the fallback; GIVEN but not a real YYYY-MM-DD day (03/10/2026 · 2026-02-30) → 400 DATE_INVALID naming the field.
 * A date-time keeps its day (the first ten characters), as both readers always did.
 */
function dateGiven(value, field, fallback) {
  if (value == null || value === '') return fallback;
  const calendarDay = String(value).slice(0, 10);
  if (isCalendarDay(calendarDay)) return calendarDay;
  throw Object.assign(ask('Which date? Use YYYY-MM-DD.'), { code: 'DATE_INVALID', field, given: String(value) });
}
/**
 * ACC-333 / ACC-334: THE one reader of a month a caller may send (tax-copy.monthBounds, so /api/tax/ledger and /api/tax/gstr, come here).
 * ABSENT (undefined · null · '') → the fallback; GIVEN but not YYYY-MM naming a real month of a year the books hold
 * (abc · 2026-13 · 2026-02-30 · 0001-01 · 9999-12) → 400 DATE_INVALID naming the field, never the fallback. The year range is dateGiven's, by going through isCalendarDay.
 */
function monthGiven(value, field, fallback) {
  if (value == null || value === '') return fallback;
  const text = String(value);
  if (/^\d{4}-\d{2}$/.test(text) && isCalendarDay(text + '-01')) return text;
  throw Object.assign(ask('Which month? Use YYYY-MM, like 2026-10.'), { code: 'DATE_INVALID', field, given: text });
}
function dateOf(body, key, dflt) {
  const field = key || 'date';
  const value = dateGiven(body[field], field, dflt);
  if (!value) throw ask('Which date? Use YYYY-MM-DD.');
  return value;
}
const refOf = (body) => (body.client_ref ? String(body.client_ref).slice(0, 80) : null);

/**
 * the one door every entry here goes through — ON THE CALLER'S HANDLE (M2, PAY-FIX): the asset / depreciation entry and the register
 * row commit together or not at all. `handle` null = a caller holding no transaction (a loan, an accrual, a contra): postEntry opens its own.
 */
function postOwn(handle, entity, event, by, system) {
  return B.postEntry(handle, entity, Object.assign({}, event, { owner: !system, strict_date: true, by }));
}

/* ── reading the books through the engine ─────────────────────────────────────────────────────────────────────── */
/** the books as at a date: { accounts[code], byRole[role] } from CBLedger.balanceAsAt — never summed here */
async function balancesAt(handle, entity, asOf) {
  const asAt = await B.asAtInput(handle, entity, asOf);
  return balancesOf(E.ledger().balanceAsAt(asAt), asAt.pack);
}
/** the engine's balanceAsAt answer shaped { accounts, byRole, pack } — F3 (lib/books-cashflow) reads the ledger ONCE and hands it in here, so there is no second read */
function balancesOf(answer, pack) {
  const byRole = {};
  Object.keys((answer && answer.accounts) || {}).forEach((item) => {
    const account = answer.accounts[item];
    if (account.role) byRole[account.role] = account;
  });
  return { accounts: (answer && answer.accounts) || {}, byRole, pack };
}
const netOf = (balances, role) => (balances.byRole[role] ? Number(balances.byRole[role].net_minor) : 0);

/** the month a date falls in must be open — the engine-side question is postingDateFor's, so the refusal is the same sentence */
async function mustBeOpen(handle, entity, shop, date) {
  await B.postingDateFor(handle, entity, date, B.packOf(shop), false, true, shop);
}
function periodDates(shop, fiscalYear, period) {
  if (!fyOk(String(fiscalYear || ''), B.packOf(shop))) throw fyAsk(B.packOf(shop));
  const monthNo = Number(period);
  if (!Number.isInteger(monthNo) || monthNo < 1 || monthNo > 12) throw ask('Which month of the year? 1 to 12.');
  const range = E.packs().periodRange(fiscalYear, monthNo, B.packOf(shop));
  if (!range) throw ask('That financial year or month is not one the books know.');
  return range;
}

/* ═══ 1. the asset register ═══════════════════════════════════════════════════════════════════════════════════════ */
const MODES = ['cash', 'bank', 'upi', 'card'];
function classOf(shop, name) {
  const list = B.packOf(shop).asset_classes || [];
  const found = list.find((x) => x.class === name);
  if (!found) throw ask('Which kind of asset? ' + list.map((x) => x.class).join(', ') + '.');
  return found;
}

/** GET /assets — the register, each asset's written-down value, and the books' own figure beside it */
async function listAssets(entity, shop, asOf) {
  return withEntity(entity, async (handle) => {
    await Assets.need(handle, entity);
    const rows = await Assets.list(handle, entity);
    const currency = B.curOf(shop);
    const live = rows.filter((item) => !item.disposed_on);
    const assets = rows.map((item) => Object.assign({}, item, { wdv_minor: item.disposed_on ? 0 : item.cost_minor - item.accumulated_minor }));
    const balances = await balancesAt(handle, entity, asOf);
    const by = new Map();
    for (const a of live) {
      const group = by.get(a.asset_class) || { asset_class: a.asset_class, count: 0, cost_minor: 0, accumulated_minor: 0 };
      group.count += 1;
      group.cost_minor += a.cost_minor;
      group.accumulated_minor += a.accumulated_minor;
      by.set(a.asset_class, group);
    }
    const net_block = Array.from(by.values()).map((item) => {
      const classDef = classOf(shop, item.asset_class);
      /* the books' own figures for the class, read through balanceAsAt: cost is a debit, accumulated depreciation a credit */
      const led_cost = netOf(balances, classDef.cost_role),
        led_acc = -netOf(balances, classDef.acc_role);
      return Object.assign({}, item, {
        wdv_minor: item.cost_minor - item.accumulated_minor,
        ledger_cost_minor: led_cost,
        ledger_accumulated_minor: led_acc,
        ledger_wdv_minor: led_cost - led_acc,
        agrees: led_cost === item.cost_minor && led_acc === item.accumulated_minor
      });
    });
    return { currency: currency, asOf, assets, net_block, total_wdv_minor: net_block.reduce((total, item) => total + item.wdv_minor, 0) };
  });
}

/** POST /assets — one added by hand: the engine's purchase_bill, accepted as an asset (cost to the class's PPE ledger), then the row */
async function addAsset(entity, shop, body, by) {
  const currency = B.curOf(shop);
  const name = String(body.name || '')
    .trim()
    .slice(0, 120);
  if (!name) throw ask('What is the asset called?');
  const assetClass = classOf(shop, String(body.class || body.asset_class || ''));
  const cost = amountOf(body, 'cost', currency, { ask: 'What did it cost?' });
  const date = dateOf(body, 'date', today(shop));
  const putToUse = dateOf(body, 'put_to_use', date);
  if (putToUse < date) throw ask('It cannot be put to use before it was bought.');
  const payMode = body.how == null ? '' : String(body.how);
  const party = body.party_id || body.party || null;
  if (!party && MODES.indexOf(payMode) < 0) throw ask('How was it paid? cash, bank, upi or card — or name the supplier it is owed to.');
  const ref = refOf(body);
  return withEntity(entity, async (handle) => {
    await Assets.need(handle, entity);
    const event = {
      type: 'purchase_bill',
      accept: 'asset',
      asset_class: assetClass.class,
      date,
      currency: currency,
      ref: name,
      by_rate: [{ rate: 0, taxable: toRupees(cost, currency), cgst: 0, sgst: 0, igst: 0 }],
      paid: party ? {} : { [payMode]: toRupees(cost, currency) },
      narration: 'Asset bought: ' + name,
      source_ref: ref ? 'asset:' + ref : null
    };
    if (party) event.party = String(party);
    const posted = await postOwn(handle, entity, event, by);
    if (!posted.ok) return posted;
    const row = await Assets.add(handle, entity, {
      name,
      asset_class: assetClass.class,
      cost_minor: cost,
      currency: currency,
      put_to_use: putToUse,
      source_entry_id: posted.entry_id,
      by
    });
    return Object.assign({}, posted, { asset: row && Object.assign({}, row, { wdv_minor: row.cost_minor - row.accumulated_minor }) });
  });
}

/** POST /assets/:id/dispose — the engine's asset_disposal: accumulated and cost off, the balance a profit or a loss on sale */
async function disposeAsset(entity, shop, id, body, by) {
  const currency = B.curOf(shop);
  const date = dateOf(body, 'date', today(shop));
  const proceeds = amountOf(body, 'proceeds', currency, { optional: true, zero: true, ask: 'What did it fetch?' }) || 0;
  const payMode = body.into == null ? (proceeds ? 'bank' : 'cash') : String(body.into);
  if (proceeds && MODES.indexOf(payMode) < 0 && !body.party_id) throw ask('Where did the money come in? cash, bank, upi or card.');
  return withEntity(entity, async (handle) => {
    await Assets.need(handle, entity);
    const asset = await Assets.get(handle, entity, id);
    if (!asset) {
      const e = new Error('No such asset.');
      e.code = 'BOOKS_NOT_FOUND';
      throw e;
    }
    if (asset.disposed_on) return { ok: true, duplicate: true, asset: asset, entry_id: asset.disposal_entry_id };
    if (date < asset.put_to_use) throw ask('It cannot be disposed of before it was put to use (' + asset.put_to_use + ').');
    const event = {
      type: 'asset_disposal',
      asset_class: asset.asset_class,
      cost: toRupees(asset.cost_minor, asset.currency),
      accumulated: toRupees(asset.accumulated_minor, asset.currency),
      proceeds: toRupees(proceeds, asset.currency),
      date,
      currency: asset.currency,
      ref: asset.name,
      narration: (proceeds ? 'Asset sold: ' : 'Asset scrapped: ') + asset.name,
      source_ref: 'asset-dispose:' + asset.asset_id
    };
    if (body.party_id) event.party = String(body.party_id);
    else if (proceeds) event.into = payMode;
    const posted = await postOwn(handle, entity, event, by);
    if (!posted.ok) return posted;
    await Assets.markDisposed(handle, entity, asset.asset_id, date, posted.entry_id, proceeds);
    return Object.assign({}, posted, { asset: Object.assign({}, asset, { disposed_on: date, disposal_entry_id: posted.entry_id, proceeds_minor: proceeds, wdv_minor: 0 }) });
  });
}

/** one register row as the engine's depreciationFor asks for it: cost, the day put to use, the opening WDV when bought before the year, the sale when disposed */
function engineAsset(item, range) {
  const asset = { id: item.asset_id, class: item.asset_class, cost: toRupees(item.cost_minor, item.currency), put_to_use: item.put_to_use };
  if (item.put_to_use < range.start) asset.opening_wdv = toRupees(item.cost_minor - item.accumulated_minor, item.currency);
  if (item.disposed_on) asset.sold = { proceeds: toRupees(item.proceeds_minor || 0, item.currency) };
  return asset;
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
async function runDepreciation(entity, shop, body, by) {
  const fiscalYear = String(body.fy || '');
  const pack = B.packOf(shop);
  if (!fyOk(fiscalYear, pack)) throw fyAsk(pack);
  const range = E.packs().fyRange(fiscalYear, pack);
  if (!range) throw ask('That financial year is not one the books know.');
  const known = B.entityBasisOf(shop);
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
  const source_ref = 'depreciation:' + fiscalYear;
  return withEntity(entity, async (handle) => {
    await Assets.need(handle, entity);
    const seen = await S.entryBySource(handle, entity, source_ref);
    if (seen)
      return {
        ok: true,
        duplicate: true,
        entry_id: seen.entry_id,
        entry_no: seen.entry_no,
        posting_date: E.ymd(seen.posting_date),
        fy: fiscalYear,
        entity_basis: basis,
        basis_assumed: !known,
        entity_note: note
      };
    if (range.end > today(shop)) throw refuse('Depreciation for ' + fiscalYear + ' runs at the year end (' + range.end + ') or after — the year has not ended.');
    const register = await Assets.list(handle, entity);
    const currency = B.curOf(shop);
    const inYear = register.filter((item) => item.put_to_use <= range.end && (!item.disposed_on || item.disposed_on >= range.start));
    if (!inYear.length)
      return {
        ok: true,
        nothing_to_post: true,
        fy: fiscalYear,
        entity_basis: basis,
        basis_assumed: !known,
        entity_note: note,
        why: 'There are no assets in the register for ' + fiscalYear + '.'
      };
    await mustBeOpen(handle, entity, shop, range.end);
    const assets = inYear.map((item) => engineAsset(item, range));
    const depreciation = E.posting().depreciationFor({
      entity: basis,
      method: shop && shop.depreciation_method ? String(shop.depreciation_method) : undefined,
      fiscal_year: fiscalYear,
      date: range.end,
      ref: 'DEP-' + fiscalYear,
      assets,
      pack
    });
    if (!depreciation.ok) throw refuse(depreciation.why);
    const base = {
      ok: true,
      fy: fiscalYear,
      entity_basis: basis,
      basis_assumed: !known,
      entity_note: note,
      basis_rule: depreciation.basis,
      by_class: depreciation.by_class,
      by_asset: depreciation.by_asset
    };
    if (!depreciation.event) return Object.assign(base, { nothing_to_post: true, why: 'Nothing to depreciate for ' + fiscalYear + '.' });
    const event = Object.assign({}, depreciation.event, { currency: currency, narration: 'Depreciation ' + fiscalYear + ' (' + depreciation.basis + ')', source_ref });
    const posted = await postOwn(handle, entity, event, by, true);
    if (!posted.ok) return posted;
    for (const a of depreciation.by_asset) await Assets.addDepreciation(handle, entity, a.id, toMinor(a.amount, currency), fiscalYear);
    return Object.assign(base, posted);
  });
}

/* ═══ 3. closing stock ════════════════════════════════════════════════════════════════════════════════════════════ */
/** POST /closing-stock { date, value_minor, nrv_minor?, method } — only the DIFFERENCE from the books posts (the engine reads `book`)
 *  method 'manual' — the owner types the value · 'automatic' (T1-INV) — valued from the shop's OWN stock ledger as at the end of `date` */
async function closingStock(entity, shop, body, by) {
  const currency = B.curOf(shop);
  const date = dateOf(body, 'date');
  const mode = body.method == null ? 'manual' : String(body.method);
  if (mode !== 'manual' && mode !== 'automatic')
    throw ask("How is the closing stock found? 'manual' (you enter the value) or 'automatic' (valued from the stock ledger).");
  let value = mode === 'manual' ? amountOf(body, 'value', currency, { zero: true, ask: 'What is the stock on hand worth?' }) : null;
  const netRealisable = amountOf(body, 'nrv', currency, { optional: true, zero: true });
  const ref = refOf(body);
  return withEntity(entity, async (handle) => {
    const ledger = mode === 'automatic' ? await ledgerValue(handle, entity, shop, date) : null;
    if (ledger) value = toMinor(ledger.value, currency);
    const balances = await balancesAt(handle, entity, date);
    const book = netOf(balances, 'stock');
    /* ⚠️ the ENGINE's mode stays 'manual' (it is handed the value) until engines posting.js closing_stock accepts 'automatic' with a
       supplied amount — engines are serial and this round does not own them; the difference is still the engine's ONE calculation */
    const event = {
      type: 'closing_stock',
      mode: 'manual',
      date,
      currency: currency,
      book: toRupees(book, currency),
      method: body.cost_formula || (ledger ? 'weighted_average' : undefined),
      narration: 'Closing stock ' + date + (ledger ? ' · from the stock ledger' : ''),
      source_ref: ref ? 'stock:' + ref : null
    };
    if (netRealisable != null) {
      event.cost = toRupees(value, currency);
      event.nrv = toRupees(netRealisable, currency);
    } else event.amount = toRupees(value, currency);
    const posted = await postOwn(handle, entity, event, by, true);
    return Object.assign({ book_minor: book }, ledger ? { from_ledger: { value_minor: value, lines: ledger.lines, movements: ledger.movements } } : {}, posted);
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
async function ledgerValue(handle, entity, shop, date) {
  const stock = require('./stock-store');
  if (!(await require('./schema').hasTable('stock_movement')))
    throw refuse(
      "The stock ledger is not set up on this server yet, so there are no quantities to value. Enter the value by hand ('manual').",
      'STOCK_LEDGER_MISSING'
    );
  const until = require('./books-hooks').dayBounds(date, shop).to;
  /* R104: a dish made to order is not counted (lib/stocked), so it is not in `below_zero` and a tiffin shop can value from the ledger; the value is unchanged */
  const shelf = await stock.asAt(entity, (e, fn) => fn(handle), until, { counted_only: true });
  if (!shelf.movements)
    throw refuse(
      'Nothing was received or sold up to ' + date + ', so the stock ledger has nothing to value. Receive the stock, or enter the value by hand.',
      'STOCK_LEDGER_EMPTY'
    );
  const named = async (ids) => {
    const result = await handle.query(require('./catalogue-read').ITEM_NAMES_SQL, [entity, ids.slice(0, 20)]);
    const by = new Map(result.rows.map((x) => [x.id, x.name]));
    return ids.slice(0, 20).map((id) => by.get(id) || 'item ' + id.slice(0, 8));
  };
  const fail = async (ids, code, suffix) => {
    const items = await named(ids);
    const e = refuse(items.join(', ') + suffix, code);
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
  const words = (pack.messages && pack.messages.paymentRef) || {};
  return {
    label: words.label || 'Payment reference',
    ask: words.ask || 'Which payment? Give its reference.',
    hint: words.hint || 'The reference the authority gave',
    narration: words.narration || 'Tax payment'
  };
}
/** the event name this pack's accountants know a neutral rule by (eventAliases: IN · AU gst_payment; AE none → tax_payment) — the engine's aliasFor_, which it does not export */
const eventNameOf = (pack, neutral) => Object.keys(pack.eventAliases || {}).find((item) => pack.eventAliases[item] === neutral) || neutral;
/** a balance is read at a month end (the books' rows) or at the shop's today — never at a mid-month day with later entries in that month, which the engine cannot cut */
function settledAsOf(shop, date) {
  const pack = B.packOf(shop),
    packs = E.packs(),
    end = packs.periodRange(packs.fiscalYearOf(date, pack), packs.periodOf(date, pack), pack).end;
  return end > today(shop) ? today(shop) : end;
}
/** the pack's tax balances as at a day, by head: output (a credit balance), input credit (a debit balance), reverse-charge owed (a credit balance) — in minor units.
 * ACC-336 `opt.addBack` = { output: { head: minor }, rcm: { head: minor } }: the payments a period NAMES that are already inside this day's balance (dated up to it) put back on the
 * head's NET — signed, BEFORE the floor below, so a payment larger than the day's credit is not lost. The close alone passes it; every other reader reads the ledger as it stands. */
async function gstBalances(handle, entity, asOf, preRead, pack, opt) {
  const back = (opt && opt.addBack) || {};
  if (!pack) throw refuse("The tax balances need the shop's country pack.");
  const balances = preRead || (await balancesAt(handle, entity, asOf)); /* pre: balances already read (balancesOf) — F3 hands them in */
  const output = {},
    input = {},
    rcmOwed = {};
  headsOf(pack).forEach((x) => {
    const outputNet = netOf(balances, x.output) - ((back.output || {})[x.head] || 0),
      inputNet = netOf(balances, x.input);
    output[x.head] = outputNet < 0 ? -outputNet : 0; /* output tax is a credit balance; a debit one is nothing to set off against */
    input[x.head] = inputNet > 0 ? inputNet : 0; /* input credit is a debit balance */
    /* reverse charge (engines v1.20.0): what the shop owes on purchases bought under reverse charge — the credit balance of the head's rcm ledger */
    if (x.rcm) {
      const rcmNet = netOf(balances, x.rcm) - ((back.rcm || {})[x.head] || 0);
      rcmOwed[x.head] = rcmNet < 0 ? -rcmNet : 0;
    }
  });
  return { output, input, rcm: rcmOwed };
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
async function gstPayableAt(handle, entity, shop, asOf, preRead) {
  const currency = B.curOf(shop),
    pack = B.packOf(shop),
    heads = headsOf(pack).map((x) => x.head);
  const balances = await gstBalances(handle, entity, asOf, preRead, pack);
  const setOff = setOffOf(pack, shop, balances, 'CASH-' + asOf, asOf, undefined, currency);
  if (!setOff.ok) return { payable_minor: 0, heads: null, rcm_minor: null, why: setOff.why || 'The tax set-off could not be worked out.' };
  const payable = minorByHead(setOff, 'payable', heads, currency);
  let total = heads.reduce((sum, headKey) => sum + payable[headKey + '_minor'], 0),
    rcmMinor = null;
  if (setOff.rcm) {
    rcmMinor = minorByHead(setOff, 'rcm', rcmHeadsOf(pack), currency);
    total += Object.keys(rcmMinor).reduce((sum, headKey) => sum + rcmMinor[headKey], 0);
  }
  return { payable_minor: total, heads: payable, rcm_minor: rcmMinor, why: null };
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
    const range = periodDates(shop, body.fy, body.period),
      monthNo = Number(body.period);
    return {
      key: body.fy + ':' + monthNo,
      ref: 'GSTSO-' + body.fy + '-P' + String(monthNo).padStart(2, '0'),
      label: body.fy + ' month ' + monthNo,
      start: range.start,
      end: range.end,
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
  /* ACC-336: the two meanings of "payable" get their own names — what the period owes BEFORE the payments named for it (the set-off's own answer; payable_minor and
     pay_total_minor stay as aliases for old readers, never to ask for money from) and, in paidFigures, what is STILL to pay after them */
  out.owed_before_payments_minor = out.payable_minor;
  out.owed_before_payments_total_minor = out.pay_total_minor;
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
/* ═══ ACC-336 / 336b: THE CLOSE SETS OFF AGAINST WHAT THE PERIOD REALLY OWES (docs/critique/ACC-336-PLAN.md) ═══════════════════════════════════════════════════════
   A payment belongs to the tax period it NAMES (journal_entry.tax_period, b849), never to the period its date falls in (our convention, matching the portal's challan-to-return
   flow). The period's set-off is credit first over what it owes BEFORE its own payments: the named payments already inside the span.end balance are added back (gstBalances
   addBack); the cash paid above what the set-off leaves payable is an advance asset (engines tax_advance), never input credit. The figures a close used ride on its own entry
   (tax_close, b854) so a replay answers them and compares carried totals, never re-solves. */
const minorMap = (map, heads, suffix) => heads.reduce((out, head) => Object.assign(out, { [head + suffix]: map[head] || 0 }), {});
/** the payments that NAME this tax period, read once → { ok, output: { head: minor }, rcm: { head: minor }, inSpan: { output, rcm } (dated up to span.end, already in its balance), entries: [entry_id oldest-created first], lastDate }
 *  or { ok: false, note } when they cannot be read (carrier column not applied, a payment with no period, another currency) — the close still posts, never guesses. opt.legacy: also refuse on payments of no period */
async function namedPayments(handle, entity, shop, pack, span, opt) {
  const ready = await S.taxColumnsReady();
  if (!ready.period) return { ok: false, note: 'Payments are not matched to tax periods yet (the books have not been given the period carrier).' };
  if (opt && opt.legacy) {
    const loose = await S.taxPaymentsWithoutPeriod(handle, entity, span.start);
    if (loose > 0) return { ok: false, note: loose + ' earlier tax payment' + (loose > 1 ? 's carry' : ' carries') + ' no tax period, so what was paid for this period is not shown; name the period on each payment.' };
  }
  const roleOf = {};
  headsOf(pack).forEach((x) => {
    roleOf[x.output] = { head: x.head, kind: 'output' };
    if (x.rcm) roleOf[x.rcm] = { head: x.head, kind: 'rcm' };
  });
  const rows = await S.taxPaymentsNaming(handle, entity, span.key, Object.keys(roleOf)),
    currency = B.curOf(shop);
  if (rows.some((row) => row.currency !== currency)) return { ok: false, note: 'A payment for this period is in another currency than these books (' + currency + '), so what was paid is not added up.' };
  const out = { ok: true, output: {}, rcm: {}, inSpan: { output: {}, rcm: {} }, entries: [], lastDate: null };
  rows.forEach((row) => {
    const where = roleOf[row.role];
    out[where.kind][where.head] = (out[where.kind][where.head] || 0) + row.dr_minor;
    if (row.posting_date <= span.end) out.inSpan[where.kind][where.head] = (out.inSpan[where.kind][where.head] || 0) + row.dr_minor;
    if (out.entries.indexOf(row.entry_id) < 0) out.entries.push(row.entry_id);
    if (!out.lastDate || row.posting_date > out.lastDate) out.lastDate = row.posting_date;
  });
  return out;
}
/** what was paid for the period against what it owes → the answer keys: paid · still to pay · excess (forward-charge heads), reverse charge still owed joins the still-to-pay total */
function paidFigures(pack, out, named) {
  const heads = headsOf(pack).map((x) => x.head),
    paid = {},
    still = {},
    excess = {};
  let stillTotal = 0;
  heads.forEach((head) => {
    const owed = out.payable_minor[head + '_minor'] || 0,
      got = named.output[head] || 0;
    if (got) paid[head + '_minor'] = got;
    still[head + '_minor'] = Math.max(0, owed - got);
    excess[head + '_minor'] = Math.max(0, got - owed);
    stillTotal += still[head + '_minor'];
  });
  rcmHeadsOf(pack).forEach((head) => {
    stillTotal += Math.max(0, ((out.rcm_minor || {})[head] || 0) - (named.rcm[head] || 0));
  });
  return { paid_before_close_minor: paid, still_to_pay_minor: still, still_to_pay_total_minor: stillTotal, excess_paid_minor: excess };
}
/** ⭐ the ONE close calculation (read only): the set-off on the period's own base, the payments named for it, what is still to pay — gstClose posts from it, the Todo reads it */
async function closeFigures(handle, entity, shop, pack, span, opt) {
  const currency = B.curOf(shop),
    named = await namedPayments(handle, entity, shop, pack, span, { legacy: !(opt && opt.closed) });
  const balances = await gstBalances(handle, entity, span.end, null, pack, { addBack: named.ok ? named.inSpan : null });
  const setOff = setOffOf(pack, shop, balances, span.ref, span.end, span.fields.period, currency);
  if (!setOff.ok) throw refuse(setOff.why);
  refuseUnnettedRcm(pack, setOff, balances, currency);
  const out = closeAnswer(pack, setOff, balances, span, currency);
  if (named.ok) Object.assign(out, paidFigures(pack, out, named));
  else out.paid_note = named.note;
  return { named, balances, setOff, out };
}
/** a closed period's answer from the figures its own entry carried: stored · less the payments named for it that were created AFTER the close (paid_since_close) → the answer, or null for a
 *  close made before b854 / before the figures were carried (never backfilled, never re-derived) */
async function carriedClose(handle, entity, shop, pack, span, seen) {
  const ready = await S.taxColumnsReady();
  const row = await S.taxCloseOf(handle, entity, seen.source_ref || 'gstclose:' + span.key, ready.close);
  if (!row || !row.tax_close || !row.tax_close.answer) return null;
  const stored = row.tax_close,
    answer = JSON.parse(JSON.stringify(stored.answer)),
    heads = headsOf(pack).map((x) => x.head);
  const live = await namedPayments(handle, entity, shop, pack, span, { legacy: false });
  if (!live.ok) return Object.assign(answer, { paid_note: live.note });
  const carried = new Set(stored.paid_entries || []),
    rows = await S.taxPaymentsNaming(handle, entity, span.key, headsOf(pack).map((x) => x.output).concat(rcmHeadsOf(pack).map((h) => headsOf(pack).find((x) => x.head === h).rcm)));
  const since = {},
    sinceRcm = {};
  rows.filter((r) => !carried.has(r.entry_id)).forEach((r) => {
    const x = headsOf(pack).find((y) => y.output === r.role || y.rcm === r.role),
      bucket = x.output === r.role ? since : sinceRcm;
    bucket[x.head] = (bucket[x.head] || 0) + r.dr_minor;
  });
  if (Object.keys(since).length || Object.keys(sinceRcm).length) {
    answer.paid_since_close_minor = minorMap(since, heads, '_minor');
    let total = 0;
    heads.forEach((head) => {
      answer.still_to_pay_minor[head + '_minor'] = Math.max(0, (answer.still_to_pay_minor[head + '_minor'] || 0) - (since[head] || 0));
      total += answer.still_to_pay_minor[head + '_minor'];
    });
    rcmHeadsOf(pack).forEach((head) => {
      total += Math.max(0, ((answer.rcm_minor || {})[head] || 0) - (named0(stored, head) + (sinceRcm[head] || 0)));
    });
    answer.still_to_pay_total_minor = total;
  }
  const gone = (stored.paid_entries || []).filter((id) => live.entries.indexOf(id) < 0);
  if (gone.length) {
    answer.paid_note = 'A payment counted when this period was closed has been reversed since. The close figures stand as they were; the tax is owed again in the books.';
    require('./logger').warn('tax_close.mismatch', { entity_id: entity, close: span.key, reversed_entries: gone });
  }
  return Object.assign(answer, { ok: true, duplicate: true, entry_id: row.entry_id, entry_no: row.entry_no });
}
const named0 = (stored, head) => ((stored.paid_rcm || {})[head]) || 0;
/** what a tax period still owes after the payments named for it — read only, for a screen (books-todo): a closed period from its own carried figures less what was paid since; an open
 *  one from the close's own calculation (named payments, never dates). → { still_minor, closed } | null when the payments cannot be read (the caller keeps what it had) */
async function gstStillOwed(handle, entity, shop, span) {
  const pack = B.packOf(shop),
    seen = await S.entryBySource(handle, entity, 'gstclose:' + span.key);
  if (seen) {
    const answer = await carriedClose(handle, entity, shop, pack, span, seen);
    return answer && answer.still_to_pay_total_minor != null ? { still_minor: answer.still_to_pay_total_minor, closed: true } : null;
  }
  const figures = await closeFigures(handle, entity, shop, pack, span, { closed: await closedBefore(handle, entity, shop, span) });
  return figures.out.still_to_pay_total_minor != null ? { still_minor: figures.out.still_to_pay_total_minor, closed: false } : null;
}
/** POST /gst/close { fy, period } (IN) · { period, frequency? | stagger? } (a pack with a return) → the head balances → the pack's set-off → the set-off entry; then what is left to pay; the months lock (M1) */
async function gstClose(entity, shop, body, by) {
  const pack = B.packOf(shop),
    currency = B.curOf(shop),
    span = closeSpan(shop, body, pack);
  const source_ref = 'gstclose:' + span.key,
    narration = ((pack.messages || {}).setOffNarration || 'Tax set-off') + ' ' + span.label;
  return withEntity(entity, async (handle) => {
    await lockTaxHeads(handle, entity, headsOf(pack).map((x) => x.head)); /* ACC-275: the same key a tax payment takes — set-off lowers the output tax a payment is checked against */
    if (span.end > today(shop)) throw refuse(span.label + ' ends on ' + span.end + ' — close it once it has ended.', 'PERIOD_NOT_ENDED');
    const seen = await S.entryBySource(handle, entity, source_ref);
    const closed =
      !!seen ||
      (await closedBefore(handle, entity, shop, span)); /* M1: a period already closed is locked by its own close — the double tap still answers the figures */
    if (!closed) await mustBeOpen(handle, entity, shop, span.end);
    if (seen) {
      const carried = await carriedClose(handle, entity, shop, pack, span, seen); /* the figures this close carried, never re-solved */
      if (carried) return carried;
    }
    const { named, setOff, out } = await closeFigures(handle, entity, shop, pack, span, { closed });
    if (seen) ['paid_before_close_minor', 'still_to_pay_minor', 'still_to_pay_total_minor', 'excess_paid_minor'].forEach((key) => delete out[key]); /* a close made before the figures were carried: nothing is invented for it */
    if (seen) return Object.assign(out, { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no, paid_note: 'This period was closed before its figures were carried, so what was paid for it is not shown.' });
    if (closed) return Object.assign(out, { ok: true, duplicate: true, nothing_to_set_off: true });
    const heads = headsOf(pack),
      surplus = {};
    let holdable = true;
    if (named.ok)
      heads.forEach((x) => {
        const extra = out.excess_paid_minor[x.head + '_minor'] || 0;
        if (extra > 0) {
          surplus[x.head] = toRupees(extra, currency);
          if (!x.advance) holdable = false;
        }
      });
    const hasSurplus = Object.keys(surplus).length > 0 && holdable;
    if (Object.keys(surplus).length && !holdable) out.paid_note = 'Tax was paid above what this period owes; this country does not hold it in its own account yet, so it is shown here and not posted.';
    const carry = Object.assign({}, { v: 1, currency, paid_entries: named.ok ? named.entries : [], paid_rcm: named.ok ? named.rcm : {}, answer: JSON.parse(JSON.stringify(out)) });
    const posted = setOff.utilised.length
      ? await postOwn(handle, entity, Object.assign({}, setOff.event, { narration, source_ref, tax_close: carry }), by, true)
      : { ok: true, nothing_to_set_off: true };
    if (!posted.ok) return Object.assign(out, posted);
    if (hasSurplus) {
      /* the cash paid above the net due is held in the head's own advance asset (engines tax_advance): dated the later of the period's end and the last payment named for it, so the books
         show it where the money moved (a 20 Oct payment: 31 Oct; a 9 Nov one: 9 Nov). Not open → the whole close fails in words and nothing is posted. */
      const when = named.lastDate && named.lastDate > span.end ? named.lastDate : span.end;
      const advance = await postOwn(
        handle,
        entity,
        {
          type: 'tax_advance',
          heads: surplus,
          date: when,
          currency,
          ref: span.ref + '-ADV',
          narration: 'Tax paid in advance ' + span.label,
          source_ref: setOff.utilised.length ? source_ref + ':advance' : source_ref,
          tax_close: setOff.utilised.length ? undefined : carry
        },
        by,
        true
      );
      if (!advance.ok) throw refuse('The tax paid above what this period owes could not be held in its own account: ' + (advance.why || 'the books refused it') + '. Nothing was closed.');
      Object.assign(out, { surplus_entry_no: advance.entry_no });
      if (!setOff.utilised.length) Object.assign(posted, { entry_id: advance.entry_id, entry_no: advance.entry_no, nothing_to_set_off: undefined });
    }
    return Object.assign(out, posted, { locked: await lockCovered(handle, entity, shop, span, by) });
  });
}
/** the amounts typed per head → { heads (major, the engine's), minor } — a slip below nothing or a fraction of a minor unit is a plain question */
function headAmounts(body, heads, currency, what) {
  const typed = body && typeof body === 'object' ? body : {},
    major = {},
    minor = {};
  heads.forEach((item) => {
    const amount = typed[item + '_minor'] != null ? Number(typed[item + '_minor']) : typed[item] != null ? toMinor(typed[item], currency) : 0;
    if (!Number.isInteger(amount) || amount < 0) throw ask('The ' + what + item.toUpperCase() + ' amount must be a plain amount, not below nothing.');
    if (amount) {
      minor[item] = amount;
      major[item] = toRupees(amount, currency);
    }
  });
  return { heads: major, minor };
}
/** a slip of the finger (100x) is caught against what is owed — read from the books, never typed */
async function refuseOverpay(handle, entity, shop, pack, date, minor, rcmMinor, currency) {
  const balances = await gstBalances(handle, entity, settledAsOf(shop, date), null, pack);
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
/** ACC-275: one lock per tax head of this shop (key gst|<head>, taken in ONE sorted call): a payment and a close of the same head — or two payments — read the head's balance one at a time */
const lockTaxHeads = (handle, entity, heads) => S.lockTaxHeads(handle, entity, heads);
/** a payment that disagrees with the one already stored under its challan is a conflict, never a replay (409 BOOKS_CONFLICT) */
const payConflict = (reason) => Object.assign(new Error(reason), { code: 'BOOKS_CONFLICT', status: 409 });
const minorWords = (minor, currency) =>
  Object.keys(minor)
    .sort()
    .map((head) => head.toUpperCase() + ' ' + toRupees(minor[head], currency))
    .join(', ') || 'nothing';
/** the stored payment as { paid, rcm } by head — the debits of its own entry per ledger role (carried, not recomputed); another currency on the row refuses */
async function storedPayment(handle, entity, seen, pack, currency) {
  const rows = await S.entryDebitsByRole(handle, entity, seen.entry_id),
    stored = { paid: {}, rcm: {} };
  if (rows.some((row) => row.currency !== currency)) throw payConflict('That challan was recorded in another currency than this shop keeps its books in.');
  headsOf(pack).forEach((x) => {
    const output = rows.find((row) => row.role === x.output),
      reverseCharge = x.rcm && rows.find((row) => row.role === x.rcm);
    if (output) stored.paid[x.head] = output.dr_minor;
    if (reverseCharge) stored.rcm[x.head] = reverseCharge.dr_minor;
  });
  return stored;
}
const sameMinor = (left, right) => Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((head) => left[head] === right[head]);
/** ACC-275: the challan is already posted → answer the STORED row (never the typed figures), or refuse a different amount or head; checked BEFORE any balance read */
async function replayedPay(handle, entity, ctx) {
  const stored = await storedPayment(handle, entity, ctx.seen, ctx.pack, ctx.currency);
  if (!sameMinor(stored.paid, ctx.paid) || !sameMinor(stored.rcm, ctx.rcm))
    throw payConflict(
      'Challan ' + ctx.ref + ' was already recorded for ' + minorWords(stored.paid, ctx.currency) + (Object.keys(stored.rcm).length ? ' and reverse charge ' + minorWords(stored.rcm, ctx.currency) : '') +
        ' — not ' + minorWords(ctx.paid, ctx.currency) + (Object.keys(ctx.rcm).length ? ' and reverse charge ' + minorWords(ctx.rcm, ctx.currency) : '') + '. Use a new challan number for a further payment.'
    );
  const out = Object.assign(ctx.form ? { payment_ref: ctx.ref } : { challan_no: ctx.ref, payment_ref: ctx.ref }, { paid_minor: stored.paid });
  return Object.assign(out, Object.keys(stored.rcm).length ? { rcm_paid_minor: stored.rcm } : {}, {
    ok: true,
    duplicate: true,
    replayed: true,
    entry_id: ctx.seen.entry_id,
    entry_no: ctx.seen.entry_no,
    posting_date: ctx.seen.posting_date
  });
}
/** POST /gst/pay { fy, period | period, amounts: { <head>_minor … }, rcm?, bank, challan_no | payment_ref, date? } → the engine's tax payment (Dr output tax per head · Cr the bank) */
async function gstPay(entity, shop, body, by) {
  const pack = B.packOf(shop),
    currency = B.curOf(shop),
    words = payWords(pack),
    span = closeSpan(shop, body, pack);
  const ref = String(body.challan_no || body.payment_ref || '')
    .trim()
    .slice(0, 40);
  if (!ref) throw ask(words.ask);
  const mode = String(body.bank || body.mode || 'bank');
  if (MODES.indexOf(mode) < 0) throw ask('Paid from where? bank, upi, cash or card.');
  const date = dateOf(body, 'date', today(shop)); /* M1: the challan is dated the day it is paid — the period's own months are locked by its close */
  const paid = headAmounts(
    body.amounts,
    headsOf(pack).map((x) => x.head),
    currency,
    ''
  );
  const rcmPaid = headAmounts(
    body.rcm,
    rcmHeadsOf(pack),
    currency,
    'reverse-charge '
  ); /* reverse-charge liability paid by the same payment → Dr the rcm ledger · Cr the bank */
  if (!Object.keys(paid.heads).length && !Object.keys(rcmPaid.heads).length) throw ask('How much was paid? Give the amount for at least one tax.');
  return withEntity(entity, async (handle) => {
    await lockTaxHeads(handle, entity, Object.keys(paid.minor).concat(Object.keys(rcmPaid.minor))); /* ACC-275: before ANY read, so a pay racing a close or another pay waits */
    await mustBeOpen(handle, entity, shop, date);
    const source_ref = 'gstpay:' + ref;
    const seen = await S.entryBySource(handle, entity, source_ref);
    if (seen) return replayedPay(handle, entity, { seen, pack, currency, paid: paid.minor, rcm: rcmPaid.minor, ref, form: span.form });
    await refuseOverpay(handle, entity, shop, pack, date, paid.minor, rcmPaid.minor, currency);
    const posted = await postOwn(
      handle,
      entity,
      {
        type: eventNameOf(pack, 'tax_payment'),
        mode,
        heads: paid.heads,
        rcm: Object.keys(rcmPaid.heads).length ? rcmPaid.heads : undefined,
        date,
        currency: currency,
        ref,
        narration: words.narration + ' ' + ref,
        source_ref,
        tax_period: span.key /* ACC-336: the period this payment names (b849), never read from its date */
      },
      by
    );
    const out = Object.assign(span.form ? { payment_ref: ref } : { challan_no: ref, payment_ref: ref }, { paid_minor: paid.minor });
    return Object.assign(out, Object.keys(rcmPaid.minor).length ? { rcm_paid_minor: rcmPaid.minor } : {}, posted);
  });
}

/* ═══ 5. loans ════════════════════════════════════════════════════════════════════════════════════════════════════ */
const LOAN_ROLE = { secured: 'secured_loan', unsecured: 'unsecured_loan', overdraft: 'bank_od' };
const LOAN_ROLES = Object.keys(LOAN_ROLE).map((item) => LOAN_ROLE[item]);
/** the loan's yearly interest rate as typed: none → null, else a percentage from 0 to 100, else a plain question */
function loanRate(body) {
  if (body.rate == null || body.rate === '') return null;
  const rate = Number(body.rate);
  if (!(rate >= 0 && rate <= 100)) throw ask('The interest rate is a percentage a year, between 0 and 100.');
  return rate;
}
/** POST /loans { ref|client_ref, lender, amount, into, rate?, kind? } — a loan TAKEN: Dr where the money came in · Cr the loan account */
async function takeLoan(entity, shop, body, by) {
  const currency = B.curOf(shop);
  const ref = String(body.ref || body.client_ref || '')
    .trim()
    .slice(0, 60);
  if (!ref) throw ask('Give the loan a reference you will know it by (the sanction letter or loan number).');
  const lender = String(body.lender || '')
    .trim()
    .slice(0, 120);
  if (!lender) throw ask('Who is the lender?');
  const amount = amountOf(body, 'amount', currency, { ask: 'How much was the loan?' });
  const into = String(body.into || body.bank || 'bank');
  if (MODES.indexOf(into) < 0) throw ask('Where did the money come in? bank, upi, cash or card.');
  const kind = body.kind == null ? 'secured' : String(body.kind);
  if (!LOAN_ROLE[kind]) throw ask('Is it secured, unsecured or an overdraft?');
  const rate = loanRate(body);
  const date = dateOf(body, 'date', today(shop));
  return postOwn(
    null,
    entity,
    {
      type: 'loan_taken',
      loan: LOAN_ROLE[kind],
      into,
      amount: toRupees(amount, currency),
      date,
      currency: currency,
      ref,
      narration: 'Loan from ' + lender + (rate != null ? ' at ' + rate + '% a year' : ''),
      source_ref: 'loan:' + ref
    },
    by
  );
}
/** POST /loans/:ref/emi { principal, interest, from?, date, client_ref } — the bank's split AS GIVEN: Dr the loan · Dr interest · Cr the bank */
async function loanEmi(entity, shop, ref, body, by) {
  const currency = B.curOf(shop);
  const cref = refOf(body);
  if (!cref) throw ask("Give this instalment a reference (the month, or the bank's number) so a second tap does not record it twice.");
  const principal = amountOf(body, 'principal', currency, { optional: true, zero: true }) || 0;
  const interest = amountOf(body, 'interest', currency, { optional: true, zero: true }) || 0;
  if (!principal && !interest) throw ask('How much of the instalment was the loan and how much interest? Give the split from the bank.');
  const from = String(body.from || body.bank || 'bank');
  if (MODES.indexOf(from) < 0) throw ask('Paid from where? bank, upi, cash or card.');
  const date = dateOf(body, 'date', today(shop));
  return withEntity(entity, async (handle) => {
    const loan = await S.entryBySource(handle, entity, 'loan:' + ref);
    if (!loan) {
      const e = new Error('No loan with that reference.');
      e.code = 'BOOKS_NOT_FOUND';
      throw e;
    }
    const full = await S.entry(handle, entity, loan.entry_id),
      chart = await S.accounts(handle, entity);
    const acct = (full.lines || [])
      .map((item) => chart.find((account) => String(account.account_id) === String(item.account_id)))
      .find((item) => item && LOAN_ROLES.indexOf(item.role) >= 0);
    if (!acct) throw refuse('That entry is not a loan.');
    return postOwn(
      handle,
      entity,
      {
        type: 'loan_repaid',
        loan: acct.role,
        principal: toRupees(principal, currency),
        interest: toRupees(interest, currency),
        from,
        date,
        currency: currency,
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
function reversalDate(shop, date) {
  const pack = B.packOf(shop),
    packs = E.packs(),
    fiscalYear = packs.fiscalYearOf(date, pack),
    periodNo = packs.periodOf(date, pack);
  return B.addDays(packs.periodRange(fiscalYear, periodNo, pack).end, 1);
}
/** POST /accruals { ref|client_ref, kind, class, amount, date } — at a period end; it comes back on the first day of the next period (reverses_on) */
async function accrue(entity, shop, body, by) {
  const currency = B.curOf(shop);
  const ref = String(body.ref || body.client_ref || '')
    .trim()
    .slice(0, 60);
  if (!ref) throw ask('Give the accrual a reference (e.g. ELEC-2026-09).');
  const kind = String(body.kind || '');
  if (ACCRUALS.indexOf(kind) < 0) throw ask('Is it an outstanding expense, a prepaid expense, income accrued, or income received in advance?');
  const ledgerClass = String(body.class || '').trim();
  if (!ledgerClass) throw ask('Which expense or income ledger is it for?');
  const amount = amountOf(body, 'amount', currency, { ask: 'How much?' });
  const date = dateOf(body, 'date', today(shop));
  const posted = await postOwn(
    null,
    entity,
    {
      type: 'accrual',
      kind,
      class: ledgerClass,
      amount: toRupees(amount, currency),
      date,
      currency: currency,
      ref,
      narration:
        String(body.narration || '')
          .trim()
          .slice(0, 200) || 'Accrual ' + ref,
      source_ref: 'accrual:' + ref
    },
    by
  );
  return Object.assign({ ref, kind, reverses_on: reversalDate(shop, date) }, posted);
}
/** POST /accruals/:ref/reverse { date?, client_ref? } — the engine's own reversal (reverse: true, reverses: ref); due from the first day of the next period */
async function reverseAccrual(entity, shop, ref, body, by) {
  const currency = B.curOf(shop);
  return withEntity(entity, async (handle) => {
    const head = await S.entryBySource(handle, entity, 'accrual:' + ref);
    if (!head) {
      const e = new Error('No accrual with that reference.');
      e.code = 'BOOKS_NOT_FOUND';
      throw e;
    }
    const full = await S.entry(handle, entity, head.entry_id),
      chart = await S.accounts(handle, entity);
    const lines = (full.lines || []).map((item) =>
      Object.assign({}, item, { acct: chart.find((account) => String(account.account_id) === String(item.account_id)) || {} })
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
    const dueOn = reversalDate(shop, E.ymd(full.posting_date));
    const date = dateOf(body, 'date', dueOn);
    if (date < dueOn) throw refuse('This accrual turns back on ' + dueOn + ', the first day of the next month — not before.');
    if (date > today(shop)) throw refuse('This accrual turns back on ' + date + ' — it is not due yet.');
    return postOwn(
      handle,
      entity,
      {
        type: 'accrual',
        kind,
        class: other.acct.code,
        amount: toRupees(full.total_minor, currency),
        date,
        currency: currency,
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
function contraEvent(shop, body) {
  const currency = B.curOf(shop);
  const from = String(body.from || '').trim(),
    to = String(body.to || '').trim();
  if (!from || !to) throw ask('Moved from where, to where? cash, bank, upi or card.');
  const amount = amountOf(body, 'amount', currency, { ask: 'How much was moved?' });
  const date = dateOf(body, 'date', today(shop));
  const ref = refOf(body);
  return {
    type: 'contra',
    from,
    to,
    amount: toRupees(amount, currency),
    date,
    currency: currency,
    narration:
      String(body.narration || '')
        .trim()
        .slice(0, 200) || 'Moved from ' + from + ' to ' + to,
    source_ref: ref ? 'contra:' + ref : null
  };
}
async function contra(entity, shop, body, by) {
  return postOwn(null, entity, contraEvent(shop, body), by);
}

/* ═══ THE SHOP'S OWN RETURN (BAS1, engines v1.39.0) — BAS (AU) · VAT201 (AE): a READ of the posted books, dispatched to the pack by gst-returns.returnFor ═══
   Nothing is recomputed here: the period's movements are the account_balance rows the writer already keeps (one per account per month), summed by code and
   handed to the engine by ROLE; the engine's `roles` on each box are joined back to the shop's chart so every figure opens the ledgers it counts.
   India is refused by name — its GSTR-1 / 3B are read from the frozen invoices on the rail (routes/tax.js GET /api/tax/gstr), not from the ledgers. */
const gstReturns = () => require('./gst-returns');
const PREPARED = 'Prepared, not lodged';
const nextMonth = (isoDay) => {
  const y = Number(isoDay.slice(0, 4)),
    month = Number(isoDay.slice(5, 7));
  return (month === 12 ? y + 1 : y) + '-' + String(month === 12 ? 1 : month + 1).padStart(2, '0') + '-01';
};
/** the pack's period table (gst-returns.periodsFor), for the year that holds `day` and the one before — AU by financial year, AE by the FTA stagger (never guessed) */
function returnPeriods(pack, query, onDay) {
  const packs = E.packs(),
    returnsDef = pack.returns || {};
  if (returnsDef.id === 'BAS') {
    const fiscalYear = packs.fiscalYearOf(onDay, pack),
      prev = packs.fiscalYearOf(B.addDays(packs.fyRange(fiscalYear, pack).start, -1), pack),
      frequency = query.frequency === 'monthly' ? 'monthly' : 'quarterly',
      out = [];
    for (const y of [prev, fiscalYear]) {
      const table = gstReturns().periodsFor(pack, { fy: y, frequency });
      if (!table.ok) throw refuse(table.why);
      out.push(...table.periods);
    }
    return { periods: out, asked: { frequency } };
  }
  if (returnsDef.id === 'VAT201') {
    const stagger = query.stagger == null || query.stagger === '' ? null : String(query.stagger).toLowerCase(),
      year = Number(onDay.slice(0, 4)),
      out = [];
    if (!stagger) {
      const none = gstReturns().periodsFor(pack, { year });
      return { periods: [], asked: { stagger: null }, needs: 'stagger', why: none.why };
    }
    for (const y of [year - 1, year]) {
      const table = gstReturns().periodsFor(pack, { stagger, year: y });
      if (!table.ok) throw refuse(table.why);
      out.push(...table.periods);
    }
    return { periods: out, asked: { stagger: /^\d$/.test(stagger) ? Number(stagger) : stagger } };
  }
  return ownPeriods(pack, onDay);
}
/** R5: any other pack that names its periods (a new country's returns.periods reads { year }) — the year before and this one; none → no periods */
function ownPeriods(pack, onDay) {
  if (typeof (pack.returns || {}).periods !== 'function') return { periods: [], asked: {} };
  const year = Number(onDay.slice(0, 4)),
    periods = [];
  for (const y of [year - 1, year]) {
    const table = gstReturns().periodsFor(pack, { year: y });
    if (!table.ok) throw refuse(table.why);
    periods.push(...table.periods);
  }
  return { periods, asked: {} };
}
/** the period's ledger MOVEMENTS by account — the monthly balance rows (party-less grain) of every month from `start` to `end`, summed by code; roles from the chart */
async function movementsBetween(handle, entity, ctx, start, end) {
  const packs = E.packs(),
    months = [],
    byCode = Object.create(null);
  for (let d = start.slice(0, 7) + '-01'; d <= end; d = nextMonth(d)) months.push({ fy: packs.fiscalYearOf(d, ctx.pack), period: Number(packs.periodOf(d, ctx.pack)) });
  for (const fiscalYear of Array.from(new Set(months.map((item) => item.fy)))) {
    if (ctx.years.length && ctx.years.indexOf(fiscalYear) < 0) continue; /* a year with no rows at all: nothing moved */
    (await S.yearRows(handle, entity, fiscalYear))
      .map((item) => E.balanceOf(item, S.ZERO))
      .forEach((item) => {
        if (item.party || !months.some((month) => month.fy === fiscalYear && month.period === Number(item.period)))
          return; /* the account grain only — the party rows are the same money again */
        const totals = byCode[item.code] || (byCode[item.code] = { dr: 0, cr: 0 });
        totals.dr += Number(item.dr_minor);
        totals.cr += Number(item.cr_minor);
      });
  }
  /* W2-BOOKS: the period's own set-off and statutory payment entries move the tax ledgers but are not sales or purchases — the form's boxes leave them out
     (1A is the GST on sales, not what was left after the set-off). One trip; the entries are counted so the return can say so. */
  const settled = await S.taxEntryLines(handle, entity, start, end, taxEventNames(ctx.pack));
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
      const account = ctx.chart.find((x) => String(x.code) === code) || {};
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
/** P1-7 CTRY-87: what the BAS is READ on, said first among its notes: GST is accounted for in the period of the invoice or the payment, whichever comes first (ATO non-cash basis); a cash-basis BAS (GST Act s.29-5) is not built, and a per-shop basis waits for the accountant */
const BAS_BASIS_NOTE = 'Basis: non-cash (accrual): GST in the period of the invoice or the payment, whichever comes first';
/** the return's notes: the basis line for a BAS, then the engine's, then the one about the entries left out */
const notesOf = (answer, movements, formId) =>
  (formId === 'BAS' ? [BAS_BASIS_NOTE] : []).concat(answer.notes || [], settledNoteOf(movements));
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
/** the answer for a period table that cannot be built yet (AE until the FTA stagger is given): the empty form, nothing guessed */
function needsAnswer(periodTable, periods, returnsDef) {
  return {
    asked: periodTable.asked,
    needs: periodTable.needs,
    why: periodTable.why,
    periods,
    period: null,
    boxes: [],
    payable_minor: 0,
    refund_minor: 0,
    net_minor: 0,
    notes: [],
    cite: null,
    emirates: returnsDef.emirates || [],
    staggers: returnsDef.staggers || {}
  };
}
/** the period a return is read for: the one named, else the one holding `on`, else the latest that has ended, else the first */
function choosePeriod(periods, query, on) {
  const want = String((query && query.period) || '');
  return (
    periods.find((item) => item.period === want) ||
    (on ? periods.find((item) => item.start <= on && on <= item.end) : null) ||
    periods.filter((item) => item.ended).pop() ||
    periods[0]
  );
}
/** the form's own options from the query: BAS simpler (default on), VAT201 emirate */
function returnOptions(returnsDef, query) {
  const opts = {};
  if (returnsDef.id === 'BAS') opts.simpler = !(query && (query.simpler === '0' || query.simpler === 'false' || query.simpler === false));
  if (returnsDef.id === 'VAT201') opts.emirate = query && query.emirate ? String(query.emirate) : null;
  return opts;
}
/** the form's boxes, each with the ledgers it counts: the box's ROLES in the form's order (the amount ledgers, then the tax ledger), each once */
function boxesOf(chart, filedBoxes) {
  const accountsOf = (roles) =>
    roles.reduce(
      (nestedOut, role) => nestedOut.concat(chart.filter((item) => !item.is_group && item.role === role).map((item) => ({ code: String(item.code), name: item.name }))),
      []
    );
  return filedBoxes.map((item) => ({
    code: item.code,
    label: item.label,
    amount_minor: item.amount_minor,
    tax_minor: item.tax_minor,
    roles: item.roles,
    accounts: accountsOf(item.roles),
    note: item.note
  }));
}
/* PR1 (2026-10-13), additive: `q.on` (YYYY-MM-DD) asks for the period that CONTAINS that day (the parallel-run compare holds a snapshot's period end), and `h0` runs
   the read inside the caller's own transaction (the compare reads its statements and this return in one) — without either, unchanged */
async function taxReturn(entity, shop, query, callerHandle) {
  const currency = B.curOf(shop),
    pack0 = B.packOf(shop),
    on = query && /^\d{4}-\d{2}-\d{2}$/.test(String(query.on || '')) ? String(query.on) : null,
    asOfDay = on || today(shop);
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
  const readReturn = async (handle) => {
    const ctx = await B.ledgerCtx(handle, entity),
      pack = ctx.pack,
      returnsDef = pack.returns;
    const base = { currency: currency, pack: pack.id, form: returnsDef.id, name: returnsDef.name, short: returnsDef.short, authority: returnsDef.authority, portal: returnsDef.portal, prepared: PREPARED };
    const periodTable = returnPeriods(pack, query || {}, asOfDay);
    const periods = periodTable.periods.map((item) => Object.assign({}, item, { ended: item.end <= today(shop) }));
    if (periodTable.needs) return Object.assign(base, needsAnswer(periodTable, periods, returnsDef));
    const period = choosePeriod(periods, query, on);
    if (!period) throw refuse('No ' + returnsDef.short + ' period is known for ' + asOfDay + '.');
    const movements = await movementsBetween(handle, entity, ctx, period.start, period.end);
    const opts = returnOptions(returnsDef, query);
    const filed = gstReturns().returnFor(
      pack,
      period.period,
      movements.rows.filter((item) => item.role),
      opts
    );
    if (!filed.ok) throw refuse(filed.why);
    const boxes = boxesOf(ctx.chart, filed.boxes);
    const out = Object.assign(base, {
      asked: Object.assign({}, periodTable.asked, returnsDef.id === 'BAS' ? { simpler: opts.simpler } : { emirate: opts.emirate }),
      periods,
      period,
      boxes,
      payable_minor: filed.payable_minor,
      refund_minor: filed.refund_minor,
      net_minor: filed.net_minor,
      notes: notesOf(filed, movements, returnsDef.id),
      cite: filed.cite
    });
    if (returnsDef.id === 'VAT201') {
      out.emirates = returnsDef.emirates || [];
      out.staggers = returnsDef.staggers || {};
    } /* the pack's own tables for the pickers: the seven Emirates, the four FTA staggers */
    return out;
  };
  return callerHandle ? readReturn(callerHandle) : withEntity(entity, readReturn);
}

module.exports = {
  amountOf,
  dateOf,
  dateGiven,
  monthGiven,
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
  gstStillOwed,
  closeSpan,
  closeFigures,
  balancesOf,
  gstPayableAt,
  taxReturn
};
