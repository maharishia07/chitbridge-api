'use strict';
/**
 * tests/bell-truth.realstack.cjs — BELL TRUTH, on the LOCAL stack (T2: real Postgres; API-STANDARD R2-10, API-4 sweep of routes/events.js and routes/notifications.js).
 *
 * OWNS      one case per id surface of the bell, on real rows (the stand-in db of tests/api-problem-bell.test.cjs answers what RLS and a real foreign key never would). No route has an id in its path and none
 *           is a money write, so the cases are the body's ids (POST /dismiss log_ids), the one-time ticket and the doors:
 *   BELL-01  POST /ticket then GET /stream: the stream opens with the ticket in ?t= AND in ?ticket= (both spellings), says hello, and a ticket is spent on first use (the second open is 401)
 *   BELL-02  POST /dismiss log_ids: notif_dismissed has NO foreign key, so another shop's REAL log_id, an unknown uuid and a made-up one all answer the same 200 { ok: true, cleared: 1 } (no existence oracle across shops),
 *            and each row lands under the CALLER's shop; the other shop's own feed and its state_log row are untouched
 *   BELL-03  POST /dismiss { all: true }: hides what the shop can see and DELETES NOTHING from state_log (the trail disputes are built on)
 *   BELL-04  GET /stats: a shop that is not the platform root is refused (403, or 404 where no root is configured), never the counts
 *   BELL-05  POST /seen moves only the caller's watermark; ?count=1 then says 0; the other shop's watermark is untouched
 *   BELL-06  gap: a log_id that is not a uuid is the database's own 22P02 and answers 500 where an unknown uuid answers 200 (listed for API-4c; the stand-in only models it)
 * CALLED BY the S41 job (it picks up every *-truth.realstack.cjs) · by hand on the local stack. NOT run on the laptop that wrote it (no Docker there): written, runs in S41.
 * Shares tests/lib/truth-harness.cjs. LOCAL ONLY. Run: node tests/bell-truth.realstack.cjs   (one realstack file at a time on :3100)
 * CARD 22-channels-capture-and-messaging/notifications-and-the-bell
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'bl' + (Date.now() % 1e10).toString(36);
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';
const MADE_UP_UUID = '123e4567-e89b-42d3-a456-426614174000';
let pg = null;

/** the first frames of a stream, never holding it open: the status, the type and the text up to 'hello' (the socket is closed after) */
async function firstFrames(path) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 4000);
  try {
    const reply = await fetch(H.API + path, { signal: stop.signal });
    if (reply.status !== 200) return { status: reply.status, type: reply.headers.get('content-type'), text: '' };
    const reader = reply.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('event: hello')) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    return { status: 200, type: reply.headers.get('content-type'), text };
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
}
const dismissedOf = async (id) => (await pg.query(`SELECT entity_id FROM notif_dismissed WHERE log_id = $1`, [id])).rows.map((one) => one.entity_id);
const logRowsOf = async (shop) => Number((await pg.query(`SELECT count(*) AS n FROM state_log WHERE entity_id = $1`, [shop.entity])).rows[0].n);
const seenAtOf = async (shop) => (await pg.query(`SELECT to_jsonb(i)->>'notif_seen_at' AS seen FROM identities i WHERE identity_id = $1`, [shop.entity])).rows[0].seen;
/** an answer as it is compared: status and the words, the per-request id left out (it differs between any two answers) */
const same = (left, right) => left.status === right.status && JSON.stringify(Object.assign({}, left.b, { request_id: null })) === JSON.stringify(Object.assign({}, right.b, { request_id: null }));

(async () => {
  console.log('\n── bell truth on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB }); await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Bell truth');
    const B = await freshShop(RUN + 'b', 'Bell other');

    await kase('BELL-01', 'a ticket opens the stream in both spellings, once', async () => {
      const first = ok(await j('/api/events/ticket', { method: 'POST', token: A.token, body: {} }), 'ticket').b;
      expect(typeof first.ticket === 'string' && first.ttl_s === 60, 'ticket answer: ' + JSON.stringify(first));
      const viaT = await firstFrames('/api/events/stream?t=' + first.ticket);
      expect(viaT.status === 200 && /text\/event-stream/.test(viaT.type) && /^retry: 5000\nevent: hello/.test(viaT.text), '?t= opened: ' + JSON.stringify(viaT));
      const spent = await j('/api/events/stream?t=' + first.ticket);
      expect(spent.status === 401 && spent.b.message === 'ticket missing, spent or expired', 'the same ticket opened twice: ' + spent.status + ' ' + JSON.stringify(spent.b));
      const second = ok(await j('/api/events/ticket', { method: 'POST', token: A.token, body: {} }), 'ticket 2').b;
      const viaTicket = await firstFrames('/api/events/stream?ticket=' + second.ticket);
      expect(viaTicket.status === 200 && /event: hello/.test(viaTicket.text), '?ticket= opened: ' + JSON.stringify(viaTicket));
      const none = await j('/api/events/stream');
      expect(none.status === 401, 'no ticket: ' + none.status);
    });

    await kase('BELL-02', 'POST /dismiss: another shop\'s real log_id, an unknown uuid and a made-up one answer alike (no foreign key, no oracle)', async () => {
      const foreignLog = (await pg.query(`SELECT log_id FROM state_log WHERE entity_id = $1 LIMIT 1`, [A.entity])).rows[0];
      const real = foreignLog ? foreignLog.log_id : UNKNOWN_UUID; /* a fresh shop may have no event yet: then the "real" id is an unknown one and the case still proves the three answers alike */
      const noFk = (await pg.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'notif_dismissed'::regclass AND contype = 'f'`)).rows[0].n;
      expect(noFk === 0, 'notif_dismissed has ' + noFk + ' foreign key(s): the sweep\'s model of it (none) is wrong, and the oracle question must be asked again');
      const foreign = await j('/api/notifications/dismiss', { method: 'POST', token: B.token, body: { log_ids: [real] } });
      const unknown = await j('/api/notifications/dismiss', { method: 'POST', token: B.token, body: { log_ids: [UNKNOWN_UUID] } });
      const madeUp = await j('/api/notifications/dismiss', { method: 'POST', token: B.token, body: { log_ids: [MADE_UP_UUID] } });
      expect(foreign.status === 200 && foreign.b.cleared === 1 && same(foreign, unknown) && same(unknown, madeUp), 'foreign ' + JSON.stringify(foreign.b) + ' unknown ' + JSON.stringify(unknown.b) + ' made-up ' + JSON.stringify(madeUp.b));
      expect((await dismissedOf(MADE_UP_UUID)).every((owner) => owner === B.entity) && (await dismissedOf(MADE_UP_UUID)).length === 1, 'the dismissal must land under the caller\'s shop only: ' + JSON.stringify(await dismissedOf(MADE_UP_UUID)));
      expect(!(await dismissedOf(real)).includes(A.entity), 'the other shop\'s own feed was touched');
    });

    await kase('BELL-03', 'POST /dismiss all:true hides, never deletes: state_log keeps every row', async () => {
      const before = await logRowsOf(A);
      const cleared = ok(await j('/api/notifications/dismiss', { method: 'POST', token: A.token, body: { all: true } }), 'dismiss all').b;
      expect(cleared.ok === true && cleared.cleared <= before, 'cleared ' + cleared.cleared + ' of ' + before);
      expect((await logRowsOf(A)) === before, 'state_log lost rows: ' + before + ' -> ' + await logRowsOf(A));
      const feed = ok(await j('/api/notifications', { token: A.token }), 'feed').b;
      expect(Array.isArray(feed.notifications) && feed.notifications.length === 0, 'the feed still lists ' + feed.notifications.length);
    });

    await kase('BELL-04', 'GET /stats: a shop that is not the platform root never gets the counts', async () => {
      const refused = await j('/api/events/stats', { token: A.token });
      expect((refused.status === 403 && refused.b.code === 'NOT_PLATFORM_ROOT') || (refused.status === 404 && refused.b.code === 'NO_PLATFORM_ROOT'), 'a shop read the platform counts: ' + refused.status + ' ' + JSON.stringify(refused.b).slice(0, 200));
    });

    await kase('BELL-05', 'POST /seen moves only the caller\'s watermark', async () => {
      const otherBefore = await seenAtOf(B);
      const seen = ok(await j('/api/notifications/seen', { method: 'POST', token: A.token, body: {} }), 'seen').b;
      expect(seen.ok === true && typeof seen.seen_at === 'string', 'seen: ' + JSON.stringify(seen));
      const badge = ok(await j('/api/notifications?count=1', { token: A.token }), 'badge').b;
      expect(badge.count === 0, 'the badge after looking: ' + JSON.stringify(badge));
      expect((await seenAtOf(B)) === otherBefore, 'the other shop\'s watermark moved');
    });

    await kase('BELL-06', 'a log_id that is not a uuid answers 200 like an unknown uuid, not 500', async () => {
      const bad = await j('/api/notifications/dismiss', { method: 'POST', token: A.token, body: { log_ids: ['nope'] } });
      const unknown = await j('/api/notifications/dismiss', { method: 'POST', token: A.token, body: { log_ids: [UNKNOWN_UUID] } });
      expect(bad.status === unknown.status, 'a malformed log_id answered ' + bad.status + ' where an unknown uuid answered ' + unknown.status);
    }, 'unnest($2::uuid[]) raises 22P02 for "nope" and the catch answers the generic 500 (API-4c: a 400 would be new behaviour, the owner decides)');
  } finally {
    await pg.end();
  }
  finish('bell truth', process.env.BELL_TRUTH_JSON || null);
})().catch((failure) => { console.error(failure); process.exitCode = 1; });
