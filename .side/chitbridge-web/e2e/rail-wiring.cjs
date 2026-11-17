/* rail-wiring.cjs — R10: the built rail units are on the screens a person uses. screen -> control -> outcome, nothing driven by a function call.
 *
 *  A  crm.html  party record -> latest chit in the timeline -> the chit sheet carries "Messages and files"
 *       A1 CBThread: type, Send -> ONE POST /chits/:id/messages, "Sent" said under the button, the message listed
 *       A2 CBAttach: Attach a file -> the picker -> ONE POST /attachments carrying the chit id, "Attached" said
 *       A3 a view-only login: the box is gone, the ENGINE's sentence is on screen, nothing is sent (no page rule decides it)
 *  B  accounts.html  Day book -> the bill number -> the same sheet, the same two units (Outstandings rows open this sheet)
 *  C  doors: a 401 shows THIS page's sign-in card (no jump to app.html); a chit link in a list opens the sheet here, not a new tab
 *  D  no page function decides eligibility: the sheet/pages hold no hatAssignable / statusWordFor-of-their-own
 * Run: sh C:/dev/toolset/e2e.sh <checkout> e2e/rail-wiring.cjs */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), J = C.json;
const crmApi = require('./lib/crm-api.cjs'), books = require('./lib/books-api.cjs');
const FIX = path.join(__dirname, 'fixtures', 'golden-parties.json');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const claims = (c) => b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x';
const OWNER = { token: claims({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Athi', entity: 'Mayur Bhavan' };
const TODAY = new Date().toISOString().slice(0, 10);

const ALLOW = { message_external: { ok: true }, message_internal: { ok: true } };
const VIEW = { message_external: { ok: false, why: 'read_only' }, message_internal: { ok: false, why: 'read_only' } };
function standIn() {
  const fx = crmApi.resolve(JSON.parse(fs.readFileSync(FIX, 'utf8')), Date.now());
  return { fx, list: JSON.parse(JSON.stringify(fx.list)), calls: [], msgs: [], posts: [], atts: [], actions: ALLOW, status401: false };
}
function chitOf(id, S) {
  return { header: { chit_id: id, purpose: 'order', current_status: 'pending', manual_subject: 'Order ' + id, created_at: TODAY + 'T05:10:00.000Z',
      all_recipients: [{ role: 'sender', display_name: 'Mayur Bhavan', entity_id: 'ent-M' }, { role: 'receiver', display_name: 'Chola Auto Care', entity_id: 'ent-C' }], summary_json: { currency_code: 'INR' }, business_json: {} },
    detail: { line_items: [{ particulars: 'Filter', quantity: 1, unit: 'piece', price: 100, total: 100 }] }, actions: S.actions };
}
async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  S.calls.push(m + ' ' + p);
  let body = null; try { body = q.postDataJSON(); } catch (_) {}
  let x;
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' } });
  if (p === '/api/books/health') return J(r, 200, books.health());
  if (p === '/api/books/status') return J(r, 200, { migrated: true, enabled: true, walkin_grain: 'day' });
  if (p === '/api/books/daybook') return J(r, 200, books.daybook(S.entries ? S.entries.map(books.entry) : []));
  if (p === '/api/books/dues') return J(r, 200, books.dues([], { asOf: TODAY }));
  if (p === '/api/books/cheques') return J(r, 200, { currency: 'INR', cheques: [] });
  if (p.startsWith('/api/books')) return J(r, 200, {});
  if (p === '/api/events/ticket') return J(r, 200, { ticket: 't' });
  if (p === '/api/events/stream') return r.abort();
  if (p === '/api/notifications') return J(r, 200, { notifications: [], count: 0 });
  if ((x = p.match(/^\/api\/chits\/([^/]+)\/messages$/))) {
    if (m === 'POST') { S.posts.push({ id: x[1], body }); S.msgs.push({ message_id: 'm' + (S.msgs.length + 1), message_text: body.message_text || body.text || '', thread_type: body.thread_type || 'external', sender_display_name: 'Mayur Bhavan', created_at: new Date().toISOString() }); return J(r, 201, { message_id: 'm' + S.msgs.length }); }
    return J(r, 200, { messages: S.msgs });
  }
  if (p === '/api/attachments' && m === 'POST') { S.atts.push(body); return J(r, 201, { id: 'a1', name: body.name, mime: body.mime, size: 5 }); }
  if ((x = p.match(/^\/api\/chits\/([^/]+)$/)) && m === 'GET') { if (S.status401) return J(r, 401, { error: 'Session expired' }); return J(r, 200, chitOf(x[1], S)); }
  if (p === '/api/crm/parties' && m === 'GET') return J(r, 200, crmApi.list(S.list, { records: S.fx.records }));
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/timeline$/))) return J(r, 200, crmApi.timeline(S.fx.timelines[decodeURIComponent(x[1])] || { entries: [] }, decodeURIComponent(x[1]), { before: null, limit: u.searchParams.get('limit') }));
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)$/)) && m === 'GET') {
    const row = S.list.find((q2) => q2.party_id === decodeURIComponent(x[1]));
    return row ? J(r, 200, crmApi.record(S.list, row.party_id, S.fx.records[row.party_id], [])) : J(r, 404, { error: 'Not found' });
  }
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(PUB, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [];
  async function open(S, url) {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, OWNER);
    const p = await ctx.newPage(); p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + url);
    return { ctx, p };
  }
  const sheetUp = (p) => p.waitForFunction(() => { const d = document.getElementById('chitsheet'); return !!(d && d.open && d.querySelector('[data-testid="cs-rail"]')); }, null, { timeout: 10000 });
  const text = (p, s) => p.evaluate((q) => { const e = document.querySelector(q); return e ? e.textContent.replace(/\s+/g, ' ') : ''; }, s);

  /* ── A · crm.html: the record's timeline chit -> the sheet -> Messages and files ── */
  console.log('\n-- A · crm.html party record --');
  {
    const S = standIn(); const { ctx, p } = await open(S, '/crm.html#/party/P-0002');
    await p.waitForSelector('[data-testid="crm-tl-chit-ch-431"]', { timeout: 20000 });
    await p.click('[data-testid="crm-tl-chit-ch-431"]'); await sheetUp(p);
    ok(await p.locator('#chitsheet [data-testid="cs-rail-attach"] [data-testid="cb-attach-btn"]').count() === 1, 'A · the sheet shows ONE "Attach a file" button (CBAttach.mount)');
    await p.waitForSelector('#chitsheet [data-testid="cs-rail-thread"] [data-testid="rt-composer"]', { timeout: 8000 });
    ok(true, 'A · the sheet shows the thread composer (CBThread.mount)');
    await p.waitForSelector('#chitsheet [data-testid="rt-empty"], #chitsheet [data-testid="rt-count"]', { timeout: 8000 });
    await p.fill('#chitsheet [data-testid="msg-body"]', 'Friday is fine');
    await p.click('#chitsheet [data-testid="msg-send"]');
    await p.waitForFunction(() => /Note added/.test((document.querySelector('#chitsheet [data-testid="rt-out"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.posts.length === 1 && S.posts[0].id === 'ch-431', 'A1 · Send posts ONE message on ch-431 (' + S.posts.length + ')');
    ok(/Note added — team only/.test(await text(p, '#chitsheet [data-testid="rt-out"]')) && S.posts[0] && S.posts[0].body.thread_type === 'internal', 'A1 · the outcome is said under the button: "' + (await text(p, '#chitsheet [data-testid="rt-out"]')) + '"');
    await p.waitForSelector('#chitsheet [data-testid="rt-row"]', { timeout: 8000 }).catch(() => {});
    ok(/Friday is fine/.test(await text(p, '#chitsheet [data-testid="rt-list"]')), 'A1 · the message is listed in the thread');
    /* attach: the picker opens from the button; an empty file is refused by the one gate (no POST); a real one lands */
    const pick = async (name, buf) => { const [fc] = await Promise.all([p.waitForEvent('filechooser', { timeout: 8000 }), p.click('#chitsheet [data-testid="cb-attach-btn"]')]); await fc.setFiles({ name, mimeType: 'text/plain', buffer: buf }); };
    await pick('empty.txt', Buffer.alloc(0)); await p.waitForTimeout(500);
    ok(S.atts.length === 0, 'A2 · an empty file is refused by the picker\'s own gate: nothing is posted');
    await pick('note.txt', Buffer.from('hello')); await p.waitForFunction(() => /Attached/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
    ok(S.atts.length === 1 && S.atts[0].chit_id === 'ch-431' && S.atts[0].name === 'note.txt', 'A2 · the file is posted ONCE with the chit id');
    ok(/Attached/.test(await p.evaluate(() => document.body.innerText)), 'A2 · "Attached" is said on screen');
    await p.keyboard.press('Escape');
    /* the bell is in the header already (R06) */
    ok(await p.locator('[data-testid="shell-bell"] [data-testid="bell-btn"]').count() === 1, 'A · the bell is in the crm header');
    await ctx.close();
  }
  {
    const S = standIn(); S.actions = VIEW; const { ctx, p } = await open(S, '/crm.html#/party/P-0002');
    await p.waitForSelector('[data-testid="crm-tl-chit-ch-431"]', { timeout: 20000 });
    await p.click('[data-testid="crm-tl-chit-ch-431"]'); await sheetUp(p);
    await p.waitForSelector('#chitsheet [data-testid="rt-no"], #chitsheet [data-testid="msg-body"]', { timeout: 8000 });
    ok(await p.locator('#chitsheet [data-testid="msg-body"]').count() === 0 && await p.locator('#chitsheet [data-testid="msg-send"]').count() === 0, 'A3 · a view-only login: no box, no Send');
    ok(/View only/.test(await text(p, '#chitsheet [data-testid="rt-no"]')), 'A3 · the engine\'s sentence is on screen: "' + (await text(p, '#chitsheet [data-testid="rt-no"]')) + '"');
    ok(S.posts.length === 0, 'A3 · nothing was sent');
    await ctx.close();
  }

  /* ── B · accounts.html: Day book -> bill -> the sheet ── */
  console.log('\n-- B · accounts.html Day book --');
  {
    const S = standIn();
    S.entries = [Object.assign({ entry_id: 'e1', entry_no: 'JV/2026-27/000001', posting_date: TODAY, doc_date: TODAY, event_type: 'sale_bill', source_chit_id: 'ch1', narration: 'Sale',
      source: { chit_id: 'ch1', ref: 'C2/26-27/0002', kind: 'bill', counter: 'C2', by: 'Mani', count: null, how: 'UPI', how_ref: null, split: null, doc_at: TODAY + 'T05:10:00.000Z', recorded_at: TODAY + 'T05:10:03.000Z' },
      lines: [{ code: '1400', name: 'Cash', dr_minor: 68201, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 68201 }] })];
    const { ctx, p } = await open(S, '/accounts.html#daybook');
    await p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 20000 });
    await p.click('[data-testid="acc-nav-daybook"]');
    await p.waitForSelector('[data-testid="db-src-JV/2026-27/000001"]', { timeout: 15000 });
    await p.locator('[data-testid="db-src-JV/2026-27/000001"]').evaluate((e) => e.click());
    await sheetUp(p);
    ok(await p.locator('#chitsheet [data-testid="cb-attach-btn"]').count() === 1 && await p.locator('#chitsheet [data-testid="rt-composer"]').count() === 1, 'B · the bill\'s sheet on Accounts carries Attach a file + the thread composer');
    await p.fill('#chitsheet [data-testid="msg-body"]', 'Please send the GST copy');
    await p.click('#chitsheet [data-testid="msg-send"]');
    await p.waitForFunction(() => /Note added/.test((document.querySelector('#chitsheet [data-testid="rt-out"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok(S.posts.length === 1 && S.posts[0].id === 'ch1' && S.posts[0].body.thread_type === 'internal' && /Note added — team only/.test(await text(p, '#chitsheet [data-testid="rt-out"]')), 'B · Send posts ONE message on the bill\'s chit and says so');
    ok(await p.locator('[data-testid="shell-bell"] [data-testid="bell-btn"]').count() === 1, 'B · the bell is in the accounts header');
    await ctx.close();
  }

  /* ── C · doors ── */
  console.log('\n-- C · doors --');
  {
    const S = standIn(); S.status401 = true; const { ctx, p } = await open(S, '/crm.html#/party/P-0002');
    await p.waitForSelector('[data-testid="crm-tl-chit-ch-431"]', { timeout: 20000 });
    const url0 = p.url();
    await p.click('[data-testid="crm-tl-chit-ch-431"]');
    await p.waitForSelector('[data-testid="signin-host"]', { timeout: 10000 }).catch(() => {});
    ok(await p.locator('[data-testid="signin-host"]').count() === 1 && !/app\.html/.test(p.url()), 'C · a 401 shows this page\'s own sign-in card; the page did not jump to app.html');
    await ctx.close();
  }
  {
    const S = standIn(); const { ctx, p } = await open(S, '/crm.html#/party/P-0002');
    await p.waitForSelector('[data-testid="crm-tl-chit-ch-431"]', { timeout: 20000 });
    const pages0 = ctx.pages().length;
    await p.evaluate(() => openChit('ch-431'));
    await sheetUp(p);
    ok(ctx.pages().length === pages0 && !/app\.html/.test(p.url()), 'C · a chit link on the page opens the sheet here, not a new tab on app.html');
    await ctx.close();
  }
  for (const f of ['accounts.html', 'crm.html']) {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    ok(!/function go\([^)]*\)\s*\{[^}]*app\.html/.test(src) && !/function openChit\([^)]*\)\s*\{[^}]*app\.html/.test(src), 'C · ' + f + ': go() and openChit() no longer point at app.html');
    ok(!/hatAssignable|function statusWordFor/.test(src), 'D · ' + f + ': no own eligibility function');
  }
  const cs = fs.readFileSync(path.join(PUB, 'app', 'chit-sheet.js'), 'utf8');
  ok(!/hatAssignable/.test(cs) && /CBThread\.mount/.test(cs) && /CBAttach\.mount/.test(cs), 'D · the sheet mounts the units with their own API and holds no eligibility rule of its own for them');

  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw.slice(0, 2).join(' | ') : ''));
  await b.close(); srv.close();
  console.log('\nrail-wiring: ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
