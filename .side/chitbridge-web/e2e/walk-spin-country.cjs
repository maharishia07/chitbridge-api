#!/usr/bin/env node
/**
 * e2e/walk-spin-country.cjs — A REGIONAL SPIN STATES ITS COUNTRY; THE REGISTRANT ACCEPTS IT (GOV-SPIN, 2026-10-14). TESTABLE FROM ONE PC.
 * Athi: "if we select based on browser details, how are we going to test the australia or UAE from here?" — both sides are set here:
 *   the INSTALLATION side  INSTALLATION_KEY=au-test | ae-test | in-test | platform-0 (none stated) — the api's env (e2e/lib/real-stack.cjs passes
 *                          it through; scripts/seed-local-installations.sql in the api makes the three rows on a local database)
 *   the BROWSER side       Playwright timezoneId + locale + geolocation per context (w.contextAt, e2e/lib/walk.cjs)
 * The matrix: installation {au, ae, in, none} × browser {Sydney, Dubai, Kolkata} → CB Settings › New shop → the code step's panel line
 * ("This ChitBridge runs in Australia" / the browser's own source), the browser's differing guess ("Your browser says India"), the country the
 * one reg-agree ticks, and what verify carries — then (--real) the STORED country + its source (identities.country · signup_context.country_source).
 * Plus: another allowed country is "chosen"; a locked envelope says why (stand-in); rule 13 on the Emirati panel (Arabic, RTL-isolated).
 *   default   the API is a stand-in inside the page; its constitutions answer is the API's OWN country-setup.countries() (../chitbridge-api) —
 *             the panel is checked against the server's pack rows, never a copy
 *   --real    four local apis in turn (one per INSTALLATION_KEY) on CB_REAL_DB (seeded), DEV_OTP — real shops minted, stored values read back
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-spin-country.cjs [--real] [--show]
 * Screenshots: e2e/out/walk-spin-country-<case>.png (e2e/out is never committed).
 */
'use strict';
const TD = require('./lib/today.cjs');
const path = require('path'), fs = require('fs');
const W = require('./lib/walk.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const REAL = process.argv.includes('--real');
const API_DIR = process.env.CB_API_DIR || path.join(__dirname, '..', '..', 'chitbridge-api');
const CS = require(path.join(API_DIR, 'lib', 'country-setup.js'));   /* the server's own pack rows and names — the stand-in paints nothing of its own */
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const INST = {   /* the rows scripts/seed-local-installations.sql writes (api) — none = platform-0, which states no country */
  au: { key: 'au-test', country: 'AU', timezone: 'Australia/Sydney' },
  ae: { key: 'ae-test', country: 'AE', timezone: 'Asia/Dubai' },
  in: { key: 'in-test', country: 'IN', timezone: 'Asia/Kolkata' },
  none: { key: 'platform-0', country: null, timezone: 'Asia/Kolkata' },
};
const BROWSER = {
  Sydney:  { timezoneId: 'Australia/Sydney', locale: 'en-AU', geolocation: { latitude: -33.8688, longitude: 151.2093 }, country: 'AU' },
  Dubai:   { timezoneId: 'Asia/Dubai',       locale: 'en-AE', geolocation: { latitude: 25.2048, longitude: 55.2708 },   country: 'AE' },
  Kolkata: { timezoneId: 'Asia/Kolkata',     locale: 'en-IN', geolocation: { latitude: 22.5726, longitude: 88.3639 },   country: 'IN' },
  Berlin:  { timezoneId: 'Europe/Berlin',    locale: 'de-DE', country: null },   /* a zone and a tag naming no served country — the "asks" case */
};
const name = (c) => CS.nameOf(c);
/** what the server answers GET /entities/constitutions?tz= with, for a stand-in installation (country-setup.atSignup's shape; STD2: each country row
    carries the server's `offer` — country-setup.offered, the SAME function the route calls — so the stand-in never computes a second answer) */
const spinAnswer = (inst, allowed, tz) => {
  const at = { installation: { country: inst.country }, timezone: inst.timezone, countries: CS.countries().filter((c) => !allowed || allowed.indexOf(c.code) >= 0) };
  return {
    constitutions: [{ key: 'base', label: 'Base', is_default: true, capabilities: [] }],
    installation: { key: inst.key, country: inst.country, name: inst.country ? name(inst.country) : null, timezone: inst.timezone },
    allowed_countries: allowed || null,
    countries: CS.offered(at, tz),
  };
};

async function readStored(email) {
  const { Pool } = require(path.join(API_DIR, 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: process.env.CB_REAL_DB || 'postgres://postgres:pw@127.0.0.1:5432/cb_sim', max: 1 });
  try {
    const r = await pool.query(`SELECT i.country, i.currency_code, i.timezone, (SELECT s.country_source FROM signup_context s WHERE s.identity_id = i.identity_id ORDER BY s.created_at DESC LIMIT 1) AS source,
                                       (SELECT g.installation_key FROM entity_governance g WHERE g.entity_id = i.identity_id) AS stamped
                                  FROM identities i WHERE lower(i.email) = lower($1) LIMIT 1`, [email]);
    return r.rows[0] || null;
  } finally { await pool.end(); }
}

const walk = async (w) => {
  const stacks = {};
  const stackFor = async (k) => {
    if (!REAL) return null;
    if (stacks[k]) return stacks[k];
    for (const o of Object.keys(stacks)) { stacks[o].stop(); delete stacks[o]; }   /* one api at a time — each is its own installation */
    process.env.INSTALLATION_KEY = INST[k].key;
    stacks[k] = await require('./lib/real-stack.cjs').up({ webBase: w.base });
    return stacks[k];
  };
  /** one registrant: a browser at `br`, on installation `k` → the code step painted; returns { page, ctx, calls, email } */
  const openAt = async (k, br, allowed) => {
    const ctx = await w.contextAt(BROWSER[br]);
    const calls = [], stack = await stackFor(k);
    if (stack) {
      ctx.on('request', (q) => { if (q.url().startsWith(stack.api) && q.method() === 'POST') calls.push(new URL(q.url()).pathname + ' ' + (q.postData() || '')); });
    } else {
      await ctx.route('**/api/**', async (r) => {
        const q = r.request(), p = new URL(q.url()).pathname;
        if (q.method() === 'POST') calls.push(p + ' ' + (q.postData() || ''));
        if (p === '/api/entities/register') return J(r, 200, { email: JSON.parse(q.postData() || '{}').email });
        if (p === '/api/entities/constitutions') return J(r, 200, spinAnswer(INST[k] || k, allowed, new URL(q.url()).searchParams.get('tz')));
        if (p === '/api/entities/verify') {
          const token = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-new', identity_type: 'entity', display_name: 'spin', exp: Math.floor(TD.nowMs() / 1000) + 3600 }) + '.x';
          return J(r, 200, { token, entity: { identity_id: 'ent-new', identity_type: 'entity', display_name: 'spin', bridge_id: 'CBNEW0001' } });
        }
        if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'spin', ui_prefs: {} } });
        return J(r, 200, {});
      });
    }
    await ctx.addInitScript((a) => { try { localStorage.removeItem('cb_sess'); if (a) localStorage.setItem('cb_api_base', a); } catch (_) {} }, stack ? stack.api : w.base);
    const page = await ctx.newPage();
    const handle = ('sp' + (typeof k === 'string' ? k : 'x') + br.slice(0, 3) + Date.now().toString(36)).toLowerCase().replace(/[^a-z0-9]/g, '');   /* clock-ok: a unique handle */
    const email = handle + '@test.example';
    await page.goto(w.base + '/settings.html#/new');
    await page.waitForSelector('[data-testid="reg-name"]', { timeout: 20000 });
    await page.fill('[data-testid="reg-name"]', handle); await page.fill('[data-testid="reg-email"]', email);
    await page.click('[data-testid="reg-submit"]');
    await page.waitForSelector('[data-testid="reg-gov-country"]', { timeout: 20000 });
    return { page, ctx, calls, email };
  };
  const txt = (page, sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  /** tick the ONE reg-agree, the code, Verify → Home; returns the verify body sent */
  const accept = async (o) => {
    await o.page.check('[data-testid="reg-agree"]');
    await o.page.fill('[data-testid="reg-otp"]', '123456'); await o.page.click('[data-testid="reg-submit"]');
    await o.page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 20000 });
    const v = o.calls.filter((c) => /\/api\/entities\/verify/.test(c)).pop() || '';
    try { return JSON.parse(v.slice(v.indexOf(' ') + 1)); } catch (_) { return {}; }
  };

  for (const k of ['au', 'ae', 'in', 'none']) {
    for (const br of ['Sydney', 'Dubai', 'Kolkata']) {
      const inst = INST[k].country, b = BROWSER[br].country, want = inst || b;
      const expLine = inst ? 'This ChitBridge runs in ' + name(inst) : 'your time zone';
      const id = 'M-' + k + '-' + br;
      await w.step(id, 'installation ' + (inst || 'none') + ' × browser ' + br + ' -> the panel says "' + expLine + '"' + (inst && b !== inst ? ', "Your browser says ' + name(b) + '"' : '')
        + ' -> tick -> ' + want + ' (' + (inst ? 'installation' : 'browser') + ')' + (REAL ? ', stored' : ''), async () => {
        const o = await openAt(k, br);
        try {
          const row = await txt(o.page, '[data-testid="reg-gov-country"]'), brLine = await o.page.locator('[data-testid="reg-gov-browser"]').count();
          const brText = await txt(o.page, '[data-testid="reg-gov-browser"]'), money = await txt(o.page, '[data-testid="reg-gov-currency"]');
          const pk = CS.countries().find((c) => c.code === want);
          await o.page.screenshot({ path: path.join(OUT, 'walk-spin-country-' + id + '.png'), fullPage: true });
          const sent = await accept(o), ctxSent = sent.context || {};
          const stored = REAL ? await readStored(o.email) : null;
          const okPanel = row.indexOf(name(want)) >= 0 && row.indexOf(expLine) >= 0 && (inst && b !== inst ? brLine === 1 && brText === 'Your browser says ' + name(b) : brLine === 0)
            && money.indexOf(pk.currency) >= 0;
          const okSent = ctxSent.country === want && ctxSent.country_source === (inst ? 'installation' : 'browser') && ctxSent.currency_code === pk.currency;
          const okStored = !REAL || (stored && stored.country === want && stored.source === (inst ? 'installation' : 'browser') && stored.currency_code === pk.currency && stored.stamped === INST[k].key);
          return { ok: okPanel && okSent && okStored, saw: '"' + row + '"' + (brLine ? ' · "' + brText + '"' : '') + ' · ' + money + ' · sent ' + ctxSent.country + '/' + ctxSent.country_source
            + (REAL ? ' · stored ' + JSON.stringify(stored) : '') };
        } finally { await o.ctx.close(); }
      });
    }
  }

  await w.step('C1', 'an Australian spin, a Kolkata browser -> "Another country" -> United Arab Emirates -> the agree is UNticked by the change -> tick -> AE (chosen), AED', async () => {
    const o = await openAt('au', 'Kolkata');
    try {
      await o.page.check('[data-testid="reg-agree"]');
      await o.page.selectOption('[data-testid="reg-country"]', 'AE');
      const unticked = !(await o.page.isChecked('[data-testid="reg-agree"]')), greyed = await o.page.locator('[data-testid="reg-submit"]').isDisabled();
      const row = await txt(o.page, '[data-testid="reg-gov-country"]'), tax = await txt(o.page, '[data-testid="reg-gov-tax"]');
      await o.page.screenshot({ path: path.join(OUT, 'walk-spin-country-C1.png'), fullPage: true });
      const sent = (await accept(o)).context || {}, stored = REAL ? await readStored(o.email) : null;
      const okStored = !REAL || (stored && stored.country === 'AE' && stored.source === 'chosen' && stored.currency_code === 'AED' && stored.timezone === 'Asia/Dubai');
      return { ok: unticked && greyed && /you chose it/.test(row) && /VAT · TRN/.test(tax) && sent.country === 'AE' && sent.country_source === 'chosen' && okStored,
        saw: 'unticked ' + unticked + ' · Verify greyed ' + greyed + ' · "' + row + '" · "' + tax + '" · sent ' + sent.country + '/' + sent.country_source + (REAL ? ' · stored ' + JSON.stringify(stored) : '') };
    } finally { await o.ctx.close(); }
  });

  if (!REAL) {
    await w.step('L1', 'a LOCKED envelope (the constitution allows AE only), a Kolkata browser -> no "Another country"; the panel says why', async () => {
      const o = await openAt({ key: 'ae-lock', country: 'AE', timezone: 'Asia/Dubai' }, 'Kolkata', ['AE']);
      try {
        const sel = await o.page.locator('[data-testid="reg-country"]').count(), why = await txt(o.page, '[data-testid="reg-gov-why"]');
        return { ok: sel === 0 && why === 'This ChitBridge serves United Arab Emirates only.', saw: 'select ' + sel + ' · "' + why + '"' };
      } finally { await o.ctx.close(); }
    });
    await w.step('N1', 'no installation country, a browser naming no served country (Europe/Berlin · de-DE) -> Country "not known"; verify sends no country_source', async () => {
      const o = await openAt('none', 'Berlin');
      try {
        const row = await txt(o.page, '[data-testid="reg-gov-country"]');
        const sent = (await accept(o)).context || {};
        return { ok: /not known/.test(row) && !sent.country_source, saw: '"' + row + '" · sent ' + JSON.stringify({ country: sent.country, source: sent.country_source }) };
      } finally { await o.ctx.close(); }
    });
  }

  /* rule 13 on the richest panel: the Emirati spin from a Kolkata browser (the browser line · "Another country" · Arabic in its own script) */
  const o = await openAt('ae', 'Kolkata');
  await w.step('A1', 'the Emirati panel names Arabic in its own script, isolated (bdi lang=ar dir=auto — the browser\'s bidi runs it right-to-left) so the row never flips', async () => {
    const bdi = await o.page.locator('[data-testid="reg-gov-language"] bdi[lang="ar"][dir="auto"]').count(), lang = await txt(o.page, '[data-testid="reg-gov-language"]');
    return { ok: bdi === 1 && /Arabic/.test(lang) && /العربية/.test(lang), saw: '"' + lang + '" · rtl-isolated ' + bdi };
  });
  await w.step('Z1', 'the Time zone row paints the SERVER\'s offer (countries[].offer, STD2): an Emirati spin offers Asia/Dubai from the pack, never the Kolkata device', async () => {
    const row = await txt(o.page, '[data-testid="reg-gov-timezone"]');
    return { ok: /Asia\/Dubai/.test(row) && /pack/.test(row) && !/Kolkata/.test(row), saw: '"' + row + '"' };
  });
  await rule13(w, 'R13', 'the Emirati spin\'s code step (a Kolkata browser)', 'set', o.page);
  await o.page.screenshot({ path: path.join(OUT, 'walk-spin-country-R13.png'), fullPage: true });
  await o.ctx.close();
  for (const s of Object.keys(stacks)) stacks[s].stop();
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('spin-country', walk);
