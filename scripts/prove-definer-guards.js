// prove-definer-guards.js — DB-DIRECT proof of the three definer guards the reviewer flagged as untested:
//   NEW-1  — a non-raiser calling chit_dispute_resolve must RAISE ("only the raiser can resolve")
//   M2     — an unresolvable dispute roster must RAISE (never fall through to a broadcast)
//   M3/ROOT— chit_message_deliver called with NO entity context must RAISE ("no entity context")
// These call the definers DIRECTLY (via ../db withEntity/query), which the API can't reach (the route guards fire first).
// Setup uses the live API; assertions are DB-direct against the SAME database. Requires DATABASE_URL. node scripts/prove-definer-guards.js
try { require('dotenv').config(); } catch (_) {}   // load .env for the standalone script (the db module doesn't)
const { query, withEntity } = require('../db');
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
async function login(email) { const reg = await api('POST', '/api/entities/register', { body: { email } }); const v = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); return { token: v.j && v.j.token, id: v.j && v.j.entity && v.j.entity.identity_id }; }
const raised = async (fn, needle) => { try { await fn(); return { raised: false }; } catch (e) { return { raised: true, msg: e.message, match: needle ? new RegExp(needle, 'i').test(e.message) : true }; } };
const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/[x]/g, () => (Math.random() * 16 | 0).toString(16));

(async () => {
  console.log('== PROVE DEFINER GUARDS (NEW-1 · M2 · M3/ROOT) — DB-direct ==\n');
  // Preflight: this test needs a REAL DATABASE_URL (the same Supabase DB the API uses) — set it in .env or the env.
  // It cannot run against the live API alone; it calls the definers directly (which the API routes never expose).
  try { await query('SELECT 1'); }
  catch (e) { console.log('  ⚠ NO DATABASE CONNECTION — set DATABASE_URL to the Supabase DB and re-run.\n    (' + (e.message || e) + ')\n  RED-on-b68 / GREEN-on-b103 by construction; run this where the DB is reachable.'); process.exit(2); }
  // ── setup via the live API (same DB my ../db connects to) ──
  const ts = Date.now().toString().slice(-6);
  const a = await login('dg-a-' + ts + '@t.com');   // raiser
  const b = await login('dg-b-' + ts + '@t.com');   // party (non-raiser)
  const snd = await api('POST', '/api/chits/send', { token: a.token, body: { recipients: [{ entity_id: b.id, role: 'to' }], purpose: 'general', manual_subject: 'DG ' + ts, line_items: [{ description: 'x', qty: 1, rate: 1 }] } });
  const chit_id = snd.j && (snd.j.chit_id || (snd.j.chit && snd.j.chit.chit_id));
  const rz = await api('POST', '/api/chits/' + chit_id + '/disputes', { token: a.token, body: { category: 'quality', reason: 'definer-guard proof dispute', scope: 'targeted', target_entity_id: b.id } });
  const dispute_id = rz.j && (rz.j.dispute_id || (rz.j.dispute && rz.j.dispute.dispute_id));
  chk('setup: chit + dispute created (A=raiser, B=party)', !!chit_id && !!dispute_id, 'dispute=' + (dispute_id ? dispute_id.slice(0, 8) : '—'));
  // sanity: my ../db sees the same dispute rows (confirms same DB)
  const seen = await query('SELECT count(*)::int AS n FROM chit_disputes WHERE dispute_id = $1', [dispute_id]).then(r => r.rows[0].n).catch(() => -1);
  chk('setup: ../db reaches the same database', seen >= 1, seen + ' dispute copies');

  // ── NEW-1 — B (non-raiser) calls chit_dispute_resolve inside withEntity(B) → must RAISE ──
  {
    const r = await raised(() => withEntity(b.id, (c) => c.query('SELECT chit_dispute_resolve($1,$2,$3,$4)', [dispute_id, b.id, null, 'non-raiser attempt'])), 'raiser');
    chk('NEW-1: non-raiser resolve → RAISE ("only the raiser can resolve")', r.raised && r.match, r.raised ? r.msg.split('\n')[0].slice(0, 90) : 'did NOT raise (resolve succeeded!)');
  }

  // ── M3/ROOT — chit_message_deliver via plain query (NO entity context) → must RAISE ──
  {
    const r = await raised(() => query('SELECT chit_message_deliver($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [uuid(), chit_id, a.id, 'A', 'external', 'no-context attempt', 'info', false, null]), 'no entity context');
    chk('M3/ROOT: deliver with NO context → RAISE ("no entity context")', r.raised && r.match, r.raised ? r.msg.split('\n')[0].slice(0, 90) : 'did NOT raise');
  }

  // ── M2 — delete every roster row, then a dispute message must RAISE (never broadcast) ──
  {
    // count non-party message copies before (Gamma / anyone not in the dispute)
    await withEntity(a.id, (c) => c.query('DELETE FROM chit_disputes WHERE dispute_id = $1', [dispute_id]));   // A deletes its copy
    await withEntity(b.id, (c) => c.query('DELETE FROM chit_disputes WHERE dispute_id = $1', [dispute_id]));   // B deletes its copy
    const left = await query('SELECT count(*)::int AS n FROM chit_disputes WHERE dispute_id = $1', [dispute_id]).then(r => r.rows[0].n);
    chk('M2 setup: roster fully deleted', left === 0, left + ' rows left');
    const msgId = uuid();
    const r = await raised(() => withEntity(a.id, (c) => c.query('SELECT chit_message_deliver($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [msgId, chit_id, a.id, 'A', 'external', 'should NOT broadcast', 'info', true, dispute_id])), 'party|belong|roster|broadcast');
    chk('M2: dispute message with an empty roster → RAISE (refuses)', r.raised && r.match, r.raised ? r.msg.split('\n')[0].slice(0, 90) : 'did NOT raise (BROADCAST!)');
    const leaked = await query('SELECT count(*)::int AS n FROM chit_messages WHERE message_id = $1', [msgId]).then(r => r.rows[0].n).catch(() => -1);
    chk('M2: and NOTHING was written (zero message copies) — no broadcast', leaked === 0, leaked + ' message rows');
  }

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
