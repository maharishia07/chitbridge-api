#!/usr/bin/env node
/* index-page.cjs — THE INDEX PAGE IS THE SHELL'S HOME, PROVED (index.html · public/app/manifest.json · plan row N18 · FIT §D Q1 Q3 Q5 Q10).
 * Pattern: shell.cjs — Playwright, a stand-in API answering INSIDE the page (ctx.route), a static server on a free OS port that serves
 * the repo-root index.html at / and public/ for everything else, exactly as it deploys. Nothing here reaches localhost:3000 or the live site.
 *
 * What it proves (exit 1 on any failure):
 *   1  static: index.html writes no card by hand, names no workshop page ("app.html"), no "tier", no "accounting"; it mounts CBShell as Home.
 *      the manifest: every built entry routes to a utility page that exists (never app.html); every other entry has no route (a dashed chip)
 *   2  1366 · signed in, the shipped manifest: Home mounts the shell once (data-mode=home); one card per built entry, each linking to its
 *      route; one dashed chip per other entry, none a link, and a click opens nothing; zero app.html hrefs outside the avatar (the allow-list)
 *      + 7 areas in the nav (home · selling · money · running · trade · labs · setup = CBShell.AREAS); every tile is 148px tall
 *   3  1366 · every read the page makes is a budgeted one (the API's round-trips.budget.json has a line for it - read from the api checkout
 *      when it is beside this one); a facts URL that is null paints nothing; a facts read that fails paints no figure and no status;
 *      nothing wrong → the alerts slot draws nothing; N19 404 → the sheet's empty state (kept)
 *   4  1366 · PLANTED manifest (facts URLs + the rail) and a planted API: each card's lines are the API's (one line + "+n" drop-down);
 *      each card with a facts answer carries its status (shell-state: needs_you · in_use · not_started) and Home's "Needs you" strip lists
 *      exactly the needs_you cards; "Your work" (railPaint) digits are the API's;
 *      "1 supplier bill to accept" · "1 supplier to add" · "2 waiting to be recorded" each carry their fix (FX-F10W: Books' To do counts); a counter paired to another shop earns an amber row with its fix
 *   5  word budget per VISIBLE area (Q10): Home ≤ 120 (with the "Your work" box and the alerts up), every other area ≤ BUDGET — at 1366 and at 390
 *   6  390: scrollWidth === 390; seven bottom tabs, one area at a time; the kural at the foot of Home
 *   7  signed out: not one /api call leaves the page; the cards are still drawn, no facts; the avatar is the one Sign in door;
 *      ?left=<shop> → the row says why, and its button is that door
 *   8  no page error; every stand-in answer for a contract route has the API's shape (e2e/lib/contract.cjs)
 * Screenshots: e2e/shots/index-laptop.png · index-alerts.png (planted, 1366) · index-phone.png (Home, 390) · index-phone-selling.png
 * Run one at a time:  NODE_PATH=e2e/node_modules node e2e/index-page.cjs                                                            */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SHOTS = path.join(__dirname, 'shots');
const C = require('./lib/contract.cjs'), books = require('./lib/books-api.cjs');
const J = C.json;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/* ⭐ THE READS THE PAGE MAY MAKE: each has a line in chitbridge-api/round-trips.budget.json (DB10, I19) — or is the shell's own N19 read.
   A new read here needs its budget line there first. */
const BUDGET_FILE = [process.env.CB_API_DIR, path.join(ROOT, '..', 'chitbridge-api'), 'C:/dev/wt-walk-api', 'C:/dev/chitbridge-api']
  .filter(Boolean).map((d) => path.join(d, 'round-trips.budget.json')).find((p) => fs.existsSync(p));
const BUDGET_ROUTES = BUDGET_FILE ? Object.keys(JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')).routes) : null;
/* the page's reads. With the api checkout beside this one the budget FILE is asked ("GET <path>" must be a line there); without it, this
   list mirrors it (every /api/facts/<card> is one line each in the file). */
const READS = ['/api/entities/header', '/api/books/health', '/api/entities/me', '/api/entities/sides', '/api/work/facts', '/api/notifications', '/api/events/ticket', '/api/events/stream', '/api/books-grants', '/api/books-grants/practice'];
const budgeted = (p, method) => BUDGET_ROUTES ? BUDGET_ROUTES.includes((method || 'GET') + ' ' + p) : (READS.includes(p) || p.startsWith('/api/facts/'));

/* a planted manifest: facts URLs on four cards (two need you, one is in use with three lines, one is not started), the "Your work" read and its door.
   pillar decides the section: sales/marketing = Selling, finance/accounting = Money, the rest of the areas by their default. */
const PLANTED = { version: 2,
  rail: { route: '/tasks.html', facts: '/api/work/facts' },
  entries: [
    { id: 'till', name: 'Till', route: '/till.html', icon: '▤', area: 'selling', pillar: 'sales', state: 'built', what: 'Take money at the counter.', facts: '/api/facts/till' },
    { id: 'storefront', name: 'Storefront', route: '/shop.html', icon: '◇', area: 'selling', pillar: 'marketing', state: 'built', what: 'Your shop on the web.', facts: null },
    { id: 'marketing', name: 'Marketing', route: '/crm.html#/groups', icon: '◉', area: 'selling', pillar: 'marketing', state: 'built', what: 'Reach customers and bring them back.', facts: '/api/facts/marketing' },
    { id: 'catalogue', name: 'Catalogue', route: null, icon: '▦', area: 'selling', pillar: 'marketing', state: 'workshop' },
    { id: 'orders', name: 'Orders', route: null, icon: '↓', area: 'selling', pillar: 'sales', state: 'coming' },
    { id: 'finance', name: 'Finance', route: '/finance.html', icon: '◐', area: 'money', pillar: 'finance', state: 'built', what: 'Who owes you, who you owe.', facts: '/api/facts/finance' },
    { id: 'accounts', name: 'Accounts', route: '/accounts.html', icon: '¤', area: 'money', pillar: 'accounting', state: 'built', what: 'What the shop made, and what it owes.', facts: '/api/facts/accounts' },
    { id: 'crm', name: 'CRM', route: '/crm.html', icon: '◍', area: 'running', pillar: 'sales', state: 'built', what: 'Who buys, and how often.', facts: null },
    { id: 'product-lab', name: 'Product Lab', route: '/product-lab.html', icon: '◈', area: 'labs', pillar: 'labs', state: 'built', what: 'Cost, price, and what each one leaves you.', facts: null },
    { id: 'tax-lab', name: 'Tax Lab', route: null, icon: '§', area: 'labs', pillar: 'labs', state: 'coming' },
    { id: 'standards', name: 'Standards', route: '/standards.html', icon: '≡', area: 'setup', pillar: 'setup', state: 'built', what: 'What a chit must contain.', facts: null },
    { id: 'shop', name: 'Your business', route: null, icon: '⌂', area: 'setup', pillar: 'setup', state: 'workshop' }
  ] };
/* what each planted card's facts answer says: the server's `state` and its lines */
const FACTS = {
  /* RPT2: figures.trend — the teaser (8 weeks' sales in minor units, oldest first; the engine's change vs last year), drawn beside the line */
  '/api/facts/till': { state: 'needs_you', lines: [{ text: '12 bills · {money}', money: { amount: 4280, currency: 'INR' } }, { text: '1 bill waiting to send', tone: 'dn', act: { label: 'Send now', href: '/till.html' } }],
    figures: { trend: { spark: [400000, 380000, null, 420000, 450000, 410000, 470000, null], vs_last_year_pct: 12 } } },
  '/api/facts/accounts': { state: 'needs_you', lines: ['Ledger up to 7 Oct'] },
  '/api/facts/finance': { state: 'in_use', lines: ['3 customers owe you', '2 bills to pay', 'Cash is steady'] },
  '/api/facts/marketing': { state: 'not_started', lines: [] },
  '/api/work/facts': { truncated: false, counts: { orders_in: 5, orders_out: 2, tasks: 4, done: 7 }, lines: [{ text: '3 new orders', value: 3, tone: 'dn' }],
    figures: { orders_new: 3, tasks_mine: 2, orders_in: 5, orders_out: 2, tasks: 4, done: 7 } }
};
const PLANTED_STATE = { till: 'needs_you', accounts: 'needs_you', finance: 'in_use', marketing: 'not_started' };
/* the two reference drawers' answer (GET /api/entities/sides) - what is drawn inside them is e2e/cb-sides.cjs's business */
const SIDES = { lean: [{ key: 'rules', rows: [{ id: 'jurisdiction', n: 'India', m: 'Jurisdiction', s: 'ok', t: 'Current' }] }], use: [{ key: 'trade', rows: [{ id: 'customers', n: '2 customers', m: '24 chits open' }] }], impact: null };
/* the shop's /me row (a 404 here is "this account is gone": the avatar clears the session and the sign-in shows - see public/app/avatar.js pull) */
const ME = { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR' } };
const AREA_LIST = ['home', 'selling', 'money', 'running', 'trade', 'labs', 'setup'];   /* public/app/shell.js AREAS */

async function run() {
  const { chromium } = require('@playwright/test');
  const out = { pass: 0, fail: 0 };
  const ok = (c, m) => { if (c) out.pass++; else out.fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };
  /* QA-154: the two findings that had no baseline (a read with no budget line; words over an area's budget) are recorded in
     e2e/scanner-known.json. A word over budget is one finding per excess word, so a rise fails and a fall is a fix. */
  const found = [];

  /* ── 1 · static ── */
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  /* the sign-in window's Register link is the workshop's page until a customer register page exists (BACKLOG: REGISTER PAGE) - the ONE allowed mention */
  ok(!/app\.html/.test(src.replace(/registerHref:\s*'\/app\.html#\/register'/, '')), 'static · zero "app.html" in index.html (I12) bar the Register link');
  ok(!/\btier\b/i.test(src), 'static · no word "tier" (Q5)');
  ok(!/accounting|books of account/i.test(src), 'static · neither "accounting" nor "books of account" (it is the Ledger)');
  ok(!/class="(box|lab|cbsh-box|cbsh-sc)[" ]/.test(src) && !/data-testid="(box|lab)-/.test(src), 'static · no hand-written card: every card is a manifest row');
  ok(/\/app\/shell\.js/.test(src) && /CBShell\.mount\(/.test(src) && /host:\s*null/.test(src), 'static · index.html mounts CBShell as Home (host null)');
  ok(!/\balert\s*\(/.test(src), 'static · no alert()');
  const man = JSON.parse(fs.readFileSync(path.join(PUB, 'app', 'manifest.json'), 'utf8'));
  /* TEMPORARY external dev card (Coverage, UX-141): an absolute URL is not a utility page file */
  const exists = (r) => { if (/^https?:\/\//.test(r)) return true; const p = r.split(/[#?]/)[0]; return p === '/' ? false : fs.existsSync(path.join(PUB, p)); };
  const badBuilt = man.entries.filter((e) => e.state === 'built' && !(e.route && exists(e.route) && !/app\.html/.test(e.route))).map((e) => e.id);
  const badRest = man.entries.filter((e) => e.state !== 'built' && e.route).map((e) => e.id);
  ok(badBuilt.length === 0, 'manifest · every built entry routes to a utility page that exists, never app.html, never the index itself' + (badBuilt.length ? ' — not: ' + badBuilt.join(', ') : ''));
  ok(badRest.length === 0, 'manifest · coming / workshop entries have no route (dashed chips)' + (badRest.length ? ' — routed: ' + badRest.join(', ') : ''));
  ok(man.rail && 'route' in man.rail && 'facts' in man.rail && !/app\.html/.test(JSON.stringify(man)), 'manifest · the rail widget is declared (route · facts), and nothing names app.html');
  const eff = (e) => (e.works && e.state === 'workshop' ? 'built' : e.state);   /* the roadmap's reading of a row (manifest `works`) */
  const BUILT = man.entries.filter((e) => e.state === 'built'), REST = man.entries.filter((e) => e.state !== 'built');
  for (const w of ['Catalogue', 'Accounts', 'Till', 'Standards', 'Suppliers', 'Assist', 'Connectors', 'Your business', 'Counters', 'CRM', 'Product Lab', 'Offer Lab', 'Combo Lab']) {
    ok(man.entries.some((e) => e.name === w), 'manifest · the old index\'s "' + w + '" is a manifest row');
  }

  /* ── the site as it deploys: / is the repo-root index.html, everything else public/ ── */
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if ((!f.startsWith(PUB) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch(), errs = [];

  /* the session the apps store: a signed token whose identity is the shop (CBOnePerson.who reads it) */
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const TOKEN = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-idx', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
  const SESSION = JSON.stringify({ token: TOKEN, role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan', bridgeId: 'CBTEST1234' });

  async function profile(vw, vh, p) {
    p = p || {};
    const seen = [], calls = [];
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    if (p.manifest) await ctx.route('**/app/manifest.json', (r) => J(r, 200, p.manifest));
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()); seen.push(u.pathname); calls.push({ m: r.request().method(), p: u.pathname });
      if (u.pathname === '/api/entities/me' && r.request().method() === 'GET') return J(r, 200, p.me || ME);
      if (u.pathname === '/api/entities/sides') return J(r, 200, SIDES);
      if (u.pathname === '/api/entities/header') return J(r, 404, { error: 'not found' });            /* N19 built, not live: the empty state stays */
      if (u.pathname === '/api/books/health') {
        if (p.booksOff) return J(r, 404, { error: 'Not found' });
        return J(r, 200, books.health(Object.assign({ waiting: (p.waiting || []).map((w) => books.waitingRow(w)) }, p.health || {})));
      }
      if (p.manifest && FACTS[u.pathname]) return J(r, 200, FACTS[u.pathname]);   /* the shipped manifest's facts reads do not exist yet: 404 */
      return J(r, 404, { error: 'not found' });
    });
    await ctx.addInitScript(([s, signedOut, pair]) => { try {
      localStorage.setItem('cb_api_base', location.origin);
      if (signedOut) localStorage.removeItem('cb_sess'); else localStorage.setItem('cb_sess', s);
      if (pair) { localStorage.setItem('cb_till_lastslot', 'cb-till-abc1'); localStorage.setItem('cb_till_key', 'k-abc1');
        localStorage.setItem('cb_till_shop@abc1', pair.ent); localStorage.setItem('cb_till_shopname@abc1', pair.name); }
    } catch (_) {} }, [SESSION, !!p.signedOut, p.pair || null]);
    return { ctx, seen, calls };
  }
  async function open(ctx, q) {
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message)));
    await pg.goto(base + '/' + (q || ''));
    await pg.waitForSelector('[data-testid="cbshell"]', { timeout: 20000 });
    await pg.evaluate(() => window.SHELL && window.SHELL.ready);
    await pg.waitForTimeout(400);
    return pg;
  }
  const vis = (pg, sel) => pg.locator(sel).first().isVisible().catch(() => false);
  const areaWords = (pg, a) => pg.evaluate((x) => { const s = document.querySelector('.cbsh-sec.' + x); if (!s) return -1; return (s.innerText || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length; }, a);
  /* Q10: every area <= 100 words, Home <= 120 (Setup trimmed back to it on 17 Oct: shorter tile lines, no wider budget) */
  const BUDGET = { home: 120, selling: 100, money: 100, running: 100, trade: 100, labs: 100, setup: 100 };
  /* the allow-list: whatever CBAvatar writes in its own slot (its Profile · Support doors, the Sign in door) — nothing else may name app.html */
  const offList = (pg) => pg.$$eval('a[href*="app.html"]', (as) => as.filter((a) => !a.closest('[data-testid="shell-avatar"]') && a.getAttribute('data-testid') !== 'signin-register').map((a) => a.getAttribute('href')));
  fs.mkdirSync(SHOTS, { recursive: true });

  try {
    /* ── 2 + 3 · 1366, signed in, the shipped manifest, nothing wrong ── */
    {
      const { ctx, seen, calls } = await profile(1366, 800), pg = await open(ctx);
      ok(await pg.locator('[data-testid="cbshell"]').count() === 1 && await pg.getAttribute('[data-testid="cbshell"]', 'data-mode') === 'home', '1366 · Home mounts the shell once, as Home');
      ok(await pg.locator('[data-testid="shell-nav"]').count() === 1 && await pg.locator('[data-testid="shell-avatar"] [data-testid="cbavatar"]').count() === 1, '1366 · the nav and the one avatar are the shell\'s');
      const navAreas = await pg.$$eval('[data-testid="shell-nav"] .cbsh-nv', (bs) => bs.filter((b) => !b.hidden && b.offsetParent).map((b) => b.getAttribute('data-go')));
      const shellAreas = await pg.evaluate(() => window.CBShell.AREAS); const W = await pg.evaluate(() => window.CBShell.WORDS);
      ok(navAreas.join() === AREA_LIST.join() && shellAreas.join() === AREA_LIST.join(), '1366 · the nav has SEVEN areas, in order: ' + AREA_LIST.join(' · ') + ' (drawn: ' + navAreas.join(' · ') + ')');
      const sections = await pg.$$eval('.cbsh-sec', (ss) => ss.map((x) => x.dataset.area));
      ok(sections.join() === AREA_LIST.join(), '1366 · one section per area: Home (with the "Your work" box) · Selling · Money · Running it · Trade · Labs · Setup (' + sections.join(' · ') + ')');
      const heads = await pg.$$eval('.cbsh-ph', (hs) => hs.map((h) => (h.querySelector('.rn') || h).textContent.trim()));   /* Trade · Labs · Setup are phone "rows": the name (.rn) beside a one-line purpose (.rs) */
      ok(heads.length === 7 && heads[0] === W.areas.home && ['selling', 'money', 'running', 'trade', 'labs', 'setup'].every((a, i) => heads[i + 1] === W.caption[a]), '1366 · the section headings (' + heads.join(' · ') + ')');
      const tiles = await pg.$$eval('.cbsh-box', (bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
      ok(tiles.length === BUILT.length && tiles.every((h) => h === 148), '1366 · all ' + tiles.length + ' tiles are 148px tall (' + [...new Set(tiles)].join(', ') + ')');
      ok(await pg.locator('.cbsh-box').count() === BUILT.length && await pg.locator('.cbsh-sc').count() === REST.length, '1366 · ' + BUILT.length + ' cards and ' + REST.length + ' dashed chips — one per manifest row');
      let hrefsOk = true;
      for (const e of BUILT) { const h = await pg.getAttribute('[data-testid="shell-card-' + e.id + '"]', 'href'); if (h !== e.route.replace('{bridge_id}', 'CBTEST1234')) { hrefsOk = false; console.log('      ' + e.id + ' → ' + h); } }
      ok(hrefsOk, '1366 · every built card links to its utility page');
      ok((await offList(pg)).length === 0, '1366 · zero app.html hrefs outside the avatar (the allow-list: CBAvatar\'s own doors)');
      const chips = await pg.$$eval('.cbsh-sc', (cs) => cs.map((c) => ({ id: c.dataset.testid, st: c.dataset.state, link: c.tagName === 'A' || !!c.querySelector('a'), via: c.dataset.via === '1', href: c.getAttribute('href'), tag: (c.querySelector('.tag') || {}).textContent })));
      ok(chips.length && chips.every((c) => (c.via ? /^\/[a-z-]+\.html$/.test(c.href || '') : !c.link) && (c.st === 'workshop' || c.st === 'coming' || c.st === 'works') && c.tag), '1366 · every chip is dashed, names its state, and is not a link (bar a workshop item that names its closest built page: Catalogue to Product Lab)');
      const before = pg.url(), pages = ctx.pages().length;
      await pg.click('[data-testid="shell-chip-delivery"]'); await pg.waitForTimeout(250);   /* delivery: still a coming chip (Stock became a built card in T3-OPS) */
      ok(pg.url() === before && ctx.pages().length === pages, '1366 · a workshop chip opens nothing');
      /* NAMES-1 (Athi, 17 Oct): "Running it" is one flat group, like Trade; Stock stands in it; every tile says what it is for */
      const run = await pg.evaluate(() => { const s = document.querySelector('.cbsh-sec.running'); const ids = (sel) => [...s.querySelectorAll(sel)].map((n) => n.getAttribute('data-testid').replace(/^shell-(card|chip)-/, ''));
        return { pils: s.querySelectorAll('.cbsh-pil').length, cards: ids('.cbsh-box'), chips: ids('.cbsh-sc'), stock: (s.querySelector('[data-testid="shell-card-stock"] h4') || {}).textContent }; });
      ok(run.pils === 0 && run.cards.join() === 'operations,stock,tasks,suppliers,counters,employees,coassist' && run.chips.join() === 'delivery',
        '1366 · Running it is flat: ' + run.cards.join(' · ') + ', then the later chips ' + run.chips.join(' · ') + ' (' + run.pils + ' sub-panels)');
      ok(run.stock === 'Stock', '1366 · Stock is a tile under Running it, and a shop with no country reads the neutral word "Stock" (' + run.stock + ')');
      const bare = await pg.$$eval('.cbsh-box', (bs) => bs.filter((b) => !((b.querySelector('.what') || {}).textContent || '').trim()).map((b) => b.dataset.id));
      ok(bare.length === 0, '1366 · no tile without its purpose line' + (bare.length ? ' — bare: ' + bare.join(', ') : ''));
      /* reads: only budgeted ones; null facts paint nothing */
      const unbudgeted = [...new Set(calls.filter((c) => !budgeted(c.p, c.m)).map((c) => c.m + ' ' + c.p))];
      unbudgeted.forEach((u) => found.push({ key: 'no budget line: ' + u, show: u }));
      ok(true, '1366 · (known list, see below) every read has its budget line in ' + (BUDGET_FILE ? path.basename(path.dirname(BUDGET_FILE)) + '/round-trips.budget.json' : '(api checkout not found - the mirrored list)') + ' (' + [...new Set(seen)].length + ' routes)' + (unbudgeted.length ? ' — not: ' + unbudgeted.join(', ') : ''));
      ok(seen.includes('/api/entities/sides') && seen.includes('/api/work/facts'), '1366 · the drawers asked /api/entities/sides and "Your work" asked /api/work/facts (both have a budget line)');
      ok(seen.includes('/api/books/health'), '1366 · the ledger\'s waiting posts were asked (GET /api/books/health)');
      /* the shipped manifest's facts reads answer 404 (not built yet): a tile says "—" at most - no figure, no status, nothing invented */
      const factsText = await pg.$$eval('.cbsh-box .facts', (fs_) => fs_.map((f) => f.textContent.trim()));
      ok(factsText.every((t) => t === '' || t === '—') && await pg.locator('[data-testid="shell-state"]').count() === 0 && await pg.locator('[data-testid="shell-needs"]').isHidden(), '1366 · a card whose facts read does not exist yet shows no figure and no status; the "Needs you" strip stays hidden');
      const al = await pg.evaluate(() => { const a = document.querySelector('[data-slot="alerts"]'); return { kids: a.childElementCount, h: a.offsetHeight, ids: [...a.querySelectorAll('[data-testid]')].map((n) => n.dataset.testid).join() }; });
      ok(al.kids === 0 && al.h === 0, '1366 · nothing wrong → the alerts slot draws nothing (' + al.h + 'px' + (al.kids ? '; it draws: ' + al.ids : '') + ')');
      ok(await pg.locator('[data-testid="rail"]').count() === 0, '1366 · the rail has no read yet → it is not drawn (never an invented number)');
      await pg.click('[data-testid="shell-shop"]');
      const st = await pg.locator('[data-testid="shell-sheet"]').innerText();
      ok(await vis(pg, '[data-testid="shell-sheet-empty"]') && /not available yet/i.test(st) && !/\d/.test(st), '1366 · N19 404 → the sheet\'s empty state, no number (kept)');
      await pg.keyboard.press('Escape');
      ok(await pg.evaluate(() => !!document.querySelector('.cbsh-foot #cbkural')), '1366 · the kural is the footer band');
      for (const a of Object.keys(BUDGET)) { const n = await areaWords(pg, a); for (let w = 0; w < n - BUDGET[a]; w++) found.push({ key: 'words over budget in ' + a, show: a + ' word ' + (BUDGET[a] + w + 1) }); ok(n >= 0, '1366 · words in ' + a + ': ' + n + ' (budget ' + BUDGET[a] + ', ' + Math.max(0, n - BUDGET[a]) + ' over, ratcheted)'); }
      {
        const RK = require('./lib/known-findings.cjs').ratchet('index-page', found, { owner: 'ux-locale (words) / api (budget lines)' });
        console.log(RK.line);
        ok(RK.fresh.length === 0, 'no NEW unbudgeted read or word over budget' + (RK.fresh.length ? ': ' + RK.fresh.map((i) => i.key + ' [' + i.show + ']').join('; ') : ''));
      }
      ok(!/accounting|books of account|error|404/i.test(await pg.evaluate(() => document.body.innerText)), '1366 · no forbidden word, no error string on the screen');
      await pg.screenshot({ path: path.join(SHOTS, 'index-laptop.png') });
      await ctx.close();
    }

    /* ── 3b · a US shop: the Stock tile is the country's word, Inventory (NAMES-1: helpers.js packWord, the per-country words) ── */
    {
      const { ctx } = await profile(1366, 800, { me: { entity: { display_name: 'Main Street Store', currency_code: 'USD', country: 'US' } } }), pg = await open(ctx);
      await pg.waitForFunction(() => window.CBAvatar && window.CBAvatar.shopCountry && window.CBAvatar.shopCountry() === 'US', null, { timeout: 10000 }).catch(() => {});
      await pg.waitForTimeout(200);
      const word = await pg.locator('.cbsh-sec.running [data-testid="shell-card-stock"] h4').innerText().catch(() => '');
      ok(word === 'Inventory', '1366 · a US shop: the Stock tile under Running it says "Inventory" (' + word + ')');
      await ctx.close();
    }

    /* ── 4 · 1366, a planted manifest and a planted API: facts, the rail, the alerts ── */
    {
      const { ctx } = await profile(1366, 800, { manifest: PLANTED, waiting: [{ id: 1, reason: 'Paid by Points — there is no ledger for Points yet.' }, { id: 2, reason: 'September is locked.' },
        { id: 3, todo: 'accept', reason: 'Waiting for you to confirm the goods were received (bill SG-103 from Sri Ganesh Provisions)' }, { id: 4, todo: 'add_supplier', name: 'Sri Ganesh', reason: 'Who is Sri Ganesh? Add them as a supplier — then bill SG-102 waits for you to accept it.' }], pair: { ent: 'ent-C', name: 'Mayuri123' } });
      const pg = await open(ctx);
      await pg.waitForSelector('[data-testid="rail"]', { timeout: 8000 }).catch(() => {});
      /* a tile shows its status, ONE line and a "+n"; every line is in the drop-down (.more) */
      const tf = await pg.$eval('[data-testid="shell-facts-till"]', (n) => ({ tile: n.innerText.replace(/\s+/g, ' ').trim(), more: (n.querySelector('.more') || {}).textContent || '', n: (n.querySelector('.more-n') || {}).textContent, lines: n.querySelectorAll('.more .f').length }));
      ok(/12 bills · ₹4,280/.test(tf.tile) && tf.n === '+1 more' && tf.lines === 2 && /1 bill waiting to send Send now ›/.test(tf.more) && !/INR|{money}/.test(tf.tile + tf.more), 'planted · the Till tile shows one line and "+1"; its drop-down holds both lines, from the API ("' + tf.tile + '" / "' + tf.more.trim() + '")');
      /* RPT2: the Till card's teaser — the sparkline + "↑ +12% vs last year" (arrow + sign + words), a door into Reports › Trend, inside the tile's one row */
      const teaser = await pg.evaluate(() => { const t = document.querySelector('[data-testid="shell-facts-till"] [data-testid="shell-fact-trend"]'); return t ? { words: t.textContent.replace(/\s+/g, ' ').trim(), href: t.getAttribute('data-href'), svg: !!t.querySelector('svg[role="img"][aria-label]'), h: Math.round(t.getBoundingClientRect().height) } : null; });
      ok(teaser && teaser.svg && teaser.words === '↑ +12% vs last year' && teaser.href === '/finance.html#/reports/trend/week' && teaser.h <= 24, 'planted · the Till card carries the teaser: a sparkline + "↑ +12% vs last year", opening Reports › Trend, one line high (' + JSON.stringify(teaser) + ')');
      ok(/Ledger up to 7 Oct/.test(await pg.locator('[data-testid="shell-facts-accounts"]').innerText()) && await pg.locator('[data-testid="shell-facts-accounts"] .more-n').count() === 0, 'planted · the Accounts tile: one line from the API, no +n');
      const fin = await pg.$eval('[data-testid="shell-facts-finance"]', (n) => ({ tile: n.innerText.replace(/\s+/g, ' ').trim(), n: (n.querySelector('.more-n') || {}).textContent, lines: [...n.querySelectorAll('.more .f')].map((x) => x.textContent.trim()) }));
      ok(/3 customers owe you/.test(fin.tile) && fin.n === '+2 more' && fin.lines.join('|') === '3 customers owe you|2 bills to pay|Cash is steady', 'planted · three lines → one on the tile, "+2", all three in the drop-down (' + fin.lines.join(' | ') + ')');
      ok(await pg.$eval('[data-testid="shell-facts-finance"] .more-n', (n) => n.getAttribute('title')) === 'All 3 lines of this tile', 'UX-3 · the "+2" badge says what it counts: "All 3 lines of this tile"');
      /* STATUS: shell-state on every card whose facts answered (state, or lines); none on a card with no facts read */
      const sts = await pg.$$eval('.cbsh-box', (bs) => bs.map((b) => ({ id: b.dataset.id, st: (b.querySelector('[data-testid="shell-state"]') || { dataset: {} }).dataset.state || null })));
      const wrongSt = sts.filter((x) => (PLANTED_STATE[x.id] || null) !== x.st);
      ok(Object.keys(PLANTED_STATE).every((id) => sts.some((x) => x.id === id)) && wrongSt.length === 0, 'planted · every card whose facts answered carries its status (shell-state): ' + Object.keys(PLANTED_STATE).map((id) => id + '=' + PLANTED_STATE[id]).join(' · ') + (wrongSt.length ? ' — wrong: ' + wrongSt.map((x) => x.id + '=' + x.st).join(', ') : ''));
      const ns = await pg.$eval('[data-testid="shell-facts-marketing"]', (n) => n.innerText.replace(/\s+/g, ' ').trim());
      ok(/Not started/.test(ns) && /Set up ›/.test(ns) && !/No .* yet/i.test(ns), 'planted · a not-started card says so and invites ("' + ns + '"), never "No X yet"');
      /* HOME'S NEEDS-YOU STRIP: exactly the needs_you cards, each a door to its page, above every tile */
      const need = await pg.$eval('[data-testid="shell-needs"]', (n) => ({ hidden: n.hidden, ids: [...n.querySelectorAll('a')].map((a) => a.dataset.testid.replace('shell-needs-', '')).sort(), hrefs: [...n.querySelectorAll('a')].map((a) => a.getAttribute('href')).sort() }));
      const wantNeed = Object.keys(PLANTED_STATE).filter((k) => PLANTED_STATE[k] === 'needs_you').sort();
      ok(!need.hidden && need.ids.join() === wantNeed.join() && need.hrefs.join() === ['/accounts.html', '/till.html'].join(), 'planted · the "Needs you" strip lists exactly the needs_you cards (' + wantNeed.join(', ') + '), each a door (' + need.ids.join(', ') + ')');
      const tiles2 = await pg.$$eval('.cbsh-box', (bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)));
      ok(tiles2.length > 0 && tiles2.every((h) => h === 148), 'planted · every tile stays 148px with a status, a +n and a drop-down (' + [...new Set(tiles2)].join(', ') + ')');
      const yw = await pg.$eval('[data-testid="rail"]', (n) => ({ head: n.querySelector('h3').textContent.trim(), home: !!n.closest('.cbsh-sec.home') }));
      ok(yw.head === 'Your work' && yw.home, 'planted · the "Your work" box sits in Home (' + yw.head + ')');
      ok((await pg.locator('[data-testid="shell-facts-crm"]').innerText()).trim() === '', 'planted · a card with facts null shows nothing');
      const rail = await pg.evaluate(() => { const t = (s) => (document.querySelector('[data-testid="' + s + '"]') || {}).textContent; const o = document.querySelector('[data-testid="rail-open"]'); return { n: t('work-new'), i: t('work-in'), o: t('work-out'), m: t('work-mine'), d: t('work-done'), open: o && o.getAttribute('href') }; });
      ok(rail.n === '3' && rail.i === '5' && rail.o === '2' && rail.m === '2' && rail.d === '7', 'planted · "Your work" digits are the API\'s (' + JSON.stringify(rail) + ')');
      ok(rail.open === '/tasks.html', 'planted · the "Your work" Open goes where the manifest says (rail.route)');
      const rows = await pg.$$eval('[data-slot="alerts"] .al', (els) => els.map((e) => ({ id: e.dataset.testid, lvl: e.className.replace('al ', ''), text: e.textContent.replace(/\s+/g, ' ').trim(), fix: (e.querySelector('.fix') || {}).getAttribute && e.querySelector('.fix').getAttribute('href') })));
      const led = rows.find((r) => r.id === 'ledger-waiting'), pr = rows.find((r) => r.id === 'till-paired');
      ok(led && /things? (is|are) waiting for you/.test(led.text) && led.fix === '/accounts.html#waiting', 'planted · ONE waiting row with ONE count (NAV-MAP 7) - its number is the API sum, its fix opens Accounts (' + (led && led.text) + ')');
      /* FX-F10W: the same counts as Books' To do — each waiting row's `todo`, each kind its own words and door (never "4 waiting for the ledger") */
      ok(!rows.some((r) => r.id === 'ledger-accept' || r.id === 'ledger-supplier'), 'planted · the three waiting rows are ONE row');
      ok(!rows.some((r) => /waiting for the ledger/.test(r.text)), 'planted · no row says "waiting for the ledger"');
      ok(pr && pr.lvl === 'warn' && /Counter 1 · paired to Mayuri123, not this shop/.test(pr.text) && (pr.fix || '') === '/till.html#shop=ent-idx&as=Mayur%20Bhavan', 'planted · a counter paired to another shop earns an amber row whose button pairs it here (' + (pr && pr.text) + ' → ' + (pr && pr.fix) + ')');
      ok(rows.every((r) => r.fix), 'planted · every alert carries the button that fixes it');
      for (const a of Object.keys(BUDGET)) { const n = await areaWords(pg, a); ok(n >= 0 && n <= BUDGET[a], 'planted 1366 · words in ' + a + ': ' + n + ' ≤ ' + BUDGET[a]); }
      await pg.screenshot({ path: path.join(SHOTS, 'index-alerts.png') });
      await ctx.close();
    }
    /* ── 4b · STD1: Home says the server's ONE count (/health todo — GROUP BY over every waiting row), never the 50-row page's length ── */
    {
      const page = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, todo: 'accept', reason: 'Waiting for you to confirm the goods (bill B' + i + ')' }));
      const { ctx } = await profile(1366, 800, { manifest: PLANTED, waiting: page, health: { total: 211, todo: { accept: 120, add_supplier: 90, record: 1 } } });
      const pg = await open(ctx);
      await pg.waitForSelector('[data-testid="ledger-waiting"]', { timeout: 8000 }).catch(() => {});
      const t = (id) => pg.evaluate((x) => ((document.querySelector('[data-testid="' + x + '"]') || {}).textContent || '').replace(/\s+/g, ' '), id);
      ok(/(^|[^0-9])211 things are waiting for you/.test(await t('ledger-waiting')),
        'STD1 · > 50 rows: Home says the server count (120 + 90 + 1 = 211) in one row, not the page of 50 (' + (await t('ledger-waiting')) + ')');
      await ctx.close();
    }

    /* ── 5 + 6 · 390, the same planted day: bottom tabs, one area at a time, the rail and the alerts on Home, no sideways scroll ── */
    {
      const { ctx } = await profile(390, 844, { manifest: PLANTED, waiting: [{ id: 1, reason: 'September is locked.' }] }), pg = await open(ctx);
      await pg.waitForSelector('[data-testid="rail"]', { timeout: 8000 }).catch(() => {});
      const sw = () => pg.evaluate(() => document.scrollingElement.scrollWidth);
      ok(await sw() === 390, '390 · scrollWidth === 390 (' + await sw() + ')');
      const nav = await pg.evaluate(() => { const r = document.querySelector('.cbsh-nav').getBoundingClientRect(); return { bottom: Math.round(r.bottom), w: Math.round(r.width) }; });
      ok(nav.bottom === 844 && nav.w === 390, '390 · the seven areas are a bottom tab bar');
      ok(await pg.evaluate(() => [...document.querySelectorAll('.cbsh-sec')].filter((s) => s.offsetParent).map((s) => s.dataset.area).join()) === 'home', '390 · one area at a time: Home first');
      ok(await vis(pg, '[data-testid="rail"]') && await vis(pg, '[data-testid="ledger-waiting"]'), '390 · Home shows the rail and the alert');
      const railR = await pg.evaluate(() => { const r = document.querySelector('[data-testid="rail"]').getBoundingClientRect(); return { l: r.left, r: Math.round(r.right) }; });
      ok(railR.l >= 0 && railR.r <= 390, '390 · the rail sits inside the screen (' + railR.l + ' → ' + railR.r + ')');
      ok(await pg.evaluate(() => !!document.querySelector('[data-testid="shell-pfoot"] #cbkural')), '390 · the kural sits in the footer above the tab bar (never a card in Home)');
      await pg.screenshot({ path: path.join(SHOTS, 'index-phone.png') });
      for (const a of Object.keys(BUDGET)) {
        const isMore = ['trade', 'labs', 'setup'].includes(a);
        await pg.click('[data-testid="shell-nav-' + (isMore ? 'more' : a) + '"]'); if (isMore) await pg.click('[data-testid="shell-row-' + a + '"]'); await pg.waitForTimeout(120);   /* five tabs: Trade, Labs and Setup are rows on More */
        const shown = await pg.evaluate(() => [...document.querySelectorAll('.cbsh-sec')].filter((s) => s.offsetParent).map((s) => s.dataset.area).join());
        const n = await areaWords(pg, a);
        ok((isMore ? shown === 'trade,labs,setup' : shown === a) && n <= BUDGET[a] && await sw() === 390, '390 · tab ' + a + ' shows only ' + a + ', ' + n + ' words ≤ ' + BUDGET[a] + ', no sideways scroll');
        if (a === 'selling') await pg.screenshot({ path: path.join(SHOTS, 'index-phone-selling.png') });
      }
      ok((await offList(pg)).length === 0, '390 · zero app.html hrefs outside the avatar');
      await ctx.close();
    }

    /* ── the ledger off: a 404 is nothing wrong ── */
    {
      const { ctx, seen } = await profile(1366, 800, { booksOff: true }), pg = await open(ctx);
      await pg.waitForTimeout(300);
      ok(seen.includes('/api/books/health') && await pg.locator('[data-slot="alerts"] .al').count() === 0 && !/404/.test(await pg.evaluate(() => document.body.innerText)), 'ledger off · the 404 earns no row and never reaches the screen');
      await ctx.close();
    }

    /* ── 7 · signed out ── */
    {
      const { ctx, seen } = await profile(1366, 800, { signedOut: true }), pg = await open(ctx);
      ok(seen.length === 0, 'signed out · not one /api call leaves the page (' + seen.length + ')');
      ok(await pg.locator('.cbsh-box').count() === BUILT.length && await pg.$$eval('.cbsh-box .facts', (fs_) => fs_.every((f) => f.textContent.trim() === '')), 'signed out · the cards are still drawn, with no facts');
      ok(await pg.locator('[data-testid="signin-door"]').count() === 1 && await pg.locator('[data-testid="shell-shop"]').count() === 0, 'signed out · the avatar is the one Sign in door; no shop button');
      ok(await pg.locator('[data-slot="alerts"] .al').count() === 0, 'signed out · no alerts');
      ok((await offList(pg)).length === 0, 'signed out · zero app.html hrefs outside the avatar');
      await ctx.close();
    }
    {
      const { ctx, seen } = await profile(1366, 800), pg = await open(ctx, '?left=Other%20Shop');
      const row = pg.locator('[data-testid="signed-out-why"]');
      ok(await row.count() === 1 && /Signed out — Other Shop opened in another tab\./.test(await row.innerText()), 'left · the row says why (' + (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() + ')');
      ok(await pg.locator('[data-testid="signed-out-go"]').count() === 1 && await pg.locator('[data-testid="signin-door"]').count() === 1 && seen.length === 0, 'left · its button is the avatar\'s door, and nothing was read');
      ok((await offList(pg)).length === 0, 'left · still zero app.html hrefs outside the avatar');
      await ctx.close();
    }

    /* ── 8 · THE MANIFEST'S ROADMAP KEYS (read by the Sign-in Lab Roadmap tab) · every built route opens · no per-shop figure before sign-in ── */
    {
      const longFits = man.entries.filter((e) => e.fits && (typeof e.fits !== 'string' || e.fits.split(' ').length > 16)).map((e) => e.id + ' (' + e.fits.split(' ').length + ' words)');
      ok(man.entries.every((e) => !e.rows || Array.isArray(e.rows)) && man.entries.every((e) => !e.phase || typeof e.phase === 'string') && longFits.length === 0, 'manifest · rows is a list, phase and fits are short strings (fits <= 16 words)' + (longFits.length ? ' - too long: ' + longFits.join(', ') : ''));
      ok(/rows = /.test(man._) && /phase = /.test(man._) && /fits = /.test(man._) && /Sign-in Lab Roadmap/.test(man._), 'manifest · the keys (rows · phase · fits) are in the manifest\'s own dictionary, read by the Sign-in Lab Roadmap tab');
      const { ctx } = await profile(1366, 800, { signedOut: true }), pg = await open(ctx);
      let routesOk = true;
      for (const e of BUILT) { if (/^https?:/.test(e.route)) continue; /* an external dev card (UX-141) is not a page we serve */ const r = await ctx.request.get(base + e.route.replace('{bridge_id}', 'CBTEST1234')); if (r.status() !== 200) { routesOk = false; console.log('      ' + e.route + ' → ' + r.status()); } }
      ok(routesOk, 'every built entry\'s route returns 200');
      const txt = await pg.evaluate(() => document.body.innerText);
      ok(!/\d+ (bills|customers|suppliers)|₹/.test(txt), 'signed out · no per-shop figure (no bills, customers, rupees)');
      await ctx.close();
    }
    {
      const { ctx } = await profile(1366, 800, { manifest: PLANTED }), pg = await open(ctx);
      await pg.waitForSelector('[data-testid="rail"]', { timeout: 8000 }).catch(() => {});
      ok(await pg.locator('[data-testid="roadmap"]').count() === 0 && await pg.locator('[data-testid="rail"]').count() === 1, 'signed in · Home draws "Your work" and no roadmap');
      /* every "Your work" number is a door to the folder it counts */
      const hrefs = await pg.evaluate(() => { const o = {}; ['work-new', 'work-in', 'work-out', 'work-mine', 'work-done'].forEach((k) => { const n = document.querySelector('[data-testid="' + k + '-open"]'); o[k] = n && n.getAttribute('href'); }); return o; });
      ok(hrefs['work-new'] === '/tasks.html?view=orders_in' && hrefs['work-in'] === '/tasks.html?view=orders_in' && hrefs['work-out'] === '/tasks.html?view=orders_out' && hrefs['work-mine'] === '/tasks.html?view=tasks' && hrefs['work-done'] === '/tasks.html?view=done', 'work · each number opens its folder (' + JSON.stringify(hrefs) + ')');
      await ctx.close();
    }
    {
      /* SIGNED IN, a manifest whose rail has no read behind it: nothing is drawn, never a made-up number (index-page-breaks "the rail invents a number") */
      const { ctx } = await profile(1366, 800, { manifest: Object.assign({}, PLANTED, { rail: { route: '/tasks.html', facts: null } }) }), pg = await open(ctx);
      await pg.waitForSelector('.cbsh-box', { timeout: 8000 }).catch(() => {});
      await pg.waitForTimeout(800);
      ok(await pg.locator('[data-testid="rail"]').count() === 0, 'signed in · a rail with no read behind it draws nothing (never an invented number)');
      await ctx.close();
    }

    ok(...C.finish());
    const mine = errs.filter((m) => !/fonts|favicon/i.test(m));
    ok(mine.length === 0, 'no page error' + (mine.length ? ': ' + mine.slice(0, 3).join(' | ') : ''));
  } finally { await b.close(); srv.close(); }
  return out;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    console.log('  (free memory ' + (require('os').freemem() / 1073741824).toFixed(1) + ' GB)');
    const r = await run();
    console.log('\n  index-page: ' + r.pass + ' passed, ' + r.fail + ' failed');
    process.exit(r.fail ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
