// @stage tested
// @stage-note [BOOKS v2] The posting hooks: a saved chit → the event it posts (or nothing), after the commit, never able
// @stage-note to fail the chit. A walk-in bill waits for its counter's day close. What cannot post waits in books_outbox, named.
'use strict';
/**
 * OWNS      the posting hooks (a saved chit → its event), the outbox park, the shop's day (dayOf), and classify's major → minor (toMinor: the api's one, books-cashflow).
 * FLOW      chit saved ──▶ classify (pure) ──▶ postEntry | park in books_outbox, named
 * CALLED BY routes/chits.js (send · receive · pay post their entries), routes/till.js · books.js · governance.js, lib/chit-move (a cancel takes its posting back), lib/books-nightly ·
 *           books-period · books-todo · books-pack · books-manual, lib/books · tax-copy · crm · crm-calls · crm-followups · home-facts ·
 *           shop-clock · capture · forms · finance-terms · network-offers · repeat-supply · dev-otp — mostly for the shop's day (dayOf · dayBounds · zoneOf). Found by `require('./books-hooks')`.
 * CARD 16-finance/books-posting
 * lib/books-hooks.js — ENTRY POINTS INTO THE LEDGER (SPEC-books-v2 §3).
 *
 * ⚠️⚠️⚠️ A POSTING FAILURE NEVER FAILS THE CHIT. The hooks run after the chit's own commit, are never awaited by the
 *   route, and swallow everything — what could not post is written to books_outbox with the reason, and the reason is
 *   what the Ledger screen and GET /api/books/health show ("named on the to-do list"). If even the outbox cannot be
 *   written (tables not created), it is logged, never silent. [[feedback-silence-is-the-bug]]
 * ⭐ OFF COSTS ONE CACHED READ. With the shop's books off, afterChit() returns after a cached look at books_setting
 *   (60 s; 10 min when the table does not exist yet) — the chit path is the hottest in the product.
 * ⚠️⚠️ A READ THAT FAILED IS NOT "OFF" (critic M3): it is never cached, it is logged, and the last known answer stands.
 * ⭐ WHAT THE HOOK MISSED IS SWEPT UP (critic M6): lib/books-nightly finds the chits of the closed days that never reached
 *   the ledger (a deploy between commit and hook, a client retry, a failed read) and posts them through postChit() here.
 *
 * WHAT POSTS (classify(), pure, tests/books-hooks.test.cjs):
 *   counter bill, walk-in (no party, no GSTIN, not on credit)  → waits for the day close (grain 'day'/'shift'),
 *                                                                or its own walk-in entry (grain 'bill')
 *   counter bill to a known party / on credit / with a GSTIN   → sale_bill, per bill
 *   an invoice I send                                          → sale_bill (the other party owes it)
 *   an invoice I receive / a counter bill another shop billed ME → purchase_bill (I owe the seller) — ONLY once I accepted
 *                                                                it on the rail, no dispute open, the seller on my supplier
 *                                                                list (buyerGate; until then it waits on Waiting, named)
 *   a credit note I issue / receive                            → return / purchase_return
 *   an expense / an income chit                                → expense / other_income, by class
 *   a counter's day summary chit                               → the walk-in day entry for that counter and day
 *   the counter's "money received" chit (business_json.payment_received — its own R/… series, NOT a bill)
 *                                                              → a payment, through books.recordPayment; a cheque is HELD
 *                                                                (a status row) until POST /cheques/:id/status clears it
 * A credit bill's business_json.terms.due_date is the bill's due date; credit_override stays on the chit (it posts nothing).
 * ⚠️ Every event carries a real YYYY-MM-DD date and amounts rounded by money.round — a chit without a usable date is
 *   QUEUED with that reason (CBPosting v1.8.1 refuses an undated event; the refusal is named on the to-do, never swallowed).
 *   anything else (orders, inquiries, drafts, general)         → nothing: an order is a promise, not a transaction
 */
const B = require('./books');
const cbLog = require('./logger');
const E = require('./books-engines');
const S = require('./books-store');
const Assets = require('./books-assets');
const billPick = require('./counter-bill'); /* ACC-206 B: the ONE pick of a bill's total (pickOf) — books-hooks reads it, never a field of its own */
const moneyCheck = require('./money-check'); /* ACC-206 B: compare stored copies, raise a support ticket to us when they disagree */

let log = null;
/** the logger, required on first use; if it cannot be loaded, a silent stand-in so a hook never fails on its own logging */
function loggerOf() {
  if (!log) {
    try {
      log = require('./logger');
    } catch (_) {
      log = { info() {}, warn() {} };
    }
  }
  return log;
}
function withEntity(e, fn) {
  return require('../db').withEntity(e, fn);
}

/* ── is this shop's ledger on? cached, because every chit asks ───────────────────────────────────────────────── */
const onCache = new Map();
/**
 * isOn(entity, db?) → the shop's setting when its ledger is on, else null. `db`: a handle the caller already holds (the
 * counter's snapshot reads it inside its own transaction — settingOf keeps to a savepoint, so a failure cannot abort it).
 * ⚠️⚠️ ONLY AN ANSWER IS CACHED (critic M3, 2026-09-30). This used to catch ANY error and cache "off" for ten minutes: one
 *   pool timeout and every chit that shop saved for ten minutes returned { off: true } — nothing queued, nothing logged.
 *   Now: "no" is cached 60 s, "the table is not there" (42P01 → null) ten minutes, and a read that THREW is not cached
 *   at all — it is logged, and the last known answer stands (a shop that was on is still tried; the post parks itself).
 */
async function isOn(entity, db) {
  const cacheKey = String(entity),
    cached = onCache.get(cacheKey),
    now = Date.now(); /* clock-ok: a cache TTL, not a posting date */
  if (cached && cached.until > now) return cached.s;
  let setting;
  try {
    setting = db ? await B.settingOf(db, entity) : await withEntity(entity, (handle) => B.settingOf(handle, entity));
  } catch (e) {
    swallowed('switch_unread');
    loggerOf().warn('books.switch-unread', {
      entity_id: entity,
      error: String(e && e.message).slice(0, 200),
      assumed: cached ? (cached.s ? 'on (last known)' : 'off (last known)') : 'off (never read)'
    });
    return cached ? cached.s : null;
  }
  const enabledSetting = setting && setting.enabled ? setting : null;
  onCache.set(cacheKey, { s: enabledSetting, until: now + (setting === null ? 600000 : 60000) });
  return enabledSetting;
}
/** ACC-266: the three places a posting failure used to be one log line — counted per process (GET /health), so a silent path is visible even when the reconciler heals it */
function swallowed(which) {
  require('./books-reconcile').swallowed(which); /* a counter that cannot throw: it only adds one */
}
function forget(entity) {
  onCache.delete(String(entity));
}
/** tests: the cached answer is now stale (kept as the last known one) — true when there was one */
function _expire(entity) {
  const cached = onCache.get(String(entity));
  if (cached) cached.until = 0;
  return !!cached;
}

/* ═══ classify — pure ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** a tender's words → the mode the posting rules know; 'credit' = not paid now (the party owes it); null = unknown */
function modeOf(tender) {
  const words = String(tender || '')
    .toLowerCase()
    .trim();
  if (!words) return null;
  if (/card|visa|master|rupay|amex|pos\b/.test(words)) return 'card';
  if (/upi|gpay|google ?pay|phone ?pe|paytm|bhim|\bqr\b/.test(words)) return 'upi';
  if (/cheque|check/.test(words)) return 'cheque';
  if (/bank|neft|rtgs|imps|transfer/.test(words)) return 'bank';
  if (/credit|udhaar|udhar|due|on account|later|khata/.test(words)) return 'credit';
  if (/cash/.test(words)) return 'cash';
  return null;
}
/* ⭐ money.round — THE one rounder (half away from zero, the currency's own decimals); never a copy of the rule here */
const MONEY = require('./money');
const roundMoney = (value) => MONEY.round(Number(value) || 0);
/** ACC-200 + ACC-215 (Athi 2026-11-07, HALF step): the gap the pack lets cash take as round-off, in minor units — ceil(step_minor/2)-1 when a part was
    paid in its tender (AU 5c -> 2c: the most nearest-step rounding can make); a bigger gap is a real short/over. None = 0, exact. Derived from the pack, never a typed 2. */
function cashStepMinor(pack, modes) {
  const rounding = pack && pack.cashRounding;
  if (!rounding || !(rounding.step_minor > 0)) return 0;
  return modes[rounding.tender || 'cash'] ? Math.ceil(rounding.step_minor / 2) - 1 : 0;
}
/**
 * ⭐ ACC-200: a counter bill's payments against its tax invoice, compared in minor units (never floats). It posts the gap as the
 * round-off only inside the HALF of the books pack's cash step, ceil(step/2)-1 (ACC-215; reg-in has none: a rounded figure is never posted, so India is exact to the
 * paisa); the invoice's own declared RndOffAmt is its figure, never a gap. Outside it the bill WAITS with the gap named. null = posts.
 */
function paymentGapWait(charged, invoiceTotal, invoice, modes, setting, currency, ref) {
  const declared = toMinor((invoice && invoice.ValDtls && invoice.ValDtls.RndOffAmt) || 0, currency);
  const gapMinor = toMinor(charged, currency) - toMinor(invoiceTotal, currency) - declared;
  if (Math.abs(gapMinor) <= cashStepMinor(booksPack(setting), modes)) return null;
  const moneyWords = (minor) => require('./bill-privacy').money(minor, currency);
  const side = gapMinor < 0 ? 'short by ' : 'over by ';
  const figures = ': paid ' + moneyWords(toMinor(charged, currency)) + ', tax invoice ' + moneyWords(toMinor(invoiceTotal, currency)) + '.';
  const sentence = 'Bill ' + ref + ' is ' + side + moneyWords(Math.abs(gapMinor)) + figures;
  return { kind: 'queue', gap_minor: gapMinor, why: sentence + ' Check the payment, or record the difference by hand.' };
}

/**
 * ⭐ REVERSE CHARGE (CGST s.9(3)/(4); engines v1.20.0): a purchase whose frozen invoice carries RCM lines posts the BUYER's own tax. The tax was
 * computed ONCE by the tax engine when the bill was assessed and frozen on the invoice (Rcm* on the line); this only READS it —
 * tax.moneyOf(inv).rcm.rows — and hands it to the posting engine as `rcm` (Dr input credit or cost · Cr RCM payable 2204–2206; the supplier is
 * credited WITHOUT it). It is paid in cash only at the GST close / pay (routes /gst/close, /gst/pay), never here. Absent → undefined → the event is unchanged.
 */
function rcmOf(invoice, currency) {
  let moneyBlock = null;
  try {
    moneyBlock = require('./tax').moneyOf(invoice, currency || null);
  } /* RCM-POST: the chit's stated money, never INR by name (T2-NATDEF); moneyOf only labels the block with it */ catch (e) {
    cbLog.fellBack('books-hooks rcmOf: the helper failed — carried on without it', e);
    return undefined;
  }
  return moneyBlock && moneyBlock.rcm && Array.isArray(moneyBlock.rcm.rows) && moneyBlock.rcm.rows.length ? moneyBlock.rcm.rows : undefined;
}
/** put the invoice's RCM rows on the FIRST purchase_bill of a bill's events; false when there is none to carry them (own-use only) */
function withRcm(events, invoice, currency) {
  const rows = rcmOf(invoice, currency);
  if (!rows) return true;
  const first = events.find((e) => e.type === 'purchase_bill');
  if (!first) return false;
  first.rcm = rows;
  return true;
}
/** the regulation pack of the country the BOOKS were opened on (as postsHead) — handed to the posting engine's daySummary, which otherwise
    resolves its DEFAULT, India: an Australian day's GST was dropped silently (Findings B5, counter audit 17 Oct). null → the engine's own answer. */
function booksPack(setting) {
  try {
    return require('./regulation').packFor(String((B.packOf(setting) || {}).country || '').toUpperCase()) || null;
  } catch (e) {
    cbLog.fellBack('books-hooks booksPack: the helper failed — the engine resolves its own', e);
    return null;
  }
}
/** does the shop's ledger post this tax head? — the regulation pack of the country its BOOKS were opened on (B.packOf: the accounts pack, which
    falls back to India for a country it does not carry), never the country the shop says it is in */
function postsHead(setting, head) {
  try {
    const regulation = require('./regulation'),
      regPack = regulation.packFor(String((B.packOf(setting) || {}).country || '').toUpperCase());
    return !!(regPack && Array.isArray(regPack.taxHeads) && regPack.taxHeads.indexOf(head) >= 0);
  } catch (e) {
    cbLog.fellBack('books-hooks postsHead: the helper failed — answered no', e);
    return false;
  }
}
/** a line's amounts summed into its row (cess only when there is one, so every other invoice keeps its shape) */
function sumIntoRow_(row, line) {
  const cess = roundMoney((row.cess || 0) + (line.CesAmt || 0));
  if (cess) row.cess = cess;
  row.taxable = roundMoney(row.taxable + (line.AssAmt || 0));
  row.cgst = roundMoney(row.cgst + (line.CgstAmt || 0));
  row.sgst = roundMoney(row.sgst + (line.SgstAmt || 0));
  row.igst = roundMoney(row.igst + (line.IgstAmt || 0));
}
/* ⭐ WX-R2R (2026-10-13): the ONE head of a scheme that does not split (AU GST, a VAT) is the line's TaxAmt, named as lib/tax.moneyOf names it —
   the frozen invoice's _cb.scheme in lower case (`gst`, the AU pack's taxHeads) — so the books post by_rate[rate].gst as they post India's cgst.
   Before this every AU bill (engines v1.34 freezes TaxAmt) was queued as "a non-GST tax" and no AU sale posted. No scheme → `other`, as before. */
/** one invoice line added to its row (rate + supply kind); returns the tax this line carried that is not the scheme's one head */
function addLineToRow_(rows, line, kind, single) {
  const rate = String(line.GstRt == null ? 0 : line.GstRt),
    key = rate + (kind ? '|' + kind : '');
  const row = rows.get(key) || Object.assign({ rate: Number(rate), taxable: 0, cgst: 0, sgst: 0, igst: 0 }, kind ? { kind } : {});
  sumIntoRow_(row, line);
  rows.set(key, row);
  if (single && line.TaxAmt) {
    row[single] = roundMoney((row[single] || 0) + line.TaxAmt);
    return 0;
  } /* absent when nil, like cess */
  return line.TaxAmt || 0;
}
/**
 * the invoice's lines, summed per rate. CESS (v1.16.0, posting 2203/2213) is READ from the frozen invoice's CesAmt per rate — never recomputed
 * (Athi, 2026-10-02: the computation happens once, in billing). `other` is only a non-GST tax (TaxAmt) the rules still cannot carry.
 */
function byRateOf(invoice) {
  const lookup = new Map();
  let other = 0;
  const single = invoice && invoice._cb && invoice._cb.scheme ? String(invoice._cb.scheme).toLowerCase() : null;
  /* A5 (engines v1.64.0): a line that named its supply kind keeps it — two kinds at one rate (AU GST-free and input-taxed, both 0%) are two rows, and
     posting lands each on its own sales ledger (sales_gst_free …), so BAS G3 and VAT201 boxes 4/5 read them; lines with no kind group as before */
  const kindOfLine = {};
  ((invoice && invoice._cb && invoice._cb.kinds) || []).forEach((entry) => {
    kindOfLine[entry.line] = entry.kind;
  });
  ((invoice && invoice.ItemList) || []).forEach((line, index) => {
    other = roundMoney(other + addLineToRow_(lookup, line, kindOfLine[index] || null, single));
  });
  const rows = Array.from(lookup.values());
  const total = roundMoney(rows.reduce((sum, item) => sum + item.taxable + item.cgst + item.sgst + item.igst + (item.cess || 0) + ((single && item[single]) || 0), 0));
  return { rows, total, other };
}
/**
 * ⭐ WHAT A BILL I RECEIVED IS FOR, line by line (lib/bill-use effective(): lines[i] is the invoice's ItemList[i] — the
 * same order, removed lines left out). No `uses` (a caller that did not ask) → everything resale, exactly as before.
 */
function usesSplit(uses, invoice) {
  const items = (invoice && invoice.ItemList) || [],
    out = { resale: [], use: [], asset: [], _cb: invoice && invoice._cb }; /* _cb: the scheme byRateOf names a single head by */
  items.forEach((item, index) => {
    const lineUse = uses && Array.isArray(uses.lines) && uses.lines[index] ? uses.lines[index].use : 'resale';
    (out[lineUse] || out.resale).push(item);
  });
  return out;
}
/**
 * ⭐⭐ A BILL WHOSE GOODS ARE (PARTLY) FOR THE SHOP'S OWN USE (Athi, 2026-10-01) — with the posting engine's own events,
 * never a new one (the adopted engines are not edited):
 *   resale lines → purchase_bill  Dr Purchases + input GST · Cr the supplier       (source chit:<id>)
 *   asset lines  → purchase_bill  accept: 'asset' — Dr the class's PPE cost ledger + input GST · Cr the supplier (chit:<id>:asset when the bill has resale too);
 *                                 only once the asset register exists (b280); postChit then adds the register row
 *   use lines    → expense        Dr <class> (default sundry_expense) + input GST · Cr the supplier
 *                                 (source chit:<id> when it is the whole bill, else chit:<id>:use)
 *   paid at the counter → payment_made per mode, against this bill  Dr the supplier · Cr the mode   (chit:<id>:paid:<mode>)
 * So the supplier's account always shows the whole bill and what was paid on it. The round-off rides the purchase, or the
 * expense when there is no purchase. Every event has its own source, so a retry posts only what has not posted.
 */
function useEvents(copy, base, supplier, split, paid, round_off, dueDate, setting, asset) {
  const id = copy.chit_id,
    events = [],
    hasResale = split.resale.length > 0,
    hasAsset = split.asset.length > 0;
  if (hasResale)
    events.push(
      Object.assign({}, base, {
        type: 'purchase_bill',
        party: supplier,
        by_rate: byRateOf({ ItemList: split.resale, _cb: split._cb }).rows,
        paid: {},
        round_off,
        counter: null,
        source_ref: 'chit:' + id,
        against_ref: id,
        due_date: dueDate
      })
    );
  /* ⭐ AN ASSET LINE (engines v1.14 R2): the purchase rule with accept: 'asset' puts the cost on the class's PPE ledger; the register row
     (lib/books-assets) is made by postChit once THIS entry has posted — `asset_register` is what it needs, never read by the engine */
  if (hasAsset)
    events.push(
      Object.assign({}, base, {
        type: 'purchase_bill',
        accept: 'asset',
        asset_class: asset.class,
        put_to_use: asset.put_to_use,
        party: supplier,
        by_rate: byRateOf({ ItemList: split.asset, _cb: split._cb }).rows,
        paid: {},
        round_off: hasResale ? 0 : round_off,
        counter: null,
        source_ref: hasResale ? 'chit:' + id + ':asset' : 'chit:' + id,
        against_ref: id,
        due_date: dueDate,
        asset_register: asset.register
      })
    );
  const hasBefore = hasResale || hasAsset;
  if (split.use.length) {
    const list = byRateOf({ ItemList: split.use, _cb: split._cb }).rows;
    const sum = (field) => roundMoney(list.reduce((total, item) => total + (item[field] || 0), 0));
    const inputTax = { cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess') };
    const singleHead = split._cb && split._cb.scheme ? String(split._cb.scheme).toLowerCase() : null;
    if (singleHead && sum(singleHead)) inputTax[singleHead] = sum(singleHead); /* AU GST: the one head (byRateOf) */
    events.push(
      Object.assign({}, base, {
        type: 'expense',
        class: (setting && setting.use_class) || 'sundry_expense',
        amount: roundMoney(sum('taxable') + (hasBefore ? 0 : round_off)),
        input_tax: inputTax.cgst || inputTax.sgst || inputTax.igst || inputTax.cess || (singleHead && inputTax[singleHead]) ? inputTax : undefined,
        supplier: supplier,
        counter: null,
        source_ref: hasBefore ? 'chit:' + id + ':use' : 'chit:' + id,
        against_ref: id,
        due_date: dueDate
      })
    );
  }
  for (const mode of Object.keys(paid || {}))
    if (paid[mode])
      events.push(
        Object.assign({}, base, {
          type: 'payment_made',
          party: supplier,
          mode: mode,
          amount: paid[mode],
          counter: null,
          source_ref: 'chit:' + id + ':paid:' + mode,
          against_ref: id
        })
      );
  return { event: events[0], events };
}
/**
 * a tender's parts → the amount per tender the posting rules know (modes), and the words of those they do not (unknown).
 * `holdBack` (FIN-58, my own counter bill only): a UPI part with confirmed === false is NOT money received yet — it goes to `waiting` (same shape as modes), not to modes.
 * Without it, or with confirmed absent / true, every part is counted as ever (the refund and the bought-bill readers never ask).
 */
function modesOf(parts, holdBack) {
  const out = {},
    waiting = {},
    unknown = [];
  const waitingRule = holdBack ? require('./upi-waiting') : null;
  for (const part of parts || []) {
    const mode = modeOf(part.how);
    const amount = roundMoney(part.amount);
    if (!amount) continue;
    if (!mode) {
      unknown.push(part.how);
      continue;
    }
    const into = waitingRule && waitingRule.isWaitingPart(part, modeOf) ? waiting : out;
    into[mode] = roundMoney((into[mode] || 0) + amount);
  }
  return { modes: out, waiting, unknown };
}
/**
 * ⭐⭐ THE SHOP'S DAY — ONE RULE (M210, "day-close breaks past midnight"). A moment buckets into the SHOP's calendar day, in the
 * shop's own IANA zone (identities.timezone, b176) — never the server's clock, never the database's. Every day close, day report,
 * sweep, to-do and pack asks dayOf / dayBounds; nothing else slices a timestamp to a date.
 *   zone — an IANA name ('Asia/Kolkata', 'Australia/Sydney': DST included, Intl does the table), a country code of a
 *          single-zone country (the b176 guess, COUNTRY_ZONE), or the row that carries both — the books setting or the
 *          identity row ({ timezone, country }). Nothing known → UTC: no country's clock for an unstated country (T2-NATDEF).
 *   ts   — a Date (what node-pg hands back for timestamptz, and for `timestamp without time zone` once db/index.js reads it as
 *          UTC), ms, or a string. ⚠️ A string WITHOUT a zone designator ('2026-10-11 18:35:00', what a naive column holds before
 *          b301 converts it) is read as a UTC wall clock — the storage convention db/index.js pins on every connection — so the
 *          answer is the same before and after the migration, on a UTC server and on an IST one. A bare YYYY-MM-DD is that day.
 * (decision #5 "bizDay everywhere" still open — the shop-day cut is midnight.)
 */
const COUNTRY_ZONE = {
  IN: 'Asia/Kolkata',
  AU: 'Australia/Sydney',
  AE: 'Asia/Dubai',
  SG: 'Asia/Singapore',
  GB: 'Europe/London',
  FR: 'Europe/Paris',
  DE: 'Europe/Berlin',
  SA: 'Asia/Riyadh'
}; /* WX-R2R: AU was missing — an AU shop's day closed on India's clock */
const fmtCache = {};
/** the cached date formatter for a zone (an unknown zone falls to UTC) */
function fmtOf(zone) {
  if (fmtCache[zone]) return fmtCache[zone];
  const opt = { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: zone }, opt));
  } catch (_) {
    formatter = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'UTC' }, opt));
  } /* a zone Intl does not know → UTC, no country's */
  return (fmtCache[zone] = formatter);
}
/** the zone a caller means: an IANA name, a single-zone country, or a row carrying `timezone` / `country` */
function zoneOf(zoneSpec) {
  if (zoneSpec && typeof zoneSpec === 'object') return zoneOf(zoneSpec.timezone || zoneSpec.country);
  const text = String(zoneSpec || '').trim();
  if (text.indexOf('/') > 0 || text === 'UTC') return text;
  return packZone(text.toUpperCase()) || COUNTRY_ZONE[text.toUpperCase()] || 'UTC'; /* T2-NATDEF: unstated → UTC, never India's midnight */
}
/* CX2 (A6): a registered pack names its zones (engines v1.42 `timeZones`; the setup step sets identities.timezone from them) — an Australian shop with
   no zone saved yet is cut at its pack's first zone (Sydney), never at India's midnight. A country with no pack keeps the b176 table above. */
function packZone(code) {
  let pack;
  try {
    pack = require('./regulation').lookup(code);
  } catch (e) {
    cbLog.fellBack('books-hooks packZone: the helper failed — answered with nothing', e);
    return null;
  }
  return pack && !pack.fallback && pack.id === code && Array.isArray(pack.timeZones) && pack.timeZones[0] ? pack.timeZones[0] : null;
}
/** the wall clock of a moment in a zone — { y, m, d, H, M, S } */
function wallOf(moment, zone) {
  const wall = {};
  for (const piece of fmtOf(zone).formatToParts(new Date(moment))) if (piece.type !== 'literal') wall[piece.type] = Number(piece.value);
  return { y: wall.year, m: wall.month, d: wall.day, H: wall.hour === 24 ? 0 : wall.hour, M: wall.minute, S: wall.second };
}
/** ms between the zone's wall clock and UTC at that moment (+19,800,000 for India) */
function offsetAt(moment, zone) {
  const wall = wallOf(moment, zone);
  return Date.UTC(wall.y, wall.m - 1, wall.d, wall.H, wall.M, wall.S) - Math.floor(moment / 1000) * 1000;
}
const NAIVE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
/** the instant a timestamp names (ms), or NaN — a zone-less string is a UTC wall clock (see above) */
function momentOf(ts) {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  const text = String(ts == null ? '' : ts).trim();
  return NAIVE.test(text) ? Date.parse(text.replace(' ', 'T') + 'Z') : Date.parse(text);
}
const pad2 = (value) => (value < 10 ? '0' : '') + value;
/** the shop's calendar day (YYYY-MM-DD) of a moment, in the shop's zone — null when it is not a moment */
function dayOf(ts, zone) {
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts.trim())) return ts.trim(); /* a day is already a day */
  const moment = momentOf(ts);
  if (!isFinite(moment)) return null;
  const wall = wallOf(moment, zoneOf(zone));
  return wall.y + '-' + pad2(wall.m) + '-' + pad2(wall.d);
}
/** the instant (ms) the shop's day BEGINS — local midnight; on a day whose midnight a DST jump skipped, the first minute that exists */
function dayStartMs(shopDay, zone) {
  const zoneName = zoneOf(zone),
    guess = Date.parse(shopDay + 'T00:00:00Z');
  let startMs = guess - offsetAt(guess, zoneName);
  const again = guess - offsetAt(startMs, zoneName);
  if (again !== startMs) startMs = again; /* the offset changed between the guess and the answer (a DST edge) */
  for (let index = 0; index < 3 && dayOf(startMs, zoneName) < shopDay; index++) startMs += 3600000; /* midnight itself was skipped — the day starts an hour on */
  return startMs;
}
/** [from, to) of the shop's day as ISO instants — a DST day is 23 or 25 hours long, so `to` is the NEXT day's start, never +24h */
function dayBounds(shopDay, zone) {
  const zoneName = zoneOf(zone),
    date = new Date(Date.parse(shopDay + 'T00:00:00Z') + 86400000);
  const next = date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  return { from: new Date(dayStartMs(shopDay, zoneName)).toISOString(), to: new Date(dayStartMs(next, zoneName)).toISOString() };
}
/**
 * The shape of a counter's billed_at the books honour — an ISO date, then a time (T or a space). ONE definition: postingMoment() tests it, and the GST return's
 * SQL window (tax-copy POSTED_AT_SQL) is built from the same source, so a malformed free-text value falls back to the send in BOTH and never throws in SQL.
 */
const BILLED_AT_SHAPE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ]([01]\d|2[0-3]):[0-5]\d/;
/**
 * ⭐ THE MOMENT A CHIT IS POSTED AT — the counter's own billed_at, else the send, else the creation. ONE definition: classify() cuts the books'
 * day from it, and tax-copy cuts the GST return's month from the same value (Fable review 2026-10-23, finding 2).
 */
function postingMoment(copy) {
  const row = copy || {},
    billed = row.business_json && row.business_json.billed_at;
  return (typeof billed === 'string' && BILLED_AT_SHAPE.test(billed) ? billed : null) || row.sent_at || row.created_at;
}
function partyFromCustomer(customer) {
  return customer && (customer.party_id || customer.identity_id || customer.entity_id) ? String(customer.party_id || customer.identity_id || customer.entity_id) : null;
}

/**
 * ⭐⭐⭐ THE BUYER'S COPY POSTS ONLY ONCE THE BUYER HAS ACCEPTED IT ON THE RAIL (Athi, 2026-10-01: "it should not be
 * automatic, it has to have a checking mechanism in the rail to allow it to the sundry creditor — the material received
 * status and so on"). A bill I RECEIVE (a counter bill another shop billed me, an invoice a supplier sent) is a claim
 * until I confirm the goods: the acceptance is the chit's OWN status on my copy (chit_status.current_status, moved by
 * PUT /api/chits/:id/status — the step the Intake folder drives), never a ledger-only flag.
 *   accepted · in_progress · completed → may post (supplier list permitting — the hook checks, postChit)
 *   rejected · cancelled               → never posts (a dispute settled in the buyer's favour ends here)
 *   an OPEN dispute on the chit        → waits, whatever the status (settled for the seller + accepted → posts)
 *   anything else (delivered, read, pending, partial) → waits, with the sentence the Waiting list shows
 */
const ACCEPTED = /^(accepted|in_progress|completed)$/,
  REFUSED = /^(rejected|cancelled)$/;
/* FX-F10W2: a bill I rejected / cancelled never posts — and its Waiting row closes with that sentence (postChit → closeDone), no retry needed */
function refusedNone(input, copy) {
  const statusText = String(input.status || (copy && copy.current_status) || '');
  return { kind: 'none', done: true, why: (/^cancelled$/.test(statusText) ? 'Cancelled' : 'Rejected') + ' — not posted' };
}
/**
 * ACC-223 · is MY copy of this chit cancelled / rejected? The ONE test classify opens with, so every purpose (my counter bill, sent invoice, credit note,
 * expense, income, a payment received) answers refusedNone — not only a bill I RECEIVED (buyerGate). A summary chit is the record itself, never refused here.
 */
function refusedOwnCopy(input, copy) {
  const isSummary = String(copy.purpose || '') === 'general' && !!copy.business_json && typeof copy.business_json.summary === 'object';
  return !isSummary && REFUSED.test(String(input.status || copy.current_status || ''));
}
/** what stops classify before any rule is read: my copy cancelled / rejected (refusedNone), else the money hold (moneyHold) → a verdict or null */
function stopBeforeRules(input, copy, business, base) {
  return refusedOwnCopy(input, copy) ? refusedNone(input, copy) : moneyHold(copy, business, base);
}
function sellerNameOf(entry) {
  return (entry && entry.seller && (entry.seller.LglNm || entry.seller.TrdNm)) || 'the seller';
}
/** a bill I RECEIVED: refused → never posts; disputed → waits for the settlement; not yet accepted → waits for me; else null (may post) */
function buyerGate(input, entry, ref) {
  const statusText = String(input.status || (input.chit && input.chit.current_status) || '');
  const what = '(bill ' + ref + ' from ' + sellerNameOf(entry) + ')';
  if (REFUSED.test(statusText)) return refusedNone(input, input.chit);
  if (input.disputed) return { kind: 'queue', wait: 'dispute', why: 'Disputed — this posts once the dispute is settled and you confirm the goods ' + what + '.' };
  if (!ACCEPTED.test(statusText)) return { kind: 'queue', wait: 'acceptance', todo: 'accept', why: 'Waiting for you to confirm the goods were received ' + what };
  return null;
}

/**
 * A SALE WHOSE SUPPLY CANNOT BE DECIDED WAITS, LIKE A BILL I RECEIVED (Fable review 2026-10-23, finding 10). A registered seller's taxed line that came out with
 * every head 0 because the engine could not tell intra from inter (no state on the seller) would post as a sale with no tax and no word said. It parks in
 * words instead. A seller who may not charge tax (unregistered, composition) is not asked: its rate is stated for the record by design.
 */
/** a seller who may charge tax at all: not unregistered, not on the composition scheme; null = nobody said (the one rule, lib/tax-shelf registrationMayCharge) */
function mayChargeTax(seller) {
  return require('./tax-shelf').registrationMayCharge(seller && seller.RegType);
}
/**
 * ⭐ ACC-198: A SALE BY A SHOP WHOSE TAX REGISTRATION NOBODY STATED WAITS WITH THE QUESTION (R13, Athi 29 Oct). Without a registration the shelf
 * carries no rate (tax-shelf readShelf), so no line can be called taxed or untaxed: posting it at 0 would be a "no" nobody said. Never a guessed rate.
 */
function registrationWait(entry, ref) {
  if (!entry || !entry.sells || !entry.seller || mayChargeTax(entry.seller) !== null) return null;
  const asked = require('./country-setup').registrationAsk(entry.seller.Country);
  return { kind: 'queue', code: asked.code, why: asked.question + ' Answer it in Settings → Country setup (yes with the number, or no); sale ' + ref + ' posts then.' };
}
/** ACC-198: my sale with no tax number on me → the seller carries RegType 'unknown' when the shop never said (country-setup.registrationOfShop); else as it came */
async function withRegistration(entity, entry) {
  if (!entry || !entry.sells || !entry.seller || entry.seller.Gstin) return entry;
  if ((await require('./country-setup').registrationOfShop(entity)) !== 'unknown') return entry;
  return Object.assign({}, entry, { seller: Object.assign({}, entry.seller, { RegType: 'unknown' }) });
}
function saleUndecided(invoice, entry, ref) {
  if (!entry || !entry.sells || !invoice || !invoice._cb || invoice._cb.supply !== 'unknown') return null;
  if (!mayChargeTax(entry.seller)) return null;
  const silent = (invoice.ItemList || []).some((item) => Number(item.GstRt) > 0 && !item.CgstAmt && !item.SgstAmt && !item.IgstAmt && !item.TaxAmt);
  return silent ? { kind: 'queue', why: 'Sale ' + ref + ' carries tax but your state is not known, so CGST/SGST or IGST cannot be decided — add your tax number in the country setup, then this posts.' } : null;
}
/**
 * a tax on the invoice these books cannot post yet → the queue, in words (else null). Shared by every bill branch below.
 *   · a non-GST tax (TaxAmt with no scheme) the rules do not carry
 *   ⚠️⚠️ WX-R2R (2026-10-13): a single-head tax (AU GST) posts only where the ledger's chart has that head. The api's adopted accounts-packs
 *   (v1.20.0) knows India alone, so an AU ledger opens on India's chart, whose rules post cgst/sgst/igst — a `gst` figure would be DROPPED and
 *   the entry still balance (Sales 72.73 · Customers 72.73 on an A$80 bill). It waits, in words, until the books open on a pack that posts it.
 */
function headsWait(invoice, byRate, setting, entry, ref) {
  const unasked = registrationWait(entry, ref); /* ACC-198: nobody said whether the shop is registered — ask, never guess */
  if (unasked) return unasked;
  const undecided = saleUndecided(invoice, entry, ref); /* a SALE (entry given) whose supply is undecided waits, in words */
  if (undecided) return undecided;
  if (byRate.other) return { kind: 'queue', why: 'The bill carries a non-GST tax (' + byRate.other + ') the posting rules do not post yet.' };
  const singleHead = invoice._cb && invoice._cb.scheme ? String(invoice._cb.scheme).toLowerCase() : null;
  if (singleHead && byRate.rows.some((item) => item[singleHead]) && !postsHead(setting, singleHead)) {
    const headAmount = roundMoney(byRate.rows.reduce((total, item) => total + (item[singleHead] || 0), 0));
    return {
      kind: 'queue',
      why:
        'The bill carries ' +
        String(invoice._cb.scheme).toUpperCase() +
        ' (' +
        headAmount +
        ') but these books were opened on a chart with no ' +
        String(invoice._cb.scheme).toUpperCase() +
        ' ledger — it waits, so the tax is never dropped.'
    };
  }
  return null;
}
/** F10: is this copy my counter receipt carrying their bill? (tax-copy.capturedBill — the folder rule's own test) */
function capturedOf(copy) {
  return String((copy && copy.purpose) || '') === 'receipt' && require('./folder-inventory').theirBill(copy && copy.business_json);
}
/**
 * a receipt whose supplier the books cannot name waits, in words: no name at all → reject or re-receive; a typed name the list does not
 * know → "Who is …?" with the near matches riding as DATA (FX-F10W; STD1: the sentence is for people, never parsed). null = the supplier is known.
 */
function receiptPartyWait(input, supplier, name, no) {
  if (supplier) return null;
  if (/^(the supplier|not named)$/i.test(name))
    return { kind: 'queue', wait: 'party', why: 'Bill ' + no + ' names no supplier — reject it and record their bill by hand, or receive it again naming them.' };
  return Object.assign(
    { kind: 'queue', wait: 'party', todo: 'add_supplier', name, why: 'Who is ' + name + '? Add them as a supplier — then bill ' + no + ' waits for you to accept it.' },
    Array.isArray(input.candidates) && input.candidates.length ? { candidates: input.candidates } : {}
  );
}
/**
 * ⭐⭐ OPS-60 (Athi 24 Oct; R106): their bill says MORE than was counted → the bill posts at the COUNT and the gap is NOTED against their
 * figure — never the full bill with a reversal (stock the shop does not hold; input tax on goods not received, GST s.16(2)(b)). Their bill
 * saying LESS is no shortfall (posting the count would overstate the creditor): that still waits. Figures in minor units, so no screen
 * parses the words (FIELDS waiting[].short). null = no shortfall (agrees, round-off, their figure below the count).
 */
function shortfallOf(compared, currency, moneyWords) {
  if (!compared || compared.code !== 'apart' || !(compared.gap > 0)) return null;
  const minor = (amount) => toMinor(amount, currency); /* ACC-179 fold: the one major → minor */
  return {
    theirs_minor: minor(compared.theirs),
    ours_minor: minor(compared.ours),
    short_minor: minor(compared.gap),
    words: moneyWords(compared.gap) + ' short against their ' + moneyWords(compared.theirs),
    offer: 'Accept it at ' + moneyWords(compared.ours) + ' (' + moneyWords(compared.gap) + ' short, noted), or reject it.'
  };
}
/** the wait a shortfall rides on: the accept wait, with the gap and the offer; any other gate (dispute, refused) stands as it is */
function shortfallGate(gate, compared, short) {
  if (!short || gate.wait !== 'acceptance') return gate;
  return Object.assign({}, gate, { wait: 'gap', gap: compared.gap, short, why: compared.sentence + ' ' + short.offer });
}
/** what a shortfall adds to the bill's event: the figures, the narration the Day book shows, the note the Payables row shows */
function shortfallFields(short, no, name) {
  return short ? { short, narration: 'Bill ' + no + ' from ' + name + ': ' + short.words + '.', note: short.words } : {};
}
/**
 * ⭐⭐ F10 — MY RECEIPT OF THEIR BILL → purchase_bill, the same event a received invoice posts (Athi, 14 Oct: "yes to F10, build it").
 * The counter's Receive form captured their bill no. and total; the lines are what was COUNTED, at their rates, with the GST rate the
 * counter recorded — taxed by the one engine (tax-copy entryFor → tax-lines.invoiceFor: seller = the supplier, buyer = me), so an AU
 * shop gets one GST head and an Indian one CGST+SGST or IGST by the supplier's state. In order:
 *   rejected / cancelled                      → never posts
 *   their invoice for the same order is here  → none: THEIR INVOICE IS THE BILL (inp.theirInvoice — postChit reads it); this receipt is
 *                                               the goods record, and postChit closes it with that sentence
 *   no supplier the books know                → waits: "Who is <name>? Add them as a supplier" (inp.party: postChit resolves the typed
 *                                               name against the supplier list, so adding them is all it takes)
 *   an Indian supplier with no state          → waits: CGST/SGST vs IGST cannot be decided — never guessed
 *   their total vs the lines: a gap within one unit posts as the round-off (the counter-bill rule); their figure BELOW the count waits with
 *                                               BOTH figures and the gap; their figure ABOVE the count (a shortfall, OPS-60) waits for the
 *                                               accept with the offer "Accept it at <count> (<gap> short, noted)", then posts at the count
 *                                               with the gap in the narration and on the bill's note — no second entry, no reversal
 *   not accepted yet                          → waits for acceptance (buyerGate — the receipt is born 'pending', like any bill I receive)
 */
function receiptBill(input, copy, entry, setting, business, base, currency) {
  const theirBill = business.their_bill || {},
    no = String(theirBill.no).trim();
  const name = String((entry.seller && entry.seller.LglNm) || (business.party && business.party.name) || '').trim() || 'the supplier';
  if (REFUSED.test(String(input.status || copy.current_status || ''))) return refusedNone(input, copy);
  if (input.theirInvoice)
    return { kind: 'none', done: true, why: 'Their invoice ' + (input.theirInvoice.no || '') + ' is the bill — this receipt is the goods record.' };
  const supplier = input.party || (entry.seller && entry.seller.entity_id) || null;
  const partyWait = receiptPartyWait(input, supplier, name, no);
  if (partyWait) return partyWait;
  const invoice = entry.invoice;
  if (!invoice || !(invoice.ItemList || []).length) return { kind: 'queue', why: 'Bill ' + no + ' from ' + name + ' has no lines to post.' };
  const byRate = byRateOf(invoice);
  const unposted = headsWait(invoice, byRate, setting);
  if (unposted) return unposted;
  const taxed = (invoice.ItemList || []).some((item) => Number(item.GstRt) > 0);
  if (taxed && invoice._cb && invoice._cb.supply === 'unknown')
    return {
      kind: 'queue',
      wait: 'state',
      why:
        'Bill ' +
        no +
        ' from ' +
        name +
        ' carries ' +
        String(invoice._cb.scheme || 'tax').toUpperCase() +
        ' but their state is not known — add their tax number to the supplier, then this posts.'
    };
  if (theirBill.total == null || theirBill.total === '' || !isFinite(Number(theirBill.total)))
    return { kind: 'queue', why: 'Bill ' + no + ' from ' + name + ' has no readable total.' };
  /* ⭐⭐ FX-F10W2: THE ONE COMPARISON (lib/their-bill — the counter's Receive form and slip call the same file): their total against what
     they charge, taxable + tax, as the one engine taxed the lines (byRateOf). Within one unit it posts as the round-off; beyond it waits
     with the SAME sentence the counter printed, + what to do. */
  const taxable = roundMoney(byRate.rows.reduce((total, item) => total + item.taxable, 0));
  const sayMoney = (amount) => require('./bill-privacy').money(toMinor(amount, currency), currency); /* ACC-179 fold: the one major → minor */
  const comparison = require('./their-bill').check({ total: theirBill.total, taxable, tax: roundMoney(byRate.total - taxable), currency: currency, no, say: sayMoney });
  const short = shortfallOf(comparison, currency, sayMoney);
  if (comparison.code === 'apart' && !short)
    return { kind: 'queue', wait: 'gap', gap: comparison.gap, why: comparison.sentence + ' Ask ' + name + ' to correct it, or reject it and record their bill by hand.' };
  const gate = buyerGate(input, { seller: { LglNm: name } }, no);
  /* a shortfall still waits for the accept (todo 'accept', so the Accept action stays open) and says what accepting does, with the figures as data */
  if (gate) return shortfallGate(gate, comparison, short);
  const round_off = short ? 0 : roundMoney(comparison.gap);
  return {
    kind: 'post',
    supplier_check: true,
    event: Object.assign(
      {},
      base,
      { ref: no, type: 'purchase_bill', party: String(supplier), by_rate: byRate.rows, paid: {}, round_off, counter: null, source_ref: 'chit:' + copy.chit_id, against_ref: copy.chit_id, rcm: rcmOf(invoice, currency) },
      shortfallFields(short, no, name)
    )
  };
}

/**
 * ⭐ H2 (PAY-FIX): THE KEY IS THE PRESS. `payment.client_ref` (minted by the web when the Mark-paid sheet opens) makes the key
 * chitpay:<chit>:<ref>, so ₹500 now and ₹500 later are TWO payments and a retry of either is its own replay. A press with
 * no ref (an older web, the retry from Waiting) keeps chitpay:<chit> — one payment per chit, the second answered as the first.
 */
const chitPaymentKey = (chit_id, pressRef) => 'chitpay:' + chit_id + (pressRef ? ':' + String(pressRef) : '');
/** a major-unit figure in the currency's minor units (paise for INR): the api's ONE (books-cashflow.toMinor, lazy — it reads this module's neighbours); unreadable is 0, as classify always took it (ACC-179 fold) */
const toMinor = (major, currency) => require('./books-cashflow').toMinor(Number(major) || 0, currency);
/**
 * quotedOf(chit) → the amount a bare "Mark paid" settles: the bill's stored ENGINE total through the one pick (invoice → money → as placed). It was `total_value`, the
 * pre-tax net on every rail invoice (₹180 of ₹189), with a `grand_total` fallback that nothing in the system ever wrote. (ACC-206 B)
 */
function quotedOf(chit) {
  return Number(billPick.pickOf(chit).total) || 0;
}
/**
 * parkAndTell(entity, waiting, verdict, chit_id, copy) — a chit that cannot post waits in the outbox (park). When it waits because its stored copies DISAGREE, the fault also
 * reaches us, once (moneyCheck.raise: the ticket's client_ref is unique, so a repeat sighting is a no-op). Called for a first attempt only — a retry never raises again.
 */
async function parkAndTell(entity, waiting, verdict, chit_id, copy) {
  if (verdict.mismatch) await moneyCheck.raise(entity, Object.assign({ chit_id }, copy), verdict.mismatch, 'books-hooks classify');
  await park(entity, waiting, verdict.why, chit_id, 'chit:' + chit_id);
}

/**
 * ⭐⭐ ACC-206 B · THE EQUALITY CHECK BEFORE POSTING (R4). The stored copies of one engine figure must agree: if they do not, the posting WAITS in words and a
 * support ticket reaches us (postChit raises it — classify stays pure). Nothing here adds or subtracts; pickOf only asks "are they equal". A chit from before
 * stamps whose total_value is the route's old net is NOT a disagreement (pickOf legacy_net) and posts at the engine's figure. An overridden sale POSTS at its
 * issued figures, never silently: the entry's narration says so (written onto `base`), and the books to-do lists it until someone resolves it.
 * → a queue verdict { kind: 'queue', why, mismatch } or null.
 */
function moneyHold(chit, business, base) {
  const picked = billPick.pickOf(chit);
  if (picked.agree === false) {
    const seen = [picked.source].concat(picked.differs || []).map((name) => name + ' ' + picked.copies[name]).join(' ≠ ');
    return { kind: 'queue', why: 'The system did not get the right value for this bill: its stored figures disagree (' + seen + '). We have been told and are on it; it posts once Support has fixed it.', mismatch: picked };
  }
  const override = business.money_override;
  if (override && typeof override === 'object') {
    const words = chit.summary_json && chit.summary_json.money && chit.summary_json.money.bridge && chit.summary_json.money.bridge.words;
    base.narration = 'money override · ' + (words || override.step || 'did not add up') + ' · allowed by ' + (override.by || 'the owner');
  }
  return null;
}

/**
 * what a Mark-paid press WAITS on (null when nothing): the facts classify named, in the order a person would ask them. A wait
 * carries `party` so the door asks the stranger rule BEFORE the ledger waits (FIN-55: a stranger's bill by "other" was marked
 * paid); a press for nothing carries `refuse` — a retry could never find an amount (the press and the quote are frozen on the
 * copy), so the door refuses it, never a mark (FIN-52).
 */
function markPaidWait(billNo, method, party, amount, mode, postingDay) {
  /* the amount FIRST: it depends on no party (critic on #504: a press with no amount, no quote and no known party must refuse, never wait) */
  if (!amount) return { kind: 'queue', refuse: true, party, why: 'Paid (' + billNo + ') for nothing: the amount is 0. Type the amount received.' };
  if (!party) return { kind: 'queue', why: 'Paid (' + billNo + ') by nobody the shop knows — choose the customer.' };
  if (!mode || mode === 'credit') return { kind: 'queue', party, why: 'Paid (' + billNo + ') by "' + method + '", which has no ledger yet.' };
  if (!postingDay) return { kind: 'queue', party, why: 'Paid (' + billNo + ') has no usable date.' };
  return null;
}
/** a credit bill's own terms (the counter wrote them on the chit): its due date, when it is a real date; else undefined */
function termsDueDate(business) {
  return business.terms && /^\d{4}-\d{2}-\d{2}$/.test(String(business.terms.due_date || '')) ? String(business.terms.due_date) : undefined;
}
/** the counter's day summary chit → the walk-in day of that counter (a week / month one posts nothing) */
function daySummaryVerdict(business, till) {
  const summary = business.summary;
  if (summary.period !== 'day') return { kind: 'none' };
  const key = /(\d{4}-\d{2}-\d{2})/.exec(String(summary.key || ''));
  const counter = (summary.till && summary.till.id) || till;
  if (!key || !counter) return { kind: 'queue', why: 'A day summary without its day or its counter.' };
  return { kind: 'day', counter: String(counter), day: key[1] };
}
/** money received that cannot post yet → the queue naming why, else null (nobody known · no amount · a tender with no ledger · no usable date) */
function paymentReceivedWait(received, party, amount, mode, receivedDay) {
  if (!party) return { kind: 'queue', why: 'Money received (' + (received.no || '') + ') from nobody the shop knows — choose the customer.' };
  if (!amount) return { kind: 'queue', why: 'Money received (' + (received.no || '') + ') with no amount.' };
  if (!mode || mode === 'credit') return { kind: 'queue', why: 'Money received (' + (received.no || '') + ') by "' + received.mode + '", which has no ledger yet.' };
  if (!receivedDay) return { kind: 'queue', why: 'Money received (' + (received.no || '') + ') has no usable date.' };
  return null;
}
/** ⭐ MONEY RECEIVED AT THE COUNTER — its own numbered series, never a bill (books-counter 3e1c88f) → a payment verdict, or the queue naming what is missing */
function paymentReceivedVerdict(ctx) {
  const { copy, setting, business, currency, at } = ctx;
  const received = business.payment_received,
    pcur = String(received.currency || currency).toUpperCase();
  const party = partyFromCustomer(received.party) || partyFromCustomer(business.customer);
  const receivedAmount = roundMoney(Math.abs(Number(received.amount) || 0)),
    mode = modeOf(received.mode),
    receivedDay = dayOf(received.at || at, setting);
  const wait = paymentReceivedWait(received, party, receivedAmount, mode, receivedDay);
  if (wait) return wait;
  const cheque = received.cheque && typeof received.cheque === 'object' ? received.cheque : {};
  return {
    kind: 'payment',
    payment: {
      party_id: party,
      direction: 'in',
      amount_minor: toMinor(receivedAmount, pcur),
      currency: pcur,
      mode,
      reference: received.no || null,
      cheque_no: cheque.no || null,
      cheque_bank: cheque.bank || null,
      cheque_date: /^\d{4}-\d{2}-\d{2}$/.test(String(cheque.dated || '')) ? cheque.dated : null,
      received_at: receivedDay,
      client_ref: 'chit:' + copy.chit_id,
      source_chit_id: copy.chit_id
    }
  };
}
/** the party a Mark-paid press is about: a bill I bought → its seller (else the chit's sender); one I sold → the counter's customer (else the chit's buyer) */
function markPaidParty(bought, entry, copy, business) {
  return bought
    ? entry.seller && entry.seller.entity_id
      ? String(entry.seller.entity_id)
      : copy.sender_entity_id
        ? String(copy.sender_entity_id)
        : null
    : partyFromCustomer(business.customer) || (entry.buyer && entry.buyer.entity_id ? String(entry.buyer.entity_id) : null);
}
/**
 * ⭐ "MARK PAID" ON A CHIT (POST /chits/:id/payment → business_json.payment { method, ref, amount, note, at, by }) — drift D1
 * (TILES 2026-10-08; Athi: "Q4 redirect in M26"). The copy carries what happened; the BOOKS record it through recordPayment,
 * the one path — never a second "paid" writer. A counter bill's tender ({ parts }) is NOT this: it posts with its bill.
 * Who paid: the seller's copy names the buyer (bj.customer at the counter, else the chit's buyer on the rail) — money IN;
 * a bill I RECEIVED marked paid is money OUT to its seller. The amount typed, else the quoted total (the same two slots the
 * route checks a typed amount against). `against_chit` names the bill it settles — recordChitPayment allocates it when the
 * books hold that bill open; an order not yet posted records as an advance.
 */
function markPaidVerdict(ctx) {
  const { copy, entry, setting, business, currency, at } = ctx;
  const press = business.payment,
    mode = modeOf(press.method),
    pressDay = dayOf(press.at || at, setting),
    bought = entry.sells === false;
  const party = markPaidParty(bought, entry, copy, business);
  const quoted = quotedOf(copy);
  const pressAmount = roundMoney(Math.abs(Number(press.amount != null ? press.amount : quoted) || 0));
  const no = business.bill_no || business.printed_as || String(copy.chit_id).slice(0, 8);
  const wait = markPaidWait(no, press.method, party, pressAmount, mode, pressDay);
  if (wait) return wait;
  return {
    kind: 'payment',
    payment: {
      party_id: party,
      direction: bought ? 'out' : 'in',
      amount_minor: toMinor(pressAmount, currency),
      currency: currency,
      mode,
      reference: press.ref || null,
      received_at: pressDay,
      client_ref: chitPaymentKey(copy.chit_id, press.client_ref),
      source_chit_id: copy.chit_id,
      against_chit: copy.chit_id, quoted_minor: toMinor(quoted, currency) /* the ledger OFF asks against the quote (FIN-53) */
    }
  };
}
/**
 * ⭐ ACC-230 — AN EXPENSE CHIT'S GST. `business_json.expense.input_tax` is { <head>: amount } in the pack's own tax heads (AU `gst`;
 * India `cgst` + `sgst` or `igst`, `cess`) — the SAME shape the bill path hands the engine's expense event (the use lines above), so
 * the one posting engine writes Dr expense (net) + Dr input tax · Cr what paid it. `expense.amount` stays what was PAID (the drawer and
 * the day close read it), so net = amount − tax; no tax is computed here. A head the books do not post, or tax that is not less than
 * the amount, waits in words — never dropped, never guessed (India's split needs the supplier's state, which an expense does not carry).
 * → { net, tax? } | { why }
 */
function expenseTaxSplit(heads, amount, setting) {
  if (heads == null) return { net: amount };
  if (typeof heads !== 'object' || Array.isArray(heads)) return { why: 'The expense GST must name its tax heads (for example gst, or cgst and sgst).' };
  const taxByHead = {};
  for (const headName of Object.keys(heads)) {
    const part = expenseTaxAmount(heads[headName]);
    if (part === null) return { why: 'The expense GST for "' + headName + '" is not a number of zero or more — it waits, never read as nothing.' };
    if (!part) continue;
    if (!postsHead(setting, headName)) return { why: 'The expense carries "' + headName + '" tax, which these books do not post — it waits, so the tax is never dropped.' };
    taxByHead[headName] = part;
  }
  return expenseNetOf(taxByHead, amount);
}
/** the heads gathered → net + heads, or the wait: IGST with CGST/SGST is intra and inter-state at once; tax must stay below the amount paid */
function expenseNetOf(taxByHead, amount) {
  if (taxByHead.igst && (taxByHead.cgst || taxByHead.sgst)) return { why: 'The expense carries IGST and CGST/SGST together — a purchase is inside the state or across it, not both.' };
  const total = roundMoney(Object.keys(taxByHead).reduce((sum, headName) => sum + taxByHead[headName], 0));
  if (!total) return { net: amount };
  if (total >= amount) return { why: 'The expense GST (' + total + ') is not less than the amount paid (' + amount + ').' };
  return { net: roundMoney(amount - total), taxByHead };
}
/** one head's tax as typed → a major-unit amount of zero or more, or null when it is not one (blank, text, negative, true: never read as 0) */
function expenseTaxAmount(given) {
  if (given === '' || given == null || typeof given === 'boolean') return null;
  const amount = Number(given);
  return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
}
/** an expense chit → the expense event (cash or on credit to a supplier), or the queue naming what is missing */
function expenseVerdict(ctx) {
  const { copy, business, base, till, setting } = ctx;
  const x = business.expense || {};
  const expenseAmount = roundMoney(Math.abs(Number(x.amount) || 0));
  if (!expenseAmount) return { kind: 'queue', why: 'An expense with no amount.' };
  const expenseMode = modeOf(x.mode);
  const split = expenseTaxSplit(x.input_tax, expenseAmount, setting);
  if (split.why) return { kind: 'queue', why: split.why };
  const expenseEvent = Object.assign({}, base, { type: 'expense', class: x.class || 'sundry_expense', amount: split.net, source_ref: 'chit:' + copy.chit_id, counter: till });
  if (split.taxByHead) expenseEvent.input_tax = split.taxByHead;
  if (expenseMode === 'credit') {
    if (!x.supplier) return { kind: 'queue', why: 'An expense on credit names no supplier.' };
    expenseEvent.supplier = String(x.supplier);
  } else if (!expenseMode) return { kind: 'queue', why: 'The expense was paid by "' + x.mode + '", which has no ledger yet.' };
  else expenseEvent.paid_from = expenseMode;
  return { kind: 'post', event: expenseEvent };
}
/** an income chit → the other_income event, or the queue naming what is missing */
function incomeVerdict(ctx) {
  const { copy, business, base, till } = ctx;
  const x = business.income || {};
  const incomeAmount = roundMoney(Math.abs(Number(x.amount) || 0));
  const incomeMode = modeOf(x.mode) || 'cash';
  if (!incomeAmount) return { kind: 'queue', why: 'An income entry with no amount.' };
  if (incomeMode === 'credit') return { kind: 'queue', why: 'Income on credit is not posted from the counter.' };
  return {
    kind: 'post',
    event: Object.assign({}, base, {
      type: 'other_income',
      class: x.class || 'sundry_income',
      into: incomeMode,
      amount: incomeAmount,
      source_ref: 'chit:' + copy.chit_id,
      counter: till
    })
  };
}
/**
 * ⭐ ACC-263: a refund "On credit" is no money out — it takes the amount off what the customer owes (Dr returns · Cr debtors), the engine's
 * party path, as a sale on credit is Dr debtors. So the credit tender leaves `modes` (the engine would look for a "?credit" ledger). Mixed
 * with a money tender there is no single-event rule (engines L13), and with no customer there is no receivable: both wait, in words.
 * → the queue verdict, or null (modes changed in place)
 */
function creditRefundWait(modes, party) {
  if (modes.credit == null) return null;
  if (Object.keys(modes).length > 1) return { kind: 'queue', why: 'A credit note refunded partly on credit and partly in money has no ledger rule yet — issue it as two credit notes.' };
  if (!party) return { kind: 'queue', why: 'A credit note refunded on credit needs the customer whose balance it reduces — choose the customer.' };
  delete modes.credit;
  return null;
}
/**
 * ⭐ ACC-283: the gap between what was refunded and the note's own total, in minor units (carried figures, never recomputed): the refund parts the counter sent against the note's
 * by_rate total. 0 for a credit-only refund (no money tender) and for an equal refund.
 */
function refundGapMinor(refundModes, noteTotal, currency) {
  if (!Object.keys(refundModes).length) return 0;
  const refunded = roundMoney(Object.keys(refundModes).reduce((total, mode) => total + refundModes[mode], 0));
  return toMinor(refunded, currency) - toMinor(noteTotal, currency);
}
/**
 * ⭐ ACC-283: a refund that is not the note's total, and more than the pack's cash step explains, WAITS in words with the gap as data (as paymentGapWait does for a bill). A gap
 * inside the pack's HALF step (cashStepMinor: AU 5c -> 2c; IN, AE 0) is the cash round-off and posts: the engine's return rule takes it as round_off (engines v1.83.0), the
 * same ledger a sale's cash rounding uses. → the queue verdict, or null
 */
function refundGapWait(gapMinor, refundModes, noteTotal, currency, ref, setting) {
  if (Math.abs(gapMinor) <= cashStepMinor(booksPack(setting), refundModes)) return null;
  const refunded = toMinor(noteTotal, currency) + gapMinor;
  const moneyWords = (minor) => require('./cash-step').wordsOf(minor, currency); /* the currency's own decimals, trailing zeros kept: AUD 69.00 beside AUD 68.98 */
  const side = gapMinor < 0 ? 'less' : 'more';
  const sentence =
    'Credit note ' + ref + ' refunds ' + moneyWords(refunded) + ' but the note is ' + moneyWords(toMinor(noteTotal, currency)) + ': ' + moneyWords(Math.abs(gapMinor)) + ' ' + side +
    ' than the note. A difference this size is more than the cash coin step explains, so it waits. Record the difference by hand, or issue the refund at the total of the note.';
  return { kind: 'queue', gap_minor: gapMinor, why: sentence };
}
/** a credit note on my sale → return: the refund by tender, the customer, the bill it is against */
function saleReturnVerdict(ctx, byRate) {
  const { copy, business, base, till } = ctx;
  const refunds = modesOf(business.refund && business.refund.parts);
  if (refunds.unknown.length) return { kind: 'queue', why: 'Refunded by "' + refunds.unknown.join(', ') + '", which has no ledger yet.' };
  const party = partyFromCustomer(business.customer);
  const creditWait = creditRefundWait(refunds.modes, party);
  if (creditWait) return creditWait;
  const gapMinor = refundGapMinor(refunds.modes, byRate.total, ctx.currency);
  const gapWait = gapMinor ? refundGapWait(gapMinor, refunds.modes, byRate.total, ctx.currency, base.ref, ctx.setting) : null;
  if (gapWait) return gapWait;
  const returnEvent = Object.assign({}, base, {
    type: 'return',
    by_rate: byRate.rows,
    source_ref: 'chit:' + copy.chit_id,
    counter: till,
    against_bill: business.against || null
  });
  if (Object.keys(refunds.modes).length) returnEvent.refund = refunds.modes;
  if (gapMinor) returnEvent.round_off = gapMinor / Math.pow(10, MONEY.decimals(ctx.currency)); /* refund minus note, the engine's round_off (a sale's is charged minus lines) */
  if (!returnEvent.refund) {
    if (!party) return { kind: 'queue', why: 'A credit note with no refund and no known customer.' };
    returnEvent.party = party;
  }
  if (party && returnEvent.refund) returnEvent.party = party;
  return { kind: 'post', event: returnEvent };
}
/** a credit note → return (I sold) or purchase_return (I bought), or the queue naming what is missing */
function creditNoteVerdict(ctx, byRate) {
  const { copy, entry, base } = ctx;
  if (entry.sells) return saleReturnVerdict(ctx, byRate);
  const supplier = entry.seller && entry.seller.entity_id;
  if (!supplier) return { kind: 'queue', why: 'A supplier credit note with no supplier.' };
  return { kind: 'post', event: Object.assign({}, base, { type: 'purchase_return', party: String(supplier), by_rate: byRate.rows, source_ref: 'chit:' + copy.chit_id }) };
}
/**
 * a debit note (ACC-192 slice 2: a price RAISED after issue) → an extra sale by another name. Seller: the engine's debit_note event (Dr the party · Cr sales · Cr output tax, insert-only,
 * source_ref chit:<id>, the original untouched). Buyer: a purchase_bill from the same carried invoice (Dr purchases · Dr input tax · Cr the supplier), against_ref the note's own chit. No recompute at either side.
 */
function debitNoteVerdict(ctx, byRate) {
  const { copy, entry, base } = ctx;
  const invoice = entry.invoice;
  const total = roundMoney((invoice.ValDtls && invoice.ValDtls.TotInvVal) || byRate.total);
  const round_off = roundMoney(total - byRate.total);
  if (entry.sells) {
    const buyer = entry.buyer && entry.buyer.entity_id;
    if (!buyer) return { kind: 'queue', why: 'A debit note with no buyer on the rail.' };
    return { kind: 'post', event: Object.assign({}, base, { type: 'debit_note', party: String(buyer), by_rate: byRate.rows, paid: {}, round_off, source_ref: 'chit:' + copy.chit_id }) };
  }
  const supplier = entry.seller && entry.seller.entity_id;
  if (!supplier) return { kind: 'queue', why: 'A supplier debit note with no supplier.' };
  return { kind: 'post', event: Object.assign({}, base, { type: 'purchase_bill', party: String(supplier), by_rate: byRate.rows, paid: {}, round_off, source_ref: 'chit:' + copy.chit_id, against_ref: copy.chit_id }) };
}
/** the register rows an asset line makes → { asset }, or { wait } when the asset ledger or the kind of asset is missing (the bill then waits, named) */
function assetPlanOf(ctx, split, sentByOther) {
  const { input, entry, base, date } = ctx;
  const seller = sellerNameOf(sentByOther && entry.sells ? { seller: {} } : entry);
  if (!input.assets)
    return {
      wait: {
        kind: 'queue',
        wait: 'asset',
        why: 'An asset purchase needs the asset ledger — not posted yet (bill ' + base.ref + ' from ' + seller + ').'
      }
    };
  const assetClass = input.uses && input.uses.asset_class;
  if (!assetClass)
    return {
      wait: {
        kind: 'queue',
        wait: 'asset',
        why:
          'Which kind of asset is bill ' +
          base.ref +
          ' from ' +
          seller +
          '? Choose it (buildings, plant, furniture, vehicles, office or computers) on the bill, and it posts.'
      }
    };
  const names = ((input.uses && input.uses.lines) || []).filter((item) => item.use === 'asset').map((item) => item.name);
  const items = split.asset.map((item, index) => ({
    name: String(names[index] || item.PrdDesc || item.PrdNm || 'Asset from bill ' + base.ref).slice(0, 120),
    cost: roundMoney(item.AssAmt || 0)
  }));
  const lookup = new Map();
  items.forEach((x) => lookup.set(x.name, roundMoney((lookup.get(x.name) || 0) + x.cost)));
  return {
    asset: {
      class: assetClass,
      put_to_use: (input.uses && input.uses.put_to_use) || date,
      register: Array.from(lookup.entries()).map(([name, cost]) => ({ name, cost }))
    }
  };
}
/** a bill part for the shop's own use or an asset → its events (resale · asset · expense · payments), or the queue when reverse charge has nothing to ride */
function useEventsVerdict(ctx, invoice, parts) {
  const { copy, setting, currency, base } = ctx;
  const useResult = useEvents(copy, base, parts.supplier, parts.split, parts.paid, parts.round_off, parts.due, setting, parts.asset);
  if (!withRcm(useResult.events, invoice, currency))
    return {
      kind: 'queue',
      why: 'Bill ' + base.ref + ' is under reverse charge but none of it is bought for resale or as an asset — record its tax by hand (a journal entry).'
    };
  return { kind: 'post', supplier_check: true, ...useResult };
}
/** a counter bill another shop billed ME → purchase_bill (or use / asset events), once I accepted it and the seller is on my list */
function boughtCounterBillVerdict(ctx, invoice, byRate, sentByOther) {
  const { input, copy, entry, setting, business, currency, base } = ctx;
  const gate = buyerGate(input, sentByOther && entry.sells ? { seller: {} } : entry, base.ref);
  if (gate) return gate;
  const supplier = sentByOther ? String(copy.sender_entity_id) : entry.seller && entry.seller.entity_id ? String(entry.seller.entity_id) : null;
  if (!supplier) return { kind: 'queue', why: 'A bill from a counter with no seller on the rail.' };
  const nestedPay = modesOf(business.payment && business.payment.parts);
  if (nestedPay.unknown.length) return { kind: 'queue', why: 'Paid by "' + nestedPay.unknown.join(', ') + '", which has no ledger yet.' };
  const nestedCharged = roundMoney(Object.keys(nestedPay.modes).reduce((total, item) => total + nestedPay.modes[item], 0));
  delete nestedPay.modes.credit; /* the credit part is what the buyer owes — Creditors */
  const nestedRound_off = roundMoney(nestedCharged - byRate.total);
  const nestedGap = paymentGapWait(nestedCharged, byRate.total, invoice, nestedPay.modes, setting, currency, base.ref);
  if (nestedGap) return nestedGap;
  const nestedDue = termsDueDate(business);
  /* ⭐ WHAT THE GOODS ARE FOR (lib/bill-use, Athi 2026-10-01) — absent (a caller that did not ask) = all resale, as before */
  const split = usesSplit(input.uses, invoice);
  /* ⭐ AN ASSET WAITS UNTIL THE REGISTER EXISTS (b280, DRAFT) — then it posts to the class's PPE ledger and makes its register row.
     `input.assets` is postChit's answer to "is the register there?"; without it the same plain reason queues, as before. */
  let asset = null;
  if (split.asset.length) {
    const plan = assetPlanOf(ctx, split, sentByOther);
    if (plan.wait) return plan.wait;
    asset = plan.asset;
  }
  if (split.use.length || split.asset.length) return useEventsVerdict(ctx, invoice, { split, supplier, paid: nestedPay.modes, round_off: nestedRound_off, due: nestedDue, asset });
  /* counter null: it is the SELLER's counter, not one of mine */
  return {
    kind: 'post',
    supplier_check: true,
    event: Object.assign({}, base, {
      type: 'purchase_bill',
      party: supplier,
      by_rate: byRate.rows,
      paid: nestedPay.modes,
      round_off: nestedRound_off,
      counter: null,
      source_ref: 'chit:' + copy.chit_id,
      against_ref: copy.chit_id,
      due_date: nestedDue,
      rcm: rcmOf(invoice, currency)
    })
  };
}
/** the walk-in grain (day · shift · bill): the posting engine's rule; if it cannot answer, bill for a known party / credit / GSTIN, else the setting's own */
function walkinGrain(setting, party, credit, gstin) {
  let grain = 'day';
  try {
    const posting = E.posting();
    grain = posting.granularity ? posting.granularity({ setting: setting.walkin_grain, party, credit: credit > 0, gstin }) : grain;
  } catch (_) {
    grain = party || credit > 0 || gstin ? 'bill' : setting.walkin_grain || 'day';
  }
  return grain;
}
/** a walk-in bill: its own walkin_day entry at bill grain, else it waits for its counter's day close */
function walkinVerdict(ctx, byRate, figures) {
  const { copy, currency, base, date, till } = ctx;
  if (figures.grain === 'bill')
    return {
      kind: 'post',
      event: Object.assign({}, base, { type: 'walkin_day', modes: figures.modes, by_rate: byRate.rows, round_off: figures.round_off, counter: till, source_ref: 'bill:' + copy.chit_id })
    };
  return { kind: 'walkin', counter: till, day: date, bill: { currency: currency, pay: figures.modes, taxes: byRate.rows, round_off: figures.round_off } };
}
/** a counter bill, either side: the buyer's copy is a purchase (boughtCounterBillVerdict); mine is a walk-in (day or bill grain) or a sale_bill */
function counterBillVerdict(ctx, invoice, byRate) {
  const { copy, entry, setting, business, currency, base, date, till } = ctx;
  /**
   * ⚠️⚠️ WHO SOLD IT DECIDES THE SIDE (2026-10-01). This branch posted sale_bill without asking — so the BUYER's copy of a
   * counter bill (the same business_json) would have posted as the buyer's own SALE, or summed into the buyer's walk-in
   * day when its counter shared the id. A counter bill is SENT by the shop whose counter billed it, so a copy sent by
   * anyone but me is the buyer's, even when tax-copy's counter rule (a self chit naming a customer) calls it "sells".
   */
  const myId = entry.me && entry.me.entity_id ? String(entry.me.entity_id) : null;
  const sentByOther = !!(myId && copy.sender_entity_id && String(copy.sender_entity_id) !== myId);
  if (!entry.sells || sentByOther) return boughtCounterBillVerdict(ctx, invoice, byRate, sentByOther);
  return ownCounterBillVerdict(ctx, invoice, byRate);
}
/** a counter bill I billed: a walk-in (waits for the day close, or its own entry at bill grain) or a sale_bill to a known party / on credit / with a GSTIN */
function ownCounterBillVerdict(ctx, invoice, byRate) {
  const { copy, setting, business, currency, base, till } = ctx;
  const paidParts = modesOf(business.payment && business.payment.parts, true);
  if (paidParts.unknown.length) return { kind: 'queue', why: 'Paid by "' + paidParts.unknown.join(', ') + '", which has no ledger yet.' };
  const waitingMinor = Object.keys(paidParts.waiting).reduce((total, item) => total + paidParts.waiting[item], 0);
  const charged = roundMoney(Object.keys(paidParts.modes).reduce((total, item) => total + paidParts.modes[item], waitingMinor));
  const credit = paidParts.modes.credit || 0;
  delete paidParts.modes.credit;
  const round_off = roundMoney(charged - byRate.total);
  const gapWait = paymentGapWait(charged, byRate.total, invoice, paidParts.modes, setting, currency, base.ref);
  if (gapWait) return gapWait;
  /* FIN-58: a UPI part not yet seen to arrive is owed by whoever the bill names, else by the shop's system party "UPI waiting" — never the walk-in day, never the queue */
  const party = partyFromCustomer(business.customer) || waitingPartyOf(ctx, waitingMinor, credit);
  const gstin = business.customer && business.customer.gstin ? String(business.customer.gstin) : null;
  const grain = walkinGrain(setting, party, credit, gstin);
  if (credit > 0 && !party) return { kind: 'queue', why: 'An on-credit bill with no known customer — who owes it?' };
  if (!party && !gstin && credit <= 0) return walkinVerdict(ctx, byRate, { modes: paidParts.modes, round_off, grain });
  const dueDate = termsDueDate(business);
  return {
    kind: 'post',
    event: Object.assign({}, base, {
      type: 'sale_bill',
      party: party || undefined,
      by_rate: byRate.rows,
      paid: paidParts.modes,
      round_off,
      counter: till,
      source_ref: 'chit:' + copy.chit_id,
      against_ref: copy.chit_id,
      due_date: dueDate
    })
  };
}
/** FIN-58: the shop's system party when a UPI part waits and nobody is named (not with a credit part: that still asks "who owes it?"); null otherwise or when the shop is unknown */
function waitingPartyOf(ctx, waitingMinor, credit) {
  const shop = ctx.entry && ctx.entry.me && ctx.entry.me.entity_id;
  return waitingMinor > 0 && !(credit > 0) && shop ? require('./upi-waiting').partyIdOf(shop) : null;
}
/**
 * what stops a received supplier invoice posting yet: ⭐ OPS-81 MY RECEIPT already booked THEIR bill for this order (receiptFacts) — one payable, so this
 * invoice is the paper, not a second bill (none, done); else ⭐ the buyer's acceptance, like a counter bill received (buyerGate). null = it posts.
 */
function invoiceHold(input, entry, business, base) {
  if (input.theirReceipt && input.theirReceipt.entry_no) return { kind: 'none', done: true, why: receiptBookedWords(input.theirReceipt) };
  return buyerGate(input, entry, business.invoice_no || business.doc_no || base.ref);
}
/** OPS-81: the doubt a booked receipt leaves on an unnumbered invoice that posts anyway — one sentence on the entry and on the Payables row */
function doubtFields(receipt) {
  return receipt && receipt.doubt ? { narration: receipt.doubt, note: receipt.doubt } : {};
}
/** a rail invoice: I sold it → sale_bill to the buyer; I bought it → purchase_bill once accepted (buyerGate) */
function invoiceVerdict(ctx, invoice, byRate) {
  const { input, copy, entry, business, currency, base } = ctx;
  const total = roundMoney((invoice.ValDtls && invoice.ValDtls.TotInvVal) || byRate.total);
  const round_off = roundMoney(total - byRate.total);
  if (entry.sells) {
    const buyer = entry.buyer && entry.buyer.entity_id;
    if (!buyer) return { kind: 'queue', why: 'An invoice with no buyer on the rail — record it at the counter instead.' };
    return {
      kind: 'post',
      event: Object.assign({}, base, {
        type: 'sale_bill',
        party: String(buyer),
        by_rate: byRate.rows,
        paid: {},
        round_off,
        source_ref: 'chit:' + copy.chit_id,
        against_ref: copy.chit_id
      })
    };
  }
  const supplier = entry.seller && entry.seller.entity_id;
  if (!supplier) return { kind: 'queue', why: 'A supplier invoice with no supplier.' };
  const hold = invoiceHold(input, entry, business, base);
  if (hold) return hold;
  return {
    kind: 'post',
    supplier_check: true,
    event: Object.assign({}, base, {
      type: 'purchase_bill',
      party: String(supplier),
      by_rate: byRate.rows,
      paid: {},
      round_off,
      source_ref: 'chit:' + copy.chit_id,
      against_ref: copy.chit_id,
      rcm: rcmOf(invoice, currency)
    }, doubtFields(input.theirReceipt))
  };
}
/** the counter's day summary chit: a general chit whose business_json carries the summary object */
const isSummaryChit = (purpose, business) => purpose === 'general' && business.summary && typeof business.summary === 'object';
/** the counter's "money received" chit: its own R/… series, never a bill */
const isPaymentReceivedChit = (business) => business.kind === 'payment_received' && business.payment_received && typeof business.payment_received === 'object';
/** a "Mark paid" press: business_json.payment with a method and no tender parts (a counter bill's tender posts with its bill) */
const isMarkPaidChit = (business) => business.payment && typeof business.payment === 'object' && !Array.isArray(business.payment.parts) && business.payment.method;
/** the purposes whose event carries the chit's own day: without one nothing can be posted (and nothing is guessed) */
function needsDate(purpose, till, business, copy) {
  return purpose === 'expense' || purpose === 'income' || purpose === 'credit_note' || purpose === 'debit_note' || purpose === 'invoice' || (till && business.bill_no) || capturedOf(copy);
}
/** a counter bill's purpose: an order · offer · subscription, or the customer's copy ('invoice' + counter_bill) */
const isCounterBillPurpose = (purpose, business) => /^(order|offer|subscription)$/.test(purpose) || (purpose === 'invoice' && business.counter_bill === true);
/** the verdict of a note purpose: a credit note is a return · a debit note an extra sale (ACC-192) */
const NOTE_VERDICT = { credit_note: creditNoteVerdict, debit_note: debitNoteVerdict };
/**
 * classify({ chit, entry, setting, status?, disputed? }) → { kind: 'none' | 'walkin' | 'day' | 'post' | 'queue', event?, why?, counter?, day? }
 *   chit:     the copy (purpose, business_json, chit_id, created_at, currency_code, sender_entity_id, current_status)
 *   entry:    tax-copy entryFor(copy, me) — { sells, direction, invoice, seller, buyer, me }
 *   status:   my copy's chit status (default chit.current_status) — the buyer's acceptance (buyerGate)
 *   disputed: an open dispute on the chit (postChit reads it)
 * A purchase the buyer accepted comes back with `supplier_check: true`: postChit posts it only when the seller is on the
 * buyer's supplier list (never added automatically — Athi, 2026-10-01).
 */
function classify(input) {
  const copy = input.chit || {},
    entry = input.entry || {},
    setting = input.setting || {};
  const business = copy.business_json || {},
    purpose = String(copy.purpose || '');
  const currency = require('./country-setup').currencyStated(copy.currency_code, entry.invoice && entry.invoice.currency, setting.functional_currency); /* T2-NATDEF: none stated → null, never INR */
  const at = postingMoment(copy);
  const date = dayOf(at, setting); /* the shop's zone (setting.timezone, else its country) — M210 */
  const base = { source_chit_id: copy.chit_id, currency: currency, date, ref: business.bill_no || business.printed_as || copy.chit_id };
  const held = stopBeforeRules(input, copy, business, base); /* ACC-223: a cancelled / rejected copy never posts, whatever the purpose; then the money hold */
  if (held) return held;
  const till = business.till && business.till.id ? String(business.till.id) : null;

  const ctx = { input, copy, entry, setting, business, currency, base, date, till, at };

  /* the counter's day summary chit → the walk-in day of that counter */
  if (isSummaryChit(purpose, business)) return daySummaryVerdict(business, till);
  /* ⭐ MONEY RECEIVED AT THE COUNTER — its own numbered series, never a bill */
  if (isPaymentReceivedChit(business)) return paymentReceivedVerdict(ctx);
  /* ⭐ "MARK PAID" ON A CHIT (POST /chits/:id/payment → business_json.payment) — the books record it through recordPayment, the one path */
  if (isMarkPaidChit(business)) return markPaidVerdict(ctx);
  /* every event below carries the chit's own day — without one nothing can be posted (and nothing is guessed) */
  if (!date && needsDate(purpose, till, business, copy))
    return { kind: 'queue', why: 'The chit has no usable date.' };
  if (purpose === 'expense') return expenseVerdict(ctx);
  if (purpose === 'income') return incomeVerdict(ctx);

  /* ⭐ F10: my counter receipt with their bill no. and total IS their bill (receiptBill); a goods receipt without it posts nothing */
  if (purpose === 'receipt') return capturedOf(copy) ? receiptBill(input, copy, entry, setting, business, base, currency) : { kind: 'none' };

  const invoice = entry.invoice;
  if (!invoice) return { kind: 'none' };
  const byRate = byRateOf(invoice);
  const unposted = headsWait(invoice, byRate, setting, entry, base.ref);
  if (unposted) return unposted;
  const counterBill = !!(till && business.bill_no);

  if (NOTE_VERDICT[purpose]) return NOTE_VERDICT[purpose](ctx, byRate);

  /* ⭐ the CUSTOMER's copy of a counter bill reads 'invoice' + counter_bill (routes/chits.js billCopyFor) — still a counter
     bill: its payments at the counter are what was paid, so it takes this branch, never the invoice one (paid {}) */
  if (counterBill && isCounterBillPurpose(purpose, business)) return counterBillVerdict(ctx, invoice, byRate);

  if (purpose === 'invoice') return invoiceVerdict(ctx, invoice, byRate);
  return { kind: 'none' };
}

/** STD1: what a waiting row may ask of the owner (books-store TODO_SQL classifies a row parked before these existed) */
const TODOS = ['accept', 'add_supplier', 'record'];
/** a queue answer's todo · name · candidates, as the outbox row's event carries them */
function todoFields(verdict) {
  const todo = TODOS.indexOf(verdict && verdict.todo) >= 0 ? verdict.todo : 'record';
  const out = todo === 'add_supplier' ? { todo, name: verdict.name || null, candidates: Array.isArray(verdict.candidates) ? verdict.candidates.slice(0, 3) : [] } : { todo };
  if (verdict && verdict.short) out.short = shortOf(verdict.short); /* R106: a shortfall's figures ride the row as data (FIELDS waiting[].short) */
  return out;
}
/** the three shortfall figures, integers only — never the words (the row says them from the figures) */
function shortOf(figures) {
  if (!figures || typeof figures !== 'object') return null;
  const whole = (value) => Math.round(Number(value) || 0);
  return { theirs_minor: whole(figures.theirs_minor), ours_minor: whole(figures.ours_minor), short_minor: whole(figures.short_minor) };
}

/* ═══ the hooks ═════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * park it, with the reason — or say loudly that even that failed.
 * ⭐ STD1: the row says WHAT IT ASKS as data — `todo` 'accept' · 'add_supplier' · 'record' (the job's own, else 'record'), and for
 * add_supplier the typed supplier `name` (+ candidates). Every count and every screen reads these; none reads the sentence.
 */
async function park(entity, waitingJob, reason, chit_id, source_ref) {
  const event = Object.assign({}, waitingJob, { todo: TODOS.indexOf(waitingJob && waitingJob.todo) >= 0 ? waitingJob.todo : 'record' });
  if (event.todo !== 'add_supplier') {
    delete event.name;
    delete event.candidates;
  }
  try {
    await withEntity(entity, (db) => S.queue(db, entity, { source_chit_id: chit_id || null, source_ref: source_ref || null, event, why: reason }));
  } catch (e) {
    swallowed('outbox_lost');
    loggerOf().warn('books.outbox-failed', { entity_id: entity, chit_id, why: reason, error: String(e && e.message) });
    return;
  }
  loggerOf().warn('books.queued', { entity_id: entity, chit_id, why: reason });
}

/**
 * ⭐ recordChitPayment(db, entity, p, o) — the hook's ONE call into books.recordPayment for a payment a CHIT carries (the
 * counter's money chit; "Mark paid" on a chit), on the caller's handle — so a route's mark and the books' record are one
 * transaction. `p.against_chit` (the door's shape) names the bill it was paid against: when the books hold that bill open, the
 * allocation goes in the same call (never more than is left — the rest is an advance); a bill not posted yet (an order, a bill
 * still waiting) records on account, and propose/confirm settles it later. `o.warn` = the duplicate rule as the books route asks
 * it (W1 only when allocating; W3/W4 always) — the counter never asks (a walk-in's payment has nothing "owed").
 */
async function recordChitPayment(db, entity, payment, options) {
  const recorded = Object.assign({ by: options && options.by }, payment);
  delete recorded.against_chit;
  delete recorded.quoted_minor;
  if (payment.against_chit && payment.mode !== 'cheque') {
    const prop = await B.proposeFor(db, entity, { party: payment.party_id, direction: payment.direction, amount_minor: payment.amount_minor, currency: payment.currency });
    const billRow = prop.outstanding && prop.outstanding.by_ref ? prop.outstanding.by_ref[String(payment.against_chit)] : null;
    /* the bill the books hold (open or already settled): the allocation names it, so W1/W2 measure against THIS bill — a settled bill is an
       allocation of 0: nothing to settle, and W1 asks "nothing is owed" before ₹500 becomes a silent advance (critic on FIN-53, points 1 and 2) */
    if (billRow && billRow.kind === 'bill')
      recorded.allocations = [{ against_ref: String(payment.against_chit), amount_minor: Math.min(payment.amount_minor, Math.max(0, billRow.outstanding_minor)) }];
    /* paid against THIS chit, which the books do not hold yet (an order): an advance on purpose — not an offer to settle the party's other bills (W2 stays silent) */
    else recorded.allocate = 'none';
  }
  if (options && options.warn) recorded.warn = options.warn;
  return B.recordPayment(db, entity, recorded);
}
/** the door's refusals BEFORE a wait (FIN-52 a press for nothing, ledger on or off · FIN-55 a party on neither list, when the ledger is on): a wait is only for what a retry can post later */
async function refuseBeforeWait(db, entity, verdict, ledgerOn) {
  if (verdict.kind !== 'queue') return;
  if (verdict.refuse) throw B.refuse(verdict.why);
  if (ledgerOn && verdict.party) await B.partyOnList(db, entity, verdict.party);
}
/**
 * the ledger OFF: nothing is owed in any book, so "more than is owed" is read against the chit's QUOTE — through the same W2 helper and
 * the same acknowledgement rule as the ledger's gate (critic on FIN-53 re-review, point 1: one rule, no second calculation). THROWS
 * ALREADY_PAID (409) when the press is above the quote and the figure is not acknowledged; the route marks nothing.
 */
async function askAgainstQuote(verdict, options) {
  if (verdict.kind !== 'payment') return;
  const press = verdict.payment;
  if (!(press.quoted_minor > 0) || press.amount_minor <= press.quoted_minor) return;
  const warning = B.excessWarning(press.amount_minor, press.quoted_minor, press.currency, press.direction, (options && options.name) || 'this party');
  if (B.acknowledged(warning, B.acknowledgements(options && options.acknowledge))) return;
  const words = B.warningWords([warning], { direction: press.direction, amount_minor: press.amount_minor }, press.currency);
  throw Object.assign(new Error(words), { code: 'ALREADY_PAID', status: 409, warnings: [warning], title: B.warningTitle([warning]), direction: press.direction });
}
/**
 * the facts of a Mark-paid press, refused before any wait — with the ledger OFF too: a mark for ₹0 is wrong on any copy (finance, critic on
 * #504 point 3); the stranger rule is the LEDGER's rule, so with the ledger off a rail party not on my list may still be marked paid (the mark
 * is a note then, nothing is recorded). → { ledger (the setting, null when off), verdict (classify's answer) }
 */
async function markPaidFacts(db, entity, copy) {
  const ledger = await isOn(entity, db);
  const entry = await require('./tax-copy').entryFor(copy, entity);
  const verdict = classify({ chit: copy, entry, setting: ledger || {} });
  await refuseBeforeWait(db, entity, verdict, !!ledger);
  return { ledger, verdict };
}
/**
 * ⭐⭐ chitPaid(db, entity, copy, options) — THE DOOR (POST /chits/:id/payment; drift D1). `copy` is MY copy of the chit, already
 * carrying business_json.payment; classify names the party, the amount and the day; recordChitPayment records it on the
 * CALLER's handle (the route's mark and the books' record commit together or not at all). Answers, for the ledger's own state:
 *   { off: true }        no ledger — the copy still says paid, as the counter's money chit does
 *   { queued, why }      nobody the shop knows, no amount, a tender with no ledger — the route parks it after its commit, named;
 *                        the retry posts it through postChit, the SAME classify
 *   recordPayment's answer, + `outcome` (the words) — the replay of a chit already recorded says duplicate: true
 * THROWS what a person must answer: ALREADY_PAID (the duplicate rule, 409) and the books' refuse words (422): a press for nothing
 * (FIN-52) and a party on neither list (FIN-55) are refused HERE, before any wait — a wait is for what a retry can post later, and
 * neither of those ever posts; the mark is never written for them.
 */
async function chitPaid(db, entity, copy, options) {
  const { ledger: setting, verdict: verdict } = await markPaidFacts(db, entity, copy);
  if (!setting) {
    await askAgainstQuote(verdict, options);
    return { off: true };
  }
  if (verdict.kind === 'queue') return { queued: true, why: verdict.why };
  if (verdict.kind !== 'payment') return { none: true };
  const name = (options && options.name) || undefined;
  const rec = await recordChitPayment(db, entity, verdict.payment, { by: options && options.by, warn: { acknowledge: (options && options.acknowledge) || [], country: setting.country, name } });
  if (!rec.payment.duplicate) rec.outcome = await B.paymentOutcome(db, entity, verdict.payment, rec.payment.payment_id, rec.allocation, name);
  return rec;
}

/**
 * ⭐ H3 (PAY-FIX) · chitWithdrawn(db, entity, chit_id, reason, by) — A WITHDRAWN CHIT LEAVES THE BOOKS TOO. PUT /chits/:id/void and the
 * sender's own cancel (routes/chits moveStatus) call this on THEIR handle after the status gate wrote: the entry this chit posted
 * (source_ref chit:<id> — a sent invoice posts at send) is reversed in the SAME transaction (postEntry reversal, source_ref
 * reverse:<entry>), so Dues · sales · output tax drop it with the chit. Nothing posted → { none } (a walk-in bill rides its day;
 * counterBills leaves a cancelled one out before the day posts); reversed already → duplicate; the ledger off → { off }.
 * A books REFUSAL throws: the void route rolls the withdrawal back with it and says why (never a silent half).
 */
async function chitWithdrawn(db, entity, chit_id, reason, by) {
  const ledgerOn = await isOn(entity, db);
  if (!ledgerOn) return { off: true };
  const nestedPosted = await S.entryBySource(db, entity, 'chit:' + chit_id);
  if (!nestedPosted) return { none: true };
  const reversal = await B.postEntry(db, entity, {
    type: 'reversal',
    reverses: nestedPosted.entry_id,
    reason:
      'Withdrawn: ' +
      String(reason || '')
        .trim()
        .slice(0, 200),
    by,
    source_ref: 'reverse:' + nestedPosted.entry_id
  });
  return Object.assign({ reverses: nestedPosted.entry_no, reverses_entry_id: nestedPosted.entry_id }, reversal);
}

/** a refusal the books MEANT (a locked month, a refused rule) — as opposed to a failure that must surface as a 500 */
const isBooksRefusal = (err) => !!(err && (err.refused || /^(BOOKS_|PERIOD_|YEAR_)/.test(String(err.code || ''))));
/** chitWithdrawn for a leg that must not fail the move (the sender's cancel): a refusal comes back as { refused } in words, logged */
async function chitWithdrawnSaid(db, entity, chit_id, reason, by) {
  try {
    return await chitWithdrawn(db, entity, chit_id, reason, by);
  } catch (err) {
    if (!isBooksRefusal(err)) throw err;
    loggerOf().warn('books.withdraw-not-reversed', { chit_id, entity_id: entity, why: err.message });
    return { refused: err.message };
  }
}

/** a bill the supplier SENT me for the order this receipt is against (the receipt names their bill chit itself, or my order that it names as order.from) → { chit_id, no } | null */
async function theirInvoiceOf(db, entity, business) {
  const on = business.against && business.against.chit_id ? String(business.against.chit_id) : null;
  if (on) {
    const lookup = await db.query(
      `SELECT chit_id, COALESCE(business_json->>'bill_no', business_json->>'invoice_no', business_json->>'doc_no', manual_subject) AS no FROM chit_header
        WHERE entity_id = $1 AND purpose = 'invoice' AND sender_entity_id IS DISTINCT FROM $1
          AND (chit_id::text = $2 OR business_json->'order'->>'from' = $2) LIMIT 1`,
      [entity, on]
    );
    if (lookup.rows[0]) return { chit_id: String(lookup.rows[0].chit_id), no: lookup.rows[0].no || null };
  }
  return null;
}
/**
 * F10 · receiptFacts(db, entity, bj) → { party, theirInvoice } for my receipt of their bill, on the caller's handle:
 *   party         the supplier: the id the counter picked, else the ONE supplier on my list whose name is the name typed at the door
 *                 (case and spaces aside) — two of the same name is nobody, as at the counter (custKnown)
 *   theirInvoice  a bill the supplier SENT me for the same order — the receipt was against their bill chit itself, or against my order
 *                 that their counter bill names (business_json.order.from, lib/open-orders MARKS_SQL) — { chit_id, no }, else null
 */
async function receiptFacts(db, entity, business, copy) {
  /* OPS-81: the OTHER door of the same question — a received invoice asks whether my receipt already booked their bill */
  if (copy && !require('./tax-copy').capturedBill(copy, entity)) return { party: null, theirInvoice: null, candidates: [], theirReceipt: await bookedReceiptOf(db, entity, copy) };
  const out = { party: require('./tax-copy').capturedPartyId(business), theirInvoice: null, candidates: [] };
  const name = String((business.party && business.party.name) || '').trim();
  if (!out.party && name && name !== 'Not named') {
    /**
     * ⭐ STD1: ONE resolver (books-store supplierByName — bill-use.linkParty calls the same): exactly one by name or nickname is the party;
     * otherwise the shop's NEAR matches (FX-F10W), so "Sri Ganesh" is asked "Is this Sri Ganesh Provisions (P-00001)?" before a second
     * party is added beside it. ≤ 3, names + party_no only — the link is made by PUT /chits/:id/use { party }, which resolves it again.
     */
    const found = await S.supplierByName(db, entity, { name });
    if (found.one) out.party = found.one.party_id;
    else out.candidates = found.near;
  }
  out.theirInvoice = await theirInvoiceOf(db, entity, business);
  return out;
}

/** the sentence a booked receipt answers a later invoice with — it names the receipt, their bill number and the first entry */
function receiptBookedWords(receipt) {
  return 'Receipt ' + (receipt.no || receipt.chit_id) + ' already booked their bill (entry ' + receipt.entry_no + ') — this invoice is the paper, not a second payable.';
}
/** a supplier invoice sent TO me (a copy I did not send) */
const isInvoiceReceived = (copy, entity) => String(copy.purpose || '') === 'invoice' && String(copy.sender_entity_id) !== String(entity);
/** a bill number compared the way people read it: case and spaces aside; '' when none */
const billNoOf = (business) => String(business.bill_no || business.invoice_no || business.doc_no || '').replace(/ +/g, '').toUpperCase();
/**
 * OPS-81 · is this invoice the bill a booked receipt already holds? → 'yes' | 'no' | 'doubt'. Both numbered: the numbers decide (two PARTIAL bills on one order are
 * two bills). A number missing on either side: the same bill only when the totals are known and equal (the engine total, counter-bill pickOf, against their_bill.total);
 * otherwise it posts, and 'doubt' says so in the posting's words — an unknown total is never equal, so a bill is never silently swallowed.
 */
function sameBillWords(invoiceNo, receiptNo, invoiceTotal, receiptTotal) {
  if (invoiceNo && receiptNo) return invoiceNo === receiptNo ? 'yes' : 'no';
  return invoiceTotal > 0 && receiptTotal > 0 && invoiceTotal === receiptTotal ? 'yes' : 'doubt';
}
/**
 * OPS-81 · bookedReceiptOf(db, entity, copy) → { chit_id, no, entry_id, entry_no } | null — MY receipt of their bill for the same order that the
 * books already hold (an entry under its own source_ref chit:<id> that nothing has reversed). Two PARTIAL bills naming one order are two bills: when both papers carry a number and the numbers differ, it is not the same bill. The mirror of receiptFacts' theirInvoice: that one
 * stops the receipt when their invoice came first, this one stops the invoice when the receipt came first. Only a received invoice asks.
 */
async function bookedReceiptOf(db, entity, copy) {
  const business = copy.business_json || {};
  const ids = [String(copy.chit_id), business.order && business.order.from ? String(business.order.from) : null].filter(Boolean);
  const receipts = await S.receiptBillsAgainst(db, entity, ids);
  const theirs = quotedOf(copy);
  let doubt = null;
  for (const row of receipts) {
    const same = sameBillWords(billNoOf(business), billNoOf({ bill_no: row.no }), theirs, Number(row.total));
    if (same === 'yes') return { chit_id: String(row.chit_id), no: row.no || null, entry_id: row.entry_id, entry_no: row.entry_no };
    if (same === 'doubt') doubt = doubt || { doubt: 'Receipt ' + (row.no || row.chit_id) + ' booked a bill for this order; this invoice has no bill number to match it and a different total, so it posts as its own bill — check it is not a duplicate.' };
  }
  return doubt;
}
/**
 * ⭐ ORD-FIX O4 — A BILL I ACCEPTED AND THEN REJECTED / CANCELLED TAKES ITS POSTING BACK. The rail allows accepted → rejected (damaged stock found
 * the next day); the purchase, the creditor and the input tax were already in the books and the screen said "not posted". The bill's own entries
 * (source_ref chit:<id>…, not reversed yet) are reversed through the ONE reversal writer (books.reverseEntry → postEntry, idempotent on
 * reverse:<entry>), with the status as the reason. A payment made against the bill is NOT touched — it has its own entry to reverse by hand.
 * → number of entries reversed (0 when nothing had posted — the usual case).
 * ACC-223 / 238: an optional `said` object is filled with what happened ({ done: [each reversal the books answered], duplicate: true when a lost race found the reversal already there }),
 * so the cancel door can SAY it on the 200 without a second lookup. A race the other doer won (journal_entry_src_uq, 23505 on reverse:<entry>) is a duplicate, never a failure.
 */
async function reverseIfPosted(entity, chit_id, reason, by, said) {
  const entryIds = await withEntity(entity, (db) => S.unreversedForChit(db, entity, chit_id));
  const told = said || { done: [] };
  let reversed = 0;
  for (const entry_id of entryIds) reversed += await reverseOne(entity, entry_id, reason, by, told);
  return reversed;
}
/** the writer's answer for one reversal, kept on `told` → 1 when it reversed, 0 when it was already reversed (or the books are off) */
function noteReversal(told, answer) {
  if (!answer || !answer.ok) return 0;
  if (answer.duplicate) {
    told.duplicate = true;
    return 0;
  }
  told.done.push(answer);
  return 1;
}
/** one entry reversed through the one writer → 1 when this call reversed it, 0 when it was already (a lost race on journal_entry_src_uq, 23505 on reverse:<entry>, is a duplicate, never a failure) */
async function reverseOne(entity, entry_id, reason, userId, told) {
  try {
    const answered = await B.reverseEntry(null, entity, entry_id, { by: userId, reason });
    if (answered && answered.duplicate) told.found = entry_id; /* the entry the other doer reversed: takeBackCancelled reads its reversal */
    return noteReversal(told, answered);
  } catch (failure) {
    if (!(failure && failure.code === '23505')) throw failure;
    told.duplicate = true;
    told.found = entry_id;
    return 0;
  }
}
/** ACC-238 F1: the reversal the other doer already made for this entry (reverse:<entry_id>, the existing store read), in a fresh reversal's shape plus already: true */
async function alreadyReversed(entity, entry_id) {
  const [reversal, orig] = await withEntity(entity, async (db) => [await S.entryBySource(db, entity, 'reverse:' + entry_id), await S.entry(db, entity, entry_id)]);
  if (!reversal || !orig) return { duplicate: true };
  const date = E.ymd(reversal.posting_date);
  return { ok: true, already: true, duplicate: true, entry_id: reversal.entry_id, entry_no: reversal.entry_no, posting_date: date, moved: date !== E.ymd(orig.posting_date), reverses: orig.entry_no, reverses_entry_id: entry_id, words: 'Already reversed ' + orig.entry_no + ' — by ' + reversal.entry_no + '.' };
}

/**
 * RAIL-173 · did the books already take this chit's posting back? The status door asks it before a rejected / cancelled copy moves on: chit:<id> posts once ever, so a bill whose
 * reversal is in the books cannot come back to life. → true only when the ledger is on AND chit:<id> posted AND reverse:<entry> exists; off / never posted / not reversed → false.
 * `db`: the handle the caller already holds (the status move reads inside its own transaction). Read only.
 */
async function wasTakenBack(entity, chit_id, db) {
  if (!(await isOn(entity, db))) return false;
  const read = async (handle) => {
    const posted = await S.entryBySource(handle, entity, 'chit:' + chit_id);
    return !!(posted && (await S.entryBySource(handle, entity, 'reverse:' + posted.entry_id)));
  };
  return db ? read(db) : withEntity(entity, read);
}

/** is this a counter bill I bought, accepted, and not mine to post yet — i.e. does its use (resale · asset · expense) need asking? */
function asksUse(copy, entity, businessJson, mine) {
  const taxCopy = require('./tax-copy');
  if (mine) return false;
  return taxCopy.counterIssued(businessJson) && taxCopy.billReceived(copy, entity) && ACCEPTED.test(String(copy.current_status || ''));
}

/** the bill's use (resale · asset · expense) for a counter bill I bought — asked only once it is mine to post; a catalogue that cannot be read parks the bill, named. → { uses } | { parked } */
async function readUses(entity, chit_id, copy, businessJson, mine, options) {
  if (!asksUse(copy, entity, businessJson, mine)) return { uses: undefined };
  try {
    return { uses: await require('./bill-use').forCopy(entity, copy) };
  } catch (e) {
    const reason = e && e.message ? e.message : String(e);
    const waitingWords = 'Could not read your catalogue to tell what bill ' + (businessJson.bill_no || '') + ' is for (' + reason + ') — it posts on the next try';
    if (!options.retry)
      await park(
        entity,
        { job: 'chit', chit_id, kind: 'purchase', ref: businessJson.bill_no || null, counter: null, waiting: 'use' },
        waitingWords,
        chit_id,
        'chit:' + chit_id
      );
    return { parked: { queued: true, why: waitingWords } };
  }
}

/**
 * ORD-FIX O4 — the refused branch of postChit: a bill the buyer rejected / cancelled that had posted when it was accepted gets its posting reversed first
 * (k.why is reworded to say so). → null to carry on and close the Waiting row, or a queued answer when the reversal failed (the row stays open to retry).
 * ACC-238: the cancel door (takeBackCancelled) calls this SAME function for the entity's own cancelled copy — there is no other reversal path; `said` is passed on to reverseIfPosted.
 */
async function takeBackRefused(entity, chit_id, copy, verdict, by, said) {
  if (!(verdict.kind === 'none' && verdict.done && REFUSED.test(String(copy.current_status || '')))) return null;
  try {
    const undone = await reverseIfPosted(entity, chit_id, verdict.why + ' (it had been posted)', by, said);
    if (undone) verdict.why = verdict.why.replace(' — not posted', ' — its posting was reversed');
    return null;
  } catch (e) {
    cbLog.fellBack('books-hooks postChit: the reversal of a rejected bill failed — left open to try again', e);
    return { queued: true, why: 'This was cancelled or rejected after it posted, and its posting could not be reversed yet — it tries again.' };
  }
}

/**
 * ACC-238 · THE STATUS DOOR'S BOOKS CALL: I cancelled MY copy (sender, a recipient, a self-sale) → whatever the entity posted for it is taken back, through takeBackRefused → reverseIfPosted
 * (the one reversal; postChit reaches the same pair for a retry / the nightly / a post that raced the cancel). Keyed by the ENTITY, never by a copy. Own books only. Said on the 200 as `books`:
 * the reversal ({ ok, reverses, entry_no, posting_date, moved, words }) · { none } nothing was posted · { duplicate } already reversed · { off } books off · { refused } in words (the cancel stands, the row waits).
 */
async function takeBackCancelled(entity, chit_id, by) {
  if (!(await isOn(entity))) return { off: true };
  const said = { done: [] };
  const stuck = await takeBackRefused(entity, chit_id, { current_status: 'cancelled' }, refusedNone({ status: 'cancelled' }), by, said);
  if (stuck) return { refused: stuck.why };
  if (said.done.length) return Object.assign({}, said.done[0], { ok: true, reversed: said.done.length });
  if (said.duplicate && said.found) return alreadyReversed(entity, said.found);
  if (said.duplicate) return { duplicate: true };
  /* the hook finished first: nothing unreversed is left, yet the chit DID post — say its reversal, `none` only when it never posted */
  const posted = await withEntity(entity, (db) => S.entryBySource(db, entity, 'chit:' + chit_id));
  const told = posted && (await alreadyReversed(entity, posted.entry_id));
  return told && told.already ? told : { none: true };
}

/** the tax entry of my copy ({} for the purposes that carry none: expense · income · a summary · money received); a sale by a shop that never stated its registration is marked unknown */
async function entryOf(entity, copy, business, taxCopy) {
  return copy.purpose === 'expense' || copy.purpose === 'income' || business.summary || business.kind === 'payment_received'
    ? {}
    : await withRegistration(entity, await taxCopy.entryFor(copy, entity));
}
/** is this copy mine to sell (a sale I issued), as against a bill another shop sent me? */
function isMine(entry, copy) {
  return !!entry.sells && !(entry.me && entry.me.entity_id && copy.sender_entity_id && String(copy.sender_entity_id) !== String(entry.me.entity_id));
}
/** the asset register exists? (b280 is a DRAFT) — asked only for a bill with an asset line; a failed read is "no", so it queues as before */
async function assetRegisterExists(entity, uses) {
  let assets = false;
  if (uses && uses.lines && uses.lines.some((item) => item.use === 'asset'))
    assets = await withEntity(entity, (db) => Assets.exists(db, entity)).catch(cbLog.orElse('books-hooks postChit: the read failed — answered no', false));
  return assets;
}
/** the receipt-of-their-bill facts classify reads (party · theirInvoice · candidates); all undefined when the chit is not such a receipt */
function receiptFields(receiptInfo) {
  return {
    party: receiptInfo ? receiptInfo.party : undefined,
    theirInvoice: receiptInfo ? receiptInfo.theirInvoice : undefined,
    theirReceipt: receiptInfo ? receiptInfo.theirReceipt : undefined,
    candidates: receiptInfo ? receiptInfo.candidates : undefined
  };
}
/**
 * MY copy of one chit, read and classified → { copy, business, entry, verdict }, or { early } when there is nothing to classify (no such copy) or the bill's use could not be
 * read (it parks, named). Reads only; the post is postChit's.
 */
async function readAndClassify(entity, chit_id, setting, options) {
  const taxCopy = require('./tax-copy');
  const copy = await taxCopy.copyOf(chit_id, entity);
  if (!copy) return { early: { none: true } };
  let business = copy.business_json || {};
  /* ⭐ F10: my receipt of their bill — which supplier it is, and whether their own invoice for the same order is already here
     (ONE transaction, two reads; only for a receipt that carries their bill) */
  let receiptInfo = null;
  if (taxCopy.capturedBill(copy, entity) || isInvoiceReceived(copy, entity)) {
    receiptInfo = await withEntity(entity, (db) => receiptFacts(db, entity, business, copy));
    if (receiptInfo.party && !taxCopy.capturedPartyId(business))
      copy.business_json = business = Object.assign({}, business, { party: Object.assign({}, business.party, { party_id: receiptInfo.party }) });
  }
  const entry = await entryOf(entity, copy, business, taxCopy);
  /* ⭐ a bill I RECEIVED waits for my acceptance and for any open dispute to settle (buyerGate) — the dispute is read
     only for a copy that is not mine to sell, so the seller's hot path costs nothing more */
  const mine = isMine(entry, copy);
  const disputed = entry.invoice && !mine ? (await withEntity(entity, (db) => S.openDisputes(db, entity, chit_id))) > 0 : false;
  /**
   * ⭐ WHAT A COUNTER BILL I BOUGHT IS FOR (lib/bill-use) — asked only once it is mine to post (accepted): the buyer's
   * choice, else my own catalogue line by line. A catalogue that cannot be read parks the bill, named — never "all expense".
   */
  const usesRead = await readUses(entity, chit_id, copy, business, mine, options);
  if (usesRead.parked) return { early: usesRead.parked };
  const uses = usesRead.uses;
  const assets = await assetRegisterExists(entity, uses);
  const verdict = classify({
    chit: copy,
    entry,
    setting,
    status: copy.current_status,
    disputed,
    uses,
    assets,
    ...receiptFields(receiptInfo)
  });
  return { copy, business, entry, verdict: (await originalWait(entity, copy, verdict)) || verdict };
}
/**
 * ⭐ ACC-192: A DEBIT NOTE POSTS AFTER THE INVOICE IT RAISES (PLAN §8.2 item 5) — a note that reaches the books before the original (a late sync, a buyer still to accept the invoice) is queued, named,
 * and the next retry posts it. → a queue verdict, or null (not a debit note · nothing to post · the original's entry exists, under chit:<id> or one of its parts chit:<id>:…).
 */
async function originalWait(entity, copy, verdict) {
  const against = copy.purpose === 'debit_note' && verdict.kind === 'post' && copy.business_json && copy.business_json.against;
  if (!against || !against.chit_id) return null;
  if (await withEntity(entity, (db) => S.chitPosted(db, entity, against.chit_id))) return null;
  return { kind: 'queue', wait: 'original', why: 'The invoice this debit note raises' + (against.invoice_no ? ' (' + against.invoice_no + ')' : '') + ' is not in the books yet, so the note waits for it and posts after it.' };
}
/** the Waiting row carries what the screen needs to open the chit (waitingRow → source) */
function waitingJobOf(chit_id, business, verdict) {
  return Object.assign(
    verdict.wait || verdict.supplier_check
      ? {
          job: 'chit',
          chit_id,
          kind: 'purchase',
          ref: business.bill_no || business.printed_as || business.invoice_no || (business.their_bill && business.their_bill.no) || null,
          counter: null,
          waiting: verdict.wait || 'supplier'
        }
      : { job: 'chit', chit_id },
    todoFields(verdict)
  );
}
/**
 * ⚠️⚠️ THE SELLER MUST BE ON MY SUPPLIER LIST (Athi, 2026-10-01: "it should not be automatic"). Never added here —
 * the purchase waits, named, and posts on the next retry / nightly sweep once the owner has added them.
 * (A duplicate of an entry already posted is answered by postEntry before this matters — the check runs first only
 *  because a party that left the list must not receive a NEW bill.)
 */
async function supplierCheck(entity, chit_id, facts, options) {
  const { verdict, entry, waitingJob } = facts;
  const nestedDone = await withEntity(entity, (db) => S.entryBySource(db, entity, verdict.event.source_ref));
  /* several events (a bill partly for use): a duplicate only when EVERY one has posted — a retry posts the rest */
  let allDone = !!nestedDone;
  if (allDone && verdict.events && verdict.events.length > 1) {
    /* ONE read for the rest (postedSources), never one per event */
    const rest = verdict.events.slice(1).map((item) => item.source_ref);
    const postedList = await withEntity(entity, (db) => S.postedSources(db, entity, rest));
    allDone = rest.every((item) => (postedList || []).indexOf(item) >= 0);
  }
  if (allDone) {
    /* a register row that failed on the first try is made now — idempotent on (entry, name) */
    for (const event of verdict.events || [verdict.event])
      if (event && event.asset_register)
        await registerAssets(entity, event, await withEntity(entity, (db) => S.entryBySource(db, entity, event.source_ref)), chit_id, options);
    return { ok: true, duplicate: true, entry_id: nestedDone.entry_id, entry_no: nestedDone.entry_no };
  }
  const on = await withEntity(entity, (db) => S.partyOn(db, entity, verdict.event.party));
  if (!on || !on.supplier) {
    const text = sellerNameOf(entry.sells ? null : entry) + ' is not on your supplier list — add them, then this posts';
    const named = text.charAt(0).toUpperCase() + text.slice(1);
    if (!options.retry) await park(entity, waitingJob, named, chit_id, 'chit:' + chit_id);
    return { queued: true, why: named };
  }
  return null;
}
/** a day summary chit: post its counter's walk-in day, and close the chit once the day is in the books */
async function postDayChit(entity, chit_id, verdict, setting, options) {
  const dayResult = await postDay(entity, verdict.counter, verdict.day, { setting: setting, retry: options.retry, by: options.by });
  /* the day summary chit is done once its day is in the books (posted, already posted, or nothing to post) */
  if (posted(dayResult)) await closeDone(entity, [chit_id], 'The day is posted — done');
  return dayResult;
}
/** a payment verdict: recorded through the one path; a failure parks it (a retry throws it back) */
async function postPaymentChit(entity, chit_id, verdict, options) {
  try {
    return await withEntity(entity, (db) => recordChitPayment(db, entity, verdict.payment, { by: options.by }));
  } catch (e) {
    if (options.retry) throw e;
    await park(entity, { job: 'chit', chit_id }, String((e && e.message) || e), chit_id, 'chit:' + chit_id);
    return { queued: true, why: String((e && e.message) || e) };
  }
}
/**
 * a walk-in bill whose day is ALREADY posted and does not NAME it is a late bill: its own catch-up entry for that
 * day, never a rewrite of the day (SPEC-books v1, the late-bill rule).
 * ⚠️⚠️ "LATE" IS DECIDED BY THE DAY'S OWN LIST (critic M7), not by comparing times: a bill in flight when the day was
 *   read has an EARLIER created_at and was still not in the read — it answered "waiting: day close" for ever.
 *   (An entry with no list — none is written any more — falls back to the old comparison.)
 */
async function postWalkinChit(entity, chit_id, facts, options) {
  const { verdict, copy, setting } = facts;
  const dayEntry = await withEntity(entity, (db) => S.entryBySource(db, entity, 'walkin:' + verdict.counter + ':' + verdict.day));
  if (!dayEntry) return waitsForDayClose(entity, chit_id, verdict);
  const covered = Array.isArray(dayEntry.source_chit_ids)
    ? dayEntry.source_chit_ids.map(String).indexOf(String(chit_id)) >= 0
    : new Date(dayEntry.created_at) >= new Date(copy.created_at);
  if (covered) {
    await closeDone(entity, [chit_id], 'Posted in the day summary — done');
    return { ok: true, covered: true, entry_no: dayEntry.entry_no };
  }
  const lateEvent = Object.assign(E.posting().daySummary([verdict.bill], { ref: 'late ' + chit_id, date: verdict.day, counter: verdict.counter }, { pack: booksPack(setting) }), {
    source_ref: 'walkin-late:' + chit_id,
    source_chit_id: chit_id,
    counter: verdict.counter,
    by: options.by,
    narration: 'A walk-in bill that arrived after its day was posted'
  });
  const late = await postOrPark(entity, lateEvent, { job: 'chit', chit_id }, options);
  if (posted(late)) await closeDone(entity, [chit_id], 'Posted as a late walk-in — done');
  return late;
}
/** the bill's events, each through the one writer: a return finds the bill it is against; several events post in turn; the acceptance closes the Waiting row */
async function postEvents(entity, chit_id, verdict, options) {
  if (verdict.event.type === 'return' && verdict.event.against_bill && verdict.event.party) {
    const orig = await withEntity(entity, (db) =>
      db.query(`SELECT chit_id FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND business_json->>'bill_no' = $2 LIMIT 1`, [
        entity,
        String(verdict.event.against_bill)
      ])
    );
    if (orig.rows[0]) verdict.event.against_ref = orig.rows[0].chit_id;
  }
  delete verdict.event.against_bill;
  if (verdict.events && verdict.events.length > 1) {
    /* ⭐ in turn, each through the one writer (idempotent on its own source); the first failure parks the bill and
       stops — a retry finds what posted as duplicates and posts the rest */
    const nestedPosted = [];
    for (const event of verdict.events) {
      const outcome = await postOrPark(entity, Object.assign(event, { by: options.by }), { job: 'chit', chit_id }, options);
      await registerAssets(entity, event, outcome, chit_id, options);
      nestedPosted.push(Object.assign({ type: event.type, source_ref: event.source_ref }, outcome));
      if (outcome && outcome.queued) return Object.assign({ queued: true, why: outcome.why }, { posted: nestedPosted });
    }
    if (verdict.supplier_check) await closeDone(entity, [chit_id], 'Accepted — posted to the books');
    return Object.assign({ ok: true }, nestedPosted[0], { posted: nestedPosted });
  }
  const done = await postOrPark(entity, Object.assign(verdict.event, { by: options.by }), { job: 'chit', chit_id }, options);
  await registerAssets(entity, verdict.event, done, chit_id, options);
  if (verdict.event.type === 'walkin_day' && posted(done)) await closeDone(entity, [chit_id], 'Posted as a walk-in entry — done');
  /* FX-F10W2: the acceptance that posted a bill I received closes its own Waiting row (no retry needed) */
  else if (verdict.supplier_check && posted(done)) await closeDone(entity, [chit_id], 'Accepted — posted to the books');
  return done;
}
/** one chit, read as MY copy and classified; returns what happened (never throws) */
async function postChit(entity, chit_id, opt) {
  const options = opt || {};
  const setting = options.setting || (await isOn(entity));
  if (!setting) return { off: true };
  try {
    const read = await readAndClassify(entity, chit_id, setting, options);
    if (read.early) return read.early;
    const { copy, business, entry, verdict } = read;
    /* F10: their invoice is the bill — the receipt is the goods record, done, with the sentence that says why (the ONE status writer) */
    const stuck = await takeBackRefused(entity, chit_id, copy, verdict, options.by);
    if (stuck) return stuck;
    if (verdict.kind === 'none' && verdict.done) {
      await closeDone(entity, [chit_id], verdict.why);
      return { none: true, why: verdict.why };
    }
    if (verdict.kind === 'none') {
      /* a week / month summary chit is the record itself — nothing to post, nothing left to wait for */
      if (purpose0(copy) === 'general' && copy.business_json && typeof copy.business_json.summary === 'object')
        await closeDone(entity, [chit_id], 'A summary — filed');
      return { none: true };
    }
    const waitingJob = waitingJobOf(chit_id, business, verdict);
    /* a retry hands back what the wait asks (todo · name · candidates) too: the outbox row's event follows the bill (retryOutbox → outboxDone) */
    if (verdict.kind === 'queue') {
      if (!options.retry) await parkAndTell(entity, waitingJob, verdict, chit_id, copy);
      return Object.assign({ queued: true, why: verdict.why, wait: waitingJob.waiting || null }, todoFields(waitingJob));
    }
    if (verdict.supplier_check && verdict.event && verdict.event.party) {
      const refused = await supplierCheck(entity, chit_id, { verdict, entry, waitingJob }, options);
      if (refused) return refused;
    }
    if (verdict.kind === 'day') return await postDayChit(entity, chit_id, verdict, setting, options);
    if (verdict.kind === 'payment') return await postPaymentChit(entity, chit_id, verdict, options);
    if (verdict.kind === 'walkin') return await postWalkinChit(entity, chit_id, { verdict, copy, setting }, options);
    return await postEvents(entity, chit_id, verdict, options);
  } catch (e) {
    if (!options.retry) await park(entity, { job: 'chit', chit_id }, String((e && e.message) || e), chit_id, 'chit:' + chit_id);
    return { queued: true, why: String((e && e.message) || e) };
  }
}
/**
 * ⭐ THE REGISTER ROW FOLLOWS THE POSTED PURCHASE (year-book §9 gap 4): once an asset purchase has an entry (or answers a duplicate of one),
 * each of its assets is added to the register — idempotent on (entry, name), so a retry makes no second row. A failure here never fails
 * the bill (the books are right; the entry exists): it is logged, and the next retry of the chit makes the row.
 */
async function registerAssets(entity, event, postedEntry, chit_id, options) {
  if (!event || !Array.isArray(event.asset_register) || !postedEntry || !postedEntry.entry_id) return;
  try {
    const currency = event.currency || null;
    await withEntity(entity, async (db) => {
      for (const assetRow of event.asset_register) {
        await Assets.add(db, entity, {
          name: assetRow.name,
          asset_class: event.asset_class,
          cost_minor: Math.round(assetRow.cost * Math.pow(10, MONEY.decimals(currency))),
          currency: currency,
          put_to_use: event.put_to_use,
          source_entry_id: postedEntry.entry_id,
          source_chit_id: chit_id,
          by: options && options.by
        });
      }
    });
  } catch (e) {
    loggerOf().warn('books.asset-register-failed', { entity_id: entity, chit_id, error: String(e && e.message) });
  }
}
/** post one event through the one writer; a failure parks it, named (a retry throws it back instead) */
async function postOrPark(entity, event, waitingJob, options) {
  try {
    const result = await B.postEntry(null, entity, event);
    return result;
  } catch (e) {
    if (!options.retry) await park(entity, waitingJob, String((e && e.message) || e), event.source_chit_id, event.source_ref);
    if (options.retry) throw e;
    return { queued: true, why: String((e && e.message) || e) };
  }
}

/* W2-RAIL R2: the status words are the ONE table (lib/rail-actions OPEN_STATES, read off the rail's transitions) — never spelled here */
const { OPEN_STATES } = require('./rail-actions');
const mover = { fn: null };
/**
 * ⭐ THE END OF A COUNTER'S OWN CHIT (Athi, 2026-10-09: "stuck ideally zero"). The till sends every counter sale — and every day / week /
 * month summary — as a chit to its OWN shop. Nobody can answer it, so it sat open until overdue_days and Home called it stuck. The sale
 * is DONE when the books hold it: covered by the walk-in day entry (or its own walk-in entry, or the late catch-up). A summary chit is
 * done when its day is posted (a week / month one has no entry: it is the record). Done = the shop's own received copy moves to
 * 'completed' through moveStatus — the ONE status writer PUT /chits/:id/status runs, never a second path.
 * Only a copy that is still OPEN and was SENT BY THIS SHOP moves: a cancelled or rejected one is never revived, and a chit from anyone
 * else is not ours to close. Never throws (a failed close leaves it open, logged — the next retry / nightly sweep tries again).
 * ids → how many moved. `H._mover` lets a test stand in for the route's moveStatus.
 */
async function closeDone(entity, ids, note) {
  const list = Array.from(new Set((ids || []).filter(Boolean).map(String)));
  if (!list.length) return 0;
  let moved = 0;
  /* ⭐ FX-F10W2: THE CHIT'S OWN WAITING ROW CLOSES IN THE SAME PATH — accepted and posted, rejected, their invoice is the bill — with the
     sentence that says why (books-store outboxClose, one statement). Before, only "Try again" or the nightly retry closed it. */
  try {
    await withEntity(entity, (db) => S.outboxClose(db, entity, list, note || 'Posted to the books — done'));
  } catch (e) {
    loggerOf().warn('books.outbox-close-failed', { entity_id: entity, ids: list, error: String(e && e.message) });
  }
  try {
    const unfinished = await withEntity(entity, (db) =>
      db.query(
        `SELECT cs.chit_id FROM chit_status cs JOIN chit_header h ON h.chit_id = cs.chit_id AND h.entity_id = cs.entity_id
        WHERE cs.entity_id = $1 AND cs.direction = 'received' AND h.sender_entity_id = $1
          AND cs.chit_id = ANY($2::uuid[]) AND cs.current_status = ANY($3::text[])`,
        [entity, list, OPEN_STATES]
      )
    );
    const moveChit = mover.fn || require('./chit-move').moveStatus;
    for (const x of unfinished.rows) {
      try {
        const res = await moveChit(entity, x.chit_id, 'completed', { id: entity, name: 'The books' }, note || 'Posted to the books — done', {
          level: 'editor',
          holder: null
        });
        if (res && res.moved !== false && (res.code === undefined || res.code === 200)) moved++;
      } catch (e) {
        loggerOf().warn('books.close-failed', { entity_id: entity, chit_id: x.chit_id, error: String(e && e.message) });
      }
    }
  } catch (e) {
    loggerOf().warn('books.close-read-failed', { entity_id: entity, error: String(e && e.message) });
  }
  return moved;
}
/** the walk-in post's outcome counts as posted when it was not parked */
const posted = (outcome) => !!outcome && !outcome.queued && !outcome.off && !outcome.waiting;

/** a walk-in bill whose day is not in the books yet: LOGGED (ACC-199 — it was silent), answered as waiting; the to-do row says it to the owner (waitingWalkIns) */
function waitsForDayClose(entity, chit_id, walkin) {
  loggerOf().info('books.walkin-waiting-day-close', { entity_id: entity, chit_id, counter: walkin.counter, day: walkin.day });
  return { waiting: 'day close' };
}
/**
 * dayFold(entity, counter, day, s) → { take: [{ id, bill }], skipped } — the ONE read of what a counter's walk-in day holds: the counter's bills of the shop's day,
 * each classified, those that already posted on their own left out. postDay posts exactly these; waitingWalkIns (the to-do) counts exactly these.
 */
async function dayFold(entity, counter, shopDay, setting) {
  const bounds = dayBounds(shopDay, setting); /* the shop's zone — M210 */
  const rows = await withEntity(entity, (db) => S.counterBills(db, entity, counter, bounds.from, bounds.to));
  const taxCopy = require('./tax-copy');
  const found = [],
    skipped = [];
  for (const bill of rows) {
    const verdict = classify({ chit: bill, entry: await taxCopy.entryFor(bill, entity), setting: Object.assign({}, setting, { walkin_grain: 'day' }) });
    if (verdict.kind === 'walkin') found.push({ id: String(bill.chit_id), bill: verdict.bill });
    else if (verdict.kind === 'queue') skipped.push(verdict.why);
  }
  /* a bill that already posted on its own (the grain was "bill" when it was saved, or it came late) never rides the day too */
  const postedOwn = found.length
    ? await withEntity(entity, (db) =>
        S.postedSources(
          db,
          entity,
          found.reduce((total, item) => total.concat(['bill:' + item.id, 'walkin-late:' + item.id]), [])
        )
      )
    : [];
  const take = found.filter((item) => postedOwn.indexOf('bill:' + item.id) < 0 && postedOwn.indexOf('walkin-late:' + item.id) < 0);
  return { take, skipped };
}

/**
 * waitingWalkIns(entity, setting, today) → { bills, amount, currency, days: [{ counter, day, bills }] } | null — the cash walk-in bills still waiting for a day close
 * (ACC-199): the shop's TODAY, each counter whose day is NOT yet in the books (an earlier day is the nightly sweep's, books-nightly step 2). Read through dayFold and
 * the engine's daySummary, so the sum is the one the day close would post (modes.cash), in the shop's own currency. null = nothing waits (or grain "bill").
 */
async function waitingWalkIns(entity, setting, today) {
  if (!setting || setting.walkin_grain === 'bill') return null;
  const waiting = [],
    days = [];
  const shopDay = today,
    bounds = dayBounds(shopDay, setting);
  const counters = await withEntity(entity, (db) => S.countersBilling(db, entity, bounds.from, bounds.to));
  for (const counter of counters) {
    if (await withEntity(entity, (db) => S.entryBySource(db, entity, 'walkin:' + counter + ':' + shopDay))) continue;
    const { take } = await dayFold(entity, counter, shopDay, setting);
    const cash = take.filter((item) => Number((item.bill.pay || {}).cash) > 0);
    if (!cash.length) continue;
    cash.forEach((item) => waiting.push(item.bill));
    days.push({ counter, day: shopDay, bills: cash.length });
  }
  if (!waiting.length) return null;
  /* ONE fold over all of them: the engine adds, this file never does */
  const sum = E.posting().daySummary(waiting, { ref: 'waiting cash', date: today }, { pack: booksPack(setting) });
  return { bills: waiting.length, amount: sum.modes.cash, currency: sum.currency, days };
}

/**
 * ⭐ postDay(entity, counter, day) — the walk-in day of one counter: every walk-in bill it billed that day, summed per
 * mode and per rate by the engine (CBPosting.daySummary), posted once (source_ref walkin:<counter>:<day>).
 */
async function postDay(entity, counter, shopDay, opt) {
  const options = opt || {};
  const setting = options.setting || (await isOn(entity));
  if (!setting) return { off: true };
  const waitingJob = { job: 'day', counter, day: shopDay };
  try {
    /* ⚠️⚠️ GRAIN "bill": every walk-in bill posts as its own entry (bill:<chit>) — the day must not post them again
       (critic M4: one ₹118 cash bill, two entries, Sales ₹200). The nightly job and the day summary both come through here. */
    if (setting.walkin_grain === 'bill') return { ok: true, empty: true, grain: 'bill' };
    const done = await withEntity(entity, (db) => S.entryBySource(db, entity, 'walkin:' + counter + ':' + shopDay));
    if (done) {
      await closeDone(entity, done.source_chit_ids, 'Posted in the day summary — done');
      return { ok: true, duplicate: true, entry_no: done.entry_no };
    }
    const { take, skipped } = await dayFold(entity, counter, shopDay, setting);
    const bills = take.map((item) => item.bill);
    if (!bills.length) return { ok: true, empty: true, skipped };
    /* ⭐ the day NAMES the bills it covers (source_chit_ids) — that list, not a clock, decides what is late (postChit) */
    const event = Object.assign(E.posting().daySummary(bills, { ref: 'walkin ' + counter + ' ' + shopDay, date: shopDay, counter }, { pack: booksPack(setting) }), {
      source_ref: 'walkin:' + counter + ':' + shopDay,
      source_chit_ids: take.map((item) => item.id),
      counter,
      by: options.by,
      narration: 'Walk-in sales, counter ' + counter + ', ' + shopDay + ' (' + bills.length + ' bills)'
    });
    const dayRes = await postOrPark(entity, event, waitingJob, options);
    if (posted(dayRes))
      await closeDone(
        entity,
        take.map((item) => item.id),
        'Posted in the day summary — done'
      );
    return dayRes;
  } catch (e) {
    if (!options.retry) await park(entity, waitingJob, String((e && e.message) || e), null, 'walkin:' + counter + ':' + shopDay);
    if (options.retry) throw e;
    return { queued: true, why: String((e && e.message) || e) };
  }
}

/**
 * ⭐⭐⭐ afterChit(entity, chit_id, by) — called by routes/chits.js AFTER the commit, not awaited. Never rejects.
 */
function afterChit(entity, chit_id, by) {
  return (async () => {
    const setting = await isOn(entity);
    if (!setting) return { off: true };
    return postChit(entity, chit_id, { setting: setting, by });
  })().catch((e) => {
    swallowed('hook_failed');
    loggerOf().warn('books.hook-failed', { entity_id: entity, chit_id, error: String(e && e.message) });
    return { failed: true };
  });
}

/** the waiting list, tried again (the nightly job, and POST /api/books/outbox/retry) */
async function retryOutbox(entity, limit) {
  /* STD1: a row parked before `todo` existed is classified ONCE, here, on the server (books-store TODO_SQL) — then every reader reads data */
  const rows = await withEntity(entity, async (db) => {
    await S.backfillTodo(db, entity);
    return S.waiting(db, entity, limit || 50);
  });
  const out = { tried: 0, posted: 0, still: 0 };
  for (const row of rows) {
    out.tried++;
    const parkedJob = row.event || {};
    let ok = false,
      failureWords = null,
      rowEvent = null;
    try {
      const res =
        parkedJob.job === 'day'
          ? await postDay(entity, parkedJob.counter, parkedJob.day, { retry: true })
          : parkedJob.job === 'chit'
            ? await postChit(entity, parkedJob.chit_id, { retry: true })
            : parkedJob.job === 'event'
              ? await B.postEntry(null, entity, parkedJob.event)
              : null;
      ok = !!res && !res.queued && !res.off;
      if (res && res.queued) failureWords = res.why;
      /* still waiting: what it asks NOW rides the row (a bill accepted but still unposted moves from accept to what stops it) */
      if (!ok) rowEvent = Object.assign(res && res.wait !== undefined ? { waiting: res.wait } : {}, { name: null, candidates: [] }, todoFields(res));
    } catch (e) {
      failureWords = String((e && e.message) || e);
      rowEvent = { todo: 'record', name: null, candidates: [] };
    }
    await withEntity(entity, (db) => S.outboxDone(db, entity, row.id, ok, failureWords || row.why, rowEvent));
    if (ok) out.posted++;
    else out.still++;
  }
  return out;
}

/**
 * a waiting-list row as GET /api/books/health and the nightly check show it — `reason` is why it could not post (for people).
 * ⭐ STD1: `todo` (accept · add_supplier · record) and `name` are the row's DATA (park; books-store waiting() reads them, classifying a row
 * parked before they existed with the ONE fragment TODO_SQL) — the screens branch on these, never on `reason`.
 */
function waitingRow(x) {
  const parkedJob = x.event || {};
  const todo = TODOS.indexOf(x.todo || parkedJob.todo) >= 0 ? x.todo || parkedJob.todo : 'record';
  /* ⭐ `source` — the same shape the Day book's entries carry, so the screen opens the chit the row is waiting on */
  return Object.assign({ short: shortOf(parkedJob.short) /* R106: their figure, the count, the gap (integers) on a shortfall wait; else null */ }, {
    id: x.id,
    chit_id: x.source_chit_id || null,
    ref: x.source_ref || null,
    reason: x.why || null,
    tries: Number(x.tries) || 0,
    since: x.created_at,
    job: parkedJob.job || null,
    todo,
    name: todo === 'add_supplier' ? x.name || parkedJob.name || null : null,
    /* the shop's near matches for a supplier to add (books-store supplierByName): names + party_no only; [] on every other row */
    candidates:
      todo === 'add_supplier' && Array.isArray(parkedJob.candidates)
        ? parkedJob.candidates.slice(0, 3).map((item) => ({ name: String(item.name || ''), party_no: item.party_no || null }))
        : [],
    source: { chit_id: x.source_chit_id || parkedJob.chit_id || null, ref: parkedJob.ref || null, kind: parkedJob.kind || parkedJob.job || null, counter: parkedJob.counter || null, by: parkedJob.by || null }
  });
}

const purpose0 = (copy) => String((copy && copy.purpose) || '');
module.exports = {
  reverseIfPosted,
  takeBackCancelled,
  wasTakenBack,
  closeDone,
  _mover: mover,
  receiptFacts,
  afterChit,
  postChit,
  postDay,
  waitingWalkIns,
  retryOutbox,
  classify,
  postingMoment,
  BILLED_AT_SHAPE,
  modeOf,
  byRateOf,
  todoFields,
  shortfallOf,
  dayOf,
  dayBounds,
  zoneOf,
  isOn,
  forget,
  park,
  waitingRow,
  TODOS,
  recordChitPayment,
  chitPaid,
  chitWithdrawn,
  chitWithdrawnSaid,
  isBooksRefusal,
  partyFromCustomer,
  chitPaymentKey,
  toMinor,
  _expire
}; /* partyFromCustomer: the ONE reading of whom a counter bill names (routes/chits.js send, FX-L2C) */
