#!/usr/bin/env node
// @type: unit
/**
 * every-test-is-enrolled.test.cjs — A TEST FILE THAT NO CI JOB RUNS IS A TEST THAT PROVES NOTHING (Athi, 8 Nov; BUILD-PHASE 08 U1).
 *
 * On origin/main ccaa4858 there were 731 tests/*.test.(js|cjs) files and 64 of them were run by nothing (69 by the README's count, 5 of those are run by
 * another CI job): they had been written, passed or went stale, and nobody knew. This guard keeps that number at ZERO.
 *
 * Every tests/*.test.js or *.test.cjs must be run by CI: named in the GUARDS list of scripts/guards.cjs, named in .github/workflows/ci.yml (the integration
 * and fresh-db jobs name files), or named in deploy/proof.sh. A file in none of the three fails here BY NAME, unless it is on KNOWN_NOT_ENROLLED below.
 *
 * ⚠️ KNOWN_NOT_ENROLLED IS A RATCHET, NOT A PARKING LOT. Each row is a file that is RED today with a named reason and a backlog id. The list may only
 * SHRINK: a file on it that is now enrolled, or no longer exists, fails this test until its row is deleted; a row without a reason and an id fails; the list may
 * not be longer than MAX_KNOWN (set to its first length, lowered whenever it falls). Fixing a file means deleting its row AND adding it to GUARDS, in one PR.
 *
 * OWNS      the measure "api test files not run by CI" (this test's own count, printed; toolset/coverage/tests-not-in-ci.cjs reads the same three places).
 * CALLED BY scripts/guards.cjs (GUARDS) · CI guards job.
 * FLOW      tests/ listing + GUARDS array + ci.yml + deploy/proof.sh ──▶ the files in none ──▶ minus KNOWN_NOT_ENROLLED ──▶ named failures · ratchet checks
 * CARD      qa/offline-guards
 */
'use strict';
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..');
const TESTS = __dirname;

/** the files that are red today, each with WHY and the backlog line that owns the fix. Delete a row when the file is fixed and enrolled; never add one. */
const KNOWN_NOT_ENROLLED = {
  'bill-checks.test.js': 'QA-122: the test lifts till.html functions by name and the chain grew (shopPack, dayWarnWords, cbQuiet); the slip-title and finish() pins moved to slipTitleOf / notInvoiceWhy: re-lift, then enrol',
  'books-reconcile.test.cjs': 'ACC-302 (PRODUCT): lib/tax-copy.js ledgerFor reads expenseItcPack(h) outside the per-copy try, so one unreadable copy throws the whole month instead of landing in `dropped` (T-C5)',
  'env-posture.test.cjs': 'RAIL-208 (PRODUCT): lib/ctpreturn.js:199 compares process.env.NODE_ENV to a literal untrimmed; the assertion (one trimmed reader, isSealed) is right',
  'gherkin.test.js': 'QA-123: the case key `governance.nightly` (data/test-cases.json) is lowercase and dotted, the Gherkin key grammar is capitals-and-hyphens: rename the key or widen the grammar',
  'governed-currency.test.js': 'QA-122: tests 11 and 12 are static regexes (API-58, RAIL-63); replace by a behavioural case on the resolved currency, then enrol (closes CTRY-28)',
  'iam-access.test.cjs': 'QA-122: 8 of 36 rows disagree with the spec (read-only and editable external 403; PATCH /actors/x answers 404 not 403; the Viewer/Commenter rows): judge test-stale vs product (cb-security) before any change',
  'products-bulk.test.cjs': 'QA-122: the bulk route moved behind catalogue-write.patchItems (CAT-W1); 8 static route pins to re-aim',
  'query-shape.test.js': 'QA-122: the per-file query budget names files that changed, an EISDIR on a path that became a folder, the LIKE trigram check: refresh the budget with reasons',
  'requirements.test.js': 'QA-122: 3 pins (the rule half, the default filter, the backlog sort) predate the Test board decisions: fix to the current board',
  'test-board.test.js': 'QA-122: 4 static pins of the panel (run-kind options, token identity, size preset key, header divs) lost their anchors: re-aim to the current panel',
  'tier2-record.test.js': 'QA-122: 5 regex pins lost their text to reformatting and moves (offer total_value, allow-list catch, field-first read, face-save, MY_PAGE_MAX): re-aim each; behaviour unchanged on a first read',
  'type-tokens.test.js': 'QA-122: the type scale moved to appearanceApply; raw pixel sizes in 26 capability files become a budget (UX pack 12)'
};
/** the list may not grow: lower this when a row is deleted */
const MAX_KNOWN = 12;

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const guardsText = read(path.join(API, 'scripts', 'guards.cjs'));
const ciText = read(path.join(API, '.github', 'workflows', 'ci.yml'));
const proofText = read(path.join(API, 'deploy', 'proof.sh'));

/** the names in the GUARDS array itself (a name in a comment is not an enrolment) */
const arrayStart = guardsText.indexOf('const GUARDS = [');
const arrayEnd = guardsText.indexOf('\n];', arrayStart);
const guardsNames = new Set();
(guardsText.slice(arrayStart, arrayEnd).match(/^\s*'([^']+\.test\.(?:js|cjs))'/gm) || []).forEach((line) => guardsNames.add(line.match(/'([^']+)'/)[1]));

const files = fs.readdirSync(TESTS).filter((name) => /\.test\.(js|cjs)$/.test(name));
const reaches = (name) => (guardsNames.has(name) ? 'GUARDS' : ciText.includes(name) ? 'ci.yml' : proofText.includes(name) ? 'deploy/proof.sh' : null);
const unreached = files.filter((name) => !reaches(name));

let pass = 0;
const fails = [];
const check = (label, cond, info) => {
  if (cond) pass++;
  else fails.push(label + (info ? ' → ' + info : ''));
};

check('the GUARDS array was found and holds names', arrayStart > 0 && guardsNames.size > 600, 'found ' + guardsNames.size);
check('ci.yml is readable', ciText.length > 0);

/* 1. a file in none of the three, not on the known list, fails BY NAME */
const fresh = unreached.filter((name) => !(name in KNOWN_NOT_ENROLLED));
check('every tests/*.test.(js|cjs) is run by CI (GUARDS, ci.yml or deploy/proof.sh) or is on the known list', fresh.length === 0, fresh.join(', ') + ' — add each to GUARDS in scripts/guards.cjs the day it passes');

/* 2. the ratchet: the known list only shrinks */
for (const name of Object.keys(KNOWN_NOT_ENROLLED)) {
  check(name + ': on the known list, so it must still exist', files.includes(name), 'deleted or renamed: remove its row');
  check(name + ': on the known list, so it must still be un-enrolled', unreached.includes(name), 'it is run by ' + reaches(name) + ' now: delete its row');
  const why = KNOWN_NOT_ENROLLED[name];
  check(name + ': a reason and a backlog id', /\b[A-Z]{2,5}-\d+\b/.test(why) && why.length > 40, why);
}
check('the known list has not grown (' + Object.keys(KNOWN_NOT_ENROLLED).length + ' of at most ' + MAX_KNOWN + ')', Object.keys(KNOWN_NOT_ENROLLED).length <= MAX_KNOWN);
check('MAX_KNOWN equals the list length (lower it when a row is deleted)', MAX_KNOWN === Object.keys(KNOWN_NOT_ENROLLED).length);

/* 3. a file named only in ci.yml or proof.sh really is named there (the "other job runs it" claim is read, not assumed) */
const elsewhere = files.filter((name) => reaches(name) === 'ci.yml' || reaches(name) === 'deploy/proof.sh');
check('the files other CI jobs run are counted as run (' + elsewhere.length + ')', elsewhere.every((name) => !guardsNames.has(name)), 'a file in both GUARDS and another job runs twice');

/* 4. every GUARDS name exists (guards.cjs says it too, but a rename must fail here as well) */
const missing = [...guardsNames].filter((name) => !fs.existsSync(path.join(TESTS, name)));
check('every GUARDS name is a file', missing.length === 0, missing.join(', '));

/* 5. RETIRED.md: a test file it names must be gone, and every line states a reason */
const retired = read(path.join(API, 'RETIRED.md'));
/* only the part of a line BEFORE its arrow names what was retired; after the arrow the line names the replacement, which must stay */
const beforeArrows = retired.split('\n').map((line) => line.split('→')[0]).join('\n');
const retiredTests = (beforeArrows.match(/tests\/[\w.-]+\.test\.(?:js|cjs)/g) || []).map((item) => item.replace('tests/', ''));
const stillThere = [...new Set(retiredTests)].filter((name) => files.includes(name) && !retired.split('\n').some((line) => line.includes(name) && /todo|marked/.test(line)));
check('a test file listed in RETIRED.md is gone (or is marked todo there)', stillThere.length === 0, stillThere.join(', '));

console.log('  api test files: ' + files.length + ' · run by GUARDS ' + files.filter((n) => reaches(n) === 'GUARDS').length + ' · by another CI job ' + elsewhere.length + ' · known not enrolled ' + unreached.length + ' · not run by CI and not known ' + fresh.length);
fails.forEach((item) => console.log('  FAIL ' + item));
console.log('\n  ' + pass + ' checks, ' + fails.length + ' failed');
process.exit(fails.length ? 1 : 0);
