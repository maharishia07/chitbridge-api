/**
 * ── ⭐⭐⭐ A TENANT TABLE READ WITHOUT A CONTEXT ANSWERS ZERO, AND ZERO LOOKS LIKE AN ANSWER ─────────────────────
 *
 * 63 tables are FORCE ROW LEVEL SECURITY. Read one as `cb_app` with no `app.current_entity` and Postgres returns
 * an empty set — not an error, not a warning. Every one of those reads is a question that answers "nothing here"
 * whatever is actually there.
 *
 * ⚠️⚠️ THIS COST THREE NEAR-MISSES IN ONE DAY, 2026-09-14/15:
 *
 *   · the support chit copies read back as `[]` — I was one sentence from reporting the ticket never arrived
 *   · the storefront ticket, the same
 *   · `entity_governance` counted 0 and I wrote "f_worlds is lying about its regions" INTO A COMMIT MESSAGE.
 *     The function was right. My verification was blind. That one got past me.
 *
 * ⭐ THE RULE: every read or write of a FORCE-RLS table goes through `withEntity(...)`, which sets the context.
 * The exceptions are real and few — a SECURITY DEFINER function in the `ops` schema reads across tenants ON
 * PURPOSE, and it does so from SQL, not from here.
 *
 * ⚠️ WHY THE LIST IS EMBEDDED. Only two of the 63 are declared with `ALTER TABLE … FORCE ROW LEVEL SECURITY` in
 * a migration; the rest were set elsewhere. An offline guard cannot ask the database, so the list is data, dated,
 * with the query that regenerates it. A stale list under-reports — it never invents a failure.
 *
 *     SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 *      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity ORDER BY relname;
 *
 * [REV-19] external review, 2026-09-25, on this same drift: "The RLS tripwire covers 19 tables; 67 have
 * policies." That finding was about db/index.js's RLS_TENANT_TABLES, but this file's own list had the identical
 * disease — dated 2026-09-15, eight FORCE-RLS tables younger than that (combo_templates among them) never
 * added. Refreshed 2026-09-26 from `node scripts/rls-census.cjs --save`; tests/rls-guard-baseline.test.cjs now
 * checks this list and db/index.js's against db/rls-baseline.json on every run, so the next new FORCE-RLS table
 * fails a test instead of just aging quietly here.
 */
const fs = require('fs');
const path = require('path');

/** FORCE ROW LEVEL SECURITY as at 2026-09-26 — regenerate with the query above. */
const RLS = `access_events capture catalogue_adoption catalogue_face catalogue_item_schedule
catalogue_item_version catalogue_items cb_attachment channel_binding channel_outbound chit_detail chit_disputes
chit_header chit_line chit_line_amendment chit_line_assignment chit_line_cost chit_line_delivery chit_messages
chit_reads chit_sla chit_sla_pause chit_status combo_templates connector_receipt counter_hidden_item
counter_quick_key_state customer_list definition definition_version device_screen_config entity_compliance
entity_governance entity_work_routing erp_handoff folder folder_rule form_instance idempotency_key
identity_documents kyb_field_cache network_design notif_dismissed quick_key_audit quick_key_group
quick_key_group_item register_acceptance register_attachable register_entry register_entry_standard
register_subject register_template register_template_standard retention_config reward_ledger signup_context
state_log stock_balance stock_movement supplier_readiness_acceptance supply_item test_result
wholesaler_store`.split(/\s+/).filter(Boolean);

const ROOT = path.join(__dirname, '..');
const DIRS = ['lib', 'routes'];

let pass = 0, fail = 0;
const ok = (name, cond, why) => {
  if (cond) { pass++; console.log('   ok   ' + name); }
  else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); }
};

console.log('\n══ TENANT TABLES ARE READ INSIDE A CONTEXT ══\n');
ok('the FORCE-RLS list is present', RLS.length > 40,
   'without the list this guard checks nothing — regenerate it from pg_class');

/* strip comments so prose naming a table is never mistaken for SQL */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/** the enclosing function body for an offset — by brace depth, walking back to the nearest `function`/`=>` head */
function enclosing(src, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    if (src[i] === '}') depth++;
    else if (src[i] === '{') { if (depth === 0) return src.slice(Math.max(0, i - 260), at); depth--; }
  }
  return src.slice(Math.max(0, at - 260), at);
}

const NAMES = RLS.join('|');
const TOUCH = new RegExp('\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(' + NAMES + ')\\b', 'i');

/**
 * ⭐⭐ THE TEST IS THE *CALL*, NOT THE NEIGHBOURHOOD.
 *
 * The first version scanned for `FROM <tenant table>` and looked around it for `withEntity`. It reported 141
 * offenders, almost all of them `db.query(` INSIDE a `withEntity(id, db => …)` callback whose head happened to
 * fall outside the window. A guard at that signal-to-noise gets a BASELINE bolted on and then means nothing.
 *
 * ⭐ The distinction is exact and needs no window at all:
 *
 *     query(`… FROM chit_status …`)        the module pool. NO context. This is the bug.
 *     db.query(`… FROM chit_status …`)     a client somebody handed in — and the only thing that hands one out
 *                                          is withEntity (or a caller that already has one).
 *
 * ⚠️ So a QUALIFIED call is trusted and a BARE one is not. That is not a heuristic, it is how lib/db.js is
 * shaped: the bare export is the pool.
 */
const CALL = /(^|[^\w.$])query\s*\(\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

/**
 * ── ⭐ DELIBERATE CROSS-TENANT READS, EACH WITH THE REASON IT IS ALLOWED ────────────────────────────────────────
 *
 * ⚠️ NOT A BASELINE. A baseline says "owes it, hasn't paid"; every line here says "this is correct and here is
 * why", and each was CHECKED rather than assumed. Adding a line is a decision; it is not how you make a red
 * guard go green.
 */
const EXPECTED = {
  /* @stage poc — no route reaches it, and a retention sweep is platform-wide by definition. If it is ever wired
     to a route, it needs a context or it will sweep only what it can see, which is nothing. */
  'lib/retention.js:chit_status': 'platform-wide retention sweep, @stage poc, unreached by any route',
  /* ⭐ VERIFIED 2026-09-15, not assumed: catalogue_items' policy is
       USING (entity_id = current_setting(app.current_entity) OR EXISTS (… visibility = 'public'))
     so a public item IS readable with no context — 11,572 rows are visible to cb_app right now. This is the
     storefront fallback for "the viewer does not own this item", and it works precisely because the policy
     says it may. */
  'routes/catalogue.js:catalogue_items': 'public storefront fallback; the RLS policy explicitly permits public items',
  'routes/products.js:catalogue_items': 'public storefront fallback; the RLS policy explicitly permits public items',
  /* ⭐ VERIFIED against migrations/b265_signup_context_rls.sql: the ONLY policy on signup_context is
     `FOR INSERT WITH CHECK (true)`, deliberately — the row is written during sign-up, BEFORE the entity being
     signed up exists, so a policy keyed on app.current_entity would block signing up at all. No SELECT/UPDATE/
     DELETE policy exists, so FORCE RLS makes the table write-only through cb_app regardless of context. */
  'routes/entities.js:signup_context': 'append-only audit row, written before the entity exists — b265 makes the table insert-only by design, not by context',
};

const offenders = [];
let sites = 0, excused = 0;
for (const d of DIRS) {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => /\.(js|cjs)$/.test(x))) {
    const p = path.join(dir, f);
    const src = strip(fs.readFileSync(p, 'utf8'));
    let m;
    CALL.lastIndex = 0;
    while ((m = CALL.exec(src))) {
      const sql = m[2];
      const hit = TOUCH.exec(sql);
      if (!hit) continue;
      sites++;
      /* ⚠️ a SECURITY DEFINER function in the ops schema reads across tenants ON PURPOSE — that is its job */
      if (/ops\.f_/.test(sql)) continue;
      /**
       * ⭐ `query` HANDED IN AS A PARAMETER is the caller's, and the caller may well be inside withEntity.
       * lib/access-events.js is written that way on purpose so one recorder serves both paths.
       */
      const head = enclosing(src, m.index);
      if (/function\s+\w*\s*\([^)]*\bquery\b[^)]*\)|\(\s*query\s*[,)]/.test(head)) continue;

      const where = path.join(d, f).replace(/\\/g, '/');
      const excuse = EXPECTED[where + ':' + hit[1]];
      if (excuse) { excused++; continue; }
      offenders.push(where + '  ' + hit[1] + '  ' + sql.slice(0, 74).replace(/\s+/g, ' ') + '…');
    }
  }
}

ok('call sites were found at all', sites >= 3,
   'no SQL naming a tenant table was found — the patterns have moved and this guard is checking nothing');

ok('every tenant-table read sets a context  (' + excused + ' allowed by name, with reasons)',
  offenders.length === 0,
  [...new Set(offenders)].slice(0, 10).join('\n          ')
  + (offenders.length > 10 ? '\n          … and ' + (offenders.length - 10) + ' more' : ''));

/* ⚠️ AND THE GUARD IS PROVEN. A check that cannot fail on its own example is decoration. */
(() => {
  const bad = 'async function probe(){ const r = await query("SELECT * FROM chit_status WHERE x=1"); }';
  TOUCH.lastIndex = 0;
  const m = TOUCH.exec(strip(bad));
  const near = m ? enclosing(strip(bad), m.index) : '';
  ok('the guard catches the shape it was written for',
     !!m && !/withEntity\s*\(/.test(near),
     'a plain query() against a FORCE-RLS table must be seen');
})();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
