/* cap-crm-groups-window.js — PART of cap-crm-groups.js (MNT-59): the Shop window screen (#/showcase), the template chooser, the preview of the shop's own page and the share with a party or a group.
 * OWNS      SHOW (the screen's state) · crmShopUrl · crmShowcase · crmShowcaseLoad · crmShowcasePaint · crmShowcasePick · crmSharePick · crmShareParty · crmShareVerdict · crmSharePaint · crmShareGo · crmShareGroup · the click on a template card.
 * CALLED BY cap-crm.js (crmShowcase on #/showcase) · cap-crm-groups.js (the base: crmGroupsClick calls crmShopUrl, crmShareGroup, crmShareParty, crmShareGo; crm.html loads this file after it) · cap-marketing.js (the Shop window tab).
 * FLOW      #/showcase → crmShowcase paints → crmShowcaseLoad reads the policy flags → a template pick writes showcase_template → a share reads the party's consent (crmShareParty) → crmShareVerdict → crmShareGo sends through the consented channel.
 * CARD      11-crm-and-marketing/marketing-app
 * Moved byte for byte out of cap-crm-groups.js; no behaviour changed. Needs the base's GROUPS and crmSendOpen (cap-crm-groups-send.js), CBShowcase (cap-showcase.js) and the host globals of cap-crm.js. */
'use strict';
/* the base's GROUPS (cap-crm-groups.js) and the host's CRM (cap-crm.js) load first; both are read as window.GROUPS / window.CRM, so this file declares no name of theirs */
/* ═══ THE SHOP WINDOW — pick a template, preview the shop's own page, share the link through the consented channel ═══ */
var SHOW = { flags: null, state: 'loading', err: null, gen: 0, party: null, rec: null, busy: false };
function crmShopUrl() {
  var id = SESSION.bridgeId || '';
  return location.origin + '/shop.html?s=' + encodeURIComponent(id);
}
/** paint the Shop window screen: template chooser, preview and the share-with-a-party / group controls */
function crmShowcase(frame) {
  crmBar('<strong>' + esc(crmAppName()) + '</strong>', '', false);
  var node = document.getElementById('screen');
  node.className = 'screen';
  node.innerHTML =
    '<div class="content" data-testid="crm-showcase"><div class="rsec" style="padding:14px"><div class="sec">' +
    esc(tx('Shop window')) +
    '</div>' +
    '<p class="hint" style="margin:0 0 10px">' +
    esc(tx('Your customers see this page. Pick its look, then share the link with those who agreed to hear from you.')) +
    '</p>' +
    '<div id="crm_sc_pick" data-testid="crm-sc-pick"><div class="loadwrap"><span class="spin"></span>' +
    esc(tx('Reading…')) +
    '</div></div></div>' +
    '<div class="rsec" style="padding:14px"><div class="sec">' +
    esc(tx('Share')) +
    '</div>' +
    '<div class="kv"><b>' +
    esc(tx('Link')) +
    '</b><span class="mono" data-testid="crm-sc-url">' +
    esc(crmShopUrl()) +
    '</span></div>' +
    '<div class="supacts"><button data-cbsid="CRM008-B04" type="button" class="act sm quiet" data-crm="sccopy" data-testid="crm-sc-copy">' +
    esc(tx('Copy link')) +
    '</button>' +
    '<button data-cbsid="CRM008-B05" type="button" class="act sm quiet" data-crm="scgroup" data-testid="crm-sc-group">' +
    esc(tx('Share with a group')) +
    '</button></div>' +
    '<label style="display:block;margin-top:12px;font-size:13.5px;font-weight:600">' +
    esc(tx('Share with a party')) +
    '<input data-cbsid="CRM008-I04" class="inp" id="crm_sc_q" data-testid="crm-sc-q" placeholder="' +
    esc(tx('Name, ID, phone')) +
    '" autocomplete="off" oninput="crmSharePick(this.value)"></label>' +
    '<div id="crm_sc_res" data-testid="crm-sc-res"></div><div id="crm_sc_party" data-testid="crm-sc-party"></div></div></div>';
  if (frame) return;
  if (!window.CRM.loaded) crmLoad(true);
  crmShowcaseLoad();
}
/** read the policy flags (the chosen template) and repaint the chooser; an unreadable answer shows the default */
async function crmShowcaseLoad() {
  var generation = ++SHOW.gen;
  try {
    var reply = await api('policyGet');
    if (generation !== SHOW.gen) return;
    SHOW.flags = (reply && reply.flags) || {};
    SHOW.state = 'ready';
  } catch (e) {
    if (generation !== SHOW.gen) return;
    SHOW.flags = {};
    SHOW.state = 'error';
    SHOW.err = e;
  }
  crmShowcasePaint();
}
/** paint the template chooser, greyed with a sentence when the login can only view */
function crmShowcasePaint() {
  var box = document.getElementById('crm_sc_pick');
  if (!box || typeof CBShowcasePick === 'undefined') return;
  var blocked = crmEdit() ? '' : tx('Your login can only view.');
  box.innerHTML =
    (SHOW.state === 'error'
      ? '<div class="hint" data-testid="crm-sc-readfail">' + esc(tx('Could not read the current choice. The default is shown.')) + '</div>'
      : '') +
    CBShowcasePick.html({
      current: SHOW.flags && SHOW.flags.showcase_template,
      shopId: SESSION.bridgeId || '',
      t: tx,
      cls: 'act sm quiet',
      clsOn: 'act sm',
      why: blocked,
      origin: ''
    }) +
    '<div id="crm_sc_msg" class="hint" role="status" data-testid="crm-sc-msg"></div>';
}
/** save the chosen showcase template through CBAction */
function crmShowcasePick(name, btn) {
  var msg = document.getElementById('crm_sc_msg');
  return CBAction.run(
    btn,
    async function () {
      return api('policySet', { body: { showcase_template: name } });
    },
    {
      key: 'sc-pick',
      busy: tx('Saving…'),
      onFail: function (words, e) {
        if (msg) msg.textContent = (e && e.status === 403 && e.data && (e.data.why || e.data.message)) || tx("Couldn't save the choice. Try again.");
      },
      outcome: function () {
        SHOW.flags = Object.assign({}, SHOW.flags, { showcase_template: name });
        crmShowcasePaint();
        toast(tx('Shop window saved'));
      }
    }
  );
}
/* share with a party: the record's own consent verdict (contact_prefs.may — the server's code) decides whether Share is lit */
function crmSharePick(query) {
  var box = document.getElementById('crm_sc_res');
  if (!box) return;
  query = String(query || '')
    .trim()
    .toLowerCase();
  if (!query) {
    box.innerHTML = '';
    return;
  }
  var list = window.CRM.rows
    .filter(function (item) {
      return item.kind !== 'walk-in' && [item.display_name, item.nickname, item.party_no, item.phone, item.user_id].join(' ').toLowerCase().indexOf(query) >= 0;
    })
    .slice(0, 5);
  box.innerHTML =
    list
      .map(function (item) {
        return (
          '<button data-cbsid="CRM008-B06" type="button" class="result" style="text-align:left;background:var(--surface);width:100%;margin-top:6px" data-crm="scparty" data-k="' +
          esc(item.party_id) +
          '" data-testid="crm-sc-pick-' +
          esc(crmKey(item)) +
          '"><span><b>' +
          esc(item.display_name) +
          '</b> <span class="sub">' +
          esc(item.party_no || item.phone || '') +
          '</span></span></button>'
        );
      })
      .join('') || '<div class="hint">' + esc(tx('Nobody matches.')) + '</div>';
}
/** choose the party to share the shop link with, then paint the share box */
async function crmShareParty(partyKey) {
  var party =
      window.CRM.byKey[partyKey] ||
      window.CRM.rows.filter(function (x) {
        return x.party_id === partyKey;
      })[0],
    box = document.getElementById('crm_sc_party');
  if (!party || !box) return;
  SHOW.party = party;
  SHOW.rec = null;
  box.innerHTML = '<div class="loadwrap"><span class="spin"></span>' + esc(tx('Reading their consent…')) + '</div>';
  var generation = ++SHOW.gen;
  try {
    SHOW.rec = await api('crmParty', { params: { id: party.party_id } });
  } catch (e) {
    if (typeof cblog === 'function') cblog('error', 'share: record read failed: ' + ((e && e.message) || e));
    SHOW.rec = null;
  }
  if (generation !== SHOW.gen || SHOW.party !== party) return;
  crmSharePaint();
}
function crmShareVerdict() {
  var rec = SHOW.rec,
    prefs = rec && rec.contact_prefs,
    allowed = prefs && prefs.may && prefs.may[window.GROUPS.channel] && prefs.may[window.GROUPS.channel][window.GROUPS.purpose];
  if (!rec) return { may: false, code: 'UNREADABLE', why: tx('Could not read their consent, so nothing can be sent.') };
  if (!allowed) return { may: false, code: 'NO_CONSENT', why: tx('No consent for offers on WhatsApp. Ask them first.') };
  return allowed;
}
/** copy the shop's link; where the clipboard is not there, show the link itself so it can be copied by hand */
function crmShopLinkCopy() {
  var shopUrl = crmShopUrl();
  (navigator.clipboard ? navigator.clipboard.writeText(shopUrl) : Promise.reject(new Error('no clipboard'))).then(
    function () {
      toast(tx('Link copied'));
    },
    function () {
      toast(shopUrl);
    }
  );
}
/** the Send sheet for the group picked in the share list, opened with the shop-window message filled in */
function crmSharePicked(key) {
  var group = window.GROUPS.rows.filter(function (row) {
    return row.key === key;
  })[0];
  closeModal();
  if (group) crmSendOpen(group, { text: txf('Have a look at our shop window: {url}', { url: crmShopUrl() }) });
}
/** the clicks of the Shop window (the share box and its link); true when this module answered, false for an action that is not its own */
function crmShareClick(action, node) {
  if (action === 'sccopy') crmShopLinkCopy();
  else if (action === 'scgroup') crmShareGroup();
  else if (action === 'scgrouppick') crmSharePicked(node.getAttribute('data-k'));
  else if (action === 'scparty') crmShareParty(node.getAttribute('data-k'));
  else if (action === 'scshare') crmShareGo(node);
  else return false;
  return true;
}
/** why Share on WhatsApp is greyed for this party, in the shop's words; empty when it may go (no phone, not allowed, view-only) */
function crmShareBlockedWhy(party, verdict) {
  if (!crmEdit()) return tx('Your login can only view.');
  if (!verdict.may) return verdict.why || tx('Not allowed');
  return String(party.phone || '').replace(/[^0-9]/g, '') ? '' : tx('No phone number yet');
}
/** paint the share box: the server's verdict on this party, greyed with its reason */
function crmSharePaint() {
  var party = SHOW.party,
    box = document.getElementById('crm_sc_party');
  if (!party || !box) return;
  var verdict = crmShareVerdict(),
    blockedWhy = crmShareBlockedWhy(party, verdict);
  box.innerHTML =
    '<div class="result" data-testid="crm-sc-verdict" data-code="' +
    esc(verdict.code || '') +
    '"><span><span class="k">' +
    esc(tx('Share with')) +
    '</span><b>' +
    esc(party.display_name) +
    '</b></span>' +
    '<span class="tag' +
    (verdict.may ? ' on' : ' amber') +
    '" data-testid="crm-sc-may">' +
    esc(verdict.may ? tx('They agreed to offers') : tx('Not now')) +
    '</span></div>' +
    '<div class="supacts" style="margin-top:8px">' +
    (blockedWhy
      ? crmViewOnlyBtn('crm-sc-share', tx('Share on WhatsApp'), blockedWhy)
      : '<button data-cbsid="CRM008-B07" type="button" class="act sm" data-crm="scshare" data-testid="crm-sc-share">' + esc(tx('Share on WhatsApp')) + '</button>') +
    '</div>';
}
/** the share: the shop's own phone sends it (wa.me, the device), and the out message is LOGGED through the gated route — the server decides again */
function crmShareGo(btn) {
  var party = SHOW.party;
  if (!party) return;
  var phone = String(party.phone || '').replace(/[^0-9]/g, ''),
    text = txf('Have a look at our shop window: {url}', { url: crmShopUrl() });
  return CBAction.run(
    btn,
    async function () {
      return api('crmLog', {
        params: { id: party.party_id },
        body: { kind: 'message', direction: 'out', channel: window.GROUPS.channel, purpose: window.GROUPS.purpose, body: text }
      });
    },
    {
      key: 'sc-share',
      busy: tx('Opening…'),
      onFail: function (words, e) {
        var box = document.getElementById('crm_sc_party');
        if (box)
          box.insertAdjacentHTML(
            'beforeend',
            '<div class="banner bad" data-testid="crm-sc-refused">' +
              esc((e && e.data && (e.data.why || e.data.message)) || tx("Couldn't share. Try again.")) +
              '</div>'
          );
      },
      outcome: function () {
        var popup = window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
        if (!popup && typeof cblog === 'function') cblog('warn', 'share: the WhatsApp window was blocked');
        toast(tx('Shared — the message is on their timeline'));
      }
    }
  );
}
/** share the shop link with a group: load the groups first if needed, then offer the list to pick from */
function crmShareGroup() {
  if (!window.GROUPS.loaded) {
    toast(tx('Reading your groups…'));
    return crmGroupsLoad(true).then(crmShareGroup);
  }
  var rows = window.GROUPS.rows;
  if (!rows.length) {
    toast(tx('No groups yet. Make one under Groups.'));
    return;
  }
  ui.dialog({
    mount: 'CRM008-U203',
    pop: 'POP105',
    title: 'Share with a group',
    testid: 'crm-sc-groups',
    body: rows
        .map(function (item) {
          return (
            '<button data-cbsid="CRM008-B08" type="button" class="result" style="text-align:left;background:var(--surface)" data-crm="scgrouppick" data-k="' +
            esc(item.key) +
            '" data-testid="crm-sc-grp-' +
            crmGroupTid(item) +
            '"><span><b>' +
            esc(item.name) +
            '</b> <span class="sub">' +
            esc(crmPlural(item.count, 'member', 'members')) +
            ' · ' +
            esc(crmReachWords(item.reach).may) +
            '</span></span></button>'
          );
        })
        .join(''),
    actions: [
      { name: 'cancel', options: { mount: 'CRM008-U203' } }
    ]
  });
}
document.addEventListener('click', function (event) {
  var node = event.target.closest && event.target.closest('[data-sc-pick]');
  if (!node || node.disabled) return;
  if (window.CRM.route && window.CRM.route.view === 'showcase') crmShowcasePick(node.getAttribute('data-sc-pick'), node);
});
