/*
 * OWNS      the NET feature app: the Express app for src/routes/network.js on /api/network (separate from the legacy server.js entry).
 * CALLED BY tests/network.spec.js (jest, opt-in CI job integration-legacy)
 * FLOW      request → express.json → /api/network → src/routes/network.js (the empty catalogue stub was removed, MNT-52; the NET-02 cb_chit loop route is retired, chit writes live on /api/chits)
 * CARD      04-network/connections-and-invitations
 */
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/network', require('./routes/network'));
module.exports = app; // export BEFORE any app.listen()
