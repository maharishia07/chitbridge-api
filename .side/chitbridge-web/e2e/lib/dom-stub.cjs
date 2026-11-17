/*
 * @type: support
 * The ONE inert `document` the vm-sandbox checks (locale-map, prof-dirty, profile-groups, render-smoke) hand to
 * the capability files they load. Why it exists: cap-admin.js now calls document.addEventListener('click', ...)
 * while it LOADS (cap-admin.js:9780), so a stand-in without addEventListener made every one of those four files
 * die at load with "document.addEventListener is not a function" - four private copies, four breakages.
 * The listener calls are recorded in `listeners` (event name -> count) and never fired: a load-time registration
 * is accepted, nothing is simulated. A file that needs more (a field table, a counting createElement) passes it
 * as `overrides`; the base never answers for an element it was not given (getElementById/querySelector -> null).
 */
'use strict';

function makeDocument(overrides) {
  const listeners = {};
  const doc = {
    listeners,
    getElementById: () => null,
    documentElement: { style: { setProperty(){}, removeProperty(){} }, setAttribute(){}, removeAttribute(){}, classList: { add(){}, remove(){} } },
    body: { classList: { add(){}, remove(){} }, setAttribute(){} },
    createElement: () => ({ style: {}, setAttribute(){}, appendChild(){} }),
    head: { appendChild(){} },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener(type) { listeners[type] = (listeners[type] || 0) + 1; },
    removeEventListener(type) { if (listeners[type]) listeners[type] -= 1; },
  };
  return Object.assign(doc, overrides || {});
}

module.exports = { makeDocument };
