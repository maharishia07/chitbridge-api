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
  return supplier.display_name + ' does not show a catalogue to other businesses, so there is nothing to order from here.';
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
  if (!reply || !reply.ok || !reply.found || reply.sign_in) return emptyView(supplier, { ok: false, installation_key: place.key, why: wordsFor(supplier, place, reply) });
  const view = {};
  for (const key of Object.keys(reply)) if (!ENVELOPE_KEYS.includes(key)) view[key] = reply[key];
  return Object.assign({ supplier }, view, { remote: { ok: true, installation_key: place.key, why: null } });
}

module.exports = { forSupplier, ASK_TIMEOUT_MS };
