'use strict';
/**
 * tests/acc35x-doors.realstack.cjs — ACC-355 / 356 / 357 on REAL Postgres, the api running as cb_app, RLS on (the proof the in-memory r101 / r103 tests could not give).
 * Scenario ids R101-AU (web docs/16-finance/fable-risk1-scenarios.json), R102-AU, R103 Q4, and Q3 (the adviser's list). The shop's OWN day is read with Intl, never the UTC date.
 * Hand figures (AU, minor units): expense 165.00 with 15.00 GST inside = Dr electricity 15000 + Dr gst_paid 1500 + Cr bank 16500 when the shop CLAIMS; Dr electricity 16500, no gst_paid when it cannot.
 *   a sale 110.00 incl 10.00 GST = Cr sales 10000 + Cr gst_collected 1000; GST-free 44.00 = Cr sales_gst_free 4400; input-taxed 400.00 = Cr sales_input_taxed 40000 (the sale's own ledgers, engines v1.99.0).
 *   BAS after the two credit notes of the GST-free and the input-taxed sale: G3 0, G4 0, 1A 1000 (the credit note follows the sale's box, ACC-356).
 *   BU-1 unregistered buyer: the expense posts with NO gst_paid, Dr electricity 16500 · BU-2 unknown buyer: the expense WAITS (nothing posted); the answer 'yes' posts it with gst_paid 1500
 *   BU-3 registered buyer (control): the credit is claimed · BU-4 Q3: the adviser list names the entry the unknown shop's answer came too late for, read-only
 *   CN-1 AU credit notes of a GST-free and an input-taxed sale: the BAS reads G3 0, G4 0, 1A 1000, and the credit notes sit on sales_gst_free / sales_input_taxed
 *   LV-1 debit note guard: Reverse on a debit note's entry is refused with the document's sentence · LV-2 credit note guard · LV-3 day entry guard (when the day entry can be driven by a route)
 * Run: node tests/acc35x-doors.realstack.cjs   (API_BASE / TRUTH_DB as tests/lib/truth-harness.cjs says; LOCAL OR A NAMED SIT BOX ONLY)   CARD 14-accounting (R1-01/02/03)
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, pause, kase, expect, skip, freshShop, finish } = H;
const crypto = require('crypto');
const tax = require('../lib/tax');
const { Pool } = require('pg');
const RUN = 'a35' + (Date.now() % 1e9).toString(36);
const ABN = '51824753556', ZONE = 'Australia/Sydney';
/** the shop's own day (this shop is AU, Sydney), never the UTC day */
const shopToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date());
const OTHER = 'This entry belongs to a document that is still live. Cancel that document instead of reversing the entry.';
const BUYER = 'This entry is a bill from your supplier that is still live. Ask the supplier for a credit note, or reject the bill.';
const send = (shop, body) => j('/api/chits/send', { method: 'POST', token: shop.token, body });
const idOf = (r) => r.b.chit_id || (r.b.chit && r.b.chit.chit_id);
const minor = (v) => Math.round(Number(v) * 100);
const db = new Pool({ connectionString: H.DB });
/** what the books hold by ledger ROLE for this shop (the owner connection, SELECT only): { role: dr - cr } in minor units */
async function byRole(shop) {
  await pause(3500);
  const r = await db.query(`SELECT a.role, SUM(l.dr_minor - l.cr_minor)::bigint AS net FROM journal_line l JOIN ledger_account a ON a.account_id = l.account_id AND a.entity_id = l.entity_id
    WHERE l.entity_id = $1 AND NOT EXISTS (SELECT 1 FROM journal_entry x WHERE x.entity_id = l.entity_id AND x.reverses_entry_id = l.entry_id) GROUP BY a.role`, [shop.entity]);
  const out = {}; r.rows.forEach((row) => { if (Number(row.net)) out[row.role] = Number(row.net); }); return out;
}
const invoiceOf = (who, rows, buyer) => tax.determine({
  seller: { Gstin: who.number || '', LglNm: who.name, TrdNm: who.name, State: '', Country: 'AU', RegType: who.number ? 'regular' : 'unregistered' },
  buyer: { LglNm: (buyer && buyer.name) || 'Walk-in', Gstin: '', State: '', RegType: 'unregistered', Country: 'AU', Pos: '' },
  lines: rows.map(([p, qty], i) => Object.assign({ id: String(i + 1), name: p.name, unit: 'piece', hsn: '', qty, unit_price: p.price, discount: 0, gst_rate: p.kind ? 0 : 10, cess_rate: 0 }, p.kind ? { supply_kind: p.kind } : {})),
  priceIncludesTax: true });
const totalOf = (inv) => minor(inv.ValDtls.TotInvVal);
const dayBook = async (shop) => ok(await j('/api/books/daybook?from=' + shopToday() + '&to=' + shopToday(), { token: shop.token }), 'day book').b.entries || [];
const entryOf = async (shop, chitId) => (await dayBook(shop)).find((e) => String(e.source_chit_id) === String(chitId) && e.event_type !== 'reversal' && !e.reverses_entry_id);
const reverse = (shop, entryId) => j('/api/books/entries/' + entryId + '/reverse', { method: 'POST', token: shop.token, body: { reason: 'owner pressed Reverse' } });
const expenseBody = (no) => ({ recipients: [{ self: true, name: 'self' }], purpose: 'expense', subject: 'Expense ' + no, manual_subject: 'Expense ' + no, client_ref: no,
  business_json: { bill_no: no, billed_at: new Date().toISOString(), expense: { what: 'Electricity, tax invoice 165.00 incl GST 15.00', mode: 'Bank', amount: 165, class: 'electricity', input_tax: { gst: 15 } } } });
const aShop = (tag, label, registered, number) => freshShop(tag, label, { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: ZONE, tax: registered ? { registered: true, number, scheme: 'regular' } : registered === false ? { registered: false } : undefined });

(async () => {
  console.log('\n── ACC-355/356/357 on real Postgres · run ' + RUN + ' · shop day ' + shopToday() + ' ──');
  ok(await j('/health'), 'health');
  const U = await aShop(RUN + 'u', 'Buyer unregistered', false), K = await aShop(RUN + 'k', 'Buyer unknown'), R = await aShop(RUN + 'r', 'Buyer registered', true, ABN);
  for (const s of [U, K, R]) ok(await j('/api/books/enable', { method: 'POST', token: s.token, body: { walkin_grain: 'bill' } }), 'books on');

  await kase('BU-1', 'R101-AU unregistered buyer: the expense posts with NO gst_paid, the whole 165.00 is the cost (hand: electricity +16500, bank -16500)', async () => {
    ok(await send(U, expenseBody('U/' + RUN)), 'expense');
    const roles = await byRole(U);
    expect(!roles.gst_paid && Object.values(roles).includes(16500), 'books by role ' + JSON.stringify(roles));
  });
  let waitingId;
  await kase('BU-2', 'R101-AU unknown buyer: the expense WAITS with the question, nothing posted; after "yes" it posts with gst_paid 1500', async () => {
    const r = ok(await send(K, expenseBody('K/' + RUN)), 'expense');
    const before = await byRole(K);
    expect(Object.keys(before).length === 0, 'the books moved while the answer was unknown: ' + JSON.stringify(before));
    const w = ok(await j('/api/books/health', { token: K.token }), 'health').b;
    const rows = w.waiting || [];
    expect(rows.length === 1 && /registered for GST/.test(JSON.stringify(rows[0])), 'the Waiting list does not carry the question: ' + JSON.stringify(rows).slice(0, 500));
    waitingId = idOf(r);
    ok(await j('/api/governance/country-setup', { method: 'PUT', token: K.token, body: { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: ZONE, tax: { registered: true, number: ABN, scheme: 'regular' } } }), 'answer yes');
    await pause(1500);
    ok(await j('/api/books/check', { method: 'POST', token: K.token, body: {} }), 'check');
    const after = await byRole(K);
    expect(after.gst_paid === 1500, 'after the answer the books are ' + JSON.stringify(after) + ' (rows ' + rows.length + ')');
  });
  await kase('BU-3', 'R101-AU registered buyer (control): the credit is claimed (hand: gst_paid +1500, electricity +15000)', async () => {
    ok(await send(R, expenseBody('R/' + RUN)), 'expense');
    const roles = await byRole(R);
    expect(roles.gst_paid === 1500, 'books by role ' + JSON.stringify(roles));
  });

  /* ── R102-AU: the credit note follows the sale's own ledger and BAS box ── */
  const S = R, who = { number: ABN, name: R.name };
  const sale = async (id, price, kind) => {
    const rows = [[{ name: id + ' item', price, kind }, 1]], inv = invoiceOf(who, rows), no = id + '/' + RUN, t = totalOf(inv);
    const body = { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
      business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no, billed_at: new Date().toISOString(), payment: { mode: 'cash', paid: t / 100, change: 0, parts: [{ how: 'cash', amount: t / 100 }] }, slip: 'cash', invoice: inv },
      line_items: rows.map(([p, n]) => ({ particulars: p.name, quantity: n, unit: 'piece', price: p.price, total: n * p.price, gst_rate: kind ? 0 : 10 })) };
    return { chit: idOf(ok(await send(S, body), 'sale ' + id)), no, price, kind, total: t };
  };
  const credit = async (id, of) => {
    const rows = [[{ name: of.no + ' returned', price: of.price, kind: of.kind }, 1]], inv = invoiceOf(who, rows), no = id + '/' + RUN, t = totalOf(inv);
    const body = { recipients: [{ self: true, name: 'self' }], purpose: 'credit_note', subject: 'Credit note ' + no, manual_subject: 'Credit note ' + no, client_ref: no,
      business_json: { doc: 'credit_note', slip: 'credit_note', customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no, billed_at: new Date().toISOString(), against: { bill_no: of.no, chit_id: of.chit }, reason: 'goods returned',
        refund: { parts: [{ how: 'cash', amount: t / 100 }], total: t / 100 }, payment: { mode: 'cash', paid: t / 100, change: 0, parts: [{ how: 'cash', amount: t / 100 }] }, invoice: inv },
      line_items: rows.map(([p, n]) => ({ particulars: p.name, quantity: n, unit: 'piece', price: p.price, total: n * p.price, gst_rate: of.kind ? 0 : 10 })) };
    return { chit: idOf(ok(await send(S, body), 'credit note ' + id)), no };
  };
  const boxOf = (ret, code) => {
    const b = ret.boxes; const list = Array.isArray(b) ? b : Object.keys(b || {}).map((k) => Object.assign({ code: k }, typeof b[k] === 'object' ? b[k] : { amount_minor: b[k] }));
    const hit = list.find((x) => String(x.code || x.box || x.label).toUpperCase() === code);
    return hit ? Number(hit.amount_minor !== undefined ? hit.amount_minor : hit.minor !== undefined ? hit.minor : hit.value) : undefined;
  };
  const bas = async () => { await pause(2500); return ok(await j('/api/books/returns?period=' + RUN_PERIOD + '&simpler=0', { token: S.token }), 'BAS').b; };
  const RUN_PERIOD = (() => { const [y, m] = shopToday().split('-').map(Number), fy = m >= 7 ? y : y - 1; return (fy) + '-Q' + (m >= 7 && m <= 9 ? 1 : m >= 10 ? 2 : m <= 3 ? 3 : 4); })();
  let s2, s3, before;
  await kase('CN-0', 'R102-AU before: a GST-free 44.00 and an input-taxed 400.00 sale beside a standard 110.00 (hand: G3 4400, G4 40000, 1A 1000)', async () => {
    await sale('S1', 110, null); s2 = await sale('S2', 44, 'gst_free'); s3 = await sale('S3', 400, 'input_taxed');
    before = await bas();
    expect(boxOf(before, 'G3') === 4400 && boxOf(before, 'G4') === 40000 && boxOf(before, '1A') === 1000, 'G3 ' + boxOf(before, 'G3') + ' G4 ' + boxOf(before, 'G4') + ' 1A ' + boxOf(before, '1A') + ' · ' + JSON.stringify(before.boxes).slice(0, 600));
  });
  await kase('CN-1', 'R102-AU the two credit notes follow their sales: G3 0, G4 0, 1A 1000, nothing left on sales_returns (hand)', async () => {
    await credit('CN2', s2); await credit('CN3', s3);
    const after = await bas(), roles = await byRole(S);
    expect(boxOf(after, 'G3') === 0 && boxOf(after, 'G4') === 0 && boxOf(after, '1A') === 1000, 'G3 ' + boxOf(after, 'G3') + ' G4 ' + boxOf(after, 'G4') + ' 1A ' + boxOf(after, '1A') + ' · ' + JSON.stringify(after.boxes).slice(0, 600));
    expect(!roles.sales_returns && !roles.sales_gst_free && !roles.sales_input_taxed, 'a credit note landed off its sale ledger: ' + JSON.stringify(roles));
  });

  /* ── R1-03 Q4: the guard by kind (the credit note's own case is r103 RV-5) ── */
  await kase('LV-1', 'Q4 credit note guard: a credit note entry says may_reverse false with the document sentence, Reverse is 409 ENTRY_OF_LIVE_BILL', async () => {
    const sold = await sale('S9', 55, null), cn = await credit('CN9', sold);
    await pause(3000);
    const e = await entryOf(S, cn.chit);
    expect(e && e.may_reverse === false && e.why && e.why.code === 'ENTRY_OF_LIVE_BILL' && e.why.words === OTHER, 'the credit note entry says ' + JSON.stringify(e && [e.event_type, e.may_reverse, e.why]));
    const r = await reverse(S, e.entry_id);
    expect(r.status === 409 && r.b.code === 'ENTRY_OF_LIVE_BILL', 'expected 409, got ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
  });
  await kase('LV-2', 'Q4 expense guard: the buyer\'s expense entry is a live document too, worded as one (not the sold-bill sentence)', async () => {
    const x2 = idOf(ok(await send(R, expenseBody('R2/' + RUN)), 'expense'));
    await pause(3500);
    const e = await entryOf(R, x2);
    expect(e && e.may_reverse === false && e.why && e.why.words === OTHER, 'the expense entry says ' + JSON.stringify(e && [e.event_type, e.may_reverse, e.why]));
    const r = await reverse(R, e.entry_id);
    expect(r.status === 409 && r.b.code === 'ENTRY_OF_LIVE_BILL', 'expected 409, got ' + r.status);
  });
  skip('LV-3', 'Q4 debit note guard on a seller debit note entry', 'a debit note is issued only on the payer accepting a price proposal (409 DEBIT_NOTE_NEEDS_ACCEPT by hand): a two-shop rail flow, not driven here; the kind rides the same LIVE_TYPES query as the credit note (LV-1) and the unit test r103-reverse-live-bill.test.cjs');
  await kase('LV-4', 'Q4 day entry guard: a walk-in DAY entry (counter sales of a whole day) is live while any bill it covers is: Reverse 409 with the day sentence', async () => {
    const D = await aShop(RUN + 'd', 'Day grain', true, ABN);
    ok(await j('/api/books/enable', { method: 'POST', token: D.token, body: { walkin_grain: 'day' } }), 'books on (day grain)');
    const rows = [[{ name: 'day item', price: 33 }, 1]], inv = invoiceOf({ number: ABN, name: D.name }, rows), no = 'D1/' + RUN, t = totalOf(inv);
    const body = { recipients: [{ self: true, name: 'self' }], purpose: 'order', subject: 'Counter sale ' + no, manual_subject: 'Counter sale ' + no, client_ref: no,
      business_json: { customer: { name: 'Walk-in' }, till: { id: 'C1', name: 'Counter 1', host: 'browser' }, bill_no: no, billed_at: new Date().toISOString(), payment: { mode: 'cash', paid: t / 100, change: 0, parts: [{ how: 'cash', amount: t / 100 }] }, slip: 'cash', invoice: inv },
      line_items: rows.map(([p, n]) => ({ particulars: p.name, quantity: n, unit: 'piece', price: p.price, total: n * p.price, gst_rate: 10 })) };
    ok(await send(D, body), 'walk-in sale');
    await pause(3000);
    /* the nightly check posts only CLOSED days after the books began; no route closes today, so the day close is run in-process on the same database, as the nightly does (lib/books-hooks.postDay, the shop's own day) */
    const setting = await require('../db').withEntity(D.entity, (h) => require('../lib/books').settingOf(h, D.entity));
    const closed = await require('../lib/books-hooks').postDay(D.entity, 'C1', shopToday(), { setting });
    await pause(1500);
    const book = await dayBook(D);
    let e = book.find((x) => x.event_type === 'walkin_day');
    if (!e) { throw new Error('no walkin_day entry after postDay (' + JSON.stringify(closed).slice(0, 200) + '): ' + JSON.stringify(book.map((x) => x.event_type))); }
    expect(e.may_reverse === false && e.why && e.why.code === 'ENTRY_OF_LIVE_BILL', 'the day entry says ' + JSON.stringify([e.may_reverse, e.why]));
    const r = await reverse(D, e.entry_id);
    expect(r.status === 409 && r.b.code === 'ENTRY_OF_LIVE_BILL', 'expected 409, got ' + r.status);
  });

  const Q3 = require('fs').existsSync(require('path').join(__dirname, '..', 'lib', 'books-input-tax-unanswered.js'));
  await kase('Q3-1', 'Q3 adviser list: the input tax posted before the answer came is listed (date, entry, amount, party), read-only; a registered-then-asked shop with no early claim lists none', async () => {
    const r = await j('/api/books/input-tax-unanswered', { token: K.token });
    expect(r.status === 200 && Array.isArray(r.b.rows) && typeof r.b.total === 'number' && r.b.page >= 1 && r.b.limit >= 1, 'GET /input-tax-unanswered answered ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
    expect(r.b.currency === 'AUD', 'the answer does not carry the currency: ' + JSON.stringify(r.b).slice(0, 200));
    const post = await j('/api/books/input-tax-unanswered', { method: 'POST', token: K.token, body: {} });
    expect(post.status === 404 || post.status === 405, 'a write verb answered ' + post.status);
  });
  await kase('Q3-2', 'Q3 a shop that claimed GST and then answered "not registered": its early claim is listed (hand: one entry, 1500 AUD); a registered shop lists none', async () => {
    const T = await aShop(RUN + 't', 'Claimed then not registered', true, ABN);
    ok(await j('/api/books/enable', { method: 'POST', token: T.token, body: { walkin_grain: 'bill' } }), 'books on');
    const chit = idOf(ok(await send(T, expenseBody('T/' + RUN)), 'expense'));
    await pause(3500);
    const posted = await entryOf(T, chit);
    expect(posted && posted.entry_no, 'the claimed expense did not post');
    const none = ok(await j('/api/books/input-tax-unanswered', { token: T.token }), 'list while registered').b;
    expect(none.total === 0 && none.rows.length === 0, 'a registered shop lists ' + JSON.stringify(none).slice(0, 300));
    ok(await j('/api/governance/country-setup', { method: 'PUT', token: T.token, body: { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: ZONE, tax: { registered: false }, confirm_deregister: true } }), 'answer: not registered');
    let list;
    for (let i = 0; i < 20; i++) { await pause(3000); list = ok(await j('/api/books/input-tax-unanswered', { token: T.token }), 'list after the answer').b; if (list.total) break; } /* the registration read is cached for a minute at most */
    expect(list.total === 1 && list.rows.length === 1 && list.rows[0].amount_minor === 1500 && list.rows[0].currency === 'AUD' && list.rows[0].entry_no === posted.entry_no && list.rows[0].posting_date === shopToday(),
      'the early claim is not listed as hand figures say: ' + JSON.stringify(list).slice(0, 500));
    expect(list.registration === 'unregistered' && list.page === 1 && list.limit >= 1, 'registration ' + list.registration);
    const before = await byRole(T);
    expect(before.gst_paid === 1500, 'the list changed the books: ' + JSON.stringify(before));
  });
  void Q3; void skip; void crypto; void waitingId;
  await db.end();
  finish('acc35x');
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
