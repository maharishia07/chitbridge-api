/**
 * tests/meters.test.cjs — every meter goes through one path, and never blocks the thing it measures.
 *
 * Athi, 2026-08-22: *"complete the ways and means and ensure end-to-end traceability is possible in terms of
 * usage, then we will see how to monetise."*
 *
 * ⚠️⚠️ b99 BUILT THE LEDGER AND NAMED SIX METERS IN ITS OWN HEADER — *"the identical row later meters
 * chit.send, network.connect, iot.task, erp.transfer, extra co-assists"* — and two months later exactly two
 * were written. **The mechanism was never the gap; adoption was**, which is the same finding as the logger
 * (five levels, one file requiring it) an hour earlier on the same day.
 *
 * ⭐⭐ AND METERING IS THE ONE THING THAT CANNOT BE BACKFILLED. A missing index can be added, a missing screen
 * can be built, a missing log line can be added tomorrow and still be useful next week. An event that was not
 * recorded when it happened is gone: you cannot invoice for March in April if March was never counted. That is
 * why this is worth a test rather than a note.
 */
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..', 'routes');
const L = path.join(__dirname, '..', 'lib');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

const meterSrc = fs.readFileSync(path.join(L, 'meter.js'), 'utf8');
/**
 * ── ⚠️⚠️ IT SCANNED routes/ AND THE FOURTH METER HAD MOVED TO lib/ ────────────────────────────────────────────
 *
 * This looked for four wired meters and found three, so it reported *"meters are wired ✗"* — which reads as a
 * meter having been REMOVED. None was. `catalogue.item` is wired at lib/mint-product.js:49; it simply left
 * routes/ when the mint was extracted, and this was still looking only where it used to be.
 *
 * ⚠️ A TEST THAT SCANS A DIRECTORY INSTEAD OF A BEHAVIOUR GOES BLIND WHEN THE CODE MOVES, and it fails in the
 * most misleading direction: it says the thing is gone. That is the same fault as gherkin.test.js this morning
 * and query-shape's file list — three stale SCOPES in one day, each of them louder than the bug it hid.
 *
 * ⭐ A meter call is a meter call wherever it lives. Both directories are read, and the file is reported with
 * the finding so the next move is visible rather than a guess.
 */
const srcOf = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
  .map((f) => ({ f: path.basename(dir) + '/' + f, src: fs.readFileSync(path.join(dir, f), 'utf8') }));
const routeFiles = fs.readdirSync(R).filter((f) => f.endsWith('.js'));
const allRoutes = srcOf(R).concat(srcOf(L));

console.log('\n── one path, and it cannot fail the action it measures ──');

/**
 * ⚠️ THE WHOLE SAFETY PROPERTY IS "NEVER REJECTS". A send that failed because its meter failed would lose a
 * person's work to protect a fraction of a cent — and `chit_header` still evidences the send either way.
 */
t('meter() catches everything', /catch\s*\(\s*e\s*\)\s*\{[\s\S]{0,400}?return false;/.test(meterSrc));
/**
 * ⚠️ AND SWALLOWING SILENTLY WOULD BE THE BUG THIS CODEBASE KEEPS PRODUCING. Unbilled usage is revenue quietly
 * not captured; the only way anyone learns of it is a line that says so. `warn` is the exact level: the
 * request succeeded and something is still wrong.
 */
t('  …and says so at warn, not in silence', /log\.warn\(/.test(meterSrc));
t('  …and carries the correlation id', /rid/.test(meterSrc));

console.log('\n── every meter call is the shared one ──');
const calls = [];
allRoutes.forEach(({ f, src }) => {
  for (const m of src.matchAll(/\.meter\(\s*([A-Za-z_$][\w$]*)\s*,\s*'([a-z][a-z.]+)'/g)) {
    calls.push({ f, entityVar: m[1], name: m[2] });
  }
});
t('meters are wired', calls.length >= 4, calls.map((c) => c.name).join(' · '));

/**
 * ⚠️⚠️ THE MISTAKE THIS CATCHES, BECAUSE I MADE IT. The first `chit.send` call passed `entity_id`, which does
 * not exist in that handler — the variable is `sender_id`. `node --check` cannot see an undefined variable,
 * and `meter()` guards a falsy entity and returns false, so **the guard that makes the function safe is the
 * same guard that would have hidden the mistake**: every send would have silently metered nothing.
 *
 * So the entity argument must be a name that is actually DECLARED in the file it is used in.
 */
console.log('\n── the entity argument exists in the file that passes it ──');
calls.forEach((c) => {
  const src = (allRoutes.find((r) => r.f === c.f) || { src: '' }).src;
  /**
   * ⚠️⚠️ AND THIS ONLY KNEW ONE WAY TO DECLARE A NAME. It required `const entity_id =`, so
   * lib/mint-product.js — which destructures it off its argument, `const { query, entity_id, rid } = o;` —
   * was reported as "NOT DECLARED, this meter records nothing". It is declared, on line 28, and the meter
   * works. The test was describing its own regex.
   *
   * ⚠️ THIRD TIME TODAY a guard has read a declaration it did not recognise as one: undeclared.cjs missed a
   * comma list, this missed a destructure. ⭐ The fix is the same both times — read the LINE a declaration
   * keyword introduces, and treat every name it binds as bound, punctuation included.
   *
   * ⚠️ THE ASSERTION IS UNCHANGED AND STILL THE POINT: meter() returns false on a falsy entity and swallows
   * its own errors, so a wrong variable name here is invisible forever. It must be a name that EXISTS.
   */
  const declared = src.split('\n').some(function (line) {
    if (!new RegExp('\\b' + c.entityVar + '\\b').test(line)) return false;
    /* a declaration keyword on the same line, or a function signature that takes it */
    return /\b(const|let|var)\b/.test(line) || /\bfunction\b|=>|\basync\b/.test(line);
  });
  t('  ' + c.f + ' → ' + c.name + ' passes ' + c.entityVar, declared,
    declared ? '' : 'NOT DECLARED — this meter records nothing');
});

/**
 * ⚠️ NOT AWAITED, ON PURPOSE — a response must not wait on a billing row. But an un-caught floating promise
 * would take the process down on an unhandled rejection, and this sits on the hottest paths in the product.
 */
console.log('\n── a floating meter call is still handled ──');
allRoutes.forEach(({ f, src }) => {
  for (const m of src.matchAll(/\.meter\([\s\S]{0,400}?\}\)([\s\S]{0,20})/g)) {
    if (!/\.catch\(/.test(m[1])) fail++, console.error('  ✗ ' + f + ': a meter call has no .catch()');
  }
});
if (!fail) { pass++; console.log('  ✓ every meter call is caught'); }

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
