/**
 * tools/seed/clean-lane-rows.cjs — list (default, --dry) or remove (--apply) the test rows a lane left on a SIT / seed database.
 * OWNS      the one clean of lane test rows: the THREE tables the bell and Home Bookmarks read — review_mark (queries and marks), private_flag (Home notes and bookmarks), chit_messages
 *           (the replies on them: subject_type 'mark' | 'flag' only, never a chit's own messages). No second cleaner.
 * CALLED BY by hand: node tools/seed/clean-lane-rows.cjs --db postgres://postgres:...@host:port/bm_seede [--words a,b|none] [--since YYYY-MM-DD] [--by "seat or name"] [--apply]
 * Picks by WORDS (default WALK, FABLE, TEST-, rc1117, rc2, livechk, hq7dp, bell test; case-insensitive, anywhere in the note / label / author / sender) AND --since (row date) AND --by (author name); --words none leaves only --since / --by.
 * Replies (chit_messages) are removed when their thread loses its last mark / flag, or when the words match the reply itself.
 * SAFETY   refuses any database that is not a SIT / seed one: the name must be bm_<x> · cb_local · or hold 'seed', and the host must not be a hosted production service (supabase, railway). Never production.
 * HOW      one transaction as the database owner with session_replication_role = replica (review_mark is insert-only by trigger), a dry run rolls back; prints counts by kind; writes nothing else.
 *          Back up first (pg_dump) when running --apply on a database that matters.
 */
'use strict';
const path = require('path');
const DEFAULT_WORDS = ['WALK', 'FABLE', 'TEST-', 'rc1117', 'rc2', 'livechk', 'hq7dp', 'bell test'];
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes('--' + name);

/** null when the url is a SIT / seed database, else the sentence saying why not */
function refusal(url) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return 'the database url cannot be read';
  }
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (/supabase|railway|rlwy|amazonaws|neon\.tech/i.test(u.hostname)) return 'host ' + u.hostname + ' looks hosted (production?)';
  if (process.env.NODE_ENV === 'production') return 'NODE_ENV is production';
  if (!(/^bm_[a-z0-9_]+$/.test(name) || name === 'cb_local' || /seed/i.test(name))) return 'database "' + name + '" is not a SIT / seed one (bm_<x>, cb_local, or a name with "seed")';
  return null;
}
const wordsOf = () => {
  const w = arg('words', null);
  return w === 'none' ? [] : w ? w.split(',').map((x) => x.trim().replace(/\*$/, '')).filter(Boolean) : DEFAULT_WORDS;
};
const like = (words) => words.map((w) => '%' + w.replace(/[\\%_]/g, '\\$&') + '%');

/** the picked ids by kind, inside the caller's transaction (client): { marks, flags, messages } as arrays */
async function pick(client, { words, since, by }) {
  const L = like(words);
  const sinceTs = since || null;
  const byName = by || null;
  const wordSql = (cols) => (L.length ? '(' + cols.map((c) => `${c} ILIKE ANY($1::text[])`).join(' OR ') + ')' : 'cardinality($1::text[]) = 0');
  const marks = (
    await client.query(`SELECT mark_id FROM review_mark WHERE ${wordSql(['note', 'by_name'])} AND ($2::timestamptz IS NULL OR at >= $2) AND ($3::text IS NULL OR by_name ILIKE $3) ORDER BY mark_id`, [L, sinceTs, byName])
  ).rows.map((r) => String(r.mark_id));
  const flags = (
    await client.query(`SELECT flag_id FROM private_flag WHERE ${wordSql(['label', 'note', 'author_name'])} AND ($2::timestamptz IS NULL OR created_at >= $2) AND ($3::text IS NULL OR author_name ILIKE $3) ORDER BY flag_id`, [L, sinceTs, byName])
  ).rows.map((r) => String(r.flag_id));
  /* replies: by their own words/date/sender, or orphaned by the removal (their thread keeps no mark / flag once the picked ones go) */
  const messages = (
    await client.query(
      `SELECT message_id FROM chit_messages c WHERE c.subject_type IN ('mark', 'flag') AND (
        (${wordSql(['c.message_text', 'c.sender_display_name'])} AND ($2::timestamptz IS NULL OR c.created_at >= $2) AND ($3::text IS NULL OR c.sender_display_name ILIKE $3) AND (cardinality($1::text[]) > 0 OR $2::timestamptz IS NOT NULL OR $3::text IS NOT NULL))
        OR (c.subject_type = 'mark' AND NOT EXISTS (SELECT 1 FROM review_mark r WHERE r.thread_id = c.subject_id AND r.mark_id::text <> ALL($4::text[])))
        OR (c.subject_type = 'flag' AND NOT EXISTS (SELECT 1 FROM private_flag f WHERE f.thread_id = c.subject_id AND f.flag_id::text <> ALL($5::text[]))))
      ORDER BY c.created_at`,
      [L, sinceTs, byName, marks, flags]
    )
  ).rows.map((r) => r.message_id);
  return { marks, flags, messages };
}

/** one transaction: pick, (when apply) delete in the order replies, flags, marks, count; a dry run rolls back. Returns { marks, flags, messages } counts. */
async function run(pool, opts) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'"); /* the insert-only trigger stands aside for this one transaction */
    const ids = await pick(client, opts);
    const done = { marks: ids.marks.length, flags: ids.flags.length, messages: ids.messages.length };
    if (opts.apply) {
      if (ids.messages.length) await client.query(`DELETE FROM chit_messages WHERE subject_type IN ('mark', 'flag') AND message_id = ANY($1::uuid[])`, [ids.messages]);
      if (ids.flags.length) await client.query('DELETE FROM private_flag WHERE flag_id::text = ANY($1::text[])', [ids.flags]);
      if (ids.marks.length) await client.query('DELETE FROM review_mark WHERE mark_id::text = ANY($1::text[])', [ids.marks]);
    }
    await client.query(opts.apply ? 'COMMIT' : 'ROLLBACK');
    return done;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { refusal, run, pick, DEFAULT_WORDS };
if (require.main === module)
  (async () => {
    const url = arg('db', process.env.DATABASE_URL || '');
    const why = refusal(url);
    if (why) {
      console.error('clean-lane-rows: REFUSED — ' + why);
      process.exit(3);
    }
    const apply = has('apply');
    const opts = { words: wordsOf(), since: arg('since', null), by: arg('by', null), apply };
    const { Pool } = require(path.join(__dirname, '..', '..', 'node_modules', 'pg'));
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 8000 });
    try {
      const n = await run(pool, opts);
      console.log('clean-lane-rows · ' + new URL(url).pathname.slice(1) + ' · ' + (apply ? 'APPLIED' : 'DRY RUN (nothing removed; add --apply)') + ' · words: ' + (opts.words.join(', ') || '(none)') + (opts.since ? ' · since ' + opts.since : '') + (opts.by ? ' · by ' + opts.by : ''));
      console.log('  review_mark ' + n.marks + ' · private_flag ' + n.flags + ' · chit_messages (mark|flag replies) ' + n.messages);
    } catch (e) {
      console.error('clean-lane-rows failed: ' + e.message);
      process.exit(2);
    } finally {
      await pool.end();
    }
  })();
