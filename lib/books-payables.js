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
 * ⭐ NEW PATHS (rule 4): bucket() — the receivable/payable ageing buckets are Schedule III's (a year wide); MSME needs 30/45/60 — four lines.
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
const CF = require('./books-cashflow');
const E = require('./books-engines');

const { day, ymd, toMinor, fromMinor } = CF;
const RISK_DAYS = 7; /* "day 45 is within 7 days or past" (the brief, owner 2026-10-10) */
const HORIZON = 3650; /* msmeFlags flags a bill once it is past its limit: asked ten years on, every open bill is, with its limit_days */
/** the books' one word for a held / released bill (routes/books.js POST /parties/:id/dispute says it, Payables paints it on the held row) */
const STATUS_WORDS = { disputed: 'Held — in dispute with you', undisputed: 'Released — payable again' };
const BUCKETS = ['0_30', '31_45', '46_60', '60_plus'];
const money = (minor, cur) => require('./bill-privacy').money(minor, cur);
const dateWords = (d) => require('./books').dateWords(d);
const nameOf = (names, pid) => {
  const p = names && names.get(String(pid));
  return (p && (p.nickname || p.name)) || 'this supplier';
};

/** a bill's age in days (from its own date) → its bucket: 0-30 · 31-45 · 46-60 · 60+ */
function bucket(age) {
  return age <= 30 ? '0_30' : age <= 45 ? '31_45' : age <= 60 ? '46_60' : '60_plus';
}

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

/**
 * ⭐ view(x) — x: { asOf, currency, country, payable_items, cheques (held), names: Map, msme: Set(party_id), terms: Map(party_id → supplier_list row
 *   { credit_days, terms }), chart: [{ code, role }] }
 * → { total_minor, by_party: { [party_id]: { total_minor, buckets, msme, msme_risk, msme_words, pay_by, group, terms, early, bills: [...] } } }
 *   bill: { disputed (held, R106: listed but NOT in any total — only on a held bill, with held_words), ref, date, due_date, open_minor, age_days, bucket, overdue, msme_day45, msme_days_left, msme_risk, msme_words, note (the bill's own word, R106),
 *           early: null | { pct, within_days, by, valid, save_minor, pay_minor, words, record, gst_note } }
 * group: 'msme' (MSME at risk) · 'overdue' · 'week' (due in 7 days) · 'later'. pay_by: the earliest day that matters (day 45 when MSME, else the due date).
 */
function view(x) {
  const cur = require('./country-setup').currencyStated(x.currency),
    asOf = x.asOf,
    t0 = day(asOf),
    R = E.receivables();
  const side = CF.datedSide('out', x.payable_items || [], x.cheques || [], [], { currency: cur, asOf });
  const pk = msmePack(x.country),
    msme = x.msme || new Set(),
    terms = x.terms || new Map(),
    chart = x.chart || [];
  const role = (r) => chart.find((item) => item.role === r);
  const cred = role('creditors'),
    disc = role('discount_received');
  /* day 45 for every MSME supplier's open bill — the pack's own rule, read back as limit_days */
  const limit = Object.create(null);
  if (pk) {
    const debits = side.dated
      .filter((item) => msme.has(String(item.party_id)))
      .map((item) => ({ id: item.ref, party: item.party_id, date: item.bill_date || item.due_date, due: item.due_date, balance: item.amount_minor }));
    (R.msmeFlags({ debits }, ymd(t0 + HORIZON), { on: true, pack: pk }) || []).forEach((item) => {
      limit[item.debit] = item.limit_days;
    });
  }
  const by_party = Object.create(null);
  let total = 0;
  side.dated.forEach((item) => {
    const pid = String(item.party_id),
      own = terms.get(pid) || {},
      early = (own.terms && own.terms.early) || null,
      name = nameOf(x.names, pid);
    const bd = item.bill_date || item.due_date,
      age = t0 - day(bd),
      b = {
        ref: item.ref,
        date: bd,
        due_date: item.due_date,
        open_minor: item.amount_minor,
        age_days: age,
        bucket: bucket(age),
        overdue: !!item.overdue,
        msme_day45: null,
        msme_days_left: null,
        msme_risk: false,
        msme_words: null,
        early: null
      };
    if (limit[item.ref] != null) {
      b.msme_day45 = ymd(day(bd) + limit[item.ref]);
      b.msme_days_left = day(b.msme_day45) - t0;
      b.msme_risk = b.msme_days_left <= RISK_DAYS;
      b.msme_words =
        b.msme_days_left >= 0
          ? 'Pay by ' + dateWords(b.msme_day45) + ' — after that this bill cannot be claimed as an expense this year (Income-tax s.43B(h)).'
          : 'Day 45 was ' + dateWords(b.msme_day45) + ' — this bill is an expense only in the year you pay it (Income-tax s.43B(h)).';
    }
    /* the supplier's OWN early-pay terms only (the shop default is the shop's offer to its customers) — CBReceivables.earlyDiscount on what is still open */
    if (early && Number(early.pct) > 0 && Number(early.within_days) > 0) {
      const r = R.earlyDiscount({ date: bd, amount: fromMinor(item.amount_minor, cur), currency: cur }, asOf, {
        on: true,
        pct: Number(early.pct),
        within_days: Number(early.within_days),
        currency: cur
      });
      const by = ymd(day(bd) + Number(early.within_days)),
        save = r && r.eligible ? toMinor(r.amount, cur) : 0;
      b.early = {
        pct: Number(early.pct),
        within_days: Number(early.within_days),
        by,
        valid: !!(r && r.eligible) && save > 0,
        save_minor: save,
        pay_minor: item.amount_minor - save,
        words: r && r.eligible ? early.pct + '% off if paid by ' + dateWords(by) + ' — saves ' + money(save, cur) : 'Early-pay ended on ' + dateWords(by),
        record: null,
        gst_note: null
      };
      if (b.early.valid) {
        b.early.record =
          cred && disc
            ? {
                ok: true,
                body: {
                  narration: 'Early-pay discount from ' + name + ' (' + early.pct + '%)',
                  against_ref: item.ref,
                  client_ref: 'early:' + item.ref,
                  lines: [
                    { account: String(cred.code), party: pid, dr_minor: save, cr_minor: 0 },
                    { account: String(disc.code), dr_minor: 0, cr_minor: save }
                  ]
                }
              }
            : { ok: false, why: 'no_ledger', say: 'Your chart has no Discount received ledger. Add it in Accounts.' };
        b.early.gst_note = { ok: false, why: 'owner_confirms', say: 'Ask ' + name + ' for a GST credit note. You confirm it when it comes.' };
      }
    }
    const supplier = (by_party[pid] = by_party[pid] || newParty(pid, own, isMsme(pk, msme, pid)));
    supplier.bills.push(b);
    supplier.total_minor += b.open_minor;
    supplier.buckets[b.bucket] += b.open_minor;
    total += b.open_minor;
  });
  Object.keys(by_party).forEach((pid) => {
    const p = by_party[pid];
    p.bills.sort((first, second) => String(first.msme_day45 || first.due_date).localeCompare(String(second.msme_day45 || second.due_date)));
    const risk = p.bills.filter((item) => item.msme_risk);
    p.msme_risk = risk.length > 0;
    p.msme_words = risk.length ? risk[0].msme_words : null;
    p.pay_by = p.bills.map((item) => (item.msme_day45 && item.msme_day45 < item.due_date ? item.msme_day45 : item.due_date)).sort()[0] || null;
    p.group = p.msme_risk
      ? 'msme'
      : p.bills.some((item) => item.overdue)
        ? 'overdue'
        : p.bills.some((item) => day(item.due_date) - t0 <= RISK_DAYS)
          ? 'week'
          : 'later';
    p.early =
      p.bills
        .filter((item) => item.early && item.early.valid)
        .sort((first, second) => second.early.save_minor - first.early.save_minor)
        .map((item) => Object.assign({ ref: item.ref }, item.early))[0] || null;
  });
  addHeld(by_party, side.uncounted.disputed_bills, { asOf: t0, terms, msme, pk });
  return { total_minor: total, by_party: withNotes(by_party, billNotes(x.payable_items)) };
}
/** one supplier's empty payable row (every figure 0) — the first bill, counted or held, makes it */
function newParty(pid, supplierTerms, msme) {
  const early = (supplierTerms.terms && supplierTerms.terms.early) || null;
  return {
    total_minor: 0,
    buckets: BUCKETS.reduce((sum, entry) => ((sum[entry] = 0), sum), {}),
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
      ageDays = ctx.asOf - day(billDate),
      supplier = (by_party[pid] = by_party[pid] || newParty(pid, ctx.terms.get(pid) || {}, isMsme(ctx.pk, ctx.msme, pid)));
    supplier.bills.push({
      ref: item.ref,
      date: billDate,
      due_date: item.due_date,
      open_minor: item.amount_minor,
      age_days: ageDays,
      bucket: bucket(ageDays),
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
async function read(h, entity) {
  const S = require('./books-store'),
    { trySavepoint } = require('../db'),
    T = require('./finance-terms');
  const cheques = (await S.cheques(h, entity, false, 500)).map((item) => ({
    payment_id: item.payment_id,
    party_id: item.party_id,
    direction: item.direction,
    amount_minor: Number(item.amount_minor),
    cheque_no: item.cheque_no || null,
    cheque_date: E.ymd(item.cheque_date),
    status: item.status || 'received'
  }));
  const ud = await trySavepoint(h, () => h.query(`SELECT party_id FROM party_tax_id WHERE owner_entity_id = $1 AND scheme = 'UDYAM'`, [entity]), { rows: [] });
  const withTerms = await T.migrated();
  const tr = await trySavepoint(
    h,
    () => h.query(`SELECT supplier_entity_id AS party_id, credit_days${withTerms ? ', terms' : ''} FROM supplier_list WHERE owner_entity_id = $1`, [entity]),
    { rows: [] }
  );
  return {
    cheques,
    msme: new Set(((ud && ud.rows) || []).map((item) => String(item.party_id))),
    terms: new Map(((tr && tr.rows) || []).map((item) => [String(item.party_id), item]))
  };
}

module.exports = { STATUS_WORDS, view, read, bucket, msmePack, BUCKETS, RISK_DAYS };
