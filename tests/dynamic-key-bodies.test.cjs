#!/usr/bin/env node
// @type: contract
/**
 * dynamic-key-bodies.test.cjs — API-48 (S33 strict input): the four write doors whose body keys come from a LIST are closed against that one list.
 *
 * OWNS      PATCH /api/entities/policy (keys = lib/policy FLAGS + BOUND) · PATCH /api/entities/me/locale (the locale preference keys) · PATCH /api/entities/me/prefs/:kind
 *           (the locale + ui keys; the kind's own set is still checked by the handler) · PUT /api/integrations/streams (the seven stream ids, the same list policy stream_owner holds).
 *           For each: the body schema is closed (additionalProperties false) and lists EXACTLY the hand-computed keys; an unknown key is refused 400/422 and named;
 *           the bodies the web sends are still accepted.
 * CALLED BY scripts/guards.cjs · CI. tests/dynamic-key-bodies-mutation.test.cjs breaks the fix and requires this to go red. No database, no network: only the schema check runs.
 * FLOW      tools/load-app.cjs → the route's operation (register.operationsOfApp) → schemaValidate with a body → accepted, or refused with the field named
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/dynamic-key-bodies.test.cjs
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'tools', 'load-app.cjs')).loadApp(ROOT);
const register = require(path.join(ROOT, 'tools', 'api-register.cjs'));
const { schemaValidate, bodySchemaOf } = require(path.join(ROOT, 'middleware', 'validate'));
const policy = require(path.join(ROOT, 'lib', 'policy'));

const OPERATIONS = register.operationsOfApp();
/* hand-computed (read from routes/entities.js PREF_SETS and routes/integrations.js STREAM_LIST on 7 Nov 2026): 10 locale keys, 8 ui keys, 7 stream ids */
const LOCALE = ['lang', 'langs', 'region', 'locale', 'nu', 'hc', 'ca', 'fw', 'tz', 'workdays'];
const UI = ['theme', 'fs', 'motion', 'stripes', 'edition', 'font', 'weight', 'kural'];
const STREAMS = ['products', 'stock', 'profile', 'order', 'purchase', 'receipt', 'party'];
const POLICY = Object.keys(policy.FLAGS).concat(Object.keys(policy.BOUND));

const CASES = [
  ['PATCH /api/entities/policy', POLICY, [{ trade_side: 'receive' }, { showcase_sections: ['strip', 'facts'] }, { stream_owner: { products: 'kit1' } }]],
  ['PATCH /api/entities/me/locale', LOCALE, [{ lang: 'en', tz: 'Asia/Kolkata' }, { nu: '', hc: 'h23' }]],
  ['PATCH /api/entities/me/prefs/:kind', LOCALE.concat(UI), [{ theme: 'dark', fs: 'm' }, { lang: 'ta', region: 'IN' }]],
  ['PUT /api/integrations/streams', STREAMS, [{ products: 'kit1', stock: null }, { order: false, party: 'kit2' }]]
];
let pass = 0;
let fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

/** what the route's schema check does with a body: { status: 200 } when it lets it on, else the refusal's status and json */
function answerTo(operation, body, route) {
  let out = { status: 200 };
  const params = /:kind/.test(route) ? { kind: 'ui' } : {};
  const res = {
    statusCode: 200, locals: {}, set() { return this; }, setHeader() {}, getHeader() {}, type() { return this; }, end() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { out = { status: this.statusCode, json: value }; return this; },
    send(value) { out = { status: this.statusCode, json: value }; return this; }
  };
  const req = { body, query: {}, params, headers: {}, id: 'test', method: route.split(' ')[0], originalUrl: route.split(' ')[1], get() { return ''; } };
  schemaValidate(operation)(req, res, () => { out = { status: 200 }; });
  return out;
}

ok('hand count: 10 locale keys, 8 ui keys, 7 streams, the policy list is not empty', LOCALE.length === 10 && UI.length === 8 && STREAMS.length === 7 && POLICY.length > 10);
ok('the stream ids are the ones policy stream_owner holds (one list)', JSON.stringify(policy.FLAGS.stream_owner.keys) === JSON.stringify(STREAMS));

const listed = [...require('fs').readFileSync(path.join(ROOT, 'routes', 'integrations.js'), 'utf8').matchAll(/^ {2}\{ id: '(\w+)', label:/gm)].map((m) => m[1]);
ok('the route STREAM_LIST ids are the same seven', JSON.stringify(listed) === JSON.stringify(STREAMS), JSON.stringify(listed));

for (const [route, keys, bodies] of CASES) {
  const operation = OPERATIONS[route];
  const schema = operation && bodySchemaOf(operation);
  ok(route + ': the route has a body schema', !!schema);
  if (!schema) continue;
  ok(route + ': the body is closed (additionalProperties false)', schema.additionalProperties === false);
  ok(route + ': it lists exactly the ' + keys.length + ' keys of its list', JSON.stringify(Object.keys(schema.properties || {}).sort()) === JSON.stringify(keys.slice().sort()), JSON.stringify(Object.keys(schema.properties || {})));
  const refused = answerTo(operation, Object.assign({}, bodies[0], { zz_unknown_field: 1 }), route);
  ok(route + ': an unknown key is refused (400/422) and named', (refused.status === 400 || refused.status === 422) && JSON.stringify(refused.json).includes('zz_unknown_field'), JSON.stringify(refused));
  const bad = bodies.map((body) => answerTo(operation, body, route)).filter((got) => got.status !== 200);
  ok(route + ': ' + bodies.length + ' real caller body(ies) still accepted', !bad.length, JSON.stringify(bad));
  const only = answerTo(operation, { zz_unknown_field: 1 }, route);
  ok(route + ': a body of only an unknown key is refused too', only.status === 400 || only.status === 422, JSON.stringify(only));
}

/* a key of the OTHER set is not this door's: /me/locale is the locale list only */
const crossed = answerTo(OPERATIONS['PATCH /api/entities/me/locale'], { theme: 'dark' }, 'PATCH /api/entities/me/locale');
ok('PATCH /api/entities/me/locale: a ui key (theme) is refused, it is not a locale key', crossed.status === 400 || crossed.status === 422, JSON.stringify(crossed));

console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
