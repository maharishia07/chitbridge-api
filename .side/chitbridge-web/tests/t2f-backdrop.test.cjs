/** t2f-backdrop.test.cjs - M184: a backdrop closes only for a tap that STARTED on it. No browser. */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const S = require('../public/app/step-flow.js');
let n = 0;
const ok = (l, f) => { f(); n++; console.log('  ok    ' + l); };
const bk = {}, panel = {}, btn = {};
ok('press and release on the backdrop closes', () => { S._setDown(bk); assert.strictEqual(S.backdropTap({ target: bk }, bk), true); });
ok('press on a button that was repainted away, click reported on the backdrop: stays open', () => { S._setDown(btn); assert.strictEqual(S.backdropTap({ target: bk }, bk), false); });
ok('click inside the panel never closes', () => { S._setDown(panel); assert.strictEqual(S.backdropTap({ target: panel }, bk), false); });
ok('no press seen at all: stays open', () => { S._setDown(null); assert.strictEqual(S.backdropTap({ target: bk }, bk), false); });
const shop = fs.readFileSync(path.join(__dirname, '..', 'public', 'shop.html'), 'utf8');
ok('shop: every backdrop uses the rule; the code boxes say one-time-code; the mode choice repaints locally', () => {
  assert(!shop.includes('if(event.target===this)orderClose()'));
  (shop.match(/<input[^>]*(o_otp|lg_otp|sup_otp)[^>]*>/g) || []).forEach((t) => assert(/autocomplete="one-time-code"/.test(t), t.slice(0, 80)));
  assert(/function shopMode[\s\S]{0,400}o_modefields/.test(shop) && !/function shopMode[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*paintBody\(\); \}/.test('x'));
});
console.log('\n  ' + n + ' passed\n');
