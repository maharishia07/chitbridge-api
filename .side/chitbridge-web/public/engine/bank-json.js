/* ADOPTED from chitbridge-engines v1.98.0 · bank-json · sha256 c4bb2ef42cacb232af2eb1ec654c4b5d04db2af2932b0dafb5edd0287795bb98 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · bank-json. Edited ONLY in chitbridge-engines/src/bank-json.js; every platform adopts a released version of it. */
/*
 * OWNS      reading a JSON bank statement (an array of lines, { lines | transactions }, or the Account Aggregator ReBIT deposit-account schema) into statement lines: the transaction list found wherever it sits, each item's date, amounts, references and balance, the account and the closing balance. PURE: no I/O, no clock.
 * CALLED BY bank-recon.js parse (the one caller; it hands in ctx with its own amountOf / dateOf / fail so the amount and date readers stay written once). Moved out of bank-recon.js unchanged (v1.98.0 file-size ceiling).
 * FLOW      JSON document ──▶ parse(data, ctx) ──▶ { ok, lines, warnings, account?, opening_minor?, closing_minor? }; an item that cannot be read is skipped and warned by its item number.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note The JSON half of the statement reader, moved out of bank-recon.js with no change of behaviour. Pure.
  function minorOf_(obj, minorKey, majorKey, ctx) {
    if (obj[minorKey] != null) {
      var number = Number(obj[minorKey]);
      return isFinite(number) && Math.floor(number) === number ? number : null;
    }
    if (obj[majorKey] == null || obj[majorKey] === '') return 0;
    var amount = ctx.amountOf(ctx, obj[majorKey]);
    return amount ? amount.minor : null;
  }
  /** the first array in the document that looks like a transaction list */
  function findTxns_(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return null;
    if (Array.isArray(node)) {
      if (looksLikeTxns_(node)) return node;
      for (var index = 0; index < node.length; index++) {
        var found = findTxns_(node[index], depth + 1);
        if (found) return found;
      }
      return null;
    }
    return findTxnsInValues_(node, depth);
  }
  /** is this array a list of transaction objects (every member an object, at least one naming a narration or an amount)? */
  function looksLikeTxns_(node) {
    return (
      node.length &&
      node.every(function (x) {
        return x && typeof x === 'object';
      }) &&
      node.some(function (x) {
        return 'narration' in x || 'debit_minor' in x || 'credit_minor' in x || 'amount' in x;
      })
    );
  }
  /** the first transaction list found under any value of an object, in key order */
  function findTxnsInValues_(node, depth) {
    var keys = Object.keys(node);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      var foundInKey = findTxns_(node[keys[keyIndex]], depth + 1);
      if (foundInKey) return foundInKey;
    }
    return null;
  }
  function findKey_(node, key, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return undefined;
    if (!Array.isArray(node) && node[key] != null && typeof node[key] !== 'object') return node[key];
    var keys = Object.keys(node);
    for (var index = 0; index < keys.length; index++) {
      var value = findKey_(node[keys[index]], key, depth + 1);
      if (value !== undefined) return value;
    }
    return undefined;
  }
  /** every item of the list read into a statement line; an item that cannot be read is skipped and warned in `warnings` */
  function jsonLines_(list, ctx, warnings) {
    var lines = [];
    for (var position = 0; position < list.length; position++) {
      var line = jsonLine_(list[position] || {}, position, ctx, warnings);
      if (line) lines.push(line);
    }
    return lines;
  }
  /** one JSON item → its statement line, or null when its date or amount cannot be read (warned) */
  function jsonLine_(x, position, ctx, warnings) {
    var date = ctx.dateOf(x.date || x.transactionTimestamp || x.txnDate || x.valueDate);
    if (!date) {
      warnings.push('item ' + (position + 1) + ': unreadable date — skipped');
      return null;
    }
    var amounts = jsonAmounts_(x, position, ctx, warnings);
    if (!amounts) return null;
    if (amounts.debit === null || amounts.credit === null) {
      warnings.push('item ' + (position + 1) + ': unreadable amount — skipped');
      return null;
    }
    return jsonLineOf_(x, date, amounts, position, ctx);
  }
  /** does the item carry neither a debit nor a credit field (major or minor units)? */
  function hasNoSplitAmounts_(x) {
    return x.debit == null && x.credit == null && x.debit_minor == null && x.credit_minor == null;
  }
  /** an item's money out and in → { debit, credit } (a side may be null when unreadable), or null once warned: AA type + amount, one signed amount, or debit / credit fields */
  function jsonAmounts_(x, position, ctx, warnings) {
    if (x.type != null && x.amount != null && hasNoSplitAmounts_(x)) return jsonTypedAmount_(x, position, ctx, warnings);
    if (x.amount != null && hasNoSplitAmounts_(x)) return jsonSignedAmount_(x, position, ctx, warnings);
    return { debit: minorOf_(x, 'debit_minor', 'debit', ctx), credit: minorOf_(x, 'credit_minor', 'credit', ctx) };
  }
  /** AA: type CREDIT or DEBIT + amount */
  function jsonTypedAmount_(x, position, ctx, warnings) {
    var amount = ctx.amountOf(ctx, x.amount),
      typeName = String(x.type).toUpperCase();
    if (!amount || !/^(CREDIT|DEBIT)$/.test(typeName)) {
      warnings.push('item ' + (position + 1) + ': unreadable AA amount or type — skipped');
      return null;
    }
    return { debit: typeName === 'DEBIT' ? amount.minor : 0, credit: typeName === 'CREDIT' ? amount.minor : 0 };
  }
  /** one amount: the side from its drcr field, else its own Dr / Cr mark, else its sign */
  function jsonSignedAmount_(x, position, ctx, warnings) {
    var amountRead = ctx.amountOf(ctx, x.amount),
      drcrText = String(x.drcr || x.dr_cr || '').toLowerCase();
    if (!amountRead) {
      warnings.push('item ' + (position + 1) + ': unreadable amount — skipped');
      return null;
    }
    var isDebit = drcrText ? drcrText[0] === 'd' : amountRead.side ? amountRead.side === 'dr' : amountRead.neg;
    return { debit: isDebit ? amountRead.minor : 0, credit: isDebit ? 0 : amountRead.minor };
  }
  /** the statement line of a readable item: its date, narration and amounts, then the value date, references and balance it carries, and its item number as `row` */
  function jsonLineOf_(x, date, amounts, position, ctx) {
    var line = {
      date: date,
      narration: String(x.narration == null ? x.description || x.mode || '' : x.narration),
      debit_minor: amounts.debit,
      credit_minor: amounts.credit
    };
    var valueDate = ctx.dateOf(x.value_date || x.valueDate);
    if (valueDate) line.value_date = valueDate;
    jsonReferences_(x, line);
    var balance = jsonBalance_(x, ctx);
    if (balance != null && isFinite(balance)) line.balance_minor = balance;
    line.row = position + 1;
    return line;
  }
  /** the reference and cheque number an item carries → line.ref, line.cheque_no */
  function jsonReferences_(x, line) {
    var ref = x.ref || x.reference || x.txnId;
    if (ref) line.ref = String(ref);
    if (x.cheque_no) line.cheque_no = String(x.cheque_no);
  }
  /** the running balance an item carries, in minor units (balance_minor as given; currentBalance or balance read from text, negative when the AA balance is) — null when it has none */
  function jsonBalance_(x, ctx) {
    var balance =
      x.balance_minor != null
        ? Number(x.balance_minor)
        : x.currentBalance != null
          ? (ctx.amountOf(ctx, x.currentBalance) || {}).minor
          : x.balance != null
            ? (ctx.amountOf(ctx, x.balance) || {}).minor
            : null;
    if (x.balance_minor == null && balance != null && x.currentBalance != null && ctx.amountOf(ctx, x.currentBalance).neg) balance = -balance;
    return balance;
  }
  /** what a JSON document wraps around its lines → out.account, opening_minor, closing_minor */
  function addJsonSummary_(out, data, lines, ctx) {
    var account =
      data.account != null && typeof data.account !== 'object' ? data.account : findKey_(data, 'maskedAccNumber', 0) || findKey_(data, 'linkedAccRef', 0);
    if (account != null) out.account = String(account);
    if (data.opening_minor != null) out.opening_minor = Number(data.opening_minor);
    if (data.closing_minor != null) out.closing_minor = Number(data.closing_minor);
    else addAaClosing_(out, data, lines, ctx);
  }
  /** no closing figure given: the AA summary's currentBalance, unless the lines carry balances of their own */
  function addAaClosing_(out, data, lines, ctx) {
    var currentBalance = findKey_(data, 'currentBalance', 0);
    if (
      currentBalance !== undefined &&
      !lines.some(function (item) {
        return item.balance_minor != null;
      })
    ) {
      var closing = ctx.amountOf(ctx, currentBalance);
      if (closing) out.closing_minor = closing.neg ? -closing.minor : closing.minor;
    }
  }
  /** a JSON statement (an array of lines, { lines | transactions }, or Account Aggregator FI data) → { ok, account, lines, warnings, opening_minor?, closing_minor? } or a refusal */
  function parseJson_(data, ctx) {
    var warnings = [],
      list = Array.isArray(data) ? data : findTxns_(data, 0);
    if (!list)
      return ctx.fail(
        'No transaction list found in the JSON (an array of lines, { lines | transactions }, or Account Aggregator Account.Transactions.Transaction).'
      );
    var lines = jsonLines_(list, ctx, warnings);
    var out = { ok: true, account: null, lines: lines, warnings: warnings };
    if (!Array.isArray(data) && data) addJsonSummary_(out, data, lines, ctx);
    return out;
  }

  var EXPORTS = { parse: parseJson_ };
  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBBankJson. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBBankJson = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
