'use strict';
/*
 * OWNS      "Who came back" — which customers a shop SENT an offer to, and which of them then bought. Buckets the sends against the bills; computes no sum of its own.
 * CALLED BY routes/marketing.js (GET /api/marketing/came-back) · tests/marketing-results.test.cjs
 * FLOW      policy.came_back_days → channel_outbound (marketing, SENT only) → lib/select.rows (bills naming those customers, ONE read) → bucket → lib/measure.money
 * CARD      12-marketing/README
 */
// lib/marketing-results.js — WHO CAME BACK (MKT-4). Measured from REAL SALES, never a guess.
//
// ── ⚠️ WHY THIS READS THE BILLS (lib/select.js) AND NOT THE LEDGER ───────────────────────────────────────────────
// The Ledger's party_item rows exist for CREDIT bills only (CRM-34), so a cash sale at the counter — the commonest "came back" — is not on it.
// A till bill names its customer in business_json.customer.identity_id, and lib/select.js already resolves that into `counterparty_id`.
//
// ── ⚠️ ONLY SENDS THAT WERE SENT ─────────────────────────────────────────────────────────────────────────────────
// A refused or failed send reached nobody, so a purchase after it proves nothing about the offer. Those rows are counted (so the screen can say
// WHY a result is 0) but never matched to a bill.
//
// ── ⚠️ A 0 MUST EXPLAIN ITSELF ───────────────────────────────────────────────────────────────────────────────────
// Live, an offer outside WhatsApp's 24 hours needs an approved offers template (whatsapp-out templatePayload) — until the shop has one, every send is
// refused and "Who came back" would read 0 with no reason. `why` is a CODE the screen branches on, with `say` in words.
const { withEntity } = require('../db');
const schema = require('./schema');
const select = require('./select');
const measure = require('./measure');
const policy = require('./policy');
const pager = require('./page-limit');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 14;
const SENDS_LOOKBACK_DAYS = 90; /* how far back a send can still be matched — the setting's own maximum */
const SENDS_CAP = 5000; /* receipts read in one statement (newest kept) */
const BILLS_CAP = 5000;
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200;
/** a bill that was never made good does not count: cancelled and rejected copies */
const NOT_A_SALE = ['cancelled', 'rejected'];
/** the padding, in days, either side of the SQL window — the exact edges are checked in JS (the bill's `created_at` is a zoned instant there) */
const WINDOW_PAD_DAYS = 1;

/** the reasons a refused send gives, as the code a screen branches on */
const REASON_CODES = [
  { code: 'NO_TEMPLATE', test: /approved offers template/i, say: 'Offers outside 24 hours need an approved WhatsApp template. Set one up in Channels.' },
  { code: 'NO_TOKEN', test: /WHATSAPP_TOKEN|not configured/i, say: 'WhatsApp sending is not connected yet, so nothing went out.' },
  { code: 'NO_CONSENT', test: /consent|agreed|said no|withdrew/i, say: 'Nobody had agreed to offers, so nothing went out.' }
];
const ALL_REFUSED = { code: 'ALL_REFUSED', say: 'Every send was refused, so nothing went out. See Offers sent for why.' };

/** gate refusals the consent gate gives as a CODE (lib/privacy CODES) - a receipt's basis.code, when the person was refused before any sender was asked */
const GATE_REFUSALS = ['NO_CONSENT', 'SAID_NO', 'CONSENT_WITHDRAWN', 'OPTED_OUT', 'CONSENT_UNREADABLE', 'NO_PHONE'];
/**
 * reasonCodeOf(receipt) -> the CODE a screen words a not-sent receipt by (null when it was sent): the gate's own code when the gate refused, else the sender's reason
 * read against the same table "Who came back" uses to explain a 0 - so Offers sent and Who came back can never say two different things about one refusal.
 */
function reasonCodeOf(row) {
  if (!row || row.status === 'sent') return null;
  const code = row.basis && row.basis.code;
  if (GATE_REFUSALS.indexOf(code) >= 0) return code;
  const known = REASON_CODES.find((item) => item.test.test(String(row.reason || '')));
  return known ? known.code : row.status === 'failed' ? 'FAILED' : 'NOT_SENT';
}

/** the days a bill still counts, from the shop's own setting (policy came_back_days: default 14, 1–90) */
function daysOf(flags) {
  const setting = Number(flags && flags.came_back_days);
  return Number.isFinite(setting) && setting >= 1 ? Math.min(90, Math.floor(setting)) : DEFAULT_DAYS;
}

/** the code and the sentence for a result that has nobody in it — or null when somebody came back */
function whyEmpty(counts, reasons, days, cameBackN) {
  if (cameBackN > 0) return null;
  if (!counts.all) return { code: 'NO_SENDS', say: 'No offer has been sent yet. Send one from Groups.' };
  if (!counts.sent) {
    const top = Object.keys(reasons).sort((x, y) => reasons[y] - reasons[x])[0] || '',
      known = REASON_CODES.find((item) => item.test.test(top));
    return known ? { code: known.code, say: known.say } : ALL_REFUSED;
  }
  return { code: 'NO_BUYERS', say: 'Nobody who got an offer has bought in ' + days + ' days yet.' };
}

/** the receipts of offers, newest 90 days: the SENT ones (to match) and the counts (to explain a 0) */
async function readSends(owner, now) {
  const since = new Date(now.getTime() - SENDS_LOOKBACK_DAYS * DAY_MS).toISOString();
  const read = await withEntity(owner, (db) =>
    db.query(
      `SELECT o.party_id, o.status, o.reason, o.send_ref, o.created_at, i.display_name AS party_name
         FROM channel_outbound o LEFT JOIN identities i ON i.identity_id = o.party_id
        WHERE o.entity_id = $1 AND o.purpose = 'marketing' AND o.party_id IS NOT NULL AND o.created_at >= $2::timestamptz
        ORDER BY o.created_at DESC LIMIT ${SENDS_CAP}`,
      [owner, since]
    )
  );
  return read.rows.map((item) => Object.assign({}, item, { at: new Date(item.created_at) }));
}

/** counts by outcome, and how often each refusal reason came up */
function countSends(rows) {
  const counts = { all: rows.length, sent: 0, refused: 0, failed: 0 },
    reasons = {};
  rows.forEach((item) => {
    if (item.status === 'sent') counts.sent++;
    else if (item.status === 'refused') counts.refused++;
    else counts.failed++;
    if (item.status !== 'sent' && item.reason) reasons[item.reason] = (reasons[item.reason] || 0) + 1;
  });
  return { counts, reasons };
}

/** a bill (one row of lib/select) is a SALE the shop made: a counter bill it issued (doc_kind says by sender), or an invoice it sent */
/* ⚠️ A counter bill is held by the shop as ONE copy addressed to itself (direction 'received'), so the read never filters on direction. */
const isSale = (row) => row.doc_kind === 'bill_issued' || row.purpose === 'invoice';

/** the latest SENT offer to this person that is at or before the bill and still inside the window — or null */
function sendBefore(sends, billAt, days) {
  let found = null;
  for (const item of sends) if (item.at <= billAt && billAt.getTime() < item.at.getTime() + days * DAY_MS && (!found || item.at > found.at)) found = item;
  return found;
}

/** one customer's line: the offer, then every bill that followed it inside the window (the figures come from lib/measure) */
function customerLine(party_id, send, bills) {
  return {
    party_id,
    name: send.party_name || bills[0].counterparty_name || null,
    sent_at: send.at.toISOString(),
    send_ref: send.send_ref || null,
    first_bill_at: new Date(Math.min(...bills.map((bill) => new Date(bill.created_at).getTime()))).toISOString(),
    bills_n: bills.length,
    money: measure.measure(bills).money,
    bills: bills.map((bill) => ({ chit_id: bill.chit_id, bill_no: bill.bill_no || null, at: new Date(bill.created_at).toISOString(), value: bill.value == null ? null : Number(bill.value), currency: bill.currency || null }))
  };
}

/** sent offers by person, oldest first (a person may have been sent several) */
function sentByParty(sentRows) {
  const by = new Map();
  [...sentRows].reverse().forEach((item) => {
    const key = String(item.party_id);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(item);
  });
  return by;
}

/** the bills that followed a send inside the window, grouped by person; each bill counted once */
function bucketBills(bills, bySend, days) {
  const by = new Map(),
    seen = new Set(); /* a bill the shop sent to itself can come back as two copies (sent and received): one sale */
  bills.filter(isSale).forEach((bill) => {
    if (seen.has(bill.chit_id)) return;
    seen.add(bill.chit_id);
    const key = String(bill.counterparty_id),
      send = sendBefore(bySend.get(key) || [], new Date(bill.created_at), days);
    if (!send) return;
    if (!by.has(key)) by.set(key, { send, bills: [] });
    by.get(key).bills.push(bill);
  });
  return by;
}

/** the bills read for those people across the whole span of the sends plus the window — ONE select, no reader per person */
async function readBills(owner, sentRows, days) {
  const times = sentRows.map((item) => item.at.getTime()),
    since = new Date(Math.min(...times) - WINDOW_PAD_DAYS * DAY_MS).toISOString(),
    until = new Date(Math.max(...times) + (days + WINDOW_PAD_DAYS) * DAY_MS).toISOString();
  return select.rows(owner, {
    counterparty_ids: [...new Set(sentRows.map((item) => String(item.party_id)))],
    status_not: NOT_A_SALE,
    since,
    until,
    limit: BILLS_CAP
  });
}

/** what is said when b776 has not run: the same shape, zeros, and the code a screen shows its sentence for */
function notMigrated(days) {
  return {
    migrated: false,
    code: 'MKT_NOT_MIGRATED',
    say: 'Who came back arrives after the next update.',
    days,
    sent_n: 0,
    came_back_n: 0,
    counts: { all: 0, sent: 0, refused: 0, failed: 0 },
    why: { code: 'MKT_NOT_MIGRATED', say: 'Who came back arrives after the next update.' },
    money: measure.measure([]).money,
    customers: [],
    total: 0,
    page: 1,
    limit: PAGE_DEFAULT
  };
}

/**
 * cameBack(owner, { query, now }) → who was SENT an offer and then bought within `came_back_days`.
 * One read of the receipts, one read of the bills. `query` is the route's ?page= ?limit= (the customers are paged); `now` is for tests.
 */
async function cameBack(owner, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date(),
    days = daysOf(await policy.get(owner)),
    pg = pager.pageArgs(opts.query, PAGE_DEFAULT, PAGE_MAX);
  if (!(await schema.hasColumn('channel_outbound', 'send_ref'))) return notMigrated(days);
  const rows = await readSends(owner, now),
    { counts, reasons } = countSends(rows),
    sentRows = rows.filter((item) => item.status === 'sent'),
    sentParties = new Set(sentRows.map((item) => String(item.party_id)));
  const bills = sentRows.length ? await readBills(owner, sentRows, days) : [],
    buyers = bucketBills(bills, sentByParty(sentRows), days);
  const lines = [...buyers.entries()]
    .map(([party_id, item]) => customerLine(party_id, item.send, item.bills))
    .sort((x, y) => new Date(y.first_bill_at) - new Date(x.first_bill_at));
  const allBills = [...buyers.values()].flatMap((item) => item.bills);
  return Object.assign(
    { migrated: true, days, sent_n: sentParties.size, came_back_n: lines.length, counts, why: whyEmpty(counts, reasons, days, lines.length), money: measure.measure(allBills).money },
    bills.length >= BILLS_CAP ? { truncated: true } : {},
    pager.pageOut('customers', lines, pg)
  );
}

module.exports = { cameBack, daysOf, whyEmpty, sendBefore, bucketBills, reasonCodeOf, DEFAULT_DAYS };
