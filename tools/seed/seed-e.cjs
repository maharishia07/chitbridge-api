/**
 * tools/seed/seed-e.cjs — SEED E (REP-73 practice bands): which year-end state client number i of a demo firm is given, and the firm side of it.
 * OWNS      the plan (plan(i)) and the firm phase (firmPhase) that tools/sim-load.cjs runs after a client's history when started with --seed-e <i> --firm <handle>. No second seeder.
 * CALLED BY tools/sim-load.cjs (--seed-e), tools/seed/seed-e.sh
 * The rule (REQ-MIS-SHOWCASE-2026-11-16 §13.6, i = 1..N in name order): Complete if i mod 3 is not 0 · Checked if Complete and i even · an open query if i mod 5 is 0 ·
 * Ready if Checked and no query · Lodged if Ready and i mod 4 is 0 (needs the past-years route: not on this base, so not seeded).
 * What the books really hold: soft/hard locked months (BAS quarter close through POST /gst/close, year close), a SIGNED bank statement to 30 June (difference 0), a clear mark
 * ('checked') on EVERY entry of the last FY, an open mark ('query') on one entry AFTER the FY (so Checked stays true), both grants (auditor + adviser) from every client to the firm.
 * The not-Complete third alternates its blocker: i mod 12 = 3 or 9: months not locked (bank signed) · 6: months locked, bank signed with a difference · 0: months locked, no statement signed.
 * TROUBLE (W6, 16 Nov): a few clients are in trouble so the practice Advice band has something to say: TROUBLE below, applied by tools/seed/seed-e-trouble.cjs (journals dated Jul-Oct 2026, AFTER the year the stages read, so the stage mix does not move).
 * Everything is a demo row (shop name ends ' - demo'); nothing is removed.
 */
'use strict';
const FY_FROM = '2025-07-01', FY_TO = '2026-06-30';
/** client number -> the trouble it is given (none of them i mod 5 = 0, so no open-query client changes). sales_down: cash takings added in Jul/Aug/Sep (per month, whole dollars), so Oct reads below the 3 months before it · loss: a one-off cost in Sep and in Oct (whole dollars) · late_debtors: a credit sale of that many dollars dated 10 Jul, never paid · cash_low: owner drawings of the whole cash and bank balance bar a little */
const TROUBLE = {
  7: { kind: 'sales_down', extra: 7000 }, 17: { kind: 'sales_down', extra: 9000 },
  8: { kind: 'loss', sep: 6000, oct: 6500 }, 22: { kind: 'loss', sep: 6000, oct: 6500 },
  13: { kind: 'late_debtors', credit_sale: 5000 },
  26: { kind: 'cash_low' }
};
function plan(i) {
  const complete = i % 3 !== 0, checked = complete && i % 2 === 0, query = i % 5 === 0;
  const ready = checked && !query, lodged = ready && i % 4 === 0;
  const blocker = complete ? null : i % 6 === 3 ? 'months' : i % 12 === 6 ? 'bank_diff' : 'bank_none';
  return { i, trouble: TROUBLE[i] || null, complete, checked, query, ready, lodged, locks: blocker !== 'months', bank: blocker === 'bank_diff' ? 'diff' : blocker === 'bank_none' ? 'none' : 'ok', blocker };
}
/** the expected counts for clients 1..n (hand rule above, evaluated) */
function expected(n) {
  const out = { books_in: n, complete: 0, checked: 0, ready: 0, lodged_if_route: 0, queries: 0 };
  for (let i = 1; i <= n; i++) { const p = plan(i); if (p.complete) out.complete++; if (p.checked) out.checked++; if (p.ready) out.ready++; if (p.lodged) out.lodged_if_route++; if (p.query) out.queries++; }
  return out;
}
async function signIn(call, handle, name, code) {
  const email = handle + '@' + (process.env.SEED_MAIL_DOMAIN || 'test.example');
  await call('/api/entities/register', { method: 'POST', body: { email, display_name: name, user_id: handle } });
  const v = await call('/api/entities/verify', { method: 'POST', body: { email, otp: typeof code === 'function' ? code() : code } });
  if (!v.b.token) throw new Error('firm sign-in refused: ' + JSON.stringify(v.b).slice(0, 200));
  return { token: v.b.token, id: String((v.b.entity && v.b.entity.identity_id) || (v.b.identity && v.b.identity.identity_id)) };
}
/** the firm phase for one client: network edge, both grants, the marks. h = { callApi, sql, token, shopId, code, firm, firmName, say } */
async function firmPhase(h, i) {
  const p = plan(i), say = h.say;
  const firm = await signIn(h.callApi, h.firm, h.firmName, h.code);
  const cs = await h.callApi('/api/governance/country-setup', { token: firm.token });
  if (!cs.b.done) await h.callApi('/api/governance/country-setup', { method: 'PUT', token: firm.token, body: { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false }, source: { country: 'seed-e', currency: 'seed-e', fy_start_month: 'seed-e', tax: 'seed-e' } } });
  if (!h.topup) await edgeAndGrants();
  async function edgeAndGrants() {
  const me = (await h.callApi('/api/entities/me', { token: h.token })).b, row = me.entity || me.identity || me;
  const edge = await h.callApi('/api/network/connections', { method: 'POST', token: firm.token, body: { childBridgeId: row.bridge_id, type: 'agency' } });
  const edgeId = edge.b && (edge.b.id || (edge.b.edge && edge.b.edge.id));
  if (edgeId) await h.callApi('/api/network/connections/' + edgeId + '/approve', { method: 'POST', token: h.token, body: {} });
  say('firm edge ' + edge.status + (edgeId ? ' approved' : ''));
  for (const preset of ['auditor', 'adviser']) {
    const body = { grantee: firm.id, preset, purpose: 'demo practice', expires_at: '2027-12-31', can_see_costs: true, consent: true };
    if (preset === 'adviser') Object.assign(body, { posting: 'owner_approves' });
    const g = await h.callApi('/api/books-grants', { method: 'POST', token: h.token, body });
    say('grant ' + preset + ' ' + g.status + (g.status >= 300 ? ' ' + JSON.stringify(g.b).slice(0, 200) : ''));
  }
  }
  const forHeader = { 'X-Books-For': h.shopId };
  /* the grant door allows 300 looks a minute per (firm, client): on a 429 wait the minute out and ask again */
  const mark = async (entry, kind, note) => {
    for (let tries = 0; tries < 5; tries++) {
      const r = await h.callApi('/api/marks', { method: 'POST', token: firm.token, headers: forHeader, body: Object.assign({ adopter: 'acc.audit', subject_id: String(entry), kind }, note ? { note } : {}) });
      if (r.status !== 429) return r;
      await new Promise((ok) => setTimeout(ok, 31000));
    }
    return { status: 429, b: {} };
  };

  let done = 0, refused = 0;
  if (p.checked) {
    const rows = (await h.sql(`SELECT entry_id FROM journal_entry WHERE entity_id = $1 AND posting_date BETWEEN $2::date AND $3::date AND entry_id::text NOT IN (SELECT subject_id FROM review_mark WHERE entity_id = $1 AND adopter = 'acc.audit') ORDER BY entry_no`, [h.shopId, FY_FROM, FY_TO])).rows;
    for (const r of rows) { const m = await mark(r.entry_id, 'checked'); if (m.status < 300) done++; else if (refused++ < 2) say('mark refused ' + m.status + ' ' + JSON.stringify(m.b).slice(0, 160)); }
  }
  if (p.query && !h.topup) {
    const r = (await h.sql(`SELECT entry_id FROM journal_entry WHERE entity_id = $1 AND posting_date > $2::date ORDER BY entry_no LIMIT 1`, [h.shopId, FY_TO])).rows[0];
    const m = r && (await mark(r.entry_id, 'query', 'Please send the invoice for this entry (demo query).'));
    say('query mark ' + (m ? m.status : 'no entry'));
  }
  say('marks: ' + done + ' checked, ' + refused + ' refused');
  return p;
}
module.exports = { TROUBLE, plan, expected, firmPhase, FY_FROM, FY_TO };
if (require.main === module) { const n = Number(process.argv[2] || 30); console.log(JSON.stringify(expected(n))); }
