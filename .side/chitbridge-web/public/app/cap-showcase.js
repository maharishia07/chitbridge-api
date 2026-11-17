/* cap-showcase.js — THE SHOP WINDOW CHOOSER, ONE COPY (T3-P2-CRM, 2026-10-14): the registered showcase templates (app/showcase-templates.js,
 * CBShowcase.TEMPLATES) as one button each, the chosen one lit, and the live preview = the shop's OWN page in a frame (shop.html?s=<id>&preview=1
 * &showcase=<name>) — the SAME renderer the customer sees, never a lookalike. LIFTED from cap-admin.js showcaseCard (the workshop's Settings › Policy)
 * so CB CRM's Shop window paints the same chooser; cap-admin now calls this. The choice itself is the policy flag `showcase_template`
 * (PATCH /api/entities/policy) — the host saves it; this draws.
 *   CBShowcasePick.html({ current, shopId, t, cls, clsOn, why, origin }) → the buttons + the preview frame
 *     cls / clsOn: the host's button classes (the workshop's `btn` / `btn primary`; CB CRM's `act sm ghost` / `act sm`)
 *     why: a sentence → every button is shown greyed with it (the server's or the level's may/why), never hidden
 * OWNS      CBShowcasePick.html (the template buttons and the preview frame; the host saves the choice)
 * CALLED BY app/cap-crm-groups.js family, its part cap-crm-groups-window.js (crmShowcasePick, the Shop window tab) · app/cap-admin.js (Settings › Policy, line 9776) · loaded by crm.html and app.html (<script src>)
 * FLOW      a host calls CBShowcasePick.html({ current, shopId, … }) → one button per CBShowcase.TEMPLATES entry (app/showcase-templates.js) → the host's click saves PATCH /api/entities/policy → the frame reloads shop.html?preview=1
 * CARD      11-crm-and-marketing/showcase
 */
(function (root) {
  'use strict';
  var _e = function (s) {
    return root.esc(s);
  }; /* the ONE escaper (app/helpers.js esc), loaded by every host before this file — never a copy */
  var WORD = { gallery: 'Gallery', menu: 'Menu', specs: 'Specs', booking: 'Booking' };
  function previewUrl(o, name) {
    return (o.origin || '') + '/shop.html?s=' + encodeURIComponent(o.shopId) + '&preview=1&showcase=' + encodeURIComponent(name);
  }
  function html(o) {
    o = o || {};
    var SC = root.CBShowcase;
    if (!SC) return '';
    var t =
      typeof o.t === 'function'
        ? o.t
        : function (s) {
            return s;
          };
    var cur = o.current && SC.TEMPLATES[o.current] ? o.current : SC.DEFAULT,
      why = o.why || '';
    var btn = Object.keys(SC.TEMPLATES)
      .map(function (item) {
        var tp = SC.TEMPLATES[item],
          on = item === cur;
        return (
          '<button data-cbsid="SCR061-B01" type="button" class="' +
          _e(on ? o.clsOn || 'btn primary' : o.cls || 'btn') +
          '" data-testid="sc-pick" data-name="' +
          _e(item) +
          '" data-sc-pick="' +
          _e(item) +
          '" aria-pressed="' +
          on +
          '"' +
          (why ? ' disabled aria-disabled="true" title="' + _e(why) + '"' : '') +
          '>' +
          _e(t(tp.vertical.charAt(0).toUpperCase() + tp.vertical.slice(1)) + ' · ' + t(WORD[tp.template] || tp.template)) +
          (on ? ' ✓' : '') +
          '</button>'
        );
      })
      .join(' ');
    return (
      '<div class="sc-picks" data-testid="sc-picks" data-current="' +
      _e(cur) +
      '">' +
      btn +
      '</div>' +
      (why ? '<div class="hint" data-testid="sc-pick-why">' + _e(why) + '</div>' : '') +
      (o.shopId
        ? '<iframe title="' +
          _e(t('Preview')) +
          '" data-testid="sc-preview" src="' +
          _e(previewUrl(o, cur)) +
          '" class="sc-frame" style="width:100%;max-width:390px;height:560px;border:1px solid var(--line,#e6dcc6);border-radius:12px;margin-top:10px;background:var(--card,#fffdf8)"></iframe>'
        : '')
    );
  }
  var api = { html: html, previewUrl: previewUrl, WORD: WORD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CBShowcasePick = api;
})(typeof window !== 'undefined' ? window : globalThis);
