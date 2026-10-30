/**
 * routes/till.js — WHAT A COUNTER NEEDS, IN ONE CALL (TILL-SPEC-2026-09-07).
 *
 * OWNS      the counter's 41 routes under /api/till: the whole-shop snapshot, the small decisions made standing up (stock, price, flags, offers, rewards),
 *           pairing a TV, closing a counter, the shop's header, the first catalogue, and the owner's three-way match.
 * CALLED BY server.js (mounted at /api/till), the counter (till.html) by its key, the Operations page.
 * FLOW      request → auth (+ requireScope('till')) → checked(route) schema check (lib/till-contract) → handler → res.json(...)
 *           a refusal  → problem(req, res, { status, ...badRequest(...) }) with the old keys frozen (lib/till-contract) · a thrown error → problem(req, res, failed(e, req))
 * CARD      counter/till-routes
 *
 * Athi, 2026-09-07: *"someone runs a store without a computer… why can't we develop a desktop application, you just download it and we
 * still run everything in the cloud, but the minimum required sits on the desktop so the billing works faster."*
 *
 * The till is the connector kit with a screen. It bills against a LOCAL copy of the shop — items, prices, offers, tax slabs, customers
 * — and sends each bill afterwards. This route is where that copy comes from, and it is deliberately ONE request: the counter's whole
 * world in a single round trip, because the old shape (a call per fact) is what made screens slow in the first place.
 *
 *   GET /api/till/snapshot  → { at, version, shop, items, slabs, categories (tax), category_master, face, offers, customers, policy }
 *
 * ⚠️ IT IS A COPY, AND IT SAYS WHEN IT WAS TAKEN. Every bill records `catalogue_version`, so "what price did we sell at" has an answer
 * later instead of an argument. A shop that changes a price while the till is offline keeps selling at the snapshot's price until it
 * refreshes — decided with Athi, who is right that a price change is rare and a notice is enough.
 * ⚠️ NO SECRETS TRAVEL. No keys, no vault, no other entity's data: only what this shop already shows its own counter.
 *
 * ⚠️ HOW THIS FILE IS CUT (maintainability pass, 2026-10-23): each route is registered first, with the refusals it can answer written out in its own
 * handler (tools/api-register.cjs reads a handler's statuses and codes from the handler's own text); the work behind it follows as named functions.
 */
'use strict';
const express = require('express');
const pageLimit = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200; /* one page of this file's lists */
const { safeErr } = require('../lib/respond');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer
const { said, notFound, failed, relayed, refusalOf, categoriesFailed, checked, pathsOf, refuseBad, refuseNoCounter } = require('../lib/till-contract'); // the contract (S9), the schema check of each route and the words of a refusal
const log = require('../lib/logger');
const {
  round: roundMoney
} = require('../lib/money'); /* ⭐ money.round — the one rounder (SPEC-money-one-reader.md): half away from zero, on the decimal value */
const { ownerOnly } = require('../lib/owner');
const { setsRate, RATE_ASK_OWNER, RATE_OWNER_ONLY } = require('../lib/rate-door'); // CAT-210: who may set a rate, once for every door
const taxSlab = require('../lib/tax-slab'); /* ⭐ F5 A1: categoryIdsOf for the counter's item, setOn for the rate door — the engine's one writer */
const taxPacks = require('../lib/tax-packs'); /* the shop's tax pack (collect_without_tax_id) for tax-shelf.chargesTax */
const router = express.Router();
const auth = require('../middleware/auth');
const { query, withEntity } = require('../db');
const catwrite = require('../lib/catalogue-write'); /* ⭐ CAT-W1: the one product writer (patchItems) */
const catalogueView = require('../lib/catalogue-view');
const taxShelf = require('../lib/tax-shelf');
/** what tax-shelf.readShelf needs from this router — the db, the region layer, the catalogue face — in ONE place for its two callers (the snapshot, the rate door) */
const shelfDeps = () => ({ withEntity, query, regionLayer: regional.regionLayer, getFace: (shopId) => catalogueView.getFace({ entity_id: shopId, withEntity }) });
/** a stored rate as a number, or null for a blank or junk value (a rate is a percentage, never money) */
const rateOf = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
/**
 * ⭐⭐ THE ITEM'S TAX FACTS, AS THE ENGINE'S ONE INPUT READS THEM (F5 A1, critic 2 and 12; tax-slab inputOf from engines 1.72.0). A rate typed on the
 * item, or set at the counter's door (POST /rate), reached the catalogue view and never the counter's projection, so the counter billed 0%.
 * gst_rate · tax_slab_name · cess_rate are the slab's travelling copy; `categories` is EVERY id the product cites (the category rung is keyed by id;
 * the resolved NAME still travels as `category` for old tills); hsn also reads `sac` (a service's code) and NEVER `code`: a shop code "D01" would
 * land on a tax invoice. A blank is null — "nobody said", never 0.
 */
function taxFactsOf(item_data) {
  /* engines 1.72.0: the ONE builder (tax_slab · tax_slab_name · gst_rate · cess_rate · categories[] · hsn || sac), blanks left out — the wire says null for them */
  const facts = taxSlab.inputOf(item_data);
  return {
    hsn: facts.hsn !== undefined ? facts.hsn : item_data.hs_code || item_data.hsn_code || null /* the two legacy keys old rows still carry */,
    tax_slab: facts.tax_slab || null,
    gst_rate: rateOf(facts.gst_rate),
    tax_slab_name: facts.tax_slab_name || null,
    cess_rate: rateOf(facts.cess_rate),
    categories: facts.categories || []
  };
}
/**
 * ⭐⭐ THE CATEGORY MASTER, READ WITHOUT THE TAX GATE ([TILL-114]). taxShelf.readShelf() also returns
 * categories — and answers NULL for a seller with no GSTIN, so an unregistered shop could not get its own
 * category names for the same reason its tax is zero. A category is not a tax fact.
 */
const categories = require('../lib/categories');
const regional = require('../lib/regional');
const countrySetup = require('../lib/country-setup'); /* W1-TILL: shopMoney + MONEY_UNSTATED — the one reader of a shop's money */
const policy = require('../lib/policy');
const itemstatus = require('../lib/itemstatus'); /* "may somebody take one NOW?" — one definition, the storefront's */
const lotfields = require('../lib/lotfields');
/* ⭐ BOOKS v2: is this shop's ledger on (the hooks' one cached read), and the ledger's one reader of a `date` column */
const booksHooks = require('../lib/books-hooks');
const booksYmd = require('../lib/books-engines').ymd;
const variantEngine = require('../lib/variant.browser.js'); /* the same shape-guard the Modifiers tab authors through */
const keys = require('../lib/api-keys');
const { isScreenKey } = require('../lib/holder'); /* a TV / customer display — SNAP-SCREEN: the one question, asked once */
const { shopChanged } = require('../lib/shopchanged');
const rateLimit = require('express-rate-limit');
/**
 * ⚠️⚠️ STARTING A SHOP IS A ONCE-PER-SHOP ACT ([TILL-112]). The route already refuses a shop that has
 * products, so the honest limit is low: a handful of attempts covers choosing the wrong trade and saying so.
 * ⭐ Keyed by the API key the way every other limit here is, so one counter cannot spend another's allowance.
 */
const catalogueMintLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.TILL_CATALOGUE_MAX || '20'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: require('../lib/limiter-key').callerKey /* SEC-79 */,
  message: { error: 'Too many requests', message: 'That is a lot of attempts in a short time. Nothing has been changed — try again in a few minutes.' }
}); /* ⭐ a price changed at the counter must reach the TV, not wait out a timer */ /* ⭐ pairing mints a SCREEN key through the same mint the keys screen uses */
const rewards = require('../lib/rewards'); /* ⭐ points a customer accumulates — the mechanism; the shop declares the rule */
const counterBill = require('../lib/counter-bill'); /* ⭐ the shop's own bill by its number — what was paid (GET /bills) and what it earned (POST /reward) */
const speech = require('../lib/speech'); /* ⭐ what somebody SAID, as text — a seam, with a provider behind it */ /* ⭐ what THIS vertical must capture about a consignment */
const crypto = require('crypto');

/** the figure out of a price, whether the catalogue stored a number or { amount, currency } (lib/pricing-engine reads it the same way) */
/**
 * ⭐ THE ONE PRICE READER (SPEC-money-one-reader.md step 3). This file had its own, which read a blank price ('') as 0,
 * so a product imported with an empty price cell sold for ₹0.00 at the counter while the storefront refused it as
 * unpriced (external review §21). money.priceOf reads every stored shape and answers null for "no price" — never 0.
 */
const { priceOf: amountOf } = require('../lib/money');
/** a short, stable stamp for "which copy of the catalogue was this bill priced from" */
function versionOf(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

/** the first of these that is set, else null — what `a || b || null` says, once, for the long projections below */
const firstSet = (...values) => values.find(Boolean) || null;

/** ⚠️ the most changed rows one delta answer carries — past it the delta is sent in parts (`more`), never cut */
const DELTA_CAP = Math.max(1, parseInt(process.env.TILL_DELTA_CAP || '20000', 10) || 20000);
/** rows were read oldest-first, capacity + 1 of them: keep the capacity, and if there was more, the cursor is the last row kept */
function deltaPage(rows, capacity) {
  if (!Array.isArray(rows) || rows.length <= capacity) return { rows: rows || [], more: false, cursor: null };
  const kept = rows.slice(0, capacity);
  return { rows: kept, more: true, cursor: new Date(kept[kept.length - 1].updated_at).toISOString() };
}

/**
 * ⭐⭐⭐ screenView(body) — WHAT A SHOP SCREEN IS SENT (SNAP-SCREEN, 2026-10-14; counter reconciliation 14 Oct, case CFD-03).
 *
 * A TV hangs where the queue stands, often on a stick nobody locks. It was sent the counter's whole snapshot — every customer
 * with phone and balance, every supplier, the staff, the reward programme, the policy, supplier aliases on each product.
 * ⚠️ AN ALLOW-LIST, NOT A DENY-LIST: a field added to the snapshot tomorrow does NOT reach a screen until it is named here.
 * What is named is exactly what promo.html paints: the shop's name, phone, address, money and words; each product's name,
 * code, unit, price, MRP, category, picture and "show on screen" pick; the live offers. The bill itself never comes from
 * here — the counter hands it to the screen on the same machine.
 * ⚠️ ONLY WHAT IS ON THE SHELF. `avail` is a stock QUANTITY and does not travel; instead a screen is sent only items whose
 * status is 'available' (lib/itemstatus) — a screen never sells, so an unavailable product has nothing to say on it. On a
 * delta, an item that stopped being available travels as a removal, so it leaves the wall.
 */
const SCREEN_SHOP = ['name', 'address', 'phone', 'currency', 'country', 'tax_id_word', 'money_why', 'fy_start_month'];
const SCREEN_ITEM = ['item_id', 'name', 'code', 'unit', 'price', 'mrp', 'category', 'image', 'screen', 'status'];
const pickKeys = (source, list) => {
  const out = {};
  list.forEach((item) => {
    if (source && source[item] !== undefined) out[item] = source[item];
  });
  return out;
};
/** the snapshot body cut down to what a shop screen (TV) may be sent — only the allow-listed shop and item fields, only what is on the shelf */
function screenView(body) {
  const all = Array.isArray(body.items) ? body.items : [];
  const shown = all.filter((item) => item && item.status === 'available');
  const gone = body.delta ? all.filter((item) => item && item.status !== 'available').map((item) => item.item_id) : [];
  return {
    at: body.at,
    more: body.more,
    entity_id: body.entity_id,
    shop: pickKeys(body.shop || {}, SCREEN_SHOP),
    items: shown.map((item) => pickKeys(item, SCREEN_ITEM)),
    removed: (Array.isArray(body.removed) ? body.removed : []).concat(gone),
    delta: body.delta,
    since: body.since,
    offers: Array.isArray(body.offers) ? body.offers : []
  };
}
router.screenView = screenView; /* tests/screen-snapshot.test.cjs asserts the allow-list directly too */

/**
 * M127: DOES THIS SHOP HOLD STOCK? The shop's own DATA decides, never its trade (Athi: "the data decides, not the trade").
 * Two signals, both already in the platform: the shop has RECEIVED stock (a stock_movement of reason opening or purchase - what a
 * Receive / GRN posts, lib/stock-from-chit), or a product of its own says it is kept per batch (item_data.batch_tracked true - the
 * product's word that lotfields.tracksBatch honours first). Neither => false. One read; a table not migrated yet, or a read that
 * fails, answers null (unknown) and the counter then shows Receive and Despatch as usual - it never hides on a guess.
 */
async function holdsStockOf(entity_id) {
  try {
    if (!(await require('../lib/schema').hasTable('stock_movement'))) return null;
    const found = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT (EXISTS (SELECT 1 FROM stock_movement WHERE entity_id = $1 AND reason IN ('opening','purchase'))
            OR EXISTS (SELECT 1 FROM catalogue_items WHERE entity_id = $1 AND is_active = true AND item_data->>'batch_tracked' = 'true')) AS held`,
        [entity_id]
      )
    );
    return !!(found.rows[0] && found.rows[0].held);
  } catch (e) {
    log.fellBack('till holdsStockOf: the read failed — answered with nothing', e);
    return null;
  }
}

/**
 * GET /snapshot — everything a counter needs to bill offline, in one call (the story is at the top of this file). The handler only hands the
 * finished body to a counter, or its allow-listed cut to a TV; takeSnapshot below reads the shop in the order its comments explain.
 */
router.get('/snapshot', auth, ...checked('GET /snapshot'), async (req, res) => {
  try {
    const taken = await takeSnapshot(req);
    const answer = taken.screen ? screenView(taken.body) : taken.body;
    res.json({ at: answer.at, more: answer.more, limit: answer.limit, entity_id: answer.entity_id, till: answer.till, shop: answer.shop, items: answer.items, removed: answer.removed, delta: answer.delta, since: answer.since, offers: answer.offers, staff: answer.staff, category_master: answer.category_master, total: answer.total, network: answer.network, slabs: answer.slabs, categories: answer.categories, face: answer.face, customers: answer.customers, suppliers: answer.suppliers, reward: answer.reward, policy: answer.policy, lot_fields: answer.lot_fields, books: answer.books, version: answer.version }); /* S34: the keys named; a TV's screenView leaves most undefined and JSON leaves those out, so each answer is byte for byte what it was */
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * takeSnapshot(req) → { screen, body }: the sections of the snapshot read one after another (one client runs one statement at a time), in the
 * order the counter has always been answered in, then the body put together. Each section stores what it read on `snap`; the sections are the
 * functions below, in reading order.
 */
async function takeSnapshot(req) {
  const snap = { asked: snapshotAsk(req) };
  await readShopSection(snap);
  await readCatalogueSection(snap);
  await readPeopleSection(snap);
  await readParticularsSection(snap);
  await readItemsSection(snap);
  const body = snapshotBody(snap);
  /**
   * ⭐⭐ `books: true` — TOP LEVEL, PRESENT ONLY WHEN THE SHOP'S LEDGER IS ON (critic M5). The counter requires exactly
   * S.books === true before it offers "On credit" or "Received"; absent means off, not migrated, or not readable — and in
   * all three nothing would be posted, so nothing is offered. (A snapshot replaces the counter's copy whole, so switching
   * the ledger off takes the key away on the next read.)
   */
  if (snap.booksOn) body.books = true;
  body.version = versionOf({ i: snap.paged.items, o: snap.offers, s: body.slabs, sh: body.shop, st: snap.staff });
  return { screen: snap.asked.screen, body };
}

/** section 1 — the shop as its own books know it (the slip's header, and what decides tax invoice vs cash memo), its policy flags, the counter series this key holds, and the shared reads */
async function readShopSection(snap) {
  const { entity_id, since } = snap.asked;
  snap.row = (await query(`SELECT display_name, gstn, country, policy_flags, user_id FROM identities WHERE identity_id = $1`, [entity_id])).rows[0] || {};
  snap.flags = await policy.get(entity_id).catch(log.orElse('till GET /snapshot: failed — answered with an empty set', {}));
  snap.till = await claimedSeries(snap.asked);
  snap.ownRead = await ownReader(entity_id, since);
}

/** section 2 — the sectors, the tax shelf with the items and the live count, the declared columns, the live offers and the reward programme */
async function readCatalogueSection(snap) {
  const { entity_id } = snap.asked;
  Object.assign(snap, await readSectors(snap.ownRead, entity_id));
  [snap.shelf, snap.itemRows, snap.liveCount] = await readShelf(entity_id, snap.ownRead);
  snap.declared = await readDeclared(entity_id);
  snap.offers = await readLiveOffers(entity_id);
  snap.reward = await readReward(entity_id);
}

/** section 3 — the customers (and whether the ledger is on), the suppliers and the people who may stand at a counter */
async function readPeopleSection(snap) {
  const { entity_id } = snap.asked;
  Object.assign(snap, await readCustomers(entity_id, snap.ownRead));
  snap.suppliers = await readSuppliers(entity_id, snap.ownRead, snap.row.country);
  snap.staff = await readStaff(entity_id);
}

/** section 4 — the shop's particulars (name, address, country, money) and the category master */
async function readParticularsSection(snap) {
  const { entity_id } = snap.asked;
  snap.particulars = await readParticulars(entity_id, snap.row, snap.profile);
  Object.assign(snap, await readCategoryMaster(entity_id));
}

/** section 5 — the items the counter can sell, the network's lines and offers, and whether the shop holds stock */
async function readItemsSection(snap) {
  const { entity_id, since } = snap.asked;
  const project = (item_id, data) => tillItem(item_id, data, snap.declared, snap.catNames);
  snap.paged = itemsOnCounter(snap.itemRows, since, project);
  snap.network = { unpriced: 0 };
  await addNetworkLines(entity_id, snap.ownRead, snap.paged.items, snap.network, project);
  snap.offers = await withNetworkOffers(entity_id, snap.paged.items, snap.offers);
  snap.holdsStock = await holdsStockOf(entity_id);
}

/**
 * what the snapshot was asked: the moment it started reading, whose shop, whether a TV asks, and the delta cursor (?since=).
 *
 * ⚠️⚠️ [REV-16] "the delta cursor is stamped after the read, so edits vanish permanently." Taken HERE, before
 * a single query below has run, not at body-construction time (was: right before `res.json`, after the item
 * SELECT, the tax shelf, the offers and the network lookups had all already completed). Item SELECT runs at
 * 10:00:00.300, back office saves a price at 10:00:00.700, the OLD stamp landed at 10:00:01.100 — so that
 * edit's updated_at (10:00:00.700) was already ≤ the cursor the till was handed, and the NEXT `since=` ask
 * for `updated_at > 10:00:01.100` would never see it. Stamping first makes the cursor slightly
 * conservative (it may re-send a row that settled a moment after this line) rather than silently unsafe —
 * a repeat is a no-op merge; a permanent miss is a stale price nobody notices.
 */
function snapshotAsk(req) {
  const readAt = new Date().toISOString();
  const entity_id = auth.entityOf(req);
  /* ⭐ SNAP-SCREEN: is a TV asking? Decided here, once, from the key — the answer is shaped by screenView at the end */
  const screen = isScreenKey(req.till && req.till.key);
  /* the moment the till last read the shop — anything touched after it is what it does not have */
  const sinceRaw = typeof req.query.since === 'string' ? req.query.since.trim() : '';
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  return { req, readAt, entity_id, screen, since };
}

/**
 * ⭐⭐⭐ WHICH COUNTER IS THIS — decided by the SERVER, from the thing that is already unique.
 *
 * Athi, 2026-09-11: *"we cannot have same receipt number if the same login opens from couple of places?"*
 *
 * ⚠⚠ THE BILL SERIES IS PREFIXED BY A TEXT BOX. `cb_till_id` lives in the counter's localStorage, defaults
 * to `C1`, and is only ever set by hand in Settings — pairing never assigns one. So two counters nobody
 * renamed both emit C1/26-27/0041, and under GST that is two tax invoices carrying one number.
 *
 * ⭐ THE KEY WAS ALWAYS THE UNIQUE THING. Every counter pairs with its own till key; the series was simply
 * not using it. The ordinal of this key among the shop's till keys, oldest first, gives C1, C2, C3 — short,
 * sayable, and decided by something nobody types.
 *
 * ⚠ A SUGGESTION, NOT AN ORDER, and that is the continuity half. A counter that has ALREADY issued numbers
 * keeps its own prefix whatever this says — a series that changes shape mid-year destroys the one property
 * numbering exists to prove. The counter adopts this only when it has issued nothing; otherwise it warns.
 *
 * ⚠ NO MIGRATION: the key list already lives in identities.policy_flags.api_keys (routes/keys.js).
 *
 * ⭐⭐⭐ 2026-09-17 — THE PREFIX IS NOW CLAIMED AND KEPT, NOT SUGGESTED BY POSITION. The ordinal above was
 * right in spirit and wrong in two ways that mattered: it SHIFTED whenever an older key was revoked, and the
 * counter never read it at all — which is how Athi's two PCs both stayed C1 and one PC's sales were absorbed
 * as the other's. routes/keys.js claimTill() decides, records the decision on the key, and says when a
 * counter must stop. The counter tells us what it is using and whether it has issued anything under it.
 *
 * Here: claimedSeries(ask) → the `till` block of the answer, or null. ⚠ Best effort — a counter must open whatever this says.
 */
async function claimedSeries(asked) {
  const { req, entity_id, screen } = asked;
  try {
    if (!holdsACounter(req, screen)) return null;
    /* ⭐ M11: a counter PC (key) and a person's phone (dev) claim through ONE allocator — keys.claimSeries */
    const claim = await keys.claimSeries(entity_id, req.till, {
      id: req.query.till,
      issued: req.query.issued === '1' || req.query.issued === 'true',
      /* ⭐ the engine releases this counter runs — kept on its key (keys.cleanEngines) */
      engines: req.query.eng
    });
    if (!claim) return null;
    const nestedAll = await keys.listOf(entity_id);
    const tills = nestedAll.filter((item) => item && Array.isArray(item.scopes) && item.scopes.indexOf('till') >= 0);
    return seriesNote(claim, tills.length);
  } catch (e) {
    log.fellBack('till GET /snapshot: failed — carried on without it', e); /* ⚠ best effort — a counter must open whatever this says */
    return null;
  }
}

/** ⚠️ SNAP-SCREEN: a screen never bills, so it never claims a bill series — it used to lock the shop row and stamp a prefix on itself */
function holdsACounter(req, screen) {
  return !screen && req.till && ((req.till.key && req.till.key.jti) || req.till.device_id);
}

/** the `till` block of the snapshot: the prefix this counter bills under and, in words, why a number changed shape */
function seriesNote(claim, counterCount) {
  const note = {
    suggested_id: claim.id,
    assigned_id: claim.id,
    clash: claim.clash || null,
    counters: counterCount,
    /* ⭐ said out loud, so the shop learns WHY its numbers changed shape */
    moved_from: claim.moved_from || null,
    held_by: claim.held_by || null,
    /* ⭐ a named counter, and where its series stopped — see claimTill */
    counter: claim.counter || null,
    counter_name: claim.name || null,
    resume_next: claim.resume_next || null,
    resume_period: claim.resume_period || null
  };
  /* M11: a phone is told once, in words, which label it bills under ("This phone bills as C4.") */
  if (claim.said) note.said = claim.said;
  return note;
}

/**
 * ⭐⭐ THE ROUTE'S OWN FIVE READS, IN ONE TRANSACTION (2026-09-29, M36). entity_profile, the items, the live count, the
 * customers and the adoptions were five withEntity transactions — BEGIN · set_config · the read · COMMIT each, twenty
 * trips, two of them racing the tax shelf for pool connections inside a Promise.all. They are independent reads of one
 * shop, so they share one: 3 + 5 = eight trips.
 * ⚠️ ONE FAILURE MUST NOT EMPTY THE OTHERS. Postgres aborts a whole transaction on any error, so if one statement fails
 * the shared read is dropped and each section is read on its own, exactly as before — with its own catch and its own
 * warning below. The shared read is a fast path, never a second behaviour; its failure is said out loud.
 * ⚠️ NOT readBatch: that checks each statement with the RLS guard, and these are all tenant tables.
 * Measured: tests/round-trips-till.test.cjs.
 *
 * ownReader(entity_id, since) → ownRead(name): the section's rows, from the shared read when it worked, else on its own.
 */
async function ownReader(entity_id, since) {
  const reads = ownReads(entity_id, since);
  let shared = null;
  try {
    shared = await withEntity(entity_id, async (db) => {
      const out = {};
      for (const name of Object.keys(reads)) out[name] = await reads[name](db); /* ⚠️ in turn — one client runs one statement at a time */
      return out;
    });
  } catch (e) {
    shared = null;
    log.warn('till.snapshot.shared-read', { entity_id, why: String(e && e.message) });
  }
  return (name) => (shared ? shared[name] : withEntity(entity_id, reads[name]));
}

/**
 * the snapshot's own reads, one entry per section, each taking the transaction's handle.
 * ⚠️ LAST in this list on purpose: the five reads above `books` stay back to back (tests/round-trips-till.test.cjs).
 */
function ownReads(entity_id, since) {
  return {
    profile: (db) => db.query(`SELECT trade_mode, markets, sectors, adopted FROM entity_profile WHERE entity_id = $1`, [entity_id]),
    items: (db) => itemsRead(db, entity_id, since),
    count: (db) => liveCountRead(db, entity_id),
    customers: (db) => customersRead(db, entity_id),
    adoption: (db) => db.query('SELECT source_key, commercials FROM catalogue_adoption WHERE entity_id = $1 AND visible = true', [entity_id]),
    suppliers: (db) => suppliersRead(db, entity_id),
    /**
     * ⭐⭐ IS THIS SHOP'S LEDGER ON (critic M5, 2026-09-30). The counter offered "On credit" and "Received" to any shop with a
     * known customer; with the ledger off the server posts nothing, so the debt existed only as words on a chit.
     * lib/books-hooks isOn — the SAME cached answer the posting hook uses, read on this transaction's own handle inside a
     * savepoint (so "table not there yet" cannot abort the shared read). It never throws: unreadable = not on, and logged.
     */
    books: (db) => booksHooks.isOn(entity_id, db)
  };
}

/**
 * ⭐ A DELTA WHEN THE TILL SAYS WHEN IT LAST LOOKED (2026-09-08). A shop with 10,000 items should not send them all every fifteen
 * minutes to say nothing changed. With ?since= we return only rows touched after that moment — and, separately, the ids of rows
 * that went inactive, because a product taken off the shelf must LEAVE the counter, and an absence is not something a delta of
 * present rows can express.
 * ⚠️ The stamp we hand back is the SERVER's clock (body.at), never the till's — two clocks a few seconds apart would silently
 * skip a row that changed in between.
 *
 * ⚠️⚠️ OLDEST FIRST, AND ONE MORE THAN THE CAP (external review 2026-09-25, fixed 2026-09-28). It was newest-first
 * LIMIT 20000 with the cursor at readAt: past the cap the OLDEST changes were cut and the cursor jumped over them,
 * so a counter never received them. Now a cut delta hands back the LAST row sent as its cursor (see DELTA_CAP).
 * ⚠️⚠️ THE FULL READ PAGES THE SAME WAY (SEC-SMALL item 5, 2026-10-14). It was `ORDER BY updated_at DESC LIMIT 20000`, cut in
 * silence: a shop past the cap never received its oldest items, and its total check then pulled the whole shop again on
 * every refresh — for ever. Now oldest-first, one past the cap, through the same deltaPage: a cut full read says `more`
 * and hands back its last row as `at`, and the counter's next ?since= carries on from there (updated_at is NOT NULL).
 */
function itemsRead(db, entity_id, since) {
  if (since) {
    return db.query(
      'SELECT item_id, item_data, is_active, updated_at FROM catalogue_items WHERE entity_id = $1 AND updated_at > $2 ORDER BY updated_at ASC LIMIT $3',
      [entity_id, since, DELTA_CAP + 1]
    );
  }
  return db.query(
    'SELECT item_id, item_data, is_active, updated_at FROM catalogue_items WHERE entity_id = $1 AND is_active = true ORDER BY updated_at ASC LIMIT $2',
    [entity_id, DELTA_CAP + 1]
  );
}

/**
 * ⚠️⚠️ A DELETE IS INVISIBLE TO A DELTA, AND THAT IS WHY THE COUNTER KEPT SHOWING STOCK THAT NO LONGER EXISTS.
 *
 * Athi emptied this shop's catalogue in SQL and loaded a new one; his counter went on listing the old rows. The delta asks
 * for everything with `updated_at > since`, and a row that has been DELETED is not late — it is gone. It appears in no
 * result set, so it lands in neither `items` nor `removed`, and the till's merge keeps it for ever. The `removed` list
 * only ever caught rows that went INACTIVE, which is a different thing from rows that stopped existing.
 *
 * No delta protocol can express an absence it cannot see, so the counter is given the one number that reveals it: how many
 * sellable products the shop has RIGHT NOW. If what the till holds after merging does not equal this, its copy is wrong for
 * some reason we did not anticipate, and it takes the whole shop again. That heals a hard delete, a missed delta, a clock
 * skew and a half-written cache — without any of them having to be predicted.
 *
 * ⚠️ The predicate must be exactly itemstatus.isOfferable: statusOf() falls back to 'available' for a missing, blank or
 * unrecognised status, so the SQL excludes the three blocked statuses rather than requiring 'available'. Requiring it would
 * under-count every product that never had the field, and the counter would then refresh itself in a loop for ever.
 */
function liveCountRead(db, entity_id) {
  return db.query(
    `SELECT count(*)::int AS n FROM catalogue_items
           WHERE entity_id = $1 AND is_active = true
             AND COALESCE(NULLIF(btrim(lower(item_data->>'status')), ''), 'available')
                 NOT IN ('redundant', 'retired')`,
    [entity_id]
  );
}

/**
 * ⚠️ THE NAME AND THE NUMBER ARE ON identities. customer_list is the join and carries only the relationship —
 * owner_entity_id, customer_identity_id, groups, and how often they have transacted.
 * ⚠️ owner_entity_id, NOT entity_id. The old query used the wrong column name and threw on every snapshot.
 */
function customersRead(db, entity_id) {
  return db.query(
    `SELECT i.identity_id, i.display_name, i.otp_contact AS phone, i.gstn, c.groups, c.last_txn_at,
                /* ⭐ BOOKS v2 (b274) — read through to_jsonb so this query runs the same before and after the
                   columns exist: a missing column is a NULL here ("limit unknown offline"), never a failed snapshot */
                to_jsonb(c)->>'credit_days' AS credit_days, to_jsonb(c)->>'credit_limit_minor' AS credit_limit_minor,
                to_regclass('party_item') IS NOT NULL AS has_party_item,
                /* ⭐ THE TWO-SIDED COUNTER BILL (2026-10-01): a customer who is a business ON THE RAIL can be sent their copy
                   of a bill — lib/istest mayTradeSql (on the rail AND the same sandbox), the same test the send route's
                   till gate makes, so the counter never offers a copy the gate would drop (Athi, 2026-10-02) */
                CASE WHEN ${require('../lib/local-identity').mayTradeSql('i', '$1')} THEN i.identity_id END AS rail_entity_id
           FROM customer_list c
           JOIN identities i ON i.identity_id = c.customer_identity_id
          WHERE c.owner_entity_id = $1
          ORDER BY c.last_txn_at DESC NULLS LAST
          LIMIT 2000`,
    [entity_id]
  );
}

/**
 * ⭐ F11 (14 Oct): THE SHOP'S SUPPLIERS, BY NAME — the Receive form suggests them as the door types ("Sri Ganesh" → Sri Ganesh
 * Provisions) and a pick carries the party's id on the receipt (business_json.party.party_id), so their bill reaches the books as
 * THAT supplier. ⚠️ WHO, never what is owed: a counter device must never read what the shop pays its suppliers (see /match).
 * The GSTIN rides only for its state (CGST/SGST vs IGST at the door). party_no through to_jsonb — absent before its column exists.
 */
function suppliersRead(db, entity_id) {
  return db.query(
    `SELECT s.supplier_entity_id AS id, i.display_name AS name, s.nickname, i.gstn, i.country, to_jsonb(s)->>'party_no' AS party_no
           FROM supplier_list s JOIN identities i ON i.identity_id = s.supplier_entity_id
          WHERE s.owner_entity_id = $1
          ORDER BY i.display_name
          LIMIT 2000`,
    [entity_id]
  );
}

/**
 * ⭐ SECTORS ARE A COLUMN, not something inside profile_json — and this line SAID SO while selecting
 * profile_json anyway. There is no such column, so the query threw on every snapshot, the catch below
 * swallowed it, and sectors was ALWAYS [].
 * ⚠️⚠️ WHICH MEANS lot_fields HAS NEVER WORKED. No counter has ever asked for a batch or an expiry,
 * for any vertical, since the day it was written — a pharma shop received medicine and was asked
 * nothing. Found 2026-09-10 in the Railway log, by an error nobody was reading.
 * ⚠️ AND IT USED A BARE query() ON A TENANT TABLE. The platform prints [RLS-GUARD] for exactly that;
 * withEntity is what every other read of this table uses.
 * ⚠️ SAY IT. The silent catch here is what let the above hide for weeks — a shop with no profile is
 * the ordinary case and needs no noise, but a query that CANNOT run must leave a trace.
 */
async function readSectors(ownRead, entity_id) {
  try {
    const found = await ownRead('profile');
    return { profile: found.rows[0] || {}, sectors: (found.rows[0] && found.rows[0].sectors) || [] };
  } catch (e) {
    log.warn('till.sectors', { entity_id, why: String(e && e.message) });
    return { profile: {}, sectors: [] };
  }
}

/**
 * ⚠️ THE ITEMS ARE NOT THE TAX SHELF. readShelf() answers null for a seller with no GSTIN — the one place that decides "no GSTIN,
 * no GST" for the cart, the send and the invoice alike — and most shops we are building this counter for have none. So the shelf
 * is asked only for slabs, categories and the face; the items come from the catalogue, whoever the shop is.
 * → [shelf, itemRows, liveCount]; the items and the live count are read in the shared transaction (OWN reads), each on its own if it failed.
 */
function readShelf(entity_id, ownRead) {
  return Promise.all([
    taxShelf
      .readShelf(entity_id, shelfDeps(), { withItems: false })
      .catch(log.orElse('till GET /snapshot: the read failed — answered with nothing', null)),
    Promise.resolve()
      .then(() => ownRead('items'))
      .catch(log.orElse('till GET /snapshot: the read failed — answered with none', { rows: [] })),
    Promise.resolve()
      .then(() => ownRead('count'))
      .catch(log.orElse('till GET /snapshot: the read failed — answered with an unknown count', { rows: [{ n: null }] }))
  ]);
}

/**
 * ⭐ WHAT THIS SHOP DECLARED ABOUT ITS OWN PRODUCTS (2026-09-08). A pharmacy declares composition, a paint shop a shade, a
 * hardware shop a size — the declared columns are the one place that is already true, so the counter reads them rather than
 * inventing a field list of its own.
 * ⚠️ THREE, SHORT. A counter row is read at a glance, and a snapshot is carried on a device: every field costs bytes on ten
 * thousand items, so the first three declared columns travel and each value is trimmed.
 * A shop that declared nothing shows nothing — the ordinary case.
 */
async function readDeclared(entity_id) {
  try {
    const found = await query(
      `SELECT sf.field_key, sf.field_name
           FROM entity_schemas es JOIN schema_fields sf ON sf.schema_id = es.schema_id
          WHERE es.entity_id = $1 AND es.status = 'active' AND es.is_default = true
          ORDER BY sf.display_order LIMIT 3`,
      [entity_id]
    );
    return found.rows.map((field) => ({ k: field.field_key, n: field.field_name || field.field_key }));
  } catch (e) {
    log.fellBack('till GET /snapshot: the read failed — answered with none', e);
    return [];
  }
}

/** the live offers this shop is running — the same rows the storefront and the chit read; a shop with no offers bills fine */
async function readLiveOffers(entity_id) {
  try {
    const live = await catalogueView.liveOffers({ entity_id, withEntity, viewer: null, groups: [], all: false });
    return Array.isArray(live) ? live : (live && live.offers) || [];
  } catch (e) {
    log.fellBack('till GET /snapshot: the read failed — carried on without it', e);
    return [];
  }
}

/**
 * ⭐⭐ THE REWARD PROGRAMME — a definition of kind 'reward', read exactly like an offer, because it IS the same
 * kind of thing: a rule the shop declared that must still be quotable months later against a bill it priced.
 * ⚠️ ONE LIVE PROGRAMME. Two would mean a bill earning twice and a customer holding two balances at one shop,
 * and there is no sensible way to say which one a redemption came out of. If a shop wants to change the rate
 * it retires the old programme and declares a new one — the ledger then carries both, each row naming the
 * definition that awarded it.
 * ⚠️ the SAME reader the award path uses (lib/reward-store.js). The counter must not be told one programme
 * while the server awards under another — that is a customer promised one rate and paid at a different one.
 */
async function readReward(entity_id) {
  try {
    return await require('../lib/reward-store').programme(entity_id, withEntity);
  } catch (e) {
    log.warn('till.reward', { entity_id, why: String(e && e.message) });
    return null;
  }
}

/**
 * the counter's customer list — a name and a phone, nothing more; the till looks up a repeat customer, it does not hold history.
 * → { customers, booksOn }: booksOn is set only once the customers were read, so a failure leaves "ledger off" and an empty list (said in the log).
 * ⚠️ SAY WHAT WENT WRONG. The old catch claimed to be handling a known schema difference and was in fact
 * hiding a query that could never run. A swallowed error that explains itself wrongly is how a broken
 * feature becomes a documented one — so this one leaves a trace and the till still bills.
 */
async function readCustomers(entity_id, ownRead) {
  const result = { customers: [], booksOn: false };
  try {
    const found = await ownRead('customers'); /* OWN.customers — the name and number are on identities, see customersRead */
    const booksOn = await readBooksOn(ownRead);
    const { dues, duesCut } = booksOn && found.rows.some((x) => x.has_party_item) ? await readDues(entity_id) : { dues: { rows: [] }, duesCut: false };
    const owed = foldDues(dues.rows);
    result.booksOn = booksOn;
    result.customers = found.rows.map(customerRow(owed, booksOn, duesCut));
  } catch (e) {
    log.warn('till.customers', { entity_id, why: String(e && e.message) });
  }
  return result;
}

/** is this shop's ledger on? Unreadable = not on, and said */
async function readBooksOn(ownRead) {
  try {
    return !!(await ownRead('books'));
  } catch (e) {
    log.fellBack('till GET /snapshot: failed — answered no', e);
    return false;
  }
}

/**
 * ⭐⭐ BOOKS v2 — WHAT EACH CUSTOMER OWES, for the counter's offline limit check (C2) and the receipt proposal (D1).
 * Outstanding = SUM(amount_minor) per bill (the payment-ledger rule, SPEC-books-v2 §1); only open bills travel,
 * oldest due first. ⚠️ Asked on its own, and only when party_item exists (the customers row says so) — until b273
 * is run it costs no trip at all and the counter says "limit unknown offline".
 * ⚠️⚠️ ONLY FOR A SHOP WHOSE LEDGER IS ON (critic M5). It ran for every shop once b273 existed — one extra transaction a
 *   snapshot — and stamped balance_minor: 0 ("owes nothing") on every customer of a shop that keeps no ledger at all.
 * ⚠️ THE RECEIVABLE SIDE ONLY (F2): a party who is also a supplier has payable rows here too; summed together, what the
 *   shop owes them was added to what they owe, and their purchase bills appeared in the receipt proposal.
 * ⚠️ DISPUTED = THE LATEST DISPUTE ROW (F3): BOOL_OR(status = 'disputed') stayed true for ever — a later 'undisputed'
 *   row is a new row (the table is insert-only), so only the newest of the two statuses says what the bill is now.
 * ⚠️ ORDERED before the limit (oldest due first): a LIMIT with no ORDER BY cuts an arbitrary part away.
 * ⚠️ ONE PAST THE CAP (SEC-SMALL item 5). It was LIMIT 20000 in silence, and a cut aggregate is a WRONG balance — the bills
 *   with the furthest due dates fall off and every credit check after them passes. A balance is a sum, not a list: it cannot
 *   be paged. So past the cap nothing is pretended: balances are left ABSENT (the slot's own word for "unknown", below),
 *   the counter shows no figure, and the warn line names the shop. A shop with 20,000 open receivable bills is one Athi
 *   should hear about, not one the counter should guess for.
 * → { dues, duesCut }. Never an empty catch: the dues read failing is logged, the counter gets no balances.
 */
async function readDues(entity_id) {
  let dues = { rows: [] },
    duesCut = false; /* SEC-SMALL: a snapshot over the cap says unknown, never a short sum */
  try {
    dues = await withEntity(entity_id, (db) =>
      db.query(
        `SELECT party_id, against_ref, SUM(amount_minor)::bigint AS balance_minor,
                    MIN(due_date) FILTER (WHERE ref_kind = 'bill') AS due_date,
                    MIN(doc_date) FILTER (WHERE ref_kind = 'bill') AS doc_date,
                    COALESCE((array_agg(status ORDER BY item_id DESC) FILTER (WHERE status IN ('disputed', 'undisputed')))[1] = 'disputed', false) AS disputed
               FROM party_item
              WHERE entity_id = $1 AND side = 'receivable'
              GROUP BY party_id, against_ref
             HAVING SUM(amount_minor) <> 0
              ORDER BY MIN(due_date) FILTER (WHERE ref_kind = 'bill') NULLS LAST, against_ref
              LIMIT $2`,
        [entity_id, DELTA_CAP + 1]
      )
    );
    if (dues.rows.length > DELTA_CAP) {
      duesCut = true;
      dues = { rows: [] };
      log.warn('till.snapshot.dues.cut', {
        entity_id,
        cap: DELTA_CAP,
        says: 'more open receivable bills than one snapshot carries — customer balances sent as unknown, never as a short sum'
      });
    }
  } catch (e) {
    log.warn('till.snapshot.dues', { entity_id, why: String(e && e.message) });
  }
  return { dues, duesCut };
}

/** the open bills of each party, folded: { party_id → { balance_minor, open_bills[] } } (a bill is listed only while it is owed) */
function foldDues(rows) {
  const owed = {};
  for (const due of rows) {
    const key = String(due.party_id),
      mine = owed[key] || (owed[key] = { balance_minor: 0, open_bills: [] });
    mine.balance_minor += Number(due.balance_minor) || 0;
    if (Number(due.balance_minor) > 0)
      mine.open_bills.push({
        ref: due.against_ref,
        balance_minor: Number(due.balance_minor),
        /* ⚠️ `date` columns, read by the ledger's ONE date reader — toISOString() was the day before, east of UTC (critic M8) */
        due_date: booksYmd(due.due_date),
        date: booksYmd(due.doc_date),
        disputed: !!due.disputed
      });
  }
  return owed;
}

/** a number out of a text column, or null when it is blank or not a number */
const numOrNull = (value) => (value == null || value === '' || !isFinite(Number(value)) ? null : Number(value));

/**
 * one customer row as the counter receives it. ⚠️ THE ID TRAVELS because points hang from it. A name is not a holder — two customers can be called
 * Kumar, and a reward balance addressed by name would eventually be paid to the wrong one.
 */
function customerRow(owed, booksOn, duesCut) {
  return (x) => {
    const out = customerCore(x);
    if (numOrNull(x.credit_days) != null) out.credit_days = numOrNull(x.credit_days);
    if (numOrNull(x.credit_limit_minor) != null) out.credit_limit_minor = numOrNull(x.credit_limit_minor);
    if (booksOn && x.has_party_item && !duesCut) addBalance(out, owed[String(x.identity_id)]);
    return out;
  };
}

/** who the customer is: id, name, phone, groups, the rail entity (a business on the rail) and the buyer's GSTIN */
function customerCore(x) {
  const out = { identity_id: x.identity_id, name: x.display_name, phone: x.phone || null, groups: Array.isArray(x.groups) ? x.groups : [] };
  /* ⭐ present only for a business on the rail — absent = the bill stays the shop's own record (never sent) */
  if (x.rail_entity_id) out.entity_id = x.rail_entity_id;
  /* ⭐ the customer's GSTIN, so the counter's invoice names its buyer (CBTax.determine BuyerDtls — GSTR-1 b2b, Rule 46) */
  if (x.gstn && String(x.gstn).trim()) out.gstin = String(x.gstn).trim().toUpperCase();
  return out;
}

/** absent = unknown (no ledger, not read, or more dues than one answer carries) — never a 0 that reads as "owes nothing" */
function addBalance(out, mine) {
  out.balance_minor = mine ? mine.balance_minor : 0;
  out.open_bills = mine ? mine.open_bills.sort((first, second) => String(first.due_date || '').localeCompare(String(second.due_date || ''))).slice(0, 20) : [];
}

/** F11: the suppliers the Receive form suggests — { party_id, name, nickname?, state?, party_no? }; an unreadable list is none (said) */
async function readSuppliers(entity_id, ownRead, shopCountry) {
  try {
    const found = await ownRead('suppliers');
    return found.rows.filter((x) => x.id && x.name).map((x) => supplierRow(x, shopCountry));
  } catch (e) {
    log.warn('till.suppliers', { entity_id, why: String(e && e.message) });
    return [];
  }
}

/** one supplier as the Receive form suggests it */
function supplierRow(x, shopCountry) {
  const out = { party_id: String(x.id), name: String(x.name) };
  if (x.nickname) out.nickname = String(x.nickname);
  const taxId = x.gstn ? String(x.gstn).trim().toUpperCase() : '';
  /* STD2: the state read off the tax number only under the pack's supply rule (tax-lines.stateUnder) — a supplier with no country is the shop's (walkIn's rule) */
  const state = require('../lib/tax-lines').stateUnder(taxId, x.country || shopCountry);
  if (state) out.state = state;
  if (x.party_no) out.party_no = String(x.party_no);
  return out;
}

/**
 * ⭐ THE PEOPLE WHO MAY STAND AT A COUNTER (2026-09-07). The shop's own co-assists — never the connectors, which are actors too
 * and would otherwise offer "Zoho Books connector" as a cashier. Name, id and the sign-in user ID only (R132: a picked name must carry who the person is, so the counter asks only for the PIN or first code; the ID is not a secret): the till records WHO billed, it does not
 * authenticate anybody, and nothing about a person's contact details belongs on a device at a counter.
 * A shop with no co-assists bills as the shop itself.
 */
async function readStaff(entity_id) {
  try {
    const found = await query(
      `SELECT identity_id, display_name, hat, user_id FROM identities
          WHERE parent_entity_id = $1 AND identity_type = 'actor' AND status = 'active'
            AND (actor_type IS NULL OR actor_type <> 'connector') AND connector_type IS NULL
          ORDER BY display_name LIMIT 200`,
      [entity_id]
    );
    return found.rows.map((item) => ({ id: item.identity_id, name: item.display_name, hat: item.hat || null, user_id: item.user_id || null }));
  } catch (e) {
    log.fellBack('till GET /snapshot: the read failed — carried on without it', e);
    return [];
  }
}

/**
 * ⚠️⚠️ THE SHOP'S PARTICULARS COME FROM invoiceParty (2026-09-17). The shop block read trade_name, legal_name,
 * address, city, state, pincode, phone, gstin and currency off `profile` — and `profile` is entity_profile, which holds
 * none of them. So every counter showed the account handle as the shop name, and no counter bill ever printed the shop's
 * address or phone, which a tax invoice must carry. invoiceParty is the one reader the order invoice and Trade ready use.
 * → { party, gstin, country, stateSplit, shopMoney }: ONE GSTIN, read once; it may be on the identity row or in the profile.
 */
async function readParticulars(entity_id, row, profile) {
  const cbProfile = require('../lib/profile');
  let party = {};
  try {
    party = (await cbProfile.invoiceParty(entity_id)) || {};
  } catch (e) {
    console.warn('[till] snapshot could not read the shop particulars — the bill header will be thin:', e.message);
  }
  const gstin = row.gstn || party.gstin || null;
  /* ⚠️ ONE DERIVATION, read by the shop block AND by payWays — two answers about which country a shop is in would
     eventually mean one screen offering a payment method another refuses. */
  const country = cbProfile.countryOf({ country: row.country, gstin, profile });
  /* CX0: a state is read off the tax number only under a pack whose tax turns on the state (India's GST) — the same rule as lib/tax-lines.js:62.
     An ABN's or a TRN's first two digits are not a state; they reached the counter as one and the shop panel said "CGST + SGST" in Sydney. */
  const stateSplit = require('../lib/tax-lines').splitsByState(country);
  /* CX0 + STD2: the money the counter bills in — the shop's own, else its PACK's; neither → null and the ONE sentence (country-setup.MONEY_UNSTATED) */
  const shopMoney = countrySetup.shopMoney(party.currency, country); /* SEC3: the one reader */
  return { party, gstin, country, stateSplit, shopMoney };
}

/**
 * ⭐⭐ THE CATEGORY MASTER, ONCE ([TILL-114]). id → name for every category this shop has, so tillItem can
 * resolve what a product cites without a query per row.
 * ⚠️ NOT THROUGH taxShelf. That read returns null for a seller with no GSTIN, which is most small shops —
 * their categories would have been invisible for the same reason their tax is zero.
 * ⚠⚠ A FAILURE HERE MUST NOT STOP A SHOP BILLING. An entity whose definitions table is not provisioned gets
 * an empty Map and every product falls back to the legacy key, which is precisely today's behaviour — and
 * the reason is said out loud rather than swallowed.
 * ⚠️ ONE READ, BOTH SHAPES — the list travels to the counter, the Map resolves names here. Reading
 * twice would be two round trips for one small table.
 */
async function readCategoryMaster(entity_id) {
  const catNames = new Map();
  let catList = [];
  try {
    catList = await categories.listCategories(entity_id, { withEntity });
    for (const category of catList) catNames.set(String(category.id), category.name);
  } catch (e) {
    log.warn('till.categories', { entity_id, why: String(e && e.message) });
  }
  return { catNames, catList };
}

/**
 * ⚠️ SELLABLE, NOT MERELY ALIVE. `is_active` says the row exists; itemstatus.isOfferable says a customer may take one — retired,
 * unavailable and redundant are all alive and all unsellable. Filtering on the wrong one put retired stock on the counter
 * ([TILL-02], 2026-09-08).
 * ⚠️⚠️ A COUNTER MUST SEE WHAT IT HAS TAKEN OFF THE SHELF. The snapshot sent only OFFERABLE rows, so the moment somebody
 * marked something out of stock it vanished from the counter completely — and could never be put back from there. The
 * Stock-out screen listed "what is off the shelf right now" from a list those rows had just left. Found while redesigning
 * the row, not by a test: the feature was written and shipped the same afternoon.
 *
 * So the counter is sent what it can SELL plus what it has itself taken OFF, and nothing else — retired and redundant stay
 * out, because those are lifecycle decisions nobody reverses at a till.
 * ⚠️ "avail" already rides on every row, and hits() refuses to offer an unavailable one in Sell, Receive or Despatch. The
 * snapshot's job is to say what is true; deciding what may be BILLED is the counter's, and it was already doing it.
 */
const onTheCounter = (item) => item.is_active !== false && ['available', 'unavailable'].indexOf(itemstatus.statusOf(item.item_data || {})) >= 0;

/**
 * ⚠️ A CAP, AND IT IS A REAL LIMIT. 20,000 items is about 5 MB in one answer — heavy but workable on a shop line. Beyond that
 * the snapshot must PAGE (a cursor beside ?since=), because no counter should wait on a 26 MB download; measured 2026-09-08.
 * ⭐ A DELTA LONGER THAN THE CAP IS SENT IN PARTS, NEVER CUT. The query asked for DELTA_CAP + 1 rows oldest-first; a +1th row
 * means more changed than one answer carries. The answer then stops at DELTA_CAP and its cursor is the updated_at of the
 * LAST row it carries — not readAt — so the next ?since= continues exactly there, and `more: true` tells the counter to
 * ask again now. ⚠️ The cursor is ≤ that row's timestamp (a JS Date keeps milliseconds, Postgres keeps microseconds), so
 * rows sharing it may be sent twice: a repeat is a no-op merge by item_id, a skip would be permanent.
 * ⭐ a delta AND a full read: both asked for DELTA_CAP + 1 oldest-first, so both page by the one rule (SEC-SMALL item 5).
 * On a delta, anything that changed and is NO LONGER on the counter travels as a REMOVAL: an absence cannot be expressed by a list of
 * present rows, and a till that never hears about it goes on selling something the shop has withdrawn — retired or redundant, not
 * merely "not sellable today".
 * → { items, removed, more, cursor }
 */
function itemsOnCounter(itemRows, since, project) {
  const page = deltaPage((itemRows && itemRows.rows) || [], DELTA_CAP);
  const removed = since ? page.rows.filter((item) => !onTheCounter(item)).map((item) => item.item_id) : [];
  const items = page.rows
    .filter(onTheCounter)
    .map((item) => project(item.item_id, item.item_data || {}))
    .filter((entry) => entry.name);
  return { items, removed, more: page.more, cursor: page.cursor };
}

/**
 * ⭐ ONE MAPPING from a product's data to a counter row — owned rows and network lines both go through it, so a field
 * added for one can never be missing from the other. The row is built in four runs of fields, in this order.
 *
 * ⚠️⚠️ WHAT A COUNTER IS TOLD IS EXACTLY THIS LIST, AND NOTHING ELSE (2026-09-18). The projection is
 * deliberately narrow — a shelf of ten thousand crosses the wire on every pairing — but that means a
 * feature whose data lives in item_data and is NOT named here does not exist at the counter at all.
 * Modifiers, combos and age checks were each built, tested against injected rows, and then found dead on
 * a real shop: Mayur Bhavan carried choices on eighteen dishes and the counter saw none of them, because
 * tillItem() never copied the field. The engine can be perfect and the shop still sees nothing.
 * ⭐ SO: anything a counter must ACT on belongs here the moment it is built.
 */
function tillItem(item_id, data, declared, catNames) {
  return Object.assign(
    { item_id },
    itemNameAndPrice(data),
    itemTaxAndCategory(data, catNames),
    itemSellingRules(data),
    itemPricingCopy(data),
    itemSearchWords(data, declared)
  );
}

/**
 * name · code · unit · price · mrp.
 * ⚠️ A PRICE IS SOMETIMES MONEY, NOT A NUMBER: the catalogue stores { amount, currency } as well as a bare figure,
 * and reading only the bare one gave the counter a shelf of zeroes ([TILL-01], first run). Same reader as pricing-engine.
 */
function itemNameAndPrice(data) {
  return {
    name: data.name,
    code: firstSet(data.code, data.sku),
    unit: data.unit || 'piece',
    price: amountOf(data.price),
    mrp: amountOf(data.mrp)
  };
}

/**
 * hsn · tax_slab · category · category_id · image.
 * ⚠️⚠️⚠️ THE NAME, RESOLVED — not the legacy key ([TILL-114]). This was `d.category || null`, and
 * `category` is the key catalogue-columns calls *"legacy … read, never written again"*. A product
 * that cites `categories: [id]`, which is the CORRECT way, arrived here with nothing — so it
 * vanished from the chips and the By-category view with no error anywhere.
 * ⭐ categories.nameOf tries the master first, then a counterparty's travelling copy, then the
 * legacy key — one order, in one place, rather than the copy of it in lib/network-catalogue.
 * ⭐⭐ AND THE RELATION, not only the answer ([TILL-114]). Athi: *"we need to have those relations
 * in local systems as well, so mapping shouldn't be an issue."* With the name alone a counter
 * could display a group and nothing more — it could not cite one back without sending a string
 * and hoping the server matched it, which is how a master acquires a second "vegetables".
 * ⭐ THE SHOP'S OWN PICTURE. Already a PUBLIC url (routes/products mediaUrl → /api/products/media/…), so the
 * counter and the shop screen can draw it without a key and without a second round trip. Null for most rows and
 * that is fine — the screen falls back to the category emblem rather than leaving a hole.
 */
function itemTaxAndCategory(data, catNames) {
  const taxFacts = taxFactsOf(data); /* ⭐⭐ F5 A1: the facts tax-slab inputOf reads, named key by key below so the projection guard sees each; hsn never from `code` */
  return {
    hsn: taxFacts.hsn,
    tax_slab: taxFacts.tax_slab,
    gst_rate: taxFacts.gst_rate,
    tax_slab_name: taxFacts.tax_slab_name,
    cess_rate: taxFacts.cess_rate,
    categories: taxFacts.categories,
    category: categories.nameOf(data, catNames),
    category_id: (Array.isArray(data.categories) && data.categories[0]) || null,
    image: data.image || null
  };
}

/**
 * modifiers · combo_of · age_check · barcode · avail · status · offers_excluded — what a counter ACTS on.
 *   modifiers — the choices a dish has, and which are required (modsOf, modOpen)
 *   combo_of  — the parts a meal deal replaces, so the counter prices them off its own shelf
 *   age_check — the minimum age in years; COTPA §6 and the state excise ages (ageOf, ageAllow)
 *
 * ⚠️⚠️ "avail" IS NOT THE STATUS, AND THE COUNTER WAS READING IT AS ONE. lib/itemstatus.js says so in as many
 * words: item_data.avail is a QUANTITY feed ({qty, source, as_of}) — how many are on the shelf — while the
 * lifecycle (available · unavailable · retired · redundant) lives in item_data.status.
 *
 * The counter's Stock-out button compared i.avail against the string 'unavailable' and assigned the string back.
 * Against an object that comparison is ALWAYS false, so:
 *   · the button only ever toggled one way on the first press
 *   · POST /api/till/stock correctly stamped item_data.status on the server — a field the snapshot never sent —
 *     so the next re-read brought the row back looking available, and the shopkeeper's decision was gone
 *   · the "off the shelf right now" list read the same wrong field, so it could never list anything
 * The whole feature was writing to one field and reading another. Both now travel, each meaning its own thing.
 *
 * ⚠️ offers_excluded: READ FOR A WEEK, NEVER SENT. lib/offers-engine.js matches an offer against l.excluded, and the counter's
 * lineOf() dutifully passed item.offers_excluded — a field the snapshot did not carry, so it was always
 * undefined and a shop's opt-out of an offer has never once been honoured at a till. Found while giving it a
 * switch to be set from.
 */
function itemSellingRules(data) {
  return {
    modifiers: modifiersOf(data),
    combo_of: Array.isArray(data.combo_of) ? data.combo_of : null,
    age_check: Number(data.age_check) > 0 ? Math.floor(Number(data.age_check)) : null,
    barcode: firstSet(data.barcode, data.ean),
    avail: data.avail || null,
    status: itemstatus.statusOf(data),
    offers_excluded: Array.isArray(data.offers_excluded) ? data.offers_excluded.map(String) : []
  };
}

/**
 * ⚠️⚠️ MODIFIERS GO THROUGH THE SAME SHAPE-GUARD AUTHORING DOES, NOT STRAIGHT THROUGH. This
 * used to send the stored array raw to a device holding a till-scoped key — anything a shop or
 * an importer had put on an option (a cost price, a supplier code) rode along, and the array
 * was unbounded. normalize() strips every field outside {name,options:[{name,price}]}, and
 * groupsOf() drops a group that is not actually sellable yet (no name, or no options) — the
 * exact same two calls the Modifiers tab itself runs before saving, so what ships here is
 * never wider than what authoring could produce in the first place.
 */
function modifiersOf(data) {
  const groups = variantEngine.groupsOf({ modifiers: variantEngine.normalize(data.modifiers) });
  return groups.length ? groups : null;
}

/**
 * ⭐ THE PRICING STRUCTURE THE PRODUCT CITES, as its TRAVELLING COPY (lib/pricing-engine copyOf) —
 * never the definition id alone. A counter that had to resolve a definition could not price with the
 * line down, and a bill reprinted next year must say what it was priced by, not what that structure
 * has since become. (+ screen: ⭐ picked by hand for the shop screen — the one thing promo.html cannot work out from the catalogue itself)
 */
function itemPricingCopy(data) {
  return {
    pricing_kind: data.pricing_kind || null,
    pricing_tiers: Array.isArray(data.pricing_tiers) ? data.pricing_tiers : null,
    pricing_amount: data.pricing_amount == null ? null : Number(data.pricing_amount),
    pricing_min: data.pricing_min == null ? null : Number(data.pricing_min),
    pricing_max: data.pricing_max == null ? null : Number(data.pricing_max),
    pricing_def_name: data.pricing_def_name || null,
    screen: data.screen === true
  };
}

/**
 * aliases · synonym_text · alias_text · brand · variant · facts — the words a person types or a supplier prints.
 * ⭐ WHAT EACH SUPPLIER CALLS IT (2026-09-08) — so a goods-in scan of THEIR code finds OUR product, and their carton
 * converts to our pieces. Capped: an alias list is a memory aid, not a place to accumulate.
 * ⭐⭐ THE SHOP'S OWN WORDS — thakkali, vengayam, milagai. `synonyms` is a field lib/itemmatch.js has read since August
 * for WhatsApp orders and consolidation, so the same word resolved in a message and failed at the counter. One
 * authority, read by both now. alias_text is the same, flattened, because the counter's own search reads fields — so typing
 * what the SUPPLIER calls it finds it. facts: the shop's own declared facts — a pharmacy's composition, a paint shop's shade.
 */
function itemSearchWords(data, declared) {
  return {
    aliases: aliasesOf(data),
    synonym_text: Array.isArray(data.synonyms)
      ? data.synonyms
          .map((word) => String(word || ''))
          .filter(Boolean)
          .join(' ') || null
      : null,
    alias_text: Array.isArray(data.aliases)
      ? data.aliases
          .slice(0, 20)
          .map((item) => item.text)
          .filter(Boolean)
          .join(' ') || null
      : null,
    brand: data.brand || null,
    variant: firstSet(data.variant, data.grade),
    facts: declaredFacts(data, declared)
  };
}

/** the supplier aliases of a product, capped at twenty */
function aliasesOf(data) {
  if (!Array.isArray(data.aliases)) return null;
  return data.aliases
    .slice(0, 20)
    .map((item) => ({ by: item.by || null, text: item.text, unit: item.unit || null, factor: item.factor == null ? null : Number(item.factor) }));
}

/** the shop's own declared facts, trimmed: a row is read at a glance */
function declaredFacts(data, declared) {
  return declared
    .map((field) => {
      const value = data[field.k];
      return value == null || typeof value === 'object' || String(value) === '' ? null : { n: field.n, v: String(value).slice(0, 40) };
    })
    .filter(Boolean);
}

/**
 * ── ⭐⭐⭐ THE NETWORK'S PRODUCTS, AT THE COUNTER (2026-09-17) ───────────────────────────────────────────────────
 *
 * Athi, on a showroom brand with stores across a city: *"a network store where the network provides the catalogue and
 * offer details — every store underneath is a store on its own with its own GSTIN, but they use the catalogue
 * information from the network to sell the product."*
 *
 * ⚠️⚠️ THAT ALREADY REACHED THE STORE'S SHOPFRONT AND NEVER ITS COUNTER. A store adopts a brand's catalogue BY REFERENCE
 * (catalogue_adoption → catalogue_source, owned by the brand) and the storefront resolved it — but this snapshot read
 * only catalogue_items, so a member store's till could not ring up a single one of the network's products.
 *
 * ⭐ THE SAME READ THE SHOPFRONT USES — catalogueBuild.resolve + catalogueRead.lines — never a second path. Nothing is
 * copied: the brand's fields stay the brand's, the store's own commercials (its price, its availability) overlay them,
 * and a change at the source reaches every store's counter on its next read.
 *
 * ⚠️ UNPRICED LINES ARE HELD BACK, NOT SENT AT ZERO. A referenced line with no commercials from this store has no price
 * a counter can charge; offering it would bill a real product for nothing. It is counted (network.unpriced), so the gap can be named.
 * ⚠️ THE LINE ID IS THE REFERENCE ('src:<source>:<sku>') — stable across reads, so the counter's merge and its quick keys
 * hold on to it, and it can never collide with an owned product's uuid.
 * A store with no network, or a source that cannot be read, still opens with its own products.
 */
async function addNetworkLines(entity_id, ownRead, items, network, project) {
  try {
    const adopted = await ownRead('adoption');
    if (adopted.rows.length) await pushNetworkLines(entity_id, adopted.rows, items, network, project);
  } catch (e) {
    log.fellBack('till GET /snapshot: did not parse — carried on without it', e, 'debug');
  }
}

/** resolve the adopted sources, read their lines the way the shopfront does, and push each priced, sellable one onto the counter's items */
async function pushNetworkLines(entity_id, adoptedRows, items, network, project) {
  const catalogueRead = require('../lib/catalogue-read');
  let container = null;
  try {
    container = require('../lib/container');
  } catch (e) {
    log.fellBack('till GET /snapshot: the helper failed — carried on without it', e);
  }
  const sources = await resolveSources(entity_id, adoptedRows);
  const containers = await resolveContainers(container, sources);
  const lines = catalogueRead.lines({
    owned: [],
    sources,
    me: entity_id,
    containers,
    containerIdFor: container ? container.itemContainerId : null
  });
  for (const line of lines) {
    const record = networkRecord(line, project);
    if (!record) continue;
    if (!catalogueRead.isPricedByStore(line, record.price)) {
      network.unpriced++;
      continue;
    }
    /* ⭐ where it came from — the slip, the chit and the shop screen can all say "from <brand>" */
    record.source = { key: line.source_key, title: line.source_title || null, owner: line.owner_entity_id || null, line: line.line_id };
    items.push(record);
  }
}

/** each adopted source resolved through the shopfront's own read: [{ source_key, title, owner_entity_id, items }] (a source that cannot be read is left out) */
async function resolveSources(entity_id, adoptedRows) {
  const catalogueBuild = require('../lib/catalogue-build');
  const resolved = await Promise.all(
    adoptedRows.map((item) =>
      catalogueBuild
        .resolve(item.source_key, item.commercials || {}, { entity_id })
        .catch(log.orElse('till GET /snapshot: failed — answered with nothing', null))
    )
  );
  const sources = [];
  adoptedRows.forEach((item, index) => {
    const found = resolved[index];
    /* CTR-171: a SOURCE shop's cost never travels (DECISIONS) — items go through the ONE strip CAT-241 gave the public catalogue (cost.dropCostKeys on a clone), for every role */
    if (found) sources.push({ source_key: item.source_key, title: found.title, owner_entity_id: found.owner_entity_id || null, items: require('../lib/catalogue-view').publicItemsOf(found.items || []) });
  });
  return sources;
}

/** the container of each named item, when the container helper is there; an unreadable answer is an empty set (said) */
async function resolveContainers(container, sources) {
  if (!(container && container.resolveMany && container.itemContainerId)) return {};
  const ids = [];
  for (const source of sources) for (const entry of source.items) if (entry && entry.name) ids.push(container.itemContainerId(source.source_key, entry.name));
  try {
    return (await container.resolveMany(ids)) || {};
  } catch (e) {
    log.fellBack('till GET /snapshot: failed — answered with an empty set', e);
    return {};
  }
}

/** one network line as a counter row, or null when it is not on the counter's shelf or has no name */
function networkRecord(line, project) {
  const fields = line.fields || {};
  if (['available', 'unavailable'].indexOf(itemstatus.statusOf(fields)) < 0) return null;
  /* ⚠️ the counter puts an item id inside click handlers — a name like "Men's shirt" would break the button. The
     id is made safe here; the true reference rides beside it for the chit. */
  const record = project(String(line.line_id).replace(/['"\\<>&\s]/g, '_'), fields);
  return record.name ? record : null;
}

/**
 * ⭐⭐⭐ AND THE OFFERS ITS NETWORKS RELEASED (lib/network-offers). Opt-in or opt-out is the brand's model; the store's
 * own choice decides within it. Each travels with its release moment as valid_from, so it switches on at the counter at
 * that moment and not a minute before — "not in the middle of the day" is kept even with the line down.
 * A network that cannot be read never stops the store's own offers.
 */
async function withNetworkOffers(entity_id, items, offers) {
  try {
    const byOwner = {};
    items.forEach((item) => {
      if (item.source && item.source.owner)
        (byOwner[item.source.owner] = byOwner[item.source.owner] || []).push({ name: item.name, id: item.item_id, category: item.category });
    });
    const owners = Object.keys(byOwner);
    if (!owners.length) return offers;
    const fromNetworks = await require('../lib/network-offers').forStore(entity_id, owners, byOwner);
    return fromNetworks.length ? offers.concat(fromNetworks) : offers;
  } catch (e) {
    log.fellBack("till snapshot: the brand networks' offers were not read — the counter bills with the store's own offers only", e);
    return offers;
  }
}

/**
 * the answer. ⚠️ `at` is captured before the item SELECT ran (readAt, see snapshotAsk) — or, for a delta sent in parts, the last row it carries
 * (see DELTA_CAP). Never a fresh "now" taken after the read.
 */
function snapshotBody(snap) {
  const { asked, row, flags, till, sectors, shelf, liveCount, offers, reward, customers, suppliers, staff, particulars, catList, paged, network, holdsStock } =
    snap;
  const body = {
    at: paged.cursor || asked.readAt,
    more: paged.more,
    /* ⭐ the most items one answer carries — with `total` and `more` · `at` this is the snapshot's pager, said (docs/FIELDS.md) */
    limit: DELTA_CAP,
    /**
     * ⭐⭐ WHICH SHOP IS THIS, ANSWERED BY THE SERVER (2026-09-08). Athi: *"can we check is there any other user id sits in the
     * session layer, so we can open it correctly?"* A counter could not check, because nothing it held said whose shop it was —
     * the key is opaque and the name is only a name. Now the snapshot says, and the counter compares that against the shop it was
     * opened FOR. A mismatch is caught before a single line is billed, rather than found in the books afterwards.
     */
    entity_id: asked.entity_id,
    /* ⭐ which counter this key is, so the bill series is prefixed by something nobody types. A SUGGESTION:
       a counter that has already issued numbers keeps its own — see the note above claimedSeries. */
    till,
    shop: shopBlock(row, flags, particulars, holdsStock),
    items: paged.items,
    removed: paged.removed,
    delta: !!asked.since,
    since: asked.since || null,
    offers,
    staff,
    category_master: catList.map((item) => ({ id: item.id, name: item.name, status: item.status })),
    total: totalOf(liveCount, paged.items),
    network: { lines: paged.items.filter((item) => item.source).length, unpriced: network.unpriced },
    ...taxBlock(shelf),
    customers,
    suppliers,
    reward /* ⚠️ null is the ordinary case — most shops run no programme, and the counter shows nothing */,
    policy: policyBlock(row, flags),
    lot_fields: lotfields.forEntity(sectors)
  };
  return body;
}

/**
 * ⭐⭐⭐ THE CATEGORY MASTER, ON THE COUNTER ([TILL-114]) is `category_master`: id → name for the shop's own categories, so the
 * relation exists locally (own key `category_master`: `categories` is the TAX categories, docs/FIELDS.md) and mapping is not a problem with the line down.
 * ⚠️ Small by nature — a shop has categories in the tens, not the thousands — so it rides every snapshot rather than needing a door of its own.
 *
 * total: how many sellable products the shop has right now — the counter checks its merged copy against this (see liveCountRead).
 * ⚠️ INCLUDES THE NETWORK LINES, which ride on every read: the counter compares its merged copy against this, and a
 * total that left them out would make every refresh look wrong and pull the whole shop again, for ever.
 */
function totalOf(liveCount, items) {
  const live = liveCount && liveCount.rows && liveCount.rows[0] ? liveCount.rows[0].n : null;
  return live != null ? live + items.filter((item) => item.source).length : null;
}

/**
 * ⚠️⚠️ A MAP DOES NOT SURVIVE JSON, AND THAT IS WHY THE COUNTER HAD NO TAX (Athi, 2026-09-08: *"no, tax is not there"*).
 *
 * `taxShelf.readShelf()` returns `slabs` as a **Map** — every in-process caller (the chit send, catalogue-view) passes it
 * straight to taxSlab.resolve, which accepts a Map, so it has always been right for them. This route does not pass it to a
 * function; it puts it on the wire. `JSON.stringify(new Map())` is `{}` — so EVERY snapshot the till has ever taken carried
 * `slabs: {}`, no rate resolved on any product, and no GST appeared anywhere. Nothing threw. Nothing logged. The counter just
 * quietly billed without tax.
 *
 * ⚠️ The type was fine at every boundary except the one that serialises, which is exactly the kind of bug a type nobody
 * checks produces: correct in four call sites and silently empty in the fifth.
 */
function taxBlock(shelf) {
  return {
    slabs: shelf && shelf.slabs instanceof Map ? [...shelf.slabs.values()] : (shelf && shelf.slabs) || [],
    categories: (shelf && shelf.categories) || [] /* the TAX categories CBTax.slab.resolve reads */,
    face: (shelf && shelf.face) || {}
  };
}

/** the `shop` block of the snapshot: who the shop is, how it is registered, and how it is paid — in three runs of fields */
function shopBlock(row, flags, particulars, holdsStock) {
  const { party, gstin, country, stateSplit, shopMoney } = particulars;
  return {
    ...shopIdentity(party, row),
    ...shopAddressParts(party),
    ...shopRegistration(row, flags, gstin, stateSplit),
    /* ⭐ the jurisdiction, derived once and used by everything below — see lib/profile.countryOf */
    country,
    /* M127: does this shop hold stock? From its own data (holdsStockOf); null = unknown, shown as usual. The counter may override (till option stock). */
    holds_stock: holdsStock,
    ...shopMoneyBlock(row, country, shopMoney)
  };
}

/** name · legal_name · address · phone: what a bill header prints */
function shopIdentity(party, row) {
  return {
    name: party.trade_name || row.display_name || 'This shop',
    legal_name: party.legal_name || null,
    address: [party.address, party.city, party.state, party.pincode].filter(Boolean).join(', ') || null,
    phone: party.phone || null
  };
}

/**
 * ⭐ THE PARTS, BESIDE THE JOINED LINE ([TILL-105]). `address` above is what a bill header prints; these are
 * what POST /api/till/shop actually stores, so the counter's edit form can offer one box per stored field
 * instead of asking a shopkeeper to re-type a comma-separated line to fix a PIN code.
 * ⚠️ `email` is here to be SHOWN and edited into the vault — it is never the identities sign-in column,
 * which applyProfileMap refuses to touch for exactly the reason recorded there ([PRO-01]).
 * ⚠️ missing: WHAT IS STILL MISSING, decided by lib/profile rather than by the page — the counter shows the same
 * gaps the back office does, instead of holding a second opinion about what a complete shop is.
 */
function shopAddressParts(party) {
  return {
    street: party.address || null,
    city: party.city || null,
    state: party.state || null,
    pincode: party.pincode || null,
    email: party.email || null,
    missing: Array.isArray(party.missing) ? party.missing : []
  };
}

/**
 * ⚠️⚠️ ONE GSTIN, READ ONCE. These two lines disagreed: gstin fell back to the PROFILE, state_code did not. A shop
 * whose GSTIN is recorded in the profile rather than on the identity row therefore came through as registered — so
 * the counter charged GST — with no state code, so CBTax.supplyType answered 'unknown' and the tax could not be
 * split into CGST and SGST. A TAX INVOICE with a lumped GST line, from a shop that had filled the field in.
 * Athi hit exactly this the moment he added one: *"GSTN ref is there in the profile."*
 * ⚠️ The state code IS the first two digits of the GSTIN — so it must come from whichever GSTIN was actually used.
 *
 * ⭐⭐ `handle`: THE SHOP'S PUBLIC HANDLE, so the counter can show a shopkeeper their own storefront link.
 * Athi, 2026-09-27: *"also in the settings, profile, we have to bring the storefront URL."*
 * ⚠️ user_id IS the public handle and bridge_id is NOT — routes/catalogue.js settles it: *"THE PUBLIC
 * HANDLE IS user_id; bridge_id IS THE INTERNAL KEY"*, and every storefront link the app builds is
 * /shop.html?s=<user_id> (lib/raiseticket). Sending bridge_id here and letting the page build a link
 * from it would publish the internal key on a screen a shopkeeper is invited to share.
 * ⚠️ The counter BUILDS the link rather than being sent one, because the web host is something the
 * page already resolves (cbHome()) and the API does not know which front end asked.
 */
function shopRegistration(row, flags, gstin, stateSplit) {
  return {
    gstin: gstin,
    handle: row.user_id || null,
    state_code: String(gstin || '').slice(0, 2) && stateSplit ? String(gstin).slice(0, 2) : null /* CX0: only under a state-split pack (stateSplit above) */,
    reg_type: String(flags.gst_registration || 'regular')
  };
}

/**
 * ⭐⭐ THE WAYS THIS SHOP CAN BE PAID, decided by its COUNTRY and its declared payee addresses — not a
 * upi_id field, which is the India-shaped thing the jurisdiction work already ruled against.
 * ⚠️ It travels with the snapshot ON PURPOSE: a merchant-presented QR is made from a string with no network
 * involved, and a till that could not take a UPI payment exactly when the line was down would fail at the
 * worst possible moment.
 * ⚠️ Card and wallet carry qr:null and always will — Apple Pay and the like ride a card rail through an
 * acquirer, and there is nothing honest for us to generate.
 */
function shopMoneyBlock(row, country, shopMoney) {
  const cbProfile = require('../lib/profile');
  return {
    pay: cbProfile.payWays({ country, policy_flags: row.policy_flags }),
    currency: shopMoney,
    /* STD2: no money stated and no pack to read it from → the ONE sentence with its code; the counter paints it beside "Money is …" */
    money_why: shopMoney ? null : { code: 'NO_MONEY', why: countrySetup.MONEY_UNSTATED },
    /* STD2: the pack's word for the tax number (profile.taxIdWordOf — the ONE reader); null = no pack, the counter says "Tax number" */
    tax_id_word: cbProfile.taxIdWordOf(country),
    fy_start_month: countrySetup.fyStartOf(country) /* N4: the year roll-up passes the pack's own start month (null = unstated), never April */
  };
}

/** the `policy` block of the snapshot: what this shop's trade decided, once, for the counter and the door */
function policyBlock(row, flags) {
  return {
    books_at: flags.books_at || 'accepted',
    qty_zero_hides: flags.qty_zero_hides || 'off',
    /* ⭐ how much difference is not a dispute — set once by the trade, applied at the door (lib/lotfields) */
    price_includes_tax: policy.flagOf(row.policy_flags, 'price_includes_tax', row.country) /* TILL-B2: unset → the country's convention (US: excluded) */,
    /* ⭐ CAN THIS SERVER TRANSCRIBE? The counter picks a recogniser without a round trip to find out. */
    speech: speech.available() ? 'server' : 'browser',
    tolerance: {
      weight_bp: flags.tol_weight_bp == null ? 50 : Number(flags.tol_weight_bp),
      count_units: Number(flags.tol_count_units) || 0,
      rate_bp: Number(flags.tol_rate_bp) || 0
    }
  };
}

/**
 * ⭐⭐ EARLIER BILLS (2026-09-08). A device holds today; ChitBridge holds the history, because a till can be lost or replaced and a
 * shop's record must outlive it. This returns THIS shop's counter sales only — a chit that carries a bill number — newest first, with
 * their lines, so an old slip can be printed again from any till.
 *   GET /api/till/bills?days=30&by=<actor_id>&limit=100
 * ⚠️ It reads nothing else. A till key cannot open the inbox, a supplier's chit or anybody's messages, and this route keeps that true:
 * the WHERE clause is the shop, the purpose, and the presence of a bill number.
 */
/**
 * ⭐⭐⭐ TWO THINGS A SHOPKEEPER DOES ON THEIR FEET — POST /api/till/stock and POST /api/till/price.
 *
 * Athi, 2026-09-09: *"do the stock out and price change counters."* Both pass the backlog's test — name the moment when somebody
 * is STANDING UP, or it does not deserve a counter:
 *   · stock out    — you notice an empty shelf while serving, and the next customer must not be offered it
 *   · price change — a supplier's new rate, called across the shop, and the very next bill must use it
 * Neither is worth walking to a desk for, and both are wrong the moment they are delayed.
 *
 * ⚠️ TWO NARROW ROUTES, NOT A PRODUCT PATCH. The obvious shortcut is to let a till key PATCH /api/products/:id — which would hand
 * every counter in the shop the power to rewrite any field of any product: rename it, re-slab it, change its HSN. A till is often
 * on a shared PC in a public part of the shop. So a till key can change exactly two things, each by its own route, each recording
 * who and when. Same reasoning as /api/till/alias, which was the narrowest write a counter already had.
 *
 * ⚠️ THE STAMP IS THE CATALOGUE'S OWN (itemstatus.stamp), so a status set at the counter is indistinguishable in shape from one
 * set on the product page — one status model, not a counter dialect of it.
 */
router.post('/stock', auth, auth.requireScope('till'), ...checked('POST /stock'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const input = stockInput(req.body);
    if (!input.item_id) return refuseBad(req, res, 'item_id required');
    /* ⚠️ available and unavailable ONLY. 'retired' and 'redundant' carry an argument — what replaced it, until when — and nobody
       makes that call standing at a till with a customer waiting. The same two the bulk screen offers, for the same reason. */
    if (COUNTER_STATUSES.indexOf(input.status) < 0) return refuseBad(req, res, "status must be 'available' or 'unavailable'");
    const stamp = itemstatus.stamp({ status: input.status, until: input.until, note: input.note }, { actor_name: input.by });
    const saved = await withEntity(entity_id, (db) =>
      catwrite.patchItems(db, entity_id, [{ item_id: input.item_id, merge: stamp }], { returning: 'item_id, item_data' })
    );
    if (!saved.rows.length) return problem(req, res, { status: 404, ...notFound() });
    shopChanged(entity_id, 'stock ' + input.status);
    const data = saved.rows[0].item_data || {};
    res.json({ ok: true, item_id: input.item_id, name: data.name || null, status: input.status });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** the statuses a person may set standing at a counter */
const COUNTER_STATUSES = ['available', 'unavailable'];

/** POST /stock input: the product, the status (lower-cased), and the optional until · note · who */
function stockInput(body) {
  const given = body || {};
  return {
    item_id: String(given.item_id || ''),
    status: String(given.status || '').toLowerCase(),
    until: given.until || undefined,
    note: given.note || undefined,
    by: given.by || 'the counter'
  };
}

/**
 * ── ⭐⭐⭐ THE SAME DECISION, ABOUT MANY PRODUCTS AT ONCE (2026-09-27) ──────────────────────────────────────
 *
 * Athi: *"yes please, that can be done in the maintenance screen."* — asked after the day-one walk showed the
 * real friction: Product Lab adopts products OFF the shelf on purpose (tax and offers come first), so a shop
 * that took a 22-product shelf then had to open 22 cards before it could sell anything. Adopting got fast and
 * the step after it did not.
 *
 * ⚠️⚠️ THIS IS NOT NEW AUTHORITY, WHICH IS THE ONLY REASON IT BELONGS ON A COUNTER KEY. /stock above already
 * lets a counter set availability — one product at a time, for as many products as it likes. Batching that is
 * the SAME permission with fewer round trips, unlike a tax slab or a new product, which are refused here for
 * exactly the reason this one is allowed. [[TILL_SHOP_REFUSED]]
 *
 * ⚠️ available and unavailable ONLY, the same two /stock offers and for the same reason: retired and redundant
 * carry a per-item argument nobody supplies standing at a till.
 * ⚠️ ONE STATEMENT, ONE STAMP. Every row in a bulk change genuinely was one decision by one person at one
 * moment, so sharing the stamp is the honest record — the same reasoning POST /api/products/status/bulk gives.
 * ⚠️ AND IT SAYS HOW MANY IT ACTUALLY MOVED, not how many were asked for. An id that is not this shop's is
 * silently no row updated; reporting the request back as success is how a shopkeeper believes a shelf is live
 * when it is not. [[feedback-silence-is-the-bug]]
 */
const STOCK_BULK_MAX = 500;
router.post('/stock/bulk', auth, auth.requireScope('till'), ...checked('POST /stock/bulk'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const input = stockBulkInput(req.body);
    if (!input.ids.length) return refuseBad(req, res, 'item_ids required');
    if (input.ids.length > STOCK_BULK_MAX) {
      return problem(req, res, { status: 400, ...said('TILL_BAD_REQUEST', 'Too many', 'At most ' + STOCK_BULK_MAX + ' products in one change.') });
    }
    if (COUNTER_STATUSES.indexOf(input.status) < 0) return refuseBad(req, res, "status must be 'available' or 'unavailable'");

    const stamp = itemstatus.stamp({ status: input.status, note: input.note }, { actor_name: input.by });
    const saved = await withEntity(entity_id, (db) => catwrite.patchItems(db, entity_id, { ids: input.ids, merge: stamp }));

    shopChanged(entity_id, 'stock ' + input.status + ' ×' + saved.rows.length);
    res.json({
      ok: true,
      moved: saved.rows.length,
      asked: input.ids.length,
      status: input.status,
      message: bulkMessage(saved.rows.length, input.ids.length, input.status)
    });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** POST /stock/bulk input: the product ids (text, blanks dropped), the status (lower-cased), the optional note · who */
function stockBulkInput(body) {
  const given = objectOr(body);
  const ids = Array.isArray(given.item_ids) ? given.item_ids.map((entry) => String(entry || '')).filter(Boolean) : [];
  return { ids, status: String(given.status || '').toLowerCase(), note: given.note || undefined, by: given.by || 'the counter' };
}

/** "3 products put on the shelf · 1 could not be found." — how many actually moved, and how many were not found */
function bulkMessage(moved, asked, status) {
  return (
    moved +
    ' product' +
    (moved === 1 ? '' : 's') +
    (status === 'available' ? ' put on the shelf' : ' taken off the shelf') +
    (moved < asked ? ' · ' + (asked - moved) + ' could not be found' : '') +
    '.'
  );
}

/**
 * ⭐⭐ THE SMALL DECISIONS A SHOPKEEPER MAKES ABOUT ONE PRODUCT. Athi, 2026-09-09: *"the catalogue management, minimal stuff —
 * changing availability, product price, offer enable/disable, show on TV — all can be kept in the same place."*
 *
 * Two of those four already had a route (/stock and /price). These are the other two, and they are deliberately as narrow:
 *   { item_id, screen: true|false }              — put this product on the shop screen, or take it off
 *   { item_id, offer_id, excluded: true|false }  — take this product OUT of one offer, or put it back in
 *
 * ⚠️ STILL NOT A PRODUCT PATCH. A key scoped to a till may set the handful of flags a person standing at a counter is
 * entitled to decide. It may not rename a product, move its category or edit its tax — those are catalogue decisions with
 * consequences a till cannot see, and the blast radius of a stolen counter key is exactly the list above.
 * ⚠️ ONE ROUND TRIP. The exclusion list is rebuilt in SQL rather than read-then-written: the same jsonb both removes the id and
 * re-adds it, so the operation is idempotent in both directions and cannot double an entry (Mumbai is a long way from sfo).
 */
/**
 * ── ⭐⭐⭐ POST /api/till/diagnostic — A COUNTER THAT CANNOT BE REACHED SAYS SO ITSELF ─────────────────────────
 *
 * Athi, 2026-09-16: *"is there any way of interacting with the counter app where it creates the issue, diagnostic
 * message thrown to server?"* This is that. The counter posts what its own 🩺 panel is showing and it lands on the
 * key record, which is the counter's identity here and already appears on a screen the shop can open.
 *
 * ⚠️⚠️ THE FAILURE IT REPORTS MAY BE THE REASON IT CANNOT REPORT. A counter with no key, no line, or a wedged
 * store posts nothing — so this is never the only route out. The counter can always copy or save the same report
 * as text, and that path needs nothing from us at all. Do not let this endpoint's existence retire that one.
 *
 * ⚠️ IT ACCEPTS FACTS, NOT PROSE. Counts, flags, reasons and bill numbers — capped, and never a customer name, a
 * phone number or a line item, because a shop's sales are not ours to collect on a support call.
 */
router.post('/diagnostic', auth, auth.requireScope('till'), ...checked('POST /diagnostic'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const keyId = req.till && req.till.key && req.till.key.jti;
    if (!keyId) return refuseBad(req, res, 'Only a paired counter can report itself.');
    const diag = await require('../lib/api-keys').setDiag(entity_id, keyId, diagnosticPatch(req));
    if (!diag) return problem(req, res, { status: 404, ...notFound('This key is not listed for the shop.') });
    res.json({ ok: true, code: diag.code, at: diag.at });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** a number from the counter's report, kept between zero and a cap */
const cappedNumber = (value, limit) => Math.max(0, Math.min(Number(value) || 0, limit || 100000));
/** a word from the counter's report, cut to length (null when it sent none) */
const cappedText = (value, length) => (value == null ? null : String(value).slice(0, length || 200));

/** what the counter's report keeps on its key record: counts, flags and reasons — capped, and the ip and agent the counter cannot know about itself */
function diagnosticPatch(req) {
  const given = req.body || {};
  return {
    code: cappedText(given.code, 12),
    verdict: cappedText(given.verdict, 400),
    till_id: cappedText(given.till_id, 16),
    online: given.online === true,
    storage: given.storage === true,
    queued: cappedNumber(given.queued, 100000),
    foreign: cappedNumber(given.foreign, 100000),
    bills: cappedNumber(given.bills, 1000000),
    last_why: cappedText(given.last_why, 300),
    /* ⚠️ bill NUMBERS only — they are the shop's own reference and the thing a support call is about */
    waiting: (Array.isArray(given.waiting) ? given.waiting : [])
      .slice(0, 20)
      .map((item) => ({ no: cappedText(item && item.no, 32), tries: cappedNumber(item && item.tries, 9999), why: cappedText(item && item.why, 200) })),
    /* ⭐ recorded because it is the one fact the counter cannot know about itself, and the shop may need it */
    ip:
      String(req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0] || '')
        .trim()
        .slice(0, 45) || null,
    agent: cappedText(req.headers['user-agent'], 160)
  };
}

/** this key's own row in the shop's key list (undefined when it is not listed) */
async function keyRowOf(entity_id, keyId) {
  const list = await keys.listOf(entity_id);
  return list.find((item) => item && String(item.jti) === String(keyId));
}

/** the counter record of a shop, locked for this transaction: policy_flags.counters[counterId] (undefined when there is none) */
async function lockedCounter(db, entity_id, counterId) {
  const locked = await db.query(`SELECT policy_flags->'counters'->$2 AS c FROM identities WHERE identity_id = $1 FOR UPDATE`, [entity_id, counterId]);
  return locked.rows[0] && locked.rows[0].c;
}

/**
 * ── ⭐⭐⭐ POST /api/till/close — A COUNTER FINISHES, AND SAYS SO ────────────────────────────────────────────────
 *
 * Athi, 2026-09-17: *"is there a way of closing the counter from the office PC and creating a new counter?"* and
 * *"it has to be online to create a counter."* Closing is the other half of that: it happens online, deliberately,
 * and only after the counter has proved every bill reached the books (the counter enforces that before it calls).
 *
 * ⚠️ CLOSED, NOT DELETED. The key is marked closed and stops working at once, but the record stays: which prefix
 * this counter numbered under, until when, from where. A GST series that ended must still be explainable later,
 * and a deleted key takes that explanation with it. Its prefix stays reserved for ever (claimTill never reissues a
 * prefix with bills in the books), so the next counter starts a new series.
 * ⚠️ A TILL KEY MAY CLOSE ONLY ITSELF. Keys still cannot manage keys; ending your own is the one exception, and it
 * can only ever make a leaked key less useful.
 */
router.post('/close', auth, auth.requireScope('till'), ...checked('POST /close'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const keyId = req.till && req.till.key && req.till.key.jti;
    if (!keyId) return refuseBad(req, res, 'Only a paired counter can close itself.');
    const body = req.body || {};
    const mine = await keyRowOf(entity_id, keyId);
    if (!mine) return problem(req, res, { status: 404, ...notFound('This counter is not listed for the shop.') });
    const till = closedTill(mine, req, body);
    await keys.patchTill(entity_id, keyId, till);
    auth.forgetKey(keyId); /* ⚠️ the auth cache would otherwise honour it for another minute */
    if (mine.counter) await letCounterGo(entity_id, String(mine.counter).toUpperCase(), keyId, till, body);
    res.json({ ok: true, closed_at: till.closed_at, prefix: till.id || null });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** the key's till record, closed: when and from where, the last bill number, how many bills, and where the run stopped */
function closedTill(mine, req, body) {
  return Object.assign({}, mine.till || {}, {
    closed_at: new Date().toISOString(),
    closed_ip: String(req.ip || '').slice(0, 45) || null,
    last_no: body.last_no ? String(body.last_no).slice(0, 32) : null,
    bills: Math.max(0, Math.min(Number(body.bills) || 0, 1000000)),
    /* ⭐ where this counter's run stopped — what a REOPEN on another PC would have to continue from, and the
       thing that makes reopening safe at all: the close has already proved nothing unsent is left behind */
    next: Number(body.next) > 0 ? Math.min(Number(body.next), 1000000) : null
  });
}

/**
 * ⭐⭐ A NAMED COUNTER IS LET GO, NOT ENDED. Its record keeps where the run stopped, so it can be opened again —
 * on this PC or another — and continue. Only if THIS key still holds it; a counter already released or
 * reopened elsewhere is left exactly as it is.
 */
async function letCounterGo(entity_id, counterId, keyId, till, body) {
  await require('../db').withTransaction(async (db) => {
    const counter = await lockedCounter(db, entity_id, counterId);
    if (!counter) return;
    await require('../lib/counters-store').patchCounter(db, entity_id, counterId, counterReleasePatch(counter, keyId, till, body));
  });
}

/** what closing writes on the counter's record: when it closed, the last number, whether this key still held it, and where its series continues */
function counterReleasePatch(counter, keyId, till, body) {
  const patch = { closed_at: till.closed_at, last_no: till.last_no || counter.last_no || null };
  if (String(counter.held_by || '') === String(keyId))
    Object.assign(patch, { held_by: null, held_at: null, status: null, status_since: null, status_by: null });
  return Object.assign(patch, seriesContinues(counter, till, body.period != null ? String(body.period) : null));
}

/** where the counter's series continues once it is let go: the next number (and the period it belongs to), or nothing to record */
function seriesContinues(counter, till, period) {
  if (till.next && (counter.period == null || counter.period === period)) {
    return period != null ? { next: Math.max(Number(counter.next) || 1, till.next), period } : { next: Math.max(Number(counter.next) || 1, till.next) };
  }
  return till.next && period != null ? { next: till.next, period } : {};
}

/**
 * ⭐⭐ POST /api/till/state — ON BREAK, OR BILLING (Athi, 2026-09-17: *"closing a counter need not be closing the sale
 * for the day — they can go for a break also"*). A break does NOT release the counter: this PC keeps it, so no other PC
 * can take the series while unsent bills may still be here. This only tells the shop's Counters screen what it would
 * see if it walked over. Best effort — a break never waits for the line.
 */
router.post('/state', auth, auth.requireScope('till'), ...checked('POST /state'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const keyId = req.till && req.till.key && req.till.key.jti;
    const body = req.body || {};
    const state = body.state === 'break' ? 'break' : 'billing';
    const mine = await keyRowOf(entity_id, keyId);
    if (!mine || !mine.counter) return res.json({ ok: true, recorded: false });
    await recordCounterState(entity_id, String(mine.counter).toUpperCase(), keyId, state, body);
    res.json({ ok: true, recorded: true, state });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** write the break/billing state on the counter record, only if this key holds the counter */
async function recordCounterState(entity_id, counterId, keyId, state, body) {
  await require('../db').withTransaction(async (db) => {
    const counter = await lockedCounter(db, entity_id, counterId);
    /* ⚠️ only the PC that holds the counter may say what it is doing */
    if (!counter || String(counter.held_by || '') !== String(keyId)) return;
    await require('../lib/counters-store').patchCounter(db, entity_id, counterId, {
      status: state,
      status_since: state === 'break' ? (body.since ? String(body.since).slice(0, 40) : new Date().toISOString()) : null,
      status_by: state === 'break' ? (body.by ? String(body.by).slice(0, 80) : null) : null
    });
  });
}

router.post('/flags', auth, auth.requireScope('till'), ...checked('POST /flags'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const body = req.body || {};
    const item_id = String(body.item_id || '');
    if (!item_id) return refuseBad(req, res, 'item_id required');
    const offerOptOut = body.offer_id != null;
    if (!offerOptOut && body.screen === undefined) return refuseBad(req, res, 'nothing to set — pass screen, or offer_id with excluded');

    const saved = await withEntity(entity_id, (db) =>
      offerOptOut ? setOfferOptOut(db, entity_id, item_id, body) : setScreenPick(db, entity_id, item_id, body)
    );
    if (!saved.rows.length) return problem(req, res, { status: 404, ...notFound() });
    /* ⭐ the shop screen and every open counter hear about it on the same bell a price change rides */
    shopChanged(entity_id, offerOptOut ? 'offer opt-out' : 'screen pick');
    res.json(flagsAnswer(item_id, saved.rows[0].item_data || {}));
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** put the product on the shop screen, or take it off */
function setScreenPick(db, entity_id, item_id, body) {
  return catwrite.patchItems(db, entity_id, [{ item_id, merge: { screen: body.screen === true || body.screen === 'true' } }], {
    returning: 'item_id, item_data'
  });
}

/** the product's flags as the counter hears them: its name, the offers it opted out of, and whether it is on the shop screen */
function flagsAnswer(item_id, data) {
  return {
    ok: true,
    item_id,
    name: data.name || null,
    offers_excluded: Array.isArray(data.offers_excluded) ? data.offers_excluded : [],
    screen: data.screen === true
  };
}

/**
 * the opt-out list, minus this offer, plus it again when excluded — read FOR UPDATE so two counters toggling at once
 * both land, then written by the one product writer (CAT-W1; the SQL that did both in one statement kept a [null]).
 * → the writer's answer, or { rows: [] } when the product is not this shop's
 */
async function setOfferOptOut(db, entity_id, item_id, body) {
  const offer_id = String(body.offer_id);
  const excluded = body.excluded === true || body.excluded === 'true';
  const current = await db.query('SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND item_id = $2 FOR UPDATE', [entity_id, item_id]);
  if (!current.rows.length) return { rows: [] };
  const previous = (current.rows[0].item_data || {}).offers_excluded;
  const kept = (Array.isArray(previous) ? previous : [])
    .filter((entry) => entry != null)
    .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
    .filter((entry) => entry !== offer_id);
  return catwrite.patchItems(db, entity_id, [{ item_id, merge: { offers_excluded: excluded ? kept.concat([offer_id]) : kept } }], {
    returning: 'item_id, item_data'
  });
}

/**
 * ⭐⭐ QUICK KEYS, LEVEL 2 — WHAT THIS COUNTER IS SHOWING RIGHT NOW (b262, 2026-09-18, migrations/b262_quick_key_groups.sql).
 *
 * Level 1 (the groups themselves, /api/quick-keys) is back-office. This is the counter's own view of them: which
 * groups it has active, and which items it has personally marked sold out — the server-side counterpart to
 * till.html's existing local quickSoldOut()/bizDay() ([TILL-28]), which already does this entirely offline in
 * localStorage. That local mechanism is NOT replaced — these routes exist so a hide can also reach OTHER counters
 * when a person chooses to (decision 3, 2026-09-18: ask, don't auto-push), which a browser cannot do on its own.
 *
 * ⚠️ business_date is whatever the CALLER's own bizDay() computed — the server does not recompute "today" itself,
 * so there is one definition of a counter's business day, not two that can drift apart.
 *
 * counterOfReq(req) → the counter id this key holds (upper-cased), or null.
 */
async function counterOfReq(req) {
  const keyId = req.till && req.till.key && req.till.key.jti;
  if (!keyId) return null;
  const mine = await keyRowOf(auth.entityOf(req), keyId);
  return mine && mine.counter ? String(mine.counter).toUpperCase() : null;
}
const quickKeys = require('../lib/quick-keys');

/**
 * ⭐ the shop's other counters, id+name only (decision 3's "also mark sold out on...?" prompt) — see counters.js's listNarrow.
 *
 * ⚠️ IT ALSO ANSWERS "WHICH ONE AM I", AND THAT IS NOT A CONVENIENCE. The page cannot tell: `cb_till_id` is
 * empty on a counter paired by key (found 2026-09-18, walking a two-counter hotel through the prompt — it
 * offered "Front desk, Take-away" to the person standing at Front desk). The key knows, because the register
 * binds it; so the server says, and the page filters on `me` rather than guessing at its own name.
 */
router.get('/counters', auth, auth.requireScope('till'), ...checked('GET /counters'), async (req, res) => {
  try {
    const counters = await require('./counters').listNarrow(auth.entityOf(req));
    res.json({ counters, me: await counterOfReq(req) });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.get('/quick-keys/groups', auth, auth.requireScope('till'), ...checked('GET /quick-keys/groups'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const groups = await withEntity(entity_id, (db) => quickKeys.listGroups(db, entity_id));
    res.json({ groups });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.get('/quick-keys/state', auth, auth.requireScope('till'), ...checked('GET /quick-keys/state'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const counter_id = await counterOfReq(req);
    if (!counter_id) return refuseNoCounter(req, res);
    const business_date = String(req.query.business_date || '').trim();
    if (!business_date) return refuseBad(req, res, 'business_date required');
    const state = await withEntity(entity_id, (db) => quickKeys.getActiveGroups(db, entity_id, counter_id, business_date));
    res.json({ active_group_ids: state.active_group_ids, shift_id: state.shift_id, updated_at: state.updated_at }); /* API-8: the three columns getActiveGroups selects (or its empty default) */
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.post('/quick-keys/state', auth, auth.requireScope('till'), ...checked('POST /quick-keys/state'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const counter_id = await counterOfReq(req);
    if (!counter_id) return refuseNoCounter(req, res);
    const body = req.body || {};
    if (!body.business_date) return refuseBad(req, res, 'business_date required');
    const state = await withEntity(entity_id, (db) =>
      quickKeys.setActiveGroups(db, entity_id, counter_id, body.business_date, body.shift_id, body.active_group_ids)
    );
    res.json({ entity_id: state.entity_id, counter_id: state.counter_id, business_date: state.business_date, shift_id: state.shift_id, active_group_ids: state.active_group_ids, updated_at: state.updated_at }); /* API-8: the row setActiveGroups returns (RETURNING *), in table order */
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.get('/quick-keys/hidden', auth, auth.requireScope('till'), ...checked('GET /quick-keys/hidden'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const counter_id = await counterOfReq(req);
    /* M130: a shop login holds no counter, so it has nothing hidden: an empty list, never a 403 on a normal load */
    if (!counter_id) return res.json({ hidden: [] });
    const hidden = await withEntity(entity_id, (db) => quickKeys.listHidden(db, entity_id, counter_id));
    res.json({ hidden });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/* ⚠️ IDEMPOTENT ON PURPOSE — a queued offline write can replay, and re-hiding an already-hidden item must be a
   no-op, never a conflict. also_counters (decision 3): the OTHER counters a person chose in the "also mark sold
   out on...?" prompt; this counter itself is always included. */
router.post('/quick-keys/hide', auth, auth.requireScope('till'), ...checked('POST /quick-keys/hide'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const counter_id = await counterOfReq(req);
    if (!counter_id) return refuseNoCounter(req, res);
    const body = req.body || {};
    if (!body.product_id) return refuseBad(req, res, 'product_id required');
    const rows = await withEntity(entity_id, (db) =>
      quickKeys.hideItem(db, entity_id, counter_id, body.product_id, body.shift_id, body.by || null, body.also_counters)
    );
    res.json({ hidden: rows });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.post('/quick-keys/unhide', auth, auth.requireScope('till'), ...checked('POST /quick-keys/unhide'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const counter_id = await counterOfReq(req);
    if (!counter_id) return refuseNoCounter(req, res);
    const body = req.body || {};
    if (!body.product_id) return refuseBad(req, res, 'product_id required');
    const restored = await withEntity(entity_id, (db) => quickKeys.unhideItem(db, entity_id, counter_id, body.product_id, body.also_counters));
    res.json({ removed: restored.removed });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.get('/quick-keys/screen-config', auth, auth.requireScope('till'), ...checked('GET /quick-keys/screen-config'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const counter_id = await counterOfReq(req);
    const config = await withEntity(entity_id, (db) => quickKeys.getScreenConfig(db, entity_id, counter_id));
    res.json({ config: config.config, updated_at: config.updated_at }); /* S34: the row's two columns, named (lib/quick-keys getScreenConfig reads only these) */
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.post('/quick-keys/screen-config', auth, auth.requireScope('till'), ...checked('POST /quick-keys/screen-config'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const counter_id = await counterOfReq(req);
    if (!counter_id) return refuseNoCounter(req, res);
    const config = await withEntity(entity_id, (db) => quickKeys.setScreenConfig(db, entity_id, counter_id, (req.body || {}).config, null));
    res.json({ id: config.id, entity_id: config.entity_id, counter_id: config.counter_id, config: config.config, updated_by: config.updated_by, updated_at: config.updated_at }); /* API-8: the row setScreenConfig returns (RETURNING *), in table order */
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * ⭐⭐ TURN A DECLARED OFFER ON OR OFF FOR ONE PRODUCT. Athi, 2026-09-09: *"no new offers can be created; an already
 * existing offer can be made obsolete for the product … you already have multiple offers listed, which you want to
 * turn on."* His example is the whole point: *"a lot of tomato is being sold but potato is not moving — turn on the
 * potato tied with tomato and push potato as well."* That decision is made at the counter, looking at the shelf, and
 * it is worth nothing an hour later in an office.
 *
 * ⚠️⚠️ THIS WRITES TO A GOVERNED OBJECT, which nothing else a till key can reach does. Three things keep it honest:
 *
 *  1. IT CAN ONLY MOVE ONE PRODUCT IN OR OUT OF ONE EXISTING LIVE OFFER. It cannot create an offer, retire one,
 *     rename it, change its discount, its dates, its customer group or any other rule. The new rules object is
 *     built from the old one with ONE key touched — applies_to.item_ids — so there is no shape in which a counter
 *     key edits what an offer is worth. That is the boundary Athi drew himself: "only the declared offer".
 *  2. IT APPENDS A VERSION, it does not edit one. definition_version is append-only BY GRANT (no UPDATE, no DELETE
 *     for cb_app), so this is not a convention that can be forgotten — and the note records the counter and the
 *     person, which is better provenance than the lab records for the same edit.
 *  3. LIVE OFFERS ONLY. A draft or retired offer is not something a shopkeeper can be looking at on a shelf.
 *
 * ⚠️ THE ENGINE ALREADY UNDERSTANDS THIS and no engine code changes: lib/offers-engine.js treats item_ids, skus and
 * categories as a UNION — "an offer ticked on a product reaches the product even when it sits elsewhere".
 */
/**
 * ⭐⭐ WHAT IS WORTH AN OFFER TODAY. Athi, 2026-09-09: *"if the till knows expiry-nearing product, that can be made
 * an offer … it depends on the type of business — if it is perishable, the offer has to be turned on quicker."* And
 * before that: *"a lot of tomato is being sold, but potato is not moving much."*
 *
 * Two signals, both read from what the shop has ALREADY recorded — nothing new is asked of anybody:
 *
 *  1. SHELF LIFE. lib/lotfields is explicit that an expiry belongs to a BATCH, not a product: *"one product has many
 *     batches, each with its own expiry, and confusing the two is the single most common way a small ERP paints
 *     itself into a corner — it puts expiry on the product and then cannot answer which of these do I sell first."*
 *     So this reads the RECEIVE chits, where the batch was recorded at the door, and reports the nearest expiry per
 *     product. A product received three times has three batches and it is the earliest that decides.
 *  2. NOT MOVING. Days since the product was last on a bill, from the shop's own sales. No stock ledger is needed
 *     and none is claimed — "not sold for 9 days" is a fact; "14 kg unsold" would be a guess.
 *
 * ⚠️ IT REPORTS, IT NEVER ACTS. Turning an offer on is a merchandising decision with a discount attached, and the
 * tap stays the shopkeeper's. Every row carries its REASON, because a suggestion nobody can argue with is one
 * nobody will keep reading.
 * ⚠️ AND IT NEVER INVENTS AN URGENCY. "Soon" is not one number — milk is hours, biscuits are weeks — so the caller
 * passes the window and the counter takes it from the shop's own sector, the same place lotfields reads.
 */
router.get('/worth-an-offer', auth, auth.requireScope('till'), ...checked('GET /worth-an-offer'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const days = Math.max(1, Math.min(180, Number(req.query.days) || 14));
    const quiet = Math.max(1, Math.min(365, Number(req.query.quiet) || 14));
    const found = await withEntity(entity_id, (db) => db.query(WORTH_AN_OFFER_SQL, [entity_id]));
    const suggestions = offerSuggestions(found.rows, days, quiet);
    res.json({
      ok: true,
      days,
      quiet,
      items: suggestions.slice(0, 60),
      /* ⚠️ said out loud: this is what the shop RECORDED, not a stock count nobody has taken */
      basis: 'expiry recorded at goods-in, and the last time each product was on a bill'
    });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * the products a shop recorded, with their nearest expiry and the last time each was on a bill — chit history read through the shelf.
 * ⚠️ NO BACKTICKS IN THE COMMENTS INSIDE: it lives inside a template literal, and the first pair of them ended
 * the SQL string and broke the file. Caught by node --check within the minute.
 */
const WORTH_AN_OFFER_SQL = `WITH lines AS (
         SELECT h.chit_id, h.created_at, h.direction, h.business_json, l AS line
           FROM chit_header h
           JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.line_items, '[]'::jsonb)) AS l
          WHERE h.entity_id = $1 AND h.created_at > now() - interval '400 days')
       SELECT
         /**
          * ⚠️⚠️ THE TWO LINE SHAPES ARE NOT THE SAME, and assuming one is why this found nothing on its first run.
          * A BILL line puts item_id at the top: { particulars, quantity, unit, price, total, item_id }
          * A GOODS-IN line nests it with the batch: { particulars, …, item_data: { item_id, lot: { batch, expiry } } }
          * Both are correct — a goods-in carries per-consignment facts a sale has no use for — so the query reads
          * either, rather than the chit writers being bent to match a report.
          */
         COALESCE(line->>'item_id', line#>>'{item_data,item_id}') AS item_id,
         MAX(line->>'particulars') AS name,
         /* the earliest expiry recorded for this product at ANY door it came in through */
         MIN(NULLIF(line#>>'{item_data,lot,expiry}', '')) AS expiry,
         /**
          * the last time it was SOLD. A till bill is a SELF chit, so direction cannot be the test — business_json.slip
          * is written only by a bill (cash · tax · supply) and business_json.doc only by a GRN or a delivery note.
          */
         MAX(created_at) FILTER (WHERE business_json ? 'slip') AS last_sold
       FROM lines
       WHERE COALESCE(line->>'item_id', line#>>'{item_data,item_id}') IS NOT NULL
         /**
          * ── ⚠️⚠️ ONLY PRODUCTS THIS SHOP ACTUALLY SELLS ───────────────────────────────────────────────────
          *
          * Athi, observation 6, division H: *"I guess this is one of the test shops I tried that is getting
          * loaded… this should bring only the items which are rightfully access to the shop."*
          *
          * ⚠️ NOTHING WAS LEAKING — every chit read here is this entity's own, and it always was. The trap is
          * subtler: a chit RECEIVED from somebody else carries THEIR line items. "Order from Chola Auto Care"
          * put Grapes, OIL, Onion and Test Tax Product into tallytest's own chit history, and this report read
          * the history rather than the shelf. Seven of the seventeen products it found were never on sale here.
          *
          * ⭐⭐ AND IT WAS NOT ONLY UNTIDY, IT BROKE THE PANEL. Tapping one set CARD_ID to a product the till
          * cannot find on its own shelf, so the maintenance card resolved to null and the right-hand side went
          * blank — which is the second half of the same observation, from the same cause.
          * ⚠️ NO BACKTICKS IN THIS COMMENT: it lives inside a template literal, and the first pair of them ended
          * the SQL string and broke the file. Caught by node --check within the minute.
          *
          * ⭐ So the shelf is the authority for WHAT MAY BE SUGGESTED, and the chit history only for WHEN it
          * last sold. A product the shop does not carry cannot be worth an offer here.
          */
         AND EXISTS (SELECT 1 FROM catalogue_items ci
                      WHERE ci.entity_id = $1 AND ci.is_active = true
                        AND ci.item_id::text = COALESCE(line->>'item_id', line#>>'{item_data,item_id}'))
       GROUP BY 1`;

/** whole days from today to a date (negative = in the past) */
const dayOf = (date, today) => Math.floor((new Date(date) - today) / 86400000);
/* ⚠️ "expires in 1 days" is the kind of thing that makes a shopkeeper stop trusting the rest of the sentence */
const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');

/** the products worth an offer, most urgent first: each with its reasons in words and a weight */
function offerSuggestions(rows, days, quiet) {
  const today = new Date();
  const out = [];
  for (const row of rows) {
    const notes = [expiryNote(row, days, today), quietNote(row, quiet, today)].filter(Boolean);
    if (!notes.length) continue;
    let urgency = 0;
    notes.forEach((note) => {
      urgency += note.urgency;
    });
    out.push({
      item_id: row.item_id,
      name: row.name,
      expiry: row.expiry || null,
      last_sold: row.last_sold || null,
      why: notes.map((note) => note.words),
      urgency: Math.round(urgency)
    });
  }
  return out.sort((first, second) => second.urgency - first.urgency);
}

/** how near the expiry is, in words and weight; null when there is none or it is not within the window */
function expiryNote(row, days, today) {
  if (!row.expiry) return null;
  const left = dayOf(row.expiry, today);
  if (!(left <= days)) return null;
  return { words: expiryWords(left), urgency: days - left + (left < 0 ? 100 : 0) };
}

/** "expired 3 days ago" · "expires today" · "expires tomorrow" · "expires in 5 days" */
function expiryWords(left) {
  if (left < 0) return 'expired ' + plural(Math.abs(left), 'day') + ' ago';
  if (left === 0) return 'expires today';
  return left === 1 ? 'expires tomorrow' : 'expires in ' + plural(left, 'day');
}

/** how long since it was last on a bill, in words and weight; null when it moved within the quiet window */
function quietNote(row, quiet, today) {
  if (!row.last_sold) return { words: 'never sold here', urgency: 10 };
  const since = Math.abs(dayOf(row.last_sold, today));
  if (!(since >= quiet)) return null;
  return { words: 'not sold for ' + since + ' day' + (since === 1 ? '' : 's'), urgency: Math.min(since, 90) / 3 };
}

router.post('/offer-item', auth, auth.requireScope('till'), ...checked('POST /offer-item'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const input = offerItemInput(req.body);
    if (!input.offer_id || !input.item_id) return refuseBad(req, res, 'offer_id and item_id required');

    const done = await withEntity(entity_id, (db) => moveOfferItem(db, entity_id, input, req.identity && req.identity.identity_id));

    if (done.missing) return problem(req, res, { status: 404, ...notFound() });
    if (done.refused) return refuseBad(req, res, done.refused);
    shopChanged(entity_id, 'offer ' + (input.on ? 'added to' : 'removed from') + ' a product');
    /* API-8: the two answers of the library step, named where they are used: unchanged (nothing to write) or version (a new version written) */
    res.json(Object.assign({ ok: true, offer_id: input.offer_id, item_id: input.item_id, on: input.on }, done.unchanged ? { unchanged: done.unchanged, name: done.name } : { name: done.name, version: done.version }));
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** POST /offer-item input: the offer, the product, whether it goes in (on) or out, and who said so */
function offerItemInput(body) {
  const given = body || {};
  return { offer_id: String(given.offer_id || ''), item_id: String(given.item_id || ''), on: given.on === true || given.on === 'true', by: given.by };
}

/**
 * read the live offer, and append a version of it with this product moved in or out of applies_to.item_ids.
 * → { missing } | { refused } | { ok, unchanged, name } | { ok, name, version }
 */
async function moveOfferItem(db, entity_id, input, identityId) {
  const { offer_id, item_id, on } = input;
  const found = await liveOffer(db, entity_id, offer_id);
  if (found.refusal) return found.refusal;
  const offer = found.offer;
  const rules = objectOr(offer.rules);
  const applies = objectOr(rules.applies_to);
  const list = Array.isArray(applies.item_ids) ? applies.item_ids.map(String) : [];
  const next = on ? (list.indexOf(item_id) >= 0 ? list : list.concat([item_id])) : list.filter((entry) => entry !== item_id);
  /* nothing to record is not an error, and a version for it would be noise in the one history that must stay readable */
  if (next.length === list.length && next.every((entry, index) => entry === list[index])) return { ok: true, unchanged: true, name: offer.name };

  /* ⭐ ONE KEY TOUCHED. Everything else about the offer is carried across exactly as it was. */
  const newRules = Object.assign({}, rules, { applies_to: Object.assign({}, applies, { item_ids: next }) });
  const version = offer.current_version + 1;
  const byWhom = input.by ? String(input.by).slice(0, 60) : null;
  const note = (on ? 'Product added at the counter' : 'Product removed at the counter') + (byWhom ? ' by ' + byWhom : '');
  await db.query(
    `INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
    [offer_id, version, entity_id, newRules, note, identityId]
  );
  await db.query(`UPDATE definition SET current_version = $2, updated_at = now() WHERE definition_id = $1`, [offer_id, version]);
  return { ok: true, name: offer.name, version };
}

/** the offer with its current rules: { offer }, or { refusal } when it is not there, not an offer ("an offer only" — this route must never edit another kind of definition) or not live */
async function liveOffer(db, entity_id, offer_id) {
  const current = await db.query(
    `SELECT d.definition_id, d.name, d.current_version, d.status, d.kind, v.rules
           FROM definition d
           LEFT JOIN definition_version v
             ON v.definition_id = d.definition_id AND v.version = d.current_version
          WHERE d.entity_id = $1 AND d.definition_id = $2`,
    [entity_id, offer_id]
  );
  if (!current.rows.length) return { refusal: { missing: true } };
  const offer = current.rows[0];
  if (offer.kind !== 'offer') return { refusal: { refused: 'that is not an offer' } };
  if (offer.status !== 'live') return { refusal: { refused: 'that offer is not live' } };
  return { offer };
}

/* the price column as the catalogue declares it: required, a number (catwrite.validateAgainst reads this row as it reads schema_fields) */
const PRICE_FIELD = [{ field_key: 'price', field_name: 'Price', field_type: 'number', required: true }];
router.post('/price', auth, auth.requireScope('till'), ...checked('POST /price'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const { item_id, price, sent, by } = priceInput(req.body);
    if (!item_id) return refuseBad(req, res, 'item_id required');
    /* CTR-168: Number() reads null, "" and [] as 0 and true as 1 - a shelf price wiped by a blank. What is no number at all is refused by
       the catalogue's own check, in PATCH /products' words (catwrite.validateAgainst); a negative or a word keeps its frozen sentence */
    const noNumber = Number.isFinite(price) && price >= 0 ? catwrite.validateAgainst(PRICE_FIELD, { price: sent }) : null;
    if (noNumber) return refuseBad(req, res, noNumber);
    if (!Number.isFinite(price) || price < 0) return refuseBad(req, res, 'price must be a number, zero or more');
    /* [OFFR-04] a price typed at the counter is the same write as PATCH /products — the same gate (lib/cost.writeRefusal) */
    const refused = await require('../lib/cost').writeRefusal(req, entity_id, ['price']);
    if (refused) return problem(req, res, { status: 403, ...relayed(refused) });
    const currency = await shopCurrency(entity_id);
    if (!currency) return problem(req, res, { status: 422, ...said('NO_MONEY', 'refused', countrySetup.MONEY_UNSTATED) });
    const changed = await withEntity(entity_id, (db) => writePrice(db, entity_id, item_id, price, currency, by));
    if (!changed) return problem(req, res, { status: 404, ...notFound() });
    shopChanged(entity_id, 'price changed');
    res.json({ ok: true, item_id, name: changed.name, was: changed.was, now: changed.now, currency });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** POST /price input: the product, the new price (a number, or NaN when it was not one), the price as it was sent, and who changed it */
function priceInput(body) {
  const given = body || {};
  return { item_id: String(given.item_id || ''), price: Number(given.price), sent: given.price, by: given.by || 'the counter' };
}

/**
 * W1-TILL: the shop's money through the ONE reader (country-setup.shopMoney — its own, else its pack's; as /snapshot and connectors read it).
 * A shop nobody gave money is REFUSED with the one sentence (NO_MONEY) — never INR written into a price by name. One identities read, as before.
 */
async function shopCurrency(entity_id) {
  const found = await query('SELECT currency_code, country FROM identities WHERE identity_id = $1', [entity_id]);
  const shop = found.rows[0] || {};
  return countrySetup.shopMoney(shop.currency_code, shop.country);
}

/**
 * ⚠️ A PRICE IS MONEY, NOT A NUMBER — the catalogue stores { amount, currency }, and reading only the bare figure once gave a
 * counter a shelf of zeroes ([TILL-01]). It is written in the shape it is read in.
 * ⚠️ AND THE OLD ONE IS KEPT. price_was, when, and by whom — so a shopkeeper can see what moved today, and "you charged me
 * more than yesterday" has an answer that is not somebody's memory.
 * → { was, now, name }, or null when the product is not this shop's
 */
async function writePrice(db, entity_id, item_id, price, currency, changedBy) {
  const current = await db.query('SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND item_id = $2', [entity_id, item_id]);
  if (!current.rows.length) return null;
  const data = current.rows[0].item_data || {};
  const previousPrice = data.price && typeof data.price === 'object' ? data.price.amount : data.price;
  const patch = {
    price: { amount: price, currency },
    price_was: previousPrice == null ? null : Number(previousPrice),
    price_changed_at: new Date().toISOString(),
    price_changed_by: String(changedBy).slice(0, 80)
  };
  const updated = await catwrite.patchItems(db, entity_id, [{ item_id, merge: patch }], { returning: 'item_data' });
  return { was: previousPrice, now: price, name: (updated.rows[0].item_data || {}).name || null };
}

/**
 * ── ⭐⭐ POST /api/till/rate — SET ONE PRODUCT'S TAX RATE, ONCE, FROM THE COUNTER (F5 A1; DECISIONS 2026-10-18 "TAX MISSING", 2026-10-24 "yes F5" (b)) ──
 * A registered shop rings up "Veg Meals" and it carries no rate: the counter ASKS ONCE and the sale goes on — the api never refuses a sale (that
 * would also bounce an offline-queued bill). Only an OWNER or a MANAGER answers: the signed-in person's hat (read from the DB by auth), never the
 * counter's key — a till key may not edit tax (POST /flags: "catalogue decisions"), and a cashier is told to ask the owner, in words.
 *   { item_id, slab_id } → one of the shop's slabs (own or governed, tax-shelf.readShelf), written through the engine's ONE writer (tax-slab.setOn:
 *   the citation AND its travelling copy) as a merge-patch by the catalogue's ONE product writer (catalogue-write.patchItems).
 * Idempotent: a product already citing that slab is answered changed:false and nothing is written. Gated on the shop CHARGING its tax
 * (tax-shelf.chargesTax: registration + tax id, the twin of the counter's shopTax().charges) — never "has a GSTIN". The words are the pack's
 * (tax-shelf.taxWordOf), never "GST" in code. Trips: readShelf (its transaction, the face, the governed slabs) + ONE transaction (shop · item · write).
 */
/* who may answer the counter's "which rate?" is lib/rate-door setsRate: the business itself, or a co-assist whose hat is manager (one rule on every door, CAT-210) */
/** the merge-patch setOn makes on this product: every key it changed; a key it removed travels as null (jsonb || keeps every other key) */
function slabPatchOf(item_data, slab) {
  const before = Object.assign({}, item_data || {});
  const after = taxSlab.setOn(Object.assign({}, before), slab);
  const patch = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (after[key] !== before[key]) patch[key] = after[key] === undefined ? null : after[key];
  return patch;
}
/** the shop's tax facts in ONE read → { word, charges }: the pack's word for its tax, and whether a sale of this shop carries it (tax-shelf.chargesTax) */
async function shopTaxFacts(db, entity_id) {
  const shop = (await db.query('SELECT gstn, country, policy_flags FROM identities WHERE identity_id = $1', [entity_id])).rows[0] || {};
  const flags = shop.policy_flags || {};
  return { word: taxShelf.taxWordOf(shop.country), charges: taxShelf.chargesTax({ gstin: shop.gstn, reg_type: flags.gst_registration }, taxPacks.packFor(shop.country)) };
}
/** the slab the owner picked, if the shop's shelf (own + governed) holds it */
const slabOnShelf = (shelf, slab_id) => (shelf && shelf.slabs instanceof Map && shelf.slabs.get(slab_id)) || null;
/** the body, read once: { item_id, slab_id, missing } — `missing` is the sentence for a blank id, else null */
function rateBodyOf(req) {
  const body = req.body || {};
  const item_id = String(body.item_id || ''),
    slab_id = String(body.slab_id || '');
  return { item_id, slab_id, missing: !item_id ? 'item_id required' : !slab_id ? 'slab_id required' : null };
}
/** the door's one transaction: the shop's tax facts, the slab, the product, the write — or WHICH refusal the handler answers ('no_tax' · 'no_slab' · 'no_item'; the statuses stay in the handler, S15) */
async function setRateOnce(db, entity_id, shelf, item_id, slab_id) {
  const facts = await shopTaxFacts(db, entity_id);
  if (!facts.charges) return { refused: 'no_tax', word: facts.word };
  const slab = slabOnShelf(shelf, slab_id);
  if (!slab) return { refused: 'no_slab', word: facts.word };
  const current = await db.query('SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND item_id = $2 AND is_active = true', [entity_id, item_id]);
  if (!current.rows.length) return { refused: 'no_item', word: facts.word };
  const item_data = current.rows[0].item_data || {};
  const patch = slabPatchOf(item_data, slab);
  const changed = Object.keys(patch).length > 0;
  if (changed) await catwrite.patchItems(db, entity_id, [{ item_id, merge: patch }]);
  return { changed, name: item_data.name || null, slab, word: facts.word };
}
/** the 200's two worked parts: the rate (null when the slab names none) and the words a counter shows */
function rateAnswer(out) {
  const slabWords = out.slab.name || out.word + ' ' + out.slab.rate + '%';
  const rate = out.slab.rate == null ? null : out.slab.rate;
  return { rate, words: (out.name || 'The product') + (out.changed ? ' now carries ' : ' already carries ') + slabWords + '.' };
}
router.post('/rate', auth, ...checked('POST /rate'), async (req, res) => {
  try {
    /* the door, before any lookup (cb-api round 1, rule 2): a key or a cashier is refused with the same sentence, and nothing is read */
    if (!setsRate(req)) return problem(req, res, { status: 403, ...said(RATE_OWNER_ONLY, 'Forbidden', RATE_ASK_OWNER, { may: false, why: RATE_ASK_OWNER }) });
    const entity_id = auth.entityOf(req);
    const { item_id, slab_id, missing } = rateBodyOf(req);
    if (missing) return refuseBad(req, res, missing);
    const shelf = await taxShelf.readShelf(entity_id, shelfDeps(), { withItems: false });
    const out = await withEntity(entity_id, (db) => setRateOnce(db, entity_id, shelf, item_id, slab_id));
    /* the refusals, in the pack's word for its tax (never "GST" in code), the caller's values never echoed (Q19) */
    if (out.refused === 'no_tax') return problem(req, res, { status: 409, ...said('TILL_NO_TAX_SCHEME', 'refused', 'This shop charges no ' + out.word + ', so no rate is needed.') });
    if (out.refused) return problem(req, res, { status: 404, ...notFound(out.refused === 'no_slab' ? 'That rate is not one of this shop’s ' + out.word + ' slabs.' : 'That product is not in this shop’s catalogue.') });
    if (out.changed) shopChanged(entity_id, 'rate set');
    const answer = rateAnswer(out);
    res.json({ ok: true, item_id, slab_id: out.slab.id, rate: answer.rate, changed: out.changed, words: answer.words });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/* ═══ REWARDS ═════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Athi, 2026-09-10: *"exactly like offer — instead of discount you add reward, so it can be encashed during next
 * visit, so a repeated customer can be invented."*
 *
 * ⭐⭐ WHY THE ARITHMETIC IS DONE TWICE, AND WHICH ANSWER WINS.
 * The counter computes points at the till, because it bills offline and has to TELL the customer what they just
 * earned while they are still standing there. The server computes them again here — from ITS OWN copy of the bill,
 * the chit the counter sent first under the same number (W2-REW, REW-T1: lib/counter-bill byRef, never the basket
 * the till posts beside it) — and the SERVER'S answer is the one written. Not from mistrust of the till — from the
 * fact that only the server can see the balance, and only the balance can say whether a redemption is affordable.
 * A till that has been offline for two days does not know what the customer spent yesterday at the other counter.
 *
 * ⚠️ EXCEPT FOR A SPEND, WHICH IS TAKEN AS STATED — because it already came off the bill total. If the server
 * disagreed and refused it, the customer would have paid a reduced price AND kept the points. So an unaffordable
 * spend is still WRITTEN, and reported back as 'overspent' so the shop finds out. A ledger that refuses to record
 * what actually happened at the counter is worse than one that records something regrettable.
 */

/**
 * ⚠️ THE QUERIES LIVE IN lib/reward-store.js, NOT HERE. They were written here first and copied nowhere; the moment
 * the shop's own Customers pane needed the same balance, keeping them would have made two readers of one number.
 * The engine (lib/rewards.js) decides what a point is worth; the store decides where one is kept; this file only
 * decides what a counter may do.
 */
const store = require('../lib/reward-store');
const progOf = (entity_id) => store.programme(entity_id, withEntity);
const holderFrom = store.holderFrom;

/**
 * GET /api/till/reward?scheme=phone&value=9840012345  → what this customer holds, and what it is worth
 * ⚠️ EXPIRY IS APPLIED ON THE WAY OUT, not by a nightly job. A sweep would have to run somewhere, be monitored,
 * and would still leave a window in which a customer is shown points the next bill refuses. Folding it here means
 * the number a customer is quoted is the number the till can spend, always — and the entries it produces are
 * written the next time that balance is touched, so the ledger catches up on use rather than on a timer.
 */
router.get('/reward', auth, auth.requireScope('till'), ...checked('GET /reward'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const holder = holderFrom({ scheme: req.query.scheme, value: req.query.value });
    if (!holder) return refuseBad(req, res, 'scheme (identity|phone) and value required');
    const prog = await progOf(entity_id);
    if (!prog) return res.json({ ok: true, holder, programme: null, points: 0, entries: [] });
    /* the balance is the SUM of every entry (lib/reward-store.balanceOn), never a fold of the newest page */
    const balance = await store.balance(entity_id, holder, withEntity, prog);
    res.json(rewardHeld(holder, prog, balance));
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** what a holder has: the programme in words, the points, what they are worth, and how many are about to lapse */
function rewardHeld(holder, prog, balance) {
  const gone = balance.expired;
  return {
    ok: true,
    holder,
    programme: { name: prog.name, earns: rewards.describeEarn(prog, {}), expires_months: prog.expires_months || null },
    points: balance.points,
    negative: balance.negative,
    worth: balance.worth,
    expiring: gone.length ? gone.reduce((total, entry) => total + Math.abs(entry.points), 0) : 0,
    entries: balance.entries
  };
}

/**
 * POST /api/till/reward  { ref, holder:{scheme,value}, spend, at? }
 *   ref    the bill number — the SAME client_ref the chit carries: the server reads ITS bill under it (the one the
 *          earning is computed from — W2-REW) and a replay writes nothing
 *   spend  points encashed on this bill, already deducted from that total at the counter
 *   at     the bill's billed_at as the counter stamped it — the same number at another moment is another counter's bill
 * ⚠️ net · gross · count · lines are NOT read any more: a till cannot state what a bill came to, only the server's chit can.
 * → 409 { code: 'BILL_NOT_RECORDED', message } when the server holds no such bill yet — the shop-PC queue retries it after
 *   the bill lands; the web counter had the bill answered before it asked. Nothing is written on a refusal.
 */
router.post('/reward', auth, auth.requireScope('till'), ...checked('POST /reward'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const { ref, holder, spend, billedAt } = rewardInput(req.body);
    if (!ref) return refuseBad(req, res, 'ref (the bill number) required');
    /* ⚠️ NOT AN ERROR. A walk-in who gave no number is the commonest bill in the shop; it earns nothing and the
       counter says so in one line. Returning 400 here would put a red box on an ordinary sale. */
    if (!holder) return res.json({ ok: true, holder: null, added: 0, spent: 0, points: 0, why: 'no customer to hold the points' });

    const prog = await progOf(entity_id);
    if (!prog) return res.json({ ok: true, holder, added: 0, spent: 0, points: 0, why: 'this shop runs no programme' });

    /* ⭐ ONE transaction: the holder locked, the SERVER'S bill read and its points computed, the balance read (a SUM of every
       entry), the due expiries + spend + earning written together */
    const settled = await store.settle(entity_id, holder, prog, { ref, spend, earn: mayEarn(holder, prog), at: billedAt }, withEntity);
    res.json(rewardSettled(holder, prog, spend, settled));
  } catch (e) {
    if (e && e.code === 'BILL_NOT_RECORDED') return problem(req, res, { status: 409, ...said(e.code, 'conflict', e.say) });
    problem(req, res, failed(e, req));
  }
});

/** POST /reward input: the bill number, the holder (a customer's phone or identity), the points encashed and the moment the counter billed it */
function rewardInput(body) {
  const given = body || {};
  const ref = String(given.ref || '')
    .trim()
    .slice(0, 64);
  return {
    ref,
    holder: holderFrom(given.holder || given.customer),
    spend: Math.max(0, Math.trunc(Number(given.spend) || 0)),
    billedAt: typeof given.at === 'string' && given.at ? given.at.slice(0, 40) : null
  };
}

/**
 * ⚠️ WALK-INS SKIP EARNING WHERE THE SHOP SAYS SO (Athi's rule, declared per shop as walk_in_earns) — but a
 * walk-in may still SPEND what an earlier visit earned, or the points would be a promise the shop never keeps.
 */
function mayEarn(holder, prog) {
  const walkIn = holder.scheme === 'phone';
  return !walkIn || prog.walk_in_earns !== false;
}

/** the answer after a bill's points were settled: what was added and spent, the new balance and what it is worth, in the programme's own words */
function rewardSettled(holder, prog, spend, settled) {
  const before = settled.before,
    added = settled.added;
  const after = before.points - spend + added;
  return {
    ok: true,
    holder: holder,
    programme: prog.name,
    added: added,
    spent: spend,
    points: after,
    worth: rewards.liability(prog, after),
    /* ⚠️ SAID, NOT HIDDEN: the spend was honoured because it had already come off the bill */
    overspent: spend > before.points ? spend - before.points : 0,
    says: rewards.billSays(prog, { added: added, spent: spend, balance: after }, {})
  };
}

/**
 * ⭐⭐ POST /api/till/reward/claim  { from:{scheme:'phone',value}, to:{scheme:'identity',value}, ref }
 * The walk-in who comes back and registers. Two entries, netting to zero, that move a phone-held balance onto an
 * account — never an UPDATE, both because the ledger is append-only by GRANT and because rewriting the old rows
 * would erase the fact that a walk-in earned them.
 * ⚠️ SOMEBODY AT THE COUNTER HAS TO ASK FOR IT. A phone number is not proof of identity, and an automatic merge
 * on a matching number would hand one person's balance to another who typed the same digits.
 */
router.post('/reward/claim', auth, auth.requireScope('till'), ...checked('POST /reward/claim'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const body = req.body || {};
    const from = holderFrom(body.from),
      to = holderFrom(body.to);
    if (!from || !to) return refuseBad(req, res, 'from and to holders required');
    const prog = await progOf(entity_id);
    if (!prog) return refuseBad(req, res, 'this shop runs no programme');
    const ref = String(body.ref || 'claim-' + Date.now()).slice(0, 64);
    /* ⭐ ALL OR NOTHING (lib/reward-store.claim): both holders locked, the balance read, both halves written in ONE transaction */
    const claim = await store.claim(entity_id, from, to, ref, prog, withEntity);
    if (!claim.ok) return refuseBad(req, res, claim.why);
    res.json({ ok: true, moved: claim.points, from: from, to: to });
  } catch (e) {
    if (e && e.code === 'CLAIM_RECORDED') return problem(req, res, { status: 409, ...said(e.code, 'conflict', e.say) });
    problem(req, res, failed(e, req));
  }
});

/**
 * ⭐⭐⭐ PAIRING — HOW A TELEVISION JOINS A SHOP WITHOUT TYPING A KEY.
 *
 * Athi, 2026-09-09: *"please add pairing so we can test 1 to many devices."* Typing
 * the full address with a 64-character key on a TV remote, with a
 * D-pad and an on-screen keyboard, is not a thing anyone will do twice.
 *
 * So: the shop asks for a CODE, the television types six characters, and the server hands it a screen key.
 *
 *   POST /api/till/pair        (session)  → { code, expires_at }   the shop generates one, per screen
 *   POST /api/till/pair/claim  (no auth)  → { key, shop }          the screen exchanges it, ONCE
 *
 * ⚠️ SIX CHARACTERS IS ONLY SAFE BECAUSE OF THE OTHER THREE RULES, and they are not optional:
 *   · TEN MINUTES  — a code is dead long before anyone could work through the space
 *   · ONCE         — claimed is claimed; a replay gets nothing, so a code read off a screen by a passer-by is spent
 *   · SLOWED       — wrong guesses are counted and the door shuts for a minute after a handful
 * The alphabet drops O·0·I·1·L, which is 27 characters and about 387 million codes. Someone reading the six characters off the
 * television during those ten minutes can pair a second screen — and a screen key can only read the price list, which is
 * printed on the shelf edge anyway. That is the whole reason pairing hands out a SCREEN key and never a till key.
 *
 * ⚠️ THE CODES LIVE IN MEMORY, ON PURPOSE. A pending code is worthless ninety seconds after it is made, so a table, a
 * migration and a cleanup job would all be carrying something that does not need to outlive a restart. A deploy in the middle
 * of pairing loses the code — you press the button again. Said out loud rather than discovered.
 */
const PAIR = new Map(); /* code → { entity_id, name, expires } */
const PAIR_MISSES = new Map(); /* ip → { n, until } */
const PAIR_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2345678';
const PAIR_TTL_MS = 10 * 60 * 1000;

/** forget the codes and the wrong-guess counts that have run out */
function pairSweep() {
  const now = Date.now();
  for (const [code, pending] of PAIR) if (pending.expires < now) PAIR.delete(code);
  for (const [address, miss] of PAIR_MISSES) if (miss.until < now) PAIR_MISSES.delete(address);
}
/** a fresh six-character code from the alphabet that drops O·0·I·1·L, not one already waiting to be claimed */
function pairCode() {
  const nestedCrypto = require('crypto');
  for (;;) {
    const bytes = nestedCrypto.randomBytes(6);
    let code = '';
    for (let index = 0; index < 6; index++) code += PAIR_ALPHABET[bytes[index] % PAIR_ALPHABET.length];
    if (!PAIR.has(code)) return code;
  }
}

/** the shop asks for a code — one per screen, so two televisions can be revoked apart */
router.post('/pair', auth, ...checked('POST /pair'), async (req, res) => {
  try {
    pairSweep();
    /* ⚠️ A KEY MAY NOT MINT A KEY. Pairing hands out authority, so it is gated to a signed-in person exactly as authoring a
       definition is — otherwise a counter key on a shared PC could quietly furnish itself a family of screen keys. */
    /* ⚠️ req.api_key is how middleware/auth marks a request that arrived with a key. I first guessed `via_key`, which nothing
       sets — and a guard testing a field nobody sets is a guard that always passes. */
    /**
     * ⭐⭐ A COUNTER MAY PAIR A TV — A SCREEN, AND NOTHING ELSE (2026-09-27). Athi: *"can we give the URL and the code to
     * display ... in the screen menu itself, so no one need to search that"*, then, asked whether a counter key may do
     * this: *"yes, screen codes only"*.
     * The old rule was "a key may not mint a key", and its reason still holds for everything else: a key must not be
     * able to furnish itself a family of keys that OUTLIVE it. So a counter's code yields a SCREEN key only (less than
     * a counter can already do: read the shop's offers to show them), and that key names this counter key as its
     * parent — middleware/auth keyAlive() refuses it the moment the counter key is revoked or closed.
     * ⚠️ Any other key is still refused: a screen key cannot pair a screen, a connector key cannot pair anything.
     */
    const holder = req.till && req.till.key; /* M04 — the holder, not req.api_key (middleware/auth holderOf) */
    const viaCounter = !!(holder && holder.scopes.includes('till'));
    if (!req.identity || (holder && !viaCounter))
      return problem(req, res, { status: 403, ...said('TILL_SIGN_IN_FIRST', 'Forbidden', 'Sign in to pair a screen.') });
    const entity_id = auth.entityOf(req);
    const shop = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]);
    const code = pairCode();
    const expires = Date.now() + PAIR_TTL_MS;
    PAIR.set(code, { entity_id, name: (shop.rows[0] && shop.rows[0].display_name) || null, expires, parent: viaCounter ? holder.jti : null });
    res.json({ code, expires_at: new Date(expires).toISOString(), minutes: Math.round(PAIR_TTL_MS / 60000) });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * ── ⭐⭐⭐ POST /api/till/enrol — A COUNTER SIGNS IN ONCE AND KEEPS A KEY ([TILL-121]) ───────────
 *
 * Athi: *"what is the difference between counter app and to the main engine? if we tie each app with the user
 * id then they should be able to login using the same user id / password combination / OTP?"*
 *
 * ⭐ THE SAME FRONT DOOR, A DIFFERENT THING BEHIND IT. The person signs in exactly as they do on the web —
 * POST /api/entities/register then /verify, email or user_id, one OTP — and lands here holding a session. This
 * route trades that session, once, for a till key.
 *
 * ⚠️⚠️⚠️ WHY NOT JUST KEEP THE SESSION, which is the obvious thing and the wrong one: a session expires and
 * needs the network to renew. A counter that must reach ChitBridge to open is a counter that cannot bill at 7am
 * on a morning the line is down — and billing with the line down is the entire premise of this application
 * ([[project-till]]). The key does not expire for a year and is checked by nobody to open the drawer.
 *
 * ⚠️ A KEY MAY NOT MINT A KEY — the same rule /pair holds, for the same reason: this route hands out
 * authority, so it takes a signed-in person and refuses a request that arrived bearing a key.
 *
 * ⚠️ THE IDENTITY IS PASSED TO mint(), AND THAT MATTERS. /pair/claim passes null, so a screen key carries
 * `bridge_id: null`. The counter names its own data folder from the bridge_id inside its key ([TILL-120]) so it
 * can tell one shop from another with no network at all — a key without one falls back to an unreadable hash.
 *
 * ── ⚠️⚠️⚠️ IT CLAIMS THE COUNTER, IT DOES NOT JUST MINT A KEY ([TILL-138]) ───────────────
 *
 * This route used to mint and register NOTHING, so a counter signed in through ⚙ was invisible to the
 * shop's own registry — it held a key and billed while the shop still thought C1 was free. A browser then
 * opened C1 legitimately, released the running counter, and ten bills were stranded with neither side told.
 *
 * ⚠️⚠️ AND THE BILL NUMBERS WOULD HAVE COLLIDED. The series is per counter id and the server only learns
 * where a run stopped because the counter tells it; a stranded counter being 401'd tells it nothing. Two
 * devices on C1 both start at 0001. That is the fault on record as the root cause of "sent but not in Task".
 *
 * ⭐ counters.claim() is the one path, shared with POST /api/counters/:id/open — same 409 COUNTER_HELD,
 * same deliberate takeover. Athi: *"without knock of this counter, the other one should not open?"*
 */
router.post('/enrol', auth, ownerOnly('Only the owner can connect a counter.'), ...checked('POST /enrol'), async (req, res) => {
  /* SEC-FIX3 S9 */
  try {
    if (!req.identity || req.api_key) return problem(req, res, { status: 403, ...said('TILL_SIGN_IN_FIRST', 'Forbidden', 'Sign in to connect a counter.') });
    const entity_id = auth.entityOf(req);
    const shop = await query('SELECT display_name, bridge_id FROM identities WHERE identity_id = $1', [entity_id]);
    const owner = shop.rows[0] || {};
    const claimed = await require('../lib/counters-store').claim(enrolClaim(entity_id, owner, req.body));
    if (claimed.status !== 200) return problem(req, res, { status: claimed.status, ...relayed(claimed.body) });
    res.json({
      key: claimed.key,
      /* ⭐ which counter this now IS, and whether signing in took it from another device ([TILL-138]) */
      counter: claimed.counter,
      took_over: !!claimed.released,
      /**
       * ⚠️ THE SHOP COMES BACK NAMED. The counter shows it before it writes anything, so a person who signed
       * into the wrong account sees the wrong shop's name on screen rather than discovering it in the books.
       */
      shop: { entity_id, bridge_id: owner.bridge_id || null, name: owner.display_name || null }
    });
  } catch (e) {
    problem(req, res, refusalOf(e, req));
  }
});

/** what POST /enrol asks counters.claim for: the shop, who signed in, the counter (C1 unless named), its label and whether it may take the counter over */
function enrolClaim(entity_id, owner, body) {
  const given = body || {};
  return {
    entity_id,
    identity: owner,
    id: String(given.counter || 'C1'),
    /* ⚠️ THE NAME IS WHAT THE OWNER WILL REVOKE BY, on Settings › Integrations › Keys — so it says which PC. */
    label: String(given.name || '')
      .trim()
      .slice(0, 40),
    /* ⚠️ ONLY WHEN ASKED IN WORDS. The counter shows who holds it and what taking it costs them first. */
    takeover: !!given.takeover
  };
}

/** the screen exchanges it — no key, because it does not have one yet; that is the entire point */
router.post('/pair/claim', ...checked('POST /pair/claim'), async (req, res) => {
  try {
    pairSweep();
    const address = String(req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
    if (shutForGuessing(address))
      return problem(req, res, { status: 429, ...said('PAIR_TOO_MANY_TRIES', 'Too many', 'Too many wrong codes. Wait a minute and try again.') });

    const code = typedCode(req.body);
    const pending = code && PAIR.get(code);
    if (!pending || pending.expires < Date.now()) {
      countWrongCode(address);
      return problem(req, res, {
        status: 404,
        ...said('PAIR_CODE_UNKNOWN', 'No such code', 'That code is wrong or has expired. Ask ChitBridge for a new one.')
      });
    }
    /* ⚠️ SPENT THE MOMENT IT IS READ, before the key is even minted — if minting fails the code is still gone, which is the
       safe way round: a code that survives a failure is a code somebody can retry. */
    PAIR.delete(code);
    const minted = await keys.mint(pending.entity_id, null, {
      name: 'shop screen · paired ' + new Date().toISOString().slice(0, 10),
      scopes: ['screen'],
      days: 365,
      parent: pending.parent || null
    });
    PAIR_MISSES.delete(address);
    res.json({ key: minted.key, shop: { entity_id: pending.entity_id, name: pending.name } });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** has this address typed too many wrong codes lately? */
function shutForGuessing(address) {
  const misses = PAIR_MISSES.get(address);
  return !!(misses && misses.n >= 8 && misses.until > Date.now());
}

/** the code the screen typed, upper-cased and stripped of everything but letters and digits */
function typedCode(body) {
  return String((body && body.code) || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** one more wrong code from this address: the door shuts for a minute after a handful */
function countWrongCode(address) {
  const miss = PAIR_MISSES.get(address) || { n: 0, until: 0 };
  miss.n += 1;
  miss.until = Date.now() + 60000;
  PAIR_MISSES.set(address, miss);
}

/**
 * ── ⭐ GET /api/till/screens · POST /api/till/screens/revoke — THE TVs THIS SHOP HAS PAIRED (2026-09-27) ──────
 *
 * Athi: *"can we show how many connection exists already and a switch to revoke"*. Beside the pairing code, the
 * counter lists every SCREEN key the shop holds — however it was paired, from here or from the back office — with
 * when it was paired and when it last showed the sign, and a switch that turns one off.
 * ⚠️ SCREEN KEYS ONLY, in both directions. A key whose scopes are anything but exactly ['screen'] is neither listed
 * nor revocable here, so a counter can never see or switch off another counter or a connector.
 * ⚠️ The key itself is never returned — only its name, dates and last four characters, as the keys screen shows.
 */
router.get('/screens', auth, auth.requireScope('till'), ...checked('GET /screens'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const list = await keys.listOf(entity_id);
    const screens = list.filter(isScreenKey).map((item) => screenRow(item, list));
    res.json({ screens, count: screens.length, limit: 20, keys_used: list.filter((item) => !(item && item.till && item.till.closed_at)).length });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** one paired screen as the counter lists it: name, last four characters, when paired and last seen, and whether it would be refused right now */
function screenRow(item, list) {
  return {
    jti: item.jti,
    name: item.name || null,
    last4: item.last4 || null,
    paired_at: item.created_at || null,
    seen_at: (item.seen && item.seen.at) || null,
    /* ⭐ whether it would be refused right now — a TV paired by a counter that has since been closed */
    alive: !!auth.keyAlive(list, item.jti),
    from_counter: !!item.parent
  };
}

/**
 * change one paired screen's key under the shop-row lock: 'missing' (not listed), 'refused' (listed, but not a screen key) or 'done'.
 * `edit(list)` gives the new key list. One transaction, one lock + one write on the shop row.
 */
async function changeScreenKey(entity_id, keyId, edit) {
  let outcome = 'missing';
  await require('../db').withTransaction(async (db) => {
    const locked = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
    const flags = (locked.rows[0] && locked.rows[0].policy_flags) || {};
    const list = Array.isArray(flags.api_keys) ? flags.api_keys : [];
    const found = list.find((item) => item && String(item.jti) === keyId);
    if (!found) return;
    if (!isScreenKey(found)) {
      outcome = 'refused';
      return;
    }
    outcome = 'done';
    await policy.patchKey(db, entity_id, [], { api_keys: edit(list) }, { op: 'merge' });
  });
  return outcome;
}

router.post('/screens/revoke', auth, auth.requireScope('till'), ...checked('POST /screens/revoke'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const keyId = String((req.body && req.body.jti) || '');
    if (!keyId) return refuseBad(req, res, 'Which screen?');
    const outcome = await changeScreenKey(entity_id, keyId, (list) => list.filter((item) => String(item.jti) !== keyId));
    if (outcome === 'refused')
      return problem(req, res, { status: 403, ...said('TILL_SCREEN_ONLY', 'Forbidden', 'Only a shop screen can be switched off from the counter.') });
    if (outcome === 'missing') return problem(req, res, { status: 404, ...notFound('That screen is no longer paired.') });
    auth.forgetKey(keyId);
    res.json({ ok: true, jti: keyId, message: 'That screen is switched off. It stops showing the sign within a minute.' });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * POST /api/till/screens/rename — { jti, name }: give a paired screen its own name (M151). Screen keys only, like revoke;
 * one transaction, one lock + one write on the shop row. An empty name puts the default ("Screen 1/2…", said by the till) back.
 */
router.post('/screens/rename', auth, auth.requireScope('till'), ...checked('POST /screens/rename'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const keyId = String((req.body && req.body.jti) || '');
    const name = String((req.body && req.body.name) || '')
      .trim()
      .slice(0, 40);
    if (!keyId) return refuseBad(req, res, 'Which screen?');
    const outcome = await changeScreenKey(entity_id, keyId, (list) =>
      list.map((item) => (String(item.jti) === keyId ? Object.assign({}, item, { name: name || null }) : item))
    );
    if (outcome === 'refused')
      return problem(req, res, { status: 403, ...said('TILL_SCREEN_ONLY', 'Forbidden', 'Only a shop screen can be renamed from the counter.') });
    if (outcome === 'missing') return problem(req, res, { status: 404, ...notFound('That screen is no longer paired.') });
    auth.forgetKey(keyId);
    res.json({ ok: true, jti: keyId, name: name || null });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * ⭐⭐⭐ GET /api/till/verify — CAN THIS COUNTER PROVE IT IS RIGHT?
 *
 * Athi, 2026-09-09: *"i am going crazy now — how to gain confidence it is reading the entire catalogue and also not mixing up, and
 * counter works fine and rightly synced."*
 *
 * That is not a question prose can answer. Anyone can be TOLD the copy is good; what was missing is a way to CHECK it, on the spot,
 * against the shop itself. So this is deliberately not the snapshot: it is a small, cheap, independent second opinion the counter
 * compares its own copy against, field by field.
 *
 *   total   how many sellable products the shop has right now
 *   at      the server's clock, so a stale copy is obvious
 *   shop    the entity and its name — the counter checks it is even looking at the right business
 *   sample  a handful of REAL rows, spread across the whole shelf rather than the first page, with the numbers that matter
 *
 * ⚠️ THE SAMPLE IS SPREAD ON PURPOSE. Taking the first eight rows would pass on a counter that only ever received page one — which
 * is the exact failure being checked for. These are drawn across the whole catalogue by offset, so a copy that stops at 500 fails.
 * ⚠️ It never repairs anything. A check that quietly fixes what it finds cannot be trusted to report honestly next time.
 */
/**
 * ── ⭐⭐⭐ POST /api/till/reconcile — DID THE CHIT I WAS GIVEN ACTUALLY RECORD *MY* BILL? ─────────────────────────
 *
 * Athi, 2026-09-17, choosing option (a) for the bills two PCs both numbered C1: *"go with option a, build the
 * recovery."* Those bills were ABSORBED — the server answered 200 with the OTHER PC's chit id, so the counter holds
 * a real chit id that records somebody else's sale, and shows "✓ sent". Nothing on the counter can tell. This can.
 *
 * Body: { bills: [{ no, at, chit_id }] } (≤ 200). For each, the chit is read back and its own bill number and
 * `billed_at` compared with the counter's:
 *   ok        the chit is this bill
 *   absorbed  the chit exists but records a DIFFERENT bill — this sale never reached the books
 *   missing   no such chit for this shop
 *   unknown   the chit carries no `billed_at`, so nobody can say — left alone rather than guessed at
 *
 * ⚠️ ONE QUERY for the whole batch. ⚠️ Read-only: it answers, the counter decides and re-sends.
 */
router.post('/reconcile', auth, auth.requireScope('till'), ...checked('POST /reconcile'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const bills = billsToReconcile(req.body);
    const found = await chitsRecorded(entity_id, bills);
    const out = bills.map((item) => reconcileVerdict(item, found));
    res.json({ checked: out.length, bills: out });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** the counter's bills to check: at most 200, each with its number, its moment and a well-formed chit id (or none) */
function billsToReconcile(body) {
  return (Array.isArray(body && body.bills) ? body.bills : [])
    .slice(0, 200)
    .map((item) => ({
      no: String((item && item.no) || '').slice(0, 64),
      at: item && item.at ? String(item.at) : null,
      chit_id: /^[0-9a-f-]{36}$/i.test(String((item && item.chit_id) || '')) ? String(item.chit_id) : null
    }))
    .filter((item) => item.no);
}

/** the chits the bills name, read back in ONE query: Map(chit_id → { ref, billed_at }) */
async function chitsRecorded(entity_id, bills) {
  const ids = [...new Set(bills.map((item) => item.chit_id).filter(Boolean))];
  const found = new Map();
  if (!ids.length) return found;
  const read = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT DISTINCT ON (chit_id) chit_id::text AS chit_id,
                business_json->>'client_ref' AS ref, business_json->>'billed_at' AS billed_at
           FROM chit_header WHERE entity_id = $1 AND chit_id = ANY($2::uuid[])
          ORDER BY chit_id, created_at`,
      [entity_id, ids]
    )
  );
  read.rows.forEach((row) => found.set(row.chit_id, row));
  return found;
}

/** ok · absorbed · missing · unknown, for one bill beside the chit it was given */
function reconcileVerdict(item, found) {
  const chit = item.chit_id ? found.get(item.chit_id) : null;
  if (!chit) return { no: item.no, verdict: 'missing' };
  if (!chit.billed_at || !item.at) return { no: item.no, verdict: 'unknown' };
  /* ⚠️ same number AND same moment — a chit carrying this number but another moment is another PC's sale */
  const same = String(chit.ref || '') === item.no && String(chit.billed_at) === item.at;
  return { no: item.no, verdict: same ? 'ok' : 'absorbed', recorded_as: chit.ref || null };
}

router.get('/verify', auth, auth.requireScope('till'), ...checked('GET /verify'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const shop = await query('SELECT display_name FROM identities WHERE identity_id = $1', [entity_id]);
    const total = await sellableCount(entity_id);
    const sample = await spreadSample(entity_id, total);
    res.json({ total, at: new Date().toISOString(), shop: { entity_id, name: (shop.rows[0] && shop.rows[0].display_name) || null }, sample });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** how many sellable products the shop has right now */
async function sellableCount(entity_id) {
  const counted = await withEntity(entity_id, (db) =>
    db.query(
      `SELECT count(*)::int AS n FROM catalogue_items
         WHERE entity_id = $1 AND is_active = true
           AND COALESCE(NULLIF(btrim(lower(item_data->>'status')), ''), 'available')
               NOT IN ('unavailable', 'redundant', 'retired')`,
      [entity_id]
    )
  );
  return (counted.rows[0] && counted.rows[0].n) || 0;
}

/**
 * eight rows spread across the shelf — first, last, and six evenly between.
 * ⚠️ ONE QUERY, NOT EIGHT. The first cut ran a LIMIT 1 OFFSET n read per sample point, inside a loop — the textbook N+1, and
 * tests/query-shape caught it as "routes/till.js: 1 (budget 0)". A check that a counter is healthy must not itself cost the
 * server eight round trips across the Pacific every time somebody presses it.
 * row_number() numbers the shelf once and "= ANY" picks the wanted places out of it, which is exactly what the loop meant.
 */
async function spreadSample(entity_id, total) {
  const want = Math.min(8, total);
  const offsets = [];
  for (let index = 0; index < want; index++) offsets.push(Math.floor((total - 1) * (want === 1 ? 0 : index / (want - 1))));
  const sampleRows = await withEntity(entity_id, (db) =>
    db.query(
      'WITH live AS (SELECT item_id, item_data, (row_number() OVER (ORDER BY item_id) - 1)::int AS n' +
        '   FROM catalogue_items WHERE entity_id = $1 AND is_active = true' +
        "     AND COALESCE(NULLIF(btrim(lower(item_data->>'status')), ''), 'available')" +
        "         NOT IN ('unavailable', 'redundant', 'retired'))" +
        ' SELECT item_id, item_data, n FROM live WHERE n = ANY($2::int[]) ORDER BY n',
      [entity_id, [...new Set(offsets)]]
    )
  ).catch(log.orElse('till GET /verify: the read failed — answered with none', { rows: [] }));
  return sampleRows.rows.map((row) => {
    const data = row.item_data || {};
    return { at_offset: row.n, item_id: row.item_id, name: data.name || null, price: amountOf(data.price), tax_slab: data.tax_slab || null };
  });
}

/**
 * ── ⭐⭐⭐ POST /api/till/shop — THE COUNTER FILLS IN ITS OWN SHOP ([TILL-105]) ─────────────────
 *
 * Athi, 2026-09-19: *"yes, counter can edit the shop profile, if not there at all then allow, if already
 * there, then ask for user id and password again to edit"* — and then, told the counter HAS no password to ask
 * for (Sign in is a name-picker; the credential is the till key): *"yes, counter has no password, use the till
 * key alone for the time being."*
 *
 * ⚠️⚠️⚠️ THIS WIDENS THE BLAST RADIUS OF A STOLEN COUNTER KEY. The rule stated above /flags — *"the blast
 * radius of a stolen counter key is exactly the list above"* — now includes the shop's header and its GSTIN.
 * That is Athi's call and a reasonable one (a second factor that does not exist cannot guard anything, and the
 * counter is meant to be self-sustaining for a small shop). The narrowness below is what buys "the time being".
 *
 * ⭐ WHAT MAY BE SET, AND WHY THE LINE IS THERE:
 *   identity + contact — header text on a slip. Wrong means a misprinted bill, not a wrong charge.
 *   gstin — allowed, and the one with legal weight. It is the field most often missing, and the shop panel
 *     already says what missing costs: no GSTIN, no GST. Withholding it would make the feature pointless.
 * ⚠️ WHAT MAY NOT:
 *   currency — it converts nothing, it RELABELS. ₹40 silently becomes $40 across the whole catalogue. That is
 *     a consequence a counter cannot see, which is exactly the test /flags applies to a product patch.
 *   reg_type — regular charges tax, composition does not. A status held with the tax authority, not a
 *     preference; mistyped, the shop either charges tax it must not or omits tax it must collect.
 *
 * ⭐⭐ EVERY CHANGE SIGNS ITSELF, with a mechanism that already existed: applyProfileMap records per-field
 * provenance in policy_flags.profile_provenance, so `source: 'counter C1'` tells the back office that the
 * GSTIN came from a counter and when. It is also what makes "for the time being" reversible — the day a real
 * second factor exists, every row written without one can be found.
 *
 * ⚠️ RLS: WITHOUT — applyProfileMap writes through the bare `query` handle scoped by entity_id, the same
 * posture as the back office's PUT /api/governance/profile/vault. Inherited, not introduced here.
 */
/** ⚠️ THE WHITELIST IS THE SECURITY BOUNDARY, so it is a constant and not an inline list in the handler. */
const TILL_SHOP_FIELDS = ['trade_name', 'legal_name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'gstin'];
/** ⚠⚠ named so the refusal can SAY WHY rather than silently dropping the field — a quiet drop is the bug. */
const TILL_SHOP_REFUSED = {
  /**
   * ⚠️⚠️ THE WRONG LAYER — which is the stronger reason than "it is dangerous". lib/govresolve's cascade:
   * universe (allowed bounds) → constitution → INSTALLATION (picks currency/tz/region, tighten-only) → entity.
   * A counter works at the entity layer and cannot reach past it.
   * ⭐ AND THERE IS A GOVERNED PATH, so this is a redirection rather than a wall: govresolve.currencyRefusal(
   * entity_id, want) checks a wanted currency against the constitution's allowed set. It is simply not here.
   */
  currency: 'the currency belongs to the whole installation, not to a counter — changing it here would relabel every price rather than convert it',
  reg_type: 'regular or composition is a registration held with the tax authority, and it decides whether tax is charged at all'
};
router.post('/shop', auth, auth.requireScope('till'), ...checked('POST /shop'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const body = objectOr(req.body);
    const cbProfile = require('../lib/profile');

    /* ⚠️ WHAT IT IS NOW, READ BEFORE THE WRITE — so the reply can say what actually changed, and so a field
       that was already correct is not re-stamped with a counter's provenance for no reason. */
    const before = (await cbProfile.invoiceParty(entity_id)) || {};
    const refused = Object.keys(body)
      .filter((field) => TILL_SHOP_REFUSED[field])
      .map((field) => ({ field, why: TILL_SHOP_REFUSED[field] }));
    const source = 'counter' + (await namedCounter(req));
    const as_of = new Date().toISOString();

    const refusal = checkSentTaxId(body, before);
    if (refusal) return problem(req, res, { status: 400, ...refusal });

    const { values, changed } = shopChanges(body, before, source, as_of);
    if (!changed.length) return res.json({ ok: true, changed: [], refused: refused, shop: before, message: nothingChangedWords(refused) });

    await cbProfile.applyProfileMap(entity_id, values, { by: source, at: as_of });
    /* ⭐ the bill header just changed, so every open counter and the shop screen hear it on the same bell a
       price change rides — rather than each discovering it whenever it next happens to re-read the shop. */
    ringBell(entity_id, 'shop profile', 'POST /shop');

    /* ⚠️ THE REPLY IS THE SERVER'S TRUTH, RE-READ — never the page's own optimism echoed back. A counter that
       painted what it SENT would show a GSTIN the vault had normalised differently. [[feedback-check-after-the-wire]] */
    const after = (await cbProfile.invoiceParty(entity_id)) || {};
    res.json({ ok: true, changed: changed, refused: refused, shop: after, by: source, at: as_of });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** tell the shop screen and every open counter something changed (shopChanged); a signal that cannot be sent never fails the write it follows */
function ringBell(entity_id, reason, route) {
  try {
    shopChanged(entity_id, reason);
  } catch (e) {
    log.fellBack('till ' + route + ': the signal was not sent — carried on without it', e);
  }
}

/**
 * ⭐ WHO IS WRITING. counterOfReq reads it off the key's own register row — the page cannot be trusted to
 * say which counter it is, and it does not have to. → ' C1' (with the space) or '' when the key holds no counter.
 */
async function namedCounter(req) {
  try {
    const held = await counterOfReq(req);
    return held ? ' ' + held : '';
  } catch (e) {
    log.fellBack('till POST /shop: failed — carried on without it', e);
    return '';
  }
}

/** "nothing changed — and 1 field(s) a counter may not set were ignored" | "nothing to change — every field already reads that way" */
function nothingChangedWords(refused) {
  return refused.length
    ? 'nothing changed — and ' + refused.length + ' field(s) a counter may not set were ignored'
    : 'nothing to change — every field already reads that way';
}

/** the value when it is an object, else an empty one */
const objectOr = (body) => (body && typeof body === 'object' ? body : {});

/** a tax number sent with the edit is checked and stored upper-cased (the one form every reader already assumes): the refusal's spec, or null */
function checkSentTaxId(body, before) {
  if (!(typeof body.gstin === 'string' && body.gstin.trim())) return null;
  const upper = body.gstin.trim().toUpperCase();
  const refusal = taxIdRefusal(before, upper);
  if (!refusal) body.gstin = upper;
  return refusal;
}

/**
 * ⚠️⚠️⚠️ A GSTIN IS CHECKED HERE, AND THIS IS THE FIRST PLACE ANYTHING CHECKS ONE ON SAVE.
 * lib/profile-map.gstinChecksum has always existed — format, the PAN holder-type letter Tally itself
 * rejects, and the mod-36 check digit — but its only caller is assess(), which REPORTS issues rather than
 * refusing them. snapshot-wire's old rule ("changed in ChitBridge, where it is checked") was therefore
 * half true, and widening the counter's authority without closing that would have been the worst version
 * of this change: a wrong GSTIN, typed at a counter, printed on a TAX INVOICE a customer claims against.
 * ⚠️ REFUSED, NOT WARNED. Everything else here is header text where a typo misprints a line; this one
 * decides what is charged and what a buyer can reclaim.
 * → the spec of the refusal (said(...)), or null when the tax number checks out.
 */
function taxIdRefusal(before, taxId) {
  /* ⭐ CX0: the shop's COUNTRY picks the check — India's GSTIN checksum, else the pack's own (reg-au abn.check · reg-ae trn.check) */
  const country = String(before.country || '').toUpperCase();
  /* GOV-AU1: a shop with no country has no tax number check to run — it is asked, never checked as India's */
  if (!country)
    return said('NO_COUNTRY', 'validation', 'Set the shop’s country first (Country setup) — the tax number is checked by its law.', { field: 'gstin' });
  if (country !== 'IN') {
    const pack = require('../lib/country').taxId(country); /* R5: the registry's check — AU/AE adapters, a new country's own taxId */
    const verdict = pack.check ? pack.check(taxId) : { ok: true };
    return verdict.ok ? null : said('TILL_BAD_REQUEST', 'validation', verdict.why || 'That tax number does not check out.', { field: 'gstin' });
  }
  const checksum = require('../lib/profile-map').gstinChecksum(taxId);
  if (checksum.ok) return null;
  const words =
    checksum.reason === 'format'
      ? 'That is not the shape of a GSTIN — 15 characters: two digits, five letters, four digits, a letter, then three more.'
      : 'That GSTIN’s last character does not match the rest of it, so one character is mistyped.';
  return said('TILL_BAD_REQUEST', 'validation', words, { field: 'gstin' });
}

/**
 * the fields the counter changed: { values (what the profile map writes, stamped with its source), changed ([{ field, from, to }]) }.
 * ⚠️⚠️ A BLANK DOES NOT CLEAR A FIELD, and this is deliberate. applyProfileMap skips empty values, so
 * an empty box would be a silent no-op — and a counter form that posts every field on every save would
 * otherwise LOOK like it had wiped the ones it left alone. Clearing the shop's GSTIN from a counter is
 * not a thing anybody needs; leaving it out of the request is how you leave it alone.
 */
function shopChanges(body, before, source, as_of) {
  const values = {},
    changed = [];
  for (const field of TILL_SHOP_FIELDS) {
    if (!(field in body)) continue;
    const next = String(body[field] == null ? '' : body[field]).trim();
    if (!next) continue;
    if (next === String(before[field] == null ? '' : before[field])) continue; /* unchanged — do not re-stamp it */
    values[field] = { value: next.slice(0, 200), source: source, as_of: as_of, rung: 'declared' };
    changed.push({ field, from: before[field] || null, to: next.slice(0, 200) });
  }
  return { values, changed };
}

/**
 * ── ⭐⭐⭐ GET /api/till/stock — READ-ONLY, THE ONE THING MISSING (2026-09-27) ──────────────────────────────
 *
 * Athi: *"say what is the existing qty and its cost, add more and its cost, and what is the average cost and
 * total qty."* lib/stock-from-chit.js has posted weighted-average-cost movements on every receipt and every
 * sale since 2026-09-10 (`stock_balance`) — nothing ever read them back. This is that read, and nothing else:
 * no route in this file has written to stock_balance before today and this one still doesn't.
 *
 * ⚠️ ONE CALL FOR THE WHOLE SHELF, not one per line — stock-store.sheet() is built for exactly this ("never
 * for a loop that then asks per item"), and a receipt with thirty lines must not cost thirty round trips.
 * ⚠️ NO LOTS, NO LOCATIONS — v1 is one pool per product (DEFAULT_LOCATION, no batch breakdown), matching
 * everything else `lib/stock-store.js` already says about v1. A tracked product's balance is still the sum
 * across its batches, which is exactly what "total qty" asks for.
 */
/** the answer's shape per product: qty · avg_cost (the ledger's own rounding); with detail its lots and `counted` (R104), and how many are not counted */
function stockBalancesOf(by, inventoryEngine, detail) {
  const out = {};
  let notCounted = 0;
  for (const id of Object.keys(by)) {
    const b = by[id];
    out[id] = { qty: b.qty, avg_cost: b.qty ? inventoryEngine.m2(b.value / b.qty) : 0 };
    if (detail) Object.assign(out[id], { lots: b.lots, counted: b.counted !== false });
    if (b.counted === false) notCounted++;
  }
  return { out, notCounted };
}
router.get('/stock', auth, auth.requireScope('till'), ...checked('GET /stock'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    /* ?detail=1 (T3-OPS, CB Operations › Stock): each balance also carries its name · unit (ONE read, catalogue-read.ITEM_NAMES_SQL) and its
       batches with their expiry (onHand { lots }, the same read). Additive: the counter's call is unchanged. */
    const detail = req.query.detail === '1';
    if (detail && !(await require('../lib/schema').hasTable('stock_balance')))
      return res.json({
        balances: {},
        at: new Date().toISOString(),
        not_ready: 'STOCK_LEDGER_MISSING',
        says: 'Stock is not switched on for this shop yet. Receive a delivery and it starts.'
      });
    /* R104: with detail, each balance says whether the shop COUNTS it (`counted`, lib/stocked — a dish made to order is false) and
       `not_counted` says how many are not, so the screen can say so instead of listing a dish at −40 "below zero"; the counter's
       plain call is unchanged (the till does not show stock). The rows stay: a dish keeps its old figure, greyed. */
    const { balances, notCounted } = await stockBalances(entity_id, detail);
    /* [OFFR-04] the average cost is the shop's buying price: an actor without can_see_costs gets the qty only */
    if (!(await require('../lib/cost').canReadSafe(req, entity_id))) for (const id of Object.keys(balances)) delete balances[id].avg_cost;
    /* S34: not_counted is named; it is asked for with ?detail=1 only (undefined is left out by JSON, so the plain call answers as before) */
    res.json({ balances, at: new Date().toISOString(), not_counted: detail ? notCounted : undefined });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * → { balances, notCounted }: balances = { product id → { qty, avg_cost, [lots, counted, name, unit] } }.
 * ⭐ COLLAPSED TO ONE ROW PER PRODUCT — a tracked item's batches sum into the figure the Receive screen
 * actually asks for; the till does not show stock in v1 (Athi, 2026-09-10) and a per-batch breakdown
 * would be exactly that. The ONE stock reader (stock-store.onHand, T1-INV) — the storefront reads the same.
 */
async function stockBalances(entity_id, detail) {
  const stockStore = require('../lib/stock-store');
  const inventory = require('../lib/inventory'); /* ⭐ its own q3/m2 rounding — a total here must never disagree with the ledger it reads */
  const onHand = await stockStore.onHand(entity_id, withEntity, detail ? { lots: true, counted: 'stamp' } : {});
  const { out, notCounted } = stockBalancesOf(onHand, inventory, detail);
  if (detail && Object.keys(out).length) await addItemNames(entity_id, out);
  return { balances: out, notCounted };
}

/** ?detail=1: each balance also carries the product's name and unit (ONE read) */
async function addItemNames(entity_id, balances) {
  const ids = Object.keys(balances);
  const named = await withEntity(entity_id, (db) => db.query(require('../lib/catalogue-read').ITEM_NAMES_SQL, [entity_id, ids]));
  for (const item of named.rows)
    if (balances[item.id]) {
      balances[item.id].name = item.name || null;
      balances[item.id].unit = item.unit || null;
    }
}

/**
 * ── ⭐⭐⭐ POST /api/till/catalogue — A SHOP OPEN FOR BUSINESS, FROM THE COUNTER ([TILL-107]) ────────
 *
 * Athi, 2026-09-19: *"can we have a proper two catalogue, one for Veg Store and another one for Hotel… how do
 * we bring the axiom out of the lot? so we can start the store in no time."*
 *
 *   { blueprint: 'veg' | 'hotel' }              mint that trade's starter catalogue
 *   { products: [ {name, price, …}, … ] }      commit rows a person already approved in the preflight report
 *
 * ⭐ THE AXIOM IS name + price, MEASURED. lib/catalogue-blueprint records how: the counter was driven with
 * products stripped field by field and it sells on those two alone. So this route asks for nothing more, and a
 * shop is never made to supply an HSN code before it may sell a tomato.
 *
 * ⚠️ IT WRITES THROUGH lib/catalogue-write, the same path POST /api/products/bulk uses — schema resolved
 * once, rules read once, every row validated before any is written, columns declared, money stamped. Athi:
 * *"ensure that we are not writing anything new."*
 *
 * ⚠⚠ SETUP IS ONLINE AND THAT IS DELIBERATE. Authoring a product offline would create a LOCAL product needing
 * a merge rule against a back-office one; Athi settled it — *"while setting up the store… we can still
 * connect."* The counter's offline job stays what [TILL-106] proved: selling what it already holds.
 */
/* ⚠️ a whole starter catalogue, or a whole uploaded list — a bulk door, and limited as one ([TILL-112]) */
router.post('/catalogue', auth, auth.requireScope('till'), catalogueMintLimiter, ...checked('POST /catalogue'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const text = objectOr(req.body);
    const nestedCatwrite = require('../lib/catalogue-write');

    const already = await alreadyStarted(entity_id, text);
    if (already) return problem(req, res, { status: 409, ...already });

    const plan = catalogueStartPlan(text, await nestedCatwrite.codesInUse(entity_id));
    if (plan.refusal) return problem(req, res, { status: 400, ...plan.refusal });
    let items = plan.items;
    try {
      items = citeCategories(items, await ensureCategoriesFor(entity_id, items, req));
    } catch (e) {
      /* ⚠⚠ SAID, NOT SWALLOWED. Without ids the products would be written uncategorised, and a shop would
         find a flat wall of goods with nothing to say why. */
      return problem(req, res, categoriesFailed(e, req));
    }

    const written = await nestedCatwrite.writeItems({ entity_id, items: items });
    if (!written.ok)
      return problem(req, res, { status: written.status || 400, ...said('TILL_BAD_REQUEST', written.error, written.message, { invalid: written.invalid }) });

    /* ⭐ the shop screen and every open counter hear it on the same bell a price change rides */
    ringBell(entity_id, 'catalogue started', 'POST /catalogue');
    res.json({
      ok: true,
      added: written.rows.length,
      from: plan.from,
      refused: plan.refused,
      message: catalogueAddedWords(written.rows.length, plan.refused.length)
    });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * ⚠️⚠️ MINTING TWICE DOUBLES A CATALOGUE, and the copies carry different codes — two Tomatoes that are
 * not the same Tomato. The refusal says what is already there rather than a bare 409.
 * → the spec of the 409, or null when the shop has no products (or asks to replace)
 */
async function alreadyStarted(entity_id, text) {
  const have = await require('../lib/catalogue-write').countItems(entity_id);
  if (!(have > 0 && text.replace !== true)) return null;
  const words =
    'This shop already has ' + have + ' product' + (have === 1 ? '' : 's') + '.' + ' Starting a catalogue again would add a second copy of each one.';
  return said('CATALOGUE_NOT_EMPTY', 'not empty', words, { have: have });
}

/**
 * what to mint: { items, from, refused } for rows a person approved or a trade's starter list, or { refusal } (the spec of a 400) when neither can be.
 * ⚠️ ROWS A PERSON HAS ALREADY APPROVED. The header reconciliation is csv-preflight's job and it
 * produces a report somebody agrees to; this is the step after that, never a second guess at it.
 */
function catalogueStartPlan(text, existing) {
  const blueprints = require('../lib/catalogue-blueprint');
  if (Array.isArray(text.products) && text.products.length) {
    const approved = blueprints.rowsToProducts(text.products, text.blueprint, existing, { unitOf: require('../lib/units').unitOf });
    if (!approved.products.length)
      return { refusal: said('TILL_BAD_REQUEST', 'nothing to add', 'Not one row had both a name and a price.', { refused: approved.refused }) };
    return { items: approved.products, from: 'file', refused: approved.refused };
  }
  const blueprint = blueprints.blueprint(text.blueprint);
  if (blueprint.key === 'general' && text.blueprint) {
    const words = 'There is no product list called "' + String(text.blueprint).slice(0, 40) + '".';
    return { refusal: said('TILL_BAD_REQUEST', 'unknown trade', words, { choices: Object.keys(blueprints.BLUEPRINTS) }) };
  }
  if (!blueprint.starter.length) {
    const words = 'Choose a product list, or send the products you want added.';
    return { refusal: said('TILL_BAD_REQUEST', 'nothing to mint', words, { choices: Object.keys(blueprints.BLUEPRINTS) }) };
  }
  return { items: blueprints.mint(blueprint.key, existing), from: 'blueprint:' + blueprints.pin(blueprint), refused: [] };
}

/**
 * ⭐⭐⭐ NAMES BECOME CITATIONS ([TILL-114]). The blueprint and the upload both hand over a category NAME;
 * the shop's own master turns it into an id, creating the ones it does not have. So a product written here
 * cites `categories: [id]` like every properly-authored product, instead of the legacy `category` key that
 * [TILL-107] was writing.
 * ⚠️ MATCHED CASE-INSENSITIVELY by lib/categories, so a shop that already has "Vegetables" does not
 * acquire "vegetables" beside it — which is the free-text pollution a master exists to prevent.
 * ⚠️ THE SAME `created_by` routes/definitions.js writes — `req.identity.identity_id`. My first cut
 * called `auth.userOf`, which does not exist, behind a guard that would have written null for ever.
 * A counter authenticated by a KEY genuinely has no identity, so null here is honest, not a bug.
 * → Map(category name → id); it throws when the categories cannot be set up (the caller answers in words)
 */
async function ensureCategoriesFor(entity_id, items, req) {
  const wanted = [...new Set(items.map((item) => item.categoryName).filter(Boolean))];
  if (!wanted.length) return new Map();
  return categories.ensureCategories(entity_id, wanted, { withEntity, by: (req.identity && req.identity.identity_id) || null });
}

/** the items with their category cited by id (`category_names` is NOT written: catalogue-columns reserves it as *"a positional copy … for counterparties who cannot resolve our ids"*, and we can resolve our own) */
function citeCategories(items, catIds) {
  return items.map((item) => {
    const out = Object.assign({}, item);
    const id = item.categoryName ? catIds.get(item.categoryName) : null;
    delete out.categoryName;
    if (id) out.categories = [id];
    return out;
  });
}

/**
 * "12 products added, and 2 rows could not be".
 * ⚠️ REFUSALS TRAVEL BACK WITH THEIR ROW NUMBERS. An upload that quietly loses eleven of four hundred
 * products is the worst outcome here — nobody finds out until a customer asks for one.
 */
function catalogueAddedWords(added, refusedCount) {
  return (
    added +
    ' product' +
    (added === 1 ? '' : 's') +
    ' added' +
    (refusedCount ? ', and ' + refusedCount + ' row' + (refusedCount === 1 ? '' : 's') + ' could not be' : '')
  );
}

/** ⭐ what a counter may start from — the trades, their outcomes, and what the axiom actually is */
router.get('/catalogue/blueprints', auth, auth.requireScope('till'), ...checked('GET /catalogue/blueprints'), async (req, res) => {
  try {
    const blueprints = require('../lib/catalogue-blueprint');
    let have = 0;
    try {
      have = await require('../lib/catalogue-write').countItems(auth.entityOf(req));
    } catch (e) {
      log.fellBack('till GET /catalogue/blueprints: failed — carried on without it', e);
    }
    res.json({
      version: blueprints.VERSION,
      axiom: blueprints.AXIOM,
      enrich: blueprints.ENRICH,
      have: have,
      blueprints: Object.keys(blueprints.BLUEPRINTS).map((name) => blueprintCard(blueprints, name))
    });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** one trade's card: its key, label, outcome, pin, how many products and units and categories it starts with, and a four-name sample */
function blueprintCard(blueprints, name) {
  const blueprint = blueprints.blueprint(name);
  return {
    key: blueprint.key,
    label: blueprint.label,
    outcome: blueprint.outcome,
    pin: blueprints.pin(blueprint),
    products: blueprint.starter.length,
    units: blueprint.units,
    categories: blueprint.categories,
    sample: blueprint.starter.slice(0, 4).map((entry) => entry.name)
  };
}

/**
 * ── ⭐⭐⭐ GET /api/till/summary — THE SHOP'S TREND, ACROSS EVERY COUNTER ([TILL-124]) ───────────
 *
 * Athi: *"this can be kept in local and also in server"* — the server half of the rollup ([TILL-122]).
 *
 * ⭐ THE ONE THING ONLY THE SERVER CAN DO. A counter can fold its OWN day, week and month; it cannot see the
 * counter at the other end of the shop. Two tills each send `day-2026-09-16`, and the shop's actual takings for
 * that day are the two folded together. That fold has no home on any single counter.
 *
 * ⚠️ IT FOLDS WITH THE SAME FUNCTION THE COUNTER USES — lib/rollup.fold(), the one held byte-equal in the kit
 * by scripts/vendor-till.cjs. A server-side re-implementation would be the fourth copy of arithmetic that has
 * already disagreed with itself three times, on the figures that become the shop's permanent record once the
 * daily detail is purged. [[feedback-no-duplicate-functions]] [[project-js-unification]]
 *
 * ⚠️ WITH RLS. Every read goes through withEntity(), so the shop sees its own summaries and nothing else —
 * chit_header is FORCE RLS and a query outside withEntity() would return an empty set rather than an error.
 *
 * ⚠️⚠️ PURPOSE ALONE IS NOT ENOUGH TO FIND THEM. A summary chit is purpose 'general' — and so is a SHIFT
 * chit, which the counter has been sending since 2026-09-08. The test is `business_json ? 'summary'`; matching
 * on purpose would have folded shift records into the day's takings.
 *
 * ⚠️ NO DIRECTION TEST, for the reason recorded on /bills below: a counter chit is one the shop sends to
 * ITSELF, and a self chit lands as 'received'. Asking for 'sent' is what made "Earlier bills" empty for weeks.
 */
const SUMMARY_BILLS = 60,
  SUMMARY_BILLS_MAX = 400; /* how many bills one period summary rolls up */
/*
 * ⭐ RPT2 (2026-10-17) · ?compare=1&period=week|month|quarter|year&n= → Reports › Trend: { period, n, currency, fy_start_month, slots, sales_from, sales_note } —
 * rollup.series (the ONE comparison calculation) over the same summaries, each slot beside the same slot last year. ONE trip (readBatch:
 * the shop's year + the summaries). 422 NO_COUNTRY / NO_MONEY with the one sentence when the shop's country, money or year is unstated.
 * Who may call: the shop's own session or key (auth, own entity, RLS through readBatch). Without compare=1 the answer is unchanged.
 */
router.get('/summary', auth, ...checked('GET /summary'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    if (req.query.compare === '1') {
      const trend = await require('../lib/till-summary').trend(entity_id, req.identity && req.identity.identity_id, {
        period: req.query.period,
        n: req.query.n,
        now: Date.now()
      });
      if (trend.status !== 200) return problem(req, res, { status: trend.status, ...relayed(trend.body) }); // the trend's refusals (400 BAD_PERIOD, 422 NO_COUNTRY / NO_MONEY) keep its own codes and words
      /* S34: the trend's answer, every key lib/till-summary trend() returns (JSON leaves an undefined one out) */
      return res.status(200).json({ period: trend.body.period, n: trend.body.n, currency: trend.body.currency, fy_start_month: trend.body.fy_start_month, slots: trend.body.slots, sales_from: trend.body.sales_from, sales_note: trend.body.sales_note });
    }
    res.json(await periodSummary(entity_id, req.query));
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * the period's bills rolled up across the counters: { period, rows, counters }.
 * ⭐ THE FOLD LIVES IN THE ENGINE, not here — rollup.acrossCounters(). The risky part of it (one row per
 * counter per period, newest wins, because counting a re-send twice would DOUBLE a day's takings) is then
 * guarded by tests/rollup.test.js without needing a database to exercise it.
 * ⚠️ The query is ordered newest-first, which acrossCounters() relies on.
 */
async function periodSummary(entity_id, asked) {
  const rollup = require('../lib/rollup');
  const tillSummary = require('../lib/till-summary');
  const period = rollup.PERIODS.indexOf(asked.period) >= 0 ? asked.period : 'day';
  const limit = pageLimit.limitOf(asked.limit, SUMMARY_BILLS, SUMMARY_BILLS_MAX); /* the one clamp */
  const { withEntity: nestedWithEntity } = require('../db');
  const statement = tillSummary.summaryStatement(entity_id, period, limit); /* lib/till-summary: the ONE copy of the statement (its follow-up, done) */
  const found = await nestedWithEntity(entity_id, (db) => db.query(statement.text, statement.params));
  const rows = rollup.acrossCounters(found.rows.map((row) => (row.business_json || {}).summary)).slice(0, limit);
  return {
    period,
    rows,
    counters: Array.from(new Set(found.rows.map((row) => (((row.business_json || {}).summary || {}).till || {}).id).filter(Boolean))).sort()
  };
}

const BILLS_PAGE = 100,
  BILLS_MAX = 500; /* the day report's bills: the statement always cuts at the page */
router.get('/bills', auth, ...checked('GET /bills'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const days = Math.min(Math.max(parseInt(req.query.days || '30', 10) || 30, 1), 365);
    const page = pageLimit.pageArgs({ limit: req.query.limit != null ? req.query.limit : BILLS_PAGE }, BILLS_PAGE, BILLS_MAX);
    const by = typeof req.query.by === 'string' && /^[0-9a-f-]{36}$/.test(req.query.by) ? req.query.by : null;
    /* ⭐ FX-CT1: ONE COUNTER'S BILLS — the day report asks what the server holds for THIS counter. Filtered in SQL, because the
       LIMIT runs first: on a busy shop the other counters' bills would crowd this one's out of a JS filter. */
    const till = typeof req.query.till === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(req.query.till) ? req.query.till : null;
    const { withEntity: nestedWithEntity } = require('../db');
    const found = await nestedWithEntity(entity_id, (db) =>
      db.query(BILLS_SQL, [entity_id, String(days), page.limit /* always a page: the statement cuts */, till])
    );
    const rows = found.rows.map(billRow).filter((bill) => bill.no && (!by || (bill.by && bill.by.id === by)));
    const paged = pageLimit.pageOut('bills', rows, page, rows.length);
    res.json({ days, count: rows.length, bills: paged.bills, total: paged.total, page: paged.page, limit: paged.limit, capped: paged.capped, cap_note: paged.cap_note }); /* S34: every key the pager can add is named (capped, cap_note) */
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * the shop's own counter bills inside the window, newest first (the comments sit inside the statement: they are part of the text the database receives).
 * ⚠️ line_items is on chit_detail — chit_header has never had it (2026-09-08)
 */
const BILLS_SQL = `SELECT h.chit_id, h.created_at, h.business_json, d.line_items, h.summary_json
         FROM chit_header h
         LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
       /**
        * ⚠️⚠️ NO DIRECTION TEST — AND THAT IS THE WHOLE BUG. A counter bill is a chit the shop sends to ITSELF, and a SELF chit
        * lands with direction 'received', not 'sent'. We knew that: it is why business_json.side exists and why sideOf() was
        * written. This query was still asking for 'sent', so it matched nothing, and "Earlier bills" has been an empty list since
        * the day it shipped — a screen that answers "you have no bills" to a shop that has been billing all week.
        *
        * ⚠️ It found nothing rather than erroring, which is why nobody noticed. [ISO-01] only caught it because it asked the
        * SERVER where the money went instead of believing the counter's own copy.
        *
        * The identity of a bill is the entity, the purpose, and the fact that it carries a bill_no. Direction is a fact about
        * who the counterparty was, and for a shop billing itself it is not the question being asked.
        */
        /* ⭐ credit notes belong in the day's list. Left out, the counter would show a day's sales that the
           books disagree with, and the one document a shopkeeper most needs to find again would be invisible. */
        /* ⚠️ AND SENT BY ME (the two-sided counter bill, 2026-10-01): a supplier's counter bill I RECEIVED carries a bill_no
           and a till too — it is my purchase, never one of "my earlier bills" (lib/books-store counterBills asks the same) */
        WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.purpose IN ('order','offer','credit_note')
          AND h.business_json ? 'bill_no'
          AND h.created_at > NOW() - ($2 || ' days')::interval
          AND ($4::text IS NULL OR upper(h.business_json -> 'till' ->> 'id') = upper($4::text))
        ORDER BY h.created_at DESC LIMIT $3`;

/** one earlier bill as the counter reprints it: who, when, what was paid and saved, the stored invoice, and its lines */
function billRow(row) {
  const business = row.business_json || {};
  return {
    chit_id: row.chit_id,
    ...billWho(row, business),
    total: counterBill.paidOf(row.summary_json) /* the one pick of what was paid (lib/counter-bill paidOf) — the reward earns from the same figure */,
    ...billMoney(row),
    ...billSlip(business),
    lines: (Array.isArray(row.line_items) ? row.line_items : []).map(billLine)
  };
}

/** the bill's number, its moment, its customer and the counter and person that billed it */
function billWho(row, business) {
  const till = business.till || {};
  return {
    no: business.bill_no || null,
    at: business.billed_at || row.created_at,
    customer: (business.customer && business.customer.name) || 'Walk-in',
    by: till.by || null,
    till: { id: till.id || null, name: till.name || null }
  };
}

/** the slip as it was printed: its kind, the payments, the stored invoice and where the order went */
function billSlip(business) {
  return {
    kind: business.slip || 'cash',
    /* M41: a tax bill saved while the shop's details disagreed reprints as NOT a tax invoice, from any device */
    not_invoice: business.not_invoice || null,
    /* walk 2026-10-09 (BF3/BF8): where the order went and the chosen modifiers, so a reprint says them too */
    order: business.order && typeof business.order === 'object' ? business.order : null,
    payments: (business.payment && business.payment.parts) || [],
    /* ⭐⭐ THE STORED INVOICE, AS IT IS (2026-10-02) — the counter's CBTax.determine() result. The page reprints from it
            (till.html slipOfRow → moneyOf), so a duplicate is the same document as the original: "Earlier bills → print"
            of C2/26-27/0007 printed taxable ₹1,118.15 and GST ₹0.00 on a TAX INVOICE. null for a bill that never carried one. */
    invoice: business.invoice && typeof business.invoice === 'object' && business.invoice.ValDtls ? business.invoice : null
  };
}

/** saved · taxable · tax of a bill, from its summary money — null where the bill did not carry them */
function billMoney(row) {
  const money = (row.summary_json || {}).money || {};
  return {
    saved: money.savings != null ? money.savings : null,
    taxable: money.taxable != null ? money.taxable : money.net != null ? money.net : null,
    tax: money.tax != null ? money.tax : null
  };
}

/** one bill line as the counter reprints it */
function billLine(item) {
  return {
    name: item.particulars || item.name,
    qty: item.quantity,
    unit: item.unit,
    price: item.price,
    net: item.total,
    save: (item.offer && item.offer.off) || 0,
    off: !!item.offer,
    off_label: (item.offer && item.offer.label) || '',
    gst_rate: item.gst_rate,
    hsn: item.hsn,
    mods: Array.isArray(item.mods) ? item.mods : null
  };
}

/**
 * ⭐⭐ WHAT IS STILL OWED, EITHER WAY (2026-09-08 — purchase and despatch in the till format).
 *
 *   GET /api/till/tasks?kind=receive    the orders WE SENT that are not fully received  → the goods-in screen
 *   GET /api/till/tasks?kind=despatch   the orders WE RECEIVED that are not fully sent  → the picking screen
 *
 * One call, the same posture as the snapshot: the shop's own world, small enough to hold on a device and work from with the line
 * down. Each line carries what was ordered and what has already moved, so the screen can show REMAINING without arithmetic of its own.
 * ⚠️ Progress comes from lib/deliverline (b144) — events, never a stored total — so a part delivery recorded from anywhere, by
 * either party, is already reflected here. Nothing about "how much is left" is computed twice.
 * ⚠️ A chit whose lines are all complete is not a task. The screen must never show work that is done.
 */
const cost = require('../lib/cost'); /* RAIL-146c: can_see_costs, read ONCE per request (isCostBlind) */
const costView = require('../lib/cost-view'); /* RAIL-146c: what a cost-blind reader may read of the tasks and the match */
const deliverline = require('../lib/deliverline');
const select = require('../lib/select'); /* ⭐ the shared selector: one definition of "my chits", counterparty included */

const { sideOf } = require('../lib/open-orders'); /* ONE definition of an open order: lib/open-orders (the till's list and Home's Orders card, M168) */
const TASKS_PAGE = 40,
  TASKS_MAX = 100; /* the counter's open-order tasks */
router.get('/tasks', auth, ...checked('GET /tasks'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const kind = String(req.query.kind || 'despatch') === 'receive' ? 'receive' : 'despatch';
    const limit = pageLimit.limitOf(req.query.limit, TASKS_PAGE, TASKS_MAX); /* the one clamp */
    const blind = await cost.isCostBlind(req, entity_id), ignored = costView.moneyParams(req, blind); /* RAIL-146c: ONE can_see_costs read; a blind reader's tasks lose the purchase money (lib/cost-view) */
    const out = await require('../lib/open-orders').tasks(entity_id, kind, limit, blind);
    res.json({ kind, count: out.length, tasks: out, total: out.length, page: 1, limit, cost_params_ignored: costView.ignoredField(ignored) });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/**
 * ⭐⭐⭐ THE THREE-WAY MATCH (2026-09-08 — the spec's phase 5, and the sentence the product is sold on).
 *
 *   GET /api/till/match?days=90   every purchase order with what was ORDERED, what was RECEIVED and what was INVOICED, side by side
 *
 * PO ↔ GRN ↔ invoice is the oldest control in purchasing, and an ERP can only run it when ONE company holds all three documents.
 * Here the order is a chit we sent, the receipt is what our own door wrote, and the invoice is either a chit they sent or the figure
 * their paper bill carried — so the match happens ACROSS PARTIES, which is the thing no ERP can do.
 *
 * ⚠️ IT NEVER RESOLVES A DIFFERENCE, IT NAMES ONE. CB takes no side: what was ordered, what was counted and what was charged are three
 * claims, and the screen shows all three with the reason the person at the door gave. Deciding between them is a dispute, which is a
 * conversation between two parties — not an arithmetic the server can do on their behalf.
 * ⚠️ THIS IS AN OWNER'S SCREEN, NOT A COUNTER'S. It lives in this file because it reads the same documents, but it is deliberately
 * OUTSIDE the till scope: a counter device may record what it witnesses and must never read what the shop pays its suppliers.
 * ⚠️ RECEIVED comes from lib/deliverline (events, never a stored total), so a part delivery, a correction, or the counterparty's own
 * claim are all already in it.
 */
router.get('/match', auth, ...checked('GET /match'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const blind = await cost.isCostBlind(req, entity_id), ignored = costView.moneyParams(req, blind); /* RAIL-146c: ONE can_see_costs read (the landed strip folded in) */
    const days = Math.min(Math.max(parseInt(req.query.days || '90', 10) || 90, 1), 365);
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    /* both directions: a purchase order for an off-platform supplier is a SELF chit and lands as 'received' */
    const heads = await select.rows(entity_id, { purpose: 'order', since, limit: 300 });
    /* what this trade absorbs — the same numbers the counter was given in its snapshot */
    const flags = await policy.get(entity_id).catch(log.orElse('till GET /match: failed — answered with an empty set', {}));
    const tolerance = { weight_bp: flags.tol_weight_bp == null ? 50 : Number(flags.tol_weight_bp), count_units: Number(flags.tol_count_units) || 0 };
    if (!heads.length) return res.json({ days, count: 0, orders: [], total: 0, page: 1, limit: 0 });

    const { withEntity: nestedWithEntity } = require('../db');
    /* [OFFR-04] landed = goods + freight etc. as the shop paid it, and RAIL-146c every rate and total: cost, so owner / can_see_costs / the paired key only; a blind reader's order goes through lib/cost-view MATCH_KEEP, its side from costSideOf */
    const orders = await nestedWithEntity(entity_id, async (db) => matchSeen(db, entity_id, heads, blind, await matchOrders(db, entity_id, heads, days, tolerance)));
    const paged = pageLimit.pageOut('orders', orders, pageLimit.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX));
    res.json({ days, count: orders.length, orders: paged.orders, total: paged.total, page: paged.page, limit: paged.limit, capped: paged.capped, cap_note: paged.cap_note, cost_params_ignored: costView.ignoredField(ignored) }); /* S34: every key the pager can add is named (capped, cap_note) */
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** the match orders for their reader: as built for the owner, a cost-allowed actor and the paired key; a cost-blind reader's through lib/cost-view (the old hideLanded folded in), ONE side read for the page */
async function matchSeen(db, entity_id, heads, blind, orders) {
  if (!blind || !orders.length) return orders;
  const shown = new Set(orders.map((order) => String(order.chit_id)));
  return costView.tillRows(db, entity_id, heads.filter((head) => shown.has(String(head.chit_id))), orders, costView.hideMatchCosts, 'buy'); /* the match is about what we BUY: cost-side whatever the party list says (no side read) */
}

/** every purchase order beside what was received and what was invoiced, read on one transaction handle */
async function matchOrders(db, entity_id, heads, days, tolerance) {
  const { byId, receiptsFor, invoices } = await matchDocuments(db, entity_id, heads, days);
  const orders = [];
  for (const head of heads) {
    const detail = byId.get(String(head.chit_id)) || {};
    const business = detail.business_json || {};
    if (business.bill_no) continue; /* a counter sale is not a purchase order */
    if (sideOf(head, business) !== 'buy') continue; /* the match is about what we BUY */
    const progress = await deliverline.progress(entity_id, head.chit_id, db).catch(log.orElse('till GET /match: failed — answered with nothing', null));
    const order = matchOrder(head, detail, business, progress, receiptsFor.get(String(head.chit_id)) || [], invoices, tolerance);
    if (order) orders.push(order);
  }
  return orders;
}

/** the three documents the match sets side by side: the orders' detail, the receipts our own door wrote against them, and the invoices they sent */
async function matchDocuments(db, entity_id, heads, days) {
  const detailRows = await db.query(
    `SELECT h.chit_id, d.line_items, h.business_json
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.chit_id = ANY($2::uuid[])`,
    [entity_id, heads.map((item) => item.chit_id)]
  );
  const byId = new Map(detailRows.rows.map((item) => [String(item.chit_id), item]));

  /* the receipts our own counter wrote against these orders — that is where the supplier's bill figure was captured */
  const receiptRows = await db.query(
    `SELECT h.chit_id, h.created_at, h.business_json, d.line_items
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.purpose = 'receipt'   /* ⚠️ no direction: our own receipt is a SELF chit, which lands as 'received' */
            AND h.created_at > NOW() - ($2 || ' days')::interval`,
    [entity_id, String(days + 30)]
  );

  /* an invoice they SENT us, if they are on ChitBridge at all */
  const invoiceRows = await db.query(
    `SELECT h.chit_id, h.created_at, h.sender_entity_id, h.summary_json, d.line_items, h.business_json
           FROM chit_header h
           LEFT JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
          WHERE h.entity_id = $1 AND h.direction = 'received' AND h.purpose = 'invoice'
            AND h.created_at > NOW() - ($2 || ' days')::interval`,
    [entity_id, String(days + 30)]
  );
  return { byId, receiptsFor: receiptsByOrder(receiptRows.rows), invoices: invoiceRows.rows };
}

/** the receipts our own door wrote, grouped by the order they are against: Map(order chit id → [receipt]) */
function receiptsByOrder(rows) {
  const receiptsFor = new Map();
  for (const row of rows) {
    const business = row.business_json || {};
    const against = business.against && business.against.chit_id;
    const key = against ? String(against) : null;
    if (!key) continue;
    if (!receiptsFor.has(key)) receiptsFor.set(key, []);
    receiptsFor.get(key).push(receiptOf(row, business));
  }
  return receiptsFor;
}

/** one receipt of an order: its number and moment, the supplier's bill as keyed at the door, the goods · extras · landed figures and its lines */
function receiptOf(row, business) {
  return {
    chit_id: row.chit_id,
    no: business.doc_no || null,
    at: business.doc_at || row.created_at,
    their_bill: business.their_bill || null,
    goods: business.goods == null ? null : Number(business.goods),
    extras: business.extras == null ? null : Number(business.extras),
    landed: business.landed_total == null ? null : Number(business.landed_total),
    lines: Array.isArray(row.line_items) ? row.line_items : []
  };
}

/**
 * one order beside its receipts and their invoice, or null when it has no lines.
 * ⭐ THE VERDICT IS ABOUT WHAT IS KNOWN, not about who is right.
 *   awaited   nothing has arrived yet
 *   open      some has, some has not
 *   agreed    everything arrived as ordered, and the money agrees
 *   differs   something does not agree, and the line says what
 */
function matchOrder(head, detail, business, progress, receipts, invoices, tolerance) {
  const lines = (Array.isArray(detail.line_items) ? detail.line_items : []).map((item) => matchLine(item, progress, receipts, tolerance));
  if (!lines.length) return null;
  const invoice = theirInvoice(head, receipts, invoices);
  const ordered_total = roundMoney(lines.reduce((total, item) => total + item.ordered * (item.rate || 0), 0));
  const received_total = roundMoney(lines.reduce((total, item) => total + item.received * (item.rate || 0), 0));
  const differences = lines.filter((item) => item.difference !== 0 && !item.absorbed).length;
  const money_gap = invoice.total == null ? null : roundMoney(received_total - invoice.total);
  return {
    chit_id: head.chit_id,
    at: head.created_at,
    ...orderParty(head, business),
    lines,
    differences,
    verdict: matchVerdict(lines, differences, money_gap),
    ordered_total,
    received_total,
    invoiced_total: invoice.total,
    invoiced_from: invoice.from,
    money_gap,
    receipts: receipts.map((item) => ({
      chit_id: item.chit_id,
      no: item.no,
      at: item.at,
      landed: item.landed,
      their_bill_no: (item.their_bill && item.their_bill.no) || null
    }))
  };
}

/** the order's subject line and who it is with */
function orderParty(head, business) {
  return {
    subject: head.manual_subject || head.auto_subject || '',
    party: head.counterparty_name || (business.party && business.party.name) || '',
    party_id: head.counterparty_id || null
  };
}

/** their invoice: a chit from this counterparty, else the figure keyed off their paper bill at the door → { total, from } (both null when there is none) */
function theirInvoice(head, receipts, invoices) {
  const theirChit = invoices.find((invoice) => head.counterparty_id && String(invoice.sender_entity_id) === String(head.counterparty_id)) || null;
  const keyed = receipts
    .map((item) => (item.their_bill && item.their_bill.total != null ? Number(item.their_bill.total) : null))
    .filter((value) => value != null);
  if (theirChit) return { total: Number((theirChit.summary_json || {}).total_value || 0), from: 'their invoice' };
  return keyed.length ? { total: keyed.reduce((first, second) => first + second, 0), from: 'their bill, keyed at the door' } : { total: null, from: null };
}

/** awaited · differs · open · agreed — see matchOrder */
function matchVerdict(lines, differences, money_gap) {
  if (lines.every((item) => item.received === 0)) return 'awaited';
  if (differences) return 'differs';
  if (lines.some((item) => item.received < item.ordered)) return 'open';
  return money_gap != null && money_gap !== 0 ? 'differs' : 'agreed';
}

/** one ordered line beside what was received: the difference, the reason the door gave, and whether this trade absorbs it */
function matchLine(item, progress, receipts, tolerance) {
  const ordered = Number(item.quantity) || 0;
  const received = receivedOf(progress, item);
  const diff = Math.round((received - ordered) * 1000) / 1000;
  /* ⭐ THE SAME TOLERANCE THE DOOR APPLIED (lib/lotfields, one definition for both ends). A difference this trade absorbs is
     not a difference to chase — and both figures still show, because tolerance decides what is worth a conversation, never
     what is true. */
  const absorbed = diff !== 0 && lotfields.withinTolerance(diff, ordered, item.unit, tolerance);
  return {
    line_id: item.line_id,
    name: item.particulars || item.name || '',
    unit: item.unit || 'piece',
    rate: item.price == null ? null : Number(item.price),
    ordered,
    received,
    difference: diff,
    reason: doorReason(item, receipts),
    absorbed,
    state: lineState(diff, received, absorbed)
  };
}

/** how much of the line has been received, from the delivery events (lib/deliverline progress) */
function receivedOf(progress, item) {
  const delivered = progress && progress.get ? progress.get(item.line_id) : null;
  return delivered && delivered.delivered != null ? Number(delivered.delivered) : 0;
}

/** agreed · awaited · short · excess */
function lineState(diff, received, absorbed) {
  if (diff === 0) return received > 0 ? 'agreed' : 'awaited';
  if (absorbed) return 'agreed';
  return diff < 0 ? 'short' : 'excess';
}

/** the reason the person at the door gave, carried on the receipt's own line (the last one given) */
function doorReason(item, receipts) {
  let reason = null;
  for (const receipt of receipts) {
    for (const line of receipt.lines) {
      const lineData = line.item_data || {};
      const sameLine = lineData.line_id === item.line_id || line.particulars === (item.particulars || item.name);
      if (sameLine && lineData.reason) reason = lineData.reason;
    }
  }
  return reason;
}

/**
 * ⭐⭐ REMEMBER WHAT THE SUPPLIER CALLS IT (2026-09-08).
 *
 *   POST /api/till/alias   { item_id, by, text, unit?, factor? }
 *
 * Their line says "SUNFL OIL 1L RB"; ours says "Sunflower oil 1 L". Somebody pairs them ONCE at the door and the counter never asks
 * again — which is the whole difference between the first delivery from a vendor and the fortieth. The pairing carries a CONVERSION
 * too, because their carton is our twenty-four pieces, and pack size is where most "mismatches" actually come from.
 *
 * ⚠️ IT LIVES ON THE PRODUCT, not in a table of its own — "what this vendor calls it" is a fact about the product, and putting it in
 * item_data means no migration and no second place to look. Merge-patched, so nothing else in item_data is touched.
 * ⚠️ THE NARROWEST POSSIBLE WRITE. A till key cannot touch products; this endpoint can append an alias and do nothing else, which is
 * why it exists rather than widening the scope to PATCH /api/products.
 */
router.post('/alias', auth, ...checked('POST /alias'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const input = aliasInput(req.body);
    const refusal = aliasRefusal(input);
    if (refusal) return problem(req, res, { status: 400, ...refusal });

    const aliases = await withEntity(entity_id, (db) => addAlias(db, entity_id, input));
    if (!aliases) return problem(req, res, { status: 404, ...said('NOT_FOUND', 'no such product') });
    res.json({ ok: true, aliases });
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

/** POST /alias input: the product, the supplier's words and name, and the optional unit and pack factor (null when blank) */
function aliasInput(body) {
  const given = body || {};
  return {
    item_id: String(given.item_id || '').trim(),
    text: String(given.text || '').trim(),
    by: String(given.by || '').trim(),
    unit: given.unit ? String(given.unit).trim().slice(0, 24) : null,
    factor: given.factor == null || given.factor === '' ? null : Number(given.factor)
  };
}

/** the spec of the 400 for an alias that is missing its words, too long, or carries a pack factor that is not a positive number; null when it is fine */
function aliasRefusal(input) {
  if (!input.item_id || !input.text) return said('TILL_BAD_REQUEST', 'an alias needs an item and the words the supplier uses');
  if (input.text.length > 120 || input.by.length > 120) return said('TILL_BAD_REQUEST', 'too long');
  const factor = input.factor;
  if (factor != null && (!Number.isFinite(factor) || factor <= 0 || factor > 100000)) return said('TILL_BAD_REQUEST', 'a pack conversion is a positive number');
  return null;
}

/** append the alias to the product (saying it again replaces what was said before); the product's aliases, or null when it is not this shop's */
async function addAlias(db, entity_id, input) {
  const { item_id, text, by, unit, factor } = input;
  const found = await db.query('SELECT item_data FROM catalogue_items WHERE entity_id = $1 AND item_id = $2', [entity_id, item_id]);
  if (!found.rows.length) return null;
  const data = found.rows[0].item_data || {};
  const list = Array.isArray(data.aliases) ? data.aliases.slice(0, 50) : [];
  const same = (alias) => String(alias.text || '').toLowerCase() === text.toLowerCase() && String(alias.by || '').toLowerCase() === by.toLowerCase();
  const kept = list.filter((item) => !same(item)); /* saying it again replaces what was said before */
  kept.push({ by: by || null, text, unit, factor, at: new Date().toISOString() });
  await catwrite.patchItems(db, entity_id, [{ item_id, merge: { aliases: kept } }]);
  return kept;
}

/**
 * ⭐⭐ SPEAK, AND GET WORDS BACK (2026-09-08). Athi: *"build the seam with whisper behind it, I'll test the accuracy."*
 *
 *   POST /api/till/listen   { audio: <base64>, mime, format, lang, hint }  →  { ok, text, provider, ms }
 *
 * ⚠️ THE AUDIO IS NEVER STORED. It is decoded, transcribed and dropped — not to disk, not to a table, not to a log. A recording of a
 * customer saying their phone number is not something to be holding, and the only way to be certain is not to hold it.
 * ⚠️ IT NEVER FAILS LOUDLY. Every problem comes back as ok:false with a sentence, and the counter falls back to the browser's own
 * recogniser — a microphone must never be the reason a sale stops.
 * ⚠️ AND IT IS RATE-LIMITED BY SIZE, not by a counter: two megabytes is about a minute, and a counter says three seconds at a time.
 */
router.post('/listen', auth, ...checked('POST /listen'), async (req, res) => {
  try {
    const body = req.body || {};
    const audio = String(body.audio || '');
    if (!audio) return res.json({ ok: false, why: 'nothing was recorded' });
    let buf;
    try {
      buf = Buffer.from(audio, 'base64');
    } catch (_) {
      return res.json({ ok: false, why: 'that recording could not be read' });
    }
    if (buf.length > speech.MAX_BYTES) return res.json({ ok: false, why: 'that is too long — say it in one short phrase' });
    const out = await speech.transcribe(buf, { mime: body.mime, format: body.format, lang: body.lang, hint: body.hint });
    res.json(out);
  } catch (e) {
    res.json({ ok: false, why: safeErr(e) });
  } /* L2: ok:false in words (the counter falls back to the browser's recogniser), never the raw error text */
});

/**
 * ⭐ THE ENGINES, SERVED (2026-09-07). A till has to price with the line down, so it keeps its own copy of the three engines — and it
 * gets them from here rather than from a second host, so there is one place that answers "which version is the counter running".
 * Cached by the till at install and refreshed with the snapshot; both files are the SAME code the server and the app run.
 */
/**
 * ⚠️ EVERY ENGINE THE PAGE LOADS MUST BE HERE. The browser gets them from /engine/*.js on the web host; a shop PC gets them ONLY
 * through this map, so an engine missing from it works in a browser and is silently absent on the desktop counter — the worst kind
 * of difference, because it only shows up on the machine nobody is testing on. `lots` was missing exactly that way (2026-09-08).
 */
const ENGINES = {
  offers: '../lib/offers-engine.js',
  tax: '../lib/tax-engine.browser.js',
  search: '../lib/search-engine.js',
  gs1: '../lib/gs1.js' /* ADOPTED — one file for node and the page */ /* what a pack's barcode carries — batch, expiry, serial */,
  lots: '../lib/lotfields.js' /* ADOPTED — one file for node and the page */ /* what this trade must capture, and the difference it absorbs */,
  nums: '../lib/numerals.js' /* ADOPTED — one file for node and the page */ /* "two kilo", "rendu kilo" — the closed class, in both */,
  rewards: '../lib/rewards.js' /* ⚠️ THE MASTER ITSELF — it is a UMD and needs no browser wrapper */,
  /* ⭐ 2026-09-17: the rest of what the page loads — a shop PC had none of these (scripts/vendor-till.cjs) */
  screen: '../lib/screen-kit.js' /* the screen library — a UMD, the master itself */,
  money: '../lib/money.js' /* ⭐ ADOPTED from chitbridge-engines — one file for node and the page, no wrapper */,
  docnumber: '../lib/docnumber.js' /* ADOPTED — one file for node and the page */,
  locale: '../lib/locale.browser.js',
  pricing: '../lib/pricing-engine.js' /* ADOPTED — one file for node and the page */,
  /* ⭐ VARIANTS — what makes two combinations the SAME thing to sell. A shop PC bills
                     combinations with the line down, so it needs the rule locally like every other engine. */
  variant: '../lib/variant.browser.js',
  /* ⭐ counted or measured — what stops a bill reading '0.25 items' ([TILL-104]) */
  units: '../lib/units.js' /* ADOPTED — one file for node and the page */,
  /* ⭐ the GSTIN / PAN / state table, so a shop PC confirms one offline too ([TILL-105]) */
  profilemap: '../lib/profile-map.js' /* ADOPTED — one file for node and the page */,
  /* ⚠️ THE MASTER ITSELF — already a classic script that assigns its own global, like rewards */
  jurisdiction: '../lib/jurisdiction.js',
  govcontext: '../lib/govcontext.browser.js',
  /* ⭐ what a day's takings are, and what a return does to them — one rule for the page, the
                     shop PC and this server ([TILL-125]) */
  rollup: '../lib/rollup.js' /* ADOPTED — one file for node and the page */,
  orders: '../lib/orders.js' /* ADOPTED — one file for node and the page */,
  orderhub: '../lib/orderhub.js' /* ADOPTED — one file for node and the page */,
  dayopen: '../lib/dayopen.js' /* ADOPTED — one file for node and the page */,
  signin: '../lib/signin.js' /* ADOPTED — one file for node and the page */,
  scalecode: '../lib/scalecode.js' /* ADOPTED — one file for node and the page */,
  qty: '../lib/qty.js' /* ADOPTED — one file for node and the page */,
  /* ⭐ what a counter TELLS somebody when something is wrong — one table, every surface */
  verdict: '../lib/verdict.js' /* ADOPTED — one file for node and the page */,
  qr: '../node_modules/qrcode-generator/qrcode.js'
};
router.get('/engine/:name', auth, ...checked('GET /engine/:name'), (req, res) => {
  const enginePath = ENGINES[String(req.params.name || '')];
  if (!enginePath) return problem(req, res, { status: 404, ...notFound() });
  try {
    const file = require('path').join(__dirname, enginePath);
    const body = require('fs').readFileSync(file, 'utf8');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  } catch (e) {
    problem(req, res, failed(e, req));
  }
});

router.openapi = { paths: pathsOf(), schemas: {} };

module.exports = router;
