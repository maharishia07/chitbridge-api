#!/usr/bin/env node
/**
 * e2e/walk-bank-rec.cjs — BANK RECONCILIATION THROUGH THE RAIL, WALKED (round BR1: accounts.html#bank · app/cap-bank.js · app/cap-bank-rows.js (the lines and their actions) · engines bank-recon v1.44.1).
 * A fixture HDFC-shaped statement is read IN THE BROWSER and put against THREE things: the line ↔ the other party's payment chit (M30 advice, from
 * GET /api/books/bank/rail) ↔ the ledger entry. The API is a stand-in answering inside the page; every /api/books answer is held to the API contract.
 *
 *   B1  states: Settled by chit (Ravi's advice + my books) · Party told us ×2 (Kumar's advice by ref; one cash deposit = two customers' advices) ·
 *       Matched (my own cheque, no chit) · Suggested (a bank charge) · Needs you (nobody told us) — and "2 lines need you"
 *   B2  the statement never leaves: the only new request is GET /bank/rail with the two dates; no request carries a narration or the file
 *   B3  a settled line opens to who told us, the bills the chit settles and the chit itself (one popup); a note, then ✓ Accept (the note does not block),
 *       then ↶ Undo — the note is still there
 *   B4  Record from the chit: the pay sheet opens with their amount, How = bank, their reference, and THEIR bill ticked (the other bill 0); Record posts
 *       ONE payment through POST /payments with that allocation
 *   B5  ✉ Ask the party: the question names the date, the amount and the ref — POST /api/chits/send carries business_json.kind 'bank_query' and NO narration;
 *       the line turns Asked, the count drops to 1
 *   B6  their answer (their payment advice carrying our ref) settles the line: Party told us, the bill on their chit; a new line from the same payer with
 *       no chit is SUGGESTED by the rule learned in B4, shown with its source; Forget this rule → Needs you again
 *   B7  a view-only login: Ask and Record are SHOWN, greyed with the server's sentence
 *   B8  Accounts Home: the bank row counts the lines that need you, in the Home's own to-do row
 *   B9  rule 13 — light AND dark at 1366 and 390: AA contrast of every text, no inner sideways scroll, no clipped text, no floating control over the
 *       list, no link to app.html, the copy within the budget
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-bank-rec.cjs
 * Screenshots: e2e/shots/walk-bank-rec-*.png
 */
'use strict';
const TD = require('./lib/today.cjs');
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs'), { measure } = require('./lib/theme-measure.cjs');
const J = C.json;
let pass = 0, fail = 0;
const ok = (id, c, m) => { if (c) { pass++; console.log(id + ' · PASS · ' + m); } else { fail++; console.log(id + ' · FAIL · ' + m); } };
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(TD.nowMs() / 1000) + 3600 }, c)) + '.x'; };
const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan', entityId: 'ent-M' };
const VIEWER = { token: tok({ identity_id: 'act-9', identity_type: 'actor', parent_entity_id: 'ent-M', parent_entity_name: 'Mayur Bhavan', display_name: 'Auditor', access_level: 'viewer' }), role: 'actor', name: 'Auditor', entity: 'Mayur Bhavan', entityId: 'ent-M' };
const READ_ONLY = 'Your access is view-only. You can read this chit but not change it.';   /* the rail's own sentence (api lib/rail say('read_only')) */

/* the statement — six lines; the narrations are SECRETS: none may ever leave the page */
const HEAD = ['Account No: 50100123456789', 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance'];
const LINES = [
  '01/09/26,UPI-RAVI STORES-ravi@okbank-UTR778899001,UTR778899001,01/09/26,,12000.00,112000.00',
  '03/09/26,NEFT-KUMAR AND SONS,N55501,03/09/26,,4200.00,116200.00',
  '05/09/26,BY CASH DEPOSIT BRANCH,,05/09/26,,7000.00,123200.00',
  '07/09/26,CHQ PAID-0001234-KV TRADERS,0001234,07/09/26,5000.00,,118200.00',
  '10/09/26,SMS ALERT CHARGES,,10/09/26,23.60,,118176.40',
  '25/09/26,NEFT-UNKNOWN TRADERS XYZQ,N99912,25/09/26,,4200.00,122376.40',
];
const CSV = HEAD.concat(LINES).join('\n');
const CSV2 = HEAD.concat(LINES, ['28/09/26,NEFT-KUMAR AND SONS-HDFC,N77788,28/09/26,,1500.00,123876.40']).join('\n');
const SECRETS = ['ravi@okbank', 'KUMAR AND SONS', 'CASH DEPOSIT BRANCH', 'KV TRADERS', 'SMS ALERT', 'UNKNOWN TRADERS', 'XYZQ', 'statement.csv', '50100123456789', '122376.40'];

const P = { ravi: { id: 'p-ravi', name: 'Ravi Stores' }, kumar: { id: 'p-kumar', name: 'Kumar & Sons' }, anand: { id: 'p-anand', name: 'Anand Mart' }, bala: { id: 'p-bala', name: 'Bala Foods' }, unk: { id: 'p-unk', name: 'Unknown Traders' } };
const advice = (id, party, minor, ref, day, bills) => ({ chit_id: id, direction: 'received', status: 'delivered', created_at: day + 'T06:00:00.000Z', party,
  business_json: { kind: 'payment_advice', currency: 'INR', payment_advice: { action: 'paid', adviser_payment_id: 'theirs-' + id, adviser_entry_no: 'THEIRS/' + id, amount: minor / 100, amount_minor: minor, currency: 'INR', mode: 'bank',
    reference: ref, paid_on: day, applied_minor: minor, on_account: 0, on_account_minor: 0, collected_by: null, reverses_advice_chit_id: null, words: party.name + ' paid you ₹' + (minor / 100).toLocaleString('en-IN') + ' by bank.' } },
  line_items: bills.map((b) => ({ ref_chit_id: 'bill-' + b[0], bill_no: b[0], applied_minor: b[1] })) });

const EVENTS = { events: [{ kind: 'expense', words: 'Pay expense', icon: 'receipt', band: 'paid', preview: true, fields: [{ key: 'class', kind: 'pick', pick: 'expense_class', required: true }, { key: 'amount', kind: 'amount' }, { key: 'paid_from', kind: 'pick', pick: 'mode' }, { key: 'date', kind: 'date' }, { key: 'narration', kind: 'text' }] }],
  picks: { mode: ['cash', 'bank', 'upi', 'card'], expense_class: [{ role: 'bank_charges', code: '6090', name: 'Bank charges' }] } };
const ACCOUNTS = [{ code: 'G-BANK', name: 'Bank accounts', is_group: true, role: null, parent_code: null }, { code: '1500', name: 'Bank', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }, { code: '1501', name: 'Bank two', is_group: false, role: 'bank', parent_code: 'G-BANK', active: true }];

function stand() {
  const S = { reqs: [], bodies: [], opened: [], who: 'owner' };
  S.lines = [
    { date: '2026-09-01', what: 'Receipt: Ravi Stores', ref: 'MJ/26-27/0001', source: { how_ref: 'UTR778899001' }, dr_minor: 1200000, cr_minor: 0 },
    { date: '2026-09-07', what: 'Payment: KV Traders', ref: 'MJ/26-27/0002', source: { how_ref: '0001234' }, dr_minor: 0, cr_minor: 500000 }];
  S.chits = [advice('c-ravi', P.ravi, 1200000, 'UTR778899001', '2026-08-31', [['B-101', 800000], ['B-102', 400000]]), advice('c-kumar', P.kumar, 420000, 'N55501', '2026-09-03', [['B-140', 420000]]),
    advice('c-anand', P.anand, 300000, 'DEP-A', '2026-09-05', [['B-150', 300000]]), advice('c-bala', P.bala, 400000, 'DEP-B', '2026-09-05', [['B-151', 400000]])];
  S.bills = { 'p-kumar': [{ against_ref: 'bill-B-139', bill_no: 'B-139', due_date: '2026-08-01', open_minor: 250000, disputed: false }, { against_ref: 'bill-B-140', bill_no: 'B-140', due_date: '2026-08-20', open_minor: 420000, disputed: false }] };
  return S;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [];

  async function open(S, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: o.vp || { width: 1366, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    if (TD.injected) await ctx.clock.setFixedTime(TD.now());   /* QW1-TODAY: the token's exp is CB_TODAY-based */
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    ctx.on('request', (rq) => { S.reqs.push({ m: rq.method(), u: rq.url(), h: JSON.stringify(rq.headers()), d: rq.postData() || '' }); });
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
      let body = null; try { body = r.request().postDataJSON(); } catch (_) {} if (m !== 'GET') S.bodies.push({ m, p, body });
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR', ledger_on: true } });
      if (p === '/api/books/health') return J(r, 200, books.health());
      if (p === '/api/books/todo') return J(r, 200, []);
      if (p === '/api/books/periods') return J(r, 200, books.periods([]));
      if (p === '/api/books/accounts') return J(r, 200, { accounts: ACCOUNTS.map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', active: true }, a)) });
      if (p === '/api/books/events' && m === 'GET') return J(r, 200, books.eventsAnswer(EVENTS));
      if (p === '/api/books/ledger/1500') { const op = 10000000; return J(r, 200, books.ledger('1500', 'Bank', S.lines, { from: u.searchParams.get('from'), to: u.searchParams.get('to'), opening_minor: op, closing_minor: op + S.lines.reduce((t, l) => t + l.dr_minor - l.cr_minor, 0) })); }
      if (p === '/api/books/bank/rail') return J(r, 200, { currency: 'INR', from: u.searchParams.get('from'), to: u.searchParams.get('to'), me: 'Mayur Bhavan', books: { parties: [], open_items: [] }, rail_chits: S.chits,
        parties: [P.ravi, P.kumar, P.unk].map((x) => ({ party_id: x.id, name: x.name })), may: { ask: S.who === 'viewer' ? { ok: false, why: 'read_only', say: READ_ONLY } : { ok: true } } });
      if (p === '/api/books/payments/preview') return J(r, 200, books.payPreview(S.bills[body.party_id] || [], body, 'Kumar & Sons'));
      if (p === '/api/books/payments' && m === 'POST') return J(r, 200, books.payRecorded(S.bills[body.party_id] || [], body, 'Kumar & Sons', { entry_no: 'PY/2026-27/000007' }));
      if (p === '/api/chits/send' && m === 'POST') return J(r, 200, { chit_id: 'q-' + S.bodies.filter((x) => x.p === p).length, status: 'sent' });
      if (/^\/api\/chits\/[^/]+$/.test(p)) { S.opened.push(p.split('/').pop()); return J(r, 404, { error: 'Not found', message: 'stand-in' }); }
      if (p === '/api/books/dues') return J(r, 200, books.dues([]));
      return J(r, 200, {});
    });
    const seed = 'try { if (!sessionStorage.getItem("w")) { sessionStorage.setItem("w","1"); localStorage.setItem("cb_sess", ' + JSON.stringify(JSON.stringify(o.who || OWNER)) + '); '
      + (o.theme ? 'localStorage.setItem("cb_theme", ' + JSON.stringify(o.theme) + '); ' : '') + (o.keep ? '' : 'Object.keys(localStorage).filter(function (k) { return /^cb_bankrec:/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); ') + '} } catch (_) {}';
    await ctx.addInitScript({ content: seed });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => threw.push(e.message));
    await pg.goto(base + '/accounts.html#' + (o.hash || 'bank'));
    if ((o.hash || 'bank') === 'bank') await pg.waitForSelector('[data-testid="bank-file"]', { timeout: 15000 });
    return { ctx, p: pg };
  }
  const load = async (pg, csv) => { if (await pg.locator('[data-testid="bank-change"]').isVisible() && !(await pg.locator('#bk_preset').isVisible())) await pg.click('[data-testid="bank-change"]'); /* the form folds once a statement is on screen */ await pg.selectOption('#bk_preset', 'hdfc'); await pg.setInputFiles('[data-testid="bank-file"]', { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv || CSV) }); await pg.waitForSelector('[data-testid="bank-currency"], [data-testid="bank-list"].cbl [data-status]', { timeout: 10000 }); if (await pg.locator('[data-testid="bank-currency"]').count()) { await pg.fill('[data-testid="bank-currency"]', 'INR'); await pg.click('[data-testid="bank-currency-go"]'); } await pg.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 10000 }); };
  const st = (pg, s) => pg.locator('[data-testid="bank-list"] [data-status="' + s + '"]').count();
  const rowOf = (i) => '[data-testid="bank-row-s' + i + '"]';
  const openRow = async (pg, i) => { await pg.click(rowOf(i) + ' [data-caret]'); await pg.waitForSelector('[data-testid="bank-next-s' + i + '"]', { timeout: 5000 }); };
  const statusOf = (pg, i) => pg.getAttribute('[data-testid="bank-chip-s' + i + '"]', 'data-status');

  const S = stand();
  let { ctx, p } = await open(S);
  await load(p);

  if (process.env.DEBUG_BR) { console.log(JSON.stringify(await p.evaluate(() => ({ rail: BKB.rail && { n: (BKB.rail.chits || []).length, failed: BKB.rail.failed, keys: Object.keys(BKB.rail) }, ep: !!EP.booksBankRail }))), JSON.stringify(S.bodies).slice(0, 300)); }
  /* ── B1 ── */
  const c = {}; for (const k of ['settled', 'told', 'matched', 'suggested', 'bank-only']) c[k] = await st(p, k);
  ok('B1', c.settled === 1 && c.told === 2 && c.matched === 1 && c.suggested === 1 && c['bank-only'] === 1, 'settled 1 · told 2 · matched 1 · suggested 1 · needs you 1 ' + JSON.stringify(c));
  ok('B1', (await statusOf(p, 0)) === 'settled' && (await statusOf(p, 1)) === 'told' && (await statusOf(p, 2)) === 'told' && (await statusOf(p, 3)) === 'matched', 'Ravi settled · Kumar told (ref) · the cash deposit told by two advices · my cheque matched');
  ok('B1', (await p.locator('[data-testid="bank-notice"]').count()) === 0, 'one count: the head carries no second "lines need you" number (the chips and the band count them)');
  await p.screenshot({ path: path.join(SHOTS, 'walk-bank-rec-lines.png') });

  /* ── B2 ── */
  const railReq = S.reqs.filter((r) => /\/api\/books\/bank\/rail/.test(r.u));
  ok('B2', railReq.length === 1 && /\?from=2026-09-01&to=2026-09-25$/.test(railReq[0].u), 'one rail read, the statement\'s two dates only (' + (railReq[0] && railReq[0].u.split('?')[1]) + ')');
  let leaks = S.reqs.filter((r) => SECRETS.some((s) => (r.u + r.h + r.d).indexOf(s) >= 0));
  const writes = () => S.bodies.filter((x) => /^\/api\/(books|chits)\//.test(x.p));
  ok('B2', leaks.length === 0 && writes().length === 0, 'no request carries a narration or the file; nothing written yet' + (leaks.length ? ' — ' + leaks[0].u : ''));

  /* ── B3 ── */
  await openRow(p, 0);
  const n0 = await p.textContent('[data-testid="bank-next-s0"]');
  ok('B3', /Told by/.test(n0) && /Ravi Stores/.test(n0) && /B-101/.test(n0) && /B-102/.test(n0), 'the settled line says who told us and the bills their chit settles');
  await p.click('[data-testid="bank-open-chit-c-ravi"]'); await p.waitForTimeout(400);
  ok('B3', S.opened.indexOf('c-ravi') >= 0, 'Open the chit opens THEIR chit in the one popup (GET /api/chits/c-ravi)');
  await p.keyboard.press('Escape').catch(() => {}); await p.evaluate(() => { try { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); } catch (_) {} });
  if (!(await p.locator('[data-testid="bank-next-s0"]').count())) await openRow(p, 0);
  await p.click('[data-next="s0"] [data-testid="bank-note"]');
  await p.fill('[data-testid="bank-note-text"]', 'Ravi paid two bills at once');
  await p.click('[data-testid="bank-note-save"]');
  await p.waitForSelector('[data-testid="bank-notes-s0"]', { timeout: 5000 }).catch(() => {});
  if (!(await p.locator('[data-testid="bank-next-s0"]').count())) await openRow(p, 0);
  await p.click('[data-next="s0"] [data-testid="bank-accept"]');
  await p.waitForFunction(() => { const e = document.querySelector('[data-testid="bank-chip-s0"]'); return e && e.getAttribute('data-status') === 'accepted'; }, null, { timeout: 5000 }).catch(() => {});
  ok('B3', (await statusOf(p, 0)) === 'accepted', 'one tap: ✓ Accept with a note open — the note does not block it');
  if (!(await p.locator('[data-testid="bank-next-s0"]').count())) await openRow(p, 0);
  await p.click('[data-next="s0"] [data-testid="bank-undo"]');
  await p.waitForFunction(() => { const e = document.querySelector('[data-testid="bank-chip-s0"]'); return e && e.getAttribute('data-status') === 'settled'; }, null, { timeout: 5000 }).catch(() => {});
  if (!(await p.locator('[data-testid="bank-next-s0"]').count())) await openRow(p, 0);
  ok('B3', (await statusOf(p, 0)) === 'settled' && /Ravi paid two bills at once/.test(await p.textContent('[data-testid="bank-next-s0"]')), '↶ Undo takes the accept back and KEEPS the note');

  /* ── B4 ── */
  await openRow(p, 1);
  await p.click('[data-next="s1"] [data-testid="bank-record"]');
  await p.waitForSelector('[data-testid="alloc-1"]', { timeout: 8000 });
  await p.waitForTimeout(300);
  const pay = await p.evaluate(() => ({ amt: document.getElementById('pay_amt').value, mode: document.getElementById('pay_mode').value, ref: document.getElementById('pay_ref').value,
    a0: document.getElementById('alloc_0').value, a1: document.getElementById('alloc_1').value, title: document.getElementById('pay_title').textContent }));
  ok('B4', /4,200\.00|4200\.00/.test(pay.amt) && pay.mode === 'bank' && pay.ref === 'N55501' && /Kumar/.test(pay.title), 'the pay sheet opens with their amount, How = bank, their ref (' + JSON.stringify(pay) + ')');
  ok('B4', (pay.a0 === '' || /^0(\.00)?$/.test(pay.a0)) && /4,200\.00|4200\.00/.test(pay.a1), 'THEIR bill (B-140) takes the amount; the older bill B-139 stays 0 — not oldest-first');
  ok('B4', S.bodies.filter((x) => x.p === '/api/books/payments').length === 0, 'nothing posted until Record');
  await p.click('[data-testid="pay_record"]');
  await p.click('dialog[open] [data-testid="confirm-ok"]', { timeout: 5000 }).catch(() => {}); /* R102b: Record asks first */
  await p.waitForTimeout(800);
  const rec = S.bodies.filter((x) => x.p === '/api/books/payments');
  ok('B4', rec.length === 1 && rec[0].body.mode === 'bank' && rec[0].body.reference === 'N55501' && JSON.stringify(rec[0].body.allocations) === JSON.stringify([{ against_ref: 'bill-B-140', amount_minor: 420000 }]),
    'ONE payment through POST /payments, allocated to their bill (' + JSON.stringify(rec[0] && rec[0].body.allocations) + ')');
  await p.evaluate(() => { try { closeModal(); } catch (_) {} });

  /* ── B5 ── */
  await openRow(p, 5);
  await p.click('[data-next="s5"] [data-testid="bank-ask"]');
  await p.waitForSelector('[data-testid="bank-ask-title"]');
  await p.selectOption('#bk_askto', 'p-unk');
  const words = await p.textContent('[data-testid="bank-ask-words"]');
  ok('B5', /^INR 4,200\.00 came into Mayur Bhavan's bank on 25 Sep 2026, ref N99912 — which bill is it for\?/.test(words.trim()), 'the question: the amount, the day, the ref ("' + words.trim().slice(0, 80) + '…")');
  await p.click('[data-testid="bank-ask-send"]');
  await p.waitForFunction(() => { const e = document.querySelector('[data-testid="bank-chip-s5"]'); return e && e.getAttribute('data-status') === 'asked'; }, null, { timeout: 6000 }).catch(() => {});
  const sent = S.bodies.filter((x) => x.p === '/api/chits/send');
  const sb = sent[0] && sent[0].body;
  ok('B5', sent.length === 1 && sb.purpose === 'general' && sb.business_json.kind === 'bank_query' && sb.recipients[0].entity_id === 'p-unk' && /^bankask:2026-09-25\|in\|420000\|N99912$/.test(sb.client_ref), 'ONE chit through POST /api/chits/send: kind bank_query, to the party, client_ref bankask:<key>');
  leaks = S.reqs.filter((r) => SECRETS.some((s) => (r.u + r.h + r.d).indexOf(s) >= 0));
  ok('B5', leaks.length === 0, 'the ask carries the date, the amount and the ref — never the narration' + (leaks.length ? ' — ' + leaks[0].u + ' ' + leaks[0].d.slice(0, 120) : ''));
  ok('B5', (await statusOf(p, 5)) === 'asked', 'the line is Asked');

  /* ── B6 ── */
  S.chits.push({ chit_id: 'q-1', direction: 'sent', status: 'delivered', created_at: '2026-10-13T06:00:00.000Z', party: P.unk, business_json: { kind: 'bank_query', currency: 'INR', bank_query: sb.business_json.bank_query }, line_items: [] });
  S.chits.push(advice('c-unk', P.unk, 420000, 'N99912', '2026-09-25', [['U-7', 420000]]));
  S.reqs.length = 0;
  await load(p, CSV2);   /* the same device (its rules and marks), the next statement */
  await p.waitForFunction(() => !!document.querySelector('[data-testid="bank-chip-s6"]'), null, { timeout: 8000 });
  await openRow(p, 5);
  const n5 = await p.textContent('[data-testid="bank-next-s5"]');
  ok('B6', (await statusOf(p, 5)) === 'told' && /Unknown Traders/.test(n5) && /U-7/.test(n5), 'their answer (their advice with our ref) settles the line: Party told us, bill U-7 — for both books');
  await openRow(p, 6);
  const n6 = await p.textContent('[data-testid="bank-next-s6"]');
  ok('B6', (await statusOf(p, 6)) === 'suggested' && /you said a line with "KUMAR SONS" was Kumar & Sons/.test(n6) && /Learned from/.test(n6), 'a new Kumar line with no chit is SUGGESTED by the rule learned in B4, with its source');
  await p.click('[data-next="s6"] [data-testid="bank-forget"]');
  await p.waitForFunction(() => { const e = document.querySelector('[data-testid="bank-chip-s6"]'); return e && e.getAttribute('data-status') === 'bank-only'; }, null, { timeout: 5000 }).catch(() => {});
  ok('B6', (await statusOf(p, 6)) === 'bank-only', 'Forget this rule → the line needs you again (a rule is only ever a suggestion)');
  await ctx.close();

  /* ── B7 ── */
  S.who = 'viewer';
  ({ ctx, p } = await open(S, { who: VIEWER }));
  await load(p);
  await openRow(p, 1);
  const rv = await p.evaluate(() => { const b = document.querySelector('[data-next="s1"] [data-testid="bank-record"]'); return b ? { dis: b.disabled, title: b.getAttribute('title') } : null; });
  await openRow(p, 4);
  const av = await p.evaluate(() => { const b = document.querySelector('[data-next="s4"] [data-testid="bank-ask"]'); return b ? { dis: b.disabled, title: b.getAttribute('title') } : null; });
  ok('B7', rv && rv.dis && rv.title === READ_ONLY && av && av.dis && av.title === READ_ONLY, 'a view-only login SEES Record and Ask, greyed with the server\'s sentence (' + JSON.stringify([rv, av]) + ')');
  await ctx.close(); S.who = 'owner';

  /* ── B8 ── */
  ({ ctx, p } = await open(S, { keep: true, hash: 'todo' }));
  await p.evaluate(() => { try { localStorage.setItem('cb_bankrec:ent-M:todo', JSON.stringify({ n: 2, acct: '1500', to: '2026-09-25' })); } catch (_) {} });
  await p.reload(); await p.waitForSelector('[data-testid="todo-row-bank"]', { timeout: 10000 }).catch(() => {});
  const home = await p.locator('[data-testid="todo-row-bank"]').count() ? (await p.textContent('[data-testid="todo-row-bank"]')).replace(/\s+/g, ' ').trim() : '';
  ok('B8', /^⚠ 2 bank lines need you — from the last statement read on this device Open Bank$/.test(home), 'Accounts Home: the bank row in the Home\'s own to-do row ("' + home + '")');
  await p.click('[data-testid="todo-go-bank"]').catch(() => {}); await p.waitForTimeout(500);
  ok('B8', /#bank$/.test(p.url()) || (await p.locator('[data-testid="bank-file"]').count()) === 1, 'its button opens Bank');
  await ctx.close();

  /* ── B10 · B5-05 the file's currency is asked, never the account's · B5-07 a statement belongs to the account it was read for ── */
  ({ ctx, p } = await open(S, {}));
  if (await p.locator('[data-testid="bank-change"]').isVisible() && !(await p.locator('#bk_preset').isVisible())) await p.click('[data-testid="bank-change"]'); /* the form folds once a statement is on screen */ await p.selectOption('#bk_preset', 'hdfc');
  await p.setInputFiles('[data-testid="bank-file"]', { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  /* l16-bank-9: the account has its currency on record (a known fact), so nothing is asked and the statement is read at once */
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 10000 });
  ok('B10', (await p.locator('[data-testid="bank-currency"]').count()) === 0, 'B5-05 (changed): the account has its currency on record, so no currency question and the statement is read');
  await p.waitForSelector('[data-testid="bank-list"].cbl [data-status]', { timeout: 10000 });
  if (!(await p.locator('#bk_acct').isVisible())) await p.click('[data-testid="bank-change"]'); /* the form folds once a statement is on screen: open it to pick another account */
  await p.selectOption('#bk_acct', '1501');
  await p.waitForSelector('[data-testid="bank-acct-changed"]', { timeout: 5000 });
  ok('B10', (await p.locator('[data-testid="bank-list"]').count()) === 0 && (await p.locator('[data-testid="bank-res"] *').count()) === 0, 'B5-07: changing the bank account clears the statement, its marks and the reconciliation, and asks for the file again');
  await ctx.close();

  /* ── B9 · rule 13 ── */
  for (const theme of ['cream', 'dark']) for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const tag = theme + '-' + vp.width;
    ({ ctx, p } = await open(S, { theme, vp }));
    await load(p);
    await openRow(p, 0);
    await p.waitForTimeout(300);
    const th = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const m = (await p.evaluate(measure)).filter((x) => !x.grad && x.ratio < x.need);
    ok('B9', m.length === 0, tag + ' (' + th + '): AA contrast for every text' + (m.length ? ' — ' + m.slice(0, 3).map((x) => '"' + x.text + '" ' + x.ratio + ' < ' + x.need + ' (' + x.tag + ')').join(' · ') : ''));
    const g = await p.evaluate(() => {
      const host = document.querySelector('[data-testid="bank-res"]'), list = host.querySelector('.cbl-list') || host;
      const clipped = Array.from(host.querySelectorAll('*')).filter((e) => { const cs = getComputedStyle(e); if (!e.childNodes.length || e.closest('.cbl-hc,select,input,textarea')) return false;
        return (cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1 && /\S/.test(e.textContent); }).map((e) => e.textContent.trim().slice(0, 30));
      const lr = list.getBoundingClientRect();
      const floats = Array.from(document.querySelectorAll('body *')).filter((e) => { const cs = getComputedStyle(e); if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (e.closest('dialog,#toast,.side,header,.top,.toast')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left < lr.right && r.right > lr.left && r.top < lr.bottom && r.bottom > lr.top; }).map((e) => e.tagName + '.' + e.className);
      const words = Array.from(host.querySelectorAll('[data-testid="bank-next-s0"] span, .cbl-notice, [data-testid^="bank-group-"]')).map((e) => e.textContent.trim()).filter((t) => t.split(/\s+/).length > 22);
      return { dsw: document.documentElement.scrollWidth, iw: innerWidth, lsw: list.scrollWidth, lcw: list.clientWidth, clipped, floats, app: document.querySelectorAll('a[href*="app.html"]').length, words };
    });
    ok('B9', g.dsw <= g.iw && g.lsw <= g.lcw + 1, tag + ': nothing scrolls sideways (page ' + g.dsw + '/' + g.iw + ', list ' + g.lsw + '/' + g.lcw + ')');
    ok('B9', g.clipped.length === 0, tag + ': no clipped text' + (g.clipped.length ? ' — ' + g.clipped.slice(0, 3).join(' · ') : ''));
    ok('B9', g.floats.length === 0 && g.app === 0, tag + ': no floating control over the list, no link to app.html' + (g.floats.length ? ' — ' + g.floats.join(' ') : ''));
    ok('B9', g.words.length === 0, tag + ': the copy is within the budget (22 words a line)' + (g.words.length ? ' — "' + g.words[0].slice(0, 80) + '"' : ''));
    await p.screenshot({ path: path.join(SHOTS, 'walk-bank-rec-' + tag + '.png') });
    await ctx.close();
  }

  ok('B0', threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  const fin = C.finish(); ok('B0', fin[0], fin[1]);
  await b.close(); srv.close();
  console.log('\n  walk-bank-rec: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  XX  the harness stopped: ' + (e && e.stack || e)); process.exit(1); });
