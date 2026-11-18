'use strict';
/** tests/once.test.cjs — lib/once.refFor (API-COL-15 finding 2): the body's client_ref wins, else the held key as idem:<key>, else null; a long key is hashed, never cut. Run: node tests/once.test.cjs */
const assert = require('assert');
const { refFor } = require('../lib/once');
assert.strictEqual(refFor({ body: { client_ref: 'bank:x' }, idempotencyHeld: 'k' }), 'bank:x', 'a body ref wins');
assert.strictEqual(refFor({ body: {}, idempotencyHeld: 'k-1' }), 'idem:k-1', 'the held key');
assert.strictEqual(refFor({ body: {} }), null, 'neither');
assert.strictEqual(refFor({ body: { client_ref: 'a'.repeat(200) } }).length, 80, 'a body ref is cut to 80, as before');
const long1 = refFor({ body: {}, idempotencyHeld: 'k'.repeat(120) + '1' }), long2 = refFor({ body: {}, idempotencyHeld: 'k'.repeat(120) + '2' });
assert.ok(long1.length <= 70 && long1 !== long2, 'long keys are hashed apart');
assert.strictEqual(refFor({ body: {} }, { client_ref: 'z' }), 'z', 'an explicit body wins over req.body');
console.log('once: 6 ok');
