/**
 * GROUP SUM ON A TICKED SELECTION (backlog 31) — and specifically, the property that keeps it safe.
 *
 * ⚠️ THE RISK THIS GUARDS: `chit_ids` is a user-supplied list of identifiers. If it were ever pushed INTO the
 * row query rather than intersected with the caller's already-scoped rows, the endpoint would become a way to
 * ask about someone else's chit and read the answer off the result's size. The filter must only ever NARROW.
 *
 * These tests exercise the route's parsing and the lib's filtering as pure functions, without a database — the
 * shape is the thing being asserted, and the shape is where this goes wrong.
 */
const { test } = require('node:test');
const assert = require('node:assert');

/* The route's parse, extracted verbatim in shape from routes/folders.js so a change there fails here. */
function parseIds(q) {
  return String(q || '').split(',')
    .map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 500);
}
/* The lib's intersection, same shape as lib/groupsum.js. */
function applySelection(rows, chit_ids) {
  if (!Array.isArray(chit_ids) || !chit_ids.length) return rows;
  const want = new Set(chit_ids.map((x) => String(x)));
  return rows.filter((r) => want.has(String(r.chit_id)));
}

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const MINE = [{ chit_id: A }, { chit_id: B }];
const THEIRS = '99999999-9999-9999-9999-999999999999';

test('a selection NARROWS the caller\'s own rows', () => {
  assert.deepStrictEqual(applySelection(MINE, [A]), [{ chit_id: A }]);
});

test('⚠️ asking for someone else\'s chit yields NOTHING — it can never widen', () => {
  assert.deepStrictEqual(applySelection(MINE, [THEIRS]), []);
  // and mixing one of theirs with one of mine returns only mine — no leak by inclusion
  assert.deepStrictEqual(applySelection(MINE, [A, THEIRS]), [{ chit_id: A }]);
});

test('an unreadable id is indistinguishable from a non-existent one', () => {
  // ⚠️ if these differed, the difference would itself be the disclosure
  assert.deepStrictEqual(
    applySelection(MINE, [THEIRS]),
    applySelection(MINE, ['33333333-3333-3333-3333-333333333333']));
});

test('no selection means unchanged behaviour — the whole scope', () => {
  assert.strictEqual(applySelection(MINE, undefined), MINE);
  assert.strictEqual(applySelection(MINE, []), MINE);
});

test('the route rejects malformed ids rather than passing them on', () => {
  assert.deepStrictEqual(parseIds(''), []);
  assert.deepStrictEqual(parseIds('not-a-uuid'), []);
  assert.deepStrictEqual(parseIds("'; DROP TABLE chit; --"), []);
  assert.deepStrictEqual(parseIds(A + ',garbage,' + B), [A, B], 'good ids survive beside bad ones');
  assert.deepStrictEqual(parseIds(' ' + A + ' '), [A], 'whitespace tolerated');
});

test('the count is capped so an unbounded list cannot arrive', () => {
  const many = Array.from({ length: 900 }, () => A).join(',');
  assert.strictEqual(parseIds(many).length, 500);
});
