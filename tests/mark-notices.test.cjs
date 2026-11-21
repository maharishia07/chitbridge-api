'use strict';
// mark-notices.test.cjs — the bell hears the marks: a notice is a feed row naming the entry; a thread shows only its current Query's replies. Pure, no database.
const assert = require('assert');
const { feedRow, titleOf } = require('../lib/mark-notices');
const { currentRunStart } = require('../lib/review-mark');
const at = (d) => new Date('2026-10-' + d + 'T01:00:00Z');

const q = feedRow({ notice_id: 'mk:7', notice_kind: 'query', at: at('12'), by_name: 'Sam', note: 'Why?', subject_id: 'e1', entry_no: 'JV-0002', posting_date: '2026-10-12', currency: 'AUD', total_minor: '88000' });
assert.strictEqual(q.action, 'mark_query');
assert.strictEqual(q.log_id, 'mk:7');
assert.deepStrictEqual(q.mark_entry, { entry_id: 'e1', entry_no: 'JV-0002', posting_date: '2026-10-12', currency: 'AUD', total_minor: '88000', label: null });
assert.strictEqual(q.mark_client, null);
/* b877: a firm-note reply names its client and carries the note's own label, and is its own kind of notice */
const n = feedRow({ notice_id: 'fl:1', notice_kind: 'internal', at: at('15'), by_name: 'Ann', note: 'ring them', subject_id: 'p1', entry_no: null, client_name: 'Seed E Client 005', client_id: '0b7e1c2a-0000-4000-8000-000000000005', label: 'SV/1 · test' });
assert.strictEqual(n.action, 'note_reply');
assert.strictEqual(n.mark_client, 'Seed E Client 005');
assert.strictEqual(n.mark_client_id, '0b7e1c2a-0000-4000-8000-000000000005');
assert.strictEqual(q.mark_client_id, null);
assert.deepStrictEqual(n.mark_entry, { entry_id: 'p1', entry_no: null, posting_date: null, currency: null, total_minor: null, label: 'SV/1 · test' });
assert.strictEqual(feedRow({ notice_id: 'mr:1', notice_kind: 'reply', at: at('13'), entry_no: null }).action, 'mark_reply');
assert.strictEqual(feedRow({ notice_id: 'mr:1', notice_kind: 'reply', at: at('13'), entry_no: null }).mark_entry, null);
/* W15-80: a sales (SV) and a payment (PY) notice carry the SAME key, the entry id; an entry that could not be read still names its id */
for (const no of ['SV/2026-27/000007', 'PY/2026-27/000008'])
  assert.strictEqual(feedRow({ notice_id: 'mr:2', notice_kind: 'reply', at: at('14'), subject_id: 'id-' + no, entry_no: no, posting_date: '2026-10-14', currency: 'AUD', total_minor: '1000' }).mark_entry.entry_id, 'id-' + no);
assert.deepStrictEqual(feedRow({ notice_id: 'mr:3', notice_kind: 'reply', at: at('14'), subject_id: 'gone', entry_no: null }).mark_entry, { entry_id: 'gone', entry_no: null, posting_date: null, currency: null, total_minor: null, label: null });
assert.strictEqual(titleOf({ entry_no: 'JV-1', posting_date: new Date('2026-10-12T00:00:00Z'), total_minor: 5 }).posting_date, '2026-10-12');

/* the thread starts at the current Query: an old Query's replies stay behind */
const row = (class_, d) => ({ class: class_, at: at(d) });
assert.strictEqual(currentRunStart([]), null);
assert.strictEqual(currentRunStart([row('clear', '01')]), null);
assert.strictEqual(currentRunStart([row('open', '02'), row('clear', '03'), row('open', '10')]), at('10').toISOString());
assert.strictEqual(currentRunStart([row('open', '02'), row('hold', '03'), row('clear', '04')]), at('02').toISOString());
assert.strictEqual(currentRunStart([row('open', '02'), row('open', '03')]), at('03').toISOString());
console.log('mark-notices: ok');

/* VOLUME 20 Nov (C-06): a Query raised on a client by a firm's reviewer rings the firm side too: notice 'mq:<id>' is a Query row that names the client, can be cleared like the others, and b888 carries both recipients */
const fq = feedRow({ notice_id: 'mq:12', notice_kind: 'query', at: at('16'), by_name: 'Audit Reviewer', note: 'Why?', subject_id: 'e9', entry_no: 'MJ/71', posting_date: '2026-09-15', currency: 'AUD', total_minor: '1275', client_name: 'Moonee Volume', client_id: '0b7e1c2a-0000-4000-8000-000000000009' });
assert.strictEqual(fq.action, 'mark_query');
assert.strictEqual(fq.mark_client, 'Moonee Volume');
assert.strictEqual(fq.mark_client_id, '0b7e1c2a-0000-4000-8000-000000000009');
assert.ok(/^[0-9a-f-]{36}$/.test(require('../lib/mark-notices').uuidOfNotice('mq:12') || ''), 'an mq notice can be cleared (dismissal id)');
const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'migrations', 'b888_mark_notices_firm_query.sql'), 'utf8');
assert.ok(/'mq:' \|\| m\.mark_id/.test(sql) && /v_actor = v_caller/.test(sql) && /business_json -> 'job' ->> 'plug' = 'client'/.test(sql) && /m\.by_identity_id <> v_actor/.test(sql), 'b888: the partner, the client holder, never the raiser');
assert.ok(/g\.revoked_at IS NULL AND g\.expires_at > now\(\)/.test(sql), 'b888: only under a live grant');
console.log('mark-notices firm arm: ok');
