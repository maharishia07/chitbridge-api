// prove-f5.js — OFFLINE proof that AI skills are DATA (F5 closed). node scripts/prove-f5.js
// Stubs the DB to control the ai_skill table, then shows invokeSkill's resolver (getSkill/loadSkills):
//   (1) resolves a NEW skill that exists ONLY as a table row — added by DATA, ZERO code change (the F5 test);
//   (2) treats the table as authoritative; (3) a dropped/orphaned skill is gone; (4) self-heals to the in-code SEED
//   when the table is missing. No model call, no network — pure resolution logic.
const path = require('path');
const dbPath = require.resolve('../db');
let ROWS = [], FAIL = false;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  withEntity: async (e, fn) => fn({ query: async () => ({ rows: [] }) }),
  query: async (sql) => { if (FAIL) { const e = new Error('relation "ai_skill" does not exist'); e.code = '42P01'; throw e; } return { rows: /ai_skill/.test(sql) ? ROWS : [] }; },
} };
const ai = require('../lib/ai');
let P = 0, F = 0; const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };

(async () => {
  console.log('== PROVE F5 — AI skills are DATA ==\n');

  // ── Phase A · table present, with a skill that does NOT exist in code ──
  ROWS = [
    { skill_id: 'export-declaration', category: 'clearance', gate: 'confirm', kind: 'document', format: null, label: 'Export Declaration', system: 'seeded prompt' },
    { skill_id: 'invoice-reminder-v2', category: 'commerce', gate: 'confirm', kind: 'document', format: null, label: 'Payment reminder (data-only skill)', system: 'You draft a polite payment reminder from the invoice JSON.' },
  ];
  await ai.loadSkills(true);
  const brandNew = await ai.getSkill('invoice-reminder-v2');
  chk('F5 · a NEW skill present ONLY as a table row RESOLVES (added by data, zero code)', !!brandNew && brandNew.label === 'Payment reminder (data-only skill)');
  chk('  └ it is NOT in the in-code SEED (proves it came from the table)', !ai.SKILLS['invoice-reminder-v2']);
  chk('table is authoritative — a seeded skill resolves from the table', (await ai.getSkill('export-declaration')) && (await ai.getSkill('export-declaration')).system === 'seeded prompt');
  chk('a skill absent from the table does NOT resolve (retire = a data change)', !(await ai.getSkill('order-review')));
  chk('the 3 dropped orphans are gone (removed from code AND not seeded)', !(await ai.getSkill('incoterm-advice')) && !(await ai.getSkill('spec-draft')) && !(await ai.getSkill('profile-prefill')));
  const list = await ai.listSkills();
  chk('listSkills (the ✨ menu) reflects the TABLE', list.some((s) => s.id === 'invoice-reminder-v2') && !list.some((s) => s.id === 'order-review'));

  // ── Phase B · table MISSING → self-heal to the in-code SEED ──
  FAIL = true;
  await ai.loadSkills(true);
  chk('SELF-HEAL · table missing (pre-b110) → falls back to the in-code SEED', !!(await ai.getSkill('export-declaration')));
  chk('  └ the data-only skill is gone in fallback (it lived only in the table)', !(await ai.getSkill('invoice-reminder-v2')));
  chk('  └ SEED no longer contains the dropped orphans', !(await ai.getSkill('incoterm-advice')));
  chk('SEED size = 24 in-use skills', Object.keys(ai.SKILLS).length === 24, 'count=' + Object.keys(ai.SKILLS).length);

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F + (F ? '' : '   → F5 mechanism is data-driven + provable'));
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
