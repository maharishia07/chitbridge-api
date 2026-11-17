/* fixture — a capability file: a member call into the vendored engine, and a callback passed by name */
function fmtAmt(n){ return CBMoney.round(n); }
function payLater(){ setTimeout(paintPayLater, 10); }
function paintPayLater(){ return fmtAmt(1); }
