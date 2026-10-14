/**
 * tests/assign-merge-patch.test.cjs — LM1 (T1-ORD, 2026-10-14): a line edit changes ONLY the fields it sends.
 *   node tests/assign-merge-patch.test.cjs                       — offline: the statement and its "sent" flags
 *   ASSIGN_PG_URL=postgres://… node tests/assign-merge-patch.test.cjs — also on a real Postgres (a throwaway table)
 *
 * ⚠️ THE DEFECT: lib/assign.js bound `r.task ? … : null` for every field, so reassigning a line from the Task sheet (who + state
 * only) appended a row with task, due date and note NULL — the edit ERASED them — and an unsent `state` reopened a done line.
 * The table is append-only, so a merge-patch means: a key left out carries the previous row's value; a key sent as null clears it.
 */
const path = require('path');
const API = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

let runner = null;   /* (text, params) → { rows } — the stub records, the real one queries */
const calls = [];
require.cache[require.resolve(API + '/db')] = { exports: {
  withEntity: async (id, fn) => fn({ query: (text, params) => runner(text, params) }),
  onEntity:   async (id, db, fn) => fn({ query: (text, params) => runner(text, params) }),
  query:      async () => ({ rows: [] }),
} };
const { assign, current } = require(API + '/lib/assign');

const C = '11111111-1111-4111-8111-111111111111', E = '22222222-2222-4222-8222-222222222222';
const L = '33333333-3333-4333-8333-333333333333', A1 = '44444444-4444-4444-8444-444444444444', A2 = '55555555-5555-4555-8555-555555555555';
const FIELDS = ['assignee_name', 'assignee_type', 'task', 'due_date', 'note'];

(async () => {
  console.log('\n-- offline: each field is flagged sent / not sent, and an unsent one reads the previous row --');
  runner = async (text, params) => { calls.push({ text: String(text), params }); return { rows: [{ line_id: L, seq: 2 }] }; };
  await assign(E, C, [{ line_id: L, assignee_actor_id: A1 }]);
  const one = calls.pop(), sql = one.text.replace(/\s+/g, ' ');
  for (const [i, f] of FIELDS.entries()) t(f + ' left out → its flag is false', one.params[11 + i] === false, JSON.stringify(one.params));
  t('state left out → its flag is false', one.params[16] === false);
  t('task falls back to the previous row', /WHEN \$14::boolean THEN \$7::text ELSE p\.task END/.test(sql));
  t('due_date falls back to the previous row', /WHEN \$15::boolean THEN \$8::date ELSE p\.due_date END/.test(sql));
  t('note falls back to the previous row', /WHEN \$16::boolean THEN \$9::text ELSE p\.note END/.test(sql));
  t('state falls back to the previous row (never a silent reopen)', /WHEN \$17::boolean THEN \$18::text ELSE COALESCE\(to_jsonb\(p\)->>'state', 'open'\)/.test(sql));
  t('the previous row is the latest seq of THIS line, in the same statement', /ORDER BY seq DESC LIMIT 1\) p ON true/.test(sql) && /line_id=\$3::uuid/.test(sql));
  await assign(E, C, [{ line_id: L, assignee_actor_id: A1, assignee_name: 'M', assignee_type: 'human', task: null, due_date: '2026-10-20', note: 'x', state: 'done' }]);
  const two = calls.pop();
  for (const [i, f] of FIELDS.entries()) t(f + ' sent → its flag is true', two.params[11 + i] === true);
  t('a task sent as null clears it (value null, flag true)', two.params[6] === null && two.params[13] === true);
  t('state sent → flag true, value done', two.params[16] === true && two.params[17] === 'done');

  console.log('\n-- the pre-b153 retry (no state column) merges the same way --');
  runner = async (text, params) => {
    calls.push({ text: String(text), params });
    if (/assigned_by_name, state\)/.test(text)) { const e = new Error('column "state" does not exist'); e.code = '42703'; throw e; }
    return { rows: [{ line_id: L, seq: 2 }] };
  };
  await assign(E, C, [{ line_id: L, assignee_actor_id: A1 }]);
  const retry = calls.pop();
  t('the retry carries the five flags', retry.params.length === 16 && retry.params.slice(11).every((x) => x === false));
  t('the retry reads the previous task', /ELSE p\.task END/.test(retry.text));

  const URL = process.env.ASSIGN_PG_URL;
  if (URL) {
    console.log('\n-- on a real Postgres --');
    const { Client } = require('pg'); const pg = new Client({ connectionString: URL }); await pg.connect();
    await pg.query('DROP TABLE IF EXISTS chit_line_assignment');
    await pg.query(`CREATE TABLE chit_line_assignment (assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chit_id uuid NOT NULL, entity_id uuid NOT NULL,
      line_id uuid NOT NULL, seq integer NOT NULL, assignee_actor_id uuid, assignee_name text, assignee_type text, task text, due_date date, note text,
      assigned_by_actor_id uuid, assigned_by_name text, state text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now())`);
    runner = (text, params) => pg.query(text, params);
    const now = async () => (await current(E, C)).get(L);
    await assign(E, C, [{ line_id: L, assignee_actor_id: A1, assignee_name: 'Murugan', assignee_type: 'human', task: 'pack', due_date: '2026-10-20', note: 'fragile' }]);
    await assign(E, C, [{ line_id: L, assignee_actor_id: A1, state: 'done' }]);
    let r = await now();
    t('mark-done keeps the task', r.task === 'pack', r.task);
    t('mark-done keeps the due date', r.due_date === '2026-10-20', r.due_date);
    t('mark-done keeps the note', r.note === 'fragile', r.note);
    t('mark-done keeps the holder\'s name', r.assignee_name === 'Murugan' && r.assignee_type === 'human');
    t('and is done', r.state === 'done');
    await assign(E, C, [{ line_id: L, assignee_actor_id: A2, assignee_name: 'Selvam' }]);
    r = await now();
    t('a reassign without state keeps it done', r.state === 'done', r.state);
    t('a reassign keeps task / due / note', r.task === 'pack' && r.due_date === '2026-10-20' && r.note === 'fragile');
    t('a new holder never inherits the old type', r.assignee_name === 'Selvam' && r.assignee_type === null, r.assignee_type);
    await assign(E, C, [{ line_id: L, assignee_actor_id: A2, task: null, state: 'open' }]);
    r = await now();
    t('a task sent as null clears only the task', r.task === null && r.note === 'fragile' && r.due_date === '2026-10-20');
    t('reopen is explicit', r.state === 'open');
    await assign(E, C, [{ line_id: L, assignee_actor_id: null }]);
    r = await now();
    t('unassign clears the name, keeps the work', r.assignee_name === null && r.assignee_actor_id === null && r.note === 'fragile');
    t('seq keeps counting', r.seq === 5, String(r.seq));
    await pg.query('DROP TABLE chit_line_assignment'); await pg.end();
  } else console.log('\n  (ASSIGN_PG_URL not set — the real-Postgres half skipped)');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
