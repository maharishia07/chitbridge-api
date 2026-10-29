/**
 * bell-scenes.cjs — the named scenarios of tests/api-problem-bell.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a stream opened with a ticket, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 6 routes of the bell (routes/events.js: ticket, stream, stats; routes/notifications.js: the feed and its badge, seen, dismiss), each with the stand-in
 *           rows it needs, answered by the SHAPE of the statement so the same facts meet the old code and the new. Also the stand-in of `notif_dismissed` (a table with NO foreign key: any uuid inserts).
 * CALLED BY tests/api-problem-bell.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, body, url, headers, mint, until, patch }] → the harness runs each one against the real route file
 * CARD      22-channels-capture-and-messaging/notifications-and-the-bell
 * Every name below is an obviously made-up shop or order; there is no person's data in this file. A scene that opens a stream says `until`: the harness closes the socket after those frames.
 */
'use strict';

const EV = '/api/events';
const NO = '/api/notifications';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const LOG_A = '99999999-9999-4999-8999-999999999999';
const LOG_B = '98989898-9898-4898-8898-989898989898';
const JUNK_LOG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_SHOPS_LOG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHIT = '77777777-7777-4777-8777-777777777777';
const SEEN_AT = '2026-10-01T00:00:00.000Z';
const NOW = '2026-10-03T10:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const row = (more) => Object.assign({ log_id: LOG_A, chit_id: CHIT, action: 'accepted', action_by_display_name: 'Corner Hardware', new_status: 'accepted', detail: 'Order accepted', created_at: '2026-10-02T09:00:00.000Z', direction: 'received', assigned_to_actor_id: null, auto_subject: 'Order 12', manual_subject: null, purpose: 'order', total_value: '420', currency_code: 'INR', order_channel: null, order_fulfilment: null, assigned_to_me: false, dispute_for_me: false }, more);
const FEED = [row(), row({ log_id: LOG_B, action: 'message_sent', detail: 'A message', created_at: '2026-10-02T10:00:00.000Z' }), row({ log_id: OTHER_SHOPS_LOG, action: 'dispute_raised', detail: 'Short delivery', created_at: '2026-09-30T08:00:00.000Z' })];

/** the stand-in of INSERT INTO notif_dismissed: there is no foreign key to state_log (b164), so ANY uuid inserts under the caller's shop; a value that is not a uuid is Postgres 22P02; `visible` = the rows of the all-branch */
const dismissing = (visible, sqlError) => (sql, params) => {
  if (!/INSERT INTO notif_dismissed/.test(sql)) return null;
  if (!/unnest\(\$2::uuid\[\]\)/.test(sql)) return { rows: [], rowCount: visible };
  const ids = params[1];
  if (!Array.isArray(ids) || ids.some((one) => !UUID.test(String(one)))) throw sqlError('22P02');
  return { rows: [], rowCount: new Set(ids.map((one) => String(one).toLowerCase())).size };
};

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { STAFF, SECRET_SQL, answering, raising, firstOf, sqlError, noRoot } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const failing = { db: 'fail' };
  const sink = () => { throw new Error(SECRET_SQL); };
  const events = (name, fn) => ({ patch: { events: { [name]: fn } } });
  const NOBODY = { identity_type: 'entity', display_name: 'A login that names no shop' };
  const STRANGER = { identity_id: STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };

  /* the statements the feed runs, answered by their shape */
  const feedRows = answering(/SELECT \* FROM \(\s+SELECT DISTINCT ON/, FEED);
  const badge = (one) => answering(/WITH me AS/, [one]);
  const seenRead = (when) => answering(/^SELECT to_jsonb\(i\)->>'notif_seen_at' AS seen FROM identities i/, [{ seen: when }]);
  const handler = answering(/dispute_handler_actor_id/, [{ dispute_handler_actor_id: STAFF.identity_id }]);
  const marked = answering(/notif_mark_seen\(\)/, [{ at: NOW }]);
  const feed = (when) => firstOf(handler, feedRows, seenRead(when));
  const dismiss = (visible) => dismissing(visible, sqlError);
  const ticketed = (entity, opts) => ({ ticket: 'T-' + entity + (opts && opts.screen ? '-screen' : '-shop'), ttl_s: 60 });

  const tickets = [
    X('ticket-issued', 'POST ' + EV + '/ticket', 200, events('ticketFor', ticketed)),
    X('ticket-for-staff', 'POST ' + EV + '/ticket', 200, Object.assign({ setup: { who: STAFF } }, events('ticketFor', ticketed))),
    X('ticket-for-a-screen-key', 'POST ' + EV + '/ticket', 200, Object.assign({ headers: { 'x-test-screen': '1' } }, events('ticketFor', ticketed))),
    X('ticket-body-a-list', 'POST ' + EV + '/ticket', 200, Object.assign({ body: [] }, events('ticketFor', ticketed))),
    X('ticket-body-is-never-read', 'POST ' + EV + '/ticket', 200, Object.assign({ body: { screen: true, entity_id: STRANGER_ID } }, events('ticketFor', ticketed))),
    X('ticket-login-names-no-shop', 'POST ' + EV + '/ticket', 401, { setup: { who: NOBODY } }),
    X('ticket-throws-leaks-nothing', 'POST ' + EV + '/ticket', 500, events('ticketFor', sink))
  ];

  const streams = [
    X('stream-no-ticket', 'GET ' + EV + '/stream', 401, {}),
    X('stream-unknown-t', 'GET ' + EV + '/stream', 401, { url: EV + '/stream?t=nope' }),
    X('stream-unknown-ticket', 'GET ' + EV + '/stream', 401, { url: EV + '/stream?ticket=nope' }),
    X('stream-t-asked-twice', 'GET ' + EV + '/stream', 401, { url: EV + '/stream?t=a&t=b' }),
    X('stream-empty-t', 'GET ' + EV + '/stream', 401, { url: EV + '/stream?t=' }),
    X('stream-opened-with-t', 'GET ' + EV + '/stream', 200, { url: EV + '/stream?t={TICKET}', mint: 'shop', until: 'event: hello' }),
    X('stream-opened-with-ticket', 'GET ' + EV + '/stream', 200, { url: EV + '/stream?ticket={TICKET}', mint: 'shop', until: 'event: hello' }),
    X('stream-opened-for-a-screen', 'GET ' + EV + '/stream', 200, { url: EV + '/stream?t={TICKET}', mint: 'screen', until: 'event: hello' }),
    X('stream-t-wins-over-ticket', 'GET ' + EV + '/stream', 200, { url: EV + '/stream?t={TICKET}&ticket=nope', mint: 'shop', until: 'event: hello' }),
    X('stream-empty-t-falls-to-ticket', 'GET ' + EV + '/stream', 200, { url: EV + '/stream?t=&ticket={TICKET}', mint: 'shop', until: 'event: hello' }),
    X('stream-bad-t-beats-good-ticket', 'GET ' + EV + '/stream', 401, { url: EV + '/stream?t=nope&ticket={TICKET}', mint: 'shop' }),
    X('stream-subscribe-throws-leaks-nothing', 'GET ' + EV + '/stream', 500, Object.assign({ url: EV + '/stream?t={TICKET}', mint: 'shop' }, events('subscribe', sink)))
  ];

  const stats = [
    X('stats-root', 'GET ' + EV + '/stats', 200, events('stats', () => ({ entities: 2, connections: 3, tickets: 1 }))),
    X('stats-staff-of-root', 'GET ' + EV + '/stats', 200, Object.assign({ setup: { who: STAFF } }, events('stats', () => ({ entities: 2, connections: 3, tickets: 1 })))),
    X('stats-another-shop', 'GET ' + EV + '/stats', 403, { setup: { who: STRANGER } }),
    X('stats-no-root-configured', 'GET ' + EV + '/stats', 404, { patch: noRoot }),
    X('stats-throws-leaks-nothing', 'GET ' + EV + '/stats', 500, events('stats', sink))
  ];

  const feeds = [
    X('feed-listed', 'GET ' + NO, 200, { setup: { sqlRows: feed(SEEN_AT) } }),
    X('feed-before-the-first-look', 'GET ' + NO, 200, { setup: { sqlRows: feed(null) } }),
    X('feed-limit-5', 'GET ' + NO, 200, { url: NO + '?limit=5', setup: { sqlRows: feed(SEEN_AT) } }),
    X('feed-limit-not-a-number', 'GET ' + NO, 200, { url: NO + '?limit=abc', setup: { sqlRows: feed(SEEN_AT) } }),
    X('feed-limit-too-big', 'GET ' + NO, 200, { url: NO + '?limit=9999', setup: { sqlRows: feed(SEEN_AT) } }),
    X('feed-limit-asked-twice', 'GET ' + NO, 200, { url: NO + '?limit=5&limit=6', setup: { sqlRows: feed(SEEN_AT) } }),
    X('feed-of-staff', 'GET ' + NO, 200, { setup: { who: STAFF, sqlRows: feed(SEEN_AT) } }),
    X('feed-empty', 'GET ' + NO, 200, {}),
    X('feed-seen-read-fails-carries-on', 'GET ' + NO, 200, { setup: { sqlRows: firstOf(handler, feedRows, raising(/^SELECT to_jsonb\(i\)->>'notif_seen_at' AS seen FROM identities i/, '42703')) } }),
    X('badge-counted', 'GET ' + NO, 200, { url: NO + '?count=1', setup: { sqlRows: badge({ count: 2, total: 3, seen_at: SEEN_AT }) } }),
    X('badge-nothing-counted', 'GET ' + NO, 200, { url: NO + '?count=1' }),
    X('badge-count-asked-twice-is-the-feed', 'GET ' + NO, 200, { url: NO + '?count=1&count=1', setup: { sqlRows: feed(SEEN_AT) } }),
    X('badge-count-2-is-the-feed', 'GET ' + NO, 200, { url: NO + '?count=2', setup: { sqlRows: feed(SEEN_AT) } }),
    X('badge-fails', 'GET ' + NO, 500, { url: NO + '?count=1', setup: { sqlRows: raising(/WITH me AS/, '23505') } }),
    X('badge-fails-leaks-nothing', 'GET ' + NO, 500, { url: NO + '?count=1', setup: { sqlRows: sink } }),
    X('feed-fails', 'GET ' + NO, 500, { setup: { sqlRows: raising(/SELECT \* FROM \(\s+SELECT DISTINCT ON/, '23505') } }),
    X('feed-fails-leaks-nothing', 'GET ' + NO, 500, { setup: { sqlRows: sink } }),
    X('feed-handler-read-fails-leaks-nothing', 'GET ' + NO, 500, { setup: { sqlRows: (sql) => { if (/dispute_handler_actor_id/.test(sql)) throw new Error(SECRET_SQL); return null; } } })
  ];

  const seens = [
    X('seen-marked', 'POST ' + NO + '/seen', 200, { setup: { sqlRows: marked } }),
    X('seen-marked-by-staff', 'POST ' + NO + '/seen', 200, { setup: { who: STAFF, sqlRows: marked } }),
    X('seen-body-a-list', 'POST ' + NO + '/seen', 200, { body: [1, 2], setup: { sqlRows: marked } }),
    X('seen-body-is-never-read', 'POST ' + NO + '/seen', 200, { body: { entity_id: STRANGER_ID, seen_at: '2020-01-01' }, setup: { sqlRows: marked } }),
    X('seen-nothing-answered', 'POST ' + NO + '/seen', 200, {}),
    X('seen-not-migrated', 'POST ' + NO + '/seen', 503, { setup: { sqlRows: raising(/notif_mark_seen/, '42883') } }),
    X('seen-fails', 'POST ' + NO + '/seen', 500, { setup: { sqlRows: raising(/notif_mark_seen/, '23505') } }),
    X('seen-fails-leaks-nothing', 'POST ' + NO + '/seen', 500, { setup: { sqlRows: sink } })
  ];

  const dismisses = [
    X('dismiss-nothing-sent', 'POST ' + NO + '/dismiss', 400, { body: {} }),
    X('dismiss-body-a-list', 'POST ' + NO + '/dismiss', 400, { body: [LOG_A] }),
    X('dismiss-log-ids-empty', 'POST ' + NO + '/dismiss', 400, { body: { log_ids: [] } }),
    X('dismiss-log-ids-not-a-list', 'POST ' + NO + '/dismiss', 400, { body: { log_ids: LOG_A } }),
    X('dismiss-log-ids-all-empty-values', 'POST ' + NO + '/dismiss', 400, { body: { log_ids: [0, '', null, false] } }),
    X('dismiss-all-is-the-text-true', 'POST ' + NO + '/dismiss', 400, { body: { all: 'true' } }),
    X('dismiss-one', 'POST ' + NO + '/dismiss', 200, { body: { log_ids: [LOG_A] }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-two-and-a-repeat', 'POST ' + NO + '/dismiss', 200, { body: { log_ids: [LOG_A, LOG_B, LOG_A] }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-an-id-nobody-has', 'POST ' + NO + '/dismiss', 200, { body: { log_ids: [JUNK_LOG] }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-another-shops-id', 'POST ' + NO + '/dismiss', 200, { body: { log_ids: [OTHER_SHOPS_LOG] }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-all', 'POST ' + NO + '/dismiss', 200, { body: { all: true }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-all-wins-over-ids', 'POST ' + NO + '/dismiss', 200, { body: { all: true, log_ids: [JUNK_LOG] }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-all-nothing-visible', 'POST ' + NO + '/dismiss', 200, { body: { all: true }, setup: { sqlRows: dismiss(0) } }),
    X('dismiss-by-staff', 'POST ' + NO + '/dismiss', 200, { body: { log_ids: [LOG_A] }, setup: { who: STAFF, sqlRows: dismiss(3) } }),
    X('dismiss-entity-in-the-body-is-never-read', 'POST ' + NO + '/dismiss', 200, { body: { log_ids: [LOG_A], entity_id: STRANGER_ID }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-not-a-uuid-is-a-500', 'POST ' + NO + '/dismiss', 500, { body: { log_ids: ['nope'] }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-a-number-is-a-500', 'POST ' + NO + '/dismiss', 500, { body: { log_ids: [7] }, setup: { sqlRows: dismiss(3) } }),
    X('dismiss-not-migrated-table', 'POST ' + NO + '/dismiss', 503, { body: { all: true }, setup: { sqlRows: raising(/INSERT INTO notif_dismissed/, '42P01') } }),
    X('dismiss-not-migrated-column', 'POST ' + NO + '/dismiss', 503, { body: { log_ids: [LOG_A] }, setup: { sqlRows: raising(/INSERT INTO notif_dismissed/, '42703') } }),
    X('dismiss-fails', 'POST ' + NO + '/dismiss', 500, { body: { all: true }, setup: { sqlRows: raising(/INSERT INTO notif_dismissed/, '23505') } }),
    X('dismiss-fails-leaks-nothing', 'POST ' + NO + '/dismiss', 500, { body: { log_ids: [LOG_A] }, setup: { sqlRows: sink } }),
    X('dismiss-all-fails-leaks-nothing', 'POST ' + NO + '/dismiss', 500, { body: { all: true }, setup: { sqlRows: sink } })
  ];

  return [].concat(tickets, streams, stats, feeds, seens, dismisses);
}

module.exports = { extras, dismissing, EV, NO, STRANGER_ID, LOG_A, LOG_B, JUNK_LOG, OTHER_SHOPS_LOG, FEED, UUID };
