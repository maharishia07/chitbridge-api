/**
 * cap-employees.js — P1: EMPLOYEES AS A SMALL APP (people only). Athi, 2026-10-10: *"hide the hard part and make it very easy."*
 *
 * ONE list (CBList) — one line per person: name · user ID · what they can do · on/off · last at a counter — and ONE sheet per person with the
 * actions. Which actions are open is the SERVER's answer (GET /api/people → may/why, per this login): a refused action is drawn greyed WITH its
 * sentence; the server still refuses on its own (routes/actors.js). This file decides nothing about who may do what.
 *
 * REUSE (named in the PR): CBList (list-ctl.js) · CBAction (accounts-shell.js, M64: one press one write · ask before an irreversible one · say the
 * outcome) · the existing routes of routes/actors.js (POST / · PATCH /:id · DELETE /:id/pin · PUT /:id/status · PUT /:id/delegate · POST /suggest-key)
 * · the level presets from lib/access.js (they arrive in the answer, none is listed here) · tx/esc/toast from the shell files.
 *
 * EMBED (?embed=1&view=add|onduty): the same screens with no frame, for a host page to open in a dialog (app/embed-host.js). The page tells its
 * host what happened: window.parent.postMessage({ cb: 'employees', event: 'added' | 'changed' | 'close', person? }, location.origin).
 *
 *   CBEmployees.mount(el, { token, base, embed, view, onEnded }) → { reload }
 *
 * OWNS       the People list (mountList · cols · actRow), the person sheet (openPerson · accessPanel · emailPanel · coverPanel · resetPin · switchIt) and the Add person
 *            sheet (openAdd · createPerson · added), plus the on-duty view; no rule of who may do what (the server's may/why answers).
 * CALLED BY public/employees.html (CBEmployees.mount, a <script> tag) · public/till.html (+ Add a person, through app/embed-host.js: employees.html?embed=1&view=add in a dialog).
 * FLOW       employees.html → CBEmployees.mount(el, o) → start → load (GET /api/people → may/why) → mountList (CBList) → a row → openPerson(id) → a panel → CBAction write
 *            → changed → reload; view=add → openAdd → createPerson → added; embed=1 tells the host page by postMessage.
 * IDS        every control carries its register code (data-cbsid, UX-137): EMP001, the People screen; the row action builder actRow takes its code from each call.
 * CARD 17-people-employees-hr-and-payroll/pin-otp-first-sign-in   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
(function (root) {
  'use strict';
  var E = { people: [], may: { add: { ok: false, why: null } }, choices: [], counts: { on: 0, off: 0 }, el: null, o: {}, list: null, loaded: false };
  var HAT_OF = { editor: 'act', commenter: 'audit', viewer: 'view_only' }; /* sent beside access_level until b173 is run, as the workshop does */
  var STATE_WORD = { on: 'On', away: 'Away', off: 'Off' };
  var Copy = root.CBEmployeesCopy; /* the sign-in name and its Copy control (cap-employees-copy.js) */

  function T(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function $(id) {
    return root.document.getElementById(id);
  }

  /** the one call: a server refusal keeps its own words and its status, so CBAction.words can say it */
  function call(method, path, body) {
    return root
      .fetch((E.o.base || '') + path, {
        method: method,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + E.o.token },
        body: body ? JSON.stringify(body) : undefined
      })
      .then(function (reply) {
        return reply
          .json()
          .catch(function () {
            return {};
          })
          .then(function (j) {
            if (reply.status === 401 && E.o.onEnded) E.o.onEnded();
            if (!reply.ok) {
              var e = new Error(j.message || j.error || 'API ' + reply.status);
              e.status = reply.status;
              e.code = j.code || null; /* R112: a refusal that carries a code (CODE_ISSUE_LIMIT, CODE_SHOW_NOT_READY) says its own words even on a 503 */
              throw e;
            }
            return j;
          });
      });
  }

  /** what a host page hears (embed only) */
  function tell(event, person) {
    if (!E.o.embed || !root.parent || root.parent === root) return;
    try {
      root.parent.postMessage({ cb: 'employees', event: event, person: person || null }, root.location.origin);
    } catch (_) { /* no host window to tell: standalone page */ }
  }

  function say(msg) {
    if (typeof root.toast === 'function') root.toast(msg);
  }
  function ask(c, fn, btn, o) {
    return root.CBAction.run(btn, fn, Object.assign({ confirm: c }, o || {}));
  }

  /* ── words ── */
  function sinceWord(iso) {
    if (!iso) return T('Not yet');
    var d = Date.parse(iso);
    if (!d) return T('Not yet');
    var days = Math.floor((Date.now() - d) / 86400000);
    if (days <= 0) return T('Today');
    if (days === 1) return T('Yesterday');
    if (days < 30) return days + ' ' + T('days ago');
    try {
      return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {
      return iso.slice(0, 10);
    }
  }
  function stateTag(p) {
    var cls = p.state === 'on' ? 'green' : p.state === 'away' ? 'amber' : '';
    return (
      '<span class="tag ' +
      cls +
      '" data-testid="emp-state-' +
      esc(p.id) +
      '"><span aria-hidden="true">' +
      (p.state === 'off' ? '○' : '●') +
      '</span> ' +
      esc(T(STATE_WORD[p.state] || 'On')) +
      '</span>'
    );
  }
  function byId(id) {
    return (
      E.people.filter(function (item) {
        return item.id === id;
      })[0] || null
    );
  }

  /* ── the read ── */
  function load() {
    /* the Add form (embed view=add) needs only may/why + the picker: the server answers that without reading the list */
    return call('GET', '/api/people' + (E.o.embed && E.o.view === 'add' ? '?for=add' : '')).then(function (reply) {
      E.people = reply.people || [];
      E.may = reply.may || E.may;
      E.choices = reply.access_choices || [];
      E.counts = reply.counts || E.counts;
      E.payroll = reply.payroll || null;
      E.loaded = true;
      return reply;
    });
  }
  function reload() {
    return load().then(
      function () {
        if (E.list) E.list.refresh();
        paintBar();
      },
      function (e) {
        paintFail(e);
      }
    );
  }
  function paintFail(e) {
    if (!E.el) return;
    var refused = e && e.status === 403,
      adding = E.o.embed && E.o.view === 'add';
    E.el.innerHTML =
      '<div class="empty" data-testid="emp-fail"><div class="t">' +
      esc(T(refused ? 'This sign-in cannot open this' : adding ? "Couldn't open the form" : "Couldn't read your people")) +
      '</div>' +
      '<button data-cbsid="EMP001-B01" type="button" class="act" id="emp_retry" data-testid="emp-retry">' +
      esc(T('Try again')) +
      '</button></div>';
    $('emp_retry').onclick = function () {
      start();
    };
  }

  /* ── an action drawn the one way: shown always; greyed with the server's sentence when it may not ── */
  function actRow(id, icon, label, may, extra, stampCode) {
    var ok = !may || may.ok !== false;
    return (
      '<div class="emp-act' +
      (ok ? '' : ' no') +
      '">' +
      '<button data-cbsid="' +
      stampCode +
      '" type="button" class="act quiet" id="' +
      id +
      '" data-testid="' +
      id +
      '"' +
      (ok ? '' : ' aria-disabled="true" disabled') +
      ' title="' +
      esc(ok ? label : may.why || label) +
      '">' +
      '<span aria-hidden="true">' +
      icon +
      '</span> ' +
      esc(label) +
      '</button>' +
      (ok ? extra || '' : '<span class="why" data-testid="' + id + '-why">' + esc(may.why || '') + '</span>') +
      '</div>'
    );
  }

  /* ── the list ── */
  function cols() {
    return [
      {
        key: 'name',
        label: T('Name'),
        prio: 1,
        w: 230,
        sort: 'name',
        html: true,
        value: function (p) {
          return p.name;
        },
        cell: function (p) {
          return '<b>' + esc(p.name) + '</b>' + (p.role ? ' <span class="sub">' + esc(p.role) + '</span>' : '');
        }
      },
      {
        key: 'user_id',
        label: T('User ID'),
        prio: 2,
        w: 230,
        mono: true,
        cell: function (p) {
          return Copy.signInName(p.user_id) || '—';
        }
      },
      {
        key: 'access',
        label: T('Can do'),
        prio: 3,
        w: 170,
        sort: 'access',
        hfilter: 'access',
        cell: function (p) {
          return p.access.label;
        },
        value: function (p) {
          return p.access.label;
        }
      },
      {
        key: 'state',
        label: T('On or off'),
        prio: 4,
        w: 120,
        sort: 'state',
        hfilter: 'state',
        html: true,
        cell: stateTag,
        value: function (p) {
          return STATE_WORD[p.state];
        }
      },
      {
        key: 'last',
        label: T('Last at a counter'),
        prio: 5,
        w: 170,
        sort: 'last',
        cell: function (p) {
          return sinceWord(p.last_at);
        },
        value: function (p) {
          return p.last_at || '';
        }
      }
    ];
  }
  function mountList(host) {
    if (E.list) {
      try {
        E.list.destroy();
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
    root.CBList.reset && root.CBList.reset('employees');
    E.list = root.CBList.mount(host, {
      key: 'employees',
      t: T,
      rows: function () {
        return E.people;
      },
      id: function (p) {
        return p.id;
      },
      rowTid: function (p) {
        return 'emp-row-' + p.id;
      },
      columns: cols(),
      defaultCols: ['name', 'user_id', 'access', 'state'] /* On or off shows by default; Last at a counter is in the ⚙ chooser */,
      filters: [
        {
          key: 'state',
          label: T('On or off'),
          all: T('All'),
          options: [
            { v: 'on', label: T('On') },
            { v: 'off', label: T('Off') }
          ],
          match: function (p, v) {
            return v === 'off' ? p.state === 'off' : p.state !== 'off';
          }
        },
        {
          key: 'access',
          label: T('Can do'),
          all: T('Anything'),
          options: E.choices.map(function (item) {
            return { v: item.label, label: item.label };
          }),
          match: function (p, v) {
            return p.access.label === v;
          }
        }
      ],
      search: function (p) {
        return [p.name, p.user_id, p.role, p.access.label, p.phone].join(' ');
      },
      sorts: [
        {
          key: 'name',
          label: T('Name'),
          cmp: function (a, b) {
            return String(a.name).localeCompare(String(b.name));
          }
        },
        {
          key: 'last',
          label: T('Last at a counter'),
          cmp: function (a, b) {
            return String(b.last_at || '').localeCompare(String(a.last_at || ''));
          }
        }
      ],
      onOpen: function (p) {
        openPerson(p.id);
      },
      empty: { title: T('No one added yet') }
    });
  }

  function paintBar() {
    var node = $('emp_bar');
    if (!node) return;
    var add = E.may.add || { ok: false };
    node.innerHTML =
      '<span class="emp-count" data-testid="emp-count"><b>' +
      (E.counts.on || 0) +
      '</b> ' +
      esc(T('on')) +
      (E.counts.off ? ' · <b>' + E.counts.off + '</b> ' + esc(T('off')) : '') +
      '</span>' +
      '<span class="emp-add">' +
      actRow('emp_add', '＋', T('Add a person'), add, '', 'EMP001-B02') +
      '</span>' +
      /* CX6 (E1): payroll is SAID, not silent — the server's one line, shown while the shop's country pack lists payroll as out of scope */
      (E.payroll && E.payroll.said ? '<div class="sub" data-testid="emp-payroll" style="flex-basis:100%">' + esc(E.payroll.said) + '</div>' : '');
    var btn = $('emp_add');
    if (btn && add.ok !== false)
      btn.onclick = function () {
        openAdd();
      };
  }

  /* ── the person sheet: four actions (Add is the list's) ── */
  function sheet(html) {
    var node = $('emp_sheet');
    node.innerHTML = '<button data-cbsid="EMP001-B03" type="button" class="mx" id="emp_x" aria-label="' + esc(T('Close')) + '" title="' + esc(T('Close')) + '">✕</button>' + html;
    if (!node.open) {
      try {
        node.showModal();
      } catch (_) {
        node.setAttribute('open', '');
      }
    }
    $('emp_x').onclick = closeSheet;
    Copy.wireCopy();
  }
  function closeSheet() {
    var node = $('emp_sheet');
    try {
      node.close();
    } catch (_) {
      node.removeAttribute('open');
    }
    node.innerHTML = '';
    if (E.o.embed && E.o.view === 'add') tell('close');
  }
  function openPerson(id) {
    var node = byId(id);
    if (!node) return;
    var m = node.may;
    var coverNote = node.cover ? '<span class="sub">' + esc(T('Stands in')) + ': ' + esc(node.cover.name) + '</span>' : '';
    sheet(
      '<h2 data-testid="emp-name">' +
        esc(node.name) +
        '</h2>' +
        '<div class="emp-sub">' +
        Copy.nameWithCopy(node.user_id, 'emp-userid', 'mono') +
        ' ' +
        stateTag(node) +
        '</div>' +
        '<div id="emp_out" class="emp-out" role="status" data-testid="emp-out"></div>' +
        '<div class="emp-acts">' +
        actRow('emp_access', '🔑', T('What they can do'), m.access, '<span class="sub">' + esc(node.access.label) + '</span>', 'EMP001-B04') +
        actRow(
          'emp_email',
          '✉️',
          T('E-mail'),
          m.email || m.access,
          '<span class="sub" data-testid="emp-email-now">' + esc(node.email || (node.has_email ? T('On file') : T('None yet'))) + '</span>',
          'EMP001-B05'
        ) +
        actRow('emp_pin', '🔢', T('Reset code'), m.reset_pin, codeGivenNote(node.code_given), 'EMP001-B06') +
        '<div id="emp_code" data-testid="emp-code-slot"></div>' +
        actRow(
          'emp_switch',
          '⏻',
          m.switch.to === 'on' ? T('Switch on') : T('Switch off'),
          m.switch,
          node.jobs && m.switch.to === 'off' ? '<span class="sub">' + esc(node.jobs + ' ' + T('open jobs go to the pool')) + '</span>' : '',
          'EMP001-B07'
        ) +
        actRow('emp_cover', '🤝', T('Who stands in'), m.cover, coverNote, 'EMP001-B08') +
        '</div><div id="emp_more"></div>'
    );
    var q = function (k) {
      return $(k);
    };
    if (m.access.ok !== false)
      q('emp_access').onclick = function () {
        accessPanel(node);
      };
    if ((m.email || m.access).ok !== false)
      q('emp_email').onclick = function () {
        emailPanel(node);
      };
    if (m.reset_pin.ok !== false)
      q('emp_pin').onclick = function () {
        resetPin(node, q('emp_pin'));
      };
    if (m.switch.ok !== false)
      q('emp_switch').onclick = function () {
        switchIt(node, q('emp_switch'));
      };
    if (m.cover.ok !== false)
      q('emp_cover').onclick = function () {
        coverPanel(node);
      };
  }

  /** after a write: re-read the one list, repaint the sheet on the fresh row, tell the host */
  function changed(id, event) {
    return load().then(function () {
      if (E.list) E.list.refresh();
      paintBar();
      var node = byId(id);
      if (node) {
        var out = $('emp_out'),
          keep = out ? out.textContent : '';
        openPerson(id);
        if (keep && $('emp_out')) $('emp_out').textContent = keep;
      }
      tell(event || 'changed', node ? { id: node.id, name: node.name, user_id: node.user_id } : null);
    });
  }

  /* ── R112: a first code SHOWN to the owner (a person with no e-mail). Own box, own slot: changed() never copies it, nothing stores it, closing the sheet empties it. ── */
  /** "30 minutes" / "2 hours", read from the server's expires_at (never a number written here); '' when the api sent none (an older api) */
  function lastsWords(reply) {
    var stopsAt = reply && reply.expires_at ? Date.parse(reply.expires_at) : NaN;
    if (!stopsAt) return '';
    var mins = Math.max(1, Math.round((stopsAt - Date.now()) / 60000));
    return mins >= 120 ? Math.round(mins / 60) + ' ' + T('hours') : mins + ' ' + T(mins === 1 ? 'minute' : 'minutes');
  }
  /** a six-digit code in two groups of three; anything else as it came */
  function groupDigits(code) {
    var text = String(code == null ? '' : code);
    return /^\d{6}$/.test(text) ? text.slice(0, 3) + ' ' + text.slice(3) : text;
  }
  /** the big-digits box. Text only (textContent), no Copy button, no print: the owner reads it out or types it for them. */
  function paintCodeBox(name, reply) {
    var slot = $('emp_code');
    if (!slot || !reply || !reply.show_code) return;
    var lasts = lastsWords(reply);
    slot.innerHTML = '<div class="emp-code" role="status" data-testid="emp-code-box"><div class="emp-digits mono" data-testid="emp-code-digits"></div><div class="emp-code-say" data-testid="emp-code-say"></div></div>';
    slot.querySelector('[data-testid="emp-code-digits"]').textContent = groupDigits(reply.show_code);
    slot.querySelector('[data-testid="emp-code-say"]').textContent = T('Give this code to') + ' ' + name + '. ' + (lasts ? T('It works for') + ' ' + lasts + '.' : T('It works once.'));
  }
  /** "Code given by Asha at 24 Oct, 14:05" — the owner's own trail, from GET /api/people code_given {by, at, channel} (null for anyone else) */
  function codeGivenNote(given) {
    if (!given || !given.at) return '';
    var when = new Date(given.at);
    var at = isNaN(when) ? '' : when.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return '<span class="sub" data-testid="emp-code-given">' + esc(T('Code given') + (given.by ? ' ' + T('by') + ' ' + given.by : '') + (at ? ' ' + T('at') + ' ' + at : '')) + '</span>';
  }
  /** a refusal the person reads: the server's own words even on a 503 that carries a code; anything else keeps CBAction's sentence */
  function failInto(outId) {
    return function (words, err) {
      var el = $(outId);
      if (!el) return;
      el.textContent = err && err.code && err.status >= 500 && err.message ? err.message : words;
      el.setAttribute('data-tone', 'error');
    };
  }
  /** what the sheet says after a code was made: the dev code (local only), else the api's delivery_note */
  function codeSentence(reply) {
    var lasts = lastsWords(reply);
    if (reply && reply.otp) return T('Their first code is') + ' ' + reply.otp + (lasts ? ' — ' + T('good for') + ' ' + lasts + '.' : '.');
    return (reply && reply.delivery_note) || T('A new code is ready.');
  }

  function resetPin(p, btn) {
    ask(
      { title: T('Reset code?'), body: esc(p.name) + ' ' + esc(T('will sign in with a new code.')), yes: T('Reset'), danger: false },
      function () {
        return call('DELETE', '/api/actors/' + encodeURIComponent(p.id) + '/pin');
      },
      btn,
      {
        key: 'emp-pin-' + p.id,
        failed: T("Couldn't reset the code"),
        out: 'emp_out',
        onFail: failInto('emp_out'),
        outcome: function (r) {
          var shown = !!(r && r.show_code);
          $('emp_out').textContent = shown ? '' : codeSentence(r);
          var box = function () {
            paintCodeBox(p.name, r);
          };
          changed(p.id).then(box, box);
        }
      }
    );
  }

  function switchIt(p, btn) {
    var turningOn = p.may.switch.to === 'on';
    var run = function () {
      return call(
        'PUT',
        '/api/actors/' + encodeURIComponent(p.id) + '/status',
        turningOn ? { action: 'reactivate' } : { action: 'deactivate', task_action: p.jobs ? 'pool' : undefined }
      );
    };
    var opts = {
      key: 'emp-switch-' + p.id,
      failed: turningOn ? T("Couldn't switch on") : T("Couldn't switch off"),
      out: 'emp_out',
      outcome: function (r) {
        $('emp_out').textContent = turningOn ? codeSentence(r) : T('Switched off.');
        changed(p.id);
      }
    };
    if (turningOn) return root.CBAction.run(btn, run, opts);
    return ask(
      {
        title: T('Switch off?'),
        body: esc(p.name) + ' ' + esc(T('can no longer sign in.')) + (p.jobs ? ' ' + esc(p.jobs + ' ' + T('open jobs go to the pool.')) : ''),
        yes: T('Switch off'),
        danger: true
      },
      run,
      btn,
      opts
    );
  }

  function accessPanel(p) {
    var cur = p.access;
    var cs = E.choices
      .map(function (item, index) {
        var on = item.level === cur.level && item.whole_entity === cur.whole_entity && item.can_see_costs === cur.can_see_costs;
        return (
          '<label class="emp-opt"><input data-cbsid="EMP001-I01" type="radio" name="emp_lvl" value="' +
          index +
          '"' +
          (on ? ' checked' : '') +
          ' data-testid="emp-level-' +
          esc(item.key) +
          '"> <b>' +
          esc(item.label) +
          '</b><span class="sub">' +
          esc(item.why) +
          '</span></label>'
        );
      })
      .join('');
    $('emp_more').innerHTML =
      '<div class="emp-panel">' + cs + '<button data-cbsid="EMP001-B09" type="button" class="act" id="emp_access_go" data-testid="emp-access-go">' + esc(T('Save')) + '</button></div>';
    $('emp_access_go').onclick = function () {
      var node = root.document.querySelector('input[name="emp_lvl"]:checked');
      if (!node) return;
      var c = E.choices[+node.value];
      root.CBAction.run(
        $('emp_access_go'),
        function () {
          return call('PATCH', '/api/actors/' + encodeURIComponent(p.id), {
            access_level: c.level,
            hat: HAT_OF[c.level] || 'act',
            whole_entity: c.whole_entity,
            can_see_costs: c.can_see_costs
          });
        },
        {
          key: 'emp-access-' + p.id,
          failed: T("Couldn't save"),
          out: 'emp_out',
          outcome: function () {
            $('emp_out').textContent = T('Saved.');
            changed(p.id);
          }
        }
      );
    };
  }

  /* SEC2 · PEOPLE-EMAIL: where the first code and every reset go. The server stores it (PATCH /api/actors/:id { email }); empty clears it. */
  function emailPanel(p) {
    $('emp_more').innerHTML =
      '<div class="emp-panel"><label class="sub" for="emp_email_in">' +
      esc(T('Their e-mail. Codes are sent here, never shown.')) +
      '</label>' +
      '<input data-cbsid="EMP001-I02" class="inp" id="emp_email_in" data-testid="emp-email-in" type="email" autocomplete="off" value="' +
      esc(p.email || '') +
      '">' +
      '<button data-cbsid="EMP001-B10" type="button" class="act" id="emp_email_go" data-testid="emp-email-go">' +
      esc(T('Save')) +
      '</button></div>';
    $('emp_email_go').onclick = function () {
      var node = $('emp_email_in').value.trim();
      root.CBAction.run(
        $('emp_email_go'),
        function () {
          return call('PATCH', '/api/actors/' + encodeURIComponent(p.id), { email: node });
        },
        {
          key: 'emp-email-' + p.id,
          failed: T("Couldn't save"),
          out: 'emp_out',
          outcome: function () {
            $('emp_out').textContent = T('Saved.');
            changed(p.id);
          }
        }
      );
    };
  }

  function coverPanel(p) {
    var opts =
      '<option value="">' +
      esc(T('No one')) +
      '</option>' +
      p.cover_options
        .map(function (item) {
          return '<option value="' + esc(item.id) + '"' + (p.cover && p.cover.id === item.id ? ' selected' : '') + '>' + esc(item.name) + '</option>';
        })
        .join('');
    $('emp_more').innerHTML =
      '<div class="emp-panel"><label class="sub" for="emp_cover_sel">' +
      esc(T('Who covers when they are away?')) +
      '</label>' +
      '<select data-cbsid="EMP001-S01" id="emp_cover_sel" class="inp" data-testid="emp-cover-sel">' +
      opts +
      '</select>' +
      '<button data-cbsid="EMP001-B11" type="button" class="act" id="emp_cover_go" data-testid="emp-cover-go">' +
      esc(T('Save')) +
      '</button></div>';
    $('emp_cover_go').onclick = function () {
      var node = $('emp_cover_sel').value || null;
      root.CBAction.run(
        $('emp_cover_go'),
        function () {
          return call('PUT', '/api/actors/' + encodeURIComponent(p.id) + '/delegate', { delegate_actor_id: node });
        },
        {
          key: 'emp-cover-' + p.id,
          failed: T("Couldn't save"),
          out: 'emp_out',
          outcome: function () {
            $('emp_out').textContent = T('Saved.');
            changed(p.id);
          }
        }
      );
    };
  }

  /* ── add a person ── */
  function openAdd() {
    var cs = E.choices
      .map(function (item, index) {
        return '<option value="' + index + '"' + (item.key === 'counter' ? ' selected' : '') + '>' + esc(item.label) + '</option>';
      })
      .join('');
    sheet(
      '<h2>' +
        esc(T('Add a person')) +
        '</h2><div id="emp_out" class="emp-out" role="status" data-testid="emp-out"></div>' +
        '<form class="emp-form" novalidate onsubmit="return false">' +
        '<label for="emp_n">' +
        esc(T('Name')) +
        '</label><input data-cbsid="EMP001-I03" class="inp" id="emp_n" data-testid="emp-add-name" autocomplete="off" required data-required-msg="' + esc(T('Type their name.')) + '">' +
        '<label for="emp_k">' +
        esc(T('Sign-in name')) +
        '</label><input data-cbsid="EMP001-I04" class="inp mono" id="emp_k" data-testid="emp-add-key" autocomplete="off" maxlength="12">' +
        '<div class="sub" data-testid="emp-add-keyhint">' + esc(T('4 to 12 letters or numbers')) + '</div>' + '<div class="sub" id="emp_kn" data-testid="emp-add-keynote"></div>' +
        '<label for="emp_l">' +
        esc(T('What they can do')) +
        '</label><select data-cbsid="EMP001-S02" class="inp" id="emp_l" data-testid="emp-add-level">' +
        cs +
        '</select>' +
        '<label for="emp_r">' +
        esc(T('Job')) +
        '</label><input data-cbsid="EMP001-I05" class="inp" id="emp_r" data-testid="emp-add-role" autocomplete="off">' +
        '<label for="emp_p">' +
        esc(T('Phone')) +
        '</label><input data-cbsid="EMP001-I06" class="inp" id="emp_p" data-testid="emp-add-phone" inputmode="tel" autocomplete="off">' +
        '<label for="emp_e">' +
        esc(T('E-mail')) +
        '</label><input data-cbsid="EMP001-I07" class="inp" id="emp_e" data-testid="emp-add-email" type="email" autocomplete="off">' +
        '<button data-cbsid="EMP001-B12" type="submit" class="act" id="emp_add_go" data-testid="emp-add-go" data-sheet-save>' +
        esc(T('Add')) +
        '</button></form>'
    );
    var typedKey = false,
      tm = null;
    $('emp_k').oninput = function () {
      typedKey = true;
    };
    $('emp_n').oninput = function () {
      clearTimeout(tm);
      var name = $('emp_n').value.trim();
      if (typedKey || name.length < 2) return;
      tm = setTimeout(function () {
        call('POST', '/api/actors/suggest-key', { display_name: name }).then(
          function (reply) {
            if (typedKey) return;
            $('emp_k').value = reply.suggested_key || '';
            $('emp_kn').textContent = reply.login_format ? T('They sign in as') + ' ' + reply.login_format : '';
          },
          function () {}
        );
      }, 300);
    };
    $('emp_add_go').onclick = function () {
      var name = $('emp_n').value.trim(),
        key = $('emp_k').value.trim().toLowerCase(),
        c = E.choices[+$('emp_l').value] || {};
      if (name.length < 2) {
        $('emp_out').textContent = T('Type their name.');
        return;
      }
      if (!/^[a-z0-9]{4,12}$/.test(key)) {
        $('emp_out').textContent = T('Sign-in name: 4 to 12 letters or numbers.');
        return;
      }
      var body = {
        display_name: name,
        actor_key: key,
        actor_role: $('emp_r').value.trim() || undefined,
        phone: $('emp_p').value.trim() || undefined,
        email: $('emp_e').value.trim() || undefined,
        access_level: c.level,
        hat: HAT_OF[c.level] || 'act',
        whole_entity: !!c.whole_entity
      };
      root.CBAction.run(
        $('emp_add_go'),
        function () {
          return createPerson(body, !!c.can_see_costs);
        },
        {
          key: 'emp-add',
          failed: T("Couldn't add them"),
          out: 'emp_out',
          onFail: failInto('emp_out'),
          outcome: function (r) {
            added(r);
          }
        }
      );
    };
  }
  /** the create; money-sight is the owner's PATCH (b145), so a preset that carries it is one more call, and if that one fails the owner is told */
  function createPerson(body, seesCosts) {
    return call('POST', '/api/actors', body).then(function (reply) {
      var id = reply && reply.actor && reply.actor.identity_id;
      if (!id || !seesCosts) return reply;
      return call('PATCH', '/api/actors/' + encodeURIComponent(id), { can_see_costs: true }).then(
        function () {
          return reply;
        },
        function () {
          say(T("Added, but couldn't turn on seeing costs. Set it on their sheet."));
          return reply;
        }
      );
    });
  }
  /** the "Added" sheet: name, sign-in name, then the shown code's slot (or the api's delivery_note for an e-mailed code or an older api) */
  function addedHtml(reply, person) {
    var name = (person && person.name) || (reply.actor && reply.actor.display_name) || '';
    var codePart = reply.show_code
      ? '<div id="emp_code" data-testid="emp-code-slot"></div>'
      : '<div class="emp-out" data-testid="emp-added-code">' + esc(codeSentence(reply)) + '</div>';
    return (
      '<h2 data-testid="emp-added">' + esc(T('Added')) + '</h2><div class="emp-sub"><b>' + esc(name) + '</b></div>' +
      '<div>' + Copy.nameWithCopy((person && person.user_id) || (reply.actor && reply.actor.login_format), 'emp-added-id', 'mono') + '</div>' +
      codePart +
      '<button data-cbsid="EMP001-B13" type="button" class="act" id="emp_done" data-testid="emp-done">' + esc(T('Done')) + '</button>'
    );
  }
  function added(r) {
    var id = r && r.actor && r.actor.identity_id;
    return load().then(function () {
      if (E.list) E.list.refresh();
      paintBar();
      var p = id ? byId(id) : null;
      sheet(addedHtml(r, p));
      paintCodeBox((p && p.name) || (r.actor && r.actor.display_name) || '', r);
      $('emp_done').onclick = closeSheet;
      tell('added', { id: id, name: (p && p.name) || (r.actor && r.actor.display_name) || '', user_id: (p && p.user_id) || null });
    });
  }

  /* ── on duty: a short read-only list for an embed (who is on) ── */
  function onDuty(host) {
    var on = E.people.filter(function (item) {
      return item.state === 'on';
    });
    host.innerHTML =
      '<div class="emp-duty" data-testid="emp-duty">' +
      (on.length
        ? on
            .map(function (item) {
              return (
                '<div class="emp-duty-row" data-testid="emp-duty-' +
                esc(item.id) +
                '"><b>' +
                esc(item.name) +
                '</b> <span class="sub">' +
                esc(item.access.label) +
                ' · ' +
                esc(sinceWord(item.last_at)) +
                '</span></div>'
              );
            })
            .join('')
        : '<div class="empty"><div class="t">' + esc(T('No one is on')) + '</div></div>') +
      '</div>';
  }

  function start() {
    E.el.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + esc(T('Loading')) + '</div>';
    return load().then(
      function () {
        if (E.o.embed && E.o.view === 'onduty') return onDuty(E.el);
        if (E.o.embed && E.o.view === 'add') {
          if (E.may.add && E.may.add.ok === false) {
            E.el.innerHTML = '<div class="empty" data-testid="emp-refused"><div class="t">' + esc(E.may.add.why || '') + '</div></div>';
            return;
          }
          E.el.innerHTML = '<dialog class="sheet" id="emp_sheet" data-pop="POP129" data-testid="emp-sheet"></dialog>';
          return openAdd();
        }
        E.el.innerHTML =
          '<div class="emp-top" id="emp_bar" data-testid="emp-bar"></div><div class="emp-list" id="emp_list" data-testid="emp-list"></div><dialog class="sheet" id="emp_sheet" data-pop="POP129" data-testid="emp-sheet"></dialog>';
        var node = $('emp_sheet');
        node.addEventListener('cancel', function (e) {
          e.preventDefault();
          closeSheet();
        });
        node.addEventListener('click', function (e) {
          if (e.target === node) closeSheet();
        });
        paintBar();
        mountList($('emp_list'));
      },
      function (e) {
        paintFail(e);
      }
    );
  }

  function mount(el, o) {
    E.el = el;
    E.o = o || {};
    start();
    return { reload: reload };
  }
  root.CBEmployees = { mount: mount, sinceWord: sinceWord };
})(typeof window !== 'undefined' ? window : globalThis);
