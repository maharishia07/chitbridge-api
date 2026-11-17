/**
 * books-grant-member.js — ACC-176, THE MEMBER'S SIDE: "Who can see my books".
 *
 * OWNS      the member's screen of the books grant: the access it gave (CBList, each row with its role), Give access (the role auditor or adviser, purpose, end date, the plain-words consent of that role, a confirm that names the reach), the server's warnings, Change the end date, End access (and how many waiting actions it withdrew), who looked (CBList) and the owner's "To accept" queue (books-actions-view.js)
 * CALLED BY network-app.js (the "My books" section of the Network page)
 * FLOW      mount(host, o) → GET /api/books-grants → paint → Give access → GET /api/books-grants/consent?preset= → confirm (CBAction) → POST /api/books-grants → reload (warnings said); End access → confirm → POST …/revoke; Who looked → GET …/log; To accept → the queue as the owner
 * CARD      04-network/ACC-176-AUDITOR-GRANT · 04-network/ACC-176B-ADVISER-REQUIREMENT
 *
 * The grant is a deliberate act: nothing is sent until the owner has read the consent, ticked yes and answered the confirm that says WHO, WHICH ROLE, UNTIL WHEN and what that role may do.
 * The server decides who may (the owner of the books only) and why not; a refusal is shown in its own words. Nothing is worked out here.
 *   CBBooksGrantMember.mount(host, { call, parents, ownStore, sheet, closeSheet, mountList }) → Promise<{ reload }>
 *   call(method, path, body, headers) is the page's (token, base) · parents() → [{ id, name }] the network parents this store may open its books to · ownStore → { id, name } this business, for the owner's queue
 *
 * REUSE (named in the PR): CBList (via mountList) · CBAction.run (confirm, busy, outcome) · the page's sheet · CBBooksGrantApi (the endpoints) · CBBooksActionsView (the owner's queue) · CBBooksActing (the owner's store)
 */
(function (root) {
  'use strict';
  var panel = { host: null, o: {}, given: [], parents: [], looks: [], view: 'given', why: null, notice: [], posted: [], seeThem: false };
  var ROLE = { auditor: 'Auditor: reads only', adviser: 'Accountant: acts for you' };
  var ROLE_NAME = { adviser: 'Accountant', auditor: 'Auditor' };
  var LOOKED = {
    allowed: 'Looked',
    no_grant: 'Refused: no access',
    revoked: 'Refused: ended',
    expired: 'Refused: ran out',
    edge_off: 'Refused: not connected',
    not_listed: 'Refused: not open to an auditor',
    read_only: 'Refused: tried to change'
  };

  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function $(id) {
    return root.document.getElementById(id);
  }
  function api(key, o) {
    return root.CBBooksGrantApi.run(panel.o.call, key, o);
  }
  /** who this member may give access to: the page's active network memberships plus the businesses the server named (governance, commercial or agency edge), once each */
  function allParents() {
    var seen = {};
    return (panel.o.parents() || []).concat((panel.parents || []).map(function (p) { return { id: p.entity_id, name: p.name }; })).filter(function (p) {
      var id = String(p.id);
      return seen[id] ? false : (seen[id] = true);
    });
  }
  function nameOf(entity) {
    var found = allParents().filter(function (item) {
      return String(item.id) === String(entity);
    })[0];
    return found ? found.name : words('Your network parent');
  }
  /** a day as a person reads it, from the server's moment */
  function dayWords(value) {
    return root.shopDay(value);
  }
  function whenWords(value) {
    return root.shopStamp(value);
  }
  /** the value a date box takes: the day in the browser's own calendar */
  function dayValue(d) {
    var two = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }
  function inAYear() {
    var d = new Date();
    d.setMonth(d.getMonth() + 12); /* the default the server's consent words promise: 12 months from today */
    return dayValue(d);
  }
  function whatWords(pattern) {
    return root.CBBooksGrantWords.route(pattern);
  }
  var POSTING = { adviser_posts: 'Your accountant posts for you', owner_approves: 'You approve each post' };
  function isOpen(grant) {
    return grant.state === 'live' || grant.state === 'edge_off';
  }
  /** a firm with one open grant acts on it at once; with two (adviser and auditor) the owner says which, each grant keeping its own date and end */
  function pickOpen(group, label, run) {
    if (group.open.length === 1) run(group.open[0]);
    else root.CBBooksGrantWords.choose(panel.o.sheet, panel.o.closeSheet, group, label, run, function (p) { return words(ROLE_NAME[p] || ROLE_NAME.auditor); });
  }

  /* ── the reads ── */
  /** read the list or the log, whichever view is on; a refusal becomes the sentence shown above the list */
  function readView() {
    panel.notice = [];
    panel.seeThem = false;
    if (panel.view === 'accept') return Promise.resolve(); /* the queue reads itself, as the owner */
    var read = panel.view === 'looks' ? api('grantsLog', { query: { limit: 100 } }) : api('grantsList');
    return read.then(
      function (answer) {
        panel.why = null;
        if (panel.view === 'looks') panel.looks = (answer && answer.looks) || [];
        else { panel.given = (answer && answer.given) || []; panel.parents = (answer && answer.parents) || []; }
        return weekly();
      },
      function (failure) {
        panel.why = failure.status === 403 || failure.status === 503 ? failure.message : null;
        if (!panel.why) throw failure;
      }
    );
  }

/** what the adviser posted for the owner in the last 7 days: the same queue, filtered (accepted, delegated, since): a line to read, never a list to clear */
  function weekly() {
    if (panel.view !== 'given' || !(panel.given || []).some(function (g) { return g.preset === 'adviser'; })) return Promise.resolve();
    var since = dayValue(new Date(Date.now() - 7 * 864e5));
    return api('actionsList', { query: { state: 'accepted', delegated: 'true', since: since, limit: 100 } }).then(function (answer) {
      panel.posted = (answer && answer.actions) || [];
      if ((answer && answer.total) || panel.posted.length) { panel.notice = [root.CBBooksGrantWords.weekly(panel.posted, answer && answer.total, words)]; panel.seeThem = true; }
    }, function () {});
  }
  /* ── the screen ── */
  /** the two view buttons, the one in use marked pressed */
  function segButtons() {
    return [
      ['given', words('Access I gave'), 'NET004-B01'],
      ['looks', words('Who looked'), 'NET004-B02'],
      ['accept', words('To accept'), 'NET004-B10']
    ]
      .map(function (item) {
        return (
          '<button data-cbsid="' + item[2] + '" type="button" id="bg_seg_' + item[0] + '" class="act' + (panel.view === item[0] ? '' : ' quiet') + '" data-view="' + item[0] +
          '" data-testid="bg-seg-' + item[0] + '" aria-pressed="' + (panel.view === item[0]) + '">' + esc(item[1]) + '</button>'
        );
      })
      .join('');
  }
  /** the screen: the two views, Give access, the server's sentence if the list was refused, and the list */
  function paint() {
    panel.host.innerHTML =
      backButton() + '<div class="nw-acts" data-testid="bg-head"><div class="bg-seg" role="group" aria-label="' + esc(words('Who can see my books')) + '">' + segButtons() + '</div>' +
      '<button data-cbsid="NET004-B03" type="button" class="act" id="bg_give" data-testid="bg-give">' + esc(words('Give access')) + '</button></div>' +
      '<div class="sub" data-testid="bg-note">' + esc(words('You choose who, in which role, and until when. Every look and every step is recorded.')) + '</div>' +
      noticeHtml() +
      (panel.why ? '<div class="nw-why" id="bg_why" role="status" data-testid="bg-why">' + esc(panel.why) + '</div>' : '') +
      '<div class="nw-list" id="bg_list" data-testid="bg-list"></div>';
    Array.prototype.forEach.call(panel.host.querySelectorAll('[data-view]'), function (button) {
      button.onclick = function () {
        panel.view = button.getAttribute('data-view');
        reload();
      };
    });
    if ($('bg_back')) $('bg_back').onclick = panel.o.onBack;
    greyGive();
    $('bg_give').onclick = openGive;
    if ($('bg_seethem')) $('bg_seethem').onclick = function () { panel.view = 'posted'; panel.seeThem = false; reload(); };
    ({ looks: paintLooks, given: paintGiven, accept: paintAccept, posted: paintPosted })[panel.view]($('bg_list'));
  }
  /** what the server said beside its answer (a warning on a new grant, the actions a revoke withdrew), kept until the next read */
  function noticeHtml() {
    return panel.notice.length ? '<div class="nw-why" id="bg_notice" role="status" data-testid="bg-notice">' + panel.notice.map(esc).join(' ') + (panel.seeThem ? ' <button data-cbsid="NET004-B13" type="button" class="act quiet" id="bg_seethem" data-testid="bg-seethem">' + esc(words('See them')) + '</button>' : '') + '</div>' : '';
  }
  /** the owner's queue: the owner works in his own books, so no header and his own entity as the store */
  function paintAccept(host) {
    root.CBBooksActing.enter(panel.o.ownStore, 'owner');
    root.CBBooksActionsView.mount(host, { call: panel.o.call, mode: 'owner', mountList: panel.o.mountList, sheet: panel.o.sheet, closeSheet: panel.o.closeSheet });
  }
  /** what the firm posted for the owner this week: the delegated list, the same answer the weekly line read */
  function paintPosted() {
    root.CBBooksGrantWords.posted(panel.o.mountList, panel.posted, whenWords, words);
  }
  /** a way back to My network, when the page gives one */
  function backButton() {
    return panel.o.onBack ? '<div class="nw-acts"><button data-cbsid="NET004-B09" type="button" class="act quiet" id="bg_back" data-testid="bg-back">← ' + esc(words('Back to My network')) + '</button></div>' : '';
  }
  /** Give access is always shown; when the server refused the list (not the owner) it is greyed WITH that sentence */
  function greyGive() {
    if (!panel.why) return;
    var button = $('bg_give');
    button.setAttribute('disabled', '');
    button.setAttribute('aria-disabled', 'true');
    button.title = panel.why;
  }
  /** one list column: how a row paints and sorts */
  function col(key, label, prio, w, text, sortValue) {
    return { key: key, label: label, prio: prio, w: w, cell: text, value: sortValue || text };
  }
  /** the access this business gave, one row each, with Change date and End access */
  function paintGiven(host) {
    panel.o.mountList(host, {
      key: 'books-grants-given',
      rows: function () {
        return root.CBBooksGrantWords.groupGiven(panel.given);
      },
      id: function (g) {
        return g.grant_id;
      },
      rowTid: function (g) {
        return 'bg-grant-' + g.grant_id;
      },
      columns: [
        col('who', words('Who'), 1, 200, function (g) { return nameOf(g.grantee_entity); }),
        col('role', words('Role'), 2, 170, function (g) { return g.presets.length > 1 ? g.presets.map(function (p) { return words(ROLE_NAME[p]); }).join(' + ') : words(ROLE[g.preset] || ROLE.auditor); }),
        col('purpose', words('Why'), 2, 260, function (g) { return g.purpose || '—'; }),
        col('until', words('Until'), 2, 130, function (g) { return dayWords(g.expires_at); }, function (g) { return g.expires_at || ''; }),
        col('posting', words('Who posts'), 3, 150, function (g) { return g.preset === 'adviser' ? words(POSTING[g.posting] || 'Not chosen: you approve') : '—'; }),
        col('costs', words('Costs'), 4, 110, function (g) { return g.can_see_costs ? words('Seen') : words('Hidden'); }),
        col('state', words('State'), 1, 170, function (g) { return root.CBBooksGrantApi.stateWords(g.state); })
      ],
      actions: [
        { id: 'change', tid: 'bg-change', label: words('Change date'), when: isOpen, run: function (g) { pickOpen(g, 'Change date', openChange); } },
        { id: 'end', tid: 'bg-end', label: words('End access'), when: isOpen, run: function (g) { pickOpen(g, 'End access', askEnd); } }
      ],
      search: function (g) {
        return [nameOf(g.grantee_entity), g.purpose].join(' ');
      },
      empty: { title: words('Nobody can see your books'), body: words('Give access to your network parent when an audit needs it.') }
    });
  }
  /** who looked at these books, when and at what, newest first */
  function paintLooks(host) {
    panel.o.mountList(host, {
      key: 'books-grants-looks',
      rows: function () {
        return panel.looks;
      },
      id: function (look) {
        return look.at + '|' + look.route_pattern + '|' + look.outcome;
      },
      rowTid: function (look) {
        return 'bg-look-' + look.outcome;
      },
      columns: [
        col('at', words('When'), 1, 170, function (look) { return whenWords(look.at); }, function (look) { return look.at || ''; }),
        col('who', words('Who'), 3, 200, function (look) { return nameOf(look.grantee_entity); }),
        col('what', words('What they did'), 1, 220, function (look) { return whatWords(look.route_pattern); }),
        col('out', words('Result'), 1, 220, function (look) { return words(LOOKED[look.outcome] || look.outcome || ''); })
      ],
      search: function (look) {
        return [nameOf(look.grantee_entity), whatWords(look.route_pattern), look.outcome].join(' ');
      },
      empty: { title: words('Nobody has looked yet'), body: words('Each look at your books will be listed here.') }
    });
  }

  /* ── Give access: the consent, then a confirm that names the reach ── */
  /** the Give access form: who, why, until, costs, the consent words and the yes */
  function giveForm(parents) {
    return (
      '<h2>' + esc(words('Give access to your books')) + '</h2><div class="bg-form" data-testid="bg-form">' +
      '<label class="sub" for="bg_preset">' + esc(words('Role')) + '</label><select data-cbsid="NET004-S02" id="bg_preset" class="inp" data-testid="bg-preset">' +
      Object.keys(ROLE).map(function (k) { return '<option value="' + k + '">' + esc(words(ROLE[k])) + '</option>'; }).join('') + '</select>' +
      '<label class="sub" for="bg_who">' + esc(words('Who')) + '</label><select data-cbsid="NET004-S01" id="bg_who" class="inp" data-testid="bg-who">' +
      parents.map(function (item) { return '<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>'; }).join('') + '</select>' +
      '<label class="sub" for="bg_purpose">' + esc(words('Why (optional)')) + '</label><input data-cbsid="NET004-I01" id="bg_purpose" class="inp" maxlength="300" data-testid="bg-purpose" autocomplete="off" placeholder="' + esc(words('For example: year-end audit')) + '">' +
      '<label class="sub" for="bg_until">' + esc(words('Until')) + '</label><input data-cbsid="NET004-I02" id="bg_until" class="inp" type="date" value="' + inAYear() + '" data-testid="bg-until">' +
      '<label class="bg-tick"><input data-cbsid="NET004-I03" id="bg_costs" type="checkbox" checked data-testid="bg-costs"> ' + esc(words('They can see my costs and margins')) + '</label>' +
      '<div id="bg_consent" class="bg-consent" role="status" data-testid="bg-consent"><span class="spin"></span></div>' +
      '<div id="bg_posting" class="bg-consent" role="group" hidden data-testid="bg-posting"></div>' +
      '<label class="bg-tick"><input data-cbsid="NET004-I04" id="bg_yes" type="checkbox" data-testid="bg-yes"> ' + esc(words('I have read this, and I say yes')) + '</label>' +
      '<div class="nw-out" id="bg_out" data-testid="bg-out" role="status"></div>' +
      '<div class="nw-acts"><button data-cbsid="NET004-B04" type="button" class="act" id="bg_go" data-testid="bg-go" disabled aria-disabled="true" title="' + esc(words('Tick yes to go on.')) + '">' + esc(words('Give access')) + '</button>' +
      '<button data-cbsid="NET004-B05" type="button" class="act quiet" id="bg_cancel" data-testid="bg-cancel">' + esc(words('Cancel')) + '</button></div></div>'
    );
  }
  /** open the Give access sheet for the network parents this store may open its books to */
  function openGive() {
    var parents = allParents();
    if (!parents.length) {
      panel.o.sheet('<h2>' + esc(words('Give access')) + '</h2><p data-testid="bg-noparent">' + esc(words('You have no network parent to give access to.')) + '</p>');
      return;
    }
    panel.o.sheet(giveForm(parents));
    $('bg_cancel').onclick = panel.o.closeSheet;
    $('bg_costs').onchange = readConsent;
    $('bg_preset').onchange = readConsent;
    $('bg_yes').onchange = tickYes;
    $('bg_go').onclick = askGive;
    readConsent();
    $('bg_who').focus();
  }
  /** Give access is held until yes is ticked */
  function tickYes() {
    var go = $('bg_go');
    var yes = $('bg_yes').checked;
    var picked = $('bg_preset').value !== 'adviser' || !!pickedPosting('bg_post');
    go.disabled = !(yes && picked);
    go.setAttribute('aria-disabled', String(!(yes && picked)));
    go.title = !picked ? words('Say who posts, then tick yes.') : yes ? '' : words('Tick yes to go on.');
  }
  /** read the consent words for the costs choice and clear the yes, so it is said again */
  function readConsent() {
    $('bg_yes').checked = false;
    tickYes();
    api('grantsConsent', { query: { can_see_costs: $('bg_costs').checked ? 'true' : 'false', preset: $('bg_preset').value } }).then(
      function (consent) {
        $('bg_consent').innerHTML = consentHtml(consent);
        paintPosting(consent);
      },
      function (failure) {
        $('bg_consent').textContent = failure.message || words("Couldn't load the words. Try again.");
      }
    );
  }
/** the owner's choice of who posts, drawn from the server's words, NOTHING pre-selected: the owner must pick one (the form is held until he does) */
  function postingHtml(choices, name, current) {
    return '<b>' + esc(words('Who posts?')) + '</b>' + choices.map(function (c, i) {
      return '<label class="bg-tick"><input data-cbsid="NET004-R0' + (i + 1) + '" type="radio" name="' + name + '" value="' + esc(c.value) + '" data-testid="bg-post-' + esc(c.value) + '"' + (current === c.value ? ' checked' : '') + '> ' + esc(c.words) + '</label>';
    }).join('');
  }
  /** show the choice for the adviser role only; picking one releases Give access */
  function paintPosting(consent) {
    var box = $('bg_posting');
    var choices = (consent && consent.posting_choices) || [];
    box.hidden = !choices.length;
    box.innerHTML = choices.length ? postingHtml(choices, 'bg_post') : '';
    Array.prototype.forEach.call(box.querySelectorAll('input'), function (radio) { radio.onchange = tickYes; });
    tickYes();
  }
  /** the posting value picked on this form (null: none yet) */
  function pickedPosting(name) {
    var found = panel.host.ownerDocument.querySelector('input[name="' + name + '"]:checked');
    return found ? found.value : null;
  }
  /** one line of the consent: its label and the server's list, left out when the role has none (an auditor has no "can do") */
  function consentLine(label, list) {
    return list && list.length ? '<div>' + esc(words(label)) + ': ' + esc(list.join(', ')) + '.</div>' : '';
  }
  /** the consent in the server's own words, for the role chosen */
  function consentHtml(consent) {
    return '<b>' + esc(consent.headline) + '</b>' + consentLine('They can read', consent.can_read) + consentLine('They can do', consent.can_do) + consentLine('They cannot', consent.cannot) + '<div>' + esc(consent.costs) + '</div><div>' + esc(consent.rights) + '</div>';
  }
  /** what the form sends: the role, the parent, the purpose, the end day, costs, and the yes */
  function giveBody() {
    return {
      preset: $('bg_preset').value,
      grantee: $('bg_who').value,
      purpose: $('bg_purpose').value.trim() || undefined,
      expires_at: $('bg_until').value || undefined,
      can_see_costs: $('bg_costs').checked,
      posting: $('bg_preset').value === 'adviser' ? pickedPosting('bg_post') || undefined : undefined,
      consent: $('bg_yes').checked
    };
  }
  /** the confirm's sentence: who, which role and what it may do, until when */
  function giveQuestion(who, adviser, until, posting) {
    var when = '<b>' + esc(until ? dayWords(until + 'T12:00:00') : words('12 months from today')) + '</b>. ';
    return adviser && posting === 'adviser_posts'
      ? '<b>' + esc(who) + '</b> ' + esc(words('will be able to post, lock, unlock and close the year in your books until')) + ' ' + when + esc(words('You do not approve each one and nobody else checks it first. Every action is recorded, you are told at once of an unlock or a year close, and you can switch this back or end it any time.'))
      : adviser
      ? '<b>' + esc(who) + '</b> ' + esc(words('will be able to prepare entries in your books until')) + ' ' + when + esc(words('Nothing is posted until you accept it. Every step is recorded.'))
      : '<b>' + esc(who) + '</b> ' + esc(words('will be able to read your books until')) + ' ' + when + esc(words('Read only: they cannot change anything. Every look is recorded.'));
  }
  /** the server's warnings on a new grant, each in the server's words */
  function warningsOf(answer) {
    return ((answer && answer.warnings) || []).map(function (w) { return w.words; });
  }
  /** send the grant once the owner confirms who, which role, until when and what that role may do */
  function askGive() {
    var parentBox = $('bg_who');
    var until = $('bg_until').value;
    var body = giveBody();
    var adviser = body.preset === 'adviser';
    root.CBAction.run(
      $('bg_go'),
      function () {
        return api('grantsGive', { body: body });
      },
      {
        key: 'bg-give',
        confirm: {
          title: words(adviser ? 'Let this firm act in your books?' : 'Give read-only access?'),
          body: giveQuestion(parentBox.options[parentBox.selectedIndex].text, adviser, until, body.posting),
          yes: words('Give access')
        },
        failed: words("Couldn't give access"),
        out: 'bg_out',
        outcome: function (answer) {
          panel.o.closeSheet();
          panel.view = 'given';
          reload().then(function () {
            panel.notice = warningsOf(answer);
            paint();
          });
        }
      }
    );
  }

  /* ── Change the end date · End access ── */
  /** the sheet that changes the end date of one open access */
  function openChange(grant) {
    panel.o.sheet(
      '<h2>' + esc(words('Change the end date')) + '</h2><div class="bg-form" data-testid="bg-change-form"><div class="sub">' + esc(nameOf(grant.grantee_entity)) + '</div>' +
        '<label class="sub" for="bg_until2">' + esc(words('Until')) + '</label><input data-cbsid="NET004-I05" id="bg_until2" class="inp" type="date" value="' + esc(dayValue(new Date(grant.expires_at))) + '" data-testid="bg-until2">' +
        (grant.preset === 'adviser' ? '<div class="bg-consent" role="group" data-testid="bg-post2">' + postingHtml([{ value: 'adviser_posts', words: words(POSTING.adviser_posts) }, { value: 'owner_approves', words: words(POSTING.owner_approves) }], 'bg_post2', grant.posting) + '</div>' : '') +
        '<div class="nw-out" id="bg_out2" data-testid="bg-out2" role="status"></div>' +
        '<div class="nw-acts"><button data-cbsid="NET004-B06" type="button" class="act" id="bg_save" data-testid="bg-save">' + esc(words('Save')) + '</button>' +
        '<button data-cbsid="NET004-B07" type="button" class="act quiet" id="bg_cancel2" data-testid="bg-cancel2">' + esc(words('Cancel')) + '</button></div></div>'
    );
    $('bg_cancel2').onclick = panel.o.closeSheet;
    /** Save sends the new end day once; the sheet closes and the list is read again */
    $('bg_save').onclick = function () {
      var switching = pickedPosting('bg_post2') === 'adviser_posts' && grant.posting !== 'adviser_posts'; /* switching to "your adviser posts" removes your approval: the same question as giving it */
      root.CBAction.run(
        $('bg_save'),
        function () {
          return api('grantsChange', { params: { id: grant.grant_id }, body: { expires_at: $('bg_until2').value, posting: pickedPosting('bg_post2') || undefined } });
        },
        {
          key: 'bg-change-' + grant.grant_id,
          confirm: switching ? { title: words('Let this firm act in your books?'), body: giveQuestion(nameOf(grant.grantee_entity), true, $('bg_until2').value, 'adviser_posts'), yes: words('Save') } : undefined,
          failed: words("Couldn't save the change"),
          out: 'bg_out2',
          outcome: function () {
            panel.o.closeSheet();
            reload();
          }
        }
      );
    };
  }
  /** what ending an access did to the actions still waiting under it (the server counts them) */
  function withdrawnWords(ended) {
    var n = (ended && ended.actions_withdrawn) || 0;
    return n ? [n + ' ' + words(n === 1 ? 'waiting action was withdrawn. Nothing was posted.' : 'waiting actions were withdrawn. Nothing was posted.')] : [];
  }
  /** end an access now, after a confirm that names who */
  function askEnd(grant) {
    root.CBAction.run(
      null,
      function () {
        return api('grantsRevoke', { params: { id: grant.grant_id }, body: {} });
      },
      {
        key: 'bg-end-' + grant.grant_id,
        confirm: {
          title: words('End this access now?'),
          body: '<b>' + esc(nameOf(grant.grantee_entity)) + '</b> ' + esc(words('will not be able to open your books again unless you give access again.')),
          yes: words('End access'),
          danger: true
        },
        failed: words("Couldn't end the access"),
        done: words('Access ended.'),
        outcome: function (ended) {
          reload().then(function () {
            panel.notice = withdrawnWords(ended);
            paint();
          });
        }
      }
    );
  }

  /** the list could not be read: say so and offer Try again */
  function paintFail() {
    panel.host.innerHTML =
      emptyState('⚠️', words("Couldn't read who can see your books")) +
      '<button data-cbsid="NET004-B08" type="button" class="act" id="bg_retry" data-testid="bg-retry">' + esc(words('Try again')) + '</button>';
    $('bg_retry').onclick = reload;
  }
  /** read the current view from the server and paint it */
  function reload() {
    return readView().then(paint, paintFail);
  }
  /** start the screen in the host the page gives */
  function mount(host, o) {
    panel.host = host;
    panel.o = o || {};
    panel.view = 'given';
    return reload().then(function () {
      return { reload: reload };
    });
  }
  root.CBBooksGrantMember = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
