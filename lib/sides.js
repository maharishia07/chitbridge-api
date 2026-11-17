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
 *
 * OWNS the sides answer (lean · use · impact) · CALLED BY routes/entities.js GET /sides (the shell mounts public/app/sides.js).
 * FLOW  readBatch (statements) + header.read + rail → build → { lean, use, impact }      CARD 28-platform-and-operations/sides
 */
const { driftOf } = require('../governance/resolver');
const log = require('./logger');
const impact = require('./impact');
const packWords = require('./pack-words'); /* AU-WORDS: the shop's pack names the tax id (GSTIN · ABN · TRN) and the return (GSTR-3B · BAS · VAT return) — never India's for another country */

const LATER = 'not yet';
const capitalise = (text) => {
  text = String(text || '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
};
const versionLabel = (x) => 'v' + String(x).replace(/^v/i, '');
const plural = (n, firstRow, many) => n + ' ' + (n === 1 ? firstRow : many || firstRow + 's');
const later = (id, n, m) => ({ id, n, m, s: 'later', t: LATER });

function countryName(code) {
  const cleaned = String(code || '')
    .trim()
    .toUpperCase();
  if (!cleaned) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(cleaned) || cleaned;
  } catch (_) {
    return cleaned;
  }
}

/** a minted/active pair -> the row's state. The words are short: Current · Update · not yet. */
function stateOf(minted, active, noun) {
  const data = driftOf(minted, active);
  if (!data.known) return { s: 'later', t: LATER, d: data };
  if (data.drift) return { s: 'wait', t: 'Update', fix: 'Review', detail: 'Minted on ' + versionLabel(data.minted) + '. Now ' + versionLabel(data.active) + '.', d: data };
  return { s: 'ok', t: 'Current', d: data };
}

/** the statements, given which tables / columns exist (the caller probed them). Each is { key, text, params }. */
function statements(entity_id, present) {
  present = present || {};
  const out = [{ key: 'me', text: 'SELECT display_name, country, gstn FROM identities WHERE identity_id = $1', params: [entity_id] }];
  if (present.entity_governance && present.boilerplate) {
    /* the boilerplate's ACTIVE version and label, by the key the stamp holds (the stamp itself is read by govresolve.mintedOf) */
    out.push({
      key: 'bp',
      params: [entity_id],
      text: 'SELECT b.version, b.label FROM boilerplate b WHERE b.boilerplate_key = (SELECT boilerplate_key FROM entity_governance WHERE entity_id = $1) AND b.active = true ORDER BY b.minted_at DESC LIMIT 1'
    });
  }
  if (present.catalogue_adoption && present.catalogue_source) {
    out.push({
      key: 'adopt',
      params: [entity_id],
      text:
        'SELECT a.source_key, a.version AS minted, s.version AS active, s.title FROM catalogue_adoption a ' +
        'LEFT JOIN catalogue_source s ON s.source_key = a.source_key AND s.active = true WHERE a.entity_id = $1 ORDER BY a.adopted_at LIMIT 20'
    });
  }
  if (present.connector_connection) {
    out.push({
      key: 'conn',
      params: [entity_id],
      text: present.connector_type
        ? 'SELECT i.connector_type, c.ref, c.enabled, c.status FROM connector_connection c LEFT JOIN identities i ON i.identity_id = c.actor_id WHERE c.entity_id = $1 ORDER BY c.created_at LIMIT 20'
        : 'SELECT NULL AS connector_type, c.ref, c.enabled, c.status FROM connector_connection c WHERE c.entity_id = $1 ORDER BY c.created_at LIMIT 20'
    });
  }
  out.push({
    key: 'actors',
    params: [entity_id],
    text:
      'SELECT display_name, actor_role, ' +
      (present.can_see_costs ? 'can_see_costs' : 'NULL AS can_see_costs') +
      " FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND break_status <> 'removed'" +
      (present.connector_type ? ' AND connector_type IS NULL' : '') +
      ' ORDER BY display_name LIMIT 20'
  });
  /* ⭐ WHO HOLDS OUR ID is not read from the raw customer_list / supplier_list here (H31-r: the impact box said 3 suppliers where the rail and CRM said 1 -
     the raw list still held hidden, merged and other-world rows). The parties are CRM's own (lib/crm rows + assemble), read ONCE by home-facts.rail
     and handed to build() as d.parties. */
  if (present.register_edges) out.push({ key: 'edges', text: impact.EDGES_SQL, params: [entity_id] });
  return out;
}

/** the Filings row's hint: the pack's return name (GSTR-3B · BAS · VAT return) and "Name your <tax id>" — none for a country with no pack */
function filingsHint(words) {
  return (words.returnShort ? words.returnShort + ' · ' : '') + 'Name your ' + words.taxId;
}
/** "If you change your tax id": who is reached. `field` is the code a client may branch on; `n` is the pack's word (Your GSTIN · Your ABN · Your TRN · Your Tax number) */
function taxIdImpact(words, reach, affected) {
  const reached = reach.businesses
    ? plural(reach.businesses, 'business', 'businesses') + ' · ' + (reach.filings == null ? 'filings ' + LATER : plural(reach.filings, 'filing'))
    : 'Nobody affected';
  return {
    field: 'tax_id',
    tax_id_word: words.taxId,
    k: 'If you change',
    n: 'Your ' + words.taxId,
    businesses: reach.businesses,
    filings: reach.filings,
    m: reached,
    who: affected
  };
}
/** the "Trade proof" row of the right-hand list (CMP-13: the optional ACN is shown on the sheet, never counted here); 'Not read' when the header carries no checks */
function tradeProofRow(tradeReady) {
  if (!(tradeReady && Array.isArray(tradeReady.checks) && tradeReady.checks.length)) return later('proof', 'Trade proof', 'Not read');
  const counted = tradeReady.checks.filter((item) => item && packWords.OPTIONAL_CHECKS.indexOf(item.key) < 0);
  const done = counted.filter((item) => item.done).length,
    missing = counted.filter((item) => !item.done),
    miss = missing[0];
  return {
    id: 'proof',
    n: 'Trade proof',
    m: done + ' of ' + counted.length + ' shown' + (miss ? ' · still to show: ' + missing.map((item) => item.label).join(', ') : ''),
    s: miss ? 'wait' : 'ok',
    t: miss ? 'Incomplete' : 'All',
    fix: miss ? 'Finish' : undefined,
    href: miss ? '/know-your-business.html' : undefined
  };
}

/** build — pure. d: { rows:{key:[rows]}, rail, header, entity_id }  (rail / header null = that reuse could not be read) */
function build(data) {
  const rows = data.rows || {};
  const firstRow = (k) => (rows[k] && rows[k][0]) || null;
  const self = firstRow('me') || {},
    boilerplate = firstRow('bp') || {};
  const words = packWords.wordsFor(self.country); /* the pack's words; no country → "Tax number", no return name */
  const governance = data.gov ? Object.assign({}, data.gov, { boilerplate_active: boilerplate.version || null, boilerplate_label: boilerplate.label || null }) : null;
  const lean = [],
    list = [];

  /* ── LEFT · rules ── */
  const rules = [];
  const countryLabel = countryName(self.country);
  /* the country is known (it is the shop's own); what is not recorded is the version of its rules - say that, not "not set" (H5) */
  rules.push(
    countryLabel
      ? { id: 'jurisdiction', n: countryLabel, m: 'Jurisdiction · version not recorded', s: 'later', t: 'No version' }
      : later('jurisdiction', 'Jurisdiction', 'Country not set')
  );
  rules.push(later('standards', 'Standards', 'What a chit must hold'));
  if (governance) {
    const stateInfo = stateOf(governance.minted, governance.active);
    const version = stateInfo.d.active || stateInfo.d.minted;
    rules.push({
      id: 'constitution',
      n: 'Constitution',
      m: version ? versionLabel(version) + (stateInfo.d.known && stateInfo.d.drift ? ' · minted on ' + versionLabel(stateInfo.d.minted) : '') : 'No version',
      s: stateInfo.s,
      t: stateInfo.t,
      fix: stateInfo.fix,
      detail: stateInfo.detail
    });
  } else rules.push(later('constitution', 'Constitution', 'No stamp yet'));
  lean.push({ key: 'rules', rows: rules });

  /* ── LEFT · mould ── */
  const mould = [];
  if (governance && governance.boilerplate_key) {
    const stateInfo = stateOf(governance.boilerplate_version, governance.boilerplate_active);
    const version = governance.boilerplate_active || governance.boilerplate_version;
    mould.push({
      id: 'boilerplate',
      n: governance.boilerplate_label || capitalise(governance.boilerplate_key),
      m: 'Boilerplate' + (version ? ' · ' + versionLabel(version) : ''),
      s: stateInfo.s,
      t: stateInfo.t,
      fix: stateInfo.fix,
      detail: stateInfo.detail
    });
  } else mould.push(later('boilerplate', 'Boilerplate', 'Not recorded'));
  if (governance && governance.blueprint_key) {
    /* no table keeps a blueprint's ACTIVE version, so a clone can be named but its drift cannot be told */
    mould.push({
      id: 'blueprint',
      n: capitalise(governance.blueprint_key),
      m: 'Blueprint' + (governance.blueprint_version ? ' · ' + versionLabel(governance.blueprint_version) : ''),
      s: 'later',
      t: LATER
    });
  } else mould.push(later('blueprint', 'Blueprint', 'Not recorded'));
  lean.push({ key: 'mould', rows: mould });

  /* ── LEFT · brand sources, connectors, suppliers ── */
  const content = (rows.adopt || []).map((item) => {
    const stateInfo = stateOf(item.minted, item.active);
    return {
      id: 'src:' + item.source_key,
      n: item.title || capitalise(item.source_key),
      m: 'Brand source · ' + versionLabel(item.minted || item.active || '?'),
      s: stateInfo.s,
      t: stateInfo.t,
      fix: stateInfo.fix,
      detail: stateInfo.detail
    };
  });
  if (content.length) lean.push({ key: 'content', rows: content });
  const systems = (rows.conn || []).map((item, index) => {
    const name = capitalise(item.connector_type || item.ref || 'Connector');
    const off = item.enabled === false,
      bad = item.status === 'red';
    return { id: 'conn:' + index, n: name, m: 'Connector', s: off ? 'later' : bad ? 'wait' : 'ok', t: off ? 'Off' : bad ? 'Check' : 'Linked' };
  });
  if (systems.length) lean.push({ key: 'systems', rows: systems });
  /* the parties: CRM's own (d.parties, from home-facts.rail). Only a caller that hands none (a pure test) falls back to the raw lists. */
  const customers = data.parties
    ? data.parties.filter((item) => item.roles && item.roles.customer).map((item) => ({ id: item.party_id, name: item.name || item.display_name }))
    : rows.customers || [];
  const suppliers = data.parties
    ? data.parties.filter((item) => item.roles && item.roles.supplier).map((item) => ({ id: item.party_id, name: item.name || item.display_name }))
    : rows.suppliers || [];
  const nSup = data.rail && data.rail.suppliers != null ? data.rail.suppliers : suppliers.length;
  if (nSup) lean.push({ key: 'buy', rows: [{ id: 'suppliers', n: plural(nSup, 'supplier'), m: 'Network' }] });

  /* ── RIGHT · trade ── */
  const trade = [];
  if (data.rail) {
    const customerCount = data.rail.customers || 0,
      supplierCount = data.rail.suppliers || 0;
    if (customerCount) trade.push({ id: 'customers', n: plural(customerCount, 'customer'), m: data.rail.in != null ? plural(data.rail.in, 'chit') + ' open' : 'Network' });
    if (supplierCount) trade.push({ id: 'suppliers-out', n: plural(supplierCount, 'supplier'), m: data.rail.out != null ? plural(data.rail.out, 'order') + ' open' : 'Network' });
    if (!trade.length) trade.push({ id: 'nobody', n: 'Nobody yet', m: 'Link a supplier first', s: 'empty' });
  } else trade.push(later('trade', 'Trade partners', 'Not read'));
  list.push({ key: 'trade', rows: trade });

  /* ── RIGHT · co-assists, and what each sees ── */
  const actor = (rows.actors || []).map((item, index) => ({
    id: 'actor:' + index,
    n: item.display_name || 'Co-assist',
    m: 'Co-assist' + (item.can_see_costs === true ? ' · sees costs' : item.can_see_costs === false ? ' · no costs' : '')
  }));
  list.push({ key: 'act', rows: actor.length ? actor : [{ id: 'noactor', n: 'No one yet', m: 'Invite an accountant', s: 'empty' }] });

  /* ── RIGHT · filings and chits that cite us; the trade proof others rely on ── */
  const cite = [later('filings', 'Filings', filingsHint(words))];
  cite.push(tradeProofRow(data.header && data.header.trade_ready));
  list.push({ key: 'cite', rows: cite });

  /* ── RIGHT · shops that inherit our blueprint ── */
  list.push({ key: 'inherit', rows: [later('inherit', 'Shops using our blueprint', 'A blueprint others can use')] });

  /* ── the impact box: ONE walk (lib/impact), the partners we know hold our id ── */
  const partners = customers
    .map((item) => ({ id: item.id, name: item.name, role: 'customer' }))
    .concat(suppliers.map((item) => ({ id: item.id, name: item.name, role: 'supplier' })));
  const hops = impact.walk(rows.edges || [], data.entity_id, { backwards: false }).hops;
  const reach = impact.reach(hops, partners);
  const partnerList = partners.concat(hops.filter((item) => item.to_label).map((item) => ({ id: item.to_id, name: item.to_label, role: 'register' })));
  const seen = new Set(),
    names = [];
  for (const p of partnerList) {
    const k = String(p.id);
    if (seen.has(k)) continue;
    seen.add(k);
    names.push({ name: p.name || 'A business', role: p.role });
  }
  const taxImpact = taxIdImpact(words, reach, names.slice(0, 20));
  return { lean, use: list, impact: taxImpact };
}

/** read — the I/O: probe, one readBatch, the two reuses together, build. */
async function read(entity_id, actor_id, opts) {
  opts = opts || {};
  const schema = require('./schema');
  const { readBatch } = require('../db');
  const list = ['entity_governance', 'boilerplate', 'catalogue_adoption', 'catalogue_source', 'connector_connection', 'register_entry'];
  const [tableExists, identityColumn, regc] = await Promise.all([
    Promise.all(list.map((item) => schema.hasTable(item))),
    schema.hasColumns('identities', ['can_see_costs', 'connector_type']),
    schema.hasColumns('register_entry', ['to_id', 'closes_id', 'revises_id'])
  ]);
  const present = {};
  list.forEach((item, index) => {
    present[item] = tableExists[index];
  });
  present.can_see_costs = !!identityColumn.can_see_costs;
  present.connector_type = !!identityColumn.connector_type;
  present.register_edges = !!(present.register_entry && regc.to_id && regc.closes_id && regc.revises_id);
  if (present.entity_governance)
    present.gov = await schema.hasColumns('entity_governance', ['boilerplate_key', 'boilerplate_version', 'blueprint_key', 'blueprint_version']);

  const stmts = statements(entity_id, present);
  const keep = {}; /* home-facts.rail leaves CRM's parties here - the impact walk reads the same ones (H31-r) */
  const rail = () =>
    require('./home-facts')
      .BUILD.rail({ entity: entity_id, actor: actor_id, keep })
      .catch(log.orElse('sides read: the helper failed — answered with nothing', null));
  const header = () => require('./entity-header').read(entity_id, actor_id).catch(log.orElse('sides read: the helper failed — answered with nothing', null));
  const governance = present.entity_governance
    ? () => require('./govresolve').mintedOf(entity_id, { cols: present.gov }).catch(log.orElse('sides read: the helper failed — answered with nothing', null))
    : () => null;
  const [res, railData, headerRow, governanceRow] = await Promise.all([readBatch(entity_id, actor_id, stmts), rail(), header(), governance()]);
  const rows = {};
  stmts.forEach((item, index) => {
    rows[item.key] = (res[index] && res[index].rows) || [];
  });
  return build({ rows, rail: railData, header: headerRow, gov: governanceRow, entity_id, parties: railData ? keep.parties : undefined });
}

module.exports = { read, build, statements, stateOf, LATER };
