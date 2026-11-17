/* app/cap-suppliers.js — SUPPLIERS: who you buy from, whether you can order from them, add · link · remove (T3-OPS, 2026-10-14; CB Operations › Suppliers).
 * OWNS      the Suppliers list outside the workshop (CBSuppliers.mount: readiness, add, link, remove) and the three moved helpers supName, supKindOf, isUserId
 * CALLED BY public/operations.html (script tag, CBSuppliers.mount at operations.html:133 for #/suppliers); public/app.html loads it at boot (script tag app.html:1654) and calls the three helpers (not CBSuppliers; the workshop does not mount it)
 * FLOW      mount(host) ──▶ GET the supplier list (CBList rows) ──▶ readiness from the row's own fields ──▶ Add: a User ID or email ──▶ POST /api/relationships/suppliers (link), else a local supplier by name
 * CARD      12-suppliers-and-procurement/supplier-list
 *
 *
 * ── WHAT IS MOVED (CLAUDE.md rule 1 — moved, never copied; app.html calls these same names and no longer defines them) ─────────────────
 *   supName · supKindOf · isUserId — the supplier's shown name, its Trade/Other kind, and "is this a handle or a name" (were app.html:7769,
 *   7787, 17366). app.html loads this file at boot, so the workshop's Suppliers screen keeps working on the one copy.
 * ── WHAT IS NEW, AND WHY ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   CBSuppliers.mount(host) — the supplier list as a CBList outside the workshop. The workshop's suppliersScreen is not a module: it is the
 *   .panel/.divider master-detail bound to the supplier CART (ordering, P2P step 2, which lives in Tasks & Orders), Find a product and
 *   Required certificates. Those stay in the workshop; this is the list, its readiness and its add/link/remove (docs/critique/T3-OPS.md).
 *
 * ── READINESS — "can I order from them?" — from the list's own fields, no extra read ─────────────────────────────────────────────────
 *   on_rail (api lib/istest mayTrade) · has_catalogue · one_sided.why (the server's sentence) · facts.rung (declared / checked tax id).
 *   Three answers, never two: has a catalogue · on ChitBridge with none (can't tell what they stock) · not on ChitBridge (record by hand).
 *   ⚠️ The certificate match (what YOU require of them, OPS-S2) is NOT here yet — said on the row, never implied by a green tick.
 *
 * ── ADD / LINK ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   A User ID or email → POST /api/relationships/suppliers { supplier_bridge_id } (LINK a ChitBridge business). The server answers 404 when
 *   there is none — a STATUS, so this branches on e.status, never on the sentence (the workshop regexed it). Then it offers to add the name
 *   as a local supplier ({ name }, minted off-rail by the server). Every write is CBAction (M64); who may write is the server's answer.
 *
 * Host globals: api · EP · esc · tx · txf · toast · CBList · CBAction · CBConfirm (accounts-shell.js) · taxIdWord (helpers.js, optional) · cblog.
 * Flow step: P2P step 1 · need (who you buy from) — docs/process/flows.json.
 */
'use strict';
/** the name a supplier is shown by: your label first, then their registered name */
function supName(x) {
  return (x && (x.nickname || x.display_name)) || '—';
}
/** Trade (resale: goods to sell on) or Other (own_use: what the shop consumes) — the flag decides what a delivery from them does (lib/adopt.js) */
function supKindOf(x) {
  return x && x.supply_kind === 'own_use' ? 'own_use' : 'resale';
}
/** a User ID (8+ characters, no space) or an email — somebody to look up; anything else is a name to write down */
function isUserId(v) {
  v = (v || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || (v.length >= 8 && !/\s/.test(v));
}

var CBSuppliers = (function () {
  var S = { rows: null, err: null, busy: false, list: null, kind: 'resale', dlg: null };
  function t(s) {
    return typeof tx === 'function' ? tx(s) : s;
  }
  function tf(s, v) {
    return typeof txf === 'function'
      ? txf(s, v)
      : String(s).replace(/\{(\w+)\}/g, function (_, k) {
          return v[k];
        });
  }
  function log(m) {
    if (typeof cblog === 'function') cblog('error', 'suppliers: ' + m);
  }

  /** readiness in three answers + the server's own sentence when it has one */
  function ready(x) {
    if (x.one_sided && x.one_sided.why) return { k: 'one', text: t('Orders stay with you'), why: x.one_sided.why, tone: 'amber' };
    if (x.on_rail === false) return { k: 'off', text: t('Not on the network'), why: t('Record what you buy from them by hand.'), tone: '' };
    if (x.has_catalogue)
      return { k: 'cat', text: t('Can order · catalogue'), why: t('Their catalogue is published: order from it in Tasks & Orders.'), tone: 'green' };
    return {
      k: 'nocat',
      text: t('On the network · no catalogue'),
      why: t('They have published no catalogue, so what they stock is not known.'),
      tone: 'amber'
    };
  }
  function taxCell(x) {
    var f = x.facts || {};
    if (!f.gstin) return '<span class="sub">—</span>';
    var word = typeof taxIdWord === 'function' ? taxIdWord(f.country || '') : t('Tax number');
    return (
      '<span class="sub">' +
      esc(t(word)) +
      '</span> <span class="mono">' +
      esc(f.gstin) +
      '</span>' +
      (f.gstin_rung ? ' <span class="sub">· ' + esc(t(f.gstin_rung)) + '</span>' : '')
    );
  }

  function load() {
    if (S.busy) return Promise.resolve();
    S.busy = true;
    S.err = null;
    if (S.list) S.list.refresh();
    return api('supList')
      .then(function (reply) {
        S.rows = Array.isArray(reply) ? reply : (reply && reply.suppliers) || [];
      })
      .catch(function (e) {
        S.err = e;
        log('GET /api/relationships/suppliers failed — ' + ((e && e.message) || e));
      })
      .then(function () {
        S.busy = false;
        if (S.list) S.list.refresh();
      });
  }

  function cols() {
    return [
      {
        key: 'name',
        label: t('Supplier'),
        prio: 1,
        w: 280,
        sort: 'az',
        html: true,
        cell: function (x) {
          return (
            (x.preferred ? '<span title="' + esc(t('Preferred')) + '" aria-label="' + esc(t('Preferred')) + '">★</span> ' : '') +
            esc(supName(x)) +
            (x.category ? ' <span class="tag">' + esc(x.category) + '</span>' : '')
          );
        }
      },
      {
        key: 'ready',
        label: t('Can you order?'),
        prio: 2,
        w: 230,
        sort: 'ready',
        html: true,
        tid: function (x) {
          return 'sup-ready-' + x.supplier_list_id;
        },
        cell: function (x) {
          var r = ready(x);
          return '<span class="tag' + (r.tone ? ' ' + r.tone : '') + '">' + esc(r.text) + '</span>';
        }
      },
      {
        key: 'cbid',
        label: t('Network ID'),
        prio: 3,
        w: 190,
        html: true,
        cell: function (x) {
          var id = x.user_id || x.bridge_id;
          return id && x.on_rail !== false ? '<span class="mono">' + esc(id) + '</span>' : '<span class="sub">' + esc(t('off-rail')) + '</span>';
        }
      },
      { key: 'tax', label: t('Tax number'), prio: 4, w: 230, html: true, cell: taxCell }
    ];
  }
  function next(x) {
    var r = ready(x);
    return (
      '<div data-testid="sup-next-' +
      esc(x.supplier_list_id) +
      '"><div>' +
      esc(r.why) +
      '</div>' +
      '<div class="sub">' +
      esc(t('Required certificates are checked in a later release.')) +
      '</div>' +
      (x.notes ? '<div class="sub">' + esc(x.notes) + '</div>' : '') +
      '</div>'
    );
  }

  /* ── the writes: every one through CBAction, the outcome said in the toast, the server's refusal in its own words ── */
  function btnOf(id, act) {
    return document.querySelector('[data-act="' + act + '"][data-actrow="' + id + '"]');
  }
  function patch(x, body, done) {
    return CBAction.run(
      btnOf(x.supplier_list_id, Object.keys(body)[0]),
      function () {
        return api('supPatch', { params: { id: x.supplier_list_id }, body: body });
      },
      { key: 'sup-' + Object.keys(body)[0] + '-' + x.supplier_list_id, done: done, failed: t('Could not change the supplier — try again') }
    ).then(function (reply) {
      if (reply.ok) load();
    });
  }
  var ACTIONS = [
    {
      id: 'preferred',
      label: 'Preferred ★',
      tid: 'sup-pref',
      run: function (x) {
        patch(x, { preferred: !x.preferred }, x.preferred ? t('No longer preferred') : t('Marked preferred'));
      }
    },
    {
      id: 'supply_kind',
      label: 'Move to the other list',
      tid: 'sup-move',
      run: function (x) {
        patch(x, { supply_kind: supKindOf(x) === 'own_use' ? 'resale' : 'own_use' }, t('Moved'));
      }
    },
    {
      id: 'remove',
      label: 'Remove',
      tid: 'sup-remove',
      run: function (x) {
        CBAction.run(
          btnOf(x.supplier_list_id, 'remove'),
          function () {
            return api('supDel', { params: { id: x.supplier_list_id } });
          },
          {
            key: 'sup-remove-' + x.supplier_list_id,
            confirm: {
              title: tf('Remove {name} from your list?', { name: supName(x) }),
              body: esc(t('Their business and your past bills are untouched — only your list entry goes.')),
              yes: t('Remove'),
              danger: true
            },
            done: t('Supplier removed'),
            failed: t('Could not remove the supplier — try again')
          }
        ).then(function (reply) {
          if (reply.ok) load();
        });
      }
    }
  ];

  function opts() {
    return {
      key: 'ops-suppliers',
      t: t,
      hl: false,
      id: function (x) {
        return x.supplier_list_id;
      },
      rowTid: function (x) {
        return 'sup-row-' + x.supplier_list_id;
      },
      columns: cols,
      rows: function () {
        return S.rows || [];
      },
      next: next,
      actions: ACTIONS,
      state: function () {
        return S.err ? 'error' : S.rows === null ? 'loading' : null;
      },
      error: function () {
        return { title: t('Could not read your suppliers.'), sub: t('Nothing was changed. Try again in a moment.') };
      },
      onRetry: load,
      empty: { title: t('No suppliers yet.'), sub: t('Add one by their User ID or email, or just a name.') },
      /* ⭐ Trade / Other are the list's own saved views — the kind decides what a delivery from them does, so the add dialog asks it again */
      views: {
        tid: 'sup-view',
        items: [
          { key: 'trade', label: t('To sell'), filt: { kind: 'resale' } },
          { key: 'other', label: t('To use'), filt: { kind: 'own_use' } }
        ]
      },
      preset: { filt: { kind: 'resale' } },
      filters: [
        {
          key: 'kind',
          label: t('Kind'),
          all: t('To sell or to use'),
          options: [
            { v: 'resale', label: t('To sell') },
            { v: 'own_use', label: t('To use') }
          ],
          match: function (x, v) {
            return supKindOf(x) === v;
          }
        },
        {
          key: 'ready',
          label: t('Can you order?'),
          all: t('Any'),
          options: [
            { v: 'cat', label: t('Can order · catalogue') },
            { v: 'nocat', label: t('On the network · no catalogue') },
            { v: 'off', label: t('Not on the network') },
            { v: 'one', label: t('Orders stay with you') }
          ],
          match: function (x, v) {
            return ready(x).k === v;
          }
        }
      ],
      search: function (x) {
        return [x.nickname, x.display_name, x.category, x.user_id, x.bridge_id, x.facts && x.facts.gstin].filter(Boolean).join(' ');
      },
      sorts: [
        {
          key: 'pref',
          label: t('★ Preferred first'),
          cmp: function (a, b) {
            return (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0) || supName(a).localeCompare(supName(b));
          }
        },
        {
          key: 'az',
          label: t('A–Z'),
          cmp: function (a, b) {
            return supName(a).localeCompare(supName(b));
          }
        },
        {
          key: 'ready',
          label: t('Ready to order first'),
          cmp: function (a, b) {
            var o = { cat: 0, nocat: 1, one: 2, off: 3 };
            return o[ready(a).k] - o[ready(b).k] || supName(a).localeCompare(supName(b));
          }
        }
      ],
      head: function () {
        var n = (S.rows || []).length;
        return {
          title: t('Suppliers'),
          chips: n ? [{ text: tf(n === 1 ? '{n} supplier' : '{n} suppliers', { n: n }), tid: 'sup-count' }] : [],
          slot: function (el) {
            el.innerHTML = '<button data-cbsid="BUS002-B01" type="button" class="act" data-testid="sup-add-open">+ ' + esc(t('Add supplier')) + '</button>';
            el.firstChild.onclick = openAdd;
          }
        };
      }
    };
  }

  /* ── add / link: one dialog, the kind asked, a 404 offers the local add ── */
  function openAdd() {
    var node = S.dlg;
    if (!node) {
      node = S.dlg = document.createElement('dialog');
      node.className = 'sheet';
      node.setAttribute('data-pop', 'POP147');
      node.setAttribute('data-testid', 'sup-add-dlg');
      document.body.appendChild(node);
    }
    var listKind = S.kind;
    node.innerHTML =
      '<button data-cbsid="CMP005" type="button" class="mx" aria-label="' +
      esc(t('Close')) +
      '" data-x>✕</button><h2>' +
      esc(t('Add a supplier')) +
      '</h2>' +
      '<p class="sub">' +
      esc(t('Their User ID or email links a ChitBridge business. A plain name adds a local one.')) +
      '</p>' +
      '<label class="fl" for="sp_q">' +
      esc(t('Name, User ID or email')) +
      '</label><input data-cbsid="BUS002-I01" class="inp" id="sp_q" data-testid="sup-add-q" autocomplete="off">' +
      '<fieldset class="op-kind"><legend class="fl">' +
      esc(t('What do you buy from them?')) +
      '</legend>' +
      '<label><input data-cbsid="BUS002-I02" type="radio" name="sp_kind" value="resale"' +
      (listKind !== 'own_use' ? ' checked' : '') +
      ' data-testid="sup-add-trade"> ' +
      esc(t('Goods to sell')) +
      '</label>' +
      '<label><input data-cbsid="BUS002-I03" type="radio" name="sp_kind" value="own_use"' +
      (listKind === 'own_use' ? ' checked' : '') +
      ' data-testid="sup-add-other"> ' +
      esc(t('Things the shop uses')) +
      '</label></fieldset>' +
      '<div class="err" id="sp_out" data-testid="sup-add-out" role="status"></div>' +
      '<div class="op-acts"><button data-cbsid="BUS002-B02" type="button" class="act" data-testid="sup-add-go">' +
      esc(t('Add')) +
      '</button><button data-cbsid="BUS002-B03" type="button" class="act quiet" data-x>' +
      esc(t('Cancel')) +
      '</button></div>';
    Array.prototype.forEach.call(node.querySelectorAll('[data-x]'), function (b) {
      b.onclick = function () {
        node.close();
      };
    });
    node.querySelector('[data-testid="sup-add-go"]').onclick = function () {
      add(this);
    };
    node.querySelector('#sp_q').onkeydown = function (e) {
      if (e.key === 'Enter') add(node.querySelector('[data-testid="sup-add-go"]'));
    };
    if (node.showModal) node.showModal();
    else node.setAttribute('open', '');
    node.querySelector('#sp_q').focus();
  }
  function add(btn, asLocal) {
    var node = S.dlg,
      q = (node.querySelector('#sp_q').value || '').trim(),
      out = node.querySelector('#sp_out');
    var k = (node.querySelector('input[name="sp_kind"]:checked') || {}).value === 'own_use' ? 'own_use' : 'resale';
    out.textContent = '';
    if (!q) {
      out.textContent = t('Type their name, User ID or email.');
      return;
    }
    var link = !asLocal && isUserId(q);
    var body = link ? { supplier_bridge_id: q, supply_kind: k } : { name: q, supply_kind: k };
    CBAction.run(
      btn,
      function () {
        return api('supAdd', { body: body });
      },
      {
        key: 'sup-add',
        busy: t('Adding…'),
        failed: t('Could not add the supplier — try again'),
        onFail: function (words, e) {
          /* ⭐ not found is a question, not a dead end: a one-word shop name of eight letters looks exactly like a handle */
          if (link && e && e.status === 404) {
            out.innerHTML =
              esc(t('No business with that User ID or email.')) +
              ' <button data-cbsid="BUS002-B04" type="button" class="act quiet" data-testid="sup-add-local">' +
              esc(t('Add as a local supplier')) +
              '</button>';
            out.querySelector('button').onclick = function () {
              add(this, true);
            };
            return;
          }
          out.textContent = words;
        }
      }
    ).then(function (reply) {
      if (!reply.ok) return;
      var made = (reply.value && reply.value.supplier) || {};
      toast((reply.value && reply.value.message) || t('Supplier added'));
      node.close();
      S.kind = k;
      if (made.one_sided && made.one_sided.why) log('added one-sided: ' + made.one_sided.why);
      load();
    });
  }

  function mount(host) {
    /* supList · supAdd · supPatch · supDel: CB_PARTY_EP (accounts-shell.js) — the page assigns it into EP, as app.html does */
    host.innerHTML = '<div id="ops_sup" class="op-list" data-testid="ops-suppliers"></div>';
    if (S.list && S.list.destroy) S.list.destroy();
    S.list = CBList.mount(host.querySelector('#ops_sup'), opts());
    if (S.rows === null || S.err) load();
    return { refresh: load };
  }
  return { mount: mount, load: load, ready: ready };
})();
