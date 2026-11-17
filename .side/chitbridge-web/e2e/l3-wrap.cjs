/**
 * l3-wrap.cjs — lift display copy OUT of HTML strings so it can be translated.
 *
 * Athi, 2026-08-19, after seeing the rail turn Arabic and nothing else: *"the menu only changed to arabic, but
 * rest of the content still in english?"*
 *
 * ⭐⭐ TRANSLATION WAS NEVER THE BOTTLENECK — EXTRACTION IS. The words on screen are baked inside markup, where
 * no lookup can reach them:
 *
 *     `<label class="fl">Assignment model</label>`        no function can see those two words
 *     `<label class="fl">${tx('Assignment model')}</label>`   now it can
 *
 * ⚠️ THE TWO QUOTING CONTEXTS NEED DIFFERENT OUTPUT, and getting it wrong breaks the file:
 *
 *     template literal    `...>TEXT<...`     ->  `...>${tx('TEXT')}<...`
 *     concatenation       '...>TEXT<...'     ->  '...>' + tx('TEXT') + '<...'
 *
 * So this does not pattern-match blindly. It WALKS each line tracking which string it is inside and which
 * delimiter opened it, and emits the form that context requires. A regex cannot know that.
 *
 * ⚠️ AND IT REFUSES EVERYTHING IT CANNOT PROVE. No interpolation in the text, no nested markup, no HTML entity,
 * must contain a letter, must not already be wrapped. Every file is re-parsed and reverted WHOLE on failure —
 * the l3-apply lesson, where "the BEFORE appears exactly once" turned out not to mean the BEFORE was a complete
 * expression, and five files broke.
 *
 * Usage:  node e2e/l3-wrap.cjs <file> [fromLine] [toLine]        (no write without --apply)
 */
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const file = process.argv[2];
const from = Number(process.argv[3] || 1);
const to = Number(process.argv[4] || Infinity);
const APPLY = process.argv.includes('--apply');
const SAFE  = process.argv.includes('--safe');
if (!file) { console.log('usage: node e2e/l3-wrap.cjs <file> [from] [to] [--apply]'); process.exit(1); }

const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
const before = fs.readFileSync(abs, 'utf8');
const eol = before.includes('\r\n') ? '\r\n' : '\n';
const lines = before.split(/\r?\n/);

/**
 * ⚠️⚠️ NAMES OF STANDARDS ARE NOT COPY. "CLDR", "WCAG 2.2", "Accept-Language", "-u-nu-" and "Okabe–Ito" are
 * proper nouns and wire values. Translating them would be actively wrong — an Arabic reader looking for the
 * Accept-Language header needs to read "Accept-Language". The first run of this tool offered all five.
 */
const NEVER = /^(CLDR|ICU|WCAG|GS1|ISO|RFC|UTS|BCP|LEI|HS|UN\/?LOCODE|UCP|Incoterms|Okabe|gettext|Intl|ltree|Accept-Language|Content-Language|User-Agent|JSON|CSV|API|URL|OTP|RLS|SKU|PIM|MDM|ERP|IoT|AI)\b/i;
const TOKENISH = /^-u-|^[a-z]{2}(-[A-Za-z0-9]+)+$|^[A-Za-z-]+:[A-Za-z]|^\.?[a-z-]+\(\)$/;

/**
 * ⚠️⚠️ A FRAGMENT IS WORSE THAN AN UNTRANSLATED LABEL. Text inside an inline tag mid-sentence — the "actor" in
 * "…acts as an <b>actor</b> for you" — is half a sentence. Wrapping it hands a translator two pieces that
 * cannot be reassembled in a language that orders them differently, which is the precise thing txf() exists to
 * prevent. So a label must START LIKE A LABEL: a capital, a digit or an emoji. Lowercase means mid-sentence.
 *
 * An em dash opening is the same tell — "— how figures are written" is a clarifier appended to a label that
 * lives outside this element, so it is only half of the phrase a reader sees.
 */
/**
 * ⭐⭐ LABELS ONLY. Athi, 2026-08-19: *"apply only to the labels. Once we confirm that this is the final shape of
 * the product then we can translate those… as a user, nobody wants to know anything from the tool — if they need
 * help they can learn from assistance."*
 *
 * ⚠️ SO A SENTENCE IS REFUSED HERE, not merely left untranslated. Wrapping it would put it in the catalogue,
 * where it looks like work waiting to be done rather than copy waiting to be deleted — and every translator and
 * every future language would then be asked to carry it. e2e/text-budget.cjs measured 6,103 of 10,863 on-screen
 * words as explanation; none of them belong in a catalogue until the shape of the product is settled.
 *
 * The tell is grammatical, not length: a finite verb plus enough words, or terminal punctuation. "Assignment
 * model" is a label. "Grouping is not a separate switch" is a claim about the world.
 */
const FINITE_VERB = /\b(is|are|was|were|be|been|being|has|have|had|does|do|did|can|cannot|will|would|should|must|may|might|means|shows|keeps|stays|belongs|lives|counts|follows|changes|converts|translates|picks|needs|comes|goes|makes|takes|gives|sets|holds)\b/i;

/* ⚠️ AN IMPERATIVE IS A SENTENCE TOO. 'Name each detail the way you know it' has no finite verb and no
   full stop, but it is an instruction, not a label. A button verb is short ('Save vault'); an instruction runs on. */
const IMPERATIVE = /^(Name|Pick|Choose|Set|Add|Use|Tell|Ask|Enter|Type|Select|Give|Check|Make|Keep|Send|Start|Open|Read|Write|Bring|Leave|Drag|Drop|Click|Tap|Review|Confirm|Describe)/i;

function isSentence(s) {
  const t = s.trim();
  if (/[.!?]$/.test(t) && !/\.\.\.$|…$/.test(t)) return true;   // a full stop, but "Loading…" is a label
  const w = t.split(/\s+/).length;
  if (IMPERATIVE.test(t) && w >= 5) return true;                // an instruction, not a button
  return FINITE_VERB.test(t) && w >= 4;
}

function isCopy(s) {
  if (!s || s.length < 3 || s.length > 90) return false;
  if (isSentence(s)) return false;                       // explanations wait for the trim
  if (!/[A-Za-z]/.test(s)) return false;                 // must contain a letter
  if (/\$\{|<|>|&[a-z#]+;/.test(s)) return false;        // interpolation, nested markup, entities
  if (/^\s|\s$/.test(s)) return false;                   // leading/trailing space changes layout
  if (NEVER.test(s) || TOKENISH.test(s)) return false;
  if (/^[—–-]/.test(s)) return false;                    // a trailing clarifier, not a whole phrase
  /* ⚠️ ENDING mid-sentence is the same fault as starting mid-sentence: 'Carried is not the same as enforced,'
     continues OUTSIDE this element, so wrapping it hands over half a sentence. */
  if (/[,;:]$/.test(s)) return false;
  if (!/^[A-Z0-9À-ɏ\u{1F300}-\u{1FAFF}←-➿]/u.test(s)) return false;  // lowercase = mid-sentence
  if (/^[A-Z_]+$/.test(s) && s.length < 4) return false; // a token, not a word
  if (/^(px|em|rem|auto|none|flex|grid|block|inline|bold|solid|center|left|right|start|end)$/i.test(s)) return false;
  return true;
}

const hits = [];
let n = 0;

/**
 * ⚠️⚠️ A TEMPLATE LITERAL SPANS LINES, AND THIS FILE IS FULL OF THEM. The first version reset the string state
 * at every newline, so it never saw itself as "inside a string" on the continuation lines — and silently skipped
 * exactly the labels this run exists for:
 *
 *     return `<div class="card">
 *       <label class="fl">Assignment model</label>      <-- invisible to a line-local scanner
 *     </div>`;
 *
 * It reported 26 found and looked like it had worked. A scanner that under-reports is the worst kind, because
 * the number is plausible. Backtick state now carries ACROSS lines; ' and " cannot span a line in JS, so those
 * still reset — which is also what makes the carry safe.
 */
/* the context stack survives line breaks — only a template literal can legally span them */
let stack = [];
let inBlockComment = false;

/**
 * ⚠️⚠️ AN .html FILE IS NOT JAVASCRIPT, AND TREATING IT AS SUCH IS WHY app.html KEPT REVERTING. Outside a
 * <script> block, " and ' are ATTRIBUTE delimiters — `<div class="x">` opens no string. Feeding that to a JS
 * string scanner leaves it convinced it is inside a string for the rest of the file, after which every rewrite
 * is placed by a fiction.
 *
 * So for HTML, only lines inside an inline <script> are eligible, and the stack is emptied at every boundary:
 * script blocks do not share string state with each other or with the markup between them.
 */
const isHtml = /\.html?$/i.test(abs);
const scriptLines = new Set();
if (isHtml) {
  let inScript = false;
  lines.forEach((l, i) => {
    const opens = /<script(?![^>]*\bsrc=)[^>]*>/i.test(l);
    const closes = /<\/script>/i.test(l);
    if (opens && !closes) { inScript = true; return; }
    if (closes) { inScript = false; return; }
    if (inScript) scriptLines.add(i + 1);
  });
}

const out = lines.map((line, idx) => {
  const ln = idx + 1;
  /**
   * ⭐ --safe RESETS THE STATE AT EVERY LINE, so only strings that open AND close on one line are eligible.
   *
   * ⚠️ app.html defeated the full scanner and I stopped trying to win. Its render functions nest a template
   * inside a ${…} inside a ternary inside a multi-line block comment whose prose quotes CSS in backticks; each
   * fix revealed the next layer, and every wrong guess showed up 200 lines away from its cause. A scanner that
   * is right about 90% of a file is not 90% useful — one bad rewrite reverts the whole file.
   *
   * So this trades recall for certainty: it cannot be wrong about which quote encloses the text, because it
   * only looks at text whose quotes it has both seen. Fewer labels, no fiction.
   */
  if (SAFE) { stack = []; inBlockComment = false; }
  if (isHtml && !scriptLines.has(ln)) { stack = []; return line; }
  /**
   * ⚠️⚠️ A LINE STARTING WITH * IS ONLY A COMMENT IN CODE CONTEXT. Inside a template literal it is CONTENT —
   * this codebase embeds long HTML comments inside its templates, and their continuation lines start with * and
   * with //. Skipping those without scanning meant the template's CLOSING backtick was never seen, so the
   * scanner stayed "inside a template" for the remaining 200 lines and emitted the template form into
   * single-quoted strings. That is the whole reason app.html would not parse, and the symptom appeared 230
   * lines after the cause.
   *
   * So the guard applies only when nothing is open.
   */
  if (!stack.length && /^\s*(\*|\/\/|\/\*)/.test(line)) { return line; }

  /* a block comment opened on an earlier line runs until its terminator, wherever that turns out to be */
  if (inBlockComment) {
    if (line.indexOf('*/') === -1) return line;
    inBlockComment = false;
    return line;                                       // the tail is code again, but rewriting it is not worth it
  }

  let res = '';
  let i = 0;
  const inRange = ln >= from && ln <= to;

  while (i < line.length) {
    const c = line[i];
    const top = stack.length ? stack[stack.length - 1] : null;
    const quote = top && top.q ? top.q : null;             // the delimiter that opened the current string

    /* escape inside a string — copy both chars, judge neither */
    if (quote && c === '\\') { res += line.slice(i, i + 2); i += 2; continue; }

    /* ── expression context: ${ … } inside a template. Quotes work normally in here. ── */
    if (top && top.expr) {
      if (c === '{') { top.depth++; res += c; i++; continue; }
      if (c === '}') {
        if (top.depth === 0) { stack.pop(); res += c; i++; continue; }
        top.depth--; res += c; i++; continue;
      }
    }

    /**
     * ⚠️⚠️ COMMENTS AND REGEX LITERALS ARE NOT STRINGS, AND MISSING THEM CORRUPTS EVERYTHING AFTER.
     *
     * A backtick or apostrophe inside `// don't` or inside /[`'"]/ pushed a phantom string onto the stack and it
     * was never popped. Thousands of lines later the scanner still believed it was inside a template, so at
     *
     *     return '<div class="grp">Mailbox</div>' + …
     *
     * it emitted the TEMPLATE form ${tx('Mailbox')} into a SINGLE-QUOTED string, and app.html would not parse.
     * The failure surfaced 3,595 lines away from its cause, which is exactly why a scanner needs to model the
     * language rather than pattern-match it.
     */
    if (!quote) {
      if (c === '/' && line[i + 1] === '/') { res += line.slice(i); break; }
      /**
       * ⚠️⚠️ A BLOCK COMMENT SPANS LINES AND THIS ONE CONTAINED BACKTICKS. Inside a ${…} expression sits a long
       * /* … *␘/ comment whose prose quotes CSS in backticks — `color:var(--on-card)`. Handling only the
       * single-line case meant the continuation lines were scanned as CODE, each backtick pushing a phantom
       * template onto the stack. The state has to persist.
       */
      if (c === '/' && line[i + 1] === '*') {
        const end = line.indexOf('*/', i + 2);
        if (end === -1) { inBlockComment = true; res += line.slice(i); break; }
        res += line.slice(i, end + 2); i = end + 2; continue;
      }
      /* a regex literal — only where one may legally begin, so `a / b` stays division */
      if (c === '/' && /[(,=:[!&|?{};+\-*%~^]\s*$|\b(return|typeof|case|in|of|do|else)\s*$/.test(res)) {
        let j = i + 1, cls = false;
        while (j < line.length) {
          const d = line[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '[') cls = true;
          else if (d === ']') cls = false;
          else if (d === '/' && !cls) break;
          j++;
        }
        if (j < line.length) { res += line.slice(i, j + 1); i = j + 1; continue; }
      }
    }

    if (!quote && (c === '"' || c === "'" || c === '`')) { stack.push({ q: c }); res += c; i++; continue; }
    if (quote && c === quote) { stack.pop(); res += c; i++; continue; }

    /**
     * ⚠️⚠️ ${ } OPENS A FRESH CONTEXT AND THE FIRST SCANNER DID NOT KNOW IT. Inside a template's expression a
     * single-quoted string is an ordinary string — so this is legal and common in this codebase:
     *
     *     `…${x.otp ? '<span …>⏳ invite</span>' : ''}…`
     *
     * Seeing only "we are inside a backtick", the scanner emitted the TEMPLATE form, ${tx('⏳ invite')}, into a
     * SINGLE-QUOTED string. The quote in tx(' closed that string and the rest became bare code. That is why
     * app.html (328 labels) and cap-workforce.js (50) both reverted — one construct, the two largest files.
     */
    if (quote === '`' && c === '$' && line[i + 1] === '{') {
      stack.push({ expr: true, depth: 0 });
      res += '${'; i += 2; continue;
    }

    /* inside a string, and at the end of a tag: try to take the text up to the next '<' */
    if (quote && c === '>') {
      const close = line.indexOf('<', i + 1);
      if (close > i + 1) {
        const text = line.slice(i + 1, close);
        /* the text must not run past the end of this string */
        const q = line.indexOf(quote, i + 1);
        /**
         * ⚠️ THE RANGE GATES THE REWRITE, NOT THE SCAN. The scanner must walk the WHOLE file to know whether a
         * given line sits inside an open template literal — start it at line 2009 and it has no idea what is
         * open. So every line is read; only lines in range are changed.
         */
        if (inRange && !(q !== -1 && q < close) && isCopy(text) && !/\btx\(/.test(text)) {
          const lit = "tx('" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "')";
          res += '>' + (quote === '`' ? '${' + lit + '}' : quote + ' + ' + lit + ' + ' + quote);
          hits.push({ ln, text });
          n++;
          i = close;
          continue;
        }
      }
    }
    res += c; i++;
  }
  /* ⚠️ A ' or " left open at end of line means the scan lost track — drop back to code rather than carry a
     wrong state into the next line, where it would rewrite something that is not a string at all. */
  while (stack.length && stack[stack.length-1].q && stack[stack.length-1].q !== String.fromCharCode(96)) stack.pop();
  return res;
});

console.log('\n  ' + n + ' label(s) liftable in ' + path.basename(file) + ' lines ' + from + '-' + (to === Infinity ? 'end' : to));
hits.slice(0, 60).forEach((h) => console.log('    ' + String(h.ln).padStart(5) + '  ' + h.text));
if (hits.length > 60) console.log('    … and ' + (hits.length - 60) + ' more');

if (!APPLY) { console.log('\n  (dry run — pass --apply to write)\n'); process.exit(0); }
if (!n) { console.log('\n  nothing to do\n'); process.exit(0); }

fs.writeFileSync(abs, out.join(eol));
let ok = true;
if (/\.js$/.test(abs)) {
  try { cp.execSync('node -c "' + abs + '"', { stdio: 'pipe' }); } catch (_) { ok = false; }
} else {
  const RE = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  const s = out.join(eol);
  let m;
  while ((m = RE.exec(s))) { try { new Function(m[1]); } catch (_) { ok = false; break; } }
}
if (!ok) {
  /* ⚠️ --keep LEAVES THE BROKEN OUTPUT so the failure can be READ. Reverting is right by default and useless
     for diagnosis: it destroys the only evidence of what the transform got wrong. Never use it on a real file. */
  if (process.argv.includes('--keep')) { console.log('\n  PARSE FAILED — output KEPT for diagnosis\n'); process.exit(1); }
  fs.writeFileSync(abs, before);
  console.log('\n  PARSE FAILED — file reverted whole, nothing changed\n');
  process.exit(1);
}
console.log('\n  applied and parses clean\n');
