#!/usr/bin/env node
// @type: unit
/**
 * ai-13-prompt-ask.test.cjs — AI-13 (proof 2026-11-14): promptAsk (public/app.html) owns focus, select-on-prefill, Enter-to-submit, trim and refusing empty.
 * The REAL function is lifted out of app.html and run over a stand-in modal and document; nothing is retyped here.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node tests/ai-13-prompt-ask.test.cjs
 */
'use strict';
const assert = require('assert');
const { sliceFrom, run } = require('./lib/proof-lift.cjs');

const code = sliceFrom('public/app.html', 'function promptAsk(', '\n}\n') + '\n}\n';
let pass = 0;
const ok = (condition, name) => { assert(condition, name); pass++; console.log('  ok  ' + name); };

/** a fresh stand-in page: modal() records the html and "renders" the ids it holds; setTimeout runs at once */
function page() {
  const log = { focused: 0, selected: 0, closed: 0, got: [], modalHtml: '' };
  const input = { value: '', focus() { log.focused++; }, select() { log.selected++; } };
  const okButton = {};
  const extraButton = {};
  const sandbox = {
    UI: {},
    esc: (s) => String(s),
    modal: (html) => { log.modalHtml = html; input.value = (/id="_pmpt"[^>]*value="([^"]*)"/.exec(html) || [])[1] || ''; },
    closeModal: () => { log.closed++; },
    document: { getElementById: (id) => (id === '_pmpt' ? input : id === '_pmptok' ? okButton : id === '_pmptx' ? extraButton : null) },
    setTimeout: (fn) => fn()
  };
  run(code + '\nthis.promptAsk = promptAsk;', sandbox);
  return { log, input, okButton, extraButton, sandbox };
}

// 1. a typed answer is trimmed, handed to onOk once, and the dialog closes
{
  const p = page();
  p.sandbox.promptAsk('Name it', {}, (v) => p.log.got.push(v));
  p.input.value = '  Spring sale  ';
  p.okButton.onclick();
  ok(p.log.got.length === 1 && p.log.got[0] === 'Spring sale', 'AI-13: the answer is trimmed before onOk');
  ok(p.log.closed === 1, 'AI-13: the dialog closes on a good answer');
}
// 2. empty (and whitespace) is refused: no onOk, no close, focus goes back to the box
{
  const p = page();
  p.sandbox.promptAsk('Name it', {}, (v) => p.log.got.push(v));
  const focusedBefore = p.log.focused;
  p.input.value = '   ';
  p.okButton.onclick();
  ok(p.log.got.length === 0 && p.log.closed === 0, 'AI-13: an empty or blank answer is refused (no onOk, dialog stays)');
  ok(p.log.focused === focusedBefore + 1, 'AI-13: a refused answer puts the focus back in the box');
}
// 3. Enter submits, and is not left to the browser
{
  const p = page();
  p.sandbox.promptAsk('Name it', {}, (v) => p.log.got.push(v));
  p.input.value = 'x1';
  let prevented = false;
  p.input.onkeydown({ key: 'Enter', preventDefault: () => { prevented = true; } });
  ok(p.log.got[0] === 'x1' && prevented, 'AI-13: Enter submits the answer and cancels the default');
  const q = page();
  q.sandbox.promptAsk('Name it', {}, (v) => q.log.got.push(v));
  q.input.value = 'x2';
  q.input.onkeydown({ key: 'a', preventDefault: () => {} });
  ok(q.log.got.length === 0, 'AI-13: another key submits nothing');
}
// 4. focus on open; select only when pre-filled
{
  const empty = page();
  empty.sandbox.promptAsk('Name it', {}, () => {});
  ok(empty.log.focused === 1 && empty.log.selected === 0, 'AI-13: an empty box is focused, not selected');
  const filled = page();
  filled.sandbox.promptAsk('Rename', { value: 'Old name' }, () => {});
  ok(filled.log.focused === 1 && filled.log.selected === 1, 'AI-13: a pre-filled box is focused AND selected (type to replace)');
}
console.log(pass + ' passed');
