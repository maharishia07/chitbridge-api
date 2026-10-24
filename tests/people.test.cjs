'use strict';
/**
 * tests/people.test.cjs — P1: GET /api/people and lib/people.js. No DB, no network.
 *  · the pure view: owner may everything that is possible; a person who is off cannot be given a code or a cover; a non-owner is greyed WITH the sentence
 *  · the route: ONE statement (one trip), scoped to the caller's SHOP (an actor's parent, never their own id — the RLS/tenant rule), removed people never listed
 */
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '   ' + extra : '')); } };

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const people = require(path.join(API, 'lib', 'people'));

const row = (o) => Object.assign({ identity_id: 'a1', display_name: 'Ravi Kumar', actor_key: 'ravik', user_id: 'ravik@shop.br', actor_role: 'Cashier', phone: null,
  hat: 'act', break_status: 'active', can_see_costs: false, current_task_count: 0, last_active_at: null, delegate_actor_id: null,
  access_level: 'editor', whole_entity: false, has_email: true, entity_handle: 'shop' }, o);
const rows = [row({}), row({ identity_id: 'a2', display_name: 'Meena', actor_key: 'meena', user_id: null, break_status: 'deactivated' }),
              row({ identity_id: 'a3', display_name: 'Latha', actor_key: 'latha', access_level: 'viewer', hat: 'view_only', delegate_actor_id: 'a1' })];

/* ── the pure view ── */
const v = people.view(rows, { owner: true });
t('three people, two on, one off', v.people.length === 3 && v.counts.on === 2 && v.counts.off === 1);
t('owner may add', v.may.add.ok === true);
const [ravi, meena, latha] = v.people;
t('the stored user id is shown as it is', ravi.user_id === 'ravik@shop.br');
t('a missing user id falls back to key@shop.br', meena.user_id === 'meena@shop.br');
t('the level reads in shop words', ravi.access.label === 'Counter staff' && latha.access.label === 'View-only');
t('an off person: switch is "on", code and cover are greyed with a sentence', meena.may.switch.to === 'on' && meena.may.switch.ok && !meena.may.reset_pin.ok && !!meena.may.reset_pin.why && !meena.may.cover.ok && !!meena.may.cover.why);
t('an on person: switch is "off"', ravi.may.switch.to === 'off' && ravi.may.switch.ok);
t('cover options are other editors who are on (not self, not the off, not a viewer)', ravi.cover_options.length === 0 && !ravi.may.cover.ok && ravi.may.cover.why === 'No one else to stand in.' && latha.cover_options.map((o) => o.id).join() === 'a1');
t('who stands in is named', latha.cover && latha.cover.name === 'Ravi Kumar');
t('the picker choices are the IAM presets', v.access_choices.length === require(path.join(API, 'lib', 'access')).PRESETS.length && v.access_choices.every((c) => c.key && c.label && c.level));
const nonOwner = people.view(rows, { owner: false });
t('a non-owner is greyed with the owner-only sentence on every action', nonOwner.may.add.ok === false && nonOwner.may.add.why === people.OWNER_ONLY
  && nonOwner.people.every((p) => ['access', 'email', 'reset_pin', 'switch', 'cover'].every((k) => p.may[k].ok === false && p.may[k].why === people.OWNER_ONLY)));
t('switch keeps its direction even when greyed', nonOwner.people[1].may.switch.to === 'on');
/* SEC2 · PEOPLE-EMAIL: the owner sees the address and may change it; a colleague sees only whether one is on file */
const withMail = (o) => people.view([row({ email: 'ravi@shop.test', has_email: true })], o).people[0];
t('owner: email is shown and may.email is open', withMail({ owner: true }).email === 'ravi@shop.test' && withMail({ owner: true }).may.email.ok === true);
t('colleague: email is null, has_email says one is on file', withMail({ owner: false }).email === null && withMail({ owner: false }).has_email === true);
process.env.NODE_ENV = 'production';
const sealed = require(path.join(API, 'lib', 'dev-otp')).isSealed();
if (sealed) {
  t('R112 sealed with no e-mail: reset is OPEN (the owner is shown the code)', people.view([row({ has_email: false })], { owner: true }).people[0].may.reset_pin.ok === true);
  t('R112 sealed with an e-mail and no sender: reset is greyed with the refusal sentence', (() => { const g = people.view([row({ has_email: true })], { owner: true }).people[0].may.reset_pin; return g.ok === false && /e-mail sender/.test(g.why); })());
}
else console.log('  note sealed-environment case is not reachable here');
/* CX6 (E1): every pack lists payroll as out of scope — the line is said for IN, AU, AE and an unknown country; the shop row with no people is not a person */
for (const c of ['IN', 'AU', 'AE', null]) t('payroll said for ' + (c || 'no country'), people.view([], { owner: true, country: c }).payroll.said === people.payrollWord('IN').said && people.view([], { owner: true, country: c }).payroll.here === false);
t('the line names no country and no statute', !/India|Australia|UAE|PAYG|ESI/.test(people.payrollWord('AU').said));
process.env.NODE_ENV = 'test';

/* ── R112: the list line reads the code_issued trail row; the owner sees it, a colleague does not ── */
const given = row({ code_at: new Date('2026-10-24T09:00:00Z'), code_by: 'Anil', code_channel: 'screen' });
t('R112 code_given: who, when and how, for the owner', JSON.stringify(people.view([given], { owner: true }).people[0].code_given) === JSON.stringify({ by: 'Anil', at: given.code_at, channel: 'screen' }));
t('R112 code_given: null for a colleague, and null when no code was ever given', people.view([given], { owner: false }).people[0].code_given === null && people.view([row({})], { owner: true }).people[0].code_given === null);

/* ── the route ── */
const seen = [];
const dbPath = require.resolve(path.join(API, 'db'));
const realDb = require(dbPath);
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: Object.assign({}, realDb, {
  query: async (sql, params) => { seen.push({ sql: String(sql), params }); return { rows }; },
  readBatch: async (entity, actor, stmts) => stmts.map((x) => { seen.push({ sql: String(x.text), params: x.params, entity, actor }); return { rows }; }) }) };
let who = { identity_id: 'e1', identity_type: 'entity' };
const authPath = require.resolve(path.join(API, 'middleware', 'auth'));
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: Object.assign(
  (req, res, next) => { req.identity = who; next(); },
  { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id }) };
const express = require('express');
const app = express();
app.use('/api/people', require(path.join(API, 'routes', 'people')));
const srv = app.listen(0, '127.0.0.1', async () => {
  const get = async () => { const r = await fetch('http://127.0.0.1:' + srv.address().port + '/api/people'); return { status: r.status, body: await r.json() }; };
  try {
    let r = await get();
    t('owner: 200 with people', r.status === 200 && r.body.people.length === 3 && r.body.may.add.ok === true);
    t('ONE statement for the whole list (one trip)', seen.length === 1);
    t('scoped to the shop by parent_entity_id', /e\.identity_id = \$1/.test(seen[0].sql) && /i\.parent_entity_id = e\.identity_id/.test(seen[0].sql) && seen[0].params[0] === 'e1');
    t('CX6: the shop\'s country rides the same statement; payroll is said', /e\.country AS entity_country/.test(seen[0].sql) && r.body.payroll && r.body.payroll.here === false && !!r.body.payroll.said);
    t('R112: the code_issued trail rides the SAME statement (one join, no extra trip), read in the shop scope', /LEFT JOIN LATERAL/.test(seen[0].sql) && /action = 'code_issued'/.test(seen[0].sql) && seen[0].entity === 'e1');
    t('removed people are never listed', /IS DISTINCT FROM 'removed'/.test(seen[0].sql));
    t('people only (not connectors)', /actor_type, 'human'\) = 'human'/.test(seen[0].sql));
    seen.length = 0;
    const ra = await (await fetch('http://127.0.0.1:' + srv.address().port + '/api/people?for=add')).json();
    t('?for=add: owner gets may.add + the picker, no people, no query', ra.may.add.ok === true && ra.access_choices.length > 0 && !ra.people && seen.length === 0);
    seen.length = 0; who = { identity_id: 'a9', identity_type: 'actor', parent_entity_id: 'e7' };
    r = await get();
    t('a colleague reads the list of THEIR shop, never their own id', seen[0].params[0] === 'e7');
    const rb = await (await fetch('http://127.0.0.1:' + srv.address().port + '/api/people?for=add')).json();
    t('?for=add: a person is refused WITH the owner-only sentence (the server answers why)', rb.may.add.ok === false && rb.may.add.why === people.OWNER_ONLY && seen.length === 1);
    seen.length = 0;
    t('and every action is greyed for them', r.body.may.add.ok === false && r.body.people.every((p) => !p.may.access.ok));
  } catch (e) { fail++; console.log('  FAIL route ran  ' + (e && e.stack)); }
  srv.close(); console.log(`\n  ${pass} checks · ${fail} failed\n`); process.exitCode = fail ? 1 : 0; setTimeout(() => process.exit(fail ? 1 : 0), 50).unref();
});
