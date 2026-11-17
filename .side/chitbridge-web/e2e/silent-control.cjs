/**
 * e2e/silent-control.cjs — a control that announces success must have asked the server for it.
 *
 * ⚠️⚠️ THE N5 CLASS, NAMED AFTER THE BUG THAT DEFINED IT. `setShop()` set `SESSION.shop`, repainted three
 * pills, toasted *"Shop Closed — new orders are blocked"* and stopped. **No API call.** The value reached
 * localStorage and no further, while the server refused orders on a different column entirely
 * (`business_status`) that only the Profile screen could set.
 *
 * ⭐⭐ IT IS THE MOST EXPENSIVE SHAPE THIS CODEBASE PRODUCES, because every part of it looks right. The write
 * succeeds. The read of the written value succeeds. The screen reflects it. The toast confirms it. Only the
 * thing that ENFORCES it is reading somewhere else — and nothing anywhere fails.
 *
 * ⭐ THREE TIMES IN ONE WEEK: N5 itself (visibility declared in one column, served from another), the
 * duplicated visibility mapping, and the topbar shop pills. Each was found by a person noticing, not by a
 * test. This is the test.
 *
 * ── THE SIGNATURE ────────────────────────────────────────────────────────────────────────────────────────
 * A function that:
 *   1. tells the reader something succeeded — `toast(…)`, or writes a persisted preference, AND
 *   2. changes state that outlives the moment — `SESSION.x =`, `lsSet(`, `localStorage.setItem`, AND
 *   3. never calls `api(` and never delegates to something that does.
 *
 * ⚠️ AND THE THIRD CONDITION IS WHY THIS CANNOT BE A LINT RULE. Plenty of honest functions change local state
 * and say so — a theme, a font size, a panel that opens. What separates them is whether the state is supposed
 * to leave the browser, and only a person can say. So this REPORTS with the reason, and carries an allowlist
 * of the ones already judged local, each with why.
 */
const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'public');
const FILES = ['app.html'].concat(
  fs.readdirSync(path.join(W, 'app')).filter((f) => f.endsWith('.js')).map((f) => path.posix.join('app', f)));

/**
 * ⭐ JUDGED LOCAL, WITH THE REASON. Each of these genuinely belongs to this browser: a preference about how
 * THIS screen looks, not a fact about the business. ⚠️ Adding a name here is a decision that the value must
 * never leave the device — write the reason, because the next reader cannot recover it.
 */
const LOCAL_BY_DESIGN = {
  themeApply:     'a theme is how this browser paints; the server has no opinion',
  textSizeSet:    'text size is per-person per-device, synced separately by CBPrefs',
  setVP:          'laptop/mobile is a preview of THIS window',
  toggleSpec:     'spec overlay is a reader preference, not a business fact',
  toggleLhFold:   'a folded panel is a view state',
  setDuty:        'persists through the break API — see its own comment',
  clearMsgLog:    'clears an in-memory ring buffer',
  toggleVoice:    'speech announcements are a device capability',
  /* ⚠️ THE LOCAL HALF OF A SYNCED PAIR. It writes the working draft to localStorage; _catfPushServer and
     _catfQueuePush send it, and _catfPullServer reads it back with local-wins-if-dirty. Its only toast is a
     FAILURE ("couldn't save locally — it may be too large"), which is the opposite of the bug this hunts. */
  _catfSave:      'draft autosave; the server half is _catfPushServer / _catfQueuePush',
  /**
   * ── ⭐ FOUR IN THE TESTING PANEL THAT FILL A FORM AND FILE NOTHING (judged 2026-09-16) ──────────────────────
   *
   * All four end the same way: `put('wcTitle', …)` into the Create form and focus it. NOTHING is persisted by
   * the act, and nothing claims to be — the save is a separate, explicit press (`testCaseSend`), which does ask
   * the server and does report its outcome. A tester who presses one of these and walks away has lost a draft
   * they never asked to keep, which is what a draft is.
   *
   * ⚠️ THE ONE THAT DESERVED A SECOND LOOK is `testDiagRaise`, because "raise" sounds like filing. It is not:
   * the button on screen reads "✎ Write this up", it pre-fills the form with the measured numbers and the
   * correlation id, and the tester still has to press the button that files it. The label and the behaviour
   * agree, which is the whole question this guard asks.
   */
  testTechUse:    'fills the Create form from a technique row; testCaseSend files it',
  testCoverCase:  'fills the Create form from a coverage row; testCaseSend files it',
  testDiagRaise:  'fills the Create form with the measured trips ("✎ Write this up"); testCaseSend files it',
  testDiagClear:  'clears the in-memory CBCALLS ring and this device’s visit log — same case as clearMsgLog',
};

/**
 * ⭐ ONE DETECTOR, used by the scan AND the self-test below (ACC-345: the self-test used to re-type its own copy).
 * A function reaches the server when it calls api( / fetch( / CBPrefs / .push(, OR hands `{ api: api }` to a delegate
 * call (e.g. CBLedger.call({ api: api }, on), which does host.api('booksEnable')). The handoff must sit inside a call:
 * a bare `api: api` in an object literal that is never called proves nothing.
 */
const CALLS_API = /\bapi\s*\(|CBPrefs|\.push\s*\(|fetch\s*\(|\w+\.\w+\s*\([^)]*\{\s*api\s*:\s*api\s*\}/;

let pass = 0, fail = 0;
const findings = [];

for (const rel of FILES) {
  const src = fs.readFileSync(path.join(W, rel), 'utf8');
  /* function bodies, roughly: from `function name(` to the next top-level `function ` */
  const re = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const marks = [];
  let m;
  while ((m = re.exec(src))) marks.push({ name: m[1], at: m.index });
  marks.forEach((mk, i) => {
    const body = src.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : Math.min(src.length, mk.at + 6000));
    const code = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');

    /**
     * ⚠️⚠️ `SESSION\.\w+\s*=` MATCHED `SESSION.role==="customer"`. A comparison is not a write, and the first
     * `=` of `===` is indistinguishable from an assignment unless you say so. That one character reported
     * `sendMessage()` — a function whose only toast is *"Type a message first"* — as a control that silently
     * persists state.
     *
     * ⭐ AND THE OTHER HALF OF THAT FALSE POSITIVE IS WORTH NAMING: a REFUSAL toast is not an announcement of
     * success. "Type a message first" tells you nothing happened, which is the opposite of the bug. So the
     * announcement has to look like a confirmation, not merely like a toast.
     */
    const persists = /\bSESSION\.\w+\s*=(?!=)|\blsSet\s*\(|localStorage\.setItem/.test(code);
    const refusalOnly = /toast\s*\(\s*["'][^"']*(first|required|cannot|must|no |not )/i.test(code)
      && (code.match(/\btoast\s*\(/g) || []).length === 1;
    const announces = /\btoast\s*\(/.test(code) && !refusalOnly;
    const callsApi = CALLS_API.test(code);

    if (announces && persists && !callsApi) {
      if (LOCAL_BY_DESIGN[mk.name]) return;
      findings.push({ rel, name: mk.name });
    }
  });
}

console.log('\n── a control that says it worked must have asked the server ──\n');
/* QA-154: known findings live in e2e/scanner-known.json; only a NEW one fails */
const RK = require('./lib/known-findings.cjs').ratchet('silent-control',
  findings.map((f) => ({ key: f.rel + '  ' + f.name + '()', show: f })), { owner: 'accounting' });
if (RK.known) console.log(RK.line + '\n');
findings.length = 0;
RK.fresh.forEach((r) => findings.push(r.show));
if (!findings.length) {
  pass++;
  console.log('  ✓ no NEW control announces success without reaching the server');
  console.log('    (' + Object.keys(LOCAL_BY_DESIGN).length + ' judged local by design, each with its reason)');
} else {
  fail++;
  console.error('  ✗ ' + findings.length + ' NEW control(s) announce success without asking the server:');
  findings.forEach((f) => console.error('      ' + f.rel + '  ' + f.name + '()'));
  console.error('\n    Either wire it to the API, or add it to LOCAL_BY_DESIGN with the reason it is local.');
}

/**
 * ⚠️ AND THE DETECTOR MUST BE SHOWN TO DETECT — every scan written this week was wrong before it was right.
 * This plants setShop() exactly as it was before the fix.
 */
console.log('\n── it catches the bug it is named for ──');
const SPECIMEN = "function setShop(s){SESSION.shop=s;\n"
  + "  document.querySelectorAll('.shoptog button').forEach(b=>{});\n"
  + "  toast({open:'Shop Open',closed:'Shop Closed — new orders are blocked.'}[s]);\n}";
const sCode = SPECIMEN;
const caught = /\btoast\s*\(/.test(sCode)
  && /\bSESSION\.\w+\s*=/.test(sCode)
  && !CALLS_API.test(sCode);
if (caught) { pass++; console.log('  ✓ the original setShop() is reported'); }
else { fail++; console.error('  ✗ the planted setShop() was NOT reported — this scan proves nothing'); }

/* the delegate handoff is accepted; a bare object literal naming api is not */
const HANDOFF = "function sw(on){ CBLedger.call({ api: api }, on); SESSION.booksOn = on; toast('done'); }";
const BARE = "function sw(on){ var h = { api: api }; SESSION.booksOn = on; toast('done'); }";
if (CALLS_API.test(HANDOFF) && !CALLS_API.test(BARE)) { pass++; console.log('  ✓ a { api: api } handoff to a delegate counts; a bare literal does not'); }
else { fail++; console.error('  ✗ the delegate-handoff rule is wrong'); }

console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
process.exit(fail ? 1 : 0);
