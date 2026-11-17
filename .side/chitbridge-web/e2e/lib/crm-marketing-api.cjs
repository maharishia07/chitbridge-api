'use strict';
/**
 * e2e/lib/crm-marketing-api.cjs - THE STAND-IN FOR THE CRM'S GROUPS / SEGMENTS / SEND ANSWERS (lifted from walk-crm-marketing.cjs, MKT first slice 22 Oct 2026, so
 * walk-marketing.cjs serves the SAME answers the Groups screen reads - widen, never copy). It is the api's own rules for the golden-parties fixture
 * (lib/crm-groups.js: counts from the list's rows, reach by lib/privacy's codes; the send refused in words without WHATSAPP_TOKEN).
 *   const M = require('./lib/crm-marketing-api.cjs')(FX);   M.S (the state) · M.segments() · M.send(key, body) · M.verdict(id) · M.members(key) · M.NO_TOKEN
 */
module.exports = function create(FX) {
const NO_TOKEN = 'WHATSAPP_TOKEN is not set — outbound is not configured';

/* ── the stand-in: the api's own rules for this fixture (lib/crm-groups.js · lib/privacy.mayMessage · lib/whatsapp-out.notify without a token) ── */
const S = { calls: [], bodies: [], level: 'owner', consentOff: false, consent: { 'pid-0002': 'CONSENT', 'pid-0005': 'SAID_NO' }, offers: { 'group:Workshops': 1, regular: 2 }, flags: { showcase_template: 'showcase.food.menu@1.0' },
  list: JSON.parse(JSON.stringify(FX.list)), rewards: { 'pid-0002': { programme: 'Shop Rewards', points: 1260, worth: 630, negative: false, earns: '1 point for every ₹10 on the bill', says: 'worth ₹630 off the next bill', reach: [], next: { name: 'Free service wash', short: '240 points' }, money_known: true, expires_months: 12,
    recent: [{ at: '2026-10-10T09:00:00.000Z', points: 120, why: 'earned', ref: 'B-0412' }, { at: '2026-09-28T09:00:00.000Z', points: -200, why: 'spent', ref: 'B-0391' }, { at: '2026-09-20T09:00:00.000Z', points: 80, why: 'earned', ref: 'B-0377' }], expired_now: 0 } } };
const WHY = { NO_CONSENT: 'No consent for offers on whatsapp. Ask them first.', SAID_NO: 'They said no to offers on whatsapp.', CONSENT_WITHDRAWN: 'They withdrew consent for offers on whatsapp.', CONSENT: 'They agreed to offers on whatsapp.' };
const verdict = (id) => { const c = S.consentOff ? 'NO_CONSENT' : (S.consent[id] || 'NO_CONSENT'); return { may: c === 'CONSENT', code: c, why: WHY[c] }; };
const customers = () => S.list.filter((p) => p.kind !== 'walk-in' && !p.merged_into && (p.roles || []).indexOf('customer') >= 0);
const members = (k) => customers().filter((p) => (/^group:/.test(k) ? (p.groups || []).indexOf(k.slice(6)) >= 0 : p.segment === k));
const reach = (ps) => { const by = {}; let may = 0; ps.forEach((p) => { const v = verdict(p.party_id); if (v.may) may++; else by[v.code] = (by[v.code] || 0) + 1; }); return { may, not: ps.length - may, refused_by: Object.keys(by).sort().map((code) => ({ code, n: by[code] })) }; };
const mays = () => { const ok = { may: true, code: 'OK', why: '' }, vo = { may: false, code: 'VIEW_ONLY', why: 'Your login can only view.' }, oo = { may: false, code: 'OWNER_ONLY', why: 'Only the owner deletes a group.' };
  return S.level === 'owner' ? { group: ok, send: ok, delete: ok } : S.level === 'editor' ? { group: ok, send: ok, delete: oo } : { group: vo, send: vo, delete: oo }; };
const RULE = { new: 'fewer than 3 bills', regular: '3 or more bills', high_value: 'top 10% by bills in 12 months, at least 3 bills', inactive: 'no bill in 90 days' };
const WORD = { new: 'New', regular: 'Regular', high_value: 'High value', inactive: 'Inactive' };
function segments() {
  const segs = ['new', 'regular', 'high_value', 'inactive'].map((key) => { const ms = members(key); return { key, name: WORD[key], rule: RULE[key], count: ms.length, overrides: 0, offers: S.offers[key] || 0, reach: reach(ms) }; });
  const names = new Set(); customers().forEach((p) => (p.groups || []).forEach((g) => names.add(g)));
  const groups = [...names].sort().map((name) => { const ms = members('group:' + name); return { key: 'group:' + name, name, count: ms.length, offers: S.offers['group:' + name] || 0, reach: reach(ms) }; });
  return { segments: segs, groups, groups_migrated: true, consent_migrated: !S.consentOff, channel: 'whatsapp', purpose: 'marketing', customers: customers().length, may: mays() };
}
function send(key, body) {
  const ms = members(key), may = [], refused = [], by = {};
  ms.forEach((p) => { const v = verdict(p.party_id); if (v.may) may.push(p); else { refused.push({ party_id: p.party_id, name: p.display_name, code: v.code, why: v.why }); by[v.code] = (by[v.code] || 0) + 1; } });
  const out = { key, send_ref: '4d7f3c1e-5b0a-4e55-9a51-0c2a6f1d9e10', dry: !!body.dry, channel: 'whatsapp', purpose: 'marketing', members: ms.length, may: may.length, refused, refused_by: Object.keys(by).sort().map((code) => ({ code, n: by[code] })), sent: [], sent_n: 0, failed_n: 0, refused_n: refused.length };
  if (body.dry) return out;
  may.forEach((p) => { out.sent.push({ party_id: p.party_id, name: p.display_name, status: 'refused', reason: NO_TOKEN }); out.refused_n++; });
  return out;
}
  return { NO_TOKEN, S, WHY, verdict, customers, members, reach, mays, segments, send };
};
