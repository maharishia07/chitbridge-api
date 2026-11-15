'use strict';
// OWNS      ADOPTERS: the one declaration of who may mark what (MARK-AND-QUERY section 3): per adopter its subject, vocabulary, who sets / reads / replies, and its change detector · checkAdopters(registry, schema) the CI check · adopterOf(key)
// CALLED BY lib/review-mark.js · lib/mark-policies.js · routes/marks.js · routes/books.js (marksFor on the day book and the ledger) · tests/mark-adopters.test.cjs
// FLOW      declaration (here) → adopterOf(key) → the core reads it; the CI check refuses an entry that cannot work (no detector, a word mapped to no class, an empty `set`, a table or column the schema does not know)
// CARD      capability/MARK-AND-QUERY-CAPABILITY
/**
 * ⚠️ A REVIEWED FILE, not data: the policies are access control (SEC-117). Adding an adopter is one entry here and its labels in the locale files; the core (lib/review-mark.js, migration b868, web cap-mark.js) never changes.
 *
 * subject     { table, id, label[], date? }       the record being marked: its table, its id column, the columns that name it for a person, and (for the period count) the date column
 * vocabulary  { <kind>: { class, label, note } }  the adopter's words, each mapped to ONE neutral class (clear | open | hold | reject | removed); note: none | optional | required
 * set / read / reply   policy forms (lib/mark-policies.js): who may add a mark, who may read it, who may answer in the thread
 * change      { how: seal | version | successor, ... }  EXACTLY ONE detector; "none" is not a form
 *               successor: { column, who, at, label } the insert-only subject is reversed by a later row whose `column` names it; who/when = that row's `who` and `at`
 *               version:   { columns[] }              a version or revision column (or a list)
 *               seal:      { fields[] }               canon.seal over the listed fields
 * words      { set, reply, closed, notFound }   the sentences a refusal says in this adopter's own words (the core holds none of them)
 * visible_to_readers 'at_once'   a value, so a hidden-until-released adopter is config, not code
 * allow_removed, bulk  booleans
 */
const CLASSES = ['clear', 'open', 'hold', 'reject', 'removed'];
const NOTES = ['none', 'optional', 'required'];
const HOWS = ['seal', 'version', 'successor'];
const IDENT = /^[a-z_][a-z0-9_]*$/;

const ADOPTERS = {
  'acc.audit': {
    subject: { table: 'journal_entry', id: 'entry_id', label: ['entry_no', 'posting_date'], date: 'posting_date' },
    vocabulary: {
      checked: { class: 'clear', label: 'Checked', note: 'none' },
      query: { class: 'open', label: 'Query', note: 'required' },
      on_hold: { class: 'hold', label: 'On hold', note: 'optional' },
      removed: { class: 'removed', label: 'Mark removed', note: 'optional' }
    },
    set: ['grant:auditor'],
    read: ['subject'],
    reply: ['level:owner', 'grant:adviser', 'grant:auditor'],
    change: { how: 'successor', column: 'reverses_entry_id', who: 'created_by', at: 'created_at', label: 'entry_no' },
    words: {
      set: 'Only the auditor can mark an entry. You can read the marks and answer a query.',
      reply: 'Only the owner, the adviser and the auditor take part in a query.',
      closed: 'This query is closed. The auditor can open it again by marking the entry.',
      notFound: 'We could not find that entry in these books.'
    },
    visible_to_readers: 'at_once',
    allow_removed: true,
    bulk: false
  }
};

const adopterOf = (key) => (Object.prototype.hasOwnProperty.call(ADOPTERS, key) ? ADOPTERS[key] : null);
const keys = () => Object.keys(ADOPTERS);

/** the vocabulary as the web reads it: [{ kind, label, class, note }] */
const vocabularyOf = (adopter) => Object.entries(adopter.vocabulary).filter(([, word]) => word.class !== 'removed' || adopter.allow_removed).map(([kind, word]) => ({ kind, label: word.label, class: word.class, note: word.note }));

/** the columns the detector reads on the subject table (checked to exist) */
function detectorColumns(change) {
  if (change.how === 'successor') return [change.column, change.who, change.at, change.label].filter(Boolean);
  if (change.how === 'version') return change.columns || [];
  if (change.how === 'seal') return change.fields || [];
  return [];
}

/** the forms lib/mark-policies.js can answer today: an adopter naming any other fails the check rather than failing open */
const KNOWN_FORM = /^(subject|level:(owner|editor)|grant:(auditor|adviser))$/;

/**
 * checkAdopters(registry, schema) → the list of faults ([] = honest). schema = { hasTable(name), hasColumn(table, column) } (lib/schema); the CI test passes a stub or the real one.
 * Faults: no detector or two · a vocabulary word mapped to no class · an empty `set` · a policy form nobody answers · a subject table or column the schema does not know · an identifier that is not plain.
 */
async function checkAdopters(registry, schema) {
  const faults = [];
  for (const [key, adopter] of Object.entries(registry)) {
    const say = (what) => faults.push(key + ': ' + what);
    if (!/^[a-z]+\.[a-z_]+$/.test(key)) say('the key is not area.name');
    const subject = adopter.subject || {};
    for (const part of ['table', 'id']) if (!IDENT.test(subject[part] || '')) say('subject.' + part + ' is missing or not a plain name');
    if (!Array.isArray(subject.label) || !subject.label.length) say('subject.label names no column');
    const vocab = adopter.vocabulary || {};
    if (!Object.keys(vocab).length) say('no vocabulary');
    for (const [kind, word] of Object.entries(vocab)) {
      if (!CLASSES.includes(word.class)) say('the word ' + kind + ' is mapped to no class');
      if (!NOTES.includes(word.note)) say('the word ' + kind + ' says nothing about its note');
      if (!word.label) say('the word ' + kind + ' has no label');
      if (word.class === 'removed' && !adopter.allow_removed) say('the word ' + kind + ' is "removed" but allow_removed is not set');
    }
    for (const lane of ['set', 'read', 'reply']) {
      const forms = adopter[lane];
      if (!Array.isArray(forms) || !forms.length) say('`' + lane + '` names no policy');
      else for (const form of forms) if (!KNOWN_FORM.test(form)) say('`' + lane + '` names a policy nothing answers: ' + form);
    }
    const change = adopter.change || {};
    if (!HOWS.includes(change.how)) say('no change detector (seal, version or successor; "none" is not a form)');
    else {
      const needed = detectorColumns(change);
      if (!needed.length) say('the ' + change.how + ' detector names no column');
      for (const column of needed) if (!IDENT.test(column)) say('detector column is not a plain name: ' + column);
    }
    for (const word of ['set', 'reply', 'closed', 'notFound']) if (!(adopter.words || {})[word]) say('words.' + word + ' is missing');
    if (adopter.visible_to_readers !== 'at_once') say('visible_to_readers has no value this build answers');
    if (IDENT.test(subject.table || '') && schema) {
      if (!(await schema.hasTable(subject.table))) say('subject.table ' + subject.table + ' is not a table the schema knows');
      else {
        const cols = [subject.id, ...(subject.label || []), subject.date, ...detectorColumns(change)].filter(Boolean);
        for (const column of cols) if (!(await schema.hasColumn(subject.table, column))) say('column ' + subject.table + '.' + column + ' does not exist');
      }
    }
  }
  return faults;
}

module.exports = { ADOPTERS, CLASSES, adopterOf, keys, vocabularyOf, detectorColumns, checkAdopters, KNOWN_FORM };
