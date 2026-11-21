/**
 * message-client-id.test.cjs — F5b (1128): POST /messages with a client_msg_id drops a duplicate.
 * Figures: same (sender, chit, id) -> same message id; another sender -> another id; a retry finds my copy and answers it (no second write); a non-uuid id -> 400 CLIENT_MSG_ID_INVALID; none -> null (as before).
 * Run: node tests/message-client-id.test.cjs
 */
'use strict';
const M = require('../lib/message-client-id');
let pass = 0, fail = 0;
const eq = (n, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w); ok ? pass++ : fail++; console.log((ok ? '   ok   ' : '   FAIL ') + n + (ok ? '' : ' got ' + JSON.stringify(g) + ' want ' + JSON.stringify(w))); };
(async () => {
  const id = '9b2f3c1e-1111-4222-8333-444455556666';
  const a = M.scopedId('shopA', 'chit1', id), b = M.scopedId('shopA', 'chit1', id), c = M.scopedId('shopB', 'chit1', id), d = M.scopedId('shopA', 'chit2', id);
  eq('same sender, chit and id -> the same message id, uuid-shaped', [a === b, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(a)], [true, true]);
  eq('another sender or another chit -> another id (nobody can collide or plant one)', [a !== c, a !== d], [true, true]);
  const store = new Map(); let writes = 0;
  const db = { query: async (sql, p) => ({ rows: store.has(p[0] + p[1]) ? [{ message_id: p[0], thread_type: 'external', message_text: 'hi', created_at: 't1' }] : [] }) };
  const post = async () => { const first = await M.heldAlready(db, 'shopA', 'chit1', a); if (first) return { duplicate: true }; writes++; store.set(a + 'shopA', 1); return { duplicate: false }; };
  eq('timeout then retry with the same client id: one write, the retry is told duplicate', [(await post()).duplicate, (await post()).duplicate, writes], [false, true, 1]);
  eq('no client id -> null (the route posts as it always did)', M.clientIdOf({ message_text: 'x' }), null);
  let code = null; try { M.clientIdOf({ client_msg_id: 'not-a-uuid' }); } catch (e) { code = e.code + ':' + e.status; }
  eq('a non-uuid id is refused', code, 'CLIENT_MSG_ID_INVALID:400');
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
