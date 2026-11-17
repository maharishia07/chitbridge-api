/* A stand-in for POST /api/till/recheck (CTR-243), for walks that run the till against their own little api.
 * The till asks this door before it sends a bill rung without a line; a door that answers {ok:true} with no items is a door that
 * "could not be reached" (decision C, DECISIONS 0b876ee1), so the bill waits on the retry ladder, by design. A walk that is about
 * something else must therefore answer the door honestly: every product asked about is found, at the price the walk sold it at, nothing moved.
 * recheckStub(rawBody, { '<item_id>': price }) -> the body to send with status 200. */
'use strict';
const { nowIso } = require('./today.cjs');   // the walks' one clock (guard-walk-today)
exports.recheckStub = function recheckStub(raw, prices) {
  let ids = [];
  try { ids = (JSON.parse(raw) || {}).item_ids || []; } catch (_) { ids = []; }
  return {
    at: nowIso(),
    items: ids.map((id) => ({ item_id: id, found: true, checked: true, name: id, active: true, price: Number((prices || {})[id]) || 0, changed_at: null })),
    slabs: [], categories: [],
  };
};
