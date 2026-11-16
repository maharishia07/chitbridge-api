'use strict';
// mark-notices.test.cjs — the bell hears the marks: a notice is a feed row naming the entry; a thread shows only its current Query's replies. Pure, no database.
const assert = require('assert');
const { feedRow, titleOf } = require('../lib/mark-notices');
const { currentRunStart } = require('../lib/review-mark');
const at = (d) => new Date('2026-10-' + d + 'T01:00:00Z');

const q = feedRow({ notice_id: 'mk:7', notice_kind: 'query', at: at('12'), by_name: 'Sam', note: 'Why?', subject_id: 'e1', entry_no: 'JV-0002', posting_date: '2026-10-12', currency: 'AUD', total_minor: '88000' });
assert.strictEqual(q.action, 'mark_query');
assert.strictEqual(q.log_id, 'mk:7');
assert.deepStrictEqual(q.mark_entry, { entry_id: 'e1', entry_no: 'JV-0002', posting_date: '2026-10-12', currency: 'AUD', total_minor: '88000' });
assert.strictEqual(feedRow({ notice_id: 'mr:1', notice_kind: 'reply', at: at('13'), entry_no: null }).action, 'mark_reply');
assert.strictEqual(feedRow({ notice_id: 'mr:1', notice_kind: 'reply', at: at('13'), entry_no: null }).mark_entry, null);
/* W15-80: a sales (SV) and a payment (PY) notice carry the SAME key, the entry id; an entry that could not be read still names its id */
for (const no of ['SV/2026-27/000007', 'PY/2026-27/000008'])
  assert.strictEqual(feedRow({ notice_id: 'mr:2', notice_kind: 'reply', at: at('14'), subject_id: 'id-' + no, entry_no: no, posting_date: '2026-10-14', currency: 'AUD', total_minor: '1000' }).mark_entry.entry_id, 'id-' + no);
assert.deepStrictEqual(feedRow({ notice_id: 'mr:3', notice_kind: 'reply', at: at('14'), subject_id: 'gone', entry_no: null }).mark_entry, { entry_id: 'gone', entry_no: null, posting_date: null, currency: null, total_minor: null });
assert.strictEqual(titleOf({ entry_no: 'JV-1', posting_date: new Date('2026-10-12T00:00:00Z'), total_minor: 5 }).posting_date, '2026-10-12');

/* the thread starts at the current Query: an old Query's replies stay behind */
const row = (class_, d) => ({ class: class_, at: at(d) });
assert.strictEqual(currentRunStart([]), null);
assert.strictEqual(currentRunStart([row('clear', '01')]), null);
assert.strictEqual(currentRunStart([row('open', '02'), row('clear', '03'), row('open', '10')]), at('10').toISOString());
assert.strictEqual(currentRunStart([row('open', '02'), row('hold', '03'), row('clear', '04')]), at('02').toISOString());
assert.strictEqual(currentRunStart([row('open', '02'), row('open', '03')]), at('03').toISOString());
console.log('mark-notices: ok');
