/* bank-preview-ui.js — the ONE painter of the Bank-to-books statement lines (shared by the no-login demo and the in-app Bank sheet).
 * OWNS      the statement-lines table of a CBBankPreview controller: each line's state tag, the entry it would make (account and tax in words), the ONE question it asks next
 *           (already in the books? · cash or accrual · tax invoice · is this right · what tax is this), the party box, the account box, the rows the file lost; and the clicks
 *           and changes on those controls. It paints what the controller carries and sends each answer back to the controller; it works out no money and no tax.
 * SPLIT     the builders of a line's words, questions, boxes and rows are app/bank-preview-ui-parts.js, loaded before this file (shrink W2, 2026-11-17).
 * CALLED BY public/app/bank-demo.js (the demo page) · public/app/cap-bank-sheet.js (the in-app Bank view)
 * FLOW      mount({ host, controller, currency, country, say, changed }) → paint(model, results) → a click or change on host → the controller's answer method → say(words) if refused → changed()
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * CONTROLS  BKS017-B03 use an existing party · BKS017-B04 GST on cash · BKS017-B05 GST on accrual · BKS017-B07 use this party · BKS017-B08 use this account · BKS017-B09 yes, this is right
 *           BKS017-B10/B11 tax invoice held / not held · BKS017-B12 same payment · BKS017-B13 it is new · BKS017-B15 use this tax · BKS017-B18 add a line the sheet cannot finish as its own entry · BKS017-B19 what this line is (one step) · BKS017-S10 which account that answer names · BKS017-I02 new party name · BKS017-S04 new party kind
 *           BKS017-S05 account · BKS017-S06 tax kind · BKS017-S08 the tax a line carries
 * ⭐ Written for pages with no inline script (the demo's CSP): everything is data-act on a button, one delegated listener on the host.
 */
(function (root) {
  'use strict';
  var preview = root.CBBankPreview;
  var parts = root.CBBankPreviewUIParts || (typeof require === 'function' ? require('./bank-preview-ui-parts.js') : null); /* loaded first: app/bank-preview-ui-parts.js */
  var NOT_INCOME_OR_EXPENSE = parts.NOT_INCOME_OR_EXPENSE;
  /** the painter for one mount: it reads its currency and country once, so no tax name or money unit is written here */
  function painter(cfg) {
    var ctx = { cfg: cfg, says: {}, opened: {}, groups: {}, shown: '', escapeHtml: root.esc /* helpers.js's ONE esc: every page that mounts this painter loads helpers.js first */ };
    ctx.amountText = cfg.amountText || function (value) { return preview.moneyText(value, cfg.currency); }; /* a host may draw money its own way (the in-app Bank sheet: the page's symbol form, as the band) */
    ctx.tag = function (kind, words) { return '<span class="bd-tag bd-' + kind + '">' + ctx.escapeHtml(words) + '</span>'; };
    ctx.dataKey = function (item) { return ' data-key="' + ctx.escapeHtml(item.key) + '"'; };
    parts.build(ctx);
    return {
      says: ctx.says,
      opened: ctx.opened,
      state: ctx,
      skipBox: ctx.skipBox,
      /** the OPEN ROW of one line (W15-14), for any list that draws the line: what it looks like, the entry it would make (Dr and Cr), and the answer controls it asks (the same boxes the sheet's table rows use) */
      panelHtml: function (item, result) {
        ctx.inPanel = true; /* the sentence is the panel's headline: the boxes under it do not say it again */
        var key = ctx.escapeHtml(item.key),
          said = preview.looksLike(item) || (item.state === 'proposed' || item.state === 'needs_you' ? ctx.sentenceOf(item) : ''),
          kind = result ? '' : ctx.kindBox(item),
          boxes = result ? '' : kind + (kind && !ctx.opened[item.key] ? '' : ctx.partyBox(item) + ctx.accountBox(item)) + (item.resolveWhy ? ctx.tag('bad', item.resolveWhy) : '');
        var note = ctx.lineNote(item, result);
        ctx.inPanel = false;
        return '<div class="bd-openrow" data-line="' + key + '" data-testid="bd-panel">' + (said ? '<p class="bd-looks-line"><b>' + ctx.escapeHtml(said) + '</b></p>' : '') + '<div class="bd-sub">' + boxes + note + '</div></div>';
      },
      chartOf: ctx.chartOf,
      taxWordOf: ctx.taxWordOf,
      /** the statement-lines table (or ONE line of it when the host answers a single line) with the boxes above it */
      linesHtml: function (model) {
        /* answering ONE line (cfg.only() = its key): that line alone, no statement-wide boxes */
        var only = cfg.only ? cfg.only() : '',
          items = only ? model.items.filter(function (item) { return item.key === only; }) : model.items;
        return (
          (only ? '' : ctx.checkBox(model) + ctx.skipBox(model)) +
          (items.some(function (item) { return item.needs === 'gst_basis'; }) ? '<p class="bd-find bd-confirm" data-testid="bd-gst-basis">' + ctx.basisQuestion() + '</p>' : '') +
          '<table class="bd-table"><thead><tr><th>Date</th><th>What the bank says</th><th>Out</th><th>In</th><th>In your books?</th></tr></thead><tbody>' +
          ctx.rowsHtml(items, model.results) + '</tbody></table>'
        );
      }
    };
  }
  /** the value of the select a line carries for this action (data-act) and key; '' when it is not on the page */
  function chosenIn(host, action, key) {
    var found = Array.prototype.filter.call(host.querySelectorAll('select[data-act="' + action + '"]'), function (one) { return one.getAttribute('data-key') === key; })[0];
    return found ? found.value : '';
  }
  /** a line's words without figures or punctuation, so two lines that say the same thing compare equal */
  function narrationWords(item) {
    return String(item.line.narration || '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  }
  /** the other lines that say the same thing as the line `key` and pass `waiting` (the thing they must still be waiting for) */
  function similarLines(cfg, key, waiting) {
    var items = cfg.controller().view().items,
      mine = items.filter(function (item) { return item.key === key; })[0];
    return mine ? items.filter(function (item) { return item.key !== key && waiting(item) && narrationWords(item) === narrationWords(mine); }) : [];
  }
  /** the other lines with the same words, still waiting for an account */
  function sameAccountLines(cfg, key) {
    return similarLines(cfg, key, function (item) { return item.state === 'needs_you' && !item.entry; });
  }
  /** the other lines with the same words that now wait on the same tax-invoice question */
  function sameHeldLines(cfg, key) {
    return similarLines(cfg, key, function (item) { return item.needs === 'tax_invoice'; });
  }
  /** what the buttons that answer the controller do, by data-act (they give the controller's answer, or { ok, why } when it refuses) */
  function answerActions(cfg, chosenFor, taxWordOf) {
    /** the owner picked an account and a tax kind for a line nothing explained; "not income or expense" is no account here (B5-04) */
    function useAccount(key) {
      var account = chosenFor('acct', key);
      if (account === NOT_INCOME_OR_EXPENSE) return { ok: false, line: true, why: 'A tax payment, a loan, drawings or a transfer between your own accounts is not an expense or income, so it is added as its own entry.' };
      var answers = { account: account, tax_kind: chosenFor('taxkind', key) },
        said = cfg.controller().resolveLine(key, answers);
      if (said && said.ok !== false) sameAccountLines(cfg, key).forEach(function (other) { cfg.controller().resolveLine(other.key, answers); }); /* the same words, the same answer: asked once */
      return said;
    }
    /** FIN-116: the tax kind for a line the bank's words proposed: its own class (the proposal's, never a literal) with the chosen kind, through resolve() */
    function useTax(key) {
      var item = cfg.controller().view().items.filter(function (one) { return one.key === key; })[0],
        kind = chosenFor('taxkind1', key);
      if (!kind) return { ok: false, why: 'Choose what kind of ' + taxWordOf() + ' this is first.' };
      if (!item || !item.event || !item.event.class) return { ok: false, why: 'This line has no account to carry the tax on.' };
      return cfg.controller().resolveLine(key, { account: item.event.class, tax_kind: kind });
    }
    return {
      gst: function (key, target) { return cfg.controller().answer('gst_basis', target.getAttribute('data-v')); },
      meant: function (key, target) { return cfg.controller().editParty(key, { status: 'existing', id: target.getAttribute('data-id'), name: target.getAttribute('data-name') }); },
      resolve: function (key) { return cfg.controller().resolveLine(key); },
      useacct: useAccount,
      taxuse: useTax,
      tick: function (key) { return cfg.controller().tick(key); },
      feetax: function (key, target) { return cfg.controller().feeTax(key, target.getAttribute('data-v')); },
      inv: function (key, target) { var said = cfg.controller().invoice(key, target.getAttribute('data-v')); sameAccountLines(cfg, key).concat(sameHeldLines(cfg, key)).forEach(function (other) { cfg.controller().invoice(other.key, target.getAttribute('data-v')); }); return said; },
      pair: function (key, target) { return cfg.controller().pair(key, target.getAttribute('data-id')); },
      notmatch: function (key) { return cfg.controller().notMatch(key); },
      entry: function (key) { return cfg.entry ? cfg.entry(key) : { ok: false, why: 'This starts after an update.' }; },
      chk: function (code) { return cfg.controller().confirmCheck(code) ? { ok: true } : { ok: false, why: 'Could not read this statement again.' }; }
    };
  }
  /** what the buttons that only change the screen do, by data-act (open a row, fold a group, say it is something else, pick a kind, add an own account) */
  function screenActions(cfg, chosenFor, says, opened, state) {
    return {
      open: function (key) { state.shown = state.shown === key ? '' : key; return { ok: true }; } /* one row is open at a time */,
      group: function (key, target) { var name = target.getAttribute('data-g'); state.groups[name] = !state.groups[name]; return { ok: true }; },
      more: function (key) { opened[key] = true; return { ok: true }; } /* the person said it is someone or something else: the party and account boxes open on that line */,
      kind: function (key, target) {
        var id = target.getAttribute('data-kind'),
          account = target.getAttribute('data-acct') || chosenFor('kindacct-' + id, key);
        if (target.getAttribute('data-pick') && !account) return { ok: false, line: true, why: 'Choose the account in the list under the button.' };
        var said = cfg.controller().resolveLine(key, { kind: id, account: account || undefined });
        return said && said.ok === false ? Object.assign({ line: true }, said) : said; /* a refusal is said on the line, in its words */
      },
      /* the name typed for a new own account: make it, then answer the line with it */
      addown: function (key, target) {
        var field = target.parentNode.querySelector('input[data-act="addownname"]'),
          name = field ? String(field.value || '').trim() : '';
        if (!name) return { ok: false, line: true, why: 'Type the name of the new account first.' };
        Promise.resolve(cfg.addOwn(name)).then(function (made) {
          var said = made && made.ok ? cfg.controller().resolveLine(key, { kind: 'transfer', account: made.code }) : made;
          if (said && said.ok === false) says[key] = said.why;
          cfg.changed();
        });
        return { ok: true };
      }
    };
  }
  /** what each button does, by its data-act (the answers the controller gives, or { ok, why } when it refuses) */
  function actionsOf(cfg, chosenFor, taxWordOf, says, opened, state) {
    return Object.assign(answerActions(cfg, chosenFor, taxWordOf), screenActions(cfg, chosenFor, says, opened, state));
  }
  /** the owner chose which of their accounts this statement is for */
  function pickAccount(cfg, field) {
    if (field.value) cfg.controller().chooseAccount(field.value);
    cfg.changed();
  }
  /** the message of an answer: ON THE LINE with its one step when the controller says so, at the top of the sheet otherwise, cleared when there was none */
  function sayReply(cfg, paintLines, key, said) {
    if (said && said.ok === false && said.line) {
      paintLines.says[key] = said.why; /* the message stays ON THE LINE with its one step, never at the top of the sheet */
      cfg.say('');
    } else if (said && said.ok === false) cfg.say(said.why);
    else cfg.say('');
  }
  /** the click handler of the host: the button's action, then what to say and what to repaint */
  function clickHandler(cfg, paintLines, ACTIONS) {
    /* one delegated listener: the button under the press says what to do by its data-act */
    return function onClick(event) {
      var target = event.target.closest('[data-act]');
      if (!target) return;
      var handler = ACTIONS[target.getAttribute('data-act')];
      if (!handler) return;
      var key = target.getAttribute('data-key'),
        said = handler(key, target);
      var answered = !/^(open|group|more)$/.test(target.getAttribute('data-act'));
      if (answered) paintLines.state.shown = ''; /* an answer was given: the next line that needs one opens */
      sayReply(cfg, paintLines, key, said);
      cfg.changed(key, answered && !(said && said.ok === false) ? 'answered' : 'asked');
    };
  }
  /** the new party's name or kind was edited on a line: the controller gets the change, a refusal is said */
  function editPartyFrom(cfg, field, action, key) {
    var party = cfg.controller().view().items.filter(function (one) { return one.key === key; })[0].party;
    var said = cfg.controller().editParty(key, { name: action === 'pname' ? field.value : party.name, kind: action === 'pkind' ? field.value : party.kind });
    if (!said.ok) cfg.say(said.why);
    cfg.changed();
  }
  /** the button the person would press next once the selects hold everything the answer needs: 'useacct' (account and tax kind), 'taxuse' (the tax kind alone), else '' */
  function readyAnswer(chosenFor, action, key) {
    var both = (action === 'acct' || action === 'taxkind') && chosenFor('acct', key) && chosenFor('taxkind', key);
    if (both) return 'useacct';
    return action === 'taxkind1' && chosenFor('taxkind1', key) ? 'taxuse' : '';
  }
  /** the change handler of the host: an account pick, the account + tax kind answer once both are chosen, or a party edit */
  function changeHandler(cfg, chosenFor, pressing) {
    /* one delegated listener for the selects and inputs: an account pick, a ready answer, or a party edit */
    return function onChange(event) {
      var field = event.target,
        action = field.getAttribute && field.getAttribute('data-act'),
        key = field.getAttribute && field.getAttribute('data-key');
      if (action === 'acctpick') return pickAccount(cfg, field);
      var ready = readyAnswer(chosenFor, action, key);
      if (ready) return pressing(ready, key); /* everything the answer needs is chosen: no third press */
      if (action === 'pname' || action === 'pkind') editPartyFrom(cfg, field, action, key);
    };
  }
  /**
   * mount(cfg) → { paint(), chosenFor }
   *   cfg.host        the element the lines are painted into (clicks and changes are listened for on it)
   *   cfg.controller  () → the CBBankPreview controller now in use
   *   cfg.currency · cfg.country · cfg.addedWords (what an added line says)
   *   cfg.amountText(money)  optional: the host's own money text; the default is moneyText ("AUD 2,200.00")
 *   cfg.entry(key)  the one step of a line the sheet cannot finish: opens its entry (the host's business); cfg.entryWords its button's words
 *   cfg.say(words)  where a refusal is shown                      cfg.changed(key, 'answered'|'asked')  called after every answer, so the host paints its other panes
   */
  function mount(cfg) {
    var paintLines = painter(cfg);
    var host = cfg.host;
    var chosenFor = function (action, key) { return chosenIn(host, action, key); };
    var ACTIONS = actionsOf(cfg, chosenFor, paintLines.taxWordOf, paintLines.says, paintLines.opened, paintLines.state);
    var onClick = clickHandler(cfg, paintLines, ACTIONS);
    /** the press a person would make, made for them */
    function pressing(action, key) {
      onClick({ target: { closest: function () { return { getAttribute: function (name) { return name === 'data-act' ? action : name === 'data-key' ? key : null; } }; } } });
    }
    host.addEventListener('click', onClick);
    host.addEventListener('change', changeHandler(cfg, chosenFor, pressing));
    return {
      paint: function (model) {
        host.innerHTML = paintLines.linesHtml(model);
      },
      skipBox: paintLines.skipBox,
      /** the open row's html for one controller item (the host's list draws the row; this is what opens under it) */
      panel: paintLines.panelHtml,
      chosenFor: chosenFor
    };
  }

  root.CBBankPreviewUI = { mount: mount, NOT_INCOME_OR_EXPENSE: NOT_INCOME_OR_EXPENSE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBBankPreviewUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
