/**
 * work-client.test.cjs — W16: a practice's job chit names the client it is for (lib/work-client). Offline: db.queryAsEach is a stand-in.
 *   1 clientOf: a job chit → its recipient that is not the sender, with role and period; a task or order → null
 *   2 readClients: ONE asEach trip for the distinct clients; none to read → no trip; a failed read → an empty map, not a throw
 *   3 shape: country and money from the client's books first, then its identity; name from the identity; the next return due from the pack
 * CARD  02-tasks-orders-and-workflow/tasks-and-orders-list-sheet
 */
'use strict';
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const db = require('../db');
const wc = require('../lib/work-client');
const CLIENT = '11111111-1111-4111-8111-111111111111';
(async () => {
  const job = { business_json: { job: { plug: 'task', role: 'adviser', period: 'standing' } }, all_recipients: [{ entity_id: '99999999-9999-4999-8999-999999999999', role: 'sender' }, { entity_id: CLIENT, role: 'to' }] };
  const link = wc.clientOf(job);
  ok('a job chit names its client, role and period', link && link.entity_id === CLIENT && link.role === 'adviser' && link.period === 'standing', JSON.stringify(link));
  ok('a task or an order is no job: null', wc.clientOf({ business_json: {}, all_recipients: [{ entity_id: CLIENT, role: 'to' }] }) === null && wc.clientOf(null) === null);
  let trips = 0;
  db.queryAsEach = async (ids) => { trips++; return { rows: ids.map((id) => ({ entity_id: id, setting: { country: 'in', functional_currency: 'INR', fy_start_month: 4, enabled: true }, identity: { display_name: 'Chai Corner', country: 'IN', currency_code: 'INR' } })) }; };
  const got = await wc.readClients([CLIENT, CLIENT]);
  ok('the distinct clients are read in ONE trip', trips === 1 && got.size === 1 && got.get(CLIENT).identity.display_name === 'Chai Corner');
  ok('nothing to read, no trip', (await wc.readClients([])).size === 0 && trips === 1);
  db.queryAsEach = async () => { throw new Error('boom'); };
  ok('fail-closed: a failed read is an empty map and a row with no client facts, never a throw', (await wc.readClients([CLIENT])).size === 0);
  const shaped = wc.shape(link, got.get(CLIENT), '2026-11-19');
  ok('shape: name, country in capitals, the client\'s money, the job\'s period', shaped.name === 'Chai Corner' && shaped.country === 'IN' && shaped.currency === 'INR' && shaped.role === 'adviser' && shaped.period === 'standing', JSON.stringify(shaped));
  ok('shape: the next return due comes from the pack (a date, days away)', shaped.due && /^\d{4}-\d{2}-\d{2}$/.test(shaped.due.due_date) && typeof shaped.due.due_in_days === 'number', JSON.stringify(shaped.due));
  const bare = wc.shape(link, { setting: null, identity: { display_name: 'Bare Co', country: 'au', currency_code: 'AUD' } }, '2026-11-19');
  ok('books off: country and money from the identity, nothing due', bare.country === 'AU' && bare.currency === 'AUD' && bare.due === null, JSON.stringify(bare));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
