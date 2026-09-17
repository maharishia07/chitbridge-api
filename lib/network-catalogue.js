/**
 * network-catalogue.js — A BRAND PUBLISHES ITS PRODUCT CHANGES TO ITS STORES; A STORE'S OWN PRICE IS ONLY EVER SUGGESTED TO
 * (2026-09-17).
 *
 * Athi: *"if the price changed it has to reflect to the store"* — and, asked whether a brand may force its price on a store
 * that is its own GST business: *"suggest only, build publish changes as you recommended."*
 *
 * THE MODEL — nothing new in the database; it rides what exists:
 *   catalogue_source.items        what every store sells from (a published copy — a brand's product edits never reach it
 *                                 until the brand publishes them; there was no screen to do that)
 *   brand.network_catalogue       { pending: { <source_key>: rec }, log: [rec without items] }
 *   store adoption commercials    { <item name>: { price, unit, follow? } }
 *   store.network_price_seen      { '<log id>|<item name>': 'kept' | 'used' }
 *
 * ⭐⭐ WHO FOLLOWS. A store whose price for a product still equals what the brand suggested before (its price, else its MRP) is
 * following the brand: it is marked `follow`, and catalogue-build.resolve prices it at the brand's CURRENT suggestion — so it
 * moves when the publish lands, with no write at that moment. A store that set its own price keeps it and is shown the new
 * suggestion, once, to use or keep. The brand never overwrites a price a store chose.
 * ⭐ WHEN. Like a released offer: at the next opening unless "now" is asked for. A publish waiting for its moment is applied
 * the first time anything reads the catalogue after it (catalogue-build.loadSource) — the same lazy rule lib/schedule.js uses
 * for a product's own dated change. No worker, no clock.
 * ⭐ A RENAME keeps the store's prices: the item carries `formerly`, and resolve looks the old name up.
 */
'use strict';
const { query, withEntity } = require('../db');
const money = require('./money');
const net = require('./network-offers');
const membership = require('./network-membership');   // who is in the network — the network's own tree and edges

const FIELDS = ['name', 'price', 'mrp', 'category', 'hsn', 'unit', 'image', 'desc'];
const LOG_KEEP = 20;
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = money.amountOfLoose(v); return Number.isFinite(n) ? n : null; };
const norm = (s) => String(s || '').trim().toLowerCase();
/** what the brand suggests a store sells it at: its price, else its MRP */
function suggested(it) { const p = num(it && it.price); return p !== null ? p : num(it && it.mrp); }

/** a published item from the brand's own product row, keeping whatever the published copy carried that the product does not */
function fromProduct(d, old) {
  const o = old || {};
  const cat = d.category || (Array.isArray(d.category_names) && d.category_names[0]) || o.category || null;
  const out = Object.assign({}, o, {
    name: String(d.name || o.name || '').trim(),
    price: num(d.price), mrp: num(d.mrp),
    category: cat, hsn: d.hsn || o.hsn || null, unit: d.unit || o.unit || 'piece',
    brand: d.brand || o.brand || null,
    sku: o.sku || d.sku || d.code || null, code: d.code || o.code || null,
    image: d.image || o.image || null,
  });
  if (d.desc) out.desc = String(d.desc); else if (!o.desc) delete out.desc;
  if (o.name && norm(o.name) !== norm(out.name)) out.formerly = [...new Set([].concat(o.formerly || [], [o.name]))];
  return out;
}

function valueOf(it, f) { return f === 'price' ? suggested(it) : (it ? (it[f] === undefined ? null : it[f]) : null); }

/**
 * diff(items, products, add, withdraw) — PURE. items: the published copy; products: the brand's active rows [{ item_id, item_data }];
 * add: brand item ids to share for the first time; withdraw: published names to take away from the stores.
 * → { items, changes, candidates, missing, published }
 * ⭐ WITHDRAWN IS NOT DELETED ANYWHERE ELSE. The item leaves the published copy, so no counter, storefront or checkout offers it;
 * each store's own price for it stays in its overlay, so sharing it again brings it back at the store's price. Past bills and
 * orders carry their own frozen reference and are untouched.
 */
function diff(items, products, add, withdraw) {
  const wanted = new Set((add || []).map(String));
  const gone = new Set((withdraw || []).map(norm));
  const used = new Set();
  const bySku = new Map(), byName = new Map();
  for (const p of products || []) {
    const d = p.item_data || {};
    const code = norm(d.sku || d.code);
    if (code && !bySku.has(code)) bySku.set(code, p);
    if (d.name && !byName.has(norm(d.name))) byName.set(norm(d.name), p);
  }
  const out = [], changes = [], missing = [];
  for (const it of items || []) {
    if (gone.has(norm(it.name))) { changes.push({ kind: 'withdrawn', name: it.name, fields: [] }); continue; }
    let p = (it.sku && bySku.get(norm(it.sku))) || (it.code && bySku.get(norm(it.code))) || byName.get(norm(it.name));
    if (!p) for (const f of (it.formerly || [])) { p = byName.get(norm(f)); if (p) break; }
    if (!p || used.has(String(p.item_id))) { out.push(it); missing.push(it.name); continue; }
    used.add(String(p.item_id));
    const next = fromProduct(p.item_data || {}, it);
    const fields = [];
    for (const f of FIELDS) {
      const a = valueOf(it, f), b = valueOf(next, f);
      if (String(a === null ? '' : a) !== String(b === null ? '' : b)) fields.push({ field: f, from: f === 'image' ? !!a : a, to: f === 'image' ? !!b : b });
    }
    if (fields.length) changes.push({ kind: 'changed', name: next.name, was: it.name !== next.name ? it.name : undefined, fields });
    out.push(next);
  }
  const candidates = [];
  for (const p of products || []) {
    if (used.has(String(p.item_id))) continue;
    const d = p.item_data || {};
    if (!d.name) continue;
    if (wanted.has(String(p.item_id))) {
      const next = fromProduct(d, null);
      out.push(next);
      changes.push({ kind: 'added', name: next.name, fields: [{ field: 'price', from: null, to: suggested(next) }] });
    } else candidates.push({ item_id: p.item_id, name: d.name, price: suggested(fromProduct(d, null)) });
  }
  return { items: out, changes, candidates, missing, published: (items || []).map((it) => it.name) };
}

/**
 * storeChanges(withdrawAt, restoreAt, members, published, current) — PURE. Withdrawing from SOME stores (Athi, 2026-09-17:
 * "can we withdraw from specific store as well?"). withdrawAt / restoreAt: { <name>: [store ids] }; current: the brand's record
 * { <name>: [store ids] } of where each product is already withdrawn. Only member stores and published names count, and only
 * real changes are returned: [{ kind: 'withdrawn_at' | 'restored_at', name, stores }].
 */
function storeChanges(withdrawAt, restoreAt, members, published, current) {
  const mem = new Set((members || []).map(String));
  const names = new Set(published || []);
  const cur = current || {};
  const out = [];
  const each = (map, kind) => {
    for (const [name, ids] of Object.entries(map || {})) {
      if (!names.has(name) || !Array.isArray(ids)) continue;
      const already = new Set((cur[name] || []).map(String));
      const stores = [...new Set(ids.map(String))].filter((id) => mem.has(id) && (kind === 'withdrawn_at' ? !already.has(id) : already.has(id)));
      if (stores.length) out.push({ kind, name, stores, fields: [] });
    }
  };
  each(withdrawAt, 'withdrawn_at');
  each(restoreAt, 'restored_at');
  return out;
}
/** the brand's record after those changes — { <name>: [store ids] } */
function withdrawnAfter(current, changes) {
  const out = {};
  for (const [k, v] of Object.entries(current || {})) out[k] = (v || []).map(String);
  for (const c of changes || []) {
    if (c.kind !== 'withdrawn_at' && c.kind !== 'restored_at') continue;
    const set = new Set(out[c.name] || []);
    c.stores.forEach((id) => (c.kind === 'withdrawn_at' ? set.add(String(id)) : set.delete(String(id))));
    if (set.size) out[c.name] = [...set]; else delete out[c.name];
  }
  return out;
}

async function brandProducts(brand_id) {
  const r = await withEntity(brand_id, (db) => db.query(
    `SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true ORDER BY item_data->>'name'`, [brand_id]));
  return r.rows;
}
async function ownSources(brand_id) {
  const r = await query(`SELECT source_key, title, items FROM catalogue_source WHERE owner_entity_id = $1 AND active = true ORDER BY source_key`, [brand_id]);
  return r.rows;
}
async function setPending(brand_id, source_key, rec) {
  if (rec) {
    await query(
      `UPDATE identities SET policy_flags = jsonb_set(jsonb_set(jsonb_set(COALESCE(policy_flags, '{}'::jsonb),
          '{network_catalogue}', COALESCE(policy_flags->'network_catalogue', '{}'::jsonb)),
          '{network_catalogue,pending}', COALESCE(policy_flags#>'{network_catalogue,pending}', '{}'::jsonb)),
          ARRAY['network_catalogue', 'pending', $2::text], $3::jsonb)
        WHERE identity_id = $1`, [brand_id, source_key, JSON.stringify(rec)]);
  } else {
    await query(`UPDATE identities SET policy_flags = policy_flags #- ARRAY['network_catalogue', 'pending', $2::text] WHERE identity_id = $1`,
      [brand_id, source_key]);
  }
}
async function addLog(brand_id, entry) {
  const { flags } = await net.flagsOf(brand_id);
  const nc = flags.network_catalogue || {};
  const log = [entry].concat((Array.isArray(nc.log) ? nc.log : []).filter((x) => x.id !== entry.id)).slice(0, LOG_KEEP);
  await net.mergeFlag(brand_id, 'network_catalogue', { log });
}

/**
 * apply(brand_id, rec) — make a publish the published copy. Only one caller wins when two readers arrive together: the
 * pending record is removed on the condition that it is still THIS one, and only the winner writes.
 */
async function apply(brand_id, rec, { fromPending } = {}) {
  if (fromPending) {
    const won = await query(
      `UPDATE identities SET policy_flags = policy_flags #- ARRAY['network_catalogue', 'pending', $2::text]
        WHERE identity_id = $1 AND policy_flags#>>ARRAY['network_catalogue', 'pending', $2::text, 'id'] = $3
        RETURNING identity_id`, [brand_id, rec.source_key, rec.id]);
    if (!won.rows.length) return false;
  }
  await query(`UPDATE catalogue_source SET items = $3::jsonb WHERE source_key = $1 AND owner_entity_id = $2`,
    [rec.source_key, brand_id, JSON.stringify(rec.items)]);
  try { await require('./container').syncItemContainers(brand_id, rec.source_key, rec.items); } catch (_) {}
  /* ⭐ withdrawn from SOME stores: the mark goes on each store's own overlay (resolve hides it there), and the brand keeps the
     record of where — so its screen never has to read every store */
  const perStore = (rec.changes || []).filter((c) => c.kind === 'withdrawn_at' || c.kind === 'restored_at');
  if (perStore.length) {
    const byStore = {};
    perStore.forEach((c) => c.stores.forEach((id) => { (byStore[id] = byStore[id] || []).push(c); }));
    for (const [store_id, list] of Object.entries(byStore)) {
      await withEntity(store_id, async (db) => {
        const r = await db.query('SELECT commercials FROM catalogue_adoption WHERE entity_id = $1 AND source_key = $2', [store_id, rec.source_key]);
        if (!r.rows[0]) return;
        const com = Object.assign({}, r.rows[0].commercials || {});
        for (const c of list) {
          const e = Object.assign({}, com[c.name] || {});
          if (c.kind === 'withdrawn_at') e.brand_withdrawn = true; else delete e.brand_withdrawn;
          com[c.name] = e;
        }
        await db.query('UPDATE catalogue_adoption SET commercials = $3::jsonb, updated_at = now() WHERE entity_id = $1 AND source_key = $2',
          [store_id, rec.source_key, JSON.stringify(com)]);
      }).catch(() => {});
      require('./shopchanged').shopChanged(store_id, 'network catalogue withdrawn');
    }
    const { flags } = await net.flagsOf(brand_id);
    const all = Object.assign({}, (flags.network_catalogue || {}).withdrawn_at || {});
    all[rec.source_key] = withdrawnAfter(all[rec.source_key], perStore);
    await net.mergeFlag(brand_id, 'network_catalogue', { withdrawn_at: all });
  }
  const entry = Object.assign({}, rec, { applied_at: new Date().toISOString() });
  delete entry.items;
  await addLog(brand_id, entry);
  await net.pushToNetwork(brand_id, 'network catalogue published');
  return true;
}

/** a waiting publish whose moment has passed, found by loadSource — applied once, then the fresh items are served */
async function applyIfDue(brand_id, pending) {
  if (!brand_id || !pending || !pending.id || !pending.at || new Date(pending.at).getTime() > Date.now()) return null;
  try { await apply(brand_id, pending, { fromPending: true }); } catch (_) { return null; }
  return pending.items;
}

/** the member stores that adopted this source, with their overlay */
async function memberAdoptions(brand_id, source_key) {
  const out = [];
  for (const store_id of await membership.members(brand_id)) {
    const r = await withEntity(store_id, (db) => db.query(
      'SELECT commercials FROM catalogue_adoption WHERE entity_id = $1 AND source_key = $2', [store_id, source_key])).catch(() => ({ rows: [] }));
    if (r.rows[0]) out.push({ store_id, commercials: r.rows[0].commercials || {} });
  }
  return out;
}

/**
 * publish(brand_id, source_key, { at, add, by }) → { rec, applied, followed } | { error }
 * ⚠️ `follow` is marked BEFORE the new items land, while the published suggestion is still the old one — so a following
 * store's price does not move until the publish does.
 */
async function publish(brand_id, source_key, opts) {
  const o = opts || {};
  const src = (await ownSources(brand_id)).find((s) => s.source_key === source_key);
  if (!src) return { error: 'not_yours', message: 'That catalogue is not one you publish.' };
  const d = diff(src.items || [], await brandProducts(brand_id), o.add, o.withdraw);
  const { flags: bf } = await net.flagsOf(brand_id);
  const current = (((bf.network_catalogue || {}).withdrawn_at) || {})[source_key] || {};
  /* a product withdrawn from EVERY store needs no per-store mark as well */
  const everywhere = new Set(d.changes.filter((c) => c.kind === 'withdrawn').map((c) => c.name));
  d.changes.push(...storeChanges(o.withdraw_at, o.restore_at, await membership.members(brand_id),
    (src.items || []).map((it) => it.name).filter((n) => !everywhere.has(n)), current));
  if (!d.changes.length) return { error: 'nothing', message: 'Your stores already have every change.' };
  const at = net.whenOf(o.at, net.nextOpening());
  const rec = { id: require('crypto').randomUUID(), source_key, at, published_at: new Date().toISOString(),
                published_by: o.by || null, changes: d.changes, items: d.items };

  /* the stores still at the brand's old suggestion follow it from now on */
  let followed = 0;
  const priced = d.changes.filter((c) => c.kind === 'changed' && c.fields.some((f) => f.field === 'price'));
  if (priced.length) {
    const oldByName = new Map((src.items || []).map((it) => [it.name, it]));
    for (const m of await memberAdoptions(brand_id, source_key)) {
      const com = Object.assign({}, m.commercials);
      let touched = false;
      for (const c of priced) {
        const oldName = c.was || c.name;
        const e = com[oldName];
        if (!e || e.follow) continue;
        if (num(e.price) !== null && num(e.price) === suggested(oldByName.get(oldName))) { com[oldName] = Object.assign({}, e, { follow: true }); touched = true; followed++; }
      }
      if (touched) await withEntity(m.store_id, (db) => db.query(
        'UPDATE catalogue_adoption SET commercials = $3::jsonb, updated_at = now() WHERE entity_id = $1 AND source_key = $2',
        [m.store_id, source_key, JSON.stringify(com)]));
    }
  }

  const now = new Date(at).getTime() <= Date.now();
  if (now) await apply(brand_id, rec);
  else {
    await setPending(brand_id, source_key, rec);
    const entry = Object.assign({}, rec); delete entry.items;
    await addLog(brand_id, entry);
    await net.pushToNetwork(brand_id, 'network catalogue scheduled');
  }
  return { rec: Object.assign({}, rec, { items: undefined }), applied: now, followed };
}

async function cancel(brand_id, source_key) {
  const { flags } = await net.flagsOf(brand_id);
  const p = ((flags.network_catalogue || {}).pending || {})[source_key];
  if (!p) return { error: 'none', message: 'Nothing is waiting to be published.' };
  await setPending(brand_id, source_key, null);
  const log = (((flags.network_catalogue || {}).log) || []).map((x) => x.id === p.id ? Object.assign({}, x, { cancelled_at: new Date().toISOString() }) : x);
  await net.mergeFlag(brand_id, 'network_catalogue', { log });
  return { ok: true, id: p.id };
}

/** the brand's half of the screen: per catalogue, what would go out, what is waiting, what went */
async function brandView(brand_id) {
  const sources = await ownSources(brand_id).catch(() => []);
  if (!sources.length) return null;
  const products = await brandProducts(brand_id).catch(() => []);
  const { flags } = await net.flagsOf(brand_id);
  const nc = flags.network_catalogue || {};
  /* the member stores, by name, for withdrawing from some of them — one read */
  const stores = await net.memberNames(await membership.members(brand_id)).catch(() => []);
  return sources.map((s) => {
    const d = diff(s.items || [], products, []);
    const p = (nc.pending || {})[s.source_key] || null;
    return { source_key: s.source_key, title: s.title, items: (s.items || []).length,
             changes: d.changes, candidates: d.candidates, missing: d.missing, published: d.published,
             stores, withdrawn_at: ((nc.withdrawn_at || {})[s.source_key]) || {},
             pending: p ? { id: p.id, at: p.at, published_at: p.published_at, changes: p.changes } : null,
             log: (Array.isArray(nc.log) ? nc.log : []).filter((x) => x.source_key === s.source_key).slice(0, 5) };
  });
}

/**
 * the store's half: a brand's new suggestion for a product this store prices itself — the latest one per product, once.
 * adoptions: [{ source_key, commercials }] of this store.
 */
async function storeNotices(store_id, adoptions) {
  const out = [];
  const seen = ((await net.flagsOf(store_id)).flags.network_price_seen) || {};
  const ownerOf = {};
  if (!adoptions.length) return out;
  const src = await query('SELECT source_key, owner_entity_id, items FROM catalogue_source WHERE source_key = ANY($1::text[])',
    [adoptions.map((a) => a.source_key)]).catch(() => ({ rows: [] }));
  src.rows.forEach((r) => { ownerOf[r.source_key] = r; });
  /* only a brand whose network this store is IN speaks to it */
  const inside = await membership.brandsOf(store_id, src.rows.map((r) => r.owner_entity_id));
  for (const a of adoptions) {
    const s = ownerOf[a.source_key];
    if (!s || !s.owner_entity_id || String(s.owner_entity_id) === String(store_id) || !inside.has(String(s.owner_entity_id))) continue;
    const { name, flags } = await net.flagsOf(s.owner_entity_id);
    const brandName = await net.brandName(s.owner_entity_id, name);
    const log = ((flags.network_catalogue || {}).log || []).filter((x) => x.source_key === a.source_key && x.applied_at);
    const itemByName = new Map((s.items || []).map((it) => [it.name, it]));
    const done = new Set();
    for (const entry of log) {                                  /* newest first */
      for (const c of (entry.changes || [])) {
        if (c.kind === 'withdrawn_at' || c.kind === 'restored_at') {
          if (!(c.stores || []).map(String).includes(String(store_id))) continue;      /* about another store */
          const k = entry.id + '|' + c.name;
          const e = (a.commercials || {})[c.name] || {};
          const stillSo = c.kind === 'withdrawn_at' ? !!e.brand_withdrawn : !e.brand_withdrawn;
          if (done.has(c.name) || seen[k] || !stillSo || num(e.price) === null) { done.add(c.name); continue; }
          done.add(c.name);
          out.push({ kind: c.kind === 'withdrawn_at' ? 'withdrawn' : 'restored', key: k, log_id: entry.id, source_key: a.source_key,
                     brand_id: s.owner_entity_id, brand_name: brandName, name: c.name, at: entry.applied_at, only_here: true });
          continue;
        }
        if (c.kind === 'withdrawn') {
          /* ⭐ a product this store sold is no longer offered by the brand — said once, only to a store that priced it */
          const k = entry.id + '|' + c.name;
          if (done.has(c.name) || seen[k] || !(a.commercials || {})[c.name] || itemByName.has(c.name)) { done.add(c.name); continue; }
          done.add(c.name);
          out.push({ kind: 'withdrawn', key: k, log_id: entry.id, source_key: a.source_key, brand_id: s.owner_entity_id, brand_name: brandName,
                     name: c.name, at: entry.applied_at });
          continue;
        }
        const pf = (c.fields || []).find((f) => f.field === 'price');
        if (!pf || done.has(c.name)) continue;
        done.add(c.name);
        const it = itemByName.get(c.name);
        const e = (a.commercials || {})[c.name] || (it && (it.formerly || []).map((f) => (a.commercials || {})[f]).find(Boolean));
        if (!e || e.follow) continue;
        const yours = num(e.price), to = suggested(it) !== null ? suggested(it) : pf.to;
        if (yours === null || to === null || yours === to) continue;
        const key = entry.id + '|' + c.name;
        if (seen[key]) continue;
        out.push({ kind: 'price', key, log_id: entry.id, source_key: a.source_key, brand_id: s.owner_entity_id, brand_name: brandName,
                   name: c.name, suggested: to, was: pf.from, yours, at: entry.applied_at });
      }
    }
  }
  return out;
}

/** the store answers a suggestion: 'use' takes the brand's price (and follows it from then on), 'keep' keeps its own */
async function answer(store_id, { source_key, name, key, choice }) {
  if (['use', 'keep', 'ok'].indexOf(choice) < 0) return { error: 'validation', message: 'choice must be use, keep or ok' };
  if (choice === 'use') {
    const s = await query('SELECT items FROM catalogue_source WHERE source_key = $1', [source_key]);
    const it = ((s.rows[0] && s.rows[0].items) || []).find((x) => x.name === name);
    const to = suggested(it);
    if (to === null) return { error: 'no_price', message: 'The brand has no price for that product.' };
    const r = await withEntity(store_id, (db) => db.query(
      'SELECT commercials FROM catalogue_adoption WHERE entity_id = $1 AND source_key = $2', [store_id, source_key]));
    if (!r.rows[0]) return { error: 'not_adopted', message: 'This store does not sell that catalogue.' };
    const com = Object.assign({}, r.rows[0].commercials || {});
    const cur = com[name] || (it.formerly || []).map((f) => com[f]).find(Boolean) || {};
    const cur$ = (cur.price && typeof cur.price === 'object' && cur.price.currency) || null;
    for (const f of (it.formerly || [])) delete com[f];
    com[name] = Object.assign({}, cur, { price: cur$ ? { amount: to, currency: cur$ } : to, follow: true });
    await withEntity(store_id, (db) => db.query(
      'UPDATE catalogue_adoption SET commercials = $3::jsonb, updated_at = now() WHERE entity_id = $1 AND source_key = $2',
      [store_id, source_key, JSON.stringify(com)]));
    require('./shopchanged').shopChanged(store_id, 'price taken from the brand');
  }
  if (key) await net.setIn(store_id, 'network_price_seen', key, choice === 'use' ? 'used' : (choice === 'ok' ? 'seen' : 'kept'));
  return { ok: true, choice };
}

/**
 * keepFollow(incoming, existing, items) — PURE. A store's save sends its prices back, often without the `follow` flag it never
 * saw. It keeps following a product while the price it saves IS the brand's suggestion; a price of its own ends it.
 */
function keepFollow(incoming, existing, items) {
  const byName = new Map((items || []).map((it) => [it.name, it]));
  const out = Object.assign({}, incoming || {});
  for (const [name, e] of Object.entries(out)) {
    if (!e || typeof e !== 'object') continue;
    const prev = (existing || {})[name];
    const want = e.follow !== undefined ? !!e.follow : !!(prev && prev.follow);
    const s = suggested(byName.get(name));
    const follows = want && s !== null && num(e.price) === s;
    const next = Object.assign({}, e);
    if (follows) next.follow = true; else delete next.follow;
    /* ⚠️ the brand's withdrawal is the BRAND's mark: a store's save can neither set nor clear it */
    if (prev && prev.brand_withdrawn) next.brand_withdrawn = true; else delete next.brand_withdrawn;
    out[name] = next;
  }
  /* ⚠️ and a withdrawn product is not on the store's screen, so its save leaves it out — the mark (and the price) must survive */
  for (const [name, prev] of Object.entries(existing || {})) {
    if (prev && prev.brand_withdrawn && !(name in out)) out[name] = prev;
  }
  return out;
}

module.exports = { storeChanges, withdrawnAfter, keepFollow, FIELDS, suggested, fromProduct, diff, publish, cancel, apply, applyIfDue, brandView, storeNotices, answer };
