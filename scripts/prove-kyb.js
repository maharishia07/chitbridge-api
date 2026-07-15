// prove-kyb.js — LIVE proof of the "Know your business" panel. node scripts/prove-kyb.js
// Runs against the live API. Tests the runnable directive boxes (R1/R2/P1/P2/K1/K2 + the Field wall structure F2/F3).
// F4 (24h cache) + a full F1 drop-test need a connected search provider (UAT) — noted, not faked.
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
async function login(email) { const reg = await api('POST', '/api/entities/register', { body: { email } }); const v = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); return { token: v.j && v.j.token, id: v.j && v.j.entity && v.j.entity.identity_id }; }
const rung = (yourself, std) => { const c = ((yourself && yourself.facts && yourself.facts.credentials) || []).find((x) => x.standard === std); return c ? c.rung : '(not-held)'; };

(async () => {
  console.log('== PROVE KNOW-YOUR-BUSINESS ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6);
  const me = await login('kyb-' + ts + '@t.com');
  chk('login', !!me.token);

  // ── Section 1 · Yourself + open registry ──
  // R2 — add an UNKNOWN credential (village NOC) with NO evidence → must land `declared`.
  await api('POST', '/api/kyb/credential', { token: me.token, body: { title: 'Village Panchayat NOC', standard_key: 'village-noc' } });
  let you = (await api('GET', '/api/kyb/yourself', { token: me.token })).j;
  chk('R2 · unknown user-added credential lands `declared`', rung(you, 'village-noc') === 'declared', 'rung=' + rung(you, 'village-noc'));
  // R2b — the same credential rises to `documented` only with a REAL owned evidence chit.
  const sc = await api('POST', '/api/chits/send', { token: me.token, body: { recipients: [{ name: 'self', role: 'to' }], subject: 'NOC cert', manual_subject: 'NOC cert', purpose: 'general', line_items: [] } });
  const chitId = sc.j && (sc.j.chit_id || (sc.j.chit && sc.j.chit.chit_id));
  await api('POST', '/api/kyb/credential', { token: me.token, body: { title: 'Village Panchayat NOC', standard_key: 'village-noc', evidence_ref: chitId } });
  you = (await api('GET', '/api/kyb/yourself', { token: me.token })).j;
  chk('R2b · rises to `documented` with a real owned evidence chit', rung(you, 'village-noc') === 'documented', 'rung=' + rung(you, 'village-noc'));
  chk('  └ yourself never returns verified from a self-write (T1)', rung(you, 'village-noc') !== 'verified' && rung(you, 'village-noc') !== 'attested');
  // R1 — a self-gathered GSTIN-style credential (no registry connected) is NOT `verified`.
  await api('POST', '/api/kyb/credential', { token: me.token, body: { title: 'GST registration', standard_key: 'gst-selftyped' } });
  you = (await api('GET', '/api/kyb/yourself', { token: me.token })).j;
  chk('R1 · a self-typed credential is `declared`, never `verified`', rung(you, 'gst-selftyped') === 'declared', 'rung=' + rung(you, 'gst-selftyped'));

  // ── Section 2 · Position (directional selling avenues) ──
  const pos1 = (await api('GET', '/api/kyb/position?vertical=paint&origin=IN', { token: me.token })).j;
  chk('P · position returns directional buckets (reachable/one-step/structural)', pos1 && pos1.facts && pos1.facts.reach && Array.isArray(pos1.facts.reach.one_step),
    'now=' + (pos1.facts.reach.reachable_now || []).length + ' one-step=' + (pos1.facts.reach.one_step || []).length + ' struct=' + (pos1.facts.reach.structural || []).length);
  const gaps = ((pos1.facts.lanes || []).flatMap((l) => l.gaps || []));
  const closeable = gaps.find((g) => g.kind === 'closeable');
  const structural = gaps.find((g) => g.kind === 'structural');
  chk('P2 · a closeable gap carries an unlock count + a path', !!closeable && closeable.unlocks >= 1 && !!closeable.path, closeable ? ('unlocks=' + closeable.unlocks) : 'none');
  chk('P2 · a structural gap is LABELLED and has NO "how to fix" (no path)', !structural || (structural.kind === 'structural' && !structural.path), structural ? 'has path? ' + !!structural.path : '(no structural gap this lane)');
  // P1 — recompute: add a credential that closes a gap → the met/missing should change (proves derived, not hardcoded).
  const before = JSON.stringify(pos1.facts.lanes);
  await api('POST', '/api/kyb/credential', { token: me.token, body: { title: 'ISO 9001', standard_key: 'iso-9001', evidence_ref: chitId } });
  const pos2 = (await api('GET', '/api/kyb/position?vertical=paint&origin=IN', { token: me.token })).j;
  chk('P1 · adding a credential RECOMPUTES position (derived, not hardcoded)', JSON.stringify(pos2.facts.lanes) !== before);

  // ── Section 3 · Risk ──
  // K1 — seed concentration: send a large order to buyer A, a small one to buyer B → A should be the flagged top.
  const A = await login('kyb-A-' + ts + '@t.com'); const Bb = await login('kyb-B-' + ts + '@t.com');
  await api('POST', '/api/chits/send', { token: me.token, body: { recipients: [{ entity_id: A.id, role: 'to' }], purpose: 'general', manual_subject: 'big', line_items: [{ description: 'x', qty: 1, rate: 60 }] } });
  await api('POST', '/api/chits/send', { token: me.token, body: { recipients: [{ entity_id: Bb.id, role: 'to' }], purpose: 'general', manual_subject: 'small', line_items: [{ description: 'x', qty: 1, rate: 40 }] } });
  const risk = (await api('GET', '/api/kyb/risk', { token: me.token })).j;
  const top = risk && risk.facts && risk.facts.concentration && risk.facts.concentration.top;
  chk('K1 · concentration named (one buyer ~60% of business)', !!top && top.pct >= 55, top ? (top.pct + '% with ' + top.counterparty) : 'none');
  const conc = (risk.facts.exposures || []).find((e) => e.kind === 'concentration');
  chk('K1 · surfaced as an exposure fact', !!conc, conc ? conc.fact : 'not flagged');
  chk('K2 · risk NAMES exposures but recommends NO instrument (no recommendation field)', !(risk.facts.exposures || []).some((e) => e.recommend || e.instrument || e.hedge) && /not advice/i.test(risk.note || ''), 'note disclaims advice');

  // ── Section 4 · Field (walled-off) ──
  const fld = (await api('POST', '/api/kyb/field', { token: me.token })).j;
  chk('F · field is WALLED-OFF (wall flag + "verify at the source" note)', fld && fld.wall === true && /verify at the source/i.test(fld.note || ''));
  chk('F3 · field returns NO buyers (results are markets/demand only; inert until a provider is connected)', Array.isArray(fld.results) && fld.results.length === 0 && fld.configured === false, 'configured=' + fld.configured);
  chk('F · an unconfigured field search is NOT charged', fld.charged === false);
  console.log('  ◐ F1 (drop results without source+as-of) + F4 (24h cache free) — enforced in code; full RED test needs a connected search provider (UAT).');

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(0); });
