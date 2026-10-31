/**
 * chit-crossing.test.cjs - lib/chit-crossing.js, lifted out of routes/chits.js with moveStatus (LEAN-PLAN §8 #3).
 *   definersReady: false until the b50 functions are seen, then latched; crossing/crossingIn: the definer when ready, the legacy
 *   fallback when not (fail closed - never a half-applied write); postMessageCopies: the 10-arg deliver, the 9-arg retry ONLY
 *   when no line was named (a line-scoped message is refused, never posted without its line). Offline: db stubbed.
 *   Run: node tests/chit-crossing.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

let probeAnswer = [{ ok: false }];
let probeThrows = false;
const asked = [];
let deliverFails = null;
require.cache[require.resolve(path.join(API, 'db'))] = { exports: {
  query: async () => { if (probeThrows) throw new Error('db down'); return { rows: probeAnswer }; },
  withEntity: async (entity, fn) => fn({ query: async (sql, params) => {
    asked.push({ entity, sql: String(sql), params });
    if (/chit_message_deliver\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10\)/.test(sql) && deliverFails) throw deliverFails;
    return { rows: [{ created_at: '2026-10-31T00:00:00.000Z' }] };
  } }),
} };

(async () => {
  const X = require(path.join(API, 'lib', 'chit-crossing'));
  const msg = { chit_id: 'c1', sender_entity_id: 'e1', sender_display_name: 'Shop', thread_type: 'external', message_text: 'hello' };

  probeThrows = true;
  ok('definersReady: an unreadable probe answers false (fails closed to the legacy path, never throws)', (await X.definersReady()) === false);
  probeThrows = false;
  ok('definersReady: the functions are not there yet -> false', (await X.definersReady()) === false);

  let legacy = 0;
  await X.crossing('e1', 'SELECT chit_log_all($1)', ['c1'], async () => { legacy++; return { rows: [] }; });
  ok('crossing: before the migration the legacy fallback runs, the definer is not asked', legacy === 1 && !asked.some((a) => /chit_log_all/.test(a.sql)));

  const first = await X.postMessageCopies(msg);
  /* RAIL-106 (sit/run6): after the deliver, onMessagePosted reads the parties to queue the return-path event, so the deliver is found by its SQL, not as the last query */
  const delivers = () => asked.filter((q) => /chit_message_deliver/.test(q.sql));
  const lastDeliver = () => delivers()[delivers().length - 1];
  ok('postMessageCopies: a message goes through the 10-arg deliver with the sender as the entity context', /chit_message_deliver\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10\)/.test(lastDeliver().sql) && lastDeliver().entity === 'e1' && !!first.message_id && first.created_at === '2026-10-31T00:00:00.000Z');

  deliverFails = Object.assign(new Error('no function'), { code: '42883' });
  asked.length = 0;
  await X.postMessageCopies(msg);
  ok('postMessageCopies: a chit-level message retries the 9-arg form when the 10-arg function is not there yet', delivers().length === 2 && !/\$10/.test(delivers()[1].sql));

  asked.length = 0;
  let refused = null;
  try { await X.postMessageCopies(Object.assign({}, msg, { line_id: 'L1' })); } catch (e) { refused = e; }
  ok('postMessageCopies: a LINE-scoped message is refused (thrown), never posted without its line', refused && refused.code === '42883' && asked.length === 1);

  probeAnswer = [{ ok: true }];
  ok('definersReady: the functions are seen -> true', (await X.definersReady()) === true);
  probeAnswer = [{ ok: false }];
  ok('definersReady: once seen it stays true (latched; the probe is not asked again)', (await X.definersReady()) === true);
  asked.length = 0;
  legacy = 0;
  await X.crossing('e1', 'SELECT chit_log_all($1)', ['c1'], async () => { legacy++; return { rows: [] }; });
  ok('crossing: once the definers are there the definer runs and the fallback does not', legacy === 0 && asked.length === 1 && /chit_log_all/.test(asked[0].sql));

  console.log('\n  ' + (pass + fail) + ' checks · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
