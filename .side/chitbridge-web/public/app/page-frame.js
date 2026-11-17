/**
 * public/app/page-frame.js — CBFrame: the frame every page wears (the header, the side menu, the phone's section tabs)
 * ID        CMP054 (the frame's own controls; the header's are CMP codes in shell.js)
 * OWNER     cb-ux-locale
 * OWNS      the standard page skeleton: the side menu and its entries, the folding group heads, the Collapse button, the phone's section tabs
 * CALLED BY accounts · crm · finance · know-your-business · settings · the labs and the storefront pages (CBFrame.mount, SHELL-ONE: every page wears the one frame).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/page-frame
 * RISK      plain
 * FLOW      mount → session() → skeleton()? → CBShell.mount(host, { host:{app|bar}, person, signin, avatar, title, homeHref, fit }) → work into the slot
 * page-frame.js — CBFrame: the frame an older single-purpose page (Know your business, Documents) wears so it is part of the application.
 *
 * Athi's black-box, 2026-10-09 (H23/H24): those two pages asked for an e-mail and a code AGAIN while the owner was signed in, and had no header,
 * no Home, no avatar. This is NOT a new frame and NOT a second sign-in: it mounts CBShell (host { app }), whose header is the one every app has,
 * and whose signed-out slot holds CBSignin.mount - the one sign-in window - exactly as Home does. A signed-in person's session (cb_sess, checked
 * by CBOnePerson.who) is simply used: the page reads FRAME.token and never asks for a code.
 *
 *   CBFrame.mount({ app: 'kyb', surface: 'kyb', work: <element the page draws in> }) → { token, session, shell }
 *   skeleton: { name, icon, sections, active, onSection } draws the standard sidebar + main pane around the page (link /app/page-skeleton.css).
 *   kural: a route of app/kurals.json draws the foldable footer band (load /app/kural.js); left out, no band.
 *   screen code: load /app/screen-id.js and the header carries this screen's name · code (CBScreenId; the section on show, SCREEN-ID).
 *   Load first: /engine/screen.js · (/app/edition.js: the person's edition, AX1) · /app/avatar.js · /engine/signin.js · /app/signin-ui.js · /app/one-person.js · /app/accounts-shell.js · /app/rail-bell.js · /app/shell.js
 *   signin: false — a public page (works signed out): no sign-in window in the page, the avatar's "Sign in" goes to Home's. area: the switcher's area.
 *   SHELL-ONE (2026-10-15, every page wears the same frame — Athi: "lot of in-consistencies in each page before sign-in itself"):
 *   host: <element>  the page's own place for the header (an app with its own sidebar: CB Accounts · CRM · Finance put it at the top of their main pane)
 *   bar: true        the HEADER ONLY (the storefront, a lab, the shop screen): mark · name · chip · ⌂ Home · avatar, the page's own body under it
 *   anonymous        true: no stored session is read, the avatar is "Sign in"; manifest { entries: [] } skips the manifest fetch; fonts false skips the Google Fonts link (the no-login bank demo)
 *   homeHref         where ⌂ Home goes (default '/'); the storefront passes the shop's own front
 *   title            { icon, name } the bar's name for a page with no manifest entry (a lab) or whose name is data (the shop's)
 *   avatar           extra CBAvatar options (onSignIn: a page that hosts the one sign-in window in its own card scrolls to it)
 *   level            the server's word for a login that is not the owner (editor · view-only), said after the shop's name in the bar
 *   FLOW  mount → session() → skeleton()? → CBShell.mount(host, { host:{app|bar}, person, signin, avatar, title, homeHref, fit }) → work into the slot
 */
(function (root) {
  'use strict';
  function session(anonymous) {
    if (anonymous) return null; /* a page that stores and reads nothing (bank-demo.html) */
    try {
      var parsed = JSON.parse(root.localStorage.getItem('cb_sess') || 'null');
      return parsed && root.CBOnePerson && root.CBOnePerson.who(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  /* the STANDARD PAGE SKELETON (decision 2026-10-09, "one frame style on every app page"): sidebar + main pane, styled by /app/page-skeleton.css.
     skeleton: { name, icon: <svg path d>, sections: [{ k, label, icon: <svg path d> | glyph: 'text' } | { group: 'heading' }], active: k, onSection: fn(k) } */
  /** the mount of a frame control: this screen's code + U154 (the rule of every reused component); none on a page that does not load screen-id.js */
  function frameMount() {
    return root.CBScreenId && root.CBScreenId.mountAttr ? root.CBScreenId.mountAttr('CMP054') : '';
  }
  /** the screen is named after the controls are drawn (and changes with the section): give every frame control the mount of the screen on show */
  function stampFrameMounts(scope) {
    var mount = frameMount().match(/"([^"]+)"/);
    if (!mount) return;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-cbsid^="CMP054"]'), function (element) {
      element.setAttribute('data-cbmount', mount[1]);
    });
  }
  /** the shell named the app; the skeleton names the section it opened on, and the frame's controls take that screen's mount */
  function nameSection(skel, opts) {
    if (!skel || !root.CBScreenId) return;
    root.CBScreenId.here(opts.app, opts.skeleton.active);
    stampFrameMounts(root.document);
  }
  /** a heading's slug, the one word its test id and its fold's panel id carry */
  function slugOf(label) {
    return String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
  /** a group heading: plain text, or (fold: true) a button that folds the entries under it; its count is drawn by CSS from data-count, so the heading's text stays the label */
  function groupHead(item) {
    var slug = slugOf(item.group);
    if (!item.fold) return '<div class="nav-group label" data-testid="skel-group-' + esc(slug) + '">' + esc(item.group) + '</div>';
    return (
      '<button type="button" class="nav-group nav-fold label" data-cbsid="CMP054-B02"' + frameMount() + ' data-testid="skel-group-' + esc(slug) + '" aria-expanded="' + (item.open === false ? 'false' : 'true') +
      '" aria-controls="navg-' + esc(slug) + '"' + (item.count != null ? ' data-count="' + esc(String(item.count)) + '"' : '') + '>' + esc(item.group) + '</button>'
    );
  }
  /** one left-menu entry: a button (an svg path `icon`, or a text `glyph` such as % or ₹), or a group heading when the entry is `{ group: 'label' }` */
  function navEntry(item, active, drawIcon) {
    if (item.group) return groupHead(item);
    var mark = item.glyph ? '<span class="lab-ico" aria-hidden="true">' + esc(item.glyph) + '</span>' : drawIcon(item.icon);
    return (
      '<button type="button" class="nav-btn' + (item.glyph ? ' nav-wrap' : '') + (item.k === active ? ' active' : '') + '" data-cbsid="CMP054-B01"' + frameMount() + ' data-sec="' + esc(item.k) + '" data-testid="skel-nav-' + esc(item.k) + '"' +
      (item.k === active ? ' aria-current="page"' : '') + ' aria-label="' + esc(item.label) + '">' + mark + '<span class="label">' + esc(item.label) + '</span></button>'
    );
  }
  /** the menu's html: entries in order; the entries under a folding heading sit in one panel that heading opens and closes */
  function navHTML(sections, active, drawIcon) {
    var html = '',
      panel = false;
    sections.forEach(function (item) {
      if (panel && item.group) {
        html += '</div>';
        panel = false;
      }
      html += navEntry(item, active, drawIcon);
      if (item.group && item.fold) {
        html += '<div class="nav-items" id="navg-' + esc(slugOf(item.group)) + '"' + (item.open === false ? ' hidden' : '') + '>';
        panel = true;
      }
    });
    return html + (panel ? '</div>' : '');
  }
  /** a folding heading was tapped: its panel opens or closes (kept in the page for this visit only) */
  function foldGroups(app) {
    Array.prototype.forEach.call(app.querySelectorAll('.nav-fold'), function (head) {
      head.onclick = function () {
        var open = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(open));
        var panel = app.querySelector('#' + head.getAttribute('aria-controls'));
        if (panel) panel.hidden = !open;
      };
    });
  }
  /** the phone's switch above the middle ("New | Your offers (N)"): sk.phone = { items: [{ k, label }], active, onPick(k) }; hidden above 760 by page-skeleton.css */
  function switchHTML(phone) {
    return (
      '<div class="lab-switch" role="tablist" data-testid="lab-switch">' +
      phone.items
        .map(function (item) {
          return (
            '<button type="button" role="tab" class="lab-switch-btn" data-cbsid="CMP054-K01"' + frameMount() + ' data-tab="' + esc(item.k) + '" data-testid="lab-switch-' + esc(item.k) + '" aria-selected="' + String(item.k === phone.active) + '">' +
            esc(item.label) + '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  /** a lab with a pinned shelf: at 760 and below the left panel is not drawn (no icons-only rail beside the switch); the shelf moves under the switch, and back to the top of the left panel */
  function dockPinned(app, pinned, phone) {
    var main = app.querySelector('.main');
    if (phone) main.insertBefore(pinned, app.querySelector('#screen'));
    else app.querySelector('#side').insertBefore(pinned, app.querySelector('#nav')); /* UX-117: the shop's own offers come first, above the kinds */
  }
  /** a lab's pinned shelf and phone switch: docks the shelf under the switch at 760 and below, and returns what the lab calls (pinned · setPhone · relabelPhone) */
  function wireLabPanel(app, options) {
    var pinned = app.querySelector('#sidePinned'),
      narrow = pinned && root.matchMedia && root.matchMedia('(max-width:760px)');
    if (narrow) {
      dockPinned(app, pinned, narrow.matches);
      if (narrow.addEventListener)
        narrow.addEventListener('change', function () {
          dockPinned(app, pinned, narrow.matches);
        });
    }
    /* the phone's tab on show: 'new' · 'yours' · '' (neither: an offer is open in the middle) */
    function setPhone(tabName) {
      app.setAttribute('data-tab', tabName || '');
      Array.prototype.forEach.call(app.querySelectorAll('.lab-switch-btn'), function (button) {
        button.setAttribute('aria-selected', String(button.getAttribute('data-tab') === tabName));
      });
    }
    function relabelPhone(tabName, label) {
      var button = app.querySelector('.lab-switch-btn[data-tab="' + tabName + '"]');
      if (button) button.textContent = label;
    }
    Array.prototype.forEach.call(app.querySelectorAll('.lab-switch-btn'), function (button) {
      button.onclick = function () {
        var tabName = button.getAttribute('data-tab');
        setPhone(tabName);
        if (options.phone.onPick) options.phone.onPick(tabName);
      };
    });
    if (options.phone) setPhone(options.phone.active);
    return { pinned: pinned, setPhone: setPhone, relabelPhone: relabelPhone };
  }
  function skeleton(doc, sk, appId) {
    var svg = function (d, cls) {
      return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" aria-hidden="true"><path d="' + esc(d) + '"/></svg>';
    };
    var app = doc.createElement('div');
    app.className = 'app';
    app.setAttribute('data-testid', 'skel-app');
    app.innerHTML =
      '<aside class="side" id="side" data-testid="skel-side"><div class="brand"><div class="logo">' +
      svg(sk.icon) +
      '</div><div class="brand-name label">' +
      esc(sk.name) +
      '</div></div>' +
      (sk.pinned ? '<div class="side-pinned" id="sidePinned" data-testid="skel-pinned" tabindex="0" role="region" aria-label="' + esc(sk.name) + '"></div>' : '') +
      '<nav class="nav" id="nav" aria-label="' +
      esc(sk.name) +
      '">' +
      navHTML(sk.sections || [], sk.active, svg) +
      '</nav>' +
      '<div class="side-foot"><button type="button" class="nav-btn" id="toggleNav" data-cbsid="CMP054-B03"' + frameMount() + ' aria-label="Collapse sidebar" aria-expanded="true">' +
      svg('M15 6l-6 6 6 6', 'nav-chev') +
      '<span class="label">Collapse</span></button></div></aside>' +
      '<main class="main" data-testid="skel-main"><div id="shell"></div>' + (sk.phone ? switchHTML(sk.phone) : '') + '<div class="screen flush" id="screen" data-testid="skel-screen"></div></main>';
    doc.documentElement.classList.add('cbsk');
    if (sk.pinned || sk.phone) doc.documentElement.classList.add('lab-v2');
    doc.body.insertBefore(app, doc.body.firstChild);
    var side = app.querySelector('#side'),
      node = app.querySelector('#toggleNav');
    function fit(collapsed) {
      side.classList.toggle('collapsed', collapsed);
      node.setAttribute('aria-expanded', String(!collapsed));
      node.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    }
    node.onclick = function () {
      fit(!side.classList.contains('collapsed'));
    };
    foldGroups(app);
    /* a lab with a pinned shelf keeps its words at tablet width: the shelf is on that panel, so it is not folded to a rail */
    var mq = !sk.pinned && root.matchMedia && root.matchMedia('(min-width:761px) and (max-width:1100px)');
    if (mq) {
      fit(mq.matches);
      if (mq.addEventListener)
        mq.addEventListener('change', function () {
          fit(mq.matches);
        });
    }
    var panel = wireLabPanel(app, sk);
    /* SCREEN-ID: the section on show is the screen the header chip names (app/screen-id.js, if the page loaded it) */
    function setActive(k) {
      Array.prototype.forEach.call(app.querySelectorAll('.nav-btn[data-sec]'), function (element) {
        element.classList.toggle('active', element.getAttribute('data-sec') === k);
      });
      if (root.CBScreenId) root.CBScreenId.here(appId, k);
      stampFrameMounts(app);
    }
    Array.prototype.forEach.call(app.querySelectorAll('.nav-btn[data-sec]'), function (element) {
      element.onclick = function () {
        var k = element.getAttribute('data-sec');
        setActive(k);
        if (sk.onSection) sk.onSection(k);
      };
    });
    return { host: app.querySelector('#shell'), screen: app.querySelector('#screen'), setActive: setActive, pinned: panel.pinned, setPhone: panel.setPhone, relabelPhone: panel.relabelPhone };
  }
  /** where the header is drawn: the skeleton's slot, the page's own element (host), else a div put first in the body */
  function headerHost(doc, opts, skel) {
    if (skel) return skel.host;
    if (opts.host) return opts.host;
    var host = doc.createElement('div');
    host.id = 'shell';
    doc.body.insertBefore(host, doc.body.firstChild);
    return host;
  }
  /** the avatar's door: a page with the sign-in window scrolls to it; a public page links to Home's; a page's own extras ride along */
  function avatarOptions(opts, host, open) {
    var base = open
      ? {
          onSignIn: function () {
            var node = host.querySelector('.cbsh-signin');
            if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center' });
          }
        }
      : { signInHref: opts.homeHref || '/' };
    Object.keys(opts.avatar || {}).forEach(function (key) {
      base[key] = opts.avatar[key];
    });
    return base;
  }
  /** the bar's person: the session's, with the page's level word (editor · view-only) when it has one */
  function personOf(sess, level) {
    var person = sess && root.CBAvatar ? root.CBAvatar.personOf(sess) : null;
    if (person && level) person.level = String(level);
    return person;
  }
  /* what CBShell.mount is told for this page. CL3: signin:false = a PUBLIC page (the Country lab) — it works signed out, so no sign-in window
     sits over it; the avatar's door is "Sign in", a link to Home's one sign-in window. area names the switcher's area when the page has no manifest entry (labs). */
  function shellOptions(opts, sess, skel, host, open) {
    return {
      host: opts.bar ? { bar: true, app: opts.app } : { app: opts.app },
      kural: skel ? false : opts.kural || false,
      homeHref: opts.homeHref || '/',
      area: opts.area,
      title: opts.title || null,
      manifest: opts.manifest, /* an object { entries:[] }: no manifest.json fetch (a page whose CSP has connect-src 'none') */
      anonymous: !!opts.anonymous,
      fonts: opts.fonts,
      fit: skel || opts.host ? 'pane' : undefined /* in a page's own pane the header is a block, never the full-window frame */,
      person: personOf(sess, opts.level),
      token: sess && sess.token,
      /* the one sign-in window, in the shell's own slot; signed in -> this page reads again with the session it now holds */
      signin: open
        ? {
            surface: opts.surface || opts.app,
            need: 'person',
            registerHref: opts.deepLink ? undefined : '/settings.html#/new', /* T3: a deep-link page (network, accounts, Settings) never shows the register door; Home still does for a new browser */
            onIn: function () {
              root.location.reload();
            }
          }
        : false /* false: no window at all, even where signin-ui.js is loaded */,
      avatar: avatarOptions(opts, host, open)
    };
  }
  /* mounts THE ONE HEADER (CBShell) for this page and hands it the page's work; every page goes through here (SHELL-ONE) */
  function mount(opts) {
    opts = opts || {};
    var sess = session(opts.anonymous),
      doc = root.document,
      skel = opts.skeleton ? skeleton(doc, opts.skeleton, opts.app) : null,
      host = headerHost(doc, opts, skel);
    var open = opts.signin !== false;
    var shell = root.CBShell.mount(host, shellOptions(opts, sess, skel, host, open));
    nameSection(skel, opts);
    if (skel && opts.kural && root.CBKural) {
      root.CBKural.mount();
      root.CBKural.set(opts.kural);
    } /* the one kural band at the FOOT, outside the head - as CB Finance / CRM / Accounts */
    if (opts.work && skel) skel.screen.appendChild(opts.work);
    else if (opts.work && shell && shell.slots && shell.slots.work) shell.slots.work.appendChild(opts.work);
    return { token: sess ? sess.token : null, session: sess, shell: shell, skeleton: skel };
  }
  /** a 401 from the API: the session is no longer good - drop it and show the sign-in window (it is the same window the apps show) */
  function ended() {
    try {
      root.localStorage.removeItem('cb_sess');
    } catch (_) {}
    root.location.reload();
  }
  /* UX-90: every lab wears the Finance frame - the standard skeleton (sidebar + main pane), the left menu is THIS lab's own choices (W16; the other labs are the shell's top switcher, fed by manifest.json), one background.
     CBFrame.lab({ app: 'conversion-lab', name: 'Conversion Lab', icon: '⇅', sections?, active?, onSection?, work?, kural?, pinned?, phone? }).
     avatar: extra CBAvatar options for the page that must own its person, look or language (the UI standard page: a preview person, its own language list); left out, the frame's avatar is the session's.
     sections: { group: 'Heading', fold: true, count: 3, open: false } makes a heading that folds the entries under it (open by default; count is drawn beside it).
     pinned: true draws a shelf above the menu (UX-117, the lab's own things come first; framed.skeleton.pinned is the element the lab fills: its own things, grouped by status, with CBLabKit.more).
     phone: { items: [{ k, label }], active, onPick(k) } (a lab with a pinned shelf): at 760 and below the left panel is not drawn, a switch above the middle takes its place;
     framed.skeleton.setPhone(k) lights a tab, relabelPhone(k, text) re-words one.
     A lab with no `work` element has its page body moved into the main pane once the page has loaded (scripts and styles stay where they are). */
  var LAB_ICON = 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3';
  function adoptBody(doc, screen) {
    var work = doc.createElement('div');
    work.className = 'lab-work';
    work.id = 'labwork';
    Array.prototype.slice.call(doc.body.children).forEach(function (node) {
      if (/^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(node.tagName) || node.classList.contains('app') || node.id === 'shell') return;
      work.appendChild(node);
    });
    screen.appendChild(work);
  }
  function labFrame(opts) {
    var doc = root.document,
      oldShell = doc.getElementById('shell');
    if (oldShell && !oldShell.closest('.app')) oldShell.remove(); /* the page's bar host: the skeleton draws the one header in its own */
    var framed = mount({
      app: opts.app,
      area: 'labs',
      signin: false,
      kural: opts.kural,
      title: { icon: opts.icon, name: opts.name },
      avatar: opts.avatar,
      work: opts.work,
      skeleton: {
        name: opts.name,
        icon: opts.svg || LAB_ICON,
        sections: opts.sections || [],
        active: opts.active,
        onSection: opts.onSection,
        pinned: opts.pinned,
        phone: opts.phone
      }
    });
    if (!opts.work) {
      var adopt = function () {
        adoptBody(doc, framed.skeleton.screen);
      };
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', adopt);
      else adopt();
    }
    return framed;
  }
  root.CBFrame = { mount: mount, lab: labFrame, session: session, ended: ended };
})(typeof window !== 'undefined' ? window : globalThis);
