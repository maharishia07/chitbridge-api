'use strict';
/* lib/profilemap.js — the one-line door from the engine's require('./profilemap') to this repo's adopted lib/profile-map.js
 * OWNER     cb-platform
 * OWNS      nothing of its own: only the name the adopted engines/country.js asks for (engines v1.107.0 reads the India GSTIN check with require('./profilemap'); engines.lock.json keeps it as lib/profile-map.js). Not adopted, not an engine: remove it when the engine requires the adopted name.
 * CALLED BY the adopted engines copy lib/country.js
 * FLOW      require('./profilemap') -> module.exports of ./profile-map (same object, no wrapper)
 * CARD      28-platform-and-operations/know-your-business
 * RISK      plain */
module.exports = require('./profile-map');
