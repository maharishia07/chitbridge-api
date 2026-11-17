/* floor-demo.cjs — A SHOP PC ON THIS MACHINE, so the floor can be tried by hand ([TILL-178b])
 *
 * Athi: *"is the changes reflects in localhost, if so, can you show the localhost please and i'll test the
 * settings, what is it for?"*
 *
 * This is the shop counter, and nothing else: it serves the counter page and it holds the floor. The rules it
 * applies are chitbridge-api/lib/orderhub.js — the same file tools/tally-connector/till.js requires, so what
 * is tried here is what a shop PC does, not a rehearsal of it.
 *
 * ── ⭐⭐⭐ THE LINE IS A SWITCH, WHICH IS THE WHOLE DEMONSTRATION ─────────────────────────────────────────
 *
 * Athi: *"the empty counter opens, when i try to sign-in, it has to open up the sign-in window, but it is not
 * opening"* — because the first draft refused every cloud call, so there was nothing to sign in TO. That was
 * the wrong shape: a shop PC does not pretend the internet never existed, it FORWARDS to it while it can and
 * carries on when it cannot. So this forwards /api/* to the real ChitBridge, exactly as till.js does.
 *
 * And then you pull the plug, live, from this address:
 *      http://127.0.0.1:<port>/line/off      the internet is gone — every /api call now fails
 *      http://127.0.0.1:<port>/line/on       it is back
 * The floor is untouched by either, which is the thing being shown. Sign in, load your shop, cut the line,
 * and keep serving tables.
 *
 *   node e2e/floor-demo.cjs [--port 7099] [--api <url>] [--offline]
 */
'use strict';
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const HUB = require('../../chitbridge-api/lib/orderhub');
const ROOT = path.join(__dirname, '..', 'public');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const i = process.argv.indexOf('--port');
const PORT = i > 0 ? Number(process.argv[i + 1]) : 7099;
const API = String(arg('api', 'https://chitbridge-api-production.up.railway.app')).replace(/\/+$/, '');
/** ⭐ the line, as a thing that can be switched — started up unless --offline says otherwise */
let LINE = !process.argv.includes('--offline');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };

const floor = HUB.create();
let cloudTried = 0;

const srv = http.createServer(async (q, r) => {
  const u = new URL(q.url, 'http://127.0.0.1');
  const J = (code, o) => { r.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)); };

  if (u.pathname === '/floor') return J(200, { on: true, orders: floor.orders.length, seq: floor.seq,
    open: floor.orders.filter((o) => o.state === 'open').length,
    cloud: 'not in the path — this PC is the floor' });
  if (u.pathname === '/floor/since') return J(200, HUB.since(floor, u.searchParams.get('seq')));
  if (u.pathname === '/floor/queue') return J(200, { lines: HUB.queue(floor, u.searchParams.get('station')) });
  if (u.pathname === '/floor/do' && q.method === 'POST') {
    let raw = ''; for await (const c of q) raw += c;
    let out; try { out = HUB.apply(floor, JSON.parse(raw || '{}')); }
    catch (_) { out = { ok: false, why: 'that was not readable' }; }
    console.log('  ' + (out.ok ? '✓' : '✗') + ' ' + (JSON.parse(raw || '{}').do || '?')
      + (out.order ? ('  ' + HUB.stations([]).length + ' table ' + out.order.subject) : '')
      + (out.ok ? '' : '  — ' + out.why));
    return J(out.ok ? 200 : 409, out);
  }
  /* ⭐ the line, switched by hand — this is the plug being pulled */
  if (u.pathname === '/line/off') { LINE = false; console.log('\n  ✂  THE LINE IS CUT. The floor carries on.\n'); return J(200, { line: false }); }
  if (u.pathname === '/line/on')  { LINE = true;  console.log('\n  ⚡ the line is back.\n'); return J(200, { line: true }); }

  /**
   * ⭐⭐ FORWARDED TO THE REAL CHITBRIDGE, exactly as tools/tally-connector/till.js does. A shop PC is a
   * PROXY while the line is up, which is how signing in and reading a catalogue work at all.
   * ⚠️ And when the line is cut it answers the way a dead line answers, so the counter's own queue takes over.
   */
  if (u.pathname.startsWith('/api/')) {
    if (!LINE) { cloudTried++; return J(503, { error: 'no line' }); }
    let body = ''; for await (const c of q) body += c;
    const t = new URL(API + q.url);
    const head = Object.assign({}, q.headers); delete head.host; delete head['content-length'];
    if (body) head['content-length'] = Buffer.byteLength(body);
    return new Promise((done) => {
      const up = (t.protocol === 'https:' ? https : http).request(t, { method: q.method, headers: head }, (ur) => {
        r.writeHead(ur.statusCode, Object.assign({}, ur.headers, { 'cache-control': 'no-store' }));
        ur.pipe(r).on('finish', done);
      });
      up.on('error', (e) => { console.log('  ! cloud: ' + e.message); J(502, { error: 'the line did not answer' }); done(); });
      if (body) up.write(body);
      up.end();
    });
  }

  const f = path.join(ROOT, decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'till.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
  r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
});

srv.listen(PORT, '127.0.0.1', () => {
  const at = 'http://127.0.0.1:' + PORT;
  console.log('\n  the shop counter is up → ' + at + '/till.html');
  console.log('  the floor lives here, the cloud is not running, and every /api call will be refused 503.\n');
  console.log('  Settings → What this counter is for = Order pad');
  console.log('  Settings → Shared with            = ' + at);
  console.log('\n  open that address in two or three windows and they are three devices in one shop.\n');
});
setInterval(() => {
  const open = floor.orders.filter((o) => o.state === 'open');
  if (open.length) console.log('  [floor] ' + open.length + ' open · ' + HUB.queue(floor).length
    + ' waiting in the kitchen · ' + cloudTried + ' cloud calls refused');
}, 15000).unref();
