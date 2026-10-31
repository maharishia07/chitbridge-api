'use strict';
/**
 * tests/reports-truth.realstack.cjs — REPORTS / HOME TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §15 "Reports / Home").
 *
 * REP-4. Principles: facts come from real records; each card says something OR says why not · a card's figure = the figure on the screen it opens ·
 * periods compare like for like · a 12-month trend is the sum of the monthly rollups.
 * RP-01 every Home card answers · RP-02 none is silent (a line or a reason) · RP-03 a card's figure = its screen (reports ↔ folders MIS; crm ↔ CRM page) ·
 * RP-04 the Orders card = the despatch list · RP-05 "needs you N" names what and its N is the real count · RP-07 a shop shut on Sundays still gets a
 * weekly change · RP-08 the 12-month trend = Σ the monthly rollups sent (two counters).
 * Added 2026-10-24 (box truth, RP-01..RP-11): RP-01b country-lab answers · RP-02c the named cards (shop, CRM, parallel run, stock) say a line or a reason · RP-02d a fresh shop's
 * trend, catalogue and tax cards are not silent (gap REP-44, armed) · RP-03c the Accounts card carries made / owes (gap REP-2, armed) · RP-05b the reasons sum to N · RP-05c N follows the
 * record (a cost is set, N drops) · RP-07a/b a 6-day and a 7-day week are made through routes (premise, control) · RP-08b each month's change % = the sums sent · RP-08c a year
 * folds from its months and the running year SAYS it is partial · RP-10 the pulse watermark moves for a new chit, stays for none, and is the shop's own.
 * Not here: RP-04 is the orders box (api #410, OR-05a/b) · RP-06 a rollup survives a purge (no route purges day detail; ✓ offline rollup.test.js) · RP-09 badge words (W4/W5, a screen) ·
 * RP-11 a network report's currency is a lens (lib/reporting.js has no route yet; ✓ offline reporting.test.js) · RP-10 a status change in place (no cheap route to move one; ✓ pulse.test.cjs).
 * A `gap:` FAIL is a RECORDED finding (REPORTS-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY.
 * Break-tested 2026-10-19: each passing case was run once with its expected figure flipped to a wrong one (RP-03a 5 not 4, RP-05 3 not 2, RP-04 2 not 1, RP-08 +1 minor) and went red.
 * Run: node tests/reports-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 26-reporting-mis-and-bi/README
 */
const H = require('./lib/truth-harness.cjs');
/* ACC-198: tax registration is never assumed - an unknown shop's sales wait with the question; these shops sell untaxed, so they SAY not registered */
const NOT_REGISTERED = { tax: { registered: false } };
const R = require('../lib/rollup');
const { CUSTOMER_OTP, j, ok, pause, kase, expect, bill, freshShop, finish } = H;
const RUN = 'rp' + (Date.now() % 1e10).toString(36);
const CARDS = ['till', 'counters', 'account', 'reports', 'accounts', 'orders', 'operations', 'disputes', 'assist', 'people', 'finance', 'product-lab', 'combo-lab', 'offer-lab', 'tax-lab',
  'rail', 'marketing', 'crm', 'trend', 'storefront', 'compare', 'connectors', 'governance', 'plan'];   /* lib/home-facts CARDS */
const STATES = ['needs_you', 'in_use', 'not_started'];
const card = async (shop, name) => j('/api/facts/' + name, { token: shop.token });
const sendSummary = async (shop, period, key, gross, counter, source) => {
  const t = R.totals([{ total: gross, payments: [{ how: 'cash', amount: gross }] }]);
  const chit = R.chitOf(R.summary(period, key, t, { till: { id: counter, name: 'Counter ' + counter.slice(1) }, source }));
  return ok(await j('/api/chits/send', { method: 'POST', token: shop.token, body: chit }), period + ' summary ' + key + ' ' + counter);
};
/** every day key of a calendar month / of an ISO week (Monday first) */
const daysOfMonth = (d) => { const y = d.getUTCFullYear(), m = d.getUTCMonth(), n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => R.dayKey(new Date(Date.UTC(y, m, i + 1)))); };
const mondayOfIso = (year, week) => { const jan4 = new Date(Date.UTC(year, 0, 4)); return new Date(jan4.getTime() + ((week - 1) * 7 - ((jan4.getUTCDay() || 7) - 1)) * 86400000); };
const daysFrom = (monday, n) => Array.from({ length: n }, (_, i) => R.dayKey(new Date(monday.getTime() + i * 86400000)));

(async () => {
  console.log('\n── reports truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  const A = await freshShop(RUN + 'a', 'Reports truth', NOT_REGISTERED);
  ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');

  const first = {};
  for (const c of CARDS) first[c] = await card(A, c);
  await kase('RP-01', 'every Home card answers 200 with a state (' + CARDS.length + ' cards, a fresh shop)', async () => {
    const bad = CARDS.filter((c) => first[c].status !== 200 || STATES.indexOf(first[c].b.state) < 0);
    expect(!bad.length, 'no answer or no state: ' + bad.map((c) => c + ' ' + first[c].status + ' ' + first[c].b.state).join(', '));
  });
  await kase('RP-01b', 'the country-lab card answers a state and its own country pack line (the 25th card, not in the list above)', async () => {
    const r = await card(A, 'country-lab'), b = r.b;
    expect(r.status === 200 && STATES.indexOf(b.state) >= 0 && Array.isArray(b.lines) && b.lines.length && b.figures && b.figures.shop_country === 'IN', 'country-lab ' + r.status + ' ' + JSON.stringify(b).slice(0, 200));
  });
  await kase('RP-02', 'no card is silent: each has a line, or says why it has none (unavailable), or is the rail\'s own digits', async () => {
    const silent = CARDS.filter((c) => { const b = first[c].b; return c !== 'rail' && !(Array.isArray(b.lines) && b.lines.length) && !b.unavailable; });
    expect(!silent.length, 'silent on a fresh shop (state shown, no line, no reason): ' + silent.map((c) => c + '=' + first[c].b.state).join(', '));
    expect(typeof first.rail.b.suppliers === 'number' || (first.rail.b.lines || []).length, 'the rail card has neither digits nor a line: ' + JSON.stringify(first.rail.b).slice(0, 120));
  }, 'a card with state but no line and no reason: REPORTS-BACKLOG K-TRUTH-1');
  const unknown = await card(A, 'no-such-card');
  await kase('RP-02b', 'an unknown card is refused 404 with a sentence (not an empty 200)', async () => { expect(unknown.status === 404 && /no Home card/i.test(unknown.b.message || ''), unknown.status + ' ' + JSON.stringify(unknown.b).slice(0, 120)); });

  /* RP-02c: the cards the row names that hold today: Online shop · CRM · Parallel run · Stock — each says a line, or says why it has none */
  const NAMED = { storefront: 'Online shop', crm: 'CRM', compare: 'Parallel run', operations: 'Stock' };
  await kase('RP-02c', 'the Online shop, CRM, Parallel run and Stock cards each say a line or the reason they have none (not silent)', async () => {
    const silent = Object.keys(NAMED).filter((c) => { const b = first[c].b; return !(Array.isArray(b.lines) && b.lines.length) && !b.unavailable; });
    expect(!silent.length, 'silent: ' + silent.map((c) => NAMED[c] + '=' + first[c].b.state).join(', '));
  });
  /* RP-02d: Trend · Catalogue · Tax on a shop with no records yet — REP-44 (PR #304). Armed: the premise is that each card answered and says it is not started. */
  const QUIET = ['trend', 'product-lab', 'tax-lab'];
  await kase('RP-02d-premise', 'on a fresh shop (no summary, no product) the Trend, Catalogue and Tax cards answer 200 and say not_started', async () => {
    const off = QUIET.filter((c) => first[c].status !== 200 || first[c].b.state !== 'not_started');
    expect(!off.length, 'not a fresh not_started card: ' + off.map((c) => c + ' ' + first[c].status + ' ' + first[c].b.state).join(', '));
  });
  await kase('RP-02d', 'a not-started Trend, Catalogue or Tax card still says something, or why it has nothing (a line or a reason)', async () => {
    const silent = QUIET.filter((c) => { const b = first[c].b; return !(Array.isArray(b.lines) && b.lines.length) && !b.unavailable; });
    expect(!silent.length, 'silent while not started: ' + silent.join(', '));
  }, 'REPORTS-BACKLOG REP-44 (api #304): product-lab, tax-lab and trend answer a state with no line and no reason');

  /* ── the shop with records ── */
  const mk = async (name, cost) => {
    const r = ok(await j('/api/products', { method: 'POST', token: A.token, body: { item_data: Object.assign({ name, unit: 'piece', price: 60 }, cost == null ? {} : { cost: { value: cost, source: 'manual' } }) } }), 'product ' + name).b;
    return { id: r.item.item_id, name, unit: 'piece', price: 60 };
  };
  const P = await mk('Rice'); await mk('Dal'); await mk('Oil', 30);
  const lead = ok(await j('/api/crm/leads', { method: 'POST', token: A.token, body: { name: 'Only A Lead', phone: '9876530001' } }), 'lead').b.party;
  const buyer = ok(await j('/api/crm/leads', { method: 'POST', token: A.token, body: { name: 'Real Buyer', phone: '9876530002' } }), 'buyer').b.party;
  const named = bill(RUN + '-n1', [[P, 1]]); named.business_json.customer = { name: 'Real Buyer', party_id: buyer.party_id };
  ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: named }), 'named bill');
  for (let i = 0; i < 3; i++) ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: bill(RUN + '-z' + i, [[P, 2]]) }), 'bill');
  await pause(2500);

  await kase('RP-03a', 'the Reports card "N chits open" equals the folders MIS open count (one engine, two readers)', async () => {
    const c = (await card(A, 'reports')).b, mis = ok(await j('/api/folders/mis', { token: A.token }), 'mis').b;
    expect(c.figures && c.figures.open === mis.all.open && mis.all.open === 4, 'card ' + JSON.stringify(c.figures) + ' · mis open ' + mis.all.open + ' (4 chits sent)');
  });
  await kase('RP-03b', 'the CRM card\'s customers equals the customers the CRM page lists (a lead is not yet a customer)', async () => {
    const c = (await card(A, 'crm')).b, page = ok(await j('/api/crm/parties', { token: A.token }), 'crm list').b;
    expect(c.figures.customers === page.count, 'card says ' + c.figures.customers + ' customers · the CRM page lists ' + page.count + ' (' + lead.display_name + ' is only a lead)');
  }, 'the card counts roles.customer incl. leads; the CRM page lists customers only (lead = a stage, CRM-D*)');

  /* RP-03c: the Accounts card should carry "made / owes this month" so it can equal the Accounts figure (X-10). Armed: books are on and four sales are sent. */
  await kase('RP-03c-premise', 'the Accounts card answers 200 with a state and its ledger is on (a reason would mean the ledger is off)', async () => {
    const r = await card(A, 'accounts');
    expect(r.status === 200 && STATES.indexOf(r.b.state) >= 0 && !r.b.unavailable, 'accounts ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
  });
  await kase('RP-03c', 'the Accounts card carries a made / owes figure for this month (so it can equal the Accounts figure)', async () => {
    const b = (await card(A, 'accounts')).b, said = (b.lines || []).map((l) => l.text).join(' | ');
    expect(/made|owes/i.test(said), 'the card says: ' + said + ' (only what waits and when it was checked)');
  }, 'REPORTS-BACKLOG REP-2 (walk W7, X-10): the Accounts tile shows "Checked today", not made / owes this month; the equality with the Accounts figure waits on it');

  await kase('RP-05', 'the catalogue card says "needs you" with its reason, and N = the items that really have no cost', async () => {
    const items = ok(await j('/api/products', { token: A.token }), 'products').b.items;
    const real = items.filter((i) => !(i.item_data.cost && i.item_data.cost.value != null)).length;
    const c = (await card(A, 'product-lab')).b, need = (c.lines || []).find((l) => l.tone === 'dn');
    expect(c.state === 'needs_you' && need && /no cost/i.test(need.text) && need.value === real && real === 2 && c.figures.no_cost === real, 'card ' + JSON.stringify(c.lines) + ' · items without cost ' + real + ' (expected 2 of 3)');
  });

  await kase('RP-05b', 'the reasons add up: every "needs you" line names what is needed and the lines\' values sum to the card\'s N (no cost = 2)', async () => {
    const c = (await card(A, 'product-lab')).b, dn = (c.lines || []).filter((l) => l.tone === 'dn');
    const sum = dn.reduce((a, l) => a + (Number(l.value) || 0), 0);
    expect(dn.length && dn.every((l) => String(l.text || '').trim()) && sum === c.figures.no_cost && sum === 2, 'needs-you lines ' + JSON.stringify(dn) + ' · sum ' + sum + ' · figure ' + JSON.stringify(c.figures));
  });
  await kase('RP-05c', 'N follows the record: set a cost on one of the two items without one and the card says 1, not 2', async () => {
    ok(await j('/api/products/' + P.id, { method: 'PATCH', token: A.token, body: { merge: true, item_data: { cost: { value: 20, source: 'manual' } } } }), 'set Rice cost');
    const items = ok(await j('/api/products', { token: A.token }), 'products').b.items;
    const real = items.filter((i) => !(i.item_data.cost && i.item_data.cost.value != null)).length;
    const c = (await card(A, 'product-lab')).b, need = (c.lines || []).find((l) => l.tone === 'dn');
    expect(real === 1 && need && need.value === 1 && c.figures.no_cost === 1, 'items without cost ' + real + ' · card ' + JSON.stringify(c.lines) + ' ' + JSON.stringify(c.figures));
  });

  /* RP-04: an online order is on the Orders card and on the despatch list (the orders box holds the same pair as OR-05a/b, api #410; kept: ids stay) */
  const door = '/api/catalogue/' + A.bridge, email = RUN + '-c@local.test';
  ok(await j(door + '/order/start', { method: 'POST', body: { email, name: 'Card Counts Me' } }), 'order start');
  const order = ok(await j(door + '/order/confirm', { method: 'POST', body: { email, otp: CUSTOMER_OTP, line_items: [{ item_id: P.id, quantity: 1 }] } }), 'order confirm').b;
  await pause(1200);
  await kase('RP-04', 'the Orders card counts the open online order, and the despatch list holds the same order', async () => {
    const c = (await card(A, 'orders')).b, tasks = JSON.stringify(ok(await j('/api/till/tasks?kind=despatch', { token: A.token }), 'tasks').b);
    expect(c.figures.open === 1 && tasks.includes(order.chit_id), 'card open ' + JSON.stringify(c.figures) + ' · on the despatch list ' + tasks.includes(order.chit_id));
  });

  /* ── RP-08: 12 months, two counters ── */
  const now = new Date(), sent = {};
  for (let k = 1; k <= 24; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 15)), key = R.monthKey(d), c1 = 1000 + k * 10, c2 = k <= 12 ? 500 + k : 0;
    await sendSummary(A, 'month', key, c1, 'C1', daysOfMonth(d));
    if (c2) await sendSummary(A, 'month', key, c2, 'C2', daysOfMonth(d));
    sent[key] = (c1 + c2) * 100;
  }
  await pause(1500);
  await kase('RP-08', 'the 12-month trend = the monthly rollups sent: each month is both counters added, and the slots add up to the sum', async () => {
    const t = ok(await j('/api/till/summary?compare=1&period=month&n=12', { token: A.token }), 'trend').b;
    /* REP-48: the running month is the BOOKS' (the seeded shop has bills in them) - the closed months are the rollups sent */
    const have = t.slots.filter((s) => s.gross_minor != null && !s.coverage.partial), running = t.slots[t.slots.length - 1];
    const wrong = have.filter((s) => s.gross_minor !== sent[s.key]);
    const total = have.reduce((a, s) => a + s.gross_minor, 0), want = have.reduce((a, s) => a + sent[s.key], 0);
    expect(t.slots.length === 12 && have.length === 11 && !wrong.length && total === want && total > 0 && t.sales_from === 'books' && running.gross_minor > 0, 'slots ' + t.slots.length + ' · with figures ' + have.length + ' · wrong ' + JSON.stringify(wrong.map((s) => [s.key, s.gross_minor, sent[s.key]])) + ' · total ' + total + ' want ' + want);
  });

  await kase('RP-08b', 'each closed month beside last year: change % = (this − last year) × 100 ÷ last year from the sums sent; the running month says so and has no change', async () => {
    const t = ok(await j('/api/till/summary?compare=1&period=month&n=12', { token: A.token }), 'trend').b, bad = [];
    const closed = t.slots.filter((s) => !s.coverage.partial && s.gross_minor != null);
    for (const s of closed) {
      const ly = sent[R.lastYearKey('month', s.key)], want = Math.round((((sent[s.key] - ly) * 100) / ly) * 100) / 100;
      if (ly == null || s.change_pct == null || Math.abs(s.change_pct - want) > 0.006) bad.push([s.key, s.change_pct, want]);
    }
    const running = t.slots[t.slots.length - 1];
    expect(closed.length === 11 && !bad.length && running.coverage.partial === true && running.change_pct === null, 'closed ' + closed.length + ' · wrong ' + JSON.stringify(bad) + ' · running ' + JSON.stringify({ key: running.key, partial: running.coverage.partial, change: running.change_pct }));
  });
  await kase('RP-08c', 'a year folds from its months: the last closed year = the months sent in it; the running year is partial and has no change %', async () => {
    const t = ok(await j('/api/till/summary?compare=1&period=year&n=2', { token: A.token }), 'years').b, fy = t.fy_start_month, sums = {};
    for (let k = 1; k <= 24; k++) { const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 15)), yk = R.keyOf('year', at, { fyStart: fy }); sums[yk] = (sums[yk] || 0) + sent[R.monthKey(at)]; }
    const [prior, running] = t.slots, runBooks = ok(await j('/api/till/summary?compare=1&period=month&n=1', { token: A.token }), 'month').b.slots[0].gross_minor;
    const runWant = (sums[running.key] || 0) + runBooks; /* REP-48: the running year = its sent months + the running month as the books hold it */
    expect(t.slots.length === 2 && prior.gross_minor === sums[prior.key] && prior.coverage.partial === false && prior.coverage.short === false && running.coverage.partial === true && running.change_pct === null && running.gross_minor === runWant,
      'fy start ' + fy + ' · slots ' + JSON.stringify(t.slots.map((s) => [s.key, s.gross_minor, s.coverage.partial, s.coverage.short, s.change_pct])) + ' · sums ' + JSON.stringify(sums));
  });

  /* ── RP-07: a shop shut on Sundays: last week 6 trading days (600), the same week last year 7 days (700) → 100 a day both → about 0 % ── */
  const lastWeekDay = new Date(now.getTime() - 7 * 86400000), wk = R.keyOf('week', lastWeekDay), ly = R.lastYearKey('week', wk);
  const mon = (key) => { const m = /^(\d{4})-W(\d{2})$/.exec(key); return mondayOfIso(+m[1], +m[2]); };
  await sendSummary(A, 'week', wk, 600, 'C1', daysFrom(mon(wk), 6));
  await sendSummary(A, 'week', ly, 700, 'C1', daysFrom(mon(ly), 7));
  await pause(1200);
  await kase('RP-07', 'a shop shut on Sundays still gets a weekly change, compared on trading days (600 over 6 days vs 700 over 7 = about 0 %), not null', async () => {
    const t = ok(await j('/api/till/summary?compare=1&period=week&n=4', { token: A.token }), 'weeks').b, s = t.slots.find((x) => x.key === wk);
    expect(s && s.gross_minor === 60000 && s.change_pct != null && Math.abs(s.change_pct) < 1, 'slot ' + JSON.stringify(s && { key: s.key, gross: s.gross_minor, coverage: s.coverage, ly: s.last_year, change_pct: s.change_pct }));
  }, 'REPORTS-BACKLOG rollup "7 days a week": a 6-day week is "short", so its change is null, never like-for-like');

  await kase('RP-07a-premise', 'the 6-day week is on the record as 600 (6 days seen of 7) beside last year\'s 700, so the case above is armed', async () => {
    const t = ok(await j('/api/till/summary?compare=1&period=week&n=4', { token: A.token }), 'weeks').b, s = t.slots.find((x) => x.key === wk);
    expect(s && s.gross_minor === 60000 && s.coverage.seen === 6 && s.last_year.gross_minor === 70000, 'slot ' + JSON.stringify(s && { gross: s.gross_minor, coverage: s.coverage, ly: s.last_year }));
  });
  /* RP-07b control: a whole 7-day week and its whole last year compare — the rule works when every day trades */
  let full = null;
  for (const back of [14, 21, 28]) { const key = R.keyOf('week', new Date(now.getTime() - back * 86400000)), last = R.lastYearKey('week', key); if (last) { full = { key, last }; break; } }
  await sendSummary(A, 'week', full.key, 700, 'C1', daysFrom(mon(full.key), 7));
  await sendSummary(A, 'week', full.last, 350, 'C1', daysFrom(mon(full.last), 7));
  await pause(1200);
  await kase('RP-07b', 'control: a whole 7-day week (700) beside a whole 7-day week last year (350) shows +100 %', async () => {
    const t = ok(await j('/api/till/summary?compare=1&period=week&n=5', { token: A.token }), 'weeks').b, s = t.slots.find((x) => x.key === full.key);
    expect(s && s.gross_minor === 70000 && s.change_pct === 100, 'slot ' + JSON.stringify(s && { key: s.key, gross: s.gross_minor, coverage: s.coverage, ly: s.last_year, change_pct: s.change_pct }));
  });

  /* ── RP-10: the pulse watermark (GET /api/chits/pulse) moves when a list row would change, and only for this shop ── */
  const B = await freshShop(RUN + 'b', 'Reports truth other', NOT_REGISTERED);
  const pulse = async (shop) => ok(await j('/api/chits/pulse', { token: shop.token }), 'pulse').b.w;
  const w0 = await pulse(A), w0again = await pulse(A), b0 = await pulse(B);
  ok(await j('/api/chits/send', { method: 'POST', token: A.token, body: bill(RUN + '-p1', [[P, 1]]) }), 'bill for the pulse');
  await pause(1200);
  const w1 = await pulse(A), b1 = await pulse(B);
  await kase('RP-10', 'the watermark is a value, holds while nothing changes, moves when a chit arrives, and the other shop\'s does not move', async () => {
    expect(typeof w0 === 'string' && w0 === w0again, 'before: ' + w0 + ' then ' + w0again + ' (null means "cannot tell")');
    expect(typeof w1 === 'string' && w1 !== w0, 'after a new chit: ' + w1 + ' (was ' + w0 + ')');
    expect(typeof b0 === 'string' && b0 === b1, 'the other shop moved: ' + b0 + ' → ' + b1);
  });

  finish('reports-truth', process.env.REPORTS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('reports truth could not run:', e && e.message); process.exit(2); });
