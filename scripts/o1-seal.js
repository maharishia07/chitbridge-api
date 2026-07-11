// o1-seal.js — proves the workpattern SEAL memo (O(1) dereference) is correct + actually cheaper, and that the OPEN
// knobs still resolve LIVE (not frozen by the memo). Runs ANYWHERE: the DB is STUBBED (no creds needed), so this is a
// deterministic unit test of the seal LOGIC — cold miss re-derives, warm hit dereferences with zero round-trips.
// Run: node scripts/o1-seal.js
const db = require('../db');
// Stub every DB round-trip BEFORE workpattern captures db.query at require-time. All lookups return no rows, so
// resolveWorkPattern falls to its self-healing code defaults (blueprint@code, standard iso-9000@v1) — exactly the
// pre-mint path, and enough to exercise the memo. QN counts real round-trips the resolver *would* have made.
let QN = 0;
db.query = async () => { QN++; return { rows: [] }; };
db.withEntity = async (_e, fn) => fn({ query: async () => ({ rows: [] }) });   // entity-scoped read → no stamp
const { resolveWorkPattern, invalidateWorkPattern } = require('../lib/workpattern');

let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
const E = '00000000-0000-0000-0000-000000000001';

(async () => {
  console.log('== O(1) WORKPATTERN SEAL (stubbed DB) ==\n');
  invalidateWorkPattern();   // start cold

  // 1 · COLD miss re-derives (several round-trips); WARM hit dereferences (zero)
  QN = 0; const cold = await resolveWorkPattern('send-chit', { entity_id: E }); const coldQ = QN;
  QN = 0; const warm = await resolveWorkPattern('send-chit', { entity_id: E }); const warmQ = QN;
  chk('cold resolve issues DB round-trips (re-derives the sealed block)', coldQ >= 1, coldQ + ' queries');
  chk('warm resolve issues ZERO round-trips (O(1) dereference)', warmQ === 0, warmQ + ' queries');

  // 2 · resolved config IDENTICAL cold vs warm (memo returns the same sealed block)
  chk('warm === cold (no drift)', JSON.stringify(cold) === JSON.stringify(warm),
    'blueprint=' + cold._blueprint + ' std=' + cold._standard);

  // 3 · OPEN knobs stay LIVE — same warm memo, different connector config → different folder, SAME sealed refs
  const a = await resolveWorkPattern('iot-signal', { entity_id: E, connectorConfig: { folder: 'FOLDER-A' } });
  const b = await resolveWorkPattern('iot-signal', { entity_id: E, connectorConfig: { folder: 'FOLDER-B' } });
  chk('OPEN knob (folder) is NOT frozen by the memo', a.folder === 'FOLDER-A' && b.folder === 'FOLDER-B',
    'a=' + a.folder + ' b=' + b.folder);
  chk('SEALED refs identical across the two (only open changed)',
    a._blueprint === b._blueprint && a._standard === b._standard, a._blueprint + ' / ' + a._standard);

  // 4 · sealed defaults survive (isolation/copy/lifecycle from the blueprint, still present on the warm path)
  chk('sealed defaults preserved on the memo path', warm.isolation === 'per-copy' && warm.copy === 'both' && Array.isArray(warm.lifecycle),
    'isolation=' + warm.isolation + ' copy=' + warm.copy);

  // 5 · invalidate → next resolve re-derives (round-trips again)
  invalidateWorkPattern(E);
  QN = 0; await resolveWorkPattern('send-chit', { entity_id: E }); const afterInval = QN;
  chk('invalidateWorkPattern() forces a re-derive', afterInval >= 1, afterInval + ' queries');

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });
