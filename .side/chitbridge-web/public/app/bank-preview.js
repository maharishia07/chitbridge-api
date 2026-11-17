/* bank-preview.js — BANK STATEMENT → BOOKS, the ONE module: load → match → proposals → preview → confirm with reach → post.
 * OWNS      the flow of reading a statement on the device, putting each line against the books, showing the books AS THEY WILL READ once the ready lines are in
 *           (nothing saved), the confirm popup that says what the press will reach, and posting the confirmed lines ONE AT A TIME through an INJECTED post adapter.
 *           The demo page (public/bank-demo.html) and the app (public/app/cap-bank-post.js) differ ONLY in that adapter.
 * SPLIT     a line's words and its shape (STATE_WORDS · NEEDS_WORDS · moneyText · dateText · lineOf) are app/bank-preview-line.js, loaded before this file (shrink W2, 2026-11-17).
 * CALLED BY public/app/bank-demo.js (the no-login showcase) · later the Bank view (cap-bank.js) through one call-in.
 * FLOW      create(opts) → load(text) → recon.parse · recon.match · recon.suggest → project.project() → view() → confirmText() → CBLabKit.confirm → postReady(onLine) → read again
 * CARD      16-finance/bank-reconciliation-and-bank-rail   (requirement: docs 16-finance/BANK-TO-BOOKS-REQUIREMENT.md, "Critic 14 Nov")
 *
 * ⭐ THE PAGE COMPUTES NO MONEY. Matching and proposals are CBBankRecon's (match · suggest), the books-after, the reconciliation, each line's state and its client_ref
 *   are CBBankProject.project()'s, the proposed entry is the one posting.post composed inside suggest(). This file only moves carried figures and paints them.
 *   The reach popup reads project().totals and counts; when the engine says nothing the popup says so (a sum here would be a second calculation).
 * ⭐ NEVER GUESSED. A line with no entry (no account, no party known) is "Needs you" and never posted; a blocker 'gst_basis' is asked as a question (cash or accrual,
 *   once), never defaulted. No new chart account in v1: an account comes from the existing chart.
 * ⭐ ONE LINE AT A TIME. Each ready line is one adapter call with its own client_ref (the engine's bank:<fingerprint>-<n>); a failure is shown on ITS line and the others
 *   go on. A line in a closed month is refused BEFORE the press, named, and counted in the popup. A NEW party (parties_to_create, with did_you_mean) is made by the
 *   adapter FIRST (app: the CRM party door; demo: the on-screen list); if that fails, that line fails with the reason.
 * ⭐ THE ENGINE CONTRACT (engines branch feat/bank-to-books-engine, src/bank-project.js; every read of it is in this file's lineOf_ and run):
 *   project(lines, proposals, { currency, opening_minor, ledger, statement: { currency, opening_minor, closing_minor }, account }) → { ok, currency, lines[], ledger[], brs, totals,
 *   counts, parties_to_create[] } | { ok: false, code, why }. Amounts are money values { amount_minor, currency }. line: { i, state, ready, blockers[], why, entry, party, ref }.
 */
(function (root) {
  'use strict';
  var Line = root.CBBankPreviewLine || (typeof require === 'function' ? require('./bank-preview-line.js') : null); /* loaded first: app/bank-preview-line.js — a line's words and its shape */
  var STATE_WORDS = Line.STATE_WORDS,
    NEEDS_WORDS = Line.NEEDS_WORDS,
    minorOf = Line.minorOf,
    moneyText = Line.moneyText,
    dateText = Line.dateText,
    lineOf_ = Line.lineOf;
  var MAX_FILE_BYTES = 2 * 1024 * 1024;
  var MATCH_WINDOW_DAYS = 3;

  /* ── the controller's steps, each on its own: they take the options and the one state object `preview`, so create() only joins them ── */
  /** the words for why the page cannot work yet (the engine did not load); null when it can */
  function engineRefusal(opts) {
    var parts = opts.engine || {};
    var loaded = parts.recon && parts.recon.parse && parts.recon.match && parts.recon.suggest && parts.project && parts.project.project;
    return loaded ? null : 'The books engine for this page has not loaded, so nothing can be checked here yet.';
  }
  /**
   * the books' answer for every statement line: { held, near }.
   *   held  the line numbers the books already hold: match() found them, or the person PAIRED the line with a books entry (preview.pairs, by the line's ref) — { index: true }
   *   near  B5-02: for every other line, the unmatched books entries with the same amount and side nearby (the engine's nearMatches, 45 days), { index: [entry] }. Such a line is "may already be in
   *         your books", never ready: a cheque that cleared late, or one of two equal amounts, would otherwise be proposed again and posted twice. A pair the person made takes its entry out of
   *         every other line's list; "it is new" (preview.notMatch) takes the line out of the question.
   */
  function booksPass(opts, preview, lines, refs, bookLines) {
    var recon = opts.engine.recon,
      pairing = opts.pairing ? opts.pairing(lines) : {},
      found = recon.match(lines, bookLines, { window_days: MATCH_WINDOW_DAYS, line_refs: pairing.line_refs, posted: pairing.posted }),
      held = {},
      taken = {};
    found.matched.forEach(function (pair) {
      pair.stmt.forEach(function (index) {
        held[index] = true;
      });
    });
    lines.forEach(function (line, index) {
      var entryId = preview.pairs[refs[index]];
      if (entryId == null || held[index]) return;
      held[index] = true;
      taken[entryId] = true;
    });
    var open = (found.unmatched_stmt || []).filter(function (line) {
        return !held[line.i] && !preview.notMatch[refs[line.i]];
      }),
      free = (found.unmatched_ledger || []).filter(function (entry) {
        return !taken[entry.id];
      });
    return { held: held, near: recon.nearMatches ? recon.nearMatches(open, free, {}) : {} };
  }
  /** the proposal for one line the books lack: what suggest() says, or, once the owner has answered the line, what CBBankEntry.resolve() composes from the answer (the same path, one taught rule) */
  function proposalFor(opts, preview, line, ref) {
    /* the person's tick (B5-01) and word on the tax invoice (B5-03) for THIS line ride into the same engine call */
    var suggestOpts = Object.assign({}, opts.suggestOpts, preview.answers, { confirmed: !!preview.ticks[ref], tax_invoice: preview.invoice[ref], fee_tax: preview.feeTax[ref] }),
      asked = preview.resolved[ref],
      entry = opts.engine.entry;
    var proposal = opts.engine.recon.suggest(line, suggestOpts);
    if (!asked || !entry || !entry.resolve) return holdProposal_(proposal, opts);
    var answers = { party: asked.party && asked.party.id, party_name: asked.party && asked.party.name, kind: asked.kind, account: asked.account, tax_kind: asked.tax_kind };
    var resolved = entry.resolve(line, answers, suggestOpts); /* engines #147: a payee-less line composes once with learned:false and no taught rule — nothing is stored on the device either way */
    if (resolved.ok === false) {
      preview.resolveRefusal[ref] = resolved.why;
      return proposal;
    }
    delete preview.resolveRefusal[ref];
    return holdProposal_(resolved, opts);
  }
  /** the statement as the engine's project() reads it: its currency is what the FILE or the person said (B5-05), its balances and the rows the reader skipped */
  function statementOf_(opts, parsed) {
    var stated = (opts.statementCurrency && opts.statementCurrency()) || parsed.currency || null;
    return { currency: stated, opening_minor: parsed.opening_minor, closing_minor: parsed.closing_minor, skipped: parsed.skipped || [] };
  }
  /** match against the books, a proposal for each line the books lack (null for a line already there), then the engine's preview of it all */
  function projectNow(opts, preview) {
    var books = opts.ledger(),
      lines = preview.parsed.lines,
      account = opts.account,
      refs = opts.engine.project.refsOf(lines, account, lines),
      pass = booksPass(opts, preview, lines, refs, books.lines);
    /* the statement check runs BEFORE any line is worked: a refusal stops here, in the engine's words */
    var gate = checkGate_(opts, preview, pass);
    if (gate.stop) return { ok: false, why: gate.stop };
    if (gate.account && gate.account !== account) {
      account = gate.account; /* the statement carries no number: the account the check fingerprinted names the lines */
      refs = opts.engine.project.refsOf(lines, account, lines);
      pass = booksPass(opts, preview, lines, refs, books.lines);
    }
    preview.proposals = lines.map(function (line, index) {
      return pass.held[index] ? null : proposalFor(opts, preview, line, refs[index]);
    });
    /* B5-05: the statement's currency is what the FILE or the person said, never the account's: with none the engine refuses (statement_currency_missing), with another it refuses (currency_mismatch) */
    var statement = statementOf_(opts, preview.parsed);
    return opts.engine.project.project(lines, preview.proposals, { currency: opts.currency, opening_minor: books.opening_minor, ledger: books.lines, statement: statement, account: account, posted_refs: books.posted_refs || [], period_lines: lines, near: pass.near });
  }
  /** the statement check of this load (null when the host does not ask): { stop, account } — stop is the words that end line work */
  function checkGate_(opts, preview, pass) {
    var Check = root.CBBankPreviewCheck;
    preview.check = null;
    if (!Check) return {};
    var made = Check.check(opts, preview, pass);
    preview.check = made.check;
    return { stop: made.refusal, account: made.check && made.check.fingerprint_account };
  }
  /** the owner's edit of a line's party (a new name or kind, or an existing party picked from did-you-mean) laid over what the engine said */
  function withPartyEdit(item, edit, asked) {
    if (edit && item.party) item.party = Object.assign({}, item.party, edit);
    if (asked && asked.party) item.party = Object.assign({}, asked.party);
    return item;
  }
  /**
   * what THIS host cannot post from a line, set on the PROPOSAL as the one `needs` code the engine already turns into a blocker, so the engine's own counts and totals (the confirm popup) leave the line out (opt-in: the demo passes neither option).
   *   opts.postable      the event types the host's post adapter can post; a line proposing another (a tax payment, a loan, a taxed receipt) says it is not added from here yet (not_here)
   *   opts.taxRegistered true when the shop SAID it is registered for tax (unknown is not true, SET-49): a money-out line the bank's words proposed carries no tax until the owner says what kind
   *                      it is, so it is asked (tax_kind), never defaulted and never posted without. A need the engine already set (the tick, the tax basis) comes first.
   */
  function holdProposal_(proposal, opts) {
    var type = proposal && proposal.event && proposal.event.type;
    if (!type || proposal.needs) return proposal;
    if (cannotPostHere_(proposal, type, opts)) return Object.assign({}, proposal, { needs: 'not_here' });
    if (opts.taxRegistered === true && type === 'expense' && !proposal.tax) return Object.assign({}, proposal, { needs: 'tax_kind' });
    return proposal;
  }
  /** the host cannot post this proposal: its kind is not on the host's list (a taxed receipt is posted since l16-bankmatch-fix: POST /events other_income carries output_tax_minor) */
  function cannotPostHere_(proposal, type, opts) {
    return !!opts.postable && opts.postable.indexOf(type) < 0;
  }
  /** what the statement check says of this line already being done (who, when), or null */
  function alreadyOf_(preview, index, opts, ref) {
    var said = (root.CBBankPreviewCheck && root.CBBankPreviewCheck.alreadyByLine(preview.check)[index]) || null,
      late = opts && opts.lateOf ? opts.lateOf(ref) : null; /* W15-85: a line posted in a later month because its own was locked says so, found by its own ref */
    return late ? (said ? said + ' · ' : '') + late : said;
  }
  /** the owner's answers to the statement check, as controller methods: tick a finding (confirmCheck) · pick the account (chooseAccount); each reads the statement again */
  function checkAnswers(opts, preview) {
    var again = function () {
      return preview.parsed ? projectAgain(opts, preview) : false;
    };
    return {
      confirmCheck: function (code) {
        preview.confirmed = (preview.confirmed || []).concat(code);
        return again();
      },
      chooseAccount: function (id) {
        preview.chosenAccount = id;
        return again();
      }
    };
  }
  /** read the books again and project again; false (with the engine's words in preview.refusal) when the engine refuses */
  function projectAgain(opts, preview) {
    var out = projectNow(opts, preview);
    if (!out.ok) {
      Object.assign(preview, { refusal: out.why, projection: null, items: [] });
      return false;
    }
    preview.projection = out;
    preview.refusal = null;
    preview.items = out.lines.map(function (projected, index) {
      var item = lineOf_(projected, preview.parsed.lines[index], preview.proposals[index], opts.lockedMonth, out.parties_to_create || [], preview.moved);
      item.resolveWhy = preview.resolveRefusal[projected.ref] || null;
      item.alreadyWhy = alreadyOf_(preview, index, opts, projected.ref);
      return withPartyEdit(item, preview.partyEdits[projected.ref], preview.resolved[projected.ref]);
    });
    return true;
  }
  /** the lines a press would post: ready, and not already added in this session */
  function readyItems(preview) {
    return preview.items.filter(function (item) {
      return (!preview.only || item.key === preview.only) && item.ready && !(preview.results[item.key] && preview.results[item.key].ok);
    });
  }
  /** how many NEW parties the press would make: one per distinct name and kind among the ready lines (two lines naming one payee make it once) */
  function newPartyCount(preview) {
    var seen = {};
    readyItems(preview).forEach(function (item) {
      if (item.party && item.party.status === 'new') seen[String(item.party.name).toLowerCase() + '|' + item.party.kind] = 1;
    });
    return Object.keys(seen).length;
  }
  /** what the press reaches when ONE line is answered: that line's own carried figures (its amount and its tax record), not the statement's totals */
  function oneLineReach(preview, item) {
    var line = item ? item.line : {};
    return { currency: preview.projection.currency, count: item ? 1 : 0, in: line.credit_minor || 0, out: line.debit_minor || 0, tax: item && item.tax ? item.tax.tax_minor : 0, from: line.date || null, to: line.date || null, needs_you: 0, closed: 0, newParties: newPartyCount(preview), single: true };
  }
  /** what the press reaches: the engine's carried totals of the READY lines, the lines a closed month holds back, the lines that still need a person; null when the engine sent none */
  function reachOf(preview) {
    var totals = preview.projection && preview.projection.totals,
      counts = preview.projection && preview.projection.counts;
    if (!totals || !counts) return null;
    var held = preview.items.filter(function (item) {
      return item.closed;
    }).length;
    if (preview.only) return oneLineReach(preview, readyItems(preview)[0]);
    return { currency: preview.projection.currency, count: readyItems(preview).length, in: totals.in, out: totals.out, tax: totals.tax, from: totals.from, to: totals.to, needs_you: counts.needs_you, closed: held, newParties: newPartyCount(preview) };
  }
  /** the popup: count · in · out · date range · currency · new parties · how many still need you */
  function confirmWords(reach, amountText) {
    var amountOf = function (value) {
      return amountText ? amountText(value) : moneyText(value, reach.currency); /* a host draws money its own way (the in-app Bank page: plain figures, the currency said once) */
    };
    var parties = reach.newParties ? reach.newParties + (reach.newParties === 1 ? ' new party' : ' new parties') + ' made first' : null;
    var held = reach.closed ? ' ' + reach.closed + ' in a closed month are held back.' : '';
    return {
      title: 'Add ' + reach.count + (reach.count === 1 ? ' entry' : ' entries') + ' to your books?',
      lines: [
        'Money in: ' + amountOf(reach.in),
        'Money out: ' + amountOf(reach.out),
        minorOf(reach.tax) ? 'Tax inside these entries: ' + amountOf(reach.tax) : null, /* the engine's carried total of each ready line's own tax record (B5-03: the tax is on the popup too) */
        'Dated: ' + dateText(reach.from) + (reach.to && reach.to !== reach.from ? ' to ' + dateText(reach.to) : ''),
        'Currency: ' + reach.currency,
        parties,
        reach.single ? null : reach.needs_you + ' still need you; they are left out for now.' + held
      ].filter(Boolean)
    };
  }
  /** one adapter call, one line; a throw or a refusal is that line's reason, never the end of the others */
  async function postOne(opts, preview, item) {
    try {
      var reply = await opts.post(Object.assign({}, item, { ticked: !!preview.ticks[item.key] }));
      preview.results[item.key] = reply && reply.ok ? { ok: true, duplicate: !!reply.duplicate, entry_no: reply.entry_no || null, posting_date: reply.posting_date || null } : { ok: false, why: (reply && reply.why) || 'Not added.' };
    } catch (failure) {
      preview.results[item.key] = { ok: false, why: (failure && failure.message) || 'Not added.' };
    }
  }
  /** a ready line that repeats an earlier ready line of THIS statement (same party, same side, same figure, same day) is marked twin: the bank itself shows two payments, so the host may answer the server's "already paid?" for it */
  /** who a line is with, as one string: a party the books know by its id, a NEW party (its id is made per line) by kind and name; '' when the line has none */
  function partySignOf_(item) {
    var party = item.party || {};
    return party.status === 'new' ? 'new:' + party.kind + ':' + String(party.name).toLowerCase() : party.id || (item.event && item.event.party) || '';
  }
  function markTwins_(todo) {
    var seen = {};
    return todo.map(function (item) {
      var line = item.line || {}, party = partySignOf_(item);
      var sign = [party, line.date, line.credit_minor, line.debit_minor].join('|');
      var twin = !!party && !!seen[sign];
      seen[sign] = true;
      return twin ? Object.assign({}, item, { twin: true }) : item;
    });
  }
  /** post every ready line in order, tell the page after each (onLine(item, result)), then read the books again so the preview is the truth */
  async function postReady(opts, preview, onLine) {
    var owed = root.CBBankPreviewCheck ? root.CBBankPreviewCheck.pendingCodes(preview.check) : [];
    if (owed.length) return { tried: 0, added: 0, failed: 0, blocked: 'Answer the questions about this statement first.' };
    var todo = markTwins_(readyItems(preview));
    for (var position = 0; position < todo.length; position++) {
      await postOne(opts, preview, todo[position]);
      if (onLine) onLine(todo[position], preview.results[todo[position].key]);
    }
    projectAgain(opts, preview);
    var failed = todo.filter(function (item) {
      return !preview.results[item.key].ok;
    });
    return { tried: todo.length, added: todo.length - failed.length, failed: failed.length };
  }
  /** the words for why a statement text cannot be taken: engine not loaded, too big, or not a statement; null when it can */
  function textRefusal(opts, text) {
    var refusal = engineRefusal(opts);
    if (!refusal && typeof text === 'string' && text.length > MAX_FILE_BYTES) refusal = 'That file is too big for this page (2 MB at most).';
    return refusal;
  }
  /** the statement text parsed, or the words for why not: { parsed } | { refusal } */
  function readText(opts, text) {
    var refusal = textRefusal(opts, text);
    if (refusal) return { refusal: refusal };
    var parsed = opts.engine.recon.parse(text, opts.parseOpts || {});
    return parsed.ok ? { parsed: parsed } : { refusal: parsed.why || 'This file could not be read as a bank statement.' };
  }
  /** read the statement text; the state is filled and the first projection made, or the words for why not */
  function loadStatement(opts, preview, text, name) {
    Object.assign(preview, { results: {}, partyEdits: {}, resolved: {}, resolveRefusal: {}, ticks: {}, invoice: {}, feeTax: {}, pairs: {}, notMatch: {}, moved: {}, confirmed: [], chosenAccount: null, check: null });
    var read = readText(opts, text);
    if (!read.refusal) {
      Object.assign(preview, { parsed: read.parsed, name: name || '' });
      if (!projectAgain(opts, preview)) read.refusal = preview.refusal;
    }
    if (read.refusal) {
      preview.refusal = read.refusal;
      return { ok: false, why: read.refusal };
    }
    return { ok: true, count: read.parsed.lines.length, warnings: read.parsed.warnings || [] };
  }
  /** a new party needs a name; an existing party can be picked from the did-you-mean. The books are not touched. */
  function editParty(opts, preview, key, edit) {
    var picked = edit && edit.status === 'existing';
    var clean = picked ? { status: 'existing', id: edit.id, name: edit.name } : { status: 'new', name: String((edit && edit.name) || '').trim(), kind: edit && edit.kind };
    if (clean.status === 'new' && !clean.name) return { ok: false, why: 'Give the new party a name.' };
    preview.partyEdits[key] = clean;
    delete preview.resolveRefusal[key]; /* the owner changed this line: the old refusal no longer applies */
    projectAgain(opts, preview);
    return { ok: true };
  }
  /** the answers the owner gave for a line, as resolve() takes them: the party (new or existing), or an account from the chart (+ the tax kind on money out); or the words for what is missing */
  function answersOf(item, key, given) {
    if (given && (given.kind || given.account)) return { answers: { kind: given.kind || undefined, account: given.account || undefined, tax_kind: given.tax_kind || undefined } }; /* kind = an id of CBBankEntry.whatIsThis (transfer, card_settlement, tax_payment ...) */
    if (given) return { why: 'Pick an account from the list first.' };
    if (!item.party) return { why: 'Say who this is first.' };
    var party = item.party.status === 'existing' ? item.party : { status: 'new', name: item.party.name, kind: item.party.kind, id: 'new:' + key };
    return { answers: { party: party } };
  }
  /**
   * the owner has answered a "needs you" line (who it is, or which account and tax kind): the line is composed again through CBBankEntry.resolve, the one path.
   * A refusal (ours or the engine's) is kept against THAT line, in preview.resolveRefusal, until the owner changes the line: it survives every repaint.
   * A NEW party keeps its placeholder id until the adapter makes it. No new chart account: the account is one the chart already has.
   */
  function resolveLine(opts, preview, key, given) {
    var item = preview.items.filter(function (one) {
      return one.key === key;
    })[0];
    var read = item ? answersOf(item, key, given) : { why: 'This line is not on the statement.' };
    delete preview.resolveRefusal[key];
    if (read.answers) {
      preview.resolved[key] = read.answers;
      projectAgain(opts, preview);
    } else preview.resolveRefusal[key] = read.why;
    var refusalWords = preview.resolveRefusal[key];
    if (refusalWords) delete preview.resolved[key];
    if (refusalWords) projectAgain(opts, preview);
    return refusalWords ? { ok: false, why: refusalWords } : { ok: true };
  }
  /** a person's answer on one line (tick · tax invoice · pair · "it is new"): it is laid in the state, the engine is asked again, and the line says what it is now; refused for a line that is not on the statement */
  function answerLine(opts, preview, key, lay) {
    var known = preview.items.some(function (one) {
      return one.key === key;
    });
    if (!known) return { ok: false, why: 'This line is not on the statement.' };
    lay();
    projectAgain(opts, preview);
    return { ok: true };
  }
  /** the person's answers on one line, as controller methods: the tick (B5-01) · the word on the tax invoice (B5-03) · a pair with a books entry, or "it is new" (B5-02); each asks the engine again through answerLine */
  function answerMethods(opts, preview) {
    return {
      /** the person's tick: "yes, this is right" for a line only the bank's words proposed (B5-01) */
      tick: function (key) {
        return answerLine(opts, preview, key, function () {
          preview.ticks[key] = true;
        });
      },
      /** the person's word on the tax invoice for a line claiming a GST credit above the pack's threshold (B5-03): 'held' keeps the credit, 'none' books the whole amount to the expense */
      invoice: function (key, answer) {
        return answerLine(opts, preview, key, function () {
          preview.invoice[key] = answer === 'held' ? 'held' : 'none';
        });
      },
      /** BB-04: the person's word on the tax on a card settlement's fee (RQ1, never defaulted): 'tax' claims it, anything else books the whole fee as a cost with no tax */
      feeTax: function (key, answer) {
        return answerLine(opts, preview, key, function () {
          preview.feeTax[key] = answer === 'tax' ? 'tax' : 'none';
        });
      },
      /** B5-02: pair this statement line with the books entry (by its id) it already is, or say it is new */
      pair: function (key, entryId) {
        return answerLine(opts, preview, key, function () {
          preview.pairs[key] = entryId;
        });
      },
      notMatch: function (key) {
        return answerLine(opts, preview, key, function () {
          preview.notMatch[key] = true;
        });
      }
    };
  }
  /** what the person made of the months and the pairs this session: the pairs the host's band counts, and the locked months posted in the next open month (W15-85) */
  function monthMethods(opts, preview) {
    return {
      /** the pairs the person made this session, { line ref → books entry id }: the host's page reads them so its band counts the same lines the sheet does */
      pairsMade: function () {
        return Object.assign({}, preview.pairs);
      },
      /** W15-85: post the lines of a locked month (its key 'YYYY-MM') in the next open month instead (on), or take that back (off); the lines are worked again either way */
      moveLocked: function (monthKey, on) {
        if (on) preview.moved[monthKey] = true;
        else delete preview.moved[monthKey];
        return preview.parsed ? projectAgain(opts, preview) : false;
      },
      /** the months the person chose to post in the next month, { 'YYYY-MM': true } */
      movedMonths: function () {
        return Object.assign({}, preview.moved);
      }
    };
  }
  /**
   * create(opts) → the preview controller.
   *   opts.engine   { recon: CBBankRecon, project: CBBankProject, entry: CBBankEntry }      opts.currency  the ACCOUNT's currency (from the shop, never the file)
   *   opts.account  the bank account's name (in every ref)               opts.ledger()  → { lines (each with its currency), opening_minor, posted_refs }, read again after posting
   *   opts.post(item) → Promise<{ ok, duplicate?, entry_no?, why? }>      opts.lockedMonth(date) → null | { month, words }
   *   opts.statementCurrency()  the currency the STATEMENT says it is in (the engine refuses a mismatch with the account); the file's own when it says, else NONE: it is never taken from the account (B5-05), the engine refuses with "say which currency"
   *   opts.suggestOpts / parseOpts   the pack, country, learned rules, parties — passed to the engine as given
   */
  function create(opts) {
    var preview = { proposals: [], parsed: null, projection: null, items: [], results: {}, name: '', refusal: null, answers: {}, partyEdits: {}, resolved: {}, resolveRefusal: {}, ticks: {}, invoice: {}, feeTax: {}, pairs: {}, notMatch: {}, moved: {} };
    return Object.assign(answerMethods(opts, preview), monthMethods(opts, preview), checkAnswers(opts, preview), {
      load: function (text, name) {
        return loadStatement(opts, preview, text, name);
      },
      reach: function () {
        return reachOf(preview);
      },
      confirmText: function () {
        var reach = reachOf(preview);
        return reach ? confirmWords(reach, opts.amountText) : null;
      },
      postReady: function (onLine) {
        return postReady(opts, preview, onLine);
      },
      editParty: function (key, edit) {
        return editParty(opts, preview, key, edit);
      },
      resolveLine: function (key, given) {
        return resolveLine(opts, preview, key, given);
      },
      answer: function (name, value) {
        preview.answers[name] = value;
        if (preview.parsed) projectAgain(opts, preview);
      },
      /** answer ONE line only: its key (or '' for every line); what is ready, the press and its words then reach that line alone */
      only: function (key) {
        if (key !== undefined) preview.only = key || '';
        return preview.only || '';
      },
      readyCount: function () {
        return readyItems(preview).length;
      },
      view: function () {
        return { name: preview.name, parsed: preview.parsed, projection: preview.projection, items: preview.items, results: preview.results, refusal: preview.refusal, check: preview.check || null };
      }
    });
  }

  /**
   * l16-bank-rules (R69): what the PACK's words say a line is, in ONE sentence the owner's sheet and the demo both print: an own-account transfer, tax paid to the tax office, card takings paid in.
   * null when the words say nothing. It carries no figure and no account; the entry (when the engine composed one) is printed beside it by each page from the engine's own legs.
   */
  function looksLike(item) {
    var kind = item && item.what && item.what.kind,
      out = !!(item && item.line && item.line.debit_minor > 0);
    if (kind === 'transfer') return 'Looks like a transfer ' + (out ? 'to' : 'from') + ' your own account. Which one?';
    if (kind === 'tax_payment') return 'Looks like tax paid to the tax office.';
    if (kind === 'card_settlement') return 'Looks like your card takings paid into the bank.';
    return null;
  }
  /**
   * ONE standing per statement line (l16-bank-10): 'in' (in the books) · 'ready' · 'wait' (only the GST basis holds it) · 'need' (a person answers) · 'posted' · 'failed' · 'closed'.
   * The demo's chips and bar, the owner's page rows and the sheet's counts all read THIS, from the controller's own items, so one file never shows two splits.
   */
  function standing(item, result) {
    if (result) return result.ok ? 'posted' : 'failed';
    if (item.state === 'closed') return 'closed';
    if (item.state === 'in_books') return 'in';
    if (item.state === 'proposed') return item.ready ? 'ready' : item.needs === 'gst_basis' ? 'wait' : 'need';
    return 'need';
  }
  /** a new party's name in the statement's own letters (never re-cased): the slice of the bank words the engine's name was made from; the engine's name when the words do not hold it */
  function asWritten(item) {
    var name = (item && item.party && item.party.name) || '',
      words = String((item && item.line && item.line.narration) || ''),
      at = name ? words.toLowerCase().indexOf(name.toLowerCase()) : -1;
    if (at >= 0) return words.slice(at, at + name.length);
    /* the engine left a number out of the name ("EFTPOS BUNNINGS 0450 SYDNEY"): the words it kept, still in the statement's letters */
    var kept = words.split(/\s+/).filter(function (word) { return name.toLowerCase().split(/\s+/).indexOf(word.toLowerCase()) >= 0; }).join(' ');
    return kept.toLowerCase() === name.toLowerCase() ? kept : name;
  }
  root.CBBankPreview = { create: create, looksLike: looksLike, standing: standing, asWritten: asWritten, moneyText: moneyText, minorOf: minorOf, dateText: dateText, STATE_WORDS: STATE_WORDS, NEEDS_WORDS: NEEDS_WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBBankPreview;
})(typeof globalThis !== 'undefined' ? globalThis : this);
