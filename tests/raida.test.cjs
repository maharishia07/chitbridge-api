/**
 * tests/raida.test.cjs — the register on a line (b182), phase 0.
 *
 * ⭐⭐ THE ONE PROPERTY WORTH PROTECTING: STATE IS COMPUTED, NOT STORED. An entry is OPEN when no row
 * closes it. There is no status column, so there is nothing to drift out of step with the log — and
 * "what did we think on the 14th" survives the entry stopping being true. Every assertion about open
 * and closed below reads the log, never a flag.
 *
 * ⚠️⚠️ AND THE TABLE MAY NOT EXIST. Athi runs migrations by hand in the Supabase editor, so code ships
 * first, always. A READ must degrade to an empty register; a WRITE must refuse loudly with the
 * migration number. On 2026-08-30 a column named on the wrong table turned a whole screen blank rather
 * than erroring — that is the failure mode the first five assertions exist to prevent.
 */
const API = 'C:/dev/chitbridge-api';

let ROWS = [], SQL = [], TABLE_EXISTS = true;
const fakeDb = {
  query: async (text, args) => {
    SQL.push({ text: String(text).replace(/\s+/g, ' ').trim(), args });
    return { rows: ROWS };
  },
};
require.cache[require.resolve(API + '/db')] = { exports: {
  withEntity: async (id, fn) => fn(fakeDb),
  onEntity: async (id, db, fn) => fn(db && db.query ? db : fakeDb),
  query: async () => ({ rows: [] }),
} };
require.cache[require.resolve(API + '/lib/schema')] = { exports: {
  hasTable: async () => TABLE_EXISTS, hasColumn: async () => true, hasColumns: async () => ({}), _reset() {},
} };
const raida = require(API + '/lib/raida');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  \u2717 ' + name + (extra ? '   ' + extra : '')); }
};
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const flat = () => SQL.map((q) => q.text).join(' | ');

(async () => {
  console.log('\n-- \u26a0\ufe0f\u26a0\ufe0f before the migration: a read degrades, a write refuses --');
  TABLE_EXISTS = false; SQL = [];
  const empty = await raida.list('e1', 'c1');
  t('a read returns an EMPTY register, not an error', Array.isArray(empty.entries) && empty.entries.length === 0);
  t('and says so with migrated:false', empty.migrated === false);
  t('it never even asks the database', SQL.length === 0, SQL.length + ' quer(ies)');
  const w = await caught(() => raida.add('e1', 'c1', { kind: 'risk', body: 'x' }));
  t('a WRITE refuses rather than silently dropping it', !!w && w.status === 503, w && w.message);
  t('and names the migration', !!w && /b182/.test(w.message), w && w.message);

  TABLE_EXISTS = true;

  console.log('\n-- \u2b50\u2b50 open and closed are DERIVED from the log --');
  ROWS = [
    { raida_id: 'r1', line_id: 'L1', kind: 'risk', body: 'CPRI slot may slip', closes_id: null,
      visibility: 'internal', dispute_id: null, created_by_name: 'Sundar', created_at: '2026-08-01' },
    { raida_id: 'r2', line_id: null, kind: 'dependency', body: 'crane by the 22nd', closes_id: null,
      visibility: 'shared', dispute_id: null, created_by_name: 'Mwangi', created_at: '2026-08-02' },
    /* the closing row for r1 — NOT an entry of its own, the ending of one */
    { raida_id: 'r3', line_id: 'L1', kind: 'risk', body: 'slot re-booked 14 Nov', closes_id: 'r1',
      visibility: 'internal', dispute_id: null, created_by_name: 'Sundar', created_at: '2026-08-05' },
  ];
  const r = await raida.list('e1', 'c1', 'L1');
  t('a closing row is not listed as an entry', r.entries.length === 2, r.entries.length + ' entries');
  const r1 = r.entries.find((e) => e.raida_id === 'r1');
  t('the entry it closes reads as closed', !!r1 && r1.open === false);
  /* ⚠️ The reason lives on the closing row — "we re-booked" and "the customer withdrew" are different
     endings, and a boolean could not tell them apart. */
  t('and carries the closing words as its reason', !!r1 && r1.closed_note === 'slot re-booked 14 Nov', r1 && r1.closed_note);
  t('who ended it travels too', !!r1 && r1.closed_by === 'Sundar');
  const r2 = r.entries.find((e) => e.raida_id === 'r2');
  t('an entry nothing closes reads as open', !!r2 && r2.open === true);
  t('the counts agree with the log', r.open === 1 && r.closed === 1, 'open ' + r.open + ' closed ' + r.closed);

  console.log('\n-- \u2b50 scope: authored at a level, read with inheritance --');
  t('a line entry is scoped to the line', !!r1 && r1.scope === 'line');
  t('an order entry is scoped to the order', !!r2 && r2.scope === 'order');
  /* ⚠️ inherited is not a second KIND of entry — it is the same entry read from somewhere that does not
     own it, and the flag only tells the screen not to offer "close" from there. */
  t('read from a line, the order entry is marked inherited', !!r2 && r2.inherited === true);
  const whole = await raida.list('e1', 'c1');
  t('read from the chit, nothing is inherited', whole.entries.every((e) => e.inherited === false));

  console.log('\n-- the SQL asks the right question --');
  SQL = []; await raida.list('e1', 'c1', 'L1');
  t('a line read also pulls order-level entries', flat().indexOf('(a.line_id = $3 OR a.line_id IS NULL)') >= 0);
  SQL = []; await raida.list('e1', 'c1', null);
  t('null asks for order-level ONLY', /line_id IS NULL/.test(flat()) && !/line_id = \$/.test(flat()));
  SQL = []; await raida.list('e1', 'c1');
  t('undefined asks for everything on the chit', !/a.line_id IS NULL/.test(flat()));

  console.log('\n-- \u26a0\ufe0f what a phase-0 entry may say --');
  ROWS = [{ raida_id: 'n1', created_at: 'now' }];
  const badKind = await caught(() => raida.add('e1', 'c1', { kind: 'blocker', body: 'x' }));
  t('an unknown kind is refused', !!badKind && badKind.status === 400, badKind && badKind.message);
  t('  ...and the message lists the six', !!badKind && /risk[\s\S]*decision/.test(badKind.message));
  const blank = await caught(() => raida.add('e1', 'c1', { kind: 'risk', body: '   ' }));
  t('an entry that says nothing is refused', !!blank && blank.status === 400);
  /* ⭐⭐ THE DEFAULT MUST BE internal. An entry saying our own supplier may slip must never reach the
     counterparty because a caller left the field off. */
  SQL = []; await raida.add('e1', 'c1', { kind: 'risk', body: 'ok' });
  t('visibility defaults to internal', SQL[0].args[5] === 'internal', String(SQL[0].args[5]));
  SQL = []; await raida.add('e1', 'c1', { kind: 'risk', body: 'ok', visibility: 'public' });
  t('an unknown visibility falls back to internal, never through', SQL[0].args[5] === 'internal');
  SQL = []; await raida.add('e1', 'c1', { kind: 'risk', body: 'ok', visibility: 'shared' });
  t('shared is honoured when asked for', SQL[0].args[5] === 'shared');

  console.log('\n-- closing appends; it never updates --');
  SQL = [];
  let call = 0;
  fakeDb.query = async (text, args) => {
    SQL.push({ text: String(text).replace(/\s+/g, ' ').trim(), args }); call++;
    if (call === 1) return { rows: [{ kind: 'risk', line_id: 'L1', closes_id: null }] };  // the entry
    if (call === 2) return { rows: [] };                                                  // nothing closes it yet
    return { rows: [{ raida_id: 'close1', created_at: 'now' }] };
  };
  const c = await raida.close('e1', 'c1', 'r1', { body: 'booked' });
  t('closing INSERTs, never UPDATEs', /INSERT INTO/.test(SQL[SQL.length - 1].text) && !/UPDATE/.test(flat()));
  t('the closing row points at what it closes', SQL[SQL.length - 1].args.indexOf('r1') >= 0);
  t('and it returns both ids', c.closed === 'r1' && !!c.closing_row);

  call = 0;
  fakeDb.query = async (text, args) => {
    SQL.push({ text: String(text).replace(/\s+/g, ' ').trim(), args }); call++;
    if (call === 1) return { rows: [{ kind: 'risk', line_id: 'L1', closes_id: null }] };
    return { rows: [{ x: 1 }] };                                                          // already closed
  };
  const twice = await caught(() => raida.close('e1', 'c1', 'r1', {}));
  /* ⚠️ Idempotent by REFUSAL, not by silence: a second closing row would give one entry two endings. */
  t('closing an already-closed entry refuses', !!twice && twice.status === 400, twice && twice.message);

  console.log('\n-- \u26a0\ufe0f\u26a0\ufe0f raising a dispute is NOT reimplemented here --');
  const src = require('fs').readFileSync(API + '/lib/raida.js', 'utf8');
  /* ⚠️ Read the CODE, not the prose. Three times this week a source assertion matched the comment
     explaining why something is not done. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  t('no dispute table is written from this file', !/INTO\s+chit_disputes/i.test(code));
  t('only an id is recorded', /SET dispute_id/.test(code));
  t('and only against an ISSUE', /kind = 'issue'/.test(code));

  console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
  process.exitCode = fail ? 1 : 0;
})();
