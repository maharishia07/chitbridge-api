'use strict';
/**
 * lib/seat-abilities.js — UX-222: what a seat's grant TEXT may promise, in ONE place beside the decision that answers it.
 *
 * OWNER     cb-people
 * OWNS      the named abilities of the books (words, and the decision): a route-backed ability names the route whose gate chain answers it (routes/books.js, read by tools/seat-matrix.cjs);
 *           an in-handler ability carries `may(req)`, the function the route itself calls (fxMay, the Collections read) — so the screen, the gate and the grant text read one answer.
 *           whyOf(does, stays) writes a grant's sentence from the ability names; a preset (lib/access.js PRESETS) lists names, never prose.
 *           DRIFT 9b: the paper-direction rule of the work list (assignOn, onMyCopy, cameToMe, cameToMeSql, worklistShows) — one rule for the sheet, the assign-lines route and the worklist (coordinator chose this home; cb-people advised lib/work-rows as the alternative)
 * CALLED BY lib/assign.js (byPerson) · lib/work-rows.js (classify) · routes/chits.js (assign-lines) · lib/access.js (the Bookkeeper preset) · routes/books.js (fxMay, GET /dues?finance=1) · tests/seat-grant-text.test.cjs (the guard: promised = the gate says yes, kept back = it does not)
 * FLOW      preset { does, stays } → whyOf → the sentence the owner reads in Employees; the guard asks the SAME gates for the Bookkeeper seat and fails on a difference
 * RISK      security
 * CARD      17-people-employees-hr-and-payroll/people-list-with-may-why
 */
const owner = require('./owner');

const ownerOrAccountant = (req) => owner.isOwner(req) || owner.isInHouseAccountant(req);
/**
 * words: said when the seat does it · noun: said when the seat is kept from it · route: 'VERB /path' of routes/books.js whose gate chain decides · may: the function the route calls when the decision is inside its handler.
 */
const ABILITIES = {
  post_entries: { words: 'posts entries', noun: 'posting', route: 'POST /entries' },
  match_bank: { words: 'matches the bank', noun: 'bank matching', route: 'POST /bank/marks' },
  month_pack: { words: 'runs the month pack', noun: 'the month pack', route: 'POST /packs' },
  fx_rates: { words: 'sets FX rates', noun: 'FX rates', may: ownerOrAccountant }, // POST /fx-rates is `ownerOrAccountant`; GET /fx-rates says the same through this
  read_reports: { words: 'reads the reports', noun: 'the reports', route: 'GET /pl' },
  collections: { words: 'sees collections', noun: 'collections', may: (req) => owner.isOwner(req) }, // GET /dues?finance=1: owner only until cb-finance widens it
  pay_out: { words: 'pays a supplier', noun: 'paying a supplier', route: 'POST /payments' },
  lock_month: { words: 'locks a month', noun: 'locks', route: 'POST /periods/:fy/:p/:act' },
  close_year: { words: 'closes the year', noun: 'year close', route: 'POST /year/:fy/close' }
};

/** may this request do the named ability? (only for an in-handler ability; a route-backed one is the route's own gate) */
function mayDo(name, req) {
  const ability = ABILITIES[name];
  if (!ability || typeof ability.may !== 'function') throw new Error('seat-abilities: ' + name + ' has no in-handler decision');
  return ability.may(req);
}

const list = (items) => (items.length > 1 ? items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1] : items[0] || '');
/** the sentence of a grant: what the seat does, then what stays with the owner — written from the ability names */
function whyOf(does, stays) {
  return 'Keeps the shop’s books: ' + does.map((name) => ABILITIES[name].words).join(', ') + '. ' + (stays.length ? list(stays.map((name) => ABILITIES[name].noun)).replace(/^./, (c) => c.toUpperCase()) + ' stay with the owner.' : '');
}

/**
 * UX-219: the everyday abilities of the NON-books seats, by name, so the owner reads "Can ... Cannot ..." for every role and not a developer's note (Fable walk AU r2, O3).
 * `level` is the access rung that decides it (lib/access.js): the guard asks canEdit/levelOf and the cost flag, never this text.
 */
const EVERYDAY = {
  sell: { words: 'sell at the till', level: 'write' },
  records: { words: 'add or change items, customers and orders', level: 'write' },
  records_all: { words: 'sell and change records at every branch', level: 'write' },
  read_own: { words: 'look at their own work', level: 'read' },
  read_all: { words: 'see every branch', level: 'read' },
  read_money: { words: 'see money and costs', level: 'costs' },
  comment: { words: 'leave comments inside the business', level: 'comment' },
  change: { words: 'change anything', level: 'write' },
  write_out: { words: 'write to customers', level: 'write' },
  others_work: { words: 'see other people’s work', level: 'read' },
  books: { words: 'open the books or money reports', level: 'books' },
  costs: { words: 'see cost prices', level: 'costs' }
};
/** the two parts of a role line, written from ability names: { can, cannot, text } (the screen shows both; text is the joined string for the API and a screen reader) */
function canOf(can, cannot) {
  const part = (names) => list(names.map((name) => EVERYDAY[name].words));
  const said = { can: part(can), cannot: part(cannot) };
  return Object.assign(said, { text: 'Can: ' + said.can + '. Cannot: ' + said.cannot + '.' });
}

/**
 * UX-226b: the ONE name for each role, so no screen or row invents one (Fable walk AU r2, O7). A role key is the access kind (adviser = an outside accountant, auditor = the reader,
 * bookkeeper = the shop's own books seat, staff = a login of the shop); GET /entities/sides carries this map as `roles` and the web (CBRoles.adopt) reads it, its own copy is only the first paint.
 */
const ROLE_NAMES = {
  adviser: { name: 'Accountant', line: 'Accountant: acts for you', firm: 'Accountant firm' },
  auditor: { name: 'Auditor', line: 'Auditor: reads only', firm: 'Audit firm' },
  bookkeeper: { name: 'Bookkeeper', line: 'Bookkeeper: keeps your books', firm: 'Bookkeeper' },
  staff: { name: 'Staff', line: 'Staff: works for you', firm: 'Staff' }
};


/**
 * DRIFT 9b (Athi 28 Nov): who in our shop follows a paper up is ONE rule, asked by every door (the work sheet's assign_line, POST /chits/:id/assign-lines, the worklist).
 * A paper the shop SENT is assignable as much as one it received (the sender chases delivery and payment): the verdict is the rail's own (I hold a copy, my access level allows it),
 * never the paper's direction. assignOn(held, me) → { ok } | { ok:false, why }; me = railActions.meOf(req).
 */
function assignOn(held, me) {
  return require('./rail-actions').can({ held: !!held }, me, 'assign');
}
/** THE one 'did this copy come to me' test (N-F-03, Fable A4): a task/order I received, or a firm's JOB chit on its SENT copy. work-rows classify and the worklist both read it. */
function onMyCopy(direction, isJob) {
  return isJob ? direction !== 'received' : direction === 'received';
}
/** the worklist's reading of it for one paper: never an invoice; a missing direction is received */
function cameToMe(paper) {
  const p = paper || {};
  return p.purpose !== 'invoice' && onMyCopy(p.direction || 'received', !!p.is_job);
}
/** the same test as cameToMe, written for SQL (h = the chit_header alias) so the database never sends a sent paper's unassigned lines; seat-abilities.test asserts the two agree on every paper kind */
const cameToMeSql = (h) =>
  `COALESCE(${h}.purpose, '') <> 'invoice' AND (CASE WHEN COALESCE(${h}.is_job, false) THEN ${h}.direction <> 'received' ELSE COALESCE(${h}.direction, 'received') = 'received' END)`;
/**
 * the worklist's question about one line: an ASSIGNED line shows whenever the assignment is allowed (sent or received); an UNASSIGNED line shows only on a paper that came to me,
 * so the shop's own sent orders and invoices do not fill the list with work nobody owes (N-F-03: 12 pieces read for a hand count of 7).
 */
function worklistShows(paper, assignedTo) {
  return assignedTo ? true : cameToMe(paper);
}

module.exports = { ABILITIES, EVERYDAY, ROLE_NAMES, mayDo, whyOf, canOf, assignOn, onMyCopy, cameToMe, cameToMeSql, worklistShows };
