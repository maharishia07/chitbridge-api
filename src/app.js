// NET feature app (separate from the legacy server.js entry).
// network + catalogue routers on /api/network. The NET-02 cb_chit chit-loop
// route is RETIRED (chit writes live on /api/chits chit_header); the cb_chit
// table stays dormant and src/services/chit still backs network.js's settle-guard.
const express = require("express");
const app = express();
app.use(express.json());
app.use("/api/network", require("./routes/network"));
app.use("/api/network", require("./routes/catalogue"));    // NET-03 / catalogue feature
module.exports = app;   // export BEFORE any app.listen()
