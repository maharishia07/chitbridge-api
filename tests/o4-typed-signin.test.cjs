'use strict';
/**
 * o4-typed-signin.test.cjs — O4 (Athi 28 Nov): a screen shows a staff sign-in name as it is TYPED (`name@shop`), never the stored `name@shop.br` / `.cr`.
 * OWNS      the guard on the api side: handle.typedForm is the one function; people.view sends it as `sign_in_as`; no display field the screens read
 *           (sign_in_as, login_format) carries a `@…br` / `@…cr` handle. The stored `user_id` stays (internal key). Offline, no db.
 * CALLED BY scripts/guards-list-1.cjs · CI.   Web side: chitbridge-web tests/o4-typed-signin.test.cjs + e2e/walk-employees.cjs (rendered text).
 * CARD      17-people-employees-hr-and-payroll/functions
 */
const assert = require('assert'), path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const H = require('../lib/handle'), people = require(path.join(__dirname, '..', 'lib', 'people'));
let n = 0;
const ok = (c, what) => { assert(c, what); n++; console.log('  ok  ' + what); };
const HANDLE = /@[^@.\s]+\.(br|cr)\b/i;
const walk = (v, out = []) => (v && typeof v === 'object' ? Object.entries(v).forEach(([k, x]) => (typeof x === 'string' ? out.push([k, x]) : walk(x, out))) : null, out);

ok(H.typedForm('ravi@acme.br') === 'ravi@acme' && H.typedForm('9876@acme.cr') === '9876@acme' && H.typedForm('x=g.com@s.cr') === 'x=g.com@s', 'typedForm strips the kind suffix (.br staff, .cr customer)');
ok(H.typedForm('ravi@acme') === 'ravi@acme' && H.typedForm('a@firm.co.cr') === 'a@firm.co.cr' && H.typedForm(null) === '', 'a typed name, a real country-domain address and null come back unchanged');
const row = (o) => Object.assign({ identity_id: 'a1', display_name: 'Ravi', actor_key: 'ravik', user_id: 'ravik@shop.br', actor_role: 'Cashier', hat: 'act', break_status: 'active', access_level: 'editor', whole_entity: false, has_email: true, entity_handle: 'shop' }, o);
const view = people.view([row({}), row({ identity_id: 'a2', actor_key: 'meena', user_id: null }), row({ identity_id: 'a3', actor_key: 'latha', user_id: 'latha@shop' })], { owner: true });
const shown = walk(view.people).filter(([k]) => k === 'sign_in_as' || k === 'login_format');
ok(shown.length === 3 && shown.every(([, v]) => v && !HANDLE.test(v)), 'GET /api/people: every sign_in_as is present and carries no @…br / @…cr handle (' + shown.map((s) => s[1]).join(', ') + ')');
ok(view.people[0].user_id === 'ravik@shop.br', 'the stored user_id is untouched (internal key; login tests unchanged)');
console.log(n + ' checks passed');
