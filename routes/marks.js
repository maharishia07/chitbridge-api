// OWNS      /api/marks: MARK & QUERY — a reviewer's mark on a record that lives elsewhere (Checked, Query, On hold), the open queries, and the conversation about a marked record. Adopter 1 is the auditor's marks on journal entries (acc.audit).
// CALLED BY server.js (mounted at /api/marks), the day book and the ledger (they embed marksFor themselves), the query sheet and the open-queries list (web cap-mark.js).
// FLOW      the grant front (middleware/books-grant: X-Books-For names the member; the READ doors run READ ONLY, the TWO write doors open ONE transaction in lib/mark-door) → auth → noKey → the schema check (lib/marks-contract) → lib/review-mark (the core)
//           → the answer; a refusal → problem(req, res, the refusal in words). Each answer carries `actions` ({ set, reply } with the sentence): the page never decides.
// CARD      capability/MARK-AND-QUERY-CAPABILITY
// ⚠️ EXACTLY TWO WRITE DOORS under a grant: POST / (set) and POST /:thread_id/messages (reply). POST /query is a READ (ids in a body). tests/mark-write-door-classification.test.cjs fails any other non-GET here.
// ⚠️ A reply never changes the class, and nothing here leaves the installation: no CTP, no WhatsApp, no mail (lib/message-post, the 'mark' path).
const express = require('express');
const router = express.Router();
router.use(require('../middleware/books-grant'));
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem');
const { declaresStatuses } = require('../lib/contract-kit');
const contract = require('../lib/marks-contract');
const core = require('../lib/review-mark');
const door = require('../lib/mark-door');
const { adopterOf, vocabularyOf } = require('../lib/mark-adopters');

const MAX_IDS = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** a key is not a person: nothing here is done by a device key */
function noKey(req, res, next) {
  if (!req.api_key) return next();
  return problem(req, res, { status: 403, code: 'SIGN_IN_FOR_MARKS', detail: 'Sign in to work on marks.', legacy: { error: 'Sign in to work on marks.', message: 'Sign in to work on marks.' } });
}
/** a refusal in words (the core's typed refusal, or a grant look's) as a Problem with the old keys beside it */
function answerRefusal(req, res, err) {
  if (err && err.words) return problem(req, res, { status: err.status || 500, code: err.code, detail: err.words, legacy: { error: err.words, message: err.words } });
  throw err;
}
const refuse = (req, res, status, code, words) => problem(req, res, { status, code, detail: words, legacy: { error: words, message: words } });
/** run a handler body and answer; a typed refusal is answered in words, anything else is the server's own handler (a 500 that says nothing of its cause) */
const handler = (work, okStatus) => async (req, res, next) => {
  try {
    const out = await work(req, res);
    if (out !== undefined) res.status(typeof okStatus === 'function' ? okStatus(out) : okStatus || 200).json(out);
  } catch (err) {
    try {
      answerRefusal(req, res, err);
    } catch (unknown) {
      next(unknown);
    }
  }
};
const adopterOfReq = (key) => {
  const adopter = adopterOf(String(key || ''));
  if (!adopter) throw core.said('MARK_ADOPTER_UNKNOWN', 422);
  return adopter;
};
const idsOf = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const monthStart = () => new Date().toISOString().slice(0, 8) + '01';
const todayIso = () => new Date().toISOString().slice(0, 10);

/** the list answer: the marks by id, the ones that no longer read, the words and what this person may do */
async function listAnswer(req, adopterKey, ids) {
  const adopter = adopterOfReq(adopterKey);
  if (ids.length > MAX_IDS) throw core.said('MARK_IDS_TOO_MANY', 422);
  return door.run(req, async (db, ctx) => {
    const found = await core.marksFor(db, adopterKey, ctx.entity_id, ids, ctx);
    return { adopter: adopterKey, marks: found.marks, not_found: found.not_found, vocabulary: vocabularyOf(adopter), actions: core.actionsOf(adopter, ctx, null) };
  });
}

// @does An adopter and a list of record ids, or open=1 for the open items -> we read the latest mark of each record (or the open queries with their age and "checked n of m") in one read -> the marks, the words and what you may do.
router.get('/', auth, noKey, declaresStatuses([503]), ...contract.checked('GET /'), handler(async (req) => {
  const { adopter: adopterKey, ids, open, from, to } = req.query;
  const adopter = adopterOfReq(adopterKey);
  if (open === '1' || open === 'true') {
    const period = { from: from == null ? monthStart() : String(from), to: to == null ? todayIso() : String(to) };
    if (!DAY.test(period.from) || !DAY.test(period.to)) throw core.refusal('MARK_PERIOD_INVALID', 422, 'Give the period as two dates, year-month-day.');
    return door.run(req, async (db, ctx) => {
      const list = await core.openList(db, adopterKey, ctx.entity_id, ctx, period);
      return Object.assign({ adopter: adopterKey, from: period.from, to: period.to }, list, { vocabulary: vocabularyOf(adopter), actions: core.actionsOf(adopter, ctx, null) });
    });
  }
  return listAnswer(req, adopterKey, idsOf(ids));
}));

// @does An adopter and more record ids than a query string carries in a body -> we read the latest mark of each (a read, not a write) -> the marks, the words and what you may do.
router.post('/query', auth, noKey, declaresStatuses([503]), ...contract.checked('POST /query'), handler((req) => listAnswer(req, req.body.adopter, (req.body.ids || []).map(String).filter(Boolean).slice(0, 500))));

/** the writes: under a grant the look, the insert and the log row are ONE transaction (lib/mark-door writeRun); the owner's own call runs plain (and is then refused by the adopter's policy) */
async function write(req, res, work) {
  if (!req.mark_door) return door.run(req, work);
  const outcome = await door.writeRun(req, work);
  if (outcome.refused) {
    const { status, code, words } = outcome.refused;
    return refuse(req, res, status, code, words) && undefined;
  }
  return outcome.result;
}

// @does An adopter, a record, a mark word and (for a Query) the question in -> the auditor sets the mark in one transaction with the grant look and its log row -> the mark; the owner and the adviser are refused.
router.post('/', auth, noKey, declaresStatuses([503]), ...contract.checked('POST /'), handler(async (req, res) => {
  const adopter = adopterOfReq(req.body.adopter);
  const result = await write(req, res, async (db, ctx) => core.set(db, ctx, req.body));
  if (result === undefined) return undefined;
  return Object.assign({}, result, { vocabulary: vocabularyOf(adopter) });
}, (out) => (out.unchanged ? 200 : 201)));

// @does A thread id in -> we read the marked record's mark, its history and the replies with what you may do -> the conversation, or 404 for a thread that is not these books'.
router.get('/:thread_id/messages', auth, noKey, declaresStatuses([503]), ...contract.checked('GET /:thread_id/messages'), handler((req) => door.run(req, (db, ctx) => core.threadOf(db, ctx, req.params.thread_id))));

// @does A thread id and the words in -> the owner or the adviser answers a Query or On hold; the class does not change and nothing leaves the installation -> the message and the mark.
router.post('/:thread_id/messages', auth, noKey, declaresStatuses([503]), ...contract.checked('POST /:thread_id/messages'), handler(async (req, res) => write(req, res, (db, ctx) => core.reply(db, ctx, req.params.thread_id, req.body)), 201));

router.openapi = { paths: contract.pathsOf() };
module.exports = router;
