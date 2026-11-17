/* ADOPTED from chitbridge-engines v1.98.0 · bank-recon · sha256 68bba956b8022251c87ca1b87f8dd49fd50b1ada89bcab65b287dd8f0230b70b — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · bank-recon. Edited ONLY in chitbridge-engines/src/bank-recon.js; every platform adopts a released version of it. */
/*
 * OWNS      reading a bank statement (CSV or JSON, India presets and the Account Aggregator schema), matching its lines to the Ledger's bank lines and to the payment advices on the rail, suggesting the entry a missing line needs (a proposal, never posted), the Bank Reconciliation Statement, and the device's accept / note / attach marks
 * CALLED BY the web accounts screen (public/app/cap-bank.js, loaded as /engine/bank-recon.js → window.CBBankRecon: parse · railPayments · explain · brs · ask · step · learn · PRESETS) · the api test tests/books-bank-rail.test.cjs · the engines tests tests/bank-recon*.test.js · posting.js is called back from suggest to compose the proposed entry
 * FLOW      text ──▶ parse ──▶ statement lines ──▶ match (ledger) + railPayments ──▶ explain (a state per line) ──▶ suggest / ask / learn for the rest ──▶ brs (the difference, named); step records what a person accepted
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note A bank statement (CSV / JSON) read, matched to the Ledger's bank lines AND to the payment chits on the rail (BR1), the missing entries SUGGESTED, the BRS. Pure — no I/O, no clock.
  /**
   * bank-recon.js — BANK RECONCILIATION: READ THE STATEMENT, MATCH IT, SUGGEST WHAT THE BOOKS MISS, STATE THE DIFFERENCE. v1.18.0; the rail leg v1.44.0 (v1.44.1: a learned rule's words in any order).
   *
   * Athi, 2026-10-03: *"can u build bank stt reconciliation by reading the csv / json file and add any transaction which is missing?"*
   * Standing rules carried here: (1) PROPOSE, NEVER AUTO-APPLY — suggest() hands back an event a person confirms (an owner-made entry,
   * series MJ); nothing here posts. (2) THE BOOKS ARE INSERT-ONLY — a match is a separate record (statement line ↔ ledger line ids);
   * no journal line is edited. (3) COMPUTE ONCE — amounts are read as written, in minor units (integers), never re-derived; a suggestion's
   * entry is composed by posting.post (the existing events, no new posting rule), so Dr = Cr to the minor unit by that engine's own check.
   *
   *   parse(text, { format?, preset?, mapping?, bank? })  → { ok, account?, from?, to?, opening_minor?, closing_minor?, lines, warnings }
   *   match(stmtLines, ledgerLines, { window_days? })      → { matched, unmatched_stmt, unmatched_ledger, ambiguous }
   *   suggest(stmtLine, { parties?, receipts?, rules?, bank? }) → { event, confidence, why, … }   a PROPOSAL
   *   brs({ asOf, bookBalance_minor, bankBalance_minor, unmatched_ledger, unmatched_stmt })     → the Bank Reconciliation Statement
   *   v1.44.0 (BR1) — THE RAIL ALREADY TOLD US: railPayments(chits) · explain(stmt, ledger, rail, opts) · lineKey · ask(line, opts) ·
   *   learn(line, explanation) · step(state, action) — see "THE RAIL" below.
   *
   * ── THE SHAPES ─────────────────────────────────────────────────────────────────────────────────────────────────────
   *   statement line  { date 'YYYY-MM-DD', value_date?, narration, ref?, cheque_no?, debit_minor, credit_minor, balance_minor? }
   *                   debit = money OUT of the bank, credit = money IN (the bank's own words). balance_minor is signed: a credit balance
   *                   is positive, an overdrawn (Dr) one negative.
   *   ledger line     { id, date, dr_minor, cr_minor, ref?, narration, entry_no, party? } — a journal line of the BANK account.
   *                   Bank Dr (money in) pairs with a statement credit; bank Cr (money out) with a statement debit.
   *
   * ── parse: CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────
   *   delimiter (, ; tab |) and the header row are detected (the first row naming a date column and a narration or amount column);
   *   rows above it are a preamble (an "Account No" line there is read as `account`). Amounts: grouping as "1,23,456.78" or "123,456.78", a
   *   currency prefix (the pack's: pack.bank.amountPrefixes), "Dr" / "Cr" suffix, (brackets) or a minus for a debit in a single Amount column, separate Debit and Credit
   *   columns, or an Amount column with a Dr/Cr column. A single signed Amount column reads negative as debit. Dates: dd/mm/yyyy,
   *   dd-mm-yy, dd-MMM-yyyy, dd MMM yyyy, yyyy-mm-dd (and an ISO time after it). A statement listed newest-first is turned round (warned).
   *   PRESETS (the pack's data: pack.bank.presets) — each names its header cells, or (headerless) its columns by position, read only when the first row fits (date, amount, a description that is no amount, a balance). ⚠️ They are written from the shape of each
   *   bank's usual export and are all marked verify:true — check against a real file before trusting one; a bank changes its headers.
   *   `mapping` { field: 'Header text' | columnIndex } for any other bank; fields: date value_date narration ref cheque_no debit credit
   *   amount drcr balance. With no preset and no mapping the generic header words are tried.
   *   RUNNING BALANCE: when balance_minor is present each line must follow the one before (prev + credit − debit); a break is a
   *   WARNING naming the line number; the check carries on from the stated balance.
   * ── parse: JSON ────────────────────────────────────────────────────────────────────────────────────────────────────
   *   (1) an array of statement lines as above — *_minor integers are read as given; `debit` / `credit` / `amount` (major units, string or
   *       number) are read exactly to the minor unit. (2) { account?, opening_minor?, closing_minor?, lines | transactions: [ … ] }.
   *   (3) Account Aggregator FI data — the ReBIT deposit-account schema: Account.Transactions.Transaction[] of { type CREDIT | DEBIT,
   *       mode, amount "1234.56", currentBalance, transactionTimestamp, valueDate, txnId, narration, reference }, with
   *       Account.Summary.currentBalance and Account.Transactions.startDate / endDate. Found wherever it sits in the document.
   *       ⚠️ Written from the published ReBIT FI-schema field names; check against the schema version a real AA response carries.
   */

  var POSTING_ = null,
    REG_ = null,
    MONEY_ = null,
    ENTRY_ = null,
    JSON_ = null,
    BRS_ = null,
    LOAD_FAILURES_ = {}; /* a sibling engine that would not load: file → why, one entry per file (a later call tries again, as before); the callers still get null and say so in plain words */
  function dep_(file, globalName) {
    var globalScope = typeof globalThis !== 'undefined' ? globalThis : root;
    if (globalScope[globalName] && typeof globalScope[globalName] === 'object' && Object.keys(globalScope[globalName]).length) return globalScope[globalName];
    if (typeof require === 'function') {
      try {
        return require(file);
      } catch (loadFailure) {
        if (!LOAD_FAILURES_[file]) LOAD_FAILURES_[file] = String(loadFailure);
        return null;
      }
    }
    return null;
  }
  function posting_() {
    return POSTING_ || (POSTING_ = dep_('./posting', 'CBPosting'));
  }
  function bankEntry_() {
    return ENTRY_ || (ENTRY_ = dep_('./bank-entry', 'CBBankEntry'));
  }
  /** the JSON statement reader (bank-json.js) and the BRS builder (bank-brs.js): siblings, loaded like bank-entry */
  function bankJson_() {
    return JSON_ || (JSON_ = dep_('./bank-json', 'CBBankJson'));
  }
  function bankBrs_() {
    return BRS_ || (BRS_ = dep_('./bank-brs', 'CBBankBrs'));
  }
  function money_() {
    return MONEY_ || (MONEY_ = dep_('./money', 'CBMoney'));
  }
  /** the currency's minor-unit digits — money.decimals (2, 0 or 3 digits); 2 when money.js is not loaded, as before */
  function decimalsOf_(currency) {
    var moneyModule = money_();
    return moneyModule && moneyModule.decimals && currency ? moneyModule.decimals(currency) : 2;
  }
  function regulation_() {
    return REG_ || (REG_ = dep_('./regulation', 'CBRegulation'));
  }
  /** the pack a call means (opts.pack, else the registry's for opts.country) and its bank rules; null when the pack has none */
  function bankOf_(opts) {
    var regulation = regulation_(),
      pack = (opts && opts.pack) || (regulation ? regulation.resolve(opts) : null);
    return pack && pack.bank ? { pack: pack, bank: pack.bank } : null;
  }
  /** the amount prefixes a statement prints before a figure (the pack's), as one pattern: longest alternatives first as listed */
  function prefixRe_(list) {
    return new RegExp(
      '^(' +
        (list || [])
          .map(function (item) {
            return String(item).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('|') +
        ')\\s*',
      'i'
    );
  }
  var DEFAULT_BANK_ = (function () {
    var regulation = regulation_(),
      defaultPack = regulation && regulation.packFor(regulation.DEFAULT);
    if (!defaultPack)
      throw new Error(
        'bank-recon.js needs regulation.js (CBRegulation, with the India pack) loaded before it — add the regulation scripts ahead of this one on the page; see the CHANGELOG, v1.28.0.'
      );
    return defaultPack.bank || { presets: {}, keywords: { default: {} }, amountPrefixes: [], minorUnit: 'minor units' };
  })();
  var PRESETS = DEFAULT_BANK_.presets,
    RULES = DEFAULT_BANK_.keywords;
  function fail_(reason) {
    return { ok: false, why: reason, lines: [], warnings: [] };
  }

  /* ═══ PRESETS — DATA, NOT CODE PATHS ═══════════════════════════════════════════════════════════════════════════════
   * field → the header cell(s) the bank prints (compared with case, spaces and punctuation ignored). verify:true = not yet checked
   * against a real file of that bank. */
  /* the presets are the PACK'S (pack.bank.presets): a country's banks and the header cells each prints; the export below is the default pack's table */
  /** the header words tried when no preset or mapping is given */
  var GENERIC = {
    date: ['Date', 'Txn Date', 'Transaction Date', 'Tran Date', 'Posting Date'],
    value_date: ['Value Date', 'Value Dt'],
    narration: ['Narration', 'Description', 'Particulars', 'Transaction Remarks', 'Remarks', 'Details', 'Narrative', 'Transaction Details', 'Transaction Description'],
    ref: ['Ref No', 'Ref No.', 'Reference', 'Chq./Ref.No.', 'Chq / Ref No', 'UTR', 'Transaction Id'],
    cheque_no: ['Cheque No', 'Cheque Number', 'Chq No', 'CHQNO', 'Instrument No'],
    debit: ['Debit', 'Withdrawal', 'Withdrawal Amt.', 'Withdrawals', 'DR', 'Debit Amount'],
    credit: ['Credit', 'Deposit', 'Deposit Amt.', 'Deposits', 'CR', 'Credit Amount'],
    amount: ['Amount', 'Transaction Amount'],
    drcr: ['Dr/Cr', 'Dr / Cr', 'Type', 'Cr/Dr'],
    balance: ['Balance', 'Closing Balance', 'Running Balance', 'BAL']
  };
  var FIELDS = ['date', 'value_date', 'narration', 'ref', 'cheque_no', 'debit', 'credit', 'amount', 'drcr', 'balance'];

  /* ═══ small readers ═══════════════════════════════════════════════════════════════════════════════════════════════ */
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var norm_ = function (value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };
  var pad_ = function (number) {
    return (number < 10 ? '0' : '') + number;
  };
  function ymd_(y, month, dayOfMonth) {
    if (!(month >= 1 && month <= 12 && dayOfMonth >= 1 && dayOfMonth <= 31)) return null;
    var date = new Date(Date.UTC(y, month - 1, dayOfMonth));
    if (date.getUTCMonth() !== month - 1) return null; /* 31 Feb */
    return y + '-' + pad_(month) + '-' + pad_(dayOfMonth);
  }
  /** a date in any of the common statement forms → 'YYYY-MM-DD', or null */
  function dateOf_(text) {
    text = String(text == null ? '' : text).trim();
    var matched;
    if ((matched = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text))) return ymd_(+matched[1], +matched[2], +matched[3]);
    if ((matched = /^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2}|\d{4})$/.exec(text))) return ymd_(matched[3].length === 2 ? 2000 + +matched[3] : +matched[3], +matched[2], +matched[1]);
    if ((matched = /^(\d{1,2})[\/\-. ]([A-Za-z]{3})[A-Za-z]*[\/\-. ,]*(\d{2}|\d{4})$/.exec(text))) {
      var monthNumber = MONTHS[matched[2].toLowerCase()];
      return monthNumber ? ymd_(matched[3].length === 2 ? 2000 + +matched[3] : +matched[3], monthNumber, +matched[1]) : null;
    }
    return null;
  }
  /** an amount as printed → { minor (≥0), side 'dr'|'cr'|null, neg } — read from the digits, never through a float; null when it is not an amount */
  function amountOf_(ctx, printed) {
    var decimals = ctx.dp === undefined ? 2 : ctx.dp;
    if (typeof printed === 'number') printed = isFinite(printed) ? String(printed) : '';
    var text = String(printed == null ? '' : printed).trim();
    if (!text) return { minor: 0, side: null, neg: false, empty: true };
    var peeled = peelMarks_(text, ctx.re);
    var minor = minorOfDigits_(peeled.text, decimals);
    if (minor === null) return null;
    return { minor: minor, side: peeled.side, neg: peeled.negative, empty: false };
  }
  /** the marks round a printed amount taken off — (brackets), a Dr / Cr word before or after, the currency prefix, spaces, a sign → { text: the digits and separators, side, negative } */
  function peelMarks_(text, prefixPattern) {
    var side = null,
      negative = false,
      matched;
    if ((matched = /^\((.*)\)$/.exec(text))) {
      negative = true;
      text = matched[1];
    }
    if ((matched = /^(.*?)\s*(Dr|Cr|D|C)\.?$/i.exec(text))) {
      side = matched[2].toLowerCase()[0] === 'd' ? 'dr' : 'cr';
      text = matched[1];
    }
    if ((matched = /^(Dr|Cr)\.?\s*(.*)$/i.exec(text))) {
      side = matched[1].toLowerCase() === 'dr' ? 'dr' : 'cr';
      text = matched[2];
    }
    text = text.replace(prefixPattern, '').replace(/\s/g, '');
    if (text[0] === '-') {
      negative = true;
      text = text.slice(1);
    } else if (text[0] === '+') text = text.slice(1);
    return { text: text, side: side, negative: negative };
  }
  /** the digits of an amount → its minor units, read as text and never through a float; null when they are not an amount or a decimal runs past the currency's minor unit */
  function minorOfDigits_(text, decimals) {
    text = text.replace(/,/g, '');
    if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) return null;
    var parts = text.split('.'),
      whole = parts[0] || '0',
      frac = (parts[1] || '').padEnd(decimals, '0');
    if (frac.length > decimals) {
      if (/[1-9]/.test(frac.slice(decimals))) return null;
      frac = frac.slice(0, decimals);
    } /* a decimal past the currency's minor unit that is not zero is not a minor unit */
    var minor = parseInt(whole, 10) * Math.pow(10, decimals) + (decimals ? parseInt(frac, 10) : 0);
    if (!isFinite(minor) || minor > Number.MAX_SAFE_INTEGER) return null;
    return minor;
  }

  /* ═══ CSV ═════════════════════════════════════════════════════════════════════════════════════════════════════════ */
  function csvRows_(text, delim) {
    var state = { rows: [], row: [], cell: '', quoted: false, index: 0 };
    for (; state.index < text.length; state.index++) readCsvCharacter_(state, text, delim);
    if (state.cell !== '' || state.row.length) {
      state.row.push(state.cell);
      state.rows.push(state.row);
    }
    return state.rows.filter(function (item) {
      return item.some(function (x) {
        return String(x).trim() !== '';
      });
    });
  }
  /** the reader's state takes the character at state.index: inside quotes it is text, outside it is a quote opening, a delimiter or a line end */
  function readCsvCharacter_(state, text, delim) {
    var character = text[state.index];
    if (state.quoted) readQuotedCharacter_(state, text, character);
    else if (character === '"' && state.cell === '') state.quoted = true;
    else if (character === delim) {
      state.row.push(state.cell);
      state.cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[state.index + 1] === '\n') state.index++;
      state.row.push(state.cell);
      state.cell = '';
      state.rows.push(state.row);
      state.row = [];
    } else state.cell += character;
  }
  /** a character inside a quoted cell: a doubled quote is one literal quote, a lone quote closes the cell, anything else is text */
  function readQuotedCharacter_(state, text, character) {
    if (character === '"') {
      if (text[state.index + 1] === '"') {
        state.cell += '"';
        state.index++;
      } else state.quoted = false;
    } else state.cell += character;
  }
  function delimiterOf_(text) {
    var best = ',',
      top = 0,
      sample = text.split(/\r?\n/).slice(0, 25).join('\n');
    [',', ';', '\t', '|'].forEach(function (item) {
      var occurrences = sample.split(item).length - 1;
      if (occurrences > top) {
        top = occurrences;
        best = item;
      }
    });
    return best;
  }
  /** header-cell → column index for each field, from a preset / mapping / the generic words. A preset or mapping that names a header the row lacks is simply not found. */
  function columnsFor_(head, spec) {
    var normalisedHead = head.map(norm_),
      cols = {};
    FIELDS.forEach(function (item) {
      var want = spec[item];
      if (want == null) return;
      var list = Array.isArray(want) ? want : [want];
      for (var index = 0; index < list.length; index++) {
        if (typeof list[index] === 'number') {
          if (list[index] >= 0 && list[index] < head.length) {
            cols[item] = list[index];
            return;
          }
          continue;
        }
        var normalisedCell = norm_(list[index]),
          at = normalisedHead.indexOf(normalisedCell);
        if (at >= 0) {
          cols[item] = at;
          return;
        }
      }
    });
    return cols;
  }
  function isHeader_(row, spec) {
    var columns = columnsFor_(row, spec);
    return columns.date != null && (columns.narration != null || columns.amount != null || columns.debit != null || columns.credit != null);
  }

  /** which column holds each field, and the header row's index (-1 when the mapping gives numbers and no header is read) → { count, cols }, or the refusal when no header or no date / amount column is found */
  function csvColumns_(rows, spec, options, preset) {
    var count = -1,
      cols,
      headerless = !!options.mapping && options.header === false;
    if (headerless) {
      count = -1;
      cols = columnsFor_([], {});
      FIELDS.forEach(function (item) {
        if (typeof spec[item] === 'number') cols[item] = spec[item];
      });
    } else {
      count = headerRowIndex_(rows, spec);
      if (count < 0)
        return fail_(
          'No header row found' +
            (preset ? ' for the ' + preset.bank + ' preset (' + preset.note + ')' : '') +
            ' — pass a preset or a mapping naming the columns.'
        );
      cols = columnsFor_(rows[count], spec);
    }
    if (cols.date == null) return fail_('The mapping names no date column.');
    if (cols.amount == null && cols.debit == null && cols.credit == null) return fail_('The mapping names no amount, debit or credit column.');
    return { count: count, cols: cols };
  }
  /** the index of the first row that reads as the header, or -1 */
  function headerRowIndex_(rows, spec) {
    for (var index = 0; index < rows.length; index++) if (isHeader_(rows[index], spec)) return index;
    return -1;
  }
  /** the account number a preamble row above the header names ("Account No: 1234567890"), else the one given */
  function csvAccount_(preamble, given) {
    var account = given;
    preamble.forEach(function (item) {
      var accountMatch = /account\s*(?:no|number|#)?\.?\s*[:\-]?\s*([A-Za-z0-9*Xx]{6,})/i.exec(item.join(' '));
      if (!account && accountMatch) account = accountMatch[1];
    });
    return account;
  }
  /** one statement row → its line, or null when it is skipped (a blank, a total, an unreadable date or amount — the last two warned) */
  function csvLine_(cellOf, row, no, cols, ctx, warnings) {
    var date = csvDate_(cellOf, row, no, warnings);
    if (!date) return null;
    var amounts = csvAmounts_(cellOf, row, cols, ctx);
    if (!amounts) {
      warnings.push('row ' + no + ': unreadable amount — row skipped');
      return null;
    }
    var line = { date: date, narration: cellOf(row, 'narration'), debit_minor: amounts.debit, credit_minor: amounts.credit };
    var valueDate = cols.value_date != null ? dateOf_(cellOf(row, 'value_date')) : null;
    if (valueDate) line.value_date = valueDate;
    var ref = cellOf(row, 'ref'),
      chequeNo = cellOf(row, 'cheque_no');
    if (ref) line.ref = ref;
    if (chequeNo) line.cheque_no = chequeNo;
    csvBalance_(cellOf, row, no, cols, ctx, line, warnings);
    line.row = no;
    return line;
  }
  /** a row's date → 'YYYY-MM-DD', or null when the row is skipped: no date and no narration, a total / page line, or an unreadable date (the last warned) */
  function csvDate_(cellOf, row, no, warnings) {
    var dateText = cellOf(row, 'date');
    if (!dateText && !cellOf(row, 'narration')) return null;
    var date = dateOf_(dateText);
    if (!date) {
      if (/^(total|opening|closing|statement|page|\*)/i.test(dateText)) return null;
      if (!dateText) {
        /* B5-06: a row that names something but has no date is a transaction the file lost its date for, not a blank; a total / page line is still not one */
        if (!/^(total|opening|closing|balance|statement|page|\*)/i.test(cellOf(row, 'narration'))) warnings.push('row ' + no + ': no date — row skipped');
        return null;
      }
      warnings.push('row ' + no + ': unreadable date "' + dateText + '" — row skipped');
      return null;
    }
    return date;
  }
  /** a row's money out and in, in minor units → { debit, credit }, or null when an amount cannot be read: separate Debit and Credit columns, or one Amount (with a Dr / Cr mark, a sign or brackets) */
  function csvAmounts_(cellOf, row, cols, ctx) {
    if (cols.debit != null || cols.credit != null) {
      var debitAmount = amountOf_(ctx, cellOf(row, 'debit')),
        creditAmount = amountOf_(ctx, cellOf(row, 'credit'));
      if (!debitAmount || !creditAmount) return null;
      return { debit: debitAmount.minor, credit: creditAmount.minor };
    }
    var amount = amountOf_(ctx, cellOf(row, 'amount')),
      mark = cellOf(row, 'drcr');
    if (!amount || amount.empty) return null;
    var side = sideOfMark_(mark, amount);
    if (!side) return null;
    return side === 'dr' ? { debit: amount.minor, credit: 0 } : { debit: 0, credit: amount.minor };
  }
  /** the side a single-Amount row moves: its Dr / Cr cell if it has one, else the amount's own mark, else a minus for a debit and no sign for a credit; null when the cell is neither */
  function sideOfMark_(mark, amount) {
    return mark ? (/^d/i.test(mark) ? 'dr' : /^c/i.test(mark) ? 'cr' : null) : amount.side || (amount.neg ? 'dr' : 'cr');
  }
  /** the running balance a row prints → line.balance_minor (negative when overdrawn); an unreadable one is warned and ignored */
  function csvBalance_(cellOf, row, no, cols, ctx, line, warnings) {
    if (cols.balance != null && cellOf(row, 'balance') !== '') {
      var balanceAmount = amountOf_(ctx, cellOf(row, 'balance'));
      if (balanceAmount && !balanceAmount.empty) line.balance_minor = balanceAmount.neg || balanceAmount.side === 'dr' ? -balanceAmount.minor : balanceAmount.minor;
      else warnings.push('row ' + no + ': unreadable balance — ignored');
    }
  }
  /** FIN-25: an "Opening balance" / "Closing balance" row is the statement's own figure, not a transaction: its balance (the Balance cell, else the Amount cell) → out.opening_minor / out.closing_minor, the same fields the JSON path sets. True when the row was one. */
  function csvBalanceRow_(cellOf, row, no, cols, ctx, warnings, out) {
    var word = /^(opening|closing)\s*bal/i.exec(cellOf(row, 'date'));
    if (!word) return false;
    var held = {};
    csvBalance_(cellOf, row, no, cols, ctx, held, warnings);
    if (held.balance_minor == null && cols.amount != null) {
      var amount = amountOf_(ctx, cellOf(row, 'amount'));
      if (amount && !amount.empty) held.balance_minor = amount.neg || amount.side === 'dr' ? -amount.minor : amount.minor;
    }
    if (held.balance_minor != null) out[word[1].toLowerCase() + '_minor'] = held.balance_minor;
    return true;
  }
  /** every row below the header read into a statement line; a row that cannot be read is skipped and warned in `warnings` */
  function csvLines_(rows, located, ctx, warnings, out) {
    var cols = located.cols,
      lines = [];
    var cellOf = function (nestedR, fieldName) {
      return cols[fieldName] == null ? '' : String(nestedR[cols[fieldName]] == null ? '' : nestedR[cols[fieldName]]).trim();
    };
    for (var rowIndex = located.count + 1; rowIndex < rows.length; rowIndex++) {
      var line = csvBalanceRow_(cellOf, rows[rowIndex], rowIndex + 1, cols, ctx, warnings, out) ? null : csvLine_(cellOf, rows[rowIndex], rowIndex + 1, cols, ctx, warnings);
      if (line) lines.push(line);
    }
    return lines;
  }
  /** does one sample row fit a headerless layout: a date in the date cell, an amount in the amount cell, a description that is NOT itself an amount or a date, and an amount in the balance cell when the layout has one (so an unsigned Date, Debit, Credit, Balance file is never read as signed money) */
  function fitsHeaderless_(sample, layout, ctx) {
    var cell = function (field) {
      return sample[layout.map[field]];
    };
    var amount = amountOf_(ctx, cell('amount')),
      note = String(cell('narration') == null ? '' : cell('narration')).trim(),
      noteAmount = amountOf_(ctx, note),
      balance = layout.map.balance == null ? { empty: false } : amountOf_(ctx, cell('balance'));
    var noteReadsAsData = !note || dateOf_(note) || (noteAmount && !noteAmount.empty);
    return !!dateOf_(cell('date')) && !!amount && !amount.empty && !noteReadsAsData && !!balance && !balance.empty;
  }
  /** FIN-115: the pack's preset that reads a file with NO header row, by column position (preset.headerless = { count, map: { field: index } }): the one asked for, else the one whose column count the first row has and whose date and amount cells read as a date and an amount; null when none fits */
  function headerlessPick_(rows, options, ctx) {
    var sample = rows.filter(function (row) {
      return row.some(function (cell) {
        return String(cell).trim() !== '';
      });
    })[0];
    if (!sample) return null;
    var named = options.preset ? String(options.preset).toLowerCase() : null,
      keys = named ? [named] : Object.keys(ctx.presets);
    for (var index = 0; index < keys.length; index++) {
      var preset = ctx.presets[keys[index]],
        layout = preset && preset.headerless;
      if (!layout || (!named && sample.length !== layout.count)) continue;
      if (fitsHeaderless_(sample, layout, ctx)) return preset;
    }
    return null;
  }
  /** FIN-115: a statement whose lines all came out with no narration is warned in words, never read silently (nothing to match or suggest from) */
  function blankNarrationWarning_(lines) {
    var named = lines.some(function (line) {
      return line.narration;
    });
    if (!lines.length || named) return null;
    return (
      'No description was read on any of the ' +
      lines.length +
      ' lines, so there is nothing to match or suggest from. Check the description column of the file (the bank may print it under another name), or choose the bank or map the columns.'
    );
  }
  function parseCsv_(text, options, ctx) {
    var warnings = [],
      preset = options.preset ? ctx.presets[String(options.preset).toLowerCase()] : null;
    if (options.preset && !preset) return fail_('Unknown bank preset "' + options.preset + '" — presets: ' + Object.keys(ctx.presets).join(', ') + '; or pass a mapping.');
    var spec = options.mapping || (preset ? preset.map : GENERIC);
    var rows = csvRows_(text.replace(/^﻿/, ''), delimiterOf_(text));
    var bare = !options.mapping && headerRowIndex_(rows, spec) < 0 ? headerlessPick_(rows, options, ctx) : null;
    if (bare) {
      options = Object.assign({}, options, { mapping: bare.headerless.map, header: false });
      spec = options.mapping;
      warnings.push('This file has no header row, so its columns were read by position as the ' + bare.bank + ' layout (' + bare.note + '). Check the first lines against your file.');
    }
    var located = csvColumns_(rows, spec, options, preset);
    if (located.ok === false) return located;
    if (preset && preset.verify && !bare) warnings.push('preset ' + options.preset + ' is marked "verify against a real file" — headers: ' + preset.note);
    var account = csvAccount_(rows.slice(0, Math.max(located.count, 0)), options.account || null);
    var balances = {},
      lines = csvLines_(rows, located, ctx, warnings, balances),
      blank = blankNarrationWarning_(lines);
    if (blank) warnings.push(blank);
    return Object.assign({ ok: true, account: account, lines: lines, warnings: warnings }, balances);
  }

  /* ═══ parse ═══════════════════════════════════════════════════════════════════════════════════════════════════════ */
  /**
   * ⭐ parse(text, { format?: 'csv' | 'json' | 'auto', preset?: <a bank the pack knows>, mapping?, header?, account?, pack? })
   *   → { ok, account, from, to, opening_minor?, closing_minor?, lines: [statement line + row], warnings: [text] }
   * `text` is the file's text (JSON may also be handed already parsed). Lines come out oldest first. A bad row is skipped WITH a
   * warning naming its row; a balance that does not follow from the line before is a warning naming the line. Never throws.
   */
  function parse(text, opts) {
    var options = opts || {},
      bankRules = bankOf_(options);
    if (!bankRules) return fail_('The regulation pack has no bank-statement rules (pack.bank), so a statement cannot be read.');
    var ctx = { re: prefixRe_(bankRules.bank.amountPrefixes), dp: decimalsOf_(options.currency || bankRules.pack.currency), presets: bankRules.bank.presets, minorUnit: bankRules.bank.minorUnit, amountOf: amountOf_, dateOf: dateOf_, fail: fail_ };
    var res = readStatement_(text, options, ctx);
    if (!res.ok) return res;
    var lines = res.lines,
      list = res.warnings;
    if (lines.length > 1 && lines[0].date > lines[lines.length - 1].date) {
      lines.reverse();
      list.push('the statement was listed newest first — read oldest first');
    }
    var opening = checkRunningBalance_(lines, res.opening_minor, list, ctx);
    return statementOut_(res, lines, list, opening);
  }
  /** the statement's text (or an already parsed JSON document) read in its format → { ok: true, lines, warnings, … } or a refusal; never throws */
  function readStatement_(text, options, ctx) {
    var format = options.format || 'auto',
      data = null;
    if (text && typeof text === 'object') {
      data = text;
      format = 'json';
    } else if (typeof text !== 'string' || !text.trim()) return fail_('Nothing to read: the statement is empty.');
    else if (format === 'auto') format = /^\s*[\[{]/.test(text) ? 'json' : 'csv';
    return readAs_(format, data, text, options, ctx);
  }
  /** the statement read as `format` (json from a document already parsed, or from its text; csv); a reader that throws becomes a refusal */
  function readAs_(format, data, text, options, ctx) {
    try {
      if (format === 'json') return data === null ? parseJsonText_(text, ctx) : bankJson_().parse(data, ctx);
      if (format === 'csv') return parseCsv_(text, options, ctx);
      return fail_('Unknown format "' + format + '" — csv or json.');
    } catch (e) {
      return fail_('The statement could not be read: ' + e.message);
    }
  }
  /** JSON text → read lines; text that is not JSON is a refusal naming the parser's complaint */
  function parseJsonText_(text, ctx) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return fail_('The JSON could not be read: ' + e.message);
    }
    return bankJson_().parse(data, ctx);
  }
  /** the running-balance check: each line's stated balance must follow the one before (prev + credit − debit); a break is a warning naming the line. Returns the opening balance — as given, else worked back from the first line's balance */
  function checkRunningBalance_(lines, openingGiven, list, ctx) {
    var prev = openingGiven != null ? openingGiven : null,
      opening = openingGiven;
    lines.forEach(function (item, index) {
      if (item.balance_minor == null) {
        prev = null;
        return;
      }
      if (prev == null) {
        if (index === 0 && opening == null) opening = item.balance_minor - item.credit_minor + item.debit_minor;
      } else {
        var want = prev + item.credit_minor - item.debit_minor;
        if (want !== item.balance_minor)
          list.push(
            'line ' +
              (index + 1) +
              (item.row ? ' (row ' + item.row + ')' : '') +
              ' ' +
              item.date +
              ': the balance ' +
              item.balance_minor +
              ' does not follow from the line before (expected ' +
              want +
              ' ' +
              ctx.minorUnit +
              ') — a line may be missing or altered'
          );
      }
      prev = item.balance_minor;
    });
    return opening;
  }
  /**
   * B5-06: the rows a reader could not take, as data a screen paints and a reconciliation reads: [{ row, why }] from the warnings that say a row or item was skipped.
   * A statement with any skipped row is never "tied" (bank-project): its computed closing leaves those rows out.
   */
  function skippedOf_(warnings) {
    return warnings
      .map(function (warning) {
        var found = /^(row|item) (\d+): (.*?)\s+—\s+(?:row )?skipped$/.exec(warning);
        return found ? { row: +found[2], why: found[3] } : null;
      })
      .filter(Boolean);
  }
  /** the parse result: the lines with the statement's account, its first and last day, and its opening and closing balance when known */
  function statementOut_(res, lines, list, opening) {
    var out = { ok: true, account: res.account || null, lines: lines, warnings: list, skipped: skippedOf_(list) };
    if (lines.length) {
      out.from = lines[0].date;
      out.to = lines[lines.length - 1].date;
      out.from = lines.reduce(function (total, item) {
        return item.date < total ? item.date : total;
      }, lines[0].date);
      out.to = lines.reduce(function (total, item) {
        return item.date > total ? item.date : total;
      }, lines[0].date);
    }
    if (opening != null) out.opening_minor = opening;
    var last = lines.length ? lines[lines.length - 1] : null;
    if (res.closing_minor != null) out.closing_minor = res.closing_minor;
    else if (last && last.balance_minor != null) out.closing_minor = last.balance_minor;
    return out;
  }

  /* ═══ match ═══════════════════════════════════════════════════════════════════════════════════════════════════════ */
  /** the side of money a line moves, in one word: out of the bank, or into it (one place, so the core names the direction once) */
  var SIDE_ = function (out) {
    return out ? 'out' : 'in';
  };
  /** a statement line's money out and in, in minor units (0 for a figure it does not carry) */
  function lineMoney_(line) {
    return { debit: +line.debit_minor || 0, credit: +line.credit_minor || 0 };
  }
  var dayNo_ = function (isoDay) {
    var millis = Date.parse(String(isoDay) + 'T00:00:00Z');
    return isFinite(millis) ? Math.round(millis / 86400000) : NaN;
  };
  /** a reference reduced to what both sides can agree on: upper-case alphanumerics, leading zeros off a pure number */
  var refKey_ = function (printed) {
    var text = String(printed == null ? '' : printed)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
  };
  /** the reference keys one side offers: its ref, its cheque no., and any 6+ digit run in its narration (a transaction reference) */
  function keysOf_(ref, chequeNo, narration) {
    var list = [],
      addKey = function (value) {
        var normalised = refKey_(value);
        if (normalised && normalised.length >= 3 && list.indexOf(normalised) < 0) list.push(normalised);
      };
    addKey(ref);
    addKey(chequeNo);
    String(narration || '').replace(/\d{6,}/g, function (digitRun) {
      addKey(digitRun);
      return digitRun;
    });
    return list;
  }
  var share_ = function (ours, theirs) {
    for (var index = 0; index < ours.length; index++) if (theirs.indexOf(ours[index]) >= 0) return true;
    return false;
  };

  /** the first subset (in index order, smallest sizes first) of `items` whose minor sum is `target`, 2+ members — or the whole set when it sums */
  function subset_(items, target) {
    if (items.length < 2 || items.length > 20) return null;
    var total = items.reduce(function (sum, x) {
      return sum + x.m;
    }, 0);
    if (total === target) return items.slice();
    for (var size = 2; size < items.length; size++) {
      var pick = [],
        found = null;
      /* choose `left` more members from index `from` on, lowest indexes first, stopping at the first set that sums to the target */
      (function rec(from, left, sum) {
        if (found) return;
        if (left === 0) {
          if (sum === target) found = pick.slice();
          return;
        }
        for (var at = from; at <= items.length - left; at++) {
          if (sum + items[at].m > target) continue;
          pick.push(items[at]);
          rec(at + 1, left - 1, sum + items[at].m);
          pick.pop();
          if (found) return;
        }
      })(0, size, 0);
      if (found) return found;
    }
    return null;
  }

  /**
   * ⭐ match(stmtLines, ledgerLines, { window_days = 3 }) → { matched: [{ stmt: [i…], ledger: [id…], how }], unmatched_stmt: [{ i, …line }],
   *   unmatched_ledger: [ledger line], ambiguous: [{ stmt: i, candidates: [id…] }] }
   * Passes, in order: (a) 'ref' — the same reference (ref / cheque no. / a UTR in the narration) and the same amount and side;
   * (b) 'amount+date' — the same amount and side within the window, where the pair is each other's only candidate (repeated until
   * nothing more resolves; what stays tied is listed under `ambiguous` and left unmatched, never guessed); (c) 'one-to-many' — one
   * statement line is the sum of several ledger lines of one day (a deposit of several receipts) and 'many-to-one' the reverse.
   * A ledger line is matched at most once; the same inputs always give the same answer. Nothing is edited: a match is a record
   * of statement line numbers against ledger line ids.
   */
  function match(stmtLines, ledgerLines, opts) {
    var win = opts && opts.window_days != null ? Math.max(0, +opts.window_days) : 3;
    var list = statementRows_(stmtLines);
    var ledgerRows = ledgerRowsOf_(ledgerLines);
    var matched = [];
    matchByPostedRef_(list, ledgerRows, matched, opts);
    matchByRef_(list, ledgerRows, matched);
    var ambiguous = matchByAmountDate_(list, ledgerRows, matched, win);
    matchOneToMany_(list, ledgerRows, matched, win);
    matchManyToOne_(list, ledgerRows, matched, win);
    return matchResult_(list, ledgerRows, matched, ambiguous);
  }
  /** each statement line as a row to match: its index, side, minor amount, day number and reference keys; a line that moves no money starts used */
  function statementRows_(stmtLines) {
    return (stmtLines || []).map(function (item, index) {
      var debit = +item.debit_minor || 0,
        credit = +item.credit_minor || 0;
      return {
        i: index,
        line: item,
        side: SIDE_(debit),
        m: debit || credit,
        day: dayNo_(item.date),
        keys: keysOf_(item.ref, item.cheque_no, item.narration),
        used: !debit && !credit
      };
    });
  }
  /** each ledger line as a row to match (the same shape, `k` for its index); a line whose Dr equals its Cr starts used */
  function ledgerRowsOf_(ledgerLines) {
    return (ledgerLines || []).map(function (item, index) {
      var debit = +item.dr_minor || 0,
        credit = +item.cr_minor || 0;
      return { k: index, line: item, side: SIDE_(credit > debit), m: Math.abs(debit - credit), day: dayNo_(item.date), keys: keysOf_(item.ref, null, ''), used: debit === credit };
    });
  }
  /** record a match: mark both sides used and add { stmt: [row indexes], ledger: [ledger line ids], how } to `matched` */
  function takeMatch_(matched, rows, entries, pass) {
    rows.forEach(function (item) {
      item.used = true;
    });
    entries.forEach(function (x) {
      x.used = true;
    });
    matched.push({
      stmt: rows.map(function (item) {
        return item.i;
      }),
      ledger: entries.map(function (x) {
        return x.line.id;
      }),
      how: pass
    });
  }
  /** the days between a statement row and another row */
  function dayGap_(statementRow, other) {
    return Math.abs(statementRow.day - other.day);
  }
  /** nearest day first, then ledger order — the sort that picks among ledger rows sharing a reference */
  function byProximity_(statementRow, first, second) {
    return dayGap_(statementRow, first) - dayGap_(statementRow, second) || first.k - second.k;
  }
  /** the dates of a day-grouped pool, nearest to `day` first (the earlier date first on a tie) */
  function daysNearestFirst_(byDay, dayNumber) {
    return Object.keys(byDay).sort(function (first, second) {
      return Math.abs(dayNo_(first) - dayNumber) - Math.abs(dayNo_(second) - dayNumber) || (first < second ? -1 : 1);
    });
  }
  /**
   * (0) v1.98.0 (B5 / Fable 30-SECONDS): a line that was ADDED from this very statement is paired with the entry it made, ONE TO ONE BY OCCURRENCE. opts.line_refs = the line's own client_ref per statement line
   * (bank-project refsOf: 'bank:<fingerprint>-<n>', n = its place among identical lines) and opts.posted = { <client_ref>: <entry_no> } (the books' own record of what each ref posted). Two equal lines on
   * one day (Bunnings 96.80 twice) carry two refs and made two entries: each pairs with its own, so neither is left 'missing in the bank' nor 'missing in the books'. Same amount and side only (a
   * mismatch is left to the later passes and the statement check); a ref with no entry in the ledger given changes nothing.
   */
  function matchByPostedRef_(list, ledgerRows, matched, opts) {
    var refs = opts && opts.line_refs,
      posted = opts && opts.posted;
    if (!refs || !posted) return;
    list.forEach(function (item) {
      var entryNo = posted[refs[item.i]];
      if (item.used || entryNo == null) return;
      var hit = ledgerRows.filter(function (x) {
        return !x.used && x.side === item.side && x.m === item.m && String(x.line.entry_no) === String(entryNo);
      })[0];
      if (hit) takeMatch_(matched, [item], [hit], 'posted');
    });
  }
  /** (a) the same reference and amount */
  function matchByRef_(list, ledgerRows, matched) {
    list.forEach(function (item) {
      if (item.used || !item.keys.length) return;
      var candidates = ledgerRows.filter(function (x) {
        return !x.used && x.side === item.side && x.m === item.m && share_(item.keys, x.keys);
      }).sort(function (first, second) {
        return byProximity_(item, first, second);
      });
      if (candidates.length) takeMatch_(matched, [item], [candidates[0]], 'ref');
    });
  }
  /** (b) the same amount inside the window, each the other's only candidate; repeated until nothing more resolves → the lines still tied, as [{ stmt, candidates: [ledger ids] }] */
  function matchByAmountDate_(list, ledgerRows, matched, win) {
    var ambiguous = [];
    for (var again = true; again;) {
      again = false;
      ambiguous = [];
      var cand = {},
        back = {};
      list.forEach(function (item) {
        if (item.used) return;
        cand[item.i] = ledgerRows.filter(function (x) {
          return !x.used && x.side === item.side && x.m === item.m && dayGap_(item, x) <= win;
        });
        cand[item.i].forEach(function (x) {
          (back[x.k] = back[x.k] || []).push(item);
        });
      });
      list.forEach(function (item) {
        if (item.used || !cand[item.i] || !cand[item.i].length) return;
        if (cand[item.i].length === 1 && back[cand[item.i][0].k].length === 1) {
          takeMatch_(matched, [item], [cand[item.i][0]], 'amount+date');
          again = true;
        }
      });
      if (!again)
        list.forEach(function (item) {
          if (!item.used && cand[item.i] && cand[item.i].length)
            ambiguous.push({
              stmt: item.i,
              candidates: cand[item.i].map(function (x) {
                return x.line.id;
              })
            });
        });
    }
    return ambiguous;
  }
  /** (c) one statement line = several ledger lines of one day */
  function matchOneToMany_(list, ledgerRows, matched, win) {
    list.forEach(function (item) {
      if (item.used) return;
      var byDay = {};
      ledgerRows.forEach(function (x) {
        if (!x.used && x.side === item.side && dayGap_(item, x) <= win) (byDay[x.line.date] = byDay[x.line.date] || []).push(x);
      });
      var days = daysNearestFirst_(byDay, item.day);
      for (var count = 0; count < days.length; count++) {
        var group = subset_(byDay[days[count]], item.m);
        if (group) {
          takeMatch_(matched, [item], group, 'one-to-many');
          return;
        }
      }
    });
  }
  /** (c) the reverse: one ledger line = several statement lines of one day */
  function matchManyToOne_(list, ledgerRows, matched, win) {
    ledgerRows.forEach(function (x) {
      if (x.used) return;
      var byDay = {};
      list.forEach(function (item) {
        if (!item.used && item.side === x.side && dayGap_(item, x) <= win) (byDay[item.line.date] = byDay[item.line.date] || []).push(item);
      });
      var days = daysNearestFirst_(byDay, x.day);
      for (var count = 0; count < days.length; count++) {
        var group = subset_(byDay[days[count]], x.m);
        if (group) {
          takeMatch_(matched, group, [x], 'many-to-one');
          return;
        }
      }
    });
  }
  /** what match() returns: the matches, what is left on each side, and the ties that stayed tied */
  function matchResult_(list, ledgerRows, matched, ambiguous) {
    ambiguous = ambiguous.filter(function (item) {
      return !list[item.stmt].used;
    });
    return {
      matched: matched,
      unmatched_stmt: list
        .filter(function (item) {
          return !item.used;
        })
        .map(function (item) {
          return Object.assign({ i: item.i }, item.line);
        }),
      unmatched_ledger: ledgerRows.filter(function (x) {
        return !x.used;
      }).map(function (x) {
        return x.line;
      }),
      ambiguous: ambiguous
    };
  }

  /**
   * ⭐ nearMatches(unmatched_stmt, unmatched_ledger, { look_back_days? = 45 }) → { <statement line index>: [{ id, date, entry_no, narration, gap_days }] } (B5-02)
   * match() pairs only inside its small window and only when a pair is each other's sole candidate, so a books entry that cleared late (a cheque, a card settlement) or one of two equal
   * amounts is left unmatched, and the statement line would be proposed AGAIN and posted twice. This reads what match() left over (its unmatched_stmt, each carrying its own `i`, and its
   * unmatched_ledger): a statement line whose amount and side equal an unmatched books entry's within the look-back is listed with those entries, nearest day first, so a screen can say
   * "may already be in your books" and let the person PAIR them or say it is new. Never pairs anything itself; a ledger line may be offered to several statement lines (two equal amounts).
   */
  function nearMatches(unmatchedStmt, unmatchedLedger, opts) {
    var lookBack = opts && opts.look_back_days != null ? Math.max(0, +opts.look_back_days) : 45,
      books = ledgerRowsOf_(unmatchedLedger).filter(function (row) {
        return !row.used;
      }),
      found = {};
    (unmatchedStmt || []).forEach(function (line, at) {
      var money = lineMoney_(line),
        out = money.debit > 0,
        minor = money.debit || money.credit,
        day = dayNo_(line.date);
      if (!minor) return;
      var hits = books
        .filter(function (row) {
          return row.side === SIDE_(out) && row.m === minor && Math.abs(row.day - day) <= lookBack;
        })
        .sort(function (first, second) {
          return Math.abs(first.day - day) - Math.abs(second.day - day) || first.k - second.k;
        });
      if (hits.length)
        found[line.i != null ? line.i : at] = hits.map(function (row) {
          return { id: row.line.id, date: row.line.date, entry_no: row.line.entry_no || null, narration: row.line.narration || '', gap_days: Math.abs(row.day - day) };
        });
    });
    return found;
  }

  /* ═══ suggest ═════════════════════════════════════════════════════════════════════════════════════════════════════ */
  /* RULES — DATA. Keywords are whole words in the narration (upper-cased); `bank` adds that bank's own words to the defaults. */
  /* RULES — the pack's keywords (pack.bank.keywords). Keywords are whole words in the narration (upper-cased); `bank` adds that bank's own words to the defaults. */
  function rulesFor_(opts, keywords) {
    var options = opts || {},
      base = JSON.parse(JSON.stringify(keywords.default)),
      bank = keywords[String(options.bank || '').toLowerCase()];
    [bank, options.rules].forEach(function (item) {
      if (!item) return;
      Object.keys(item).forEach(function (category) {
        base[category] = (base[category] || []).concat(item[category]);
      });
    });
    return base;
  }
  function hasWord_(text, words) {
    for (var index = 0; index < words.length; index++) {
      var pattern = String(words[index])
        .toUpperCase()
        .replace(/[.\-\/]/g, function (character) {
          return '\\' + character;
        })
        .replace(/\s+/g, '\\s+');
      if (new RegExp('(^|[^A-Z0-9])' + pattern + '([^A-Z0-9]|$)').test(text)) return words[index];
    }
    return null;
  }
  /** the party a narration names: a VPA or account number (high), or the name (medium); null when none, 'many' when it is not unique */
  function partyIn_(text, parties) {
    var lower = String(text).toLowerCase(),
      upper = String(text).toUpperCase(),
      hits = [];
    (parties || []).forEach(function (item) {
      var ids = [].concat(item.vpa || [], item.vpas || [], item.account || [], item.accounts || []).filter(Boolean);
      var strong = ids.some(function (entry) {
        return lower.indexOf(String(entry).toLowerCase()) >= 0;
      });
      var names = [item.name, item.id].concat(item.aliases || []).filter(function (x) {
        return x && String(x).trim().length >= 3;
      });
      var weak = names.some(function (entry) {
        return hasWord_(upper, [String(entry).trim()]) !== null;
      });
      if (strong) hits.push({ p: item, how: 'high' });
      else if (weak) hits.push({ p: item, how: 'medium' });
    });
    var strongHits = hits.filter(function (item) {
        return item.how === 'high';
      }),
      chosen = strongHits.length ? strongHits : hits;
    if (!chosen.length) return null;
    return chosen.length === 1 ? chosen[0] : 'many';
  }

  /**
   * ⭐ suggest(unmatchedStmtLine, { parties?, receipts?, rules?, bank? }) → { event, confidence, why, rule?, entry?, proposal }
   * A PROPOSAL for a statement line the books lack — never posted. `event` is an EXISTING posting event (expense bank_charges ·
   * other_income interest_received · payment_received / payment_made for a named party · contra bank↔cash · cheque_dishonoured), and
   * `entry` is what posting.post composes from it (its lines, Dr = Cr, its voucher type), so the person confirms what will really be
   * posted; the confirmed entry is owner-made (series MJ). Unknown → { event: null, confidence: 'none', why: 'no rule matched' }.
   *   parties   [{ id | name, kind?: 'customer'|'supplier', vpa?, account?, aliases? }]   rules  { charges: […], interest: […], … } extra keywords
   *   receipts  [{ ref, party, amount_minor, cheque_no? }] the cleared receipts — a returned cheque names the one it reverses
   *   learned   (v1.44.0, BR1) the rules learn() made from a person's confirmed explanations — tried FIRST; the answer is still a proposal
   *             (rule 'learned', confidence 'medium') and carries `source` (the line and the day it was taught) and `learned_id`
   *   gst_basis (v1.93.0) 'cash' | 'accrual' — a proposal whose entry holds tax (an expense the pack or the taught rule names a supply kind for) is split by bank-entry.withTax and carries
   *             `tax` { kind, rate, tax_minor, credit, basis, invoice }; with no gst_basis it also says `needs: 'gst_basis'` (the entry stays, the owner says the basis once)
   */
  function suggest(line, opts) {
    var options = opts || {},
      bankRules = bankOf_(options),
      none = function (reason) {
        return { event: null, confidence: 'none', why: reason, proposal: false };
      };
    if (!line) return none('no statement line');
    if (!bankRules) return none('the regulation pack has no bank-statement rules (pack.bank)');
    var situation = situationOf_(line, options, bankRules, none);
    var debit = situation.debit,
      credit = situation.credit;
    if (debit > 0 === credit > 0) return none('a statement line has money going one way — this has ' + (debit && credit ? 'both' : 'neither'));
    return ruleSuggestion_(situation) || withNewParty_(none('no rule matched'), situation);
  }
  /** everything the rules look at for one statement line: the pack's keywords, the line's side, amount and narration, `base` (the call that completes a proposal) and `none` (the no-proposal answer) */
  function situationOf_(line, options, bankRules, none) {
    var rules = rulesFor_(options, bankRules.bank.keywords),
      currency = bankRules.pack.currency,
      decimals = decimalsOf_(currency);
    var debit = +line.debit_minor || 0,
      credit = +line.credit_minor || 0;
    var out = debit > 0,
      minor = out ? debit : credit,
      text = String(line.narration || '').toUpperCase(),
      date = line.date;
    var ref = line.ref || line.cheque_no || null;
    var base = function (event, rule, confidence, reason, extra) {
      event.date = date;
      event.amount = minor / Math.pow(10, decimals);
      if (ref) event.ref = String(ref);
      event.narration = 'Bank statement ' + date + ': ' + String(line.narration || '').slice(0, 120);
      var taxed = bankEntry_().withTax(event, { rule: rule, pack: bankRules.pack, currency: currency, minor: minor, decimals: decimals, basis: options.gst_basis, invoice: options.tax_invoice });
      return finish_(taxed.event, rule, confidence, reason, minor, Object.assign({ tax: taxed.tax, confirmed: !!options.confirmed }, extra), currency, bankRules.pack);
    };
    return { line: line, pack: bankRules.pack, options: options, rules: rules, debit: debit, credit: credit, out: out, minor: minor, text: text, base: base, none: none };
  }
  /** the answer for an unexplained line, with the party it would be — only when the caller handed in its parties (opt-in: no caller's answer changes): a payee who is no party yet is PROPOSED new (never created here), near names listed first */
  function withNewParty_(answer, situation) {
    var not = Array.isArray(situation.options.parties) && bankEntry_().notAParty(situation.text, { rules: situation.rules, out: situation.out, has: hasWord_ });
    if (not) {
      answer.what = not; /* l16-bank-rules: the pack's own words say it is no payee (own account, tax office, card payout): proposed as that answer, never as a new party */
      return answer;
    }
    var party = Array.isArray(situation.options.parties) && bankEntry_().newParty(situation.line, { out: situation.out, parties: situation.options.parties, ownWords: bankWords_(situation.pack) });
    if (party) answer.party = party;
    return answer;
  }
  /**
   * the first rule that fits the line, in order — a rule a person taught, then a named party, then the bank's own words for the side the money moved; null when none fits.
   * B5-01: a PARTY is tried before the words ("SMITH LEGAL PROFESSIONAL FEE" is a payment to Smith, not a bank charge); a proposal that only the words made is never ready on its own (see basisOf_).
   */
  function ruleSuggestion_(situation) {
    return learnedSuggestion_(situation) || openItemSuggestion_(situation) || partySuggestion_(situation) || (situation.out ? debitWordSuggestion_(situation) : creditWordSuggestion_(situation)) || notAPartySuggestion_(situation);
  }
  /**
   * l16-bank-rules: a narration the pack's own words call a tax-office payment or a card settlement is no supplier or customer: it is PROPOSED as that answer of bank-entry.whatIsThis (tax paid against the tax head, card takings into the card account),
   * composed by the one answer path (eventOfAnswer), never a new party. Words only, so it waits for the person's tick like any word-made proposal. Opt-in like the party proposal: only when the caller handed in its parties.
   */
  function notAPartySuggestion_(situation) {
    var not = Array.isArray(situation.options.parties) && bankEntry_().notAParty(situation.text, { rules: situation.rules, out: situation.out, has: hasWord_ });
    if (!not || not.kind === 'transfer') return null;
    var made = bankEntry_().eventOfAnswer({ kind: not.kind }, situation.out, situation.pack, situation.options);
    return made.event ? situation.base(made.event, 'not_a_party', 'medium', 'narration says "' + not.word + '"' + (not.kind === 'tax_payment' ? ' — tax paid to the tax office' : ' — card takings paid to the bank'), { what: not }) : null;
  }
  /** BR1: a rule a person taught (learn()) is tried first — still only a PROPOSAL, shown with where it came from */
  function learnedSuggestion_(situation) {
    var learnedRule = learnedFor_(situation.line, situation.options.learned, situation.out);
    if (!learnedRule) return null;
    var learnedEvent = learnedRule.event
      ? JSON.parse(JSON.stringify(learnedRule.event))
      : { type: situation.out ? 'payment_made' : 'payment_received', mode: 'bank', party: learnedRule.party };
    return situation.base(learnedEvent, 'learned', 'medium', learnedReason_(learnedRule), { source: learnedRule.source || null, learned_id: learnedRule.id || null });
  }
  /** why a taught rule is offered: the words it matched, who it was said to be, and the day it was taught */
  function learnedReason_(learnedRule) {
    return (
      'you said a line with "' +
      learnedRule.has +
      '" was ' +
      (learnedRule.party_name || learnedRule.party || learnedRule.label || 'this') +
      (learnedRule.source && learnedRule.source.date ? ' (' + learnedRule.source.date + ')' : '')
    );
  }
  /** money out of the bank, by the words of the narration: a bank charge, a returned cheque, cash drawn at an ATM; null when none is named */
  function debitWordSuggestion_(situation) {
    var word;
    if ((word = hasWord_(situation.text, situation.rules.charges)))
      return situation.base({ type: 'expense', class: 'bank_charges', paid_from: 'bank' }, 'charges', 'high', 'narration says "' + word + '" — a bank charge');
    if ((word = hasWord_(situation.text, situation.rules.cheque_return))) return chequeReturnSuggestion_(situation, word);
    if ((word = hasWord_(situation.text, situation.rules.atm)))
      return situation.base({ type: 'contra', from: 'bank', to: 'cash' }, 'atm', 'high', 'narration says "' + word + '" — cash drawn from the bank');
    return null;
  }
  /** money into the bank, by the words of the narration: cash paid in, interest credited; null when neither is named */
  function creditWordSuggestion_(situation) {
    var word;
    if ((word = hasWord_(situation.text, situation.rules.cash_deposit)))
      return situation.base({ type: 'contra', from: 'cash', to: 'bank' }, 'cash_deposit', 'medium', 'narration says "' + word + '" — cash paid into the bank');
    if ((word = hasWord_(situation.text, situation.rules.interest)))
      return situation.base(
        { type: 'other_income', class: 'interest_received', into: 'bank' },
        'interest',
        'high',
        'narration says "' + word + '" — interest credited by the bank'
      );
    return null;
  }
  /** a returned cheque: the cleared receipt it reverses when one fits (by cheque number, else by amount alone), else a low-confidence proposal that asks for the party and the receipt */
  function chequeReturnSuggestion_(situation, word) {
    var options = situation.options,
      line = situation.line,
      minor = situation.minor;
    var sameAmount = (options.receipts || []).filter(function (item) {
      return +item.amount_minor === minor;
    });
    var byNo = (options.receipts || []).filter(function (item) {
      return +item.amount_minor === minor && item.cheque_no && share_(keysOf_(null, item.cheque_no, ''), keysOf_(line.ref, line.cheque_no, line.narration));
    });
    var pick = byNo.length === 1 ? byNo[0] : sameAmount.length === 1 ? sameAmount[0] : null;
    if (pick)
      return situation.base(
        { type: 'cheque_dishonoured', party: pick.party, reverses: pick.ref },
        'cheque_return',
        byNo.length === 1 ? 'high' : 'medium',
        'narration says "' + word + '" and the cleared receipt ' + pick.ref + ' is for this amount'
      );
    return situation.base(
      { type: 'cheque_dishonoured', party: null, reverses: null },
      'cheque_return',
      'low',
      'narration says "' + word + '" — the receipt it reverses and its party are not known; name them before posting',
      { needs: ['party', 'reverses'] }
    );
  }

  /** the letters and digits of a document number, upper case: "HP-INV-2" → "HPINV2" */
  function docKey_(text) {
    return String(text || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }
  /** the narration names this document: its whole number ("HP-INV-2"), or "INV 2" / "INVOICE 2" / "BILL 2" with the number the document ends in */
  function namesDocument_(text, billNo) {
    var key = docKey_(billNo),
      tail = /([0-9]+)$/.exec(key);
    if (!key) return false;
    if (docKey_(text).indexOf(key) >= 0) return true;
    return !!tail && new RegExp('(^|[^A-Z0-9])(INV|INVOICE|BILL|DOC|REF)[\\s#.:\\-]*0*' + String(+tail[1]) + '([^0-9]|$)').test(String(text).toUpperCase());
  }
  /** the open documents (options.open_items: { ref, bill_no, party, side: 'customer'|'supplier', open_minor, currency? }) this line could be paying: this side, this very amount, this currency */
  function openCandidates_(situation) {
    var want = situation.out ? 'supplier' : 'customer';
    return (situation.options.open_items || []).filter(function (item) {
      return item && item.side === want && +item.open_minor === situation.minor && (!item.currency || item.currency === situation.pack.currency);
    });
  }
  /**
   * v1.98.0 (BNK-new-8 / M4): money in or out that is EXACTLY one open invoice (bill) of the party it names — or of the party whose document number it names — is proposed as a payment against that document
   * (proposal.against = [{ against_ref, bill_no, amount_minor }]), the way a bank reconciliation suggests a match. More than one fit, or none, is no proposal here: the party rule below still speaks.
   * Nothing is guessed: the party must be named in the narration (by name, VPA or account) or the document number must be; the amount must be the document's open amount to the minor unit.
   */
  function openItemSuggestion_(situation) {
    var found = openCandidates_(situation);
    if (!found.length) return null;
    var hit = partyIn_(situation.line.narration, situation.options.parties),
      byParty = hit && hit !== 'many' ? found.filter(function (item) { return String(item.party) === String(hit.p.id || hit.p.name); }) : [],
      byDoc = found.filter(function (item) { return namesDocument_(situation.text, item.bill_no); });
    var pick = byDoc.length === 1 ? byDoc[0] : byDoc.length === 0 && byParty.length === 1 ? byParty[0] : null;
    if (!pick) return null;
    var event = { type: situation.out ? 'payment_made' : 'payment_received', mode: 'bank', party: pick.party },
      answer = situation.base(event, 'open_item', 'high', 'the amount is exactly the open ' + (situation.out ? 'bill ' : 'invoice ') + (pick.bill_no || pick.ref) + ' — ' + (byDoc.length === 1 ? 'the narration names it' : 'the narration names its party'));
    answer.against = [{ against_ref: pick.ref, bill_no: pick.bill_no || null, amount_minor: situation.minor }];
    return answer;
  }
  /** a transfer naming a party: 'many' parties is no proposal; one party gives a received / paid proposal; null when the narration names none */
  function partySuggestion_(situation) {
    var options = situation.options;
    if (!(hasWord_(situation.text, situation.rules.transfer) || (options.parties || []).length)) return null;
    var partyHit = partyIn_(situation.line.narration, options.parties);
    if (partyHit === 'many') return situation.none('the narration names more than one party');
    if (!partyHit) return null;
    return partyProposal_(situation, partyHit);
  }
  /** the proposal for a party the narration names: a credit is received from a customer, a debit paid to a supplier; null when the party's kind is the other way */
  function partyProposal_(situation, partyHit) {
    var pid = partyHit.p.id || partyHit.p.name,
      kind = partyHit.p.kind;
    if (!situation.out && kind !== 'supplier')
      return situation.base(
        { type: 'payment_received', mode: 'bank', party: pid },
        'party_credit',
        partyHit.how,
        'a credit naming ' + pid + (partyHit.how === 'high' ? ' by VPA / account' : ' by name') + ' — received from the party'
      );
    if (situation.out && kind !== 'customer')
      return situation.base(
        { type: 'payment_made', mode: 'bank', party: pid },
        'party_debit',
        partyHit.how,
        'a debit naming ' + pid + (partyHit.how === 'high' ? ' by VPA / account' : ' by name') + ' — paid to the party'
      );
    return null;
  }
  /**
   * what made a proposal, in three words (B5-01): 'taught' (a rule the person taught), 'party' (a named party) or 'words' (only the bank's own words in the narration).
   * Taught and party proposals may be ready; a 'words' proposal is a guess about WHICH account, so it waits for the person's tick (bank-project: needs_tick).
   */
  function basisOf_(rule) {
    return rule === 'learned' ? 'taught' : rule === 'party_credit' || rule === 'party_debit' || rule === 'open_item' ? 'party' : 'words';
  }
  /** B5-03: a tax credit is claimed on this line, the pack says a tax invoice is required for it, and the person has not said whether they hold one */
  function taxInvoiceUnanswered_(tax) {
    return !!(tax.credit && tax.tax_minor > 0 && tax.invoice && tax.invoice.required && !tax.invoice_answer);
  }
  /** the proposal: the event, composed by posting.post so it carries the entry that would be posted */
  function finish_(event, rule, confidence, reason, minor, extra, currency, pack) {
    var res = { event: event, confidence: confidence, why: reason, rule: rule, basis: basisOf_(rule), confirmed: !!(extra && extra.confirmed), proposal: true, needs_confirm: true, amount_minor: minor, currency: currency };
    if (extra && extra.tax) {
      res.tax = extra.tax;
      if (extra.tax.tax_minor > 0 && !extra.tax.basis) res.needs = 'gst_basis'; /* cash or accrual is in no pack: the owner says once, never defaulted */
      else if (taxInvoiceUnanswered_(extra.tax)) res.needs = 'tax_invoice'; /* B5-03: the credit waits for the person's word on the tax invoice */
    }
    if (extra && extra.what) res.what = extra.what; /* l16-bank-rules: the pack's words said what the line is (tax_payment · card_settlement) */
    if (extra && extra.source !== undefined) {
      res.source = extra.source;
      res.learned_id = extra.learned_id;
    }
    if (extra && extra.needs) {
      res.needs = extra.needs;
      res.entry = null;
      return res;
    }
    var posting = posting_();
    if (!posting || typeof posting.post !== 'function') {
      res.entry = null;
      return res;
    }
    var posted = posting.post(Object.assign({ currency: currency }, event), { pack: pack });
    if (!posted.ok) {
      res.entry = null;
      res.confidence = 'low';
      res.why += ' — but posting refuses it: ' + posted.why;
      res.refused = posted.why;
      return res;
    }
    res.entry = bankEntry_().entryOf(posted);
    if (!res.entry.balanced) {
      res.confidence = 'low';
      res.why += ' — but the composed entry does not balance';
    }
    return res;
  }

  /* ═══ THE RAIL ALREADY TOLD US (v1.44.0, BR1) ══════════════════════════════════════════════════════════════════════
   * Athi's brief, 2026-10-13: an incumbent GUESSES a bank line from amount and narration; on the rail most money movements are
   * ALREADY KNOWN — the other party's payment advice (api lib/books.js adviceBody, M30: "paid ₹X for bills A, B by ref R") is a sealed
   * chit both sides hold. So a statement line is put against THREE things: the line ↔ the payment chit(s) ↔ the ledger entry.
   *   railPayments(chits)                         the payment advices on MY copies → rail payments (my side: money in / out)
   *   explain(stmt, ledger, rail, opts)           every statement line with its state and what a person may do next
   *   lineKey(line, occurrence?)                  a line's stable key — the date, the side, the amount and the reference (never the narration)
   *   ask(line, { party, currency, me, key })     the message chit that ASKS the other party which bill a line is ("₹4,200 on 12 Oct ref R")
   *   learn(line, { party?, party_name?, event?, label? }, { at?, by? })  a confirmed explanation → a SUGGESTION rule (suggest opts.learned)
   *   step(state, action)                         the device's reconciliation marks: accept · undo · note · attach (undo keeps notes and files)
   * Still pure and still PROPOSE-ONLY: nothing here posts, sends or stores; a host does each of those after a person presses.
   */
  var ADVICE_KIND = 'payment_advice',
    QUERY_KIND = 'bank_query';
  /**
   * ⭐ railPayments(chits) → [{ chit_id, side (my money: out of the bank or into it), amount_minor, currency, ref, date, party: { id, name }, bills: [{ ref_chit_id, bill_no, applied_minor }],
   *   payment_id, mine, words }]
   *   chits: my copies, as a host reads them — { chit_id, direction: 'sent' | 'received', party?: { id, name }, status?, business_json, line_items? }.
   *   The side is MY money: an advice I SENT that says 'paid' is money out; one I RECEIVED that says 'paid' is money in; 'received' the reverse.
   *   A reversal advice (payment_advice.reverses_advice_chit_id) takes the advice it reverses off the list. Anything not an advice is left out.
   */
  function railPayments(chits) {
    var out = [],
      gone = {};
    (chits || []).forEach(function (item) {
      var payment = railPaymentOf_(item, gone);
      if (payment) out.push(payment);
    });
    return out.filter(function (item) {
      return !gone[item.chit_id];
    });
  }
  /** one chit copy → its rail payment, or null when it is not a usable payment advice; a reversal advice marks the advice it reverses in `gone` and is itself left out */
  function railPaymentOf_(item, gone) {
    var businessJson = (item && item.business_json) || {},
      advice = businessJson.payment_advice;
    if (!item || businessJson.kind !== ADVICE_KIND || !advice) return null;
    if (advice.reverses_advice_chit_id) {
      gone[String(advice.reverses_advice_chit_id)] = true;
      return null;
    }
    var minor = Number(advice.amount_minor);
    if (!Number.isInteger(minor) || minor <= 0) return null;
    return railPaymentRow_(item, businessJson, advice, minor);
  }
  /** the rail payment of a usable advice: my side of the money, the amount, the reference and day, the party, the bills it settles */
  function railPaymentRow_(item, businessJson, advice, minor) {
    var sent = item.direction === 'sent',
      paid = advice.action !== 'received';
    return {
      chit_id: String(item.chit_id),
      side: SIDE_(sent === paid),
      amount_minor: minor,
      currency: railCurrency_(businessJson, advice),
      ref: advice.reference || null,
      date: dateOf_(advice.paid_on) || null,
      party: item.party || null,
      mine: sent,
      payment_id: sent ? advice.adviser_payment_id || null : null,
      bills: (item.line_items || [])
        .filter(function (li) {
          return li && li.ref_chit_id;
        })
        .map(function (li) {
          return {
            ref_chit_id: String(li.ref_chit_id),
            bill_no: li.bill_no || null,
            applied_minor: Number.isInteger(li.applied_minor) ? li.applied_minor : null
          };
        }),
      words: advice.words || null,
      status: item.status || null
    };
  }
  /** the currency an advice names (its own, else the chit's), upper-case; null when neither does */
  function railCurrency_(businessJson, advice) {
    return String(advice.currency || businessJson.currency || '').toUpperCase() || null;
  }
  /** ⭐ lineKey(line, occurrence) → 'YYYY-MM-DD|in|420000|REF' — the facts that may travel (date · side · amount · reference); `occurrence` (the n-th line with the
   *  same facts in one statement, from 0) keeps two equal lines apart. The narration is NEVER in a key: a key may ride on an ask chit. */
  function lineKey(line, occurrence) {
    var statementLine = line || {},
      debit = +statementLine.debit_minor || 0,
      credit = +statementLine.credit_minor || 0;
    return [statementLine.date || '', SIDE_(debit), debit || credit, refKey_(statementLine.ref || statementLine.cheque_no || '')].join('|') + (occurrence ? '#' + occurrence : '');
  }
  /**
   * ⭐ explain(stmtLines, ledgerLines, railPays, { window_days = 3, asks?, learned?, parties?, bank?, pack?, country? })
   *   → { rows: [{ i, key, state, how, chits: [chit_id], ledger: [ledger id], bills, asked, suggestion, next }], rail_only: [rail payment],
   *       unmatched_ledger, ambiguous, counts: { settled, told, matched, check, asked, suggested, unexplained, needs_you } }
   *   The ledger side is match() unchanged. The rail side is matched the same way, in the same order: (a) 'ref' — the advice's reference is
   *   one of the line's references, same amount, same side (any day: the reference is the proof); (b) 'amount+date' — same amount and side in the
   *   window, each the other's only candidate (a tie is never guessed); (c) 'one-to-many' — one deposit = several advices; (d) 'many-to-one' —
   *   one advice paid in several lines. A ledger line carrying the advice's chit (`chit_id` / `source_chit_id`) or its payment (`payment_id`) is
   *   the third leg even when it was not matched by date.
   *   STATES — settled: an advice AND a ledger entry (three-way; one tap to accept) · told: an advice, not yet in the books (record it from the
   *   advice) · matched: in the books, no advice · check: more than one entry fits · asked: nobody explained it and the other party was asked ·
   *   suggested: a rule's proposal · unexplained: nothing — the only lines a person must look at, with `suggested` and `check` (needs_you).
   *   asks: [{ key, chit_id, party, at }] — the ask chits already sent (their business_json.bank_query.key).
   */
  function explain(stmtLines, ledgerLines, railPays, opts) {
    var options = opts || {},
      win = options.window_days != null ? Math.max(0, +options.window_days) : 3;
    var lines = stmtLines || [],
      list = ledgerLines || [],
      matchResult = match(lines, list, { window_days: win, line_refs: options.line_refs, posted: options.posted });
    var keys = lineKeys_(lines);
    var statementRows = explainStatementRows_(lines);
    var railRows = railRowsOf_(railPays);
    var legs = matchRail_(statementRows, railRows, win);
    var context = {
      legs: legs,
      keys: keys,
      ledgerLegs: ledgerLegs_(matchResult, list),
      asks: asksByKey_(options.asks),
      options: options,
      counts: { settled: 0, told: 0, matched: 0, check: 0, asked: 0, suggested: 0, unexplained: 0, needs_you: 0 }
    };
    var rows = lines.map(function (item, index) {
      return explainRow_(item, index, context);
    });
    var counts = context.counts;
    counts.needs_you = counts.check + counts.suggested + counts.unexplained;
    return {
      rows: rows,
      rail_only: railOnly_(railRows, lines, win),
      unmatched_ledger: matchResult.unmatched_ledger,
      ambiguous: matchResult.ambiguous,
      counts: counts
    };
  }
  /** each statement line's stable key; two lines with the same facts are told apart by their order (#1, #2 …) */
  function lineKeys_(lines) {
    var seen = {};
    return lines.map(function (item) {
      var key = lineKey(item);
      var occurrence = seen[key] || 0;
      seen[key] = occurrence + 1;
      return lineKey(item, occurrence);
    });
  }
  /** each statement line as a row to match against the rail: index, side, minor amount, day number and reference keys */
  function explainStatementRows_(lines) {
    return lines.map(function (item, index) {
      var debit = +item.debit_minor || 0,
        credit = +item.credit_minor || 0;
      return { i: index, side: SIDE_(debit), m: debit || credit, day: dayNo_(item.date), keys: keysOf_(item.ref, item.cheque_no, item.narration), used: !debit && !credit };
    });
  }
  /** each rail payment as a row to match (`r` is the payment itself, `k` its index) */
  function railRowsOf_(railPays) {
    return (railPays || []).map(function (item, index) {
      return { k: index, r: item, side: item.side, m: item.amount_minor, day: dayNo_(item.date), keys: keysOf_(item.ref, null, ''), used: false };
    });
  }
  /** the statement lines put against the rail payments, in the same order as match() → { link: line index → [rail payments], howBy: line index → pass } */
  function matchRail_(statementRows, railRows, win) {
    var legs = { link: {}, howBy: {} };
    railByRef_(statementRows, railRows, legs);
    railByAmountDate_(statementRows, railRows, legs, win);
    railOneToMany_(statementRows, railRows, legs, win);
    railManyToOne_(statementRows, railRows, legs, win);
    return legs;
  }
  /** record a rail match: each statement row is linked to the payments and both sides are used */
  function railTake_(legs, entries, railList, pass) {
    entries.forEach(function (item) {
      item.used = true;
      legs.link[item.i] = railList.map(function (x) {
        return x.r;
      });
      legs.howBy[item.i] = pass;
    });
    railList.forEach(function (x) {
      x.used = true;
    });
  }
  /** (a) the reference */
  function railByRef_(statementRows, railRows, legs) {
    statementRows.forEach(function (item) {
      if (item.used || !item.keys.length) return;
      var candidates = railRows.filter(function (x) {
        return !x.used && x.side === item.side && x.m === item.m && share_(item.keys, x.keys);
      }).sort(function (first, second) {
        return byProximity_(item, first, second);
      });
      if (candidates.length) railTake_(legs, [item], [candidates[0]], 'ref');
    });
  }
  /** (b) amount + date, each the other's only candidate */
  function railByAmountDate_(statementRows, railRows, legs, win) {
    for (var again = true; again;) {
      again = false;
      var cand = {},
        back = {};
      statementRows.forEach(function (item) {
        if (item.used) return;
        cand[item.i] = railRows.filter(function (x) {
          return !x.used && x.side === item.side && x.m === item.m && dayGap_(item, x) <= win;
        });
        cand[item.i].forEach(function (x) {
          (back[x.k] = back[x.k] || []).push(item);
        });
      });
      statementRows.forEach(function (item) {
        if (!item.used && cand[item.i] && cand[item.i].length === 1 && back[cand[item.i][0].k].length === 1 && !cand[item.i][0].used) {
          railTake_(legs, [item], [cand[item.i][0]], 'amount+date');
          again = true;
        }
      });
    }
  }
  /** (c) one line = several advices */
  function railOneToMany_(statementRows, railRows, legs, win) {
    statementRows.forEach(function (item) {
      if (item.used) return;
      var pool = railRows.filter(function (x) {
        return !x.used && x.side === item.side && dayGap_(item, x) <= win;
      });
      var group = subset_(pool, item.m);
      if (group) railTake_(legs, [item], group, 'one-to-many');
    });
  }
  /** (d) one advice = several lines */
  function railManyToOne_(statementRows, railRows, legs, win) {
    railRows.forEach(function (x) {
      if (x.used) return;
      var pool = statementRows.filter(function (item) {
        return !item.used && item.side === x.side && dayGap_(item, x) <= win;
      });
      var group = subset_(pool, x.m);
      if (group) railTake_(legs, group, [x], 'many-to-one');
    });
  }
  /** the ledger leg: match()'s pairs by line index, its ties, and the ledger lines that name an advice's chit or payment (keyed by chit id or 'pay:' + payment id) */
  function ledgerLegs_(matchResult, list) {
    var ledOf = {},
      ambiguousBy = {};
    (matchResult.matched || []).forEach(function (item) {
      item.stmt.forEach(function (statementIndex) {
        ledOf[statementIndex] = { ids: item.ledger.slice(), how: item.how };
      });
    });
    (matchResult.ambiguous || []).forEach(function (item) {
      ambiguousBy[item.stmt] = item.candidates;
    });
    /* FIN-67: a ledger entry is paired to ONE line. `owner` is who holds each id ({line, chit}): match()'s own pairs first; a chit's third-leg ids are added after, to the first row that asks */
    var owner = {};
    Object.keys(ledOf).forEach(function (statementIndex) {
      ledOf[statementIndex].ids.forEach(function (id) {
        owner[id] = { line: Number(statementIndex), chit: null };
      });
    });
    var byChit = {};
    list.forEach(function (item) {
      [item.chit_id, item.source_chit_id, item.payment_id ? 'pay:' + item.payment_id : null].forEach(function (chitKey) {
        if (chitKey) (byChit[String(chitKey)] = byChit[String(chitKey)] || []).push(item.id);
      });
    });
    return { ledOf: ledOf, ambiguousBy: ambiguousBy, byChit: byChit, owner: owner };
  }
  /** the ask chits already sent, by line key */
  function asksByKey_(sent) {
    var asks = {};
    (sent || []).forEach(function (item) {
      if (item && item.key) asks[item.key] = item;
    });
    return asks;
  }
  /** one statement line's row: the chits and ledger entries that explain it, its bills and party, whether it was asked about, and its state and next step (counted in context.counts) */
  function explainRow_(item, index, context) {
    var ledgerLegs = context.ledgerLegs,
      ledOf = ledgerLegs.ledOf,
      chits = context.legs.link[index] || [],
      ids = ledOf[index] ? ledOf[index].ids.slice() : [];
    addChitLedgerIds_(chits, ids, ledgerLegs.byChit, ledgerLegs.owner, index);
    var row = {
      i: index,
      key: context.keys[index],
      chits: chits.map(function (entry) {
        return entry.chit_id;
      }),
      ledger: ids,
      how: context.legs.howBy[index] || (ledOf[index] && ledOf[index].how) || null,
      bills: [].concat.apply(
        [],
        chits.map(function (entry) {
          return entry.bills || [];
        })
      ),
      party: chits.length ? chits[0].party : null,
      asked: context.asks[context.keys[index]] || null,
      suggestion: null
    };
    setExplainState_(row, item, chits, ids, ledgerLegs.ambiguousBy[index], context.options);
    context.counts[row.state]++;
    return row;
  }
  /** add the ledger lines that name one of the chits (or its payment) to `ids`, once each, and never one another line already holds (FIN-67: `owner` maps id → {line, chit}, filled as lines claim; one chit on several lines shares its entry) */
  function addChitLedgerIds_(chits, ids, byChit, owner, index) {
    chits.forEach(function (entry) {
      [entry.chit_id, entry.payment_id ? 'pay:' + entry.payment_id : null].forEach(function (element) {
        ((element && byChit[element]) || []).forEach(function (id) {
          var held = owner[id];
          if (ids.indexOf(id) >= 0 || (held && held.line !== index && held.chit !== entry.chit_id)) return; /* one chit may span lines (many-to-one); another line's pair or chit may not */
          owner[id] = { line: index, chit: entry.chit_id };
          ids.push(id);
        });
      });
    });
  }
  /** a row's state and next step: settled (advice and entry) · told (advice only) · matched (entry only) · check (a tie) · else the open ones */
  function setExplainState_(row, item, chits, ids, tied, options) {
    if (chits.length && ids.length) {
      row.state = 'settled';
      row.next = 'accept';
    } else if (chits.length) {
      row.state = 'told';
      row.next = 'record';
    } else if (ids.length) {
      row.state = 'matched';
      row.next = 'accept';
    } else if (tied) {
      row.state = 'check';
      row.next = 'choose';
      row.candidates = tied;
    } else setOpenState_(row, item, options);
  }
  /** nothing explains the line: asked (the other party was asked), suggested (a rule's proposal) or unexplained */
  function setOpenState_(row, item, options) {
    var suggestion = suggest(item, { parties: options.parties, open_items: options.open_items, learned: options.learned, bank: options.bank, rules: options.rules, pack: options.pack, country: options.country });
    row.suggestion = suggestion && suggestion.event ? suggestion : null;
    if (row.asked) {
      row.state = 'asked';
      row.next = 'wait';
    } else if (row.suggestion) {
      row.state = 'suggested';
      row.next = 'accept';
    } else {
      row.state = 'unexplained';
      row.next = 'ask';
    }
  }
  /** the rail payments no statement line took, limited to those dated within the window of the statement's first and last day */
  function railOnly_(railRows, lines, win) {
    var from = lines.reduce(function (total, item) {
        return !total || item.date < total ? item.date : total;
      }, null),
      to = lines.reduce(function (total, item) {
        return !total || item.date > total ? item.date : total;
      }, null);
    var inside = function (railPayment) {
      var dayNumber = dayNo_(railPayment.date);
      return !from || (dayNumber >= dayNo_(from) - win && dayNumber <= dayNo_(to) + win);
    };
    return railRows.filter(function (x) {
      return !x.used && inside(x.r);
    }).map(function (x) {
      return x.r;
    });
  }
  var MON3_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayWords_(value) {
    var isoDate = dateOf_(value);
    return isoDate ? +isoDate.slice(8, 10) + ' ' + MON3_[+isoDate.slice(5, 7) - 1] + ' ' + isoDate.slice(0, 4) : '';
  }
  /** an amount for words: the currency CODE and the figure in the pack's number format (money.format's rule: the code, never a guessed symbol) */
  function amountWords_(minor, currency, pack) {
    var decimals = decimalsOf_(currency),
      locale = (pack && pack.locale && pack.locale.format) || 'en-US';
    var figure = minor / Math.pow(10, decimals);
    var text;
    try {
      text = figure.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    } catch (_) {
      text = figure.toFixed(decimals);
    }
    return (currency ? currency + ' ' : '') + text;
  }
  /**
   * ⭐ ask(line, { party: { id, name }, currency, me?, key?, pack?, country? }) → { ok, words, body } | { ok: false, why }
   *   The question a line nobody explained puts to the other party ON THE RAIL: "<CUR> 4,200.00 came into our bank on 12 Oct 2026, ref R —
   *   which bill is it for?" `body` is the chit send body (POST /api/chits/send): purpose 'general', client_ref 'bankask:<key>' (a retry answers
   *   the first chit), business_json { kind: 'bank_query', currency, bank_query: { key, side, amount_minor, currency, date, ref, words } }.
   *   ⭐ ONLY THREE FACTS TRAVEL — the date, the amount and the reference. The narration (and the rest of the statement) never leaves the device.
   *   Their answer is the payment advice they already send (M30), carrying the reference: explain() then settles the line by 'ref' — in both books.
   */
  function askWhichBill(line, opts) {
    var options = opts || {},
      statementLine = line || {},
      money = lineMoney_(statementLine);
    var refusal = askRefusal_(options, money.debit, money.credit);
    if (refusal) return refusal;
    var bankRules = bankOf_(options),
      pack = bankRules ? bankRules.pack : null;
    return askResult_(statementLine, options, money, pack, askCurrency_(options, pack));
  }
  /** the refusal when the line moves money both ways or neither, or no party was chosen; null when the question can be put */
  function askRefusal_(options, debit, credit) {
    if (debit > 0 === credit > 0) return { ok: false, why: 'a statement line has money going one way' };
    if (!options.party || !options.party.id) return { ok: false, why: 'choose who to ask' };
    return null;
  }
  /** the currency the question names: the one given, else the pack's, upper-case; null when neither */
  function askCurrency_(options, pack) {
    return String(options.currency || (pack && pack.currency) || '').toUpperCase() || null;
  }
  /** the question and the chit send body that carries it: only the date, the amount and the reference travel */
  function askResult_(statementLine, options, money, pack, currency) {
    var debit = money.debit,
      key = options.key || lineKey(statementLine),
      ref = statementLine.ref || statementLine.cheque_no || null,
      minor = debit || money.credit,
      side = SIDE_(debit);
    var amountText = amountWords_(minor, currency, pack),
      dayText = dayWords_(statementLine.date);
    var words = askWords_(options, amountText, dayText, ref, debit);
    return {
      ok: true,
      words: words,
      key: key,
      body: {
        recipients: [{ entity_id: options.party.id, role: 'to' }],
        purpose: 'general',
        manual_subject: 'Bank line ' + dayText + ' — which bill?',
        client_ref: 'bankask:' + key,
        message: words,
        business_json: {
          kind: QUERY_KIND,
          currency: currency,
          bank_query: { key: key, side: side, amount_minor: minor, currency: currency, date: statementLine.date || null, ref: ref, words: words }
        }
      }
    };
  }
  /** the question in words: money that came in asks which bill it is for, money that went out asks which bill it was for */
  function askWords_(options, amountText, dayText, ref, debit) {
    return !debit
      ? amountText +
          ' came into ' +
          (options.me ? options.me + "'s" : 'our') +
          ' bank on ' +
          dayText +
          (ref ? ', ref ' + ref : '') +
          ' — which bill is it for? Send the payment advice and both books settle.'
      : amountText +
          ' went from ' +
          (options.me ? options.me + "'s" : 'our') +
          ' bank to you on ' +
          dayText +
          (ref ? ', ref ' + ref : '') +
          ' — which bill was it for? Send the receipt advice and both books settle.';
  }
  /* the words a bank prints around a name — never what identifies a payer: these neutral ones, and every word of the PACK's own bank keywords
   (its transfer rails, charges, …) and amount prefixes, so a country's rails stay in its pack */
  var GENERIC_ = [
    'TO',
    'BY',
    'FROM',
    'CR',
    'DR',
    'PAYMENT',
    'PAID',
    'REF',
    'TRANSFER',
    'TRF',
    'DEPOSIT',
    'DEP',
    'CREDIT',
    'DEBIT',
    'POS',
    'TXN',
    'BANK',
    'THE',
    'AND',
    'FOR',
    'CHQ',
    'CHEQUE',
    'CLG',
    'ACH',
    'ECS',
    'MB',
    'IB',
    'INB',
    'INF',
    'BIL',
    'ONL',
    'CMS',
    'PART'
  ];
  function bankWords_(pack) {
    var bankData = (pack && pack.bank) || {},
      keywords = bankData.keywords || {},
      out = GENERIC_.slice();
    var addWords = function (words) {
      String(words)
        .toUpperCase()
        .split(/[^A-Z0-9&]+/)
        .forEach(function (x) {
          if (x && out.indexOf(x) < 0) out.push(x);
        });
    };
    Object.keys(keywords).forEach(function (bank) {
      Object.keys(keywords[bank] || {}).forEach(function (item) {
        if (bankEntry_().NOT_A_PARTY_CATEGORIES.indexOf(item) >= 0) return; /* ATO, EFTPOS, SAVINGS can name who a taught rule is for: only these words say the line is no payee, they are not the bank's own filler */
        (keywords[bank][item] || []).forEach(addWords);
      });
    });
    (bankData.amountPrefixes || []).forEach(addWords);
    if (pack && pack.currency) addWords(pack.currency);
    return out;
  }
  /** what identifies the payer in a narration: a VPA-style handle (lower-case) when there is one, else the first two words that are not the bank's own */
  function tokenOf_(narration, pack) {
    var text = String(narration || ''),
      handle = /[a-z0-9._]{2,}@[a-z][a-z0-9.]{1,}/i.exec(text);
    if (handle) return handle[0].toLowerCase();
    var ownWords = bankWords_(pack);
    var words = text
      .toUpperCase()
      .split(/[^A-Z0-9&]+/)
      .filter(function (item) {
        return item.length >= 3 && !/\d/.test(item) && ownWords.indexOf(item) < 0;
      });
    return words.length ? words.slice(0, 2).join(' ') : null;
  }
  function learnedFor_(line, rules, out) {
    if (!rules || !rules.length) return null;
    var lower = String(line.narration || '').toLowerCase(),
      upper = String(line.narration || '').toUpperCase(),
      best = null;
    rules.forEach(function (item) {
      if (!item || !item.has || (item.side && item.side !== SIDE_(out))) return;
      if (!ruleCovers_(item, lower, upper)) return;
      if (isBetterRule_(item, best)) best = item;
    });
    return best;
  }
  /** does the narration contain the rule's words? a handle (name@bank) as written; else every word of the rule, each a whole word, in any order: "KUMAR SONS" (the bank's "AND" left out when it was learned) finds "KUMAR AND SONS" */
  function ruleCovers_(item, lower, upper) {
    return item.has.indexOf('@') >= 0
      ? lower.indexOf(item.has) >= 0
      : String(item.has)
          .split(/\s+/)
          .every(function (entry) {
            return hasWord_(upper, [entry]) !== null;
          });
  }
  /** does this rule beat the best so far? the longer words win; on a tie the one taught later */
  function isBetterRule_(item, best) {
    return (
      !best ||
      item.has.length > best.has.length ||
      (item.has.length === best.has.length && String((item.source || {}).at || '') > String((best.source || {}).at || ''))
    );
  }
  /**
   * ⭐ learn(line, { party?, party_name?, event?, label? }, { at?, by? }) → { ok, rule } | { ok: false, why }
   *   A person's confirmed explanation of a line becomes a rule: "a narration with <has> → party P (or the event / ledger given)". It is used ONLY
   *   as a suggestion (suggest opts.learned) and always shown with `source` — the line's date, the first 60 characters of its narration, when and
   *   by whom it was taught. `has` is a handle (name@bank) in the narration, else its first two words that are not the bank's own (the pack's keywords).
   *   meta = { at?, by?, pack?, country? } — the pack whose bank words are left out (the default pack when none).
   */
  function learn(line, x, meta) {
    var statementLine = line || {},
      e = x || {},
      taught = meta || {},
      money = lineMoney_(statementLine);
    if (money.debit > 0 === money.credit > 0) return { ok: false, why: 'a statement line has money going one way' };
    if (!e.party && !e.event) return { ok: false, why: 'nothing to learn — no party and no entry were confirmed' };
    var bankRules = bankOf_(taught),
      text = tokenOf_(statementLine.narration, bankRules ? bankRules.pack : null);
    if (!text) return { ok: false, why: 'the narration has no word that names who paid' };
    return { ok: true, rule: learnedRuleOf_(statementLine, e, taught, text, SIDE_(money.debit)) };
  }
  /** the rule a confirmed explanation becomes: the words to look for, the side, who or what it was, and where it came from (the line's date and first 60 characters, when and by whom) */
  function learnedRuleOf_(statementLine, e, taught, text, side) {
    return {
      id: side + ':' + text.replace(/\s+/g, '_'),
      has: text,
      side: side,
      party: e.party || null,
      party_name: e.party_name || null,
      label: e.label || null,
      event: e.event ? JSON.parse(JSON.stringify(e.event)) : null,
      source: { date: statementLine.date || null, narration: String(statementLine.narration || '').slice(0, 60), at: taught.at || null, by: taught.by || null }
    };
  }
  /**
   * ⭐ step(state, action) → the next state (a new object; the one given is not touched). The device's marks for a statement:
   *   { accepted: { key: { how, chits, ledger, at, by } }, notes: { key: [{ text, at, by }] }, files: { key: [{ name, ref, at }] }, log: [{ act, key, at }] }
   *   accept {key, how?, chits?, ledger?, at?, by?} — a note NEVER blocks it · undo {key} — takes the accept back and KEEPS the notes and files ·
   *   note {key, text} · attach {key, name, ref}. An unknown action or a missing key leaves the state as it was (and says why).
   */
  function step(state, action) {
    var parsed = JSON.parse(JSON.stringify(state || {})),
      request = action || {};
    parsed.accepted = parsed.accepted || {};
    parsed.notes = parsed.notes || {};
    parsed.files = parsed.files || {};
    parsed.log = parsed.log || [];
    delete parsed.why;
    if (!request.key) {
      parsed.why = 'no line key';
      return parsed;
    }
    var markKey = String(request.key);
    if (applyMark_(parsed, markKey, request)) parsed.log.push({ act: request.act, key: markKey, at: request.at || null });
    return parsed;
  }
  /** apply one mark to the new state; true when it took (the log then records it), false after saying why in parsed.why */
  function applyMark_(parsed, markKey, request) {
    if (request.act === 'accept') {
      parsed.accepted[markKey] = { how: request.how || null, chits: request.chits || [], ledger: request.ledger || [], at: request.at || null, by: request.by || null };
      return true;
    }
    if (request.act === 'undo') return undoMark_(parsed, markKey);
    if (request.act === 'note') return noteMark_(parsed, markKey, request);
    if (request.act === 'attach') return attachMark_(parsed, markKey, request);
    parsed.why = 'unknown action';
    return false;
  }
  /** take an accept back — its notes and files stay */
  function undoMark_(parsed, markKey) {
    if (!parsed.accepted[markKey]) {
      parsed.why = 'that line was not accepted';
      return false;
    }
    delete parsed.accepted[markKey];
    return true;
  }
  /** add a note (trimmed, at most 500 characters) to a line; an empty note is refused */
  function noteMark_(parsed, markKey, request) {
    var noteText = String(request.text || '').trim();
    if (!noteText) {
      parsed.why = 'an empty note';
      return false;
    }
    (parsed.notes[markKey] = parsed.notes[markKey] || []).push({ text: noteText.slice(0, 500), at: request.at || null, by: request.by || null });
    return true;
  }
  /** attach a named file to a line; a file with no name is refused */
  function attachMark_(parsed, markKey, request) {
    if (!request.name) {
      parsed.why = 'a file needs a name';
      return false;
    }
    (parsed.files[markKey] = parsed.files[markKey] || []).push({ name: String(request.name), ref: request.ref || null, at: request.at || null });
    return true;
  }

  var EXPORTS = {
    parse: parse,
    match: match,
    nearMatches: nearMatches,
    suggest: suggest,
    brs: function (x) {
      return bankBrs_().statement(x, { bankOf: bankOf_, decimalsOf: decimalsOf_, rulesFor: rulesFor_, hasWord: hasWord_, dateOf: dateOf_ });
    },
    PRESETS: PRESETS,
    RULES: RULES,
    railPayments: railPayments,
    explain: explain,
    lineKey: lineKey,
    ask: askWhichBill,
    learn: learn,
    step: step
  }; /* the last two are the default pack's tables, unchanged */

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBBankRecon. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBBankRecon = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
