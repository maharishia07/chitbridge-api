'use strict';
/**
 * lib/definitions-guards.js — the edit gates of the definitions shelf: who may set a rate, the live-offer yes, the locked version read.
 * OWNS      rateRefused · currentRulesOf · editRefusal · lockDefinition · answerEditRefusal · bornWithoutRate · liveNeedsYes · bornLiveWithoutYes (no route, no state)
 * CALLED BY routes/definitions.js (POST / and PUT /:id)
 * FLOW      gate or refusal before anything is written -> problem(...) in the contract's words
 * CARD      06-catalogue-pim/definitions-shelf
 */
const { problem } = require('./problem'); // API-STANDARD S1: the one error writer
const { words } = require('./definitions-contract');
const rateDoor = require('./rate-door'); /* CAT-211: a category's rate is owner or manager only */


/** CAT-211: the 403 for a caller who may not set a rate (the whole request refused, nothing written) */
const rateRefused = (req, res) => problem(req, res, { status: 403, ...rateDoor.refusal() });
/** the rules the definition's current version holds (the one reader: the offer clash and the rate check both ask) */
const currentRulesOf = async (db, definition) =>
  ((await db.query(`SELECT rules FROM definition_version WHERE definition_id = $1 AND version = $2`, [definition.definition_id, definition.current_version])).rows[0] || {}).rules || {};
/** CAT-211: does this edit change the category's default rate? Only asked of a caller who may not set one (the owner and a manager never pay the read). */
const editorChangesRate = async (req, db, definition, rules) => !rateDoor.setsRate(req) && !!rules && rateDoor.defaultSlabChanged(rules, await currentRulesOf(db, definition));
/** the refusals an edit meets before anything is written: a rate the caller may not set, or a rule left without its value (null = go on) */
async function editRefusal(req, db, definition, rules) {
  if (liveNeedsYes(req, definition.kind, definition.status)) return { unconfirmed: true };
  if (await editorChangesRate(req, db, definition, rules)) return { rateRefused: true };
  const bad = rules && (require('./definition-check').missingValue(definition.kind, definition.sub_kind, rules) || (definition.kind === 'tax' && (await require('./supply-kind').kindWordsFor(definition.entity_id, rules.tax_kind, rules.rate))));
  return bad ? { bad } : null;
}

/** a new definition's refusal before anything is written: a rule left without its value (lib/definition-check — the form's own sentences), or a tax row whose `tax_kind` is not the shop pack's own table row with that rate (SUPPLY KIND, AE-F-11; none is no default) → the sentence, or null */
async function createRefusal(entityId, kind, subKind, rules) {
  const bad = require('./definition-check').missingValue(kind, subKind, rules);
  if (bad) return bad;
  return kind === 'tax' ? await require('./supply-kind').kindWordsFor(entityId, rules.tax_kind, rules.rate) : null;
}

/**
 * CAT-273: the definition row, LOCKED (FOR UPDATE) while this edit reads its version and writes the next: five parallel saves queue and get versions 2..6, where they all read 1 and the losers
 * died on the version key (and were reported as a name clash). A save that names the version it was made on (expected_version) is refused, with the shelf's current one, when the shelf has moved on.
 * → { missing } | { stale: current version, sent } | { row }
 */
async function lockDefinition(db, id, expectedVersion) {
  const found = await db.query(`SELECT * FROM definition WHERE definition_id = $1 FOR UPDATE`, [id]);
  if (!found.rows.length) return { missing: true };
  const row = found.rows[0];
  const moved = expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== row.current_version;
  return moved ? { stale: row.current_version, sent: expectedVersion } : { row };
}

/** answers what editRefusal found (a rate the caller may not set: 403; a rule without its value: 422); true when it answered */
function answerEditRefusal(req, res, out) {
  if (out.unconfirmed) problem(req, res, { status: 428, ...words.liveUnconfirmed() });
  else if (out.rateRefused) rateRefused(req, res);
  else if (out.bad) problem(req, res, { status: 422, ...words.incomplete(out.bad) });
  else if (out.stale) problem(req, res, { status: 409, ...words.stale(out.stale, out.sent) });
  return !!(out.unconfirmed || out.rateRefused || out.bad || out.stale);
}

/** CAT-211: a category born with a rate is refused for a caller who may not set one (a gate between the checks and the handler) */
const bornWithoutRate = (req, res, next) => {
  const rules = req.body && typeof req.body.rules === 'object' && req.body.rules;
  return !rateDoor.setsRate(req) && rateDoor.defaultSlabChanged(rules, {}) ? rateRefused(req, res) : next();
};

/** UX-110: an offer becomes live only with the shop's explicit yes — the page asks first (CBLabKit.confirm) and then sends `confirmed: true`. A draft, a pause, a retire, any other kind, and an offer already live are never asked. */
const liveNeedsYes = (req, kind, wasStatus) => kind === 'offer' && req.body && req.body.status === 'live' && wasStatus !== 'live' && req.body.confirmed !== true;

/** UX-110: an offer born live without the yes is refused before anything is read or written (a gate, like bornWithoutRate) */
const bornLiveWithoutYes = Object.assign((req, res, next) => (liveNeedsYes(req, String((req.body && req.body.kind) || '').trim(), 'draft') ? problem(req, res, { status: 428, ...words.liveUnconfirmed() }) : next()), { addsStatuses: [428] }); /* the gate says the status it answers, for the register (S15 status_codes) */

module.exports = { createRefusal, rateRefused, currentRulesOf, editRefusal, lockDefinition, answerEditRefusal, bornWithoutRate, liveNeedsYes, bornLiveWithoutYes };
