/**
 * e2e/movable-panels.cjs — the movable primitive, checked without a browser.
 *
 * ⚠️⚠️ THE PART THAT COULD STRAND SOMEONE IS THE REMOVAL, NOT THE ADDITION. Athi, 2026-08-29: *"A+, A- as
 * font resizing is not required any more as we have the visuals standards."* Deleting the two buttons is easy;
 * the danger is the CSS `zoom` they wrote to localStorage. A reader who shrank a panel months ago and forgot
 * would keep that panel small forever, with the only control that could undo it gone from the screen. So the
 * saved value must be actively dropped, not merely stopped from being written.
 *
 * ⭐ And the second thing worth holding: modal() now makes EVERY panel movable, and makeMovable is idempotent
 * on data-movable — so a caller that asks afterwards is silently ignored. The worklist card's minimise button
 * lived exactly there.
 */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app', '..', '..', 'public', 'app.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

/* ── a DOM small enough to read, big enough for makeMovable ───────────────────────────────────────────── */
function mkEl(tag){
  const el = {
    tagName: (tag||'div').toUpperCase(), children: [], attrs: {}, style: {}, textContent: '', type: '', title: '',
    classList: { contains: () => false },
    appendChild(c){ this.children.push(c); return c; },
    setAttribute(k,v){ this.attrs[k] = String(v); },
    getAttribute(k){ return Object.prototype.hasOwnProperty.call(this.attrs,k) ? this.attrs[k] : null; },
    addEventListener(){}, removeEventListener(){},
    getBoundingClientRect(){ return { left:100, top:80, width:600, height:400 }; },
    querySelector(){ return null; },
  };
  el.style.cssText = '';
  return el;
}
const STORE = {};
global.localStorage = { getItem:k=>(k in STORE?STORE[k]:null), setItem:(k,v)=>{STORE[k]=String(v);}, removeItem:k=>{delete STORE[k];} };
global.document = { createElement: mkEl, addEventListener(){}, removeEventListener(){}, body:null, querySelector(){return null;} };
global.getComputedStyle = () => ({ position: 'relative' });
global.window = { innerWidth: 1400, innerHeight: 900 };

/* ⚠️ \r?\n — app.html is checked out with Windows line endings here, and a bare \n never matched the closing brace */
const fnSrc = src.match(/function makeMovable\(panel, opts\) ?\{[\s\S]*?\r?\n\}\r?\n/)[0];
const makeMovable = new Function(fnSrc + '; return makeMovable;')();

/* ── 1 · no A buttons are built any more ─────────────────────────────────────────────────────────────── */
console.log('\n-- the A buttons are gone --');
let p = mkEl('div');
makeMovable(p, { key: 'k_plain' });
const bar = p.children.find(c => c.getAttribute && c.getAttribute('data-mv') === 'bar');
const labels = bar ? bar.children.map(c => c.textContent) : [];
t('a control bar is still built', !!bar);
t('no A+ button', labels.indexOf('A+') < 0, JSON.stringify(labels));
t('no A- button', labels.indexOf('A−') < 0, JSON.stringify(labels));
t('the drag grip survives', labels.indexOf('⠿') >= 0, JSON.stringify(labels));
t('a resize handle is still added', p.children.some(c => c.getAttribute && c.getAttribute('data-mv') === 'rz'));
t('no zoom is applied', !p.style.zoom, String(p.style.zoom));

/* ── 2 · minimise only when asked ────────────────────────────────────────────────────────────────────── */
console.log('\n-- minimise is opt-in --');
let p2 = mkEl('div'); makeMovable(p2, { key: 'k_min', minimise: true });
const bar2 = p2.children.find(c => c.getAttribute && c.getAttribute('data-mv') === 'bar');
t('minimise appears with opts.minimise', bar2.children.map(c=>c.textContent).indexOf('–') >= 0);
t('and not without it', labels.indexOf('–') < 0);

/* ── 3 · ⭐⭐ A SAVED ZOOM IS DROPPED, NOT HONOURED ──────────────────────────────────────────────── */
console.log('\n-- ⭐⭐ a zoom saved by the old build --');
STORE['k_old'] = JSON.stringify({ left: 40, top: 30, width: 700, height: 500, fs: 1.4 });
let p3 = mkEl('div'); makeMovable(p3, { key: 'k_old' });
t('the panel is NOT left zoomed', !p3.style.zoom, JSON.stringify(p3.style.zoom));
t('fs is erased from storage', JSON.parse(STORE['k_old']).fs === undefined, STORE['k_old']);
/* ⚠️ the geometry must survive — dropping fs may not drop where the reader put the panel */
const kept = JSON.parse(STORE['k_old']);
t('but the geometry it was saved with survives', kept.width === 700 && kept.left === 40, JSON.stringify(kept));
t('and is applied to the panel', p3.style.width === '700px' && p3.style.left === '40px',
  p3.style.width + ' / ' + p3.style.left);

/* ── 4 · idempotent, which is why callers must go through modal() ────────────────────────────────────── */
console.log('\n-- idempotence (the reason mvModal takes options) --');
let p4 = mkEl('div');
makeMovable(p4, { key: 'k_first' });
const n1 = p4.children.length;
makeMovable(p4, { key: 'k_second', minimise: true });
t('a second call adds nothing', p4.children.length === n1, n1 + ' -> ' + p4.children.length);

/* ── 4b · a touch viewport gets NO grip and NO resize corner ─────────────────────────────────────────── */
console.log('\n-- ⚠️⚠️ not on a phone: makeMovable binds mousedown only --');
const mvSrc = src.match(/function mvModal\(host, wide, opt\) ?\{[\s\S]*?\n\}/)[0];
const mkMvModal = new Function('makeMovable', 'UI', 'window', mvSrc + '; return mvModal;');
function runMv(vw, vp){
  let asked = null;
  const panel = { querySelector: () => null, getAttribute: () => null };
  const host = { querySelector: () => panel };
  mkMvModal(function(el, o){ asked = o; }, { vp: vp }, { innerWidth: vw })(host, true, null);
  return asked;
}
t('a desktop viewport is made movable', !!runMv(1400, 'desk'));
t('a 680px viewport is NOT', runMv(680, 'desk') === null);
/* ⚠️ the preview toggle sets UI.vp, which can say phone while the real window is wide */
t('UI.vp = mob is refused even on a wide window', runMv(1400, 'mob') === null);
/* ── 5 · the source no longer carries the removed control anywhere ───────────────────────────────────── */
console.log('\n-- nothing left in the source --');
const legend = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app', 'cap-legend.js'), 'utf8');
const code = l => l.replace(/^\s*\*.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
t('makeMovable has no setFs', !/function setFs/.test(fnSrc));
t('the Legend has no lbFont', !/function lbFont/.test(code(legend)));
t('the Legend body has no zoom', !/zoom:/.test(code(legend)));
t('modal() passes options to mvModal', /mvModal\(\w+, wide, opt\)/.test(src));
t('the matrix no longer opts out of movable',
  !/setAttribute\('data-movable','1'\)/.test(code(fs.readFileSync(require('path').join(__dirname,'..','public','app','cap-readiness.js'),'utf8'))));

console.log('\n  == ' + pass + ' passed - ' + fail + ' failed ==\n');
process.exit(fail ? 1 : 0);
