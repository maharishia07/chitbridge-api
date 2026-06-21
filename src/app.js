// NET feature app (separate from the legacy server.js entry).
// NET-01 mounts the network router only; chit + catalogue routers are added
// with NET-02 / NET-03 (do NOT require them before those files exist).
const express = require("express");
const app = express();
app.use(express.json());
app.use("/api/network", require("./routes/network"));
app.use("/api/network", require("./routes/chit"));         // NET-02
app.use("/api/network", require("./routes/catalogue"));    // NET-03 / catalogue feature
module.exports = app;   // export BEFORE any app.listen()
