'use strict';
/** ERR-14 part 3: the request line names the code of ANY refusal (own res.json too), once, without changing the body. Run: node tests/request-log-refusal-code.test.cjs */
const assert = require('assert');
const { noteRefusalCode, requestLine } = require('../lib/request-log');
const mk = (status) => { const res = { statusCode: status, locals: {}, json(b) { this.sent = b; return this; } }; noteRefusalCode(res); return res; };
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
let res = mk(409); const body = { error: 'x', code: 'PERIOD_LOCKED' }; res.json(body);
ok(res.locals.code === 'PERIOD_LOCKED' && res.sent === body, 'own {code} on a 409 reaches the log line, body untouched');
res = mk(422); res.json({ error: { code: 'VALIDATION_FAILED' } }); ok(res.locals.code === 'VALIDATION_FAILED', 'a nested error.code is read');
res = mk(200); res.json({ code: 'SOMETHING' }); ok(!res.locals.code, 'a 200 never gets a refusal code');
res = mk(400); res.locals.code = 'FIRST'; res.json({ code: 'SECOND' }); ok(res.locals.code === 'FIRST', 'a code a handler already set is kept');
res = mk(400); res.json({ code: 'lower case words' }); ok(!res.locals.code, 'a value that is not a code word is not taken');
const line = requestLine({ id: 'r1', method: 'POST', originalUrl: '/api/x', headers: {}, identity: { identity_id: 'e1', identity_type: 'entity' } }, Object.assign(mk(409), { locals: { code: 'PERIOD_LOCKED' } }), Date.now());
ok(line.code === 'PERIOD_LOCKED' && line.id === 'r1' && line.entity === 'e1' && line.seat === 'owner' && 'route' in line, 'the line holds code, id, route, shop (entity) and seat');
console.log(n + ' ok');
