/**
 * tests/support/books-memory-outbox.cjs — the outbox reads of the in-memory books store (moved out of books-memory.cjs, 21 Nov 2026, filesize ratchet).
 * OWNS      todoOf · nameOf · openRowsOf: the real store's TODO_SQL / NAME_SQL and OPEN_ROWS_SQL, read the same way over the twin's outbox rows
 * CALLED BY tests/support/books-memory.cjs (the in-memory books store)
 * CARD      14-accounting/books-health-to-do-outbox
 */
'use strict';
/* the real store's TODO_SQL / NAME_SQL, read the same way over one in-memory row */ const todoOf = (o) => { const ev = o.event || {}; if (ev.todo) return ev.todo;
  return ev.waiting === 'acceptance' ? 'accept' : ev.waiting === 'party' && /^Who is /.test(String(o.why || '')) ? 'add_supplier' : 'record'; };
const nameOf = (o) => { if (todoOf(o) !== 'add_supplier') return null; const ev = o.event || {}; if (ev.name) return ev.name;
  const m = /^Who is (.+)\? Add them as a supplier/.exec(String(o.why || '')); return m ? m[1] : null; };
/* the real store OPEN_ROWS_SQL over the twin: the newest open row of each chit (or of each source_ref with no chit) */
const openRowsOf = (T, e) => { const kept = new Map(); T.outbox.filter((o) => o.entity_id === e && !o.done_at).forEach((o) => { const k = String(o.source_chit_id || o.source_ref || "id:" + o.id); if (!kept.has(k) || kept.get(k).id < o.id) kept.set(k, o); }); return [...kept.values()]; };
module.exports = { todoOf, nameOf, openRowsOf };
