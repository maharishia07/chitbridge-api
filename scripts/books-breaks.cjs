/* break each books guard once; every break must turn its test red; every file is restored from a COPY (never git) */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = process.argv[2] || path.join(__dirname, '..');
const BREAKS = [
  ['books-writer', 'routes/books.js', "module.exports = router;", "async function sneak(db) { await db.query('UPDATE journal_line SET dr_minor = 0 WHERE entity_id = $1', ['x']); }\nmodule.exports = router;", 'a route writes journal_line'],
  ['books-writer', 'lib/books.js', "module.exports = { postEntry,", "module.exports = { writeJournal, postEntry,", 'a write helper is exported'],
  ['books-writer', 'routes/chits.js', "            hooks.afterChit(sender_id, chit_id, who);", "            await hooks.afterChit(sender_id, chit_id, who);", 'the chit awaits the ledger'],
  ['books-writer', 'migrations/b273_books_journal.sql', "ALTER TABLE party_item       ENABLE ROW LEVEL SECURITY;  ALTER TABLE party_item       FORCE ROW LEVEL SECURITY;", "ALTER TABLE party_item       ENABLE ROW LEVEL SECURITY;", 'party_item not FORCE RLS'],
  ['books-writer', 'migrations/b273_books_journal.sql', "REVOKE UPDATE, DELETE ON journal_entry, journal_line, party_item, books_payment, books_change_log FROM cb_app;", "", 'cb_app keeps UPDATE/DELETE on the journal'],
  ['books-writer', 'lib/books-nightly.js', "module.exports = { check, runAll, start };", "async function fix(h, e) { await S.addBalances(h, e, []); }\nmodule.exports = { check, runAll, start };", 'the nightly job calls a journal write'],
  ['books-store-sql', 'lib/books-store.js', "FROM journal_entry WHERE entity_id = $1 AND source_ref = $2`, [e, ref]);", "FROM journal_entry WHERE entity_id = $1 AND source_ref = $2`, [e]);", 'a bind parameter missing'],
  ['books-post', 'lib/books.js', "  for (const l of lines) { add(l.account_id, null, l); if (l.party_id) add(l.account_id, l.party_id, l); }", "  for (const l of lines) { add(l.account_id, null, l); }", 'the party grain of the balances is skipped'],
  ['books-post', 'lib/books.js', "  if (strict) throw refuse(PERIOD_LOCKED, 'PERIOD_LOCKED');", "", 'a typed date in a locked month is moved silently'],
  ['books-post', 'lib/books.js', "      if (seen) return { ok: true, duplicate: true, entry_id: seen.entry_id, entry_no: seen.entry_no, posting_date: ymd(seen.posting_date) };", "", 'the idempotency check is gone'],
  ['books-post', 'lib/books.js', "    if (cf.ok === false) throw refuse(SUSPENSE_NOT_NIL(prev), 'SUSPENSE_NOT_NIL');", "", 'an empty carryforward passes silently'],
  ['books-hooks', 'lib/books-hooks.js', "    if (!o.retry) await park(entity, job, String(e && e.message || e), ev.source_chit_id, ev.source_ref);\n    if (o.retry) throw e;", "    throw e;", 'a failed post is not parked'],
  ['books-hooks', 'lib/books-hooks.js', "  if (!s) return { off: true };\n    return postChit(entity, chit_id, { setting: s, by });", "  return postChit(entity, chit_id, { setting: s || {}, by });", 'the off switch is ignored by the hook'],
  ['books-routes', 'routes/books.js', "router.get('/dues', auth, noKey, on, async", "router.get('/dues', auth, noKey, async", '/dues answers while the ledger is off'],
  ['books-routes', 'routes/books.js', "router.post('/write-off', auth, owner, on, async", "router.post('/write-off', auth, on, async", 'a co-assist may write off'],
  ['books-routes', 'routes/books.js', "  if (e && e.code === 'PERIOD_LOCKED') return res.status(409).json({ code: 'PERIOD_LOCKED', error: e.message, message: e.message });", "", 'PERIOD_LOCKED loses its code'],
  ['books-tally', 'tools/tally-connector/adapters/tally.js', "bills: [{ name: ref, type: 'Agst Ref', amount }]", "bills: [{ name: ref, type: 'New Ref', amount }]", 'the connector\'s Receipt changes'],
  ['books-tally', 'lib/books-tally.js', "      if (!bills.length || bills.reduce((t, b) => t + b.minor, 0) !== lineMinor) bills = [{ name: billName(e.entry_no), type: 'On Account', minor: lineMinor }];", "", 'bill references may not add up to the line'],
  ['migration-rerunnable', 'migrations/b272_books_ledger.sql', "DROP FUNCTION IF EXISTS ops.f_books_enabled();", "", 'RETURNS TABLE without a DROP'],
  ['migration-lint', 'migrations/b273_books_journal.sql', "  entry_id          uuid NOT NULL,\n  entity_id         uuid NOT NULL,\n  line_no", "  entry_id          uuid NOT NULL REFERENCES journal_entry (entry_id),\n  entity_id         uuid NOT NULL,\n  line_no", 'a foreign key inside CREATE TABLE IF NOT EXISTS'],
  ['entity-cast-guard', 'migrations/b274_books_party.sql', "  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)\n  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);\nREVOKE DELETE ON books_pack", "  USING      (entity_id = current_setting('app.current_entity', true)::uuid)\n  WITH CHECK (entity_id = current_setting('app.current_entity', true)::uuid);\nREVOKE DELETE ON books_pack", 'an unguarded ::uuid cast'],
  ['books-writer', 'db/index.js', "'party_item', 'party_tax_id',", "'party_tax_id',", 'party_item missing from the RLS tripwire'],
];
let caught = 0; const missed = [];
for (const [test, file, from, to, what] of BREAKS) {
  const abs = path.join(R, file), copy = abs + '.breakcopy';
  const orig = fs.readFileSync(abs, 'utf8'); fs.writeFileSync(copy, orig);
  const crlf = orig.includes('\r\n'); let s = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  if (s.split(from).length !== 2) { console.log('  ??   ' + test + ' — anchor not found once: ' + what); fs.unlinkSync(copy); missed.push(what + ' (no anchor)'); continue; }
  s = s.replace(from, () => to); fs.writeFileSync(abs, crlf ? s.replace(/\n/g, '\r\n') : s);
  const t = ['.test.cjs', '.test.js'].map((x) => path.join(R, 'tests', test + x)).find((p) => fs.existsSync(p));
  const r = spawnSync(process.execPath, [t], { encoding: 'utf8', timeout: 120000, env: process.env });
  fs.writeFileSync(abs, fs.readFileSync(copy, 'utf8')); fs.unlinkSync(copy);
  const red = r.status !== 0;
  if (red) caught++; else missed.push(test + ': ' + what);
  console.log('  ' + (red ? 'caught' : 'MISSED') + '  ' + test.padEnd(22) + what);
}
console.log('\n' + caught + '/' + BREAKS.length + ' caught' + (missed.length ? ' · MISSED: ' + missed.join(' | ') : ''));
process.exit(missed.length ? 1 : 0);
