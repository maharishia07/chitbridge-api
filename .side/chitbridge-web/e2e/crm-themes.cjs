/* crm-themes.cjs — EVERY THEME READABLE, MEASURED (CB CRM + CB Accounts). Athi, 2026-10-03: in Dark the CRM's title, the selected row's name and the
 * group label were invisible. A look at a screenshot is a guess; this measures.
 *
 * For each page/screen below, in EVERY theme of CBScreen.APP_THEMES (all 16) + Cream, the theme is applied THE WAY THE AVATAR DOES (CBAvatar.applyTheme:
 * the theme's tokens inline on <html>, data-theme + data-themed stamped), then EVERY visible text element on the screen is measured — its colour (alpha
 * included) against the colour actually painted behind it (the ancestors' backgrounds composited) — and sorted into the categories Athi named:
 *   title · row · SELECTED row (the class CBList's keyboard cursor sets) · group label · toolbar button · chip · column head · sidebar · bar · other
 * ≥ 4.5:1 for text, ≥ 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold). Every failing pair is printed; exit 1 on any.
 *
 * Screens: crm.html Parties · a party record · Follow-ups · (+ the Follow-ups nav opens a DIFFERENT view: title, list, no parties list);
 *          accounts.html Day book · Ledgers.
 * Nothing leaves the browser: every /api/** call is fulfilled by a stand-in inside the page (crm.cjs / cb-accounts.cjs pattern).
 * Screenshots: e2e/shots/crm-{parties,record,followups}-{dark,terminal}.png
 * Playwright is not in the cloud image: `npm i @playwright/test` in a temp dir and NODE_PATH at it. */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = process.env.CRMT_PUB || path.join(ROOT, 'public');
const SHOTS = path.join(__dirname, 'shots');
const FIX = path.join(__dirname, 'fixtures', 'golden-parties.json');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const C = require('./lib/contract.cjs'), crmApi = require('./lib/crm-api.cjs'), books = require('./lib/books-api.cjs');   /* every answer served for a route in the API contract is checked (e2e/fixtures/web-api.contract.json) */
const J = C.json;
function resolve(x, now) {
  if (typeof x === 'string') { const m = /^@([+-])(\d+)(h|d)$/.exec(x); return m ? new Date(now + (m[1] === '-' ? -1 : 1) * Number(m[2]) * (m[3] === 'h' ? 3600e3 : 86400e3)).toISOString() : x; }
  if (Array.isArray(x)) return x.map((v) => resolve(v, now));
  if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach((k) => { o[k] = resolve(x[k], now); }); return o; }
  return x;
}
const FX = resolve(JSON.parse(fs.readFileSync(FIX, 'utf8')), Date.now());
const claims = (c) => { const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); return b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(Date.now() / 1000) + 3600 }, c)) + '.x'; };
const OWNER = { token: claims({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Athi', entity: 'Mayur Bhavan' };
const TODAY = new Date().toISOString().slice(0, 10);

/* ── the stand-in: the CRM's reads, and the Ledger's (Day book + Ledgers) ── */
async function route(r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(); let x;
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' } });
  if (p === '/api/books/health') return J(r, 200, books.health());
  if (p === '/api/books/accounts') return J(r, 200, { accounts: [
    { code: '1300', name: 'Customers (Sundry Debtors)', is_group: false }, { code: '1300-P00001', name: 'Ravi Stores', is_group: false }, { code: '2100', name: 'Suppliers (Sundry Creditors)', is_group: false },
    { code: '1400', name: 'Cash', is_group: false }, { code: '4000', name: 'Sales', is_group: false }, { code: '6010', name: 'Rent', is_group: false }].map((a) => books.accountRow(Object.assign({ account_id: 'acc-' + a.code }, a))) });
  if (p === '/api/books/trial-balance') return J(r, 200, books.trialBalance([{ code: '1300', name: 'Customers (Sundry Debtors)', dr_minor: 600000, cr_minor: 0 }, { code: '1400', name: 'Cash', dr_minor: 1240000, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 1590000 }, { code: '6010', name: 'Rent', dr_minor: 100000, cr_minor: 0 }], { total_dr_minor: 1940000, total_cr_minor: 1840000, balanced: false }));
  if (p === '/api/books/daybook') return J(r, 200, books.daybook([['k1', 'C2/26-27/0016', 'c1', 'Ravi Stores', 11], ['k2', 'C2/26-27/0017', 'c2', 'Chola Auto Care', 12]].map(([id, no, pid, pname, n]) => ({ entry_id: 'je' + n, entry_no: 'JV/2026-27/0000' + n, posting_date: TODAY, doc_date: TODAY, event_type: 'sale_bill', source_chit_id: id, narration: 'Sale',
    source: { kind: 'bill', ref: no, chit_id: id, how: 'On credit', counter: 'C2', by: 'Mayur Bhavan' },
    lines: [{ code: '1300', name: 'Customers (Sundry Debtors)', party_id: pid, party_name: pname, dr_minor: 300000, cr_minor: 0 }, { code: '4000', name: 'Sales', rate: 12, dr_minor: 0, cr_minor: 267857 }, { code: '2200', name: 'Output CGST', rate: 6, dr_minor: 0, cr_minor: 32143 }] })).map(books.entry)));
  if (p === '/api/books/todo') return J(r, 200, []);
  if (p === '/api/books/dues') return J(r, 200, books.dues([], { asOf: TODAY }));
  if ((x = p.match(/^\/api\/books\/party\/([^/]+)\/statement$/))) return J(r, 200, books.statement(x[1]));
  /* the contract's keys for the three reads the screens now make (the catch-all {} below no longer conforms: the Parties record asks the credit terms, the Ledgers ask the cheques, Home asks the work facts) */
  if (p === '/api/books/cheques') return J(r, 200, books.cheques());
  if (p === '/api/books/terms') return J(r, 200, { terms_migrated: false, may_set: true, why_not: null, default: {}, party: null, events: [] });
  if (p === '/api/work/facts') return J(r, 200, { truncated: false, counts: { orders_in: 1, orders_out: 3, tasks: 1, done: 2 }, lines: [{ text: '1 new order', value: 1, tone: 'dn' }], figures: { orders_new: 1, tasks_mine: 0, orders_in: 1, orders_out: 3, tasks: 1, done: 2 } });
  if (p.startsWith('/api/books/')) return J(r, 200, {});
  if (p === '/api/folders') return J(r, 200, { folders: [{ folder_id: 'c0000000-0000-4000-8000-00000000000b', parent_id: null, name: 'Urgent', scope: 'task', kind: 'filed', count: 1 }] });
  if (p === '/api/chits/inbox') return J(r, 200, { chits: [{ chit_id: 'ord1', purpose: 'order', manual_subject: 'Order from Chola', sender_entity_display_name: 'Chola Auto Care', current_status: 'pending', created_at: '2026-10-01T04:00:00Z', summary_json: {}, all_recipients: [] }, { chit_id: 'job1', purpose: 'general', manual_subject: 'Fix the shutter', sender_entity_display_name: 'Bills Shop', current_status: 'pending', created_at: '2026-10-01T03:00:00Z', summary_json: {}, all_recipients: [] }], total: 2, page: 1, limit: 20 });
  if (p === '/api/chits/sent') return J(r, 200, { chits: [], total: 0, page: 1, limit: 20 });
  /* ── the CRM, answered as chitbridge-api answers it (e2e/lib/crm-api.cjs builds the shapes from the golden seed; the contract holds them) ── */
  if (p === '/api/crm/parties' && m === 'GET') return J(r, 200, crmApi.list(FX.list, { records: FX.records }));
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/timeline$/))) return J(r, 200, crmApi.timeline(FX.timelines[x[1]] || { entries: [] }, x[1], {}));
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)$/)) && m === 'GET') {
    const key = decodeURIComponent(x[1]); const row = FX.list.find((q2) => q2.party_id === key || q2.party_no === key);
    if (!row) return J(r, 404, { error: 'Not found' });
    return J(r, 200, crmApi.record(FX.list, row.party_id, FX.records[row.party_id], FX.followups));
  }
  if (p === '/api/crm/followups' && m === 'GET') {
    const done = u.searchParams.get('done') === '1';
    return J(r, 200, crmApi.followups(FX.followups.filter((f) => (done ? !!f.done_at : !f.done_at))));
  }
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

const { measure } = require('./lib/theme-measure.cjs');   /* the measurement, run INSIDE the page (shared with e2e/standards-page.cjs) */

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const threw = [], offHost = [];

  async function open(urlPath) {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offHost.push(r.request().url()); return r.abort(); });
    await ctx.route(/fonts.(googleapis|gstatic).com|cdnjs.cloudflare.com/, (r) => r.abort());
    await ctx.route('**/api/**', route);
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, OWNER);
    const p = await ctx.newPage(); p.on('pageerror', (e) => threw.push(e.message));
    await p.goto(base + urlPath);
    return { ctx, p };
  }

  /* the screens: [name, page, how to reach it, a selector that proves it is up] */
  const crmSteps = (hash, ready) => async (p) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForSelector(ready, { timeout: 15000 }); await p.waitForTimeout(300); };
  const accSteps = (tab, ready) => async (p) => { await p.waitForSelector('[data-testid="acc-nav-daybook"]', { timeout: 15000 }); await p.click('[data-testid="acc-nav-' + tab + '"]'); await p.waitForSelector(ready, { timeout: 15000 }); await p.waitForTimeout(300); };
  const SCREENS = [
    { name: 'crm Parties', url: '/crm.html', need: 'full', go: crmSteps('#/parties', '[data-testid^="crm-row-"]'), shot: 'crm-parties' },
    { name: 'crm Party record', url: '/crm.html', need: 'full', go: crmSteps('#/party/P-0001', '[data-testid="crm-ident"]'), shot: 'crm-record' },
    { name: 'crm Follow-ups', url: '/crm.html', need: 'full', go: crmSteps('#/followups', '[data-testid^="crm-fu-"]'), shot: 'crm-followups' },
    { name: 'accounts Day book', url: '/accounts.html', need: 'full', go: accSteps('daybook', '[data-testid^="db-entry-"]') },
    { name: 'accounts Ledgers', url: '/accounts.html', need: 'full', go: accSteps('ledgers', '[data-testid="lt-band-people"]') },
    { name: 'index (home)', url: '/', go: async (p) => { await p.waitForFunction(() => document.body.innerText.trim().length > 20, null, { timeout: 15000 }); await p.waitForTimeout(1200); } },   /* the N18 shell is fixed-position: <body> has no height, so Playwright calls it hidden — wait for painted text instead */
    { name: 'app Task list', url: '/app.html#/app', go: async (p) => { await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 }); await p.waitForTimeout(1500); } },
    { name: 'list-lab', url: '/list-lab.html', go: async (p) => { await p.waitForSelector('.cbl-row', { timeout: 15000 }); await p.waitForTimeout(300); } },
  ];

  const keys = await (async () => { const { p, ctx } = await open('/crm.html'); await p.waitForFunction(() => window.CBScreen && window.CBAvatar); const k = await p.evaluate(() => Object.keys(CBScreen.APP_THEMES)); await ctx.close(); return k; })();
  ok(keys.length === 16 && keys.indexOf('cream') >= 0 && keys.indexOf('dark') >= 0 && keys.indexOf('terminal') >= 0, 'APP_THEMES has all 16 themes (' + keys.join(' ') + ')');

  const FULL = ['--ink', '--ink-2', '--muted', '--line', '--card', '--page', '--panel', '--blue-t', '--blue-i', '--amber-t', '--amber-i', '--green-t', '--green-d', '--red-t', '--red-i'];
  const table = {};   /* screen → theme → [pairs measured, failures] */
  const fails = [];
  for (const sc of SCREENS) {
    const { ctx, p } = await open(sc.url);
    await p.waitForFunction(() => window.CBScreen && window.CBAvatar);
    await sc.go(p);
    table[sc.name] = {};
    for (const k of keys) {
      await p.evaluate((key) => { CBAvatar.applyTheme(key); }, k);
      await p.waitForTimeout(60);
      /* the selected row: the class CBList's cursor sets on the row the person is on */
      await p.evaluate(() => { document.querySelectorAll('.cbl-row.sel,.cbl-lrec.sel').forEach((n) => n.classList.remove('sel')); const r = document.querySelector('.cbl-row[data-row],.cbl-lrec[data-row]'); if (r) r.classList.add('sel'); });
      /* a token that comes back EMPTY is a cycle (an alias pointing back at a name the avatar re-points) — it paints nothing, and the pair test above would read the ground behind it */
      const empty = await p.evaluate((names) => { const cs = getComputedStyle(document.documentElement); return names.filter((n) => !cs.getPropertyValue(n).trim()); }, sc.need === 'full' ? FULL : []);
      if (empty.length) fails.push({ screen: sc.name, theme: k, cat: 'token', text: empty.join(' '), ratio: 0, need: 1, html: ':root' });
      const pairs = await p.evaluate(measure);
      const bad = pairs.filter((x) => x.ratio < x.need);
      table[sc.name][k] = [pairs.length, bad.length, pairs.reduce((m, x) => Math.min(m, x.ratio), 99)];
      bad.forEach((x) => fails.push(Object.assign({ screen: sc.name, theme: k }, x)));
      if (sc.shot && (k === 'dark' || k === 'terminal')) { await p.evaluate(() => { document.querySelectorAll('.cbl-row.sel').forEach((n) => n.classList.remove('sel')); }); await p.screenshot({ path: path.join(SHOTS, sc.shot + '-' + k + '.png') }); }
    }
    await ctx.close();
  }

  /* the cases Athi named must have been MEASURED on the screens that carry them (a measurement of nothing proves nothing) */
  {
    const { ctx, p } = await open('/crm.html'); await p.waitForFunction(() => window.CBScreen && window.CBAvatar);
    await SCREENS[0].go(p); await p.evaluate(() => CBAvatar.applyTheme('dark'));
    await p.evaluate(() => { const r = document.querySelector('.cbl-row[data-row]'); if (r) r.classList.add('sel'); });
    const cats = new Set((await p.evaluate(measure)).map((x) => x.cat));
    ['title', 'row', 'selected row', 'column head', 'toolbar button', 'chip'].forEach((c) => ok(cats.has(c), 'Parties measured the category "' + c + '"'));
    /* the Segment toggle and its group label: turn grouping on if the list has the switch */
    const seg = p.locator('[data-testid="crm-seg-toggle"],[data-cbl-group],button:has-text("Segment")').first();
    if (await seg.count()) { await seg.click().catch(() => {}); await p.waitForTimeout(200); }
    const after = await p.evaluate(measure);
    ok(after.some((x) => x.cat === 'group label') || (await p.locator('.cbl-group').count()) === 0, 'grouped Parties: the group label is measured when it is drawn');
    await ctx.close();
  }

  /* ── the numbers ── */
  const th = ['cream'].concat(keys.filter((k) => k !== 'cream'));
  console.log('\n  min contrast per screen × theme (pairs measured / failing / lowest ratio):');
  Object.keys(table).forEach((s) => {
    const tot = th.reduce((a, k) => [a[0] + table[s][k][0], a[1] + table[s][k][1]], [0, 0]);
    const worst = th.reduce((w, k) => table[s][k][2] < w[1] ? [k, table[s][k][2]] : w, ['', 99]);
    console.log('   ' + s.padEnd(20) + ' pairs ' + String(tot[0]).padStart(5) + '  failing ' + String(tot[1]).padStart(4) + '  lowest ' + worst[1] + ' (' + worst[0] + ')');
  });
  console.log('\n  PAGE x THEME (failing pairs; . = none)');
  console.log('   ' + ''.padEnd(18) + th.map((k) => k.slice(0, 5).padStart(6)).join(''));
  Object.keys(table).forEach((s) => console.log('   ' + s.padEnd(18) + th.map((k) => String(table[s][k][1] || '.').padStart(6)).join('')));
  if (fails.length) {
    console.log('\n  FAILING PAIRS (' + fails.length + '):');
    const grouped = {};
    fails.forEach((f) => { const g = f.screen + ' | ' + f.theme + ' | ' + f.cat; (grouped[g] = grouped[g] || []).push(f); });
    Object.keys(grouped).slice(0, 120).forEach((g) => { const a = grouped[g]; console.log('   ' + g + ' | ' + a.length + 'x | worst ' + Math.min.apply(null, a.map((f) => f.ratio)) + ' (need ' + a[0].need + ') e.g. "' + a[0].text + '" ' + a[0].html); });
  }
  /* A RATCHET, not a pass: the CRM, CB Accounts, the index and the list lab are held at ZERO. app.html's own rail and status strip still carry
     literal greys (a separate piece of work) — its count may only go DOWN, so no NEW unreadable pair can land there. */
  /* QA-154: the count (was 8 here, now 12 on main) moved into the ONE ratchet file e2e/scanner-known.json, with the pairs as a list:
     key = screen | theme | category | text. A new pair, or a count rise, fails; the known ones stay counted on screen. */
  const RATCHET = { 'app Task list': 1 };
  const heldFails = fails.filter((x) => x.screen in RATCHET);
  const RK = require('./lib/known-findings.cjs').ratchet('crm-themes', heldFails.map((x) => ({ key: x.screen + ' | ' + x.theme + ' | ' + x.cat + ' | ' + String(x.text).slice(0, 40), show: x })), { owner: 'ux-locale' });
  console.log(RK.line);
  ok(RK.fresh.length === 0 && heldFails.length <= RK.baseline, 'app Task list: ' + heldFails.length + ' failing pairs, ' + RK.fresh.length + ' new (baseline ' + RK.baseline + ')');
  const hard = fails.filter((x) => !(x.screen in RATCHET));
  ok(hard.length === 0, 'every text pair on every screen in all 16 themes clears AA (' + hard.length + ' failing of ' + Object.keys(table).reduce((a, s) => a + th.reduce((b, k) => b + table[s][k][0], 0), 0) + ' measured)');

  /* ── the Follow-ups nav opens a DIFFERENT view ── */
  {
    const { ctx, p } = await open('/crm.html'); await p.waitForFunction(() => window.CBScreen && window.CBAvatar);
    await p.waitForSelector('[data-testid^="crm-row-"]', { timeout: 15000 });
    const title = () => p.evaluate(() => { const h = document.querySelector('#screen .cbl-title h1'); return h ? h.textContent.trim() : ''; });
    ok(/Parties/.test(await title()) && await p.locator('#crm_list').count() === 1 && await p.locator('#crm_fu').count() === 0, 'Parties: title "Parties", the parties list present, no follow-ups list');
    await p.click('[data-testid="crm-nav-followups"]');
    await p.waitForSelector('#crm_fu [data-row]', { timeout: 15000 });
    ok(/^Follow-ups$/.test(await title()), 'after Follow-ups in the sidebar the title is "Follow-ups" (' + (await title()) + ')');
    ok(await p.locator('#crm_fu').count() === 1 && await p.locator('#crm_list').count() === 0, 'the follow-ups list is present and the parties list is gone');
    ok(await p.locator('[data-testid^="crm-row-"]').count() === 0, 'no party row is on the screen');
    ok(await p.locator('[data-testid="crm-nav-followups"][aria-current="page"]').count() === 1 && await p.locator('[data-testid="crm-nav-parties"][aria-current="page"]').count() === 0, 'the sidebar marks Follow-ups as the current page');
    const groups = await p.$$eval('#crm_fu .cbl-group', (g) => g.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    ok(groups.length >= 2 && /Late/.test(groups.join('|')) && /Today|This week|Later/.test(groups.join('|')), 'the follow-ups are grouped by when they are due (' + groups.join(' | ') + ')');
    const heads = await p.$$eval('#crm_fu .cbl-hc', (h) => h.map((x) => x.innerText.replace(/[▲▼⇅]/g, '').trim()));
    ok(heads[0] === 'DUE' && heads.indexOf('WHAT') > 0, 'its columns are the follow-ups\' own: ' + heads.join(' · '));
    await p.click('[data-testid="crm-nav-parties"]');
    await p.waitForSelector('#crm_list [data-row]', { timeout: 15000 });
    ok(/Parties/.test(await title()) && await p.locator('#crm_fu').count() === 0, 'and Parties brings the parties list back');
    await ctx.close();
  }

  ok(threw.length === 0, 'no page error' + (threw.length ? ': ' + threw[0] : ''));
  ok(...C.finish());
  ok(offHost.length === 0, 'nothing tried to leave the browser' + (offHost.length ? ': ' + offHost[0] : ''));
  await b.close(); srv.close();
  console.log('\ncrm-themes: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
