/**
 * e2e/lib/walk.cjs — THE SHARED SKELETON OF A WALK (the black-box paths Claude walked by hand, scripted).
 *
 * A walk is a list of PATHS. Each path is one thing a person does and the one thing they should see:
 *     await w.step('H10', 'Home -> "21 stuck" -> Chits (stuck)', async () => ({ ok: cond, saw: 'what was on the screen, in words' }));
 * It prints ONE LINE per path ("H10 · Home -> 21 stuck -> Chits (stuck) · PASS (the chip opens ...)"), shoots the screen after each step
 * (e2e/shots/walk-<name>-<n>.png), and EXITS (finally: close the browser, process.exit) - a walk that never exits holds the one-browser lock.
 *
 * ⭐ SHOW MODE (Athi, 2026-10-09: "I can only check the screens ... walking the till and running the test cases ... possibly for a customer demo"):
 *     node e2e/walk-bill.cjs --show        (or WALK_SHOW=1, which `node toolset/pack.cjs bill --show` sets)
 *   a HEADED browser at a readable pace (slowMo), a caption banner on the page for each step in plain words, green/red on screen after each
 *   step, and at the end a RESULTS PAGE (one line per path) that stays open until the window is closed. Default is headless and fast.
 *   ONE browser either way. Nothing here touches production: the site is served from this checkout and the API is a stand-in answering inside the page;
 *   a walk on a running local site (opts.base) has every request to the production host refused and FAILS naming it (FX-QA1).
 */
'use strict';
const path = require('path'), fs = require('fs'), http = require('http');
const TD = require('./today.cjs');
const SHOW = process.argv.includes('--show') || process.env.WALK_SHOW === '1';
const ROOT = path.join(__dirname, '..', '..');
const PUB = path.join(ROOT, 'public');
const SHOTS = path.join(__dirname, '..', 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/** the site as it deploys: / is the repo-root index.html, everything else public/ ; /api/** is answered by `api(req)` (or a plain 404) */
function serve(api) {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(404, { 'content-type': 'application/json' }); return r.end('{"error":"not found"}'); }
    const rel = decodeURIComponent(url).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if ((!f.startsWith(PUB) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, base: 'http://127.0.0.1:' + srv.address().port })));
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
/** the session the apps store: a token whose identity is the (fixture) shop */
function session(name, entity) {
  const token = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-walk', identity_type: 'entity', exp: Math.floor(TD.nowMs() / 1000) + 3600 }) + '.x';
  return JSON.stringify({ token, role: 'entity', name: name || 'Fixture Owner', entity: entity || 'Fixture Shop', bridgeId: 'CBWALK0001' });
}

/** the banner: fixed, top of the page, plain words. tone: null (working) | 'pass' | 'fail' */
async function banner(page, text, tone) {
  if (!SHOW) return;
  try {
    await page.evaluate(([t, tone]) => {
      let d = document.getElementById('__walkbanner');
      if (!d) { d = document.createElement('div'); d.id = '__walkbanner'; document.documentElement.appendChild(d); }
      d.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:12px 18px;font:600 18px/1.3 system-ui,sans-serif;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none;background:'
        + (tone === 'pass' ? '#157347' : tone === 'fail' ? '#b02a37' : '#1f2d3d'));
      d.textContent = t;
    }, [text, tone || null]);
  } catch (_) { /* the page is navigating - the next caption lands */ }
}

async function start(name, opts) {
  opts = opts || {};
  const { chromium } = require('@playwright/test');
  fs.mkdirSync(SHOTS, { recursive: true });
  /* opts.base (HX0): walk a site that is already running — the compose stack's web container — instead of serving this checkout; WX: e2e/lib/stack-local.cjs's site, its api on 3000 */
  const { srv, base } = opts.base ? { srv: null, base: String(opts.base).replace(/\/+$/, '') } : await serve();
  const browser = await chromium.launch(SHOW ? { headless: false, slowMo: 450, args: ['--window-size=1360,900', '--window-position=40,20'] } : {});
  /* QW1-TODAY: CB_TODAY fixes the page's clock (timers still run) in EVERY context this browser opens (contextAt, or a walk's own browser.newContext) —
     stand-in walks only; a real api cannot be moved, so there the page keeps real time */
  if (TD.injected && !opts.base) { const open = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await open(o); await c.clock.setFixedTime(TD.now()); return c; }; }
  /* ⚠️ FX-QA1: A LOCAL WALK NEVER REACHES PRODUCTION. On a running local site (opts.base) any request to the host public/config.js ships is refused
     and named — a loud FAIL at the end, whoever answered it (a later stand-in route can win the route; the request event still sees it).
     Every context the walk opens (contextAt, GOV-SPIN) carries the same guard. */
  const PROD = opts.base ? require('./stack-local.cjs').productionHost() : null, refused = [];
  /**
   * GOV-SPIN: WHERE THE BROWSER SAYS IT IS — opts.timezoneId · opts.locale · opts.geolocation (default India, as every walk had). A walk that
   * needs several (the spin matrix) opens one context per place with w.contextAt({ timezoneId, locale, geolocation }) — same browser.
   */
  const contextAt = async (at) => {
    at = at || {};
    const c = await browser.newContext(Object.assign({ viewport: opts.viewport || { width: 1280, height: 860 }, locale: at.locale || 'en-IN', timezoneId: at.timezoneId || 'Asia/Kolkata', serviceWorkers: 'block' },
      at.geolocation ? { geolocation: at.geolocation, permissions: ['geolocation'] } : {}));
    await c.route(/fonts.(googleapis|gstatic).com/, (r) => r.abort());
    if (PROD) {
      c.on('request', (q) => { let h = ''; try { h = new URL(q.url()).host; } catch (_) {} if (h === PROD) { refused.push(q.method() + ' ' + q.url()); console.log('REFUSED · a local walk asked the PRODUCTION host: ' + q.method() + ' ' + q.url()); } });
      await c.route((u) => u.host === PROD, (r) => r.abort('blockedbyclient'));
    }
    /* silence window.print: a walk must never open a print dialog (it would hold the browser for ever) */
    await c.addInitScript(() => { try { window.print = function () { window.__printed = (window.__printed || 0) + 1; }; } catch (_) {} });
    return c;
  };
  if (TD.injected) console.log('CB_TODAY ' + TD.TODAY + (opts.base ? ' — NOT applied to the page: this walk runs on a real api whose clock is not injectable yet' : ' — the page clock is fixed to ' + TD.now().toISOString()));
  const ctx = await contextAt({ timezoneId: opts.timezoneId, locale: opts.locale, geolocation: opts.geolocation });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
  const results = [];
  let n = 0;
  const w = {
    SHOW, base, browser, ctx, page, errs, results, contextAt, refused,
    /** one path: fn returns { ok, saw } (or throws - which is a FAIL that says what threw) */
    async step(id, pathText, fn) {
      n++;
      await banner(page, 'Step ' + n + ' · ' + pathText, null);
      let ok = false, saw = '';
      try { const r = await fn(); ok = !!(r && r.ok); saw = (r && r.saw) || ''; } catch (e) { ok = false; saw = 'it stopped: ' + String(e && e.message || e).split('\n')[0].slice(0, 160); }
      results.push({ id, path: pathText, ok, saw });
      await banner(page, (ok ? 'PASS' : 'FAIL') + ' · ' + pathText + (saw ? '  -  ' + saw : ''), ok ? 'pass' : 'fail');
      try { await page.screenshot({ path: path.join(SHOTS, 'walk-' + name + '-' + String(n).padStart(2, '0') + '.png') }); } catch (_) {}
      console.log(id + ' · ' + pathText + ' · ' + (ok ? 'PASS' : 'FAIL') + ' (' + saw + ')');
      if (SHOW) await page.waitForTimeout(ok ? 1400 : 2600);
    },
    /** a path that is not testable yet - printed, never silent */
    note(id, pathText, why) { results.push({ id, path: pathText, ok: true, saw: why, note: true }); console.log(id + ' · ' + pathText + ' · NOTE (' + why + ')'); },
    /** the end: print the verdict, in show mode leave a results page open, then close and exit */
    async finish() {
      if (refused.length) results.push({ id: 'LOCAL', path: 'a local walk never reaches the production host (' + PROD + ')', ok: false, saw: refused.length + ' request(s) refused: ' + refused.slice(0, 3).join(' | ') });
      const bad = results.filter((r) => !r.ok).length;
      console.log('\nwalk ' + name + ': ' + (results.length - bad) + ' of ' + results.length + ' paths passed' + (errs.length ? ' · page errors: ' + errs.slice(0, 2).join(' | ') : ''));
      if (SHOW) {
        try {
          const rows = results.map((r) => '<tr class="' + (r.note ? 'n' : r.ok ? 'p' : 'f') + '"><td>' + r.id + '</td><td>' + r.path.replace(/</g, '&lt;') + '</td><td>' + (r.note ? 'NOTE' : r.ok ? 'PASS' : 'FAIL') + '</td><td>' + String(r.saw).replace(/</g, '&lt;') + '</td></tr>').join('');
          await page.setContent('<!doctype html><meta charset="utf-8"><title>Walk results</title><style>body{font:16px system-ui,sans-serif;margin:0;background:#fff;color:#14202b}h1{margin:0;padding:18px 24px;color:#fff;background:' + (bad ? '#b02a37' : '#157347') + '}table{border-collapse:collapse;width:100%}td{padding:9px 14px;border-bottom:1px solid #d9dee3;vertical-align:top}tr.p td:nth-child(3){color:#157347;font-weight:700}tr.f td:nth-child(3){color:#b02a37;font-weight:700}tr.n td:nth-child(3){color:#7a6a00;font-weight:700}p{padding:8px 24px;color:#52606d}</style><h1>' + name + ' walk: ' + (results.length - bad) + ' of ' + results.length + ' paths passed' + '</h1><p>One line per path. Close this window when you are done.</p><table>' + rows + '</table>');
          await new Promise((res) => { browser.on('disconnected', res); setTimeout(res, Number(process.env.WALK_HOLD_MS) || 25 * 60 * 1000); });
        } catch (_) { /* the window was closed - fine */ }
      }
      return bad;
    },
    async close() { try { await browser.close(); } catch (_) {} try { if (srv) srv.close(); } catch (_) {} },
  };
  return w;
}

/** run a walk body; ALWAYS closes the browser and exits (0 = every path passed) */
async function run(name, body) {
  let w, code = 1;
  try { w = await start(name, body.opts); await body(w); code = (await w.finish()) ? 1 : 0; }
  catch (e) { console.log('walk ' + name + ' stopped: ' + (e && e.stack || e)); code = 1; }
  finally { if (w) await w.close(); process.exit(code); }
}

module.exports = { run, start, session, banner, SHOW, TODAY: TD.TODAY, now: TD.now, nowIso: TD.nowIso, nowMs: TD.nowMs, dayPlus: TD.dayPlus };
