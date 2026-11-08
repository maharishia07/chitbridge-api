/* CUR-1 slice 2: the census reader (tools/cur1-census-read.cjs) turns the pasted census into decisions.
 * OWNS: proof that unknown and withdrawn codes are found, word slots are left out of the gate, the bucket checks bite, and the
 * three input shapes (CSV, tab, psql) read the same. The SQL itself is proven on real Postgres (SIT run, PM/CUR-1-CENSUS-SIT-2026-11-08.md). */
'use strict';
const assert = require('assert');
const { parse, factsOf, verdict, report } = require('../tools/cur1-census-read.cjs');

const HEAD = 'section,a,b,c,d,n';
const GOOD = [
  HEAD,
  'meta,current_user,,,,postgres', 'meta,role_bypasses_rls,,,,true', 'meta,chit_header_rows_visible,,,,10', 'meta,iso_list_size,,,,165',
  'code,chit_detail.currency_code,INR,ISO,,6', 'code,chit_detail.currency_code,BGN,WITHDRAWN,,3', 'code,chit_header.business_json:currency,inr,CASE_OR_SPACE_OF_ISO,,2',
  'code,entity_governance.setup_source:currency,the usual currency in India,BAD_SHAPE,,9', 'code,identities.currency_code,NULL,NULL,,4',
  'bucket,stated,real,stamp_before_chit,,5', 'bucket,money_without_currency,real,stamp_before_chit,,2', 'bucket,money_without_currency,test,stamp_null,,1',
  'bucket,detail,real,stamp_before_chit,,1', 'bucket,stated,real,stamp_before_chit,copies_disagree,1',
  'review,review_copies_total,,,,4', 'review,review_copies_test_held,,,,1', 'review,review_chits_with_a_test_copy_and_a_real_copy,,,,0',
  'stamp,stamp_set,,,,3', 'stamp,stamp_null,,,,1', 'stamp,entities_with_governance_row,,,,4',
  'check,chit_headers,,,,10', 'check,bucket_rows_total,,,,10'
];
const csv = GOOD.join('\n');

const f = factsOf(parse(csv));
assert.deepStrictEqual(f.codes.unknown.map((s) => s.value).sort(), ['BGN', 'inr'], 'withdrawn and wrong-case codes are unknown; INR is not');
assert.strictEqual(f.codes.words.length, 1, 'a word under a currency key is reported as words, not as a code');
assert.strictEqual(verdict(f), 1, 'an unknown code blocks the release gate');
assert.deepStrictEqual(f.checks.problems, [], 'the sample adds up');
assert.strictEqual(f.buckets.stampUsable, 2, 'only the stamp before the chit can fill an unstated currency');
assert.strictEqual(f.buckets.review.money_without_currency, 3);
assert.strictEqual(f.buckets.copiesDisagreeOutsideReview, 1);
assert.ok(/BGN/.test(report(f)), 'the report names the withdrawn code');

const clean = factsOf(parse(csv.split('\n').filter((l) => !/BGN|,inr,/.test(l)).join('\n')));
assert.strictEqual(verdict(clean), 0, 'no unknown code and consistent totals clear the gate');

const broken = factsOf(parse(csv.replace('check,chit_headers,,,,10', 'check,chit_headers,,,,11')));
assert.ok(broken.checks.problems.length >= 1 && verdict(broken) === 1, 'bucket rows that do not add up to the header count fail the checks');

const blind = factsOf(parse(csv.replace('role_bypasses_rls,,,,true', 'role_bypasses_rls,,,,false').replace('chit_header_rows_visible,,,,10', 'chit_header_rows_visible,,,,0')));
assert.ok(blind.checks.problems.some((p) => /row-level security/.test(p)), 'an RLS-filtered run is named');

const tsv = GOOD.map((l) => l.split(',').join('\t')).join('\n');
const quoted = GOOD.map((l) => l.replace('the usual currency in India', '"the usual currency, in India"')).join('\n');
assert.strictEqual(factsOf(parse(tsv)).buckets.all, f.buckets.all, 'tab-separated copy reads the same');
assert.strictEqual(factsOf(parse(quoted)).codes.words.length, 1, 'a quoted cell with a comma stays one cell');
const psql = [' section | a | b | c | d | n ', '---------+---+---+---+---+---', ...GOOD.slice(1).map((l) => ' ' + l.split(',').join(' | ') + ' '), '(21 rows)'].join('\n');
assert.strictEqual(factsOf(parse(psql)).buckets.all, f.buckets.all, 'psql -A style output reads the same');
assert.strictEqual(parse('hello'), null, 'text that is not a census is refused');
console.log('cur1-census-read: ok');
