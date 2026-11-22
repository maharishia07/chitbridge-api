'use strict';
/**
 * seats-label-hat.test.cjs — DECISIONS 22 Nov item 5(b): choosing the Bookkeeper or Accountant label in Add staff SETS the manager hat, so the label and the access agree. SHOP ONLY (least privilege).
 * HAND-COMPUTED  label Bookkeeper / Accountant / " book-keeper " at editor level -> hat manager (the RC-7 in-house accountant: lib/owner.isInHouseAccountant); the same label at viewer or commenter level -> no change
 *                (a read-only person gets no hat); any other label (Cashier, a longer sentence) -> no change. In a SHOP the route gives manager; in a FIRM (practice) or when the practice read could not tell, the hat sent stands.
 *                Fails on the parent: lib/access.labelHat did not exist and the INSERT wrote the body's hat (act).
 * Offline: the helper, and the route's own two lines run with a stand-in for the practice read. Run: node tests/seats-label-hat.test.cjs
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const access = require('../lib/access');
const owner = require('../lib/owner');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
ok(['Bookkeeper', 'Accountant', ' book-keeper ', 'ACCOUNTANT'].every((l) => access.labelHat(l, access.EDITOR) === 'manager'), 'Bookkeeper / Accountant label at editor level gives the manager hat');
ok(access.labelHat('Bookkeeper', access.VIEWER) === null && access.labelHat('Accountant', access.COMMENTER) === null, 'a read-only level gets no hat from the label');
ok(['Cashier', 'Senior accountant to the owner', '', null, undefined].every((l) => access.labelHat(l, access.EDITOR) === null), 'any other label changes nothing');
const seat = { identity: { identity_type: 'actor', parent_entity_id: 'shop', hat: access.labelHat('Bookkeeper', access.EDITOR), access_level: 'editor' } };
ok(owner.isInHouseAccountant(seat) === true, 'the hat the label gives IS the in-house accountant seat the money doors ask for');
const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'actors.js'), 'utf8');
const lines = src.split('\n');
const askedLine = lines.find((l) => l.includes('const asked = access.labelHat(')).split(' /*')[0].trim();
const hatLine = lines.find((l) => l.includes('const hat = (asked')).split(' /*')[0].trim();
ok(/max_tasks,\s*hat,\s*employee_id/.test(src), 'POST /api/actors stores the label hat: the INSERT binds hat');
/* the route's own two lines, with the require of lib/people replaced by a stand-in practice read */
const body = [askedLine, hatLine].join('\n').split("require('../lib/people').practiceOf").join('practiceOf');
const run = (practice, label) => Function('access', 'practiceOf', 'req', 'entity_id', 'actor_role', 'access_level', 'list', '"use strict"; return (async () => { ' + body + ' return hat; })()')(access, async () => practice, { identity: { identity_id: 'x' } }, 'e', label, 'editor', 'act');
(async () => {
  ok((await run(false, 'Accountant')) === 'manager', 'a SHOP typing Job Accountant gets the manager hat');
  ok((await run(true, 'Accountant')) === 'act', 'a FIRM (practice) typing Job Accountant keeps the hat it sent');
  ok((await run(null, 'Bookkeeper')) === 'act', 'a practice read that could not tell keeps the hat sent (least privilege)');
  ok((await run(false, 'Cashier')) === 'act', 'another Job changes nothing in a shop');
  console.log(n + ' checks passed');
})();
