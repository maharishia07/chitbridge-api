'use strict';
/*
 * OWNS      adding a business that lives on ANOTHER installation, by its address (RAIL-101 / NS-3): the local party row, linked to the remote installation.
 * CALLED BY routes/relationships.js POST /suppliers (supplier_bridge_id holding bridge_id@domain, a pasted link or a scanned QR)
 * FLOW      input → ctpaddress.fromShared → ctpaddress.resolveAddress (do we deal with that domain?) → ctpquery.ask resolve (is the business really there?)
 *           → an identities row (bridge_id, name, same world as the owner) → ops.f_place_entity (entity_governance.installation_key = the remote installation)
 * CARD      05-ctp-and-cross-installation/discovery-well-known-ctp-json-address-bridge-id
 */
/**
 * ⭐ NO SECOND RESOLVER. The parse, the "do we deal with that domain" lookup and the signed question already exist (lib/ctpaddress.js, lib/ctpquery.js,
 * tested, with no caller until this file). This is the caller. It adds no table and no column: the DOMAIN stays on the installation row
 * (`installation.domain`), the party reaches it through `entity_governance.installation_key`, and the full address is always COMPUTED
 * (ctpaddress.format(bridge_id, domain)) — CTP-DESIGN 5.1: the bridge id stays opaque and stable, and if the business moves installation only the link changes.
 *
 * ⚠️ NOTHING IS WRITTEN UNLESS THE FAR END CONFIRMED THE BUSINESS. A typo must not leave a party row that every send would then refuse.
 * ⚠️ A BRIDGE ID IS A LOCAL NAME (ctpaddress.js): if a different business here already holds the same id, the row cannot be made (identities.bridge_id is
 * unique) and the answer says so instead of linking the supplier to a stranger. Proposed fix: backlog RAIL-102.
 */
const addressing = require('./ctpaddress');
const { query: defaultQuery } = require('../db');

/* a bridge id: CB + 8 of [A-Z0-9] (lib/bridgeid.js) */
const BRIDGE_SHAPE = /^CB[A-Z0-9]{8}$/;
const LINK_SHAPE = /^https?:\/\//i;

const refuse = (status, code, message) => ({ error: { status, code, message } });

/** the party answer: the row, and its address COMPUTED from the installation's domain */
function partyOf(row, created, ctx) {
  return {
    created,
    party: {
      identity_id: row.identity_id,
      bridge_id: ctx.bridge,
      display_name: row.display_name,
      installation_key: ctx.found.installation_key,
      domain: ctx.domain,
      address: addressing.format(ctx.bridge, ctx.domain)
    }
  };
}

/** the same id held here: the same remote business (reuse the row) or a stranger (refuse; never link a supplier to the wrong business) */
function sameOrClash(row, ctx) {
  if (row.installation_key === ctx.found.installation_key) return partyOf(row, false, ctx);
  return refuse(
    409,
    'CTP_ADDRESS_CLASH',
    'A different business here already uses the id ' + ctx.bridge + ' (' + row.display_name + '), so ' + (ctx.shownAs || ctx.bridge) + ' at ' + ctx.domain + ' cannot be added under it. Nothing was added.'
  );
}

async function rowWithBridge(dbrun, bridge) {
  const found = await dbrun(
    `SELECT identity_id, display_name, ops.f_installation_of(identity_id) AS installation_key
       FROM identities WHERE bridge_id = $1 AND identity_type = 'entity'`,
    [bridge]
  );
  return found.rows[0] || null;
}

/** the far end's answer, as the refusal (or null) in the words a shopkeeper reads */
function farAnswerRefusal(answer, domain, found) {
  if (!answer || !answer.ok) {
    return refuse(502, 'CTP_UNREACHABLE', 'Could not ask ' + domain + ': ' + ((answer && answer.why) || 'no answer') + '. Nothing was added; try again when they are reachable.');
  }
  if (!answer.found) return refuse(404, 'CTP_ADDRESS_UNKNOWN', domain + ' says: ' + (answer.why || 'no such business') + '. Nothing was added.');
  if (answer.installation_key && answer.installation_key !== found.installation_key) {
    return refuse(502, 'CTP_UNREACHABLE', domain + ' answered as ' + answer.installation_key + ', not the installation we know there (' + found.installation_key + '). Nothing was added.');
  }
  return null;
}

/**
 * NET-39 (DECISIONS 14:50): a supplier on ANOTHER installation is added only if its shop sells outside (entity_profile.trade_mode = 'export'), as the far installation says in its `resolve` answer
 * (sells_outside, from lib/profile isExporter: the one rule search and catalogue use). A far side that does not say is treated as not selling outside (fails closed). Same-installation suppliers never come here.
 */
const SELLS_ONLY_HERE = (name) => name + ' sells only on their own ChitBridge, so they cannot be your supplier from here.';
function notSoldOutside(answer, ctx) {
  if (answer.sells_outside === true) return null;
  return refuse(409, 'SUPPLIER_SELLS_ONLY_HERE', SELLS_ONLY_HERE(answer.display_name || ctx.shownAs || ctx.bridge));
}

/** make the row and link it to the remote installation (the domain is read from there, never copied onto the party) */
async function makeRow(dbrun, owner, answer, ctx) {
  try {
    const inserted = await dbrun(
      `INSERT INTO identities (bridge_id, display_name, identity_type, status, population, entity_kind, country)
       SELECT $1, $2, 'entity', 'active', coalesce(o.population, 'live'), $4, NULL FROM identities o WHERE o.identity_id = $3
       RETURNING identity_id, display_name`,
      [ctx.bridge, String(answer.display_name || ctx.bridge).slice(0, 120), owner, await require('./local-identity').mintKind(dbrun)] /* the kind a minted party gets: 'local' once b769 ran, else what it always was */
    );
    /* country is NULL on purpose (GOV-AU1: a country nobody stated is NULL, never the shop's own: the business is elsewhere) */
    await dbrun('SELECT * FROM ops.f_place_entity($1, $2)', [inserted.rows[0].identity_id, ctx.found.installation_key]);
    addressing.invalidate();
    return partyOf(inserted.rows[0], true, ctx);
  } catch (failure) {
    if (!failure || failure.code !== '23505') throw failure;
    const raced = await rowWithBridge(dbrun, ctx.bridge); /* the other writer made the same row first */
    if (!raced) throw failure;
    return sameOrClash(raced, ctx);
  }
}

/** read what was given and ask where it lives → { shared, found } to go on, or { done } (a local business, or the refusal) */
async function locate(input, wired) {
  const shared = addressing.fromShared(input);
  if (!shared.ok) return { done: refuse(400, 'CTP_ADDRESS_INVALID', 'That is not an address we can read: ' + shared.why + ". Type it as id@domain, or paste the business's link.") };
  if (!shared.domain) return { done: { local: true, bridge: shared.bridge_id } };
  const found = await (wired.resolveAddress || addressing.resolveAddress)(addressing.format(shared.bridge_id, shared.domain));
  /* an e-mail has the same shape (name@domain.tld). It is an address only when the name is a bridge id, the input is a link, or the domain is an
     installation we deal with; anything else is left to the e-mail lookup the caller already had. */
  const typedAsLink = LINK_SHAPE.test(String(input).trim());
  if (!found.ok && !typedAsLink && !BRIDGE_SHAPE.test(shared.bridge_id)) return { done: { local: true, bridge: String(input).trim() } };
  if (!found.ok) return { done: refuse(404, 'CTP_ADDRESS_UNKNOWN', 'We do not deal with ' + shared.domain + ', so nobody there can be added. ' + found.why + '.') };
  if (found.local) return { done: { local: true, bridge: found.bridge_id } };
  return { shared, found };
}

/**
 * @param owner the adding shop's identity_id
 * @param input what was typed, pasted or scanned
 * @param deps  { ask, resolveAddress, query } for tests
 * @returns {Promise<{local:true, bridge:string}|{party:{identity_id,bridge_id,display_name,address,installation_key,domain}, created:boolean}|{error:{status,code,message}}>}
 *          local → the input names a business in THIS installation's namespace (or is an e-mail): the caller continues on its ordinary path.
 */
async function adopt(owner, input, deps) {
  const wired = deps || {};
  const placed = await locate(input, wired);
  if (placed.done) return placed.done;
  const { shared, found } = placed;
  const answer = await (wired.ask || require('./ctpquery').ask)({ domain: shared.domain, bridge_id: shared.bridge_id }, { want: 'resolve', handle: shared.bridge_id });
  const refusal = farAnswerRefusal(answer, shared.domain, found);
  if (refusal) return refusal;
  const closed = notSoldOutside(answer, { bridge: answer.bridge_id, shownAs: answer.display_name });
  if (closed) return closed;
  const dbrun = wired.query || defaultQuery;
  const ctx = { bridge: answer.bridge_id, found, domain: shared.domain, shownAs: answer.display_name };
  const existing = await rowWithBridge(dbrun, ctx.bridge);
  return existing ? sameOrClash(existing, ctx) : makeRow(dbrun, owner, answer, ctx);
}

/**
 * RAIL-107 · A PARTY ON A CHIT THAT ARRIVED OVER THE WIRE — "window-shopping" (Athi, 25 Oct): a buyer added a seller by address and sent it an order; the seller never added the buyer. The copy
 * names the sender by an entity id from the SENDER's database, which means nothing here. So the party is found by BRIDGE ID — the only name that means the same on both installations — and, when this
 * installation holds no row for it, the same stub `adopt` makes (an identities row in the recipient's world, placed on the sending installation) is made for it. It is not a customer and not a
 * supplier: no relationship is written, it is only "a party on this chit", so the reply (a status move) has an address.
 * @param spec { bridge_id, display_name, installation_key, domain, owner }  owner = the local recipient (its world is the stub's world)
 * @returns {Promise<{ok:true, identity_id, created}|{ok:false, status, code, why}>}  a different local business holding the same bridge id is refused in words (RAIL-102), never linked to
 */
async function stubFor(spec, deps) {
  const dbrun = (deps && deps.query) || defaultQuery;
  const ctx = { bridge: spec.bridge_id, found: { installation_key: spec.installation_key }, domain: spec.domain || '', shownAs: spec.display_name };
  const existing = await rowWithBridge(dbrun, spec.bridge_id);
  const made = existing ? sameOrClash(existing, ctx) : await makeRow(dbrun, spec.owner, { display_name: spec.display_name, bridge_id: spec.bridge_id }, ctx);
  if (made.error) return { ok: false, status: made.error.status, code: made.error.code, why: made.error.message };
  return { ok: true, identity_id: made.party.identity_id, created: !!made.created };
}

/**
 * The header fields of a copy that name a person by an id from ANOTHER installation, rewritten to this installation's own rows. Never a foreign uuid stored as an entity reference:
 *   · the sender → the stub (found or made by stubFor);  · the recipient → the local recipient;  · any other party carried on the copy → the local row for its bridge id when this installation
 *     holds one, else no id at all (its bridge id and name stay: this installation does not know where it lives);  · the sending person (created_by_actor_id) is the sender's own and is dropped.
 * Pure over what it is given (`others` = bridge id → local identity_id).
 */
function localizeParties(header, ids) {
  const mapOne = (entry) => {
    const bridge = entry && entry.bridge_id;
    let id = null;
    if (bridge && String(bridge) === String(ids.senderBridge)) id = ids.senderId;
    else if (bridge && String(bridge) === String(ids.toBridge)) id = ids.toId;
    else if (bridge && ids.others && ids.others[bridge]) id = ids.others[bridge];
    return Object.assign({}, entry, { entity_id: id });
  };
  return Object.assign({}, header, {
    sender_entity_id: ids.senderId,
    created_by_actor_id: null,
    all_recipients: (Array.isArray(header.all_recipients) ? header.all_recipients : []).map(mapOne)
  });
}

/** bridge id → local identity_id for the parties of a header that this installation holds a row for (one read) */
async function holdersOf(bridges, deps) {
  const dbrun = (deps && deps.query) || defaultQuery;
  const wanted = [...new Set((bridges || []).filter(Boolean).map(String))];
  if (!wanted.length) return {};
  const found = await dbrun(`SELECT identity_id, bridge_id FROM identities WHERE bridge_id = ANY($1::text[]) AND identity_type = 'entity'`, [wanted]);
  const out = {};
  for (const row of found.rows) out[row.bridge_id] = row.identity_id;
  return out;
}

module.exports = { adopt, SELLS_ONLY_HERE, stubFor, localizeParties, holdersOf };
