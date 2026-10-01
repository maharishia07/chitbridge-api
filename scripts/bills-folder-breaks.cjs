/* break each guard of the Bills folder once; every break must turn tests/bills-folder.test.cjs red; every file is restored
   from a COPY (never git). The screen's own guards are broken by chitbridge-web e2e/bills-folder-breaks.cjs.
   Run: node scripts/bills-folder-breaks.cjs */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = process.argv[2] || path.join(__dirname, '..');
const T = 'bills-folder';
const BREAKS = [
  /* the inventory and the one classification (lib/folder-inventory.js) */
  [T, 'lib/folder-inventory.js', "const LEAVES = INVENTORY.filter((f) => f.leaves_inbox).map((f) => f.when.doc);", "const LEAVES = INVENTORY.filter((f) => f.kind === 'view').map((f) => f.when.doc);", 'receipts, expenses and returns leave the inbox too'],
  [T, 'lib/folder-inventory.js', "    if (k === 'counter_bill') return !!(bj.bill_no && String(bj.bill_no) !== '' && bj.till && bj.till.id && String(bj.till.id) !== '');", "    if (k === 'counter_bill') return !!bj.bill_no;", 'the JS classification drifts from the ledger (no till needed)'],
  [T, 'lib/folder-inventory.js', "  INVENTORY.forEach((f) => { const v = said[f.code]; out[f.code] = f.fixed ? true : (v === 'on' ? true : v === 'off' ? false : !!f.on); });", "  INVENTORY.forEach((f) => { out[f.code] = f.fixed ? true : !!f.on; });", 'the switch is ignored'],
  [T, 'lib/folder-inventory.js', "{ code: 'B-2100',  name: 'Bills · Received', role: 'creditors',", "{ code: 'B-2100',  name: 'Bills · Received', role: 'debtors',", 'Bills received point at the wrong ledger'],
  /* the inbox predicate (routes/chits.js) */
  [T, 'routes/chits.js', "    if (!/^[0-9a-f-]{36}$/i.test(String(req.query.folder_id || '').trim())) whereClause += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;", "", 'bills come back into Task'],
  [T, 'routes/chits.js', "    if (!/^[0-9a-f-]{36}$/i.test(String(req.query.folder_id || '').trim())) whereClause += ", "    if (true) whereClause += ", 'a folder the person named loses the bills they filed there'],
  [T, 'routes/chits.js', "    where += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;", "", 'bills come back into Order'],
  [T, 'routes/chits.js', "    if (dir) where += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;", "", 'the tab counts still count the bills'],
  /* the folder routes (routes/folders.js) */
  [T, 'routes/folders.js', "    if (!isOwner(req)) return res.status(403)", "    if (false) return res.status(403)", 'a co-assist switches folders'],
  [T, 'routes/folders.js', "    if (fid && INV.byId(fid)) return res.status(400)", "    if (false) return res.status(400)", 'a chit is "moved" into a system folder'],
  [T, 'routes/folders.js', "  if (sys) return sys.on ? sys : false;", "  if (sys) return sys;", 'an OFF folder still answers'],
  [T, 'routes/folders.js', "    const inBills = rows.filter((x) => !x.folder_id && leaves.has(x.doc_kind)).length;", "    const inBills = 0;", 'reconcile loses the bills'],
  [T, 'routes/entities.js', "!require('../lib/owner').isOwner(req)) {", "false) {", 'the generic policy door switches folders for a co-assist'],
  /* the views (lib/folder-views.js · lib/match.js · lib/folder-rules.js · lib/select.js) */
  [T, 'lib/folder-views.js', "  return Object.assign({}, f, { system: true, on: !!sw[f.code],", "  return Object.assign({ system: true, on: !!sw[f.code] }, f, {", 'the default overrides the shop\'s switch'],
  [T, 'lib/folder-views.js', "  const st = opts.state === 'closed' || opts.state === 'all' ? opts.state : 'open';", "  const st = 'all';", 'closed bills stay in the open list'],
  [T, 'lib/match.js', "      case 'doc':       if (lc(c.doc_kind) !== lc(raw)) return false; break;", "", 'a system folder\'s rule matches nothing'],
  [T, 'lib/folder-rules.js', "views.size ? rules.filter((r) => !views.has(String(r.folder_id))) : rules", "rules", 'a view folder\'s rule files chits'],
  [T, 'lib/select.js', "  (${INV.docSql('ch', 'cs')}) AS doc_kind,", "  NULL::text AS doc_kind,", 'the folders read a different classification from the inbox'],
  /* the step function and its facts (lib/bill-steps.js) */
  [T, 'lib/bill-steps.js', "    if (disputed) step = 'disputed';\n    else if (refusedE)", "    if (false) step = 'disputed';\n    else if (refusedE)", 'a dispute does not show'],
  [T, 'lib/bill-steps.js', "    const goodsIn = !g || !g.lines || g.complete >= g.lines;", "    const goodsIn = true;", 'a bill closes before the goods are in'],
  [T, 'lib/bill-steps.js', "side === 'issued' ? LABEL.money_received : LABEL.paid, x.money, CODE.money);", "side === 'issued' ? LABEL.money_received : LABEL.paid, x.money);", 'money reads as the bill\'s acceptance (one code for two acceptances)'],
  [T, 'lib/bill-steps.js', "return (i && (i.user_id || i.display_name)) || name || null;", "return (i && i.display_name) || name || null;", 'the line names a display name, not the user id'],
  [T, 'lib/bill-steps.js', "        waiting: recips.some((p) => p && p.entity_id && String(p.entity_id) !== me),", "        waiting: true,", 'a walk-in bill waits for a customer who does not exist'],
  [T, 'lib/bill-steps.js', "        accepted: pt(theirs(ACCEPTED_ACT)[0]), refused: pt(theirs(REFUSED_ACT)[0]) } : null,", "        accepted: null, refused: null } : null,", 'the customer\'s acceptance is never read'],
  [T, 'lib/bill-steps.js', "  if (paid) add('paid',", "  if (false) add('paid',", 'paid is not shown'],
];
let caught = 0; const missed = [];
for (const [test, file, from, to, what] of BREAKS) {
  const abs = path.join(R, file), copy = abs + '.breakcopy';
  const orig = fs.readFileSync(abs, 'utf8'); fs.writeFileSync(copy, orig);
  const crlf = orig.includes('\r\n'); let s = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  if (s.split(from).length !== 2) { console.log('  ??   ' + test + ' — anchor not found once: ' + what); fs.unlinkSync(copy); missed.push(what + ' (no anchor)'); continue; }
  s = s.replace(from, () => to); fs.writeFileSync(abs, crlf ? s.replace(/\n/g, '\r\n') : s);
  const t = path.join(R, 'tests', test + '.test.cjs');
  const r = spawnSync(process.execPath, [t], { encoding: 'utf8', timeout: 120000, env: process.env });
  fs.writeFileSync(abs, fs.readFileSync(copy, 'utf8')); fs.unlinkSync(copy);
  const red = r.status !== 0;
  if (red) caught++; else missed.push(test + ': ' + what);
  console.log('  ' + (red ? 'caught' : 'MISSED') + '  ' + what);
}
console.log('\n' + caught + '/' + BREAKS.length + ' caught' + (missed.length ? ' · MISSED: ' + missed.join(' | ') : ''));
process.exit(missed.length ? 1 : 0);
