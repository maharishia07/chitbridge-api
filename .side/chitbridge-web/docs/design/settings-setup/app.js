/* CB Settings · set up your business — PROTOTYPE app (not product code).
   One rule per row (R10c): not answered → the control inline · answered → the value + ✎ at the row's right end · each row saves
   itself ("✓ Saved"). Required = label + *, optional page/section = "(optional)" in its heading, details behind ⓘ.
   The page paints: bill figures come from data.js. The few checks it runs on a typed tax number are a STAND-IN for the
   engine (profilemap.js panOfGstin, the pack's validators) — marked PROTOTYPE where they sit. */
(function () {
  'use strict';
  var D = window.CBS;
  var Q = new URLSearchParams(location.search);
  var S = {
    c: (Q.get('c') || 'IN').toUpperCase(), st: Q.get('s') || 'half', theme: Q.get('t') || 'cream',
    v: {}, err: {}, editing: null, saved: null, pop: Q.get('pop') || null,
    paper: Q.get('paper') || '80', choice: null, pin: { x: 52, y: 48 }, policy: null, q: ''
  };
  var ICON = {
    start: '<path d="M5 12l4 4L19 6"/>', country: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    business: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>', print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    counters: '<circle cx="7.5" cy="12" r="3.5"/><path d="M11 12h10M17 12v3M20 12v2"/>', connectors: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    policy: '<path d="M5 21V4h11l-2 4 2 4H5"/>', plan: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    tax: '<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z"/><path d="M10 8h4M10 12h4"/>', lic: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M9 17h6"/>',
    bank: '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>', sign: '<path d="M3 17c3-6 5-6 6-3s2 3 4-1 3-3 4 0 2 2 4 1"/><path d="M3 21h18"/>',
    export: '<path d="M2 16l2-6h16l2 6"/><path d="M4 16c2 2 4 2 6 0 2 2 4 2 6 0 2 2 4 2 6 0"/><path d="M8 10V6h8v4"/>', contact: '<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    home: '<path d="M3 10.5 12 4l9 6.5V20H3z"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>', till: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'
  };
  function svg(k, cls) { return '<svg viewBox="0 0 24 24"' + (cls ? ' class="' + cls + '"' : '') + ' aria-hidden="true">' + ICON[k] + '</svg>'; }
  var CUP = '<svg viewBox="0 0 48 48" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"><path d="M9 20h24v8a10 10 0 0 1-10 10h-4A10 10 0 0 1 9 28z"/><path d="M33 23h3a4 4 0 0 1 0 8h-3"/><path d="M17 8c-2 3 2 4 0 7M24 8c-2 3 2 4 0 7"/><path d="M7 42h30"/></svg>';
  var SCRIBBLE = '<svg viewBox="0 0 120 36" style="width:110px;height:32px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round"><path d="M4 26c8-16 14-20 16-12s-4 14 2 10 8-16 14-12-2 14 4 12 6-10 12-8 0 8 6 6 10-8 16-6 6 4 14 2 12-4 24-6"/></svg>';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function C() { return D.C[S.c]; }
  function sh() { return C().shop; }

  /* ── state ───────────────────────────────────────────────────────────────────────────────────── */
  function load() {
    var st = D.STATES[S.st], s = sh(), has = function (k) { return st.has === '*' || st.has.indexOf(k) >= 0; }, v = {};
    v.country = S.c;
    ['kind', 'supply', 'taxReg', 'taxNo', 'taxType', 'name', 'addr', 'phone', 'email', 'regd', 'tagline', 'fssai', 'udyam', 'trade', 'signer', 'signerAs', 'acn', 'tl'].forEach(function (k) {
      if (has(k) && s[k] != null && s[k] !== '') v[k] = s[k];
    });
    if (has('nature')) v.nature = s.nature.slice();
    if (has('logo')) v.logo = true;
    if (has('structure') && C().structure === 'ask') v.structure = s.structureWord;
    if (st.has === '*') { v.bank = true; v.signature = true; }
    v.exportOn = 'Off'; S.me = null; S.open = null;
    S.v = v; S.err = {}; S.editing = null;
    if (st.wrong) { v.taxNo = s.wrongTaxNo; S.err.taxNo = s.wrongWhy; S.editing = 'taxNo'; }
    S.choice = [{ k: 'phone', n: 'Phone', on: true }, { k: 'regd', n: 'Registered name', on: true }, { k: 'email', n: 'E-mail', on: false }, { k: 'tagline', n: 'Tagline', on: false }, { k: 'footer', n: 'Footer', on: true }];
    S.foot = C().bill.foot;
    S.policy = D.POLICY.map(function (p) { var o = Object.assign({}, p); if (p.r === 'Keep records for' && S.c !== 'IN') { o.now = '5 years'; o.opts = ['5 years', '7 years', '10 years']; } if (p.r === 'Tax registration') o.now = v.taxReg === 'no' ? 'Not registered' : 'Registered'; return o; });
  }
  function filled(k) { var x = S.v[k]; return Array.isArray(x) ? x.length > 0 : !!x; }

  /* PROTOTYPE stand-in for the engine's checks + the GSTIN → state / PAN / structure derivation (product: profilemap.js) */
  var STATE_CODES = { '27': 'Maharashtra (27)', '29': 'Karnataka (29)', '33': 'Tamil Nadu (33)', '07': 'Delhi (07)', '24': 'Gujarat (24)', '32': 'Kerala (32)' };
  var HOLDER = { C: 'Company', P: 'Proprietor', H: 'Hindu undivided family', F: 'Partnership firm or LLP', A: 'Association of persons', T: 'Trust', B: 'Body of individuals', L: 'Local authority', J: 'Artificial juridical person', G: 'Government' };
  function checkTax(raw) {
    var c = S.c, t = String(raw || '').replace(/\s+/g, '').toUpperCase();
    if (c === 'IN') {
      if (t.length !== 15) return 'A GSTIN is 15 letters and digits — this has ' + t.length;
      if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(t)) return 'The shape is wrong — 2 digits, 10-letter PAN, then 3 more';
      if (!HOLDER[t[5]]) return 'Letter 6 (' + t[5] + ') is not a holder type — P person · C company · F firm';
      return null;
    }
    if (c === 'AU') {
      if (!/^\d{11}$/.test(t)) return 'An ABN is 11 digits — this has ' + t.replace(/\D/g, '').length;
      var w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19], d = t.split('').map(Number), sum = 0; d[0] -= 1;
      for (var i = 0; i < 11; i++) sum += d[i] * w[i];
      return sum % 89 === 0 ? null : 'The check digits do not match — a digit is wrong or two are swapped';
    }
    return /^\d{15}$/.test(t) ? null : 'A TRN is 15 digits';
  }
  function derivedIN() {
    var t = String(S.v.taxNo || '').replace(/\s+/g, '').toUpperCase();
    if (S.c !== 'IN' || S.v.taxReg !== 'yes' || !t || S.err.taxNo) return null;
    return { state: STATE_CODES[t.slice(0, 2)] || ('State code ' + t.slice(0, 2)), pan: t.slice(2, 12), letter: t[5], structure: HOLDER[t[5]] };
  }

  /* ── the one row ─────────────────────────────────────────────────────────────────────────────── */
  function info(text) { return '<button class="info" type="button" data-info="' + esc(text) + '" aria-label="More about this">i</button>'; }
  function pen(k, label) { return '<button class="pen" type="button" data-edit="' + k + '" aria-label="Change ' + esc(label) + '" title="Change">' + svg('pen') + '</button>'; }
  function endOf(k, label, editable) {
    if (S.saved === k) return '<span class="saved" role="status">✓ Saved</span>';
    return editable ? pen(k, label) : '';
  }
  /* f = { k, label, req, type:'text'|'select'|'seg'|'chips'|'custom', opts, show(v)→html, ctl()→html, derived, from, lock, infoText, ph } */
  function row(f) {
    var k = f.k, has = f.derived ? true : filled(k), open = !f.derived && (f.forceOpen || !has || S.editing === k || S.err[k]);
    var lb = '<div class="lb">' + esc(f.label) + (f.req ? '<span class="req" aria-label="required">*</span>' : '') + (f.lock ? '<span class="lock" title="Fixed after your first sale" aria-label="Fixed after your first sale">🔒</span>' : '') + (f.infoText ? info(f.infoText) : '') + '</div>';
    var v, end = '';
    if (open && !has && !f.req && !f.type && !f.ctl && S.editing !== k && !f.pre) {
      return '<div class="row" data-row="' + k + '">' + lb + '<div class="v"><span class="dim">—</span></div><div class="end"><button class="act ghost xs" type="button" data-edit="' + k + '">+ Add</button></div></div>';
    }
    if (open) {
      v = '<div class="v"><div class="ctl">' + control(f) + '</div></div>';
      if (S.editing === k && has && !S.err[k]) end = '<button class="pen" type="button" data-cancel="' + k + '" aria-label="Keep as it was" title="Keep as it was">✕</button>';
    } else {
      v = '<div class="v">' + (f.show ? f.show(S.v[k]) : esc(S.v[k])) + (f.from ? ' <span class="tag src">' + esc(f.from) + '</span>' : '') + '</div>';
      end = endOf(k, f.label, !f.derived && !f.fixed);
    }
    var why = S.err[k] ? '<div class="why">✕ ' + esc(S.err[k]) + '</div>' : '';
    return '<div class="row' + (S.err[k] ? ' bad' : '') + '" data-row="' + k + '">' + (f.pre || '') + lb + v + '<div class="end">' + end + '</div>' + why + '</div>';
  }
  function control(f) {
    var k = f.k, val = S.v[k];
    if (f.ctl) return f.ctl();
    if (f.type === 'select') {
      return '<select class="inp" data-k="' + k + '" aria-label="' + esc(f.label) + '">' + (val ? '' : '<option value="" selected disabled>Choose…</option>') +
        f.opts.map(function (o) { var ov = typeof o === 'object' ? o.v : o, on = typeof o === 'object' ? o.n : o; return '<option value="' + esc(ov) + '"' + (val === ov ? ' selected' : '') + '>' + esc(on) + '</option>'; }).join('') + '</select>';
    }
    if (f.type === 'seg') return '<div class="seg" role="group" aria-label="' + esc(f.label) + '">' + f.opts.map(function (o) { return '<button type="button" data-seg="' + k + '" data-val="' + esc(o) + '" aria-pressed="' + (val === o) + '">' + esc(o) + '</button>'; }).join('') + '</div>';
    if (f.type === 'chips') return '<div class="chips" role="group" aria-label="' + esc(f.label) + '">' + f.opts.map(function (o) { return '<button type="button" data-chip="' + k + '" data-val="' + esc(o) + '" aria-pressed="' + ((val || []).indexOf(o) >= 0) + '">' + esc(o) + '</button>'; }).join('') + '</div>';
    return '<input class="inp' + (S.err[k] ? ' bad' : '') + '" data-k="' + k + '" value="' + esc(val || '') + '" placeholder="' + esc(f.ph || '') + '" aria-label="' + esc(f.label) + '"' + (S.err[k] ? ' aria-invalid="true"' : '') + '><button class="act xs" type="button" data-ok="' + k + '">Save</button>';
  }

  /* ── field sets (ONE owner per field: the six questions and the cards write the same keys) ─────────── */
  function kindName(id) { var x = D.KINDS.filter(function (k) { return k.id === id; })[0]; return x ? x.n : ''; }
  function F_name() { return { k: 'name', label: 'Business name', req: true, ph: 'Signboard name' }; }
  function F_logo() {
    return { k: 'logo', label: 'Logo', show: function () { return '<span class="thumb">' + CUP + '</span>'; },
      ctl: function () { return '<button class="act quiet sm" type="button" data-upload="logo">⬆ Upload</button><span class="dim" style="font-size:13px">square · PNG/JPG</span>'; } };
  }
  function F_kind() { return { k: 'kind', label: 'Kind of business', req: true, type: 'select', opts: D.KINDS.map(function (x) { return { v: x.id, n: x.n }; }), show: kindName }; }
  function F_nature() { return { k: 'nature', label: 'Nature of business', req: true, type: 'chips', opts: D.NATURE, show: function (x) { return esc(x.join(' · ')); } }; }
  function F_supply() { return { k: 'supply', label: 'What you supply', req: true, type: 'seg', opts: D.SUPPLY, infoText: S.c === 'IN' ? 'Goods use HSN codes, services use SAC codes on the bill.' : null }; }
  function F_addr() {
    return { k: 'addr', label: 'Address', req: true,
      show: function (x) { return '<span class="minimap">' + miniMap() + '</span><span>' + esc(x) + '</span>'; },
      ctl: function () { return '<button class="act quiet sm" type="button" data-pop="map">📍 Find on map</button>'; } };
  }
  function F_taxNo() {
    var c = C();
    return { k: 'taxNo', label: c.taxId, req: true, ph: c.taxIdHint };
  }
  function taxRows() {
    var c = C(), out = [];
    out.push({ k: 'taxReg', label: c.regQ, req: true, type: 'select', opts: [{ v: 'yes', n: 'Yes' }, { v: 'no', n: 'Not registered' }], show: function (x) { return x === 'yes' ? 'Yes' : 'Not registered'; } });
    if (S.v.taxReg === 'yes') {
      out.push(F_taxNo());
      if (c.hasTaxType) out.push({ k: 'taxType', label: 'GST type', req: true, type: 'select', opts: ['Regular', 'Composition'], infoText: 'Regular: GST on every bill, you claim input credit. Composition: a flat % of sales, no GST on the bill (bill of supply), no input credit, no sales to other states.' });
      var d = derivedIN();
      if (d) {
        out.push({ k: '_state', label: 'State', derived: true, show: function () { return esc(d.state); }, from: 'from ' + c.taxId });
        out.push({ k: '_pan', label: 'PAN', derived: true, show: function () { return '<span class="mono">' + esc(d.pan) + '</span>'; }, from: 'from ' + c.taxId });
        out.push({ k: '_str', label: 'Business structure', derived: true, show: function () { return esc(d.structure); }, from: d.letter + ' in the PAN' });
        if (d.letter === 'C') out.push({ k: 'cin', label: 'Company no. (CIN)', req: true, ph: '21 letters and digits' });
      }
    } else if (S.v.taxReg === 'no' && S.c === 'IN') {
      out.push({ k: 'pan', label: 'PAN', req: true, ph: '10 letters and digits' });
    }
    if (c.structure === 'ask') {
      out.push({ k: 'structure', label: 'Business structure', req: true, type: 'select', opts: c.structures });
      if (S.c === 'AU' && S.v.structure === 'Company') out.push({ k: 'acn', label: 'ACN', req: true, ph: '9 digits', show: function (x) { return '<span class="mono">' + esc(x) + '</span>'; } });
      if (c.tradeLicence) out.push({ k: 'tl', label: 'Trade licence no.', req: true, show: function (x) { return '<span class="mono">' + esc(x) + '</span>'; } });
    }
    out.push({ k: 'regd', label: c.regdLabel, req: true, ph: 'As on your registration' });
    return out;
  }

  function cards() {
    var c = C(), kind = S.v.kind;
    var lic = c.licences.filter(function (l) { return l.opt || !kind || l.kinds.indexOf(kind) >= 0; })
      .map(function (l) { return { k: l.k, label: l.n + (l.opt ? ' (optional)' : ''), req: !l.opt, show: function (x) { return '<span class="mono">' + esc(x) + '</span>'; } }; });
    var exp = [{ k: 'exportOn', label: 'Export', type: 'seg', opts: ['Off', 'On'] }];
    if (S.v.exportOn === 'On') c.exportRows.forEach(function (r) { exp.push({ k: r.k, label: r.n, req: r.req }); });
    return [
      { id: 'biz', icon: 'business', t: 'Name & kind', rows: [F_name(), F_logo(), F_kind(), F_nature(), F_supply(), { k: 'tagline', label: 'Tagline (optional)' }] },
      { id: 'contact', icon: 'contact', t: 'Contact & address', rows: [F_addr(), { k: 'phone', label: 'Phone', req: true, show: function (x) { return '<span class="mono">' + esc(x) + '</span>'; } }, { k: 'email', label: 'E-mail (optional)' }] },
      { id: 'tax', icon: 'tax', t: 'Tax & registration', rows: taxRows() },
      { id: 'lic', icon: 'lic', t: 'Licences', later: 'Asked at your first bill', rows: lic },
      { id: 'bank', icon: 'bank', t: 'Bank & payments', later: 'Asked at your first invoice', owner: 'finance', rows: [] },
      { id: 'sign', icon: 'sign', t: 'Who signs', later: 'Asked when a bill needs a signature', rows: [{ k: 'signer', label: 'Name', req: true }, { k: 'signerAs', label: 'As', type: 'select', opts: ['Owner', 'Proprietor', 'Partner', 'Director', 'Manager'] }, { k: 'signature', label: 'Signature', req: true, show: function () { return SCRIBBLE; }, ctl: function () { return '<button class="act quiet sm" type="button" data-upload="signature">✍ Sign here</button>'; } }] },
      { id: 'export', icon: 'export', t: 'Export', later: 'Only if you sell abroad', rows: exp, exportCard: true }
    ];
  }
  function status(cd) {
    if (cd.rows.some(function (r) { return S.err[r.k]; })) return { cls: 'red', t: '✕ Wrong', n: 1 };
    if (cd.owner === 'finance') return S.v.bank ? { cls: 'green', t: '✓ Done' } : { cls: 'quiet', t: 'Not needed yet' };
    if (cd.exportCard) return S.v.exportOn === 'On' ? (cd.rows.filter(function (r) { return r.req && !filled(r.k); }).length ? { cls: 'amber', t: 'To fill', n: 1 } : { cls: 'green', t: '✓ On' }) : { cls: 'quiet', t: 'Off' };
    var need = cd.rows.filter(function (r) { return r.req && !r.derived && !filled(r.k); }).length;
    var any = cd.rows.some(function (r) { return !r.derived && filled(r.k); });
    if (!need) return { cls: 'green', t: '✓ Done' };
    if (cd.later && !any) return { cls: 'quiet', t: 'Not needed yet' };
    return { cls: 'amber', t: need + ' to fill', n: need };
  }

  /* ── frame ───────────────────────────────────────────────────────────────────────────────────── */
  var ROUTES = [
    { id: 'start', t: 'Start here', icon: 'start', sid: 'SET010' }, { id: 'country', t: 'Country', icon: 'country', sid: 'SET002' },
    { id: 'business', t: 'Your business', icon: 'business', sid: 'SET001' }, { id: 'print', t: 'Print setup', icon: 'print', sid: 'SET003' },
    { id: 'counters', t: 'Counters', icon: 'counters', sid: 'SET004' }, { id: 'connectors', t: 'Connectors', icon: 'connectors', sid: 'SET005' },
    { id: 'policy', t: 'Policy', icon: 'policy', sid: 'SET006' }, { id: 'plan', t: 'Plan & usage', icon: 'plan', sid: 'SET007' }, { id: 'account', t: 'Account', icon: 'account', sid: 'SET008' }
  ];
  function route() { var r = (location.hash || '').replace(/^#\/?/, '') || (S.st === 'first' ? 'start' : 'business'); return ROUTES.some(function (x) { return x.id === r; }) ? r : 'business'; }
  function q6Done() { return QUESTIONS().filter(function (q) { return q.done(); }).length; }
  function nav() {
    var r = route(), left = 6 - q6Done();
    var biz = cards().map(status), bad = biz.some(function (s) { return s.cls === 'red'; });
    document.getElementById('nav').innerHTML = ROUTES.filter(function (x) { return x.id !== 'start' || left > 0 || r === 'start'; }).map(function (x) {
      var n = '';
      if (x.id === 'start' && left > 0) n = '<span class="n">' + left + '</span>';
      if (x.id === 'business' && bad) n = '<span class="n bad">!</span>';
      return '<a class="nav-btn' + (x.id === r ? ' active' : '') + (n ? ' has-n' + (bad && x.id === 'business' ? ' bad' : '') : '') + '" href="#/' + x.id + '"' + (x.id === r ? ' aria-current="page"' : '') + ' title="' + esc(x.t) + '">' + svg(x.icon) + '<span class="label">' + esc(x.t) + '</span>' + n + '</a>';
    }).join('');
  }
  function bar() {
    var r = ROUTES.filter(function (x) { return x.id === route(); })[0];
    document.getElementById('bar').innerHTML =
      '<span class="mark" aria-hidden="true">' + svg('till') + '</span>' +
      '<button class="shop" type="button">' + esc(S.v.name || 'New business') + ' <span class="chev">▼</span></button>' +
      '<span class="swb">⚙ CB Settings <span class="chev">▼</span></span><span class="grow"></span>' +
      '<span class="sid">' + esc(r.t) + ' · <span class="mono">' + r.sid + '</span></span>' +
      '<span class="hb" aria-label="Notifications">🔔</span><a class="hb" href="#/business" aria-label="Home">⌂<span class="t"> Home</span></a>' +
      '<span class="av" aria-label="You">' + esc(C().me.name.replace(/^S\. /, '').charAt(0)) + '</span>';
  }
  function proto() {
    var p = document.getElementById('proto');
    function g(label, key, list) { return '<span class="grp"><i>' + label + '</i>' + list.map(function (x) { return '<button type="button" data-proto="' + key + '" data-val="' + x[0] + '" aria-pressed="' + (S[key] === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</span>'; }
    p.innerHTML = '<b>Prototype only — do not build</b>' +
      g('Country', 'c', [['IN', 'IN ₹'], ['AU', 'AU A$'], ['AE', 'AE AED']]) +
      g('State', 'st', Object.keys(D.STATES).map(function (k) { return [k, D.STATES[k].n]; })) +
      g('Theme', 'theme', [['cream', 'Cream'], ['dark', 'Dark'], ['terminal', 'Terminal']]);
    document.documentElement.style.setProperty('--proto-h', p.offsetHeight + 'px');
  }
  function applyTheme() {
    var root = document.documentElement, t = D.THEMES[S.theme] || D.THEMES.cream;
    Object.keys(D.THEMES).forEach(function (k) { Object.keys(D.THEMES[k].vars).forEach(function (n) { root.style.removeProperty(n); }); });
    Object.keys(t.vars).forEach(function (n) { root.style.setProperty(n, t.vars[n]); });
    if (S.theme === 'cream') { root.removeAttribute('data-themed'); root.removeAttribute('data-theme'); } else { root.setAttribute('data-themed', ''); root.setAttribute('data-theme', S.theme); }
    if (t.mono) root.style.setProperty('--f-ui', "'IBM Plex Mono','Space Mono',ui-monospace,monospace"); else root.style.removeProperty('--f-ui');
  }

  /* ── screens ─────────────────────────────────────────────────────────────────────────────────── */
  function title(t, opt, end) { return '<div class="ptitle"><h1>' + esc(t) + (opt ? ' <small>(optional)</small>' : '') + '</h1>' + (end ? '<div class="end">' + end + '</div>' : '') + '</div>'; }

  function QUESTIONS() {
    var c = C();
    return [
      { f: { k: 'country', label: 'Country', req: true, lock: true, type: 'select', opts: Object.keys(D.C).map(function (k) { return { v: k, n: D.C[k].name }; }), show: function () { return esc(c.name); } }, done: function () { return true; } },
      { f: F_kind(), done: function () { return filled('kind'); } },
      { f: { k: 'nature', label: 'Nature · what you supply', req: true,
          show: function () { return esc(S.v.nature.join(' · ') + ' · ' + S.v.supply); },
          ctl: function () { return control(F_nature()) + control(F_supply()); } }, done: function () { return filled('nature') && filled('supply'); }, k2: 'supply' },
      { f: { k: 'taxNo', label: c.taxId + ' (or not registered)', ph: c.taxIdHint,
          show: function (x) { return S.v.taxReg === 'no' ? 'Not registered' : '<span class="mono">' + esc(x) + '</span>' + (c.hasTaxType && S.v.taxType ? ' <span class="dim">· ' + esc(S.v.taxType) + '</span>' : ''); },
          ctl: function () { return '<input class="inp' + (S.err.taxNo ? ' bad' : '') + '" data-k="taxNo" value="' + esc(S.v.taxNo || '') + '" placeholder="' + esc(c.taxIdHint) + '" aria-label="' + esc(c.taxId) + '"><button class="act xs" type="button" data-ok="taxNo">Save</button><button class="act quiet xs" type="button" data-notreg="1">Not registered</button>'; } },
        done: function () { return (filled('taxNo') && !S.err.taxNo) || S.v.taxReg === 'no'; } },
      { f: { k: 'name', label: 'Business name · logo', req: true, ph: 'Signboard name',
          show: function (x) { return (S.v.logo ? '<span class="thumb">' + CUP + '</span>' : '<button class="act quiet xs" type="button" data-upload="logo">⬆ Logo</button>') + '<span>' + esc(x) + '</span>'; } }, done: function () { return filled('name'); } },
      { f: F_addr(), done: function () { return filled('addr'); } }
    ];
  }
  function scrStart() {
    var qs = QUESTIONS(), n = qs.filter(function (q) { return q.done(); }).length, c = C();
    var h = title('Set up your business', false, '<span class="dots" aria-hidden="true">' + qs.map(function (q) { return '<i class="' + (q.done() ? 'on' : '') + '"></i>'; }).join('') + '</span><span class="prog">' + n + ' of 6</span>');
    h += '<div class="q6">' + qs.map(function (q, i) {
      var f = Object.assign({}, q.f); if (q.k2 && !q.done()) f.forceOpen = true;
      var pre = '<span class="qn' + (q.done() ? ' ok' : '') + '" aria-hidden="true">' + (q.done() ? '✓' : i + 1) + '</span>';
      f.pre = pre;
            if (f.k === 'taxNo' && S.v.taxReg === 'no') { var t = S.v.taxNo; S.v.taxNo = 'no'; var hh = row(f); S.v.taxNo = t; return hh; }
      return row(f);
    }).join('') + '</div>';
    if (n === 6) h += '<div class="done-bar"><span class="tag green" style="height:30px;font-size:13.5px">✓ Ready to bill</span><a class="act" href="#/business">Open the counter ›</a><a class="act quiet" href="#/business">Your business ›</a></div>';
    /* 6 inputs → 7 layers: what got set, and from where */
    var set = [['Money', c.money, c.name + ' pack'], ['Year starts', c.yearStarts, c.name + ' pack'], ['Tax', c.tax + (S.c === 'IN' ? ' · CGST + SGST / IGST' : S.c === 'AU' ? ' 10% · ' + c.returns : ' 5% · ' + c.returns), c.name + ' pack'], ['Payments', c.tenders, c.name + ' pack'], ['Dates and numbers', c.looks, c.name + ' pack']];
    if (S.v.kind) {
      var kn = kindName(S.v.kind);
      set.push(['Bill paper', '80 mm slip', kn], ['Units', 'cup · plate · piece', kn], ['Item tax', S.c === 'IN' ? '5% (eat-in service)' : S.c === 'AU' ? '10% (café sales)' : '5% (standard)', kn], ['Licences asked', c.licences[0].n, kn], ['Policy', '9 rules set', kn]);
    }
    h += '<details class="fold"' + (n === 6 ? ' open' : '') + '><summary><span class="tw">▸</span>Set for you <span class="tag">' + set.length + '</span>' + info('Your answers set these. Change any of them later; nothing here is needed to start.') + '</summary><div class="body">' +
      '<div class="tbl" style="border:0"><div class="tg" style="--cols:minmax(120px,1fr) minmax(140px,1.6fr) minmax(110px,1fr)"><div class="hc">Setting</div><div class="hc">Now</div><div class="hc">From</div>' +
      set.map(function (s) { return '<div class="tr"><div class="c strong">' + esc(s[0]) + '</div><div class="c" data-l="Now">' + esc(s[1]) + '</div><div class="c" data-l="From"><span class="tag src">' + esc(s[2]) + '</span></div></div>'; }).join('') + '</div></div></div></details>';
    return h;
  }

  function scrCountry() {
    var c = C();
    var rows = [
      { k: 'country', label: 'Country', req: true, lock: true, show: function () { return esc(c.name); }, type: 'select', opts: Object.keys(D.C).map(function (k) { return { v: k, n: D.C[k].name }; }) },
      { k: '_money', label: 'Money', lock: true, derived: true, show: function () { return esc(c.money); }, from: 'from country' },
      { k: '_year', label: 'Year starts', derived: true, show: function () { return esc(c.yearStarts); }, from: 'from country' },
      { k: '_tz', label: 'Time zone', derived: true, show: function () { return esc(c.tz); } },
      { k: '_big', label: 'Big numbers', derived: true, show: function () { return esc(c.big); } },
      { k: '_looks', label: 'Looks like', derived: true, show: function () { return '<span class="mono">' + esc(c.looks) + '</span>'; } },
      { k: '_tax', label: 'Tax', derived: true, show: function () { return esc(c.tax + ' · ' + c.taxId + ' · ' + c.returns); } }
    ];
    /* the derived rows here are pack values: editable in the product (✎), shown read-only in this mock to keep it short */
    return title('Country') + '<div class="card" style="max-width:720px"><div class="rows">' + rows.map(row).join('') + '</div></div>';
  }

  function scrBusiness() {
    var cs = cards(), st = cs.map(status), h = '';
    var doneN = st.filter(function (s) { return s.cls === 'green'; }).length;
    h += title('Your business', false, '<span class="prog">' + doneN + ' of 7 done</span>');
    if (S.err.taxNo) h += '<div class="alert" role="alert">✕ ' + esc(C().taxId) + ' is wrong<button class="act sm" type="button" data-goto="taxNo">Fix</button></div>';
    else if (6 - q6Done() > 0) h += '<div class="alert amber">' + (6 - q6Done()) + ' setup questions left<a class="act sm" href="#/start">Answer ›</a></div>';
    h += '<div class="cards">' + cs.map(function (cd, i) {
      var s = st[i], body;
      if (cd.owner === 'finance') {
        body = S.v.bank ? '<div class="rows"><div class="row"><div class="lb">Bank</div><div class="v">' + esc(C().bankLine) + '</div><div class="end"></div></div><div class="row"><div class="lb">' + esc(C().payName) + '</div><div class="v">' + esc(C().payLine.replace(/^[^·]+· /, '')) + '</div><div class="end"></div></div></div>'
          : '<div class="later"><span>' + esc(cd.later) + '</span><button class="act quiet xs" type="button" data-pop="bank">Add now</button></div>';
      } else if (cd.exportCard && S.v.exportOn !== 'On') {
        body = '<div class="later"><span>' + esc(cd.later) + '</span><button class="act quiet xs" type="button" data-seg="exportOn" data-val="On">Turn on</button></div>';
      } else if (cd.later && s.cls === 'quiet' && !cd.exportCard && S.open !== cd.id) {
        body = '<div class="later"><span>' + esc(cd.later) + '</span><button class="act quiet xs" type="button" data-open="' + cd.id + '">Fill now</button></div>';
      } else body = '<div class="rows">' + cd.rows.map(row).join('') + '</div>';
      var head = '<div class="ch"><span class="ic">' + svg(cd.icon) + '</span><h2>' + esc(cd.t) + '</h2><span class="st tag ' + s.cls + '">' + esc(s.t) + '</span>' +
        (cd.owner === 'finance' && S.v.bank ? pen('bank', 'bank and payments').replace('data-edit="bank"', 'data-pop="bank"') : '') + '</div>';
      return '<section class="card' + (s.cls === 'red' ? ' bad' : '') + '" aria-label="' + esc(cd.t) + '">' + head + body + '</section>';
    }).join('') + '</div>';
    return h;
  }

  function billHTML(id) {
    var c = C(), b = c.bill, v = S.v, wide = ['A5', 'A4', 'A3', 'Letter'].indexOf(S.paper) >= 0;
    var W = { '58': 230, '80': 300, 'A5': 440, 'A4': 600, 'A3': 680, 'Letter': 600 }[S.paper];
    var ph = function (x, p) { return x ? esc(x) : '<span class="ph">' + p + '</span>'; };
    var choice = S.choice.filter(function (x) { return x.on; }).map(function (x) {
      if (x.k === 'phone') return v.phone ? '<div>☎ ' + esc(v.phone) + '</div>' : '';
      if (x.k === 'email') return v.email ? '<div>' + esc(v.email) + '</div>' : '';
      if (x.k === 'regd') return v.regd && v.regd !== v.name ? '<div class="regd">Regd. name: ' + esc(v.regd) + '</div>' : '';
      if (x.k === 'tagline') return v.tagline ? '<div>' + esc(v.tagline) + '</div>' : '';
      return '';
    }).join('');
    var footOn = S.choice.filter(function (x) { return x.k === 'footer'; })[0].on;
    var d = derivedIN();
    var hd = '<div class="hd">' + (v.logo ? '<div class="lg">' + CUP + '</div>' : '') + '<div class="nm">' + ph(v.name, 'Business name') + '</div><div>' + ph(v.addr, 'Address') + '</div>' +
      (v.taxNo && !S.err.taxNo && v.taxReg !== 'no' ? '<div>' + esc(c.taxId) + ' ' + esc(v.taxNo) + '</div>' : '<div><span class="ph">' + esc(c.taxId) + '</span></div>') +
      (d ? '<div>State: ' + esc(d.state) + '</div>' : '') + choice + '</div>';
    var lines;
    if (wide) {
      lines = '<table><thead><tr><th>#</th><th>Item</th>' + (b.codeHead ? '<th>' + b.codeHead + '</th>' : '') + '<th class="r">Qty</th><th class="r">Rate</th><th class="r">' + b.taxHead + '</th><th class="r">Amount</th></tr></thead><tbody>' +
        b.lines.map(function (l, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(l.n) + '</td>' + (b.codeHead ? '<td>' + l.code + '</td>' : '') + '<td class="r">' + l.q + '</td><td class="r">' + l.r + '</td><td class="r">' + l.tx + '</td><td class="r">' + l.a + '</td></tr>'; }).join('') + '</tbody></table>';
    } else {
      lines = '<table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amt</th></tr></thead><tbody>' +
        b.lines.map(function (l) { return '<tr><td>' + esc(l.n) + '<br><span style="font-size:11px">@ ' + l.r + '</span></td><td class="r">' + l.q + '</td><td class="r">' + l.a + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    var sum = '<div class="sum">' + b.sum.map(function (s) { return '<span>' + s[0] + '</span><span class="r">' + s[1] + '</span>'; }).join('') +
      '<span class="big">Total</span><span class="big r">' + b.total + '</span></div>' + (b.note ? '<div>' + b.note + '</div>' : '') + '<div>' + b.paid + '</div>';
    return '<div class="bill' + (wide ? ' wide' : '') + '" id="' + (id || 'printme') + '" style="--pw:' + W + 'px" aria-label="Sample bill">' + hd +
      '<div class="ttl">' + b.title + '</div><div class="meta"><span>No. ' + b.no + '</span><span>' + b.date + ' ' + b.time + '</span></div>' + lines + sum +
      (footOn && S.foot ? '<div class="ft">' + esc(S.foot) + '</div>' : '') + '</div>';
  }
  function scrPrint() {
    var c = C(), v = S.v, d = derivedIN();
    var fixed = [['Logo', v.logo ? '<span class="thumb">' + CUP + '</span>' : '<span class="dim">—</span>'], ['Business name', v.name ? esc(v.name) : '<span class="dim">—</span>'], ['Address', v.addr ? esc(v.addr) : '<span class="dim">—</span>'], [c.taxId, v.taxNo && !S.err.taxNo ? '<span class="mono">' + esc(v.taxNo) + '</span>' : '<span class="dim">—</span>']];
    if (S.c === 'IN') fixed.push(['State', d ? esc(d.state) : '<span class="dim">—</span>']);
    var h = title('Print setup');
    var left = '<section class="card fixed"><div class="ch"><h2>Always on a tax invoice</h2>' + info('The law asks for these, in this order. Change them in Your business.') + '</div><div class="rows">' +
      fixed.map(function (f, i) { return '<div class="row"><span class="ord">' + (i + 1) + '</span><div class="lb">' + esc(f[0]) + '</div><div class="v">' + f[1] + '</div></div>'; }).join('') +
      '</div><a class="act ghost sm" href="#/business" style="align-self:flex-start">Your business ›</a></section>';
    left += '<section class="card choice"><div class="ch"><h2>Your choice</h2></div><div class="rows">' + S.choice.map(function (x, i) {
      var val = x.k === 'footer' ? (S.editing === 'foot' ? '<div class="ctl"><input class="inp" data-k="foot" value="' + esc(S.foot) + '" aria-label="Footer"><button class="act xs" type="button" data-ok="foot">Save</button></div>' : esc(S.foot))
        : (v[x.k] ? esc(v[x.k]) : '<span class="dim">—</span>');
      return '<div class="row"><input type="checkbox" data-tick="' + i + '"' + (x.on ? ' checked' : '') + ' aria-label="Show ' + esc(x.n) + ' on the bill"><div class="lb">' + esc(x.n) + '</div><div class="v">' + val + '</div><div class="end">' +
        (x.k === 'footer' && S.editing !== 'foot' ? (S.saved === 'foot' ? '<span class="saved">✓ Saved</span>' : pen('foot', 'footer')) : '') +
        '<button class="mv" type="button" data-mv="' + i + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">↑</button><button class="mv" type="button" data-mv="' + i + '" data-d="1"' + (i === S.choice.length - 1 ? ' disabled' : '') + ' aria-label="Move down">↓</button></div></div>';
    }).join('') + '</div></section>';
    var papers = ['58', '80', 'A5', 'A4', 'A3', 'Letter'];
    var right = '<section class="paperpane" aria-label="Sample bill"><div class="tools"><div class="seg" role="group" aria-label="Paper">' + papers.map(function (p) { return '<button type="button" data-paper="' + p + '" aria-pressed="' + (S.paper === p) + '">' + (/^\d/.test(p) ? p + ' mm' : p) + '</button>'; }).join('') +
      '</div><div class="end"><button class="act quiet sm" type="button" data-pop="preview">⤢ Preview</button><button class="act sm" type="button" data-print="1">⎙ Print</button></div></div>' + billHTML() + '</section>';
    return h + '<div class="pset"><div style="display:flex;flex-direction:column;gap:14px;min-width:0">' + left + '</div>' + right + '</div>';
  }

  var COLS = {};
  function tbl(id, head, defCols, rows, tt) {
    var cols = COLS[id] || defCols;
    return '<div class="tbl" data-tbl="' + id + '">' + (tt || '') + '<div class="tg" style="--cols:' + cols.join(' ') + '">' +
      head.map(function (hd, i) { return '<div class="hc' + (hd.r ? ' r' : '') + '">' + esc(hd.t) + (i < head.length - 1 && hd.t ? '<button class="rz" type="button" data-rz="' + id + '" data-i="' + i + '" aria-label="Resize column"></button>' : '') + '</div>'; }).join('') +
      rows.join('') + '</div></div>';
  }
  function scrPolicy() {
    var list = S.policy.filter(function (p) { return !S.q || p.r.toLowerCase().indexOf(S.q.toLowerCase()) >= 0; });
    var rows = list.map(function (p) {
      var i = S.policy.indexOf(p), k = 'pol' + i, now;
      if (S.editing === k) now = '<select class="inp" data-pol="' + i + '" aria-label="' + esc(p.r) + '">' + p.opts.map(function (o) { return '<option' + (o === p.now ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      else now = '<span>' + esc(p.now) + '</span>' + (S.saved === k ? '<span class="saved">✓ Saved</span>' : p.opts ? pen(k, p.r) : '');
      var who = p.link ? '<a class="tag blue" href="#/' + p.link + '">' + esc(p.who) + ' ›</a>' : '<span class="tag' + (p.who === 'You' ? ' green' : '') + '">' + esc(p.who) + '</span>';
      return '<div class="tr"><div class="c strong">' + esc(p.r) + '</div><div class="c" data-l="Now">' + now + '</div><div class="c" data-l="Who">' + who + '</div><div class="c r">' + info('Where it acts: ' + p.where) + '</div></div>';
    });
    var tt = '<div class="tt"><input class="inp" style="max-width:300px" placeholder="🔍 Find a rule" value="' + esc(S.q) + '" data-search="1" aria-label="Find a rule"><div class="end"><span class="count">' + list.length + ' rules</span></div></div>';
    return title('Policy', true) + tbl('policy', [{ t: 'Rule' }, { t: 'Now' }, { t: 'Who may change it' }, { t: '' }], ['minmax(200px,1.4fr)', 'minmax(170px,1fr)', 'minmax(150px,1fr)', '44px'], rows, tt);
  }
  function scrConnectors() {
    var c = C(), h = title('Connectors'), pcs = S.st === 'first' ? null : c.pcs;
    if (pcs) {
      h += '<section class="running" aria-label="On your PCs"><div class="rh"><span class="dot green"></span>On your PCs</div>' +
        '<div class="rl"><span class="dot green"></span><b>' + esc(pcs.run.c) + '</b><span>Running · ' + esc(pcs.run.pc) + '</span><span class="dim mono" style="font-size:12.5px">seen ' + esc(pcs.run.seen) + '</span></div>' +
        (pcs.stop && S.st === 'all' ? '<div class="rl"><span class="dot amber"></span><b>' + esc(pcs.stop.c) + '</b><span style="color:var(--amber-i);font-weight:600">Stopped · ' + esc(pcs.stop.pc) + '</span><span class="dim mono" style="font-size:12.5px">last seen ' + esc(pcs.stop.seen) + '</span><span class="end"><button class="act sm" type="button" data-guide="csv">How to restart</button></span></div>' : '') +
        '</section>';
    }
    var runId = pcs ? c.connectors.filter(function (x) { return x.n === pcs.run.c; })[0] : null;
    var rows = c.connectors.map(function (x) {
      var st = runId && runId.id === x.id ? '<span class="tag green">● Running</span>' : x.ok ? '<span class="tag">Available</span>' : '<span class="dim">' + esc(x.why) + '</span>';
      return '<div class="tr"><div class="c strong">' + esc(x.n) + '</div><div class="c" data-l="Status">' + st + '</div><div class="c r"><button class="act quiet xs" type="button" data-guide="' + x.id + '"' + (x.ok ? '' : ' disabled') + '>📄 Guide</button><button class="act xs" type="button" data-dl="' + esc(x.n) + '"' + (x.ok ? '' : ' disabled') + '>⬇ Download</button></div></div>';
    });
    return h + tbl('conn', [{ t: 'Connector' }, { t: 'Status' }, { t: '', r: true }], ['minmax(170px,1.2fr)', 'minmax(140px,1fr)', 'minmax(210px,auto)'], rows);
  }
  function scrCounters() {
    var c = C(), list = S.st === 'first' ? [] : S.st === 'all' ? c.counters : c.counters.slice(0, 1);
    var end = '<button class="act quiet sm" type="button" data-toast="The browser asks to install the counter · one icon, works offline">⬇ Install counter</button><button class="act sm" type="button" data-toast="Counter C' + (list.length + 1) + ' added">+ Add a counter</button>';
    var h = title('Counters', true, end);
    if (!list.length) return h + '<div class="card" style="max-width:560px;align-items:flex-start"><h2>No counters yet</h2></div>';
    return h + tbl('ctr', [{ t: 'Counter' }, { t: 'Device that holds it' }, { t: 'Seen', r: true }], ['minmax(170px,1fr)', 'minmax(190px,1.3fr)', 'minmax(110px,.6fr)'],
      list.map(function (x) { return '<div class="tr"><div class="c strong">' + esc(x.n) + '</div><div class="c" data-l="Device">' + esc(x.dev) + '</div><div class="c r mono" data-l="Seen"><span class="dot green"></span>' + esc(x.seen) + '</div></div>'; }));
  }
  function scrAccount() {
    var m = C().me;
    if (!S.me) S.me = { mname: m.name, memail: m.email, mphone: m.phone };
    Object.assign(S.v, S.me);
    var rows = [{ k: 'mname', label: 'Name', req: true }, { k: '_uid', label: 'User ID', derived: true, show: function () { return '<span class="mono">' + esc(m.id) + '</span>'; }, lock: false, infoText: 'Your sign-in name. It never changes.' },
      { k: 'memail', label: 'E-mail', req: true }, { k: 'mphone', label: 'Phone (optional)', show: function (x) { return '<span class="mono">' + esc(x) + '</span>'; } }];
    var h = title('Account') + '<section class="card" style="max-width:720px"><div class="ch"><h2>You</h2></div><div class="rows">' + rows.map(row).join('') + '</div></section>';
    var dev = [['This laptop · Chrome', 'now', true], ['Phone · Android', 'yesterday, 21:04', false]];
    var tt = '<div class="tt"><h2>Signed in on</h2><div class="end"><button class="act quiet sm" type="button" data-toast="Signed out everywhere else">Sign out everywhere else</button></div></div>';
    h += tbl('dev', [{ t: 'Device' }, { t: 'Last seen' }, { t: '', r: true }], ['minmax(180px,1.3fr)', 'minmax(140px,1fr)', 'minmax(120px,auto)'],
      dev.map(function (d) { return '<div class="tr"><div class="c strong">' + esc(d[0]) + (d[2] ? ' <span class="tag green">This device</span>' : '') + '</div><div class="c mono" data-l="Seen">' + esc(d[1]) + '</div><div class="c r"><button class="act ' + (d[2] ? '' : 'quiet ') + 'xs" type="button" data-toast="Signed out">Sign out</button></div></div>'; }), tt);
    return h;
  }
  function scrPlan() {
    var p = C().plan;
    var h = title('Plan & usage', false, '<span class="tag blue" style="height:28px;font-size:13px">' + esc(p.name) + '</span>');
    h += tbl('plan', [{ t: 'Limit' }, { t: 'Allowed', r: true }, { t: 'Used', r: true }], ['minmax(180px,1.4fr)', 'minmax(110px,1fr)', 'minmax(90px,1fr)'],
      p.rows.map(function (r) { return '<div class="tr"><div class="c strong">' + esc(r[0]) + '</div><div class="c r mono" data-l="Allowed">' + esc(r[1]) + '</div><div class="c r mono" data-l="Used">' + esc(r[2]) + '</div></div>'; }));
    h += '<section class="card" style="max-width:720px"><div class="rows"><div class="row"><div class="lb">Usage · last 30 days' + info('Billed in US dollars, whatever your country.') + '</div><div class="v mono">' + esc(p.usage) + '</div><div class="end"></div></div></div></section>';
    return h;
  }

  /* ── popups ──────────────────────────────────────────────────────────────────────────────────── */
  function miniMap() { return '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M0 14h64M0 30h64M18 0v40M44 0v40" style="stroke:var(--line-3);stroke-width:3"/><path d="M0 4l64 30" style="stroke:var(--surface);stroke-width:4"/><circle cx="32" cy="20" r="4" style="fill:var(--red);stroke:var(--surface);stroke-width:1.5"/></svg>'; }
  function bigMap() {
    return '<svg class="m" viewBox="0 0 600 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="stroke:none"><rect width="600" height="220" style="fill:var(--panel)"/>' +
      '<path d="M0 60h600M0 150h600M120 0v220M300 0v220M470 0v220" style="stroke:var(--surface);stroke-width:14"/><path d="M0 200L600 20" style="stroke:var(--surface);stroke-width:20"/>' +
      '<path d="M0 105h600M210 0v220M390 0v220" style="stroke:var(--line);stroke-width:5"/><rect x="320" y="165" width="130" height="45" rx="6" style="fill:var(--green-t)"/>' +
      '<text x="20" y="52" style="fill:var(--muted);font:600 12px var(--sans)">' + esc((sh().parts[1] || '')) + '</text><text x="330" y="192" style="fill:var(--green-d);font:600 11px var(--sans)">Park</text></svg>';
  }
  function popMap() {
    var c = C(), s = sh(), parts = filled('addr') || S.pickAddr ? s.parts : c.addrParts.map(function () { return ''; });
    return '<div class="scrim" data-close="1"><div class="dlg" role="dialog" aria-modal="true" aria-label="Address"><div class="dh"><h2>Address</h2><button class="x" type="button" data-close="1" aria-label="Close">✕</button></div><div class="db">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="inp" style="flex:1 1 220px" value="' + esc(S.pickAddr || filled('addr') ? c.search[0] : '') + '" placeholder="Search your street or area" aria-label="Search"><button class="act quiet sm" type="button" data-here="1">◎ Where I am</button></div>' +
      (S.pickAddr || filled('addr') ? '' : '<div class="sugg">' + c.search.map(function (x) { return '<button type="button" data-pick="1">📍 ' + esc(x) + '</button>'; }).join('') + '</div>') +
      '<div class="mapbox" data-map="1">' + bigMap() + '<span class="pin" style="left:' + S.pin.x + '%;top:' + S.pin.y + '%"><svg viewBox="0 0 24 24"><path d="M12 22s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z"/><circle cx="12" cy="10" r="2.5" style="fill:var(--surface)"/></svg></span></div>' +
      '<div class="parts">' + c.addrParts.map(function (p, i) { return '<label>' + esc(p) + (i >= c.addrParts.length - 1 || /Makani/.test(p) ? '' : ' *') + '<input class="inp" value="' + esc(parts[i] || '') + '"></label>'; }).join('') + '</div>' +
      '</div><div class="df"><button class="act quiet" type="button" data-close="1">Cancel</button><button class="act" type="button" data-useaddr="1">Use this address</button></div></div></div>';
  }
  function popBank() {
    var c = C(), has = S.v.bank;
    return '<div class="scrim" data-close="1"><div class="dlg" role="dialog" aria-modal="true" aria-label="Bank accounts" style="width:min(620px,100%)"><div class="dh"><div><div class="from"><span class="logo">$</span>CB Finance › Bank accounts</div><h2>Bank & payments</h2></div><button class="x" type="button" data-close="1" aria-label="Close">✕</button></div><div class="db"><div class="rows">' +
      (has ? '<div class="row"><div class="lb">Main account</div><div class="v">' + esc(c.bankLine) + ' <span class="tag green">✓ On bills</span></div><div class="end">' + pen('_b1', 'bank') + '</div></div><div class="row"><div class="lb">' + esc(c.payName) + '</div><div class="v">' + esc(c.payLine.replace(/^[^·]+· /, '')) + '</div><div class="end">' + pen('_b2', c.payName) + '</div></div>'
        : '<div class="row"><div class="lb">Bank<span class="req">*</span></div><div class="v"><div class="ctl"><input class="inp" placeholder="Bank name"><input class="inp" placeholder="Account no."></div></div><div class="end"></div></div><div class="row"><div class="lb">' + esc(c.payName) + ' (optional)</div><div class="v"><div class="ctl"><input class="inp"></div></div><div class="end"></div></div>') +
      '</div>' + (has ? '<button class="act ghost sm" type="button" data-toast="A second account (prototype)" style="align-self:flex-start">+ Add a bank account</button>' : '') +
      '</div><div class="df">' + (has ? '<button class="act" type="button" data-close="1">Done</button>' : '<button class="act quiet" type="button" data-close="1">Cancel</button><button class="act" type="button" data-addbank="1">Save</button>') + '</div></div></div>';
  }
  function popPreview() {
    var W = { '58': 230, '80': 300, 'A5': 440, 'A4': 600, 'A3': 680, 'Letter': 600 }[S.paper];
    var z = Math.max(1, Math.min(/^\d/.test(S.paper) ? 1.7 : 1.25, (window.innerWidth - 40) / W));
    return '<div class="overlay" data-close="1" role="dialog" aria-modal="true" aria-label="Preview"><button class="act quiet x" type="button" data-close="1" style="background:var(--surface)">✕ Close</button><div style="zoom:' + z.toFixed(2) + '">' + billHTML('pv') + '</div></div>';
  }
  function layer() {
    var L = document.getElementById('layer');
    L.innerHTML = S.pop === 'map' ? popMap() : S.pop === 'bank' ? popBank() : S.pop === 'preview' ? popPreview() : '';
  }

  /* ── render + events ─────────────────────────────────────────────────────────────────────────── */
  function render() {
    var ae = document.activeElement, fk = ae && ae.getAttribute && (ae.getAttribute('data-k') || ae.getAttribute('data-search')), sel = ae && ae.selectionStart;
    applyTheme(); proto(); nav(); bar();
    var r = route(), scr = { start: scrStart, country: scrCountry, business: scrBusiness, print: scrPrint, policy: scrPolicy, connectors: scrConnectors, counters: scrCounters, account: scrAccount, plan: scrPlan }[r];
    document.getElementById('screen').innerHTML = '<div class="content">' + scr() + '</div>';
    layer();
    var t = fk ? document.querySelector('[data-k="' + fk + '"],[data-search="' + fk + '"]') : (S.focus ? document.querySelector('[data-k="' + S.focus + '"]') : null);
    if (t) { t.focus(); try { if (sel != null && t.setSelectionRange) t.setSelectionRange(sel, sel); } catch (e) { } }
    S.focus = null;
  }
  function flash(k) { S.saved = k; clearTimeout(flash.t); flash.t = setTimeout(function () { S.saved = null; render(); }, 2200); }
  function save(k, val) {
    if (k === 'foot') { S.foot = val; S.editing = null; flash('foot'); return render(); }
    if (k === 'country') { S.c = val; load(); S.v.country = val; flash('country'); return render(); }
    if (k === 'taxNo') {
      var why = checkTax(val); S.v.taxNo = val.toUpperCase().trim();
      if (why) { S.err.taxNo = why; S.editing = 'taxNo'; S.focus = 'taxNo'; return render(); }
      delete S.err.taxNo; S.v.taxReg = 'yes';
      if (S.c === 'IN' && !S.v.taxType) S.v.taxType = 'Regular';
    } else S.v[k] = val;
    if (k.charAt(0) === 'm' && S.me) S.me[k] = val;
    if (k === 'taxReg' && val === 'no') { delete S.err.taxNo; S.v.taxNo = ''; }
    S.editing = null; flash(k); render();
  }
  function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600); }
  function closeInfo() { var p = document.querySelector('.pop'); if (p) p.remove(); }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button,a,[data-map],[data-close]'); if (!t) { closeInfo(); return; }
    var a = function (n) { return t.getAttribute(n); };
    if (a('data-info') != null) { e.stopPropagation(); e.preventDefault(); closeInfo(); var p = document.createElement('div'); p.className = 'pop'; p.setAttribute('role', 'tooltip'); p.textContent = a('data-info'); document.body.appendChild(p); var r = t.getBoundingClientRect(); p.style.top = Math.min(r.bottom + 6, innerHeight - p.offsetHeight - 8) + 'px'; p.style.left = Math.max(8, Math.min(r.left - 10, innerWidth - p.offsetWidth - 8)) + 'px'; return; }
    closeInfo();
    if (a('data-proto')) { var k = a('data-proto'), val = a('data-val'); S[k] = val; if (k !== 'theme') load(); if (k === 'st' && val === 'first') location.hash = '#/start'; render(); return; }
    if (a('data-edit')) { S.editing = a('data-edit'); S.saved = null; S.focus = a('data-edit'); render(); return; }
    if (a('data-cancel')) { S.editing = null; render(); return; }
    if (a('data-ok')) { var k2 = a('data-ok'), inp = document.querySelector('[data-k="' + k2 + '"]'); if (inp && inp.value.trim()) save(k2, inp.value.trim()); return; }
    if (a('data-seg')) { save(a('data-seg'), a('data-val')); return; }
    if (a('data-chip')) { var ck = a('data-chip'), cur = (S.v[ck] || []).slice(), cv = a('data-val'), ix = cur.indexOf(cv); if (ix >= 0) cur.splice(ix, 1); else cur.push(cv); S.v[ck] = cur; if (cur.length) flash(ck); render(); return; }
    if (a('data-notreg')) { S.v.taxReg = 'no'; S.v.taxNo = ''; delete S.err.taxNo; S.editing = null; flash('taxNo'); render(); return; }
    if (a('data-upload')) { save(a('data-upload'), true); return; }
    if (a('data-open')) { S.open = a('data-open'); render(); return; }
    if (a('data-goto')) { S.editing = a('data-goto'); S.focus = a('data-goto'); render(); var el = document.querySelector('[data-row="' + a('data-goto') + '"]'); if (el) el.scrollIntoView({ block: 'center' }); return; }
    if (a('data-pop')) { S.pop = a('data-pop'); S.pickAddr = null; layer(); return; }
    if (a('data-close') && (t === e.target || t.tagName === 'BUTTON')) { S.pop = null; layer(); return; }
    if (a('data-pick')) { S.pickAddr = true; layer(); return; }
    if (a('data-here')) { S.pickAddr = true; S.pin = { x: 50, y: 50 }; layer(); return; }
    if (a('data-useaddr')) { S.pop = null; S.pickAddr = null; save('addr', sh().addr); return; }
    if (a('data-addbank')) { S.pop = null; save('bank', true); return; }
    if (a('data-paper')) { S.paper = a('data-paper'); render(); return; }
    if (a('data-mv')) { var i = +a('data-mv'), d = +a('data-d'), x = S.choice.splice(i, 1)[0]; S.choice.splice(i + d, 0, x); render(); return; }
    if (a('data-print')) { window.print(); return; }
    if (a('data-guide')) { if (a('data-guide') === 'tally') window.open('file:///C:/dev/docs/23-connectors-and-integrations/guides/Tally-Guide.pdf', '_blank'); else toast('Guide (PDF) opens here — the Tally one is the sample'); return; }
    if (a('data-dl')) { toast('Downloading the ' + a('data-dl') + ' connector…'); return; }
    if (a('data-toast')) { toast(a('data-toast')); return; }
    if (t.hasAttribute('data-map')) { var r2 = t.getBoundingClientRect(); S.pin = { x: Math.round((e.clientX - r2.left) / r2.width * 100), y: Math.round((e.clientY - r2.top) / r2.height * 100) }; S.pickAddr = true; layer(); return; }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('select[data-k]')) { save(t.getAttribute('data-k'), t.value); return; }
    if (t.matches('input[data-k]') && t.value.trim()) { save(t.getAttribute('data-k'), t.value.trim()); return; }
    if (t.matches('[data-pol]')) { var i = +t.getAttribute('data-pol'); S.policy[i].now = t.value; S.editing = null; flash('pol' + i); render(); return; }
    if (t.matches('[data-tick]')) { S.choice[+t.getAttribute('data-tick')].on = t.checked; render(); return; }
  });
  document.addEventListener('input', function (e) { if (e.target.matches('[data-search]')) { S.q = e.target.value; render(); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (S.pop) { S.pop = null; layer(); } else if (S.editing && !S.err[S.editing]) { S.editing = null; render(); } closeInfo(); }
    if (e.key === 'Enter' && e.target.matches('input[data-k]')) { e.preventDefault(); e.target.blur(); }
  });
  /* adjustable columns: drag a header edge (or ← → on it) */
  document.addEventListener('pointerdown', function (e) {
    var h = e.target.closest('[data-rz]'); if (!h) return; e.preventDefault();
    var id = h.getAttribute('data-rz'), i = +h.getAttribute('data-i'), grid = h.closest('.tg'), cells = Array.prototype.slice.call(grid.querySelectorAll('.hc'));
    var w = cells.map(function (c) { return c.getBoundingClientRect().width; }), x0 = e.clientX; h.classList.add('drag');
    function mv(ev) { var nw = w.slice(); nw[i] = Math.max(80, w[i] + ev.clientX - x0); COLS[id] = nw.map(function (px, j) { return j === nw.length - 1 ? 'minmax(' + Math.round(px) + 'px,1fr)' : Math.round(px) + 'px'; }); grid.style.setProperty('--cols', COLS[id].join(' ')); }
    function up() { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); h.classList.remove('drag'); }
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  });
  window.addEventListener('hashchange', function () { S.editing = S.err.taxNo ? 'taxNo' : null; S.q = ''; render(); document.getElementById('screen').scrollTop = 0; });
  window.addEventListener('resize', function () { proto(); });
  load(); render();
  window.CBS_PROTO = { S: S, render: render, layer: layer }; // for the screenshot script only
})();
