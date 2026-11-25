'use strict';
/* tools/move-proof.cjs — proves a route handler is the same code as before, only moved or tidied in a provable way
 * OWNER     cb-api
 * OWNS      the proof that a route's handler text is the same code as before, only in another place or spelled in one of four provable ways.
 *           Pure functions, no files, no git: tools/api-resign-moves.cjs hands in the handler texts of the base and of the head.
 * CALLED BY tools/api-resign-moves.cjs (D1, batch 1130) · tests/move-proof.test.cjs
 * FLOW      each handler text ──▶ tokens (comments and whitespace gone) ──▶ levels, each built on the one before, the first that makes both sides equal names the proof:
 *             0 verbatim            the same tokens (the handler moved to another file, or only comments and layout changed)
 *             1 require-path        every relative require() path resolves to the same repo file (the handler's own file moved a folder)
 *             2 declaration-join    `const a = 1; const b = 2;` and `const a = 1, b = 2;` are one program
 *             3 local-rename        identifiers the handler itself declares (const/let/var, parameters, catch) renamed with EVERY use; never a property, key or shorthand
 *           anything else (a call swapped, a line added, a helper extracted) is NOT proven and stays for a human.
 * CARD      28-platform-and-operations/api-standard
 */
const posix = require('path').posix;

const KEYWORDS = new Set('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield await async static get set null true false undefined'.split(' '));
const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do']);
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
const DECLARE_WORDS = new Set(['const', 'let', 'var']);

const isPunct = (token, value) => !!token && token.t === 'p' && token.v === value;
const valueAt = (tokens, at) => (tokens[at] || {}).v;
const isOpening = (token) => !!token && token.t === 'p' && OPEN.has(token.v);
const isClosing = (token) => !!token && token.t === 'p' && CLOSE.has(token.v);

/** the end of a quoted string that starts at `at` (the closing quote's index) */
function stringEnd(text, at) {
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === text[at]) return i;
  }
  return text.length - 1;
}

/** a regex literal may start here: the token before it is not a value */
function regexAllowed(previous) {
  if (!previous) return true;
  if (previous.t === 'id') return REGEX_AFTER_WORD.has(previous.v);
  if (previous.t === 'p') return ![')', ']', '}', '++', '--'].includes(previous.v);
  return false;
}

/** the index after a regex literal that starts at `at` (its flags included) */
function regexEnd(text, at) {
  let inClass = false;
  let i = at + 1;
  for (; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '[') inClass = true;
    else if (text[i] === ']') inClass = false;
    else if (text[i] === '/' && !inClass) break;
  }
  i++;
  while (/[a-z]/i.test(text[i] || '')) i++;
  return i;
}

/** one template chunk from `at` (just after a backtick or the closing brace of a ${ }): the token, where the scan goes on, and whether an expression follows */
function templateChunk(text, at, opening) {
  const lead = opening ? '`' : '}';
  for (let i = at; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '`') return { token: { t: 'tq', v: lead + text.slice(at, i + 1) }, next: i + 1, stop: 'end' };
    else if (text[i] === '$' && text[i + 1] === '{') return { token: { t: 'tq', v: lead + text.slice(at, i + 2) }, next: i + 2, stop: 'expr' };
  }
  return { token: { t: 'tq', v: lead + text.slice(at) }, next: text.length, stop: 'end' };
}

/* the scanners, tried in order: each answers { token?, next } for what starts at `at`, or null */
const scanSpace = (text, at) => (/\s/.test(text[at]) ? { next: at + 1 } : null);
function scanComment(text, at) {
  if (text[at] !== '/') return null;
  if (text[at + 1] === '/') { const end = text.indexOf('\n', at); return { next: end < 0 ? text.length : end }; }
  if (text[at + 1] === '*') { const end = text.indexOf('*/', at + 2); return { next: end < 0 ? text.length : end + 2 }; }
  return null;
}
function scanString(text, at) {
  if (text[at] !== '"' && text[at] !== "'") return null;
  const end = stringEnd(text, at);
  return { token: { t: 'str', v: text.slice(at, end + 1) }, next: end + 1 };
}
function scanRegex(text, at, previous) {
  if (text[at] !== '/' || !regexAllowed(previous)) return null;
  const end = regexEnd(text, at);
  return { token: { t: 're', v: text.slice(at, end) }, next: end };
}
function scanWord(text, at) {
  const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(at, at + 200));
  return word ? { token: { t: 'id', v: word[0] }, next: at + word[0].length } : null;
}
function scanNumber(text, at) {
  const number = /^(?:0[xX][\da-fA-F]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?|\.\d+)n?/.exec(text.slice(at, at + 60));
  return number ? { token: { t: 'num', v: number[0] }, next: at + number[0].length } : null;
}
function scanPunct(text, at) {
  const punct = PUNCT.find((candidate) => text.startsWith(candidate, at)) || text[at];
  return { token: { t: 'p', v: punct }, next: at + punct.length };
}
const SCANNERS = [scanSpace, scanComment, scanString, scanRegex, scanWord, scanNumber, scanPunct];

/** the next token at `at` (or only the place to resume from, for whitespace and comments) */
function scanOne(text, at, previous) {
  for (const scan of SCANNERS) {
    const found = scan(text, at, previous);
    if (found) return found;
  }
  return { next: at + 1 };
}

/** the tokens of a JavaScript text: comments and whitespace dropped, a template literal split into its text chunks and its ${ } expressions */
function tokenize(text) {
  const tokens = [];
  const braces = []; /* '{' for a block or an object, 'tpl' for the ${ } of a template */
  let at = 0;
  const resume = (chunk) => { tokens.push(chunk.token); if (chunk.stop === 'expr') braces.push('tpl'); at = chunk.next; };
  while (at < text.length) {
    if (text[at] === '`') resume(templateChunk(text, at + 1, true));
    else if (text[at] === '}' && braces[braces.length - 1] === 'tpl') { braces.pop(); resume(templateChunk(text, at + 1, false)); }
    else {
      const found = scanOne(text, at, tokens[tokens.length - 1]);
      if (found.token) tokens.push(found.token);
      if (isPunct(found.token, '{')) braces.push('{');
      if (isPunct(found.token, '}')) braces.pop();
      at = found.next;
    }
  }
  return tokens;
}

const isRequirePath = (tokens, i) => tokens[i].t === 'str' && /^['"]\./.test(tokens[i].v) && valueAt(tokens, i - 1) === '(' && valueAt(tokens, i - 2) === 'require';

/** a relative require('..') path as the repo file it names (so '../lib/x' from routes/a.js and '../../lib/x' from routes/sub/a.js agree) */
function resolveRequires(tokens, file) {
  const folder = posix.dirname(file || 'x.js');
  return tokens.map((token, i) => {
    if (!isRequirePath(tokens, i)) return token;
    const target = posix.normalize(posix.join(folder, token.v.slice(1, -1))).replace(/\.js$/, '').replace(/\/index$/, '');
    return { t: 'str', v: '"@' + target + '"' };
  });
}

/** keep the stack of open brackets, and drop the declarations that ended with the bracket that held them */
function trackBrackets(token, brackets, running) {
  if (isOpening(token)) brackets.push(token.v);
  if (isClosing(token)) {
    brackets.pop();
    while (running.length && running[running.length - 1].depth > brackets.length) running.pop();
  }
}

/** `const a = 1, b = 2;` read as `const a = 1; const b = 2;` (the comma at the statement's own bracket depth is the declaration's, not a call's or an array's) */
function splitDeclarations(tokens) {
  const out = [];
  const brackets = [];
  const running = []; /* {word, depth} of the declarations still open */
  tokens.forEach((token, i) => {
    if (token.t === 'id' && DECLARE_WORDS.has(token.v) && valueAt(tokens, i - 1) !== '.') running.push({ word: token, depth: brackets.length });
    trackBrackets(token, brackets, running);
    const top = running[running.length - 1];
    const atOwnLevel = !!top && top.depth === brackets.length;
    if (atOwnLevel && isPunct(token, ';')) running.pop();
    if (atOwnLevel && isPunct(token, ',')) out.push({ t: 'p', v: ';' }, top.word);
    else out.push(token);
  });
  return out;
}

/** what surrounds each token: the innermost open bracket, and the neighbours */
function contexts(tokens) {
  const stack = [];
  return tokens.map((token, i) => {
    if (isClosing(token)) stack.pop();
    const context = { top: stack[stack.length - 1] || '', previous: valueAt(tokens, i - 1), next: valueAt(tokens, i + 1) };
    if (isOpening(token)) stack.push(token.v);
    return context;
  });
}

/** an identifier a rename may touch: not a keyword, not a property (a.b), not an object key (k: v), not a shorthand property ({ k }) */
function renamable(token, context) {
  if (token.t !== 'id' || KEYWORDS.has(token.v)) return false;
  if (context.previous === '.' || context.previous === '?.') return false;
  if (context.top === '{' && context.next === ':') return false;
  return !(context.top === '{' && ['{', ','].includes(context.previous) && [',', '}'].includes(context.next));
}

/** the index of the bracket that closes the one at `at` */
function closingAt(tokens, at) {
  let level = 0;
  for (let i = at; i < tokens.length; i++) {
    if (isOpening(tokens[i])) level++;
    if (isClosing(tokens[i]) && --level === 0) return i;
  }
  return tokens.length - 1;
}

/** the index of the bracket that opens the one closing at `closeAt` */
function openingAt(tokens, closeAt) {
  let level = 0;
  for (let i = closeAt; i >= 0; i--) {
    if (isClosing(tokens[i])) level++;
    if (isOpening(tokens[i]) && --level === 0) return i;
  }
  return 0;
}

/** a plain name directly in a parameter list or array pattern (not in a { } pattern, which reads a property, and not a default value) */
const isListName = (tokens, i, context) => tokens[i].t === 'id' && ['(', '[', ',', '...'].includes(valueAt(tokens, i - 1)) && [',', ')', ']', '=', undefined].includes(valueAt(tokens, i + 1)) && renamable(tokens[i], context);

/** the plain names of the list whose opening bracket is at `from` */
function listNames(tokens, from, contextList, found) {
  const to = closingAt(tokens, from);
  let level = 0;
  for (let i = from + 1; i < to; i++) {
    if (isOpening(tokens[i])) level++;
    if (isClosing(tokens[i])) level--;
    if (level === 0 && isListName(tokens, i, contextList[i])) found.add(tokens[i].v);
  }
}

/** const x / let x / var x, and the names of a const [a, b] pattern */
function declaredByWord(tokens, i, contextList, found) {
  if (tokens[i].t !== 'id' || !DECLARE_WORDS.has(tokens[i].v)) return;
  const next = tokens[i + 1] || {};
  if (next.t === 'id' && renamable(next, contextList[i + 1])) found.add(next.v);
  if (next.v === '[') listNames(tokens, i + 1, contextList, found);
}

/** the parameters of an arrow: (a, b) => or a => */
function declaredByArrow(tokens, i, contextList, found) {
  if (tokens[i].v !== '=>' || !i) return;
  const before = tokens[i - 1];
  if (isPunct(before, ')')) listNames(tokens, openingAt(tokens, i - 1), contextList, found);
  else if (renamable(before, contextList[i - 1])) found.add(before.v);
}

/** the parameters of function name(a, b) and the one of catch (e) */
function declaredByFunction(tokens, i, contextList, found) {
  if (tokens[i].t !== 'id' || !['function', 'catch'].includes(tokens[i].v)) return;
  const open = tokens[i + 1] && tokens[i + 1].t === 'id' && tokens[i].v === 'function' ? i + 2 : i + 1;
  if (isPunct(tokens[open], '(')) listNames(tokens, open, contextList, found);
}

/** the names this handler text declares itself: const/let/var, the parameters of an arrow or a function, a catch parameter */
function declaredNames(tokens, contextList) {
  const found = new Set();
  tokens.forEach((token, i) => {
    declaredByWord(tokens, i, contextList, found);
    declaredByArrow(tokens, i, contextList, found);
    declaredByFunction(tokens, i, contextList, found);
  });
  return found;
}

/** one name stands for one name, both ways, in the whole route */
function bindNames(maps, from, to) {
  if ((maps.forward.has(from) && maps.forward.get(from) !== to) || (maps.backward.has(to) && maps.backward.get(to) !== from)) return false;
  maps.forward.set(from, to);
  maps.backward.set(to, from);
  return true;
}

/** an identifier at `i` (spelled the same or not): allowed only when both sides declare it themselves, and the one-name-for-one-name map holds (a name spelled the same is a rename to itself, so it cannot also be renamed elsewhere) */
function renameAllowed(left, right, i, maps) {
  const one = left.tokens[i];
  const other = right.tokens[i];
  if (one.t !== 'id' || other.t !== 'id') return false;
  if (!renamable(one, left.context[i]) || !renamable(other, right.context[i])) return false;
  if (one.v !== other.v && !(left.declared.has(one.v) && right.declared.has(other.v))) return false;
  return bindNames(maps, one.v, other.v);
}

/** one position of both sides: the same token, or an allowed rename */
function sameOrRenamed(left, right, i, maps) {
  const one = left.tokens[i];
  const equal = one.t === right.tokens[i].t && one.v === right.tokens[i].v;
  if (equal && !renamable(one, left.context[i])) return true;
  return renameAllowed(left, right, i, maps);
}

const sideOf = (tokens) => { const context = contexts(tokens); return { tokens, context, declared: declaredNames(tokens, context) }; };

/** both sides token for token: the same, or an identifier both declare, renamed everywhere (one name to one name, both ways) */
function sameUpToRename(base, head) {
  if (base.length !== head.length) return false;
  const left = sideOf(base);
  const right = sideOf(head);
  const maps = { forward: new Map(), backward: new Map() };
  return base.every((token, i) => sameOrRenamed(left, right, i, maps));
}

const textOf = (tokens) => tokens.map((token) => token.t + ':' + token.v).join(' ');
const prepared = (handlers, file, steps) => handlers.map((text) => steps.reduce((tokens, step) => step(tokens, file), tokenize(text)));

/** the levels in order: [name, the steps that prepare each side's tokens] */
const LEVELS = [['verbatim', []], ['require-path', [resolveRequires]], ['declaration-join', [resolveRequires, splitDeclarations]]];

/** where the first handler differs, for the receipt: a few tokens either side */
function firstDifference(left, right) {
  for (let h = 0; h < left.length; h++) {
    let i = 0;
    while (i < left[h].length && i < right[h].length && left[h][i].v === right[h][i].v) i++;
    if (i < left[h].length || i < right[h].length) {
      const show = (tokens) => tokens.slice(Math.max(0, i - 2), i + 6).map((token) => token.v).join(' ');
      return 'handler ' + (h + 1) + ' differs at token ' + i + ': base "' + show(left[h]) + '" head "' + show(right[h]) + '"';
    }
  }
  return 'handlers differ';
}

/**
 * proveSame(base, head): base and head are { file, handlers: [raw handler text] }. Returns { proven, level, why }.
 * Handlers are compared pair by pair in order; one level has to hold for the whole route, so a route is never half proven.
 */
function proveSame(base, head) {
  if (base.handlers.length !== head.handlers.length) return { proven: false, why: 'the route has ' + base.handlers.length + ' handler(s) at the base and ' + head.handlers.length + ' now' };
  for (const [name, steps] of LEVELS) {
    const left = prepared(base.handlers, base.file, steps);
    const right = prepared(head.handlers, head.file, steps);
    if (left.every((tokens, i) => textOf(tokens) === textOf(right[i]))) return { proven: true, level: name, why: 'handler text equal at level ' + name };
  }
  const joined = LEVELS[LEVELS.length - 1][1];
  const left = prepared(base.handlers, base.file, joined);
  const right = prepared(head.handlers, head.file, joined);
  if (left.every((tokens, i) => sameUpToRename(tokens, right[i]))) return { proven: true, level: 'local-rename', why: 'handler text equal once locally declared names are renamed everywhere' };
  return { proven: false, why: firstDifference(left, right) };
}

module.exports = { tokenize, splitDeclarations, resolveRequires, declaredNames, sameUpToRename, proveSame, contexts };
