/**
 * seat-rule.cjs — THE ONE SEAT RULE (CBBooksGrantApi.doorsFor, firm frame P0 T4/T5), no browser: the five fixtures of the critic's section 4 plus the deep-link cause.
 * Doors are the client's live grants whose row says may_use (the server's mayUseGrant); one door or one held seat = no sheet; a stored seat that is no door is dropped; an older api without may_use / seats behaves as before.
 *   node e2e/seat-rule.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const box = {}; vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'books-grant-api.js'), 'utf8'), box);
const rule = box.CBBooksGrantApi.doorsFor;
assert.strictEqual(typeof rule, 'function');
const row = (preset, may) => Object.assign({ preset, state: 'live' }, may === undefined ? {} : { may_use: may });
let n = 0;
const ok = (name, cond) => { assert(cond, name); n += 1; console.log('  ok ' + name); };
const split = (seats, mine) => ({ seats: { C: seats }, mine });
let d = rule(split({ auditor: row('auditor', true), adviser: row('adviser', false) }, ['auditor']), 'C', '');
ok('aud1 (auditor seat): the adviser grant is not a door; one door opens straight, no sheet', d.open === 'auditor' && !d.ask);
d = rule(split({ auditor: row('auditor', true), adviser: row('adviser', true) }, ['adviser']), 'C', '');
ok('acct1 (accountant seat, W12 both doors usable): holds one seat, opens it, no sheet', d.open === 'adviser' && !d.ask);
d = rule(split({ auditor: row('auditor', true), adviser: row('adviser', true) }, ['adviser', 'auditor']), 'C', '');
ok('the firm owner (both seats, two doors): the sheet', d.ask === true && d.doors.length === 2);
d = rule(split({ auditor: row('auditor', true), adviser: row('adviser', true) }, ['adviser', 'auditor']), 'C', 'auditor');
ok('the owner with a stored seat that is still a door: opens it', d.open === 'auditor' && !d.ask);
d = rule(split({ auditor: row('auditor', false) }, ['adviser']), 'C', 'auditor');
ok('a stored seat the server now refuses is dropped (stale) and nothing opens', d.stale === true && d.refused === true);
d = rule(split({ auditor: row('auditor', true), adviser: row('adviser', false) }, ['adviser', 'auditor']), 'C', 'adviser');
ok('stored seat not a door: stale, the one door opens', d.stale === true && d.open === 'auditor');
d = rule(split({}, ['auditor']), 'C', '');
ok('no live grant for the client: refused', d.refused === true);
d = rule({ seats: { C: { auditor: row('auditor'), adviser: row('adviser') } }, mine: null }, 'C', '');
ok('older api (no may_use, no seats): behaves as before, both doors, the sheet', d.ask === true);
d = rule({ seats: { C: { auditor: row('auditor') } } }, 'C', '');
ok('one grant, older api: opens it', d.open === 'auditor');
d = rule(undefined, 'C', '');
ok('nothing known: refused, never throws', d.refused === true);
console.log('\n  ✓ ' + n + ' passed');
