#!/usr/bin/env node
// @type: contract
/**
 * api-junk-types-api9394.test.cjs — API-93 / API-94 (21 Nov 2026): fields that took any value now name their kind, so junk is refused at the one schema check.
 *
 * OWNS      the proof that, for each route below, an object, number or list where the contract now says text, boolean or list is refused 400/422 in the
 *           one error shape with a registered code (never reaches the handler, never String()-ed into "[object Object]"), that a sane body still passes, and that
 *           GET /api/products reads a huge ?offset through the one pager (bounds.offsetNumber) instead of handing it to Postgres.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real server.js over tools/load-app.cjs.
 * FLOW      route leaf → its schemaValidate middleware → junk body → status + Problem code · good body → next()
 * Run: node tests/api-junk-types-api9394.test.cjs · MIN unit-per-rule · refusal-path
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');

const HERE = path.join(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const loader = require(path.join(HERE, 'tools', 'load-app.cjs'));
loader.stubDatabase(HERE);
const app = loader.loadApp(HERE);
const leaves = {};
loader.leavesOf(app, true).forEach((leaf) => (leaves[leaf.method + ' ' + leaf.path] = leaf));
const CODES = new Set(require(path.join(HERE, 'docs', 'error-codes.json')).codes.map((row) => row.code));

let failed = 0;
let total = 0;
const check = (label, ok, info) => {
  total++;
  if (!ok) failed++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (ok || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 400)));
};

/** what the route's schema check says to one body: { passed } or { status, code } */
function verdict(key, body) {
  const leaf = leaves[key];
  const check1 = leaf && leaf.fns.find((fn) => fn && fn.schemaOperation);
  if (!check1) return { missing: true };
  const out = { passed: false };
  const req = { body, query: {}, params: { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' }, headers: {}, method: 'POST', originalUrl: '/x', path: '/x', id: 'req-junk', get: () => '' };
  const res = {
    locals: {},
    status(code) {
      this.code = code;
      return this;
    },
    set() {
      return this;
    },
    setHeader() {},
    type() {
      return this;
    },
    json(answer) {
      out.status = this.code;
      out.code = answer && answer.code;
    },
    send() {
      out.status = this.code;
    },
    end() {
      out.status = this.code;
    }
  };
  check1(req, res, () => (out.passed = true));
  return out;
}

const NESTED = { a: { a: { a: { a: 1 } } } };
const CASES = [
  ['POST /api/counters', { name: 'Till 2' }, { name: NESTED }],
  ['PATCH /api/counters/:id', { name: 'Back till' }, { name: 12345 }],
  ['POST /api/till/catalogue', { blueprint: 'general' }, { blueprint: NESTED }],
  ['POST /api/till/catalogue', { replace: true }, { replace: 'yes please' }],
  ['POST /api/testing/cases/close', { case_key: 'ABC', open: true, why: 'tidy' }, { case_key: 'ABC', why: NESTED }],
  ['POST /api/testing/cases/close', { case_key: 'ABC', open: false }, { case_key: 'ABC', open: 'maybe' }],
  ['POST /api/testing/incidents', { observed: 'it broke', severity: 'Sev-2', build: 'abc123' }, { observed: 'x', severity: NESTED }],
  ['POST /api/testing/incidents', { observed: 'it broke', screen_code: 'CAT005' }, { observed: 'x', screen_code: [1] }],
  ['PATCH /api/entities/me/exposure', { tax: true, media: false }, { tax: '1e21' }],
  ['POST /api/channels/:id/approve', { via: 'platform' }, { via: NESTED }],
  ['POST /api/channels/:id/template-approve', { entity_id: 'e1', name: 'welcome' }, { name: [1, 2] }],
  ['POST /api/till/listen', { audio: 'AAAA', mime: 'audio/webm' }, { audio: NESTED }],
  ['POST /api/till/reconcile', { bills: [{ no: '1' }] }, { bills: NESTED }]
];
CASES.forEach(([key, good, junk]) => {
  const fine = verdict(key, good);
  const bad = verdict(key, junk);
  check(key + ' keeps a sane body ' + JSON.stringify(good).slice(0, 40), fine.passed === true, fine);
  check(key + ' refuses ' + JSON.stringify(junk).slice(0, 40) + ' in the one shape with a registered code', bad.passed === false && (bad.status === 400 || bad.status === 422) && CODES.has(bad.code), bad);
});

/* GET /api/products: a figure past what Postgres' OFFSET holds is clamped by the one pager */
const bounds = require(path.join(HERE, 'lib', 'bounds.js'));
check('offsetNumber clamps 99999999999999999999 to a figure Postgres holds', bounds.offsetNumber('99999999999999999999') <= bounds.PAGE_MAX * bounds.LIMIT_MAX);
check('products reads its offset through bounds.offsetNumber', /bounds'\)\.offsetNumber\(req\.query\.offset\)/.test(require('fs').readFileSync(path.join(HERE, 'routes', 'products.js'), 'utf8')));

console.log('\n' + (total - failed) + '/' + total + ' passed');
process.exit(failed ? 1 : 0);
