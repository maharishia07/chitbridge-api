/**
 * register-spin-country.test.cjs — GOV-SPIN (Athi, 14 Oct): a regional spin STATES its country at the installation layer; the registrant accepts it.
 *
 * Proves, offline (stand-in db, the same stance as tests/register-country-guess.test.cjs):
 *   · govresolve reads installation.country (b382) — `installation.country` and `basics.country`, null for platform-0 (none stated), and null
 *     when the constitution's `allowed.countries` does not hold it (tighten-only, never swapped for another)
 *   · registerNew on an Australian spin (INSTALLATION_KEY=au-test) with an INDIAN browser stores the OFFER: AU · AUD · a zone of AU's (never
 *     Asia/Kolkata), labelled "this ChitBridge runs in Australia"
 *   · no installation country + no guess → country NULL, nothing labelled (Country setup asks)
 *   · acceptAtSignup (verify): the source is the server's call (installation · browser · chosen); another allowed country MOVES the stored one
 *     with its pack's money; outside the envelope → nothing; a shop that holds anything → nothing (a sign-in never re-countries a trading shop)
 * Run: node tests/register-spin-country.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const INSTALLATIONS = {
  'platform-0': { installation_key: 'platform-0', label: 'Main', region: 'IN', currency: 'INR', timezone: 'Asia/Kolkata', languages: ['en'], vertical_key: 'base', country: null },
  'au-test':    { installation_key: 'au-test', label: 'Australia (test spin)', region: 'AU', currency: 'AUD', timezone: 'Australia/Sydney', languages: ['en-AU'], vertical_key: 'base', country: 'AU' },
  'ae-lock':    { installation_key: 'ae-lock', label: 'UAE locked', region: 'AE', currency: 'AED', timezone: 'Asia/Dubai', languages: ['ar-AE'], vertical_key: 'ae-only', country: 'AE' },
  'xx-out':     { installation_key: 'xx-out', label: 'outside', region: 'AU', currency: 'AUD', timezone: 'Australia/Sydney', languages: [], vertical_key: 'ae-only', country: 'AU' },
};
const CONSTITUTIONS = {
  base: { constitution_key: 'base', version: 'v1', capabilities: [], governance: {} },
  'ae-only': { constitution_key: 'ae-only', version: 'v1', capabilities: [], governance: { allowed: { countries: ['AE'] } } },
};
let SQL = [];
let ID = { country: 'AU', timezone: 'Australia/Sydney' }, SETUP_DONE = null, HOLDS = false;
const h = { query: async (sql, params) => {
  const t = String(sql); SQL.push({ sql: t, params, scoped: true });
  if (/SELECT country, timezone FROM identities/.test(t)) return { rows: [ID] };
  if (/SELECT country_setup_at FROM entity_governance/.test(t)) return { rows: [{ country_setup_at: SETUP_DONE }] };
  if (/country-setup constituted/.test(t)) return { rows: [{ products: HOLDS, chits: false, entries: false }] };
  return { rows: [], rowCount: 1 };
} };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    const t = String(sql); SQL.push({ sql: t, params });
    if (/information_schema/.test(t)) return { rows: [{ ok: true, '?column?': 1 }], rowCount: 1 };
    if (/FROM installation\b/.test(t)) return { rows: INSTALLATIONS[params[0]] ? [INSTALLATIONS[params[0]]] : [] };
    if (/FROM constitution\b/.test(t)) return { rows: CONSTITUTIONS[params[0]] ? [CONSTITUTIONS[params[0]]] : [] };
    return { rows: [], rowCount: 0 };
  },
  withEntity: async (e, fn) => fn(h), withTransaction: async (fn) => fn(h), onEntity: async (e, fn) => fn(h), readBatch: async () => [],
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const signin = require(path.join(API, 'routes', 'signin'));
signin.sendCode = async (req, res, who) => res.json({ ok: true, email: who.email });
const { registerNew } = require(path.join(API, 'routes', 'entities'));
const CS = require(path.join(API, 'lib', 'country-setup'));
const G = require(path.join(API, 'lib', 'govresolve'));

const run = (body) => new Promise((done) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { done({ status: this.statusCode, body: b }); } };
  registerNew({ body, headers: {} }, res);
});
const insertOf = () => SQL.find((q) => /^INSERT INTO identities/.test(q.sql.trim()));
const colsOf = (q) => (/\(([^)]*)\) VALUES/.exec(q.sql) || [])[1].split(',').map((s) => s.trim());
const valOf = (q, col) => { const v = (/VALUES \(([^)]*)\)/.exec(q.sql) || [])[1].split(',').map((x) => x.trim())[colsOf(q).indexOf(col)] || '';
  return /^\$\d+$/.test(v) ? q.params[Number(v.slice(1)) - 1] : v; };
const KOLKATA = { country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata', locale: 'en-IN', languages: ['en-IN'], device: { type: 'desktop' } };

(async () => {
  console.log('\n══ GOV-SPIN · a regional spin states its country; the registrant accepts it ══\n');
  let g = await G.resolveInstallationGovernance('au-test');
  ok('govresolve: au-test states AU — installation.country and basics.country', g.installation.country === 'AU' && g.basics.country === 'AU', JSON.stringify(g.installation));
  g = await G.resolveInstallationGovernance('platform-0');
  ok('govresolve: platform-0 states none → null (no default country, ever)', g.installation.country === null && g.basics.country === null);
  g = await G.resolveInstallationGovernance('xx-out');
  ok('govresolve: a stated country outside the constitution\'s allowed.countries is null in basics (tighten-only), the row\'s own still said',
    g.basics.country === null && g.installation.country === 'AU' && JSON.stringify(g.allowed.countries) === '["AE"]');

  process.env.INSTALLATION_KEY = 'au-test';
  let at = await CS.atSignup();
  const au = at.countries.find((c) => c.code === 'AU'), ae = at.countries.find((c) => c.code === 'AE'), inn = at.countries.find((c) => c.code === 'IN');
  ok('atSignup on au-test: installation AU "Australia", every pack offered (no envelope)', at.installation.country === 'AU' && at.installation.name === 'Australia' && at.allowed === null && au && ae && inn);
  ok('…each pack row says what applies, from the pack: AU GST · ABN · July · en-AU; AE VAT · TRN · January · ar-AE; IN GST · GSTIN · April',
    au.tax.scheme === 'GST' && au.tax.id === 'ABN' && au.fy_start_month === 7 && au.locale === 'en-AU'
    && ae.tax.scheme === 'VAT' && ae.tax.id === 'TRN' && ae.fy_start_month === 1 && ae.locale === 'ar-AE' && ae.languages.indexOf('ar') >= 0
    && inn.tax.id === 'GSTIN' && inn.fy_start_month === 4, JSON.stringify([au.tax, ae.tax, inn.tax]));

  SQL = [];
  let r = await run({ user_id: 'kolkata-on-au', display_name: 'kolkata-on-au', email: 'o@kolkata.example', context: KOLKATA });
  let ins = insertOf();
  ok('registerNew on an AU spin from a Kolkata browser stores the OFFER: AU · AUD · Australia/Sydney (never Asia/Kolkata)',
    r.status === 200 && ins && valOf(ins, 'country') === 'AU' && valOf(ins, 'currency_code') === 'AUD' && valOf(ins, 'timezone') === 'Australia/Sydney', ins && JSON.stringify(ins.params));
  const src = SQL.find((q) => q.scoped && /INSERT INTO entity_governance/.test(q.sql));
  const words = src ? JSON.parse(src.params[1]) : {};
  ok('…labelled in words: "this ChitBridge runs in Australia" · "the usual currency in Australia"', words.country === 'this ChitBridge runs in Australia' && words.currency === 'the usual currency in Australia', JSON.stringify(words));

  process.env.INSTALLATION_KEY = 'platform-0';
  SQL = [];
  r = await run({ user_id: 'nobody-knows', display_name: 'nobody-knows', email: 'n@example.com' });
  ins = insertOf();
  ok('no installation country + no guess → country NULL, no money or zone, no label (Country setup asks)',
    r.status === 200 && ins && valOf(ins, 'country') === null && colsOf(ins).indexOf('currency_code') < 0 && !SQL.some((q) => /entity_governance/.test(q.sql)));
  SQL = [];
  r = await run({ user_id: 'kolkata-on-p0', display_name: 'kolkata-on-p0', email: 'k@example.com', context: KOLKATA });
  ins = insertOf();
  ok('no installation country + a Kolkata browser → the browser\'s guess, as FX-AU1 stored it (IN · "your time zone")', ins && valOf(ins, 'country') === 'IN');

  process.env.INSTALLATION_KEY = 'au-test';
  at = await CS.atSignup();
  ID = { country: 'AU', timezone: 'Australia/Sydney' }; SETUP_DONE = null; HOLDS = false; SQL = [];
  let a = await CS.acceptAtSignup(h, 'E1', { country: 'AU', country_source: 'installation', timezone: 'Asia/Kolkata' }, at);
  ok('accept: the offered AU → source "installation", nothing moved', a && a.source === 'installation' && !SQL.some((q) => /UPDATE identities/.test(q.sql)), JSON.stringify(a));
  SQL = [];
  a = await CS.acceptAtSignup(h, 'E1', { country: 'IN', country_source: 'installation', timezone: 'Asia/Kolkata' }, at);
  let up = SQL.find((q) => /UPDATE identities/.test(q.sql));
  ok('accept: the browser\'s IN instead → source "browser" (the server\'s call, not the page\'s label); country IN · INR · Asia/Kolkata',
    a && a.source === 'browser' && up && up.params[1] === 'IN' && up.params[2] === 'INR' && up.params[3] === 'Asia/Kolkata', JSON.stringify(up && up.params));
  SQL = [];
  a = await CS.acceptAtSignup(h, 'E1', { country: 'AE', country_source: 'chosen', timezone: 'Asia/Kolkata' }, at);
  up = SQL.find((q) => /UPDATE identities/.test(q.sql));
  ok('accept: another allowed country (AE) → "chosen"; AED · Asia/Dubai (its one zone)', a && a.source === 'chosen' && up && up.params[2] === 'AED' && up.params[3] === 'Asia/Dubai', JSON.stringify(up && up.params));
  const sw = SQL.find((q) => /setup_source/.test(q.sql));
  ok('…its words onto setup_source, only while the step is not done', sw && sw.params[1] === 'you chose it at sign-up' && /country_setup_at IS NULL/.test(sw.sql));
  HOLDS = true; SQL = [];
  a = await CS.acceptAtSignup(h, 'E1', { country: 'IN', country_source: 'chosen' }, at);
  ok('a shop that holds anything is never re-countried by a sign-in', a === null && !SQL.some((q) => /UPDATE identities/.test(q.sql)));
  HOLDS = false; SETUP_DONE = new Date(); SQL = [];
  a = await CS.acceptAtSignup(h, 'E1', { country: 'IN', country_source: 'chosen' }, at);
  ok('…nor one whose Country setup is done', a === null && !SQL.some((q) => /UPDATE identities/.test(q.sql)));
  SETUP_DONE = null;
  ok('no country_source (an ordinary sign-in) → nothing', (await CS.acceptAtSignup(h, 'E1', { country: 'IN' }, at)) === null);
  process.env.INSTALLATION_KEY = 'ae-lock';
  at = await CS.atSignup();
  ok('tighten-only: ae-lock (constitution allows AE only) offers AE alone', at.installation.country === 'AE' && at.countries.length === 1 && at.countries[0].code === 'AE');
  ID = { country: 'AE', timezone: 'Asia/Dubai' }; SQL = [];
  a = await CS.acceptAtSignup(h, 'E1', { country: 'IN', country_source: 'chosen' }, at);
  ok('…and a country outside it is refused (null), the stored AE stands', a === null && !SQL.some((q) => /UPDATE identities/.test(q.sql)));
  ok('installationKey(): INSTALLATION_KEY, else platform-0', CS.installationKey() === 'ae-lock' && (delete process.env.INSTALLATION_KEY, CS.installationKey() === 'platform-0'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
