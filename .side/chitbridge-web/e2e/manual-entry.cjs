/* manual-entry.cjs — ＋ ENTRY ON THE DAY BOOK, PROVED (docs/design/manual-entry/CLOUD-TASK-web.md · REQUIREMENT.md).
 * Pattern: cb-accounts.cjs — Playwright, a stand-in API answering INSIDE the page; the static server takes a free port from the OS.
 * Nothing here reaches localhost:3000, port 7351 or any live site: every /api/** call is fulfilled by ctx.route, and any other host is aborted.
 * The page computes no money, so the STAND-IN is the engine: it composes the lines from the amount it is sent, names each line's type and
 * rule, and says `balanced`. The page must only show it.
 *
 *  1  the ＋ is on the Day book; it opens a sheet; the grid is the server's events, "Write a journal" is the last tile
 *  2  each event's flow (what → who/what → how much, when, paper → check) ends at the preview's lines (code · ledger · Dr · Cr, TYPE, RULE,
 *     voucher MJ with its kind) and Save posts to POST /api/books/events, once (the stand-in speaks the REAL shapes of chitbridge-api routes/books.js + lib/books-manual.js)
 *  3  Save is OFF while the server says the entry does not balance, and while it refuses anything
 *  4  a locked month is refused the moment the date is picked, with its fix button
 *  5  a double tap on Save posts once (one client_ref)
 *  6  Write a journal: free Dr/Cr lines, the server's verdict decides Save
 *  7  Reverse this entry on a Day book row: a plain confirm, then the mirror (POST /entries/:id/reverse) once
 *  8  every warning has its fix button; a refused save says so in plain words with Try again
 *  9  phone: 390 px is document.scrollWidth === 390 at every step; no "accounting" anywhere
 * Screenshots: e2e/shots/manual-entry-{grid,form,preview,saved,locked,journal}-{laptop,phone}.png
 * Playwright is not in the cloud image: `npm i @playwright/test` somewhere outside the repo and run with NODE_PATH=<that>/node_modules.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = process.env.ME_PUB || path.join(ROOT, 'public');        /* ME_PUB=<dir> runs against another copy (manual-entry-breaks.cjs) */
const SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
const TODAY = new Date().toISOString().slice(0, 10);
const SEC = { dr: 'Dr', cr: 'Cr' };

/* ── the stand-in speaks the REAL shapes (chitbridge-api routes/books.js + lib/books-manual.js; tests/books-preview.test.cjs) ── */
const MODES = ['cash', 'bank', 'upi', 'card'];
const F = {
  amount: { key: 'amount', kind: 'amount', required: true }, date: { key: 'date', kind: 'date', required: false, default: 'today' }, note: { key: 'narration', kind: 'text', required: false },
  paid: (key) => ({ key, kind: 'pick', pick: 'mode', options: MODES, required: true }),
};
const EVENTS = [
  { kind: 'expense', words: 'Pay expense', icon: 'receipt', band: 'paid', voucher: 'Payment', fields: [{ key: 'class', kind: 'pick', pick: 'expense_class', required: true }, F.amount, F.paid('paid_from'), F.date, F.note], preview: true, post: 'POST /events' },
  { kind: 'other_income', words: 'Other income', icon: 'coins', band: 'received', voucher: 'Receipt', fields: [{ key: 'class', kind: 'pick', pick: 'income_class', required: true }, F.amount, F.paid('into'), F.date, F.note], preview: true, post: 'POST /events' },
  { kind: 'capital', words: 'Put money in', icon: 'wallet-in', band: 'owner', voucher: 'Receipt', fields: [F.amount, F.paid('into'), F.date, F.note], preview: true, post: 'POST /events' },
  { kind: 'drawings', words: 'Took money out', icon: 'wallet-out', band: 'owner', voucher: 'Payment', fields: [F.amount, F.paid('from'), F.date, F.note], preview: true, post: 'POST /events' },
  { kind: 'staff_advance', words: 'Staff advance', icon: 'person-out', band: 'staff', voucher: 'Payment', fields: [{ key: 'ledger', kind: 'pick', pick: 'ledger', group: 'loans_advances_asset', required: true }, F.amount, F.paid('from'), F.date, F.note], preview: true, post: 'POST /events' },
  { kind: 'advance_recovered', words: 'Advance back', icon: 'person-in', band: 'staff', voucher: 'Receipt', fields: [{ key: 'ledger', kind: 'pick', pick: 'ledger', group: 'loans_advances_asset', required: true }, F.amount, F.paid('into'), F.date, F.note], preview: true, post: 'POST /events' },
  { kind: 'contra', words: 'Move money', icon: 'swap', band: 'money', voucher: 'Contra', fields: [F.paid('from'), F.paid('to'), F.amount, F.date, F.note], preview: true, post: 'POST /events' },
  { kind: 'journal', words: 'Write a journal', icon: 'pen', band: 'adjust', voucher: 'Journal', fields: [{ key: 'lines', kind: 'lines', required: true }, { key: 'narration', kind: 'text', required: true }, F.date], preview: true, post: 'POST /events' },
  { kind: 'asset', words: 'Bought an asset', icon: 'box', band: 'bought', route: 'POST /assets', preview: false },      /* has a route of its own: not on this sheet */
];
const PICKS = { mode: MODES, expense_class: [{ role: 'rent', code: '6010', name: 'Rent' }, { role: 'repairs', code: '6020', name: 'Repairs' }], income_class: [{ role: 'commission_received', code: '4200', name: 'Commission received' }], blocked_credit: ['food'] };
const ACCOUNTS = [['1400', 'Cash', 'cash'], ['1500', 'Bank', 'bank'], ['1510', 'UPI collections', 'upi'], ['1700', 'Advances to suppliers', 'supplier_advance'], ['1701', 'Advance - Ravi', null], ['1300', 'Customers (Sundry Debtors)', 'debtors'], ['2100', 'Suppliers (Sundry Creditors)', 'creditors'], ['3000', 'Capital', 'capital'], ['3100', 'Drawings', 'drawings'], ['4000', 'Sales', 'sales'], ['4200', 'Commission received', 'commission_received'], ['6010', 'Rent', 'rent'], ['6090', 'Bank charges', null]].map(([code, name, role]) => ({ code, name, role, is_group: false }));
const NAME = Object.fromEntries(ACCOUNTS.map((a) => [a.code, a.name]));
const TYPE = (c) => (/^(1300|2100|1[78]|3)/.test(c) ? 'personal' : /^[456]/.test(c) ? 'nominal' : 'real');
const GOLDEN = { personal: { dr: 'Dr the receiver', cr: 'Cr the giver' }, real: { dr: 'Dr what comes in', cr: 'Cr what goes out' }, nominal: { dr: 'Dr expenses and losses', cr: 'Cr incomes and gains' } };
const L = (code, dr, cr) => ({ code, ledger: NAME[code], dr_minor: dr, cr_minor: cr, type: TYPE(code), rule: GOLDEN[TYPE(code)][dr ? 'dr' : 'cr'] });
const MODE_CODE = { cash: '1400', bank: '1500', upi: '1510', card: '1500' };
const KIND = Object.fromEntries(EVENTS.map((e) => [e.kind, e.voucher]));

/* the stand-in IS the engine: it composes the journal from what it is sent, as POST /api/books/preview answers it */
function compose(b, S) {
  const k = b.event, a = b.amount_minor || 0;
  const out = { ok: false, kind: k, voucher: null, date: b.date || TODAY, lines: [], balanced: false, totals: { dr_minor: 0, cr_minor: 0 }, credit: null, bill: null, flags: [], refusals: [], code: null, duplicate: null };
  if (k !== 'journal' && !a) { out.refusals.push('How much was it?'); return out; }
  if (locked(b.date)) { out.refusals.push('This month is locked. Open it again (with a reason), or pick another date.'); out.code = 'PERIOD_LOCKED'; return out; }
  let lines;
  if (k === 'journal') lines = (b.lines || []).map((l) => L(l.code, l.dr_minor || 0, l.cr_minor || 0));
  else if (k === 'expense') lines = [L('6010', a, 0), L(MODE_CODE[b.paid_from] || '1400', 0, a)];
  else if (k === 'other_income') lines = [L(MODE_CODE[b.into] || '1400', a, 0), L('4200', 0, a)];
  else if (k === 'capital') lines = [L(MODE_CODE[b.into] || '1400', a, 0), L('3000', 0, a)];
  else if (k === 'drawings') lines = [L('3100', a, 0), L(MODE_CODE[b.from] || '1400', 0, a)];
  else if (k === 'staff_advance') lines = [L(b.ledger || '1701', a, 0), L(MODE_CODE[b.from] || '1400', 0, a)];
  else if (k === 'advance_recovered') lines = [L(MODE_CODE[b.into] || '1400', a, 0), L(b.ledger || '1701', 0, a)];
  else lines = [L(MODE_CODE[b.to] || '1500', a, 0), L(MODE_CODE[b.from] || '1400', 0, a)];
  if (S.skew) lines[0].dr_minor += 100;
  out.lines = lines; out.voucher = { series: 'MJ', type: KIND[k] || 'Journal' };
  out.totals = { dr_minor: lines.reduce((s, l) => s + l.dr_minor, 0), cr_minor: lines.reduce((s, l) => s + l.cr_minor, 0) };
  out.balanced = out.totals.dr_minor === out.totals.cr_minor;
  if (S.skew && !S.quiet) out.refusals.push('Debit and credit are not the same.');
  if (S.refuse) out.refusals.push('This ledger cannot take this entry.');
  if (S.flag && k === 'expense') out.flags.push('The GST on food and drink is not claimable (s.17(5)). It goes into the expense.');
  out.ok = out.balanced && !out.refusals.length;
  return out;
}
const locked = (d) => String(d || '') < '2025-01-01';
/* an entry as GET /api/books/daybook sends it: a manual entry has NO source (null); a walk-in day's source carries every key */
const LN = (code, name, dr, cr) => ({ code, name, party_id: null, party_name: null, dr_minor: dr, cr_minor: cr, counter: null });
const DAYSRC = { chit_id: null, ref: null, kind: 'day', counter: 'C1', by: null, count: 11, how: 'Cash', how_ref: null, split: [{ how: 'Cash', amount_minor: 124000 }], doc_at: null, recorded_at: '2026-10-03T05:00:00.000Z' };
/* books.entry() adds the keys the API always sends on a day-book row that the rows below do not carry (reversed_by, reversed_by_id, lines[].rate) */
const ENTRIES = [
  { entry_id: 'mj9', entry_no: 'MJ/2026-27/000009', posting_date: TODAY, doc_date: TODAY, event_type: 'manual', source_chit_id: null, reverses_entry_id: null, narration: 'Rent paid', source: null, lines: [LN('6010', 'Rent', 1000000, 0), LN('1400', 'Cash', 0, 1000000)] },
  { entry_id: 'je1', entry_no: 'JV/2026-27/000001', posting_date: TODAY, doc_date: TODAY, event_type: 'walkin_day', source_chit_id: null, reverses_entry_id: null, narration: 'Walk-in sales', source: DAYSRC, lines: [LN('1400', 'Cash', 124000, 0), LN('4000', 'Sales', 0, 124000)] },
  { entry_id: 'rv1', entry_no: 'MJ/2026-27/000008', posting_date: TODAY, doc_date: TODAY, event_type: 'reversal', source_chit_id: null, reverses_entry_id: 'mj7', narration: 'Reversal of MJ/2026-27/000007', source: null, lines: [LN('1400', 'Cash', 500, 0), LN('6090', 'Bank charges', 0, 500)] },
].map((e) => books.entry(e));

function standIn() {
  return { calls: [], saves: [], reverses: [], previews: [], skew: false, quiet: false, refuse: false, flag: false, failSave: false, delay: 0 };
}
async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  S.calls.push(m + ' ' + p);
  const body = () => { try { return JSON.parse(q.postData() || '{}'); } catch (_) { return {}; } };
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' } });
  if (p === '/api/folders') return J(r, 200, { folders: [] });
  if (!p.startsWith('/api/books')) return J(r, m === 'GET' ? 200 : 200, m === 'GET' ? {} : { ok: true });
  if (p === '/api/books/health') return J(r, 200, books.health());
  if (p === '/api/books/accounts') return J(r, 200, { accounts: ACCOUNTS.map((a) => Object.assign({ account_id: 'acc-' + a.code, tally_group: 'Group', nature: 'asset', parent_code: 'G1000', active: true }, a)) });
  if (p === '/api/books/events' && m === 'GET') return J(r, 200, { events: EVENTS.map((e) => Object.assign({ ledger_group: null }, e)), picks: Object.assign({ debit_reason: [] }, PICKS), pending: [], golden: GOLDEN });
  if (p === '/api/books/events' && m === 'POST') { const b0 = body(); S.saves.push({ path: p, body: b0 }); await new Promise((z) => setTimeout(z, S.delay)); if (S.failSave) return J(r, 500, { error: 'Server error' }); return J(r, 200, { ok: true, kind: b0.event, entry_id: 'mj' + S.saves.length, entry_no: 'MJ/2026-27/00000' + S.saves.length, posting_date: b0.date || TODAY, doc_date: b0.date || TODAY, moved: false, lines: 2, items: 0, note: null }); }
  if (p === '/api/books/preview') { const b = body(); S.previews.push(b); return J(r, 200, compose(b, S)); }
  let x;
  if ((x = p.match(/^\/api\/books\/entries\/([^/]+)\/reverse$/))) { S.reverses.push({ id: x[1], body: body() }); await new Promise((z) => setTimeout(z, S.delay));
    /* the API refuses a reversal with no reason (lib/books B.reverseEntry: "A reversal needs a reason.", 422) */
    if (!String(body().reason || '').trim()) return J(r, 422, { error: 'A reversal needs a reason.', message: 'A reversal needs a reason.' });
    return J(r, 200, { ok: true, entry_id: 'mj10', entry_no: 'MJ/2026-27/000010', posting_date: TODAY, moved: false, reverses: 'MJ/2026-27/000009', reverses_entry_id: x[1], items: 0, reopened: [], words: 'Reversed MJ/2026-27/000009 — ₹10,000 — by MJ/2026-27/000010.' }); }
  if (p === '/api/books/daybook') return J(r, 200, books.daybook(ENTRIES, { from: TODAY, to: TODAY }));
  if (p === '/api/books/dues') return J(r, 200, books.dues([
    { party_id: 'c1', party_no: 'P-00001', name: 'Ravi Stores', side: 'customer', balance_minor: 300000, oldest_due: '2026-08-01', buckets: { not_due: 0, lt_6m: 300000, m6_1y: 0, y1_2: 0, y2_3: 0, gt_3y: 0 } },
    { party_id: 's1', party_no: 'P-00003', name: 'Agro Mills', side: 'supplier', balance_minor: -150000, oldest_due: '2026-09-03', buckets: { not_due: -150000, lt_1y: 0, y1_2: 0, y2_3: 0, gt_3y: 0 } }], { asOf: TODAY }));
  if (p === '/api/books/cheques') return J(r, 200, { currency: 'INR', asOf: TODAY, cheques: [], pdc_reminders: [], remind: { on: true, lead_days: 7, from: null, may_set: true, why_not: null } });
  if (p === '/api/books/periods') return J(r, 200, books.periods([]));
  return J(r, 404, { error: 'no stand-in for ' + p });
}


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
  const b = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
  const threw = [], offHost = [];
  const tokFor = (c) => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
  const OWNER = { token: tokFor({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };

  async function open(S, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: o.viewport || { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/accounts.html');
    /* CB Accounts opens on To do (web #41): the Day book, where ＋ Entry lives, is one tap in */
    await p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 15000 }); await p.click('[data-testid="acc-nav-daybook"]');
    await p.waitForSelector('[data-testid="db-add"]', { timeout: 15000 });
    return { ctx, p };
  }
  const sw = (p) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, dlg: (document.getElementById('en_body') || {}).scrollWidth || 0, dcw: (document.getElementById('en_body') || {}).clientWidth || 0 }));
  const shot = (p, n, tag) => p.screenshot({ path: path.join(SHOTS, 'manual-entry-' + n + '-' + tag + '.png') });
  const t = (p, id) => p.locator('[data-testid="' + id + '"]');
  const OFFERED = EVENTS.filter((e) => e.preview !== false);
  const stepOf = (f) => (f.kind === 'lines' || (f.kind === 'pick' && f.pick !== 'mode') ? 2 : 3);
  /* fill whatever the event asks, the way a person would: only the fields the event lists */
  async function fillStep(p, ev, step) {
    for (const f of ev.fields) {
      if (stepOf(f) !== step) continue;
      const el = t(p, 'en-f-' + f.key);
      if (f.kind === 'amount') await el.fill('1500');
      else if (f.kind === 'date') await el.fill(TODAY);
      else if (f.kind === 'pick') await el.selectOption({ index: f.key === 'to' ? 2 : 1 });
    }
  }
  async function flow(p, ev, o) {
    o = o || {};
    await t(p, 'en-event-' + ev.kind).click();
    const has2 = ev.fields.some((f) => stepOf(f) === 2);
    if (has2) { await t(p, 'en-step-2').waitFor(); await fillStep(p, ev, 2); ok(!/\[object|undefined|NaN/.test(await p.evaluate(() => document.getElementById('en_body').innerText)), ev.kind + ': step 2 prints no stray [object Object] / undefined / NaN'); if (o.shot) await shot(p, 'form', o.tag); await t(p, 'en-next').click(); }
    await t(p, 'en-step-3').waitFor(); await fillStep(p, ev, 3);
    ok(!/\[object|undefined|NaN/.test(await p.evaluate(() => document.getElementById('en_body').innerText)), ev.kind + ': step 3 prints no stray [object Object] / undefined / NaN');
    if (!has2 && o.shot) await shot(p, 'form', o.tag);
    await t(p, 'en-next').click();
    await t(p, 'en-step-4').waitFor(); await p.waitForSelector('[data-testid^="en-pline-"]');
  }

  /* ── the page's own source ── */
  {
    const src = fs.readFileSync(path.join(PUB, 'app/cap-entry.js'), 'utf8');
    ok(!/\balert\s*\(/.test(src), 'no alert() in cap-entry.js');
    ok(!/accounting|books of account/i.test(src.replace(/^\/\*[\s\S]*?\*\//, '')), 'cap-entry.js paints neither forbidden string');
  }

  /* ── 1 · the door, the grid ───────────────────────────────────────────────────────────────────── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    ok(await t(p, 'db-add').isVisible(), 'the ＋ Entry is on the Day book');
    await t(p, 'db-add').click(); await p.waitForSelector('[data-testid^="en-event-"]');
    const ids = await p.$$eval('[data-testid^="en-event-"]', (e) => e.map((x) => x.getAttribute('data-testid').slice(9)));
    ok(JSON.stringify(ids) === JSON.stringify(OFFERED.map((e) => e.kind)), 'the grid is the server\'s events (those the sheet can preview and save), Write a journal LAST: ' + ids.join(' · '));
    ok(!ids.includes('asset'), 'an event with a route of its own (Bought an asset) is not on this sheet');
    ok(/Pay expense/.test(await t(p, 'en-event-expense').innerText()) && /\S/.test((await t(p, 'en-event-expense').innerText()).split('\n')[0]), 'a tile is an icon and the server\'s words');
    ok(S.calls.some((c) => c === 'GET /api/books/events'), 'the events came from GET /api/books/events');
    await shot(p, 'grid', 'laptop');
    ok(await p.evaluate(() => !!document.querySelector('.cbl')) && await p.evaluate(() => !!document.getElementById('entrysheet')), 'the sheet is over the Day book, which is still a CBList mount');

    /* ── 2 · each event ends at the preview, the one save door is called once ── */
    await t(p, 'en-close').click();
    for (const ev of OFFERED.filter((e) => e.kind !== 'journal')) {
      await t(p, 'db-add').click(); await p.waitForSelector('[data-testid="en-event-' + ev.kind + '"]');
      await flow(p, ev, { shot: ev.kind === 'expense', tag: 'laptop' });
      const rows = await p.$$eval('[data-testid^="en-pline-"]', (e) => e.map((x) => x.innerText));
      ok(rows.length === 2 && rows.every((r) => /\d{4}/.test(r)), ev.kind + ': the preview shows two lines, each with its code and ledger (' + rows.length + ')');
      ok(rows.every((r) => r.includes('1,500.00')) && rows.filter((r) => r.includes('1,500.00')).length === 2, ev.kind + ': every figure is the one the server sent (₹1,500.00 on each line)');
      ok(await p.$$eval('[data-testid^="en-ptype-"]', (e) => e.length === 2 && e.every((x) => /personal|real|nominal/.test(x.textContent))), ev.kind + ': every line names its type (personal / real / nominal)');
      ok(await p.$$eval('[data-testid^="en-prule-"]', (e) => e.length === 2 && e.every((x) => /(Dr|Cr) (the|what|expenses|incomes)/.test(x.textContent))), ev.kind + ': every line names the golden rule that placed it');
      const vt = await t(p, 'en-voucher').innerText();
      ok(/^MJ · /.test(vt) && vt.includes(ev.voucher), ev.kind + ': the voucher is MJ with its kind (' + vt + ')');
      ok(await t(p, 'en-balanced').count() === 1 && await t(p, 'en-save').isEnabled(), ev.kind + ': the server said balanced, Save is on');
      if (ev.kind === 'expense') await shot(p, 'preview', 'laptop');
      const n0 = S.saves.length; await t(p, 'en-save').click(); await t(p, 'en-saved').waitFor();
      ok(S.saves.length === n0 + 1 && S.saves[S.saves.length - 1].path === '/api/books/events', ev.kind + ': Save posted once to POST /api/books/events');
      const sv = S.saves[S.saves.length - 1].body;
      ok(sv.event === ev.kind && sv.amount_minor === 150000 && /^web-/.test(sv.client_ref || ''), ev.kind + ': the body carries the event, the amount in minor units (150000) and one client_ref');
      if (ev.kind === 'expense') await shot(p, 'saved', 'laptop');
      ok(/MJ\/2026-27\//.test(await t(p, 'en-saved-no').innerText()), ev.kind + ': the saved entry shows its MJ number');
      await t(p, 'en-done').click();
    }
    const pv = S.previews.filter((x) => x.event === 'contra' && x.amount_minor)[0];
    ok(pv && pv.from === 'cash' && pv.to === 'bank' && pv.amount_minor === 150000, 'the preview is asked with the server\'s own field keys (from · to · amount_minor)');
    ok(!S.calls.some((c) => /localhost:3000|:7351/.test(c)), 'nothing left the stand-in');

    /* ── 8 · a warning has its fix ── */
    S.flag = true; await t(p, 'db-add').click(); await flow(p, EVENTS[0], {});
    const w = await p.$$eval('[data-testid^="en-warning-"]', (e) => e.map((x) => !!x.querySelector('button')));
    ok(w.length === 1 && w.every(Boolean), 'a GST warning is shown and it has its fix button');
    await t(p, 'en-wfix-FLAG0').click(); await t(p, 'en-step-2').waitFor();
    ok(true, 'the fix button takes the person back to the form');
    await t(p, 'en-close').click();
    await ctx.close();
  }

  /* ── 3 · not balanced → Save off ── */
  {
    const S = standIn(); S.skew = true; const { ctx, p } = await open(S);
    await t(p, 'db-add').click(); await flow(p, EVENTS[6], {});
    ok(await t(p, 'en-unbalanced').count() === 1 && await t(p, 'en-save').isDisabled(), 'unbalanced: the server says so and Save is OFF');
    ok(await t(p, 'en-fix-R0').count() === 1, 'the refusal has its fix button');
    await t(p, 'en-save').click({ force: true, timeout: 1500 }).catch(() => {});
    ok(S.saves.length === 0, 'unbalanced: nothing was posted');
    await ctx.close();
  }
  /* the server may say "not balanced" WITHOUT a refusal, or refuse a balanced journal: either one alone keeps Save off */
  {
    const S = standIn(); S.skew = true; S.quiet = true; const { ctx, p } = await open(S);
    await t(p, 'db-add').click(); await flow(p, EVENTS[6], {});
    ok(await t(p, 'en-unbalanced').count() === 1 && await t(p, 'en-save').isDisabled(), 'unbalanced with no refusal named: Save is still OFF');
    await ctx.close();
  }
  {
    const S = standIn(); S.refuse = true; const { ctx, p } = await open(S);
    await t(p, 'db-add').click(); await flow(p, EVENTS[6], {});
    ok(await t(p, 'en-balanced').count() === 1 && await t(p, 'en-save').isDisabled() && await t(p, 'en-fix-R0').count() === 1, 'balanced but refused: Save is OFF and the refusal has its fix button');
    await ctx.close();
  }

  /* ── 4 · locked month ── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await t(p, 'db-add').click(); await t(p, 'en-event-capital').click(); await t(p, 'en-step-3').waitFor();
    await t(p, 'en-f-amount').fill('500'); await t(p, 'en-f-into').selectOption('cash'); await t(p, 'en-f-date').fill('2020-01-15');
    await t(p, 'en-refusal-PERIOD_LOCKED').waitFor();
    ok(await t(p, 'en-next').isDisabled(), 'a locked month is refused as soon as the date is picked (Next is off)');
    ok(S.previews.some((x) => x.date === '2020-01-15') && S.previews.every((x) => !x.lines), 'the refusal came from the server, at the date, not from the page');
    ok(/Pick another date/.test(await t(p, 'en-fix-PERIOD_LOCKED').innerText()), 'the refusal has its fix button');
    await shot(p, 'locked', 'laptop');
    await t(p, 'en-fix-PERIOD_LOCKED').click();
    await t(p, 'en-f-date').fill(TODAY); await p.waitForFunction(() => !document.querySelector('[data-testid="en-refusal-PERIOD_LOCKED"]'));
    ok(await t(p, 'en-next').isEnabled(), 'a good date lifts the refusal and Next is on again');
    await ctx.close();
  }

  /* ── 5 · double tap posts once ── */
  {
    const S = standIn(); S.delay = 500; const { ctx, p } = await open(S);
    await t(p, 'db-add').click(); await flow(p, EVENTS[1], {});
    /* two taps in the same instant — the button's own disabling must not be the only thing standing in the way */
    await p.evaluate(() => { const b = document.querySelector('[data-testid="en-save"]'); b.click(); b.click(); }); await t(p, 'en-saved').waitFor();
    ok(S.saves.length === 1, 'a double tap on Save posted once (' + S.saves.length + ')');
    /* a failed save says so, and Try again posts with the SAME client_ref */
    await t(p, 'en-done').click();
    S.failSave = true; S.delay = 0; await t(p, 'db-add').click(); await flow(p, EVENTS[1], {});
    await t(p, 'en-save').click(); await t(p, 'en-refusal-SAVE').waitFor();
    ok(/Could not|Server|try/i.test(await t(p, 'en-refusal-SAVE').innerText()) && await t(p, 'en-fix-SAVE').count() === 1, 'a failed save is said in plain words with Try again');
    S.failSave = false; await t(p, 'en-fix-SAVE').click(); await p.waitForSelector('[data-testid="en-save"]:not([disabled])'); await t(p, 'en-save').click(); await t(p, 'en-saved').waitFor();
    const refs = S.saves.slice(1).map((x) => x.body.client_ref);
    ok(refs.length === 2 && refs[0] === refs[1], 'Try again sends the same client_ref, so the server answers with what it already kept');
    await ctx.close();
  }

  /* ── 6 · Write a journal ── */
  {
    const S = standIn(); const { ctx, p } = await open(S);
    await t(p, 'db-add').click(); await t(p, 'en-event-journal').click(); await t(p, 'en-step-2').waitFor();
    ok(await t(p, 'en-next').isDisabled(), 'journal: Next is off until every line has a ledger and an amount');
    await t(p, 'en-line-code-0').selectOption('6090'); await t(p, 'en-line-amt-0').fill('250'); await t(p, 'en-line-side-0').selectOption('dr');
    await t(p, 'en-line-code-1').selectOption('1500'); await t(p, 'en-line-amt-1').fill('250'); await t(p, 'en-line-side-1').selectOption('cr');
    await t(p, 'en-line-add').click(); ok(await p.locator('[data-testid^="en-line-code-"]').count() === 3, 'journal: lines can be added');
    await t(p, 'en-line-del-2').click();
    await shot(p, 'journal', 'laptop');
    await t(p, 'en-next').click(); await t(p, 'en-step-3').waitFor();
    ok(await t(p, 'en-next').isDisabled(), 'journal: Next is off until the note is written (the server asks for it)');
    await t(p, 'en-f-narration').fill('Correct a mis-posting'); await t(p, 'en-next').click(); await t(p, 'en-step-4').waitFor(); await p.waitForSelector('[data-testid^="en-pline-"]');
    const jb = S.previews.filter((x) => x.event === 'journal' && x.lines && x.narration).pop();
    ok(jb && jb.lines.length === 2 && jb.lines[0].dr_minor === 25000 && jb.lines[1].cr_minor === 25000 && jb.lines[0].cr_minor === undefined, 'journal: the lines go to the server as typed, the way it reads them (dr_minor 25000 · cr_minor 25000)');
    ok(/^MJ · Journal/.test(await t(p, 'en-voucher').innerText()), 'journal: MJ shown with its kind');
    ok(await t(p, 'en-save').isEnabled(), 'journal: balanced by the server, Save is on');
    await t(p, 'en-back').click(); await t(p, 'en-back').click(); await t(p, 'en-line-amt-1').fill('240'); S.skew = true;
    await t(p, 'en-next').click(); await t(p, 'en-f-narration').fill('Correct a mis-posting'); await t(p, 'en-next').click(); await t(p, 'en-unbalanced').waitFor();
    ok(await t(p, 'en-save').isDisabled(), 'journal: when the server says it does not balance, Save is OFF');
    await ctx.close();
  }

  /* ── 7 · Reverse this entry ── */
  {
    const S = standIn(); S.delay = 300; const { ctx, p } = await open(S);
    await t(p, 'db-expand-all').click();   /* a row's details open the way every Day book row's do */
    await p.waitForSelector('[data-testid="db-reverse"]');
    const n = await p.locator('[data-testid="db-reverse"]').count();
    ok(n === 2, 'a Day book row offers Reverse this entry — but not a reversal itself (' + n + ' of 3 rows)');
    await p.locator('[data-testid="db-reverse"]').first().click();
    await t(p, 'confirm').waitFor();
    ok(/Reverse this entry\?/.test(await t(p, 'confirm').innerText()) && S.reverses.length === 0, 'a plain confirm asks first; nothing is posted yet');
    await t(p, 'confirm-ok').click(); await p.waitForTimeout(600);
    ok(S.reverses.length === 1 && S.reverses[0].id === 'mj9' && /^web-/.test(S.reverses[0].body.client_ref || '') && String(S.reverses[0].body.reason || '').length > 3, 'Reverse posts the mirror once, to /entries/mj9/reverse, with a client_ref AND a reason (the API refuses a reversal without one: 422)');
    ok(await p.evaluate(() => /MJ\/2026-27\/000010/.test(document.body.innerText)), 'the new entry number is told');
    await ctx.close();
  }

  /* ── 9 · phone: 390 px at every step ── */
  {
    const S = standIn(); const { ctx, p } = await open(S, { viewport: { width: 390, height: 844 } });
    let w = await sw(p); ok(w.sw === 390, 'phone: the Day book itself is 390 px (' + w.sw + ')');
    await t(p, 'db-add').click(); await p.waitForSelector('[data-testid^="en-event-"]'); await p.waitForTimeout(150);
    w = await sw(p); ok(w.sw === 390 && w.dlg <= w.dcw + 1, 'phone: the grid, scrollWidth === 390 (' + w.sw + ', sheet body ' + w.dlg + '/' + w.dcw + ')');
    ok(await p.$$eval('[data-testid^="en-event-"]', (e) => e.every((x) => x.getBoundingClientRect().height >= 44 && x.getBoundingClientRect().right <= 390)), 'phone: every tile is a 44 px+ target inside the screen');
    await shot(p, 'grid', 'phone');
    await t(p, 'en-event-expense').click(); await t(p, 'en-step-2').waitFor(); w = await sw(p); ok(w.sw === 390, 'phone: step 2, scrollWidth === 390');
    await t(p, 'en-f-class').selectOption('rent'); await shot(p, 'form', 'phone'); await t(p, 'en-next').click();
    await t(p, 'en-step-3').waitFor(); w = await sw(p); ok(w.sw === 390, 'phone: step 3, scrollWidth === 390');
    await t(p, 'en-f-amount').fill('1500'); await t(p, 'en-f-paid_from').selectOption('cash'); await t(p, 'en-f-date').fill('2020-02-02'); await t(p, 'en-refusal-PERIOD_LOCKED').waitFor();
    await shot(p, 'locked', 'phone'); await t(p, 'en-f-date').fill(TODAY); await p.waitForFunction(() => !document.querySelector('[data-testid="en-refusal-PERIOD_LOCKED"]'));
    await t(p, 'en-next').click(); await t(p, 'en-step-4').waitFor(); await p.waitForSelector('[data-testid^="en-pline-"]'); w = await sw(p); ok(w.sw === 390 && w.dlg <= w.dcw + 1, 'phone: the preview, scrollWidth === 390 (' + w.sw + ')');
    await shot(p, 'preview', 'phone');
    await t(p, 'en-save').click(); await t(p, 'en-saved').waitFor(); w = await sw(p); ok(w.sw === 390, 'phone: saved, scrollWidth === 390'); await shot(p, 'saved', 'phone');
    await t(p, 'en-done').click();
    await t(p, 'db-add').click(); await t(p, 'en-event-journal').click(); await t(p, 'en-step-2').waitFor();
    await t(p, 'en-line-add').click(); w = await sw(p); ok(w.sw === 390 && w.dlg <= w.dcw + 1, 'phone: the journal lines, scrollWidth === 390 (' + w.sw + ')'); await shot(p, 'journal', 'phone');
    ok(!/accounting|books of account/i.test(await p.evaluate(() => document.body.innerText)), 'phone: "accounting" appears nowhere');
    await ctx.close();
  }

  ok(...C.finish());
  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  ok(offHost.length === 0, 'nothing tried to leave for another host' + (offHost.length ? ': ' + offHost[0] : ''));
  await b.close(); srv.close();
  console.log('\nmanual-entry: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
