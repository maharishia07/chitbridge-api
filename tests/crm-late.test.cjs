'use strict';
/* M148/M149: ONE late rule — a day before the shop's today. Pinned days (no clock): follow-ups, their buckets and a party's late dues all answer from it. */
const assert = require('assert');
const F = require('../lib/crm-followups'), crm = require('../lib/crm');
const T = '2026-10-10';
assert.strictEqual(F.isLate('2026-10-05', T), true, 'due 05 Oct is late on 10 Oct');
assert.strictEqual(F.isLate('2026-10-10', T), false, 'due today is not late');
assert.strictEqual(F.isLate(null, T), false);
assert.deepStrictEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-16', '2026-10-17', null].map((d) => F.bucketOf(d, T)), ['late', 'today', 'week', 'week', 'later', 'later']);
const row = (due) => F.shape({ followup_id: 'f', party_id: 'p', what: 'w', due_at: due + 'T06:00:00Z', done_at: null, created_at: due + 'T00:00:00Z' }, 'IN', T);
const five = row('2026-10-05'), now = row('2026-10-10');
assert.deepStrictEqual([five.late, five.bucket, five.today], [true, 'late', false], 'the 05 Oct follow-up is Late, never "This week"');
assert.deepStrictEqual([now.late, now.bucket, now.today], [false, 'today', true]);
assert.strictEqual(F.shape({ followup_id: 'f', due_at: '2026-10-05T06:00:00Z', done_at: '2026-10-06T00:00:00Z' }, 'IN', T).late, false, 'a done follow-up is never late');
/* dues: the same rule marks the party and counts the banner — the two cannot differ */
const parties = [{ dues: { balance_minor: 48165, oldest_due: '2026-10-01' } }, { dues: { balance_minor: -5000, oldest_due: '2026-10-10' } }, { dues: { balance_minor: 0, oldest_due: '2026-09-01' } }, { dues: null }];
const real = Date; /* markLate reads the shop's today from the clock: pin it */
global.Date = class extends real { constructor(...a) { super(...(a.length ? a : ['2026-10-10T08:00:00Z'])); } static now() { return real.parse('2026-10-10T08:00:00Z'); } };
const alerts = crm.markLate(parties, 'IN');
global.Date = real;
assert.deepStrictEqual(parties.map((p) => p.dues && p.dues.overdue), [true, false, false, null], 'late = oldest due before today and a balance open');
assert.strictEqual(alerts.dues_overdue, parties.filter((p) => p.dues && p.dues.overdue).length, 'the banner count is the marked rows');
console.log('crm-late: ok');
