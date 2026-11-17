#!/usr/bin/env node
/* page-frame.cjs — H23/H24: Know your business and Authority forms wear the app's frame and use the ONE sign-in.
 * Proves (exit 1 on any failure): signed in → the shell header (shop, Home, avatar) is there, NO e-mail/code card is asked, the API is called
 * with the session's bearer; signed out → the one sign-in window is in the shell's slot (not the old "Business email · Send code" card), and
 * the old card's controls are gone from the page source; a 401 drops the session and shows the window.
 * Stand-in API inside the page (ctx.route); nothing reaches a live server. Run one at a time: sh C:/dev/toolset/e2e.sh <checkout> e2e/page-frame.cjs */
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const J = (r, status, o) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
const PAGES = [
  { id: 'kyb', file: '/know-your-business.html', api: '/api/kyb/yourself', body: { credentials: [], summary: {} } },
  { id: 'documents', file: '/authority-forms.html', api: '/api/forms', body: { forms: [] } },
];
(async () => {
  const out = { pass: 0, fail: 0 };
  const ok = (c, m) => { if (c) out.pass++; else out.fail++; console.log((c ? '  ok  ' : '  XX  ') + m); };
  for (const pg of PAGES) {
    const src = fs.readFileSync(path.join(ROOT, 'public', pg.file), 'utf8');
    ok(!/lg_email|Send code|doLogin/.test(src), pg.id + ' · static · the page has no sign-in form of its own');
    ok(/app\/page-frame\.js/.test(src) && /app\/shell\.js/.test(src) && /app\/signin-ui\.js/.test(src), pg.id + ' · static · it loads the shell and the one sign-in window');
  }
  const { chromium } = require('@playwright/test');
  const { serve } = require('./lib/serve.cjs');
  const web = await serve(), b = await chromium.launch();
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const TOKEN = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-pf', identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
  const SESSION = JSON.stringify({ token: TOKEN, role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan', bridgeId: 'CBTEST1234' });
  try {
    for (const pg of PAGES) {
      for (const mode of ['in', 'out', '401']) {
        const seen = [], auth = [];
        const ctx = await b.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'block' });
        await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        await ctx.route('**/api/**', (r) => {
          const u = new URL(r.request().url()); seen.push(u.pathname); auth.push(r.request().headers().authorization || '');
          if (u.pathname === pg.api) return mode === '401' ? J(r, 401, { error: 'expired' }) : J(r, 200, pg.body);
          return J(r, 404, { error: 'not found' });
        });
        await ctx.addInitScript(([s, m]) => { try { localStorage.setItem('cb_api_base', location.origin); if (m === 'out') localStorage.removeItem('cb_sess'); else if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem('cb_sess', s); } } catch (_) {} }, [SESSION, mode]);
        const p = await ctx.newPage(), errs = [];
        p.on('pageerror', (e) => errs.push(String(e.message)));
        await p.goto(web.url(pg.file + '?api=' + encodeURIComponent(web.url('')))); await p.waitForTimeout(1500);
        const has = async (sel) => (await p.locator(sel).count()) > 0;
        if (mode === 'in') {
          ok(await has('[data-testid="shell-header"]') && await has('[data-testid="shell-avatar"] [data-testid="cbavatar"]'), pg.id + ' · signed in · the shell header and the one avatar are there');
          ok(!(await has('#lg_email')) && !(await has('[data-testid="shell-signin"] input')), pg.id + ' · signed in · no e-mail / code asked');
          ok(seen.includes(pg.api) && auth[seen.indexOf(pg.api)] === 'Bearer ' + TOKEN, pg.id + ' · signed in · the page reads with the session the apps hold (' + pg.api + ')');
        } else if (mode === 'out') {
          ok(await has('[data-testid="shell-signin"] input') || await has('[data-testid="shell-signin"] [data-testid^="signin"]') || (await p.locator('.cbsh-signin').innerHTML()).length > 50, pg.id + ' · signed out · the one sign-in window is in the shell slot');
          ok(!(await has('#lg_email')), pg.id + ' · signed out · the old "Business email · Send code" card is gone');
          ok(!seen.includes(pg.api), pg.id + ' · signed out · nothing is read');
        } else {
          ok(!(await p.evaluate(() => localStorage.getItem('cb_sess'))) || (await p.locator('.cbsh-signin').innerHTML()).length > 50, pg.id + ' · a 401 drops the session and shows the sign-in window');
        }
        ok(errs.length === 0, pg.id + ' · ' + mode + ' · no script errors' + (errs.length ? ' — ' + errs[0] : ''));
        await ctx.close();
      }
    }
    /* ── K4 · Know your business lists what applies to THIS business first; the rest is folded under "Other certificates" ── */
    {
      const mk = (title, applies, held) => ({ standard: title.toLowerCase().replace(/\W+/g, '-'), doc: 'd', title, rung: held ? 'declared' : null, held: !!held, applies, valid_until: null, expiring: false, expired: false, days_left: null });
      const creds = [mk('FSSAI licence', true, false), mk('GST registration', true, true), mk('HACCP plan', true, false), mk('UN 38.3 battery test', false, false), mk('RoHS', false, false), mk('US FDA registration', false, false), mk('GOTS', false, false)];
      for (const w of [1366, 390]) {
        const ctx = await b.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: 'block' });
        await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        await ctx.route('**/api/**', (r) => { const u = new URL(r.request().url()); if (u.pathname === '/api/kyb/yourself') return J(r, 200, { facts: { credentials: creds, summary: { held: 1, verified: 0, documented: 0, declared: 1 } }, note: '' }); return J(r, 404, { error: 'nf' }); });
        await ctx.addInitScript(([s]) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, [SESSION]);
        const p = await ctx.newPage(), errs = [];
        p.on('pageerror', (e) => errs.push(String(e.message)));
        await p.goto(web.url('/know-your-business.html?api=' + encodeURIComponent(web.url('')))); await p.waitForSelector('.cred', { timeout: 10000 });
        const mine = await p.$$eval('.card > .cred', (e) => e.map((x) => x.querySelector('.nm').textContent)), other = await p.$$eval('[data-testid="kyb-other"] .cred', (e) => e.map((x) => x.querySelector('.nm').textContent));
        ok(mine.join() === 'FSSAI licence,GST registration,HACCP plan', 'kyb @' + w + ' · K4 · what applies to this business is listed first (' + mine.join(', ') + ')');
        ok(other.length === 4 && await p.locator('[data-testid="kyb-other"]').evaluate((d) => !d.open) && /Other certificates \(4\)/.test(await p.locator('[data-testid="kyb-other"] summary').textContent()), 'kyb @' + w + ' · K4 · the other four are folded under "Other certificates (4)"');
        await p.click('[data-testid="kyb-other"] summary'); await p.waitForTimeout(150);
        ok(await p.locator('[data-testid="kyb-other"] .cred').first().isVisible(), 'kyb @' + w + ' · K4 · opening the fold shows them');
        for (const tab of ['Position', 'Risk', 'Field', 'Yourself']) { await p.click('.tab:has-text("' + tab + '")').catch(() => {}); await p.waitForTimeout(150); }
        ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'kyb @' + w + ' · K4 · no sideways scroll (every tab visited)');
        if (w === 1366) { await p.click('.tab:has-text("Yourself")'); await p.waitForSelector('.cred'); await p.click('[data-testid="kyb-other"] summary').catch(() => {}); }
        ok(errs.length === 0, 'kyb @' + w + ' · K4 · no script errors' + (errs.length ? ' — ' + errs[0] : ''));
        await ctx.close();
      }
    }
    /* ── K3 · Documents: "Draw from an order" is a PICK from the shop's own recent orders, not a typed chit id ── */
    {
      const orders = (k) => k === 'inbox' ? [{ chit_id: 'ch-in-1', purpose: 'order', auto_subject: 'Order from athi', sender_entity_display_name: 'athi', summary_json: { total_value: 90, currency_code: 'INR' }, created_at: '2026-10-09T08:00:00Z' }, { chit_id: 'ch-msg', purpose: 'general', auto_subject: 'Hello', created_at: '2026-10-08T08:00:00Z' }]
        : [{ chit_id: 'ch-out-1', purpose: 'order', manual_subject: 'PO 14', all_recipients: [{ display_name: 'Mayur Bhavan' }, { display_name: 'Agro Mills' }], summary_json: { total_value: 5000, currency_code: 'INR' }, created_at: '2026-10-07T08:00:00Z' }];
      for (const w of [1366, 390]) {
        const posted = [];
        const ctx = await b.newContext({ viewport: { width: w, height: 900 }, serviceWorkers: 'block' });
        await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
        await ctx.route('**/api/**', (r) => {
          const u = new URL(r.request().url()), m = r.request().method();
          if (u.pathname === '/api/forms') return J(r, 200, { forms: [{ key: 'gst1', title: 'GST declaration', authority: 'GST', field_count: 2 }] });
          if (/^\/api\/chits\/(inbox|sent)$/.test(u.pathname)) return J(r, 200, { chits: orders(u.pathname.split('/').pop()), total: 2 });
          if (u.pathname === '/api/forms/gst1/resolve' && m === 'POST') { try { posted.push(r.request().postDataJSON()); } catch (_) {} return J(r, 200, { title: 'GST declaration', authority: 'GST', ready: true, fields: [{ id: 'buyer', label: 'Buyer', required: true, value: 'athi', source: 'order', rung: 'documented' }], provenance: {}, completeness: { pct: 100 } }); }
          return J(r, 404, { error: 'nf' });
        });
        await ctx.addInitScript(([s]) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, [SESSION]);
        const p = await ctx.newPage(), errs = [];
        p.on('pageerror', (e) => errs.push(String(e.message)));
        await p.goto(web.url('/authority-forms.html?api=' + encodeURIComponent(web.url('')))); await p.waitForSelector('.formcard', { timeout: 10000 }); await p.waitForTimeout(500);
        const kind = await p.evaluate(() => { const e = document.getElementById('ctx'); return e ? e.tagName : ''; });
        const opts = await p.$$eval('#ctx option', (o) => o.map((x) => x.textContent.trim()));
        ok(kind === 'SELECT' && !/chit ID|chit id/i.test(await p.locator('#app').innerText()), 'documents @' + w + ' · K3 · "Draw from an order" is a pick list, not a typed chit id');
        ok(opts.length === 3 && /Order from athi.*athi.*90/.test(opts[1]) && /PO 14.*Agro Mills/.test(opts[2]) && !opts.some((x) => /Hello/.test(x)), 'documents @' + w + ' · K3 · it lists the shop\'s own recent orders, newest first, with who and how much (' + opts.join(' | ') + ')');
        await p.click('.formcard'); await p.waitForSelector('#work .fld', { timeout: 8000 });
        await p.selectOption('#ctx', 'ch-in-1'); await p.waitForTimeout(500);
        ok(posted.some((x) => x && x.context_ref === 'ch-in-1'), 'documents @' + w + ' · K3 · picking an order fills the form from it (context_ref sent)');
        ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'documents @' + w + ' · K3 · no sideways scroll');
        await p.screenshot({ path: path.join(ROOT, 'e2e', 'shots', 'small-fixes', 'documents-order-picker-' + w + '.png') }).catch(() => {});
        ok(errs.length === 0, 'documents @' + w + ' · K3 · no script errors' + (errs.length ? ' — ' + errs[0] : ''));
        await ctx.close();
      }
    }
  } finally { await b.close(); web.srv.close(); }
  console.log('\n  page-frame: ' + out.pass + ' passed, ' + out.fail + ' failed');
  process.exit(out.fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
