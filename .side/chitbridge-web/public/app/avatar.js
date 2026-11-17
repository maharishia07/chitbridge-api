/**
 * OWNS      the one avatar button and its menu (mount · paint · menuHtml · editionsHtml · signOut), and the person's look: theme, reading font, text size,
 *            weight, motion and stripes (apply · themeApply · fontApply · sizeApply), kept on the device and synced to the server (hydrate · pull · push).
 * CALLED BY app/shell.js (the frame mounts the one avatar), app/page-frame.js (its options), till.html; the pages read CBAvatar.shopCountry / applyTheme.
 * FLOW  mount(slot) → session → the button and its menu → applyTheme → the one /me read → `cb:me` announced to the page
 * IDS   every control carries its register code (data-cbsid, UX-137): the shared component codes CMP025 (choice) · CMP033 (menu item) · CMP048 (account menu) · CMP052 (sign in).
 * CARD 29-qa-test-tooling-ux-locale-and-design-system/avatar
 * ── ⭐⭐⭐ CBAvatar — THE AVATAR: ONE CONTROL ON EVERY CHITBRIDGE PAGE ──────────────────────────────────────────────
 *
 * Athi, 2026-10-02: *"Avatar should be a single control used across everywhere … no repeat … it is already that way only and
 * can be reused"* · *"this avatar is much simpler and no text, that is really good, i want to retain it that way"*
 * (DECISIONS.md › "The avatar is ONE control"). The app's avatar behaviour MOVED here from app.html (theme apply, reading font,
 * text size, motion, the person's appearance synced to the server — b166); the LOOK is the frozen simple one
 * (docs/design/list-standard/index.html: avPop / applyAppearance).
 *
 *   CBAvatar.mount(el, { person, items, onSignOut, … })   draw the button and its menu into `el`
 *   CBAvatar.apply()                                       put the saved look on <html> (runs at load, BEFORE first paint)
 *   CBAvatar.hydrate(prefs)                                the server's per-person appearance — the truth; absent = default unless pending (true if something changed)
 *   CBAvatar.set(kind, value)                              kind: theme · font · fs · weight · motion · stripes · edition — saves, applies, syncs
 *   CBAvatar.get() · .themeKey() · .close() · .signOut() · .THEMES · .FONTS · .TEXT_SIZES · .FS_BASE
 *   CBAvatar.shopCountry()                                 the shop's country from the one /me read (null until it lands); `cb:me` on document announces it — STD-COMPARE
 *
 * ⭐ ONE FILE, ONE GLOBAL, NO IMPORTS, NO BUILD STEP, NO NETWORK NEEDED — so the counter can load it as it loads /engine/screen.js.
 *    The look applies from local storage alone; the server sync is optional and silent when offline. `person` is an INPUT
 *    ({ name, role, entity, owner }) — the app session, or the counter's signed-in cashier — never read from a page global.
 *
 * ⭐ THEMES ARE NOT HERE. They are the engine's (screen v1.15.0 `CBScreen.APP_THEMES`, 16 with Terminal) — load /engine/screen.js
 *    first. This file only APPLIES one: it writes the theme's tokens on <html> (`removeProperty` first, so leaving a theme leaves
 *    nothing behind), stamps `data-theme`, and sets `color-scheme`. A theme with `font:'mono'` (Terminal) gives the page the
 *    monospace face unless the person chose a reading font.
 *
 * ⭐ THE KEYS NEVER CHANGE (a stored value is not free to rename): cb_theme · cb_font · cb_fs (s/m/l/xl) · cb_motion
 *    (auto/reduce/full) — and the new cb_weight (normal/bold). cb_theme may also hold `device` ("My device": the operating
 *    system's light/dark decides, once, at load — an explicit choice always wins over the OS).
 *
 * ⭐ TEXT SIZE MULTIPLIES THE EIGHT --fs TOKENS (FS_BASE), never `zoom` and never one flat size: a caption stays smaller than a
 *    heading. The base is the page's OWN value (read once from its stylesheet — CB Accounts keeps 12 / 13.5 / 15), falling back to
 *    FS_BASE. `--k` (the multiplier) is set too, for the list control, whose sizes are calc(Npx * var(--k,1)).
 *
 * ⭐ BOLD: regular text goes to 600 and what was already bold stays the strongest (like the phones' "Bold text"). Italic: no.
 *
 * ⭐ THE SERVER KEEPS ALL SEVEN (routes/entities.js › ui.keys): theme · fs · motion · stripes · edition (AX1) · font · weight. Reading font
 *    and bold were on this machine only until CU3 widened that list — a setting that looks saved and is not was the defect.
 */
(function (root) {
  'use strict';
  if (root.CBAvatar) return;
  var doc = root.document;
  var K = root.CBScreen || {};
  var THEMES = K.APP_THEMES || {};
  var has = function (o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  };
  /* H34 (Athi's black-box, 2026-10-09): a utility page never sends a customer into the workshop (app.html). UX-96 (NAV-MAP §6 item 10, 2026-10-19):
     Profile opens Settings › Your business, the owner has Settings on every page, and Support is NOT drawn until a support page exists (it used to
     loop to Home) — a page that has one passes onSupport or supportHref and the item appears. A page's own handler or href still wins; the workshop passes its own. */
  var PROFILE_HREF = '/settings.html#/shop',
    SETTINGS_HREF = '/settings.html';
  /* ── the facts (moved from app.html: FS_BASE · TEXT_SIZES · FONTS) ── */
  var FS_BASE = { '--fs-1': 11, '--fs-2': 12.5, '--fs-3': 14, '--fs-4': 16, '--fs-5': 20, '--fs-6': 28, '--fs-7': 36, '--fs-8': 46 };
  var TEXT_SIZES = [
    ['s', 'Small', 0.92],
    ['m', 'Medium', 1],
    ['l', 'Large', 1.15],
    ['xl', 'Extra large', 1.32]
  ];
  var FONTS = [
    ['default', 'Default', 'Inter,system-ui,sans-serif', 'the product’s own face'],
    ['grotesk', 'Grotesk', "'Space Grotesk',Inter,sans-serif", 'larger apertures'],
    ['serif', 'Serif', "Georgia,'Times New Roman',serif", 'serifs guide the line'],
    ['wide', 'Wide', 'Verdana,Tahoma,sans-serif', 'wide letterforms · low vision'],
    ['mono', 'Monospace', "'Space Mono',ui-monospace,monospace", 'every character the same width']
  ];
  var MONO = FONTS[4][2];
  /* edition (AX1): which showing of Home this person sees (public/app/edition.js reads it; the list is the manifest's `editions`) — kept and synced like text size */
  var KEY = {
    theme: 'cb_theme',
    font: 'cb_font',
    fs: 'cb_fs',
    weight: 'cb_weight',
    motion: 'cb_motion',
    stripes: 'cb_stripes',
    edition: 'cb_edition',
    kural: 'cb_kural',
    keys: 'cb_keys'
  };
  var DEFAULTS = { theme: 'cream' /* L16-M7: ONE look from sign-in to the app; 'My device' stays a choice */, font: 'default', fs: 'm', weight: 'normal', motion: 'auto', stripes: 'strong', edition: 'full', kural: 'auto', keys: 'on' };
  var DEVICE_ONLY = ['keys']; /* held on this device: the server's ui.keys list has no 'keys' yet, so hydrate and push leave it alone */
  /* SET-WALK1 · W7: the Thirukkural band — auto (on only where the shop reads Tamil: CBLocale.langs has 'ta') · on · off; the owner's choice, synced like the rest */
  var KURAL = [
    ['auto', 'Where Tamil is read'],
    ['on', 'On'],
    ['off', 'Off']
  ];
  var EDITION = /^[a-z][a-z0-9-]{0,23}$/;
  var STRIPES = [
    ['off', 'Off'],
    ['light', 'Light'],
    ['strong', 'Strong']
  ]; /* row stripes (Excel's banded rows): Strong is the default and the list unit's own 9%; Light 5%; Off none */
  function lsGet(k, d) {
    try {
      return root.localStorage.getItem(k) || d;
    } catch (_) {
      return d;
    }
  }
  function lsSet(k, v) {
    try {
      root.localStorage.setItem(k, v);
    } catch (_) {}
  }
  function lsDel(k) {
    try {
      root.localStorage.removeItem(k);
    } catch (_) {}
  }
  /* ── what is saved ── */
  /* FIXED LOOK (the UI standard page, public/ui-standard.html): a page whose <html> carries data-appearance-fixed takes its look from CBAvatar.applyWith(), never from
     storage, and nothing here saves, pushes or reads cb_sess for it. OVERRIDE is null on every other page, so nothing changes there. */
  var OVERRIDE = doc && doc.documentElement && typeof doc.documentElement.hasAttribute === 'function' && doc.documentElement.hasAttribute('data-appearance-fixed') ? {} : null;
  function pref(kind) {
    if (OVERRIDE) return has(OVERRIDE, kind) ? OVERRIDE[kind] : DEFAULTS[kind];
    return lsGet(KEY[kind], DEFAULTS[kind]);
  }
  /** apply a look given as { theme, font, fs, weight, motion } without reading or writing storage (only on a fixed-look page) */
  function applyWith(look) {
    if (!OVERRIDE) return false;
    Object.keys(look || {}).forEach(function (kind) {
      OVERRIDE[kind] = look[kind];
    });
    BASE = null;
    apply();
    return true;
  }
  function get() {
    return {
      theme: pref('theme'),
      font: pref('font'),
      fs: pref('fs'),
      weight: pref('weight'),
      motion: pref('motion'),
      stripes: pref('stripes'),
      edition: pref('edition'),
      kural: pref('kural'),
      keys: pref('keys')
    };
  }
  /** The theme that is actually on the page. `device` (or nothing saved) asks the operating system ONCE, at load, and is not live. */
  function themeKey() {
    /* TOUR-FIX1: a page that loads the theme library AFTER this file (the till: avatar.js, then /engine/screen.js) took an empty table here and
       answered Cream for every saved theme — the library is read again the first time it is there */
    if (!Object.keys(THEMES).length && root.CBScreen && root.CBScreen.APP_THEMES) {
      K = root.CBScreen;
      THEMES = K.APP_THEMES;
    }
    var p = pref('theme');
    if (p !== 'device' && has(THEMES, p) && THEMES[p]) return p;
    if (p !== 'device') return 'cream'; /* a stale or unknown saved name never stamps itself on <html> */
    try {
      if (root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches && has(THEMES, 'dark')) return 'dark';
    } catch (_) {}
    return 'cream';
  }

  /* ── applying ── */
  /* ON-COLOURS (INT7b-GREEN, 2026-10-15): the ink that reads on a theme's accent and on its ok green. A theme that names the colour but not its
     on-colour gets it from the engine's ONE calculation (CBScreen.onColour, screen.js — never a second luminance sum here): Dark's --blue #6892DB
     and --ok #2E9E5E took the pages' own white at 3.1:1 (the storefront's logo, + and the frame's mark). A theme's own --on-accent / --on-ok wins;
     under a theme the pages' accent IS --blue (page-skeleton.css, shop.html). */
  var ON_COLOUR_PAIRS = [
    ['--on-accent', ['--accent', '--blue']],
    ['--on-ok', ['--ok']]
  ];
  function onColoursOf(vars) {
    var derived = {},
      onColour = root.CBScreen && root.CBScreen.onColour;
    if (typeof onColour !== 'function') return derived;
    ON_COLOUR_PAIRS.forEach(function (pair) {
      var onToken = pair[0],
        baseToken = pair[1].filter(function (token) {
          return vars[token];
        })[0];
      if (baseToken && !vars[onToken]) derived[onToken] = onColour(vars[baseToken]);
    });
    return derived;
  }
  /** Apply a theme to the page. With a key it is a PREVIEW (nothing saved) — what Settings' contrast check and the palette cards use. */
  function themeApply(forKey) {
    var node = doc.documentElement,
      key = forKey && has(THEMES, forKey) && THEMES[forKey] ? forKey : themeKey(),
      t = THEMES[key] || { vars: {} };
    var all = {};
    Object.keys(THEMES).forEach(function (item) {
      Object.keys(THEMES[item].vars || {}).forEach(function (entry) {
        all[entry] = 1;
      });
    });
    ON_COLOUR_PAIRS.forEach(function (pair) {
      all[pair[0]] = 1;
    });
    Object.keys(all).forEach(function (item) {
      node.style.removeProperty(item);
    });
    var vars = t.vars || {},
      derived = onColoursOf(vars);
    Object.keys(vars).forEach(function (token) {
      node.style.setProperty(token, vars[token]);
    });
    Object.keys(derived).forEach(function (token) {
      node.style.setProperty(token, derived[token]);
    });
    node.style.colorScheme = t.scheme || 'light'; /* the caret, scrollbars, autofill and date picker are drawn by the browser */
    node.setAttribute('data-theme', key);
    if (Object.keys(t.vars || {}).length) node.setAttribute('data-themed', key);
    else node.removeAttribute('data-themed'); /* a page's own names key off THIS: Cream overrides nothing */
  }
  function fontStack(k) {
    var row =
      FONTS.filter(function (item) {
        return item[0] === k;
      })[0] || FONTS[0];
    return row[2];
  }
  function fontApply() {
    var node = doc.documentElement,
      fk = pref('font'),
      t = THEMES[themeKey()] || {},
      stack = null;
    if (fk !== 'default') stack = fontStack(fk);
    else if (t.font === 'mono') stack = MONO; /* Terminal's own face, unless the person chose one */
    /* two names, because the pages use two: the app's --font-ui and the list standard's --f-ui */
    ['--font-ui', '--f-ui'].forEach(function (item) {
      if (stack) node.style.setProperty(item, stack);
      else node.style.removeProperty(item);
    });
  }
  var BASE = null;
  function fsBase() {
    if (BASE && BASE.ready) return BASE;
    var b = { ready: false },
      node = doc.documentElement,
      cs = null,
      count = 0,
      saved = {};
    try {
      cs = root.getComputedStyle(node);
    } catch (_) {}
    Object.keys(FS_BASE).forEach(function (item) {
      saved[item] = node.style.getPropertyValue(item);
      if (saved[item]) node.style.removeProperty(item);
    });
    /* ⚠️ a page may declare its tokens in rem/em (testing.html: --fs-1:0.8125rem). parseFloat alone read that as 0.8 px, so
       any text size but Medium drew the whole page at ~1 px (Athi, 2026-10-07). Convert to px against the root's own size. */
    var remPx = 16;
    try {
      remPx = parseFloat(root.getComputedStyle(node).fontSize) || 16;
    } catch (_) {}
    Object.keys(FS_BASE).forEach(function (item) {
      var raw = cs ? String(cs.getPropertyValue(item)).trim() : '',
        v = parseFloat(raw);
      if (/r?em$/i.test(raw)) v = v * remPx;
      else if (raw && !/px$/i.test(raw)) v = NaN; /* %, calc(), vw …: fall back to FS_BASE */
      if (v > 0) {
        b[item] = v;
        count++;
      } else b[item] = FS_BASE[item];
    });
    Object.keys(saved).forEach(function (item) {
      if (saved[item]) node.style.setProperty(item, saved[item]);
    });
    b.ready = count === Object.keys(FS_BASE).length; /* the stylesheet was not parsed yet: ask again next time */
    BASE = b;
    return b;
  }
  function sizeApply() {
    var node = doc.documentElement,
      row =
        TEXT_SIZES.filter(function (x) {
          return x[0] === pref('fs');
        })[0] || TEXT_SIZES[1],
      b = fsBase();
    Object.keys(FS_BASE).forEach(function (item) {
      if (row[2] === 1) node.style.removeProperty(item);
      else node.style.setProperty(item, Math.round(b[item] * row[2] * 10) / 10 + 'px');
    });
    if (row[2] === 1) node.style.removeProperty('--k');
    else node.style.setProperty('--k', String(row[2]));
  }
  function weightApply() {
    var node = doc.documentElement;
    if (pref('weight') === 'bold') node.setAttribute('data-weight', 'bold');
    else node.removeAttribute('data-weight');
  }
  function motionApply() {
    var node = doc.documentElement,
      m = pref('motion');
    /* ⚠️ an unrecognised saved value means "follow the device", never a stamp no rule matches (the health setting must not fail open) */
    if (m === 'reduce' || m === 'full') node.setAttribute('data-motion', m);
    else node.removeAttribute('data-motion');
  }
  /** the ONE zebra token: the stamp picks --zebra (CSS below); Strong is no stamp, the unit's own fallback */
  function stripesApply() {
    var node = doc.documentElement,
      s = pref('stripes');
    if (s === 'off' || s === 'light') node.setAttribute('data-stripes', s);
    else node.removeAttribute('data-stripes');
  }
  function apply() {
    if (!doc || !doc.documentElement) return;
    try {
      themeApply();
      fontApply();
      sizeApply();
      weightApply();
      motionApply();
      stripesApply();
    } catch (_) {}
    /* W7: the band reads the pref itself (CBKural.repaint); told here so a change shows at once */
    try {
      if (root.CBKural && root.CBKural.repaint) root.CBKural.repaint();
    } catch (e) {
      console.warn('avatar: the kural band did not repaint', (e && e.message) || e);
    }
  }

  /* ── the person's appearance follows them (b166) — silent when there is nothing to reach ── */
  var pushTimer = null;
  function apiBaseOf(o) {
    if (o && o.apiBase) return o.apiBase;
    try {
      if (typeof CFG !== 'undefined' && CFG && CFG.API_BASE) return CFG.API_BASE;
    } catch (_) {}
    return '';
  }
  function tokenOf(o) {
    if (o && o.token) return o.token;
    try {
      var parsed = JSON.parse(root.localStorage.getItem('cb_sess') || 'null');
      return (parsed && parsed.token) || '';
    } catch (_) {
      return '';
    }
  }
  var HOST = {}; /* what the mounted page told us (apiBase · token · sync) */
  /* ⭐ F9 (FX-UX2): THE PENDING MARK. A choice made on this device is held in cb_prefs_pending ({ kind: value }) until a push the server
     answers ok:true carries it; hydrate never resets a marked kind (offline, signed out, before the column exists — the push answers
     {pending:true} or {queued:true}, never ok:true). A mark whose value the server already holds was landed: it goes. */
  var PEND = 'cb_prefs_pending';
  function pendGet() {
    try {
      var parsed = JSON.parse(root.localStorage.getItem(PEND) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  function pendPut(o) {
    try {
      if (Object.keys(o).length) root.localStorage.setItem(PEND, JSON.stringify(o));
      else root.localStorage.removeItem(PEND);
    } catch (_) {}
  }
  function pendMark(kind) {
    var o = pendGet();
    o[kind] = pref(kind);
    pendPut(o);
  }
  /** a push landed: every kind it carried whose mark still holds the value sent is no longer pending */
  function landed(sent, r) {
    if (!r || r.ok !== true || r.pending) return;
    var o = pendGet();
    Object.keys(o).forEach(function (item) {
      if (has(sent, item) && sent[item] === o[item]) delete o[item];
    });
    pendPut(o);
  }
  function push(now) {
    if (HOST.sync === false) return;
    var body = {
      theme: pref('theme'),
      fs: pref('fs'),
      motion: pref('motion'),
      stripes: pref('stripes'),
      edition: pref('edition'),
      font: pref('font'),
      weight: pref('weight'),
      kural: pref('kural')
    }; /* every synced key rides every push */
    /* the app's (and CB Accounts') own door: CBPrefs debounces, queues offline and stays silent before the migration; its answer clears the mark */
    /* …except a push that must outlive this page (an edition reloads at once): CBPrefs's 400 ms debounce would die with the page, so it is sent now, kept alive (FX-QA1) */
    try {
      if (!now && typeof CBPrefs !== 'undefined' && typeof SESSION !== 'undefined' && SESSION && SESSION.token) {
        CBPrefs.push('ui', body, function (r) {
          landed(body, r);
        });
        return;
      }
    } catch (_) {}
    var base = apiBaseOf(HOST),
      tok = tokenOf(HOST);
    if (!base || !tok || !root.fetch) return;
    if (pushTimer) {
      try {
        root.clearTimeout(pushTimer);
      } catch (_) {}
    }
    var send = function (keep) {
      try {
        return root
          .fetch(base + '/api/entities/me/prefs/ui', {
            method: 'PATCH',
            cache: 'no-store',
            keepalive: !!keep,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
            body: JSON.stringify(body)
          })
          .then(function (reply) {
            return reply.ok ? reply.json() : null;
          })
          .then(function (reply) {
            landed(body, reply);
          })
          .catch(function () {});
      } catch (_) {
        return null;
      }
    };
    if (now) return send(true); /* the page redraws at once (an edition): sent now, and kept alive across the reload */
    pushTimer = root.setTimeout(function () {
      send(false);
    }, 400);
  }
  /** the one test of a value for a kind — set() and hydrate() ask the same question */
  function valid(kind, v) {
    if (kind === 'theme') return v === 'device' || (has(THEMES, v) && !!THEMES[v]);
    if (kind === 'fs')
      return TEXT_SIZES.some(function (x) {
        return x[0] === v;
      });
    if (kind === 'font')
      return FONTS.some(function (x) {
        return x[0] === v;
      });
    if (kind === 'weight') return v === 'normal' || v === 'bold';
    if (kind === 'motion') return ['auto', 'reduce', 'full'].indexOf(v) >= 0;
    if (kind === 'stripes')
      return STRIPES.some(function (x) {
        return x[0] === v;
      });
    if (kind === 'keys') return v === 'on' || v === 'off';
    if (kind === 'edition') return EDITION.test(String(v));
    if (kind === 'kural')
      return KURAL.some(function (x) {
        return x[0] === v;
      });
    return false;
  }
  /**
   * The server's ui_prefs is the truth for a signed-in person (every kind is pushed since CU3) — ONE rule for all seven kinds (F9, FX-UX2):
   *   · the server holds a value → this device takes it;
   *   · the server holds none (absent / null / '') → this device goes back to the DEFAULT (an edition cleared on the server no longer
   *     leaves "Auditor view" on the machine) — EXCEPT a kind still marked pending (a choice whose push has not landed): kept, and pushed again.
   * A showing link (cb_edition_tab) keeps its tab: CBEdition reads the tab first, and editionReload does not redraw a held tab.
   */
  function hydrate(prefs) {
    if (!prefs || typeof prefs !== 'object') return false;
    var changed = false,
      edNow = pref('edition'),
      pend = pendGet(),
      again = false;
    try {
      Object.keys(KEY).forEach(function (item) {
        if (DEVICE_ONLY.indexOf(item) >= 0) return;
        var v = prefs[item],
          held = v != null && v !== '';
        if (has(pend, item)) {
          if (held && String(v) === pend[item]) {
            delete pend[item];
            pendPut(pend);
          } else again = true;
          return;
        }
        if (held) {
          if (valid(item, v) && v !== pref(item)) {
            lsSet(KEY[item], v);
            changed = true;
          }
          return;
        }
        if (pref(item) !== DEFAULTS[item]) {
          lsDel(KEY[item]);
          changed = true;
        }
      });
      if (changed) {
        apply();
        repaint();
      }
      if (pref('edition') !== edNow) editionReload(); /* this person's saved showing differs from what this machine drew: draw it again */
      if (again) push(); /* the choice that never landed goes up now */
    } catch (_) {}
    return changed;
  }
  function pull(o) {
    var base = apiBaseOf(o),
      tok = tokenOf(o);
    if (!base || !tok || !root.fetch) return;
    try {
      root
        .fetch(base + '/api/entities/me', { cache: 'no-store', headers: { Authorization: 'Bearer ' + tok } })
        .then(function (reply) {
          /* WALK-REG 2026-10-16 R1: ONLY the server's definite "no such identity" (404/401) ends the local session; a network failure or 5xx
             leaves it (the counter works offline). The page that asked (o.onGone) says why and shows the sign-in. */
          if ((reply.status === 404 || reply.status === 401) && typeof o.onGone === 'function') {
            forget();
            o.onGone(reply.status);
            return null;
          }
          return reply.ok ? reply.json() : null;
        })
        .then(function (reply) {
          if (!reply) return;
          var d = (reply && reply.data) || reply,
            e = (d && d.entity) || d || {};
          hydrate(e.ui_prefs);
          /* FX-UX1 (F6): the same row carries the person's locale choice and the shop's country — handed to the locale engine the way app.html's boot
             does (app.html CBLocale.hydrate), so number · date · grouping follow the shop's country (REGIONS[country] = the pack's locale) on every
             page, not en-IN by default. One read for both; a page with pull:false hydrates itself. */
          try {
            if (root.CBLocale && root.CBLocale.hydrate) root.CBLocale.hydrate(e.locale_prefs || {}, { country: e.country || null });
          } catch (_) {}
          announceShop(e);
        })
        .catch(function () {});
    } catch (_) {}
  }
  /* STD-COMPARE (2026-10-15): the SAME /me read tells the page the shop's country — `cb:me` on document, { country } — so a page that reads no API of its
     own (the Standards page's Compared with tab opens on the shop's country) asks here, never a second /me. shopCountry() answers a late reader. */
  var SHOP_COUNTRY = null,
    SHOP_LEDGER_ON; /* l16 firmhome: /me's ledger_on (true | false); null = /me answered without it; undefined = /me not answered yet. Home asks GET /books/health only when it is not true/false */
  function announceShop(entity) {
    SHOP_COUNTRY = entity && entity.country ? String(entity.country).toUpperCase() : null;
    SHOP_LEDGER_ON = entity && typeof entity.ledger_on === 'boolean' ? entity.ledger_on : null;
    try {
      root.document.dispatchEvent(new CustomEvent('cb:me', { detail: { country: SHOP_COUNTRY, ledger_on: SHOP_LEDGER_ON } }));
    } catch (e) {
      if (root.console) root.console.warn('avatar: cb:me not announced', e);
    }
  }
  function shopCountry() {
    return SHOP_COUNTRY;
  }
  function ledgerOn() {
    return SHOP_LEDGER_ON;
  }

  function set(kind, value) {
    if (!has(KEY, kind) || !valid(kind, value)) return;
    if (OVERRIDE) return setFixed(kind, value);
    lsSet(KEY[kind], value);
    if (DEVICE_ONLY.indexOf(kind) < 0) pendMark(kind); /* held against a server reset until a push lands (F9) */
    apply();
    if (kind === 'keys' && root.CBShortcuts) root.CBShortcuts.stamp(); /* the rail and cards say their keys only while the switch is on */
    if (kind === 'edition') {
      push(true);
      if (root.CBEdition) root.CBEdition.clearTab();
      return editionReload(true);
    } /* the person's own choice outranks a showing link */
    push(); /* every kind reaches the server since CU3 (font · weight were device-only) */
    repaint();
  }
  /** a pick on a fixed-look page (the UI standard page): the look is applied and the host told, but nothing is saved, held, pushed or reloaded */
  function setFixed(kind, value) {
    OVERRIDE[kind] = value;
    BASE = null;
    apply();
    repaint();
    if (M && M.o && typeof M.o.onLook === 'function') M.o.onLook(kind, value);
  }
  /** an edition decides what a page DRAWS, so a new one is a fresh draw — without the ?edition= that would win over the choice just made */
  function editionReload(force) {
    try {
      if (!force && root.sessionStorage.getItem('cb_edition_tab')) return; /* a showing link holds this tab: nothing to redraw */
      var u = new URL(root.location.href);
      u.searchParams.delete('edition');
      if (u.href === root.location.href) root.location.reload();
      else root.location.replace(u.href);
    } catch (_) {}
  }

  /* ── the menu ── */
  var CSS =
    '.cbav{position:relative;display:inline-block;font-family:var(--f-ui,var(--font-ui,inherit));' +
    '--av-card:var(--card,#fff);--av-ink:var(--on-card,var(--ink,#1D1B16));--av-muted:var(--muted,var(--grey,#5E594D));' +
    '--av-faint:var(--faint,var(--grey,#5E594D));--av-line:var(--line,#DDD6C6);--av-soft:var(--line-soft,var(--line,#E6E0D2));' +
    '--av-page:var(--page,var(--paper,#FCFAF5));--av-panel:var(--panel,#F3EFE6);--av-blue:var(--blue,#2F74C9);' +
    '--av-blue-t:var(--blue-t,var(--blue-tint-bg,#E4EEFA));--av-blue-i:var(--blue-i,var(--blue-d,#174A87));' +
    '--av-shadow:var(--shadow,0 10px 28px rgba(0,0,0,.16));color:var(--av-ink);text-align:start}' +
    '.cbav *{box-sizing:border-box}' +
    '.cbav button,.cbav a{font:inherit;color:inherit;cursor:pointer}' +
    '.cbav-btn{width:34px;height:34px;border-radius:50%;border:1px solid var(--av-line);background:var(--av-card);color:var(--av-ink);font-weight:700;display:grid;place-items:center;padding:0;font-size:calc(14px * var(--k,1))}' +
    '.cbav-btn[aria-expanded="true"]{outline:2px solid var(--av-blue);outline-offset:1px}' +
    /* ⚠️ `.cbav .cbav-signin`, not `.cbav-signin` (CL2, 2026-10-13): `.cbav a{color:inherit}` above is MORE specific than a lone class, so the door's
       white label lost to the page's ink — #20303b on the green, 2.02:1, on every lab page a signed-out owner opened (measured by e2e/walk-country-lab.cjs C1) */
    /* CL3: a list-token page under Dark re-points --green at the theme's --ok (#2E9E5E) — white on it is 3.4:1. The door's ground is the green
       taken 28% toward black, so the white label is AA in every theme (Cream 9:1, Dark 5.8:1) and Cream's door is still green. */
    '.cbav .cbav-signin{display:inline-flex;align-items:center;height:34px;padding:0 15px;border-radius:9px;background:color-mix(in srgb,var(--green,#16693F) 72%,var(--av-shade,#000));color:#fff;font-size:calc(13.5px * var(--k,1));font-weight:700;text-decoration:none}' +
    'button.cbav-signin{border:0;cursor:pointer;font-family:inherit}' +
    '.cbav-pop{position:absolute;inset-inline-end:0;top:calc(100% + 6px);z-index:1000;width:min(344px,calc(100vw - 32px));max-height:calc(100vh - 64px);overflow-y:auto;overscroll-behavior:contain;' +
    'padding:12px 14px;background:var(--av-card);color:var(--av-ink);border:1px solid var(--av-line);border-radius:12px;box-shadow:var(--av-shadow);font-size:calc(14px * var(--k,1));line-height:1.35}' +
    '.cbav-who{display:flex;gap:10px;align-items:center;padding-bottom:10px;border-bottom:1px solid var(--av-soft)}' +
    '.cbav-who .l{width:40px;height:40px;border-radius:50%;border:1px solid var(--av-line);background:var(--av-panel);display:grid;place-items:center;font-weight:700;font-size:calc(16px * var(--k,1));flex:0 0 auto}' +
    '.cbav-who b{display:block;font-size:calc(14.5px * var(--k,1));overflow-wrap:anywhere}.cbav-who span{display:block;font-size:calc(12.5px * var(--k,1));color:var(--av-faint)}' +
    '.cbav-items{display:grid;gap:1px;padding:6px 0;border-bottom:1px solid var(--av-soft)}' +
    '.cbav-items.last{border-bottom:0;border-top:1px solid var(--av-soft);margin-top:8px}' +
    '.cbav-items button,.cbav-items a{display:flex;justify-content:space-between;align-items:center;text-align:start;border:0;background:none;border-radius:7px;padding:7px 8px;text-decoration:none;font-size:calc(14px * var(--k,1))}' +
    '.cbav-items button:hover,.cbav-items a:hover{background:var(--av-panel)}' +
    '.cbav h4{clear:left;margin:10px 0 6px;font-size:calc(11px * var(--k,1));letter-spacing:.07em;text-transform:uppercase;color:var(--av-faint);font-weight:700}' +
    '.cbav-sw{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:4px 0 8px}' +
    '.cbav-sw button{display:grid;gap:3px;justify-items:center;border:1px solid transparent;background:none;border-radius:9px;padding:4px 2px;font-size:calc(10.5px * var(--k,1));color:var(--av-muted);line-height:1.15;text-align:center}' +
    '.cbav-sw .dot{width:28px;height:28px;border-radius:50%;border:1px solid var(--av-line);display:grid;grid-template-rows:1fr 1fr;overflow:hidden}' +
    '.cbav-sw button[aria-pressed="true"]{border-color:var(--av-blue);background:var(--av-blue-t);color:var(--av-blue-i);font-weight:600}' +
    '.cbav-sizes{display:flex;gap:4px;align-items:flex-end;margin:2px 0 6px}' +
    '.cbav-sizes button,.cbav-weights button{flex:1;border:1px solid var(--av-line);background:var(--av-card);border-radius:9px;display:grid;place-items:center;color:var(--av-ink);padding:0;font-family:inherit}' +
    '.cbav-sizes button{height:42px}.cbav-weights{display:flex;gap:4px;margin:0 0 8px}.cbav-weights button{height:36px;font-size:17px}' +
    '.cbav-sizes button[aria-pressed="true"],.cbav-weights button[aria-pressed="true"]{border-color:var(--av-blue);background:var(--av-blue-t);color:var(--av-blue-i)}' +
    '.cbav-motion{display:flex;float:left;box-sizing:border-box;width:50%;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px}' +
    '.cbav-toggle{width:40px;height:22px;border-radius:999px;border:1px solid var(--av-line);background:var(--av-panel);position:relative;padding:0}' +
    '.cbav-toggle::after{content:"";position:absolute;top:2px;inset-inline-start:2px;width:16px;height:16px;border-radius:50%;background:var(--av-faint);transition:inset-inline-start .15s}' +
    '.cbav-toggle[aria-checked="true"]{background:var(--av-blue-t);border-color:var(--av-blue)}' +
    '.cbav-toggle[aria-checked="true"]::after{inset-inline-start:20px;background:var(--av-blue)}' +
    '.cbav-fonts{display:grid;gap:2px}' +
    /* the menu NEVER cuts content: on a window wide enough it sets Appearance and Reading font side by side, so it is short; on a window still shorter than the menu it scrolls ITSELF (max-height above), never clipped */
    '.cbav-cols{display:block}.cbav-c>h4:first-child{margin-top:10px}' +
    '@media (min-width:600px){.cbav-pop{width:min(600px,calc(100vw - 32px))}.cbav-cols{display:grid;grid-template-columns:1fr 1fr;column-gap:18px}.cbav-c>h4:first-child{margin-top:8px}.cbav-items.last{margin-top:4px}.cbav-items{grid-template-columns:1fr 1fr;padding:4px 0}.cbav-items.last{padding:4px 0 0}.cbav-fonts button,.cbav-langs button{padding:3px 8px}.cbav-sizes button{height:36px}.cbav-weights button{height:32px}}' +
    '.cbav-fonts button,.cbav-langs button{display:flex;align-items:baseline;border:0;background:none;border-radius:7px;padding:5px 8px;text-align:start}' +
    '.cbav-fonts button[aria-pressed="true"],.cbav-langs button[aria-pressed="true"]{background:var(--av-blue-t);color:var(--av-blue-i);font-weight:600}' +
    '.cbav-langs{display:flex;flex-wrap:wrap;gap:2px}' +
    /* ⭐ A PAGE IN THE LIST STANDARD'S TOKEN NAMES (--page · --panel · --muted · --blue-t …; index, CB Accounts' lists, the Lab) says so with
       <html data-tokens="list">, and a chosen theme re-points those names at the theme's own tokens. The fallbacks ARE the page's original
       values, and Cream (no overrides, so no data-themed) is left alone, so a page that never chooses a theme is byte-for-byte what it was. */
    ':root[data-tokens="list"][data-themed]{--page:var(--paper,#FCFAF5);--panel:var(--gold-soft,#F3EFE6);--line-soft:var(--line,#E6E0D2);--hair:var(--gold-soft,#F0ECE2);' +
    '--muted:var(--grey,#5E594D);--faint:var(--grey-3,#8A8374);--ghost:var(--grey-4,#A8A295);--green:var(--ok,#16693F);--green-d:var(--ok-2,#0D4A2B);--green-t:var(--ok-tint,#E8F4ED);--green-b:var(--ok-3,#A9D3BC);' +
    '--red:var(--disp,#C4562F);--red-t:var(--danger-tint,#FBEAE3);--red-b:var(--disp-2,#E7B9A8);--red-i:var(--disp-2,#8E3517);--amber-t:var(--warn-tint,#FDF3DC);--amber-i:var(--warn-2,#7A5205);' +
    '--blue-t:var(--blue-tint-bg,var(--blue-tint,#E4EEFA));--blue-b:var(--blue-tint-line,#B9D2EF);--blue-i:var(--blue-d,#174A87)}' +
    /* the two preferences every page honours, written once here so no page re-declares them */
    ':root[data-motion="reduce"] *,:root[data-motion="reduce"] *::before,:root[data-motion="reduce"] *::after{animation:none!important;transition:none!important}' +
    ':root[data-stripes="off"]{--zebra:transparent}' +
    ':root[data-stripes="light"]{--zebra:color-mix(in srgb,var(--ink,#1D1B16) 5%,var(--card,#FFFFFF))}' +
    '.cbav-stripes{display:flex;gap:4px;margin:0 0 8px}.cbav-stripes button{flex:1;height:34px;border:1px solid var(--av-line);background:var(--av-card);border-radius:9px;color:var(--av-ink);font-family:inherit;font-size:calc(12.5px * var(--k,1))}' +
    '.cbav-stripes button[aria-pressed="true"]{border-color:var(--av-blue);background:var(--av-blue-t);color:var(--av-blue-i);font-weight:600}' +
    ':root[data-weight="bold"] body{font-weight:600}' +
    ':root[data-weight="bold"] :where(button,input,select,textarea){font-weight:inherit}' +
    ':root[data-weight="bold"] body :is([style*="font-weight:400"],[style*="font-weight: 400"],[style*="font-weight:500"],[style*="font-weight: 500"]){font-weight:600}';

  function addCss() {
    if (!doc || doc.getElementById('cbav-css')) return;
    var node = doc.createElement('style');
    node.id = 'cbav-css';
    node.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(node);
  }

  var M = null; /* the mounted avatar: { el, o } — one per page */
  var openNow = false;

  function swatches() {
    var p = pref('theme');
    var dev =
      '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="theme-device" data-av-theme="device" aria-pressed="' +
      (p === 'device') +
      '"><span class="dot"><i style="background:#FCFAF5"></i><i style="background:#15140F"></i></span>My device</button>';
    return (
      dev +
      Object.keys(THEMES)
        .map(function (item) {
          var t = THEMES[item],
            v = t.vars || {};
          return (
            '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="theme-' +
            esc(item) +
            '" data-av-theme="' +
            esc(item) +
            '" aria-pressed="' +
            (p === item) +
            '" title="' +
            esc(t.name) +
            '">' +
            '<span class="dot"><i style="background:' +
            esc(v['--paper'] || '#FAF8F4') +
            '"></i><i style="background:' +
            esc(v['--blue'] || '#3F66A6') +
            '"></i></span>' +
            esc(t.name) +
            '</button>'
          );
        })
        .join('')
    );
  }

  /** one heading and a row of pressable choices for a saved preference (`kind` names the pref, its data-av-<kind> attribute and its test ids) */
  /** one on/off switch of the menu, two to a line (Less motion · Shortcuts = the keyboard shortcuts, MNT-63, WCAG 2.2 SC 2.1.4): a label and a switch whose click picks the other value of its kind */
  function switchRow(label, kind, on, offValue, onValue) {
    return '<div class="cbav-motion"><span>' + label + '</span><button type="button" class="cbav-toggle" role="switch" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="' + kind + '-switch" data-av-' + kind + '="' + (on ? offValue : onValue) + '" aria-checked="' + on + '" aria-label="' + label + '"></button></div>';
  }
  function choiceGroup(heading, kind, choices) {
    return (
      '<h4>' +
      heading +
      '</h4><div class="cbav-stripes" role="group" aria-label="' +
      heading +
      '" data-testid="' +
      kind +
      '-group">' +
      choices
        .map(function (choice) {
          return (
            '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="' +
            kind +
            '-' +
            choice[0] +
            '" data-av-' +
            kind +
            '="' +
            choice[0] +
            '" aria-pressed="' +
            (pref(kind) === choice[0]) +
            '">' +
            choice[1] +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /** the identity mount of a menu control (this screen's code + U1nn, the list control's rule); none until the page names its screen */
  function avatarMount(component) {
    return root.CBScreenId && root.CBScreenId.mountAttr ? root.CBScreenId.mountAttr(component) : '';
  }
  /** the popup-code chip of this popover (a literal POP code, the one the register holds for it); nothing on a page without screen-id.js */
  function avatarChip(code, place) {
    return root.CBScreenId && root.CBScreenId.popupChip ? root.CBScreenId.popupChip(code, place) : '';
  }
  function menuHtml(o) {
    var P = o.person || {},
      items = o.items || ['profile', 'settings', 'support', 'signout'];
    var showSettings = items.indexOf('settings') >= 0 && !!P.owner;
    var has_ = function (k) {
      return items.indexOf(k) >= 0;
    };
    var up = [];
    if (has_('profile'))
      up.push(
        o.onProfile
          ? '<button type="button" data-cbsid="CMP033-M01"' + avatarMount('CMP033') + ' data-testid="nav-profile" data-av="profile">Profile</button>'
          : '<a data-cbsid="CMP033-M01"' + avatarMount('CMP033') + ' data-testid="nav-profile" data-av="profile" href="' + esc(o.profileHref || PROFILE_HREF) + '">Profile<span aria-hidden="true">↗</span></a>'
      );
    /* UX-96: the OWNER has Settings on every page — the workshop's own handler, else the Settings page (never a door into app.html, H34) */
    if (showSettings)
      up.push(
        o.onSettings
          ? '<button type="button" data-cbsid="CMP033-M01"' + avatarMount('CMP033') + ' data-testid="nav-settings" data-av="settings">Settings</button>'
          : '<a data-cbsid="CMP033-M01"' + avatarMount('CMP033') + ' data-testid="nav-settings" data-av="settings" href="' + esc(o.settingsHref || SETTINGS_HREF) + '">Settings<span aria-hidden="true">↗</span></a>'
      );
    /* UX-96: Support only where there is somewhere to go (no support page yet → no item, no loop to Home) */
    if (has_('support') && (o.onSupport || o.supportHref))
      up.push(
        o.onSupport
          ? '<button type="button" data-cbsid="CMP033-M01"' + avatarMount('CMP033') + ' data-testid="av-support" data-av="support">Support</button>'
          : '<a data-cbsid="CMP033-M01"' + avatarMount('CMP033') + ' data-testid="av-support" data-av="support" href="' + esc(o.supportHref) + '">Support<span aria-hidden="true">↗</span></a>'
      );
    /* L16-M7: Sign out sits at the TOP with Profile and Settings; the menu is taller than 1366x768, so a button at its foot was below the fold */
    if (has_('signout')) up.push('<button type="button" data-cbsid="CMP033-M01"' + avatarMount('CMP033') + ' data-testid="nav-signout" data-av="signout">Sign out</button>');

    var fsNow = pref('fs'),
      w = pref('weight'),
      f = pref('font');
    var langs = '';
    if (o.languages && o.languages.list) {
      langs =
        '<h4>Language</h4><div class="cbav-langs" role="group" aria-label="Language" data-testid="lang-picker">' +
        Object.keys(o.languages.list)
          .map(function (item) {
            return (
              '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="lang-' +
              esc(item) +
              '" data-av-lang="' +
              esc(item) +
              '" aria-pressed="' +
              (o.languages.current === item) +
              '">' +
              esc(o.languages.list[item]) +
              '</button>'
            );
          })
          .join('') +
        '</div>';
    }
    return (
      '<div class="cbav-pop" role="dialog" data-pop="POP114" aria-label="Your menu" data-testid="avatar-menu">' + avatarChip('POP114', 'position:absolute;inset-inline-end:10px;top:8px') +
      '<div class="cbav-who"><span class="l">' +
      esc(letter(P)) +
      '</span><div><b>' +
      esc(P.name || P.entity || '') +
      '</b><span>' +
      esc(P.role || '') +
      '</span></div></div>' +
      (up.length ? '<div class="cbav-items">' + up.join('') + '</div>' : '') +
      '<div class="cbav-cols"><div class="cbav-c"><h4>Appearance</h4><div class="cbav-sw" role="group" aria-label="Theme">' +
      swatches() +
      '</div>' +
      editionsHtml() +
      choiceGroup('Row stripes', 'stripes', STRIPES) +
      choiceGroup('Thirukkural', 'kural', KURAL) +
      '</div>' +
      '<div class="cbav-c"><h4>Text size</h4><div class="cbav-sizes" role="group" aria-label="Text size">' +
      TEXT_SIZES.map(function (x, index) {
        return (
          '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="fs-' +
          x[0] +
          '" data-av-fs="' +
          x[0] +
          '" aria-pressed="' +
          (fsNow === x[0]) +
          '" title="' +
          x[1] +
          ' (' +
          Math.round(x[2] * 100) +
          '%)" aria-label="' +
          x[1] +
          '" style="font-size:' +
          [13, 16, 20, 25][index] +
          'px">A</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="cbav-weights" role="group" aria-label="Text weight">' +
      '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="weight-normal" data-av-weight="normal" aria-pressed="' +
      (w === 'normal') +
      '" title="Normal" aria-label="Normal text" style="font-weight:400">A</button>' +
      '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="weight-bold" data-av-weight="bold" aria-pressed="' +
      (w === 'bold') +
      '" title="Bold" aria-label="Bold text" style="font-weight:800">A</button></div>' +
      switchRow('Less motion', 'motion', pref('motion') === 'reduce', 'auto', 'reduce') +
      switchRow('Shortcuts', 'keys', pref('keys') !== 'off', 'off', 'on') +
      '<h4>Reading font</h4><div class="cbav-fonts" role="group" aria-label="Font">' +
      FONTS.map(function (x) {
        return (
          '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="font-' +
          x[0] +
          '" data-av-font="' +
          x[0] +
          '" aria-pressed="' +
          (f === x[0]) +
          '" style="font-family:' +
          esc(x[2]) +
          '">' +
          x[1] +
          '</button>'
        );
      }).join('') +
      '</div>' +
      langs +
      '</div></div>' +
      '</div>'
    );
  }
  /* AX1: the showings this app has (the manifest's `editions`, through CBEdition) — the Row stripes look, never a new one; absent with one edition or no CBEdition */
  function editionsHtml() {
    var E = root.CBEdition,
      l = E && E.list ? E.list() : [];
    if (l.length < 2) return '';
    var now = E.key();
    return (
      '<h4>Edition</h4><div class="cbav-stripes" role="group" aria-label="Edition" data-testid="edition-group">' +
      l
        .map(function (x) {
          return (
            '<button type="button" data-cbsid="CMP025-B01"' + avatarMount('CMP025') + ' data-testid="edition-' +
            esc(x.key) +
            '" data-av-edition="' +
            esc(x.key) +
            '" aria-pressed="' +
            (now === x.key) +
            '">' +
            esc(x.name) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }
  function letter(P) {
    return (
      String(P.name || P.entity || '?')
        .trim()
        .slice(0, 1)
        .toUpperCase() || '?'
    );
  }

  function paint() {
    if (!M || !M.el) return;
    var o = M.o,
      P = o.person,
      el = M.el,
      keepTop = 0,
      node = el.querySelector('.cbav-pop'),
      focusKey = null;
    if (node) keepTop = node.scrollTop;
    try {
      var ae = doc.activeElement;
      if (ae && el.contains(ae)) focusKey = ae.getAttribute('data-testid');
    } catch (_) {}
    if (!P) {
      /* ⭐ M14: a page that mounts CBSignin (index · CB Accounts · CB CRM) gives onSignIn — the door opens the one sign-in window IN PLACE.
         Without it the door is a link to the INDEX, the front door (Athi 2026-10-09: a customer never lands in the workshop's #/login). */
      el.innerHTML =
        typeof o.onSignIn === 'function'
          ? '<span class="cbav"><button type="button" class="cbav-signin" data-cbsid="CMP052-B01"' + avatarMount('CMP052') + ' data-testid="signin-door" data-av="signin">Sign in</button></span>'
          : '<span class="cbav"><a class="cbav-signin" data-cbsid="CMP052-B01"' + avatarMount('CMP052') + ' data-testid="signin-door" href="' + esc(o.signInHref || '/') + '">Sign in</a></span>';
      return;
    }
    var label = (P.entity || P.name || 'You') + ': your menu';
    el.innerHTML =
      '<span class="cbav" data-testid="cbavatar"><button type="button" class="cbav-btn" data-cbsid="CMP048-B01"' + avatarMount('CMP048') + ' data-testid="' +
      esc(o.testid || 'avatar') +
      '" aria-haspopup="dialog" aria-expanded="' +
      openNow +
      '" aria-label="' +
      esc(label) +
      '" title="' +
      esc(P.entity || P.name || '') +
      '">' +
      esc(letter(P)) +
      '</button>' +
      (openNow ? menuHtml(o) : '') +
      '</span>';
    var np = el.querySelector('.cbav-pop');
    if (np) {
      fit(np);
      np.scrollTop = keepTop;
    }
    if (focusKey) {
      var f2 = el.querySelector('[data-testid="' + focusKey + '"]');
      if (f2) {
        try {
          f2.focus({ preventScroll: true });
        } catch (_) {}
      }
    }
  }
  /** the menu may be as tall as the room BELOW the button, never more: it scrolls itself only when the window is shorter than the menu, and nothing is cut */
  function fit(node) {
    try {
      node = node || (M && M.el && M.el.querySelector('.cbav-pop'));
      if (!node) return;
      node.style.maxHeight = '';
      var r = node.getBoundingClientRect(),
        h = root.innerHeight || doc.documentElement.clientHeight;
      node.style.maxHeight = Math.max(160, Math.floor(h - r.top - 8)) + 'px';
    } catch (_) {}
  }
  function repaint() {
    if (M) paint();
  }
  function close() {
    if (!openNow) return;
    openNow = false;
    paint();
  }

  /** the session and the per-person nav memory go; every other tab hears cb_sess go. → true when they went. A browser that refuses the delete is SAID (SEC-131), never swallowed: the person would be "signed out" and still signed in. */
  function forget() {
    try {
      root.localStorage.removeItem('cb_sess');
      Object.keys(root.localStorage)
        .filter(function (item) {
          return /^cb_nav(@|$)/.test(item);
        })
        .forEach(function (item) {
          root.localStorage.removeItem(item);
        });
      return true;
    } catch (failure) {
      var words = 'Could not clear the sign-in saved on this device. Close this window, or clear the site data, before you leave this device.';
      console.error('avatar: sign-out could not clear the saved session', (failure && failure.message) || failure);
      try {
        if (typeof root.toast === 'function') root.toast(words, true);
        else if (typeof root.alert === 'function') root.alert(words);
      } catch (_) {}
      return false;
    }
  }
  /**
   * ⭐ THE ONE SIGN-OUT (SEC-131). Every sign-out button reaches this: the server is told to revoke THIS session's token (POST /api/signin/logout,
   * so a copied token stops working), then the device forgets it. The device forgets even when the call cannot be made (offline): the request is
   * sent first (it needs the token) and not waited for. o.token is the session of THIS tab when the page knows it (a tab told "another shop opened
   * here" must revoke its own token, not the one now in storage); otherwise the stored session. → Promise({ revoked, cleared }).
   */
  function endSession(asked) {
    var sessionToken = asked && asked.token !== undefined ? asked.token : tokenOf(asked),
      base = apiBaseOf(asked),
      wire = Promise.resolve(false);
    if (sessionToken && root.fetch) {
      try {
        wire = Promise.resolve(root.fetch(base + '/api/signin/logout', { method: 'POST', keepalive: true, headers: { Authorization: 'Bearer ' + sessionToken } })).then(
          function (reply) {
            return !!(reply && reply.ok);
          },
          function (failure) {
            console.warn('avatar: sign-out could not reach the server — this device forgets the session anyway', (failure && failure.message) || failure);
            return false;
          }
        );
      } catch (failure) {
        console.warn('avatar: sign-out could not start the server call', (failure && failure.message) || failure);
      }
    }
    var cleared = forget();
    return wire.then(function (revoked) {
      return { revoked: revoked, cleared: cleared };
    });
  }
  function signOut() {
    var o = (M && M.o) || {};
    openNow = false;
    if (typeof o.onSignOut === 'function') return o.onSignOut(); /* the app's: confirm, then logoutNow(), which ends the session here */
    /* a page that has no app behind it */
    endSession(o);
    root.location.href = o.signInHref || '/';
  }

  /** the saved looks a menu button sets by its data-av-<kind> attribute */
  var PICK_KINDS = ['theme', 'fs', 'weight', 'stripes', 'kural', 'edition', 'font', 'motion', 'keys'];
  /** the menu's `data-av` actions: sign out · sign in · profile · settings · support (each only when the page gave its callback) */
  function onMenuAction(e, action, o) {
    var closeThen = function (callback) {
      e.preventDefault();
      openNow = false;
      paint();
      return callback();
    };
    if (action === 'signout') {
      e.preventDefault();
      return signOut();
    }
    if (action === 'signin' && typeof o.onSignIn === 'function') {
      e.preventDefault();
      return o.onSignIn();
    }
    if (action === 'profile' && o.onProfile) return closeThen(o.onProfile);
    if (action === 'settings' && o.onSettings) return closeThen(o.onSettings);
    if (action === 'support' && o.onSupport) return closeThen(o.onSupport);
  }
  /** one click anywhere: outside the menu closes it; inside, the button's data-av-* attribute says what it does */
  function onDocClick(e) {
    if (!M || !M.el) return;
    var target = e.target;
    if (!target || !target.closest) return;
    if (!M.el.contains(target)) {
      if (openNow) close();
      return;
    }
    var options = M.o,
      button;
    if (target.closest('.cbav-btn')) {
      openNow = !openNow;
      paint();
      return;
    }
    var picked = PICK_KINDS.filter(function (kind) {
      return target.closest('[data-av-' + kind + ']');
    })[0];
    if (picked) return set(picked, target.closest('[data-av-' + picked + ']').getAttribute('data-av-' + picked));
    if ((button = target.closest('[data-av-lang]'))) {
      if (options.languages && options.languages.onPick) options.languages.onPick(button.getAttribute('data-av-lang'));
      return;
    }
    if ((button = target.closest('[data-av]'))) return onMenuAction(e, button.getAttribute('data-av'), options);
  }
  var wired = false;
  function wire() {
    if (wired || !doc) return;
    wired = true;
    if (root.addEventListener)
      root.addEventListener('resize', function () {
        if (openNow) fit();
      });
    doc.addEventListener('click', onDocClick);
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openNow) {
        close();
        var btn = M && M.el && M.el.querySelector('.cbav-btn');
        if (btn) {
          try {
            btn.focus();
          } catch (_) {}
        }
      }
    });
    /* another tab changed the look: follow it (the storage event never fires in the tab that wrote) */
    root.addEventListener('storage', function (e) {
      if (e.key === null || /^cb_(theme|font|fs|weight|motion|stripes)$/.test(e.key)) {
        apply();
        repaint();
      }
    });
  }

  /**
   * mount(el, o)
   *   person   { name, role, entity, owner } | null     null draws "Sign in"
   *   items    ['profile','settings','support','signout']   the page's choice; Settings also needs person.owner
   *   onProfile · onSettings · onSupport · onSignOut     a page that has the screen in place; otherwise a link into the app
   *   languages { list:{code:name}, current, onPick }    the app only: it has no other door to its language
   *   testid   the button's data-testid (default `avatar`)      signInHref · apiBase · token
   *   onLook(kind, value)  a fixed-look page only (data-appearance-fixed): told after each pick, which is applied but never saved
   *   sync:false  no server at all (the counter offline)      pull:false  the host reads /me itself and calls hydrate()
   */
  function mount(el, o) {
    if (!el) return null;
    o = o || {};
    addCss();
    HOST = { apiBase: o.apiBase, token: o.token, sync: o.sync, viaPrefs: o.viaPrefs };
    var first = !M || M.el !== el;
    M = { el: el, o: o };
    apply(); /* the base may only now be readable (the page's stylesheet is parsed) */
    wire();
    paint();
    if (root.CBEdition && root.CBEdition.load)
      root.CBEdition.load().then(function () {
        if (openNow) paint();
      }); /* the Edition choice needs the manifest's list */
    if (first && o.person && o.sync !== false && o.pull !== false) pull(o);
    return {
      update: function (p) {
        M.o.person = p;
        paint();
      },
      close: close,
      el: el
    };
  }

  /** Every themed token's UNTHEMED value — taken with the saved theme lifted off, so a preview card can draw theme X while Y is active. */
  function themeBase() {
    var out = {},
      node = doc.documentElement,
      all = {},
      saved = {},
      cs = null;
    Object.keys(THEMES).forEach(function (item) {
      Object.keys(THEMES[item].vars || {}).forEach(function (entry) {
        all[entry] = 1;
      });
    });
    try {
      cs = root.getComputedStyle(node);
    } catch (_) {}
    Object.keys(all).forEach(function (item) {
      saved[item] = node.style.getPropertyValue(item);
      if (saved[item]) node.style.removeProperty(item);
    });
    Object.keys(all).forEach(function (item) {
      out[item] = cs ? (cs.getPropertyValue(item) || '').trim() : '';
    });
    Object.keys(saved).forEach(function (item) {
      if (saved[item]) node.style.setProperty(item, saved[item]);
    });
    return out;
  }

  /** A saved session (cb_sess) or the app's SESSION → the `person` the menu wants. Owner = the shop's own session (routes/books.js isOwner). */
  function personOf(s) {
    if (!s || typeof s !== 'object') return null;
    var r = s.role,
      label = r === 'entity' ? 'Owner' : r === 'actor' ? 'Co-assist' : r === 'customer' ? 'Customer' : r || '';
    return { name: s.name || '', role: label + (s.entity ? ' · ' + s.entity : ''), entity: s.entity || '', owner: r === 'entity', token: s.token || '' };
  }
  function sessionPerson() {
    try {
      var parsed = JSON.parse(root.localStorage.getItem('cb_sess') || 'null');
      return parsed && parsed.token ? personOf(parsed) : null;
    } catch (_) {
      return null;
    }
  }

  /* before first paint, from local storage alone — no network, no mount needed (a page with no menu still wears the look) */
  apply();
  if (doc && doc.addEventListener)
    doc.addEventListener('DOMContentLoaded', function () {
      BASE = null;
      apply();
    });
  /* FX-QA1: a choice made offline goes up when the connection comes back — not only on the next page's pull (the mark, F9, says what is still owed) */
  if (root.addEventListener)
    root.addEventListener('online', function () {
      if (!OVERRIDE && Object.keys(pendGet()).length) push();
    });

  root.CBAvatar = {
    mount: mount,
    apply: apply,
    applyWith: applyWith,
    hydrate: hydrate,
    set: set,
    get: get,
    personOf: personOf,
    sessionPerson: sessionPerson,
    themeKey: themeKey,
    applyTheme: themeApply,
    push: push,
    pending: pendGet,
    themeBase: themeBase,
    menuHtml: menuHtml,
    isOpen: function () {
      return openNow;
    },
    close: close,
    signOut: signOut,
    endSession: endSession,
    THEMES: THEMES,
    FONTS: FONTS,
    TEXT_SIZES: TEXT_SIZES,
    FS_BASE: FS_BASE,
    fontStack: fontStack,
    shopCountry: shopCountry,
    ledgerOn: ledgerOn
  };
})(typeof window !== 'undefined' ? window : this);
