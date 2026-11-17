#!/usr/bin/env node
// @type: unit
/**
 * mnt-16-checklist-anchor.test.cjs — MNT-16 (proof 2026-11-14), the pr-checklist part: the checker no longer matches the FIRST "Pass 3" anywhere in a PR body;
 * a line must start a line (after a bullet and a checkbox) and, when the body has a "## §6" heading, only that block is read (tools/pr-checklist.cjs).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node tests/mnt-16-checklist-anchor.test.cjs
 */
'use strict';
const assert = require('assert');
const { problems, checklistBlock } = require('../tools/pr-checklist.cjs');

let pass = 0;
const ok = (condition, name) => { assert(condition, name); pass++; console.log('  ok  ' + name); };

const real = [
  '- [x] Pass 0 · seams: `freightTotal` reused',
  '- [x] Pass 1 · shrink: lines 10 → 8 · complexity 3 → 2',
  '- [x] Pass 2 · humanify: cryptic names 1 → 0 · empty catches 0 → 0',
  '- [x] Pass 3 · structure: module header 1/1 · CARD line 1/1 · TRACE row',
  '- [x] Guard green: `readability --changed --ratchet` 0 failures'
].join('\n');

ok(problems('## §6 checklist\n' + real).length === 0, 'MNT-16: a complete checklist passes');

// a sentence that only MENTIONS "Pass 3" earlier in the body is not the checklist line
const prose = 'Summary: we also looked at Pass 3 (structure) of the old plan and left it.\n\n';
ok(problems(prose + '## §6 checklist\n' + real).length === 0, 'MNT-16: a prose mention of "Pass 3" before the checklist does not shadow the real line');
ok(problems(prose + real).length === 0, 'MNT-16: ... even with no §6 heading (the line must START its line)');
const onlyProse = real.split('\n').filter((line) => !/Pass 3/.test(line)).join('\n');
ok(problems(prose + onlyProse).some((text) => /Pass 3 · structure: the line is missing/.test(text)), 'MNT-16: a body whose only "Pass 3" is prose is told the line is missing');

// the checklist block is cut at the next heading: a Pass 3 line under another heading does not count
const below = '## §6 checklist\n' + onlyProse + '\n\n## Notes\n- [x] Pass 3 · structure: module header 1/1 · CARD line 1/1\n';
ok(problems(below).some((text) => /Pass 3 · structure: the line is missing/.test(text)), 'MNT-16: a Pass 3 line under a later heading is outside the checklist block');
ok(checklistBlock(below).indexOf('## Notes') < 0, 'MNT-16: checklistBlock stops at the next heading of the same level');
console.log(pass + ' passed');
