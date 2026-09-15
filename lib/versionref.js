'use strict';
/**
 * ── ⭐⭐⭐ A THING, AT A VERSION — `gst-india@v1` ─────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15, on finding that "@" meant two things: *"reason why it is required, if not make it
 * redundant, otherwise give a proper naming and resolve separately."*
 *
 * ⭐ THIS IS THE THIRD PATH, AND THE REASON THE FIRST TWO WERE NOT TAKEN:
 *
 *   · **Is it required?** It is REAL, which is not the same thing. A constitution, a standard, a container and
 *     a work-pattern facet are each identified by a key AND a version, and the joined string is the form that
 *     is **stored** — `boilerplate.standards` is a jsonb map whose values are `key@version` — and **parsed
 *     back**, in three places, with `String(ref).split('@')[0]`.
 *   · **Make it redundant?** That would mean storing `{ key, version }` as two fields. Cleaner in the abstract,
 *     and a data migration of live governance rows for no behaviour change. Not worth it.
 *   · **⭐ So: a proper name, and resolved separately.** The separator stays — changing it would migrate the
 *     same rows for the same nothing — but the shape is no longer anonymous. It is a `version_ref`, it has one
 *     builder and one parser, and `lib/resolveuserid` asks THIS file whether a string is one, so the two
 *     namespaces are told apart in exactly one place.
 *
 * ── ⚠️ HOW IT IS TOLD APART FROM A PERSON, WITHOUT A LOOKUP ────────────────────────────────────────────────────
 *
 *     ravi@acmetraders     a PARTY    — a person at a business; a handle is at least 8 characters
 *     gst-india@v1         a VERSION  — "v" followed by digits, alone
 *
 * Nothing legal is both, and `ravi@v1shop` is a person at a business called v1shop — the version half must be
 * `v` and digits and NOTHING else. Before this existed, `gst-india@v1` classified as a person called
 * *gst-india*, and any caller acting on that would have gone looking for one.
 *
 * ⚠️ IT IS NOT A PARTY AND CAN NEVER BE SENT TO. `resolveuserid.isSendable()` says so explicitly rather than
 * letting it fall through a "not minted and not unreadable" test, which would have said yes.
 *
 * ── ZERO DEPENDENCIES · TIER A ─────────────────────────────────────────────────────────────────────────────────
 */

const SEP = '@';
/**
 * ⚠️ "code" IS A REAL VERSION VALUE, found by sweeping every composer rather than assuming. A blueprint that
 * has never been minted is referenced as `thing@code` — it comes from the CODE, not from a stamped row
 * (lib/workpattern.js). Leaving it out would have made `blueprint@code` classify as a person called
 * *blueprint*, which is the exact misread this file exists to prevent.
 */
const VERSION = /^(v\d+|code)$/;

/** ⭐ the ONE builder. `format('gst-india', 'v1')` → `gst-india@v1`. A missing version defaults to v1. */
function format(key, version) {
  const k = String(key == null ? '' : key).trim();
  if (!k) return '';
  const v = String(version == null ? '' : version).trim() || 'v1';
  return k + SEP + v;
}

/** is this string a `thing@version`? The one question, asked here so nothing else has to know the shape. */
function is(ref) {
  const s = String(ref == null ? '' : ref).trim();
  const at = s.lastIndexOf(SEP);
  return at > 0 && VERSION.test(s.slice(at + 1).toLowerCase());
}

/** `gst-india@v1` → { key: 'gst-india', version: 'v1' }, or null when it is not one. */
function parse(ref) {
  const s = String(ref == null ? '' : ref).trim();
  if (!is(s)) return null;
  const at = s.lastIndexOf(SEP);
  return { key: s.slice(0, at), version: s.slice(at + 1).toLowerCase() };
}

/**
 * ⭐ THE KEY ALONE — this replaces `String(ref).split('@')[0]`, which was written out in three files.
 * ⚠️ It tolerates a bare key with no version, because callers hold both shapes: a boilerplate written before
 * versions were recorded stores `gst-india`, and splitting that on "@" happens to work while meaning nothing.
 * Being explicit about it is the difference between a rule and an accident.
 */
function keyOf(ref) {
  const p = parse(ref);
  return p ? p.key : String(ref == null ? '' : ref).trim();
}

/** the version alone, or null when the ref does not carry one */
function versionOf(ref) {
  const p = parse(ref);
  return p ? p.version : null;
}

module.exports = { format, parse, is, keyOf, versionOf, SEP, VERSION };
