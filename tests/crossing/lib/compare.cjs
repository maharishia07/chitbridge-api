'use strict';
/**
 * tests/crossing/lib/compare.cjs — the small comparing helpers every scenario shares (a second call site, so one helper: DISCIPLINES).
 * OWNS      md5/sha256 of bytes · "the same on both installations" · money as minor-unit integers · polling until a thing is true
 * CALLED BY the scenarios · tests/ctp-crossing-pack.test.cjs
 */
const crypto = require('crypto');

const md5 = (data) => crypto.createHash('md5').update(data).digest('hex');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** are all the given digests present and equal? (one side missing is NOT "the same") */
function sameDigest(...digests) {
  const list = digests.flat();
  return list.length > 1 && list.every((d) => typeof d === 'string' && d.length > 0 && d === list[0]);
}

/** an amount as minor units (integer) from a number or numeric text with 2 decimals; null when it is not an amount. Never floats into a comparison. */
function minor(amount, digits) {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * Math.pow(10, digits == null ? 2 : digits));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** poll fn() until it returns a truthy value or the budget ends; returns { ok, value, waitedMs }. Never a fixed long sleep: stops at the first truthy answer. */
async function waitFor(fn, opts) {
  const o = Object.assign({ timeoutMs: 120000, everyMs: 3000 }, opts || {});
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return { ok: true, value: last, waitedMs: Date.now() - t0 };
    if (Date.now() - t0 + o.everyMs > o.timeoutMs) return { ok: false, value: last, waitedMs: Date.now() - t0 };
    await sleep(o.everyMs);
  }
}

module.exports = { md5, sha256, sameDigest, minor, sleep, waitFor };
