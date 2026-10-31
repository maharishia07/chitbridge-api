#!/usr/bin/env node
/**
 * tools/network-seed-root.cjs — the installer makes an installation's first private root entity THROUGH THE ONE REGISTER DOOR (not a database insert).
 *   docker compose exec -T api node tools/network-seed-root.cjs        (reads CB_INSTALLER_HANDLE · CB_INSTALLER_TOKEN · CB_ROOT_EMAIL · CB_ROOT_NAME from the api's environment)
 *
 * It calls POST /api/entities/register and POST /api/entities/verify on the api itself (127.0.0.1). The verify accepts the installer token only for this handle and only while no
 * registered business is active here (lib/installer-token.js, called by lib/otp.verifyOtp). So the governance stamp keeps its existing writers; nothing is inserted behind the door.
 * Prints one JSON line { handle, identity_id, bridge_id, made } and no secret. Safe to run again: a root that exists is reported, not remade.
 * OWNS: nothing. CALLED BY: deploy/network/install.sh. CARD 18-identity-sign-in-and-access/platform-root
 * FLOW: env (handle, token) → existing(handle)? report it : POST /api/entities/register → POST /api/entities/verify (the installer token) → one JSON line, exit 0;
 *       no handle, no token, or a door that refused → its words on stderr, exit 1. Tested by tests/network-tools.test.cjs.
 */
'use strict';
const path = require('path');
const base = 'http://127.0.0.1:' + (process.env.PORT || 3000);
const { query } = require(path.join(__dirname, '..', 'db'));

const post = async (url, body) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  /* a door that answers with no JSON body is still told by its status; the words below say which door and what status */
  const answer = await res.json().catch((e) => {
    console.error('network-seed-root: ' + url + ' answered ' + res.status + ' with no JSON body (' + e.message + ')');
    return {};
  });
  return { status: res.status, body: answer };
};

async function existing(handle) {
  const found = await query(`SELECT identity_id, bridge_id, status FROM identities WHERE lower(user_id) = lower($1) AND identity_type = 'entity'`, [handle]);
  return found.rows[0] || null;
}

/** the root through the ONE register door, then the verify that takes the installer token; a root half-made earlier (registered, not verified) is verified, not registered again → throws the door's words */
async function registerAndVerify(handle, token, halfMade) {
  const email = process.env.CB_ROOT_EMAIL || handle + '@example.org';
  const name = process.env.CB_ROOT_NAME || handle;
  const registered = await post('/api/entities/register', { email, display_name: name, user_id: handle });
  if (registered.status >= 400 && !halfMade) throw new Error('register answered ' + registered.status + ': ' + JSON.stringify(registered.body).slice(0, 300));
  const verified = await post('/api/entities/verify', { email, otp: token });
  if (verified.status >= 400 || !verified.body.entity) throw new Error('verify answered ' + verified.status + ': ' + JSON.stringify(verified.body).slice(0, 300));
}

(async () => {
  const handle = String(process.env.CB_INSTALLER_HANDLE || '').trim();
  const token = String(process.env.CB_INSTALLER_TOKEN || '');
  if (!handle) throw new Error('CB_INSTALLER_HANDLE is not set: there is no root to make');
  const have = await existing(handle);
  if (have && have.status === 'active') {
    console.log(JSON.stringify({ handle, identity_id: have.identity_id, bridge_id: have.bridge_id, made: false }));
    return;
  }
  if (!token) throw new Error('CB_INSTALLER_TOKEN is not set and the root does not exist yet');
  await registerAndVerify(handle, token, !!have);
  const made = await existing(handle);
  console.log(JSON.stringify({ handle, identity_id: made.identity_id, bridge_id: made.bridge_id, made: true }));
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('network-seed-root: ' + e.message);
    process.exit(1);
  });
