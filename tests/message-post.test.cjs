/**
 * tests/message-post.test.cjs — THE ONE MESSAGE WRITER (MARK-AND-QUERY PR1).
 * OWNS      the rule that a 'mark' post calls the mark definer only: no chit_message_deliver, no timeline line, no CTP; a 'chit' post is the old path (copies, then the timeline line for external)
 * CALLED BY scripts/guards.cjs (offline, no DB)
 * FLOW      a recording db stub → lib/message-post.postMessage
 * CARD      docs/01-rail-core-the-chit/functions/thread-messages-on-a-chit.md
 */
'use strict';
const path = require('path');
const { postMessage } = require(path.join(__dirname, '..', 'lib', 'message-post'));
let failed = 0, n = 0;
const ok = (c, w) => { n++; if (!c) { failed++; console.log('  FAIL ' + w); } else console.log('   ok   ' + w); };

(async () => {
  const seen = [];
  const db = { query: async (sql, params) => { seen.push({ sql, params }); if (/review_mark_post/.test(sql)) return { rows: [{ message_id: 'm1', created_at: 'T' }] }; if (/chit_message_deliver/.test(sql)) return { rows: [{ created_at: 'T' }] }; return { rows: [] }; } };
  const mark = await postMessage(db, { subject_type: 'mark', subject_id: 'th', sender_entity_id: 'e1', sender_display_name: 'A', message_text: 'hi', via_kind: 'self', via_id: null });
  ok(mark.message_id === 'm1', 'a mark post answers the definer row');
  ok(seen.length === 1 && /review_mark_post/.test(seen[0].sql), 'a mark post makes exactly one statement: the mark definer');
  ok(!seen.some((s) => /chit_message_deliver|chit_log_all|state_log/.test(s.sql)), 'a mark post makes no chit_message_deliver and no timeline line');
  seen.length = 0;
  await postMessage(db, { chit_id: 'c1', sender_entity_id: 'e1', sender_display_name: 'A', thread_type: 'internal', message_text: 'hi' });
  ok(seen.length === 1 && /chit_message_deliver/.test(seen[0].sql), 'an internal chit message: the copies only');
  let threw = null;
  try { await postMessage(db, { subject_type: 'nope' }); } catch (e) { threw = e; }
  ok(threw && threw.code === 'MESSAGE_SUBJECT_UNKNOWN', 'an unknown subject type is refused');
  console.log('\n' + (n - failed) + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
