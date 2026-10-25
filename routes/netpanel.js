// routes/netpanel.js — the network control panel, slice 1 (read-only).   CARD 28-platform-and-operations/network-control-panel
// OWNS      GET /api/network/installations: how many installations there are and what each one is (the master's view). Zero outbound calls; acts on nothing.
// CALLED BY server.js (app.use('/api/network/installations')) · public/network-panel.html (web)
// FLOW      auth → the root of this deployment (lib/platformroot) → this installation is the MASTER (lib/netmember.roleOf) → lib/netmember.listMembers → lib/netpanel.answer
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const platformroot = require('../lib/platformroot');
const netmember = require('../lib/netmember');
const panel = require('../lib/netpanel');
const { problem, fromError } = require('../lib/problem');

/** this process's own version, for the master's row (it is not asked, it is the one answering) */
const ownVersion = () => {
  const version = require('../package.json').version;
  const commit = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.SOURCE_COMMIT || '';
  return commit ? version + '+' + commit.slice(0, 7) : version;
};

/** the member's root is told who controls it, in words; a standalone installation is told it controls no one */
function refuseUnlessMaster(req, res, role) {
  if (role.role === 'master') return true;
  const master = netmember.pinned(role);
  const detail = master ? 'This installation is controlled by ' + master.domain + '.' : 'This installation is not a network master.';
  problem(req, res, { status: 403, code: 'NETWORK_MASTER_ONLY', detail, hint: master ? 'Open the control panel on ' + master.domain + '.' : undefined });
  return false;
}

router.get('/', auth, async (req, res) => {
  if (!platformroot.refuseUnlessRoot(req, res)) return;
  try {
    const role = await netmember.roleOf();
    if (!refuseUnlessMaster(req, res, role)) return;
    res.json(panel.answer(await netmember.listMembers(), Date.now(), { version: ownVersion() }));
  } catch (e) {
    fromError(req, res, e);
  }
});

module.exports = router;
