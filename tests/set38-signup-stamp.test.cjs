/**
 * set38-signup-stamp.test.cjs — SET-38 (walk R6): a fresh registration that ACCEPTS its country (reg-agree) ends with country_setup_at set and
 * Accounts unlocked (gate: required false, books true). Stamped through save() — the ONE writer — never a second UPDATE.
 *
 * Proves, offline (a stateful stand-in for identities + entity_governance, the stance of tests/register-spin-country.test.cjs):
 *   · a new AU shop (country · money · zone from the offer, no stamp) is locked BEFORE: profile.required, gate refuses COUNTRY_SETUP_PENDING
 *   · acceptAtSignup stamps: country_setup_at set, gate open, the country source words kept, fy from the pack (AU: July)
 *   · the country stays changeable until the constitution is fixed: a different country re-saved by save() is allowed on the empty shop
 *   · a shop that holds a product: save() refuses a different country (409) as before — the stamp changed nothing there
 *   · no pack money/year (a country with no pack) → nothing stamped, the step still asks
 * Run: node tests/set38-signup-stamp.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const ROW = { country: 'AU', currency_code: 'AUD', gstn: null, timezone: 'Australia/Sydney', policy_flags: {} };
let GOV = { fy_start_month: null, tax_registration: null, setup_source: { country: 'you chose it at sign-up' }, country_setup_at: null };
let HOLDS = false, STAMPS = 0;
const h = { query: async (sql, params) => {
  const t = String(sql);
  if (/FROM identities WHERE identity_id = \$1/.test(t) && /SELECT/.test(t) && /country-setup/.test(t)) return { rows: [ROW] };
  if (/SELECT country, timezone FROM identities/.test(t)) return { rows: [{ country: ROW.country, timezone: ROW.timezone }] };
  if (/SELECT country_setup_at FROM entity_governance/.test(t)) return { rows: [{ country_setup_at: GOV.country_setup_at }] };
  if (/country-setup \*\//.test(t) && /FROM entity_governance/.test(t)) return { rows: [GOV] };
  if (/country-setup constituted/.test(t)) return { rows: [{ products: HOLDS, chits: false, entries: false }] };
  if (/^UPDATE identities SET country = \$2, currency_code = \$3/.test(t.trim())) { ROW.country = params[1]; ROW.currency_code = params[2]; return { rowCount: 1, rows: [] }; }
  if (/SET setup_source = COALESCE/.test(t)) { GOV.setup_source = Object.assign({}, GOV.setup_source, { country: params[1] }); return { rowCount: 1, rows: [] }; }
  if (/^UPDATE entity_governance SET fy_start_month/.test(t.trim())) {
    STAMPS++; GOV = { fy_start_month: params[1], tax_registration: JSON.parse(params[2]), setup_source: JSON.parse(params[3]), country_setup_at: new Date() };
    return { rowCount: 1, rows: [] };
  }
  return { rows: [], rowCount: 0 };
} };
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql) => (/information_schema/.test(String(sql)) ? { rows: [{ ok: true, '?column?': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 }),
  withEntity: async (e, fn) => fn(h), withTransaction: async (fn) => fn(h), onEntity: async (e, fn) => fn(h), readBatch: async () => [],
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } },
} };
const CS = require(path.join(API, 'lib', 'country-setup'));

(async () => {
  console.log('\n══ SET-38 · registration stamps country_setup_at, Accounts open ══\n');
  process.env.INSTALLATION_KEY = 'platform-0';
  const at = await CS.atSignup();
  CS.forget('E1');
  let p = await CS.profile(h, 'E1');
  ok('before: a new shop is locked — not done, required', p.done === false && p.required === true && p.country.code === 'AU');
  let refused = null;
  try { await CS.gate(h, 'E1'); } catch (e) { refused = e; }
  ok('before: the books gate refuses COUNTRY_SETUP_PENDING', refused && refused.code === 'COUNTRY_SETUP_PENDING', refused && refused.code);

  const a = await CS.acceptAtSignup(h, 'E1', { country: 'AU', country_source: 'chosen', timezone: 'Australia/Sydney' }, at);
  CS.forget('E1');
  p = await CS.profile(h, 'E1');
  ok('accept at sign-up: country_setup_at set, not required, fy from the AU pack (July), one stamp', a && p.done === true && p.required === false && p.fy_start_month === 7 && STAMPS === 1, JSON.stringify([a, p.done, p.fy_start_month, STAMPS]));
  ok('…the source words survive (the accept words: "your time zone")', p.source.country === 'your time zone', JSON.stringify(p.source));
  refused = null;
  try { await CS.gate(h, 'E1'); } catch (e) { refused = e; }
  ok('after: the books gate opens (Accounts unlocked)', refused === null, refused && refused.code);

  const before = STAMPS;
  await CS.save(h, 'E1', { country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false }, source: {} }, 'owner');
  ok('the country is still changeable while nothing exists (DECISIONS 2026-10-13): AU → IN saved', ROW.country === 'IN' && STAMPS === before + 1, ROW.country);

  HOLDS = true; let err = null;
  try { await CS.save(h, 'E1', { country: 'AU', currency: 'AUD', fy_start_month: 7, tax: { registered: false }, source: {} }, 'owner'); } catch (e) { err = e; }
  ok('once the shop holds a product a different country is refused (409), as before', err && err.code === 'COUNTRY_CHANGE_IS_NEW_ENTITY' && err.status === 409, err && err.code);
  HOLDS = false;

  ROW.country = 'BR'; ROW.currency_code = null; GOV = { fy_start_month: null, tax_registration: null, setup_source: {}, country_setup_at: null }; STAMPS = 0; CS.forget('E2');
  const stamped = await CS.stampAtSignup ? await CS.stampAtSignup(h, 'E2') : false;
  ok('a country with no pack answer (no money, no year) is NOT stamped — the step still asks', stamped === false && STAMPS === 0);

  const reset = (row) => { Object.assign(ROW, { country: 'AU', currency_code: 'AUD', gstn: null, timezone: 'Australia/Sydney' }, row); GOV = { fy_start_month: null, tax_registration: null, setup_source: { country: 'you chose it at sign-up' }, country_setup_at: null }; STAMPS = 0; CS.forget('E3'); };
  reset({ timezone: 'Asia/Kolkata' });
  await CS.acceptAtSignup(h, 'E3', { country: 'AU', country_source: 'chosen' }, at);
  CS.forget('E3'); p = await CS.profile(h, 'E3');
  ok('skip: AU with a zone of another country (several AU zones, none picked) → unstamped, the step still asks', STAMPS === 0 && p.done === false && p.required === true, JSON.stringify([STAMPS, p.done]));
  reset({ gstn: 'NOT-AN-ABN' });
  await CS.acceptAtSignup(h, 'E3', { country: 'AU', country_source: 'chosen' }, at);
  CS.forget('E3'); p = await CS.profile(h, 'E3');
  ok('skip: a bad tax number → unstamped, the step still asks', STAMPS === 0 && p.done === false && p.required === true, JSON.stringify([STAMPS, p.done]));
  reset({});
  await CS.acceptAtSignup(h, 'E3', { country: 'AU', country_source: 'chosen', timezone: 'Australia/Sydney' }, at);
  ok('the accepted words ride on money and year too (never "what you set")', !!GOV.setup_source.country && GOV.setup_source.currency === GOV.setup_source.country && GOV.setup_source.fy_start_month === GOV.setup_source.country, JSON.stringify(GOV.setup_source));
  /* ⭐ Athi, 29 Oct: unknown tax registration is never "not registered" — only the owner's explicit choice stores false */
  reset({});
  await CS.acceptAtSignup(h, 'E3', { country: 'AU', country_source: 'chosen', timezone: 'Australia/Sydney' }, at);
  CS.forget('E3'); p = await CS.profile(h, 'E3');
  ok('sign-up stamp: tax_registration is NULL (not false), the step is done', STAMPS === 1 && GOV.tax_registration === null && p.done === true, JSON.stringify(GOV.tax_registration));
  ok('reader profile(): a null tax_registration with no number reads as unknown (null), not false', p.tax.registered === null && p.tax.number === null && p.tax.scheme === null, JSON.stringify(p.tax));
  ok('reader clean(): a body that does not say registered stays null (unknown), never coerced to false', CS.clean({ country: 'AU', currency: 'AUD', fy_start_month: 7, tax: {} }).tax.registered === null && CS.clean({ country: 'AU', currency: 'AUD', fy_start_month: 7 }).tax.registered === null);
  await CS.save(h, 'E3', { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false }, source: {} }, 'owner');
  CS.forget('E3'); p = await CS.profile(h, 'E3');
  ok('the owner\'s explicit "not registered" stores { registered: false } and reads back false', GOV.tax_registration && GOV.tax_registration.registered === false && p.tax.registered === false, JSON.stringify(GOV.tax_registration));
  ROW.gstn = '51824753556'; GOV = Object.assign({}, GOV, { tax_registration: null }); CS.forget('E3'); p = await CS.profile(h, 'E3');
  ok('a stored tax number still reads registered true', p.tax.registered === true && p.tax.number === '51824753556', JSON.stringify(p.tax));
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
