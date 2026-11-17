'use strict';
/** an in-memory template table with the real module's store functions (b281 stood in); `migrated` is the switch the 503 test flips */
function memoryTemplates() {
  const rows = []; let seq = 0; const m = { migrated: false, rows };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const gone = () => { const e = new Error('relation "recurring_entry" does not exist'); e.code = '42P01'; throw e; };
  m.store = {
    async exists() { return m.migrated; },
    async list(h, e) { if (!m.migrated) gone(); return clone(rows.filter((r) => r.entity === e)); },
    async get(h, e, id) { if (!m.migrated) gone(); const r = rows.find((x) => x.entity === e && x.recurring_id === id); return r ? clone(r) : null; },
    async insert(h, e, t) {
      if (!m.migrated) gone();
      const r = { entity: e, recurring_id: '66666666-6666-4666-8666-' + String(++seq).padStart(12, '0'), name: t.name, event: clone(t.event), frequency: t.frequency, next_on: t.next_on, anchor_day: t.anchor_day,
        end_on: t.end_on || null, auto: !!t.auto, active: t.active !== false, last_done_on: null, created_by: t.created_by || null };
      rows.push(r); return clone(r);
    },
    async update(h, e, id, p) { if (!m.migrated) gone(); const r = rows.find((x) => x.entity === e && x.recurring_id === id); if (!r) return null; Object.assign(r, clone(p)); return clone(r); },
  };
  return m;
}

module.exports = { memoryTemplates };
