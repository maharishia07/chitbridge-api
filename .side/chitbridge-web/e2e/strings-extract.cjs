/**
 * strings-extract.cjs — find every English string a reader can see, and say which ones can be translated ALONE.
 *
 * ⚠️ THE DISTINCTION THIS TOOL EXISTS TO DRAW. A translatable string is not "any English text in the source".
 * Most of this app's prose is built by concatenation:
 *
 *     "<b>" + n + " products</b> in " + esc(cat) + " — <a>change</a>"
 *
 * The fragments there ("products", "in", "change") are NOT translatable units. Handed to a translator they are
 * unanswerable: German needs the number after the noun, Tamil needs a different case ending, and "in" alone has
 * no meaning to translate. Wrapping fragments produces confident nonsense — which is worse than English, because
 * English is at least honestly foreign, while broken Tamil looks like the product is careless.
 *
 * So this reports three classes, and only the first is safe to wrap mechanically:
 *
 *   SELF-CONTAINED  a complete label with no interpolation and no markup — "Save", "No products yet"
 *   INTERPOLATED    contains ${...} or is concatenated — needs a placeholder form before it can be translated
 *   FRAGMENT        starts or ends mid-sentence, or is a lone connective — needs the SENTENCE reassembling first
 *
 * ⚠️ IT ALSO EXCLUDES USER DATA BY CONSTRUCTION. Anything inside esc(...) is somebody's product name or chit
 * subject. A chit is a SHARED record; one that reads differently to each party is not a record.
 *
 * Run: node e2e/strings-extract.cjs [--list]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(ROOT, 'app')).filter((f) => /\.js$/.test(f)).map((f) => 'app/' + f)
);

/* Words that are never UI copy however they are quoted — token names, keys, states, css. */
const NOT_COPY = /^(#|--|\.|\/|https?:|data:|[a-z-]+:[a-z0-9]|var\(|[0-9.]+(px|em|rem|%|s|fr)?$)/i;
const CSSISH = /[:;{}]|^\s*$|^[a-z-]+$/;
/* A visible label has letters, at least one of which starts a word, and is not an identifier. */
const LOOKS_LABEL = /^[A-Z][A-Za-z]/;

const results = { self: [], prose: [], interp: [], frag: [], skipped: 0 };

/** A fragment: no terminal punctuation AND begins lower-case, or is a bare connective. */
const CONNECTIVE = /^(in|of|and|or|to|for|by|on|at|the|a|an|from|with|is|are|was|were)$/i;

for (const rel of FILES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = src.split(/\r?\n/);

  lines.forEach((line, n) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;                 // comments are not shipped copy

    /* Text sitting between tags inside a quoted chunk — the shape almost all of this app's labels take. */
    const re = />([^<>{}$"'`]{2,80})<(\/?)([a-zA-Z]*)/g;
    let m;
    while ((m = re.exec(line))) {
      const s = m[1].trim();
      /**
       * ⭐⭐ THE STRUCTURE ANSWERS WHAT LANGUAGE CANNOT. No amount of reading "A chit is a shared record" tells a
       * scanner whether it is a heading or the first third of a sentence — it is 25 characters, capitalised, and
       * unpunctuated either way. But the MARKUP knows: text followed by a CLOSING tag is the whole content of its
       * element, while text followed by an OPENING inline tag (<b>, <a>, <i>) has more of the same sentence
       * coming after it. That is a fact about the document, not a guess about the prose, and it is what finally
       * separated the labels from the sentence-heads that had been passing every linguistic test I wrote.
       */
      const continues = m[2] !== '/' && /^(b|i|em|strong|a|span|code|u|small|sup|sub)$/i.test(m[3]);
      if (continues) { results.frag.push({ rel, n: n + 1, s }); continue; }
      if (!s || NOT_COPY.test(s) || CSSISH.test(s)) { results.skipped++; continue; }
      if (!/[A-Za-z]/.test(s)) { results.skipped++; continue; }
      /* ⚠️ THE FIRST CHARACTER DECIDES IT, and my first version got this wrong in a way worth recording. It
         asked only "does this end in a full stop?", so a CONTINUATION like "— the entity inherits it via the
         boilerplate." was filed as a complete label: it ends in a stop, so it looked finished. It is the tail of
         a sentence whose head is in another string, and translating it alone is impossible in any language that
         does not share English's word order. A translatable unit must also BEGIN at a beginning. */
      if (!/^[A-Z0-9À-ɏ]/.test(s) || CONNECTIVE.test(s) || /^[—–\-,.;:)\]]/.test(s)) {
        results.frag.push({ rel, n: n + 1, s });
        continue;
      }
      /* Ends mid-thought: no terminal punctuation and long enough to be prose rather than a label. */
      if (s.length > 45 && !/[.!?:]$/.test(s)) { results.frag.push({ rel, n: n + 1, s }); continue; }
      const hasInterp = /\$\{|"\s*\+|\+\s*"|esc\(/.test(line.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12));
      if (hasInterp) { results.interp.push({ rel, n: n + 1, s }); continue; }

      /**
       * ⚠️⚠️ THE HONEST SPLIT, and it is the finding of this whole exercise. A LABEL is short, has no sentence
       * punctuation, and stands alone: "Save", "Suppliers", "Trade readiness". Those can be handed to a
       * translator today and come back correct.
       *
       * PROSE cannot. Almost every explanatory sentence in this app is written as HTML with inline emphasis —
       * "A chit is a <b>shared record</b> between you and…" — so the source contains a sentence HEAD, then a
       * bolded middle, then a tail, as three separate strings. Each ends up looking self-contained to any
       * scanner, and each is untranslatable alone: word order differs in every target language, so a translator
       * given the head cannot know what follows it. Wrapping these mechanically would produce three confidently
       * translated fragments that reassemble into nonsense — worse than leaving them in English, because English
       * is honestly foreign while broken Tamil looks like carelessness.
       *
       * ⭐ So prose is reported, NOT wrapped. Reassembling those sentences into whole units with placeholders is
       * real editorial work on the source, not an extraction pass.
       */
      const isLabel = s.length <= 32 && !/[.!?]/.test(s) && /^[A-Z0-9À-ɏ]/.test(s)
        && !/&&|\|\||=>|\bvar\b|\bfunction\b/.test(s);
      (isLabel ? results.self : results.prose).push({ rel, n: n + 1, s });
    }
  });
}

const uniq = (a) => {
  const seen = new Map();
  a.forEach((x) => { if (!seen.has(x.s)) seen.set(x.s, x); });
  return [...seen.values()];
};

const self = uniq(results.self), prose = uniq(results.prose), interp = uniq(results.interp), frag = uniq(results.frag);

console.log('\n══ TRANSLATABLE STRINGS ══');
console.log('  LABEL            ' + String(self.length).padStart(5) + '   short, standalone — safe to wrap and translate today');
  console.log('  PROSE            ' + String(prose.length).padStart(5) + '   sentences split by inline markup — need reassembling first');
console.log('  INTERPOLATED     ' + String(interp.length).padStart(5) + '   need a placeholder form first ("{n} products")');
console.log('  FRAGMENT         ' + String(frag.length).padStart(5) + '   need the SENTENCE reassembling before they mean anything');
console.log('  not copy         ' + String(results.skipped).padStart(5) + '   tokens, css, urls, numbers — correctly ignored\n');

if (process.argv.includes('--list')) {
  console.log('── SELF-CONTAINED ──');
  self.sort((a, b) => a.s.localeCompare(b.s)).forEach((x) => console.log('  ' + x.s.padEnd(46) + x.rel + ':' + x.n));
}
if (process.argv.includes('--frag')) {
  console.log('\n── FRAGMENTS (do NOT wrap these) ──');
  frag.slice(0, 60).forEach((x) => console.log('  ' + x.s.padEnd(46) + x.rel + ':' + x.n));
}

/* A machine-readable catalogue, in the shape a translator's tool expects: one entry per msgid with its sources.
   ⚠️ gettext's model, deliberately — the ENGLISH IS THE KEY. Inventing our own key names would mean every new
   label needs a naming decision, and a key that drifts from its English is a label nobody can find. */
const out = self.sort((a, b) => a.s.localeCompare(b.s))
  .map((x) => ({ msgid: x.s, source: x.rel + ':' + x.n }));
fs.writeFileSync(path.join(__dirname, 'strings.catalogue.json'), JSON.stringify(out, null, 1));
console.log('\ncatalogue written: e2e/strings.catalogue.json (' + out.length + ' entries)\n');
