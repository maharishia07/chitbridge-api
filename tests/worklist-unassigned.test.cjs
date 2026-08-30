/**
 * tests/worklist-unassigned.test.cjs — work nobody has picked up must appear on the worklist.
 *
 * ⚠️⚠️ THE JOIN RAN THE WRONG WAY AND HID THE MOST URGENT WORK. Athi, 2026-08-30, looking at
 * Everyone's work: "we have to bring the rest which is not assigned as well. which is not visible now."
 * byPerson() read FROM chit_line_assignment JOIN chit_line, so a line existed on that screen only if
 * somebody had already created an assignment row for it. Two different absences, one of them invisible:
 *
 *   assignment row with assignee NULL  ->  showed as "Unassigned"   (b143's deliberate un-assign)
 *   NO assignment row at all           ->  INVISIBLE                (nobody has picked it up yet)
 *
 * The second is the common case: a line captured from WhatsApp has never been assigned to anyone.
 *
 * ⭐ No client change was needed — the grouping already keys on assignee_actor_id || '__unassigned__'
 * and the worklist already sorts that bucket last and greys it. This pins the SQL that feeds it.
 */
const API = 'C:/dev/chitbridge-api';

let sql = '';
require.cache[require.resolve(API + '/db')] = { exports: {
  withEntity: async (id, fn) => fn({ query: async (text) => { sql = String(text); return { rows: ROWS }; } }),
  onEntity:   async (id, db, fn) => fn({ query: async (text) => { sql = String(text); return { rows: ROWS }; } }),
  query:      async () => ({ rows: [] }),
} };

let ROWS = [];
const { byPerson } = require(API + '/lib/assign');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};
const flat = () => sql.replace(/\s+/g, ' ');

(async () => {
  console.log('\n-- ⭐⭐ the line drives the query, not the assignment --');
  ROWS = [];
  await byPerson('e1');
  t('reads FROM chit_line', /FROM chit_line l/.test(flat()));
  t('and LEFT JOINs the assignment', /LEFT JOIN latest a ON/.test(flat()));
  /* ⚠️ The old shape. If either of these comes back, unassigned work is invisible again. */
  t('no longer reads FROM latest', !/FROM latest a/.test(flat()));
  t('no longer INNER JOINs chit_line', !/(^|[^T])JOIN chit_line l ON/.test(flat()));

  console.log('\n-- the keys come from the line, which is always present --');
  t('selects l.chit_id / l.line_id', /l\.chit_id, l\.line_id/.test(flat()));
  t('delivered is measured off the line', /chit_line_delivered_qty\(l\.chit_id, l\.line_id\)/.test(flat()));
  t('seq survives a missing assignment', /COALESCE\(a\.seq, 0\) AS seq/.test(flat()));
  t('entity scope moved to the WHERE', /WHERE l\.entity_id = \$1/.test(flat()));

  console.log('\n-- ⚠️ a draft has lines and is NOT work --');
  /* chit_deliver() writes chit_line rows for drafts too (mint passes is_draft as p_clear_first), and a
     draft's status is not one of the three closed ones — so without this every unsent draft would walk
     onto the worklist as work somebody owes. */
  t('drafts are excluded', /COALESCE\(h\.is_draft, false\) = false/.test(flat()));
  t('and the header lateral fetches is_draft', /sender_entity_display_name, is_draft/.test(flat()));
  t('closed chits are still excluded', /NOT IN \('completed', 'cancelled', 'rejected'\)/.test(flat()));

  console.log('\n-- ⭐⭐ a line with NO assignment lands in the Unassigned bucket --');
  ROWS = [
    { assignee_actor_id: 'a1', assignee_name: 'Mani', chit_id: 'c1', line_id: 'l1', seq: 10,
      particulars: 'brake pads', quantity: 2, delivered: 0, state: 'open' },
    /* the row a LEFT JOIN produces when nobody has picked the line up */
    { assignee_actor_id: null, assignee_name: null, chit_id: 'c2', line_id: 'l2', seq: 0,
      particulars: 'AC gas refill', quantity: 1, delivered: 0, state: 'open' },
  ];
  const r = await byPerson('e1');
  const names = r.people.map((p) => p.name);
  t('both buckets exist', r.people.length === 2, names.join(' | '));
  t('the unpicked line is named "Unassigned"', names.includes('Unassigned'), names.join(' | '));
  const un = r.people.find((p) => p.name === 'Unassigned');
  t('it carries the line, not an empty group', un && un.lines.length === 1 && un.lines[0].particulars === 'AC gas refill');
  t('its actor_id is null, so the client can tell', un && un.actor_id === null);
  t('and it counts', un && un.count === 1);
  /* ⚠️ Athi, 2026-08-30: "keep it last for now." NULL sorts last via assignee_name NULLS LAST in SQL,
     and the client pins the key last again — this asserts the SQL half. */
  t('SQL sorts unassigned last', /ORDER BY a\.assignee_name NULLS LAST/.test(flat()));

  console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
  process.exitCode = fail ? 1 : 0;
})();
