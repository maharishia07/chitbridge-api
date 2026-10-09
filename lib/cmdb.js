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

/* ── the FIELD LEDGER (Athi, 2026-10-09: "no field left unturned") ─────────────────────────────────────────────
 * A record may carry `fields`: one row per FIELD of an item kind. Plan: C:/dev/FIELD-LEDGER-PLAN.md.
 *   status   ok · shown-nowhere · not-settable · two-sources · no-meaning · untested · not-used
 *   origin   keyed (a person types/picks it) · derived (computed) · referenced (points at another item) ·
 *            copied (a copy of another field) · system (ids, timestamps, versions) · intermediate (working value)
 * ⚠️ The same refusal rule as the rest of the shape: a row that contradicts itself is answered with the reason. */
const FIELD_STATUS = ['ok', 'shown-nowhere', 'not-settable', 'two-sources', 'no-meaning', 'untested', 'not-used'];
const FIELD_ORIGIN = ['keyed', 'derived', 'referenced', 'copied', 'system', 'intermediate'];
const FIELD_KEY = /^[A-Za-z0-9_.*<>-]{1,120}$/;
MAX.fields = 400;
function strList(v, max, each) { return Array.isArray(v) && v.length <= max && v.every((x) => str(x, each || 200) && x !== ''); }

function fieldRows(list) {
  if (!Array.isArray(list)) return 'fields must be a list';
  if (list.length > MAX.fields) return 'fields has more than ' + MAX.fields + ' rows — split the record (CAP-…-1, -2)';
  const seen = new Set();
  for (const f of list) {
    const k = f && f.key;
    if (!FIELD_KEY.test(String(k || ''))) return 'every field needs a key like "item_data.hsn"';
    if (seen.has(k)) return 'field ' + k + ' is listed twice';
    seen.add(k);
    const w = 'field ' + k + ': ';
    if (!strList(f.kinds, 8, 40) || !f.kinds.length) return w + 'kinds is a list of item kinds (at least one)';
    if (!str(f.means, 600) || !f.means) return w + 'means is one plain sentence — if nobody can write it, the field is a finding (status no-meaning, means "?")';
    if (!str(f.source, 600) || !f.source) return w + 'source (the ONE place it is stored) is required — write "?" if unknown';
    if (!str(f.set_by, 600) || !f.set_by) return w + 'set_by is required — write "nobody" or "?"';
    if (!optStr(f.validated_by) || !optStr(f.test)) return w + 'validated_by and test are text, at most ' + MAX.str;
    if (!strList(f.shown_in, 20) || !strList(f.used_by, 20)) return w + 'shown_in and used_by are lists of text (an empty list means nowhere / nothing)';
    if (FIELD_STATUS.indexOf(f.status) < 0) return w + 'status is ' + FIELD_STATUS.join('|');
    if (FIELD_ORIGIN.indexOf(f.origin) < 0) return w + 'origin is ' + FIELD_ORIGIN.join('|');
    if (f.origin !== 'keyed' && f.origin !== 'system' && !str(f.origin_detail, 600)) return w + 'a ' + f.origin + ' field must say how (the engine and inputs · the target and whether it can dangle · the source and when it refreshes · who writes and who clears)';
    if (!optStr(f.origin_detail) || !optStr(f.finding, 800)) return w + 'origin_detail and finding are text';
    if (f.also != null && (!Array.isArray(f.also) || f.also.some((x) => FIELD_STATUS.indexOf(x) < 0 || x === 'ok'))) return w + 'also lists further problems, each one of ' + FIELD_STATUS.slice(1).join('|');
    if (f.inputs != null && !strList(f.inputs, 20, 60)) return w + 'inputs is a list of form input ids';
    if (f.watch != null) {
      if (!strList(f.watch, 5, 120)) return w + 'watch is a list of patterns';
      for (const p of f.watch) { try { new RegExp(p); } catch (_) { return w + 'watch pattern ' + p + ' is not a valid expression'; } }
    }
    if (f.allow != null && !strList(f.allow, 10, 120)) return w + 'allow is a list of file paths the watch may match (kept, dormant)';
    const nothing = f.shown_in.length === 0 && f.used_by.length === 0;
    if (f.status === 'not-used' && !nothing) return w + 'status not-used but it is shown or used — a field that is neither shown nor used is the only "not used"';
    if (f.status === 'shown-nowhere' && f.shown_in.length) return w + 'status shown-nowhere but shown_in is not empty';
    if (f.status === 'ok' && nothing) return w + 'status ok but it is neither shown nor used — that is "not-used"';
    if (f.status === 'ok' && /^none/i.test(String(f.test || 'none'))) return w + 'status ok needs a test; with none the status is untested';
    if (f.status === 'untested' && f.test && !/^none/i.test(f.test)) return w + 'status untested but a test is named';
  }
  return null;
}

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
  if (r.fields != null) { const fe = fieldRows(r.fields); if (fe) return bad(fe); }
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
  /* the ledger's own findings — Athi: "we should not be leaving any field unturned" */
  if (Array.isArray(r.fields) && r.fields.length) {
    const n = (st) => r.fields.filter((f) => f.status === st || (f.also || []).indexOf(st) >= 0).length;
    if (n('shown-nowhere')) out.push(n('shown-nowhere') + ' fields shown nowhere');
    if (n('not-used')) out.push(n('not-used') + ' fields not used');
    if (n('untested')) out.push(n('untested') + ' fields untested');
  }
  return out;
}

module.exports = { shape, flags, CI_RE, FIELD_STATUS, FIELD_ORIGIN };
