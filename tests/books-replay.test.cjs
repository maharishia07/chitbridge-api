/**
 * books-replay.test.cjs — FIN-63 step 2: the one rule that tells a pressed-again allocation from a further one (lib/books-replay.js). Pure: rows in, answer out.
 * Hand-computed first. Payment P, bills A and B; one confirm writes TWO rows per pair (the bill's half, minus; the payment's own half, plus), one created_at.
 * Run: node tests/books-replay.test.cjs
 */
'use strict';
const R = require('../lib/books-replay');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const P = 'p1', REF = 'pay:p1', T0 = Date.parse('2026-11-05T10:00:00Z'), SEC = 1000;
/** the two rows of one pair: the bill's half (−) then the payment's half (+); ids are strings, as pg answers a bigint */
const pair = (id, at, bill, minor) => [
  { item_id: String(id), ref: REF, against_ref: bill, ref_kind: 'allocation', amount_minor: -minor, created_at: new Date(at).toISOString() },
  { item_id: String(id + 1), ref: REF, against_ref: REF, ref_kind: 'allocation', amount_minor: minor, created_at: new Date(at).toISOString() }
];
const undo = (id, reversesId, at) => ({ item_id: String(id), ref: REF, against_ref: REF, ref_kind: 'reversal', reverses: String(reversesId), amount_minor: 0, created_at: new Date(at).toISOString() });

console.log('\n══ FIN-63 step 2 · lib/books-replay: the fingerprint and the replay rule ══');

console.log('\n── the fingerprint ──');
const h = R.allocationHash(P, [['A', 40000], ['B', 20000]]);
ok('the same pairs in another order have the same hash', h === R.allocationHash(P, [['B', 20000], ['A', 40000]]));
ok('a zero amount is dropped: [A 100, B 0] is [A 100]', R.allocationHash(P, [['A', 100], ['B', 0]]) === R.allocationHash(P, [['A', 100]]));
ok('the bill id is trimmed: [" A ", 100] is [A 100]', R.allocationHash(P, [[' A ', 100]]) === R.allocationHash(P, [['A', 100]]));
ok('another amount, another bill or another payment is another hash', new Set([h, R.allocationHash(P, [['A', 40000], ['B', 20001]]), R.allocationHash(P, [['A', 40000], ['C', 20000]]), R.allocationHash('p2', [['A', 40000], ['B', 20000]])]).size === 4);

console.log('\n── the rule: hand-computed ──');
const first = [].concat(pair(10, T0, 'A', 40000), pair(12, T0, 'B', 20000));
const same = [['B', 20000], ['A', 40000]];
eq('latest live batch, same pairs, 10 s old → a replay: items 4, allocated 60000, duplicate', R.replayOf(first, P, same, T0 + 10 * SEC), { ok: true, items: 4, allocated_minor: 60000, duplicate: true });
eq('exactly 2 minutes old is still inside the window (≤)', !!R.replayOf(first, P, same, T0 + R.ALLOC_REPLAY_WINDOW_MS), true);
eq('2 minutes and a millisecond is after the window → not a replay (a top-up posts)', R.replayOf(first, P, same, T0 + R.ALLOC_REPLAY_WINDOW_MS + 1), null);
eq('the window is named, and is 2 minutes (FIN-63b)', R.ALLOC_REPLAY_WINDOW_MS, 120000);
eq('other pairs on the same batch → not a replay', R.replayOf(first, P, [['A', 40000]], T0 + 10 * SEC), null);
eq('no batch yet → not a replay', R.replayOf([], P, same, T0), null);
eq('rows of another payment are not this payment\'s batch', R.replayOf(first, 'p2', same, T0 + SEC), null);

console.log('\n── latest means the highest item_id, never the newest created_at ──');
const older = pair(10, T0, 'A', 10000), later = pair(12, T0 + 30 * SEC, 'B', 10000);
eq('[A], then [B]: asking [A] again is NOT a replay (B is the latest batch)', R.replayOf([].concat(older, later), P, [['A', 10000]], T0 + 40 * SEC), null);
eq('…asking [B] is a replay', !!R.replayOf([].concat(older, later), P, [['B', 10000]], T0 + 40 * SEC), true);
const waited = pair(12, T0 - 20 * SEC, 'B', 10000);   /* started first, waited on the lock, committed second: a higher item_id, an EARLIER created_at */
eq('a batch with the higher item_id and the EARLIER created_at is still the latest: [A] is not a replay', R.replayOf([].concat(older, waited), P, [['A', 10000]], T0 + 5 * SEC), null);
eq('item_id compares as a number, not as text: the batch ending "9" is older than the one ending "11"', !!R.replayOf([].concat(pair(8, T0, 'A', 5), pair(10, T0 + SEC, 'B', 5)), P, [['B', 5]], T0 + 2 * SEC), true);

console.log('\n── a reversed batch is never a replay (it is not live) ──');
const reversed = [].concat(first, [undo(20, 11, T0 + SEC)]);
eq('one row of the batch named by a reversal row → the whole batch is dead: not a replay', R.replayOf(reversed, P, same, T0 + 10 * SEC), null);
const twoBatches = [].concat(pair(10, T0, 'A', 10000), pair(12, T0 + 5 * SEC, 'B', 10000), [undo(20, 12, T0 + 6 * SEC)]);
eq('the later batch reversed: the latest LIVE batch is the earlier one, so [A] is a replay', !!R.replayOf(twoBatches, P, [['A', 10000]], T0 + 10 * SEC), true);
eq('…and [B] is not (its batch is dead)', R.replayOf(twoBatches, P, [['B', 10000]], T0 + 10 * SEC), null);

console.log('\n── it never throws on odd rows: nothing is refused here, the engine refuses ──');
eq('missing rows and a missing created_at-only list answer null, closed to a replay', R.replayOf(undefined, P, same, T0), null);

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
