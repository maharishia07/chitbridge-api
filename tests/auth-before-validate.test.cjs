/**
 * tests/auth-before-validate.test.cjs — a route must decide WHO YOU ARE before it decides WHAT YOU SENT.
 *
 * Backlog, 2026-08-20: *"`/chits/send` validates BEFORE it authorises. A Viewer posting an invalid body gets
 * `400 Validation failed` instead of `403`."*
 *
 * ⚠️⚠️ NOT A HOLE, BUT A DISCLOSURE. A valid body still reaches `auth` and is still refused, so nothing
 * unauthorised gets done. What leaks is the VALIDATION DETAIL — field names, length limits, which properties
 * are required — handed to a caller who has no right to the route at all, along with the wrong reason for the
 * refusal. "Your body is malformed" tells someone the route exists and what it wants; "403" tells them
 * nothing.
 *
 * ⭐⭐ IT WAS NINE ROUTES, NOT ONE. The backlog recorded `/chits/send`; counting the convention found 98 routes
 * with `auth` first and **9** without — `/send`, `/:chit_id/status`, `/messages`, `/disputes`,
 * `/disputes/:id/resolve`, `/priority`, `/priority-flag`, and both of `connections`. A single named instance
 * of a pattern is worth counting before fixing: the note was right and incomplete in the same breath.
 *
 * ⭐ THE FIX IS TWO LINES SWAPPED, AND THAT IS WHY IT IS SAFE ON A LOCKED ENGINE. The validator chain only
 * RECORDS errors onto the request; `validate` is the middleware that rejects. So `auth` only has to run before
 * `validate`, not before the chain — no handler logic moves, no transaction is restructured, and a valid
 * authorised request takes exactly the path it took before.
 *
 * ⚠️ CHECKED FIRST THAT NO VALIDATOR READS `req.identity` — if one did, it had been reading `undefined` all
 * along, and moving `auth` ahead would have been a behaviour change wearing the clothes of a reorder.
 */
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..', 'routes');
const files = fs.readdirSync(R).filter((f) => f.endsWith('.js'));

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

/**
 * ⚠️ CRLF COST A ROUND. The same replacement fixed chits.js and silently skipped connections.js because one
 * file is LF and the other CRLF — `cat -A` showed no difference and `od -c` did. A line-oriented check that
 * assumes one ending reports the other file as clean, which is under-matching in its purest form.
 */
const lines = (src) => src.split(/\r?\n/);

const offenders = [];
let authFirst = 0;

for (const f of files) {
  const L = lines(fs.readFileSync(path.join(R, f), 'utf8'));
  for (let i = 0; i < L.length; i++) {
    if (L[i].trim() !== 'validate,') continue;
    /* the next middleware in the chain */
    let j = i + 1;
    while (j < L.length && !L[j].trim()) j++;
    if (j < L.length && L[j].trim() === 'auth,') {
      /* walk back to the route declaration this belongs to, for a useful message */
      let k = i;
      while (k > 0 && !/^router\.(get|post|put|patch|delete)\(/.test(L[k])) k--;
      offenders.push(f + ':' + (i + 1) + '  ' + (L[k] || '').trim().slice(0, 58));
    }
  }
  authFirst += (fs.readFileSync(path.join(R, f), 'utf8')
    .match(/router\.(get|post|put|patch|delete)\('[^']*',\s*auth/g) || []).length;
}

console.log('\n── who you are, before what you sent ──');
t('no route validates before it authorises', offenders.length === 0,
  offenders.length ? '' : authFirst + ' routes put auth first');
offenders.forEach((o) => console.error('      ' + o));

/**
 * ⚠️ AND THE SCAN MUST BE SHOWN TO CATCH THE SHAPE — every scan written this week was wrong before it was
 * right, always by under-matching. This plants the offending order in both line endings and fails if either
 * comes back clean.
 */
console.log('\n── the scan catches the shape, in both line endings ──');
for (const [name, nl] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  const specimen = ['router.post(\'/x\',', '  [', '    body(\'a\').notEmpty(),', '  ],', '  validate,',
    '  auth,', '  async (req, res) => {'].join(nl);
  const S = lines(specimen);
  let caught = false;
  for (let i = 0; i < S.length; i++) {
    if (S[i].trim() === 'validate,' && S[i + 1] && S[i + 1].trim() === 'auth,') caught = true;
  }
  t('  …a planted ' + name.padEnd(4) + ' route is reported', caught);
}

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
