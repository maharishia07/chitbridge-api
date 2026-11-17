'use strict';
/**
 * policy-patch.cjs — a stand-in database's reading of policy.patchKey (T2-POLICY, 2026-10-14).
 *
 * Every write of identities.policy_flags is now ONE statement built by lib/policy.js patchSql — one SQL shape per op — so a test's
 * stand-in db applies it here instead of matching each writer's private SQL:
 *   PP.isPatch(sql)               → true for a patchKey statement
 *   PP.entityOf(sql, params)      → the identity_id it writes
 *   PP.apply(sql, params, flags)  → { rowCount, rows } after applying it to `flags` (the row's policy_flags object, changed in place)
 */
const isPatch = (sql) => /^\s*UPDATE identities SET policy_flags = /.test(sql) && /RETURNING identity_id\s*$/.test(sql);
const entityOf = (sql, params) => { const m = /WHERE identity_id = \$(\d+)/.exec(sql); return m ? params[Number(m[1]) - 1] : undefined; };
const at = (o, path) => path.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);

function apply(sql, params, flags) {
  const pf = flags;
  const hit = { rowCount: 1, rows: [{ identity_id: entityOf(sql, params) }] }, miss = { rowCount: 0, rows: [] };
  const eq = /AND policy_flags #>> \$(\d+)::text\[\] = \$(\d+)::text/.exec(sql);
  if (eq && String(at(pf, params[Number(eq[1]) - 1])) !== String(params[Number(eq[2]) - 1])) return miss;
  const ex = /AND policy_flags #> \$(\d+)::text\[\] IS NOT NULL/.exec(sql);
  if (ex && at(pf, params[Number(ex[1]) - 1]) === undefined) return miss;
  if (/^\s*UPDATE identities SET policy_flags = COALESCE\(policy_flags,'\{\}'::jsonb\) \|\| \$1::jsonb WHERE/.test(sql)) {
    Object.assign(pf, JSON.parse(params[0])); return hit;
  }
  const path = params[0].map(String), last = path[path.length - 1];
  const parent = (create) => { let o = pf; for (const k of path.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') { if (!create) return null; o[k] = {}; } o = o[k]; } return o; };
  if (/policy_flags = policy_flags #- \$1::text\[\]/.test(sql)) { const p = parent(false); if (p) delete p[last]; return hit; }
  if (/jsonb_agg\(CASE WHEN k->>\$2::text = \$3::text/.test(sql)) {
    const p = parent(true); const patch = JSON.parse(params[3]);
    p[last] = (Array.isArray(p[last]) ? p[last] : []).map((k) => (k && String(k[params[1]]) === String(params[2]) ? Object.assign({}, k, patch) : k));
    return hit;
  }
  if (/COALESCE\(policy_flags #> \$1::text\[\], '\{\}'::jsonb\) \|\| \$2::jsonb/.test(sql)) {
    const p = parent(true); p[last] = Object.assign({}, (p[last] && typeof p[last] === 'object') ? p[last] : {}, JSON.parse(params[1])); return hit;
  }
  const p = parent(!/= jsonb_set\(policy_flags, \$1::text\[\]/.test(sql));   /* parents: false → only when the parent is there */
  if (p) p[last] = JSON.parse(params[1]);
  return hit;
}
module.exports = { isPatch, entityOf, apply };
