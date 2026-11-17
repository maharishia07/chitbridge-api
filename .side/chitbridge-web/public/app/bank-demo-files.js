/* bank-demo-files.js — a file the visitor loads into public/bank-demo.html, and the one question it needs first: which currency is it in? (B5-05)
 * OWNS      reading the chosen file on the device, the size limit, the currency question (a CSV does not say its currency, and the demo account's AUD is never taken as the file's), and what the page
 *           is told to do next: refuse, wait for the answer, or read the file. The sample statement is ours and says AUD itself.
 * CALLED BY public/app/bank-demo.js (CBBankDemoFiles.create(host)); loaded before it by public/bank-demo.html.
 * FLOW      a file is chosen → too big? say so · else ask the currency (short) → "Read this file" → host.loadOwn(text, name) with the currency the engine checks against the account
 * ⭐ NOTHING IS CONVERTED: the engine refuses a statement whose currency is not the demo account's.
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * CONTROLS  BKS017-S07 the currency · BKS017-B31 read this file
 */
(function (root) {
  'use strict';
  var host = null /* the page's own functions (el, refuseFile, waitForFile, loadOwn …), given by create() */,
    asked = null /* { text, name }: the file waiting for its currency */,
    currency = null /* the currency the STATEMENT says it is in: the sample's own AUD, or what the visitor said for their file */;
  function statementCurrency() {
    return currency;
  }
  /** the question, short, in its own slot under the figures */
  function paintAsk() {
    var box = host.el('bd_cur');
    box.hidden = !asked;
    box.innerHTML = asked
      ? '<label for="bd_cur_sel">Which currency is ' + esc(asked.name) + ' in? Type its three letters, for example ' + esc(host.CURRENCY) + '.</label> <input data-cbsid="BKS017-S07" id="bd_cur_sel" class="bd-inp bd-cur-in" type="text" maxlength="3" size="4" autocomplete="off" data-testid="bd-cur-sel"> ' +
        '<button data-cbsid="BKS017-B31" type="button" class="bd-btn" data-act="curuse" data-testid="bd-cur-go">Read this file</button>'
      : '';
    if (asked) host.el('bd_cur_sel').focus();
  }
  /** the sample statement: its currency is the demo account's, nothing to ask */
  function useSample() {
    asked = null;
    currency = host.CURRENCY;
    paintAsk();
  }
  function onFile(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    asked = null;
    paintAsk();
    if (file.size > 2 * 1024 * 1024) return host.refuseFile('That file is too big for this page (2 MB at most). Export a shorter period.');
    file.text().then(function (text) {
      asked = { text: text, name: file.name };
      currency = null;
      host.waitForFile();
      paintAsk();
    });
  }
  /** the visitor said the currency: read the file with it (the engine refuses one that is not the account's) */
  function readAsked() {
    var chosen = host.el('bd_cur_sel').value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(chosen)) return void host.say('Use three capital letters, like ' + host.CURRENCY + '.');
    currency = chosen;
    var file = asked;
    asked = null;
    paintAsk();
    host.loadOwn(file.text, file.name);
  }
  function create(pageHost) {
    host = pageHost;
    return { onFile: onFile, useSample: useSample, statementCurrency: statementCurrency, actions: { curuse: function () { readAsked(); return true; } } };
  }
  root.CBBankDemoFiles = { create: create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
