/**
 * tests/support/contract-shape.cjs — how docs/contracts/web-api.json holds an answer to its example.
 *
 * ⚠️ chitbridge-web has the SAME matcher (e2e/lib/contract.cjs). The two cannot import each other, so the contract file carries `_selftest`:
 *   cases both matchers must answer the same way. Change a rule here and the web's copy of the file (and of the matcher) must follow.
 *
 * THE RULES
 *   · an OBJECT must carry exactly the example's keys — a key the example lacks is a failure (the reader would never see it), a key it has
 *     that the answer lacks is a failure (the reader would get undefined) — unless that path is listed in `optional`;
 *   · an ARRAY holds elements shaped like the example's elements (any one of them: a list of different kinds lists one of each); an empty
 *     example array accepts any array, an empty answer is always fine;
 *   · a string is a string, a number a number, a boolean a boolean; an object is not an array (the roles bug: a list where an object came);
 *   · null in the example means "not decided by this example" — anything fits; null in the answer fits anything (an optional value);
 *   · paths are written  parties[].customer.segment  (an array element is []).
 */
'use strict';

const kind = (v) => (v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** → a list of plain problems ('parties[].roles: the contract has an object, the answer has a list'); empty = it conforms */
function problems(example, actual, optional, path) {
  const opt = optional instanceof Set ? optional : new Set(optional || []);
  const word = (k) => (k === 'array' ? 'a list' : k === 'object' ? 'an object' : 'a ' + k);
  function collect(ex, ac, p) {
    const ke = kind(ex), ka = kind(ac);
    if (ke === 'null' || ka === 'null') return [];
    if (ke !== ka) return [(p || '(the answer)') + ': the contract has ' + word(ke) + ', the answer has ' + word(ka)];
    if (ke === 'array') {
      if (!ex.length) return [];
      const out = [];
      ac.forEach((el) => {
        const tries = ex.map((x) => collect(x, el, (p || '') + '[]'));
        if (tries.some((t) => !t.length)) return;
        tries.sort((x, y) => x.length - y.length)[0].forEach((m) => out.push(m));
      });
      return out;
    }
    if (ke === 'object') {
      const out = [];
      Object.keys(ac).forEach((k) => { if (!(k in ex)) out.push((p ? p + '.' : '') + k + ': the answer sends it, the contract does not list it'); });
      Object.keys(ex).forEach((k) => {
        const kp = (p ? p + '.' : '') + k;
        if (!(k in ac)) { if (!opt.has(kp)) out.push(kp + ': the contract lists it, the answer does not send it'); return; }
        collect(ex[k], ac[k], kp).forEach((m) => out.push(m));
      });
      return out;
    }
    return [];
  }
  return Array.from(new Set(collect(example, actual, path || '')));
}

/** many elements of one list → ONE example element: every key any of them has, a key some lack goes in `optional` (as list[].key) */
function mergeElements(list, path, optional) {
  const objs = list.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (!objs.length) return list.find((x) => x !== null && x !== undefined) === undefined ? null : list.find((x) => x !== null && x !== undefined);
  const keys = []; objs.forEach((o) => Object.keys(o).forEach((k) => { if (keys.indexOf(k) < 0) keys.push(k); }));
  const out = {};
  keys.forEach((k) => {
    const have = objs.filter((o) => k in o);
    if (have.length < objs.length) optional.add((path ? path : '') + '.' + k);
    out[k] = generalise(have.map((o) => o[k]), (path ? path : '') + '.' + k, optional);
  });
  return out;
}
/** one value (or many, for a list's elements) → the example that stands for them */
function generalise(values, path, optional) {
  const real = values.filter((v) => v !== null && v !== undefined);
  if (!real.length) return null;
  const first = real[0];
  if (Array.isArray(first)) {
    const all = [].concat.apply([], real.filter(Array.isArray));
    if (!all.length) return [];
    if (all.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return [mergeElements(all, path + '[]', optional)];
    return [all.find((x) => x !== null && x !== undefined) === undefined ? null : all.find((x) => x !== null && x !== undefined)];
  }
  if (first && typeof first === 'object') {
    const keys = []; real.forEach((o) => Object.keys(o).forEach((k) => { if (keys.indexOf(k) < 0) keys.push(k); }));
    const o = {};
    keys.forEach((k) => { if (real.filter((x) => k in x).length < real.length) optional.add(path + '.' + k); o[k] = generalise(real.filter((x) => k in x).map((x) => x[k]), path + '.' + k, optional); });
    return o;
  }
  return first;
}
/** an answer body → { example, optional: [paths] } — lists are boiled down to one merged element */
function exampleOf(body) { const optional = new Set(); const example = generalise([body], '', optional); return { example, optional: Array.from(optional).map((p) => p.replace(/^\./, '')).sort() }; }

module.exports = { problems, exampleOf, kind };
