'use strict';
/*
 * OWNS      the ONE search for a listed business (and, for kind=product, for a product in a listed shop's public catalogue). "Listed" = the shop chose
 *           catalogue_visibility = 'public', the operator's cap (lib/visibility-cap.effective) does not narrow it, and it is not closed: the same three
 *           inputs lib/catalogue-view.catalogueVisibility reads. Here and There run THIS function (NET-39: Athi, 2026-10-25, "switch platform and see if
 *           the product or the supplier exist").
 * CALLED BY routes/entities.js GET /entities/search (via lib/network-search: the name path, and `where=` on another installation), routes/ctp.js the signed
 *           `search` question, routes/relationships.js GET /suppliers/availability (productMatches only).
 * FLOW      text (>= 2 characters) → listed shops by name → [kind=product: each shop's PUBLIC view, items matched by productMatches] → rows in ONE shape
 * CARD      04-network/directory-and-search
 */
/**
 * ⚠️ PUBLIC STOREFRONT FIELDS ONLY. A row is { bridge_id, display_name, user_id, kind, hits }: never a contact, a tax number, an address or a uuid, and a
 * price only as the public view already shows it. A far installation answers with exactly this, so what a stranger can learn is what a visitor could.
 * ⚠️ A name search from ANOTHER installation never reaches an unlisted shop; Here (this installation) finds every known shop by name (NET-47). An exact handle or bridge id still resolves through lib/network-search: finding is not reaching, and a
 * person who knows the address may still use it.
 */
const { query: defaultQuery } = require('../db');
const visibilityCap = require('./visibility-cap');
const log = require('./logger');

const MIN_QUERY = 2;
const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 10;
/* candidate rows read before the cap narrows them, and the shops whose catalogue a product search may open: bounded, so one word never reads a platform */
const CANDIDATES = 100;
const PRODUCT_SHOPS = 25;
const HITS_PER_SHOP = 6;
const KINDS = ['business', 'product'];

const TOO_SHORT = 'Enter at least ' + MIN_QUERY + ' characters to search.';
const SHOP_COLUMNS = `identity_id, display_name, bridge_id, user_id, currency_code, logo_url, business_status, population, catalogue_visibility, plan, params_override`;

/** the cleaned text, or '' — wildcards are stripped, so a person cannot turn a search into "everything" */
const clean = (typed) => String(typed == null ? '' : typed).replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const clampLimit = (asked) => Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(asked)) || DEFAULT_LIMIT));

/** an item's own fields: the view wraps them in item_data, a plain item is its own fields */
const itemFields = (item) => (item && item.item_data) || item || {};

/** ONE product matcher: a name or code contains the text. The availability route and this search both read it. */
function productMatches(item, text) {
  const fields = itemFields(item);
  return ((fields.name || fields.product || '') + ' ' + (fields.code || fields.hsn || fields.sku || '')).toLowerCase().indexOf(text) >= 0;
}

/** may this shop be shown to ANOTHER installation? Only if it opted in to selling outside (trade_mode = export); fails closed (lib/profile.isExporter) */
const openAbroad = (shop) => require('./profile').isExporter(shop.identity_id);

/** is this shop listed? the chosen tier narrowed by its cap; a closed shop shows nothing (catalogue-view: closed overrides) */
function isListed(row) {
  if (row.business_status === 'closed') return false;
  const ceiling = visibilityCap.capOf({ plan: row.plan, paramsOverride: row.params_override || {} });
  return visibilityCap.effective(row.catalogue_visibility, ceiling) === visibilityCap.PUBLIC;
}

/** the public row: nothing but what a storefront card shows */
const publicRow = (row, kind, hits) => ({ bridge_id: row.bridge_id, display_name: row.display_name, user_id: row.user_id || null, kind, hits: hits || [] });

/** the name read both askers share: active, unsealed, not a minted party, not internal/private, name or handle contains the text, exact handle first; `listing` narrows it */
async function shopsByName(text, runQuery, listing) {
  const read = await runQuery(
    `SELECT ${SHOP_COLUMNS}
       FROM identities
      WHERE identity_type = 'entity' AND status = 'active' AND COALESCE(sealed, false) = false
        ${listing}
        AND COALESCE(user_id, '') NOT LIKE '~%'
        AND COALESCE(entity_visibility, 'public') NOT IN ('internal', 'private')
        AND (LOWER(display_name) LIKE $1 OR LOWER(user_id) LIKE $1)
      ORDER BY (LOWER(user_id) = $2) DESC, display_name
      LIMIT ${CANDIDATES}`,
    ['%' + text + '%', text]
  );
  return read.rows;
}

/** THERE (a stranger asks): only shops that chose to be listed, narrowed by the operator's cap */
async function listedByName(text, runQuery) {
  return (await shopsByName(text, runQuery, "AND catalogue_visibility = 'public'")).filter(isListed);
}

/** HERE (a member of this installation asks): every known shop by name, as main's GET /entities/search; catalogue_visibility is about the catalogue, not about being found (Athi, 2026-10-25) */
const knownByName = (text, runQuery) => shopsByName(text, runQuery, '');

/** one matching item as the public view shows it */
const hitOf = (fields, currency) => ({ name: fields.name || fields.product || 'item', unit: fields.unit || 'unit', price: fields.price == null ? null : fields.price, currency });

/** keep the shops that may be shown abroad, in order, stopping at `wanted` (one read per shop, so never all candidates) */
async function onlyAbroad(shops, wanted, mayShow) {
  const kept = [];
  for (const shop of shops) {
    if (kept.length >= wanted) break;
    if (await mayShow(shop)) kept.push(shop);
  }
  return kept;
}

/** a listed shop's matching items from its PUBLIC view; a shop with no showing catalogue has none (absent is not "no": it is simply not listed here) */
async function hitsIn(shop, text, viewFor) {
  try {
    const view = await viewFor(shop);
    if (!view || !view.available) return [];
    const currency = (view.shop && view.shop.currency_code) || shop.currency_code || null;
    return (view.items || [])
      .filter((item) => productMatches(item, text))
      .slice(0, HITS_PER_SHOP)
      .map((item) => hitOf(itemFields(item), currency));
  } catch (failure) {
    log.fellBack('business-search: one shop’s catalogue could not be read — it is left out of the answer', failure);
    return [];
  }
}

/** the default way to read a shop's public view: the storefront's own (routes/catalogue publicViewFor), required late so a name search never loads it */
const storefrontView = (shop) => require('../routes/catalogue').publicViewFor(shop, {});

/** kind=product: shops are chosen by what they SELL, so the candidates are listed shops with a default catalogue, not those named like the word */
async function productResults(text, limit, deps, runQuery) {
  const read = await runQuery(
    `SELECT i.identity_id, i.display_name, i.bridge_id, i.user_id, i.currency_code, i.logo_url, i.business_status, i.population,
            i.catalogue_visibility, i.plan, i.params_override
       FROM identities i
      WHERE i.identity_type = 'entity' AND i.status = 'active' AND COALESCE(i.sealed, false) = false
        AND i.catalogue_visibility = 'public' AND COALESCE(i.user_id, '') NOT LIKE '~%'
        AND COALESCE(i.entity_visibility, 'public') NOT IN ('internal', 'private')
        AND EXISTS (SELECT 1 FROM entity_schemas es WHERE es.entity_id = i.identity_id AND es.status = 'active' AND es.is_default = true)
      ORDER BY i.display_name LIMIT ${CANDIDATES}`,
    []
  );
  const listed = read.rows.filter(isListed);
  const shops = deps.abroad ? await onlyAbroad(listed, PRODUCT_SHOPS, deps.openAbroad || openAbroad) : listed.slice(0, PRODUCT_SHOPS);
  const viewFor = deps.viewFor || storefrontView;
  const results = [];
  for (const shop of shops) {
    if (results.length >= limit) break;
    const hits = await hitsIn(shop, text, viewFor);
    if (hits.length) results.push(publicRow(shop, 'product', hits));
  }
  return { ok: true, results, searched: shops.length };
}

/**
 * find({ q, kind, limit }, wired?) → { ok:true, results, searched } | { ok:false, code, why }
 * @param request.kind  'business' (default) | 'product'
 * @param wired         { query, viewFor, openAbroad } for tests; `abroad: true` = the asker is ANOTHER installation, so only shops that opted in to sell outside (isExporter) are answered
 */
async function find(request, wired) {
  const asked = request || {};
  const deps = wired || {};
  const text = clean(asked.q);
  if (text.length < MIN_QUERY) return { ok: false, code: 'SEARCH_TOO_SHORT', why: TOO_SHORT };
  const kind = KINDS.includes(asked.kind) ? asked.kind : 'business';
  const limit = clampLimit(asked.limit);
  const runQuery = deps.query || defaultQuery;
  if (kind === 'product') return productResults(text, limit, deps, runQuery);
  const shops = deps.abroad ? await onlyAbroad(await listedByName(text, runQuery), limit, deps.openAbroad || openAbroad) : await knownByName(text, runQuery);
  return { ok: true, results: shops.slice(0, limit).map((shop) => publicRow(shop, 'business')), searched: shops.length };
}

module.exports = { find, productMatches, isListed, clean, MIN_QUERY, MAX_LIMIT, KINDS };
