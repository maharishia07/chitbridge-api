/**
 * embed-host.js — CBEmbed: open one of the small apps INSIDE another page, in a dialog, and hear what happened there.
 * OWNS       CBEmbed.open: the dialog + iframe for an embedded small app, its postMessage handshake and its close button
 * CALLED BY  till.html by <script src> (grep -lE 'src="/?app/embed-host.js' public/*.html); CBEmbed.open is called in till.html only (Add a person: grep -n 'CBEmbed\.open' public)
 * FLOW       a host calls open({ app, view, ... }) → dialog with /<app>.html?embed=1 → the embed posts { cb, event } → onMessage / onClose → close()
 * CARD       29-qa-test-tooling-ux-locale-and-design-system/embed-host
 * P1 (2026-10-10). Tasks & Orders will use the same helper for its own embeds; nothing here knows about employees.
 *
 *   var h = CBEmbed.open({ app: 'employees', view: 'add', title: 'Add a person',
 *                          api: function () { return base }   // where the host's token is good (default: the host's CloudHost.api) — the embed reads THERE, not at its own default
 *                          onMessage: function (m) { ... }, onClose: function () { ... } });   h.close()
 *
 * The embed page is /<app>.html?embed=1&view=<view>. It tells its host with window.parent.postMessage({ cb: <app>, event, person? }, origin).
 * Only a message from THIS iframe, from this page's own origin, with cb === app is heard; `event: 'close'` closes the dialog.
 * Same origin only. The sign-in is the browser's own saved session; a host that holds a session of its own (the till signs a PERSON in under a
 * shop-scoped store, not cb_sess) passes  session: function () { return token }  and the embed — which asks with { cb, event: 'need-session' } —
 * is answered over postMessage { cb: 'host', event: 'session', token } to THIS iframe only. The token is never put in the address or in storage.
 
 * CALLED BY public/app/attach-ui.js, public/app/cap-crm-groups.js, public/app/cap-readiness.js, public/app/cap-settings.js, public/till.html   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
(function (root) {
  'use strict';
  function open(o) {
    var doc = root.document,
      node = doc.createElement('dialog'),
      f = doc.createElement('iframe'),
      x = doc.createElement('button');
    var src = '/' + o.app + '.html?embed=1' + (o.view ? '&view=' + encodeURIComponent(o.view) : '');
    node.setAttribute('data-pop', 'POP150');
    node.setAttribute('data-testid', 'embed-' + o.app);
    node.style.cssText =
      'border:1px solid var(--line,#DDD6C6);border-radius:14px;padding:0;width:min(560px,96vw);height:min(640px,90vh);background:var(--card,#fff);overflow:hidden';
    f.src = src;
    f.title = o.title || o.app;
    f.setAttribute('data-testid', 'embed-frame');
    f.style.cssText = 'border:0;width:100%;height:100%;display:block';
    x.type = 'button';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Close');
    x.title = 'Close';
    x.style.cssText = 'position:absolute;right:8px;top:8px;z-index:2;border:0;background:transparent;font-size:18px;cursor:pointer;color:inherit';
    node.appendChild(f);
    node.appendChild(x);
    doc.body.appendChild(node);
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      root.removeEventListener('message', heard);
      try {
        node.close();
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
      node.remove();
      if (o.onClose) o.onClose();
    }
    function heard(e) {
      if (e.source !== f.contentWindow || e.origin !== root.location.origin) return;
      var m = e.data;
      if (!m || m.cb !== o.app) return;
      if (m.event === 'close') return close();
      if (m.event === 'need-session') {
        var t = o.session && o.session();
        try {
          f.contentWindow.postMessage(
            { cb: 'host', event: 'session', token: t || null, api: (o.api ? o.api() : root.CloudHost && root.CloudHost.api) || null },
            root.location.origin
          );
        } catch (_) { /* no host window to tell: standalone page */ }
        return;
      }
      if (o.onMessage) o.onMessage(m);
    }
    root.addEventListener('message', heard);
    x.onclick = close;
    node.addEventListener('cancel', function (e) {
      e.preventDefault();
      close();
    });
    try {
      node.showModal();
    } catch (_) {
      node.setAttribute('open', '');
    }
    return { close: close };
  }
  root.CBEmbed = { open: open };
})(typeof window !== 'undefined' ? window : globalThis);
