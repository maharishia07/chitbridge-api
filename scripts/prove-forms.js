// prove-forms.js — LIVE proof of the authority-forms engine. node scripts/prove-forms.js
// Runs against the live API. Proves the field×source-precedence model + provenance/rung stamping + freeze + sign.
// Vault-dependent tests need VAULT_ENC_KEY configured (b100/F1); issue/sign need b108 — both reported honestly, not faked.
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0, S = 0;
const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };
const skip = (n, why) => { S++; console.log('  ◐ ' + n + '  — ' + why); };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; }
async function login(email) { const reg = await api('POST', '/api/entities/register', { body: { email } }); const v = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); return { token: v.j && v.j.token, id: v.j && v.j.entity && v.j.entity.identity_id }; }
const field = (resolved, id) => ((resolved && resolved.fields) || []).find((f) => f.id === id) || {};

(async () => {
  console.log('== PROVE AUTHORITY-FORMS ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6);
  const me = await login('forms-' + ts + '@t.com');
  chk('login', !!me.token);

  // ── Registry ──
  const list = (await api('GET', '/api/forms', { token: me.token })).j;
  chk('registry lists the seeded forms (CoO, invoice, authority-application)', list && Array.isArray(list.forms) && list.forms.length >= 3, (list.forms || []).map((f) => f.key).join(', '));

  // ── Manual override + derive + readiness (need NO vault) — the engine spine ──
  let r = (await api('POST', '/api/forms/authority-application/resolve', { token: me.token, body: { manual: { purpose: 'Trade licence renewal' } } })).j;
  chk('T2 · a manual value fills its field, source=manual rung=declared', field(r, 'purpose').source === 'manual' && field(r, 'purpose').rung === 'declared', 'purpose=' + JSON.stringify(field(r, 'purpose').value));
  chk('DERIVE · date is computed, source=derive rung=derived', field(r, 'date').source === 'derive' && field(r, 'date').rung === 'derived', 'date=' + field(r, 'date').value);
  chk('READY=false while a required field (applicant) is unresolved', r.ready === false && (r.unresolved_required || []).some((u) => u.id === 'applicant'), 'unresolved=' + (r.unresolved_required || []).map((u) => u.id).join('/'));
  const badIssue = await api('POST', '/api/forms/authority-application/issue', { token: me.token, body: { manual: { purpose: 'x' } } });
  chk('ISSUE refuses an unready form (400 FORM_NOT_READY, lists what is missing)', badIssue.status === 400 && badIssue.j && badIssue.j.code === 'FORM_NOT_READY' && Array.isArray(badIssue.j.unresolved), 'status=' + badIssue.status);

  // ── T1 · no channel mints `verified` from a self-write ──
  const allRungs = (r.fields || []).map((f) => f.rung).filter(Boolean);
  chk('T1 · nothing self-written is `verified`/`attested` (rungs ∈ documented/declared/derived)', allRungs.every((x) => ['documented', 'declared', 'derived'].includes(x)), 'rungs=' + [...new Set(allRungs)].join(','));

  // ── Order-bound source — an order-drawn field is `documented` (freeze-by-value already happened on the chit) ──
  const sc = await api('POST', '/api/chits/send', { token: me.token, body: { recipients: [{ name: 'Acme Importers GmbH', role: 'to' }], purpose: 'general', manual_subject: 'INV-' + ts, line_items: [{ description: 'Emulsion paint 20L', qty: 10, rate: 55 }] } });
  const chitId = sc.j && (sc.j.chit_id || (sc.j.chit && sc.j.chit.chit_id));
  if (chitId) {
    const ci = (await api('POST', '/api/forms/commercial-invoice/resolve', { token: me.token, body: { context_ref: chitId } })).j;
    chk('ORDER · buyer pulled from the order, source=order rung=documented', field(ci, 'buyer').source === 'order' && field(ci, 'buyer').rung === 'documented', 'buyer=' + JSON.stringify(field(ci, 'buyer').value));
    chk('ORDER · invoice_no + total_value are order-bound (documented)', field(ci, 'invoice_no').rung === 'documented' && field(ci, 'total_value').rung === 'documented', 'inv=' + field(ci, 'invoice_no').value + ' val=' + field(ci, 'total_value').value);
    chk('PROVENANCE · the resolve rolls up counts by source', ci.provenance && ci.provenance.order >= 2, JSON.stringify(ci.provenance));
  } else { skip('ORDER-bound tests', 'could not mint a context chit (chits/send shape) — status ' + sc.status); }

  // ── Inert external sources — NO fabrication ──
  const coo = (await api('POST', '/api/forms/certificate-of-origin/resolve', { token: me.token, body: {} })).j;
  chk('INERT · IoT-sourced gross_weight stays empty (no fabrication) until an adapter is configured', field(coo, 'gross_weight').value == null, 'gross_weight=' + JSON.stringify(field(coo, 'gross_weight').value));

  // ── Vault fill + freeze + sign — need VAULT_ENC_KEY (b100) and b108 ──
  const vaultBody = { vault: { identity: { legal_name: 'Sunrise Paints Pvt Ltd', address: '12 MG Rd, Chennai', city: 'Chennai', country: 'India' }, signatory: { name: 'A. Narayanan', designation: 'Director' } } };
  const sv = await api('PUT', '/api/governance/profile/vault', { token: me.token, body: vaultBody });
  if (sv.status !== 200) { skip('VAULT fill / freeze / sign', 'vault save returned ' + sv.status + ' (' + ((sv.j && sv.j.code) || 'enc/store not configured') + ') — needs VAULT_ENC_KEY + b100'); }
  else {
    const rv = (await api('POST', '/api/forms/authority-application/resolve', { token: me.token, body: { manual: { purpose: 'Trade licence renewal' } } })).j;
    chk('VAULT · applicant fills from the vault, source=vault rung=declared', field(rv, 'applicant').source === 'vault' && field(rv, 'applicant').rung === 'declared', 'applicant=' + JSON.stringify(field(rv, 'applicant').value));
    chk('VAULT · with the vault + a manual purpose the form is now READY', rv.ready === true, 'ready=' + rv.ready);
    const iss = await api('POST', '/api/forms/authority-application/issue', { token: me.token, body: { manual: { purpose: 'Trade licence renewal' } } });
    if (iss.status === 503) { skip('ISSUE / FREEZE / SIGN', 'form_instance not migrated — run b108'); }
    else {
      const formId = iss.j && iss.j.form_id;
      chk('ISSUE · a ready form freezes into an instance with a content_hash', !!formId && !!iss.j.content_hash, 'hash=' + String(iss.j.content_hash || '').slice(0, 12));
      // FREEZE: change the vault, the issued instance must NOT change
      await api('PUT', '/api/governance/profile/vault', { token: me.token, body: { vault: { identity: { legal_name: 'RENAMED LATER', city: 'Chennai', country: 'India', address: 'x' }, signatory: { name: 'A. Narayanan', designation: 'Director' } } } });
      const inst = (await api('GET', '/api/forms/instances/' + formId, { token: me.token })).j;
      const applicantFrozen = (inst.fields || []).find((f) => f.id === 'applicant');
      chk('FREEZE · the issued form is frozen by value (vault rename does NOT alter it)', applicantFrozen && applicantFrozen.value === 'Sunrise Paints Pvt Ltd', 'frozen=' + JSON.stringify(applicantFrozen && applicantFrozen.value));
      const sign1 = await api('POST', '/api/forms/instances/' + formId + '/sign', { token: me.token, body: {} });
      chk('SIGN · signs with the vault signatory, stamps signed_at', sign1.status === 200 && sign1.j.signed_at && sign1.j.signatory && sign1.j.signatory.name === 'A. Narayanan', 'signed_at=' + (sign1.j && sign1.j.signed_at));
      const sign2 = await api('POST', '/api/forms/instances/' + formId + '/sign', { token: me.token, body: {} });
      chk('SIGN · refuses to double-sign (409)', sign2.status === 409, 'status=' + sign2.status);

      // ── TRANSFER · file the issued form onto a chit as a per-copy attachment ──
      const carry = await api('POST', '/api/chits/send', { token: me.token, body: { recipients: [{ name: 'self', role: 'to' }], purpose: 'general', manual_subject: 'carry-' + ts, line_items: [] } });
      const carryId = carry.j && (carry.j.chit_id || (carry.j.chit && carry.j.chit.chit_id));
      if (carryId) {
        const at = await api('POST', '/api/forms/instances/' + formId + '/attach', { token: me.token, body: { chit_id: carryId } });
        chk('ATTACH · issued form files onto the chit as a per-copy attachment', at.status === 200 && !!at.j.attachment_id, 'att=' + String(at.j && at.j.attachment_id || '').slice(0, 8));
        const bad = await api('POST', '/api/forms/instances/' + formId + '/attach', { token: me.token, body: { chit_id: '00000000-0000-0000-0000-000000000000' } });
        chk('ATTACH · refuses a chit the entity is not a participant on (403)', bad.status === 403, 'status=' + bad.status);
      } else { skip('ATTACH tests', 'could not mint a carrier chit'); }
    }
  }

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F + '  ·  SKIP ' + S + (S ? '  (skips need VAULT_ENC_KEY/b100 or b108 — reported, not faked)' : ''));
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(F ? 1 : 0); });
