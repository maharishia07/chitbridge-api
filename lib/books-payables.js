// OWNS      CB Finance payables: each supplier's open bills aged by the engine's due-date set (India also its MSME set), the India MSME day-45 flag and risk, and the supplier's early-pay offer with its owner journal; nothing posts by itself
// FLOW      GET /api/books/dues?side=supplier&finance=1 ──▶ books-cashflow.datedSide(out) ──▶ bucket + CBReceivables.msmeFlags / earlyDiscount ──▶ payable per supplier
// @stage tested
// @stage-note [CB FINANCE F4] What WE owe: each supplier's open bills aged 0-30 / 31-45 / 46-60 / 60+, MSME day 45 and its risk (India),
// @stage-note the supplier's own early-pay offer, and the ready owner journal that records the discount. Finance suggests; nothing posts by itself.
'use strict';
/**
 * lib/books-payables.js — CB FINANCE · PAYABLES (round F4, CB-FINANCE-PLAN §4). GET /api/books/dues?side=supplier&finance=1 adds `payable` to each
 * supplier row and `payables` beside the parties (routes/books.js). Collections' mirror, never a copy: the same route, the same rows.
 *
 * ⭐ ONE CALCULATION (rule 2): the bills are F3's own — books-cashflow.datedSide('out'): undisputed open bills, net of the cheques already written
 *   against them (C3, oldest due first by CBReceivables.propose). So the Payables total IS the cash view's outgoing dues; tests/books-payables.test.cjs
 *   holds the two equal. Day 45 is CBReceivables.msmeFlags (the India pack's checks.msme: min(the agreed days, 45)) — asked at a far horizon so EVERY
 *   open bill comes back with its limit_days; the risk is only "7 days or less left". The offer is CBReceivables.earlyDiscount. Money words are
 *   bill-privacy.money, dates books.dateWords. Nothing here re-derives a due date, a limit or a percentage.
 * ⭐ NEW PATHS (rule 4): setView() / bandMap() — the engine's named sets as the screen paints them, and each bill's key from CBLedger.ageing (no edge here).
 *   view() — shapes one supplier's bills; read() — the two reads the dues route did not make (UDYAM ids · supplier terms) + the cheques written.
 * ⚠️ MSME IS INDIA-ONLY: the pack decides (a pack with no checks.msme answers null). A shop whose country has no pack falls back to India in
 *   regulation.lookup — flagged `fallback` — and gets NO MSME flag (never a guess). Udyam is a micro / small / medium registration; s.15 binds
 *   micro and small only — the words say so is for a CA to confirm.
 * ⚠️ THE DISCOUNT: a gross journal the OWNER presses (Dr the supplier against the bill · Cr Discount received) through POST /entries with against_ref —
 *   postEntry settles that bill (lib/books.js itemsFor → confirmItems). The GST credit note is the supplier's to issue and the owner's to confirm: never
 *   posted here (`gst_note.ok` false, with the sentence).
 * called by: routes/books.js (dues?side=supplier&finance=1)
 * CARD 16-finance/books-cashflow
 */
const cashflow = require('./books-cashflow');
const engines = require('./books-engines');

const { day: dayNumber, ymd: isoDate } = cashflow;
const RISK_DAYS = 7; /* "day 45 is within 7 days or past" (the brief, owner 2026-10-10) */
const HORIZON = 3650; /* msmeFlags flags a bill once it is past its limit: asked ten years on, every open bill is, with its limit_days */
/** the books' one word for a held / released bill (routes/books.js POST /parties/:id/dispute says it, Payables paints it on the held row) */
const STATUS_WORDS = { disputed: 'Held — in dispute with you', undisputed: 'Released — payable again' };
const money = (minor, cur) => require('./bill-privacy').money(minor, cur);
const dateWords = (d) => require('./books').dateWords(d);
const nameOf = (names, pid) => {
  const p = names && names.get(String(pid));
  return (p && (p.nickname || p.name)) || 'this supplier';
};

/**
 * ⭐ THE BUCKETS ARE THE ENGINE'S (RC11, Athi 28 Nov 2026: "due date default with MSME view for India"): the ONE default set is CBLedger's 'followup' (days past DUE) for every
 * country; India (the MSME pack) ALSO gets the named 'msme' set (days since the BILL, the MSMED s.15 45-day rule). This file holds no edge and no key: the keys and edges come from
 * the engine, the words are made from its edges (setView), each bill's key from CBLedger.ageing (bandMap, one document per party id, as books-bill-bands does).
 */
const ledger = () => engines.ledger();
const SET_OF = { due: { name: 'followup', late: true, title: 'By due date' }, msme: { name: 'msme', late: false, title: 'MSME (45-day)' } };
/** the words of one bucket from its edges: [null,null] not due yet · [a,b] a–b days · [a,null] over a-1 days; a due-date set says "late" */
function rangeWords(range, late) {
  const [from, to] = range,
    tail = late ? ' days late' : ' days';
  if (from === null && to === null) return 'Not due yet';
  return to === null ? 'Over ' + (from - 1) + tail : (from === null ? 0 : from) + '–' + to + tail;
}
/** one set as the screen paints it: { name, title, keys: [{ key, label }] } — keys and edges from the engine, never spelled here */
function setView(which) {
  const def = SET_OF[which],
    list = which === 'msme' ? ledger().AGE_MSME : ledger().AGE_FOLLOWUP;
  return { name: def.name, title: def.title, keys: list.map((item) => ({ key: item[0], label: rangeWords(item[1], def.late) })) };
}
/** each open bill's bucket key in one engine set: { ref → key } — the engine ages the documents, one per party id so each bill is its own row */
function bandMap(items, asOf, which) {
  const aged = ledger().ageing(
      items.map((item) => ({ ref: item.ref, party: item.ref, date: item.bill_date || item.due_date, due_date: item.due_date, outstanding_minor: item.amount_minor })),
      asOf,
      'payable',
      { set: SET_OF[which].name }
    ),
    out = Object.create(null);
  Object.keys(aged.by_party).forEach((ref) => {
    out[ref] = aged.bucket_keys.find((key) => aged.by_party[ref].undisputed[key] || aged.by_party[ref].disputed[key]) || null;
  });
  return out;
}
/** a zero count for every key of a set (null when the set is not asked for) */
const zeroFor = (view) => (view ? view.keys.reduce((sum, entry) => ((sum[entry.key] = 0), sum), {}) : null);

/** R106: each bill's own one-line word (party_item.note on the bill's row — "₹250 short against their ₹2,940"), by ref, from the same items */
function billNotes(items) {
  const out = Object.create(null);
  (items || []).forEach((item) => {
    if (item.note && String(item.ref) === String(item.against_ref)) out[String(item.ref)] = String(item.note);
  });
  return out;
}
/** the pack this shop's MSME check is read from — null when the country has no pack of its own (a fallback is never India by guess) */
function msmePack(country) {
  const R = require('./regulation'),
    pk = R.resolve({ country: country || undefined });
  return pk && !pk.fallback && pk.checks && typeof pk.checks.msme === 'function' ? pk : null;
}

/** the MSME day-45 words for one bill: the pay-by day, days left, whether it is at risk, and the sentence the owner reads */
function msmeFields(billDate, limitDays, today) {
  const day45 = isoDate(dayNumber(billDate) + limitDays),
    daysLeft = dayNumber(day45) - today;
  return {
    msme_day45: day45,
    msme_days_left: daysLeft,
    msme_risk: daysLeft <= RISK_DAYS,
    msme_words:
      daysLeft >= 0
        ? 'Pay by ' + dateWords(day45) + ' — after that this bill cannot be claimed as an expense this year (Income-tax s.43B(h)).'
        : 'Day 45 was ' + dateWords(day45) + ' — this bill is an expense only in the year you pay it (Income-tax s.43B(h)).'
  };
}
/** one open bill's row: its age and bucket, with the MSME day-45 fields when the pack gave it a limit (the early-pay offer is added by the caller) */
function billRow(item, today, limitDays, bands) {
  const billDate = item.bill_date || item.due_date,
    ageDays = today - dayNumber(billDate),
    bill = {
      ref: item.ref,
      date: billDate,
      due_date: item.due_date,
      open_minor: item.amount_minor,
      age_days: ageDays,
      bucket: bands.due[item.ref],
      bucket_msme: bands.msme ? bands.msme[item.ref] : null,
      overdue: !!item.overdue,
      msme_day45: null,
      msme_days_left: null,
      msme_risk: false,
      msme_words: null,
      early: null
    };
  return limitDays == null ? bill : Object.assign(bill, msmeFields(billDate, limitDays, today));
}
/** the ready owner journal that records an early-pay discount (Dr the supplier · Cr Discount received), or the sentence for a chart without the ledger */
function earlyRecord(item, saveMinor, ctx) {
  if (!(ctx.cred && ctx.disc)) return { ok: false, why: 'no_ledger', say: 'Your chart has no Discount received ledger. Add it in Accounts.' };
  return {
    ok: true,
    body: {
      narration: 'Early-pay discount from ' + ctx.name + ' (' + ctx.early.pct + '%)',
      against_ref: item.ref,
      client_ref: 'early:' + item.ref,
      lines: [
        { account: String(ctx.cred.code), party: ctx.pid, dr_minor: saveMinor, cr_minor: 0 },
        { account: String(ctx.disc.code), dr_minor: 0, cr_minor: saveMinor }
      ]
    }
  };
}
/** the supplier's own early-pay offer on one bill with its words, journal and GST-note ask (null when there is no offer) — the ONE earlyOffer helper Collections reads too (R76) */
function earlyBlock(bill, item, ctx) {
  const offer = engines.earlyOffer({ date: bill.date, open_minor: item.amount_minor }, ctx.asOf, ctx.currency, ctx.early);
  if (!offer) return null;
  const save = offer.save_minor,
    early = Object.assign(offer, {
      words: offer.valid ? ctx.early.pct + '% off if paid by ' + dateWords(offer.by) + ' — saves ' + money(save, ctx.currency) : 'Early-pay ended on ' + dateWords(offer.by),
      record: null,
      gst_note: null
    });
  if (early.valid) {
    early.record = earlyRecord(item, save, ctx);
    early.gst_note = { ok: false, why: 'owner_confirms', say: 'Ask ' + ctx.name + ' for a GST credit note. You confirm it when it comes.' };
  }
  return early;
}
/** the MSME limit_days of every open bill of an MSME supplier — the pack's own rule, asked ten years on so every bill comes back with its limit */
function msmeLimits(side, ctx) {
  const limit = Object.create(null);
  if (!ctx.pack) return limit;
  const debits = side.dated
    .filter((item) => ctx.msme.has(String(item.party_id)))
    .map((item) => ({ id: item.ref, party: item.party_id, date: item.bill_date || item.due_date, due: item.due_date, balance: item.amount_minor }));
  (ctx.receivables.msmeFlags({ debits }, isoDate(ctx.today + HORIZON), { on: true, pack: ctx.pack }) || []).forEach((item) => {
    limit[item.debit] = item.limit_days;
  });
  return limit;
}
/** how soon a supplier needs paying: 'msme' (day 45 near) · 'overdue' · 'week' (due in 7 days) · 'later' */
function groupOf(partyRow, today) {
  if (partyRow.msme_risk) return 'msme';
  if (partyRow.bills.some((item) => item.overdue)) return 'overdue';
  return partyRow.bills.some((item) => dayNumber(item.due_date) - today <= RISK_DAYS) ? 'week' : 'later';
}
/** a supplier's summary once its bills are in: MSME risk and words, the day to pay by, its group and its best early-pay offer */
function settleParty(partyRow, today) {
  partyRow.bills.sort((first, second) => String(first.msme_day45 || first.due_date).localeCompare(String(second.msme_day45 || second.due_date)));
  const risk = partyRow.bills.filter((item) => item.msme_risk);
  partyRow.msme_risk = risk.length > 0;
  partyRow.msme_words = risk.length ? risk[0].msme_words : null;
  partyRow.pay_by = partyRow.bills.map((item) => (item.msme_day45 && item.msme_day45 < item.due_date ? item.msme_day45 : item.due_date)).sort()[0] || null;
  partyRow.group = groupOf(partyRow, today);
  partyRow.early =
    partyRow.bills
      .filter((item) => item.early && item.early.valid)
      .sort((first, second) => second.early.save_minor - first.early.save_minor)
      .map((item) => Object.assign({ ref: item.ref }, item.early))[0] || null;
}
/**
 * ⭐ view(x) — x: { asOf, currency, country, payable_items, cheques (held), names: Map, msme: Set(party_id), terms: Map(party_id → supplier_list row
 *   { credit_days, terms }), chart: [{ code, role }] }
 * → { total_minor, by_party: { [party_id]: { total_minor, buckets, msme, msme_risk, msme_words, pay_by, group, terms, early, bills: [...] } } }
 *   bill: { disputed (held, R106: listed but NOT in any total — only on a held bill, with held_words), ref, date, due_date, open_minor, age_days, bucket, overdue, msme_day45, msme_days_left, msme_risk, msme_words, note (the bill's own word, R106),
 *           early: null | { pct, within_days, by, valid, save_minor, pay_minor, words, record, gst_note } }
 * group: 'msme' (MSME at risk) · 'overdue' · 'week' (due in 7 days) · 'later'. pay_by: the earliest day that matters (day 45 when MSME, else the due date).
 */
function view(x) {
  const currency = require('./country-setup').currencyStated(x.currency),
    asOf = x.asOf,
    today = dayNumber(asOf),
    receivablesEngine = engines.receivables();
  const side = cashflow.datedSide('out', x.payable_items || [], x.cheques || [], [], { currency: currency, asOf });
  const pack = msmePack(x.country),
    msme = x.msme || new Set(),
    terms = x.terms || new Map(),
    chart = x.chart || [];
  const role = (r) => chart.find((item) => item.role === r);
  const cred = role('creditors'),
    disc = role('discount_received');
  const limit = msmeLimits(side, { pack, msme, receivables: receivablesEngine, today });
  const sets = { due: setView('due'), msme: pack ? setView('msme') : null },
    every = side.dated.concat(side.uncounted.disputed_bills || []),
    bands = { due: bandMap(every, asOf, 'due'), msme: pack ? bandMap(every, asOf, 'msme') : null };
  const by_party = Object.create(null);
  let total = 0;
  side.dated.forEach((item) => {
    const pid = String(item.party_id),
      ownTerms = terms.get(pid) || {},
      early = (ownTerms.terms && ownTerms.terms.early) || null;
    const bill = billRow(item, today, limit[item.ref], bands);
    bill.early = earlyBlock(bill, item, { early, asOf, currency, cred, disc, pid, name: nameOf(x.names, pid) });
    const supplier = (by_party[pid] = by_party[pid] || newParty(pid, ownTerms, isMsme(pack, msme, pid), sets));
    supplier.bills.push(bill);
    supplier.total_minor += bill.open_minor;
    supplier.buckets[bill.bucket] += bill.open_minor;
    if (bill.bucket_msme) supplier.buckets_msme[bill.bucket_msme] += bill.open_minor;
    total += bill.open_minor;
  });
  Object.keys(by_party).forEach((pid) => settleParty(by_party[pid], today));
  addHeld(by_party, side.uncounted.disputed_bills, { asOf: today, terms, msme, pk: pack, sets, bands });
  return { total_minor: total, sets, by_party: withNotes(by_party, billNotes(x.payable_items)) };
}
/** one supplier's empty payable row (every figure 0) — the first bill, counted or held, makes it */
function newParty(pid, supplierTerms, msme, sets) {
  const early = (supplierTerms.terms && supplierTerms.terms.early) || null;
  return {
    total_minor: 0,
    buckets: zeroFor(sets.due),
    buckets_msme: zeroFor(sets.msme),
    msme,
    msme_risk: false,
    msme_words: null,
    pay_by: null,
    group: 'later',
    terms: { credit_days: supplierTerms.credit_days == null ? null : Number(supplierTerms.credit_days), early },
    early: null,
    bills: []
  };
}
/** is this supplier an MSME for this shop's country — false when the country has no MSME pack (never a guess) */
function isMsme(countryPack, msme, pid) {
  return !!countryPack && msme.has(pid);
}
/**
 * R106: a HELD (disputed) bill stays in bills[] so Release has a row to sit on — `disputed: true` and the books' own hold words. It is added AFTER
 * every total, bucket, group and pay_by is settled, and carries no MSME or early-pay offer, so what-you-owe and the cash view do not move (C4).
 */
function addHeld(by_party, held, ctx) {
  (held || []).forEach((item) => {
    const pid = String(item.party_id),
      billDate = item.bill_date || item.due_date,
      ageDays = ctx.asOf - dayNumber(billDate),
      supplier = (by_party[pid] = by_party[pid] || newParty(pid, ctx.terms.get(pid) || {}, isMsme(ctx.pk, ctx.msme, pid), ctx.sets));
    supplier.bills.push({
      ref: item.ref,
      date: billDate,
      due_date: item.due_date,
      open_minor: item.amount_minor,
      age_days: ageDays,
      bucket: ctx.bands.due[item.ref],
      bucket_msme: ctx.bands.msme ? ctx.bands.msme[item.ref] : null,
      overdue: false,
      msme_day45: null,
      msme_days_left: null,
      msme_risk: false,
      msme_words: null,
      early: null,
      disputed: true,
      held_words: STATUS_WORDS.disputed
    });
  });
}
/** each bill row gets its own word (`note`, null when none) — the Payables row says "₹250 short against their ₹2,940" from it (R106) */
function withNotes(by_party, notes) {
  Object.keys(by_party).forEach((pid) => {
    by_party[pid].bills.forEach((bill) => {
      bill.note = notes[String(bill.ref)] || null;
    });
  });
  return by_party;
}

/**
 * read(h, entity, s) → the three things the dues route does not already hold: the cheques written and still held (C3), the suppliers with a Udyam
 * number (party_tax_id, b274), and each supplier's own terms (supplier_list, the terms column after b298). One query each; a table or column not
 * there yet answers empty (trySavepoint) — never a 500.
 */
async function read(handle, entity) {
  const store = require('./books-store'),
    { trySavepoint } = require('../db'),
    financeTerms = require('./finance-terms');
  const cheques = (await store.cheques(handle, entity, false, 500)).map((item) => ({
    payment_id: item.payment_id,
    party_id: item.party_id,
    direction: item.direction,
    amount_minor: Number(item.amount_minor),
    cheque_no: item.cheque_no || null,
    cheque_date: engines.ymd(item.cheque_date),
    status: item.status || 'received'
  }));
  const udyamRows = await trySavepoint(handle, () => handle.query(`SELECT party_id FROM party_tax_id WHERE owner_entity_id = $1 AND scheme = 'UDYAM'`, [entity]), { rows: [] });
  const withTerms = await financeTerms.migrated();
  const tr = await trySavepoint(
    handle,
    () => handle.query(`SELECT supplier_entity_id AS party_id, credit_days${withTerms ? ', terms' : ''} FROM supplier_list WHERE owner_entity_id = $1`, [entity]),
    { rows: [] }
  );
  return {
    cheques,
    msme: new Set(((udyamRows && udyamRows.rows) || []).map((item) => String(item.party_id))),
    terms: new Map(((tr && tr.rows) || []).map((item) => [String(item.party_id), item]))
  };
}

module.exports = { STATUS_WORDS, view, read, msmePack, RISK_DAYS };
