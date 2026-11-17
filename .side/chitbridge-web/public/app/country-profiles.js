/* OWNS  the Country lab's "Countries" view: every registered country on the left, everything its engine says on the right —
         money · tax · tax ID (with a live check) · bills & documents · filing · government rules · language & time · payments · connectors · open items.
   READS the adopted engines only: CBRegulation (the packs), CBCountries (the registry: taxId · returnInfo · meta · contractGaps), Intl. It types no
         country's fact: a value the pack does not carry is painted as "not in the pack", never filled in.
   CALLED BY country-lab.html (#/countries, the default view).
   FLOW  mount → paint (the list · the picked country's nine cards) → a pick repaints · the tax-ID box runs the pack's own check
   CARD  15-tax-and-country-packs/country-lab · RUNBOOK-ADD-A-COUNTRY Q11 (Athi, 2026-10-16: "left side panel, country name and right side all the
         attributes, documents, filling, govt norms") */
(function (root) {
  'use strict';
  var RUNBOOK = 'C:/dev/docs/15-tax-and-country-packs/RUNBOOK-ADD-A-COUNTRY.md';
  var STATE = { host: null, code: null, samples: null, period: {} };

  /** text made safe for HTML — the shared helper when the page has it */
  function safe(value) {
    return typeof root.esc === 'function'
      ? root.esc(value)
      : String(value == null ? '' : value).replace(/[&<>"']/g, function (symbol) {
          return '&#' + symbol.charCodeAt(0) + ';';
        });
  }
  /** a failure this view survives, logged through the page's cbQuiet */
  function quiet(where, failure) {
    if (root.cbQuiet) root.cbQuiet('country-profiles:' + where, failure);
  }
  /** every registered pack, in the registry's order */
  function allPacks() {
    try {
      return root.CBRegulation ? CBRegulation.list() : [];
    } catch (failure) {
      quiet('list', failure);
      return [];
    }
  }
  /** the pack for a country code, or null */
  function packOf(code) {
    try {
      return root.CBRegulation ? CBRegulation.packFor(code) : null;
    } catch (failure) {
      quiet('pack', failure);
      return null;
    }
  }
  /** the flag from the two letters (regional-indicator symbols) */
  function flagOf(code) {
    return String(code)
      .toUpperCase()
      .replace(/[A-Z]/g, function (letter) {
        return String.fromCodePoint(127397 + letter.charCodeAt(0));
      });
  }
  /** a country, currency or language code in words (Intl) */
  function nameOf(kind, code) {
    try {
      return new Intl.DisplayNames(['en'], { type: kind }).of(code) || code;
    } catch (failure) {
      quiet('name', failure);
      return code;
    }
  }
  /** the pack's own number and date format (BCP-47) */
  function formatTag(pack) {
    return (pack.locale && pack.locale.format) || 'en';
  }
  /** how many decimals the currency has (Intl decides; ¥ has none) */
  function decimalsOf(currency) {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: currency }).resolvedOptions().maximumFractionDigits;
    } catch (failure) {
      quiet('decimals', failure);
      return 2;
    }
  }
  /** an amount in the country's own currency and format */
  function inCountryMoney(pack, amount) {
    try {
      return new Intl.NumberFormat(formatTag(pack), { style: 'currency', currency: pack.currency }).format(amount);
    } catch (failure) {
      quiet('money', failure);
      return pack.currency + ' ' + amount;
    }
  }
  /** an amount held in minor units, in the country's format; null when there is none */
  function minorMoney(pack, minor) {
    return minor == null ? null : inCountryMoney(pack, Number(minor) / Math.pow(10, decimalsOf(pack.currency)));
  }
  /** what a card says where the pack carries nothing */
  function notInPack() {
    return '<span class="chip warn">not in the pack</span>';
  }
  /** one label · value line, the source behind ⓘ */
  function rowHTML(label, value, cite) {
    return (
      '<div class="kv"><span>' +
      safe(label) +
      (cite ? ' <button data-cbsid="CLB001-B06" class="btn x cp-i" type="button" title="' + safe(cite) + '" aria-label="' + safe(cite) + '">ⓘ</button>' : '') +
      '</span><span>' +
      (value == null || value === '' ? notInPack() : value) +
      '</span></div>'
    );
  }
  /** a titled card */
  function cardHTML(title, body, testid) {
    return '<section class="card cp-card" data-testid="cp-' + testid + '"><div class="sec">' + safe(title) + '</div>' + body + '</section>';
  }
  /** words as chips; null when there are none */
  function chips(items) {
    return items && items.length
      ? items
          .map(function (item) {
            return '<span class="chip">' + safe(item) + '</span>';
          })
          .join(' ')
      : null;
  }

  /** ✓ when a local accountant has read the pack, ⚠ until then */
  function readMark(pack) {
    return pack.verified
      ? '<span class="chip ok" title="Read by a local accountant">✓</span>'
      : '<span class="chip warn" title="Not yet read by a local accountant">⚠</span>';
  }
  /** one country's button in the left panel */
  function pickButton(pack) {
    var on = pack.id === STATE.code;
    return (
      '<button data-cbsid="CLB001-B07" type="button" class="cp-pick' +
      (on ? ' on' : '') +
      '" data-cc="' +
      safe(pack.id) +
      '" data-testid="cp-pick-' +
      safe(pack.id) +
      '" aria-pressed="' +
      on +
      '">' +
      '<span class="cp-flag" aria-hidden="true">' +
      flagOf(pack.id) +
      '</span><span class="cp-name">' +
      safe(nameOf('region', pack.id)) +
      '</span>' +
      '<span class="cp-cur">' +
      safe(pack.currency) +
      '</span>' +
      readMark(pack) +
      '</button>'
    );
  }
  /** the left panel: one button per country (a picker on a phone) */
  function sideHTML(packs) {
    var buttons = packs.map(pickButton).join('');
    var picker =
      '<select data-cbsid="CLB001-S05" class="cp-select" data-testid="cp-select" aria-label="Country">' +
      packs
        .map(function (pack) {
          return (
            '<option value="' +
            safe(pack.id) +
            '"' +
            (pack.id === STATE.code ? ' selected' : '') +
            '>' +
            flagOf(pack.id) +
            ' ' +
            safe(nameOf('region', pack.id)) +
            '</option>'
          );
        })
        .join('') +
      '</select>';
    return '<div class="sec">Countries · ' + packs.length + '</div>' + picker + '<div class="cp-list">' + buttons + '</div>';
  }

  /** money: the currency, its decimals, how an amount looks, the invoice rounding */
  function moneyCard(pack) {
    var taxRules = pack.tax || {};
    return cardHTML(
      'Money',
      rowHTML('Currency', safe(pack.currency) + ' · ' + safe(nameOf('currency', pack.currency))) +
        rowHTML('Decimals', String(decimalsOf(pack.currency))) +
        rowHTML('Looks like', '<b>' + safe(inCountryMoney(pack, 1234567.891)) + '</b>') +
        rowHTML('Invoice rounds to', taxRules.invoice_round_to != null ? safe(inCountryMoney(pack, taxRules.invoice_round_to)) : null),
      'money'
    );
  }
  /** does the pack credit input tax? asked of its own setOff with 100 out and 150 in */
  function creditOf(pack) {
    var head = (pack.taxHeads || [])[0];
    if (!head || typeof pack.setOff !== 'function') return null;
    try {
      var output = {},
        input = {};
      output[head] = 100;
      input[head] = 150;
      var answer = pack.setOff({ output: output, input: input }, function (amount) {
        return Number(amount || 0);
      });
      return answer.utilised && answer.utilised.length ? 'Input tax is credited' : 'No input credit (single-stage)';
    } catch (failure) {
      quiet('setOff', failure);
      return null;
    }
  }
  /** the supply kinds as a small table: name · rate · input credit */
  function kindsTable(pack) {
    var kinds = (pack.tax && pack.tax.supplyKinds) || {},
      names = Object.keys(kinds);
    if (!names.length) return '';
    return (
      '<table class="grid cp-kinds"><thead><tr><th>Supply</th><th class="r">Rate</th><th>Input credit</th></tr></thead><tbody>' +
      names
        .map(function (name) {
          var kind = kinds[name];
          return (
            '<tr title="' +
            safe(kind.why || '') +
            '"><td>' +
            safe(kind.name || name) +
            '</td><td class="r">' +
            (kind.rate == null ? 'your rate' : safe(kind.rate) + '%') +
            '</td><td>' +
            (kind.credit ? '✓' : '—') +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>'
    );
  }
  /** the standard rate, or how many state rates a country without one carries; null when neither */
  function standardRateText(taxRules) {
    if (taxRules.standard_rate != null) return safe(taxRules.standard_rate + '%');
    return taxRules.stateRates ? safe(Object.keys(taxRules.stateRates).length + ' state rates') : null;
  }
  /** one rate country-wide, or split by state; null when the pack does not say */
  function oneRateText(taxRules) {
    return taxRules.stateRates ? 'No — set by each state' : { state: 'No — split by state', border: 'Yes' }[taxRules.supply] || null;
  }
  /** tax: name, rates, one rate or by state, input credit, the registration threshold, the supply kinds */
  function taxCard(pack) {
    var taxRules = pack.tax || {},
      registration = taxRules.registration || {},
      credit = creditOf(pack);
    var rates = (taxRules.rates || []).map(function (rate) {
      return rate + '%';
    });
    return cardHTML(
      'Tax',
      rowHTML('Name', safe((pack.words && pack.words.taxName) || taxRules.scheme)) +
        rowHTML('Rates', chips(rates)) +
        rowHTML('Standard rate', standardRateText(taxRules)) +
        rowHTML('One rate country-wide', oneRateText(taxRules)) +
        rowHTML('Input tax', credit ? safe(credit) : null) +
        rowHTML('Must register above', registration.mandatory_minor != null ? safe(minorMoney(pack, registration.mandatory_minor)) : null, registration.cite) +
        kindsTable(pack),
      'tax'
    );
  }
  /** the tax ID: its word, an example, and a box that runs the pack's own check */
  function taxIdCard(pack) {
    var taxId = root.CBCountries ? CBCountries.taxId(pack) : { word: null };
    return cardHTML(
      'Tax ID',
      rowHTML('Called', taxId.word ? '<b>' + safe(taxId.word) + '</b>' : null) +
        rowHTML('Looks like', taxId.hint ? '<span class="mono">' + safe(taxId.hint) + '</span>' : null) +
        '<div class="idck"><input data-cbsid="CLB001-I09" class="cp-idbox" data-testid="cp-idbox" aria-label="Try a number" placeholder="' +
        safe(taxId.hint || '') +
        '"><span class="cp-idverdict" data-testid="cp-idverdict" role="status">' +
        (taxId.check ? '' : '<span class="chip warn">checked on save</span>') +
        '</span></div>',
      'taxid'
    );
  }
  /** the bill-number scheme the pack suggests (an option of docnumber), in words; null when it suggests none */
  function numberingText(numbering) {
    var scheme = numbering && numbering.default;
    if (!scheme) return null;
    return safe((scheme.dating || '') + (scheme.resets ? ' · resets ' + scheme.resets : ''));
  }
  /** the voucher series as "Sales SV" words */
  function seriesOf(pack) {
    var all = pack.voucherSeries || {};
    return Object.keys(all).map(function (name) {
      return name + ' ' + all[name];
    });
  }
  /** bills & documents: what a tax invoice must show, the simplified limit, bill numbers, voucher series */
  function documentsCard(pack) {
    var extras = root.CBCountries ? CBCountries.meta(pack) : {},
      invoice = extras.invoice || {},
      invoiceRule = (pack.tax && pack.tax.taxInvoice) || {};
    var lines = (invoice.requiredLines || []).map(function (line) {
      return line.replace(/_/g, ' ');
    });
    return cardHTML(
      'Bills & documents',
      rowHTML('A tax invoice must show', chips(lines), invoice.cite) +
        rowHTML(
          'Simplified invoice up to',
          invoiceRule.simplified_upto_minor != null ? safe(minorMoney(pack, invoiceRule.simplified_upto_minor)) : null,
          invoiceRule.cite
        ) +
        rowHTML('Bill numbers', numberingText(extras.numbering)) +
        rowHTML('Voucher series', chips(seriesOf(pack))),
      'documents'
    );
  }
  /** this year's return periods from the pack's own calendar (a stagger the authority assigns: the first is shown) */
  function periodsOf(pack) {
    var form = pack.returns;
    if (!form || typeof form.periods !== 'function') return null;
    var year = new Date().getFullYear(),
      stagger = form.staggers ? Object.keys(form.staggers)[0] : undefined;
    try {
      return form.periods({ year: year, fy: year, frequency: (form.frequencies || [])[0], stagger: stagger }) || [];
    } catch (failure) {
      quiet('periods', failure);
      return null;
    }
  }
  /** this year's periods and their due dates as a table ('' when the pack names none) */
  function periodsTable(pack) {
    var periods = periodsOf(pack);
    if (!periods || !periods.length) return '';
    var staggerNote = pack.returns.staggers ? ' (stagger ' + Object.keys(pack.returns.staggers)[0] + ' shown)' : '';
    return (
      '<table class="grid cp-periods"><thead><tr><th>Period' +
      safe(staggerNote) +
      '</th><th>Due</th></tr></thead><tbody>' +
      periods
        .slice(0, 6)
        .map(function (period) {
          return '<tr><td>' + safe(period.label || period.period) + '</td><td>' + safe(period.due || '') + '</td></tr>';
        })
        .join('') +
      '</tbody></table>'
    );
  }
  /** filing: the return, who it is filed with, how often, and this year's periods with their due dates */
  function filingCard(pack) {
    var info = root.CBCountries ? CBCountries.returnInfo(pack) : null;
    if (!info) return cardHTML('Filing', rowHTML('Return', null), 'filing');
    return cardHTML(
      'Filing',
      rowHTML('Return', '<b>' + safe(info.name) + '</b>') +
        rowHTML('Filed with', safe([info.authority, info.portal].filter(Boolean).join(' · '))) +
        rowHTML('How often', chips(info.frequencies)) +
        rowHTML('Built from the books', info.builds ? '✓' : null) +
        periodsTable(pack),
      'filing'
    );
  }
  /** government rules: the year, record keeping, the statement basis, whether a local accountant has read the pack, its sources */
  function rulesCard(pack) {
    var fiscal = pack.fiscalYear || {},
      records = pack.records || {};
    return cardHTML(
      'Government rules',
      rowHTML('Year starts', fiscal.startMonth ? safe(root.monthNames('long')[fiscal.startMonth - 1]) : null) +
        rowHTML('Keep records', pack.retentionYears ? safe(pack.retentionYears + ' years') : null, records.cite) +
        rowHTML('Statements follow', safe(pack.basis || '')) +
        rowHTML('Pack version', safe(pack.version)) +
        rowHTML('Read by a local accountant', pack.verified ? '✓' : '<span class="chip warn">not yet</span>') +
        rowHTML('Sources', pack.tax && pack.tax.source ? '<span class="hint">' + safe(pack.tax.source) + '</span>' : null),
      'rules'
    );
  }
  /** language & time: the format, today in it, the languages, the time zones */
  function localeCard(pack) {
    var tag = formatTag(pack),
      langs = (pack.locale && pack.locale.langs) || [],
      today = '';
    try {
      today = new Date().toLocaleDateString(tag, { year: 'numeric', month: 'long', day: 'numeric' }) + ' · ' + new Date().toLocaleDateString(tag);
    } catch (failure) {
      quiet('today', failure);
      today = '';
    }
    return cardHTML(
      'Language & time',
      rowHTML('Format', safe(tag)) +
        rowHTML('Today', today ? safe(today) : null) +
        rowHTML(
          'Languages',
          chips(
            langs.map(function (lang) {
              return nameOf('language', lang);
            })
          )
        ) +
        rowHTML('Time zones', chips(pack.timeZones || [])),
      'locale'
    );
  }
  /** payments & connectors: the ways to pay, the accounting systems common there */
  function paymentsCard(pack) {
    var extras = root.CBCountries ? CBCountries.meta(pack) : {};
    var ways = extras.payments || (pack.chart && pack.chart.paymentModes ? Object.keys(pack.chart.paymentModes) : []);
    var systems = (extras.connectors || []).map(function (system) {
      return system.name + (system.fits === 'none' ? ' · not built' : '');
    });
    return cardHTML('Payments & connectors', rowHTML('Ways to pay', chips(ways)) + rowHTML('Accounting systems', chips(systems)), 'payments');
  }
  /** a scope list ({ member: why }) as bullet lines */
  function scopeList(entries) {
    return Object.keys(entries || {})
      .map(function (member) {
        return '<li><b>' + safe(member) + '</b> — ' + safe(entries[member]) + '</li>';
      })
      .join('');
  }
  /** open items: what the registry cannot answer yet, what the pack leaves out or only partly does, and the runbook */
  function gapsCard(pack) {
    var gaps = root.CBCountries ? CBCountries.contractGaps(pack) : [],
      scope = pack.scope || {};
    var leftOut = scopeList(scope.out),
      partly = scopeList(scope.partial);
    return cardHTML(
      'Open items',
      rowHTML('Not answered yet', gaps.length ? chips(gaps) : '<span class="chip ok">none</span>') +
        (leftOut ? '<div class="hint">Left out</div><ul class="cp-ul">' + leftOut + '</ul>' : '') +
        (partly ? '<div class="hint">Partly done</div><ul class="cp-ul">' + partly + '</ul>' : '') +
        '<div class="hint" data-testid="cp-runbook">How a country is added: ' +
        safe(RUNBOOK) +
        '</div>',
      'gaps'
    );
  }
  /* ── the Books card (A5): a sample shop's year — the filled return for each period, the statements in the country's own lines, the prerequisites,
        and downloads. Painted from /data/country-books-samples.json, which engines tools/country-samples.cjs writes from the real engines. ── */
  /** the sample year of one country, or null until the file is read */
  function sampleOf(code) {
    var all = STATE.samples && STATE.samples.countries;
    return all
      ? all.filter(function (country) {
          return country.id === code;
        })[0] || null
      : null;
  }
  /** an amount held in minor units, in the sample's own currency and the pack's format */
  function sampleMoney(pack, sample, minor) {
    return minor == null ? '—' : inCountryMoney(pack, Number(minor) / Math.pow(10, sample.decimals));
  }
  /** the picked period's return as a table: box · label · amount · tax */
  function returnHTML(pack, sample) {
    var periods = sample.returns.periods;
    if (!periods.length) return rowHTML('Return', sample.returns.note ? safe(sample.returns.note) : null);
    var pick = STATE.period[sample.id] || periods[0].period,
      chosen =
        periods.filter(function (x) {
          return x.period === pick;
        })[0] || periods[0];
    var picker =
      '<select data-cbsid="CLB001-S06" class="cp-periodpick" data-testid="cp-periodpick" aria-label="Period">' +
      periods
        .map(function (x) {
          return '<option value="' + safe(x.period) + '"' + (x.period === chosen.period ? ' selected' : '') + '>' + safe(x.label) + '</option>';
        })
        .join('') +
      '</select>';
    var boxes =
      '<table class="grid cp-boxes" data-testid="cp-boxes"><thead><tr><th>Box</th><th>Label</th><th class="r">Amount</th><th class="r">Tax</th></tr></thead><tbody>' +
      (chosen.boxes || [])
        .map(function (box) {
          return (
            '<tr><td>' +
            safe(box.code) +
            '</td><td>' +
            safe(box.label) +
            '</td><td class="r">' +
            safe(sampleMoney(pack, sample, box.amount_minor)) +
            '</td><td class="r">' +
            safe(sampleMoney(pack, sample, box.tax_minor)) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
    var settle = chosen.refund_minor ? 'Refund ' + sampleMoney(pack, sample, chosen.refund_minor) : 'Pay ' + sampleMoney(pack, sample, chosen.payable_minor);
    return (
      rowHTML('Return', '<b>' + safe(chosen.name || '') + '</b>') +
      rowHTML('Period', picker) +
      rowHTML('Due', '<b>' + safe(chosen.due) + '</b>') +
      rowHTML('File with', safe([chosen.authority, chosen.portal].filter(Boolean).join(' · '))) +
      boxes +
      rowHTML('Result', '<b>' + safe(settle) + '</b>')
    );
  }
  /** a statement's lines as a table, its total under it */
  function statementHTML(title, groups, totalLabel, totalMinor, pack, sample) {
    return (
      '<div class="hint cp-stmt-title">' +
      safe(title) +
      '</div><table class="grid cp-stmt"><tbody>' +
      groups
        .map(function (line) {
          return '<tr><td>' + safe(line.label || line.line || '—') + '</td><td class="r">' + safe(sampleMoney(pack, sample, line.amount_minor)) + '</td></tr>';
        })
        .join('') +
      '<tr class="cp-total"><td>' +
      safe(totalLabel) +
      '</td><td class="r">' +
      safe(sampleMoney(pack, sample, totalMinor)) +
      '</td></tr></tbody></table>'
    );
  }
  /** the Books card */
  function booksCard(pack) {
    var sample = sampleOf(pack.id);
    if (!STATE.samples) return cardHTML('Books — a sample year', '<span class="hint">Reading the sample…</span>', 'books');
    if (!sample) return cardHTML('Books — a sample year', rowHTML('Sample', null), 'books');
    var statements = sample.statements,
      sheet = statements.balance_sheet,
      profitLoss = statements.profit_and_loss;
    var prereq =
      '<ul class="cp-ul cp-prereq" data-testid="cp-prereq">' +
      (STATE.samples.prerequisites || [])
        .map(function (line) {
          return '<li>' + safe(line) + '</li>';
        })
        .join('') +
      '</ul>';
    var downloads =
      '<div class="idck"><button data-cbsid="CLB001-B08" class="btn" type="button" data-dl="return" data-testid="cp-dl-return">⬇ Return (CSV)</button><button data-cbsid="CLB001-B09" class="btn" type="button" data-dl="statements" data-testid="cp-dl-statements">⬇ Statements (CSV)</button><button data-cbsid="CLB001-B10" class="btn" type="button" data-dl="print" data-testid="cp-dl-print">⎙ Print / PDF</button></div>';
    return cardHTML(
      'Books — a sample year',
      '<div class="hint">A simulated shop, ' +
        safe(sample.from) +
        ' → ' +
        safe(sample.to) +
        " — never a real shop's figures</div>" +
        returnHTML(pack, sample) +
        statementHTML(
          'Balance sheet at ' + sheet.as_of + ' · ' + (statements.basis || ''),
          sheet.assets.concat(sheet.equity_and_liabilities),
          'Total assets = equity + liabilities',
          sheet.total_assets_minor,
          pack,
          sample
        ) +
        statementHTML(
          'Profit and loss ' + profitLoss.from + ' → ' + profitLoss.to,
          profitLoss.income.concat(
            profitLoss.expenses.map(function (line) {
              return { label: line.label, line: line.line, amount_minor: -line.amount_minor };
            })
          ),
          'Profit',
          profitLoss.profit_minor,
          pack,
          sample
        ) +
        '<div class="hint">Before you download</div>' +
        prereq +
        downloads,
      'books'
    );
  }
  /** a CSV of rows (each an array), quoted where needed */
  function csvOf(rows) {
    return rows
      .map(function (row) {
        return row
          .map(function (nestedCellValue) {
            var text = String(nestedCellValue == null ? '' : nestedCellValue);
            return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
          })
          .join(',');
      })
      .join('\n');
  }
  /** hand the person a file */
  function saveFile(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' }),
      link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 500);
  }
  /** a download button pressed: the return, the statements, or the print view */
  function download(kind) {
    var pack = packOf(STATE.code),
      sample = sampleOf(STATE.code);
    if (!pack || !sample) return;
    var minorText = function (minor) {
      return minor == null ? '' : (Number(minor) / Math.pow(10, sample.decimals)).toFixed(sample.decimals);
    };
    if (kind === 'print') {
      window.print();
      return;
    }
    if (kind === 'return') {
      var periods = sample.returns.periods;
      if (!periods.length) return;
      var pick = STATE.period[sample.id] || periods[0].period,
        chosen =
          periods.filter(function (x) {
            return x.period === pick;
          })[0] || periods[0];
      saveFile(
        'sample-' + sample.id + '-' + String(chosen.form || 'return').toLowerCase() + '-' + chosen.period.replace(/\//g, '_') + '.csv',
        csvOf(
          [
            ['Return', chosen.name],
            ['Period', chosen.label],
            ['Due', chosen.due],
            ['File with', [chosen.authority, chosen.portal].filter(Boolean).join(' · ')],
            ['Currency', sample.currency],
            [],
            ['Box', 'Label', 'Amount', 'Tax']
          ].concat(
            chosen.boxes.map(function (box) {
              return [box.code, box.label, minorText(box.amount_minor), minorText(box.tax_minor)];
            })
          )
        )
      );
      return;
    }
    var statements = sample.statements,
      rows = [['Statement', 'Line', 'Amount (' + sample.currency + ')']];
    statements.balance_sheet.assets.concat(statements.balance_sheet.equity_and_liabilities).forEach(function (line) {
      rows.push(['Balance sheet ' + statements.balance_sheet.as_of, line.label, minorText(line.amount_minor)]);
    });
    statements.profit_and_loss.income.forEach(function (line) {
      rows.push(['Profit and loss', line.label, minorText(line.amount_minor)]);
    });
    statements.profit_and_loss.expenses.forEach(function (line) {
      rows.push(['Profit and loss', line.label, minorText(-line.amount_minor)]);
    });
    rows.push(['Profit and loss', 'Profit', minorText(statements.profit_and_loss.profit_minor)]);
    saveFile('sample-' + sample.id + '-statements-' + sample.fiscal_year + '.csv', csvOf(rows));
  }
  /** read the samples once, then repaint */
  function loadSamples() {
    if (STATE.samples || !root.fetch) return;
    fetch('/data/country-books-samples.json')
      .then(function (reply) {
        return reply.ok ? reply.json() : null;
      })
      .then(
        function (data) {
          STATE.samples = data || { countries: [], prerequisites: [] };
          paint();
        },
        function (failure) {
          quiet('samples', failure);
          STATE.samples = { countries: [], prerequisites: [] };
          paint();
        }
      );
  }
  /** the right side: the country's head and its cards */
  function detailHTML(pack) {
    if (!pack) return '<div class="card nopack" data-testid="cp-none">No country pack loaded</div>';
    return (
      '<div class="cp-head" data-testid="cp-head"><span class="cp-bigflag" aria-hidden="true">' +
      flagOf(pack.id) +
      '</span><div><h2>' +
      safe(nameOf('region', pack.id)) +
      '</h2><div class="hint">' +
      safe(pack.name) +
      ' · ' +
      safe(pack.id) +
      '</div></div></div>' +
      '<div class="cp-grid">' +
      [
        booksCard(pack),
        moneyCard(pack),
        taxCard(pack),
        taxIdCard(pack),
        documentsCard(pack),
        filingCard(pack),
        rulesCard(pack),
        localeCard(pack),
        paymentsCard(pack),
        gapsCard(pack)
      ].join('') +
      '</div>'
    );
  }

  /** draw the whole view */
  function paint() {
    var host = STATE.host;
    if (!host) return;
    var packs = allPacks();
    if (!STATE.code && packs.length) STATE.code = packs[0].id;
    host.innerHTML =
      '<div class="cp"><aside class="cp-side" data-testid="cp-side">' +
      sideHTML(packs) +
      '</aside><div class="cp-main" data-testid="cp-main">' +
      detailHTML(packOf(STATE.code)) +
      '</div></div>';
  }
  /** a country was picked: draw it and keep it in the address */
  function choose(code) {
    STATE.code = code;
    paint();
    try {
      history.replaceState(null, '', '#/countries/' + code);
    } catch (failure) {
      quiet('hash', failure);
    }
  }
  /** the tax-ID box changed: run the pack's own check and say the verdict */
  function checkId(box) {
    var verdict = STATE.host.querySelector('.cp-idverdict'),
      taxId = root.CBCountries ? CBCountries.taxId(STATE.code) : null;
    if (!verdict || !taxId || !taxId.check) return;
    var typed = box.value.trim();
    if (!typed) {
      verdict.innerHTML = '';
      return;
    }
    var answer = taxId.check(typed);
    verdict.innerHTML = answer.ok
      ? '<span class="chip ok">✓ ' + safe(answer.value || typed) + '</span>'
      : '<span class="chip bad">✕ ' + safe(answer.why || '') + '</span>';
  }
  /** mount the view in a host, optionally on one country */
  function mount(host, code) {
    STATE.host = host;
    STATE.code = code ? String(code).toUpperCase() : null;
    paint();
    loadSamples();
    host.addEventListener('click', function (event) {
      var button = event.target.closest('[data-cc]');
      if (button) choose(button.getAttribute('data-cc'));
    });
    host.addEventListener('change', function (event) {
      if (event.target.matches('.cp-select')) choose(event.target.value);
      if (event.target.matches('.cp-periodpick')) {
        STATE.period[STATE.code] = event.target.value;
        paint();
      }
    });
    host.addEventListener('click', function (event) {
      var button = event.target.closest('[data-dl]');
      if (button) download(button.getAttribute('data-dl'));
    });
    host.addEventListener('input', function (event) {
      if (event.target.matches('.cp-idbox')) checkId(event.target);
    });
  }
  /* ── "All countries": the accounting rules of every country in ONE table — CBCountries.rulesTable, the same function docs/ACCOUNTING-RULES.md is
        written from (Athi, 17 Oct: "in the country lab we have to present"). Rules down the side, countries across; on a phone, one country at a time. ── */
  var ALL = { host: null, code: null, shown: null };
  /** a cell's value — the chart's count opens the chart it counts (Athi, 17 Oct: "if it is a hyperlink, can we showcase what those groups are") */
  var OPENS = { chart: 'chart', return: 'return', filed: 'return', statements: 'statements', invoice: 'invoice', kinds: 'kinds', slip: 'receipt' };
  function cellValue(ruleKey, code, value) {
    var opens = OPENS[ruleKey];
    return opens
      ? '<button data-cbsid="CLB001-B11" class="cp-link" type="button" data-open="' +
          opens +
          '" data-cc="' +
          safe(code) +
          '" data-testid="cp-open-' +
          opens +
          '-' +
          safe(code) +
          '">' +
          safe(value) +
          '</button>'
      : safe(value);
  }
  /** a framed panel under the table: a title, a close, the body */
  function panelHTML(title, subtitle, body, testid) {
    return (
      '<div class="cp-chart" data-testid="' +
      testid +
      '"><div class="cp-head"><div><h2>' +
      safe(title) +
      '</h2><div class="hint">' +
      safe(subtitle || '') +
      '</div></div>' +
      '<button data-cbsid="CMP005" class="btn x" type="button" data-chart-close="1" style="margin-left:auto" aria-label="Close">✕</button></div>' +
      body +
      '</div>'
    );
  }
  /** the rate a sample line is billed at: the standard rate, else the first rate above nil */
  function sampleRate(taxRules) {
    return taxRules.standard_rate != null
      ? taxRules.standard_rate
      : (taxRules.rates || []).filter(function (rate) {
          return rate > 0;
        })[0] || 0;
  }
  /** the sample cart: two lines at the sample rate, and one of a nil-rated supply kind when the pack names one */
  function sampleLines(pack) {
    var taxRules = pack.tax || {},
      kinds = taxRules.supplyKinds || {},
      rate = sampleRate(taxRules);
    var lines = [
      { name: 'Item A', qty: 2, price: 120, rate: rate },
      { name: 'Item B', qty: 1, price: 45, rate: rate }
    ];
    var nilKind = Object.keys(kinds).filter(function (kind) {
      return kind !== 'standard' && kinds[kind].rate === 0;
    })[0];
    if (nilKind) lines.push({ name: 'Item C (' + (kinds[nilKind].name || nilKind) + ')', qty: 1, price: 30, rate: 0, supply_kind: nilKind });
    return lines;
  }
  /** bill the sample cart with the real tax engine, seller and buyer in the pack's country (a state-split pack needs a state on both) */
  function billSample(pack, lines) {
    var party = pack.tax && pack.tax.supply === 'state' ? { Country: pack.id, State: '27', Pos: '27' } : { Country: pack.id };
    return CBTax.determine({
      seller: Object.assign({ LglNm: 'Sample shop', RegType: 'regular' }, party),
      buyer: Object.assign({ RegType: 'unregistered' }, party),
      placeOfSupply: party.State,
      lines: lines
    });
  }
  /** an invoice line as a row: item · qty · price · rate · tax · total */
  function invoiceRow(pack, item, line) {
    var priced = function (amount) {
      return safe(inCountryMoney(pack, amount));
    };
    return (
      '<tr><td>' +
      safe(line.name) +
      '</td><td class="r">' +
      safe(item.Qty) +
      '</td><td class="r">' +
      priced(item.UnitPrice) +
      '</td><td class="r">' +
      safe(item.GstRt) +
      '%</td><td class="r">' +
      priced(item.TaxAmt + item.CgstAmt + item.SgstAmt + item.IgstAmt) +
      '</td><td class="r">' +
      priced(item.TotItemVal) +
      '</td></tr>'
    );
  }
  /** the invoice's tax, whatever its heads (one VAT/GST head, or CGST + SGST + IGST) */
  function taxOfTotals(totals) {
    return ['CgstVal', 'SgstVal', 'IgstVal', 'TaxVal'].reduce(function (sum, key) {
      return sum + (totals[key] || 0);
    }, 0);
  }
  /** the lines a tax invoice must show, in words */
  function requiredWords(pack) {
    var invoice = root.CBCountries ? CBCountries.meta(pack).invoice : null;
    return ((invoice && invoice.requiredLines) || []).map(function (line) {
      return line.replace(/_/g, ' ');
    });
  }
  /** a sample tax invoice, billed live by the real tax engine under the country's own pack (its currency, rates and kinds) */
  function invoiceHTML(pack, asReceipt) {
    if (!root.CBTax || !CBTax.determine) return '<span class="hint">Tax engine not loaded</span>';
    var lines = sampleLines(pack),
      invoice = billSample(pack, lines),
      totals = invoice.ValDtls || {};
    var taxTotal = taxOfTotals(totals),
      mustShow = requiredWords(pack),
      notes = (invoice._cb && invoice._cb.notes) || [];
    return (
      (asReceipt
        ? receiptHead(pack, mustShow)
        : '<div class="hint">' + safe(taxWord(pack)) + ' invoice · seller "Sample shop" · ' + safe(mustShow.join(' · ')) + '</div>') +
      '<table class="grid cp-boxes"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Rate</th><th class="r">Tax</th><th class="r">Total</th></tr></thead><tbody>' +
      (invoice.ItemList || [])
        .map(function (item, index) {
          return invoiceRow(pack, item, lines[index]);
        })
        .join('') +
      '<tr class="cp-total"><td colspan="4">Taxable ' +
      safe(inCountryMoney(pack, totals.AssVal)) +
      '</td><td class="r">' +
      safe(inCountryMoney(pack, taxTotal)) +
      '</td><td class="r"><b>' +
      safe(inCountryMoney(pack, totals.TotInvVal)) +
      '</b></td></tr></tbody></table>' +
      (notes.length
        ? '<ul class="cp-ul">' +
          notes
            .map(function (note) {
              return '<li class="hint">' + safe(note) + '</li>';
            })
            .join('') +
          '</ul>'
        : '') +
      (asReceipt ? receiptFoot(pack) : '')
    );
  }
  /** one rule's text for a country, as the All countries table holds it (the slip title, cash rounding, ways to pay, address words) */
  function ruleText(key, code) {
    var table = ALL.table || (root.CBCountries && CBCountries.rulesTable ? CBCountries.rulesTable({ year: new Date().getFullYear() }) : null);
    var rule =
      table &&
      (table.rules || []).filter(function (candidate) {
        return candidate.key === key;
      })[0];
    return rule && rule.values[code] != null ? String(rule.values[code]) : '';
  }
  /** a bill number as the country's numbering rule writes it (the one numbering engine, CBDoc.compose); the pack's scheme in words when the engine is not on the page */
  function sampleNumber(pack) {
    try {
      if (root.CBDoc && CBDoc.compose) return CBDoc.compose({ country: pack.id, prefix: 'S1', kind: 'sale', seq: 41, at: new Date() });
    } catch (failure) {
      quiet('docnumber', failure);
    }
    return numberingText(root.CBCountries ? CBCountries.meta(pack).numbering : null) || 'numbered by the pack';
  }
  /** the top of a sales receipt: shop, the lines the law requires, the pack's slip title, number and date (CTRY-44) */
  function receiptHead(pack, mustShow) {
    var taxId = root.CBCountries ? CBCountries.taxId(pack) : { word: null, hint: '' };
    /* the trade name is the bold line above; the tax id and the address say what the law asks for, in the pack's own words */
    var lawLines = mustShow
      .filter(function (line) {
        return line !== 'trade name';
      })
      .map(function (line) {
        return line === 'tax id' && taxId.word
          ? String(taxId.hint || '').indexOf(taxId.word) === 0
            ? taxId.hint
            : taxId.word + (taxId.hint ? ': ' + taxId.hint : '')
          : line === 'address'
            ? 'Address: ' + ruleText('address', pack.id)
            : line;
      });
    return (
      '<div class="cp-receipt" data-testid="cp-receipt-' +
      safe(pack.id) +
      '"><div class="cp-rc-head"><b>Sample shop</b>' +
      lawLines
        .map(function (line) {
          return '<div>' + safe(line) + '</div>';
        })
        .join('') +
      '<div class="cp-rc-title"><b>' +
      safe(ruleText('slip', pack.id) || taxWord(pack) + ' invoice') +
      '</b></div>' +
      '<div class="hint">No. ' +
      safe(sampleNumber(pack)) +
      ' · ' +
      safe(new Date().toISOString().slice(0, 10)) +
      '</div></div>'
    );
  }
  /** the foot of a sales receipt: how the total is rounded, the ways to pay, the shelf-price rule, a thank-you */
  function receiptFoot(pack) {
    var rows = [
      ['Cash rounds to', ruleText('cashround', pack.id)],
      ['Ways to pay', ruleText('pay', pack.id).replace(/→[a-z]+/g, '')],
      ['Shelf prices', ruleText('shelf', pack.id)]
    ].filter(function (row) {
      return row[1];
    });
    return (
      '<div class="cp-rc-foot">' +
      rows
        .map(function (row) {
          return '<div class="hint">' + safe(row[0]) + ' · ' + safe(row[1]) + '</div>';
        })
        .join('') +
      '<div class="cp-rc-thanks">Thank you</div></div></div>'
    );
  }
  /** the tax's own word (Consumption tax · GST · SST) */
  function taxWord(pack) {
    return (pack.words && pack.words.taxName) || (pack.tax && pack.tax.scheme) || 'Tax';
  }
  /** the sample statements as one panel: balance sheet, then profit and loss, in the pack's own lines */
  function statementsPanel(pack, sample, name) {
    var statements = sample.statements,
      sheet = statements.balance_sheet,
      profitLoss = statements.profit_and_loss;
    return panelHTML(
      name + ' · sample statements',
      statements.basis || '',
      statementHTML(
        'Balance sheet at ' + sheet.as_of,
        sheet.assets.concat(sheet.equity_and_liabilities),
        'Total assets = equity + liabilities',
        sheet.total_assets_minor,
        pack,
        sample
      ) +
        statementHTML(
          'Profit and loss',
          profitLoss.income.concat(
            profitLoss.expenses.map(function (line) {
              return { label: line.label, amount_minor: -line.amount_minor };
            })
          ),
          'Profit',
          profitLoss.profit_minor,
          pack,
          sample
        ),
      'cp-opened'
    );
  }
  /** what each kind of cell opens — the ones that need the sample year say so until it is read */
  var OPENERS = {
    chart: function (pack) {
      return chartHTML(pack.id);
    },
    kinds: function (pack, sample, name) {
      return panelHTML(
        name + ' · supply kinds',
        taxWord(pack),
        kindsTable(pack) || '<span class="hint">Slab rates (HSN) only</span>',
        'cp-opened'
      );
    },
    invoice: function (pack, sample, name) {
      return panelHTML(name + ' · a sample tax invoice', 'billed now by the tax engine under the ' + pack.name + ' pack', invoiceHTML(pack), 'cp-opened');
    },
    receipt: function (pack, sample, name) {
      return panelHTML(
        name + ' · a sample sales receipt',
        'billed now by the tax engine under the ' + pack.name + ' pack, laid out as a counter slip (the one invoice layout, framed as a receipt)',
        invoiceHTML(pack, true),
        'cp-opened'
      );
    },
    return: function (pack, sample, name) {
      return sample
        ? panelHTML(name + ' · a sample filled return', 'a simulated shop, ' + sample.from + ' → ' + sample.to, returnHTML(pack, sample), 'cp-opened')
        : panelHTML(name, 'reading the sample…', '', 'cp-opened');
    },
    statements: function (pack, sample, name) {
      return sample ? statementsPanel(pack, sample, name) : panelHTML(name, 'reading the sample…', '', 'cp-opened');
    }
  };
  /** what a cell opens, for one country */
  function openedHTML(kind, code) {
    var pack = packOf(code);
    if (!pack || !OPENERS[kind]) return '';
    return OPENERS[kind](pack, sampleOf(code), nameOf('region', code));
  }
  /** a group with its ledgers, as one list item */
  function groupItem(group, ledgers) {
    var inGroup = ledgers.filter(function (ledger) {
      return ledger.group === group.code;
    });
    return (
      '<li><b>' +
      safe(group.name || group.code) +
      '</b>' +
      (group.nature ? ' <span class="hint">' + safe(group.nature) + '</span>' : '') +
      (inGroup.length
        ? '<ul>' +
          inGroup
            .map(function (ledger) {
              return '<li><span class="mono">' + safe(ledger.code || '') + '</span> ' + safe(ledger.name || ledger.role) + '</li>';
            })
            .join('') +
          '</ul>'
        : '') +
      '</li>'
    );
  }
  /** the country's chart: every group with its ledgers, in the pack's order */
  function chartHTML(code) {
    var pack = packOf(code);
    if (!pack) return '';
    var groups = pack.groups || [],
      ledgers = pack.ledgers || [];
    return panelHTML(
      nameOf('region', code) + ' · chart of accounts',
      groups.length + ' groups · ' + ledgers.length + ' ledgers · ' + (pack.basis || ''),
      '<ul class="cp-tree">' +
        groups
          .map(function (group) {
            return groupItem(group, ledgers);
          })
          .join('') +
        '</ul>',
      'cp-chart'
    );
  }
  /** a value's items, when it is a list (", " · " · " · "; ") */
  function listItems(value) {
    return String(value)
      .split(/, | · |; /)
      .filter(Boolean);
  }
  /** a long list shows its first three and "+N more", which opens the whole list in an overlay (Athi, 2026-10-17: "if it is too many, open in a overlay box");
   *  a short list or a sentence shows whole — never cut */
  function listCell(ruleKey, code, value) {
    var items = listItems(value);
    if (items.length < 4 || String(value).length <= 90) return safe(value);
    return (
      safe(items.slice(0, 3).join(', ')) +
      ' <button data-cbsid="CLB001-B12" class="cp-link" type="button" data-more="' +
      safe(ruleKey) +
      '" data-cc="' +
      safe(code) +
      '" data-testid="cp-more-' +
      safe(ruleKey) +
      '-' +
      safe(code) +
      '">… contd</button>'
    );
  }
  /** THE overlay of the All countries view — a long list and every "opens what it counts" panel open here, over the table, so the table never
   *  moves (Athi, 2026-10-17: "instead of showing the details in the bottom, can we make it overlay, otherwise everything moves up").
   *  The native dialog: Esc, focus and the backdrop come with it; a press on the backdrop or a ✕ closes it. */
  function overlay(wide) {
    var box = ALL.host.querySelector('dialog.cp-more');
    if (!box) {
      box = document.createElement('dialog');
      box.className = 'cp-more';
      box.setAttribute('data-pop', 'POP149');
      box.setAttribute('data-testid', 'cp-more');
      ALL.host.appendChild(box);
      box.addEventListener('click', function (event) {
        if (event.target === box || event.target.closest('[data-more-close], [data-chart-close]')) box.close();
      });
    }
    box.classList.toggle('wide', !!wide);
    return box;
  }
  /** the overlay for one long cell: rule · country, every item on its own line */
  function openMore(ruleKey, code) {
    var rule = (ALL.table.rules || []).filter(function (candidate) {
      return candidate.key === ruleKey;
    })[0];
    if (!rule) return;
    var box = overlay(false),
      items = listItems(rule.values[code]);
    box.innerHTML =
      '<div class="cp-head"><div><h2>' +
      safe(rule.name) +
      ' · ' +
      safe(nameOf('region', code)) +
      '</h2><div class="hint">' +
      items.length +
      ' items</div></div>' +
      '<button data-cbsid="CMP005" class="btn x" type="button" data-more-close="1" style="margin-left:auto" aria-label="Close">✕</button></div>' +
      '<ol class="cp-morelist">' +
      items
        .map(function (item) {
          return '<li>' + safe(item) + '</li>';
        })
        .join('') +
      '</ol>';
    box.showModal();
  }
  /** the table: the rule names fixed on the left, a column per country (⚠ = not yet read by a local accountant) */
  function allTableHTML(table) {
    var head =
      '<tr><th class="cp-rule">Rule</th>' +
      table.countries
        .map(function (country) {
          return (
            '<th title="' +
            safe(country.name) +
            '">' +
            safe(country.id) +
            (country.verified ? '' : ' <span class="chip warn" title="Not yet read by a local accountant">⚠</span>') +
            '<span class="cp-cname">' +
            safe(nameOf('region', country.id)) +
            '</span></th>'
          );
        })
        .join('') +
      '</tr>';
    var body = table.rules
      .map(function (rule) {
        return (
          '<tr data-rule="' +
          safe(rule.key) +
          '"><th class="cp-rule" scope="row">' +
          safe(rule.name) +
          '</th>' +
          table.countries
            .map(function (country) {
              var value = rule.values[country.id];
              return (
                '<td>' +
                (value == null
                  ? '<span class="hint">—</span>'
                  : OPENS[rule.key]
                    ? cellValue(rule.key, country.id, value)
                    : listCell(rule.key, country.id, value)) +
                '</td>'
              );
            })
            .join('') +
          '</tr>'
        );
      })
      .join('');
    return '<table class="cp-all" data-testid="cp-all-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }
  /** one country as two columns (the phone): rule · value */
  function oneColumnHTML(table, code) {
    return (
      '<table class="cp-all cp-one" data-testid="cp-all-one"><tbody>' +
      table.rules
        .map(function (rule) {
          var value = rule.values[code];
          return (
            '<tr><th class="cp-rule" scope="row">' +
            safe(rule.name) +
            '</th><td>' +
            (value == null ? '<span class="hint">—</span>' : listCell(rule.key, code, value)) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>'
    );
  }
  /** which countries the table showcases: the ticked ones (CTRY-42a); remembered in this browser only, all of them until the reader chooses */
  function shownCodes(table) {
    var all = table.countries.map(function (country) {
      return country.id;
    });
    if (!ALL.shown) {
      try {
        ALL.shown = JSON.parse(root.localStorage.getItem('cb_cl_shown') || 'null');
      } catch (failure) {
        quiet('shown', failure);
      }
    }
    var kept = (ALL.shown || all).filter(function (code) {
      return all.indexOf(code) >= 0;
    });
    return kept.length ? kept : all;
  }
  /** a tick per country: choose which columns the table showcases */
  function showcaseHTML(table, shown) {
    return (
      '<fieldset class="cp-show" data-testid="cp-show"><legend>Showcase</legend>' +
      table.countries
        .map(function (country) {
          return (
            '<label class="cp-show-item"><input data-cbsid="CLB001-I10" type="checkbox" class="cp-show-box" data-show="' +
            safe(country.id) +
            '" data-testid="cp-show-' +
            safe(country.id) +
            '"' +
            (shown.indexOf(country.id) >= 0 ? ' checked' : '') +
            '> ' +
            flagOf(country.id) +
            ' ' +
            safe(country.id) +
            '</label>'
          );
        })
        .join('') +
      '<span class="hint cp-show-note" data-testid="cp-show-note" role="status"></span></fieldset>'
    );
  }
  /** draw the All countries view */
  function paintAll() {
    var host = ALL.host;
    if (!host) return;
    if (!root.CBCountries || typeof CBCountries.rulesTable !== 'function') {
      host.innerHTML = '<div class="card nopack" data-testid="cp-all-none">Needs engines v1.60.0</div>';
      return;
    }
    var table = CBCountries.rulesTable({ year: new Date().getFullYear() });
    ALL.table = table;
    if (!ALL.code && table.countries.length) ALL.code = table.countries[0].id;
    var shown = shownCodes(table);
    var picker =
      '<select data-cbsid="CLB001-S07" class="cp-select cp-all-pick" data-testid="cp-all-select" aria-label="Country">' +
      table.countries
        .map(function (country) {
          return (
            '<option value="' +
            safe(country.id) +
            '"' +
            (country.id === ALL.code ? ' selected' : '') +
            '>' +
            flagOf(country.id) +
            ' ' +
            safe(nameOf('region', country.id)) +
            '</option>'
          );
        })
        .join('') +
      '</select>';
    host.innerHTML =
      '<div class="cp-allwrap"><div class="cp-head"><div><h2>All countries · ' +
      table.countries.length +
      '</h2><div class="hint">' +
      table.rules.length +
      " accounting rules, read from each country's pack</div></div></div>" +
      picker +
      showcaseHTML(table, shown) +
      '<div class="cp-allscroll">' +
      allTableHTML(
        Object.assign({}, table, {
          countries: table.countries.filter(function (country) {
            return shown.indexOf(country.id) >= 0;
          })
        })
      ) +
      '</div>' +
      oneColumnHTML(table, ALL.code) +
      '</div>';
    /* every column edge drags to the reader's width, remembered (app/table-resize.js — the one resizer; the grip and its CSS come with it) */
    if (typeof root.tblResizable === 'function') root.tblResizable(host.querySelector('.cp-allscroll'));
  }
  /** a press in the All countries view: a long list or a counted cell opens in the overlay (✕, Esc or the backdrop closes it) */
  function onAllClick(event) {
    var more = event.target.closest('[data-more]');
    if (more) {
      openMore(more.getAttribute('data-more'), more.getAttribute('data-cc'));
      return;
    }
    var open = event.target.closest('[data-open]');
    if (!open || open.closest('dialog')) return;
    ALL.opened = [open.getAttribute('data-open'), open.getAttribute('data-cc')];
    var box = overlay(true);
    box.innerHTML = '<div class="cp-chartslot">' + openedHTML(ALL.opened[0], ALL.opened[1]) + '</div>';
    box.showModal();
  }
  /** mount the All countries view in a host */
  function mountAll(host) {
    ALL.host = host;
    paintAll();
    if (!STATE.samples) {
      STATE.host = STATE.host || null;
      loadSamples();
    } /* the return and statements panels read the samples file */
    host.addEventListener('change', function (event) {
      if (event.target.matches('.cp-show-box')) {
        var ticked = [].slice.call(host.querySelectorAll('.cp-show-box')).filter(function (box) {
          return box.checked;
        });
        if (!ticked.length) {
          event.target.checked = true;
          host.querySelector('.cp-show-note').textContent = 'Keep at least one country showing.';
          return;
        }
        ALL.shown = ticked.map(function (box) {
          return box.getAttribute('data-show');
        });
        try {
          root.localStorage.setItem('cb_cl_shown', JSON.stringify(ALL.shown));
        } catch (failure) {
          quiet('shown-save', failure);
        }
        paintAll();
        return;
      }
      if (event.target.matches('.cp-all-pick')) {
        ALL.code = event.target.value;
        paintAll();
      }
      if (event.target.matches('.cp-periodpick') && ALL.opened) {
        STATE.period[ALL.opened[1]] = event.target.value;
        host.querySelector('.cp-chartslot').innerHTML = openedHTML(ALL.opened[0], ALL.opened[1]);
      }
    });
    host.addEventListener('click', onAllClick);
  }
  root.CBCountryProfiles = { mount: mount, mountAll: mountAll };
})(typeof window !== 'undefined' ? window : this);
