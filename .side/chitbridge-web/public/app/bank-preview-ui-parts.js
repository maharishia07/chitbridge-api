/* bank-preview-ui-parts.js — the BUILDERS behind bank-preview-ui.js: the words, questions, boxes and rows of a statement line, each landing on one shared `ctx`.
 * OWNS      the tax and entry words of a line, the questions a held-back line asks (pair · tax invoice · tick · fee tax · GST basis), the one question asked next and the note under a line,
 *           the party box, the account box and the "What is this?" choices, a table row and the box for the rows the file lost, and the statement check in words. It paints what the
 *           controller carries; it works out no money and no tax.
 * CALLED BY public/app/bank-preview-ui.js (painter → CBBankPreviewUIParts.build(ctx)); loaded BEFORE it by public/accounts.html and public/bank-demo.html, after app/bank-preview.js
 * FLOW      build(ctx) → each add* function puts its painters on ctx (taxWordOf · entryNote · askedBox · lineNote · partyBox · kindBox · lineRow · rowsHtml · skipBox · checkBox …)
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * CONTROLS  the BKS017 codes written in this file are the ones listed in bank-preview-ui.js's header (BKS017-B03 … B22, S04 … S10, I02 · I03): the elements did not change, only the file they are drawn in
 * Split out of bank-preview-ui.js (shrink W2, 2026-11-17): behaviour unchanged.
 */
(function (root) {
  'use strict';
  var preview = root.CBBankPreview;

  /** the choice that says a line is neither an income nor an expense (a tax payment, a loan, drawings, a transfer between own accounts): it has no account here, the owner adds it with + Entry */
  var NOT_INCOME_OR_EXPENSE = '__other__';
  /** a line already in the books: who put it there and when, in the check's words; '' for any other line */
  function alreadyNote(item, escapeHtml) {
    return item.state === 'in_books' && item.alreadyWhy ? '<span class="bd-why">' + escapeHtml(String(item.alreadyWhy).replace(/\s*\((?:ref )?bank:[^)]*\)/g, '').replace(/\s*\(\s*\)/g, '')) + '</span>' : ''; /* the line's internal reference is not for the reader */
  }
  /** every other thing holding a line back besides its entry and its one question, as tags */
  function otherNeeds(item, tag) {
    return (item.blockers || [])
      .filter(function (code) {
        return code !== 'no_entry' && code !== item.needs;
      })
      .map(function (code) {
        return tag('ask', preview.NEEDS_WORDS[code] || code);
      })
      .join(' ');
  }
  /** the pack's tax name and the tax a proposal carries, in words; lands on the one shared `ctx` */
  function addTaxWords(ctx) {
    var cfg = ctx.cfg, amountText = ctx.amountText;
    /** the pack's own word for its tax (CBCountries.meta(country).words.taxName), so no tax name is written here; plain "tax" when the pack says none */
    function taxWordOf() {
      var meta = root.CBCountries && root.CBCountries.meta && root.CBCountries.meta(cfg.country);
      return (meta && meta.words && meta.words.taxName) || 'tax';
    }
    /** the tax a proposal carries, in words: tax collected or paid, the invoice it needs, or that no credit is claimed */
    function taxWordsOf(taxRecord) {
      if (!taxRecord) return '';
      var taxWord = taxWordOf();
      if (taxRecord.invoice_answer === 'none') return ' No ' + taxWord + ' credit: you hold no tax invoice.';
      if (!taxRecord.tax_minor) return '';
      var invoice = taxRecord.invoice && taxRecord.invoice.required ? ', tax invoice required' + (taxRecord.invoice_answer === 'held' ? ', you hold it' : '') : '';
      return ' ' + (taxRecord.direction === 'output' ? taxWord + ' collected ' : taxWord + ' ') + amountText(taxRecord.tax_minor) + ' (' + String(taxRecord.kind).replace(/_/g, ' ') + ')' + invoice + '.';
    }
    Object.assign(ctx, { taxWordOf, taxWordsOf });
  }
  /** the entry a proposed line would make, in words, and the chart the owner picks from; lands on the one shared `ctx` */
  function addEntryWords(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, amountText = ctx.amountText, taxWordsOf = ctx.taxWordsOf;
    /** the entry a proposed line would make, in words: each leg's account and amount, and the tax it carries (shown on the row, ready or not) */
    /** a leg's account in words: the pack's role (bank_charges → bank charges), or the name of the shop's own ledger the leg carries by code (a savings account the owner added) */
    function legName(leg) {
      var raw = leg.account != null ? leg.account : leg.code != null ? leg.code : leg.ledger,
        own = (cfg.ownAccounts ? cfg.ownAccounts() : []).filter(function (one) { return String(one.code) === String(raw); })[0];
      var named = !own && cfg.accountName ? cfg.accountName(raw) : '';
      var plain = String(raw == null ? 'account' : raw).replace(/_/g, ' ');
      return own ? own.name : named || plain.charAt(0).toUpperCase() + plain.slice(1); /* the chart's own name for the account, never its key */
    }
    function entryNote(item) {
      if (!item.entry) return '';
      var legs = item.entry.lines
        .map(function (leg) {
          return (leg.dr_minor ? 'Dr' : 'Cr') + ' ' + legName(leg) + ' ' + amountText(leg.dr_minor || leg.cr_minor);
        })
        .join(' · ');
      return '<span class="bd-why bd-entry">' + escapeHtml(legs + '.' + taxWordsOf(item.tax)) + '</span> ';
    }
    /** the chart the owner may pick from, read from the country pack (never a new account): expense and income classes, and the tax kinds */
    function chartOf() {
      var pack = root.CBRegulation && root.CBRegulation.resolve({ country: cfg.country });
      if (!pack) return { expense: [], income: [], taxKinds: [] };
      var kinds = (pack.tax && pack.tax.supplyKinds) || {};
      return { expense: pack.expense_classes || [], income: pack.income_classes || [], taxKinds: Object.keys(kinds).map(function (id) { return { id: id, name: kinds[id].name }; }) };
    }
    function optionsOf(list, valueOf, nameOf) {
      return '<option value="">Choose</option>' + list.map(function (one) { return '<option value="' + escapeHtml(valueOf(one)) + '">' + escapeHtml(nameOf(one)) + '</option>'; }).join('');
    }
    Object.assign(ctx, { entryNote, chartOf, optionsOf });
  }
  /** the questions a held-back line asks: pair with a books entry, the tax invoice, the tick; each function lands on the one shared `ctx` */
  function addQuestions(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, amountText = ctx.amountText, dataKey = ctx.dataKey, taxWordOf = ctx.taxWordOf;
    /** B5-02: books entries with this amount and side nearby: pair the line with the one it is, or say it is new */
    function nearBox(item) {
      var entries = (item.near || [])
        .map(function (one) {
          return '<button data-cbsid="BKS017-B12" type="button" class="bd-btn" data-act="pair"' + dataKey(item) + ' data-id="' + escapeHtml(one.id) + '">Same payment: ' + escapeHtml(preview.dateText(one.date)) + ' ' + escapeHtml(one.narration) + ' ' + escapeHtml(one.entry_no || '') + ' (' + one.gap_days + ' days apart)</button>';
        })
        .join(' ');
      return '<span class="bd-ask">May already be in your books. Is it one of these?</span> ' + entries + ' <button data-cbsid="BKS017-B13" type="button" class="bd-btn" data-act="notmatch"' + dataKey(item) + '>No, it is new</button>';
    }
    /** B5-03: a tax credit above the pack's threshold waits for the tax invoice */
    function invoiceQuestion(item) {
      return (
        '<span class="bd-ask">' + escapeHtml('This claims ' + amountText(item.tax.tax_minor) + ' ' + taxWordOf() + ' and needs a tax invoice. Do you hold it?') + '</span> ' +
        '<button data-cbsid="BKS017-B10" type="button" class="bd-btn" data-act="inv" data-v="held"' + dataKey(item) + '>Yes, I hold it</button> ' +
        '<button data-cbsid="BKS017-B11" type="button" class="bd-btn" data-act="inv" data-v="none"' + dataKey(item) + '>No: book it without the ' + taxWordOf() + ' credit</button>'
      );
    }
    /** B5-01: only the words on the bank line proposed this, no rule you taught and no party you know: it is added only when you say it is right */
    function tickBox(item) {
      var said = preview.looksLike(item);
      return (ctx.inPanel && said ? '' : '<span class="bd-ask">' + escapeHtml(said || 'Suggested from the words on the statement.') + '</span> ') + '<button data-cbsid="BKS017-B09" type="button" class="bd-btn" data-act="tick"' + dataKey(item) + '>Yes, this is right</button>';
    }
    Object.assign(ctx, { nearBox, invoiceQuestion, tickBox });
  }
  /** the card fee's tax question and the GST basis question; each function lands on the one shared `ctx` */
  function addFeeAndBasis(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, amountText = ctx.amountText, dataKey = ctx.dataKey, taxWordOf = ctx.taxWordOf;
    /** BB-04: a card settlement that arrived net of the acquirer's fee: is the tax on that fee claimable? Asked (RQ1), never defaulted */
    function feeTaxQuestion(item) {
      return (
        '<span class="bd-ask">' + escapeHtml('The card company kept ' + amountText(item.split.fee_minor) + ' as its fee. Is there ' + taxWordOf() + ' on it?') + '</span> ' +
        '<button data-cbsid="BKS017-B21" type="button" class="bd-btn" data-act="feetax" data-v="tax"' + dataKey(item) + '>Yes, ' + taxWordOf() + ' on the fee</button> ' +
        '<button data-cbsid="BKS017-B22" type="button" class="bd-btn" data-act="feetax" data-v="none"' + dataKey(item) + '>No ' + taxWordOf() + '</button>'
      );
    }
    function basisQuestion() {
      return (
        '<span class="bd-ask">' + escapeHtml('Is your ' + taxWordOf() + ' on a cash or an accrual basis?') + '</span> ' +
        '<button data-cbsid="BKS017-B04"' + (cfg.gstIds ? ' id="bd_gst_cash"' : '') + ' type="button" class="bd-btn" data-act="gst" data-v="cash">Cash</button> ' +
        '<button data-cbsid="BKS017-B05"' + (cfg.gstIds ? ' id="bd_gst_accrual"' : '') + ' type="button" class="bd-btn" data-act="gst" data-v="accrual">Accrual</button>'
      );
    }
    Object.assign(ctx, { feeTaxQuestion, basisQuestion });
  }
  /** the tax kind question and the ONE question a held-back line asks next; each function lands on the one shared `ctx` */
  function addAsks(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, amountText = ctx.amountText, tag = ctx.tag, dataKey = ctx.dataKey, taxWordOf = ctx.taxWordOf, chartOf = ctx.chartOf, optionsOf = ctx.optionsOf, entryNote = ctx.entryNote, nearBox = ctx.nearBox, invoiceQuestion = ctx.invoiceQuestion, tickBox = ctx.tickBox, basisQuestion = ctx.basisQuestion;
    /** FIN-116: a money-out line the bank's words proposed carries no tax until the owner says what tax it is: the pack's own kinds, chosen here, never a default; the answer goes through the controller (resolve: one taught rule, the one splitter) */
    function taxKindBox(item) {
      var kinds = chartOf().taxKinds;
      if (!kinds.length) return '<span class="bd-why">' + escapeHtml('No ' + taxWordOf() + ' kinds are set for this country, so nothing is claimed on this line.') + '</span>';
      return (
        '<span class="bd-ask">' + escapeHtml('Does this carry ' + taxWordOf() + '? Say what kind it is.') + '</span> ' +
        '<select data-cbsid="BKS017-S08" class="bd-inp" aria-label="' + escapeHtml(taxWordOf() + ' kind') + '" data-act="taxkind1" data-key="' + escapeHtml(item.key) + '">' + optionsOf(kinds, function (one) { return one.id; }, function (one) { return one.name; }) + '</select> ' +
        '<button data-cbsid="BKS017-B15" type="button" class="bd-btn" data-act="taxuse"' + dataKey(item) + '>Use this</button>'
      );
    }
    /** the one question a held-back line asks next */
    function askedBox(item) {
      if (item.needs === 'may_be_in_books') return nearBox(item);
      if (item.needs === 'gst_basis') return '<span class="bd-why">Waiting for your ' + taxWordOf() + ' basis, asked above.</span>';
      if (item.needs === 'tax_invoice') return invoiceQuestion(item);
      if (item.needs === 'fee_tax') return ctx.feeTaxQuestion(item);
      if (item.needs === 'needs_tick') return tickBox(item);
      if (item.needs === 'tax_kind') return taxKindBox(item);
      return '';
    }
    Object.assign(ctx, { taxKindBox, askedBox });
  }
  /** the note under a line: the message of a line the sheet cannot finish, the line's note and the engine's own sentence; each function lands on the one shared `ctx` */
  function addLineNote(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, tag = ctx.tag, entryNote = ctx.entryNote, askedBox = ctx.askedBox, dataKey = ctx.dataKey;
    /** what a line says under its state: the entry it would make, the ONE question it asks next, and every other thing holding it back (none is dropped) */
    /** the message of a line the sheet cannot finish (a tax payment, a loan, a transfer between own accounts, a card settlement with tax), ON THE LINE with its one step; the words are the controller's (item.say) or the refusal this line was given */
    function sayBox(item) {
      var words = item.say || ctx.says[item.key];
      if (!words) return '';
      return '<span class="bd-say" role="status" data-testid="bd-line-say" data-line-say="' + escapeHtml(item.key) + '">' + escapeHtml(words) + ' <button data-cbsid="BKS017-B18" type="button" class="bd-btn bd-go" data-act="entry"' + dataKey(item) + '>' + escapeHtml(cfg.entryWords || 'Add it as an entry') + '</button></span>';
    }
    function lineNote(item, result) {
      var moved = item.moveTo && !result && root.CBBankLock ? tag('plain', 'Posts ' + root.CBBankLock.dayText(item.moveTo.next.date) + ' · ' + item.moveTo.name + ' locked') : ''; /* W15-85 */
      return moved + lineNoteCore(item, result);
    }
    /** the reason a line the rules could not place gives, when nothing else was asked of the person: the engine's words, or what to do */
    function reasonBox(item, asked) {
      if (item.state !== 'needs_you' || asked || item.what) return '';
      return '<span class="bd-why">' + escapeHtml(/^no rule matched$/i.test(item.why || '') ? 'Nothing here says who or what this is.' : item.why || 'Nothing here says who or what this is.') + '</span>';
    }
    /** what a line says once it is neither added nor closed: the entry it would make, the ONE question, every other thing holding it back, the reason and the say-box */
    function lineNoteCore(item, result) {
      if (result) return result.ok ? tag('ok', cfg.addedWords || 'Added') : tag('bad', 'Not added: ' + result.why);
      if (item.state === 'closed') return tag('bad', item.why);
      var done = alreadyNote(item, escapeHtml);
      if (done) return done;
      var asked = askedBox(item),
        others = otherNeeds(item, tag);
      return entryNote(item) + asked + (others ? ' ' + others : '') + reasonBox(item, asked) + sayBox(item);
    }
    /** the engine's own reason for a proposal as one sentence ("narration says \"X\" — card takings paid to the bank" is the engine's; a line it could not read says what to do) */
    function sentenceOf(item) {
      if (!item.what && /^no rule matched$/i.test(item.why || '')) return 'Nothing here says who or what this is.';
      return String(item.why || '').replace(/^narration says "[^"]*" — /i, 'Looks like ');
    }
    Object.assign(ctx, { sayBox, lineNote, sentenceOf });
  }
  /** a new party, and the account a line nothing explained is given; each function lands on the one shared `ctx` */
  function addParties(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, dataKey = ctx.dataKey, chartOf = ctx.chartOf, optionsOf = ctx.optionsOf;
    function partyBox(item) {
      var party = item.party;
      if (!party || party.status !== 'new') return party ? '<span class="bd-why">Party: ' + escapeHtml(party.name) + '</span>' : '';
      var meant = (item.didYouMean || [])
        .map(function (one) {
          return '<button data-cbsid="BKS017-B03" type="button" class="bd-btn bd-meant" data-act="meant" data-key="' + escapeHtml(item.key) + '" data-id="' + escapeHtml(one.id) + '" data-name="' + escapeHtml(one.name) + '">Use ' + escapeHtml(one.name) + '</button>';
        })
        .join(' ');
      return (
        '<span class="bd-party"><b>New party:</b> <input data-cbsid="BKS017-I02" class="bd-inp" type="text" maxlength="120" aria-label="New party name" data-act="pname" data-key="' + escapeHtml(item.key) + '" value="' + escapeHtml(preview.asWritten(item) || party.name) + '"> ' +
        '<select data-cbsid="BKS017-S04" class="bd-inp" aria-label="New party kind" data-act="pkind" data-key="' + escapeHtml(item.key) + '">' +
        ['supplier', 'customer'].map(function (kind) { return '<option value="' + kind + '"' + (party.kind === kind ? ' selected' : '') + '>' + kind + '</option>'; }).join('') +
        '</select> <button data-cbsid="BKS017-B07" type="button" class="bd-btn" data-act="resolve" data-key="' + escapeHtml(item.key) + '">Use this party</button> ' + (meant ? '<span class="bd-why">Did you mean</span> ' + meant : '') + '</span>'
      );
    }
    /** B5-04: for a line nothing explained: money out goes to an expense class, money in to an income class, and BOTH name their tax kind (the pack's, never a default); the answer goes through resolve() */
    function accountBox(item) {
      if (item.state !== 'needs_you' || item.entry) return '';
      var out = item.line.debit_minor > 0,
        chart = chartOf(),
        key = escapeHtml(item.key),
        none = '<option value="' + NOT_INCOME_OR_EXPENSE + '">' + (out ? 'Not an expense (tax, loan, drawings, transfer)' : 'Not income (loan, capital, transfer)') + '</option>';
      return (
        '<span class="bd-party"><b>Or an account:</b> <select data-cbsid="BKS017-S05" class="bd-inp" aria-label="Account" data-act="acct" data-key="' + key + '">' +
        optionsOf(out ? chart.expense : chart.income, function (one) { return one.role; }, function (one) { return one.name; }).replace('</option>', '</option>' + none) + '</select> ' +
        '<select data-cbsid="BKS017-S06" class="bd-inp" aria-label="Tax kind" data-act="taxkind" data-key="' + key + '">' + optionsOf(chart.taxKinds, function (one) { return one.id; }, function (one) { return one.name; }) + '</select> ' +
        '<button data-cbsid="BKS017-B08" type="button" class="bd-btn" data-act="useacct" data-key="' + key + '">Use this account</button></span>'
      );
    }
    Object.assign(ctx, { partyBox, accountBox });
  }
  /** one choice of "What is this?" and the box that adds an own account; each function lands on the one shared `ctx` */
  function addChoices(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, dataKey = ctx.dataKey, chartOf = ctx.chartOf, optionsOf = ctx.optionsOf;
    /**
     * "What is this?" ON THE LINE, for a line nothing explained: one step each from the engine's own closed list (CBBankEntry.whatIsThis, the same list resolve() uses): moved between my own accounts
     * (asks which account when the shop has more than one), card takings paid to the bank, cash, tax paid to the tax office, a loan. The screen lists nothing of its own; an answer goes to resolveLine(key, { kind, account }).
     */
    /** the savings (or other own) account a transfer goes to does not exist yet: its name and one press make it, then the line is answered with it */
    function addOwnBox(key) {
      return '<input data-cbsid="BKS017-I03" class="bd-inp" type="text" maxlength="60" data-testid="bd-addown-name" aria-label="Name of a new savings account" placeholder="+ add a savings account: name" data-act="addownname" data-key="' + key + '"> <button data-cbsid="BKS017-B20" type="button" class="bd-btn" data-testid="bd-addown" data-act="addown" data-key="' + key + '">Add it</button> ';
    }
    /** one choice of "What is this?": its button, and (a choice that needs an account) its list right UNDER the button, then the new-account box for a transfer */
    function choiceHtml(choice, key) {
      var pick = choice.ask === 'account' && choice.accounts.length > 1,
        account = choice.ask === 'account' && !pick ? ' data-acct="' + escapeHtml(choice.accounts[0].role || choice.accounts[0].code) + '"' : '',
        button = '<button data-cbsid="BKS017-B19" type="button" class="bd-btn" data-act="kind" data-key="' + key + '" data-kind="' + escapeHtml(choice.id) + '"' + (pick ? ' data-pick="1"' : '') + account + '>' + escapeHtml(choice.words) + '</button>';
      if (!pick) return '<span class="bd-choice">' + button + '</span>';
      var chosen = optionsOf(choice.accounts, function (entry) { return entry.role || entry.code; }, function (entry) { return entry.name; }).replace('>Choose<', '>Choose the account<'),
        list = '<select data-cbsid="BKS017-S10" class="bd-inp" aria-label="' + escapeHtml('Account for: ' + choice.words) + '" data-act="kindacct-' + escapeHtml(choice.id) + '" data-key="' + key + '">' + chosen + '</select>';
      return '<span class="bd-choice">' + button + list + (choice.id === 'transfer' && cfg.addOwn ? addOwnBox(key) : '') + '</span>';
    }
    Object.assign(ctx, { choiceHtml });
  }
  /** the "What is this?" question of a line nothing explained; each function lands on the one shared `ctx` */
  function addKinds(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, choiceHtml = ctx.choiceHtml;
    /** the "What is this?" choices the engine lists for this line, or null when the line is not one nothing explained */
    function listedKinds(item) {
      var engine = root.CBBankEntry;
      if (item.state !== 'needs_you' || item.entry || !engine || !engine.whatIsThis) return null;
      return engine.whatIsThis({ country: cfg.country, own_accounts: cfg.ownAccounts ? cfg.ownAccounts() : [] }).items || [];
    }
    /** the choices as html, the one the pack's words already name leading and marked, so it is one press (l16-bank-rules) */
    function kindChoices(item, listed, key) {
      var out = item.line.debit_minor > 0,
        said = item.what && item.what.kind;
      return listed
        .filter(function (choice) {
          return choice.id !== 'expense' && choice.id !== 'other_income' && (choice.side === 'both' || choice.side === (out ? 'out' : 'in'));
        })
        .sort(function (left, right) { return (right.id === said) - (left.id === said); })
        .map(function (choice) { return (choice.id === said && !ctx.inPanel ? '<span class="bd-ask bd-looks" data-testid="bd-looks-' + escapeHtml(choice.id) + '">' + escapeHtml(preview.looksLike(item) || 'Looks like:') + '</span>' : '') + choiceHtml(choice, key); });
    }
    /** ONE short question, then the choices as buttons (the engine's own closed list, for this side of the line) */
    function kindBox(item) {
      var listed = listedKinds(item);
      if (!listed) return '';
      var key = escapeHtml(item.key),
        choices = kindChoices(item, listed, key);
      if (choices.length && !ctx.opened[item.key]) choices.push('<span class="bd-choice"><button data-cbsid="BKS017-B19" type="button" class="bd-btn" data-act="more" data-key="' + key + '">Someone or something else</button></span>');
      return choices.length ? '<span class="bd-party"><span class="bd-ask">What is this?</span><span class="bd-choices">' + choices.join('') + '</span></span>' : '';
    }
    Object.assign(ctx, { kindBox });
  }
  /** which state a row is painted in and which row is open; each function lands on the one shared `ctx` */
  function addRowState(ctx) {
    var cfg = ctx.cfg;
    /** the state a row is painted in: what happened to it when added, else its state; a proposal something still holds back is never painted "Ready to add" */
    function stateKeyOf(item, result) {
      if (result) return result.ok ? 'posted' : 'failed';
      return item.state === 'proposed' && !item.ready ? 'check' : item.state;
    }
    /** a line still waiting for a person: no result yet, not in the books, and not a proposal ready to post */
    function needsAnswer(item, results) {
      return !results[item.key] && item.state !== 'in_books' && !(item.state === 'proposed' && item.ready);
    }
    /** the ONE row that is open: the person's own choice, else the first line that needs an answer (a line held only for the GST basis waits for that question, not for a row) */
    function openKeyOf(items, results) {
      var only = cfg.only ? cfg.only() : '';
      if (only) return only;
      if (ctx.shown && items.some(function (item) { return item.key === ctx.shown; })) return ctx.shown;
      var first = items.filter(function (item) { return needsAnswer(item, results) && item.needs !== 'gst_basis'; })[0];
      return first ? first.key : '';
    }
    Object.assign(ctx, { stateKeyOf, needsAnswer, openKeyOf });
  }
  /** the pieces of a table row: its button, hint, open boxes, note, payee and state tag; each function lands on the one shared `ctx` */
  function addRowPieces(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, amountText = ctx.amountText, tag = ctx.tag, partyBox = ctx.partyBox, accountBox = ctx.accountBox, kindBox = ctx.kindBox, lineNote = ctx.lineNote, stateKeyOf = ctx.stateKeyOf, needsAnswer = ctx.needsAnswer, openKeyOf = ctx.openKeyOf;
    /** the Answer / Details / Close button of a row; none while the host answers ONE line */
    function toggleHtml(item, open, waiting) {
      if (cfg.only && cfg.only()) return '';
      return ' <button data-cbsid="BKS017-B19" type="button" class="bd-btn bd-open" data-act="open" data-key="' + escapeHtml(item.key) + '" aria-expanded="' + open + '">' + (open ? 'Close' : waiting ? 'Answer' : 'Details') + '</button>';
    }
    /** the one-line hint under a closed row whose words the pack already read */
    function hintHtml(item, open, result) {
      return !open && !result && item.what && preview.looksLike(item) ? '<div class="bd-sub bd-hint" data-testid="bd-hint"><span class="bd-ask">' + escapeHtml(preview.looksLike(item)) + '</span> ' + ctx.entryNote(item) + '</div>' : '';
    }
    /** the boxes under an open row: the "What is this?" choices, the party and the account boxes once the person said it is something else, and why the last answer failed */
    function openBoxes(item) {
      var kind = kindBox(item);
      return kind + (kind && !ctx.opened[item.key] ? '' : partyBox(item) + accountBox(item)) + (item.resolveWhy ? tag('bad', item.resolveWhy) : '');
    }
    /** what sits under a row's state: the hint, else the open boxes and the line's note */
    function subHtml(item, result, open) {
      var hint = hintHtml(item, open, result);
      if (hint) return hint;
      if (!open && !result) return '';
      return '<div class="bd-sub">' + (open ? openBoxes(item) : '') + lineNote(item, result) + '</div>';
    }
    /** the bank's words, with the party's name first once the party is known */
    function payeeCell(item, line) {
      return item.party && item.party.status === 'existing' && item.party.name ? '<b class="bd-payee">' + escapeHtml(item.party.name) + '</b> <span class="bd-bank">' + escapeHtml(line.narration) + '</span>' : escapeHtml(line.narration);
    }
    /** the state tag of a row */
    function stateTag(stateKey) {
      return tag(stateKey === 'posted' ? 'ok' : stateKey === 'proposed' ? 'go' : stateKey === 'in_books' ? 'plain' : 'ask', preview.STATE_WORDS[stateKey] || 'Needs you');
    }
    Object.assign(ctx, { toggleHtml, subHtml, payeeCell, stateTag });
  }
  /** one table row and the lines in the order a person works them; each function lands on the one shared `ctx` */
  function addRows(ctx) {
    var cfg = ctx.cfg, escapeHtml = ctx.escapeHtml, amountText = ctx.amountText, tag = ctx.tag;
    var stateKeyOf = ctx.stateKeyOf, needsAnswer = ctx.needsAnswer, openKeyOf = ctx.openKeyOf, toggleHtml = ctx.toggleHtml, subHtml = ctx.subHtml, payeeCell = ctx.payeeCell, stateTag = ctx.stateTag;
    /** a row: its figures and state on one line; the questions only while it is the open row */
    function lineRow(item, results, openKey) {
      var line = item.line,
        result = results[item.key],
        stateKey = stateKeyOf(item, result),
        open = item.key === openKey,
        waiting = needsAnswer(item, results);
      return (
        '<tr class="bd-row bd-s-' + escapeHtml(stateKey) + (open ? ' bd-is-open' : '') + '" data-line="' + escapeHtml(item.key) + '"><td class="bd-d">' + escapeHtml(preview.dateText(line.date)) + '</td><td class="bd-n">' + payeeCell(item, line) + '</td>' +
        '<td class="bd-m">' + (line.debit_minor ? escapeHtml(amountText(line.debit_minor)) : '') + '</td><td class="bd-m">' + (line.credit_minor ? escapeHtml(amountText(line.credit_minor)) : '') + '</td>' +
        '<td class="bd-st">' + stateTag(stateKey) + toggleHtml(item, open, waiting) + subHtml(item, result, open) + '</td></tr>'
      );
    }
    /** the lines in the order a person works them: waiting for an answer, then what just happened, then the ready ones and the ones already in the books, each of those two folded under one row */
    function rowsHtml(items, results) {
      var openKey = openKeyOf(items, results), only = cfg.only && cfg.only();
      var waiting = [], done = [], ready = [], booked = [];
      items.forEach(function (item) {
        (only || needsAnswer(item, results) ? waiting : results[item.key] ? done : item.state === 'in_books' ? booked : ready).push(item);
      });
      function fold(list, name, words) {
        if (!list.length) return '';
        var shown = ctx.groups[name] || list.some(function (item) { return item.key === openKey; });
        return '<tr class="bd-group"><td colspan="5"><button data-cbsid="BKS017-B19" type="button" class="bd-btn" data-act="group" data-g="' + name + '" aria-expanded="' + !!shown + '">' + escapeHtml(words + ' · ' + list.length + (list.length === 1 ? ' line' : ' lines')) + '</button></td></tr>' +
          (shown ? list.map(function (item) { return lineRow(item, results, openKey); }).join('') : '');
      }
      return [waiting, done].map(function (list) { return list.map(function (item) { return lineRow(item, results, openKey); }).join(''); }).join('') + fold(ready, 'ready', 'Ready to add') + fold(booked, 'booked', 'Already in your books');
    }
    Object.assign(ctx, { lineRow, rowsHtml });
  }
  /** the box for the rows the file lost; lands on the one shared `ctx` */
  function addSkipBox(ctx) {
    var escapeHtml = ctx.escapeHtml;
    /** B5-06: every row the file lost, by its row number, and every other warning the reader made; never hidden */
    function skipBox(model) {
      var parsed = model.parsed || {},
        skipped = parsed.skipped || [],
        other = (parsed.warnings || []).filter(function (words) {
          return !/ skipped$/.test(words);
        });
      if (!skipped.length && !other.length) return '';
      var rows = skipped.map(function (one) { return '<li class="bd-skip-row"><b>Row ' + one.row + ' was not read:</b> ' + escapeHtml(one.why) + '</li>'; }).concat(other.map(function (words) { return '<li>' + escapeHtml(words) + '</li>'; })).join('');
      return (
        '<div class="bd-skip" role="alert" data-testid="bd-skip"><p><b>' + (skipped.length ? skipped.length + (skipped.length === 1 ? ' row' : ' rows') + ' of your file ' + (skipped.length === 1 ? 'was' : 'were') + ' not read.' : 'The reader noted:') + '</b>' +
        (skipped.length ? ' Check them against the bank. The reconciliation cannot say tied while a row is missing.' : '') + '</p><ul>' + rows + '</ul></div>'
      );
    }
    ctx.skipBox = skipBox;
  }
  /** the statement check, in words: each finding's sentence, a tick on what the owner must confirm, "Use it anyway" on what the owner may override, the account to choose, and the all-done summary */
  function addCheck(ctx) {
    var escapeHtml = ctx.escapeHtml;
    function button(item, label) {
      return ' <button data-cbsid="BKS017-B16" type="button" class="bd-btn" data-act="chk" data-key="' + escapeHtml(item.code) + '">' + escapeHtml(label) + '</button>';
    }
    function pickOf(item) {
      var choices = (item.choose_from || []).map(function (one) { return '<option value="' + escapeHtml(one.id) + '">' + escapeHtml(one.name + (one.masked ? ' ' + one.masked : '')) + '</option>'; });
      return choices.length ? ' <select data-cbsid="BKS017-S09" class="bd-inp" aria-label="Which account" data-act="acctpick"><option value="">Choose</option>' + choices.join('') + '</select>' : '';
    }
    function findingBox(item) {
      var open = !item.confirmed && item.level === 'confirm' ? button(item, 'Yes, go on') : '';
      var anyway = !item.confirmed && item.level === 'refuse' && item.override ? button(item, 'Use it anyway') : '';
      return '<p class="bd-find bd-' + escapeHtml(item.level) + '" data-testid="bd-check-' + escapeHtml(item.code) + '">' + escapeHtml(item.why) + open + anyway + pickOf(item) + '</p>';
    }
    function checkBox(model) {
      var check = model.check;
      if (!check) return '';
      var all = check.already && check.already.all ? '<p class="bd-find bd-info" data-testid="bd-check-all">' + escapeHtml(check.already.summary) + '</p>' : '';
      return '<div class="bd-check" role="status">' + (check.items || []).filter(function (item) { return item.level !== 'info' || !item.confirmed; }).map(findingBox).join('') + all + '</div>';
    }
    ctx.checkBox = checkBox;
  }
  /** put every painter of a statement line on the one shared `ctx` (the order matters: each builder reads what the ones before it put there) */
  function build(ctx) {
    addTaxWords(ctx);
    addEntryWords(ctx);
    addQuestions(ctx);
    addFeeAndBasis(ctx);
    addAsks(ctx);
    addLineNote(ctx);
    addParties(ctx);
    addChoices(ctx);
    addKinds(ctx);
    addRowState(ctx);
    addRowPieces(ctx);
    addRows(ctx);
    addSkipBox(ctx);
    addCheck(ctx);
  }

  root.CBBankPreviewUIParts = { build: build, NOT_INCOME_OR_EXPENSE: NOT_INCOME_OR_EXPENSE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBBankPreviewUIParts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
