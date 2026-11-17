/* bills-folder.cjs — THE FOLDER LIST NOW CARRIES SYSTEM FOLDERS; THE SCREENS THAT EXIST MUST NOT CHANGE (2026-10-01).
 *
 * The API's GET /api/folders returns the system folders first (B-2100 Bills · Received, B-1300 Bills · Issued, R-1400
 * Receipts — VIEWS whose contents are their rule's matches; scope null, kind 'view', system true) beside the shop's own
 * filed folders. The Bills screen itself is designed first (docs/design/bills-folder/REQUIREMENT.md) and NOT built here;
 * what this proves is that the screens which already read the folder list keep working:
 *
 *  1  under Task and Order the rail shows the shop's FILED folders only — a system folder (scope null) would otherwise
 *     fall under Task, and opening it would show an empty Task list
 *  2  📁 Move lists the filed folders only (the server refuses a move into a view: FOLDER_IS_VIEW)
 *  3  the system folders are kept, apart, for the Bills screen to come (UI.sysFolders: code · name · count)
 *  4  the Task list is what the server sends — orders and jobs (the bills left it on the server: tests/bills-folder.test.cjs)
 *  ⚠️ no "accounting" on screen; no page error
 * A stand-in API on a free OS port answers every /api/** call; nothing reaches a server, live or local.
 * BF_ROOT=<dir of public> runs it against another checkout (the red-first run against main).
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.BF_ROOT || path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };

const SYS = [
  { folder_id: 'a0000000-0000-5000-8000-000000002100', parent_id: null, name: 'Bills · Received', code: 'B-2100', kind: 'view', system: true, scope: null, side: 'received', ledger: { code: '2100', name: 'Suppliers (Sundry Creditors)' }, count: 2, total: 3 },
  { folder_id: 'a0000000-0000-5000-8000-000000001300', parent_id: null, name: 'Bills · Issued', code: 'B-1300', kind: 'view', system: true, scope: null, side: 'issued', ledger: { code: '1300', name: 'Customers (Sundry Debtors)' }, count: 1, total: 2 },
  { folder_id: 'a0000000-0000-5000-8000-000000001400', parent_id: null, name: 'Receipts', code: 'R-1400', kind: 'view', system: true, scope: null, side: null, ledger: { code: '1400', name: 'Cash' }, count: 1, total: 1 },
];
const OWN_VIEW = { folder_id: 'b0000000-0000-4000-8000-00000000000a', parent_id: null, name: 'Agro Mills', kind: 'view', scope: 'task', count: 2 };
const FILED = [{ folder_id: 'c0000000-0000-4000-8000-00000000000b', parent_id: null, name: 'Urgent', scope: 'task', kind: 'filed', count: 1 },
               { folder_id: 'c0000000-0000-4000-8000-00000000000c', parent_id: null, name: 'Sent to suppliers', scope: 'order', kind: 'filed', count: 0 }];
const TASKS = [
  { chit_id: 'ord1', purpose: 'order', manual_subject: 'Order from Chola', sender_entity_display_name: 'Chola Auto Care', current_status: 'pending', created_at: '2026-10-01T04:00:00Z', summary_json: {}, all_recipients: [] },
  { chit_id: 'job1', purpose: 'general', manual_subject: 'Fix the shutter', sender_entity_display_name: 'Bills Shop', current_status: 'pending', created_at: '2026-10-01T03:00:00Z', summary_json: {}, all_recipients: [] },
];
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  if (p === '/api/folders' && m === 'GET') { S.lists++; return J(r, 200, { folders: SYS.concat([OWN_VIEW], FILED) }); }
  if (p === '/api/chits/inbox') { S.inbox.push(u.search); return J(r, 200, { chits: TASKS, total: TASKS.length, page: 1, limit: 20 }); }
  if (p === '/api/chits/sent') return J(r, 200, { chits: [], total: 0, page: 1, limit: 20 });
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

(async () => {
  const srv = http.createServer((q, r) => { const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html'; const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [];
  const S = { lists: 0, inbox: [] };
  const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route('**/api/**', (r) => route(S, r));
  await ctx.addInitScript(() => { try {
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-bills', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
    localStorage.setItem('cb_sess', JSON.stringify({ token: tok, role: 'entity', name: 'Bills Shop' })); } catch (_) {} });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => threw.push(e.message));
  await p.goto(base + '/app.html#/app');
  await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
  /* the folder list arrives after the first paint (loadFolders → bgRenderApp leaves the rail for the next full paint) — wait
     for it, then paint once, as any navigation would */
  await p.waitForFunction(() => Array.isArray(UI.folders) && UI.folders.length > 0, null, { timeout: 15000 }).catch(() => {});
  /* (no chit open: the stand-in answers a chit read with {}, which is not what this harness is about) */
  await p.evaluate(() => { UI.sel = null; UI.detail = null; renderApp(); });
  await p.waitForSelector('[data-testid="nav-folder-' + FILED[0].folder_id + '"]', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(300);

  /* 1 · the rail under Task and Order */
  const under = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="nav-folder-"]')].map((e) => e.textContent.trim()));
  ok(S.lists >= 1, 'the folder list was read (GET /api/folders)');
  ok(under.some((t) => /Urgent/.test(t)) && under.some((t) => /Sent to suppliers/.test(t)), 'the shop\'s filed folders still hang under Task and Order: ' + under.join(' | '));
  ok(!under.some((t) => /Bills · Received|Bills · Issued|Receipts|Agro Mills/.test(t)), 'no system or view folder hangs under Task or Order');

  /* 2 · Move */
  await p.evaluate(() => moveChit('ord1'));
  await p.waitForSelector('.mbody', { timeout: 8000 }).catch(() => {});
  const mv = await p.evaluate(() => (document.querySelector('.mbody') || {}).innerText || '');
  ok(/Urgent/.test(mv) && !/Bills · Received|Bills · Issued|Receipts|Agro Mills/.test(mv), '📁 Move offers the filed folders only (a view is not a place)');
  await p.evaluate(() => { if (typeof closeModal === 'function') closeModal(); });
  /* …and when Move is the first to ask for the list (opened from Task before the folders arrived), its own read too */
  await p.evaluate(() => { UI.folders = undefined; return moveChit('job1'); });
  await p.waitForFunction(() => /Urgent/.test((document.querySelector('.mbody') || {}).innerText || ''), null, { timeout: 8000 }).catch(() => {});
  const mv2 = await p.evaluate(() => (document.querySelector('.mbody') || {}).innerText || '');
  ok(/Urgent/.test(mv2) && !/Bills · Received|Bills · Issued|Receipts|Agro Mills/.test(mv2), '📁 Move reading the list itself also offers the filed folders only');
  await p.evaluate(() => { if (typeof closeModal === 'function') closeModal(); });

  /* 3 · kept apart for the Bills screen */
  const sys = await p.evaluate(() => (UI.sysFolders || []).map((f) => (f.code || '') + ':' + f.name + ':' + f.count));
  ok(JSON.stringify(sys) === JSON.stringify(['B-2100:Bills · Received:2', 'B-1300:Bills · Issued:1', 'R-1400:Receipts:1', ':Agro Mills:2']), 'the system and view folders are kept apart, with code and open count: ' + sys.join(' | '));
  ok(await p.evaluate(() => (UI.folders || []).every((f) => !f.system && f.kind !== 'view')), 'UI.folders holds only filed folders (every existing reader is unchanged)');

  /* 4 · the Task list */
  await p.waitForFunction(() => /Order from Chola/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
  const taskText = await p.evaluate(() => (document.querySelector('.list') || document.body).innerText);
  ok(/Order from Chola/.test(taskText) && /Fix the shutter/.test(taskText), 'the Task list paints what the server sends (orders and jobs)');
  const t = await p.evaluate(() => document.body.innerText);
  ok(!/accounting/i.test(t), 'the word "accounting" is nowhere on screen');
  const mine = threw.filter((m) => /folder|sysFolders|_foldersFrom/i.test(m));
  ok(mine.length === 0, 'no page error from the folder code' + (mine.length ? ' — ' + mine.join(' | ') : ''));
  if (threw.length) console.log('  (other page errors: ' + threw.length + ' — ' + threw.slice(0, 3).join(' | ').slice(0, 300) + ')');
  await ctx.close(); await b.close(); srv.close();
  console.log('\n  bills-folder: ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
