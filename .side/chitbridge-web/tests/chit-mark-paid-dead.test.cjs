/**
 * tests/chit-mark-paid-dead.test.cjs — Mark paid on a cancelled (void) or rejected bill is SHOWN but not live, with the reason as its sentence
 * (show the action, enable by role); the server answers 409 CHIT_VOIDED there (FIN-80, api NO_PAYMENT_STATUS = cancelled, rejected). The status set is
 * the chit sheet's one list (CBSheet.isDead). An open bill keeps the live button. A dead one stays focusable (aria-disabled, so a keyboard user hears why).
 * Run: node tests/chit-mark-paid-dead.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
globalThis.counterOfBill = () => '';
globalThis.chitIsSelf = () => false;
globalThis.tx = (s) => s;
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'helpers.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'chit-sheet.js'), 'utf8'));
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
function fnSource(name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  assert(at > 0, name + ' is in app.html');
  const rest = src.slice(at + 1);
  return rest.slice(0, rest.search(/\n(?:\/\*\*|async function |function )/));
}
eval(fnSource('chitStatusWord') + '\n' + fnSource('chitNoPayWhy') +'\n' + fnSource('chitMarkPaidButton') + '\nglobalThis.chitMarkPaidButton = chitMarkPaidButton;');
const WHY = 'A cancelled or rejected bill takes no payment';
const bill = (status, where) => (where === 'header' ? { id: 'c1', header: { current_status: status } } : where === 'top' ? { id: 'c1', current_status: status } : { id: 'c1', _status: status });
for (const where of ['row', 'header', 'top']) {
  for (const st of ['cancelled', 'rejected']) {
    const html = chitMarkPaidButton(bill(st, where), 100);
    assert(/data-testid="chit-mark-paid"/.test(html), st + '/' + where + ': the action is still shown');
    assert(/aria-disabled="true"/.test(html) && !/onclick=/.test(html), st + '/' + where + ': shown disabled, no handler');
    assert(html.includes('title="' + WHY + '"'), st + '/' + where + ': the reason is the tooltip');
    assert(html.includes('aria-label="Mark paid — ' + WHY + '"'), st + '/' + where + ': a keyboard user hears the reason');
    assert(!/tabindex="-1"/.test(html) && !/ disabled[ >=]/.test(html), st + '/' + where + ': focusable, not natively disabled');
  }
}
for (const st of ['pending', 'delivered', 'read', 'accepted', 'in_progress', 'partial', 'completed', '']) {
  const html = chitMarkPaidButton(bill(st, 'row'), 100);
  assert(/onclick="chitMarkPaid\('c1', 100\)"/.test(html) && !/aria-disabled|title=/.test(html), "'" + st + "': an open bill keeps the live button");
}
/* the set is the sheet's one list, the server's two ends */
assert.deepStrictEqual(['cancelled', 'rejected', 'completed', 'pending'].map((s) => globalThis.CBSheet.isDead(s)), [true, true, false, false]);
/* the two seams stay stamped: the testid on the button, one list in the sheet */
assert(!/\['cancelled', ?'rejected'\]/.test(fnSource('chitNoPayWhy') + fnSource('chitMarkPaidButton')), 'no second status list in app.html');
/* design 2 (cap-chit2.js c2SpendHTML) hands chitSpendStrip a chit-shaped object: it must carry the status, so the dead bill is disabled there too */
const c2src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-chit2.js'), 'utf8');
const c2at = c2src.indexOf('\nfunction c2SpendHTML(');
assert(c2at > 0, 'c2SpendHTML is in cap-chit2.js');
const c2rest = c2src.slice(c2at + 1);
let handed = null;
globalThis.C2 = { id: 'c1' };
globalThis.billTotalOf = () => 100;
globalThis.billNoticeHTML = () => '';
globalThis.c2CostHidden = () => false;
globalThis.chitSpendStrip = (c) => { handed = c; return chitMarkPaidButton(c, c.amt); };
eval(c2rest.slice(0, c2rest.search(/\n(?:\/\*\*|async function |function )/)) + '\nglobalThis.c2SpendHTML = c2SpendHTML;');
for (const st of ['cancelled', 'rejected']) {
  const html = c2SpendHTML({}, { current_status: st, summary_json: {} }, null);
  assert(handed._status === st && /aria-disabled="true"/.test(html) && !/onclick=/.test(html), 'design 2 ' + st + ': Mark paid disabled');
}
assert(/onclick="chitMarkPaid\('c1', 100\)"/.test(c2SpendHTML({}, { current_status: 'pending', summary_json: {} }, null)), 'design 2 open bill: live');
console.log('chit-mark-paid-dead: ok');
