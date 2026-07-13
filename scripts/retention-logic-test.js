// retention-logic-test.js — LOCAL proof of the retire_at FLOOR rule (no DB). The proof request calls out the
// "late dispute must NOT restart the clock" case as the one a naive impl gets catastrophically wrong. node scripts/retention-logic-test.js
const { computeRetireAt, boundedExtension, MAX_EXTEND_DAYS } = require('../lib/retention');
let P = 0, F = 0;
const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };
const DAY = 86400000, YEAR = 365 * DAY;
const start = new Date('2026-01-01T00:00:00Z').getTime();
const at = (ms) => new Date(ms);
const days = (a, b) => Math.round((a.getTime() - b) / DAY);

console.log('== RETENTION retire_at FLOOR RULE (MAX, never restart) ==\n');

// Case 1 — short retention + dispute: grace lifts the floor.
// 7d retention, 30d grace, dispute resolves day 3 → kept to day 33 (resolution+grace), NOT day 7.
{
  const r = computeRetireAt(at(start + 7 * DAY), false, at(start + 3 * DAY), 30);
  chk('7d retention + dispute day3 → resolution+grace (day 33)', days(r, start) === 33, 'day ' + days(r, start));
}

// Case 2 — long retention + EARLY dispute: grace is a no-op.
// 7y retention, 30d grace, dispute resolves year 1 → still year 7 (grace already satisfied).
{
  const r = computeRetireAt(at(start + 7 * YEAR), false, at(start + 1 * YEAR), 30);
  chk('7y retention + early dispute (yr1) → still ~year 7 (grace no-op)', Math.abs(days(r, start) - 2555) <= 2, 'day ' + days(r, start) + ' (~2555=7y)');
}

// Case 3 — long retention + LATE dispute: the catastrophic case. Must be resolution+grace, NOT another 7 years.
{
  const lateResolve = start + 7 * YEAR - 4 * DAY;   // ~year 6.99
  const r = computeRetireAt(at(start + 7 * YEAR), false, at(lateResolve), 30);
  const expected = days(at(lateResolve + 30 * DAY), start);
  chk('7y retention + LATE dispute → resolution+grace, NOT +7y (no restart)', days(r, start) === expected, 'retire day ' + days(r, start) + ' (expected ' + expected + '); a restart would be ~5110');
  chk('  └ and it is NOT ~14 years (the restart bug)', days(r, start) < 3000, days(r, start) + ' days');
}

// Override — an OPEN dispute never retires.
chk('open dispute → never retires (null)', computeRetireAt(at(start + 7 * DAY), true, null, 30) === null);

// No dispute → plain retention end.
chk('no dispute → plain retention end', days(computeRetireAt(at(start + 90 * DAY), false, null, 30), start) === 90, 'day ' + days(computeRetireAt(at(start + 90 * DAY), false, null, 30), start));

// Bounded extension — no unbounded option.
chk('extension 90d allowed', boundedExtension(90) === 90);
try { boundedExtension(99999); chk('extension > cap rejected', false, 'did not throw'); }
catch (e) { chk('extension > cap rejected (bounded, never unbounded)', e.status === 400, 'cap=' + MAX_EXTEND_DAYS); }
try { boundedExtension(0); chk('extension 0/negative rejected', false); } catch (e) { chk('extension 0/negative rejected', e.status === 400); }

console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
process.exit(F ? 1 : 0);
