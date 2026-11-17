/* cap-rewards.js — (global CBRewardsPane, NOT CBRewards: that name is the vendored engine /engine/rewards.js, CRM-255) THE REWARDS PANE, ONE COPY (T3-P2-CRM, 2026-10-14): what a customer holds in points, what it is worth, how it was earned,
 * what is next, when it expires, and where it came from — painted from GET /api/relationships/customers/:id/rewards (chitbridge-api
 * routes/relationships.js: the engine's own worthOf · describeEarn over reward-store.balance → rewards.balanceOf).
 * LIFTED from app.html custRewardsLoad (the workshop's Customers pane) so CB CRM's record paints the SAME pane; app.html now calls this.
 * ⭐ ONE CALCULATION: nothing is added up here — the balance, the worth, the expiry are the server's (the engine's) figures and SENTENCES.
 *   The money is formatted by the host (o.money) in the shop's own locale: the engine returns a bare figure on purpose.
 * ⚠️ Not a programme → the one plain line the server sends (says). Could not read → words, never "nothing here".
 *   CBRewardsPane.html(r, o)        → the pane's HTML for a server answer r;  o = { money(n), t(english) }
 *   CBRewardsPane.load(host, o)     → reads and paints into host (an element or an id); o = { id, api(name, opts) | fetch(), money, t }
 
 * CARD 08-rewards-and-loyalty/customer-s-rewards-view
 * CALLED BY public/app.html, public/app/cap-crm-record.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * OWNS      CBRewardsPane.html(r, o) and .load(host, o): the customer rewards pane, painted from the server answer; adds nothing up
 * FLOW      load(host, o) -> GET customers/:id/rewards -> html(r, o) -> host.innerHTML
 */
(function (root) {
  'use strict';
  var T = function (o, s) {
    return o && typeof o.t === 'function' ? o.t(s) : s;
  };
  var _e = function (s) {
    return root.esc(s);
  }; /* the ONE escaper (app/helpers.js esc), loaded by every host before this file — never a copy */
  function row(l, v, tid) {
    return '<div class="kv"' + (tid ? ' data-testid="' + tid + '"' : '') + '><b>' + _e(l) + '</b><span>' + v + '</span></div>';
  }
  function fmtOf(o, n) {
    try {
      return o && typeof o.money === 'function' ? o.money(n) : String(n);
    } catch (_) {
      return String(n);
    }
  } /* the host's formatter (CBLocale.money) — the figure is the server's */

  /** the pane for a server answer: a programme → balance · worth · earned by · next · expires · just expired · the last movements; none → its one line */
  function html(r, o) {
    o = o || {};
    if (!r || !r.programme)
      return row(
        T(o, 'Programme'),
        '<span class="sub" data-testid="rw-none">' + _e((r && r.says) || T(o, 'This shop does not run a points programme.')) + '</span>'
      );
    var h =
      row(
        T(o, 'Balance'),
        '<b data-testid="rw-points">' +
          _e(String(r.points || 0)) +
          '</b> ' +
          _e(T(o, 'points')) +
          (r.money_known ? ' <span class="sub">· ' + _e(T(o, 'the shop owes')) + ' ' + _e(fmtOf(o, r.worth || 0)) + '</span>' : '') +
          (r.negative ? ' <span class="tag red">' + _e(T(o, 'below zero — check the ledger')) + '</span>' : '')
      ) +
      row(T(o, 'Worth'), _e(r.says || '—'), 'rw-says') +
      row(T(o, 'Earned by'), _e(r.earns || '—')) +
      (r.next
        ? row(T(o, 'Next'), _e(r.next.name) + ' <span class="sub">· ' + _e(String(r.next.short || '')) + ' ' + _e(T(o, 'more')) + '</span>', 'rw-next')
        : '') +
      row(
        T(o, 'Expires'),
        r.expires_months
          ? _e(String(r.expires_months) + ' ' + T(o, 'months after they are earned'))
          : '<span class="sub">' + _e(T(o, 'never — this shop has not set an expiry')) + '</span>',
        'rw-expires'
      ) +
      (r.expired_now ? row(T(o, 'Just expired'), '<span class="late">' + _e(String(r.expired_now)) + ' ' + _e(T(o, 'points')) + '</span>', 'rw-expired') : '');
    /* where they came from, on the same screen: a balance with no history is a number nobody can argue with */
    var recent = Array.isArray(r.recent) ? r.recent.slice(0, 8) : [];
    if (recent.length)
      h +=
        '<div class="rw-hist" data-testid="rw-history">' +
        recent
          .map(function (e) {
            return (
              '<div class="rw-e"><span class="sub">' +
              _e(String(e.at || '').slice(0, 10)) +
              ' · ' +
              _e(e.why || '') +
              (e.ref ? ' · ' + _e(e.ref) : '') +
              '</span><b>' +
              (Number(e.points) > 0 ? '+' : '') +
              _e(String(e.points)) +
              '</b></div>'
            );
          })
          .join('') +
        '</div>';
    return h;
  }

  /** read, then paint — the host may have been left while the read was out (the element is looked up again) */
  function load(host, o) {
    o = o || {};
    var el = typeof host === 'string' ? root.document.getElementById(host) : host;
    if (!el) return Promise.resolve();
    var hostId = el.id;
    var again = function () {
      return hostId ? root.document.getElementById(hostId) : el;
    };
    el.innerHTML = '<div class="kv"><span class="sub">' + _e(T(o, 'Reading…')) + '</span></div>';
    var read = typeof o.read === 'function' ? o.read() : o.api('custRewards', { params: { id: o.id } });
    return Promise.resolve(read).then(
      function (reply) {
        var node = again();
        if (!node) return;
        node.innerHTML = html(reply, o);
      },
      function (e) {
        var node = again();
        if (!node) return;
        if (typeof root.cblog === 'function') root.cblog('error', 'rewards pane: ' + ((e && e.message) || e));
        node.innerHTML = row(T(o, 'Points'), '<span class="sub" data-testid="rw-error">' + _e(T(o, 'Could not read the points. Try again later.')) + '</span>');
      }
    );
  }

  var api = { html: html, load: load };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CBRewardsPane = api;
})(typeof window !== 'undefined' ? window : globalThis);
