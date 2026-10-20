'use strict';
/**
 * tests/reports-truth.realstack.cjs — REPORTS / HOME TRUTH, on the LOCAL stack (K-TRUTH-1 2026-10-19; case list: PM/BOX-TRUTH-TESTS.md §15 "Reports / Home").
 *
 * REP-4. Principles: facts come from real records; each card says something OR says why not · a card's figure = the figure on the screen it opens ·
 * periods compare like for like · a 12-month trend is the sum of the monthly rollups.
 * RP-01 every Home card answers · RP-02 none is silent (a line or a reason) · RP-03 a card's figure = its screen (reports ↔ folders MIS; crm ↔ CRM page) ·
 * RP-04 the Orders card = the despatch list · RP-05 "needs you N" names what and its N is the real count · RP-07 a shop shut on Sundays still gets a
 * weekly change · RP-08 the 12-month trend = Σ the monthly rollups sent (two counters).
 * Not here: RP-06 rollup survives a purge (needs a DELETE; offline ✓ rollup.test.js) · RP-09 badge words (W4/W5, a screen) · RP-10 pulse ✓ · RP-11 ✓.
 * A `gap:` FAIL is a RECORDED finding (REPORTS-BACKLOG "K-TRUTH-1 2026-10-19"), never fixed here. LOCAL ONLY.
 * Break-tested 2026-10-19: each passing case was run once with its expected figure flipped to a wrong one (RP-03a 5 not 4, RP-05 3 not 2, RP-04 2 not 1, RP-08 +1 minor) and went red.
 * Run: node tests/reports-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 26-reporting-mis-and-bi/README
 */
const H = require('./lib/truth-harness.cjs');
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
  const A = await freshShop(RUN + 'a', 'Reports truth');
  ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');

  const first = {};
  for (const c of CARDS) first[c] = await card(A, c);
  await kase('RP-01', 'every Home card answers 200 with a state (' + CARDS.length + ' cards, a fresh shop)', async () => {
    const bad = CARDS.filter((c) => first[c].status !== 200 || STATES.indexOf(first[c].b.state) < 0);
    expect(!bad.length, 'no answer or no state: ' + bad.map((c) => c + ' ' + first[c].status + ' ' + first[c].b.state).join(', '));
  });
  await kase('RP-02', 'no card is silent: each has a line, or says why it has none (unavailable), or is the rail\'s own digits', async () => {
    const silent = CARDS.filter((c) => { const b = first[c].b; return c !== 'rail' && !(Array.isArray(b.lines) && b.lines.length) && !b.unavailable; });
    expect(!silent.length, 'silent on a fresh shop (state shown, no line, no reason): ' + silent.map((c) => c + '=' + first[c].b.state).join(', '));
    expect(typeof first.rail.b.suppliers === 'number' || (first.rail.b.lines || []).length, 'the rail card has neither digits nor a line: ' + JSON.stringify(first.rail.b).slice(0, 120));
  }, 'a card with state but no line and no reason: REPORTS-BACKLOG K-TRUTH-1');
  const unknown = await card(A, 'no-such-card');
  await kase('RP-02b', 'an unknown card is refused 404 with a sentence (not an empty 200)', async () => { expect(unknown.status === 404 && /no Home card/i.test(unknown.b.message || ''), unknown.status + ' ' + JSON.stringify(unknown.b).slice(0, 120)); });

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

  await kase('RP-05', 'the catalogue card says "needs you" with its reason, and N = the items that really have no cost', async () => {
    const items = ok(await j('/api/products', { token: A.token }), 'products').b.items;
    const real = items.filter((i) => !(i.item_data.cost && i.item_data.cost.value != null)).length;
    const c = (await card(A, 'product-lab')).b, need = (c.lines || []).find((l) => l.tone === 'dn');
    expect(c.state === 'needs_you' && need && /no cost/i.test(need.text) && need.value === real && real === 2 && c.figures.no_cost === real, 'card ' + JSON.stringify(c.lines) + ' · items without cost ' + real + ' (expected 2 of 3)');
  });

  /* RP-04: an online order is on the Orders card and on the despatch list */
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
    const have = t.slots.filter((s) => s.gross_minor != null);
    const wrong = have.filter((s) => s.gross_minor !== sent[s.key]);
    const total = have.reduce((a, s) => a + s.gross_minor, 0), want = have.reduce((a, s) => a + sent[s.key], 0);
    expect(t.slots.length === 12 && have.length === 11 && !wrong.length && total === want && total > 0, 'slots ' + t.slots.length + ' · with figures ' + have.length + ' · wrong ' + JSON.stringify(wrong.map((s) => [s.key, s.gross_minor, sent[s.key]])) + ' · total ' + total + ' want ' + want);
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

  finish('reports-truth', process.env.REPORTS_TRUTH_JSON, { run: RUN });
})().catch((e) => { console.error('reports truth could not run:', e && e.message); process.exit(2); });
