'use strict';
// @type: unit
/* watchReads + readFailures: a 5xx, 429, 408 or failed api GET is named; 200, 404, 403, a write and a non-api file are not.
   The listener wiring is tested with a fake page: removing page.on('response') or page.on('requestfailed') goes red. Also red when run.cjs/keyboard.cjs stop using it.
   Run: node e2e/proof/read-failures.test.cjs */
const assert = require('assert'), fs = require('fs'), path = require('path');
const { watchReads, readFailures } = require('./read-failures.cjs');
const B = 'https://staging.x.sslip.io';
const fakePage = () => { const h = {}; return { h, on: (n, f) => { h[n] = f; } }; };
const res = (method, status, url) => ({ status: () => status, url: () => url, request: () => ({ method: () => method }) });
const rf = (method, url, errorText) => ({ method: () => method, url: () => url, failure: () => ({ errorText }) });
const p = fakePage(); const seen = watchReads(p);
assert.ok(p.h.response && p.h.requestfailed, "watchReads must listen on 'response' and 'requestfailed'");
p.h.response(res('GET', 429, B + '/api/tasks?x=1')); p.h.response(res('GET', 200, B + '/api/me')); p.h.response(res('POST', 500, B + '/api/x'));
p.h.response(res('GET', 404, B + '/api/books/health')); p.h.response(res('GET', 403, B + '/api/pay/cheques')); p.h.response(res('GET', 500, B + '/favicon.ico'));
p.h.response(res('GET', 503, B + '/api/finance/collect')); p.h.response(res('GET', 408, B + '/api/a'));
p.h.requestfailed(rf('GET', B + '/api/b?z=1', 'net::ERR_CONNECTION_RESET')); p.h.requestfailed(rf('GET', B + '/api/c', 'net::ERR_ABORTED')); p.h.requestfailed(rf('POST', B + '/api/w', 'net::ERR_FAILED'));
assert.deepStrictEqual(readFailures(seen), ['429 /api/tasks', '503 /api/finance/collect', '408 /api/a', 'failed /api/b']);
assert.deepStrictEqual(readFailures([]), []);
const kb = fs.readFileSync(path.join(__dirname, 'keyboard.cjs'), 'utf8'), run = fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8');
assert.ok(/watchReads\(page\)/.test(kb) && /dataNotLoaded/.test(kb), 'keyboard.cjs must record dataNotLoaded from watchReads');
assert.ok(/dataNotLoaded/.test(run), 'run.cjs must turn dataNotLoaded into an error row, not a pass');
console.log('read-failures ok');
