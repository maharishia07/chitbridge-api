/**
 * tests/al-move-in-gstin-sources.test.cjs — AL-F-02 (the source list) and AL-F-03 (one GSTIN check for the preview and the write).
 * OWNER cb-accounting (move-in) · RISK words only; no money · CALLED BY scripts/guards.cjs · Run: node tests/al-move-in-gstin-sources.test.cjs
 * AL-F-03: 27AAPFU0939F1ZV is a GSTIN that checks out (hand: its 15th character is V). Its last character changed to 5 fails the checksum; 99AAPFU0939F1ZK has a right check digit but state code 99, which the write refuses (state 01-38 or 97).
 */
'use strict';
const assert = require('assert');
const MI = require('../lib/move-in');
const PF = require('../lib/party-fields');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
ok('an India shop is offered Tally and Zoho Books first, greyed with a sentence; Xero and QuickBooks stay', () => {
  const list = MI.sourcesFor('IN');
  assert.deepStrictEqual(list.map((i) => i.source), ['tally', 'zoho', 'xero', 'qbo']);
  assert.ok(list.slice(0, 2).every((i) => i.ready === false && /not built yet/.test(i.why)));
  assert.ok(list.slice(2).every((i) => i.ready === true && i.why === null));
});
ok('an Australian shop sees MYOB greyed (AP-F-06) and the built readers; any other country only the built ones', () => {
  assert.deepStrictEqual(MI.sourcesFor('AU').map((i) => i.source), ['myob', 'xero', 'qbo']);
  assert.deepStrictEqual(MI.sourcesFor('AE').map((i) => i.source), ['xero', 'qbo']);
});
ok('a Tally file is refused with the not-built sentence, not "xero or qbo?"', () => assert.throws(() => MI.sourceOf('tally'), /Tally file is not built yet/));
ok('the move-in preview and the write use ONE GSTIN check: good passes, bad check digit and state 99 fail, same words', () => {
  assert.strictEqual(PF.checkTaxId('GSTIN', '27AAPFU0939F1ZV').ok, true);
  const bad = PF.checkTaxId('GSTIN', '27AAPFU0939F1Z5'), state = PF.checkTaxId('GSTIN', '99AAPFU0939F1ZK');
  assert.strictEqual(bad.ok, false); assert.strictEqual(state.ok, false);
  assert.match(state.why, /state code/);
});
console.log(n + ' checks');
