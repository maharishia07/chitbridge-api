#!/usr/bin/env node
/**
 * seat-grant-text.test.cjs — UX-222 guard: a grant's promised abilities and the gates' answers must not differ (Athi 27 Nov: role text, access and words come from ONE source).
 *
 * OWNS      for the Bookkeeper preset (lib/access.js, hat manager): every ability in `does` is passed by the shop-accountant seat, every ability in `stays` is NOT fully passed, and the sentence is exactly
 *           what lib/seat-abilities.whyOf writes from those names (no second copy of the wording). A route-backed ability is asked of the gate chain read from routes/books.js (tools/seat-matrix.cjs);
 *           an in-handler one through the function the route calls. GET /fx-rates and POST /fx-rates must answer alike.
 * CALLED BY scripts/guards-list-1.cjs
 * FLOW      PRESETS → names → gates (the real predicates) → verdict per name → fail on any difference
 * CARD      17-people-employees-hr-and-payroll/people-list-with-may-why
 *
 *   node tests/seat-grant-text.test.cjs
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const fs = require('fs');
const path = require('path');
const access = require('../lib/access');
const abilities = require('../lib/seat-abilities');
const matrix = require('../tools/seat-matrix.cjs');

const chains = matrix.chainOf(['books', 'books-events-batch'].map((n) => fs.readFileSync(path.join(__dirname, '..', 'routes', n + '.js'), 'utf8')).join('\n'));
let failed = 0, passed = 0;
const check = (ok, text) => { if (ok) passed++; else { failed++; console.log('  FAIL ' + text); } };

/** the verdict of the real gate for this seat: true (passes fully) or not */
function gateSays(name) {
  const a = abilities.ABILITIES[name];
  if (a.may) return abilities.may(name, seat) === true;
  const chain = chains[a.route];
  if (!chain) { check(false, name + ': route ' + a.route + ' not found in routes/books.js'); return null; }
  return matrix.cellOf(chain, seat) === true;
}
const preset = access.PRESETS.find((p) => p.key === 'bookkeeper');
/* the seat is built from the preset's OWN facts (hat, level, reach, cost sight), never typed here */
const seat = { api_key: null, identity: { identity_type: 'actor', parent_entity_id: 'shop', hat: preset.hat, access_level: preset.level, whole_entity: preset.whole_entity, can_see_costs: preset.can_see_costs } };
check(!!preset && Array.isArray(preset.does) && Array.isArray(preset.stays), 'the Bookkeeper preset lists its abilities by name');
preset.does.forEach((name) => check(gateSays(name) === true, 'the Bookkeeper grant promises "' + abilities.ABILITIES[name].words + '" but the gate refuses the accountant seat'));
preset.stays.forEach((name) => check(gateSays(name) === false, 'the Bookkeeper grant says "' + abilities.ABILITIES[name].noun + '" stays with the owner but the gate lets the accountant seat through'));
check(preset.why === abilities.whyOf(preset.does, preset.stays), 'the grant sentence is written by whyOf from the names, not typed');
/* the screen flag and the gate answer alike: GET /fx-rates may.add = POST /fx-rates gate */
const owner = { api_key: null, identity: { identity_type: 'entity' } };
const counter = matrix.SEATS.find((s) => s.key === 'counter').req;
[owner, seat, counter].forEach((req) => check(abilities.may('fx_rates', req) === (matrix.cellOf(['ownerOrAccountant'], req) === true), 'fx_rates: the screen flag and the POST gate answer alike'));
console.log('\n  ' + (passed + failed) + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
