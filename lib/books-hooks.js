// @stage tested
// @stage-note [BOOKS v2] The posting hooks: a saved chit → the event it posts (or nothing), after the commit, never able
// @stage-note to fail the chit. A walk-in bill waits for its counter's day close. What cannot post waits in books_outbox, named.
'use strict';
/**
 * CALLED BY routes/chits.js (send · receive · pay post their entries), routes/till.js, lib/crm-calls · crm-followups (dayBounds · zoneOf — the shop's day).
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

let log = null;
function L() {
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
  const k = String(entity),
    c = onCache.get(k),
    now = Date.now(); /* clock-ok: a cache TTL, not a posting date */
  if (c && c.until > now) return c.s;
  let s;
  try {
    s = db ? await B.settingOf(db, entity) : await withEntity(entity, (h) => B.settingOf(h, entity));
  } catch (e) {
    L().warn('books.switch-unread', {
      entity_id: entity,
      error: String(e && e.message).slice(0, 200),
      assumed: c ? (c.s ? 'on (last known)' : 'off (last known)') : 'off (never read)'
    });
    return c ? c.s : null;
  }
  const v = s && s.enabled ? s : null;
  onCache.set(k, { s: v, until: now + (s === null ? 600000 : 60000) });
  return v;
}
function forget(entity) {
  onCache.delete(String(entity));
}
/** tests: the cached answer is now stale (kept as the last known one) — true when there was one */
function _expire(entity) {
  const c = onCache.get(String(entity));
  if (c) c.until = 0;
  return !!c;
}

/* ═══ classify — pure ═══════════════════════════════════════════════════════════════════════════════════════════ */

/** a tender's words → the mode the posting rules know; 'credit' = not paid now (the party owes it); null = unknown */
function modeOf(how) {
  const w = String(how || '')
    .toLowerCase()
    .trim();
  if (!w) return null;
  if (/card|visa|master|rupay|amex|pos\b/.test(w)) return 'card';
  if (/upi|gpay|google ?pay|phone ?pe|paytm|bhim|\bqr\b/.test(w)) return 'upi';
  if (/cheque|check/.test(w)) return 'cheque';
  if (/bank|neft|rtgs|imps|transfer/.test(w)) return 'bank';
  if (/credit|udhaar|udhar|due|on account|later|khata/.test(w)) return 'credit';
  if (/cash/.test(w)) return 'cash';
  return null;
}
/* ⭐ money.round — THE one rounder (half away from zero, the currency's own decimals); never a copy of the rule here */
const MONEY = require('./money');
const r2 = (n) => MONEY.round(Number(n) || 0);
/** ACC-200: the gap the pack lets cash take, in minor units — cashRounding.step_minor when a part was paid in its tender (AU 5c); none = 0, exact */
function cashStepMinor(pack, modes) {
  const rounding = pack && pack.cashRounding;
  if (!rounding || !(rounding.step_minor > 0)) return 0;
  return modes[rounding.tender || 'cash'] ? rounding.step_minor : 0;
}
/**
 * ⭐ ACC-200: a counter bill's payments against its tax invoice, compared in minor units (never floats). It posts the gap as the
 * round-off only inside the books pack's cash step (reg-in has none: a rounded figure is never posted, so India is exact to the
 * paisa); the invoice's own declared RndOffAmt is its figure, never a gap. Outside it the bill WAITS with the gap named. null = posts.
 */
function paymentGapWait(charged, br, inv, modes, s, cur, ref) {
  const declared = toMinor((inv && inv.ValDtls && inv.ValDtls.RndOffAmt) || 0, cur);
  const gapMinor = toMinor(charged, cur) - toMinor(br.total, cur) - declared;
  if (Math.abs(gapMinor) <= cashStepMinor(booksPack(s), modes)) return null;
  const say = (minor) => require('./bill-privacy').money(minor, cur);
  const side = gapMinor < 0 ? 'short by ' : 'over by ';
  const why = 'Bill ' + ref + ' is ' + side + say(Math.abs(gapMinor)) + ': paid ' + say(toMinor(charged, cur)) + ', tax invoice ' + say(toMinor(br.total, cur)) + '.';
  return { kind: 'queue', gap_minor: gapMinor, why: why + ' Check the payment, or record the difference by hand.' };
}

/**
 * the invoice's lines, summed per rate. CESS (v1.16.0, posting 2203/2213) is READ from the frozen invoice's CesAmt per rate — never recomputed
 * (Athi, 2026-10-02: the computation happens once, in billing). `other` is only a non-GST tax (TaxAmt) the rules still cannot carry.
 */
/**
 * ⭐ REVERSE CHARGE (CGST s.9(3)/(4); engines v1.20.0): a purchase whose frozen invoice carries RCM lines posts the BUYER's own tax. The tax was
 * computed ONCE by the tax engine when the bill was assessed and frozen on the invoice (Rcm* on the line); this only READS it —
 * tax.moneyOf(inv).rcm.rows — and hands it to the posting engine as `rcm` (Dr input credit or cost · Cr RCM payable 2204–2206; the supplier is
 * credited WITHOUT it). It is paid in cash only at the GST close / pay (routes /gst/close, /gst/pay), never here. Absent → undefined → the event is unchanged.
 */
function rcmOf(inv, cur) {
  let m = null;
  try {
    m = require('./tax').moneyOf(inv, cur || null);
  } /* RCM-POST: the chit's stated money, never INR by name (T2-NATDEF); moneyOf only labels the block with it */ catch (e) {
    cbLog.fellBack('books-hooks rcmOf: the helper failed — carried on without it', e);
    return undefined;
  }
  return m && m.rcm && Array.isArray(m.rcm.rows) && m.rcm.rows.length ? m.rcm.rows : undefined;
}
/** put the invoice's RCM rows on the FIRST purchase_bill of a bill's events; false when there is none to carry them (own-use only) */
function withRcm(events, inv, cur) {
  const rows = rcmOf(inv, cur);
  if (!rows) return true;
  const first = events.find((e) => e.type === 'purchase_bill');
  if (!first) return false;
  first.rcm = rows;
  return true;
}
/* ⭐ WX-R2R (2026-10-13): the ONE head of a scheme that does not split (AU GST, a VAT) is the line's TaxAmt, named as lib/tax.moneyOf names it —
   the frozen invoice's _cb.scheme in lower case (`gst`, the AU pack's taxHeads) — so the books post by_rate[rate].gst as they post India's cgst.
   Before this every AU bill (engines v1.34 freezes TaxAmt) was queued as "a non-GST tax" and no AU sale posted. No scheme → `other`, as before. */
/** does the shop's ledger post this tax head? — the regulation pack of the country its BOOKS were opened on (B.packOf: the accounts pack, which
    falls back to India for a country it does not carry), never the country the shop says it is in */
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
function postsHead(s, head) {
  try {
    const R = require('./regulation'),
      rp = R.packFor(String((B.packOf(s) || {}).country || '').toUpperCase());
    return !!(rp && Array.isArray(rp.taxHeads) && rp.taxHeads.indexOf(head) >= 0);
  } catch (e) {
    cbLog.fellBack('books-hooks postsHead: the helper failed — answered no', e);
    return false;
  }
}
/** a line's amounts summed into its row (cess only when there is one, so every other invoice keeps its shape) */
function sumIntoRow_(row, line) {
  const cess = r2((row.cess || 0) + (line.CesAmt || 0));
  if (cess) row.cess = cess;
  row.taxable = r2(row.taxable + (line.AssAmt || 0));
  row.cgst = r2(row.cgst + (line.CgstAmt || 0));
  row.sgst = r2(row.sgst + (line.SgstAmt || 0));
  row.igst = r2(row.igst + (line.IgstAmt || 0));
}
/** one invoice line added to its row (rate + supply kind); returns the tax this line carried that is not the scheme's one head */
function addLineToRow_(rows, line, kind, single) {
  const rate = String(line.GstRt == null ? 0 : line.GstRt),
    key = rate + (kind ? '|' + kind : '');
  const row = rows.get(key) || Object.assign({ rate: Number(rate), taxable: 0, cgst: 0, sgst: 0, igst: 0 }, kind ? { kind } : {});
  sumIntoRow_(row, line);
  rows.set(key, row);
  if (single && line.TaxAmt) {
    row[single] = r2((row[single] || 0) + line.TaxAmt);
    return 0;
  } /* absent when nil, like cess */
  return line.TaxAmt || 0;
}
function byRateOf(inv) {
  const lookup = new Map();
  let other = 0;
  const single = inv && inv._cb && inv._cb.scheme ? String(inv._cb.scheme).toLowerCase() : null;
  /* A5 (engines v1.64.0): a line that named its supply kind keeps it — two kinds at one rate (AU GST-free and input-taxed, both 0%) are two rows, and
     posting lands each on its own sales ledger (sales_gst_free …), so BAS G3 and VAT201 boxes 4/5 read them; lines with no kind group as before */
  const kindOfLine = {};
  ((inv && inv._cb && inv._cb.kinds) || []).forEach((entry) => {
    kindOfLine[entry.line] = entry.kind;
  });
  ((inv && inv.ItemList) || []).forEach((line, index) => {
    other = r2(other + addLineToRow_(lookup, line, kindOfLine[index] || null, single));
  });
  const rows = Array.from(lookup.values());
  const total = r2(rows.reduce((sum, item) => sum + item.taxable + item.cgst + item.sgst + item.igst + (item.cess || 0) + ((single && item[single]) || 0), 0));
  return { rows, total, other };
}
/**
 * ⭐ WHAT A BILL I RECEIVED IS FOR, line by line (lib/bill-use effective(): lines[i] is the invoice's ItemList[i] — the
 * same order, removed lines left out). No `uses` (a caller that did not ask) → everything resale, exactly as before.
 */
function usesSplit(uses, inv) {
  const items = (inv && inv.ItemList) || [],
    out = { resale: [], use: [], asset: [], _cb: inv && inv._cb }; /* _cb: the scheme byRateOf names a single head by */
  items.forEach((item, index) => {
    const u = uses && Array.isArray(uses.lines) && uses.lines[index] ? uses.lines[index].use : 'resale';
    (out[u] || out.resale).push(item);
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
function useEvents(c, base, sup, split, paid, round_off, due, s, asset) {
  const id = c.chit_id,
    events = [],
    hasResale = split.resale.length > 0,
    hasAsset = split.asset.length > 0;
  if (hasResale)
    events.push(
      Object.assign({}, base, {
        type: 'purchase_bill',
        party: sup,
        by_rate: byRateOf({ ItemList: split.resale, _cb: split._cb }).rows,
        paid: {},
        round_off,
        counter: null,
        source_ref: 'chit:' + id,
        against_ref: id,
        due_date: due
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
        party: sup,
        by_rate: byRateOf({ ItemList: split.asset, _cb: split._cb }).rows,
        paid: {},
        round_off: hasResale ? 0 : round_off,
        counter: null,
        source_ref: hasResale ? 'chit:' + id + ':asset' : 'chit:' + id,
        against_ref: id,
        due_date: due,
        asset_register: asset.register
      })
    );
  const hasBefore = hasResale || hasAsset;
  if (split.use.length) {
    const list = byRateOf({ ItemList: split.use, _cb: split._cb }).rows;
    const sum = (k) => r2(list.reduce((total, item) => total + (item[k] || 0), 0));
    const tax = { cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess') };
    const one = split._cb && split._cb.scheme ? String(split._cb.scheme).toLowerCase() : null;
    if (one && sum(one)) tax[one] = sum(one); /* AU GST: the one head (byRateOf) */
    events.push(
      Object.assign({}, base, {
        type: 'expense',
        class: (s && s.use_class) || 'sundry_expense',
        amount: r2(sum('taxable') + (hasBefore ? 0 : round_off)),
        input_tax: tax.cgst || tax.sgst || tax.igst || tax.cess || (one && tax[one]) ? tax : undefined,
        supplier: sup,
        counter: null,
        source_ref: hasBefore ? 'chit:' + id + ':use' : 'chit:' + id,
        against_ref: id,
        due_date: due
      })
    );
  }
  for (const m of Object.keys(paid || {}))
    if (paid[m])
      events.push(
        Object.assign({}, base, {
          type: 'payment_made',
          party: sup,
          mode: m,
          amount: paid[m],
          counter: null,
          source_ref: 'chit:' + id + ':paid:' + m,
          against_ref: id
        })
      );
  return { event: events[0], events };
}
function modesOf(parts) {
  const out = {},
    unknown = [];
  for (const p of parts || []) {
    const m = modeOf(p.how);
    const a = r2(p.amount);
    if (!a) continue;
    if (!m) {
      unknown.push(p.how);
      continue;
    }
    out[m] = r2((out[m] || 0) + a);
  }
  return { modes: out, unknown };
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
function fmtOf(zone) {
  if (fmtCache[zone]) return fmtCache[zone];
  const opt = { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  let f;
  try {
    f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: zone }, opt));
  } catch (_) {
    f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: 'UTC' }, opt));
  } /* a zone Intl does not know → UTC, no country's */
  return (fmtCache[zone] = f);
}
/** the zone a caller means: an IANA name, a single-zone country, or a row carrying `timezone` / `country` */
function zoneOf(z) {
  if (z && typeof z === 'object') return zoneOf(z.timezone || z.country);
  const text = String(z || '').trim();
  if (text.indexOf('/') > 0 || text === 'UTC') return text;
  return packZone(text.toUpperCase()) || COUNTRY_ZONE[text.toUpperCase()] || 'UTC'; /* T2-NATDEF: unstated → UTC, never India's midnight */
}
/* CX2 (A6): a registered pack names its zones (engines v1.42 `timeZones`; the setup step sets identities.timezone from them) — an Australian shop with
   no zone saved yet is cut at its pack's first zone (Sydney), never at India's midnight. A country with no pack keeps the b176 table above. */
function packZone(code) {
  let p;
  try {
    p = require('./regulation').lookup(code);
  } catch (e) {
    cbLog.fellBack('books-hooks packZone: the helper failed — answered with nothing', e);
    return null;
  }
  return p && !p.fallback && p.id === code && Array.isArray(p.timeZones) && p.timeZones[0] ? p.timeZones[0] : null;
}
/** the wall clock of a moment in a zone — { y, m, d, H, M, S } */
function wallOf(t, zone) {
  const w = {};
  for (const p of fmtOf(zone).formatToParts(new Date(t))) if (p.type !== 'literal') w[p.type] = Number(p.value);
  return { y: w.year, m: w.month, d: w.day, H: w.hour === 24 ? 0 : w.hour, M: w.minute, S: w.second };
}
/** ms between the zone's wall clock and UTC at that moment (+19,800,000 for India) */
function offsetAt(t, zone) {
  const w = wallOf(t, zone);
  return Date.UTC(w.y, w.m - 1, w.d, w.H, w.M, w.S) - Math.floor(t / 1000) * 1000;
}
const NAIVE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
/** the instant a timestamp names (ms), or NaN — a zone-less string is a UTC wall clock (see above) */
function momentOf(ts) {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  const text = String(ts == null ? '' : ts).trim();
  return NAIVE.test(text) ? Date.parse(text.replace(' ', 'T') + 'Z') : Date.parse(text);
}
const pad2 = (n) => (n < 10 ? '0' : '') + n;
/** the shop's calendar day (YYYY-MM-DD) of a moment, in the shop's zone — null when it is not a moment */
function dayOf(ts, zone) {
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts.trim())) return ts.trim(); /* a day is already a day */
  const t = momentOf(ts);
  if (!isFinite(t)) return null;
  const w = wallOf(t, zoneOf(zone));
  return w.y + '-' + pad2(w.m) + '-' + pad2(w.d);
}
/** the instant (ms) the shop's day BEGINS — local midnight; on a day whose midnight a DST jump skipped, the first minute that exists */
function dayStartMs(day, zone) {
  const z = zoneOf(zone),
    guess = Date.parse(day + 'T00:00:00Z');
  let t = guess - offsetAt(guess, z);
  const again = guess - offsetAt(t, z);
  if (again !== t) t = again; /* the offset changed between the guess and the answer (a DST edge) */
  for (let index = 0; index < 3 && dayOf(t, z) < day; index++) t += 3600000; /* midnight itself was skipped — the day starts an hour on */
  return t;
}
/** [from, to) of the shop's day as ISO instants — a DST day is 23 or 25 hours long, so `to` is the NEXT day's start, never +24h */
function dayBounds(day, zone) {
  const z = zoneOf(zone),
    date = new Date(Date.parse(day + 'T00:00:00Z') + 86400000);
  const next = date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
  return { from: new Date(dayStartMs(day, z)).toISOString(), to: new Date(dayStartMs(next, z)).toISOString() };
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
function partyFromCustomer(c) {
  return c && (c.party_id || c.identity_id || c.entity_id) ? String(c.party_id || c.identity_id || c.entity_id) : null;
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
function refusedNone(inp, c) {
  const st = String(inp.status || (c && c.current_status) || '');
  return { kind: 'none', done: true, why: (/^cancelled$/.test(st) ? 'Cancelled' : 'Rejected') + ' — not posted' };
}
function sellerNameOf(t) {
  return (t && t.seller && (t.seller.LglNm || t.seller.TrdNm)) || 'the seller';
}
function buyerGate(inp, t, ref) {
  const st = String(inp.status || (inp.chit && inp.chit.current_status) || '');
  const what = '(bill ' + ref + ' from ' + sellerNameOf(t) + ')';
  if (REFUSED.test(st)) return refusedNone(inp, inp.chit);
  if (inp.disputed) return { kind: 'queue', wait: 'dispute', why: 'Disputed — this posts once the dispute is settled and you confirm the goods ' + what + '.' };
  if (!ACCEPTED.test(st)) return { kind: 'queue', wait: 'acceptance', todo: 'accept', why: 'Waiting for you to confirm the goods were received ' + what };
  return null;
}

/**
 * A SALE WHOSE SUPPLY CANNOT BE DECIDED WAITS, LIKE A BILL I RECEIVED (Fable review 2026-10-23, finding 10). A registered seller's taxed line that came out with
 * every head 0 because the engine could not tell intra from inter (no state on the seller) would post as a sale with no tax and no word said. It parks in
 * words instead. A seller who may not charge tax (unregistered, composition) is not asked: its rate is stated for the record by design.
 */
/** a seller who may charge tax at all: not unregistered, not on the composition scheme (the one rule, lib/tax-shelf registrationMayCharge) */
function mayChargeTax(seller) {
  return require('./tax-shelf').registrationMayCharge(seller && seller.RegType);
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
function headsWait(inv, br, s, entry, ref) {
  const undecided = saleUndecided(inv, entry, ref); /* a SALE (entry given) whose supply is undecided waits, in words */
  if (undecided) return undecided;
  if (br.other) return { kind: 'queue', why: 'The bill carries a non-GST tax (' + br.other + ') the posting rules do not post yet.' };
  const one = inv._cb && inv._cb.scheme ? String(inv._cb.scheme).toLowerCase() : null;
  if (one && br.rows.some((item) => item[one]) && !postsHead(s, one)) {
    const amt = r2(br.rows.reduce((total, item) => total + (item[one] || 0), 0));
    return {
      kind: 'queue',
      why:
        'The bill carries ' +
        String(inv._cb.scheme).toUpperCase() +
        ' (' +
        amt +
        ') but these books were opened on a chart with no ' +
        String(inv._cb.scheme).toUpperCase() +
        ' ledger — it waits, so the tax is never dropped.'
    };
  }
  return null;
}
/** F10: is this copy my counter receipt carrying their bill? (tax-copy.capturedBill — the folder rule's own test) */
function capturedOf(c) {
  return String((c && c.purpose) || '') === 'receipt' && require('./folder-inventory').theirBill(c && c.business_json);
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
  const unit = Math.pow(10, MONEY.decimals(currency));
  const minor = (amount) => Math.round(Number(amount) * unit);
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
function receiptBill(inp, c, t, s, bj, base, cur) {
  const tb = bj.their_bill || {},
    no = String(tb.no).trim();
  const name = String((t.seller && t.seller.LglNm) || (bj.party && bj.party.name) || '').trim() || 'the supplier';
  if (REFUSED.test(String(inp.status || c.current_status || ''))) return refusedNone(inp, c);
  if (inp.theirInvoice)
    return { kind: 'none', done: true, why: 'Their invoice ' + (inp.theirInvoice.no || '') + ' is the bill — this receipt is the goods record.' };
  const sup = inp.party || (t.seller && t.seller.entity_id) || null;
  const partyWait = receiptPartyWait(inp, sup, name, no);
  if (partyWait) return partyWait;
  const inv = t.invoice;
  if (!inv || !(inv.ItemList || []).length) return { kind: 'queue', why: 'Bill ' + no + ' from ' + name + ' has no lines to post.' };
  const br = byRateOf(inv);
  const unposted = headsWait(inv, br, s);
  if (unposted) return unposted;
  const taxed = (inv.ItemList || []).some((item) => Number(item.GstRt) > 0);
  if (taxed && inv._cb && inv._cb.supply === 'unknown')
    return {
      kind: 'queue',
      wait: 'state',
      why:
        'Bill ' +
        no +
        ' from ' +
        name +
        ' carries ' +
        String(inv._cb.scheme || 'tax').toUpperCase() +
        ' but their state is not known — add their tax number to the supplier, then this posts.'
    };
  if (tb.total == null || tb.total === '' || !isFinite(Number(tb.total)))
    return { kind: 'queue', why: 'Bill ' + no + ' from ' + name + ' has no readable total.' };
  /* ⭐⭐ FX-F10W2: THE ONE COMPARISON (lib/their-bill — the counter's Receive form and slip call the same file): their total against what
     they charge, taxable + tax, as the one engine taxed the lines (byRateOf). Within one unit it posts as the round-off; beyond it waits
     with the SAME sentence the counter printed, + what to do. */
  const taxable = r2(br.rows.reduce((total, item) => total + item.taxable, 0));
  const say = (n) => require('./bill-privacy').money(Math.round(n * Math.pow(10, MONEY.decimals(cur))), cur);
  const cmp = require('./their-bill').check({ total: tb.total, taxable, tax: r2(br.total - taxable), currency: cur, no, say });
  const short = shortfallOf(cmp, cur, say);
  if (cmp.code === 'apart' && !short)
    return { kind: 'queue', wait: 'gap', gap: cmp.gap, why: cmp.sentence + ' Ask ' + name + ' to correct it, or reject it and record their bill by hand.' };
  const gate = buyerGate(inp, { seller: { LglNm: name } }, no);
  /* a shortfall still waits for the accept (todo 'accept', so the Accept action stays open) and says what accepting does, with the figures as data */
  if (gate) return shortfallGate(gate, cmp, short);
  const round_off = short ? 0 : r2(cmp.gap);
  return {
    kind: 'post',
    supplier_check: true,
    event: Object.assign(
      {},
      base,
      { ref: no, type: 'purchase_bill', party: String(sup), by_rate: br.rows, paid: {}, round_off, counter: null, source_ref: 'chit:' + c.chit_id, against_ref: c.chit_id, rcm: rcmOf(inv, cur) },
      shortfallFields(short, no, name)
    )
  };
}

/**
 * classify({ chit, entry, setting, status?, disputed? }) → { kind: 'none' | 'walkin' | 'day' | 'post' | 'queue', event?, why?, counter?, day? }
 *   chit:     the copy (purpose, business_json, chit_id, created_at, currency_code, sender_entity_id, current_status)
 *   entry:    tax-copy entryFor(copy, me) — { sells, direction, invoice, seller, buyer, me }
 *   status:   my copy's chit status (default chit.current_status) — the buyer's acceptance (buyerGate)
 *   disputed: an open dispute on the chit (postChit reads it)
 * A purchase the buyer accepted comes back with `supplier_check: true`: postChit posts it only when the seller is on the
 * buyer's supplier list (never added automatically — Athi, 2026-10-01).
 */
/**
 * ⭐ H2 (PAY-FIX): THE KEY IS THE PRESS. `payment.client_ref` (minted by the web when the Mark-paid sheet opens) makes the key
 * chitpay:<chit>:<ref>, so ₹500 now and ₹500 later are TWO payments and a retry of either is its own replay. A press with
 * no ref (an older web, the retry from Waiting) keeps chitpay:<chit> — one payment per chit, the second answered as the first.
 */
const chitPaymentKey = (chit_id, pressRef) => 'chitpay:' + chit_id + (pressRef ? ':' + String(pressRef) : '');
/** a major-unit figure in the currency's minor units (paise for INR), the one rounding classify uses */
function toMinor(major, currency) {
  return Math.round((Number(major) || 0) * Math.pow(10, MONEY.decimals(currency)));
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
function classify(inp) {
  const c = inp.chit || {},
    t = inp.entry || {},
    s = inp.setting || {};
  const bj = c.business_json || {},
    purpose = String(c.purpose || '');
  const cur = require('./country-setup').currencyStated(
    c.currency_code,
    t.invoice && t.invoice.currency,
    s.functional_currency
  ); /* T2-NATDEF: none stated → null, never INR */
  const at = postingMoment(c);
  const date = dayOf(at, s); /* the shop's zone (setting.timezone, else its country) — M210 */
  const base = { source_chit_id: c.chit_id, currency: cur, date, ref: bj.bill_no || bj.printed_as || c.chit_id };
  const till = bj.till && bj.till.id ? String(bj.till.id) : null;

  /* the counter's day summary chit → the walk-in day of that counter */
  if (purpose === 'general' && bj.summary && typeof bj.summary === 'object') {
    const sm = bj.summary;
    if (sm.period !== 'day') return { kind: 'none' };
    const key = /(\d{4}-\d{2}-\d{2})/.exec(String(sm.key || ''));
    const counter = (sm.till && sm.till.id) || till;
    if (!key || !counter) return { kind: 'queue', why: 'A day summary without its day or its counter.' };
    return { kind: 'day', counter: String(counter), day: key[1] };
  }
  /* ⭐ MONEY RECEIVED AT THE COUNTER — its own numbered series, never a bill (books-counter 3e1c88f) */
  if (bj.kind === 'payment_received' && bj.payment_received && typeof bj.payment_received === 'object') {
    const p = bj.payment_received,
      pcur = String(p.currency || cur).toUpperCase();
    const party = partyFromCustomer(p.party) || partyFromCustomer(bj.customer);
    const amt = r2(Math.abs(Number(p.amount) || 0)),
      mode = modeOf(p.mode),
      day = dayOf(p.at || at, s);
    if (!party) return { kind: 'queue', why: 'Money received (' + (p.no || '') + ') from nobody the shop knows — choose the customer.' };
    if (!amt) return { kind: 'queue', why: 'Money received (' + (p.no || '') + ') with no amount.' };
    if (!mode || mode === 'credit') return { kind: 'queue', why: 'Money received (' + (p.no || '') + ') by "' + p.mode + '", which has no ledger yet.' };
    if (!day) return { kind: 'queue', why: 'Money received (' + (p.no || '') + ') has no usable date.' };
    const chq = p.cheque && typeof p.cheque === 'object' ? p.cheque : {};
    return {
      kind: 'payment',
      payment: {
        party_id: party,
        direction: 'in',
        amount_minor: toMinor(amt, pcur),
        currency: pcur,
        mode,
        reference: p.no || null,
        cheque_no: chq.no || null,
        cheque_bank: chq.bank || null,
        cheque_date: /^\d{4}-\d{2}-\d{2}$/.test(String(chq.dated || '')) ? chq.dated : null,
        received_at: day,
        client_ref: 'chit:' + c.chit_id,
        source_chit_id: c.chit_id
      }
    };
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
  if (bj.payment && typeof bj.payment === 'object' && !Array.isArray(bj.payment.parts) && bj.payment.method) {
    const p = bj.payment,
      mode = modeOf(p.method),
      day = dayOf(p.at || at, s),
      bought = t.sells === false;
    const party = bought
      ? t.seller && t.seller.entity_id
        ? String(t.seller.entity_id)
        : c.sender_entity_id
          ? String(c.sender_entity_id)
          : null
      : partyFromCustomer(bj.customer) || (t.buyer && t.buyer.entity_id ? String(t.buyer.entity_id) : null);
    const sj = c.summary_json || {};
    const quoted = sj.total_value != null ? Number(sj.total_value) : bj.invoice && bj.invoice.grand_total != null ? Number(bj.invoice.grand_total) : 0;
    const amt = r2(Math.abs(Number(p.amount != null ? p.amount : quoted) || 0));
    const no = bj.bill_no || bj.printed_as || String(c.chit_id).slice(0, 8);
    const wait = markPaidWait(no, p.method, party, amt, mode, day);
    if (wait) return wait;
    return {
      kind: 'payment',
      payment: {
        party_id: party,
        direction: bought ? 'out' : 'in',
        amount_minor: toMinor(amt, cur),
        currency: cur,
        mode,
        reference: p.ref || null,
        received_at: day,
        client_ref: chitPaymentKey(c.chit_id, p.client_ref),
        source_chit_id: c.chit_id,
        against_chit: c.chit_id, quoted_minor: toMinor(quoted, cur) /* the ledger OFF asks against the quote (FIN-53) */
      }
    };
  }
  /* every event below carries the chit's own day — without one nothing can be posted (and nothing is guessed) */
  if (!date && (purpose === 'expense' || purpose === 'income' || purpose === 'credit_note' || purpose === 'invoice' || (till && bj.bill_no) || capturedOf(c)))
    return { kind: 'queue', why: 'The chit has no usable date.' };
  if (purpose === 'expense') {
    const x = bj.expense || {};
    const amt = r2(Math.abs(Number(x.amount) || 0));
    if (!amt) return { kind: 'queue', why: 'An expense with no amount.' };
    const m = modeOf(x.mode);
    const ev = Object.assign({}, base, { type: 'expense', class: x.class || 'sundry_expense', amount: amt, source_ref: 'chit:' + c.chit_id, counter: till });
    if (m === 'credit') {
      if (!x.supplier) return { kind: 'queue', why: 'An expense on credit names no supplier.' };
      ev.supplier = String(x.supplier);
    } else if (!m) return { kind: 'queue', why: 'The expense was paid by "' + x.mode + '", which has no ledger yet.' };
    else ev.paid_from = m;
    return { kind: 'post', event: ev };
  }
  if (purpose === 'income') {
    const x = bj.income || {};
    const amt = r2(Math.abs(Number(x.amount) || 0));
    const m = modeOf(x.mode) || 'cash';
    if (!amt) return { kind: 'queue', why: 'An income entry with no amount.' };
    if (m === 'credit') return { kind: 'queue', why: 'Income on credit is not posted from the counter.' };
    return {
      kind: 'post',
      event: Object.assign({}, base, {
        type: 'other_income',
        class: x.class || 'sundry_income',
        into: m,
        amount: amt,
        source_ref: 'chit:' + c.chit_id,
        counter: till
      })
    };
  }

  /* ⭐ F10: my counter receipt with their bill no. and total IS their bill (receiptBill); a goods receipt without it posts nothing */
  if (purpose === 'receipt') return capturedOf(c) ? receiptBill(inp, c, t, s, bj, base, cur) : { kind: 'none' };

  const inv = t.invoice;
  if (!inv) return { kind: 'none' };
  const br = byRateOf(inv);
  const unposted = headsWait(inv, br, s, t, base.ref);
  if (unposted) return unposted;
  const counterBill = !!(till && bj.bill_no);

  if (purpose === 'credit_note') {
    if (t.sells) {
      const refunds = modesOf(bj.refund && bj.refund.parts);
      if (refunds.unknown.length) return { kind: 'queue', why: 'Refunded by "' + refunds.unknown.join(', ') + '", which has no ledger yet.' };
      const party = partyFromCustomer(bj.customer);
      const ev = Object.assign({}, base, {
        type: 'return',
        by_rate: br.rows,
        source_ref: 'chit:' + c.chit_id,
        counter: till,
        against_bill: bj.against || null
      });
      if (Object.keys(refunds.modes).length) ev.refund = refunds.modes;
      else if (party) ev.party = party;
      else return { kind: 'queue', why: 'A credit note with no refund and no known customer.' };
      if (party && ev.refund) ev.party = party;
      return { kind: 'post', event: ev };
    }
    const sup = t.seller && t.seller.entity_id;
    if (!sup) return { kind: 'queue', why: 'A supplier credit note with no supplier.' };
    return { kind: 'post', event: Object.assign({}, base, { type: 'purchase_return', party: String(sup), by_rate: br.rows, source_ref: 'chit:' + c.chit_id }) };
  }

  /* ⭐ the CUSTOMER's copy of a counter bill reads 'invoice' + counter_bill (routes/chits.js billCopyFor) — still a counter
     bill: its payments at the counter are what was paid, so it takes this branch, never the invoice one (paid {}) */
  if (counterBill && (/^(order|offer|subscription)$/.test(purpose) || (purpose === 'invoice' && bj.counter_bill === true))) {
    /**
     * ⚠️⚠️ WHO SOLD IT DECIDES THE SIDE (2026-10-01). This branch posted sale_bill without asking — so the BUYER's copy of a
     * counter bill (the same business_json) would have posted as the buyer's own SALE, or summed into the buyer's walk-in
     * day when its counter shared the id. A counter bill is SENT by the shop whose counter billed it, so a copy sent by
     * anyone but me is the buyer's, even when tax-copy's counter rule (a self chit naming a customer) calls it "sells".
     */
    const me = t.me && t.me.entity_id ? String(t.me.entity_id) : null;
    const sentByOther = !!(me && c.sender_entity_id && String(c.sender_entity_id) !== me);
    if (!t.sells || sentByOther) {
      const gate = buyerGate(inp, sentByOther && t.sells ? { seller: {} } : t, base.ref);
      if (gate) return gate;
      const sup = sentByOther ? String(c.sender_entity_id) : t.seller && t.seller.entity_id ? String(t.seller.entity_id) : null;
      if (!sup) return { kind: 'queue', why: 'A bill from a counter with no seller on the rail.' };
      const nestedPay = modesOf(bj.payment && bj.payment.parts);
      if (nestedPay.unknown.length) return { kind: 'queue', why: 'Paid by "' + nestedPay.unknown.join(', ') + '", which has no ledger yet.' };
      const nestedCharged = r2(Object.keys(nestedPay.modes).reduce((total, item) => total + nestedPay.modes[item], 0));
      delete nestedPay.modes.credit; /* the credit part is what the buyer owes — Creditors */
      const nestedRound_off = r2(nestedCharged - br.total);
      const nestedGap = paymentGapWait(nestedCharged, br, inv, nestedPay.modes, s, cur, base.ref);
      if (nestedGap) return nestedGap;
      const nestedDue = bj.terms && /^\d{4}-\d{2}-\d{2}$/.test(String(bj.terms.due_date || '')) ? String(bj.terms.due_date) : undefined;
      /* ⭐ WHAT THE GOODS ARE FOR (lib/bill-use, Athi 2026-10-01) — absent (a caller that did not ask) = all resale, as before */
      const split = usesSplit(inp.uses, inv);
      /* ⭐ AN ASSET WAITS UNTIL THE REGISTER EXISTS (b280, DRAFT) — then it posts to the class's PPE ledger and makes its register row.
         `inp.assets` is postChit's answer to "is the register there?"; without it the same plain reason queues, as before. */
      let asset = null;
      if (split.asset.length) {
        const seller = sellerNameOf(sentByOther && t.sells ? { seller: {} } : t);
        if (!inp.assets)
          return {
            kind: 'queue',
            wait: 'asset',
            why: 'An asset purchase needs the asset ledger — not posted yet (bill ' + base.ref + ' from ' + seller + ').'
          };
        const cls = inp.uses && inp.uses.asset_class;
        if (!cls)
          return {
            kind: 'queue',
            wait: 'asset',
            why:
              'Which kind of asset is bill ' +
              base.ref +
              ' from ' +
              seller +
              '? Choose it (buildings, plant, furniture, vehicles, office or computers) on the bill, and it posts.'
          };
        const names = ((inp.uses && inp.uses.lines) || []).filter((item) => item.use === 'asset').map((item) => item.name);
        const items = split.asset.map((item, index) => ({
          name: String(names[index] || item.PrdDesc || item.PrdNm || 'Asset from bill ' + base.ref).slice(0, 120),
          cost: r2(item.AssAmt || 0)
        }));
        const lookup = new Map();
        items.forEach((x) => lookup.set(x.name, r2((lookup.get(x.name) || 0) + x.cost)));
        asset = {
          class: cls,
          put_to_use: (inp.uses && inp.uses.put_to_use) || date,
          register: Array.from(lookup.entries()).map(([name, cost]) => ({ name, cost }))
        };
      }
      if (split.use.length || split.asset.length) {
        const ue = useEvents(c, base, sup, split, nestedPay.modes, nestedRound_off, nestedDue, s, asset);
        if (!withRcm(ue.events, inv, cur))
          return {
            kind: 'queue',
            why: 'Bill ' + base.ref + ' is under reverse charge but none of it is bought for resale or as an asset — record its tax by hand (a journal entry).'
          };
        return { kind: 'post', supplier_check: true, ...ue };
      }
      /* counter null: it is the SELLER's counter, not one of mine */
      return {
        kind: 'post',
        supplier_check: true,
        event: Object.assign({}, base, {
          type: 'purchase_bill',
          party: sup,
          by_rate: br.rows,
          paid: nestedPay.modes,
          round_off: nestedRound_off,
          counter: null,
          source_ref: 'chit:' + c.chit_id,
          against_ref: c.chit_id,
          due_date: nestedDue,
          rcm: rcmOf(inv, cur)
        })
      };
    }
    const pay = modesOf(bj.payment && bj.payment.parts);
    if (pay.unknown.length) return { kind: 'queue', why: 'Paid by "' + pay.unknown.join(', ') + '", which has no ledger yet.' };
    const charged = r2(Object.keys(pay.modes).reduce((total, item) => total + pay.modes[item], 0));
    const credit = pay.modes.credit || 0;
    delete pay.modes.credit;
    const round_off = r2(charged - br.total);
    const gapWait = paymentGapWait(charged, br, inv, pay.modes, s, cur, base.ref);
    if (gapWait) return gapWait;
    const party = partyFromCustomer(bj.customer);
    const gstin = bj.customer && bj.customer.gstin ? String(bj.customer.gstin) : null;
    let grain = 'day';
    try {
      const P = E.posting();
      grain = P.granularity ? P.granularity({ setting: s.walkin_grain, party, credit: credit > 0, gstin }) : grain;
    } catch (_) {
      grain = party || credit > 0 || gstin ? 'bill' : s.walkin_grain || 'day';
    }
    if (credit > 0 && !party) return { kind: 'queue', why: 'An on-credit bill with no known customer — who owes it?' };
    if (!party && !gstin && credit <= 0) {
      if (grain === 'bill')
        return {
          kind: 'post',
          event: Object.assign({}, base, { type: 'walkin_day', modes: pay.modes, by_rate: br.rows, round_off, counter: till, source_ref: 'bill:' + c.chit_id })
        };
      return { kind: 'walkin', counter: till, day: date, bill: { currency: cur, pay: pay.modes, taxes: br.rows, round_off } };
    }
    /* a credit bill's own terms (the counter wrote them on the chit): its due date, when it is a real date */
    const due = bj.terms && /^\d{4}-\d{2}-\d{2}$/.test(String(bj.terms.due_date || '')) ? String(bj.terms.due_date) : undefined;
    return {
      kind: 'post',
      event: Object.assign({}, base, {
        type: 'sale_bill',
        party: party || undefined,
        by_rate: br.rows,
        paid: pay.modes,
        round_off,
        counter: till,
        source_ref: 'chit:' + c.chit_id,
        against_ref: c.chit_id,
        due_date: due
      })
    };
  }

  if (purpose === 'invoice') {
    const total = r2((inv.ValDtls && inv.ValDtls.TotInvVal) || br.total);
    const round_off = r2(total - br.total);
    if (t.sells) {
      const buyer = t.buyer && t.buyer.entity_id;
      if (!buyer) return { kind: 'queue', why: 'An invoice with no buyer on the rail — record it at the counter instead.' };
      return {
        kind: 'post',
        event: Object.assign({}, base, {
          type: 'sale_bill',
          party: String(buyer),
          by_rate: br.rows,
          paid: {},
          round_off,
          source_ref: 'chit:' + c.chit_id,
          against_ref: c.chit_id
        })
      };
    }
    const sup = t.seller && t.seller.entity_id;
    if (!sup) return { kind: 'queue', why: 'A supplier invoice with no supplier.' };
    /* ⭐ behind the buyer's acceptance, like a counter bill received (buyerGate) — it used to post on arrival */
    const gate = buyerGate(inp, t, bj.invoice_no || bj.doc_no || base.ref);
    if (gate) return gate;
    return {
      kind: 'post',
      supplier_check: true,
      event: Object.assign({}, base, {
        type: 'purchase_bill',
        party: String(sup),
        by_rate: br.rows,
        paid: {},
        round_off,
        source_ref: 'chit:' + c.chit_id,
        against_ref: c.chit_id,
        rcm: rcmOf(inv, cur)
      })
    };
  }
  return { kind: 'none' };
}

/** STD1: what a waiting row may ask of the owner (books-store TODO_SQL classifies a row parked before these existed) */
const TODOS = ['accept', 'add_supplier', 'record'];
/** a queue answer's todo · name · candidates, as the outbox row's event carries them */
function todoFields(k) {
  const todo = TODOS.indexOf(k && k.todo) >= 0 ? k.todo : 'record';
  const out = todo === 'add_supplier' ? { todo, name: k.name || null, candidates: Array.isArray(k.candidates) ? k.candidates.slice(0, 3) : [] } : { todo };
  if (k && k.short) out.short = shortOf(k.short); /* R106: a shortfall's figures ride the row as data (FIELDS waiting[].short) */
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
async function park(entity, job, why, chit_id, source_ref) {
  const event = Object.assign({}, job, { todo: TODOS.indexOf(job && job.todo) >= 0 ? job.todo : 'record' });
  if (event.todo !== 'add_supplier') {
    delete event.name;
    delete event.candidates;
  }
  try {
    await withEntity(entity, (db) => S.queue(db, entity, { source_chit_id: chit_id || null, source_ref: source_ref || null, event, why }));
  } catch (e) {
    L().warn('books.outbox-failed', { entity_id: entity, chit_id, why, error: String(e && e.message) });
    return;
  }
  L().warn('books.queued', { entity_id: entity, chit_id, why });
}

/**
 * ⭐ recordChitPayment(db, entity, p, o) — the hook's ONE call into books.recordPayment for a payment a CHIT carries (the
 * counter's money chit; "Mark paid" on a chit), on the caller's handle — so a route's mark and the books' record are one
 * transaction. `p.against_chit` (the door's shape) names the bill it was paid against: when the books hold that bill open, the
 * allocation goes in the same call (never more than is left — the rest is an advance); a bill not posted yet (an order, a bill
 * still waiting) records on account, and propose/confirm settles it later. `o.warn` = the duplicate rule as the books route asks
 * it (W1 only when allocating; W3/W4 always) — the counter never asks (a walk-in's payment has nothing "owed").
 */
async function recordChitPayment(db, entity, p, o) {
  const q = Object.assign({ by: o && o.by }, p);
  delete q.against_chit;
  delete q.quoted_minor;
  if (p.against_chit && p.mode !== 'cheque') {
    const prop = await B.proposeFor(db, entity, { party: p.party_id, direction: p.direction, amount_minor: p.amount_minor, currency: p.currency });
    const d = prop.outstanding && prop.outstanding.by_ref ? prop.outstanding.by_ref[String(p.against_chit)] : null;
    /* the bill the books hold (open or already settled): the allocation names it, so W1/W2 measure against THIS bill — a settled bill is an
       allocation of 0: nothing to settle, and W1 asks "nothing is owed" before ₹500 becomes a silent advance (critic on FIN-53, points 1 and 2) */
    if (d && d.kind === 'bill')
      q.allocations = [{ against_ref: String(p.against_chit), amount_minor: Math.min(p.amount_minor, Math.max(0, d.outstanding_minor)) }];
    /* paid against THIS chit, which the books do not hold yet (an order): an advance on purpose — not an offer to settle the party's other bills (W2 stays silent) */
    else q.allocate = 'none';
  }
  if (o && o.warn) q.warn = o.warn;
  return B.recordPayment(db, entity, q);
}
/** the door's refusals BEFORE a wait (FIN-52 a press for nothing, ledger on or off · FIN-55 a party on neither list, when the ledger is on): a wait is only for what a retry can post later */
async function refuseBeforeWait(db, entity, verdict, ledgerOn) {
  if (verdict.kind !== 'queue') return;
  if (verdict.refuse) throw B.refuse(verdict.why);
  if (ledgerOn && verdict.party) await B.partyOnList(db, entity, verdict.party);
}
/**
 * ⭐⭐ chitPaid(db, entity, copy, o) — THE DOOR (POST /chits/:id/payment; drift D1). `copy` is MY copy of the chit, already
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
  throw Object.assign(new Error(words), { code: 'ALREADY_PAID', status: 409, warnings: [warning], title: B.warningTitle([warning]) });
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
async function chitPaid(db, entity, copy, o) {
  const { ledger: s, verdict: k } = await markPaidFacts(db, entity, copy);
  if (!s) {
    await askAgainstQuote(k, o);
    return { off: true };
  }
  if (k.kind === 'queue') return { queued: true, why: k.why };
  if (k.kind !== 'payment') return { none: true };
  const name = (o && o.name) || undefined;
  const rec = await recordChitPayment(db, entity, k.payment, { by: o && o.by, warn: { acknowledge: (o && o.acknowledge) || [], country: s.country, name } });
  if (!rec.payment.duplicate) rec.outcome = await B.paymentOutcome(db, entity, k.payment, rec.payment.payment_id, rec.allocation, name);
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
    L().warn('books.withdraw-not-reversed', { chit_id, entity_id: entity, why: err.message });
    return { refused: err.message };
  }
}

/**
 * F10 · receiptFacts(db, entity, bj) → { party, theirInvoice } for my receipt of their bill, on the caller's handle:
 *   party         the supplier: the id the counter picked, else the ONE supplier on my list whose name is the name typed at the door
 *                 (case and spaces aside) — two of the same name is nobody, as at the counter (custKnown)
 *   theirInvoice  a bill the supplier SENT me for the same order — the receipt was against their bill chit itself, or against my order
 *                 that their counter bill names (business_json.order.from, lib/open-orders MARKS_SQL) — { chit_id, no }, else null
 */
async function receiptFacts(db, entity, bj) {
  const out = { party: require('./tax-copy').capturedPartyId(bj), theirInvoice: null, candidates: [] };
  const name = String((bj.party && bj.party.name) || '').trim();
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
  const on = bj.against && bj.against.chit_id ? String(bj.against.chit_id) : null;
  if (on) {
    const r = await db.query(
      `SELECT chit_id, COALESCE(business_json->>'bill_no', business_json->>'invoice_no', business_json->>'doc_no', manual_subject) AS no FROM chit_header
        WHERE entity_id = $1 AND purpose = 'invoice' AND sender_entity_id IS DISTINCT FROM $1
          AND (chit_id::text = $2 OR business_json->'order'->>'from' = $2) LIMIT 1`,
      [entity, on]
    );
    if (r.rows[0]) out.theirInvoice = { chit_id: String(r.rows[0].chit_id), no: r.rows[0].no || null };
  }
  return out;
}

/**
 * ⭐ ORD-FIX O4 — A BILL I ACCEPTED AND THEN REJECTED / CANCELLED TAKES ITS POSTING BACK. The rail allows accepted → rejected (damaged stock found
 * the next day); the purchase, the creditor and the input tax were already in the books and the screen said "not posted". The bill's own entries
 * (source_ref chit:<id>…, not reversed yet) are reversed through the ONE reversal writer (books.reverseEntry → postEntry, idempotent on
 * reverse:<entry>), with the status as the reason. A payment made against the bill is NOT touched — it has its own entry to reverse by hand.
 * → number of entries reversed (0 when nothing had posted — the usual case).
 */
async function reverseIfPosted(entity, chit_id, reason, by) {
  const entryIds = await withEntity(entity, (db) => S.unreversedForChit(db, entity, chit_id));
  let reversed = 0;
  for (const entry_id of entryIds) {
    const out = await B.reverseEntry(null, entity, entry_id, { by, reason });
    if (out && out.ok) reversed++;
  }
  return reversed;
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
    const why = 'Could not read your catalogue to tell what bill ' + (businessJson.bill_no || '') + ' is for (' + reason + ') — it posts on the next try';
    if (!options.retry)
      await park(
        entity,
        { job: 'chit', chit_id, kind: 'purchase', ref: businessJson.bill_no || null, counter: null, waiting: 'use' },
        why,
        chit_id,
        'chit:' + chit_id
      );
    return { parked: { queued: true, why } };
  }
}

/**
 * ORD-FIX O4 — the refused branch of postChit: a bill the buyer rejected / cancelled that had posted when it was accepted gets its posting reversed first
 * (k.why is reworded to say so). → null to carry on and close the Waiting row, or a queued answer when the reversal failed (the row stays open to retry).
 */
async function takeBackRefused(entity, chit_id, copy, verdict, by) {
  if (!(verdict.kind === 'none' && verdict.done && REFUSED.test(String(copy.current_status || '')))) return null;
  try {
    const undone = await reverseIfPosted(entity, chit_id, verdict.why + ' (the bill was posted when it was accepted)', by);
    if (undone) verdict.why = verdict.why.replace(' — not posted', ' — its posting was reversed');
    return null;
  } catch (e) {
    cbLog.fellBack('books-hooks postChit: the reversal of a rejected bill failed — left open to try again', e);
    return { queued: true, why: 'This bill was rejected after it posted, and its posting could not be reversed yet — it tries again.' };
  }
}

/** one chit, read as MY copy and classified; returns what happened (never throws) */
async function postChit(entity, chit_id, opt) {
  const o = opt || {};
  const s = o.setting || (await isOn(entity));
  if (!s) return { off: true };
  try {
    const TC = require('./tax-copy');
    const copy = await TC.copyOf(chit_id, entity);
    if (!copy) return { none: true };
    let bjc = copy.business_json || {};
    /* ⭐ F10: my receipt of their bill — which supplier it is, and whether their own invoice for the same order is already here
       (ONE transaction, two reads; only for a receipt that carries their bill) */
    let rcv = null;
    if (TC.capturedBill(copy, entity)) {
      rcv = await withEntity(entity, (db) => receiptFacts(db, entity, bjc));
      if (rcv.party && !TC.capturedPartyId(bjc))
        copy.business_json = bjc = Object.assign({}, bjc, { party: Object.assign({}, bjc.party, { party_id: rcv.party }) });
    }
    const entry =
      copy.purpose === 'expense' || copy.purpose === 'income' || bjc.summary || bjc.kind === 'payment_received' ? {} : await TC.entryFor(copy, entity);
    /* ⭐ a bill I RECEIVED waits for my acceptance and for any open dispute to settle (buyerGate) — the dispute is read
       only for a copy that is not mine to sell, so the seller's hot path costs nothing more */
    const mine = !!entry.sells && !(entry.me && entry.me.entity_id && copy.sender_entity_id && String(copy.sender_entity_id) !== String(entry.me.entity_id));
    const disputed = entry.invoice && !mine ? (await withEntity(entity, (db) => S.openDisputes(db, entity, chit_id))) > 0 : false;
    /**
     * ⭐ WHAT A COUNTER BILL I BOUGHT IS FOR (lib/bill-use) — asked only once it is mine to post (accepted): the buyer's
     * choice, else my own catalogue line by line. A catalogue that cannot be read parks the bill, named — never "all expense".
     */
    const usesRead = await readUses(entity, chit_id, copy, bjc, mine, o);
    if (usesRead.parked) return usesRead.parked;
    const uses = usesRead.uses;
    /* the asset register exists? (b280 is a DRAFT) — asked only for a bill with an asset line; a failed read is "no", so it queues as before */
    let assets = false;
    if (uses && uses.lines && uses.lines.some((item) => item.use === 'asset'))
      assets = await withEntity(entity, (db) => Assets.exists(db, entity)).catch(cbLog.orElse('books-hooks postChit: the read failed — answered no', false));
    const k = classify({
      chit: copy,
      entry,
      setting: s,
      status: copy.current_status,
      disputed,
      uses,
      assets,
      party: rcv ? rcv.party : undefined,
      theirInvoice: rcv ? rcv.theirInvoice : undefined,
      candidates: rcv ? rcv.candidates : undefined
    });
    /* F10: their invoice is the bill — the receipt is the goods record, done, with the sentence that says why (the ONE status writer) */
    const stuck = await takeBackRefused(entity, chit_id, copy, k, o.by);
    if (stuck) return stuck;
    if (k.kind === 'none' && k.done) {
      await closeDone(entity, [chit_id], k.why);
      return { none: true, why: k.why };
    }
    if (k.kind === 'none') {
      /* a week / month summary chit is the record itself — nothing to post, nothing left to wait for */
      if (purpose0(copy) === 'general' && copy.business_json && typeof copy.business_json.summary === 'object')
        await closeDone(entity, [chit_id], 'A summary — filed');
      return { none: true };
    }
    /* the Waiting row carries what the screen needs to open the chit (waitingRow → source) */
    const job = Object.assign(
      k.wait || k.supplier_check
        ? {
            job: 'chit',
            chit_id,
            kind: 'purchase',
            ref: bjc.bill_no || bjc.printed_as || bjc.invoice_no || (bjc.their_bill && bjc.their_bill.no) || null,
            counter: null,
            waiting: k.wait || 'supplier'
          }
        : { job: 'chit', chit_id },
      todoFields(k)
    );
    /* a retry hands back what the wait asks (todo · name · candidates) too: the outbox row's event follows the bill (retryOutbox → outboxDone) */
    if (k.kind === 'queue') {
      if (!o.retry) await park(entity, job, k.why, chit_id, 'chit:' + chit_id);
      return Object.assign({ queued: true, why: k.why, wait: job.waiting || null }, todoFields(job));
    }
    /**
     * ⚠️⚠️ THE SELLER MUST BE ON MY SUPPLIER LIST (Athi, 2026-10-01: "it should not be automatic"). Never added here —
     * the purchase waits, named, and posts on the next retry / nightly sweep once the owner has added them.
     * (A duplicate of an entry already posted is answered by postEntry before this matters — the check runs first only
     *  because a party that left the list must not receive a NEW bill.)
     */
    if (k.supplier_check && k.event && k.event.party) {
      const nestedDone = await withEntity(entity, (db) => S.entryBySource(db, entity, k.event.source_ref));
      /* several events (a bill partly for use): a duplicate only when EVERY one has posted — a retry posts the rest */
      let allDone = !!nestedDone;
      if (allDone && k.events && k.events.length > 1) {
        /* ONE read for the rest (postedSources), never one per event */
        const rest = k.events.slice(1).map((item) => item.source_ref);
        const got = await withEntity(entity, (db) => S.postedSources(db, entity, rest));
        allDone = rest.every((item) => (got || []).indexOf(item) >= 0);
      }
      if (allDone) {
        /* a register row that failed on the first try is made now — idempotent on (entry, name) */
        for (const ev of k.events || [k.event])
          if (ev && ev.asset_register)
            await registerAssets(entity, ev, await withEntity(entity, (db) => S.entryBySource(db, entity, ev.source_ref)), chit_id, o);
        return { ok: true, duplicate: true, entry_id: nestedDone.entry_id, entry_no: nestedDone.entry_no };
      }
      const on = await withEntity(entity, (db) => S.partyOn(db, entity, k.event.party));
      if (!on || !on.supplier) {
        const text = sellerNameOf(entry.sells ? null : entry) + ' is not on your supplier list — add them, then this posts';
        const named = text.charAt(0).toUpperCase() + text.slice(1);
        if (!o.retry) await park(entity, job, named, chit_id, 'chit:' + chit_id);
        return { queued: true, why: named };
      }
    }
    if (k.kind === 'day') {
      const dr = await postDay(entity, k.counter, k.day, { setting: s, retry: o.retry, by: o.by });
      /* the day summary chit is done once its day is in the books (posted, already posted, or nothing to post) */
      if (posted(dr)) await closeDone(entity, [chit_id], 'The day is posted — done');
      return dr;
    }
    if (k.kind === 'payment') {
      try {
        return await withEntity(entity, (db) => recordChitPayment(db, entity, k.payment, { by: o.by }));
      } catch (e) {
        if (o.retry) throw e;
        await park(entity, { job: 'chit', chit_id }, String((e && e.message) || e), chit_id, 'chit:' + chit_id);
        return { queued: true, why: String((e && e.message) || e) };
      }
    }
    if (k.kind === 'walkin') {
      /**
       * a walk-in bill whose day is ALREADY posted and does not NAME it is a late bill: its own catch-up entry for that
       * day, never a rewrite of the day (SPEC-books v1, the late-bill rule).
       * ⚠️⚠️ "LATE" IS DECIDED BY THE DAY'S OWN LIST (critic M7), not by comparing times: a bill in flight when the day was
       *   read has an EARLIER created_at and was still not in the read — it answered "waiting: day close" for ever.
       *   (An entry with no list — none is written any more — falls back to the old comparison.)
       */
      const day = await withEntity(entity, (db) => S.entryBySource(db, entity, 'walkin:' + k.counter + ':' + k.day));
      if (!day) return waitsForDayClose(entity, chit_id, k);
      const covered = Array.isArray(day.source_chit_ids)
        ? day.source_chit_ids.map(String).indexOf(String(chit_id)) >= 0
        : new Date(day.created_at) >= new Date(copy.created_at);
      if (covered) {
        await closeDone(entity, [chit_id], 'Posted in the day summary — done');
        return { ok: true, covered: true, entry_no: day.entry_no };
      }
      const ev = Object.assign(E.posting().daySummary([k.bill], { ref: 'late ' + chit_id, date: k.day, counter: k.counter }, { pack: booksPack(s) }), {
        source_ref: 'walkin-late:' + chit_id,
        source_chit_id: chit_id,
        counter: k.counter,
        by: o.by,
        narration: 'A walk-in bill that arrived after its day was posted'
      });
      const late = await postOrPark(entity, ev, { job: 'chit', chit_id }, o);
      if (posted(late)) await closeDone(entity, [chit_id], 'Posted as a late walk-in — done');
      return late;
    }
    if (k.event.type === 'return' && k.event.against_bill && k.event.party) {
      const orig = await withEntity(entity, (db) =>
        db.query(`SELECT chit_id FROM chit_header WHERE entity_id = $1 AND sender_entity_id = $1 AND business_json->>'bill_no' = $2 LIMIT 1`, [
          entity,
          String(k.event.against_bill)
        ])
      );
      if (orig.rows[0]) k.event.against_ref = orig.rows[0].chit_id;
    }
    delete k.event.against_bill;
    if (k.events && k.events.length > 1) {
      /* ⭐ in turn, each through the one writer (idempotent on its own source); the first failure parks the bill and
         stops — a retry finds what posted as duplicates and posts the rest */
      const nestedPosted = [];
      for (const ev of k.events) {
        const r = await postOrPark(entity, Object.assign(ev, { by: o.by }), { job: 'chit', chit_id }, o);
        await registerAssets(entity, ev, r, chit_id, o);
        nestedPosted.push(Object.assign({ type: ev.type, source_ref: ev.source_ref }, r));
        if (r && r.queued) return Object.assign({ queued: true, why: r.why }, { posted: nestedPosted });
      }
      if (k.supplier_check) await closeDone(entity, [chit_id], 'Accepted — posted to the books');
      return Object.assign({ ok: true }, nestedPosted[0], { posted: nestedPosted });
    }
    const done = await postOrPark(entity, Object.assign(k.event, { by: o.by }), { job: 'chit', chit_id }, o);
    await registerAssets(entity, k.event, done, chit_id, o);
    if (k.event.type === 'walkin_day' && posted(done)) await closeDone(entity, [chit_id], 'Posted as a walk-in entry — done');
    /* FX-F10W2: the acceptance that posted a bill I received closes its own Waiting row (no retry needed) */
    else if (k.supplier_check && posted(done)) await closeDone(entity, [chit_id], 'Accepted — posted to the books');
    return done;
  } catch (e) {
    if (!o.retry) await park(entity, { job: 'chit', chit_id }, String((e && e.message) || e), chit_id, 'chit:' + chit_id);
    return { queued: true, why: String((e && e.message) || e) };
  }
}
/**
 * ⭐ THE REGISTER ROW FOLLOWS THE POSTED PURCHASE (year-book §9 gap 4): once an asset purchase has an entry (or answers a duplicate of one),
 * each of its assets is added to the register — idempotent on (entry, name), so a retry makes no second row. A failure here never fails
 * the bill (the books are right; the entry exists): it is logged, and the next retry of the chit makes the row.
 */
async function registerAssets(entity, ev, r, chit_id, o) {
  if (!ev || !Array.isArray(ev.asset_register) || !r || !r.entry_id) return;
  try {
    const cur = ev.currency || null;
    await withEntity(entity, async (db) => {
      for (const a of ev.asset_register) {
        await Assets.add(db, entity, {
          name: a.name,
          asset_class: ev.asset_class,
          cost_minor: Math.round(a.cost * Math.pow(10, MONEY.decimals(cur))),
          currency: cur,
          put_to_use: ev.put_to_use,
          source_entry_id: r.entry_id,
          source_chit_id: chit_id,
          by: o && o.by
        });
      }
    });
  } catch (e) {
    L().warn('books.asset-register-failed', { entity_id: entity, chit_id, error: String(e && e.message) });
  }
}
async function postOrPark(entity, ev, job, o) {
  try {
    const r = await B.postEntry(null, entity, ev);
    return r;
  } catch (e) {
    if (!o.retry) await park(entity, job, String((e && e.message) || e), ev.source_chit_id, ev.source_ref);
    if (o.retry) throw e;
    return { queued: true, why: String((e && e.message) || e) };
  }
}

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
/* W2-RAIL R2: the status words are the ONE table (lib/rail-actions OPEN_STATES, read off the rail's transitions) — never spelled here */
const { OPEN_STATES } = require('./rail-actions');
const mover = { fn: null };
async function closeDone(entity, ids, note) {
  const list = Array.from(new Set((ids || []).filter(Boolean).map(String)));
  if (!list.length) return 0;
  let moved = 0;
  /* ⭐ FX-F10W2: THE CHIT'S OWN WAITING ROW CLOSES IN THE SAME PATH — accepted and posted, rejected, their invoice is the bill — with the
     sentence that says why (books-store outboxClose, one statement). Before, only "Try again" or the nightly retry closed it. */
  try {
    await withEntity(entity, (db) => S.outboxClose(db, entity, list, note || 'Posted to the books — done'));
  } catch (e) {
    L().warn('books.outbox-close-failed', { entity_id: entity, ids: list, error: String(e && e.message) });
  }
  try {
    const r = await withEntity(entity, (db) =>
      db.query(
        `SELECT cs.chit_id FROM chit_status cs JOIN chit_header h ON h.chit_id = cs.chit_id AND h.entity_id = cs.entity_id
        WHERE cs.entity_id = $1 AND cs.direction = 'received' AND h.sender_entity_id = $1
          AND cs.chit_id = ANY($2::uuid[]) AND cs.current_status = ANY($3::text[])`,
        [entity, list, OPEN_STATES]
      )
    );
    const mv = mover.fn || require('./chit-move').moveStatus;
    for (const x of r.rows) {
      try {
        const res = await mv(entity, x.chit_id, 'completed', { id: entity, name: 'The books' }, note || 'Posted to the books — done', {
          level: 'editor',
          holder: null
        });
        if (res && res.moved !== false && (res.code === undefined || res.code === 200)) moved++;
      } catch (e) {
        L().warn('books.close-failed', { entity_id: entity, chit_id: x.chit_id, error: String(e && e.message) });
      }
    }
  } catch (e) {
    L().warn('books.close-read-failed', { entity_id: entity, error: String(e && e.message) });
  }
  return moved;
}
/** the walk-in post's outcome counts as posted when it was not parked */
const posted = (r) => !!r && !r.queued && !r.off && !r.waiting;

/** a walk-in bill whose day is not in the books yet: LOGGED (ACC-199 — it was silent), answered as waiting; the to-do row says it to the owner (waitingWalkIns) */
function waitsForDayClose(entity, chit_id, walkin) {
  L().info('books.walkin-waiting-day-close', { entity_id: entity, chit_id, counter: walkin.counter, day: walkin.day });
  return { waiting: 'day close' };
}
/**
 * dayFold(entity, counter, day, s) → { take: [{ id, bill }], skipped } — the ONE read of what a counter's walk-in day holds: the counter's bills of the shop's day,
 * each classified, those that already posted on their own left out. postDay posts exactly these; waitingWalkIns (the to-do) counts exactly these.
 */
async function dayFold(entity, counter, shopDay, setting) {
  const bounds = dayBounds(shopDay, setting); /* the shop's zone — M210 */
  const rows = await withEntity(entity, (db) => S.counterBills(db, entity, counter, bounds.from, bounds.to));
  const TC = require('./tax-copy');
  const found = [],
    skipped = [];
  for (const r of rows) {
    const k = classify({ chit: r, entry: await TC.entryFor(r, entity), setting: Object.assign({}, setting, { walkin_grain: 'day' }) });
    if (k.kind === 'walkin') found.push({ id: String(r.chit_id), bill: k.bill });
    else if (k.kind === 'queue') skipped.push(k.why);
  }
  /* a bill that already posted on its own (the grain was "bill" when it was saved, or it came late) never rides the day too */
  const own = found.length
    ? await withEntity(entity, (db) =>
        S.postedSources(
          db,
          entity,
          found.reduce((total, item) => total.concat(['bill:' + item.id, 'walkin-late:' + item.id]), [])
        )
      )
    : [];
  const take = found.filter((item) => own.indexOf('bill:' + item.id) < 0 && own.indexOf('walkin-late:' + item.id) < 0);
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
async function postDay(entity, counter, day, opt) {
  const o = opt || {};
  const s = o.setting || (await isOn(entity));
  if (!s) return { off: true };
  const job = { job: 'day', counter, day };
  try {
    /* ⚠️⚠️ GRAIN "bill": every walk-in bill posts as its own entry (bill:<chit>) — the day must not post them again
       (critic M4: one ₹118 cash bill, two entries, Sales ₹200). The nightly job and the day summary both come through here. */
    if (s.walkin_grain === 'bill') return { ok: true, empty: true, grain: 'bill' };
    const done = await withEntity(entity, (db) => S.entryBySource(db, entity, 'walkin:' + counter + ':' + day));
    if (done) {
      await closeDone(entity, done.source_chit_ids, 'Posted in the day summary — done');
      return { ok: true, duplicate: true, entry_no: done.entry_no };
    }
    const { take, skipped } = await dayFold(entity, counter, day, s);
    const bills = take.map((item) => item.bill);
    if (!bills.length) return { ok: true, empty: true, skipped };
    /* ⭐ the day NAMES the bills it covers (source_chit_ids) — that list, not a clock, decides what is late (postChit) */
    const ev = Object.assign(E.posting().daySummary(bills, { ref: 'walkin ' + counter + ' ' + day, date: day, counter }, { pack: booksPack(s) }), {
      source_ref: 'walkin:' + counter + ':' + day,
      source_chit_ids: take.map((item) => item.id),
      counter,
      by: o.by,
      narration: 'Walk-in sales, counter ' + counter + ', ' + day + ' (' + bills.length + ' bills)'
    });
    const dayRes = await postOrPark(entity, ev, job, o);
    if (posted(dayRes))
      await closeDone(
        entity,
        take.map((item) => item.id),
        'Posted in the day summary — done'
      );
    return dayRes;
  } catch (e) {
    if (!o.retry) await park(entity, job, String((e && e.message) || e), null, 'walkin:' + counter + ':' + day);
    if (o.retry) throw e;
    return { queued: true, why: String((e && e.message) || e) };
  }
}

/**
 * ⭐⭐⭐ afterChit(entity, chit_id, by) — called by routes/chits.js AFTER the commit, not awaited. Never rejects.
 */
function afterChit(entity, chit_id, by) {
  return (async () => {
    const s = await isOn(entity);
    if (!s) return { off: true };
    return postChit(entity, chit_id, { setting: s, by });
  })().catch((e) => {
    L().warn('books.hook-failed', { entity_id: entity, chit_id, error: String(e && e.message) });
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
  for (const r of rows) {
    out.tried++;
    const j = r.event || {};
    let ok = false,
      why = null,
      ev = null;
    try {
      const res =
        j.job === 'day'
          ? await postDay(entity, j.counter, j.day, { retry: true })
          : j.job === 'chit'
            ? await postChit(entity, j.chit_id, { retry: true })
            : j.job === 'event'
              ? await B.postEntry(null, entity, j.event)
              : null;
      ok = !!res && !res.queued && !res.off;
      if (res && res.queued) why = res.why;
      /* still waiting: what it asks NOW rides the row (a bill accepted but still unposted moves from accept to what stops it) */
      if (!ok) ev = Object.assign(res && res.wait !== undefined ? { waiting: res.wait } : {}, { name: null, candidates: [] }, todoFields(res));
    } catch (e) {
      why = String((e && e.message) || e);
      ev = { todo: 'record', name: null, candidates: [] };
    }
    await withEntity(entity, (db) => S.outboxDone(db, entity, r.id, ok, why || r.why, ev));
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
  const j = x.event || {};
  const todo = TODOS.indexOf(x.todo || j.todo) >= 0 ? x.todo || j.todo : 'record';
  /* ⭐ `source` — the same shape the Day book's entries carry, so the screen opens the chit the row is waiting on */
  return Object.assign({ short: shortOf(j.short) /* R106: their figure, the count, the gap (integers) on a shortfall wait; else null */ }, {
    id: x.id,
    chit_id: x.source_chit_id || null,
    ref: x.source_ref || null,
    reason: x.why || null,
    tries: Number(x.tries) || 0,
    since: x.created_at,
    job: j.job || null,
    todo,
    name: todo === 'add_supplier' ? x.name || j.name || null : null,
    /* the shop's near matches for a supplier to add (books-store supplierByName): names + party_no only; [] on every other row */
    candidates:
      todo === 'add_supplier' && Array.isArray(j.candidates)
        ? j.candidates.slice(0, 3).map((item) => ({ name: String(item.name || ''), party_no: item.party_no || null }))
        : [],
    source: { chit_id: x.source_chit_id || j.chit_id || null, ref: j.ref || null, kind: j.kind || j.job || null, counter: j.counter || null, by: j.by || null }
  });
}

const purpose0 = (c) => String((c && c.purpose) || '');
module.exports = {
  reverseIfPosted,
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
  _expire
}; /* partyFromCustomer: the ONE reading of whom a counter bill names (routes/chits.js send, FX-L2C) */
