// @stage tested
// @stage-note The ONE place that answers "what may this identity do". Pure; no DB. Self-healing pre-b173.
'use strict';
/**
 * access.js — Viewer · Commenter · Editor, adopted from Google Workspace.
 *
 * Athi, 2026-08-20: *"if at all any standards to follow or how other platform quotes, example servicenow,
 * then follow that, that would be better."*
 *
 *     viewer      reads. Nothing else.
 *     commenter   reads, and may say something INTERNALLY. Cannot answer the other party.
 *     editor      changes records, and messages anyone — inside or outside.
 *
 * ⭐⭐ ATHI DESCRIBED "COMMENTER" WITHOUT HAVING A NAME FOR IT — *"read only is internal messaging only, not
 * external messaging"*. When a description lands on a standard's definition unprompted, the standard is the
 * right one to adopt. Google's three are also pure CAPABILITY words with no job title in them, which is the
 * property that matters: the defect this replaces was five ROLE words masquerading as permissions.
 *
 * ⚠️ ONE PLACE, BECAUSE THERE WERE EIGHTEEN. `'manager'`, `'audit'`, `'mis'`, `'view_only'` appeared as string
 * literals across six files. Any new rule had to be remembered in all of them, and the hat gate already
 * shipped one bug that every unit test passed. A second call site is a helper — this is the eighteenth.
 *
 * ⚠️ SELF-HEALING ACROSS b173. Code deploys before Athi runs migrations, always. So an identity with no
 * `access_level` is derived from its old `hat`, and the answer is identical either side of the migration.
 *
 * ── ZERO DEPENDENCIES · TIER A ──────────────────────────────────────────────────────────────────────────
 */

const VIEWER = 'viewer', COMMENTER = 'commenter', EDITOR = 'editor';
const LEVELS = [VIEWER, COMMENTER, EDITOR];

/** How much each level may do. A cap compares these; nothing else should compare the strings. */
const RANK = { [VIEWER]: 0, [COMMENTER]: 1, [EDITOR]: 2 };

/** The old five, and what each really was. Kept only for the pre-b173 fallback. */
const FROM_HAT = {
  act: EDITOR, manager: EDITOR,
  audit: COMMENTER, mis: COMMENTER, view_only: COMMENTER,
};

/**
 * levelOf(identity) — the one function that decides.
 *
 * ⚠️ AN ENTITY IS ALWAYS AN EDITOR. It owns its own records; there is no level above it to grant one.
 * ⚠️ AND AN ABSENT LEVEL MEANS EDITOR, not viewer — matching what POST /actors writes when no level is given,
 * so anyone created before the column existed keeps exactly today's access. A hardening that silently demotes
 * existing staff is an outage, not a hardening.
 */
function levelOf(identity) {
  if (!identity) return VIEWER;                       // no identity at all → the least
  if (identity.identity_type !== 'actor') return EDITOR;
  const lvl = identity.access_level;
  if (LEVELS.includes(lvl)) return lvl;
  const fromHat = FROM_HAT[identity.hat];             // pre-b173
  return fromHat || EDITOR;
}

/** May this identity change records? */
function canEdit(identity) { return levelOf(identity) === EDITOR; }

/**
 * May this identity send a message on this thread?
 *
 * ⚠️ THE INTERNAL/EXTERNAL LINE CANNOT LIVE IN THE HAT GATE, which is why this takes the thread type. Both go
 * through ONE endpoint distinguished by a BODY field, and a path gate never sees a body. A permission that
 * depends on the CONTENT of a request has to be decided where the content is readable.
 */
function canMessage(identity, threadType) {
  const lvl = levelOf(identity);
  if (lvl === VIEWER) return false;                   // a viewer reads and says nothing
  if (threadType === 'external') return lvl === EDITOR;
  return true;                                        // internal: commenter and editor
}

/**
 * May this identity raise a dispute?
 *
 * ⚠️ NO, UNLESS THEY EDIT. Athi, 2026-08-20: *"read only cannot raise a dispute as he is auditing, he cannot
 * go and ask questions directly to anyone else. He is internal gate keeper."* An auditor who opens a dispute
 * is not auditing, they are participating.
 */
function canRaiseDispute(identity) { return canEdit(identity); }

/** Does this identity's reach ignore its placement node? ENTITY-WIDE ONLY — never across entities (§28). */
function seesWholeEntity(identity) {
  if (!identity) return false;
  if (identity.identity_type !== 'actor') return true;   // the entity sees its own whole self
  return identity.whole_entity === true;
}

/**
 * PRESETS — what a person picks on screen. A job title is a COMBINATION of facts, which is exactly why it
 * never belonged in the permission column. Five names could not express "an editor who sees every branch";
 * two flags and three levels can, and needed no new word for it.
 */
const PRESETS = [
  { key: 'auditor',   label: 'Auditor',          level: COMMENTER, whole_entity: true,  can_see_costs: true,
    why: 'Reads everything across the business, including money. Replies internally only.' },
  { key: 'reports',   label: 'Reports / MIS',    level: COMMENTER, whole_entity: true,  can_see_costs: false,
    why: 'Reads everything across the business. No prices or margin.' },
  { key: 'view_only', label: 'View-only',        level: VIEWER,    whole_entity: false, can_see_costs: false,
    why: 'Looks at their own work and says nothing.' },
  { key: 'counter',   label: 'Counter staff',    level: EDITOR,    whole_entity: false, can_see_costs: false,
    why: 'Does the work at their own node. Messages anyone.' },
  { key: 'regional',  label: 'Regional manager', level: EDITOR,    whole_entity: true,  can_see_costs: true,
    why: 'Does the work and sees every branch. The old five hats could not express this at all.' },
];

module.exports = {
  VIEWER, COMMENTER, EDITOR, LEVELS, RANK, FROM_HAT, PRESETS,
  levelOf, canEdit, canMessage, canRaiseDispute, seesWholeEntity,
};
