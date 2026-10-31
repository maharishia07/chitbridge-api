'use strict';
// OWNS      the ONE proposal mechanism on a chit: the seller's pro-forma (round N), the buyer's counter (a request, never a computation), an amendment after agreement — propose · accept · reject ·
//           the record a party keeps (chit_proposal, per copy) · applying an accepted version to a copy
// CALLED BY routes/chit-proposals.js · routes/chits.js (POST /:chit_id/amend) · lib/ctpreturn.js (a proposal or a decision that arrived from another installation)
// FLOW      seller prices → moneyOfLines (the one calculation, at the SELLER's installation) → a proposal row on every local copy + an event to every remote party → the buyer accepts / counters / rejects
//           accept → lib/amend record (the lines) + the header's invoice and money set from the proposal, byte for byte; nothing is recomputed by anyone who did not issue it      CARD 01-rail-core-the-chit/chit-proposal
/**
 * ── ⭐⭐⭐ THE SELLER COMPUTES; EVERYONE ELSE SHOWS (Athi, 25 Oct 2026, DECISIONS 12:05 and 11:15) ────────────────────────────────────────────────
 *
 *   · The buyer's request is items and quantities (and notes) with NO binding price. A price on the buyer's screen is the seller's display only.
 *   · The SELLER's installation prices it — price, currency and tax by its own pack, through the same calculation a send uses (routes/chits moneyOfLines → invoiceAtSend) — and proposes it as
 *     "round N" on the same chit. On one installation it is this same code; across installations the proposal travels as a CTP event (lib/ctpreturn).
 *   · The buyer ACCEPTS (that version becomes the agreed record on BOTH copies, byte for byte, nothing recomputed: THIS FILE'S BUYER SIDE NEVER CALLS THE TAX ENGINE), COUNTERS (a request in
 *     text or numbers, never a computation; the seller prices it as round N+1) or REJECTS (it ends; both sides see it).
 *   · An amendment after agreement is the same: the seller proposes the change priced; the buyer asks for one (a request) and the seller prices it.
 *   · A seller with no country: the proposal states the price and the currency as entered and "Tax not decided", in words. A tax is never guessed.
 *
 * ── ⭐ MONEY-NEUTRAL (Athi, 25 Oct): the mechanism — propose, accept, counter, reject, rounds on one chit, both timelines, the bell, the event — carries no money of its own. A round that carries
 * TERMS (a date, a scope, a note: `terms`) is agreed by either party with the other and becomes business_json.agreed; no price, currency, seller, tax or jurisdiction is involved. The money layer
 * above (the seller prices, the quotation, the invoice) applies only to a round that carries lines with amounts.
 *
 * ── ⚠️ STALE IS REFUSED IN WORDS. Accepting a round that a newer round has replaced, or whose lines have changed since (a different hash of the live lines and the invoice), is a 409: the version the
 * person is looking at is not the version they would be agreeing to.
 */
const { withEntity, query } = require('../db');
const log = require('./logger');
const schema = require('./schema');
const money = require('./money');
const canon = require('./canon');
const amend = require('./amend');
const addressBook = require('./ctpaddress');
const ctpReturn = require('./ctpreturn');

const NOTE_MAX = 2000;
const NOT_SET_UP = 'Proposals are not set up on this installation yet.';
/** a refusal a route can answer as it is: status, a registered code, words a person can read */
const refused = (status, code, message) => Object.assign(new Error(message), { status, code, refused: true });

/** money.round — the one rounder (SPEC-money-one-reader.md), never a hand-written Math.round */
const roundMoney = (amount) => money.round(Number(amount) || 0);
const sameId = (left, right) => String(left) === String(right);

/* ── reading my copy ────────────────────────────────────────────────────────────────────────────────────── */
/** the line_id of each live line row, in order; [] when the rows cannot be read (lines are then addressed by position) */
async function readLineIds(db, entity_id, chit_id) {
  try {
    const found = await db.query('SELECT line_id FROM chit_line WHERE entity_id = $1 AND chit_id = $2 ORDER BY seq, line_id', [entity_id, chit_id]);
    return found.rows.map((row) => row.line_id);
  } catch (e) {
    log.fellBack('chit-proposal: the live line rows were not read — lines are addressed by position', e);
    return [];
  }
}

/** my copy of a chit as a proposal sees it: header, lines (with their ids), amendments, proposals and the live set; null when I hold no copy */
async function readCopy(entity_id, chit_id) {
  return withEntity(entity_id, async (db) => {
    const header = await db.query('SELECT sender_entity_id, purpose, business_json, summary_json, all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [chit_id, entity_id]);
    if (!header.rows.length) return null;
    const detail = (await db.query('SELECT line_items, currency_code FROM chit_detail WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [chit_id, entity_id])).rows[0] || {};
    const amendments = await db.query('SELECT line_index, line_id, seq, line FROM chit_line_amendment WHERE entity_id = $1 AND chit_id = $2 ORDER BY line_index, seq', [entity_id, chit_id]);
    const rowIds = await readLineIds(db, entity_id, chit_id);
    const proposals = await db.query('SELECT * FROM chit_proposal WHERE entity_id = $1 AND chit_id = $2 ORDER BY created_at, round', [entity_id, chit_id]);
    const items = Array.isArray(detail.line_items) ? detail.line_items : [];
    const lines = items.map((line, index) => Object.assign({}, line, { line_id: line.line_id || rowIds[index] || null }));
    return { header: header.rows[0], currency_code: detail.currency_code, lines, amendments: amendments.rows, proposals: proposals.rows, live: amend.liveSet(lines, amendments.rows) };
  });
}

/** a counter bill carries the till's bill number and id: the counter sells it, whoever it is sent to */
const isCounterBill = (bizJson) => !!(bizJson.bill_no && bizJson.till && bizJson.till.id);

/** the recipients named on the header who are not the sender */
function othersOnChit(header, sender) {
  const named = Array.isArray(header.all_recipients) ? header.all_recipients : [];
  return named.filter((entry) => entry && entry.entity_id && String(entry.entity_id) !== sender);
}

/** who sells and who buys on this chit — the same two questions a send asks (routes/chits sendIds), asked of the header: the seller of an order is its single recipient, otherwise the sender */
function partiesOf(header) {
  const orderLike = /^(order|offer)$/.test(String(header.purpose || ''));
  const counterBill = isCounterBill(header.business_json || {});
  const sender = String(header.sender_entity_id);
  const recipients = othersOnChit(header, sender);
  const toIds = recipients.filter((entry) => entry.role === 'receiver').map((entry) => String(entry.entity_id));
  const sellerId = orderLike && !counterBill && toIds.length === 1 ? toIds[0] : sender;
  const buyerId = counterBill ? null : orderLike ? sender : toIds.length === 1 ? toIds[0] : null;
  const everyone = [...new Set([sender].concat(recipients.map((entry) => String(entry.entity_id))))];
  return { sellerId, buyerId, everyone };
}
const parties = (copy) => partiesOf(copy.header);

/** a hash of what the agreed record is NOW: the live lines and the invoice. A proposal remembers the hash it was made against; a different one when it is accepted means it is stale */
function baseHashOf(copy) {
  const bizJson = copy.header.business_json || {};
  return canon.hash(JSON.parse(JSON.stringify({ lines: copy.live.map((entry) => entry.live), invoice: bizJson.invoice || null, agreed: bizJson.agreed || null })));
}

/** the local copies of a chit: mine, and every other party whose row is in THIS database (a business on another installation has its own database and is told by an event) */
async function localGroup(entity_id, copy) {
  const group = [entity_id];
  for (const id of parties(copy).everyone) {
    if (sameId(id, entity_id) || group.includes(id)) continue;
    if ((await addressBook.resolve(id)).local !== false) group.push(id);
  }
  return group;
}

/* ── the lines of a pricing, and the money of them (the seller's side only) ─────────────────────────────── */
/** the seller's overrides looked up by line id and by line position */
function overrideLookup(overrides) {
  const byId = new Map();
  const byIndex = new Map();
  for (const item of overrides || []) {
    if (item && item.line_id) byId.set(String(item.line_id), item);
    else if (item && Number.isInteger(Number(item.line_index))) byIndex.set(Number(item.line_index), item);
  }
  return { byId, byIndex };
}

const hasValue = (value) => value != null && value !== '';

/** the price and quantity an override asks for, over the current line's; a non-number is refused in words */
function priceAndQuantity(override, current) {
  const price = hasValue(override.price) ? Number(override.price) : current.price;
  const quantity = hasValue(override.quantity) ? Number(override.quantity) : current.quantity;
  const badPrice = override.price != null && !Number.isFinite(price);
  const badQuantity = override.quantity != null && !Number.isFinite(quantity);
  if (badPrice || badQuantity) throw refused(400, 'PROPOSAL_BAD', 'A price and a quantity must be numbers.');
  return { price, quantity };
}

/** the whole replacement line an override proposes: the allowed fields from what was given, else from the current line, with the new price and quantity over them */
function replacementOf(override, current, amounts) {
  const given = override.line && typeof override.line === 'object' ? override.line : {};
  const replacement = {};
  for (const field of amend.LINE_FIELDS) {
    if (given[field] !== undefined) replacement[field] = given[field];
    else if (current[field] !== undefined) replacement[field] = current[field];
  }
  replacement.price = given.price !== undefined && override.price == null ? Number(given.price) : amounts.price;
  replacement.quantity = given.quantity !== undefined && override.quantity == null ? Number(given.quantity) : amounts.quantity;
  return replacement;
}

/** the override that names this line, by its id first and then by its position */
function overrideOf(original, index, lookup) {
  const byId = original.line_id ? lookup.byId.get(String(original.line_id)) : null;
  return byId || lookup.byIndex.get(index);
}

/** one live line priced from its override (if any): { edit?, line? } — the correction to apply on acceptance and the line as the tax engine should see it */
function priceOneLine(copy, entry, index, lookup) {
  const original = copy.lines[index] || entry.original || {};
  const override = overrideOf(original, index, lookup);
  const current = entry.live;
  if (!current) return {}; /* already removed: it counts nowhere */
  if (!override) return { line: Object.assign({}, original, current) };
  const edit = { line_index: index, line_id: original.line_id || null, reason_code: 'rate_agreed', reason: override.note || null };
  if (override.remove || override.line === null) return { edit: Object.assign(edit, { line: null }) };
  const amounts = priceAndQuantity(override, current);
  const replacement = replacementOf(override, current, amounts);
  const total = roundMoney(Number(amounts.price) * Number(amounts.quantity));
  return { edit: Object.assign(edit, { line: replacement }), line: Object.assign({}, original, replacement, { total, list_price: amounts.price }) };
}

/**
 * The proposed version of the lines from the seller's overrides ({ line_id | line_index, price?, quantity?, remove?, note? }): the corrections to apply on acceptance (lib/amend shape) and the
 * lines as the tax engine should see them (the original's rating fields kept, the amended price and quantity over them, the line total worked out from those two).
 */
function priceLines(copy, overrides) {
  const lookup = overrideLookup(overrides);
  const edits = [];
  const lines = [];
  copy.live.forEach((entry, index) => {
    const step = priceOneLine(copy, entry, index, lookup);
    if (step.edit) edits.push(step.edit);
    if (step.line) lines.push(step.line);
  });
  return { edits, lines };
}

/* ── proposing ─────────────────────────────────────────────────────────────────────────────────────────── */
const ready = () => schema.hasTable('chit_proposal');

/**
 * ⭐ INTERNATIONAL TRADE IS A DEAL TYPE (Athi, 25 Oct 2026, DECISIONS 14:10). A chit is an international deal only when another party ON IT lives on another installation (its stub links to an
 * installation: lib/ctpreturn remoteParties, the one definition). ONLY those chits get proposals, rounds, the quotation / jurisdiction fields and the status and dispute bells. A domestic or
 * same-installation chit behaves exactly as it did before 25 Oct: an amendment is direct, and a proposal on it is refused in words.
 */
async function isInternationalDeal(entity_id, chit_id) {
  return (await ctpReturn.remoteParties(entity_id, chit_id)).length > 0;
}

/**
 * usesRfq(entity_id, chit_id[, business_json]) — THE gate (DECISIONS 14:10 and its addition): a chit uses proposals, rounds, the quotation / jurisdiction fields and the status and dispute
 * bells when it is an international deal OR it was composed as an RFQ (`business_json.deal_type === 'rfq'`, "Ask for a quote", chosen at compose; a domestic chit with two local parties may opt in; the cart stays the default).
 * Anything else behaves exactly as it did before 25 Oct. Pass the chit's business_json when the caller already holds it (no read); otherwise it is read from my copy.
 */
async function usesRfq(entity_id, chit_id, business_json) {
  if (await isInternationalDeal(entity_id, chit_id)) return true;
  let bizJson = business_json;
  if (bizJson === undefined) {
    const found = await withEntity(entity_id, (db) => db.query('SELECT business_json FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1', [chit_id, entity_id]));
    bizJson = found.rows[0] && found.rows[0].business_json;
  }
  return !!bizJson && typeof bizJson === 'object' && bizJson.deal_type === 'rfq';
}

/** write one proposal row on one copy (idempotent by proposal id) */
async function writeRow(entity_id, row) {
  const json = (value) => (value ? JSON.stringify(value) : null);
  await withEntity(entity_id, (db) =>
    db.query(
      `INSERT INTO chit_proposal (proposal_id, entity_id, chit_id, round, kind, from_entity_id, from_bridge_id, from_name, status, edits, request, invoice, summary, currency_code, tax_note, base_hash, note, terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'proposed',$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17::jsonb)
       ON CONFLICT (proposal_id, entity_id) DO NOTHING`,
      [
        row.proposal_id, entity_id, row.chit_id, row.round, row.kind, row.from_entity_id, row.from_bridge_id, row.from_name || null,
        json(row.edits), json(row.request), json(row.invoice), json(row.summary), row.currency_code || null, row.tax_note || null, row.base_hash || null, row.note || null, json(row.terms)
      ]
    )
  );
}

const setStatus = (entity_id, proposal_id, status, actorName) =>
  withEntity(entity_id, (db) => db.query("UPDATE chit_proposal SET status = $3, decided_at = now(), decided_by = $4 WHERE entity_id = $1 AND proposal_id = $2 AND status = 'proposed'", [entity_id, proposal_id, status, actorName || null]));

const logRow = (entity_id, chit_id, actor_id, actor_name, action, detail) =>
  withEntity(entity_id, (db) =>
    db.query(`INSERT INTO state_log (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, detail) VALUES ($1,$2,$3,$4,$5,$6)`, [chit_id, entity_id, action, actor_id, actor_name, String(detail).slice(0, 500)])
  );

/** the words a timeline row and a bell carry */
const WHAT = { proposed: 'Quotation proposed', accepted: 'Quotation accepted', rejected: 'Quotation rejected', countered: 'Re-quote asked' };

/** what rings for the other party: the same events.emit every local action uses */
function ring(to_ids, chit_id, what, actorName) {
  try {
    const targets = (to_ids || []).filter(Boolean);
    if (targets.length) require('./events').emit(targets, { kind: 'proposal', id: chit_id, what, who: actorName || null });
  } catch (e) {
    log.warn('chit-proposal: the bell did not ring', { chit_id, error: String((e && e.message) || e) });
  }
}

/** the identity row's bridge id and name (a proposal names who put it forward) */
async function bridgeOf(entity_id) {
  const found = await query('SELECT bridge_id, display_name FROM identities WHERE identity_id = $1', [entity_id]);
  return found.rows[0] || { bridge_id: null, display_name: null };
}

/** a country of a business, by the one reader (lib/profile countryOf over its identities row); null when none is stated — never assumed */
async function countryOf(entity_id) {
  try {
    const found = await query('SELECT country, gstn FROM identities WHERE identity_id = $1', [entity_id]);
    const row = found.rows[0] || {};
    return require('./profile').countryOf({ country: row.country, gstin: row.gstn }) || null;
  } catch (e) {
    log.fellBack('chit-proposal: the seller country was not read — stated as none', e);
    return null;
  }
}

/** the seller's own money by the one resolver; null when it cannot be read */
async function sellerCurrency(entity_id) {
  try {
    return await require('./regional').currencyFor(entity_id);
  } catch (e) {
    log.fellBack('chit-proposal: the seller currency was not read — the chit’s own is used', e);
    return null;
  }
}

const isOtherMoney = (currency, askedCurrency) => !!currency && !!askedCurrency && currency !== askedCurrency;
const isOtherCountry = (asked, sellerCountry) => !!sellerCountry && !!asked && !!asked.buyer_country && asked.buyer_country !== sellerCountry;

/**
 * The two jurisdictions a priced round carries: the seller's (country, currency, installation) and the buyer's (stamped on the request at send). `document` is 'quotation' while the chit is asked from
 * somewhere else or priced in another currency — only the ACCEPTED round is the pro-forma (applyVersion sets that). The buyer's duty and taxes are never computed.
 */
function jurisdictionOf(asked, sellerCountry, currency, askedCurrency) {
  const crossing = !!asked || isOtherMoney(currency, askedCurrency) || isOtherCountry(asked, sellerCountry);
  return Object.assign({}, asked || {}, {
    seller_country: sellerCountry,
    seller_currency: currency,
    seller_installation: process.env.INSTALLATION_KEY || null,
    document: crossing ? 'quotation' : 'pro_forma',
    buyer_duty_and_taxes: crossing ? 'not_included' : undefined
  });
}

/** the terms of a money-free round: a small flat object of text, numbers and flags (a date, a scope…), each bounded */
function termsOf(input) {
  const out = {};
  for (const key of Object.keys(input).slice(0, 20)) {
    const value = input[key];
    if (value === null || value === undefined || typeof value === 'object') continue;
    out[String(key).slice(0, 60)] = typeof value === 'string' ? value.slice(0, 500) : value;
  }
  return out;
}

/**
 * Everything every kind of round needs, read once: my copy (checked), the parties, the note, the newest round and the next round number, and the row that every kind completes.
 * ONE chit per deal, ONE count of rounds: the buyer's request that the chit IS is round 1; every version put forward after it (the seller's priced reply, a counter, the next price) is the next round.
 */
async function openContext(entity_id, chit_id, input, actor) {
  if (!(await ready())) throw refused(503, 'PROPOSAL_NOT_SETUP', NOT_SET_UP);
  const copy = await readCopy(entity_id, chit_id);
  if (!copy) throw refused(404, 'NOT_FOUND', 'Chit not found');
  if (!(await usesRfq(entity_id, chit_id, copy.header.business_json))) {
    throw refused(409, 'PROPOSAL_DOMESTIC', 'Proposals are for deals with a business on another installation, or a chit made as an RFQ (ask for a quote). On this chit, change it directly.');
  }
  const note = input.note ? String(input.note).slice(0, NOTE_MAX) : null;
  const rounds = copy.proposals.map((row) => row.round);
  const nextRound = (rounds.length ? Math.max(...rounds) : 1) + 1;
  const mineRow = await bridgeOf(entity_id);
  const row = { proposal_id: require('crypto').randomUUID(), chit_id, from_entity_id: entity_id, from_bridge_id: mineRow.bridge_id, from_name: actor.name || mineRow.display_name, note, base_hash: baseHashOf(copy) };
  return { copy, group: parties(copy), note, latest: copy.proposals[copy.proposals.length - 1] || null, nextRound, row };
}

/** the open round a new one replaces on every copy, and what becomes of it: { old, oldStatus } (superseded: same side replaced it · countered: the other side answered it with a request) */
function replacing(latest, statusOf) {
  if (!latest || latest.status !== 'proposed') return { old: null, oldStatus: null };
  return { old: latest, oldStatus: statusOf(latest) };
}

/** a money-free round: either party puts terms forward (a date, a scope, a note); the other agrees, counters or rejects. No price, currency, tax or seller is involved */
function termsRound(ctx, entity_id, input) {
  const terms = termsOf(input.terms);
  if (!Object.keys(terms).length && !ctx.note) throw refused(400, 'PROPOSAL_BAD', 'Say what you are proposing: a date, a scope, a note.');
  const fields = { round: ctx.nextRound, kind: 'terms', terms, currency_code: null };
  return Object.assign({ fields }, replacing(ctx.latest, (latest) => (sameId(latest.from_entity_id, entity_id) ? 'superseded' : 'countered')));
}

/** the money of the seller's lines, by the one calculation (routes/chits moneyOfLines) at the seller's installation: { invoice, block, moneyBlock } */
async function priceMoney(ctx, lines, currency) {
  const chits = require('../routes/chits');
  const priced = await chits.moneyOfLines(lines, { sellerId: ctx.group.sellerId, buyerId: ctx.group.buyerId }, ctx.copy.header.business_json || {}, currency);
  const block = priced.invoice ? chits.moneyOfInvoice(priced.invoice, currency) : Object.assign({}, priced.moneyBlock, { tax_state: 'not_decided' });
  return { invoice: priced.invoice, block, moneyBlock: priced.moneyBlock };
}

/** why a round carries no tax, in words (never a guessed tax) */
const taxNoteOf = (invoice, moneyBlock) =>
  invoice ? null : 'Tax not decided: ' + (moneyBlock.tax === null ? 'the seller has no country or tax setup that can decide it, so the prices are stated as entered.' : 'it could not be worked out.');

/** the money a priced round is in: the one stated, else the seller's own, else the chit's; none is refused in words */
async function roundCurrency(entity_id, input, copy) {
  const stated = input.currency_code || (await sellerCurrency(entity_id)) || copy.currency_code || '';
  const currency = String(stated).toUpperCase();
  if (!currency) throw refused(400, 'PROPOSAL_BAD', 'Say which currency the prices are in.');
  return currency;
}

/** a priced round after one was accepted is a change; the first is the pro-forma */
const pricedKindOf = (copy) => (copy.proposals.some((item) => item.status === 'accepted') ? 'change' : 'pro_forma');

/** the seller prices: the one calculation, at the seller's installation → the round's fields, and the open round it replaces */
async function sellerRound(ctx, entity_id, input) {
  const { copy, group, row } = ctx;
  const priced = priceLines(copy, input.lines);
  const prepared = priced.edits.length ? amend.prepare(priced.edits) : [];
  if (prepared.length) await withEntity(entity_id, (db) => amend.guard(db, entity_id, row.chit_id, prepared));
  const currency = await roundCurrency(entity_id, input, copy);
  const priced2 = await priceMoney(ctx, priced.lines, currency);
  /* the two jurisdictions (DECISIONS 13:10): what the chit was asked under (the buyer's country, stamped at send) and what the seller prices it under. A quotation until accepted whenever they differ. */
  const jurisdiction = jurisdictionOf((copy.header.business_json || {}).jurisdiction || null, await countryOf(group.sellerId), currency, copy.currency_code);
  const fields = {
    round: ctx.nextRound,
    kind: pricedKindOf(copy),
    edits: prepared.length ? priced.edits : [],
    invoice: priced2.invoice,
    summary: { money: priced2.block, total_value: priced2.block.net, jurisdiction },
    currency_code: currency,
    tax_note: taxNoteOf(priced2.invoice, priced2.moneyBlock)
  };
  return Object.assign({ fields }, replacing(ctx.latest, () => 'superseded'));
}

/** one asked line, bounded: what and how many, a wanted price as TEXT (never a computation) */
function askedLine(item) {
  return {
    line_id: item.line_id || null,
    line_index: Number.isInteger(Number(item.line_index)) ? Number(item.line_index) : null,
    quantity: hasValue(item.quantity) ? Number(item.quantity) : null,
    requested_price: item.requested_price != null ? String(item.requested_price).slice(0, 80) : null,
    remove: !!item.remove,
    note: item.note ? String(item.note).slice(0, 300) : null
  };
}

/** the buyer asks: what and how many, a wanted price as text — never a computation → the round's fields, and the open round it replaces */
function buyerRound(ctx, input) {
  const asked = (Array.isArray(input.lines) ? input.lines : []).filter(Boolean).map(askedLine);
  if (!asked.length && !ctx.note) throw refused(400, 'PROPOSAL_BAD', 'Say what you are asking for: the lines and quantities, or a note.');
  if (asked.some((item) => item.quantity !== null && !Number.isFinite(item.quantity))) throw refused(400, 'PROPOSAL_BAD', 'A quantity must be a number.');
  const fields = { round: ctx.nextRound, kind: 'request', request: { lines: asked }, currency_code: null };
  return Object.assign({ fields }, replacing(ctx.latest, (latest) => (latest.kind === 'request' ? 'superseded' : 'countered')));
}

/** a terms input is an object of terms and no lines (the money-free kind) */
const isTermsInput = (input) => !!input.terms && typeof input.terms === 'object' && !Array.isArray(input.terms) && !Array.isArray(input.lines);

/** which kind of round this is: terms · the seller's pricing · the buyer's request */
function buildRound(ctx, entity_id, input) {
  if (isTermsInput(input)) return termsRound(ctx, entity_id, input);
  if (sameId(entity_id, ctx.group.sellerId)) return sellerRound(ctx, entity_id, input);
  return buyerRound(ctx, input);
}

/** the round on ONE local copy: its row, the replaced round's new status, the timeline row */
async function keepRound(copyOwner, entity_id, row, round, actor) {
  await writeRow(copyOwner, row);
  if (round.old) await setStatus(copyOwner, round.old.proposal_id, round.oldStatus, actor.name);
  const what = row.kind === 'request' ? 'Re-quote asked' : 'Change proposed';
  await logRow(copyOwner, row.chit_id, entity_id, row.from_name, 'proposal_proposed', what + ' — round ' + row.round + (row.tax_note ? ' (' + row.tax_note + ')' : ''));
}

/** the event a party on another installation is told: the round as it was issued, and which open round it replaces */
function crossingEvent(row, round, note) {
  return {
    proposal_id: row.proposal_id, round: row.round, version: row.kind, edits: row.edits || null, request: row.request || null, invoice: row.invoice || null, summary: row.summary || null,
    currency_code: row.currency_code || null, tax_note: row.tax_note || null, base_hash: row.base_hash, note, by_name: row.from_name,
    terms: row.terms || null, replaces: round.old ? round.old.proposal_id : null, replaces_status: round.oldStatus
  };
}

/** write the round on every local copy, tell every remote party by an event, ring the local others → the answer the door gives */
async function putForward(ctx, entity_id, round, actor) {
  const row = Object.assign(ctx.row, round.fields);
  const { oldStatus } = round;
  const local = await localGroup(entity_id, ctx.copy);
  for (const id of local) await keepRound(id, entity_id, row, round, actor);
  const crossed = await ctpReturn.onProposal(entity_id, row.chit_id, crossingEvent(row, round, ctx.note));
  ring(local.filter((id) => !sameId(id, entity_id)), row.chit_id, row.kind === 'request' || oldStatus === 'countered' ? 'countered' : 'proposed', row.from_name);
  return { proposal_id: row.proposal_id, round: row.round, kind: row.kind, status: 'proposed', terms: row.terms || null, money: row.summary ? row.summary.money : null, tax_note: row.tax_note || null, ctp: crossed };
}

/**
 * propose(entity_id, chit_id, input, actor) — ONE door for the three ways a version is put forward.
 *   the SELLER sends { lines: [{ line_id|line_index, price?, quantity?, remove?, note? }], currency_code?, note } → a priced proposal (pro-forma round N, or a change after agreement); computed HERE
 *   any OTHER party sends { lines: [{ line_id|line_index, quantity?, requested_price?, note? }], note } → a request: recorded as asked, never priced, for the seller to price
 * → { proposal_id, round, kind, status, money?, tax_note?, ctp? }   or throws a refusal (lib refused()). A chit with nobody else on it returns null: the caller amends directly, as it always did.
 */
async function propose(entity_id, chit_id, input, actor) {
  const ctx = await openContext(entity_id, chit_id, input, actor);
  const round = await buildRound(ctx, entity_id, input);
  return putForward(ctx, entity_id, round, actor);
}

/* ── deciding ──────────────────────────────────────────────────────────────────────────────────────────── */
/** one proposal row of one copy, or null */
const readRow = (entity_id, chit_id, proposal_id) =>
  withEntity(entity_id, (db) => db.query('SELECT * FROM chit_proposal WHERE entity_id = $1 AND chit_id = $2 AND proposal_id = $3', [entity_id, chit_id, proposal_id])).then((found) => found.rows[0] || null);

/** the refusals before anyone is changed: not found · my own · already decided · not the newest round · a seller's request is priced, not accepted → the row being decided */
function decidableRow(copy, entity_id, proposal_id, decision) {
  const row = copy.proposals.find((item) => item.proposal_id === proposal_id);
  if (!row) throw refused(404, 'PROPOSAL_NOT_FOUND', 'No such proposal on this chit.');
  if (sameId(row.from_entity_id, entity_id)) throw refused(403, 'PROPOSAL_NOT_YOURS', 'You made this proposal; the other side decides it.');
  if (row.status !== 'proposed') throw refused(409, 'PROPOSAL_CLOSED', 'This proposal is already ' + row.status + '.');
  const newest = copy.proposals[copy.proposals.length - 1];
  if (newest.proposal_id !== row.proposal_id) throw refused(409, 'PROPOSAL_STALE', 'A newer round has replaced this one, so it cannot be ' + decision + 'ed. Look at the newest.');
  if (decision === 'accept' && row.kind === 'request') throw refused(409, 'PROPOSAL_BAD', 'This is a request. Answer it with a priced proposal.');
  return row;
}

/** accept on every local copy: everyone here is checked BEFORE anyone is changed (a delivered line that the version removes refuses the whole acceptance, in the words amend gives) */
async function acceptHere(local, entity_id, chit_id, row, copy, actor) {
  if (row.base_hash !== baseHashOf(copy)) throw refused(409, 'PROPOSAL_STALE', 'The lines or the invoice have changed since this was proposed, so it cannot be accepted as it stands. Ask for a new round.');
  const rows = [];
  for (const id of local) {
    const mine = id === entity_id ? row : await readRow(id, chit_id, row.proposal_id);
    if (!mine || mine.status !== 'proposed') throw refused(409, 'PROPOSAL_CLOSED', 'This proposal is not open on every copy here.');
    if (mine.edits && mine.edits.length) await withEntity(id, (db) => amend.guard(db, id, chit_id, amend.prepare(mine.edits)));
    rows.push([id, mine]);
  }
  for (const [id, mine] of rows) await applyVersion(id, chit_id, mine, actor);
}

/** reject on every local copy, with the timeline row */
async function rejectHere(local, entity_id, chit_id, row, actor, text) {
  for (const id of local) {
    await setStatus(id, row.proposal_id, 'rejected', actor.name);
    await logRow(id, chit_id, entity_id, actor.name, 'proposal_rejected', 'Change rejected — round ' + row.round + (text ? ': ' + text : ''));
  }
}

/**
 * decide(entity_id, chit_id, proposal_id, decision, actor, note) — the addressee acts on a version: 'accept' · 'reject'. (A counter is a request: propose().)
 * Refused in words: not found · my own proposal · already decided · not the newest round · stale (the lines or the invoice are no longer what it was made against) · a seller's request is
 * answered by pricing it, not accepting it.
 */
async function decide(entity_id, chit_id, proposal_id, decision, actor, note) {
  if (!(await ready())) throw refused(503, 'PROPOSAL_NOT_SETUP', NOT_SET_UP);
  if (decision !== 'accept' && decision !== 'reject') throw refused(400, 'PROPOSAL_BAD', 'Accept or reject.');
  const copy = await readCopy(entity_id, chit_id);
  if (!copy) throw refused(404, 'NOT_FOUND', 'Chit not found');
  const row = decidableRow(copy, entity_id, proposal_id, decision);
  const local = await localGroup(entity_id, copy);
  const text = note ? String(note).slice(0, NOTE_MAX) : null;
  if (decision === 'accept') await acceptHere(local, entity_id, chit_id, row, copy, actor);
  else await rejectHere(local, entity_id, chit_id, row, actor, text);
  const crossed = await ctpReturn.onProposalDecided(entity_id, chit_id, { proposal_id, decision, by_name: actor.name, note: text });
  ring(local.filter((id) => !sameId(id, entity_id)), chit_id, decision === 'accept' ? 'accepted' : 'rejected', actor.name);
  return { proposal_id, status: decision === 'accept' ? 'accepted' : 'rejected', round: row.round, ctp: crossed };
}

/** an accepted round closes: this one is accepted, every other open round is replaced */
async function closeRounds(db, entity_id, chit_id, row, actor) {
  await db.query("UPDATE chit_proposal SET status = 'accepted', decided_at = now(), decided_by = $4 WHERE entity_id = $1 AND chit_id = $2 AND proposal_id = $3 AND status = 'proposed'", [entity_id, chit_id, row.proposal_id, actor.name || null]);
  await db.query("UPDATE chit_proposal SET status = 'superseded', decided_at = now() WHERE entity_id = $1 AND chit_id = $2 AND proposal_id <> $3 AND status = 'proposed'", [entity_id, chit_id, row.proposal_id]);
}

/** the header's invoice and money, and the detail's total and currency, set from an accepted proposal AS IT WAS ISSUED (the seller's JSON, byte for byte) */
async function writeAgreedMoney(db, entity_id, chit_id, row) {
  const { jurisdiction, ...rest } = row.summary || {};
  const summary = row.summary ? rest : null;
  await db.query(
    `UPDATE chit_header
        SET business_json = COALESCE(business_json, '{}'::jsonb) - 'invoice' || CASE WHEN $3::jsonb IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('invoice', $3::jsonb) END,
            summary_json = coalesce(summary_json, '{}'::jsonb) || coalesce($4::jsonb, '{}'::jsonb)
      WHERE chit_id = $1 AND entity_id = $2`,
    [chit_id, entity_id, row.invoice ? JSON.stringify(row.invoice) : null, summary ? JSON.stringify(summary) : null]
  );
  if (jurisdiction) {
    /* the accepted round is the pro-forma: the document says so, and the two jurisdictions stay on the chit as they were issued */
    await db.query("UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || jsonb_build_object('jurisdiction', COALESCE(business_json -> 'jurisdiction', '{}'::jsonb) || $3::jsonb) WHERE chit_id = $1 AND entity_id = $2", [chit_id, entity_id, JSON.stringify(Object.assign({}, jurisdiction, { document: 'pro_forma' }))]);
  }
  if (summary) {
    await db.query('UPDATE chit_detail SET total_value = $3, currency_code = coalesce($4, currency_code) WHERE chit_id = $1 AND entity_id = $2', [chit_id, entity_id, summary.total_value, row.currency_code || null]);
  }
}

/**
 * applyVersion(entity_id, chit_id, row, actor) — an ACCEPTED version becomes the agreed record on ONE copy: the lines through lib/amend (the one writer of corrections), the header's invoice and
 * money and the detail's total and currency set from the proposal AS IT WAS ISSUED (the seller's JSON, byte for byte). Nothing is computed here, and the tax engine is never called.
 */
async function applyVersion(entity_id, chit_id, row, actor) {
  if (row.kind === 'terms') return applyTerms(entity_id, chit_id, row, actor);
  if (row.edits && row.edits.length) await amend.record(entity_id, chit_id, row.edits, { actor_id: row.from_entity_id, actor_name: row.from_name });
  await withEntity(entity_id, async (db) => {
    await writeAgreedMoney(db, entity_id, chit_id, row);
    await closeRounds(db, entity_id, chit_id, row, actor);
  });
  await logRow(entity_id, chit_id, row.from_entity_id, actor.name, 'proposal_accepted', 'Change accepted — round ' + row.round);
}

/** an accepted money-free round: its terms become the agreed record (business_json.agreed), the round is accepted, older open rounds are closed. No money is touched. */
async function applyTerms(entity_id, chit_id, row, actor) {
  const agreed = { round: row.round, terms: row.terms || {}, by: row.from_name || null, agreed_with: actor.name || null, at: new Date().toISOString() };
  await withEntity(entity_id, async (db) => {
    await db.query("UPDATE chit_header SET business_json = COALESCE(business_json, '{}'::jsonb) || jsonb_build_object('agreed', $3::jsonb) WHERE chit_id = $1 AND entity_id = $2", [chit_id, entity_id, JSON.stringify(agreed)]);
    await closeRounds(db, entity_id, chit_id, row, actor);
  });
  await logRow(entity_id, chit_id, row.from_entity_id, actor.name, 'proposal_accepted', 'Terms agreed — round ' + row.round);
}

/* ── what arrives from another installation ────────────────────────────────────────────────────────────── */
/** the timeline sentence for a proposal that arrived */
function arrivedSentence(payload) {
  const what = payload.version === 'request' ? 'Re-quote asked' : payload.version === 'terms' ? 'Terms proposed' : 'Change proposed';
  return what + ' — round ' + payload.round + (payload.tax_note ? ' (' + payload.tax_note + ')' : '');
}

/**
 * receive(local_id, remote, chit_id, payload) — a proposal the other installation's SELLER (or buyer, for a request) made: kept as it was issued on OUR copy, never recomputed. Idempotent by proposal id.
 * `remote` = { identity_id (the stub), bridge_id, display_name }.
 */
async function receive(local_id, remote, chit_id, payload) {
  if (!(await ready())) throw refused(503, 'PROPOSAL_NOT_SETUP', NOT_SET_UP);
  const byName = payload.by_name || remote.display_name;
  await writeRow(local_id, {
    proposal_id: payload.proposal_id, chit_id, round: payload.round, kind: payload.version, from_entity_id: remote.identity_id, from_bridge_id: remote.bridge_id, from_name: byName,
    edits: payload.edits, request: payload.request, terms: payload.terms, invoice: payload.invoice, summary: payload.summary, currency_code: payload.currency_code, tax_note: payload.tax_note, base_hash: payload.base_hash, note: payload.note
  });
  if (payload.replaces) await setStatus(local_id, payload.replaces, payload.replaces_status === 'countered' ? 'countered' : 'superseded', payload.by_name);
  await logRow(local_id, chit_id, remote.identity_id, byName, 'proposal_proposed', arrivedSentence(payload));
  return { what: payload.version === 'request' || payload.replaces_status === 'countered' ? 'countered' : 'proposed' };
}

/** a decision the other side made, applied to OUR copy: the same applyVersion an acceptance here runs; the decision was made (and checked for staleness) where the person acted, so it is not re-decided */
async function receiveDecision(local_id, remote, chit_id, payload) {
  const row = await readRow(local_id, chit_id, payload.proposal_id);
  if (!row) throw refused(404, 'PROPOSAL_NOT_FOUND', 'That proposal has not arrived here yet.');
  if (row.status !== 'proposed') return { applied: false };
  const actor = { name: payload.by_name || remote.display_name };
  if (payload.decision === 'accept') {
    if (row.edits && row.edits.length) await withEntity(local_id, (db) => amend.guard(db, local_id, chit_id, amend.prepare(row.edits)));
    await applyVersion(local_id, chit_id, row, actor);
  } else {
    await setStatus(local_id, payload.proposal_id, 'rejected', actor.name);
    await logRow(local_id, chit_id, remote.identity_id, actor.name, 'proposal_rejected', 'Change rejected — round ' + row.round + (payload.note ? ': ' + payload.note : ''));
  }
  return { applied: true, what: payload.decision === 'accept' ? 'accepted' : 'rejected' };
}

/* ── reading ───────────────────────────────────────────────────────────────────────────────────────────── */
const OPEN_LABELS = { request: 'Re-quote asked', pro_forma: 'Quotation', terms: 'Terms proposed' };
const AGREED_LABELS = { pro_forma: 'Pro-forma agreed', terms: 'Terms agreed' };
const CLOSED_LABELS = { rejected: 'Change rejected', countered: 'Countered' };

/** the words a proposal row is shown under, from its status and kind */
function labelOf(row) {
  if (row.status === 'proposed') return OPEN_LABELS[row.kind] || 'Change proposed';
  if (row.status === 'accepted') return AGREED_LABELS[row.kind] || 'Change accepted';
  return CLOSED_LABELS[row.status] || 'Replaced';
}

/** one proposal as the list shows it, with whether it is waiting for ME */
function viewOf(row, entity_id, newest) {
  const fromOther = !sameId(row.from_entity_id, entity_id);
  return {
    proposal_id: row.proposal_id,
    round: row.round,
    kind: row.kind,
    status: row.status,
    label: labelOf(row),
    mine: !fromOther,
    from_name: row.from_name,
    edits: row.edits,
    request: row.request,
    terms: row.terms || null,
    money: row.summary ? row.summary.money : null,
    jurisdiction: row.summary ? row.summary.jurisdiction || null : null,
    currency_code: row.currency_code,
    tax_note: row.tax_note,
    note: row.note,
    created_at: row.created_at,
    decided_at: row.decided_at,
    decided_by: row.decided_by,
    awaiting_me: row.status === 'proposed' && fromOther && newest.proposal_id === row.proposal_id
  };
}

/** my copy's proposals, newest last, each with whether it is waiting for ME */
async function list(entity_id, chit_id) {
  if (!(await ready())) return { proposals: [], migrated: false };
  const copy = await readCopy(entity_id, chit_id);
  if (!copy) return null;
  const newest = copy.proposals[copy.proposals.length - 1];
  return { migrated: true, proposals: copy.proposals.map((row) => viewOf(row, entity_id, newest)) };
}

module.exports = { isInternationalDeal, usesRfq, propose, decide, receive, receiveDecision, list, applyVersion, partiesOf, priceLines, baseHashOf, readCopy, refused, WHAT };
