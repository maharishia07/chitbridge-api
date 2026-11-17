/* app/cap-settings.js — CB SETTINGS › Counters & keys · Connectors · Policy · Plan & usage (T3-SETTINGS, 2026-10-14; SET2 of INDEX-NOT-APP.md).
 * OWNS      CB Settings sections Counters and keys, Connectors, Policy, Plan and usage (CBSettings.mount) and the moved policy, key and kit helpers; it decides nothing about who may do what
 * CALLED BY public/settings.html (script tag settings.html:154; CBSettings.mount per section at settings.html:230) and public/app/cap-admin.js (CBSettings.policyRun and the moved helpers, loaded first through CAP_WITH.admin)
 * FLOW      mount(host, section) ──▶ the section's reads (counters, integrations, policy, plan) ──▶ CBList rows ──▶ a write goes through CBAction ──▶ repaint the row
 * CARD      28-platform-and-operations/settings
 *
 * Owner, 14 Oct: "follow the same design standards or better … better UI … much simpler". The workshop holds these as eight Integrations tabs
 * and two Profile/Settings cards (cap-admin.js), each drawing its own rows and repainting through loadSettings(). Here every list is CBList
 * (list-ctl.js), a row opens to its next level the way CBList opens every row, every write goes through CBAction (M64), and every action is
 * SHOWN, greyed with the SERVER's sentence when it may not run (GET /api/counters may.manage · GET /entities/policy may[flag] ·
 * GET /integrations/catalogue connector.may). This file decides nothing about who may do what.
 *
 * ── WHAT IS MOVED HERE (CLAUDE.md rule 1 — moved, never copied; cap-admin.js calls these same names, loaded first through CAP_WITH.admin) ──
 *   polDefsOf                      — the flags' rows from the server's schema[key].ui + bound_schema (T2-POLICY: no flag list on the web; was cap-admin.js polDefs)
 *   policyRun · policySave · policyControl · policyShown · policyEditButtons · policyRowEdit — the draft-and-Save path of a policy row; the workshop's Business rules card draws and writes through it too (R121b, was cap-admin.js setPolFlag: a write on change)
 *   polShown · polStored           — a flag's value in the unit a person reads (0.50 %) and the unit it is stored in (50 bp) (was inline in setPolFlag/_polControl)
 *   _keySeenAt · _keyAgo · _agentName — when a key last spoke, in words, and which machine (was cap-admin.js)
 *   KEY_SCOPES · keyScopesOf       — what a minted key may do, and the connector rule (was inline in integrationsSettingsHTML/intKeyMint)
 *   ctrOpenTill                    — open the till on this PC with a counter's key (was inline in ctrOpenHere)
 *   kitDownload                    — the connector kit, fetched with the session so the key rides inside (was intDownloadKit's body)
 * ── WHAT IS NEW, AND WHY ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   CBSettings.mount(host, section) — paints one of the four sections in CB Settings' pane; nothing existing painted them outside the workshop's
 *                                     #setbody (which needs renderApp · setSec · loadSettings).
 * Host globals (as every cap-*.js): api · EP (CB_SETTINGS_EP) · SESSION · CFG · esc · fmtMoney (helpers.js, the money unit) · tx · toast · CBAction · CBConfirm · CBList · CBLocale (optional).
 * Flow step: Onboarding · counters & keys / connectors / policy / plan (docs/process/flows.json, the SET rows).
 */
'use strict';

/* ---- POLICY FLAGS — per-entity governance toggles, SERVER-PERSISTED (b130).
 *
 * Athi, 2026-08-09: *"make the policy flags real, move it to settings."*
 *
 * The VALUES come from and go to /api/entities/policy, which validates against its own whitelist. The server never trusts this file.
 * ⭐ T2-POLICY (2026-10-14): AND SO DO THE ROWS. A second table of these flags lived on the web (label · help · level · gov · labels ·
 * scale) beside lib/policy.js FLAGS, and the two drifted — self_copy_pref's default was stated three times, two of them wrong. The server
 * now sends each flag's row as `schema[key].ui` (and `bound_schema` for the locked ones); polDefsOf() reads them. Nothing about a flag is
 * defined on the web. INT6c: the workshop's Business rules card (cap-admin.js polDefs) and CB Settings › Policy read through this one reader.
 */
/** the flags' rows from the server's answer: schema[key].ui (+ bound_schema for the locked ones), in the server's order */
function polDefsOf(schema, bound) {
  var out = [];
  function add(key, f) {
    if (!f || !f.ui) return;
    var u = f.ui;
    out.push({
      key: key,
      label: u.label,
      type: f.type,
      options: u.options || f.options,
      labels: u.labels,
      def: f.def,
      level: u.level,
      gov: u.gov,
      help: u.help,
      scale: u.scale,
      suffix: u.suffix,
      step: u.step,
      order: u.order
    });
  }
  var s = schema || {},
    b = bound || {};
  Object.keys(s).forEach(function (item) {
    add(item, s[item]);
  });
  Object.keys(b).forEach(function (item) {
    add(item, b[item]);
  });
  return out.sort(function (x, y) {
    return (x.order || 0) - (y.order || 0);
  });
}
/** a flag's value as a person reads it: a scaled number in its human unit (50 bp → 0.5), an enum's label */
function polShown(def, v) {
  if (def && def.type === 'number' && def.scale) return Number(v) / def.scale;
  return v;
}
/**
 * ⚠️ A SCALED FIELD IS STORED IN ITS OWN UNIT, NOT THE ONE ON SCREEN. 0.50% is shown, 50 is stored — and the
 * rounding is deliberate: the flag type truncates, so 0.505% would land as 50 either way, and doing it here
 * means the number that comes back matches the number that was typed.
 */
function polStored(def, v) {
  if (def && def.type === 'number' && def.scale) return v === '' ? 0 : Math.round(Number(v) * def.scale);
  if (def && def.type === 'number') return v === '' ? 0 : Number(v);
  return v;
}

function _keySeenAt(k) {
  return k && k.seen && k.seen.at ? new Date(k.seen.at).getTime() : 0;
}
function _keyAgo(iso) {
  if (!iso) return '';
  var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return tx('just now');
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 172800) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
/** ⭐ a user-agent is unreadable; the shop only needs to recognise WHICH MACHINE this was */
function _agentName(ua) {
  var u = String(ua || '');
  var os = /Windows/.test(u)
    ? 'Windows'
    : /Android/.test(u)
      ? 'Android'
      : /iPhone|iPad/.test(u)
        ? 'iPhone/iPad'
        : /Mac OS X/.test(u)
          ? 'Mac'
          : /Linux/.test(u)
            ? 'Linux'
            : '';
  var br = /Edg\//.test(u) ? 'Edge' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ') || tx('unknown');
}
/* what a minted key may do — [value, words]; a connector key also evaluates offers (routes/keys.js · middleware/auth.js KEY_ROUTES) */
var KEY_SCOPES = [
  ['services', 'services — offers, pricing, tax, invoice'],
  ['offers', 'offers only'],
  ['pricing', 'pricing only'],
  ['tax', 'tax only'],
  ['invoice', 'invoice only'],
  ['till', 'till — the counter: bill on this device, offline too'],
  ['connector', 'connector — products, orders, the bell, and the services'],
  ['testing', 'testing — a build posts test results to the board']
];
function keyScopesOf(sc) {
  return sc === 'connector' ? ['connector', 'services'] : [sc || 'offers'];
}

/**
 * ⭐ OPEN ON THIS PC — the key is minted FOR this counter and handed to the counter page, which takes the counter's
 * number and carries on its series. The same address shape counterGo() uses, so the counter checks it is the shop
 * it was opened for.
 */
function ctrOpenTill(key) {
  try {
    localStorage.setItem('cb_till_key', key);
    localStorage.setItem('cb_till_entity', SESSION.entityId || '');
  } catch (e) {
    if (typeof cblog === 'function') cblog('error', 'counter key not kept on this PC: ' + ((e && e.message) || e));
  } /* the till still opens: the key rides its address */
  var addr =
    '/till.html#key=' + encodeURIComponent(key) + '&shop=' + encodeURIComponent(SESSION.entityId || '') + '&as=' + encodeURIComponent(SESSION.entity || '');
  window.open(addr, '_blank', 'noopener');
}

/** the kit, fetched with the session so the key rides inside; saved through a blob like the tax export (misTaxDownload). Throws on a refusal. */
async function kitDownload(id, adapter) {
  var base = (typeof CFG !== 'undefined' && CFG.API_BASE) || '';
  var reply = await fetch(base + '/api/integrations/download/' + encodeURIComponent(id) + '?adapter=' + encodeURIComponent(adapter), {
    headers: { Authorization: 'Bearer ' + SESSION.token }
  });
  if (!reply.ok) {
    var j = await reply.json().catch(function () {
      return {};
    });
    var e = new Error(j.message || 'download failed (' + reply.status + ')');
    e.status = reply.status;
    throw e;
  }
  var blob = await reply.blob();
  var node = document.createElement('a');
  node.href = URL.createObjectURL(blob);
  node.download = 'chitbridge-connector-' + id + '.zip';
  document.body.appendChild(node);
  node.click();
  node.remove();
}

/* ── CB SETTINGS › the four sections — the page's host mounts one at a time ─────────────────────────────────────────────────────────── */
var CBSettings = (function () {
  var H = { host: null, sec: null, lists: [], data: {} };
  /* W15: the kinds offered = the server's `scopes` (the kinds THIS login may mint — 'testing' is the platform's); KEY_SCOPES only words them. Before the answer: the shop's usual kinds. */
  function keyKinds() {
    var keysData = H.data.keys,
      served = keysData && keysData.r && Array.isArray(keysData.r.scopes) ? keysData.r.scopes : null;
    return KEY_SCOPES.filter(function (scope) {
      return served ? served.indexOf(scope[0]) >= 0 : scope[0] !== 'testing';
    });
  }
  /* W18: a sign-in older than the list (legacy) is not in the server's rows — this device is still painted, from the page's own session, so the list never hides where you are */
  function hereRow() {
    var sess = (typeof SESSION !== 'undefined' && SESSION) || {};
    return {
      jti: sess.jti || 'this-device',
      device_id: sess.device_id || '',
      surface: sess.surface || 'settings',
      iat: sess.iat || null,
      exp: sess.exp || null,
      current: true,
      legacy: true,
      device: { kind: 'web', label: '' }
    };
  }
  /** the server's sign-in rows; on a legacy sign-in with no current row, this device's own row first */
  function sessionRows() {
    var answer = H.data.ses,
      rows = (answer && answer.r && answer.r.sessions) || [];
    return answer &&
      answer.r &&
      answer.r.legacy &&
      !rows.some(function (row) {
        return row.current;
      })
      ? [hereRow()].concat(rows)
      : rows;
  }
  function T(s) {
    return typeof tx === 'function' ? tx(s) : s;
  }
  function $(id) {
    return document.getElementById(id);
  }
  function btnOf(act, id) {
    return document.querySelector('[data-act="' + act + '"][data-actrow="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  }
  function grey(may) {
    return may && may.ok === false ? may.why || T('Not allowed for this sign-in.') : '';
  }
  function when(iso) {
    if (!iso) return '';
    try {
      return CBLocale.datetime(iso, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }
  function day(iso) {
    if (!iso) return '';
    try {
      return CBLocale.date(iso, { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return String(iso).slice(0, 10);
    }
  }
  /** a read that failed is said in words, never painted as an empty list */
  function failWords(e) {
    return e && e.status === 403
      ? { title: T('This sign-in cannot open this'), sub: CBAction.words(e, '') }
      : { title: T('Could not read this'), sub: T('Nothing was lost. Try again in a moment.') };
  }
  function list(el, o) {
    /* WALK-REG R39/R41 (Athi, 16 Oct): every settings list OPENS in the grid — aligned, resizable columns; ☰ lines stays one click away */
    var l = CBList.mount(el, Object.assign({ t: T, view: 'grid' }, o));
    H.lists.push(l);
    return l;
  }
  function frame(parts) {
    H.host.innerHTML = parts.join('');
  }
  function lineOut(id) {
    return '<div class="sx-out" id="' + id + '" role="status" data-testid="' + id.replace(/_/g, '-') + '"></div>';
  }
  function bar(inner) {
    return '<div class="sx-bar">' + inner + '</div>';
  }
  function btn(id, label, may, cls, stampCode) {
    var why = grey(may);
    return (
      '<span class="sx-act"><button data-cbsid="' + stampCode + '" type="button" class="act' +
      (cls ? ' ' + cls : '') +
      '" id="' +
      id +
      '" data-testid="' +
      id.replace(/_/g, '-') +
      '"' +
      (why ? ' disabled aria-disabled="true" title="' + esc(why) + '"' : '') +
      '>' +
      esc(label) +
      '</button>' +
      (why ? '<span class="sx-why" data-testid="' + id.replace(/_/g, '-') + '-why">' + esc(why) + '</span>' : '') +
      '</span>'
    );
  }
  /** one read per list: loading under the kept header, the answer, or could-not-read with Try again. `name` is the EP name, or a function that makes the
   *  call itself (so a route read nowhere else keeps a literal api('…') the api's endpoint-usage scanner counts — T3-P4-ACCOUNT) */
  function load(key, name, opts, paint) {
    H.data[key] = { state: 'loading', rows: [] };
    paint();
    return (typeof name === 'function' ? name() : api(name, opts || {})).then(
      function (reply) {
        H.data[key] = { state: 'ok', r: reply || {} };
        paint();
        return reply;
      },
      function (e) {
        if (typeof cblog === 'function') cblog('error', 'settings ' + key + ': ' + ((e && e.message) || e));
        H.data[key] = { state: 'error', err: e };
        paint();
      }
    );
  }
  function listState(key) {
    var d = H.data[key] || {};
    return d.state === 'loading' ? 'loading' : d.state === 'error' ? 'error' : null;
  }
  function listErr(key) {
    return failWords((H.data[key] || {}).err);
  }

  /* ═════ COUNTERS & KEYS ═════ */
  function counters() {
    frame([
      '<h1 class="sx-h" data-testid="sx-title">' + esc(T('Counters')) + '</h1>',
      '',
      '<div id="sx_ctr_bar"></div>',
      lineOut('sx_ctr_out'),
      '<div class="sx-list" id="sx_ctr_list" data-testid="sx-ctr-list"></div>',
      '<details data-testid="sx-ctr-adv" style="margin-top:18px"><summary style="cursor:pointer;opacity:.75">' +
        esc(T('Advanced')) +
        '</summary>' +
        '<div style="margin:10px 0;display:flex;gap:10px;align-items:center"><button data-cbsid="ACC002-B14" class="btn" type="button" id="sx_ctr_app" data-testid="sx-ctr-app">' +
        esc(T('Install the counter')) +
        '</button>' +
        '<span class="sx-why" title="' +
        esc(T('Opens the counter; use its Install button. It bills without the internet. Sign in once on that PC to pair it.')) +
        '" style="cursor:help;opacity:.7">ⓘ</span></div></details>'
    ]);
    /* WALK-REG R53 (Athi: "no one will install if it has too many files"): the counter is an installable web app (till.webmanifest + till-sw.js) —
     * open it; its own Install button (beforeinstallprompt) asks the browser, which asks the person. No zip. */
    $('sx_ctr_app').onclick = function () {
      window.open('/till.html', '_blank', 'noopener');
    };
    /* WALK-REG R29/R31: the keys for other systems are no longer on this page — they sit with the connectors (keysSection, below) */
    var cl = null;
    var manage = function () {
      var d = H.data.ctr;
      return (d && d.r && d.r.may && d.r.may.manage) || null;
    };
    var ctrRows = function () {
      var d = H.data.ctr;
      return (d && d.r && d.r.counters) || [];
    };
    function paintCtrBar() {
      var rows = ctrRows(),
        open = rows.filter(function (item) {
          return item.state === 'open' || item.state === 'break';
        }).length;
      $('sx_ctr_bar').innerHTML = bar(
        '<span class="sx-count" data-testid="sx-ctr-count"><b>' +
          rows.length +
          '</b> ' +
          esc(T(rows.length === 1 ? 'counter' : 'counters')) +
          ' · <b>' +
          open +
          '</b> ' +
          esc(T('open')) +
          '</span>' +
          '<span class="sx-add"><label class="sx-lbl" for="sx_ctr_name">' +
          esc(T('New counter')) +
          ' <span class="tag" data-testid="sx-ctr-optional">' +
          esc(T('Optional')) +
          '</span></label><input data-cbsid="ACC002-I08" class="inp" id="sx_ctr_name" data-testid="sx-ctr-name" placeholder="' +
          esc(T('Front desk')) +
          '" maxlength="40"' +
          (grey(manage()) ? ' disabled' : '') +
          '>' +
          btn('sx_ctr_add', T('Add a counter'), manage(), '', 'ACC002-B15') +
          '</span>'
      );
      var node = $('sx_ctr_add');
      if (node && !grey(manage()))
        node.onclick = function () {
          CBAction.run(
            node,
            function () {
              return api('counterAdd', { body: { name: ($('sx_ctr_name').value || '').trim() } });
            },
            {
              key: 'sx-ctr-add',
              failed: T('Could not add the counter'),
              out: 'sx_ctr_out',
              outcome: function (r) {
                $('sx_ctr_out').textContent = T('Counter added') + (r && r.counter ? ': ' + r.counter.id : '') + '.';
                readCtr();
              }
            }
          );
        };
    }
    function where(c) {
      var h = c.held_by || {};
      if (c.state === 'break') return '☕ ' + T('On break') + (h.name ? ' · ' + h.name : '');
      if (c.state === 'open') return T('Open on') + ' ' + (h.name || T('a PC'));
      if (c.state === 'opening') return T('Opening…');
      return c.closed_at ? T('Closed') + ' ' + _keyAgo(c.closed_at) : T('Not opened yet');
    }
    function stateTag(c) {
      var on = c.state === 'open',
        br = c.state === 'break';
      return (
        '<span class="tag' +
        (on ? ' green' : br ? ' amber' : '') +
        '" data-testid="sx-ctr-state-' +
        esc(c.id) +
        '"><span aria-hidden="true">' +
        (on || br ? '●' : '○') +
        '</span> ' +
        esc(where(c)) +
        '</span>'
      );
    }
    function readCtr() {
      return load('ctr', 'counters', null, function () {
        paintCtrBar();
        if (cl) cl.refresh();
      });
    }
    cl = list($('sx_ctr_list'), {
      key: 'set-counters',
      rows: ctrRows,
      id: function (c) {
        return c.id;
      },
      rowTid: function (c) {
        return 'sx-ctr-' + c.id;
      },
      state: function () {
        return listState('ctr');
      },
      error: function () {
        return listErr('ctr');
      },
      onRetry: function () {
        readCtr();
      },
      empty: { title: T('No counters yet'), sub: T('Add one above.') },
      columns: [
        {
          key: 'id',
          label: T('Counter'),
          prio: 1,
          w: 210,
          sort: 'id',
          html: true,
          value: function (c) {
            return c.id + ' ' + c.name;
          },
          cell: function (c) {
            return '<b class="mono">' + esc(c.id) + '</b> ' + esc(c.name);
          }
        },
        {
          key: 'state',
          label: T('Now'),
          prio: 2,
          w: 230,
          html: true,
          cell: stateTag,
          value: function (c) {
            return where(c);
          }
        },
        {
          key: 'last',
          label: T('Last bill'),
          prio: 3,
          w: 150,
          mono: true,
          cell: function (c) {
            return c.last_no || '—';
          }
        }
      ],
      search: function (c) {
        return [c.id, c.name, where(c)].join(' ');
      },
      filters: [
        {
          key: 'st',
          label: T('Open or closed'),
          all: T('All'),
          options: [
            { v: 'open', label: T('Open') },
            { v: 'closed', label: T('Closed') }
          ],
          match: function (c, v) {
            var o = c.state === 'open' || c.state === 'break' || c.state === 'opening';
            return v === 'open' ? o : !o;
          }
        }
      ],
      next: function (c) {
        var h = c.held_by || {};
        return (
          '<div class="sx-next" data-testid="sx-ctr-next-' +
          esc(c.id) +
          '">' +
          (c.next ? '<div>' + esc(T('Next bill number')) + ': <b class="mono">' + esc(String(c.next).padStart(4, '0')) + '</b></div>' : '') +
          (h.seen && (h.seen.ip || h.seen.at)
            ? '<div class="sub">' + esc([h.seen.ip, h.seen.at ? _keyAgo(h.seen.at) : ''].filter(Boolean).join(' · ')) + '</div>'
            : '') +
          (h.diag && h.diag.verdict ? '<div class="sub">🩺 ' + esc(h.diag.verdict) + '</div>' : '') +
          '<label class="sx-lbl" for="sx_ren_' +
          esc(c.id) +
          '">' +
          esc(T('Name')) +
          '</label><input data-cbsid="ACC002-I09" class="inp" id="sx_ren_' +
          esc(c.id) +
          '" data-testid="sx-ctr-rename-' +
          esc(c.id) +
          '" maxlength="40" value="' +
          esc(c.name) +
          '"' +
          (grey(manage()) ? ' disabled' : '') +
          '></div>'
        );
      },
      actions: [
        {
          id: 'open',
          label: T('Open on this PC'),
          tid: 'sx-ctr-open',
          when: function (c) {
            return c.state === 'closed';
          },
          why: function () {
            return grey(manage());
          },
          run: function (c) {
            CBAction.run(
              btnOf('open', c.id),
              function () {
                return api('counterOpen', { params: { id: c.id } });
              },
              {
                key: 'sx-ctr-open-' + c.id,
                failed: T('Could not open the counter'),
                out: 'sx_ctr_out',
                outcome: function (r) {
                  if (!r || !r.key) {
                    $('sx_ctr_out').textContent = T('No key came back — try again.');
                    return;
                  }
                  ctrOpenTill(r.key);
                  $('sx_ctr_out').textContent = T('Opened in a new tab.');
                  readCtr();
                }
              }
            );
          }
        },
        {
          id: 'release',
          label: T('Release'),
          tid: 'sx-ctr-release',
          when: function (c) {
            return c.state !== 'closed';
          },
          why: function () {
            return grey(manage());
          },
          run: function (c) {
            CBAction.run(
              btnOf('release', c.id),
              function () {
                return api('counterRelease', { params: { id: c.id } });
              },
              {
                key: 'sx-ctr-release-' + c.id,
                confirm: {
                  title: T('Release counter') + ' ' + c.id + '?',
                  body: esc(T('Only for a PC that cannot close it. Bills that PC has not sent stay on it.')),
                  yes: T('Release'),
                  danger: true
                },
                failed: T('Could not release it'),
                out: 'sx_ctr_out',
                outcome: function () {
                  $('sx_ctr_out').textContent = T('Counter released.');
                  readCtr();
                }
              }
            );
          }
        },
        {
          id: 'rename',
          label: T('Save the name'),
          tid: 'sx-ctr-save',
          why: function () {
            return grey(manage());
          },
          run: function (c) {
            var v = (($('sx_ren_' + c.id) || {}).value || '').trim();
            CBAction.run(
              btnOf('rename', c.id),
              function () {
                return api('counterRename', { params: { id: c.id }, body: { name: v } });
              },
              {
                key: 'sx-ctr-ren-' + c.id,
                failed: T('Could not rename it'),
                out: 'sx_ctr_out',
                outcome: function () {
                  $('sx_ctr_out').textContent = T('Saved.');
                  readCtr();
                }
              }
            );
          }
        }
      ]
    });
    paintCtrBar();
    readCtr();
  }

  /* ═════ KEYS FOR OTHER SYSTEMS — what other systems (and each counter PC) sign in with. MOVED from Counters & keys to Connectors
   *  (WALK-REG R29/R31, 16 Oct: keys belong with the connectors that use them); the ONE list, painted into the page's
   *  #sx_key_bar · #sx_key_out · #sx_key_list. `after` runs after a revoke (a counter's key: the page re-reads what it shows). ═════ */
  /** the Keys heading, with what a key is behind ⓘ (one place for the sentence; Connectors and Account both paint it) */
  function keysHead() {
    return (
      '<h2 class="sx-h2">' +
      esc(T('Keys for other systems')) +
      ' <span class="sx-why" title="' +
      esc(T('A key lets another system or a counter PC sign in as your shop.')) +
      '" style="cursor:help;opacity:.7">ⓘ</span></h2>'
    );
  }
  function keysHTML() {
    /* WALK-REG (Athi, 16 Oct: 'we will hide key complexity ourselves and work through login credentials'): signing in + Download / pairing mint the key behind the scenes;
     * the raw key list is folded away as Advanced, never in the way */
    return []; /* Athi, 16 Oct: "if we are hiding the complexity, we don't need to specify it here" — sign-in, Download and pairing make the keys */
  }
  /** put a text on the clipboard and say so on the button; a browser that refuses leaves the text on screen to select (SET-34) */
  function copyText(text, node) {
    var said = function (words) {
      if (node) node.textContent = T(words);
    };
    if (!(navigator.clipboard && navigator.clipboard.writeText)) return said('Select it and copy');
    navigator.clipboard.writeText(String(text || '')).then(
      function () {
        said('Copied');
      },
      function () {
        said('Select it and copy');
      }
    );
  }
  /** the new key, shown once, with a Copy button (SET-34) */
  function paintKeyOnce(key) {
    $('sx_key_out').innerHTML =
      '<b>' +
      esc(T('Copy it now — it is shown once.')) +
      '</b><div class="mono sx-secret" data-testid="sx-key-value">' +
      esc(key || '') +
      '</div><button data-cbsid="ACC002-B26" type="button" class="act quiet" id="sx_key_copy" data-testid="sx-key-copy">' +
      esc(T('Copy')) +
      '</button>';
    $('sx_key_copy').onclick = function () {
      copyText(key, this);
    };
  }
  function keysSection(after) {
    var kl = null;
    var keyRows = function () {
      var d = H.data.keys;
      return (d && d.r && d.r.keys) || [];
    };
    function heard(k) {
      return k.seen && k.seen.at ? _keyAgo(k.seen.at) + (k.seen.ip ? ' · ' + k.seen.ip : '') : T('Never reached us');
    }
    function paintKeyBar() {
      $('sx_key_bar').innerHTML = bar(
        '<span class="sx-add"><label class="sx-lbl" for="sx_key_name">' +
          esc(T('New key')) +
          '</label><input data-cbsid="ACC002-I10" class="inp" id="sx_key_name" data-testid="sx-key-name" placeholder="' +
          esc(T('Which system')) +
          '" maxlength="80">' +
          '<label class="sx-lbl" for="sx_key_scope">' +
          esc(T('This key can')) +
          '</label><select data-cbsid="ACC002-S05" class="inp" id="sx_key_scope" data-testid="sx-key-scope">' +
          keyKinds()
            .map(function (kind) {
              return '<option value="' + esc(kind[0]) + '">' + esc(T(kind[1])) + '</option>';
            })
            .join('') +
          '</select>' +
          btn('sx_key_mint', T('Make a key'), null, '', 'ACC002-B16') +
          '</span>'
      );
      $('sx_key_mint').onclick = function () {
        var node = $('sx_key_mint');
        CBAction.run(
          node,
          function () {
            return api('keysMint', { body: { name: ($('sx_key_name').value || '').trim() || 'key', scopes: keyScopesOf($('sx_key_scope').value) } });
          },
          {
            key: 'sx-key-mint',
            failed: T('Could not make the key'),
            out: 'sx_key_out',
            outcome: function (r) {
              paintKeyOnce(r && r.key);
              readKeys();
            }
          }
        );
      };
    }
    function readKeys() {
      return load('keys', 'keysList', null, function () {
        paintKeyBar();
        if (kl) kl.refresh();
      });
    }
    kl = list($('sx_key_list'), {
      key: 'set-keys',
      rows: keyRows,
      id: function (k) {
        return k.jti;
      },
      rowTid: function (k) {
        return 'sx-key-' + k.jti;
      },
      state: function () {
        return listState('keys');
      },
      error: function () {
        return listErr('keys');
      },
      onRetry: function () {
        readKeys();
      },
      empty: { title: T('No keys yet') },
      columns: [
        {
          key: 'name',
          label: T('Name'),
          prio: 1,
          w: 230,
          sort: 'name',
          cell: function (k) {
            return k.name || 'key';
          }
        },
        {
          key: 'scopes',
          label: T('This key can'),
          prio: 3,
          w: 150,
          cell: function (k) {
            return (k.scopes || []).join(', ');
          }
        },
        {
          key: 'seen',
          label: T('Last heard'),
          prio: 2,
          w: 190,
          sort: 'seen',
          html: true,
          value: function (k) {
            return heard(k);
          },
          cell: function (k) {
            var quiet = !k.seen || !k.seen.at || Date.now() - _keySeenAt(k) > 86400000;
            return '<span class="tag' + (quiet ? ' amber' : ' green') + '" data-testid="sx-key-seen-' + esc(k.jti) + '">' + esc(heard(k)) + '</span>';
          }
        },
        {
          key: 'made',
          label: T('Made'),
          prio: 4,
          w: 130,
          cell: function (k) {
            return day(k.created_at);
          }
        }
      ],
      sorts: [
        {
          key: 'name',
          label: T('Name'),
          cmp: function (a, b) {
            return String(a.name).localeCompare(String(b.name));
          }
        },
        {
          key: 'seen',
          label: T('Last heard'),
          cmp: function (a, b) {
            return _keySeenAt(b) - _keySeenAt(a);
          }
        }
      ],
      search: function (k) {
        return [k.name, (k.scopes || []).join(' '), k.last4].join(' ');
      },
      next: function (k) {
        return (
          '<div class="sx-next" data-testid="sx-key-next-' +
          esc(k.jti) +
          '"><div class="mono">…' +
          esc(k.last4 || '') +
          '</div>' +
          (k.seen && k.seen.agent ? '<div class="sub">' + esc(_agentName(k.seen.agent)) + '</div>' : '') +
          (k.diag && k.diag.verdict ? '<div class="sub">🩺 ' + esc(k.diag.verdict) + '</div>' : '') +
          (!k.seen || !k.seen.at ? '<div class="sub">' + esc(T('Check the network on that PC.')) + '</div>' : '') +
          '</div>'
        );
      },
      actions: [
        {
          id: 'revoke',
          label: T('Revoke'),
          tid: 'sx-key-revoke',
          run: function (k) {
            var till = (k.scopes || []).indexOf('till') >= 0;
            CBAction.run(
              btnOf('revoke', k.jti),
              function () {
                return api('keysRevoke', { params: { jti: k.jti } });
              },
              {
                key: 'sx-key-revoke-' + k.jti,
                confirm: {
                  title: T('Revoke') + ' ' + (k.name || 'key') + '?',
                  body: esc(T(till ? 'That PC stops billing. Bills it has not sent stay on it.' : 'That system can no longer sign in.')),
                  yes: T('Revoke'),
                  danger: true
                },
                failed: T('Could not revoke'),
                out: 'sx_key_out',
                outcome: function () {
                  $('sx_key_out').textContent = T('Key revoked.');
                  readKeys();
                  if (after) after();
                }
              }
            );
          }
        }
      ]
    });
    paintKeyBar();
    readKeys();
  }

  /* W16: the catalogue's may.code → the row's words (a sentence the client branches on ships with a code): NOT_FOR_COUNTRY · NOT_YET_FOR_COUNTRY (sold there, our kit is not built for that pack yet) · NOT_YET (no kit at all) */
  var MAY_WORDS = { NOT_FOR_COUNTRY: 'Not for your country', NOT_YET_FOR_COUNTRY: 'Not yet for your country', NOT_YET: 'Not built yet' };
  /* WALK-REG R32: the printable guide a connector has (public/guides/<id>.pdf, copied from docs/23-connectors-and-integrations/guides); else the server's docs page */
  var GUIDES = { tally: '/guides/tally.pdf' };
  function guideOf(connector) {
    var base = (typeof CFG !== 'undefined' && CFG.API_BASE) || '';
    return GUIDES[connector.id] || (connector.docs ? base + connector.docs : '');
  }
  /** a row action drawn ON the row (CBList runs it by data-act/data-actrow, as it runs the opened row's buttons); greyed with the reason, never hidden */
  function rowBtn(action, connector, label, reason, stampCode) {
    return (
      '<button data-cbsid="' + stampCode + '" type="button" class="cbl-btn" data-act="' +
      action +
      '" data-actrow="' +
      esc(connector.id) +
      '" data-testid="sx-con-' +
      action +
      '-' +
      esc(connector.id) +
      '"' +
      (reason ? ' disabled aria-disabled="true" title="' + esc(reason) + '"' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  /** WALK-REG R32: Download and Guide on the row itself, not only inside it — the same row actions (kit · guide), drawn here (CBList dispatches data-act from any button in the list) */
  function getItColumn() {
    return {
      key: 'get',
      label: T('Get it'),
      prio: 1,
      w: 200,
      html: true,
      value: function () {
        return '';
      },
      cell: function (connector) {
        return (
          rowBtn('kit', connector, T('Download'), grey(connector.may), 'ACC002-B17') +
          ' ' +
          rowBtn('guide', connector, T('Guide'), guideOf(connector) ? '' : T('No guide yet'), 'ACC002-B18')
        );
      }
    };
  }
  /** the Guide action — drawn on the row (the 'get' column); when:false keeps it out of the opened row so it is not shown twice (the Download action the same) */
  function guideAction() {
    return {
      id: 'guide',
      label: T('Guide'),
      tid: 'sx-con-guide',
      when: function () {
        return false;
      },
      why: function (connector) {
        return guideOf(connector) ? '' : T('No guide yet');
      },
      run: function (connector) {
        var guideLink = guideOf(connector);
        if (guideLink) window.open(guideLink, '_blank', 'noopener');
      }
    };
  }
  /** the key list is not drawn for a shop owner (WALK-REG R52) */
  function keysSectionIfShown(after) {
    if ($('sx_key_bar')) keysSection(after);
  }
  function mayWords(verdict) {
    return T(MAY_WORDS[(verdict && verdict.code) || ''] || 'Not for your shop');
  }
  /* ═════ CONNECTORS ═════ */
  function connectors() {
    frame(
      [
        '<h1 class="sx-h" data-testid="sx-title">' +
          esc(T('Connectors')) +
          ' <span class="sx-why" title="' +
          esc(T('A small program beside Tally, Zoho or a folder of files. Your key is inside the download.')) +
          '" style="cursor:help;font-size:.55em;opacity:.7">ⓘ</span></h1>',
        '<h2 class="sx-h2">' + esc(T('Running on your PCs')) + '</h2>',
        lineOut('sx_run_out'),
        '<div class="sx-list" id="sx_run_list" data-testid="sx-run-list"></div>' /* WALK-REG R35: what is RUNNING sits at the top of the page, never under the list */,
        '<h2 class="sx-h2">' + esc(T('All connectors')) + '</h2>',
        lineOut('sx_con_out'),
        '<div class="sx-list" id="sx_con_list" data-testid="sx-con-list"></div>'
      ].concat(keysHTML())
    );
    var pol = null;
    function inUse() {
      var rows = (pol && pol.connectors_in_use) || [];
      return Array.isArray(rows)
        ? rows.filter(function (x) {
            return x !== 'none';
          })
        : [];
    }
    var catRows = function () {
      var catData = H.data.cat;
      return ((catData && catData.r && catData.r.connectors) || []).filter(function (connector) {
        return connector.id !== 'till';
      });
    }; /* WALK-REG R51: our own counter lives on Counters › Advanced */
    var cl = null,
      rl = null;
    function readCat() {
      return Promise.all([
        load('cat', 'intCatalogue', null, function () {
          if (cl) cl.refresh();
        }),
        api('policyGet').then(
          function (reply) {
            pol = (reply && reply.flags) || {};
            H.polMay = (reply && reply.may) || {};
            if (cl) cl.refresh();
          },
          function (e) {
            if (typeof cblog === 'function') cblog('error', 'settings connectors in use: ' + ((e && e.message) || e));
            $('sx_con_out').textContent = T('Could not read which ones you use.');
          }
        )
      ]);
    }
    function useMay() {
      return (H.polMay && H.polMay.connectors_in_use) || null;
    }
    function setUse(c, on) {
      var now = inUse().filter(function (x) {
        return x !== c.id;
      });
      if (on) now.push(c.id);
      CBAction.run(
        btnOf(on ? 'use' : 'unuse', c.id),
        function () {
          return api('policySet', { body: { connectors_in_use: now.length ? now : ['none'] } });
        },
        {
          key: 'sx-con-use-' + c.id,
          failed: T('Could not save'),
          out: 'sx_con_out',
          outcome: function (r) {
            pol = (r && r.flags) || pol;
            if (typeof SESSION !== 'undefined') SESSION.policy_flags = pol;
            $('sx_con_out').textContent = T('Saved.');
            cl.refresh();
          }
        }
      );
    }
    cl = list($('sx_con_list'), {
      key: 'set-connectors',
      rows: catRows,
      id: function (c) {
        return c.id;
      },
      rowTid: function (c) {
        return 'sx-con-' + c.id;
      },
      state: function () {
        return listState('cat');
      },
      error: function () {
        return listErr('cat');
      },
      onRetry: function () {
        readCat();
      },
      empty: { title: T('No connectors published yet') },
      columns: [
        {
          key: 'name',
          label: T('Connector'),
          prio: 1,
          w: 200,
          sort: 'name',
          html: true,
          value: function (c) {
            return c.name;
          },
          cell: function (c) {
            return (
              '<b>' +
              esc(c.name) +
              '</b>' +
              (inUse().indexOf(c.id) >= 0 ? ' <span class="tag green" data-testid="sx-con-inuse-' + esc(c.id) + '">' + esc(T('We use this')) + '</span>' : '')
            );
          }
        },
        {
          key: 'does',
          label: T('What it does'),
          prio: 3,
          w: 300,
          cell: function (c) {
            return c.does || '';
          }
        },
        {
          key: 'here',
          label: T('For your shop'),
          prio: 2,
          w: 170,
          html: true,
          value: function (c) {
            return c.may && c.may.ok === false ? 'no' : 'yes';
          },
          cell: function (connector) {
            var no = connector.may && connector.may.ok === false;
            return (
              '<span class="tag' +
              (no ? '' : ' green') +
              '" data-testid="sx-con-may-' +
              esc(connector.id) +
              '" data-code="' +
              esc((connector.may && connector.may.code) || '') +
              '">' +
              esc(no ? mayWords(connector.may) : T('Available')) +
              '</span>'
            );
          }
        },
        getItColumn()
      ],
      search: function (c) {
        return [c.name, c.does].join(' ');
      },
      filters: [
        {
          key: 'use',
          label: T('In use'),
          all: T('All'),
          options: [
            { v: 'yes', label: T('We use these') },
            { v: 'no', label: T('Not used') }
          ],
          match: function (c, v) {
            var u = inUse().indexOf(c.id) >= 0;
            return v === 'yes' ? u : !u;
          }
        }
      ],
      next: function (c) {
        var grp = function (title, lines) {
          return lines && lines.length
            ? '<div class="sx-grp"><b>' +
                esc(T(title)) +
                '</b><ul>' +
                lines
                  .map(function (item) {
                    return '<li>' + esc(T(item)) + '</li>';
                  })
                  .join('') +
                '</ul></div>'
            : '';
        };
        return (
          '<div class="sx-next" data-testid="sx-con-next-' +
          esc(c.id) +
          '">' +
          (c.may && c.may.ok === false && c.may.why ? '<div class="sub" data-testid="sx-con-why-' + esc(c.id) + '">' + esc(c.may.why) + '</div>' : '') +
          grp('Before you start', c.needs) +
          grp('What to do', c.steps) +
          grp('If it does not work', c.watch_out) +
          (c.runs_on ? '<div class="sub">' + esc(T('Runs on')) + ': ' + esc(c.runs_on) + '</div>' : '') +
          '</div>'
        );
      },
      actions: [
        {
          id: 'kit',
          label: T('Download'),
          tid: 'sx-con-kit',
          when: function () {
            return false;
          },
          why: function (connector) {
            return grey(connector.may);
          },
          run: function (c) {
            var ad = c.default_adapter || (c.adapters || [])[0] || c.id;
            CBAction.run(
              btnOf('kit', c.id),
              function () {
                return kitDownload(c.id, ad);
              },
              {
                key: 'sx-con-kit-' + c.id,
                failed: T('Could not download'),
                out: 'sx_con_out',
                outcome: function () {
                  $('sx_con_out').textContent = T('Downloaded. Unzip it and start it.');
                  readRun();
                }
              }
            );
          }
        },
        guideAction(),
        {
          id: 'use',
          label: T('We use this'),
          tid: 'sx-con-use',
          when: function (c) {
            return inUse().indexOf(c.id) < 0;
          },
          why: function () {
            return grey(useMay());
          },
          run: function (c) {
            setUse(c, true);
          }
        },
        {
          id: 'unuse',
          label: T('We do not use this'),
          tid: 'sx-con-unuse',
          when: function (c) {
            return inUse().indexOf(c.id) >= 0;
          },
          why: function () {
            return grey(useMay());
          },
          run: function (c) {
            setUse(c, false);
          }
        }
      ]
    });
    readCat();

    var runRows = function () {
      var d = H.data.run;
      return (d && d.r && d.r.connectors) || [];
    };
    function waiting(r) {
      return !!(r.enrol && r.enrol.approved === false);
    }
    function lastSeen(r) {
      return r.last_seen ? _keyAgo(r.last_seen) : T('Not yet');
    }
    function readRun() {
      return load('run', 'intStatus', null, function () {
        if (rl) rl.refresh();
      });
    }
    rl = list($('sx_run_list'), {
      key: 'set-running',
      rows: runRows,
      id: function (r) {
        return r.actor_id || r.id;
      },
      rowTid: function (r) {
        return 'sx-run-' + (r.actor_id || r.id);
      },
      state: function () {
        return listState('run');
      },
      error: function () {
        return listErr('run');
      },
      onRetry: function () {
        readRun();
      },
      empty: { title: T('None has checked in yet') },
      columns: [
        {
          key: 'name',
          label: T('Connector'),
          prio: 1,
          w: 200,
          sort: 'name',
          cell: function (r) {
            return r.name || r.id;
          }
        },
        {
          key: 'where',
          label: T('Where'),
          prio: 3,
          w: 200,
          cell: function (r) {
            return [r.adapter, r.host].filter(Boolean).join(' · ');
          }
        },
        { key: 'seen', label: T('Last heard'), prio: 2, w: 150, cell: lastSeen },
        {
          key: 'ok',
          label: T('Approval'),
          prio: 2,
          w: 170,
          html: true,
          value: function (r) {
            return waiting(r) ? 'waiting' : 'approved';
          },
          cell: function (r) {
            var w = waiting(r);
            return (
              '<span class="tag' +
              (w ? ' amber' : ' green') +
              '" data-testid="sx-run-ok-' +
              esc(r.actor_id || r.id) +
              '">' +
              esc(w ? T('Waiting for you') : T('Approved')) +
              '</span>'
            );
          }
        }
      ],
      search: function (r) {
        return [r.name, r.adapter, r.host].join(' ');
      },
      next: function (r) {
        var e = r.enrol || {},
          sc = r.source || {};
        return (
          '<div class="sx-next" data-testid="sx-run-next-' +
          esc(r.actor_id || r.id) +
          '">' +
          ([e.host, e.company, e.gstin].filter(Boolean).length
            ? '<div class="sub">' + esc([e.host, e.company, e.gstin].filter(Boolean).join(' · ')) + '</div>'
            : '') +
          (sc.ok === true ? '<div>✓ ' + esc(T('The other system answered')) + (sc.at ? ' · ' + esc(when(sc.at)) : '') + '</div>' : '') +
          (sc.ok === false ? '<div>⚠ ' + esc(T('The other system did not answer')) + (sc.why ? ' · ' + esc(sc.why) : '') + '</div>' : '') +
          '</div>'
        );
      },
      actions: [
        {
          id: 'approve',
          label: T('Approve this PC'),
          tid: 'sx-run-approve',
          when: waiting,
          run: function (r) {
            CBAction.run(
              btnOf('approve', r.actor_id || r.id),
              function () {
                return api('intApprove', { params: { id: r.actor_id } });
              },
              {
                key: 'sx-run-approve-' + r.actor_id,
                failed: T('Could not approve'),
                out: 'sx_run_out',
                outcome: function () {
                  $('sx_run_out').textContent = T('Approved — it starts within a minute.');
                  readRun();
                }
              }
            );
          }
        },
        {
          id: 'reject',
          label: T('Reject'),
          tid: 'sx-run-reject',
          when: function (r) {
            return waiting(r) && !!r.key_jti;
          },
          run: function (r) {
            CBAction.run(
              btnOf('reject', r.actor_id || r.id),
              function () {
                return api('keysRevoke', { params: { jti: r.key_jti } });
              },
              {
                key: 'sx-run-reject-' + r.actor_id,
                confirm: { title: T('Reject this PC?'), body: esc(T('Its key is revoked. That kit can no longer connect.')), yes: T('Reject'), danger: true },
                failed: T('Could not reject'),
                out: 'sx_run_out',
                outcome: function () {
                  $('sx_run_out').textContent = T('Rejected.');
                  readRun();
                }
              }
            );
          }
        }
      ]
    });
    readRun();
    keysSectionIfShown(readRun);
  }

  /* ═════ POLICY — the flags of lib/policy that have words here, with who may change each (the server's may) ═════ */
  /* R121 (walk 24 Oct, P6 on 22 Oct): a policy row edits a DRAFT. Save and Cancel sit beside the control, hidden until the draft differs from the
   * value painted (data-orig); Save asks first, in the shopkeeper's words, then PATCHes through the one policySet path for every row (number or select);
   * Cancel (or closing the row, which repaints it) puts the old value back. Nothing is written on blur or change. */
  /** a rule's value in the words the row shows: the enum's label, a named number, or the number with its unit */
  function policyShown(x) {
    /* CTR-212: a flag the server says nobody answered reads "Not answered yet", never its default word ("Off") */
    if (x.asked === false) return T('Not answered yet');
    var d = x.def,
      v = polShown(d, x.v);
    if (d.type === 'enum') return T((d.labels && d.labels[x.v]) || String(x.v));
    /* AU-WORDS: a number the server names (ui.labels[value] — "No expiry", "Keep — the law here asks 5 years") reads as its word, never "0" */
    if (d.labels && d.labels[String(x.v)] !== undefined) return T(d.labels[String(x.v)]);
    return String(v) + (d.suffix ? ' ' + T(d.suffix) : '');
  }
  /** the row's editor: a select for a choice, a number box otherwise; data-orig holds the painted value so a draft can be told from it */
  function policyControl(x) {
    var d = x.def,
      id = 'sx_pol_' + d.key,
      dis = grey(x.may) ? ' disabled' : '';
    if (d.type === 'enum')
      return (
        '<select data-cbsid="ACC002-S06" class="inp" id="' +
        id +
        '" data-testid="sx-pol-in-' +
        esc(d.key) +
        '" data-orig="' +
        esc(x.asked === false ? '' : String(x.v)) +
        '"' +
        dis +
        ' aria-label="' +
        esc(T(d.label)) +
        '">' +
        (x.asked === false ? '<option value="" disabled selected>' + esc(T('Not answered yet')) + '</option>' : '') +
        d.options
          .map(function (item) {
            return (
              '<option value="' +
              esc(item) +
              '"' +
              (x.asked !== false && String(x.v) === String(item) ? ' selected' : '') +
              '>' +
              esc(T((d.labels && d.labels[item]) || item)) +
              '</option>'
            );
          })
          .join('') +
        '</select>'
      );
    return (
      '<span class="sx-num"><input data-cbsid="ACC002-I11" class="inp" type="number" min="0" id="' +
      id +
      '" data-testid="sx-pol-in-' +
      esc(d.key) +
      '"' +
      (d.step ? ' step="' + esc(String(d.step)) + '"' : '') +
      dis +
      ' value="' +
      esc(String(polShown(d, x.v))) +
      '" data-orig="' +
      esc(String(polShown(d, x.v))) +
      '" aria-label="' +
      esc(T(d.label)) +
      '">' +
      (d.suffix ? '<span class="sub">' + esc(T(d.suffix)) + '</span>' : '') +
      '</span>'
    );
  }
  /** the Save and Cancel buttons of one row, hidden until its draft differs; none on a row the server says is not yours to change */
  function policyEditButtons(row) {
    if (grey(row.may)) return '';
    var key = esc(row.key);
    return (
      ui.action('save', {
        mount: 'ACC002-U01',
        object: 'policy value',
        hidden: true,
        effect: 'commit',
        confirmedBy: 'page',
        id: 'sx_pol_save_' + key,
        testid: 'sx-pol-save-' + key,
        data: { 'pol-act': 'save' }
      }) +
      ui.action('cancel', {
        mount: 'ACC002-U02',
        object: 'policy edit',
        hidden: true,
        id: 'sx_pol_cancel_' + key,
        testid: 'sx-pol-cancel-' + key,
        data: { 'pol-act': 'cancel' }
      })
    );
  }
  /** the control's value against the one painted. Pure DOM: reads and writes nothing on the server. */
  function policyDraftOf(key) {
    var control = $('sx_pol_' + key);
    return { control: control, changed: !!control && control.value !== control.getAttribute('data-orig') };
  }
  function policyShowButtons(key) {
    var visible = policyDraftOf(key).changed;
    ['save', 'cancel'].forEach(function (which) {
      var button = $('sx_pol_' + which + '_' + key);
      if (button) button.style.display = visible ? '' : 'none';
    });
  }
  /** Cancel: the painted value goes back and the row says nothing was written */
  function policyCancel(key) {
    var draft = policyDraftOf(key);
    if (draft.control) draft.control.value = draft.control.getAttribute('data-orig');
    policyShowButtons(key);
    var mark = $('sx_pol_ok_' + key);
    if (mark) mark.textContent = '';
  }
  /** "Change Order overdue after from 7 days to 10 days?" — both values in the words the row shows */
  function policyAsk(row, shown, newStored) {
    return T('Change {rule} from {from} to {to}?')
      .replace('{rule}', T(row.def.label))
      .replace('{from}', shown(row))
      .replace('{to}', shown({ def: row.def, v: newStored }));
  }
  /** the ONE write of a policy flag, for every screen that changes one: ask first, PATCH, then hand the server's answer to the caller; a refusal goes to onFail in the server's words */
  function policyRun(button, key, stored, title, done) {
    var body = {};
    body[key] = stored;
    CBAction.run(
      button,
      function () {
        return api('policySet', { body: body });
      },
      {
        key: 'sx-pol-save-' + key,
        confirm: { title: title, body: '', yes: T('Save'), danger: false },
        failed: T('Could not save that rule'),
        onFail: done.onFail,
        outcome: done.outcome
      }
    );
  }
  /** a row's Save: the draft in its control, the question in both values' words, then the one write; the outcome is said on the row */
  function policySave(key, ctx) {
    var row = ctx.rowOf(key),
      draft = policyDraftOf(key);
    if (!row || !draft.control || grey(row.may) || !draft.changed) return;
    var stored = polStored(row.def, draft.control.value);
    policyRun($('sx_pol_save_' + key), key, stored, policyAsk(row, ctx.shown, stored), {
      onFail: function (words) {
        var failMark = $('sx_pol_ok_' + key);
        if (failMark) failMark.textContent = words;
      },
      outcome: function (answer) {
        ctx.onSaved(answer);
        var savedMark = $('sx_pol_ok_' + key);
        if (savedMark) savedMark.textContent = '✓ ' + T('Saved');
      }
    });
  }
  /** typing in a policy control shows its Save and Cancel (or hides them when the draft is back to the painted value) */
  function policyTouched(event) {
    var found = event.target && event.target.id && /^sx_pol_(.+)$/.exec(event.target.id);
    if (found && !/^(ok|save|cancel)_/.test(found[1])) policyShowButtons(found[1]);
  }
  /** a press on a row's Save or Cancel button does its one thing */
  function policyPressed(event, ctx) {
    var button = event.target && event.target.closest && event.target.closest('[data-pol-act]');
    var found = button && /^sx_pol_(?:save|cancel)_(.+)$/.exec(button.id);
    if (!found) return;
    if (button.getAttribute('data-pol-act') === 'save') policySave(found[1], ctx);
    else policyCancel(found[1]);
  }
  /** wire a policy list: typing shows Save/Cancel; Save and Cancel do their one thing */
  function policyRowEdit(listEl, ctx) {
    listEl.addEventListener('input', policyTouched);
    listEl.addEventListener('change', policyTouched);
    listEl.addEventListener('click', function (event) {
      policyPressed(event, ctx);
    });
  }
  /** CB Settings › Policy: one CBList of the rules the server words, each row a draft with Save and Cancel (R121) */
  function policy() {
    frame([
      '<h1 class="sx-h" data-testid="sx-title">' +
        esc(T('Policy')) +
        ' <span class="sx-opt" data-testid="sx-pol-optional" title="' +
        esc(T('Defaults are set. Change any of them when you need to.')) +
        '" style="font-size:.55em;font-weight:500;opacity:.7">(' +
        esc(T('optional')) +
        ')</span></h1>',
      '<p class="sub"><a class="sx-link" href="/settings.html#/country" data-testid="sx-pol-country">' + esc(T('Country, money and year')) + ' ›</a></p>',
      lineOut('sx_pol_out'),
      '<div class="sx-list sx-tall" id="sx_pol_list" data-testid="sx-pol-list"></div>'
    ]);
    var pl = null;
    var answer = function () {
      var d = H.data.pol;
      return (d && d.r) || {};
    };
    function rows() {
      var r = answer(),
        flags = r.flags || {},
        may = r.may || {};
      if (!r.flags) return [];
      /* WALK-REG R36/R37 (Athi, 16 Oct): rows not shown here — the keys stay on the server. trade_cover · chit_expiry_days: nothing reads them yet;
       * trade_side: decided, sell is the default */
      var HIDDEN = { trade_cover: 1, chit_expiry_days: 1, trade_side: 1 };
      /* the rows ARE the server's (schema[key].ui + bound_schema, T2-POLICY) — the same reader the workshop's Business rules card uses */
      return polDefsOf(r.schema, r.bound_schema || r.bound)
        .filter(function (policyDef) {
          return !HIDDEN[policyDef.key];
        })
        .map(function (item) {
          var v = flags[item.key] !== undefined ? flags[item.key] : item.def;
          /* the server's answer when it gives one; an older server: the class the list states (bound · protected · inherited are locked) — the PATCH still decides */
          var m =
            may[item.key] ||
            (item.gov === 'bound' || item.gov === 'protected' || item.gov === 'inherited'
              ? { ok: false, why: T('Set by the platform for every shop.') }
              : { ok: true });
          /* W11: the registration is set in ONE place — Country setup (PUT /governance/country-setup writes the flag); here it is read, with the door */
          if (item.key === 'gst_registration') m = { ok: false, code: 'SET_IN_COUNTRY', why: T('Set under Country, with the registration number.') };
          return { key: item.key, def: item, v: v, may: m, asked: (r.asked || {})[item.key] };
        });
    }
    var shown = policyShown,
      control = policyControl;
    function read() {
      return load('pol', 'policyGet', null, function () {
        if (pl) pl.refresh();
      });
    }
    pl = list($('sx_pol_list'), {
      key: 'set-policy',
      rows: rows,
      id: function (x) {
        return x.key;
      },
      rowTid: function (x) {
        return 'sx-pol-' + x.key;
      },
      state: function () {
        return listState('pol');
      },
      error: function () {
        return listErr('pol');
      },
      onRetry: function () {
        read();
      },
      empty: { title: T('No rules to set') },
      columns: [
        {
          key: 'label',
          label: T('Rule'),
          prio: 1,
          w: 260,
          sort: 'label',
          cell: function (x) {
            return T(x.def.label);
          },
          value: function (x) {
            return T(x.def.label);
          }
        },
        { key: 'value', label: T('Now'), prio: 2, w: 170, cell: shown, value: shown },
        {
          key: 'who',
          label: T('Who may change it'),
          prio: 3,
          w: 200,
          html: true,
          value: function (x) {
            return x.may.ok === false ? 'no' : 'yes';
          },
          cell: function (x) {
            var no = x.may.ok === false;
            return (
              '<span class="tag' +
              (no ? '' : ' green') +
              '" data-testid="sx-pol-who-' +
              esc(x.key) +
              '">' +
              esc(
                no ? (x.may.code === 'PLATFORM_BOUND' ? T('The platform') : x.may.code === 'SET_IN_COUNTRY' ? T('Country setup') : T('The owner')) : T('You')
              ) +
              '</span>'
            );
          }
        }
      ],
      search: function (x) {
        return [T(x.def.label), x.def.help, shown(x)].join(' ');
      },
      filters: [
        {
          key: 'who',
          label: T('Who may change it'),
          all: T('Anyone'),
          options: [
            { v: 'you', label: T('You') },
            { v: 'not', label: T('Not you') }
          ],
          match: function (x, v) {
            return v === 'you' ? x.may.ok !== false : x.may.ok === false;
          }
        }
      ],
      /* WALK-REG (Athi, 16 Oct: "the text is too much and save button below the box"): ONE line — the control, an ⓘ holding the help, and (R121) Save / Cancel once the
       * draft differs; Save asks first, then "✓ Saved" beside it. A rule set elsewhere shows only the door to where it is set. */
      next: function (x) {
        var helpTip = x.def.help
          ? ' <span class="sx-why" title="' + esc(T(x.def.help)) + '" data-testid="sx-pol-why-' + esc(x.key) + '" style="cursor:help;opacity:.7">ⓘ</span>'
          : '';
        if (x.may.code === 'SET_IN_COUNTRY')
          return (
            '<div class="sx-next" data-testid="sx-pol-next-' +
            esc(x.key) +
            '"><a class="sx-link" href="/settings.html#/country" data-testid="sx-pol-country-door">' +
            esc(T('Change it under Country')) +
            ' ›</a>' +
            helpTip +
            '</div>'
          );
        return (
          '<div class="sx-next" data-testid="sx-pol-next-' +
          esc(x.key) +
          '" style="display:flex;align-items:center;gap:8px">' +
          control(x) +
          policyEditButtons(x) +
          helpTip +
          '<span class="sub" id="sx_pol_ok_' +
          esc(x.key) +
          '" data-testid="sx-pol-ok-' +
          esc(x.key) +
          '"></span></div>'
        );
      }
    });
    policyRowEdit($('sx_pol_list'), {
      rowOf: function (key) {
        return rows().filter(function (row) {
          return row.key === key;
        })[0];
      },
      shown: shown,
      /** the server's flags after a save become the list's own and the session's, then the list repaints from them */
      onSaved: function (saved) {
        var policyData = H.data.pol;
        if (policyData && policyData.r && saved && saved.flags) policyData.r.flags = saved.flags;
        if (typeof SESSION !== 'undefined' && saved && saved.flags) SESSION.policy_flags = saved.flags;
        if (pl) pl.refresh();
      }
    });
    read();
  }

  /* ═════ PLAN & USAGE — GET /entities/entitlements (the plan, every quota as a STATE) + GET /entities/usage (what was billed) ═════ */
  var QUOTA_WORDS = {
    entities: 'Shops and branches',
    actors: 'People',
    chits_per_month: 'Chits a month',
    network_depth: 'Network levels',
    suppliers: 'Suppliers'
  };
  /** WALK-REG R41: usage is BILLED IN US DOLLARS (usage_ledger.cost_usd · total_cost_usd), whatever the shop's own currency — so it says US$,
   *  never a bare $ an Indian or Australian shop would read as its own money. The reader's format; only a lone $ symbol is named. */
  function usDollars(amount) {
    var text = fmtMoney(amount, 'USD', '—');
    return text.indexOf('US') >= 0
      ? text
      : text.replace(/(^|[^A-Za-z])\$/, function (all, lead) {
          return lead + 'US$';
        });
  }
  function plan() {
    frame([
      '<h1 class="sx-h" data-testid="sx-title">' + esc(T('Plan & usage')) + '</h1>',
      '<div id="sx_plan_head" data-testid="sx-plan-head"></div>',
      '<div class="sx-list" id="sx_quota_list" data-testid="sx-quota-list"></div>',
      '<h2 class="sx-h2">' + esc(T('Usage')) + '</h2>',
      '<div id="sx_use_head" data-testid="sx-use-head"></div>',
      '<div class="sx-list" id="sx_use_list" data-testid="sx-use-list"></div>'
    ]);
    var ql = null,
      ul = null;
    var ent = function () {
      var d = H.data.ent;
      return (d && d.r) || null;
    };
    var use = function () {
      var d = H.data.use;
      return (d && d.r) || null;
    };
    function quotaRows() {
      var e = ent();
      if (!e || !e.quotas) return [];
      return Object.keys(e.quotas).map(function (item) {
        var q = e.quotas[item] || {};
        return { key: item, state: q.state, limit: q.limit };
      });
    }
    function allows(q) {
      return q.state === 'capped' ? T('Up to') + ' ' + q.limit : q.state === 'unlimited' ? T('No limit') : T('Not decided yet');
    }
    function paintHead() {
      var e = ent(),
        d = H.data.ent || {};
      $('sx_plan_head').innerHTML =
        d.state === 'error'
          ? '<div class="err" data-testid="sx-plan-err">' + esc(listErr('ent').title) + '</div>'
          : !e
            ? '<div class="loadwrap"><span class="spin"></span> ' + esc(T('Reading your plan…')) + '</div>'
            : '<div class="sx-card"><div class="sx-big" data-testid="sx-plan-name">' +
              esc(e.name || e.plan) +
              '</div>' +
              '<p class="sub" data-testid="sx-plan-enforced">' +
              esc(e.enforced ? T('Your plan sets limits') : T('Nothing is limited yet')) +
              '</p></div>';
    }
    function paintUse() {
      var u = use(),
        d = H.data.use || {};
      $('sx_use_head').innerHTML =
        d.state === 'error'
          ? '<div class="err" data-testid="sx-use-err">' + esc(listErr('use').title) + '</div>'
          : !u
            ? '<div class="loadwrap"><span class="spin"></span> ' + esc(T('Reading your usage…')) + '</div>'
            : u.not_enabled
              ? '<p class="sub" data-testid="sx-use-off">' + esc(T('Usage not recorded yet')) + '</p>'
              : '<div class="sx-card"><div class="sx-big" data-testid="sx-use-total">' +
                esc(usDollars(u.total_cost_usd)) +
                '</div>' +
                '<p class="sub" data-testid="sx-use-billed">' +
                esc(((u.counts && u.counts.billed) || 0) + ' ' + T('events billed in') + ' ' + (u.window_days || 0) + ' ' + T('days')) +
                '</p></div>';
    }
    function readEnt() {
      return load('ent', 'entitlements', null, function () {
        paintHead();
        if (ql) ql.refresh();
      });
    }
    function readUse() {
      return load('use', 'entityUsage', null, function () {
        paintUse();
        if (ul) ul.refresh();
      });
    }
    ql = list($('sx_quota_list'), {
      key: 'set-quotas',
      rows: quotaRows,
      id: function (q) {
        return q.key;
      },
      rowTid: function (q) {
        return 'sx-quota-' + q.key;
      },
      state: function () {
        return listState('ent');
      },
      error: function () {
        return listErr('ent');
      },
      onRetry: function () {
        readEnt();
      },
      empty: { title: T('Your plan names no limits') },
      columns: [
        {
          key: 'what',
          label: T('What'),
          prio: 1,
          w: 220,
          cell: function (q) {
            return T(QUOTA_WORDS[q.key] || q.key);
          }
        },
        {
          key: 'allows',
          label: T('Your plan allows'),
          prio: 2,
          w: 200,
          html: true,
          value: allows,
          cell: function (q) {
            return (
              '<span class="tag' +
              (q.state === 'unset' ? ' amber' : ' green') +
              '" data-testid="sx-quota-state-' +
              esc(q.key) +
              '">' +
              esc(allows(q)) +
              '</span>'
            );
          }
        }
      ]
    });
    ul = list($('sx_use_list'), {
      key: 'set-usage',
      rows: function () {
        var u = use();
        return (u && u.by_meter) || [];
      },
      id: function (m) {
        return m.meter;
      },
      rowTid: function (m) {
        return 'sx-use-' + m.meter;
      },
      state: function () {
        return listState('use');
      },
      error: function () {
        return listErr('use');
      },
      onRetry: function () {
        readUse();
      },
      empty: { title: T('Nothing billed yet') },
      columns: [
        {
          key: 'meter',
          label: T('Kind'),
          prio: 1,
          w: 220,
          mono: true,
          cell: function (m) {
            return m.meter;
          }
        },
        {
          key: 'events',
          label: T('Events'),
          prio: 2,
          w: 110,
          num: true,
          cell: function (m) {
            return String(m.events || 0);
          },
          value: function (m) {
            return Number(m.events) || 0;
          }
        },
        {
          key: 'cost',
          label: T('Cost'),
          prio: 3,
          w: 130,
          num: true,
          cell: function (usageRow) {
            return usDollars(usageRow.cost);
          },
          value: function (usageRow) {
            return Number(usageRow.cost) || 0;
          }
        }
      ]
    });
    paintHead();
    paintUse();
    readEnt();
    readUse();
  }

  /* ═════ ACCOUNT (T3-P4-ACCOUNT) — Sessions (GET /signin/sessions · the owner's devices) · API keys (a door to the one list) · Vault (cap-shop.js's card, every section) ═════ */
  var SURFACE_WORDS = {
    till: 'Counter',
    index: 'Home',
    app: 'Workshop',
    web: 'Web',
    settings: 'Settings',
    finance: 'Finance',
    accounts: 'Accounts',
    crm: 'CRM',
    tasks: 'Tasks & Orders',
    shop: 'Online shop',
    kyb: 'Know your business',
    employees: 'Employees',
    network: 'Network'
  };
  var CURRENT_WHY = 'The device you are on — use Sign out in the menu.';
  /* SET-34 (Athi, 6 Nov 2026): the vault and the keys are shown on Account (they were hidden since WALK-REG R21/R43 and R52, 16 Oct); the vault rows have Copy buttons */
  /* WALK-REG 2026-10-16 R43: a web page does not name its device yet (only the counter does), so its sign-in is never in the list — say so, not a bare "0 devices" beside "signed in here" */
  function deviceListLegacyNote() {
    var sessions = H.data.ses;
    return sessions && sessions.r && sessions.r.legacy
      ? ' · <span class="tag amber" data-testid="sx-dev-legacy">' + esc(T('This browser is not counted — only counters name their device')) + '</span>'
      : '';
  }
  function account() {
    frame([
      '<h1 class="sx-h" data-testid="sx-title">' + esc(T('Account')) + '</h1>',
      '<h2 class="sx-h2">' +
        esc(T('Where you are signed in')) +
        ' <span class="sx-why" title="' +
        esc(T('Sign one out if a device is lost or shared.')) +
        '" style="cursor:help;opacity:.7">ⓘ</span></h2>',
      '<div id="sx_ses_bar"></div>',
      lineOut('sx_ses_out'),
      '<div class="sx-list" id="sx_ses_list" data-testid="sx-ses-list"></div>',
      '<h2 class="sx-h2">' + esc(T('Every device of the shop')) + '</h2>',
      '<div id="sx_dev_bar"></div>',
      lineOut('sx_dev_out'),
      '<div class="sx-list" id="sx_dev_list" data-testid="sx-dev-list"></div>',
      keysHead(),
      '<div id="sx_key_bar"></div>',
      lineOut('sx_key_out'),
      '<div class="sx-list" id="sx_key_list" data-testid="sx-key-list"></div>',
      '<div data-testid="sx-vault-wrap"><h2 class="sx-h2">' + esc(T('Vault')) + '</h2>',
      '<p class="sub"><a class="sx-link" href="/authority-forms.html" data-testid="sx-vault-forms">' + esc(T('Forms for an authority')) + ' ›</a></p>',
      '<div id="vaulthost" data-testid="sx-vault"></div></div>'
    ]);
    var sl = null,
      dl = null;
    var sesRows = sessionRows;
    var devMay = function () {
      var d = H.data.ses;
      return (d && d.r && d.r.may && d.r.may.devices) || null;
    };
    var devRows = function () {
      var d = H.data.dev;
      return (d && d.r && d.r.devices) || [];
    };
    function surface(s) {
      return T(SURFACE_WORDS[s] || s || 'Web');
    }
    function deviceOf(s) {
      var d = s.device || {};
      return d.label || (d.kind === 'till' ? T('Counter phone or PC') : T('A browser'));
    }
    function sinceOf(s) {
      return s.iat ? when(new Date(Number(s.iat) * 1000).toISOString()) : '';
    }
    function untilOf(s) {
      return s.exp ? day(new Date(Number(s.exp) * 1000).toISOString()) : '';
    }
    function paintSesBar() {
      var d = H.data.ses || {},
        rows = sesRows();
      $('sx_ses_bar').innerHTML = bar(
        '<span class="sx-count" data-testid="sx-ses-count"><b>' +
          rows.length +
          '</b> ' +
          esc(T(rows.length === 1 ? 'sign-in' : 'sign-ins')) +
          (d.r && d.r.legacy
            ? ' · <span class="tag amber" data-testid="sx-ses-legacy" title="' +
              esc(T('Shown from this device.')) +
              '">' +
              esc(T('This browser signs in without a device name — shown from this device only')) +
              '</span>'
            : '') +
          '</span>'
      );
    }
    function readSes() {
      return load(
        'ses',
        function () {
          return api('sessionsList');
        },
        null,
        function () {
          paintSesBar();
          if (sl) sl.refresh();
          paintDevBar();
          if (dl) dl.refresh();
        }
      );
    }
    sl = list($('sx_ses_list'), {
      key: 'set-sessions',
      rows: sesRows,
      id: function (s) {
        return s.jti;
      },
      rowTid: function (s) {
        return 'sx-ses-' + s.jti;
      },
      state: function () {
        return listState('ses');
      },
      error: function () {
        return listErr('ses');
      },
      onRetry: function () {
        readSes();
      },
      empty: { title: T('No listed sign-in'), sub: T('Sign in again and this device is listed here.') },
      columns: [
        {
          key: 'device',
          label: T('Device'),
          prio: 1,
          w: 220,
          html: true,
          value: deviceOf,
          cell: function (s) {
            return (
              '<b>' +
              esc(deviceOf(s)) +
              '</b>' +
              (s.current ? ' <span class="tag green" data-testid="sx-ses-current-' + esc(s.jti) + '">' + esc(T('This one')) + '</span>' : '')
            );
          }
        },
        {
          key: 'where',
          label: T('Where'),
          prio: 2,
          w: 150,
          cell: function (s) {
            return surface(s.surface);
          }
        },
        {
          key: 'since',
          label: T('Signed in'),
          prio: 3,
          w: 170,
          sort: 'since',
          cell: sinceOf,
          value: function (s) {
            return Number(s.iat) || 0;
          }
        },
        { key: 'until', label: T('Ends'), prio: 4, w: 130, cell: untilOf }
      ],
      sorts: [
        {
          key: 'since',
          label: T('Signed in'),
          cmp: function (a, b) {
            return (Number(b.iat) || 0) - (Number(a.iat) || 0);
          }
        }
      ],
      search: function (s) {
        return [deviceOf(s), surface(s.surface), s.device_id].join(' ');
      },
      filters: [
        {
          key: 'kind',
          label: T('Kind'),
          all: T('All'),
          options: [
            { v: 'till', label: T('Counter') },
            { v: 'web', label: T('Browser') }
          ],
          match: function (s, v) {
            var k = (s.device && s.device.kind) || 'web';
            return v === 'till' ? k === 'till' : k !== 'till';
          }
        }
      ],
      next: function (s) {
        var d = s.device || {};
        return (
          '<div class="sx-next" data-testid="sx-ses-next-' +
          esc(s.jti) +
          '"><div class="mono sub">' +
          esc(s.device_id || '') +
          '</div>' +
          (d.seen ? '<div class="sub">' + esc(T('Last seen') + ' ' + _keyAgo(d.seen)) + '</div>' : '') +
          '</div>'
        ); /* the current device's reason is the Sign out button's own (why) — not a second time here */
      },
      actions: [
        {
          id: 'signout',
          label: T('Sign out this device'),
          tid: 'sx-ses-signout',
          why: function (device) {
            return device.current ? T(CURRENT_WHY) : device.legacy ? T('Sign in again first.') : '';
          },
          run: function (s) {
            CBAction.run(
              btnOf('signout', s.jti),
              function () {
                return api('sessionRevoke', { body: { jti: s.jti } });
              },
              {
                key: 'sx-ses-signout-' + s.jti,
                confirm: {
                  title: T('Sign out') + ' ' + deviceOf(s) + '?',
                  body: esc(T('That device is signed out now. Nothing on it is lost.')),
                  yes: T('Sign out'),
                  danger: true
                },
                failed: T('Could not sign it out'),
                out: 'sx_ses_out',
                outcome: function () {
                  $('sx_ses_out').textContent = T('Signed out.');
                  readSes();
                }
              }
            );
          }
        }
      ]
    });

    /* every device of the shop — the owner's list (GET /signin/devices); anyone else sees it greyed with the server's sentence (may.devices), never hidden */
    function paintDevBar() {
      var m = devMay(),
        rows = devRows(),
        live = rows.filter(function (item) {
          return !item.revoked_at && Number(item.sessions) > 0;
        }).length;
      $('sx_dev_bar').innerHTML = bar(
        '<span class="sx-count" data-testid="sx-dev-count">' +
          (m && m.ok === false
            ? '<span class="sx-why" data-testid="sx-dev-why">' + esc(m.why || T('Not allowed for this sign-in.')) + '</span>'
            : '<b>' +
              rows.length +
              '</b> ' +
              esc(T(rows.length === 1 ? 'device' : 'devices')) +
              ' · <b>' +
              live +
              '</b> ' +
              esc(T('signed in now')) +
              deviceListLegacyNote()) +
          '</span>'
      );
    }
    function readDev() {
      var m = devMay();
      if (m && m.ok === false) {
        H.data.dev = { state: 'error', err: { status: 403, message: m.why } };
        paintDevBar();
        if (dl) dl.refresh();
        return Promise.resolve();
      }
      return load(
        'dev',
        function () {
          return api('devicesList');
        },
        null,
        function () {
          paintDevBar();
          if (dl) dl.refresh();
        }
      );
    }
    function devState(d) {
      return d.revoked_at ? T('Removed') : Number(d.sessions) > 0 ? T('Signed in') : T('Nobody signed in');
    }
    dl = list($('sx_dev_list'), {
      key: 'set-devices',
      rows: devRows,
      id: function (d) {
        return d.device_id;
      },
      rowTid: function (d) {
        return 'sx-dev-' + d.device_id;
      },
      state: function () {
        return listState('dev');
      },
      error: function () {
        return listErr('dev');
      },
      onRetry: function () {
        readDev();
      },
      empty: { title: T('No device listed yet') },
      columns: [
        {
          key: 'id',
          label: T('Device'),
          prio: 1,
          w: 220,
          html: true,
          value: function (d) {
            return d.label || d.device_id;
          },
          cell: function (d) {
            return (
              '<b>' +
              esc(d.label || (d.kind === 'till' ? T('Counter phone or PC') : T('A browser'))) +
              '</b> <span class="mono sub">' +
              esc(String(d.device_id || '').slice(0, 12)) +
              '</span>'
            );
          }
        },
        {
          key: 'state',
          label: T('Now'),
          prio: 2,
          w: 170,
          html: true,
          value: devState,
          cell: function (d) {
            var on = !d.revoked_at && Number(d.sessions) > 0;
            return (
              '<span class="tag' +
              (d.revoked_at ? '' : on ? ' green' : ' amber') +
              '" data-testid="sx-dev-state-' +
              esc(d.device_id) +
              '">' +
              esc(devState(d)) +
              (on ? ' · ' + d.sessions : '') +
              '</span>'
            );
          }
        },
        {
          key: 'seen',
          label: T('Last seen'),
          prio: 3,
          w: 150,
          sort: 'seen',
          cell: function (d) {
            return d.seen ? _keyAgo(d.seen) : T('Never');
          },
          value: function (d) {
            return d.seen ? new Date(d.seen).getTime() : 0;
          }
        },
        {
          key: 'first',
          label: T('First seen'),
          prio: 4,
          w: 150,
          cell: function (d) {
            return day(d.first_seen);
          }
        }
      ],
      sorts: [
        {
          key: 'seen',
          label: T('Last seen'),
          cmp: function (a, b) {
            return (b.seen ? new Date(b.seen).getTime() : 0) - (a.seen ? new Date(a.seen).getTime() : 0);
          }
        }
      ],
      search: function (d) {
        return [d.label, d.device_id, d.kind, d.till_prefix].join(' ');
      },
      filters: [
        {
          key: 'st',
          label: T('State'),
          all: T('All'),
          options: [
            { v: 'on', label: T('Signed in') },
            { v: 'off', label: T('Nobody signed in') },
            { v: 'gone', label: T('Removed') }
          ],
          match: function (d, v) {
            return v === 'gone' ? !!d.revoked_at : v === 'on' ? !d.revoked_at && Number(d.sessions) > 0 : !d.revoked_at && !(Number(d.sessions) > 0);
          }
        }
      ],
      next: function (d) {
        return (
          '<div class="sx-next" data-testid="sx-dev-next-' +
          esc(d.device_id) +
          '"><div class="mono sub">' +
          esc(d.device_id || '') +
          '</div>' +
          (d.till_prefix ? '<div class="sub">' + esc(T('Bills as') + ' ' + d.till_prefix) + '</div>' : '') +
          (d.revoked_at ? '<div class="sub">' + esc(T('Removed') + ' ' + when(d.revoked_at)) + '</div>' : '') +
          '</div>'
        ); /* what Remove does is said once, in its confirm */
      },
      actions: [
        {
          id: 'remove',
          label: T('Remove this device'),
          tid: 'sx-dev-remove',
          when: function (d) {
            return !d.revoked_at;
          },
          why: function () {
            return grey(devMay());
          },
          run: function (d) {
            CBAction.run(
              btnOf('remove', d.device_id),
              function () {
                return api('sessionRevoke', { body: { device_id: d.device_id } });
              },
              {
                key: 'sx-dev-remove-' + d.device_id,
                confirm: {
                  title: T('Remove this device?'),
                  body: esc(T('Everyone on it is signed out now, and it cannot sign in again. Bills it has not sent stay on it.')),
                  yes: T('Remove'),
                  danger: true
                },
                failed: T('Could not remove it'),
                out: 'sx_dev_out',
                outcome: function () {
                  $('sx_dev_out').textContent = T('Device removed.');
                  readDev();
                  readSes();
                }
              }
            );
          }
        }
      ]
    });
    paintSesBar();
    paintDevBar();
    readSes().then(readDev);

    /* SET-34 (Athi, 6 Nov 2026): the keys are SHOWN here, in the one list with Make a key, Copy and Revoke — no door to an empty Connectors page */
    keysSection();

    /* the vault: the workshop's own card (cap-shop.js), every section type here — Your shop shows the identity rows only */
    UI._vaultOnly = '';
    loadVault();
  }

  var PAINT = { counters: counters, connectors: connectors, policy: policy, plan: plan, account: account };
  function mount(host, sec) {
    H.lists.forEach(function (item) {
      try {
        item.destroy();
      } catch (e) {
        if (typeof cblog === 'function') cblog('error', 'settings list teardown: ' + ((e && e.message) || e));
      }
    });
    H.lists = [];
    H.data = {};
    H.host = host;
    H.sec = sec;
    (PAINT[sec] || counters)();
  }
  /* policyRun · policySave · policyControl · policyShown · policyEditButtons · policyRowEdit: the draft-and-Save path the workshop's Business rules card (cap-admin.js) draws with too (R121b) */
  return {
    mount: mount,
    SECTIONS: Object.keys(PAINT),
    policyRun: policyRun,
    policyControl: policyControl,
    policyShown: policyShown,
    policyEditButtons: policyEditButtons,
    policyRowEdit: policyRowEdit
  };
})();
