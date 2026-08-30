/**
 * tests/raida.test.cjs — the register (b182 phase 0, b185 the capability).
 *
 * ⭐⭐ TWO PROPERTIES CARRY EVERYTHING ELSE:
 *   1. STATE IS COMPUTED, NOT STORED — open means nothing closes it. No status column, so nothing can drift out
 *      of step with the log, and "what did we think on the 14th" survives the entry ceasing to be true.
 *   2. NOTHING IS EVER UPDATEd — a change is a REVISION row, an ending is a CLOSING row. That is why fields could
 *      be added at all: an owner UPDATEd in place destroys what was believed at the time.
 *
 * ⚠️⚠️ AND THE SHAPE IS RESOLVED AT RUNTIME, which is what most of these assertions guard. b185 renames the table
 * and adds the capability; between deploy and the migration being run by hand, whichever table exists is the one
 * that answers. A rename is the one migration old code cannot limp through — proven the hard way on 2026-08-30,
 * when b185 was applied before this code shipped and every read went to migrated:false.
 */
const API = 'C:/dev/chitbridge-api';

let ROWS = [], SQL = [], TABLES = new Set();
const fakeDb = {
  query: async (text, args) => {
    SQL.push({ text: String(text).replace(/\s+/g, ' ').trim(), args });
    return { rows: typeof ROWS === 'function' ? ROWS(String(text)) : ROWS };
  },
};
require.cache[require.resolve(API + '/db')] = { exports: {
  withEntity: async (id, fn) => fn(fakeDb),
  onEntity: async (id, db, fn) => fn(db && db.query ? db : fakeDb),
  query: async () => ({ rows: [] }),
} };
/* ⭐ Per-table, so both schemas can be driven from one file. A blanket `true` is what made the first version of
   this test claim the full capability on a phase-0 database. */
require.cache[require.resolve(API + '/lib/schema')] = { exports: {
  hasTable: async (t) => TABLES.has(t), hasColumn: async () => true, hasColumns: async () => ({}), _reset() {},
} };
const raida = require(API + '/lib/raida');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  \u2717 ' + name + (extra ? '   ' + extra : '')); }
};
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const flat = () => SQL.map((q) => q.text).join(' | ');
const PHASE0 = () => { TABLES = new Set(['chit_line_raida']); };
const FULL = () => { TABLES = new Set(['register_entry', 'register_subject', 'register_attachable', 'register_template']); };

(async () => {
  console.log('\n-- \u26a0\ufe0f\u26a0\ufe0f which schema is on this database --');
  TABLES = new Set();
  t('nothing migrated: a read is empty, not an error', (await raida.list('e1', 'c1')).migrated === false);
  const w0 = await caught(() => raida.add('e1', 'c1', { kind: 'risk', body: 'x' }));
  t('nothing migrated: a write refuses, naming b182', !!w0 && w0.status === 503 && /b182/.test(w0.message));

  PHASE0();
  let sh = await raida.shape();
  t('only the old table: phase-0 shape', sh.table === 'chit_line_raida' && sh.full === false);
  FULL();
  sh = await raida.shape();
  /* ⚠️ register_subject is the flag, not a column probe — naming a column that does not exist raises 42703,
     which this file turns into a BLANK screen rather than an error. */
  t('register_subject present: full capability', sh.table === 'register_entry' && sh.full === true);

  console.log('\n-- \u2b50\u2b50 open and closed are DERIVED, and a revision folds over the original --');
  FULL();
  ROWS = [
    { raida_id: 'r1', line_id: 'L1', kind: 'risk', body: 'bearing wear', closes_id: null, revises_id: null,
      visibility: 'internal', severity: 4, likelihood: 2, owner_name: 'Rao', created_by_name: 'Rao', created_at: '01' },
    /* a REVISION: the severity was re-rated. The original stays readable. */
    { raida_id: 'r2', line_id: 'L1', kind: 'risk', body: 're-rated after run 12', closes_id: null, revises_id: 'r1',
      visibility: 'internal', severity: 3, created_by_name: 'Rao', created_at: '02' },
    { raida_id: 'r3', line_id: null, kind: 'dependency', body: 'crane by the 22nd', closes_id: null, revises_id: null,
      visibility: 'shared', to_id: 'X1', to_type: 'line', rel_type: 'finish_to_start', created_by_name: 'K', created_at: '03' },
    /* a CLOSING row, carrying the disposition */
    { raida_id: 'r4', line_id: null, kind: 'dependency', body: 'crane confirmed', closes_id: 'r3', revises_id: null,
      disposition: 'resolved', created_by_name: 'K', created_at: '04' },
  ];
  const L = await raida.list('e1', 'c1', 'L1');
  t('revisions and closing rows are not entries', L.entries.length === 2, L.entries.length + ' entries');
  const e1 = L.entries.find((e) => e.raida_id === 'r1');
  t('the revision wins on the field it changed', !!e1 && e1.severity === 3, e1 && String(e1.severity));
  t('  ...and the fields it left alone survive', !!e1 && e1.likelihood === 2 && e1.owner === 'Rao');
  t('  ...and the entry is marked revised', !!e1 && e1.revised === true);
  t('score is derived, never stored', !!e1 && e1.score === 6, e1 && String(e1.score));
  const e3 = L.entries.find((e) => e.raida_id === 'r3');
  t('a closed entry carries its disposition', !!e3 && e3.open === false && e3.disposition === 'resolved');
  /* ⭐⭐ THE EDGE — a dependency that POINTS is walkable; one that does not is a sentence. */
  t('a dependency that points reads as an edge', !!(e3 && e3.edge && e3.edge.to_id === 'X1'));
  t('and inherits onto the line it does not own', !!e3 && e3.inherited === true);

  console.log('\n-- \u26a0\ufe0f an ending needs a disposition, and it must not default --');
  ROWS = (sqlText) => (/SELECT 1 FROM/.test(sqlText) ? [] : [{ kind: 'risk', line_id: 'L1', closes_id: null,
    subject_id: 'S1', chit_id: 'c1', raida_id: 'new', created_at: 'now' }]);
  const noDisp = await caught(() => raida.close('e1', 'c1', 'r1', { body: 'done' }));
  t('closing without one is refused', !!noDisp && noDisp.status === 400, noDisp && noDisp.message);
  t('  ...and the message lists the six', !!noDisp && /resolved[\s\S]*waived/.test(noDisp.message));
  const badDisp = await caught(() => raida.close('e1', 'c1', 'r1', { body: 'x', disposition: 'done' }));
  t('an unknown disposition is refused', !!badDisp && badDisp.status === 400);
  /* ⚠️ "We will deal with it later" without a later is how a finding disappears while looking dispositioned. */
  const noWhere = await caught(() => raida.close('e1', 'c1', 'r1', { disposition: 'carried_forward' }));
  t('carrying forward must name where to', !!noWhere && /register it moves to/.test(noWhere.message));
  SQL = [];
  const ok = await raida.close('e1', 'c1', 'r1', { body: 'fixed', disposition: 'resolved' });
  t('a proper ending is INSERTed, never an UPDATE', ok.disposition === 'resolved'
    && /INSERT INTO register_entry/.test(SQL[SQL.length - 1].text) && !/UPDATE register_entry/.test(flat()));

  console.log('\n-- \u2b50\u2b50 THE GATE: a register may not close while anything is undispositioned --');
  ROWS = (sqlText) => {
    if (/FROM register_subject/.test(sqlText)) return [{ subject_id: 'S1', name: 'Campaign', closed_at: null }];
    if (/NOT EXISTS/.test(sqlText)) return [{ raida_id: 'o1', kind: 'risk', body: 'bearing wear' },
                                            { raida_id: 'o2', kind: 'issue', body: 'igniter delay' }];
    return [{ subject_id: 'S1', closed_at: 'now' }];
  };
  const blocked = await caught(() => raida.closeSubject('e1', 'S1', {}));
  t('closing is refused while entries are open', !!blocked && blocked.status === 409, blocked && blocked.message);
  /* ⚠️ "2 still open" without the two sends someone hunting. The refusal NAMES them. */
  t('and the refusal names what is outstanding', !!blocked && !!blocked.outstanding && blocked.outstanding.length === 2,
    blocked && blocked.outstanding && blocked.outstanding.map((x) => x.kind).join(','));
  ROWS = (sqlText) => {
    if (/FROM register_subject/.test(sqlText)) return [{ subject_id: 'S1', name: 'Campaign', closed_at: null }];
    if (/NOT EXISTS/.test(sqlText)) return [];                    // everything dispositioned
    return [{ subject_id: 'S1', closed_at: 'now' }];
  };
  const shut = await raida.closeSubject('e1', 'S1', { by_name: 'Rao' });
  t('with everything dispositioned it closes', shut.closed === 'S1');

  console.log('\n-- \u2b50\u2b50 the library: one risk, many places, and the mapping is COPIED --');
  SQL = [];
  ROWS = (sqlText) => {
    if (/FROM register_template WHERE/.test(sqlText)) return [{ title: 'Supplier may miss the window',
      body: null, likelihood: 3, severity: 4, treatment: 'book earlier', verification_method: 'inspection' }];
    if (/register_template_standard/.test(sqlText)) return [{ standard_key: 'iso-9001', clause: '8.4' }];
    if (/FROM register_subject/.test(sqlText)) return [{ subject_id: 'S1', closed_at: null }];
    return [{ raida_id: 'new1', created_at: 'now' }];
  };
  const made = await raida.add('e1', 'c1', { kind: 'risk', template_id: 'T1' });
  t('a library entry fills what the instance leaves blank', made.raida_id === 'new1');
  /* ⚠️ COPIED, NOT JOINED. Reading standards THROUGH the template would let editing it silently rewrite what an
     audit was told last year — the same per-copy discipline as every other record here. */
  t('its standards are written onto the instance', /INSERT INTO register_entry_standard/.test(flat()));
  /* ⚠️ The clause travels inside an ARRAY now — the mappings are batched through unnest() rather than
     inserted one at a time, after query-shape.test.js caught the N+1. Flattened before looking. */
  const argsFlat = SQL.reduce(function(a, q2){ return a.concat([].concat.apply([], (q2.args||[]))); }, []);
  t('  ...carrying the clause, not just the standard', argsFlat.indexOf('8.4') >= 0);

  console.log('\n-- \u26a0\ufe0f phase 0 still answers exactly as it did --');
  PHASE0();
  SQL = []; ROWS = [{ raida_id: 'p1', created_at: 'now' }];
  const p0 = await raida.add('e1', 'c1', { kind: 'risk', body: 'still works' });
  t('a phase-0 database still takes entries', p0.full === false && p0.raida_id === 'p1');
  /* ⚠️ The new columns must never be NAMED on the old shape — that is the 42703 that blanks a screen. */
  t('and the insert names no b185 column',
    !/subject_id|likelihood|disposition|revises_id/.test(flat()));
  const noGate = await caught(() => raida.closeSubject('e1', 'S1', {}));
  t('the gate refuses cleanly before b185', !!noGate && noGate.status === 503 && /b185/.test(noGate.message));

  console.log('\n-- \u26a0\ufe0f\u26a0\ufe0f the dispute path is still not reimplemented --');
  const src = require('fs').readFileSync(API + '/lib/raida.js', 'utf8');
  /* Read the CODE, not the prose — four times this week a source assertion matched the comment explaining why
     something is NOT done. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  t('no dispute table is written from this file', !/INTO\s+chit_disputes/i.test(code));
  t('only an id is recorded, and only on an issue', /SET dispute_id/.test(code) && /kind = 'issue'/.test(code));


  console.log('\n-- \u26a0\ufe0f\u26a0\ufe0f an empty registry must SAY WHY, never just be empty --');
  /* ⭐⭐ THE 2026-08-30 BUG. `hasTable` reads information_schema, which hides a table the role holds no privilege
     on — so "never created" and "created but never GRANTed" both arrived as a bare []. The second is invisible
     from every other angle: the foreign key INTO this table still held, so a register opened fine while the list
     of what a register may attach to read as empty. Three causes, three answers. */
  FULL();
  ROWS = [{ type_key: 'campaign', label: 'Test campaign', points_at: null }];
  const okAtt = await raida.attachables();
  t('a readable registry returns its rows, undegraded', okAtt.attachables.length === 1 && okAtt.degraded === null);

  const raise = (code) => { ROWS = () => { const e = new Error(code); e.code = code; throw e; }; };
  raise('42P01');
  t('absent table  \u2192 degraded:absent',  (await raida.attachables()).degraded === 'absent');
  raise('42501');
  /* ⚠️ THE ONE THAT LIED. A missing GRANT is not a missing migration and must not read as one. */
  t('missing GRANT \u2192 degraded:no-grant', (await raida.attachables()).degraded === 'no-grant');
  ROWS = [];
  t('present but unseeded \u2192 degraded:empty', (await raida.attachables()).degraded === 'empty');
  /* Anything else is a real fault and must not be swallowed into a tidy empty list. */
  raise('08006');
  const boom = await caught(() => raida.attachables());
  t('any other error still throws', !!boom && boom.code === '08006');

  console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
  process.exitCode = fail ? 1 : 0;
})();
