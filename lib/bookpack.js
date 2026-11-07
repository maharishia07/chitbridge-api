/* ADOPTED from chitbridge-engines v1.79.0 · bookpack · sha256 b1e3ff6a27532465b97ccd6e56ae7641e33b8fd468d955238b05156cefa4de7b — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · bookpack. Edited ONLY in chitbridge-engines/src/bookpack.js; every platform adopts a released version of it. */
/*
 * OWNS      the pack handed to the shop from given rows: the code book, a SAF-T-shaped JSON (saft), Tally-style import XML (tallyXml, written by the pack's own export rules), the CSV tables (trial balance, ledgers, day book, ageing), the manifest with its control totals and the hash chain (build · seal · verify · verifyChain). Pure: no I/O, no clock, no crypto (the caller hands in the hash function).
 * CALLED BY the api's book-pack builder (lib/books-pack.js, lib/books-engines.js, its adopted copy lib/bookpack.js) · node require('chitbridge-engines').bookpack · the engines test tests/bookpack.test.js · reads accounts-packs, ledger, regulation, money and receivables; the country writers are pack.export in reg-in / reg-au / reg-ae
 * FLOW      input rows ──▶ context_ (pack, range, chart reader, parties) ──▶ positions_ (opening · movement · closing) ──▶ saft · tallyXml · tables · codeBook ──▶ build (files + manifest with control totals) ──▶ seal / verify / verifyChain
 * CARD      14-accounting/functions/accounts-packs-and-auditor-file
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note [BOOKS v2] The handover pack from given rows: SAF-T-shaped JSON, Tally XML, CSVs (trial balance, ledgers,
  // @stage-note ageing, day book), a code book and a manifest with control totals, chained to the previous pack. No crypto:
  // @stage-note the caller hands in a hash function (or hashes the returned files itself). No clock: created_at is passed.
  /**
   * bookpack.js — THE PACK HANDED TO THE SHOP (v1.8.0, 2026-09-29; hardened v1.8.1, 2026-09-30). [SPEC-books-v2.md §6; RESEARCH-ledger-offload §5]
   *
   * Athi, 2026-09-29: *"how this data can be offloaded on a regular basis and handover to the entity."* ⭐ So every month
   * (and every year, and on exit) the shop gets its own records in forms any other system reads: a SAF-T-shaped JSON (the
   * OECD structure: master files + general ledger entries), Tally XML (ledgers under their Tally group, vouchers with
   * bill-wise references), plain CSVs, and a code book saying what every code means. ⚠️ The manifest's control totals are
   * the proof: counts, Σ debits = Σ credits, and opening + movement = closing for every account and party.
   * ⚠️ Screens say "Ledger pack", never "books of account", until Athi says so.
   *
   * ── INPUT ──  build(input, { hash? })
   *   input { kind: month|year|exit, entity: { id, name, tax_id?, country? }, fiscal_year, period? (month packs),
   *           from?, to? (override), created_at (ISO — passed, never read), software?: { name, version },
   *           accounts? (shop ledgers), parties[{ party_id, party_no, name, side: customer|supplier, legal_name?,
   *           tax_ids?[{ scheme, value }], state_code? }], lines (the range's journal lines, CBLedger.linesOf shape),
   *           balances? (period rows — the opening, and the independent closing), items? (party items: bill-wise, ageing),
   *           prev_sha256? }
   *   hash: (text) → hex sha256. Absent → every sha256 is null and manifest.unhashed = true (hash the files, then seal()).
   * ── OUTPUT ── { files: [{ name, content, rows }], manifest }
   *   ⚠️ items / lines: hand in what is dated ON OR BEFORE `to` — bill-wise references and ageing read every item given
   *   (a June allocation handed to a May pack would appear on May's voucher; a later bill would age as "not due").
   *
   * ── v1.8.1 (the critic's review, 2026-09-29) ──
   *   ⚠️⚠️ tally.xml IS NOT YET RUN AGAINST TALLYPRIME. manifest.tally_xml_status says so, and it stays so until a live
   *   import with Athi at the keyboard. The LIVE-PROVEN Tally writer is the platform's
   *   chitbridge-api/tools/tally-connector/adapters/tally.js (Sales / Receipt / Purchase voucher types, REPORTNAME
   *   Vouchers, ISPARTYLEDGER, eduDates — proven 2026-09-05). This engine is pure and cannot call it; the platform's pack
   *   builder should PREFER that adapter's voucher shape. Known differences here, NOT guessed at: every voucher is a
   *   Journal (TallyPrime refuses cash/bank ledgers in a Journal unless F12 allows it); masters and vouchers share one
   *   "All Masters" envelope; <PARENT> names a Tally group by its ENGLISH name (a company with renamed groups will not match).
   *   M7a  every party a voucher names gets a ledger master — one not in `parties` is created under its control
   *        account's group and named in manifest.checks.mismatches (party_unknown).
   *   M9   verify() flags a file the manifest does not list.  L9 verify(files, null) → ok: false.
   *   M11  SAF-T: what was added, and what is still missing, is listed above saft().
   */

  var PACKS_ = null,
    LEDGER_ = null,
    MONEY_ = null,
    REG_ = null;
  /* why a sibling engine could not be loaded, by path: a load that throws is recorded here (the old empty catch swallowed it) and the host global or null is the answer, as before */
  var LOAD_FAILURES_ = Object.create(null);
  /** the host's global engine (root, else window) when it has the probe key; else null */
  function hostEngine_(globalName, probeKey) {
    if (typeof root !== 'undefined' && root && root[globalName] && root[globalName][probeKey]) return root[globalName];
    if (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window[globalName]) return globalThis.window[globalName];
    return null;
  }
  /** require() of a sibling engine's file; null when it cannot be loaded, the reason recorded in LOAD_FAILURES_ */
  function requireEngine_(modulePath) {
    if (typeof require !== 'function') return null;
    try {
      return require(modulePath);
    } catch (err) {
      LOAD_FAILURES_[modulePath] = err && err.message;
      return null;
    }
  }
  /** find a sibling engine: the host's global (root or window), else require() of its file; null when neither is there */
  function req_(globalName, probeKey, modulePath) {
    return hostEngine_(globalName, probeKey) || requireEngine_(modulePath);
  }
  /** the accounts-packs engine (chart, periods, fiscal years), loaded once */
  function accountsPacks_() {
    return PACKS_ || (PACKS_ = req_('CBAccountsPacks', 'accountOf', './accounts-packs'));
  }
  /** the regulation engine (which pack an entity keeps its books under), loaded once */
  function regulation_() {
    return REG_ || (REG_ = req_('CBRegulation', 'resolve', './regulation'));
  }
  /** the ledger engine (balances, minor-unit reader, ageing), loaded once */
  function ledger_() {
    return LEDGER_ || (LEDGER_ = req_('CBLedger', 'balanceAsAt', './ledger'));
  }
  /** the money engine (decimals per currency), loaded once */
  function money_() {
    return MONEY_ || (MONEY_ = req_('CBMoney', 'decimals', './money'));
  }
  /** an Error with status 422 — the pack refuses, in words */
  function refuse_(reason) {
    var error = new Error(reason);
    error.status = 422;
    return error;
  }
  /** own property test that is safe for a key like "__proto__" */
  function own_(holder, name) {
    return !!holder && Object.prototype.hasOwnProperty.call(holder, name);
  }
  /** the pack's export rules (pack.export): the code book's columns, the tax lines of a SAF-T file, the accounting software's import file — a pack without them cannot be exported */
  function exportOf_(pack) {
    var rules = pack && pack.export;
    if (!rules || typeof rules.codeBookRow !== 'function') throw refuse_('The regulation pack has no export rules (pack.export), so a book pack cannot be built.');
    return rules;
  }
  /** every ageing bucket either side of the pack names, in order of first appearance — the numeric columns of ageing.csv */
  function bucketKeys_(pack) {
    var ageing = (pack.presentation || {}).ageing || {},
      keys = [];
    [ageing.receivable, ageing.payable].forEach(function (side) {
      (side || []).forEach(function (item) {
        if (keys.indexOf(item[0]) < 0) keys.push(item[0]);
      });
    });
    return keys;
  }
  const TALLY_XML_STATUS = 'not yet run against TallyPrime';

  /* ── exact decimals from minor units: string arithmetic, never a float ── */
  /** minor units → an exact decimal string with `places` digits after the point (2 when absent); a non-whole amount is refused */
  function decimalText(minor, places) {
    var digits = places == null ? 2 : places,
      amount = Number(minor);
    if (!Number.isSafeInteger(amount)) throw refuse_('Not a whole minor-unit amount: ' + String(minor).slice(0, 40) + '.');
    var negative = amount < 0,
      text = String(Math.abs(amount));
    if (digits === 0) return (negative ? '-' : '') + text;
    while (text.length <= digits) text = '0' + text;
    return (negative ? '-' : '') + text.slice(0, text.length - digits) + '.' + text.slice(text.length - digits);
  }
  /* v1.8.1 (H2): ONE date rule — accounts-packs.dayOf: a real calendar day as YYYY-MM-DD, else null */
  /** a real calendar day as YYYY-MM-DD, else null */
  function day_(text) {
    var packs = accountsPacks_();
    return packs && packs.dayOf ? packs.dayOf(text) : null;
  }
  /** a day number (days since 1970-01-01) → YYYY-MM-DD */
  function ymd_(dayNumber) {
    return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
  }

  /** ⭐ csv(rows, header) — RFC 4180; ⚠️ a text cell starting = + - @ (a spreadsheet formula) is prefixed with ' */
  function csvCell_(value, numeric) {
    if (value == null) return '';
    var text = String(value);
    if (!numeric && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  /** header + rows → CSV text (CRLF); `numericCols` are not formula-guarded */
  function csvText(header, rows, numericCols) {
    var numeric = {};
    (numericCols || []).forEach(function (item) {
      numeric[item] = 1;
    });
    return (
      [
        header
          .map(function (item) {
            return csvCell_(item);
          })
          .join(',')
      ]
        .concat(
          (rows || []).map(function (item) {
            return header
              .map(function (column) {
                return csvCell_(item[column], numeric[column]);
              })
              .join(',');
          })
        )
        .join('\r\n') + '\r\n'
    );
  }
  /** text safe inside XML (control characters dropped, five entities escaped) */
  function xml_(text) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
  /** UTF-8 byte length, counted — no TextEncoder needed */
  function bytes(text) {
    var total = 0,
      source = String(text);
    for (var index = 0; index < source.length; index++) {
      var code = source.charCodeAt(index);
      if (code < 0x80) total += 1;
      else if (code < 0x800) total += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length) {
        total += 4;
        index++;
      } else total += 3;
    }
    return total;
  }
  /** canonical JSON: keys sorted, so the same manifest always hashes the same */
  function canonical(list) {
    if (Array.isArray(list)) return '[' + list.map(canonical).join(',') + ']';
    if (list && typeof list === 'object')
      return (
        '{' +
        Object.keys(list)
          .sort()
          .map(function (item) {
            return JSON.stringify(item) + ':' + canonical(list[item]);
          })
          .join(',') +
        '}'
      );
    return JSON.stringify(list === undefined ? null : list);
  }

  /* ═══ the range, the chart, the parties — shared by every part ═══ */
  /** the pack kind: absent = month; L6 — 'quarter' became 'month' silently, so an unknown kind is refused */
  function kindOf_(x) {
    if (x.kind != null && ['month', 'year', 'exit'].indexOf(x.kind) < 0)
      throw refuse_('Unknown pack kind "' + String(x.kind).slice(0, 20) + '" — month, year or exit.');
    return x.kind || 'month';
  }
  /** the day range of the pack and the fiscal year it sits in (from/to wins, else the month or the year); refuses a bad, backwards or two-year range */
  function spanOf_(x, kind, pack, packs) {
    var range;
    if (x.from && x.to) range = { start: x.from, end: x.to };
    else if (kind === 'month') range = packs.periodRange(x.fiscal_year, Number(x.period), pack);
    else range = packs.fyRange(x.fiscal_year, pack);
    if (!range || day_(range.start) === null || day_(range.end) === null) throw refuse_('The pack needs its fiscal year (and month) or from/to.');
    if (day_(range.start) > day_(range.end)) throw refuse_('A pack runs from a day to a later one (' + range.start + ' → ' + range.end + ').');
    if (packs.fiscalYearOf(range.start, pack) !== packs.fiscalYearOf(range.end, pack)) throw refuse_('A pack stays inside one fiscal year.');
    return { range: range, fiscalYear: packs.fiscalYearOf(range.start, pack) };
  }
  /** the line → account reader over the pack's chart (cached; a code not in the chart is refused) */
  function chartReader_(packs, pack) {
    var chart = Object.create(null);
    return function (line) {
      var code = line.code != null && line.code !== '' ? String(line.code) : String(line.account == null ? '' : line.account);
      if (own_(chart, code)) return chart[code];
      var account = packs.accountOf(pack, code);
      if (!account) throw refuse_('The account "' + code + '" is not in the chart.');
      chart[code] = account;
      return account;
    };
  }
  /** the listed parties by id (a party id of "__proto__" is just a key) */
  function partiesById_(x) {
    var byId = Object.create(null);
    (x.parties || []).forEach(function (item) {
      if (item && item.party_id != null) byId[String(item.party_id)] = item;
    });
    return byId;
  }
  /** the journal lines inside the range, opening rows (period 0) left out */
  function movesInRange_(x, range) {
    var fromDay = day_(range.start),
      toDay = day_(range.end);
    return (x.lines || []).filter(function (item) {
      return item && Number(item.period) !== 0 && day_(item.date) >= fromDay && day_(item.date) <= toDay;
    });
  }
  /* M7a: a party a line names that is NOT in `parties` — it still gets a master (no ghost ledger) and is named in the manifest */
  /** the parties the lines name on a debtors / creditors account that the party list does not hold, sorted by id */
  function unknownParties_(packs, pack, acct, moves, parties) {
    var debtors = packs.accountOf(pack, 'debtors').code,
      creditors = packs.accountOf(pack, 'creditors').code,
      unknown = Object.create(null);
    moves.forEach(function (line) {
      if (!line.party) return;
      var code = acct(line).code,
        partyKey = String(line.party);
      if ((code !== debtors && code !== creditors) || parties[partyKey] || unknown[partyKey]) return;
      unknown[partyKey] = { party_id: partyKey, party_no: null, name: partyKey, side: code === creditors ? 'supplier' : 'customer', unknown: true };
    });
    return Object.keys(unknown)
      .sort()
      .map(function (item) {
        return unknown[item];
      });
  }
  /** the shared context of every part: engines, pack, kind, fiscal year, range, currency, decimals, chart reader, parties, lines in range, unknown parties */
  function context_(input) {
    var x = input || {},
      packs = accountsPacks_(),
      ledger = ledger_();
    if (!packs || !ledger) throw refuse_('The pack needs the accounts-packs and ledger engines.');
    var regulation = regulation_();
    if (!regulation) throw refuse_('The pack needs the regulation engine (it says which pack the entity keeps its books under).');
    var pack = regulation.resolve({ pack: x.pack, country: x.entity && x.entity.country });
    if (pack.unknown) throw Object.assign(refuse_(pack.why), { code: pack.code }); /* CTRY-94: a country with no pack gets no books pack — never India's chart */
    if (Array.isArray(x.accounts) && x.accounts.length) pack = packs.withAccounts(pack, x.accounts);
    var kind = kindOf_(x),
      span = spanOf_(x, kind, pack, packs);
    var currency = String(pack.currency),
      money = money_(),
      decimals = money && money.decimals ? money.decimals(currency) : 2;
    var acct = chartReader_(packs, pack),
      parties = partiesById_(x),
      moves = movesInRange_(x, span.range);
    return {
      x: x,
      P: packs,
      G: ledger,
      pack: pack,
      kind: kind,
      fy: span.fiscalYear,
      range: span.range,
      cur: currency,
      dp: decimals,
      acct: acct,
      parties: parties,
      moves: moves,
      unknown: unknownParties_(packs, pack, acct, moves, parties)
    };
  }

  /** add one opening row (period 0) to the opening positions: the account's net, and the party's net when the row names a party */
  function foldOpeningRow_(context, open, item, where, rowsGiven) {
    var account = context.acct(item),
      debit = item.dr_minor == null ? 0 : context.G.minor(item.dr_minor, where),
      credit = item.cr_minor == null ? 0 : context.G.minor(item.cr_minor, where);
    var isParty = item.party != null && item.party !== '';
    if (!rowsGiven || !isParty) {
      var accountNet = open.accounts[account.code] || (open.accounts[account.code] = { net_minor: 0 });
      accountNet.net_minor += debit - credit;
    }
    if (isParty) {
      var byParty = open.parties[account.code] || (open.parties[account.code] = Object.create(null)),
        partyNet = byParty[item.party] || (byParty[item.party] = { net_minor: 0 });
      partyNet.net_minor += debit - credit;
    }
  }
  /** the opening positions summed from the period-0 rows of the fiscal year (the first period of a year has no day before it in that year) */
  function openingFromRows_(context, rowsGiven) {
    var open = { accounts: Object.create(null), parties: Object.create(null) };
    var list = rowsGiven ? context.x.balances : context.x.lines || [];
    list.forEach(function (item, index) {
      if (!item || item.fiscal_year !== context.fy || Number(item.period) !== 0) return;
      /* L10: G.minor — the ledger's one reader ('1e3' and true were taken by Number() here, and refused everywhere else) */
      foldOpeningRow_(context, open, item, 'opening row ' + (index + 1), rowsGiven);
    });
    return open;
  }
  /** the movement of the range: debits and credits per code and per code+party, and the two totals */
  function movementOf_(context) {
    var moved = { mv: Object.create(null), mvp: Object.create(null), dr: 0, cr: 0 };
    context.moves.forEach(function (item) {
      var where = 'a line of ' + (item.jv_no || item.entry_id || '?');
      var account = context.acct(item),
        debit = item.dr_minor == null ? 0 : context.G.minor(item.dr_minor, where),
        credit = item.cr_minor == null ? 0 : context.G.minor(item.cr_minor, where);
      var total = moved.mv[account.code] || (moved.mv[account.code] = { dr_minor: 0, cr_minor: 0 });
      total.dr_minor += debit;
      total.cr_minor += credit;
      if (item.party) {
        var byParty = moved.mvp[account.code] || (moved.mvp[account.code] = Object.create(null)),
          partyTotal = byParty[item.party] || (byParty[item.party] = { dr_minor: 0, cr_minor: 0 });
        partyTotal.dr_minor += debit;
        partyTotal.cr_minor += credit;
      }
      moved.dr += debit;
      moved.cr += credit;
    });
    return moved;
  }
  /** the opening (the day before the range) and the closing, as nets per code and per code+party */
  function positions_(context) {
    var x = context.x,
      packs = context.P,
      previousDay = ymd_(day_(context.range.start) - 1),
      rowsGiven = Array.isArray(x.balances);
    var base = { pack: context.pack, balances: x.balances, lines: x.lines };
    var monthEnd = function (dayText) {
      var range = packs.periodRange(packs.fiscalYearOf(dayText, context.pack), packs.periodOf(dayText, context.pack), context.pack);
      return !!range && range.end === dayText;
    };
    /* ⭐ v1.8.1 (H1): when the rows were handed in, the opening and the closing are THE ROWS' OWN figures, asked for by
       name — { prefer: 'rows' } — never inferred from the calendar. That is what makes the tie check independent. */
    var rowsAt = function (dayText) {
      return context.G.balanceAsAt(Object.assign({}, base, { asOf: dayText }, rowsGiven && monthEnd(dayText) ? { prefer: 'rows' } : {}));
    };
    var open = packs.fiscalYearOf(previousDay, context.pack) === context.fy ? rowsAt(previousDay) : openingFromRows_(context, rowsGiven);
    var moved = movementOf_(context);
    /* the independent closing: the month rows at the range end (when the rows were handed in) */
    var close = rowsGiven ? rowsAt(context.range.end) : null;
    return { open: open, mv: moved.mv, mvp: moved.mvp, close: close, dr: moved.dr, cr: moved.cr };
  }

  /* ═══ THE PARTS ═══ */

  /** ⭐ codeBook(input) → the CSV that says what every code means: the columns are the pack's (pack.export.codeBookColumns) */
  function codeBook(input) {
    var context = context_(input),
      packs = context.P,
      accounts = [];
    var addCode = function (entry) {
      var account = packs.accountOf(context.pack, entry.code);
      if (account) accounts.push(account);
    };
    (context.pack.ledgers || []).concat(context.pack.expense_classes || [], context.pack.income_classes || []).forEach(addCode);
    var seen = {},
      out = [];
    accounts
      .sort(function (first, second) {
        return first.code < second.code ? -1 : first.code > second.code ? 1 : 0;
      })
      .forEach(function (item) {
        if (seen[item.code]) return;
        seen[item.code] = 1;
        out.push(exportOf_(context.pack).codeBookRow(item));
      });
    return out;
  }

  /** the schema's CHOICE: a debit balance OR a credit balance (a nil balance is a debit of 0.00) */
  function setBalance_(target, prefix, netMinor, decimals) {
    if (netMinor >= 0) target[prefix + 'DebitBalance'] = decimalText(netMinor, decimals);
    else target[prefix + 'CreditBalance'] = decimalText(-netMinor, decimals);
  }
  /** the SAF-T GeneralLedgerAccounts: every code with an opening or a movement, opening and closing as one explicit side */
  function saftAccounts_(input, pos, decimals) {
    var closeNet = function (code) {
      var opening = (pos.open.accounts[code] || { net_minor: 0 }).net_minor,
        moved = pos.mv[code] || { dr_minor: 0, cr_minor: 0 };
      return opening + moved.dr_minor - moved.cr_minor;
    };
    return codeBook(input)
      .filter(function (item) {
        return pos.open.accounts[item.code] || pos.mv[item.code];
      })
      .map(function (item) {
        var row = {
          AccountID: item.code,
          AccountDescription: item.name,
          StandardAccountID: item.role || null,
          GroupingCategory: item.saft_category,
          GroupingCode: item.saft_code,
          AccountType: 'GL'
        };
        setBalance_(row, 'Opening', (pos.open.accounts[item.code] || { net_minor: 0 }).net_minor, decimals);
        setBalance_(row, 'Closing', closeNet(item.code), decimals);
        return row;
      });
  }
  /** one SAF-T Customer / Supplier row: id, account, name, address, tax registrations, opening and closing */
  function saftPartyRow_(pos, party, code, idKey, decimals) {
    var opening = ((pos.open.parties[code] || {})[party.party_id] || { net_minor: 0 }).net_minor,
      moved = (pos.mvp[code] || {})[party.party_id] || { dr_minor: 0, cr_minor: 0 };
    var row = {};
    row[idKey] = party.party_no || String(party.party_id);
    row.AccountID = code;
    row.Name = party.legal_name || party.name;
    if (party.address) row.Address = party.address;
    row.TaxRegistration = (party.tax_ids || []).map(function (item) {
      return { TaxRegistrationNumber: item.value, TaxType: item.scheme };
    });
    if (party.unknown) row.NotInPartyList = true; /* M7a: named on a line, absent from `parties` */
    setBalance_(row, 'Opening', opening, decimals);
    setBalance_(row, 'Closing', opening + moved.dr_minor - moved.cr_minor, decimals);
    return row;
  }
  /** the SAF-T Customers and Suppliers: the listed parties by id, then the unknown ones; a party is a supplier only when it says so */
  function saftParties_(context, pos) {
    var debtors = context.P.accountOf(context.pack, 'debtors').code,
      creditors = context.P.accountOf(context.pack, 'creditors').code;
    var everyone = Object.keys(context.parties)
      .sort()
      .map(function (item) {
        return context.parties[item];
      })
      .concat(context.unknown);
    return {
      customers: everyone
        .filter(function (item) {
          return item.side !== 'supplier';
        })
        .map(function (item) {
          return saftPartyRow_(pos, item, debtors, 'CustomerID', context.dp);
        }),
      suppliers: everyone
        .filter(function (item) {
          return item.side === 'supplier';
        })
        .map(function (item) {
          return saftPartyRow_(pos, item, creditors, 'SupplierID', context.dp);
        })
    };
  }
  /** the lines in range grouped by entry (journal number, else entry id) and the entries in date, then id, order */
  function entriesOf_(moves) {
    var byEntry = Object.create(null),
      order = [];
    moves.forEach(function (item) {
      var entryKey = item.jv_no || item.entry_id;
      if (!byEntry[entryKey]) {
        byEntry[entryKey] = [];
        order.push(entryKey);
      }
      byEntry[entryKey].push(item);
    });
    order.sort(function (first, second) {
      var firstLine = byEntry[first][0],
        secondLine = byEntry[second][0];
      return day_(firstLine.date) - day_(secondLine.date) || String(first).localeCompare(String(second));
    });
    return { byEntry: byEntry, order: order };
  }
  /** the pack's tax line for an account (which ledgers are tax lines), or null when the pack has no such rule */
  function taxLineOf_(rules, account) {
    return typeof rules.taxLine === 'function' ? rules.taxLine(account) : null;
  }
  /** the taxable value per rate: an entry's rated lines that are not tax lines */
  function taxableBaseByRate_(context, rules, lines) {
    var base = Object.create(null);
    lines.forEach(function (entry) {
      if (entry.rate == null || taxLineOf_(rules, context.acct(entry))) return;
      var rate = String(entry.rate);
      base[rate] = (base[rate] || 0) + Number(entry.dr_minor || 0) + Number(entry.cr_minor || 0);
    });
    return base;
  }
  /** Line.TaxInformation of a tax line; also notes the code and rate in `seenTax` for the TaxTable */
  function taxInformationOf_(context, rules, taxLine, account, entry, base, seenTax) {
    var percentage = rules.taxPercentage(taxLine, entry.rate),
      taxBase = entry.rate != null && base[String(entry.rate)] != null ? decimalText(base[String(entry.rate)], context.dp) : null;
    var information = {
      TaxType: rules.taxTable.TaxType,
      TaxCode: taxLine.code,
      TaxPercentage: percentage,
      TaxBase: taxBase,
      TaxAmount: { Amount: decimalText(Number(entry.dr_minor) || Number(entry.cr_minor) || 0, context.dp) }
    };
    var seenKey = taxLine.code + '|' + (percentage === null ? '' : percentage);
    if (!seenTax[seenKey]) seenTax[seenKey] = { TaxCode: taxLine.code, Description: rules.taxCodeDescription(account), TaxPercentage: percentage };
    return information;
  }
  /** one SAF-T transaction Line from a journal line: ids, party, amount side, and the tax information when the account is a tax line */
  function saftLine_(context, rules, entry, index, base, seenTax) {
    var account = context.acct(entry),
      party = entry.party ? context.parties[String(entry.party)] : null,
      line = { RecordID: String(index + 1), AccountID: account.code };
    if (entry.party) {
      var partyId = party && party.party_no ? party.party_no : String(entry.party);
      if (account.code === context.P.accountOf(context.pack, 'creditors').code) line.SupplierID = partyId;
      else line.CustomerID = partyId;
    }
    line.SourceDocumentID = entry.ref || null;
    line.Description = account.name;
    if (Number(entry.dr_minor)) line.DebitAmount = { Amount: decimalText(entry.dr_minor, context.dp) };
    else line.CreditAmount = { Amount: decimalText(entry.cr_minor, context.dp) };
    var taxLine = taxLineOf_(rules, account);
    if (taxLine) line.TaxInformation = taxInformationOf_(context, rules, taxLine, account, entry, base, seenTax);
    return line;
  }
  /** one SAF-T Transaction from the lines of an entry */
  function saftTransaction_(context, rules, entryId, lines, seenTax) {
    var head = lines[0],
      base = taxableBaseByRate_(context, rules, lines);
    return {
      TransactionID: String(entryId),
      Period: Number(head.period),
      PeriodYear: context.fy,
      TransactionDate: head.date,
      GLPostingDate: head.date,
      SystemEntryDate: head.posted_at || null,
      Description: head.narration || null,
      SourceID: head.entry_id != null ? String(head.entry_id) : null,
      Line: lines.map(function (entry, index) {
        return saftLine_(context, rules, entry, index, base, seenTax);
      })
    };
  }
  /** the SAF-T Header.Company: registration, name, entity id and the tax registrations (entity.tax_id first) */
  function saftCompany_(entity, rules) {
    var registrations = (entity.tax_ids || []).map(function (item) {
      return { TaxRegistrationNumber: item.value, TaxType: item.scheme };
    });
    if (entity.tax_id) registrations.unshift({ TaxRegistrationNumber: entity.tax_id, TaxType: entity.tax_scheme || rules.taxScheme || 'TAX' });
    var company = { RegistrationNumber: entity.registration_no || null, Name: entity.name || null, EntityID: entity.id || null, TaxRegistration: registrations };
    if (entity.address) company.Address = entity.address;
    return company;
  }
  /** the SAF-T Header: version, country, software, company, currency, selection, accounting basis */
  function saftHeader_(context, company) {
    var x = context.x,
      software = x.software || {};
    return {
      AuditFileVersion: '2.00',
      AuditFileCountry: context.pack.country,
      AuditFileDateCreated: x.created_at || null,
      SoftwareCompanyName: software.company || 'ChitBridge',
      SoftwareID: software.name || 'chitbridge-engines/bookpack',
      SoftwareVersion: software.version || null,
      Company: company,
      DefaultCurrencyCode: context.cur,
      SelectionCriteria: { SelectionStartDate: context.range.start, SelectionEndDate: context.range.end, PeriodYear: context.fy, Kind: context.kind },
      TaxAccountingBasis: x.tax_accounting_basis || 'Invoice',
      HeaderComment: 'SAF-T-shaped (OECD SAF-T 2.0 structure) — a handover record, not a statutory filing. Not included: SourceDocuments.'
    };
  }

  /**
   * ⭐ saft(input) → the SAF-T-shaped object (OECD 2.0 structure: Header · MasterFiles · GeneralLedgerEntries).
   * ⚠️ "SAF-T-SHAPED", NOT A SAF-T FILE — nobody promises a CA one. v1.8.1 (critic M11), against the OECD 2.0 schema:
   *   ADDED where the input carries the data — Header.TaxAccountingBasis (input.tax_accounting_basis, else 'Invoice':
   *     entries are posted on the bill) · Company.TaxRegistration[] (entity.tax_id / tax_ids — it used to sit in
   *     RegistrationNumber, which is the COMPANY registration: now entity.registration_no) · Company.Address and
   *     Customer/Supplier.Address (when entity.address / party.address are given) · Journal.Type · Transaction.SystemEntryDate
   *     (the line's posted_at, else null) · Line.TaxInformation on the tax lines (TaxType, TaxCode, TaxPercentage, TaxBase,
   *     TaxAmount — TaxPercentage/TaxBase only when the line carries its rate) · MasterFiles.TaxTable (the codes and rates seen)
   *     · opening / closing balances as ONE explicit side (the schema's choice), never both with "0.00".
   *   STILL MISSING, by name — SourceDocuments (sales / purchase invoices, payments): the engine is handed journal lines, not
   *     the documents; Address where the input has none; tax lines posted without a rate (an expense's input tax) carry no
   *     TaxPercentage / TaxBase.
   */
  function saft(input) {
    var context = context_(input),
      pos = positions_(context),
      decimals = context.dp;
    var accounts = saftAccounts_(input, pos, decimals),
      parties = saftParties_(context, pos),
      entries = entriesOf_(context.moves);
    /* a tax line: the pack says which ledgers are tax lines (and what percentage a line's rate means) */
    var rules = exportOf_(context.pack),
      seenTax = Object.create(null);
    var transactions = entries.order.map(function (entryId) {
      return saftTransaction_(context, rules, entryId, entries.byEntry[entryId], seenTax);
    });
    var company = saftCompany_(context.x.entity || {}, rules);
    var taxCodes = Object.keys(seenTax)
      .sort()
      .map(function (item) {
        return seenTax[item];
      });
    return {
      AuditFile: {
        Header: saftHeader_(context, company),
        MasterFiles: {
          GeneralLedgerAccounts: { Account: accounts },
          Customers: { Customer: parties.customers },
          Suppliers: { Supplier: parties.suppliers },
          TaxTable: { TaxTableEntry: taxCodes.length ? [{ TaxType: rules.taxTable.TaxType, Description: rules.taxTable.Description, TaxCodeDetails: taxCodes }] : [] }
        },
        GeneralLedgerEntries: {
          NumberOfEntries: transactions.length,
          TotalDebit: decimalText(pos.dr, decimals),
          TotalCredit: decimalText(pos.cr, decimals),
          Journal: [{ JournalID: 'GJ', Description: 'General journal', Type: 'GL', Transaction: transactions }]
        }
      }
    };
  }

  /** what a party line settled, by bill: the sum of its allocation / reversal items per `against_ref` */
  function againstTotals_(items) {
    var totals = Object.create(null);
    items.forEach(function (item) {
      if (item.against_ref === item.ref) return;
      if (item.ref_kind !== 'allocation' && item.ref_kind !== 'reversal') return;
      totals[item.against_ref] = (totals[item.against_ref] || 0) + Number(item.amount_minor);
    });
    return totals;
  }
  /* the bill-wise split of one party line: Agst Ref for each bill it settled (from the party items), the rest New Ref / Advance */
  /** the bill-wise split of one party line: Agst Ref for each bill it settled, the rest New Ref / Advance / On Account */
  function billwise_(context, line, signedMinor) {
    var items = (context.x.items || []).filter(function (item) {
      return item && item.ref === line.ref && String(item.party) === String(line.party);
    });
    var out = [],
      left = signedMinor,
      against = againstTotals_(items);
    var sign = signedMinor < 0 ? -1 : 1;
    Object.keys(against)
      .sort()
      .forEach(function (refName) {
        var settled = against[refName];
        if (!settled) return;
        var take = sign * Math.min(Math.abs(settled), Math.abs(left));
        if (!take) return;
        out.push({ name: refName, type: 'Agst Ref', minor: take });
        left -= take;
      });
    if (left) {
      var isBill = items.some(function (item) {
        return item.ref_kind === 'bill';
      });
      out.push({ name: line.ref || String(line.jv_no || line.entry_id), type: isBill ? 'New Ref' : items.length ? 'Advance' : 'On Account', minor: left });
    }
    return out;
  }

  /**
   * ⭐ tallyXml(input) → the accounting software's import XML: masters (ledgers under their group, parties bill-wise) + journal vouchers. The writer is the pack's (pack.export.tallyXml,
   * moved verbatim from here in b7); this keeps the export name and hands it the pieces it reads — the context, the opening and closing positions, the code book, the bill-wise split.
   * ⚠️⚠️ STATUS: 'not yet run against TallyPrime' (manifest.tally_xml_status). See the v1.8.1 note at the top of this file: the
   * live-proven writer is chitbridge-api tools/tally-connector/adapters/tally.js; nothing here was shaped by guessing at
   * what TallyPrime accepts. v1.8.1 (M7a): a master is created for EVERY party a voucher names, listed or not.
   */
  function tallyXml(input) {
    var context = context_(input),
      rules = exportOf_(context.pack);
    if (typeof rules.tallyXml !== 'function') throw refuse_('The regulation pack has no import file for an accounting package (pack.export.tallyXml).');
    return rules.tallyXml({
      c: context,
      pos: positions_(context),
      codeBook: function () {
        return codeBook(input);
      },
      billwise: billwise_,
      dec: decimalText,
      xml: xml_,
      day: day_
    });
  }

  /** trial_balance.csv rows: per code, opening / movement / closing as a debit and a credit column */
  function trialBalanceRows_(context, pos, names) {
    var codes = Object.create(null);
    Object.keys(pos.open.accounts)
      .concat(Object.keys(pos.mv))
      .forEach(function (item) {
        codes[item] = 1;
      });
    return Object.keys(codes)
      .sort()
      .map(function (item) {
        var opening = (pos.open.accounts[item] || { net_minor: 0 }).net_minor,
          moved = pos.mv[item] || { dr_minor: 0, cr_minor: 0 },
          closing = opening + moved.dr_minor - moved.cr_minor;
        return {
          code: item,
          name: (names[item] || {}).name,
          group: exportOf_(context.pack).groupName(names[item] || {}),
          opening_dr: decimalText(opening > 0 ? opening : 0, context.dp),
          opening_cr: decimalText(opening < 0 ? -opening : 0, context.dp),
          movement_dr: decimalText(moved.dr_minor, context.dp),
          movement_cr: decimalText(moved.cr_minor, context.dp),
          closing_dr: decimalText(closing > 0 ? closing : 0, context.dp),
          closing_cr: decimalText(closing < 0 ? -closing : 0, context.dp)
        };
      });
  }
  /** the listed party for an id, or null */
  function partyOf_(context, id) {
    var party = context.parties[String(id)];
    return party ? party : null;
  }
  /** the party number and name a line shows: the listed party's, else the bare id and a blank name */
  function partyColumns_(context, item) {
    var party = item.party ? partyOf_(context, item.party) : null;
    return { party_no: party ? party.party_no : item.party || '', party: party ? party.name : '' };
  }
  /** the account's running balance after this line (it starts from the account's opening net) */
  function runningAfter_(pos, running, account, item) {
    if (running[account.code] == null) running[account.code] = (pos.open.accounts[account.code] || { net_minor: 0 }).net_minor;
    running[account.code] += Number(item.dr_minor || 0) - Number(item.cr_minor || 0);
    return running[account.code];
  }
  /** ledgers.csv rows: the lines by account code, each with the account's running balance */
  function ledgerRows_(context, pos, sorted) {
    var running = Object.create(null);
    return sorted
      .slice()
      .sort(function (first, second) {
        var firstCode = context.acct(first).code,
          secondCode = context.acct(second).code;
        return firstCode < secondCode ? -1 : firstCode > secondCode ? 1 : 0;
      })
      .map(function (item) {
        var account = context.acct(item);
        var balance = runningAfter_(pos, running, account, item);
        var columns = partyColumns_(context, item);
        return {
          code: account.code,
          account: account.name,
          date: item.date,
          jv_no: item.jv_no || item.entry_id,
          ref: item.ref || '',
          party_no: columns.party_no,
          party: columns.party,
          narration: item.narration || '',
          dr: decimalText(item.dr_minor || 0, context.dp),
          cr: decimalText(item.cr_minor || 0, context.dp),
          balance: decimalText(balance, context.dp)
        };
      });
  }
  /** day_book.csv rows: the lines in date, entry, line order */
  function dayBookRows_(context, sorted) {
    return sorted.map(function (item) {
      var account = context.acct(item),
        party = item.party ? partyOf_(context, item.party) : null;
      return {
        date: item.date,
        jv_no: item.jv_no || item.entry_id,
        narration: item.narration || '',
        code: account.code,
        account: account.name,
        party_no: party ? party.party_no : item.party || '',
        dr: decimalText(item.dr_minor || 0, context.dp),
        cr: decimalText(item.cr_minor || 0, context.dp)
      };
    });
  }
  /** the ageing rows of one party on one side: one row for its undisputed part and one for its disputed part, when not nil */
  function ageingPartyRows_(context, aged, side, partyId) {
    var rows = [];
    ['undisputed', 'disputed'].forEach(function (disputeKey) {
      var buckets = aged.by_party[partyId][disputeKey],
        total = aged.bucket_keys.reduce(function (sum, entry) {
          return sum + buckets[entry];
        }, 0);
      if (!total) return;
      var party = partyOf_(context, partyId),
        row = { side: side, party_no: party ? party.party_no : partyId, party: party ? party.name : '', disputed: disputeKey === 'disputed' ? 'yes' : 'no' };
      aged.bucket_keys.forEach(function (entry) {
        row[entry] = decimalText(buckets[entry], context.dp);
      });
      row.total = decimalText(total, context.dp);
      rows.push(row);
    });
    return rows;
  }
  /** ageing.csv rows from the party items, receivable then payable side (needs the receivables engine) */
  function ageingRows_(context) {
    var rows = [];
    if (!(Array.isArray(context.x.items) && context.x.items.length)) return rows;
    var receivables = req_('CBReceivables', 'outstanding', './receivables');
    if (!receivables) throw refuse_('Ageing from party items needs the receivables engine.');
    ['receivable', 'payable'].forEach(function (side) {
      var documents = context.x.items.filter(function (item) {
        return item && (item.side || 'receivable') === side;
      });
      if (!documents.length) return;
      var aged = context.G.ageing(receivables.outstanding(documents, { pack: context.pack }).by_ref, context.range.end, side, { pack: context.pack });
      Object.keys(aged.by_party)
        .sort()
        .forEach(function (partyId) {
          ageingPartyRows_(context, aged, side, partyId).forEach(function (row) {
            rows.push(row);
          });
        });
    });
    return rows;
  }

  /** ⭐ the CSV parts: trial balance (opening · movement · closing), ledgers (running per account), day book, ageing */
  function tables(input) {
    var context = context_(input),
      pos = positions_(context);
    var names = Object.create(null);
    codeBook(input).forEach(function (item) {
      names[item.code] = item;
    });
    var trialBalance = trialBalanceRows_(context, pos, names);
    var sorted = context.moves.slice().sort(function (first, second) {
      return (
        day_(first.date) - day_(second.date) ||
        String(first.jv_no || first.entry_id).localeCompare(String(second.jv_no || second.entry_id)) ||
        (first.line_no || 0) - (second.line_no || 0)
      );
    });
    var ledgers = ledgerRows_(context, pos, sorted),
      dayBook = dayBookRows_(context, sorted);
    return { trial_balance: trialBalance, ledgers: ledgers, day_book: dayBook, ageing: ageingRows_(context) };
  }

  /** the CSV files of a pack, in manifest order: trial balance, ledgers, day book, ageing, code book */
  function csvFiles_(context, parts, codeRows) {
    var ageingColumns = ['side', 'party_no', 'party', 'disputed'];
    return [
      {
        name: 'trial_balance.csv',
        content: csvText(
          ['code', 'name', 'group', 'opening_dr', 'opening_cr', 'movement_dr', 'movement_cr', 'closing_dr', 'closing_cr'],
          parts.trial_balance,
          ['opening_dr', 'opening_cr', 'movement_dr', 'movement_cr', 'closing_dr', 'closing_cr']
        ),
        rows: parts.trial_balance.length
      },
      {
        name: 'ledgers.csv',
        content: csvText(['code', 'account', 'date', 'jv_no', 'ref', 'party_no', 'party', 'narration', 'dr', 'cr', 'balance'], parts.ledgers, ['dr', 'cr', 'balance']),
        rows: parts.ledgers.length
      },
      {
        name: 'day_book.csv',
        content: csvText(['date', 'jv_no', 'narration', 'code', 'account', 'party_no', 'dr', 'cr'], parts.day_book, ['dr', 'cr']),
        rows: parts.day_book.length
      },
      {
        name: 'ageing.csv',
        content: csvText(
          ageingColumns.concat(
            parts.ageing.length
              ? Object.keys(parts.ageing[0]).filter(function (item) {
                  return ageingColumns.indexOf(item) < 0;
                })
              : ['total']
          ),
          parts.ageing,
          bucketKeys_(context.pack).concat(['total'])
        ),
        rows: parts.ageing.length
      },
      { name: 'code_book.csv', content: csvText(exportOf_(context.pack).codeBookColumns, codeRows), rows: codeRows.length }
    ];
  }
  /** the lines in range summed per entry: [Σdebit, Σcredit] */
  function entryTotals_(moves) {
    var totals = Object.create(null);
    moves.forEach(function (item) {
      var entryKey = item.jv_no || item.entry_id,
        sums = totals[entryKey] || (totals[entryKey] = [0, 0]);
      sums[0] += Number(item.dr_minor || 0);
      sums[1] += Number(item.cr_minor || 0);
    });
    return totals;
  }
  /** the controls that do not need the closing rows: Σdr = Σcr, every entry balances, every party a voucher names is listed (M7a: built, but never clean) */
  function balanceMismatches_(context, pos, totals) {
    var found = [];
    if (pos.dr !== pos.cr) found.push({ name: 'unbalanced', dr_minor: pos.dr, cr_minor: pos.cr });
    context.unknown.forEach(function (item) {
      found.push({ name: 'party_unknown', party: item.party_id, side: item.side });
    });
    Object.keys(totals).forEach(function (item) {
      if (totals[item][0] !== totals[item][1]) found.push({ name: 'entry_unbalanced', entry: item, dr_minor: totals[item][0], cr_minor: totals[item][1] });
    });
    return found;
  }
  /** opening + movement = the closing the month rows say, per account; adds a mismatch for each that differs, returns whether all tie */
  function accountTie_(pos, found) {
    var tieHolds = true,
      codes = Object.create(null);
    Object.keys(pos.open.accounts)
      .concat(Object.keys(pos.mv), Object.keys(pos.close.accounts))
      .forEach(function (item) {
        codes[item] = 1;
      });
    Object.keys(codes)
      .sort()
      .forEach(function (item) {
        var want = (pos.open.accounts[item] || { net_minor: 0 }).net_minor + (pos.mv[item] ? pos.mv[item].dr_minor - pos.mv[item].cr_minor : 0);
        var have = (pos.close.accounts[item] || { net_minor: 0 }).net_minor;
        if (want === have) return;
        tieHolds = false;
        found.push({ name: 'opening_plus_movement_ne_closing', code: item, computed_minor: want, rows_minor: have });
      });
    return tieHolds;
  }
  /** the same tie per code+party; adds a mismatch for each that differs, returns whether all tie */
  function partyTie_(pos, found) {
    var tieHolds = true,
      pairs = Object.create(null);
    [pos.open.parties, pos.mvp, pos.close.parties].forEach(function (byCode) {
      Object.keys(byCode).forEach(function (code) {
        Object.keys(byCode[code]).forEach(function (partyId) {
          pairs[code + '\u0000' + partyId] = 1;
        });
      });
    });
    Object.keys(pairs)
      .sort()
      .forEach(function (pairKey) {
        var parts = pairKey.split('\u0000'),
          code = parts[0],
          partyId = parts[1];
        var opening = ((pos.open.parties[code] || {})[partyId] || { net_minor: 0 }).net_minor,
          moved = (pos.mvp[code] || {})[partyId];
        var want = opening + (moved ? moved.dr_minor - moved.cr_minor : 0),
          have = ((pos.close.parties[code] || {})[partyId] || { net_minor: 0 }).net_minor;
        if (want === have) return;
        tieHolds = false;
        found.push({ name: 'party_opening_plus_movement_ne_closing', code: code, party: partyId, computed_minor: want, rows_minor: have });
      });
    return tieHolds;
  }
  /** the manifest's file rows: name, size, row count and the hash (null when no hash function was given) */
  function manifestFileRows_(files, hash) {
    return files.map(function (item) {
      var row = { file: item.name, bytes: item.bytes, rows: item.rows, sha256: hash ? String(hash(item.content)) : null };
      if (item.name === 'tally.xml') row.status = TALLY_XML_STATUS;
      return row;
    });
  }
  /** the manifest's counts: entries, lines, accounts, customers, suppliers, unknown parties, party items */
  function manifestCounts_(context, entryCount, accountCount) {
    var parties = Object.keys(context.parties).map(function (item) {
      return context.parties[item];
    });
    return {
      entries: entryCount,
      lines: context.moves.length,
      accounts: accountCount,
      customers: parties.filter(function (item) {
        return item.side !== 'supplier';
      }).length,
      suppliers: parties.filter(function (item) {
        return item.side === 'supplier';
      }).length,
      parties_unknown: context.unknown.length,
      party_items: (context.x.items || []).length
    };
  }
  /** the manifest of a pack: what it is, its files, counts, control totals and checks (sha256 left null, filled by build) */
  function manifestOf_(context, pos, files, hash, found, tieHolds, entryCount, accountCount) {
    return {
      pack_kind: context.kind,
      entity_id: (context.x.entity || {}).id || null,
      fiscal_year: context.fy,
      period: context.kind === 'month' ? Number(context.x.period) || null : null,
      from: context.range.start,
      to: context.range.end,
      created_at: context.x.created_at || null,
      currency: context.cur,
      format: 'chitbridge-bookpack/1',
      files: manifestFileRows_(files, hash),
      tally_xml_status: typeof exportOf_(context.pack).tallyXml === 'function' ? TALLY_XML_STATUS : undefined,
      counts: manifestCounts_(context, entryCount, accountCount),
      totals: {
        dr_minor: pos.dr,
        cr_minor: pos.cr,
        dr: decimalText(pos.dr, context.dp),
        cr: decimalText(pos.cr, context.dp),
        balanced: pos.dr === pos.cr
      },
      checks: { ok: found.length === 0, opening_plus_movement_equals_closing: tieHolds, mismatches: found },
      prev_sha256: context.x.prev_sha256 || null,
      sha256: null
    };
  }

  /**
   * ⭐⭐ build(input, { hash? }) → { files[{ name, content, rows, bytes }], manifest } — every part, and the manifest:
   *   { pack_kind, entity_id, fiscal_year, period, from, to, created_at, currency, files[{ file, bytes, rows, sha256 }],
   *     counts{ entries, lines, accounts, customers, suppliers, party_items }, totals{ dr_minor, cr_minor, balanced },
   *     checks{ ok, opening_plus_movement_equals_closing, mismatches[] }, prev_sha256, sha256,
   *     tally_xml_status (v1.8.1: 'not yet run against TallyPrime' — also on the tally.xml file row) }
   * ⚠️ A pack whose controls fail is still BUILT (the shop is owed its records) — manifest.checks.ok is false and the
   * mismatches are named; the caller shows them and never marks such a pack clean.
   */
  function build(input, opt) {
    var context = context_(input),
      options = opt || {},
      pos = positions_(context),
      hash = typeof options.hash === 'function' ? options.hash : null;
    var parts = tables(input),
      saftObject = saft(input),
      codeRows = codeBook(input);
    var entryCount = saftObject.AuditFile.GeneralLedgerEntries.NumberOfEntries;
    var files = [
      { name: 'saft.json', content: JSON.stringify(saftObject, null, 1) + '\n', rows: entryCount },
      typeof exportOf_(context.pack).tallyXml === 'function' ? { name: 'tally.xml', content: tallyXml(input), rows: entryCount } : null
    ].concat(csvFiles_(context, parts, codeRows));
    files = files.filter(Boolean);
    files.forEach(function (item) {
      item.bytes = bytes(item.content);
    });
    /* ⭐ the controls: Σdr = Σcr; opening + movement = the closing the month rows say (when rows were given) */
    var totals = entryTotals_(context.moves),
      found = balanceMismatches_(context, pos, totals),
      tieHolds = null;
    if (pos.close) {
      var accountsTie = accountTie_(pos, found),
        partiesTie = partyTie_(pos, found);
      tieHolds = accountsTie && partiesTie;
    }
    var manifest = manifestOf_(context, pos, files, hash, found, tieHolds, Object.keys(totals).length, saftObject.AuditFile.MasterFiles.GeneralLedgerAccounts.Account.length);
    if (!hash) manifest.unhashed = true;
    else manifest.sha256 = String(hash(canonical(Object.assign({}, manifest, { sha256: null }))));
    files.push({ name: 'manifest.json', content: JSON.stringify(manifest, null, 1) + '\n', rows: 1 });
    files[files.length - 1].bytes = bytes(files[files.length - 1].content);
    return { files: files, manifest: manifest };
  }

  /** ⭐ seal(manifest, fileHashes, hash) → the manifest with each file's sha256 and its own — for a caller that hashed outside */
  function seal(manifest, fileHashes, hash) {
    if (typeof hash !== 'function') throw refuse_('seal needs the hash function.');
    var parsed = JSON.parse(JSON.stringify(manifest || {}));
    (parsed.files || []).forEach(function (item) {
      if (!own_(fileHashes || {}, item.file)) throw refuse_('No hash for ' + item.file + '.');
      item.sha256 = String(fileHashes[item.file]);
    });
    delete parsed.unhashed;
    parsed.sha256 = null;
    parsed.sha256 = String(hash(canonical(parsed)));
    return parsed;
  }

  /**
   * ⭐ verify(files, manifest, hash) → { ok, mismatches[] } — every file's hash and size as the manifest says, and the
   * manifest's own hash. ⭐ verifyChain(manifests) → { ok, breaks[] } — each pack names the one before it (prev_sha256).
   */
  function verify(files, manifest, hash) {
    if (typeof hash !== 'function') throw refuse_('verify needs the hash function.');
    /* L9: no manifest is a failed check, said by name — not a TypeError */
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.files))
      return { ok: false, mismatches: [{ file: 'manifest.json', why: 'missing' }] };
    var found = [],
      byName = Object.create(null),
      listed = Object.create(null);
    (files || []).forEach(function (item) {
      if (item) byName[item.name] = item;
    });
    manifest.files.forEach(function (item) {
      listed[item.file] = 1;
      var present = byName[item.file];
      if (!present) {
        found.push({ file: item.file, why: 'missing' });
        return;
      }
      if (bytes(present.content) !== item.bytes) found.push({ file: item.file, why: 'size' });
      if (String(hash(present.content)) !== item.sha256) found.push({ file: item.file, why: 'hash' });
    });
    /* M9: a pack is THESE files and no others — a file the manifest does not list is named (manifest.json is the manifest itself) */
    Object.keys(byName)
      .sort()
      .forEach(function (item) {
        if (!listed[item] && item !== 'manifest.json') found.push({ file: item, why: 'unlisted' });
      });
    var ownHash = String(hash(canonical(Object.assign({}, manifest, { sha256: null }))));
    if (ownHash !== manifest.sha256) found.push({ file: 'manifest.json', why: 'hash' });
    return { ok: found.length === 0, mismatches: found };
  }
  /** ⭐ verifyChain(manifests) → { ok, breaks[] }: each pack must name the sha256 of the one before it */
  function verifyChain(manifests) {
    var breaks = [];
    (manifests || []).forEach(function (item, index) {
      if (index === 0) return;
      if ((item && item.prev_sha256) !== (manifests[index - 1] && manifests[index - 1].sha256))
        breaks.push({
          at: index,
          pack: item && item.fiscal_year + '/' + (item.period || item.pack_kind),
          want: manifests[index - 1] && manifests[index - 1].sha256,
          got: item && item.prev_sha256
        });
    });
    return { ok: breaks.length === 0, breaks: breaks };
  }

  const EXPORTS = {
    dec: decimalText,
    csv: csvText,
    bytes,
    canonical,
    codeBook,
    saft,
    tallyXml,
    tables,
    build,
    seal,
    verify,
    verifyChain
  };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page, the TV and the shop PC take window.CBBookPack. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBBookPack = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
