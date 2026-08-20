/**
 * tests/access-events.test.cjs — the audit trail must not invent changes.
 *
 * ⚠️⚠️ THE FIRST REAL EVENTS THIS TABLE EVER RECORDED CONTAINED A FALSE ONE:
 *     break_changed | {"break_status":"active"} → {"break_status":null}
 * on a PATCH that never touched a break. `after` is the UPDATE's RETURNING row, which does not list
 * break_status, so the field was undefined — and undefined was written as null.
 *
 * ⭐ A FABRICATED ENTRY IS WORSE THAN A MISSING ONE. A gap is visibly a gap. An invented change is
 * indistinguishable from evidence, and this one would have been read as an unexplained act by whoever's name
 * sits in changed_by.
 *
 * ⚠️ AND THE FIRST VERSION OF THIS TEST PASSED VACUOUSLY. It read the action from args[3], which is
 * before_value — a JSON blob that never equals "break_changed", so every "does NOT invent…" assertion was
 * true no matter what the code did. A negative assertion against the wrong field is not a weak test, it is
 * an absent one wearing a tick. args[2] is the action; the positive case is what exposed the mistake, which
 * is the argument for always pairing a "does not" with a "does".
 */
const ev = require('../lib/access-events');

let written = [];
const fakeQuery = async (sql, args) => { written.push({ sql, args }); return { rows: [{}] }; };

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.error('  ✗ ' + n + (x ? '\n      ' + x : '')); } };

(async () => {
  console.log('\n── a field absent from the after-row is NOT a change ──');
  written = [];
  await ev.recordChanges(fakeQuery, {
    entity_id: 'e', subject_identity_id: 's', changed_by: 'c',
    before: { hat: 'act', access_level: 'editor', break_status: 'active', whole_entity: false, can_see_costs: false },
    after:  { hat: 'audit', access_level: 'commenter' },     // RETURNING carried only these two
  });
  const actions = written.map(w => w.args[2]);
  ok('records the two fields that actually moved', written.length === 2, JSON.stringify(actions));
  ok('does NOT invent break_changed',   !actions.includes('break_changed'), JSON.stringify(actions));
  ok('does NOT invent reach_changed',   !actions.includes('reach_changed'), JSON.stringify(actions));

  console.log('\n── a real change to null IS recorded ──');
  written = [];
  await ev.recordChanges(fakeQuery, {
    entity_id: 'e', subject_identity_id: 's', changed_by: 'c',
    before: { break_status: 'active' },
    after:  { break_status: null },        // present and null — genuinely cleared
  });
  ok('an explicit null still records', written.length === 1 && written[0].args[2] === 'break_changed',
     JSON.stringify(written.map(w => w.args[2])));

  console.log('\n── no movement, no events ──');
  written = [];
  await ev.recordChanges(fakeQuery, {
    entity_id: 'e', subject_identity_id: 's', changed_by: 'c',
    before: { hat: 'act', access_level: 'editor' },
    after:  { hat: 'act', access_level: 'editor' },
  });
  ok('an unchanged PATCH writes nothing', written.length === 0, JSON.stringify(written.map(w => w.args[2])));

  console.log(`\n══ ${pass} passed · ${fail} failed ══\n`);
  process.exit(fail ? 1 : 0);
})();
