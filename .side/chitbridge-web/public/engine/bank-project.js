/* ADOPTED from chitbridge-engines v1.98.0 · bank-project · sha256 a51e3b1b4a4e8dab843783f8176bf7da046c473ffc52eeae70887060a740e0cb — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/**
 * bank-project.js: THE BANK LEDGER AND THE RECONCILIATION AS THEY WILL READ ONCE THE PROPOSED ENTRIES ARE POSTED. PURE: no I/O, no clock, nothing saved.
 * OWNS project (the preview: bank ledger after posting, the BRS, each line's state) · refsOf / fingerprintOf / readRef (the idempotency key of a statement line) · partyKeyOf.
 * CALLED BY the web preview (public/app/bank-preview.js, the no-login demo page and the in-app bank screen via the same module) · the api's per-line POST /events caller reads `ref`.
 * FLOW bank statement → books: parse → match → suggest (bank-recon) → project (here, on the device) → confirm → post one line at a time. CARD 16-finance/bank-reconciliation-and-bank-rail.
 * ONE calculation: project reads the `entry` bank-recon.suggest() composed through posting.post and NOTHING else. It builds no entry, calls no posting.post, multiplies no rate and divides no tax.
 * Its own work is carried sums (a running balance, a closing) and one MISMATCH check: an entry's bank leg against the statement line's own amount (a line that does not tie is listed, never counted).
 * Money: every figure is a money.js value { amount_minor, currency }; the operators refuse a currency mismatch. A statement in another currency than the account is refused BEFORE any line is read.
 */
(function (root) {
  'use strict';
  var DEPS_ = {};
  /** a sibling engine, from node or from the page's global; null when it would not load */
  function dep_(file, globalName) {
    if (DEPS_[file]) return DEPS_[file];
    var scope = typeof globalThis !== 'undefined' ? globalThis : root;
    if (scope[globalName] && typeof scope[globalName] === 'object' && Object.keys(scope[globalName]).length) return (DEPS_[file] = scope[globalName]);
    if (typeof require === 'function') {
      try {
        return (DEPS_[file] = require(file));
      } catch (loadFailure) {
        return null;
      }
    }
    return null;
  }

  /* ═══ the line's key: bank:<fingerprint>-<ordinal> ═══════════════════════════════════════════════════════════════ */
  var SEEDS_ = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  /** one 32-bit FNV-1a hash of the text from a seed, mixed at the end; 8 hex digits */
  function hash32_(text, seed) {
    var h = (0x811c9dc5 ^ seed) >>> 0;
    for (var at = 0; at < text.length; at++) {
      h ^= text.charCodeAt(at);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39) >>> 0;
    h ^= h >>> 15;
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  /** 24 hex digits (96 bits) of three seeded hashes of the text */
  function digest_(text) {
    return SEEDS_.map(function (seed) {
      return hash32_(text, seed);
    }).join('');
  }
  /** a narration as the key reads it: upper case, runs of anything but letters and digits as one space, trimmed (a re-export that changes spacing or case is the same line) */
  function descriptionKey_(text) {
    return String(text || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
  }
  /** a statement line's signed amount in minor units: credit in, debit out */
  function signedOf_(line) {
    return (+line.credit_minor || 0) - (+line.debit_minor || 0);
  }
  /**
   * fingerprintOf(line, account) → 24 hex digits: the hash of the account, the line's date, its signed amount in minor units and its normalised description.
   * NO row number and NO file hash: a re-export of the same statement, with its rows shifted or a new file hash, gives the same fingerprint.
   */
  function fingerprintOf(line, account) {
    var parts = [String(account || '').trim().toUpperCase(), (line && line.date) || '', signedOf_(line || {}), descriptionKey_(line && line.narration)];
    return digest_(parts.join('|'));
  }
  /** the period's lines grouped by fingerprint, each with its place (ordinal) in its group: { fp: [{ balance, ordinal, taken }] } */
  function groupsOf_(period, account) {
    var groups = {};
    period.forEach(function (line) {
      var print = fingerprintOf(line, account),
        group = (groups[print] = groups[print] || []);
      group.push({ balance: line.balance_minor == null ? null : line.balance_minor, ordinal: group.length + 1, taken: false });
    });
    return groups;
  }
  /** this line's place among the identical lines of the period: the first not yet taken whose running balance agrees (or either has none); past the period's own count when it is not there */
  function ordinalOf_(group, line) {
    var spot = group.filter(function (entry) {
      return !entry.taken && (entry.balance === null || line.balance_minor == null || entry.balance === line.balance_minor);
    })[0];
    if (spot) {
      spot.taken = true;
      return spot.ordinal;
    }
    group.push({ balance: null, ordinal: group.length + 1, taken: true });
    return group.length;
  }
  /**
   * refsOf(lines, account, period?) → one client_ref per line, 'bank:<fingerprint>-<n>': n is the line's place among the lines with the SAME fingerprint across the statement PERIOD
   * (period = every line of that period the caller holds, default the file itself), so two real identical lines are two entries (1, 2), the same file loaded twice is the same refs, and
   * a re-export holding only the second of them is still -2 (matched to its place by the running balance when both lines carry one). Without the period a subset file counts from 1:
   * a known limit, the second guard is the match against the ledger after posting. 5 + 24 + 1 + at most 4 digits: inside the api's 80-character slice.
   */
  function refsOf(lines, account, period) {
    var groups = groupsOf_(period && period.length ? period : lines || [], account);
    return (lines || []).map(function (line) {
      var print = fingerprintOf(line, account);
      groups[print] = groups[print] || [];
      return 'bank:' + print + '-' + ordinalOf_(groups[print], line);
    });
  }
  var REF_NEW_ = /^bank:([0-9a-f]{24})-(\d{1,4})$/;
  var REF_OLD_ = /^bank:([0-9a-f]{8,64}):(\d{1,6})$/i;
  /**
   * postedFlags(lines, refs, posted, file?) → a boolean per line: true when the line is already in the books by its client_ref. `posted` = the client_refs already stored. A new-form ref is
   * matched as it is; an OLD-form one has no fingerprint, so it is matched on what it holds, the file hash and the line's row (`line.row`, else its place in the file + 1), and only when `file.hash`
   * is given (the same file loaded again). A re-export with a new hash cannot match an old ref: the ledger match after posting is the guard for those.
   */
  function postedFlags(lines, refs, posted, file) {
    var have = {};
    (posted || []).forEach(function (ref) {
      have[ref] = true;
    });
    return (lines || []).map(function (line, at) {
      return !!(have[refs[at]] || (file && file.hash && have['bank:' + String(file.hash).toLowerCase() + ':' + (line.row != null ? line.row : at + 1)]));
    });
  }
  /**
   * readRef(ref) → what a stored client_ref is: { kind: 'fingerprint', fp, ordinal } (this version), { kind: 'file', hash, row } (the old bank:<file hash>:<line no>, still
   * recognised so a line posted before is not posted again by a reader that knows only the new form), or null when it is not a bank line's ref.
   */
  function readRef(ref) {
    var text = String(ref || ''),
      fresh = REF_NEW_.exec(text),
      old = fresh ? null : REF_OLD_.exec(text);
    if (fresh) return { kind: 'fingerprint', fp: fresh[1], ordinal: +fresh[2] };
    return old ? { kind: 'file', hash: old[1].toLowerCase(), row: +old[2] } : null;
  }
  /** the key of a party proposed new: 'party:<hash of its kind and normalised name>', so one party is proposed once however many lines name it and however often the file is loaded */
  function partyKeyOf(party) {
    var names = dep_('./bank-entry', 'CBBankEntry');
    return 'party:' + digest_((party.kind || '') + '|' + (names && names.nameKey ? names.nameKey(party.name) : descriptionKey_(party.name)));
  }

  /* ═══ project ═══════════════════════════════════════════════════════════════════════════════════════════════════ */
  /** the refusal answer: ok false, a code to branch on and the sentence in plain words */
  function refuse_(code, why, extra) {
    return Object.assign({ ok: false, code: code, why: why }, extra || {});
  }
  /** the currency check, before any line is read: the account's currency is the shop's (books.currency), the statement's is stated (books.statement.currency); null when they agree */
  function currencyRefusal_(books) {
    var account = books.currency,
      statement = books.statement && books.statement.currency;
    if (!account) return refuse_('account_currency_missing', 'The bank account has no currency, so nothing can be shown. Set the account currency first.');
    if (!statement) return refuse_('statement_currency_missing', 'The statement does not say which currency it is in. Say it before it is read; nothing is assumed.');
    if (statement !== account)
      return refuse_('currency_mismatch', 'This statement is in ' + statement + ' but the bank account is in ' + account + '. Nothing is converted in this version.', {
        statement_currency: statement,
        account_currency: account
      });
    return null;
  }
  /** the refusal when a ledger row or a proposal carries a currency other than the account's (or none): every amount carries its currency; null when all agree */
  function amountCurrencyRefusal_(books, proposals) {
    var wrong = function (item) {
      return item && item.currency !== books.currency;
    };
    var row = (books.ledger || []).filter(wrong)[0],
      at = proposals.findIndex(wrong);
    if (row) return refuse_('ledger_currency_mismatch', 'The bank ledger line "' + (row.narration || row.entry_no || 'no name') + '" is in ' + (row.currency || 'no currency') + ' but the bank account is in ' + books.currency + '. Nothing is converted in this version.');
    if (at >= 0) return refuse_('proposal_currency_mismatch', 'A proposal is in ' + (proposals[at].currency || 'no currency') + ' but the bank account is in ' + books.currency + '. Nothing is converted in this version.');
    return null;
  }
  /** the net the entry puts on the bank account, Dr positive (money in), read from the entry's lines; null when the entry has no bank line */
  function bankLegOf_(entry, bankAccount) {
    var legs = ((entry && entry.lines) || []).filter(function (item) {
      return item.account === bankAccount;
    });
    return legs.length
      ? legs.reduce(function (net, item) {
          return net + item.dr_minor - item.cr_minor;
        }, 0)
      : null;
  }
  /** what may make a proposal ready by itself (B5-01): a rule the person taught or a party the narration names. Anything else (the bank's own words) is a guess about the account and waits for the person's tick. */
  var READY_BASES_ = { taught: true, party: true };
  /**
   * why a proposal is not ready, as codes: nothing proposed · tax basis unsaid · tax invoice unanswered (B5-03) · entry not balanced · entry refused · entry's bank leg is not the line's amount
   * · needs_tick (only the words proposed it, B5-01) · may_be_in_books (an unmatched books entry has this amount and side nearby, B5-02: pair it or say it is new)
   */
  function blockersOf_(res, line, bankAccount, near) {
    var codes = [];
    if (!res || !res.entry) return ['no_entry'].concat(near && near.length ? ['may_be_in_books'] : []);
    if (res.needs) codes.push(String(res.needs));
    if (!res.entry.balanced) codes.push('unbalanced');
    if (res.refused) codes.push('refused');
    if (bankLegOf_(res.entry, bankAccount) !== signedOf_(line)) codes.push('bank_leg_mismatch');
    if (!READY_BASES_[res.basis] && !res.confirmed) codes.push('needs_tick');
    if (near && near.length) codes.push('may_be_in_books');
    return codes;
  }
  /** the state of one statement line: 'in_books' (no proposal was asked), 'proposed' (an entry is composed; `ready` says nothing blocks it) or 'needs_you' (no entry) */
  function lineView_(M, index, line, res, ctx, posted) {
    var amount = signedOf_(line);
    var view = {
      i: index,
      date: line.date || null,
      narration: line.narration || '',
      amount: M.makeMinor(Math.abs(amount), ctx.currency),
      side: amount < 0 ? 'out' : 'in',
      ref: ctx.refs[index],
      state: 'in_books',
      posted: !!posted,
      ready: false,
      blockers: []
    };
    if (!res) return view;
    var near = ctx.near[index] || [];
    var blockers = blockersOf_(res, line, ctx.bankAccount, near);
    view.near = near;
    view.basis = res.basis || null;
    view.confirmed = !!res.confirmed;
    view.rule = res.rule || null;
    view.why = res.why || null;
    view.entry = res.entry || null;
    view.tax = res.tax || null;
    view.party = res.party || null;
    view.what = res.what || null; /* l16-bank-rules: what the pack's words say the line is (transfer · tax_payment · card_settlement), carried so a screen can lead with it */
    view.blockers = blockers;
    view.state = res.entry ? 'proposed' : 'needs_you';
    view.ready = blockers.length === 0;
    return view;
  }
  /** the bank ledger after posting: the books' own bank lines and the ready proposals' bank legs, by date (existing first on a day), each with its running balance */
  function ledgerAfter_(M, books, views, ctx) {
    var rows = (books.ledger || []).map(function (item, at) {
      return { at: at, rank: 0, date: item.date || '', net: (+item.dr_minor || 0) - (+item.cr_minor || 0), narration: item.narration || '', state: 'existing', entry_no: item.entry_no || null };
    });
    views.forEach(function (view) {
      if (!view.ready) return;
      rows.push({ at: view.i, rank: 1, date: view.date || '', net: bankLegOf_(view.entry, ctx.bankAccount), narration: view.narration, state: 'proposed', i: view.i, ref: view.ref });
    });
    rows.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : a.rank - b.rank || a.at - b.at;
    });
    var running = books.opening_minor;
    return rows.map(function (row) {
      running += row.net;
      var out = { date: row.date, narration: row.narration, state: row.state, dr: M.makeMinor(Math.max(row.net, 0), ctx.currency), cr: M.makeMinor(Math.max(-row.net, 0), ctx.currency), balance: M.makeMinor(running, ctx.currency) };
      if (row.state === 'proposed') {
        out.i = row.i;
        out.ref = row.ref;
      } else out.entry_no = row.entry_no;
      return out;
    });
  }
  /** the parties the lines propose NEW, once each (by party key), with the lines that name them; near names ride along as did_you_mean so a screen asks first */
  function partiesToCreate_(views) {
    var byKey = {},
      list = [];
    views.forEach(function (view) {
      if (!view.party || view.party.status !== 'new') return;
      var key = partyKeyOf(view.party);
      if (!byKey[key]) {
        byKey[key] = { key: key, name: view.party.name, kind: view.party.kind, basis: view.party.basis, did_you_mean: view.party.did_you_mean, lines: [] };
        list.push(byKey[key]);
      }
      byKey[key].lines.push(view.i);
    });
    return list;
  }
  /** the headline figures as money values: books closing before and after, the statement's closing, the difference before and after (statement − books) */
  function figuresOf_(M, books, views, ctx) {
    var booksBefore = (books.ledger || []).reduce(function (net, item) {
      return net + (+item.dr_minor || 0) - (+item.cr_minor || 0);
    }, books.opening_minor);
    var readyNet = views
      .filter(function (view) {
        return view.ready;
      })
      .reduce(function (net, view) {
        return net + bankLegOf_(view.entry, ctx.bankAccount);
      }, 0);
    var statementOpening = books.statement.opening_minor != null ? books.statement.opening_minor : books.opening_minor;
    var statementClosing = views.reduce(function (net, view) {
      return net + (view.side === 'in' ? 1 : -1) * view.amount.amount_minor;
    }, statementOpening);
    var money = function (minor) {
      return M.makeMinor(minor, ctx.currency);
    };
    var closingBefore = money(booksBefore),
      closingAfter = money(booksBefore + readyNet),
      closingStatement = money(statementClosing);
    return {
      opening: money(books.opening_minor),
      statement_opening: money(statementOpening),
      closing_statement: closingStatement,
      closing_books_before: closingBefore,
      closing_books_after: closingAfter,
      difference_before: M.minusMoney(closingStatement, closingBefore),
      difference_after: M.minusMoney(closingStatement, closingAfter),
      stated_closing_mismatch: books.statement.closing_minor != null && books.statement.closing_minor !== statementClosing ? money(books.statement.closing_minor) : null
    };
  }
  /**
   * B5-06: "tied" says the books agree with the bank, so it is false while ANY statement row was skipped (the computed closing leaves it out) and while the closing the bank PRINTED is not the
   * closing the lines add up to (stated_closing_mismatch). Both are carried facts, compared, not worked out again.
   */
  function tiedOf_(M, figures, skipped) {
    return M.compareMoney(figures.closing_statement, figures.closing_books_after) === 0 && !skipped.length && !figures.stated_closing_mismatch;
  }
  /** the totals of what is ready to post: money in, money out, and the tax inside them (carried from each proposal's own tax record, never re-divided) */
  function totalsOf_(M, views, ctx) {
    var ready = views.filter(function (view) {
      return view.ready;
    });
    var addUp = function (list, pick) {
      return M.makeMinor(
        list.reduce(function (sum, view) {
          return sum + pick(view);
        }, 0),
        ctx.currency
      );
    };
    var dates = ready
      .map(function (view) {
        return view.date;
      })
      .sort();
    return {
      entries: ready.length,
      in: addUp(ready, function (view) {
        return view.side === 'in' ? view.amount.amount_minor : 0;
      }),
      out: addUp(ready, function (view) {
        return view.side === 'out' ? view.amount.amount_minor : 0;
      }),
      tax: addUp(ready, function (view) {
        return (view.tax && view.tax.tax_minor) || 0;
      }),
      from: dates[0] || null,
      to: dates[dates.length - 1] || null
    };
  }
  /** the counts a confirm popup and a header read: lines, in the books, proposed, ready to post, needing the person */
  function countsOf_(views) {
    var count = function (test) {
      return views.filter(test).length;
    };
    return {
      lines: views.length,
      in_books: count(function (view) {
        return view.state === 'in_books';
      }),
      proposed: count(function (view) {
        return view.state === 'proposed';
      }),
      ready: count(function (view) {
        return view.ready;
      }),
      needs_you: count(function (view) {
        return view.state === 'needs_you' || (view.state === 'proposed' && !view.ready);
      })
    };
  }
  /** the statement lines still open: the BRS's list of what the books lack (proposed but not ready, or no entry) */
  function openLines_(views) {
    return views
      .filter(function (view) {
        return view.state !== 'in_books' && !view.ready;
      })
      .map(function (view) {
        return { i: view.i, date: view.date, narration: view.narration, amount: view.amount, side: view.side, blockers: view.blockers };
      });
  }
  /**
   * ⭐ project(lines, proposals, books) → the preview, or a refusal { ok: false, code, why } (ledger_currency_mismatch · proposal_currency_mismatch · currency_mismatch · statement_currency_missing · account_currency_missing · no_money_engine)
   *   lines      the statement lines, bank-recon.parse().lines { date, narration, debit_minor, credit_minor, … }
   *   proposals  an array PARALLEL to lines: null / undefined = the line is already in the books (match() found it); an object = bank-recon.suggest(line, …) for it
   *   books      { currency, opening_minor, ledger: [{ date, dr_minor, cr_minor, narration?, entry_no? }], statement: { currency, opening_minor?, closing_minor? }, account?, bank_account? ('bank') }
   *              opening_minor = the books' bank balance before the statement's first day. ledger = the bank account's journal lines in the period (what match() ran against).
   *              near = { <line index>: [books entries] } from bank-recon.nearMatches (B5-02: a line that may already be in the books is never ready); statement.skipped = parse().skipped (B5-06: never "tied").
   * → { ok, currency, account, lines: [view], ledger: [row], brs: {…}, totals, counts, parties_to_create: [party], mismatches: [] }
   * Nothing is saved and nothing is posted: "Preview: not yet in your books".
   */
  function project(lines, proposals, books) {
    var M = dep_('./money', 'CBMoney');
    if (!M || !M.makeMinor) return refuse_('no_money_engine', 'The money engine is not loaded, so no amount can carry its currency.');
    var given = Object.assign({}, books);
    given.statement = given.statement || {};
    var refusal = currencyRefusal_(given);
    if (refusal) return refusal;
    refusal = amountCurrencyRefusal_(given, (proposals || []).filter(function (item) {
      return item && item.entry;
    }));
    if (refusal) return refusal;
    var refs = refsOf(lines, given.account, given.period_lines),
      posted = postedFlags(lines, refs, given.posted_refs, given.file);
    var ctx = { currency: given.currency, bankAccount: given.bank_account || 'bank', refs: refs, near: given.near || {} };
    var views = (lines || []).map(function (line, at) {
      return lineView_(M, at, line, posted[at] ? null : (proposals || [])[at], ctx, posted[at]);
    });
    var figures = figuresOf_(M, given, views, ctx),
      skipped = given.statement.skipped || [];
    return {
      ok: true,
      currency: ctx.currency,
      account: given.account || null,
      lines: views,
      ledger: ledgerAfter_(M, given, views, ctx),
      brs: Object.assign({ tied: tiedOf_(M, figures, skipped), skipped: skipped, open_lines: openLines_(views) }, figures),
      totals: totalsOf_(M, views, ctx),
      counts: countsOf_(views),
      parties_to_create: partiesToCreate_(views),
      mismatches: views
        .filter(function (view) {
          return view.blockers.indexOf('bank_leg_mismatch') >= 0;
        })
        .map(function (view) {
          return { i: view.i, why: "the entry's bank amount is not the statement line's amount" };
        })
    };
  }

  var EXPORTS = { project: project, refsOf: refsOf, postedFlags: postedFlags, fingerprintOf: fingerprintOf, readRef: readRef, partyKeyOf: partyKeyOf, currencyRefusal: currencyRefusal_ };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBBankProject. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBBankProject = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
