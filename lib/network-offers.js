// OWNS  the brand's released offers and what a store is handed (forStore → narrowToBrandLines).
// CALLED BY routes/till.js, lib/offers-live, lib/catalogue-view, routes/network-offers.
// FLOW  release → forStore (pinned versions) → narrowToBrandLines → counter · storefront · checkout
// CARD 07-offers-pricing-and-combos/network-offers
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
 *   who is in the network        lib/network-membership (the tree and its edges) — never an adoption list
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
const log = require('./logger');

const POLICIES = ['opt_in', 'opt_out'];

/** one statement: shallow-merge `patch` into policy_flags[section] of one identity */
async function mergeFlag(entity_id, section, patch) {
  await require('./policy').patchKey(null, entity_id, [section], patch, { op: 'merge' }); /* T2-POLICY: the one writer */
}
/** one statement: set policy_flags[section][key] = value (value null removes the key) */
async function setIn(entity_id, section, key, value) {
  if (value === null || value === undefined) {
    await require('./policy').patchKey(null, entity_id, [section, String(key)], null, { op: 'remove' });
    return;
  }
  await require('./policy').patchKey(null, entity_id, [section, String(key)], value);
}
/**
 * one statement: policy_flags.network_offers.released[<id>] = rec — never read-modify-write, so two releases pressed at
 * the same moment both land
 */
async function setReleased(brand_id, id, rec) {
  await require('./policy').patchKey(null, brand_id, ['network_offers', 'released', String(id)], rec);
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
    const r = await query(
      `SELECT title FROM catalogue_source WHERE owner_entity_id = $1 AND COALESCE(title, '') <> ''
                            ORDER BY source_key LIMIT 1`,
      [brand_id]
    );
    if (r.rows[0] && r.rows[0].title) return String(r.rows[0].title);
  } catch (e) {
    log.fellBack('network-offers brandName: the read failed — carried on without it', e);
  }
  return fallback || null;
}
/**
 * THE NEXT OPENING - midnight in the BRAND'S OWN zone (N3, NEUTRAL-CORE: it was India's, fixed). "Not in the middle of the day" is the default a brand
 * gets without asking. `zone` is an IANA name or a country code (books-hooks.dayOf reads either); none stated -> UTC, never India's midnight.
 */
function nextOpening(now, zone) {
  const hooks = require('./books-hooks');
  return hooks.dayBounds(hooks.dayOf(now ? new Date(now) : new Date(), zone), zone).to;
}
/** the brand's next opening, in the brand's zone (its identity: timezone, else country) */
async function nextOpeningFor(brandId, now) {
  const zone = await require('./crm-followups').zoneOfShop({ query }, brandId);
  return nextOpening(now, zone);
}
function whenOf(v, fallback) {
  if (v === 'now') return new Date().toISOString();
  if (v) {
    const date = new Date(v);
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  return fallback;
}

/* ⚠️ WHO IS IN THE NETWORK IS lib/network-membership (the network's own tree and edges). The adoption-based list this file
   kept on 2026-09-17 (policy_flags.network_members, noteMember) was a second answer to that question and is retired. */
const membership = require('./network-membership');

/** tell the brand's own counters and every member store's counters that their copy moved */
async function pushToNetwork(brand_id, what) {
  const { shopChanged } = require('./shopchanged');
  let n = 0;
  try {
    const members = await membership.members(brand_id);
    for (const id of members) n += shopChanged(id, what) || 0;
    shopChanged(brand_id, what);
    return { stores: members.length, clients: n };
  } catch (e) {
    /* ⚠️ the change itself is already saved; only the telling failed — so this answers, it does not throw, and SAYS it */
    log.fellBack('network push: the member list was not read — no store was told of "' + what + '"', e);
    return {
      stores: 0,
      clients: n,
      code: e && e.code === membership.READ_FAILED ? e.code : 'NETWORK_PUSH_FAILED',
      why: 'Saved, but your stores were not told yet. They will see it the next time their counters refresh.'
    };
  }
}

/**
 * ⭐ A STORE BY THE NAME ITS CUSTOMERS KNOW — its trade name (Business identity), else its account name. Read side by side;
 * one shared reader for every list of a brand's stores. → [{ id, name }] sorted by name.
 */
async function memberNames(ids, pre) {
  if (!ids || !ids.length) return [];
  const profile = require('./profile');
  /* EFF-TRIPS: `pre.names` (Map id → identities.display_name, read in the caller's ONE batch) answers a store whose account name is set —
     the same precedence invoiceParty gives (trade_name = display_name first); only a store with no account name costs its vault read */
  const known = (pre && pre.names) || null;
  const rows = await Promise.all(
    ids.map(async (id) => {
      const k = known && known.get(String(id));
      if (k) return { id: String(id), name: String(k) };
      const p = await profile.invoiceParty(id).catch(log.orElse('network-offers memberNames: failed — answered with nothing', null));
      return { id: String(id), name: (p && (p.trade_name || p.name)) || String(id).slice(0, 8) };
    })
  );
  return rows.sort((x, y) => String(x.name).localeCompare(String(y.name)));
}

/** the brand's view: its policy, its live offers with their release, how many stores it would reach */
/** the brand's own offers (live and draft) — $1 = brand identity_id; a tenant read, under the brand's binding */
const OWN_OFFERS_SQL = `SELECT definition_id, name, sub_kind, status, current_version FROM definition
      WHERE entity_id = $1 AND kind = 'offer' AND status IN ('live', 'draft') ORDER BY name`;
/** the brand's own place on the tree — $1 = identity_id: owns (authors a catalogue source) · node · bridge_id · root_bridge_id */
const OWN_PLACE_SQL = `SELECT EXISTS (SELECT 1 FROM catalogue_source WHERE owner_entity_id = $1::uuid) AS owns,
            c.id::text AS node, c.bridge_id, (SELECT r.bridge_id FROM cb_entity r WHERE r.path = subpath(c.path, 0, 1) LIMIT 1) AS root_bridge_id
       FROM (SELECT 1) one LEFT JOIN identities i ON i.identity_id = $1::uuid LEFT JOIN cb_entity c ON c.bridge_id = i.bridge_id
      LIMIT 1`;
/**
 * brandView(brand_id, pre?) — `pre` (EFF-TRIPS, 2026-10-15) carries rows the caller already read in ONE batch: { flags, offers (rows of
 * OWN_OFFERS_SQL), own (rows of OWN_PLACE_SQL), roster (rows of membership.ROSTER_SQL), names (Map id → display_name) }. Without it
 * every part is read here, as before — the shape of the answer is the same either way.
 */
async function brandView(brand_id, pre) {
  pre = pre || {};
  const { flags } = pre.flags ? { flags: pre.flags } : await flagsOf(brand_id);
  const no = flags.network_offers || {};
  const rel = no.released || {};
  const r = pre.offers
    ? { rows: pre.offers }
    : await withEntity(brand_id, (db) => db.query(OWN_OFFERS_SQL, [brand_id])).catch(
        log.orElse('network-offers brandView: the read failed — answered with none', { rows: [] })
      );
  /* ⭐ a shop that authors a catalogue source is a brand with a network to release to; any other shop is not */
  /* …and its own place on the tree, read in the same statement: its node (who acts on its roster rows — G2) and its bridge id and
     its network ROOT's (the network store reads by the root, GET /api/catalogue/network/:bridge_id — G3) */
  const owns = pre.own
    ? { rows: pre.own }
    : await query(OWN_PLACE_SQL, [brand_id]).catch(
        log.orElse('network-offers brandView: own place not read — not shown as a brand, no member actions offered', { rows: [] })
      );
  const own = owns.rows[0] || {};
  /**
   * ⭐ WHO IS IN THE NETWORK — named, with how they came in and where they stand (Athi, 2026-09-17: "we should know they are
   * part of the network … the network has to approve"). built = under the brand on the tree; joined = an approved request
   * or an accepted invitation. `requested` rows are the ones waiting: asked_by says who has to answer.
   */
  const rows = pre.roster || (await membership.roster(brand_id));
  const names = new Map(
    (
      await memberNames(
        rows.map((item) => item.id),
        pre
      )
    ).map((item) => [item.id, item.name])
  );
  /* ⭐ G2: each row says what the BRAND may do on it (approve a store's request, suspend, resume, remove) — the server's rule */
  const members = rows
    .map((item) => Object.assign({}, item, { name: names.get(item.id) || item.id, may: membership.mayOn(item, own.node || null) }))
    .sort((first, second) => String(first.name).localeCompare(String(second.name)));
  return {
    members,
    is_brand: !!own.owns || rows.length > 0,
    bridge_id: own.bridge_id || null,
    root_bridge_id: own.root_bridge_id || null,
    policy: POLICIES.indexOf(no.policy) >= 0 ? no.policy : 'opt_in',
    stores: rows.filter((item) => item.state === 'active').length,
    offers: r.rows.map((item) => {
      const rr = rel[item.definition_id] || null;
      /* ⚠️ edited since it was released — the stores are still on the released version until it goes out again */
      const changed = !!(rr && rr.version && Number(rr.version) !== Number(item.current_version));
      return { id: item.definition_id, name: item.name, kind: item.sub_kind, status: item.status, version: item.current_version, released: rr, changed };
    })
  };
}

/**
 * narrowToBrandLines(offer, lines, nameOf, catName) → boolean — rewrites offer.applies_to so it names ONLY the brand's lines held at this
 * surface (`lines`: [{ name, id, category? }]); false when none qualifies (the offer is then not handed over).
 * WHY: forStore copied the brand's scope, and a scope of "everything" or a category NAME also matches the store's own products.
 *   · item_ids / skus → the store's lines of those brand items (matched by the name the brand gave them, as before)
 *   · category_ids    → the brand's lines in those categories (all of them when a line carries no category)
 *   · no scope        → every brand line;  other keys (min_qty, price bounds) stay beside the narrowed list
 */
function narrowToBrandLines(offer, lines, nameOf, catName) {
  const scope = offer.applies_to && typeof offer.applies_to === 'object' ? offer.applies_to : {};
  const itemIds = Array.isArray(scope.item_ids) ? scope.item_ids.map(String) : [];
  const skus = Array.isArray(scope.skus) ? scope.skus.map(String) : [];
  const cats = (Array.isArray(scope.category_ids) ? scope.category_ids.map(String) : [])
    .map((id) => catName[id])
    .filter(Boolean)
    .concat(scope.category ? [String(scope.category)] : [])
    .map((name) => name.trim().toLowerCase());
  const wanted = new Set(itemIds.map((id) => nameOf[id]).filter(Boolean));
  const scoped = itemIds.length || skus.length || cats.length || (Array.isArray(scope.category_ids) && scope.category_ids.length);
  const picked = lines
    .filter((line) => {
      if (!scoped) return true;
      if (
        wanted.has(
          String(line.name || '')
            .trim()
            .toLowerCase()
        )
      )
        return true;
      if (skus.some((skuCode) => String(line.id).endsWith(':' + skuCode))) return true;
      return cats.length > 0 && (!line.category || cats.includes(String(line.category).trim().toLowerCase()));
    })
    .map((line) => String(line.id));
  if (!picked.length) return false;
  const rest = Object.assign({}, scope);
  ['item_ids', 'skus', 'category', 'category_ids'].forEach((scopeKey) => {
    delete rest[scopeKey];
  });
  offer.applies_to = Object.assign(rest, { item_ids: [...new Set(picked)] });
  return true;
}

/**
 * ⭐⭐⭐ THE OFFERS A STORE IS HANDED FROM ITS NETWORKS — at its counters, on its storefront, and at its checkout.
 *   owners    the brands whose sources this store adopts (the caller already resolved them)
 *   linesByOwner  { brand_id: [{ name, id }] } — the network lines as THIS surface names them, so an offer a brand targeted
 *             at ITS products (by id) reaches the same products here, where they carry a reference id instead
 *   opts.choices      the store's network_choices, when the caller already holds its policy_flags (no second read)
 * ⚠️ POLICY decides the default, the STORE's choice decides the rest:
 *   opt_in   only offers the store said 'in' to
 *   opt_out  every released offer, except those the store said 'out' to
 * ⚠️ ROUND TRIPS (2026-09-17, when the storefront started calling this): each brand costs two — its flags and title in one
 * statement, then its offer versions, item names and category names together — and brands are read side by side.
 * ⚠️ A BRAND'S CUSTOMER-ONLY OFFER NEVER TRAVELS. Its customer_group names the brand's own customers; a store has no such
 * list, so the offer could only ever be shown to nobody or to the wrong people.
 */
async function forStore(store_id, owners, linesByOwner, opts) {
  const o = opts || {};
  const choices = o.choices || (await flagsOf(store_id)).flags.network_choices || {};
  const catalogueView = require('./catalogue-view');
  const all = [...new Set((owners || []).filter(Boolean).map(String))].filter((item) => item !== String(store_id));
  /* ⭐ only the networks this store is IN — adopting a catalogue is not joining (lib/network-membership) */
  const inside = await membership.brandsOf(store_id, all);
  const brands = all.filter((item) => inside.has(item));
  const perBrand = await Promise.all(
    brands.map(async (brand_id) => {
      const fr = await query(
        `SELECT i.display_name, i.policy_flags,
              (SELECT title FROM catalogue_source WHERE owner_entity_id = i.identity_id AND COALESCE(title, '') <> ''
                ORDER BY source_key LIMIT 1) AS title
         FROM identities i WHERE i.identity_id = $1`,
        [brand_id]
      ).catch(log.orElse('network-offers forStore: the read failed — answered with none', { rows: [] }));
      const b = fr.rows[0] || {};
      const flags = b.policy_flags || {};
      const shownAs = b.title || b.display_name || null;
      const no = flags.network_offers || {};
      const policy = POLICIES.indexOf(no.policy) >= 0 ? no.policy : 'opt_in';
      const rel = no.released || {};
      const ids = Object.keys(rel).filter((id) => {
        const c = choices[id];
        return policy === 'opt_in' ? c === 'in' : c !== 'out';
      });
      if (!ids.length) return [];
      /* ⭐ the PINNED version of each released offer (and the one before it, while it still runs) — never simply the current one */
      const vr = await withEntity(brand_id, (db) =>
        db.query(
          `SELECT d.definition_id, d.name, d.sub_kind, v.version, v.rules
         FROM definition d JOIN definition_version v ON v.definition_id = d.definition_id
        WHERE d.entity_id = $1 AND d.kind = 'offer' AND d.status = 'live' AND d.definition_id::text = ANY($2::text[])`,
          [brand_id, ids]
        )
      ).catch(log.orElse('network-offers forStore: the read failed — answered with none', { rows: [] }));
      const byVer = {};
      /* nested by id, then version — not an id@version string, which reads as a version reference and is not one */
      vr.rows.forEach((row) => {
        (byVer[row.definition_id] = byVer[row.definition_id] || {})[row.version] = row;
      });
      const verOf = (id, v) => (byVer[id] || {})[v];
      const offers = [];
      for (const id of ids) {
        const r = rel[id] || {};
        const pinned = r.version
          ? verOf(id, r.version)
          : vr.rows.filter((x) => String(x.definition_id) === id).sort((first, second) => second.version - first.version)[0];
        if (pinned) offers.push(Object.assign(catalogueView.offerFromRow(pinned), { _rel: { at: r.at, until: r.until, version: pinned.version } }));
        if (r.prev && r.prev.version && verOf(id, r.prev.version) && (!r.prev.until || new Date(r.prev.until) > new Date())) {
          offers.push(
            Object.assign(catalogueView.offerFromRow(verOf(id, r.prev.version)), { _rel: { at: r.prev.at, until: r.prev.until, version: r.prev.version } })
          );
        }
      }
      const usable = offers.filter((x) => !x.customer_group);
      if (!usable.length) return [];

      /* brand item ids → the names the brand gave them; brand category ids → the category NAMES its products carry here */
      const scope = (x) => (x.applies_to && typeof x.applies_to === 'object' ? x.applies_to : {});
      const itemIds = [...new Set([].concat(...usable.map((x) => (Array.isArray(scope(x).item_ids) ? scope(x).item_ids.map(String) : []))))];
      const catIds = [...new Set([].concat(...usable.map((x) => (Array.isArray(scope(x).category_ids) ? scope(x).category_ids.map(String) : []))))];
      const [qi, qc] = await Promise.all([
        itemIds.length
          ? withEntity(brand_id, (db) => db.query(require('./catalogue-read').ITEM_NAMES_SQL, [brand_id, itemIds])).catch(
              log.orElse('network-offers forStore: the read failed — answered with none', { rows: [] })
            )
          : { rows: [] },
        catIds.length
          ? withEntity(brand_id, (db) =>
              db.query(
                `SELECT definition_id::text AS id, name FROM definition WHERE entity_id = $1 AND kind = 'category' AND definition_id::text = ANY($2::text[])`,
                [brand_id, catIds]
              )
            ).catch(log.orElse('network-offers forStore: the read failed — answered with none', { rows: [] }))
          : { rows: [] }
      ]);
      const nameOf = {},
        catName = {};
      qi.rows.forEach((x) => {
        nameOf[x.id] = String(x.name || '')
          .trim()
          .toLowerCase();
      });
      qc.rows.forEach((x) => {
        if (x.name) catName[x.id] = String(x.name);
      });
      const here = (linesByOwner && linesByOwner[brand_id]) || [];
      const idsForName = (nm) =>
        here
          .filter(
            (item) =>
              String(item.name || '')
                .trim()
                .toLowerCase() === nm
          )
          .map((item) => item.id);

      const out = [];
      for (const off of usable) {
        const r = off._rel || rel[String(off.id)] || {};
        const copy = JSON.parse(JSON.stringify(off));
        delete copy._rel;
        /* ⭐ the release window, narrowed onto whatever window the brand gave the offer itself */
        /* ⚠️ only ever NARROWED, and a date-only valid_to means the END of that day to the engine — converting it naively
         would have ended a brand's offer a whole day early */
        if (r.at) {
          const date = copy.valid_from ? new Date(copy.valid_from) : null,
            a = new Date(r.at);
          if (!date || isNaN(date.getTime()) || a > date) copy.valid_from = a.toISOString();
        }
        if (r.until) {
          const raw = copy.valid_to ? String(copy.valid_to) : '';
          const date = raw ? (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T23:59:59.999Z') : new Date(raw)) : null;
          const u = new Date(r.until);
          if (!date || isNaN(date.getTime()) || u < date) copy.valid_to = u.toISOString();
        }
        /* ⭐ PRICE-FIX F1: the offer is handed over aimed at THIS BRAND'S lines at the store and nothing else — a whole-catalogue or
         category offer used to reach the store's own rice as well (the engine matches categories by name). */
        if (!narrowToBrandLines(copy, here, nameOf, catName)) continue;
        copy.network = {
          brand_id,
          brand_name: shownAs,
          policy,
          version: r.version || null,
          released_at: (rel[String(off.id)] || {}).released_at || null,
          at: r.at || null,
          until: r.until || null
        };
        out.push(copy);
      }
      return out;
    })
  );
  return [].concat(...perBrand);
}

/**
 * ⭐ THE KEY A NETWORK LINE IS KNOWN BY ON A STOREFRONT — the same rule catalogue-read gives every referenced line
 * (`src:<source>:<sku or name>`), so the storefront's row, its line list and the offers aimed at it all agree.
 * Guarded against catalogue-read.referencedLine in tests/network-storefront.test.cjs.
 */
function lineKey(source_key, item) {
  return 'src:' + source_key + ':' + ((item && (item.sku || item.name)) || '');
}

/**
 * ⭐⭐ THE STOREFRONT'S NETWORK OFFERS. `finishes` is what buildPublicView resolved: [{ source, owner_entity_id, items }].
 * Each adopted item is stamped with its `line_id` (additive — nothing reads it but the offers) and the offers come back
 * aimed at those ids. A store whose adoptions are all its own gets [] without a single read.
 */
async function forFinishes(store_id, finishes, opts) {
  const byOwner = {};
  for (const f of finishes || []) {
    const owner = f && f.owner_entity_id ? String(f.owner_entity_id) : null;
    for (const it of (f && f.items) || []) {
      if (!it || !it.name) continue;
      it.line_id = lineKey(f.source, it);
      if (owner && owner !== String(store_id)) (byOwner[owner] = byOwner[owner] || []).push({ name: it.name, id: it.line_id, category: it.category });
    }
  }
  const owners = Object.keys(byOwner);
  if (!owners.length) return [];
  return forStore(store_id, owners, byOwner, opts || {});
}

/**
 * ⭐ WHETHER A BRAND'S STORES HAVE EACH OFFER — stamped onto definition rows (routes/definitions list).
 *   net = { released: policy_flags.network_offers.released, stores: how many stores are in the network }
 * Each offer row gets network { stores, released, at, changed }; `changed` = edited since the version the stores run.
 * No stores → nothing is stamped. Mutates and returns rows.
 */
function stampReleases(rows, net) {
  const stores = Number(net && net.stores) || 0;
  if (!stores || !Array.isArray(rows)) return rows;
  const rel = net.released && typeof net.released === 'object' ? net.released : {};
  rows.forEach((item) => {
    if (!item || item.kind !== 'offer' || !item.definition_id) return;
    const r = rel[item.definition_id] || null;
    item.network = { stores, released: !!r, at: (r && r.at) || null, changed: !!(r && r.version && Number(r.version) !== Number(item.current_version)) };
  });
  return rows;
}

module.exports = {
  memberNames,
  stampReleases,
  POLICIES,
  OWN_OFFERS_SQL,
  OWN_PLACE_SQL,
  brandName,
  nextOpening,
  nextOpeningFor,
  whenOf,
  mergeFlag,
  setIn,
  setReleased,
  flagsOf,
  pushToNetwork,
  brandView,
  forStore,
  narrowToBrandLines,
  forFinishes,
  lineKey
};
