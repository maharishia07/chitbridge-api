/* ADOPTED from chitbridge-engines v1.69.0 · country · sha256 c207933cd669d7a595b0e6df6272695ed7e21d3a6e079b6c2a00c46d470e1429 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · country. Edited ONLY in chitbridge-engines/src/country.js; every platform adopts a released version of it. */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note [BOOKS · COUNTRY REGISTRY] the ONE door a caller asks about a country: its tax ID, its return, its words for screens (R5, v1.53.0).
  // @stage-note A caller never names a country (`if (cc === 'AU')`, `pack.abn || pack.trn`); it asks here, and a new country answers through its own pack.
  /**
   * country.js — THE COUNTRY REGISTRY (split R5, DESIGN-COUNTRY-ENGINE-SPLIT §4 · DESIGN-SG-COUNTRY-ENGINE §2 · TRIAL-SG-RUNBOOK-2026-10-16).
   * Athi, 2026-10-16: "when we create another country what code change we are expecting to the existing code … and how we can avoid that".
   * Answer: callers ask this file for a STANDARD member; a new country's pack carries that member; nothing existing is edited.
   *
   *   ids()                       → ['IN', 'AU', 'AE', …] — the registered packs, in registry order
   *   packFor(code)               → the pack, or null — NEVER a silent India (unlike regulation.lookup)
   *   taxId(codeOrPack)           → { word, hint, check(v) → { ok, value, why } | null, legacy } — the tax-ID's name, an example, and its check
   *   returnInfo(codeOrPack)      → { form, short, authority, portal, frequencies, builds } | null — the return the pack names (null: none in the books, e.g. India's is read from the rail)
   *   meta(codeOrPack)            → { invoice, connectors, numbering, words, payments, slip } — screen data the pack carries (each null when it carries none)
   *   contractGaps(codeOrPack)    → ['taxId', …] — the standard members the pack does not answer yet (Country Lab shows them)
   *   rulesTable({ year })        → the country accounting rules, one row per rule, every registered pack (v1.60.0)
   *   moveInFor(code)             → { id, pack, map, noTax } — the move-in gate's one door: the shop's pack and ITS move-in map, each null when absent (v1.67.0);
   *                                 noTax: the pack takes the lanes that carry no tax before its map exists (pack `moveInNoTax`, v1.68.0)
   *   fingerprint(code, { source, codes, taxIds }) → the file's tax codes / tax IDs that belong to ANOTHER pack, not ours (v1.67.0)
   *
   * ⭐ THE STANDARD MEMBERS a pack carries for this door (a new country fills them; IN · AU · AE are answered by the frozen adapters below):
   *   taxId:   { name: 'UEN', hint: '201912345K', check(v) → { ok, value, why } }
   *   returns: { id, short, authority, portal, frequencies, periods(o), build(pack, period, movements, opts) }   (gst-returns.returnFor asks `build`)
   *   invoice: { requiredLines: ['trade_name', 'tax_id', …] } · connectors: [{ id, name, fits }] · numbering: { default: docnumber scheme } · words: { taxName, … }
   *
   * ── NEEDS regulation (the pack registry) · NO CLOCK · NO STORAGE ─────────────────────────────────────────────
   */
  var G = typeof globalThis !== 'undefined' ? globalThis : root;
  /** the pack registry, found when asked (a page may load this file before regulation) */
  function reg_() {
    return G.CBRegulation && G.CBRegulation.packFor ? G.CBRegulation : typeof require === 'function' ? require('./regulation') : null;
  }

  /* ⭐ LEGACY ADAPTERS — the three packs written before this door; their members keep their own names (abn · trn; India's check is the profile-map engine's).
   FROZEN: never a row for a new country — a new country carries `taxId` itself. Words and hints are what the screens showed before R5 (web cap-country.js:86); requiredLines the print setup's (web cap-print.js:33). */
  var LEGACY_ = {
    IN: {
      word: 'GSTIN',
      hint: '27AAPFU0939F1ZV',
      member: null,
      requiredLines: ['trade_name', 'tax_id', 'address'],
      returnText: 'GSTR-1 · GSTR-3B — GSTN (read from the invoices, not the ledgers)',
      words: { taxName: 'GST', taxId: 'GSTIN', postcode: 'PIN', region: 'State' }
    },
    AU: {
      word: 'ABN',
      hint: 'ABN · 11 digits',
      member: 'abn',
      requiredLines: ['trade_name', 'tax_id'],
      words: { taxName: 'GST', taxId: 'ABN', postcode: 'Postcode', region: 'State' }
    },
    AE: {
      word: 'TRN',
      hint: 'TRN · 15 digits',
      member: 'trn',
      requiredLines: ['trade_name', 'tax_id', 'address'],
      words: { taxName: 'VAT', taxId: 'TRN', postcode: 'P.O. Box', region: 'Emirate' }
    }
  };

  function packOf_(x) {
    if (x && typeof x === 'object') return x;
    var code = String(x == null ? '' : x)
      .trim()
      .toUpperCase();
    var R = reg_();
    if (!code || !R) return null;
    return R.packFor(code) || null; /* packFor answers null for an unknown id; it never throws */
  }
  function ids() {
    var R = reg_();
    return R
      ? R.list().map(function (item) {
          return item.id;
        })
      : [];
  }
  function packFor(code) {
    return packOf_(String(code == null ? '' : code));
  }

  /** one shape for every check: { ok, value, why } — abn.check answers { ok, abn, formatted, why }, trn.check { ok, trn, tin, why } */
  function normalCheck_(fn, key) {
    return function (v) {
      var r = fn(v) || {};
      return {
        ok: !!r.ok,
        value: r.value != null ? r.value : r[key] != null ? r[key] : r.formatted != null ? r.formatted : null,
        why: r.ok ? null : r.why || null
      };
    };
  }
  function taxId(x) {
    var p = packOf_(x);
    if (!p) return { word: null, hint: null, check: null, legacy: false };
    if (p.taxId && typeof p.taxId === 'object') {
      var t = p.taxId;
      return {
        word: t.name || (p.tax && p.tax.idName) || null,
        hint: t.hint || null,
        check: typeof t.check === 'function' ? normalCheck_(t.check, 'value') : null,
        legacy: false
      };
    }
    var L = Object.prototype.hasOwnProperty.call(LEGACY_, p.id) ? LEGACY_[p.id] : null;
    if (L) {
      var m = L.member && p[L.member];
      return { word: L.word, hint: L.hint, check: m && typeof m.check === 'function' ? normalCheck_(m.check, L.member) : null, legacy: true };
    }
    return { word: (p.tax && p.tax.idName) || null, hint: null, check: null, legacy: false };
  }
  function returnInfo(x) {
    var p = packOf_(x),
      R = p && p.returns;
    if (!R || !R.id) return null;
    return {
      form: R.id,
      short: R.short || R.id,
      name: R.name || R.id,
      authority: R.authority || null,
      portal: R.portal || null,
      frequencies: Array.isArray(R.frequencies) ? R.frequencies.slice() : [],
      builds: typeof R.build === 'function' || R.id === 'BAS'
    };
  }
  function meta(x) {
    var p = packOf_(x) || {};
    var pick = function (k) {
      return p[k] && typeof p[k] === 'object' ? p[k] : null;
    };
    var L = p.id && Object.prototype.hasOwnProperty.call(LEGACY_, p.id) ? LEGACY_[p.id] : null;
    return {
      invoice: pick('invoice') || (L ? { requiredLines: L.requiredLines.slice(), legacy: true } : null),
      connectors: Array.isArray(p.connectors) ? p.connectors.slice() : null,
      numbering: pick('numbering'),
      words: pick('words') || (L && L.words ? Object.assign({ legacy: true }, L.words) : null),
      payments: Array.isArray(p.payments) ? p.payments.slice() : null,
      slip: pick('slip')
    };
  }
  var STANDARD_ = ['taxId', 'returns', 'invoice', 'connectors', 'numbering', 'words'];
  function contractGaps(x) {
    var p = packOf_(x);
    if (!p) return STANDARD_.slice();
    var t = taxId(p),
      r = returnInfo(p),
      m = meta(p);
    return STANDARD_.filter(function (item) {
      if (item === 'taxId') return !t.check && !(t.legacy && p.id === 'IN');
      if (item === 'returns') return !r;
      return m[item] == null;
    });
  }

  /* ── ⭐ THE COUNTRY ACCOUNTING RULES (v1.60.0) — one table, read from the packs: docs/ACCOUNTING-RULES.md (tools/accounting-rules.cjs) and the
      Country Lab's "All countries" view call THIS, so the page and the README can never disagree. Athi, 17 Oct: "what are country specific
      accounting rules … in the same table format … in the country lab we have to present". ── */
  var MONTH_NAMES_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /* v1.64.1: no inner catches — Intl does not throw for a pack's ISO 4217 code; a rule that throws is caught ONCE in rulesTable and shown in its cell ('error: …') */
  function decimals_(cur) {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;
  }
  /** the pack's own format tag (BCP-47) */
  function tag_(p) {
    return (p.locale && p.locale.format) || 'en';
  }
  /** an amount in the country's own symbol and grouping (Intl) */
  var BIDI_ = /[\u200e\u200f\u061c]/g;
  function looks_(p, amount, display) {
    return new Intl.NumberFormat(tag_(p), { style: 'currency', currency: p.currency, currencyDisplay: display || 'symbol' }).format(amount).replace(BIDI_, '');
  }
  /** the symbol as written abroad (English, international): A$ · S$ · US$ — where several countries use the same local sign */
  function abroad_(p) {
    var s = new Intl.NumberFormat('en', { style: 'currency', currency: p.currency }).formatToParts(1).filter(function (x) {
      return x.type === 'currency';
    })[0];
    return s ? s.value : null;
  }
  /** the symbol alone (narrow: ₹ · $ · ¥ · RM) */
  function symbol_(p) {
    var parts = new Intl.NumberFormat(tag_(p), { style: 'currency', currency: p.currency, currencyDisplay: 'narrowSymbol' }).formatToParts(1);
    var s = parts.filter(function (x) {
      return x.type === 'currency';
    })[0];
    return s ? s.value : null;
  }
  function moneyText_(p, minor) {
    var d = decimals_(p.currency);
    return p.currency + ' ' + (Number(minor) / Math.pow(10, d)).toLocaleString('en', { maximumFractionDigits: d });
  }
  /** does the pack credit input tax, and what is an excess called — asked of its own setOff (100 out, 150 in) */
  function creditOf_(p) {
    var h = (p.taxHeads || [])[0];
    if (!h || typeof p.setOff !== 'function') return { credit: null, excess: null };
    var o = {},
      i = {};
    o[h] = 100;
    i[h] = 150;
    try {
      var r = p.setOff({ output: o, input: i }, function (v) {
        return Number(v || 0);
      });
      if (!r.utilised || !r.utilised.length) return { credit: 'No — single-stage; tax on a purchase is its cost', excess: null };
      var extra = Object.keys(r).filter(function (item) {
        return ['utilised', 'payable', 'carried'].indexOf(item) < 0;
      });
      return { credit: 'Yes — input tax set off against output', excess: extra.length ? extra[0] + ' (or carried)' : 'carried forward' };
    } catch (e) {
      return { credit: 'refused: ' + e.message, excess: null };
    }
  }
  /**
   * CTRY-43 · the depreciation row said "company: div40; sole_trader: div40; ..." - the pack's CODE, four times over, which a reader took for a
   * broken cell ("Div"). The row now says the law in words, once per law, with the entity types that follow it. A code this table does not know
   * is spelled out (underscores to spaces), never dropped; the words are the same ones the Labs switcher uses (web lab-kit WORDS).
   */
  var BASIS_WORDS_ = {
    div40: 'Capital allowances (Division 40)',
    schedule_ii: 'Companies Act schedule rates',
    it_act_wdv: 'Income-tax Act written-down value',
    ias16: 'International standard rates (IAS 16)',
    straight_line: 'Same amount every year'
  };
  function spelled_(code) {
    return String(code).replace(/_/g, ' ');
  }
  function depreciationOf_(p) {
    var d = p.depreciation || {},
      bases = d.entityBases || {},
      classes = d.assetClasses || [],
      laws = [],
      who = {};
    Object.keys(bases).forEach(function (item) {
      var code = bases[item].basis || bases[item].method;
      var words = bases[item].label || BASIS_WORDS_[code] || (code ? spelled_(code) : 'not stated by the pack');
      if (!who[words]) {
        who[words] = [];
        laws.push(words);
      }
      who[words].push(spelled_(item));
    });
    return {
      how: laws
        .map(function (words) {
          return words + ' — ' + who[words].join(', ');
        })
        .join('; '),
      lives: classes
        .map(function (item) {
          return item.class + ' ' + (item.life ? item.life + ' y' : item.rate != null ? item.rate + '%' : item.rates ? 'by rate table' : 'not stated by the pack');
        })
        .join(', ')
    };
  }
  function filingOf_(p, year) {
    var info = returnInfo(p),
      L = Object.prototype.hasOwnProperty.call(LEGACY_, p.id) ? LEGACY_[p.id] : null;
    if (!info) return { form: L && L.returnText ? L.returnText : null, when: null };
    var stag = p.returns.staggers ? Object.keys(p.returns.staggers)[0] : undefined,
      first = null;
    first = (p.returns.periods({ year: year, fy: year, frequency: info.frequencies[0], stagger: stag }) ||
      [])[0]; /* a refusal is shown in the cell by rulesTable */
    return {
      form: info.name + ' — ' + [info.authority, info.portal].filter(Boolean).join(' · '),
      when:
        info.frequencies.join(' / ') + (first ? '; e.g. ' + (first.label || first.period) + ' due ' + first.due : '') + (stag ? ' (stagger ' + stag + ')' : '')
    };
  }
  var RULES_ = [
    [
      'currency',
      'Currency',
      function (p) {
        return p.currency + ' · ' + decimals_(p.currency) + ' decimals';
      }
    ],
    [
      'symbol',
      'Currency symbol',
      function (p) {
        var text = symbol_(p),
          a = abroad_(p);
        return text ? text.replace(BIDI_, '') + (a && a !== text ? ' · abroad ' + a : '') : null;
      }
    ],
    [
      'money',
      'Money looks like',
      function (p) {
        return looks_(p, 1234567.891);
      }
    ],
    /* A3 (v1.63.0): a line's tax keeps the currency's own decimals (0 JPY · 2 most · 3 OMR KWD BHD); the invoice TOTAL rounds to the pack's unit */
    [
      'rounding',
      'Rounding',
      function (p) {
        var d = decimals_(p.currency),
          unit = p.tax && p.tax.invoice_round_to;
        return (
          'line tax to ' +
          (d === 0 ? 'whole ' + p.currency : d + ' decimals') +
          ' · invoice total to ' +
          (unit == null ? 'the line sum' : unit >= 1 ? 'whole ' + p.currency : unit + ' ' + p.currency) +
          ' (half up)'
        );
      }
    ],
    [
      'date',
      'Dates look like',
      function (p, o) {
        var date = new Date(Date.UTC(o.year, 9, 17, 12));
        return (
          date.toLocaleDateString(tag_(p), { timeZone: 'UTC' }) +
          ' · ' +
          date.toLocaleDateString(tag_(p), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        ).replace(BIDI_, '');
      }
    ],
    [
      'langs',
      'Languages',
      function (p) {
        return ((p.locale && p.locale.langs) || []).join(', ') || null;
      }
    ],
    [
      'zones',
      'Time zones',
      function (p) {
        return (p.timeZones || []).join(', ') || null;
      }
    ],
    [
      'address',
      'Address words',
      function (p) {
        var w = meta(p).words || {};
        return w.postcode || w.region ? [w.postcode, w.region === null ? 'no region row' : w.region].filter(Boolean).join(' · ') : null;
      }
    ],
    [
      'year',
      'Financial year starts',
      function (p) {
        var f = p.fiscalYear || {};
        return MONTH_NAMES_[f.startMonth - 1] + ' (' + f.label + ' label)';
      }
    ],
    [
      'statements',
      'Statements follow',
      function (p) {
        return p.basis;
      }
    ],
    [
      'chart',
      'Chart',
      function (p) {
        return (p.groups || []).length + ' groups · ' + (p.ledgers || []).length + ' ledgers';
      }
    ],
    [
      'tax',
      'Tax',
      function (p) {
        return ((p.words && p.words.taxName) || (p.tax && p.tax.scheme)) + ' — heads: ' + (p.taxHeads || []).join(', ');
      }
    ],
    [
      'shelf',
      'Shelf prices',
      function (p) {
        var v = p.tax && p.tax.prices_include_tax;
        return v === true ? 'Include tax' : v === false ? 'Exclude tax — the counter adds it' : v === null ? 'Either — the shop decides' : null;
      }
    ],
    [
      'cashround',
      'Cash rounds to',
      function (p) {
        var r = p.cashRounding;
        return r && r.step_minor ? moneyText_(p, r.step_minor) + ' (cash only; card pays the exact total)' : 'No rounding';
      }
    ],
    [
      'slip',
      'Counter slip title',
      function (p) {
        var s = p.slip;
        if (!s || !s.titles || !s.titles.tax) return null;
        return s.langs
          .map(function (item) {
            return s.titles.tax[item];
          })
          .filter(Boolean)
          .join(' · ');
      }
    ],
    [
      'rates',
      'Rates',
      function (p) {
        return (p.tax && p.tax.rates ? p.tax.rates.join('% · ') + '%' : null) + (p.tax && p.tax.stateRates ? " (+ each state's base rate)" : '');
      }
    ],
    [
      'kinds',
      'Supply kinds (rate · input credit)',
      function (p) {
        var k = (p.tax && p.tax.supplyKinds) || {};
        return (
          Object.keys(k)
            .map(function (item) {
              var s = k[item];
              return (s.name || item) + ' ' + (s.rate == null ? 'own rate' : s.rate + '%') + (s.credit ? ' ✓' : ' —');
            })
            .join('; ') || 'by slab (HSN)'
        );
      }
    ],
    [
      'credit',
      'Input tax credit',
      function (p) {
        return creditOf_(p).credit;
      }
    ],
    [
      'excess',
      'Excess input tax',
      function (p) {
        return creditOf_(p).excess;
      }
    ],
    [
      'supply',
      'Tax across a state line',
      function (p) {
        return p.tax && p.tax.supply === 'state' ? 'Split by place of supply (inside vs another state)' : 'One rate country-wide';
      }
    ],
    [
      'rcm',
      'Reverse charge ledger',
      function (p) {
        return (p.taxHeads || []).some(function (item) {
          return p.taxLedgers[item] && p.taxLedgers[item].rcm;
        })
          ? 'Yes'
          : 'Not built';
      }
    ],
    /* the threshold's key differs by pack (AU turnover_minor · others mandatory_minor) — a Country Standard item; no single figure → the pack's own sentence */
    [
      'register',
      'Must register above',
      function (p) {
        var g = (p.tax && p.tax.registration) || {},
          m = g.mandatory_minor != null ? g.mandatory_minor : g.turnover_minor;
        return m != null ? moneyText_(p, m) : g.cite ? g.cite.replace(/ ⚠$/, '') : null;
      }
    ],
    [
      'taxid',
      'Tax ID',
      function (p) {
        var t = taxId(p);
        return t.word ? t.word + (t.hint ? ' (e.g. ' + t.hint + ')' : '') + (t.check ? '' : ' — checked elsewhere') : null;
      }
    ],
    [
      'invoice',
      'A tax invoice must show',
      function (p) {
        return ((meta(p).invoice || {}).requiredLines || []).join(', ').replace(/_/g, ' ') || null;
      }
    ],
    [
      'simplified',
      'Simplified invoice up to',
      function (p) {
        var ti = p.tax && p.tax.taxInvoice;
        return ti && ti.simplified_upto_minor != null ? moneyText_(p, ti.simplified_upto_minor) : null;
      }
    ],
    [
      'return',
      'Tax return',
      function (p, o) {
        return filingOf_(p, o.year).form;
      }
    ],
    [
      'filed',
      'Filed',
      function (p, o) {
        return filingOf_(p, o.year).when;
      }
    ],
    [
      'depreciation',
      'Depreciation',
      function (p) {
        return depreciationOf_(p).how;
      }
    ],
    [
      'lives',
      'Asset lives / rates',
      function (p) {
        return depreciationOf_(p).lives;
      }
    ],
    [
      'records',
      'Keep records',
      function (p) {
        return p.retentionYears ? p.retentionYears + ' years' : null;
      }
    ],
    [
      'voucher',
      'Voucher number',
      function (p) {
        return (
          p.voucherFormat +
          ' · series ' +
          Object.keys(p.voucherSeries || {})
            .map(function (item) {
              return p.voucherSeries[item];
            })
            .join(' ')
        );
      }
    ],
    [
      'pay',
      'Ways to pay → ledger',
      function (p) {
        var m = (p.chart || {}).paymentModes || {};
        return Object.keys(m)
          .map(function (item) {
            return item + '→' + m[item];
          })
          .join(', ');
      }
    ]
  ];
  /**
   * ⭐ rulesTable({ year }?) → { countries: [{ id, name, verified }], rules: [{ key, name, values: { CC: text | null } }] } — every registered pack's
   * accounting rules, one row per rule. `year` names the year whose first return period is shown (no clock here: the caller hands it). A null value
   * is the pack's silence — painted as "—", never filled in.
   */
  function rulesTable(opts) {
    var o = { year: (opts && opts.year) || 2026 },
      R = reg_(),
      packs = R ? R.list() : [];
    return {
      countries: packs.map(function (item) {
        return { id: item.id, name: item.name, verified: !!item.verified };
      }),
      rules: RULES_.map(function (item) {
        var values = {};
        packs.forEach(function (p) {
          var v;
          try {
            v = item[2](p, o);
          } catch (e) {
            v = 'error: ' + e.message;
          }
          values[p.id] = v == null || v === '' ? null : String(v);
        });
        return { key: item[0], name: item[1], values: values };
      })
    };
  }

  /* ── ⭐ THE MOVE-IN GATE (v1.67.0, move-in W1.1 · DECISIONS 2026-10-18:62) — "the country and its rule has to exactly match". A move-in reads the
      SHOP's pack through packFor (never a fallback) and only that pack's own `moveIn` map; a pack with no map takes no move-in (C2). ── */
  function mapOf_(p) {
    var m = p && p.moveIn;
    return m && typeof m.supplyKindFor === 'function' ? m : null;
  }
  /** moveInFor(code) → { id, pack, map, noTax } — pack null for a country we do not hold, map null for a pack that has no move-in map yet. Never India for an unknown.
   *  noTax (v1.68.0): true only for a pack with NO map that says `moveInNoTax: true` — its owner decided the lanes that carry no tax may move in before the map. */
  function moveInFor(code) {
    var p = packOf_(code == null ? '' : code),
      map = mapOf_(p);
    return {
      id: p
        ? p.id
        : String(code == null ? '' : code)
            .trim()
            .toUpperCase() || null,
      pack: p || null,
      map: map,
      noTax: !!(p && !map && p.moveInNoTax === true)
    };
  }
  /** the registered packs other than `shopId`, each with its own check / map */
  function others_(shopId) {
    var R = reg_();
    return R
      ? R.list().filter(function (item) {
          return item.id !== shopId;
        })
      : [];
  }
  /** a tax code OUR map does not know but another pack's map does → which packs know it (exact, as each map matches) */
  function codePacks_(own, rest, source, code) {
    if (own && own.supplyKindFor(source, code) !== undefined) return [];
    return rest
      .filter(function (item) {
        var m = mapOf_(item);
        return m && m.supplyKindFor(source, code) !== undefined;
      })
      .map(function (item) {
        return item.id;
      });
  }
  /** a tax ID OUR check refuses but another pack's check passes → which packs it belongs to */
  function idPacks_(ownCheck, rest, value) {
    if (ownCheck && ownCheck(value).ok) return [];
    return rest
      .filter(function (item) {
        var c = taxId(item).check;
        return c && c(value).ok;
      })
      .map(function (item) {
        return item.id;
      });
  }
  /**
   * fingerprint(shopCode, { source, codes, taxIds }) → { codes: [{ value, packs }], taxIds: [{ value, packs }] } — the file's own words that belong to ANOTHER
   * country (C3): a tax code another pack's map knows and ours does not, a tax ID another pack's check passes and ours refuses. Empty lists = nothing foreign.
   */
  function fingerprint(shopCode, o) {
    var own = moveInFor(shopCode),
      rest = others_(own.id),
      opt = o || {},
      ownCheck = own.pack ? taxId(own.pack).check : null;
    var uniq = function (list) {
      var seen = {};
      return (list || [])
        .map(function (item) {
          return String(item == null ? '' : item).trim();
        })
        .filter(function (item) {
          if (!item || seen[item]) return false;
          seen[item] = 1;
          return true;
        });
    };
    var codes = uniq(opt.codes).map(function (item) {
      return { value: item, packs: codePacks_(own.map, rest, opt.source, item) };
    });
    var ids2 = uniq(opt.taxIds).map(function (item) {
      return { value: item, packs: idPacks_(ownCheck, rest, item) };
    });
    var hit = function (x) {
      return x.packs.length > 0;
    };
    return { codes: codes.filter(hit), taxIds: ids2.filter(hit) };
  }

  const EXPORTS = {
    ids: ids,
    packFor: packFor,
    taxId: taxId,
    returnInfo: returnInfo,
    meta: meta,
    contractGaps: contractGaps,
    rulesTable: rulesTable,
    STANDARD: STANDARD_.slice(),
    moveInFor: moveInFor,
    fingerprint: fingerprint
  };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBCountries (after regulation and the packs). */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined')
    root.window.CBCountries = EXPORTS; /* CBCountries, not CBCountry: the web's Country setup screen owns window.CBCountry */
})(typeof globalThis !== 'undefined' ? globalThis : this);
