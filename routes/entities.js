// routes/entities.js — Entity registration, login, search.   CARD 28-platform-and-operations/entities-routes
// OWNS the entity door: register · OTP login · search · profile · header · sides · policy · country setup · CALLED BY server.js (app.use('/api/entities')).
// FLOW  validate → auth → withEntity (the caller's own entity) → the lib that owns the data (profile · policy · entity-header · sides) → { ok, data, error }
const versionref = require('../lib/versionref');
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const visibilityCap = require('../lib/visibility-cap'); // a choice, bounded by a cap
const { query, withEntity } = require('../db');
const log = require('../lib/logger');
const { validate, validateAsProblem, schemaValidate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { isTriggerRefusal } = require('../lib/knownerr'); // SEC-94: only a trigger's own sentence is said; any other CHECK violation is a fault
const shopActors = require('../lib/shop-actors'); // SEC-103: actorOwned — an assignee is looked up under the caller's shop before it is stored
const folderViews = require('../lib/folder-views'); // SEC-100: folderOwned — a folder id is looked up under the caller's shop before it is stored
const contract = require('../lib/entities-contract'); // the contract (each route's operation) and the words of a refusal
const { failed } = contract;

/** the schema check of one route, to spread after its gates (lib/entities-contract.js): a body that is not an object is refused 400 in the chains' own "Validation failed" body; a route with no input has none */
const checked = (route) => {
  const operation = contract.entities.operationFor(route);
  return operation.parameters || operation.requestBody ? [schemaValidate(operation, contract.schemaOptions)] : [];
};
/** the platform doors as gates in front of a handler (they answer a Problem themselves and say which statuses they add): the root of the deployment, and the platform role */
const rootGate = Object.assign((req, res, next) => (require('../lib/platformroot').refuseUnlessRoot(req, res) ? next() : undefined), { addsStatuses: [403, 404] });
function platformGate(req, res, next) {
  if (require('../lib/platformroot').refuseUnlessPlatform(req, res)) next();
}
const { sendOtpEmail } = require('../lib/notify'); // shared OTP email sender (F2 — extracted from here)
const { currencyRefusal } = require('../lib/govresolve'); // resolve the entity's governance from attributes

// ⚠️ ONE generator (lib/bridgeid.js). This was SIX copies and the CSPRNG hardening reached only one of them —
//    not this one, which is where every entity's bridge id is minted. Same call site, now a strong PRNG.
const generateBridgeId = require('../lib/bridgeid').generateBridgeId;
const schema = require('../lib/schema'); // b176 — never name a column from an unrun migration
const handleLib = require('../lib/handle'); // slug + check — the same rules the network root uses

// DEV_OTP = fixed OTP for testing — on a LOCAL stack only (lib/dev-otp.js, SEC1); testers elsewhere use TESTER_CODE
// No DEV_OTP = random 6-digit OTP
// S4 (reviewer 2026-07-13) — OTP from a CSPRNG (crypto.randomInt), not Math.random() (whose V8 state is recoverable,
// letting an attacker predict a victim's OTP). DEV_OTP still overrides for team testing when explicitly set.
// ⚠️ ONE generator (lib/otp.js, next to the verification). This copy was the only one of THREE that ever received
//    the S4 CSPRNG fix; actors.js and connectors.js kept Math.random() for four weeks. Behaviour here is unchanged.
const generateOTP = require('../lib/otp').generateOTP;
const devOtp = require('../lib/dev-otp');
/**
 * ⭐⭐⭐ [capability: sign-in] ONE lookup and ONE verify for whoever types into this box, entity or coassist —
 * see chitbridge-api/lib/identity-auth.js's header for the full story (Athi, 2026-09-23: "a single library
 * for all user id definition and login process has been instantiated, do not reinvent" — the user-id HALF
 * already existed in lib/resolveuserid.js; this is the login half that did not, until now).
 */
const identityAuth = require('../lib/identity-auth');

// (F2) The OTP email sender now lives in lib/notify.js (`sendOtpEmail`), shared with the customer order flow.

/**
 * ── M06: SIGN-IN MOVED TO routes/signin.js — these two paths are ALIASES (the same handler functions) ─────────────────
 *
 *   POST /api/entities/register  = signin's ask (the login half), then — only for a NEW e-mail sent without mode:'login' —
 *                                  registerNew below. Registration is the one thing that stays here: app.html#/welcome.
 *   POST /api/entities/verify    = signin's verify, whole (OTP or PIN, the entity onboarding block, the token).
 *
 * ⚠️ Kept as aliases until PR 16 (SPEC-iam-build §4.2): every page and script that signs in calls these today, and each
 * answers exactly what it answered before the move (tests/signin-routes.test.cjs, golden recorded pre-move).
 */
const signin = require('./signin');

/**
 * registerNew — a new e-mail at /register without mode:'login' becomes a new entity (ask() hands over with next()).
 *
 * ⭐⭐ THE USER ID IS CHOSEN AT REGISTRATION, AND ONLY HERE. Athi, 2026-08-19: *"through the registration page, only the
 * entity registers. Employee or network or anyone else can never register through the registration screen."* ·
 * *"the user id registered cannot be changed."* ⚠️ SET ONCE: this INSERT is the only place an entity's user_id is written
 * from a person's input; PATCH /profile refuses to overwrite a value that exists.
 */
async function registerNew(req, res) {
  try {
    const input = String(req.body.email || req.body.user_id || req.body.id || '').trim();
    const email = input.toLowerCase();
    const display_name = sanitise(req.body.display_name || input);
    const bridge_id = generateBridgeId();
    const identity_id = uuidv4();
    const wanted = String(req.body.user_id || '').trim() || handleLib.slug(display_name);
    const verdict = handleLib.checkRoot(wanted);
    if (!verdict.ok) {
      const suggestion = handleLib.checkRoot(handleLib.slug(display_name)).ok ? handleLib.slug(display_name) : null;
      return problem(req, res, { status: 400, ...contract.words.userIdInvalid(verdict.reason, { suggestion }) });
    }
    /* ⚠️ UNIQUE PLATFORM-WIDE, refused HERE — the unique index on lower(user_id) would raise a 500 that says nothing usable */
    const taken = await query('SELECT 1 FROM identities WHERE LOWER(user_id) = $1', [verdict.value]);
    if (taken.rows.length) {
      return problem(req, res, { status: 409, ...contract.words.userIdTaken(verdict.value) });
    }
    /**
     * ⚠️⚠️ A fixture registration is a CUSTOMER that is a TEST (b246 emptied entity_kind = 'test'). ⚠⚠ population, NOT
     * is_test: b249 made is_test GENERATED ALWAYS, and naming it here failed every sign-up with 428C9.
     */
    const mark = require('../lib/istest').atRegistration(email, await require('../lib/istest').ready());
    /**
     * ⭐⭐ FX-AU1: THE GUESS THE OWNER WAS SHOWN IS STORED IN THE WRITE THAT CREATES THE SHOP. The governance panel showed a Sydney browser
     * Australia · AUD · Australia/Sydney; until this the INSERT named no country, the column default ('IN') landed, and verify's
     * COALESCE could never correct it — an owner who left before Continue had an Indian shop. Each guessed value is NAMED here, so the
     * default never decides it. No guess (an API fixture, an old page) → country is named NULL and no source is stored: the setup step
     * then ASKS, never "your registration" (GOV-AU1, Athi 14 Oct: "drop the DEFAULT 'IN' too" — b376; unknown is NULL, never India).
     */
    const CS = require('../lib/country-setup');
    /* ⭐ GOV-SPIN: a regional spin STATES its country (installation.country, b382) — that is OFFERED first, the browser's guess only when the
       installation states none. The offer is stored here (as FX-AU1 stored the guess); the registrant ACCEPTS or changes it at verify (reg-agree). */
    const guess = CS.offerOf(CS.guessOf(req.body.context), await CS.atSignup());
    const more = []; /* [column, value] beyond the fixed seven (country among them, NULL when no guess), each named only when known */
    if (mark.population !== null) more.push(['population', mark.population]);
    if (guess && guess.currency) more.push(['currency_code', guess.currency]);
    if (guess && guess.timezone && (await schema.hasColumn('identities', 'timezone'))) more.push(['timezone', guess.timezone]);
    await query(
      `INSERT INTO identities (identity_id, bridge_id, display_name, email, identity_type, status, user_id, entity_kind, country` +
        more.map(([c]) => ', ' + c).join('') +
        `) VALUES ($1, $2, $3, $4, 'entity', 'pending', $5, $6, $7` +
        more.map((_, index) => ', $' + (index + 8)).join('') +
        ')',
      [identity_id, bridge_id, display_name, email, verdict.value, mark.entity_kind, (guess && guess.country) || null].concat(more.map(([, v]) => v))
    );
    /* where each guessed value came from (b299 setup_source) — best-effort: a label lost never costs a sign-up, but it is said */
    if (guess) {
      try {
        await withEntity(identity_id, (h) => CS.noteGuess(h, identity_id, guess));
      } catch (e) {
        console.log('[register] guess source NOT STORED for ' + identity_id + ': ' + (e && e.message));
      }
    }
    console.log(`New entity registered: ${display_name} / ${bridge_id}`);
    return await signin.sendCode(req, res, { identity_id, email, display_name }, {});
  } catch (err) {
    console.error('Register error:', err.message);
    problem(req, res, failed(err, req, 'Registration failed'));
  }
}

/**
 * PATCH /entities/me/locale — store the PERSON's localisation choice (b165).
 *
 * ⚠️ SEPARATE FROM PATCH /profile, deliberately. /profile edits the BUSINESS — its GSTN, address, logo, shop
 * status. This edits how one human reads the screen. Folding a personal preference into the business profile
 * would mean a co-assist could not change their own language without write access to their employer's record,
 * and that an owner changing the firm's address would be touching the same object as their clerk's numerals.
 *
 * ⚠️ THE TARGET ROW IS NEVER TAKEN FROM THE BODY. identity_id comes from the verified token, so the only row a
 * caller can write is their own. There is no id parameter to get wrong.
 *
 * ⚠️ ICU VALIDATES THE VALUES, NOT A HAND-WRITTEN LIST. Every value here ends up inside an Intl constructor or a
 * BCP 47 -u- extension, and BCP 47 admits thousands of valid tags — a whitelist of the nine the screen currently
 * offers would reject the tenth the day someone needs it, and would drift out of step with CLDR every release.
 * So the shape is checked syntactically and the MEANING is checked by asking Intl to build the tag. If ICU can
 * format with it, it is a real subtag; if it throws, it is not. Adopting the standard's own validator beats
 * maintaining our opinion of what the standard contains.
 */
/**
 * PATCH /entities/me/prefs/:kind — store one of the PERSON's own preference sets (b165 locale · b166 ui).
 *
 * ⚠️ ONE HANDLER, TWO COLUMNS — generalised rather than copied. Two near-identical prefs endpoints would drift
 * the first time one of them gained validation, an audit line or a rate limit, and the one nobody remembered
 * would be the one carrying somebody's accessibility setting.
 *
 * ⚠️ SEPARATE FROM PATCH /profile, deliberately. /profile edits the BUSINESS — its GSTN, address, logo, shop
 * status. This edits how one human reads the screen. Folding a personal preference into the business profile
 * would mean a co-assist could not change their own language or contrast without write access to their
 * employer's record, and that an owner editing the firm's address would be touching the same object as their
 * clerk's numerals.
 *
 * ⚠️ THE TARGET ROW IS NEVER TAKEN FROM THE BODY. identity_id comes from the verified token, so the only row a
 * caller can write is their own. There is no id parameter to get wrong.
 *
 * ⚠️ AND THE COLUMN NAME IS NEVER TAKEN FROM THE URL. :kind selects an entry in PREF_SETS below; the column
 * string comes from that entry and never from req.params. An unknown kind is a 404, not a query. Interpolating
 * a caller-supplied identifier into SQL is exactly how a whitelist stops being a whitelist.
 */
const PREF_SETS = {
  /* The six keys the localisation layer reads. `lang` and `locale` are language tags; the rest are the UTS #35
     locale keywords, stored by their own subtag names so the column reads as the standard writes it. */
  locale: {
    column: 'locale_prefs',
    keys: ['lang', 'langs', 'region', 'locale', 'nu', 'hc', 'ca', 'fw', 'tz', 'workdays'],
    /* ⚠️ `langs` IS A LIST, so it is the one key whose value may contain commas — RFC 4647 calls it a language
       priority list ("Tamil, then English, then Hindi"). Widening the generic pattern for every key to admit
       commas would have been the smaller edit and the wrong one: a comma has no business in a numbering system
       or an hour cycle, and a validator that accepts more than it needs to stops being a validator. */
    /* CU3: `tz` is an IANA zone (`Asia/Kolkata`, `America/Argentina/Buenos_Aires`) and `workdays` an ISO weekday list
       (`1,2,3,4,5,6`, 1 = Monday) — CBLocale sent both and the old key list dropped them silently. The generic pattern
       admits neither `/` nor `,`, and one rejected key fails the whole save, so each carries its own. */
    patterns: {
      langs: /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*(,[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*){0,2}$/,
      tz: /^[A-Za-z][A-Za-z0-9_+-]{0,30}(\/[A-Za-z0-9_+-]{1,30}){0,2}$/,
      workdays: /^[1-7](,[1-7]){0,6}$/
    },
    /**
     * ⚠️ ICU VALIDATES THE VALUES, NOT A HAND-WRITTEN LIST. BCP 47 admits thousands of valid tags; a whitelist of
     * the nine the screen currently offers would reject the tenth the day someone needs it, and would drift out
     * of step with CLDR every release. Syntax is checked generically above; MEANING is checked by asking Intl to
     * build the tag. If it can format with it, it is a real subtag. Adopting the standard's own validator beats
     * maintaining our opinion of what the standard contains.
     */
    check(prefs) {
      try {
        const list = ['nu', 'hc', 'ca', 'fw'].filter((item) => prefs[item]).map((item) => `${item}-${prefs[item]}`);
        const tag = (prefs.locale || prefs.lang || 'en') + (list.length ? '-u-' + list.join('-') : '');
        new Intl.NumberFormat(tag);
        new Intl.DateTimeFormat(tag);
      } catch (_) {
        return 'That combination is not a locale ICU recognises';
      }
      /* the zone is ICU's to judge too (RangeError for one it does not know) — never a hand-kept list */
      if (prefs.tz) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: prefs.tz });
        } catch (_) {
          return 'Unknown time zone';
        }
      }
      return null;
    }
  },
  /**
   * Appearance. ⚠️ HERE A CLOSED LIST IS RIGHT, and the contrast with locale above is the point: these are OUR
   * enumerations, not a standard's. There is no external registry of themes that could add a sixteenth without
   * us knowing, so anything outside the list is a bug or a probe rather than a value we have not caught up with.
   * The theme itself stays open-ended in shape (a short slug) so shipping a new one needs no migration here.
   */
  ui: {
    column: 'ui_prefs',
    keys: [
      'theme',
      'fs',
      'motion',
      'stripes',
      'edition',
      'font',
      'weight',
      'kural'
    ] /* kural (SET-WALK1 W7): the Thirukkural band — auto · on · off, the owner's choice */ /* stripes: row stripes off | light | strong (small-fixes round); edition: which showing of Home (web manifest `editions`, AX1) — open-ended like theme, it HIDES doors, never grants · font, weight: CU3 (were device-only) */,
    check(prefs) {
      if (prefs.font && !['default', 'grotesk', 'serif', 'wide', 'mono'].includes(prefs.font)) return 'Unknown reading font'; /* avatar.js FONTS */
      if (prefs.weight && !['normal', 'bold'].includes(prefs.weight)) return 'Unknown text weight';
      if (prefs.stripes && !['off', 'light', 'strong'].includes(prefs.stripes)) return 'Unknown row stripes setting';
      if (prefs.fs && !['s', 'm', 'l', 'xl'].includes(prefs.fs)) return 'Unknown text size';
      if (prefs.motion && !['auto', 'reduce', 'full'].includes(prefs.motion)) return 'Unknown motion setting';
      if (prefs.edition && !/^[a-z][a-z0-9-]{0,23}$/.test(prefs.edition)) return 'Unknown edition';
      return null;
    }
  }
};

/**
 * ⭐ RFC 7386 MERGE-PATCH FOR A PREFS COLUMN — the ONE expression every ui_prefs / locale_prefs write uses (CU2).
 * $1 = the keys to set (jsonb) · $3 = the keys to remove (text[]). A key the caller did not send is left alone; a key
 * sent as null or '' is removed ("follow the default"). `||` alone cannot remove, and `= $1` erased what it did not name.
 */
const MERGE_PATCH_SQL = (col) => `(COALESCE(${col}, '{}'::jsonb) - $3::text[]) || $1::jsonb`;

/** prefPatch(set, body) → { set, drop } or { error }. Whitelisted keys only; '' / null = drop; a bad value = error. */
function prefPatch(set, payload) {
  const out = {},
    drop = [];
  for (const k of set.keys) {
    if (!(k in payload)) continue; // not sent = not touched
    const v = String(payload[k] == null ? '' : payload[k]).trim();
    if (!v) {
      drop.push(k);
      continue;
    } // empty = "follow the default": removed
    // Short alphanumeric-and-hyphen tokens. Anything else is not one of these values at all.
    const pat = (set.patterns && set.patterns[k]) || /^[A-Za-z0-9][A-Za-z0-9-]{0,34}$/;
    if (!pat.test(v)) return { error: `${k} is not a valid value` };
    out[k] = v;
  }
  return { set: out, drop };
}

/**
 * prefSetOf(kind) → the preference set the kind names, or null.
 * ⚠️ hasOwnProperty, NOT A TRUTHY LOOKUP — found by red-teaming this endpoint rather than by a failure.
 *
 * `PREF_SETS[kind]` walks the PROTOTYPE CHAIN, so `kind=__proto__`, `constructor`, `toString` and
 * `valueOf` all return something truthy and sail past the 404. None of them can write to a table — the
 * column comes from `set.column`, which is undefined for all of them — but the request then throws deep
 * inside the handler and surfaces as a 500 with a confusing log, when the honest answer is "no such set".
 *
 * The rule this is a case of: a whitelist consulted with bracket notation is not a whitelist unless the
 * lookup is own-property. That is the same class as interpolating a caller's string into SQL, one step back.
 */
const prefSetOf = (kind) => (Object.prototype.hasOwnProperty.call(PREF_SETS, kind) ? PREF_SETS[kind] : null);
/** the kind a preference door writes: the shipped PATCH /me/locale is always 'locale', PATCH /me/prefs/:kind takes it from the path */
const prefKindOf = (fixedKind, req) => fixedKind || String(req.params.kind || '');
/**
 * prefSetRoute(fixedKind) — the handler of the two preference doors, ONE function under two names.
 * (The two refusals it makes carry their status in their words: only one of the two doors can answer a 404.)
 */
const prefSetRoute = (fixedKind) =>
  async function savePrefSet(req, res) {
    const kind = prefKindOf(fixedKind, req);
    const set = prefSetOf(kind);
    if (!set || !set.column) return problem(req, res, contract.words.unknownPrefSet());
    try {
      const p = prefPatch(set, req.body || {});
      if (p.error) return problem(req, res, contract.words.badPreference(p.error));
      const prefs = p.set;

      const bad = set.check(prefs);
      if (bad) return problem(req, res, contract.words.badPreference(bad));

      /* ⚠️ A MERGE-PATCH, NEVER THE WHOLE COLUMN (CU2). This UPDATE used to write `= $1`, so a theme push erased every
         other key in ui_prefs — the shop's product-rows choice with it. Only the keys sent change; the rest stay. */
      const r = await query(`UPDATE identities SET ${set.column} = ${MERGE_PATCH_SQL(set.column)} WHERE identity_id = $2 RETURNING ${set.column} AS v`, [
        JSON.stringify(prefs),
        req.identity.identity_id,
        p.drop
      ]);
      const merged = (r && r.rows && r.rows[0] && r.rows[0].v) || prefs;
      res.json({ ok: true, kind, prefs: merged, [set.column]: merged });
    } catch (err) {
      /* ⚠️ Before the migration runs, the column does not exist. The person's preference still works from
         localStorage and visibly applied, so this must degrade to "not synced yet" rather than surfacing an error
         over a setting they can see took effect. Code ships before the migration, always. */
      if (new RegExp(set.column).test(String(err && err.message))) return res.json({ ok: false, pending: true });
      console.error('Prefs error (' + kind + '):', err.message);
      problem(req, res, failed(err, req, 'Failed to save'));
    }
  };

router.post('/register', signin.door('register'), signin.askChecks, validate, signin.handlers.ask, registerNew);
router.post('/verify', signin.door('entity-verify'), signin.verifyChecks, validate, signin.handlers.verify);

// GET /entities/constitutions — PUBLIC (pre-auth): the verticals a registrant can choose from at sign-up. Reads the
// shared constitution catalogue. Empty (chooser hidden) if the catalogue isn't there yet.
// GOV-SPIN (additive): `installation { key, country, name }` (the country this ChitBridge states, b382, else null), `allowed_countries`
// (the constitution's tighten-only list, null = every pack) and `countries` (the packs a registrant may choose, with what each applies:
// currency · year · tax · format · languages) — the register panel paints these; it computes nothing. Same public door, no new route.
// STD2: `?tz=<the device's IANA zone>` (optional) → each country row carries `offer { timezone, from, source }` — the zone the server WILL store
// and the source it WILL record if that country is accepted (country-setup.offered: offerOf + sourceOf, the rules registerNew/verify use).
// Who may call: anyone (pre-auth, read-only, nothing per-person stored). Round trips: 1 (constitution) + the cached installation read.
router.get('/constitutions', async (req, res) => {
  const CS = require('../lib/country-setup');
  const at = await CS.atSignup();
  const spin = {
    installation: { key: at.installation.key, country: at.installation.country, name: at.installation.name || null, timezone: at.timezone },
    allowed_countries: at.allowed,
    countries: CS.offered(at, req.query && req.query.tz)
  };
  try {
    const r = await query(`SELECT constitution_key AS key, version, label, vertical, capabilities, is_default
      FROM constitution WHERE active = true ORDER BY is_default DESC, label`);
    res.json(Object.assign({ constitutions: r.rows }, spin));
  } catch (e) {
    /* STD2: never silent — the person sees no vertical chooser (the default setup applies); the countries still paint */
    require('../lib/logger').warn('entities.constitutions: catalogue unread — the vertical chooser is hidden', { why: String(e && e.message) });
    res.json(Object.assign({ constitutions: [] }, spin));
  }
});

/**
 * GET /entities/search?q=&kind=business|product&limit=&where=here|<installation_key>|all   (NET-39)
 * ONE search, Here and There (lib/network-search → lib/business-search.find): a NAME finds LISTED shops only (public storefront + the operator's cap + not closed);
 * an exact handle or bridge id still resolves (finding is not reaching: "private" shops stay reachable by a person who knows the whole handle), and a minted
 * "~" party or an internal entity (Athi, 2026-09-14: "you should not search and find cbincroot") is never shown. where=<key>|all asks the other installations
 * we deal with, one after another, 5 s each; a silent one is said in words in answers[] and the rest still answer.
 * Reply { results:[{bridge_id, display_name, user_id, kind, hits, address, installation_key, domain, where}], count, answers:[{installation_key, ok, why}] }.
 * Who may call: any signed-in business. Round trips: Here 2 (+ up to 26 for kind=product); each installation asked is one signed call.
 */
router.get('/search', auth, async (req, res) => {
  try {
    const q = sanitise(req.query.q || '');
    if (q.length < 2) return problem(req, res, { status: 400, ...contract.words.searchTooShort() });
    const kind = req.query.kind === 'product' ? 'product' : 'business';
    const found = await require('../lib/network-search').search({ q, kind, limit: req.query.limit }, req.identity, req.query.where);
    /* both statuses written in full: a place we do not deal with is a 404, a question too short is the 400 (tools/api-register.cjs reads the literals) */
    if (!found.ok && found.code === 'SEARCH_PLACE_UNKNOWN') return problem(req, res, { status: 404, code: found.code, detail: found.why });
    if (!found.ok) return problem(req, res, { status: 400, code: found.code, detail: found.why });
    res.json({ results: found.results, count: found.count, answers: found.answers });
  } catch (err) {
    console.error('Search error:', err.message);
    problem(req, res, failed(err, req, 'Search failed'));
  }
});

// GET /entities/search/places — the installations the Where picker offers: remote and ACTIVE only (a suspended one drops out), each by name and domain
router.get('/search/places', auth, async (req, res) => {
  try {
    res.json({ places: await require('../lib/network-search').places() });
  } catch (err) {
    console.error('Search places error:', err.message);
    problem(req, res, failed(err, req, 'Search failed'));
  }
});

// GET /entities/me
/**
 * ── POLICY FLAGS (b130) — Settings → Policy flags, persisted where it can be ENFORCED ──────────────────────────
 * They lived in localStorage: the card said "set ✓", nothing left the browser, and the server that enforces them
 * never heard. An actor acts FOR its entity, so the flags are always the ENTITY's, never the actor's.
 */
const policy = require('../lib/policy');
const policyEntity = (req) => auth.entityOf(req);

/* T2-POLICY (POL1): `schema[key].ui` is the Business rules card (label · help · level · gov · order) and `bound_schema` its locked rows —
   the web paints from these, it holds no copy. 1 trip.
   T3-SETTINGS: WHO MAY CHANGE EACH FLAG, said by the server (CB Settings › Policy greys a row with it) — `may[flag]`, from the SAME place the
   PATCH refuses from (lib/policy FLAGS[k].may · may_why; BOUND keys are the platform's), so the sentence a screen shows is the sentence the
   server refuses with. */
const POLICY_BOUND_WHY = 'Set by the platform for every shop.';
function policyMay(req) {
  const owner = require('../lib/owner'),
    out = {};
  for (const k of Object.keys(policy.FLAGS))
    out[k] = policy.FLAGS[k].may === 'owner' ? owner.may(req, policy.FLAGS[k].may_why) : { ok: true, code: null, why: null };
  for (const k of Object.keys(policy.BOUND)) out[k] = { ok: false, code: 'PLATFORM_BOUND', why: POLICY_BOUND_WHY };
  return out;
}

router.get('/policy', auth, async (req, res) => {
  /* AU-WORDS: the schema is worded by the shop's COUNTRY PACK (policy.schemaFor — the registration kinds it offers, the tax's name, the records
     floor); the country comes in the same read as the flags (policy.read), still 1 trip. No country → neutral words, never India's. */
  try {
    const { flags, country } = await policy.read(policyEntity(req));
    res.json({ flags, country, schema: policy.schemaFor(country), bound: policy.BOUND, bound_schema: policy.BOUND_SCHEMA, may: policyMay(req) });
  } catch (err) {
    problem(req, res, failed(err, req, 'Policy read failed'));
  }
});

router.patch('/policy', auth, ...checked('PATCH /policy'), async (req, res) => {
  /* ⚠️ who may change a flag is on the flag (policy.FLAGS[k].may — system_folders, books): the owner's, not a back door for a co-assist or a key.
     The code is the one owner code (OWNER_ONLY) — the same the GET's may[flag] carries, so a screen branches on one word. */
  const refused = policy.refusalFor(req.body, require('../lib/owner').isOwner(req));
  if (refused) return problem(req, res, { status: 403, ...contract.words.policyOwnerOnly(refused) });
  try {
    res.json({ flags: await policy.set(policyEntity(req), req.body || {}) });
  } catch (err) {
    /* a refused value carries its code (REG_KIND_NOT_OFFERED: a kind this country's pack does not offer) and the sentence; a fault never leaks e.message */
    problem(req, res, contract.policyFault(err, req));
  }
});

/**
 * GET /entities/header — N19: the shell's header sheet in ONE read: { business, licences[], trade_ready }. Built by lib/entity-header.js
 * from the shop's row, profile, gathered licences and identity-document verdicts, sent as one readBatch (one trip). Bands, penalty words
 * and which licences are core come from lib/licence-rules.js (data), never from the page. The entity's own header: an actor reads its employer's.
 */
router.get('/header', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const header = await require('../lib/entity-header').read(entity_id, req.identity.identity_id);
    /* S34: the three keys lib/entity-header.js build() answers, named (its one return) */
    res.json({ business: header.business, licences: header.licences, trade_ready: header.trade_ready });
  } catch (err) {
    problem(req, res, failed(err, req, 'Header read failed'));
  }
});

/**
 * GET /entities/sides — the CB Sides panels in ONE answer: { lean:[{g,rows}], use:[{g,rows}], impact }. What this business leans on, and
 * what leans on it. Built by lib/sides.js (reads) from the stamp, the adoptions, the connectors, the lists, the header's trade proof and the
 * register's edges. A source with no data yet comes back as a row in state 'later' ("not yet") — never a made-up number.
 */
router.get('/sides', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const sides = await require('../lib/sides').read(entity_id, req.identity.identity_id, { req });
    /* S34: the three keys lib/sides.js build() answers, named (its one return) */
    res.json({ lean: sides.lean, use: sides.use, impact: sides.impact });
  } catch (err) {
    problem(req, res, failed(err, req, 'Sides read failed'));
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    /* ⚠️⚠️ THE PROBE BELONGS IN THIS FUNCTION. I first put it above the /search query — a different route —
       so _tzCol was a ReferenceError here and defined where nothing used it. Same borrowed-variable class as
        this afternoon, and node --check cannot see either. b176 may not be run; a missing column is
       42703 and throws the whole query. */
    /**
     * ⭐⭐ ONE PROBE FOR EIGHT COLUMNS. These were eight sequential information_schema queries issued before
     * the handler read a single row, and they were most of the 3.27 SECONDS this endpoint took — measured
     * flat across five warm calls on 2026-08-23, after Athi said the system had become slow. He suspected
     * accumulated test rows. The rows were never the cost; round trips were.
     *
     * ⚠️ The cache, the yes-forever / no-for-60s policy and the deploy-before-migration guarantee are all
     * unchanged — hasColumns writes exactly the entries hasColumn would have. Only the trip count moved.
     */
    const _cols = await schema.hasColumns('identities', [
      'timezone',
      'supplies',
      'storefront_access',
      'locale_prefs',
      'ui_prefs',
      'policy_flags',
      'catalogue_visibility',
      'plan',
      'params_override'
    ]);
    const _tzCol = _cols.timezone;
    const _supCol = _cols.supplies;
    /**
     * ⭐⭐ THREE MORE COLUMNS OFF THE SAME ROW, PROBED — and they used to be TWO EXTRA ROUND TRIPS.
     *
     * Athi, 2026-08-21: *"in the code if we make multiple rounds of read, that has to be addressed."* Measured
     * by tools/round-trips.cjs: `/me` made EIGHT sequential round trips, and FOUR of them were SELECTs against
     * `identities` — the main one, then `capabilities`, then `storefront_access`, then `locale_prefs/ui_prefs`.
     * Three of the four read the SAME ROW as each other. This is the hottest endpoint on the platform: every
     * screen calls it on every boot.
     *
     * ⚠️ THEY WERE SEPARATE FOR A GOOD REASON THAT NO LONGER APPLIES, and the old comment says so plainly:
     * *"this code deploys BEFORE b165 runs — folding the column into the main query would 500 every boot in the
     * window between the two."* That was correct. It is also exactly what `lib/schema.js` was built to solve
     * this morning, after a `SELECT access_level` before b173 took co-assist sign-in down: probe what the
     * database HAS, then name only that. The two lines above already do it for `timezone` and `supplies`.
     *
     * ⚠️ PROBED INDIVIDUALLY, NOT AS A GROUP. b166 may not have run where b165 has — `locale_prefs` can exist
     * while `ui_prefs` does not, which is precisely the case the old nested fallback was written for. One probe
     * per column keeps that guarantee; a single "are the prefs there" flag would lose it.
     *
     * ⚠️ `capabilities` IS DELIBERATELY LEFT OUT. It is read for `auth.entityOf(req)` — the PARENT for an actor
     * — so for a co-assist it is a DIFFERENT ROW, and folding it in would silently hand an employee their own
     * empty capability list instead of their employer's. A round trip saved by answering the wrong question is
     * not a saving.
     */
    const _sfCol = _cols.storefront_access;
    const _lpCol = _cols.locale_prefs;
    /**
     * ⭐ FREE — `hasColumns` is ONE query for many columns, so probing a tenth costs no round trip.
     *
     * ⚠️ The app needs this BEFORE any chit is opened, because it decides which detail page a chit renders on.
     * Fetching `/entities/policy` at boot instead would put a whole extra round trip on the hottest path, which
     * is the opposite of the direction this endpoint has been moving.
     */
    const _pfCol = _cols.policy_flags;
    const _upCol = _cols.ui_prefs;
    /* ⚠️ AND THE VISIBILITY TRIO — a THIRD read of the same row, for `catalogue_visibility, plan,
       params_override`. Same identity_id, same request: three round trips to read one row. */
    const _cvCol = _cols.catalogue_visibility;
    const _plCol = _cols.plan;
    const _poCol = _cols.params_override;
    const result = await query(
      `SELECT identity_id, bridge_id, display_name, email, user_id, self_copy_pref, dispute_handler_actor_id, country, currency_code, created_at, last_active_at,
              gstn, is_verified, logo_url, address, business_status,
              purpose, sort_order, address, city, lat, lng, service_km,   -- b117/b118/b119
              actor_key, phone${_tzCol ? ', timezone' : ''}${_supCol ? ', supplies' : ''}${_sfCol ? ', storefront_access' : ''}${_lpCol ? ', locale_prefs' : ''}${_upCol ? ', ui_prefs' : ''}${_cvCol ? ', catalogue_visibility' : ''}${_plCol ? ', plan' : ''}${_poCol ? ', params_override' : ''}${_pfCol ? ', policy_flags' : ''},
              /* ⚠️ b176 MAY NOT BE RUN. A missing column is 42703 and throws the WHOLE query — the mistake that
                 took co-assist sign-in down this morning. Selected through the probe, never named blindly. */
              /* ⭐ The parent's handle, so an employee can be shown the login they actually type: key@business.
                 A correlated subselect rather than a second round trip — this route is already on the slow
                 path Athi measured at 9.3s to open a chit, and an extra query for a label is not affordable. */
              (SELECT p.user_id FROM identities p WHERE p.identity_id = identities.parent_entity_id) AS parent_user_id
       FROM identities WHERE identity_id = $1`,
      [req.identity.identity_id]
    );
    if (result.rows.length === 0) return problem(req, res, { status: 404, ...contract.words.meUnknown() });
    /* ⚠️ DECLARED HERE, BESIDE THE QUERY IT COMES FROM. It was declared 40 lines lower, next to the first
       thing that used it — and the moment a second reader appeared above that point, `const` (not hoisted)
       threw a TDZ error. A binding belongs with its source, not with its first consumer. */
    const _me = result.rows[0] || {};

    /**
     * ⭐⭐ AN EMPLOYEE MUST BE ABLE TO SEE THEIR OWN ACCESS. Athi, 2026-08-20: *"in the employee profile, there
     * is nothing mentioned about his access level… which one he belongs to."*
     *
     * ⚠️ The screen could not show it even if it wanted to: this response carried no hat and no access_level,
     * so the ONE fact an employee most needs about themselves — may I change things, may I answer the other
     * party — was the one fact the API withheld. A permission you cannot see is one you cannot ask to have
     * corrected, which is the whole point of "request your manager to modify if required".
     *
     * These come from req.identity, which middleware/auth.js has already read FROM THE DATABASE on this very
     * request — never from the token — so a demotion shows here immediately, and it costs no round trip.
     */
    /**
     * ⭐⭐ IS THIS ENTITY'S NETWORK STOREFRONT LIVE — DERIVED, NEVER STORED. Athi, 2026-08-20: *"if you change
     * the option to network, by default it is a PRIVATE network, so no storefront. But if you have any store
     * under you is public, then the storefront will be public. This way we are avoiding another status field…
     * otherwise I was wondering how to make a private network."*
     *
     * ⭐ A PRIVATE NETWORK NEEDS NO FLAG — it is simply a network where nobody has published. The question
     * "is this network public?" already has an answer in the data, and storing a second answer beside it
     * creates the one thing this codebase keeps paying for: two facts that can disagree.
     *
     * ⚠️ ONE READ, NOT N. Athi, 2026-08-19: *"again it should not be n reads, it has to be one read only."*
     * This is a single COUNT riding on a request that was already happening — not a walk of the tree.
     *
     * ⭐ MEMBERSHIP IS IN THE HANDLE, so there is nothing to join. lib/handle.js defines a network node as
     * `root.node`, so every store under `athi` has a user_id beginning `athi.` — which is exactly what a
     * prefix match asks for.
     *
     * ⚠️ THE PREFIX IS ESCAPED. A user_id may not contain % or _ today (checkRoot allows letters, numbers and
     * dashes), but a LIKE built from user input without an ESCAPE clause is a habit that outlives the
     * validator that made it safe.
     */
    if (req.identity.identity_type !== 'actor' && result.rows[0].user_id) {
      try {
        const prefix =
          String(result.rows[0].user_id)
            .toLowerCase()
            .replace(/([%_\\])/g, '\\$1') + '.';
        const nc = await query(
          `SELECT count(*)::int AS n FROM identities
            WHERE LOWER(user_id) LIKE $1 || '%' ESCAPE '\\'
              AND identity_type = 'entity' AND status = 'active'
              AND catalogue_visibility = 'public'`,
          [prefix]
        );
        result.rows[0].network_public_count = nc.rows[0] ? nc.rows[0].n : 0;
      } catch (_) {
        /* ⚠️ ABSENT, NOT ZERO. A failed count must not render as "nothing under you is public" — that is a
           definite statement, and this is the absence of one. The screen shows nothing rather than a lie. */
        result.rows[0].network_public_count = null;
      }
    }

    if (req.identity.identity_type === 'actor') {
      result.rows[0].identity_type = 'actor';
      result.rows[0].hat = req.identity.hat || null;
      result.rows[0].access_level = req.identity.access_level || null;
      result.rows[0].whole_entity = req.identity.whole_entity === true;
      result.rows[0].parent_entity_id = req.identity.parent_entity_id || null;
    } else {
      result.rows[0].identity_type = 'entity';
    }

    /**
     * ⚠️⚠️ A WRITE ON THE HOTTEST READ PATH, AND THE READER WAITED FOR IT. `last_active_at` is telemetry — no
     * part of this response depends on it — yet every profile paint blocked on an UPDATE to `identities`, the
     * busiest table in the product. Measured 2026-08-23: the floor for any authed call is ~500 ms
     * (`/entities/policy` and `/connections/list` both), and `/entities/me` was taking 3,193 ms.
     *
     * ⭐ Not awaited now. The response no longer carries the cost of recording that it happened. The write still
     * runs; if it fails nobody is blocked, and the failure is logged rather than swallowed — a "last seen"
     * stamp that quietly stops updating is a fact people later rely on.
     */
    query('UPDATE identities SET last_active_at = NOW() WHERE identity_id = $1', [req.identity.identity_id]).catch((e) =>
      log.warn('last_active_at not recorded', { id: req.id, err: e.message })
    );
    // the ENTITY's capability selection (add-ons; core is implicit) — drives the itemised capability toggles. [b55/connector]
    // Defensive: defaults to [] if the b55 column isn't present in this environment.
    let capabilities = [];
    let capabilities_debug = 'ok';
    try {
      const eid = auth.entityOf(req);
      /**
       * ⭐⭐ FOR AN ENTITY THIS IS THE ROW WE ALREADY HAVE. `entityOf()` returns `parent_entity_id ||
       * identity_id` — so for an entity caller it IS `req.identity.identity_id`, and this was a second SELECT
       * against `identities` for the row the main query fetched a few lines above. Entities are the common
       * case; the extra trip was being paid on almost every request to the platform's hottest endpoint.
       *
       * ⚠️ AN ACTOR STILL QUERIES, AND THAT IS NOT AN OVERSIGHT. For a co-assist `entityOf()` is the PARENT —
       * a different row entirely. Reading `_me.capabilities` for them would hand an employee their own (empty)
       * capability list instead of their employer's, silently removing every capability-gated nav item. A round
       * trip saved by answering the wrong question is not a saving.
       */
      const c = eid === req.identity.identity_id && _me ? { rows: [_me] } : await query('SELECT capabilities FROM identities WHERE identity_id = $1', [eid]);
      capabilities = (c.rows[0] && c.rows[0].capabilities) || [];
      capabilities_debug =
        (c.rows[0] ? 'rows=1' : 'rows=0') + ' eid=' + String(eid).slice(0, 8) + ' raw=' + JSON.stringify(c.rows[0] ? c.rows[0].capabilities : null);
    } catch (e) {
      capabilities_debug = 'unavailable'; log.fellBack('entities GET /me: the capability read failed — carried on without it', e);
    }
    // NOTE: the web client's api() runs every body through unwrap(), which returns j.entity for /me and
    // DROPS sibling keys. So the capability selection MUST ride INSIDE entity to reach SESSION.capabilities
    // (which gates the itemised capability nav). Top-level copies kept for direct/API callers + curl. [b55/connector]
    // Resolve the entity's GOVERNANCE from attributes (constitution · installation · basics · allowances · jurisdiction).
    // Best-effort; rides INSIDE entity (unwrap() drops siblings) so the client can read it. Null if not resolvable yet.
    let governance = null;
    try {
      governance = await require('../lib/govresolve').resolveEntityGovernance(auth.entityOf(req)); /* by the module, so a test can make it fail */
    } catch (e) {
      log.fellBack('entities GET /me: failed — carried on without it', e);
    }
    /**
     * ⭐⭐ READ FROM THE ROW WE ALREADY HAVE — these were TWO EXTRA ROUND TRIPS against `identities` for the
     * SAME identity_id the main SELECT above just fetched. On the hottest endpoint on the platform.
     *
     * ⚠️ THE SELF-HEALING DEFAULTS ARE UNCHANGED AND THEY ARE NOT COSMETIC. Absent `storefront_access`,
     * 'browse' is what b77 established. Absent `locale_prefs`, `{}` means "never chosen", which CBLocale.hydrate
     * treats as "keep what this device has" — NOT as "chose the default". A column that is missing and a column
     * that is empty must keep answering differently, and folding the reads together must not blur them.
     *
     * ⚠️ THE PARTIAL-MIGRATION CASE STILL DEGRADES TO LESS, NEVER TO NOTHING. The old code nested a
     * try/catch so that b166 missing where b165 had run still returned the language. Per-column probes give the
     * same guarantee structurally: `locale_prefs` is selected when it exists whether or not `ui_prefs` does.
     */
    const storefront_access = _sfCol ? _me.storefront_access || 'browse' : 'browse';
    const locale_prefs = (_lpCol && _me.locale_prefs) || {};
    const ui_prefs = (_upCol && _me.ui_prefs) || {};
    /* ⚠️ Absent the column, `{}` — which reads as "never chosen" and lets every default apply, the same shape
       locale_prefs uses above. Never a guessed value: a made-up preference is worse than no preference. */
    const policy_flags = (_pfCol && _me.policy_flags) || {};
    // b114 (self-healing): is this entity's catalogue exposed at all? Pre-b114 there was no such setting and adoption
    // silently published, so absent the column we report 'public' — the behaviour that was actually in force.
    // The EFFECTIVE visibility, plus the cap that produced it. Reporting the stored flag alone would let a capped
    // entity's own profile read 'public' while the world correctly sees nothing — the owner would have no way to
    // understand why their link is dead.
    let catalogue_visibility = 'public';
    let visibility_cap = { max: 'public', by: null, enforced: false, reason: '' };
    try {
      /* ⭐ THE ROW IS ALREADY IN HAND — see the probe note above. This was the THIRD SELECT against `identities`
         for the same identity_id inside one request. */
      const row = _me;
      let planMenu = null;
      try {
        const c = await require('./governance').loadActiveConstitution();
        planMenu = c && c.plan_menu;
      } catch (e) {
        log.fellBack('entities GET /me: the helper failed — carried on without it', e);
      }
      visibility_cap = visibilityCap.capOf({ plan: row.plan, planMenu, paramsOverride: row.params_override || {} });
      catalogue_visibility = visibilityCap.effective(row.catalogue_visibility, visibility_cap);
    } catch (e) {
      log.fellBack('entities GET /me: the read failed — carried on without it', e); /* pre-b114 → the default above */
    }
    const entityOut = Object.assign({}, result.rows[0], {
      capabilities,
      capabilities_debug,
      governance,
      storefront_access,
      catalogue_visibility,
      visibility_cap,
      locale_prefs,
      ui_prefs,
      policy_flags,
      dev_tools: devOtp.mayShowDevTools([result.rows[0].email, result.rows[0].user_id, result.rows[0].bridge_id])
    }); // W1: the web's Build preview strip; the names the tester code is checked against
    /**
     * ⭐⭐ ?include= — ONE HTTP ROUND TRIP INSTEAD OF FOUR. Athi, 2026-08-21: *"why do we need a round trip,
     * can't the js send all the required information in one shot and get it from the background? We have built
     * most of the stuff as lazy load, and for each lazy load if we have to do a round trip, that will feel like
     * waiting forever."*
     *
     * ⚠️⚠️ HE IS POINTING AT THE BIGGER OF THE TWO COSTS, AND I HAD BEEN FIXING THE SMALLER ONE. A database
     * round trip is 1–5ms; an HTTP round trip from India to Railway is 200–400ms. Painting one profile made
     * FOUR of them — `/entities/me`, `/governance/readiness`, `/channels`, `/governance/profile` — so over a
     * second of pure network before the screen was complete. Collapsing eight DB queries into five saved ~15ms.
     * This saves about a second.
     *
     * ⭐ INCLUDES, NOT A SCREEN-SHAPED ENDPOINT. A `GET /screen/profile` would bake the UI's current layout into
     * the API, and twelve of those would make every re-layout a server change. The client names what it wants;
     * the server has no idea a "profile screen" exists.
     *
     * ⚠️ THE SAME LIBRARY FUNCTION THE STANDALONE ROUTE CALLS — `lib/readiness`, `lib/channels`, `lib/profile`.
     * Not a copy. A bundle that reimplements its parts is how the bundled answer and the direct answer start
     * disagreeing, and the direct routes stay because other callers use them.
     *
     * ⚠️ ONE INCLUDE FAILING MUST NOT COST THE OTHERS OR THE ENTITY. Each is caught alone and reports its own
     * error in place: the profile still paints without its channels, which is exactly how it behaves today when
     * one of the four separate fetches fails. Degrade to less, never to nothing.
     */
    const want = String(req.query.include || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const included = {};
    if (want.length) {
      const eid = auth.entityOf(req);
      const LOAD = {
        readiness: () => require('../lib/readiness').resolveReadiness(eid),
        channels: () => require('../lib/channels').listChannels(eid),
        vault: () => require('../lib/profile').getProfile(eid)
      };
      /* ⚠️ SEQUENTIAL, NOT Promise.all. The pool is max:10 and these each open their own transaction — three
         in parallel per request means two concurrent readers want six connections. The win here is removing
         three HTTP round trips, not three DB ones; parallelising the small cost to risk the pool is a bad
         trade. See the note at the top of tools/round-trips.cjs. */
      /* ⚠️ REVISITED 2026-09-05. Measured: this request took 7–10 s because the three includes ran one after the other,
         each ~20 DB round trips across a continent (channels alone opens nine transactions). Three in parallel is three
         connections of a pool of ten — the note above priced that risk when a trip cost 5 ms; at 300 ms the sequential
         wait is the worse failure, and every app open pays it. The real fix is readBatch inside each lib. */
      const keys = want.filter((item) => Object.prototype.hasOwnProperty.call(LOAD, item));
      want
        .filter((item) => keys.indexOf(item) < 0)
        .forEach((item) => {
          included[item] = { error: 'unknown include' };
        });
      const list = await Promise.all(
        keys.map((item) =>
          LOAD[item]().then(
            (reply) => [item, reply],
            (e) => [item, { error: safeErr(e) }]
          )
        )
      );
      list.forEach(([k, v]) => {
        included[k] = v;
      });
    }

    res.json({ entity: entityOut, capabilities, capabilities_debug, governance, included: want.length ? included : undefined }); /* S34: `included` named; undefined (left out of the JSON as before) when ?include= asked for nothing */
  } catch (err) {
    console.error('Profile error:', err.message);
    problem(req, res, failed(err, req, 'Failed to get profile'));
  }
});

router.patch('/me/prefs/:kind', auth, ...checked('PATCH /me/prefs/:kind'), prefSetRoute(null));

/**
 * PATCH /entities/me/exposure — the business's DEFAULT "Shown to customers" switches (lib/exposure.js KEYS), merged into
 * policy_flags.storefront_exposure; an item's own switches override them. Only known keys, only booleans.
 */
router.patch('/me/exposure', auth, ...checked('PATCH /me/exposure'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const X = require('../lib/exposure');
    const payload = req.body || {};
    const out = {};
    for (const k of X.KEYS) if (k in payload) out[k] = !!payload[k];
    if (!Object.keys(out).length) return problem(req, res, { status: 400, ...contract.words.exposureNoSwitch() });
    await policy.patchKey(null, entity_id, ['storefront_exposure'], out, { op: 'merge' }); /* T2-POLICY: the one writer */
    const r = await query(`SELECT policy_flags->'storefront_exposure' AS x FROM identities WHERE identity_id = $1`, [entity_id]);
    res.json({ message: 'Defaults saved', exposure: Object.assign({}, X.DEFAULTS, (r.rows[0] && r.rows[0].x) || {}) });
  } catch (err) {
    problem(req, res, failed(err, req, 'Exposure save failed'));
  }
});

/**
 * GET /entities/me/can-see-costs — [OFFR-04] "may I, the caller, see cost and margin in Offer Lab?"
 *
 * ⚠️⚠️⚠️ NO PATCH HERE — GRANTING ALREADY HAS A DOOR. A first version of this invented its own
 * entity-wide policy_flags switch and a matching PATCH before finding lib/cost.js (b145) already answers
 * this exact question with a per-actor identities.can_see_costs column, granted one co-assist at a time
 * through the EXISTING PATCH /api/actors/:id (owner-only, guarded there, with its own audit trail and its
 * own "Sees costs" chip already live in app/cap-admin.js's co-assist screen). Reusing that is the fix, not
 * a second door to the same permission. This route only READS what the caller's own identity already has,
 * for Offer Lab's client-side UI to agree with the server without re-deriving the rule.
 */
router.get('/me/can-see-costs', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const cost = require('../lib/cost');
    res.json({ can_see_costs: await cost.canRead(req, entity_id), is_owner: req.identity.identity_type === 'entity', may_set_rate: require('../lib/rate-door').setsRate(req) });
  } catch (err) {
    problem(req, res, failed(err, req, 'Read failed'));
  }
});

/* ⚠️ THE SHIPPED PATH, KEPT. Clients deployed before this refactor call /me/locale, and a browser holding a
   cached app.html will keep calling it after the API updates. Removing it would turn a tidy-up into an outage
   for exactly as long as those caches live. */
router.patch('/me/locale', auth, ...checked('PATCH /me/locale'), prefSetRoute('locale'));

// PATCH /entities/profile — set shop GSTN / logo / address (B3.9) + external user_id (ATH-114)

/**
 * The cap on THIS entity's catalogue visibility — the operator who provisioned it, then the plan.
 *
 * One query, whatever the caller. The plan_menu comes from the active constitution; if there is no constitution or
 * the plan is not declared in it, capOf() allows and reports  rather than denying — see
 * lib/visibility-cap.js for why an absent declaration must not close every shop on the platform.
 */
async function visibilityCapFor(entityId) {
  let plan = null,
    paramsOverride = {};
  try {
    const r = await query('SELECT plan, params_override FROM identities WHERE identity_id = $1', [entityId]);
    if (r.rows[0]) {
      plan = r.rows[0].plan;
      paramsOverride = r.rows[0].params_override || {};
    }
  } catch (e) {
    log.fellBack('entities visibilityCapFor: the read failed — carried on without it', e); /* pre-governance schema — capOf() then reports unenforced */
  }
  let planMenu = null;
  try {
    const c = await require('./governance').loadActiveConstitution();
    planMenu = c && c.plan_menu;
  } catch (e) {
    log.fellBack('entities visibilityCapFor: the helper failed — carried on without it', e);
  }
  return visibilityCap.capOf({ plan, planMenu, paramsOverride });
}

router.patch(
  '/profile',
  auth,
  require('../lib/access').writeGate /* SEC-71: the shop's own details are the owner's or an editor's to change */,
  /**
   * ⚠️ EVERY RULE SAYS WHAT IT WANTS. Athi, 2026-08-18: *"it says validation failed, not sure what it is. Need
   * to have explanation so people understand and update accordingly."*
   *
   * These had no messages, so express-validator answered "Invalid value" — which names neither the field nor
   * the rule and leaves someone re-typing at random. A validator that refuses without saying why has moved the
   * work from the code to the person, which is the wrong direction.
   */
  [
    /**
     * ⚠️⚠️ THE NAME COULD NOT BE CHANGED AT ALL, and the screen had it exactly backwards. Athi, 2026-08-19:
     * *"if they are different, we should be providing an option to change the name here. Not the user id."*
     * *"and it looks reverse. That is the problem."*
     *
     * He is right twice. This app's own naming table says display_name is *"Change it any time — nothing cites
     * it, everything cites your ID"* — and yet PATCH /profile had no display_name validator and never wrote it,
     * while user_id, the handle every other name derives from, was a freely editable input.
     *
     * The MUTABLE fact was fixed and the LOAD-BEARING one was loose. Now the name is editable, as documented.
     */
    body('display_name').optional().trim().isLength({ min: 2, max: 255 }).withMessage('A business name is 2 characters or more.'),
    /* T2-POLICY (SET4): no "15 characters" here — the tax number is checked in the handler by profile.taxIdRefusal, from the shop's pack */
    body('gstn').optional().trim(),
    body('logo_url').optional().trim(),
    body('address').optional().trim(),
    body('business_status').optional().isIn(['open', 'closed', 'away']),
    /* ⭐ b177-era: the entity may CHOOSE a currency. Bounded below against what the constitution permits —
       an enum here would freeze the set, and the whole point is that the layer decides it. */
    body('currency_code').optional().trim().isLength({ min: 3, max: 3 }),
    /* 'none' and 'unknown' added with b238. 'none' is a real answer — a business buying only for its own use
       supplies nothing — and must stay distinguishable from 'unknown', which means nobody asked. A form that
       cannot tell those apart produces counts nobody can trust. 'unknown' is never offered on screen. */
    body('supplies').optional().isIn(['goods', 'services', 'both', 'none', 'unknown']).withMessage('Shop status can be open, closed or away.'),
    body('storefront_access')
      .optional()
      .isIn(['browse', 'login'])
      .withMessage('Storefront access can be "browse" (open catalogue) or "login" (sign in first).'),
    body('self_copy_pref').optional().isIn(['both', 'sent', 'received']).withMessage('Keep-a-copy can be both, sent or received.'),
    body('dispute_handler_actor_id').optional().isUUID().withMessage('Pick a co-assist from the list — that is not a valid id.'),
    /**
     * user_id — the handle a person TYPES. Athi, 2026-08-07: *"we should not allow space in the user id."*
     *
     * Right, and the rule had never looked at the CONTENT: it checked length or email shape and nothing else, so
     * `alpha timers` saved happily and then could never be a network root — `lib/handle.js` refuses a space, and
     * a co-assist signs in as `ravi@alpha timers.west`, which nobody can type or read out. A value that is
     * accepted here and refused everywhere it is used is worse than a value refused up front.
     *
     * Letters, digits, dots and dashes. Dots because a network handle IS dotted (`alpha-timers.west`); dashes
     * because that is what a space becomes. Case is allowed — uniqueness is already case-insensitive
     * (idx_identities_user_id is on lower(user_id)) and handle.js lowercases before it checks.
     *
     * ⚠️ A TIGHTENING, and it only governs WRITES. Any user_id already stored with a space keeps working for
     * login; it simply cannot be re-saved unchanged, and cannot be a network root. Rejecting stored values
     * retroactively would lock those owners out of their own accounts.
     */
    /**
     * ⚠️⚠️ THIS HAD ITS OWN PRIVATE REGEX, AND IT WAS THE LOOSE ONE. It allowed dots (`athi.clothing` — a name in
     * the NETWORK space), capitals (the uniqueness index is on lower(user_id)), emails, and CB-lookalikes that
     * impersonate a Bridge ID. Two rule sets for one identifier, disagreeing on five of nine cases, and the path a
     * PERSON types on was the permissive one. Now there is one: handleLib.checkRoot, applied in the handler so the
     * set-once check and the format check give the same answer.
     */
    body('user_id').optional().trim()
  ],
  validateAsProblem /* the same chains, the same old "Validation failed" body, answered as a Problem */,
  ...checked('PATCH /profile'),
  async (req, res) => {
    try {
      /* ⚠️ THE SHOP'S ROW, never the caller's (T3-FIXES, CAT-FIX1): a co-assist's name/address/GSTIN save landed on its own actor
         row, where nothing reads it, and the screen said saved. entityOf = parent for a co-assist, itself for the owner. */
      const id = auth.entityOf(req);
      /**
       * ⚠️⚠️ SET ONCE. Athi, 2026-08-19: *"the registered user id cannot be changed. Are you able to change your
       * Gmail id? The same way here."*
       *
       * The UPDATE below writes COALESCE(user_id, $3) — the existing value always wins — so a change is impossible
       * at the write even if this check were bypassed. But a write that SILENTLY ignores what you sent is its own
       * defect: the screen would report "saved" and the value would be unchanged. So say so, out loud, with 409.
       *
       * ⚠️ IT STILL ACCEPTS A VALUE WHEN THE COLUMN IS NULL. That is not a loophole, it is the REPAIR PATH —
       * entities registered before the User ID was collected have none, and must be able to set one once.
       */
      /**
       * ⚠️⚠️ ONLY AN ENTITY MAY CLAIM A USER ID. Athi's rule, 2026-08-19: *"through registration page, ONLY THE
       * ENTITY REGISTERS. Employee or network or anyone else can never register through the registration
       * screen."* An employee's login IS `key@entity` — they have no handle of their own and never should.
       *
       * ⚠️ THIS WAS OPEN AND I CONFIRMED IT LIVE: a co-assist PATCHed `{"user_id":"clerkstolen"}` here and got
       * 200. The route writes `req.identity.identity_id` — the CALLER'S row — so the value landed on the actor,
       * where it is read by nothing. That sounds harmless and is not: `user_id` carries a UNIQUE index across
       * ALL identities, it is the handle another business types to connect to you, and it is the root of every
       * network handle. An employee could therefore occupy a name globally — including one a real business
       * wants — and because the claim is SET-ONCE, nobody could ever take it back.
       *
       * ⭐ Refused here rather than in the validator, so the message can say WHY instead of "invalid".
       */
      if (req.identity.identity_type === 'actor' && req.body.user_id !== undefined && String(req.body.user_id).trim() !== '') {
        return problem(req, res, { status: 403, ...contract.words.userIdEntityOnly() });
      }

      let userId = null;
      if (req.body.user_id !== undefined && String(req.body.user_id).trim() !== '') {
        const cur = await query('SELECT user_id FROM identities WHERE identity_id = $1', [id]);
        const existing = cur.rows[0] && cur.rows[0].user_id;
        const verdict = handleLib.checkRoot(req.body.user_id);
        if (existing) {
          if (verdict.value !== String(existing).toLowerCase()) {
            return problem(req, res, { status: 409, ...contract.words.userIdFixed(existing) });
          }
        } else {
          if (!verdict.ok) {
            return problem(req, res, { status: 400, ...contract.words.userIdInvalid(verdict.reason) });
          }
          const taken = await query('SELECT 1 FROM identities WHERE LOWER(user_id) = $1 AND identity_id <> $2', [verdict.value, id]);
          if (taken.rows.length) {
            return problem(req, res, { status: 409, ...contract.words.userIdTaken(verdict.value) });
          }
          userId = verdict.value; // lowercase: the uniqueness index is on lower(user_id)
        }
      }
      // dispute_handler must be one of MY OWN actors — never an arbitrary identity.
      const handler = req.body.dispute_handler_actor_id || null;
      if (handler) {
        const ok = await query(`SELECT 1 FROM identities WHERE identity_id=$1 AND identity_type='actor' AND parent_entity_id=$2`, [handler, id]);
        if (!ok.rows.length) return problem(req, res, { status: 400, ...contract.words.badHandler() });
      }
      /**
       * ⭐⭐ THE REGION BOUNDS THE SET; THE ENTITY PICKS ONE FROM IT. Athi, 2026-08-20: *"under region there can
       * be MULTIPLE currencies, one of the currency will be chosen."*
       *
       * ⚠️ SO IT IS VALIDATED HERE, NOT WITH AN ENUM. An isIn([...]) in the validator would freeze the list in
       * the route, and the whole point is that the CONSTITUTION decides it. A currency outside the envelope is
       * refused with the permitted set named, so the answer is actionable rather than "invalid".
       */
      /**
       * ⚠⚠ AND ONLY AN ENTITY MAY SET IT — the same hole as user_id, found the same way. This route writes
       * `req.identity.identity_id`, the CALLER'S row, so a co-assist submitting a currency wrote it onto their
       * own actor record where nothing reads it: the screen said saved and the business kept its old currency.
       * Silent and wrong is worse than refused.
       *
       * ⭐ Athi's rule, 2026-08-20: *"the access the employee cannot change — it should be done by entity."*
       * A trading currency is a fact about the business that every counterparty reads off a price.
       */
      if (req.identity.identity_type === 'actor' && req.body.currency_code !== undefined) {
        return problem(req, res, { status: 403, ...contract.words.currencyEntityOnly() });
      }

      let _cur = null;
      if (req.body.currency_code) {
        /* ⚠️ ONE ANSWERER — see lib/govresolve.currencyRefusal. The envelope check used to be written out here,
           and the SECOND place that sets this column (network-design/build) was added without it. */
        const refusal = await currencyRefusal(id, req.body.currency_code);
        if (refusal) return problem(req, res, { status: refusal.code === 'CURRENCY_MALFORMED' ? 400 : 422, ...contract.words.currencyRefused(refusal) });
        _cur = String(req.body.currency_code).toUpperCase();
      }
      /* ⭐ T2-POLICY (SET4): the tax number and address through the ONE writer's fragment (profile.shopIdentitySql), in this statement —
         only what was sent (an absent or empty field leaves the column alone, as COALESCE did). The number is checked against the
         shop's pack first (the country read only when a number was sent). */
      const P = require('../lib/profile');
      const idFields = {};
      if (req.body.gstn) {
        const c = await query('SELECT country FROM identities WHERE identity_id = $1', [id]);
        const bad = P.taxIdRefusal(c.rows[0] && c.rows[0].country, req.body.gstn);
        if (bad) return problem(req, res, { status: 400, ...contract.words.taxNumberRefused(bad) });
        idFields.tax_id = req.body.gstn;
      }
      if (req.body.address) idFields.address = req.body.address;
      const idSql = P.shopIdentitySql(idFields, 10);
      await query(
        `UPDATE identities SET display_name=COALESCE($7,display_name), logo_url=COALESCE($1,logo_url)${idSql.sql ? ', ' + idSql.sql : ''},
                business_status=COALESCE($2,business_status),
                user_id=COALESCE(user_id,$3),
                self_copy_pref=COALESCE($4,self_copy_pref),
                dispute_handler_actor_id=COALESCE($5,dispute_handler_actor_id),
                currency_code=COALESCE($8,currency_code),
                supplies=COALESCE($9,supplies)
         WHERE identity_id=$6`,
        [
          req.body.logo_url || null,
          req.body.business_status || null,
          userId,
          req.body.self_copy_pref || null,
          handler,
          id,
          /* $7 — sanitised like every other free-text field. COALESCE means an absent name leaves it alone. */
          req.body.display_name ? sanitise(req.body.display_name) : null,
          /* $8 — validated against the constitution above; null leaves it alone. */
          _cur,
          req.body.supplies || null
        ].concat(idSql.params)
      );
      // b77 (self-healing): storefront access saved separately so a normal profile save works even before b77 is applied.
      if (req.body.storefront_access) {
        try {
          await query('UPDATE identities SET storefront_access=$1 WHERE identity_id=$2', [req.body.storefront_access, id]);
        } catch (e) {
          log.fellBack('entities: the write failed — carried on without it', e);
        }
      }
      /* ui_prefs — the business's own UI choices (which product rows show, appearance). MERGED, never replaced, so two
         screens saving two keys do not erase each other. Guarded by the column probe: b166 may not have run. */
      if (req.body.ui_prefs && typeof req.body.ui_prefs === 'object' && !Array.isArray(req.body.ui_prefs)) {
        /* the same merge-patch as /me/prefs: a null value removes its key (RFC 7386), an absent key is untouched */
        const _up = {},
          _upDrop = [];
        for (const [k, v] of Object.entries(req.body.ui_prefs)) {
          if (v === null) _upDrop.push(k);
          else _up[k] = v;
        }
        try {
          if (await require('../lib/schema').hasColumn('identities', 'ui_prefs'))
            await query(`UPDATE identities SET ui_prefs = ${MERGE_PATCH_SQL('ui_prefs')} WHERE identity_id=$2`, [JSON.stringify(_up), id, _upDrop]);
        } catch (e) {
          log.fellBack('entities: the write failed — carried on without it', e);
        }
      }
      // b114 (self-healing): CATALOGUE VISIBILITY — publishing is an explicit act. Whitelisted, never free text, and
      // saved separately so a normal profile save still works before b114 is applied.
      // ── PUBLISHING IS A CHOICE, BOUNDED BY A CAP (2026-08-06) ────────────────────────────────────────────────
      // Athi: "even a private catalogue can be made public — how do we protect one, say it is done from the
      // networking side? The entity should be private, not public."
      //
      // Until now this was a whitelist and a write: no plan check, no operator check. `assertPublicAllowed()` had
      // sat in routes/governance.js since it was written, exported, with zero callers and a comment saying "not
      // wired yet". The cap is now resolved from the OPERATOR's provisioning (params_override.caps) and then the
      // plan, and a refusal names who refused — an unattributable refusal reads as a bug.
      if (['public', 'private', 'network'].includes(req.body.catalogue_visibility)) {
        const capInfo = await visibilityCapFor(id);
        const verdict = visibilityCap.check(req.body.catalogue_visibility, capInfo);
        if (!verdict.ok) {
          return problem(req, res, { status: verdict.status, ...contract.words.visibilityCapped(verdict, capInfo.by) });
        }
        /**
         * ⚠️ THIS `catch` USED TO SWALLOW EVERYTHING, and it cost twenty minutes and hid my own mistake.
         *
         * b114 added `CHECK (catalogue_visibility IN ('public','private'))`. When `network` was introduced, the
         * UPDATE started failing on that constraint — and the bare catch ate it, so the API answered
         * `200 {"message":"Profile updated"}` while nothing was written. The write path looked correct, the read
         * path looked correct, and the value never moved. Exactly the shape this codebase keeps producing:
         * something reports success and the outcome is absent.
         *
         * The catch exists for ONE legitimate reason — self-healing when b114 has not been applied and the column
         * does not exist (42703). That case, and only that case, stays silent.
         */
        try {
          await query('UPDATE identities SET catalogue_visibility=$1 WHERE identity_id=$2', [req.body.catalogue_visibility, id]);
        } catch (e) {
          if (e && e.code === '42703') {
            /* pre-b114: no column yet — genuinely nothing to do */
          } else if (e && e.code === '23514') {
            return problem(req, res, { status: 409, ...contract.words.visibilityNotMigrated(req.body.catalogue_visibility) });
          } else {
            return problem(req, res, failed(e, req, 'Not stored'));
          }
        }

        /**
         * ⭐⭐ AND THE SAME ANSWER ON THE SCHEMA — without this, TURNING YOUR SHOP PUBLIC DID NOT MAKE IT PUBLIC.
         *
         * There are two visibility fields and the storefront reads the OTHER one:
         *   · `identities.catalogue_visibility` — what the owner chooses here, and the b114 gate
         *   · `entity_schemas.visibility`       — what `buildPublicView()` actually requires, and what the b49
         *                                          RLS policy on catalogue_items keys off
         *
         * ⚠️ THE SECOND ONE WAS A SNAPSHOT TAKEN AT REGISTRATION AND NEVER UPDATED AGAIN.
         * `schema-bootstrap.ensureDefaultSchema()` derives it from whatever the entity had declared at the moment
         * the schema was created — and it is called from inside REGISTRATION (this file, ~line 249), before the
         * owner has had any chance to choose. So `declared` is still the default and every entity onboarded
         * through the current flow got a PRIVATE schema, permanently.
         *
         * ⚠️ NOTHING IN THE FRONT END EVER CALLED `PATCH /api/schemas/visibility` — the route that would have
         * fixed it exists and had no caller anywhere in the app. Measured 2026-08-18: a fresh entity with
         * catalogue_visibility='public', a catalogue face and a product answered 404 on /api/catalogue/:bridge to
         * an anonymous visitor, to a buyer, AND to its own owner. `alpha` and `gamma` work only because their
         * schemas happened to be created public by an earlier path.
         *
         * ⚠️ THIS RELAXES VISIBILITY, WHICH IS WHY IT WAITED FOR ATHI'S EXPLICIT YES (2026-08-18) rather than
         * being slipped in with the diagnosis. It runs only AFTER `visibilityCap.check` has approved the value,
         * so a plan or operator cap still refuses first and this cannot widen anything the cap denied.
         *
         * ⚠️ THE MAPPING IS SHARED WITH schema-bootstrap, not re-invented: `network` counts as open here because
         * b114 decides WHO may read it, and a network-only warehouse its own siblings cannot see is not
         * protected, it is broken. Two places deciding this differently is the bug one layer down.
         *
         * ⭐⭐ AND IT USED TO BE A COPY — the line below was the same expression written out a second time, with
         * a comment saying it had been copied deliberately. A copy that KNOWS it is a copy is still a copy: the
         * comment travels with the code that was right on the day, and nothing makes the other one follow. This
         * bug already exists one layer down (two columns for one fact); duplicating its rule was the same
         * mistake in miniature. `schemaVisibilityFor` is now the only place that decides.
         */
        const { schemaVisibilityFor } = require('../lib/schema-bootstrap');
        const schemaVisibility = schemaVisibilityFor(req.body.catalogue_visibility);
        try {
          await query(
            `UPDATE entity_schemas SET visibility = $1
              WHERE entity_id = $2 AND status = 'active' AND is_default = true`,
            [schemaVisibility, id]
          );
        } catch (e) {
          /* An entity with no default schema yet is not an error — it gets one at first use, and
             ensureDefaultSchema will then read the value we just wrote above. Anything else is worth surfacing:
             silently swallowing it is exactly how the identities write hid its own failure for twenty minutes. */
          if (e && (e.code === '42703' || e.code === '42P01')) {
            /* pre-migration column/table — nothing to do */
          } else return problem(req, res, failed(e, req, 'Not stored'));
        }
      }
      res.json({ message: 'Profile updated' });
    } catch (err) {
      if (err.code === '23505') return problem(req, res, { status: 409, ...contract.words.userIdRace() });
      problem(req, res, failed(err, req, 'Profile update failed'));
    }
  }
);

// PATCH /entities/:id/erase — mark an identity erased (tombstone). The platform role only (lib/platformroot.refuseUnlessPlatform, W1-SET).
// Full PII-redaction sweep is a separate ops routine; this just flips the markers.
router.patch('/:id/erase', auth, platformGate, ...checked('PATCH /:id/erase'), async (req, res) => {
  try {
    // sealed = protected (governance/root/Help) — delete flows MUST refuse it (b43). Enforce it here.
    const s = await query(`SELECT sealed FROM identities WHERE identity_id = $1`, [req.params.id]);
    if (s.rows[0] && s.rows[0].sealed) return problem(req, res, { status: 403, ...contract.words.sealed() });
    await query(`UPDATE identities SET is_erased=true, erased_at=NOW(), status='erased' WHERE identity_id=$1`, [req.params.id]);
    res.json({ message: 'Identity tombstoned', id: req.params.id });
  } catch (err) {
    problem(req, res, failed(err, req, 'Erase failed'));
  }
});

/**
 * ── GET /api/entities/usage — WHAT THIS ENTITY HAS BEEN BILLED FOR ─────────────────────────────────────────
 *
 * Athi, 2026-08-23: *"ledger only design confirmed"* and *"give me a screen to look at the details in the
 * profile."*
 *
 * ⭐ ALWAYS THE CALLER'S OWN LEDGER. There is no entity parameter, so there is no way to ask this question
 * about somebody else — the safest shape for a billing read, and one fewer thing for RLS to be the last line of
 * defence on.
 *
 * ⚠️⚠️ IT REPORTS **BILLED**, NEVER **SENT**, AND THE RESPONSE SAYS SO IN ITS OWN FIELD NAMES. A meter is
 * best-effort by design — it must never fail a send — so this total can legitimately sit below the number of
 * chits in the mailbox. That gap is a FINDING (events that were not billed), not a defect to be reconciled
 * away by making the numbers agree. `counts: { billed: n }` is named that way so no screen can accidentally
 * print it as "chits sent".
 */
router.get('/usage', auth, async (req, res) => {
  try {
    const me = req.identity.identity_id;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

    const out = await withEntity(me, async (c) => {
      /* Per day — the accumulation Athi asked about: "it is nothing but accumulation per day". */
      const daily = await c.query(
        `SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
                count(*)::int                          AS events,
                COALESCE(sum(cost_usd), 0)::numeric(12,4) AS cost
           FROM usage_ledger
          WHERE entity_id = $1 AND created_at > now() - ($2 || ' days')::interval
          GROUP BY 1 ORDER BY 1 DESC`,
        [me, String(days)]
      );

      /* Per meter — what KIND of thing is costing. */
      const byMeter = await c.query(
        `SELECT meter,
                count(*)::int                          AS events,
                COALESCE(sum(quantity), 0)::bigint     AS quantity,
                COALESCE(sum(cost_usd), 0)::numeric(12,4) AS cost
           FROM usage_ledger
          WHERE entity_id = $1 AND created_at > now() - ($2 || ' days')::interval
          GROUP BY 1 ORDER BY cost DESC, events DESC`,
        [me, String(days)]
      );

      /**
       * The rows themselves. `detail` is the reference — for `chit.send` it is the chit id, so a row can always
       * be walked back to the trade it charged for. `meta` carries the stamped rate and basis, which is what
       * makes "why was this charged that?" answerable after the card has changed.
       */
      const recent = await c.query(
        `SELECT meter, detail, quantity, cost_usd, meta, created_at
           FROM usage_ledger
          WHERE entity_id = $1
          ORDER BY created_at DESC
          LIMIT 100`,
        [me]
      );

      return { daily: daily.rows, by_meter: byMeter.rows, recent: recent.rows };
    });

    const total = out.by_meter.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    res.json({
      ok: true,
      window_days: days,
      /* Named for what it is. See the note above: this is the BILLED count. */
      counts: { billed: out.by_meter.reduce((sum, item) => sum + Number(item.events || 0), 0) },
      total_cost_usd: Math.round(total * 10000) / 10000,
      rate_card: require('../lib/rates').CARD.id,
      daily: out.daily,
      by_meter: out.by_meter,
      recent: out.recent
    });
  } catch (err) {
    /* ⚠️ A missing table is not an error worth a 500 to the reader: b99 may not be applied in every environment. */
    if (/relation .*usage_ledger.* does not exist/i.test(String(err.message))) {
      return res.json({
        ok: true,
        window_days: 0,
        counts: { billed: 0 },
        total_cost_usd: 0,
        rate_card: null,
        daily: [],
        by_meter: [],
        recent: [],
        not_enabled: true
      });
    }
    log.error('usage read failed', { id: req.id, err: err.message });
    problem(req, res, failed(err, req, 'Usage read failed'));
  }
});

/**
 * GET /api/entities/entitlements — WHAT DOES MY PLAN GRANT? Reports. Gates nothing.
 *
 * Athi, 2026-09-14: *"we can change some of the entities plan to free, and other things to confirm that the
 * tier works."*
 *
 * ── ⚠️⚠️ CHANGING A PLAN TODAY PROVES NOTHING, AND THAT IS WHY THIS EXISTS ─────────────────────────────────────
 *
 * `identities.plan` has exactly one reader that acts on it — lib/visibility-cap.js — and it is DELIBERATELY
 * SWITCHED OFF. Its own header records why:
 *
 *   *"I enforced this and it took the platform down for a minute. The live constitution's plan_menu declares
 *   free: { public_facing: false }, EVERY entity is on free, and nothing had ever read that field — so the
 *   moment the check went live, Beta Fresh and every other shop was refused."*
 *
 * ⭐ SO: MAKE THE TIER VISIBLE BEFORE MAKING IT BINDING. Set a shop to `free`, call this, and see exactly what
 * would change — with nothing refused and nobody locked out. The outage above happened because a declaration
 * nobody had audited became policy the instant something believed it. This is how you audit it first.
 *
 * ⚠️ `enforced` IS FALSE AND MUST STAY FALSE until Athi turns tiering on deliberately. A caller that finds this
 * endpoint and assumes it describes live behaviour would be wrong, so the payload says so in its own field
 * rather than in a comment nobody reads. [[feedback-silence-is-the-bug]]
 */
/**
 * GET /api/entities/mis — THE PLATFORM AS ONE PAGE. Root only.
 *
 * Athi, 2026-09-14: *"how do i see it as a MIS?"* · *"what we need here is entity type, vertical and possible
 * information."*
 *
 * ── ⭐ WHY THIS AND NOT THE `metrics` SCHEMA ────────────────────────────────────────────────────────────────
 *
 * b223/b224 built 15 views, and `cb_app` is refused every one of them — deliberately: they are granted to
 * `cb_metrics` and `cb_ops`, which is the wall that lets a BI tool be pointed at the first without ever
 * reaching a tenant list. Granting the API those rights would knock a hole in it for the sake of one screen.
 *
 * ⭐ SO THIS COMPUTES FROM THE TABLES THAT CARRY NO RLS AT ALL — identities and cb_entity. Everything below is
 * an account fact or a structural one; not a single number here comes from a tenant's trade.
 *
 * ── ⚠️⚠️ AND IT SAYS WHAT IT CANNOT SEE ─────────────────────────────────────────────────────────────────────
 *
 * Catalogue size, chit volume and governance stamps live in RLS-forced tables. From this connection they return
 * ZERO ROWS, not an error — which is how I reported three false findings on 2026-09-14 before `sql.cjs` was
 * taught to name them. A report that silently omits what it could not read is the same failure with a nicer
 * font, so `blind` lists them by name. [[feedback-silence-is-the-bug]]
 */
/**
 * ── ⭐⭐ POPULATIONS — a sealed world each, and the operator may add one ────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"yes we need classification, especially the sandbox, so having an option to create
 * multiple would be really good. And we should be able to create through cbincroot?"*
 *
 * Two entities may only transact inside one population (b247/b249), so every row in this registry is a world
 * that cannot leak into another. That makes adding one a governance act rather than a convenience — which is
 * why it is root-only, why the code is a slug the database validates, and why there is no edit and no delete.
 *
 * ⚠️ NO PUT, NO DELETE, AND THAT IS NOT AN OVERSIGHT. A population is stamped on every identity that joins it:
 * renaming its code would orphan them, and deleting it is already refused by the foreign key. The one thing
 * worse than not being able to remove a population is removing one that entities still point at.
 */
/* SEC3: the one platform-staff door lives in lib/platformroot (GET /api/events/stats asks it too); here it is rootGate, above */

/**
 * ── ⭐⭐⭐ WHERE WORK GOES — CONFIGURABLE, NOT A MIGRATION ───────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"it has to be very simple, we should not raise a SQL, it should be configurable"* — and
 * the reason, which decides the placement: *"because we should be able to give this model to anyone who wants
 * to run a simple helpdesk service."*
 *
 * ⭐ SO IT IS NOT AN OPERATOR TOOL. Every entity routes its OWN work: a shop running a helpdesk points its
 * faults at one person and its requests at another, exactly as CBINC does. entity_work_routing was always
 * per-entity and RLS-forced; it just had no door.
 *
 * ⚠️ AND IT ANSWERS THE CHOICES, NOT JUST THE SETTINGS. A dropdown the client has to populate from three other
 * calls is three chances to show a stale list — so the folders, the people and the teams come back with the
 * rows they belong to.
 */

/** ⭐ the kinds a person can route, named for what they ARE rather than for the column they are stored in. */
const ROUTABLE = [
  { kind: 'incident', label: 'Faults', hint: 'Something is broken or not working' },
  { kind: 'spec', label: 'Requests', hint: 'Somebody wants something built or changed' },
  { kind: 'change', label: 'Changes', hint: 'Work done to the product, and how to undo it' },
  { kind: 'release', label: 'Releases', hint: 'What shipped, and what it carried' },
  { kind: 'testcase', label: 'Test cases', hint: 'The suite the product is checked against' }
];

/**
 * GET /api/entities/routing/preview?audience=&to_bridge_id=&kind= — where WOULD this one go?
 *
 * Athi, 2026-09-14: *"can we bring a note, you are raising incident to so and so in the incident box, for some
 * reason if it is not going to work, we know it right away, before raising, still i am not confident."*
 *
 * ⭐ IT IS THE SEND’S OWN RESOLVER, ASKED NOT TO WRITE. lib/raiseticket.preview() and .raise() share
 * resolveDesk(), so the note cannot say one thing and the ticket do another — which is the only version of
 * this feature worth having. A reassuring note that is sometimes wrong is worse than no note.
 *
 * ⚠️ ALWAYS 200. ‘This will not work, and here is why’ is the answer, not an error: a 500 on a preview puts
 * a red box on a form somebody has not filled in yet, and tells them nothing about the thing they asked.
 */
router.get('/routing/preview', auth, async (req, res) => {
  const me = auth.entityOf(req);
  const q = req.query || {};
  try {
    const r = await query('SELECT bridge_id, display_name, population FROM identities WHERE identity_id = $1', [me]);
    const row = r.rows[0] || {};
    const out = await require('../lib/raiseticket').preview(
      { entity_id: me, bridge_id: row.bridge_id, display_name: row.display_name, population: row.population },
      { kind: String(q.kind || 'incident'), audience: q.audience, to_bridge_id: q.to_bridge_id }
    );
    res.json(out);
  } catch (e) {
    res.json({ ok: false, why: safeErr(e) }); /* L2: still 200 ok:false (a preview never red-boxes), but never the raw error text */
  }
});

router.get('/routing', auth, async (req, res) => {
  const me = auth.entityOf(req);
  try {
    const out = await withEntity(me, async (db) => {
      /* ⚠️ every read here is inside withEntity: folder, entity_work_routing and identities-by-parent are all
         tenant-scoped, and a context-free read would answer an empty list that looks exactly like "you have
         nothing set up". [[feedback-silence-is-the-bug]] */
      const rows = await db
        .query(`SELECT kind, folder_id, assignee_actor_id, notify_email FROM entity_work_routing WHERE entity_id = $1`, [me])
        .catch((e) => (e.code === '42P01' ? { rows: [] } : Promise.reject(e)));
      /* route_to_entity_id arrives with b251 — asked for separately so its absence is "no teams yet" and not
         a failed screen. */
      let teamsBy = {};
      try {
        const t = await db.query(`SELECT kind, route_to_entity_id FROM entity_work_routing WHERE entity_id = $1`, [me]);
        for (const r of t.rows) teamsBy[r.kind] = r.route_to_entity_id;
      } catch (e) {
        log.fellBack('entities GET /routing: the read failed — answered with an empty set', e);
        teamsBy = {};
      }

      const folders = await db
        .query(`SELECT folder_id, name FROM folder WHERE entity_id = $1 ORDER BY sort, lower(name)`, [me])
        .catch(log.orElse('entities GET /routing: the read failed — answered with none', { rows: [] }));
      const people = await db
        .query(
          `SELECT identity_id, display_name FROM identities
          WHERE parent_entity_id = $1 AND entity_kind = 'actor' AND coalesce(status,'active') = 'active'
          ORDER BY lower(display_name)`,
          [me]
        )
        .catch(log.orElse('entities GET /routing: the read failed — answered with none', { rows: [] }));
      return { rows: rows.rows, teamsBy, folders: folders.rows, people: people.rows };
    });

    /**
     * ⭐ THE TEAMS — branches of this entity's own network, which is the only place work may be routed to
     * (b251). Read outside the tenant context because cb_entity is not RLS-scoped the same way, and because
     * the question is about the TREE rather than about rows this entity owns.
     */
    let teams = [];
    try {
      const t = await query(
        `SELECT i.identity_id, i.display_name, c.path::text AS path
           FROM identities i
           JOIN cb_entity c ON c.bridge_id = i.bridge_id
          WHERE c.root_path = (SELECT c2.root_path FROM identities i2
                                 JOIN cb_entity c2 ON c2.bridge_id = i2.bridge_id
                                WHERE i2.identity_id = $1)
            AND i.identity_id <> $1
            AND coalesce(i.status,'active') <> 'erased'
          ORDER BY c.path`,
        [me]
      );
      teams = t.rows;
    } catch (e) {
      log.fellBack('entities GET /routing: the read failed — answered with none', e);
      teams = [];
    } /* no b243/root_path, or not in a network — then there are no teams */

    const by = {};
    for (const r of out.rows) by[r.kind] = r;
    res.json({
      kinds: ROUTABLE.map((item) =>
        Object.assign({ kind: item.kind, label: item.label, hint: item.hint }, {
          folder_id: (by[item.kind] || {}).folder_id || null,
          assignee_actor_id: (by[item.kind] || {}).assignee_actor_id || null,
          route_to_entity_id: out.teamsBy[item.kind] || null
        })
      ),
      folders: out.folders,
      people: out.people,
      teams
    });
  } catch (e) {
    console.error('routing read:', e.code || '', e.message);
    problem(req, res, failed(e, req, 'Could not read where work goes'));
  }
});

/**
 * saveRouting(shop, kind, { folder, assignee, team }) → null when the row is written, else the name of the contract word that refuses it, because the folder or person named is not this shop's and nothing is written (SEC-100, SEC-103).
 * The foreign key on folder_id is checked WITHOUT row security and assignee_actor_id has none, so both are looked up under THIS shop in the same transaction; a null still clears it.
 */
async function saveRouting(shop, kind, fields) {
  return withEntity(shop, async (db) => {
    if (fields.folder && !(await folderViews.folderOwned(db, shop, fields.folder))) return 'routingFolderNone';
    if (fields.assignee && !(await shopActors.actorOwned(db, shop, fields.assignee))) return 'routingPersonNone';
    await db.query(
      `INSERT INTO entity_work_routing (entity_id, kind, folder_id, assignee_actor_id, route_to_entity_id, updated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (entity_id, kind) DO UPDATE
         SET folder_id = EXCLUDED.folder_id, assignee_actor_id = EXCLUDED.assignee_actor_id,
             route_to_entity_id = EXCLUDED.route_to_entity_id, updated_at = now()`,
      [shop, kind, fields.folder, fields.assignee, fields.team]
    );
    return null;
  });
}

/* ⚠️ the resolver memoises for 60s; without this a change looks like it did not save for a minute, which
   is exactly long enough for somebody to set it twice. */
function forgetRouting(shop) {
  try {
    require('../lib/workroute').invalidate(shop);
  } catch (e) {
    log.fellBack('entities nul: the helper failed — carried on without it', e);
  }
}

router.put('/routing', auth, ...checked('PUT /routing'), async (req, res) => {
  const me = auth.entityOf(req);
  const b = req.body || {};
  const kind = String(b.kind || '').trim();
  if (!ROUTABLE.some((item) => item.kind === kind)) {
    return problem(req, res, { status: 400, ...contract.words.routingBadKind() });
  }
  /* ⚠️ '' means "clear it", and it must be distinguishable from "leave it alone" — so the client always sends
     all three and null is an answer rather than an omission. */
  const nul = (v) => (v === '' || v === undefined || v === null ? null : String(v));
  try {
    const refused = await saveRouting(me, kind, { folder: nul(b.folder_id), assignee: nul(b.assignee_actor_id), team: nul(b.route_to_entity_id) });
    /* an unknown folder and another shop's folder are one answer; an unknown person and another shop's person are one answer */
    if (refused) return problem(req, res, { status: 404, ...contract.words[refused]() });
    forgetRouting(me);
    res.json({ ok: true, kind });
  } catch (e) {
    if (e.code === '42P01') return problem(req, res, { status: 409, ...contract.words.routingNotThere() });
    /* ⚠️ b251 refuses a team outside your own network, and that refusal is a sentence, not a stack trace. */
    if (isTriggerRefusal(e)) return problem(req, res, { status: 409, ...contract.words.teamOutsideNetwork(e) });
    if (e.code === '23503') return problem(req, res, { status: 409, ...contract.words.folderGone() });
    console.error('routing write:', e.code || '', e.message);
    problem(req, res, failed(e, req, 'Could not save it'));
  }
});

router.get('/populations', auth, rootGate, async (req, res) => {
  try {
    /* ⭐ the DESK comes back with the row (b252). A screen that has to fetch it separately is a screen where
       the two can disagree, and this one is the only place it can be set. */
    const r = await query(
      `SELECT p.code, p.label, p.is_live, p.note, p.desk_entity_id,
              d.display_name AS desk_name, d.bridge_id AS desk_bridge_id,
              count(i.identity_id) FILTER (WHERE i.identity_type = 'entity') ::int AS entities
         FROM ops.population p
         LEFT JOIN identities d ON d.identity_id = p.desk_entity_id
         LEFT JOIN identities i ON i.population = p.code AND coalesce(i.status,'active') <> 'erased'
        GROUP BY 1,2,3,4,5,6,7 ORDER BY p.is_live DESC, p.code`
    )
      /* ⚠️ b252 not run is an ANSWER too — the screen shows the populations and simply cannot set a desk. */
      .catch((e) =>
        e.code === '42703'
          ? query(`SELECT p.code, p.label, p.is_live, p.note,
                        NULL::uuid AS desk_entity_id, NULL::text AS desk_name, NULL::text AS desk_bridge_id,
                        count(i.identity_id) FILTER (WHERE i.identity_type = 'entity') ::int AS entities
                   FROM ops.population p
                   LEFT JOIN identities i ON i.population = p.code AND coalesce(i.status,'active') <> 'erased'
                  GROUP BY 1,2,3,4 ORDER BY p.is_live DESC, p.code`)
          : Promise.reject(e)
      );

    /* the entities that COULD answer a population's support: a business, active, already in that population.
       ⚠️ the b252 trigger refuses anything else, so offering it would be a control that only ever fails. */
    const cand = await query(
      `SELECT identity_id, display_name, bridge_id, coalesce(population, 'live') AS population
         FROM identities
        WHERE identity_type = 'entity' AND coalesce(status,'active') = 'active'
          AND coalesce(population, 'live') IN (SELECT code FROM ops.population)
        ORDER BY lower(display_name)`
    ).catch(log.orElse('entities GET /populations: the read failed — answered with none', { rows: [] }));

    res.json({ populations: r.rows, desk_candidates: cand.rows });
  } catch (e) {
    /* ⚠️ b249 not run yet is an ANSWER, not a fault: the screen falls back to the two it knows. */
    if (['42P01', '3F000', '42501'].includes(e.code)) return res.json({ populations: [], why: e.code });
    console.error('populations list:', e.code || '', e.message);
    problem(req, res, contract.failedBare(e, req, 'Failed to list populations'));
  }
});

/**
 * PUT /populations/:code/desk — who answers support raised by this population.
 *
 * Athi, 2026-09-14: *"we should not write sql for all those."* b252 added the column and the review found that
 * NOTHING could write it — no route, no screen — so the migration's own instructions (*"Platform › Populations
 * → Test → Answers support → CBINCTST"*) pointed at a control that did not exist, and every test finding kept
 * landing on the live desk. A column only hand-written SQL can set is the thing that migration removes.
 *
 * ⚠️ ROOT ONLY. Which desk answers a whole population is the operator's decision, not a tenant's.
 * ⚠️ AND '' CLEARS IT, deliberately: an operator must be able to take a desk back out without a deploy.
 */
router.put('/populations/:code/desk', auth, rootGate, ...checked('PUT /populations/:code/desk'), async (req, res) => {
  const code = String(req.params.code || '')
    .trim()
    .toLowerCase();
  const v = (req.body || {}).desk_entity_id;
  const desk = v === '' || v === undefined || v === null ? null : String(v);
  try {
    const u = await query('UPDATE ops.population SET desk_entity_id = $2 WHERE code = $1', [code, desk]);
    /* ⚠️ an UPDATE matching nothing is not an error. Without this, setting a desk on a population that does
       not exist answers ok and changes nothing. [[feedback-silence-is-the-bug]] */
    if (!u.rowCount) return problem(req, res, { status: 404, ...contract.words.noSuchPopulation(code) });
    /* ⚠️ the resolver memoises for 60s; without this the change looks like it did not save for a minute,
       which is long enough for somebody to set it twice. */
    try {
      require('../lib/platformroot').invalidateDesks();
    } catch (e) {
      log.fellBack('entities PUT /populations/:code/desk: the helper failed — carried on without it', e);
    }
    res.json({ ok: true, code, desk_entity_id: desk });
  } catch (e) {
    if (e.code === '42703' || e.code === '42P01') return problem(req, res, { status: 409, ...contract.words.deskColumnMissing() });
    /* ⚠️ b252's trigger refuses a desk outside the population it serves, or one that is not a business. That
       refusal is a sentence somebody can act on, not a stack trace. */
    if (isTriggerRefusal(e)) return problem(req, res, { status: 409, ...contract.words.notADesk(e) });
    console.error('population desk:', e.code || '', e.message);
    problem(req, res, failed(e, req, 'Could not set the desk'));
  }
});

router.post('/populations', auth, rootGate, ...checked('POST /populations'), async (req, res) => {
  const code = String((req.body || {}).code || '')
    .trim()
    .toLowerCase();
  const label = String((req.body || {}).label || '').trim();
  const note = String((req.body || {}).note || '').trim();
  /* ⚠️ the same shape the database enforces, checked here too so the answer is a sentence rather than a
     constraint name. The database remains the authority — this is the courtesy, not the rule. */
  if (!/^[a-z][a-z0-9_]{1,23}$/.test(code)) {
    return problem(req, res, { status: 400, ...contract.words.populationCodeUnusable() });
  }
  if (!label) return problem(req, res, { status: 400, ...contract.words.populationNeedsName() });
  if (!note) return problem(req, res, { status: 400, ...contract.words.populationNeedsNote() });
  try {
    /* ⚠️ is_live is never accepted from the request. The unique index permits one live world and would refuse
       it anyway, but a route that forwards the field is a route somebody will one day trust. */
    await query('INSERT INTO ops.population (code, label, note) VALUES ($1, $2, $3)', [code, label, note]);
    res.status(201).json({ ok: true, code, label });
  } catch (e) {
    if (e.code === '23505') return problem(req, res, { status: 409, ...contract.words.populationExists(code) });
    if (['42P01', '3F000', '42501'].includes(e.code)) return problem(req, res, { status: 409, ...contract.words.populationRegistryMissing() });
    console.error('population create:', e.code || '', e.message);
    problem(req, res, failed(e, req, 'Failed to add the population'));
  }
});

router.get('/mis', auth, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const platformroot = require('../lib/platformroot');

    /* ⚠️ ROOT ONLY. This is a cross-tenant view — every other entity gets a flat refusal, not an empty report,
       because an empty report reads as "there is nothing" rather than "this is not yours". */
    if (!platformroot.configured()) {
      return problem(req, res, { status: 404, ...contract.words.misNoRoot() });
    }
    if (!platformroot.isRoot(me)) {
      return problem(req, res, { status: 403, ...contract.words.misNotRoot() });
    }

    /* ⭐ asked ONCE, before anything that needs it. Both the class ladder and the population predicate below
       branch on the same answer, so they can never describe two different platforms. */
    const hasIsTest = await require('../lib/istest').ready();
    /**
     * ⭐ THE POPULATION IS WHATEVER THE REGISTRY SAYS IT IS. It was `'test' : 'real'` — two values decided in
     * this file — which is the same hard-coding b249 exists to remove. The list comes from ops.population, and
     * an unknown value falls back to the live one rather than returning nothing.
     * ⚠️ 'real' is still accepted: it is what the screen sent before b249 named the live population 'live'.
     */
    const popRows = (
      await query('SELECT code, is_live FROM ops.population').catch(log.orElse('entities GET /mis: the read failed — answered with none', { rows: [] }))
    ).rows;
    const liveCode = (popRows.find((item) => item.is_live) || {}).code || 'live';
    const asked = String(req.query.population || '')
      .trim()
      .toLowerCase();
    const pop = asked === '' || asked === 'real' ? liveCode : popRows.some((item) => item.code === asked) ? asked : liveCode;

    /**
     * ⚠️⚠️ INTERPOLATED, NOT BOUND — and that needs saying out loud. `LIVE` is a SQL FRAGMENT spliced into a
     * dozen aggregate queries, and a fragment cannot carry a bind parameter; that is the same reason ORDER BY
     * needs its whitelist. The value here is safe for a stronger reason than escaping: it is either a code
     * that came OUT of ops.population or the literal fallback, so nothing from the request text ever reaches
     * the SQL. The quoting below is the second lock, not the first.
     */
    const escLit = (v) => {
      const t = String(v);
      if (!/^[a-z][a-z0-9_]{1,23}$/.test(t)) throw new Error('bad population code');
      return "'" + t + "'";
    };

    /**
     * ── ⚠️⚠️ THE HEADLINE SAID 2,252 CUSTOMERS WHEN THERE WERE NINE ─────────────────────────────────────────
     *
     * b246 moved 2,243 fixtures out of `entity_kind='test'` and into `customer` + is_test, which was right —
     * they self-registered, so they were customers that were tests. But every aggregate on this screen counted
     * with `LIVE` alone, which knows nothing about populations. So the moment the migration ran, the biggest
     * number on the Platform screen became a lie, and the "test fixtures" tile beside it went to zero because
     * the kind it counted no longer had any rows.
     *
     * ⭐ SO THE POPULATION GOES INTO `LIVE` ITSELF, not beside it. Every aggregate already uses LIVE, and a
     * new one will too — putting it here means the next count somebody adds is population-aware without
     * anybody remembering. A predicate you have to remember to add is one that will be forgotten.
     * [[feedback-silence-is-the-bug]]
     */
    const hasPopulation = popRows.length > 0;
    const POP = hasPopulation
      ? `AND population = ${escLit(pop)}`
      : hasIsTest
        ? pop === 'test'
          ? 'AND is_test'
          : 'AND NOT is_test'
        : pop === 'test'
          ? "AND entity_kind = 'test'"
          : "AND entity_kind <> 'test'";
    const LIVE = "coalesce(status,'active') <> 'erased' " + POP;

    /* ⭐ and the size of the population you are NOT looking at, so the third tile can say something true. */
    const otherPop = Number(
      (
        await query(
          `SELECT count(*)::int AS n FROM identities
        WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased' ` +
            (hasPopulation
              ? `AND population <> ${escLit(pop)}`
              : hasIsTest
                ? pop === 'test'
                  ? 'AND NOT is_test'
                  : 'AND is_test'
                : pop === 'test'
                  ? "AND entity_kind <> 'test'"
                  : "AND entity_kind = 'test'")
        )
      ).rows[0].n
    );

    /**
     * ── ⭐⭐ ONE CLASS PER ENTITY — exhaustive, and no row in two boxes ───────────────────────────────────────
     *
     * Athi, 2026-09-14: *"root network will provide either service or goods, so the root entity should be part
     * of the other claim. goods, service, both — they will be the paying entity … the 10 network shops to be
     * grouped under the previous group based on what they choose … the internal shops are another 10 … so the
     * remaining 50 to showcase as network shops."*
     *
     * ⚠️ MY FIRST VERSION DOUBLE-COUNTED: it offered "Network entities" beside Goods and Services as if they
     * were alternatives. A network ROOT is a business — it sells something and it pays — so it belongs in
     * goods/services/both like any other shop. Picking "Network" silently discarded what the shop sold.
     *
     * ⚠️⚠️ AND THE SECOND VERSION BURIED EVERY REAL SHOP. Athi ticked Public + Goods, expected Tally Test Shop
     * and alpha timers, and got a hundred e2e fixtures: 2,241 of the 2,259 "goods" were test rows. They were
     * not missing — they were row 1,400 of a list that stops at 100. A category that is 99% noise is not a
     * category, and "narrow the filters to see the rest" is not an answer when there is no filter that would.
     *
     * ⭐ SO 'test' IS A RUNG, for the same reason 'internal' and 'network' are: IT IS NOT A PAYING ENTITY.
     * The ladder separates everything that cannot be billed before it asks what anything sells, which means
     * "Goods" finally means what an operator reads it to mean — real shops that sell things.
     *
     * ⚠️ ORDER IS THE DEFINITION. A fixture that is also a branch must read as a fixture, or the network count
     * inherits the noise instead. Most-disqualifying first:
     *
     *   internal  ours — cbincroot, the standards. Never a counterparty, never billed.
     *   test      a fixture. Not a business at all; it exists because a test made it.
     *   network   a BRANCH. It trades, but its plan belongs to its root, so it is not a paying entity.
     *   goods · services · both   everyone who PAYS: standalone shops and network roots together.
     *   unset     nobody has asked them yet. ⚠️ Its own rung, never folded into a real answer.
     */
    const CLASS_SQL = `CASE
        WHEN coalesce(i.entity_visibility,'public') = 'internal'        THEN 'internal'
        WHEN ${hasIsTest ? 'i.is_test' : "i.entity_kind = 'test'"}                        THEN 'test'
        WHEN c.bridge_id IS NOT NULL AND nlevel(c.path) > 1             THEN 'network'
        WHEN i.supplies IN ('goods','services','both')                  THEN i.supplies
        ELSE 'unset' END`;
    const [kinds, verticals, sup, evis, vis, plans, tree, classes, joins] = await Promise.all([
      query(`SELECT entity_kind AS k, count(*)::int AS n,
                    count(*) FILTER (WHERE user_id IS NOT NULL)::int AS with_handle,
                    count(*) FILTER (WHERE last_active_at > now()::timestamp - interval '30 days')::int AS active_30d
               FROM identities WHERE ${LIVE} GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT vertical AS v, count(*)::int AS n FROM identities
              WHERE ${LIVE} AND identity_type = 'entity' GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT supplies AS v, count(*)::int AS n FROM identities
              WHERE ${LIVE} AND identity_type = 'entity' GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT coalesce(entity_visibility,'(unset)') AS v, count(*)::int AS n FROM identities
              WHERE ${LIVE} AND identity_type = 'entity' GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT coalesce(catalogue_visibility,'(unset)') AS v, count(*)::int AS n FROM identities
              WHERE ${LIVE} AND identity_type = 'entity' GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT plan AS p, count(*)::int AS n FROM identities
              WHERE ${LIVE} AND identity_type = 'entity' GROUP BY 1 ORDER BY 2 DESC`),
      /* rooting, from cb_entity's ltree — 1 = a root, >1 = a branch, absent = standalone */
      query(`SELECT CASE WHEN c.bridge_id IS NULL THEN 'standalone'
                         WHEN nlevel(c.path) = 1 THEN 'root'
                         ELSE 'branch d' || nlevel(c.path) END AS pos,
                    count(*)::int AS n
               FROM identities i LEFT JOIN cb_entity c ON c.bridge_id = i.bridge_id
              WHERE i.identity_type = 'entity' AND ${LIVE.replace(/status/g, 'i.status')}
              GROUP BY 1 ORDER BY 1`),
      /* ⭐ THE SAME LADDER, COUNTED. If these do not sum to the entity total the taxonomy is broken, and that
         is a thing we should be able to see rather than trust. */
      /* ⭐ THE SAME LADDER, not a second copy of it. The breakdown and the filter must agree by construction:
         two CASEs that look alike is how a screen comes to say 2,259 and return something else. */
      query(`SELECT ${CLASS_SQL} AS v, count(*)::int AS n
               FROM identities i LEFT JOIN cb_entity c ON c.bridge_id = i.bridge_id
              WHERE i.identity_type = 'entity' AND coalesce(i.status,'active') <> 'erased'
              GROUP BY 1 ORDER BY 2 DESC`),
      query(`SELECT date_trunc('month', created_at)::date AS month, count(*)::int AS n
               FROM identities WHERE ${LIVE} AND entity_kind = 'customer'
              GROUP BY 1 ORDER BY 1 DESC LIMIT 12`)
    ]);

    /* ⭐ THE ROWS THE LEFT PANEL DRAWS — newest first, because "who just joined" is the question a list is
       opened to answer. Every column here is an account fact; none is about their trade. */
    /**
     * ── ⚠️⚠️ SORT IS A WHITELIST, AND IT HAS TO BE ─────────────────────────────────────────────────────────
     *
     * `ORDER BY` cannot take a bind parameter, so a sort field from the query string can only reach SQL by
     * being interpolated — which is a SQL injection hole shaped exactly like a convenience. The map below is
     * the only way a column name gets in: an unknown key falls back to `joined`, it is never passed through.
     *
     * ⭐ And the map doubles as the answer to "what can this list be sorted by?" — the client reads `sortable`
     * out of the response rather than hard-coding a list that drifts from the server's.
     */
    /**
     * ── ⭐⭐ STANDING IS A COLUMN, WHICH MEANS IT IS PART OF THE QUERY ──────────────────────────────────────
     *
     * Athi: *"now bring b224 standing as a column"*. Everything the ladder needs is already on the client —
     * quiet days from the row, chits and items from b241 — so computing it in the browser would have worked.
     *
     * ⚠️ AND WOULD HAVE BEEN WRONG. The list caps at 100 rows. Sorted or filtered in the browser, "show me
     * everyone who registered and never used it" searches one page of 2,509 and answers confidently from 4%
     * of the data. To ORDER BY it, the database has to know it.
     *
     * ⚠️ AND IF b242 IS NOT RUN YET, ASKING FOR IT WOULD 500 THE WHOLE SCREEN. to_regprocedure() returns null
     * rather than raising, so this is the one safe way to ask. Every fragment below is a constant in this
     * file — nothing from the request reaches the SQL text.
     *
     * ⚠️ TWO PREDICATES, TWO NUMBERS. The rows query binds standing as $10 and `matched` as $9, because they
     * carry different parameter lists. One shared constant here would have been wrong in one of them.
     */
    /**
     * ── ⭐⭐ ONE CLASS PER ENTITY — exhaustive, and no row in two boxes ───────────────────────────────────────
     *
     * Athi, 2026-09-14, correcting the dropdown I built:
     *
     *   *"root network will provide either service or goods, so the root entity should be part of the other
     *    claim. goods, service, both — they will be the paying entity. assume we have 100 shops: 10 goods, 10
     *    services, 10 both, and another 10 network — they will be either goods or service, so the 10 network
     *    shops to be grouped under the previous group based on what they choose … the internal shops are
     *    another 10 … so the remaining 50 to showcase as network shops, and the root to be shown with the
     *    owner of the network."*
     *
     * ⚠️ MY VERSION WAS WRONG AND WOULD HAVE DOUBLE-COUNTED. I put "Network entities" beside Goods/Services as
     * if they were alternatives. They are not: a network ROOT is a business — it sells something and it pays,
     * so it belongs in goods/services/both like any other shop. Picking "Network entities" silently discarded
     * whatever the shop sold, and the categories could never sum to the total.
     *
     * ⭐ THE TEST OF A TAXONOMY IS THAT THE COUNTS ADD UP. This one does, because the ladder is ordered and
     * every entity falls off exactly one rung:
     *
     *   internal   ours — cbincroot and the standards. Never a counterparty, never billed.
     *   network    a BRANCH (depth > 1). Athi's 50: they trade, but their plan belongs to their root, so they
     *              are not a paying entity and must not be counted beside one.
     *   goods · services · both   everyone who pays: standalone shops AND network roots together.
     *   unset      nobody has asked them yet. ⚠️ Its own rung, never folded into a real answer.
     *
     * ⚠️ ORDER IS THE DEFINITION. internal before network before supplies — an internal entity that happened
     * to be a branch must read as internal, or 'internal' stops meaning "not on the market".
     */
    /**
     * ── ⭐⭐⭐ THE MASTER SWITCH: TEST ENTITIES ARE OFF UNLESS ASKED FOR ─────────────────────────────────────
     *
     * Athi, 2026-09-14: *"if we have a check item on the top to say ignore test entity, or show all test
     * entities, that would be helpful. so we wanted to work with only the real entities, not the test
     * entities, so we should know to omit as a whole, irrespective of what they are doing. this will help us
     * to eliminate every issue we are facing now."*
     *
     * ⚠️ HE IS DESCRIBING EVERY BUG OF THE LAST HOUR AT ONCE. 2,243 of 2,509 rows are e2e fixtures. They buried
     * Tally Test Shop at row 1,400 under Goods; they made "2,498 sell goods" the headline fact about the
     * platform; they are why a hundred-row page showed nothing anybody recognised. Filtering them one axis at
     * a time never worked because they are not a KIND of shop — they are not shops.
     *
     * ⭐ SO IT IS A SWITCH, NOT A FILTER, AND IT DEFAULTS TO OFF. The screen opens on real entities. Everything
     * downstream — counts, breakdowns, pages — is then about the business rather than about the test suite.
     *
     * ⚠️ DEFAULTING TO OFF CHANGES WHAT THIS ENDPOINT RETURNS TO AN UNCHANGED CALLER. That is the point and it
     * is deliberate: the old default was answering a question nobody asked. The switch is one parameter away
     * for anyone who wants the fixtures back.
     */
    /**
     * ⚠️⚠️ IT WAS A CHECKBOX AND THAT WAS STILL WRONG. Ticked, it ADDED the 2,243 fixtures to the 266 real
     * entities and showed both in one list. Athi, 2026-09-14:
     *
     *   *"we have to see only test entity or only real entity, not both together, that will confuse. so a
     *    toggle button would help I guess, so we can totally omit either production or test. never been
     *    together."*
     *
     * ⭐ He is right, and it is the same mistake in a smaller form: a mixed list makes every number on the
     * screen ambiguous. "28 pay their own bill" — of what population? Two answers in one column is what the
     * class dropdown did, and what the fixtures did to the Goods filter.
     *
     * ⭐ SO IT IS A POPULATION, NOT A FLAG. Exactly one is in force, always, and the default is the real one.
     */
    /* ⚠️ b246 may not have run yet — deploys are automatic, migrations are by hand, so the code is routinely
       ahead of the database. lib/istest.js probes once and falls back to the old partition, which keeps this
       screen meaning exactly the same thing in both states. */
    /* ⭐ the row list and the aggregates use the SAME predicate. They used to be built separately, which is
       how a screen comes to report one population and count another. */
    const TEST_WHERE = hasPopulation ? `AND i.population = ${escLit(pop)}` : require('../lib/istest').where(pop === liveCode ? 'real' : 'test', hasIsTest);

    /**
     * ⭐ OWNERSHIP — ours, or the market's. Athi's first-level filter: *"All / internal / External."*
     * ⚠️ It reads entity_visibility, not entity_kind: 'internal' is a decision about who may REACH a row, and
     * kind has an 'internal' value that does not always agree with it. One source per question.
     */
    const own = String(req.query.ownership || '').trim();
    const OWN_WHERE =
      own === 'internal'
        ? "AND coalesce(i.entity_visibility,'public') = 'internal'"
        : own === 'external'
          ? "AND coalesce(i.entity_visibility,'public') <> 'internal'"
          : '';

    const hasStanding = (await query("SELECT to_regprocedure('ops.f_entity_standing()') IS NOT NULL AS ok")).rows[0].ok === true;
    const ST_JOIN = hasStanding ? 'LEFT JOIN ops.f_entity_standing() st ON st.entity_id = i.identity_id' : '';
    const ST_COL = hasStanding ? 'st.standing' : 'NULL::text';
    /* ⚠️ the placeholder is spent either way so the parameter list keeps its shape. Without b242 the filter
       cannot narrow anything, so it is a no-op — never a predicate that quietly matches nothing. */
    const stWhere = (n) => (hasStanding ? `AND ($${n} = '' OR st.standing LIKE $${n} || '%')` : `AND ($${n} IS NOT NULL)`);

    const SORTS = {
      joined: 'i.created_at',
      last_seen: 'i.last_active_at',
      name: 'lower(i.display_name)',
      handle: 'lower(i.user_id)',
      kind: 'i.entity_kind',
      vertical: 'i.vertical',
      plan: 'i.plan',
      seats: 'seats',
      suppliers: 'suppliers',
      branches: 'branches',
      /* ⭐ the ladder's 'a · ', 'b · ' prefixes exist so a plain ORDER BY reads worst-first. */
      ...(hasStanding ? { standing: 'st.standing' } : {})
    };
    const sortKey = Object.prototype.hasOwnProperty.call(SORTS, String(req.query.sort || '')) ? String(req.query.sort) : 'joined';
    const dir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    /* ⚠️ SEARCH IS A BIND PARAMETER, unlike the sort. It matches the three things a person actually types:
       the shop's name, its handle, or its bridge id. NOT email — that is how you build an address harvester. */
    const q = String(req.query.q || '').trim();

    /**
     * ⚠️⚠️ THE SUPPLIER COUNT READS THROUGH THE COUNTING SURFACE (b241), NOT supplier_list (2026-09-28, H2).
     * supplier_list is getting FORCE ROW LEVEL SECURITY. This route deliberately sets no app.current_entity
     * (it reads across shops), so the inline count would turn into 0 for every shop the moment RLS lands — and
     * SORTS.suppliers orders the page IN SQL, before LIMIT, so a JS override afterwards cannot rescue the order.
     * ops.f_entity_counts() is SECURITY DEFINER and returns counts only; 'suppliers' is already in ops.countable.
     * ⭐ If the function is missing or refused (42883 · 3F000 · 42501) the list runs once more with the old
     * inline count — right until RLS is forced, and never a blank screen. The counts block below reports why.
     */
    let _supFn = true;
    const SUP_JOIN = `LEFT JOIN (SELECT entity_id, n::int AS n FROM ops.f_entity_counts() WHERE metric = 'suppliers') supc
                        ON supc.entity_id = i.identity_id`;
    const _list = () =>
      query(
        /**
         * ── ⭐ EVERY WAY THIS SHOP CAN BE ADDRESSED, IN ONE ROW ─────────────────────────────────────────────
         *
         * Athi, 2026-09-14: *"we need to have uuid, bridge id, user id, username all in our list."*
         *
         *   identity_id   the uuid — the only one the database joins on
         *   bridge_id     CB………  — what a counterparty is given
         *   user_id       the handle — what staff sign in under, and what suppliers are numbered beneath
         *   display_name  what a human calls them; the ONLY one of the four that can change
         * ⚠️⚠️ THERE IS NO SEPARATE "username", AND I CHECKED BEFORE SAYING SO. `identities` has no such column.
         * `cb_entity` has `username` and `company_name` — and both are NULL for ALL 340 ROWS. Nothing has ever
         * written them; they are legacy columns carried by that table's original shape.
         *
         * ⭐ So `user_id` IS the username: it is what staff sign in under (`athi@alpha-timers`) and what
         * suppliers are numbered beneath (`~alpha-timers.sup-0001`). Selecting the two empty columns would have
         * added two permanently blank fields to every row and made the list look like it was missing data it
         * never had. Reporting four identifiers that all exist beats five where one is always null.
         *
         * ⚠️ EMAIL IS SHOWN HERE AND IS DELIBERATELY NOT SEARCHABLE. Showing an operator their own customer's
         * address is an account fact — it is how you contact a customer. Letting anything MATCH on a fragment of
         * it turns the same endpoint into an address harvester. Different question, different answer; the route
         * is root-only either way.
         */
        `SELECT i.identity_id, i.display_name, i.user_id, i.bridge_id,
              i.email,
              i.entity_kind, i.vertical, i.plan,
              /* ⭐ THE SECOND, ORTHOGONAL CLASSIFICATION. Athi, 2026-09-14: *'we have already 3
                 classification for an entity, private, network and public'* — catalogue_visibility.
                 entity_kind says WHAT a row is; this says WHO CAN SEE its catalogue, and the two do not
                 line up: customers are 6 public / 2 private / 1 network, network nodes split all three.
                 ⭐ And the 10 internal rows — the ISO/ICC standards — are ALREADY all private, which is
                 most of what 'internal, cannot be used' was asking for. */
              i.catalogue_visibility AS visibility,
              /* ⭐ THE OTHER ONE (b234). catalogue_visibility = may you see my PRODUCTS; this = may you
                 FIND me and name me as a counterparty. They are not the same question and the data does
                 not line them up — cbincroot is catalogue-private and, until b234, fully findable. */
              i.entity_visibility    AS entity_visibility,
              /* ⭐ what this business DEALS IN (b237) — goods · service · both. Not a visibility, and not
                 the tax field: HSN/SAC stays per ITEM because an invoice needs the right tax per line. */
              i.supplies             AS supplies,
              ${CLASS_SQL} AS class,
              /* ⭐ 'the root to be shown with the owner of the network'. cb_entity carries the name, so the
                 root of a branch is one self-join away — subpath(path,0,1) is its first ltree label. */
              root.name      AS network_root,
              root.bridge_id AS network_root_bridge,
              ${ST_COL} AS standing,
              i.created_at::date  AS joined,
              i.last_active_at::date AS last_seen,
              CASE WHEN i.last_active_at IS NULL THEN NULL
                   ELSE extract(day FROM now()::timestamp - i.last_active_at)::int END AS quiet_days,
              (SELECT count(*)::int FROM identities a
                WHERE a.parent_entity_id = i.identity_id AND a.entity_kind = 'actor'
                  AND coalesce(a.status,'active') <> 'erased')                    AS seats,
              ${_supFn ? 'COALESCE(supc.n, 0)' : '(SELECT count(*)::int FROM supplier_list s WHERE s.owner_entity_id = i.identity_id)'} AS suppliers,
              c.path::text AS path,
              CASE WHEN c.bridge_id IS NULL THEN 0 ELSE nlevel(c.path) END        AS depth,
              (SELECT count(*)::int FROM cb_entity k
                WHERE c.path IS NOT NULL AND k.path <@ c.path AND k.path <> c.path) AS branches
         FROM identities i
         LEFT JOIN cb_entity c ON c.bridge_id = i.bridge_id
         LEFT JOIN cb_entity root ON nlevel(c.path) > 1 AND root.path = subpath(c.path, 0, 1)
         ${ST_JOIN}
         ${_supFn ? SUP_JOIN : ''}
        WHERE i.identity_type = 'entity' AND coalesce(i.status,'active') <> 'erased'
          ${stWhere(10)}
          ${TEST_WHERE}
          ${OWN_WHERE}
          AND ($1::text[] IS NULL OR i.entity_kind = ANY($1))
          AND ($6 = '' OR (CASE WHEN $6 = 'billable'
                                THEN (c.bridge_id IS NULL OR nlevel(c.path) = 1)
                                /* ⭐ Athi, 2026-09-14: *"show all the network shops and its branches: network
                                   not eq to None"*. Root OR branch — the whole of a network, head included.
                                   Every other option here narrows to one level; this one is the network. */
                                WHEN $6 = 'networked'
                                THEN (c.bridge_id IS NOT NULL)
                                ELSE $6 = CASE WHEN c.bridge_id IS NULL THEN 'standalone'
                                               WHEN nlevel(c.path) = 1 THEN 'root'
                                               ELSE 'branch' END END))
          AND ($3 = '' OR i.display_name ILIKE '%' || $3 || '%'
                       OR i.user_id     ILIKE '%' || $3 || '%'
                       OR i.bridge_id   ILIKE '%' || $3 || '%')
          AND ($4 = '' OR i.vertical = $4)
          AND ($5 = '' OR i.plan     = $5)
          AND ($7 = '' OR i.catalogue_visibility = $7)
          AND ($8 = '' OR i.entity_visibility = $8)
          AND ($9 = '' OR i.supplies = $9)
        ORDER BY ${SORTS[sortKey]} ${dir} NULLS LAST, i.identity_id
        /* OFFSET, so the list can be scrolled instead of truncated. Athi: it has to be lazy loaded.
           matched already told the screen how many there were; without an offset that was a number it
           could report and never reach.
           WARNING: ORDER BY must be a total order or paging silently repeats and drops rows between
           pages. It is a whitelisted column plus NULLS LAST, and identity_id breaks any remaining tie. */
        LIMIT $2 OFFSET $11`,
        /* ⚠️ '*' MEANS EVERY KIND. Athi, 2026-09-14, after spotting Beta Fresh and Gamma Exports in the data
         but not on the screen: vertical and plan both offered 'any' and kind did not, so there was no way
         to look across the whole platform at once — the one thing an operator report is for. NULL rather
         than a list of every kind, so a kind invented tomorrow is included without touching this. */
        [
          String(req.query.kind || '*').trim() === '*'
            ? null
            : String(req.query.kind)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
          Math.min(Number(req.query.limit) || 100, 500),
          q,
          String(req.query.vertical || '').trim(),
          String(req.query.plan || '').trim(),
          String(req.query.position || '').trim(),
          String(req.query.visibility || '').trim(),
          String(req.query.entity_visibility || '').trim(),
          String(req.query.supplies || '').trim(),
          String(req.query.standing || '').trim(),
          Math.max(0, Number(req.query.offset) || 0)
        ]
      );
    let rows;
    try {
      rows = (await _list()).rows;
    } catch (e) {
      if (!(e && ['42883', '3F000', '42501'].indexOf(e.code) >= 0)) throw e;
      _supFn = false;
      rows = (await _list()).rows;
    }

    /**
     * ── ⭐⭐ THE COUNTING SURFACE — counts from any table, rows from none (b241) ──────────────────────────────
     *
     * Athi, 2026-09-14: *"from any table we should be able to take the count, not the details — data cannot be
     * read, but the metrics should be. if we can't read the metrics, then how to support the platform?"*
     *
     * ⚠️ WHY NOT A SUBQUERY BESIDE `suppliers` ABOVE. `supplier_list` has no RLS, so that one works. The same
     * line against customer_list, catalogue_items or chit_header reads ZERO and does not complain: all three are
     * FORCE ROW LEVEL SECURITY, cb_app is NOBYPASSRLS, and this route deliberately sets no app.current_entity
     * because it reads across shops. `ops.f_entity_counts()` is SECURITY DEFINER and returns counts only.
     *
     * ⭐ ASKED FOR THIS PAGE'S IDS, not the platform. The function aggregates everything either way, but sending
     * 2,500 entities × 5 metrics back to Node to throw away 96% of it is waste with no upside.
     *
     * ⚠️⚠️ AND IF b241 HAS NOT BEEN RUN, counts is NULL — never {}. The screen must be able to tell "nobody has
     * any customers" from "nobody has asked", and a 0 cannot say the second. [[feedback-silence-is-the-bug]]
     */
    let counts = null,
      counts_error = null;
    if (rows.length) {
      try {
        const cr = await query('SELECT entity_id, metric, n::int AS n FROM ops.f_entity_counts() WHERE entity_id = ANY($1::uuid[])', [
          rows.map((item) => item.identity_id)
        ]);
        counts = new Map();
        for (const x of cr.rows) {
          if (!counts.has(x.entity_id)) counts.set(x.entity_id, {});
          counts.get(x.entity_id)[x.metric] = x.n;
        }
      } catch (e) {
        /* 42883 undefined_function · 3F000 invalid_schema_name · 42501 insufficient_privilege.
           ⚠️⚠️ THE CODE ALONE IS NOT ENOUGH. 42501 says "permission denied" and stops there — denied on the
           SCHEMA, on the FUNCTION, or on a table INSIDE it are three different faults with three different
           fixes, and postgres puts which one in the message. Reporting only e.code sent me guessing at a
           question the database had already answered. The message goes to the log (fellBack), never into the
           answer (SEC-94): the body carries the code word COUNTS_UNAVAILABLE. [[feedback-silence-is-the-bug]] */
        counts_error = 'COUNTS_UNAVAILABLE'; log.fellBack('entities GET /mis: the counts read failed — carried on without it', e);
        /* ⭐⭐ AND WHO WAS REFUSED. b241's own verification query returned real counts when Athi ran it, so the
           function reads through FORCE RLS correctly and 42501 can only be a GRANT — which means the API is
           not connecting as the role the migration granted to. Every migration in this repo says `TO cb_app`;
           if that is not what the pool actually logs in as, 116 grants have been aimed at the wrong name.
           The database knows. Asking it beats reading a connection string out of a deploy dashboard. */
        try {
          const who = await query("SELECT current_user AS u, current_setting('is_superuser') AS su");
          log.warn('entities GET /mis: the counts read was refused for this database role', { id: req.id, role: who.rows[0].u, superuser: who.rows[0].su }); /* the log carries who was refused, the answer does not */
        } catch (whoFailed) {
          log.fellBack(
            'entities GET /mis: the read failed — carried on without it',
            whoFailed
          ); /* if even this fails the original error is the more useful one */
        }
      }
    }
    for (const r of rows) {
      const c = counts ? counts.get(r.identity_id) || {} : null;
      /* ⭐ THE SURFACE WINS WHERE BOTH EXIST. seats and suppliers are also read inline above, because they work
         with no migration and SORTS orders by them. When supplier_list finally gets RLS (BACKLOG), that inline
         count turns silently into 0 — so the surface, which reads through RLS, takes precedence now. */
      r.counts = c;
      if (c && c.people != null) r.seats = c.people;
      if (c && c.suppliers != null) r.suppliers = c.suppliers;
    }

    /* the SAME predicate as the page above, counted without the LIMIT — see the note on `matched` below */
    const matched = Number(
      (
        await query(
          `SELECT count(*)::int AS n
         FROM identities i
         LEFT JOIN cb_entity c ON c.bridge_id = i.bridge_id
         ${ST_JOIN}
        WHERE i.identity_type = 'entity' AND coalesce(i.status,'active') <> 'erased'
          ${stWhere(9)}
          ${TEST_WHERE}
          ${OWN_WHERE}
          AND ($1::text[] IS NULL OR i.entity_kind = ANY($1))
          AND ($2 = '' OR i.display_name ILIKE '%' || $2 || '%'
                       OR i.user_id     ILIKE '%' || $2 || '%'
                       OR i.bridge_id   ILIKE '%' || $2 || '%')
          AND ($3 = '' OR i.vertical = $3)
          AND ($4 = '' OR i.plan     = $4)
          AND ($6 = '' OR i.catalogue_visibility = $6)
          AND ($7 = '' OR i.entity_visibility = $7)
          AND ($8 = '' OR i.supplies = $8)
          AND ($5 = '' OR (CASE WHEN $5 = 'billable'
                                THEN (c.bridge_id IS NULL OR nlevel(c.path) = 1)
                                /* ⭐ Athi, 2026-09-14: *"show all the network shops and its branches: network
                                   not eq to None"*. Root OR branch — the whole of a network, head included.
                                   Every other option here narrows to one level; this one is the network. */
                                WHEN $5 = 'networked'
                                THEN (c.bridge_id IS NOT NULL)
                                ELSE $5 = CASE WHEN c.bridge_id IS NULL THEN 'standalone'
                                               WHEN nlevel(c.path) = 1 THEN 'root'
                                               ELSE 'branch' END END))`,
          [
            String(req.query.kind || '*').trim() === '*'
              ? null
              : String(req.query.kind)
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
            q,
            String(req.query.vertical || '').trim(),
            String(req.query.plan || '').trim(),
            String(req.query.position || '').trim(),
            String(req.query.visibility || '').trim(),
            String(req.query.entity_visibility || '').trim(),
            String(req.query.supplies || '').trim(),
            String(req.query.standing || '').trim()
          ]
        )
      ).rows[0].n
    );

    const asObj = (r, k, v) => r.rows.reduce((total, x) => ((total[x[k]] = x[v]), total), {});

    res.json({
      at: new Date().toISOString(),
      /* ⭐ the screen's third tile reads this. Before b246 it counted entity_kind='test', which is now empty —
         a tile that silently went to zero rather than to a different number. */
      other_population: otherPop,
      /* ⭐ the screen draws one button per row. Adding a population must not need a front-end release. */
      populations: popRows.length ? popRows.map((item) => item.code) : ['real', 'test'],
      headline: {
        identities: kinds.rows.reduce((total, x) => total + x.n, 0),
        customers: (kinds.rows.find((x) => x.k === 'customer') || {}).n || 0,
        active_30d: kinds.rows.reduce((total, x) => total + (x.k === 'customer' ? x.active_30d : 0), 0)
      },
      by_kind: kinds.rows,
      by_vertical: asObj(verticals, 'v', 'n'),
      by_plan: asObj(plans, 'p', 'n'),
      by_visibility: asObj(vis, 'v', 'n'),
      by_entity_visibility: asObj(evis, 'v', 'n'),
      by_supplies: asObj(sup, 'v', 'n'),
      by_position: asObj(tree, 'pos', 'n'),
      by_class: asObj(classes, 'v', 'n'),
      joined_by_month: joins.rows,
      /* ⭐ the screen renders '—' and names the migration when this is false — never a zero */
      counts_wired: counts !== null,
      counts_error,
      rows,
      /**
       * ── ⚠️⚠️ HOW MANY MATCHED, NOT HOW MANY FITTED ──────────────────────────────────────────────────────
       *
       * Athi, 2026-09-14: *"we cant miss any, how many entity rows, that many has to be here."*
       *
       * The list is capped at 100. With 2,788 identities, filtering to 'every kind' returned a hundred rows
       * and the screen said "100 shown" — TRUE, AND USELESS: it reads as a complete answer. A panel that
       * quietly shows a subset is the same silent failure as a table that reads empty under RLS, and worse
       * here, because a round number looks deliberate.
       *
       * ⭐ `matched` is counted with THE SAME PREDICATE and no LIMIT, so the screen can say "100 of 2,788".
       * One extra query; the alternative is a report nobody can trust to be whole.
       */
      matched,
      /**
       * ⭐ THE CONTROLS, DESCRIBED BY THE SERVER. Athi, 2026-09-14: *"we need to have a sort mechanism based on
       * field like we have it in the task"* · *"almost every panel is missing this information."*
       *
       * The client renders the sort menu from THIS, not from a list of its own. A panel that hard-codes its
       * sort options drifts from what the server will actually honour, and the drift is silent — you pick
       * "oldest" and get "newest" with no error. One source, read at runtime.
       */
      controls: {
        sortable: Object.keys(SORTS),
        /* ⚠️ named by the SERVER, never hard-coded in the page: a filter list that drifts from what the
           database will honour fails silently — you pick a value and get everything. */
        standings: hasStanding
          ? ['a · never signed in', 'b · registered, never used', 'c · lapsed (90d+)', 'd · drifting (30d+)', 'e · quiet (7d+)', 'f · active']
          : [],
        /**
         * ⚠️⚠️ IT ECHOED SIX OF THIRTEEN. position, class, standing, supplies, visibility, entity_visibility
         * and the page were all applied and none of them were reported back, so nothing — not the screen, not
         * a test, not a person reading the network tab — could confirm what the server had actually done. A
         * check I wrote against it hung for 45 seconds waiting for an echo that was never coming.
         *
         * ⭐ A control the server honours and does not name is a control you have to take on trust. Every
         * filter this route reads is now answered back, in the same shape it was read.
         */
        applied: {
          sort: sortKey,
          dir: dir.toLowerCase(),
          q,
          kind: req.query.kind || '*',
          vertical: req.query.vertical || '',
          plan: req.query.plan || '',
          position: req.query.position || '',
          ownership: own,
          population: pop,
          live_population: liveCode,
          standing: req.query.standing || '',
          supplies: req.query.supplies || '',
          visibility: req.query.visibility || '',
          entity_visibility: req.query.entity_visibility || '',
          limit: Math.min(Number(req.query.limit) || 100, 500),
          offset: Math.max(0, Number(req.query.offset) || 0)
        },
        /* the named orderings a person actually asks for, rather than a column plus a direction */
        presets: [
          { key: 'newest', label: 'Most recent', sort: 'joined', dir: 'desc' },
          { key: 'oldest', label: 'Oldest', sort: 'joined', dir: 'asc' },
          { key: 'active', label: 'Recently seen', sort: 'last_seen', dir: 'desc' },
          { key: 'quiet', label: 'Gone quiet', sort: 'last_seen', dir: 'asc' },
          { key: 'biggest', label: 'Most people', sort: 'seats', dir: 'desc' },
          { key: 'az', label: 'A–Z', sort: 'name', dir: 'asc' }
        ],
        /* filter values that actually exist in the data — an empty dropdown is worse than no dropdown */
        filters: {
          kind: kinds.rows.map((x) => x.k),
          vertical: Object.keys(asObj(verticals, 'v', 'n')),
          plan: Object.keys(asObj(plans, 'p', 'n')),
          visibility: Object.keys(asObj(vis, 'v', 'n')),
          entity_visibility: Object.keys(asObj(evis, 'v', 'n')),
          supplies: Object.keys(asObj(sup, 'v', 'n'))
        },
        searches: ['display_name', 'user_id', 'bridge_id'],
        /* root · branch · standalone — computed from cb_entity.path, not stored, so it needs naming here */
        /**
         * ⭐⭐ 'billable' IS THE ONE ANYBODY ACTUALLY ASKS FOR. Athi, 2026-09-14: *"only the root node will pay
         * money, so we need to segregate between root and others."*
         *
         * lib/plans.js: the NETWORK TOP NODE holds the plan and quotas count across its whole subtree — so a
         * billable tenant is a root OR a standalone entity, and a BRANCH IS NEVER ONE: it is billed to its
         * root. Offering only root/branch/standalone left the money question to be assembled in somebody's
         * head out of two filters, and assembled differently each time.
         *
         * ⚠️ Position is NOT a visibility. It is the BILLING axis, and it is listed beside the two visibility
         * filters only because that is where a person looks for it. See VISIBILITY-MATRIX.md §4b.
         */
        positions: ['standalone', 'root', 'branch', 'networked', 'billable']
      },
      /** ⚠️ NAMED, NOT OMITTED. See the header. */
      blind: {
        tables: ['catalogue_items (public only)', 'chit_header', 'chit_status', 'customer_list', 'definition', 'entity_governance', 'usage_ledger'],
        why:
          'RLS-forced: this connection reads them as zero rows, not as an error. Catalogue size, chit ' +
          'volume and governance stamps are therefore absent from this report rather than reported as nil.'
      }
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Could not build the report'));
  }
});

router.get('/entitlements', auth, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const plans = require('../lib/plans');

    let row = {};
    try {
      const r = await query('SELECT plan, vertical, entity_kind, catalogue_visibility FROM identities WHERE identity_id = $1', [entity_id]);
      row = r.rows[0] || {};
    } catch (e) {
      log.fellBack(
        'entities GET /entitlements: the read failed — carried on without it',
        e
      ); /* pre-b229/b230 schema — the defaults below still describe the tier honestly */
    }

    const code = row.plan || plans.DEFAULT_PLAN;
    const p = plans.plan(code);

    /* every quota as a STATE, never a bare number — 'unset' must not read as 'unlimited'. See lib/plans.js. */
    const quotas = {};
    for (const key of ['entities', 'actors', 'chits_per_month', 'network_depth', 'suppliers']) {
      quotas[key] = plans.quotaOf(code, key);
    }

    /**
     * ⭐⭐ THE ENVELOPE, NOT JUST THE POINT INSIDE IT — govresolve's own distinction, and the reason this
     * endpoint is worth having. `basics` is the RESOLVED answer (one currency, one timezone); `allowed` is what
     * the constitution PERMITS. A screen that shows only the resolved value can display the currency and has no
     * way to offer the choice the layer actually allows.
     *
     * ⚠️ The keys are basics / allowed / jurisdiction — NOT `defaults`. I wrote `defaults` first, which would
     * have quietly reported `{}` for every entity: present, empty, and indistinguishable from "no envelope".
     */
    let envelope = null;
    try {
      const gov = await require('../lib/govresolve').resolveEntityGovernance(entity_id);
      envelope = gov && {
        constitution: gov.constitution,
        installation: gov.installation || null,
        allowed: gov.allowed || {},
        basics: gov.basics || {},
        jurisdiction: gov.jurisdiction || null,
        capabilities: gov.capabilities || []
      };
    } catch (e) {
      log.fellBack(
        'entities GET /entitlements: the helper failed — carried on without it',
        e
      ); /* governance unresolvable — reported as null rather than guessed */
    }

    res.json({
      plan: code,
      name: p.name,
      sellable: p.sellable !== false,
      limited: p.limited !== false,
      features: p.features,
      quotas,
      vertical: row.vertical || 'general',
      entity_kind: row.entity_kind || null,
      envelope,
      /* ⚠️ THE MOST IMPORTANT FIELD HERE. Nothing in the product gates on any of the above. */
      enforced: false,
      note:
        'Reporting only — no route gates on plan today. lib/visibility-cap.js is the one reader and it is ' +
        'switched off after the outage its header records.'
    });
  } catch (err) {
    problem(req, res, failed(err, req, 'Could not read entitlements'));
  }
});

router.openapi = { paths: contract.entities.pathsOf(), schemas: {} };

module.exports = router;
/* for tests/prefs-merge.test.cjs — the merge-patch split and its SQL */
module.exports.prefPatch = prefPatch;
module.exports.MERGE_PATCH_SQL = MERGE_PATCH_SQL;
module.exports.PREF_SETS = PREF_SETS;
module.exports.registerNew = registerNew; /* FX-AU1: tests/register-country-guess.test.cjs drives it with a stand-in db */
