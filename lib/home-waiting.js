'use strict';
/**
 * lib/home-waiting.js — the Home card's "waiting on you" line for the books: the counts and the words (split out of lib/home-facts.js so that file does not grow).
 * OWNER     cb-accounting
 * OWNS      waitingWithHeld(handle, entity) → the ONE waiting count (books-store waitingCount) plus `held`, the entries waiting for the owner's OK (SHOPBK-B, books-action.waitingForOwner, the one queue read) ·
 *           waitingWords(counts, plural) → what those rows ask of the owner, in Books' To do words
 * CALLED BY lib/home-facts.js (accounts)
 * FLOW      the owner's handle → waitingCount + waitingForOwner (one transaction) → counts → words; nothing is counted a second time here
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
/** the books' waiting counts plus `held`: the entries waiting for the owner's OK, from the one queue read (lib/books-action.waitingForOwner) */
async function waitingWithHeld(handle, entity) {
  const counts = await require('./books-store').waitingCount(handle, entity);
  return Object.assign({}, counts, { held: (await require('./books-action').waitingForOwner(handle, entity, 1)).total });
}

/** what the waiting rows ask of the owner, in Books' To do words (`plural` is the caller's own count-and-noun helper) */
function waitingWords(counts, plural) {
  const said = [];
  if (counts.accept) said.push(plural(counts.accept, 'supplier bill') + ' to accept');
  if (counts.add_supplier) said.push(plural(counts.add_supplier, 'supplier') + ' to add');
  if (counts.record) said.push(counts.record + ' waiting to be recorded');
  if (counts.held) said.push(plural(counts.held, 'entry', 'entries') + ' waiting for your OK');
  return said;
}
module.exports = { waitingWithHeld, waitingWords };
