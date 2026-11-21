'use strict';
/* red1128: engines v1.107.0 country.js reads the India GSTIN check with require('./profilemap'), the name the engine has in its own src/. This repo keeps it as lib/profile-map.js (engines.lock.json), so the engine's require needs this one-line door. Not adopted, not an engine: remove it when the engine requires the adopted name. */
module.exports = require('./profile-map');
