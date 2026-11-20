#!/usr/bin/env node
// @type: unit
/**
 * error-codes-refuse.test.cjs — a code a refusal helper raises is a row in docs/ERROR-CODES.md (API-STANDARD S14, 17 Nov 2026).
 *
 * OWNS      the proof that tools/error-codes.cjs scanCodes sees a code raised by refuse(req, res, 400, 'CODE', ...) (routes/books.js), refuse('words', 'CODE', 400) (lib/bank-statement-file.js),
 *           and a ['words', 'CODE'] pair a refusal reads (lib/bank-rec-log.js MARKS_BAD); and that every such code in the repo is registered. It had read green while PERIOD_UNKNOWN,
 *           MARKS_LIMIT_INVALID and MARKS_CURSOR_INVALID (and 22 more) were missing.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      sample source text ──▶ scanCodes sees the code ──▶ the real repo scan ──▶ every code is a register row
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanCodes, readRows, unregistered, parseTable } = require('../tools/error-codes.cjs');

/* (1) the scanner sees each way a refusal carries its code */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codes-'));
fs.mkdirSync(path.join(root, 'lib'));
fs.writeFileSync(path.join(root, 'lib', 'sample.js'), [
  "if (!ok) return refuse(req, res, 400, 'SAMPLE_ROUTE_CODE', 'Pick one.');",
  "if (!file) throw refuse('The file is empty.', 'SAMPLE_THROWN_CODE', 400);",
  "const BAD = { limit: ['A limit is a number.' + MAX + '.', 'SAMPLE_PAIR_CODE'] };",
  "const ENV = ['SAMPLE_ENV_APP_SECRET', 'SAMPLE_ENV_TOKEN'];",
  "throw refusedWith('SAMPLE_INTERNAL_CODE', 'not an answer');"
].join('\n'));
const found = Object.keys(scanCodes(root));
['SAMPLE_ROUTE_CODE', 'SAMPLE_THROWN_CODE', 'SAMPLE_PAIR_CODE'].forEach((code) => assert(found.includes(code), 'the scan misses ' + code));
['SAMPLE_ENV_TOKEN', 'SAMPLE_INTERNAL_CODE'].forEach((code) => assert(!found.includes(code), 'the scan takes ' + code + ' for an API code'));

/* (2) the three codes the 17 Nov batch raised through refuse() are rows with a sentence */
const rows = readRows().rows;
['PERIOD_UNKNOWN', 'MARKS_LIMIT_INVALID', 'MARKS_CURSOR_INVALID'].forEach((code) => {
  const row = rows.find((item) => item.code === code);
  assert(row && row.status === '400' && row.shopkeeper !== 'PENDING', code + ' is not a registered 400 with a sentence');
});

/* (3) no refuse() code in the repo is missing from the register */
assert.deepStrictEqual(unregistered(rows), [], 'codes raised but not in docs/ERROR-CODES.md: ' + unregistered(rows).join(', '));
/* (4) a status that is a walk note, not a number / pair / varies, is a problem; no such row sits in the register */
const rowOf = (status) => '| X_CODE | ' + status + ' | T | S. | H. | a | 2026-11-20 |';
const tableOf = (status) => ['<!-- codes:start -->', '| code | status | title | shopkeeper | hint | owner_area | since |', '|---|---|---|---|---|---|---|', rowOf(status), '<!-- codes:end -->'].join('\n');
['400', '400/409', 'varies'].forEach((status) => assert.deepStrictEqual(parseTable(tableOf(status)).problems, [], status + ' is a fair status'));
['Counter › F7 › Asha Devi, 16:50', 'HALF', '4xx', '400-409'].forEach((status) => assert(parseTable(tableOf(status)).problems.length === 1, status + ' must be refused as a status'));
assert.deepStrictEqual(parseTable(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ERROR-CODES.md'), 'utf8')).problems, [], 'the register has a bad cell');
console.log('error-codes-refuse: ok (' + found.length + ' sample codes, ' + rows.length + ' registered)');
