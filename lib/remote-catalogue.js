'use strict';
/*
 * OWNS      reading the catalogue of a supplier who lives on ANOTHER installation (NET-39 walk finding): the signed `catalogue` question, answered in the
 *           SAME shape the local read returns, so the Suppliers screen and the order cart work unchanged.
 * CALLED BY routes/relationships.js GET /suppliers/:supplier_entity_id/catalogue
 * FLOW      ctpaddress.resolve(supplier) → not local → installation domain → ctpquery.ask catalogue (5 s) → { supplier, ...public view } | words
 * CARD      04-network/directory-and-search
 */
/**
 * ⚠️ NOTHING IS COMPUTED HERE. Prices, currency, offers and item ids are the seller's, carried as given (AUD stays AUD); the view is the seller's own public view.
 * ⚠️ A far side that is silent, refuses or shows nothing is said in words in `remote.why` — never an empty "nothing published".
 */
const addressBook = require('./ctpaddress');
const log = require('./logger');

const ASK_TIMEOUT_MS = 5000;
/* keys of the answer that are the question's envelope, not the view */
const ENVELOPE_KEYS = ['ok', 'found', 'why', 'bridge_id'];

const emptyView = (supplier, remote) => ({ supplier, schema: null, fields: [], items: [], groups: [], finishes: [], remote });

/** where does this supplier live? → { local:true } | { key, domain } | { unreachable: words } */
async function placeOf(supplier) {
  const where = await addressBook.resolve(supplier.identity_id);
  if (where.local) return { local: true };
  const installation = (await addressBook.remoteInstallations()).get(where.installation_key);
  if (where.inactive || !installation || !installation.domain) {
    return { unreachable: 'The installation this supplier is on (' + where.installation_key + ') is not available from here right now, so its catalogue cannot be read.' };
  }
  return { key: where.installation_key, domain: installation.domain, label: installation.label || installation.domain };
}

/** the question itself; a thrown failure becomes an answer that says so */
async function askCatalogue(supplier, place, wired) {
  try {
    return await (wired.ask || require('./ctpquery').ask)({ domain: place.domain, bridge_id: supplier.bridge_id }, { want: 'catalogue', bridge_id: supplier.bridge_id }, { timeout: ASK_TIMEOUT_MS });
  } catch (failure) {
    log.fellBack('remote-catalogue: the far installation could not be asked — said in words', failure);
    return { ok: false, why: 'could not be asked' };
  }
}

const silent = (place) => place.label + ' did not answer in ' + ASK_TIMEOUT_MS / 1000 + ' seconds, so this catalogue cannot be shown now. Try again.';

/** words for an answer with no view: silence, a refusal, or a shop that shows nothing */
function wordsFor(supplier, place, reply) {
  if (!reply || !reply.ok) return /timed out/i.test(String(reply && reply.why)) ? silent(place) : place.label + ' could not be asked: ' + ((reply && reply.why) || 'no answer') + '.';
  /* the far side answers a shop that does not sell outside exactly as an unknown id (its existence is not revealed): an EXISTING supplier row is kept, and says so in words (NET-39, DECISIONS 14:50) */
  if (/^no business here with bridge id/.test(String(reply.why || ''))) return require('./remote-party').SELLS_ONLY_HERE(supplier.display_name);
  return supplier.display_name + ' does not show a catalogue to other businesses, so there is nothing to order from here.';
}

/** did the far installation answer with a catalogue we may show (asked, found, not behind a sign-in) */
const shows = (reply) => !!(reply && reply.ok && reply.found && !reply.sign_in);

/** the supplier block in the seller's own money: the currency its answer states, when the stub row here holds none (never converted) */
function inSellerMoney(supplier, view) {
  const sellerMoney = view.shop && view.shop.currency_code;
  return sellerMoney && !supplier.currency_code ? Object.assign({}, supplier, { currency_code: sellerMoney }) : supplier;
}

/**
 * forSupplier(supplier, wired?) → null (a local supplier: the caller reads its own database) | the catalogue payload
 * @param supplier { identity_id, bridge_id, display_name, currency_code }
 */
async function forSupplier(supplier, wired) {
  const place = await placeOf(supplier);
  if (place.local) return null;
  if (place.unreachable) return emptyView(supplier, { ok: false, why: place.unreachable });
  const reply = await askCatalogue(supplier, place, wired || {});
  if (!shows(reply)) return emptyView(supplier, { ok: false, installation_key: place.key, why: wordsFor(supplier, place, reply) });
  const view = {};
  for (const key of Object.keys(reply)) if (!ENVELOPE_KEYS.includes(key)) view[key] = reply[key];
  /* the stub row here holds no money (country and currency are NULL on purpose: the business is elsewhere). The seller's answer states its
     currency (shop.currency_code); the supplier block carries THAT, as given, so the buyer's screen shows A$ for an AUD seller and never
     falls back to its own money (walk 2026-10-25: Sydney's A$12.50 read ₹12.50 in Chennai). Nothing is converted or computed. */
  return Object.assign({ supplier: inSellerMoney(supplier, view) }, view, { remote: { ok: true, installation_key: place.key, why: null } });
}

module.exports = { forSupplier, ASK_TIMEOUT_MS };
