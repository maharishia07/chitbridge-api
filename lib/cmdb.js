'use strict';
/**
 * lib/cmdb.js — WHAT A CMDB RECORD IS ALLOWED TO BE. Pure: no database, no request. (2026-09-28)
 *
 * Athi: *"for any capability built there must be a way of invoking the same and it must be used somewhere … if
 * there is no entry or exit path, this means it is not useful"* — then *"can it be linked in the cmdb database as
 * part of this capability, so anyone can look at this?"* and *"store it in the cloud database"*.
 *
 * A record is one CONFIGURATION ITEM (ITIL 4), stored as a `definition` of kind 'cmdb' on the shared board, named
 * by its CI id and versioned only when it changes (routes/testing.js). Its data is what the three industry views
 * are drawn from — no HTML is stored, so one page draws every record:
 *   · capability map (LeanIX / ServiceNow APM)   map: [{ id, title, state, note, ci }]
 *   · entry → process → exit (ArchiMate)          entries / process / exits: [{ id, t, s, d }], edges: [[from, to]]
 *   · the CI record (ITIL · CSDM · ISO 29119-3)  relationships, layers, tests, changes, descriptor
 *
 * ⚠️ IT REFUSES, IT DOES NOT TRIM. A record that does not fit is answered with the reason; nothing is silently cut
 * to size — a CMDB that quietly drops half a record is believed at exactly the moment it is wrong.
 */

const CI_RE = /^CAP-[A-Z0-9][A-Z0-9-]{1,39}$/;
const NODE_ID = /^[a-z][a-z0-9_-]{0,23}$/;
const MAX = { str: 600, list: 200, bytes: 64 * 1024 };
const STATES = ['ok', 'warn', 'off', 'fail'];
const RESULTS = ['pass', 'fail', 'not run', 'blocked'];

function str(v, max) { return typeof v === 'string' && v.length <= (max || MAX.str); }
function optStr(v, max) { return v == null || str(v, max); }

function nodes(list, where) {
  if (!Array.isArray(list)) return where + ' must be a list';
  if (list.length > MAX.list) return where + ' has more than ' + MAX.list + ' entries';
  for (const n of list) {
    if (!n || !NODE_ID.test(String(n.id))) return where + ': every node needs an id like "e1"';
    if (!str(n.t, 200)) return where + ' ' + n.id + ': a title (t) is required, at most 200 characters';
    if (!optStr(n.s) || !optStr(n.d)) return where + ' ' + n.id + ': s and d are text, at most ' + MAX.str;
  }
  return null;
}

/**
 * shape(record) → { ok: true, record } | { ok: false, why }
 * The record comes back as given (validated, never rewritten), plus nothing — derived counts are the page's job.
 */
function shape(rec) {
  const r = rec || {};
  const bad = (why) => ({ ok: false, why });
  if (!CI_RE.test(String(r.ci || ''))) return bad('ci must look like CAP-SIGNIN (capitals, digits, hyphens)');
  if (!str(r.title, 120)) return bad('title is required, at most 120 characters');
  for (const k of ['type', 'system', 'summary', 'spec', 'raised_by', 'source']) if (!optStr(r[k])) return bad(k + ' must be text');
  if (r.source != null && ['hand', 'generated'].indexOf(r.source) < 0) return bad('source is "hand" or "generated"');
  if (r.maturity != null) {
    const m = r.maturity;
    if (typeof m !== 'object' || !(m.now >= 1 && m.now <= 5) || (m.target != null && !(m.target >= 1 && m.target <= 5)))
      return bad('maturity is { now: 1–5, target: 1–5, set: "YYYY-MM-DD" }');
  }
  let e;
  if ((e = nodes(r.entries || [], 'entries')) || (e = nodes(r.process || [], 'process')) || (e = nodes(r.exits || [], 'exits'))) return bad(e);
  const ids = new Set([].concat(r.entries || [], r.process || [], r.exits || []).map((n) => String(n.id)));
  if (!Array.isArray(r.edges || [])) return bad('edges must be a list of [from, to]');
  for (const ed of (r.edges || [])) {
    if (!Array.isArray(ed) || ed.length !== 2 || !ids.has(String(ed[0])) || !ids.has(String(ed[1])))
      return bad('edge ' + JSON.stringify(ed) + ' names a node that is not in entries/process/exits');
  }
  for (const t of (r.map || [])) {
    if (!str(t.title, 120) || (t.state != null && STATES.indexOf(t.state) < 0) || !optStr(t.note))
      return bad('map tiles are { title, state: ' + STATES.join('|') + ', note }');
    if (t.node != null && !ids.has(String(t.node))) return bad('map tile "' + t.title + '" points at a node that does not exist');
  }
  for (const x of (r.relationships || [])) if (!str(x.this, 200) || !str(x.rel, 60) || !str(x.that)) return bad('relationships are { this, rel, that }');
  if (r.layers != null) for (const k of Object.keys(r.layers)) {
    if (['consume', 'manage', 'build', 'design'].indexOf(k) < 0 || !str(r.layers[k])) return bad('layers are consume/manage/build/design, each text');
  }
  for (const t of (r.tests || [])) {
    if (!str(t.file, 160) || !optStr(t.kind, 60) || !optStr(t.proves) || (t.result != null && RESULTS.indexOf(t.result) < 0)
        || (t.checks != null && !(Number.isInteger(t.checks) && t.checks >= 0)))
      return bad('tests are { file, kind, proves, checks: integer, result: ' + RESULTS.join('|') + ', at }');
  }
  for (const c of (r.changes || [])) if (!str(c.ref, 60) || !str(c.what, 300)) return bad('changes are { ref, what }');
  if (!optStr(r.descriptor, 4000)) return bad('descriptor is text, at most 4000 characters');
  if (Buffer.byteLength(JSON.stringify(r), 'utf8') > MAX.bytes) return bad('the record is larger than 64 KB');
  return { ok: true, record: r };
}

/** the flags a record raises about itself — Athi's rule: no way in, or no way out, is not useful */
function flags(r) {
  const out = [];
  if (!(r.entries || []).length) out.push('no entry');
  if (!(r.exits || []).length) out.push('no exit');
  if (!(r.tests || []).length) out.push('no test');
  else if (!(r.tests || []).some((t) => t.result === 'pass' || t.result === 'fail')) out.push('never run');
  return out;
}

module.exports = { shape, flags, CI_RE };
