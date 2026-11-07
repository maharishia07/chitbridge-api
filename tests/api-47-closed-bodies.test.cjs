#!/usr/bin/env node
// @type: contract
/**
 * api-47-closed-bodies.test.cjs — API-47 (S33): the 12 doors only our web calls refuse an unknown body key, 400 by name, and still take every body the web sends.
 *
 * OWNS      the proof for POST /api/signin/{ask,verify,pin,renew,logout,sessions/revoke}, POST /api/actors/{login,set-pin}, POST /api/entities/{register,verify} and
 *           POST /api/simulator/{feedback,lead}: (1) an unknown key is a 400 Problem, code INVALID_INPUT (a registered code), the key named; (2) every body a web caller
 *           really sends (public/app.html, app/signin-ui.js + engine/signin.js with the device_id and surface its transport adds, app/register-form.js,
 *           app/cap-settings.js, till.html renew) is still let through; (3) the register row reads strict_input true.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the schema check alone, over the real contracts.
 * FLOW      route -> its real OpenAPI operation (the contract the route file uses) -> schemaValidate(operation, the route's options) -> status/body/next()
 * CARD      18-identity-sign-in-and-access/sign-in
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const { schemaValidate } = require('../middleware/validate');
const signin = require('../lib/signin-contract');
const actors = require('../lib/actors-contract');
const entities = require('../lib/entities-contract');
const sim = require('../lib/simulator-contract');
const codes = require('../docs/error-codes.json');

const DEV = { device_id: 'dev-1', surface: 'web' }; /* what app/signin-ui.js httpPost adds to every post */
/** [label, operation, options, [web bodies]] */
const DOORS = [
  ['POST /api/signin/ask', signin.contract.operationFor('POST /ask'), signin.schemaOptions, [{ mode: 'login', email: 'a@b.in', ...DEV }, { mode: 'login', user_id: 'shop', ...DEV }, { mode: 'login', id: '9876543210', ...DEV }, { mode: 'login', email: 'a@b.in' }]],
  ['POST /api/signin/verify', signin.contract.operationFor('POST /verify'), signin.schemaOptions, [{ id: 'a@b.in', otp: '123456', ...DEV }, { id: 'x', pin: '1234', ...DEV }, { id: 'x', otp: '123456' }]],
  ['POST /api/signin/pin', signin.contract.operationFor('POST /pin'), signin.schemaOptions, [{ pin: '1234', confirm_pin: '1234', ...DEV }, { pin: '1234', confirm_pin: '1234' }]],
  ['POST /api/signin/renew', signin.contract.operationFor('POST /renew'), signin.schemaOptions, [{ surface: 'till' }, {}]],
  ['POST /api/signin/logout', signin.contract.operationFor('POST /logout'), signin.schemaOptions, [{}, undefined]],
  ['POST /api/signin/sessions/revoke', signin.contract.operationFor('POST /sessions/revoke'), signin.schemaOptions, [{ jti: 'j1' }, { device_id: 'd1' }]],
  ['POST /api/actors/login', actors.actors.operationFor('POST /login'), actors.schemaOptions, [{ username: 'ravi@shop', otp: '123456' }, { username: 'ravi@shop', pin: '1234' }]],
  ['POST /api/actors/set-pin', actors.actors.operationFor('POST /set-pin'), actors.schemaOptions, [{ pin: '1234', confirm_pin: '1234' }]],
  ['POST /api/entities/register', entities.entities.operationFor('POST /register'), entities.schemaOptions, [{ display_name: 'x', email: 'a@b.in', mode: 'login' }, { user_id: 'shop', display_name: 'Shop', email: 'a@b.in', context: { country: 'IN' } }, { email: 'a@b.in', display_name: 'Beta' }]],
  ['POST /api/entities/verify', entities.entities.operationFor('POST /verify'), entities.schemaOptions, [{ email: 'a@b.in', otp: '123456' }, { user_id: 'shop', otp: '123456' }, { email: 'a@b.in', otp: '123456', constitution: 'base', context: {}, agreed_at: '2026-11-07T00:00:00.000Z' }]],
  ['POST /api/simulator/feedback', sim.operationFor('POST /feedback'), sim.schemaOptions, [{ section: 's', rating: 4, message: 'good', leadId: '' }, { message: 'm' }]],
  ['POST /api/simulator/lead', sim.operationFor('POST /lead'), sim.schemaOptions, [{ name: 'Asha', email: 'a@b.in', org: 'Shop' }, { name: 'Asha', email: 'a@b.in' }]]
];

/** run the real schema check on one body: { next: true } or { status, body } */
function run(operation, options, body) {
  let out = { next: false };
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    type() { return this; },
    json(b) { out = { status: this.statusCode, body: b }; return this; },
    send(b) { out = { status: this.statusCode, body: b }; return this; },
    end() { return this; }
  };
  const req = { body, query: {}, params: {}, headers: {}, id: 'req-1', method: 'POST', originalUrl: '/x', get() { return ''; } };
  schemaValidate(operation, options)(req, res, () => { out = { next: true }; });
  return out;
}

let failed = 0;
const say = (ok, what) => { if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + what); };
const registered = new Set(codes.codes.map((row) => row.code));

for (const [label, operation, options, webBodies] of DOORS) {
  const refused = run(operation, options, { ...(webBodies[0] || {}), zz_unknown_key: 1 });
  say(refused.status === 400, label + ': an unknown key is a 400 (got ' + (refused.next ? 'accepted' : refused.status) + ')');
  const named = JSON.stringify(refused.body || {}).includes('zz_unknown_key');
  say(!refused.next && !!refused.body && registered.has(refused.body.code) && named, label + ': a registered code and the key is named (code ' + (refused.body && refused.body.code) + ')');
  webBodies.forEach((body, index) => say(run(operation, options, body).next === true, label + ': web body #' + (index + 1) + ' still accepted'));
}

/* the register row: strict_input true on all 12 (docs/api-register.json is generated by tools/api-register.cjs) */
const register = require('../docs/api-register.json');
for (const [label] of DOORS) {
  const row = register.routes.find((r) => r.key === label);
  say(!!row && row.columns.strict_input === true, label + ': register row strict_input true');
}

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
