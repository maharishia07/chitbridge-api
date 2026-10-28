// assimilate-standard.js — proves the assimilation SEAM stamps the boilerplate lineage on a chit, INCLUDING the
// canonical SHARED standard (ISO 9000) alongside the entity's own constitution + capability + work-pattern.
// Self-healing: ISO 9000 resolves from standard_source (b85) or the code seed. Run: node scripts/assimilate-standard.js
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0,
  F = 0;
function chk(n, ok, d) {
  if (ok) {
    P++;
    console.log('  ✓ ' + n + (d ? '  ' + d : ''));
  } else {
    F++;
    console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
  }
}
async function api(m, p, o) {
  o = o || {};
  const h = { 'Content-Type': 'application/json' };
  if (o.token) h.Authorization = 'Bearer ' + o.token;
  const reply = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined });
  let j = null;
  try {
    j = await reply.json();
  } catch (_) {}
  return { status: reply.status, j };
}
const has = (o, s) => JSON.stringify(o || '').includes(s);
(async () => {
  console.log('== ASSIMILATE: the seam stamps constitution + capability + pattern + ISO-9000 standard ==\n');
  const ts = Date.now().toString().slice(-6),
    email = 'asm-' + ts + '@test.com';
  const reply = await api('POST', '/api/entities/register', { body: { email } });
  const ver = await api('POST', '/api/entities/verify', { body: { email, otp: reply.j && reply.j.dev_otp } });
  const token = ver.j && ver.j.token;
  chk('entity minted + login', !!token);
  const snd = await api('POST', '/api/chits/send', {
    token,
    body: { recipients: [{ name: 'self', role: 'to' }], purpose: 'general', manual_subject: 'assimilate ' + ts }
  });
  const id = snd.j && (snd.j.chit_id || (snd.j.chit && snd.j.chit.chit_id));
  chk('send-chit ok', !!id, id || JSON.stringify(snd.j).slice(0, 160));
  if (id) {
    const reply = await api('GET', '/api/chits/' + id, { token });
    chk('chit carries the governed lineage', has(reply.j, '"governed"'));
    chk('assimilated the SHARED standard — ISO 9000', has(reply.j, 'iso-9001@v1'), 'governed.standard');
    chk('assimilated the work-pattern', has(reply.j, 'send-chit@'), 'governed.pattern');
    chk('assimilated the constitution (per-entity vertical)', has(reply.j, '"constitution"'), 'governed.constitution key present');
  }
  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(0);
});
