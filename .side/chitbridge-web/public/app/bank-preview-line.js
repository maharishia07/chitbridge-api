/* bank-preview-line.js — BANK STATEMENT → BOOKS: the words and the shape of ONE statement line for public/app/bank-preview.js.
 * OWNS      the state and blocker words a line shows (STATE_WORDS · NEEDS_WORDS · ASKED), the amount and date as text (moneyText · dateText · minorOf) and lineOf — the statement line joined to
 *           what the engine said about it (its entry, its state, the blocker a person answers next, the month lock), ready to paint and to post. It computes no money: every figure is carried.
 * CALLED BY public/app/bank-preview.js (the one controller; node: required when the global is absent) · e2e/bank-preview.test.cjs through it. Loaded BEFORE bank-preview.js by public/accounts.html and public/bank-demo.html.
 * FLOW      the engine's projected line + the parsed statement line + the proposal → lineOf → one item the page paints (bank-preview-ui.js) and posts (the injected adapter)
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * Split out of bank-preview.js (shrink W2, 2026-11-17): behaviour unchanged, the same functions.
 */
(function (root) {
  'use strict';
  var STATE_WORDS = { in_books: 'In your books', proposed: 'Ready to add', check: 'Needs you', needs_you: 'Needs you', posted: 'Added', failed: 'Not added', closed: 'Month closed' };
  /** why a proposed line is held back, in the words the line shows (B5-01/02/03: a held-back line says so ON the line, never a silent "Ready") */
  var NEEDS_WORDS = {
    gst_basis: 'Tax basis needed',
    tax_invoice: 'Tax invoice needed',
    fee_tax: 'Tax on the fee needed',
    needs_tick: 'Needs your tick',
    may_be_in_books: 'May already be in your books',
    unbalanced: 'Entry does not balance',
    refused: 'The books refused this entry',
    bank_leg_mismatch: "Entry does not match the bank line's amount",
    tax_kind: 'Tax needed',
    not_here: 'Not added from a bank line yet: record it in Books, then load the statement again',
    no_entry: 'Needs you'
  };
  /** the blockers a person answers on the line, in the order they are asked (is it new at all? then the tax, then the tick); every other blocker is only shown */
  var ASKED_ = ['may_be_in_books', 'tax_kind', 'gst_basis', 'fee_tax', 'tax_invoice', 'needs_tick'];
  var MAX_FILE_BYTES = 2 * 1024 * 1024;
  var MATCH_WINDOW_DAYS = 3;

  /** the minor amount of a money value { amount_minor } (or of a bare minor number); 0 when there is none */
  function minorOf(money) {
    if (money && typeof money === 'object') return +money.amount_minor || 0;
    return +money || 0;
  }
  /** a carried amount as text in its own currency: "AUD 2,200.00"; the digits come from the money unit, never a fixed 2 */
  function moneyText(money, currency) {
    var minor = minorOf(money),
      code = (money && money.currency) || currency,
      unit = root.CBMoney,
      digits = unit && unit.decimals && code ? unit.decimals(code) : 2;
    var text = (Math.abs(minor) / Math.pow(10, digits)).toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return (code ? code + ' ' : '') + (minor < 0 ? '-' : '') + text;
  }
  /** "5 Nov 2026" from 'YYYY-MM-DD'; '' when there is no date */
  function dateText(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    var month = new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString('en-AU', { month: 'short', timeZone: 'UTC' });
    return Number(m[3]) + ' ' + month + ' ' + m[1];
  }

  /** a line's standing: its state, the words for it and whether it may be posted; a locked month holds a line the books do not have yet (never one already in them) */
  function standingOf_(projected, closed) {
    if (closed) return { state: 'closed', why: closed.words, ready: false };
    return { state: projected.state, why: projected.why || '', ready: !!projected.ready };
  }
  /** the new-party proposal (with its did-you-mean) that names this statement line, or null */
  function partyProposalFor_(toCreate, lineIndex) {
    return (
      toCreate.filter(function (proposal) {
        return proposal.lines.indexOf(lineIndex) >= 0;
      })[0] || null
    );
  }
  /** the one blocker the person answers next, by the order they are asked; null when none of them is held */
  function askedNeedOf_(blockers) {
    return (
      ASKED_.filter(function (code) {
        return blockers.indexOf(code) >= 0;
      })[0] || null
    );
  }
  /** what the engine carried about a line besides its entry: the tax record, what made the proposal, the books entries it may already be */
  function carriedOf_(projected) {
    return { tax: projected.tax || null, basis: projected.basis || null, near: projected.near || [], what: projected.what || null };
  }

  /** the month lock of one line: a locked month holds a line the books do not have yet (never one already in them). W15-85: the person chose "Post in <next month> instead" for this month:
   *  the line is worked as any other and posts on the first day of the next open month, its own date kept → { moveTo, closed } */
  function lockOf_(projected, statementLine, lockedMonth, moved) {
    var locked = lockedMonth && projected.state !== 'in_books' ? lockedMonth(statementLine.date) : null,
      moveTo = locked && locked.next && moved && moved[locked.key] ? locked : null;
    return { moveTo: moveTo, closed: moveTo ? null : locked };
  }
  /** one carried field of the engine's proposal for the line, null when the line has no proposal or the field is empty */
  function proposalField_(proposal, key) {
    return (proposal && proposal[key]) || null;
  }
  /** what the engine's proposal says about a line: the open invoice or bill it is (bank-recon open_item), a card settlement net of its fee (BB-04: gross · fee · net), the party's open bills
   *  to pick from when no ONE set adds up to the payment (BB-10), the allocation refusal, and the event POST /events takes (the one posting.post composed the entry from) */
  function proposalOf_(proposal) {
    return {
      against: proposalField_(proposal, 'against'),
      split: proposalField_(proposal, 'split'),
      openBills: proposalField_(proposal, 'open_bills'),
      allocateRefusal: proposalField_(proposal, 'allocate_refusal'),
      event: proposalField_(proposal, 'event')
    };
  }
  /** the statement line (index i) joined to what the engine said about it, ready to paint and to post */
  function lineOf_(projected, statementLine, proposal, lockedMonth, toCreate, moved) {
    var blockers = projected.blockers || [],
      lock = lockOf_(projected, statementLine, lockedMonth, moved),
      named = partyProposalFor_(toCreate, projected.i);
    var item = {
      key: projected.ref,
      ref: projected.ref,
      i: projected.i,
      line: statementLine,
      entry: projected.entry || null,
      needs: askedNeedOf_(blockers),
      blockers: blockers,
      closed: lock.closed,
      moveTo: lock.moveTo,
      party: projected.party ? Object.assign({}, projected.party) : null,
      didYouMean: (named && named.did_you_mean) || []
    };
    return Object.assign(item, proposalOf_(proposal), carriedOf_(projected), standingOf_(projected, lock.closed));
  }

  var lineKit = {
    STATE_WORDS: STATE_WORDS,
    NEEDS_WORDS: NEEDS_WORDS,
    ASKED: ASKED_,
    minorOf: minorOf,
    moneyText: moneyText,
    dateText: dateText,
    lineOf: lineOf_
  };
  root.CBBankPreviewLine = lineKit;
  if (typeof module !== 'undefined' && module.exports) module.exports = lineKit;
})(typeof globalThis !== 'undefined' ? globalThis : this);
