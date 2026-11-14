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
/* OWNS the network catalogue: what a brand publishes to its stores, the diff between releases, the store marks
 * CALLED BY routes/network-catalogue.js, routes/assist.js (the brand's publish and the stores' reads)
 * FLOW brand source -> diff against what the stores hold -> release record with its opening (the brand's own midnight) -> pushed to the network
 * CARD network-and-trade/network-catalogue */
'use strict';
const { query, withEntity } = require('../db');
const logger = require('./logger');
const money = require('./money');
const sellablePrice = require('./sellable-price'); // CAT-324: a negative stored price is never suggested or adopted
const networkOffers = require('./network-offers');
const membership = require('./network-membership'); // who is in the network — the network's own tree and edges
const policy = require('./policy'); // T2-POLICY: the one writer of policy_flags (patchKey)

const FIELDS = ['name', 'price', 'mrp', 'category', 'hsn', 'unit', 'image', 'desc'];
const LOG_KEEP = 20;
/** a price or MRP as a number; null when unset or unsellable (a negative is no price — zero is) */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  return sellablePrice.soldAt(money.amountOfLoose(v));
};
const norm = (source) =>
  String(source || '')
    .trim()
    .toLowerCase();
/** what the brand suggests a store sells it at: its price, else its MRP */
function suggested(item) {
  const product = num(item && item.price);
  return product !== null ? product : num(item && item.mrp);
}

/** a published item from the brand's own product row, keeping whatever the published copy carried that the product does not */
function fromProduct(data, old) {
  const options = old || {};
  const category = data.category || (Array.isArray(data.category_names) && data.category_names[0]) || options.category || null;
  const out = Object.assign({}, options, {
    name: String(data.name || options.name || '').trim(),
    price: num(data.price),
    mrp: num(data.mrp),
    category: category,
    hsn: data.hsn || options.hsn || null,
    unit: data.unit || options.unit || 'piece',
    brand: data.brand || options.brand || null,
    sku: options.sku || data.sku || data.code || null,
    code: data.code || options.code || null,
    image: data.image || options.image || null
  });
  if (data.desc) out.desc = String(data.desc);
  else if (!options.desc) delete out.desc;
  if (options.name && norm(options.name) !== norm(out.name)) out.formerly = [...new Set([].concat(options.formerly || [], [options.name]))];
  return out;
}

function valueOf(item, f) {
  return f === 'price' ? suggested(item) : item ? (item[f] === undefined ? null : item[f]) : null;
}

/**
 * diff(items, products, add, withdraw) — PURE. items: the published copy; products: the brand's active rows [{ item_id, item_data }];
 * add: brand item ids to share for the first time; withdraw: published names to take away from the stores.
 * → { items, changes, candidates, missing, published }
 * ⭐ WITHDRAWN IS NOT DELETED ANYWHERE ELSE. The item leaves the published copy, so no counter, storefront or checkout offers it;
 * each store's own price for it stays in its overlay, so sharing it again brings it back at the store's price. Past bills and
 * orders carry their own frozen reference and are untouched.
 */
function diff(items, products, toAdd, withdraw) {
  const wanted = new Set((toAdd || []).map(String));
  const gone = new Set((withdraw || []).map(norm));
  const used = new Set();
  const bySku = new Map(),
    byName = new Map();
  for (const p of products || []) {
    const data = p.item_data || {};
    const code = norm(data.sku || data.code);
    if (code && !bySku.has(code)) bySku.set(code, p);
    if (data.name && !byName.has(norm(data.name))) byName.set(norm(data.name), p);
  }
  const out = [],
    changes = [],
    missing = [];
  for (const it of items || []) {
    if (gone.has(norm(it.name))) {
      changes.push({ kind: 'withdrawn', name: it.name, fields: [] });
      continue;
    }
    let product = (it.sku && bySku.get(norm(it.sku))) || (it.code && bySku.get(norm(it.code))) || byName.get(norm(it.name));
    if (!product)
      for (const f of it.formerly || []) {
        product = byName.get(norm(f));
        if (product) break;
      }
    if (!product || used.has(String(product.item_id))) {
      out.push(it);
      missing.push(it.name);
      continue;
    }
    used.add(String(product.item_id));
    const next = fromProduct(product.item_data || {}, it);
    const fields = [];
    for (const f of FIELDS) {
      const before = valueOf(it, f),
        after = valueOf(next, f);
      if (String(before === null ? '' : before) !== String(after === null ? '' : after)) fields.push({ field: f, from: f === 'image' ? !!before : before, to: f === 'image' ? !!after : after });
    }
    if (fields.length) changes.push({ kind: 'changed', name: next.name, was: it.name !== next.name ? it.name : undefined, fields });
    out.push(next);
  }
  const candidates = [];
  for (const p of products || []) {
    if (used.has(String(p.item_id))) continue;
    const data = p.item_data || {};
    if (!data.name) continue;
    if (wanted.has(String(p.item_id))) {
      const next = fromProduct(data, null);
      out.push(next);
      changes.push({ kind: 'added', name: next.name, fields: [{ field: 'price', from: null, to: suggested(next) }] });
    } else candidates.push({ item_id: p.item_id, name: data.name, price: suggested(fromProduct(data, null)) });
  }
  return { items: out, changes, candidates, missing, published: (items || []).map((item) => item.name) };
}

/**
 * storeChanges(withdrawAt, restoreAt, members, published, current) — PURE. Withdrawing from SOME stores (Athi, 2026-09-17:
 * "can we withdraw from specific store as well?"). withdrawAt / restoreAt: { <name>: [store ids] }; current: the brand's record
 * { <name>: [store ids] } of where each product is already withdrawn. Only member stores and published names count, and only
 * real changes are returned: [{ kind: 'withdrawn_at' | 'restored_at', name, stores }].
 */
function storeChanges(withdrawAt, restoreAt, members, published, current) {
  const seen = new Set((members || []).map(String));
  const names = new Set(published || []);
  const existing = current || {};
  const out = [];
  const each = (map, kind) => {
    for (const [name, ids] of Object.entries(map || {})) {
      if (!names.has(name) || !Array.isArray(ids)) continue;
      const already = new Set((existing[name] || []).map(String));
      const stores = [...new Set(ids.map(String))].filter((id) => seen.has(id) && (kind === 'withdrawn_at' ? !already.has(id) : already.has(id)));
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
    if (set.size) out[c.name] = [...set];
    else delete out[c.name];
  }
  return out;
}

async function brandProducts(brand_id) {
  const result = await withEntity(brand_id, (db) =>
    db.query(`SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true ORDER BY item_data->>'name'`, [brand_id])
  );
  return result.rows;
}
async function ownSources(brand_id) {
  const result = await query(`SELECT source_key, title, items FROM catalogue_source WHERE owner_entity_id = $1 AND active = true ORDER BY source_key`, [brand_id]);
  return result.rows;
}
async function setPending(brand_id, source_key, rec) {
  if (rec) {
    await policy.patchKey(null, brand_id, ['network_catalogue', 'pending', source_key], rec); /* T2-POLICY: the one writer */
  } else {
    await policy.patchKey(null, brand_id, ['network_catalogue', 'pending', source_key], null, { op: 'remove' });
  }
}
async function addLog(brand_id, entry) {
  const { flags } = await networkOffers.flagsOf(brand_id);
  const catalogueFlags = flags.network_catalogue || {};
  const log = [entry].concat((Array.isArray(catalogueFlags.log) ? catalogueFlags.log : []).filter((x) => x.id !== entry.id)).slice(0, LOG_KEEP);
  await networkOffers.mergeFlag(brand_id, 'network_catalogue', { log });
}

/**
 * apply(brand_id, rec) — make a publish the published copy. Only one caller wins when two readers arrive together: the
 * pending record is removed on the condition that it is still THIS one, and only the winner writes.
 */
async function apply(brand_id, rec, { fromPending } = {}) {
  if (fromPending) {
    const claimed = await policy.patchKey(null, brand_id, ['network_catalogue', 'pending', rec.source_key], null, {
      op: 'remove',
      when: { path: ['network_catalogue', 'pending', rec.source_key, 'id'], equals: rec.id }
    });
    if (!claimed.rows.length) return false;
  }
  /* SEC-75/DB-103 (b855): a catalogue_source write runs bound to the owning brand */
  await withEntity(brand_id, (bound) =>
    bound.query(`UPDATE catalogue_source SET items = $3::jsonb WHERE source_key = $1 AND owner_entity_id = $2`, [
      rec.source_key,
      brand_id,
      JSON.stringify(rec.items)
    ])
  );
  try {
    await require('./container').syncItemContainers(brand_id, rec.source_key, rec.items);
  } catch (e) {
    logger.fellBack('network-catalogue: the helper failed — carried on without it', e);
  }
  /* ⭐ withdrawn from SOME stores: the mark goes on each store's own overlay (resolve hides it there), and the brand keeps the
     record of where — so its screen never has to read every store */
  const perStore = (rec.changes || []).filter((item) => item.kind === 'withdrawn_at' || item.kind === 'restored_at');
  if (perStore.length) {
    const byStore = {};
    perStore.forEach((item) =>
      item.stores.forEach((id) => {
        (byStore[id] = byStore[id] || []).push(item);
      })
    );
    for (const [store_id, list] of Object.entries(byStore)) {
      await withEntity(store_id, async (db) => {
        const result = await db.query('SELECT commercials FROM catalogue_adoption WHERE entity_id = $1 AND source_key = $2', [store_id, rec.source_key]);
        if (!result.rows[0]) return;
        const commercials = Object.assign({}, result.rows[0].commercials || {});
        for (const c of list) {
          const e = Object.assign({}, commercials[c.name] || {});
          if (c.kind === 'withdrawn_at') e.brand_withdrawn = true;
          else delete e.brand_withdrawn;
          commercials[c.name] = e;
        }
        await db.query('UPDATE catalogue_adoption SET commercials = $3::jsonb, updated_at = now() WHERE entity_id = $1 AND source_key = $2', [
          store_id,
          rec.source_key,
          JSON.stringify(commercials)
        ]);
      }).catch(logger.orElse('network-catalogue: failed — carried on without it'));
      require('./shopchanged').shopChanged(store_id, 'network catalogue withdrawn');
    }
    const { flags } = await networkOffers.flagsOf(brand_id);
    const all = Object.assign({}, (flags.network_catalogue || {}).withdrawn_at || {});
    all[rec.source_key] = withdrawnAfter(all[rec.source_key], perStore);
    await networkOffers.mergeFlag(brand_id, 'network_catalogue', { withdrawn_at: all });
  }
  const entry = Object.assign({}, rec, { applied_at: new Date().toISOString() });
  delete entry.items;
  await addLog(brand_id, entry);
  await networkOffers.pushToNetwork(brand_id, 'network catalogue published');
  return true;
}

/** a waiting publish whose moment has passed, found by loadSource — applied once, then the fresh items are served */
async function applyIfDue(brand_id, pending) {
  if (!brand_id || !pending || !pending.id || !pending.at || new Date(pending.at).getTime() > Date.now()) return null;
  try {
    await apply(brand_id, pending, { fromPending: true });
  } catch (e) {
    logger.fellBack('network-catalogue applyIfDue: failed — answered with nothing', e);
    return null;
  }
  return pending.items;
}

/** the member stores that adopted this source, with their overlay */
async function memberAdoptions(brand_id, source_key) {
  const out = [];
  for (const store_id of await membership.members(brand_id)) {
    const result = await withEntity(store_id, (db) =>
      db.query('SELECT commercials FROM catalogue_adoption WHERE entity_id = $1 AND source_key = $2', [store_id, source_key])
    ).catch(logger.orElse('network-catalogue memberAdoptions: the read failed — answered with none', { rows: [] }));
    if (result.rows[0]) out.push({ store_id, commercials: result.rows[0].commercials || {} });
  }
  return out;
}

/**
 * publish(brand_id, source_key, { at, add, by }) → { rec, applied, followed } | { error }
 * ⚠️ `follow` is marked BEFORE the new items land, while the published suggestion is still the old one — so a following
 * store's price does not move until the publish does.
 */
async function publish(brand_id, source_key, opts) {
  const options = opts || {};
  const source = (await ownSources(brand_id)).find((item) => item.source_key === source_key);
  if (!source) return { error: 'not_yours', message: 'That catalogue is not one you publish.' };
  const data = diff(source.items || [], await brandProducts(brand_id), options.add, options.withdraw);
  const { flags: brandFlags } = await networkOffers.flagsOf(brand_id);
  const current = ((brandFlags.network_catalogue || {}).withdrawn_at || {})[source_key] || {};
  /* a product withdrawn from EVERY store needs no per-store mark as well */
  const everywhere = new Set(data.changes.filter((item) => item.kind === 'withdrawn').map((item) => item.name));
  data.changes.push(
    ...storeChanges(
      options.withdraw_at,
      options.restore_at,
      await membership.members(brand_id),
      (source.items || []).map((item) => item.name).filter((item) => !everywhere.has(item)),
      current
    )
  );
  if (!data.changes.length) return { error: 'nothing', message: 'Your stores already have every change.' };
  const at = networkOffers.whenOf(options.at, await networkOffers.nextOpeningFor(brand_id));
  const rec = {
    id: require('crypto').randomUUID(),
    source_key,
    at,
    published_at: new Date().toISOString(),
    published_by: options.by || null,
    changes: data.changes,
    items: data.items
  };

  /* the stores still at the brand's old suggestion follow it from now on */
  let followed = 0;
  const priced = data.changes.filter((item) => item.kind === 'changed' && item.fields.some((entry) => entry.field === 'price'));
  if (priced.length) {
    const oldByName = new Map((source.items || []).map((item) => [item.name, item]));
    for (const m of await memberAdoptions(brand_id, source_key)) {
      const commercials = Object.assign({}, m.commercials);
      let touched = false;
      for (const c of priced) {
        const oldName = c.was || c.name;
        const e = commercials[oldName];
        if (!e || e.follow) continue;
        if (num(e.price) !== null && num(e.price) === suggested(oldByName.get(oldName))) {
          commercials[oldName] = Object.assign({}, e, { follow: true });
          touched = true;
          followed++;
        }
      }
      if (touched)
        await withEntity(m.store_id, (db) =>
          db.query('UPDATE catalogue_adoption SET commercials = $3::jsonb, updated_at = now() WHERE entity_id = $1 AND source_key = $2', [
            m.store_id,
            source_key,
            JSON.stringify(commercials)
          ])
        );
    }
  }

  const now = new Date(at).getTime() <= Date.now();
  if (now) await apply(brand_id, rec);
  else {
    await setPending(brand_id, source_key, rec);
    const entry = Object.assign({}, rec);
    delete entry.items;
    await addLog(brand_id, entry);
    await networkOffers.pushToNetwork(brand_id, 'network catalogue scheduled');
  }
  return { rec: Object.assign({}, rec, { items: undefined }), applied: now, followed };
}

async function cancel(brand_id, source_key) {
  const { flags } = await networkOffers.flagsOf(brand_id);
  const product = ((flags.network_catalogue || {}).pending || {})[source_key];
  if (!product) return { error: 'none', message: 'Nothing is waiting to be published.' };
  await setPending(brand_id, source_key, null);
  const log = ((flags.network_catalogue || {}).log || []).map((x) => (x.id === product.id ? Object.assign({}, x, { cancelled_at: new Date().toISOString() }) : x));
  await networkOffers.mergeFlag(brand_id, 'network_catalogue', { log });
  return { ok: true, id: product.id };
}

/** the brand's half of the screen: per catalogue, what would go out, what is waiting, what went */
/** the brand's own catalogue sources — $1 = owner identity_id */
const OWN_SOURCES_SQL = `SELECT source_key, title, items FROM catalogue_source WHERE owner_entity_id = $1 AND active = true ORDER BY source_key`;
/** the brand's products — $1 = brand identity_id; a tenant read, under the brand's binding */
const BRAND_PRODUCTS_SQL = `SELECT item_id, item_data FROM catalogue_items WHERE entity_id = $1 AND is_active = true ORDER BY item_data->>'name'`;
/**
 * brandView(brand_id, pre?) — `pre` (EFF-TRIPS, 2026-10-15) carries what the caller read in ONE batch: { sources (rows of OWN_SOURCES_SQL),
 * products (rows of BRAND_PRODUCTS_SQL), flags, members (ids in the network), names (Map id → display_name) }. Without it, read here as before.
 */
async function brandView(brand_id, preloaded) {
  preloaded = preloaded || {};
  const sources = preloaded.sources || (await ownSources(brand_id).catch(logger.orElse('network-catalogue brandView: failed — answered with none', [])));
  if (!sources.length) return null;
  const products = preloaded.products || (await brandProducts(brand_id).catch(logger.orElse('network-catalogue brandView: failed — answered with none', [])));
  const { flags } = preloaded.flags ? { flags: preloaded.flags } : await networkOffers.flagsOf(brand_id);
  const catalogueFlags = flags.network_catalogue || {};
  /* the member stores, by name, for withdrawing from some of them — one read */
  const stores = await networkOffers.memberNames(
    preloaded.members || (await membership.members(brand_id)),
    preloaded
  ); /* a failed read throws NETWORK_READ_FAILED, never "no stores" */
  return sources.map((item) => {
    const data = diff(item.items || [], products, []);
    const product = (catalogueFlags.pending || {})[item.source_key] || null;
    return {
      source_key: item.source_key,
      title: item.title,
      items: (item.items || []).length,
      changes: data.changes,
      candidates: data.candidates,
      missing: data.missing,
      published: data.published,
      stores,
      withdrawn_at: (catalogueFlags.withdrawn_at || {})[item.source_key] || {},
      pending: product ? { id: product.id, at: product.at, published_at: product.published_at, changes: product.changes } : null,
      log: (Array.isArray(catalogueFlags.log) ? catalogueFlags.log : []).filter((x) => x.source_key === item.source_key).slice(0, 5)
    };
  });
}

/**
 * the store's half: a brand's new suggestion for a product this store prices itself — the latest one per product, once.
 * adoptions: [{ source_key, commercials }] of this store.
 */
/**
 * storeNotices(store_id, adoptions, pre?) — `pre` (EFF-TRIPS, 2026-10-15): { seen (flags.network_price_seen), src (rows: source_key ·
 * owner_entity_id · items), inside (Set of brand ids this store is IN — membership.brandsOf's answer), brands ({ id: { name, flags, title } })
 * — every per-brand read the caller already made in its batch. Without it, read here as before.
 */
async function storeNotices(store_id, adoptions, preloaded) {
  preloaded = preloaded || {};
  const out = [];
  const seen = preloaded.seen || (await networkOffers.flagsOf(store_id)).flags.network_price_seen || {};
  const ownerOf = {};
  if (!adoptions.length) return out;
  const source = preloaded.src
    ? { rows: preloaded.src }
    : await query('SELECT source_key, owner_entity_id, items FROM catalogue_source WHERE source_key = ANY($1::text[])', [
        adoptions.map((item) => item.source_key)
      ]).catch(logger.orElse('network-catalogue storeNotices: the read failed — answered with none', { rows: [] }));
  source.rows.forEach((item) => {
    ownerOf[item.source_key] = item;
  });
  /* only a brand whose network this store is IN speaks to it */
  const inside =
    preloaded.inside ||
    (await membership.brandsOf(
      store_id,
      source.rows.map((item) => item.owner_entity_id)
    ));
  for (const a of adoptions) {
    const owner = ownerOf[a.source_key];
    if (!owner || !owner.owner_entity_id || String(owner.owner_entity_id) === String(store_id) || !inside.has(String(owner.owner_entity_id))) continue;
    const preBrand = preloaded.brands && preloaded.brands[String(owner.owner_entity_id)];
    const { name, flags } = preBrand ? { name: preBrand.name, flags: preBrand.flags || {} } : await networkOffers.flagsOf(owner.owner_entity_id);
    const brandName = preBrand ? preBrand.title || name || null : await networkOffers.brandName(owner.owner_entity_id, name);
    const log = ((flags.network_catalogue || {}).log || []).filter((x) => x.source_key === a.source_key && x.applied_at);
    const itemByName = new Map((owner.items || []).map((item) => [item.name, item]));
    const done = new Set();
    for (const entry of log) {
      /* newest first */
      for (const c of entry.changes || []) {
        if (c.kind === 'withdrawn_at' || c.kind === 'restored_at') {
          if (!(c.stores || []).map(String).includes(String(store_id))) continue; /* about another store */
          const k = entry.id + '|' + c.name;
          const problem = (a.commercials || {})[c.name] || {};
          const stillSo = c.kind === 'withdrawn_at' ? !!problem.brand_withdrawn : !problem.brand_withdrawn;
          if (done.has(c.name) || seen[k] || !stillSo || num(problem.price) === null) {
            done.add(c.name);
            continue;
          }
          done.add(c.name);
          out.push({
            kind: c.kind === 'withdrawn_at' ? 'withdrawn' : 'restored',
            key: k,
            log_id: entry.id,
            source_key: a.source_key,
            brand_id: owner.owner_entity_id,
            brand_name: brandName,
            name: c.name,
            at: entry.applied_at,
            only_here: true
          });
          continue;
        }
        if (c.kind === 'withdrawn') {
          /* ⭐ a product this store sold is no longer offered by the brand — said once, only to a store that priced it */
          const k = entry.id + '|' + c.name;
          if (done.has(c.name) || seen[k] || !(a.commercials || {})[c.name] || itemByName.has(c.name)) {
            done.add(c.name);
            continue;
          }
          done.add(c.name);
          out.push({
            kind: 'withdrawn',
            key: k,
            log_id: entry.id,
            source_key: a.source_key,
            brand_id: owner.owner_entity_id,
            brand_name: brandName,
            name: c.name,
            at: entry.applied_at
          });
          continue;
        }
        const priceField = (c.fields || []).find((item) => item.field === 'price');
        if (!priceField || done.has(c.name)) continue;
        done.add(c.name);
        const listed = itemByName.get(c.name);
        const e = (a.commercials || {})[c.name] || (listed && (listed.formerly || []).map((item) => (a.commercials || {})[item]).find(Boolean));
        if (!e || e.follow) continue;
        const yours = num(e.price),
          to = suggested(listed) !== null ? suggested(listed) : priceField.to;
        if (yours === null || to === null || yours === to) continue;
        const key = entry.id + '|' + c.name;
        if (seen[key]) continue;
        out.push({
          kind: 'price',
          key,
          log_id: entry.id,
          source_key: a.source_key,
          brand_id: owner.owner_entity_id,
          brand_name: brandName,
          name: c.name,
          suggested: to,
          was: priceField.from,
          yours,
          at: entry.applied_at
        });
      }
    }
  }
  return out;
}

/** the store answers a suggestion: 'use' takes the brand's price (and follows it from then on), 'keep' keeps its own */
async function answer(store_id, { source_key, name, key, choice }) {
  if (['use', 'keep', 'ok'].indexOf(choice) < 0) return { error: 'validation', message: 'choice must be use, keep or ok' };
  if (choice === 'use') {
    const source = await query('SELECT items FROM catalogue_source WHERE source_key = $1', [source_key]);
    const entry = ((source.rows[0] && source.rows[0].items) || []).find((x) => x.name === name);
    const to = suggested(entry);
    if (to === null) return { error: 'no_price', message: 'The brand has no price for that product.' };
    const result = await withEntity(store_id, (db) =>
      db.query('SELECT commercials FROM catalogue_adoption WHERE entity_id = $1 AND source_key = $2', [store_id, source_key])
    );
    if (!result.rows[0]) return { error: 'not_adopted', message: 'This store does not sell that catalogue.' };
    const commercials = Object.assign({}, result.rows[0].commercials || {});
    const current = commercials[name] || (entry.formerly || []).map((item) => commercials[item]).find(Boolean) || {};
    const cur$ = (current.price && typeof current.price === 'object' && current.price.currency) || null;
    for (const f of entry.formerly || []) delete commercials[f];
    commercials[name] = Object.assign({}, current, { price: cur$ ? { amount: to, currency: cur$ } : to, follow: true });
    await withEntity(store_id, (db) =>
      db.query('UPDATE catalogue_adoption SET commercials = $3::jsonb, updated_at = now() WHERE entity_id = $1 AND source_key = $2', [
        store_id,
        source_key,
        JSON.stringify(commercials)
      ])
    );
    require('./shopchanged').shopChanged(store_id, 'price taken from the brand');
  }
  if (key) await networkOffers.setIn(store_id, 'network_price_seen', key, choice === 'use' ? 'used' : choice === 'ok' ? 'seen' : 'kept');
  return { ok: true, choice };
}

/**
 * keepFollow(incoming, existing, items) — PURE. A store's save sends its prices back, often without the `follow` flag it never
 * saw. It keeps following a product while the price it saves IS the brand's suggestion; a price of its own ends it.
 */
function keepFollow(incoming, existing, items) {
  const byName = new Map((items || []).map((item) => [item.name, item]));
  const out = Object.assign({}, incoming || {});
  for (const [name, e] of Object.entries(out)) {
    if (!e || typeof e !== 'object') continue;
    const prev = (existing || {})[name];
    const want = e.follow !== undefined ? !!e.follow : !!(prev && prev.follow);
    const source = suggested(byName.get(name));
    const follows = want && source !== null && num(e.price) === source;
    const next = Object.assign({}, e);
    if (follows) next.follow = true;
    else delete next.follow;
    /* ⚠️ the brand's withdrawal is the BRAND's mark: a store's save can neither set nor clear it */
    if (prev && prev.brand_withdrawn) next.brand_withdrawn = true;
    else delete next.brand_withdrawn;
    out[name] = next;
  }
  /* ⚠️ and a withdrawn product is not on the store's screen, so its save leaves it out — the mark (and the price) must survive */
  for (const [name, prev] of Object.entries(existing || {})) {
    if (prev && prev.brand_withdrawn && !(name in out)) out[name] = prev;
  }
  return out;
}

module.exports = {
  storeChanges,
  withdrawnAfter,
  keepFollow,
  FIELDS,
  OWN_SOURCES_SQL,
  BRAND_PRODUCTS_SQL,
  suggested,
  fromProduct,
  diff,
  publish,
  cancel,
  apply,
  applyIfDue,
  brandView,
  storeNotices,
  answer
};
