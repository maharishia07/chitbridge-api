/* chitbridge-engines · money. fixture source the two adopted copies point back to */
(function (root) {
'use strict';
function round(n) { return Math.round(n); }
const EXPORTS = { round };
root.CBMoney = EXPORTS;
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
})(typeof window !== 'undefined' ? window : this);
