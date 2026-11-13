#!/usr/bin/env node
/**
 * tests/bounds.test.cjs — THE SHARED BOUND FRAGMENTS REFUSE WHAT THEY SAY AND LET A FITTING VALUE THROUGH (SHARED-CHECKS slice 0a, 2026-11-09). No database, no network.
 *
 * OWNS     the unit proof of lib/bounds.js and of the two ajv formats and the bound sentences in middleware/validate.js
 * FLOW     each fragment: a value that fits passes, each out-of-bound value is refused as WRONG_VALUE with the field named and the shopkeeper sentence
 */
'use strict';
const B = require('../lib/bounds');
const { bodyEngine, urlEngine, errorsOf, isCalendarDay, REGISTERED_FORMATS } = require('../middleware/validate');
const ceiling = require('../lib/chit-ceiling');

let checks = 0, failed = 0;
const check = (what, ok, extra) => { checks++; if (!ok) failed++; console.log((ok ? '  ✓ ' : '  ✗ ') + what + (extra ? '   ' + extra : '')); };

/** the errors one value draws from one fragment, as the route would answer them */
const refusedBy = (fragment, value, engine) => errorsOf((engine || bodyEngine).compile({ type: 'object', properties: { field: fragment }, required: ['field'] }), { field: value });
const passes = (fragment, value, engine) => refusedBy(fragment, value, engine).length === 0;
const refuses = (fragment, value, engine) => { const found = refusedBy(fragment, value, engine); return found.length > 0 && found.every((item) => item.field === 'field' && item.code === 'WRONG_VALUE'); };

const q = B.qty({ column: 'quantity' });
check('qty: 5 and 0.001 pass', passes(q, 5) && passes(q, 0.001));
check('qty: 0, -1, 1e15, 1e308, true, "5" refused', [0, -1, 1e15, 1e308, true, '5'].every((v) => refuses(q, v)));
check('qty ceiling is the chit column ceiling (one number)', q.exclusiveMaximum === ceiling.ceilingOf('quantity'));
check('qty of an unknown column throws', (() => { try { B.qty({ column: 'nope' }); return false; } catch (e) { return /no ceiling row/.test(e.message); } })());

const m = B.minor({ column: 'total' });
check('minor: 0 and 12345 pass', passes(m, 0) && passes(m, 12345));
check('minor: -1, 100.5, 1e15, 1e300, true refused', [-1, 100.5, 1e15, 1e300, true].every((v) => refuses(m, v)));
check('minor signed: -50 passes, 1e15 still refused', passes(B.minor({ column: 'total', signed: true }), -50) && refuses(B.minor({ column: 'total', signed: true }), 1e15));

const am = B.amount({ column: 'total', signed: true });
check('amount signed: 0.01, -50 and 9999999999999.99 pass', passes(am, 0.01) && passes(am, -50) && passes(am, 9999999999999.99));
check('amount: 1e13, 2^53, 1e308, true, "50", null refused', [1e13, 9007199254740992, 1e308, -1e13, true, '50', null].every((v) => refuses(am, v)));
check('amount unsigned refuses -1; its ceiling is the column ceiling (one number)', refuses(B.amount({ column: 'total' }), -1) && am.exclusiveMaximum === ceiling.ceilingOf('total'));
check('holds: the cost cap agrees with the schema (inside passes; 1e13, -1e13, NaN, Infinity, a text refused)', B.holds(B.COST_AMOUNT, 9999999999999.99) && B.holds(B.COST_AMOUNT, -50) && [1e13, -1e13, NaN, Infinity, '5'].every((v) => !B.holds(B.COST_AMOUNT, v)));
check('int32: 0 and 2147483647 pass; 2147483648, 1.5, 1e308, true refused; signed takes -5', passes(B.int32(), 2147483647) && [2147483648, 1.5, 1e308, true, -1].every((v) => refuses(B.int32(), v)) && passes(B.int32({ signed: true }), -5));

const d = B.day();
check('day: 2026-11-09 passes', passes(d, '2026-11-09'));
check('day: 2026-02-30, 2026-13-01, 0001-01-01, 9999-12-31, "abc", 20261109, a date-time refused', ['2026-02-30', '2026-13-01', '0001-01-01', '9999-12-31', 'abc', 20261109, '2026-11-09T10:00:00Z'].every((v) => refuses(d, v)));
check('day: the format reads isCalendarDay itself (one reader)', REGISTERED_FORMATS['calendar-day'] === isCalendarDay);
check('date-time-day: a day with a time passes, 2026-02-30T10:00 refused', passes(B.day({ dateTime: true }), '2026-11-09T10:00:00Z') && refuses(B.day({ dateTime: true }), '2026-02-30T10:00:00Z'));
check('day in a query (url engine) is read by the same format', refuses(d, '2026-02-30', urlEngine) && passes(d, '2026-11-09', urlEngine));
check('day sentence says "a real date"', /must be a real date\./.test(refusedBy(d, '2026-02-30').map((e) => e.detail).join(' ')));

check('flag: true and false pass, "false" and 1 refused in a body', passes(B.flag(), false) && refuses(B.flag(), 'false') && refuses(B.flag(), 1));

const t = B.text({ max: 10 });
check('text: 10 chars pass, 11 refused with its sentence', passes(t, '0123456789') && refuses(t, '01234567890') && /at most 10 characters/.test(refusedBy(t, '01234567890')[0].detail));
check('text: a control character refused, newline and tab only where lines is set', refuses(t, 'a\u0000b') && refuses(t, 'a\nb') && passes(B.text({ lines: true }), 'a\nb\tc') && refuses(B.text({ lines: true }), 'a\u0007b'));

check('page and limit: 1 passes; 0, 10001, 201, 1.5 refused', passes(B.page(), 1) && refuses(B.page(), 0) && refuses(B.page(), 10001) && passes(B.limit(), 200) && refuses(B.limit(), 201) && refuses(B.limit(), 1.5));
check('list: at most max items', passes(B.list({ of: { type: 'string' }, max: 2 }), ['a', 'b']) && refuses(B.list({ of: { type: 'string' }, max: 2 }), ['a', 'b', 'c']));
check('oneOf: a junk word is refused', passes(B.oneOf(['open', 'paid']), 'paid') && refuses(B.oneOf(['open', 'paid']), 'all'));
check('every refusal says which field and gives a sentence', refusedBy(q, 0)[0].detail === 'field must be more than 0.' && refusedBy(m, -1)[0].detail === 'field must be at least 0.');
/* a schema a route wrote by hand keeps ajv's own words byte for byte: only a bounds.js fragment (x-bound) gets the shopkeeper sentence */
check('a hand-written exclusiveMinimum keeps ajv words, no x-bound sentence', refusedBy({ type: 'number', exclusiveMinimum: 0 }, 0)[0].detail === 'field must be > 0.' && refusedBy({ type: 'string', pattern: '^a' }, 'b')[0].detail === 'field must match pattern "^a".');
console.log('\n' + checks + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
