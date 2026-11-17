/**
 * tools/sim-history.cjs — MIS showcase step 1: the back-dated DEMO HISTORY, posted into the BOOKS (never the till), for tools/sim-load.cjs --months.
 * OWNS      the history's day loop (load) and its read-only proof (prove). The plan is tools/sim-plan.cjs historyDays/historyExpect; the data is tools/seed/mis-history.json.
 * CALLED BY tools/sim-load.cjs (--months N) — everything it needs (the plan, the pack, the clock, the doors) is handed in as `x`; it opens no connection of its own · tests/sim-history.test.cjs (the pure entry builders and month readings).
 * PURCHASES (profile-driven, tools/seed/mis-profiles.json): each supplier's bill on its day (purchase_bill, on credit), the shop pays the bills 30+ days old on day 27
 *           and the credit customer pays on day 25 — both through POST /api/books/payments (the api's own payment door, one Idempotency-Key each; the clock rig makes every payment look like yesterday's, so the duplicate warnings same_again / just_settled are acknowledged, as the web's own button does), so the party ledgers exist and some bills stay owing.
 * FLOW      per planned day: the clock set to that day ▶ ONE walk-in day entry (the posting engine's own daySummary, the pack's tax head) ▶ on day 10 a TAX-INCLUSIVE credit sale ▶
 *           on day 20 a sale posted then REVERSED (critic defect D) ▶ on day 5 rent (POST /api/books/events) ▶ a month closed and locked, the last two left open ▶ the proof.
 * Every entry's source_ref starts 'demo:' (the shop's name ends ' - demo'); every line is the pack's money; a re-run finds the opening mark and writes nothing (sim-load).
 * One writer: lib/books.postEntry / reverseEntry — the entry the counter's hook would have made, with no chit and no till.
 * CARD      qa/sim-load
 */
'use strict';
const cashOf = (cents) => Math.round(cents) / 100;
/** the source_ref of one demo entry: demo:<kind>:<day> (the proof finds the plan's entries by this prefix) */
const markOf = (kind, dayText) => 'demo:' + kind + ':' + dayText;
/** the first seven characters of a day, its YYYY-MM month */
const monthOf = (dayText) => dayText.slice(0, 7);

/** a credit sale entry on the shop's one credit customer, due in 14 days */
function creditSale(x, spec) {
  const { CUST, CURRENCY, taxRow, dayAdd, HIST } = x;
  return {
    type: 'sale_bill',
    party: CUST,
    date: spec.day,
    currency: CURRENCY,
    source_ref: markOf(spec.kind, spec.day),
    ref: spec.ref + spec.day.slice(0, 7),
    by_rate: [taxRow(HIST.gst_rate, spec.taxable)],
    paid: {},
    round_off: 0,
    due_date: dayAdd(spec.day, 14),
    by: null,
    narration: spec.narration
  };
}

/** one supplier's bill on its day, on credit, due in 30 days */
function purchaseBill(x, purchase, dayText) {
  const { SUPPS, CURRENCY, taxRow, dayAdd, HIST } = x;
  const rate = HIST.gst_rate;
  const gross = Math.round(purchase.taxable * 100) + Math.round((purchase.taxable * 100 * rate) / 100);
  return {
    type: 'purchase_bill',
    party: SUPPS[purchase.s],
    date: dayText,
    currency: CURRENCY,
    source_ref: markOf('buy' + purchase.s, dayText),
    ref: 'DEMO-PUR' + purchase.s + '-' + dayText.slice(0, 7),
    by_rate: [taxRow(rate, purchase.taxable)],
    paid: {},
    round_off: 0,
    due_date: dayAdd(dayText, 30),
    by: null,
    narration: 'demo: supplier bill ' + cashOf(gross)
  };
}

/** the one writer for a run: counts what posted and what was refused, and says each refusal in a RED line */
function makeWriter(x) {
  const { books, shopId, callApi, token, CURRENCY } = x;
  const tally = { entries: 0, rent: 0, refused: 0 };
  const refuse = (text) => {
    tally.refused++;
    console.log('   RED  ' + text);
  };
  const post = async (event, what) => {
    const out = await books.postEntry(null, shopId, event).catch((e) => ({ ok: false, why: String(e && e.message) }));
    if (!out || !out.ok) {
      refuse(what + ' refused — ' + JSON.stringify(out).slice(0, 220));
      return null;
    }
    tally.entries++;
    return out;
  };
  /* a payment through the api's own door (it needs an Idempotency-Key); 'oldest first' settles the party's oldest open bills */
  const payThrough = async (direction, party, amountMinor, dayText, mode, what) => {
    const key = markOf('pay-' + direction + '-' + what, dayText),
      reply = await callApi('/api/books/payments', {
        method: 'POST',
        token,
        headers: { 'Idempotency-Key': key },
        body: { party_id: party, direction, amount_minor: amountMinor, currency: CURRENCY, mode, reference: 'demo: ' + what, received_at: dayText, client_ref: key, allocate: 'oldest_first', acknowledge: ['same_again', 'just_settled'] }
      });
    if (reply.status === 200 || reply.status === 201) tally.entries++;
    else refuse('payment ' + what + ' ' + dayText + ' refused — HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 220));
  };
  return { tally, refuse, post, payThrough };
}

/** the day's walk-in entry: the posting engine's own daySummary over one cash bill with the pack's tax head */
async function postWalkin(x, writer, row) {
  const { API, path, PACK, CURRENCY, TILL, taxRow, HIST } = x;
  const rate = HIST.gst_rate,
    dayText = row.day;
  const total = cashOf(Math.round(row.walkin * 100) + Math.round(row.walkin * rate));
  const bill = { currency: CURRENCY, pay: { cash: total }, taxes: [taxRow(rate, row.walkin)], round_off: 0 };
  const summary = require(path.join(API, 'lib', 'books-engines')).posting().daySummary([bill], { ref: 'demo walk-in ' + dayText, date: dayText, counter: TILL }, { pack: PACK });
  await writer.post(Object.assign(summary, { source_ref: markOf('walkin', dayText), counter: TILL, by: null, narration: 'demo: walk-in sales ' + dayText }), 'walk-in day ' + dayText);
}

/** a REVERSED sale: posted, then cancelled by its mirror entry — the Day book counts neither */
async function postReversedSale(x, writer, row) {
  const { books, shopId } = x;
  const dayText = row.day;
  const sale = await writer.post(creditSale(x, { day: dayText, kind: 'rev', ref: 'DEMO-REV-', taxable: row.reversed.taxable, narration: 'demo: sale entered in error' }), 'sale to reverse ' + dayText);
  if (!sale || !sale.entry_id) return;
  const undone = await books.reverseEntry(null, shopId, sale.entry_id, { by: null, reason: 'demo: sale entered in error, reversed' }).catch((e) => ({ ok: false, why: String(e && e.message) }));
  if (undone && undone.ok !== false) writer.tally.entries++;
  else writer.refuse('reversal ' + dayText + ' refused — ' + JSON.stringify(undone).slice(0, 200));
}

/** the month's rent through the owner's ＋ Entry door */
async function postRent(x, writer, row) {
  const { callApi, token, HIST } = x;
  const dayText = row.day;
  const reply = await callApi('/api/books/events', { method: 'POST', token, body: { event: 'expense', class: 'rent', amount: row.rent, paid_from: HIST.rent.paid_from, date: dayText, client_ref: markOf('rent', dayText) } });
  if (reply.status === 200) {
    writer.tally.entries++;
    writer.tally.rent++;
  } else writer.refuse('rent ' + dayText + ' refused — ' + JSON.stringify(reply.b).slice(0, 200));
}

/** everything one planned day posts, in the day's order */
async function postDay(x, writer, row) {
  const { CUST, SUPPS } = x;
  const dayText = row.day;
  await postWalkin(x, writer, row);
  /* a TAX-INCLUSIVE sale: the customer saw the price with GST in it; the books split it into taxable + GST */
  if (row.inclusive) await writer.post(creditSale(x, { day: dayText, kind: 'incl', ref: 'DEMO-INC-', taxable: row.inclusive.taxable, narration: 'demo: tax-inclusive sale ' + row.inclusive.total }), 'tax-inclusive sale ' + dayText);
  if (row.reversed) await postReversedSale(x, writer, row);
  for (const purchase of row.buys || []) await writer.post(purchaseBill(x, purchase, dayText), 'purchase bill ' + purchase.s + ' ' + dayText);
  if (row.receipt) await writer.payThrough('in', CUST, row.receipt, dayText, 'bank', 'customer receipt');
  for (const out of row.pays || []) await writer.payThrough('out', SUPPS[out.s], out.cents, dayText, 'cash', 'supplier ' + out.s);
  if (row.rent) await postRent(x, writer, row);
}

/** every day of the plan through the one writer → { entries, rent, refused } */
async function load(x) {
  const { PLAN, dayAdd, closeMonth, drain, CLOCK, AT, months } = x;
  const writer = makeWriter(x);
  let monthIndex = 0;
  for (const row of PLAN.days) {
    const dayText = row.day;
    if (dayText.slice(8) === '01' && dayText !== PLAN.start) {
      if (monthIndex <= months - 3) await closeMonth(dayAdd(dayText, -1)); /* the last two months stay open (REQ section 5, seed B) */
      monthIndex++;
    }
    CLOCK.set(AT(dayText, 12, 0));
    await postDay(x, writer, row);
  }
  await drain();
  return { entries: writer.tally.entries, rent: writer.tally.rent, refused: writer.tally.refused };
}

/** each month's SOLD (the Day book's days added in the books' own money op, never with + on the object): { 'YYYY-MM': minor } */
function soldByMonth(days, CURRENCY, moneyOps) {
  const sold = {};
  for (const row of days) sold[monthOf(row.day)] = moneyOps.addMinor(sold[monthOf(row.day)] || 0, row.sold.minor, CURRENCY);
  return sold;
}

/** the months whose SOLD is not the plan's, as 'month got X want Y' (at most three) and the count */
function soldMismatches(sold, HEXPECT) {
  const months = Object.keys(HEXPECT).filter((month) => Math.round(sold[month] || 0) !== HEXPECT[month].sold);
  return { months, text: months.slice(0, 3).map((month) => month + ' got ' + (sold[month] || 0) + ' want ' + HEXPECT[month].sold).join('; ') };
}

/** the shop's own entries per month: the demo-marked ones, the payments and the reversals (a tax close's set-off entry is the books', not the plan's) */
async function entriesByMonth(sql, shopId) {
  const entriesOf = {};
  const rows = (
    await sql(
      `SELECT to_char(posting_date, 'YYYY-MM') AS m, count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND (source_ref LIKE 'demo:%' OR source_ref LIKE 'ev:%demo:%' OR source_ref LIKE 'pay:%' OR reverses_entry_id IS NOT NULL) GROUP BY 1`,
      [shopId]
    )
  ).rows;
  for (const row of rows) entriesOf[row.m] = row.n;
  return entriesOf;
}

/** the hand-written months of tools/seed/mis-history-expected.json against the books (only for the profile it was written for) */
function handWrittenChecks(line, { file, sold, entriesOf, HEXPECT, PROFILE_NAME }) {
  const hand = file.months;
  if (file.profile !== PROFILE_NAME) {
    console.log('   (the hand-written months are for profile ' + file.profile + '; this is ' + PROFILE_NAME + ' — checked against its own plan only)');
    return;
  }
  for (const month of Object.keys(hand).filter((name) => HEXPECT[name])) {
    line(Math.round(sold[month] || 0) === Math.round(hand[month].sold_incl_gst * 100), 'hand-written month ' + month + ' SOLD ' + hand[month].sold_incl_gst.toFixed(2), 'books hold ' + ((sold[month] || 0) / 100).toFixed(2));
    line(
      entriesOf[month] === hand[month].entries && HEXPECT[month].buys === Math.round(hand[month].purchases_ex_gst * 100),
      'hand-written month ' + month + ' ' + hand[month].entries + ' entries, purchases ' + hand[month].purchases_ex_gst.toFixed(2) + ' ex GST',
      'books hold ' + entriesOf[month] + ' entries, plan buys ' + (HEXPECT[month].buys / 100).toFixed(2)
    );
  }
}

/** each month's SOLD = the plan's = the hand-written file; each month's entries = the plan's */
async function monthChecks(x, shopId, line) {
  const { API, path, HEXPECT, CURRENCY, sql, here, PROFILE_NAME } = x;
  /* the read runs AS THE SHOP (db.withEntity sets app.current_entity, as every route does); the books tables are FORCE RLS, so a bare pool reads nothing */
  const days = await require(path.join(API, 'db')).withEntity(shopId, (db) => require(path.join(API, 'lib', 'books-store')).soldByDay(db, shopId));
  /* soldByDay gives { minor, currency } (a day of two currencies: minor null, never added across): added in the books' own money op, never with + on the object */
  const sold = soldByMonth(days, CURRENCY, require(path.join(API, 'lib', 'books-money-ops')));
  const keys = Object.keys(HEXPECT),
    wrong = soldMismatches(sold, HEXPECT);
  line(!wrong.months.length, "every month's SOLD (incl. GST, the reversed sale out) = the plan's (" + (keys.length - wrong.months.length) + ' of ' + keys.length + ')', wrong.text);
  try {
    const file = JSON.parse(require('fs').readFileSync(path.join(here, 'seed', 'mis-history-expected.json'), 'utf8'));
    const entriesOf = await entriesByMonth(sql, shopId);
    handWrittenChecks(line, { file, sold, entriesOf, HEXPECT, PROFILE_NAME });
    const planWrong = keys.filter((month) => (entriesOf[month] || 0) !== HEXPECT[month].entries);
    line(
      !planWrong.length,
      "every month's demo entries (sales, purchases, payments, receipts, rent, reversals) = the plan's (" + (keys.length - planWrong.length) + ' of ' + keys.length + ')',
      planWrong.slice(0, 3).map((month) => month + ' got ' + entriesOf[month] + ' want ' + HEXPECT[month].entries).join('; ')
    );
  } catch (e) {
    line(false, 'the hand-written expectations file is readable', e.message);
  }
}

/** every sale and expense entry demo-marked, every line in the pack's money, one reversed sale a month */
async function markChecks(x, shopId, line, countOf) {
  const { CURRENCY, months } = x;
  const unmarked = await countOf(
    `SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND event_type IN ('walkin_day', 'sale_bill', 'expense', 'purchase_bill') AND reverses_entry_id IS NULL AND source_ref NOT LIKE 'demo:%' AND source_ref NOT LIKE 'ev:%demo:%'`,
    [shopId]
  );
  line(unmarked === 0, 'every sale and expense entry is demo-marked, source_ref demo:… (' + unmarked + ' not)');
  const money = await countOf(`SELECT count(*)::int AS n FROM journal_line WHERE entity_id = $1 AND currency <> $2`, [shopId, CURRENCY]);
  line(money === 0, 'every line is in ' + CURRENCY + ' (' + money + ' not)');
  const reversed = await countOf(`SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND reverses_entry_id IS NOT NULL`, [shopId]);
  line(reversed === months, 'one reversed sale a month (' + reversed + ' of ' + months + ')');
}

/** the party ledgers: each supplier owes what the plan left unpaid (credit - debit on the creditors ledger), the customer owes what is left (debtors) — read by party from the lines */
async function ledgerChecks(x, shopId, line, countOf) {
  const { PLAN, PROFILE, CUSTOMER, sql } = x;
  const owing = async (role, side) => {
    const rows = (await sql(`SELECT i.display_name AS name, COALESCE(SUM(${side}), 0)::bigint AS n, count(*)::int AS lines FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id JOIN identities i ON i.identity_id = l.party_id WHERE l.entity_id = $1 AND a.role = $2 GROUP BY 1`, [shopId, role])).rows;
    return new Map(rows.map((row) => [row.name, row]));
  };
  const suppliers = await owing('creditors', 'l.cr_minor - l.dr_minor'),
    customers = await owing('debtors', 'l.dr_minor - l.cr_minor');
  const badSupplier = (PROFILE.suppliers || []).map((name, index) => ({ name, index, row: suppliers.get(name) })).filter((item) => !item.row || Number(item.row.n) !== PLAN.owing.ap[item.index]);
  line(
    !badSupplier.length && suppliers.size === (PROFILE.suppliers || []).length,
    'supplier ledgers exist and each owes what the plan left unpaid (' + [...suppliers.entries()].map(([name, row]) => name + ' ' + (Number(row.n) / 100).toFixed(2) + ' over ' + row.lines + ' lines').join('; ') + ')',
    badSupplier.map((item) => item.name + ' want ' + (PLAN.owing.ap[item.index] / 100).toFixed(2)).join('; ')
  );
  const customer = customers.get(CUSTOMER);
  line(!!customer && Number(customer.n) === PLAN.owing.ar, 'the customer ledger exists and owes what the plan left (' + (customer ? (Number(customer.n) / 100).toFixed(2) + ' over ' + customer.lines + ' lines' : 'none') + ', want ' + (PLAN.owing.ar / 100).toFixed(2) + ')');
  const unbalanced = await countOf(`SELECT count(*)::int AS n FROM (SELECT entry_id FROM journal_line WHERE entity_id = $1 GROUP BY entry_id HAVING SUM(dr_minor) <> SUM(cr_minor)) t`, [shopId]);
  line(unbalanced === 0, 'every entry balances (' + unbalanced + ' do not)');
}

/** the proof (reads only): each month's SOLD (the Day book) = the plan's sums = the hand-written file; every sale/expense entry demo-marked; every line in the pack's money */
async function prove(x, shopId, quiet) {
  const out = [];
  const line = (ok, name, detail) => {
    out.push(ok);
    console.log('   ' + (ok ? 'ok   ' : 'RED  ') + name + (detail ? ' — ' + detail : ''));
  };
  const countOf = async (query, params) => (await x.sql(query, params)).rows[0].n;
  console.log('\n  history proof (' + (quiet ? 'as loaded' : 'this run') + '):');
  await monthChecks(x, shopId, line);
  await markChecks(x, shopId, line, countOf);
  await ledgerChecks(x, shopId, line, countOf);
  const failures = out.filter((verdict) => !verdict).length;
  console.log('  ' + (failures ? '✗ ' + failures + ' RED' : '✓ all green') + ' · ' + out.length + ' lines');
  return failures;
}
module.exports = { load, prove, creditSale, purchaseBill, soldByMonth, soldMismatches, markOf };
