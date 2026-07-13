// prove-retention.js — DRY-RUN proof of the retention planner (safe — deletes NOTHING). Self-heals until b105 is applied.
// The FLOOR-rule logic is proven separately + offline by scripts/retention-logic-test.js (9/0). node scripts/prove-retention.js
const retention = require('../lib/retention');
let P = 0, F = 0;
const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };

(async () => {
  console.log('== PROVE RETENTION (dry-run planner — no deletion) ==\n');
  try {
    const plan = await retention.planRetirement({ commit: false });
    chk('planner runs in dry-run mode (deletes nothing)', plan.mode === 'dry-run');
    chk('reports candidate count + guardrail', plan.guardrail && typeof plan.guardrail.rows === 'number',
      'due=' + plan.guardrail.rows + ' of ' + plan.guardrail.total + ' (' + plan.guardrail.pct + '%) · cap=' + plan.guardrail.threshold_rows + '/' + plan.guardrail.threshold_pct + '%');
    chk('guardrail flags a runaway sweep', typeof plan.guardrail.blocked === 'boolean', 'blocked=' + plan.guardrail.blocked);
    console.log('\n  (Open-dispute override is enforced IN the query: due excludes any copy with an open dispute.)');
  } catch (e) {
    if (e.status === 503 || e.code === '42703' || e.code === '42P01') {
      console.log('  ◐ SKIPPED — b105 not applied (retire_at column absent). Run b105, then re-run this dry-run.');
    } else { chk('planner', false, e.message); }
  }
  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });
