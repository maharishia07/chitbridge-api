'use strict';
// E-F-07 (walk E, 21 Nov): a send's reason never carries a server variable name; old receipts are worded on the way out.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../lib/marketing-results');
assert.strictEqual(R.plainReason({ reason: 'WHATSAPP_TOKEN is not set - outbound is not configured' }), 'WhatsApp is not connected yet');
assert.strictEqual(R.plainReason({ reason: 'the binding has no provider_ref (phone_number_id) — cannot address a send' }), 'This WhatsApp line has no sending number yet');
assert.strictEqual(R.plainReason({ reason: 'Nobody agreed' }), 'Nobody agreed');
assert.strictEqual(R.reasonCodeOf({ status: 'refused', reason: 'WhatsApp is not connected yet' }), 'NO_TOKEN', 'the plain sentence still maps to the same code');
const out = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsapp-out.js'), 'utf8');
assert(!/reason: '[^']*(WHATSAPP_TOKEN|phone_number_id)/.test(out), 'no env name in a stored reason');
console.log('ok · marketing plain reason');
process.exit(0);
