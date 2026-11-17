/* cap-country.js — COUNTRY SETUP (CS1, 2026-10-12): the step after registration, before the books open (lazy; ensureCap('country') → #/country).
 *
 * Athi, 2026-10-03 (DECISIONS "Country packs: the three switch decisions"): a shop with NO country is REFUSED, no silent India fallback;
 * a country with no pack is SAID; a country change is a NEW entity. Registration already reads the country from the time zone (M196,
 * engine/govcontext.js) and shows it with its source; this screen is where the OWNER confirms it — country · money · financial year · tax
 * registration — one row each, prefilled, each with where the answer came from, and one tap to change any of them.
 *
 * ── WHAT IS REUSED (CLAUDE.md rule 1) ────────────────────────────────────────────────────────────────────────────────────────────
 *   · the rows ARE the registration's gov panel (.govbox / .govrow / .gw .gv .gf, app.html) — the same look the person agreed to a minute ago
 *   · the prefill is CBGov.read() (M196) and the server's own answer (GET /api/governance/country-setup); this file computes nothing
 *   · the write goes through CBAction.run (M64, app/accounts-shell.js): one press, one write, the outcome said where it happened
 *   · the sentence for a country with no pack is the SERVER's (engines regulation.status) — painted, never composed here
 *   · the frame is the auth card (.auth .card .top .body) every sign-in screen uses — no new style
 * ── WHAT IS NEW, AND WHY ───────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   renderCountrySetup() — nothing existing painted a country step (the gov panel is read-only and lives inside Register).
 * Flow step: Onboarding · Register → Country setup → the app (docs/process/flows.json: Accounts · step "country").
 *
 * ── CS2 (2026-10-13) — THE CONSTITUTION, THE ZONE, THE COUNTRIES OFFERED ───────────────────────────────────────────────────────
 *   · the picker offers EXACTLY the server's `countries[]` (= the registered packs, CS1's rule) whatever the browser's locale; CBLocale.REGIONS
 *     is only the offline fallback. Choosing a country paints what ITS pack derives (currency · year · zones) from that same list — the server
 *     re-derives on save (country-setup.derive); this file computes nothing.
 *   · the time zone: a one-zone pack sets it (no Change); a multi-zone pack ASKS, the browser's zone preselected when it is one of the pack's.
 *   · `constituted` (the shop already holds a product or a transaction): Country and Money are greyed — no Change, the reason on the row —
 *     and the server refuses a change with its sentence (409 COUNTRY_CHANGE_IS_NEW_ENTITY), painted here. Before it, a correction is free and
 *     the save's `rederived` says what was set again.
 *   (CL3's "Where ChitBridge is for <country>" rows moved to Standards › Country readiness, standards.html ?ready=<cc> — W28(c); one link here.)
 * ── WALK-REG (2026-10-16, R8 R10 R10b R10c R14 R16 R46) — ONE RULE PER ROW: not yet answered → the picker inline (as "Big numbers"); answered →
 *   the value + Change. No "not said yet", no Done, no grey provenance line (the label's hover holds it); money = one "Looks like" line; 🔒 on
 *   Country and Money only; "Save & continue" the first time, "Save" + "Saved ✓" (stays) after; AU zones by city and state first.
 * OWNS the Country step (country · money · year · time zone · tax · supplies) · CALLED BY app.html's #/country (ensureCap('country')) and settings.html (CBCountry.mount).
 * FLOW  renderCountrySetup → csuRead (3 reads) → csuPrefill (server → clock → pack) → rows → csuSet per change → csuSave (the one write)      CARD 28-platform-and-operations/country-setup
 */
'use strict';
var CSU = {
  taxErr: '',
  pmLoading: false,
  p: null,
  loading: false,
  readErr: false,
  edit: null,
  src: {},
  open: {},
  answered: {},
  saved: false,
  err: '',
  later: false,
  host: null,
  onDone: null
};
/* host · onDone (SET1, 2026-10-13): a small app (settings.html, CB Settings › Country) mounts the SAME rows in its own pane — CBCountry.mount(host, onDone).
   With no host the step paints app.html's auth card at #root, as CS1 built it. One renderer, two frames; never a second copy of the rows. */
/** CS2: the server's pack row for a country ({ code, name, currency, fy_start_month, zones, locale }) — null when the server sent no list or has no pack for it */
function csuPackOf(code) {
  code = String(code || '').toUpperCase();
  var list = CSU.p && Array.isArray(CSU.p.countries) ? CSU.p.countries : [];
  for (var index = 0; index < list.length; index++) if (list[index] && String(list[index].code).toUpperCase() === code) return list[index];
  return null;
}
/** the country's name a person reads — the server's pack list, the locale engine's served list, else the browser's own region names, else the code (never a guess) */
function csuCountryName(code, list) {
  if (!code) return '';
  /* STD2 (additive): `list` = another holder of the server's pack rows (the register panel's REG.spin.countries) — the one name reader, never a copy */
  var pk = null;
  if (Array.isArray(list)) {
    for (var index = 0; index < list.length; index++)
      if (list[index] && String(list[index].code).toUpperCase() === String(code).toUpperCase()) pk = list[index];
  } else pk = csuPackOf(code);
  if (pk && pk.name) return pk.name;
  try {
    var R = window.CBLocale && CBLocale.REGIONS;
    if (R && R[code] && R[code].name) return R[code].name;
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  try {
    var n = new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }).of(code);
    if (n && n !== code && !/unknown/i.test(n)) return n;
  } catch (_) { /* browser feature missing: the default applies */ }
  return code;
}
/**
 * the countries the picker offers — CS2: EXACTLY the server's registered packs, plus the one the shop holds now (a pack-less country stays
 * visible as what it is). Without the server's list (offline, an older api): the locale engine's list, the browser's and the server's.
 */
function csuCountries() {
  var out = [],
    seen = {};
  var add = function (c) {
    c = String(c || '').toUpperCase();
    if (c && /^[A-Z]{2}$/.test(c) && !seen[c]) {
      seen[c] = 1;
      out.push(c);
    }
  };
  var served = CSU.p && Array.isArray(CSU.p.countries) && CSU.p.countries.length ? CSU.p.countries : null;
  if (served)
    served.forEach(function (item) {
      add(item && item.code);
    });
  else {
    try {
      Object.keys((window.CBLocale && CBLocale.REGIONS) || {}).forEach(add);
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    try {
      var g = govCtx();
      if (g && g.country) {
        add(g.country.value);
        add(g.country.unserved);
      }
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  if (CSU.p && CSU.p.country) add(CSU.p.country.code);
  if (CSU.edit) add(CSU.edit.country);
  return out;
}
/** the money a country keeps its prices in — the pack's first (the server's list), the locale engine's, plus whatever is set now */
function csuCurrencies(country) {
  var out = [],
    seen = {};
  var add = function (c) {
    c = String(c || '').toUpperCase();
    if (c && /^[A-Z]{3}$/.test(c) && !seen[c]) {
      seen[c] = 1;
      out.push(c);
    }
  };
  var pk = csuPackOf(country);
  if (pk) add(pk.currency);
  try {
    var R = window.CBLocale && CBLocale.REGIONS;
    if (R && R[country]) (R[country].cur || []).forEach(add);
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  if (CSU.edit) add(CSU.edit.currency);
  if (CSU.p) add(CSU.p.currency);
  return out;
}
/** the registered pack of a country (CBRegulation, engine/tax.js) — its scheme word, currency and year start; null when the page has no registry */
function csuPack(code) {
  try {
    return (window.CBRegulation && code && CBRegulation.packFor(String(code).toUpperCase())) || null;
  } catch (_) {
    return null;
  }
}
/** the scheme's own word for the tax row: GST · GST · VAT (pack.tax.scheme); 'Tax' when no pack says */
function csuScheme(code) {
  var pack = csuPack(code);
  return (pack && pack.tax && pack.tax.scheme) || tx('Tax');
}
/** the tax-id the pack names (abn · trn · gstin), for the placeholder; India's GSTIN example until reg-in carries one */
function csuTaxIdHint(code) {
  /* R5: the country registry's example (engines country.js) — no country named here */
  var id = window.CBCountries && code ? CBCountries.taxId(String(code).toUpperCase()) : null;
  return (id && id.hint) || tx('Registration number');
}
/** CS2: the IANA zones a country's pack names — the server's list for the chosen country; for the shop's own country also the profile's `zones` */
function csuZones(country) {
  var pk = csuPackOf(country);
  if (pk && Array.isArray(pk.zones) && pk.zones.length) return pk.zones.slice();
  if (CSU.p && CSU.p.country && CSU.p.country.code === country && Array.isArray(CSU.p.zones)) return CSU.p.zones.slice();
  return [];
}
/** the zone this device sits in (M196's reading of the clock) — preselected when it is one of the pack's */
function csuDeviceZone() {
  try {
    var g = govCtx();
    if (g && g.timezone && g.timezone.value) return g.timezone.value;
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (_) {
    return '';
  }
}
/**
 * CS2: the zone for a country, the way the server will set it (country-setup.derive): ONE zone → that one, from the pack; SEVERAL → the one
 * already held when it is one of them, else the device's when it is one of them, else nothing (the step asks); NONE named → what is held.
 */
function csuZoneFor(country, held) {
  var zones = csuZones(country),
    dev = csuDeviceZone();
  if (zones.length === 1) return { value: zones[0], from: txf('the {c} pack', { c: csuCountryName(country) }), ask: false };
  if (zones.length > 1) {
    if (held && zones.indexOf(held) >= 0) return { value: held, from: held === dev ? tx('your device clock') : tx('what you set'), ask: true };
    if (dev && zones.indexOf(dev) >= 0) return { value: dev, from: tx('your device clock'), ask: true };
    return { value: '', from: txf('{c} has several — pick one', { c: csuCountryName(country) }), ask: true };
  }
  return { value: held || '', from: held ? tx('your registration') : '', ask: false };
}
/** CS2: the words for what fixed the country — the server's `constituted_by`, in shopkeeper words */
function csuFixedBy() {
  var by = (CSU.p && CSU.p.constituted_by) || {},
    list = [];
  if (by.products) list.push(tx('products'));
  if (by.chits) list.push(tx('chits'));
  if (by.entries) list.push(tx('books entries'));
  return list.join(', ') || tx('transactions');
}
function csuConstituted() {
  return !!(CSU.p && CSU.p.constituted);
}
/** the values the server stored (what registration wrote) into the edit record */
function csuStoredFields(answer, edit) {
  edit.country = (answer.country && answer.country.code) || '';
  edit.currency = answer.currency || '';
  edit.fy = answer.fy_start_month || 0;
  edit.registered = answer.tax && typeof answer.tax.registered === 'boolean' ? answer.tax.registered : null; /* SET-49: unknown stays null, never false */
  edit.number = (answer.tax && answer.tax.number) || '';
  edit.scheme = (answer.tax && answer.tax.scheme) || 'regular';
}
/** each stored value's source in words; a value with no source is "not confirmed yet" until the step is done */
function csuStoredSources(answer, guess, edit) {
  var sources = Object.assign({}, answer.source || {});
  /* FX-AU1: registration now stores the guess WITH its source (the server's words, entity_governance.setup_source). A value with no source
     before the step is done is the database default ('IN'), never the owner's answer — so it is "not confirmed yet", never "your registration" */
  var guessedFrom = function (field) {
    return guess && guess[field] && guess[field].value === edit[field] && guess[field].from;
  };
  var unconfirmed = function (field) {
    return answer.done ? tx('what you set') : guessedFrom(field) || tx('not confirmed yet');
  };
  if (!sources.country && edit.country) sources.country = unconfirmed('country');
  if (!sources.currency && edit.currency) sources.currency = unconfirmed('currency');
  if (!sources.fy_start_month && edit.fy)
    sources.fy_start_month = answer.done
      ? tx('what you set')
      : answer.pack && answer.pack.id
        ? txf('the {c} pack', { c: csuCountryName(answer.pack.id) })
        : tx('the usual year');
  if (!sources.tax) sources.tax = edit.registered ? tx('your registration') : tx('not set yet');
  return sources;
}
/** CX0 · GOV-SPIN: before the step is DONE the server's country may be the database default ('IN'), not the owner's fact — the clock's served country (M196)
    wins over it, and the currency follows the clock too; but ONLY when the server's country has no source (a stored, labelled one is a fact the owner saw) */
function csuClockOverrides(edit, sources, answer, guess) {
  var clockCountry = guess && guess.country && guess.country.value;
  var serverCountryIsDefault = answer && !answer.done && !(answer.source && answer.source.country);
  if (serverCountryIsDefault && clockCountry && clockCountry !== edit.country && csuPack(clockCountry)) {
    edit.country = clockCountry;
    sources.country = guess.country.from;
    edit.currency = '';
    edit.fy = 0;
  }
}
/** CX0: the browser's clock fills what the server has not — the country, then the money that follows it */
function csuClockFills(edit, sources, answer, guess) {
  csuClockOverrides(edit, sources, answer, guess);
  var clockCountry = guess && guess.country && guess.country.value;
  if (!edit.country && clockCountry) {
    edit.country = clockCountry;
    sources.country = guess.country.from;
  }
  if (!edit.currency && guess && guess.currency && guess.currency.value) {
    edit.currency = guess.currency.value;
    sources.currency = guess.currency.from;
  }
}
/** W10: the browser's guess worded the money's reason ("the usual currency in India") on an Australian shop — the reason names the SHOP's country */
function csuMoneyReason(edit, sources, answer) {
  var isUsual = /the usual currency in /.test(String(sources.currency));
  var namesShop = (sources.currency && isUsual && !answer) || (answer && !answer.done && (!sources.currency || isUsual));
  if (edit.country && namesShop) sources.currency = txf('the usual currency in {c}', { c: csuCountryName(edit.country) });
}
/** the year: the server's pack row (CS2), else the regulation pack's (CX0: AU July · AE January), never India-or-January by guess */
function csuYearFromPack(edit, sources) {
  var packRow = csuPackOf(edit.country),
    regulation = csuPack(edit.country);
  if (edit.fy) return;
  edit.fy = (packRow && packRow.fy_start_month) || (regulation && regulation.fiscalYear && regulation.fiscalYear.startMonth) || (edit.country === 'IN' ? 4 : 1);
  sources.fy_start_month = packRow || regulation || edit.country === 'IN' ? txf('the {c} pack', { c: csuCountryName(edit.country) }) : tx('the usual year');
}
/** the prefill: the server's answer first (it knows what registration stored), else what the browser worked out (M196) — each with its source */
function csuPrefill() {
  var p = CSU.p,
    g = null;
  try {
    g = govCtx();
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  var e = {
    country: '',
    currency: '',
    fy: 0,
    registered: null /* SET-49: no default — unknown until the owner picks */,
    number: '',
    scheme: 'regular',
    timezone: '',
    words: (CSU.flags && CSU.flags.number_words) || 'pack',
    supplies: csuStoredSupplies() || 'goods'
  };
  var src = {};
  if (p) {
    csuStoredFields(p, e);
    src = csuStoredSources(p, g, e);
  }
  csuClockFills(e, src, p, g);
  csuMoneyReason(e, src, p);
  csuYearFromPack(e, src);
  if (!src.tax) src.tax = tx('not set yet');
  /* CS2: the zone — the pack's one, or the held / device one when the pack names several (the step asks), or what registration wrote */
  var z = csuZoneFor(e.country, (p && p.timezone) || csuDeviceZone());
  e.timezone = z.value;
  src.timezone = src.timezone || z.from;
  if (z.ask && !z.value) CSU.open.timezone = true; /* nothing to preselect: the picker is open from the start */
  CSU.edit = e;
  CSU.src = src;
}
/** WALK-REG R10: the shop's stored answer to "What you sell" — only goods · services · both count ('unknown' / none = nobody asked yet) */
function csuStoredSupplies() {
  var stored = CSU.me && CSU.me.supplies;
  return SHOP_SUPPLIES.some(function (choice) {
    return choice[0] === stored;
  })
    ? stored
    : '';
}
/** read the step's three answers together (country setup · policy flags · the shop's own row), each failure said in the log and kept apart; then prefill and paint */
function csuRead() {
  if (CSU.loading) return;
  CSU.loading = true;
  CSU.readErr = false;
  /* W28 · W27(a): the words choice (policy_flags.number_words) and the supplies (identities.supplies) are read beside the step — their one writers stay PATCH /entities/policy and PATCH /entities/profile */
  var logRead = function (what, failure) {
    if (typeof cblog === 'function') cblog('error', 'country setup: ' + what + ': ' + ((failure && failure.message) || failure));
  };
  Promise.all([
    api('countrySetup').then(
      function (answer) {
        CSU.p = answer || null;
      },
      function () {
        CSU.p = null;
        CSU.readErr = true;
      }
    ),
    api('policyGet').then(
      function (reply) {
        CSU.flags = (reply && reply.flags) || {};
      },
      function (failure) {
        CSU.flags = {};
        logRead('policy read', failure);
      }
    ),
    api('me').then(
      function (reply) {
        CSU.me = (reply && (reply.entity || reply)) || {};
      },
      function (failure) {
        CSU.me = {};
        logRead('/me read', failure);
      }
    )
  ]).then(function () {
    CSU.loading = false;
    csuPrefill();
    renderCountrySetup();
  });
}
/* ── ⭐ SET-WALK1 · W28(b) — MONEY CONFIRMS MORE THAN THE CODE: the symbol · the number format · the words for big numbers · the decimals · the date,
 * each a LIVE EXAMPLE from the SAME engine the bills use (CBLocale.money/symbol/date — the currency's own grouping, MONEY_LOCALE; CBMoney.decimals).
 * This file computes nothing: it paints what the engine paints. The grouping is the currency's (not a choice: ₹1,23,45,67,890 is how rupees are
 * written, A$1,234,567,890 how dollars are; INT7c W29: a long sample, so the grouping shows from the 3rd comma on); the WORDS are the shop's (policy_flags.number_words — an Indian shop may say lakh/crore or million). */
var CSU_SAMPLE = 1234567890.89,
  CSU_WORDS = [
    ['pack', 'as the money is written'],
    ['lakh', 'lakh · crore'],
    ['million', 'million']
  ];
/** the money's locale tag from the engine (en-IN · en-US …); en-US when the engine has none or cannot say */
function csuMoneyTag(currency) {
  try {
    return (window.CBLocale && CBLocale.moneyTag && CBLocale.moneyTag(currency)) || 'en-US';
  } catch (failure) {
    csuLogExample('money tag', failure);
    return 'en-US';
  }
}
/** a failed live example is logged, and the row shows the plain fallback — never a blank */
function csuLogExample(what, failure) {
  if (typeof cblog === 'function') cblog('error', 'country setup: ' + what + ': ' + ((failure && failure.message) || failure));
}
/** lakh · crore words for an amount from one lakh up, or '' below it. NOT Intl: a browser's ICU decides whether en-IN compact says "crore" (Chromium 129,
    CLDR 45, says "1.2 billion"), and an Indian shop that chose lakh · crore must read lakh · crore whatever browser it opens (SET-93, found 13 Nov on sit-au). */
function csuLakhWords(amount, tag) {
  var size = Math.abs(Number(amount)),
    unit = size >= 1e7 ? [1e7, 'crore'] : size >= 1e5 ? [1e5, 'lakh'] : null;
  if (!unit) return '';
  try {
    return new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(Number(amount) / unit[0]) + ' ' + unit[1];
  } catch (failure) {
    csuLogExample('lakh words', failure);
    return '';
  }
}
/** the words for a big number under a tag — Intl's compact notation (en-IN: "12 lakh" · en-US: "1.2 million"); the engine's own tag table decides which */
function csuBigWords(amount, wordsChoice, currency) {
  var tag = wordsChoice === 'lakh' ? 'en-IN' : wordsChoice === 'million' ? 'en-US' : csuMoneyTag(currency);
  var lakh = tag === 'en-IN' ? csuLakhWords(amount, tag) : '';
  if (lakh) return lakh;
  try {
    return new Intl.NumberFormat(tag, { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 1 }).format(amount);
  } catch (failure) {
    csuLogExample('big words', failure);
    return String(amount);
  }
}
/* ── WALK-REG 2026-10-16 R49: THE MONTH WORDS ARE THE SCREEN'S LANGUAGE; THE ORDER IS THE COUNTRY'S. A UAE shop's format tag is ar-AE, so CBLocale.date() put
   "16 أكتوبر 2026" and an Arabic "Year starts" list on an English screen. Here the parts come from the country's own tag (day · month · year, in its order) and
   only the month WORD is taken from the reader's language (CBLocale.lang(), the language tx() translates to). Same language and format → the engine's own answer. */
function csuUiTag() {
  try {
    return (window.CBLocale && CBLocale.lang && CBLocale.lang()) || 'en';
  } catch (failure) {
    csuLogExample('ui language', failure);
    return 'en';
  }
}
function csuMonthWord(monthIndex, form) {
  try {
    return new Intl.DateTimeFormat(csuUiTag(), { month: form === 'long' ? 'long' : 'short', timeZone: 'UTC' }).format(Date.UTC(2000, monthIndex, 15, 12));
  } catch (failure) {
    csuLogExample('month word', failure);
    return '';
  }
}
function csuMonthNames(form) {
  return monthNames(form);
} /* the one helper (helpers.js) — kept as a name so callers here read the same */
function csuDate(ts) {
  var locale = window.CBLocale;
  try {
    var when = new Date(ts),
      zone = locale.zoned ? locale.zoned({}).timeZone : undefined;
    var parts = new Intl.DateTimeFormat(locale.tag(), { day: '2-digit', month: 'short', year: 'numeric', timeZone: zone }).formatToParts(when);
    var word = new Intl.DateTimeFormat(csuUiTag(), { month: 'short', timeZone: zone }).format(when);
    return parts
      .map(function (part) {
        return part.type === 'month' ? word : part.value;
      })
      .join('');
  } catch (failure) {
    csuLogExample('date example', failure);
    return locale.date(ts);
  }
}
/** the live examples for a currency, from the engine the bills use: money · date · the symbol part of the money · decimals */
function csuMoneyExamples(currency, wordsChoice) {
  var locale = window.CBLocale,
    moneyUnit = window.CBMoney,
    symbol = '',
    money = '',
    date = '',
    decimals = 2;
  /* the sign as the BILL writes it (A$ · ₹ · AED): CBLocale.moneySign, the one reader of it (CTRY-51) */
  try {
    money = locale.money(CSU_SAMPLE, currency);
    date = csuDate(Date.now());
    symbol = locale.moneySign(currency);
  } catch (failure) {
    csuLogExample('locale example', failure);
  }
  try {
    decimals = moneyUnit && moneyUnit.decimals ? moneyUnit.decimals(currency) : 2;
  } catch (failure) {
    csuLogExample('decimals example', failure);
  }
  return {
    symbol: symbol || currency,
    number: money,
    decimals: decimals,
    date: date,
    words: csuBigWords(CSU_SAMPLE, wordsChoice, currency),
    lakhPack: csuMoneyTag(currency) === 'en-IN'
  };
}
/** one line of the money block: what · the value (WALK-REG R10c/R46: no "live example" label — the example just shows) */
function csuExampleLine(what, valueHtml, testId) {
  return (
    '<div class="govrow" data-testid="cs-money-' +
    testId +
    '"><span class="gw">' +
    esc(what) +
    '</span><span class="gv" style="font-weight:600">' +
    valueHtml +
    '</span></div>'
  );
}
/** the Money row's confirm block (WALK-REG R46, Athi: "just show"): ONE line — the money as a bill writes it (symbol · grouping · decimals) · the date;
    the words for big numbers a choice only where the money's own convention is lakh, inline like every unanswered row */
function csuMoneyConfirmHTML(e) {
  var example = csuMoneyExamples(e.currency, e.words);
  var looks =
    '<span translate="no" data-testid="cs-money-number">' +
    esc(example.number || example.symbol) +
    '</span>' +
    (example.date ? ' · <span translate="no" data-testid="cs-money-date">' + esc(example.date) + '</span>' : '');
  return (
    '<div class="govbox" data-testid="cs-money-confirm" style="margin-top:4px">' +
    csuExampleLine(tx('Looks like'), looks, 'looks') +
    (example.lakhPack
      ? csuExampleLine(
          tx('Big numbers'),
          csuSel(
            'cs-words',
            'words',
            CSU_WORDS.map(function (choice) {
              return { v: choice[0], t: tx(choice[1]) + ' — ' + csuBigWords(CSU_SAMPLE, choice[0], e.currency) };
            }),
            e.words
          ),
          'words'
        )
      : '') +
    '</div>'
  );
}
/** W27(a) → WALK-REG R10b: "What you sell" — goods · services · both (it decides HSN vs SAC); "both" is the common case (a garage sells a part and fits it) */
function csuSuppliesRow(e) {
  var options = SHOP_SUPPLIES.map(function (choice) {
      return { v: choice[0], t: tx(choice[1]) };
    }),
    current = options.filter(function (choice) {
      return choice.v === e.supplies;
    })[0];
  return csuRow('supplies', tx('What you sell'), current ? esc(current.t) : '', CSU.src.supplies, csuSel('cs-supplies', 'supplies', options, e.supplies));
}
/** the Country change: the whole shop follows it — what its pack derives is painted now, the way the server sets it on save (CS2 derive) */
function csuApplyCountry(country) {
  var edit = CSU.edit,
    packRow = csuPackOf(country),
    packName = txf('the {c} pack', { c: csuCountryName(country) });
  edit.country = country;
  var currencies = csuCurrencies(country),
    packCurrency = packRow && packRow.currency;
  if ((currencies.length && currencies.indexOf(edit.currency) < 0) || (packCurrency && packCurrency !== edit.currency)) {
    edit.currency = packCurrency ? packCurrency : currencies[0];
    CSU.src.currency = packRow ? packName : txf('the usual currency in {c}', { c: csuCountryName(country) });
  }
  if (packRow && packRow.fy_start_month) {
    edit.fy = packRow.fy_start_month;
    CSU.src.fy_start_month = packName;
  }
  if (country !== 'IN' && edit.scheme === 'composition') edit.scheme = 'regular';
  var zone = csuZoneFor(country, edit.timezone);
  edit.timezone = zone.value;
  CSU.src.timezone = zone.from;
  CSU.open.timezone = zone.ask && !zone.value;
}
/** each other field: how a typed value is cleaned before it is held */
var CSU_CLEAN = {
  currency: function (typed) {
    return String(typed || '')
      .toUpperCase()
      .slice(0, 3);
  },
  fy: function (typed) {
    return Number(typed) || 0;
  },
  registered: function (typed) {
    return typed === true || typed === 'yes' ? true : typed === false || typed === 'no' ? false : null;
  },
  number: function (typed) {
    return String(typed || '');
  },
  scheme: function (typed) {
    return String(typed || 'regular');
  },
  timezone: function (typed) {
    return String(typed || '');
  },
  words: function (typed) {
    return String(typed || 'pack');
  },
  supplies: function (typed) {
    return String(typed || 'goods');
  }
};
/** the key under which the server records where a field's value came from */
var CSU_SOURCE_KEY = {
  country: 'country',
  currency: 'currency',
  fy: 'fy_start_month',
  registered: 'tax',
  number: 'tax',
  scheme: 'tax',
  timezone: 'timezone',
  words: 'words',
  supplies: 'supplies'
};
/** the row a field belongs to — the tax row holds three fields (registered · number · scheme) */
var CSU_ROW_OF = { registered: 'tax', number: 'tax', scheme: 'tax' };
/**
 * R49 · R7: THE TAX NUMBER IS CHECKED WHEN THE PERSON LEAVES THE BOX, by the checker the server uses for that country (api profile.taxIdRefusal): a GSTIN by
 * profile-map.gstinChecksum (the engine /engine/profilemap.js, loaded on first need), an ABN / TRN by the pack's own check() (CBRegulation, /engine/tax.js).
 * Returns '' when fine (or when the checker is not here — the server still refuses on Save), else the reason in words. A GSTIN's 'format' answer covers a
 * wrong shape AND a holder letter outside CPHFATBLJG; they are told apart as the server does (api profile.gstinCheck): swap in a valid letter and ask again.
 */
function csuGstinWhy(number) {
  var profileMap = window.CBProfileMap;
  if (!profileMap) return '';
  var checked = profileMap.gstinChecksum(number),
    idWord = taxIdWord('IN');
  if (checked.ok) return '';
  if (checked.reason !== 'format') return txf('That {id} does not check out — look at the last character.', { id: idWord });
  var upper = String(number).trim().toUpperCase();
  return profileMap.gstinChecksum(upper.slice(0, 5) + 'C' + upper.slice(6)).reason === 'format'
    ? txf('That does not look like a {id} (15 characters, e.g. 27AAPFU0939F1ZV).', { id: idWord })
    : txf(
        'Place 6 of the {id} is the holder type and is not valid here — P person, C company, F firm, H HUF, T trust, A association, B body of individuals, L local authority, J juridical person, G government.',
        { id: idWord }
      );
}
function csuTaxIdWhy(country, number) {
  var typed = String(number == null ? '' : number).trim();
  if (!typed) return '';
  if (country === 'IN') {
    if (!window.CBProfileMap) {
      /* load the engine once, then check again */
      if (!CSU.pmLoading) {
        CSU.pmLoading = true;
        var script = document.createElement('script');
        script.src = '/engine/profilemap.js';
        script.onload = function () {
          if (CSU.edit && CSU.edit.country === 'IN') csuSet('number', CSU.edit.number);
        };
        document.head.appendChild(script);
      }
      return '';
    }
    return csuGstinWhy(typed);
  }
  var pack = csuPack(country),
    taxId = pack && (pack.abn || pack.trn || pack.gstin);
  if (taxId && typeof taxId.check === 'function') {
    var verdict = taxId.check(typed);
    if (!verdict.ok) return tx(verdict.why || 'That tax number does not check out.');
  }
  return '';
}
/** one field changed on screen: hold the cleaned value, say "you chose" as its source (W12), mark the step touched (W24), close its row once answered
    (WALK-REG R10c — the tax row stays open while it still needs the number), and repaint */
function csuSet(field, typed) {
  if (!CSU.edit) return;
  if (field === 'country') csuApplyCountry(String(typed || '').toUpperCase());
  else if (CSU_CLEAN[field]) CSU.edit[field] = CSU_CLEAN[field](typed);
  /* W12: where the value came from, in words a person reads — "you chose", never "typed" */
  CSU.src[CSU_SOURCE_KEY[field]] = tx('you chose');
  var row = CSU_ROW_OF[field] || field;
  /* R49: a number the checker refuses keeps the row OPEN with the reason on it; any other change to the row re-reads the held number */
  if (row === 'tax') CSU.taxErr = CSU.edit.registered && CSU.edit.number ? csuTaxIdWhy(CSU.edit.country, CSU.edit.number) : '';
  if (field === 'country') CSU.taxErr = '';
  if (CSU.taxErr) {
    CSU.open.tax = true;
    CSU.answered.tax = false;
  } else if (row !== 'tax' || !CSU.edit.registered || CSU.edit.number) {
    CSU.answered[row] = true;
    CSU.open[row] = false;
  }
  CSU.touched = true; /* W24: something moved since the read */
  CSU.err = '';
  CSU.saved = false;
  renderCountrySetup();
}
/* CL3 → W28(c): the "Where ChitBridge is for <country>" rows left this step — they are Standards › Country readiness (standards.html ?ready=<cc>, the same CBCountryReady unit); the link above opens it */
/** Change: the row's picker opens in place; choosing closes it again (no "Done" — WALK-REG R10c) */
function csuOpen(k) {
  CSU.open[k] = true;
  renderCountrySetup();
}
/** WALK-REG R10c: a row is ANSWERED once the step was done (the server holds the owner's answer), the shop holds it (supplies), or it was chosen here */
function csuAnswered(key) {
  if (CSU.answered[key]) return true;
  if (key === 'supplies') return !!csuStoredSupplies();
  return !!(CSU.p && CSU.p.done);
}
/**
 * one row — WALK-REG R10c, ONE RULE for every row: NOT YET ANSWERED (or no value) → the picker inline beside the label (as "Big numbers");
 * ANSWERED → the value + "Change". `locked`: the value only, no picker (fixed, or the pack sets it). `lockHtml`: the 🔒 on Country and Money (R14).
 * Where the value came from is no grey line under it any more — it is the label's hover (title); the hidden cs-src-<key> keeps it readable to the walks.
 */
function csuRow(key, what, valueHtml, from, editHtml, locked, lockHtml) {
  var inline = !locked && (!valueHtml || !csuAnswered(key) || CSU.open[key]);
  return (
    '<div class="govrow" data-testid="cs-row-' +
    key +
    '"' +
    (locked ? ' data-locked="1"' : '') +
    '>' +
    '<span class="gw"' +
    (from ? ' title="' + esc(from) + '"' : '') +
    '>' +
    esc(what) +
    (lockHtml || '') +
    '</span>' +
    '<span class="gv" data-testid="cs-val-' +
    key +
    '">' +
    (inline
      ? editHtml
      : (valueHtml || esc(tx('not known'))) +
        (locked
          ? ''
          : '<a data-cbsid="ACC002-B10" data-testid="cs-change-' +
            key +
            '" onclick="csuOpen(\'' +
            key +
            '\')" title="' +
            esc(tx('Change')) +
            '" aria-label="' +
            esc(tx('Change')) +
            ' ' +
            esc(what) +
            '" role="button" style="float:inline-end;color:var(--blue);cursor:pointer;font-size:1.1em;padding:0 6px">✎</a>')) +
    '</span>' +
    '<span class="gf" hidden data-testid="cs-src-' +
    key +
    '">' +
    esc(from || '') +
    '</span>' +
    '</div>'
  );
}
/* the visible words of each select's row: they become its accessible name (axe select-name, WCAG 4.1.2); the row's own label is a span, not a for= label */
var CSU_SEL_NAME = {
  'cs-country': 'Country',
  'cs-currency': 'Money',
  'cs-words': 'Big numbers',
  'cs-fy': 'Year starts',
  'cs-timezone': 'Time zone',
  'cs-supplies': 'What you sell',
  'cs-tax-reg': 'Registered',
  'cs-tax-scheme': 'Regular'
};
function csuSel(id, k, opts, cur) {
  return (
    '<select data-cbsid="ACC002-S04" class="inp" id="' +
    id +
    '" data-testid="' +
    id +
    '" aria-label="' +
    esc(tx(CSU_SEL_NAME[id] || id)) +
    '" onchange="csuSet(\'' +
    k +
    '\', this.value)">' +
    opts
      .map(function (item) {
        return (
          '<option value="' +
          esc(item.v) +
          '"' +
          (item.title ? ' title="' + esc(item.title) + '"' : '') +
          (item.off ? ' disabled' : '') +
          (String(item.v) === String(cur) && !item.off ? ' selected' : '') +
          '>' +
          esc(item.t) +
          '</option>'
        );
      })
      .join('') +
    '</select>'
  );
}
/**
 * WALK-REG R46: the zones a person knows by city and state, first; every other zone the pack names stays below a divider. The value is always the
 * IANA id (an identifier, never translated — LOCALE-STANDARD); the label is only what is read. A zone not listed here reads as its city.
 */
var CSU_ZONE_NAMES = {
  'Australia/Sydney': 'Sydney (NSW, ACT)',
  'Australia/Melbourne': 'Melbourne (VIC)',
  'Australia/Brisbane': 'Brisbane (QLD)',
  'Australia/Adelaide': 'Adelaide (SA)',
  'Australia/Perth': 'Perth (WA)',
  'Australia/Darwin': 'Darwin (NT)',
  'Australia/Hobart': 'Hobart (TAS)'
};
/** the name a person reads for a zone: the common name above, else the zone's city */
function csuZoneName(zone) {
  return (
    CSU_ZONE_NAMES[zone] ||
    String(zone || '')
      .split('/')
      .pop()
      .replace(/_/g, ' ')
  );
}
/** the Time zone row: shown when the pack names zones or one is held; a picker only where the pack names several — the common ones first (R46) */
function csuTimezoneRow(e, sources) {
  var zones = csuZones(e.country);
  if (!zones.length && !e.timezone) return '';
  var common = Object.keys(CSU_ZONE_NAMES).filter(function (zone) {
      return zones.indexOf(zone) >= 0;
    }),
    rest = zones.filter(function (zone) {
      return !CSU_ZONE_NAMES[zone];
    });
  var opt = function (zone) {
    return { v: zone, t: csuZoneName(zone) };
  };
  var zoneOpts = (e.timezone && zones.indexOf(e.timezone) >= 0 ? [] : [{ v: '', t: tx('Pick the time zone') }]).concat(
    common.map(opt),
    common.length && rest.length ? [{ v: '-', t: '──────────', off: true }] : [],
    rest.map(opt)
  );
  return csuRow(
    'timezone',
    tx('Time zone'),
    e.timezone ? '<span translate="no" title="' + esc(e.timezone) + '">' + esc(csuZoneName(e.timezone)) + '</span>' : '',
    sources.timezone,
    csuSel('cs-timezone', 'timezone', zoneOpts, e.timezone),
    zones.length <= 1 && !!e.timezone
  );
}
/** WALK-REG R8: what Regular and Composition mean — an ⓘ, never a line under the row (India's GST; AU and AE have no composition) */
var CSU_SCHEME_WHY = {
  regular: 'GST on every bill, input credit, tax invoice',
  composition: 'flat % of turnover, no GST on the bill, bill of supply, no input credit, no inter-state sales'
};
/** the ⓘ beside a scheme word: its meaning on hover */
function csuSchemeInfo(scheme) {
  return (
    ' <span data-testid="cs-scheme-info" title="' +
    esc(tx(CSU_SCHEME_WHY[scheme] || CSU_SCHEME_WHY.regular)) +
    '" style="cursor:help;color:var(--grey)">ⓘ</span>'
  );
}
/** the tax registration row: registered or not, India's regular / composition scheme, and the number */
function csuTaxRow(e, sources) {
  var india = e.country === 'IN';
  var summary = csuTaxSummary(e, india);
  return csuTaxRowHTML(e, sources, india, summary);
}
/** what the Tax row says once answered: "Not set yet" while unknown (SET-49), else the scheme and number, or "Not registered" */
function csuTaxSummary(e, india) {
  if (e.registered === null) return esc(tx('Not set yet'));
  return e.registered
    ? (india ? esc(e.scheme === 'composition' ? tx('Composition') : tx('Regular')) + csuSchemeInfo(e.scheme) + ' · ' : esc(tx('Registered')) + ' · ') +
      esc(e.number || '')
    : esc(tx('Not registered'));
}
/** the Tax row painted: the registered pick (no default), India's scheme, and the number once registered */
function csuTaxRowHTML(e, sources, india, summary) {
  return csuRow(
    'tax',
    csuScheme(e.country),
    summary,
    sources.tax,
    '<div style="display:grid;gap:6px">' +
      csuSel(
        'cs-tax-reg',
        'registered',
        [
          { v: '', t: tx('Pick one'), off: e.registered !== null },
          { v: 'no', t: tx('Not registered') },
          { v: 'yes', t: txf('Registered for {s}', { s: csuScheme(e.country) }) }
        ],
        e.registered === null ? '' : e.registered ? 'yes' : 'no'
      ) +
      (e.registered && india
        ? '<span style="display:flex;align-items:center;gap:6px">' +
          csuSel(
            'cs-tax-scheme',
            'scheme',
            [
              { v: 'regular', t: tx('Regular'), title: tx(CSU_SCHEME_WHY.regular) },
              { v: 'composition', t: tx('Composition'), title: tx(CSU_SCHEME_WHY.composition) }
            ],
            e.scheme
          ) +
          csuSchemeInfo(e.scheme) +
          '</span>'
        : '') +
      (e.registered
        ? '<input data-cbsid="ACC002-I06" class="inp" id="cs-tax-number" data-testid="cs-tax-number" placeholder="' +
          esc(csuTaxIdHint(e.country)) +
          '" value="' +
          esc(e.number) +
          '" onchange="csuSet(\'number\', this.value)">'
        : '') +
      (e.registered && CSU.taxErr
        ? '<span data-testid="cs-tax-error" role="alert" style="color:var(--red,#b3261e);font-size:.9em">' + esc(CSU.taxErr) + '</span>'
        : '') +
      '</div>'
  );
}
/** WALK-REG R14: the 🔒 on the two rows that lock — Country and Money, at the first product or transaction (server isConstituted); once fixed, why */
function csuLockHTML(fixed) {
  var reason = fixed ? txf('Fixed — the shop has {w}. Another country needs a new business.', { w: csuFixedBy() }) : tx('Fixed after your first sale');
  return ' <span data-testid="cs-lock" title="' + esc(reason) + '" aria-label="' + esc(reason) + '" style="cursor:help">🔒</span>';
}
/** the Country and Money rows; once the shop holds a product or a transaction they are fixed — the value and the 🔒, never a Change (CS2) */
function csuCountryMoneyRows(e, sources, fixed) {
  var lock = csuLockHTML(fixed);
  var countryOpts = csuCountries().map(function (code) {
    return { v: code, t: csuCountryName(code) + ' · ' + code };
  });
  var curOpts = csuCurrencies(e.country).map(function (code) {
    return { v: code, t: code };
  });
  var typedCurrency =
    '<input data-cbsid="ACC002-I07" class="inp" id="cs-currency" data-testid="cs-currency" aria-label="' + esc(tx('Money')) + '" maxlength="3" placeholder="' +
    esc((csuPackOf(e.country) || csuPack(e.country) || {}).currency || '') +
    '" value="' +
    esc(e.currency) +
    '" onchange="csuSet(\'currency\', this.value)">';
  return (
    csuRow('country', tx('Country'), esc(csuCountryName(e.country)), sources.country, csuSel('cs-country', 'country', countryOpts, e.country), fixed, lock) +
    csuRow(
      'currency',
      tx('Money'),
      esc(e.currency),
      sources.currency,
      curOpts.length ? csuSel('cs-currency', 'currency', curOpts, e.currency) : typedCurrency,
      fixed,
      lock
    )
  );
}
/** all the step's rows: country · money (+ how it looks) · year · time zone · tax · supplies */
function csuRowsHTML(e, sources, fixed) {
  return (
    csuCountryMoneyRows(e, sources, fixed) +
    (e.currency ? csuMoneyConfirmHTML(e) : '') +
    csuRow(
      'fy',
      tx('Year starts'),
      esc(csuMonthNames('long')[(e.fy || 1) - 1] || ''),
      sources.fy_start_month,
      csuSel(
        'cs-fy',
        'fy',
        csuMonthNames('long').map(function (name, index) {
          return { v: index + 1, t: name };
        }),
        e.fy
      )
    ) +
    csuTimezoneRow(e, sources) +
    csuTaxRow(e, sources) +
    /* W27(a): the supplies live beside the registration — a tax attribute, not a bill line */
    csuSuppliesRow(e)
  );
}
/** the two doors out of the step: the Country Standard, and "Where ChitBridge is for <country>" (Standards › Country readiness, W28(c)) */
function csuLinksHTML(e) {
  return (
    '<div class="hint"><a href="/standards.html?std=country" data-testid="cs-standard" style="font-weight:600;color:var(--blue);cursor:pointer">' +
    esc(tx('Country Standard')) +
    ' ›</a>' +
    /* W28(c): "Where ChitBridge is for <country>" is NOT a setup row — it lives under Standards › Country readiness (the same CBCountryReady unit); one link from here */
    (e.country
      ? ' · <a href="/standards.html?std=country&ready=' +
        esc(e.country) +
        '" data-testid="cs-ready-link" style="font-weight:600;color:var(--blue);cursor:pointer">' +
        esc(txf('ChitBridge in {c}', { c: csuCountryName(e.country) })) +
        ' ›</a>'
      : '') +
    '</div>'
  );
}
/** N0 (Athi, 2026-10-17): a shop b299 filled in as India works, but says so once — one tap to confirm, or change a row below */
function csuAssumedHTML(e, answer) {
  if (!(answer && answer.assumed) || CSU.touched || CSU.later) return '';
  return (
    '<div class="hint" data-testid="cs-assumed" style="color:var(--warn-2)">' +
    esc(txf('Country: {c} (assumed) — confirm or change', { c: csuCountryName(e.country) })) +
    ' <button data-cbsid="ACC002-B11" class="btn" data-testid="cs-confirm" onclick="csuSave()">' +
    esc(tx('Confirm')) +
    '</button></div>'
  );
}
/** the step's body once read: the rows, the pack's refusal or the read failure if any, the one action, the rule, the links */
function csuBodyHTML(e, answer) {
  var fixed = csuConstituted(),
    noPack = answer && answer.pack && answer.pack.books === false && answer.pack.why;
  /* WALK-REG R16: the first setup saves and moves on ("Save & continue"); a later visit saves and STAYS, with "Saved ✓" on the page */
  var first = csuFirstSetup();
  var action = CSU.later
    ? '<button data-cbsid="ACC002-B12" class="btn" id="cs-open" data-testid="cs-open" onclick="csuDone()">' +
      esc(tx(CSU.host ? 'Done' : 'Open the app')) +
      ' <span class=arw>→</span></button>'
    : '<button data-cbsid="ACC002-B13" class="btn" id="cs-save" data-testid="cs-save">' +
      esc(first ? tx('Save & continue') : tx('Save')) +
      (first ? ' <span class=arw>→</span>' : '') +
      '</button>' +
      (CSU.saved
        ? ' <span data-testid="cs-saved" role="status" style="color:var(--ok-2,#1d7a3a);font-weight:600;margin-inline-start:8px">' +
          esc(tx('Saved ✓')) +
          '</span>'
        : '');
  return (
    '<div class="body">' +
    csuAssumedHTML(e, answer) +
    '<div class="govbox" data-testid="cs-rows">' +
    csuRowsHTML(e, CSU.src, fixed) +
    '</div>' +
    (noPack ? '<div class="hint" data-testid="cs-nopack" style="color:var(--warn-2)">' + esc(answer.pack.why) + '</div>' : '') +
    (CSU.readErr ? '<div class="hint" data-testid="cs-readerr">' + esc(tx('Saved values not read — showing this device’s.')) + '</div>' : '') +
    (CSU.err ? '<div class="err" data-testid="cs-err">' + esc(CSU.err) + '</div>' : '') +
    action +
    /* WALK-REG R14: what locks is the 🔒 on the Country and Money rows (its ⓘ says when, or why once fixed) — no paragraph here */
    /* CPS1: the Country Standard — what a country pack carries and what each pack still lacks (standards.html opens on that row's search) */
    csuLinksHTML(e) +
    '</div>'
  );
}
/** paint the step: read once, prefill once, then the body (or "Reading…") in the host page's pane or in the sign-in card */
function renderCountrySetup() {
  if (!SESSION.token && !CSU.host) return go('#/login'); /* a host page holds its own sign-in window (CBFrame) */
  if (!CSU.p && !CSU.loading && !CSU.readErr) {
    csuRead();
  }
  if (!CSU.edit) csuPrefill();
  var body =
    CSU.loading && !CSU.p
      ? '<div class="body" data-testid="cs-loading" style="color:var(--grey)">' + esc(tx('Reading…')) + '</div>'
      : csuBodyHTML(CSU.edit, CSU.p);
  if (CSU.host) CSU.host.innerHTML = '<div class="cs"><h2 class="shop-h" data-testid="cs-title">' + esc(tx('Country setup')) + '</h2>' + body + '</div>';
  else
    document.getElementById('root').innerHTML =
      modeRibbon() +
      '<div class="auth"><div class="card" style="margin-bottom:var(--scroll-tail,120px)">' +
      '<div class="top">' +
      logo() +
      '<h1 data-testid="cs-title">' +
      esc(tx('Country setup')) +
      '</h1></div>' +
      body +
      '</div></div>';
  var saveButton = document.getElementById('cs-save');
  if (saveButton) saveButton.onclick = csuSave;
}
/** the body of the one write, from the edit record; CS2: the zone picked of the pack's several (a one-zone pack: the server sets it anyway) */
function csuSaveBody(e, confirmed) {
  var body = {
    country: e.country,
    currency: e.currency,
    fy_start_month: e.fy,
    tax: { registered: e.registered, number: e.registered ? e.number : null, scheme: e.registered ? e.scheme : null },
    timezone: e.timezone || null,
    source: CSU.src
  };
  /* SET-86: the server wants the owner's deliberate confirm to take a registered shop off its tax; sent only after the popup said yes */
  if (confirmed === true && csuDeregisters(e)) body.confirm_deregister = true;
  return body;
}
/** SET-86: this save would take a shop the server holds as registered off its tax (registered true → not registered): the money promise asks first, naming its reach */
function csuDeregisters(e) {
  return e.registered === false && !!(CSU.p && CSU.p.tax && CSU.p.tax.registered === true);
}
/** SET-86: the one confirm for csuDeregisters — what happens (every new invoice carries no tax) and who learns when (an open till at its next refresh) */
function csuDeregisterConfirm() {
  return {
    title: tx('Stop charging tax?'),
    body: esc(tx('Every new invoice from now on carries no tax. A till that is already open keeps the old answer until it refreshes.')),
    yes: tx('Not registered'),
    danger: true
  };
}
/** WALK-REG R16: the first setup is the one before the server holds the owner's answer (country_setup_at) */
function csuFirstSetup() {
  return !(CSU.p && CSU.p.done);
}
/** SET-49: Tax is unanswered (null) yet the owner opened or touched its row — Save asks instead of sending */
function csuTaxNeedsPick(e) {
  return e.registered === null && !!(CSU.open.tax || CSU.answered.tax);
}
/** the one write — M64: one press, one call; a server refusal is said in the form, in its own words */
function csuSave() {
  var btn = document.getElementById('cs-save'),
    e = CSU.edit;
  if (!e) return;
  var first = csuFirstSetup();
  CSU.err = '';
  CSU.saved = false;
  /* SET-49: Tax the owner opened or touched needs an answer before it is sent; Tax left alone goes as null (unknown), never false */
  if (csuTaxNeedsPick(e)) {
    CSU.err = tx('Pick registered or not registered for tax.');
    return renderCountrySetup();
  }
  var deregisters = csuDeregisters(e);
  var body = csuSaveBody(e, deregisters);
  CBAction.run(
    btn,
    function () {
      return api('countrySetupSave', { body: body }).then(function (reply) {
        return csuSaveBeside(e).then(function () {
          return reply;
        });
      });
    },
    {
      key: 'cs-save',
      busy: tx('Saving…'),
      confirm: deregisters ? csuDeregisterConfirm() : undefined,
      outcome: function (p) {
        CSU.touched = false;
        CSU.p = p || CSU.p;
        try {
          if (p && p.pack) SESSION.booksOn = false;
        } catch (_) { /* best effort: failing here changes nothing the user sees */ }
        /* CS2: a correction before the shop was constituted — the server says what it set again from the new pack */
        if (p && p.rederived) toast(txf('Country now {c} — the rest set from its pack.', { c: csuCountryName(p.rederived.to) }));
        else if (first) toast(tx('Country set.'));
        /* WALK-REG R16: the first setup moves on; a later save stays here and says so on the page */
        if (first) return csuDone();
        CSU.saved = true;
        CSU.open = {};
        renderCountrySetup();
      },
      onFail: function (words, err) {
        var st = err && err.status;
        /* before the database update that holds this step: say so, and let the shop in — selling and the rail work meanwhile */
        if (st === 503) {
          CSU.later = true;
          CSU.err = (err.data && err.data.message) || words;
        } else CSU.err = words;
        renderCountrySetup();
      }
    }
  );
}
/** W28 · W27(a): the two facts beside the step, each through its ONE writer, only when it moved — the words (policy_flags.number_words) and the supplies (identities.supplies) */
function csuSaveBeside(e) {
  var jobs = [];
  if (e.words !== ((CSU.flags && CSU.flags.number_words) || 'pack'))
    jobs.push(
      api('policySet', { body: { number_words: e.words } }).then(function (reply) {
        CSU.flags = (reply && reply.flags) || CSU.flags;
      })
    );
  /* WALK-REG R10: what the picker SHOWS is what is saved — a shop with no stored answer saves the shown Goods too (it read "not said yet" after Continue) */
  if (e.supplies !== csuStoredSupplies())
    jobs.push(
      api('saveProfile', { body: { supplies: e.supplies } }).then(function () {
        CSU.me = Object.assign({}, CSU.me, { supplies: e.supplies });
      })
    );
  return Promise.all(jobs);
}
/** where the step goes when it is done: the HOST says (app.html's route sets the workshop's own; settings.html its Your shop) — this file names no door */
function csuDone() {
  if (CSU.onDone) CSU.onDone();
}
/** CB Settings › Country (settings.html): the same rows, painted in the page's pane. Re-mounting re-reads nothing the server already answered. */
var CBCountry = {
  mount: function (host, onDone) {
    CSU.host = host;
    CSU.onDone = onDone || null;
    CSU.touched = false;
    if (window.CBUnsaved)
      CBUnsaved.form({
        dirty: function () {
          return !!CSU.touched;
        },
        save: function () {
          return new Promise(function (ok, no) {
            var node = document.getElementById('cs-save');
            if (!node) return ok();
            csuSaveThen(ok, no);
          });
        }
      }); /* W24 */
    renderCountrySetup();
  }
};
/** SET-86: resolves true when there is nothing to ask, or the owner confirms stopping the tax; false on No or when this page has no dialog (then nothing is sent) */
function csuSaveAsked(e) {
  if (!csuDeregisters(e)) return Promise.resolve(true);
  return new Promise(function (resolve) {
    var dialog = typeof confirmAsk === 'function' ? confirmAsk : typeof CBConfirm === 'function' ? CBConfirm : null;
    var words = csuDeregisterConfirm();
    if (!dialog) return resolve(false);
    dialog(
      words.title,
      words.body,
      words.yes,
      function () {
        resolve(true);
      },
      words.danger,
      function () {
        resolve(false);
      }
    );
  });
}
/** W24: the same save as the button, awaited by CBUnsaved (resolve on the outcome, reject on a refusal) */
function csuSaveThen(ok, no) {
  var e = CSU.edit;
  if (!e) return ok();
  /* SET-86: the save from a page leave asks the same question first; a No keeps the page as it is */
  csuSaveAsked(e)
    .then(function (yes) {
      if (!yes) throw new Error('Not saved — the tax answer was left as it is.');
      return api('countrySetupSave', { body: csuSaveBody(e, csuDeregisters(e)) });
    })
    .then(function (reply) {
      CSU.p = reply || CSU.p;
      return csuSaveBeside(e);
    })
    .then(function () {
      CSU.touched = false;
      ok();
    }, no);
}
