/* ADOPTED from chitbridge-engines v1.87.0 · posting · sha256 eb0b68011284ea6431c67452484533619bf23955fe104526c982608f314b0153 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · posting. Edited ONLY in chitbridge-engines/src/posting.js; every platform adopts a released version of it. */
/*
 * OWNS      the double-entry posting rules: one event in, balanced Dr/Cr lines out (refused unless debits equal credits to the minor unit), plus the walk-in day summary, tax set-off, depreciation, FX revaluation and the voucher type of an event.
 * CALLED BY the api (lib/books-engines.js posting() → lib/books.js post · voucherTypeOf, lib/books-hooks.js daySummary, lib/books-period.js depreciationFor · gstSetOff, lib/books-manual.js MODE_ACCOUNT, lib/fx-rates.js fxRevaluation); engines bank-recon.js composes its entries through post.
 * FLOW      event ──▶ post (resolveEntry_ → balancedLines_ → postedEntry_) ──▶ { ok, lines, totals }, or a refusal that names its reason
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note [BOOKS] An event in, balanced Dr/Cr lines out — refused when they do not balance to the minor unit. No
  // @stage-note storage, no clock. tests/posting.test.js includes 20,000 generated events, every one balancing.
  /**
   * posting.js — AN EVENT IN, BALANCED DEBIT/CREDIT LINES OUT (v1.7.0, 2026-09-28; v1.8.0 2026-09-29; hardened v1.8.1 2026-09-30). [SPEC-books.md, SPEC-books-v2.md §3]
   *
   * Athi, 2026-09-28: *"how do we journalise?"* — and then *"we don't claim as an accounting system until we are well
   * confident, but still record the information according to principle."* ⚠️⚠️ SO THIS IS A RECORD KEPT BY DOUBLE-ENTRY
   * PRINCIPLE, NOT ACCOUNTING SOFTWARE, and nothing built on it may be called "books of account" until Athi says so.
   *
   * ⭐ THE GOLDEN RULES, which every rule below follows (the account's type comes from accounts-packs):
   *   personal — Dr the receiver, Cr the giver        real — Dr what comes in, Cr what goes out
   *   nominal  — Dr expenses and losses, Cr incomes and gains
   *
   * ⭐ GRANULARITY (decided 2026-09-28): a WALK-IN sale is posted as ONE entry per counter per day (per payment mode, per tax
   * rate) at day close; any sale to a NAMED party — credit, a customer on the list, B2B with a tax id — is posted PER BILL,
   * because that party's account needs each bill. granularity() decides; the shop's setting only moves walk-in trade.
   *
   * ── A LINE ──  { account, dr, cr, party?, rate?, ref, rule }  — one of dr / cr is 0; amounts in the event's currency.
   * ── v1.8.0 ── a line also carries { code (4-digit), dr_minor, cr_minor, currency (FUNCTIONAL), txn_currency,
   *   amount_txn_minor, fx_rate }; the entry carries { fiscal_year, period (0 = opening), is_opening, rule }. New rules:
   *   purchase_bill, purchase_return, payment_made (cheque only when cleared), opening (difference → Suspense 2900),
   *   manual (owner, narration, must balance), credit_note (= return). write_off now needs the owner too.
   *   ⚠️ An event in a currency other than the functional one (ctx.functional, else the pack's) needs fx_rate — refused
   *   without it; conversion rounding is ONE named round-off line (fx_rounding: true), never spread over the others.
   * ⚠️⚠️ EXACT TO THE MINOR UNIT: every rule builds its lines in integers (minor units) and post() REFUSES anything whose debits do
   * not equal its credits — a journal that is off by one minor unit is refused, never rounded into balance.
   * ⭐ Every line carries `rule` = RULES_VERSION, so a line posted today can be re-derived by the same rules tomorrow.
   * ── v1.8.1 (the critic's review, 2026-09-29) — WHAT IS NOW REFUSED, each with its reason, ok: false ──
   *   H2  a date that is not a real calendar day written YYYY-MM-DD (none, a datetime, '2026-9-5', 30 Feb, month 13)
   *   H4  an amount or fx_rate that is not a finite number or a plain decimal string (Infinity, '0x10', true, [5], '1e3');
   *       an amount at or beyond 10^15 minor units (L1: past that a float drops minor units); a rate that turns a line into 0
   *   M1  an expense / other-income `class` that is not an expense / income account (it would flip the entry's sides)
   *   M2  a party on a line that is not debtors / creditors (the mirror of "required there")
   *   L3  a walk-in bill with no currency. The lines a valid event produces are UNCHANGED, so RULES_VERSION stays.
   * ⚠️ OPEN, FOR ATHI (critic L2): `credit_given from: 'cheque'` and `expense paid_from: 'cheque'` post to the bank at
   *   ISSUE — C3 (clearing) is enforced only on payment_received / payment_made. some systems post an issued cheque at issue; the
   *   house rule says clearing. Not changed here: it is a decision, not a guard.
   * ── v1.14.0 — BOOKS RULES R1–R8 (Athi, 2026-10-02: "follow the standard"; docs/design/books-rules/PLAN.md) ──
   *   NEW RULES, each a different Dr/Cr pattern the standard names (the only alternative was `manual`, owner-only, unchecked):
   *   closing_stock     lower of cost and NRV (the pack cites the standard); posts the DIFFERENCE from the books (Dr stock · Cr changes in
   *                     inventories, or the reverse). A closing stock needs its mode, `book`, and its value; AUTOMATIC is refused
   *                     (it needs quantities on hand, which the platform does not keep yet) — never guessed.
   *   loan_taken        Dr the mode · Cr a loan account.   loan_repaid  Dr loan principal · Dr interest (a finance cost) · Cr mode.
   *                     A loan needs a loan account (secured, unsecured, bank OD) — capital is not one.
   *   accrual           outstanding / prepaid / accrued_income / income_in_advance; `reverse` swaps the sides on the first day of the
   *                     next period and must name what it reverses.
   *   tax_setoff        the pack's order of set-off, by the same taxSetOff() the app calls (one calculation; gstSetOff is its older name).
   *   tax_payment       Dr output tax per head · Cr the mode (the statutory payment). Needs a head with an amount, a known mode.
   *   tax_advance       Dr the head's advance asset · Cr its output tax (cash paid above the net due; v1.87.0). Needs a pack with taxLedgers[head].advance.
   *   depreciation      Dr depreciation · Cr accumulated depreciation, per class; the amounts come from depreciationFor().
   *   asset_disposal    Dr proceeds · Dr accumulated · Cr cost · Cr output tax · the balance is profit or loss on sale.
   *   WIDENED: purchase_bill takes `accept: 'resale' (default) | 'asset' | 'use'` — resale is unchanged, so no old answer moves.
   *   BUILDERS: gstSetOff(o) and depreciationFor(o) are pure, in the daySummary pattern. Rates live in the pack (data).
   * ── v1.16.0 — OPTIONAL TAX HEADS, VOUCHER TYPES, CONTRA, THE DISHONOURED CHEQUE (Athi, 2026-10-02: "Follow the standard") ──
   *   HEADS     a tax row carries a figure per head of the pack (pack.taxHeads, in line order); an OPTIONAL head (pack.optionalHeads) is in a summary or a set-off answer only when a figure for it was handed in.
   *             The order of set-off is the pack's (pack.setOff); a set-off without an optional head is unchanged.
   *   VOUCHERS  VOUCHER_TYPE_OF (event → Sales · Purchase · Receipt · Payment · Contra · Credit note · Debit note · Journal, each choice reasoned
   *             at the table) and voucherTypeOf(event, { manual }) → { type, series }; post() returns it as `voucher`. A person's own entry is series MJ.
   *   NEW RULES contra (between cash and bank-type accounts) and cheque_dishonoured (a cleared cheque the bank returned: Dr the party · Cr Bank, + the charge).
   *   No existing event's lines change, so RULES_VERSION stays.
   * ── v1.45.0 — FOREIGN-CURRENCY TRADE (FX1, Athi 2026-10-14: "if a foreign trade provides collection in another currency how that will be handled?") ──
   *   A LINE MAY CARRY ITS OWN `txn` { currency, minor, rate } (only the two rules below set it): post() then stamps that line's txn_currency · amount_txn_minor ·
   *   fx_rate from it instead of the event's. Every rule written before sets none, so every existing line is unchanged.
   *   fx_settlement  a foreign bill received / paid: Dr the money at ITS day's rate · Cr the party at the BOOKED rate · the difference on fx_gain_loss (realised).
   *   fx_revalue     open foreign balances at the closing rate: the difference on fx_gain_loss (unrealised); `reverse` on the next period's first day.
   *   fxRevaluation(o) is the pure builder (the daySummary pattern) the to-do, the preview and the entry share. The packs name the standard and the TAX rate
   *   rule (pack.fx) — the core names neither. RULES_VERSION stays.
   */
  const RULES_VERSION =
    'posting-1.2'; /* v1.14.0: closing stock, loans, accruals, tax set-off and payment, depreciation; v1.8.0 purchases, payments made, opening, manual */

  var MONEY_ = null,
    PACKS_ = null,
    REG_ = null;
  function moneyEngine_() {
    var money = typeof CBMoney !== 'undefined' && CBMoney.round ? CBMoney : MONEY_;
    if (money === null && typeof require === 'function') {
      try {
        money = MONEY_ = require('./money');
      } catch (_) {
        money = MONEY_ = false;
      }
    }
    return money || null;
  }
  function packsEngine_() {
    var packs = typeof CBAccountsPacks !== 'undefined' && CBAccountsPacks.accountOf ? CBAccountsPacks : PACKS_;
    if (packs === null && typeof require === 'function') {
      try {
        packs = PACKS_ = require('./accounts-packs');
      } catch (_) {
        packs = PACKS_ = false;
      }
    }
    return packs || null;
  }
  function regulationEngine_() {
    var regulation = typeof CBRegulation !== 'undefined' && CBRegulation.resolve ? CBRegulation : REG_;
    if (regulation === null && typeof require === 'function') {
      try {
        regulation = REG_ = require('./regulation');
      } catch (_) {
        regulation = REG_ = false;
      }
    }
    return regulation || null;
  }
  /** the default pack, read at load by the tables below — an engine that cannot see the registry says so in plain words instead of loading empty */
  function defaultPack_() {
    var regulation = regulationEngine_(),
      defaultPack = regulation && regulation.packFor(regulation.DEFAULT);
    if (!defaultPack)
      throw new Error(
        'posting.js needs regulation.js (CBRegulation, with the India pack) loaded before it — add the regulation scripts ahead of this one on the page; see the CHANGELOG, v1.28.0.'
      );
    return defaultPack;
  }
  function decimals_(currency) {
    var money = moneyEngine_();
    return money && money.decimals ? money.decimals(currency) : 2;
  }
  /**
   * ⚠️ v1.8.1 (critic H4, L1) — WHAT COUNTS AS AN AMOUNT: a finite number, or a plain decimal string. The reading is
   * money.priceOf's (the one reader every engine shares — no second parser here); on top of it a bare object/array and an
   * exponent string are refused, because a stored amount is never written that way. Absent (null / undefined / '') = 0.
   * ⚠️ THE CEILING: 10^15 minor units. toPrecision(15) keeps 15 significant digits, so beyond it minor units are silently lost
   * (₹90071992547409.91 came back 90071992547409.90); refused by name instead.
   */
  const MINOR_CEILING = 1e15;
  function num_(value, what) {
    var money = moneyEngine_();
    if (!money || !money.priceOf) throw refuse_('Posting needs the money engine (it reads every amount).');
    var amount = (value !== null && typeof value === 'object') || (typeof value === 'string' && /[eE]/.test(value)) ? null : money.priceOf(value);
    if (amount === null) throw refuse_('Not an amount (' + what + '): ' + typeof value + ' ' + String(value).slice(0, 40) + ' — a finite number or a plain decimal string.');
    return amount;
  }
  function toMinor(amount, currency, what) {
    if (amount == null || amount === '') return 0;
    var scaled = num_(amount, what || 'an amount') * Math.pow(10, decimals_(currency));
    if (!(Math.abs(scaled) < MINOR_CEILING))
      throw refuse_('The amount ' + String(amount).slice(0, 40) + ' is beyond what this record holds exactly (10^15 minor units).');
    return Math.round(Number(scaled.toPrecision(15)));
  }
  function fromMinor(minor, currency) {
    var factor = Math.pow(10, decimals_(currency));
    return Number((minor / factor).toFixed(decimals_(currency)));
  }

  /** the rule an event type means: through the pack's eventAliases (a stored event keeps its old type name; the rule is the neutral one) */
  function ruleOf_(pack, type) {
    var aliases = pack && pack.eventAliases;
    return aliases && Object.prototype.hasOwnProperty.call(aliases, type) ? aliases[type] : type;
  }
  /** the name a pack's own accountants still use for a neutral event type, else the type itself */
  function aliasFor_(pack, neutral) {
    var aliases = (pack && pack.eventAliases) || {},
      alias = Object.keys(aliases).filter(function (item) {
        return aliases[item] === neutral;
      })[0];
    return alias || neutral;
  }
  /** how a payment mode lands: the REAL account money comes into. A cheque posts only on clearing, into the bank (C3). */
  /* the modes a payment can come in by, and the real account each lands on — the pack's (chart.paymentModes); the export is the DEFAULT pack's table, unchanged */
  const MODE_ACCOUNT = (function () {
    var defaultPack = defaultPack_();
    return (defaultPack.chart && defaultPack.chart.paymentModes) || {};
  })();
  /** own keys only: a stored mode of "constructor" or "__proto__" is an unknown mode, never an inherited function */
  function mode_(key, ctx) {
    var modes = (((ctx && ctx.pack) || {}).chart || {}).paymentModes;
    if (!modes) throw refuse_('The regulation pack names no payment modes, so no payment can be posted.');
    return Object.prototype.hasOwnProperty.call(modes, key) ? modes[key] : undefined;
  }

  /**
   * ⭐ granularity(ctx) → 'bill' | 'day' | 'shift' — how a SALE is posted.
   *   ctx: { setting: 'day' (default) | 'bill' | 'shift', party?, credit?, tax_id? (an older name of this field is still read) }
   * A named party, a credit sale or a buyer with a tax id is ALWAYS per bill: their own account needs each bill.
   */
  function granularity(ctx) {
    var given = ctx || {};
    if (given.party || given.credit || given.tax_id || given.gstin) return 'bill';
    return given.setting === 'bill' || given.setting === 'shift' ? given.setting : 'day';
  }

  /* ── the lines a rule builds, in minor units, then checked and turned into amounts ── */
  function makeLine_(account, debit, credit, extra) {
    return Object.assign({ account: account, dr: debit, cr: credit }, extra || {});
  }
  /** the pack that names the tax heads (in line order) and the ledger each lands on: pack.taxHeads, pack.taxLedgers[head].output | .input | .rcm */
  function taxPack_(ctx) {
    var pack = ctx && ctx.pack;
    if (!pack || !Array.isArray(pack.taxHeads) || !pack.taxLedgers) throw refuse_('The regulation pack names no tax heads, so no tax can be posted.');
    return pack;
  }
  /** a row of tax figures keyed by head, from a record that may carry any of them: { taxable: 0, <head>: amount … } */
  function headRow_(ctx, taxFigures) {
    var row = { taxable: 0 };
    taxPack_(ctx).taxHeads.forEach(function (item) {
      row[item] = (taxFigures || {})[item];
    });
    return row;
  }
  /** rows → lines: the base amount, then each head of the pack in ITS order, on the ledger the pack names for that head and side ('output' | 'input') */
  /** the base ledger for a row: <base>_<kind> when the pack's chart has that role (sales_zero_rated · sales_gst_free), else the base itself */
  function kindBase_(pack, base, kind) {
    if (!kind || kind === 'standard') return base;
    var role = base + '_' + kind;
    return (pack.ledgers || []).some(function (item) {
      return item && item.role === role;
    })
      ? role
      : base;
  }
  function taxLines_(rows, currency, side, prefix, ctx) {
    var pack = taxPack_(ctx),
      out = [];
    (rows || []).forEach(function (item) {
      var rate = item.rate != null ? String(item.rate) : undefined;
      var addLine = function (acct, amount) {
        var minor = toMinor(amount, currency);
        if (minor) out.push(side === 'cr' ? makeLine_(acct, 0, minor, { rate: rate }) : makeLine_(acct, minor, 0, { rate: rate }));
      };
      addLine(
        kindBase_(pack, prefix.base, item.kind),
        item.taxable
      ); /* A5 (v1.64.0): a row that names its supply kind lands on that kind's own ledger (sales_gst_free …) when the chart has one */
      pack.taxHeads.forEach(function (head) {
        var ledger = pack.taxLedgers[head][prefix.tax];
        addLine(ledger === null && prefix.tax === 'input' ? prefix.base : ledger, item[head]);
      }); /* A2 (v1.58.0): no input credit → the tax is part of the cost */
    });
    return out;
  }
  function modeLines_(modes, currency, side, ctx) {
    var out = [];
    Object.keys(modes || {}).forEach(function (key) {
      var acct = mode_(key, ctx);
      var minor = toMinor(modes[key], currency);
      if (!minor) return;
      out.push(side === 'dr' ? makeLine_(acct || '?' + key, minor, 0) : makeLine_(acct || '?' + key, 0, minor));
    });
    return out;
  }
  /**
   * round_off = what was CHARGED minus what the lines add up to. Rounded UP (₹9.99 billed as ₹10) the shop collected the
   * extra minor unit: Cr round off. Rounded DOWN it gave a minor unit away: Dr round off. (The walk-in test caught this sign wrong.)
   */
  function roundOff_(value, currency) {
    var minor = toMinor(value, currency);
    if (!minor) return [];
    return minor > 0 ? [makeLine_('round_off', 0, minor)] : [makeLine_('round_off', -minor, 0)];
  }
  /** a purchase rounded UP means the shop PAID the extra minor unit: Dr round off (the mirror of a sale) */
  function roundOffPaid_(value, currency) {
    var minor = toMinor(value, currency);
    if (!minor) return [];
    return minor > 0 ? [makeLine_('round_off', minor, 0)] : [makeLine_('round_off', 0, -minor)];
  }
  /** lines handed in whole (opening, manual): { account, dr?, cr?, party? } → minor-unit lines */
  function givenLines_(rows, currency) {
    return (rows || []).map(function (item) {
      var debit = toMinor(item.dr || 0, currency),
        credit = toMinor(item.cr || 0, currency);
      return makeLine_(String(item.account == null ? '' : item.account), debit, credit, item.party ? { party: item.party } : null);
    });
  }
  /**
   * v1.8.1 (critic M1) — the `class` of an expense / other income must BE one: accountOf(...).kind 'expense_class' /
   * 'income_class'; or a ledger that is also listed as such a class (interest_received 4200 is both — accountOf finds the
   * ledger first); or a ledger the SHOP added (role null) under an expense / income group. Anything else — sales, capital,
   * output tax, cash — would flip the entry's sides while still being labelled an expense, and is refused by name.
   */
  function classOf_(ctx, accountClass, want) {
    if (!ctx || !ctx.pack || !ctx.P) return;
    var account = ctx.P.accountOf(ctx.pack, accountClass);
    if (!account) return; /* not in the chart: post() refuses it by name */
    var list = (want === 'expense' ? ctx.pack.expense_classes : ctx.pack.income_classes) || [];
    if (!isClassOfKind_(account, want, list))
      throw refuse_(
        '"' +
          String(accountClass).slice(0, 40) +
          '" (' +
          account.code +
          ' ' +
          account.name +
          ') is not an ' +
          want +
          ' class — posting ' +
          (want === 'expense' ? 'an expense' : 'other income') +
          " to it would flip the entry's sides."
      );
  }
  /** is this account an expense / income class (`want`): the class itself, a ledger listed as one, or a ledger the shop added under an expense / income group */
  function isClassOfKind_(account, want, list) {
    return (
      account.kind === want + '_class' ||
      (account.kind === 'ledger' &&
        account.role != null &&
        list.some(function (item) {
          return item.role === account.role;
        })) ||
      (account.kind === 'ledger' && account.role == null && account.nature === want && account.statement === 'pl')
    );
  }
  /** a closing stock's mode, its book value and its cost formula: the checks that run before any amount is read */
  function checkClosingStockInputs_(e, ctx) {
    if (e.mode === 'automatic')
      throw refuse_(
        "Automatic closing stock needs quantities on hand, which the platform does not keep yet (inventory lifecycle: designed, not built) — enter the closing value (mode: 'manual')."
      );
    if (e.mode !== 'manual') throw refuse_("A closing stock needs its mode — 'manual' or 'automatic' (the shop setting).");
    if (e.book == null || e.book === '')
      throw refuse_('A closing stock needs `book` — the stock on the books before it (balanceAsAt on Stock-in-hand); it is never assumed.');
    if (e.method != null && e.method !== 'fifo' && e.method !== 'weighted_average')
      throw refuse_('A cost formula is FIFO or weighted average (' + ctx.pack.cite.inventoryFormula + ').');
  }
  /** a closing stock's value and the stock on the books, in minor units: the amount handed in, or the lower of cost and NRV (refused when they disagree) */
  function closingStockFigures_(e, currency, ctx) {
    var hasCost = e.cost != null && e.cost !== '',
      hasNrv = e.nrv != null && e.nrv !== '',
      hasAmt = e.amount != null && e.amount !== '';
    if (!hasAmt && !(hasCost && hasNrv)) throw refuse_('A closing stock needs its value — amount, or cost and nrv.');
    var value = hasAmt ? toMinor(e.amount, currency) : null,
      book = toMinor(e.book, currency);
    if (hasCost && hasNrv) value = lowerOfCostNrvValue_(value, e, currency, ctx);
    return { value: value, book: book };
  }
  /** the lower of cost and net realisable value, in minor units; a value handed in that is not it is refused by name */
  function lowerOfCostNrvValue_(value, e, currency, ctx) {
    var costMinor = toMinor(e.cost, currency),
      nrvMinor = toMinor(e.nrv, currency),
      lowerOfCostNrv = Math.min(costMinor, nrvMinor);
    if (value !== null && value !== lowerOfCostNrv)
      throw refuse_(
        'A closing stock is valued at the lower of cost and net realisable value (' +
          ctx.pack.cite.lowerOfCostNrv +
          ') — ' +
          fromMinor(value, currency) +
          ' is ' +
          (value > lowerOfCostNrv ? 'above' : 'not') +
          ' ' +
          (nrvMinor <= costMinor ? 'NRV ' + fromMinor(nrvMinor, currency) : 'cost ' + fromMinor(costMinor, currency)) +
          '.'
      );
    return lowerOfCostNrv;
  }
  function owner_(e) {
    if (e.owner !== true) throw refuse_('Only the owner may post a ' + String(e.type).replace('_', ' ') + '.');
  }

  const RULES = {
    /** walk-in trade of one counter for one day (or shift): Dr each payment mode · Cr sales per rate · Cr output tax */
    walkin_day: function (e, currency, ctx) {
      return modeLines_(e.modes, currency, 'dr', ctx).concat(taxLines_(e.by_rate, currency, 'cr', { base: 'sales', tax: 'output' }, ctx), roundOff_(e.round_off, currency));
    },
    /**
     * a sale to a named party, per bill: Dr the party for what is unpaid · Dr any mode paid at the till · Cr sales · Cr tax.
     * (L11) An OVER-paid bill lands Cr debtors — the party is in credit on its own account. The chart's
     * customer_advance 2400 / supplier_advance 1700 are not used by any rule; an advance is a payment_received sitting on account.
     */
    sale_bill: function (e, currency, ctx) {
      var credit = taxLines_(e.by_rate, currency, 'cr', { base: 'sales', tax: 'output' }, ctx);
      var paid = modeLines_(e.paid, currency, 'dr', ctx),
        rOff = roundOff_(e.round_off, currency);
      var owed = sum_(credit, 'cr') - sum_(paid, 'dr') - sum_(rOff, 'dr') + sum_(rOff, 'cr');
      var lines = paid.concat(credit, rOff);
      if (owed) lines.unshift(owed > 0 ? makeLine_('debtors', owed, 0, { party: e.party }) : makeLine_('debtors', 0, -owed, { party: e.party }));
      return lines;
    },
    /** a payment received: Dr where the money came in · Cr the party. A cheque only once CLEARED (C3). */
    payment_received: function (e, currency, ctx) {
      if (e.mode === 'cheque' && e.cheque_status !== 'cleared')
        throw refuse_('A cheque is posted when it CLEARS, not when it is received (it is ' + (e.cheque_status || 'received') + ').');
      var acct = mode_(e.mode, ctx);
      if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
      var minor = toMinor(e.amount, currency);
      return [makeLine_(acct, minor, 0), makeLine_('debtors', 0, minor, { party: e.party })];
    },
    /** credit given with no sale (D2): Dr the party · Cr the cash or bank it left from. No tax — nothing was sold. */
    credit_given: function (e, currency, ctx) {
      var acct = mode_(e.from || 'cash', ctx);
      if (!acct) throw refuse_('Unknown source "' + e.from + '".');
      var minor = toMinor(e.amount, currency);
      return [makeLine_('debtors', minor, 0, { party: e.party }), makeLine_(acct, 0, minor)];
    },
    /** an expense by class: Dr the class (+ input tax) · Cr what paid it — a mode, or the supplier when on credit */
    expense: function (e, currency, ctx) {
      classOf_(ctx, e.class, 'expense');
      var list = [makeLine_(e.class, toMinor(e.amount, currency), 0)].concat(
        taxLines_(e.input_tax ? [Object.assign({ taxable: 0 }, e.input_tax)] : [], currency, 'dr', { base: e.class, tax: 'input' }, ctx).filter(function (item) {
          return item.account !== e.class;
        })
      );
      var total = sum_(list, 'dr');
      var creditLines = e.supplier ? [makeLine_('creditors', 0, total, { party: e.supplier })] : [makeLine_(mode_(e.paid_from || 'cash', ctx) || '?' + e.paid_from, 0, total)];
      return list.concat(creditLines);
    },
    /** other income by class: Dr where it came in · Cr the class */
    other_income: function (e, currency, ctx) {
      classOf_(ctx, e.class, 'income');
      var minor = toMinor(e.amount, currency);
      return [makeLine_(mode_(e.into || 'cash', ctx) || '?' + e.into, minor, 0), makeLine_(e.class, 0, minor)];
    },
    /**
     * a return / credit note: Dr sales returns per rate · Dr output tax back · Cr the party, or Cr the mode refunded.
     * (L13) ONE or the other: a return partly refunded in cash and partly credited has no rule yet and is refused as
     * unbalanced — post it as two events (a return credited + a payment made back), or as a manual entry.
     */
    return: function (e, currency, ctx) {
      var debitLines = taxLines_(e.by_rate, currency, 'dr', { base: 'sales_returns', tax: 'output' }, ctx);
      var total = sum_(debitLines, 'dr');
      var creditLines = e.party && !e.refund ? [makeLine_('debtors', 0, total, { party: e.party })] : modeLines_(e.refund, currency, 'cr', ctx);
      /* ACC-283: a cash refund rounded to the pack's step (A$68.98 note, A$69.00 refunded) is a minor unit given away: Dr round off (roundOffPaid_, the mirror of a sale's Cr). No round_off, no line, as before. */
      return debitLines.concat(roundOffPaid_(e.round_off, currency), creditLines);
    },
    /** a write-off (owner only, with a reason): Dr bad debts · Cr the party */
    write_off: function (e, currency) {
      owner_(e);
      if (!String(e.reason || '').trim()) throw refuse_('A write-off needs a reason.');
      var minor = toMinor(e.amount, currency);
      return [makeLine_('bad_debts', minor, 0), makeLine_('debtors', 0, minor, { party: e.party })];
    },
    /** a credit note is a return by another name (the document a tax return lists) */
    credit_note: function (e, currency, ctx) {
      return RULES.return(e, currency, ctx);
    },
    /**
     * ACC-192 slice 2 — a debit note (a price raised after issue, the note the pack's law names) is an extra sale by another name: sale_bill's lines exactly (Dr the party · Cr sales · Cr output tax),
     * the original entry untouched. The api posts it insert-only with source_ref chit:<id> and against_bill (the original's ref); the BUYER posts purchase_bill with against_ref. A pack with no such note (its pack says so) never gets one.
     */
    debit_note: function (e, currency, ctx) {
      return RULES.sale_bill(e, currency, ctx);
    },
    /** a purchase, per bill: Dr purchases per rate · Dr input tax · Cr any mode paid · Cr the supplier for the rest */
    purchase_bill: function (e, currency, ctx) {
      var base = purchaseBase_(e, ctx),
        debitLines = taxLines_(e.by_rate, currency, 'dr', { base: base, tax: 'input' }, ctx),
        rOff = roundOffPaid_(e.round_off, currency);
      var reverseCharge = rcmLines_(e.rcm, currency, base, ctx); /* v1.20.0: reverse charge — the buyer's own tax, never the supplier's */
      var paid = modeLines_(e.paid, currency, 'cr', ctx);
      var owed = sum_(debitLines, 'dr') + sum_(reverseCharge.dr, 'dr') + sum_(rOff, 'dr') - sum_(rOff, 'cr') - sum_(paid, 'cr') - sum_(reverseCharge.cr, 'cr');
      var lines = debitLines.concat(reverseCharge.dr, rOff, paid, reverseCharge.cr);
      if (owed) lines.push(owed > 0 ? makeLine_('creditors', 0, owed, { party: e.party }) : makeLine_('creditors', -owed, 0, { party: e.party }));
      return lines;
    },
    /** goods sent back to a supplier: Dr the supplier (or the mode refunded) · Cr purchase returns per rate · Cr input tax back */
    purchase_return: function (e, currency, ctx) {
      var creditLines = taxLines_(e.by_rate, currency, 'cr', { base: 'purchase_returns', tax: 'input' }, ctx);
      var total = sum_(creditLines, 'cr');
      var debitLines = e.party && !e.refund ? [makeLine_('creditors', total, 0, { party: e.party })] : modeLines_(e.refund, currency, 'dr', ctx);
      /* ACC-283: the supplier's cash refund rounded to the step is a minor unit RECEIVED: Cr round off (roundOff_, as a sale). */
      return debitLines.concat(creditLines, roundOff_(e.round_off, currency));
    },
    /** a payment made to a supplier: Dr the supplier · Cr where it left from. A cheque only once CLEARED (C3). */
    payment_made: function (e, currency, ctx) {
      if (e.mode === 'cheque' && e.cheque_status !== 'cleared')
        throw refuse_('A cheque is posted when it CLEARS, not when it is issued (it is ' + (e.cheque_status || 'issued') + ').');
      var acct = mode_(e.mode, ctx);
      if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
      var minor = toMinor(e.amount, currency);
      return [makeLine_('creditors', minor, 0, { party: e.party }), makeLine_(acct, 0, minor)];
    },
    /**
     * v1.14.0 R1 — a closing stock: the stock account is brought to the VALUE counted, so it always holds the latest valuation and
     * `changes_in_inventories` holds opening − closing for any period. Dr stock · Cr changes (value above the books), or the reverse.
     */
    closing_stock: function (e, currency, ctx) {
      checkClosingStockInputs_(e, ctx);
      var figures = closingStockFigures_(e, currency, ctx),
        value = figures.value,
        book = figures.book;
      if (value < 0 || book < 0) throw refuse_('A closing stock value is never negative.');
      var difference = value - book;
      if (!difference) throw refuse_('The stock on the books (' + fromMinor(book, currency) + ') already equals the closing value — nothing to post.');
      return difference > 0 ? [makeLine_('stock', difference, 0), makeLine_('changes_in_inventories', 0, difference)] : [makeLine_('changes_in_inventories', -difference, 0), makeLine_('stock', 0, -difference)];
    },
    /** v1.14.0 R5 — a loan taken: Dr where the money came in · Cr the loan account */
    loan_taken: function (e, currency, ctx) {
      var loan = loanOf_(ctx, e.loan),
        acct = mode_(e.into || 'bank', ctx);
      if (!acct) throw refuse_('Unknown payment mode "' + e.into + '".');
      var minor = toMinor(e.amount, currency);
      return [makeLine_(acct, minor, 0), makeLine_(loan, 0, minor)];
    },
    /** v1.14.0 R5 — a repayment: Dr the loan (principal) · Dr interest on loans (a finance cost) · Cr where it left from. A cheque only once CLEARED (C3). */
    loan_repaid: function (e, currency, ctx) {
      var loan = loanOf_(ctx, e.loan),
        from = e.from || 'bank';
      if (from === 'cheque' && e.cheque_status !== 'cleared')
        throw refuse_('A cheque is posted when it CLEARS, not when it is issued (it is ' + (e.cheque_status || 'issued') + ').');
      var acct = mode_(from, ctx);
      if (!acct) throw refuse_('Unknown payment mode "' + from + '".');
      var principal = toMinor(e.principal, currency),
        interest = toMinor(e.interest, currency);
      if (!principal && !interest) throw refuse_('A repayment needs a principal or interest.');
      var lines = [];
      if (principal) lines.push(makeLine_(loan, principal, 0));
      if (interest) lines.push(makeLine_('interest_paid', interest, 0));
      return lines.concat([makeLine_(acct, 0, principal + interest)]);
    },
    /**
     * v1.14.0 R6 — an accrual at a period end (an expense belongs to the period it was incurred in). `reverse: true` swaps every
     * line's side — posted on the first day of the next period, so the real bill posts normally. Names what it reverses.
     */
    accrual: function (e, currency, ctx) {
      var kinds = { outstanding: 'expense', prepaid: 'expense', accrued_income: 'income', income_in_advance: 'income' };
      if (!Object.prototype.hasOwnProperty.call(kinds, e.kind)) throw refuse_('An accrual is outstanding, prepaid, accrued_income or income_in_advance.');
      if (e.reverse && !String(e.reverses || '').trim()) throw refuse_('A reversal names the accrual it reverses (reverses: its ref).');
      classOf_(ctx, e.class, kinds[e.kind]);
      var minor = toMinor(e.amount, currency),
        account = ctx && ctx.pack && ctx.P ? ctx.P.accountOf(ctx.pack, e.class) : null;
      var payable = ctx.pack.accrualPayableFor(account);
      var lines = accrualLines_(e, minor, payable);
      return e.reverse
        ? lines.map(function (item) {
            return makeLine_(item.account, item.cr, item.dr);
          })
        : lines;
    },
    /** v1.14.0 R3 — the set-off of tax credit against tax owed, in the order the pack's law gives (taxSetOff): Dr output_<against> · Cr input_<from> */
    tax_setoff: function (e, currency, ctx) {
      var pack = taxPack_(ctx),
        setOff = taxSetOff_(pack, e.output, e.input, currency);
      if (!setOff.utilised.length) throw refuse_(pack.messages.nothingToSetOff);
      var lines = [];
      setOff.utilised.forEach(function (item) {
        lines.push(makeLine_(pack.taxLedgers[item.against].output, item.amount, 0), makeLine_(pack.taxLedgers[item.from].input, 0, item.amount));
      });
      return lines;
    },
    /** v1.14.0 R3 — the statutory payment: Dr output tax per head · Cr where it was paid from. A cheque only once CLEARED. */
    tax_payment: function (e, currency, ctx) {
      var pack = taxPack_(ctx),
        heads = e.heads && typeof e.heads === 'object' ? e.heads : {},
        rcmHeads = rcmHeads_(pack);
      Object.keys(heads).forEach(function (item) {
        if (pack.payHeads.indexOf(item) < 0) throw refuse_(pack.messages.payHeadUnknown);
      });
      if (e.mode === 'cheque' && e.cheque_status !== 'cleared')
        throw refuse_('A cheque is posted when it CLEARS, not when it is issued (it is ' + (e.cheque_status || 'issued') + ').');
      var acct = mode_(e.mode, ctx);
      if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
      var lines = [],
        total = 0,
        reverseCharge = e.rcm && typeof e.rcm === 'object' ? e.rcm : {};
      Object.keys(reverseCharge).forEach(function (item) {
        if (rcmHeads.indexOf(item) < 0) throw refuse_(pack.messages.rcmHeadUnknown);
      });
      pack.payHeads.forEach(function (item) {
        var minor = toMinor(heads[item], currency);
        if (minor) {
          lines.push(makeLine_(pack.taxLedgers[item].output, minor, 0));
          total += minor;
        }
      });
      /* v1.20.0: the reverse-charge liability is paid by this payment, in cash — Dr the head's reverse-charge ledger */
      rcmHeads.forEach(function (item) {
        var minor = toMinor(reverseCharge[item], currency);
        if (minor) {
          lines.push(makeLine_(pack.taxLedgers[item].rcm, minor, 0));
          total += minor;
        }
      });
      if (!total) throw refuse_(pack.messages.paymentEmpty);
      return lines.concat([makeLine_(acct, 0, total)]);
    },
    /**
     * v1.87.0 (ACC-336) R3 — tax paid ABOVE what the period owes is held per head in the pack's own asset, never as input credit: Dr the head's `advance` ledger · Cr the head's
     * output tax. It clears the debit a payment left on the output head once the set-off had used the credit (the cash already left the bank). The rule reads only the pack's
     * `taxLedgers[head].advance`; a pack without it refuses in the pack's words (messages.noAdvanceRole), a neutral sentence when the pack has none. Nothing is computed here: the
     * caller hands the amount per head, from the stored payments.
     */
    tax_advance: function (e, currency, ctx) {
      var pack = taxPack_(ctx),
        heads = e.heads && typeof e.heads === 'object' ? e.heads : {},
        words = pack.messages || {},
        lines = [];
      Object.keys(heads).forEach(function (item) {
        if (pack.payHeads.indexOf(item) < 0) throw refuse_(words.payHeadUnknown || 'That is not a tax head of this country.');
      });
      pack.payHeads.forEach(function (item) {
        var minor = toMinor(heads[item], currency);
        if (!minor) return;
        var ledgers = pack.taxLedgers[item] || {};
        if (!ledgers.advance) throw refuse_(words.noAdvanceRole || "This country's tax has no account for tax paid in advance yet.");
        lines.push(makeLine_(ledgers.advance, minor, 0), makeLine_(ledgers.output, 0, minor));
      });
      if (!lines.length) throw refuse_(words.advanceEmpty || 'A tax paid in advance needs a head with an amount.');
      return lines;
    },
    /** v1.14.0 R2 — depreciation by class: Dr depreciation · Cr that class's accumulated depreciation (amounts from depreciationFor) */
    depreciation: function (e, currency, ctx) {
      var rows = Array.isArray(e.by_class) ? e.by_class : [];
      if (!rows.length) throw refuse_('A depreciation entry needs at least one class with an amount.');
      var lines = [];
      rows.forEach(function (item) {
        var assetClass = assetClass_(ctx, item && item.class),
          minor = toMinor(item.amount, currency);
        if (!(minor > 0)) throw refuse_('The depreciation of "' + assetClass.class + '" needs an amount above nothing.');
        lines.push(makeLine_('depreciation', minor, 0), makeLine_(assetClass.acc_role, 0, minor));
      });
      return lines;
    },
    /**
     * v1.14.0 R2 — an asset sold or scrapped: Dr where the proceeds came in (or the buyer) + tax · Dr accumulated depreciation ·
     * Cr the asset's cost · Cr output tax · the balance is the profit (Cr) or loss (Dr) on sale.
     */
    asset_disposal: function (e, currency, ctx) {
      var assetClass = assetClass_(ctx, e.asset_class),
        cost = toMinor(e.cost, currency),
        accumulated = toMinor(e.accumulated, currency),
        proceeds = toMinor(e.proceeds, currency);
      if (accumulated > cost) throw refuse_('The accumulated depreciation (' + fromMinor(accumulated, currency) + ") is above the asset's cost (" + fromMinor(cost, currency) + ').');
      var taxLines = taxLines_([headRow_(ctx, e.tax)], currency, 'cr', { base: 'sales', tax: 'output' }, ctx).filter(function (item) {
        return item.account !== 'sales';
      });
      var amountDue = proceeds + sum_(taxLines, 'cr'),
        lines = [];
      var from = e.party ? makeLine_('debtors', amountDue, 0, { party: e.party }) : makeLine_(mode_(e.into || 'cash', ctx) || '?' + e.into, amountDue, 0);
      if (amountDue) lines.push(from);
      if (accumulated) lines.push(makeLine_(assetClass.acc_role, accumulated, 0));
      lines.push(makeLine_(assetClass.cost_role, 0, cost));
      lines = lines.concat(taxLines);
      var gain = proceeds + accumulated - cost;
      if (gain > 0) lines.push(makeLine_('gain_on_disposal', 0, gain));
      else if (gain < 0) lines.push(makeLine_('loss_on_disposal', -gain, 0));
      return lines;
    },
    /**
     * opening balances (period 0): the lines as handed in; whatever does not balance goes to Suspense (2900), which must be
     * nil before the year can close (the opening-difference account).
     */
    opening: function (e, currency) {
      var lines = givenLines_(e.lines, currency);
      var diff = sum_(lines, 'dr') - sum_(lines, 'cr');
      if (diff) lines.push(diff > 0 ? makeLine_('suspense', 0, diff) : makeLine_('suspense', -diff, 0));
      return lines;
    },
    /**
     * v1.16.0 (year-journey gap 2) — a cheque that CLEARED and was later returned by the bank: Dr the party (the bill is owed again) ·
     * Cr Bank for the amount, and a bank charge: Dr bank charges · Cr Bank. It must name the receipt it reverses (`reverses`: that
     * payment_received's ref) — the books-side partner of receivables.reverseItems(items, reverses, date), which reopens the bill.
     * A cheque that bounced BEFORE clearing never posted (C3), so it has nothing to reverse and no event.
     */
    cheque_dishonoured: function (e, currency) {
      if (!String(e.reverses || '').trim()) throw refuse_('A dishonoured cheque names the receipt it reverses (reverses: the payment_received ref).');
      var minor = toMinor(e.amount, currency),
        charge = toMinor(e.charge, currency);
      if (!(minor > 0)) throw refuse_('A dishonoured cheque needs the amount it was for.');
      if (charge < 0) throw refuse_('A bank charge is never negative.');
      var lines = [makeLine_('debtors', minor, 0, { party: e.party }), makeLine_('bank', 0, minor)];
      if (charge) lines.push(makeLine_('bank_charges', charge, 0), makeLine_('bank', 0, charge));
      return lines;
    },
    /**
     * v1.16.0 — a CONTRA (a Contra voucher): money moved between the shop's own cash and bank-type accounts (the pack's cash, bank and
     * settlement accounts): Dr where it went · Cr where it came from. No party, no tax; the same account on both sides is refused.
     */
    contra: function (e, currency, ctx) {
      var to = cashBank_(ctx, e.to, 'to'),
        from = cashBank_(ctx, e.from, 'from');
      if (to === from) throw refuse_('A contra moves money between two different accounts (both are ' + to + ').');
      var minor = toMinor(e.amount, currency);
      return [makeLine_(to, minor, 0), makeLine_(from, 0, minor)];
    },
    /**
     * v1.45.0 (FX1) — A FOREIGN BILL SETTLED (the pack's fx.standard — settlement differences to profit or loss): the receipt or payment at the rate of ITS day, the party's balance taken off
     * at the rate the bill was booked at, and the difference to ONE named ledger, fx_gain_loss — a realised exchange gain or loss. Posted in the books'
     * (functional) currency; every line keeps its own transaction currency, amount and rate (`txn`), so the party's foreign balance is the sum of its lines.
     *   { side: receivable | payable, party, mode, txn_currency, amount_txn, rate | amount (what came in / went out, in the books' currency), book_rate | carrying }
     */
    fx_settlement: function (e, currency, ctx) {
      var settlement = fxSettle_(e, currency, ctx),
        partyField = { party: e.party };
      var party =
        e.side === 'payable'
          ? makeLine_('creditors', settlement.carry, 0, Object.assign({ txn: settlement.carryTxn }, partyField))
          : makeLine_('debtors', 0, settlement.carry, Object.assign({ txn: settlement.carryTxn }, partyField));
      var money =
        e.side === 'payable'
          ? makeLine_(settlement.acct, 0, settlement.money, settlement.moneyTxn ? { txn: settlement.moneyTxn } : null)
          : makeLine_(settlement.acct, settlement.money, 0, settlement.moneyTxn ? { txn: settlement.moneyTxn } : null);
      var lines = e.side === 'payable' ? [party, money] : [money, party];
      var gain = e.side === 'payable' ? settlement.carry - settlement.money : settlement.money - settlement.carry; /* + = a gain: more came in (or less went out) than the books carried */
      if (gain) lines.push(gain > 0 ? makeLine_('fx_gain_loss', 0, gain) : makeLine_('fx_gain_loss', -gain, 0));
      return lines;
    },
    /**
     * v1.45.0 (FX1) — PERIOD-END REVALUATION (the pack's fx.standard — monetary items at the closing rate): each open foreign monetary balance (a party's receivable / payable, a foreign bank) retranslated at the
     * CLOSING rate; the difference from what the books carry is an UNREALISED gain or loss on fx_gain_loss. `reverse` swaps the sides on the next period's first
     * day and names what it reverses (the accrual pattern). The rows are fxRevaluation()'s — one calculation.
     *   { rates: { USD: 84.1 … }, items: [{ account, party?, txn_currency, balance_txn (signed, + = Dr), carrying (signed, + = Dr, books' currency) }], reverse?, reverses? }
     */
    fx_revalue: function (e, currency, ctx) {
      if (e.reverse && !String(e.reverses || '').trim()) throw refuse_('A reversal names the revaluation it reverses (reverses: its ref).');
      if (ctx.functional && currency !== ctx.functional) throw refuse_("A revaluation is posted in the books' currency (" + ctx.functional + ').');
      var revaluation = revalueRows_(e.items, e.rates, currency, ctx, e.date);
      if (revaluation.missing.length) throw refuse_(revaluation.missing[0]);
      var lines = [];
      revaluation.rows.forEach(function (x) {
        if (!x.diff_minor) return;
        var extra = { txn: { currency: x.txn_currency, minor: 0, rate: x.rate } };
        if (x.party) extra.party = x.party;
        var minor = Math.abs(x.diff_minor),
          isDebit = x.diff_minor > 0;
        lines.push(isDebit ? makeLine_(x.account, minor, 0, extra) : makeLine_(x.account, 0, minor, extra), isDebit ? makeLine_('fx_gain_loss', 0, minor) : makeLine_('fx_gain_loss', minor, 0));
      });
      return e.reverse
        ? lines.map(function (item) {
            return Object.assign({}, item, { dr: item.cr, cr: item.dr });
          })
        : lines;
    },
    /**
     * a manual journal entry (owner only, with a narration): the lines as handed in, which must balance exactly.
     * (L12) It may name ANY account in the chart, retained 3900 included — some systems block direct postings to the profit account;
     * here the owner-only door and the narration are the guard. Noted, not refused.
     */
    manual: function (e, currency) {
      owner_(e);
      if (!String(e.narration || '').trim()) throw refuse_('A manual entry needs a narration — what it is for.');
      return givenLines_(e.lines, currency);
    }
  };
  /* ── v1.14.0 helpers: the loan account, the asset class, the base of a purchase, the tax heads ── */
  /** the two lines of an accrual by its kind: outstanding / prepaid expense, accrued income, income in advance */
  function accrualLines_(e, minor, payable) {
    return e.kind === 'outstanding'
      ? [makeLine_(e.class, minor, 0), makeLine_(payable, 0, minor)]
      : e.kind === 'prepaid'
        ? [makeLine_('prepaid_expenses', minor, 0), makeLine_(e.class, 0, minor)]
        : e.kind === 'accrued_income'
          ? [makeLine_('accrued_income', minor, 0), makeLine_(e.class, 0, minor)]
          : [makeLine_(e.class, minor, 0), makeLine_('income_in_advance', 0, minor)];
  }
  /** v1.16.0: a contra's two ends — a payment mode (the pack's: cash, bank …, cheque→bank) or a ledger of the shop's under Cash-in-Hand / Bank Accounts */
  function cashBank_(ctx, x, side) {
    var key = x == null ? '' : String(x),
      acct = mode_(key, ctx),
      kinds = ctx.pack.chart.kinds;
    if (acct) return acct;
    var account = ctx && ctx.pack && ctx.P && key ? ctx.P.accountOf(ctx.pack, key) : null;
    if (isCashOrBankLedger_(account, kinds)) return account.role || account.code;
    throw refuse_(
      'A contra ' +
        side +
        ' is ' +
        Object.keys(ctx.pack.chart.paymentModes)
          .filter(function (item) {
            return item !== 'cheque';
          })
          .join(', ') +
        ' or a cash / bank ledger — "' +
        key.slice(0, 40) +
        '" is not.'
    );
  }
  /** a ledger of the shop's under Cash-in-Hand or Bank Accounts */
  function isCashOrBankLedger_(account, kinds) {
    return account && account.kind === 'ledger' && (account.group === kinds.cash || account.group === kinds.bank);
  }
  /** the heads of the pack that have a reverse-charge ledger, in the pack's order */
  function rcmHeads_(pack) {
    return pack.taxHeads.filter(function (item) {
      return !!pack.taxLedgers[item].rcm;
    });
  }
  /**
   * v1.20.0 — REVERSE CHARGE ON A PURCHASE. `rows` are the tax engine's `moneyOf(inv).rcm.rows` ({ rate, itc, <a figure per head> }): the tax is the
   * BUYER's, computed once when the bill was assessed and read here. Per head: Cr its reverse-charge ledger (the liability) and Dr its input ledger when the credit
   * is allowed — or Dr the same base account as the bill when it is not (the tax is then a cost). The supplier is credited WITHOUT it (the caller
   * nets it out of `owed`). Each row must say itc true or false — never guessed; a head the pack has no reverse-charge ledger for is refused by name.
   */
  function rcmLines_(rows, currency, base, ctx) {
    var pack = taxPack_(ctx),
      heads = rcmHeads_(pack),
      out = { dr: [], cr: [] };
    if (rows == null || (Array.isArray(rows) && !rows.length)) return out;
    if (!Array.isArray(rows)) throw refuse_('rcm is a list of rows { rate, itc, ' + heads.join(', ') + ' } (tax.moneyOf(inv).rcm.rows).');
    rows.forEach(function (item, index) {
      if (!item || typeof item !== 'object') throw refuse_('rcm row ' + (index + 1) + ' is not a row.');
      if (item.itc !== true && item.itc !== false)
        throw refuse_('rcm row ' + (index + 1) + ' must say itc: true or false — whether the credit is allowed is never guessed.');
      pack.taxHeads.forEach(function (head) {
        if (heads.indexOf(head) < 0 && toMinor(item[head], currency))
          throw refuse_((pack.messages.rcmNotBuilt || {})[head] || 'Reverse charge on ' + head + ' is not built in this pack.');
      });
      var rate = item.rate != null ? String(item.rate) : undefined;
      heads.forEach(function (head) {
        var minor = toMinor(item[head], currency);
        if (!minor) return;
        out.dr.push(
          makeLine_(item.itc && pack.taxLedgers[head].input ? pack.taxLedgers[head].input : base, minor, 0, { rate: rate })
        ); /* no input ledger: the reverse-charge tax is a cost */
        out.cr.push(makeLine_(pack.taxLedgers[head].rcm, 0, minor, { rate: rate }));
      });
    });
    return out;
  }
  function loanOf_(ctx, loan) {
    var account = ctx && ctx.pack && ctx.P ? ctx.P.accountOf(ctx.pack, loan) : null;
    if (!account || ctx.pack.chart.kinds.loans.indexOf(account.group) < 0)
      throw refuse_(
        'A loan needs a loan account (Secured loans, Unsecured loans, Bank OD) — "' +
          String(loan == null ? '' : loan).slice(0, 40) +
          '"' +
          (account ? ' is ' + account.code + ' ' + account.name : ' is not in the chart') +
          '.'
      );
    return account.role || account.code;
  }
  /** the pack's asset classes (pack.depreciation.assetClasses), as the names a message lists: buildings, plant … */
  function classNames_(ctx) {
    return ((((ctx && ctx.pack) || {}).depreciation || {}).assetClasses || [])
      .map(function (item) {
        return item.class;
      })
      .join(', ');
  }
  function assetClass_(ctx, className) {
    var list = (((ctx && ctx.pack) || {}).depreciation || {}).assetClasses || [],
      found = null;
    list.forEach(function (item) {
      if (found === null && item.class === className) found = item;
    });
    if (!found)
      throw refuse_(
        className == null || className === ''
          ? 'An asset needs its asset_class (' + classNames_(ctx) + ').'
          : 'There is no asset class "' + String(className).slice(0, 40) + '" in the pack.'
      );
    return found;
  }
  /** where a purchase bill's base amount lands: resale → purchases (as ever) · asset → the class's cost ledger · use → an expense class */
  function purchaseBase_(e, ctx) {
    var accept = e.accept == null || e.accept === '' ? 'resale' : e.accept;
    if (accept === 'resale') return 'purchases';
    if (accept === 'asset') {
      if (e.asset_class == null || e.asset_class === '') throw refuse_('A bill accepted as an asset needs its asset_class (' + classNames_(ctx) + ').');
      return assetClass_(ctx, e.asset_class).cost_role;
    }
    if (accept === 'use') {
      if (e.class == null || e.class === '') throw refuse_('A bill accepted for use needs its expense class.');
      classOf_(ctx, e.class, 'expense');
      return e.class;
    }
    throw refuse_('Accept is resale, asset or use.');
  }
  /* ── v1.45.0 (FX1) helpers: a foreign amount in the books' currency, a settlement's figures, the revaluation rows ── */
  function ccy_(value, what) {
    var code = String(value == null ? '' : value).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw refuse_(what + ' needs its currency (txn_currency, three letters).');
    return code;
  }
  function rate_(value, what) {
    var rate = value == null || value === '' ? NaN : num_(value, what);
    return rate > 0 ? rate : null;
  }
  /** a foreign amount (its own minor units) × a rate → the books' minor units, rounded once, half away from zero (the money engine's rule) */
  function fxMinor_(txnMinor, rate, txnCur, fn) {
    var scaled = txnMinor * rate * Math.pow(10, decimals_(fn) - decimals_(txnCur));
    if (!(Math.abs(scaled) < MINOR_CEILING)) throw refuse_('At the rate ' + rate + ' the amount is beyond what this record holds exactly.');
    var rounded = Math.round(Math.abs(Number(scaled.toPrecision(15))));
    return scaled < 0 ? -rounded : rounded;
  }
  /** a foreign bill settled: the money that came in or went out and what the books carried for the bill, each with its transaction currency and rate; refused by name on anything missing */
  function fxSettle_(e, currency, ctx) {
    checkSettlementParty_(e);
    var fn = ctx.functional || currency,
      txnCurrency = ccy_(e.txn_currency, 'A settlement');
    if (currency !== fn) throw refuse_("A settlement is posted in the books' currency (" + fn + '); the ' + txnCurrency + ' amount rides on its lines.');
    if (txnCurrency === fn) throw refuse_('A settlement in ' + fn + ' against a ' + fn + ' bill has no exchange difference — post it as a payment.');
    if (e.mode === 'cheque' && e.cheque_status !== 'cleared')
      throw refuse_('A cheque is posted when it CLEARS (it is ' + (e.cheque_status || 'not cleared') + ').');
    var acct = mode_(e.mode, ctx);
    if (!acct) throw refuse_('Unknown payment mode "' + e.mode + '".');
    var tMinor = toMinor(e.amount_txn, txnCurrency, 'amount_txn');
    if (!(tMinor > 0)) throw refuse_('A settlement needs the ' + txnCurrency + ' amount it settles (amount_txn).');
    var out = settlementMoney_(e, acct, tMinor, txnCurrency, fn);
    addSettlementCarry_(out, e, tMinor, txnCurrency, fn);
    return out;
  }
  /** a settlement says whose bill it settles (a customer's or a supplier's) and names its party */
  function checkSettlementParty_(e) {
    if (e.side !== 'receivable' && e.side !== 'payable')
      throw refuse_('A settlement says whose bill it settles: side receivable (a customer) or payable (a supplier).');
    if (!String(e.party || '').trim()) throw refuse_('A settlement names its party.');
  }
  /** the money side of a settlement: the account and what came in or went out in the books' currency — handed in as an amount, or the foreign amount at the rate of the day it was paid */
  function settlementMoney_(e, acct, tMinor, txnCurrency, fn) {
    var out = { acct: acct };
    if (e.amount != null && e.amount !== '') {
      out.money = toMinor(e.amount, fn, 'amount');
      out.moneyTxn = null; /* paid in the books' currency against a foreign bill */
      if (!(out.money > 0)) throw refuse_('A settlement needs what came in or went out (amount) — more than nothing.');
    } else {
      var rate = rate_(e.rate, 'rate');
      if (!rate) throw refuse_('A settlement in ' + txnCurrency + ' needs its rate to ' + fn + ' on the day it was paid (rate) — a rate is evidence, never assumed.');
      out.money = fxMinor_(tMinor, rate, txnCurrency, fn);
      out.moneyTxn = { currency: txnCurrency, minor: tMinor, rate: rate };
    }
    return out;
  }
  /** the carrying side of a settlement: what the books carry for the bill, from the carrying handed in or the rate the bill was booked at (added to `out`) */
  function addSettlementCarry_(out, e, tMinor, txnCurrency, fn) {
    var bookRate = rate_(e.book_rate, 'book_rate');
    if (e.carrying != null && e.carrying !== '') {
      out.carry = toMinor(e.carrying, fn, 'carrying');
      bookRate = bookRate || Number((out.carry / tMinor / Math.pow(10, decimals_(fn) - decimals_(txnCurrency))).toPrecision(10));
    } else {
      if (!bookRate) throw refuse_('A settlement needs the rate the bill was booked at (book_rate) or what the books carry for it (carrying) — never assumed.');
      out.carry = fxMinor_(tMinor, bookRate, txnCurrency, fn);
    }
    if (!(out.carry > 0)) throw refuse_('What the books carry for the bill (carrying) is more than nothing.');
    out.carryTxn = { currency: txnCurrency, minor: tMinor, rate: bookRate };
  }
  /** a revaluation item's currency (not the books' own) and account, each refused by name when missing: { txnCurrency, acct } */
  function revalueItemHead_(item, index, fn) {
    if (!item || typeof item !== 'object') throw refuse_('Revaluation item ' + (index + 1) + ' is not a row.');
    var txnCurrency = ccy_(item.txn_currency, 'Revaluation item ' + (index + 1));
    if (txnCurrency === fn) throw refuse_('Revaluation item ' + (index + 1) + " is in the books' own currency (" + fn + ') — nothing to retranslate.');
    var acct = String(item.account == null ? '' : item.account);
    if (!acct) throw refuse_('Revaluation item ' + (index + 1) + ' names no account.');
    return { txnCurrency: txnCurrency, acct: acct };
  }
  /** the revaluation rows: each item at its currency's closing rate, its target, its difference from what the books carry. A currency with no rate is NAMED, never skipped. */
  function revalueRows_(items, rates, fn, ctx, date) {
    if (!Array.isArray(items)) throw refuse_('A revaluation lists the open foreign balances (items).');
    var ratesByCurrency = rates || {},
      rows = [],
      missing = [],
      seen = {};
    items.forEach(function (item, index) {
      var head = revalueItemHead_(item, index, fn),
        txnCurrency = head.txnCurrency,
        acct = head.acct;
      var rate = Object.prototype.hasOwnProperty.call(ratesByCurrency, txnCurrency) ? rate_(ratesByCurrency[txnCurrency], 'rate ' + txnCurrency) : null;
      if (!rate) {
        if (!seen[txnCurrency]) {
          seen[txnCurrency] = true;
          missing.push('No ' + txnCurrency + ' closing rate for ' + (date || 'the period end') + ' — add it, then revalue.');
        }
        return;
      }
      var balance = toMinor(item.balance_txn, txnCurrency, 'balance_txn'),
        carry = toMinor(item.carrying, fn, 'carrying');
      var target = fxMinor_(balance, rate, txnCurrency, fn);
      rows.push({
        account: acct,
        party: item.party || null,
        txn_currency: txnCurrency,
        rate: rate,
        balance_txn_minor: balance,
        carrying_minor: carry,
        target_minor: target,
        diff_minor: target - carry
      });
    });
    return { rows: rows, missing: missing };
  }
  function sum_(lines, side) {
    return (lines || []).reduce(function (total, item) {
      return total + (item[side] || 0);
    }, 0);
  }
  function refuse_(reason) {
    var e = new Error(reason);
    e.refused = true;
    return e;
  }

  /**
   * ⭐⭐⭐ post(event, ctx) → { ok, lines, totals, rule, why }
   *   event: { type, ref, date, currency, … the rule's fields }     ctx: { pack?, country? }
   * Refuses — never repairs — when: the type has no rule · a line names an account the pack does not have · a line is
   * negative or both-sided · the debits do not equal the credits TO THE MINOR UNIT · nothing would be posted ·
   * (v1.8.1) the date is not a real YYYY-MM-DD day · an amount or rate is not a finite plain number or is too large ·
   * a class that is not one · a party on a non-party line · a rate that turns a line into nothing.
   */
  function post(event, ctx) {
    var e = event || {},
      x = ctx || {};
    var entry = resolveEntry_(e, x);
    if (entry.refusal) return entry.refusal;
    var inFunctional = balancedLines_(e, x, entry);
    if (inFunctional.refusal) return inFunctional.refusal;
    return postedEntry_(e, entry, inFunctional);
  }

  /** post() step 1 — the rule for the event type, its currency and date, the shop's own ledgers added to the pack; { refusal } when any is missing, else { rule, currency, packs, pack } */
  function resolveEntry_(e, x) {
    var packs = packsEngine_(),
      regulation = regulationEngine_(),
      pack = null;
    /* CTRY-94: post() answers { ok: false }, it does not throw — no country / no pack is the registry's refusal in post's own shape */
    try {
      pack = x.pack || (regulation ? regulation.resolve(x) : null);
    } catch (refused) {
      if (!refused.refused) throw refused;
      return { refusal: { ok: false, why: refused.message, code: refused.code, lines: [] } };
    }
    if (pack && pack.unknown) return { refusal: { ok: false, why: pack.why, code: pack.code, lines: [] } };
    var rule = Object.prototype.hasOwnProperty.call(RULES, ruleOf_(pack, e.type)) ? RULES[ruleOf_(pack, e.type)] : null;
    if (!rule) return { refusal: { ok: false, why: 'There is no posting rule for "' + e.type + '".', lines: [] } };
    var currency = String(e.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return { refusal: { ok: false, why: 'The event has no currency — an amount is labelled, never assumed.', lines: [] } };
    var dateRefusal = dateRefusal_(e, packs);
    if (dateRefusal) return { refusal: dateRefusal };
    var shopPack = withShopAccounts_(pack, packs, x);
    if (shopPack.refusal) return shopPack;
    return { rule: rule, currency: currency, packs: packs, pack: shopPack.pack };
  }
  /** H2: no date, a datetime, '2026-9-5', 30 Feb — the entry would post and then be in no balance, or in half of them; null when the date is a real day */
  function dateRefusal_(e, packs) {
    if (!packs || !packs.dayOf) return { ok: false, why: 'Posting needs the accounts-packs engine (it stamps the fiscal year and period).', lines: [] };
    if (packs.dayOf(e.date) === null)
      return {
        ok: false,
        why:
          'An entry needs its date as YYYY-MM-DD — a real calendar day, no time of day (got ' + (e.date == null ? 'none' : String(e.date).slice(0, 30)) + ').',
        lines: []
      };
    return null;
  }
  /** the pack with the shop's own ledgers added (a clash refused): { pack } or { refusal } */
  function withShopAccounts_(pack, packs, x) {
    if (pack && packs && Array.isArray(x.accounts) && x.accounts.length) {
      /* the shop's own ledgers (a clash refused) */
      try {
        pack = packs.withAccounts(pack, x.accounts);
      } catch (err) {
        return { refusal: { ok: false, why: err.message, lines: [] } };
      }
    }
    return { pack: pack };
  }

  /** post() step 2 — the rule's lines, checked, turned into the functional currency with the round-off line; { refusal } or { functional, fxRate, converted } */
  function balancedLines_(e, x, entry) {
    var currency = entry.currency,
      pack = entry.pack,
      packs = entry.packs;
    /* ⭐ the FUNCTIONAL currency the books are kept in; an event in another one needs its rate (never assumed) */
    var fn = String(x.functional || (pack && pack.currency) || currency).toUpperCase();
    var rate = entryRate_(e, currency, fn);
    if (rate.refusal) return rate;
    var list;
    try {
      list = entry.rule(e, currency, { pack: pack, P: packs, functional: fn });
    } catch (err) {
      return { refusal: { ok: false, why: err.message, lines: [] } };
    }
    var problems = entryProblems_(list, pack, packs, currency);
    if (problems.length) return { refusal: { ok: false, why: 'Not posted: ' + problems[0] + '.', problems: problems, lines: [] } };
    /* into the functional currency, line by line; what rounding leaves is ONE round-off line, named, never spread */
    var converted = convertLines_(list, rate.fxRate, currency, fn);
    var convertedProblems = convertedLineProblems_(converted, rate.fxRate, currency, fn);
    if (convertedProblems.length)
      return { refusal: { ok: false, why: 'Not posted: ' + convertedProblems[0] + '.', problems: convertedProblems, lines: [] } };
    addFxRoundOff_(converted, packs, pack);
    return { functional: fn, fxRate: rate.fxRate, converted: converted };
  }
  /** the rate of an event in a currency other than the functional one: 1 for the functional currency, else fx_rate (refused without it); { fxRate } or { refusal } */
  function entryRate_(e, currency, fn) {
    var fxRate = 1;
    if (currency !== fn) {
      try {
        fxRate = e.fx_rate == null || e.fx_rate === '' ? NaN : num_(e.fx_rate, 'fx_rate');
      } catch (err) {
        return { refusal: { ok: false, why: err.message, lines: [] } };
      }
      if (!(fxRate > 0))
        return { refusal: { ok: false, why: 'An entry in ' + currency + ' needs its rate to ' + fn + ' (fx_rate) — a rate is evidence, never assumed.', lines: [] } };
    }
    return { fxRate: fxRate };
  }
  /** everything wrong with the rule's lines, in the order the checks run: each line, an empty entry, a total past the ceiling, debits not equal to credits */
  function entryProblems_(list, pack, packs, currency) {
    var problems = [];
    list.forEach(function (item) {
      checkLine_(item, problems, pack, packs);
    });
    if (!list.length) problems.push('nothing to post');
    var entryDebit = sum_(list, 'dr'),
      entryCredit = sum_(list, 'cr');
    if (!Number.isSafeInteger(entryDebit) || !Number.isSafeInteger(entryCredit)) problems.push("the entry's total is beyond what this record holds exactly");
    if (entryDebit !== entryCredit) problems.push('the debits (' + fromMinor(entryDebit, currency) + ') do not equal the credits (' + fromMinor(entryCredit, currency) + ')');
    return problems;
  }
  /** one line of the entry: its account's role and code stamped on it, then what is wrong with it added to `problems` */
  function checkLine_(item, problems, pack, packs) {
    var account = pack && packs ? packs.accountOf(pack, item.account) : null;
    if (account) item.account = account.role; /* a code handed in ('1300') becomes its role */
    item.code = account ? account.code : null;
    checkLineSides_(item, problems);
    checkLineAccount_(item, account, problems, pack, packs);
  }
  /** a line is one positive debit or one positive credit */
  function checkLineSides_(item, problems) {
    if (item.dr < 0 || item.cr < 0 || (item.dr && item.cr) || (!item.dr && !item.cr))
      problems.push('a line on ' + item.account + ' is not one positive debit or credit');
  }
  /** a line's account is in the chart, and a party is on a debtors / creditors line and nowhere else */
  function checkLineAccount_(item, account, problems, pack, packs) {
    if (pack && packs && !account) problems.push('the account "' + item.account + '" is not in the chart');
    if ((item.account === 'debtors' || item.account === 'creditors') && !item.party) problems.push('a line on ' + item.account + ' names no party');
    /* M2: the mirror — a party lives ONLY on the two control accounts; on cash or capital it would grow a phantom sub-ledger */
    if (item.party && item.account !== 'debtors' && item.account !== 'creditors')
      problems.push('a line on ' + item.account + ' names a party (' + String(item.party).slice(0, 40) + ') — only a debtors or creditors line carries one');
  }
  /** each line's debit and credit in the functional currency's minor units: { l: the line, fdr, fcr } */
  function convertLines_(list, fxRate, currency, fn) {
    var scale = Math.pow(10, decimals_(fn) - decimals_(currency));
    return list.map(function (item) {
      return { l: item, fdr: Math.round(item.dr * fxRate * scale), fcr: Math.round(item.cr * fxRate * scale) };
    });
  }
  /** H4: the one-positive-side rule is checked AGAIN on the converted lines — a rate of 1e-9 zeroed every line, 1e300 made them Infinity */
  function convertedLineProblems_(converted, fxRate, currency, fn) {
    var convertedProblems = [];
    converted.forEach(function (item) {
      if (!Number.isSafeInteger(item.fdr) || !Number.isSafeInteger(item.fcr) || item.fdr >= MINOR_CEILING || item.fcr >= MINOR_CEILING)
        convertedProblems.push('at the rate ' + fxRate + ' the line on ' + item.l.account + ' is beyond what this record holds exactly');
      else if ((item.l.dr && !item.fdr) || (item.l.cr && !item.fcr))
        convertedProblems.push(
          'at the rate ' + fxRate + ' the line on ' + item.l.account + ' (' + fromMinor(item.l.dr || item.l.cr, currency) + ' ' + currency + ') becomes nothing in ' + fn
        );
    });
    return convertedProblems;
  }
  /** what rounding left between the converted debits and credits goes on ONE named round-off line (added to `converted`) */
  function addFxRoundOff_(converted, packs, pack) {
    var functionalDebit = converted.reduce(function (total, item) {
        return total + item.fdr;
      }, 0),
      functionalCredit = converted.reduce(function (total, item) {
        return total + item.fcr;
      }, 0);
    if (functionalDebit !== functionalCredit)
      converted.push({
        l: { account: 'round_off', code: ((packs && pack && packs.accountOf(pack, 'round_off')) || {}).code || null, dr: 0, cr: 0, fx_line: true },
        fdr: functionalDebit < functionalCredit ? functionalCredit - functionalDebit : 0,
        fcr: functionalDebit > functionalCredit ? functionalDebit - functionalCredit : 0
      });
  }

  /** post() step 3 — the posted entry: the converted lines as amounts, their totals, the fiscal year and period */
  function postedEntry_(e, entry, inFunctional) {
    var packs = entry.packs,
      pack = entry.pack,
      fn = inFunctional.functional;
    var fiscalYear = packs && pack ? packs.fiscalYearOf(e.date, pack) : null;
    var opening = e.type === 'opening';
    var lines = inFunctional.converted.map(function (item) {
      return postedLine_(item, e, entry.currency, fn, inFunctional.fxRate);
    });
    var totalDebitMinor = lines.reduce(function (total, item) {
        return total + item.dr_minor;
      }, 0),
      totalCreditMinor = lines.reduce(function (total, item) {
        return total + item.cr_minor;
      }, 0);
    return {
      ok: true,
      type: e.type,
      date: e.date || null,
      currency: fn,
      txn_currency: entry.currency,
      fiscal_year: fiscalYear,
      period: opening ? 0 : packs && pack ? packs.periodOf(e.date, pack) : null,
      is_opening: opening,
      voucher: voucherTypeOf(e, { pack: pack }),
      narration: e.narration || e.reason || null,
      lines: lines,
      totals: { dr: fromMinor(totalDebitMinor, fn), cr: fromMinor(totalCreditMinor, fn), dr_minor: totalDebitMinor, cr_minor: totalCreditMinor },
      rule: RULES_VERSION
    };
  }
  /** one converted line as the posted line: amounts in the functional currency, its own transaction currency and rate when it carries them */
  function postedLine_(item, e, currency, fn, fxRate) {
    var line = item.l;
    var outLine = {
      account: line.account,
      code: line.code || null,
      dr: fromMinor(item.fdr, fn),
      cr: fromMinor(item.fcr, fn),
      dr_minor: item.fdr,
      cr_minor: item.fcr,
      currency: fn,
      txn_currency: line.txn ? line.txn.currency : currency,
      amount_txn_minor: line.txn ? line.txn.minor : line.dr || line.cr || 0,
      fx_rate: line.txn ? line.txn.rate : fxRate /* v1.45.0: a line's own (fx_settlement / fx_revalue) */,
      ref: e.ref || null,
      rule: RULES_VERSION
    };
    addLineExtras_(outLine, line);
    return outLine;
  }
  /** the fields a posted line carries only when its source line had them: party, rate, and the round-off marker */
  function addLineExtras_(outLine, line) {
    if (line.party) outLine.party = line.party;
    if (line.rate !== undefined) outLine.rate = line.rate;
    if (line.fx_line) outLine.fx_rounding = true;
  }

  /**
   * ⭐ daySummary(bills, head, { pack?, country? }) → a walkin_day event: the walk-in bills of one counter for one day (or shift), summed per
   * payment mode and per tax rate. `bills` are { currency, pay: { <mode>: amount … }, taxes: [{ rate, taxable, <each tax head of the pack> }],
   * round_off? } — named-party bills must not be here (granularity() sends them per bill), and are REFUSED. A head the pack calls optional is
   * in a rate's row only when it carries an amount; every other head is always there.
   */
  function daySummary(bills, head, opt) {
    var header = head || {};
    var packHeads = walkInHeads_(opt),
      heads = packHeads.heads,
      optional = packHeads.optional;
    var dayTotals = { currency: null, modes: {}, rates: {}, roundOff: 0, refused: [] };
    (bills || []).forEach(function (item, index) {
      addWalkInBill_(dayTotals, item, index, heads);
    });
    if (dayTotals.refused.length) throw refuse_('Bills ' + dayTotals.refused.join(', ') + " name a party — they are posted per bill, not in the day's summary.");
    var currency = dayTotals.currency;
    var majorOf = function (minor) {
      return fromMinor(minor, currency);
    };
    var modesMajor = {};
    Object.keys(dayTotals.modes).forEach(function (item) {
      modesMajor[item] = majorOf(dayTotals.modes[item]);
    });
    return {
      type: 'walkin_day',
      ref: header.ref || null,
      date: header.date || null,
      counter: header.counter || null,
      currency: currency,
      bills: (bills || []).length,
      modes: modesMajor,
      by_rate: Object.keys(dayTotals.rates).map(function (item) {
        return rateRowMajor_(dayTotals.rates[item], heads, optional, majorOf);
      }),
      round_off: majorOf(dayTotals.roundOff)
    };
  }
  /** the pack's tax heads, and which of them are optional, for a day summary of `opt` ({ pack?, country? }) */
  function walkInHeads_(opt) {
    var regulation = regulationEngine_(),
      pack = (opt && opt.pack) || (regulation ? regulation.resolve(opt) : null),
      heads = taxPack_({ pack: pack }).taxHeads,
      optional = pack.optionalHeads || [];
    return { heads: heads, optional: optional };
  }
  /** one walk-in bill added to the day's totals ({ currency, modes, rates, roundOff, refused }): a bill naming a party is only noted as refused; two currencies cannot share one entry */
  function addWalkInBill_(dayTotals, item, index, heads) {
    if (item.party || item.credit || item.tax_id || item.gstin) {
      dayTotals.refused.push(index);
      return;
    }
    var code = String(item.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(code))
      throw refuse_('Walk-in bill ' + index + ' has no currency — an amount is labelled, never assumed.'); /* L3: the FIRST bill slipped in */
    if (dayTotals.currency && code !== dayTotals.currency) throw refuse_('Walk-in bills in two currencies (' + dayTotals.currency + ', ' + code + ') cannot share one entry.');
    dayTotals.currency = code;
    addPaymentModes_(dayTotals, item);
    addTaxRows_(dayTotals, item, heads);
    dayTotals.roundOff += toMinor(item.round_off, dayTotals.currency);
  }
  /** the bill's takings per payment mode, in minor units, added to the day's totals */
  function addPaymentModes_(dayTotals, item) {
    Object.keys(item.pay || {}).forEach(function (mode) {
      dayTotals.modes[mode] = (dayTotals.modes[mode] || 0) + toMinor(item.pay[mode], dayTotals.currency);
    });
  }
  /** the bill's tax rows added to the day's totals, one row per rate (and supply kind), a figure per head of the pack */
  function addTaxRows_(dayTotals, item, heads) {
    (item.taxes || []).forEach(function (entry) {
      /* A5 (v1.64.0): a row that names its supply kind keeps it — two kinds at one rate stay two rows (rows without a kind group as before) */
      var rateKey = String(entry.rate) + (entry.kind ? '|' + entry.kind : '');
      dayTotals.rates[rateKey] =
        dayTotals.rates[rateKey] ||
        heads.reduce(
          function (total, element) {
            total[element] = 0;
            return total;
          },
          entry.kind ? { rate: entry.rate, kind: entry.kind, taxable: 0 } : { rate: entry.rate, taxable: 0 }
        );
      ['taxable'].concat(heads).forEach(function (element) {
        dayTotals.rates[rateKey][element] += toMinor(entry[element], dayTotals.currency);
      });
    });
  }
  /** one rate row of the day's summary in major units; a head the pack calls optional is in it only when it carries an amount */
  function rateRowMajor_(rateRow, heads, optional, majorOf) {
    var row = { rate: rateRow.rate, taxable: majorOf(rateRow.taxable) };
    if (rateRow.kind) row.kind = rateRow.kind;
    heads.forEach(function (entry) {
      if (optional.indexOf(entry) < 0 || rateRow[entry]) row[entry] = majorOf(rateRow[entry]);
    });
    return row;
  }


  /**
   * ⭐ taxSetOff({ pack?, country?, ref?, date, period?, currency?, output: { <head>… }, input: { <head>… }, rcm? }) → { ok, utilised, payable,
   * carried, event } — v1.14.0 (R3), neutral since v1.24.0. The inputs are the BALANCES: the credit balance of each output head and the debit
   * balance of each input head, in major units. The ORDER of set-off is the pack's law (`pack.setOff`); what credit cannot cover is `payable` (by a
   * statutory payment: tax_payment); unused credit is `carried`. `event` is a tax_setoff event the rule recomputes identically. A head the pack
   * calls optional is in the answer only when a figure for it was handed in.
   */
  function taxSetOff(options) {
    var x = options || {},
      regulation = regulationEngine_(),
      pack = x.pack || (regulation ? regulation.resolve(x) : null),
      currency = setOffCurrency_(x, pack);
    try {
      taxPack_({ pack: pack });
      var setOff = taxSetOff_(pack, x.output, x.input, currency),
        majorOf = function (minor) {
          return fromMinor(minor, currency);
        },
        heads = payHeadsFor_(pack, x);
      var res = setOffAnswer_(x, setOff, heads, currency, majorOf);
      if (x.rcm != null) addReverseChargeToAnswer_(res, x, pack, setOff, currency, majorOf);
      return res;
    } catch (err) {
      if (err && err.refused) return { ok: false, why: err.message, utilised: [] };
      throw err;
    }
  }
  /** the currency a set-off is worked in: the one handed in, else the pack's */
  function setOffCurrency_(x, pack) {
    return String(x.currency || (pack && pack.currency) || '').toUpperCase();
  }
  /** the heads a set-off answer names: the pack's pay heads, without the optional ones unless a figure for one was handed in */
  function payHeadsFor_(pack, x) {
    return hasOptional_(pack, x)
      ? pack.payHeads
      : pack.payHeads.filter(function (item) {
          return (pack.optionalHeads || []).indexOf(item) < 0;
        });
  }
  /** the set-off answer: what was utilised, what is payable and carried, and the tax_setoff event the rule recomputes identically */
  function setOffAnswer_(x, setOff, heads, currency, majorOf) {
    return {
      ok: true,
      utilised: setOff.utilised.map(function (item) {
        return { from: item.from, against: item.against, amount: majorOf(item.amount) };
      }),
      payable: figuresByHead_(heads, setOff.payable, majorOf),
      carried: figuresByHead_(heads, setOff.carried, majorOf),
      event: {
        type: 'tax_setoff',
        ref: x.ref || null,
        date: x.date || null,
        period: x.period || null,
        currency: currency,
        output: balancesByHead_(heads, x.output, currency, majorOf),
        input: balancesByHead_(heads, x.input, currency, majorOf)
      }
    };
  }
  /** a figure per head, in major units, from a row in minor units */
  function figuresByHead_(heads, minorByHead, majorOf) {
    var figures = {};
    heads.forEach(function (item) {
      figures[item] = majorOf(minorByHead[item]);
    });
    return figures;
  }
  /** a figure per head, in major units, from the balances handed in (major units, any head missing counts as nothing) */
  function balancesByHead_(heads, balances, currency, majorOf) {
    var figures = {};
    heads.forEach(function (item) {
      figures[item] = majorOf(toMinor((balances || {})[item], currency));
    });
    return figures;
  }
  /** v1.20.0 — reverse-charge tax is NEVER set off: no credit is used against it, it joins the payment, in cash (the pack's rcm heads). The answer names it only when it was handed in. */
  function addReverseChargeToAnswer_(res, x, pack, setOff, currency, majorOf) {
    var reverseCharge = {},
      cash = {};
    rcmHeads_(pack).forEach(function (item) {
      var reverseMinor = toMinor((x.rcm || {})[item], currency);
      if (reverseMinor < 0) throw refuse_('A reverse-charge balance is never negative here.');
      reverseCharge[item] = majorOf(reverseMinor);
      cash[item] = majorOf(setOff.payable[item] + reverseMinor);
    });
    res.rcm = reverseCharge;
    res.cash = cash;
    res.event.rcm = reverseCharge;
  }

  /**
   * ⭐ gstSetOff(options) — the name this function has always had (the app and the API call it): taxSetOff with the India pack's own name for the event it
   * returns (`gst_setoff`). One calculation — it IS taxSetOff.
   */
  function gstSetOff(options) {
    var result = taxSetOff(options),
      x = options || {},
      regulation = regulationEngine_(),
      pack = x.pack || (regulation ? regulation.resolve(x) : null);
    if (result.event) result.event.type = aliasFor_(pack, result.event.type);
    return result;
  }
  /** a figure for an OPTIONAL head was handed in on either side: the answer then names that head; with none, the answer keeps its other heads exactly as before */
  function hasOptional_(pack, x) {
    var opt = pack.optionalHeads || [];
    return [x && x.output, x && x.input].some(function (item) {
      return (
        item &&
        opt.some(function (head) {
          return item[head] != null && item[head] !== '';
        })
      );
    });
  }
  /** the arithmetic, in minor units — taxSetOff and the tax_setoff rule both call it, so there is one answer; the ORDER is the pack's (`pack.setOff`) */
  function taxSetOff_(pack, output, input, currency) {
    return pack.setOff({ output: output, input: input }, function (value) {
      return toMinor(value, currency);
    });
  }

  /**
   * ⭐ depreciationFor({ entity, method?, fiscal_year, date, ref?, assets, pack? }) → { ok, basis, by_class, by_asset, event } — v1.14.0 (R2).
   *   assets: [{ id, class, cost?, put_to_use?, opening_wdv?, sold?: { proceeds } }] — an asset bought this year has cost and put_to_use;
   *   one brought forward has opening_wdv (and cost, for a straight-line entity).
   *   The LAW — which basis an entity follows, the rates and useful lives, the residual value, the half rate for a short year — is the pack's
   *   (`pack.depreciation`: assetClasses, entityBases, compute); this function keeps what is not law: the checks on what was handed in, the grouping by
   *   class, and the drift (any rounding or block adjustment sits on the class's first asset). The class `amount` is what posts. by_asset is each asset's own figure.
   *   Refuses an unknown entity (never a default rate), an entity that needs a method and has none, an asset without class / cost or opening_wdv, a
   *   put_to_use outside the year (and after `date`).
   */
  function depreciationFor(options) {
    var x = options || {},
      packs = packsEngine_(),
      regulation = regulationEngine_(),
      pack = x.pack || (regulation ? regulation.resolve(x) : null);
    try {
      if (!packs || !pack) throw refuse_('Depreciation needs the accounts-packs engine.');
      var basis = depreciationBasis_(x, pack),
        depreciation = basis.depreciation,
        base = basis.base;
      var year = depreciationYear_(x, packs, pack, base),
        currency = pack.currency,
        majorOf = function (minor) {
          return fromMinor(minor, currency);
        };
      var rows = x.assets.map(function (item, index) {
        return depreciationRow_(item, index, { x: x, packs: packs, pack: pack, currency: currency, year: year });
      });
      var figures = classFigures_(groupByClass_(rows), depreciation, base, x.method, year.days, majorOf),
        clsOut = figures.clsOut;
      return {
        ok: true,
        basis: base.basis,
        by_class: clsOut.map(function (item) {
          return { class: item.class, rate: item.rate, amount: item.amount };
        }),
        by_asset: figures.assetOut,
        event: depreciationEvent_(x, base, currency, clsOut)
      };
    } catch (err) {
      if (err && err.refused) return { ok: false, why: err.message };
      throw err;
    }
  }
  /** the depreciation event the classes with an amount post (null when none has one) */
  function depreciationEvent_(x, base, currency, clsOut) {
    var posting = clsOut
      .filter(function (item) {
        return item.minor > 0;
      })
      .map(function (item) {
        return { class: item.class, amount: item.amount };
      });
    return posting.length ? { type: 'depreciation', ref: x.ref || null, date: x.date, currency: currency, basis: base.basis, by_class: posting } : null;
  }
  /** the pack's depreciation rules and the basis its entity type follows: { depreciation, base }, or a refusal naming what the pack lacks */
  function depreciationBasis_(x, pack) {
    var depreciation = pack.depreciation;
    if (!depreciation || typeof depreciation.compute !== 'function') throw refuse_('The regulation pack has no depreciation rules.');
    var bases = depreciation.entityBases || {},
      base = Object.prototype.hasOwnProperty.call(bases, x.entity) ? bases[x.entity] : null;
    if (!base)
      throw refuse_(
        'Depreciation needs the entity type the pack knows — ' +
          Object.keys(bases).join(', ') +
          ' — got "' +
          String(x.entity).slice(0, 40) +
          '"; never a default rate.'
      );
    return { depreciation: depreciation, base: base };
  }
  /** the fiscal year being depreciated, as day numbers { start, end, days }; the date, the method and the asset list are checked on the way */
  function depreciationYear_(x, packs, pack, base) {
    var yearRange = packs.fyRange(x.fiscal_year, pack);
    if (!yearRange) throw refuse_('Depreciation needs the fiscal year (e.g. 2026-27).');
    if (packs.dayOf(x.date) === null) throw refuse_('Depreciation needs its date as YYYY-MM-DD.');
    if (base.methods && base.methods.indexOf(x.method) < 0)
      throw refuse_('A ' + x.entity + "'s depreciation needs its method — " + base.methods.join(' or ') + '.');
    if (!Array.isArray(x.assets) || !x.assets.length) throw refuse_('Depreciation needs the assets.');
    var yearStart = packs.dayOf(yearRange.start),
      yearEnd = packs.dayOf(yearRange.end);
    return { start: yearStart, end: yearEnd, days: yearEnd - yearStart + 1 };
  }
  /** an optional amount in minor units: null when it was not handed in */
  function optionalMinor_(value, currency) {
    return value != null && value !== '' ? toMinor(value, currency) : null;
  }
  /** one asset as a row for the pack's compute(): its class, cost or opening written-down value, the days it is in use this year, what it sold for */
  function depreciationRow_(item, index, setup) {
    var currency = setup.currency;
    var assetLabel = 'asset ' + (item && item.id != null ? item.id : index + 1),
      assetClass = assetClass_({ pack: setup.pack }, item && item.class);
    var cost = optionalMinor_(item.cost, currency),
      writtenDown = optionalMinor_(item.opening_wdv, currency);
    if (cost === null && writtenDown === null) throw refuse_(assetLabel + ' needs its cost or its opening_wdv.');
    var days = daysInUse_(item, assetLabel, writtenDown, setup);
    var added = writtenDown === null; /* bought this year: cost counts, pro rata or at a part rate (the pack says) */
    return {
      id: item.id != null ? item.id : index + 1,
      c: assetClass,
      cost: cost,
      wdv: writtenDown,
      days: days,
      added: added,
      proceeds: item.sold ? toMinor(item.sold.proceeds, currency) : 0
    };
  }
  /** the days an asset is in use in the year: the whole year, or from the day it was put to use (refused when that is not a day inside the year or after the date) */
  function daysInUse_(item, assetLabel, writtenDown, setup) {
    var packs = setup.packs,
      year = setup.year,
      putToUse = null,
      days = year.days;
    if (item.put_to_use != null && item.put_to_use !== '') {
      putToUse = packs.dayOf(item.put_to_use);
      if (putToUse === null) throw refuse_(assetLabel + ': put_to_use is not a YYYY-MM-DD day.');
      if (putToUse > packs.dayOf(setup.x.date)) throw refuse_(assetLabel + ' is put to use after the depreciation date.');
      if (putToUse > year.end) throw refuse_(assetLabel + ' is put to use after the year ends.');
      if (putToUse < year.start && writtenDown === null) throw refuse_(assetLabel + ' was put to use before the year — give its opening_wdv.');
      if (putToUse >= year.start) days = year.end - putToUse + 1;
    } else if (writtenDown === null) throw refuse_(assetLabel + ' needs its put_to_use.');
    return days;
  }
  /** the rows grouped by asset class: { order: the class names as first met, byClass: name → rows } */
  function groupByClass_(rows) {
    var order = [],
      byClass = {};
    rows.forEach(function (item) {
      if (!byClass[item.c.class]) {
        byClass[item.c.class] = [];
        order.push(item.c.class);
      }
      byClass[item.c.class].push(item);
    });
    return { order: order, byClass: byClass };
  }
  /** the pack's depreciation per class and per asset; any rounding or block adjustment (the drift) sits on the class's first asset: { clsOut, assetOut } */
  function classFigures_(grouped, depreciation, base, method, daysInYear, majorOf) {
    var clsOut = [],
      assetOut = [];
    grouped.order.forEach(function (name) {
      var list = grouped.byClass[name],
        res = depreciation.compute(list, base, { method: method, diy: daysInYear }),
        total = res.total,
        rate = res.rate,
        perAsset = res.per;
      var drift =
        total -
        perAsset.reduce(function (sum, item) {
          return sum + item;
        }, 0);
      perAsset[0] += drift;
      list.forEach(function (item, index) {
        assetOut.push({ id: item.id, class: name, amount: majorOf(perAsset[index]) });
      });
      clsOut.push({ class: name, rate: rate, amount: majorOf(total), minor: total });
    });
    return { clsOut: clsOut, assetOut: assetOut };
  }

  /**
   * ⭐ VOUCHER_TYPE_OF — event type → voucher type (v1.16.0; Athi, 2026-10-02: "Follow the standard"). Each choice, and why:
   *   Sales          sale_bill, walkin_day, the day's takings                                  — a sale is a Sales voucher
   *   Purchase       purchase_bill                                                              — a Purchase voucher
   *   Receipt        payment_received · other_income · loan_taken                               — money IN: interest/commission received and a loan received go through Receipt
   *   Payment        payment_made · credit_given · loan_repaid · tax_payment · cheque_dishonoured
   *                  — money OUT of cash/bank: a supplier paid, credit handed over, an EMI from the bank, and the statutory tax payment
   *                  (a Payment voucher); a bounced cleared cheque takes the money back OUT of the bank to the party
   *   Expense        expense → Payment when paid at once; Purchase when a supplier's bill is booked on credit (the supplier field)
   *   Contra         contra                                                                     — between cash and bank-type accounts, no party
   *   Credit note    credit_note · return                                                       — a sales return
   *   Debit note     purchase_return · debit_note                                               — goods back to a supplier · a price raised after issue (ACC-192)
   *   Journal        closing_stock · accrual · depreciation · tax_setoff · tax_advance · write_off · asset_disposal · opening · manual
   *                  — no cash or bank moves: an adjustment between ledgers (set-off is credit against credit; a disposal is a many-legged
   *                  entry with a profit or loss; the opening is a Journal)
   * ⚠️ A PERSON'S OWN entry (type 'manual', source 'manual', or { manual: true }) takes the single series MJ whatever its type, and keeps
   * its voucher type beside it: voucher_type on the event (Payment · Receipt · Contra · Journal …), else the type this table gives it.
   */
  const KIND_OF = {
    walkin_day: 'Sales',
    sale_bill: 'Sales',
    purchase_bill: 'Purchase',
    payment_received: 'Receipt',
    other_income: 'Receipt',
    loan_taken: 'Receipt',
    payment_made: 'Payment',
    credit_given: 'Payment',
    loan_repaid: 'Payment',
    tax_payment: 'Payment',
    cheque_dishonoured: 'Payment',
    expense: 'Payment',
    contra: 'Contra',
    credit_note: 'Credit note',
    debit_note: 'Debit note' /* ACC-192: the seller's extra-sale note; purchase_return (goods back) keeps its label */,
    return: 'Credit note',
    purchase_return: 'Debit note',
    fx_settlement: 'Receipt',
    fx_revalue: 'Journal' /* v1.45.0 — a payable settlement is a Payment (voucherTypeOf) */,
    closing_stock: 'Journal',
    accrual: 'Journal',
    depreciation: 'Journal',
    tax_setoff: 'Journal',
    tax_advance: 'Journal',
    write_off: 'Journal',
    asset_disposal: 'Journal',
    opening: 'Journal',
    manual: 'Journal'
  };
  /* the names the default pack's accountants still use for a neutral event type (eventAliases): in the exported table beside the neutral ones, so every caller written before still finds its type */
  const ALIASES_ = (function () {
    return defaultPack_().eventAliases || {};
  })();
  const VOUCHER_TYPE_OF = Object.keys(KIND_OF).reduce(function (total, item) {
    total[item] = KIND_OF[item];
    return total;
  }, {});
  Object.keys(ALIASES_).forEach(function (item) {
    if (Object.prototype.hasOwnProperty.call(KIND_OF, ALIASES_[item])) VOUCHER_TYPE_OF[item] = KIND_OF[ALIASES_[item]];
  });
  /**
   * ⭐ voucherTypeOf(event, { manual? }) → { type: 'Sales', series: 'SV', manual: false } — the voucher type and number series of an event, or
   * null for a type with no rule. A manual entry is { type: <its kind>, series: 'MJ', manual: true }.
   */
  function voucherTypeOf(event, opts) {
    var e = event || {},
      given = opts || {},
      regulation = regulationEngine_(),
      pack = regulation ? regulation.resolve(given) : null,
      series = pack && pack.voucherSeries,
      kind = ruleOf_(pack, e.type);
    if (!series || !Object.prototype.hasOwnProperty.call(KIND_OF, kind)) return null;
    var manual = given.manual === true || e.source === 'manual' || e.type === 'manual';
    var type = voucherKind_(e, kind, series, manual);
    return { type: type, series: manual ? pack.manualSeries : series[type], manual: manual };
  }
  /** the voucher type of an event's rule kind: the table's, bent by a supplier on an expense, a payable settlement, or a person's own voucher_type */
  function voucherKind_(e, kind, series, manual) {
    var type = KIND_OF[kind];
    if (e.type === 'expense' && e.supplier) type = 'Purchase';
    if (kind === 'fx_settlement' && e.side === 'payable') type = 'Payment';
    if (manual && e.voucher_type != null && Object.prototype.hasOwnProperty.call(series, e.voucher_type)) type = e.voucher_type;
    return type;
  }

  /**
   * ⭐ v1.45.0 (FX1) fxRevaluation({ pack?, country?, functional?, date, ref?, items, rates }) → { ok, rows, missing, gain_minor, event, why? } — the period-end
   * retranslation, in the daySummary pattern: the SAME rows the fx_revalue rule posts (revalueRows_), so the to-do, the preview and the entry are one
   * calculation. `missing` names each currency with no closing rate (ok false — never a partial revaluation); `event` is null when nothing moved.
   * gain_minor: + a net unrealised gain, − a loss. The reversal is the same event with { reverse: true, reverses: ref } dated the next period's first day.
   */
  function fxRevaluation(options) {
    var x = options || {},
      regulation = regulationEngine_(),
      pack = x.pack || (regulation ? regulation.resolve(x) : null),
      fn = String(x.functional || (pack && pack.currency) || '').toUpperCase();
    try {
      var revaluation = revalueRows_(x.items || [], x.rates, fn, { pack: pack, functional: fn }, x.date);
      var gain = revaluation.rows.reduce(function (total, row) {
        return total + row.diff_minor;
      }, 0); /* a Dr movement on the balance is a Cr on fx_gain_loss — a gain, whatever the account */
      return {
        ok: !revaluation.missing.length,
        rows: revaluation.rows,
        missing: revaluation.missing,
        gain_minor: gain,
        why: revaluation.missing[0] || null,
        event: revaluationEvent_(x, fn, revaluation)
      };
    } catch (err) {
      return { ok: false, rows: [], missing: [], gain_minor: 0, why: err.message, event: null };
    }
  }

  /** the fx_revalue event the revaluation's rows post; null when a rate is missing or nothing moved */
  function revaluationEvent_(x, fn, revaluation) {
    var moved = revaluation.rows.some(function (row) {
      return row.diff_minor;
    });
    return !revaluation.missing.length && moved ? { type: 'fx_revalue', ref: x.ref || null, date: x.date || null, currency: fn, rates: x.rates, items: x.items } : null;
  }

  /** ⭐ balanced(lines, currency) → true when the debits equal the credits to the minor unit — the nightly check's question */
  function balanced(lines, currency, opt) {
    var regulation = regulationEngine_(),
      pack = (opt && opt.pack) || (regulation ? regulation.resolve(opt) : null);
    var currencyCode = String(currency || (pack && pack.currency) || '').toUpperCase(),
      debits = 0,
      credits = 0;
    (lines || []).forEach(function (item) {
      debits += toMinor(item.dr, currencyCode);
      credits += toMinor(item.cr, currencyCode);
    });
    return debits === credits;
  }

  const EXPORTS = {
    RULES_VERSION,
    MODE_ACCOUNT,
    TYPES: Object.keys(RULES).concat(Object.keys(ALIASES_)),
    VOUCHER_TYPE_OF,
    granularity,
    post,
    daySummary,
    taxSetOff,
    gstSetOff,
    depreciationFor,
    balanced,
    voucherTypeOf,
    fxRevaluation
  };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBPosting. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBPosting = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
