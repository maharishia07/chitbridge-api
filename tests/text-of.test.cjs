/**
 * tests/text-of.test.cjs — textOf, the one read of a text value (FUZZ-8, 2026-11-18). OWNS the proof of lib/input-hygiene.js textOf. CALLED BY CI. No database.
 */
'use strict';
const { textOf } = require('../lib/input-hygiene');
const { known } = require('../lib/knownerr');
let fail = 0;
const t = (name, ok) => { if (!ok) fail++; console.log((ok ? '  ok  ' : '  XX  ') + name); };
const refused = (v, o) => { try { textOf(v, o); return null; } catch (e) { return e; } };

t('a string is trimmed', textOf('  a b ') === 'a b');
t('trim:false keeps it as typed', textOf('  a ', { trim: false }) === '  a ');
t('undefined, null and blank give the empty answer', textOf(undefined) === '' && textOf(null) === '' && textOf('  ') === '');
t('empty:null gives null', textOf(undefined, { empty: null }) === null && textOf('', { empty: null }) === null);
['object', 'array', 'number', 'boolean'].forEach((k, i) => {
  const e = refused([{ a: 1 }, ['a', 'b'], 7, true][i]);
  t(k + ' is refused 400 INVALID_INPUT', !!e && e.status === 400 && e.code === 'INVALID_INPUT' && e.refused === true);
});
t('max refuses a longer text, keeps a shorter', refused('abcd', { max: 3 }) !== null && textOf('abc', { max: 3 }) === 'abc');
const a = known(refused({}, { field: 'name' }));
t('the route catch answers it as the one 400 (knownerr)', !!a && a.status === 400 && a.body.code === 'INVALID_INPUT' && /name/.test(a.body.message));
process.exit(fail ? 1 : 0);
