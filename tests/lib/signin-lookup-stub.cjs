'use strict';
/**
 * tests/lib/signin-lookup-stub.cjs — a stand-in for the two statements a sign-in now sends (SEC-184 step A), for the in-memory identities tables of the sign-in tests:
 *   SELECT * FROM ops.signin_candidates($1, $2)                           the definer lookup of migration b857 (the same seven kinds, the same eight columns, LIMIT 10, min 3)
 *   SELECT <cols> FROM identities WHERE identity_id = ANY($1::uuid[])    the credential read BY ID that follows it
 * answer(sql, params, rows) → { rows } for either statement, or null when the statement is another one (the caller's own stub goes on).
 * It models the function's rule, not the caller's: isAccount stays in the api. A stand-in that answered more than the function does would hide a leak.
 */
const lc = (v) => (v == null ? null : String(v).toLowerCase());
const COLUMNS = ['identity_id', 'identity_type', 'parent_entity_id', 'bridge_id', 'display_name', 'user_id', 'email', 'status'];
const KINDS = ['email', 'handle', 'name', 'phone', 'contact', 'id', 'doc'];
/** does this row answer (kind, key)? the WHERE of each branch of ops.signin_candidates */
function matches(r, kind, key, docs) {
  if (kind === 'email') return r.email != null && r.email === lc(key);
  if (kind === 'handle') return r.user_id != null && lc(r.user_id) === lc(key);
  if (kind === 'name') return lc(r.display_name) === lc(key) && r.identity_type === 'entity' && r.status === 'active';
  if (kind === 'phone') return r.identity_type === 'customer' && (r.phone === key || r.phone === '+' + key);
  if (kind === 'contact') return r.identity_type === 'customer' && r.otp_contact === key;
  if (kind === 'id') return r.identity_id === key;
  const i = key.indexOf(':');
  const hashes = key.slice(i + 1).split(',').slice(0, 10);
  return (docs || []).some((d) => d.identity_id === r.identity_id && d.scheme === key.slice(0, i) && hashes.indexOf(d.value_hash) !== -1 && d.status === 'verified' && d.verified_at);
}
/** the statement's column list split on top-level commas; `x AS y` reads as y */
const columnsOf = (list) => list.split(',').map((c) => c.trim()).map((c) => { const a = c.match(/ AS (\w+)$/i); return a ? a[1] : c; });
/** the rows the function returns for (kind, key): at most 10 by identity_id, [] under three characters (any kind but id) */
function lookup(rows, kind, key, docs) {
  if (KINDS.indexOf(kind) === -1) { const e = new Error('ops.signin_candidates: unknown kind'); e.code = '22023'; throw e; }
  if (key == null || (kind !== 'id' && String(key).trim().length < 3)) return [];
  return rows.filter((r) => matches(r, kind, String(key), docs)).sort((a, b) => (a.identity_id < b.identity_id ? -1 : 1)).slice(0, 10)
    .map((r) => { const o = {}; COLUMNS.forEach((c) => { o[c] = r[c] === undefined ? null : r[c]; }); return o; });
}
function answer(sql, params, allRows, docs) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  let m;
  if (/^SELECT \* FROM ops\.signin_candidates\(\$1, \$2\)$/i.test(s)) return { rows: lookup(allRows(), params[0], params[1], docs ? docs() : []) };
  if ((m = s.match(/^SELECT (.+?) FROM identities WHERE identity_id = ANY\(\$1::uuid\[\]\)$/i))) {
    const cols = columnsOf(m[1]);
    const rows = allRows().filter((r) => params[0].indexOf(r.identity_id) !== -1).map((r) => { const o = {}; cols.forEach((c) => { o[c] = r[c] === undefined ? null : r[c]; }); return o; });
    return { rows };
  }
  return null;
}
module.exports = { answer, lookup, COLUMNS, KINDS };
