/**
 * actors-scenes.cjs — the named scenarios of tests/api-problem-actors.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 20 routes of routes/actors.js (the shop's people: add · edit · switch off · PIN and first code · cover and break · tasks and routing · settings),
 *           each with the stand-in rows it needs (answered by the shape of the statement, so the same facts meet old and new code), and the "universal" row of the foreign-id world.
 * CALLED BY tests/api-problem-actors.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url, after }] → the harness runs each one against the real route
 * CARD      17-people-employees-hr-and-payroll/functions
 * Sign-in (GET /check-login, POST /set-pin, POST /login) is here only to be RECORDED: the test replays what they answered before the sweep byte for byte and never judges their refusals (they are routes/signin.js's).
 */
'use strict';

const ACT = '/api/actors';
const SHOP = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const OTHER = '88888888-8888-4888-8888-888888888888';
const CHIT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PIN = '4821';

/** a person's row as the routes select them: every column any of the 20 routes reads, so one row meets every statement */
const PERSON_ROW = {
  identity_id: PERSON,
  bridge_id: 'AAAA1111',
  display_name: 'Ravi Kumar',
  actor_key: 'ravik',
  actor_role: 'cashier',
  actor_type: 'human',
  hat: 'act',
  break_status: 'active',
  break_type: null,
  break_started_at: null,
  return_date: null,
  max_tasks: 10,
  current_task_count: 0,
  phone: null,
  email: null,
  can_see_costs: false,
  delegate_actor_id: null,
  assigned_to_actor_id: null,
  actor_name: null,
  chit_id: CHIT,
  entity_id: SHOP,
  current_status: 'pending',
  pin_state: 'none'
};

/** the tools a scene is built from: the harness's own stand-ins, and the PIN hash the test made */
function extras(tools) {
  const { OWNER, STAFF, SECRET_SQL, answering, raising, firstOf, pinHash } = tools;
  const STRANGER = { identity_id: STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
  /** an actor session with no parent shop (what the owner gate lets through): the only way into PATCH's own "only the account owner" refusal */
  const ORPHAN_ACTOR = { identity_id: '44444444-4444-4444-8444-444444444444', identity_type: 'actor', access_level: 'editor', display_name: 'Test staff' };
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** a scenario for an answer the sweep ADDS (the schema's refusal): it is not frozen, since the old code answered it otherwise */
  const N = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const failing = { db: 'fail' };
  const at = (tail) => ACT + tail;
  const when = (pattern, run) => (sql, params) => (pattern.test(sql) ? run(sql, params) : null);
  const row = (pattern, one) => answering(pattern, [one || PERSON_ROW]);
  const rowsOf = (pattern, list) => answering(pattern, list);
  const sqlState = (code, message, more) => () => {
    throw Object.assign(new Error(message || 'pg ' + code), { code }, more);
  };
  const failOn = (pattern, code, message, more) => when(pattern, sqlState(code, message, more));
  /* the shop's person, found by any of the reads that name a person of this shop */
  const SOMEONE = row(/FROM identities\s+WHERE identity_id = \$1/, PERSON_ROW);
  const person = (more) => row(/FROM identities\s+WHERE identity_id = \$1/, Object.assign({}, PERSON_ROW, more));
  const own = (fn) => ({ sqlRows: fn });
  const T = (patchOf) => ({ patch: patchOf });
  /* a sealed environment: the first-code door refuses unless a sender is set up (503) or the person has an e-mail (400) */
  const sealed = (mailerReady) => ({
    empcode: {
      refusal: (to) => {
        const real = tools.realRefusal;
        const was = ['OTP_EMAIL_ENABLED', 'RESEND_API_KEY', 'FROM_EMAIL'].map((name) => [name, process.env[name]]);
        const sealedWas = tools.devOtp.isSealed;
        tools.devOtp.isSealed = () => true;
        if (mailerReady) Object.assign(process.env, { OTP_EMAIL_ENABLED: 'true', RESEND_API_KEY: 'x', FROM_EMAIL: 'a@example.com' });
        try {
          return real(to);
        } finally {
          tools.devOtp.isSealed = sealedWas;
          was.forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value)));
        }
      }
    }
  });
  const showsCode = { devotp: { mayExposeOtp: () => true } };
  const mailed = { notify: { sendOtpEmail: async () => ({ delivered: true }) } };
  const BODY_NEW = { display_name: 'Ravi Kumar', actor_key: 'ravik' };
  const ENTITY_ROW = row(/SELECT user_id, display_name, bridge_id FROM identities/, { user_id: 'shop-a', display_name: 'Shop A', bridge_id: 'SHOPAAAA' });
  const keyFree = null;
  const keyTaken = row(/FROM identities\s+WHERE actor_key = \$1/, { '?column?': 1 });
  const columnsThere = { schema: { hasColumn: async () => true } };

  /* ── sign-in (recorded, never judged: routes/signin.js owns their refusals) ── */
  const signin = [
    X('check-login-nothing-asked', 'GET ' + at('/check-login'), 200, {}),
    X('check-login-unknown', 'GET ' + at('/check-login'), 200, { url: at('/check-login?username=ghost@shop-a') }),
    X('check-login-found', 'GET ' + at('/check-login'), 200, { url: at('/check-login?username=ravik@shop-a'), setup: { sqlRows: SOMEONE } }),
    X('set-pin-short', 'POST ' + at('/set-pin'), 400, { body: { pin: '12', confirm_pin: '12' } }),
    X('set-pin-mismatch', 'POST ' + at('/set-pin'), 400, { body: { pin: '1234', confirm_pin: '4321' }, setup: { who: STAFF } }),
    X('set-pin-made', 'POST ' + at('/set-pin'), 200, { body: { pin: '1234', confirm_pin: '1234' }, setup: { who: STAFF } }),
    X('login-needs-a-name', 'POST ' + at('/login'), 400, { body: {} }),
    X('login-unknown-account', 'POST ' + at('/login'), 400, { body: { username: 'ghost@shop-a', otp: '123456' } }),
    X('login-short-code', 'POST ' + at('/login'), 400, { body: { username: 'ravik@shop-a', otp: '12' } })
  ];

  /* ── suggest-key and check-key ── */
  const keys = [
    X('suggest-made', 'POST ' + at('/suggest-key'), 200, { body: { display_name: 'Ravi Kumar' } }),
    X('suggest-one-word', 'POST ' + at('/suggest-key'), 200, { body: { display_name: 'Kavya' }, setup: { sqlRows: row(/SELECT user_id FROM identities/, { user_id: 'shop-a' }) } }),
    X('suggest-all-taken', 'POST ' + at('/suggest-key'), 200, { body: { display_name: 'Ravi Kumar' }, setup: { sqlRows: keyTaken } }),
    X('suggest-db-fails', 'POST ' + at('/suggest-key'), 500, { body: { display_name: 'Ravi Kumar' }, setup: failing }),
    X('check-key-free', 'POST ' + at('/check-key'), 200, { body: { actor_key: 'ravik' } }),
    X('check-key-taken', 'POST ' + at('/check-key'), 200, { body: { actor_key: 'ravik' }, setup: { sqlRows: keyTaken } }),
    X('check-key-unusable', 'POST ' + at('/check-key'), 400, { body: { actor_key: 'AB' } }),
    X('check-key-db-fails', 'POST ' + at('/check-key'), 500, { body: { actor_key: 'ravik' }, setup: failing })
  ];

  /* ── POST /api/actors: add a person ── */
  const create = [
    X('create-needs-a-name', 'POST ' + at(''), 400, { body: { actor_key: 'ravik' } }),
    X('create-bad-email', 'POST ' + at(''), 400, { body: { display_name: 'Ravi Kumar', actor_key: 'ravik', email: 'nope' } }),
    X('create-over-the-shops-ceiling', 'POST ' + at(''), 400, { body: Object.assign({ max_tasks: 50 }, BODY_NEW), patch: { schema: { hasTable: async () => true } }, setup: { sqlRows: row(/SELECT default_max_tasks FROM entity_actor_settings/, { default_max_tasks: 20 }) } }),
    X('create-under-the-ceiling', 'POST ' + at(''), 200, { body: Object.assign({ max_tasks: 5 }, BODY_NEW), patch: { schema: { hasTable: async () => true } }, setup: { sqlRows: firstOf(row(/SELECT default_max_tasks FROM entity_actor_settings/, { default_max_tasks: 20 }), ENTITY_ROW) } }),
    X('create-key-taken', 'POST ' + at(''), 400, { body: BODY_NEW, setup: { sqlRows: keyTaken } }),
    X('create-made', 'POST ' + at(''), 200, { body: BODY_NEW, setup: { sqlRows: ENTITY_ROW } }),
    X('create-made-with-a-level', 'POST ' + at(''), 200, { body: Object.assign({ access_level: 'viewer', whole_entity: true, phone: '9876543210', actor_role: 'cashier' }, BODY_NEW), patch: columnsThere, setup: { sqlRows: ENTITY_ROW } }),
    X('create-made-without-the-parent-row', 'POST ' + at(''), 200, { body: BODY_NEW }),
    X('create-made-and-mailed', 'POST ' + at(''), 200, { body: Object.assign({ email: 'Ravi@Example.com' }, BODY_NEW), patch: mailed, setup: { sqlRows: ENTITY_ROW } }),
    X('create-made-and-code-shown', 'POST ' + at(''), 200, { body: BODY_NEW, patch: showsCode, setup: { sqlRows: ENTITY_ROW } }),
    X('create-mail-not-sent', 'POST ' + at(''), 200, { body: Object.assign({ email: 'ravi@example.com' }, BODY_NEW), setup: { sqlRows: ENTITY_ROW } }),
    X('create-sealed-no-mailer', 'POST ' + at(''), 503, { body: BODY_NEW, patch: sealed(false), setup: { sqlRows: ENTITY_ROW } }),
    X('create-sealed-needs-an-email', 'POST ' + at(''), 400, { body: BODY_NEW, patch: sealed(true), setup: { sqlRows: ENTITY_ROW } }),
    X('create-email-is-taken', 'POST ' + at(''), 409, { body: Object.assign({ email: 'ravi@example.com' }, BODY_NEW), setup: { sqlRows: firstOf(ENTITY_ROW, failOn(/INSERT INTO identities/, '23505', 'duplicate', { constraint: 'identities_email_key' })) } }),
    X('create-key-is-taken-at-the-insert', 'POST ' + at(''), 409, { body: BODY_NEW, setup: { sqlRows: failOn(/INSERT INTO identities/, '23505', 'duplicate', { constraint: 'uq_actor_key_per_entity' }) } }),
    X('create-insert-fails', 'POST ' + at(''), 500, { body: BODY_NEW, setup: { sqlRows: failOn(/INSERT INTO identities/, 'XX000', SECRET_SQL) } }),
    X('create-staff-is-refused', 'POST ' + at(''), 403, { body: BODY_NEW, setup: { who: STAFF } })
  ];

  /* ── PATCH /api/actors/:id: edit a person ── */
  const edit = [
    X('edit-nothing-to-change', 'PATCH ' + at('/:id'), 400, { body: {} }),
    X('edit-name-too-short', 'PATCH ' + at('/:id'), 400, { body: { display_name: 'Z' } }),
    X('edit-over-the-shops-ceiling', 'PATCH ' + at('/:id'), 400, { body: { max_tasks: 50 }, patch: { schema: { hasTable: async () => true } }, setup: { sqlRows: row(/SELECT default_max_tasks FROM entity_actor_settings/, { default_max_tasks: 20 }) } }),
    X('edit-costs-by-an-actor', 'PATCH ' + at('/:id'), 403, { body: { can_see_costs: true }, setup: { who: ORPHAN_ACTOR } }),
    X('edit-unknown-person', 'PATCH ' + at('/:id'), 404, { body: { display_name: 'Ravi Kumar' } }),
    X('edit-made', 'PATCH ' + at('/:id'), 200, { body: { display_name: 'Ravi Kumar', actor_role: 'lead', phone: '9876543210', max_tasks: 8, email: 'Ravi@Example.com', hat: 'manager', can_see_costs: true }, setup: { sqlRows: row(/UPDATE identities SET display_name/, PERSON_ROW) } }),
    X('edit-level-moves-the-trail', 'PATCH ' + at('/:id'), 200, { body: { access_level: 'viewer', whole_entity: true, reason: ' re-grade ' }, patch: columnsThere, setup: { sqlRows: firstOf(row(/UPDATE identities SET access_level/, Object.assign({}, PERSON_ROW, { access_level: 'viewer', whole_entity: true })), row(/SELECT hat, can_see_costs, break_status/, Object.assign({}, PERSON_ROW, { access_level: 'editor', whole_entity: false }))) } }),
    X('edit-email-cleared', 'PATCH ' + at('/:id'), 200, { body: { email: '' }, setup: { sqlRows: row(/UPDATE identities SET email/, PERSON_ROW) } }),
    X('edit-email-is-taken', 'PATCH ' + at('/:id'), 409, { body: { email: 'ravi@example.com' }, setup: { sqlRows: failOn(/UPDATE identities SET/, '23505', 'duplicate', { constraint: 'identities_email_key' }) } }),
    X('edit-fails', 'PATCH ' + at('/:id'), 500, { body: { display_name: 'Ravi Kumar' }, setup: { sqlRows: failOn(/UPDATE identities SET/, 'XX000', SECRET_SQL) } }),
    N('edit-body-is-a-list', 'PATCH ' + at('/:id'), 400, { body: [] })
  ];

  /* ── change-pin, the PIN reset, the first-code re-issue ── */
  const NEW_PIN = { current_pin: PIN, new_pin: '7391', confirm_pin: '7391' };
  const pins = [
    X('change-pin-nothing-sent', 'PUT ' + at('/change-pin'), 400, { body: {} }),
    X('change-pin-not-the-same', 'PUT ' + at('/change-pin'), 400, { body: { current_pin: PIN, new_pin: '7391', confirm_pin: '1111' } }),
    X('change-pin-by-the-shop', 'PUT ' + at('/change-pin'), 400, { body: NEW_PIN }),
    X('change-pin-person-gone', 'PUT ' + at('/change-pin'), 404, { body: NEW_PIN, setup: { who: STAFF } }),
    X('change-pin-none-set', 'PUT ' + at('/change-pin'), 400, { body: NEW_PIN, setup: { who: STAFF, sqlRows: row(/SELECT pin_hash, pin_locked_at FROM identities/, { pin_hash: null, pin_locked_at: null }) } }),
    X('change-pin-wrong-current', 'PUT ' + at('/change-pin'), 400, { body: Object.assign({}, NEW_PIN, { current_pin: '0000' }), setup: { who: STAFF, sqlRows: row(/SELECT pin_hash, pin_locked_at FROM identities/, { pin_hash: pinHash, pin_locked_at: null }) } }),
    X('change-pin-made', 'PUT ' + at('/change-pin'), 200, { body: NEW_PIN, setup: { who: STAFF, sqlRows: row(/SELECT pin_hash, pin_locked_at FROM identities/, { pin_hash: pinHash, pin_locked_at: null }) } }),
    X('change-pin-fails', 'PUT ' + at('/change-pin'), 500, { body: NEW_PIN, setup: { who: STAFF, sqlRows: failOn(/SELECT pin_hash/, 'XX000', SECRET_SQL) } }),
    X('pin-reset-made', 'DELETE ' + at('/:id/pin'), 200, { setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status FROM identities/, PERSON_ROW) } }),
    X('pin-reset-made-and-mailed', 'DELETE ' + at('/:id/pin'), 200, { patch: mailed, setup: { sqlRows: firstOf(row(/SELECT email FROM identities/, { email: 'ravi@example.com' }), row(/SELECT identity_id, display_name, actor_key, break_status FROM identities/, PERSON_ROW)) } }),
    X('pin-reset-code-shown', 'DELETE ' + at('/:id/pin'), 200, { patch: showsCode, setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status FROM identities/, PERSON_ROW) } }),
    X('pin-reset-sealed-no-mailer', 'DELETE ' + at('/:id/pin'), 503, { patch: sealed(false), setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status FROM identities/, PERSON_ROW) } }),
    X('pin-reset-sealed-needs-an-email', 'DELETE ' + at('/:id/pin'), 400, { patch: sealed(true), setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status FROM identities/, PERSON_ROW) } }),
    X('pin-reset-fails', 'DELETE ' + at('/:id/pin'), 500, { setup: { sqlRows: firstOf(row(/SELECT identity_id, display_name, actor_key, break_status FROM identities/, PERSON_ROW), failOn(/UPDATE identities/, 'XX000', SECRET_SQL)) } }),
    X('otp-made', 'POST ' + at('/:id/otp'), 200, { setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status\s+FROM identities/, PERSON_ROW) } }),
    X('otp-made-and-mailed', 'POST ' + at('/:id/otp'), 200, { patch: mailed, setup: { sqlRows: firstOf(row(/SELECT email FROM identities/, { email: 'ravi@example.com' }), row(/SELECT identity_id, display_name, actor_key, break_status\s+FROM identities/, PERSON_ROW)) } }),
    X('otp-code-shown', 'POST ' + at('/:id/otp'), 200, { patch: showsCode, setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status\s+FROM identities/, PERSON_ROW) } }),
    X('otp-sealed-no-mailer', 'POST ' + at('/:id/otp'), 503, { patch: sealed(false), setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status\s+FROM identities/, PERSON_ROW) } }),
    X('otp-sealed-needs-an-email', 'POST ' + at('/:id/otp'), 400, { patch: sealed(true), setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status\s+FROM identities/, PERSON_ROW) } }),
    X('otp-fails', 'POST ' + at('/:id/otp'), 500, { setup: { sqlRows: firstOf(row(/SELECT identity_id, display_name, actor_key, break_status\s+FROM identities/, PERSON_ROW), failOn(/UPDATE identities/, 'XX000', SECRET_SQL)) } }),
    X('otp-body-is-a-list', 'POST ' + at('/:id/otp'), 200, { body: [], setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key, break_status\s+FROM identities/, PERSON_ROW) } })
  ];

  /* ── GET /api/actors ── */
  const list = [
    X('list-made', 'GET ' + at(''), 200, { setup: { sqlRows: firstOf(rowsOf(/SELECT\s+break_status,\s+COUNT/, [{ break_status: 'active', count: '2' }, { break_status: 'leave', count: '1' }, { break_status: 'removed', count: '1' }]), rowsOf(/SELECT\s+identity_id, bridge_id/, [PERSON_ROW])) } }),
    X('list-everyone-of-a-type', 'GET ' + at(''), 200, { url: at('?status=all&type=human'), setup: { sqlRows: rowsOf(/SELECT\s+identity_id, bridge_id/, [PERSON_ROW]) } }),
    X('list-away', 'GET ' + at(''), 200, { url: at('?status=leave') }),
    X('list-switched-off', 'GET ' + at(''), 200, { url: at('?status=inactive') }),
    X('list-removed', 'GET ' + at(''), 200, { url: at('?status=removed') }),
    X('list-one-page', 'GET ' + at(''), 200, { url: at('?page=2&limit=1'), setup: { sqlRows: rowsOf(/SELECT\s+identity_id, bridge_id/, [PERSON_ROW, PERSON_ROW, PERSON_ROW]) } }),
    X('list-db-fails', 'GET ' + at(''), 500, { setup: failing })
  ];

  /* ── PUT /api/actors/:id/status: switch off · remove · switch on (a mode switch: flagged, not split) ── */
  const THREE_TASKS = row(/SELECT identity_id, display_name, actor_key,\s+break_status, current_task_count, delegate_actor_id/, Object.assign({}, PERSON_ROW, { current_task_count: 3 }));
  const SHOP_FLAGS = row(/SELECT policy_flags FROM identities/, { policy_flags: {} });
  const NO_TASKS = row(/SELECT identity_id, display_name, actor_key,\s+break_status, current_task_count, delegate_actor_id/, PERSON_ROW);
  const status = [
    X('status-unknown-action', 'PUT ' + at('/:id/status'), 400, { body: { action: 'banish' } }),
    X('status-bad-confirm', 'PUT ' + at('/:id/status'), 400, { body: { action: 'remove', confirm: 'yes' } }),
    X('status-bad-target-id', 'PUT ' + at('/:id/status'), 400, { body: { action: 'deactivate', target_actor_id: 'nope' } }),
    X('status-unknown-person', 'PUT ' + at('/:id/status'), 404, { body: { action: 'deactivate' } }),
    X('status-remove-not-confirmed', 'PUT ' + at('/:id/status'), 400, { body: { action: 'remove' }, setup: { sqlRows: THREE_TASKS } }),
    X('status-remove-not-confirmed-no-tasks', 'PUT ' + at('/:id/status'), 400, { body: { action: 'remove' }, setup: { sqlRows: NO_TASKS } }),
    X('status-tasks-must-be-routed', 'PUT ' + at('/:id/status'), 400, { body: { action: 'deactivate' }, setup: { sqlRows: THREE_TASKS } }),
    X('status-target-required', 'PUT ' + at('/:id/status'), 400, { body: { action: 'deactivate', task_action: 'actor' }, setup: { sqlRows: THREE_TASKS } }),
    X('status-target-not-active', 'PUT ' + at('/:id/status'), 400, { body: { action: 'deactivate', task_action: 'actor', target_actor_id: OTHER }, setup: { sqlRows: THREE_TASKS } }),
    X('status-switched-off', 'PUT ' + at('/:id/status'), 200, { body: { action: 'deactivate', return_date: '2026-11-01' }, setup: { sqlRows: firstOf(SHOP_FLAGS, NO_TASKS) } }),
    X('status-switched-off-tasks-to-the-pool', 'PUT ' + at('/:id/status'), 200, { body: { action: 'deactivate', task_action: 'pool' }, setup: { sqlRows: firstOf(SHOP_FLAGS, THREE_TASKS) } }),
    X('status-switched-off-tasks-to-a-colleague', 'PUT ' + at('/:id/status'), 200, { body: { action: 'deactivate', task_action: 'actor', target_actor_id: OTHER }, setup: { sqlRows: firstOf(row(/SELECT identity_id, display_name FROM identities\s+WHERE identity_id = \$1 AND parent_entity_id = \$2 AND break_status = 'active'/, { identity_id: OTHER, display_name: 'Meena' }), THREE_TASKS, SHOP_FLAGS) } }),
    X('status-removed', 'PUT ' + at('/:id/status'), 200, { body: { action: 'remove', confirm: 'REMOVE' }, setup: { sqlRows: firstOf(SHOP_FLAGS, NO_TASKS) } }),
    X('status-switched-on', 'PUT ' + at('/:id/status'), 200, { body: { action: 'reactivate' }, setup: { sqlRows: NO_TASKS } }),
    X('status-switched-on-code-shown', 'PUT ' + at('/:id/status'), 200, { body: { action: 'reactivate' }, patch: showsCode, setup: { sqlRows: NO_TASKS } }),
    X('status-switched-on-sealed-no-mailer', 'PUT ' + at('/:id/status'), 503, { body: { action: 'reactivate' }, patch: sealed(false), setup: { sqlRows: NO_TASKS } }),
    X('status-switched-on-sealed-needs-an-email', 'PUT ' + at('/:id/status'), 400, { body: { action: 'reactivate' }, patch: sealed(true), setup: { sqlRows: NO_TASKS } }),
    X('status-fails', 'PUT ' + at('/:id/status'), 500, { body: { action: 'deactivate' }, setup: { sqlRows: firstOf(SHOP_FLAGS, NO_TASKS, failOn(/SET break_status = 'deactivated'/, 'XX000', SECRET_SQL)) } })
  ];

  /* ── PUT /api/actors/break ── */
  const SELF = row(/SELECT identity_id, display_name, break_status FROM identities/, PERSON_ROW);
  const AWAY_STAFF = { who: STAFF, sqlRows: SELF };
  const OPEN = (count) => row(/SELECT COUNT\(\*\) as count FROM chit_status/, { count: String(count) });
  const break_ = [
    X('break-unknown-kind', 'PUT ' + at('/break'), 400, { body: { break_type: 'holiday' } }),
    X('break-bad-target-id', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave', target_actor_id: 'nope' } }),
    X('break-name-the-person', 'PUT ' + at('/break'), 400, { body: { break_type: 'short_break' } }),
    X('break-person-not-in-the-shop', 'PUT ' + at('/break'), 404, { body: { break_type: 'short_break', actor_id: OTHER } }),
    X('break-the-owner-names-someone-removed', 'PUT ' + at('/break'), 404, { body: { break_type: 'short_break', actor_id: OTHER }, setup: { sqlRows: person({ break_status: 'removed' }) } }),
    X('break-someone-is-switched-off', 'PUT ' + at('/break'), 400, { body: { break_type: 'short_break', actor_id: OTHER }, setup: { sqlRows: person({ break_status: 'deactivated' }) } }),
    X('break-staff-names-someone-else', 'PUT ' + at('/break'), 403, { body: { break_type: 'short_break', actor_id: OTHER }, setup: { who: STAFF } }),
    X('break-covers-someone-away', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave' }, setup: { who: STAFF, sqlRows: firstOf(row(/SELECT display_name FROM identities WHERE delegate_actor_id/, { display_name: 'Meena' }), SELF) } }),
    X('break-covers-two-away', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave' }, setup: { who: STAFF, sqlRows: firstOf(rowsOf(/SELECT display_name FROM identities WHERE delegate_actor_id/, [{ display_name: 'Meena' }, { display_name: 'Latha' }]), SELF) } }),
    X('break-the-owner-puts-someone-away-who-covers', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave', actor_id: PERSON }, setup: { sqlRows: firstOf(row(/SELECT display_name FROM identities WHERE delegate_actor_id/, { display_name: 'Meena' }), SELF) } }),
    X('break-own-cover-is-away', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave' }, setup: { who: STAFF, sqlRows: firstOf(row(/SELECT delegate_actor_id FROM identities/, { delegate_actor_id: OTHER }), row(/SELECT display_name, break_status FROM identities/, { display_name: 'Meena', break_status: 'leave' }), SELF) } }),
    X('break-their-cover-is-away', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave', actor_id: PERSON }, setup: { sqlRows: firstOf(row(/SELECT delegate_actor_id FROM identities/, { delegate_actor_id: OTHER }), row(/SELECT display_name, break_status FROM identities/, { display_name: 'Meena', break_status: 'short_break' }), SELF) } }),
    X('break-own-cover-is-there', 'PUT ' + at('/break'), 200, { body: { break_type: 'short_break' }, setup: { who: STAFF, sqlRows: firstOf(row(/SELECT delegate_actor_id FROM identities/, { delegate_actor_id: OTHER }), row(/SELECT display_name, break_status FROM identities/, { display_name: 'Meena', break_status: 'active' }), SELF) } }),
    X('break-short', 'PUT ' + at('/break'), 200, { body: { break_type: 'short_break' }, setup: AWAY_STAFF }),
    X('break-short-for-someone', 'PUT ' + at('/break'), 200, { body: { break_type: 'short_break', actor_id: PERSON }, setup: { sqlRows: SELF } }),
    X('break-ended', 'PUT ' + at('/break'), 200, { body: { break_type: 'end_break' }, setup: { who: STAFF, sqlRows: row(/SELECT identity_id, display_name, break_status FROM identities/, Object.assign({}, PERSON_ROW, { break_status: 'leave' })) } }),
    X('break-ended-for-someone', 'PUT ' + at('/break'), 200, { body: { break_type: 'end_break', actor_id: PERSON }, setup: { sqlRows: row(/SELECT identity_id, display_name, break_status FROM identities/, Object.assign({}, PERSON_ROW, { break_status: 'short_break' })) } }),
    X('break-leave-no-open-tasks', 'PUT ' + at('/break'), 200, { body: { break_type: 'leave' }, setup: { who: STAFF, sqlRows: firstOf(OPEN(0), SELF) } }),
    X('break-leave-tasks-must-be-routed', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave' }, setup: { who: STAFF, sqlRows: firstOf(OPEN(2), SELF) } }),
    X('break-leave-tasks-must-be-routed-for-someone', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave', actor_id: PERSON }, setup: { sqlRows: firstOf(OPEN(2), SELF) } }),
    X('break-leave-target-required', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave', task_action: 'actor' }, setup: { who: STAFF, sqlRows: firstOf(OPEN(2), SELF) } }),
    X('break-leave-target-not-active', 'PUT ' + at('/break'), 400, { body: { break_type: 'leave', task_action: 'actor', target_actor_id: OTHER }, setup: { who: STAFF, sqlRows: firstOf(OPEN(2), SELF) } }),
    X('break-leave-tasks-to-the-pool', 'PUT ' + at('/break'), 200, { body: { break_type: 'leave', task_action: 'pool' }, setup: { who: STAFF, sqlRows: firstOf(OPEN(2), SELF) } }),
    X('break-leave-tasks-to-a-colleague', 'PUT ' + at('/break'), 200, { body: { break_type: 'leave', task_action: 'actor', target_actor_id: OTHER }, setup: { who: STAFF, sqlRows: firstOf(row(/SELECT identity_id, display_name FROM identities\s+WHERE identity_id = \$1 AND parent_entity_id = \$2 AND identity_id <> \$3/, { identity_id: OTHER, display_name: 'Meena' }), OPEN(2), SELF) } }),
    X('break-fails', 'PUT ' + at('/break'), 500, { body: { break_type: 'short_break' }, setup: { who: STAFF, sqlRows: firstOf(SELF, failOn(/SET break_status = 'short_break'/, 'XX000', SECRET_SQL)) } })
  ];

  /* ── PUT /api/actors/assign/:chit_id: pull · push · return (a mode switch: flagged, not split) ── */
  const CHIT_ROW = (more) => row(/SELECT cs\.\*, i\.display_name as actor_name/, Object.assign({}, PERSON_ROW, more));
  const TARGET = row(/SELECT identity_id, display_name, current_task_count, max_tasks\s+FROM identities/, { identity_id: OTHER, display_name: 'Meena', current_task_count: 0, max_tasks: 10 });
  const assign = [
    X('assign-unknown-action', 'PUT ' + at('/assign/:chit_id'), 400, { body: { action: 'steal' } }),
    X('assign-bad-target-id', 'PUT ' + at('/assign/:chit_id'), 400, { body: { action: 'push', target_actor_id: 'nope' } }),
    X('assign-chit-not-found', 'PUT ' + at('/assign/:chit_id'), 404, { body: { action: 'pull' } }),
    X('assign-pull-already-held', 'PUT ' + at('/assign/:chit_id'), 400, { body: { action: 'pull' }, setup: { sqlRows: CHIT_ROW({ assigned_to_actor_id: OTHER, actor_name: 'Meena' }) } }),
    X('assign-pull-made', 'PUT ' + at('/assign/:chit_id'), 200, { body: { action: 'pull' }, setup: { who: STAFF, sqlRows: CHIT_ROW({ assigned_to_actor_id: null }) } }),
    X('assign-push-needs-a-target', 'PUT ' + at('/assign/:chit_id'), 400, { body: { action: 'push' }, setup: { sqlRows: CHIT_ROW({}) } }),
    X('assign-push-target-not-active', 'PUT ' + at('/assign/:chit_id'), 400, { body: { action: 'push', target_actor_id: OTHER }, setup: { sqlRows: CHIT_ROW({}) } }),
    X('assign-push-made', 'PUT ' + at('/assign/:chit_id'), 200, { body: { action: 'push', target_actor_id: OTHER }, setup: { sqlRows: firstOf(TARGET, CHIT_ROW({})) } }),
    X('assign-push-transfer-to-someone-full', 'PUT ' + at('/assign/:chit_id'), 200, { body: { action: 'push', target_actor_id: OTHER }, setup: { sqlRows: firstOf(row(/SELECT identity_id, display_name, current_task_count, max_tasks\s+FROM identities/, { identity_id: OTHER, display_name: 'Meena', current_task_count: 10, max_tasks: 10 }), CHIT_ROW({ assigned_to_actor_id: PERSON, actor_name: 'Ravi Kumar' })) } }),
    X('assign-return-made', 'PUT ' + at('/assign/:chit_id'), 200, { body: { action: 'return' }, setup: { sqlRows: CHIT_ROW({ assigned_to_actor_id: PERSON, actor_name: 'Ravi Kumar' }) } }),
    X('assign-return-from-the-pool', 'PUT ' + at('/assign/:chit_id'), 200, { body: { action: 'return' }, setup: { sqlRows: CHIT_ROW({}) } }),
    X('assign-fails', 'PUT ' + at('/assign/:chit_id'), 500, { body: { action: 'return' }, setup: { sqlRows: firstOf(CHIT_ROW({}), failOn(/INSERT INTO state_log/, 'XX000', SECRET_SQL)) } })
  ];

  /* ── settings ── */
  const SETTINGS = { entity_id: SHOP, assignment_model: 'both', default_max_tasks: 10, all_task_visible: false, auto_return_on_short_break: false, auto_assign_mode: 'off', default_assignee_actor_id: null };
  const settings = [
    X('settings-read', 'GET ' + at('/settings'), 200, { setup: { sqlRows: row(/SELECT \* FROM entity_actor_settings/, SETTINGS) } }),
    X('settings-read-first-time', 'GET ' + at('/settings'), 200, { setup: { sqlRows: row(/INSERT INTO entity_actor_settings/, SETTINGS) } }),
    X('settings-read-by-staff', 'GET ' + at('/settings'), 200, { setup: { who: STAFF, sqlRows: row(/SELECT \* FROM entity_actor_settings/, SETTINGS) } }),
    X('settings-read-fails', 'GET ' + at('/settings'), 500, { setup: failing }),
    X('settings-bad-model', 'PUT ' + at('/settings'), 400, { body: { assignment_model: 'lottery' } }),
    X('settings-bad-ceiling', 'PUT ' + at('/settings'), 400, { body: { default_max_tasks: 500 } }),
    X('settings-bad-assignee-id', 'PUT ' + at('/settings'), 400, { body: { default_assignee_actor_id: 'nope' } }),
    X('settings-assignee-not-assignable', 'PUT ' + at('/settings'), 400, { body: { default_assignee_actor_id: OTHER } }),
    X('settings-saved', 'PUT ' + at('/settings'), 200, { body: { assignment_model: 'pull', default_max_tasks: 12, all_task_visible: true, auto_return_on_short_break: true, auto_assign_mode: 'least_loaded' }, setup: { sqlRows: row(/SELECT \* FROM entity_actor_settings/, SETTINGS) } }),
    X('settings-saved-with-an-assignee', 'PUT ' + at('/settings'), 200, { body: { auto_assign_mode: 'default_assignee', default_assignee_actor_id: OTHER }, setup: { sqlRows: firstOf(row(/SELECT 1 FROM identities WHERE identity_id/, { '?column?': 1 }), row(/SELECT \* FROM entity_actor_settings/, SETTINGS)) } }),
    X('settings-assignee-cleared', 'PUT ' + at('/settings'), 200, { body: { default_assignee_actor_id: null }, setup: { sqlRows: row(/SELECT \* FROM entity_actor_settings/, SETTINGS) } }),
    X('settings-save-fails', 'PUT ' + at('/settings'), 500, { body: { assignment_model: 'pull' }, setup: failing }),
    X('settings-staff-is-refused', 'PUT ' + at('/settings'), 403, { body: { assignment_model: 'pull' }, setup: { who: STAFF } }),
    N('settings-body-is-a-list', 'PUT ' + at('/settings'), 400, { body: [], setup: { sqlRows: row(/SELECT \* FROM entity_actor_settings/, SETTINGS) } })
  ];

  /* ── PUT /:id/delegate ── */
  const delegate = [
    X('delegate-bad-id', 'PUT ' + at('/:id/delegate'), 400, { body: { delegate_actor_id: 'nope' } }),
    X('delegate-to-themselves', 'PUT ' + at('/:id/delegate'), 400, { body: { delegate_actor_id: PERSON } }),
    X('delegate-not-assignable', 'PUT ' + at('/:id/delegate'), 400, { body: { delegate_actor_id: OTHER } }),
    X('delegate-unknown-person', 'PUT ' + at('/:id/delegate'), 404, { body: {} }),
    X('delegate-set', 'PUT ' + at('/:id/delegate'), 200, { body: { delegate_actor_id: OTHER }, setup: { sqlRows: firstOf(row(/SELECT delegate_actor_id FROM identities/, { delegate_actor_id: null }), row(/UPDATE identities SET delegate_actor_id/, PERSON_ROW)) } }),
    X('delegate-cleared', 'PUT ' + at('/:id/delegate'), 200, { body: { delegate_actor_id: null }, setup: { sqlRows: row(/UPDATE identities SET delegate_actor_id/, PERSON_ROW) } }),
    X('delegate-fails', 'PUT ' + at('/:id/delegate'), 500, { body: {}, setup: failing }),
    X('delegate-staff-is-refused', 'PUT ' + at('/:id/delegate'), 403, { body: {}, setup: { who: STAFF } }),
    N('delegate-body-is-a-list', 'PUT ' + at('/:id/delegate'), 400, { body: [], setup: { sqlRows: row(/UPDATE identities SET delegate_actor_id/, PERSON_ROW) } })
  ];

  /* ── GET /:id/tasks, PUT /:id/tasks/route, GET /access-events ── */
  const TASK = { chit_id: CHIT, current_status: 'pending', assigned_at: '2026-10-20T10:00:00.000Z', assignment_type: 'pull', read_at: null, auto_subject: 'Order 12', purpose: 'order', created_at: '2026-10-20T09:00:00.000Z', sender_entity_display_name: 'Shop B' };
  const tasks = [
    X('tasks-unknown-person', 'GET ' + at('/:id/tasks'), 404, {}),
    X('tasks-listed', 'GET ' + at('/:id/tasks'), 200, { setup: { sqlRows: firstOf(rowsOf(/FROM chit_status cs\s+JOIN chit_header/, [TASK, TASK]), row(/SELECT identity_id, display_name, actor_key,\s+break_status, current_task_count, max_tasks/, PERSON_ROW)) } }),
    X('tasks-listed-one-page', 'GET ' + at('/:id/tasks'), 200, { url: at('/' + PERSON + '/tasks?page=2&limit=1'), setup: { sqlRows: firstOf(rowsOf(/FROM chit_status cs\s+JOIN chit_header/, [TASK, TASK]), row(/SELECT identity_id, display_name, actor_key,\s+break_status, current_task_count, max_tasks/, PERSON_ROW)) } }),
    X('tasks-fails', 'GET ' + at('/:id/tasks'), 500, { setup: failing }),
    N('tasks-page-asked-twice', 'GET ' + at('/:id/tasks'), 400, { url: at('/' + PERSON + '/tasks?page=1&page=2'), setup: { sqlRows: row(/SELECT identity_id, display_name, actor_key,\s+break_status, current_task_count, max_tasks/, PERSON_ROW) } }),
    X('route-needs-both', 'PUT ' + at('/:id/tasks/route'), 400, { body: { chit_id: CHIT } }),
    X('route-task-not-found', 'PUT ' + at('/:id/tasks/route'), 404, { body: { chit_id: CHIT, action: 'pool' } }),
    X('route-to-the-pool', 'PUT ' + at('/:id/tasks/route'), 200, { body: { chit_id: CHIT, action: 'pool' }, setup: { sqlRows: row(/SELECT chit_id, assigned_to_actor_id\s+FROM chit_status/, PERSON_ROW) } }),
    X('route-to-a-colleague', 'PUT ' + at('/:id/tasks/route'), 200, { body: { chit_id: CHIT, action: 'push', to_actor_id: OTHER }, setup: { sqlRows: firstOf(TARGET, row(/SELECT chit_id, assigned_to_actor_id\s+FROM chit_status/, PERSON_ROW)) } }),
    X('route-colleague-not-active', 'PUT ' + at('/:id/tasks/route'), 400, { body: { chit_id: CHIT, action: 'push', to_actor_id: OTHER }, setup: { sqlRows: row(/SELECT chit_id, assigned_to_actor_id\s+FROM chit_status/, PERSON_ROW) } }),
    X('route-push-without-a-colleague', 'PUT ' + at('/:id/tasks/route'), 400, { body: { chit_id: CHIT, action: 'push' }, setup: { sqlRows: row(/SELECT chit_id, assigned_to_actor_id\s+FROM chit_status/, PERSON_ROW) } }),
    X('route-unknown-action', 'PUT ' + at('/:id/tasks/route'), 400, { body: { chit_id: CHIT, action: 'bury' }, setup: { sqlRows: row(/SELECT chit_id, assigned_to_actor_id\s+FROM chit_status/, PERSON_ROW) } }),
    X('route-fails', 'PUT ' + at('/:id/tasks/route'), 500, { body: { chit_id: CHIT, action: 'pool' }, setup: failing }),
    X('route-staff-is-refused', 'PUT ' + at('/:id/tasks/route'), 403, { body: { chit_id: CHIT, action: 'pool' }, setup: { who: STAFF } }),
    N('route-body-is-a-list', 'PUT ' + at('/:id/tasks/route'), 400, { body: [] }),
    X('events-listed', 'GET ' + at('/access-events'), 200, { setup: { sqlRows: rowsOf(/FROM access_events e/, [{ event_id: 1, subject_identity_id: PERSON, subject_name: 'Ravi Kumar', actor_key: 'ravik', action: 'hat_changed', before_value: '{}', after_value: '{}', reason: null, at: '2026-10-20T10:00:00.000Z', changed_by: SHOP, changed_by_name: 'Shop A' }]) } }),
    X('events-of-one-person', 'GET ' + at('/access-events'), 200, { url: at('/access-events?subject=' + PERSON + '&page=1&limit=5') }),
    X('events-table-not-there-yet', 'GET ' + at('/access-events'), 200, { setup: { sqlRows: failOn(/FROM access_events e/, '42P01', 'relation "access_events" does not exist') } }),
    X('events-fail', 'GET ' + at('/access-events'), 500, { setup: failing })
  ];

  return [].concat(signin, keys, create, edit, pins, list, status, break_, assign, settings, delegate, tasks);
}

/**
 * universal(planted) — the stand-in db of the foreign-id world. Shop A's person (and chit) is planted for shop A only: a statement that names the record answers it unless it ALSO names a shop that is not A
 * (as RLS and `WHERE entity_id = $1` would). A stranger (shop B) asking for the record finds nothing; a statement that names the record and NO shop at all would answer the record to anyone, which is a leak the world shows.
 */
function universal(planted) {
  return (sql, params) => {
    const ids = params || [];
    if (!planted) return null;
    const shops = ids.filter((one) => one === SHOP || one === STRANGER_ID);
    if (!(ids.includes(PERSON) || ids.includes(SHOP)) || (shops.length && !shops.includes(SHOP))) return null;
    if (/SELECT COUNT\(\*\) as count/.test(sql)) return { rows: [{ count: '0' }], rowCount: 1 };
    return { rows: [PERSON_ROW], rowCount: 1 };
  };
}

/** PUT /:id/tasks/route reads the chit of the CALLER (the person in the path is never looked up): the caller's chit is there whoever the person is */
function chitOfTheCaller() {
  return (sql) => (/FROM chit_status/.test(sql) ? { rows: [PERSON_ROW], rowCount: 1 } : null);
}

module.exports = { extras, universal, chitOfTheCaller, STRANGER_ID, OTHER, PERSON, CHIT, PIN, SHOP };
