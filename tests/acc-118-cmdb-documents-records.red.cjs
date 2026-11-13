#!/usr/bin/env node
/**
 * acc-118-cmdb-documents-records.red.cjs — ACC-118 (proof 2026-11-14): the CMDB lists a record for the counter (till), CB Accounts (accounts.html), the chit sheet, one-person and the Labs.
 * @type regression
 * OWNS      the proof that data/cmdb/ (the shipped CMDB records, lib/cmdb.js shape) holds a record whose own title, source or entry names each of the five items the documents join (api #6) found missing.
 * CALLED BY NOTHING (named .red.cjs, outside the enrolment sweep): red on main 2026-11-14 (no record names the till page, accounts.html, one-person or the Labs) - ACC-118 is reopened. No database, no network.
 * FLOW      data/cmdb/*.json -> per item: the records whose title / ci / source / entries / map name it
 * Run: node tests/acc-118-cmdb-documents-records.red.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { API, ok, done } = require('./lib/cat-proof-kit.cjs');

const DIR = path.join(API, 'data', 'cmdb');
const records = fs.readdirSync(DIR).filter((n) => /\.json$/.test(n)).map((n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')));
const WANT = [
  ['the counter (the till)', /till\.html/],
  ['CB Accounts (accounts.html)', /accounts\.html/],
  ['the chit sheet', /chit-sheet\.js|chit sheet/i],
  ['one-person (the one-shop gate)', /one-person|oneperson/i],
  ['the Labs', /\blabs?\b/i]
];
ok('the CMDB ships records to search (' + records.length + ')', records.length >= 10);
for (const [what, re] of WANT) {
  const own = records.filter((r) => re.test(r.ci + ' ' + (r.title || '')));
  ok('a CMDB record is named for ' + what + (own.length ? ' (' + own.map((r) => r.ci).join(', ') + ')' : ''), own.length > 0, 'no data/cmdb record has ' + String(re) + ' in its ci or title');
}
done();
