#!/usr/bin/env node
// @type: unit
/**
 * pm-8-incident-build.test.cjs — PM-8 REGRESSION PROOF, FIXED 2026-11-14 (fix/pm-8-incident-build); was red on main. Enrolled in ci.yml as
 * pm-8-incident-build.test.cjs.
 * THE DEFECT  public/app/cap-testing.js:2642 (testIncSend) and :5213 (testFromCase, kind 'inc') send `build: window.CBBUILD || null`. Nothing in the repo defines
 *             window.CBBUILD (the build is the const CB_BUILD in public/app.html, the one testMark reads), so every incident is filed with build null.
 *   node tests/pm-8-incident-build.test.cjs        (exit 1 if the incident reads window.CBBUILD again)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const text = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-testing.js'), 'utf8');
const lines = text.split('\n');
const readers = [];
lines.forEach((line, index) => { if (/build:\s*window\.CBBUILD/.test(line)) readers.push(index + 1); });
let defined = false;
for (const file of ['public/app.html', 'public/app/cap-testing.js', 'public/app/core.js', 'public/app/shell.js']) {
  const body = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  if (/(window\.CBBUILD\s*=|var CBBUILD\b|const CBBUILD\b|let CBBUILD\b)/.test(body)) defined = true;
}
if (readers.length && !defined) {
  console.log('  XX  PM-8: an incident reads window.CBBUILD at cap-testing.js:' + readers.join(', :') + ' and nothing defines it - every incident has build null');
  process.exit(1);
}
console.log('  ok  PM-8: the incident build is defined where it is read');
const sends = lines.filter((line) => /build:\s*testBuild\(\)/.test(line)).length;
if (sends < 4) {
  console.log('  XX  PM-8: expected the two incident sends and the two verdict sends to read testBuild(), found ' + sends);
  process.exit(1);
}
console.log('  ok  PM-8: incidents and verdicts read the one build (testBuild, from CB_BUILD)');
