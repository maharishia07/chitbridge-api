#!/usr/bin/env node
/* detail-page.cjs — A CHIT OPENS ON THE PAGE IT WAS MADE WITH, OR ON THE BASE PAGE WITH A NOTE (N03 · decisions M-D6 / M-D7).
 * Pattern: one-avatar.cjs — Playwright, the stand-in API of books-web.cjs answering INSIDE the page, a static server on a free OS
 * port. Nothing here reaches localhost:3000 or the live site: every /api/** call is fulfilled by ctx.route.
 *
 * What it proves (exit 1 on any failure):
 *   1  static: app/pages.json has no two rows for one name@version; every row fits the grammar and its script is in the site;
 *      the base page is a row; app.html loads app/page.js
 *   2  ⭐ old version opens base + note: a chit whose header says chit.base.detail@0.9 opens on the base page (its tabs and
 *      content are there) with the visible note "made with chit.base.detail@0.9 — page not installed"
 *   3  a reserved name with no page (sale.restaurant.table@1.0) opens the same way: base + note
 *   4  the installed base page (chit.base.detail@1.0) and a chit with no page (made before N03) open with NO note
 *   5  the registry cannot be read (404): the base page still opens; an old version still gets its note — never a refusal
 *   6  390 px: the note is inside the screen and the page does not scroll sideways
 * Screenshots: e2e/shots/detail-page-old-{laptop,phone}.png
 * Run one at a time:  NODE_PATH=e2e/node_modules node e2e/detail-page.cjs                                                        */
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SHOTS = path.join(__dirname, 'shots');
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });

/** the chits the stand-in holds: id → the page its header names (undefined = made before N03) */
const CHITS = { 'c-old': 'chit.base.detail@0.9', 'c-reserved': 'sale.restaurant.table@1.0', 'c-base': 'chit.base.detail@1.0', 'c-none': undefined };
function chitAnswer(id) {
  const bj = { schema_values: { note: 'two brake pads' } };
  if (CHITS[id] !== undefined) bj.page = CHITS[id];
  return {
    header: { chit_id: id, purpose: 'order', manual_subject: 'Brake pads ' + id, auto_subject: null, current_status: 'pending', created_at: '2026-10-07T05:00:00Z',
      sender_entity_display_name: 'Books Shop', all_recipients: [{ role: 'sender', display_name: 'Books Shop' }, { role: 'receiver', display_name: 'Ravi Stores' }],
      summary_json: { line_item_count: 1, total_value: 118, currency_code: 'INR', purpose: 'order' }, business_json: bj },
    detail: { line_items: [{ particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 59, total: 118 }] },
    live_set: [{ index: 0, live: { particulars: 'Brake pad', quantity: 2, unit: 'piece', price: 59, total: 118 }, original: null, history: [], removed: false }],
    attachments: [], state_log: [], amendments: [],
  };
}

async function run(o) {
  o = o || {};
  const { chromium } = require('@playwright/test');
  const { standIn, route: booksRoute } = require('./books-web.cjs');
  const { serve } = require('./lib/serve.cjs');
  const out = { pass: 0, fail: 0 };
  const ok = (c, m) => { if (c) out.pass++; else out.fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };

  /* ── 1 · static ── */
  const raw = fs.readFileSync(path.join(PUB, 'app', 'pages.json'), 'utf8'), REG = JSON.parse(raw), RE = new RegExp(REG.grammar);
  const ids = REG.pages.map((r) => r.name + '@' + r.version);
  ok(new Set(ids).size === ids.length, 'static · the registry has no two rows for one name@version (' + ids.join(', ') + ')');
  ok(REG.pages.every((r) => RE.test(r.name + '@' + r.version) && fs.existsSync(path.join(PUB, r.script))), 'static · every row fits the grammar and its script is in the site');
  ok(ids.indexOf(REG.base) >= 0 && REG.base === 'chit.base.detail@1.0', 'static · the base page chit.base.detail@1.0 is a row');
  ok(/<script src="\/app\/page\.js"><\/script>/.test(fs.readFileSync(path.join(PUB, 'app.html'), 'utf8')), 'static · app.html loads app/page.js');

  const S = standIn(), web = await serve(PUB), b = await chromium.launch(), errs = [];
  const route = (r) => {
    const u = new URL(r.request().url()), p = u.pathname, m = r.request().method();
    const mm = p.match(/^\/api\/chits\/([a-z-]+)$/);
    if (mm && m === 'GET' && Object.prototype.hasOwnProperty.call(CHITS, mm[1])) return J(r, 200, chitAnswer(mm[1]));
    if (p === '/api/entities/me' && m === 'GET') return J(r, 200, { entity: { display_name: 'Books Shop', currency_code: 'INR' } });
    return booksRoute(S, r);
  };
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const SESS = JSON.stringify({ token: b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-books', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x', role: 'entity', name: 'Books Shop', entity: 'Books Shop' });
  async function profile(vw, vh, o2) {
    o2 = o2 || {};
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', route);
    if (o2.noRegistry) await ctx.route('**/app/pages.json', (r) => r.fulfill({ status: 404, body: 'not found' }));
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, SESS);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(String(e.message)));
    await p.goto(web.url('/app.html#/app'));
    await p.waitForSelector('[data-testid="icon-avatar"]', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(300);
    return { ctx, p };
  }
  async function openOn(p, id) {
    await p.evaluate((x) => openChit(x), id);
    await p.waitForSelector('#detailpane [data-testid="dtab-content"]', { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(150);
    const note = p.locator('#detailpane [data-testid="page-note"]');
    return {
      notes: await note.count(),
      text: (await note.count()) ? (await note.first().innerText()).trim() : '',
      visible: (await note.count()) ? await note.first().isVisible() : false,
      base: (await p.locator('#detailpane [data-testid="dtab-content"]').count()) === 1 && /Brake pad/.test(await p.locator('#detailpane').innerText()),
    };
  }

  try {
    /* ── 2–4 · laptop ── */
    let { ctx, p } = await profile(1366, 800);
    const old = await openOn(p, 'c-old');
    ok(old.base, 'old version · chit.base.detail@0.9 opens on the base page (its tabs and its line are there)');
    ok(old.notes === 1 && old.visible && old.text.indexOf('made with chit.base.detail@0.9 — page not installed') >= 0, 'old version · with the visible note "' + old.text + '"');
    if (!o.noShots) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, 'detail-page-old-laptop.png') }); }
    const res = await openOn(p, 'c-reserved');
    ok(res.base && res.notes === 1 && /made with sale\.restaurant\.table@1\.0 — page not installed/.test(res.text), 'reserved · sale.restaurant.table@1.0 (no page built) opens on base + note');
    const base = await openOn(p, 'c-base');
    ok(base.base && base.notes === 0, 'installed · chit.base.detail@1.0 opens with no note');
    const none = await openOn(p, 'c-none');
    ok(none.base && none.notes === 0, 'no page · a chit made before N03 opens on the base page with no note');
    const back = await openOn(p, 'c-old');
    ok(back.notes === 1, 'the note follows the chit: back to the old one, the note is back');
    await ctx.close();

    /* ── 5 · the registry cannot be read ── */
    ({ ctx, p } = await profile(1366, 800, { noRegistry: true }));
    const nb = await openOn(p, 'c-base'), no = await openOn(p, 'c-old');
    ok(nb.base && nb.notes === 0, 'no registry · the base page still opens, with no note');
    ok(no.base && no.notes === 1, 'no registry · an old version still opens on base + note — never a refusal');
    await ctx.close();

    /* ── 6 · phone ── */
    ({ ctx, p } = await profile(390, 844));
    const ph = await openOn(p, 'c-old');
    const box = ph.notes ? await p.locator('#detailpane [data-testid="page-note"]').first().boundingBox() : null;
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ph.notes === 1 && box && box.x >= 0 && box.x + box.width <= 390 + 0.5 && wide <= 0, '390 px · the note is inside the screen, no sideways scroll (' + (box ? Math.round(box.x) + '+' + Math.round(box.width) : 'none') + ', overflow ' + wide + ')');
    if (!o.noShots) await p.screenshot({ path: path.join(SHOTS, 'detail-page-old-phone.png') });
    await ctx.close();

    const real = errs.filter((e) => !/Failed to fetch|NetworkError|Load failed|aborted/i.test(e));
    ok(real.length === 0, 'no page error' + (real.length ? ': ' + real.slice(0, 3).join(' | ') : ''));
  } finally { await b.close(); web.close(); }
  return out;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    console.log('  (free memory ' + (require('os').freemem() / 1073741824).toFixed(1) + ' GB)');
    const r = await run({});
    console.log('\n  ' + r.pass + ' passed, ' + r.fail + ' failed');
    process.exit(r.fail ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
