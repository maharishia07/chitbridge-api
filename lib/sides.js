'use strict';
/**
 * lib/sides.js — THE TWO SIDES: what this business LEANS ON, and what LEANS ON IT (GET /api/entities/sides; the web unit is
 * public/app/sides.js, mounted by the shell). Designer handoff: designs-inbox/cb-sides-2026-10-08.
 *
 *   { lean:[{ key, rows:[row] }], use:[{ key, rows:[row] }], impact }
 *   row = { id, n (name), m (kind · version · note), s ('ok' | 'wait' | 'later' | 'empty'), t (the state's word), fix ('Review' | 'Finish'),
 *           detail (what Review shows), href (where Finish goes) }
 *
 * ⭐ REUSE, NOT A SECOND PATH
 *   drift          governance/resolver.driftOf — the ONE minted-vs-active rule (built on driftStatus). Constitution and brand sources
 *                  have both versions today; a boilerplate / blueprint only once b294 has run AND the mint path stamps them.
 *   impact         lib/impact — the walk raida.walk also uses ("If you change your GSTIN: N businesses · M filings").
 *   trade proof    lib/entity-header.read — the SAME trade_ready (3 of 4) the shell's sheet shows. Not recomputed.
 *   trade partners lib/home-facts.BUILD.rail — the suppliers / customers / open-chit figures the Home rail shows.
 *
 * ⭐ A SOURCE WITH NO DATA IS A ROW, NOT A GAP. s:'later' prints "not yet" — never 0, never "Current". What has no source today:
 *   the jurisdiction's and the standards' version-at-mint (nothing stamps them) · filings that cite our ids (no register of filings)
 *   · shops that inherit our blueprint (no clone record the other way) · the boilerplate/blueprint version at mint (b294).
 * Counts are ROWS: the web counts the rows it draws (empty placeholders excluded), not the records behind them.
 *
 * ONE readBatch for the statements (every table probed first — the batch aborts whole on a missing one), plus the two reads it
 * reuses (rail: 2 trips, header: 2 trips cold / 1 warm). They run together; a failed reuse turns its rows into 'later', not a 500.
 */
const { driftOf } = require('../governance/resolver');
const impact = require('./impact');

const LATER = 'not yet';
const cap = (s) => { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
const v = (x) => 'v' + String(x).replace(/^v/i, '');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const later = (id, n, m) => ({ id, n, m, s: 'later', t: LATER });

function countryName(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) || c; } catch (_) { return c; }
}

/** a minted/active pair -> the row's state. The words are short: Current · Update · not yet. */
function stateOf(minted, active, noun) {
  const d = driftOf(minted, active);
  if (!d.known) return { s: 'later', t: LATER, d };
  if (d.drift) return { s: 'wait', t: 'Update', fix: 'Review', detail: 'Minted on ' + v(d.minted) + '. Now ' + v(d.active) + '.', d };
  return { s: 'ok', t: 'Current', d };
}

/** the statements, given which tables / columns exist (the caller probed them). Each is { key, text, params }. */
function statements(entity_id, has) {
  has = has || {};
  const out = [{ key: 'me', text: 'SELECT display_name, country, gstn FROM identities WHERE identity_id = $1', params: [entity_id] }];
  if (has.entity_governance && has.boilerplate) {
    /* the boilerplate's ACTIVE version and label, by the key the stamp holds (the stamp itself is read by govresolve.mintedOf) */
    out.push({ key: 'bp', params: [entity_id], text:
      'SELECT b.version, b.label FROM boilerplate b WHERE b.boilerplate_key = (SELECT boilerplate_key FROM entity_governance WHERE entity_id = $1) AND b.active = true ORDER BY b.minted_at DESC LIMIT 1' });
  }
  if (has.catalogue_adoption && has.catalogue_source) {
    out.push({ key: 'adopt', params: [entity_id], text:
      'SELECT a.source_key, a.version AS minted, s.version AS active, s.title FROM catalogue_adoption a ' +
      'LEFT JOIN catalogue_source s ON s.source_key = a.source_key AND s.active = true WHERE a.entity_id = $1 ORDER BY a.adopted_at LIMIT 20' });
  }
  if (has.connector_connection) {
    out.push({ key: 'conn', params: [entity_id], text: has.connector_type
      ? 'SELECT i.connector_type, c.ref, c.enabled, c.status FROM connector_connection c LEFT JOIN identities i ON i.identity_id = c.actor_id WHERE c.entity_id = $1 ORDER BY c.created_at LIMIT 20'
      : 'SELECT NULL AS connector_type, c.ref, c.enabled, c.status FROM connector_connection c WHERE c.entity_id = $1 ORDER BY c.created_at LIMIT 20' });
  }
  out.push({ key: 'actors', params: [entity_id], text:
    "SELECT display_name, actor_role, " + (has.can_see_costs ? 'can_see_costs' : 'NULL AS can_see_costs') +
    " FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND break_status <> 'removed'" +
    (has.connector_type ? ' AND connector_type IS NULL' : '') + ' ORDER BY display_name LIMIT 20' });
  /* ⭐ WHO HOLDS OUR ID is not read from the raw customer_list / supplier_list here (H31-r: the impact box said 3 suppliers where the rail and CRM said 1 -
     the raw list still held hidden, merged and other-world rows). The parties are CRM's own (lib/crm rows + assemble), read ONCE by home-facts.rail
     and handed to build() as d.parties. */
  if (has.register_edges) out.push({ key: 'edges', text: impact.EDGES_SQL, params: [entity_id] });
  return out;
}

/** build — pure. d: { rows:{key:[rows]}, rail, header, entity_id }  (rail / header null = that reuse could not be read) */
function build(d) {
  const R = d.rows || {};
  const one = (k) => (R[k] && R[k][0]) || null;
  const me = one('me') || {}, bp = one('bp') || {};
  const gov = d.gov ? Object.assign({}, d.gov, { boilerplate_active: bp.version || null, boilerplate_label: bp.label || null }) : null;
  const lean = [], use = [];

  /* ── LEFT · rules ── */
  const rules = [];
  const cn = countryName(me.country);
  /* the country is known (it is the shop's own); what is not recorded is the version of its rules - say that, not "not set" (H5) */
  rules.push(cn ? { id: 'jurisdiction', n: cn, m: 'Jurisdiction · version not recorded', s: 'later', t: 'No version' } : later('jurisdiction', 'Jurisdiction', 'Country not set'));
  rules.push(later('standards', 'Standards', 'What a chit must hold'));
  if (gov) {
    const st = stateOf(gov.minted, gov.active);
    const ver = st.d.active || st.d.minted;
    rules.push({ id: 'constitution', n: 'Constitution', m: ver ? v(ver) + (st.d.known && st.d.drift ? ' · minted on ' + v(st.d.minted) : '') : 'No version', s: st.s, t: st.t, fix: st.fix, detail: st.detail });
  } else rules.push(later('constitution', 'Constitution', 'No stamp yet'));
  lean.push({ key: 'rules', rows: rules });

  /* ── LEFT · mould ── */
  const mould = [];
  if (gov && gov.boilerplate_key) {
    const st = stateOf(gov.boilerplate_version, gov.boilerplate_active);
    const ver = gov.boilerplate_active || gov.boilerplate_version;
    mould.push({ id: 'boilerplate', n: gov.boilerplate_label || cap(gov.boilerplate_key), m: 'Boilerplate' + (ver ? ' · ' + v(ver) : ''), s: st.s, t: st.t, fix: st.fix, detail: st.detail });
  } else mould.push(later('boilerplate', 'Boilerplate', 'Not recorded'));
  if (gov && gov.blueprint_key) {
    /* no table keeps a blueprint's ACTIVE version, so a clone can be named but its drift cannot be told */
    mould.push({ id: 'blueprint', n: cap(gov.blueprint_key), m: 'Blueprint' + (gov.blueprint_version ? ' · ' + v(gov.blueprint_version) : ''), s: 'later', t: LATER });
  } else mould.push(later('blueprint', 'Blueprint', 'Not recorded'));
  lean.push({ key: 'mould', rows: mould });

  /* ── LEFT · brand sources, connectors, suppliers ── */
  const content = (R.adopt || []).map((a) => {
    const st = stateOf(a.minted, a.active);
    return { id: 'src:' + a.source_key, n: a.title || cap(a.source_key), m: 'Brand source · ' + v(a.minted || a.active || '?'), s: st.s, t: st.t, fix: st.fix, detail: st.detail };
  });
  if (content.length) lean.push({ key: 'content', rows: content });
  const systems = (R.conn || []).map((c, i) => {
    const name = cap(c.connector_type || c.ref || 'Connector');
    const off = c.enabled === false, bad = c.status === 'red';
    return { id: 'conn:' + i, n: name, m: 'Connector', s: off ? 'later' : bad ? 'wait' : 'ok', t: off ? 'Off' : bad ? 'Check' : 'Linked' };
  });
  if (systems.length) lean.push({ key: 'systems', rows: systems });
  /* the parties: CRM's own (d.parties, from home-facts.rail). Only a caller that hands none (a pure test) falls back to the raw lists. */
  const cus = d.parties ? d.parties.filter((p) => p.roles && p.roles.customer).map((p) => ({ id: p.party_id, name: p.name || p.display_name })) : (R.customers || []);
  const sup = d.parties ? d.parties.filter((p) => p.roles && p.roles.supplier).map((p) => ({ id: p.party_id, name: p.name || p.display_name })) : (R.suppliers || []);
  const nSup = d.rail && d.rail.suppliers != null ? d.rail.suppliers : sup.length;
  if (nSup) lean.push({ key: 'buy', rows: [{ id: 'suppliers', n: plural(nSup, 'supplier'), m: 'Network' }] });

  /* ── RIGHT · trade ── */
  const trade = [];
  if (d.rail) {
    const nc = d.rail.customers || 0, ns = d.rail.suppliers || 0;
    if (nc) trade.push({ id: 'customers', n: plural(nc, 'customer'), m: d.rail.in != null ? plural(d.rail.in, 'chit') + ' open' : 'Network' });
    if (ns) trade.push({ id: 'suppliers-out', n: plural(ns, 'supplier'), m: d.rail.out != null ? plural(d.rail.out, 'order') + ' open' : 'Network' });
    if (!trade.length) trade.push({ id: 'nobody', n: 'Nobody yet', m: 'Link a supplier first', s: 'empty' });
  } else trade.push(later('trade', 'Trade partners', 'Not read'));
  use.push({ key: 'trade', rows: trade });

  /* ── RIGHT · co-assists, and what each sees ── */
  const act = (R.actors || []).map((a, i) => ({ id: 'actor:' + i, n: a.display_name || 'Co-assist',
    m: 'Co-assist' + (a.can_see_costs === true ? ' · sees costs' : a.can_see_costs === false ? ' · no costs' : '') }));
  use.push({ key: 'act', rows: act.length ? act : [{ id: 'noactor', n: 'No one yet', m: 'Invite an accountant', s: 'empty' }] });

  /* ── RIGHT · filings and chits that cite us; the trade proof others rely on ── */
  const cite = [later('filings', 'Filings', 'Name your GSTIN')];
  const tr = d.header && d.header.trade_ready;
  if (tr && Array.isArray(tr.checks) && tr.checks.length) {
    const done = tr.checks.filter((c) => c && c.done).length, missing = tr.checks.filter((c) => c && !c.done), miss = missing[0];
    cite.push({ id: 'proof', n: 'Trade proof', m: done + ' of ' + tr.checks.length + ' shown' + (miss ? ' · still to show: ' + missing.map((c) => c.label).join(', ') : ''), s: miss ? 'wait' : 'ok', t: miss ? 'Incomplete' : 'All',
      fix: miss ? 'Finish' : undefined, href: miss ? '/know-your-business.html' : undefined });
  } else cite.push(later('proof', 'Trade proof', 'Not read'));
  use.push({ key: 'cite', rows: cite });

  /* ── RIGHT · shops that inherit our blueprint ── */
  use.push({ key: 'inherit', rows: [later('inherit', 'Shops using our blueprint', 'A blueprint others can use')] });

  /* ── the impact box: ONE walk (lib/impact), the partners we know hold our id ── */
  const partners = cus.map((p) => ({ id: p.id, name: p.name, role: 'customer' })).concat(sup.map((p) => ({ id: p.id, name: p.name, role: 'supplier' })));
  const hops = impact.walk(R.edges || [], d.entity_id, { backwards: false }).hops;
  const reach = impact.reach(hops, partners);
  const who = partners.concat(hops.filter((h) => h.to_label).map((h) => ({ id: h.to_id, name: h.to_label, role: 'register' })));
  const seen = new Set(), names = [];
  for (const p of who) { const k = String(p.id); if (seen.has(k)) continue; seen.add(k); names.push({ name: p.name || 'A business', role: p.role }); }
  const imp = { field: 'gstin', k: 'If you change', n: 'Your GSTIN', businesses: reach.businesses, filings: reach.filings,
    m: reach.businesses ? plural(reach.businesses, 'business', 'businesses') + ' · ' + (reach.filings == null ? 'filings ' + LATER : plural(reach.filings, 'filing')) : 'Nobody affected',
    who: names.slice(0, 20) };
  return { lean, use, impact: imp };
}

/** read — the I/O: probe, one readBatch, the two reuses together, build. */
async function read(entity_id, actor_id, opts) {
  opts = opts || {};
  const schema = require('./schema');
  const { readBatch } = require('../db');
  const T = ['entity_governance', 'boilerplate', 'catalogue_adoption', 'catalogue_source', 'connector_connection', 'register_entry'];
  const [tbl, idc, regc] = await Promise.all([
    Promise.all(T.map((t) => schema.hasTable(t))),
    schema.hasColumns('identities', ['can_see_costs', 'connector_type']),
    schema.hasColumns('register_entry', ['to_id', 'closes_id', 'revises_id']),
  ]);
  const has = {};
  T.forEach((t, i) => { has[t] = tbl[i]; });
  has.can_see_costs = !!idc.can_see_costs; has.connector_type = !!idc.connector_type;
  has.register_edges = !!(has.register_entry && regc.to_id && regc.closes_id && regc.revises_id);
  if (has.entity_governance) has.gov = await schema.hasColumns('entity_governance', ['boilerplate_key', 'boilerplate_version', 'blueprint_key', 'blueprint_version']);

  const stmts = statements(entity_id, has);
  const keep = {};   /* home-facts.rail leaves CRM's parties here - the impact walk reads the same ones (H31-r) */
  const rail = () => require('./home-facts').BUILD.rail({ entity: entity_id, actor: actor_id, keep }).catch(() => null);
  const header = () => require('./entity-header').read(entity_id, actor_id).catch(() => null);
  const gov = has.entity_governance ? () => require('./govresolve').mintedOf(entity_id, { cols: has.gov }).catch(() => null) : () => null;
  const [res, r, h, g] = await Promise.all([readBatch(entity_id, actor_id, stmts), rail(), header(), gov()]);
  const rows = {};
  stmts.forEach((s, i) => { rows[s.key] = (res[i] && res[i].rows) || []; });
  return build({ rows, rail: r, header: h, gov: g, entity_id, parties: r ? keep.parties : undefined });
}

module.exports = { read, build, statements, stateOf, LATER };
