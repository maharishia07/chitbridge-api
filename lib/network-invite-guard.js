'use strict';
/**
 * lib/network-invite-guard.js — an invite to a business on another installation is refused in words
 * OWNER     cb-network
 * RISK      plain
 * OWNS      the invite step's remote refusal (reviews4 GF-network-01 M3): a business on ANOTHER installation cannot be invited yet (NET-77, the same refusal an ask gets);
 *           the edge would live on this server alone and sit "pending" for ever.
 * CALLED BY lib/network-build-run.js inviteNode
 * FLOW      identity id -> services/network.refuseRemote (the one remote test, ctpaddress.resolve) -> the sentence, or null when the business is local
 * CARD      04-network/connections-and-invitations
 */
async function remoteReason(identityId) {
  try {
    await require('../src/services/network').refuseRemote([identityId]);
    return null;
  } catch (e) {
    if (e && e.code === 'NETWORK_REMOTE_NOT_YET') return 'That business is on another ChitBridge installation, and an invitation across installations cannot be sent yet.';
    throw e;
  }
}
module.exports = { remoteReason };
