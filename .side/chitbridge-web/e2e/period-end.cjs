/* period-end.cjs — CB ACCOUNTS, MONTH & YEAR END, PROVED (docs/design/cb-accounts-ia/REQUIREMENT.md · app/cap-period.js).
 * Pattern: todo-home.cjs — Playwright, a stand-in API answering INSIDE the page (the shapes chitbridge-api routes/books.js + lib/books-period.js return),
 * a free port for the static server; nothing leaves the machine.
 *
 *  1  Closing stock   happy path (POST body, the entry number the API gave, the last counts) · a locked month is refused in plain words with a button to Month lock ·
 *                     a retry after a refusal carries the SAME client_ref · a co-assist sees the counts read-only and no form
 *  2  Assets          the register (name · kind · cost · put to use · WDV, sold chip, a register/ledger notice) · add by hand · dispose · "Run depreciation for <FY>" shows the
 *                     basis the response named · a year-not-ended refusal · a co-assist: nothing is read, nothing is offered
 *  3  Accruals        repeating: the list, post / skip a due one, a refusal; accruals: add (shows when it turns back), reverse a due one
 *  4  GST close & pay the set-off (credit used, RCM in cash, payable) → Pay (bank, challan) posts the amounts the API gave; a refusal; a 503 is one calm line
 *  5  Year close      each check ✓/✗ with its fix button; "Close the year" asks first, posts once; a co-assist cannot close
 *  +  the To-do buttons now open these pages · 390 px: nothing scrolls sideways on any page · no page error · nothing but the stand-in was reachable
 * Screenshots: e2e/shots/period-<page>-{laptop,phone}.png
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
const TODAY = new Date().toISOString().slice(0, 10);
const FYNOW = (() => { const d = new Date(), y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y + '-' + String((y + 1) % 100).padStart(2, '0'); })();
const PREV = (() => { const y = Number(FYNOW.slice(0, 4)) - 1; return y + '-' + String((y + 1) % 100).padStart(2, '0'); })();

const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
const OWNER = { token: tok({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };
const RAVI = { token: tok({ identity_id: 'act-1', identity_type: 'actor', parent_entity_id: 'ent-M', parent_entity_name: 'Mayur Bhavan', display_name: 'Ravi' }), role: 'actor', name: 'Ravi', entity: 'Mayur Bhavan' };

const EVENTS = { events: [
  { kind: 'expense', words: 'Pay expense', icon: 'receipt', band: 'paid', preview: true, fields: [{ key: 'class', kind: 'pick', pick: 'expense_class', required: true }, { key: 'amount', kind: 'amount' }, { key: 'paid_from', kind: 'pick', pick: 'mode' }, { key: 'date', kind: 'date' }, { key: 'narration', kind: 'text' }] },
  { kind: 'journal', words: 'Write a journal', fields: [{ key: 'lines', kind: 'lines' }] }],
  picks: { mode: ['cash', 'bank', 'upi', 'card'], expense_class: [{ role: 'rent', code: '6010', name: 'Rent' }, { role: 'electricity', code: '6020', name: 'Electricity' }], income_class: [{ role: 'interest_received', code: '4210', name: 'Interest received' }], debit_reason: ['rate'] } };

function stand(over) {
  const S = Object.assign({ calls: [], bodies: [], offHost: [], todo: [], stockRefuse: false, depRefuse: false, assetRefuse: false, gstRefuse: false, gst503: false, yearReady: false, yearHas: false, yearLodged: false, recRefuse: false }, over || {});
  S.assets = [
    { asset_id: 'a1', name: 'Display fridge', asset_class: 'furniture', cost_minor: 4500000, put_to_use: '2025-06-01', accumulated_minor: 450000, wdv_minor: 4050000, disposed_on: null },
    { asset_id: 'a2', name: 'Old scooter', asset_class: 'vehicles', cost_minor: 6000000, put_to_use: '2022-04-02', accumulated_minor: 6000000, wdv_minor: 0, disposed_on: '2026-03-31' }];
  S.rec = [
    { recurring_id: 'r1', name: 'Shop rent', event: { kind: 'expense', class: 'rent', amount_minor: 2500000 }, frequency: 'monthly', next_on: TODAY, end_on: null, auto: false, active: true, due: true },
    { recurring_id: 'r2', name: 'Insurance', event: { kind: 'expense', class: 'insurance', amount_minor: 1800000 }, frequency: 'yearly', next_on: '2099-01-01', end_on: null, auto: true, active: true, due: false }];
  S.stock = [{ date: '2026-08-31', what: 'Closing stock 2026-08-31', ref: 'MJ/26-27/0007', dr_minor: 1200000, cr_minor: 0, running_minor: 9800000 },
    { date: '2026-07-31', what: 'Closing stock 2026-07-31', ref: 'MJ/26-27/0003', dr_minor: 0, cr_minor: 300000, running_minor: 8600000 },
    { date: '2026-08-05', what: 'Sale', ref: 'C2/26-27/0001', dr_minor: 0, cr_minor: 100000, running_minor: 9700000 }];
  return S;
}
const GST_CLOSED = { fy: FYNOW, period: 6, date: '2026-09-30', utilised: [{ from: 'igst', against: 'igst', amount_minor: 1000000 }, { from: 'igst', against: 'cgst', amount_minor: 500000 }, { from: 'cgst', against: 'cgst', amount_minor: 300000 }],
  payable_minor: { cgst_minor: 0, sgst_minor: 420000, igst_minor: 0, cess_minor: 0 }, carried_minor: { cgst_minor: 0, sgst_minor: 0, igst_minor: 250000, cess_minor: 0 }, rcm_minor: { cgst: 90000, sgst: 90000, igst: 0 },
  cash_minor: { cgst: 90000, sgst: 510000, igst: 0 }, pay_total_minor: 600000, owed_before_payments_minor: { cgst_minor: 0, sgst_minor: 420000, igst_minor: 0, cess_minor: 0 }, owed_before_payments_total_minor: 600000, paid_before_close_minor: {}, still_to_pay_minor: { cgst_minor: 0, sgst_minor: 420000, igst_minor: 0, cess_minor: 0 }, still_to_pay_total_minor: 600000, excess_paid_minor: { cgst_minor: 0, sgst_minor: 0, igst_minor: 0, cess_minor: 0 }, ok: true, entry_id: 'e21', entry_no: 'JV/26-27/0021', posting_date: '2026-09-30', doc_date: '2026-09-30', moved: false, lines: 4, items: 0, note: null };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [], offHost = [];

  async function open(S, hash, who, vp) {
    const ctx = await b.newContext({ viewport: vp || { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()), p = u.pathname, m = r.request().method(); S.calls.push(m + ' ' + p);
      let body = null; try { body = r.request().postDataJSON(); } catch (_) {} if (m !== 'GET') S.bodies.push({ m, p, body });
      if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' } });
      if (p === '/api/books/health') return J(r, 200, books.health());
      if (p === '/api/books/todo') return J(r, 200, S.todo.map(books.todoRow));
      if (p === '/api/books/periods') return J(r, 200, books.periods([books.periodRow(PREV, 1, 'hard_locked'), books.periodRow(FYNOW, 1, 'soft_locked')]));
      if (p === '/api/books/events') return J(r, 200, books.eventsAnswer(EVENTS));
      if (p === '/api/books/ledger/stock') return J(r, 200, books.ledger('1200', 'Stock-in-hand', S.stock, { closing_minor: 9700000 }));
      if (p === '/api/books/closing-stock' && m === 'POST') {
        if (S.stockRefuse) return J(r, 409, Object.assign(books.refusal('August 2026 is locked — no entry can go into it.', 'PERIOD_LOCKED'), { type: 'https://chitbridge.com/problems/period_locked', title: 'Month locked', status: 409, hint: 'Use a date in an open month, or ask the owner to unlock it.', detail: 'August 2026 is locked — no entry can go into it.', request_id: null }));   /* the api's RFC 9457 problem answer (contract: POST /api/books/closing-stock #409) */
        S.stock.push({ date: body.date, what: 'Closing stock ' + body.date, ref: 'MJ/26-27/0009', dr_minor: 100, cr_minor: 0, running_minor: 9800100 }); return J(r, 200, books.posted({ entry_no: 'MJ/26-27/0009', entry_id: 'e9', book_minor: 9700000 }));
      }
      if (p === '/api/books/assets' && m === 'GET') return J(r, 200, { currency: 'INR', asOf: TODAY, assets: S.assets.map(books.assetRow), total_wdv_minor: 4050000,
        net_block: [{ asset_class: 'furniture', count: 1, cost_minor: 4500000, accumulated_minor: 450000, wdv_minor: 4050000, ledger_cost_minor: 4500000, ledger_accumulated_minor: 450000, ledger_wdv_minor: 4050000, agrees: true },
          { asset_class: 'computers', count: 1, cost_minor: 5000000, accumulated_minor: 0, wdv_minor: 5000000, ledger_cost_minor: 4900000, ledger_accumulated_minor: 0, ledger_wdv_minor: 4900000, agrees: false }] });
      if (p === '/api/books/assets' && m === 'POST') {
        if (S.assetRefuse) return J(r, 400, { error: 'How was it paid? cash, bank, upi or card — or name the supplier it is owed to.' });
        S.assets.push({ asset_id: 'a3', name: body.name, asset_class: body.class, cost_minor: body.cost_minor, put_to_use: body.date, accumulated_minor: 0, wdv_minor: body.cost_minor, disposed_on: null }); return J(r, 200, books.posted({ entry_no: 'MJ/26-27/0010', asset: books.assetRow({ asset_id: 'a3', name: body.name, asset_class: body.class, cost_minor: body.cost_minor, wdv_minor: body.cost_minor }) }));
      }
      if (/^\/api\/books\/assets\/[^/]+\/dispose$/.test(p)) { S.assets[0].disposed_on = body.date; S.assets[0].wdv_minor = 0; return J(r, 200, books.posted({ entry_no: 'MJ/26-27/0011', asset: books.assetRow({ asset_id: 'a1', disposed_on: body.date }) })); }
      if (p === '/api/books/depreciation/run') {
        if (S.depRefuse) return J(r, 409, { error: 'Depreciation for ' + body.fy + ' runs at the year end (2027-03-31) or after — the year has not ended.' });
        return J(r, 200, { ok: true, fy: body.fy, entity_basis: 'proprietor', basis_assumed: true, basis_rule: 'it_act_wdv', entity_note: 'The entity type is not set for this shop yet, so depreciation was worked as a proprietor (Income-tax Act written-down value).',
          by_class: [{ class: 'furniture', rate: 10, amount: 4500 }, { class: 'computers', rate: 40, amount: 20000 }], by_asset: [{ id: 'a1', class: 'furniture', amount: 4500 }], entry_no: 'JV/26-27/0020', entry_id: 'd1', posting_date: TODAY, doc_date: TODAY, moved: false, lines: 2, items: 0, note: null });
      }
      if (p === '/api/books/recurring' && m === 'GET') return J(r, S.rec503 ? 503 : 200, S.rec503 ? { error: 'raw table detail', code: 'BOOKS_NOT_MIGRATED' } : { recurring: S.rec.map(books.recRow) });
      if (p === '/api/books/recurring' && m === 'POST') { if (S.recRefuse) return J(r, 400, { error: 'When is the first one due? Use YYYY-MM-DD.' }); S.rec.push({ recurring_id: 'r3', name: body.name, event: body.event, frequency: body.frequency, next_on: body.next_on, active: true, auto: body.auto }); return J(r, 200, books.recRow(S.rec[S.rec.length - 1])); }
      if (p === '/api/books/recurring/r1/post') { S.rec[0].next_on = '2099-02-01'; return J(r, 200, { posted: books.posted({ kind: 'expense', entry_no: 'MJ/26-27/0012' }), template: books.recRow(S.rec[0]), date: TODAY }); }
      if (p === '/api/books/recurring/r1/skip') { S.rec[0].next_on = '2099-02-01'; return J(r, 200, { skipped: TODAY, template: books.recRow(S.rec[0]) }); }
      if (/^\/api\/books\/recurring\/[^/]+$/.test(p) && m === 'PATCH') { S.rec[1].auto = body.auto; return J(r, 200, books.recRow(S.rec[1])); }
      if (/^\/api\/books\/recurring\/[^/]+$/.test(p) && m === 'DELETE') { S.rec[1].active = false; return J(r, 200, Object.assign(books.recRow(S.rec[1]), { stopped: true })); }
      if (p === '/api/books/accruals') return J(r, 200, books.posted({ ref: body.ref, kind: body.kind, reverses_on: '2026-10-01', entry_no: 'JV/26-27/0022' }));
      if (/^\/api\/books\/accruals\/[^/]+\/reverse$/.test(p)) return J(r, 200, books.posted({ entry_no: 'JV/26-27/0023' }));
      if (p === '/api/books/gst/close') {
        if (S.gst503) return J(r, 503, { error: 'internal detail that must never reach the screen' });
        if (S.gstRefuse) return J(r, 409, { error: 'Month 6 of ' + body.fy + ' ends on 2026-09-30 — close it once it has ended.' });
        return J(r, 200, GST_CLOSED);
      }
      if (p === '/api/books/gst/pay') { if (S.payRefuse) return J(r, 409, { error: 'That is more than the tax owed — SGST owed 4200.00, paid 420000.00. Run the month close first, or correct the amount.' }); return J(r, 200, books.posted({ entry_no: 'JV/26-27/0024', challan_no: body.challan_no, payment_ref: body.challan_no, paid_minor: { cgst: 0, sgst: 420000 } })); }
      let ym = /^\/api\/books\/year\/([^/]+)\/status$/.exec(p);
      if (ym && S.yearLodged) return J(r, 200, { fiscal_year: ym[1], returns_lodged: false, closed: !!S.yearHas, can_close: false, can_close_if_lodged: !S.yearHas, refusals: [{ name: 'return_open', why: '2 BAS periods of ' + ym[1] + ' are not closed: Q1, Q2.' }], months: Array.from({ length: 12 }, (_, i) => ({ period: i + 1, status: 'soft_locked' })), next: '2026-27' });
      if (ym) return J(r, 200, S.yearReady ? { fiscal_year: ym[1], returns_lodged: false, closed: !!S.yearHas, can_close: !S.yearHas, can_close_if_lodged: false, refusals: [], months: Array.from({ length: 12 }, (_, i) => ({ period: i + 1, status: 'soft_locked' })), next: '2026-27' }
        : { fiscal_year: ym[1], returns_lodged: false, closed: false, can_close: false, can_close_if_lodged: false, months: Array.from({ length: 12 }, (_, i) => ({ period: i + 1, status: i < 10 ? 'soft_locked' : 'open' })), next: '2026-27',
          refusals: [{ name: 'months_locked', why: 'Month 11 (Feb) and month 12 (Mar) are still open — lock every month first.' }, { name: 'suspense_nil', why: 'Suspense holds 1,200.00 — clear it with an entry first.' }] });
      ym = /^\/api\/books\/year\/([^/]+)\/close$/.exec(p);
      if (ym) { S.yearHas = true; return J(r, 200, { ok: true, fiscal_year: ym[1], next: '2026-27', locked: 13, opening: { rows: 40, retained_minor: 0, profit_minor: 0, balanced: true } }); }
      if (p === '/api/books/daybook') return J(r, 200, books.daybook([]));
      if (p === '/api/books/dues') return J(r, 200, books.dues([]));
      if (p === '/api/books/cheques') return J(r, 200, books.cheques({ asOf: TODAY }));   /* the contract's answer, not the catch-all {} below */
      /* BAS1: an Indian shop's return is the GSTR, read from the rail — the GST screen asks once and paints the close & pay form on this answer */
      if (p === '/api/books/returns') return J(r, 422, { code: 'RETURN_FROM_RAIL', error: 'India\'s GSTR-1 and GSTR-3B are read from the frozen invoices on the rail (GET /api/tax/gstr), not from the ledgers.', message: 'India\'s GSTR-1 and GSTR-3B are read from the frozen invoices on the rail (GET /api/tax/gstr), not from the ledgers.' });
      if (p.startsWith('/api/books')) return J(r, 200, {});
      return J(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, who || OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { threw.push(e.message); if (process.env.DEBUG_PE) console.log('  !! pageerror: ' + e.message); });
    if (process.env.DEBUG_PE) p.on('console', (m) => { if (m.type() === 'error') console.log('  !! console: ' + m.text()); });
    await p.goto(base + '/accounts.html' + (hash ? '#' + hash : ''));
    return { ctx, p };
  }
  const posts = (S, re) => S.bodies.filter((x) => x.m === 'POST' && re.test(x.p));
  const active = (p) => p.evaluate(() => document.querySelector('.nav-btn.active').getAttribute('aria-label'));
  const noSide = async (p, w) => { await p.waitForTimeout(250); return p.evaluate((w) => ({ d: document.documentElement.scrollWidth, m: document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth, w }), w); };
  const shot = (p, n, vp) => p.screenshot({ path: path.join(SHOTS, 'period-' + n + '-' + vp + '.png') });

  /* ── 1 · CLOSING STOCK ── */
  {
    const S = stand(), { ctx, p } = await open(S, 'closingstock');
    await p.waitForSelector('[data-testid="ps-form"]', { timeout: 15000 }); await p.waitForSelector('[data-testid="stock-list"].cbl', { timeout: 8000 });
    ok(await active(p) === 'Closing stock' && (await p.textContent('#title')).trim() === 'Closing stock', 'Closing stock opens, lit in the sidebar');
    const rows = await p.$$eval('[data-testid^="stock-"]', (x) => x.filter((e) => /^stock-[0-9]+$/.test(e.getAttribute('data-testid'))).length);
    ok(rows === 2, 'the last counts are the stock lines the API named "Closing stock" (2 of 3 lines; the sale is not one) — got ' + rows);
    await shot(p, 'closingstock', 'laptop');
    await p.fill('#ps_val', '1,25,000.50'); await p.fill('#ps_nrv', '1,10,000');
    await p.click('[data-testid="ps-save"]');
    await p.waitForSelector('[data-testid="pe-ok"]', { timeout: 5000 });
    const bd = posts(S, /closing-stock/)[0].body;
    ok(bd.value_minor === 12500050 && bd.nrv_minor === 11000000 && bd.method === 'manual' && /^\d{4}-\d{2}-\d{2}$/.test(bd.date) && /^web-/.test(bd.client_ref), 'POST /closing-stock carries value_minor 12500050, nrv_minor 11000000, method manual, a date and a client_ref');
    ok(/MJ\/26-27\/0009/.test(await p.textContent('[data-testid="pe-ok"]')), 'the page shows the entry number the API gave (MJ/26-27/0009) — it numbers nothing itself');
    S.stockRefuse = true; await p.fill('#ps_val', '90000');
    await p.click('[data-testid="ps-save"]'); await p.waitForSelector('[data-testid="pe-refused"]', { timeout: 5000 });
    ok(/locked/.test(await p.textContent('[data-testid="pe-refused"]')) && !/PERIOD_LOCKED|409/.test(await p.textContent('#bk_body')), 'a locked month is refused in plain words, no code');
    ok(await p.locator('[data-testid="pe-fix"]').count() === 1, 'the refusal carries its fix: a button');
    await p.click('[data-testid="ps-save"]'); await p.waitForTimeout(400);
    const refs = posts(S, /closing-stock/).map((x) => x.body.client_ref);
    ok(refs.length === 3 && refs[1] === refs[2] && refs[0] !== refs[1], 'a retry after a refusal carries the SAME client_ref; a saved one is replaced');
    await p.click('[data-testid="pe-fix"]'); await p.waitForFunction(() => document.querySelector('.nav-btn.active').getAttribute('aria-label') === 'Month lock', null, { timeout: 5000 }).catch(() => {});
    ok(await active(p) === 'Month lock', 'the fix button opens Month lock');
    ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
    await ctx.close();
    const S2 = stand(), c2 = await open(S2, 'closingstock', RAVI);
    await c2.p.waitForSelector('[data-testid="pe-readonly"]', { timeout: 15000 }); await c2.p.waitForSelector('[data-testid="stock-list"].cbl', { timeout: 8000 });
    ok(await c2.p.locator('[data-testid="ps-form"], [data-testid="ps-save"]').count() === 0, 'a co-assist: no form, no Save button — the counts are read-only');
    await c2.ctx.close();
    const S3 = stand(), c3 = await open(S3, 'closingstock', OWNER, { width: 390, height: 844 });
    await c3.p.waitForSelector('[data-testid="ps-form"]', { timeout: 15000 });
    const m = await noSide(c3.p); ok(m.d === 390 && m.m, '390 px: nothing scrolls sideways (' + m.d + ')');
    const bh = await c3.p.$eval('[data-testid="ps-save"]', (x) => Math.round(x.getBoundingClientRect().height)); ok(bh >= 44, 'the Save button is at least 44 px tall (' + bh + ')');
    await shot(c3.p, 'closingstock', 'phone'); await c3.ctx.close();
  }

  /* ── 2 · ASSETS & DEPRECIATION ── */
  {
    const S = stand(), { ctx, p } = await open(S, 'assets');
    await p.waitForSelector('[data-testid="assets-list"].cbl', { timeout: 15000 });
    ok(await active(p) === 'Assets & depreciation', 'Assets & depreciation opens');
    const txt = await p.textContent('[data-testid="assets-list"]');
    ok(/Display fridge/.test(txt) && /Old scooter/.test(txt) && /45,000\.00/.test(txt) && /40,500\.00/.test(txt), 'the register lists asset, written-down value and cost (the top three columns; kind and put-to-use are in the column chooser), in the API figures');
    ok(await p.locator('[data-testid="asset-sold-a2"]').count() === 1, 'a disposed asset carries the Sold chip');
    ok(await p.locator('[data-testid="pa-differs-computers"]').count() === 1 && /differ/.test(await p.textContent('[data-testid="pa-differs-computers"]')), 'a class where the register and the Ledger differ is a notice');
    await shot(p, 'assets', 'laptop');
    await p.click('[data-testid="pa-add-open"]');
    await p.fill('#pa_name', 'Billing computer'); await p.selectOption('#pa_class', 'computers'); await p.fill('#pa_cost', '55,000'); await p.selectOption('#pa_how', 'bank');
    await p.click('[data-testid="pa-save"]'); await p.waitForSelector('[data-testid="pe-ok"]', { timeout: 5000 });
    const ab = posts(S, /\/assets$/)[0].body;
    ok(ab.name === 'Billing computer' && ab.class === 'computers' && ab.cost_minor === 5500000 && ab.how === 'bank' && /^web-/.test(ab.client_ref), 'add by hand: POST /assets {name, class, cost_minor 5500000, how bank, client_ref}');
    ok(/MJ\/26-27\/0010/.test(await p.textContent('[data-testid="pe-ok"]')), 'the entry number is the API\'s');
    S.assetRefuse = true; await p.click('[data-testid="pa-add-open"]'); await p.fill('#pa_name', 'X'); await p.fill('#pa_cost', '10');
    await p.click('[data-testid="pa-save"]'); await p.waitForSelector('#pa_fout [data-testid="pe-refused"]', { timeout: 5000 });
    ok(/How was it paid/.test(await p.textContent('#pa_fout')), 'a refusal is the server\'s sentence, shown where it happened');
    await p.click('[data-testid="pa-cancel"]');
    await p.click('[data-testid="asset-a1"] [data-caret]'); await p.click('[data-testid="pa-dispose"]');
    await p.waitForSelector('[data-testid="pa-sell-form"]'); await p.fill('#pd_get', '20,000'); await p.click('[data-testid="pd-save"]');
    await p.waitForSelector('[data-testid="pe-ok"]', { timeout: 5000 });
    const db = posts(S, /dispose/)[0];
    ok(/\/assets\/a1\/dispose$/.test(db.p) && db.body.proceeds_minor === 2000000 && db.body.into === 'bank', 'dispose: POST /assets/a1/dispose with proceeds_minor 2000000');
    await p.click('[data-testid="pa-dep-open"]'); await p.waitForSelector('[data-testid="pdp-run"]');
    ok((await p.textContent('[data-testid="pdp-run"]')).trim() === 'Run depreciation for ' + PREV, 'the button says "Run depreciation for ' + PREV + '"');
    await p.click('[data-testid="pdp-run"]'); await p.waitForSelector('[data-testid="pdp-basis"]', { timeout: 5000 });
    ok((await p.textContent('[data-testid="pdp-basis"]')).trim() === 'Basis used — proprietor: Income-tax WDV', 'the basis used is shown from the response: "proprietor: Income-tax WDV"');
    ok(/not set for this shop/.test(await p.textContent('[data-testid="pdp-note"]')) && /JV\/26-27\/0020/.test(await p.textContent('[data-testid="pdp-done"]')), 'the response\'s note on the assumed basis and its entry number are shown');
    ok(posts(S, /depreciation/)[0].body.fy === PREV, 'POST /depreciation/run { fy }');
    await p.screenshot({ path: path.join(SHOTS, 'period-assets-run-laptop.png') });
    S.depRefuse = true; await p.selectOption('#pdp_fy', FYNOW); await p.click('[data-testid="pdp-run"]'); await p.waitForSelector('#pdp_out [data-testid="pe-refused"]', { timeout: 5000 });
    ok(/has not ended/.test(await p.textContent('#pdp_out')), 'a year that has not ended is refused in plain words');
    ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
    await ctx.close();
    const S2 = stand(), c2 = await open(S2, 'assets', RAVI);
    await c2.p.waitForSelector('[data-testid="pe-readonly"]', { timeout: 15000 });
    ok(S2.calls.filter((c) => /assets/.test(c)).length === 0 && await c2.p.locator('[data-testid="pa-add-open"]').count() === 0, 'a co-assist: no register read, no Add, no depreciation');
    await c2.ctx.close();
    const S3 = stand(), c3 = await open(S3, 'assets', OWNER, { width: 390, height: 844 });
    await c3.p.waitForSelector('[data-testid="assets-list"].cbl', { timeout: 15000 });
    const m = await noSide(c3.p); ok(m.d === 390 && m.m, '390 px: nothing scrolls sideways (' + m.d + ')');
    await shot(c3.p, 'assets', 'phone'); await c3.ctx.close();
  }

  /* ── 3 · ACCRUALS & RECURRING ── */
  {
    const S = stand({ todo: [{ kind: 'accrual_reversals_due', count: 1, words: '1 accrual is due to turn back: ELEC-2026-08.', action: { label: 'Reverse now', screen: 'accruals' }, items: [{ ref: 'ELEC-2026-08', due: '2026-09-01', posted_on: '2026-08-31' }] }] });
    const { ctx, p } = await open(S, 'accruals');
    await p.waitForSelector('[data-testid="recurring-list"].cbl', { timeout: 15000 });
    ok(await active(p) === 'Accruals & recurring', 'Accruals & recurring opens on the repeating entries');
    ok(await p.locator('[data-testid="rec-due-r1"]').count() === 1 && await p.locator('[data-testid="rec-due-r2"]').count() === 0, 'only the entry whose day has come carries Due');
    await shot(p, 'accruals', 'laptop');
    await p.click('[data-testid="rec-r1"] [data-caret]'); await p.click('[data-testid="rec-post"]');
    await p.waitForSelector('[data-testid="pe-ok"]', { timeout: 5000 });
    ok(posts(S, /recurring\/r1\/post/).length === 1 && /MJ\/26-27\/0012/.test(await p.textContent('[data-testid="pe-ok"]')), 'Post it: POST /recurring/r1/post once; the API\'s entry number is shown');
    await p.click('[data-testid="rec-r2"] [data-caret]');
    ok(await p.locator('[data-testid="rec-post"]').count() === 0 && await p.locator('[data-testid="rec-stop"]').count() === 1, 'a not-due entry offers Stop, not Post');
    await p.click('[data-testid="rec-auto"]'); await p.waitForSelector('[data-testid="pe-ok"]');
    ok(S.bodies.some((x) => x.m === 'PATCH' && x.body.auto === false), 'switching "post by itself" off is a merge-patch of only { auto }');
    await p.click('[data-testid="pr-add-open"]'); await p.fill('#pr_name', 'Electricity'); await p.selectOption('#pr_kind', 'expense');
    ok(await p.locator('#prf_class').count() === 1 && await p.locator('#prf_amount').count() === 1, 'a new repeating entry asks for the kind\'s own fields (from GET /events)');
    await p.selectOption('#prf_class', 'electricity'); await p.fill('#prf_amount', '4,200'); await p.selectOption('#prf_paid_from', 'bank');
    await p.click('[data-testid="pr-save"]'); await p.waitForSelector('[data-testid="pe-ok"]');
    const rb = posts(S, /\/recurring$/)[0].body;
    ok(rb.name === 'Electricity' && rb.event.kind === 'expense' && rb.event.amount_minor === 420000 && rb.event.class === 'electricity' && rb.frequency === 'monthly' && !('date' in rb.event), 'POST /recurring { name, event {kind, class, amount_minor 420000, paid_from}, frequency, next_on }');
    S.recRefuse = true; await p.click('[data-testid="pr-add-open"]'); await p.fill('#pr_name', 'Bad'); await p.selectOption('#pr_kind', 'expense');
    await p.click('[data-testid="pr-save"]'); await p.waitForSelector('#pr_fout [data-testid="pe-refused"]');
    ok(/first one due/.test(await p.textContent('#pr_fout')), 'a refusal is the server\'s sentence');
    await p.click('[data-testid="pr-cancel"]');
    await p.click('[data-testid="pr-tab-acc"]'); await p.waitForSelector('[data-testid="accruals-list"].cbl');
    ok(await p.locator('[data-testid="accr-due-ELEC-2026-08"]').count() === 1, 'accruals: the one the To-do feed says is due to turn back is listed, marked Due');
    await p.click('[data-testid="accr-ELEC-2026-08"] [data-caret]'); await p.click('[data-testid="accr-reverse"]'); await p.waitForSelector('[data-testid="pe-ok"]');
    ok(posts(S, /accruals\/ELEC-2026-08\/reverse/).length === 1 && /JV\/26-27\/0023/.test(await p.textContent('[data-testid="pe-ok"]')), 'Turn it back now: POST /accruals/:ref/reverse; the API\'s JV number is shown');
    await p.click('[data-testid="pc-add-open"]'); await p.fill('#pc_ref', 'ELEC-2026-09'); await p.selectOption('#pc_class', '6020'); await p.fill('#pc_amt', '3,100');
    await p.click('[data-testid="pc-save"]'); await p.waitForSelector('[data-testid="pe-ok"]');
    const cb = posts(S, /\/accruals$/)[0].body;
    ok(cb.ref === 'ELEC-2026-09' && cb.kind === 'outstanding' && cb.class === '6020' && cb.amount_minor === 310000 && /^web-/.test(cb.client_ref), 'POST /accruals { ref, kind, class, amount_minor 310000, date, client_ref }');
    await p.waitForSelector('[data-testid="accr-ELEC-2026-09"]', { timeout: 5000 }).catch(() => {}); ok(/turns back on/.test(await p.textContent('[data-testid="pe-ok"]')) && await p.locator('[data-testid="accr-ELEC-2026-09"]').count() === 1, 'it says when it turns back (the API\'s reverses_on) and joins the list');
    ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
    await ctx.close();
    const S2 = stand({ rec503: true }), c2 = await open(S2, 'accruals');
    await c2.p.waitForSelector('[data-testid="pe-refused"]', { timeout: 15000 });
    ok((await c2.p.textContent('[data-testid="pe-refused"]')).trim() === '⏳ Starts after an update' && !/raw table/.test(await c2.p.textContent('#bk_body')), 'a 503 (not migrated) is one calm line, never a raw message');
    await c2.ctx.close();
    const S3 = stand(), c3 = await open(S3, 'accruals', RAVI);
    await c3.p.waitForSelector('[data-testid="pe-readonly"]', { timeout: 15000 });
    ok(S3.calls.filter((c) => /recurring|accruals/.test(c)).length === 0 && await c3.p.locator('button[data-testid^="pr-"], button[data-testid^="pc-"]').count() === 0, 'a co-assist: nothing read, nothing offered');
    await c3.ctx.close();
    const S4 = stand(), c4 = await open(S4, 'accruals', OWNER, { width: 390, height: 844 });
    await c4.p.waitForSelector('[data-testid="recurring-list"].cbl', { timeout: 15000 });
    const m = await noSide(c4.p); ok(m.d === 390 && m.m, '390 px: nothing scrolls sideways (' + m.d + ')');
    await shot(c4.p, 'accruals', 'phone'); await c4.ctx.close();
  }

  /* ── 4 · GST CLOSE & PAY ── */
  {
    const S = stand(), { ctx, p } = await open(S, 'gstclose');
    await p.waitForSelector('[data-testid="pg-form"]', { timeout: 15000 });
    ok(await active(p) === 'GST close & pay', 'GST close & pay opens');
    await p.selectOption('#pg_fy', FYNOW); await p.selectOption('#pg_p', '6');
    await p.click('[data-testid="pg-close"]'); await p.waitForSelector('[data-testid="pg-setoff"]', { timeout: 5000 });
    const cb = posts(S, /gst\/close/)[0].body;
    ok(cb.fy === FYNOW && cb.period === 6, 'POST /gst/close { fy, period }');
    const set = await p.textContent('[data-testid="pg-setoff"]');
    ok(await p.locator('[data-testid^="pg-used-"]').count() === 3 && /IGST → CGST/.test(set) && /5,000\.00/.test(set), 'credit used is listed head to head, in the API\'s figures (IGST → CGST 5,000.00)');
    ok(await p.locator('[data-testid="pg-rcm-cgst"]').count() === 1 && /Reverse charge — paid in cash/.test(set), 'reverse charge is shown as paid in cash');
    ok(/6,000\.00/.test(await p.textContent('[data-testid="pg-total"]')) && /JV\/26-27\/0021/.test(await p.textContent('[data-testid="pg-closed"]')), 'the payable (6,000.00) and the set-off entry number are the API\'s');
    await shot(p, 'gstclose', 'laptop');
    ok(await p.inputValue('#pgp_sgst') === '4200.00' && await p.inputValue('#pgr_cgst') === '900.00', 'the Pay form is prefilled from the response (SGST 4200.00, RCM CGST 900.00)');
    await p.fill('#pgp_ch', 'CPIN26092000123'); await p.selectOption('#pgp_bank', 'bank');
    await p.click('[data-testid="pg-pay"]'); await p.waitForSelector('#pgp_out [data-testid="pe-ok"]', { timeout: 5000 });
    const pb = posts(S, /gst\/pay/)[0].body;
    ok(pb.fy === FYNOW && pb.period === 6 && pb.bank === 'bank' && pb.challan_no === 'CPIN26092000123' && pb.amounts.sgst_minor === 420000 && pb.rcm.cgst_minor === 90000, 'POST /gst/pay { fy, period, amounts, rcm, bank, challan_no }');
    ok(/JV\/26-27\/0024/.test(await p.textContent('#pgp_out')), 'the challan entry number is the API\'s');
    S.payRefuse = true; await p.fill('#pgp_sgst', '420000'); await p.click('[data-testid="pg-pay"]'); await p.waitForSelector('#pgp_out [data-testid="pe-refused"]');
    ok(/more than the tax owed/.test(await p.textContent('#pgp_out')), 'a slip of the finger is refused with the server\'s sentence');
    S.gstRefuse = true; await p.click('[data-testid="pg-close"]'); await p.waitForSelector('#pg_out [data-testid="pe-refused"]');
    ok(/close it once it has ended/.test(await p.textContent('#pg_out')) && await p.locator('[data-testid="pg-setoff"]').count() === 0, 'a month that has not ended is refused in plain words, and the old result is cleared');
    S.gstRefuse = false; S.gst503 = true; await p.click('[data-testid="pg-close"]'); await p.waitForFunction(() => /Starts after an update/.test((document.querySelector('#pg_out') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});   /* the earlier refusal is still showing until the new answer lands */
    ok((await p.textContent('#pg_out [data-testid="pe-refused"]')).trim() === '⏳ Starts after an update' && !/internal detail/.test(await p.textContent('#bk_body')), 'a 503 is one calm line');
    ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
    await ctx.close();
    const S2 = stand(), c2 = await open(S2, 'gstclose', RAVI);
    await c2.p.waitForSelector('[data-testid="pe-readonly"]', { timeout: 15000 });
    ok(await c2.p.locator('[data-testid="pg-close"], [data-testid="pg-pay"]').count() === 0, 'a co-assist: no Close, no Pay');
    await c2.ctx.close();
    const S3 = stand(), c3 = await open(S3, 'gstclose', OWNER, { width: 390, height: 844 });
    await c3.p.waitForSelector('[data-testid="pg-form"]', { timeout: 15000 }); await c3.p.click('[data-testid="pg-close"]'); await c3.p.waitForSelector('[data-testid="pg-pay-form"]', { timeout: 5000 });
    const m = await noSide(c3.p); ok(m.d === 390 && m.m, '390 px: nothing scrolls sideways (' + m.d + ')');
    await shot(c3.p, 'gstclose', 'phone'); await c3.ctx.close();
  }

  /* ── 5 · YEAR CLOSE ── */
  {
    const S = stand(), { ctx, p } = await open(S, 'yearclose');
    await p.waitForSelector('[data-testid="py-checks"]', { timeout: 15000 });
    ok(await active(p) === 'Year close' && S.calls.some((c) => c === 'GET /api/books/year/' + PREV + '/status'), 'Year close opens on the year just ended and reads its status');
    ok(await p.locator('[data-testid="py-months"].bad').count() === 1 && /2 of 12 months are not locked yet/.test(await p.textContent('[data-testid="py-months"]')), 'a failing check shows ✗ with its sentence (2 of 12 months)');
    ok(await p.locator('[data-testid="py-check-0"] .pe-fix, [data-testid="py-fix-months"]').count() >= 1 && await p.locator('[data-testid="py-fix-1"]').count() === 1, 'every failing check carries its fix button');
    ok(await p.isDisabled('[data-testid="py-close"]'), '"Close the year" waits while a check fails');
    await shot(p, 'yearclose', 'laptop');
    await p.click('[data-testid="py-fix-1"]'); await p.waitForFunction(() => document.querySelector('.nav-btn.active').getAttribute('aria-label') === 'Day book', null, { timeout: 5000 }).catch(() => {});
    ok(await active(p) === 'Day book', 'the Suspense check\'s fix opens the Day book');
    await ctx.close();
    const S2 = stand({ yearReady: true }), c2 = await open(S2, 'yearclose');
    await c2.p.waitForSelector('[data-testid="py-checks"]', { timeout: 15000 });
    ok(await c2.p.locator('.pe-check.ok').count() >= 1 && await c2.p.locator('.pe-check.bad').count() === 0 && await c2.p.isEnabled('[data-testid="py-close"]'), 'every check ✓ → "Close the year" is on');
    await c2.p.click('[data-testid="py-close"]'); await c2.p.waitForSelector('[data-testid="confirm"]', { timeout: 3000 });
    ok(posts(S2, /year\/.*close/).length === 0, 'it asks first — nothing is posted by the first tap');
    await c2.p.click('[data-testid="confirm-ok"]');
    await c2.p.waitForSelector('#py_out [data-testid="pe-ok"]', { timeout: 5000 });
    ok(posts(S2, /year\/.*close/).length === 1 && /closed · carried to 2026-27/.test(await c2.p.textContent('#py_out')), 'POST /year/:fy/close once; "closed · carried to 2026-27" from the response');
    await c2.ctx.close();
    /* PAST-YEARS: only the returns stand in the way → one plain sentence; Close waits for the tick, then sends returns_lodged (product policy, the server decides) */
    const SL = stand({ yearLodged: true }), cl = await open(SL, 'yearclose');
    await cl.p.waitForSelector('[data-testid="py-lodged"]', { timeout: 15000 });
    ok(/lodged these returns outside ChitBridge/.test(await cl.p.textContent('[data-testid="py-lodged-card"]')) && await cl.p.isDisabled('[data-testid="py-close"]'), 'the lodged sentence is shown when the server says can_close_if_lodged; Close waits for the tick');
    await cl.p.check('[data-testid="py-lodged"]');
    ok(await cl.p.isEnabled('[data-testid="py-close"]'), 'ticking it wakes Close the year');
    await cl.p.click('[data-testid="py-close"]'); await cl.p.waitForSelector('[data-testid="confirm"]', { timeout: 3000 });
    await cl.p.click('[data-testid="confirm-ok"]');
    await cl.p.waitForSelector('#py_out [data-testid="pe-ok"]', { timeout: 5000 });
    ok(posts(SL, /year[/].*close/).length === 1 && posts(SL, /year[/].*close/)[0].body.returns_lodged === true, 'POST /year/:fy/close once, with returns_lodged: true');
    ok(posts(S2, /year[/].*close/)[0].body && posts(S2, /year[/].*close/)[0].body.returns_lodged === undefined, 'a year that can close on its own sends no returns_lodged');
    await cl.ctx.close();
    const S3 = stand({ yearReady: true }), c3 = await open(S3, 'yearclose', RAVI);
    await c3.p.waitForSelector('[data-testid="py-checks"]', { timeout: 15000 });
    ok(await c3.p.locator('[data-testid="py-close"]').count() === 0 && await c3.p.locator('[data-testid="pe-readonly"]').count() === 1, 'a co-assist reads the checks and cannot close');
    await c3.ctx.close();
    const S4 = stand(), c4 = await open(S4, 'yearclose', OWNER, { width: 390, height: 844 });
    await c4.p.waitForSelector('[data-testid="py-checks"]', { timeout: 15000 });
    const m = await noSide(c4.p); ok(m.d === 390 && m.m, '390 px: nothing scrolls sideways (' + m.d + ')');
    await shot(c4.p, 'yearclose', 'phone'); await c4.ctx.close();
  }

  /* ── the To-do buttons ── */
  {
    const items = [['closing_stock_missing', 'closing-stock', 'Closing stock'], ['gst_due', 'gst', 'GST close & pay'], ['recurring_due', 'recurring', 'Accruals & recurring'], ['accrual_reversals_due', 'accruals', 'Accruals & recurring'], ['year_close_possible', 'year-close', 'Year close']];
    const S = stand({ todo: items.map((i) => ({ kind: i[0], count: 1, words: 'x ' + i[0], action: { label: 'Go', screen: i[1], call: 'x' } })) });
    const { ctx, p } = await open(S, 'todo');
    await p.waitForSelector('[data-testid="todo-list"]', { timeout: 15000 });
    for (const [kind, , label] of items) {
      await p.click('[data-testid="acc-nav-todo"]'); await p.waitForSelector('[data-testid="todo-list"]'); await p.click('[data-testid="todo-go-' + kind + '"]');
      await p.waitForFunction((l) => document.querySelector('.nav-btn.active').getAttribute('aria-label') === l, label, { timeout: 5000 }).catch(() => {});
      ok(await active(p) === label, 'the To-do button for ' + kind + ' opens ' + label);
    }
    await ctx.close();
  }

  ok(offHost.filter((u) => !/fonts\.g/.test(u)).length === 0, 'nothing but the stand-in was reachable' + (offHost.length ? ' — refused: ' + offHost.join(' ') : ''));
  await b.close(); srv.close();
  ok(...C.finish());
  console.log('\n  period-end: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  XX  the harness stopped: ' + e.message); process.exit(1); });
