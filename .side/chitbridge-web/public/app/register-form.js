/* register-form.js — THE REGISTER FORM: a new shop's User ID · e-mail → the code · the gov panel (reg-agree) → verify (FX-UX2, 2026-10-14).
 * OWNS      the new-shop form (CBRegistration.mount): User ID and e-mail, the code, the governance panel (reg-agree), verify; one form for both doors
 * CALLED BY public/app.html (#/register ──▶ CBRegistration.mount, app.html:4143; script tag app.html:1655) and public/settings.html (#/new ──▶ CBRegistration.mount, settings.html:229; script tag settings.html:152)
 * FLOW      mount(host, onDone) ──▶ paint the form ──▶ register (e-mail ──▶ code) ──▶ verify ──▶ onDone
 * CARD      28-platform-and-operations/register-form
 *
 * MOVED out of app.html (#/register) so CB Settings › New shop (settings.html#/new) mounts the SAME form — one form, one `reg-agree`, one
 * register / verify pair (api routes/entities.js registerNew · verify). A customer registering from the sign-in window never enters the
 * workshop (docs/design/INDEX-NOT-APP.md, SET3). The pattern is cap-country.js's (SET1): one renderer, two frames, never a second copy.
 *   CBRegistration.mount(host, onDone)   paint the form into host; onDone(verifyAnswer, userId) when the code is verified
 *   host null                             app.html's auth card at #root (app.html: CBRegistration.mount(null, regIn) — regIn keeps its old next step)
 * Host globals it reads (both pages have them): api · EP (register · ownerVerify · constitutions from CB_SHOP_EP) · tx · txf · esc · val ·
 * window.CBGov (engine/govcontext.js) · csuCountryName (app/cap-country.js — settings.html carries it; app.html loads it on demand, ensureCap). app.html's card only: onbBanner · modeRibbon · logo · STAGES · CFG.STAGE · go.
 * Flow step: R2R step 1 · country — registration is its door (docs/process/flows.json).
 */
'use strict';
var REG = { step: 'form', name: '', email: '', busy: false, err: '' };
var REG_AT = { host: null, onDone: null }; /* host · onDone: a small app's pane (CB Settings › New shop) — null = app.html's auth card at #root */
/** the gate tick (SCR053-U01): the answer is kept and the form repaints, so Verify enables */
function regAgreeChanged(checked) {
  REG.agreed = checked === true;
  renderRegister();
}
function regReset() {
  REG = { step: 'form', name: '', email: '', busy: false, err: '' };
  renderRegister();
}
/* SCREEN: Register (#/register) · module target: auth.js
   Real flow: POST EP.register {display_name, email} -> OTP -> POST EP.ownerVerify {email, otp} -> token + active entity (signed in).
   GAPS (API-side, for CLI): STEP 2 role/blueprint carry (not stored yet) · STEP 3 schema gate (fresh entity needs a default entity_schemas, else catalogue 404s). */
/**
 * ⭐⭐ WHAT WE FILLED IN, AND WHERE EACH ANSWER CAME FROM. Five rows, one line of explanation, and a tick. The
 * shop does not type any of it; it only says whether we got it right.
 * ⚠️ AN UNKNOWN IS SHOWN AS AN UNKNOWN. Country decides tax and money, so a blank a person can see beats a
 * default they never saw. [[feedback-write-for-the-shopkeeper]]
 */
function govRows() {
  try {
    return (window.CBGov && CBGov.rows(govCtx())) || [];
  } catch (_) {
    return [];
  }
}
var _govCtx = null;
function govCtx() {
  /* ⚠️ READ ONCE. Re-deriving on every repaint would let the values move under the person while they read. */
  try {
    if (!_govCtx && window.CBGov) _govCtx = CBGov.read();
  } catch (_) {
    _govCtx = null;
  }
  return _govCtx;
}
/**
 * ⭐⭐ GOV-SPIN (Athi, 14 Oct): A REGIONAL SPIN STATES ITS COUNTRY, AND THE REGISTRANT ACCEPTS IT. GET /entities/constitutions (fetched before
 * this step paints) now carries `installation { country, name, timezone }` (b382) and `countries[]` — the packs a registrant may choose, each
 * with what it applies (currency · year · tax · format · languages). When the installation states a country it is offered FIRST, with its
 * source in words; the browser's guess is shown beside it only when it differs; another country only from the server's list (tighten-only),
 * else the panel says why. The ONE reg-agree accepts it; verify carries the choice (country_source) and the SERVER decides what is stored.
 * This file computes nothing: every value is the server's pack row or the browser's own Intl. No spin data (an older api) → the rows above.
 * Flow step: Onboarding · Register (docs/process/flows.json).
 */
function regPackOf(code) {
  var l = REG.spin && Array.isArray(REG.spin.countries) ? REG.spin.countries : [];
  for (var index = 0; index < l.length; index++) if (l[index] && l[index].code === code) return l[index];
  return null;
}
function regInstCountry() {
  return (REG.spin && REG.spin.installation && REG.spin.installation.country) || '';
}
function regBrowserCountry() {
  var g = govCtx();
  return (g && g.country && g.country.value) || '';
}
/** STD2: the country's name is Country setup's one reader (cap-country.js csuCountryName), asked of the server's rows this form holds */
function regCountryName(code) {
  return typeof csuCountryName === 'function' ? csuCountryName(code, (REG.spin && REG.spin.countries) || []) : code || '';
}
/** STD2: what the SERVER will store and record for a country if it is accepted (GET /entities/constitutions?tz= → countries[].offer) — painted, never computed here */
function regOfferOf(code) {
  var pk = regPackOf(code);
  return (pk && pk.offer) || null;
}
/** the first country offered: the installation's, else the browser's when the server may serve it, else none (the panel says so) */
function regFirstCountry() {
  var inst = regInstCountry(),
    br = regBrowserCountry();
  if (inst) return inst;
  if (br && (!REG.spin || !REG.spin.countries || regPackOf(br))) return br;
  return '';
}
/** a language's English name, and its own name beside it — isolated in <bdi lang dir=auto> so the browser's bidi gives a right-to-left script its
    direction and the row never flips ([[project-arabic-rtl]]). STD2: no hand-kept RTL list here (CBLocale.dir answers only for the page's own language) */
function regLangHTML(code) {
  var text = code,
    own = '';
  try {
    text = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch (_) { /* browser feature missing: the default applies */ }
  try {
    own = new Intl.DisplayNames([code], { type: 'language' }).of(code) || '';
  } catch (_) { /* browser feature missing: the default applies */ }
  return esc(text) + (own && own.toLowerCase() !== text.toLowerCase() ? ' <bdi dir="auto" lang="' + esc(code) + '">' + esc(own) + '</bdi>' : '');
}
/** how numbers and dates print in the pack's format — the browser's own Intl: one fixed number, today's date (R4: never a hard-coded day) */
function regFormatSample(locale) {
  try {
    var n = new Intl.NumberFormat(locale).format(1234567890.5),
      d = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    return '<bdi dir="auto">' + esc(n) + '</bdi> · <bdi dir="auto">' + esc(d) + '</bdi>';
  } catch (_) {
    return esc(locale);
  }
}
/** the rows when the server sent its countries: the country (with its source), then what that country's pack applies */
/** the tax's display name the api sends (countries[].tax.name: Consumption tax, not JCT), else its scheme */
function taxNameOf(countryRow) {
  return countryRow.tax && (countryRow.tax.name || countryRow.tax.scheme);
}
function regSpinRows() {
  var c = REG.country,
    inst = regInstCountry(),
    pk = regPackOf(c),
    name = regCountryName(c),
    out = [];
  var g = govCtx(),
    from = !c
      ? tx('you set this after signing in')
      : c === inst
        ? txf('This ChitBridge runs in {c}', { c: name })
        : c === regBrowserCountry()
          ? (g && g.country && g.country.from) || tx('your browser')
          : tx('you chose it');
  out.push({ key: 'country', what: tx('Country'), value: esc(name), from: from, known: !!c });
  if (pk) {
    var list = [taxNameOf(pk), pk.tax && pk.tax.id].filter(Boolean).join(' · ');
    var off = pk.offer || {},
      zone = { value: off.timezone || '', from: off.from || tx('you pick it after signing in') }; /* the server's offer (STD2) */
    out.push({ key: 'currency', what: tx('Money'), value: esc(pk.currency || ''), from: '', known: !!pk.currency });
    out.push({
      key: 'year',
      what: tx('Year starts'),
      value: esc(pk.fy_start_month ? monthNames('long')[pk.fy_start_month - 1] || String(pk.fy_start_month) : ''),
      from: '',
      known: !!pk.fy_start_month
    });
    out.push({ key: 'tax', what: tx('Tax'), value: esc(list), from: pk.tax && pk.tax.return ? txf('returns: {r}', { r: pk.tax.return }) : '', known: !!list });
    out.push({ key: 'format', what: tx('Format'), value: pk.locale ? regFormatSample(pk.locale) : '', from: '', known: !!pk.locale });
    out.push({
      key: 'language',
      what: tx('Language'),
      value: (pk.languages || []).slice(0, 2).map(regLangHTML).join(' · '),
      from: '',
      known: !!(pk.languages && pk.languages.length)
    });
    out.push({ key: 'timezone', what: tx('Time zone'), value: esc(zone.value), from: zone.from, known: !!zone.value });
  }
  /* the device row as the browser reads it (CBGov.rows) — the rest above replace its guesses */
  govRows().forEach(function (item) {
    if (item.key === 'device') out.push({ key: item.key, what: item.what, value: esc(item.value), from: item.from, known: item.known });
  });
  return out;
}
/** the line beside the country: the browser's differing guess, the choice the server allows, or why there is none */
function regCountryChoice() {
  var inst = regInstCountry(),
    br = regBrowserCountry(),
    list = (REG.spin && REG.spin.countries) || [],
    h = '';
  if (inst && br && br !== inst) h += '<div data-testid="reg-gov-browser">' + esc(txf('Your browser says {c}', { c: regCountryName(br) })) + '</div>';
  if (list.length > 1) {
    h +=
      '<label style="display:block;margin-top:4px">' +
      esc(tx('Another country')) +
      ' <select data-cbsid="SCR053-S01" class="inp" data-testid="reg-country" style="width:auto;max-width:100%;display:inline-block;padding:4px 8px" onchange="REG.country=this.value;REG.agreed=false;renderRegister()">' +
      (REG.country ? '' : '<option value="" selected>' + esc(tx('Pick one')) + '</option>') +
      list
        .map(function (item) {
          return '<option value="' + esc(item.code) + '"' + (item.code === REG.country ? ' selected' : '') + '>' + esc(item.name || item.code) + '</option>';
        })
        .join('') +
      '</select></label>';
  } else if (inst && br && br !== inst) {
    h += '<div data-testid="reg-gov-why">' + esc(txf('This ChitBridge serves {c} only.', { c: regCountryName(inst) })) + '</div>';
  }
  return h;
}
function govPanel() {
  var spin = !!(REG.spin && Array.isArray(REG.spin.countries) && REG.spin.countries.length);
  var rows = spin
    ? regSpinRows()
    : govRows().map(function (item) {
        return { key: item.key, what: item.what, value: esc(item.value), from: item.from, known: item.known };
      });
  if (!rows.length) return '';
  /* walk 2026-10-16: ONE heading; what it means (and that a "not known" row is set after sign-in) behind ⓘ — never a line under every row */
  var reason = regInstCountry()
    ? tx('They set your tax and money. Set any “not known” one after you sign in.')
    : tx('Filled in from your browser. Change any of them after you sign in.');
  return (
    '<div class="govbox" data-testid="reg-gov">' +
    '<div class="govhd">' +
    esc(tx('Check these')) +
    ' <span title="' +
    esc(reason) +
    '" style="cursor:help;font-weight:400">ⓘ</span></div>' +
    rows
      .map(function (item) {
        return (
          '<div class="govrow' +
          (item.known ? '' : ' unknown') +
          '" data-testid="reg-gov-' +
          item.key +
          '">' +
          '<span class="gw">' +
          esc(item.what) +
          '</span>' +
          '<span class="gv">' +
          (item.known ? item.value : esc(tx('not known'))) +
          '</span>' +
          (item.known && item.from
            ? '<span class="gf">' + esc(item.from) + '</span>'
            : '') /* R4: a row with no note of its own paints none; "set it after sign-in" is the heading's ⓘ, once */ +
          (spin && item.key === 'country' ? '<div class="gf">' + regCountryChoice() + '</div>' : '') +
          '</div>'
        );
      })
      .join('') +
    '</div>' +
    /* ⚠️⚠️ THE GATE. Not a notice — a question about the country that decides their tax. GOV-SPIN: the same one control accepts the country. */
    ui.field({ mount: 'SCR053-U01', kind: 'checkbox', id: 'r_agree', testid: 'reg-agree', label: 'These are right, and I accept the terms of use.', value: !!REG.agreed, onChange: regAgreeChanged })
  );
}
/** what verify sends: the browser's context, with the country the person ACCEPTED and where it came from (the server re-decides the source) */
function regPayload() {
  if (!window.CBGov) return undefined;
  var p = CBGov.payload(govCtx());
  if (REG.spin && REG.country) {
    var pk = regPackOf(REG.country);
    /* the source the SERVER said it will record (countries[].offer.source); an older api sent none → 'chosen' (verify re-decides it from the facts) */
    p.country = REG.country;
    p.country_source = (regOfferOf(REG.country) || {}).source || 'chosen';
    if (pk && pk.currency) p.currency_code = pk.currency;
  }
  return p;
}
function renderRegister() {
  const R = REG;
  const who = 'style="font-size:var(--fs-2);color:var(--grey);margin-bottom:8px"';
  let form = '';
  if (R.step === 'form') {
    /* ⭐⭐ THE REGISTRATION SCREEN ASKS FOR THE USER ID, NOT A NAME. Athi, 2026-08-19: *"generally what we say
       is the id created is userid, and the name is any name"* — and *"once registered, through IAM screen they can
       change the display name. The display name can be anything and any format. No restriction."*

       So this field is the one thing that is permanent, and the only place it is ever chosen. The two banned
       characters are the grammar of the namespace, which is why the hint names them rather than just refusing:
           acmetraders            an ENTITY      — what you register here
           ravi@acmetraders       an EMPLOYEE    — @ binds a person to their business
           acmetraders.clothing   a NETWORK node — . binds a store to its network
       Only the entity ever registers. Employees are created by the business, network stores are minted by their
       parent, and customers register at a storefront automatically. */
    form = `${typeof onbBanner === 'function' ? onbBanner() : ''}${ui.field({ mount: 'SCR053-U02', kind: 'text', id: 'r_name', testid: 'reg-name', label: 'User ID', autocomplete: 'username', placeholder: 'acmetraders', value: R.name, attrs: { autocapitalize: 'off', spellcheck: 'false' } })}
       <div data-testid="reg-name-hint" style="font-size:var(--fs-1);color:var(--grey);margin:-2px 0 8px">${txf('8+ letters, numbers or dashes · {fixed}', { fixed: '<b>' + esc(tx("can't be changed later")) + '</b>' })}
         <span data-testid="reg-name-why" tabindex="0" style="cursor:help" title="${esc(tx('No spaces, no @ . ~ (kept for staff, network stores and suppliers). Your business name can be anything; set it after you sign in.'))}">ⓘ</span></div>
       ${ui.field({ mount: 'SCR053-U03', kind: 'email', id: 'r_email', testid: 'reg-email', label: 'Email', placeholder: 'you@yourshop.example', value: R.email })}
       ${R.err ? `<div class="err" role="alert">${R.err}</div>` : ''}
       <button data-cbsid="SCR053-B01" class="btn gold" id="r_go" data-testid="reg-submit" ${R.busy ? 'disabled' : ''}>${R.busy ? '<span class="spin"></span> ' + esc(tx('Registering…')) : esc(tx('Register')) + ' <span class=arw>→</span>'}</button>`;
  } else {
    form = `<div ${who}>${esc(tx('User ID'))} <b>${esc(R.name)}</b> · <a data-cbsid="SCR053-C01" onclick="regReset()">${esc(tx('change'))}</a></div>
       ${regVerticalChooser()}
       ${govPanel()}
       ${ui.field({ mount: 'SCR053-U04', kind: 'text', id: 'r_otp', testid: 'reg-otp', label: txf('Code sent to {e}', { e: R.email }), placeholder: '6-digit code', autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: 6 })}
       ${R.err ? `<div class="err" role="alert">${R.err}</div>` : ''}
       <button data-cbsid="SCR053-B02" class="btn gold" id="r_go" data-testid="reg-submit" ${R.busy || !R.agreed ? 'disabled' : ''}>${R.busy ? '<span class="spin"></span> Verifying…' : 'Verify &amp; enter <span class=arw>→</span>'}</button>`;
  }
  /* ⭐ FX-UX2: a small app's pane — the same form, under the page's own heading; "Sign in" is Home's one sign-in window (never #/login) */
  if (REG_AT.host) {
    REG_AT.host.innerHTML =
      '<div class="cs" data-testid="reg-screen"><h2 class="shop-h" data-testid="reg-title">' +
      esc(tx('Register your business')) +
      '</h2>' +
      '<div class="body">' +
      form +
      '</div></div>'; /* R6 (WALK-REG 2026-10-16): "Sign in" is the top bar's — once, not again under the button */
  } else
    document.getElementById('root').innerHTML =
      modeRibbon() +
      `
  <div class="auth"><div class="card">
    <div class="top">${logo()}<h1>${esc(tx('Register your business'))}</h1></div>
    <div class="body">
      ${form}
      <div class="hint"><b>${STAGES[CFG.STAGE].label}</b> — emailed code via <span class="mono">${EP.register.p}</span>.</div>
      <div class="swap">Have an account <a data-cbsid="SCR053-C02" onclick="go('#/login')">${tx('Sign in')}</a></div>
    </div>
  </div></div>`;
  const node = document.getElementById('r_go');
  if (node) node.onclick = doRegister;
}
async function doRegister() {
  const R = REG;
  const v_name = val('r_name'),
    v_email = val('r_email'),
    v_otp = val('r_otp');
  if (R.step === 'form') {
    if (!v_name || !v_email) {
      R.err = 'A User ID and an email address are required.';
      return renderRegister();
    }
    /* ⚠️ THE SAME RULE AS THE SERVER, SAID BEFORE THE ROUND TRIP — not INSTEAD of it. handleLib.checkRoot is the
       authority (routes/entities.js refuses on its own); this only spares someone a wasted OTP request. It is
       deliberately the same three sentences, so a person never sees two different explanations of one rule. */
    const uid = v_name.trim().toLowerCase();
    if (uid.indexOf('@') >= 0) {
      R.err = 'A User ID cannot contain "@". That separator makes an employee sign-in — ravi@yourbusiness.';
      return renderRegister();
    }
    if (uid.indexOf('.') >= 0) {
      R.err = 'A User ID cannot contain ".". That separator makes a network store — yourbusiness.clothing.';
      return renderRegister();
    }
    if (uid.length < 8) {
      R.err = 'A User ID is at least 8 characters. "' + uid + '" is ' + uid.length + '.';
      return renderRegister();
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(uid) || /-$/.test(uid)) {
      /* ⚠ SAY WHICH CHARACTER. "letters, numbers and dashes" makes the person re-read their own typing to find
         what offended; the first bad character is something we already know. */
      var badch = (uid.match(/[^a-z0-9-]/) || [])[0];
      R.err = badch
        ? badch === ' '
          ? 'A User ID cannot contain a space. Use a dash instead — corner-hardware.'
          : 'A User ID cannot contain "' + badch + '". Letters, numbers and dashes only — the rest are kept for internal use.'
        : 'A User ID starts and ends with a letter or number — not a dash.';
      return renderRegister();
    }
    R.name = uid;
    R.email = v_email.trim();
  }
  R.err = '';
  R.busy = true;
  renderRegister();
  try {
    if (R.step === 'form') {
      /* user_id is the permanent one; display_name simply STARTS as it and is free to change in IAM after. */
      /* ⭐ FX-AU1: the guess the governance panel SHOWED travels with the registration — the server names it in the write that creates the
         shop (routes/entities.registerNew), so the column default never decides a Sydney shop is Indian. Verify still sends it (COALESCE). */
      const response = await api('register', {
        body: { user_id: R.name, display_name: R.name, email: R.email, context: window.CBGov ? CBGov.payload(govCtx()) : undefined }
      });
      R.email = (response && response.email) || R.email;
      R.busy = false;
      R.step = 'otp';
      try {
        /* STD2: the device's zone rides along, so each country row carries the zone the server WILL store (countries[].offer) */
        const tz = (govCtx() && govCtx().timezone && govCtx().timezone.value) || '';
        const answer = await api('constitutions', tz ? { query: { tz: tz } } : undefined);
        /* the country names and months are Country setup's (cap-country.js) — fetched on demand where the page does not carry it (app.html) */
        if (typeof csuCountryName !== 'function' && typeof ensureCap === 'function')
          await ensureCap('country').catch(function (e) {
            cblog('warn', 'register: Country setup unloaded — the panel shows country codes, not names: ' + (e && e.message));
          });
        REG.verticals = (answer && answer.constitutions) || [];
        const dv =
          REG.verticals.find(function (x) {
            return x.is_default;
          }) || REG.verticals[0];
        REG.constitution = dv ? dv.key : null;
        /* GOV-SPIN: the installation's country and the packs a registrant may choose — the panel's first country is the installation's */
        REG.spin =
          answer && Array.isArray(answer.countries)
            ? { installation: answer.installation || null, allowed: answer.allowed_countries || null, countries: answer.countries }
            : null;
        REG.country = regFirstCountry();
      } catch (_) {
        REG.verticals = [];
        REG.spin = null;
      }
      return renderRegister();
    }
    /**
     * ⭐⭐ THE GOVERNANCE LAYER TRAVELS WITH THE VERIFICATION — one round trip, and it arrives at the moment the
     * identity becomes real rather than as a second call that can fail on its own.
     * ⚠️ `agreed_at` IS THE EVIDENCE, not the tick. A boolean says somebody ticked a box; a timestamp says when.
     */
    const reply = await api('ownerVerify', {
      body: { email: R.email, otp: v_otp, constitution: R.constitution || undefined, context: regPayload(), agreed_at: new Date().toISOString() }
    });
    R.busy = false;
    /* the host's next step: app.html's regIn (the session · a paired counter · #/country) or CB Settings' (keep the session, open Home) */
    if (REG_AT.onDone) return REG_AT.onDone(reply, R.name);
  } catch (e) {
    R.busy = false;
    R.err = 'Could not register: ' + e.message;
    renderRegister();
  }
}
/* The vertical/blueprint chooser at sign-up — showcases the available constitutions (verticals) so the registrant
   picks one; their entity is minted onto it (verify → entity_governance). "None fits" → tailor / contact the team. */
function regVerticalChooser() {
  const list = REG.verticals || [];
  if (!list.length) return '';
  return (
    '<div style="margin:10px 0 4px"><div class="fl">' +
    esc(tx('Choose your setup')) +
    ' <span style="font-weight:400;color:var(--grey);cursor:help" title="' +
    esc(tx('You can change it later.')) +
    '">ⓘ</span></div>' +
    list
      .map(function (item) {
        const sel = (REG.constitution || '') === item.key;
        const caps = (item.capabilities || []).join(' · ');
        return (
          '<div data-cbsid="SCR053-C03" data-testid="reg-vertical-' +
          esc(item.key) +
          '" onclick="REG.constitution=\'' +
          esc(item.key) +
          '\';renderRegister()" style="border:1px solid ' +
          (sel ? 'var(--blue)' : 'var(--line)') +
          ';background:' +
          (sel ? 'var(--blue-tint)' : 'var(--card)') +
          ';color:var(--on-card);border-radius:9px;padding:9px 11px;margin-bottom:7px;cursor:pointer"><div style="font-weight:700;font-size:var(--fs-2);color:var(--ink)">' +
          (sel ? '● ' : '○ ') +
          esc(regSetupLabel(item)) +
          ' <span data-testid="reg-vertical-why" style="font-weight:400;color:var(--grey);cursor:help" title="' +
          esc(txf('Includes: {caps}', { caps: caps || 'core' })) +
          '">ⓘ</span></div></div>'
        );
      })
      .join('') +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin:2px 0 4px">' +
    txf('None fits? {tailor} · {contact}', {
      tailor: '<a data-cbsid="SCR053-C04" onclick="regTailor();return false" style="color:var(--blue);cursor:pointer;font-weight:600">' + tx('Tailor one') + '</a>',
      contact: '<a data-cbsid="SCR053-C05" onclick="regContact();return false" style="color:var(--blue);cursor:pointer;font-weight:600">' + tx('Contact the team') + '</a>'
    }) +
    '</div>' +
    '</div>'
  );
}
/** R3 (WALK-REG 2026-10-16): a setup's name in a shopkeeper's words — the default is "Standard", a vertical is its own name
    (service-desk → Service desk); never the server's internal label ("Base constitution — any currency", "… vertical"). Painted only. */
function regSetupLabel(setup) {
  if (setup.is_default) return tx('Standard (any business)');
  const words = String(setup.vertical || setup.key || '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return words ? tx(words.charAt(0).toUpperCase() + words.slice(1)) : setup.label || setup.key;
}
function regTailor() {
  if (typeof toast === 'function') toast(tx('Pick the closest for now — we tailor it with you later.'));
}
function regContact() {
  try {
    window.location.href = 'mailto:team@chitandbridge.com?subject=' + encodeURIComponent('Tailor a setup for ' + (REG.name || 'my business'));
  } catch (_) {
    if (typeof toast === 'function') toast('Email team@chitandbridge.com to wire a custom setup.');
  }
}

var CBRegistration = {
  mount: function (host, onDone) {
    REG_AT.host = host || null;
    REG_AT.onDone = onDone || null;
    renderRegister();
  }
};
try {
  window.CBRegistration = CBRegistration;
} catch (_) { /* best effort: failing here changes nothing the user sees */ }
