'use strict';
/* tools/graph/trace.cjs layerOf: which §7 minimums a module is held to follows its layer.
 * The Tally connector folder is the till's own code (counter layer: walk, offline-sync-once, country-bill, vendored-byte-equal), but
 * tools/tally-connector/prove.js is a dev proof script — it needs a live api and CB_TOKEN, ships to no shop and is not the till — so it
 * takes the tool layer (a unit test). Run: node tests/trace-layer.test.cjs */
const assert = require('assert');
const { layerOf } = require('../tools/graph/trace.cjs');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

ok(layerOf('api', 'tools/tally-connector/prove.js') === 'tool', 'api tools/tally-connector/prove.js is a tool (dev proof script)');
ok(layerOf('api', 'tools/tally-connector/till.js') === 'counter', 'api tools/tally-connector/till.js stays counter');
ok(layerOf('api', 'tools/tally-connector/core.js') === 'counter', 'api tools/tally-connector/core.js stays counter');
ok(layerOf('api', 'tools/tally-connector/adapters/prove.js') === 'counter', 'only the folder-top prove.js moves, not a same-named file below it');
ok(layerOf('api', 'tools/other-script.cjs') === 'tool', 'other api tools stay tool');
ok(layerOf('api', 'routes/chits.js') === 'route' && layerOf('api', 'lib/books.js') === 'lib', 'route and lib are unchanged');
console.log('\n  ' + n + ' checks, all green');
