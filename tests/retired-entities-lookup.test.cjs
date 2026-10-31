#!/usr/bin/env node
/**
 * retired-entities-lookup.test.cjs — M4 (Athi 31 Oct 2026): GET /api/entities/lookup is retired; search is the one way to find an entity by its user_id.
 *
 * OWNS      the proof that the route is gone from the app and the register, that RETIRED.md says so, and that the manual proof script scripts/prove-network-mint.js
 *           (its only caller) asks GET /api/entities/search, whose answer for no match is 200 { results: [], count: 0 }.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      read routes/entities.js, docs/api-register.json, RETIRED.md, scripts/prove-network-mint.js → assert each → exit 1 on a miss
 * CARD      04-network/connections-and-invitations
 */
'use strict';
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
let failed = 0;
const check = (name, pass) => { console.log((pass ? '  ok    ' : '  FAIL  ') + name); if (!pass) failed++; };

const register = JSON.parse(read('docs/api-register.json'));
check('the register holds no GET /api/entities/lookup', !register.routes.some((r) => r.key === 'GET /api/entities/lookup'));
check('the network lookup (a different route, by bridgeId) is still there', register.routes.some((r) => r.key === 'GET /api/network/entities/lookup'));
check('routes/entities.js mounts no /lookup', !/router\.get\(\s*'\/lookup'/.test(read('routes/entities.js')));
check('RETIRED.md records the route with its replacement', /GET \/api\/entities\/lookup[^\n]*GET \/api\/entities\/search/.test(read('RETIRED.md')));
const proof = read('scripts/prove-network-mint.js');
check('the proof script no longer calls the retired route', !/api\/entities\/lookup/.test(proof));
check('the proof script asks search for the handle and expects 200 with count 0', /api\/entities\/search\?q=/.test(proof) && /before\.json\.count === 0/.test(proof));

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
