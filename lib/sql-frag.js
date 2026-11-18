'use strict';
/**
 * lib/sql-frag.js — the one mark for a SQL fragment the CODE built (a column list, an allow-listed ORDER BY, a WHERE made of literals and $n placeholders).
 * OWNS      frag(text) · pick(map, key) (no route, no state)
 * CALLED BY routes/*.js that put a built fragment inside a query template: query(`SELECT ... WHERE ${frag(where)}`, params)
 * FLOW      frag(text) -> String(text), exactly what the bare ${} did; tools/api-reported.cjs counts a ${} as a value unless it is an UPPER_CASE constant, a $${n} placeholder number, or frag(...)
 * CARD      28-platform-and-operations/api-standard
 *
 * ⚠️ frag() WRAPS NOTHING THAT CAME FROM A REQUEST. A value goes in params ($1, $2 ...); an identifier or an ORDER BY word comes from a fixed list
 * (own-property lookup, never a bare map[req.query.x]: ?sort=constructor reached the prototype). frag marks a fragment the author read and traced to
 * literals, constants and placeholders, so a NEW bare ${} in SQL fails tests/sql-no-concat.test.cjs. It does not make a value safe.
 */
const frag = (text) => String(text);
/** the allow-listed word a request names: an OWN key of the map, else undefined (a bare map[req.query.x] also answers constructor and __proto__) */
const pick = (map, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined);
module.exports = { frag, pick };
