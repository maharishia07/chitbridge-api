/**
 * tools/sim-history.cjs — MIS showcase step 1: the back-dated DEMO HISTORY, posted into the BOOKS (never the till), for tools/sim-load.cjs --months.
 * OWNS      the history's day loop (load) and its read-only proof (prove). The plan is tools/sim-plan.cjs historyDays/historyExpect; the data is tools/seed/mis-history.json.
 * CALLED BY tools/sim-load.cjs (--months N) — everything it needs (the plan, the pack, the clock, the doors) is handed in as `x`; it opens no connection of its own.
 * PURCHASES (profile-driven, tools/seed/mis-profiles.json): each supplier's bill on its day (purchase_bill, on credit), the shop pays the bills 30+ days old on day 27
 *           and the credit customer pays on day 25 — both through POST /api/books/payments (the api's own payment door, one Idempotency-Key each; the clock rig makes every payment look like yesterday's, so the duplicate warnings same_again / just_settled are acknowledged, as the web's own button does), so the party ledgers exist and some bills stay owing.
 * FLOW      per planned day: the clock set to that day ▶ ONE walk-in day entry (the posting engine's own daySummary, the pack's tax head) ▶ on day 10 a TAX-INCLUSIVE credit sale ▶
 *           on day 20 a sale posted then REVERSED (critic defect D) ▶ on day 5 rent (POST /api/books/events) ▶ a month closed and locked, the last two left open ▶ the proof.
 * Every entry's source_ref starts 'demo:' (the shop's name ends ' - demo'); every line is the pack's money; a re-run finds the opening mark and writes nothing (sim-load).
 * One writer: lib/books.postEntry / reverseEntry — the entry the counter's hook would have made, with no chit and no till.
 */
'use strict';
const cashOf = (cents) => Math.round(cents) / 100;

/** every day of the plan through the one writer → { entries, rent } */
async function load(x) {
  const { API, path, PLAN, HIST, PACK, CURRENCY, TILL, taxRow, AT, dayAdd, callApi, books, closeMonth, drain, CLOCK, CUST, SUPPS, shopId, token, months } = x;
  const rate = HIST.gst_rate,
    mark = (kind, day) => 'demo:' + kind + ':' + day,
    engines = require(path.join(API, 'lib', 'books-engines'));
  let entries = 0,
    rent = 0,
    refused = 0,
    monthIx = 0;
  const post = async (event, what) => {
    const out = await books.postEntry(null, shopId, event).catch((e) => ({ ok: false, why: String(e && e.message) }));
    if (!out || !out.ok) {
      refused++;
      console.log('   RED  ' + what + ' refused — ' + JSON.stringify(out).slice(0, 220));
      return null;
    }
    entries++;
    return out;
  };
  const credit = (day, kind, ref, taxable, narration) => ({
    type: 'sale_bill',
    party: CUST,
    date: day,
    currency: CURRENCY,
    source_ref: mark(kind, day),
    ref: ref + day.slice(0, 7),
    by_rate: [taxRow(rate, taxable)],
    paid: {},
    round_off: 0,
    due_date: dayAdd(day, 14),
    by: null,
    narration
  });
  /* a payment through the api's own door (it needs an Idempotency-Key); 'oldest first' settles the party's oldest open bills */
  const pay = async (direction, party, amountMinor, day, mode, what) => {
    const key = mark('pay-' + direction + '-' + what, day),
      reply = await callApi('/api/books/payments', {
        method: 'POST',
        token,
        headers: { 'Idempotency-Key': key },
        body: { party_id: party, direction, amount_minor: amountMinor, currency: CURRENCY, mode, reference: 'demo: ' + what, received_at: day, client_ref: key, allocate: 'oldest_first', acknowledge: ['same_again', 'just_settled'] }
      });
    if (reply.status === 200 || reply.status === 201) entries++;
    else {
      refused++;
      console.log('   RED  payment ' + what + ' ' + day + ' refused — HTTP ' + reply.status + ' ' + JSON.stringify(reply.b).slice(0, 220));
    }
  };
  for (const row of PLAN.days) {
    const day = row.day;
    if (day.slice(8) === '01' && day !== PLAN.start) {
      if (monthIx <= months - 3) await closeMonth(dayAdd(day, -1)); /* the last two months stay open (REQ section 5, seed B) */
      monthIx++;
    }
    CLOCK.set(AT(day, 12, 0));
    const total = cashOf(Math.round(row.walkin * 100) + Math.round(row.walkin * rate));
    const bill = { currency: CURRENCY, pay: { cash: total }, taxes: [taxRow(rate, row.walkin)], round_off: 0 };
    const summary = engines.posting().daySummary([bill], { ref: 'demo walk-in ' + day, date: day, counter: TILL }, { pack: PACK });
    await post(Object.assign(summary, { source_ref: mark('walkin', day), counter: TILL, by: null, narration: 'demo: walk-in sales ' + day }), 'walk-in day ' + day);
    /* a TAX-INCLUSIVE sale: the customer saw the price with GST in it; the books split it into taxable + GST */
    if (row.inclusive) await post(credit(day, 'incl', 'DEMO-INC-', row.inclusive.taxable, 'demo: tax-inclusive sale ' + row.inclusive.total), 'tax-inclusive sale ' + day);
    /* a REVERSED sale: posted, then cancelled by its mirror entry — the Day book counts neither */
    if (row.reversed) {
      const sale = await post(credit(day, 'rev', 'DEMO-REV-', row.reversed.taxable, 'demo: sale entered in error'), 'sale to reverse ' + day);
      if (sale && sale.entry_id) {
        const undone = await books.reverseEntry(null, shopId, sale.entry_id, { by: null, reason: 'demo: sale entered in error, reversed' }).catch((e) => ({ ok: false, why: String(e && e.message) }));
        if (undone && undone.ok !== false) entries++;
        else {
          refused++;
          console.log('   RED  reversal ' + day + ' refused — ' + JSON.stringify(undone).slice(0, 200));
        }
      }
    }
    for (const buy of row.buys || []) {
      const gross = Math.round(buy.taxable * 100) + Math.round((buy.taxable * 100 * rate) / 100);
      await post(
        {
          type: 'purchase_bill',
          party: SUPPS[buy.s],
          date: day,
          currency: CURRENCY,
          source_ref: mark('buy' + buy.s, day),
          ref: 'DEMO-PUR' + buy.s + '-' + day.slice(0, 7),
          by_rate: [taxRow(rate, buy.taxable)],
          paid: {},
          round_off: 0,
          due_date: dayAdd(day, 30),
          by: null,
          narration: 'demo: supplier bill ' + cashOf(gross)
        },
        'purchase bill ' + buy.s + ' ' + day
      );
    }
    if (row.receipt) await pay('in', CUST, row.receipt, day, 'bank', 'customer receipt');
    for (const out of row.pays || []) await pay('out', SUPPS[out.s], out.cents, day, 'cash', 'supplier ' + out.s);
    if (row.rent) {
      const reply = await callApi('/api/books/events', { method: 'POST', token, body: { event: 'expense', class: 'rent', amount: row.rent, paid_from: HIST.rent.paid_from, date: day, client_ref: mark('rent', day) } });
      if (reply.status === 200) {
        entries++;
        rent++;
      } else {
        refused++;
        console.log('   RED  rent ' + day + ' refused — ' + JSON.stringify(reply.b).slice(0, 200));
      }
    }
  }
  await drain();
  return { entries, rent, refused };
}

/** the proof (reads only): each month's SOLD (the Day book) = the plan's sums = the hand-written file; every sale/expense entry demo-marked; every line in the pack's money */
async function prove(x, shopId, quiet) {
  const { API, path, PLAN, PROFILE, PROFILE_NAME, CUSTOMER, HEXPECT, CURRENCY, months, pool, sql, here } = x;
  const out = [];
  const line = (ok, name, detail) => {
    out.push(ok);
    console.log('   ' + (ok ? 'ok   ' : 'RED  ') + name + (detail ? ' — ' + detail : ''));
  };
  console.log('\n  history proof (' + (quiet ? 'as loaded' : 'this run') + '):');
  const sold = {};
  /* the read runs AS THE SHOP (db.withEntity sets app.current_entity, as every route does); the books tables are FORCE RLS, so a bare pool reads nothing */
  const days = await require(path.join(API, 'db')).withEntity(shopId, (db) => require(path.join(API, 'lib', 'books-store')).soldByDay(db, shopId));
  for (const d of days) sold[d.day.slice(0, 7)] = (sold[d.day.slice(0, 7)] || 0) + (d.sold && typeof d.sold === "object" ? d.sold.minor || 0 : d.sold); /* soldByDay: { minor, currency } since MIS 0a (f93df702); a bare number on an older api */
  const keys = Object.keys(HEXPECT),
    wrong = keys.filter((k) => Math.round(sold[k] || 0) !== HEXPECT[k].sold);
  line(!wrong.length, "every month's SOLD (incl. GST, the reversed sale out) = the plan's (" + (keys.length - wrong.length) + ' of ' + keys.length + ')', wrong.slice(0, 3).map((k) => k + ' got ' + (sold[k] || 0) + ' want ' + HEXPECT[k].sold).join('; '));
  try {
    const file = JSON.parse(require('fs').readFileSync(path.join(here, 'seed', 'mis-history-expected.json'), 'utf8')),
      hand = file.months;
    const entriesOf = {}; /* the shop's own entries per month: the demo-marked ones, the payments and the reversals (a tax close's set-off entry is the books', not the plan's) */
    for (const row of (await sql(`SELECT to_char(posting_date, 'YYYY-MM') AS m, count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND (source_ref LIKE 'demo:%' OR source_ref LIKE 'ev:%demo:%' OR source_ref LIKE 'pay:%' OR reverses_entry_id IS NOT NULL) GROUP BY 1`, [shopId])).rows) entriesOf[row.m] = row.n;
    if (file.profile === PROFILE_NAME)
      for (const k of Object.keys(hand).filter((m) => HEXPECT[m])) {
        line(Math.round(sold[k] || 0) === Math.round(hand[k].sold_incl_gst * 100), 'hand-written month ' + k + ' SOLD ' + hand[k].sold_incl_gst.toFixed(2), 'books hold ' + ((sold[k] || 0) / 100).toFixed(2));
        line(entriesOf[k] === hand[k].entries && HEXPECT[k].buys === Math.round(hand[k].purchases_ex_gst * 100), 'hand-written month ' + k + ' ' + hand[k].entries + ' entries, purchases ' + hand[k].purchases_ex_gst.toFixed(2) + ' ex GST', 'books hold ' + entriesOf[k] + ' entries, plan buys ' + (HEXPECT[k].buys / 100).toFixed(2));
      }
    else console.log('   (the hand-written months are for profile ' + file.profile + '; this is ' + PROFILE_NAME + ' — checked against its own plan only)');
    const planWrong = Object.keys(HEXPECT).filter((k) => (entriesOf[k] || 0) !== HEXPECT[k].entries);
    line(!planWrong.length, "every month's demo entries (sales, purchases, payments, receipts, rent, reversals) = the plan's (" + (keys.length - planWrong.length) + ' of ' + keys.length + ')', planWrong.slice(0, 3).map((k) => k + ' got ' + entriesOf[k] + ' want ' + HEXPECT[k].entries).join('; '));
  } catch (e) {
    line(false, 'the hand-written expectations file is readable', e.message);
  }
  const one = async (query, params) => (await sql(query, params)).rows[0].n;
  const unmarked = await one(
    `SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND event_type IN ('walkin_day', 'sale_bill', 'expense', 'purchase_bill') AND reverses_entry_id IS NULL AND source_ref NOT LIKE 'demo:%' AND source_ref NOT LIKE 'ev:%demo:%'`,
    [shopId]
  );
  line(unmarked === 0, 'every sale and expense entry is demo-marked, source_ref demo:… (' + unmarked + ' not)');
  const money = await one(`SELECT count(*)::int AS n FROM journal_line WHERE entity_id = $1 AND currency <> $2`, [shopId, CURRENCY]);
  line(money === 0, 'every line is in ' + CURRENCY + ' (' + money + ' not)');
  const reversed = await one(`SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND reverses_entry_id IS NOT NULL`, [shopId]);
  line(reversed === months, 'one reversed sale a month (' + reversed + ' of ' + months + ')');
  /* the party ledgers: each supplier owes what the plan left unpaid (credit - debit on the creditors ledger), the customer owes what is left (debtors) — read by party from the lines */
  const owing = async (role, side) => {
    const rows = (await sql(`SELECT i.display_name AS name, COALESCE(SUM(${side}), 0)::bigint AS n, count(*)::int AS lines FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id JOIN identities i ON i.identity_id = l.party_id WHERE l.entity_id = $1 AND a.role = $2 GROUP BY 1`, [shopId, role])).rows;
    return new Map(rows.map((row) => [row.name, row]));
  };
  const suppliers = await owing('creditors', 'l.cr_minor - l.dr_minor'),
    customers = await owing('debtors', 'l.dr_minor - l.cr_minor');
  const badSupplier = (PROFILE.suppliers || []).map((name, ix) => ({ name, ix, row: suppliers.get(name) })).filter((item) => !item.row || Number(item.row.n) !== PLAN.owing.ap[item.ix]);
  line(!badSupplier.length && suppliers.size === (PROFILE.suppliers || []).length, 'supplier ledgers exist and each owes what the plan left unpaid (' + [...suppliers.entries()].map(([name, row]) => name + ' ' + (Number(row.n) / 100).toFixed(2) + ' over ' + row.lines + ' lines').join('; ') + ')', badSupplier.map((item) => item.name + ' want ' + (PLAN.owing.ap[item.ix] / 100).toFixed(2)).join('; '));
  const customer = customers.get(CUSTOMER);
  line(!!customer && Number(customer.n) === PLAN.owing.ar, 'the customer ledger exists and owes what the plan left (' + (customer ? (Number(customer.n) / 100).toFixed(2) + ' over ' + customer.lines + ' lines' : 'none') + ', want ' + (PLAN.owing.ar / 100).toFixed(2) + ')');
  const unbalanced = await one(`SELECT count(*)::int AS n FROM (SELECT entry_id FROM journal_line WHERE entity_id = $1 GROUP BY entry_id HAVING SUM(dr_minor) <> SUM(cr_minor)) t`, [shopId]);
  line(unbalanced === 0, 'every entry balances (' + unbalanced + ' do not)');
  const failures = out.filter((ok) => !ok).length;
  console.log('  ' + (failures ? '✗ ' + failures + ' RED' : '✓ all green') + ' · ' + out.length + ' lines');
  return failures;
}
module.exports = { load, prove };
