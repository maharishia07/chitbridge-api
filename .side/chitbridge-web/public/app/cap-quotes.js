/* app/cap-quotes.js — QUOTES: the rounds of a chit that is a quotation (RAIL-117). ONE painter, mounted wherever a chit is shown.
 * OWNS      CBQuotes.mount(host, chitId) · refresh(chitId) · steps(host, ...) · askCross(party, onYes) · crossOf(chit) · CB_QUOTE_EP
 * CALLED BY app.html (ensureCap('quotes') then CBQuotes in the chit pane's Rounds section mount and the first-send confirm, CBQuotes.askCross) · app/chit-sheet.js quotesMount (the chit sheet on crm.html and tasks.html — F8) · loaded by crm.html and tasks.html (<script src>) · tasks.html?view=quotes is ORD-68, not built (no such view in app/cap-tasks.js)
 * FLOW      mount(host, chitId) ──▶ load: GET chit + GET proposals ──▶ paint (banner · tracker · rounds · buttons · form) ──▶ accept / reject / send ──▶ writeRound: confirm ──▶ steps ──▶ load again ──▶ paint
 * CARD      01-rail-core-the-chit/chit-proposal
 *
 * Athi, 2026-10-25 (DECISIONS 13:10 · 13:50 · 14:10): a price from another installation or in another currency is a QUOTATION until the seller
 * confirms it; the buyer sees the steps, not a spinner; RFQ ("Ask for a quote") is a deal type, the cart stays the default.
 *
 * ⭐ THE SELLER COMPUTES, EVERYONE ELSE SHOWS. This file never works a price, a tax or a total out: the buyer sends a quantity and an asked price
 *   (text, never a computation), the seller sends a price per line and the SERVER works the round out (lib/chit-proposal). Every figure painted
 *   here is the round's own `money`, in the seller's currency.
 * ⭐ WORDS FROM THE DATA. "Quotation only — <seller country> rules apply; duties and taxes in <buyer country> not included" is filled from
 *   business_json.jurisdiction and the round's jurisdiction; nothing is hard-coded to a country.
 * ⭐ A SEND IS CONFIRMED (money promise): accept, reject, a seller's price and a counter all ask first (CBAction.run), naming who and what.
 * ⭐ NEVER REPAINT A FORM BEING TYPED IN: refresh() leaves an open counter form alone (feedback: loader never repaints open form).
 */
(function (root) {
  'use strict';

  var CB_QUOTE_EP = {
    quoteList: { m: 'GET', p: '/api/chits/:id/proposals', ok: 'y' }, // { proposals[], migrated } — my copy's rounds, newest last
    quotePropose: { m: 'POST', p: '/api/chits/:id/proposals', ok: 'y', idem: 'attempt' }, // the seller prices · anyone else asks
    quoteAccept: { m: 'POST', p: '/api/chits/:id/proposals/:pid/accept', ok: 'y', idem: 'attempt' },
    quoteReject: { m: 'POST', p: '/api/chits/:id/proposals/:pid/reject', ok: 'y', idem: 'attempt' },
    quoteCounter: { m: 'POST', p: '/api/chits/:id/proposals/:pid/counter', ok: 'y', idem: 'attempt' }
  };
  root.CB_QUOTE_EP = CB_QUOTE_EP;

  var STATE = {}; /* chit id -> { host, chit, rounds, form, steps } */

  function translate(text) {
    return typeof root.tx === 'function' ? root.tx(text) : text;
  }
  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (_, field) {
      return values[field] == null ? '' : values[field];
    });
  }
  function call(key, options) {
    /* app.html declares `const EP` at the top of a classic script: a global BINDING, not a window property, so root.EP is undefined there and
       the rounds were never registered ("Could not read the rounds" on SIT, 25 Oct). Reach it by name, as core.js epOf does; a page that puts
       EP on window still works. */
    var endpoints = typeof EP !== 'undefined' ? EP : root.EP; // eslint-disable-line no-undef
    if (endpoints) for (var endpointKey in CB_QUOTE_EP) if (!endpoints[endpointKey]) endpoints[endpointKey] = CB_QUOTE_EP[endpointKey];
    return root.api(key, options);
  }
  /** a country (code or name) as a person reads it: "AU" -> Australia; a name stays */
  function countryName(country) {
    var text = String(country || '').trim();
    if (!text) return '';
    if (/^[A-Za-z]{2}$/.test(text)) {
      try {
        return new Intl.DisplayNames(['en'], { type: 'region' }).of(text.toUpperCase()) || text;
      } catch (e) {
        return text;
      }
    }
    return text;
  }

  /* ── what the chit is: who sells, who buys, where ─────────────────────────────────────────────── */
  /** { seller: bool (I price), other: name, jurisdiction, rfq, currency } from the chit read (GET /api/chits/:id) */
  function readChit(chitRead) {
    var read = chitRead || {},
      header = read.header || {},
      business = header.business_json || {},
      detail = read.detail || {};
    return {
      id: header.chit_id,
      seller: sellerOf(header),
      other: otherOf(header) || translate('the other business'),
      jurisdiction: business.jurisdiction || null,
      rfq: business.deal_type === 'rfq',
      currency: currencyOf(header, detail),
      unconfirmed: read.ctp_unconfirmed || null,
      lines: linesOf(read, detail)
    };
  }
  /** did this installation's entity send the chit? */
  function sentByMe(header) {
    return String(header.sender_entity_id || '') === String(header.entity_id || '');
  }
  /** do I price it? An order or offer is priced by whoever did not send it; anything else by the sender */
  function sellerOf(header) {
    var orderLike = /^(order|offer)$/.test(String(header.purpose || ''));
    return orderLike ? !sentByMe(header) : sentByMe(header);
  }
  /** the other business: the sender when I received it, else the first recipient who is not the sender */
  function otherOf(header) {
    if (!sentByMe(header)) return header.sender_entity_display_name || '';
    var sender = String(header.sender_entity_id || '');
    var recipients = (header.all_recipients || []).filter(function (recipient) {
      return recipient && String(recipient.entity_id) !== sender;
    });
    return (recipients[0] && recipients[0].display_name) || '';
  }
  function currencyOf(header, detail) {
    return detail.currency_code || header.currency_code || (header.summary_json && header.summary_json.currency_code) || '';
  }
  /** the chit's lines as the rounds name them: the live set when the read has one, else the detail's lines */
  function linesOf(read, detail) {
    var liveSet = Array.isArray(read.live_set) ? read.live_set : (detail.line_items || []).map(function (line) { return { live: line }; });
    return liveSet.map(function (entry, position) {
      var line = (entry && (entry.live || entry.original)) || {};
      return { index: position, line_id: line.line_id || null, name: line.particulars || translate('Item'), quantity: line.quantity, price: line.price, removed: !!(entry && entry.removed) };
    });
  }
  /** does this chit need the rounds at all? A cross-installation or RFQ chit says so on its header; anything else is exactly as before (DECISIONS 14:10) */
  function crossOf(chit) {
    return root.chitIsQuote(chit); /* F10: the one predicate lives in helpers.js */
  }

  /* ── the words ────────────────────────────────────────────────────────────────────────────────── */
  /** the jurisdiction line, filled from the data: Quotation only … / Pro-forma */
  function wordsOf(chit, rounds) {
    var jurisdiction = Object.assign({}, chit.jurisdiction || {});
    var withJ = rounds.filter(function (round) { return round.jurisdiction; });
    if (withJ.length) Object.assign(jurisdiction, withJ[withJ.length - 1].jurisdiction);
    var agreed = rounds.some(function (round) { return round.status === 'accepted' && round.kind === 'pro_forma'; });
    if (agreed) return { tone: 'ok', text: translate('Pro-forma — agreed by both sides') };
    if (jurisdiction.document !== 'quotation') return { tone: 'plain', text: '' };
    /* F12: never print an installation KEY as a country ("sit-au rules apply"); before the first priced round the seller's country may be unset */
    var seller = countryName(jurisdiction.seller_country) || translate('the seller’s');
    var buyer = countryName(jurisdiction.buyer_country);
    var tail = buyer ? fill(translate('duties and taxes in {country} not included'), { country: buyer }) : translate('your duties and taxes are not included');
    return { tone: 'warn', text: fill(translate('Quotation only — {seller} rules apply; {tail}'), { seller: seller, tail: tail }) };
  }
  var KIND = { request: 'Request', pro_forma: 'Quotation', change: 'Change', terms: 'Terms' };
  var STATUS = { proposed: 'Waiting', accepted: 'Agreed', rejected: 'Rejected', countered: 'Answered with a request', superseded: 'Replaced' };

  /* ── the step tracker (a sequence, not a spinner) ─────────────────────────────────────────────── */
  function stepLi(label, state, testId) {
    var mark = state === 'done' ? '✓' : state === 'now' ? '…' : '○';
    return '<li data-testid="' + testId + '" data-step="' + state + '"><span aria-hidden="true">' + mark + '</span> ' + root.esc(label) + '</li>';
  }
  /** the tracker ON the chit, read from the rounds and the unconfirmed mark: Request sent · Reached · Priced · Accepted */
  /** the "Reached …" step, or "Waiting for …" while the other installation has not confirmed */
  function reachedStep(chit) {
    var where = (chit.jurisdiction && (chit.chit_installation || chit.jurisdiction.seller_installation || chit.jurisdiction.buyer_installation)) || chit.other;
    return chit.unconfirmed
      ? stepLi(fill(translate('Waiting for {where} — not delivered yet'), { where: where }), 'now', 'quote-step-reached')
      : stepLi(fill(translate('Reached {name}'), { name: chit.other }), 'done', 'quote-step-reached');
  }
  function trackerHTML(chit, rounds) {
    var priced = rounds.some(function (round) { return round.kind === 'pro_forma' || round.kind === 'change'; });
    var agreed = rounds.some(function (round) { return round.status === 'accepted'; });
    var waiting = chit.unconfirmed;
    var out = [stepLi(chit.seller ? translate('Request received') : translate('Request sent'), 'done', 'quote-step-sent'), reachedStep(chit)];
    out.push(stepLi(chit.seller ? translate('You price it') : fill(translate('{name} prices it (a quotation)'), { name: chit.other }), priced ? 'done' : waiting ? 'todo' : 'now', 'quote-step-priced'));
    out.push(stepLi(chit.seller ? translate('They accept — it becomes the pro-forma') : translate('You accept — it becomes the pro-forma'), agreed ? 'done' : priced ? 'now' : 'todo', 'quote-step-accepted'));
    return '<ol class="cq-steps" data-testid="quote-tracker" aria-label="' + root.esc(translate('Where this quotation stands')) + '" style="list-style:none;margin:6px 0;padding:0;font-size:var(--fs-2)">' + out.join('') + '</ol>';
  }
  /**
   * steps(host, { name, where }) — the live steps of ONE action that crosses to another installation (DECISIONS 13:50): Contacting … · Sent · Waiting for … · Answered.
   * Returns { sent(), waiting(), answered(), failed(words) }; each paints into host (an element) and says the stage to a screen reader.
   */
  function steps(host, party) {
    var el = typeof host === 'string' ? document.getElementById(host) : host;
    var names = [
      fill(translate('Contacting {name} on {where}'), { name: party.name, where: party.where || translate('their ChitBridge') }),
      translate('Sent'),
      fill(translate('Waiting for {name}’s answer'), { name: party.name }),
      translate('Answered')
    ];
    var stage = 0;
    function paint(failedWords) {
      if (!el) return;
      el.setAttribute('role', 'status');
      el.setAttribute('data-testid', 'quote-steps');
      el.innerHTML =
        '<ol style="list-style:none;margin:6px 0;padding:0;font-size:var(--fs-2)">' +
        names.map(function (label, position) { return stepLi(label, failedWords && position === stage ? 'now' : position < stage ? 'done' : position === stage ? 'now' : 'todo', 'quote-steps-' + position); }).join('') +
        '</ol>' + (failedWords ? '<div data-tone="error" data-testid="quote-steps-failed">' + root.esc(failedWords) + '</div>' : '');
    }
    paint();
    return {
      sent: function () { stage = 1; paint(); },
      waiting: function () { stage = 2; paint(); },
      answered: function () { stage = 3; paint(); },
      failed: function (words) { paint(words || translate('That did not go through — try again')); }
    };
  }

  /* ── the confirm before the FIRST send to a business on another installation (money promise) ── */
  function askCross(party, onYes, onNo) {
    var askConfirm = typeof root.confirmAsk === 'function' ? root.confirmAsk : typeof root.CBConfirm === 'function' ? root.CBConfirm : null;
    if (!askConfirm) return; /* no dialog on the page = nothing sent (never confirm()) */
    var seller = countryName(party.country);
    var body =
      '<div data-testid="quote-cross-confirm"><b>' + root.esc(party.name) + '</b> ' +
      root.esc(fill(translate('is on another ChitBridge{where}.'), { where: party.where ? ' (' + party.where + (seller ? ', ' + seller : '') + ')' : seller ? ' (' + seller + ')' : '' })) +
      '<ul style="margin:8px 0 0;padding-inline-start:18px">' +
      (party.currency ? '<li>' + root.esc(fill(translate('Their prices are in {cur}.'), { cur: party.currency })) + '</li>' : '') +
      (seller ? '<li>' + root.esc(fill(translate('{country} law and tax apply.'), { country: seller })) + '</li>' : '') +
      (party.buyerCountry ? '<li>' + root.esc(fill(translate('{country}’s import duty and taxes are not included.'), { country: countryName(party.buyerCountry) })) + '</li>' : '') +
      '<li>' + root.esc(translate('A quotation, not a sale. Nothing binds until you accept.')) + '</li></ul></div>';
    askConfirm(fill(translate('Ask {name} for a quote?'), { name: party.name }), body, translate('Send'), onYes, false, onNo);
  }

  /* ── reading ──────────────────────────────────────────────────────────────────────────────────── */
  function load(id) {
    var view = STATE[id];
    return Promise.all([call('chit', { params: { id: id } }), call('quoteList', { params: { id: id } })]).then(function (res) {
      if (!STATE[id]) return null;
      view.chit = readChit(res[0]);
      view.rounds = (res[1] && res[1].proposals) || [];
      view.migrated = !res[1] || res[1].migrated !== false;
      view.err = null;
      return view;
    });
  }
  function paint(id) {
    var view = STATE[id];
    if (!view || !view.host || !view.host.isConnected) return;
    view.host.innerHTML = html(view);
  }

  /** has the person got a form open here? A refresh then leaves the screen alone */
  function formOpen(view) {
    return !!(view.host && view.host.querySelector('[data-quote-form]'));
  }
  /** refresh(chitId) — a return-path event arrived: read again and repaint, unless a form is being typed in */
  function refresh(id) {
    var view = STATE[String(id)];
    if (!view || !view.host || !view.host.isConnected || formOpen(view) || view.busy) return Promise.resolve(false);
    return load(String(id))
      .then(function () {
        if (!formOpen(view)) paint(String(id));
        return true;
      })
      .catch(function (e) {
        if (root.console) console.warn('quotes: refresh failed', e && e.message);
        return false;
      });
  }
  function mount(host, id) {
    id = String(id);
    var el = typeof host === 'string' ? document.getElementById(host) : host;
    if (!el) return Promise.resolve(null);
    STATE[id] = { host: el, chit: null, rounds: [], form: null, busy: false };
    el.setAttribute('data-testid', 'quotes');
    el.innerHTML = '<div class="sec">' + root.esc(translate('Rounds')) + '</div><div style="color:var(--grey);font-size:var(--fs-2)">' + root.esc(translate('Reading…')) + '</div>';
    return load(id)
      .then(function () {
        paint(id);
        return STATE[id];
      })
      .catch(function (e) {
        if (root.console) console.warn('quotes: could not read the rounds', e && e.message);
        if (STATE[id] && el.isConnected)
          el.innerHTML = '<div class="sec">' + root.esc(translate('Rounds')) + '</div><div data-tone="error" data-testid="quotes-error">' + root.esc(translate('Could not read the rounds.')) + ' <button type="button" data-testid="quotes-retry" onclick="CBQuotes.mount(this.parentNode.parentNode,\'' + root.esc(id) + '\')" data-cbsid="CMP009">' + root.esc(translate('Try again')) + '</button></div>';
        return null;
      });
  }

  /* ── painting ─────────────────────────────────────────────────────────────────────────────────── */
  function roundMoney(round, currency) {
    var money = round.money;
    if (!money) return '';
    var total = money.total != null ? money.total : money.net;
    return '<div data-testid="quote-money-' + round.round + '"><b>' + root.esc(root.fmtMoney(total, round.currency_code || currency, '—')) + '</b>' +
      (money.tax != null ? ' <span style="color:var(--grey)">' + root.esc(fill(translate('incl. tax {tax}'), { tax: root.fmtMoney(money.tax, round.currency_code || currency, '—') })) + '</span>' : '') + '</div>' +
      (round.tax_note ? '<div style="color:var(--grey);font-size:var(--fs-1)">' + root.esc(round.tax_note) + '</div>' : '');
  }
  function lineName(view, idx) {
    var line = (view.chit.lines || [])[idx];
    return line ? line.name : translate('Item');
  }
  function roundBody(view, round) {
    var currency = view.chit.currency;
    var out = '';
    if (round.kind === 'request' && round.request && round.request.lines && round.request.lines.length) {
      out += '<ul style="margin:4px 0;padding-inline-start:18px">' + round.request.lines.map(function (line) {
        return '<li>' + root.esc(lineName(view, line.line_index) + (line.quantity != null ? ' × ' + line.quantity : '') + (line.requested_price ? ' · ' + fill(translate('asked {price}'), { price: line.requested_price }) : '') + (line.remove ? ' · ' + translate('remove') : '')) + '</li>';
      }).join('') + '</ul>';
    } else if (round.kind === 'terms' && round.terms) {
      out += '<div>' + root.esc(Object.keys(round.terms).map(function (key) { return key.replace(/_/g, ' ') + ': ' + round.terms[key]; }).join(' · ')) + '</div>';
    } else {
      out += roundMoney(round, currency);
    }
    if (round.note) out += '<div style="font-style:italic">“' + root.esc(round.note) + '”</div>';
    return out;
  }
  function roundHTML(view, round) {
    var speaker = round.mine ? translate('You') : round.from_name || view.chit.other;
    var label = round.label || KIND[round.kind] || '';
    var statusText = translate(STATUS[round.status] || round.status || '');
    var acts = '';
    if (round.awaiting_me) {
      acts =
        '<div class="cq-acts" style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">' +
        (round.kind !== 'request' ? '<button data-cbsid="SCR060-B01" type="button" class="pri" data-testid="quote-accept-' + round.round + '" data-action-state="idle" onclick="CBQuotes.accept(\'' + root.esc(view.chit.id) + '\',\'' + root.esc(round.proposal_id) + '\',this)">' + root.esc(translate('Accept')) + '</button>' : '') +
        '<button data-cbsid="SCR060-B02" type="button" data-testid="quote-counter-' + round.round + '" onclick="CBQuotes.openForm(\'' + root.esc(view.chit.id) + '\',\'' + root.esc(round.proposal_id) + '\')">' + root.esc(view.chit.seller ? translate('Price it') : translate('Counter')) + '</button>' +
        '<button data-cbsid="SCR060-B03" type="button" class="warn" data-testid="quote-reject-' + round.round + '" onclick="CBQuotes.reject(\'' + root.esc(view.chit.id) + '\',\'' + root.esc(round.proposal_id) + '\',this)">' + root.esc(translate('Reject')) + '</button></div>';
    }
    return '<div class="itab" data-testid="quote-round-' + round.round + '" data-status="' + root.esc(round.status) + '" style="padding:9px;margin-top:7px">' +
      '<div style="display:flex;justify-content:space-between;gap:8px"><span><b>' + root.esc(fill(translate('Round {n}'), { n: round.round })) + '</b> · ' + root.esc(speaker) + ' · ' + root.esc(label) + '</span>' +
      '<span data-testid="quote-status-' + round.round + '" style="color:var(--grey)">' + root.esc(statusText) + '</span></div>' + roundBody(view, round) + acts + '</div>';
  }
  /** the form: the buyer's request (quantity + asked price per line, text) or the seller's price (a price per line) */
  function formHTML(view) {
    var seller = view.chit.seller;
    var rows = (view.chit.lines || []).filter(function (line) { return !line.removed; }).map(function (line) {
      return '<div class="cq-line" style="display:grid;grid-template-columns:minmax(0,1fr) 84px 110px;gap:6px;align-items:center;margin-top:5px">' +
        '<span>' + root.esc(line.name) + '</span>' +
        '<input data-cbsid="SCR060-I01" class="inp" type="text" inputmode="numeric" data-testid="quote-qty-' + line.index + '" data-line="' + line.index + '" data-f="quantity" value="' + root.esc(line.quantity != null ? line.quantity : '') + '" aria-label="' + root.esc(fill(translate('Quantity of {name}'), { name: line.name })) + '">' +
        '<input data-cbsid="SCR060-I02" class="inp" type="text" inputmode="text" data-testid="quote-price-' + line.index + '" data-line="' + line.index + '" data-f="' + (seller ? 'price' : 'requested_price') + '" value="' + (seller ? root.esc(line.price != null ? line.price : '') : '') + '" placeholder="' + root.esc(seller ? view.chit.currency || '' : translate('price you want')) + '" aria-label="' + root.esc(seller ? fill(translate('Price of {name}'), { name: line.name }) : fill(translate('Price you want for {name}'), { name: line.name })) + '"></div>';
    }).join('');
    return '<div data-quote-form="1" data-testid="quote-form" class="itab" style="padding:9px;margin-top:8px"><div class="sec" style="margin:0">' + root.esc(seller ? translate('Your price') : translate('Your counter')) + '</div>' +
      '<div style="color:var(--grey);font-size:var(--fs-1)">' + root.esc(seller ? fill(translate('Prices in {cur}. Tax is added when you send.'), { cur: view.chit.currency || '' }) : translate('Say how many and the price you want. {name} sets the price.').replace('{name}', view.chit.other)) + '</div>' +
      rows +
      '<textarea data-cbsid="SCR060-T01" class="inp" data-testid="quote-note" rows="2" style="width:100%;margin-top:7px" placeholder="' + root.esc(translate('A note (optional)')) + '"></textarea>' +
      '<div style="margin-top:7px;display:flex;gap:8px"><button data-cbsid="SCR060-B04" type="button" class="pri" data-testid="quote-send" data-action-state="idle" onclick="CBQuotes.send(\'' + root.esc(view.chit.id) + '\',this)">' + root.esc(seller ? translate('Send price') : translate('Send counter')) + '</button>' +
      '<button type="button" data-testid="quote-cancel" onclick="CBQuotes.closeForm(\'' + root.esc(view.chit.id) + '\')" data-cbsid="CMP003">' + root.esc(translate('Cancel')) + '</button></div>' +
      '<div data-testid="quote-out" role="status" style="margin-top:5px"></div>' + '</div>';
  }
  /** the jurisdiction banner (Quotation only … / Pro-forma …), or nothing */
  function bannerHTML(words) {
    return words.text
      ? '<div data-testid="quote-jurisdiction" data-tone="' + words.tone + '" style="margin:4px 0;padding:7px 9px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)">' + root.esc(words.text) + '</div>'
      : '';
  }
  /** the "not delivered yet" line while the other installation has not confirmed, or nothing */
  function unconfirmedHTML(chit) {
    return chit.unconfirmed
      ? '<div data-testid="quote-unconfirmed" data-tone="warn" style="margin:4px 0;font-size:var(--fs-2)">⏳ ' + root.esc(chit.unconfirmed.words || fill(translate('Waiting for {where} — not delivered yet'), { where: (chit.jurisdiction && (chit.jurisdiction.seller_installation || chit.jurisdiction.buyer_installation)) || chit.other })) + '</div>'
      : '';
  }
  /** the rounds, newest last; before the first one, who we are waiting for */
  function roundListHTML(view) {
    var chit = view.chit;
    return view.rounds.length
      ? view.rounds.map(function (round) { return roundHTML(view, round); }).join('')
      : '<div data-testid="quote-none" style="color:var(--grey);font-size:var(--fs-2);margin-top:6px">' + root.esc(chit.seller ? fill(translate('{name} has not priced yet. Nothing is asked of you.'), { name: chit.other }) : fill(translate('Waiting for {name} to price your request.'), { name: chit.other })) + '</div>';
  }
  /** the buttons under the rounds: the seller's first price, the buyer's ask again */
  function startButtonsHTML(view) {
    var chit = view.chit;
    var openNew = !view.rounds.length && chit.seller
      ? '<button data-cbsid="SCR060-B05" type="button" class="pri" data-testid="quote-price-new" onclick="CBQuotes.openForm(\'' + root.esc(chit.id) + '\',\'\')">' + root.esc(translate('Price this request')) + '</button>'
      : '';
    var live = view.rounds.some(function (round) { return round.status === 'proposed'; });
    var again = view.rounds.length && !live && !chit.seller && view.rounds.some(function (round) { return round.status !== 'accepted'; })
      ? '<button data-cbsid="SCR060-B06" type="button" data-testid="quote-ask-again" onclick="CBQuotes.openForm(\'' + root.esc(chit.id) + '\',\'\')">' + root.esc(translate('Ask again')) + '</button>' : '';
    return '<div style="margin-top:7px">' + openNew + again + '</div>';
  }
  function html(view) {
    var chit = view.chit;
    var head = '<div class="sec">' + root.esc(translate('Rounds')) + '</div>';
    return head + bannerHTML(wordsOf(chit, view.rounds)) + unconfirmedHTML(chit) + trackerHTML(chit, view.rounds) + roundListHTML(view) + startButtonsHTML(view) + (view.form ? formHTML(view) : '') + '<div data-testid="quote-steps-host" id="quote-steps-' + root.esc(chit.id) + '"></div>';
  }

  /* ── doing ────────────────────────────────────────────────────────────────────────────────────── */
  function whereOf(view) {
    var jurisdiction = view.chit.jurisdiction || {};
    return view.chit.seller ? jurisdiction.buyer_installation : jurisdiction.seller_installation;
  }
  function stepsFor(view) {
    return steps(document.getElementById('quote-steps-' + view.chit.id), { name: view.chit.other, where: whereOf(view) });
  }
  /** one write: confirm, the steps, the answer, then the rounds read again */
  function writeRound(id, button, config) {
    var view = STATE[String(id)];
    if (!view) return;
    var stepsControl = null;
    return root.CBAction.run(
      button,
      function () {
        view.busy = true;
        stepsControl = stepsFor(view);
        return call(config.key, { params: config.params, body: config.body }).then(function (reply) {
          stepsControl.sent();
          var held = reply && reply.ctp && (reply.ctp.queued || reply.ctp.why);
          if (held) {
            /* the other side did not confirm: say it, never "sent" (silence is the bug) */
            stepsControl.waiting();
            view.notice = (reply.ctp.why) || fill(translate('Waiting for {where} — not delivered yet'), { where: whereOf(view) || view.chit.other });
          } else {
            stepsControl.answered();
            view.notice = null;
          }
          return reply;
        });
      },
      {
        key: config.tid + ':' + id,
        confirm: config.confirm,
        out: view.host.querySelector('[data-testid="quote-out"]') || null,
        done: config.done,
        failed: config.failed,
        onFail: function (words) {
          if (stepsControl) stepsControl.failed(words);
          else if (root.toast) root.toast(words);
        }
      }
    ).then(function (res) {
      return afterAct(view, id, res);
    });
  }
  /** after a write: on success close the form, read the rounds again, say a held send, tell the page */
  function afterAct(view, id, res) {
    view.busy = false;
    if (!(res && res.ok)) return undefined;
    view.form = null;
    return load(String(id)).then(function () {
      paint(String(id));
      var host = view.host.querySelector('[data-testid="quote-steps-host"]');
      if (host && view.notice) host.insertAdjacentHTML('beforeend', '<div data-tone="warn" data-testid="quote-notice">⏳ ' + root.esc(view.notice) + '</div>');
      if (typeof root.CBQuotes.onChange === 'function') root.CBQuotes.onChange(id);
    });
  }
  function roundOf(view, proposalId) {
    return view.rounds.filter(function (round) { return round.proposal_id === proposalId; })[0] || null;
  }
  function accept(id, proposalId, button) {
    var view = STATE[String(id)],
      round = view && roundOf(view, proposalId);
    if (!round) return;
    var total = round.money ? (round.money.total != null ? round.money.total : round.money.net) : null;
    return writeRound(id, button, {
      key: 'quoteAccept', tid: 'quote-accept', params: { id: id, pid: proposalId }, body: {},
      confirm: { title: fill(translate('Accept {name}’s price?'), { name: view.chit.other }), body: '<div>' + root.esc(total != null ? fill(translate('{amount}, in {cur}. It becomes the pro-forma on both copies.'), { amount: root.fmtMoney(total, round.currency_code || view.chit.currency, '—'), cur: round.currency_code || view.chit.currency }) : translate('It becomes the agreed version on both copies.')) + '</div>', yes: translate('Accept'), danger: false },
      done: translate('Accepted — this is now the pro-forma')
    });
  }
  function reject(id, proposalId, button) {
    var view = STATE[String(id)];
    if (!view) return;
    return writeRound(id, button, {
      key: 'quoteReject', tid: 'quote-reject', params: { id: id, pid: proposalId }, body: {},
      confirm: { title: translate('Reject this round?'), body: '<div>' + root.esc(fill(translate('It ends here and {name} sees it.'), { name: view.chit.other })) + '</div>', yes: translate('Reject'), danger: true },
      done: translate('Rejected')
    });
  }
  function openForm(id, proposalId) {
    var view = STATE[String(id)];
    if (!view) return;
    view.form = { pid: proposalId || '' };
    paint(String(id));
    var first = view.host.querySelector('[data-testid^="quote-price-"], [data-testid^="quote-qty-"]');
    if (first && first.focus) first.focus();
  }
  function closeForm(id) {
    var view = STATE[String(id)];
    if (!view) return;
    view.form = null;
    paint(String(id));
  }
  /** the form's lines, as typed: a text price is kept as typed (the buyer's is never computed on) */
  function readForm(view) {
    var byLine = {};
    view.host.querySelectorAll('[data-quote-form] input[data-line]').forEach(function (input) {
      var lineIndex = input.getAttribute('data-line'),
        field = input.getAttribute('data-f'),
        value = String(input.value || '').trim();
      byLine[lineIndex] = byLine[lineIndex] || { line_index: Number(lineIndex) };
      if (field === 'quantity' && value !== '') byLine[lineIndex].quantity = Number(value);
      else if (field === 'price' && value !== '') byLine[lineIndex].price = Number(value);
      else if (field === 'requested_price' && value !== '') byLine[lineIndex].requested_price = value;
    });
    var note = view.host.querySelector('[data-testid="quote-note"]');
    return { lines: Object.keys(byLine).map(function (key) { return byLine[key]; }), note: note ? String(note.value || '').trim() : '' };
  }
  /** a typed quantity or price that is not a number */
  function hasBadNumber(lines) {
    return lines.some(function (line) { return (line.quantity != null && !isFinite(line.quantity)) || (line.price != null && !isFinite(line.price)); });
  }
  /** the confirm before a price or a counter goes out (money promise): names who and what binds */
  function sendConfirm(view) {
    var seller = view.chit.seller;
    return {
      title: seller ? fill(translate('Send your price to {name}?'), { name: view.chit.other }) : fill(translate('Send this counter to {name}?'), { name: view.chit.other }),
      body: '<div>' + root.esc(seller ? fill(translate('It is a quotation in {cur}. Nothing binds until {name} accepts it.'), { cur: view.chit.currency || '', name: view.chit.other }) : fill(translate('{name} sets the price. Nothing binds until you accept it.'), { name: view.chit.other })) + '</div>',
      yes: translate('Send'), danger: false
    };
  }
  function send(id, button) {
    var view = STATE[String(id)];
    if (!view || !view.form) return;
    var body = readForm(view),
      out = view.host.querySelector('[data-testid="quote-out"]');
    if (hasBadNumber(body.lines)) {
      if (out) { out.textContent = translate('A price and a quantity must be numbers.'); out.setAttribute('data-tone', 'error'); }
      return;
    }
    var proposalId = view.form.pid;
    var seller = view.chit.seller;
    return writeRound(id, button, {
      key: proposalId ? 'quoteCounter' : 'quotePropose', tid: 'quote-send', params: proposalId ? { id: id, pid: proposalId } : { id: id }, body: body,
      confirm: sendConfirm(view),
      done: seller ? translate('Price sent') : translate('Counter sent')
    });
  }

  root.CBQuotes = {
    mount: mount, refresh: refresh, steps: steps, askCross: askCross, crossOf: crossOf, wordsOf: wordsOf,
    accept: accept, reject: reject, openForm: openForm, closeForm: closeForm, send: send, onChange: null, EP: CB_QUOTE_EP
  };
})(typeof window !== 'undefined' ? window : globalThis);
