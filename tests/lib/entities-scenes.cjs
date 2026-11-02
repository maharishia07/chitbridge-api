/**
 * entities-scenes.cjs — the named scenarios of tests/api-problem-entities.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 25 routes of routes/entities.js (the shop itself: sign-up, sign-in, profile, policy, routing, populations), each with the
 *           stand-in rows it needs (answered by the shape of the statement, so the same facts meet old and new code).
 * CALLED BY tests/api-problem-entities.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url, after }] → the harness runs each one against the real route
 * CARD      28-platform-and-operations/entities-routes
 * Sign-in (POST /register, POST /verify) is here only to be RECORDED: the test replays what they answered before the sweep byte for byte, and never judges their refusals (they are routes/signin.js's).
 */
'use strict';

const ENT = '/api/entities';
const SHOP = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const OTHER = '88888888-8888-4888-8888-888888888888';
const HANDLER = '99999999-9999-4999-8999-999999999999';
const AT = '2026-10-01T10:00:00.000Z';
/** an identities row as /me selects it (migrations/000_baseline_2026-10-21.sql + b176 timezone, b178/b237 supplies): every column filled, then the nullable ones null */
const ME_COLUMNS = ['timezone', 'supplies', 'storefront_access', 'locale_prefs', 'ui_prefs', 'policy_flags', 'catalogue_visibility', 'plan', 'params_override'];
const ME_FULL = { identity_id: SHOP, bridge_id: 'AAAA2222', display_name: 'Shop A', email: 'a@example.com', user_id: 'shop-a', self_copy_pref: 'received', dispute_handler_actor_id: HANDLER, country: 'IN', currency_code: 'INR', created_at: AT, last_active_at: AT, gstn: '29ABCDE1234F1Z5', is_verified: true, logo_url: 'https://x/y.png', address: '1 Main Rd', business_status: 'open', purpose: 'Retail', sort_order: 1, city: 'Chennai', lat: '13.082700', lng: '80.270700', service_km: 5, actor_key: 'asha', phone: '9000000000', timezone: 'Asia/Kolkata', supplies: 'goods', storefront_access: 'browse', locale_prefs: { lang: 'ta' }, ui_prefs: { theme: 'dark' }, catalogue_visibility: 'public', plan: 'test', params_override: { a: 1 }, policy_flags: { books: true }, parent_user_id: 'chain' };
const ME_BARE = { identity_id: SHOP, bridge_id: 'AAAA2222', display_name: 'Shop A', email: null, user_id: null, self_copy_pref: 'received', dispute_handler_actor_id: null, country: null, currency_code: null, created_at: null, last_active_at: null, gstn: null, is_verified: false, logo_url: null, address: null, business_status: 'open', purpose: null, sort_order: null, city: null, lat: null, lng: null, service_km: null, actor_key: null, phone: null, timezone: null, supplies: 'unknown', storefront_access: 'browse', locale_prefs: null, ui_prefs: null, catalogue_visibility: 'private', plan: 'test', params_override: {}, policy_flags: null, parent_user_id: null };

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { OWNER, STAFF, SECRET_SQL, answering, raising, firstOf, nobodyRoot } = tools;
  const STRANGER = { identity_id: STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
  const VIEWER = Object.assign({}, STAFF, { access_level: 'viewer' });
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** a scenario for an answer the sweep ADDS (the schema's refusal): it is not frozen, since the old code answered it otherwise */
  const N = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const failing = { db: 'fail' };
  /** SEC-100: the folder lookup finds the folder (it is this shop's own) */
  const OWN_FOLDER = answering(/SELECT 1 FROM folder WHERE folder_id = \$1 AND entity_id = \$2/, [{ '?column?': 1 }]);
  /* SEC-103: the assignee is looked up under the shop before it is stored; this stand-in says the person is the shop's own */
  const OWN_ACTOR = answering(/FROM identities WHERE identity_id = \$1 AND identity_type = 'actor' AND parent_entity_id = \$2/, [{ '?column?': 1 }]);
  const at = (tail) => ENT + tail;
  const sqlState = (code, message, hint) => (sql) => { throw Object.assign(new Error(message || 'pg ' + code), { code }, hint ? { hint } : {}); };
  const when = (pattern, run) => (sql, params) => (pattern.test(sql) ? run(sql, params) : null);
  const row = (pattern, one) => answering(pattern, [one]);
  const noRoot = { platform: { refuseUnlessRoot: nobodyRoot.refuseUnlessRoot, configured: nobodyRoot.configured, isRoot: nobodyRoot.isRoot } };

  const ME_ROW = { identity_id: SHOP, bridge_id: 'AAAA2222', display_name: 'Shop A', email: 'a@example.com', user_id: 'shop-a', country: 'IN', currency_code: 'INR', capabilities: ['x'], policy_flags: {} };
  const meRow = row(/SELECT identity_id, bridge_id, display_name, email, user_id, self_copy_pref/, ME_ROW);

  /* ── sign-in and sign-up (recorded, never judged: routes/signin.js owns their refusals) ── */
  const signin = [
    X('register-needs-an-id', 'POST ' + at('/register'), 400, { body: {} }),
    X('register-name-too-short', 'POST ' + at('/register'), 400, { body: { email: 'new@example.com', display_name: 'Z' } }),
    X('register-user-id-unusable', 'POST ' + at('/register'), 400, { body: { email: 'new@example.com', display_name: 'ab' } }),
    X('register-user-id-taken', 'POST ' + at('/register'), 409, { body: { email: 'new@example.com', display_name: 'Brand New Shop' }, setup: { sqlRows: row(/SELECT 1 FROM identities WHERE LOWER\(user_id\) = \$1/, { '?column?': 1 }) } }),
    X('register-made', 'POST ' + at('/register'), 200, { body: { email: 'new@example.com', display_name: 'Brand New Shop' } }),
    X('register-made-with-a-chosen-id', 'POST ' + at('/register'), 200, { body: { email: 'new2@example.com', display_name: 'Brand New Shop', user_id: 'chosen-id' } }),
    X('register-insert-fails', 'POST ' + at('/register'), 500, { body: { email: 'new@example.com', display_name: 'Brand New Shop' }, setup: { sqlRows: raising(/INSERT INTO identities/, '23505') } }),
    X('register-login-of-unknown', 'POST ' + at('/register'), 400, { body: { email: 'ghost@example.com', mode: 'login' } }),
    X('verify-needs-an-id', 'POST ' + at('/verify'), 400, { body: {} }),
    X('verify-short-code', 'POST ' + at('/verify'), 400, { body: { email: 'a@example.com', otp: '12' } }),
    X('verify-unknown-account', 'POST ' + at('/verify'), 400, { body: { email: 'ghost@example.com', otp: '123456' } })
  ];

  /* ── the public door and the reads ── */
  const reads = [
    X('constitutions-listed', 'GET ' + at('/constitutions'), 200, { setup: { sqlRows: answering(/FROM constitution/, [{ key: 'general', version: 1, label: 'General', vertical: 'general', capabilities: [], is_default: true }]) } }),
    X('constitutions-with-a-zone', 'GET ' + at('/constitutions'), 200, { url: at('/constitutions?tz=Asia/Kolkata') }),
    X('constitutions-catalogue-unread', 'GET ' + at('/constitutions'), 200, { setup: { sqlRows: raising(/FROM constitution/, '42P01') } }),
    X('search-too-short', 'GET ' + at('/search'), 400, { url: at('/search?q=a') }),
    X('search-nothing-asked', 'GET ' + at('/search'), 400, {}),
    X('search-found', 'GET ' + at('/search'), 200, { url: at('/search?q=shop'), setup: { sqlRows: answering(/FROM identities/, [{ identity_id: OTHER, bridge_id: 'BBBB3333', display_name: 'Shop B', user_id: 'shop-b', created_at: '2026-10-01T00:00:00.000Z' }]) } }),
    N('search-place-unknown', 'GET ' + at('/search'), 404, { url: at('/search?q=shop&where=sit-nowhere') }),
    N('search-places-listed', 'GET ' + at('/search/places'), 200, {}),
    N('search-places-fails', 'GET ' + at('/search/places'), 500, { patch: { search: { places: async () => { throw new Error(SECRET_SQL); } } } }),
    X('search-db-fails', 'GET ' + at('/search'), 500, { url: at('/search?q=shop'), setup: failing }),
    /* the header as lib/entity-header.js build() makes it from a shop row and one gathered licence the country's rules do not know (the same keys, a licence of each kind) */
    X('header-read', 'GET ' + at('/header'), 200, { patch: { header: { read: async () => require('../../lib/entity-header').build({ me: { display_name: 'Shop A', country: 'IN', currency_code: 'INR', phone: '9000000000', address: '1 Main Rd', gstn: '29ABCDE1234F1Z5', policy_flags: {} }, profile: {}, vault: null, compliance: [{ standard_key: 'unknown_scheme', doc_key: 'some_doc', valid_until: '2027-01-01', verification: { number_masked: 'XXXX1234' } }], docs: {} }) } } }),
    X('header-fails', 'GET ' + at('/header'), 500, { patch: { header: { read: async () => { throw new Error(SECRET_SQL); } } } }),
    X('sides-read', 'GET ' + at('/sides'), 200, { patch: { sides: { read: async () => ({ lean: [], use: [], impact: null }) } } }),
    X('sides-fails', 'GET ' + at('/sides'), 500, { patch: { sides: { read: async () => { throw new Error(SECRET_SQL); } } } }),
    X('me-found', 'GET ' + at('/me'), 200, { setup: { sqlRows: meRow } }),
    X('me-with-includes', 'GET ' + at('/me'), 200, { url: at('/me?include=nothing,readiness'), setup: { sqlRows: meRow } }),
    X('me-of-staff', 'GET ' + at('/me'), 200, { setup: { who: STAFF, sqlRows: meRow } }),
    /* SEC-94: the capability read fails with a sentence that names the database: the 200 must not carry it */
    X('me-capabilities-fail-leaks-nothing', 'GET ' + at('/me'), 200, { setup: { who: STAFF, sqlRows: (sql) => { if (/SELECT capabilities FROM identities/.test(sql)) throw new Error(SECRET_SQL); return meRow(sql); } } }),
    X('me-unknown', 'GET ' + at('/me'), 404, {}),
    X('me-db-fails', 'GET ' + at('/me'), 500, { setup: failing }),
    X('can-see-costs-owner', 'GET ' + at('/me/can-see-costs'), 200, {}),
    X('can-see-costs-staff', 'GET ' + at('/me/can-see-costs'), 200, { setup: { who: STAFF, sqlRows: row(/SELECT can_see_costs/, { can_see_costs: true }) } }),
    X('can-see-costs-fails', 'GET ' + at('/me/can-see-costs'), 500, { setup: { who: STAFF, sqlRows: sqlState('XX000', SECRET_SQL) } }),
    X('lookup-missing', 'GET ' + at('/lookup'), 400, {}),
    X('lookup-none', 'GET ' + at('/lookup'), 404, { url: at('/lookup?user_id=ghost') }),
    X('lookup-found', 'GET ' + at('/lookup'), 200, { url: at('/lookup?user_id=Shop-B'), setup: { sqlRows: answering(/FROM identities/, [{ identity_id: OTHER, bridge_id: 'BBBB3333', display_name: 'Shop B', user_id: 'shop-b' }]) } }),
    X('lookup-asked-twice', 'GET ' + at('/lookup'), 404, { url: at('/lookup?user_id=a&user_id=b') }),
    X('lookup-db-fails', 'GET ' + at('/lookup'), 500, { url: at('/lookup?user_id=shop-b'), setup: failing }),
    X('usage-read', 'GET ' + at('/usage'), 200, {}),
    X('usage-window', 'GET ' + at('/usage'), 200, { url: at('/usage?days=7') }),
    X('usage-not-enabled', 'GET ' + at('/usage'), 200, { setup: { sqlRows: sqlState('42P01', 'relation "usage_ledger" does not exist') } }),
    X('usage-db-fails', 'GET ' + at('/usage'), 500, { setup: failing }),
    X('entitlements-read', 'GET ' + at('/entitlements'), 200, { setup: { sqlRows: row(/SELECT plan, vertical, entity_kind/, { plan: null, vertical: 'general', entity_kind: 'customer', catalogue_visibility: 'public' }) } }),
    X('entitlements-row-unread', 'GET ' + at('/entitlements'), 200, {}),
    X('entitlements-fails', 'GET ' + at('/entitlements'), 500, { patch: { plans: { plan: () => { throw new Error(SECRET_SQL); } } } })
  ];

  /* ── policy ── */
  const policy = [
    X('policy-read', 'GET ' + at('/policy'), 200, { setup: { sqlRows: row(/policy_flags/, { policy_flags: {}, country: 'IN' }) } }),
    X('policy-read-fails', 'GET ' + at('/policy'), 500, { setup: failing }),
    X('policy-owner-only', 'PATCH ' + at('/policy'), 403, { body: { books: { auto_post: true } }, setup: { who: STAFF } }),
    X('policy-bound-flag', 'PATCH ' + at('/policy'), 400, { body: { dispute_scope: 'x' } }),
    X('policy-unknown-flag', 'PATCH ' + at('/policy'), 400, { body: { nope: 1 } }),
    X('policy-not-migrated', 'PATCH ' + at('/policy'), 503, { body: { trade_side: 'sell' }, setup: { sqlRows: raising(/policy_flags/, '42703') } }),
    X('policy-set', 'PATCH ' + at('/policy'), 200, { body: { trade_side: 'receive' }, setup: { sqlRows: row(/policy_flags/, { policy_flags: { trade_side: 'receive' }, country: 'IN' }) } }),
    X('policy-set-fails', 'PATCH ' + at('/policy'), 500, { body: { trade_side: 'sell' }, setup: failing }),
    N('policy-body-a-list', 'PATCH ' + at('/policy'), 400, { body: [] })
  ];

  /* ── the person's preferences and the business's switches ── */
  const prefsRows = row(/UPDATE identities SET (ui_prefs|locale_prefs)/, { v: { theme: 'dark' } });
  const prefs = [
    X('prefs-unknown-set', 'PATCH ' + at('/me/prefs/:kind'), 404, { url: at('/me/prefs/nope'), body: { theme: 'dark' } }),
    X('prefs-prototype-name', 'PATCH ' + at('/me/prefs/:kind'), 404, { url: at('/me/prefs/__proto__'), body: { theme: 'dark' } }),
    X('prefs-bad-value', 'PATCH ' + at('/me/prefs/:kind'), 400, { url: at('/me/prefs/ui'), body: { theme: 'a b' } }),
    X('prefs-unknown-font', 'PATCH ' + at('/me/prefs/:kind'), 400, { url: at('/me/prefs/ui'), body: { font: 'comic' } }),
    X('prefs-bad-locale', 'PATCH ' + at('/me/prefs/:kind'), 400, { url: at('/me/prefs/locale'), body: { locale: 'en--us' } }),
    X('prefs-unknown-zone', 'PATCH ' + at('/me/prefs/:kind'), 400, { url: at('/me/prefs/locale'), body: { tz: 'Mars/Phobos' } }),
    X('prefs-saved', 'PATCH ' + at('/me/prefs/:kind'), 200, { url: at('/me/prefs/ui'), body: { theme: 'dark' }, setup: { sqlRows: prefsRows } }),
    X('prefs-cleared', 'PATCH ' + at('/me/prefs/:kind'), 200, { url: at('/me/prefs/ui'), body: { theme: '' }, setup: { sqlRows: prefsRows } }),
    X('prefs-column-missing', 'PATCH ' + at('/me/prefs/:kind'), 200, { url: at('/me/prefs/ui'), body: { theme: 'dark' }, setup: { sqlRows: sqlState('42703', 'column "ui_prefs" does not exist') } }),
    X('prefs-db-fails', 'PATCH ' + at('/me/prefs/:kind'), 500, { url: at('/me/prefs/ui'), body: { theme: 'dark' }, setup: failing }),
    N('prefs-body-a-list', 'PATCH ' + at('/me/prefs/:kind'), 400, { url: at('/me/prefs/ui'), body: [] }),
    X('locale-saved', 'PATCH ' + at('/me/locale'), 200, { body: { lang: 'ta' }, setup: { sqlRows: prefsRows } }),
    X('locale-bad-value', 'PATCH ' + at('/me/locale'), 400, { body: { lang: 'a b' } }),
    X('locale-db-fails', 'PATCH ' + at('/me/locale'), 500, { body: { lang: 'ta' }, setup: failing }),
    N('locale-body-a-list', 'PATCH ' + at('/me/locale'), 400, { body: [] }),
    X('exposure-no-switch', 'PATCH ' + at('/me/exposure'), 400, { body: {} }),
    X('exposure-saved', 'PATCH ' + at('/me/exposure'), 200, { body: { tax: false }, setup: { sqlRows: row(/storefront_exposure/, { x: { tax: false } }) } }),
    X('exposure-db-fails', 'PATCH ' + at('/me/exposure'), 500, { body: { tax: false }, setup: failing }),
    N('exposure-body-a-list', 'PATCH ' + at('/me/exposure'), 400, { body: [] })
  ];

  /* ── the shop's own details ── */
  const user = (id) => row(/SELECT user_id FROM identities WHERE identity_id = \$1/, { user_id: id });
  const profile = [
    X('profile-viewer', 'PATCH ' + at('/profile'), 403, { body: { address: 'x' }, setup: { who: VIEWER } }),
    X('profile-chain-refused', 'PATCH ' + at('/profile'), 400, { body: { business_status: 'sleeping', supplies: 'x', dispute_handler_actor_id: 'nope' } }),
    X('profile-name-too-short', 'PATCH ' + at('/profile'), 400, { body: { display_name: 'A' } }),
    X('profile-staff-user-id', 'PATCH ' + at('/profile'), 403, { body: { user_id: 'clerkstolen' }, setup: { who: STAFF } }),
    X('profile-user-id-fixed', 'PATCH ' + at('/profile'), 409, { body: { user_id: 'other-name' }, setup: { sqlRows: user('shop-a') } }),
    X('profile-user-id-unusable', 'PATCH ' + at('/profile'), 400, { body: { user_id: 'a b' }, setup: { sqlRows: user(null) } }),
    X('profile-user-id-taken', 'PATCH ' + at('/profile'), 409, { body: { user_id: 'fresh-name' }, setup: { sqlRows: firstOf(user(null), row(/SELECT 1 FROM identities WHERE LOWER\(user_id\) = \$1 AND identity_id/, { '?column?': 1 })) } }),
    X('profile-handler-not-yours', 'PATCH ' + at('/profile'), 400, { body: { dispute_handler_actor_id: HANDLER } }),
    X('profile-staff-currency', 'PATCH ' + at('/profile'), 403, { body: { currency_code: 'USD' }, setup: { who: STAFF } }),
    X('profile-currency-malformed', 'PATCH ' + at('/profile'), 400, { body: { currency_code: 'U$D' } }),
    X('profile-tax-number-refused', 'PATCH ' + at('/profile'), 400, { body: { gstn: 'bad' }, setup: { sqlRows: row(/SELECT country FROM identities/, { country: 'IN' }) } }),
    X('profile-visibility-capped', 'PATCH ' + at('/profile'), 403, { body: { catalogue_visibility: 'public' }, setup: { sqlRows: row(/SELECT plan, params_override FROM identities/, { plan: null, params_override: { caps: { catalogue_visibility: 'private' } } }) } }),
    X('profile-visibility-not-migrated', 'PATCH ' + at('/profile'), 409, { body: { catalogue_visibility: 'network' }, setup: { sqlRows: raising(/UPDATE identities SET catalogue_visibility/, '23514') } }),
    X('profile-visibility-not-stored', 'PATCH ' + at('/profile'), 500, { body: { catalogue_visibility: 'private' }, setup: { sqlRows: raising(/UPDATE identities SET catalogue_visibility/, 'XX000') } }),
    X('profile-schema-not-stored', 'PATCH ' + at('/profile'), 500, { body: { catalogue_visibility: 'private' }, setup: { sqlRows: raising(/UPDATE entity_schemas/, 'XX000') } }),
    X('profile-user-id-race', 'PATCH ' + at('/profile'), 409, { body: { address: 'x' }, setup: { sqlRows: raising(/UPDATE identities SET display_name/, '23505') } }),
    X('profile-saved', 'PATCH ' + at('/profile'), 200, { body: { display_name: ' Shop A2 ', logo_url: 'https://x/y.png', business_status: 'open', self_copy_pref: 'both', supplies: 'goods', storefront_access: 'login', ui_prefs: { theme: 'dark', old: null } } }),
    X('profile-saved-visibility', 'PATCH ' + at('/profile'), 200, { body: { catalogue_visibility: 'network' } }),
    X('profile-db-fails', 'PATCH ' + at('/profile'), 500, { body: { address: 'x' }, setup: failing }),
    N('profile-body-a-list', 'PATCH ' + at('/profile'), 400, { body: [] })
  ];

  /* ── erasure, the platform's population registry and routing ── */
  const platform = [
    X('erase-not-platform', 'PATCH ' + at('/:id/erase'), 403, { url: at('/' + OTHER + '/erase'), body: {}, setup: { who: STRANGER } }),
    X('erase-sealed', 'PATCH ' + at('/:id/erase'), 403, { url: at('/' + OTHER + '/erase'), body: {}, setup: { sqlRows: row(/SELECT sealed FROM identities/, { sealed: true }) } }),
    X('erase-done', 'PATCH ' + at('/:id/erase'), 200, { url: at('/' + OTHER + '/erase'), body: {} }),
    N('erase-body-a-list', 'PATCH ' + at('/:id/erase'), 400, { url: at('/' + OTHER + '/erase'), body: [] }),
    X('erase-db-fails', 'PATCH ' + at('/:id/erase'), 500, { url: at('/' + OTHER + '/erase'), body: {}, setup: failing }),
    X('populations-not-root', 'GET ' + at('/populations'), 403, { setup: { who: STRANGER } }),
    X('populations-no-root', 'GET ' + at('/populations'), 404, { patch: noRoot }),
    X('populations-listed', 'GET ' + at('/populations'), 200, { setup: { sqlRows: answering(/FROM ops\.population/, [{ code: 'live', label: 'Live', is_live: true, note: 'n', desk_entity_id: null, desk_name: null, desk_bridge_id: null, entities: 3 }]) } }),
    X('populations-desk-column-missing', 'GET ' + at('/populations'), 200, { setup: { sqlRows: when(/p\.desk_entity_id,\s+d\.display_name/, sqlState('42703')) } }),
    X('populations-registry-missing', 'GET ' + at('/populations'), 200, { setup: { sqlRows: raising(/FROM ops\.population/, '42P01') } }),
    X('populations-db-fails', 'GET ' + at('/populations'), 500, { setup: { sqlRows: raising(/FROM ops\.population/, 'XX000') } }),
    X('desk-not-root', 'PUT ' + at('/populations/:code/desk'), 403, { url: at('/populations/live/desk'), body: {}, setup: { who: STRANGER } }),
    X('desk-no-root', 'PUT ' + at('/populations/:code/desk'), 404, { url: at('/populations/live/desk'), body: {}, patch: noRoot }),
    X('desk-no-such-population', 'PUT ' + at('/populations/:code/desk'), 404, { url: at('/populations/Ghost/desk'), body: { desk_entity_id: OTHER } }),
    X('desk-set', 'PUT ' + at('/populations/:code/desk'), 200, { url: at('/populations/live/desk'), body: { desk_entity_id: OTHER }, setup: { sqlRows: answering(/UPDATE ops\.population SET desk_entity_id/, [{}]) } }),
    X('desk-cleared', 'PUT ' + at('/populations/:code/desk'), 200, { url: at('/populations/live/desk'), body: { desk_entity_id: '' }, setup: { sqlRows: answering(/UPDATE ops\.population SET desk_entity_id/, [{}]) } }),
    X('desk-column-missing', 'PUT ' + at('/populations/:code/desk'), 409, { url: at('/populations/live/desk'), body: { desk_entity_id: OTHER }, setup: { sqlRows: raising(/UPDATE ops\.population/, '42703') } }),
    X('desk-not-for-this-population', 'PUT ' + at('/populations/:code/desk'), 409, { url: at('/populations/live/desk'), body: { desk_entity_id: OTHER }, setup: { sqlRows: sqlState('23514', 'the live desk must itself be in the live population (it is in test)', 'Pick one of its own.') } }),
    X('desk-not-for-this-population-no-hint', 'PUT ' + at('/populations/:code/desk'), 409, { url: at('/populations/live/desk'), body: { desk_entity_id: OTHER }, setup: { sqlRows: when(/UPDATE ops\.population/, sqlState('23514', 'the live desk must be a business, not a person')) } }),
    X('desk-plain-check-violation', 'PUT ' + at('/populations/:code/desk'), 500, { url: at('/populations/live/desk'), body: { desk_entity_id: OTHER }, setup: { sqlRows: when(/UPDATE ops\.population/, sqlState('23514', SECRET_SQL)) } }),
    X('desk-db-fails', 'PUT ' + at('/populations/:code/desk'), 500, { url: at('/populations/live/desk'), body: { desk_entity_id: OTHER }, setup: failing }),
    N('desk-body-a-list', 'PUT ' + at('/populations/:code/desk'), 400, { url: at('/populations/live/desk'), body: [] }),
    X('population-not-root', 'POST ' + at('/populations'), 403, { body: { code: 'lab', label: 'Lab', note: 'n' }, setup: { who: STRANGER } }),
    X('population-no-root', 'POST ' + at('/populations'), 404, { body: { code: 'lab', label: 'Lab', note: 'n' }, patch: noRoot }),
    X('population-code-unusable', 'POST ' + at('/populations'), 400, { body: { code: 'L!', label: 'Lab', note: 'n' } }),
    X('population-needs-a-name', 'POST ' + at('/populations'), 400, { body: { code: 'lab', note: 'n' } }),
    X('population-needs-a-note', 'POST ' + at('/populations'), 400, { body: { code: 'lab', label: 'Lab' } }),
    X('population-made', 'POST ' + at('/populations'), 201, { body: { code: ' Lab ', label: 'Lab', note: 'for tests' } }),
    X('population-exists', 'POST ' + at('/populations'), 409, { body: { code: 'lab', label: 'Lab', note: 'n' }, setup: { sqlRows: raising(/INSERT INTO ops\.population/, '23505') } }),
    X('population-registry-missing', 'POST ' + at('/populations'), 409, { body: { code: 'lab', label: 'Lab', note: 'n' }, setup: { sqlRows: raising(/INSERT INTO ops\.population/, '42P01') } }),
    X('population-db-fails', 'POST ' + at('/populations'), 500, { body: { code: 'lab', label: 'Lab', note: 'n' }, setup: { sqlRows: raising(/INSERT INTO ops\.population/, 'XX000') } }),
    N('population-body-a-list', 'POST ' + at('/populations'), 400, { body: [] }),
    X('mis-no-root', 'GET ' + at('/mis'), 404, { patch: noRoot }),
    X('mis-not-root', 'GET ' + at('/mis'), 403, { setup: { who: STRANGER } }),
    X('mis-read', 'GET ' + at('/mis'), 200, { setup: { sqlRows: () => ({ rows: [{ n: 1 }], rowCount: 1 }) } }),
    X('mis-counts-unavailable', 'GET ' + at('/mis'), 200, { setup: { sqlRows: (sql) => { if (/f_entity_counts/.test(sql)) throw Object.assign(new Error('permission denied for schema ops'), { code: '42501' }); return /current_user/.test(sql) ? { rows: [{ u: 'cb_app', su: 'off' }], rowCount: 1 } : { rows: [{ n: 1, identity_id: OTHER }], rowCount: 1 }; } } }),
    X('mis-counts-fail-leaks-nothing', 'GET ' + at('/mis'), 200, { setup: { sqlRows: (sql) => { if (/f_entity_counts/.test(sql)) throw Object.assign(new Error(SECRET_SQL), { code: '42501' }); return /current_user/.test(sql) ? { rows: [{ u: 'secret_role', su: 'off' }], rowCount: 1 } : { rows: [{ n: 1, identity_id: OTHER }], rowCount: 1 }; } } }),
    X('mis-db-fails', 'GET ' + at('/mis'), 500, { setup: failing }),
    X('mis-fails', 'GET ' + at('/mis'), 500, { patch: { platform: { configured: () => { throw new Error(SECRET_SQL); } } } })
  ];

  const routing = [
    X('routing-preview', 'GET ' + at('/routing/preview'), 200, {}),
    X('routing-preview-of-a-kind', 'GET ' + at('/routing/preview'), 200, { url: at('/routing/preview?kind=spec&audience=customer') }),
    X('routing-preview-fails', 'GET ' + at('/routing/preview'), 200, { setup: failing }),
    X('routing-read', 'GET ' + at('/routing'), 200, {}),
    X('routing-read-with-rows', 'GET ' + at('/routing'), 200, { setup: { sqlRows: answering(/FROM entity_work_routing/, [{ kind: 'incident', folder_id: null, assignee_actor_id: null, notify_email: null, route_to_entity_id: OTHER }]) } }),
    X('routing-table-missing', 'GET ' + at('/routing'), 200, { setup: { sqlRows: raising(/FROM entity_work_routing/, '42P01') } }),
    X('routing-read-fails', 'GET ' + at('/routing'), 500, { setup: failing }),
    X('routing-bad-kind', 'PUT ' + at('/routing'), 400, { body: { kind: 'nope' } }),
    X('routing-no-kind', 'PUT ' + at('/routing'), 400, { body: {} }),
    X('routing-saved', 'PUT ' + at('/routing'), 200, { body: { kind: 'incident', folder_id: '', assignee_actor_id: HANDLER, route_to_entity_id: null }, setup: { sqlRows: OWN_ACTOR } }),
    X('routing-table-not-there', 'PUT ' + at('/routing'), 409, { body: { kind: 'incident' }, setup: { sqlRows: raising(/INSERT INTO entity_work_routing/, '42P01') } }),
    X('routing-team-outside-network', 'PUT ' + at('/routing'), 409, { body: { kind: 'incident', route_to_entity_id: OTHER }, setup: { sqlRows: sqlState('23514', 'work can only be routed inside your own network', 'Pick a team of your own network.') } }),
    X('routing-plain-check-violation', 'PUT ' + at('/routing'), 500, { body: { kind: 'incident', route_to_entity_id: OTHER }, setup: { sqlRows: when(/INSERT INTO entity_work_routing/, sqlState('23514', SECRET_SQL)) } }),
    X('routing-team-outside-network-no-hint', 'PUT ' + at('/routing'), 409, { body: { kind: 'incident', route_to_entity_id: OTHER }, setup: { sqlRows: when(/INSERT INTO entity_work_routing/, sqlState('23514', 'work can only be routed inside your own network')) } }),
    X('routing-folder-gone', 'PUT ' + at('/routing'), 409, { body: { kind: 'incident', folder_id: OTHER }, setup: { sqlRows: firstOf(OWN_FOLDER, raising(/INSERT INTO entity_work_routing/, '23503')) } }),
    N('routing-folder-not-found', 'PUT ' + at('/routing'), 404, { body: { kind: 'incident', folder_id: OTHER } }),
    N('routing-folder-not-an-id', 'PUT ' + at('/routing'), 404, { body: { kind: 'incident', folder_id: 'nope' } }),
    N('routing-saved-with-an-own-folder', 'PUT ' + at('/routing'), 200, { body: { kind: 'incident', folder_id: OTHER }, setup: { sqlRows: OWN_FOLDER } }),
    N('routing-person-not-found', 'PUT ' + at('/routing'), 404, { body: { kind: 'incident', assignee_actor_id: HANDLER } }),
    N('routing-person-not-an-id', 'PUT ' + at('/routing'), 404, { body: { kind: 'incident', assignee_actor_id: 'nope' } }),
    X('routing-save-fails', 'PUT ' + at('/routing'), 500, { body: { kind: 'incident' }, setup: failing }),
    N('routing-body-a-list', 'PUT ' + at('/routing'), 400, { body: [] })
  ];
  return signin.concat(reads, policy, prefs, profile, platform, routing, readyBranch(tools));
}

/**
 * The READY branch of the shop's reads: the database holds rows with every column their statement selects (each named from the table's DDL), a nullable column null in a second row,
 * so the shape tools/api-allowlist.cjs derives (docs/contracts/api-output-shapes.json) is the whole of what these routes can answer, and the output filter drops nothing real.
 */
function readyBranch(tools) {
  const { STAFF, answering, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const at = (tail) => ENT + tail;
  const probed = answering(/FROM information_schema.columns/, ME_COLUMNS.map((column_name) => ({ column_name })));
  const meWorld = (one, who) => Object.assign(who ? { who } : {}, { sqlRows: firstOf(probed, answering(/SELECT identity_id, bridge_id, display_name, email, user_id, self_copy_pref/, [one])) });
  const withDesk = { code: 'trial', label: 'Trial', is_live: false, note: null, desk_entity_id: OTHER, desk_name: 'Desk', desk_bridge_id: 'DDDD4444', entities: 1 };
  const plain = { code: 'live', label: 'Live', is_live: true, note: 'n', desk_entity_id: null, desk_name: null, desk_bridge_id: null, entities: 3 };
  const candidate = { identity_id: OTHER, display_name: 'Shop B', bridge_id: 'BBBB3333', population: 'live' };
  const day = { day: AT, events: 2, cost: '0.0100' };
  const meter = { meter: 'sms', events: 2, quantity: '3', cost: '0.0100' };
  const recent = { meter: 'sms', detail: 'd', quantity: 1, cost_usd: '0.0050', meta: { k: 1 }, created_at: AT };
  const recentBare = { meter: 'sms', detail: null, quantity: 1, cost_usd: '0.0050', meta: null, created_at: AT };
  return [
    /* the governance read fails: `governance` is null in the answer, and `envelope` of /entitlements too */
    X('me-governance-unresolved', 'GET ' + at('/me'), 200, { setup: meWorld(ME_FULL), patch: { govresolve: { resolveEntityGovernance: async () => { throw new Error('governance unreadable'); } } } }),
    X('entitlements-governance-unresolved', 'GET ' + at('/entitlements'), 200, { patch: { govresolve: { resolveEntityGovernance: async () => { throw new Error('governance unreadable'); } } } }),
    X('me-every-column', 'GET ' + at('/me'), 200, { setup: meWorld(ME_FULL) }),
    X('me-nullable-columns-null', 'GET ' + at('/me'), 200, { setup: meWorld(ME_BARE, STAFF) }),
    X('search-found-bare-row', 'GET ' + at('/search'), 200, { url: at('/search?q=shop'), setup: { sqlRows: answering(/FROM identities/, [{ identity_id: OTHER, bridge_id: 'BBBB3333', display_name: 'Shop B', user_id: null, created_at: null }]) } }),
    X('populations-with-a-desk', 'GET ' + at('/populations'), 200, { setup: { sqlRows: firstOf(answering(/AS population/, [candidate]), answering(/FROM ops.population/, [plain, withDesk])) } }),
    X('usage-with-rows', 'GET ' + at('/usage'), 200, { setup: { sqlRows: firstOf(answering(/GROUP BY 1 ORDER BY 1 DESC/, [day]), answering(/GROUP BY 1 ORDER BY cost/, [meter]), answering(/LIMIT 100/, [recent, recentBare])) } }),
    X('routing-with-folders-people-teams', 'GET ' + at('/routing'), 200, { setup: { sqlRows: firstOf(answering(/FROM folder/, [{ folder_id: OTHER, name: 'Inbox' }]), answering(/entity_kind = 'actor'/, [{ identity_id: HANDLER, display_name: 'Asha' }]), answering(/FROM cb_entity|JOIN cb_entity/, [{ identity_id: OTHER, display_name: 'Branch', path: 'a.b' }])) } })
  ];
}

module.exports = { extras, ENT, SHOP, STRANGER_ID, OTHER };
