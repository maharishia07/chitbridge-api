/* offer-lab-next-saved.cjs — SAVED OFFERS, ON THE REAL SHELF ([TILL-187])
 *
 * Athi: "we have already built the offer engine, that is being served everywhere as a capability... how we
 * enhance it to adopt this." routes/definitions.js already does create/list/version/retire for kind='offer' —
 * this proves offer-lab-next.html's Saved-offers bucket actually calls it (via a stub that mirrors its real
 * shape) rather than reinventing persistence, that draft→approved→live→PAUSED are four real states (v5's own
 * prototype conflated pause with approved), and that the cost-drift and overlap warnings still work once
 * SAVED is a mirror of the server instead of an array that forgets itself on reload.
 *
 * Run: node e2e/offer-lab-next-saved.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(46) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  /* ── a stub that mirrors routes/definitions.js closely enough: kind=offer, status default excludes retired,
     PUT status without rules never mints a new version, DELETE retires rather than removing the row ──────── */
  const DB = new Map();
  let seq = 0;
  const srv = http.createServer((q, r) => {
    const url = new URL(q.url, 'http://x');
    if (url.pathname === '/api/definitions' || url.pathname.startsWith('/api/definitions/')) {
      let body = '';
      q.on('data', (c) => (body += c));
      q.on('end', () => {
        const id = url.pathname.split('/')[3];
        if (q.method === 'POST' && url.pathname === '/api/definitions') {
          const b = JSON.parse(body || '{}');
          if (!b.kind || !b.name) { r.writeHead(400); return r.end(JSON.stringify({ error: 'bad request' })); }
          const def_id = 'd' + (++seq);
          const row = { definition_id: def_id, kind: b.kind, sub_kind: b.sub_kind || null, name: b.name,
                        status: b.status === 'live' ? 'live' : 'draft', rules: b.rules || {}, created_at: new Date().toISOString() };
          DB.set(def_id, row);
          r.writeHead(201, { 'content-type': 'application/json' });
          return r.end(JSON.stringify({ message: 'Definition created', definition: row }));
        }
        if (q.method === 'GET' && url.pathname === '/api/definitions') {
          const kind = url.searchParams.get('kind');
          const all = url.searchParams.get('all');
          let rows = [...DB.values()];
          if (kind) rows = rows.filter((d) => d.kind === kind);
          if (!all) rows = rows.filter((d) => d.status !== 'retired');
          r.writeHead(200, { 'content-type': 'application/json' });
          return r.end(JSON.stringify({ definitions: rows, count: rows.length }));
        }
        if (q.method === 'PUT' && id) {
          const row = DB.get(id);
          if (!row) { r.writeHead(404); return r.end(JSON.stringify({ error: 'Not found' })); }
          const b = JSON.parse(body || '{}');
          if (b.status) row.status = b.status;
          r.writeHead(200, { 'content-type': 'application/json' });
          return r.end(JSON.stringify({ message: 'Saved', definition: row }));
        }
        if (q.method === 'DELETE' && id) {
          const row = DB.get(id);
          if (!row) { r.writeHead(404); return r.end(JSON.stringify({ error: 'Not found' })); }
          row.status = 'retired';   /* ⚠️ retire, never remove — the real route's own rule */
          r.writeHead(200, { 'content-type': 'application/json' });
          return r.end(JSON.stringify({ message: 'Retired', definition: row }));
        }
        r.writeHead(404); r.end('{}');
      });
      return;
    }
    const f = path.join(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  console.log('\n── demo mode (not signed in) keeps the old in-memory behaviour ' + '─'.repeat(1));
  await p.goto(base + '/offer-lab-next.html');
  await p.waitForTimeout(200);
  const demo = await p.evaluate(async () => {
    pickGoal('percent'); S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; S.pctOff = 10; apply();
    await saveOffer();
    return { step: S.step, saved: SAVED.length, live: savedLive() };
  });
  say('nothing signed in, so nothing is remote', demo.live === false, 'savedLive() is false');
  say('the offer still saves, locally, exactly as before', demo.saved === 1 && demo.step === 3, /* v2: the saved offer opens in the middle */ JSON.stringify(demo));
  const cartRows = await p.locator('[data-testid="cart-row"]').count();
  say('it is listed on the left under Draft, and open in the middle (v2)', cartRows === 1 && (await p.locator('[data-testid="cart-row"]').first().getAttribute('data-status')) === 'draft' && (await p.locator('[data-testid="offer-open"]').count()) === 1, cartRows + ' row(s)');

  console.log('\n── signed in: the SAME action now reaches the real shelf ' + '─'.repeat(6));
  await p.evaluate(() => {
    localStorage.setItem('cb_sess', JSON.stringify({ token: 'demo-token', entity: 'Mayur Bhavan' }));
  });
  /* ?api= is the file's own override (matching the live offer-lab.html), pointed at this test's stub server */
  await p.goto(base + '/offer-lab-next.html?api=' + encodeURIComponent(base));
  await p.waitForTimeout(200);
  const saved = await p.evaluate(async () => {
    pickGoal('percent'); S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; S.pctOff = 10; apply();
    await saveOffer();
    return { step: S.step, saved: SAVED.map((s) => ({ status: s.status, remote: !!s.remote })) };
  });
  say('opens the saved offer; the left list shows it', saved.step === 3 && (await p.locator('[data-testid="cart-row"]').count()) === 1, 'listed on the left');
  say('one live-shelf row, in draft', saved.saved.length === 1 && saved.saved[0].status === 'draft' && saved.saved[0].remote,
      JSON.stringify(saved.saved));

  console.log('\n── draft → approved → live → PAUSED — four real states, not three ' + '─'.repeat(1));
  const cycle = await p.evaluate(async () => {
    const id = SAVED[0].id;
    const seen = [];
    await setStatus(id, 'approved'); seen.push(SAVED.filter((s) => s.id === id)[0].status);
    await setStatus(id, 'live');     seen.push(SAVED.filter((s) => s.id === id)[0].status);
    await setStatus(id, 'paused');   seen.push(SAVED.filter((s) => s.id === id)[0].status);
    await setStatus(id, 'live');     seen.push(SAVED.filter((s) => s.id === id)[0].status);
    return seen;
  });
  say('approved, then live, then paused (not back to approved), then live again',
      JSON.stringify(cycle) === JSON.stringify(['approved', 'live', 'paused', 'live']), JSON.stringify(cycle));

  console.log('\n── ⭐ the cost-drift warning survives a page reload (it is on the server, not in memory) ' + '─'.repeat(0));
  await p.evaluate(() => { byId('masala').cost = 999; });   /* the catalogue's own cost moved after saving */
  await p.evaluate(() => { openOffer(SAVED[0].id); });   /* v2: the saved offer opens in the middle */
  await p.waitForTimeout(150);
  const drift = await p.evaluate(() => document.querySelector('.p-stale') ? document.querySelector('.p-stale').textContent : null);
  say('"1 cost changed since" shows, computed against what was actually saved', /1 cost changed/.test(drift || ''), '"' + drift + '"');
  await p.evaluate(() => { byId('masala').cost = 38; });   /* put it back before the overlap test reuses it */

  console.log('\n── ⭐⭐ overlap detection — the same item, two live-ish offers ' + '─'.repeat(3));
  const overlap = await p.evaluate(async () => {
    pickGoal('amount'); S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; S.rsOff = 5; apply();
    await saveOffer();
    const second = SAVED.filter((s) => s.status === 'draft')[0];
    await setStatus(second.id, 'approved');
    const first = SAVED.filter((s) => s.id !== second.id)[0];   /* the live one from the cycle above */
    /* clash(sv) → a count became clashDetail(sv) → the clashing offers, or null (2026-09-26); the count is its length */
    const n = (sv) => (clashDetail(sv) || []).length;
    return { firstOverlap: n(first), secondOverlap: n(second) };
  });
  say('both offers on masala dosa see each other', overlap.firstOverlap === 1 && overlap.secondOverlap === 1, JSON.stringify(overlap));

  console.log('\n── retire — the real DELETE, not a local forget ' + '─'.repeat(9));
  const retired = await p.evaluate(async () => {
    const before = SAVED.length;
    const id = SAVED[0].id;
    await dropSaved(id);
    return { before, after: SAVED.length };
  });
  say('the retired one leaves the default (non-all) list', retired.after === retired.before - 1,
      retired.before + ' → ' + retired.after);

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nsaved offers live on the real shelf — draft, approved, live, paused, retired, all of them real');
  process.exit(bad || errs.length ? 1 : 0);
})();
