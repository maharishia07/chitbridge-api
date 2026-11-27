'use strict';
/**
 * lib/seat-abilities.js — UX-222: what a seat's grant TEXT may promise, in ONE place beside the decision that answers it.
 *
 * OWNER     cb-people
 * OWNS      the named abilities of the books (words, and the decision): a route-backed ability names the route whose gate chain answers it (routes/books.js, read by tools/seat-matrix.cjs);
 *           an in-handler ability carries `may(req)`, the function the route itself calls (fxMay, the Collections read) — so the screen, the gate and the grant text read one answer.
 *           whyOf(does, stays) writes a grant's sentence from the ability names; a preset (lib/access.js PRESETS) lists names, never prose.
 * CALLED BY lib/access.js (the Bookkeeper preset) · routes/books.js (fxMay, GET /dues?finance=1) · tests/seat-grant-text.test.cjs (the guard: promised = the gate says yes, kept back = it does not)
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

module.exports = { ABILITIES, EVERYDAY, mayDo, whyOf, canOf };
