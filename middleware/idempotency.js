// middleware/idempotency.js — server-side idempotency for the offline OUTBOX (Phase 2). A mutation carrying an
// `Idempotency-Key` header is executed AT MOST ONCE per (entity, key): the first request runs and its response is
// recorded; any REPLAY with the same key returns the recorded response WITHOUT re-executing — so an outbox replay on
// reconnect can never mint a second chit / form / credential. Concurrent in-flight duplicate → 409; same key reused with
// a DIFFERENT body → 422. Opt-in (no header ⇒ untouched) and SELF-HEALING (store missing ⇒ proceeds without idempotency,
// never breaks a request) so it is safe to deploy before b109 is run. Scoped per entity, WITH RLS (via withEntity).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { withEntity } = require('../db');

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

// deterministic stringify so the request fingerprint is stable regardless of key order
function stable(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

// scope from the SAME bearer token auth uses (parent_entity_id || identity_id); null ⇒ let the route's auth reject it
function scope(req) {
  try {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return null;
    const d = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!d.identity_id) return null;
    return d.parent_entity_id || d.identity_id;
  } catch (_) { return null; }
}

async function begin(entity, key, method, path, hash, windowHrs) {
  return withEntity(entity, async (db) => {
    const ex = await db.query(
      `SELECT idem_key, req_hash, state, status, response,
              (created_at < now() - ($2 || ' hours')::interval) AS expired
         FROM idempotency_key WHERE entity_id = $1 AND idem_key = $3`, [entity, String(windowHrs), key]);
    if (ex.rows[0] && !ex.rows[0].expired) return { existing: ex.rows[0] };
    if (ex.rows[0]) await db.query(`DELETE FROM idempotency_key WHERE entity_id = $1 AND idem_key = $2`, [entity, key]);   // expired → reclaim
    const ins = await db.query(
      `INSERT INTO idempotency_key (entity_id, idem_key, method, path, req_hash, state)
       VALUES ($1,$2,$3,$4,$5,'in_progress') ON CONFLICT (entity_id, idem_key) DO NOTHING RETURNING idem_key`,
      [entity, key, method, path, hash]);
    if (ins.rows[0]) return { claimed: true };
    const ex2 = await db.query(`SELECT idem_key, req_hash, state, status, response FROM idempotency_key WHERE entity_id = $1 AND idem_key = $2`, [entity, key]);
    return { existing: ex2.rows[0] };   // lost the insert race → treat as replay
  });
}

async function finalize(entity, key, status, body) {
  return withEntity(entity, async (db) => {
    if (status >= 500) {   // a server error is NOT a completed outcome — let a retry re-run it
      await db.query(`DELETE FROM idempotency_key WHERE entity_id = $1 AND idem_key = $2 AND state = 'in_progress'`, [entity, key]);
    } else {               // 2xx/3xx/4xx are settled outcomes — record so replays are consistent
      await db.query(`UPDATE idempotency_key SET state = 'done', status = $3, response = $4::jsonb WHERE entity_id = $1 AND idem_key = $2`,
        [entity, key, status, JSON.stringify(body == null ? null : body)]);
    }
  });
}

module.exports = function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key || !MUTATING.includes(req.method) || String(key).length > 200) return next();
  const entity = scope(req);
  if (!entity) return next();
  const hash = crypto.createHash('sha256').update(req.method + ' ' + req.path + ' ' + stable(req.body || {})).digest('hex');
  const windowHrs = Number(process.env.IDEMPOTENCY_WINDOW_HOURS || 48);

  begin(entity, key, req.method, req.path, hash, windowHrs).then((r) => {
    if (r.existing) {
      const ex = r.existing;
      if (ex.req_hash && ex.req_hash !== hash) return res.status(422).json({ error: 'Idempotency conflict', message: 'This Idempotency-Key was already used with a different request.' });
      if (ex.state === 'done') { res.setHeader('X-Idempotent-Replay', 'true'); return res.status(ex.status || 200).json(ex.response); }
      return res.status(409).json({ error: 'In progress', message: 'A request with this Idempotency-Key is still being processed.' });
    }
    // we own this key → capture the handler's JSON response, then run it
    let captured = false;
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (!captured) { captured = true; finalize(entity, key, res.statusCode, body).catch((e) => console.warn('[idempotency] finalize failed:', e.message)); }
      return origJson(body);
    };
    next();
  }).catch((e) => {
    // SELF-HEAL: table missing (pre-b109) or any store hiccup → run the request WITHOUT idempotency, never break it
    if (!(e && (e.code === '42P01' || e.code === '42703'))) console.warn('[idempotency] store error, proceeding without:', e.message);
    next();
  });
};

module.exports._stable = stable;
module.exports._scope = scope;
