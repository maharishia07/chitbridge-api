/** @covers FR-T3 — track record derived from the entity’s own settled chits, not self-asserted */
// prove-reference.js — LIVE proof of the SELF-PROVING REFERENCE (relationship rung). Two entities transact a real
// chit, the receiver settles it, and the sender's track record reflects 1 counterparty / 1 settled — DERIVED, not
// entered.  node scripts/prove-reference.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { if (ok) { P++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { F++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
async function login(email) { const reg = await api('POST', '/api/entities/register', { body: { email } }); const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); return { token: ver.j && ver.j.token, id: ver.j && ver.j.entity && ver.j.entity.identity_id }; }

(async () => {
  console.log('== PROVE SELF-PROVING REFERENCE / TRACK RECORD ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6);
  const buyer = await login('ref-buy-' + ts + '@test.com');   // places the order
  const seller = await login('ref-sell-' + ts + '@test.com'); // receives + fulfils it
  chk('buyer + seller login', !!buyer.token && !!seller.token, 'seller.id=' + seller.id);

  // baseline: a brand-new seller has an HONEST empty reference (rung 'new', nothing faked)
  let tr = await api('GET', '/api/governance/track-record', { token: seller.token });
  chk('new entity reference is empty + rung=new', tr.status === 200 && tr.j.settled === 0 && tr.j.rung === 'new',
    'rung=' + (tr.j && tr.j.rung) + ' settled=' + (tr.j && tr.j.settled));

  // a real dealing: the buyer places an order chit ON the seller …
  const snd = await api('POST', '/api/chits/send', { token: buyer.token, body: {
    recipients: [{ entity_id: seller.id, role: 'to' }], purpose: 'general', manual_subject: 'REF ' + ts,
    line_items: [{ description: 'Consignment', qty: 1, rate: 1000 }] } });
  const chit_id = snd.j && (snd.j.chit_id || (snd.j.chit && snd.j.chit.chit_id));
  chk('buyer placed an order on the seller', !!chit_id, chit_id || JSON.stringify(snd.j).slice(0, 160));

  // … the seller (receiver) accepts then FULFILS it — receiver-driven close on the seller's own copy.
  await api('PUT', '/api/chits/' + chit_id + '/status', { token: seller.token, body: { status: 'accepted' } });
  const done = await api('PUT', '/api/chits/' + chit_id + '/status', { token: seller.token, body: { status: 'completed' } });
  chk('seller fulfilled the order (completed)', done.status === 200, 'status ' + done.status);

  // the seller's reference now reflects the fulfilled order — DERIVED from its own copy, un-fakeable.
  tr = await api('GET', '/api/governance/track-record', { token: seller.token });
  chk('reference counts 1 settled (fulfilled) dealing', tr.j && tr.j.settled >= 1, 'settled=' + (tr.j && tr.j.settled));
  chk('reference counts the buyer as a counterparty', tr.j && tr.j.counterparties >= 1, 'counterparties=' + (tr.j && tr.j.counterparties));
  chk('rung lifted new → active', tr.j && tr.j.rung === 'active', 'rung=' + (tr.j && tr.j.rung));
  chk('disputes clean', tr.j && tr.j.disputes_clean === true && tr.j.disputes_open === 0);

  // the BUYER also holds a matching copy → its own reference reflects the same dealing (both sides prove it)
  const trB = await api('GET', '/api/governance/track-record', { token: buyer.token });
  chk('buyer side mirrors the dealing (self-proving both ways)', trB.j && trB.j.dealings >= 1 && trB.j.counterparties >= 1,
    'dealings=' + (trB.j && trB.j.dealings) + ' cps=' + (trB.j && trB.j.counterparties));

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
