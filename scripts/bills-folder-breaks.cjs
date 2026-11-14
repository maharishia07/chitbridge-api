/**
 * scripts/bills-folder-breaks.cjs: break each guard of the Bills folder once; every break must turn its guard test red; every file is restored from a COPY (never git).
 * OWNS       the list of deliberate breaks of these guards (each names the test it must turn red).
 * CALLED BY  by hand (node scripts/bills-folder-breaks.cjs [repo root]); never by CI. A break aimed at routes/chits.js finds its anchor through tools/chits-files.cjs.
 * FLOW       for each break: find the file holding the anchor, copy it, apply the break, run the guard test, expect red, restore the copy.
 * CARD       01-rail-core-the-chit/folders
 */
const fs = require('fs'),
  path = require('path'),
  { spawnSync } = require('child_process');
const repoRoot = process.argv[2] || path.join(__dirname, '..');
const CHITS = require('../tools/chits-files.cjs'); /* the ONE list of chits files: a break finds its anchor wherever the code lives now */
const TEST_NAME = 'bills-folder';
const BREAKS = [
  /* the inventory and the one classification (lib/folder-inventory.js) */
  [
    TEST_NAME,
    'lib/folder-inventory.js',
    'const LEAVES = INVENTORY.filter((f) => f.leaves_inbox).map((f) => f.when.doc);',
    "const LEAVES = INVENTORY.filter((f) => f.kind === 'view').map((f) => f.when.doc);",
    'receipts, expenses and returns leave the inbox too'
  ],
  [
    TEST_NAME,
    'lib/folder-inventory.js',
    "    if (k === 'counter_bill') return !!(bj.bill_no && String(bj.bill_no) !== '' && bj.till && bj.till.id && String(bj.till.id) !== '');",
    "    if (k === 'counter_bill') return !!bj.bill_no;",
    'the JS classification drifts from the ledger (no till needed)'
  ],
  [
    TEST_NAME,
    'lib/folder-inventory.js',
    "    out[f.code] = f.fixed ? true : (typeof on === 'boolean' ? on : !!f.on); });",
    '    out[f.code] = f.fixed ? true : !!f.on; });',
    'the switch is ignored'
  ],
  [
    TEST_NAME,
    'lib/folder-inventory.js',
    "{ code: 'B-2100',  name: 'Bills · Received', role: 'creditors',",
    "{ code: 'B-2100',  name: 'Bills · Received', role: 'debtors',",
    'Bills received point at the wrong ledger'
  ],
  /* the inbox predicate (routes/chits.js) */
  [
    TEST_NAME,
    'routes/chits.js',
    "    if (!/^[0-9a-f-]{36}$/i.test(String(req.query.folder_id || '').trim())) whereClause += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;",
    '',
    'bills come back into Task'
  ],
  [
    TEST_NAME,
    'routes/chits.js',
    "    if (!/^[0-9a-f-]{36}$/i.test(String(req.query.folder_id || '').trim())) whereClause += ",
    '    if (true) whereClause += ',
    'a folder the person named loses the bills they filed there'
  ],
  [TEST_NAME, 'routes/chits.js', "    where += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;", '', 'bills come back into Order'],
  [TEST_NAME, 'routes/chits.js', "    if (dir) where += ` AND ${FOLDER_INV.inboxSql('ch', 'cs')}`;", '', 'the tab counts still count the bills'],
  /* the folder routes (routes/folders.js) */
  [TEST_NAME, 'routes/folders.js', '    if (!isOwner(req)) return res.status(403)', '    if (false) return res.status(403)', 'a co-assist switches folders'],
  [
    TEST_NAME,
    'routes/folders.js',
    '    if (fid && INV.byId(fid)) return res.status(400)',
    '    if (false) return res.status(400)',
    'a chit is "moved" into a system folder'
  ],
  [TEST_NAME, 'routes/folders.js', '  if (sys) return sys.on ? sys : false;', '  if (sys) return sys;', 'an OFF folder still answers'],
  [
    TEST_NAME,
    'routes/folders-totals.js', /* moved out of routes/folders.js (MNT-59) */
    '    const inBills = rows.filter((x) => !x.folder_id && leaves.has(x.doc_kind)).length;',
    '    const inBills = 0;',
    'reconcile loses the bills'
  ],
  [TEST_NAME, 'routes/entities.js', "!require('../lib/owner').isOwner(req)) {", 'false) {', 'the generic policy door switches folders for a co-assist'],
  /* the views (lib/folder-views.js · lib/match.js · lib/folder-rules.js · lib/select.js) */
  [
    TEST_NAME,
    'lib/folder-views.js',
    '  return Object.assign({}, f, { system: true, on: !!sw[f.code],',
    '  return Object.assign({ system: true, on: !!sw[f.code] }, f, {',
    "the default overrides the shop's switch"
  ],
  [
    TEST_NAME,
    'lib/folder-views.js',
    "  const st = opts.state === 'closed' || opts.state === 'all' ? opts.state : 'open';",
    "  const st = 'all';",
    'closed bills stay in the open list'
  ],
  [TEST_NAME, 'lib/match.js', "      case 'doc':       if (lc(c.doc_kind) !== lc(raw)) return false; break;", '', "a system folder's rule matches nothing"],
  [TEST_NAME, 'lib/folder-rules.js', 'views.size ? rules.filter((r) => !views.has(String(r.folder_id))) : rules', 'rules', "a view folder's rule files chits"],
  [TEST_NAME, 'lib/select.js', "  (${INV.docSql('ch', 'cs')}) AS doc_kind,", '  NULL::text AS doc_kind,', 'the folders read a different classification from the inbox'],
  /* the step function and its facts (lib/bill-steps.js) */
  [
    TEST_NAME,
    'lib/bill-steps.js',
    "    if (disputed) { step = 'disputed'; cur = { code: CODE.dispute, label: LABEL.disputed, by: lastDispute && lastDispute.by, at: lastDispute && lastDispute.at }; }\n    else if (refused)",
    "    if (false) { step = 'disputed'; }\n    else if (refused)",
    'a dispute does not show'
  ],
  [
    TEST_NAME,
    'lib/bill-steps.js',
    '    const goodsIn = !g || !g.lines || g.complete >= g.lines;',
    '    const goodsIn = true;',
    'a bill closes before the goods are in'
  ],
  [
    TEST_NAME,
    'lib/bill-steps.js',
    "h.push({ step: l.step || 'line', code: l.code, label: l.label,",
    "h.push({ step: l.step || 'line', code: code, label: l.label,",
    "money reads as the bill's acceptance (one code for two acceptances)"
  ],
  [
    TEST_NAME,
    'lib/bill-steps.js',
    'return (i && (i.user_id || i.display_name)) || name || null;',
    'return (i && i.display_name) || name || null;',
    'the line names a display name, not the user id'
  ],
  [
    TEST_NAME,
    'lib/bill-steps.js',
    '      waiting: recips.some((p) => p && p.entity_id && String(p.entity_id) !== me),',
    '      waiting: true,',
    'a walk-in bill waits for a customer who does not exist'
  ],
  /* (2026-10-01, bills-private: the seller no longer reads the customer's acceptance at all — scripts/bills-private-breaks.cjs guards that) */
  [
    TEST_NAME,
    'lib/bill-steps.js',
    "open: step !== 'closed', paid: !!(x.money && x.money.settled), history: h };",
    "open: step !== 'closed', paid: false, history: h };",
    'paid is not shown'
  ]
];
let caught = 0;
const missed = [];
for (const [test, file, from, to, what] of BREAKS) {
  const sourcePath = path.join(repoRoot, CHITS.anchorFile(repoRoot, file, from)),
    copy = sourcePath + '.breakcopy';
  const orig = fs.readFileSync(sourcePath, 'utf8');
  fs.writeFileSync(copy, orig);
  const crlf = orig.includes('\r\n');
  let text = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  if (text.split(from).length !== 2) {
    console.log('  ??   ' + test + ' — anchor not found once: ' + what);
    fs.unlinkSync(copy);
    missed.push(what + ' (no anchor)');
    continue;
  }
  text = text.replace(from, () => to);
  fs.writeFileSync(sourcePath, crlf ? text.replace(/\n/g, '\r\n') : text);
  const testPath = path.join(repoRoot, 'tests', test + '.test.cjs');
  const testRun = spawnSync(process.execPath, [testPath], { encoding: 'utf8', timeout: 120000, env: process.env });
  fs.writeFileSync(sourcePath, fs.readFileSync(copy, 'utf8'));
  fs.unlinkSync(copy);
  const wentRed = testRun.status !== 0;
  if (wentRed) caught++;
  else missed.push(test + ': ' + what);
  console.log('  ' + (wentRed ? 'caught' : 'MISSED') + '  ' + what);
}
console.log('\n' + caught + '/' + BREAKS.length + ' caught' + (missed.length ? ' · MISSED: ' + missed.join(' | ') : ''));
process.exit(missed.length ? 1 : 0);
