'use strict';
/**
 * tests/support/bound-db.cjs — the offline stand-in for db.queryAs / db.queryFor (SEC-185, SEC-75).
 * OWNS    one honest double of "one statement under ONE shop's binding", so a test that mocks ../db cannot skip the shop.
 * CALLED BY every offline test that stubs ../db and reaches a bound reader (lib/catalogue-write, routes/schemas, lib/schema-bootstrap, routes/catalogue-face ...).
 * WHY     the real queryAs opens exactly the rows of the bound shop (row security, b861/b862). A double that returns the same rows for every id proves nothing,
 *         so this one fails closed the way the database does:
 *           · a blank id binds nothing and sees no row;
 *           · a statement whose own predicate (`entity_id = $n`) names ANOTHER shop than the binding sees no row;
 *           · every call is recorded ({ id, sql, params }) so a test can assert that the read was bound, and to whom.
 * Usage   const bound = boundDb((sql, params, id) => rows);  exports: { query, queryAs: bound.queryAs, queryFor: bound.queryFor }; bound.calls, bound.boundTo()
 */
const PREDICATE = /\bentity_id\s*=\s*\$(\d+)/;
const TABLES = /\b(?:entity_schemas|schema_fields)\b/;
const none = () => ({ rows: [], rowCount: 0 });
const answer = (out) => (out && !Array.isArray(out) && typeof out === 'object' && 'rows' in out ? out : { rows: out || [], rowCount: (out || []).length });

/** rowsFor(sql, params, id) -> rows | { rows }: what the database would give THIS binding (id is the shop the statement is bound to) */
function boundDb(rowsFor) {
  const calls = [];
  const run = async (id, sql, params) => {
    calls.push({ id, sql: String(sql), params: params || [] });
    if (id === undefined || id === null || id === '') return none();
    const hit = PREDICATE.exec(String(sql));
    if (hit && String((params || [])[Number(hit[1]) - 1]) !== String(id)) return none();
    return answer(await rowsFor(String(sql), params || [], id));
  };
  return {
    calls,
    queryAs: run,
    queryFor: (id) => (sql, params) => run(id, sql, params),
    /** the distinct shops the bound statements ran for, in first-seen order */
    boundTo: () => [...new Set(calls.map((c) => c.id))],
  };
}

/**
 * schemaRows(shops) -> a rowsFor part: the rows of entity_schemas / schema_fields for { [shopId]: { schema_id, schema_name?, fields: [...] } }, one shop's rules never another's.
 * Answers the three shapes the bound readers send (lib/catalogue-write): the default schema, its fields (with the shop predicate), and both in one WITH. null = not a schema statement.
 */
function schemaRows(shops) {
  return (sql, params, id) => {
    if (!TABLES.test(sql)) return null;
    const mine = shops[id];
    if (!mine) return [];
    if (/WITH d AS/.test(sql)) return mine.fields.length ? mine.fields.map((f) => Object.assign({ schema_id: mine.schema_id }, f)) : [{ schema_id: mine.schema_id, field_key: null }];
    if (/FROM schema_fields/.test(sql)) return params[0] === mine.schema_id ? mine.fields : [];
    return [Object.assign({ schema_id: mine.schema_id }, mine.schema_name ? { schema_name: mine.schema_name } : {})];
  };
}

/** the plain (unbound) reader of a double: a row-secured table read WITHOUT the shop's binding is the bug SEC-75 closes, so it throws instead of answering */
function refuseUnbound(sql) {
  if (TABLES.test(sql)) throw new Error('unbound read of a row-secured table (use queryAs): ' + String(sql).split(/\s+/).join(' ').slice(0, 80));
}

module.exports = { boundDb, schemaRows, refuseUnbound };
