/**
 * shop-privacy.js — CBShopPrivacy: the SHOPPER's own privacy sheet on the storefront (shop.html), beside My orders. T3-P3-CONSENT (2026-10-14).
 *
 * What it paints is the server's answer, GET /api/privacy/me (chitbridge-api routes/privacy.js, a storefront token only): what the shop holds
 * about this person (a null is said as "Not held"), the shop's country's law in its own words (lib/privacy.lawOf — DPDP · Privacy Act · PDPL,
 * or "no pack yet"; never a national default), consent for offers per channel (the server's code picks the chip; the button that CHANGES the
 * state is the only one drawn), the requests the law gives (`law.kinds` — the server's list, never a regex), and the requests already made.
 * A yes/no is ONE POST /me/consent (the same notePref the shop's staff write through); a copy / erasure is RECORDED (POST /me/requests) and
 * answered by the shop — erasure itself only through the platform's lifecycle path, never from this sheet.
 *
 *   CBShopPrivacy.open({ api, token, host, sheet(inner), done })   api = the api base · token = the order's session (memory only) · host = the
 *   sheet's element · sheet = shop.html's shopSheet · done = its Done button markup
 *
 * ⭐ REUSE: shop.html's sheet, tokens and classes (.sg · .meta); helpers.js esc (the ONE copy — loaded by shop.html before this file). ⭐ NEW PATH: no storefront screen showed a shopper their data.
 * The server decides: may_consent / may_request carry { may, code, why } — a refused button is greyed WITH its sentence, never hidden.
 *
 * OWNS      CBShopPrivacy: open (the shopper's privacy sheet) · reload (Try again) — the one storefront screen that shows a shopper their own data
 * CALLED BY shop.html (<script src>; shopPrivacy() calls CBShopPrivacy.open, only while the order's session is held) — no other page loads it
 * FLOW      shop.html My orders → CBShopPrivacy.open → GET /api/privacy/me → the sheet → POST /me/consent · /me/requests
 * CARD      11-crm-and-marketing/consent-and-privacy-requests
 */
(function (root) {
  'use strict';
  if (root.CBShopPrivacy) return;
  var S = { o: null, d: null, busy: false };
  var CH = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail', phone: 'Phone', chitbridge: 'ChitBridge' };
  var ORDER = ['whatsapp', 'sms', 'email', 'phone', 'chitbridge'];
  var KIND = {
    access: 'A copy of my data',
    correct: 'Correct my data',
    erase: 'Erase my data',
    withdraw: 'Withdraw consent',
    nominate: 'Name a nominee',
    grievance: 'Raise a grievance'
  };
  var OUT = { done: 'Done', partly: 'Partly done', refused: 'Refused' };
  var WORD = {
    CONSENT: ['Yes', 'ok'],
    NO_CONSENT: ['Not asked', ''],
    CONSENT_WITHDRAWN: ['Withdrawn', 'no'],
    SAID_NO: ['No', 'no'],
    OPTED_OUT: ['Stopped', 'no'],
    LEGITIMATE_USE: ['Allowed', '']
  };
  var day = function (iso) {
    if (!iso) return '';
    var date = new Date(iso);
    return isNaN(date) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  var BTN =
    'border:1px solid var(--accent,#3F66A6);border-radius:9px;padding:7px 12px;background:var(--card,#fff);color:var(--accent,#3F66A6);font-weight:700;font-size:13px;cursor:pointer';
  var OFF =
    'border:1px solid var(--line,#e7e3d8);border-radius:9px;padding:7px 12px;background:var(--card,#fff);color:var(--ink-3,#8A8374);font-weight:700;font-size:13px;cursor:not-allowed';
  var CHIP = {
    '': 'background:var(--panel,#F3EFE6);color:var(--ink-2,#3a4048)',
    ok: 'background:var(--ok-soft,#E8F4ED);color:var(--ok-2,#0D4A2B)',
    no: 'background:var(--disp-soft,#FBEAE3);color:var(--disp,#8E3517)'
  };

  function req(method, path, body) {
    var o = S.o;
    return fetch(o.api + path, {
      method: method,
      headers: Object.assign({ Authorization: 'Bearer ' + o.token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (reply) {
      return reply.json().then(function (j) {
        return { status: reply.status, j: j || {} };
      });
    });
  }
  var head = function (t) {
    return '<div class="sg" style="font-weight:800;font-size:17px;margin-bottom:6px" data-testid="shop-priv-title">' + esc(t) + '</div>';
  };
  var sec = function (t, inner, tid) {
    return (
      '<div style="margin-top:14px" data-testid="' +
      tid +
      '"><div style="font-weight:700;font-size:13.5px;margin-bottom:4px">' +
      esc(t) +
      '</div>' +
      inner +
      '</div>'
    );
  };
  var chip = function (v, tid) {
    var w = WORD[(v || {}).code] || ['Unknown', ''];
    return (
      '<span style="display:inline-block;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:700;' +
      CHIP[w[1]] +
      '" title="' +
      esc((v || {}).why || '') +
      '" data-testid="' +
      tid +
      '" data-code="' +
      esc((v || {}).code || '') +
      '">' +
      esc(w[0]) +
      '</span>'
    );
  };
  var btn = function (label, data, tid, why) {
    return (
      '<button type="button" ' +
      data +
      ' data-testid="' +
      tid +
      '" style="' +
      (why ? OFF : BTN) +
      '"' +
      (why ? ' disabled aria-disabled="true" title="' + esc(why) + '"' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  };
  var paintErr = function (msg) {
    var o = S.o;
    o.host.innerHTML = o.sheet(
      head('Your privacy') +
        '<div class="meta" data-testid="shop-priv-err" style="color:var(--disp,#b4453f)">' +
        esc(msg) +
        '</div><div style="display:flex;gap:8px;margin-top:14px"><button data-cbsid="CMP009" type="button" onclick="CBShopPrivacy.reload()" style="' +
        BTN +
        ';flex:1">Try again</button>' +
        o.done +
        '</div>'
    );
  };

  function paint() {
    var o = S.o,
      d = S.d,
      law = d.law || {},
      shop = (d.shop && d.shop.name) || 'this shop';
    var lawLine = law.known ? '<b>' + esc(law.short || law.law) + '</b> · ' + esc(law.consent || '') : esc(law.note || '');
    var held = (d.held || [])
      .map(function (item) {
        return (
          '<div style="display:flex;gap:10px;font-size:13px;padding:3px 0;border-top:1px dashed var(--line,#e7e3d8)" data-testid="shop-priv-held-' +
          esc(item.key) +
          '"><span style="flex:0 0 42%;color:var(--ink-2,#3a4048)">' +
          esc(item.label) +
          '</span><span style="flex:1' +
          (item.value ? '' : ';color:var(--ink-2,#3a4048);font-style:italic') +
          '">' +
          esc(item.value || 'Not held') +
          '</span></div>'
        );
      })
      .join('');
    var mc = d.may_consent || { may: true },
      whyC = mc.may ? '' : mc.why || 'Not available yet.';
    var may = (d.consent && d.consent.may) || {};
    var offers = ORDER.map(function (item) {
      var v = (may[item] || {}).marketing || { code: 'NO_CONSENT' };
      var b = v.may
        ? btn('No', 'data-cbsid="SHP001-B28" data-priv="consent" data-ch="' + item + '" data-v="0"', 'shop-priv-no-' + item, whyC)
        : btn('Yes', 'data-cbsid="SHP001-B29" data-priv="consent" data-ch="' + item + '" data-v="1"', 'shop-priv-yes-' + item, whyC);
      return (
        '<div style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0;border-top:1px dashed var(--line,#e7e3d8)" data-testid="shop-priv-ch-' +
        item +
        '"><span style="flex:1">' +
        esc(CH[item]) +
        '</span>' +
        chip(v, 'shop-priv-chip-' + item) +
        b +
        '</div>'
      );
    }).join('');
    var mr = d.may_request || { may: true },
      whyR = mr.may ? '' : mr.why || 'Not available yet.';
    var kinds = (law.kinds || Object.keys(KIND)).filter(function (item) {
      return KIND[item];
    });
    var ask =
      '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
      kinds
        .map(function (item) {
          return btn(KIND[item], 'data-cbsid="SHP001-B30" data-priv="request" data-kind="' + item + '"', 'shop-priv-ask-' + item, whyR);
        })
        .join('') +
      '</div>' +
      (whyR ? '<div class="meta" data-testid="shop-priv-ask-why">' + esc(whyR) + '</div>' : '') +
      '<div class="meta" style="margin-top:6px">' +
      esc('The shop answers within ' + (law.due_days || 30) + ' days. Erasure runs through our lifecycle path.') +
      '</div>';
    var reqs = (d.requests && d.requests.requests) || [];
    var made = reqs.length
      ? reqs
          .map(function (item) {
            return (
              '<div style="display:flex;gap:8px;font-size:13px;padding:3px 0;border-top:1px dashed var(--line,#e7e3d8)" data-testid="shop-priv-req"><span style="flex:1">' +
              esc(KIND[item.kind] || item.kind) +
              '</span><span style="color:var(--ink-2,#3a4048)">' +
              esc(item.answered_at ? (OUT[item.outcome] || 'Answered') + ' · ' + day(item.answered_at) : 'Due ' + day(item.due_at)) +
              '</span></div>'
            );
          })
          .join('')
      : '';
    var msg = '<div class="meta" id="shop_priv_msg" role="status" data-testid="shop-priv-msg" style="min-height:1em"></div>';
    o.host.innerHTML = o.sheet(
      head('Your privacy') +
        '<div class="meta" data-testid="shop-priv-law">' +
        lawLine +
        '</div>' +
        sec('What ' + shop + ' holds', held, 'shop-priv-held') +
        sec('Offers from ' + shop, offers + (whyC ? '<div class="meta" data-testid="shop-priv-consent-why">' + esc(whyC) + '</div>' : ''), 'shop-priv-offers') +
        sec('Ask the shop', ask, 'shop-priv-ask') +
        (made ? sec('Your requests', made, 'shop-priv-made') : '') +
        msg +
        '<div style="display:flex;margin-top:14px">' +
        o.done +
        '</div>'
    );
    o.host.onclick = onClick;
  }
  function onClick(ev) {
    var node = ev.target.closest && ev.target.closest('[data-priv]');
    if (!node || node.disabled || S.busy) return;
    var a = node.getAttribute('data-priv'),
      msg = function (s) {
        var element = root.document.getElementById('shop_priv_msg');
        if (element) element.textContent = s;
      };
    S.busy = true;
    var p =
      a === 'consent'
        ? req('POST', '/api/privacy/me/consent', { channel: node.getAttribute('data-ch'), purpose: 'marketing', allowed: node.getAttribute('data-v') === '1' })
        : req('POST', '/api/privacy/me/requests', { kind: node.getAttribute('data-kind') });
    p.then(function (reply) {
      S.busy = false;
      if (reply.status === 201) {
        return load(a === 'consent' ? 'Noted.' : 'Recorded. The shop will answer.');
      }
      msg((reply.j && (reply.j.why || reply.j.message)) || 'Could not save that. Try again.');
    }).catch(function () {
      S.busy = false;
      msg('Network problem. Try again.');
    });
  }
  function load(note) {
    var o = S.o;
    o.host.innerHTML = o.sheet(head('Your privacy') + '<div class="meta" data-testid="shop-priv-loading">Loading…</div>');
    return req('GET', '/api/privacy/me')
      .then(function (reply) {
        if (reply.status !== 200) return paintErr((reply.j && reply.j.message) || 'Could not read your privacy page.');
        S.d = reply.j;
        paint();
        if (note) {
          var node = root.document.getElementById('shop_priv_msg');
          if (node) node.textContent = note;
        }
      })
      .catch(function () {
        paintErr('Network problem. Try again.');
      });
  }
  function open(o) {
    S.o = o;
    return load();
  }
  root.CBShopPrivacy = {
    open: open,
    reload: function () {
      return load();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
