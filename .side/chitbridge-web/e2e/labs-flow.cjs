/* labs-flow.cjs — THE INDEX PAGE AND ITS FOUR LABS, DRIVEN END TO END (Athi, 2026-10-01 ask: "do a playwright
 * test for the labs in index.html for the entire flow and let me know what the problems are").
 *
 * Pattern copied from e2e/index-page.cjs (NOT edited): Playwright, a stand-in API answering INSIDE the page via
 * ctx.route, a static server on a free OS port. Nothing here ever reaches localhost:3000, port 7351, or the live
 * site — every /api/** call is fulfilled before it leaves the browser. This is a TEST, not a fix: nothing in the
 * repo is changed by running it.
 *
 * For each Lab (Product, Offer, Combo), signed in AND signed out, at 1280px and 390px:
 *   1. open the index, read the tile's live fact, click the tile, land on the Lab
 *   2. run the Lab's own main flow as a shopkeeper would (read from the page's own source, not guessed)
 *   3. use the Lab's Home link back to the index; the same person and figures must still be there
 *   4. the Tax Lab tile must say "coming" and never be a link
 * Every state is screenshotted to e2e/shots/labs-flow-<lab>-<state>.png. Every API path a page asks for that
 * this stand-in does not recognise is logged AND still answered (200 {} / {ok:true}) so the page does not hang.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SHOTS = path.join(__dirname, 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let pass = 0, fail = 0;
const problems = [];           // { lab, state, step, problem, severity }
const rows = {};                // lab -> [{step, result, problem, shot}]
const apiPathsSeen = new Set();
const unknownPaths = new Set();

function row(lab, step, result, problem, shot) {
  (rows[lab] = rows[lab] || []).push({ step, result, problem: problem || '', shot: shot || '' });
}
function ok(lab, c, step, m, shot) { if (c) { pass++; row(lab, step, 'OK', '', shot); } else { fail++; row(lab, step, 'FAIL', m, shot); problems.push({ lab, step, problem: m }); } console.log('  ' + (c ? 'ok  ' : 'XX  ') + '[' + lab + '] ' + step + (c ? '' : ' — ' + m)); }
function note(lab, step, m, severity) { problems.push({ lab, step, problem: m, severity: severity || 'minor' }); console.log('  !!  [' + lab + '] ' + step + ' — ' + m); }
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });

/* ⭐⭐⭐ [found live, 2026-10-01] a real shop's own item_data.categories/.category holds a category DEFINITION's
 * id (kind:'category' — app.html's own catName(), app.html:13209) — never a readable name on its own. These
 * seven look like the real thing (UUID-shaped) on purpose, so Combo Lab's picker is proven against the actual
 * shape that broke live ("55e14791-27cb-…" on screen), not a stand-in that was never UUID-shaped to begin with. */
const SHELF_CATS = [
  { id: '550e8400-e29b-41d4-a716-446655440001', name: 'Shelf 1' },
  { id: '550e8400-e29b-41d4-a716-446655440002', name: 'Shelf 2' },
  { id: '550e8400-e29b-41d4-a716-446655440003', name: 'Shelf 3' },
  { id: '550e8400-e29b-41d4-a716-446655440004', name: 'Shelf 4' },
  { id: '550e8400-e29b-41d4-a716-446655440005', name: 'Shelf 5' },
  { id: '550e8400-e29b-41d4-a716-446655440006', name: 'Shelf 6' },
  { id: '550e8400-e29b-41d4-a716-446655440007', name: 'Shelf 7' },
];
/* ⚠️ no \b anchors — adjacent table cells concatenate with no separator in .textContent ("Product 0" +
   "550e8400-…" reads as "...0550e8400-…", where \b never matches between two word characters), so a
   boundary-anchored regex would silently never catch the very table-cell case this exists to catch. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/* ── the stand-in: one shop's day, one figure per source — extends index-page.cjs's own shape with what the
   three Labs ask for that the index page never does (product lists, combo templates, definitions, modifiers) */
function standIn() {
  const today = new Date().toISOString().slice(0, 10);
  const items = [];
  for (let i = 0; i < 112; i++) {
    const d = { price: { amount: 10 + i, currency: 'INR' }, cost: { amount: 6 + i, currency: 'INR' },
      category: SHELF_CATS[i % 7].id };
    if (i === 5) delete d.cost;
    if (i < 5) d.modifiers = [{ name: 'M' + i }, { name: 'N' + i }];
    items.push({ id: 'p' + i, item_id: 'p' + i, item_data: Object.assign({ name: 'Product ' + i, unit: 'pc' }, d) });
  }
  return {
    calls: [],
    me: { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR', gstn: null } },
    counters: [{ id: 'C1', name: 'Counter 1', state: 'open' }],
    summary: { rows: [{ key: today, count: 12, total: 4280 }],
      prices_read_at: new Date(Date.now() - 3600 * 1000).toISOString(), unsent: 0 },
    items,
    combos: [],                                        /* POST /api/combo-templates fills this in */
    comboSeq: 0,
    definitions: [{ definition_id: 'd1', status: 'draft', kind: 'offer', sub_kind: 'percent_off', name: 'seed draft',
      created_at: new Date().toISOString(), rules: { _lab: { title: 'seed', detail: '', n: '10%', k: 'draft' } } }]
      .concat(SHELF_CATS.map((c) => ({ definition_id: c.id, status: 'live', kind: 'category', name: c.name, created_at: new Date().toISOString() }))),
    defSeq: 1,
    booksOn: true,
    health: { enabled: true, last_posted_day: '2026-09-26', waiting: [] },
    costAccess: { can_see_costs: true, is_owner: true },
    accounts: [
      { code: '1300', name: 'Debtors', is_group: false }, { code: '2100', name: 'Creditors', is_group: false },
      { code: '1400', name: 'Cash', is_group: false }, { code: '2201', name: 'GST payable', is_group: false },
      { code: '4000', name: 'Sales', is_group: false },
    ],
    /* ── Product Lab's own source: a supplier list the shop can adopt from ── */
    productLists: {
      have: 112, currency: 'INR', language_names: { ta: 'Tamil' },
      lists: [
        { key: 'veg', label: 'Vegetables & fruit', count: 3, languages: ['ta'], categories: ['Vegetables', 'Fruit'],
          rows: [
            { name: 'Tomato', unit: 'kg', price: 30, category: 'Vegetables', names: { ta: ['தக்காளி'] } },
            { name: 'Onion', unit: 'kg', price: 25, category: 'Vegetables', names: { ta: ['வெங்காயம்'] } },
            { name: 'Banana', unit: 'dozen', price: 50, category: 'Fruit', names: { ta: ['வாழைப்பழம்'] } },
          ] },
        { key: 'grocery', label: 'Grocery', count: 2, languages: [], categories: ['Staples'],
          rows: [
            { name: 'Rice', unit: 'kg', price: 60, category: 'Staples', names: {} },
            { name: 'Sugar', unit: 'kg', price: 45, category: 'Staples', names: {} },
          ] },
      ],
      mine: [{ name: 'Rice', unit: 'kg', price: 55 }],  /* the shop already sells Rice at ITS OWN price, not the suggestion */
    },
  };
}

const KNOWN = [];   // { re, method, fn(S, m, r, u) }
function on(method, re, fn) { KNOWN.push({ method, re, fn }); }

on('GET', /^\/api\/entities\/me$/, (S, m, r) => J(r, 200, S.me));
on('GET', /^\/api\/entities\/me\/can-see-costs$/, (S, m, r) => J(r, 200, S.costAccess));
on('GET', /^\/api\/counters$/, (S, m, r) => J(r, 200, { ok: true, counters: S.counters, free: 0 }));
on('GET', /^\/api\/till\/summary$/, (S, m, r) => J(r, 200, S.summary));
on('GET', /^\/api\/products\/lists$/, (S, m, r) => J(r, 200, S.productLists));
on('POST', /^\/api\/products\/lists\/adopt$/, (S, m, r, u, body) => {
  const names = (body && body.names) || [];
  J(r, 200, { message: 'Added ' + names.length + ' product' + (names.length === 1 ? '' : 's') + ' to your catalogue.' });
});
on('GET', /^\/api\/products$/, (S, m, r) => J(r, 200, { items: S.items }));
on('POST', /^\/api\/products$/, (S, m, r, u, body) => {
  const id = 'new' + (S.items.length + 1);
  const item = { id, item_id: id, item_data: (body && body.item_data) || {} };
  S.items.push(item);
  J(r, 200, { ok: true, item_id: id, item });
});
on('PATCH', /^\/api\/products\/[^/]+$/, (S, m, r, u, body) => {
  const id = decodeURIComponent(u.pathname.split('/').pop());
  const it = S.items.find((x) => x.id === id || x.item_id === id);
  if (it && body && body.item_data) Object.assign(it.item_data, body.item_data);
  J(r, 200, { ok: true, item: it || {} });
});
on('GET', /^\/api\/combo-templates$/, (S, m, r) => J(r, 200, { templates: S.combos }));
on('POST', /^\/api\/combo-templates$/, (S, m, r, u, body) => {
  const id = 'c' + (++S.comboSeq);
  const t = { id, name: (body && body.name) || 'Untitled combo', definition: (body && body.definition) || [],
    price: (body && body.price) != null ? body.price : null, product_item_id: null };
  S.combos.push(t);
  J(r, 200, { ok: true, template: t });
});
on('PATCH', /^\/api\/combo-templates\/[^/]+$/, (S, m, r, u, body) => {
  const id = u.pathname.split('/').pop();
  const t = S.combos.find((x) => x.id === id);
  if (t && body) Object.assign(t, body);
  J(r, 200, { ok: true, template: t || {} });
});
on('DELETE', /^\/api\/combo-templates\/[^/]+$/, (S, m, r, u) => {
  const id = u.pathname.split('/').pop();
  S.combos = S.combos.filter((x) => x.id !== id);
  J(r, 200, { ok: true });
});
on('POST', /^\/api\/combo-templates\/[^/]+\/push$/, (S, m, r, u) => {
  const id = u.pathname.split('/')[3];
  const t = S.combos.find((x) => x.id === id);
  const verb = t && t.product_item_id ? 'updated' : 'created';
  const itemId = (t && t.product_item_id) || 'pushed_' + id;
  if (t) t.product_item_id = itemId;
  J(r, 200, { verb, item: { item_id: itemId, item_data: { name: (t && t.name) || 'Combo' } } });
});
on('GET', /^\/api\/definitions$/, (S, m, r, u) => {
  const kind = u.searchParams.get('kind'), status = u.searchParams.get('status');
  let defs = S.definitions.filter((d) => d.status !== 'retired');
  if (kind) defs = defs.filter((d) => d.kind === kind);
  if (status) defs = defs.filter((d) => d.status === status);
  J(r, 200, { definitions: defs });
});
on('POST', /^\/api\/definitions$/, (S, m, r, u, body) => {
  const id = 'd' + (++S.defSeq);
  const d = Object.assign({ definition_id: id, created_at: new Date().toISOString() }, body || {});
  S.definitions.push(d);
  J(r, 200, { ok: true, definition: d });
});
on('PUT', /^\/api\/definitions\/[^/]+$/, (S, m, r, u, body) => {
  const id = u.pathname.split('/').pop();
  const d = S.definitions.find((x) => x.definition_id === id);
  if (d && body) Object.assign(d, body);
  J(r, 200, { ok: true });
});
on('DELETE', /^\/api\/definitions\/[^/]+$/, (S, m, r, u) => {
  const id = u.pathname.split('/').pop();
  const d = S.definitions.find((x) => x.definition_id === id);
  if (d) d.status = 'retired';
  J(r, 200, { ok: true });
});
on('GET', /^\/api\/books\/health$/, (S, m, r) => { if (!S.booksOn) return J(r, 404, { error: 'Not found' }); J(r, 200, S.health); });
on('GET', /^\/api\/books\/accounts$/, (S, m, r) => { if (!S.booksOn) return J(r, 404, { error: 'Not found' }); J(r, 200, { accounts: S.accounts }); });

function route(S, r) {
  const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
  S.calls.push(p);
  apiPathsSeen.add(m + ' ' + p);
  const hit = KNOWN.find((k) => k.method === m && k.re.test(p));
  if (hit) {
    let body = null;
    try { const pd = r.request().postData(); if (pd) body = JSON.parse(pd); } catch (_) {}
    return hit.fn(S, m, r, u, body);
  }
  unknownPaths.add(m + ' ' + p);
  console.log('  ??  unknown API path the stand-in did not know: ' + m + ' ' + p);
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if ((!f.startsWith(PUB) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();

  /* ── one context per (lab × signed-state × viewport); closed right after — memory stays flat ── */
  async function openCtx(opts) {
    opts = opts || {};
    const S = opts.S || standIn();
    const ctx = await b.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, r));
    if (!opts.signedOut) {
      await ctx.addInitScript(() => { try {
        const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
        const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-lab', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
        localStorage.setItem('cb_sess', JSON.stringify({ token: tok, role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' })); } catch (_) {} });
    }
    const p = await ctx.newPage();
    const pageErrors = [], consoleErrors = [], consoleWarnings = [], failedRequests = [], dialogs = [];
    p.on('pageerror', (e) => pageErrors.push(e.message));
    p.on('console', (msg) => {
      const t = msg.type();
      /* this harness deliberately aborts the Google Fonts request (ctx.route, same as e2e/index-page.cjs) —
         Chromium logs that abort as this exact, URL-less console error; it is a test-harness artifact, never
         a real page problem, so it is dropped here exactly where index-page.cjs drops the matching pageerror
         ("fonts|favicon"). Any OTHER console error still gets through. */
      if (msg.text() === 'Failed to load resource: net::ERR_FAILED') return;
      if (t === 'error') consoleErrors.push(msg.text());
      else if (t === 'warning') consoleWarnings.push(msg.text());
    });
    p.on('requestfailed', (req) => { if (/\/api\//.test(req.url())) failedRequests.push(req.url() + ' — ' + (req.failure() && req.failure().errorText)); });
    p.on('response', (res) => { if (/\/api\//.test(res.url()) && res.status() >= 400) failedRequests.push(res.url() + ' — HTTP ' + res.status()); });
    p.on('dialog', async (d) => { dialogs.push(d.type() + ': ' + d.message()); await d.dismiss().catch(() => {}); });
    return { ctx, p, S, pageErrors, consoleErrors, consoleWarnings, failedRequests, dialogs };
  }
  const settle = (p) => p.waitForTimeout(500);
  async function bodyText(p) { try { return await p.evaluate(() => document.body.innerText); } catch (_) { return ''; } }
  async function scrollWidthOk(p, width) {
    try { const w = await p.evaluate(() => document.documentElement.scrollWidth); return w <= width + 1; } catch (_) { return true; }
  }
  function reportHealth(lab, state, h, shotName) {
    const mine = h.pageErrors.filter((m) => !/fonts|favicon/i.test(m));
    if (mine.length) note(lab, state + ': page errors', mine.slice(0, 3).join(' | ').slice(0, 300), 'critical');
    if (h.consoleErrors.length) note(lab, state + ': console errors', h.consoleErrors.slice(0, 3).join(' | ').slice(0, 300), 'major');
    if (h.consoleWarnings.length) note(lab, state + ': console warnings', h.consoleWarnings.slice(0, 2).join(' | ').slice(0, 200), 'minor');
    if (h.failedRequests.length) note(lab, state + ': failed requests', h.failedRequests.slice(0, 3).join(' | ').slice(0, 300), 'major');
    if (h.dialogs.length) note(lab, state + ': native alert()/confirm()', h.dialogs.join(' | '), 'major');
  }

  const LABS = [
    /* N18: the index is the shell's Home — a Lab is a manifest card (shell-card-<id>) with its facts spot (shell-facts-<id>) */
    { key: 'product', title: 'Product Lab', tile: 'shell-card-product-lab', fact: 'shell-facts-product-lab', href: 'product-lab.html' },
    { key: 'offer', title: 'Offer Lab', tile: 'shell-card-offer-lab', fact: 'shell-facts-offer-lab', href: 'offer-lab-next.html' },
    /* T2-LABS: the tile still links combo-lab.html, which forwards to the Offer Lab's combo mode — the page the person lands on */
    { key: 'combo', title: 'Combo Lab', tile: 'shell-card-combo-lab', fact: 'shell-facts-combo-lab', href: 'offer-lab-next.html?mode=combo' },
  ];
  const VIEWPORTS = [{ w: 1280, label: '1280' }, { w: 390, label: '390' }];
  const STATES = [{ signedOut: false, label: 'in' }, { signedOut: true, label: 'out' }];

  /* ═══ index + the Dispute Lab chip: every viewport, signed in AND signed out ═══════════════════════════════════
   * N18: tax-lab.html does not exist, so the manifest says `coming` and the shell draws a dashed chip that names its
   * state ("later") and is never a link — in both states, at both widths. */
  for (const st of STATES) {
    for (const vp of VIEWPORTS) {
      const h = await openCtx({ viewport: { width: vp.w, height: 900 }, signedOut: st.signedOut });
      const { p } = h;
      const label = vp.label + 'px-' + st.label;
      await p.goto(base + '/');
      await settle(p);
      if (vp.w < 700) { await p.click('[data-testid="shell-nav-more"]').catch(() => {}); await p.click('[data-testid="shell-row-labs"]').catch(() => {}); }   /* a phone: More, then the Labs row */
      const tax = await p.locator('[data-testid="shell-chip-rail-lab"]').first();
      const taxTag = await tax.evaluate((el) => el.tagName).catch(() => '?');
      const taxHref = await tax.getAttribute('href').catch(() => null);
      const taxText = (await tax.locator('.tag').textContent().catch(() => '')) || '';
      ok('index', taxTag !== 'A' && !taxHref, 'Dispute Lab chip is not a link (' + label + ')', 'tagName=' + taxTag + ' href=' + taxHref);
      ok('index', /^later$/.test(taxText.trim()), 'Dispute Lab chip names its state, "later" (' + label + ')', 'got "' + taxText.trim() + '"');
      const sw = await scrollWidthOk(p, vp.w);
      ok('index', sw, 'no horizontal scroll (' + label + ')', 'document.scrollWidth exceeded ' + vp.w);
      await p.screenshot({ path: path.join(SHOTS, 'labs-flow-index-' + label + '.png'), fullPage: true });
      reportHealth('index', label, h, 'index-' + label);
      await h.ctx.close();
    }
  }

  /* ═══ each Lab × signed-in/out × 1280/390 ═══════════════════════════════════════════════════════════════════ */
  for (const lab of LABS) {
    for (const st of STATES) {
      for (const vp of VIEWPORTS) {
        const state = st.label + '-' + vp.label;
        const h = await openCtx({ viewport: { width: vp.w, height: 900 }, signedOut: st.signedOut });
        const { p, S } = h;
        try {
          /* 1 · the index, the tile's live fact, the click through */
          await p.goto(base + '/');
          await settle(p);
          let factText = '';
          if (vp.w < 700) { await p.click('[data-testid="shell-nav-more"]').catch(() => {}); await p.click('[data-testid="shell-row-labs"]').catch(() => {}); }   /* a phone: More, then the Labs row */
          if (!st.signedOut) {
            /* N18: a card's facts come from its manifest `facts` URL; the Labs have no facts read yet (named in the N18 PR), so the spot is empty by design */
            factText = (await p.textContent('[data-testid="' + lab.fact + '"]').catch(() => '')) || '';
            row(lab.key, 'index card facts (' + state + ')', 'INFO', factText.trim() ? 'reads "' + factText.trim() + '"' : 'empty — the Lab has no facts read in the manifest yet (never an invented figure)');
          } else {
            factText = (await p.textContent('[data-testid="' + lab.fact + '"]').catch(() => '')) || '';
            ok(lab.key, factText.trim() === '', 'signed out: no fact leaks onto the card (' + state + ')', 'card showed "' + factText + '" with nobody signed in');
          }
          const shotIdx = 'labs-flow-' + lab.key + '-index-' + state + '.png';
          await p.screenshot({ path: path.join(SHOTS, shotIdx), fullPage: true });

          await Promise.all([
            p.waitForLoadState('load').catch(() => {}),
            p.click('[data-testid="' + lab.tile + '"]'),
          ]);
          await settle(p);
          const onLabPage = (await p.url()).indexOf(lab.href) >= 0;
          ok(lab.key, onLabPage, 'clicking the tile opens ' + lab.href + ' (' + state + ')', 'landed on ' + (await p.url()));

          /* Home link carries the same testid on every Lab page */
          const homeHref = await p.getAttribute('[data-testid="shell-home"]', 'href').catch(() => null);
          ok(lab.key, homeHref === '/', lab.title + ' header carries Home → / (' + state + ')', 'href was "' + homeHref + '"');

          /* 2 · the Lab's own main flow */
          if (lab.key === 'product') await productFlow(p, S, st, vp, state);
          if (lab.key === 'offer') await offerFlow(p, S, st, vp, state, h);
          if (lab.key === 'combo') await comboFlow(p, S, st, vp, state, h);

          const shotLab = 'labs-flow-' + lab.key + '-lab-' + state + '.png';
          await p.screenshot({ path: path.join(SHOTS, shotLab), fullPage: true });

          const sw = await scrollWidthOk(p, vp.w);
          ok(lab.key, sw, lab.title + ': no horizontal scroll at ' + vp.label + 'px (' + state + ')', 'document.scrollWidth exceeded ' + vp.w);

          const tnow = await bodyText(p);
          ok(lab.key, !/\bNaN\b/.test(tnow), lab.title + ': no NaN on screen (' + state + ')', 'the word "NaN" is visible');
          ok(lab.key, !/\bundefined\b/.test(tnow), lab.title + ': no "undefined" on screen (' + state + ')', '"undefined" is visible');
          ok(lab.key, !/error\.message|\[object Object\]/.test(tnow), lab.title + ': no technical error text on screen (' + state + ')', 'raw error text is visible');

          /* 3 · Home back to the index — same person, same figures. Combo Lab's own flow (below) already
             leaves for Home as its last step — closing its builder modal — since its header's own Home link
             sits behind that modal, permanently, and is never the documented way out any more. */
          const alreadyHome = (() => { const u = (p.url() || '').replace(base, '').split('?')[0].split('#')[0]; return u === '/' || u === '/index.html' || u === ''; })();
          if (!alreadyHome) {
            await p.click('[data-testid="shell-home"]');
            await p.waitForLoadState('load').catch(() => {});
            await settle(p);
          }
          const backOnIndex = (await p.url()).replace(base, '').split('?')[0].split('#')[0];
          ok(lab.key, backOnIndex === '/' || backOnIndex === '/index.html' || backOnIndex === '', lab.title + ': Home returns to the index (' + state + ')', 'landed on "' + backOnIndex + '"');
          if (!st.signedOut) {
            const shopName = (await p.textContent('[data-testid="shop-name"]').catch(() => '')) || '';
            ok(lab.key, /Mayur Bhavan/.test(shopName), lab.title + ': the same shop is still shown after Home (' + state + ')', 'shell shop name read "' + shopName + '"');
          }
          const shotHome = 'labs-flow-' + lab.key + '-home-' + state + '.png';
          await p.screenshot({ path: path.join(SHOTS, shotHome), fullPage: true });
        } catch (e) {
          note(lab.key, state + ': flow threw', String(e && e.message || e).slice(0, 300), 'critical');
          fail++;
          try { await p.screenshot({ path: path.join(SHOTS, 'labs-flow-' + lab.key + '-CRASH-' + state + '.png'), fullPage: true }); } catch (_) {}
        }
        reportHealth(lab.key, state, h, state);
        await h.ctx.close();
      }
    }
  }

  /* ═══ the retired page: offer-lab.html only forwards to offer-lab-next.html ═════════════════════════════════
   * [RETIRED, 2026-10-01] — see RETIRED.md. A saved or shared link to the old page must still land on the real
   * Offer Lab, query string and hash carried through, not on a dead end. */
  {
    const h = await openCtx({ viewport: { width: 1280, height: 900 } });
    const { p } = h;
    await p.goto(base + '/offer-lab.html?ref=saved-link#frag');
    await p.waitForURL(/offer-lab-next\.html/, { timeout: 5000 }).catch(() => {});
    await settle(p);
    const landed = await p.url();
    ok('offer', /\/offer-lab-next\.html/.test(landed), 'offer-lab.html forwards to offer-lab-next.html', 'landed on "' + landed + '"');
    ok('offer', /[?&]ref=saved-link/.test(landed) && /#frag$/.test(landed), 'offer-lab.html carries the query string and hash through (' + landed + ')', 'query/hash was dropped — landed on "' + landed + '"');
    await p.screenshot({ path: path.join(SHOTS, 'labs-flow-offer-retired-redirect.png'), fullPage: true });
    await h.ctx.close();
  }

  /* ── Product Lab's own flow: choose from a list, price & shelf, adopt ──────────────────────────────────── */
  async function productFlow(p, S, st, vp, state) {
    if (st.signedOut) {
      const who = (await p.textContent('#who').catch(() => '')) || '';
      ok('product', /not signed in/.test(who), 'signed out: "#who" says not signed in (' + state + ')', 'got "' + who + '"');
      const say = (await p.textContent('#say').catch(() => '')) || '';
      ok('product', /Sign in to ChitBridge/.test(say), 'signed out: the sign-in prompt is shown (' + state + ')', 'got "' + say + '"');
      const calledLists = S.calls.includes('/api/products/lists');
      ok('product', !calledLists, 'signed out: no catalogue read is attempted (' + state + ')', '/api/products/lists was still called');
      return;
    }
    await p.waitForSelector('[data-testid="pl-table"]', { timeout: 10000 }).catch(() => {});
    const who = (await p.textContent('#who').catch(() => '')) || '';
    ok('product', /products in your catalogue today/.test(who), '"#who" reads the catalogue size (' + state + ')', 'got "' + who + '"');

    /* Tick all shown on the default list, then move to price & shelf */
    const tickAll = p.locator('[data-testid="pl-all"]');
    if (await tickAll.count()) { await tickAll.click(); await settle(p); }
    const nextBtn = p.locator('[data-testid="pl-next"]');
    const nextEnabled = await nextBtn.isEnabled().catch(() => false);
    ok('product', nextEnabled, '"Tick all shown" picks at least one product (' + state + ')', 'Next stayed disabled after "Tick all shown"');
    if (nextEnabled) {
      await nextBtn.click();
      await settle(p);
      const onReview = await p.locator('[data-testid="pl-review"]').count();
      ok('product', onReview > 0, 'step 2 — price & shelf — opens (' + state + ')', 'the review table never appeared');
      if (onReview) {
        /* change a price, as a shopkeeper amending a suggested one */
        const priceInputs = p.locator('[data-testid="pl-review"] input[type="number"]');
        const n = await priceInputs.count();
        if (n) {
          await priceInputs.first().fill('99');
          await settle(p);
          const v = await priceInputs.first().inputValue();
          ok('product', v === '99', 'a price can be typed over the suggestion (' + state + ')', 'input read back "' + v + '" after typing 99');
        } else note('product', state + ': price & shelf', 'no editable price inputs on the review table', 'major');

        const availBtn = p.locator('[data-testid="pl-shelf-available"]');
        if (await availBtn.count()) { await availBtn.click(); await settle(p); }

        const adoptBtn = p.locator('[data-testid="pl-adopt"]');
        const adoptEnabled = await adoptBtn.isEnabled().catch(() => false);
        ok('product', adoptEnabled, '"Add … to my catalogue" is enabled with items picked (' + state + ')', 'Adopt stayed disabled');
        if (adoptEnabled) {
          const before = S.calls.filter((c) => c === '/api/products/lists/adopt').length;
          await adoptBtn.click();
          await p.waitForFunction((b) => {
            const el = document.getElementById('say');
            return el && el.textContent && el.textContent.length > 0;
          }, before, { timeout: 8000 }).catch(() => {});
          await settle(p);
          const after = S.calls.filter((c) => c === '/api/products/lists/adopt').length;
          ok('product', after > before, 'Adopt calls POST /api/products/lists/adopt (' + state + ')', 'no adopt call was observed');
          const say = (await p.textContent('#say').catch(() => '')) || '';
          ok('product', /Added/.test(say) && !/could not/i.test(say), 'Adopt reports success in plain words (' + state + ')', 'say() read "' + say + '"');
        }
      }
    }
  }

  /* ── Offer Lab's own flow (offer-lab-next.html): Settings → "Create an offer" → pick a shape → "Work it
   * out" → "Add to your offers" ─────────────────────────────────────────────────────────────────────────────
   * ⚠️ This page carries no data-testid attributes (unlike Product/Combo Lab) — its own e2e/offer-lab-next-*.cjs
   * harnesses drive it through its JS globals (pickGoal/apply/S) instead. labs-flow.cjs stays a real click-
   * through (it is testing the PERSON'S path from the index tile onward), so it drives the same onclick
   * handlers and button text the page itself renders — read from offer-lab-next.html's own render functions
   * (renderS0 → "Create an offer"/go(1); renderS1 → pickGoal(id); renderS2 → apply(); paintWork/#workScrim →
   * #workSave → saveOffer() → go(3)/renderS3).
   */
  async function offerFlow(p, S, st, vp, state, h) {
    await p.waitForSelector('#s0.on', { timeout: 10000 }).catch(() => {});
    const sampleHidden = await p.evaluate(() => { const el = document.getElementById('labSampleNote'); return el ? el.hidden : null; }).catch(() => null);
    if (st.signedOut) {
      ok('offer', sampleHidden === false, 'signed out: the sample-data banner is shown (' + state + ')', 'labSampleNote.hidden read ' + sampleHidden);
      /* pressing "Use my catalogue" signed out — the main control a shopkeeper would actually press from the banner */
      const before = h.dialogs.length;
      await p.click('#labSampleNote button').catch(() => {});
      await settle(p);
      row('offer', 'press "Use my catalogue" signed out (' + state + ')', h.dialogs.length > before ? 'NATIVE ALERT' : 'no dialog', h.dialogs.length > before ? h.dialogs[h.dialogs.length - 1] : '');
      if (h.dialogs.length > before) note('offer', state + ': "Use my catalogue" (signed out)', 'pressing it raises a native alert() — "' + h.dialogs[h.dialogs.length - 1] + '"', 'major');
    } else {
      await p.waitForFunction(() => { const el = document.getElementById('bizName'); return el && /Mayur/.test(el.textContent || ''); }, null, { timeout: 8000 }).catch(() => {});
      const bizName = (await p.textContent('#bizName').catch(() => '')) || '';
      ok('offer', /Mayur/.test(bizName), 'signed in: the lab opens on the real catalogue (' + state + ')', 'bizName chip read "' + bizName + '"');
      const sampleHidden2 = await p.evaluate(() => { const el = document.getElementById('labSampleNote'); return el ? el.hidden : null; }).catch(() => null);
      ok('offer', sampleHidden2 === true, 'signed in: the sample-data banner is gone (' + state + ')', 'labSampleNote.hidden read ' + sampleHidden2);
    }

    /* 1 · the landing has ONE way in: the left menu (W30: no "Create an offer" / "Saved offers" buttons beside it) */
    ok('offer', await p.locator('#s0 button:has-text("Create an offer"), #s0 button:has-text("Saved offers")').count() === 0, 'the landing carries no second door to the form or the shelf (' + state + ')', '"Create an offer" or "Saved offers" is still on the landing');

    /* 2 · pick "A percentage off" in the left menu (icons-only at phone width: the list in words in the middle) → its controls */
    const typeBtn = p.locator('[data-testid="skel-nav-percent"]:visible, [data-testid="type-percent"]:visible').first();
    await typeBtn.click().catch(() => {});
    await settle(p);
    ok('offer', await p.locator('#s2.on').count() > 0, 'picking "A percentage off" opens its controls (' + state + ')', 'screen 2 (#s2) never carried class "on"');

    /* 3 · "Work it out" stays off until the reach is chosen (UX-109), then opens as a modal over the controls, never pushed in below them */
    ok('offer', await p.locator('button[onclick="apply()"][disabled]').count() > 0, '"Work it out" waits for "Who and what does this apply to?" (' + state + ')', 'the button was on with nothing chosen');
    await p.evaluate(() => { openApplyPicker(); overlayApplyToggle(P[0].id); overlayApplyDone(); }).catch(() => {});
    await p.click('button[onclick="apply()"]').catch(() => {});
    await settle(p);
    const open = await p.locator('#workScrim.on').count();
    ok('offer', open > 0, '"Work it out" opens the result (' + state + ')', '#workScrim never carried class "on"');
    const body = (await p.textContent('#workBody').catch(() => '')) || '';
    ok('offer', body.trim().length > 0, 'the result shows a worked-out table (' + state + ')', '#workBody stayed empty');
    ok('offer', !/NaN|undefined/.test(body), 'the worked-out result has no NaN/undefined (' + state + ')', 'result body read "' + body.replace(/\s+/g, ' ').trim().slice(0, 150) + '"');

    /* 4 · "Add to your offers" — lands on the shelf (screen 3), signed in posts to /api/definitions */
    const before = S.definitions.length;
    await p.click('#workSave').catch(() => {});
    await settle(p);
    ok('offer', await p.locator('#s3.on [data-testid="offer-open"]').count() > 0, '"Add to your offers" opens the saved offer in the middle (' + state + ')', 'the saved offer did not open (#s3 not on)');
    const savedRows = await p.locator('[data-testid="cart-row"]').count();
    ok('offer', savedRows > 0, 'the offer is in Your offers on the left (' + state + ')', 'no cart row found');
    if (!st.signedOut) {
      ok('offer', S.definitions.length > before, 'signed in: Add to your offers posts to /api/definitions (' + state + ')', 'no new definition was created on the stand-in');
    }
  }

  /* ── Combo Lab's own flow ─────────────────────────────────────────────────────────────────────────────────
   * ⚠️ THE PAGE BOOTS STRAIGHT INTO THE "Combos and modifiers" MODAL (combo-lab.html's own boot script calls
   * openModLab() unconditionally, right after its one render() — see that file's own comment above the call:
   * "this page boots straight into the modifier/combo builder and there is nothing behind it a person could
   * reach"). Everything a shopkeeper can actually do lives inside that one modal, on its two tabs — Modifiers
   * (the default) and Combos — never on the Settings/goal-wizard screens underneath, which are an INERT copy
   * of offer-lab-next.html's own shell (combo-lab.html's own header comment) that nothing reaches any more.
   * ⚠️ [found live, 2026-10-01] "if i open the combo lab, something else is happening and then the current
   * offer lab is opening" — closeModLab() used to reveal exactly that inert shell the moment window.close()
   * was refused (true for every normally-opened tab). Fixed: closing now leaves for Home (location.href='/')
   * instead — tested below as the one documented way out of this Lab.
   */
  async function comboFlow(p, S, st, vp, state, h) {
    await p.waitForSelector('#modLabOverlay.on', { timeout: 10000 }).catch(() => {});
    ok('combo', /Modifiers/.test(await p.textContent('#modLabTabs').catch(() => '')), 'the Lab boots straight into the "Combos and modifiers" modal, Modifiers tab first (' + state + ')', 'modal tabs not found on load');

    /* the "Modifiers" tab (the default): add a modifier group to a product, all inside the one modal */
    const addToProduct = p.locator('button:has-text("Add one to a product")');
    const addMore = p.locator('button:has-text("+ Add to another product")');
    const addBtn = (await addToProduct.count()) ? addToProduct : addMore;
    if (await addBtn.count()) {
      await addBtn.click();
      await settle(p);
      /* [found live, 2026-10-01] "Choose a product" showed category CHIPS and a middle column of raw category
         UUIDs instead of names — real products carry a category DEFINITION's id, not a readable string; the
         stand-in's own categories (SHELF_CATS, above) are UUID-shaped on purpose so this actually proves it. */
      const pickerTxt = (await p.textContent('#priceOverlay').catch(() => '')) || '';
      ok('combo', !UUID_RE.test(pickerTxt), 'the "Choose a product" picker shows category names, never a raw UUID (' + state + ')', 'UUID-shaped text found: "' + (pickerTxt.match(UUID_RE) || [''])[0] + '"');
      const pickRow = p.locator('.ovlpickrow').first();
      if (await pickRow.count()) {
        await pickRow.click();
        await settle(p);
        const addGroup = p.locator('button:has-text("+ Add a group")');
        ok('combo', await addGroup.count() > 0, 'the modifier editor opens for a picked product (' + state + ')', '"+ Add a group" not found');
        if (await addGroup.count()) {
          await addGroup.click();
          await settle(p);
          const applyBtn = p.locator('button:has-text("Apply to ")');
          ok('combo', await applyBtn.count() > 0, 'an "Apply to <product>" button appears after adding a group (' + state + ')', 'Apply button not found');
          if (await applyBtn.count()) {
            const beforePatch = S.calls.filter((c) => /^\/api\/products\//.test(c)).length;
            await applyBtn.click();
            await settle(p);
            if (!st.signedOut) {
              const afterPatch = S.calls.filter((c) => /^\/api\/products\//.test(c)).length;
              ok('combo', afterPatch > beforePatch, 'Apply (signed in, own catalogue) PATCHes the real product (' + state + ')', 'no PATCH /api/products/:id was observed');
            } else ok('combo', true, 'Apply (signed out / sample catalogue) stays local, no server call (' + state + ')');
          }
        }
      } else note('combo', state + ': modifier picker', 'the price-list overlay opened but no pickable row was found', 'major');
    } else note('combo', state + ': modifier lab', 'neither "Add one to a product" nor "Add to another product" was on screen', 'minor');

    /* back to the tab bar — a picked product's own editor (modLabBack()'s "← All products") hides #modLabTabs
       entirely (paintModLab()'s own rule), so the Combos tab below is unreachable until this runs */
    const allProducts = p.locator('button:has-text("← All products")');
    if (await allProducts.count()) { await allProducts.click(); await settle(p); }

    /* the "Combos" tab, inside the same modal: build a combo (pre-filled example) and save it to the library */
    const combosTab = p.locator('#modLabTabs button:has-text("Combos")');
    if (await combosTab.count()) { await combosTab.click(); await settle(p); }
    const buildBtn = p.locator('button:has-text("+ Build a combo")').first();
    if (await buildBtn.count()) {
      await buildBtn.click();
      await settle(p);
      const nameVal = await p.locator('#modLabBody input.inp').first().inputValue().catch(() => '');
      ok('combo', nameVal.trim().length > 0, '"+ Build a combo" opens pre-filled with an example name (' + state + ')', 'the combo name field was blank');
      const saveAsOpen = p.locator('button[onclick="modLabSaveAsOpen()"]').first();
      if (await saveAsOpen.count()) {
        await saveAsOpen.click();
        await settle(p);
        const nameInput = p.locator('#modLabSaveName');
        if (await nameInput.count()) await nameInput.fill('Lab test combo');
        const beforeCombos = S.combos.length;
        /* ⚠️ NOT :has-text("Save") — Playwright's text match is case-insensitive, so "📂 Use a saved combo"
           (modLabOpenLibrary()) matches "Save" too and sorts first in the DOM. The onclick attribute names
           the one real Save button precisely. */
        await p.locator('#modLabBody button[onclick="modLabSaveAsConfirm()"]').click().catch(() => {});
        await settle(p);
        const toastTxt = (await p.textContent('#labtoast').catch(() => '')) || '';
        if (!st.signedOut) {
          /* signed in, combo-lab.html's own boot script runs `if (savedLive()) labUseMine(true);`
             UNCONDITIONALLY — quietly loading the real catalogue (S.biz becomes 'mine') in the background
             even while the modal sits open over it. By the time this Save lands, that quiet load has
             normally finished, so the save succeeds for real. */
          ok('combo', S.combos.length > beforeCombos, 'signed in: Save as… posts a new combo template to /api/combo-templates (' + state + ')', 'no combo was created on the stand-in; toast read "' + toastTxt + '"');
          ok('combo', /saved/i.test(toastTxt), 'the save is confirmed in plain words (' + state + ')', 'toast read "' + toastTxt + '"');
        } else {
          /* signed out: nothing can be "mine", so the save must refuse — never a silent no-op */
          ok('combo', S.combos.length === beforeCombos, 'signed out: Save as… refuses rather than writing silently (' + state + ')', 'a combo was created on the stand-in while signed out');
          ok('combo', /sign in|catalogue/i.test(toastTxt), 'the refusal is said in plain words (' + state + ')', 'toast read "' + toastTxt + '"');
        }
      } else note('combo', state + ': Combos tab', '"Save as…" was not offered after "+ Build a combo"', 'major');
    } else note('combo', state + ': Combos tab', '"+ Build a combo" was not on screen', 'major');

    /* the Lab's own screen, still inside the modal, before leaving it — scrollWidth/NaN/undefined/error-text
       checked HERE because closing (below) leaves this page for good; the outer loop's generic post-flow
       checks run against whatever is on screen by then, which for Combo Lab is already the index. */
    const comboShot = 'labs-flow-combo-before-close-' + state + '.png';
    await p.screenshot({ path: path.join(SHOTS, comboShot), fullPage: true });
    const comboSw = await scrollWidthOk(p, vp.w);
    ok('combo', comboSw, 'Combo Lab: no horizontal scroll at ' + vp.label + 'px (' + state + ')', 'document.scrollWidth exceeded ' + vp.w);
    const comboBody = await bodyText(p);
    ok('combo', !/\bNaN\b/.test(comboBody), 'Combo Lab: no NaN on screen (' + state + ')', 'the word "NaN" is visible');
    ok('combo', !/\bundefined\b/.test(comboBody), 'Combo Lab: no "undefined" on screen (' + state + ')', '"undefined" is visible');
    ok('combo', !/error\.message|\[object Object\]/.test(comboBody), 'Combo Lab: no technical error text on screen (' + state + ')', 'raw error text is visible');

    /* close the modal — the ONE documented way out of this Lab now — and check it actually leaves, rather
       than revealing the inert shell underneath (the 2026-10-01 finding this whole Lab exists to not repeat) */
    const closeBtn = p.locator('#modLabOverlay [data-cbname="close"]');
    ok('combo', await closeBtn.count() > 0, 'the modal has its own close (✕) button (' + state + ')', 'no .ovlx close button found');
    if (await closeBtn.count()) {
      await Promise.all([
        p.waitForURL((u) => u.pathname === '/' || u.pathname === '/index.html', { timeout: 8000 }).catch(() => {}),
        closeBtn.click(),
      ]);
      await settle(p);
      const landed = (await p.url()).replace(base, '').split('?')[0].split('#')[0];
      ok('combo', landed === '/' || landed === '/index.html' || landed === '', 'closing the modal leaves for Home, never the inert Offer Lab shell underneath (' + state + ')', 'landed on "' + landed + '"');
    }
  }

  await b.close(); srv.close();

  /* ── write the per-Lab tables + the API surface, for the report ─────────────────────────────────────────── */
  console.log('\n\n══════════════════════════════════════════════════════════════════');
  for (const lab of Object.keys(rows)) {
    console.log('\n### ' + lab + ' ###');
    rows[lab].forEach((r) => console.log('  ' + r.result.padEnd(4) + ' ' + r.step + (r.problem ? ' — ' + r.problem : '')));
  }
  console.log('\n### API paths every Lab called (candidates for a permanent stand-in) ###');
  [...apiPathsSeen].sort().forEach((p) => console.log('  ' + p));
  if (unknownPaths.size) {
    console.log('\n### API paths NOT recognised by this stand-in ###');
    [...unknownPaths].sort().forEach((p) => console.log('  ' + p));
  } else console.log('\n(every API path called was already known to the stand-in)');

  console.log('\n### problems, as found (severity noted where known) ###');
  problems.forEach((pr) => console.log('  [' + (pr.severity || 'check') + '] ' + pr.lab + ' — ' + pr.step + ': ' + pr.problem));

  console.log('\n  labs-flow: ' + pass + ' passed, ' + fail + ' failed, ' + problems.length + ' problems noted');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
