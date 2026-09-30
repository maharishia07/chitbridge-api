/**
 * books-writer.test.cjs — ⭐⭐⭐ ONE WRITER OF THE LEDGER (SPEC-books-v2 §3), the way counter-gates guards one door.
 *
 * Fails when:
 *   1. any file but lib/books-store.js writes (INSERT / UPDATE / DELETE) journal_entry, journal_line, account_balance
 *      or party_item — in lib/, routes/, db/, scripts/, tools/, backfill/ or server.js;
 *   2. the store's four journal writes (insertEntry, insertLines, addBalances, insertItems) are called from anywhere but
 *      lib/books.js — and, inside it, from anything but postEntry's own write helpers, which are never exported;
 *   3. migrations/b273 stops making the journal insert-only (the trigger on all five, and cb_app's UPDATE/DELETE revoked);
 *   4. routes/chits.js AWAITS the ledger hook (a posting failure must never fail the chit) or calls it outside try;
 *   5. a books table is missing from db/index.js RLS_TENANT_TABLES or from any b272–b274 FORCE RLS;
 *   6. cb_app may DELETE the ledger's setup tables (or the server starts to), a SQL file stops saying who runs it
 *      (as postgres, WITHOUT RLS), or a file the shop downloads says "accounting".
 * Run: node tests/books-writer.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function walk(dir, out) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const n of fs.readdirSync(abs)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n), st = fs.statSync(path.join(ROOT, p));
    if (st.isDirectory()) walk(p, out); else if (/\.(c?js|mjs)$/.test(n)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}
/* scripts/books-breaks.cjs is the tool that BREAKS these guards on purpose (it carries the forbidden strings as break text) */
const FILES = ['lib', 'routes', 'db', 'scripts', 'tools', 'backfill', 'middleware'].reduce((a, d) => walk(d, a), []).concat(['server.js']).filter((f) => f !== 'scripts/books-breaks.cjs');
const JOURNAL = ['journal_entry', 'journal_line', 'account_balance', 'party_item'];
const WRITE_RE = new RegExp('\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(' + JOURNAL.join('|') + ')\\b', 'i');
const STORE_WRITES = ['insertEntry', 'insertLines', 'addBalances', 'insertItems'];
const HELPERS = ['writeLines', 'writeJournal', 'writeAllocation', 'writeStatus', 'writeChequeReceived', 'writeChequeStep', 'writeReversal'];

console.log('\n══ ONE WRITER OF THE LEDGER ══\n');

/* 1 · SQL that writes the journal tables lives in the store only */
const sqlWriters = FILES.filter((f) => f !== 'lib/books-store.js' && WRITE_RE.test(read(f)));
ok('no file but lib/books-store.js writes journal_entry / journal_line / account_balance / party_item', sqlWriters.length === 0, 'found in: ' + sqlWriters.join(', '));
const store = read('lib/books-store.js');
ok('…and the store does write them (the guard is looking at the right file)', JOURNAL.every((t) => new RegExp('INSERT INTO ' + t + '\\b').test(store)));
ok('…and never UPDATEs or DELETEs the insert-only three', !/(UPDATE|DELETE\s+FROM)\s+(journal_entry|journal_line|party_item)\b/i.test(store));

/* 2 · the store's four writes: lib/books.js only, and there only inside the write helpers */
const callRe = new RegExp('\\.(' + STORE_WRITES.join('|') + ')\\s*\\(');
const callers = FILES.filter((f) => f !== 'lib/books-store.js' && f !== 'lib/books.js' && callRe.test(read(f)));
ok('the four journal writes are called from lib/books.js only', callers.length === 0, 'also called from: ' + callers.join(', '));
const books = read('lib/books.js');
/* split lib/books.js into its top-level functions, and find which ones call a store write */
const fns = {}; let cur = '(top)';
books.split('\n').forEach((line) => { const m = /^(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/.exec(line); if (m) cur = m[1]; (fns[cur] = fns[cur] || []).push(line); });
const writing = Object.keys(fns).filter((k) => callRe.test(fns[k].join('\n')));
ok('inside lib/books.js only the write helpers call them', writing.every((k) => HELPERS.indexOf(k) >= 0), 'callers: ' + writing.join(', '));
ok('…and every write helper exists (the guard is not guarding names that left)', HELPERS.every((h) => fns[h]), 'missing: ' + HELPERS.filter((h) => !fns[h]).join(', '));
const exported = (/module\.exports\s*=\s*\{([\s\S]*?)\};/.exec(books) || [])[1] || '';
ok('no write helper is exported — the only door is postEntry', HELPERS.every((h) => !new RegExp('\\b' + h + '\\b').test(exported)) && /\bpostEntry\b/.test(exported));
/* who calls a helper: postEntry, or another helper (writeChequeStep posts through writeJournal / writeReversal) */
const helperCallers = Object.keys(fns).filter((k) => HELPERS.some((h) => h !== k && new RegExp('\\b' + h + '\\s*\\(').test(fns[k].join('\n'))));
ok('the write helpers are called only by postEntry and by one another', helperCallers.every((k) => k === 'postEntry' || HELPERS.indexOf(k) >= 0), 'callers: ' + helperCallers.join(', '));

/* 3 · insert-only, by trigger AND by grant */
const b273 = read('migrations/b273_books_journal.sql');
['journal_entry', 'journal_line', 'party_item', 'books_change_log', 'books_payment'].forEach((t) => {
  ok('b273: ' + t + ' has the insert-only trigger', new RegExp('CREATE TRIGGER \\w+ BEFORE UPDATE OR DELETE ON ' + t + ' FOR EACH ROW EXECUTE FUNCTION books_insert_only\\(\\)').test(b273));
});
ok('b273: cb_app loses UPDATE and DELETE on the insert-only five', /REVOKE UPDATE, DELETE ON journal_entry, journal_line, party_item, books_payment, books_change_log FROM cb_app;/.test(b273));
ok('b273: the trigger function refuses, it does not ignore', /RAISE EXCEPTION/.test(b273));

/* 4 · the chit never waits on the ledger */
const chits = read('routes/chits.js');
const hook = chits.slice(chits.indexOf("require('../lib/books-hooks')") - 400, chits.indexOf("require('../lib/books-hooks')") + 700);
ok('routes/chits.js calls the ledger hook', chits.indexOf("require('../lib/books-hooks')") > 0);
ok('…inside try, in setImmediate, never awaited', /try \{/.test(hook) && /setImmediate\(/.test(hook) && !/await\s+hooks\./.test(hook) && !/await\s+require\('\.\.\/lib\/books-hooks'\)/.test(hook));
const hooks = read('lib/books-hooks.js');
ok('lib/books-hooks afterChit swallows every rejection', /function afterChit[\s\S]{0,400}\.catch\(/.test(hooks));

/* 5 · RLS on every books table */
const TABLES = ['books_setting', 'ledger_account', 'fiscal_period', 'books_counter', 'journal_entry', 'journal_line', 'account_balance', 'party_item', 'books_payment',
  'books_outbox', 'books_change_log', 'party_tax_id', 'books_pack'];
const sql = ['b272_books_ledger.sql', 'b273_books_journal.sql', 'b274_books_party.sql'].map((f) => read('migrations/' + f)).join('\n');
const idx = read('db/index.js');
TABLES.forEach((t) => {
  ok(t + ': FORCE RLS + a NULLIF-guarded policy + in the RLS tripwire', new RegExp('ALTER TABLE ' + t + '\\s+FORCE\\s+ROW LEVEL SECURITY').test(sql)
    && new RegExp('CREATE POLICY rls_entity ON ' + t + '\\s+USING\\s+\\(\\w+ = NULLIF\\(current_setting').test(sql) && new RegExp("'" + t + "'").test(idx));
});

/* 6 · the setup tables cannot be deleted by the application role; the SQL says who runs it; the pack's own words */
const b272 = read('migrations/b272_books_ledger.sql');
ok('b272: cb_app loses DELETE on the switch, the chart, the months and the number series (critic F16)', /REVOKE DELETE ON books_setting, ledger_account, fiscal_period, books_counter FROM cb_app;/.test(b272));
const SETUP_DELETE = /DELETE\s+FROM\s+(books_setting|ledger_account|fiscal_period|books_counter)\b/i;
const deleters = FILES.filter((f) => SETUP_DELETE.test(read(f)));
ok('…and nothing in the server deletes from them (the revoke takes away nothing that is used)', deleters.length === 0, 'found in: ' + deleters.join(', '));
['b272_books_ledger.sql', 'b273_books_journal.sql', 'b274_books_party.sql'].forEach((f) => {
  ok(f + ' says who runs it: as postgres, WITHOUT RLS (critic F23)', /RUN AS postgres IN THE SUPABASE SQL EDITOR — WITHOUT RLS/.test(read('migrations/' + f)));
});
const order = read('docs/drafts/BOOKS-RUN-ORDER.md');
ok('BOOKS-RUN-ORDER says the same, the three expected rows, and how an owner switches a shop on (no screen does)', /Run as `postgres` in the Supabase editor \(WITHOUT RLS\)/.test(order)
  && /expect `4 \| 4 \| 1 \| 0`/.test(order) && /expect `7 \| 7 \| 5 \| 0 \| 1`/.test(order) && /expect `7 \| 6 \| 2 \| 1 \|/.test(order) && /POST \/api\/books\/enable/.test(order) && !/v1\.8\.0/.test(order));
ok('the pack a shop downloads never says "accounting" in our own words (critic F24)', !/an accounting voucher/i.test(read('lib/books-tally.js')));

console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
