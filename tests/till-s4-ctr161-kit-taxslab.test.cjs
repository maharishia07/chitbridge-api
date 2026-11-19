/* CTR-161 — the kit server carries and serves /app/tax-slab-ui.js like signin-ui.js, so the page's onerror engineMissed hook never fires offline.
   Static, no network. CTR161_MUTATE=1 drops the till.js route and must fail. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const API = path.join(__dirname, '..'), kit = path.join(API, 'tools', 'tally-connector');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let prog = read(path.join(kit, 'till.js'));
if (process.env.CTR161_MUTATE === '1') prog = prog.replace("  '/app/tax-slab-ui.js': ['tax-slab-ui.js', 'the rate menu']", '  /* gone */');
assert.ok(/'\/app\/tax-slab-ui\.js': \['tax-slab-ui\.js'/.test(prog) && /KIT_SERVED\[url\.pathname\]/.test(prog), 'till.js does not serve /app/tax-slab-ui.js');
assert.ok(/live: \[[^\]]*'tax-slab-ui\.js'/.test(prog), 'the kit update does not refresh tax-slab-ui.js');
assert.ok(/'tax-slab-ui\.js'/.test((read(path.join(API, 'routes', 'integrations.js')).match(/const KIT_NAMES = \[([^\]]*)\]/) || [])[1] || ''), 'the kit zip does not carry tax-slab-ui.js');
assert.ok(/WEB_MASTERED_KIT = \(\) => \[\[path\.join\(WEB, 'app', 'tax-slab-ui\.js'\), path\.join\(API, 'tools', 'tally-connector', 'tax-slab-ui\.js'\), 'copy'\]\]/.test(read(path.join(API, 'scripts', 'vendor-till.cjs'))), 'vendor-till has no web to kit pair for tax-slab-ui.js');
/* what the kit copy must carry, offline, for every country's bill (IN · AU · AE): the vendored byte copy of the web master, its functions named so the trace reaches it */
const carried = ['cbSlabOptionsHTML', 'cbTaxCharges', 'cbRateColumnKeys', 'cbSlabSourceWords'];
const COPY_REL = 'tools/tally-connector/tax-slab-ui.js';
const copy = path.join(API, COPY_REL);
assert.ok(carried.every((fn) => read(copy).includes('function ' + fn + '(')), 'the kit copy lacks a function the page calls');
assert.ok(fs.existsSync(copy) && /cbSlabMenu/.test(read(copy)), 'the kit has no tax-slab-ui.js (run scripts/vendor-till.cjs)');
assert.ok(/<script src="\/app\/tax-slab-ui\.js" onerror="engineMissed\('tax-slab-ui'\)">/.test(read(path.join(kit, 'till.html'))), 'the page no longer loads it');
console.log('till-s4-ctr161-kit-taxslab ok · 6 checks');
