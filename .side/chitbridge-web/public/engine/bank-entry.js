/* ADOPTED from chitbridge-engines v1.98.0 · bank-entry · sha256 2be543dacee8719f2d706e9e3581b819a9566c8448caa8088a6e8b74367d880e — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/**
 * bank-entry.js: WHAT A BANK-LINE PROPOSAL'S ENTRY CARRIES: the shape of the entry posting.post composed, and the tax inside a tax-inclusive expense.
 * OWNS whatIsThis (the CLOSED list a person answers for a line with no payee: each answer is an EXISTING posting event) · withTax (a taxed expense: the amount worked back through tax.splitLineTax, the tax handed to posting.post as input_tax) · entryOf (the composed entry as a proposal shows it) · newParty (a payee who is no party yet: proposed, never created here) · notAParty (a narration that is an own-account transfer, a tax-office payment or a card settlement: no party, a whatIsThis answer instead).
 * CALLED BY bank-recon.js (base → withTax, finish_ → entryOf) · bank-project.js reads the entry these make and nothing else.
 * FLOW bank statement → books, step "suggest" (docs/16-finance/BANK-TO-BOOKS-REQUIREMENT.md, Critic 14 Nov, item 3). CARD 16-finance/bank-reconciliation-and-bank-rail.
 * ONE calculation: no rate is written here and no tax is divided here. The rate and the credit rule are the pack's supply kind (pack.supplyKindOf), the sum is tax.splitLineTax,
 * the tax-invoice threshold is the pack's taxInvoice row (read on the line's own day by tax-packs.rowAsOf). A pack with no supply kinds, or with more than one tax head, gets no split.
 * An UNKNOWN stays unknown: a line whose kind nothing names carries no tax (never guessed), and the cash-or-accrual basis is not in any pack, so a taxed proposal says `needs: 'gst_basis'`.
 */
(function (root) {
  'use strict';
  var DEPS_ = {};
  /** a sibling engine, from node or from the page's global; null when it would not load (the callers then split nothing and say so) */
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
  /** the supply kind a proposal is taxed as: ONLY the one the person taught with the rule (event.tax_kind, "the tax code on the rule"); a fee is not taxable or input-taxed by its name. null names none */
  function kindNameOf_(event) {
    return event.tax_kind ? String(event.tax_kind) : null;
  }
  /** the tax-invoice answer for a credit claimed on this amount, on the line's own day; null when the pack keeps no such rule */
  function invoiceNeed_(pack, grossMinor, day) {
    if (typeof pack.taxInvoice !== 'function') return null;
    var rows = pack.tax && pack.tax.taxInvoice && pack.tax.taxInvoice.rows,
      packs = Array.isArray(rows) ? dep_('./tax-packs', 'CBTaxPacks') : null;
    var opt = packs && packs.rowAsOf ? { dated: true, row: packs.rowAsOf(rows, day) } : {};
    var answer = pack.taxInvoice(grossMinor, opt);
    return { required: !!answer.required, cite: answer.cite || null };
  }
  /** the amount and the tax inside it for one tax-inclusive line, through the one splitter; null when the tax engine is not there */
  function splitOf_(grossMajor, rate, currency) {
    var taxEngine = dep_('./tax', 'CBTax');
    if (!taxEngine || typeof taxEngine.splitLineTax !== 'function') return null;
    return taxEngine.splitLineTax({ net: grossMajor, rate: rate, priceIncludesTax: true, currency: currency, supply: 'domestic', split: false });
  }
  /**
   * withTax(event, ctx) → { event, tax }: the event as posting.post should compose it, and what was decided about its tax (null when nothing was).
   *   ctx { rule, pack, currency, minor (the amount on the statement, tax included), decimals, basis ('cash' | 'accrual' | undefined) }
   * An `expense` is split as an INPUT tax; an `other_income` (money in coded to an income class) as an OUTPUT tax (B5-04). The event handed in is not touched.
   * tax = { kind, rate, tax_minor, credit, direction: 'input' | 'output', basis, invoice: { required, cite } | null, invoice_answer: 'held' | 'none' | null }.
   * B5-03: ctx.invoice = 'held' (the person holds the tax invoice: the credit stands) | 'none' (no invoice: the whole figure is the expense, no credit) | undefined (asked: bank-recon says needs 'tax_invoice').
   */
  function withTax(event, ctx) {
    return taxOf_(amountsOf_(event, ctx), ctx);
  }
  function taxOf_(event, ctx) {
    var income = !!event && event.type === 'other_income',
      kindName = event && (event.type === 'expense' || income) ? kindNameOf_(event) : null,
      pack = ctx.pack;
    if (!kindName || typeof pack.supplyKindOf !== 'function' || !Array.isArray(pack.taxHeads) || pack.taxHeads.length !== 1) return { event: event, tax: null };
    var kind = pack.supplyKindOf({ supply_kind: kindName });
    if (!kind) return { event: event, tax: null };
    var posted = Object.assign({}, event),
      tax = { kind: kind.id, rate: kind.rate, tax_minor: 0, credit: !income && !!kind.credit, direction: income ? 'output' : 'input', basis: ctx.basis || null, invoice: null, invoice_answer: null };
    delete posted.tax_kind;
    if (!(kind.rate > 0)) return { event: posted, tax: tax };
    var scale = Math.pow(10, ctx.decimals);
    if (tax.credit) tax.invoice = invoiceNeed_(pack, ctx.minor, posted.date);
    if (tax.invoice && tax.invoice.required && ctx.invoice === 'none') return { event: posted, tax: Object.assign(tax, { credit: false, invoice_answer: 'none' }) }; /* B5-03: no tax invoice, no credit: the whole figure is the expense */
    if (tax.invoice && tax.invoice.required && ctx.invoice === 'held') tax.invoice_answer = 'held';
    var split = splitOf_(ctx.minor / scale, kind.rate, ctx.currency);
    if (!split) return { event: event, tax: null };
    var head = {};
    head[pack.taxHeads[0]] = split.tax;
    tax.tax_minor = Math.round(split.tax * scale);
    posted.amount = (ctx.minor - tax.tax_minor) / scale; /* what is left of the statement figure, so amount + tax is always exactly the bank's figure */
    posted[income ? 'output_tax' : 'input_tax'] = Object.assign({ rate: kind.rate }, head); /* B5-04: money in carries the tax it collected through posting's output-tax path, the mirror of the expense's input tax */
    return { event: posted, tax: tax };
  }
  /** the entry posting.post composed, as the proposal shows it: its lines, whether Dr equals Cr, its totals and voucher type, in the owner-made series MJ */
  function entryOf(posted) {
    var debitTotal = 0,
      creditTotal = 0;
    posted.lines.forEach(function (item) {
      debitTotal += item.dr_minor;
      creditTotal += item.cr_minor;
    });
    return {
      lines: posted.lines.map(function (item) {
        return { code: item.code, account: item.account, party: item.party || null, dr_minor: item.dr_minor, cr_minor: item.cr_minor };
      }),
      balanced: debitTotal === creditTotal,
      dr_minor: debitTotal,
      cr_minor: creditTotal,
      voucher: posted.voucher,
      series: 'MJ'
    };
  }
  var LEGAL_WORDS_ = ['PTY', 'LTD', 'LIMITED', 'INC', 'CO', 'COMPANY', 'THE', 'AND'];
  /** a party name as it is compared: upper case, letters and digits only, the legal-form words left out ("Smith Pty Ltd" and "SMITH" meet) */
  function nameKey_(name) {
    return String(name || '')
      .toUpperCase()
      .replace(/&/g, ' AND ')
      .split(/[^A-Z0-9]+/)
      .filter(function (word) {
        return word && LEGAL_WORDS_.indexOf(word) < 0;
      })
      .join(' ');
  }
  /** how alike two normalised names are, 0..1: the Dice coefficient on character pairs (the same measure web csv-preflight uses; the engine cannot import it) */
  function likeness_(left, right) {
    var pairs = function (text) {
      var flat = text.replace(/ /g, ''),
        out = [];
      for (var at = 0; at < flat.length - 1; at++) out.push(flat.slice(at, at + 2));
      return out;
    };
    if (left === right) return 1;
    var first = pairs(left),
      second = pairs(right),
      total = first.length + second.length,
      shared = 0;
    first.forEach(function (pair) {
      var found = second.indexOf(pair);
      if (found >= 0) {
        shared++;
        second.splice(found, 1);
      }
    });
    return total ? (2 * shared) / total : 0;
  }
  var NEAR_AT_ = 0.6;
  /** the parties whose name is near this one, best first (at most three): [{ id, name, kind, score }] */
  function didYouMean_(key, parties) {
    if (!key) return [];
    return (parties || [])
      .map(function (item) {
        return { id: item.id || item.name, name: item.name || item.id, kind: item.kind || null, score: likeness_(key, nameKey_(item.name || item.id)) };
      })
      .filter(function (item) {
        return item.score >= NEAR_AT_;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, 3);
  }
  /** the payee's name as the statement says it: its words that are neither the bank's own nor figures, in capitals-first form; null when nothing is left */
  function cleanName_(narration, ownWords) {
    var shown = /[a-z]/.test(String(narration || ''));
    var words = String(narration || '')
      .split(/[^A-Za-z0-9&]+/)
      .filter(function (word) {
        return word.length >= 2 && !/[0-9]/.test(word) && ownWords.indexOf(word.toUpperCase()) < 0;
      })
      .map(function (word) {
        return shown ? word : word.length <= 4 ? word : word.charAt(0) + word.slice(1).toLowerCase(); /* as the statement wrote it; an all-capitals statement keeps short words (ATO) and title-cases the rest */
      });
    return words.length ? words.join(' ') : null;
  }
  /**
   * newParty(line, { out, parties, ownWords }) → the party a line proposes, or null when the narration names nobody:
   *   { status: 'existing', id, name, kind } when the normalised name IS a party's (never proposed new, never in parties_to_create), else
   *   { status: 'new', name, kind: 'supplier' | 'customer', basis: 'direction', did_you_mean: [{ id, name, kind, score }] }
   * The kind is DERIVED from the side (money out = supplier, in = customer) and says so (basis), so a screen shows it editable. Near parties are listed FIRST
   * (did_you_mean, cut at 0.6 on character pairs: a near miss like Smith / Smyth scores 0.5 and is NOT offered, a known limit) so the person picks one rather than makes a duplicate; nothing is created here: a new party is the person's confirm. A new ACCOUNT is out for v1.
   */
  function newParty(line, ctx) {
    var name = cleanName_(line && line.narration, ctx.ownWords || []);
    if (!name) return null;
    var same = (ctx.parties || []).filter(function (item) {
      return nameKey_(item.name || item.id) === nameKey_(name);
    })[0];
    if (same) return { status: 'existing', id: same.id || same.name, name: same.name || same.id, kind: same.kind || null, did_you_mean: [] };
    return { status: 'new', name: name, kind: ctx.out ? 'supplier' : 'customer', basis: 'direction', did_you_mean: didYouMean_(nameKey_(name), ctx.parties) };
  }
  /** the three things a narration can be before it is a payee, in the order tried: [the pack's keyword category, the whatIsThis id it proposes, the one side it is for (null = either)] */
  var NOT_A_PARTY_ = [
    ['own_transfer', 'transfer', null],
    ['tax_office', 'tax_payment', 'out'],
    ['card_settlement', 'card_settlement', 'in']
  ];
  /**
   * notAParty(text, { rules, out, has }) → { kind, word, ask } or null: the narration names the shop's OWN account, the tax office or the card terminal's payout, so it is no supplier or customer.
   * The WORDS are the pack's (pack.bank.keywords: own_transfer · tax_office · card_settlement, read through bank-recon's rules and its one whole-word test `has`); a pack with none gives null, so the engine stays neutral.
   * kind is an id of whatIsThis(): the line is proposed as that answer (a transfer asks which own account), never as a new party.
   */
  function notAParty(text, ctx) {
    for (var at = 0; at < NOT_A_PARTY_.length; at++) {
      var row = NOT_A_PARTY_[at],
        word = row[2] && row[2] !== (ctx.out ? 'out' : 'in') ? null : ctx.has(text, (ctx.rules && ctx.rules[row[0]]) || []);
      if (word) return { kind: row[1], word: word, ask: row[1] === 'transfer' ? 'account' : null };
    }
    return null;
  }
  /** the pack the answers are read against: the one given, else the one the options name; null when neither */
  function packOf_(opts) {
    var regulation = dep_('./regulation', 'CBRegulation');
    return (opts && opts.pack) || (regulation && regulation.resolve ? regulation.resolve(opts || {}) : null);
  }
  /** the pack's own accounts of the groups given, as the person picks them: [{ role, code, name }] (no groups given = every row of that list) */
  function accountsIn_(pack, groups, key) {
    return (pack[key || 'ledgers'] || [])
      .filter(function (item) {
        return !groups || groups.indexOf(item.group) >= 0;
      })
      .map(function (item) {
        return { role: item.role, code: item.code, name: item.name };
      });
  }
  /** the amount-shaped fields a statement line fills: the whole figure of a tax payment goes to its one head, of a loan repayment to the principal (the interest is a later split, never guessed) */
  function amountsOf_(event, ctx) {
    if (!event || (event.type !== 'tax_payment' && event.type !== 'loan_repaid')) return event;
    var figure = ctx.minor / Math.pow(10, ctx.decimals),
      posted = Object.assign({}, event);
    if (event.type === 'loan_repaid') return Object.assign(posted, { principal: figure, interest: 0 });
    posted.heads = {};
    Object.keys(event.heads || {}).forEach(function (head) {
      posted.heads[head] = figure;
    });
    return posted;
  }
  /** what a person cannot say yet, and why: shown by a screen as "later", never offered */
  var LATER_ = [
    { id: 'owner_drawings', words: 'I took money out for myself', why: 'drawings are a manual entry by the owner (no posting event for it yet); BKS-ACC-1' },
    { id: 'owner_capital', words: 'I put my own money in', why: 'capital introduced is a manual entry by the owner (no posting event for it yet); BKS-ACC-1' },
    { id: 'equipment', words: 'I bought equipment', why: 'an asset is added through the assets door (POST /assets), not a posting event; BKS-ACC-1' }
  ];
  /**
   * the shop's OWN bank-group ledgers the pack does not know (a savings account it added): opts.own_accounts [{ code, name }] → [{ role: null, code, name }], the line's own account left out by the caller.
   * A transfer to one of them is a `contra` the engine composes through the pack that carries them (packWith_), never a new account.
   */
  function ownAccounts_(opts, pack) {
    var known = {};
    (pack.ledgers || []).forEach(function (item) { known[String(item.code)] = true; });
    return ((opts && opts.own_accounts) || [])
      .filter(function (item) { return item && item.code && !known[String(item.code)]; })
      .map(function (item) { return { role: null, code: String(item.code), name: String(item.name || item.code) }; });
  }
  /** the pack with the shop's own bank-group ledgers added (a copy; the pack itself is not touched): what posting.post needs to compose a contra to one */
  function packWith_(pack, opts) {
    var more = ownAccounts_(opts, pack);
    if (!more.length) return pack;
    var bankGroup = pack.chart && pack.chart.kinds && pack.chart.kinds.bank;
    return Object.assign({}, pack, { ledgers: (pack.ledgers || []).concat(more.map(function (item) { return { role: undefined, code: item.code, name: item.name, group: bankGroup }; })) });
  }
  /**
   * whatIsThis(opts) → { ok, items, later, not_offered }: THE CLOSED LIST for a line that names no payee ("What is this?"). Nothing here is new: every answer is an EXISTING posting event, from the accounts the pack already has.
   *   opts { country | pack, own_accounts? }; item = { id, words, side: 'out' | 'in' | 'both', event: the posting event type, ask: 'account' | null, accounts: [{ role, code, name }] (what the account answer is picked from), fixed: the one account it is, or null }
   *   answers to resolve(): { kind: <an id here>, account: <a role or code from that item's accounts> }; an `account` with no kind is an expense (money out) or other income (money in), as before.
   * The tax payment is offered ONLY when the pack has ONE tax head (the whole figure is that head's); PAYG and super have no head, so they are not offered. A loan repayment is the whole figure as principal (the interest split is not asked).
   * The same list is used by resolve(), so a screen and the engine cannot disagree on what may be said.
   */
  function whatIsThis(opts) {
    var pack = packOf_(opts || {});
    if (!pack || !pack.chart || !pack.chart.kinds) return { ok: false, why: 'the regulation pack names no chart, so no answers can be listed', items: [], later: LATER_, not_offered: [] };
    var kinds = pack.chart.kinds,
      money = accountsIn_(pack, [kinds.cash, kinds.bank]).filter(function (item) {
        return item.role !== 'bank';
      }),
      loans = accountsIn_(pack, kinds.loans),
      own = ownAccounts_(opts, pack),
      only = function (role) {
        return money.filter(function (item) {
          return item.role === role;
        });
      },
      items = [
        { id: 'expense', words: 'A cost of the business', side: 'out', event: 'expense', ask: 'account', accounts: accountsIn_(pack, null, 'expense_classes'), fixed: null },
        { id: 'other_income', words: 'Money that is not a sale', side: 'in', event: 'other_income', ask: 'account', accounts: accountsIn_(pack, null, 'income_classes'), fixed: null },
        { id: 'transfer', words: 'Moved between my own accounts', side: 'both', event: 'contra', ask: 'account', accounts: money.concat(own), fixed: null },
        { id: 'card_settlement', words: 'Card or EFTPOS takings paid to the bank', side: 'in', event: 'contra', ask: null, accounts: only('card'), fixed: 'card' },
        { id: 'cash', words: 'Cash taken out of or paid into the bank', side: 'both', event: 'contra', ask: null, accounts: only('cash'), fixed: 'cash' },
        { id: 'tax_payment', words: 'Tax paid to the tax office', side: 'out', event: 'tax_payment', ask: null, accounts: [], fixed: null, head: (pack.payHeads || [])[0] || null },
        { id: 'loan_taken', words: 'A loan received', side: 'in', event: 'loan_taken', ask: 'account', accounts: loans, fixed: null },
        { id: 'loan_repaid', words: 'A loan repayment', side: 'out', event: 'loan_repaid', ask: 'account', accounts: loans, fixed: null }
      ],
      notOffered = [];
    var offered = items.filter(function (item) {
      var why = item.event === 'tax_payment' && (pack.payHeads || []).length !== 1 ? 'this country has several tax heads, so which one is paid would have to be asked; not offered' : null;
      if (!why && item.ask === 'account' && !item.accounts.length) why = 'the pack has no account to pick for it';
      if (!why && item.fixed && !item.accounts.length) why = 'the pack has no ' + item.fixed + ' account';
      if (why) notOffered.push({ id: item.id, words: item.words, why: why });
      return !why;
    });
    return { ok: true, items: offered, later: LATER_, not_offered: notOffered };
  }
  /** the event an answer makes, by the item it names: { event } or { why } (never a guessed account) */
  function eventOfKind_(item, answers, out) {
    var pick = item.fixed || (answers.account == null ? '' : String(answers.account)),
      chosen = item.accounts.filter(function (entry) {
        return entry.role === pick || entry.code === pick;
      })[0];
    if (item.event === 'tax_payment') {
      var heads = {};
      heads[item.head] = 0;
      return { event: { type: 'tax_payment', mode: 'bank', heads: heads } };
    }
    if (!chosen) return { why: 'say which account it is, from the list for "' + item.words + '"' };
    if (item.event === 'expense') return { event: { type: 'expense', class: chosen.role, paid_from: 'bank', tax_kind: answers.tax_kind } };
    if (item.event === 'other_income') return { event: { type: 'other_income', class: chosen.role, into: 'bank', tax_kind: answers.tax_kind } }; /* B5-04: money in names its tax kind too */
    if (item.event === 'contra') return { event: out ? { type: 'contra', from: 'bank', to: chosen.role || chosen.code } : { type: 'contra', from: chosen.role || chosen.code, to: 'bank' } };
    return { event: item.event === 'loan_taken' ? { type: 'loan_taken', loan: chosen.role, into: 'bank' } : { type: 'loan_repaid', loan: chosen.role, from: 'bank', principal: 0, interest: 0 } };
  }
  /** the event the owner's answers make of a line: { event } (null when no account or kind is said), or { why } when what is said is not on the closed list for this side or this pack */
  function eventOf_(answers, out, pack, opts) {
    var kind = answers.kind || (answers.account ? (out ? 'expense' : 'other_income') : null);
    if (!kind) return { event: null };
    var item = whatIsThis({ pack: pack, own_accounts: opts && opts.own_accounts }).items.filter(function (entry) {
      return entry.id === kind;
    })[0];
    if (!item) return { why: '"' + kind + '" is not on the list of answers for this country' };
    if (item.side !== 'both' && item.side !== (out ? 'out' : 'in')) return { why: '"' + item.words + '" is for money ' + (out ? 'in' : 'out') + ', and this line is money ' + (out ? 'out' : 'in') };
    return eventOfKind_(item, answers, out);
  }
  /** B5-04: a pack with ONE tax head and supply kinds gives no default tax kind to a coded line: it is asked from the pack's own supply kinds, never assumed; null when it is given or the pack asks nothing */
  function taxKindMissing_(answers, event, pack) {
    var asks = pack && typeof pack.supplyKindOf === 'function' && Array.isArray(pack.taxHeads) && pack.taxHeads.length === 1;
    return event && (event.type === 'expense' || event.type === 'other_income') && asks && !answers.tax_kind ? "say the tax kind for this line, from the pack's own list; it is never assumed" : null;
  }
  /** a line with no word that names a payee ("Account fee") cannot teach a rule, but the answer is still the owner's: the entry is composed through suggest by a ONE-LINE rule made of the narration's own words, never kept; the result says learned: false and why */
  function composeOnce_(recon, line, event, why, opts) {
    var words = (String(line.narration || '').match(/[A-Za-z0-9]+/g) || []).join(' ');
    if (!words) return { ok: false, why: why };
    var once = { id: 'once', has: words, side: null, party: null, party_name: null, label: null, event: JSON.parse(JSON.stringify(event)), source: null };
    var made = recon.suggest(line, Object.assign({}, opts, { learned: [once] }));
    if (made.event) made.why = 'your answer for this line, used once: nothing in its words names a payee to remember it by';
    return Object.assign({ taught: null, learned: false, learned_why: why }, made);
  }
  /**
   * resolve(line, answers, opts) → the proposal for a line the engine could not explain, once the owner has answered:
   *   answers { party?: id, party_name?, kind?: an id of whatIsThis(), account?: a class or account of the chart that item lists (never a new account), tax_kind?: the supply kind the owner codes it (with an account on money out) }
   *   opts    the same as suggest(): { country | pack, parties, learned, gst_basis, ... }
   * NO second calculation: the answers become ONE taught rule (bank-recon.learn) and the line goes through bank-recon.suggest, so the entry is composed by posting.post and its tax split by
   * withTax exactly as every other proposal. The result is that proposal plus `taught` (the rule to keep on the device so the next line like it is explained), or { ok: false, why } when the
   * answers name no party and no account. A narration with no word to teach by ("Account fee") with an account answered is composed the same way but teaches nothing: learned: false, learned_why.
   */
  function resolve(line, answers, opts) {
    var recon = dep_('./bank-recon', 'CBBankRecon'),
      given = answers || {},
      out = (+line.debit_minor || 0) > 0;
    var basePack = packOf_(opts),
      pack = basePack && packWith_(basePack, opts),
      made = basePack ? eventOf_(given, out, basePack, opts) : { event: null },
      event = made.event;
    if (pack && opts) opts = Object.assign({}, opts, { pack: pack });
    if (made.why) return { ok: false, why: made.why };
    if (!recon || (!event && !given.party)) return { ok: false, why: 'say which party it is, or which account it goes to' };
    var missing = taxKindMissing_(given, event, basePack);
    if (missing) return { ok: false, why: missing };
    var taught = recon.learn(line, { party: given.party, party_name: given.party_name, event: event }, Object.assign({ at: (opts && opts.at) || null, by: (opts && opts.by) || null }, opts));
    if (!taught.ok) return given.party ? { ok: false, why: taught.why } : composeOnce_(recon, line, event, taught.why, opts);
    return Object.assign({ taught: taught.rule, learned: true }, recon.suggest(line, Object.assign({}, opts, { learned: [taught.rule].concat((opts && opts.learned) || []) })));
  }
  var EXPORTS = { withTax: withTax, entryOf: entryOf, newParty: newParty, notAParty: notAParty, eventOfAnswer: eventOf_, NOT_A_PARTY_CATEGORIES: NOT_A_PARTY_.map(function (row) { return row[0]; }), whatIsThis: whatIsThis, resolve: resolve, nameKey: nameKey_ };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBBankEntry. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBBankEntry = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
