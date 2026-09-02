/**
 * column-rules.test.cjs — flexible while empty, tightened once used, and the three that are never touchable.
 *
 * Athi, 2026-09-02: *"it should be very flexible initially, but once data loaded, the panel has to be tightened
 * what they can do, what they cannot."*
 *
 * ⚠️ THE STARTING POINT WAS THE OPPOSITE OF FLEXIBLE. `schema_fields` had no DELETE and no UPDATE anywhere, so
 * columns were insert-only for everyone for ever. The data was already safe; the whole cost fell on the person
 * who adopted a set to get eight columns and had the other three on every form permanently.
 *
 * ⭐ These assert what the rule ANSWERS, not which function the routes call — the lesson from isMatchable, where
 * three source-shape assertions passed while the feature was dead.
 *
 * Run: node --test tests/column-rules.test.cjs
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rules = require('../lib/column-rules');

test('an unused, optional column is removable — the flexible half', () => {
  assert.strictEqual(rules.why({ field_key: 'grade', field_name: 'Grade', used_by: 0 }), null);
  assert.strictEqual(rules.removable({ field_key: 'grade', used_by: 0 }), true);
});

test('one recorded value is enough to tighten it', () => {
  const r = rules.why({ field_key: 'grade', field_name: 'Grade', used_by: 1 });
  assert.match(r, /1 product record/);
  assert.match(r, /Grade/);
  /* ⚠️ THE COUNT IS IN THE MESSAGE. "Cannot remove" tells someone only that the software disagrees with them;
     the number tells them what to do next. */
  assert.match(rules.why({ field_key: 'grade', field_name: 'Grade', used_by: 12 }), /12 products record/);
});

test('⭐ the rule is PER COLUMN, not per catalogue', () => {
  /* A shop with 400 products may have added `grade` an hour ago and used it nowhere. That column is exactly as
     free to remove as it was on day one — which is the difference between a rule that fits the work and one that
     freezes the screen the moment anything exists. */
  assert.strictEqual(rules.removable({ field_key: 'grade', used_by: 0 }), true);
  assert.strictEqual(rules.removable({ field_key: 'fineness', used_by: 400 }), false);
});

test('name · unit · price are never removable, even on an empty catalogue', () => {
  for (const k of ['name', 'unit', 'price']) {
    assert.strictEqual(rules.removable({ field_key: k, used_by: 0 }), false, k);
    assert.match(rules.why({ field_key: k, used_by: 0 }), /every catalogue keeps/);
  }
});

test('a required column is refused, and says how to proceed', () => {
  const r = rules.why({ field_key: 'assay_cert', field_name: 'Assay certificate', required: true, used_by: 0 });
  assert.match(r, /required/);
  assert.match(r, /optional first/);
});

test('removable() is always derived from why(), never decided a second time', () => {
  /* ⚠️ Two functions answering one question is how a screen comes to enable a control the server then refuses.
     Checked across every shape this rule has. */
  const cases = [
    { field_key: 'grade', used_by: 0 }, { field_key: 'grade', used_by: 3 },
    { field_key: 'name', used_by: 0 },  { field_key: 'x', required: true, used_by: 0 },
    { field_key: '' },
  ];
  for (const c of cases) assert.strictEqual(rules.removable(c), rules.why(c) === null, JSON.stringify(c));
});

test('an unnamed column is refused rather than crashing', () => {
  assert.match(rules.why({}), /does not exist/);
  assert.strictEqual(rules.removable({}), false);
});
