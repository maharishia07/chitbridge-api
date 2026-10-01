/* break each guard of a bill's privacy once; every break must turn tests/bills-private.test.cjs red; every file is restored
   from a COPY (never git). Run: node scripts/bills-private-breaks.cjs */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = process.argv[2] || path.join(__dirname, '..');
const T = 'bills-private';
const BREAKS = [
  /* writes */
  [T, 'routes/chits.js', "      if (_hrow && billPrivacy.isBill(_hrow, entity_id)) {", "      if (false) {", 'a status change on a bill fans out to the other shop again'],
  [T, 'routes/chits.js', "actor_name: req.identity.display_name, private: _bill });", "actor_name: req.identity.display_name, private: false });", 'goods-in on a bill is replicated into the other copy'],
  [T, 'routes/chits.js', "    if (_bill) {\n      try {\n        out.step", "    if (false) {\n      try {\n        out.step", 'goods-in on a bill is announced to every party'],
  [T, 'lib/deliverline.js', "        if (who.private) {", "        if (false) {", 'the private goods-in writes through the all-copies definer'],
  [T, 'lib/bill-privacy.js', "  if (level === 'internal') { await mineOnly(); return { level, written: 'mine' }; }", "", 'an internal step is fanned to every party'],
  [T, 'lib/bill-privacy.js', "  if (level === 'none') return { level, written: 'none' };", "", 'a step at level none is still written'],
  [T, 'routes/books.js', "      await require('../lib/bill-privacy').moneySteps(e, pay, list,", "      void (e, pay, list,", 'a payment against a bill writes no step'],
  /* the levels */
  [T, 'lib/folder-inventory.js', " && rank(l) <= rank(f.msg || 'none'); }", "; }", 'a shop may widen a folder above its ceiling'],
  [T, 'lib/folder-inventory.js', "!!f && rank(l) >= 0 && !f.msg_fixed && ", "!!f && rank(l) >= 0 && ", 'the dispute can be restricted'],
  [T, 'lib/folder-inventory.js', "  { code: 'R-1400',  name: 'Receipts',         role: 'cash', also: ['bank', 'upi', 'card'],   kind: 'view',  when: { doc: 'receipt' },       leaves_inbox: false, on: true,  msg: 'external' },",
                                 "  { code: 'R-1400',  name: 'Receipts',         role: 'cash', also: ['bank', 'upi', 'card'],   kind: 'view',  when: { doc: 'receipt' },       leaves_inbox: false, on: true,  msg: 'internal' },", 'payments no longer cross by default'],
  /* reads */
  [T, 'routes/chits.js', "      if (_h && billPrivacy.isBill(_h, entity_id)) {", "      if (false) {", 'the chit read of a bill is not redacted'],
  [T, 'lib/bill-privacy.js', "    participants: (o.participants || []).map((p) => String(p.entity_id) === me ? p\n      : { entity_id: p.entity_id, display_name: p.display_name, bridge_id: p.bridge_id }),", "    participants: o.participants,", 'the other copy\'s status shows on the participants panel'],
  [T, 'lib/bill-privacy.js', "      .filter((r) => SHARED_ACTIONS.indexOf(r.action) >= 0 || r.action === STEP_ACTION || mine(r.action_by_identity_id))", "      .filter(() => true)", 'the other shop\'s status history shows in the read'],
  [T, 'routes/chits.js', "WHERE l.entity_id = $1 AND l.chit_id = $2 AND (d.delivery_id IS NULL OR d.recorded_by_entity_id = $1)", "WHERE l.entity_id = $1 AND l.chit_id = $2", 'the other shop\'s goods-in shows in the line picture'],
  [T, 'routes/notifications.js', "          AND NOT (${billPrivacy.billSql('ch', 'cs')} AND ${billPrivacy.foreignStepSql('sl', '$1')})\n", "", 'the other shop\'s steps ring my bell'],
  /* the step function */
  [T, 'lib/bill-steps.js', "    const mineAct = (a) => logs.filter((x) => a.test(x.action) && isMine(x));", "    const mineAct = (a) => logs.filter((x) => a.test(x.action));", 'a buyer status row in my log is read as my acceptance'],
  [T, 'lib/bill-steps.js', "label: BP.label(t.s, isMine(t.x)),", "label: BP.label(t.s, true),", 'the other party\'s payment reads in their words, not mine'],
  [T, 'lib/bill-steps.js', "    else if (paidUp || !x.waiting) {", "    else if (true) {", 'an issued bill closes before it is paid'],
  [T, 'lib/bill-steps.js', "  const speaks = (c) => (lv[c] || 'internal') !== 'none';", "  const speaks = () => true;", 'a folder at level none still shows its lines'],
  [T, 'lib/bill-steps.js', "    if (disputed) { step = 'disputed'; cur = { code: CODE.dispute, label: LABEL.disputed, by: lastDispute && lastDispute.by, at: lastDispute && lastDispute.at }; }\n    /* closed when", "    if (false) { step = 'disputed'; }\n    /* closed when", 'the seller does not see the dispute'],
];
let caught = 0; const missed = [];
for (const [test, file, from, to, what] of BREAKS) {
  const abs = path.join(R, file), copy = abs + '.breakcopy';
  const orig = fs.readFileSync(abs, 'utf8'); fs.writeFileSync(copy, orig);
  const crlf = orig.includes('\r\n'); let s = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  if (s.split(from).length !== 2) { console.log('  ??   anchor not found once: ' + what); fs.unlinkSync(copy); missed.push(what + ' (no anchor)'); continue; }
  s = s.replace(from, () => to); fs.writeFileSync(abs, crlf ? s.replace(/\n/g, '\r\n') : s);
  const r = spawnSync(process.execPath, [path.join(R, 'tests', test + '.test.cjs')], { encoding: 'utf8', timeout: 120000, env: process.env });
  fs.writeFileSync(abs, fs.readFileSync(copy, 'utf8')); fs.unlinkSync(copy);
  const red = r.status !== 0;
  if (red) caught++; else missed.push(what);
  console.log('  ' + (red ? 'caught' : 'MISSED') + '  ' + what);
}
console.log('\n' + caught + '/' + BREAKS.length + ' caught' + (missed.length ? ' · MISSED: ' + missed.join(' | ') : ''));
process.exit(missed.length ? 1 : 0);
