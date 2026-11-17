/**
 * ep-aliases.cjs — ⭐⭐ ONE ENDPOINT, ONE NAME.
 *
 * Athi's backlog, 2026-09-04: *"EP TRIPLICATION — /api/governance/profile is registered three times (vaultGet ·
 * profileGet ×2)."*
 *
 * ⚠️⚠️ WHY A SECOND NAME IS NOT HARMLESS. The endpoint map is also a REGISTER: `OUTBOX_KEYS` in core.js decides
 * which calls survive being offline, and it is keyed by NAME, not by path. So `profileSave` was queued offline and
 * `profilePut` — the same PUT to the same URL — was not. Retiring an alias therefore silently changes behaviour
 * somewhere else entirely, and adding one silently creates a call that behaves differently from its twin. Two
 * names for one endpoint is two places to keep a rule, and they only ever drift apart.
 *
 * ⚠️ A capability file re-registering a name IDENTICALLY is the same hazard one step quieter: `Object.assign(EP,…)`
 * overwrites whatever core declared, so the definition that wins is decided by load order.
 *
 * Run: node e2e/ep-aliases.cjs   (wired into `npm run check`)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f));

/**
 * ⚠️ THE BASELINE IS FOR PAIRS THAT ARE DELIBERATE, and each needs its reason written here. A new alias fails
 * immediately; these are the debt, and the point of the list is that it shrinks.
 */
/**
 * QA-20 (19 Oct 2026) · EXAMINED, DELIBERATE PAIRS (moved out of the unexamined list, with the check done):
 *   · PUT /api/chits/:id/status  advance · status   — both names are in core.js OUTBOX_KEYS, so offline behaviour is
 *     the same; they are two verbs of the chit's own language with different bodies.
 *   · PUT /api/actors/assign/:id  assign · unassign — both are in OUTBOX_KEYS; assign/unassign are the two verbs.
 * The other ten are still UNEXAMINED (the note below). The list is a ratchet: it may only shrink, and a stale entry fails.
 */
const JUSTIFIED = new Set([
  'PUT /api/chits/:id/status|advance,status',
  'PUT /api/actors/assign/:id|assign,unassign',
]);
const BASELINE_MAX = 10;
const BASELINE = new Set([
  /**
   * ⚠️⚠️ THESE TEN ARE **NOT APPROVED — THEY ARE UNEXAMINED**, and the difference matters. They are written
   * down so a NEW alias fails immediately; nobody has yet checked, for each one, whether the two names are a
   * deliberate pair (one route, two verbs in the UI's language, differing only by body — `assign`/`unassign`,
   * `advance`/`status` look like that) or a genuine duplicate like the governance/profile triple was.
   *
   * ⚠️ FOR WHOEVER WORKS ONE OFF: check core.js OUTBOX_KEYS first. It is keyed by NAME, so retiring a name that
   * is listed there without adding its survivor silently stops that write being queued when offline — which is
   * exactly what nearly happened retiring `profileSave`, and nothing anywhere would have said so.
   *
   * ⭐ The list is meant to shrink. Same discipline as e2e/list-controls.cjs (55 → 0) and e2e/api-envelope.cjs.
   */
  'POST /api/entities/register|ownerLogin,register',
  'POST /api/governance/ai-draft|aiDraft,catEnrich',
  'GET /api/chits/:id|chit,wlChit',
  'GET /api/actors|actors,wlActors',
  'PATCH /api/entities/profile|saveProfile,shopStatus',
  'GET /api/governance/readiness/:bridge_id|readinessOf',
  'POST /api/testing/cases/import|testCaseAdd,testCaseWrite',
  'GET /api/folders/messages|misMsgs,msgInbox',
  'POST /api/chits/:id/assign-lines|c2AssignLines,wlAssign',
  'POST /api/chits/:id/deliver-lines|c2DeliverLines,wlDeliver',
]);

/* name: {m:"GET", p:"/api/…"}  or  name: {m:'GET', p:'/api/…'} — both spellings are in use */
const ENTRY = /(\w+)\s*:\s*\{\s*m\s*:\s*['"](\w+)['"]\s*,\s*p\s*:\s*['"]([^'"]+)['"]/g;

const seen = new Map();          // "METHOD path" → [{name, file, line}]
for (const rel of FILES) {
  const full = path.join(WEB, rel);
  let src;
  try { src = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
  const lines = src.split('\n');
  lines.forEach((text, i) => {
    ENTRY.lastIndex = 0;
    let m;
    while ((m = ENTRY.exec(text))) {
      const key = m[2].toUpperCase() + ' ' + m[3];
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push({ name: m[1], file: rel, line: i + 1 });
    }
  });
}

const problems = [];
const known = [];
for (const [key, hits] of seen) {
  const names = [...new Set(hits.map((h) => h.name))];
  if (hits.length < 2) continue;
  const tag = key + '|' + names.slice().sort().join(',');
  ((BASELINE.has(tag) || JUSTIFIED.has(tag)) ? known : problems).push({ key, names, hits });
}

console.log('\n── one endpoint, one name ──\n');
console.log('  endpoints mapped : ' + seen.size);
if (known.length) {
  console.log('\n  ⚠ ' + known.length + ' known alias(es), on the baseline:');
  known.forEach((p) => console.log('      ' + p.key + '  →  ' + p.names.join(' · ')));
}
const live = new Set(known.map((p) => p.key + '|' + p.names.slice().sort().join(',')));
const stale = [...BASELINE].filter((k) => !live.has(k));
if (stale.length || BASELINE.size > BASELINE_MAX) {
  console.log('\n ✗ baseline entry no longer occurs (delete it): ' + (stale.join('; ') || 'size ' + BASELINE.size + ' > ' + BASELINE_MAX));
  process.exit(1);
}
if (problems.length) {
  console.log('\n  ✗ ' + problems.length + ' endpoint(s) registered under more than one name, or more than once:\n');
  problems.forEach((p) => {
    console.log('      ' + p.key);
    p.hits.forEach((h) => console.log('          ' + h.name.padEnd(18) + h.file + ':' + h.line));
  });
  console.log('\n    Keep ONE name and point the call sites at it.');
  console.log('    ⚠️ core.js OUTBOX_KEYS is keyed by NAME — if you retire a name that is listed there,');
  console.log('       add its survivor, or that write silently stops being queued when offline.\n');
  process.exit(1);
}
console.log('\n  ✓ every endpoint has exactly one name\n');
