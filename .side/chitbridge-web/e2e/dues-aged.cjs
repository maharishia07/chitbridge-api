/* dues-aged.cjs — W21: THE WORDING OF A FIRM'S "WHO OWES WHOM" HEADINGS: a firm reads "Customers owe <client>" / "<client> owes suppliers"; the owner's own voice stays "Customers owe you" / "You owe suppliers" (no client named).
 *  Calls the page's one voice function (CBBooksGrantView.duesVoice) in a real browser; the rendered aged table, the total row and the 1366 / 390 fit are proved on a box against the real api by e2e/dues-aged-live.cjs. */
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public'), SHOTS = process.env.OUT || path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const books = require('./lib/books-api.cjs');
const C = require('./lib/contract.cjs');   /* every answer the stand-in serves for a route in the api contract is checked (e2e/contract.cjs holds this) */
const json = (r, status, o) => C.json(r, status, o);
const tok = (c) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return e({ alg: 'none' }) + '.' + e(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)); };
const FIRM = { token: tok({ identity_id: 'ent-FIRM', identity_type: 'entity' }), role: 'entity', name: 'Pat Accountant', entity: 'Blue Gum Books', country: 'AU', currency: 'AUD' };
const CLIENT = 'ent-CL', NAME = 'Eastlake Fresh';
const Z = { not_due: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, worst: null, no_terms_minor: 0, terms: 'ok' };
const fu = (o) => Object.assign({}, Z, o);
const party = (id, name, side, balance, f) => ({ party_id: id, name, side, balance_minor: balance, oldest_due: '2026-08-01', disputed_minor: 0, buckets: {}, follow_up: fu(f) });
const DUES = { currency: 'AUD', asOf: '2026-11-16', total_minor: 65000, parties: [
  party('p1', 'Ravi', 'customer', 20000, { d0_30: 10000, d31_60: 10000 }), party('p2', 'Mei', 'customer', 25000, { not_due: 10000, d90_plus: 15000 }), party('p3', 'Zed', 'customer', 50000, { d61_90: 50000 }),
  party('p4', 'Anand', 'supplier', -30000, { d90_plus: 30000 }) ],
  aged_totals: { customer: Object.assign(fu({ not_due: 10000, d0_30: 10000, d31_60: 10000, d61_90: 50000, d90_plus: 15000 }), { balance_minor: 95000 }), supplier: Object.assign(fu({ d90_plus: 30000 }), { balance_minor: -30000 }) } };
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
  const G = { grant_id: 'g1', grantor_entity: CLIENT, grantor_name: NAME, preset: 'auditor', state: 'live', revoked_at: null, ended_at: null };
  async function open(width, height, hash) {
    const ctx = await b.newContext({ viewport: { width, height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.clock.setFixedTime(new Date('2026-11-16T10:00:00+11:00'));
    await ctx.route('**/api/**', (r) => {
      const p = new URL(r.request().url()).pathname;
      if (p === '/api/entities/me') return json(r, 200, { entity: { display_name: NAME, currency_code: 'AUD' } });
      if (p === '/api/books-grants') return json(r, 200, { given: [], received: [G] });
      if (p === '/api/books/health') return json(r, 200, Object.assign(books.health(), { currency: 'AUD', year: { fiscal_year: '2026-27', from: '2026-07-01', start_month: 7 }, country: books.csStatus('AU', 'Australia') }));
      if (p === '/api/books/dues') return json(r, 200, DUES);
      if (p === '/api/books/daybook') return json(r, 200, books.daybook([], { currency: 'AUD', country: 'AU' }));
      if (p === '/api/books/todo') return json(r, 200, []);
      if (p === '/api/network-offers') return json(r, 200, C.example('GET /api/network-offers'));
      return json(r, 200, {});
    });
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, FIRM);
    const p = await ctx.newPage(), threw = [];
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/network.html' + hash); /* the page that loads the firm's books view; the voice function needs no client open */
    await p.waitForFunction(() => window.CBBooksGrantView, null, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(2000);
    return { ctx, p, threw };
  }
  const text = (p, sel) => p.locator(sel).innerText().then((t) => t.replace(/\s+/g, ' '));
  { /* the owner's own voice: no client named */
    const { ctx, p } = await open(1366, 768, '');
    const v = await p.evaluate(() => window.CBBooksGrantView.duesVoice(''));
    ok(v.customer === 'Customers owe you' && v.supplier === 'You owe suppliers', 'owner voice stays "Customers owe you" / "You owe suppliers"');
    const f = await p.evaluate(() => window.CBBooksGrantView.duesVoice('Acme Ltd'));
    ok(f.customer === 'Customers owe Acme Ltd' && f.supplier === 'Acme Ltd owes suppliers', 'firm voice names the client');
    await ctx.close();
  }
  ok(...C.finish());
  await b.close(); srv.close();
  console.log('\n' + (fail ? 'FAIL' : 'all ok') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
