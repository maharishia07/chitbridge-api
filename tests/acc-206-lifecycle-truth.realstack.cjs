'use strict';
/**
 * tests/acc-206-lifecycle-truth.realstack.cjs — ACC-206 G3: THE BILL'S TOTAL IS ONE FIGURE IN EVERY STORED COPY, PER CHIT KIND, PER COUNTRY (RULE-MATRIX R6, row "one invoice, everywhere").
 * Rule under test: business_json.invoice.ValDtls.TotInvVal == summary_json.money.total == summary_json.total_value == chit_detail.total_value, on BOTH copies of a rail chit,
 * with the list row and the detail saying the same thing, and the money's currency_code equal to the shop's. EQUALITY ONLY (docs/critique/ACC-206-G2G3-CRITIC.md G3.1):
 * the run reads what the api answers and compares the carried figures. It computes no total of its own and holds no pick of its own — the one pick is lib/counter-bill.pickOf,
 * called here to say `agree: true` (a mismatch there is the finding). The only hand figure is the counter's own invoice, carried exactly as the till carries it.
 * KINDS (only those that carry a total): C1 counter cash · C2 counter named · C5/C6 app invoice · C7 order · C8 credit note. COUNTRIES: IN · AU · AE.
 * EXPECTED-NULL ROWS (by decision, PLAN R2): an inquiry (not a billing document) and a multi-recipient invoice carry NO total (null on every copy, never 0); the TR-6 operator copy (oversight)
 * is `withheld` — proved on the stored shape through pickOf (a network tree is not driven here). A pre-2-Nov chit (total_value = net beside money.total) is `legacy_net`, cross-copy equality NOT asserted.
 * NOT FLIPPED, by design: C13 storefront order (summed in the route, CAT-243 — a row there would pass because both copies are the same wrong sum) · f12 (recompute at post and completion, R7) is a different finding.
 * RECORDED SKIPS (named, never silently absent): C12 repeat, C18 CTP (no driver in the harness), the 3-decimal currency (no pack sells in one yet).
 * Runs in CI (integration, the T2 loop over tests/*-truth.realstack.cjs), never on a laptop: node tests/acc-206-lifecycle-truth.realstack.cjs  (API_BASE=http://127.0.0.1:<port>)
 * CARD 14-accounting/README
 */
const H = require('./lib/truth-harness.cjs');
const counterBill = require('../lib/counter-bill');
const { j, ok, kase, skip, expect, bill, invoice, order, freshShop, finish } = H;
const RUN = 'a206' + (Date.now() % 1e9).toString(36).padStart(6, '0');

/** the three countries: the shop's setup as the Country screen sends it, and the money its chits must name */
const COUNTRIES = [
  { id: 'IN', currency: 'INR', setup: { tax: { registered: true, number: '33AAAPK9001M1ZW', scheme: 'regular' } }, partner: { tax: { registered: true, number: '33AAAPK9002M1ZV', scheme: 'regular' } }, rate: 18 },
  { id: 'AU', currency: 'AUD', setup: { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false } }, rate: 10 },
  { id: 'AE', currency: 'AED', setup: { country: 'AE', currency: 'AED', fy_start_month: 1, timezone: 'Asia/Dubai', tax: { registered: false } }, rate: 5 }
];

const send = (shop, body) => j('/api/chits/send', { method: 'POST', token: shop.token, body });
const chitIdOf = (reply) => reply.b.chit_id || (reply.b.chit && reply.b.chit.chit_id);
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

/** the stored copies of one chit as ONE shop's detail answers them (never recomputed): the three header copies, the detail column, the currency each names */
async function copiesOf(shop, chitId) {
  const answer = ok(await j('/api/chits/' + chitId, { token: shop.token }), 'detail ' + chitId).b;
  const header = answer.header || {}, summary = header.summary_json || {}, business = header.business_json || {}, valDtls = (business.invoice && business.invoice.ValDtls) || null;
  return {
    header: { summary_json: summary, business_json: business },
    figures: { invoice: valDtls ? valDtls.TotInvVal : null, money: summary.money ? summary.money.total : null, total_value: summary.total_value, detail: answer.detail ? answer.detail.total_value : null },
    currencies: { money: summary.money ? summary.money.currency_code : null, detail: answer.detail ? answer.detail.currency_code : null, invoice: business.invoice && business.invoice.Currency }
  };
}

/**
 * the figures a shop's lists say for a chit: the mailbox rows (sent · inbox) ship the header's summary, a bill leaves them for the Bills folders (lib/folder-inventory) whose rows ship the one pick as `value`.
 * → { total_value, money_total, where } from the first list that holds the chit; a chit in none of them is a failure (a silently absent row is how f11 hid)
 */
async function listFigureOf(shop, chitId) {
  const folders = [require('../lib/folder-inventory').sysId('B-1300'), require('../lib/folder-inventory').sysId('B-2100')];
  const lists = [['sent', '/api/chits/sent'], ['inbox', '/api/chits/inbox']].concat(folders.map((id) => ['bills folder', '/api/folders/' + id + '/chits']));
  for (const [name, path] of lists) {
    const page = ok(await j(path + '?limit=100', { token: shop.token }), name + ' list').b;
    const row = (page.chits || []).find((x) => x.chit_id === chitId);
    if (!row) continue;
    const summary = row.summary_json;
    return summary ? { total_value: summary.total_value, money_total: summary.money && summary.money.total, where: name } : { total_value: row.value, money_total: row.value, where: name };
  }
  throw new Error('the chit ' + chitId + ' is in none of the sent list, the inbox or the Bills folders');
}

/** the equality rows for one copy: every set figure is the same number, it is a number worth something, the api's own pick agrees, and every named currency is the shop's */
function assertOneFigure(copy, currency, what) {
  const set = Object.entries(copy.figures).filter(([, v]) => v !== null && v !== undefined);
  expect(set.length >= 3, what + ': fewer than three copies carry the total: ' + JSON.stringify(copy.figures));
  const first = Number(set[0][1]);
  expect(Number.isFinite(first) && first > 0, what + ': the total is not a figure: ' + JSON.stringify(copy.figures));
  set.forEach(([name, v]) => expect(same(v, first), what + ': ' + name + ' ' + v + ' differs from ' + set[0][0] + ' ' + first + ' — ' + JSON.stringify(copy.figures)));
  const picked = counterBill.pickOf(copy.header);
  expect(picked.agree === true && same(picked.total, first), what + ': the api pick disagrees: ' + JSON.stringify({ total: picked.total, source: picked.source, agree: picked.agree, differs: picked.differs }));
  Object.entries(copy.currencies).filter(([, v]) => v).forEach(([name, v]) => expect(v === currency, what + ': currency_code ' + name + ' is ' + v + ', the shop trades in ' + currency));
  expect(copy.currencies.money === currency && copy.currencies.detail === currency, what + ': the money block and the detail must both name ' + currency + ': ' + JSON.stringify(copy.currencies));
  return first;
}

/** a rail chit holds the total twice (sender, receiver): both copies equal each other, and each list row says the detail's figure */
async function assertBothCopies(sender, receiver, chitId, currency, what) {
  const mine = await copiesOf(sender, chitId), theirs = await copiesOf(receiver, chitId);
  const total = assertOneFigure(mine, currency, what + ' sender copy');
  expect(same(assertOneFigure(theirs, currency, what + ' receiver copy'), total), what + ': the receiver holds ' + JSON.stringify(theirs.figures) + ', the sender ' + JSON.stringify(mine.figures));
  for (const [name, shop] of [['sender', sender], ['receiver', receiver]]) {
    const row = await listFigureOf(shop, chitId);
    expect(same(row.total_value, total) && same(row.money_total, total), what + ': the ' + name + "'s " + row.where + ' row says ' + row.total_value + ' / ' + row.money_total + ', the detail ' + total);
  }
  return total;
}

/** the expected-null kinds: no total on any copy, null and never 0, no money block, the pick says there is none */
async function assertNoTotal(shop, chitId, what) {
  const copy = await copiesOf(shop, chitId);
  /* the chit_detail column has no null today (it reads 0.00 where no copy says): the header copies are the rule, the column is recorded as 0 */
  Object.entries(copy.figures).filter(([name]) => name !== 'detail').forEach(([name, v]) => expect(v === null || v === undefined, what + ': ' + name + ' is ' + v + ', by decision it carries no total (null, never 0)'));
  expect(copy.figures.detail === null || copy.figures.detail === undefined || same(copy.figures.detail, 0), what + ': the detail column says ' + copy.figures.detail + ', expected none or the column default 0.00');
  const picked = counterBill.pickOf(copy.header);
  expect(picked.source === 'none' && picked.total === null, what + ': pickOf says ' + picked.source + ' ' + picked.total);
}

/** the lines of an app document carry the registered seller's rate (the partner helpers drop it); an unregistered AU / AE shop sends none */
const rated = (body, rate) => { if (rate) body.line_items.forEach((l) => { l.gst_rate = rate; }); return body; };
const piece = (name) => ({ id: undefined, name, unit: 'piece', price: 1000 });

(async () => {
  console.log('\n── ACC-206 G3 lifecycle equality rows on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');

  for (const c of COUNTRIES) {
    const A = await freshShop(RUN + c.id.toLowerCase() + 'a', 'Life ' + c.id + ' A', c.setup);
    const B = await freshShop(RUN + c.id.toLowerCase() + 'b', 'Life ' + c.id + ' B', c.partner || c.setup);
    const P = piece('Item ' + RUN + c.id);
    const rows = [[P, 2]], rate = c.setup.tax.registered ? c.rate : null;
    /* a counter bill carries the till's invoice exactly as the till sends it: 2 × 1000 + the country's rate, the round-off the till declared (AU: a 5c cash step) */
    const counterOf = { IN: { AssVal: 2000, CgstVal: 180, SgstVal: 180, IgstVal: 0, RndOffAmt: 0, TotInvVal: 2360 }, AU: { AssVal: 2000, CgstVal: 0, SgstVal: 0, IgstVal: 0, RndOffAmt: 0.05, TotInvVal: 2000.05 }, AE: { AssVal: 2000, CgstVal: 0, SgstVal: 0, IgstVal: 0, RndOffAmt: 0, TotInvVal: 2000 } }[c.id];
    /* the counter's parts: AU's 5c cash step is the tender's rule, so the 5c-declared total is paid by card */
    const counter = (extra) => Object.assign({ invoice: { ValDtls: counterOf } }, c.id === 'AU' ? { parts: [{ how: 'card', amount: counterOf.TotInvVal }] } : {}, extra);
    const NO = (kind) => RUN + c.id + '-' + kind;
    let c5id = null; /* AI-F-02 (1129): a rail credit note names one of the sender's own bills; C8 takes back C5 */

    await kase(c.id + '-C1', 'C1 counter cash bill: invoice, money, total_value and the detail column are one figure (no list holds a walk-in bill)', async () => {
      const r = ok(await send(A, bill(NO('c1'), rows, counter())), 'send C1');
      const id = chitIdOf(r);
      assertOneFigure(await copiesOf(A, id), c.currency, c.id + ' C1');
      /* a walk-in cash bill sits in no list (not sent, not inbox, not a Bills folder: seen in CI run on c5d87f29), so there is no list row to compare; its readers are the till's day close and the books */
    });
    await kase(c.id + '-C2', 'C2 counter bill to a named customer: the same one figure', async () => {
      const r = ok(await send(A, bill(NO('c2'), rows, counter({ customer: { name: 'Named buyer ' + RUN } }))), 'send C2');
      assertOneFigure(await copiesOf(A, chitIdOf(r)), c.currency, c.id + ' C2');
    });
    await kase(c.id + '-C5', 'C5/C6 app invoice A to B (the engine bills it at send): both copies, both lists, one figure', async () => {
      const r = ok(await send(A, rated(invoice(NO('c5'), rows, { to: B.bridge }), rate)), 'send C5');
      c5id = chitIdOf(r);
      await assertBothCopies(A, B, c5id, c.currency, c.id + ' C5');
    });
    await kase(c.id + '-C7', 'C7 order A to B: both copies, both lists, one figure', async () => {
      const r = ok(await send(A, rated(order(NO('c7'), rows, { to: B.bridge }), rate)), 'send C7');
      await assertBothCopies(A, B, chitIdOf(r), c.currency, c.id + ' C7');
    });
    await kase(c.id + '-C8', 'C8 credit note A to B: both copies, both lists, one figure', async () => {
      const body = rated(invoice(NO('c8'), rows, { to: B.bridge }), rate);
      Object.assign(body, { purpose: 'credit_note', subject: 'Credit note ' + NO('c8'), manual_subject: 'Credit note ' + NO('c8') });
      body.business_json = Object.assign({}, body.business_json, { against: { chit_id: c5id }, reason_words: 'goods returned' }); /* the UAE pack asks why a credit note is issued */
      const r = ok(await send(A, body), 'send C8');
      await assertBothCopies(A, B, chitIdOf(r), c.currency, c.id + ' C8');
    });
    await kase(c.id + '-N1', 'expected null: an inquiry with priced lines is not a billing document — no total on either copy, null and never 0', async () => {
      const body = rated(invoice(NO('n1'), rows, { to: B.bridge }), rate);
      Object.assign(body, { purpose: 'inquiry', subject: 'Inquiry ' + NO('n1'), manual_subject: 'Inquiry ' + NO('n1') });
      const id = chitIdOf(ok(await send(A, body), 'send N1'));
      await assertNoTotal(A, id, c.id + ' N1 sender');
      await assertNoTotal(B, id, c.id + ' N1 receiver');
    });
    if (c.id === 'IN') {
      await kase('IN-N2', 'expected null: an invoice to two recipients has no single buyer to bill — no total, null and never 0', async () => {
        const C3 = await freshShop(RUN + 'ina3', 'Life IN C', { tax: { registered: false } });
        const body = rated(invoice(NO('n2'), rows, { to: B.bridge }), rate);
        body.recipients = body.recipients.concat([{ bridge_id: C3.bridge, display_name: C3.name, kind: 'to' }]);
        await assertNoTotal(A, chitIdOf(ok(await send(A, body), 'send N2')), 'IN N2');
      });
    }
  }

  await kase('N3', 'expected null: the TR-6 operator copy (oversight) is withheld — no figure on the stored shape, and never a mismatch (the network tree itself is not driven here)', async () => {
    const copy = { summary_json: { oversight: true, total_value: 189, money: { total: 189 } }, business_json: null };
    const picked = counterBill.pickOf(copy);
    expect(picked.source === 'withheld' && picked.total === null && picked.agree === true, 'withheld expected, got ' + JSON.stringify({ total: picked.total, source: picked.source, agree: picked.agree }));
  });
  await kase('L1', 'a pre-2-Nov chit (total_value = the route\'s net beside money.total, no stamps) is legacy_net: the engine figure stands, equality across copies is NOT asserted', async () => {
    const picked = counterBill.pickOf({ summary_json: { total_value: 180, money: { total: 189 } }, business_json: null });
    expect(picked.legacy_net === true && picked.agree === true && picked.total === 189, 'legacy_net expected, got ' + JSON.stringify({ total: picked.total, agree: picked.agree, legacy_net: picked.legacy_net }));
  });
  skip('C12', 'C12 repeat supply total', 'the harness has no repeat-agreement driver; the cell stays open');
  skip('C18', 'C18 CTP chit total', 'needs a second installation; the cell stays open');
  skip('C13', 'C13 storefront order total', 'CAT-243: the total is summed in the catalogue route and never reaches the engine, an equality row there is vacuous; the cell stays open');
  skip('CUR3', 'one 3-decimal currency case', 'no country pack sells in a 3-decimal currency yet');
  finish('acc-206-lifecycle');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
