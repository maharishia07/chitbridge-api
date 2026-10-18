// @stage tested
// @stage-note [CB CRM · T3-P2-CRM] Segments & groups as ONE answer (counts · offers · who may be sent offers), the group writes, and the group send.
'use strict';
/*
 * OWNS      segments and groups as one answer, and the consented group send.
 * CALLED BY routes/crm.js.
 * FLOW      reach → consent gate → verified WhatsApp line → notify
 * CARD      11-crm-and-marketing/crm-groups
 */
/**
 * lib/crm-groups.js — what the shop's customers divide into, and what can be done with a set of them (T3-P2-CRM, 2026-10-14).
 *
 * ⭐ ONE DEFINITION, READ — NEVER A SECOND ONE. A segment is lib/customer-groups SEGMENT_SQL, read by lib/crm.rows; a named group is
 *   customer_list.groups[] (b205), the same array the offers engine reads ('group:<name>', customer-groups.groupsOf). This module counts the
 *   rows lib/crm.list already answers the CRM page with — so the Groups screen's numbers ARE the list's numbers — and adds what memory
 *   cannot know: the offers that name each group (ONE statement over definition_version.rules) and the shop's own high-value rule, in words.
 * ⭐ CONSENT FIRST. "who may be sent offers" is lib/privacy.mayAll's verdict per party (contact_prefs on the list, ?with=consent), counted
 *   by its CODE; a send asks the same verdict, and the ONE sender (lib/whatsapp-out.notify) asks lib/privacy.gate again — fail closed.
 * ⚠️ A provider send is one call per recipient (Meta has no batch): capped at SEND_CAP per call, said in the budget line.
 *
 *   overview(owner, who)                 → { segments[], groups[], groups_migrated, consent_migrated, channel, purpose, customers, may }
 *   setGroup(h, owner, body)             → { name, added, removed, count }        POST /api/crm/groups { name, add[], remove[] } — one transaction
 *   dropGroup(h, owner, name)            → { name, removed }                      DELETE /api/crm/groups/:name — the owner
 *   send(owner, key, body)               → { key, dry, members, may, refused[], refused_by[], sent[], sent_n, failed_n, refused_n }
 *
 * owns: segments & groups as one answer; the group writes; the group send (no table of its own — customer_list.groups, party_contact_pref)
 * called by: routes/crm.js (/segments · /groups · /segments/:key/send)
 * FLOW  POST send → sendChannelOf() [offers only, R3] → crm.list(consent) → verdictOf() per member → whatsapp-out.notify()
 * // CARD 11-crm-and-marketing/crm-groups
 */
const G = require('./customer-groups');
const PV = require('./privacy');
const F = require('./crm-followups');
const bad = F.bad;

const CHANNEL = 'whatsapp', PURPOSE = 'marketing';
const SEND_CAP = 100, TEXT_MAX = 1000, IDS_CAP = 500, GROUPS_PER_CUSTOMER = 20;
const ORDER = ['new', 'regular', 'high_value', 'inactive'];
const WORDS = { new: 'New', regular: 'Regular', high_value: 'High value', inactive: 'Inactive' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the rule each segment follows, in words — the numbers are the shop's own (lib/crm.shopRule), the defaults customer-groups.segmentSql's */
function ruleWords(rule) {
  const o = rule || {};
  const pct = Math.min(100, Math.max(1, Math.floor(Number(o.pct)) || 10)), min = Math.max(1, Math.floor(Number(o.minBills)) || 3);
  return { high_value: 'top ' + pct + '% by bills in 12 months, at least ' + min + ' bills', inactive: 'no bill in 90 days', regular: '3 or more bills', new: 'fewer than 3 bills' };
}

/** a key on the wire → { kind: 'segment', key } | { kind: 'group', name } | null — the SAME values an offer's "Only for" stores */
function keyOf(k) {
  const s = String(k == null ? '' : k).trim();
  if (G.SEGMENTS.indexOf(s) >= 0) return { kind: 'segment', key: s };
  if (/^group:/.test(s)) { const name = G.cleanName(s.slice(6)); return name ? { kind: 'group', name } : null; }
  return null;
}
/** the customers (never a lead) in a segment or a group, from the list's own rows */
function members(parties, k) {
  return (parties || []).filter((item) => {
    const c = item && item.customer; if (!c || (item.lead && item.lead.stage && item.lead.stage !== 'customer')) return false;
    return k.kind === 'segment' ? c.segment === k.key : (Array.isArray(c.groups) && c.groups.indexOf(k.name) >= 0);
  });
}
const verdictOf = (p, channel, purpose) => (p.contact_prefs && p.contact_prefs.may && p.contact_prefs.may[channel] && p.contact_prefs.may[channel][purpose]) || PV.mayMessage([], channel, purpose);
/** who may be sent offers, by the server's code — never a count a page could make */
function reach(list, channel, purpose) {
  const by = {}; let count = 0;
  list.forEach((item) => { const v = verdictOf(item, channel, purpose); if (v.may) count++; else by[v.code] = (by[v.code] || 0) + 1; });
  return { may: count, not: list.length - count, refused_by: Object.keys(by).sort().map((code) => ({ code, n: by[code] })) };
}

/** the offers that name a group or a segment ("Only for"), live or draft — ONE statement; before b160 there is no table → none */
async function offersByGroup(h, owner) {
  try {
    const r = await h.query(`SELECT v.rules->>'customer_group' AS g, count(*)::int AS n FROM definition d
        JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
       WHERE d.entity_id = $1 AND d.kind = 'offer' AND d.status IN ('live', 'draft') AND (v.rules->>'customer_group') IS NOT NULL GROUP BY 1`, [owner]);
    const out = {}; r.rows.forEach((x) => { out[String(x.g)] = Number(x.n) || 0; }); return out;
  } catch (e) { if (e && e.code === '42P01') return {}; throw e; }
}

/** the server's may/why for each action on the screen (hat-gate refuses too; this is the sentence the button carries) */
function mays(who) {
  const w = who || {};
  const edit = w.owner || w.editor, ok = { may: true, code: 'OK', why: '' };
  return { group: edit ? ok : { may: false, code: 'VIEW_ONLY', why: 'Your login can only view.' },
    send: edit ? ok : { may: false, code: 'VIEW_ONLY', why: 'Your login can only view.' },
    delete: w.owner ? ok : { may: false, code: 'OWNER_ONLY', why: 'Only the owner deletes a group.' } };
}

async function overview(owner, who) {
  const crm = require('./crm');
  const list = await crm.list(owner, { consent: true });   /* the same rows the Parties list shows — one reading, one number */
  const x = await crm.withEntity(owner, async (h) => ({ rule: await crm.shopRule(h, owner), offers: await offersByGroup(h, owner) }));
  const names = await G.namesOf({ seller_id: owner, withEntity: crm.withEntity });
  const words = ruleWords(x.rule), customers = list.parties.filter((item) => item.customer && !crm.isLead(item));
  const segments = ORDER.map((key) => {
    const ms = members(customers, { kind: 'segment', key });
    return { key, name: WORDS[key], rule: words[key], count: ms.length, overrides: ms.filter((item) => item.customer.segment_override).length, offers: x.offers[key] || 0, reach: reach(ms, CHANNEL, PURPOSE) };
  });
  const seen = {}; names.names.forEach((item) => { seen[item] = 1; }); customers.forEach((item) => ((item.customer && item.customer.groups) || []).forEach((g) => { seen[g] = 1; }));
  const groups = Object.keys(seen).sort((first, second) => first.localeCompare(second)).map((name) => {
    const ms = members(customers, { kind: 'group', name });
    return { key: 'group:' + name, name, count: ms.length, offers: x.offers['group:' + name] || 0, reach: reach(ms, CHANNEL, PURPOSE) };
  });
  return { segments, groups, groups_migrated: !!names.migrated, consent_migrated: !!list.consent_migrated, channel: CHANNEL, purpose: PURPOSE, customers: customers.length, may: mays(who) };
}

const ids = (v, what) => {
  const out = []; (Array.isArray(v) ? v : []).forEach((x) => { const s = String(x || ''); if (UUID.test(s) && out.indexOf(s) < 0) out.push(s); });
  if (out.length > IDS_CAP) throw bad(what + ' at most ' + IDS_CAP + ' at a time.', 400, 'TOO_MANY');
  return out;
};
const notMigrated = (e) => { if (e && e.code === '42703') return bad('Named groups need migration b205 (customer_groups) — not run yet.', 409, 'GROUPS_NOT_MIGRATED'); return e; };

/** a group = a name + who is in it: add[] placed, remove[] taken out, in the caller's ONE transaction; the count after is the answer */
async function setGroup(h, owner, body) {
  const node = body || {}, name = G.cleanName(node.name);
  if (!name) throw bad('Name the group: up to 40 letters, digits, spaces, - & /.', 400, 'BAD_NAME');
  const add = ids(node.add, 'Add'), remove = ids(node.remove, 'Remove').filter((x) => add.indexOf(x) < 0);
  if (!add.length && !remove.length) throw bad('Say who to add or remove.', 400, 'NOTHING_TO_DO');
  try {
    let added = 0, removed = 0;
    if (add.length) {
      const r = await h.query(`UPDATE customer_list SET groups = array_append(COALESCE(groups, '{}'), $2) WHERE owner_entity_id = $1 AND customer_identity_id = ANY($3::uuid[])
          AND NOT ($2 = ANY(COALESCE(groups, '{}'))) RETURNING customer_identity_id, cardinality(groups) AS n`, [owner, name, add]);
      if (r.rows.some((x) => Number(x.n) > GROUPS_PER_CUSTOMER)) throw bad('A customer can be in at most ' + GROUPS_PER_CUSTOMER + ' groups.', 400, 'TOO_MANY_GROUPS');
      added = r.rows.length;
    }
    if (remove.length) {
      const r = await h.query(`UPDATE customer_list SET groups = array_remove(groups, $2) WHERE owner_entity_id = $1 AND customer_identity_id = ANY($3::uuid[])
          AND $2 = ANY(COALESCE(groups, '{}')) RETURNING customer_identity_id`, [owner, name, remove]);
      removed = r.rows.length;
    }
    const c = await h.query(`SELECT count(*)::int AS n FROM customer_list WHERE owner_entity_id = $1 AND $2 = ANY(COALESCE(groups, '{}'))`, [owner, name]);
    return { name, added, removed, count: Number(c.rows[0] && c.rows[0].n) || 0 };
  } catch (e) { throw notMigrated(e); }
}
/** the group is gone from every customer who was in it (one statement); the offers that named it are the page's warning, read before */
async function dropGroup(h, owner, rawName) {
  const name = G.cleanName(rawName);
  if (!name) throw bad('That is not a group name.', 400, 'BAD_NAME');
  try {
    const r = await h.query(`UPDATE customer_list SET groups = array_remove(groups, $2) WHERE owner_entity_id = $1 AND $2 = ANY(COALESCE(groups, '{}')) RETURNING customer_identity_id`, [owner, name]);
    if (!r.rows.length) throw bad('No group by that name.', 404, 'NOT_FOUND');
    return { name, removed: r.rows.length };
  } catch (e) { throw notMigrated(e); }
}

/** the channel a group send names — WhatsApp only today; and R3: the purpose is ALWAYS offers, so a caller naming any other (a hand-made 'service') is refused */
function sendChannelOf(asked) {
  const channel = String(asked.channel || CHANNEL).toLowerCase();
  if (asked.purpose != null && String(asked.purpose).toLowerCase() !== PURPOSE) throw bad('A message to a group is an offer, so it needs their consent for offers.', 400, 'PURPOSE_FIXED');
  if (PV.CHANNELS.indexOf(channel) < 0) throw bad('Channel is phone, sms, whatsapp, email or chitbridge.', 400, 'BAD_CHANNEL');
  if (channel !== 'whatsapp') throw bad('Only WhatsApp can be sent from here today.', 400, 'CHANNEL_NOT_SENDABLE');
  return channel;
}

/**
 * a message to everyone in a segment or a group — `dry` says what WOULD happen (who may, who not and why, by code) and sends nothing;
 * a real send goes through the ONE sender per allowed member. Only WhatsApp can be sent from here today; every other channel says so.
 */
async function send(owner, key, body) {
  const k = keyOf(key); if (!k) throw bad('That is not a segment or a group.', 400, 'BAD_KEY');
  const b = body || {}, channel = sendChannelOf(b), purpose = PURPOSE;
  const text = String(b.text == null ? '' : b.text).trim();
  if (!text) throw bad('Write the message.', 400, 'NO_TEXT');
  if (text.length > TEXT_MAX) throw bad('Keep the message under ' + TEXT_MAX + ' characters.', 400, 'TOO_LONG');
  const crm = require('./crm');
  const list = await crm.list(owner, { consent: true });
  const ms = members(list.parties.filter((item) => item.customer && !crm.isLead(item)), k);
  const may = [], refused = [], by = {};
  ms.forEach((item) => { const v = verdictOf(item, channel, purpose); if (v.may) may.push(item); else { refused.push({ party_id: item.party_id, name: item.display_name, code: v.code, why: v.why }); by[v.code] = (by[v.code] || 0) + 1; } });
  const out = { key: k.kind === 'segment' ? k.key : 'group:' + k.name, dry: !!b.dry, channel, purpose, members: ms.length, may: may.length, refused: refused.slice(0, 200),
    refused_by: Object.keys(by).sort().map((code) => ({ code, n: by[code] })), sent: [], sent_n: 0, failed_n: 0, refused_n: refused.length };
  if (b.dry) return out;
  if (may.length > SEND_CAP) throw bad('Send to at most ' + SEND_CAP + ' at a time: this reaches ' + may.length + '. Make a smaller group.', 400, 'TOO_MANY');
  /* the shop's own VERIFIED WhatsApp line (b123 · b126; SEC-FIX3 S7: a declared one is only a claim), ONE statement; none → every send is refused by the sender in words (never a 500) */
  let line = null;
  try { line = (await crm.withEntity(owner, (h) => h.query(`SELECT address, provider_ref FROM channel_binding WHERE entity_id = $1 AND channel = 'whatsapp' AND status = 'verified' ORDER BY verified_at DESC NULLS LAST, created_at LIMIT 1`, [owner]))).rows[0] || null; }
  catch (e) { if (!(e && (e.code === '42P01' || e.code === '42703'))) throw e; }
  const WA = require('./whatsapp-out');
  for (const p of may) {
    if (!p.phone) { out.sent.push({ party_id: p.party_id, name: p.display_name, status: 'refused', reason: 'No phone number.' }); out.refused_n++; continue; }
    const r = await WA.notify(owner, { to_ref: p.phone, from_ref: line && line.address, provider_ref: line && line.provider_ref, text, party_id: p.party_id, purpose });
    const status = (r && r.status) || 'failed';
    out.sent.push({ party_id: p.party_id, name: p.display_name, status, reason: (r && r.reason) || null });
    if (status === 'sent') out.sent_n++; else if (status === 'refused') out.refused_n++; else out.failed_n++;
  }
  return out;
}

module.exports = { CHANNEL, PURPOSE, SEND_CAP, TEXT_MAX, ORDER, WORDS, ruleWords, keyOf, members, reach, offersByGroup, mays, overview, setGroup, dropGroup, send };
