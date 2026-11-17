'use strict';
/**
 * capability-bare-page.cjs — A CAPABILITY IS ATTACHED WHEN IT RUNS ON A BLANK PAGE WITH A TOKEN (CAP-5 · SEC-29 · SEC-30)
 *
 * Athi, 2026-09-12: *"it has to be light weight."* The SIT run of 2026-11-08 put cap-testing.js on till.html by hand: it painted and
 * loaded 0 cases, because till.html has no api / tx / esc / ensureCap. One tag now closes that: public/app/cap-attach.js.
 *
 * ⭐ NODE-LEVEL, NOT A BROWSER: the page is a stub document (innerHTML kept as a string) and the api is a stand-in behind a fetch that
 * records every request. What this proves: the panel reads its cases, a verdict posts once, credentials are the token and nothing else,
 * a 401 says the shopkeeper sentence. What it cannot prove: pixels and clicks. That half is the SIT gate (PM/junit/u9-sit-*.xml, till.html
 * and crm.html with the attach tag) and the Playwright run, neither of which every laptop has.
 *
 * ⚠️ IT MUST GO RED WITHOUT THE SHIM: the same page without cap-attach.js is run first and has to load 0 cases. A gate that cannot fail
 * proves nothing.
 *
 * Run: node e2e/capability-bare-page.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'public');
const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');
let pass = 0;
const fails = [];
const ok = (what, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + what); }
  else { fails.push(what + (extra ? ' — ' + extra : '')); console.log('  x ' + what + (extra ? ' — ' + extra : '')); }
};

/* ── the stand-in api: 3 cases for crm, records every request, can answer 401 ── */
function standIn(mode) {
  const seen = [];
  const cases = ['CRM-001', 'CRM-002', 'CRM-003'].map((k) => ({ case_key: k, module_key: 'crm', module_name: 'CRM', title: 'Case ' + k, priority: 'High', steps: [['do', 'see']], version: 1 }));
  const stored = {};
  const fetchFn = (url, init = {}) => {
    const u = String(url), method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ url: u, method, headers: init.headers || {}, body, credentials: init.credentials });
    const reply = (status, json) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(json), clone() { return this; }, headers: { get: () => null } });
    if (mode === '401') return reply(401, { error: 'unauthorised' });
    const p = u.split('?')[0];
    if (method === 'GET' && p.endsWith('/api/testing/cases')) return reply(200, { cases, total: 3, page: 1 });
    if (method === 'GET' && p.endsWith('/api/testing/results')) return reply(200, { results: Object.values(stored), count: Object.keys(stored).length, history: [] });
    if (method === 'GET' && p.endsWith('/api/testing/stale')) return reply(200, { stale: [] });
    if (method === 'GET' && p.endsWith('/api/testing/coverage')) return reply(200, { areas: [], suggest: null });
    if (method === 'POST' && p.endsWith('/api/testing/results')) {
      (body.results || []).forEach((r) => { stored[r.case_key] = r; });
      return reply(200, { ok: true, ref: body.client_ref });
    }
    return reply(200, {});
  };
  return { seen, fetchFn, stored };
}

/* ── a blank page: a stub document; script tags load files from public/ ── */
function blankPage(st) {
  const byId = {};
  const loaded = [];
  const soft = (o) => new Proxy(o, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'style' || p === 'dataset') return (t[p] = {});
      if (p === 'classList') return { add() {}, remove() {}, contains: () => false, toggle() {} };
      if (p === 'children' || p === 'childNodes') return [];
      if (p === 'parentNode' || p === 'then') return undefined;
      return () => soft(function () {});
    },
    set(t, p, v) { t[p] = v; if (p === 'id') byId[v] = t; return true; }
  });
  const el = (tag) => {
    const o = soft(function () {});
    o.tagName = String(tag).toUpperCase();
    let html = '';
    Object.defineProperty(o, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); (html.match(/id="([^"]+)"/g) || []).forEach((m) => { const id = m.slice(4, -1); if (!byId[id]) byId[id] = el('div'); }); },
      configurable: true
    });
    o.appendChild = (c) => {
      if (c && c.tagName === 'SCRIPT' && c.src) {
        const rel = c.src.split('?')[0].replace(/^\//, '');
        loaded.push(rel);
        setImmediate(() => { try { run(rel); c.onload && c.onload(); } catch (e) { c.onerror && c.onerror(e); } });
      }
      return c;
    };
    return o;
  };
  const store = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, URL, structuredClone, crypto: require('crypto').webcrypto,
    fetch: st.fetchFn,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    navigator: { userAgent: 'node-stub', language: 'en' }, location: { href: 'http://stand-in/page', hash: '', pathname: '/page', origin: 'http://stand-in' },
    innerWidth: 1366, innerHeight: 768, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  ctx.window = ctx;
  ctx.document = {
    createElement: el, head: el('head'), body: el('body'), documentElement: el('html'), getElementById: (id) => byId[id] || null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, cookie: '', readyState: 'complete', currentScript: null
  };
  ctx.document.body.appendChild = (c) => { if (c && c.id) byId[c.id] = c; return c; };
  vm.createContext(ctx);
  function run(rel, tagData) {
    ctx.document.currentScript = tagData ? { dataset: tagData } : null;
    vm.runInContext(read(rel), ctx, { filename: rel });
  }
  return { ctx, run, byId, loaded, host: () => byId.cbtesthost };
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await settle(10); }
  return false;
}
const casesOf = (pg) => (pg.ctx.CBTEST && pg.ctx.CBTEST.cases) || [];

(async () => {
  console.log('\n══ the attach shim ══');
  const shim = read('app/cap-attach.js');
  const shipped = require('zlib').gzipSync(shim).length;
  ok('cap-attach.js ships under 2.25 KB gzipped (2 KB until the own-api lend of 11 Nov) (the "light weight" rule as a number)', shipped < 2304, shipped + ' bytes gzipped, ' + Buffer.byteLength(shim) + ' on disk');

  console.log('\n══ WITHOUT the shim: the CAP-5 gap, shown ══');
  {
    const st = standIn();
    const pg = blankPage(st);
    let err = null;
    try { pg.run('app/cap-testing.js'); pg.ctx.testPanelOpen(); await settle(300); } catch (e) { err = e; }
    const reads = st.seen.filter((r) => /\/api\/testing\/cases/.test(r.url)).length;
    console.log('    (no shim: cases loaded ' + casesOf(pg).length + ', case reads ' + reads + ', first error: ' + (err ? err.message : 'none') + ')');
    ok('without cap-attach.js the panel loads 0 cases (red)', casesOf(pg).length === 0 && reads === 0);
  }

  console.log('\n══ WITH the shim: one tag, 3 cases ══');
  const st = standIn();
  const pg = blankPage(st);
  pg.run('app/cap-attach.js', { cap: 'testing', area: 'crm', token: 'T' });
  const loadedAll = await until(() => casesOf(pg).length === 3);
  ok('bare-page-cases: the panel holds 3 cases (3, not 0)', loadedAll, 'cases=' + casesOf(pg).length);
  await settle(100);
  const html = ['cbtesthost', 'cbtestpanel', 'cbtestbody'].map((i) => (pg.byId[i] && pg.byId[i].innerHTML) || '').join('');
  ok('the panel painted into #cbtesthost', html.length > 0);
  ok('the panel paints its own tally: 3 cases read, none run', html.indexOf('<b>3</b> cases') >= 0 && /3 not run/.test(html), 'html ' + html.length + ' chars');
  ok('the shim lends lsGet/lsSet with the app.html meaning (default on null, set then get)', pg.ctx.lsGet('zz_none', 'd') === 'd' && (pg.ctx.lsSet('zz_k', 'v'), true), 'lsGet ' + typeof pg.ctx.lsGet + ' lsSet ' + typeof pg.ctx.lsSet);
  ok('the attach loaded list-ctl.js and cap-testing.js', pg.loaded.indexOf('app/list-ctl.js') >= 0 && pg.loaded.indexOf('app/cap-testing.js') >= 0, pg.loaded.join(','));

  await pg.ctx.testMark('CRM-002', 'pass');
  const posts = st.seen.filter((r) => r.method === 'POST' && /\/api\/testing\/results$/.test(r.url));
  ok('bare-page-verdict: exactly 1 POST /api/testing/results', posts.length === 1, posts.length + ' posts');
  const pb = (posts[0] && posts[0].body) || {};
  const r0 = (pb.results || [])[0] || {};
  ok('the verdict is case 2 as pass, with a client_ref', r0.case_key === 'CRM-002' && r0.status === 'pass' && typeof pb.client_ref === 'string' && pb.client_ref.length > 1, JSON.stringify({ k: r0.case_key, s: r0.status, ref: pb.client_ref }));
  ok('it reads back (the stand-in stored 1 row)', Object.keys(st.stored).length === 1);

  await Promise.all([pg.ctx.testMark('CRM-002', 'pass'), pg.ctx.testMark('CRM-002', 'pass')]);
  const posts2 = st.seen.filter((r) => r.method === 'POST' && /\/api\/testing\/results$/.test(r.url));
  ok('double-tap: two taps while a send is in flight share ONE client_ref; a verdict after a settled reply gets a NEW one', posts2.length >= 3 && posts2[1].body.client_ref === posts2[2].body.client_ref && posts2[0].body.client_ref !== posts2[1].body.client_ref, posts2.map((p) => p.body.client_ref).join(' vs '));

  console.log('\n══ a host with its OWN api and EP (crm.html): doors are lent, its api stays (CAP-5 SIT 11 Nov: 0 cases) ══');
  {
    const st2 = standIn();
    const own = blankPage(st2);
    vm.runInContext("const EP = {}; var hostApiCalls = 0; function api(key, o) { hostApiCalls++; var e = EP[key]; if (!e) return Promise.reject(new Error('no door ' + key)); " +
      "var q = Object.keys((o && o.query) || {}).map(function (k) { return k + '=' + o.query[k]; }).join('&'); return fetch(e.p + (q ? '?' + q : ''), { method: e.m, headers: { Authorization: 'Bearer HOST' }, body: o && o.body ? JSON.stringify(o.body) : undefined }).then(function (r) { return r.json(); }); }; " +
      "function tx(w) { return w; } function esc(v) { return String(v); }", own.ctx);
    own.run('app/cap-attach.js', { cap: 'testing', area: 'crm' });
    const got = await until(() => casesOf(own).length === 3);
    ok('own-api host: the panel holds 3 cases through the HOST api (3, not 0)', got, 'cases=' + casesOf(own).length);
    ok('own-api host: the host api answered (the shim did not replace it)', vm.runInContext('hostApiCalls', own.ctx) > 0);
    await own.ctx.testMark('CRM-002', 'pass');
    ok('own-api host: a verdict posts through the host api and reads back', Object.keys(st2.stored).length === 1, Object.keys(st2.stored).length + ' rows');
  }

  console.log('\n══ credentials only (SEC-29) ══');
  ok('every request carries Authorization: Bearer T', st.seen.length > 0 && st.seen.every((r) => r.headers.Authorization === 'Bearer T'), st.seen.length + ' requests');
  ok('credentials: omit on every request, so no same-origin cookie rides along', st.seen.length > 0 && st.seen.every((r) => r.credentials === 'omit'), st.seen.filter((r) => r.credentials !== 'omit').length + ' requests without it');
  ok('no request carries a Cookie header', st.seen.every((r) => !Object.keys(r.headers).some((h) => /^cookie$/i.test(h))));
  ok('no request body names entity_id or actor (addressing is explicit, defaults are the server\'s)', st.seen.filter((r) => r.body && /"(entity_id|actor|actor_id)"/.test(JSON.stringify(r.body))).length === 0);
  ok('the page had no SESSION and nothing threw', typeof pg.ctx.SESSION === 'undefined');

  console.log('\n══ 401 ══');
  {
    const s401 = standIn('401');
    const p401 = blankPage(s401);
    p401.run('app/cap-attach.js', { cap: 'testing', area: 'crm', token: 'BAD' });
    const said = () => /Sign in again/.test((p401.ctx.CBTEST && p401.ctx.CBTEST.notice && p401.ctx.CBTEST.notice.text) || '');
    await until(said, 1500);
    ok('negative-401: the panel says "Sign in again to record results"', said(), JSON.stringify(p401.ctx.CBTEST && p401.ctx.CBTEST.notice));
    ok('negative-401: nothing is posted', s401.seen.filter((r) => r.method === 'POST').length === 0);
  }

  console.log('\n══ no token ══');
  {
    const noToken = standIn();
    const pageNone = blankPage(noToken);
    pageNone.run('app/cap-attach.js', { cap: 'testing', area: 'crm' });
    const saidNone = () => /Sign in again to record results/.test((pageNone.ctx.CBTEST && pageNone.ctx.CBTEST.notice && pageNone.ctx.CBTEST.notice.text) || '');
    await until(saidNone, 1500);
    ok('no-token: no request leaves the page (never "Bearer undefined")', noToken.seen.length === 0, noToken.seen.map((r) => r.headers.Authorization).join(','));
    ok('no-token: the panel says "Sign in again to record results"', saidNone(), JSON.stringify(pageNone.ctx.CBTEST && pageNone.ctx.CBTEST.notice));
  }

  console.log('\n══ the shim\'s doors repeat app.html (no drift) ══');
  {
    const app = read('app.html');
    const table = (shim.match(/\('(testCases[\s\S]*?)'\)\s*\.split/) || [])[1] || '';
    const rows = table.replace(/'\s*\+\s*'/g, '').split(',').map((r) => r.split(' '));
    ok('the shim lists its doors', rows.length >= 18, rows.length + ' rows');
    rows.forEach(([name, m, p]) => {
      const ep = app.match(new RegExp('^\\s*' + name + ": \\{ m: '([A-Z]+)', p: '([^']+)'", 'm'));
      ok('door ' + name + ' = ' + m + ' /api/testing/' + p, !!ep && ep[1] === m && ep[2] === '/api/testing/' + p, ep ? ep[1] + ' ' + ep[2] : 'no EP row');
    });
  }

  console.log('\n══ guard-session-read: a capability reads SESSION only where it already did ══');
  {
    const dir = path.join(PUB, 'app');
    const FROZEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'capability-session-reads.json'), 'utf8'));
    const now = {};
    fs.readdirSync(dir).filter((f) => /^cap-.*\.js$/.test(f)).forEach((f) => {
      const n = (fs.readFileSync(path.join(dir, f), 'utf8').match(/\bSESSION\b/g) || []).length;
      if (n) now[f] = n;
    });
    const over = Object.keys(now).filter((f) => now[f] > (FROZEN[f] || 0));
    ok('no capability file reads SESSION more than its frozen count (' + Object.keys(now).length + ' files)', over.length === 0, over.map((f) => f + ' ' + now[f] + ' > ' + (FROZEN[f] || 0)).join(', ') + ' — a new read needs a reason in the PR');
    ok('cap-attach.js reads SESSION 0 times', !/\bSESSION\b/.test(shim));
  }

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { fails.forEach((f) => console.error('  FAIL ' + f)); process.exit(1); }
  process.exit(0); /* the panel arms timers of its own; a gate must end */
})().catch((e) => { console.error(e); process.exit(1); });
