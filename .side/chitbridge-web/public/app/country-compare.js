/**
 * OWNS  CTRY-49 · how the Country Lab's Side by side view compares ONE ROW of two countries: it splits the row into its PARTS (Currency = the money,
 *       its decimals, the bill's rounding, the line-tax rule), compares part by part and says what changed in one short line —
 *       "Changes: ₹ → A$ · same rule: 2 decimals" — or just "Same". The whole cell is never compared as one lump (Athi, 2026-10-23: the
 *       currency code alone made the row DIFFERENT while the rule parts were alike).
 * READS the facts the Lab already reads from the engine packs (CBRegulation packs, via its factsOf). It holds NO country fact of its own: no
 *       currency, decimals, month, tax word or id lives here, only the way a fact is split and worded. Money, symbol and month words come from
 *       the page's own readers (reader: money · symbol · month), which are CBLocale / CBMoney / helpers.monthNames.
 * CALLED BY public/country-lab.html (verdictOf, the row's popup).   TEST tests/country-compare.test.cjs
 * CARD 29-qa-test-tooling-ux-locale-and-design-system/country-lab
 * FLOW  facts(A), facts(B) → parts(key, facts) → line(key, A, B, reader) → {same, rows[], changed[], kept[], text}
 */
(function (root) {
  'use strict';
  var SHOWN = 2; /* at most this many changes / same-rules on the table line; the popup lists every part */
  var LEDGER_SHOWN = 4; /* the chart row says all four of its counts */
  var LONG = 28; /* a value longer than this is not worth reading in a table line: the line says "see details" and the popup has it */

  function plural(count, word) {
    return count + ' ' + (count === 1 ? word : /x$/.test(word) ? word + 'es' : word + 's');
  }
  /**
   * a part of a row. name = what it is called; value = what it reads as (null = the pack is silent); compare = what decides "same" (default the
   * value); flags: plain (the value reads alone, "₹ → A$"), brief (too long for the line: "see details"), alt (the wording when two values print alike).
   */
  function part(name, value, compare, flags) {
    var text = value == null ? null : String(value),
      out = { name: name, value: text, compare: compare != null ? String(compare) : text };
    if (flags) for (var flag in flags) out[flag] = flags[flag];
    return out;
  }
  function joined(list) {
    return (list || []).join(' · ');
  }
  function plain(name, value, compare) {
    return part(name, value, compare, { plain: true });
  }
  function brief(name, value, compare, flags) {
    return part(name, value, compare, Object.assign({ brief: true }, flags));
  }
  function kindNames(kinds) {
    return kinds.map(function (item) {
      return item.name.replace(/ supply$/i, '');
    });
  }
  function partsCurrency(facts, reader) {
    var money = facts.currency,
      isOwnUnit = money.round === Math.pow(10, -money.decimals); /* the currency's own smallest unit is its decimals, already said */
    return [
      part('money', reader.symbol(money.code), money.code, { alt: money.code, plain: true }),
      plain('decimals', plural(money.decimals, 'decimal')),
      part('bill rounds to', money.round != null && !isOwnUnit ? money.round : null),
      part('line tax', money.lineRound ? money.lineRound.replace(/_/g, ' ') : null)
    ];
  }
  function partsFy(facts, reader) {
    return [plain('starts', reader.month(facts.fy.startMonth)), part('written as', facts.fy.label === 'split' ? 'two years (2026-27)' : 'one year (2026)')];
  }
  function partsScheme(facts) {
    var scheme = facts.scheme;
    return [
      plain('scheme', scheme.scheme),
      part('tax heads by', scheme.supply === 'state' ? 'state' : 'the border'),
      part('heads', scheme.heads.join('+')),
      brief('rates', scheme.rates.length ? scheme.rates.join(' · ') + '%' : null),
      part('standard rate', scheme.standard != null ? scheme.standard + '%' : null)
    ];
  }
  function partsKinds(facts) {
    if (!facts.kinds.length) return [brief('kinds', "each item's own rate", null, { plain: true })];
    var credited = facts.kinds.filter(function (item) {
      return item.credit;
    });
    return [
      brief('kinds', joined(kindNames(facts.kinds)), null, { plain: true }),
      brief(
        'rates',
        joined(
          facts.kinds.map(function (item) {
            return item.rate + '%';
          })
        )
      ),
      brief('credit kept on', joined(kindNames(credited)) || null)
    ];
  }
  /** a threshold in minor units, worded in the country's own money; compared by code + amount, so two currencies never read alike */
  function amountPart(name, minor, code, reader) {
    return part(name, minor != null ? reader.money(minor, code) : null, minor != null ? code + minor : null);
  }
  function partsInvoice(facts, reader) {
    var invoice = facts.invoice,
      thresholds = invoice.thresholds || {},
      code = facts.currency.code,
      musts = invoice.must && invoice.must.length ? invoice.must : null,
      language = invoice.language ? (invoice.language.english_accepted ? 'English accepted' : 'as the pack says') : null;
    return [
      amountPart('tax invoice from', thresholds.from_minor, code, reader),
      amountPart('buyer identity from', thresholds.buyer_identity_from_minor, code, reader),
      amountPart('simplified up to', thresholds.simplified_upto_minor, code, reader),
      part('issued within', thresholds.within_days != null ? plural(thresholds.within_days, 'day') : null),
      amountPart('e-invoice above', invoice.einvoice ? invoice.einvoice.above_minor : null, code, reader),
      part('language', language),
      part('must carry', musts ? plural(musts.length, 'thing') : null, musts ? JSON.stringify(musts) : null)
    ];
  }
  function partsTaxid(facts) {
    return [plain('name', facts.taxid.name), brief('shape', facts.taxid.rule)];
  }
  function partsReturns(facts) {
    var form = facts.returns;
    if (!form) return [plain('return', null)];
    return [
      plain('return', form.id),
      part('filed', form.frequencies.join(' or ') || null),
      part('boxes', plural(Object.keys(form.labels).length, 'box'), JSON.stringify(form.labels))
    ];
  }
  function partsWords(facts) {
    var statements = facts.words;
    return [
      part('basis', statements.basis),
      part('statement lines', String(statements.lines)),
      part('labels', String(Object.keys(statements.labels).length), JSON.stringify(statements.labels)),
      part('tax on the balance sheet', statements.netting.length ? joined(statements.netting) : null)
    ];
  }
  function partsSetup(facts, reader) {
    var setup = facts.setup;
    return [
      part('country', setup.country),
      part('money', reader.symbol(setup.currency), setup.currency, { alt: setup.currency }),
      part('year from', reader.month(setup.fy)),
      part('tax number', setup.taxid),
      brief('registration', setup.threshold)
    ];
  }
  function partsKept(facts) {
    return facts.kept.list.map(function (item) {
      return part(item.kind, item.n + ' ' + item.unit);
    });
  }
  function partsPayheads(facts) {
    return [part('heads', joined(facts.payheads.heads) || null), part('only when used', joined(facts.payheads.optional) || null)];
  }
  function partsZones(facts) {
    return [plain('zones', facts.zones.words || joined(facts.zones.all) || null)];
  }
  function partsFormats(facts) {
    return [part('dates', facts.formats.dates), part('numbers', facts.formats.numbers), part('format', facts.formats.tag)];
  }
  function partsVoucher(facts) {
    return [part('shape', facts.voucher.format), part('series', joined(facts.voucher.series) || null)];
  }
  var MAKERS = {
    currency: partsCurrency,
    fy: partsFy,
    scheme: partsScheme,
    kinds: partsKinds,
    invoice: partsInvoice,
    taxid: partsTaxid,
    returns: partsReturns,
    words: partsWords,
    setup: partsSetup,
    retention: function (facts) {
      return [plain('keep for', facts.retention)];
    },
    kept: partsKept,
    payheads: partsPayheads,
    zones: partsZones,
    formats: partsFormats,
    voucher: partsVoucher
  };
  /** the parts of one row of one country; [] for an unknown row */
  function parts(key, facts, reader) {
    var make = MAKERS[key];
    return facts && make ? make(facts, reader) : [];
  }
  /** pair the parts of both countries by name, in first-seen order; a part one side lacks reads as silent (null) there */
  function pairParts(partsFrom, partsTo) {
    var order = [],
      byFrom = {},
      byTo = {};
    partsFrom.forEach(function (item) {
      if (!byFrom[item.name]) order.push(item.name);
      byFrom[item.name] = item;
    });
    partsTo.forEach(function (item) {
      if (!byFrom[item.name] && !byTo[item.name]) order.push(item.name);
      byTo[item.name] = item;
    });
    return order.map(function (name) {
      var from = byFrom[name] || part(name, null),
        to = byTo[name] || part(name, null);
      return { name: name, from: from, to: to, same: from.compare === to.compare, named: !(from.plain || to.plain) };
    });
  }
  /** what moved between two charts: the roles one pack names and the other does not, and the roles both name under another code or name */
  function ledgerMoves(chartFrom, chartTo) {
    var moves = { added: 0, removed: 0, renamed: 0 };
    Object.keys(chartTo).forEach(function (role) {
      var before = chartFrom[role];
      if (!before) moves.added++;
      else if (before.name !== chartTo[role].name || before.code !== chartTo[role].code) moves.renamed++;
    });
    Object.keys(chartFrom).forEach(function (role) {
      if (!chartTo[role]) moves.removed++;
    });
    return moves;
  }
  /** the ledgers row pairs its own way: the two sizes, then a count of what moved (never one part per role); reads facts.ledgers {role: {code, name}} */
  function ledgerRows(factsFrom, factsTo) {
    var sizeFrom = plural(Object.keys(factsFrom.ledgers).length, 'ledger'),
      sizeTo = plural(Object.keys(factsTo.ledgers).length, 'ledger'),
      moves = ledgerMoves(factsFrom.ledgers, factsTo.ledgers),
      rows = [{ name: 'ledgers', from: part('ledgers', sizeFrom), to: part('ledgers', sizeTo), same: sizeFrom === sizeTo, named: false }];
    Object.keys(moves).forEach(function (name) {
      rows.push({ name: name, from: part(name, null), to: part(name, moves[name] ? moves[name] : null), same: !moves[name], named: true, count: true });
    });
    return rows;
  }
  /** one side's value for the line: "none" when the pack is silent, the code when two currencies print the same symbol */
  function shown(side, other) {
    var text = side.value;
    if (text != null && other.value === text && side.compare !== other.compare && side.alt) text = side.alt;
    return text == null ? 'none' : text;
  }
  /** one pair worded for the line: "₹ → A$" or, for a named part, "issued within: 7 days → 3 days"; a long list says "see details" */
  function changeText(row) {
    if (row.count) return row.to.value + ' ' + row.name;
    var from = shown(row.from, row.to),
      to = shown(row.to, row.from),
      tooLong = from.length > LONG || to.length > LONG;
    if (row.from.brief || row.to.brief || from === to || tooLong) return row.name + ': see details';
    return (row.named ? row.name + ': ' : '') + from + ' → ' + to;
  }
  function keepText(row) {
    if (row.from.brief) return row.name;
    return row.named ? row.name + ' ' + row.from.value : row.from.value;
  }
  /** at most `limit` items, then "and N more change(s)" */
  function capped(list, word, limit) {
    var rest = list.length - limit;
    return rest > 0 ? list.slice(0, limit).concat(['and ' + rest + ' more ' + (rest === 1 ? word : word + 's')]) : list;
  }
  /**
   * the verdict of one row: same (every part alike), the parts that changed and the parts that did not (a part silent on both sides is left out),
   * and `text`, the one short line the table shows. Nothing is compared as a whole cell.
   */
  function line(key, factsFrom, factsTo, reader) {
    var isChart = key === 'ledgers',
      rows = isChart ? ledgerRows(factsFrom, factsTo) : pairParts(parts(key, factsFrom, reader), parts(key, factsTo, reader)),
      changed = rows.filter(function (row) {
        return !row.same;
      }),
      kept = rows.filter(function (row) {
        return row.same && row.from.value != null;
      });
    if (!changed.length) return { same: true, rows: rows, changed: [], kept: kept, text: 'Same' };
    var said = capped(changed.map(changeText), 'change', isChart ? LEDGER_SHOWN : SHOWN).join(' · '),
      keep = kept.length && !isChart ? ' · same rule: ' + capped(kept.map(keepText), 'rule', SHOWN).join(', ') : '';
    return { same: false, rows: rows, changed: changed, kept: kept, text: 'Changes: ' + said + keep };
  }
  root.CBCountryCompare = { line: line, parts: parts, pairParts: pairParts, SHOWN: SHOWN };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBCountryCompare;
})(typeof window !== 'undefined' ? window : globalThis);
