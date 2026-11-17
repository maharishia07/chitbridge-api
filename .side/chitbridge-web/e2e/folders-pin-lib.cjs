/* folders-pin-lib.cjs (MNT-59 pin) — the shared harness of the three browser legs of the Folders pin: a static server over public/ on a free port, a signed-in
 * context with a stand-in API (nothing leaves the machine), and the request log the legs assert on.
 * OWNS      server(), signedContext(), the stand-in replies for the Folders endpoints, the pass/fail counters.
 * CALLED BY e2e/folders-typeof.cjs · e2e/folders-tabs.cjs · e2e/folders-offline.cjs.
 * FLOW      serve public/ ──▶ chromium context (session token in localStorage, /api/** answered here) ──▶ the leg drives a page and reads S.calls
 * FOLDERS_ROOT=<dir of public> runs a leg against another checkout (the red-first run). */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.FOLDERS_ROOT || path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const FOLDER = { folder_id: 'c0000000-0000-4000-8000-00000000000b', parent_id: null, name: 'Urgent', scope: 'task', kind: 'filed', count: 1 };
const RULE = { rule_id: 'r0000000-0000-4000-8000-000000000001', folder_id: FOLDER.folder_id, name: 'Chola orders', enabled: true, when: { sender: 'Chola' }, match_count: 2, sort: 0 };
const RULE2 = { rule_id: 'r0000000-0000-4000-8000-000000000002', folder_id: FOLDER.folder_id, name: 'Fuel bills', enabled: true, when: { subject: 'fuel' }, match_count: 0, sort: 1 };
const CHIT = { chit_id: 'ord1', purpose: 'order', manual_subject: 'Order from Chola', sender_entity_display_name: 'Chola Auto Care', current_status: 'pending', created_at: '2026-10-01T04:00:00Z', summary_json: {}, all_recipients: [] };
const MEASURE = { count: 3, open: 2, closed: 1, unread: 1, overdue: 0, overdue_days: 7, clock: {}, disputes: {}, money: { by_currency: [{ currency: 'INR', total: 750, chits: 2 }] } };
const SUM = { chits: 3, chits_with_lines: 0, chits_without_lines: 3, requirement: [], flags: {}, money: {} };

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
/** the stand-in API: every Folders endpoint answers a known reply; S.calls logs 'METHOD path', S.writes the body of every non-GET */
async function answer(S, route) {
  const req = route.request(), url = new URL(req.url()), p = url.pathname, m = req.method();
  S.calls.push(m + ' ' + p);
  if (m !== 'GET') S.writes.push({ call: m + ' ' + p, body: req.postData() ? JSON.parse(req.postData()) : null });
  if (m === 'GET' && p === '/api/folders') return json(route, 200, { folders: [FOLDER] });
  if (m === 'GET' && p === '/api/folders/reconcile') return json(route, 200, { overall: MEASURE, folders: [], reconciled: true });
  if (m === 'GET' && p === '/api/folders/rules') return json(route, 200, { rules: [RULE, RULE2], migrated: true });
  if (m === 'GET' && p === '/api/folders/groupsum') return json(route, 200, SUM);
  if (m === 'GET' && /^\/api\/folders\/[^/]+\/chits$/.test(p)) return json(route, 200, { chits: [CHIT], total: 1 });
  if (m === 'GET' && /^\/api\/folders\/[^/]+\/metrics$/.test(p)) return json(route, 200, MEASURE);
  if (m === 'GET' && /^\/api\/folders\/[^/]+\/rules$/.test(p)) return json(route, 200, { rules: [RULE, RULE2], migrated: true });
  if (m === 'GET') return json(route, 200, {});
  return json(route, 200, { ok: true });
}

async function server() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html', file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((done) => srv.listen(0, '127.0.0.1', done));
  return { base: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() };
}

/** a signed-in context; `serviceWorkers` is 'allow' for the pages and the offline leg, 'block' for the plain tab walk */
async function signedContext(browser, S, serviceWorkers) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await ctx.route('**/api/**', (route) => answer(S, route));
  await ctx.addInitScript(() => {
    try {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      const token = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-folders', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
      localStorage.setItem('cb_sess', JSON.stringify({ token, role: 'entity', name: 'Folders Shop' }));
    } catch (_) { /* a page without storage cannot sign in; the leg then fails loud */ }
  });
  return ctx;
}

function counters() {
  const state = { pass: 0, fail: 0 };
  const ok = (cond, message) => { if (cond) { state.pass++; console.log('  ok  ' + message); } else { state.fail++; console.log('  XX  ' + message); } };
  const finish = (name) => { console.log('\n  ' + name + ': ' + state.pass + ' passed, ' + state.fail + ' failed'); process.exitCode = state.fail ? 1 : 0; };
  return { ok, finish };
}
const names = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'folders-names.json'), 'utf8')).names;

module.exports = { server, signedContext, counters, names, FOLDER, RULE, RULE2, CHIT };
