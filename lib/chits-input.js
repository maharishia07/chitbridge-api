/*
 * OWNS      the input rules of the chit routes that used to be express-validator chains (send, status, payment, messages, disputes, resolve, priority, priority-flag, void, assign-bulk):
 *           the body schemas that replaced the chains, the old refusal body they answered ({ error: "Validation failed", details: [{ field, message }] }), the trim the chains did
 *           to the value the handler then reads, and the recipients rule a send has.
 * CALLED BY lib/chits-contract.js (the rows take these schemas) · routes/chits.js (trimmedBody · recipientsRule · schemaOptionsFor) · tests/api-problem-chits.test.cjs (runs the old chains beside these schemas).
 * FLOW      auth → [recipientsRule on a send] → schemaValidate(operation, schemaOptionsFor(route)) → trimmedBody([...]) → the handler
 *           a refusal → problem(): status 400, the code CHIT_INVALID, the old { error, details } body, field by field in the order the chain listed them
 * CARD      01-rail-core-the-chit/chits-routes
 * This file moves NO chit and decides nothing about one: it only says what a request must look like before the route's own rules are asked.
 *
 * ⚠️ The schemas accept what the chains accepted. A chain trimmed the value before it asked, so an id or a word with spaces round it passed, and the handler read the trimmed value:
 *    the patterns allow the spaces and trimmedBody() trims the value the same way. One thing differs and is worth knowing: a chain turned a number or a boolean into text
 *    before asking (so a number passed as a "message"); a schema asks for text. The web sends text. tests/api-problem-chits.test.cjs runs both on a table of values and names the difference.
 */
'use strict';
const railActions = require('./rail-actions');
const { UUID_PATTERN } = require('./folders-contract');
const { errorsOf, bodySchemaOf, bodyEngine } = require('../middleware/validate');
const { problem } = require('./problem');
const bounds = require('./bounds');

const EXAMPLE_ID = '11111111-2222-4333-8444-555555555555';
const INVALID_VALUE = 'Invalid value';

/* ── the shapes ─────────────────────────────────────────────────────────────────────────────────────────── */
/** an id the chain checked with isUUID(); null allowed where the chain said optional({ nullable: true }) */
const UUID_OR_NULL = { type: ['string', 'null'], pattern: UUID_PATTERN, examples: [EXAMPLE_ID] };
const UUID_TEXT = { type: 'string', pattern: UUID_PATTERN, examples: [EXAMPLE_ID] };
/** text with something in it once its edges are trimmed (the chain trimmed, then asked notEmpty) */
const FILLED = { type: 'string', pattern: '\\S', examples: ['Hello'] };
/** an optional text of at most `max` characters once trimmed; null reads as empty, as the chain's trim made it */
const trimmedUpTo = (max) => ({ type: ['string', 'null'], pattern: '^\\s*(?:\\S(?:[\\s\\S]{0,' + (max - 2) + '}\\S)?)?\\s*$', examples: ['note'] });
/** one of a list of words, with spaces allowed round it (the chain trimmed, then asked isIn) */
const oneOfTrimmed = (words) => ({ type: 'string', pattern: '^\\s*(?:' + words.join('|') + ')\\s*$', examples: [words[0]] });
/** what isBoolean() let through: true · false · 'true' · 'false' · '1' · '0' (and 1 · 0, which the chain turned into those words) */
const BOOLEAN_LIKE = { type: ['boolean', 'string', 'integer'], enum: [true, false, 'true', 'false', '1', '0', 1, 0], examples: [true] };
/** a money figure that is MORE than zero (FIN-52: a payment is a whole positive amount): a number above 0, or text whose figure has a digit that is not 0 */
const POSITIVE_AMOUNT = {
  type: ['number', 'string'],
  exclusiveMinimum: 0,
  pattern: '^\\+?(?=[0-9.]*[1-9])(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$',
  examples: [12.5]
};

const PURPOSES = ['order', 'invoice', 'receipt', 'inquiry', 'delivery_note', 'general', 'credit_note', 'debit_note', 'expense', 'income', 'subscription'];
const PAYMENT_METHODS = ['upi', 'cash', 'card', 'bank', 'other'];
const DISPUTE_CATEGORIES = ['quality', 'quantity', 'delivery', 'payment', 'docs', 'other'];

/** the priorities a chit's queue knows: the one list (the send door and the priority route both read it) */
const PRIORITIES = ['normal', 'high', 'urgent'];

/**
 * RAIL-126 (a) · S33-T: POST /send is a tolerant door (the counter queues sends and replays them on a newer server, docs/contracts/api-hardening-scope.json), so a key this list does not name is IGNORED,
 * and every key it does name says what it holds: a value of the wrong kind is a 400 naming the key. The kinds are what the handler (routes/chits.js) reads each key as: a key it reads only when it is
 * a string is typed text, one it takes by truthiness is BOOLEAN_LIKE; `recipients` and `receivers` are judged by recipientsRule below (its own words, kept); null is allowed on every optional key (a counter sends null for "none"). `send_as_label` and `message` are sent by the web and read by nothing yet.
 */
/** RAIL-212: the most a sender may ask a copy to be kept: a hundred years in days, a typed policy number (a Date holds far less than 1e300 days and threw RangeError); an expires_at past it is refused by the handler */
const RETENTION_MAX_DAYS = 36500;
const TEXT_OR_NULL = { type: ['string', 'null'] };
const SEND_BODY = {
  subject: TEXT_OR_NULL,
  schema_values: { type: ['object', 'null'] },
  is_draft: Object.assign({}, BOOLEAN_LIKE, { type: ['boolean', 'string', 'integer', 'null'], enum: BOOLEAN_LIKE.enum.concat([null]) }),
  send_as_label: TEXT_OR_NULL,
  external_priority: TEXT_OR_NULL,
  promote_draft_id: TEXT_OR_NULL,
  price_ack: { type: ['object', 'null'] } /* CTR-245: the person's answer to PRICE_MOVED, bound to the stamps the 409 showed (lib/price-moved) */,
  forwarded_from: TEXT_OR_NULL,
  client_ref: TEXT_OR_NULL,
  message: TEXT_OR_NULL,
  trace: { type: ['object', 'null'] },
  retention_days: { type: ['number', 'null'], maximum: RETENTION_MAX_DAYS } /* RAIL-212: refused past a hundred years, never clamped */,
  expires_at: TEXT_OR_NULL,
  purpose: oneOfTrimmed(PURPOSES),
  manual_subject: trimmedUpTo(500),
  self_copy: { enum: ['both', 'sent', 'received'] },
  line_items: { type: 'array' },
  business_json: { type: 'object' }
};
/* QA-131: from = the status the page saw (a bulk step; a moved copy is refused) · use = what the goods are for, said with the acceptance (was PUT /use) */
const STATUS_BODY = { status: oneOfTrimmed(railActions.ASKABLE), note: trimmedUpTo(500), from: oneOfTrimmed(railActions.STATES), use: { enum: ['resale', 'use', 'asset'] } };
const PAYMENT_BODY = { method: { enum: PAYMENT_METHODS }, ref: trimmedUpTo(120), amount: POSITIVE_AMOUNT, note: trimmedUpTo(240), acknowledge: { type: 'array' }, client_ref: trimmedUpTo(80) };
/* msg_type: the rail thread sends info or action with every message; ctpreturn carries it to the other side (declared as text: the handler took any) */
const MESSAGE_BODY = { message_text: FILLED, thread_type: { enum: ['external', 'internal'] }, is_dispute: BOOLEAN_LIKE, dispute_id: UUID_OR_NULL, line_id: UUID_OR_NULL, msg_type: trimmedUpTo(16) } /* RAIL-136: chit_messages.msg_type is varchar(16) */;
const DISPUTE_BODY = {
  category: { enum: DISPUTE_CATEGORIES },
  reason: { type: 'string', pattern: '^\\s*\\S[\\s\\S]{8,}\\S\\s*$', examples: ['The goods were short by two boxes'] },
  target_entity_id: UUID_OR_NULL,
  participant_entity_ids: { type: 'array' },
  chit_wide: BOOLEAN_LIKE,
  via: { enum: ['chit', 'mailbox'] }
};
const RESOLVE_BODY = { resolution_note: FILLED, target_entity_id: UUID_OR_NULL };
const PRIORITY_BODY = { priority: oneOfTrimmed(PRIORITIES), reason: trimmedUpTo(500) };
const PRIORITY_FLAG_BODY = { priority: BOOLEAN_LIKE };
const VOID_BODY = { reason: FILLED };
const BULK_BODY = { chit_ids: { type: 'array', minItems: 1, examples: [[EXAMPLE_ID]] }, target_actor_id: UUID_TEXT };

/* QA-142: what a cost row says in figures. The money figures are numbers inside the cost cap bounds.COST_AMOUNT (a business cap, below 10^13 like a chit total, tighter than the column) (a cost corrects an earlier one, so it may be negative), minutes a whole number: a boolean, a text, 1e308 and 2^53 are refused 422 with the field named (money is a value type). */
/* minutes and rate_per_hour may be null (lib/cost.js reads null as absent); amount may not (a null amount is refused by the library already) */
const orNull = (fragment) => Object.assign({}, fragment, { type: [fragment.type, 'null'] });
const COST_FIGURES = { amount: bounds.COST_AMOUNT, rate_per_hour: orNull(bounds.COST_AMOUNT), minutes: orNull(bounds.int32({ signed: true })) };
/* RAIL-186: a cost row names its currency (chit_line_cost.currency is NOT NULL and an unstated currency stays unstated, T2-NATDEF): refused 422 in words, not a database 500 */
const COST_CURRENCY = { type: 'string', minLength: 3 };
/* a row that states a figure (an amount, or minutes to derive one) names its currency; a row stating none reaches the library, which refuses it in its own words */
const COST_NAMES_CURRENCY = { if: { anyOf: [{ required: ['amount'] }, { required: ['minutes'] }] }, then: { required: ['currency'] } };
const COST_ROW_BODY = Object.assign({ type: 'object', properties: Object.assign({ currency: COST_CURRENCY }, COST_FIGURES) }, COST_NAMES_CURRENCY);
/* a list item may be null: lib/cost.js record drops it (filter Boolean), as it always did; `rows: null` is NOT a row and is refused 422 (it was a 400 from the handler) */
const COST_ITEM = Object.assign({ type: ['object', 'null'], properties: Object.assign({ currency: COST_CURRENCY }, COST_FIGURES) }, COST_NAMES_CURRENCY);
/** POST /:chit_id/costs takes { rows: [...] } (a row or a list), one row as the whole body, or a list as the whole body; every row's figures are checked */
const COST_BODY = {
  type: ['object', 'array'],
  properties: Object.assign({ rows: { anyOf: [{ type: 'array', items: COST_ITEM }, COST_ROW_BODY] }, currency: COST_CURRENCY }, COST_FIGURES),
  allOf: [{ if: { type: 'object', not: { required: ['rows'] } }, then: COST_NAMES_CURRENCY }],
  items: COST_ITEM
};

/* ── the old refusals: what each chain said, and in which order it listed the fields ────────────────────── */
/** per route: the order the chains listed their fields, and the sentence a chain gave a field (the rest said "Invalid value"); '' is the recipients rule, which has its own words */
const CHAINS = {
  'POST /send': { order: ['', 'purpose', 'manual_subject', 'self_copy', 'line_items', 'business_json'], says: { purpose: 'Invalid purpose', self_copy: 'self_copy must be both|sent|received' } },
  'PUT /:chit_id/status': { order: ['status', 'note'], says: { status: 'Invalid status' } },
  'POST /:chit_id/payment': { order: ['method', 'ref', 'amount', 'note', 'acknowledge', 'client_ref'], says: {} },
  'POST /:chit_id/messages': { order: ['message_text', 'thread_type', 'is_dispute', 'dispute_id', 'line_id'], says: { message_text: 'Message text required', thread_type: 'thread_type must be external or internal' } },
  'POST /:chit_id/disputes': {
    order: ['category', 'reason', 'target_entity_id', 'participant_entity_ids', 'chit_wide', 'via'],
    says: { category: 'Invalid category', reason: 'Reason must be at least 10 characters', target_entity_id: 'Bad target', participant_entity_ids: 'participant_entity_ids must be an array' }
  },
  'PUT /:chit_id/disputes/:dispute_id/resolve': { order: ['resolution_note', 'target_entity_id'], says: { resolution_note: 'Resolution note required' } },
  'PUT /:chit_id/priority': { order: ['priority', 'reason'], says: { priority: 'priority must be normal|high|urgent' } },
  'PUT /:chit_id/priority-flag': { order: ['priority'], says: { priority: 'priority must be true or false' } },
  'PUT /:chit_id/void': { order: ['reason'], says: { reason: 'A reason is required to void' } },
  'POST /assign-bulk': { order: ['chit_ids', 'target_actor_id'], says: { chit_ids: 'chit_ids[] required', target_actor_id: 'target_actor_id required' } }
};

/** the top-level field a failure is about ('' for the body as a whole, the recipients rule) */
const fieldOfFailure = (failure) => (failure.field === '(body)' ? '' : String(failure.field).split('.')[0]);
/** the sentence of the recipients rule, taken back off the failure that carried it ("(body) <sentence>.") */
const ruleSentenceOf = (failure) => String(failure.detail).replace(/^\(body\) /, '').replace(/\.$/, '');

/** the sentence a detail carries: the recipients rule's own words, else the one the chain gave the field, else "Invalid value" */
const messageOf = (item, chain) => (item.field === '' ? ruleSentenceOf(item.failure) : chain.says[item.field] || INVALID_VALUE);
/** where a detail stands in the list: the place the chain gave its field, else after them all */
const rankOf = (chain) => (detail) => (chain.order.includes(detail.field) ? chain.order.indexOf(detail.field) : chain.order.length);

/** the old body of a refusal: { error: "Validation failed", details: [{ field, message }] }, one detail per field at fault, in the order the chain listed them */
function invalidChit(failures, route) {
  const chain = CHAINS[route];
  const seen = new Set();
  const details = failures
    .map((failure) => ({ field: fieldOfFailure(failure), failure }))
    .filter((item) => !seen.has(item.field) && seen.add(item.field))
    .map((item) => ({ field: item.field, message: messageOf(item, chain) }));
  const rank = rankOf(chain);
  return { error: 'Validation failed', details: details.sort((left, right) => rank(left) - rank(right)) };
}

/** what schemaValidate takes for a route that had a chain: status 400, the code CHIT_INVALID, the old body; nothing for a route that had none */
function schemaOptionsFor(route) {
  return CHAINS[route] ? { status: 400, code: 'CHIT_INVALID', legacy: (failures) => invalidChit(failures, route) } : undefined;
}

/* ── the trim the chains did ─────────────────────────────────────────────────────────────────────────────── */
/** trimmedBody(fields) — a middleware: each field the body carries is its trimmed text, as .trim() left it (null reads as empty); the handler then reads what it always read */
function trimmedBody(fields) {
  return function trimmed(req, res, next) {
    const body = req.body;
    fields.forEach((name) => {
      if (body && Object.prototype.hasOwnProperty.call(body, name) && body[name] !== undefined) body[name] = String(body[name] === null ? '' : body[name]).trim();
    });
    next();
  };
}

/* ── the recipients a send names ─────────────────────────────────────────────────────────────────────────── */
/**
 * recipientFault(body) — the sentence the old chain threw when a send names nobody (and is no draft), or names someone with nothing to find them by; '' when it is fine.
 * The code is the chain's own, line for line (a recipient that is not an object throws the engine's own sentence, as it did there).
 */
function recipientFault(body) {
  try {
    const list = recipientsOf(body);
    if (!body.is_draft && list.length === 0) return 'At least one recipient required';
    return list.some(namesNobody) ? 'Each recipient must have entity_id, display_name, name, or self:true' : '';
  } catch (failure) {
    return String(failure.message);
  }
}
/** the recipients a send names: `recipients`, else the older `receivers`, else none */
const recipientsOf = (body) => (Array.isArray(body.recipients) ? body.recipients : Array.isArray(body.receivers) ? body.receivers : []);
/** a recipient with nothing to find it by (an id, a name) that is not the sender itself */
const namesNobody = (recipient) => !recipient.entity_id && !recipient.display_name && !recipient.name && recipient.self !== true;

/**
 * recipientsRule(operation) — a middleware that runs BEFORE the schema check of a send and answers the old recipients refusal with the schema's other failures beside it
 * (the chain listed the recipients first, then the fields), so a send that is wrong twice is told both. A send whose recipients are fine goes on to the schema check.
 */
function recipientsRule(operation) {
  const options = schemaOptionsFor('POST /send');
  const check = bodyEngine.compile(bodySchemaOf(operation));
  return function recipientsAsked(req, res, next) {
    const fault = recipientFault(req.body || {});
    if (!fault) return next();
    const rule = { field: '(body)', code: 'WRONG_VALUE', detail: '(body) ' + fault + '.' };
    const failures = [rule].concat(errorsOf(check, req.body === undefined ? {} : req.body));
    return problem(req, res, { status: options.status, code: options.code, detail: fault, field: rule.field, errors: failures, legacy: options.legacy(failures) });
  };
}

/** the most rows one page of a chit list answers (DISCIPLINES §2 — never the client's word), and the page it answers when asked for one without a size */
const LIST_MAX = 200;
const LIST_PAGE = 20;

/* RAIL-159: the body of POST /register/subjects (what a register is opened on): words, a uuid or nothing for the thing it points at. [] true -1 1e21 were stored or answered 500 'Failed to open the register' */
const REGISTER_SUBJECT_BODY = { type_key: bounds.text({ max: 60 }), ref_id: Object.assign({ 'x-bound': true }, UUID_OR_NULL), ref_label: orNull(bounds.text()), name: bounds.text() };

module.exports = {
  REGISTER_SUBJECT_BODY, UUID_OR_NULL,
  LIST_MAX, LIST_PAGE,
  COST_FIGURES, COST_BODY, RETENTION_MAX_DAYS,
  SEND_BODY, STATUS_BODY, PAYMENT_BODY, MESSAGE_BODY, DISPUTE_BODY, RESOLVE_BODY, PRIORITY_BODY, PRIORITY_FLAG_BODY, VOID_BODY, BULK_BODY,
  PRIORITIES, PURPOSES, PAYMENT_METHODS, DISPUTE_CATEGORIES,
  CHAINS, invalidChit, schemaOptionsFor, trimmedBody, recipientFault, recipientsRule, UUID_TEXT
};
