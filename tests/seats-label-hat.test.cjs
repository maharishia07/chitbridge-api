'use strict';
/**
 * seats-label-hat.test.cjs — DECISIONS 22 Nov item 5(b): choosing the Bookkeeper or Accountant label in Add staff SETS the manager hat, so the label and the access agree.
 * HAND-COMPUTED  label Bookkeeper / Accountant / " book-keeper " at editor level -> hat manager (the RC-7 in-house accountant: lib/owner.isInHouseAccountant); the same label at viewer or commenter level -> no change
 *                (a read-only person gets no hat); any other label (Cashier, a longer sentence) -> no change. Fails on the parent: lib/access.labelHat did not exist and the INSERT wrote the body's hat (act).
 * Offline: the helper, and the route's own INSERT (it binds the helper's hat, not the raw body hat). Run: node tests/seats-label-hat.test.cjs
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
ok(/const hat = access\.labelHat\(actor_role, access_level\) \|\| list;/.test(src) && /max_tasks,\s*hat,\s*employee_id/.test(src), 'POST /api/actors stores the helper hat (the label), not only the hat the screen sent');
console.log(n + ' checks passed');
