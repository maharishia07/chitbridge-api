'use strict';
// tests/home-narrow-fields.test.cjs — FIELD TRACE for Home's narrow read (lane homeNarrow, 1129).
// Home's in / out / tasks / stuck / open run work-rows.classify + countsOf (workflow tabOf / kindOf / stageOf, open-orders.sideOf) and
// home-facts.railMeasure (lib/measure, money:false) over rows select.rows({ counts_only }) reads with COUNT_FIELDS only. Every row here is
// WIDE (every COLS field) but wrapped so reading a field outside COUNT_FIELDS THROWS: a rule that starts to read one fails here, before Home
// shows a wrong count. The narrow answer must equal the wide answer, and the SQL must select each field it names.
const assert = require('assert');
const select = require('../lib/select');
const workRows = require('../lib/work-rows');
const home = require('../lib/home-facts');

const ME = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const FIELDS = select.COUNT_FIELDS;
const WIDE_ONLY = ['folder_id', 'archived_at', 'assigned_to_actor_id', 'assigned_to_actor_display_name', 'filed_at', 'manual_subject', 'auto_subject', 'sender_entity_display_name',
  'all_recipients', 'summary_json', 'value', 'currency', 'open_disputes', 'resolved_disputes', 'counterparty_id', 'counterparty_name', 'bill_no', 'alt_value', 'biz_kind'];
/* lib/measure reads these two for its `disputes` figure; no Home card prints it (checked below), so a narrow row reads them as undefined = 0, the same as no dispute */
const UNUSED_READS = ['open_disputes', 'resolved_disputes'];
const day = 86400000, now = Date.parse('2026-11-20T00:00:00Z');
const statuses = ['pending', 'accepted', 'completed', 'rejected', 'cancelled', 'viewed'];
const wide = [];
for (let i = 0; i < 120; i++) {
  wide.push({
    chit_id: 'c' + (i % 90), current_status: statuses[i % statuses.length], direction: i % 3 ? 'received' : 'sent', role: i % 17 === 0 ? 'Draft' : 'Act',
    read_at: i % 2 ? new Date(now - i * 3600000) : null, touched_at: new Date(now - i * 7200000), created_at: new Date(now - i * day * 0.7),
    purpose: i % 4 === 0 ? 'order' : i % 4 === 1 ? 'general' : i % 4 === 2 ? 'expense' : 'order',
    sender_entity_id: i % 5 ? OTHER : ME, is_job_chit: i % 11 === 0, doc_kind: i % 13 === 0 ? 'bill_issued' : i % 7 === 0 ? 'bill_received' : null, biz_side: i % 6 === 0 ? 'buy' : i % 6 === 1 ? 'sell' : null,
    folder_id: null, archived_at: null, assigned_to_actor_id: null, assigned_to_actor_display_name: null, filed_at: new Date(now), manual_subject: 'x', auto_subject: 'y',
    sender_entity_display_name: 'n', all_recipients: [{ display_name: 'r' }], summary_json: { money: { total: 5 } }, value: 5, currency: 'INR', open_disputes: i % 9 ? 0 : 1, resolved_disputes: 0,
    counterparty_id: OTHER, counterparty_name: 'cp', bill_no: null, alt_value: null, biz_kind: null
  });
}
/** a row that throws when a rule reads a field the narrow select does not carry */
const guarded = (row) =>
  new Proxy(row, {
    get(target, key) {
      if (typeof key === 'string' && !FIELDS.includes(key) && key !== 'toJSON' && !UNUSED_READS.includes(key)) throw new Error('a rule read "' + key + '", which the narrow Home select drops (select COUNT_FIELDS)');
      return target[key];
    }
  });
const narrow = wide.map((row) => guarded(row));
const opts = { overdue_days: 7, now, money: false };

function counts(rows) {
  const items = workRows.classify(rows, ME);
  const tally = workRows.countsOf(items);
  const measured = home.railMeasure(rows, ME, opts);
  return { in: tally.orders_in, out: tally.orders_out, tasks: tally.tasks, open: measured.open, overdue: measured.overdue, overdue_days: measured.overdue_days, n: rows.length };
}
assert.deepStrictEqual(counts(narrow), counts(wide), 'narrow rows give the same Home counts as wide rows');

/* the two unused reads stay unused: no Home card line or figure takes measure's `disputes` */
const homeSource = require('fs').readFileSync(require.resolve('../lib/home-facts.js'), 'utf8');
assert.ok(!homeSource.includes('measured.disputes') && !homeSource.includes('.disputes'), 'a Home card now prints measure disputes: add open_disputes / resolved_disputes to COUNT_COLS');

/* the trap works: a rule reading a dropped field is caught (so a green run above means something) */
for (const dropped of WIDE_ONLY) assert.ok(!FIELDS.includes(dropped), dropped + ' must not be in COUNT_FIELDS');
assert.throws(() => guarded(wide[0]).value, /narrow Home select drops/);
assert.throws(() => home.railMeasure(narrow, ME, { ...opts, money: true }), /narrow Home select drops/, 'money:true reads value: not for the narrow rows');

/* the SQL carries every field COUNT_FIELDS names (an alias or a column) */
const sql = require('fs').readFileSync(require.resolve('../lib/select.js'), 'utf8');
const block = sql.slice(sql.indexOf('const COUNT_COLS'), sql.indexOf('/** `status`'));
for (const field of FIELDS) assert.ok(new RegExp('\\b' + field + '\\b').test(block), 'COUNT_COLS selects ' + field);
console.log('home-narrow-fields: ok (' + FIELDS.length + ' fields traced, ' + wide.length + ' rows)');
console.log(FIELDS.length + ' checks');
