/*
 * OWNS      the contract of routes/marks.js (MARK & QUERY, API-STANDARD S9): each route's OpenAPI operation, its strict input and its answer shape.
 * CALLED BY routes/marks.js (checked(route) in front of each handler, router.openapi) · tools/api-register.cjs · tools/api-contract-tests.cjs · /api/openapi.json · docs/marks-contract.md (the same shapes, for the web).
 * FLOW      operation → schemaValidate(operation) at the route → the register reads router.openapi → the contract cases run from the same schemas
 * CARD      capability/MARK-AND-QUERY-CAPABILITY
 * Six routes: the list of marks for ids and the open items (GET /), the same read with the ids in a body (POST /query), the ONE set door (POST /), the thread (GET /:thread_id/messages) and the ONE reply door (POST /:thread_id/messages).
 */
'use strict';
const { contractOf, object, array, text, maybeText } = require('./contract-kit');
const { UUID_TEXT } = require('./chits-input');

const IDS = { thread_id: UUID_TEXT };
const ACTION = object(['ok', 'why'], { ok: { type: 'boolean' }, why: maybeText });
const ACTIONS = object(['set', 'reply'], { set: ACTION, reply: ACTION });
const WORD = object(['kind', 'label', 'class', 'note'], { kind: text, label: text, class: text, note: text });
const MARK = object(['mark_id', 'adopter', 'subject_id', 'thread_id', 'kind', 'class', 'label', 'at', 'open', 'altered', 'recheck_needed', 'message_count', 'actions'], {
  mark_id: text, adopter: text, subject_id: text, thread_id: text, kind: text, class: text, label: text, note: maybeText, at: text, by_name: maybeText, by_firm: maybeText,
  open: { type: 'boolean' }, open_since: maybeText, age_days: { type: ['integer', 'null'] }, altered: { type: 'boolean' }, altered_by: object(), recheck_needed: { type: 'boolean' }, message_count: { type: 'integer' }, actions: ACTIONS
});
const MARKS_BY_ID = { type: 'object', additionalProperties: { anyOf: [MARK, { type: 'null' }] } };
const LIST_ANSWER = object(['adopter', 'marks', 'not_found', 'vocabulary', 'actions'], { adopter: text, marks: MARKS_BY_ID, not_found: array(text), vocabulary: array(WORD), actions: ACTIONS });
const OPEN_ANSWER = object(['adopter', 'from', 'to', 'open', 'total_open', 'vocabulary', 'actions'], {
  adopter: text, from: text, to: text, open: array(object(['subject_id'], { subject_label: maybeText, posting_date: maybeText })), total_open: { type: 'integer' }, oldest_age_days: { type: ['integer', 'null'] },
  checked: { type: ['integer', 'null'] }, of: { type: ['integer', 'null'] }, vocabulary: array(WORD), actions: ACTIONS
});
const MESSAGE = object(['message_id', 'sender_display_name', 'message_text', 'msg_type', 'created_at', 'mine'], { message_id: text, sender_display_name: text, message_text: text, msg_type: text, created_at: text, mine: { type: 'boolean' } });
const THREAD = object(['thread_id', 'adopter', 'subject_id', 'history', 'messages', 'actions'], { thread_id: text, adopter: text, subject_id: text, subject_label: maybeText, mark: { anyOf: [MARK, { type: 'null' }] }, history: array(object(['mark_id', 'kind', 'class', 'at'])), messages: array(MESSAGE), actions: ACTIONS });

const ROUTES = {
  'GET /': { summary: 'The latest mark of each record in a list (ids, at most 200), or the open items with their age and "checked n of m" (open=1): one read for the page', gates: [], inline: [422, 503], query: ['adopter', 'ids', 'open', 'from', 'to'], out: { anyOf: [LIST_ANSWER, OPEN_ANSWER] } },
  'POST /query': { summary: 'The same read as GET / for more ids than a query string carries (a read, not a write door)', gates: [], inline: [422, 503], body: { adopter: text, ids: array(text) }, required: ['adopter', 'ids'], out: LIST_ANSWER },
  'POST /': { summary: 'Set a mark on one record (the auditor only; one transaction with the grant look and its log row): Checked, Query (needs words), On hold, or take the mark off', gates: [], ok: 201, inline: [403, 404, 422, 503], body: { adopter: text, subject_id: text, subject_ids: array(text), kind: text, note: maybeText }, required: ['adopter', 'kind'], out: object(['mark'], { mark: MARK, unchanged: { type: 'boolean' }, vocabulary: array(WORD) }) },
  'GET /:thread_id/messages': { summary: 'The conversation about one marked record: the mark, its history and the replies, with what this person may do', gates: [], inline: [404, 503], params: IDS, out: THREAD },
  'POST /:thread_id/messages': { summary: 'Answer a Query or On hold in its thread (the owner, the adviser and the auditor); the class never changes and nothing leaves this installation', gates: [], ok: 201, inline: [403, 404, 409, 422, 503], params: IDS, body: { message_text: text, msg_type: { type: 'string', enum: ['info', 'query'] } }, required: ['message_text'], out: object(['message'], { message: MESSAGE, mark: { anyOf: [MARK, { type: 'null' }] } }) }
};

module.exports = Object.assign({ ROUTES }, contractOf({ mount: '/api/marks', routes: ROUTES, gateStatus: {} }));
