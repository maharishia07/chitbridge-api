/**
 * tests/idoc-normalise.test.cjs — what a person types must survive normalisation and still match its pattern.
 *
 * ⚠️⚠️ TWO REAL BUGS SIT BEHIND THIS FILE, BOTH FOUND ONLY BY RUNNING IT LIVE.
 *
 * 1. ONE RULE FOR EVERY SCHEME. The route normalised every value with .toUpperCase(), which is correct for the
 *    three Indian ID numbers I happened to write first and wrong for an email. Confirmed on the cloud: an
 *    address came back as "C•••@EXAMPLE.COM". Three things broke at once and none loudly —
 *      · the mask showed the person something they had not typed
 *      · the ENCRYPTED value was uppercased, so a verification code could go to the wrong mailbox (the local
 *        part of an address is case-sensitive per RFC 5321, whatever most servers tolerate)
 *      · the dedupe hash is taken over the normalised value, so the same address typed correctly later would
 *        not match — and "is this the same document" is the only question that hash exists to answer
 *
 * 2. AND THE FIX WAS WRITTEN BY A SCRIPT THAT ATE THE BACKSLASHES. \s became s, so /[\s-]/ became /[s-]/ and
 *    /\s/ became /s/ — which, after toUpperCase(), match nothing. Whitespace survived, and "TN01 2011 0001234"
 *    would have failed the driving-licence pattern with no visible reason. It parsed, it ran, and it was
 *    wrong.
 *
 * ⭐ SO THE ASSERTION IS THE ROUND TRIP, NOT THE REGEX. Each normaliser must turn realistic human input into
 * something the scheme's OWN pattern accepts. That catches both classes: a wrong rule, and a right rule whose
 * escapes were mangled on the way to disk.
 */
const path = require('path');

/* Load the real catalogue out of the route rather than restating it — a test that keeps its own copy of the
   thing under test passes while the product is broken. */
const src = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'identity-docs.js'), 'utf8');
const block = src.match(/const UP\s*=[\s\S]*?\n};/);
if (!block) { console.error('✗ could not find the catalogue — this test is stale, fix it before trusting it'); process.exit(1); }
const CATALOGUE = eval(block[0].replace(/^const UP/, 'var UP') + '\nCATALOGUE');

const CASES = {
  PAN:      [' abcde 1234 f ', 'ABCDE1234F'],
  VOTER_ID: ['abc-1234567',    'ABC1234567'],
  DL:       ['TN01 2011 0001234', 'TN0120110001234'],
  PHONE:    ['+91 98765 43210',   '+919876543210'],
  AADHAAR:  ['1234 5678 9012',    '123456789012'],
  EMAIL:    ['  Clerk@Example.COM ', 'clerk@example.com'],
};

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.error('  ✗ ' + n + (x ? '  ' + x : '')); } };

console.log('\n── typed input → normalised → matches its own pattern ──');
for (const spec of CATALOGUE.IN) {
  const c = CASES[spec.scheme];
  if (!c) { ok(`${spec.scheme} has a test case`, false, 'no case defined — add one'); continue; }
  const got = spec.norm(c[0]);
  ok(`${spec.scheme.padEnd(8)} ${JSON.stringify(c[0])} → ${JSON.stringify(got)}`, got === c[1], `expected ${JSON.stringify(c[1])}`);
  ok(`${spec.scheme.padEnd(8)} …and its own pattern accepts it`, spec.pattern.test(got), `pattern ${spec.pattern}`);
}

console.log('\n── the email case specifically, since that is what broke ──');
const email = CATALOGUE.IN.find(s => s.scheme === 'EMAIL');
ok('an address is NOT uppercased', email.norm('Clerk@Example.COM') === 'clerk@example.com', email.norm('Clerk@Example.COM'));
ok('and its mask keeps the domain readable', /@example\.com$/.test(email.mask(email.norm('Clerk@Example.COM'))), email.mask(email.norm('Clerk@Example.COM')));

console.log('\n── Aadhaar is still never storable ──');
const aadhaar = CATALOGUE.IN.find(s => s.scheme === 'AADHAAR');
ok('store is false', aadhaar.store === false);
ok('the mask keeps only the last four', aadhaar.mask('123456789012') === 'XXXX XXXX 9012', aadhaar.mask('123456789012'));

console.log(`\n══ ${pass} passed · ${fail} failed ══\n`);
process.exit(fail ? 1 : 0);
