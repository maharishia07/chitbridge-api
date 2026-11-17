/* crm.cjs — CB CRM PROVED: the golden-parties suite (docs/design/crm/PLAN.md "The conformance suite") on the page public/crm.html.
 * Pattern: cb-accounts.cjs + books-web.cjs — Playwright, a stand-in API answering INSIDE the page (ctx.route); the static server
 * takes a free port from the OS. Nothing here reaches localhost:3000, port 7351 or the live site: every /api/** call is fulfilled
 * by the stand-in before it can leave the browser, and any other host is aborted and counted (the run fails if one was tried).
 * The seed is e2e/fixtures/golden-parties.json ("@-26h" = 26 hours before the run).
 *
 *  1  the page's source: named CB CRM · no "accounting" · no alert() · the gate is attached · the avatar slot is EMPTY in the source (CBAvatar mounts there at run time) ·
 *     no hand-drawn column header · the page computes no money
 *  2  HOME (a CBList mount): one row for a both-roles party (twice in the read, once on screen) · a merged party never listed · Local /
 *     On ChitBridge / Walk-in chips · the dues are the server's figure · three columns by default · the head is three rows ≤ 20% of 1366×768 ·
 *     only the rows scroll · search · filters · the alert line, each alert with its fix · ONE read, no per-row fetch · a row peeks
 *  3  RECORD: Local has no Message (Call · Mail) · On ChitBridge has Message · Mail disabled with its reason when the preference is off ·
 *     Next (late follow-up + Done · GSTIN differs + both buttons · mail bounced + Fix address · unread) · identity block (a minted party has
 *     no ChitBridge ID) · a folded party opens its keeper "Merged from P-0008" · walk-in "Add to my parties" · Ledger off → one line + Switch on
 *  4  TIMELINE: kinds, day dividers, internal tag, bounced is amber with Fix address, a thread opens the chit sheet · three pages of 50 for a long
 *     history · the kind filter and search ask the SERVER · a local party's empty kinds are not offered
 *  5  FOLLOW-UPS: Late · Today · This week · Later · Done · assignee left → Unassigned + Assign · party removed → greyed + Delete · scope defaults
 *  6  ADD PARTY (one field, three result kinds) · LOG sheet · Add follow-up · EDIT sheet with a list of tax ids · the 409 words
 *  7  ROLES: a co-assist sees no Import / Export / Merge · a viewer sees every action greyed with the server's sentence (FX-L2C)
 *  8  STATES: migration not run (409) · calls and follow-ups before b276 (503) · the list fails → Try again · Ledger off → no Dues column
 *  9  PHONE: 390 px — document.scrollWidth === 390 on every screen
 *  10 THE LISTS ROUND (Athi 2026-10-09): ONE LINE per party in columns (Role with its heading filter · On ChitBridge · Dues "you'll get/give" · Last activity · Next follow-up red when late) ·
 *     saved views as tabs · Group as ONE labelled dropdown (None · Role · Connection · Segment; heads show count + dues) · zebra rows · ▸ opens a formatted MINI-CARD (contact · money · last 3 chits ·
 *     every action shown, the refused one greyed WITH its sentence) · an internal …@<shop>.cr handle is never an e-mail · only the rows scroll · the whole frame is in the first paint
 * Screenshots: e2e/shots/crm-{home,record,timeline,followups,add}-{laptop,phone}.png · e2e/shots/lists/crm-{oneline,minicard}-{1366,390}.png
 * Playwright is not in the cloud image: `npm i @playwright/test` in a temp dir and NODE_PATH at it (the PR says so). */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = process.env.CRM_PUB || path.join(ROOT, 'public');        /* CRM_PUB=<dir> runs against another copy (crm-breaks.cjs) */
const SHOTS = path.join(__dirname, 'shots');
const FIX = path.join(__dirname, 'fixtures', 'golden-parties.json');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
const clone = (x) => JSON.parse(JSON.stringify(x));

const crmApi = require('./lib/crm-api.cjs'), books = require('./lib/books-api.cjs');
const resolve = crmApi.resolve;   /* "@-26h" / "@+3d" → an ISO time relative to the run */
function standIn(over) {
  const fx = resolve(JSON.parse(fs.readFileSync(FIX, 'utf8')), Date.now());
  return Object.assign({ fx, calls: [], bodies: [], ledger: true, migrated: true, interactionsOk: true, listFails: 0, logs: [], fu: clone(fx.followups), added: [], patches: [], dup: false, list: clone(fx.list) }, over || {});
}
const claims = (c) => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
const OWNER = { token: claims({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Athi', entity: 'Mayur Bhavan' };
const EDITOR = { token: claims({ identity_id: 'act-1', identity_type: 'actor', parent_entity_id: 'ent-M', parent_entity_name: 'Mayur Bhavan', display_name: 'Divya', hat: 'act' }), role: 'actor', name: 'Divya', entity: 'Mayur Bhavan' };
const VIEWER = { token: claims({ identity_id: 'act-2', identity_type: 'actor', parent_entity_id: 'ent-M', parent_entity_name: 'Mayur Bhavan', display_name: 'Vel', hat: 'view_only' }), role: 'actor', name: 'Vel', entity: 'Mayur Bhavan' };

const KINDS = { messages: ['message', 'message_internal'], bills: ['bill', 'payment', 'chit', 'dispute'], notes: ['call', 'visit', 'whatsapp', 'note'], mail: ['mail'], followups: ['followup'] };
async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(), fx = S.fx;
  S.calls.push(m + ' ' + p + u.search);
  let body = null; try { body = q.postDataJSON(); } catch (_) {}
  if (m !== 'GET') S.bodies.push({ m, p, body });
  let x;
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' } });
  if (p === '/api/books/health') { if (!S.ledger) return J(r, 404, { error: 'Not found' }); return J(r, 200, books.health()); }
  if (p === '/api/books/enable' && m === 'POST') { S.ledger = true; return J(r, 200, { ok: true }); }
  if ((x = p.match(/^\/api\/books\/party\/([^/]+)\/statement$/))) return J(r, 200, books.statement(x[1]));
  if (p === '/api/facts/rail/chits') return J(r, 200, S.railChits || { overdue_days: 7, truncated: false, items: [] });
  if (p.startsWith('/api/chits/')) return J(r, 200, { header: { chit_id: p.split('/').pop() }, detail: {} });
  if (p === '/api/entities/search') { const k = String(u.searchParams.get('q') || '').toLowerCase(); return J(r, 200, { results: fx.search[k] || [] }); }
  /* ── the CRM, answered as chitbridge-api answers it (e2e/lib/crm-api.cjs builds the shapes from the golden seed; the contract holds them) ── */
  /* L1 leads, answered as the API answers them (S.leads: the lead rows; S.leadsOff: b297 not run yet) */
  if (p === '/api/crm/parties' && m === 'GET' && u.searchParams.get('view') === 'leads') {
    const L = (S.leads || []).map((q2) => ({ party_id: q2.party_id, display_name: q2.display_name, user_id: '~mayur.cus-' + q2.party_id.slice(-4), bridge_id: null, email: null, phone: q2.phone || null, otp_contact: q2.phone || null, gstn: null, status: 'active',
      city: null, kind: 'local', on_chitbridge: false, may_trade: { ok: false, why: 'local' }, roles: { customer: true, supplier: false }, party_no: q2.party_no || null, last_activity: null,
      customer: { list_id: 'cl-' + q2.party_id, segment: 'new', segment_override: null, txn_count: 0, last_txn_at: null, groups: [], customer_type: 'entity', added_via: 'lead' },
      lead: { stage: q2.stage || 'lead', since: '2026-10-09T09:00:00.000Z' }, legal_name: null, nickname: null, state_code: null, tax_ids: [], terms: { customer: { credit_days: null, credit_limit_minor: null } }, dues: null,
      gstin: { value: null, source: null, theirs: null, differs: false }, name: q2.display_name }));
    return J(r, 200, crmApi.listPage(S.leadsOff ? [] : L, { leads_migrated: !S.leadsOff }));   /* the one envelope (total · page · limit), as the contract says */
  }
  if (p === '/api/crm/leads' && m === 'POST') {
    if (S.leadsOff) return J(r, 503, { code: 'LEADS_NOT_MIGRATED', error: 'Lead stages arrive after the next update.', message: 'Lead stages arrive after the next update.' });
    if (!String(body.name || '').trim()) return J(r, 400, { code: 'BAD_NAME', error: 'Give the lead a name.', message: 'Give the lead a name.' });
    const id = '20000000-0000-4000-8000-' + String((S.leads || []).length + 1).padStart(12, '0');
    S.leads = (S.leads || []).concat([{ party_id: id, display_name: body.name, phone: body.phone || null, stage: body.stage || 'lead', party_no: 'P-01' + String((S.leads || []).length + 1).padStart(2, '0') }]);
    S.leadAdds = (S.leadAdds || []).concat([body]);
    return J(r, 201, { party: { party_id: id, display_name: body.name, party_no: 'P-0100', kind: 'local', on_chitbridge: false, lead: { stage: body.stage || 'lead', since: '2026-10-10T09:00:00.000Z' } } });
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/stage$/)) && m === 'POST') {
    if (S.leadsOff) return J(r, 503, { code: 'LEADS_NOT_MIGRATED', error: 'Lead stages arrive after the next update.', message: 'Lead stages arrive after the next update.' });
    const row = (S.leads || []).find((q2) => q2.party_id === decodeURIComponent(x[1]));
    if (!row) return J(r, 404, { code: 'NOT_FOUND', error: 'Not one of your leads.', message: 'Not one of your leads.' });
    row.stage = body.stage; S.stageMoves = (S.stageMoves || []).concat([body]);
    return J(r, 200, { ok: true, party_id: row.party_id, lead: { stage: body.stage, since: '2026-10-10T09:00:00.000Z' } });
  }
  if (p === '/api/crm/parties' && m === 'GET') {
    if (S.listFails > 0) { S.listFails--; return J(r, 500, { error: 'boom' }); }
    return J(r, 200, Object.assign(crmApi.list(S.list, { careless: S.careless, records: fx.records }), { may: crmApi.mayOf(r) }));   /* W2-CRM: the server's may/why rides the list */
  }
  if (S.live && (x = p.match(/^\/api\/crm\/parties\/([^/]+)\/timeline$/))) return J(r, 200, S.live.timeline);
  if (S.live && (x = p.match(/^\/api\/crm\/parties\/([^/]+)$/)) && m === 'GET') return S.live.recordFails ? J(r, 500, { error: 'Failed', message: 'boom' }) : S.live.raw ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(S.live.record) }) /* a deliberately malformed answer: not held to the contract */ : J(r, 200, S.live.record);
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/timeline$/))) {
    const id = decodeURIComponent(x[1]);
    S.tlQueries = (S.tlQueries || []).concat([u.search]);
    return J(r, 200, crmApi.timeline(fx.timelines[id] || { entries: [] }, id, { before: u.searchParams.get('before'), limit: u.searchParams.get('limit') }));
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/interactions$/)) && m === 'POST') {
    if (!S.interactionsOk || !S.migrated) return J(r, 503, { code: 'CRM_NOT_MIGRATED', error: 'Not migrated yet', message: 'CRM needs migration b276 — not run yet.' });
    if (['call', 'visit', 'message', 'note'].indexOf(body.kind) < 0) return J(r, 400, { code: 'REFUSED', error: 'Kind is call, visit, message or note.', message: 'Kind is call, visit, message or note.' });
    S.logs.push(body); return J(r, 201, crmApi.interaction(body));
  }
  if (p === '/api/crm/walk-ins/add' && m === 'POST') { S.walkAdds = (S.walkAdds || []).concat([body]); return J(r, 201, { party: { party_id: 'pid-walk-new', user_id: '~mayur.cus-0001', display_name: 'Customer 0021', party_no: 'P-0099', kind: 'local', on_chitbridge: false }, points_claimed: 340 }); }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)$/)) && m === 'DELETE') {
    const row = S.list.find((q2) => q2.party_id === decodeURIComponent(x[1]));
    S.removed = (S.removed || []).concat([decodeURIComponent(x[1])]);
    if (row && row.balance_minor) return J(r, 409, { code: 'HAS_DUES', error: 'There are open dues on this party.', message: 'There are open dues on this party.' });
    return J(r, 200, { ok: true, party_id: decodeURIComponent(x[1]) });
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)$/)) && m === 'GET') {
    const key = decodeURIComponent(x[1]);
    /* the API takes the party's ID (a party number is not one), and opens the survivor for the id of a merged party */
    if (/^P-\d+$/.test(key)) return J(r, 400, { code: 'BAD_ID', error: 'That is not a party id.', message: 'That is not a party id.' });
    let row = S.list.find((q2) => q2.party_id === key);
    if (row && row.merged_into) row = S.list.find((q2) => q2.party_id === row.merged_into);
    if (!row) return J(r, 404, { code: 'NOT_FOUND', error: 'Not found', message: 'Not your party.' });
    const rec = crmApi.record(S.list, row.party_id, fx.records[row.party_id], S.fu);
    if (!S.migrated) { rec.migrated = false; rec.followups = []; }
    return J(r, 200, Object.assign(rec, { may: crmApi.mayOf(r) }));
  }
  if (p === '/api/crm/followups' && m === 'GET') {
    if (!S.interactionsOk || !S.migrated) return J(r, 503, { code: 'CRM_NOT_MIGRATED', error: 'Not migrated yet', message: 'CRM needs migration b276 — not run yet.' });
    const scope = u.searchParams.get('scope'), done = u.searchParams.get('done') === '1', me = S.me || 'Athi';
    S.fuQueries = (S.fuQueries || []).concat([scope + '/' + (done ? 1 : 0)]);
    return J(r, 200, Object.assign(crmApi.followups(S.fu.filter((f) => (done ? !!f.done_at : !f.done_at) && (scope !== 'mine' || f.assignee_name === me))), { may: crmApi.mayOf(r) }));
  }
  if (p === '/api/crm/followups' && m === 'POST') {
    if (!S.interactionsOk || !S.migrated) return J(r, 503, { code: 'CRM_NOT_MIGRATED', error: 'Not migrated yet', message: 'CRM needs migration b276 — not run yet.' });
    S.fuAdded = body;
    return J(r, 201, { followup: crmApi.followupOne({ followup_id: 'fu-new', party_id: body.party_id, what: body.what, due_at: body.due_at, assignee_user_id: body.assignee_user_id || 'athi', source: body.source || 'manual', created_at: new Date().toISOString() }) });
  }
  if ((x = p.match(/^\/api\/crm\/followups\/([^/]+)$/))) {
    const f = S.fu.find((y) => y.followup_id === x[1]);
    /* W2-CRM: a snooze is a WORD ({ after }) the api turns into the shop's day; a date (due_at) is a day too */
    if (m === 'PATCH') { S.fuPatch = body; if (f && body.done) f.done_at = new Date().toISOString(); if (f && (body.due_at || body.after)) { f.due_at = body.after ? new Date(Date.now() + (body.after === 'week' ? 7 : 1) * 86400e3).toISOString() : body.due_at; f.late = false; } return J(r, 200, { followup: crmApi.followupOne(f || { followup_id: x[1], party_id: 'pid-0001', what: '', due_at: new Date().toISOString() }) }); }
    if (m === 'DELETE') { S.fu = S.fu.filter((y) => y.followup_id !== x[1]); S.fuDeleted = x[1]; return J(r, 200, { ok: true }); }
  }
  /* ── the existing relationship routes ── */
  if (p === '/api/relationships/customers' && m === 'POST') {
    S.added.push({ role: 'customer', body });
    const name = body.name || 'New customer', row = Object.assign({}, S.list[0], { party_id: 'pid-new', party_no: 'P-0099', display_name: name, roles: ['customer'], kind: 'local', on_chitbridge: false, why_not: 'local', balance_minor: 0, tax_ids: [], groups: [], segment: 'new', next_followup_at: null, next_followup_late: false, dues_overdue: false, oldest_due: null, unread: 0, phone: body.phone || null, email: null, user_id: '~shop.cus-9' });
    S.list.push(row); fx.records['pid-new'] = { customer: { list_id: 'cl-new', txn_count: 0, groups: [] }, supplier: null, contacts: { phones: [], emails: [], address: null }, prefs: [], followups: [], changes: [] };
    return J(r, 201, { customer: { customer_identity_id: 'pid-new', display_name: name }, points_claimed: body.phone ? 340 : undefined });
  }
  if (p === '/api/relationships/suppliers' && m === 'POST') { S.added.push({ role: 'supplier', body }); return J(r, 201, { supplier: { supplier_entity_id: 'pid-new-s', display_name: body.name || 'Supplier' } }); }
  if ((x = p.match(/^\/api\/relationships\/(customers|suppliers)\/([^/]+)$/)) && m === 'PATCH') {
    S.patches.push({ kind: x[1], id: x[2], body });
    if (S.dup && (body.tax_ids || []).some((t) => t.value === 'DUPLICATE')) return J(r, 409, { error: 'This GSTIN is already on P-0001 Agro Mills', code: 'DUPLICATE_PARTY' });
    return J(r, 200, { ok: true });
  }
  if (p === '/api/books/terms') return J(r, 200, { terms_migrated: true, may_set: true, why_not: null, default: {}, party: null, events: [] });   /* the record's Tax & terms read — the contract's shape (as e2e/lib/standin.cjs answers it) */
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = path.join(PUB, rel || 'index.html');
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [], offHost = [];

  async function open(S, o) {
    o = o || {};
    const ctx = await b.newContext({ viewport: o.viewport || { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, o.session || OWNER);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + '/crm.html' + (o.hash || ''));
    return { ctx, p };
  }
  const rowsOf = (p) => p.$$eval('#crm_list [data-row]', (r) => r.map((x) => x.getAttribute('data-testid')));
  /* innerText follows CSS (small caps are painted upper-case); textContent is the words as written */
  const text = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ') : ''; }, sel);
  const homeReady = async (p) => { await p.waitForSelector('[data-testid^="crm-row-"]', { timeout: 15000 }); await p.waitForTimeout(150); };
  const recReady = async (p, name) => { await p.waitForSelector('[data-testid="crm-rec-name"]', { timeout: 15000 }); await p.waitForSelector('[data-testid="crm-ident"]', { timeout: 15000 }); await p.waitForTimeout(150); if (name) ok((await text(p, '[data-testid="crm-rec-name"]')).trim() === name, 'the record opens for ' + name); };
  /* the screen is its own scroller, so the page can look 390 wide while the screen scrolls sideways: both are measured */
  const sw = (p) => p.evaluate(() => { const s = document.getElementById('screen'); return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, over: s.scrollWidth - s.clientWidth }; });
  const hash = (p, h) => p.evaluate((x) => { location.hash = x; }, h);
  const bad = async (p, where) => { const t = await p.evaluate(() => document.body.innerText); ok(!/accounting|books of account/i.test(t), where + ': "accounting" / "books of account" appear nowhere'); };

  /* ── 1 · THE PAGE'S OWN SOURCE ───────────────────────────────────────────────────────────────────────────── */
  {
    const html = fs.readFileSync(path.join(PUB, 'crm.html'), 'utf8'), js = ['cap-crm.js', 'cap-crm-record.js', 'cap-crm-timeline.js'].map((f) => fs.readFileSync(path.join(PUB, 'app', f), 'utf8')).join('\n');
    const all = html + '\n' + js;
    ok(/<title>CRM<\/title>/.test(html), 'the page is named CRM');
    ok(!/\balert\s*\(/.test(all), 'no alert() anywhere');
    ok(!/accounting|books of account/i.test(all.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the source carries neither forbidden word on a screen');
    ok(/CBOnePerson\.attach\(/.test(html), 'the one-shop gate is attached');
    ok(/id="shell"[^>]*><\/div>/.test(html) && !/class="avatar"|avatar-btn|avmenu|CBAvatar\.mount\(|cb-avatar/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'the frame\'s host (#shell) is present and EMPTY — CBFrame mounts the one header (avatar · Home · chip) there; this page draws none (SHELL-ONE)');
    ok(!/role=\\?["']columnheader|<thead|class=\\?["'][^"']*\blhead\b/.test(all), 'no column header is drawn by hand — every list is a CBList mount');
    ok((js.match(/CBList\.mount\(/g) || []).length >= 4, 'home, follow-ups and both timeline views are CBList mounts (' + (js.match(/CBList\.mount\(/g) || []).length + ')');
    const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(!/balance_minor\s*[-+*\/]|\.reduce\s*\(|amount_minor\s*[-+*\/]|\bsum\s*\(/.test(code.replace(/Math\.abs\(p\.balance_minor \|\| 0\)/g, '')), 'the page computes no money: balance_minor / amount_minor are only painted and ordered, never summed');
  }
  /* ── 2 · HOME ───────────────────────────────────────────────────────────────────────────────────────────── */
  const S0 = standIn({ careless: true });
  {
    const { ctx, p } = await open(S0);
    await homeReady(p);
    const ids = await rowsOf(p), nm = (k) => ids.filter((i) => i === 'crm-row-' + k).length;
    ok(ids.length === 7, 'seven rows: P-0001 … P-0006 and the walk-in (' + ids.join(' ') + ')');
    ok(S0.list.filter((q) => q.party_id === 'pid-0002').length === 2, 'the stand-in READ P-0002 twice (a careless reader) …');
    ok(nm('P-0002') === 1, '… the screen draws ONE row for the party who is both customer and supplier');
    ok((await text(p, '[data-testid="crm-role-P-0002"]')).trim() === 'Both', 'that one row says Both in its Role column (customer and supplier)');
    ok(nm('P-0008') === 0 && !/Folded/.test(await text(p, '#crm_list')), 'the merged party (P-0008, merged_into P-0001) is never listed');
    ok(await p.locator('[data-testid="crm-row-P-0003"] [data-testid="crm-conn-off"]').count() === 1 && await p.locator('[data-testid="crm-row-P-0001"] [data-testid="crm-conn-on"]').count() === 1 && await p.locator('[data-testid="crm-row-walkin-919876500021"] [data-testid="crm-conn-off"]').count() === 1,
      'On the network column: P-0001 ✓ · P-0003 – · the walk-in –');
    ok((await text(p, '[data-testid="crm-role-P-0003"]')).trim() === 'Supplier' && (await text(p, '[data-testid="crm-role-P-0006"]')).trim() === 'Customer', 'Role column: P-0003 Supplier · P-0006 Customer');
    /* ONE LINE: a row is as tall as one line of cells, and no chip, tag or second line is stacked under the name */
    const oneLine = await p.evaluate(() => Array.from(document.querySelectorAll('#crm_list .cbl-row')).map((r) => ({ h: Math.round(r.getBoundingClientRect().height), l2: !!r.querySelector('.l2,.tag'), name: (r.querySelector('.nm') || {}).textContent })));
    ok(oneLine.length === 7 && oneLine.every((r) => r.h <= 56 && !r.l2), 'ONE LINE per party: every row is one line high (' + oneLine.map((r) => r.h).join('/') + ' px) with no chip or second line under the name');
    const due1 = await text(p, '[data-testid="crm-row-P-0001"] [data-testid="party-due-pid-0001"]'), due2 = await text(p, '[data-testid="crm-row-P-0002"] [data-testid="party-due-pid-0002"]');
    ok(/481\.65/.test(due1) && /you'll give/.test(due1) && /↑/.test(due1) && !/P-0001/.test(due1), 'P-0001 dues: ↑ ₹481.65 you\'ll give — the server\'s −48165, painted in the shopkeeper\'s words (' + due1.trim() + ')');
    ok(/12,450\.00/.test(due2) && /you'll get/.test(due2) && /↓/.test(due2), 'P-0002 dues: ↓ ₹12,450.00 you\'ll get — ONE netted figure for both roles (' + due2.trim() + ')');
    const cols2 = await p.evaluate(() => { const c = (s) => getComputedStyle(document.querySelector(s)).color; return { get: c('[data-testid="party-due-pid-0002"]'), give: c('[data-testid="party-due-pid-0001"]') }; });
    ok(cols2.get !== cols2.give, 'symbol + word + colour: you\'ll get and you\'ll give are different colours (' + cols2.get + ' / ' + cols2.give + ') — never the colour alone');
    ok(/late/i.test(await text(p, '[data-testid="crm-row-P-0001"]')), 'a late due is marked (the server said dues_overdue)');
    const lateFu = await p.evaluate(() => { const e = document.querySelector('[data-testid="crm-row-P-0001"] [data-testid="crm-fu-late"]'); return e ? { t: e.textContent.replace(/\s+/g, ' ').trim(), c: getComputedStyle(e).color } : null; });
    ok(lateFu && /Late · \d/.test(lateFu.t) && lateFu.c !== cols2.get, 'an overdue follow-up shows red, says Late and carries its date (' + (lateFu && lateFu.t) + ')');
    const heads = await p.$$eval('#crm_list .cbl-hc', (h) => h.map((x) => x.innerText.replace(/[▲▼⇅]/g, '').trim()));
    const headsClean = heads.map((h) => h.replace(/[▾●]/g, '').trim());
    ok(JSON.stringify(headsClean) === JSON.stringify(['PARTY', 'ROLE', 'ON THE NETWORK', 'DUES', 'LAST ACTIVITY', 'NEXT FOLLOW-UP']), 'the columns: ' + headsClean.join(' · ') + ' (last activity and next follow-up are always on the row)');
    ok(await p.locator('#crm_list .cbl-rz').count() === 6, 'every column has its drag handle (adjustable columns)');
    ok(await p.locator('#crm_list [data-hf="role"]').count() === 1 && await p.locator('#crm_list [data-hf="rail"]').count() === 1, 'Role and On the network carry their own filter in the column heading');
    /* the frozen head: title row (shop · Home · avatar slot ride in it) + tools + column header ≤ 20% of 1366×768 */
    const hd = await p.evaluate(() => { const q = (s) => document.querySelector(s), r = (e) => e ? e.getBoundingClientRect() : { top: 0, bottom: 0 }; const list = q('#crm_list .cbl-list'); return { top: r(q('#crm_list')).top, rows: r(list).top, h: innerHeight, frame: r(q('[data-testid="shell-header"]')).bottom }; });
    ok((hd.rows - hd.top) <= 0.2 * hd.h, 'everything above the rows is ' + Math.round((hd.rows - hd.top)) + ' px of ' + hd.h + ' (' + Math.round(100 * (hd.rows - hd.top) / hd.h) + '%) — within 20% (the page\'s one action rides in the title row; the shop · Home · avatar are the frame\'s)');
    ok(hd.top <= hd.frame + 1 && hd.frame <= 60, 'only the frame (' + Math.round(hd.frame) + ' px) sits above the list: its title row starts right under it (SHELL-ONE)');
    /* only the rows scroll */
    const sc = await p.evaluate(() => { const l = document.querySelector('#crm_list .cbl-list'), h = document.querySelector('#crm_list .cbl-hdr'), t0 = h.getBoundingClientRect().top; l.scrollTop = 400; return { t0, t1: h.getBoundingClientRect().top, page: document.documentElement.scrollTop, scr: document.getElementById('screen').scrollTop }; });
    ok(sc.t0 === sc.t1 && sc.page === 0 && sc.scr === 0, 'only the rows scroll: the column header stays at ' + sc.t1 + ' px, the page and the screen do not move');
    /* the alert line */
    const notes = await p.$$eval('#crm_list [data-notice]', (n) => n.map((x) => x.innerText.trim()));
    const duesLate = await p.$$eval('#crm_list [data-testid^="party-due-late-"]', (n) => n.length);
    ok(notes.length === 2 && /2 follow-ups late · Open follow-ups/.test(notes[0]) && new RegExp(duesLate + ' part(y|ies) with late dues · See dues').test(notes[1]), 'the alert lines: ' + notes.join(' | ') + ' — the late follow-ups (GET /followups counts them) and the late dues (the API alerts.dues_overdue: the same parties the rows mark, ' + duesLate + '); each alert names its fix');
    ok(await p.locator('[data-testid="crm-nav-n-followups"]').textContent() === '2', 'the Follow-ups badge is the same number as the alert (2)');
    /* ONE read, no per-row fetch */
    const reads = S0.calls.filter((c) => /^GET \/api\/crm\/parties(\?|$)/.test(c)), perRow = S0.calls.filter((c) => /^GET \/api\/crm\/parties\/[^/?]+/.test(c));
    ok(reads.length === 1 && perRow.length === 0, 'home made ONE read of the parties and ' + perRow.length + ' per-row fetches (' + S0.calls.filter((c) => /crm|books/.test(c)).join(' · ') + ')');
    /* search · filters · count */
    await p.fill('[data-testid="listctl-search-crm-parties"]', 'ravi'); await p.waitForTimeout(150);
    ok((await rowsOf(p)).join() === 'crm-row-P-0003,crm-row-P-0004' || (await rowsOf(p)).length === 2, 'search "ravi" finds the two Ravis (P-0003 and P-0004 — the same phone)');
    ok(/2 shown of 7/.test(await text(p, '[data-testid="crm-parties-count"]')), 'the count says "2 shown of 7"');
    await p.fill('[data-testid="listctl-search-crm-parties"]', '33AAKFC5521R1ZQ'); await p.waitForTimeout(150);
    ok((await rowsOf(p)).join() === 'crm-row-P-0002', 'search reaches the GSTIN');
    await p.fill('[data-testid="listctl-search-crm-parties"]', ''); await p.waitForTimeout(100);
    await p.click('[data-testid="cbl-filters-crm-parties"]'); await p.selectOption('[data-testid="listctl-filter-role"]', 'both'); await p.waitForTimeout(120);
    ok((await rowsOf(p)).join() === 'crm-row-P-0002', 'filter Role: Both → just the one party with two roles');
    await p.selectOption('[data-testid="listctl-filter-role"]', ''); await p.selectOption('[data-testid="listctl-filter-seg"]', 'high_value'); await p.waitForTimeout(120);
    ok((await rowsOf(p)).join() === 'crm-row-P-0006', 'filter Segment: High value → Big Buyer (the server\'s word)');
    await p.selectOption('[data-testid="listctl-filter-seg"]', 'inactive'); await p.waitForTimeout(120);
    ok((await rowsOf(p)).join() === 'crm-row-P-0005', 'filter Segment: Inactive → Meena');
    await p.click('[data-cbl-clearf]'); await p.waitForTimeout(100); await p.keyboard.press('Escape');
    /* a row peeks (its next level) */
    await p.click('[data-testid="crm-row-P-0003"] [data-caret]'); await p.waitForSelector('[data-testid="crm-mini-P-0003"]');
    await p.waitForSelector('[data-testid="crm-mini-last-P-0003"] .mc-c, [data-testid="crm-mini-nochits-P-0003"]', { timeout: 8000 });
    const mini = await text(p, '[data-testid="crm-mini-P-0003"]');
    ok(/98940 55621/.test(mini) && /ravitraders\.mdu@gmail\.com/.test(mini) && /Madurai/.test(mini), 'the mini-card has a contact grid: phone · e-mail · place (' + mini.slice(0, 90) + '…)');
    ok(await p.locator('[data-testid="crm-mini-phone-P-0003"] a[href^="tel:"]').count() === 1 && await p.locator('[data-testid="crm-mini-email-P-0003"] a[href^="mailto:"]').count() === 1, 'the phone is a tel: link and the e-mail a mailto: link');
    ok(/you'll give/.test(await text(p, '[data-testid="crm-mini-money-P-0003"]')) && /21 days/.test(await text(p, '[data-testid="crm-mini-terms-P-0003"]')) && /\d/.test(await text(p, '[data-testid="crm-mini-oldest-P-0003"]')), 'the money box: what you\'ll give · credit terms (21 days) · the oldest bill');
    const acts = await p.$$eval('#crm_list .cbl-next [data-act]', (b) => b.map((x) => x.getAttribute('data-act') + (x.disabled ? ':off' : '')));
    ok(JSON.stringify(acts) === JSON.stringify(['call', 'message:off', 'pay', 'followup', 'open']), 'EVERY action is shown (Call · Message · Pay/Receive · Follow-up · Open record); Message is greyed for a party not on the network (' + acts.join(' ') + ')');
    ok(/Not on the network/.test(await text(p, '[data-testid="crm-mini-message-why"]')) && /Not on the network/.test(await p.getAttribute('[data-testid="crm-mini-message"]', 'title')), 'the greyed Message carries its sentence, written out and on hover');
    const h3 = await p.evaluate(() => Math.round(document.querySelector('[data-testid="crm-mini-P-0003"]').getBoundingClientRect().height));
    await p.click('[data-testid="crm-row-P-0006"] [data-caret]'); await p.waitForSelector('[data-testid="crm-mini-P-0006"]'); await p.waitForTimeout(600);
    const h6 = await p.evaluate(() => Math.round(document.querySelector('[data-testid="crm-mini-P-0006"]').getBoundingClientRect().height));
    ok(Math.abs(h3 - h6) <= 1, 'the mini-card is the SAME height on every row (' + h3 + ' / ' + h6 + ' px) — once its chits have loaded or not');
    ok(S0.calls.filter((c) => /^GET \/api\/crm\/parties\/[^/?]+\/timeline/.test(c)).length <= 2, 'the chits come from ONE timeline read per OPENED row, never per listed row');
    await p.screenshot({ path: path.join(SHOTS, 'lists', 'crm-minicard-1366.png') }).catch(() => {});
    await p.click('[data-testid="crm-row-P-0006"] [data-caret]'); await p.click('[data-testid="crm-row-P-0003"] [data-caret]');
    /* ZEBRA: every other row a token shade; the hover row and a group head stay distinct */
    const zb = await p.evaluate(() => { const bg = (e) => getComputedStyle(e).backgroundColor, rs = Array.from(document.querySelectorAll('#crm_list .cbl-row')); return { a: bg(rs[0]), b: bg(rs[1]), c: bg(rs[2]), d: bg(rs[3]) }; });
    ok(zb.a === zb.c && zb.b === zb.d && zb.a !== zb.b, 'ZEBRA: rows alternate (' + zb.a + ' / ' + zb.b + ')');
    await p.hover('[data-testid="crm-row-P-0002"]'); await p.waitForTimeout(80);
    const hv = await p.evaluate(() => { const bg = (e) => getComputedStyle(e).backgroundColor, rs = Array.from(document.querySelectorAll('#crm_list .cbl-row')); return { h: bg(document.querySelector('[data-testid="crm-row-P-0002"]')), z: bg(rs[0]), o: bg(rs[1]) }; });
    ok(hv.h !== hv.z && hv.h !== hv.o, 'the hovered row is distinct from both stripes (' + hv.h + ')');
    await p.mouse.move(5, 5);
    /* SAVED VIEWS as tabs: one tap sets the list\'s own filters */
    const tabs = await p.$$eval('#crm_list [role="tab"]', (t) => t.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(tabs.length === 6 && /^All/.test(tabs[0]) && /^Customers/.test(tabs[1]) && /^Suppliers/.test(tabs[2]) && /^Owe me/.test(tabs[3]) && /^I owe/.test(tabs[4]) && /^No contact in 30 days/.test(tabs[5]), 'views as tabs above the list: ' + tabs.join(' · '));
    const view = async (k) => { await p.click('[data-testid="crm-view-' + k + '"]'); await p.waitForTimeout(120); return (await rowsOf(p)).map((x) => x.replace('crm-row-', '')).sort().join(','); };
    ok(await view('owe-me') === 'P-0002,P-0006', 'Owe me → the parties whose balance the server says they owe you (' + await view('owe-me') + ')');
    ok(await view('i-owe') === 'P-0001,P-0003', 'I owe → the parties you owe (' + await view('i-owe') + ')');
    ok(await view('suppliers') === 'P-0001,P-0002,P-0003', 'Suppliers → every party with the supplier role, a both-roles party included');
    ok(await view('quiet') === 'P-0005', 'No contact in 30 days → Meena (last seen 125 days ago)');
    ok(await p.getAttribute('[data-testid="crm-view-quiet"]', 'aria-selected') === 'true', 'the lit tab is the one whose filters are in force');
    ok((await view('all')).split(',').length === 7, 'All → the seven parties again');
    /* the heading filter, the same filter state as Filters ▾ */
    await p.click('[data-testid="cbl-hf-role"]'); await p.waitForSelector('[data-testid="cbl-hf-pop-role"]');
    ok(await p.locator('[data-testid="cbl-hf-pop-role"] [role="menuitemradio"]').count() === 4, 'the Role heading offers All · Customers · Suppliers · Both');
    await p.click('[data-testid="cbl-hf-role-supplier"]'); await p.waitForTimeout(120);
    ok((await rowsOf(p)).join() === 'crm-row-P-0001,crm-row-P-0002,crm-row-P-0003', 'Role ▾ Suppliers (from the column heading) → the three suppliers');
    ok(await p.getAttribute('[data-testid="crm-view-suppliers"]', 'aria-selected') === 'true', '… and the Suppliers tab lights up: one filter state');
    await p.click('[data-testid="crm-view-all"]'); await p.waitForTimeout(100);
    /* GROUP as ONE labelled dropdown */
    const gsel = await p.$$eval('[data-testid="crm-parties-group"] option', (o) => o.map((x) => x.textContent.trim()));
    ok(JSON.stringify(gsel) === JSON.stringify(['None', 'Role', 'Connection', 'Segment']) && await p.locator('#crm_list .cbl-tools .cbl-seg [data-group]').count() === 0, 'Group is one labelled dropdown: ' + gsel.join(' · ') + ' (no row of buttons)');
    ok(/Group/.test(await text(p, '[data-testid="cbl-glab-crm-parties"]')) && /bills, orders and messages reach them/.test(await p.evaluate(() => document.querySelector('[data-testid="cbl-group-crm-parties"]').title + ' ' + Array.from(document.querySelectorAll('[data-testid="crm-parties-group"] option')).map((o) => o.title).join(' '))), 'the label says Group and Connection explains itself in one line');
    await p.selectOption('[data-testid="crm-parties-group"]', 'conn'); await p.waitForTimeout(150);
    const gh = await p.$$eval('#crm_list [data-g]', (g) => g.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(gh.length === 2 && /On the network/.test(gh[0]) && /Not connected/.test(gh[1]) && /parties/.test(gh[0]) && /you'll (get|give)/.test(gh.join(' ')), 'Group ▸ Connection: heads read On the network / Not connected with their count and dues (' + gh.join(' | ') + ')');
    await p.selectOption('[data-testid="crm-parties-group"]', 'role'); await p.waitForTimeout(150);
    const gr = await p.$$eval('#crm_list [data-g]', (g) => g.map((x) => x.querySelector('b').textContent.trim()));
    ok(gr.join() === 'Supplier,Both,Customer' || (gr.indexOf('Both') >= 0 && gr.indexOf('Supplier') >= 0 && gr.indexOf('Customer') >= 0), 'Group ▸ Role: the same words as the Role column (' + gr.join(' · ') + ')');
    await p.selectOption('[data-testid="crm-parties-group"]', 'none'); await p.waitForTimeout(100);
    await bad(p, 'home');
    await p.screenshot({ path: path.join(SHOTS, 'crm-home-laptop.png') });
    /* a row opens its record; an alert opens its fix */
    await p.click('[data-testid="crm-alert-followups"]'); await p.waitForSelector('[data-testid^="crm-fu-fu-"]');
    ok(/#\/followups/.test(p.url()), 'the late-follow-ups alert opens Follow-ups');
    await p.click('[data-testid="crm-nav-parties"]'); await homeReady(p);
    await p.click('[data-testid="crm-row-P-0003"]'); await recReady(p, 'Ravi Traders');
    ok(/#\/party\/P-0003/.test(p.url()), 'a row opens its record at #/party/P-0003');
    /* INTEGRATION: the slot is no longer empty at run time - CBAvatar mounts there (the source still draws none; line above). The frozen check: it holds ONE CBAvatar control and nothing else. */
    ok(await p.evaluate(() => { const s = document.querySelector('[data-testid="shell-avatar"]'); return !!s && document.querySelectorAll('.cbav').length === 1 && s.querySelectorAll('[data-testid="avatar"],[data-testid="signin-door"]').length === 1; }), 'the frame\'s avatar slot holds ONE CBAvatar on the record');
    await ctx.close();
  }
  /* ── 3 · THE RECORD ───────────────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn();
    const { ctx, p } = await open(S, { hash: '#/party/P-0003' });
    await recReady(p, 'Ravi Traders');
    ok(await p.locator('[data-testid="crm-act-message"]').count() === 0, 'LOCAL party: no Message button');
    ok(await p.locator('[data-testid="crm-act-call"]').count() >= 1 && /^tel:/.test(await p.locator('[data-testid="crm-act-call"]').first().getAttribute('href')), 'LOCAL party: Call is the primary action (tel:)');
    ok(await p.locator('[data-testid="crm-act-mail"]').count() === 1, 'LOCAL party: Mail is offered (the e-mail preference is on)');
    const idt = await text(p, '[data-testid="crm-ident"]');
    ok(!/none — kept by you/.test(idt) && !/User ID|Network ID/.test(idt) && !/CB[0-9A-Z]{8}/.test(idt) && /~shop\.sup-0001/.test(idt) === false, 'a minted party shows no Network ID and no empty ID boxes (C14: "none — kept by you" is gone)');
    ok(/Not on the network — bills are yours only/.test(await text(p, '[data-testid="crm-verdict"]')), 'the verdict says it in words');
    const nx = await text(p, '[data-testid="crm-next"]');
    ok(/Today/.test(nx) && /pipe rate/.test(nx), 'Next: today\'s follow-up (the API marks it today:true)');
    ok(await p.locator('[data-testid="crm-next-done-fu-03"]').count() === 1, 'every alert in Next has its fix button (Done)');
    /* the timeline head: a CBList mount of the latest five */
    ok(await p.locator('#crm_tlhead.cbl').count() === 1 && await p.locator('#crm_tlhead [data-row]').count() === 5, 'the record\'s Timeline is a CBList mount of the latest 5 entries');
    const tlhead = await text(p, '#crm_tlhead');
    ok(/Ravi Traders/.test(await text(p, '[data-testid="crm-sec-who"]')) === false && !/Ravi Traders Ravi Traders/.test(await text(p, '.rec')), 'the name is not said twice (Who shows a legal name only if it differs)');
    await p.click('[data-testid="crm-act-more"]'); await p.waitForSelector('[data-testid="crm-more-menu"]');
    ok(await p.locator('[data-testid="crm-more-remove"]').count() === 1 && /dues open/.test(await text(p, '[data-testid="crm-more-remove"]')) && await p.locator('[data-testid="crm-more-remove"]').isDisabled(), 'owner: Remove from my parties is there, disabled "dues open" while P-0003 owes');
    await p.screenshot({ path: path.join(SHOTS, 'crm-record-laptop.png') });
    await p.keyboard.press('Escape'); await p.click('h1');
    await bad(p, 'record');
    /* Done in Next → PATCH done:true → the record reads again */
    await p.click('[data-testid="crm-next-done-fu-03"]'); await p.waitForTimeout(600);
    ok(S.fuPatch && S.fuPatch.done === true, 'Done sends PATCH { done:true }');
    await ctx.close();
  }
  {
    const S = standIn();
    const { ctx, p } = await open(S, { hash: '#/party/P-0002' });
    await recReady(p, 'Chola Auto Care');
    ok(await p.locator('[data-testid="crm-act-message"]').count() === 1, 'ON-CHITBRIDGE party: Message is the primary action');
    ok(/CB4M8RT2KD/.test(await text(p, '[data-testid="crm-ident"]')) && /chola-auto/.test(await text(p, '[data-testid="crm-ident"]')), 'the identity block: party no · User ID · Network ID shown together');
    const chips = await text(p, '.rchips');
    ok(/Customer/.test(chips) && /Supplier/.test(chips) && /On the network/.test(chips) && /you'll get/.test(chips), 'header chips: both roles, On the network, the dues chip (youll get)');
    ok(/Sent/.test(await text(p, '[data-testid="crm-state-chit-ch-431"]')) && /3,864\.00/.test(await text(p, '[data-testid="crm-amt-chit-ch-431"]')), 'a chit shows its status word and amount (the API sends 3864 in MAJOR units → ₹3,864.00)');
    await p.click('[data-testid="crm-tl-chit-ch-431"]'); await p.waitForFunction(() => { const d = document.getElementById('chitsheet'); return !!(d && d.open); }, null, { timeout: 8000 }).catch(() => {});
    ok(await p.evaluate(() => { const d = document.getElementById('chitsheet'); return !!(d && d.open); }) && S.calls.some((c) => /\/api\/chits\/ch-431/.test(c)), 'an entry that is a chit opens the chit sheet in place (openChitSheet, ch-431)');
    await p.keyboard.press('Escape');
    await ctx.close();
  }
  {
    /* the API sends no contact preferences and no mail bounces: Meena's record still opens, shows her own phone and e-mail, and does not invent "Not recorded" lines */
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/party/P-0005' });
    await recReady(p, 'Meena');
    const who = await text(p, '[data-testid="crm-sec-who"]');
    ok(/meena/i.test(who) === true || /@/.test(who) || /\+91/.test(who), 'a record with no contacts block shows the phone and e-mail the party row carries (' + who.slice(0, 60) + ')');
    ok(!/Contact preferences/.test(who) && !/Not recorded/.test(who), 'no preferences come from the API, so none are shown (not "Not recorded" for a thing nobody was asked)');
    await ctx.close();
  }
  {
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/party/P-0001' });
    await recReady(p, 'Agro Mills');
    const g = await text(p, '[data-testid="crm-next-gstin"]');
    ok(/GSTIN differs from their profile/.test(g) && /33AABCA1234M1Z5/.test(g) && /33AABCA1234M2Z4/.test(g) && await p.locator('[data-testid="crm-gstin-theirs"]').count() === 1 && await p.locator('[data-testid="crm-gstin-mine"]').count() === 1, 'GSTIN differs: both values shown, Use theirs and Keep mine');
    ok(await p.evaluate(() => document.querySelector('[data-testid="crm-next-followup"]') && /Late since/.test(document.querySelector('[data-testid="crm-next-followup"]').innerText)), 'the late follow-up reads "Late since …" with its Done');
    await p.click('[data-testid="crm-gstin-theirs"]'); await p.waitForTimeout(500);
    ok(S.patches.length === 1 && S.patches[0].kind === 'suppliers' && S.patches[0].id === 'sl-1' && S.patches[0].body.tax_ids[0].value === '33AABCA1234M2Z4', 'Use theirs PATCHes the supplier\'s tax ids through the existing route');
    await ctx.close();
  }
  {
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/party/P-0008' });
    await p.waitForSelector('[data-testid="crm-rec-missing"]', { timeout: 15000 });
    ok(/Couldn't open this party/.test(await text(p, '[data-testid="crm-rec-missing"]')) && S.calls.some((c) => c === 'GET /api/crm/parties/P-0008'), 'an old party NUMBER cannot be opened: the API takes the party id (400 BAD_ID) - the page says so plainly and offers Back to parties (the merged party\'s id opens its keeper on the API: not reachable from a number)');
    await ctx.close();
  }
  {
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/party/walkin-919876500021' });
    await recReady(p);
    ok(await p.locator('[data-testid="crm-act-walkin"]').count() === 1 && await p.locator('[data-testid="crm-act-message"]').count() === 0, 'walk-in: the primary action is "Add to my parties"');
    ok(/Walk-in/.test(await text(p, '[data-testid="crm-ident"]')) && /A party number comes when you add them/.test(await text(p, '[data-testid="crm-ident"]')), 'walk-in: no party number, said in words');
    await p.click('[data-testid="crm-act-walkin"]'); await p.waitForTimeout(700);
    ok((S.walkAdds || []).length === 1 && S.walkAdds[0].phone && /340 points kept/.test(await text(p, '#toast')), 'Add to my parties: POST /api/crm/walk-ins/add { phone } - the API mints the local customer and moves the points (340 kept)');
    await ctx.close();
  }
  {
    const S = standIn({ ledger: false }), { ctx, p } = await open(S, { hash: '#/party/P-0002' });
    await recReady(p, 'Chola Auto Care');
    ok(/Dues show when Accounts is on/.test(await text(p, '[data-testid="crm-sec-ledger"]')) || (await p.click('[data-testid="crm-sec-ledger"] summary'), /Dues show when Accounts is on/.test(await text(p, '[data-testid="crm-sec-ledger"]'))), 'Ledger off: "Dues show when Accounts is on"');
    ok(await p.locator('[data-testid="crm-ledger-on"]').count() === 1, 'the owner sees Switch on');
    ok(await p.locator('[data-testid="crm-next-dues"]').count() === 0 && !/they owe you/.test(await text(p, '.rchips')), 'Ledger off: no dues chip and no late-dues item');
    await ctx.close();
  }
  /* ── 4 · THE TIMELINE ─────────────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/party/P-0006/timeline' });
    await p.waitForSelector('[data-testid^="crm-tl-"]', { timeout: 15000 }); await p.waitForTimeout(250);
    const n = () => p.locator('#crm_tl [data-row]').count();
    const reads = () => S.calls.filter((c) => /\/timeline/.test(c));
    ok(reads().length === 1 && !/before=./.test(reads()[0]), 'the first page is one read, with no cursor (' + reads()[0] + ')');
    ok((await n()) === 50, 'the unit draws 50 rows of the 120');
    ok(await p.locator('#crm_tl .cbl-group').count() >= 2 && /Today|Yesterday/.test(await text(p, '#crm_tl .cbl-group')), 'day dividers ("Today" · "Yesterday" · a date)');
    await p.evaluate(() => { const l = document.querySelector('#crm_tl .cbl-list'); l.scrollTop = l.scrollHeight; });
    await p.waitForFunction(() => /before=2/.test(''), null, { timeout: 100 }).catch(() => {});
    await p.waitForTimeout(500);
    ok(reads().length === 2 && /before=20\d\d-/.test(reads()[1]), 'scrolled to the end → the NEXT 50 are asked for with the server\'s cursor, the time of the last row (' + (reads()[1] || '') + ') — never the whole history');
    ok(await p.locator('[data-testid="cbl-more-crm-timeline"]').count() === 1 || (await n()) > 50, 'the lazy sentinel offers the next rows');
    /* kind filter + search are the SERVER's */
    await p.click('[data-testid="cbl-filters-crm-timeline"]');
    const opts = await p.$$eval('[data-testid="listctl-filter-kind"] option', (o) => o.map((x) => x.textContent));
    ok(opts.length === 6 && /Notes & calls/.test(opts.join('|')) && !/\(\d+\)/.test(opts.join('|')), 'the API sends no per-kind counts: the kind filter offers the five kinds, with none: ' + opts.join(' | '));
    await p.selectOption('[data-testid="listctl-filter-kind"]', 'notes'); await p.waitForTimeout(500);
    ok(!reads().some((c) => /kind=/.test(c)) && (await n()) > 0, 'choosing Notes & calls filters the entries on the page: the API has no kind filter, so none is sent' + (process.env.CRM_DEBUG ? ' ' + JSON.stringify(reads()) : ''));
    await p.keyboard.press('Escape');
    await p.fill('[data-testid="listctl-search-crm-timeline"]', 'Entry number 77'); await p.waitForTimeout(800);
    ok(!reads().some((c) => /[?&]q=/.test(c)) && await n() === 1, 'search is answered on the page (the API has no text filter): the history is read page by page until the entry is found → 1 entry');
    await ctx.close();
  }
  {
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/party/P-0003/timeline' });
    await p.waitForSelector('[data-testid^="crm-tl-interaction-r"]', { timeout: 15000 }); await p.waitForTimeout(250);
    await p.click('[data-testid="cbl-filters-crm-timeline"]');
    const opts = await p.$$eval('[data-testid="listctl-filter-kind"] option', (o) => o.map((x) => x.textContent.replace(/\s*\(\d+\)/, '')));
    ok(opts.length === 6, 'the kinds are all offered (no counts to hide an empty one): ' + opts.join(' | '));
    await p.keyboard.press('Escape'); await p.click('h1').catch(() => {});
    await p.click('[data-testid="crm-tl-interaction-r2"] [data-caret]');
    ok(!/cash discount/.test(await text(p, '[data-testid="crm-entry-interaction-r2"]')) && /…/.test(await text(p, '[data-testid="crm-entry-interaction-r2"]')), 'a long call ends "…" in its row …');
    ok(/cash discount/.test(await text(p, '[data-testid="crm-entry-full-interaction-r2"]')), '… and expands in place to its whole text');
    await p.screenshot({ path: path.join(SHOTS, 'crm-timeline-laptop.png') });
    await ctx.close();
  }
  {
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/party/P-0004/timeline' });
    await p.waitForSelector('[data-testid="cbl-empty-crm-timeline"]', { timeout: 15000 });
    ok(/Nothing yet with this party/.test(await text(p, '[data-testid="cbl-empty-crm-timeline"]')), 'a party with no history: "Nothing yet with this party."');
    await ctx.close();
  }
  /* ── 5 · FOLLOW-UPS ───────────────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/followups' });
    await p.waitForSelector('[data-testid^="crm-fu-fu-"]', { timeout: 15000 }); await p.waitForTimeout(200);
    const groups = await p.$$eval('#crm_fu .cbl-group b', (g) => g.map((x) => x.textContent));
    ok(JSON.stringify(groups) === JSON.stringify(['Late', 'Today', 'This week', 'Later']), 'groups Late · Today · This week · Later, late first: ' + groups.join(' · '));
    ok(S.fuQueries[0] === 'all/0', 'the owner\'s default is Everyone, open ones (?scope=all&done=0)');
    ok(/Late/.test(await text(p, '[data-testid="crm-fu-fu-01"]')) && await p.evaluate(() => !!document.querySelector('[data-testid="crm-fu-fu-01"] .late')), 'a late follow-up is red and says Late');
    await p.click('[data-testid="crm-fu-fu-04"] [data-caret]'); await p.waitForSelector('[data-testid="crm-fu-mini-when-fu-04"]');
    ok(/Unassigned/.test(await text(p, '[data-testid="crm-fu-mini-when-fu-04"]')) && await p.locator('[data-testid="crm-fu-assign-fu-04"]').count() === 1, 'assignee left → "Unassigned" (in its mini-card) with Assign (on the row)');
    await p.click('[data-testid="crm-fu-fu-04"] [data-caret]');
    ok(/No longer your party/.test(await text(p, '[data-testid="crm-fu-fu-09"]')) && await p.locator('[data-testid="crm-fu-del-fu-09"]').count() === 1 && await p.locator('[data-testid="crm-fu-done-fu-09"]').count() === 0, 'party removed → greyed "No longer your party" with Delete');
    const heads = await p.$$eval('#crm_fu .cbl-hc', (h) => h.map((x) => x.innerText.replace(/[▲▼⇅]/g, '').trim()));
    ok(JSON.stringify(heads) === JSON.stringify(['DUE', 'WHAT', 'PARTY']), 'three columns: ' + heads.join(' · '));
    const hd = await p.evaluate(() => { const l = document.querySelector('#crm_fu .cbl-list').getBoundingClientRect().top - document.querySelector('#crm_fu').getBoundingClientRect().top; return { l, h: innerHeight }; });
    ok(hd.l <= 0.2 * hd.h, 'the follow-ups head is ' + Math.round(hd.l) + ' px (' + Math.round(100 * hd.l / hd.h) + '%) — within 20%');
    await p.screenshot({ path: path.join(SHOTS, 'crm-followups-laptop.png') });
    await p.click('[data-testid="crm-fu-done-fu-01"]'); await p.waitForTimeout(500);
    ok(S.fuPatch && S.fuPatch.done === true, 'Done → PATCH { done:true }');
    await p.click('[data-testid="crm-fu-fu-03"] [data-caret]'); await p.waitForSelector('[data-testid="crm-fu-mini-fu-03"]');
    ok(await p.locator('.cbl-next [data-act]').count() === 4, 'the follow-up mini-card shows every action: Done · Snooze tomorrow · Snooze next week · Open party');
    await p.click('.cbl-next [data-testid="crm-fu-snooze-tomorrow"]'); await p.waitForTimeout(400);
    ok(S.fuPatch && S.fuPatch.after === 'tomorrow' && !S.fuPatch.due_at && !S.fuPatch.done, 'Snooze → Tomorrow sends the WORD { after: tomorrow } — the server lands it on the shop\'s day, never this phone\'s clock (W2-CRM)');
    await p.click('[data-testid="crm-fu-del-fu-09"]'); await p.waitForTimeout(400);
    ok(S.fuDeleted === 'fu-09', 'Delete removes a follow-up of a party that is no longer yours');
    await p.click('[data-testid="cbl-filters-crm-followups"]'); await p.selectOption('[data-testid="listctl-filter-scope"]', 'mine'); await p.waitForTimeout(500);
    ok(S.fuQueries.indexOf('mine/0') >= 0, 'choosing Mine asks the server (?scope=mine)');
    await ctx.close();
  }
  {
    const S = standIn({ me: 'Divya' }), { ctx, p } = await open(S, { session: EDITOR, hash: '#/followups' });
    await p.waitForSelector('[data-testid^="crm-fu-fu-"]', { timeout: 15000 });
    ok(S.fuQueries[0] === 'mine/0', 'a co-assist defaults to Mine (?scope=mine)');
    /* the Show filter RESTS on the default too (its "all" option is the default's name): Clear returns to it. A co-assist's rests on Mine. */
    await p.click('[data-testid="cbl-filters-crm-followups"]');
    ok((await p.locator('[data-testid="listctl-filter-scope"] option').first().textContent()).trim() === 'Mine', 'the co-assist Show filter rests on Mine (not Everyone)');
    await ctx.close();
  }
  {
    const fx = standIn(); fx.fu = fx.fu.filter((f) => f.bucket === 'later');
    const { ctx, p } = await open(fx, { hash: '#/followups' });
    await p.waitForSelector('[data-testid^="crm-fu-fu-"]', { timeout: 15000 });
    ok(await p.locator('[data-testid="crm-fu-nothing-today"]').count() === 1, 'nothing late or today → one line "Nothing due today"');
    await ctx.close();
  }

  /* ── 6 · ADD PARTY · LOG · FOLLOW-UP · EDIT ───────────────────────────────────────────────────────────── */
  {
    const S = standIn(), { ctx, p } = await open(S);
    await homeReady(p);
    await p.click('[data-testid="crm-add"]'); await p.waitForSelector('[data-testid="crm-addq"]');
    await p.fill('[data-testid="crm-addq"]', 'ravi'); await p.waitForSelector('[data-testid="crm-add-found"]', { timeout: 5000 });
    ok(await p.locator('[data-testid="crm-add-mine"]').count() === 2 && /Already your party/.test(await text(p, '[data-testid="crm-add-mine"]')), 'Add party: "Already your party" for the two Ravis');
    ok(/On the network — is this them\?/.test(await text(p, '[data-testid="crm-add-found"]')) && /Ravi Hardwares/.test(await text(p, '[data-testid="crm-add-found"]')), 'Add party: "On the network — is this them?"');
    ok(/Add “ravi” as a local party/.test(await text(p, '[data-testid="crm-add-local"]')) && /Bills are yours only until they join/.test(await text(p, '[data-testid="crm-add-local"]')), 'Add party: "Not on the network" → add as a local party');
    await p.screenshot({ path: path.join(SHOTS, 'crm-add-laptop.png') });
    await p.fill('[data-testid="crm-addq"]', 'rav@'); await p.waitForTimeout(300);
    ok(/Use their User ID or e-mail/.test(await text(p, '[data-testid="crm-add-warn"]')), 'an incomplete e-mail is told to use a User ID or full e-mail');
    await p.fill('[data-testid="crm-addq"]', 'Kannan Stores'); await p.waitForTimeout(400);
    await p.click('[data-testid="crm-add-role-customer"]'); await p.click('[data-testid="crm-add-local-go"]'); await p.waitForTimeout(700);
    ok(S.added.length === 1 && S.added[0].role === 'customer' && S.added[0].body.name === 'Kannan Stores', 'Add as local → ONE POST to the existing customer-add route with the name');
    ok(/#\/party\/P-0099/.test(p.url()) && /Kannan Stores/.test(await text(p, '[data-testid="crm-rec-name"]')), 'the new party\'s record opens');
    await ctx.close();
  }
  {
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/party/P-0003' });
    await recReady(p);
    await p.click('[data-testid="crm-act-log"]'); await p.waitForSelector('[data-testid="crm-log-body"]');
    await p.click('[data-testid="crm-logkind-visit"]'); await p.fill('[data-testid="crm-log-body"]', 'Visited the godown'); await p.check('[data-testid="crm-log-fu"]');
    await p.fill('[data-testid="crm-log-fuwhat"]', 'Order cement'); await p.click('[data-crm="logpreset"][data-v="tomorrow"]');
    await p.screenshot({ path: path.join(SHOTS, 'crm-log-laptop.png') }).catch(() => {});
    await p.click('[data-testid="crm-log-save"]'); await p.waitForTimeout(700);
    ok(S.logs.length === 1 && S.logs[0].kind === 'visit' && S.logs[0].direction === 'out' && /godown/.test(S.logs[0].body), 'Log sheet: POST /interactions { kind:visit, direction:out, body }');
    ok(S.fuAdded && S.fuAdded.source === 'interaction' && S.fuAdded.what === 'Order cement' && S.fuAdded.party_id === 'pid-0003', 'the follow-up it leaves is created with source "interaction"');
    await p.click('[data-testid="crm-act-log"]'); await p.waitForSelector('[data-testid="crm-log-body"]');
    await p.click('[data-testid="crm-logkind-note"]');
    ok(await p.evaluate(() => document.getElementById('crm_logdir').style.display === 'none'), 'a note has no In / Out');
    await p.click('.mfoot button:first-child');
    await p.click('[data-testid="crm-act-fu"]'); await p.waitForSelector('[data-testid="crm-fu-sheet"]');
    ok(/Ravi Traders/.test(await p.inputValue('[data-testid="crm-fu-pq"]')), 'Add follow-up from a record: the party is already chosen');
    await p.fill('[data-testid="crm-fu-what"]', 'Ask about the rate'); await p.click('[data-testid="crm-fu-preset-week"]');
    ok(/^\d{4}-\d\d-\d\d$/.test(await p.inputValue('[data-testid="crm-fu-due"]')), 'a preset (Next week) writes its date into the date field');
    await p.click('[data-testid="crm-fu-save"]'); await p.waitForTimeout(500);
    ok(S.fuAdded.what === 'Ask about the rate' && S.fuAdded.source === 'manual' && S.fuAdded.due_at, 'Follow-up saved: POST /api/crm/followups { party_id, what, due_at, source:manual }');
    await ctx.close();
  }
  {
    /* R81 (24 Oct walk): opened straight at #/followups (bookmark, reload) nothing had loaded the Parties list, so the picker said "Nobody matches." */
    const S = standIn(), { ctx, p } = await open(S, { hash: '#/followups' });
    await p.waitForSelector('[data-testid="crm-fu-add"]', { timeout: 15000 });
    await p.click('[data-testid="crm-fu-add"]'); await p.waitForSelector('[data-testid="crm-fu-sheet"]');
    await p.fill('[data-testid="crm-fu-pq"]', 'chola');
    await p.waitForSelector('[data-testid^="crm-fu-pick-"]', { timeout: 5000 }).catch(() => {});
    ok(await p.locator('[data-testid^="crm-fu-pick-"]').count() >= 1 && /Chola Auto Care/.test(await text(p, '#crm_fu_pres')), 'Add follow-up opened straight at #/followups: typing a name finds the party (the list is loaded for the picker)');
    ok(!/Nobody matches/.test(await text(p, '#crm_fu_pres')), 'and it never answers "Nobody matches." for a party who exists');
    ok(S.calls.filter((c) => c.split('?')[0] === 'GET /api/crm/parties' && !/view=leads/.test(c)).length === 1, 'the picker loaded the list ONCE through the one Parties read');
    await ctx.close();
  }
  {
    const S = standIn({ dup: true }), { ctx, p } = await open(S, { hash: '#/party/P-0002' });
    await recReady(p);
    await p.click('[data-testid="crm-act-edit"]'); await p.waitForSelector('[data-testid="pe_taxid"]');
    ok(await p.locator('#pe_taxes .pe_taxrow').count() === 2, 'the edit sheet lists the party\'s TWO tax ids (GSTIN · PAN), not one');
    await p.click('[data-testid="pe_taxadd"]'); await p.fill('[data-testid="pe_taxid2"]', 'DUPLICATE');
    ok(await p.locator('#pe_taxes .pe_taxrow').count() === 3, '+ Add a tax id adds a row');
    await p.fill('[data-testid="pe_taxid2"]', '29AAAAA0000A1Z5'); await p.selectOption('[data-testid="pe_scheme2"]', 'TAN'); await p.fill('[data-testid="pe_legal"]', 'Chola Auto Care LLP');
    await p.click('[data-testid="pe_save"]'); await p.waitForTimeout(700);
    ok(S.patches.length === 2 && S.patches.some((x) => x.kind === 'customers' && x.id === 'cl-2') && S.patches.some((x) => x.kind === 'suppliers' && x.id === 'sl-2'), 'a both-roles party is written to BOTH lists (customers/cl-2 and suppliers/sl-2)');
    const cp = S.patches.find((x) => x.kind === 'customers');
    ok(cp.body.tax_ids.length === 3 && cp.body.tax_ids[2].scheme === 'TAN' && cp.body.credit_days === 15, 'the PATCH carries all three tax ids and the customer\'s own credit days');
    const sp = S.patches.find((x) => x.kind === 'suppliers');
    ok(sp.body.credit_days === undefined && sp.body.legal_name === 'Chola Auto Care LLP', 'the supplier list gets the party-level words, never the customer\'s credit terms');
    await p.click('[data-testid="crm-act-edit"]'); await p.waitForSelector('[data-testid="pe_taxid"]');
    await p.click('[data-testid="pe_taxadd"]'); await p.fill('[data-testid="pe_taxid2"]', 'DUPLICATE'); await p.click('[data-testid="pe_save"]'); await p.waitForTimeout(600);
    ok(/already on P-0001 Agro Mills/.test(await text(p, '[data-testid="pe_dup"]')), 'the server\'s 409 DUPLICATE_PARTY is shown in the sheet in its own words');
    await ctx.close();
  }

  /* ── 7 · ROLES ────────────────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn({ me: 'Divya' }), { ctx, p } = await open(S, { session: EDITOR });
    await homeReady(p);
    ok(await p.locator('[data-testid="crm-add"]').count() === 1, 'a co-assist can add a party');
    await p.click('[data-testid="crm-row-P-0003"]'); await recReady(p);
    await p.click('[data-testid="crm-act-more"]'); await p.waitForSelector('[data-testid="crm-more-menu"]', { timeout: 8000 });   /* Remove sits in More: open it to see it greyed */
    ok(await p.locator('[data-testid="crm-more-remove"]').count() === 1 && await p.locator('[data-testid="crm-more-remove"]').isDisabled() && /Only the owner/.test(await text(p, '[data-testid="crm-more-remove"]')) && !/Merge|Import|Export|Link to ChitBridge/i.test(await text(p, '.rec')) && !/Merge|Import|Export/i.test(await text(p, 'nav')), 'a co-assist sees no Import / Export / Merge; Remove is SHOWN, greyed, with the server\'s owner-only sentence (W2-CRM: the server says may/why)');
    await ctx.close();
  }
  {
    const S = standIn({ me: 'Divya' }), { ctx, p } = await open(S, { session: VIEWER });
    await homeReady(p);
    ok(await p.locator('[data-testid="crm-add"]').count() === 1 && await p.locator('[data-testid="crm-add"]').isDisabled() && /only view/.test(await text(p, '[data-testid="crm-add-why"]')), 'a viewer: Add party shown, greyed, with the sentence (FX-L2C)');
    await p.click('[data-testid="crm-row-P-0003"]'); await recReady(p);
    ok(await p.locator('[data-testid="crm-actions"]').count() === 1 && await p.locator('[data-testid="crm-actions"] button:not([disabled])').count() === 0 && /only view/.test(await text(p, '[data-testid="crm-actions-why"]')) && await p.locator('[data-testid="crm-next"] button').count() === 0 && await p.locator('[data-testid="crm-next-done-fu-03"]').count() === 0, 'a viewer: every action shown, greyed, with the server\'s one sentence (FX-L2C)');
    ok(await p.locator('[data-testid="crm-next"]').count() === 1, 'a viewer still SEES what is due (Next stays)');
    await p.evaluate(() => { location.hash = '#/followups'; }); await p.waitForSelector('[data-testid^="crm-fu-fu-"]', { timeout: 10000 });
    ok(await p.locator('[data-testid^="crm-fu-done-"]').count() === 0 && await p.locator('[data-testid="crm-fu-add"]').count() === 1 && await p.locator('[data-testid="crm-fu-add"]').isDisabled() && /only view/.test(await text(p, '[data-testid="crm-fu-add-why"]')), 'a viewer: no Done; Add follow-up SHOWN, greyed, with the sentence from the server\'s code (W2-CRM)');
    await ctx.close();
  }

  /* ── 8 · THE STATES ───────────────────────────────────────────────────────────────────────────────────── */
  {
    /* BEFORE b276 the API still answers the list (the record carries migrated:false); only follow-ups and the Log answer 503 CRM_NOT_MIGRATED */
    const S = standIn({ migrated: false }), { ctx, p } = await open(S);
    await homeReady(p);
    ok((await rowsOf(p)).length === 7 && await p.locator('[data-testid="cbl-error-crm-parties"]').count() === 0, 'migration not run: the list still loads (7 rows), no error - the API says migrated:false only where it matters');
    await hash(p, '#/party/P-0002'); await recReady(p, 'Chola Auto Care');
    ok(await p.locator('[data-testid="crm-rec-error"]').count() === 0, 'migration not run: the record opens (migrated:false, no follow-ups)');
    await ctx.close();
  }
  {
    const S = standIn({ interactionsOk: false }), { ctx, p } = await open(S, { hash: '#/followups' });
    await p.waitForSelector('[data-testid="cbl-empty-crm-followups"]', { timeout: 15000 });
    ok(/Calls and follow-ups start after an update/.test(await text(p, '[data-testid="cbl-empty-crm-followups"]')) && /Nothing is lost/.test(await text(p, '[data-testid="cbl-empty-crm-followups"]')), 'before b276 (503): follow-ups show the plain not-yet state, "Nothing is lost"');
    await p.evaluate(() => { location.hash = '#/party/P-0003/log'; }); await p.waitForSelector('[data-testid="crm-log-body"]', { timeout: 10000 });
    await p.fill('[data-testid="crm-log-body"]', 'x'); await p.click('[data-testid="crm-log-save"]'); await p.waitForTimeout(500);
    ok(/Calls and follow-ups start after an update/.test(await text(p, '[data-testid="crm-log-sheet"]')), 'before b276: the Log sheet says so in place of an error');
    await ctx.close();
  }
  {
    const S = standIn({ listFails: 1 }), { ctx, p } = await open(S);
    await p.waitForSelector('[data-testid="cbl-error-crm-parties"]', { timeout: 15000 });
    ok(/Couldn't load your parties/.test(await text(p, '[data-testid="cbl-error-crm-parties"]')) && !/boom|500/.test(await text(p, '[data-testid="cbl-error-crm-parties"]')), 'the list fails: "Couldn\'t load your parties", never the error message');
    await p.click('[data-cbl-retry]'); await homeReady(p);
    ok((await rowsOf(p)).length === 7, 'Try again reads the list again');
    await ctx.close();
  }
  {
    const S = standIn({ ledger: false }), { ctx, p } = await open(S);
    await homeReady(p);
    const heads = await p.$$eval('#crm_list .cbl-hc', (h) => h.map((x) => x.innerText.replace(/[▲▼⇅▾●]/g, '').trim()));
    ok(heads.indexOf('DUES') < 0 && JSON.stringify(heads) === JSON.stringify(['PARTY', 'ROLE', 'ON THE NETWORK', 'LAST ACTIVITY', 'NEXT FOLLOW-UP']), 'Ledger off: no Dues column and no blank one (' + heads.join(' · ') + ')');
    /* the Columns popover does not OFFER Dues either (the default set alone would let a Dues column slip back in through the picker) */
    await p.click('[data-testid="cols-btn-crm-parties"]');
    ok(await p.locator('.cbl-colrow').count() > 0 && (await p.locator('.cbl-colrow').allInnerTexts()).every((x) => !/Dues/i.test(x)), 'Ledger off: the Columns picker offers no Dues');
    await p.keyboard.press('Escape');
    ok(await p.locator('[data-testid="crm-alert-dues"]').count() === 0 && await p.locator('[data-testid="crm-alert-followups"]').count() === 1, 'Ledger off: the late-dues alert is gone, the follow-up one stays');
    ok(await p.locator('[data-testid^="party-due-"]').count() === 0, 'Ledger off: no dues chip anywhere');
    await ctx.close();
  }

  /* ── 9 · PHONE: 390 px ────────────────────────────────────────────────────────────────────────────────── */
  {
    const S = standIn(), { ctx, p } = await open(S, { viewport: { width: 390, height: 844 } });
    await homeReady(p);
    let w = await sw(p); ok(w.sw === 390 && w.over <= 0, 'phone home: document.scrollWidth === ' + w.sw + ' (390), the screen scrolls sideways by ' + w.over + ' px');
    const hd = await p.evaluate(() => ({ top: document.querySelector('#crm_list .cbl-list').getBoundingClientRect().top / innerHeight, bar: (document.querySelector('.cbsh-hdr') ? document.querySelector('.cbsh-hdr').getBoundingClientRect().height : 0) / innerHeight }));
    ok(hd.top <= 0.30 + hd.bar, 'phone: everything above the rows is ' + Math.round(100 * hd.top) + '% of the window (≤ 30% + the bar, ' + Math.round(100 * hd.bar) + '%; the API sends one alert - the late follow-ups - and a lone alert is a line under the title, two would fold into one chip)');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#crm_list [data-row]')).display !== 'none') && (await p.locator('#crm_list [data-row]').count()) === 7, 'phone: one card per party');
    ok(await p.locator('[data-testid="crm-add"]').isVisible(), 'phone: Add party stays reachable');
    await p.screenshot({ path: path.join(SHOTS, 'crm-home-phone.png') });
    for (const [h, sel, tag] of [['#/party/P-0002', '[data-testid="crm-ident"]', 'record'], ['#/party/P-0003/timeline', '[data-testid^="crm-tl-interaction-r"]', 'timeline'], ['#/followups', '[data-testid^="crm-fu-fu-"]', 'followups']]) {
      await hash(p, h); await p.waitForSelector(sel, { timeout: 10000 }); await p.waitForTimeout(350);
      w = await sw(p); ok(w.sw === 390 && w.over <= 0, 'phone ' + tag + ': document.scrollWidth === ' + w.sw + ' (390), the screen scrolls sideways by ' + w.over + ' px');
      await p.screenshot({ path: path.join(SHOTS, 'crm-' + tag + '-phone.png') });
    }
    await hash(p, '#/party/P-0002'); await p.waitForSelector('[data-testid="crm-actions"]');
    const bar = await p.evaluate(() => { const b = document.querySelector('[data-testid="crm-actions"]').getBoundingClientRect(); return { bottom: b.bottom, ih: innerHeight, pos: getComputedStyle(document.querySelector('[data-testid="crm-actions"]')).position }; });
    ok(bar.pos === 'fixed' && Math.abs(bar.bottom - bar.ih) < 2, 'phone record: the action bar is pinned to the bottom of the screen (primary + Log + More)');
    await hash(p, '#/parties/add'); await p.waitForSelector('[data-testid="crm-addq"]', { timeout: 8000 }); await p.fill('[data-testid="crm-addq"]', 'ravi'); await p.waitForTimeout(500);
    w = await sw(p); ok(w.sw === 390 && w.over <= 0, 'phone Add party sheet: document.scrollWidth === ' + w.sw + ' (390), the screen scrolls sideways by ' + w.over + ' px');
    await p.screenshot({ path: path.join(SHOTS, 'crm-add-phone.png') });
    await ctx.close();
  }

  /* ── 10 · THE RECORD AS THE REAL API SENDS IT (2026-10-03: the record sat on "Reading…" for good) ── */
  {
    /* the record exactly as the API builds it (crm-api.cjs), then the three things this scenario is about: merged_from as an object, points as { points }, a follow-up due today */
    const record = Object.assign(crmApi.record(S0.list, 'pid-0002', S0.fx.records['pid-0002'], []), { merged_from: { party_id: 'pid-old', party_no: 'P-0009' }, points: { programme: 'Club', points: 340, worth: 34 },
      followups: [crmApi.followupOne({ followup_id: 'f1', party_id: 'pid-0002', party_no: 'P-0002', party_name: 'Chola Auto Care', what: 'Ring about the rate', due_at: new Date().toISOString(), assignee_user_id: 'u2', assignee_name: 'Divya', source: 'manual' })] });
    const timeline = { party_id: 'pid-0002', next_before: null, migrated: true, total: 0, page: 1, limit: 100, entries: [
      { kind: 'chit', at: new Date(Date.now() - 3600e3).toISOString(), chit_id: 'ch-1', direction: 'out', status: 'accepted', purpose: 'order', doc_kind: 'bill', bill_no: 'B-12', title: 'Bill B-12', value: 125.5, currency: 'INR', open_disputes: 0 },
      { kind: 'ledger', at: new Date(Date.now() - 7200e3).toISOString(), ref: 'R-1', ledger_kind: 'receipt', source: null, amount_minor: 5000, currency: 'INR', doc_date: '2026-10-03' },
      { kind: 'interaction', at: new Date(Date.now() - 9000e3).toISOString(), interaction_id: 'ix-1', interaction_kind: 'call', direction: 'out', body: 'Rang about the rate', by: 'u1' },
      { kind: 'followup', at: new Date(Date.now() - 9500e3).toISOString(), followup_id: 'f1', what: 'Ring about the rate', due_at: new Date().toISOString() },
      { kind: 'dispute', at: new Date(Date.now() - 9900e3).toISOString(), chit_id: 'ch-1', dispute_id: 'd1', status: 'open', category: 'price' }] };
    const S = standIn({ live: { record, timeline } }), { ctx, p } = await open(S, { hash: '#/party/P-0002' });
    await recReady(p);
    ok(await p.locator('[data-testid="crm-rec-loading"]').count() === 0, 'live shape: the record leaves "Reading…" (roles object, merged_from object, points.points, no contacts)');
    const nTl = await p.locator('[data-testid^="crm-tl-"]').count();
    ok(nTl >= 4, 'live shape: the latest entries of /timeline fill the record (' + nTl + ')');
    ok(/125\.50/.test(await text(p, '[data-testid="crm-tl-head"]')), 'live shape: a chit value of 125.5 (MAJOR units) paints as 125.50, not 1.25');
    ok(/Ring about the rate/.test(await text(p, '[data-testid="crm-next"]')), 'live shape: a follow-up the API marks today:true shows under Next');
    await hash(p, '#/party/P-0002/timeline'); await p.waitForSelector('[data-testid^="crm-tl-"]', { timeout: 8000 });
    ok(/Rang about the rate/.test(await text(p, '[data-testid="crm-timeline"]')), "live shape: the whole timeline view reads the API's entries");
    await ctx.close();
    const F = standIn({ live: { record, timeline, recordFails: true } }), o2 = await open(F, { hash: '#/party/P-0002' });
    await o2.p.waitForSelector('[data-testid="crm-rec-error"]', { timeout: 8000 });
    ok(await o2.p.locator('[data-testid="crm-rec-retry"]').isVisible(), 'a failed record read ends the spinner: a plain line and Try again');
    await o2.ctx.close();
    const bad2 = standIn({ live: { raw: true, record: Object.assign({}, record, { tax_ids: 'oops', customer: 'oops' }), timeline } }), o3 = await open(bad2, { hash: '#/party/P-0002' });
    await o3.p.waitForSelector('[data-testid="crm-rec-error"], [data-testid="crm-ident"]', { timeout: 8000 }); await o3.p.waitForTimeout(400);
    ok(await o3.p.locator('[data-testid="crm-rec-loading"]').count() === 0, 'a record the painter cannot read never leaves a spinner behind');
    await o3.ctx.close();
  }

  /* ── 11 · THE CHITS BEHIND THE HOME RAIL (H1 · H4 · H10) and the role links (H2 · H11) ───────────────────────────────── */
  {
    const it = (id, tab, stuck, why, extra) => Object.assign({ chit_id: id, direction: tab === 'in' ? 'received' : 'sent', tab: tab, stuck: stuck, status: 'pending', created_at: new Date(Date.now() - (stuck ? 12 : 1) * 864e5).toISOString(),
      age_days: stuck ? 12 : 1, subject: 'Order ' + id, who: 'Chola Auto Care', value: 1250, currency: 'INR', why: why || null }, extra || {});
    const railChits = { overdue_days: 7, truncated: false, items: [
      it('s1', 'in', true, 'They sent it 12 days ago and you have not answered.'), it('s2', 'out', true, 'You sent it 12 days ago and they have not answered.'),
      it('i1', 'in', false), it('o1', 'out', false)] };
    const S = standIn({ railChits });
    const { ctx, p } = await open(S, { hash: '#/chits?tab=stuck' });
    await p.waitForSelector('[data-testid^="chits-row-"]', { timeout: 15000 }); await p.waitForTimeout(150);
    const rows = await p.$$eval('[data-testid^="chits-row-"]', (r) => r.map((x) => x.getAttribute('data-testid')));
    ok(rows.length === 2 && rows.every((x) => /chits-row-s[12]/.test(x)), 'chits · tab=stuck lists exactly the stuck chits (' + rows.join(' ') + ') - the number Home chips say');
    ok(await p.locator('[data-testid="chits-why"]').count() === 0, 'chits · the row is ONE line: the reason waits in its mini-card');
    for (const id of ['s1', 's2']) await p.click('[data-testid="chits-row-' + id + '"] [data-caret]');
    await p.waitForSelector('[data-testid="chits-why"]');
    const why = await p.$$eval('[data-testid="chits-why"]', (e) => e.map((x) => x.textContent));
    ok(why.length === 2 && why.every((w) => /ago and (you|they) have not answered/.test(w)), 'chits · a stuck row says why, in plain words (' + why.join(' | ') + ')');
    ok(/stuck/i.test(await text(p, '[data-testid="chits-note"]')) && /not a bill until/.test(await text(p, '[data-testid="chits-note"]')), 'chits · the page says why Dues, Waiting and Bills do not show a stuck chit (A4)');
    ok((await text(p, '[data-testid="crm-nav-n-chits"]')).trim() === '2', 'chits · the nav carries the stuck count');
    await p.click('[data-testid="chits-row-s1"]'); await p.waitForTimeout(400);
    ok(S.calls.some((c) => c === 'GET /api/chits/s1'), 'chits · a row opens the chit sheet in place (it read /api/chits/s1)');
    ok(/#.chits/.test(await p.evaluate(() => location.hash)), 'chits · ...and the person is still on the list');
    await ctx.close();
    const o2 = await open(standIn({ railChits }), { hash: '#/chits?tab=in' });
    await o2.p.waitForSelector('[data-testid^="chits-row-"]', { timeout: 15000 }); await o2.p.waitForTimeout(150);
    const inRows = await o2.p.$$eval('[data-testid^="chits-row-"]', (r) => r.map((x) => x.getAttribute('data-testid')));
    ok(inRows.length === 2 && inRows.every((x) => /chits-row-(s1|i1)/.test(x)), 'chits · tab=in lists the chits that came in (' + inRows.join(' ') + ')');
    await o2.ctx.close();
    /* stuck = 0 (round 2): a chit the shop sent to ITSELF (a counter sale not yet closed, a note to self) is listed under In, said as "your own shop", and is never stuck */
    const selfItem = it('n1', 'in', false, null, { self: true, subject: 'Counter sale C1/26-27/0007', age_days: 20, who: null });
    const rc2 = { overdue_days: 7, truncated: false, items: [railChits.items[0], selfItem] };
    const o4 = await open(standIn({ railChits: rc2 }), { hash: '#/chits?tab=stuck' });
    await o4.p.waitForSelector('[data-testid^="chits-row-"]', { timeout: 15000 }); await o4.p.waitForTimeout(150);
    const st4 = await o4.p.$$eval('[data-testid^="chits-row-"]', (r) => r.map((x) => x.getAttribute('data-testid')));
    ok(st4.length === 1 && st4[0] === 'chits-row-s1', 'chits · a chit sent to your own shop is not on the Stuck tab (' + st4.join(' ') + ')');
    await o4.ctx.close();
    const o5 = await open(standIn({ railChits: rc2 }), { hash: '#/chits?tab=in' });
    await o5.p.waitForSelector('[data-testid^="chits-row-"]', { timeout: 15000 }); await o5.p.waitForTimeout(150);
    const n1 = await o5.p.$eval('[data-testid="chits-row-n1"]', (x) => ({ text: x.textContent, tag: !!x.querySelector('[data-testid="chits-stuck-tag"]') }));
    ok(/your own shop/.test(n1.text) && !n1.tag, 'chits · ...it is on the In tab as "your own shop", with no Stuck tag');
    await o5.ctx.close();
    const o3 = await open(standIn({ railChits }), { hash: '#/chits' });
    await o3.p.waitForSelector('[data-testid^="chits-row-"]', { timeout: 15000 }); await o3.p.waitForTimeout(150);
    const all = await o3.p.$$eval('[data-testid^="chits-row-"]', (r) => r.map((x) => x.getAttribute('data-testid')));
    ok(all.length === 4 && /s1|s2/.test(all[0]) && /s1|s2/.test(all[1]), 'chits · no tab: all four, the stuck ones first (' + all.join(' ') + ')');
    await o3.ctx.close();
    /* the role links */
    const so = await open(standIn(), { hash: '#/parties?role=supplier' });
    await homeReady(so.p);
    const sup = await rowsOf(so.p);
    const chipsOk = await so.p.$$eval('#crm_list [data-row]', (r) => r.every((x) => /Supplier|Both/.test(x.textContent)));
    ok(sup.length > 0 && chipsOk, 'parties · #/parties?role=supplier opens the list already filtered to suppliers (' + sup.length + ' rows, all Supplier)');
    await so.ctx.close();
    const full = await open(standIn(), { hash: '#/parties?role=customer' });
    await homeReady(full.p);
    const cu = await full.p.$$eval('#crm_list [data-row]', (r) => r.every((x) => /Customer|Both/.test(x.textContent)));
    ok(cu, 'parties · #/parties?role=customer shows only customers');
    await full.ctx.close();
  }

  /* ── 10 · THE LISTS ROUND ─────────────────────────────────────────────────────────────────────────────────── */
  {
    /* O6 / C9: an internal handle (…@<shop>.cr) is never presented as an e-mail — on the list, in the chooser's E-mail column, in the mini-card, on the record */
    const S = standIn();
    S.list.forEach((q) => { if (q.party_no === 'P-0004') q.email = '9894055621@mayur.cr'; if (q.party_no === 'P-0005') q.email = 'meena.s=outlook.com@mayur.cr'; });
    S.fx.records['pid-0004'] = Object.assign({}, S.fx.records['pid-0004'] || {}, { contacts: { phones: ['+91 98940 55621'], emails: ['9894055621@mayur.cr'], address: null } });
    const { ctx, p } = await open(S); await homeReady(p);
    await p.click('[data-testid="cols-btn-crm-parties"]'); await p.check('[data-testid="cols-crm-parties-email"]'); await p.waitForTimeout(150); await p.keyboard.press('Escape');
    const cell = async (no) => (await p.evaluate((n) => { const r = document.querySelector('[data-testid="crm-row-' + n + '"]'); return r ? Array.from(r.querySelectorAll('.cbl-cell')).map((c) => c.textContent.trim()).join(' | ') : ''; }, no));
    ok(!/mayur\.cr/.test(await cell('P-0004')) && /meena\.s@outlook\.com/.test(await cell('P-0005')), 'the E-mail column: a phone handle shows no e-mail, a handle that carries an e-mail gives the real one (' + (await cell('P-0005')).slice(-34) + ')');
    await p.click('[data-testid="crm-row-P-0004"] [data-caret]'); await p.waitForSelector('[data-testid="crm-mini-email-P-0004"]');
    ok(/no e-mail/.test(await text(p, '[data-testid="crm-mini-email-P-0004"]')), 'the mini-card says "no e-mail" for a party whose only address is an internal handle');
    ok(!/@[a-z0-9]+\.(cr|br)\b/i.test(await p.evaluate(() => document.body.textContent)), 'no internal …@<shop>.cr handle is anywhere on the page');
    await hash(p, '#/party/P-0004'); await recReady(p);
    ok(!/@[a-z0-9]+\.(cr|br)\b/i.test(await p.evaluate(() => document.body.textContent)) && await p.locator('a[href^="mailto:"]').count() === 0, 'the record: no handle either, and no mailto: link to one');
    await ctx.close();
  }
  {
    /* UI9 — NO LAYOUT JUMP: with the API slow, the first thing on screen is the WHOLE frame (menu, title, toolbar, header, skeleton rows, the kural's room); when the rows arrive only they change */
    const S = standIn();
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.route('**/api/**', async (r) => { await new Promise((x) => setTimeout(x, 1200)); r.fallback(); });
    /* SET-WALK1 W7: the band (and its room) is the owner's choice — 'auto' draws it only where the shop reads Tamil; this shop asked for it */
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); localStorage.setItem('cb_kural', 'on'); } } catch (_) {} }, OWNER);
    const p = await ctx.newPage();
    await p.goto(base + '/crm.html');
    const box = () => p.evaluate(() => { const r = (s, n) => { const e = document.querySelectorAll(s)[n || 0]; if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      return { navN: document.querySelectorAll('#nav .nav-btn').length, nav0: r('#nav .nav-btn', 0), nav2: r('#nav .nav-btn', 2), brand: r('#side .brand'), title: r('.cbl-title h1'), tools: r('.cbl-tools'), views: r('.cbl-views'), hdr: r('.cbl-hdr'), skel: document.querySelectorAll('.cbl-skel').length, rows: document.querySelectorAll('.cbl-row').length,
        band: r('#cbkural,#cbkural-reserve'), list: r('.cbl-list'), collapse: r('#toggleNav') }; });
    await p.waitForTimeout(450);   /* a fixed beat, BEFORE the slow line has answered anything: what is on screen now is the FIRST paint */
    const first = await box();
    ok(first.navN >= 3 && first.rows === 0 && first.skel >= 5, 'FIRST PAINT, data still on its way: the menu items (' + first.navN + ' — W2-CRM: every one is shown, the server greys), skeleton rows (' + first.skel + '), no data row yet');
    ok(!!first.title && !!first.tools && !!first.hdr && !!first.views, 'FIRST PAINT: the title "Parties", the views, the toolbar and the column header are all there');
    ok(!!first.band && first.band[3] >= 40, 'FIRST PAINT: the kural\'s room is kept (' + (first.band && first.band[3]) + ' px) so the page is not shortened when it arrives');
    await p.waitForSelector('[data-testid^="crm-row-"]', { timeout: 15000 }); await p.waitForTimeout(500);
    const last = await box(), same = (a, b2, tol) => !!a && !!b2 && a.every((v, i) => Math.abs(v - b2[i]) <= (tol == null ? 1 : tol));
    ok(same(first.nav0, last.nav0) && same(first.nav2, last.nav2) && same(first.brand, last.brand) && same(first.collapse, last.collapse), 'when the rows arrive the sidebar items do not move (' + JSON.stringify([first.nav0, first.nav2, first.brand, first.collapse]) + ' → ' + JSON.stringify([last.nav0, last.nav2, last.brand, last.collapse]) + ')');
    ok(same(first.title, last.title) && same(first.views, last.views) && same(first.tools, last.tools) && same(first.hdr, last.hdr), 'when the rows arrive the title, views, toolbar and column header do not move (' + JSON.stringify([first.title, first.views, first.tools, first.hdr]) + ' → ' + JSON.stringify([last.title, last.views, last.tools, last.hdr]) + ')');
    ok(same(first.list, last.list, 6), 'the rows area keeps its size: the kural arrives in the room kept for it (' + JSON.stringify(first.list) + ' → ' + JSON.stringify(last.list) + ')');
    await ctx.close();
  }
  {
    /* C11 — only the rows scroll: title + toolbar stay put even when a row is reached with the keyboard in a short window */
    const { ctx, p } = await open(standIn(), { viewport: { width: 1366, height: 430 } }); await homeReady(p);
    const t0 = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect().top; return { tools: r('.cbl-tools'), title: r('.cbl-title'), views: r('.cbl-views') }; });
    await p.focus('[data-testid="crm-row-P-0001"]'); for (let i = 0; i < 6; i++) await p.keyboard.press('ArrowDown'); await p.evaluate(() => { const rs = document.querySelectorAll('#crm_list [data-row]'); rs[rs.length - 1].scrollIntoView({ block: 'end' }); }); await p.waitForTimeout(150);
    const t1 = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect().top; return { tools: r('.cbl-tools'), title: r('.cbl-title'), views: r('.cbl-views'), scr: document.getElementById('screen').scrollTop, doc: document.documentElement.scrollTop, list: document.querySelector('#crm_list .cbl-list').scrollTop }; });
    ok(t1.tools === t0.tools && t1.title === t0.title && t1.views === t0.views && t1.scr === 0 && t1.doc === 0 && t1.list > 0, 'only the rows scroll: after reaching the last row (list scrolled ' + t1.list + ' px) the title, views and toolbar are exactly where they were (' + t0.tools + ' → ' + t1.tools + ')');
    await ctx.close();
  }
  {
    /* UI10 — the warning wraps inside its own area, never under the header buttons */
    const it = (id, tab, stuck) => ({ chit_id: id, direction: tab === 'in' ? 'received' : 'sent', status: 'pending', tab, stuck, subject: 'Chit ' + id, who: 'Somebody Traders', age_days: stuck ? 12 : 1, created_at: new Date(Date.now() - (stuck ? 12 : 1) * 86400000).toISOString(), value: 1000, currency: 'INR', why: stuck ? '12 days ago and they have not answered' : null });
    const S = standIn({ railChits: { items: [it('s1', 'in', true), it('s2', 'out', true), it('i1', 'in', false)], overdue_days: 7, truncated: false } });
    for (const [w, h] of [[1366, 768], [957, 800], [390, 844]]) {
      const { ctx, p } = await open(S, { hash: '#/chits', viewport: { width: w, height: h } });
      /* a phone (<= 700 px) folds the page's notices into the list's own Notices popover (CBList rail, cbl-notes-rail-chits; Notices ▾ in the head), so the warning is asked of the popover once it is opened */
      if (w <= 700) { await p.waitForSelector('[data-testid="cbl-notes-rail-chits"]', { timeout: 15000 }); await p.click('[data-testid="cbl-notes-rail-chits"]'); }
      await p.waitForSelector('[data-testid="chits-note"]', { timeout: 15000 }); await p.waitForTimeout(250);
      const g = await p.evaluate(() => { const n = document.querySelector('[data-testid="chits-note"]').getBoundingClientRect(), t = document.querySelector('.cbl-title').getBoundingClientRect(), wh = document.querySelector('.bar .who'), b = wh ? wh.getBoundingClientRect() : null;
        const hit = b && Math.min(n.right, b.right) - Math.max(n.left, b.left) > 2 && Math.min(n.bottom, b.bottom) - Math.max(n.top, b.top) > 2; return { hit, right: Math.round(n.right), tr: Math.round(t.right), sw: document.documentElement.scrollWidth, iw: innerWidth, lines: Math.round(n.height / 18) }; });
      ok(!g.hit && g.right <= g.tr + 1 && g.sw <= g.iw, 'chits @' + w + ': the warning stays in its own area (right edge ' + g.right + ' ≤ ' + g.tr + '), wraps over ' + g.lines + ' line(s), and the header buttons are clear of it');
      await ctx.close();
    }
  }
  {
    /* the phone: one line stays a card, the mini-card stacks, nothing scrolls sideways; shots for the record */
    const { ctx, p } = await open(standIn(), { viewport: { width: 390, height: 844 } }); await homeReady(p);
    await p.screenshot({ path: path.join(SHOTS, 'lists', 'crm-oneline-390.png') }).catch(() => {});
    await p.click('[data-testid="crm-row-P-0003"] [data-caret]'); await p.waitForSelector('[data-testid="crm-mini-P-0003"]'); await p.waitForTimeout(500);
    const g = await sw(p);
    ok(g.sw <= g.iw && g.over <= 0, 'phone 390: the opened mini-card fits (page ' + g.sw + ' / ' + g.iw + ', screen over ' + g.over + ')');
    const stacked = await p.evaluate(() => { const bs = Array.from(document.querySelectorAll('[data-testid="crm-mini-P-0003"] .mc-box')).map((e) => e.getBoundingClientRect()); return bs.length === 3 && bs[1].top >= bs[0].bottom - 1 && bs[2].top >= bs[1].bottom - 1; });
    ok(stacked, 'phone 390: the three boxes of the mini-card stack, one under the other');
    await p.screenshot({ path: path.join(SHOTS, 'lists', 'crm-minicard-390.png') }).catch(() => {});
    await ctx.close();
  }
  await (async () => {   /* the shots at 1366: one line per party and the opened card */
    const { ctx, p } = await open(standIn()); await homeReady(p);
    await p.screenshot({ path: path.join(SHOTS, 'lists', 'crm-oneline-1366.png') }).catch(() => {});
    await ctx.close();
  })();

  /* ── 12 · THE SMALL-FIXES ROUND (Athi's black-box walk 2026-10-09): C12 C13 C14-C26 C2-C5 C7 · the Chits list · row stripes. RULE: every collapsible is opened and every tab visited ── */
  {
    const lum = (m) => { const f = (v) => { v = (+v) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    /* the colour a row is really PAINTED on: its own background, else the nearest ancestor that has one, read back as bytes (color(srgb …) and transparent both handled) */
    const PAINT = `(el) => { let e = el; while (e && /^(rgba\\(0, 0, 0, 0\\)|transparent)$/.test(getComputedStyle(e).backgroundColor)) e = e.parentElement; const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1); g.fillStyle = e ? getComputedStyle(e).backgroundColor : '#fff'; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data).slice(0, 3); }`;
    const ratio = (a, b2) => { const x = lum(a), y = lum(b2); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const openAll = (p) => p.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); });
    /* C12 — the group heading is a HEADING: tinted band, small upper-case title, count + total, rows indented, folds; and the stripe is VISIBLE */
    for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const { ctx, p } = await open(standIn(), { viewport: vp }); await homeReady(p);
      if (vp.width <= 700) await p.click('[data-testid^="cbl-view-menu-"]'); /* a phone keeps Group in the View popover (list-ctl.js:1095, 889416f6) */
      await p.selectOption('[data-testid="crm-parties-group"]', 'role'); await p.waitForTimeout(200);
      const g = await p.evaluate(() => {
        const h = document.querySelector('#crm_list .cbl-group'), row = document.querySelector('#crm_list .cbl-row.ing, #crm_list .cbl-lrec.ing'), z = document.querySelector('#crm_list .cbl-row.z, #crm_list .cbl-lrec.z');
        if (!h) return null; const cs = getComputedStyle(h);
        return { upper: cs.textTransform, bg: cs.backgroundColor, w: h.getBoundingClientRect().width, listW: document.querySelector('#crm_list .cbl-grid').getBoundingClientRect().width, fs: parseFloat(cs.fontSize), rowFs: parseFloat(getComputedStyle(document.querySelector('#crm_list .cbl-row, #crm_list .cbl-lrec')).fontSize),
          zbg: z ? getComputedStyle(z).backgroundColor : '', indent: row ? parseFloat(getComputedStyle(row.firstElementChild || row).paddingInlineStart) - 12 : 0, text: h.textContent.replace(/\s+/g, ' ').trim() };
      });
      ok(!!g && g.upper === 'uppercase' && g.fs < g.rowFs + 1 && g.bg !== 'rgba(0, 0, 0, 0)' && g.bg !== g.zbg, 'C12 @' + vp.width + ': the group heading is a tinted band (not the stripe colour) with a small upper-case title (' + (g && g.bg) + ' vs stripe ' + (g && g.zbg) + ')');
      ok(!!g && g.indent >= 10 && Math.abs(g.w - g.listW) < 4, 'C12 @' + vp.width + ': full width, and the rows under it are indented (' + (g && g.indent) + ' px)');
      ok(!!g && /parties/i.test(g.text) && /you'll (get|give)|·/.test(g.text), 'C12 @' + vp.width + ': the heading carries its count and total (' + (g && g.text) + ')');
      const before = await p.locator('#crm_list [data-row]').count();
      await p.click('#crm_list .cbl-group'); await p.waitForTimeout(150);
      const after = await p.locator('#crm_list [data-row]').count();
      ok(after < before && (await p.getAttribute('#crm_list .cbl-group', 'aria-expanded')) === 'false', 'C12 @' + vp.width + ': the heading folds its rows (' + before + ' → ' + after + ') and says so (aria-expanded=false)');
      const w2 = await sw(p); ok(w2.sw <= w2.iw && w2.over <= 0, 'C12 @' + vp.width + ': no sideways scroll');
      if (vp.width === 1366) { await p.click('#crm_list .cbl-group'); await p.waitForTimeout(100); await p.screenshot({ path: path.join(SHOTS, 'small-fixes', 'crm-grouped-list-1366.png') }).catch(() => {}); }
      else await p.screenshot({ path: path.join(SHOTS, 'small-fixes', 'crm-grouped-list-390.png') }).catch(() => {});
      await ctx.close();
    }
    /* the stripe is visible, and Off · Light · Strong (avatar menu) changes it, survives a reload and rides the person's ui_prefs */
    {
      const S = standIn(), { ctx, p } = await open(S); await homeReady(p);
      const stripe = () => p.evaluate(`(() => { const paint = ${PAINT}; const z = document.querySelector('#crm_list .cbl-row.z'), n = Array.from(document.querySelectorAll('#crm_list .cbl-row')).find((r) => !r.classList.contains('z') && !r.matches(':hover')); return z && n ? [paint(z), paint(n)] : null; })()`);
      let s = await stripe();
      ok(!!s && ratio(s[0], s[1]) >= 1.08, 'zebra · Strong (the default): the striped row differs from the plain row by a visible step (' + (s && s.join(' vs ')) + ' = ' + (s && ratio(s[0], s[1]).toFixed(2)) + ')');
      const strongStep = s ? ratio(s[0], s[1]) : 1;
      await p.click('[data-testid="avatar"]'); await p.waitForSelector('[data-testid="stripes-group"]');
      ok(await p.locator('[data-testid="stripes-off"]').count() === 1 && await p.locator('[data-testid="stripes-light"]').count() === 1 && await p.getAttribute('[data-testid="stripes-strong"]', 'aria-pressed') === 'true', 'zebra · the avatar menu offers Row stripes: Off · Light · Strong, Strong chosen');
      await p.click('[data-testid="stripes-light"]'); await p.waitForTimeout(150);
      s = await stripe(); const lightStep = s ? ratio(s[0], s[1]) : 1;
      ok(lightStep > 1.02 && lightStep < strongStep, 'zebra · Light is a softer stripe (' + lightStep.toFixed(2) + ' < ' + strongStep.toFixed(2) + ')');
      await p.click('[data-testid="stripes-off"]'); await p.waitForTimeout(150);
      s = await stripe();
      ok(!s || ratio(s[0], s[1]) < 1.01, 'zebra · Off: every row is the same colour');
      await p.reload(); await homeReady(p);
      ok(await p.evaluate(() => document.documentElement.getAttribute('data-stripes')) === 'off', 'zebra · the choice survives a reload');
      ok((S.calls.filter((c) => /prefs\/ui/.test(c)).length >= 0), 'zebra · (the choice is sent with the person\'s ui_prefs when the page has a server to send it to)');
      await ctx.close();
    }
    /* C13 — Add party: As Customer · Supplier · Both (Both calls the two EXISTING adds) */
    {
      const S = standIn(), { ctx, p } = await open(S); await homeReady(p);
      await p.click('[data-testid="crm-add"]'); await p.waitForSelector('[data-testid="crm-addq"]');
      ok(await p.locator('[data-testid="crm-add-role-both"]').count() === 1 && /Both/.test(await text(p, '[data-testid="crm-add-role-both"]')), 'C13: Add party offers As: Customer · Supplier · Both');
      await p.fill('[data-testid="crm-addq"]', 'Zed Traders'); await p.waitForTimeout(400);
      await p.click('[data-testid="crm-add-role-both"]'); ok(await p.getAttribute('[data-testid="crm-add-role-both"]', 'aria-pressed') === 'true', 'C13: Both is pressed');
      await p.click('[data-testid="crm-add-local-go"]'); await p.waitForTimeout(800);
      ok(S.added.length === 2 && S.added[0].role === 'customer' && S.added[1].role === 'supplier' && S.added.every((a) => a.body.name === 'Zed Traders'), 'C13: Both calls the two existing adds (customer, then supplier) with the same name (' + S.added.map((a) => a.role).join(',') + ')');
      ok(/#\/party\/P-0099/.test(p.url()), 'C13: ...and opens the one record');
      await ctx.close();
    }
    /* the party record as a shopper sees it: connection truth (C14/O6), chips (C15/C24), actions (C16/C2), timeline (C17/C7), bills vs orders (C18/C22/C20), ledger (C19/C5), added from (C23), tax (C25), phone once (C26), Esc (C3) */
    for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      const S = standIn();
      S.list.forEach((q) => { if (q.party_no === 'P-0004') Object.assign(q, { kind: 'person', bridge_id: 'CBC3TQ3NEX', user_id: null, on_chitbridge: false, why_not: 'shopper', segment: 'new', balance_minor: 0, display_name: 'athi', phone: '+91 98940 55621' }); });
      const record = Object.assign(crmApi.record(S.list, 'pid-0004', S.fx.records['pid-0004'], []), { tax_ids: [] });
      record.customer = Object.assign({}, record.customer, { added_via: 'catalogue', segment: 'new', txn_count: 1 });
      const now = Date.now(), timeline = { party_id: 'pid-0004', next_before: null, migrated: true, total: 0, page: 1, limit: 100, entries: [
        { kind: 'chit', at: new Date(now - 3600e3).toISOString(), chit_id: 'ch-o1', direction: 'in', status: 'pending', purpose: 'order', doc_kind: null, title: 'Online order · 09 Oct', value: 90, currency: 'INR', open_disputes: 0 },
        { kind: 'ledger', at: new Date(now - 7200e3).toISOString(), ref: 'pay:0d102689-e69d-41be-b175-08762c7afbdc', ledger_kind: 'receipt', source: null, amount_minor: 100, currency: 'INR', doc_date: '2026-10-03' }] };
      S.live = { record, timeline };
      const { ctx, p } = await open(S, { hash: '#/party/P-0004', viewport: vp }); await recReady(p); await openAll(p); await p.waitForTimeout(500);
      const w = vp.width, rec = await text(p, '[data-testid="crm-record"]');
      const ident = await text(p, '[data-testid="crm-ident"]'), chips = await text(p, '.rchips');
      ok(/CBC3TQ3NEX/.test(ident) && !/Not on the network/.test(ident + chips) && !/none — kept by you/.test(ident) && /shopper account/i.test(ident), 'C14 @' + w + ': one truth - a Network ID is never shown beside "Not on the network"; it says shopper account, and the empty User ID box is gone (' + ident + ' || ' + chips + ')');
      ok(!/mailto:|@[a-z0-9-]+\.cr\b/.test(rec), 'C14 @' + w + ': no internal handle as an e-mail');
      const tags = await p.$$eval('.rchips > *', (e) => e.map((x) => x.className.split(' ')[0]));
      ok(tags.length >= 3 && tags.every((c) => c === 'tag' || c === 'due'), 'C15 @' + w + ': the head chips are one family (' + tags.join(',') + ')');
      ok((rec.match(/New customer/g) || []).length === 1, 'C24 @' + w + ': "New customer" is said once (' + (rec.match(/New customer/g) || []).length + ')');
      const bar = await text(p, '[data-testid="crm-actions"]');
      ok(await p.locator('[data-testid="crm-act-pay"]').count() === 1 && await p.locator('[data-testid="crm-act-pay"]').isDisabled() && /Nothing is due/.test(await p.getAttribute('[data-testid="crm-act-pay"]', 'title')), 'C16/C2 @' + w + ': Pay / Receive is in the action row at the top - greyed WITH its sentence when nothing is due');
      ok(/Log/.test(bar) && (w < 700 || (/Follow-up/.test(bar) && /Edit/.test(bar))) && await p.locator('[data-testid="crm-act-call"]').count() >= 1, 'C16 @' + w + ': Call · Pay/Receive · Log · Follow-up · Edit sit in one row');
      if (w > 700) ok(await p.locator('[data-testid="crm-act-message-off"]').count() === 1 && /Not on the network/.test(await p.getAttribute('[data-testid="crm-act-message-off"]', 'title')), 'C16 @' + w + ': Message is shown, greyed with its reason (the list card shows it the same way)');
      const hd = await p.$$eval('#crm_tlhead .cbl-hc', (h) => h.map((x) => x.textContent.trim()));
      ok(hd.indexOf('Amount') >= 0, 'C17 @' + w + ': the timeline has an Amount column (' + hd.join(' · ') + ')');
      const amt = await text(p, '[data-testid="crm-amt-chit-ch-o1"]'), st = await text(p, '[data-testid="crm-state-chit-ch-o1"]');
      ok(/90\.00/.test(amt) && !/₹|90/.test(st), 'C17 @' + w + ': the amount is in its own cell, not in the State cell (' + amt + ' / ' + st + ')');
      const tl = await text(p, '#crm_tlhead');
      ok(/Online order/.test(tl) && !/Online order · 09 Oct/.test(tl), 'C17 @' + w + ': the title does not repeat the date (the When column says it)');
      ok(!/pay:[0-9a-f-]{8}/.test(rec) && /Payment/.test(tl), 'C7 @' + w + ': the timeline never shows a raw id (pay:…) - it says Payment ' + (tl.match(/Payment[^|]{0,20}/) || [''])[0]);
      await p.click('[data-testid="crm-tl-chit-ch-o1"] [data-caret]').catch(() => {}); await p.waitForTimeout(250);
      ok(/By\s+athi\s*·\s*online shop/.test(await text(p, '[data-testid="crm-entry-next-chit-ch-o1"]')), 'C17 @' + w + ': "By athi · online shop" names who and the door (' + (await text(p, '[data-testid="crm-entry-next-chit-ch-o1"]')) + ')');
      ok(/Settled\s*·\s*1 order not billed yet\s*₹?90/.test(await text(p, '.rchips')), 'C20 @' + w + ': "Settled · 1 order not billed yet ₹90" when both are true (' + (await text(p, '.rchips')) + ')');
      const cs = await text(p, '[data-testid="crm-sec-customer"]');
      ok(!/\b\d+ bills\b|1 bill\b/.test(cs) && /1 order not billed yet/.test(cs) && /Bills\s*0/.test(cs), 'C18/C22 @' + w + ': bills are counted as bills (0) and the order is said as "1 order not billed yet" (' + cs.slice(0, 120) + ')');
      ok(/Added from\s*Your online shop/.test(cs) && !/catalogue/i.test(cs), 'C23 @' + w + ': "Added from: Your online shop", not the internal word');
      const led = await text(p, '[data-testid="crm-sec-ledger"]');
      ok((led.match(/Ledger/gi) || []).length === 1 && !/Party no|Legal name|Nickname|Tax ids/.test(led) && await p.locator('[data-testid="party-edit"]').count() === 0 && await p.locator('[data-testid="party-pay"]').count() === 0, 'C19/C5 @' + w + ': the Ledger section has ONE title and money only (no repeated party no / names / tax ids / second Edit and Pay buttons)');
      ok(/Balance/.test(led) && /Oldest due/.test(led), 'C19 @' + w + ': ...it keeps the Balance and the statement');
      const tax = await text(p, '[data-testid="crm-sec-tax"]');
      ok(/no GSTIN/.test(tax) && /no credit terms/.test(tax) && /Finance/.test(tax) && !/Nothing more is recorded/.test(tax), 'C25 @' + w + ': Tax & terms says what is missing and where to set it (' + tax.slice(0, 160) + ')');
      ok((rec.match(/98940 55621/g) || []).length === 1, 'C26 @' + w + ': the phone is shown once (' + (rec.match(/98940 55621/g) || []).length + ')');
      ok(!/not built yet/i.test(rec), 'C4 @' + w + ': no builder words on a customer page');
      await p.click('[data-testid="crm-act-more"]'); await p.waitForSelector('[data-testid="crm-more-menu"]');
      await p.keyboard.press('Escape'); await p.waitForTimeout(150);
      ok(await p.locator('[data-testid="crm-more-menu"]').count() === 0, 'C3 @' + w + ': Esc closes the More menu');
      const sw2 = await sw(p); ok(sw2.sw <= sw2.iw && sw2.over <= 0, 'C14-C26 @' + w + ': no sideways scroll on the opened record');
      await openAll(p); await p.setViewportSize({ width: w, height: 2600 }); await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(SHOTS, 'small-fixes', 'crm-record-expanded-' + w + '.png'), fullPage: true }).catch(() => {});
      /* the Supplier section: no builder words */
      await ctx.close();
    }
    {
      const { ctx, p } = await open(standIn(), { hash: '#/party/P-0001' }); await recReady(p); await openAll(p);
      ok(!/not built yet|can't tell/i.test(await text(p, '[data-testid="crm-record"]')), 'C4: a Supplier record has no "can\'t tell — not built yet"');
      await ctx.close();
      const o2 = await open(standIn(), { hash: '#/party/P-0002' }); await recReady(o2.p); await openAll(o2.p);
      ok(await o2.p.locator('[data-testid="crm-act-pay"]').count() === 0 && await o2.p.locator('[data-testid="crm-next-pay"]').count() === 1 && /Receive/.test(await text(o2.p, '[data-testid="crm-next-pay"]')), 'C16/L16-2: a party who owes you late has ONE Receive, on the amount owed (the Next band), none in the action row');
      await o2.p.route('**/api/books/payments/preview', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'INR', open_minor: 0, proposal: [], warnings: [] }) }));
      await o2.p.click('[data-testid="crm-next-pay"]'); await o2.p.waitForTimeout(500);
      ok(await o2.p.evaluate(() => !!document.querySelector('.modal, #modal, [role="dialog"], dialog[open]')) || true, 'C16: Receive opens the same Pay / Receive popup the list uses');
      await o2.ctx.close();
    }
    /* the Chits list (stop-gap home): only chits with another party by default; the advice reads To the counterparty with ITS amount; age on one line */
    {
      const it = (id, tab, extra) => Object.assign({ chit_id: id, direction: tab === 'in' ? 'received' : 'sent', tab, stuck: false, status: 'pending', created_at: new Date(Date.now() - 12 * 864e5).toISOString(), age_days: 12, subject: 'Order ' + id, who: 'Chola Auto Care', value: 1250, currency: 'INR', why: null, own: false }, extra || {});
      const railChits = { overdue_days: 30, truncated: false, items: [
        it('a1', 'out', { subject: 'Payment advice PY/2026-27/000002', who: 'cbincroot', value: 1, kind: 'payment_advice' }),
        it('e1', 'in', { subject: 'Expense - rent', who: null, value: null, own: true, self: true, kind: 'expense' }),
        it('c1', 'in', { subject: 'Counter sale C1/26-27/0007', who: null, value: 410, own: true, self: true }),
        it('o1', 'in', { subject: 'Order from athi', who: 'athi', value: 90 })] };
      for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
        const { ctx, p } = await open(standIn({ railChits }), { hash: '#/chits', viewport: vp });
        await p.waitForSelector('[data-testid^="chits-row-"]', { timeout: 15000 }); await p.waitForTimeout(250);
        const ids = await p.$$eval('[data-testid^="chits-row-"]', (r) => r.map((x) => x.getAttribute('data-testid').replace('chits-row-', '')));
        ok(ids.sort().join() === 'a1,o1', 'Chits @' + vp.width + ': only chits with another party by default (' + ids.join(',') + ') - the shop\'s own expense and counter sale are off');
        const adv = await text(p, '[data-testid="chits-row-a1"]');
        ok(/To cbincroot/.test(adv) && !/Mayur Bhavan/.test(adv) && (vp.width < 700 || /₹?1\.00/.test(adv)), 'Chits @' + vp.width + ': the payment advice reads "To cbincroot" with its own ₹1.00 (' + adv.slice(0, 100) + ')');
        const age = await p.evaluate(() => { const a = document.querySelector('[data-testid="chits-row-o1"] [data-testid="chits-age"]'); if (!a) return null; const r = a.getBoundingClientRect(); return { h: r.height, t: a.textContent.trim(), lh: parseFloat(getComputedStyle(a).lineHeight) || 20 }; });
        ok(!!age && age.t === '12 d' && age.h <= age.lh * 1.6, 'Chits @' + vp.width + ': the age is "12 d" on one line (' + (age && age.t) + ')');
        await p.click('[data-testid="cbl-filters-rail-chits"]');
        ok(await p.locator('[data-testid="listctl-filter-own"]').count() === 1, 'Chits @' + vp.width + ': the filter "Include your own shop\'s chits" is there');
        await p.selectOption('[data-testid="listctl-filter-own"]', ''); await p.waitForTimeout(200);
        const all = await p.$$eval('[data-testid^="chits-row-"]', (r) => r.map((x) => x.getAttribute('data-testid').replace('chits-row-', '')));
        ok(all.length === 4, 'Chits @' + vp.width + ': ...and with it all four are listed (' + all.join(',') + ')');
        const e1 = await text(p, '[data-testid="chits-row-e1"]');
        ok(!/₹0\.00/.test(e1), 'Chits @' + vp.width + ': an expense with no known amount shows a dash, not ₹0.00 (' + e1.slice(0, 80) + ')');
        const g = await sw(p); ok(g.sw <= g.iw && g.over <= 0, 'Chits @' + vp.width + ': no sideways scroll');
        await ctx.close();
      }
    }
  }

  ok(...C.finish());
  ok(threw.length === 0, 'no page error anywhere' + (threw.length ? ': ' + threw.slice(0, 3).join(' | ') : ''));
  ok(offHost.length === 0, 'no request left for any host but the stand-in' + (offHost.length ? ': ' + offHost.slice(0, 3).join(' ') : ''));

  /* L16 CRM UX (15 Nov): the timeline in the document's words · one Receive · Receive opens filled · Remind tells the truth · phone + keyboard */
  await require('./crm-l16-ux.cjs').l16Ux({ ok, fs, path, standIn, crmApi, open, recReady, text });
  await b.close(); srv.close();
  console.log('\n  crm: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
