/**
 * chit-sheet.js — THE CHIT SHEET: any chit as a popup over the screen you are on.
 *
 * OWNS      the chit sheet (CBSheet, openChitSheet): one chit opened as a side pane, a full page or a popup with its lines, frozen money, history and thread; it computes no money
 * CALLED BY every page that loads it by script tag (accounts, crm, finance, tasks, app.html) through openChitSheet(id) and CBSheet.mount(el, id), among them cap-books.js, cap-bank.js, cap-crm*.js, cap-dispute.js, cap-quotes.js, rail-bell.js
 * FLOW      open(id) ──▶ placeFor(width) picks pane, page or popup ──▶ read GET /chits/:id ──▶ header, lines, money block in the chit's own currency (summary, else header, else the shop's) ──▶ the action row from actionsFor() ──▶ repaint
 * CARD      01-rail-core-the-chit/chit-sheet
 *
 * Athi, 2026-10-01: *"the details has to be in a popup, otherwise I couldn't go back at all … cart will not have
 * dispute icon, but the task will have it, so how do we bring those information here."*
 *
 * ── WHAT IT PAINTS ── the bill as the counter prints it: header · lines (qty · price · offer · line total) · the GST
 * summary rate-wise · total · tender · who · the step word. EVERY figure is what the chit was frozen with — and there is
 * NO arithmetic on money in this file (Athi, 2026-10-02: "the final computed values stored and the same has to be seen in
 * every other place, no further computation as the chit is frozen once it become chit"). moneyFor() is the one reader:
 * the frozen `business_json.invoice` read through CBTax.moneyOf; else `summary_json.money`; else nothing — and a figure the
 * chit does not hold is said so ("not recorded on this bill"), never invented.
 *
 * ── WHAT IT OFFERS ── an icon row of ONLY the actions this chit allows in its current step. The rule lives in ONE
 * place — actionsFor() below — never per screen: the Day book, Dues, the Statement and the to-do all call
 * openChitSheet(id) and get the same row. Each icon calls the function the full page already calls for it
 * (the `status` route through statusWordFor, quickDispute, billUse, openChit) and then repaints the sheet.
 * "Open page" is the only way out: it goes where the link went before (openChit).
 * Accepting a bill I received is a money promise (R102, walk 24 Oct): acceptAsk() asks first through the page's one confirm
 * (CBAction.ask), naming the supplier, the bill and the amount; Cancel sends nothing. The history then reads "Accepted by <who>".
 *
 * Phone first. The sheet scrolls; the page behind does not move, so closing returns to the same place.
 *
 * ── ONE DETAIL VIEW, THREE PLACES (Athi, 2026-10-19; UX-11 / UX-17) ── open() seats the same dialog by width (placeFor): a SIDE PANE beside the list on
 * a wide page (a flex sibling in the page's .app row, nothing covered), a FULL PAGE on a phone or tablet, the old popup only on a wide page with no
 * pane seat. All three wear the same Back arrow and the same sections; the phone's Back button closes it (one history step). openChitSheet('sample')
 * or ?cs=sample on any page shows a labelled Sample bill from fixed figures, so the whole look can be walked before it is wired.
 *
 * ── TWO HOSTS, ONE PAINTER (CRM2, 2026-10-13) ── the same sections also paint FULL-PAGE: CBSheet.mount(el, id) draws them into a
 * page's own element (CB CRM › Chits › crm.html#/chit/<id> — where "Open page" lands, never the workshop). The page form is the popup
 * plus what a popup leaves out: the chit's history (state_log, read as held) and the page note (CBPage, app/page.js); it drops the
 * "Open page" icon (you are on it). M53 (docs/design/chit-detail) asks for exactly this: one module, opened as a popup or a full page.
 */
(function (root) {
  'use strict';
  var CS = {
    id: null,
    chit: null,
    view: null,
    busy: false,
    mode: 'dialog',
    el: null,
    page: null,
    answered: {},
    place: 'popup',
    sample: false,
    pushed: false
  }; /* answered: chit id → the step a status move made here was answered with (FX-F10W) */
  function T(s) {
    return typeof tx === 'function' ? tx(s) : s;
  }
  /**
   * ⭐ STD1 · THE STEPS, ONCE — the rail's statuses grouped the way this sheet asks (the engine's own grouping is workflow.js OPEN_NEW /
   * CLOSED; it is not loaded on every page that opens the sheet, so the sheet holds its one copy HERE and every test below reads it).
   */
  var STEPS = { open: ['pending', 'delivered', 'read'], live: ['accepted', 'in_progress', 'partial'], dead: ['cancelled', 'rejected'] };
  function stepIn(s, k) {
    return STEPS[k].indexOf(String(s || '')) >= 0;
  }
  function tf(s, v) {
    if (typeof txf === 'function') return txf(s, v);
    return String(s).replace(/\{(\w+)\}/g, function (_, k) {
      return v && v[k] != null ? v[k] : '';
    });
  }
  function when(ts) {
    if (!ts) return '';
    try {
      return CBLocale.datetime(ts);
    } catch (_) {
      return String(ts).slice(0, 16);
    } /* CU4: the one date-time stamp */
  }
  /**
   * ⭐ ONE DETAIL VIEW, THREE PLACES, ONE LOOK (Athi, 2026-10-19): a bill or order opens in a SIDE PANE beside the list on a wide screen, as a FULL PAGE
   * on a phone or tablet, each with the same back arrow. Wide = above the page skeleton's 1100 px (page-skeleton.css / page-frame.js collapse the
   * sidebar at 1100); a wide page with no skeleton (the workshop) keeps the old popup. Pure: width in, the place's name out (tests/detail-placement.test.cjs).
   */
  var WIDE_MIN = 1101;
  function placeFor(width, hasPaneSlot) {
    return !(Number(width) >= WIDE_MIN) ? 'page' : hasPaneSlot ? 'pane' : 'popup';
  }
  /** the pane's seat: the page row (sidebar | main | here: the skeleton's .app, the same row CB Accounts, Finance and CRM draw) — a flex sibling, so nothing is covered */
  function paneSlot() {
    return root.document && root.document.querySelector ? root.document.querySelector('.cbsk .app, body > .app') : null;
  }
  function isSelf(en, name) {
    try {
      return typeof chitIsSelf === 'function' && chitIsSelf(en, name);
    } catch (_) {
      return false;
    }
  }
  /* ── what the chit read says, in one shape ─────────────────────────────────────────────────────── */
  /** RAIL-146: did the server take the money off this read (a co-assist who may not see cost)? the field it sends, never a sentence */
  function costHiddenOf(read) {
    return !!(read && read.cost_hidden);
  }
  /** a line's money cell: the figure; "hidden" when the server took it off this read; a dash when the chit never had one */
  function sheetMoney(value, sheet) {
    return value == null && sheet.costHidden ? T('hidden') : fmtMoney(value, sheet.cur, '—');
  }
  function model(r) {
    var h = (r && r.header) || r || {},
      det = (r && r.detail) || {};
    var text = h.business_json || {},
      sum = h.summary_json || {},
      money_ = sum.money || {};
    var rec = h.all_recipients || [];
    var sender =
      rec.filter(function (x) {
        return x.role === 'sender';
      })[0] || {};
    var senderName = sender.display_name || h.sender_entity_display_name || '';
    var iSent = isSelf(sender.entity_id, senderName);
    var others = rec.filter(function (x) {
      return x.role !== 'sender' && !isSelf(x.entity_id, x.display_name) && String(x.display_name || '').toLowerCase() !== 'self';
    });
    var live = Array.isArray(r && r.live_set)
      ? r.live_set
          .filter(function (e) {
            return e && !e.removed && e.live;
          })
          .map(function (e) {
            return e.live;
          })
      : det.line_items || [];
    var purpose = String(h.purpose || '');
    var cur = sum.currency_code || h.currency;
    var bill = text.bill_no || text.printed_as || null;
    var log = (r && r.state_log) || [];
    /* ⭐ STD1: WHAT DOCUMENT THIS IS, the SERVER says (the chit read's `doc` — folder-inventory docOf, the Bills folders' own test); never guessed
       here. A bill I received — an invoice sent to me, or MY counter receipt carrying their bill no. AND total (F10: captured) — is accepted
       like one, and its step is my own copy's. */
    var tb = text.their_bill,
      billRx = !!(r && r.doc === 'bill_received'),
      captured = billRx && purpose === 'receipt';
    var counterBill = !billRx && !!(text.till && iSent && !others.length); /* rung up at a counter and sent to nobody else */
    var agreement = !!(text.repeat && text.repeat.agreement_id); /* RI1: a repeat-supply agreement (purpose subscription) — its verbs are its own panel's */
    return Object.assign(serverAnswers(r), {
      agreement: agreement,
      /* FX-F10W: a captured receipt IS a bill (folder-inventory bill_received), so its step is MY bill_step too (routes/chits.js writes it there);
         the header's status is the sent copy's and never moves — read alone, Accept stayed "To accept" after the server said accepted */
      id: h.chit_id || (r && r.id) || null,
      status: billRx
        ? billStepStatus(log, captured ? String(h.current_status || h.status || 'pending') : null)
        : String(h.current_status || h.status || 'pending'),
      purpose: purpose,
      cur: cur, costHidden: costHiddenOf(r) /* RAIL-146: the server took the money off this read for a cost-blind co-assist; the total says "hidden" */,
      iSent: iSent,
      counterBill: counterBill,
      billRx: billRx,
      captured: captured,
      hasOther: !iSent || others.length > 0,
      hasLines: live.length > 0,
      isTask: !counterBill && !billRx,
      no: captured && tb ? String(tb.no == null ? '' : tb.no).trim() : bill || h.manual_subject || h.auto_subject || '',
      at: text.billed_at || h.created_at,
      counter: counterOfBill(bill, text.till),
      by: (text.till && text.till.by && text.till.by.name) || '',
      who: counterBill
        ? (text.customer && text.customer.name) || T('Walk-in')
        : captured
          ? (text.party && text.party.name) || T('Not named')
          : billRx
            ? (sum.bill_received && sum.bill_received.from) || senderName
            : others
                .map(function (x) {
                  return x.display_name;
                })
                .join(', ') || senderName,
      /* a captured bill not yet frozen: the money it carries is THEIR total as the door typed it (read; the server taxes the lines when it posts) */
      lines: live,
      bj: text,
      money: captured && tb && !text.invoice ? receiptMoney(text, tb) : moneyFor(text, money_, cur, sum),
      rec: rec,
      order: orderDetails(sum, purpose)
    });
  }
  /* ⭐ WHAT THE CHIT IS FROZEN WITH, in one shape (summary_json.money's names + by_rate · heads · lines): the invoice the
     counter determined, read out by CBTax.moneyOf — else the header's own summary_json.money — else null. A mapping, never a sum. */
  function moneyFor(bj, summaryMoney, cur, sum) {
    if (bj && bj.invoice && root.CBTax && root.CBTax.moneyOf) return root.CBTax.moneyOf(bj.invoice, cur);
    if (summaryMoney && Object.keys(summaryMoney).length) return summaryMoney;
    /* O7: an ORDER is not billed yet - the figure it was placed with is the header's own total_value (the same one the Chits list shows), read, never worked out */
    var tv = sum && sum.total_value != null ? sum.total_value : sum && sum.indicative_total != null ? sum.indicative_total : null;
    return tv != null && !isNaN(Number(tv)) ? { total: Number(tv) } : null;
  }
  /* FX-F10W2: MY RECEIPT OF THEIR BILL, before the books freeze it — their total as the door typed it, and the tax the counter RECORDED on the
     receipt (business_json.input_tax: taxable · tax, split per line by the tax engine at the door). Read, never worked out; never "not recorded" when it is. */
  function receiptMoney(bj, tb) {
    var it = bj && bj.input_tax && typeof bj.input_tax === 'object' ? bj.input_tax : null,
      num = function (v) {
        return v != null && v !== '' && !isNaN(Number(v));
      };
    var m = { total: Number(tb.total) };
    if (it && num(it.taxable)) m.taxable = Number(it.taxable);
    if (it && num(it.tax)) m.tax = Number(it.tax);
    return m;
  }
  /* O8: what the customer typed at the online shop - the delivery address, the time asked for, the remark - read from summary_json.order_details (older orders keep only the coarse area) */
  function orderDetails(sum, purpose) {
    if (purpose !== 'order') return null;
    var d = (sum && sum.order_details) || null,
      rd = (d && d.requested_delivery) || null;
    var o = {
      online: !!(d && d.channel === 'online'),
      fulfilment: (d && d.fulfilment) || '',
      address: (d && d.address) || (sum && sum.customer_locality) || '',
      when: rd ? [rd.date, rd.time].filter(Boolean).join(' ') : '',
      remark: (d && d.remark) || ''
    };
    return o.online || o.address || o.when || o.remark ? o : null;
  }
  function orderHTML(m) {
    var o = m.order;
    if (!o) return '';
    var rows = [];
    if (o.address) rows.push([o.fulfilment === 'pickup' ? 'Pick up' : 'Deliver to', o.address, 'cs-order-address']);
    if (o.when) rows.push(['Asked for', o.when, 'cs-order-when']);
    if (o.remark) rows.push(['Remark', o.remark, 'cs-order-remark']);
    return (
      '<div class="cs-order" data-testid="cs-order">' +
      (o.online
        ? '<div class="cs-online" data-testid="cs-order-online">🌐 ' +
          esc(T('Online order')) +
          (o.fulfilment === 'delivery' ? ' · ' + esc(T('Delivery')) : '') +
          '</div>'
        : '') +
      rows
        .map(function (item) {
          return '<div class="cs-row"><span>' + esc(T(item[0])) + '</span><b data-testid="' + item[2] + '">' + esc(item[1]) + '</b></div>';
        })
        .join('') +
      '</div>'
    );
  }
  /* ⭐ A BILL I RECEIVED has its own step per shop: since the API's "bills-private" it is a `bill_step` row in the chit's
     state_log (code B-2100, step 'accepted', mine:true) — NOT the shared status, which is the seller's. The latest of mine wins. */
  function billStepStatus(log, none) {
    var mine = (log || []).filter(function (x) {
      return x && x.action === 'bill_step' && x.mine && (!x.code || x.code === 'B-2100');
    });
    if (!mine.length && none) return none; /* no step of mine yet: the caller's own reading (a captured receipt's status) */
    var step = mine.length ? mine[mine.length - 1].step : '';
    /* FX-F10W2: a rejected / cancelled bill stays so (it read "pending" and offered Accept again) */
    return step === 'accepted'
      ? 'accepted'
      : step === 'closed' || step === 'completed'
        ? 'completed'
        : step === 'rejected' || step === 'cancelled'
          ? step
          : 'pending';
  }
  /* ── THE ONE RULE for which icons a chit gets in its step. Not hard-coded per screen. ───────────────
     counter bill (mine, done)     Print · Return · Open page
     bill I received, not accepted Accept · Reject · Dispute · Goods in · Open page   (FX-F10W2: Reject asks the reason — it goes on the bill)
     bill I received, accepted     Dispute · Open page
     task / order, not started     Accept · Dispute · Open page
     task / order, in hand         Dispute · Done · Open page
     closed (cancelled/rejected/completed) → only what still makes sense: Print (counter) · Open page */
  function actionsFor(m) {
    var s = m.status,
      nestedOpen = stepIn(s, 'open'),
      live = stepIn(s, 'live'),
      dead = stepIn(s, 'dead');
    var list = [];
    /* RI1: a repeat-supply AGREEMENT — Accept · Counter · Decline · Skip (the customer) and Run · Pause · End (the seller) are the panel's,
       answered by the server per verb (may/why); the rail's step buttons would move the copy behind the agreement's back */
    if (m.agreement) {
      if (!dead && m.hasOther) list.push('dispute');
      list.push('page');
      return list;
    }
    if (m.counterBill) {
      list.push('print');
      if (!dead) list.push('return');
    }
    /* F10: my receipt of their bill — Accept (the goods were counted at my door: no Goods in; nobody else holds it: no Dispute) */
    else if (m.captured) {
      if (nestedOpen) {
        list.push('accept');
        list.push('reject');
      }
    } else if (m.billRx) {
      if (nestedOpen) {
        list.push('accept');
        list.push('reject');
        list.push('dispute');
        list.push('goodsin');
      } else if (!dead) list.push('dispute');
    } else {
      if (nestedOpen) list.push('accept');
      if (!dead && m.hasOther) list.push('dispute');
      if (live) list.push('done');
    }
    /* RI1: a bill I sent to a ChitBridge customer can become a repeat-supply agreement (cap-repeat.js rpStart) */
    if (m.purpose === 'invoice' && m.iSent && m.hasOther && !dead && m.hasLines) list.push('repeat');
    list.push('page');
    return list;
  }
  /**
   * ⭐ F10 · STD1: WHAT THE SERVER SAID ABOUT THIS BILL — the chit read's own `books_wait` (todo · name · why · candidates), painted, never
   * re-derived and never looked up in a list the page happens to hold: the popup says the same on Books, Home, CRM or Finance. A bill the
   * books wait on for something other than acceptance (a gap between their total and the lines, a supplier they do not know) shows that
   * sentence; add_supplier also offers the shop's near matches ("Is this …?") and the add-party door. Accept's grey is the read's
   * actions.accept (refusedAccept), not this.
   */
  function serverSaid(m) {
    var w = m && m.billRx ? m.wait : null;
    if (!w || !w.todo || w.todo === 'accept') return null;
    var add = w.todo === 'add_supplier';
    return {
      why: String(w.why || ''),
      todo: w.todo,
      name: add && w.name ? String(w.name) : null,
      cands: add && Array.isArray(w.candidates) ? w.candidates.slice(0, 3) : []
    };
  }
  /** STD1: the server refused Accept on this bill (actions.accept, rail-actions.forBill) → its sentence; else null */
  function refusedAccept(m) {
    var a = m && m.billRx ? m.may : null;
    return a && a.ok === false ? a.say || (serverSaid(m) || {}).why || T('You cannot accept this bill now') : null;
  }
  /** FX-F10W2: the server refused Reject on this bill (actions.reject — the level alone) → its sentence; else null. needs: ['reason'] → ask it. */
  function refusedReject(m) {
    var a = m && m.billRx ? m.mayReject : null;
    return a && a.ok === false ? a.say || T('You cannot reject this bill') : null;
  }
  /** STD1: ONE builder for "Is this Sri Ganesh Provisions (P-00001)?" — the sheet and the Waiting row (cap-books) both ask it */
  function isThis(c) {
    return c && c.party_no ? tf('Is this {name} ({no})?', { name: c.name, no: c.party_no }) : tf('Is this {name}?', { name: c && c.name });
  }
  function actsOf(m) {
    var list = actionsFor(m),
      said = serverSaid(m);
    if (said && said.name) list.splice(Math.max(0, list.length - 1), 0, 'supplier');
    return list;
  }
  var ACT = {
    supplier: ['＋', 'Add supplier'],
    accept: ['✓', 'Accept'],
    reject: ['⊘', 'Reject'],
    dispute: ['⚑', 'Dispute'],
    goodsin: ['📥', 'Goods in'],
    done: ['✔', 'Done'],
    print: ['🖨', 'Print'],
    'return': ['↩', 'Return'],
    repeat: ['🔁', 'Repeat this…'],
    page: ['↗', 'Open page']
  };
  /** RI1: the repeat-supply capability, by NAME on the global (lazy on app.html: ensureCap('repeat'); loaded with the page on finance.html) */
  function repeatCap() {
    if (root.CBRepeat) return Promise.resolve(root.CBRepeat);
    if (typeof root.ensureCap === 'function')
      return root
        .ensureCap('repeat')
        .then(function () {
          return root.CBRepeat || null;
        })
        .catch(function () {
          return null;
        });
    return Promise.resolve(null);
  }

  /* ── the paint ───────────────────────────────────────────────────────────────────────────────────── */
  /* a line's own frozen total; an unbilled ORDER line that carries only price and quantity is shown as placed (price x quantity, rounded to the paisa) */
  function lineTotal(l, m) {
    /* FX-F10W2: a receipt line's own value (counted × their rate) is `value` where a sale line says `total` */
    var t = l.total != null ? l.total : l.net != null ? l.net : l.line_total != null ? l.line_total : l.amount != null ? l.amount : l.value;
    if (t == null && m.purpose === 'order' && l.price != null && !isNaN(Number(l.price))) {
      var q = Number(l.quantity != null ? l.quantity : l.qty != null ? l.qty : 1);
      if (!isNaN(q) && root.CBMoney && root.CBMoney.round) t = root.CBMoney.round(Number(l.price) * q);
    } /* the one money engine rounds; without it, no figure rather than a hand-rounded one */
    return t;
  }
  /** the line's own tax as the frozen invoice holds it (CBTax.moneyOf lines[i].tax) — read, never worked out; a nil-tax line says nothing */
  function lineTaxHTML(frozenLine, index, currency) {
    if (!frozenLine || frozenLine.tax == null || Number(frozenLine.tax) === 0) return '';
    return '<div class="cs-tax" data-testid="cs-tax-' + index + '">' + esc(T('Tax')) + ' ' + esc(fmtMoney(frozenLine.tax, currency, '—')) + '</div>';
  }
  function linesHTML(m) {
    if (!m.lines.length) return '<div class="cs-mute">' + esc(T('No lines on this chit')) + '</div>';
    var ml = (m.money && m.money.lines) || [];
    return (
      '<table class="cs-lines"><thead><tr><th>' +
      esc(T('Item')) +
      '</th><th class="n">' +
      esc(T('Qty')) +
      '</th><th class="n">' +
      esc(T('Price')) +
      '</th><th class="n">' +
      esc(T('Total')) +
      '</th></tr></thead><tbody>' +
      m.lines
        .map(function (item, index) {
          var f = ml[index],
            offs = item.offers && item.offers.length ? item.offers : item.offer ? [{ label: item.offer.label, off: item.offer.off }] : [];
          /* a frozen invoice line says what it took off; one offer on the line wears that figure, several keep their own recorded amounts */
          if (f && offs.length === 1) offs = f.discount > 0 ? [{ label: offs[0].label, off: f.discount }] : [];
          return (
            '<tr data-testid="cs-line-' +
            index +
            '"><td>' +
            esc(item.particulars || item.name || '') +
            offs
              .map(function (entry) {
                return (
                  '<div class="cs-off" data-testid="cs-offer-' +
                  index +
                  '">' +
                  esc(entry.label || T('Offer')) +
                  ' −' +
                  esc(fmtMoney(entry.off, m.cur, '—')) +
                  '</div>'
                );
              })
              .join('') +
            lineTaxHTML(f, index, m.cur) +
            '</td>' +
            '<td class="n">' +
            esc(item.quantity != null ? item.quantity : item.qty != null ? item.qty : '') +
            (item.unit && item.unit !== 'piece' ? ' ' + esc(item.unit) : '') +
            '</td>' +
            '<td class="n">' +
            esc(sheetMoney(item.price, m)) +
            '</td><td class="n">' +
            esc(sheetMoney(f ? f.total : lineTotal(item, m), m)) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table>'
    );
  }
  /* the GST summary as the counter prints it (till.html taxSummaryHTML is the reference shape): the frozen by_rate, as it is held.
     A head the chit does not hold is "—", never worked out; the footing row is the chit's own totals, never a column sum. */
  /* ⭐ RCM-POST (2026-10-14): REVERSE CHARGE IS SAID, NOT SUMMED. The frozen invoice carries the buyer's own tax in its RCM heads (engines v1.20
     RcmCgstAmt…; CBTax.moneyOf reads them as `rcm`), and NOTHING in the heads a screen sums — so a bill under reverse charge shows GST 0.00, which is
     the 2 Oct "GST ₹0.00 on the reprint" shape unless the sheet says why. `mo.rcm` IS the code (present only on such a bill); the sentence is for
     people. The buyer's copy (a bill I received, or one sent to me) says I pay it; the seller's copy says the buyer does. The figure is the engine's. */
  function rcmHTML(m) {
    var mo = m.money || {},
      r = mo.rcm;
    if (!r || typeof r !== 'object') return '';
    var iPay = !(m.iSent || m.counterBill);
    return (
      '<div class="cs-row cs-rcm" data-testid="cs-rcm" data-side="' +
      (iPay ? 'buyer' : 'seller') +
      '"><span>' +
      esc(T(iPay ? 'Reverse charge — you pay the tax' : 'Reverse charge — the buyer pays the tax')) +
      '</span>' +
      '<b data-testid="cs-rcm-tax">' +
      esc(fmtMoney(r.tax, m.cur, '—')) +
      '</b></div>'
    );
  }
  /* ACC-191: the engine reads an undecided tax as null (supply unknown, a rate above 0, no head figure): say so, never a grid of dashes or 0.00 */
  /** the GST block of a sheet: the not-decided sentence for an undecided tax, else the rate grid */
  function gstBlockHTML(sheetModel) {
    var money = sheetModel.money || {};
    return money.supply === 'unknown' && money.tax === null ? gstUndecidedHTML() : gstHTML(sheetModel);
  }
  function gstUndecidedHTML() {
    return '<div class="cs-sec">' + esc(T('GST')) + '</div>' + '<div class="cs-mute" data-testid="cs-gst-undecided">' + esc(T('GST not decided: the place of supply is not known')) + '</div>';
  }
  function gstHTML(m) {
    var mo = m.money || {},
      by = mo.by_rate || null;
    var rates = by
      ? Object.keys(by).sort(function (first, second) {
          return Number(first) - Number(second);
        })
      : [];
    if (!rates.length) {
      return (
        '<div class="cs-sec">' +
        esc(T('GST')) +
        '</div>' +
        rcmHTML(m) +
        (mo.tax != null
          ? '<div class="cs-row"><span>' + esc(T('GST total')) + '</span><b data-testid="cs-gst-total">' + esc(fmtMoney(mo.tax, m.cur, '—')) + '</b></div>'
          : '<div class="cs-mute" data-testid="cs-gst-none">' + esc(T('Rate-wise GST is not recorded on this bill')) + '</div>')
      );
    }
    var inter = (mo.supply || m.bj.supply) === 'inter';
    /* ⭐ CX0: a ONE-HEAD scheme (supply 'domestic' — the border decided: GST in Australia, VAT in the UAE) has one tax column named by its head
       (by_rate[rate].gst · .vat — the pack's taxHeads), never a CGST/SGST grid of 0.00 with the tax nowhere. Same shape as the counter's slip. */
    if ((mo.supply || m.bj.supply) === 'domestic') {
      var head = Object.keys(by[rates[0]] || {}).filter(function (item) {
        return ['taxable', 'base', 'rate', 'tax', 'cess', 'cgst', 'sgst', 'igst'].indexOf(item) < 0;
      })[0];
      var hw = head ? head.toUpperCase() : T('Tax');
      var rows1 = rates
        .map(function (item) {
          var v = by[item] || {},
            b = v.taxable != null ? v.taxable : v.base,
            tv = head && v[head] != null ? v[head] : v.tax;
          return (
            '<tr data-testid="cs-gst-' +
            esc(item) +
            '"><td>' +
            esc(item) +
            '%</td><td class="n">' +
            esc(fmtMoney(b, m.cur, '—')) +
            '</td><td class="n">' +
            esc(fmtMoney(tv, m.cur, '—')) +
            '</td></tr>'
          );
        })
        .join('');
      var foot1 =
        mo.taxable != null
          ? '<tr class="tot"><td></td><td class="n">' +
            esc(fmtMoney(mo.taxable, m.cur, '—')) +
            '</td><td class="n">' +
            esc(fmtMoney(mo.tax, m.cur, '—')) +
            '</td></tr>'
          : '';
      return (
        '<div class="cs-sec">' +
        esc(hw + ' ' + T('summary')) +
        '</div>' +
        rcmHTML(m) +
        '<table class="cs-lines" data-testid="cs-gst"><thead><tr><th>' +
        esc(T('Rate')) +
        '</th><th class="n">' +
        esc(T('Taxable')) +
        '</th><th class="n">' +
        esc(hw) +
        '</th></tr></thead><tbody>' +
        rows1 +
        foot1 +
        '</tbody></table>'
      );
    }
    var rows = rates
      .map(function (item) {
        var v = by[item] || {},
          b = v.taxable != null ? v.taxable : v.base;
        return (
          '<tr data-testid="cs-gst-' +
          esc(item) +
          '"><td>' +
          esc(item) +
          '%</td><td class="n">' +
          esc(fmtMoney(b, m.cur, '—')) +
          '</td><td class="n">' +
          esc(fmtMoney(inter ? v.igst : v.cgst, m.cur, '—')) +
          '</td><td class="n">' +
          (inter ? '' : esc(fmtMoney(v.sgst, m.cur, '—'))) +
          '</td></tr>'
        );
      })
      .join('');
    var foot =
      mo.taxable != null
        ? '<tr class="tot"><td></td><td class="n">' +
          esc(fmtMoney(mo.taxable, m.cur, '—')) +
          '</td><td class="n">' +
          esc(fmtMoney(inter ? mo.igst : mo.cgst, m.cur, '—')) +
          '</td><td class="n">' +
          (inter ? '' : esc(fmtMoney(mo.sgst, m.cur, '—'))) +
          '</td></tr>'
        : '';
    return (
      '<div class="cs-sec">' +
      esc(T(inter ? 'IGST summary' : 'GST summary')) +
      '</div>' +
      rcmHTML(m) +
      '<table class="cs-lines" data-testid="cs-gst"><thead><tr><th>' +
      esc(T('Rate')) +
      '</th><th class="n">' +
      esc(T('Taxable')) +
      '</th><th class="n">' +
      esc(T(inter ? 'IGST' : 'CGST')) +
      '</th><th class="n">' +
      (inter ? '' : esc(T('SGST'))) +
      '</th></tr></thead><tbody>' +
      rows +
      foot +
      '</tbody></table>'
    );
  }
  function totalHTML(m, tid) {
    var mo = m.money || {},
      t = mo.total;
    return (
      (mo.round_off
        ? '<div class="cs-row cs-mute" data-testid="cs-roundoff"><span>' +
          esc(T('Round off')) +
          '</span><span>' +
          esc(fmtMoney(mo.round_off, m.cur, '—')) +
          '</span></div>'
        : '') +
      '<div class="cs-row cs-total"><span>' +
      esc(T('Total')) +
      '</span><b data-testid="' +
      esc(tid || 'cs-total') +
      '">' +
      esc(t == null ? T(m.costHidden ? 'hidden' : 'not recorded') : fmtMoney(t, m.cur, '—')) +
      '</b></div>'
    );
  }
  /* the frozen money as the sheet prints it, for any other screen that shows an issued chit (the Task detail): GST rate-wise, round-off, total.
     m = { money: moneyFor(...), cur, bj } — the same painters the popup uses, never a second one. */
  function moneyBlockHTML(m, totalTestid) {
    return gstBlockHTML(m) + totalHTML(m, totalTestid);
  }
  var HOW = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'On credit', cheque: 'Cheque', points: 'Points' };
  function tenderHTML(m) {
    var p = m.bj.payment;
    if (!p) return '';
    var parts = p.parts && p.parts.length ? p.parts : p.mode ? [{ how: p.mode, amount: p.paid }] : [];
    if (!parts.length) return '';
    return (
      '<div class="cs-sec">' +
      esc(T('Paid by')) +
      '</div>' +
      parts
        .map(function (x, index) {
          var k = String(x.how || '').toLowerCase();
          return (
            '<div class="cs-row" data-testid="cs-tender-' +
            index +
            '"><span>' +
            esc(T(HOW[k] || x.how || '')) +
            '</span><b>' +
            esc(fmtMoney(x.amount, m.cur, '—')) +
            '</b></div>'
          );
        })
        .join('') +
      (p.change > 0
        ? '<div class="cs-row cs-mute" data-testid="cs-change"><span>' +
          esc(T('Change')) +
          '</span><span>' +
          esc(fmtMoney(p.change, m.cur, '—')) +
          '</span></div>'
        : '')
    );
  }
  /* F10 (critic 2026-10-25): only the verbs the sheet means differently from the status word ("To accept" for what waits on you);
     every other code reads statusWord (helpers.js) — "In hand" here and "In progress" in the timeline were two names for one status. */
  var STEP = {
    pending: 'To accept',
    delivered: 'To accept',
    read: 'To accept'
  };
  /* the sheet's title is the document: a counter bill is "Bill", a bill received "Supplier bill", the rest the purpose word — never "Chit" */
  var TITLE = {
    order: 'Order',
    invoice: 'Invoice',
    general: 'Task',
    task: 'Task',
    quote: 'Quote',
    payment: 'Payment',
    receipt: 'Receipt',
    dispute: 'Dispute',
    request: 'Request',
    delivery: 'Delivery'
  };
  function titleFor(m) {
    if (m.counterBill) return 'Bill';
    if (m.billRx) return 'Supplier bill';
    return TITLE[m.purpose] || (m.purpose ? m.purpose.charAt(0).toUpperCase() + m.purpose.slice(1).replace(/_/g, ' ') : 'Task');
  }
  function kindWord(m) {
    return m.counterBill ? 'Counter bill' : m.billRx ? 'Supplier bill' : 'Task';
  }
  /* SCREEN-ID: the sheet's kind = its screen code (app/screen-id.js bySheet) — the same code from whichever page opened it */
  function sheetKind(m) {
    return m.counterBill ? 'bill' : m.billRx ? 'supplierbill' : 'task';
  }

  /* R10 - the rail units where the person already is. "Messages and files" is the chit's thread (CBThread, R02) and the picker (CBAttach, R07),
     each mounted with ITS OWN api: the units decide who may post (the engine's `chit.actions`, a refusal with its `why`); this file decides nothing.
     The host is built once per chit and moved into each repaint, so a busy repaint does not remount the unit or lose what was typed. */
  function railMount(node, m) {
    var body = node.querySelector('.cs-body'),
      id = m.id || CS.id;
    if (!body || !id || (typeof CBThread === 'undefined' && typeof CBAttach === 'undefined')) return;
    if (!CS.rail || CS.rail.id !== id) {
      var el = document.createElement('div');
      el.setAttribute('data-testid', 'cs-rail');
      el.innerHTML =
        '<div class="cs-sec">' + esc(T('Messages and files')) + '</div><div data-testid="cs-rail-attach"></div><div data-testid="cs-rail-thread"></div>';
      CS.rail = { id: id, el: el };
      var ch = CS.chit || {},
        who = (typeof SESS !== 'undefined' && SESS) || (typeof SESSION !== 'undefined' && SESSION) || {};
      if (typeof CBAttach !== 'undefined') CBAttach.mount(el.querySelector('[data-testid="cs-rail-attach"]'), { chit_id: id, label: T('Attach a file') });
      if (typeof CBThread !== 'undefined')
        CBThread.mount(el.querySelector('[data-testid="cs-rail-thread"]'), {
          chit_id: id,
          actions: ch.actions || undefined,
          party: m.who || '',
          me: who.entity || who.name || '',
          channel: 'both',
          thread_type: 'internal' /* UX-116 R60: the note starts as a team note; sending to the other side is a deliberate switch */,
          context: { host: 'chit-sheet' }
        });
    }
    body.appendChild(CS.rail.el);
  }

  /* ⭐ T3-DISPUTES-ASSIST: a page that carries the dispute capability (CBDispute, app/cap-dispute.js — CB Tasks & Orders) gets the chit's disputes
     HERE: each one with whom · why · its room, Raise and Resolve greyed with the server's sentence. The section is the capability's; the sheet only
     gives it a place, built once per chit and moved into each repaint (as railMount above), so a repaint does not re-read it or lose a typed reason. */
  function dispMount(node, m) {
    var body = node.querySelector('.cs-body'),
      id = m.id || CS.id;
    if (!body || !id || !root.CBDispute || !root.CBDispute.sheet)
      return; /* a page opts in (tasks.html: CBDispute.sheet = true); the workshop's sheet is unchanged */
    if (!CS.disp || CS.disp.id !== id) {
      var el = document.createElement('div');
      el.setAttribute('data-testid', 'cs-disputes');
      CS.disp = { id: id, el: el };
      root.CBDispute.inSheet(el, id);
    }
    body.appendChild(CS.disp.el);
  }

  /** RAIL-117 · F8: the Rounds section of a quotation — the SAME painter app.html mounts (app/cap-quotes.js CBQuotes.mount), so a customer page
      (crm.html#/chit, tasks.html) can Accept / Counter / Reject. A page opts in by loading cap-quotes.js; a chit that is not a quotation shows nothing new. */
  function quotesMount(node, model) {
    var body = node.querySelector('.cs-body'),
      id = model.id || CS.id;
    if (!body || !id || !root.CBQuotes || typeof root.chitIsQuote !== 'function' || !root.chitIsQuote(CS.chit)) return;
    if (!CS.quotes || CS.quotes.id !== id) {
      var el = document.createElement('div');
      el.setAttribute('data-testid', 'cs-quotes');
      CS.quotes = { id: id, el: el };
      root.CBQuotes.mount(el, id);
    }
    body.appendChild(CS.quotes.el);
  }
  /** the sections under the chit's body, in order: the dispute room, the quotation rounds, the rail thread */
  function mountSections(node, model) {
    dispMount(node, model);
    quotesMount(node, model);
    railMount(node, model);
  }

  /* the page form only: the chit's history as the state_log holds it — when · what · who. Read, never worked out; the step words are the sheet's own. */
  var LOGWORD = {
    created: 'Created',
    delivered: 'Delivered',
    message_sent: 'Message sent',
    amended: 'Amended',
    bill_step: 'Step',
    assigned: 'Assigned',
    dispute_opened: 'Disputed',
    dispute_resolved: 'Dispute closed'
  };
  /** the chit's history shows on the page form and in the pane / full page — the workshop's small popup leaves it out */
  function showsHistory() {
    return CS.mode === 'page' || CS.place !== 'popup';
  }
  /** the word for one history row: my bill_step row says the step it took (Accepted · Rejected — R102), else the action's word, else the status word */
  function histWord(e) {
    var a = String(e.action || '');
    if (a === 'bill_step' && e.step) return STEP[e.step] || statusWord(e.step); /* UX-122: statusWord is the one code -> words mapping (helpers.js) */
    if (LOGWORD[a]) return LOGWORD[a];
    if (a.indexOf('status_') === 0) return STEP[a.slice(7)] || statusWord(a.slice(7));
    return e.new_status ? STEP[e.new_status] || statusWord(e.new_status) : a || 'Event';
  }
  /** one history row: "Accepted by Kaveri R" · the time — who acted is the api's action_by_display_name, the same for every step */
  function histRowHTML(e, index) {
    var actor = e.action_by_display_name || e.by_name || '',
      said = actor ? tf('{what} by {who}', { what: T(histWord(e)), who: actor }) : T(histWord(e));
    return '<div class="cs-row cs-hist" data-testid="cs-hist-' + index + '"><span>' + esc(said) + '</span><b>' + esc(when(e.created_at || e.at)) + '</b></div>';
  }
  function historyHTML() {
    var log = (CS.chit && CS.chit.state_log) || [];
    if (!log.length) return '';
    return '<div class="cs-sec">' + esc(T('History')) + '</div>' + log.map(histRowHTML).join('');
  }
  function pageNoteHTML() {
    try {
      return CS.mode === 'page' && root.CBPage && CS.chit ? root.CBPage.noteHTML((CS.chit.header || {}).business_json) : '';
    } catch (_) {
      return '';
    }
  }
  function host() {
    return CS.el && document.body.contains(CS.el) ? CS.el : null;
  }

  function paint() {
    var node = host();
    if (!node) return;
    var m = CS.view,
      ttl = node.querySelector('[data-testid="cs-title"]');
    if (ttl) ttl.textContent = T(m ? titleFor(m) : 'Bill');
    var sid = node.querySelector('[data-testid="cs-screen-id"]'); /* the popup names its own screen; the page form is named by its page's header */
    if (sid) sid.innerHTML = m && CS.mode === 'dialog' && root.CBScreenId ? root.CBScreenId.sheetHTML(sheetKind(m)) : '';
    if (!m) {
      node.querySelector('.cs-body').innerHTML = CS.err
        ? '<div class="cs-mute" data-testid="cs-err">' +
          esc(CS.err) +
          '</div>' +
          /* UX-137: the standard Try again (CMP009), drawn in this sheet's chip look; the press is the same retry() */
          ui.action('reload', { mount: 'TSK005-U01', surface: 'chip', testid: 'cs-retry', onPress: retry })
        : '<div class="cs-mute">' + esc(T('Reading…')) + '</div>';
      node.querySelector('.cs-acts').innerHTML = '';
      return;
    }
    var head = [T(kindWord(m)), m.no, when(m.at), counterWord(m.counter), m.by]
      .filter(Boolean)
      .map(function (x, index) {
        return index === 1 ? '<b class="mono" data-testid="cs-no">' + esc(x) + '</b>' : esc(x);
      })
      .join(' · ');
    node.querySelector('.cs-body').innerHTML =
      sampleBannerHTML() +
      '<div class="cs-head" data-testid="cs-head">' +
      head +
      '</div>' +
      '<div class="cs-who"><span data-testid="cs-who">' +
      esc(m.who) +
      '</span> <span class="cs-step" data-testid="cs-step">' +
      esc(T(STEP[m.status] || statusWord(m.status))) +
      '</span></div>' +
      pageNoteHTML() +
      orderHTML(m) +
      linesHTML(m) +
      (m.purpose === 'order' && !m.counterBill && !(m.money && m.money.by_rate) ? '' : gstBlockHTML(m)) +
      totalHTML(m) +
      tenderHTML(m) +
      (m.agreement
        ? root.CBRepeat
          ? root.CBRepeat.panelHTML()
          : '<div class="cs-sec">' + esc(T('Repeat supply')) + '</div><div class="cs-mute" data-testid="rp-panel">' + esc(T('Reading…')) + '</div>'
        : '') +
      (serverSaid(m) ? '<div class="cs-note" data-testid="cs-why">' + esc(serverSaid(m).why) + '</div>' : '') +
      (serverSaid(m) && serverSaid(m).cands.length
        ? '<div class="cs-use" data-testid="cs-pick">' +
          serverSaid(m)
            .cands.map(function (item, index) {
              return (
                '<button data-cbsid="SCR050-B01" type="button" class="optchip" data-testid="cs-link-' +
                index +
                '" onclick="CBSheet.link(' +
                index +
                ')"' +
                (CS.busy ? ' disabled' : '') +
                '>' +
                esc(isThis(item)) +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      (CS.rejectAsk
        ? '<div class="cs-use" data-testid="cs-reject"><label class="cs-sec" for="cs_reason">' +
          esc(T('Why is it refused?')) +
          '</label>' +
          '<input data-cbsid="SCR050-I01" class="inp" id="cs_reason" data-testid="cs-reason" maxlength="500" autocomplete="off" value="' +
          esc(CS.reason || '') +
          '" oninput="CBSheet.reason(this.value)">' +
          '<button data-cbsid="SCR050-B02" type="button" class="optchip" data-testid="cs-reject-go" onclick="CBSheet.reject()"' +
          (CS.busy ? ' disabled' : '') +
          '>' +
          esc(T('Reject — it goes on the bill')) +
          '</button></div>'
        : '') +
      (CS.note ? '<div class="cs-note" data-testid="cs-note">' + esc(CS.note) + '</div>' : '') +
      (CS.useAsk
        ? '<div class="cs-use" data-testid="cs-use">' +
          billUseChoiceHTML([m], 'CBSheet.use') +
          '<button data-cbsid="SCR050-B03" type="button" class="optchip" data-testid="cs-use-auto" onclick="CBSheet.use(\'\')">' +
          esc(T('Let my catalogue decide')) +
          '</button></div>'
        : '') +
      (showsHistory() ? historyHTML() : '');
    mountSections(node, m);
    if (m.agreement)
      repeatCap().then(function (reply) {
        if (reply && CS.view === m) {
          if (!document.getElementById('rp_panel')) paint();
          else reply.panel(m);
        }
      });
    /* the page form has no "Open page": the person is on it */
    node.querySelector('.cs-acts').innerHTML = actsHTML(m);
  }
  /** the action row: only what this step allows; a refused action is greyed WITH the server's sentence (a sample's are all greyed, and say so) */
  function actsHTML(view) {
    var no = refusedAccept(view),
      noR = refusedReject(view),
      items = actsOf(view).filter(function (item) {
        return !(CS.mode === 'page' && item === 'page');
      });
    /* UX-116 R60: a greyed action says why in a line on the page, not only in a tooltip a phone never shows */
    var line = CS.sample ? '' : (items.indexOf('accept') >= 0 && no) || (items.indexOf('reject') >= 0 && noR) || '';
    if (serverSaid(view) && serverSaid(view).why === line) line = ''; /* the body already says it */
    return (
      (line ? '<p class="cs-why" data-testid="cs-why">' + esc(line) + '</p>' : '') +
      items
        .map(function (item) {
          var why = CS.sample ? T(SAMPLE_SAY) : item === 'accept' ? no : item === 'reject' ? noR : null,
            refused = !!why; /* the server's refusal (actions.accept / .reject): shown, greyed, with its sentence */
          return (
            '<button data-cbsid="SCR050-B04" type="button" class="cs-act" data-testid="cs-act-' +
            item +
            '" onclick="CBSheet.act(\'' +
            item +
            '\')"' +
            (CS.busy || refused ? ' disabled' : '') +
            ' title="' +
            esc(refused ? why : T(ACT[item][1])) +
            '"><span class="ic" aria-hidden="true">' +
            ACT[item][0] +
            '</span><span>' +
            esc(T(ACT[item][1])) +
            '</span></button>'
          );
        })
        .join('')
    );
  }

  var CSS =
    '#chitsheet{border:0;padding:0;margin:auto;width:min(560px,100vw);max-width:100vw;max-height:92dvh;border-radius:14px;background:var(--card,#fff);color:var(--ink,#0F2E3D);box-shadow:var(--shadow,0 12px 34px rgba(15,46,61,.2));overflow:hidden}' +
    '#chitsheet[open]{display:flex;flex-direction:column}#chitsheet::backdrop{background:rgba(15,46,61,.45)}' +
    '#chitsheet.cs-fullpage{width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;margin:0;border-radius:0}' /* PHONE / TABLET: the detail is a full page, one scroll, the action bar at the foot */ +
    '#chitsheet.cs-pane{position:relative;inset:auto;flex:0 0 auto;width:clamp(380px,34vw,520px);height:100%;max-width:none;max-height:none;margin:0;border-radius:0;box-shadow:none;border-inline-start:1px solid var(--line,#E7E2D8)}' /* WIDE: a pane beside the list (a flex sibling in the skeleton row) */ +
    '.cs .cs-top .cs-back{display:flex;align-items:center;gap:6px;padding:0 10px 0 4px;font-size:var(--fs-3,14px);font-weight:700}.cs .cs-top .cs-ttl{flex:1;margin-inline-start:6px}.cs .cs-back-ic{font-size:var(--fs-5,20px);line-height:1}[dir=rtl] .cs .cs-back-ic{display:inline-block;transform:scaleX(-1)}' +
    '.cs .cs-sample{margin:0 0 10px;padding:6px 10px;border:1px dashed var(--prog,#7d6126);border-radius:8px;background:var(--gold-soft,#F7F1E4);color:var(--ink,#0F2E3D);font-size:var(--fs-2,12.5px);font-weight:700}.cs .cs-tax{font-size:var(--fs-1,11px);color:var(--grey,#494F56)}' +
    '.cs .cs-top{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line,#E7E2D8);font-size:var(--fs-3,14px);font-weight:700}' +
    '.cs .cs-top button{cursor:pointer;min-width:44px;min-height:44px;border:0;background:none;font-size:var(--fs-4,16px);color:inherit}' +
    '.cs .cs-top .cs-sid{margin-inline-start:auto;margin-inline-end:4px}.cs .cs-top .cs-sid:empty{display:none}.cs .cs-top .cbsid{min-width:0;min-height:26px;border:1px solid var(--line,#E7E2D8);font-size:var(--fs-1,11px)}' +
    '.cs .cs-body{padding:12px 14px;overflow:auto;flex:1;min-height:0;overscroll-behavior:contain;font-size:var(--fs-2,12.5px)}' +
    '.cs .cs-head{font-size:var(--fs-2,12.5px);color:var(--grey,#494F56)}.cs .cs-who{margin:4px 0 10px;font-size:var(--fs-3,14px);font-weight:700}' +
    '.cs .cs-step{margin-inline-start:6px;border:1px solid var(--line,#E7E2D8);border-radius:99px;padding:1px 8px;font-size:var(--fs-1,11px);font-weight:600;color:var(--prog,#7d6126)}' +
    '.cs .cs-lines{width:100%;border-collapse:collapse;margin:4px 0 8px}.cs .cs-lines th{font-size:var(--fs-1,11px);color:var(--grey,#494F56);text-align:start;font-weight:600}' +
    '.cs .cs-lines td,.cs .cs-lines th{padding:4px 3px;border-bottom:1px solid var(--line,#E7E2D8);vertical-align:top}.cs .n,.cs th.n{text-align:end;white-space:nowrap}.cs .tot td{font-weight:700}' +
    '.cs .cs-off{font-size:var(--fs-1,11px);color:var(--ok,#27794c)}.cs .cs-sec{margin:12px 0 4px;font-size:var(--fs-1,11px);font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--grey,#494F56)}' +
    '.cs .cs-row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}.cs .cs-total{font-size:var(--fs-4,16px);border-top:2px solid var(--ink,#0F2E3D);margin-top:8px;padding-top:6px}' +
    '.cs .cs-order{margin:0 0 10px;padding:8px 10px;border:1px solid var(--gold-line,#E8D9BC);background:var(--gold-soft,#F7F1E4);border-radius:8px}.cs .cs-online{font-weight:700;margin-bottom:4px}.cs .cs-mute{color:var(--grey,#494F56);font-size:var(--fs-1,11px);margin:6px 0}.cs .cs-note{margin-top:10px;padding:8px 10px;border:1px solid var(--gold-line,#E8D9BC);background:var(--gold-soft,#F7F1E4);border-radius:8px}' +
    '.cs .cs-use .optchip{cursor:pointer;min-height:44px;padding:0 12px;margin:2px 2px 2px 0}' +
    '.cs #cs_reason{display:block;width:100%;box-sizing:border-box;min-height:44px;margin:4px 0;padding:0 10px;border:1px solid var(--line,#E7E2D8);border-radius:8px;background:var(--card,#fff);color:inherit;font:inherit}' +
    '.cs .cs-acts{display:flex;gap:4px;flex-wrap:wrap;justify-content:space-around;padding:8px 8px calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--line,#E7E2D8);background:var(--paper,#FAF8F4)}' +
    '.cs .cs-act{cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:68px;min-height:52px;padding:4px 6px;border:0;border-radius:8px;background:none;color:inherit;font-size:var(--fs-1,11px)}' +
    '.cs .cs-why{flex:1 0 100%;margin:0 0 4px;font-size:var(--fs-2,12.5px);color:var(--grey,#494F56)}.cs .cs-act .ic{font-size:20px;line-height:1}.cs .cs-act:disabled{opacity:.5;cursor:default}.cs .cs-act:hover{background:var(--gold-soft,#F7F1E4)}' +
    /* print: while the POPUP is open the rest of the page hides; the page form prints as its page, the action row hidden either way */
    '@media print{body.cs-open>*:not(#chitsheet){display:none!important}#chitsheet{position:static;max-height:none;box-shadow:none}.cs .cs-acts,.cs .cs-top button{display:none}}' +
    /* the page form (CBSheet.mount): the same sections full-width in a page's own element; the title row and the action row are the popup's, without a close button */
    '.cs-page{display:flex;flex-direction:column;border:1px solid var(--line,#E7E2D8);border-radius:14px;background:var(--card,var(--surface,#fff));color:var(--ink,#0F2E3D);max-width:100%;overflow:hidden}' +
    '.cs-page .cs-body{overflow:visible}.cs-page .cs-lines{table-layout:fixed}.cs-page .cs-lines td{overflow-wrap:anywhere}.cs-page .cs-hist span{color:var(--grey,#494F56)}.cs-page .cs-hist b{text-align:end;overflow-wrap:anywhere}';

  /* ── THE SAMPLE (design track): the detail drawn from fixed figures, labelled, so the whole look can be walked before it is wired. Open it with
     openChitSheet('sample') or add ?cs=sample to any page that loads this sheet. Figures are typed here, never worked out; nothing is saved. ── */
  var SAMPLE_SAY = 'This is a sample. Nothing here is saved.';
  function sampleBannerHTML() {
    return CS.sample ? '<div class="cs-sample" data-testid="cs-sample">' + esc(T('Sample — not a real bill')) + '</div>' : '';
  }
  function sampleRead() {
    var fivePercent = { taxable: 1076, cgst: 26.9, sgst: 26.9, tax: 53.8 };
    return {
      header: {
        chit_id: 'sample',
        purpose: 'order',
        current_status: 'pending',
        created_at: '2026-10-12T09:10:00Z',
        manual_subject: 'SO-1',
        all_recipients: [{ role: 'sender', display_name: 'Meena', entity_id: 'sample-meena' }],
        summary_json: {
          total_value: 1129.8,
          order_details: {
            channel: 'online',
            fulfilment: 'pickup',
            address: 'Pick up at the shop',
            requested_delivery: { date: '12 Oct' },
            remark: 'Ring first'
          },
          money: {
            total: 1129.8,
            taxable: 1076,
            tax: 53.8,
            cgst: 26.9,
            sgst: 26.9,
            supply: 'intra',
            by_rate: { 5: fivePercent },
            lines: [
              { total: 525, tax: 25, discount: 0 },
              { total: 604.8, tax: 28.8, discount: 64 }
            ]
          }
        }
      },
      detail: {
        line_items: [
          { particulars: 'Rice', quantity: 5, unit: 'kg', price: 100 },
          { particulars: 'Groundnut oil', quantity: 2, unit: 'L', price: 320, offers: [{ label: 'Festival 10% off', off: 64 }] }
        ]
      },
      state_log: [
        { action: 'created', created_at: '2026-10-12T09:10:00Z', by_name: 'Meena' },
        { action: 'delivered', created_at: '2026-10-12T09:10:05Z', by_name: 'ChitBridge' }
      ]
    };
  }
  function ensureCSS() {
    if (document.getElementById('cs-css')) return;
    var node = document.createElement('style');
    node.id = 'cs-css';
    node.textContent = CSS;
    document.head.appendChild(node);
  }
  function ensureDlg() {
    var node = document.getElementById('chitsheet');
    if (node) return node;
    ensureCSS();
    node = document.createElement('dialog');
    node.id = 'chitsheet';
    node.setAttribute('data-pop', 'POP148');
    node.className = 'cs';
    node.setAttribute('aria-label', T('Bill'));
    node.innerHTML =
      '<div class="cs-top"><button data-cbsid="SCR050-B05" type="button" class="cs-back" data-testid="cs-close" aria-label="' +
      esc(T('Back')) +
      '" onclick="CBSheet.close()"><span class="cs-back-ic" aria-hidden="true">←</span><span>' +
      esc(T('Back')) +
      '</span></button><span class="cs-ttl" data-testid="cs-title">' +
      esc(T('Bill')) +
      '</span><span class="cs-sid" data-testid="cs-screen-id"></span></div><div class="cs-body"></div><div class="cs-acts" data-testid="cs-acts"></div>';
    /* R10-4: a close event is queued; if a new chit was opened meanwhile the sheet is open again and that late event must not wipe it (the read would be dropped and the sheet stay on Reading) */
    node.addEventListener('close', function () {
      if (node.open) return;
      lock(false);
      if (CS.mode === 'dialog') CS.id = null;
      leaveHistory();
    }); /* also the native Esc on the full page */
    node.addEventListener('click', function (e) {
      if (e.target === node) CBSheet.close();
    });
    document.body.appendChild(node);
    return node;
  }
  /* the page behind does not scroll while the sheet is open — and it is not touched, so closing returns to the same place */
  function lock(on) {
    try {
      document.documentElement.style.overflow = on ? 'hidden' : '';
      document.body.classList.toggle('cs-open', !!on);
    } catch (_) {}
  }
  function reset(id) {
    CS.id = id;
    CS.sample = id === 'sample';
    CS.rail = null;
    CS.disp = null;
    CS.chit = null;
    CS.view = null;
    CS.err = null;
    CS.note = null;
    CS.useAsk = false;
    CS.busy = false;
    CS.rejectAsk = false;
    CS.reason = '';
  }
  function readSaid(e) {
    if (e && (e.status === 404 || e.code === 404)) return T("We can't find that bill.");
    return typeof MSG !== 'undefined' && MSG.fail ? MSG.fail('read this chit', e) : T('Could not read this chit');
  }

  /* ── THE PAGE FORM: the same sections, full-width, in a page's own element (CB CRM › crm.html#/chit/<id>) ─────────────────── */
  async function mount(el, id) {
    if (!el || !id) return;
    ensureCSS();
    el.classList.add('cs', 'cs-page');
    el.setAttribute('data-testid', 'cs-page');
    el.innerHTML =
      '<div class="cs-top"><span data-testid="cs-title">' +
      esc(T('Bill')) +
      '</span></div><div class="cs-body"></div><div class="cs-acts" data-testid="cs-acts"></div>';
    CS.mode = 'page';
    CS.el = el;
    CS.page = { el: el, id: id };
    reset(id);
    paint();
    try {
      await read(id);
    } catch (e) {
      if (CS.id !== id || CS.el !== el) return;
      CS.err = readSaid(e);
      paint();
    }
  }

  async function read(id) {
    var r = CS.sample ? sampleRead() : await api('chit', { params: { id: id } });
    if (CS.id !== id) return;
    CS.chit = r;
    CS.view = model(r);
    CS.err = null;
    /* the server's own answer to a move made here wins over a read that still shows the step it left (move) */
    var a = CS.answered[id];
    if (a && stepIn(CS.view.status, 'open') && !stepIn(a, 'open')) CS.view.status = a;
    paint();
  }
  /** seat the dialog where its place wants it: the skeleton's row (pane) or the body (page · popup); a dialog moves only when closed */
  function seat(node, place) {
    var slot = place === 'pane' ? paneSlot() : null,
      home = slot || root.document.body;
    if (node.open && CS.place !== place) node.close();
    if (node.parentNode !== home) home.appendChild(node);
    node.classList.toggle('cs-pane', place === 'pane');
    node.classList.toggle('cs-fullpage', place === 'page');
    CS.place = place;
  }
  /** a phone's Back button closes the full page, like any page (one history step while it is open) */
  function pushPageState() {
    try {
      if (!CS.pushed && root.history && root.history.pushState) {
        root.history.pushState({ csOpen: 1 }, '');
        CS.pushed = true;
      }
    } catch (e) {
      console.error('chit sheet: the Back button could not be wired —', (e && e.message) || e);
    }
  }
  /** the page form's one history step is given back when it closes (the phone's Back already took it when it was Back that closed it) */
  function leaveHistory() {
    if (!CS.pushed) return;
    CS.pushed = false;
    try {
      root.history.back();
    } catch (e) {
      console.error('chit sheet: Back could not step the history —', (e && e.message) || e);
    }
  }
  /** open(id, { act }) — R106: a row's own button opens the sheet AT that action (the Waiting row's Reject asks its reason here, the one Reject door) */
  async function open(id, opts) {
    if (!id) return;
    var dialog = ensureDlg();
    CS.mode = 'dialog';
    CS.el = dialog;
    reset(id);
    seat(dialog, placeFor(root.innerWidth || 0, !!paneSlot()));
    paint();
    lock(CS.place !== 'pane');
    if (!dialog.open) {
      if (CS.place === 'pane' && dialog.show) dialog.show();
      else if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (CS.place === 'page') pushPageState();
    try {
      await read(id);
    } catch (e) {
      if (CS.id !== id) return;
      CS.err = readSaid(e);
      paint();
      return;
    }
    if (opts && opts.act && CS.id === id && CS.view) act(opts.act);
  }
  function retry() {
    return CS.id ? open(CS.id) : undefined;
  }
  /* closing the popup hands the painter back to a page form still on screen (it re-reads: the popup may have moved the chit) */
  function close() {
    var node = document.getElementById('chitsheet');
    if (node && node.open) node.close();
    lock(false);
    CS.id = null;
    var held = node && node.querySelector('.cs-body');
    if (held) held.innerHTML = ''; /* a closed sheet keeps no hidden copy of the bill (two cs-no · cs-hist on one page) */
    leaveHistory();
    var pg = CS.page;
    CS.page = null;
    if (pg && document.body.contains(pg.el)) mount(pg.el, pg.id);
  }

  /**
   * R102 (walk 24 Oct): accepting a bill I received is a money promise — ask first, naming the supplier, the bill and the amount, through the
   * page's one confirm (CBAction.ask → CBConfirm / confirmAsk). true = yes · false = Cancel · null = this page has no confirm, so nothing may be sent.
   */
  function acceptAsk(view) {
    if (!root.CBAction || typeof root.CBAction.ask !== 'function') return Promise.resolve(null);
    var short = view.short || (typeof root.bkWaitShort === 'function' ? root.bkWaitShort(view.id) : null);
    if (short) return root.CBAction.ask(shortAsk(view, short));
    var amount = view.money && view.money.total != null ? fmtMoney(view.money.total, view.cur, '') : '';
    return root.CBAction.ask({
      title: amount ? tf('Accept bill {no} from {who} for {amount}?', { who: view.who, no: view.no, amount: amount }) : tf('Accept bill {no} from {who}?', { who: view.who, no: view.no }),
      body: esc(T('You will owe them this amount.')),
      yes: T('Accept'),
      danger: false
    });
  }
  /**
   * STD1: the SERVER's answers on the chit read — what the books wait on (books_wait: todo · name · why · candidates), may I accept / reject it
   * (actions.accept / .reject), and R106's shortfall figures when the read carries them (books_wait.short, FIELDS waiting[].short).
   */
  function serverAnswers(read) {
    return {
      wait: (read && read.books_wait) || null,
      short: shortOf(read && read.books_wait),
      may: (read && read.actions && read.actions.accept) || null,
      mayReject: (read && read.actions && read.actions.reject) || null
    };
  }
  /** the three shortfall figures as integers, or null — never read from a sentence (FIELDS waiting[].short) */
  function shortOf(wait) {
    var figures = wait && wait.short;
    return figures && isFinite(Number(figures.short_minor)) && Number(figures.short_minor) > 0
      ? { theirs_minor: Number(figures.theirs_minor), ours_minor: Number(figures.ours_minor), short_minor: Number(figures.short_minor) }
      : null;
  }
  /** minor units → the money words (CBMoney says the currency's decimals; fmtMoney the symbol and grouping) */
  function minorWords(minor, currency) {
    var decimals = 2;
    try {
      decimals = root.CBMoney && root.CBMoney.decimals ? root.CBMoney.decimals(currency) : 2;
    } catch (e) {
      if (typeof cblog === 'function') cblog('warn', 'chit sheet: no decimals for ' + currency + ' — two assumed: ' + ((e && e.message) || e));
    }
    return fmtMoney(Number(minor || 0) / Math.pow(10, decimals), currency, '');
  }
  /**
   * R106 (OPS-60): their bill is above what was counted — the accept posts ONE entry at the COUNT and notes the gap, so the question names the
   * counted figure, never their total: "Accept bill SG-1022 from Sri Ganesh Provisions at ₹2,690?" Shared by the sheet and the Waiting row.
   */
  function shortAsk(view, short) {
    var ours = minorWords(short.ours_minor, view.cur);
    return {
      title: tf('Accept bill {no} at {ours}?', { who: view.who, no: view.no, ours: ours }),
      body: esc(tf('{short} short against their {theirs} — noted on the bill. You will owe {who} {ours}.', { who: view.who, short: minorWords(short.short_minor, view.cur), theirs: minorWords(short.theirs_minor, view.cur), ours: ours })),
      yes: tf('Accept at {ours}', { ours: ours }),
      danger: false
    };
  }
  /** Accept (with or without the goods' use): a bill asks first, then the same move every step makes — Cancel sends nothing and the sheet stays as it was; a task just moves */
  async function acceptBill(goodsUse) {
    var view = CS.view;
    if (!view || CS.busy) return;
    if (!view.billRx) return move('act', goodsUse);
    var yes = await acceptAsk(view);
    if (yes === true) return move('act', goodsUse);
    CS.useAsk = false;
    CS.note = yes === null ? T('Nothing sent. This page cannot ask first.') : null;
    paint();
  }
  /* the same move the full page makes: `status` through statusWordFor — then the sheet re-reads and repaints */
  async function move(to, use, note) {
    var m = CS.view,
      id = CS.id;
    if (!m || CS.busy) return;
    CS.busy = true;
    CS.note = null;
    CS.useAsk = false;
    paint();
    try {
      if (use && to === 'act' && m.billRx) await api('billUse', { params: { id: id }, body: { use: use } });
      /* FX-F10W2: Reject is the rail's own step word (STEP_TO reject → rejected), with its reason as the note */
      var word =
        to === 'reject'
          ? 'rejected'
          : typeof statusWordFor === 'function'
            ? statusWordFor(to, { billRx: m.billRx })
            : { open: 'pending', act: m.billRx ? 'accepted' : 'in_progress', close: 'completed' }[to];
      var reply = await api('status', { params: { id: id }, body: note ? { status: word, note: note } : { status: word } });
      if (to === 'reject') {
        CS.rejectAsk = false;
        CS.reason = '';
      }
      if (reply && reply.warning && typeof toast === 'function') toast(reply.warning);
      /* ⭐ FX-F10W: THE ANSWER IS THE STEP — "pending → accepted" (new_status), or "Already accepted" (a noop's status). The sheet paints it
         now and keeps it over a read that has not caught up, so a second tap is never offered for what the server already did. */
      var now = (reply && (reply.new_status || (reply.noop && reply.status))) || null;
      if (now) CS.answered[id] = String(now);
      try {
        var i = (UI.rows || []).findIndex(function (x) {
          return x.id === id;
        });
        if (i >= 0) UI.rows[i].state = to;
      } catch (_) {}
      await read(id);
      /* the Waiting row leaves at once (bkWaitGone — the row flipped, no reload); the Day book's to-do is the server's: read again behind it */
      /* FX-F10W2: a rejection closes the row on the server too ("Rejected — not posted") — so it leaves the list the same way */
      if (now && !stepIn(now, 'open') && typeof root.bkWaitGone === 'function') root.bkWaitGone(id);
      if (typeof root.bkHealthLoad === 'function')
        root
          .bkHealthLoad()
          .then(function () {
            if (typeof BK !== 'undefined' && BK.tab && BK.tab !== 'waiting' && typeof bkTab === 'function') bkTab(BK.tab, true);
          })
          .catch(function (e) {
            console.error('chit sheet: the Books to-do could not be read again —', (e && e.message) || e);
            CS.note = T('Done. The Books to-do did not refresh — open it again to see it.');
            paint();
          });
    } catch (e) {
      CS.note = typeof MSG !== 'undefined' && MSG.fail ? MSG.fail('change status', e) : T('Could not change it');
    }
    CS.busy = false;
    paint();
  }

  /** the ⚑ Dispute button: in the sheet's own section where the page has one, else the page's form, else Tasks › Disputes on this chit (RAIL-86) */
  function raiseDispute(id) {
    /* T3: where the dispute capability is on the page (CBDispute), Raise opens IN the sheet's own dispute section — greyed there with the server's why */
    if (root.CBDispute && root.CBDispute.sheet && CS.disp && CS.disp.id === id) {
      root.CBDispute.raise();
      return;
    }
    /* the full page's own dispute form; it opens over the app (not over the sheet), and puts the sheet back when it is raised */
    if (typeof quickDispute === 'function') {
      close();
      quickDispute(id, { back: true });
      return;
    }
    /* RAIL-86: a page with no dispute form of its own (Accounts · Finance · CRM) opens Tasks › Disputes on THIS chit, where the server's may/why is shown - never a button that closes the sheet and does nothing */
    if (typeof disputePageHref === 'function') {
      close();
      window.open(disputePageHref(id), '_blank', 'noopener');
      return;
    }
    CS.note = T('Raise a dispute from Tasks & Orders › Disputes.');
    paint();
  }

  function act(k) {
    var m = CS.view,
      id = CS.id;
    if (!m) return;
    if (actsOf(m).indexOf(k) < 0) return; /* a stale tap on an action this step no longer allows */
    if (k === 'accept' && refusedAccept(m)) return; /* greyed: the server refused it, and said why */
    if (k === 'reject') {
      if (refusedReject(m)) return;
      CS.rejectAsk = true;
      CS.useAsk = false;
      CS.note = null;
      paint();
      var node = document.getElementById('cs_reason');
      if (node) node.focus();
      return;
    }
    if (k === 'supplier') {
      var nm = serverSaid(m).name;
      if (typeof root.bkAddSupplier !== 'function') {
        CS.note = T('Add them on the Suppliers page.');
        return paint();
      }
      CS.busy = true;
      paint();
      return root
        .bkAddSupplier(nm)
        .then(function (said) {
          CS.busy = false;
          CS.note = said || null;
          return read(id);
        })
        .catch(fixFailed);
    }
    /* a bill received asks what the goods are for BEFORE the acceptance it decides (the same choice Goods in shows) — a task just moves */
    if (k === 'accept') {
      if (m.billRx && !m.captured) {
        CS.useAsk = true;
        CS.note = null;
        return paint();
      }
      return acceptBill(); /* R102: a bill is a money promise — it asks first; a task just moves */
    }
    if (k === 'done') return move('close');
    if (k === 'goodsin') {
      CS.useAsk = true;
      CS.note = null;
      return paint();
    }
    if (k === 'print') {
      try {
        window.print();
      } catch (_) {}
      return;
    }
    if (k === 'return') {
      CS.note = T('Returns are made at the counter, against the bill.');
      return paint();
    }
    if (k === 'dispute') return raiseDispute(id);
    if (k === 'repeat') {
      repeatCap().then(function (reply) {
        if (reply) reply.start(id, m);
        else {
          CS.note = T('Repeat supply is not available on this page.');
          paint();
        }
      });
      return;
    }
    if (k === 'page') {
      CS.pushed = false;
      close();
      var pg = typeof openChitPage === 'function' ? openChitPage : openChit;
      if (typeof pg === 'function') pg(id);
    }
  }

  /* FX-F10W: "Is this Sri Ganesh Provisions (P-00001)?" — the same link the Waiting row makes (cap-books bkLinkSupplier), then the sheet reads again */
  /* FX-F10W2: Reject with its reason — the server needs one (actions.reject.needs; PUT /status refuses a bill's reject without it) */
  function reject() {
    var why = String(CS.reason || '').trim();
    if (!why) {
      CS.note = T('Type the reason first.');
      return paint();
    }
    return move('reject', null, why);
  }
  function link(j) {
    var m = CS.view,
      id = CS.id,
      said = serverSaid(m),
      c = said && said.cands[j];
    if (!c || CS.busy) return;
    if (typeof root.bkLinkSupplier !== 'function') {
      CS.note = T('Add them on the Suppliers page.');
      return paint();
    }
    CS.busy = true;
    paint();
    return root
      .bkLinkSupplier(id, c)
      .then(function (err) {
        CS.busy = false;
        CS.note = err || null;
        return read(id);
      })
      .catch(fixFailed);
  }
  /* STD1: a supplier fix (add / link) or the read after it threw — logged, and said: what happened and what to do */
  function fixFailed(e) {
    console.error('chit sheet: the supplier fix or the read after it failed —', (e && e.message) || e);
    CS.busy = false;
    CS.note = T('That did not finish. Close this bill and open it again to see where it is.');
    paint();
  }

  root.CBSheet = {
    reject: reject,
    reason: function (v) {
      CS.reason = String(v == null ? '' : v);
    },
    link: link,
    isThis: isThis,
    orderHTML: orderHTML,
    moneyFor: moneyFor,
    moneyBlockHTML: moneyBlockHTML,
    open: open,
    close: close,
    retry: retry,
    placeFor: placeFor,
    sample: function () {
      return model(sampleRead());
    },
    place: function () {
      return CS.place;
    },
    mount: mount,
    act: act,
    use: function (u) {
      return acceptBill(u); /* the goods' use chosen (Accept or Goods in on a bill) — R102: the accept asks first */
    },
    isDead: function (s) {
      return stepIn(s, 'dead'); /* the rail's two dead ends (cancelled, rejected): the one list, read by the Mark-paid button */
    },
    actionsFor: actionsFor,
    model: model,
    shortAsk: shortAsk /* R106: the Waiting row asks the same question the sheet asks */,
    titleFor: titleFor,
    stepWord: function (m) {
      return T(STEP[m.status] || m.status);
    }
  };
  root.openChitSheet = open;
  /* the browser's Back (a phone) and Escape (a pane is not modal, so the dialog does not close itself) */
  if (root.addEventListener) {
    root.addEventListener('popstate', function () {
      if (CS.pushed) {
        CS.pushed = false;
        close();
      }
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !e.defaultPrevented && CS.place === 'pane' && CS.id && CS.mode === 'dialog') close();
    });
    /* ?cs=sample on any page that loads the sheet shows the sample detail (the design walk) */
    root.addEventListener('load', function () {
      if (root.location && /[?&]cs=sample\b/.test(root.location.search || ''))
        setTimeout(function () {
          open('sample');
        }, 500);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
