/**
 * books-lock-note.test.cjs — the ONE wording of a late-posted line's note: "<narration> — <Month> locked" (lib/books-lock-note.js). Offline, pure.
 * Unit per rule · the refusal path (a day that is not a day gives no note, never a made-up one) · fail closed (nothing is invented from a missing narration). Run: node tests/books-lock-note.test.cjs
 * CARD 16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
const path = require('path');
const Note = require(path.join(__dirname, '..', 'lib', 'books-lock-note'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name); } };

ok('wordsOf names the month a day falls in', Note.wordsOf('2026-09-14') === 'September locked');
ok('wordsOf covers January and December (both ends of the year)', Note.wordsOf('2026-01-01') === 'January locked' && Note.wordsOf('2026-12-31') === 'December locked');
ok('noted puts the note after the narration with a dash', Note.noted('Rent', '2026-09-30') === 'Rent — September locked');
ok('noted trims the narration first', Note.noted('  Rent  ', '2026-09-30') === 'Rent — September locked');
ok('noted adds one note only: a narration that already carries it is left as it is', Note.noted('Rent — September locked', '2026-09-30') === 'Rent — September locked');
ok('noted without a narration is the note alone', Note.noted('', '2026-09-30') === 'September locked' && Note.noted(null, '2026-09-30') === 'September locked');
// the refusal path: a day that is not a day is refused a note, in words — nothing is guessed
ok('wordsOf refuses a month that does not exist (13, 00) — empty, never a guess', Note.wordsOf('2026-13-01') === '' && Note.wordsOf('2026-00-01') === '');
ok('wordsOf refuses a missing or unreadable day', Note.wordsOf(undefined) === '' && Note.wordsOf(null) === '' && Note.wordsOf('not a day') === '');
// fail closed: with no usable day the narration is returned untouched, and with neither the answer is null (never a note on nothing)
ok('noted keeps the narration when the day cannot be read (fail closed, nothing appended)', Note.noted('Rent', 'garbage') === 'Rent');
ok('noted with neither a narration nor a day is null (closed, not an empty note)', Note.noted('', 'garbage') === null && Note.noted(undefined, undefined) === null);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
