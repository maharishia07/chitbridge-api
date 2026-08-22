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
const routeFiles = fs.readdirSync(R).filter((f) => f.endsWith('.js'));
const allRoutes = routeFiles.map((f) => ({ f, src: fs.readFileSync(path.join(R, f), 'utf8') }));

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
  const src = allRoutes.find((r) => r.f === c.f).src;
  const declared = new RegExp('(const|let|var)\\s+' + c.entityVar + '\\s*=').test(src);
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
