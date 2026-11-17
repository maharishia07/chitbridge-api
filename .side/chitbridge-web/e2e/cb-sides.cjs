#!/usr/bin/env node
/* cb-sides.cjs — THE TWO SIDES, PROVED (public/app/sides.js mounted by public/app/shell.js · designs-inbox/cb-sides-2026-10-08).
 * Pattern: shell.cjs — Playwright, a stand-in API answering INSIDE the page (ctx.route), a static server on a free OS port, the shell's
 * gallery page public/shell-lab.html. Nothing here reaches localhost:3000 or the live site. The data is PLANTED: the page paints what
 * GET /api/entities/sides says (the server decides every state and number), so these checks are about WHAT IS DRAWN and HOW IT BEHAVES.
 *
 *   1  static: the prototype's `demo` switcher is not built; the unit computes no version, count or drift of its own
 *   2  1600 (wide): the same drawers as narrower widths (walk 2026-10-17): both panels shut, two toolbar buttons, one drawer open at a time
 *      the drawer scrolls on its own
 *   3  the panels: titles, arrows, row counts (rows drawn, placeholders excluded), a "not yet" row is dashed and says so, no made-up number
 *   4  a drift row ("Update") carries Review; Review shows what differs and Review again hides it
 *   5  trade proof is "3 of 4 shown" with Finish pointing at the server's href
 *   6  impact: "If you change / Your GSTIN / N businesses · filings not yet"; See who lists the businesses; See who again hides them
 *   7  1200 (narrow): no panel beside the content; two toolbar buttons "We lean on 8" · "Leans on us 6"; one drawer open at a time; Esc and ✕ close
 *   8  390 (phone): a drawer is the full width; the page does not scroll sideways (scrollWidth === 390) with a drawer shut and open
 *   9  a failed read: each panel says "Could not read" — no digits in the counts (–)
 *  10  signed out: no panels, no buttons, and /api/entities/sides is never asked
 *  11  no page error
 * Run one at a time:  sh C:/dev/toolset/e2e.sh <checkout> e2e/cb-sides.cjs                                                              */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SIDES_SHOTS || os.tmpdir();
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });

const row = (id, n, m, extra) => Object.assign({ id: id, n: n, m: m }, extra || {});
const SIDES = {
  lean: [
    { key: 'rules', rows: [
      row('jurisdiction', 'India', 'Jurisdiction', { s: 'later', t: 'not yet' }),
      row('standards', 'Standards', 'What a chit must hold', { s: 'later', t: 'not yet' }),
      row('constitution', 'Constitution', 'v0.2 · minted on v0.1', { s: 'wait', t: 'Update', fix: 'Review', detail: 'Minted on v0.1. Now v0.2.' })] },
    { key: 'mould', rows: [
      row('boilerplate', 'Hotel', 'Boilerplate · v3', { s: 'later', t: 'not yet' }),
      row('blueprint', 'Blueprint', 'Not recorded', { s: 'later', t: 'not yet' })] },
    { key: 'content', rows: [row('src:hotel', 'Hotel starter catalogue', 'Brand source · v5', { s: 'ok', t: 'Current' })] },
    { key: 'systems', rows: [row('conn:0', 'Tally', 'Connector', { s: 'ok', t: 'Linked' })] },
    { key: 'buy', rows: [row('suppliers', '3 suppliers', 'Network')] }
  ],
  use: [
    { key: 'trade', rows: [row('customers', '2 customers', '24 chits open'), row('suppliers-out', '3 suppliers', '5 orders open')] },
    { key: 'act', rows: [row('actor:0', 'Bala', 'Co-assist · no costs')] },
    { key: 'cite', rows: [row('filings', 'Filings', 'Name your GSTIN', { s: 'later', t: 'not yet' }),
      row('proof', 'Trade proof', '3 of 4 shown', { s: 'wait', t: 'GSTIN', fix: 'Finish', href: '/know-your-business.html' })] },
    { key: 'inherit', rows: [row('inherit', 'Shops using our blueprint', 'A blueprint others can use', { s: 'later', t: 'not yet' })] }
  ],
  impact: { field: 'gstin', k: 'If you change', n: 'Your GSTIN', businesses: 4, filings: null, m: '4 businesses · filings not yet',
    who: [{ name: 'Asha Stores', role: 'customer' }, { name: 'Pooja Mart', role: 'customer' }, { name: 'Fresh Farm', role: 'supplier' }, { name: 'Veg Hub', role: 'supplier' }] }
};
/* rows drawn: placeholders ('empty') excluded. lean 2+... counted from the plant itself so the spec follows the plant, not a guess */
const count = (gs) => gs.reduce((a, g) => a + g.rows.filter((r) => r.s !== 'empty').length, 0);
const NL = count(SIDES.lean), NR = count(SIDES.use);

async function run() {
  const { chromium } = require('@playwright/test');
  const { serve } = require('./lib/serve.cjs');
  const out = { pass: 0, fail: 0 };
  const ok = (c, m) => { if (c) out.pass++; else out.fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };

  /* ── 1 · static ── */
  const unit = fs.readFileSync(path.join(ROOT, 'public', 'app', 'sides.js'), 'utf8');
  const shell = fs.readFileSync(path.join(ROOT, 'public', 'app', 'shell.js'), 'utf8');
  ok(!/\bdemo\b/i.test(unit) && !/\bdemo\b/i.test(shell) && !/PROTOTYPE ONLY/.test(unit + shell), 'static · the prototype\'s demo switcher is not built');
  ok(!/driftOf|driftStatus|minted|\bversion\b/i.test(unit.replace(/\/\*[\s\S]*?\*\//g, '')), 'static · the unit decides no version or drift (the server does)');
  ok(/CBSides\.mount/.test(shell) && /has-sides/.test(shell), 'static · the shell mounts the unit (one place, not a second page)');
  ok(/app\/sides\.js/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'static · index.html loads the unit');

  const web = await serve(), b = await chromium.launch(), errs = [];
  const SESSION = JSON.stringify({ token: 'tok-sides', role: 'entity', name: 'Asha', entity: 'Books Shop' });
  async function profile(vw, vh, p) {
    p = p || {};
    const seen = [];
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => {
      const u = new URL(r.request().url()); seen.push(u.pathname);
      if (u.pathname === '/api/entities/sides') return p.fail ? J(r, 500, { error: 'x' }) : J(r, 200, SIDES);
      if (u.pathname === '/api/entities/header') return J(r, 404, { error: 'not found' });
      return J(r, 200, { ok: true });
    });
    await ctx.addInitScript(([s, signedOut]) => { try { localStorage.setItem('cb_api_base', location.origin); if (signedOut) localStorage.removeItem('cb_sess'); else localStorage.setItem('cb_sess', s); } catch (_) {} }, [SESSION, !!p.signedOut]);
    return { ctx, seen };
  }
  async function open(ctx) {
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message)));
    await pg.goto(web.url('/shell-lab.html?harness=1'));
    await pg.waitForSelector('[data-testid="cbshell"]', { timeout: 20000 });
    await pg.evaluate(() => window.SHELL.ready);
    await pg.waitForTimeout(250);
    return pg;
  }
  const vis = (pg, sel) => pg.locator(sel).first().isVisible().catch(() => false);
  const box = (pg, sel) => pg.locator(sel).first().boundingBox();
  const T = (pg, sel) => pg.locator(sel).first().innerText().then((x) => x.replace(/\s+/g, ' ').trim());
  fs.mkdirSync(SHOTS, { recursive: true });

  try {
    /* ── 2 · 3 · 4 · 5 · 6 · wide ── */
    {
      const { ctx, seen } = await profile(1600, 900), pg = await open(ctx);
      ok(seen.includes('/api/entities/sides'), '1600 · the shell asked /api/entities/sides');
      /* walk 2026-10-17 (Athi): the panels are drawers behind two icon buttons at EVERY width, closed until asked for */
      ok(!(await vis(pg, '[data-testid="sides-left"]')) && !(await vis(pg, '[data-testid="sides-right"]')), '1600 · both panels start shut (drawers at every width)');
      ok(await vis(pg, '[data-testid="sides-open-l"]') && await vis(pg, '[data-testid="sides-open-r"]'), '1600 · the two toolbar drawer buttons are shown');
      await pg.click('[data-testid="sides-open-l"]');
      const l = await box(pg, '[data-testid="sides-left"]'), m = await box(pg, '[data-testid="shell-main"]');
      ok(l && m && l.width <= 332 && l.width >= 280 && l.x < m.x + m.width, '1600 · the left drawer opens over the work area, about 330 px (' + [l && Math.round(l.x), l && Math.round(l.width)].join(' · ') + ')');
      ok(/We lean on/.test(await T(pg, '[data-testid="sides-left"] h3')), '1600 · titles are the plain words, not Upstream / Dependents');
      const arrows = await pg.evaluate(() => [document.querySelector('[data-testid="sides-left"] .cbsd-arr').textContent, document.querySelector('[data-testid="sides-right"] .cbsd-arr').textContent]);
      ok(arrows[0] === '→' && arrows[1] === '←', '1600 · blue → in, green ← out');
      ok(await T(pg, '[data-testid="sides-left"] [data-testid="sides-count"]') === String(NL), '1600 · the left count is the rows drawn: ' + NL);
      ok(await pg.locator('[data-testid="sides-left"] [data-testid="sides-row"]').count() === NL, '1600 · and the left panel draws exactly that many rows');
      /* "not yet" is an honest dashed row */
      const nyet = pg.locator('[data-testid="sides-left"] [data-testid="sides-row"][data-id="jurisdiction"]');
      ok(await nyet.getAttribute('data-s') === 'later' && /not yet/.test(await nyet.innerText()) && /dash/.test(await nyet.getAttribute('class')), '1600 · a source with no data is a dashed row that says "not yet"');
      ok(await pg.evaluate(() => getComputedStyle(document.querySelector('[data-testid="sides-left"]')).overflowY === 'auto'), '1600 · a long drawer scrolls on its own');
      /* drift → Review */
      const con = pg.locator('[data-testid="sides-left"] [data-testid="sides-row"][data-id="constitution"]');
      ok(/Update/.test(await con.locator('[data-testid="sides-state"]').innerText()), '1600 · a drift row says "Update"');
      ok(!(await vis(pg, '[data-testid="sides-left"] [data-testid="sides-detail"]')), '1600 · what differs is hidden until asked');
      await con.locator('[data-testid="sides-review"]').click();
      ok(await vis(pg, '[data-testid="sides-left"] [data-testid="sides-detail"]') && /v0\.1.*v0\.2/.test(await T(pg, '[data-testid="sides-left"] [data-testid="sides-detail"]')), '1600 · Review shows what differs (v0.1 → v0.2)');
      ok(await con.locator('[data-testid="sides-review"]').getAttribute('aria-expanded') === 'true', '1600 · Review is aria-expanded');
      await con.locator('[data-testid="sides-review"]').click();
      ok(!(await vis(pg, '[data-testid="sides-left"] [data-testid="sides-detail"]')), '1600 · Review again hides it');
      ok(await pg.locator('[data-testid="sides-left"] [data-testid="sides-review"]').count() === 1, '1600 · only the drifted row carries Review (the current ones do not)');
      /* trade proof → Finish (the right drawer; opening it closes the left) */
      await pg.click('[data-testid="sides-open-r"]');
      ok(await T(pg, '[data-testid="sides-right"] [data-testid="sides-count"]') === String(NR), '1600 · the right count is the rows drawn: ' + NR);
      ok(!/0/.test(await T(pg, '[data-testid="sides-right"] [data-testid="sides-row"][data-id="filings"]')), '1600 · filings carry no number (not a fake 0)');
      ok(/3 of 4 shown/.test(await T(pg, '[data-testid="sides-right"] [data-id="proof"]')), '1600 · trade proof reads "3 of 4 shown" (the rail\'s own Trade-ready)');
      ok(await pg.getAttribute('[data-testid="sides-finish"]', 'href') === '/know-your-business.html', '1600 · Finish goes where the server says');
      /* impact → See who */
      const im = await T(pg, '[data-testid="sides-impact"]');
      ok(/if you change/i.test(im) && /Your GSTIN/.test(im) && /4 businesses · filings not yet/.test(im), '1600 · impact: "If you change Your GSTIN · 4 businesses · filings not yet" (' + im + ')');
      ok(!(await vis(pg, '[data-testid="sides-who"]')), '1600 · See who starts shut');
      await pg.click('[data-testid="sides-who-btn"]');
      const who = await T(pg, '[data-testid="sides-who"]');
      ok(await vis(pg, '[data-testid="sides-who"]') && /Asha Stores/.test(who) && /Fresh Farm/.test(who) && await pg.locator('[data-testid="sides-who"] li').count() === 4, '1600 · See who lists the 4 businesses (' + who + ')');
      await pg.click('[data-testid="sides-who-btn"]');
      ok(!(await vis(pg, '[data-testid="sides-who"]')), '1600 · See who again hides them');
      await pg.screenshot({ path: path.join(SHOTS, 'cb-sides-wide.png') });
      await ctx.close();
    }

    /* ── 7 · narrow: drawers ── */
    {
      const { ctx } = await profile(1200, 800), pg = await open(ctx);
      ok(!(await vis(pg, '[data-testid="sides-left"]')) && !(await vis(pg, '[data-testid="sides-right"]')), '1200 · no panel beside the content');
      ok(await vis(pg, '[data-testid="sides-open-l"]') && await vis(pg, '[data-testid="sides-open-r"]'), '1200 · two toolbar buttons');
      ok(new RegExp('^→ ?We lean on ?' + NL + '$').test(await T(pg, '[data-testid="sides-open-l"]')) && new RegExp('^← ?Leans on us ?' + NR + '$').test(await T(pg, '[data-testid="sides-open-r"]')), '1200 · "→ We lean on' + NL + '" · "←Leans on us' + NR + '" (' + await T(pg, '[data-testid="sides-open-l"]') + ' | ' + await T(pg, '[data-testid="sides-open-r"]') + ')');
      await pg.click('[data-testid="sides-open-l"]');
      ok(await vis(pg, '[data-testid="sides-left"]') && !(await vis(pg, '[data-testid="sides-right"]')), '1200 · We lean on opens its drawer, the other stays shut');
      const d = await box(pg, '[data-testid="sides-left"]'), mn = await box(pg, '[data-testid="shell-main"]');
      ok(d && d.width <= 332 && d.width >= 280, '1200 · a drawer is about 330 px wide (' + (d && Math.round(d.width)) + ')');
      await pg.screenshot({ path: path.join(SHOTS, 'cb-sides-drawer.png') });
      await pg.click('[data-testid="sides-open-r"]');
      ok(await vis(pg, '[data-testid="sides-right"]') && !(await vis(pg, '[data-testid="sides-left"]')), '1200 · opening Leans on us closes We lean on (one at a time)');
      ok(await pg.getAttribute('[data-testid="sides-open-r"]', 'aria-expanded') === 'true' && await pg.getAttribute('[data-testid="sides-open-l"]', 'aria-expanded') === 'false', '1200 · aria-expanded follows the open drawer');
      await pg.click('[data-testid="sides-right"] [data-testid="sides-close"]');
      ok(!(await vis(pg, '[data-testid="sides-right"]')), '1200 · ✕ closes the drawer');
      await pg.click('[data-testid="sides-open-l"]'); await pg.keyboard.press('Escape');
      ok(!(await vis(pg, '[data-testid="sides-left"]')), '1200 · Esc closes the drawer');
      await pg.click('[data-testid="sides-open-l"]'); await pg.click('[data-testid="sides-open-l"]');
      ok(!(await vis(pg, '[data-testid="sides-left"]')), '1200 · the same button closes it');
      /* the actions work in a drawer too */
      await pg.click('[data-testid="sides-open-l"]');
      await pg.click('[data-testid="sides-left"] [data-testid="sides-review"]');
      ok(await vis(pg, '[data-testid="sides-left"] [data-testid="sides-detail"]'), '1200 · Review works inside the drawer');
      await ctx.close();
    }

    /* ── 8 · phone ── */
    {
      const { ctx } = await profile(390, 800), pg = await open(ctx);
      const sw = () => pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      ok(await sw() === 390, '390 · no sideways scroll with the drawers shut (' + await sw() + ')');
      ok(await vis(pg, '[data-testid="sides-open-l"]') && await vis(pg, '[data-testid="sides-open-r"]'), '390 · the two buttons are on the toolbar');
      await pg.click('[data-testid="sides-open-r"]');
      const d = await box(pg, '[data-testid="sides-right"]');
      ok(d && Math.abs(d.width - 390) < 2 && d.x < 2, '390 · a drawer is the full width (' + (d && Math.round(d.width)) + ')');
      ok(await sw() === 390, '390 · no sideways scroll with a drawer open (' + await sw() + ')');
      await pg.screenshot({ path: path.join(SHOTS, 'cb-sides-phone-drawer.png') });
      await pg.click('[data-testid="sides-open-l"], [data-testid="sides-right"] [data-testid="sides-close"]').catch(() => {});
      await pg.click('[data-testid="sides-open-l"]').catch(() => {});
      await ctx.close();
    }

    /* ── 9 · a failed read ── */
    {
      const { ctx } = await profile(1600, 800, { fail: true }), pg = await open(ctx);
      ok(await pg.locator('[data-testid="sides-failed"]').count() === 2, '1600 · a failed read: each panel says "Could not read"');
      ok(!/\d/.test(await T(pg, '[data-testid="sides-left"] [data-testid="sides-count"]')) && !/\d/.test(await T(pg, '[data-testid="sides-right"] [data-testid="sides-count"]')), '1600 · …and the counts show no number');
      ok(await pg.locator('[data-testid="sides-impact"]').count() === 0, '1600 · …and no impact box with a made-up figure');
      await ctx.close();
    }

    /* ── 10 · signed out ── */
    {
      const { ctx, seen } = await profile(1600, 800, { signedOut: true }), pg = await open(ctx);
      ok(await pg.locator('[data-testid="sides-left"], [data-testid="sides-right"], [data-testid="sides-open-l"]').count() === 0, 'signed out · no panels, no buttons');
      ok(!seen.includes('/api/entities/sides'), 'signed out · /api/entities/sides is never asked');
      await ctx.close();
    }
  } catch (e) { out.fail++; console.log('  XX  threw: ' + (e && e.stack || e)); }
  ok(errs.length === 0, 'no page error' + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close(); web.close();
  console.log('\n  ' + out.pass + ' passed · ' + out.fail + ' failed');
  process.exit(out.fail ? 1 : 0);
}
run();
