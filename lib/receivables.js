/* ADOPTED from chitbridge-engines v1.78.0 · receivables · sha256 180e6f8728f4e88c0a8a6fbac647fceb40c3c6174b12faf184fef98bf75b862d — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · receivables. Edited ONLY in chitbridge-engines/src/receivables.js; every platform adopts a released version of it. */
/*
 * OWNS      which bills a party owes and what reduced them: party-item rows, the proposal, the check, reversals and their releases.
 * CALLED BY the api (lib/books.js itemsOf* · confirmItems · reverseItems · reopenedBy; lib/books-engines.js netOpen), the web's finance screens.
 * FLOW      rows ──▶ outstanding / fromItems ──▶ propose → owner confirms → confirmItems rows · reverseItems rows (FIN-64: a bill releases its allocations)
 * CARD      16-finance/payments
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note [CREDIT P1] What a party owes and what reduced it: due dates, the oldest-due-first PROPOSAL, the check of
  // @stage-note what the supplier confirmed, bounce reversal, balances, ageing, statements, metrics, and the C6 options.
  // @stage-note No storage, no clock: every date is an argument. tests/receivables.test.js runs every branch.
  /**
   * receivables.js — WHAT A PARTY OWES, AND WHAT CLEARED IT (v1.7.0, 2026-09-28; party items v1.8.0; hardened v1.8.1 2026-09-30). [SPEC-credit-lifecycle.md §4, §11]
   *
   * Athi: *"the payment won't exactly tie to the bills — they pay through cheque or cash or any other mode … the details
   * have to be matched against the bill, and the remaining should carry on to the next one."* Decided the same day (§11):
   *   D1  the rule (oldest DUE first) only PROPOSES — the supplier confirms or changes it; "if they change it, it is their wish".
   *   C4  each party records its own facts; "if there are dispute the payment cannot be adjust against" — REFUSED here, not warned.
   *   C3  a cheque counts on CLEARING, never on receipt.
   *   D2  a debit need not be a sale: sale · credit_given · opening_balance · debit_note — this engine does not care which.
   *
   * ── THE SHAPES ─────────────────────────────────────────────────────────────────────────────────────────────────
   *   debit       { id, kind, party, date:'YYYY-MM-DD', amount, currency, credit_days?, due?, disputed? }
   *   credit      { id, kind: payment|return|credit_note|write_off, party, date, amount, currency, mode?,
   *                 cheque?: { no, bank, date, status: received|deposited|cleared|bounced, cleared_on? }, disputed?, void? }
   *   allocation  { id?, credit, debit, amount, on?:'YYYY-MM-DD', reverses? }   — APPEND-ONLY: a correction is a reversal
   *               row ({ reverses: <allocation id>, amount }), never an edit. A reversed allocation is not live.
   *
   * ⚠️⚠️ EXACT TO THE MINOR UNIT: every sum is done in the currency's MINOR UNITS (integers) — decimals from money.decimals —
   * and only turned back into an amount at the edge. Currencies are never mixed: a mixed set is refused, never converted.
   * ⚠️ NO CLOCK. "Today" is always `asOf`, passed in. A receivable aged by the machine's clock would age differently on
   * the counter, the server and a statement printed tomorrow.
   *
   * ── v1.8.0 (2026-09-29): PARTY ITEMS — ROWS, NEVER UPDATES ── [SPEC-books-v2.md §0, §3; ERPNext Payment Ledger Entry]
   *   party_item  { party, side: receivable|payable, ref_kind: bill|advance|on_account|allocation|reversal|status,
   *                 ref, against_ref, amount_minor (SIGNED integer), currency, date, due_date? (bills), status?, reverses?,
   *                 kind? (the source kind: sale, credit_given, payment, return …) }
   *   ⭐ outstanding of a document = Σ amount_minor of the rows whose against_ref is that document. A bill is +amount
   *   against itself; a payment is −amount against ITSELF (an advance sitting on account); an allocation moves it: −a
   *   against the bill, +a against the payment. A bounce is a REVERSAL row per row of that payment. A dispute or a cheque
   *   step is a STATUS row (amount 0) — the latest one wins, and a disputed document is frozen (C4).
   *   The v1.7.0 shapes stay: fromItems(items) turns rows back into { debits, credits, allocations } so propose() and
   *   check() run unchanged — propose → the owner confirms → confirmItems() emits the rows (D1).
   *
   * ── v1.8.1 (the critic's review, 2026-09-29): A STORED ROW IS DISTRUSTED ──
   *   H3   reverseItems() needs `item_id` (the row's own id, which the database assigns) on every money row it reverses —
   *        refused by name without it. Identity is NEVER the row's position in an array: the same rows fetched in another
   *        order, or per document, reversed the same money again.
   *   M5   outstanding() — and so fromItems / proposeItems / confirmItems — refuses, naming the row: an allocation whose
   *        halves do not pair off (Σ of a payment's allocation rows ≠ 0), a half with the wrong sign, a half stamped with a
   *        party other than its documents'. ⚠️ So outstanding() takes a party's WHOLE item set, never one document's rows.
   *   M6   a dispute on an uncleared cheque is its own status row and survives clearing (dispute rows and cheque-step rows
   *        are read apart: by_ref[].disputed, by_ref[].status).
   *   M10  itemsOfBill / itemsOfPayment read `amount` the way posting does: finite, a plain number, under 10^15 minor units.
   *   L4   every map keyed by a stored id has no prototype; a cheque step is looked up by OWN key.
   */

  /* the engines this one leans on, found wherever this copy runs — CBMoney / CBRegulation on a page, ./money and ./regulation in node
   * (looked up per call: load order is free; a failed require is remembered as `false` so it is tried once) */
  var moneyCache_ = null,
    regulationCache_ = null;
  /** the regulation engine, or null when this host has none */
  function regulationEngine_() {
    var engine = typeof CBRegulation !== 'undefined' && CBRegulation.resolve ? CBRegulation : regulationCache_;
    if (engine === null && typeof require === 'function') {
      try {
        engine = regulationCache_ = require('./regulation');
      } catch (_) {
        engine = regulationCache_ = false;
      }
    }
    return engine || null;
  }
  /** the pack a call means: opt.pack, else the registry's for opt.country (a currency a document does not name is the pack's — pack.currency) */
  function pack_(opt) {
    var engine = regulationEngine_();
    if (!engine) throw new Error('Receivables needs the regulation engine to name a currency a document leaves out.');
    return (opt && opt.pack) || engine.resolve(opt);
  }
  /** the currency a document that names none is in: the pack's */
  function defaultCurrency_(opt) {
    return pack_(opt).currency;
  }
  /** the money engine, or null when this host has none */
  function moneyEngine_() {
    var engine = typeof CBMoney !== 'undefined' && CBMoney.round ? CBMoney : moneyCache_;
    if (engine === null && typeof require === 'function') {
      try {
        engine = moneyCache_ = require('./money');
      } catch (_) {
        engine = moneyCache_ = false;
      }
    }
    return engine || null;
  }
  /** decimal places of a currency (2 when there is no money engine) */
  function decimals_(currency) {
    var engine = moneyEngine_();
    return engine && engine.decimals ? engine.decimals(currency) : 2;
  }
  /** an amount in minor units (an integer) */
  function toMinor(amount, currency) {
    var scale = Math.pow(10, decimals_(currency));
    return Math.round(Number((Number(amount) * scale).toPrecision(15)));
  }
  /** minor units back to an amount, only at the edge */
  function fromMinor(minor, currency) {
    var scale = Math.pow(10, decimals_(currency));
    return Number((minor / scale).toFixed(decimals_(currency)));
  }

  const DEBIT_KINDS = ['sale', 'credit_given', 'opening_balance', 'debit_note'];
  const CREDIT_KINDS = ['payment', 'return', 'credit_note', 'write_off'];
  const CHEQUE_NEXT = { received: ['deposited'], deposited: ['cleared', 'bounced'], cleared: [], bounced: [] };
  /** own keys only: a stored status of "constructor" is not a cheque step (it was an inherited function — a TypeError) */
  function nextChequeSteps_(status) {
    return Object.prototype.hasOwnProperty.call(CHEQUE_NEXT, status) ? CHEQUE_NEXT[status] : null;
  }

  /* ── dates: 'YYYY-MM-DD' ↔ a day number (no clock, no time zone) ── */
  /** 'YYYY-MM-DD' → whole days since 1970-01-01, or null when it is not that shape */
  function dayNumber(text) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
    if (!parts) return null;
    return Math.round(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]) / 86400000);
  }
  /** a day number back to 'YYYY-MM-DD' */
  function dayText(number) {
    return new Date(number * 86400000).toISOString().slice(0, 10);
  }

  /** the distinct upper-cased currencies the rows name, in the order a plain object lists them */
  function currenciesOf_(rows) {
    var seen = {};
    (rows || []).forEach(function (item) {
      if (item && item.currency) seen[String(item.currency).toUpperCase()] = 1;
    });
    return Object.keys(seen);
  }
  /** the 409 for a set of rows in more than one currency */
  function mixedCurrencyError_(where, currencies) {
    var error = new Error(
      'Cannot mix currencies in ' +
        (where || 'one account') +
        ': ' +
        currencies.join(' + ') +
        '. An amount is labelled, never converted — keep one account per currency.'
    );
    error.status = 409;
    error.currencies = currencies;
    return error;
  }
  /** refuse unless every row is in ONE currency — the currency, or throws a 409 naming them */
  function oneCurrency(rows, where) {
    var currencies = currenciesOf_(rows);
    if (currencies.length > 1) throw mixedCurrencyError_(where, currencies);
    return currencies[0] || null;
  }

  /** the last day of the month a 'YYYY-MM-DD' falls in, as a day number (day 0 of the next month, so a leap February ends on the 29th) */
  function monthEnd_(text) {
    var parts = /^(\d{4})-(\d{2})/.exec(String(text || ''));
    return Math.round(Date.UTC(+parts[1], +parts[2], 0) / 86400000);
  }
  /** FIN-35: the day credit days are counted FROM — the bill's own date, or ('eom') the last day of its month; the debit's own word wins over the terms' */
  function creditBase_(bill, terms) {
    var from = bill.credit_from != null ? bill.credit_from : terms && terms.credit_from;
    return String(from || '').toLowerCase() === 'eom' ? monthEnd_(bill.date) : dayNumber(bill.date);
  }
  /** the credit days a bill carries: its own, else the terms', else 0 */
  function creditDaysOf_(bill, terms) {
    if (bill.credit_days != null) return Number(bill.credit_days);
    return terms && terms.credit_days != null ? Number(terms.credit_days) : 0;
  }
  /**
   * ⭐ dueDate(debit, terms) → 'YYYY-MM-DD': its own due date, else its date + its credit days, else + the terms' days.
   * FIN-35: credit_from 'eom' (on the debit or the terms; absent = the bill date) counts the days from the END of the bill's month — "30 days EOM".
   */
  function dueDate(debit, terms) {
    var bill = debit || {};
    if (bill.due && dayNumber(bill.due) !== null) return bill.due;
    if (dayNumber(bill.date) === null) return null;
    var days = creditDaysOf_(bill, terms);
    return dayText(creditBase_(bill, terms) + Math.max(0, Math.floor(days || 0)));
  }

  /** the allocations that still count: not a reversal row, and not reversed by one */
  function live(allocations) {
    var reversed = Object.create(null);
    (allocations || []).forEach(function (item) {
      if (item && item.reverses != null) reversed[item.reverses] = 1;
    });
    return (allocations || []).filter(function (item) {
      return item && item.reverses == null && !(item.id != null && reversed[item.id]);
    });
  }

  /** the cheque's words when it stops a credit being used, or null */
  function chequeBlock_(cheque) {
    var status = cheque.status || 'received';
    if (status === 'bounced') return 'Cheque ' + (cheque.no || '') + ' bounced — it pays nothing.';
    if (status !== 'cleared') return 'Cheque ' + (cheque.no || '') + ' is ' + status + ', not cleared — it is applied on clearing.';
    return null;
  }
  /**
   * ⭐ usable(credit) → { ok, why }: may this credit reduce what is owed? A disputed or voided credit may not (C4); a
   * cheque only once CLEARED (C3). "Received, not cleared" is said in words, because it is the question a collector asks.
   */
  function usable(credit) {
    var entry = credit || {};
    if (entry.void) return { ok: false, why: 'This entry was voided.' };
    if (entry.disputed) return { ok: false, why: 'This payment is in dispute — it cannot be applied to any bill until the dispute is settled.' };
    var blocked = entry.cheque ? chequeBlock_(entry.cheque) : null;
    return blocked ? { ok: false, why: blocked } : { ok: true };
  }

  /**
   * ⭐ cheque(credit, to, on) → { ok, credit, why }: one step in a cheque's life, received → deposited → cleared | bounced.
   * Returns a NEW credit; the old one is untouched. A step out of order is refused with the order it must follow.
   */
  function cheque(credit, to, on) {
    var entry = credit || {};
    if (!entry.cheque) return { ok: false, why: 'This payment is not a cheque.' };
    var from = entry.cheque.status || 'received';
    if ((nextChequeSteps_(from) || []).indexOf(to) < 0)
      return { ok: false, why: 'A cheque that is ' + from + ' cannot become ' + to + '. The order is received → deposited → cleared or bounced.' };
    var stepped = Object.assign({}, entry.cheque, { status: to });
    if (to === 'cleared') stepped.cleared_on = on || null;
    if (to === 'bounced') stepped.bounced_on = on || null;
    return { ok: true, credit: Object.assign({}, entry, { cheque: stepped }) };
  }

  /** the minor units applied so far, per debit and per credit, from the live allocations */
  function appliedTotals_(allocations, currency) {
    var perDebit = Object.create(null),
      perCredit = Object.create(null);
    live(allocations).forEach(function (item) {
      var minor = toMinor(item.amount, currency);
      perDebit[item.debit] = (perDebit[item.debit] || 0) + minor;
      perCredit[item.credit] = (perCredit[item.credit] || 0) + minor;
    });
    return { debit: perDebit, credit: perCredit };
  }
  /** one debit's row in balances(): amount, applied, what is left, state, overdue */
  function debitBalance_(item, applied, currency, today) {
    var amount = toMinor(item.amount, currency),
      allocated = applied[item.id] || 0,
      balance = amount - allocated,
      dueOn = dueDate(item);
    return {
      id: item.id,
      kind: item.kind,
      party: item.party,
      date: item.date,
      due: dueOn,
      amount: fromMinor(amount, currency),
      allocated: fromMinor(allocated, currency),
      balance: fromMinor(balance, currency),
      state: balance <= 0 ? 'paid' : allocated > 0 ? 'part-paid' : 'open',
      disputed: !!item.disputed,
      overdue: today !== null && balance > 0 && dayNumber(dueOn) < today
    };
  }
  /** one credit's row in balances(): amount, applied, what is still on account, whether it may be used */
  function creditBalance_(item, applied, currency) {
    var amount = toMinor(item.amount, currency),
      used = applied[item.id] || 0,
      usability = usable(item);
    return {
      id: item.id,
      kind: item.kind,
      party: item.party,
      date: item.date,
      amount: fromMinor(amount, currency),
      allocated: fromMinor(used, currency),
      unapplied: fromMinor(usability.ok ? amount - used : 0, currency),
      usable: usability.ok,
      why: usability.why || ''
    };
  }
  /**
   * ⭐ balances(debits, credits, allocations, asOf?) → per debit and per credit, in amounts:
   *   debits[]  { id, amount, allocated, balance, due, state: open | part-paid | paid, overdue }
   *   credits[] { id, amount, allocated, unapplied (On Account), usable, why }
   * `overdue` only when asOf is given (never the machine's today).
   */
  function balances(debits, credits, allocations, asOf) {
    var currency = oneCurrency([].concat(debits || [], credits || []), 'one account');
    var today = asOf ? dayNumber(asOf) : null;
    var applied = appliedTotals_(allocations, currency);
    var debitRows = (debits || []).map(function (item) {
      return debitBalance_(item, applied.debit, currency, today);
    });
    var creditRows = (credits || []).map(function (item) {
      return creditBalance_(item, applied.credit, currency);
    });
    return { currency: currency, debits: debitRows, credits: creditRows };
  }

  /** the open, undisputed debits of the credit's party (oldest due first, or in the order `against` names), and the disputed ones skipped */
  function debitsToApply_(openBalances, credit, against, currency) {
    var open = openBalances.filter(function (item) {
      return item.party === credit.party && toMinor(item.balance, currency) > 0;
    });
    var skipped = open
      .filter(function (item) {
        return item.disputed;
      })
      .map(function (item) {
        return { debit: item.id, why: 'In dispute — nothing is applied to it until the dispute is settled.' };
      });
    open = open.filter(function (item) {
      return !item.disputed;
    });
    if (against && against.length) {
      open = against
        .map(function (id) {
          return open.find(function (item) {
            return item.id === id;
          });
        })
        .filter(Boolean);
    } else {
      open.sort(function (first, second) {
        return (
          dayNumber(first.due) - dayNumber(second.due) || dayNumber(first.date) - dayNumber(second.date) || String(first.id).localeCompare(String(second.id))
        );
      });
    }
    return { open: open, skipped: skipped };
  }
  /** pour `left` minor units over the debits in order; each takes what it still owes. → { rows, left } */
  function pourOver_(open, creditId, left, currency) {
    var rows = [];
    open.forEach(function (item) {
      if (left <= 0) return;
      var take = Math.min(left, toMinor(item.balance, currency));
      if (take > 0) {
        rows.push({ credit: creditId, debit: item.id, amount: fromMinor(take, currency) });
        left -= take;
      }
    });
    return { rows: rows, left: left };
  }
  /**
   * ⭐⭐ propose(debits, credit, ctx) → { ok, allocations, on_account, skipped, why } — the SUGGESTION, and nothing more.
   *   ctx: { credits, allocations, against?: [debit ids] }
   * Oldest DUE first (ties: the older bill, then the id); or only the named debits, in that order, when `against` is given.
   * Disputed debits are SKIPPED and listed with the reason. It changes nothing: what is written is what the supplier confirms,
   * checked by check(). [§11 D1]
   */
  function propose(debits, credit, ctx) {
    var entry = credit || {},
      context = ctx || {};
    var usability = usable(entry);
    if (!usability.ok) return { ok: false, why: usability.why, allocations: [], on_account: 0, skipped: [] };
    var credits = [].concat(context.credits || []);
    if (
      !credits.some(function (item) {
        return item.id === entry.id;
      })
    )
      credits.push(entry);
    var currency;
    try {
      currency = oneCurrency([].concat(debits || [], credits), 'this payment and these bills');
    } catch (e) {
      return { ok: false, why: e.message, allocations: [], on_account: 0, skipped: [] };
    }
    var balance = balances(debits, credits, context.allocations);
    var mine = balance.credits.find(function (item) {
      return item.id === entry.id;
    });
    var chosen = debitsToApply_(balance.debits, entry, context.against, currency);
    var poured = pourOver_(chosen.open, entry.id, toMinor(mine ? mine.unapplied : 0, currency), currency);
    return { ok: true, allocations: poured.rows, on_account: fromMinor(poured.left, currency), skipped: chosen.skipped, currency: currency };
  }

  /** the minor units each debit still owes and each credit still has, from balances() */
  function remainingMinor_(balance, currency) {
    var debit = Object.create(null),
      credit = Object.create(null);
    balance.debits.forEach(function (item) {
      debit[item.id] = toMinor(item.balance, currency);
    });
    balance.credits.forEach(function (item) {
      credit[item.id] = toMinor(item.unapplied, currency);
    });
    return { debit: debit, credit: credit };
  }
  /** the debits and the credits each looked up by id, no prototype */
  function knownById_(debits, credits) {
    var debit = Object.create(null),
      credit = Object.create(null);
    (debits || []).forEach(function (item) {
      debit[item.id] = item;
    });
    (credits || []).forEach(function (item) {
      credit[item.id] = item;
    });
    return { debit: debit, credit: credit };
  }
  /** why one confirmed allocation is refused (numbered), or null when it stands. `known` = { debit, credit } by id; `left` = remainingMinor_ */
  function confirmedProblem_(item, number, known, left, currency) {
    var label = '#' + number + ' ';
    var bill = known.debit[item.debit],
      payment = known.credit[item.credit],
      minor = toMinor(item.amount, currency);
    if (!(minor > 0)) return label + 'the amount must be more than zero.';
    if (!bill) return label + 'there is no bill ' + item.debit + '.';
    if (!payment) return label + 'there is no payment ' + item.credit + '.';
    if (bill.party !== payment.party) return label + 'the payment and the bill belong to different parties.';
    if (bill.disputed) return label + 'bill ' + bill.id + ' is in dispute — nothing can be applied to it.';
    var usability = usable(payment);
    if (!usability.ok) return label + usability.why;
    if (minor > left.credit[payment.id])
      return label + 'payment ' + payment.id + ' has only ' + fromMinor(Math.max(0, left.credit[payment.id]), currency) + ' left to apply.';
    if (minor > left.debit[bill.id]) return label + 'bill ' + bill.id + ' only owes ' + fromMinor(Math.max(0, left.debit[bill.id]), currency) + '.';
    left.credit[payment.id] -= minor;
    left.debit[bill.id] -= minor;
    return null;
  }
  /**
   * ⭐⭐⭐ check(confirmed, debits, credits, allocations) → { ok, problems[], why } — what the supplier CONFIRMED, before
   * it is written. Refuses (does not warn):
   *   · an amount that is not positive · a debit or credit that does not exist · two parties in one allocation
   *   · a disputed payment or a disputed debit (C4) · a payment that cannot be applied (an uncleared cheque, C3)
   *   · more than a payment has left · more than a debit still owes · two currencies
   */
  function check(confirmed, debits, credits, allocations) {
    var problems = [];
    var currency;
    try {
      currency = oneCurrency([].concat(debits || [], credits || []), 'these bills and payments');
    } catch (e) {
      return { ok: false, problems: [e.message], why: e.message };
    }
    var known = knownById_(debits, credits);
    var left = remainingMinor_(balances(debits, credits, allocations), currency);
    (confirmed || []).forEach(function (item, index) {
      var problem = confirmedProblem_(item, index + 1, known, left, currency);
      if (problem !== null) problems.push(problem);
    });
    return { ok: problems.length === 0, problems: problems, why: problems[0] || '' };
  }

  /**
   * ⭐ reverse(allocations, creditId, on) → { rows, reopened } — a bounced or withdrawn payment. Append-only: one reversal
   * row per live allocation of that credit ({ reverses, credit, debit, amount, on }), and the bills it reopens.
   */
  function reverse(allocations, creditId, on) {
    var rows = live(allocations)
      .filter(function (item) {
        return item.credit === creditId;
      })
      .map(function (item) {
        return { reverses: item.id, credit: item.credit, debit: item.debit, amount: item.amount, on: on || null };
      });
    var reopened = Object.create(null);
    rows.forEach(function (item) {
      reopened[item.debit] = 1;
    });
    return { rows: rows, reopened: Object.keys(reopened) };
  }

  const BUCKETS = [
    ['not_due', null, 0],
    ['d1_30', 1, 30],
    ['d31_60', 31, 60],
    ['d61_90', 61, 90],
    ['d90_plus', 91, null]
  ];
  /** a fresh set of ageing buckets, every one at 0 */
  function emptyBuckets_() {
    var buckets = {};
    BUCKETS.forEach(function (bucket) {
      buckets[bucket[0]] = 0;
    });
    return buckets;
  }
  /** the bucket a bill that is `lateDays` past due falls in */
  function bucketOf_(lateDays) {
    var name = 'not_due';
    BUCKETS.forEach(function (bucket) {
      if (bucket[1] !== null && lateDays >= bucket[1] && (bucket[2] === null || lateDays <= bucket[2])) name = bucket[0];
    });
    return name;
  }
  /** buckets in minor units → buckets as amounts */
  function bucketAmounts_(minorByBucket, currency) {
    var amounts = {};
    Object.keys(minorByBucket).forEach(function (name) {
      amounts[name] = fromMinor(minorByBucket[name], currency);
    });
    return amounts;
  }
  /**
   * ⭐ ageing(debits, credits, allocations, asOf) → { currency, total, buckets, by_party } — what is owed, by how long it
   * has been OVERDUE on asOf: not due · 1–30 · 31–60 · 61–90 · 90+ days. Balances after live allocations.
   */
  function ageing(debits, credits, allocations, asOf) {
    var today = dayNumber(asOf);
    if (today === null) throw new Error("ageing needs asOf as YYYY-MM-DD — never the machine's today.");
    var balance = balances(debits, credits, allocations, asOf),
      currency = balance.currency;
    var totals = emptyBuckets_(),
      perParty = Object.create(null),
      owed = 0;
    balance.debits.forEach(function (item) {
      var minor = toMinor(item.balance, currency);
      if (minor <= 0) return;
      var bucket = bucketOf_(today - dayNumber(item.due));
      totals[bucket] += minor;
      owed += minor;
      perParty[item.party] = perParty[item.party] || emptyBuckets_();
      perParty[item.party][bucket] += minor;
    });
    var parties = Object.create(null);
    Object.keys(perParty).forEach(function (party) {
      parties[party] = bucketAmounts_(perParty[party], currency);
    });
    return { currency: currency, as_of: asOf, total: fromMinor(owed, currency), buckets: bucketAmounts_(totals, currency), by_party: parties };
  }

  /** a party's debits and USABLE-or-not credits as dated rows (dr / cr in minor units), in statement order */
  function statementRows_(partyDebits, partyCredits, currency) {
    return partyDebits
      .map(function (item) {
        return { date: item.date, kind: item.kind, ref: item.id, dr: toMinor(item.amount, currency), cr: 0, counts: true };
      })
      .concat(
        partyCredits.map(function (item) {
          var usability = usable(item);
          return { date: item.date, kind: item.kind, ref: item.id, dr: 0, cr: toMinor(item.amount, currency), counts: usability.ok, why: usability.why || '' };
        })
      )
      .sort(function (first, second) {
        return dayNumber(first.date) - dayNumber(second.date) || second.dr - first.dr || String(first.ref).localeCompare(String(second.ref));
      });
  }
  /** what was owed before `fromDay`: the counted rows dated earlier */
  function openingBalance_(rows, fromDay) {
    var opening = 0;
    rows.forEach(function (item) {
      if (fromDay !== null && dayNumber(item.date) < fromDay && item.counts) opening += item.dr - item.cr;
    });
    return opening;
  }
  /** one statement line, with the running balance after it */
  function statementLine_(item, running, currency) {
    return {
      date: item.date,
      kind: item.kind,
      ref: item.ref,
      debit: fromMinor(item.dr, currency),
      credit: fromMinor(item.cr, currency),
      counted: item.counts,
      why: item.why || '',
      balance: fromMinor(running, currency)
    };
  }
  /**
   * ⭐ statement(party, debits, credits, from, to) → { opening, lines, closing } — what the party owed at `from`, every debit
   * and every USABLE credit in date order with a running balance, and what they owe at `to`. An uncleared or disputed credit
   * is LISTED (with why) but does not reduce the balance — the statement says what it is, not what it hopes.
   */
  function statement(party, debits, credits, from, to) {
    var partyDebits = (debits || []).filter(function (item) {
      return item.party === party;
    });
    var partyCredits = (credits || []).filter(function (item) {
      return item.party === party;
    });
    var currency = oneCurrency([].concat(partyDebits, partyCredits), 'one statement');
    var fromDay = dayNumber(from),
      toDay = dayNumber(to);
    var rows = statementRows_(partyDebits, partyCredits, currency);
    var opening = openingBalance_(rows, fromDay),
      lines = [];
    var running = opening;
    rows.forEach(function (item) {
      var rowDay = dayNumber(item.date);
      if ((fromDay !== null && rowDay < fromDay) || (toDay !== null && rowDay > toDay)) return;
      if (item.counts) running += item.dr - item.cr;
      lines.push(statementLine_(item, running, currency));
    });
    return { party: party, currency: currency, from: from, to: to, opening: fromMinor(opening, currency), lines: lines, closing: fromMinor(running, currency) };
  }

  /** what is owed, and how much of it is overdue, in minor units */
  function owedAndOverdue_(debitRows, currency) {
    var owed = 0,
      overdue = 0;
    debitRows.forEach(function (item) {
      var minor = toMinor(item.balance, currency);
      if (minor > 0) {
        owed += minor;
        if (item.overdue) overdue += minor;
      }
    });
    return { owed: owed, overdue: overdue };
  }
  /** the minor units of the debits dated inside the `span` days up to and including `today` */
  function raisedInWindow_(debits, today, span, currency) {
    var raised = 0;
    (debits || []).forEach(function (item) {
      var itemDay = dayNumber(item.date);
      if (itemDay !== null && itemDay > today - span && itemDay <= today) raised += toMinor(item.amount, currency);
    });
    return raised;
  }
  /** per debit, the day of its latest live allocation */
  function lastPaymentDays_(allocations) {
    var last = Object.create(null);
    live(allocations).forEach(function (item) {
      var paidDay = dayNumber(item.on);
      if (paidDay !== null && (last[item.debit] == null || paidDay > last[item.debit])) last[item.debit] = paidDay;
    });
    return last;
  }
  /** { avg (days from bill to last payment), onTime (percent paid by the due day) } over the fully paid debits, or nulls when none */
  function payingHabits_(debitRows, lastPaid) {
    var paid = debitRows.filter(function (item) {
      return item.state === 'paid' && lastPaid[item.id] != null;
    });
    if (!paid.length) return { avg: null, onTime: null };
    var averageDays =
      paid.reduce(function (total, item) {
        return total + (lastPaid[item.id] - dayNumber(item.date));
      }, 0) / paid.length;
    var onTime =
      (paid.filter(function (item) {
        return lastPaid[item.id] <= dayNumber(item.due);
      }).length /
        paid.length) *
      100;
    return { avg: averageDays, onTime: onTime };
  }
  /** a value rounded to one decimal place, or null when there is none */
  function oneDecimal_(value) {
    return value === null ? null : Math.round(value * 10) / 10;
  }
  /**
   * ⭐ metrics(debits, credits, allocations, ctx) → the credit cycle, on ctx.asOf:
   *   outstanding · overdue · dso (outstanding ÷ debits raised in the last ctx.days, × days; default 90)
   *   avg_days_to_pay (debits fully paid: the last allocation's `on` − the debit's date) · on_time_pct (paid by their due)
   *   utilisation (outstanding ÷ ctx.limit, when a limit is given)
   * A number that cannot be worked out is null, never 0 — "no data" and "zero days" are different answers.
   */
  function metrics(debits, credits, allocations, ctx) {
    var context = ctx || {},
      today = dayNumber(context.asOf);
    if (today === null) throw new Error('metrics needs asOf as YYYY-MM-DD.');
    var balance = balances(debits, credits, allocations, context.asOf),
      currency = balance.currency;
    var totals = owedAndOverdue_(balance.debits, currency);
    var span = Number(context.days) > 0 ? Number(context.days) : 90;
    var raised = raisedInWindow_(debits, today, span, currency);
    var habits = payingHabits_(balance.debits, lastPaymentDays_(allocations));
    var limit = context.limit != null ? toMinor(context.limit, currency) : null;
    return {
      currency: currency,
      as_of: context.asOf,
      outstanding: fromMinor(totals.owed, currency),
      overdue: fromMinor(totals.overdue, currency),
      dso: raised > 0 ? Math.round((totals.owed / raised) * span * 10) / 10 : null,
      avg_days_to_pay: oneDecimal_(habits.avg),
      on_time_pct: oneDecimal_(habits.onTime),
      utilisation_pct: limit ? Math.round((totals.owed / limit) * 1000) / 10 : null
    };
  }

  /* ═══ C6 — THE OPTIONS, OFF UNTIL THE SUPPLIER TURNS THEM ON (§11). Each returns null when its option is off. ═══ */

  /** simple interest in minor units: rate_pm % of the balance a month, for `late` days of a 30-day month */
  function interestMinor_(balance, ratePerMonth, late) {
    return Math.round((((balance * ratePerMonth) / 100) * late) / 30);
  }
  /** the days past due on asOf, less the grace days (negative when not yet late) */
  function lateDays_(debit, asOf, options) {
    return dayNumber(asOf) - dayNumber(debit.due || dueDate(debit)) - (Number(options.grace_days) || 0);
  }
  /** interestDue(debitBalance, asOf, opt) — simple interest on an overdue balance: rate_pm % a month, after grace_days */
  function interestDue(debit, asOf, opt) {
    var options = opt || {};
    if (!options.on) return null;
    var late = lateDays_(debit, asOf, options);
    var currency = debit.currency || defaultCurrency_(opt),
      balance = toMinor(debit.balance != null ? debit.balance : debit.amount, currency);
    if (!(late > 0) || balance <= 0) return { days: Math.max(0, late || 0), amount: 0, currency: currency };
    return { days: late, amount: fromMinor(interestMinor_(balance, Number(options.rate_pm) || 0, late), currency), currency: currency };
  }
  /** the shop's OWN yearly money rate in percent (opt.rate_pa), or null: FIN-28 — never a default, a missing or zero rate is no rate */
  function moneyRate_(opt) {
    var rate = opt && opt.rate_pa != null && opt.rate_pa !== '' ? Number(opt.rate_pa) : NaN;
    return rate > 0 && isFinite(rate) ? rate : null;
  }
  /** an amount rounded to the currency's minor unit by the shared money.round (half away from zero on the decimal value) */
  function roundMoney_(amount, currency) {
    var engine = moneyEngine_();
    return engine && engine.round ? engine.round(amount, currency) : fromMinor(toMinor(amount, currency), currency);
  }
  /** the notional cost of money for a balance (minor units) late for `late` days: balance × rate ÷ 100 × days ÷ 365, rounded once, by money.round */
  function carryMinor_(balance, late, rate, currency) {
    if (!(late > 0) || !(balance > 0)) return 0;
    var scale = Math.pow(10, decimals_(currency));
    return toMinor(roundMoney_((balance * rate * late) / 36500 / scale, currency), currency);
  }
  /** why a carrying cost cannot be worked out (null when it can): an unreadable due/as-of date, or no balance or amount */
  function carryUnknownWhy_(debit, asOf, opt) {
    if (dayNumber(asOf) === null) return 'the as-of date is missing or not YYYY-MM-DD';
    if (dayNumber(debit.due || dueDate(debit, opt && opt.terms)) === null) return 'the bill has no readable due date or bill date';
    var figure = debit.balance != null ? debit.balance : debit.amount;
    if (figure == null || figure === '' || !isFinite(Number(figure))) return 'the bill has no balance or amount';
    return null;
  }
  /**
   * ⭐ carryingCost(debitBalance, asOf, opt) — FIN-20, a REPORT ONLY: what an overdue balance costs the shop in money tied up, amount × the shop's own
   * yearly rate × days late ÷ 365. opt.rate_pa is the shop's loan/OD rate; none set → null (FIN-28: no invented default). Never posted, never charged:
   * the answer says so ({ posted: false }). No grace days (that is the customer's interest, not the shop's cost).
   * Unknown stays unknown: an unreadable date or a missing balance gives days null and amount null with `why`, never NaN or 0.
   */
  function carryingCost(debit, asOf, opt) {
    var rate = moneyRate_(opt);
    if (rate === null) return null;
    var bill = debit || {},
      why = carryUnknownWhy_(bill, asOf, opt);
    if (why) return { days: null, amount: null, currency: bill.currency || null, rate_pa: rate, posted: false, why: why };
    var currency = bill.currency || defaultCurrency_(opt);
    var late = Math.max(0, dayNumber(asOf) - dayNumber(bill.due || dueDate(bill, opt && opt.terms)));
    var balance = toMinor(bill.balance != null ? bill.balance : bill.amount, currency);
    return { days: late, amount: fromMinor(carryMinor_(balance, late, rate, currency), currency), currency: currency, rate_pa: rate, posted: false };
  }
  /**
   * carryingCostReport(rows, asOf, opt) — the Collections view of FIN-20: each overdue row's cost, dearest first, and the run-rate "late bills cost
   * you about X a month" (EVERY overdue balance × rate × 30 ÷ 365, also one whose own cost rounds to 0). rows are { ref?, party?, date, due?,
   * balance|amount, currency? } in ONE currency. null when the shop set no rate. Report only: { posted: false }.
   * overdue_count = overdue balances; zero_cost_count = those whose cost rounds to 0 (kept in rows and per_month); unknown_count / unknown = rows whose
   * date or balance cannot be read (left out of the figures, listed with the reason).
   */
  function carryingCostReport(rows, asOf, opt) {
    var rate = moneyRate_(opt);
    if (rate === null) return null;
    var currency = oneCurrency(rows) || defaultCurrency_(opt),
      list = (rows || []).map(function (row) {
        return Object.assign({}, row, { cost: carryingCost(row, asOf, opt) });
      }),
      unknown = list.filter(function (row) {
        return row.cost.amount === null;
      }),
      overdue = list.filter(function (row) {
        return row.cost.days > 0 && toMinor(row.balance != null ? row.balance : row.amount, currency) > 0;
      });
    overdue.sort(function (a, b) {
      return b.cost.amount - a.cost.amount;
    });
    var owed = overdue.reduce(function (total, row) {
      return total + toMinor(row.balance != null ? row.balance : row.amount, currency);
    }, 0);
    var cost = overdue.reduce(function (total, row) {
      return total + toMinor(row.cost.amount, currency);
    }, 0);
    return {
      rows: overdue,
      total: fromMinor(cost, currency),
      per_month: fromMinor(carryMinor_(owed, 30, rate, currency), currency),
      overdue_count: overdue.length,
      zero_cost_count: overdue.filter(function (row) {
        return row.cost.amount === 0;
      }).length,
      unknown_count: unknown.length,
      unknown: unknown,
      currency: currency,
      rate_pa: rate,
      posted: false
    };
  }
  /** earlyDiscount(debit, paidOn, opt) — pct % off when paid within within_days of the bill */
  function earlyDiscount(debit, paidOn, opt) {
    var options = opt || {};
    if (!options.on) return null;
    var currency = debit.currency || defaultCurrency_(opt);
    if (dayNumber(paidOn) - dayNumber(debit.date) > (Number(options.within_days) || 0)) return { eligible: false, amount: 0, currency: currency };
    return {
      eligible: true,
      amount: fromMinor(Math.round((toMinor(debit.amount, currency) * (Number(options.pct) || 0)) / 100), currency),
      currency: currency
    };
  }
  /** pdcReminders(credits, asOf, opt) — post-dated cheques still in hand: to deposit today or overdue for deposit */
  function pdcReminders(credits, asOf, opt) {
    var options = opt || {};
    if (!options.on) return null;
    var today = dayNumber(asOf);
    return (credits || [])
      .filter(function (item) {
        return item.cheque && (item.cheque.status || 'received') === 'received' && dayNumber(item.cheque.date) !== null;
      })
      .map(function (item) {
        var chequeDay = dayNumber(item.cheque.date);
        return {
          credit: item.id,
          no: item.cheque.no,
          date: item.cheque.date,
          amount: item.amount,
          state: chequeDay > today ? 'not_yet' : chequeDay === today ? 'deposit_today' : 'overdue_for_deposit'
        };
      })
      .filter(function (item) {
        return item.state !== 'not_yet' || dayNumber(item.date) - today <= (Number(options.lead_days) || 0);
      });
  }
  /**
   * The check on dues to small suppliers paid late is the pack's (pack.checks, moved verbatim from here); this keeps the frozen name it has always had: (balances, asOf, opt).
   * Each option is off until the supplier turns it on (null); a pack with no such check answers null — there is nothing to flag.
   */
  function msmeFlags(balanceRows, asOf, opt) {
    var pack = pack_(opt),
      lateDuesCheck = pack.checks && pack.checks.msme;
    return typeof lateDuesCheck === 'function' ? lateDuesCheck(balanceRows, asOf, opt, dayNumber) : null;
  }

  /* ═══ v1.8.0 — PARTY ITEMS: every change is a new row ═══ */

  const ITEM_KINDS = ['bill', 'advance', 'on_account', 'allocation', 'reversal', 'status'];
  const ITEM_STATUSES = ['disputed', 'undisputed', 'received', 'deposited', 'cleared', 'bounced'];
  /** a 422 for a stored row that cannot be trusted */
  function refuseItem_(reason) {
    var error = new Error(reason);
    error.status = 422;
    return error;
  }
  /** ⚠️ a stored amount must be a SAFE INTEGER — a huge or non-numeric string is refused by name, never coerced */
  function int_(value, where) {
    var number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d{1,16}$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number)) throw refuseItem_('Not a whole minor-unit amount at ' + where + ': ' + String(value).slice(0, 40) + '.');
    return number;
  }
  /**
   * v1.8.1 (critic M10) — an `amount` handed to itemsOfBill / itemsOfPayment becomes minor units the way posting reads one:
   * money.priceOf (finite; a number or a plain decimal string — never true, [5], '0x10', an exponent string), under 10^15
   * minor units (past that a float drops minor units), and a safe integer. Infinity became amount_minor: Infinity before.
   */
  function amountMinor_(value, currency, where) {
    var engine = moneyEngine_();
    if (!engine || !engine.priceOf) throw refuseItem_('Party items need the money engine (it reads every amount).');
    var price = (value !== null && typeof value === 'object') || (typeof value === 'string' && /[eE]/.test(value)) ? null : engine.priceOf(value);
    if (price === null)
      throw refuseItem_('Not an amount at ' + where + ': ' + typeof value + ' ' + String(value).slice(0, 40) + ' — a finite number or a plain decimal string.');
    var scaled = price * Math.pow(10, decimals_(currency));
    if (!(Math.abs(scaled) < 1e15)) throw refuseItem_('The amount at ' + where + ' is beyond what this record holds exactly (10^15 minor units).');
    return int_(Math.round(Number(scaled.toPrecision(15))), where);
  }
  /** payable, or receivable (the default) */
  function side_(subject) {
    return subject && subject.side === 'payable' ? 'payable' : 'receivable';
  }
  /** a row without the fields that are undefined */
  function row_(fields) {
    var kept = {};
    Object.keys(fields).forEach(function (name) {
      if (fields[name] !== undefined) kept[name] = fields[name];
    });
    return kept;
  }

  /** ⭐ itemsOfBill(debit, terms) → [ the bill row ]: +amount against itself, with its due date (date + credit days) */
  function itemsOfBill(debit, terms) {
    var bill = debit || {},
      currency = String(bill.currency || '').toUpperCase();
    if (!bill.id || !bill.party) throw refuseItem_('A bill row needs its id and its party.');
    if (!/^[A-Z]{3}$/.test(currency)) throw refuseItem_('A bill row needs its currency.');
    var minor = bill.amount_minor != null ? int_(bill.amount_minor, bill.id) : amountMinor_(bill.amount, currency, 'bill ' + bill.id);
    if (!(minor > 0)) throw refuseItem_('A bill must be more than zero.');
    return [
      row_({
        party: bill.party,
        side: side_(bill),
        ref_kind: 'bill',
        kind: bill.kind || 'sale',
        ref: bill.id,
        against_ref: bill.id,
        amount_minor: minor,
        currency: currency,
        date: bill.date || null,
        due_date: dueDate(bill, terms)
      })
    ];
  }

  /** the payment's minor units (positive), refusing a payment without id, party, currency or amount */
  function paymentMinor_(payment, currency) {
    if (!payment.id || !payment.party) throw refuseItem_('A payment row needs its id and its party.');
    if (!/^[A-Z]{3}$/.test(currency)) throw refuseItem_('A payment row needs its currency.');
    var minor = payment.amount_minor != null ? int_(payment.amount_minor, payment.id) : amountMinor_(payment.amount, currency, 'payment ' + payment.id);
    if (!(minor > 0)) throw refuseItem_('A payment must be more than zero.');
    return minor;
  }
  /** the payment's money row: −amount against itself (an advance, or on account for a return / credit note / write-off) */
  function paymentMoneyRow_(payment, base, minor) {
    return row_(
      Object.assign({}, base, {
        ref_kind: (payment.kind || 'payment') === 'payment' ? 'advance' : 'on_account',
        ref: payment.id,
        against_ref: payment.id,
        amount_minor: -minor
      })
    );
  }
  /** the status row of a cheque still in hand: it holds the amount as pending until clearing */
  function pendingChequeRow_(payment, base, minor) {
    return row_(
      Object.assign({}, base, {
        ref_kind: 'status',
        ref: payment.id,
        against_ref: payment.id,
        amount_minor: 0,
        status: payment.cheque.status || 'received',
        pending_minor: -minor
      })
    );
  }
  /**
   * ⭐ itemsOfPayment(credit) → rows: a payment (or a return, credit note, write-off) sits −amount against ITSELF until
   * allocated. A cheque not yet cleared is only a STATUS row (C3) — its money row comes with itemsOfCheque(…,'cleared').
   * A disputed credit is recorded AND frozen (a status row after it) — v1.8.1 (M6): an UNCLEARED cheque too; its dispute
   * row is a row about the DOCUMENT, not about the cheque's state, so it is still there when the cheque clears.
   * A voided one records nothing.
   */
  function itemsOfPayment(credit) {
    var payment = credit || {},
      currency = String(payment.currency || '').toUpperCase();
    if (payment.void) return [];
    var minor = paymentMinor_(payment, currency);
    var base = { party: payment.party, side: side_(payment), currency: currency, date: payment.date || null, kind: payment.kind || 'payment' };
    var held = payment.cheque && (payment.cheque.status || 'received') !== 'cleared';
    var rows = [held ? pendingChequeRow_(payment, base, minor) : paymentMoneyRow_(payment, base, minor)];
    if (payment.disputed) rows.push(statusItem(payment, 'disputed', payment.date));
    return rows;
  }

  /** ⭐ statusItem(doc, status, on) → ONE status row (amount 0): disputed · undisputed · a cheque step. The latest wins. */
  function statusItem(doc, status, on) {
    var subject = doc || {};
    if (ITEM_STATUSES.indexOf(status) < 0) throw refuseItem_('Unknown status "' + status + '". One of: ' + ITEM_STATUSES.join(', ') + '.');
    if (!subject.id && !subject.ref) throw refuseItem_('A status row names its document.');
    var ref = subject.ref || subject.id;
    return row_({
      party: subject.party,
      side: side_(subject),
      ref_kind: 'status',
      ref: ref,
      against_ref: subject.against_ref || ref,
      amount_minor: 0,
      currency: subject.currency ? String(subject.currency).toUpperCase() : undefined,
      date: on || null,
      status: status
    });
  }

  /** the cheque step the rows of one cheque are at (received when none is recorded) */
  function chequeStatusOf_(mine) {
    var steps = mine.filter(function (item) {
      return item.ref_kind === 'status' && nextChequeSteps_(item.status);
    });
    return steps.length ? steps[steps.length - 1].status : 'received';
  }
  /** the money row a cheque gains on CLEARING (the amount its first status row held as pending), or null when none was held */
  function clearedMoneyRow_(mine, first, ref, on) {
    var pending = mine.filter(function (item) {
      return item.pending_minor != null;
    });
    var minor = pending.length ? int_(pending[0].pending_minor, ref) : 0;
    if (!minor) return null;
    return row_({
      party: first.party,
      side: first.side,
      ref_kind: 'advance',
      kind: 'payment',
      ref: ref,
      against_ref: ref,
      amount_minor: minor,
      currency: first.currency,
      date: on || null
    });
  }
  /**
   * ⭐ itemsOfCheque(items, ref, to, on) → rows for one step of a cheque already recorded: a status row; on CLEARED also the
   * money row (the amount the first status row held as pending). The order received → deposited → cleared | bounced is
   * enforced from the rows themselves. ⚠️ BOUNCED here is a bounce BEFORE clearing — a status row and nothing else, because
   * no money had moved. A cheque that CLEARED and is later dishonoured is not a step of this function (cleared → bounced
   * is refused): it is reverseItems(items, ref, on), which undoes its money row and every allocation made from it.
   */
  function itemsOfCheque(items, ref, to, on) {
    var mine = (items || []).filter(function (item) {
      return item && item.ref === ref;
    });
    var from = chequeStatusOf_(mine);
    if ((nextChequeSteps_(from) || []).indexOf(to) < 0)
      throw refuseItem_('A cheque that is ' + from + ' cannot become ' + to + '. The order is received → deposited → cleared or bounced.');
    var first = mine[0];
    if (!first) throw refuseItem_('There is no cheque ' + ref + '.');
    var rows = [statusItem({ ref: ref, party: first.party, side: first.side, currency: first.currency }, to, on)];
    var money = to === 'cleared' ? clearedMoneyRow_(mine, first, ref, on) : null;
    if (money) rows.push(money);
    return rows;
  }

  /** an allocation reversal row: the half it undoes, negated, still naming the payment as its ref (the pair check, M5) */
  function undoHalf_(half, minor, on) {
    return row_({
      party: half.party,
      side: half.side,
      ref_kind: 'reversal',
      kind: half.kind,
      ref: half.ref,
      against_ref: half.against_ref,
      amount_minor: -minor,
      currency: half.currency,
      date: on || null,
      reverses: half.item_id,
      reverses_kind: 'allocation'
    });
  }

  /** is `item` a better pick than `pick` for the payment half of `half`: the same day first, then the lowest item_id (never the array position, H3) */
  function betterHalf_(item, pick, half) {
    if (!pick) return true;
    var itemSameDay = item.date === half.date,
      pickSameDay = pick.date === half.date;
    return itemSameDay !== pickSameDay ? itemSameDay : String(item.item_id) < String(pick.item_id);
  }

  /** the payment's own half of one allocation (+m against the payment), not yet reversed nor claimed — refused by name when there is none */
  function paymentHalf_(all, half, minor, used) {
    var pick = null;
    all.forEach(function (item) {
      if (!item || item.ref_kind !== 'allocation' || item.ref !== half.ref || item.against_ref !== half.ref) return;
      if (item.item_id == null || item.item_id === '' || used[String(item.item_id)]) return;
      if (int_(item.amount_minor, half.ref) === minor && betterHalf_(item, pick, half)) pick = item;
    });
    if (!pick)
      throw refuseItem_(
        'The allocation of ' + half.ref + ' against ' + half.against_ref + ' (' + minor + ') has no matching half against ' + half.ref + ' — one half is missing or altered.'
      );
    return pick;
  }

  /**
   * ⭐ FIN-64 (v1.75.2): releaseItems_(all, ref, on, done) → the reversal rows that RELEASE every live allocation made TO
   * the reversed document `ref` by another document (a payment, a return, a credit note): both halves, so the money goes
   * back on account to the payer as unallocated credit — never deleted, never moved to another bill. `done` holds the
   * item_ids already reversed; the halves used here join it, so nothing is released twice.
   */
  function releaseItems_(all, ref, on, done) {
    var out = [];
    all.forEach(function (half, index) {
      if (!half || half.ref_kind !== 'allocation' || half.against_ref !== ref || half.ref === ref) return;
      if (half.item_id == null || half.item_id === '')
        throw refuseItem_(
          'Row ' + (index + 1) + ' (allocation of ' + half.ref + ' against ' + ref + ') has no item_id — a reversal must name the row it reverses, never its position.'
        );
      var minor = int_(half.amount_minor, ref);
      if (!minor || done[String(half.item_id)]) return;
      var payerHalf = paymentHalf_(all, half, -minor, done);
      done[String(half.item_id)] = 1;
      done[String(payerHalf.item_id)] = 1;
      out.push(undoHalf_(half, minor, on), undoHalf_(payerHalf, -minor, on));
    });
    return out;
  }

  /** the item_ids a set of rows has already reversed */
  function reversedIds_(all) {
    var done = Object.create(null);
    all.forEach(function (item) {
      if (item && item.ref_kind === 'reversal' && item.reverses != null) done[String(item.reverses)] = 1;
    });
    return done;
  }
  /** the 422 for a money row that has no item_id to be reversed by */
  function missingItemIdError_(item, index, ref) {
    return refuseItem_(
      'Row ' +
        (index + 1) +
        ' of ' +
        ref +
        ' (' +
        item.ref_kind +
        ' against ' +
        item.against_ref +
        ') has no item_id — a reversal must name the row it reverses, never its position.'
    );
  }
  /** the reversal row of one money row of `ref` */
  function reversalOfRow_(item, ref, on, minor) {
    return row_({
      party: item.party,
      side: item.side,
      ref_kind: 'reversal',
      kind: item.kind,
      ref: ref,
      against_ref: item.against_ref,
      amount_minor: -minor,
      currency: item.currency,
      date: on || null,
      reverses: item.item_id,
      reverses_kind: item.ref_kind
    });
  }
  /**
   * ⭐ reverseItems(items, ref, on) → reversal rows: every money row of that document (its own row and its allocations),
   * negated, each naming the row it reverses by that row's `item_id`. Rows already reversed are not reversed twice.
   * ⭐ v1.75.2 (FIN-64): reversing a BILL also releases every live allocation made to it (both halves, by releaseItems_):
   * the payer's money is back on account as unallocated credit, never left on the dead bill. Before, only rows whose
   * ref was the bill were reversed, so a part-paid bill read −paid and the receipt read fully applied, never re-applied.
   * ⚠️ A caller reversing two documents of one party in one go passes the first call's rows into the second (items.concat(rows)).
   * ⚠️⚠️ v1.8.1 (critic H3): every money row of the document MUST carry `item_id` — the id the database gave the row. A
   * row without one is REFUSED by name. v1.8.0 fell back to the row's position in the array ('PY1#3'), so the same rows in
   * another order, or a per-document fetch, reversed the same money a second time (a payment then OWED BY the customer).
   */
  function reverseItems(items, ref, on) {
    var all = items || [],
      done = reversedIds_(all);
    var out = [];
    all.forEach(function (item, index) {
      if (!item || item.ref !== ref || item.ref_kind === 'status' || item.ref_kind === 'reversal') return;
      var minor = int_(item.amount_minor, ref);
      if (!minor) return;
      if (item.item_id == null || item.item_id === '') throw missingItemIdError_(item, index, ref);
      if (done[String(item.item_id)]) return;
      out.push(reversalOfRow_(item, ref, on, minor));
    });
    return out.concat(releaseItems_(all, ref, on, done));
  }

  /**
   * ⭐ reopenedBy(rows) → the documents (bills) a set of reversal rows REOPENS — the against_ref of every reversal of an
   * allocation half that sat against a bill, each once, in the order met. v1.31.0 (M29): the one answer to "which bills
   * did this reversal reopen" — the words a screen paints after a Reverse come from here, never a second count.
   * v1.75.2 (FIN-64): a bill whose OWN row is reversed in the same set is cancelled, not reopened — it is never named.
   */
  function reopenedBy(rows) {
    var seen = Object.create(null),
      out = [];
    (rows || []).forEach(function (item) {
      if (item && item.ref_kind === 'reversal' && item.reverses_kind === 'bill' && item.ref === item.against_ref) seen[String(item.ref)] = 1;
    });
    (rows || []).forEach(function (item) {
      if (!item || item.ref_kind !== 'reversal' || item.reverses_kind !== 'allocation' || item.against_ref === item.ref) return;
      var billRef = String(item.against_ref);
      if (seen[billRef]) return;
      seen[billRef] = 1;
      out.push(billRef);
    });
    return out;
  }

  /** a new entry of outstanding().by_ref for the document `ref` */
  function newRefEntry_(ref, item) {
    return {
      ref: ref,
      party: item.party,
      side: item.side || 'receivable',
      kind: null,
      bill_minor: 0,
      outstanding_minor: 0,
      due_date: null,
      date: null,
      status: null,
      disputed: false
    };
  }
  /** M6: a dispute row and a cheque step are read apart; the latest of each wins */
  function applyStatusRow_(entry, item) {
    if (item.status === 'disputed') entry.disputed = true;
    else if (item.status === 'undisputed') entry.disputed = false;
    else entry.status = item.status;
  }
  /** a row that is the document itself (not a status, reversal or allocation): its kind, date, due date and bill amount */
  function applyOwnRow_(entry, item, minor) {
    entry.kind = item.ref_kind;
    entry.date = item.date || entry.date;
    if (item.due_date) entry.due_date = item.due_date;
    if (item.ref_kind === 'bill') entry.bill_minor += minor;
  }
  /** is this row the document `ref` itself (not a status, reversal or allocation row about it)? */
  function isOwnRowOf_(item, ref) {
    return item.ref === ref && item.ref_kind !== 'status' && item.ref_kind !== 'reversal' && item.ref_kind !== 'allocation';
  }
  /** an allocation row (or the reversal of one): checked, and its minor units added to its payment's pair sum */
  function trackAllocation_(state, item, index, minor) {
    var undo = item.ref_kind === 'reversal' && item.reverses_kind === 'allocation';
    if (item.ref_kind !== 'allocation' && !undo) return;
    allocationChecked_(item, index, minor, undo, state.docParty, state.docKind);
    state.pairSum[item.ref] = (state.pairSum[item.ref] || 0) + minor;
    if (state.pairAt[item.ref] === undefined) state.pairAt[item.ref] = index + 1;
  }
  /** fold one row into the running state of outstanding(): the document's entry, the allocation pair sums, the party and grand totals */
  function addRow_(state, item, index) {
    var minor = int_(item.amount_minor, 'row ' + (index + 1));
    var ref = item.against_ref;
    var entry = state.byRef[ref] || (state.byRef[ref] = newRefEntry_(ref, item));
    if (item.ref_kind === 'status' && item.ref === ref) applyStatusRow_(entry, item);
    if (isOwnRowOf_(item, ref)) applyOwnRow_(entry, item, minor);
    trackAllocation_(state, item, index, minor);
    entry.outstanding_minor += minor;
    state.byParty[item.party] = (state.byParty[item.party] || 0) + minor;
    state.total += minor;
    if (!Number.isSafeInteger(state.total)) throw refuseItem_('The party items overflow a safe total at row ' + (index + 1) + '.');
  }
  /**
   * ⭐⭐ outstanding(items) → { currency, by_ref, by_party, total_minor, total } — Σ per against_ref, and per party.
   *   by_ref[ref] { party, side, kind, bill_minor, outstanding_minor, outstanding, due_date, date, status (the latest
   *                 cheque step), disputed (the latest dispute row) }
   * `items` = a party's (or a shop's) WHOLE item set — every row of every document the rows name.
   * Refuses (throws 409/422), naming the row — never coerced, never netted quietly:
   *   · two currencies · a non-integer or oversized amount · an unknown ref_kind
   *   · (v1.8.1, M5) allocation rows of one payment that do not pair off (Σ ≠ 0 — a half is missing: money created or lost)
   *   · (M5) an allocation half with the wrong sign (− against the bill, + against the payment; a reversal the opposite)
   *   · (M5) an allocation row stamped with a party other than the party of a document it names; a document with two parties
   */
  function outstanding(items, opt) {
    var rows = (items || []).filter(Boolean);
    var currency = oneCurrency(rows, 'one set of party items');
    var docs = docsOf_(rows);
    /* L4: no prototype — an against_ref of "__proto__" wrote Object.prototype.outstanding_minor; a party of "constructor" read a function */
    var state = {
      byRef: Object.create(null),
      byParty: Object.create(null),
      total: 0,
      docParty: docs.party,
      docKind: docs.kind,
      pairSum: Object.create(null),
      pairAt: Object.create(null)
    };
    rows.forEach(function (item, index) {
      addRow_(state, item, index);
    });
    pairsOff_(state.pairSum, state.pairAt);
    Object.keys(state.byRef).forEach(function (ref) {
      state.byRef[ref].outstanding = fromMinor(state.byRef[ref].outstanding_minor, currency || defaultCurrency_(opt));
    });
    return {
      currency: currency,
      by_ref: state.byRef,
      by_party: state.byParty,
      total_minor: state.total,
      total: fromMinor(state.total, currency || defaultCurrency_(opt))
    };
  }

  /** does this row stand for a document itself (a bill, an advance, on account, or a cheque's pending status)? */
  function isDocumentRow_(item) {
    return (
      item.ref === item.against_ref &&
      (item.ref_kind === 'bill' || item.ref_kind === 'advance' || item.ref_kind === 'on_account' || (item.ref_kind === 'status' && item.pending_minor != null))
    );
  }
  /** what each document is (bill or credit), and whose; a document stamped with two parties is refused (split out of outstanding, FIN-64) */
  function docsOf_(rows) {
    var docParty = Object.create(null),
      docKind = Object.create(null);
    rows.forEach(function (item, index) {
      /* first: what each document is, and whose */
      if (ITEM_KINDS.indexOf(item.ref_kind) < 0) throw refuseItem_('Row ' + (index + 1) + ' has an unknown ref_kind "' + item.ref_kind + '".');
      if (!isDocumentRow_(item)) return;
      var ref = item.ref,
        party = String(item.party);
      if (docParty[ref] !== undefined && docParty[ref] !== party)
        throw refuseItem_('Row ' + (index + 1) + ': document ' + ref + ' is stamped with two parties (' + docParty[ref] + ', ' + party + ').');
      docParty[ref] = party;
      if (item.ref_kind === 'bill') docKind[ref] = 'bill';
      else if (!docKind[ref]) docKind[ref] = 'credit';
    });
    return { party: docParty, kind: docKind };
  }

  /** the sign an allocation half must have: − against a bill, + against a payment (a reversal the opposite); 0 when the document is unknown */
  function wantedSign_(kind, undo) {
    return (kind === 'bill' ? -1 : kind === 'credit' ? 1 : 0) * (undo ? -1 : 1);
  }
  /** M5: a stored allocation half is checked, not trusted: both documents are this party's, and the sign is − against the bill, + against the payment */
  function allocationChecked_(item, index, minor, undo, docParty, docKind) {
    var where = 'Row ' + (index + 1) + ' (' + item.ref_kind + ' of ' + item.ref + ' against ' + item.against_ref + ')';
    [item.ref, item.against_ref].forEach(function (ref) {
      if (docParty[ref] !== undefined && docParty[ref] !== String(item.party))
        throw refuseItem_(where + ' is stamped party ' + item.party + ', but ' + ref + ' belongs to ' + docParty[ref] + '.');
    });
    var want = wantedSign_(docKind[item.against_ref], undo);
    if (want && minor && minor > 0 !== want > 0)
      throw refuseItem_(where + ' has the wrong sign (' + minor + '): an allocation is − against the bill and + against the payment.');
  }

  /** the allocation rows of each payment sum to 0; a lone or altered half is refused, naming its first row */
  function pairsOff_(pairSum, pairAt) {
    Object.keys(pairSum).forEach(function (ref) {
      if (pairSum[ref] !== 0)
        throw refuseItem_(
          'The allocation rows of ' +
            ref +
            ' do not pair off: they sum to ' +
            pairSum[ref] +
            ', not 0 — one half of an allocation is missing or altered (first at row ' +
            pairAt[ref] +
            ').'
        );
    });
  }

  /** FIN-64 (v1.75.2): per bill, the (negative) sum of the reversals of its OWN row — a reversed bill owes nothing and takes no allocation */
  function billCuts_(items) {
    var reversedOwn = Object.create(null);
    (items || []).forEach(function (item) {
      if (!item || item.ref_kind !== 'reversal' || item.reverses_kind !== 'bill' || item.ref !== item.against_ref) return;
      reversedOwn[item.ref] = (reversedOwn[item.ref] || 0) + int_(item.amount_minor, item.ref);
    });
    return reversedOwn;
  }

  /** per (payment, bill), the net minor units allocated after reversals; the key is payment + NUL + bill */
  function netAllocationPairs_(items) {
    var pairs = Object.create(null);
    (items || []).forEach(function (item) {
      if (!item || (item.ref_kind !== 'allocation' && !(item.ref_kind === 'reversal' && item.ref !== item.against_ref))) return;
      if (item.ref === item.against_ref) return;
      var key = item.ref + '\u0000' + item.against_ref;
      pairs[key] = (pairs[key] || 0) - int_(item.amount_minor, item.ref);
    });
    return pairs;
  }
  /** the bills still owing something, as v1.7.0 debits */
  function billsAsDebits_(byRef, reversedOwn, currency) {
    var debits = [];
    Object.keys(byRef).forEach(function (ref) {
      var entry = byRef[ref],
        left = entry.bill_minor + (reversedOwn[ref] || 0);
      if (entry.kind === 'bill' && left > 0) {
        debits.push({
          id: ref,
          kind: 'sale',
          party: entry.party,
          date: entry.date,
          due: entry.due_date,
          amount: fromMinor(left, currency),
          currency: currency,
          disputed: entry.disputed
        });
      }
    });
    return debits;
  }
  /** is this row a payment's own money: the advance / on-account rows, or the reversals of those */
  function isPaymentMoneyRow_(row) {
    return (
      row.ref_kind === 'advance' || row.ref_kind === 'on_account' || (row.ref_kind === 'reversal' && (row.reverses_kind === 'advance' || row.reverses_kind === 'on_account'))
    );
  }
  /** does this row open a payment (its own advance / on-account row, or a cheque's pending status)? */
  function opensPayment_(item) {
    return item.ref_kind === 'advance' || item.ref_kind === 'on_account' || (item.ref_kind === 'status' && item.pending_minor != null);
  }
  /** one payment as a v1.7.0 credit: its own money less the reversals of those rows (a dishonoured cheque nets to 0) */
  function paymentAsCredit_(item, items, entry, currency) {
    var mine = items.filter(function (row) {
      return row && row.ref === item.ref && row.against_ref === item.ref && isPaymentMoneyRow_(row);
    });
    var ownMinor = mine.reduce(function (total, row) {
      return total - int_(row.amount_minor, item.ref);
    }, 0);
    var reversed = mine.some(function (row) {
      return row.ref_kind === 'reversal';
    });
    var amount = ownMinor || reversed ? ownMinor : item.pending_minor != null ? -int_(item.pending_minor, item.ref) : 0;
    var credit = {
      id: item.ref,
      kind: item.kind || 'payment',
      party: item.party,
      date: item.date,
      amount: fromMinor(amount, currency),
      currency: currency,
      disputed: !!entry.disputed
    };
    if (entry.status && nextChequeSteps_(entry.status)) credit.cheque = { status: entry.status };
    if (entry.status === 'bounced' || (reversed && ownMinor === 0)) credit.void = true;
    return credit;
  }
  /** the payments among the rows, one credit each, in the order their first row is met */
  function paymentsAsCredits_(items, byRef, currency) {
    var credits = [],
      seen = Object.create(null);
    (items || []).forEach(function (item) {
      if (!item || item.ref !== item.against_ref || seen[item.ref]) return;
      if (!opensPayment_(item)) return;
      seen[item.ref] = 1;
      credits.push(paymentAsCredit_(item, items || [], byRef[item.ref] || {}, currency));
    });
    return credits;
  }
  /** the net (payment, bill) pairs with money left, as v1.7.0 allocations */
  function pairsAsAllocations_(pairs, currency) {
    return Object.keys(pairs)
      .filter(function (key) {
        return pairs[key] > 0;
      })
      .map(function (key) {
        var parts = key.split('\u0000');
        return { credit: parts[0], debit: parts[1], amount: fromMinor(pairs[key], currency) };
      });
  }
  /**
   * ⭐ fromItems(items) → { debits, credits, allocations } in the v1.7.0 shapes, so propose() / check() / ageing() /
   * statement() run on the rows unchanged. Net allocations per (payment, bill) after reversals; a bounced payment is void;
   * disputed documents carry disputed: true; an uncleared cheque is a credit with its cheque status (not usable).
   */
  function fromItems(items, opt) {
    var owed = outstanding(items, opt),
      currency = owed.currency || defaultCurrency_(opt);
    var pairs = netAllocationPairs_(items);
    var debits = billsAsDebits_(owed.by_ref, billCuts_(items), currency);
    var credits = paymentsAsCredits_(items, owed.by_ref, currency);
    return { currency: owed.currency, debits: debits, credits: credits, allocations: pairsAsAllocations_(pairs, currency) };
  }

  /** ⭐ proposeItems(items, creditRef, ctx) → propose() on the rows: the SUGGESTION, oldest due first, disputed skipped (D1) */
  function proposeItems(items, creditRef, ctx) {
    var shapes = fromItems(items, ctx),
      payment = shapes.credits.find(function (item) {
        return item.id === creditRef;
      });
    if (!payment) return { ok: false, why: 'There is no payment ' + creditRef + ' to apply.', allocations: [], on_account: 0, skipped: [] };
    return propose(shapes.debits, payment, Object.assign({}, ctx || {}, { credits: shapes.credits, allocations: shapes.allocations }));
  }

  /** the two allocation rows of one confirmed allocation: −amount against the bill, +amount against the payment */
  function allocationRows_(item, owed, currency, on) {
    var minor = toMinor(item.amount, currency),
      bill = owed.by_ref[item.debit],
      payment = owed.by_ref[item.credit];
    return [
      row_({
        party: bill.party,
        side: bill.side,
        ref_kind: 'allocation',
        ref: item.credit,
        against_ref: item.debit,
        amount_minor: -minor,
        currency: currency,
        date: on || null
      }),
      row_({
        party: payment.party,
        side: payment.side,
        ref_kind: 'allocation',
        ref: item.credit,
        against_ref: item.credit,
        amount_minor: minor,
        currency: currency,
        date: on || null
      })
    ];
  }
  /**
   * ⭐⭐ confirmItems(items, confirmed, on) → { ok, rows, problems, why } — what the owner CONFIRMED, checked by check()
   * against the rows (disputed frozen C4, uncleared cheque C3, never more than is left), then the allocation rows: for each
   * −amount against the bill and +amount against the payment. Nothing is written by this engine; the caller inserts rows.
   */
  function confirmItems(items, confirmed, on, opt) {
    var shapes = fromItems(items, opt);
    var verdict = check(confirmed, shapes.debits, shapes.credits, shapes.allocations);
    if (!verdict.ok) return { ok: false, rows: [], problems: verdict.problems, why: verdict.why };
    var currency = shapes.currency || defaultCurrency_(opt),
      owed = outstanding(items, opt),
      rows = [];
    (confirmed || []).forEach(function (item) {
      rows.push.apply(rows, allocationRows_(item, owed, currency, on));
    });
    return { ok: true, rows: rows, problems: [], why: '' };
  }

  const EXPORTS = {
    DEBIT_KINDS,
    CREDIT_KINDS,
    dueDate,
    usable,
    cheque,
    live,
    balances,
    propose,
    check,
    reverse,
    ageing,
    statement,
    metrics,
    interestDue,
    carryingCost,
    carryingCostReport,
    earlyDiscount,
    pdcReminders,
    msmeFlags,
    ITEM_KINDS,
    ITEM_STATUSES,
    itemsOfBill,
    itemsOfPayment,
    statusItem,
    itemsOfCheque,
    reverseItems,
    reopenedBy,
    outstanding,
    fromItems,
    proposeItems,
    confirmItems
  };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBReceivables. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBReceivables = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
