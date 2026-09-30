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
  /* ── the fix pass of 2026-09-30 (CRITIC-REVIEW-books-server): every new guard, broken once ── */
  ["books-fixes","lib/books.js","await db.query('RELEASE SAVEPOINT books_setting_read'); return r || { entity_id: entity, enabled: false }; }","await db.query('RELEASE SAVEPOINT books_setting_read'); return r; }","M1: a shop with no row reads as \"not migrated\" again"],
  ["books-fixes","lib/books.js","  for (const p of plan) if (!p.named && several) p.own_doc = true;","","M2: several parties in one entry share one document"],
  ["books-fixes","lib/books.js","      if (p.named) throw twoParties(p.named);\n      p.own_doc = true;","","M2: a reference another party already holds is reused"],
  ["books-fixes","lib/books-hooks.js","    return c ? c.s : null;\n  }","    onCache.set(k, { s: null, until: now + 600000 }); return null;\n  }","M3: a failed read of the switch is cached as off"],
  ["books-fixes","lib/books-hooks.js","    if (s.walkin_grain === 'bill') return { ok: true, empty: true, grain: 'bill' };","","M4: grain \"bill\" and the day still posts"],
  ["books-fixes","lib/books-hooks.js","    const take = found.filter((f) => own.indexOf('bill:' + f.id) < 0 && own.indexOf('walkin-late:' + f.id) < 0);","    const take = found;","M4: a bill posted on its own rides the day too"],
  ["books-fixes","lib/books-hooks.js","      if (covered) return { ok: true, covered: true, entry_no: day.entry_no };","      if (covered || new Date(day.created_at) >= new Date(copy.created_at)) return { waiting: 'day close' };","M7: a bill in flight at day close waits for ever"],
  ["books-fixes","lib/books-nightly.js","        const r = await H.postChit(entity, c.chit_id, { setting: s });","        const r = { none: true };","M6: the sweep finds chits and posts none"],
  ["books-fixes","lib/books-nightly.js","    const from = began && began > from0 ? began : from0;","    const from = from0;","M6: the sweep reaches behind the day the ledger began"],
  ["books-fixes","lib/books-nightly.js","  const days = closed.filter((d) => !beganDay || d >= beganDay);","  const days = closed;","M6: a walk-in day from before the ledger began is posted"],
  ["books-dates-tz","lib/books-engines.js","    return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());","    return v.toISOString().slice(0, 10);","M8: a date column is read in UTC again"],
  ["books-counter-snapshot","routes/till.js","    if (snapshotBooksOn) body.books = true;","    body.books = true;","M5: the snapshot says books: true to every shop"],
  ["books-counter-snapshot","routes/till.js","      if (booksOn && c.rows.some((x) => x.has_party_item)) {","      if (c.rows.some((x) => x.has_party_item)) {","M5: the dues query runs for a shop with no ledger"],
  ["books-counter-snapshot","routes/till.js","              WHERE entity_id = $1 AND side = 'receivable'","              WHERE entity_id = $1","F2: payable rows are summed into what a customer owes"],
  ["books-counter-snapshot","routes/till.js","          due_date: booksYmd(d.due_date), date: booksYmd(d.doc_date), disputed: !!d.disputed });","          due_date: d.due_date ? new Date(d.due_date).toISOString().slice(0, 10) : null, date: booksYmd(d.doc_date), disputed: !!d.disputed });","M8: the snapshot's due date is a day early"],
  ["key-scopes","middleware/auth.js","              ['POST', /^\\/api\\/till\\/alias$/],","              ['POST', /^\\/api\\/till\\/alias$/], ['POST', /^\\/api\\/books\\/payments$/],","M9: a counter key reaches /api/books/payments"],
  ["books-fixes","routes/books.js","router.post('/payments', auth, noKey, on, async","router.post('/payments', auth, on, async","M9: the second fence is gone from /payments"],
  ["books-fixes","lib/books.js","  if (!on || !(on.customer || on.supplier)) throw refuse(","  if (!on) throw refuse(","M9: a payment to an id on neither list"],
  ["books-fixes","lib/books.js","  if (first && d < first) throw refuse('That date is before this ledger began (","  if (false) throw refuse('That date is before this ledger began (","M9: a typed date years before the ledger"],
  ["books-fixes","lib/books.js","  else { const first = ledgerStart(s, pack); if (first && d < first) { d = first; early = true; } }","","M9: a chit dated 2020 creates financial year 2019-20"],
  ["books-fixes","routes/books.js","      if (!p.storage_path) return { no_file: true };","","M10: a pack with no file is acknowledged"],
  ["books-fixes","routes/books.js","      has_file: !!p.storage_path, file: '/api/books/packs/' + id + '/file', download:","      download:","M10: GET /packs/:id loses has_file and file"],
  ["books-fixes","lib/books.js","  if (p.client_ref) { const first = await S.paymentByRef(h, entity, p.client_ref); if (first) return firstPayment(h, entity, first.payment_id); }","","M11: a replayed payment is judged by its new body"],
  ["books-fixes","routes/books.js","source_ref: ref ? 'wo:' + ref : null,","source_ref: null,","M11: a write-off pressed twice posts twice"],
  ["books-fixes","routes/books.js","      waiting: waiting.map(require('../lib/books-hooks').waitingRow) });","      waiting: [] });","M12: /health names no waiting post"],
  ["books-fixes","routes/books.js","        const next = ['deposited', 'cleared', 'bounced'].filter(","        const next = [].filter(","M12: the cheque list offers no next step"],
  ["books-fixes","lib/books-store.js","AND done_at IS NULL ORDER BY tries, id LIMIT $2","AND done_at IS NULL ORDER BY id LIMIT $2","F6: stuck rows starve a new one"],
  ["books-writer","migrations/b272_books_ledger.sql","REVOKE DELETE ON books_setting, ledger_account, fiscal_period, books_counter FROM cb_app;\n","","F16: cb_app keeps DELETE on the ledger's setup tables"],
  ["books-writer","migrations/b273_books_journal.sql","-- ⚠️⚠️ RUN AS postgres IN THE SUPABASE SQL EDITOR — WITHOUT RLS.","-- ⚠️⚠️ RUN IN THE SUPABASE SQL EDITOR.","F23: a SQL file no longer says who runs it"],
  ["books-writer","lib/books-tally.js","every voucher is a ledger-only voucher","every voucher is an accounting voucher","F24: \"accounting\" in the file a shop downloads"],
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
