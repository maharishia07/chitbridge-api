'use strict';
/**
 * THE SIGN-UP EVIDENCE — what was derived, what only the server saw, and when somebody agreed.
 *
 * Athi, 2026-09-18: *"anything else to be captured like device information, device type, ip and so on"*, and
 * *"possibly we have to ask for agree message"*. b264 was run on 2026-09-19, so the route now inserts.
 *
 * ⚠️⚠️ THIS FILE CANNOT REACH A DATABASE, and says so rather than pretending. What it CAN prove is the thing
 * that would otherwise only surface on a real shop's first sign-in: that the INSERT and the migration agree
 * about the columns, that the values are parameterised, and that nothing in the path can fail a verification.
 * A misspelt column name is invisible until somebody registers. [[feedback-silence-is-the-bug]]
 *
 * Run: node tests/signup-context.test.js
 */
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const API = path.join(__dirname, '..');
const ROUTE = fs.readFileSync(path.join(API, 'routes', 'entities.js'), 'utf8');
const MIG = fs.readFileSync(path.join(API, 'migrations', 'b264_signup_context.sql'), 'utf8');

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); }
}

/** the columns the migration actually creates, read from the CREATE TABLE body */
function migrationColumns() {
  const body = MIG.slice(MIG.indexOf('CREATE TABLE IF NOT EXISTS signup_context'));
  const inner = body.slice(body.indexOf('(') + 1, body.indexOf('\n);'));
  return inner.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--'))
    .map((l) => (l.split(/\s+/)[0] || '').replace(/[(),]/g, ''))
    .filter((c) => /^[a-z_]+$/.test(c));
}

/** the columns the route's INSERT names */
function insertColumns() {
  const at = ROUTE.indexOf('INSERT INTO signup_context');
  if (at < 0) return [];
  const open = ROUTE.indexOf('(', at);
  const close = ROUTE.indexOf(')', open);
  return ROUTE.slice(open + 1, close).split(',').map((c) => c.trim()).filter(Boolean);
}

console.log('\n══ the sign-up evidence ══\n');

console.log('— the route and the migration agree —');
it('⭐ the evidence is actually written now that b264 is run', () => {
  assert.ok(ROUTE.indexOf('INSERT INTO signup_context') > 0,
    'the route still only logs — the table exists, so the evidence should be stored');
  assert.ok(ROUTE.indexOf('NOT STORED: b264') < 0,
    'the route still claims b264 has not been run');
});
/**
 * ⚠️⚠️ THE ONE FAULT THIS FILE EXISTS FOR. A column named in the INSERT but not in the table is invisible in
 * every test we can run offline, and surfaces the first time a real shop signs up — as a failed audit row on
 * the one event it was built to record.
 */
it('⚠️⚠️ every column the INSERT names exists in b264', () => {
  const have = migrationColumns();
  assert.ok(have.length >= 10, 'the migration could not be read — found ' + have.length + ' columns');
  const used = insertColumns();
  assert.ok(used.length >= 9, 'the INSERT could not be read — found ' + used.length + ' columns');
  for (const c of used)
    assert.ok(have.indexOf(c) >= 0, 'the INSERT writes "' + c + '", which b264 does not create');
});
it('⭐ and the placeholders match the columns, one for one', () => {
  const at = ROUTE.indexOf('INSERT INTO signup_context');
  const vals = ROUTE.slice(ROUTE.indexOf('VALUES', at), ROUTE.indexOf('`', ROUTE.indexOf('VALUES', at)));
  const holes = (vals.match(/\$\d+/g) || []).length;
  assert.strictEqual(holes, insertColumns().length,
    'the INSERT names ' + insertColumns().length + ' columns and passes ' + holes + ' values');
});

console.log('— it cannot cost a sign-in —');
/**
 * ⚠️⚠️⚠️ NOTHING HERE MAY FAIL A VERIFICATION. A shop that cannot sign in because its audit row would not
 * store is a shop that cannot trade — and the audit row is the least important thing happening on that request.
 */
it('⚠️⚠️⚠️ the whole capture sits inside a try/catch that lets the sign-in continue', () => {
  const at = ROUTE.indexOf('INSERT INTO signup_context');
  const before = ROUTE.slice(0, at);
  const tryAt = before.lastIndexOf('try {');
  const catchAt = ROUTE.indexOf('} catch', at);
  assert.ok(tryAt > 0 && catchAt > at, 'the INSERT is not wrapped — a bad audit row would refuse a sign-in');
  const handler = ROUTE.slice(catchAt, catchAt + 400);
  assert.ok(handler.indexOf('console.log') > 0, 'a failed capture says nothing at all');
  assert.ok(handler.indexOf('NOT STORED') > 0,
    'a failed capture no longer names itself — a silent drop is the thing this was built to avoid');
  assert.ok(handler.indexOf('throw') < 0, 'the catch rethrows, so a failed audit row still refuses the sign-in');
});
it('⚠️ a malformed IP is stored as NULL rather than refused — a proxy can send anything', () => {
  assert.ok(/test\(rawIp\)\s*\?\s*rawIp\s*:\s*null/.test(ROUTE),
    'an unparseable x-forwarded-for would reach an inet column and fail the insert');
});
it('⚠️ an agreed_at that is not a date is NULL, not a string the column will reject', () => {
  assert.ok(ROUTE.indexOf('Date.parse(req.body.agreed_at)') > 0,
    'agreed_at is taken on trust from the browser');
});

console.log('— what is stored, and what is not —');
/** ⭐ the CLAIM is kept, not the value that won — so a later correction can be explained */
it('⭐ it stores what the browser CLAIMED, before the COALESCE decided whether to use it', () => {
  const at = ROUTE.indexOf('INSERT INTO signup_context');
  const coalesceAt = ROUTE.indexOf('COALESCE(country,');
  assert.ok(coalesceAt > 0 && coalesceAt < at,
    'the identity update no longer runs before the evidence, so "claimed" and "used" cannot be told apart');
  for (const c of ['claimed_country', 'claimed_currency', 'claimed_timezone'])
    assert.ok(insertColumns().indexOf(c) >= 0, 'the evidence does not keep ' + c);
});
/**
 * ⚠️⚠️ NO LOCATION, EVER — the deriving engine never prompts, and this table must never grow a column that
 * would tempt somebody to start. [[feedback-open-the-render-first]]
 */
it('⚠️⚠️ neither the table nor the route carries a location', () => {
  /**
   * ⚠️⚠️ COMMENTS STRIPPED FIRST, and this is the THIRD guard in two days to need it. b264's own note promises
   * "no latitude, no longitude, no address" — so a plain text search fails on the sentence making the promise.
   * A guard that cannot tell prose from a declaration reports the documentation as the fault, every time.
   * (Same trap as the --sk-ph guard and the geolocation guard in govcontext.test.js.)
   */
  const ddl = MIG.split('\n').map((l) => { const at = l.indexOf('--'); return at < 0 ? l : l.slice(0, at); })
    .join('\n').toLowerCase();
  for (const word of ['latitude', 'longitude', 'geolocation', 'lat ', 'lng '])
    assert.ok(ddl.indexOf(word) < 0, 'b264 has a ' + word.trim() + ' column');
  const at = ROUTE.indexOf('INSERT INTO signup_context');
  assert.ok(ROUTE.slice(at, at + 900).toLowerCase().indexOf('lat') < 0, 'the route stores a location');
});
/** ⚠️ and the table is documented WITHOUT RLS, with the reason — this project asks that of every table */
it('⚠️ b264 states its RLS position and why', () => {
  assert.ok(/WITHOUT RLS|NO policy|no policy/.test(MIG),
    'b264 does not say whether it carries RLS — every table here must answer that');
});

console.log('\n══ sign-up evidence · ' + pass + ' passed · ' + fail + ' failed ══');
console.log(pass + ' checks\n');
if (fail) process.exitCode = 1;
