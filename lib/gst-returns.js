/* ADOPTED from chitbridge-engines v1.86.0 · gst-returns · sha256 4b897a5feb17ecc14a479f5aefe36aa503635d0862661df6e766f21d3c9ecb16 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · gst-returns. Edited ONLY in chitbridge-engines/src/gst-returns.js; every platform adopts a released version of it. */
/*
 * OWNS      a month's GSTR-1 and GSTR-3B read from the frozen invoices, their reconciliation to the Ledger, s.50 interest, and returnFor / periodsFor (the shop's own return by its pack).
 * CALLED BY the api (lib/gst-returns.js · lib/books-period.js · lib/books-pack.js · lib/books-todo.js), the web's accounts screens (window.CBGstReturns).
 * FLOW      documents ──▶ ctx_ (month · GSTIN · each document read through tax.moneyOf) ──▶ gstr1 (working books ──▶ GSTN json ──▶ tables) · gstr3b (sheet ──▶ ITC totals ──▶ posting.gstSetOff ──▶ 6.1 ──▶ tables) ──▶ series · reconcile · interestFor
 * CARD      15-tax-and-country-packs/gst-returns-bas-vat
 */
(function (root) {
  'use strict';
  // @stage tested
  // @stage-note GSTR-1 and GSTR-3B read from the frozen invoices; reconcile to the Ledger; s.50 interest; returnFor dispatches the shop's own return (BAS, VAT201) to its pack. Pure — no I/O, no clock.
  /**
   * gst-returns.js — A MONTH'S GSTR-1 AND GSTR-3B, READ FROM THE FROZEN INVOICES. v1.17.0.
   * v1.39.0 (BAS1): ⭐ returnFor(pack, period, movements) / periodsFor(pack, opts) — ONE door to the shop's OWN return, whichever country: the pack's
   * `returns` (reg-au BAS · reg-ae VAT201) READ the period's posted ledger movements by role; India keeps GSTR-1 / 3B below exactly as before.
   *
   * The year journey (docs/year-book/2026-27.md §9, gap 5): "GST set-off and payment are posted from the Ledger balances;
   * nothing reconciles them to a return." Standing rule: a bill's tax is computed ONCE, at billing (tax.determine); everyone
   * else READS it. So nothing here computes a tax. Every figure comes out of `tax.moneyOf(invoice)` — the slot the invoice was
   * frozen into — and this file only SORTS and ADDS those figures into the sections of the two returns:
   *   gstr1()  B2B · B2CL · B2CS · CDNR / CDNUR · HSN summary · nil / exempt / non-GST · documents issued
   *   gstr3b() 3.1 outward · 3.2 inter-state to unregistered by POS · 4 ITC (available, reversed, net, ineligible) · 5 exempt inward
   *            · 6.1 payment — set off by posting.gstSetOff (the s.49 / 49A order; it is CALLED, never a second order here)
   *   series() a run of months, the unused ITC carried from one to the next
   *   reconcile() the return against the Ledger's output / input / paid, every difference NAMED, never forced to zero
   *   interestFor() / dueDate() s.50 interest on late payment of the net cash liability, a pure function
   *
   * ── THE INPUT: `documents` ─────────────────────────────────────────────────────────────────────────────────────────
   *   { kind, ref, date, inv, period?, party?, cancelled?, … }
   *   kind     'invoice' | 'credit_note' | 'debit_note'          — outward (issued BY the shop)
   *            'purchase' | 'purchase_return'                    — inward (a purchase_return is the debit note sent back)
   *   date     the document date, YYYY-MM-DD
   *   inv      the FROZEN invoice (tax.determine's output) — nothing else is read for money
   *   period   'YYYY-MM' the return it falls in. Default: the date's month. An inward document takes the month the books took
   *            it (ITC is claimed when booked / in GSTR-2B), which can be later than its date — the caller says so.
   *   cancelled  true → listed under documents issued, in no figure
   *   outward only:  nil_kind 'nil' (default) | 'exempt' | 'non_gst' for the rate-0 part · zero_rated (export / SEZ → 3.1(b)) ·
   *                  against_value (a note's original invoice value, for the B2CL / CDNUR test) · against (the original ref)
   *   inward only:   blocked [{ line: <index> | 'all', reason }] — s.17(5) credit, excluded from ITC with its reason ·
   *                  rcm true (reverse charge → 3.1(d) and 4A(3)) · non_gst (the rate-0 part is non-GST, for table 5)
   *
   * ── CITATIONS (checked, and to be re-checked at filing — a threshold is law, not code) ─────────────────────────────
   *   GSTR-1 JSON: the field names of the GSTN offline tool (gstin · fp · b2b/ctin/inv/inum/idt/val/pos/rchrg/inv_typ/itms/
   *     itm_det{rt,txval,iamt,camt,samt,csamt} · b2cl · b2cs · cdnr · cdnur · nil · hsn.data · doc_issue.doc_det). The file
   *     version label is the portal's to say; the caller passes `schema_version` and it is written to the JSON untouched.
   *   B2CL: Table 5 of GSTR-1 — an inter-state B2C invoice above the limit is shown invoice by invoice. The limit was ₹2,50,000;
   *     Notification No. 12/2024–Central Tax (10 Jul 2024) lowered it to ₹1,00,000 for tax periods from August 2024. Both
   *     are data (B2CL_LIMITS) and chosen by the invoice's period, so an old month still files on its own limit.
   *   ITC: CGST Act s.16 (eligibility), s.17(5) (blocked credit), s.17(1)-(2) with CGST Rules 42-43 (exempt / personal use
   *     apportionment — passed in as `itc_reversals`, not recomputed), Rule 38. Set-off: s.49 / 49A / 49(5) via posting.gstSetOff.
   *   Interest: s.50(1) — 18% p.a. (notified under s.50(1), Rule 88B) on the NET CASH liability, from the day after the due date
   *     (the 20th of the next month for a monthly GSTR-3B) to the day of payment, 365-day year.
   *   LEFT OUT, on purpose: the late fee (s.47: ₹50 / ₹20 a day, capped by turnover bands that change by notification), interest
   *     on ITC wrongly availed (s.50(3), 24%), exports and SEZ tables (6 / 6A), amendments (9 / 9A), ISD, composition and UIN
   *     rows of 3.2, e-commerce operators. A zero-rated document lands in 3.1(b) only, with a warning that Table 6 is not built.
   *
   * ── MONEY ──────────────────────────────────────────────────────────────────────────────────────────────────────────
   * Every sum is taken in PAISE (integers) and handed back in rupees at 2dp, so no total drifts by a paisa. Per-rate rows use
   * `moneyOf(inv).by_rate` — the same slot the posting event takes — which is why the return and the Ledger cannot disagree
   * about one frozen invoice. Cess is read per line from `moneyOf(inv).lines` (by_rate carries none).
   */

  /* ⭐ the ONE place this India-only engine names its country and currency (CTRY-DATA guard: tests/country-literals.test.js) */
  var COUNTRY_ = 'IN',
    CURRENCY_ = 'INR';
  /* ── the three engines this one reads: found once, kept; a host without one gets null and refuses in its own words ─── */
  var taxCache_ = null,
    postingCache_ = null,
    packsCache_ = null,
    moneyCache_ = null;
  /* the three nil words a line may carry (home: tax-slab.NIL_KINDS; written by tax.ItemList _nil_kind) */
  var NIL_KIND_ = /^(nil|exempt|non_gst)$/;
  /** what a require that threw hands back: nothing, so the caller's own check refuses and the next call tries again */
  function loadFailed_() {
    return null;
  }
  /** an engine by its page global, else by require; null when this host has neither */
  function dependency_(file, globalName) {
    var host = typeof globalThis !== 'undefined' ? globalThis : root;
    if (host[globalName] && typeof host[globalName] === 'object' && Object.keys(host[globalName]).length) return host[globalName];
    if (typeof require === 'function') {
      try {
        return require(file);
      } catch (_) {
        return loadFailed_();
      }
    }
    return null;
  }
  /** the tax engine, or null */
  function taxEngine_() {
    return taxCache_ || (taxCache_ = dependency_('./tax', 'CBTax'));
  }
  /** the tax-packs engine (the one dated-row reader), or null */
  function packsEngine_() {
    return packsCache_ || (packsCache_ = dependency_('./tax-packs', 'CBTaxPacks'));
  }
  /** the posting engine, or null */
  function postingEngine_() {
    return postingCache_ || (postingCache_ = dependency_('./posting', 'CBPosting'));
  }
  /** the money engine, or null */
  function moneyEngine_() {
    return moneyCache_ || (moneyCache_ = dependency_('./money', 'CBMoney'));
  }
  /** the one refusal shape: { ok: false, why } */
  function refuse_(reason) {
    return { ok: false, why: reason };
  }
  /** the words of a caught throw: its message, else the value itself as text */
  function thrownWhy_(error) {
    return error && error.message ? error.message : String(error);
  }
  /**
   * `list.<method>(callback)` for a list the CALLER supplied. A value that is no list fails in V8's own words about `source`, the code that
   * named it — the words the inline call always gave — so a refusal a caller has learned to read does not change with the names in this file.
   */
  function callListed_(list, method, source, callback) {
    var found = list[method];
    if (typeof found !== 'function') throw new TypeError(source + '.' + method + ' is not a function');
    return found.call(list, callback);
  }
  /**
   * SEC-140: an empty map for keys that come from bill data (place of supply, buyer GSTIN, HSN, series prefix, a purchase line). It has no
   * prototype, so '__proto__', 'constructor' and 'prototype' are ordinary keys and a write can never reach Object.prototype.
   */
  function keyedMap_() {
    return Object.create(null);
  }
  /** (map[key] = map[key] || []).push(item) on a keyedMap_, so any key — 'constructor' too — starts a fresh list */
  function pushUnder_(map, key, item) {
    (map[key] = map[key] || []).push(item);
  }
  /** the section a blocked-credit reason names, or null — only the reasons the engine lists, never something inherited ('constructor') */
  function sectionOfReason_(reason) {
    return Object.prototype.hasOwnProperty.call(BLOCKED_REASONS, reason) ? BLOCKED_REASONS[reason] : null;
  }

  var HEADS = ['igst', 'cgst', 'sgst'];
  var HEADS4 = ['igst', 'cgst', 'sgst', 'cess'];
  var TOTAL_KEYS = ['txval', 'igst', 'cgst', 'sgst', 'cess'];

  /** the B2CL limit by the month it applies from — data with its citation; the latest `from` not after the period wins */
  var B2CL_LIMITS = [
    { from: '2017-07', limit: 250000, cite: 'GSTR-1 Table 5, ₹2.5 lakh' },
    { from: '2024-08', limit: 100000, cite: 'Notification 12/2024-Central Tax, 10 Jul 2024: ₹1 lakh from the August 2024 period' }
  ];
  /** s.17(5) blocked-credit reasons the engine knows by name. Any other reason text is still excluded (never defaulted to eligible). */
  var BLOCKED_REASONS = {
    motor_vehicle: 'CGST Act s.17(5)(a)/(aa): motor vehicles, vessels and aircraft not used for the permitted purposes',
    food_beverage: 'CGST Act s.17(5)(b)(i): food and beverages, outdoor catering, beauty treatment, health services, cosmetic and plastic surgery',
    club_fitness: 'CGST Act s.17(5)(b)(ii): membership of a club, health and fitness centre',
    employee_travel: 'CGST Act s.17(5)(b)(iii): travel benefits to employees on vacation',
    works_contract: 'CGST Act s.17(5)(c): works contract for immovable property (other than plant and machinery)',
    own_construction: 'CGST Act s.17(5)(d): goods or services for construction of immovable property on own account',
    composition: 'CGST Act s.17(5)(e): tax paid under the composition scheme',
    non_resident: 'CGST Act s.17(5)(f): non-resident taxable person (other than imports)',
    personal_use: 'CGST Act s.17(5)(g): goods or services for personal consumption',
    lost_gifted: 'CGST Act s.17(5)(h): goods lost, stolen, destroyed, written off or disposed of by gift or free samples',
    fraud_penalty: 'CGST Act s.17(5)(i): tax paid under s.74, 129 or 130'
  };
  var RATE_INTEREST = 18; /* % p.a., s.50(1) */

  /* ── small arithmetic, in paise ────────────────────────────────────────────────────────────────────────────────── */
  /** a rupee figure as whole paise (anything that is not a finite number is 0) */
  function toPaise_(amount) {
    var number = Number(amount);
    return isFinite(number) ? Math.round(Number((number * 100).toPrecision(15))) : 0;
  }
  /** paise as rupees */
  function toRupees_(paise) {
    return paise / 100;
  }
  /** a fresh set of the five figures every return row carries */
  function emptyTotals_() {
    return { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  }
  /** total += factor × part, figure by figure (a factor of 0 or none counts as 1); hands the total back */
  function addInto_(total, part, factor) {
    factor = factor || 1;
    TOTAL_KEYS.forEach(function (item) {
      total[item] += factor * (part[item] || 0);
    });
    return total;
  }
  /** 'YYYY-MM' of a date text */
  function monthOf_(date) {
    return String(date || '').slice(0, 7);
  }
  /** a YYYY-MM-DD date as the portal writes it, DD-MM-YYYY; any other text comes back as it is */
  function portalDate_(date) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
    return match ? match[3] + '-' + match[2] + '-' + match[1] : String(date || '');
  }
  /** the portal's filing period, MMYYYY, of 'YYYY-MM' */
  function filingPeriod_(month) {
    return month.slice(5, 7) + month.slice(0, 4);
  }
  /** the return a document falls in: its own period, else the month of its date */
  function periodOf_(doc) {
    return doc.period || monthOf_(doc.date);
  }
  /** a real YYYY-MM-DD as a whole day number, or null (a 31st of February is not a day) */
  function dayNumber_(text) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
    if (!match) return null;
    var time = Date.UTC(+match[1], +match[2] - 1, +match[3]);
    return new Date(time).getUTCMonth() === +match[2] - 1 ? Math.round(time / 86400000) : null;
  }
  /** the B2CL limit row in force for a month */
  function limitFor_(month) {
    var current = B2CL_LIMITS[0];
    B2CL_LIMITS.forEach(function (entry) {
      if (entry.from <= month) current = entry;
    });
    return current;
  }

  /* ── reading one document ──────────────────────────────────────────────────────────────────────────────────────── */
  var OUTWARD = { invoice: 1, credit_note: -1, debit_note: 1 };
  var INWARD = { purchase: 1, purchase_return: -1 };

  /** the invoice's lines in paise, and the cess each rate carries: { lines, cessByRate } */
  function readLines_(money, items) {
    var cessByRate = {},
      lines = [];
    money.lines.forEach(function (taxLine, index) {
      var item = items[index] || {},
        rate = Number(item.GstRt) || 0;
      cessByRate[rate] = (cessByRate[rate] || 0) + toPaise_(taxLine.cess);
      lines.push(lineRow_(taxLine, item, rate));
    });
    return { lines: lines, cessByRate: cessByRate };
  }
  /** one ItemList line with the tax engine's figures for it, in paise */
  function lineRow_(taxLine, item, rate) {
    var row = {
      hsn: String(item.HsnCd || ''),
      uqc: String(item.Unit || '') || 'OTH',
      qty: Number(item.Qty) || 0,
      rate: rate,
      desc: String(item.PrdDesc || ''),
      txval: toPaise_(taxLine.taxable),
      igst: toPaise_(taxLine.igst),
      cgst: toPaise_(taxLine.cgst),
      sgst: toPaise_(taxLine.sgst),
      cess: toPaise_(taxLine.cess),
      total: toPaise_(taxLine.total)
    };
    /* v1.72.0 (F5 E1): the line's own nil / exempt / non_gst word when its slab declared one (tax.ItemList _nil_kind); absent = the document's word */
    if (NIL_KIND_.test(item._nil_kind)) row.nil_kind = item._nil_kind;
    return row;
  }
  /** the document's figures per rate, in paise: the tax engine's rows plus any rate that carries only cess */
  function rateRows_(byRate, cessByRate) {
    var rows = {};
    Object.keys(byRate).forEach(function (item) {
      var bucket = byRate[item],
        rate = Number(item);
      rows[rate] = {
        txval: toPaise_(bucket.taxable),
        igst: toPaise_(bucket.igst),
        cgst: toPaise_(bucket.cgst),
        sgst: toPaise_(bucket.sgst),
        cess: cessByRate[rate] || 0
      };
    });
    Object.keys(cessByRate).forEach(function (item) {
      if (!rows[item] && cessByRate[item]) rows[item] = { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: cessByRate[item] };
    });
    return rows;
  }
  /** v1.20.0: lines under reverse charge carry their tax in the invoice's RCM heads (moneyOf(inv).rcm.lines), never in igst / cgst / sgst */
  function rcmLinesOf_(money) {
    return ((money.rcm && money.rcm.lines) || []).map(function (item) {
      return {
        line: item.line,
        category: item.category,
        itc: !!item.itc,
        txval: toPaise_(item.taxable),
        igst: toPaise_(item.igst),
        cgst: toPaise_(item.cgst),
        sgst: toPaise_(item.sgst),
        cess: 0
      };
    });
  }
  /** the buyer's place of supply and GSTIN and the seller's GSTIN of a frozen invoice */
  function partiesOf_(invoice, money) {
    var buyer = (invoice && invoice.BuyerDtls) || {},
      seller = (invoice && invoice.SellerDtls) || {};
    return {
      pos: money.pos_state || buyer.Pos || buyer.State || '',
      gstin: buyer.Gstin ? String(buyer.Gstin) : '',
      sellerGstin: seller.Gstin ? String(seller.Gstin) : ''
    };
  }
  /**
   * what one document says, in paise — read from tax.moneyOf, never recomputed.
   * rows: per rate { txval, igst, cgst, sgst, cess }; lines: per ItemList line { hsn, uqc, qty, rate, … }
   */
  function read_(doc) {
    var taxEngine = taxEngine_();
    if (!taxEngine || !taxEngine.moneyOf) throw new Error('gst-returns needs the tax engine (moneyOf).');
    var invoice = doc.inv,
      money = taxEngine.moneyOf(invoice, CURRENCY_),
      items = (invoice && invoice.ItemList) || [];
    var read = readLines_(money, items);
    var rows = rateRows_(money.by_rate, read.cessByRate);
    var rcmLines = rcmLinesOf_(money);
    var parties = partiesOf_(invoice, money);
    return {
      moneyDoc: money,
      rows: rows,
      lines: read.lines,
      rcmLines: rcmLines,
      total: toPaise_(money.total),
      supply: money.supply,
      pos: parties.pos,
      gstin: parties.gstin,
      sellerGstin: parties.sellerGstin,
      rcm: !!(invoice && invoice._cb && invoice._cb.reverse_charge)
    };
  }
  /** why a document cannot be read, in words naming it; null when it can */
  function documentRefusal_(doc, name) {
    if (!(doc.kind in OUTWARD) && !(doc.kind in INWARD))
      return refuse_(name + ' has kind "' + doc.kind + '" — invoice, credit_note, debit_note, purchase or purchase_return.');
    if (dayNumber_(doc.date) === null) return refuse_(name + ' needs its date as YYYY-MM-DD.');
    if (!doc.ref) return refuse_(name + ' needs its ref (the number it was issued under).');
    if (!doc.inv && !doc.cancelled) return refuse_(name + ' has no frozen invoice (inv) — a return reads the invoice, it never recomputes one.');
    return null;
  }
  /** the documents, validated and read; or a refusal naming the first that fails */
  function prep_(documents) {
    var out = [];
    for (var index = 0; index < (documents || []).length; index++) {
      var doc = documents[index] || {},
        name = 'document ' + (doc.ref || index + 1);
      var refusal = documentRefusal_(doc, name);
      if (refusal) return refusal;
      out.push({ doc: doc, read: doc.inv && !doc.cancelled ? read_(doc) : null });
    }
    return { ok: true, docs: out };
  }
  /** the month, the shop's GSTIN and the documents, checked; or a refusal */
  function ctx_(opts) {
    var options = opts || {};
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(options.month || ''))) return refuse_('A return is for a month, "YYYY-MM".');
    if (!/^\d{2}[0-9A-Z]{13}$/.test(String(options.gstin || ''))) return refuse_('A return needs the shop GSTIN (15 characters).');
    var prepared = prep_(options.documents);
    if (!prepared.ok) return prepared;
    return { ok: true, month: options.month, gstin: options.gstin, state: String(options.gstin).slice(0, 2), docs: prepared.docs };
  }

  /* ── GSTR-1 ────────────────────────────────────────────────────────────────────────────────────────────────────── */
  /** the GSTN item rows of a document's taxed rates, lowest rate first; the nil rate (0) is not an item */
  function itms_(rowsByRate) {
    var out = [],
      index = 0;
    Object.keys(rowsByRate)
      .map(Number)
      .sort(function (first, second) {
        return first - second;
      })
      .forEach(function (rate) {
        var bucket = rowsByRate[rate];
        if (!rate) return;
        index++;
        out.push({
          num: index,
          itm_det: {
            rt: rate,
            txval: toRupees_(bucket.txval),
            iamt: toRupees_(bucket.igst),
            camt: toRupees_(bucket.cgst),
            samt: toRupees_(bucket.sgst),
            csamt: toRupees_(bucket.cess)
          }
        });
      });
    return out;
  }
  /** the GSTN column a nil kind lands in: expt · ngsup · nil */
  function nilCol_(kind) {
    return kind === 'exempt' ? 'expt' : kind === 'non_gst' ? 'ngsup' : 'nil';
  }
  /**
   * nilSplit_(read, docKind) → [{ kind, txval }] — the document's rate-0 taxable (rows[0], in paise) split by nil kind (v1.72.0, F5 E1).
   * A rate-0 LINE whose slab declared its own word ('nil' | 'exempt' | 'non_gst', tax-slab.slabOf nil_kind) goes to that word; whatever is
   * left of rows[0] goes to the DOCUMENT's word (default 'nil'), so the parts always add up to rows[0] exactly and a document with no
   * line-level word answers precisely as before. Table 8 and 3.1(c)/(e) both read this, never a second split.
   */
  function nilSplit_(read, docKind) {
    var total = (read.rows[0] && read.rows[0].txval) || 0,
      byKind = {},
      saidByLines = 0;
    (read.lines || []).forEach(function (lineRow) {
      if (lineRow.rate || !lineRow.nil_kind) return;
      byKind[lineRow.nil_kind] = (byKind[lineRow.nil_kind] || 0) + lineRow.txval;
      saidByLines += lineRow.txval;
    });
    var rest = total - saidByLines,
      documentWord = docKind === 'exempt' || docKind === 'non_gst' ? docKind : 'nil';
    if (rest) byKind[documentWord] = (byKind[documentWord] || 0) + rest;
    return Object.keys(byKind).map(function (kind) {
      return { kind: kind, txval: byKind[kind] };
    });
  }
  /** a document number split into its series prefix, its running number and its digit width; null when it ends in no digit */
  function seriesOf_(ref) {
    var match = /^([\s\S]*?)(\d+)$/.exec(String(ref));
    /* ACC-267: the running number is a BigInt — past 2^53 a Number cannot tell n from n + 1, so a series counted by steps never ended */
    return match ? { prefix: match[1], n: BigInt(match[2]), width: match[2].length } : null;
  }

  /** CGST Rules 46(b), 16 characters: the longest consecutive serial number an invoice (or note) may carry */
  var SERIAL_MAX_LENGTH = 16;
  /** the empty working books of one GSTR-1 month */
  function newBook_(limit) {
    return {
      limit: limit,
      warnings: [],
      b2b: keyedMap_(),
      b2cl: keyedMap_(),
      b2cs: keyedMap_(),
      cdnr: keyedMap_(),
      cdnur: [],
      hsn: keyedMap_(),
      nil: keyedMap_(),
      issued: keyedMap_(),
      omitted13: [],
      summary: { invoices: 0, notes: 0, taxable: 0, tax: 0 },
      missingHsn: 0,
      zeroRated: 0
    };
  }
  /** documents issued counts every document, the cancelled ones too, by nature and series prefix */
  function noteIssued_(book, doc) {
    var nature = doc.kind === 'invoice' ? 'Invoices for outward supply' : doc.kind === 'credit_note' ? 'Credit Note' : 'Debit Note';
    var series = seriesOf_(doc.ref);
    if (!series) {
      book.warnings.push('documents issued: "' + doc.ref + '" does not end in a number, so it is in no series');
      return;
    }
    if (String(doc.ref).length > SERIAL_MAX_LENGTH) {
      book.omitted13.push(String(doc.ref));
      return;
    }
    var key = nature + '|' + series.prefix;
    (book.issued[key] = book.issued[key] || { nature: nature, prefix: series.prefix, docs: [] }).docs.push({
      n: series.n,
      ref: doc.ref,
      cancelled: !!doc.cancelled
    });
  }
  /** the month's invoice and note counts and signed taxable / tax, across every rate row */
  function tallySummary_(summary, rows, sign, isNote) {
    if (isNote) summary.notes++;
    else summary.invoices++;
    Object.keys(rows).forEach(function (item) {
      summary.taxable += sign * rows[item].txval;
      summary.tax += sign * (rows[item].igst + rows[item].cgst + rows[item].sgst + rows[item].cess);
    });
  }
  /** the nil / exempt / non-GST part, by the four GSTN buckets — per LINE where the line's slab said its word, the rest by the document's */
  function addNil_(book, doc, read, sign) {
    var zero = read.rows[0];
    if (!(zero && zero.txval)) return;
    var bucket = (read.supply === 'inter' ? 'INTR' : 'INTRA') + (read.gstin ? 'B2B' : 'B2C');
    var nilRow = (book.nil[bucket] = book.nil[bucket] || { sply_ty: bucket, expt_amt: 0, nil_amt: 0, ngsup_amt: 0 });
    nilSplit_(read, doc.nil_kind).forEach(function (part) {
      nilRow[nilCol_(part.kind) + '_amt'] += sign * part.txval;
    });
  }
  /** a new HSN summary row for a line */
  function hsnRow_(item) {
    return { hsn_sc: item.hsn, desc: item.desc, uqc: item.uqc, rt: item.rate, qty: 0, val: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
  }
  /** HSN summary — notes net it off */
  function addHsn_(book, lines, sign) {
    lines.forEach(function (item) {
      if (!item.hsn) book.missingHsn++;
      var field = item.hsn + '|' + item.uqc + '|' + item.rate,
        summary = (book.hsn[field] = book.hsn[field] || hsnRow_(item));
      summary.qty += sign * item.qty;
      summary.val += sign * item.total;
      summary.txval += sign * item.txval;
      summary.iamt += sign * item.igst;
      summary.camt += sign * item.cgst;
      summary.samt += sign * item.sgst;
      summary.csamt += sign * item.cess;
    });
  }
  /** the rate rows that carry tax (rate 0 is table 8 only) */
  function taxedRowsOf_(rows) {
    var taxed = {};
    Object.keys(rows).forEach(function (item) {
      if (Number(item)) taxed[item] = rows[item];
    });
    return taxed;
  }
  /** an invoice into B2B (registered buyer), B2CL (inter-state over the limit) or B2CS (the rest) */
  function placeInvoice_(book, doc, read, taxedRows, itms) {
    var value = toRupees_(read.total),
      inter = read.supply === 'inter';
    if (read.gstin) {
      var invoice = { inum: doc.ref, idt: portalDate_(doc.date), val: value, pos: read.pos, rchrg: 'N', inv_typ: 'R', itms: itms };
      pushUnder_(book.b2b, read.gstin, invoice);
    } else if (inter && read.total > toPaise_(book.limit))
      pushUnder_(book.b2cl, read.pos, { inum: doc.ref, idt: portalDate_(doc.date), val: value, itms: itms });
    else addB2cs_(book.b2cs, inter, read.pos, taxedRows, 1);
  }
  /** a credit / debit note into CDNR (registered buyer), CDNUR (inter-state over the limit) or the B2CS it nets off */
  function placeNote_(book, doc, read, taxedRows, itms, sign) {
    var inter = read.supply === 'inter';
    var note = {
      ntty: doc.kind === 'credit_note' ? 'C' : 'D',
      nt_num: doc.ref,
      nt_dt: portalDate_(doc.date),
      val: toRupees_(read.total),
      pos: read.pos,
      rchrg: 'N',
      inv_typ: 'R',
      itms: itms
    };
    if (read.gstin) pushUnder_(book.cdnr, read.gstin, note);
    else if (inter && toPaise_(doc.against_value != null ? doc.against_value : read.moneyDoc.total) > toPaise_(book.limit))
      book.cdnur.push({ typ: 'B2CL', ntty: note.ntty, nt_num: note.nt_num, nt_dt: note.nt_dt, val: note.val, pos: read.pos, itms: itms });
    else addB2cs_(book.b2cs, inter, read.pos, taxedRows, sign); /* a small B2C note nets off the B2CS it came out of */
  }
  /** one outward document of the month into the working books */
  function addOutward_(book, month, entry) {
    var doc = entry.doc;
    if (!(doc.kind in OUTWARD)) return;
    if (periodOf_(doc) !== month) return;
    noteIssued_(book, doc);
    if (doc.cancelled) return;
    var read = entry.read,
      sign = OUTWARD[doc.kind],
      isNote = doc.kind !== 'invoice';
    if (read.supply !== 'intra' && read.supply !== 'inter') {
      book.warnings.push(doc.ref + ': the invoice carries no supply type (' + read.supply + ') — left out');
      return;
    }
    if (doc.zero_rated) {
      book.zeroRated++;
      return;
    }
    tallySummary_(book.summary, read.rows, sign, isNote);
    addNil_(book, doc, read, sign);
    addHsn_(book, read.lines, sign);
    var taxedRows = taxedRowsOf_(read.rows);
    if (!Object.keys(taxedRows).length) return; /* wholly nil / exempt: table 8 only */
    var itms = itms_(taxedRows);
    if (isNote) placeNote_(book, doc, read, taxedRows, itms, sign);
    else placeInvoice_(book, doc, read, taxedRows, itms);
  }
  /** a map of lists as the sorted rows GSTN names them: [{ <keyName>: key, <listName>: list }] */
  function groupsJson_(groups, keyName, listName) {
    return Object.keys(groups)
      .sort()
      .map(function (group) {
        var row = {};
        row[keyName] = group;
        row[listName] = groups[group];
        return row;
      });
  }
  /** the B2CS rows: one per supply type, place of supply and rate */
  function b2csJson_(b2cs) {
    return Object.keys(b2cs)
      .sort()
      .map(function (item) {
        var entry = b2cs[item];
        return {
          sply_ty: entry.inter ? 'INTER' : 'INTRA',
          rt: entry.rt,
          typ: 'OE',
          pos: entry.pos,
          txval: toRupees_(entry.v.txval),
          iamt: toRupees_(entry.v.igst),
          camt: toRupees_(entry.v.cgst),
          samt: toRupees_(entry.v.sgst),
          csamt: toRupees_(entry.v.cess)
        };
      });
  }
  /** table 8: the four GSTN buckets of nil / exempt / non-GST, in rupees */
  function nilJson_(nilBuckets) {
    return {
      inv: Object.keys(nilBuckets)
        .sort()
        .map(function (item) {
          var bucket = nilBuckets[item];
          return {
            sply_ty: bucket.sply_ty,
            expt_amt: toRupees_(bucket.expt_amt),
            nil_amt: toRupees_(bucket.nil_amt),
            ngsup_amt: toRupees_(bucket.ngsup_amt)
          };
        })
    };
  }
  /** table 12: the HSN summary rows, in rupees */
  function hsnJson_(hsnRows) {
    return {
      data: Object.keys(hsnRows)
        .sort()
        .map(function (item, index) {
          var summary = hsnRows[item];
          return {
            num: index + 1,
            hsn_sc: summary.hsn_sc,
            desc: summary.desc,
            uqc: summary.uqc,
            qty: summary.qty,
            val: toRupees_(summary.val),
            txval: toRupees_(summary.txval),
            rt: summary.rt,
            iamt: toRupees_(summary.iamt),
            camt: toRupees_(summary.camt),
            samt: toRupees_(summary.samt),
            csamt: toRupees_(summary.csamt)
          };
        })
    };
  }
  /** the document number of the n-th of a series, padded to the series' width */
  function seriesRef_(series, width, number) {
    return series.prefix + String(number).padStart(width, '0');
  }
  /** one series' row of table 13 — first, last, cancelled and the numbers not supplied (at most 50) — and a warning when some are missing */
  function seriesRow_(book, series, position) {
    var list = series.docs.map(function (entry) {
        return entry.n;
      }),
      lowest = list.reduce(function (least, entry) {
        return entry < least ? entry : least;
      }),
      highest = list.reduce(function (most, entry) {
        return entry > most ? entry : most;
      }),
      seen = keyedMap_();
    list.forEach(function (entry) {
      seen[entry] = 1;
    });
    var width = (seriesOf_(series.docs[0].ref) || {}).width;
    var cancel = series.docs.filter(function (entry) {
        return entry.cancelled;
      }).length,
      missing = [];
    /* every step is a number the series holds or one it skipped (at most 50), so the walk can never pass list.length + 50 steps */
    for (var number = lowest, steps = 0; number <= highest && missing.length < 50 && steps < list.length + 50; number++, steps++)
      if (!seen[number]) missing.push(seriesRef_(series, width, number));
    var first = seriesRef_(series, width, lowest),
      last = seriesRef_(series, width, highest);
    if (missing.length) book.warnings.push(missingWarning_(missing, first, last));
    var issued = Number(highest - lowest + BigInt(1));
    return { num: position, from: first, to: last, totnum: issued, cancel: cancel, net_issue: issued - cancel, unaccounted: missing };
  }
  /** the sentence a filer reads on table 13 when document numbers had to be left out of it */
  function table13Why_(omitted) {
    return (
      'Table 13 is incomplete: ' +
      omitted.length +
      ' document number(s) are longer than ' +
      SERIAL_MAX_LENGTH +
      ' characters, which CGST Rules 46(b) does not allow for a serial number (' +
      omitted.slice(0, 3).join(', ') +
      (omitted.length > 3 ? ', …' : '') +
      '). They are left out of this table only; their tax is in the other tables and in GSTR-3B. Renumber them or list them by hand before filing.'
    );
  }
  /** the warning for numbers a series skipped */
  function missingWarning_(missing, first, last) {
    return (
      'documents issued: ' +
      missing.length +
      (missing.length === 50 ? '+' : '') +
      ' number(s) in ' +
      first +
      '…' +
      last +
      ' were not supplied (' +
      missing.slice(0, 3).join(', ') +
      (missing.length > 3 ? ', …' : '') +
      ') — counted as issued, neither cancelled nor listed'
    );
  }
  /** table 13: documents issued, by nature (invoices, then debit notes, then credit notes) and series */
  function docIssueJson_(book) {
    var docDet = [],
      num = 0;
    ['Invoices for outward supply', 'Debit Note', 'Credit Note'].forEach(function (nature) {
      var docs = [];
      Object.keys(book.issued)
        .sort()
        .forEach(function (item) {
          var series = book.issued[item];
          if (series.nature === nature) docs.push(seriesRow_(book, series, docs.length + 1));
        });
      if (docs.length) docDet.push({ doc_num: ++num, doc_typ: nature, docs: docs });
    });
    return { doc_det: docDet };
  }
  /** the GSTN offline-tool JSON of the month from the working books */
  function gstr1Json_(book, context, options) {
    if (book.zeroRated) book.warnings.push(book.zeroRated + ' zero-rated (export / SEZ) document(s) left out of GSTR-1: Table 6 is not built here');
    if (book.missingHsn) book.warnings.push(book.missingHsn + ' line(s) carry no HSN — shown under an empty HSN in the summary');
    var json = { gstin: context.gstin, fp: filingPeriod_(context.month) };
    if (options.schema_version) json.version = options.schema_version;
    json.b2b = groupsJson_(book.b2b, 'ctin', 'inv');
    json.b2cl = groupsJson_(book.b2cl, 'pos', 'inv');
    json.b2cs = b2csJson_(book.b2cs);
    json.cdnr = groupsJson_(book.cdnr, 'ctin', 'nt');
    json.cdnur = book.cdnur;
    json.nil = nilJson_(book.nil);
    json.hsn = hsnJson_(book.hsn);
    json.doc_issue = docIssueJson_(book);
    return json;
  }

  /**
   * ⭐ gstr1({ gstin, month: 'YYYY-MM', documents, schema_version?, b2cl_limit? }) → { ok, gstin, month, json, tables, warnings, summary }
   * `json` is shaped like the GSTN offline tool's GSTR-1 file; `tables` is the same figures as simple rows (gstr1Table). Outward
   * documents of the month only (kind invoice / credit_note / debit_note); inward ones are ignored here.
   */
  function gstr1(opts) {
    var context = ctx_(opts);
    if (!context.ok) return context;
    var limit = opts.b2cl_limit != null ? Number(opts.b2cl_limit) : limitFor_(context.month).limit;
    var book = newBook_(limit);
    context.docs.forEach(function (entry) {
      addOutward_(book, context.month, entry);
    });
    var json = gstr1Json_(book, context, opts);
    var summary = book.summary;
    var shown = { invoices: summary.invoices, notes: summary.notes, taxable: toRupees_(summary.taxable), tax: toRupees_(summary.tax) };
    var result = { ok: true, gstin: context.gstin, month: context.month, b2cl_limit: limit, json: json, warnings: book.warnings, summary: shown };
    if (book.omitted13.length) result.table13 = { incomplete: true, omitted: book.omitted13, why: table13Why_(book.omitted13) };
    result.tables = gstr1Table(result);
    return result;
  }
  /** a small B2C sale (or the note netting it off) into the B2CS rows, per supply type, place of supply and rate */
  function addB2cs_(b2cs, inter, pos, rows, sign) {
    Object.keys(rows).forEach(function (item) {
      var key = (inter ? 'INTER' : 'INTRA') + '|' + pos + '|' + String(Number(item) + 1000).slice(1),
        entry = (b2cs[key] = b2cs[key] || { inter: inter, pos: pos, rt: Number(item), v: emptyTotals_() });
      addInto_(entry.v, rows[item], sign);
    });
  }

  var RATE_HEADS = ['Rate %', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess'];
  /** the six figures of a GSTN item: rate, taxable, IGST, CGST, SGST, cess */
  function rateCells_(detail) {
    return [detail.rt, detail.txval, detail.iamt, detail.camt, detail.samt, detail.csamt];
  }
  /** table 4: one row per item of each B2B invoice */
  function b2bTable_(json) {
    var rows = [];
    json.b2b.forEach(function (group) {
      group.inv.forEach(function (invoice) {
        invoice.itms.forEach(function (item) {
          rows.push([group.ctin, invoice.inum, invoice.idt, invoice.val, invoice.pos].concat(rateCells_(item.itm_det)));
        });
      });
    });
    return { id: 'b2b', title: '4 · B2B invoices', header: ['GSTIN', 'Invoice', 'Date', 'Value', 'POS'].concat(RATE_HEADS), rows: rows };
  }
  /** table 5: one row per item of each B2C-large invoice */
  function b2clTable_(json, limit) {
    var rows = [];
    json.b2cl.forEach(function (group) {
      group.inv.forEach(function (invoice) {
        invoice.itms.forEach(function (item) {
          rows.push([group.pos, invoice.inum, invoice.idt, invoice.val].concat(rateCells_(item.itm_det)));
        });
      });
    });
    return {
      id: 'b2cl',
      title: '5 · B2C large (inter-state, over ' + limit + ')',
      header: ['POS', 'Invoice', 'Date', 'Value'].concat(RATE_HEADS),
      rows: rows
    };
  }
  /** table 7: the B2C-small rows */
  function b2csTable_(json) {
    return {
      id: 'b2cs',
      title: '7 · B2C small, by place of supply and rate',
      header: ['Supply', 'POS'].concat(RATE_HEADS),
      rows: json.b2cs.map(function (item) {
        return [item.sply_ty, item.pos].concat(rateCells_({ rt: item.rt, txval: item.txval, iamt: item.iamt, camt: item.camt, samt: item.samt, csamt: item.csamt }));
      })
    };
  }
  /** table 9B: credit / debit notes to registered buyers, then to unregistered ones */
  function notesTable_(json) {
    var rows = [];
    json.cdnr.forEach(function (group) {
      group.nt.forEach(function (note) {
        note.itms.forEach(function (item) {
          rows.push([group.ctin, note.ntty, note.nt_num, note.nt_dt, note.val, note.pos].concat(rateCells_(item.itm_det)));
        });
      });
    });
    json.cdnur.forEach(function (note) {
      note.itms.forEach(function (item) {
        rows.push(['(unregistered)', note.ntty, note.nt_num, note.nt_dt, note.val, note.pos].concat(rateCells_(item.itm_det)));
      });
    });
    return {
      id: 'cdn',
      title: '9B · Credit / debit notes (CDNR, CDNUR)',
      header: ['GSTIN', 'C/D', 'Note', 'Date', 'Value', 'POS'].concat(RATE_HEADS),
      rows: rows
    };
  }
  /** table 8: nil-rated, exempt and non-GST */
  function nilTable_(json) {
    return {
      id: 'nil',
      title: '8 · Nil-rated, exempt and non-GST',
      header: ['Supply', 'Exempt', 'Nil rated', 'Non-GST'],
      rows: json.nil.inv.map(function (item) {
        return [item.sply_ty, item.expt_amt, item.nil_amt, item.ngsup_amt];
      })
    };
  }
  /** table 12: the HSN summary */
  function hsnTable_(json) {
    return {
      id: 'hsn',
      title: '12 · HSN summary',
      header: ['HSN', 'UQC', 'Qty', 'Value', 'Taxable', 'Rate %', 'IGST', 'CGST', 'SGST', 'Cess'],
      rows: json.hsn.data.map(function (item) {
        return [item.hsn_sc, item.uqc, item.qty, item.val, item.txval, item.rt, item.iamt, item.camt, item.samt, item.csamt];
      })
    };
  }
  /** table 13: documents issued */
  function docsTable_(result) {
    var json = result.json,
      rows = [];
    json.doc_issue.doc_det.forEach(function (group) {
      group.docs.forEach(function (series) {
        rows.push([group.doc_typ, series.from, series.to, series.totnum, series.cancel, series.net_issue]);
      });
    });
    var table = { id: 'docs', title: '13 · Documents issued', header: ['Nature', 'From', 'To', 'Total', 'Cancelled', 'Net issued'], rows: rows };
    if (result.table13 && result.table13.incomplete) {
      table.incomplete = true;
      rows.push(['⚠ ' + result.table13.why, '', '', '', '', '']);
    }
    return table;
  }

  /** the GSTR-1 as simple tables: [{ id, title, header: [...], rows: [[...]] }] — what a screen paints and a CSV writes */
  function gstr1Table(result) {
    var json = result.json,
      list = [];
    list.push(b2bTable_(json));
    list.push(b2clTable_(json, result.b2cl_limit));
    list.push(b2csTable_(json));
    list.push(notesTable_(json));
    list.push(nilTable_(json));
    list.push(hsnTable_(json));
    list.push(docsTable_(result));
    return list;
  }

  /* ── GSTR-3B ───────────────────────────────────────────────────────────────────────────────────────────────────── */
  /** the four heads of a figure set, each through `convert` when given (a missing head is 0) */
  function headsOf_(source, convert) {
    var out = {};
    HEADS4.forEach(function (item) {
      out[item] = convert ? convert(source[item] || 0) : source[item] || 0;
    });
    return out;
  }
  /** a five-figure set (taxable and the four heads) as rupees */
  function rupeeLine_(figures) {
    return {
      txval: toRupees_(figures.txval),
      igst: toRupees_(figures.igst),
      cgst: toRupees_(figures.cgst),
      sgst: toRupees_(figures.sgst),
      cess: toRupees_(figures.cess)
    };
  }

  /** the empty working sheet of one GSTR-3B month: 3.1 (a)-(e), 3.2, the ITC buckets of 4, the exempt inward of 5 */
  function newSheet_() {
    return {
      warnings: [],
      outward: emptyTotals_(),
      zeroRated: emptyTotals_(),
      nilExempt: emptyTotals_(),
      reverseCharge: emptyTotals_(),
      nonGst: emptyTotals_(),
      unregistered: keyedMap_(),
      itcOther: emptyTotals_(),
      itcReverse: emptyTotals_(),
      reversedOthers: emptyTotals_(),
      reversedRules: emptyTotals_(),
      ineligible: emptyTotals_(),
      blockedList: [],
      inward5: { intra_exempt: 0, intra_nongst: 0, inter_exempt: 0, inter_nongst: 0 }
    };
  }
  /** an outward document into 3.1 (a) taxable, (b) zero-rated, (c) nil / exempt, (e) non-GST, and 3.2 inter-state to the unregistered */
  function postOutward_(sheet, doc, read) {
    var sign = OUTWARD[doc.kind];
    if (doc.zero_rated) {
      Object.keys(read.rows).forEach(function (item) {
        addInto_(sheet.zeroRated, read.rows[item], sign);
      });
      sheet.warnings.push(doc.ref + ': zero-rated — in 3.1(b); GSTR-1 Table 6 is not built here');
      return;
    }
    Object.keys(read.rows).forEach(function (item) {
      var row = read.rows[item];
      if (!Number(item)) {
        /* 3.1(c) nil / exempt · 3.1(e) non-GST — per line where the slab said its word (v1.72.0), the rest by the document's */
        nilSplit_(read, doc.nil_kind).forEach(function (part) {
          addInto_(part.kind === 'non_gst' ? sheet.nonGst : sheet.nilExempt, { txval: part.txval }, sign);
        });
        return;
      }
      addInto_(sheet.outward, row, sign);
      if (read.supply === 'inter' && !read.gstin) {
        var place = (sheet.unregistered[read.pos] = sheet.unregistered[read.pos] || { txval: 0, igst: 0 });
        place.txval += sign * row.txval;
        place.igst += sign * row.igst;
      }
    });
  }
  /** the line numbers a purchase marks as blocked credit ('all' = every line), each with its reason */
  function blockedLines_(doc, read) {
    var blocked = keyedMap_();
    callListed_(doc.blocked || [], 'forEach', '(dd.blocked || [])', function (item) {
      if (item && item.line === 'all')
        read.lines.forEach(function (_, index) {
          blocked[index] = item.reason;
        });
      else if (item) blocked[item.line] = item.reason;
    });
    return blocked;
  }
  /** one blocked-credit line for 3.4's list: its reason, the section that reason names (or null) and the tax held back, in rupees */
  function blockedEntry_(ref, line, reason, item, cess) {
    return {
      ref: ref,
      line: line,
      reason: reason,
      section: sectionOfReason_(reason),
      known: !!sectionOfReason_(reason),
      igst: toRupees_(item.igst),
      cgst: toRupees_(item.cgst),
      sgst: toRupees_(item.sgst),
      cess: toRupees_(cess)
    };
  }
  /** a purchase line's ITC: blocked (ineligible, listed with its reason), else 4(A)(5) — or 4(A)(3) and 3.1(d) under reverse charge */
  function postItcLine_(sheet, doc, blocked, reverseCharge, item, index) {
    var amounts = { txval: item.txval, igst: item.igst, cgst: item.cgst, sgst: item.sgst, cess: item.cess };
    if (!item.igst && !item.cgst && !item.sgst && !item.cess) return;
    if (Object.prototype.hasOwnProperty.call(blocked, index)) {
      var reason = blocked[index] || 'blocked';
      addInto_(sheet.ineligible, amounts, 1);
      sheet.blockedList.push(blockedEntry_(doc.ref, index, reason, item, item.cess));
      if (!sectionOfReason_(reason))
        sheet.warnings.push(doc.ref + ' line ' + (index + 1) + ': blocked for "' + reason + '", a reason the engine has no section for — excluded all the same');
      return;
    }
    addInto_(reverseCharge ? sheet.itcReverse : sheet.itcOther, amounts, 1);
    if (reverseCharge) addInto_(sheet.reverseCharge, amounts, 1);
  }
  /**
   * v1.20.0 — reverse charge read from the frozen invoice's RCM heads: the liability is 3.1(d) always (cash only); the credit is 4(A)(3)
   * only when the notification's rate option allows it and the line is not blocked (s.17(5))
   */
  function postRcmLine_(sheet, doc, blocked, item) {
    var amounts = { txval: item.txval, igst: item.igst, cgst: item.cgst, sgst: item.sgst, cess: 0 };
    addInto_(sheet.reverseCharge, amounts, 1);
    if (Object.prototype.hasOwnProperty.call(blocked, item.line)) {
      var reason = blocked[item.line] || 'blocked';
      addInto_(sheet.ineligible, amounts, 1);
      sheet.blockedList.push(blockedEntry_(doc.ref, item.line, reason, item, 0));
      return;
    }
    if (item.itc) addInto_(sheet.itcReverse, amounts, 1);
  }
  /** an inward document: a purchase return reverses ITC (4B(2)); a purchase feeds 5, 4(A) and 4(D) */
  function postInward_(sheet, doc, read) {
    if (doc.kind === 'purchase_return') {
      Object.keys(read.rows).forEach(function (item) {
        addInto_(sheet.reversedOthers, read.rows[item], 1);
      });
      return;
    }
    var zero = read.rows[0];
    if (zero && zero.txval) sheet.inward5[(read.supply === 'inter' ? 'inter_' : 'intra_') + (doc.non_gst ? 'nongst' : 'exempt')] += zero.txval;
    var blocked = blockedLines_(doc, read);
    var reverseCharge = !!doc.rcm || read.rcm;
    read.lines.forEach(function (item, index) {
      postItcLine_(sheet, doc, blocked, reverseCharge, item, index);
    });
    read.rcmLines.forEach(function (item) {
      postRcmLine_(sheet, doc, blocked, item);
    });
  }
  /** one document of the month into the working sheet */
  function postDocument_(sheet, month, entry) {
    var doc = entry.doc;
    if (periodOf_(doc) !== month || doc.cancelled) return;
    var read = entry.read;
    if (read.supply !== 'intra' && read.supply !== 'inter') {
      sheet.warnings.push(doc.ref + ': no supply type (' + read.supply + ') — left out');
      return;
    }
    if (doc.kind in OUTWARD) postOutward_(sheet, doc, read);
    else postInward_(sheet, doc, read);
  }
  /** a refusal when a supplied ITC reversal has no reason — a reversal is never anonymous; else null */
  function unnamedReversal_(opts) {
    for (var count = 0; count < (opts.itc_reversals || []).length; count++)
      if (!opts.itc_reversals[count] || !opts.itc_reversals[count].reason)
        return refuse_('itc_reversals[' + count + '] needs its reason — a reversal is never anonymous.');
    return null;
  }
  /** the supplied reversals (worked elsewhere, as data) into 4B(1) when a named rule, else 4B(2) */
  function postReversals_(sheet, opts) {
    callListed_(opts.itc_reversals || [], 'forEach', '(o.itc_reversals || [])', function (item) {
      var amounts = { txval: 0, igst: toPaise_(item.igst), cgst: toPaise_(item.cgst), sgst: toPaise_(item.sgst), cess: toPaise_(item.cess) };
      addInto_(['38', '42', '43', '17(5)'].indexOf(String(item.rule)) >= 0 ? sheet.reversedRules : sheet.reversedOthers, amounts, 1);
    });
  }
  /** the ITC in 4: available (A), reversed (B) and net (A − B) per head, in paise */
  function itcTotals_(sheet) {
    var available = emptyTotals_();
    addInto_(available, sheet.itcOther, 1);
    addInto_(available, sheet.itcReverse, 1);
    var reversed = emptyTotals_();
    addInto_(reversed, sheet.reversedRules, 1);
    addInto_(reversed, sheet.reversedOthers, 1);
    var netCredit = emptyTotals_();
    HEADS4.forEach(function (item) {
      netCredit[item] = available[item] - reversed[item];
    });
    return { available: available, reversed: reversed, net: netCredit };
  }
  /** the ITC each head can use this month (opening + net, never below 0), warning where reversals exceed it */
  function availableItc_(opening, netCredit, warnings) {
    var avail = {};
    HEADS4.forEach(function (item) {
      avail[item] = Math.max(0, opening[item] + netCredit[item]);
      if (opening[item] + netCredit[item] < 0)
        warnings.push(
          '4: reversals exceed the ITC available in ' +
            item.toUpperCase() +
            ' by ' +
            toRupees_(-(opening[item] + netCredit[item])) +
            ' — the excess is not carried as a negative credit'
        );
    });
    return avail;
  }
  /** the output tax each head owes (3.1 a + b, never below 0), warning where credit notes exceed it */
  function payableTax_(sheet) {
    var payable = {};
    HEADS4.forEach(function (item) {
      payable[item] = Math.max(0, sheet.outward[item] + sheet.zeroRated[item]);
    });
    return payable;
  }
  /** a warning per head whose credit notes exceed its output tax */
  function creditNoteWarnings_(sheet) {
    HEADS4.forEach(function (item) {
      if (sheet.outward[item] + sheet.zeroRated[item] < 0)
        sheet.warnings.push(
          '3.1: credit notes exceed the output tax in ' +
            item.toUpperCase() +
            ' by ' +
            toRupees_(-(sheet.outward[item] + sheet.zeroRated[item])) +
            ' — payable shown as nil, the excess is not carried'
        );
    });
  }
  /** the ITC used per head and which head paid for which, from posting's set-off lines (cess pays only cess) */
  function usedByHead_(utilised, cessUsed) {
    var usedBy = {};
    utilised.forEach(function (item) {
      usedBy[item.from] = usedBy[item.from] || {};
      usedBy[item.from][item.against] = (usedBy[item.from][item.against] || 0) + toPaise_(item.amount);
    });
    if (cessUsed) {
      usedBy.cess = { cess: cessUsed };
    }
    return usedBy;
  }
  /** each head's ITC used, in paise, from posting's set-off lines; cess is what was set off against cess */
  function itcUsedOf_(utilised, cessUsed) {
    var itcUsed = {};
    HEADS4.forEach(function (item) {
      itcUsed[item] = 0;
    });
    utilised.forEach(function (item) {
      itcUsed[item.against] += toPaise_(item.amount);
    });
    itcUsed.cess = cessUsed;
    return itcUsed;
  }
  /** 6.1 — forward-charge tax is set off against ITC by posting.gstSetOff (s.49 order); reverse-charge tax is cash only. A refusal, or the figures in paise */
  function settle_(sheet, credit, opts, context, posting) {
    var opening = headsOf_(opts.opening_itc || {}, toPaise_);
    var payable = payableTax_(sheet);
    var rcmCash = headsOf_(sheet.reverseCharge);
    var avail = availableItc_(opening, credit.net, sheet.warnings);
    creditNoteWarnings_(sheet);
    var setOff = posting.gstSetOff({
      country: COUNTRY_ /* GSTR-3B is India's return by definition — named here, not defaulted (CTRY-94) */,
      ref: opts.ref || 'GSTR3B-' + context.month,
      date: null,
      period: context.month,
      output: { cgst: toRupees_(payable.cgst), sgst: toRupees_(payable.sgst), igst: toRupees_(payable.igst) },
      input: { cgst: toRupees_(avail.cgst), sgst: toRupees_(avail.sgst), igst: toRupees_(avail.igst) }
    });
    if (!setOff.ok) return refuse_(setOff.why);
    var cessUsed = Math.min(avail.cess, payable.cess),
      cash = {},
      carried = {};
    HEADS.forEach(function (item) {
      cash[item] = toPaise_(setOff.payable[item]) + rcmCash[item];
      carried[item] = toPaise_(setOff.carried[item]);
    });
    cash.cess = payable.cess - cessUsed + rcmCash.cess;
    carried.cess = avail.cess - cessUsed;
    return {
      opening: opening,
      avail: avail,
      cash: cash,
      carried: carried,
      utilised: setOff.utilised,
      usedBy: usedByHead_(setOff.utilised, cessUsed),
      itcUsed: itcUsedOf_(setOff.utilised, cessUsed)
    };
  }
  /** a map of head → head → paise as rupees, in place */
  function usedByInRupees_(usedBy) {
    Object.keys(usedBy).forEach(function (item) {
      Object.keys(usedBy[item]).forEach(function (head) {
        usedBy[item][head] = toRupees_(usedBy[item][head]);
      });
    });
    return usedBy;
  }
  /** 3.2: inter-state supplies to unregistered buyers by place of supply, in rupees */
  function unregisteredRows_(unregistered) {
    return Object.keys(unregistered)
      .sort()
      .map(function (place) {
        return { pos: place, txval: toRupees_(unregistered[place].txval), igst: toRupees_(unregistered[place].igst) };
      });
  }
  /** section 4 of the answer: ITC available, reversed, net and ineligible, in rupees */
  function section4_(sheet, credit) {
    return {
      available: { reverse_charge: rupeeLine_(sheet.itcReverse), other: rupeeLine_(sheet.itcOther), total: headsOf_(credit.available, toRupees_) },
      reversed: {
        rules_and_17_5: headsOf_(sheet.reversedRules, toRupees_),
        others: headsOf_(sheet.reversedOthers, toRupees_),
        total: headsOf_(credit.reversed, toRupees_)
      },
      net: headsOf_(credit.net, toRupees_),
      ineligible: { other: headsOf_(sheet.ineligible, toRupees_), blocked: sheet.blockedList }
    };
  }
  /** section 6.1 of the answer: tax payable, ITC opening / used / carried, cash — in rupees; interest and late fee start at 0 */
  function section61_(sheet, paid) {
    var out = sheet.outward,
      zero = sheet.zeroRated,
      reverse = sheet.reverseCharge;
    var cashTotal = HEADS4.reduce(function (total, item) {
      return total + paid.cash[item];
    }, 0);
    return {
      tax_payable: headsOf_(
        { igst: out.igst + zero.igst + reverse.igst, cgst: out.cgst + zero.cgst + reverse.cgst, sgst: out.sgst + zero.sgst + reverse.sgst, cess: out.cess + zero.cess + reverse.cess },
        toRupees_
      ),
      itc_opening: headsOf_(paid.opening, toRupees_),
      itc_available: headsOf_(paid.avail, toRupees_),
      itc_utilised: paid.utilised,
      itc_used_by_head: headsOf_(paid.itcUsed, toRupees_),
      itc_used_from: paid.usedBy,
      cash: headsOf_(paid.cash, toRupees_),
      cash_total: toRupees_(cashTotal),
      itc_carried: headsOf_(paid.carried, toRupees_),
      interest: 0,
      late_fee: 0
    };
  }
  /** the answer of gstr3b: sections 3.1 to 6.1 in rupees, the warnings, and the same figures as tables */
  function gstr3bAnswer_(sheet, credit, paid, context) {
    var answer = {
      ok: true,
      gstin: context.gstin,
      month: context.month,
      warnings: sheet.warnings,
      s3_1: {
        a: rupeeLine_(sheet.outward),
        b: rupeeLine_(sheet.zeroRated),
        c: { txval: toRupees_(sheet.nilExempt.txval) },
        d: rupeeLine_(sheet.reverseCharge),
        e: { txval: toRupees_(sheet.nonGst.txval) }
      },
      s3_2: { unregistered: unregisteredRows_(sheet.unregistered) },
      s4: section4_(sheet, credit),
      s5: {
        intra_exempt: toRupees_(sheet.inward5.intra_exempt),
        intra_non_gst: toRupees_(sheet.inward5.intra_nongst),
        inter_exempt: toRupees_(sheet.inward5.inter_exempt),
        inter_non_gst: toRupees_(sheet.inward5.inter_nongst)
      },
      s6_1: section61_(sheet, paid)
    };
    usedByInRupees_(paid.usedBy);
    answer.tables = gstr3bTable(answer);
    return answer;
  }

  /**
   * ⭐ gstr3b({ gstin, month, documents, opening_itc?, itc_reversals?, ref? }) → { ok, s3_1, s3_2, s4, s5, s6_1, warnings, tables }
   *   opening_itc    { igst, cgst, sgst, cess } the unused ITC brought in (the electronic credit ledger's opening), rupees
   *   itc_reversals  [{ reason, rule: '38'|'42'|'43'|'17(5)'|'other', igst, cgst, sgst, cess }] — reversals worked elsewhere, as DATA
   * 6.1 sets the month's ITC off against its tax by posting.gstSetOff — the statutory order — and what is left is cash.
   * Reverse-charge tax (3.1(d)) is cash only; its ITC (4A(3)) is available the same month.
   */
  function gstr3b(opts) {
    var context = ctx_(opts);
    if (!context.ok) return context;
    var posting = postingEngine_();
    if (!posting || !posting.gstSetOff) return refuse_('gst-returns needs the posting engine (gstSetOff) for the s.49 order.');
    var sheet = newSheet_();
    context.docs.forEach(function (entry) {
      postDocument_(sheet, context.month, entry);
    });
    var unnamed = unnamedReversal_(opts);
    if (unnamed) return unnamed;
    postReversals_(sheet, opts);
    var credit = itcTotals_(sheet);
    var paid = settle_(sheet, credit, opts, context, posting);
    if (paid.ok === false) return paid;
    return gstr3bAnswer_(sheet, credit, paid, context);
  }

  /** the figures of a five-column GSTR-3B row: taxable, IGST, CGST, SGST, cess */
  function fiveCells_(figures) {
    return [figures.txval, figures.igst, figures.cgst, figures.sgst, figures.cess];
  }
  /** the four head figures of a row: IGST, CGST, SGST, cess */
  function headCells_(figures) {
    return [figures.igst, figures.cgst, figures.sgst, figures.cess];
  }
  /** table 3.1: outward supplies and inward supplies liable to reverse charge */
  function table31_(section) {
    return {
      id: '3.1',
      title: '3.1 · Outward supplies and inward supplies liable to reverse charge',
      header: ['Nature', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess'],
      rows: [
        ['(a) Outward taxable (other than zero rated, nil rated, exempt)'].concat(fiveCells_(section.a)),
        ['(b) Outward taxable, zero rated'].concat(fiveCells_(section.b)),
        ['(c) Other outward (nil rated, exempt)', section.c.txval, 0, 0, 0, 0],
        ['(d) Inward liable to reverse charge'].concat(fiveCells_(section.d)),
        ['(e) Non-GST outward', section.e.txval, 0, 0, 0, 0]
      ]
    };
  }
  /** table 4: eligible ITC */
  function table4_(section) {
    return {
      id: '4',
      title: '4 · Eligible ITC',
      header: ['Detail', 'IGST', 'CGST', 'SGST', 'Cess'],
      rows: [
        ['(A)(3) Reverse charge'].concat(headCells_(section.available.reverse_charge)),
        ['(A)(5) All other ITC'].concat(headCells_(section.available.other)),
        ['(B)(1) Reversed: Rules 38, 42, 43, s.17(5)'].concat(headCells_(section.reversed.rules_and_17_5)),
        ['(B)(2) Reversed: others (incl. purchase returns)'].concat(headCells_(section.reversed.others)),
        ['(C) Net ITC available'].concat(headCells_(section.net)),
        ['(D)(2) Ineligible (s.17(5) and others)'].concat(headCells_(section.ineligible.other))
      ]
    };
  }
  /** table 6.1: payment of tax */
  function table61_(payment) {
    return {
      id: '6.1',
      title: '6.1 · Payment of tax',
      header: ['Detail', 'IGST', 'CGST', 'SGST', 'Cess'],
      rows: [
        ['Tax payable'].concat(headCells_(payment.tax_payable)),
        ['Paid through ITC'].concat(headCells_(payment.itc_used_by_head)),
        ['Paid in cash'].concat(headCells_(payment.cash)),
        ['ITC carried forward'].concat(headCells_(payment.itc_carried))
      ]
    };
  }
  /** the GSTR-3B as simple tables */
  function gstr3bTable(result) {
    var section31 = result.s3_1,
      section4 = result.s4,
      payment = result.s6_1;
    return [
      table31_(section31),
      {
        id: '3.2',
        title: '3.2 · Inter-state supplies to unregistered persons, by place of supply',
        header: ['POS', 'Taxable', 'IGST'],
        rows: result.s3_2.unregistered.map(function (item) {
          return [item.pos, item.txval, item.igst];
        })
      },
      table4_(section4),
      {
        id: '5',
        title: '5 · Exempt, nil-rated and non-GST inward supplies',
        header: ['Nature', 'Inter-state', 'Intra-state'],
        rows: [
          ['Exempt / nil rated', result.s5.inter_exempt, result.s5.intra_exempt],
          ['Non-GST', result.s5.inter_non_gst, result.s5.intra_non_gst]
        ]
      },
      table61_(payment)
    ];
  }

  /**
   * ⭐ series({ gstin, months: ['2026-04', …], documents, opening_itc?, itc_reversals?, paid_on? }) → { ok, returns: [gstr3b…], carried }
   * Each month's unused ITC is the next month's opening. `itc_reversals` may carry a `month` to say which month it belongs to.
   * `paid_on`: { 'YYYY-MM': 'YYYY-MM-DD' } the day each month's cash was paid — when given, s.50 interest is worked into 6.1.
   */
  function series(opts) {
    var options = opts || {},
      out = [],
      carry = options.opening_itc || {},
      paidOn = options.paid_on || {};
    for (var index = 0; index < (options.months || []).length; index++) {
      var month = options.months[index];
      var result = gstr3b({
        gstin: options.gstin,
        month: month,
        documents: options.documents,
        opening_itc: carry,
        ref: options.ref,
        itc_reversals: callListed_(options.itc_reversals || [], 'filter', '(o.itc_reversals || [])', function (entry) {
          return !entry.month || entry.month === month;
        })
      });
      if (!result.ok) return result;
      if (paidOn[month]) addInterest_(result, month, paidOn[month]);
      if (options.late_fee) addLateFee_(result, month, options.late_fee);
      out.push(result);
      carry = result.s6_1.itc_carried;
    }
    return { ok: true, returns: out, carried: carry };
  }
  /**
   * the s.47 late fee of a month, worked into its 6.1 when the caller gave the pack, the day filed and (unless nil) the preceding year's turnover:
   * options.late_fee = { pack, filed_on: { 'YYYY-MM': day }, nil: { 'YYYY-MM': true }, turnover_minor }. Anything missing leaves late_fee at 0, as before (lateFeeFor says why when asked directly).
   */
  function addLateFee_(result, month, given) {
    var filedOn = given.filed_on && given.filed_on[month];
    if (!filedOn) return;
    var lateFee = lateFeeFor(given.pack, { period: month, filed_on: filedOn, nil: !!(given.nil && given.nil[month]), turnover_minor: given.turnover_minor });
    if (lateFee.ok) {
      result.s6_1.late_fee = lateFee.fee;
      result.s6_1.late_fee_days = lateFee.days;
    }
  }
  /** s.50 interest on a month's net cash liability, worked into its 6.1 when the payment day is a good date */
  function addInterest_(result, month, paidOn) {
    var interest = interestFor({ cash_liability: result.s6_1.cash_total, due_date: dueDate(month), paid_on: paidOn });
    if (interest.ok) {
      result.s6_1.interest = interest.interest;
      result.s6_1.interest_days = interest.days;
    }
  }

  /* ── reconcile ─────────────────────────────────────────────────────────────────────────────────────────────────── */
  var LEDGER_LINES = { output: 'output tax', input: 'input tax credit', paid: 'tax paid in cash', setoff: 'credit set off' };
  /** the Ledger's figure in paise, or null when it was not given */
  function ledgerFigure_(value) {
    return value == null ? null : toPaise_(value);
  }
  /** the words after a difference in the input line when the Ledger holds s.17(5) blocked credit the return left out */
  function blockedHint_(key, inBlocked, ledgerPaise, returnPaise) {
    if (key === 'input' && inBlocked && ledgerPaise - returnPaise === inBlocked)
      return ' — the Ledger holds ' + toRupees_(inBlocked) + ' of s.17(5) blocked credit that the return does not claim';
    if (key === 'input' && inBlocked && ledgerPaise - returnPaise > 0)
      return ' — of which ' + toRupees_(Math.min(inBlocked, ledgerPaise - returnPaise)) + ' may be the blocked credit the return excludes';
    return '';
  }
  /** one named difference between the return and the Ledger */
  function differenceRow_(head, key, month, figure, diff, hint) {
    return {
      head: head,
      line: key,
      return: toRupees_(figure.ret),
      ledger: toRupees_(figure.led),
      diff: toRupees_(diff),
      name:
        head.toUpperCase() +
        ' ' +
        LEDGER_LINES[key] +
        ' (' +
        month +
        '): the return shows ' +
        toRupees_(figure.ret).toFixed(2) +
        ', the Ledger ' +
        toRupees_(figure.led).toFixed(2) +
        ', a difference of ' +
        toRupees_(diff).toFixed(2) +
        hint
    };
  }
  /** one head's four comparisons (output, input, paid, set-off): the return's and the Ledger's figures in paise, and the blocked credit held back */
  function headFigures_(returned, ledgerHead, blocked, head) {
    var outPaise = toPaise_(returned.s6_1.tax_payable[head]),
      inPaise = toPaise_(returned.s4.net[head]),
      inBlocked = toPaise_(blocked[head]),
      paidPaise = toPaise_(returned.s6_1.cash[head]),
      usedPaise = toPaise_(returned.s6_1.itc_used_by_head[head]);
    return {
      inBlocked: inBlocked,
      figures: {
        output: { ret: outPaise, led: ledgerFigure_(ledgerHead.output) },
        input: { ret: inPaise, led: ledgerFigure_(ledgerHead.input) },
        paid: { ret: paidPaise, led: ledgerFigure_(ledgerHead.paid) },
        setoff: { ret: usedPaise, led: ledgerFigure_(ledgerHead.setoff) }
      }
    };
  }
  /** one head compared with the Ledger: its figures per line into `found.heads`, each difference into `found.diffs` */
  function reconcileHead_(returned, ledger, blocked, head, found) {
    var ledgerHead = ledger[head] || {};
    var compared = headFigures_(returned, ledgerHead, blocked, head);
    var figures = compared.figures;
    found.heads[head] = {};
    Object.keys(figures).forEach(function (key) {
      var figure = figures[key];
      if (figure.led === null) {
        found.heads[head][key] = { return: toRupees_(figure.ret), ledger: null, diff: null };
        return;
      }
      var diff = figure.ret - figure.led;
      found.heads[head][key] = { return: toRupees_(figure.ret), ledger: toRupees_(figure.led), diff: toRupees_(diff) };
      if (!diff) return;
      found.diffs.push(differenceRow_(head, key, returned.month, figure, diff, blockedHint_(key, compared.inBlocked, figure.led, figure.ret)));
    });
  }
  /**
   * ⭐ reconcile(gstr3b, ledger) → { ok, clean, heads, differences }
   *   ledger   { igst: { output, input, paid, setoff? }, cgst: {…}, sgst: {…} } — the Ledger's figures for the SAME month, rupees:
   *            output = tax on sales net of credit notes · input = tax on purchases net of returns · paid = the challan ·
   *            setoff = the credit used against output (optional)
   * Per head, return against Ledger for output, input, paid (and set-off when given). A difference is NAMED — which head, which
   * line, both figures, and when it equals the blocked ITC the return excluded, that is said — and never forced to zero.
   * `input` is compared to the return's eligible ITC plus what it excluded as blocked: the Ledger books a purchase's tax whole.
   */
  function reconcile(returned, ledger) {
    if (!returned || !returned.ok || !returned.s6_1) return refuse_('reconcile needs a gstr3b result.');
    if (!ledger || typeof ledger !== 'object') return refuse_('reconcile needs the Ledger figures per head.');
    var found = { heads: {}, diffs: [] },
      blocked = returned.s4.ineligible.other;
    HEADS.forEach(function (head) {
      reconcileHead_(returned, ledger, blocked, head, found);
    });
    return { ok: true, month: returned.month, clean: !found.diffs.length, heads: found.heads, differences: found.diffs };
  }

  /* ── s.50 interest ─────────────────────────────────────────────────────────────────────────────────────────────── */
  /** the due date of a month's monthly GSTR-3B: the 20th of the next month ('2026-04' → '2026-05-20'). QRMP filers' 22nd / 24th are not modelled. */
  function dueDate(month) {
    var match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month || ''));
    if (!match) return null;
    var year = +match[1],
      dueMonth = +match[2] + 1;
    if (dueMonth > 12) {
      dueMonth = 1;
      year++;
    }
    return year + '-' + String(dueMonth).padStart(2, '0') + '-20';
  }
  /** why interest cannot be worked from these inputs; null when it can */
  function interestRefusal_(dueDay, paidDay, liability, rate) {
    if (dueDay === null || paidDay === null) return refuse_('Interest needs due_date and paid_on as YYYY-MM-DD.');
    if (!isFinite(liability) || liability < 0) return refuse_('Interest needs the net cash liability, zero or more.');
    if (!isFinite(rate) || rate < 0) return refuse_('Interest needs a rate in percent.');
    return null;
  }
  /**
   * ⭐ interestFor({ cash_liability, due_date, paid_on, rate_pct? }) → { ok, days, interest, rate_pct }
   * s.50(1): interest at 18% a year on the NET CASH liability (the tax left after ITC), for the days from the due date to the day
   * paid — a payment on the due date owes none, a day after owes one day. interest = liability × rate × days / 365, rounded once.
   * The late fee (s.47) is not here. A liability paid on time, or nothing in cash, gives 0.
   */
  function interestFor(opts) {
    var input = opts || {},
      dueDay = dayNumber_(input.due_date),
      paidDay = dayNumber_(input.paid_on),
      liability = Number(input.cash_liability),
      rate = input.rate_pct == null ? RATE_INTEREST : Number(input.rate_pct);
    var refusal = interestRefusal_(dueDay, paidDay, liability, rate);
    if (refusal) return refusal;
    var days = Math.max(0, paidDay - dueDay),
      money = moneyEngine_();
    var rawInterest = (((liability * rate) / 100) * days) / 365;
    return {
      ok: true,
      days: days,
      interest: days && liability ? (money && money.round ? money.round(rawInterest) : Math.round(rawInterest * 100) / 100) : 0,
      rate_pct: rate,
      basis: 'net cash liability, s.50(1)'
    };
  }

  /** why a late fee cannot be worked from these inputs; null when it can */
  function lateFeeRefusal_(row, dueDay, filedDay, nilReturn, turnoverMinor) {
    if (!row) return refuse_('this pack holds no late-fee row for that due date.');
    if (dueDay === null || filedDay === null) return refuse_('The late fee needs a period (YYYY-MM) or due_date, and filed_on, as YYYY-MM-DD.');
    if (!nilReturn && !(Number.isSafeInteger(turnoverMinor) && turnoverMinor >= 0))
      return refuse_('The late fee of a return with tax needs the aggregate turnover of the preceding financial year (turnover_minor), because the cap depends on it; none was assumed.');
    return null;
  }
  /** the cap (minor units) a return stops at: a nil return its own, else the first turnover band that holds the turnover (`up_to_minor` inclusive, null = no upper limit) */
  function lateFeeCap_(row, nilReturn, turnoverMinor) {
    if (nilReturn) return row.nil_cap_minor;
    var band = (row.caps || []).filter(function (item) {
      return item.up_to_minor == null || turnoverMinor <= item.up_to_minor;
    })[0];
    return band ? band.cap_minor : null;
  }
  /** what lateFeeFor reads from its inputs: the pack's dated row, the days, and the two flags — or a refusal ({ ok: false, why }) */
  function lateFeeInputs_(pack, input) {
    var packs = packsEngine_(),
      table = pack && ((pack.tax && pack.tax.late_fee) || pack.late_fee);
    if (!table || !packs) return refuse_('this country pack carries no late-fee table.');
    var dueText = input.due_date || dueDate(input.period),
      dueDay = dayNumber_(dueText),
      filedDay = dayNumber_(input.filed_on),
      nilReturn = !!input.nil,
      turnoverMinor = input.turnover_minor == null ? null : Number(input.turnover_minor),
      row = packs.rowAsOf(table, dueText);
    var refusal = lateFeeRefusal_(row, dueDay, filedDay, nilReturn, turnoverMinor);
    if (refusal) return refusal;
    return { ok: true, row: row, days: Math.max(0, filedDay - dueDay), nilReturn: nilReturn, turnoverMinor: turnoverMinor };
  }
  /**
   * ⭐ lateFeeFor(pack, { period | due_date, filed_on, nil, turnover_minor }) → { ok, days, fee_minor, fee, capped, cap_minor, per_day_minor, row_from, status, cite }  (CTRY-141, dated pack data)
   * The s.47 late fee of a late GSTR-3B, READ from the pack's dated `late_fee` rows (never a number here): the day count from the due date to `filed_on` (filed on the due date = 0 days),
   * at the row's per-day amount (a `nil` return its own), stopped at the cap its turnover band gives. `due_date` or, from `period` 'YYYY-MM', dueDate(period) (a QRMP filer passes
   * returnsDue's date). `turnover_minor` is the preceding financial year's aggregate turnover in paise, required unless `nil`; a missing one REFUSES, no band is ever guessed.
   * The row is the one in force on the DUE date. `fee` is in rupees, `fee_minor` in paise. Pure: every date is an argument.
   */
  function lateFeeFor(pack, opts) {
    var read = lateFeeInputs_(pack, opts || {});
    if (!read.ok) return read;
    var perDayMinor = read.nilReturn ? read.row.nil_per_day_minor : read.row.per_day_minor,
      capMinor = lateFeeCap_(read.row, read.nilReturn, read.turnoverMinor),
      uncappedMinor = read.days * perDayMinor,
      feeMinor = capMinor == null ? uncappedMinor : Math.min(uncappedMinor, capMinor);
    return {
      ok: true,
      days: read.days,
      form: 'GSTR-3B',
      fee_minor: feeMinor,
      fee: toRupees_(feeMinor),
      cgst_minor: feeMinor / 2,
      sgst_minor: feeMinor / 2,
      note: 'the statutory fee at the pack row; waiver and amnesty notices are not modelled, check them before it is paid',
      capped: capMinor != null && uncappedMinor > capMinor,
      cap_minor: capMinor,
      per_day_minor: perDayMinor,
      row_from: read.row.from,
      status: read.row.status || null,
      cite: read.row.cite || null
    };
  }

  /* ── the shop's OWN return, by its pack (v1.39.0, BAS1) ───────────────────────────────────────────────────────── */
  /**
   * ⭐ periodsFor(pack, opts) → the pack's return periods, each { period, label, start, end, due, frequency, … } — ONE call for every pack:
   *   AU  returns.periods({ fy: '2026-27' | 2026, frequency: 'quarterly' | 'monthly' })       (due the 28th after a quarter; the 21st after a month)
   *   AE  returns.periods({ stagger: 1 | 2 | 3 | 4 | 'monthly', year: 2026 })                  (the FTA's stagger is read from the registration, never guessed)
   *   IN  [] — a GSTR-3B month is 'YYYY-MM' and its due date is dueDate(month); there is no period table to list
   * A pack's refusal (no financial year, no stagger) comes back as { ok: false, why } — the pack's own sentence.
   */
  function periodsFor(pack, opts) {
    var options = opts || {},
      returns = pack && pack.returns;
    if (!pack || !pack.id) return refuse_('periodsFor needs the regulation pack (regulation.packFor).');
    if (!returns || typeof returns.periods !== 'function') return { ok: true, pack: pack.id, form: pack.id === COUNTRY_ ? 'GSTR-3B' : null, periods: [] };
    try {
      return { ok: true, pack: pack.id, form: returns.id, periods: returns.periods(options) };
    } catch (e) {
      return refuse_(thrownWhy_(e));
    }
  }
  /**
   * returnsDue(pack, period, scheme, group) → { ok, period, scheme, group, due: [{ form, due_date, optional, overridden, source, status }] } — v1.81.0 (CTRY-68), the ONE answer
   * to "which returns, due when". READ from the pack's `filing_calendar` DATA (rules by form and scheme, QRMP state groups, dated one-off overrides); no due date is a number here.
   *   period  'YYYY-MM' — the tax month. Monthly: GSTR-1 and GSTR-3B for that month. QRMP: the quarter-end month (Mar/Jun/Sep/Dec) gives GSTR-1 + GSTR-3B for the quarter;
   *           the first two months of a quarter give the PMT-06 challan and the optional IFF.
   *   scheme  'monthly' | 'qrmp'
   *   group   QRMP GSTR-3B only: 'A' (22nd) | 'B' (24th), a 2-digit GST state code ('27'), or a GSTIN (its first two digits); read from the pack's groups table
   * A refusal is { ok: false, why }. Holidays and portal-side extensions are NOT guessed: add an `overrides` row to the pack.
   */
  function returnsDue(pack, period, scheme, group) {
    var cal = pack && ((pack.tax && pack.tax.filing_calendar) || pack.filing_calendar),
      match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period || ''));
    if (!cal) return refuse_('this country pack carries no filing calendar.');
    if (!match) return refuse_('period is YYYY-MM, the tax month.');
    if (scheme !== 'monthly' && scheme !== 'qrmp') return refuse_('scheme is monthly or qrmp.');
    var year = Number(match[1]),
      month = Number(match[2]),
      position = ((month - 1) % 3) + 1,
      letter = groupLetter_(cal, group),
      due = [];
    if (scheme === 'qrmp' && position === 3 && !letter)
      return refuse_('a quarterly GSTR-3B is due the 22nd or the 24th by the State of the principal place of business: say the state group (A or B), a state code or a GSTIN.');
    cal.rules.forEach(function (rule) {
      if (rule.scheme !== scheme) return;
      if (rule.from && rule.from.slice(0, 7) > period) return;
      if (rule.to && rule.to.slice(0, 7) < period) return;
      if (scheme === 'qrmp') {
        var quarterReturn = rule.form === 'GSTR-1' || rule.form === 'GSTR-3B';
        if (quarterReturn !== (position === 3)) return;
        if (rule.on_months && rule.on_months.indexOf(position) < 0) return;
      }
      var day = rule.day_by_group ? rule.day_by_group[letter] : rule.day,
        next = month === 12 ? [year + 1, 1] : [year, month + 1],
        entry = { form: rule.form, due_date: next[0] + '-' + pad2_(next[1]) + '-' + pad2_(day), optional: !!rule.optional, overridden: false, source: rule.source, status: rule.status };
      var over = (cal.overrides || []).filter(function (item) {
        return item.form === rule.form && item.period === period && (!item.scheme || item.scheme === scheme) && (!item.group || item.group === letter);
      })[0];
      if (over) entry = Object.assign(entry, { due_date: over.due, overridden: true, source: over.source, status: over.status });
      due.push(entry);
    });
    return { ok: true, period: period, scheme: scheme, group: letter, due: due };
  }
  function pad2_(number) {
    return number < 10 ? '0' + number : String(number);
  }
  /** 'A' | 'B' | null from a group letter, a 2-digit state code or a GSTIN, read from the calendar's groups table */
  function groupLetter_(cal, group) {
    var key = String(group == null ? '' : group).toUpperCase();
    if (cal.groups[key]) return key;
    var code = key.slice(0, 2);
    return (
      Object.keys(cal.groups).filter(function (name) {
        return cal.groups[name].states.indexOf(code) >= 0;
      })[0] || null
    );
  }
  /** the two read columns of a box as one row: { code, label, amount_minor, tax_minor, roles, note } — a BAS label has one figure, a VAT201 box the form's amount and VAT columns */
  function row_(code, label, amount, taxMinor, roles, note) {
    return {
      code: String(code),
      label: label,
      amount_minor: amount == null ? null : amount,
      tax_minor: taxMinor == null ? null : taxMinor,
      roles: roles || [],
      note: note || null
    };
  }
  var BAS_ORDER = ['G1', 'G2', 'G3', 'G10', 'G11', '1A', '1B', '9'];
  /** the BAS labels the pack answered, in the form's order, as screen boxes */
  function basBoxes_(basAnswer) {
    var boxes = [];
    BAS_ORDER.forEach(function (item) {
      var entry = basAnswer.labels[item];
      if (entry) boxes.push(row_(item, entry.label, entry.minor, null, entry.roles, item === 'G10' || item === 'G11' ? basAnswer.g10_g11_basis : null));
    });
    return boxes;
  }
  /** the pack's BAS answer in the one screen shape returnFor promises */
  function fromBas_(pack, basAnswer) {
    var returns = pack.returns,
      boxes = basBoxes_(basAnswer);
    return {
      ok: true,
      pack: pack.id,
      form: returns.id,
      name: returns.name,
      short: returns.short,
      authority: returns.authority,
      portal: returns.portal,
      period: basAnswer.period,
      currency: pack.currency,
      columns: ['amount'],
      boxes: boxes,
      payable_minor: basAnswer.payable_minor,
      refund_minor: basAnswer.refund_minor,
      net_minor: basAnswer.labels['9'].minor,
      notes: [basAnswer.simpler ? 'Simpler BAS: G1, 1A and 1B only (GST turnover under A$10 million)' : basAnswer.g10_g11_basis].filter(Boolean),
      cite: basAnswer.cite,
      detail: basAnswer
    };
  }
  /** India's return: GSTR-3B from the frozen invoices in opts, plus pack · form · period; or a refusal when no documents were passed */
  function indiaReturn_(period, opts) {
    if (!opts.documents)
      return refuse_("India's GSTR-1 / GSTR-3B are read from the frozen invoices, not the ledgers — pass documents (and gstin), or call gstr1 / gstr3b.");
    var result = gstr3b({ gstin: opts.gstin, month: period, documents: opts.documents, opening_itc: opts.opening_itc, itc_reversals: opts.itc_reversals, ref: opts.ref });
    return result.ok ? Object.assign({ pack: COUNTRY_, form: 'GSTR-3B', period: period }, result) : result;
  }
  /**
   * ⭐ returnFor(pack, period, movements, opts?) → the shop's OWN return for one period, READ from the posted ledger movements and dispatched to the
   * pack's `returns` — nothing is recomputed, every figure is a sum of what the books already hold:
   *   AU  returns.bas({ period, simpler }, movements)      opts.simpler (default true: Simpler BAS answers G1 · 1A · 1B; false: G2 G3 G10 G11 too)
   *   a pack with returns.build(pack, period, movements, opts) builds its own (R2, v1.52.0 — AE: the VAT201, opts.emirate)
   *   IN  gstr3b({ gstin, month: period, documents })      UNCHANGED — India's return is read from the frozen invoices, which opts carries (documents, gstin,
   *                                                        opening_itc, itc_reversals, ref); the ledgers are not read. The answer is gstr3b's, plus pack · form · period.
   * `movements` are the period's ledger movements by role, as ledger.accumulate gives them: [{ role, dr_minor, cr_minor }] (a code with no role is left out by the pack).
   * ONE shape for a screen (AU, AE): { ok, pack, form, name, short, authority, portal, period, currency, columns, boxes: [{ code, label, amount_minor, tax_minor, roles, note }],
   *   payable_minor, refund_minor, net_minor (positive = pay, negative = refund), notes, cite, detail (the pack's own answer, untouched) }.
   * `roles` names the ledger roles the figure was read from — so every number opens what it counts. A pack's refusal is { ok: false, why } in the pack's words.
   */
  function returnFor(pack, period, movements, opts) {
    var options = opts || {},
      returns = pack && pack.returns;
    if (!pack || !pack.id) return refuse_('returnFor needs the regulation pack (regulation.packFor).');
    if (!period) return refuse_("A return is for a period — as the pack's returns.periods names it ('2026-Q1', '2026-07', '2026-02/2026-04', '2026-08').");
    if (!returns || !returns.id) return pack.id === COUNTRY_ ? indiaReturn_(period, options) : refuse_('The ' + pack.id + ' pack has no return built yet.');
    return packReturn_(pack, period, movements, options);
  }
  /** the return the pack builds itself (returns.build) or the BAS it reads (returns.bas); a pack's throw is a refusal in its words */
  function packReturn_(pack, period, movements, options) {
    var returns = pack.returns;
    try {
      if (typeof returns.build === 'function') return returns.build(pack, period, movements || [], options);
      if (returns.id === 'BAS' && typeof returns.bas === 'function')
        return fromBas_(pack, returns.bas({ period: period, simpler: options.simpler !== false }, movements || []));
    } catch (e) {
      return refuse_(thrownWhy_(e));
    }
    return refuse_('The ' + pack.id + ' pack names a return (' + returns.id + ') this engine cannot read yet.');
  }


  var EXPORTS = {
    gstr1: gstr1,
    gstr1Table: gstr1Table,
    gstr3b: gstr3b,
    gstr3bTable: gstr3bTable,
    series: series,
    reconcile: reconcile,
    dueDate: dueDate,
    interestFor: interestFor,
    lateFeeFor: lateFeeFor,
    returnFor: returnFor,
    periodsFor: periodsFor,
    returnsDue: returnsDue,
    B2CL_LIMITS: B2CL_LIMITS,
    BLOCKED_REASONS: BLOCKED_REASONS,
    RATE_INTEREST: RATE_INTEREST
  };

  /* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBGstReturns. */
  if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
  if (root && typeof root.window !== 'undefined') root.window.CBGstReturns = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
