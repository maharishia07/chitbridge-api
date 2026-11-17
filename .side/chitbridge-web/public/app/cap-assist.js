/**
 * OWNS      CBAssistReview.mount: the CB Assist review in a small app (draft, accept = publish, reject, the answers list); it decides nothing about who may publish
 * CALLED BY public/tasks.html (script tag tasks.html:130; CBAssistReview.mount at tasks.html:203 for ?view=assist)
 * FLOW      mount(el) ──▶ GET /api/assist/whoami and /api/assist/questions ──▶ CBList rows ──▶ Draft (POST /api/governance/ai-draft) ──▶ Publish (POST /api/assist/publish) or Reject (no write)
 * CARD      25-ai-cb-assist-and-support-desks/cb-assist-knowledge-base
 * cap-assist.js — CB ASSIST REVIEW in a small app (T3-DISPUTES-ASSIST, 14 Oct: CB Tasks & Orders › CB Assist).
 * Naming: "CB Assist" is the assistant (feedback-coassist-terminology); a co-assist is a person or device acting for the shop (Employees).
 *
 * What it does — the workshop's #/assistreview (cap-admin.js loadGaps: the help desk's knowledge base), done the small app's way:
 *   1 · DRAFT    a question → "✨ Draft" → CB Assist proposes an answer (POST /api/governance/ai-draft, skill `assist-ask` — the one AI pipe,
 *                lib/ai.js invokeSkill). The draft is never stored.
 *   2 · ACCEPT   = Publish (POST /api/assist/publish — the help desk's own catalogue, served live) · REJECT = throw the draft away (no write).
 *                Publish is shown always, greyed WITH the server's sentence (GET /api/assist/whoami → actions.publish, code not_helpdesk).
 *   3 · THE LIST the answers CB Assist gives today (GET /api/assist/questions) — CBList: search · Where filter · sort · count · lazy rows.
 *                A row opens in the review box to refine it (qa_id → the same Publish updates it).
 * The old accept/reject queue (/assist/gaps, /assist/resolve) is retired on the server (questions arrive as chits in the help desk's Tasks);
 * this screen does not pretend it exists.
 * REUSE: CBList (list-ctl.js) · CBAction (accounts-shell.js, M64) · CBTasks.actRow (cap-tasks.js: a refused action greyed with its why) ·
 *   CB_ASSIST_EP (accounts-shell.js — the routes app.html registers, moved there, one name each).
 * Flow (docs/process/flows.json): CBA step 1 · draft an answer (draft) · CBA step 2 · accept = publish (publish).
 * NEW PATH (rule 4): cap-admin.js's KB screen is a 6,000-line workshop file bound to app.html (scr · _CARD · specNote · UI); this file is the
 *   ~150 lines a small app needs, on the same three routes. Moving app.html's #/assistreview onto it is the next step (named in the PR).
 *
 *   CBAssistReview.mount(el) → { reload }
 */
(function (root) {
  'use strict';
  var A = { el: null, items: [], may: null, list: null, qa: null, drafted: false };

  function T(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function $(id) {
    return root.document.getElementById(id);
  }
  function say(lvl, msg) {
    if (typeof root.cblog === 'function') root.cblog(lvl, msg);
  }
  function call(key, o) {
    if (typeof EP !== 'undefined' && root.CB_ASSIST_EP) for (var k in root.CB_ASSIST_EP) if (!EP[k]) EP[k] = root.CB_ASSIST_EP[k];
    return root.api(key, o);
  }
  function ctxList(v) {
    return String(v || '')
      .split(',')
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
  }
  function whereWord(c) {
    var a = Array.isArray(c) ? c : [];
    return !a.length || a.indexOf('*') >= 0 ? T('Everywhere') : a.join(', ');
  }

  /* ── the read ── */
  function load() {
    var who = call('assistWhoami').then(
      function (reply) {
        return (reply && reply.actions && reply.actions.publish) || { ok: false, say: T('Could not check who may publish. Try again.') };
      },
      function (e) {
        say('error', 'Assist: who may publish could not be read — ' + ((e && e.message) || e));
        return { ok: false, say: T('Could not check who may publish. Try again.') };
      }
    );
    return Promise.all([who, call('assistQuestions')]).then(function (reply) {
      A.may = reply[0];
      A.items = Array.isArray(reply[1]) ? reply[1] : (reply[1] && reply[1].data) || [];
    });
  }
  function fail(e) {
    say('error', 'Assist: the answers could not be read — ' + ((e && e.message) || e));
    A.el.innerHTML =
      '<div class="empty" data-testid="ca-fail"><div class="t">' +
      esc(T("Couldn't read Assist's answers. Check the connection and try again.")) +
      '</div>' +
      '<button data-cbsid="TSK007-B01" type="button" class="act" id="ca_retry" data-testid="ca-retry">' +
      esc(T('Try again')) +
      '</button></div>';
    $('ca_retry').onclick = function () {
      mount(A.el);
    };
  }

  /* ── the review box: question → ✨ Draft → Accept (publish) · Reject (discard) ── */
  function reviewHTML() {
    var q = A.qa || {};
    return (
      '<div class="tk-h">' +
      esc(T(A.qa && A.qa.id ? 'Refine this answer' : 'What Assist drafted')) +
      '</div>' +
      '<label class="sub" for="ca_q">' +
      esc(T('Question')) +
      '</label><input data-cbsid="TSK007-I01" class="inp" id="ca_q" data-testid="ca-q" maxlength="400" autocomplete="off" value="' +
      esc(q.q || '') +
      '">' +
      '<div class="tk-act"><button data-cbsid="TSK007-B02" type="button" class="act quiet" id="ca_draft" data-testid="ca-draft">' +
      esc(T('✨ Draft an answer')) +
      '</button></div>' +
      '<label class="sub" for="ca_a">' +
      esc(T('Answer')) +
      '</label><textarea data-cbsid="TSK007-T01" class="inp" id="ca_a" data-testid="ca-a" rows="4" maxlength="4000">' +
      esc(q.a || '') +
      '</textarea>' +
      (A.drafted ? '<div class="sub" data-testid="ca-drafted">' + esc(T('Assist drafted this. Read it before you accept.')) + '</div>' : '') +
      '<label class="sub" for="ca_c">' +
      esc(T('Where it shows (screens, or * for everywhere)')) +
      '</label><input data-cbsid="TSK007-I02" class="inp" id="ca_c" data-testid="ca-c" autocomplete="off" value="' +
      esc((q.context || ['*']).join(', ')) +
      '">' +
      '<div class="tk-steps">' +
      root.CBTasks.actRow('ca_accept', T('Accept and publish'), A.may, '', '', 'TSK007-B03') +
      '<div class="tk-act"><button data-cbsid="TSK007-B04" type="button" class="act quiet" id="ca_reject" data-testid="ca-reject">' +
      esc(T('Reject')) +
      '</button></div></div>' +
      '<div id="ca_out" class="tk-out" role="status" data-testid="ca-out"></div>'
    );
  }
  function paintReview() {
    var box = $('ca_review');
    if (!box) return;
    var keep = $('ca_out') ? $('ca_out').textContent : '';
    box.innerHTML = reviewHTML();
    $('ca_out').textContent = keep;
    $('ca_draft').onclick = function () {
      draft($('ca_draft'));
    };
    $('ca_reject').onclick = function () {
      A.qa = null;
      A.drafted = false;
      paintReview();
      $('ca_out').textContent = T('Thrown away. Nothing was published.');
    };
    var ok = $('ca_accept');
    if (ok && !ok.disabled)
      ok.onclick = function () {
        publish(ok);
      };
  }
  function form() {
    return { q: String($('ca_q').value || '').trim(), a: String($('ca_a').value || '').trim(), context: ctxList($('ca_c').value) };
  }
  /** CBA step 1 · draft: the one AI pipe proposes; a person reads it before anything is published */
  function draft(btn) {
    var f = form();
    if (f.q.length < 3) {
      $('ca_out').textContent = T('Type the question first.');
      return;
    }
    return root.CBAction.run(
      btn,
      function () {
        return call('aiDraft', { body: { skill_id: 'assist-ask', context: { question: f.q, screens: f.context } } });
      },
      {
        key: 'ca-draft',
        busy: T('Drafting…'),
        out: 'ca_out',
        failed: T("Assist couldn't draft this. Write the answer yourself."),
        onFail: function (w, e) {
          $('ca_out').textContent = e && e.status === 503 ? T('Assist is not connected on this server. Write the answer yourself.') : w;
        },
        outcome: function (r) {
          var text = r && (r.draft || (r.data && r.data.draft));
          if (!text) {
            $('ca_out').textContent = T("Assist couldn't draft this. Write the answer yourself.");
            return;
          }
          A.qa = Object.assign({}, A.qa || {}, { q: f.q, a: String(text), context: f.context.length ? f.context : ['*'] });
          A.drafted = true;
          paintReview();
          $('ca_out').textContent = T('Drafted. Accept it, change it, or reject it.');
        }
      }
    );
  }
  /** CBA step 2 · accept = publish (a new answer, or the opened one refined — qa_id) */
  function publish(btn) {
    var f = form();
    if (!f.q || !f.a) {
      $('ca_out').textContent = T('A question and an answer are both needed.');
      return;
    }
    var body = { question: f.q, answer: f.a, context: f.context.length ? f.context : ['*'] };
    if (A.qa && A.qa.id) body.qa_id = A.qa.id;
    return root.CBAction.run(
      btn,
      function () {
        return call('assistPublish', { body: body });
      },
      {
        key: 'ca-publish',
        failed: T("That didn't publish"),
        out: 'ca_out',
        outcome: function () {
          var upd = !!body.qa_id;
          A.qa = null;
          A.drafted = false;
          return load().then(
            function () {
              paintReview();
              mountList();
              $('ca_out').textContent = T(upd ? 'Updated. Assist answers with it now.' : 'Published. Assist answers with it now.');
            },
            function (e) {
              say('error', 'Assist: the list did not re-read after publishing — ' + ((e && e.message) || e));
              $('ca_out').textContent = T('Published. The list did not refresh — open Assist again.');
            }
          );
        }
      }
    );
  }

  /* ── the list (CBList, client-side: the library is one read) ── */
  function mountList() {
    var host = $('ca_list');
    if (!host) return;
    if (A.list) {
      try {
        A.list.destroy();
      } catch (x) {
        say('warn', 'Assist: list teardown — ' + x.message);
      }
    }
    var wheres = [];
    A.items.forEach(function (e) {
      var w = whereWord(e.context);
      if (wheres.indexOf(w) < 0) wheres.push(w);
    });
    A.list = root.CBList.mount(host, {
      key: 'assist',
      t: T,
      rows: function () {
        return A.items;
      },
      id: function (e) {
        return e.id;
      },
      rowTid: function (e) {
        return 'ca-row-' + e.id;
      },
      columns: [
        {
          key: 'q',
          label: T('Question'),
          prio: 1,
          w: 280,
          sort: 'q',
          cell: function (e) {
            return e.q || '';
          }
        },
        {
          key: 'a',
          label: T('Answer'),
          prio: 2,
          w: 360,
          cell: function (e) {
            return e.a || '';
          }
        },
        {
          key: 'where',
          label: T('Where it shows'),
          prio: 3,
          w: 160,
          cell: function (e) {
            return whereWord(e.context);
          }
        }
      ],
      defaultCols: ['q', 'a', 'where'],
      filters: [
        {
          key: 'where',
          label: T('Where it shows'),
          all: T('Anywhere'),
          options: wheres.map(function (item) {
            return { v: item, label: item };
          }),
          match: function (e, v) {
            return whereWord(e.context) === v;
          }
        }
      ],
      search: function (e) {
        return [e.q, e.a, whereWord(e.context)].join(' ');
      },
      sorts: [
        {
          key: 'as',
          label: T('As Assist lists them'),
          cmp: function () {
            return 0;
          }
        },
        {
          key: 'q',
          label: T('Question A–Z'),
          cmp: function (x, y) {
            return String(x.q || '').localeCompare(String(y.q || ''));
          }
        }
      ],
      onOpen: function (e) {
        A.qa = { id: e.id, q: e.q, a: e.a, context: Array.isArray(e.context) && e.context.length ? e.context : ['*'] };
        A.drafted = false;
        paintReview();
        var node = $('ca_q');
        if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center' });
      },
      empty: { title: T('No answers published yet') }
    });
  }

  function mount(el) {
    A.el = el;
    A.list = null;
    el.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + esc(T('Loading')) + '</div>';
    return load().then(function () {
      el.innerHTML =
        '<div class="tk-top" data-testid="ca-bar"><span class="tk-count" data-testid="ca-count"><b>' +
        A.items.length +
        '</b> ' +
        esc(T(A.items.length === 1 ? 'answer live' : 'answers live')) +
        '</span></div>' +
        '<div class="tk-panel" id="ca_review" data-testid="ca-review"></div><div class="tk-list" id="ca_list" data-testid="ca-list"></div>';
      paintReview();
      mountList();
    }, fail);
  }
  root.CBAssistReview = {
    mount: mount,
    reload: function () {
      return A.el ? mount(A.el) : Promise.resolve();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
