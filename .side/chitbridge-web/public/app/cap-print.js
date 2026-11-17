/* app/cap-print.js — PRINT SETUP: what prints on the bill, set ONCE and previewed LIVE (SET-WALK1 · W27 / W27b, 2026-10-15).
 *
 * Athi's direction on the live AU shop (15 Oct): "something like signature in mail box" — the bill's SIGNATURE / LETTERHEAD: trading name ·
 * legal name · tax ID (the pack's word: ABN · GSTIN · TRN) · address · phone · e-mail · a footer line · a logo slot, each with a "shows on the
 * bill" tick and an order; paper A4 / 80 mm / 58 mm; and the LIVE SAMPLE BILL beside it, painted by the real renderer (bill-print.html — the
 * standalone slip the till's paper was proven from) with sample lines, per country (AU: "Tax invoice" + ABN + GST 10 %).
 *
 * ── WHAT IS REUSED (CLAUDE.md rule 1) ───────────────────────────────────────────────────────────────────────────────────────────────
 *   · the store: the vault's one merge-patch writer (cap-shop.js vaultHold · vaultPatch · saveVaultUI — W25); the signature is a vault SECTION
 *     of type `signature` (rows by tag: trade_name · legal_name · tax_id · address · phone · email · footer · logo · order · paper) — no new table
 *   · the words: taxIdWord / packWord (helpers.js); the pack (CBRegulation.packFor) says which lines a tax invoice must carry and the GST rate
 *   · the renderer: /bill-print.html in a frame, told by postMessage (its own render(), never a lookalike here)
 *   · the frame: settings.html's #set pane; the inputs are the page's .inp / .fl; the Save is CBAction (M64)
 * ── WHAT IS NEW, AND WHY ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   CBPrint.mount(host)  — nothing painted a signature editor before: the bill box on Your shop had the tax id and the address only (W26/W27)
 *   signatureOf / headLinesOf — the vault rows ↔ the editor's model ↔ the renderer's head lines (one shape per hop, built here once)
 * Host globals (as every cap-*.js): api · UI · SESSION · esc · tx · txf · toast · CBAction · CBUnsaved · the vault helpers of cap-shop.js.
 * Flow step: SET · print (docs/process/flows.json) — the bill's signature; O2C · invoice reads what it prints.
 * OWNS the signature editor and its live preview · CALLED BY settings.html (CBPrint.mount for #/print) · FLOW  mount → read (me + vault) → signatureOf → paint → tell (postMessage) → edit → Save (vault merge-patch)
 * CARD 20-settings-governance-and-plan/print-setup
 */
'use strict';
var CBPrint = (function () {
  var held = { host: null, me: null, model: null, frame: null, timer: null, dirty: false };
  /** the lines of a signature, in their default order — [tag, label] */
  var LINES = [
    ['trade_name', 'Business name'],
    ['legal_name', 'Registered name'],
    ['tax_id', 'Tax ID'],
    ['address', 'Address'],
    ['phone', 'Phone'],
    ['email', 'E-mail'],
    ['footer', 'Footer line'],
    ['logo', 'Logo (a web address)']
  ];
  var PAPERS = [
    ['80', '80 mm slip'],
    ['58', '58 mm slip'],
    ['a4', 'A4']
  ];
  var DEFAULT_PAPER = '80',
    DEFAULT_SHOWN = ['trade_name', 'tax_id', 'address', 'phone'],
    PREVIEW_DELAY_MS = 120,
    INPUT_MAX_LENGTH = 240;
  /** the lines a tax invoice MUST carry under the shop's pack — cannot be unticked; the cite is the pack's own */
  var MOVE_BUTTON_STYLE = 'min-height:30px;padding:0 8px';
  /** walk R27 (2026-10-16): the head's fixed order — the logo on top, then the lines a tax invoice must carry; the shop orders only the rest.
      The footer always closes the bill. */
  var FIXED_HEAD = ['trade_name', 'address', 'tax_id'],
    PINNED = { logo: true, footer: true };

  function logQuiet(where, failure) {
    if (window.cbQuiet) window.cbQuiet('print:' + where, failure);
  }
  /** the first value that is filled in (a line never set falls to what the shop already holds); '' when none is */
  function firstFilled() {
    return Array.prototype.slice.call(arguments).filter(Boolean)[0] || '';
  }
  /** P15 (walk 22 Oct): free text never prints a run of spaces ("Thank You  & Visit Again") — every run of white space becomes one space */
  function tidySpaces(text) {
    return String(text == null ? '' : text).replace(/[\s ]{2,}/g, ' ');
  }
  /** P7: a logo exists only when its address is filled in; an empty logo is never ticked and never prints */
  function hasLogo(model) {
    return !!String(model.lines.logo || '').trim();
  }
  function shopCountry() {
    var shop = held.me || {};
    return String(shop.country || shop.country_code || '').toUpperCase();
  }
  /** the shop's regulation pack (CBRegulation) — null when the engine is not loaded or has no pack for the country */
  function shopPack() {
    var country = shopCountry();
    if (!window.CBRegulation || !country) return null;
    try {
      return CBRegulation.packFor(country) || null;
    } catch (failure) {
      logQuiet('pack', failure);
      return null;
    }
  }
  /** R5: the pack's own required particulars through the country registry (IN · AU · AE: its frozen adapter, the same lines as REQUIRED had) */
  function requiredLines() {
    var packLines = window.CBCountries && shopCountry() ? (CBCountries.meta(shopCountry()).invoice || {}).requiredLines : null;
    return packLines && packLines.length ? packLines.slice() : ['trade_name', 'tax_id'];
  }
  function isRequired(tag) {
    return requiredLines().indexOf(tag) >= 0;
  }
  /** the pack's own cite for the "always" group (behind ⓘ), '' when it has none */
  function requiredCite() {
    var pack = shopPack(),
      cite = pack && pack.tax && pack.tax.taxInvoice && pack.tax.taxInvoice.cite;
    return cite ? String(cite).split(';')[0] : '';
  }
  function lineLabel(tag) {
    if (tag === 'tax_id') return taxIdWord(shopCountry());
    var line =
      LINES.filter(function (entry) {
        return entry[0] === tag;
      })[0] || [];
    return tx(line[1] || tag);
  }

  /* ── the model: the vault's `signature` section (rows by tag) → { lines: {tag: value}, shown: [tags in order], paper } ── */
  function sectionOfType(sections, type) {
    return (
      (sections || []).filter(function (section) {
        return section.type === type;
      })[0] || null
    );
  }
  function rowsByTag(section) {
    var byTag = {};
    ((section && section.rows) || []).forEach(function (row) {
      if (row.tag) byTag[row.tag] = row.value || '';
    });
    return byTag;
  }
  /** every line's value: the signature's own row, else the identity's, else the shop's own fact */
  function lineValues(signatureRows, identity, shop) {
    return {
      trade_name: firstFilled(signatureRows.trade_name, shop.display_name),
      legal_name: firstFilled(signatureRows.legal_name, identity.legal_name),
      tax_id: firstFilled(signatureRows.tax_id, identity.gstin, shop.gstn),
      address: firstFilled(signatureRows.address, identity.address, shop.address),
      phone: firstFilled(signatureRows.phone, identity.phone, shop.phone),
      email: firstFilled(signatureRows.email, identity.email, shop.email),
      footer: tidySpaces(signatureRows.footer),
      logo: signatureRows.logo || ''
    };
  }
  /** the editor's model from the vault + the shop's own facts; the lines a tax invoice must carry are always shown */
  function signatureOf(sections, shop) {
    var signatureRows = rowsByTag(sectionOfType(sections, 'signature')),
      identity = rowsByTag(sectionOfType(sections, 'identity'));
    var shown = signatureRows.order ? signatureRows.order.split(',').filter(Boolean) : DEFAULT_SHOWN.slice();
    requiredLines().forEach(function (tag) {
      if (shown.indexOf(tag) < 0) shown.push(tag);
    });
    var knownPaper = PAPERS.some(function (paper) {
      return paper[0] === signatureRows.paper;
    });
    var model = { lines: lineValues(signatureRows, identity, shop), shown: shown, paper: knownPaper ? signatureRows.paper : DEFAULT_PAPER };
    dropEmptyLogo(model);
    return model;
  }
  /** P7: take the logo off the shown order while there is no logo (a tick saved earlier with an empty logo is cleared on load and on save) */
  function dropEmptyLogo(model) {
    if (hasLogo(model)) return;
    model.shown = model.shown.filter(function (tag) {
      return tag !== 'logo';
    });
  }
  /** the model back to vault rows (the section the merge-patch writes) */
  function rowsOf(model) {
    dropEmptyLogo(model);
    var rows = LINES.map(function (line) {
      return { name: lineLabel(line[0]), tag: line[0], value: tidySpaces(model.lines[line[0]]) };
    });
    rows.push({ name: 'Order', tag: 'order', value: model.shown.join(',') });
    rows.push({ name: 'Paper', tag: 'paper', value: model.paper });
    return rows;
  }
  /** is the registered name the business name again? (then it is not printed twice) */
  function sameName(model) {
    return (
      String(model.lines.legal_name || '')
        .trim()
        .toLowerCase() ===
      String(model.lines.trade_name || '')
        .trim()
        .toLowerCase()
    );
  }
  /** one shown line as the renderer paints it at the head of the paper (null when the line is empty) */
  function headLineOf(model, tag) {
    var value = tidySpaces(model.lines[tag]);
    if (!value) return null;
    if (tag === 'tax_id') return { tag: tag, text: taxIdWord(shopCountry()) + ' ' + value, only_taxed: true };
    if (tag === 'phone') return { tag: tag, text: 'Ph ' + value };
    if (tag === 'logo') return { tag: tag, logo: value };
    if (tag === 'legal_name') return sameName(model) ? null : { tag: tag, text: tx('Regd. name') + ': ' + value }; /* R25: labelled, and only when it differs */
    return { tag: tag, text: value, big: tag === 'trade_name' };
  }
  /** can the shop move this line? (never the logo, the footer or a fixed-order line) */
  function isMovable(tag) {
    return !PINNED[tag] && FIXED_HEAD.indexOf(tag) < 0;
  }
  /** the shop's own order of the optional head lines */
  function movableShown(model) {
    return model.shown.filter(isMovable);
  }
  /** what the renderer paints at the head of the paper (R25 · R27): the logo on top, the required lines in their fixed order, then the shop's
      ticked lines in its order — the tax id under the pack's word; the footer is never a head line */
  function headLinesOf(model) {
    var logo = model.shown.indexOf('logo') >= 0 && hasLogo(model) ? ['logo'] : [];
    var fixed = FIXED_HEAD.filter(function (tag) {
      return isRequired(tag) || model.shown.indexOf(tag) >= 0;
    });
    return logo
      .concat(
        fixed,
        movableShown(model).filter(function (tag) {
          return fixed.indexOf(tag) < 0;
        })
      )
      .map(function (tag) {
        return headLineOf(model, tag);
      })
      .filter(Boolean);
  }

  /* ── paint ── */
  /** P7: the sentence beside the greyed Logo tick (hidden once a logo is typed) */
  function logoHintHTML(isShown) {
    return '<span class="sub" data-testid="pr-logo-hint"' + (isShown ? '' : ' hidden') + '>' + esc(tx('Add a logo first')) + '</span>';
  }
  /** P7: typing in the Logo line switches its tick on or off in place (a repaint would take the cursor away) */
  function syncLogoTick() {
    var box = document.querySelector('[data-pr-show="logo"]'),
      hint = document.querySelector('[data-testid="pr-logo-hint"]'),
      isLogoless = !hasLogo(held.model);
    dropEmptyLogo(held.model);
    if (box) {
      box.disabled = isLogoless;
      if (isLogoless) box.checked = false;
    }
    if (hint) hint.hidden = !isLogoless;
  }
  /** the "shows on the bill" tick of an optional line (a required line has none — its group heading says it always prints) */
  function tickHTML(tag) {
    var isOn = held.model.shown.indexOf(tag) >= 0,
      isLogoless = tag === 'logo' && !hasLogo(held.model);
    /* the group heading says what the tick does — no words repeated beside every box; the name rides on aria-label / title */
    return (
      '<label class="tick" title="' +
      esc(tx('Print this line')) +
      '"><input data-cbsid="ACC002-I12" type="checkbox" data-pr-show="' +
      esc(tag) +
      '" data-testid="pr-show-' +
      esc(tag) +
      '"' +
      (isOn ? ' checked' : '') +
      (isLogoless ? ' disabled' : '') +
      ' aria-label="' +
      esc(tx('Print this line')) +
      ': ' +
      esc(lineLabel(tag)) +
      '">' +
      (tag === 'logo' ? logoHintHTML(isLogoless) : '') +
      '</label>'
    );
  }
  /** one ↑ / ↓ button that moves a line in the order (direction −1 or +1) */
  function moveButtonHTML(tag, direction, testId, label, arrow, isDisabled) {
    return (
      '<button data-cbsid="ACC002-B21" type="button" class="composebtn ghost" data-pr-move="' +
      esc(tag) +
      '" data-dir="' +
      direction +
      '" data-testid="' +
      testId +
      '-' +
      esc(tag) +
      '" aria-label="' +
      esc(tx(label)) +
      '" style="' +
      MOVE_BUTTON_STYLE +
      '"' +
      (isDisabled ? ' disabled' : '') +
      '>' +
      arrow +
      '</button>'
    );
  }
  /** one line of the editor: its label and text; an optional line adds its tick, and a movable one its ↑ ↓ (disabled at the ends / unticked) */
  function lineRowHTML(tag) {
    var model = held.model,
      movable = movableShown(model),
      position = movable.indexOf(tag),
      isOptional = !isRequired(tag);
    return (
      '<div class="pr-row" data-testid="pr-line-' +
      esc(tag) +
      '"><label class="fl" style="margin:0;flex-basis:100%">' +
      esc(lineLabel(tag)) +
      '</label>' +
      '<input data-cbsid="ACC002-I13" class="inp" data-pr-line="' +
      esc(tag) +
      '" data-testid="pr-in-' +
      esc(tag) +
      '" value="' +
      esc(model.lines[tag] || '') +
      '" maxlength="' +
      INPUT_MAX_LENGTH +
      '">' +
      (isOptional ? tickHTML(tag) : '') +
      (isOptional && isMovable(tag)
        ? moveButtonHTML(tag, -1, 'pr-up', 'Move up', '↑', position <= 0) +
          moveButtonHTML(tag, 1, 'pr-down', 'Move down', '↓', position < 0 || position >= movable.length - 1)
        : '') +
      '</div>'
    );
  }
  /** the required lines in the order the bill prints them */
  function requiredTags() {
    return FIXED_HEAD.filter(isRequired).concat(
      requiredLines().filter(function (tag) {
        return FIXED_HEAD.indexOf(tag) < 0;
      })
    );
  }
  /** the optional lines: the shop's ordered ticked ones, then the rest (logo first, footer last — where they print) */
  function optionalTags() {
    var model = held.model,
      all = LINES.map(function (line) {
        return line[0];
      }).filter(function (tag) {
        return !isRequired(tag);
      });
    var movable = movableShown(model),
      rest = all.filter(function (tag) {
        return isMovable(tag) && movable.indexOf(tag) < 0;
      });
    var fixedOptional = all.filter(function (tag) {
      return !PINNED[tag] && !isMovable(tag);
    });
    return all
      .filter(function (tag) {
        return tag === 'logo';
      })
      .concat(
        fixedOptional,
        movable,
        rest,
        all.filter(function (tag) {
          return tag === 'footer';
        })
      );
  }
  /** R27: a group heading — its words, and the pack's cite behind ⓘ when there is one */
  function groupHeadHTML(words, testId, cite) {
    return (
      '<div class="sec" style="margin:14px 0 4px" data-testid="' +
      testId +
      '">' +
      esc(words) +
      (cite ? ' <span title="' + esc(cite) + '" style="cursor:help">ⓘ</span>' : '') +
      '</div>'
    );
  }
  /** "Always on a tax invoice" — the required lines are the rows right under it, so they are not listed again in the heading; the pack's cite behind ⓘ */
  function alwaysHeading() {
    return groupHeadHTML(tx('Always on a tax invoice'), 'pr-always', requiredCite());
  }
  /** the paper-size row of the editor: a label and the paper select */
  function paperRowHTML() {
    var options = PAPERS.map(function (paper) {
      return '<option value="' + paper[0] + '"' + (held.model.paper === paper[0] ? ' selected' : '') + '>' + esc(tx(paper[1])) + '</option>';
    }).join('');
    return (
      '<div class="pr-row"><label class="fl" style="margin:0;flex-basis:100%">' +
      esc(tx('Paper')) +
      '</label><select data-cbsid="ACC002-S07" class="inp" id="pr_paper" data-testid="pr-paper" style="max-width:220px">' +
      options +
      '</select></div>'
    );
  }
  /** the editor column: every line, the paper, the error spot, Save, and the door to Your shop */
  function editorHTML() {
    return (
      '<div data-testid="pr-editor">' +
      alwaysHeading() +
      requiredTags().map(lineRowHTML).join('') +
      groupHeadHTML(tx('Tick to print') + ' (' + tx('optional') + ')', 'pr-choice', '') +
      optionalTags().map(lineRowHTML).join('') +
      paperRowHTML() +
      '<div class="err" id="pr_err" data-testid="pr-err" style="margin-top:8px"></div>' +
      '<div class="pr-savebar" data-testid="pr-savebar" style="position:sticky;bottom:0;z-index:5;margin-top:8px;padding:8px 0;background:var(--bg,#fff)">' +
      ui.action('save', { mount: 'ACC002-U03', object: 'print layout', effect: 'preference', id: 'pr-save', testid: 'pr-save' }) +
      '</div>' +
      '<p class="sub"><a class="sx-link" href="/settings.html#/shop" data-testid="pr-shop-link">' +
      esc(tx('Your business')) +
      ' ›</a></p></div>'
    );
  }
  /** the preview column: the real renderer (bill-print.html) in a frame */
  function previewHTML() {
    return (
      '<div class="pr-prev" data-testid="pr-preview"><div class="sec" style="margin:0 0 6px">' +
      esc(tx('Sample bill')) +
      '</div>' +
      '<div style="display:flex;gap:8px;margin:0 0 8px">' +
      '<button data-cbsid="ACC002-B23" type="button" class="composebtn ghost" id="pr-preview-open" data-testid="pr-preview-open">' +
      esc(tx('Preview')) +
      '</button>' +
      '<button data-cbsid="ACC002-B24" type="button" class="composebtn ghost" id="pr-print" data-testid="pr-print">' +
      esc(tx('Print')) +
      '</button></div>' +
      '<iframe id="pr_frame" title="' +
      esc(tx('Sample bill')) +
      '" src="/bill-print.html?preview=1"></iframe></div>'
    );
  }
  /** R26 · Print: the sample, printed by the renderer itself on the chosen paper (its @page follows the paper the message named) */
  function printSample() {
    var frame = held.frame;
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (failure) {
      logQuiet('print', failure);
    }
  }
  /** R26 · Preview: the whole bill full size over the page — a second copy of the one renderer, as tall as the bill (no inner scroll);
      a click outside it (or Esc) closes it */
  function openPreview() {
    var overlay = document.createElement('div');
    overlay.setAttribute('data-testid', 'pr-overlay');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:var(--scrim);overflow:auto;padding:24px 16px;display:flex;justify-content:center;align-items:flex-start';
    var frame = document.createElement('iframe');
    frame.title = tx('Sample bill');
    frame.src = '/bill-print.html?preview=1';
    frame.setAttribute('scrolling', 'no');
    frame.style.cssText =
      'border:0;background:var(--paper,var(--card));border-radius:6px;box-shadow:var(--shadow-menu);width:' +
      (held.model.paper === 'a4' ? 'min(794px,100%)' : '340px') +
      ';height:400px';
    function fitHeight() {
      try {
        var doc = frame.contentDocument;
        frame.style.height = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight) + 'px';
      } catch (failure) {
        logQuiet('preview-fit', failure);
      }
    }
    function close() {
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onKey(event) {
      if (event.key === 'Escape') close();
    }
    frame.addEventListener('load', function () {
      frame.contentWindow.postMessage(message(), '*');
      setTimeout(fitHeight, 150);
    });
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
  }
  /** paint the whole screen and wire it: one delegated click / input handler on the host, the frame told when it loads */
  function paint() {
    var host = held.host;
    if (!host || !held.model) return;
    host.innerHTML =
      '<h1 class="sx-h" data-testid="sx-title">' + esc(tx('Print setup')) + '</h1>' + '<div class="pr-grid">' + editorHTML() + previewHTML() + '</div>';
    held.frame = document.getElementById('pr_frame');
    held.frame.addEventListener('load', tell);
    host.onclick = onClick;
    host.oninput = onInput;
    host.onchange = onInput; /* Save + confirm, no autosave (settings rule): nothing is stored until Save is pressed */
    document.getElementById('pr-save').onclick = save;
    document.getElementById('pr-preview-open').onclick = openPreview;
    document.getElementById('pr-print').onclick = printSample;
  }
  /** a ↑ / ↓ press: swap the line with its neighbour in the shown order */
  function onClick(event) {
    var button = event.target.closest && event.target.closest('[data-pr-move]');
    if (!button || button.disabled) return;
    var tag = button.getAttribute('data-pr-move'),
      shown = held.model.shown,
      movable = movableShown(held.model);
    var from = movable.indexOf(tag),
      to = from + Number(button.getAttribute('data-dir'));
    if (from < 0 || to < 0 || to >= movable.length) return;
    var here = shown.indexOf(tag),
      there = shown.indexOf(movable[to]); /* swap with the neighbour among the movable lines only */
    shown[here] = movable[to];
    shown[there] = tag;
    held.dirty = true;
    paint();
    tell();
  }
  /** a "shows on the bill" tick: add the line to (or take it off) the shown order, then repaint */
  function onShowTick(box) {
    var tag = box.getAttribute('data-pr-show'),
      model = held.model;
    if (!box.checked)
      model.shown = model.shown.filter(function (shownTag) {
        return shownTag !== tag;
      });
    else if (model.shown.indexOf(tag) < 0) model.shown.push(tag);
    held.dirty = true;
    paint();
    tell();
  }
  /** a typed line, a tick or the paper select: hold it, mark the screen unsaved, tell the preview */
  function onInput(event) {
    var target = event.target,
      model = held.model;
    if (!target) return;
    if (target.hasAttribute('data-pr-line')) {
      model.lines[target.getAttribute('data-pr-line')] = target.value;
      held.dirty = true;
      if (target.getAttribute('data-pr-line') === 'logo') syncLogoTick();
      return tellSoon();
    }
    if (target.hasAttribute('data-pr-show')) return onShowTick(target);
    if (target.id === 'pr_paper') {
      model.paper = target.value;
      held.dirty = true;
      return tell();
    }
  }
  /** the pack's standard rate for the sample lines: its own standard_rate, else the last of its rates; null when the pack states none (CTRY-72: never 18) */
  function packRate(pack) {
    var taxRules = pack && pack.tax;
    if (!taxRules) return null;
    return taxRules.standard_rate || (taxRules.rates && taxRules.rates[taxRules.rates.length - 1]) || null;
  }
  /** the tax words the renderer paints: the pack's scheme word, split by state or one line, its rate (and its rate menu, so a sample line
      keeps a rate the pack has — R47: India's 5 % stays 5 %, never the top slab), the id's word */
  function previewTax(pack) {
    var country = shopCountry(),
      rates = (pack && pack.tax && pack.tax.rates) || null;
    /* CTRY-72: no country, no pack, or a pack with no scheme word or rate = no tax words at all; the renderer then says why (previewRefusal), it never paints GST 18 % */
    if (!pack || !pack.tax || !pack.tax.scheme || packRate(pack) === null) return null;
    return {
      word: pack.tax.scheme,
      split: typeof packSplitsByState === 'function' ? packSplitsByState(country) : true,
      rate: packRate(pack),
      rates: rates ? Array.prototype.slice.call(rates) : null,
      id_word: taxIdWord(country)
    };
  }
  /** the one sentence the sample bill shows in place of its tax lines when the shop has no country or no pack: CBRegulation.status(country).why, else ''
      (CTRY-72; the engine's own words, the same ones the books gate says). '' when the sample can be painted. */
  function previewRefusal(pack) {
    if (previewTax(pack)) return '';
    var said = window.CBRegulation && CBRegulation.status ? CBRegulation.status(shopCountry() || null) : null;
    /* a country WITH a pack that states no scheme word or rate has no "set your country" words: it says what is missing */
    return (said && said.why) || 'This country’s pack states no tax rate yet, so no sample is worked out.';
  }
  /** the bill's currency for the sample: the shop's, else the pack's, else nothing (a sample with no money is refused by previewRefusal's caller, never rupees) */
  function previewCurrency(shop, pack) {
    return shop.currency_code || (pack && pack.currency);
  }
  /** the renderer's message: the head lines in order, the footer, the paper, the pack's tax words and rate — bill-print.html paints the rest */
  /** the one message: head lines, footer (only when ticked — R25), paper, kind, currency, the pack's tax words, the country and the raw tax id
      (the renderer names India's state from it) */
  function message() {
    var model = held.model,
      pack = shopPack(),
      shop = held.me || {},
      isTaxed = !!(shop.gstn || model.lines.tax_id);
    return {
      cb_preview: true,
      head: headLinesOf(model),
      footer: model.shown.indexOf('footer') >= 0 ? tidySpaces(model.lines.footer) : '',
      paper: model.paper,
      kind: isTaxed ? 'tax' : 'cash',
      currency: previewCurrency(shop, pack),
      tax: previewTax(pack),
      refusal: previewRefusal(pack),
      country: shopCountry(),
      tax_id: model.lines.tax_id || ''
    };
  }
  function tell() {
    var frame = held.frame;
    if (!frame || !frame.contentWindow || !held.model) return;
    frame.contentWindow.postMessage(message(), '*');
  }
  function tellSoon() {
    clearTimeout(held.timer);
    held.timer = setTimeout(tell, PREVIEW_DELAY_MS);
  }
  /* ── the one save: the signature section through the vault's merge-patch (cap-shop.js W25) ── */
  /** put the model's rows into the vault's `signature` section (created when the vault has none) */
  function holdSignatureRows() {
    var sections = _vaultSecs(),
      section = sectionOfType(sections, 'signature');
    if (section) section.rows = rowsOf(held.model);
    else sections.push({ type: 'signature', label: '', rows: rowsOf(held.model) });
  }
  /** Save: hold the rows, send the patch through CBAction; a stale version (409) shows the vault's Reload sentence */
  function save(source) {
    var errorBox = document.getElementById('pr_err');
    if (errorBox) errorBox.textContent = '';
    holdSignatureRows();
    var button = source && source.tagName ? source : document.getElementById('pr-save');
    return CBAction.run(button, saveVaultPatch, {
      key: 'pr-save',
      busy: tx('Saving…'),
      outcome: function () {
        held.dirty = false;
        toast(tx('Print setup saved.'));
      },
      onFail: function (words, failure) {
        if (errorBox) errorBox.innerHTML = failure && failure.status === 409 ? vaultConflictHTML(words) : esc(words);
      }
    });
  }
  /** the vault's patch writer, awaited (saveVaultUI paints its own outcome; this one answers the action helper) */
  function saveVaultPatch() {
    var patch = vaultPatch(UI._vaultBase || [], _vaultSecs());
    if (!patch) return Promise.resolve({});
    return api('vaultSave', { body: { version: UI._vaultVersion, patch: patch } }).then(function (answer) {
      vaultHold((answer && answer.vault) || { sections: _vaultSecs() }, answer && answer.version);
      return answer;
    });
  }
  /** the shop and its vault read together; the vault becomes the base for the next patch, the model is built from it */
  function readAll() {
    return Promise.all([
      api('me').then(function (reply) {
        return (reply && (reply.entity || reply)) || {};
      }),
      api('profileGet')
    ]).then(function (answers) {
      held.me = answers[0];
      var profile = answers[1] || {};
      vaultHold({ sections: (profile.vault || {}).sections || [] }, profile.vault_version);
      UI._vaultEnc = !!profile.vault_encrypted;
      held.model = signatureOf(_vaultSecs(), held.me);
      held.dirty = false;
      paint();
      tell();
    });
  }
  /** could not read: a lost sign-in ends the frame's session; anything else says so in words */
  function readFailed(failure) {
    if (failure && failure.status === 401 && typeof CBFrame !== 'undefined') return CBFrame.ended();
    held.host.innerHTML =
      '<div class="empty" data-testid="pr-readerr"><div class="t">' +
      esc(tx('Could not read the shop')) +
      '</div>' +
      esc(tx('Nothing was lost. Try again in a moment.')) +
      '</div>';
  }
  function read() {
    held.host.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + esc(tx('Reading…')) + '</div>';
    return readAll().then(null, readFailed);
  }
  /** open the editor for this host: clear the held state, guard unsaved changes, then read the saved layout */
  function mount(host) {
    held.host = host;
    held.model = null;
    held.dirty = false;
    if (window.CBUnsaved)
      CBUnsaved.form({
        dirty: function () {
          return !!held.dirty;
        },
        save: function () {
          return save();
        }
      }); /* W24 */
    return read();
  }
  /** the tax words and the refusal the sample bill would be told for this shop row ({ country }) - what message() sends, for the CTRY-72 test; the held shop is put back */
  function previewFor(shopRow) {
    var before = held.me;
    held.me = shopRow;
    try {
      var pack = shopPack();
      return { tax: previewTax(pack), refusal: previewRefusal(pack) };
    } finally {
      held.me = before;
    }
  }
  return {
    mount: mount,
    previewFor: previewFor,
    signatureOf: signatureOf,
    headLinesOf: headLinesOf,
    rowsOf: rowsOf,
    LINES: LINES,
    PAPERS: PAPERS,
    requiredLines: requiredLines
  };
})();
