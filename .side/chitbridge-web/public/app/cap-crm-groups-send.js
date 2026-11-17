/* cap-crm-groups-send.js — PART of cap-crm-groups.js (MNT-59): the Send-to-group sheet, who may be sent first (the server's dry answer, by code), then the send.
 * OWNS      SEND (the sheet's state) · crmSendOpen · crmSendWords · crmSendBody · crmSendCheck (the dry run) · crmSendGo (the one send, through CBAction).
 * CALLED BY cap-crm-groups.js (the base: crmGroupsActions and crmGroupsClick open and drive the sheet; crm.html loads this file right after it) · cap-crm-groups-window.js (the share link opens it with a message) · cap-marketing.js (crmSendOpen).
 * FLOW      a row's Send ▸ crmSendOpen → crmSendCheck asks the server who may (dry) → crmSendGo sends through the one sender → the sheet shows the count sent.
 * CARD      11-crm-and-marketing/marketing-app
 * Moved byte for byte out of cap-crm-groups.js; no behaviour changed. Needs the base's GROUPS and the host globals of cap-crm.js (CRM · crmBar · ui · tx/txf · esc · api · CBAction · toast). */
'use strict';
/* ═══ SEND — the one sheet: who may (the server's dry answer, by code), then the send through the one sender ═══════ */
var SEND = { row: null, dry: null, done: null };
/** open the Send-to-group sheet for a row; pre is an optional starting message */
function crmSendOpen(group, prefill) {
  SEND = { row: group, dry: null, done: null };
  ui.dialog({
    mount: 'CRM008-U202',
    pop: 'POP104',
    titleText: txf('Send to {name}', { name: group.name }),
    subText: crmPlural(group.count, 'member', 'members'),
    testid: 'crm-send-sheet',
    body:
      '<div class="kv"><b>' +
      esc(tx('Channel')) +
      '</b><span data-testid="crm-send-channel">' +
      esc(tx('WhatsApp')) +
      ' · ' +
      esc(tx('offers — only to those who agreed')) +
      '</span></div>' +
      '<label>' +
      esc(tx('Message')) +
      '<textarea data-cbsid="CRM008-T01" class="inp" id="crm_send_text" data-testid="crm-send-text" rows="4" maxlength="1000">' +
      esc((prefill && prefill.text) || '') +
      '</textarea></label>' +
      '<div id="crm_send_who" class="hint" role="status" data-testid="crm-send-who">' +
      esc(tx('Check who may be sent first; nothing goes out until you press Send.')) +
      '</div>' +
      '<div id="crm_send_out" data-testid="crm-send-out"></div>',
    footerHtml:
      '<button data-cbsid="CMP005" type="button" onclick="closeModal()">' +
      esc(tx('Close')) +
      '</button><button data-cbsid="CRM008-B02" type="button" data-crm="sendcheck" data-testid="crm-send-check">' +
      esc(tx('Who may be sent?')) +
      '</button>' +
      '<button data-cbsid="CRM008-B03" type="button" class="pri" data-crm="sendgo" data-testid="crm-send-go" disabled title="' +
      esc(tx('Check first')) +
      '">' +
      esc(tx('Send')) +
      '</button>'
  });
  var node = document.getElementById('crm_send_text');
  if (node) node.focus();
}
/** the server's own words on a refusal: its why, else its message, else nothing */
function crmSendServerWords(error) {
  return (error && error.data && (error.data.why || error.data.message)) || '';
}
/** the shop's sentence for each fixed refusal code of the sender; nothing for a code it does not know */
function crmSendCodeWords(code) {
  if (code === 'NO_TEXT') return tx('Write the message.');
  if (code === 'TOO_LONG') return tx('Keep the message under 1000 characters.');
  if (code === 'CHANNEL_NOT_SENDABLE') return tx('Only WhatsApp can be sent from here today.');
  return '';
}
/** what a refused check or send says: a view-only login, the server's words for too many, the code's sentence, else try again */
function crmSendWords(error) {
  var code = error && error.data && error.data.code,
    words = crmSendServerWords(error);
  if (error && error.status === 403) return words || tx('Your login can only view.');
  if (code === 'TOO_MANY') return words || tx('Send to at most 100 at a time. Make a smaller group.');
  return crmSendCodeWords(code) || tx("Couldn't send. Try again.");
}
function crmSendBody(dryRun) {
  return { channel: GROUPS.channel, purpose: GROUPS.purpose, text: String((document.getElementById('crm_send_text') || {}).value || '').trim(), dry: !!dryRun };
}
/** the customers a dry run left out: five lines at most, each with the server's reason; empty when nobody was left out */
function crmSendRefusedHtml(refused) {
  if (!(refused && refused.length)) return '';
  return (
    '<div class="sub" data-testid="crm-send-refused">' +
    refused
      .slice(0, 5)
      .map(function (customer) {
        return esc(customer.name) + ' — ' + esc(customer.why);
      })
      .join('<br>') +
    (refused.length > 5 ? '<br>…' : '') +
    '</div>'
  );
}
/** show a dry run's answer: the count in the shop's words, who is left out, and the Send button's state */
function crmSendDryShown(reply, node, goButton) {
  var words = crmReachWords({ may: reply.may, not: reply.refused_n, refused_by: reply.refused_by });
  node.innerHTML = '<b data-testid="crm-send-may">' + esc(words.may) + '</b>' + (words.not ? ' · ' + esc(words.not) : '') + crmSendRefusedHtml(reply.refused);
  if (goButton) {
    goButton.disabled = !(reply.may > 0);
    goButton.title = reply.may > 0 ? '' : tx('Nobody may be sent this');
    goButton.textContent = reply.may > 0 ? txf('Send to {n}', { n: reply.may }) : tx('Send');
  }
}
/** the dry run: ask the server who may be sent this message and show the count before anything is sent */
function crmSendCheck(btn) {
  var node = document.getElementById('crm_send_who'),
    goButton = document.getElementById('crm_send_go') || document.querySelector('[data-testid="crm-send-go"]');
  var body = crmSendBody(true);
  if (!body.text) {
    node.textContent = tx('Write the message.');
    return;
  }
  return CBAction.run(
    btn,
    async function () {
      return api('crmSegSend', { params: { key: SEND.row.key }, body: body });
    },
    {
      key: 'send-check',
      busy: tx('Checking…'),
      onFail: function (words, e) {
        node.textContent = crmSendWords(e);
      },
      outcome: function (reply) {
        SEND.dry = reply;
        crmSendDryShown(reply, node, goButton);
      }
    }
  );
}
/** the three facts of a finished send in one line, never one number: sent · not sent (the sender refused or failed; its reason is on each line) · not asked (no consent, the server's codes) */
function crmSendDoneLine(reply) {
  var notSent = (reply.sent || []).filter(function (line) {
      return line.status !== 'sent';
    }).length,
    notAsked = (reply.refused_by || []).reduce(function (total, group) {
      return total + (Number(group.n) || 0);
    }, 0);
  return [
    txf('{n} sent', { n: reply.sent_n || 0 }),
    notSent ? txf('{n} not sent', { n: notSent }) : '',
    notAsked ? txf('{n} not asked — no consent', { n: notAsked }) : ''
  ]
    .filter(Boolean)
    .join(' · ');
}
/** one line per customer a send went to, eight at most, with the sender's status and reason; empty when it went to nobody */
function crmSendLinesHtml(sent) {
  if (!(sent || []).length) return '';
  return (
    '<div class="sub" data-testid="crm-send-lines">' +
    sent
      .slice(0, 8)
      .map(function (line) {
        return esc(line.name || line.party_id) + ' — ' + esc(tx(line.status)) + (line.reason ? ': ' + esc(line.reason) : '');
      })
      .join('<br>') +
    (sent.length > 8 ? '<br>…' : '') +
    '</div>'
  );
}
/** show a finished send: the outcome line, the customers' lines, and the Send button put away */
function crmSendDoneShown(reply, out) {
  out.innerHTML =
    '<div class="result" data-testid="crm-send-done"><span><span class="k">' + esc(tx('Outcome')) + '</span><b>' + esc(crmSendDoneLine(reply)) + '</b></span></div>' + crmSendLinesHtml(reply.sent);
  var node = document.querySelector('[data-testid="crm-send-go"]'),
    text = document.getElementById('crm_send_text');
  if (node) {
    node.disabled = true;
    node.title = tx('Sent');
  }
  if (text) text.defaultValue = text.value; /* the words are sent, not unsaved: Escape closes the sheet without "Discard it?" (sheet-dialog.js 8) */
}
/** send the message through CBAction, only after a dry run found someone who may be sent it */
function crmSendGo(btn) {
  var out = document.getElementById('crm_send_out'),
    body = crmSendBody(false);
  if (!SEND.dry || !(SEND.dry.may > 0)) {
    out.innerHTML = '<div class="hint">' + esc(tx('Check who may be sent first.')) + '</div>';
    return;
  }
  return CBAction.run(
    btn,
    async function () {
      return api('crmSegSend', { params: { key: SEND.row.key }, body: body });
    },
    {
      key: 'send-go',
      busy: tx('Sending…'),
      /* money promise: any send, any size, asks first — the words, the channel and how many (the server's dry count) */
      confirm: {
        title: txf('Send this WhatsApp offer to {n}?', { n: crmPlural(SEND.dry.may, 'customer', 'customers') }),
        body: '<div data-testid="crm-send-confirm-text">“' + esc(body.text) + '”</div><div>' + esc(tx('WhatsApp · offers — only to those who agreed')) + '</div>',
        yes: txf('Send to {n}', { n: SEND.dry.may }),
        danger: false
      },
      onFail: function (words, e) {
        out.innerHTML = '<div class="banner bad" data-testid="crm-send-fail">' + esc(crmSendWords(e)) + '</div>';
      },
      outcome: function (reply) {
        SEND.done = reply;
        document.dispatchEvent(new CustomEvent('crm-send-done', { detail: reply })); /* MKT (cap-marketing.js): Offers sent says when this send's refusals were not recorded */
        crmSendDoneShown(reply, out);
      }
    }
  );
}
