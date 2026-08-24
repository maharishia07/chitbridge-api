/**
 * tests/line-complete.test.cjs — A LINE THAT ASKED FOR NOTHING IS NOT DONE.
 *
 * Athi, 2026-08-24, looking at a WhatsApp job in design 2: *"just the status alone appearing as done."*
 *
 * ⚠️⚠️ TWO OF ITS SEVEN LINES SAID **done** AND NOBODY HAD TOUCHED THEM. `oil change` and `filter change`
 * came out of the message reader with `ordered = 0`, the rule was `delivered >= ordered`, and `0 >= 0` is
 * true — so both were VACUOUSLY complete from the moment the chit was created, and the chit header counted
 * them: "2 of 7 lines delivered".
 *
 * ⭐ That is the worst direction for this bug to point. "Nothing was ordered" and "the work is finished" are
 * opposite facts, and the screen showed the second one. A shop reading that job would skip two complaints
 * believing them handled.
 *
 * ⭐ `progress()` takes pre-read rows, so this needs no database at all — the rule is arithmetic and is
 * tested as arithmetic.
 */
const deliverline = require('../lib/deliverline');

let pass = 0;
let fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};

/* One row per line, in the shape progress() reads: the ordered quantity plus any delivery events. */
const line = (line_id, ordered, delivered) => ({
  line_id, seq: 1, particulars: line_id, ordered_unit: 'job', ordered, removed: false,
  delivery_id: delivered == null ? null : line_id + '-d',
  dq: delivered, du: 'job', damount: null, dkind: null, dparticulars: null,
  recorded_by_entity_id: 'e1', delivered_at: '2026-08-24T00:00:00Z',
});

(async () => {
  console.log('\n── when is a line complete ──');
  const rows = [
    line('zero-nothing', 0, null),        // asked for nothing, nobody did anything  ← the bug
    line('zero-done', 0, 1),              // asked for nothing, someone recorded work
    line('null-nothing', null, null),     // no quantity at all, nothing done
    line('normal-part', 5, 2),            // ordinary, half delivered
    line('normal-done', 5, 5),            // ordinary, finished
  ];
  const m = await deliverline.progress('e1', 'c1', null, rows);
  const c = (id) => (m.get(id) || {}).complete;

  t('a line ordered 0 with nothing delivered is NOT done', c('zero-nothing') === false,
    'this is the one that read "done" on a job nobody had touched');
  t('a line ordered 0 becomes done once something is recorded', c('zero-done') === true);
  t('a line with no quantity and nothing done is not done', c('null-nothing') === false);
  t('an ordinary part-delivered line is not done', c('normal-part') === false);
  t('an ordinary fully delivered line IS done', c('normal-done') === true);

  /* ⚠️ And the header must agree — it counts the same flag, so a vacuous complete inflated "n of m". */
  const s = deliverline.summarise(m);
  t('the roll-up counts only genuinely finished lines', s.complete === 2, s.complete + ' of ' + s.lines);

  console.log(`\n  ${pass} passed · ${fail} failed\n`);
  process.exitCode = fail ? 1 : 0;
})();
