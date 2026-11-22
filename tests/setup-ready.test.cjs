// @type: unit
/**
 * setup-ready.test.cjs — GREY-VERT (Athi, 21 Nov): the sign-up list of business setups says which are READY.
 * OWNS      govresolve.setupReady (the one register) and GET /entities/constitutions carrying `ready` on every setup.
 * CALLED BY scripts/guards.cjs (GUARDS) · CI guards job.
 * FLOW      stubbed db rows (base, service-desk, an unlisted key) ──▶ the real route handler ──▶ each row's ready ; a shop already stamped keeps working (setupReady is never read by the resolver)
 * CARD      20-settings-governance-and-plan/governance-7-layers-govcontext
 */
'use strict';
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? ' ' + JSON.stringify(why) : '')); } };

(async () => {
  const gov = require(path.join(API, 'lib', 'govresolve'));
  check('Standard (base) is ready', gov.setupReady('base') === true);
  check('Service desk is not ready', gov.setupReady('service-desk') === false);
  check('a setup with no proof named (unknown key, null, empty) is not ready', gov.setupReady('pharma') === false && gov.setupReady(null) === false && gov.setupReady('') === false);

  /* the real route, its database and country read stubbed */
  const dbFile = require.resolve(path.join(API, 'db'));
  const real = require(dbFile);
  const rows = [
    { key: 'base', version: 'v2', label: 'Base', vertical: null, capabilities: ['core'], is_default: true },
    { key: 'service-desk', version: 'v1', label: 'Service Desk vertical', vertical: 'service-desk', capabilities: ['core'], is_default: false },
    { key: 'pharma', version: 'v1', label: 'Pharma', vertical: 'pharma', capabilities: [], is_default: false }
  ];
  real.query = async () => ({ rows });
  const CS = require(path.join(API, 'lib', 'country-setup'));
  CS.atSignup = async () => ({ installation: { key: 'k', country: 'IN', name: 'n' }, timezone: 'Asia/Kolkata', allowed: null });
  CS.offered = () => [];
  const router = require(path.join(API, 'routes', 'entities.js'));
  const layer = router.stack.find((l) => l.route && l.route.path === '/constitutions' && l.route.methods.get);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let body = null;
  await handler({ query: {}, id: 'r1' }, { json: (b) => { body = b; }, status() { return this; } });
  const by = (k) => (body.constitutions || []).find((c) => c.key === k) || {};
  check('GET /entities/constitutions: every setup carries ready as a true/false', (body.constitutions || []).length === 3 && body.constitutions.every((c) => typeof c.ready === 'boolean'), body);
  check('the route: base ready, service-desk not ready, an unlisted one not ready', by('base').ready === true && by('service-desk').ready === false && by('pharma').ready === false);
  check('the route still answers the other keys unchanged (key, label, vertical, capabilities, is_default)', by('service-desk').label === 'Service Desk vertical' && by('base').is_default === true && Array.isArray(by('base').capabilities));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
