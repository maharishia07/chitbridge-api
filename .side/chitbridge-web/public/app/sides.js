/**
 * OWNS  CBSides: the two reference panels on Home ("We lean on", "Leans on us") and their two row buttons SCR044-B01 / B02
 * CALLED BY  the shell's mount (Home only, signed in, when the page loaded this file: grep -n CBSides public/app/shell.js); loaded by <script src> on index.html and shell-lab.html
 * FLOW  the shell lays out the two drawers → mount() → GET /api/entities/sides → paint rows → a row action or the Who button repaints the drawer
 * CARD  29-qa-test-tooling-ux-locale-and-design-system/shell
 * ── ⭐ CBSides — THE TWO REFERENCE PANELS: "We lean on" (blue, →) and "Leans on us" (green, ←) ──────────────────────────────────
 *
 * Designer handoff: designs-inbox/cb-sides-2026-10-08 (the prototype's business-kind switcher is NOT built). The shell (shell.js) gives this
 * unit four elements and loads nothing for it; the page loads this file the way it loads avatar.js / kural.js, and the shell mounts it
 * IF it is there.
 *
 *   CBSides.mount({ left, right, btnL, btnR }, { apiBase, token }) → { refresh(), ready, close() }
 *     left / right   the two <aside> panels (the shell lays them out as drawers at every width, walk 17 Oct)
 *     btnL / btnR    the two toolbar buttons (icons with counts: "→8" · "←6", the words on hover) — one drawer open at a time
 *
 * WHAT IT READS: GET /api/entities/sides → { lean:[{key,rows}], use:[{key,rows}], impact }. The server decides every state, version and
 * number (drift = governance/resolver.driftOf, impact = lib/impact, trade proof = the header's 3 of 4). The page paints and computes
 * NOTHING. A row with s:'later' is drawn "not yet" — there is no data source yet; there is never a made-up number. A failed read is one
 * dashed row that says so. The count on a button is the ROWS drawn (placeholders excluded), not the records behind them.
 *
 * Review shows what differs (the server's sentence) in the row; Finish goes to the server's href; See who lists the businesses the
 * impact box counts. One file, one global, its own CSS on the shell's tokens (with fallbacks), its own escaping.
 */
(function (root) {
  'use strict';
  if (root.CBSides) return;
  var doc = root.document;

  var W = {
    lean: 'We lean on',
    use: 'Leans on us',
    subL: 'What we follow and draw on.',
    subR: 'Who relies on what we hold.',
    g: {
      rules: 'Rules we follow',
      mould: 'Mould we came from',
      content: 'Content we draw on',
      systems: 'Systems we read',
      buy: 'We buy from',
      trade: 'Trade with us',
      act: 'Act for us',
      cite: 'Cite us',
      inherit: 'Inherit from us'
    },
    close: 'Close',
    fail: 'Could not read',
    failM: 'not yet',
    nobody: 'Nobody yet',
    who: 'See who',
    hide: 'Hide',
    review: 'Review',
    finish: 'Finish',
    cur: 'Current'
  };

  var list = [
    '.cbsd{--sd-blue:var(--blue,#2F74C9);--sd-blue-b:var(--sh-blue-b,var(--blue-b,#B9D2EF));--sd-blue-i:var(--sh-blue-i,var(--blue-i,#174A87));',
    '--sd-green:var(--sh-green,var(--green,#16693F));--sd-green-b:var(--sh-green-b,var(--green-b,#A9D3BC));--sd-green-d:var(--sh-green-d,var(--green-d,#0D4A2B));--sd-green-t:var(--sh-green-t,var(--green-t,#E8F4ED));',
    '--sd-amber-t:var(--sh-amber-t,var(--amber-t,#FDF3DC));--sd-amber-b:var(--sh-amber-b,var(--amber-b,#EFD39A));--sd-amber-i:var(--sh-amber-i,var(--amber-i,#7A5205));',
    '--sd-card:var(--sh-card,var(--card,#FFFFFF));--sd-panel:var(--sh-panel,var(--panel,#F3EFE6));--sd-line:var(--sh-line,var(--line,#DDD6C6));--sd-soft:var(--sh-soft,var(--line-soft,#E6E0D2));',
    '--sd-hair:var(--sh-hair,var(--hair,#F0ECE2));--sd-ink:var(--sh-ink,var(--ink,#1D1B16));--sd-muted:var(--sh-muted,var(--muted,#5E594D));--sd-ghost:var(--sh-ghost,var(--ghost,#A8A295))}',
    '.cbsd{position:relative;background:var(--sd-card);border:1px solid var(--sd-line);border-radius:14px;padding:14px 14px 10px;scrollbar-width:thin;scrollbar-color:var(--sd-line) transparent}',
    '.cbsd::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;border-radius:14px 14px 0 0}',
    '.cbsd.l::before{background:linear-gradient(90deg,var(--sd-blue-b),var(--sd-blue),var(--sd-blue-b))}',
    '.cbsd.r::before{background:linear-gradient(90deg,var(--sd-green-b),var(--sd-green),var(--sd-green-b))}',
    '.cbsd-hd{display:flex;align-items:center;gap:8px;margin-top:3px}',
    '.cbsd h3{font-family:"Bricolage Grotesque",sans-serif;font-size:16px;font-weight:800;margin:0;letter-spacing:-.01em}',
    '.cbsd-arr{font-size:15px;font-weight:700}.cbsd.l .cbsd-arr{color:var(--sd-blue)}.cbsd.r .cbsd-arr{color:var(--sd-green)}',
    '.cbsd-cnt{margin-left:auto;font-family:var(--f-num,"IBM Plex Mono",monospace);font-size:12px;font-weight:700;color:var(--sd-muted)}',
    '.cbsd-x{display:none;border:0;background:none;font-size:15px;color:var(--sd-muted);padding:2px 6px;margin-left:6px}',
    '.cbsd-sub{font-size:12px;color:var(--sd-muted);margin:1px 0 4px}',
    '.cbsd-g{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--sd-muted);font-weight:700;margin:13px 0 3px}',
    '.cbsd-ref{display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--sd-hair)}.cbsd-ref:last-child{border-bottom:0}',
    '.cbsd-tx{min-width:0}.cbsd-nm{font-weight:600;font-size:13.5px;line-height:1.3}',
    '.cbsd-mt{font-size:11.5px;color:var(--sd-muted);font-family:var(--f-num,"IBM Plex Mono",monospace);line-height:1.35}',
    '.cbsd-ref.dash .cbsd-nm{color:var(--sd-muted);font-weight:500}',
    '.cbsd-st{margin-left:auto;font-size:11px;font-weight:700;border-radius:6px;padding:1px 7px;white-space:nowrap;border:1px solid transparent}',
    '.cbsd-st.ok{background:var(--sd-green-t);color:var(--sd-green-d)}',
    '.cbsd-st.wait{background:var(--sd-amber-t);color:var(--sd-amber-i);border-color:var(--sd-amber-b)}',
    '.cbsd-st.later{background:var(--sd-panel);color:var(--sd-muted);border:1px dashed var(--sd-line)}',
    '.cbsd-fix{display:inline-flex;align-items:center;margin-top:5px;height:24px;padding:0 10px;border-radius:7px;border:1px solid var(--sd-amber-b);background:var(--sd-amber-t);color:var(--sd-amber-i);font-size:12px;font-weight:700;text-decoration:none}',
    '.cbsd-det{margin-top:5px;font-size:12px;color:var(--sd-amber-i)}.cbsd-det[hidden]{display:none}',
    '.cbsd-imp{margin-top:12px;border:1px solid var(--sd-soft);background:var(--sd-panel);border-radius:11px;padding:10px 12px}',
    '.cbsd-imp .k{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--sd-muted);font-weight:700}',
    '.cbsd-imp .n{font-weight:700;font-size:13.5px;margin-top:2px}',
    '.cbsd-imp .m{font-size:12.5px;color:var(--sd-muted);font-family:var(--f-num,"IBM Plex Mono",monospace)}',
    '.cbsd-imp button{margin-top:7px;height:26px;padding:0 11px;border-radius:8px;border:1px solid var(--sd-line);background:var(--sd-card);font-size:12px;font-weight:700}',
    '.cbsd-who{margin:8px 0 0;padding:0;list-style:none;font-size:12.5px}.cbsd-who[hidden]{display:none}',
    '.cbsd-who li{padding:3px 0;border-bottom:1px solid var(--sd-hair)}.cbsd-who li:last-child{border-bottom:0}.cbsd-who .r{color:var(--sd-muted);font-size:11px;margin-left:6px}',
    '.cbsd-btn{display:none;height:30px;padding:0 9px;border-radius:9px;border:1px solid var(--sd-line);background:var(--sd-card);font-size:12.5px;font-weight:700;color:var(--sd-muted)}',
    '.cbsd-btn b{font-family:var(--f-num,"IBM Plex Mono",monospace);margin-left:5px}',
    '.cbsd-btn.l{border-color:var(--sd-blue-b);color:var(--sd-blue-i)}.cbsd-btn.r{border-color:var(--sd-green-b);color:var(--sd-green-d)}',
    '.cbsd-btn[aria-expanded=true]{background:var(--sd-panel)}',
    '.cbsd-btn .w{margin-left:5px}.cbsd-btn .w+b{margin-left:6px}',
    '@media(max-width:700px){.cbsd-btn .w{display:none}}'
  ].join('');
  function addCss() {
    if (!doc || doc.getElementById('cbsd-css')) return;
    var node = doc.createElement('style');
    node.id = 'cbsd-css';
    node.textContent = list;
    (doc.head || doc.documentElement).appendChild(node);
  }
  function apiBaseDefault() {
    return root.CBShell && root.CBShell.apiBase ? root.CBShell.apiBase() : '';
  }

  /* a word through the catalogue when the page has it (tx), else as written */
  function throughCatalogue(word) {
    return typeof root.tx === 'function' ? root.tx(word) : word;
  }
  function mount(slots, o) {
    o = o || {};
    addCss();
    var base = o.apiBase != null ? o.apiBase : apiBaseDefault();
    var S = { data: null, err: false, open: null, review: {}, who: false };
    var node = slots.left,
      R = slots.right;
    [node, R].forEach(function (el, index) {
      el.classList.add('cbsd', index ? 'r' : 'l');
    });
    node.setAttribute('data-testid', 'sides-left');
    R.setAttribute('data-testid', 'sides-right');
    node.setAttribute('aria-label', W.lean);
    R.setAttribute('aria-label', W.use);
    var bL = slots.btnL,
      bR = slots.btnR;
    [bL, bR].forEach(function (item, index) {
      item.classList.add('cbsd-btn', index ? 'r' : 'l');
      item.setAttribute('aria-expanded', 'false');
    });
    bL.setAttribute('data-testid', 'sides-open-l');
    bR.setAttribute('data-testid', 'sides-open-r');

    function rowsOf(groups) {
      return (groups || []).reduce(function (total, item) {
        return (
          total +
          (item.rows || []).filter(function (entry) {
            return entry.s !== 'empty';
          }).length
        );
      }, 0);
    }
    function refRow(r, side) {
      var key = side + ':' + r.id,
        shown = !!S.review[key];
      var st =
        r.s === 'ok' || r.s === 'wait' || r.s === 'later'
          ? '<span class="cbsd-st ' + r.s + '" data-testid="sides-state">' + esc(r.t || (r.s === 'ok' ? W.cur : W.failM)) + '</span>'
          : '';
      var act = '';
      if (r.fix === 'Review')
        act =
          '<button data-cbsid="SCR044-B01" type="button" class="cbsd-fix" data-act="review" data-key="' +
          esc(key) +
          '" aria-expanded="' +
          shown +
          '" data-testid="sides-review">' +
          esc(W.review) +
          '</button>' +
          '<div class="cbsd-det" data-testid="sides-detail"' +
          (shown ? '' : ' hidden') +
          '>' +
          esc(r.detail || '') +
          '</div>';
      else if (r.fix === 'Finish') act = '<a class="cbsd-fix" href="' + esc(r.href || '#') + '" data-testid="sides-finish">' + esc(W.finish) + '</a>';
      return (
        '<div class="cbsd-ref' +
        (r.s === 'empty' || r.s === 'later' ? ' dash' : '') +
        '" data-testid="sides-row" data-id="' +
        esc(r.id) +
        '" data-s="' +
        esc(r.s || '') +
        '"><div class="cbsd-tx"><div class="cbsd-nm">' +
        esc(r.n) +
        '</div><div class="cbsd-mt">' +
        esc(r.m) +
        '</div>' +
        act +
        '</div>' +
        st +
        '</div>'
      );
    }
    function impactHtml(im) {
      if (!im) return '';
      var who =
        (im.who || [])
          .map(function (item) {
            return '<li>' + esc(item.name) + '<span class="r">' + esc(item.role) + '</span></li>';
          })
          .join('') || '<li>' + esc(W.nobody) + '</li>';
      return (
        '<div class="cbsd-imp" data-testid="sides-impact"><div class="k">' +
        esc(im.k) +
        '</div><div class="n">' +
        esc(im.n) +
        '</div><div class="m" data-testid="sides-impact-m">' +
        esc(im.m) +
        '</div>' +
        '<button data-cbsid="SCR044-B02" type="button" data-act="who" aria-expanded="' +
        S.who +
        '" data-testid="sides-who-btn">' +
        esc(S.who ? W.hide : W.who) +
        '</button>' +
        '<ul class="cbsd-who" data-testid="sides-who"' +
        (S.who ? '' : ' hidden') +
        '>' +
        who +
        '</ul></div>'
      );
    }
    function panel(side) {
      var left = side === 'L',
        gs = S.data ? (left ? S.data.lean : S.data.use) : null;
      var n = S.err || !S.data ? '–' : rowsOf(gs);
      var body =
        S.err || !S.data
          ? S.err
            ? '<div class="cbsd-ref dash" data-testid="sides-failed"><div class="cbsd-tx"><div class="cbsd-nm">' +
              esc(W.fail) +
              '</div></div><span class="cbsd-st later">' +
              esc(W.failM) +
              '</span></div>'
            : ''
          : (gs || [])
              .map(function (item) {
                return (
                  '<div class="cbsd-g">' +
                  esc(W.g[item.key] || item.key) +
                  '</div>' +
                  (item.rows || [])
                    .map(function (entry) {
                      return refRow(entry, side);
                    })
                    .join('')
                );
              })
              .join('') + (left ? '' : impactHtml(S.data.impact));
      return (
        '<div class="cbsd-hd"><span class="cbsd-arr" aria-hidden="true">' +
        (left ? '→' : '←') +
        '</span><h3>' +
        esc(left ? W.lean : W.use) +
        '</h3><span class="cbsd-cnt" data-testid="sides-count">' +
        n +
        '</span><button data-cbsid="CMP005" type="button" class="cbsd-x" data-act="close" aria-label="' +
        esc(W.close) +
        '" data-testid="sides-close">✕</button></div><div class="cbsd-sub">' +
        esc(left ? W.subL : W.subR) +
        '</div>' +
        body
      );
    }
    function paint() {
      node.innerHTML = panel('L');
      R.innerHTML = panel('R');
      var nl = S.data && !S.err ? rowsOf(S.data.lean) : '–',
        nr = S.data && !S.err ? rowsOf(S.data.use) : '–';
      /* an icon and its count; the words are the button's title and its spoken name (walk 2026-10-17) */
      bL.innerHTML = '→<span class="w">' + esc(throughCatalogue(W.lean)) + '</span><b>' + nl + '</b>';
      bR.innerHTML =
        '←<span class="w">' +
        esc(throughCatalogue(W.use)) +
        '</span><b>' +
        nr +
        '</b>'; /* UX-2: the mark says its words beside the count (a phone keeps the icon: title + aria-label) */
      bL.title = W.lean;
      bR.title = W.use;
      bL.setAttribute('aria-label', W.lean + ' ' + nl);
      bR.setAttribute('aria-label', W.use + ' ' + nr);
      node.classList.toggle('drawer', S.open === 'L');
      R.classList.toggle('drawer', S.open === 'R');
      bL.setAttribute('aria-expanded', S.open === 'L' ? 'true' : 'false');
      bR.setAttribute('aria-expanded', S.open === 'R' ? 'true' : 'false');
    }
    /* one drawer at a time: opening one closes the other; the same button closes it */
    function drawer(side) {
      S.open = S.open === side ? null : side;
      paint();
    }
    function close() {
      if (S.open) {
        S.open = null;
        paint();
      }
    }
    function onClick(e) {
      var element = e.target.closest('[data-act]');
      if (!element) return;
      var a = element.getAttribute('data-act');
      if (a === 'close') close();
      else if (a === 'review') {
        var k = element.getAttribute('data-key');
        S.review[k] = !S.review[k];
        paint();
      } else if (a === 'who') {
        S.who = !S.who;
        paint();
      }
    }
    node.addEventListener('click', onClick);
    R.addEventListener('click', onClick);
    bL.addEventListener('click', function () {
      drawer('L');
    });
    bR.addEventListener('click', function () {
      drawer('R');
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    function get(url) {
      return root.fetch((/^https?:/.test(url) ? '' : base) + url, { headers: o.token ? { Authorization: 'Bearer ' + o.token } : {} }).then(function (reply) {
        if (!reply.ok) throw new Error('HTTP ' + reply.status);
        return reply.json();
      });
    }
    function refresh() {
      return get('/api/entities/sides')
        .then(
          function (reply) {
            S.data = reply;
            S.err = !(reply && reply.lean && reply.use);
          },
          function () {
            S.data = null;
            S.err = true;
          }
        )
        .then(paint);
    }
    paint();
    return { refresh: refresh, close: close, ready: refresh() };
  }

  root.CBSides = { mount: mount, WORDS: W };
})(typeof window !== 'undefined' ? window : this);
