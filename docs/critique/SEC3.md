# SEC3 critique — device keys stay inside their shop and their switch (written before any code)

(a) Assumptions, checked: · "any device key can CC any active identity via body.to" — TRUE: routes/connectors.js:298 takes `req.body.to`, emitSignalChit
(:126) accepts any `status='active'` row; /erp-ingest (:367) has the same hole. · "connector-key auth in middleware/auth.js" — PARTLY: the DEVICE key is the
ActorKey (X-Bridge-Key, provision_key_hash) checked inside /ingest and /erp-ingest themselves, not auth.js; auth.js holds the api-key `connector` scope (Tally
kit). · "one capability reader" — TRUE but local: requireConnector (connectors.js:56) is the only `capabilities` gate; the device routes skip it. · "/events/stats
readable by any signed-in user" — TRUE (routes/events.js:26, `auth` only) and the connector KEY scope lists it too (auth.js:363). Platform-role check =
platformroot.isRoot inside entities.js rootOnly (:1261, local). · "ingest answers 200 when the chit failed" — TRUE (:338 catch → note, res.json 200); the agent
(web public/app/cap-connector.js _agentJs) rejects only ≥400. · "'INR' stamp" — TRUE (:155). · Zoho tax list — TRUE (adapters/zoho.js taxIdFor `catch → _taxes=[]`,
cached, every later line untaxed). · Simulator — TRUE (scripts/connector-gateway-sim.js:31 production default, `https` only).
· "the same rule a person's send uses" — FALSE: a person may send to anyone (chits.js "Sender can send to any entity"). The shop's-own-parties rule is the TILL
key's (tillMaySend: customer_list + local-identity.mayTrade); widened here to customer OR supplier list (books-store partyOn's test). · Area docs (chitbridge-docs)
are an EMPTY checkout on this runner — the SPEC "Gaps" could not be read; built from the brief + code.
(b) Conflicts: one reader — lift requireConnector's read into `connectorOn(entity_id)` and point the gate + both device routes at it. One root check — lift
rootOnly into lib/platformroot `refuseUnlessRoot`; entities.js uses it. One money — the till's "own currency, else the pack's, else null + NO_MONEY" moves to
country-setup.shopMoney; till + connectors call it. Errors carry codes (DEVICE_TO_REFUSED · CAPABILITY_OFF · CHIT_NOT_DELIVERED) — the agent branches on status.
(c) Simpler: put the CC rule once in a `deviceMayAddress` used by both device routes (not in emitSignalChit, which the owner-authed erp-test also calls).
(d) Risks: · ⚠️ gating the api-key `connector` scope (Tally kit) on the capability would cut off every live Tally kit — integrations.js:189 mints connector keys for
ANY shop, and no route ever writes `capabilities`; most shops do not hold 'connector'. So the switch applies to DEVICE keys (ActorKey) only; the Tally kit
stays on its enrol-approval gate. · An owner-configured counterparty (work pattern / connector_config) that is not a party is now refused too — said in words.
· mint.summary defaults falsy currency to INR — widened additively: explicit `null` stays null. The DB deliver still COALESCEs to 'INR' (b50 function) — said
in the report, no migration this round (b469–b471 unused). · Twin: api first, then web (agent template). No engines change.
(e) VERDICT: BUILD WITH CHANGES — capability switch on device keys (not the Tally kit's api-key scope); CC rule = shop + its customer/supplier list + mayTrade.
