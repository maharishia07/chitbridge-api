/**
 * network-offers.js — A BRAND RELEASES AN OFFER TO ITS NETWORK; EACH STORE TAKES IT OR NOT; EVERY COUNTER HONOURS IT
 * FROM THE MOMENT IT WAS RELEASED FOR (2026-09-17).
 *
 * Athi: *"only offers the store opts into — that can be a setting, opt-in, opt-out. These are different models for
 * different business units. Someone who wants to become a big brand … for them you control the stores and offers, so
 * they can create new offers, not to change in the middle of the day — a controlled mechanism of releasing the offer.
 * Those offers reflect in every store and every counter … when an offer is released and pushed, each store that uses
 * the reference gets the new offer; when the store gets it, it pushes to the counters as well."*
 *
 * THE PIECES, EACH WHERE IT BELONGS — no migration; everything rides identities.policy_flags, which is not row-secured:
 *   brand.network_offers   { policy: 'opt_in' | 'opt_out',
 *                            released: { <definition_id>: { at, until, released_at, released_by } } }
 *   brand.network_members  { <store_entity_id>: { at } }        who adopted this brand — see noteMember()
 *   store.network_choices  { <definition_id>: 'in' | 'out' }
 *
 * ⭐⭐ THE RELEASE TRAVELS AS A VALIDITY WINDOW. The offer engine already refuses an offer before valid_from and after
 * valid_to, at the moment it prices. So a released offer is sent to every counter with valid_from = the release moment,
 * and it switches on THERE, at that moment — with the line down, without a server clock, without a scheduler. "Not in the
 * middle of the day" is the default: a release with no time takes effect at the next opening (midnight, India time).
 *
 * ⭐⭐ THE PUSH IS THE ONE ALREADY BUILT. lib/shopchanged tells every counter and screen of a shop that its copy is stale;
 * they re-read through the ordinary snapshot. A release therefore tells every member store — and each store's counters
 * are exactly the clients subscribed under that store. No second push system.
 *
 * ⚠️ READING ANOTHER SHOP'S OFFERS. The brand's offer rows are read under the BRAND's context, and only the ones the brand
 * has explicitly RELEASED. Releasing is the brand's act of publishing them to its network; nothing unreleased leaves it.
 * ⚠️ THE OFFER ENGINE IS NOT TOUCHED (it is locked, harden-only). This builds the offer list a counter is handed; how an
 * offer prices a line is the engine's, unchanged.
 */
'use strict';
const { query, withEntity } = require('../db');

const POLICIES = ['opt_in', 'opt_out'];

/** one statement: shallow-merge `patch` into policy_flags[section] of one identity */
async function mergeFlag(entity_id, section, patch) {
  await query(
    `UPDATE identities
        SET policy_flags = jsonb_set(COALESCE(policy_flags, '{}'::jsonb), ARRAY[$2::text],
              COALESCE(policy_flags->$2, '{}'::jsonb) || $3::jsonb)
      WHERE identity_id = $1`,
    [entity_id, section, JSON.stringify(patch)]);
}
/** one statement: set policy_flags[section][key] = value (value null removes the key) */
async function setIn(entity_id, section, key, value) {
  if (value === null || value === undefined) {
    await query(
      `UPDATE identities SET policy_flags = jsonb_set(COALESCE(policy_flags, '{}'::jsonb), ARRAY[$2::text],
              COALESCE(policy_flags->$2, '{}'::jsonb) - $3::text)
        WHERE identity_id = $1`, [entity_id, section, String(key)]);
    return;
  }
  await query(
    `UPDATE identities SET policy_flags = jsonb_set(COALESCE(policy_flags, '{}'::jsonb), ARRAY[$2::text],
            COALESCE(policy_flags->$2, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb))
      WHERE identity_id = $1`, [entity_id, section, String(key), JSON.stringify(value)]);
}
/**
 * one statement: policy_flags.network_offers.released[<id>] = rec — never read-modify-write, so two releases pressed at
 * the same moment both land
 */
async function setReleased(brand_id, id, rec) {
  await query(
    `UPDATE identities
        SET policy_flags = jsonb_set(
              jsonb_set(
                jsonb_set(COALESCE(policy_flags, '{}'::jsonb), '{network_offers}', COALESCE(policy_flags->'network_offers', '{}'::jsonb)),
                '{network_offers,released}', COALESCE(policy_flags#>'{network_offers,released}', '{}'::jsonb)),
              ARRAY['network_offers', 'released', $2::text], $3::jsonb)
      WHERE identity_id = $1`,
    [brand_id, String(id), JSON.stringify(rec)]);
}
async function flagsOf(entity_id) {
  const r = await query('SELECT display_name, policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  const row = r.rows[0] || {};
  return { name: row.display_name || null, flags: row.policy_flags || {} };
}

/**
 * ⭐ THE NAME A CUSTOMER KNOWS THE BRAND BY — the title it gave its catalogue, before the internal handle. A counter
 * that said "from e2eco-mu4u0alb465" would be naming the brand by its account id ([TILL-26] caught it).
 */
async function brandName(brand_id, fallback) {
  try {
    const r = await query(`SELECT title FROM catalogue_source WHERE owner_entity_id = $1 AND COALESCE(title, '') <> ''
                            ORDER BY source_key LIMIT 1`, [brand_id]);
    if (r.rows[0] && r.rows[0].title) return String(r.rows[0].title);
  } catch (_) {}
  return fallback || null;
}
/**
 * ⭐ THE NEXT OPENING — midnight, India time. "Not in the middle of the day" is the default a brand gets without asking.
 * ⚠️ India first (the shops this is built for); a country-aware day-roll can replace this without changing any caller.
 */
function nextOpening(now) {
  const IST = 330 * 60000;
  const t = (now ? new Date(now) : new Date()).getTime() + IST;
  const d = new Date(t);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0) - IST;
  return new Date(next).toISOString();
}
function whenOf(v, fallback) {
  if (v === 'now') return new Date().toISOString();
  if (v) { const d = new Date(v); if (!isNaN(d.getTime())) return d.toISOString(); }
  return fallback;
}

/** a store joined this brand's network — kept on the brand so a release knows whom to tell (adoption itself is row-secured) */
async function noteMember(brand_id, store_id) {
  if (!brand_id || !store_id || String(brand_id) === String(store_id)) return;
  try {
    const r = await query(`SELECT policy_flags->'network_members'->$2 AS m FROM identities WHERE identity_id = $1`, [brand_id, String(store_id)]);
    if (r.rows[0] && r.rows[0].m) return;                  /* already known — no write on every read */
    await setIn(brand_id, 'network_members', store_id, { at: new Date().toISOString() });
  } catch (_) { /* an index that cannot be written costs a push, never a sale */ }
}

/** tell the brand's own counters and every member store's counters that their copy moved */
async function pushToNetwork(brand_id, what) {
  const { shopChanged } = require('./shopchanged');
  let n = 0;
  try {
    const { flags } = await flagsOf(brand_id);
    const members = Object.keys(flags.network_members || {});
    for (const id of members) n += shopChanged(id, what) || 0;
    shopChanged(brand_id, what);
    return { stores: members.length, clients: n };
  } catch (_) { return { stores: 0, clients: n }; }
}

/** the brand's view: its policy, its live offers with their release, how many stores it would reach */
async function brandView(brand_id) {
  const { flags } = await flagsOf(brand_id);
  const no = flags.network_offers || {};
  const rel = no.released || {};
  const r = await withEntity(brand_id, (db) => db.query(
    `SELECT definition_id, name, sub_kind, status, current_version FROM definition
      WHERE entity_id = $1 AND kind = 'offer' AND status IN ('live', 'draft') ORDER BY name`, [brand_id])).catch(() => ({ rows: [] }));
  /* ⭐ a shop that authors a catalogue source is a brand with a network to release to; any other shop is not */
  const owns = await query('SELECT 1 FROM catalogue_source WHERE owner_entity_id = $1 LIMIT 1', [brand_id]).catch(() => ({ rows: [] }));
  return {
    is_brand: owns.rows.length > 0 || Object.keys(flags.network_members || {}).length > 0,
    policy: POLICIES.indexOf(no.policy) >= 0 ? no.policy : 'opt_in',
    stores: Object.keys(flags.network_members || {}).length,
    offers: r.rows.map((d) => {
      const rr = rel[d.definition_id] || null;
      /* ⚠️ edited since it was released — the stores are still on the released version until it goes out again */
      const changed = !!(rr && rr.version && Number(rr.version) !== Number(d.current_version));
      return { id: d.definition_id, name: d.name, kind: d.sub_kind, status: d.status, version: d.current_version, released: rr, changed };
    }),
  };
}

/**
 * ⭐⭐⭐ THE OFFERS A STORE'S COUNTER IS HANDED FROM ITS NETWORKS.
 *   owners    the brands whose sources this store adopts (the snapshot already resolved them)
 *   linesByOwner  { brand_id: [{ name, id }] } — the network lines on this counter, so an offer a brand targeted at ITS
 *             products (by id) reaches the same products here, where they carry a reference id instead
 * ⚠️ POLICY decides the default, the STORE's choice decides the rest:
 *   opt_in   only offers the store said 'in' to
 *   opt_out  every released offer, except those the store said 'out' to
 */
async function forStore(store_id, owners, linesByOwner) {
  const out = [];
  const choices = ((await flagsOf(store_id)).flags.network_choices) || {};
  const catalogueView = require('./catalogue-view');
  for (const brand_id of [...new Set((owners || []).filter(Boolean).map(String))]) {
    if (brand_id === String(store_id)) continue;       /* a brand's own offers are already its own */
    noteMember(brand_id, store_id);                     /* backfills stores that adopted before the index existed */
    const { name: handle, flags } = await flagsOf(brand_id);
    const shownAs = await brandName(brand_id, handle);
    const no = flags.network_offers || {};
    const policy = POLICIES.indexOf(no.policy) >= 0 ? no.policy : 'opt_in';
    const rel = no.released || {};
    const ids = Object.keys(rel).filter((id) => {
      const c = choices[id];
      return policy === 'opt_in' ? c === 'in' : c !== 'out';
    });
    if (!ids.length) continue;
    /* ⭐ the PINNED version of each released offer (and the one before it, while it still runs) — never simply the current one */
    const vr = await withEntity(brand_id, (db) => db.query(
      `SELECT d.definition_id, d.name, d.sub_kind, v.version, v.rules
         FROM definition d JOIN definition_version v ON v.definition_id = d.definition_id
        WHERE d.entity_id = $1 AND d.kind = 'offer' AND d.status = 'live' AND d.definition_id::text = ANY($2::text[])`,
      [brand_id, ids])).catch(() => ({ rows: [] }));
    const byVer = {};
    /* nested by id, then version — not an id@version string, which reads as a version reference and is not one */
    vr.rows.forEach((row) => { (byVer[row.definition_id] = byVer[row.definition_id] || {})[row.version] = row; });
    const verOf = (id, v) => (byVer[id] || {})[v];
    const offers = [];
    for (const id of ids) {
      const r = rel[id] || {};
      const pinned = r.version ? verOf(id, r.version)
        : vr.rows.filter((x) => String(x.definition_id) === id).sort((a, b) => b.version - a.version)[0];
      if (pinned) offers.push(Object.assign(catalogueView.offerFromRow(pinned), { _rel: { at: r.at, until: r.until, version: pinned.version } }));
      if (r.prev && r.prev.version && verOf(id, r.prev.version) && (!r.prev.until || new Date(r.prev.until) > new Date())) {
        offers.push(Object.assign(catalogueView.offerFromRow(verOf(id, r.prev.version)),
          { _rel: { at: r.prev.at, until: r.prev.until, version: r.prev.version } }));
      }
    }
    if (!offers.length) continue;

    /* brand item ids → the names the brand gave them → this counter's reference ids for those names */
    const itemIds = [...new Set([].concat(...offers.map((o) => (o.applies_to && Array.isArray(o.applies_to.item_ids)) ? o.applies_to.item_ids.map(String) : [])))];
    const nameOf = {};
    if (itemIds.length) {
      const q = await withEntity(brand_id, (db) => db.query(
        `SELECT item_id::text AS id, item_data->>'name' AS name FROM catalogue_items WHERE entity_id = $1 AND item_id::text = ANY($2::text[])`,
        [brand_id, itemIds])).catch(() => ({ rows: [] }));
      q.rows.forEach((x) => { nameOf[x.id] = String(x.name || '').trim().toLowerCase(); });
    }
    const here = linesByOwner && linesByOwner[brand_id] || [];
    const idsForName = (nm) => here.filter((l) => String(l.name || '').trim().toLowerCase() === nm).map((l) => l.id);

    for (const o of offers) {
      const r = o._rel || rel[String(o.id)] || {};
      const copy = JSON.parse(JSON.stringify(o));
      delete copy._rel;
      /* ⭐ the release window, narrowed onto whatever window the brand gave the offer itself */
      /* ⚠️ only ever NARROWED, and a date-only valid_to means the END of that day to the engine — converting it naively
         would have ended a brand's offer a whole day early */
      if (r.at) {
        const own = copy.valid_from ? new Date(copy.valid_from) : null, a = new Date(r.at);
        if (!own || isNaN(own.getTime()) || a > own) copy.valid_from = a.toISOString();
      }
      if (r.until) {
        const raw = copy.valid_to ? String(copy.valid_to) : '';
        const own = raw ? (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T23:59:59.999Z') : new Date(raw)) : null;
        const u = new Date(r.until);
        if (!own || isNaN(own.getTime()) || u < own) copy.valid_to = u.toISOString();
      }
      if (copy.applies_to && Array.isArray(copy.applies_to.item_ids)) {
        const mapped = [];
        for (const id of copy.applies_to.item_ids.map(String)) {
          const nm = nameOf[id];
          if (nm) mapped.push(...idsForName(nm));
        }
        copy.applies_to.item_ids = [...new Set(copy.applies_to.item_ids.map(String).concat(mapped))];
      }
      copy.network = { brand_id, brand_name: shownAs, policy, version: r.version || null, released_at: (rel[String(o.id)] || {}).released_at || null,
                       at: r.at || null, until: r.until || null };
      out.push(copy);
    }
  }
  return out;
}

module.exports = { POLICIES, brandName, nextOpening, whenOf, mergeFlag, setIn, setReleased, flagsOf, noteMember, pushToNetwork, brandView, forStore };
