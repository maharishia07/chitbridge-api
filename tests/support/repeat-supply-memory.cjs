'use strict';
/**
 * tests/support/repeat-supply-memory.cjs — an in-memory repeat_supply table + chit_header stand-in with the real module's store functions
 * (b300 stood in; `migrated` is the switch the 503 test flips), and a stand-in for lib/autoraise.sendAs that records what the one send path
 * would have been asked and answers like it (a chit id; the SAME client_ref answers the first chit, duplicate:true — the route's rule).
 */
function memory() {
  const rows = [], chits = {}, sent = [], notes = []; let seq = 0;
  const m = { migrated: false, rows, chits, sent, notes, zone: { timezone: 'Asia/Kolkata', country: 'IN' } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const gone = () => { const e = new Error('relation "repeat_supply" does not exist'); e.code = '42P01'; throw e; };
  const join = (r) => { const h = chits[r.chit_id + '|' + r.entity_id] || {}; return Object.assign({}, r, { all_recipients: h.all_recipients || [], summary_json: h.summary_json || {}, manual_subject: h.manual_subject || null, auto_subject: h.auto_subject || null }); };
  const rowOf = (r) => require('../../lib/repeat-supply').rowOf(clone(join(r)));   /* the SQL store's own shaping — one shape */
  m.store = {
    async exists() { return m.migrated; },
    async list(h, e) { if (!m.migrated) gone(); return rows.filter((r) => r.entity_id === e).map(rowOf); },
    async get(h, e, id) { if (!m.migrated) gone(); const r = rows.find((x) => x.entity_id === e && x.agreement_id === id); return r ? rowOf(r) : null; },
    async insert(h, e, t) {
      if (!m.migrated) gone();
      rows.push(Object.assign({ entity_id: e, state: 'proposed', runs_done: 0, terms: {}, counter: null, skips: [], runs: {}, last_run_on: null, state_by: null, state_at: null, state_note: null, created_at: '2026-10-01T00:00:00Z', updated_at: null }, clone(t)));
      return m.store.get(h, e, t.agreement_id);
    },
    async update(h, e, id, p) { if (!m.migrated) gone(); const r = rows.find((x) => x.entity_id === e && x.agreement_id === id); if (!r) return null; Object.assign(r, clone(p)); return rowOf(r); },
    async chit(h, e, chit_id) { const c = chits[chit_id + '|' + e]; return c ? clone(c) : null; },
    async note(h, e, chit_id, who, action, detail) { notes.push({ entity: e, chit_id, action, detail }); },
    async zone() { return m.zone; },
    async dueShops() { if (!m.migrated) gone(); return [...new Set(rows.filter((r) => r.state === 'agreed').map((r) => r.entity_id))]; },
  };
  /** a chit both parties hold: the sender's and the receiver's copies */
  m.hold = (chit_id, sender, receiver, x) => {
    const base = Object.assign({ chit_id, sender_entity_id: sender, sender_entity_display_name: 'Mayur Bhavan', purpose: 'invoice', role: 'Act', line_items: [], business_json: {}, summary_json: {},
      all_recipients: [{ entity_id: sender, role: 'sender', display_name: 'Mayur Bhavan' }, { entity_id: receiver, role: 'to', display_name: 'Ravi Stores' }] }, x || {});
    chits[chit_id + '|' + sender] = Object.assign({}, base, { direction: 'sent', current_status: 'delivered' });
    if (receiver && receiver !== sender) chits[chit_id + '|' + receiver] = Object.assign({}, base, { direction: 'received', current_status: 'pending' });
  };
  /** the stand-in send: answers a chit id; the same client_ref answers the FIRST chit (duplicate) — and HOLDS the chit on both sides */
  m.sendAs = async (entity, body, opts) => {
    const same = sent.find((s) => s.entity === entity && s.body.client_ref === body.client_ref);
    if (same) return { ok: true, status: 200, body: { ok: true, chit_id: same.chit_id, duplicate: true, client_ref: body.client_ref } };
    if (m.refuseSend) return { ok: false, status: 409, body: { error: m.refuseSend, message: m.refuseSend } };
    const chit_id = 'aaaaaaaa-0000-4000-8000-' + String(++seq).padStart(12, '0');
    sent.push({ entity, body: clone(body), opts: clone(opts || {}), chit_id });
    const to = body.recipients && body.recipients[0] && body.recipients[0].entity_id;
    m.hold(chit_id, entity, body.is_draft ? null : to, { purpose: body.purpose, role: body.is_draft ? 'Draft' : 'Act', line_items: body.line_items, business_json: body.business_json, manual_subject: body.manual_subject,
      summary_json: { currency_code: (body.business_json && body.business_json.currency) || 'INR', money: { gross: 1000, savings: 0, net: 1000, tax: 180, total: 1180, currency_code: 'INR', provisional: true } } });
    return { ok: true, status: 200, body: { ok: true, chit_id } };
  };
  return m;
}
module.exports = { memory };
