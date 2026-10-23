# Error codes (API-STANDARD S14, owner cb-api)

One row per code the API can answer. The table is the master; `docs/error-codes.json` is generated from it (`node tools/error-codes.cjs --write`).
`node tools/error-codes.cjs --check` fails on a duplicate code, an empty cell, a drifted json, or a `code: 'X'` in the code that is not a row.

- `shopkeeper` is the plain sentence a person sees: what happened and what to do, inside the copy budget, no jargon. `PENDING` means the owning area has not written it yet; the ratchet counts PENDING rows down and never up.
- `status` is read from the code that raises it (`varies` when none sits beside the literal). `owner_area` is the file that raises it until the owning area is named. `hint` is `-` until written.
- A code is never reused for another meaning and never deleted: deprecate it. Reuse before add: `node C:/dev/seams.cjs <word>`, then this table.

<!-- codes:start -->
| code | status | title | shopkeeper | hint | owner_area | since |
|---|---|---|---|---|---|---|
| ACTOR_KEY_TAKEN | 400/409 | Login key taken | That login key is already taken, even by someone who was removed. | Pick a different key. | actors | 2026-10-23 |
| ADVICE_EXISTS | 409 | Advice already recorded | An advice is already recorded for this payment. | Open the payment to see it. | books | 2026-10-22 |
| AI_GATED | 402 | AI not available | AI drafting is not available for your shop right now. | Check your AI allowance in Settings. | governance | 2026-10-23 |
| AI_LIMIT | 429 | AI limit reached | You have used your AI allowance for now. | Try again later. | governance | 2026-10-23 |
| AI_PROVIDER | 502 | AI did not answer | The AI did not answer just now. | Try again in a moment. | governance | 2026-10-23 |
| ALL_REFUSED | varies | All refused | PENDING | - | marketing-results | 2026-10-22 |
| ALL_SENT | varies | All sent | PENDING | - | verdict | 2026-10-22 |
| ALREADY_ASSIGNED | 400 | Already assigned | Someone already holds this task. | Ask them to hand it back first. | actors | 2026-10-23 |
| ALREADY_CLAIMED | 409 | Already claimed | This business has already been claimed. | Sign in with its claim code, or ask the network for a new one. | network | 2026-10-23 |
| ALREADY_PAID | 409 | Already paid | This looks like a payment you already recorded. | Check the list, then confirm if it is really a new one. | books | 2026-10-22 |
| ALREADY_RECORDED | 409 | Already recorded | That is already recorded. | Refresh the list: it is already there. | books | 2026-10-23 |
| ALREADY_REVERSED | 409 | Already reversed | This entry was already reversed. | Open the reversal to see it. | books | 2026-10-22 |
| AMBIGUOUS_NAME | 409 | Ambiguous name | PENDING | - | signin | 2026-10-22 |
| ASSIST_BAD_REQUEST | 422 | Question not usable | That question could not be used. | Read the sentence shown, fix it and try again. | assist | 2026-10-23 |
| ASSIST_GATED | 503 | Assistant resting | The assistant is resting for now. | The help library answers instead; try again later. | assist | 2026-10-22 |
| ASSIST_NOT_CONFIGURED | 503 | Assistant not switched on | The assistant is not switched on here yet. | The help library answers instead. | assist | 2026-10-23 |
| ASSIST_NOT_HELPDESK | 403 | Help desks only | Only a help desk can publish to its catalogue. | Ask your help desk to publish this answer. | assist | 2026-10-23 |
| ASSIST_NOT_OWNER | 403 | Owned by another brand | That belongs to another brand, so you cannot change it. | Change only what your own business owns. | assist | 2026-10-23 |
| ASSIST_NO_ANSWER | 502 | No answer this time | The assistant did not produce an answer. | Try again, or read the help library. | assist | 2026-10-23 |
| ASSIST_REVIEW_RETIRED | 410 | Review has moved | Reviewing questions here is retired. | Answer the question on its chit, then publish it. | assist | 2026-10-23 |
| ASSIST_SIGN_IN | 503 | Sign in for the assistant | Sign in for fuller answers from the assistant. | Sign in and ask again; the help library answers meanwhile. | assist | 2026-10-22 |
| ASSIST_UPSTREAM | 502 | Assistant busy | The assistant is busy right now. | Try again in a moment. | assist | 2026-10-23 |
| AUTO_TOKEN | varies | Auto token | PENDING | - | auth | 2026-10-22 |
| A_INVARIANT | 422 | Rule would be loosened | That would loosen a rule the platform has set. | Only tighten the setting, never loosen it. | governance | 2026-10-23 |
| BAD_FLAG | 400 | Flag not true or false | priceIncludesTax must be true or false. | Send true or false. | tax | 2026-10-23 |
| BAD_PERIOD | 400 | Bad period | Ask for a week, a month, a quarter or a year. | Pick one of those and try again. | till-summary | 2026-10-22 |
| BAD_PHONE | 400 | Bad phone | Type the mobile number with its country code, 10 to 15 digits. | Check the number and try again. | counters | 2026-10-22 |
| BAD_PRICE | 400 | Price below zero | A line has a price below 0. | Send a price of 0 or more. | tax | 2026-10-23 |
| BAD_QTY | 400 | Quantity not above zero | A line needs a quantity above 0. | Send a quantity above 0 on every line. | tax | 2026-10-23 |
| BAD_RATE | 400 | Tax rate out of range | A line has a tax rate outside 0 to 100 percent. | Send a rate from 0 to 100. | tax | 2026-10-23 |
| BAD_STATE | 409 | Not in that state | This connection is not in a state where that can be done. | Refresh the list and look at where it stands. | network | 2026-10-23 |
| BAD_TYPE | 400 | Unknown connection type | A connection is either governance or commercial. | Send one of those two words. | network | 2026-10-23 |
| BILL_NOT_RECORDED | varies | Bill not recorded | That bill has not reached ChitBridge yet. | It is tried again once the bill arrives. | till | 2026-10-22 |
| BODY_TOO_LARGE | 413 | Too large | What you sent is too big to accept. | Send less at a time. | api | 2026-10-22 |
| BOOKS_BAD_REQUEST | 400 | Ledger needs an answer | The ledger needs one more answer before it can do that. | Read the question shown and answer it. | books | 2026-10-22 |
| BOOKS_CONFLICT | 409 | Ledger cannot take that | The ledger cannot take that as it stands. | Read the sentence shown, fix it and try again. | books | 2026-10-23 |
| BOOKS_ENGINE | 503 | Ledger calculations unavailable | The ledger calculations are not available yet. | Try again later. If it stays, tell us. | books | 2026-10-23 |
| BOOKS_NOT_MIGRATED | 503 | Ledger update pending | This cannot be saved yet: a database update is still to arrive. | Try again after the next update. | books | 2026-10-22 |
| BOOKS_REFUSED | 422 | Ledger refused | The ledger refused that, and the sentence says why. | Fix what the sentence says and try again. | books | 2026-10-23 |
| B_CAPABILITY | 422 | More than the plan allows | That is more than this shop's plan allows. | Choose from what the plan grants. | governance | 2026-10-23 |
| CAPABILITY_OFF | 403 | Capability off | This shop has switched its connector capability off, so devices and connectors are refused. | Turn the connector capability back on to resume. | connectors | 2026-10-22 |
| CATALOGUE_NOT_EMPTY | 409 | Shop already has products | This shop already has products. | Start a starter list only on an empty shop. | till | 2026-10-23 |
| CATALOGUE_STORE_MISSING | 503 | Saved catalogues not ready | Saved catalogues are not ready on this server yet. | Try again after the next update. | assist | 2026-10-22 |
| CATEGORIES_NOT_SET_UP | 500 | Categories not set up | Your categories could not be set up, so nothing was added. | Try again in a moment. | till | 2026-10-23 |
| CHILD_NOT_FOUND | 404 | Business not found | We could not find that business. | Check its handle and try again. | network | 2026-10-23 |
| CHIT_AND_ACTION_REQUIRED | 400 | Task and action needed | Say which task and what to do with it. | Send the task and the action. | actors | 2026-10-23 |
| CHIT_NOT_DELIVERED | 503 | Chit not delivered | The reading arrived but its chit could not be delivered. | The device keeps the event and sends it again. | connectors | 2026-10-22 |
| CHOOSE_IDENTITY | 409 | Choose identity | PENDING | - | signin | 2026-10-22 |
| CLAIM_RECORDED | 409 | Claim recorded | That claim is already recorded. | Nothing more to do: the points were moved. | reward-store | 2026-10-22 |
| COMMENT_ONLY | 403 | Comment only | Your access is comment-only. | Ask the owner for edit access. | books | 2026-10-23 |
| COMPARE_NOT_ALLOWED | 403 | Compare not allowed | Only the owner or the shop's auditor may compare the books. | Ask the owner. | books | 2026-10-23 |
| CONFIRM_REMOVE | 400 | Confirm remove | Removing a person cannot be undone, so it needs your confirmation. | Confirm the removal to go on. | actors | 2026-10-22 |
| CONFORMANCE | 422 | Rule not met | That does not meet the platform's rules. | Change it to fit the rules, then try again. | governance | 2026-10-23 |
| CONNECTION_BAD_REQUEST | 400 | Cannot connect to yourself | You cannot connect to your own business. | Choose another business. | network | 2026-10-23 |
| CONNECTION_EXISTS | 400 | Already connected | A connection with this business already exists. | Open your connections to see where it stands. | network | 2026-10-23 |
| CONNECTOR_DEVICE_OFF | 409 | Connection switched off | This device connection is switched off. | Switch it on in the connector’s list. | connectors | 2026-10-23 |
| CONNECTOR_HAS_DEVICES | 409 | Connector has devices | This connector still has devices attached. | Remove its devices first, then delete it. | connectors | 2026-10-23 |
| CONNECTOR_HAS_NO_KEY | 400 | Connector has no key | This connector was set up without a key, so there is nothing to approve. | Download the kit again while signed in as the owner. | integrations | 2026-10-23 |
| CONNECTOR_IN_USE | 409 | Connector in use | This connector has raised records, so it cannot be deleted. | Switch its devices off instead. | connectors | 2026-10-23 |
| CONNECTOR_KEY_ADMIN_ONLY | 403 | Key reissue not allowed | Only the business admin or a manager can reissue a device key. | Ask the admin or a manager to do it. | connectors | 2026-10-23 |
| CONNECTOR_NAME_MISMATCH | 400 | Gateway name does not match | The gateway name you typed does not match. | Type the name exactly as it is shown. | connectors | 2026-10-23 |
| CONNECTOR_NO_EMAIL | 400 | No email to send to | The business has no email address to send the code to. | Add an email address in Settings, then ask again. | connectors | 2026-10-23 |
| CONNECTOR_WRONG_TYPE | 409 | Wrong kind of connector | This door is only for ERP connectors. | Devices send their readings to the device door. | connectors | 2026-10-23 |
| CONSENT_UNREADABLE | varies | Consent unreadable | PENDING | - | whatsapp-out | 2026-10-22 |
| CONTAINER_STORE_MISSING | 503 | Product containers not ready | Product containers are not ready on this server yet. | Try again after the next update. | assist | 2026-10-22 |
| COST_BLIND | varies | Cost blind | Your access does not include cost or price. | Ask the owner to give you Sees costs, or change availability only. | cost | 2026-10-22 |
| COUNTER_BAD_REQUEST | 400 | Counter request not valid | That counter request is missing something or is not right. | Check the name and try again. | counters | 2026-10-23 |
| COUNTER_CLOSED | 401 | Counter closed | PENDING | - | auth | 2026-10-22 |
| COUNTER_HELD | varies | Counter held | That counter is open on another PC. | Close it there first, or take it over when asked. | counters | 2026-10-22 |
| COUNTER_NOT_MIGRATED | 503 | Counter update pending | Counters cannot be changed yet: a database update is still to arrive. | Try again after the next update. | counters | 2026-10-23 |
| COUNTER_SESSION_ONLY | 403 | Counters need a person | Counters are managed by a signed-in person, not by a key. | Sign in as the owner to change a counter. | counters | 2026-10-23 |
| COUNTRY_SETUP_NOT_MIGRATED | 503 | Country setup not ready | Country setup arrives after the next update. Selling and the rail work meanwhile. | Carry on selling; come back after the update. | governance | 2026-10-23 |
| COUNTRY_SETUP_PENDING | 422 | Country setup pending | Finish the country setup before using the ledger. | Open Country setup and complete it. | country-setup | 2026-10-22 |
| COVER_CONFLICT | 400 | Cover conflict | Going off would leave someone without cover. | Wait until the other person is back, or change who covers. | actors | 2026-10-22 |
| CRM_NOT_MIGRATED | 503 | Crm not migrated | Follow-ups and call notes are not set up here yet. | Try again after the next update. | crm | 2026-10-22 |
| CTP_CROSSING_REFUSED | 409 | Crossing refused | This business does not take chits from that installation. | The two installations must name each other as peers first. | ctp | 2026-10-23 |
| CTP_CROSSING_UNCHECKABLE | 503 | Crossing cannot be checked | We could not check whether this chit may cross, so we refused it. | Try again later; nothing was written. | ctp | 2026-10-23 |
| CTP_ENVELOPE_REFUSED | 409 | Envelope refused | The chit did not open here: its signature or its contents were refused. | Check the sending installation signs with the key it publishes. | ctp | 2026-10-23 |
| CTP_MANIFEST_UNAVAILABLE | 500 | Manifest unavailable | This installation could not say who it is just now. | Try again later. | ctp | 2026-10-23 |
| CTP_NO_INSTALLATION | 400 | No installation named | The message does not say which installation sent it. | Send it from an installation that names itself. | ctp | 2026-10-23 |
| CTP_NO_RECIPIENT | 400 | No recipient named | The chit does not say which business it is for. | Name the recipient by its bridge id. | ctp | 2026-10-23 |
| CTP_NO_SENDER | 400 | No sender named | The chit does not say which business sent it. | The sending installation must name its sender. | ctp | 2026-10-23 |
| CTP_NOT_A_QUERY | 400 | Not a CTP query | This is not a question this door understands. | Send a CTP/1 query. | ctp | 2026-10-23 |
| CTP_NOT_AN_ENVELOPE | 400 | Not a CTP envelope | This is not a chit this door understands. | Send a CTP/1 envelope. | ctp | 2026-10-23 |
| CTP_PEER_HOSTED_HERE | 409 | Installation is hosted here | That installation lives on this server, so its chits must not come over the internet. | Deliver it locally. | ctp | 2026-10-23 |
| CTP_PEER_KEY_UNREADABLE | 403 | Peer's key cannot be read | We could not read the other installation's public key, so we cannot trust the message. | Check the other installation's manifest is reachable. | ctp | 2026-10-23 |
| CTP_PEER_REFUSED | 403 | Installation not known | We do not deal with that installation. | The owners of both installations must agree to connect first. | ctp | 2026-10-23 |
| CTP_QUERY_FAILED | 500 | Question failed | This installation could not answer just now. | Try again later. | ctp | 2026-10-23 |
| CTP_QUERY_REFUSED | 403 | Question refused | The question was not signed by the installation that sent it. | Check the asking installation signs with the key it publishes. | ctp | 2026-10-23 |
| CTP_RECIPIENT_NOT_HERE | 404 | Recipient not here | There is no active business here with that bridge id. | Check the address of the business. | ctp | 2026-10-23 |
| CTP_STORE_FAILED | 500 | Could not store the chit | This installation could not store the chit just now. | Try again later; it was not written. | ctp | 2026-10-23 |
| CTP_UNKNOWN_QUESTION | 400 | Unknown question | This installation does not answer that question. | Ask to resolve a business or for its catalogue. | ctp | 2026-10-23 |
| CURRENCY_ENTITY_ONLY | 403 | Currency is the business’s | The currency your prices are written in belongs to the business. | Ask whoever runs the account to change it in Settings. | entities | 2026-10-22 |
| CURRENCY_MALFORMED | varies | Not a currency code | That is not a currency code. | Use the three-letter code, like SGD. | govresolve | 2026-10-22 |
| CURRENCY_NOT_ALLOWED | varies | Currency not available | That currency is not available for this business. | Choose one of the currencies listed. | govresolve | 2026-10-22 |
| CURRENCY_NOT_THE_LEDGERS | 422 | Wrong money for this ledger | This payment is in a different money from the ledger's. | Use the ledger's own money. | books | 2026-10-23 |
| CYCLE | 409 | Would loop | A network cannot sit under one of its own members. | Choose a different network to join. | network | 2026-10-23 |
| DEVICE_MISMATCH | 401 | Device mismatch | PENDING | - | auth | 2026-10-22 |
| DEVICE_REVOKED | 401/403 | Device revoked | PENDING | - | person-session | 2026-10-22 |
| DEVICE_TO_REFUSED | 403 | Device may not send there | A device can send only to its own shop and the shop’s own customers or suppliers. | Send to one of those, or leave the recipient out. | connectors | 2026-10-22 |
| DISPUTES_NOT_SET_UP | 200 | Disputes not set up yet | Disputes are not switched on on this server yet, so there are none to show. | Nothing to do; they will appear once the update has run. | chits | 2026-10-23 |
| DISPUTE_TARGET_NOT_PARTY | 400 | Not a party to the dispute | That business is not a party to this dispute. | Pick one of the parties listed on the dispute. | chits | 2026-10-23 |
| DSP | varies | Dsp | PENDING | - | folder-inventory | 2026-10-22 |
| DUPLICATE_PARTY | 409 | Duplicate party | PENDING | - | relationships | 2026-10-22 |
| EDGE_NOT_FOUND | 404 | Connection not found | We could not find that connection. | Refresh the list; it may have been removed. | network | 2026-10-23 |
| EMAIL_DELIVERY_NOT_CONFIGURED | 503 | Email delivery not configured | This shop cannot e-mail a first code yet, so nothing was changed. | Set up e-mail sending first. | employee-code | 2026-10-22 |
| EMAIL_TAKEN | 409 | Email taken | That e-mail already signs in to another account. | Use the person's own e-mail, or leave it empty. | actors | 2026-10-22 |
| EMPLOYEE_EMAIL_REQUIRED | 400 | Employee email required | This person needs an e-mail address for the first code. | Add their e-mail, then try again. | employee-code | 2026-10-22 |
| ENTITY_BAD_REQUEST | 400 | Request not usable | What was sent is missing something or cannot be used. | Read the sentence shown, fix it and try again. | entities | 2026-10-23 |
| ENTITY_CLASH | 409 | Clashes with what is recorded | That clashes with what is already recorded. | Read the sentence shown, then pick another. | entities | 2026-10-23 |
| ENTITY_EMAIL_TAKEN | 409 | Email already used | A shop with that email already exists. | Use another email. | governance | 2026-10-23 |
| ENTITY_NOT_MIGRATED | varies | Update still to run | This part is not ready on this server yet. | Try again after the next update. | entities | 2026-10-23 |
| ENTITY_QUOTA | 409 | Shop limit reached | This installation cannot add another shop on its plan. | Choose a plan with room for more shops. | governance | 2026-10-23 |
| ENTITY_SEALED | 403 | Protected business | This business is protected and cannot be erased. | Nothing to do: protected businesses stay. | entities | 2026-10-23 |
| ERR | 500 | Something went wrong | Something went wrong on our side. Try again in a moment. | If it keeps happening, tell us the request id. | network | 2026-10-23 |
| EXISTS | 409 | Already asked or connected | You have already asked, or are already connected. | Open the connection to see where it stands. | network | 2026-10-23 |
| FOLDER_BAD_REQUEST | 400 | Folder request not accepted | That folder request could not be done. | Read the message, fix what it names and try again. | folders | 2026-10-23 |
| FOLDER_INVALID | 400 | Folder details not valid | The folder name or id is missing or not valid. | Give the folder a name of 1 to 60 characters, then try again. | folders | 2026-10-23 |
| FOLDER_IS_VIEW | 400 | Not a place for chits | That folder shows what its rule matches, so nothing can be moved into it. | Move the chit to a filing folder instead. | folders | 2026-10-22 |
| FOLDER_NOT_MIGRATED | 503 | Folders update still to run | This part of folders is not ready on this server yet. | Try again after the next update. | folders | 2026-10-23 |
| FOLDER_WRONG_SIDE | 400 | Folder on the other track | A Task folder holds chits that came to you; an Order folder holds chits you sent. | Pick a folder on the chit's own track. | folders | 2026-10-22 |
| FX_RATE_MISSING | 422 | Exchange rate missing | There is no exchange rate for that day. | Add the rate for that day, then try again. | forms | 2026-10-22 |
| FX_RATE_OF_DAY | varies | Fx rate of day | PENDING | - | forms | 2026-10-22 |
| GOV_BAD_REQUEST | 400 | Needs one more answer | Something needed is missing. | Read the question shown and answer it. | governance | 2026-10-23 |
| GOV_CONFLICT | 409 | Clashes with what is recorded | That clashes with what is already recorded. | Reload the page and try again. | governance | 2026-10-23 |
| GOV_NOT_AVAILABLE | 503 | Not available yet | That is not available on this installation yet. | Try again after the next update. | governance | 2026-10-23 |
| GOV_REFUSED | 422 | Could not be done as sent | That could not be done as it was sent. | Check what was sent and try again. | governance | 2026-10-23 |
| HANDOFF_STORE_MISSING | 503 | ERP handoffs not ready | ERP handoffs are not ready on this server yet. | Try again after the next update. | assist | 2026-10-22 |
| HAS_PARENT | 409 | Already in a network | That business is already in a network, and a business can be in one at a time. | Remove it from that network first. | network | 2026-10-23 |
| IDEMPOTENCY_CONFLICT | 422 | Idempotency conflict | This was already sent once, with different details. | Start it again; the new try goes as its own. | idempotency | 2026-10-22 |
| IDEMPOTENCY_IN_PROGRESS | 409 | Idempotency in progress | The same request is still being handled. | Wait a moment and look before sending it again. | idempotency | 2026-10-22 |
| IDOC_CONSENT_REQUIRED | 400 | Idoc consent required | PENDING | - | identity-docs | 2026-10-22 |
| IDOC_EMPLOYER_ONLY | 403 | Idoc employer only | PENDING | - | identity-docs | 2026-10-22 |
| IDOC_NOT_CODE_VERIFIED | varies | Idoc not code verified | PENDING | - | iddoc-verify | 2026-10-22 |
| IDOC_NOT_FOUND | 404 | Idoc not found | PENDING | - | identity-docs | 2026-10-22 |
| IDOC_NOT_MIGRATED | 503 | Idoc not migrated | PENDING | - | identity-docs | 2026-10-22 |
| IDOC_NO_CODE | 400 | Idoc no code | PENDING | - | iddoc-verify | 2026-10-22 |
| IDOC_VALUE_UNAVAILABLE | varies | Idoc value unavailable | PENDING | - | iddoc-verify | 2026-10-22 |
| INR | varies | Inr | PENDING | - | locale.browser | 2026-10-22 |
| INTEGRATION_BAD_REQUEST | 400 | Request not usable | Something this needs is missing or not valid. | Check the order or the fields named, then send it again. | integrations | 2026-10-23 |
| INTERNAL | 500 | Something went wrong | Something went wrong on our side. Try again in a moment. | If it keeps happening, tell us the request id. | api | 2026-10-22 |
| INVALID_ACTION | 400 | Action not understood | That is not something this can do. | Send pool, or push with a colleague. | actors | 2026-10-23 |
| INVALID_ASSIGNEE | 400 | Default person not allowed | The default person must be able to take tasks. | Pick a person with Act or Manager access. | actors | 2026-10-23 |
| INVALID_DELEGATE | 400 | Cover not allowed | That person cannot cover. | Pick someone else who can take tasks. | actors | 2026-10-23 |
| INVALID_INPUT | 422 | Input not valid | Some of what was sent is missing or not valid. | Fix the fields listed and send it again. | validate | 2026-10-22 |
| INVALID_KEY_REQUEST | 400 | Key request not valid | That key cannot be made as asked. | Pick a listed kind, and revoke a key if you have twenty. | keys | 2026-10-22 |
| INVOICE_BAD_REQUEST | 400 | Invoice needs lines | The invoice needs at least one line. | Send the lines to invoice. | invoice | 2026-10-23 |
| IN_FLIGHT | 409 | Open chit on the connection | A chit is still open on this connection. | Settle it first, or disconnect and settle together. | network | 2026-10-23 |
| IN_USE | 409 | In use | PENDING | - | schemas | 2026-10-22 |
| ITEM_NOT_FOUND | 422 | Item not on the shelf | A line names an item this shop does not sell. | Check the item id or code. | tax | 2026-10-23 |
| KEY_CANNOT_DECIDE | 403 | A key cannot decide this | A connector cannot decide this on its own. Sign in as a person. | Sign in to the shop and do it there. | integrations | 2026-10-23 |
| KEY_CANNOT_MANAGE_KEYS | 403 | A key cannot manage keys | A key cannot make or remove keys. Sign in as a person. | Sign in to the shop and do it there. | keys | 2026-10-22 |
| KEY_CANNOT_SEE_HOME | 403 | A key cannot see Home | Sign in to see the Home figures. | Open the app with your login, not a key. | facts | 2026-10-23 |
| KEY_CANNOT_SIGN_IN | 403 | Key cannot sign in | PENDING | - | signin | 2026-10-22 |
| KEY_NOT_FOUND | 404 | Key not found | There is no key with that id in this shop. | Refresh the list of keys. | keys | 2026-10-22 |
| KEY_UNKNOWN | 401 | Key not recognised | This key is not recognised, or its connector is inactive. | Check the key, or issue a new one from the connector. | connectors | 2026-10-22 |
| LAB_CHIT_LIVE_SHOP | 409 | Lab chit on a live shop | A practice chit cannot be sent from a live shop. | Send it from a practice shop, or make a real chit. | chits | 2026-10-23 |
| LEADS_NOT_MIGRATED | 503 | Leads not migrated | Lead stages are not set up here yet. | Try again after the next update. | crm | 2026-10-22 |
| LEDGER_OFF | 404 | Ledger switched off | This shop has not switched the ledger on. | The owner can switch it on. | books | 2026-10-23 |
| LOCKED | 409 | Locked | PENDING | - | schemas | 2026-10-22 |
| MAX_TASKS_OVER_ENTITY | 400 | Max tasks over entity | That is more tasks than the shop allows one person. | Raise the limit in Settings first, or give fewer. | actors | 2026-10-22 |
| MIGRATION | 409 | Migration | PENDING | - | schemas | 2026-10-22 |
| MINT_FAILED | 500 | Could not make an id | We could not make an id for this business just now. | Try again in a moment. | network | 2026-10-23 |
| MISSING_FIELD | 422 | Field missing | A needed field was left out. | Fill in the field named and send it again. | validate | 2026-10-22 |
| MKT_NOT_MIGRATED | varies | Mkt not migrated | PENDING | - | channels | 2026-10-22 |
| MSG_ABOVE_CEILING | 409 | Messaging level too high | That folder can be kept internal or switched off, but not shared further than its default. | Pick a lower level. | folders | 2026-10-22 |
| MSG_FIXED | 409 | Messaging level fixed | This folder's messaging level cannot be changed. | Leave it as it is. | folders | 2026-10-22 |
| NAME_REQUIRED | 400 | Name needed | A business needs a name. | Send a name. | network | 2026-10-23 |
| NAME_THE_PERSON | 400 | Name the person | Say who is away. | Pick the person. | actors | 2026-10-22 |
| NETWORK_BAD_REQUEST | 400 | Network request not usable | What was sent to the network is missing something or cannot be used. | Read the sentence, fix it and try again. | network | 2026-10-23 |
| NETWORK_NAME_TAKEN | 409 | Network name taken | One of these names was taken while the network was being built. Nothing was created. | Try again. | network | 2026-10-23 |
| NETWORK_ORDERS_OFF | 403 | Network orders off | Ordering across this network is not switched on here. | Order from the shop itself instead. | catalogue | 2026-10-22 |
| NETWORK_OWNER_ONLY | 403 | Owner only | Only the business owner can do this. | Sign in as the business itself. | network | 2026-10-23 |
| NETWORK_TOO_LARGE | 413 | Drawing too large | The drawing is too big to save. | Take some of it out and save again. | network | 2026-10-23 |
| NET_WRITE_DISABLED | 503 | Network editing is off | Network changes aren't available yet. | Try again later. | network | 2026-10-23 |
| NOTHING_TO_UPDATE | 400 | Nothing to update | Nothing was sent to change. | Fill in at least one field. | actors | 2026-10-23 |
| NOTIF_DISMISS_NOT_MIGRATED | 503 | Notif dismiss not migrated | PENDING | - | notifications | 2026-10-22 |
| NOT_ALLOWED | 403 | Not allowed | Only the two businesses on a connection, or the network above it, can do that. | Ask the other business or the network. | network | 2026-10-23 |
| NOT_BOARD_WRITER | 403 | Not board writer | Only the board’s own account can change the shared cases and records. | Ask the board’s owner, or record your result instead. | testing | 2026-10-22 |
| NOT_FOR_COUNTRY | varies | Not for your country | This is not offered for a shop in your country. | The message names what to use instead. | integrations | 2026-10-22 |
| NOT_FOUND | 404 | Not found | We could not find that. | Check the address or the name and try again. | api | 2026-10-22 |
| NOT_PAIRED | varies | Not paired | PENDING | - | verdict | 2026-10-22 |
| NOT_PLATFORM | 403 | Platform only | That kind of key is made by the platform, not by a shop. | Pick one of the kinds listed. | keys | 2026-10-22 |
| NOT_PLATFORM_ROOT | 403 | Platform operator only | This is for the platform operator only. | Ask the platform operator. | platformroot | 2026-10-22 |
| NOT_THIS_NETWORK | 403 | Not this network | You are signed in at a store outside this network. | Sign in at this network's store to order. | catalogue | 2026-10-22 |
| NOT_WRITTEN | varies | Not written | PENDING | - | signin-events | 2026-10-22 |
| NOT_YET | 409 | Not built yet | This connector is not built yet. | Use the File connector (CSV) or the Counter, and ask for it under Help. | integrations | 2026-10-22 |
| NOT_YET_FOR_COUNTRY | 409 | Not yet for your country | This connector is not ready for your country yet. | Use the File connector (CSV) or the Counter. | integrations | 2026-10-22 |
| NO_ACCOUNT | varies | No account | PENDING | - | signin | 2026-10-22 |
| NO_ACTOR | 401 | Not signed in as a business | Sign in as a business to use the network. | Sign in as the business itself. | network | 2026-10-23 |
| NO_BUYERS | varies | No buyers | PENDING | - | marketing-results | 2026-10-22 |
| NO_CONSENT | varies | No consent | They have not agreed to offers from you. | Ask for their consent first. | marketing-results | 2026-10-22 |
| NO_CONSTITUTION | 503 | No rules in force | This installation has no active rules to govern a shop yet. | Tell the platform team. | governance | 2026-10-23 |
| NO_COUNTRY | 422 | No country set | This shop has no country set. | Set the country in Country setup. | assist | 2026-10-22 |
| NO_COUNTRY_PACK | 422 | Country not supported yet | We do not have the rules for this shop's country yet. | Tell us the country. We add countries one at a time. | country-setup | 2026-10-22 |
| NO_DEVICE | 400 | No device | PENDING | - | person-session | 2026-10-22 |
| NO_KEY | 401 | No key sent | No key was sent. | Send the connector key in the X-Bridge-Key header. | connectors | 2026-10-22 |
| NO_LINES | 400 | No lines sent | Send at least one line. | Add a line and send again. | tax | 2026-10-23 |
| NO_MONEY | 422 | No money set | This shop has not said which money its books are kept in. | Set the money in Country setup. | catalogue-view | 2026-10-22 |
| NO_PHONE | varies | No phone | PENDING | - | crm-groups | 2026-10-22 |
| NO_PIN_SET | 400 | No PIN set | No PIN is set yet. | Set your PIN when you sign in. | actors | 2026-10-23 |
| NO_PLATFORM_ROOT | 404 | No platform operator | This installation has no platform operator set up. | Only the platform operator can use this. | platformroot | 2026-10-22 |
| NO_PRICE | 422 | No price for a line | A line has no price on the shelf and none was sent. | Set its price on the shelf, or send one. | tax | 2026-10-23 |
| NO_SENDS | varies | No sends | PENDING | - | marketing-results | 2026-10-22 |
| NO_SHOP_COPY | varies | No shop copy | PENDING | - | verdict | 2026-10-22 |
| NO_STREAM_NAMED | 400 | No stream named | Pick at least one stream to hand over. | Choose who carries products, stock or orders, then save. | integrations | 2026-10-23 |
| NO_SUCH_NETWORK | 400/404 | No such network | There is no network store by that name. | Check the link you were given. | catalogue | 2026-10-22 |
| NO_TEMPLATE | varies | No template | PENDING | - | marketing-results | 2026-10-22 |
| NO_TOKEN | varies | No token | PENDING | - | marketing-results | 2026-10-22 |
| OFFER_CLASH | 409 | Offer clash | PENDING | - | offer-clash | 2026-10-22 |
| OFFLINE | varies | Offline | PENDING | - | verdict | 2026-10-22 |
| OK | varies | Ok | PENDING | - | crm-groups | 2026-10-22 |
| ORIGIN_NOT_ALLOWED | 403 | Origin not allowed | This address is not allowed to call the service. | Use the shop app, or ask us to allow your address. | platform | 2026-10-22 |
| OTP_EXPIRED | 400/429 | Otp expired | That code has expired. | Ask for a new code. | iddoc-verify | 2026-10-22 |
| OTP_LOCKED | 400/429 | Otp locked | Too many wrong codes were typed. | Ask for a new code. | iddoc-verify | 2026-10-22 |
| OVER_LIMIT | 409 | Over the credit limit | This sale would take the customer past their credit limit. | Ask the owner to allow it, or take a payment first. | chits | 2026-10-23 |
| OWNER_ONLY | 403 | Owner only | Only the owner can do this. | Ask the owner of the shop to do it. | people | 2026-10-22 |
| PACK_NO_FILE | 409 | Pack has no file | This pack has no file to download. | Build it again, download it, then confirm. | books | 2026-10-22 |
| PAGE_UNKNOWN | 400 | Unknown chit page | That chit page is not one this server knows. | Use a page from the list, or none. | chits | 2026-10-23 |
| PAIR_CODE_UNKNOWN | 404 | Pairing code not known | That code is wrong or has expired. | Ask ChitBridge for a new code. | till | 2026-10-23 |
| PAIR_TOO_MANY_TRIES | 429 | Too many wrong codes | Too many wrong codes were tried. | Wait a minute, then ask for a new code. | till | 2026-10-23 |
| PARENT_NOT_FOUND | 404 | Network not found | We could not find that network. | Check its handle and try again. | network | 2026-10-23 |
| PENETRATION_STORE_MISSING | 503 | Reach figures not ready | Reach figures are not ready on this server yet. | Try again after the next update. | assist | 2026-10-22 |
| PERIOD_LOCKED | 409 | Month locked | That month is locked. | Use a date in an open month, or ask the owner to unlock it. | books | 2026-10-22 |
| PHONE_DELIVERY_NOT_CONFIGURED | varies | Phone delivery not configured | PENDING | - | iddoc-verify | 2026-10-22 |
| PIN | varies | Pin | PENDING | - | country | 2026-10-22 |
| PIN_ACTORS_ONLY | 400 | Only a person can change a PIN | Only a person with their own login can change a PIN. | Sign in as that person. | actors | 2026-10-23 |
| PIN_INCORRECT | 400 | Current PIN is wrong | The current PIN is not right. | Try again with your current PIN. | actors | 2026-10-23 |
| PLATFORM_BOUND | varies | Set by the platform | The platform sets this for every shop. | It cannot be changed here. | entities | 2026-10-22 |
| POPULATION_BOUNDARY | 409 | Test and live cannot mix | A test business cannot trade with a real one. | Use a test counterparty. | rail | 2026-10-22 |
| PRODUCT_BAD_REQUEST | 400 | The catalogue needs something else | The catalogue could not take that request, and the sentence says why. | Read the sentence shown, fix it and try again. | products | 2026-10-23 |
| PRODUCT_CLASH | 409 | Clashes with the catalogue | That clashes with how this catalogue is set up. | Read the sentence shown, fix it and try again. | products | 2026-10-23 |
| PRODUCT_FILE_UNREADABLE | 400 | File could not be read | That file could not be read. | Save it again as a spreadsheet or a CSV and upload it again. | products | 2026-10-23 |
| PRODUCT_IMPORT_BLOCKED | 409 | The file has problems | The file has rows that must be fixed first, so nothing was imported. | Fix the rows listed and upload the file again. | products | 2026-10-23 |
| PRODUCT_INVALID | 400 | Product refused | The catalogue refused that product, and the sentence says why. | Fix what the sentence says and try again. | products | 2026-10-23 |
| PRODUCT_NOT_READY | 503 | Not set up on this system yet | This is not set up on this system yet. | Try again later. If it stays, tell us. | products | 2026-10-23 |
| PRODUCT_NO_DEFINITION | 500 | No catalogue definition | Your catalogue has no definition to add columns to. | Set up the catalogue first, then try again. | products | 2026-10-23 |
| PRODUCT_REFUSED | varies | Refused by a catalogue rule | A rule of the catalogue refused that, and the sentence says why. | Fix what the sentence says and try again. | products | 2026-10-23 |
| PRODUCT_TOO_LARGE | 413 | Too large for this door | What you sent is too big for this door. | Send less at a time: split the file, or use a smaller picture. | products | 2026-10-23 |
| QTY_OK | varies | Qty ok | PENDING | - | line-guard | 2026-10-22 |
| READ_ONLY | 403 | View only | Your access is view-only. | Ask the owner for edit access. | books | 2026-10-23 |
| REGION_STORE_MISSING | 503 | Regions not ready | Regional overrides are not ready on this server yet. | Try again after the next update. | assist | 2026-10-22 |
| REG_KIND_NOT_OFFERED | 400 | Registration kind not offered | That kind of tax registration is not offered in your country. | Pick one of the kinds listed. | policy | 2026-10-23 |
| REPEAT_BAD_REQUEST | 400 | Repeat needs an answer | Repeat supply needs one more answer before it can do that. | Read the question shown and answer it. | repeat-supply | 2026-10-23 |
| REPEAT_ENDED | 422 | Agreement ended | This agreement has ended. | Start a new agreement from a bill. | repeat-supply | 2026-10-23 |
| REPEAT_NOT_CUSTOMER | 422 | Customer only | Only the customer this agreement is with may do that. | Ask the customer to do it. | repeat-supply | 2026-10-23 |
| REPEAT_NOT_DUE | 422 | Run not due | The next run is not due yet. | Try again on or after the next run date. | repeat-supply | 2026-10-23 |
| REPEAT_NOT_MIGRATED | 503 | Repeat not migrated | Repeat supply arrives after the next update. | Try again after the next update. | repeat-supply | 2026-10-22 |
| REPEAT_NOT_SELLER | 422 | Seller only | Only the shop that made this agreement may do that. | Ask the shop that made it. | repeat-supply | 2026-10-23 |
| REPEAT_REASON_NEEDED | 422 | A reason is needed | Say why, so the other side can read it. | Write the reason and try again. | repeat-supply | 2026-10-23 |
| REPEAT_REFUSED | 422 | Repeat refused | Repeat supply refused that, and the sentence says why. | Fix what the sentence says and try again. | repeat-supply | 2026-10-23 |
| REPEAT_WRONG_STATE | 422 | Not at that step | This agreement is not at a step where that can be done. | Open the agreement to see what can be done now. | repeat-supply | 2026-10-23 |
| REQUEST_TIMEOUT | 503 | Request timeout | PENDING | - | limits | 2026-10-22 |
| REQUIRED | 409 | Required | PENDING | - | schemas | 2026-10-22 |
| RETURN_FROM_RAIL | 422 | Return comes from bills | Your return is made from your bills, not from these books. | Use the GST page. | books | 2026-10-23 |
| ROOT_HANDLE_NEEDED | varies | Network name needed | Set your User ID, or choose a network name, before building. | Set it in your profile, or send a network name. | network-build-run | 2026-10-22 |
| ROOT_HANDLE_TAKEN | varies | Network name taken | That network name is already taken. | Choose another network name. | network-build-run | 2026-10-22 |
| ROOT_HANDLE_UNUSABLE | varies | Network name unusable | Your User ID cannot be a network name. | Change your User ID in Settings first. | network-build-run | 2026-10-22 |
| SELF | 400 | Cannot connect to itself | A business cannot connect to itself. | Choose another business. | network | 2026-10-23 |
| SENDING | varies | Sending | PENDING | - | verdict | 2026-10-22 |
| SERVER_OWNED | 400 | Pictures come from Media | Pictures and video are added from the product's Media, not by editing the product. | Open the product's Media to add or remove them. | products | 2026-10-23 |
| SESSION_EXPIRED | 401 | Session expired | PENDING | - | person-session | 2026-10-22 |
| SESSION_NOT_LISTED | 503 | Session not listed | PENDING | - | identity-auth | 2026-10-22 |
| SESSION_UPGRADE | varies | Session upgrade | PENDING | - | auth | 2026-10-22 |
| SHOP_REFUSING | varies | Shop refusing | PENDING | - | verdict | 2026-10-22 |
| SIGNIN_REFUSED | 400 | Sign-in refused | That sign-in didn't work. Check the details and try again. | Check the details and try again. | signin | 2026-10-22 |
| SIGN_IN | 403 | Sign in | CRM opens only for a signed-in person, not for a key. | Sign in with your own login. | crm | 2026-10-22 |
| SIGN_IN_FIRST | 401/409 | Sign in first | Sign in at the store to order. | Sign in with your phone or email, then order again. | catalogue | 2026-10-22 |
| SIGN_IN_FOR_LEDGER | 403 | Sign in as a person | Sign in as a person to use the ledger. | A counter or device key cannot use the ledger. | books | 2026-10-23 |
| SOURCE_STORE_MISSING | 503 | Source authoring not ready | Catalogue source authoring is not ready on this server yet. | Try again after the next update. | assist | 2026-10-22 |
| SRA_NOT_MIGRATED | 503 | Acceptance not switched on | Acceptance is not switched on yet. | Try again after the next update. | governance | 2026-10-22 |
| STATEMENT_TIMEOUT | 503 | Took too long | This took too long and was stopped. | Try again; if it keeps happening, tell us. | platform | 2026-10-22 |
| STORAGE_FULL | varies | Storage full | PENDING | - | verdict | 2026-10-22 |
| SUSPENSE_NOT_NIL | 409 | Suspense not nil | The suspense account must be nil before the year can close. | Clear the difference in the opening balances. | books | 2026-10-22 |
| SWITCHED_OFF | 400/404 | Switched off | This person is switched off. | Switch them on first. | actors | 2026-10-22 |
| TARGET_ACTOR_NOT_ACTIVE | 400 | Colleague cannot take tasks | That colleague cannot take tasks right now. | Pick someone who is active. | actors | 2026-10-23 |
| TARGET_ACTOR_REQUIRED | 400 | Colleague needed | Say which colleague gets the tasks. | Pick a colleague. | actors | 2026-10-23 |
| TASKS_TO_ROUTE | 400 | Tasks to route | This person still has open tasks. | Send them to the pool or to a colleague first. | actors | 2026-10-22 |
| TAX_FAILED | 500 | Tax could not be worked out | We could not work out the tax just now. | Try again in a moment. If it keeps happening, tell us the request id. | tax | 2026-10-22 |
| TAX_ID_BAD | varies | Tax number not accepted | That tax number is not accepted for your country. | Check the number and try again. | profile | 2026-10-22 |
| TERMS_NOT_MIGRATED | 503 | Terms update pending | Terms arrive after the next update. | Try again after the update. | books | 2026-10-22 |
| TESTING_BAD_REQUEST | 400 | The test board needs something else | The test board could not take that, and the sentence says why. | Read the sentence shown, fix it and try again. | testing | 2026-10-23 |
| TESTING_NOT_DEPLOYED | 500 | Test data missing on this server | The test cases or records are not on this server yet. | Tell us: the server needs to be deployed again. | testing | 2026-10-23 |
| TESTING_NOT_SIGNED_IN | 401 | Not signed in to the test board | Sign in to use the test board. | Sign in, then try again. | testing | 2026-10-23 |
| TESTING_NOT_STORED | 500 | Screenshot not stored | The screenshot could not be kept. | Try again. If it keeps happening, tell us. | testing | 2026-10-23 |
| TESTING_REFUSED | 422 | The test board did not record that | The test board understood that but cannot record it as it is, and the sentence says why. | Read the sentence shown, fix it and try again. | testing | 2026-10-23 |
| TILL_BAD_REQUEST | 400 | Counter request not valid | The counter sent something that is missing or not right. | Check what was entered and try again. | till | 2026-10-23 |
| TILL_CLAIM_MISMATCH | 400 | Bill from another phone | This bill was made on another phone. | Send it from the phone that made it. | holder | 2026-10-23 |
| TILL_NO_COUNTER | 403 | Key holds no counter | This key is not holding a counter. | Open the counter on this PC first. | till | 2026-10-23 |
| TILL_REFUSED | varies | Counter request refused | ChitBridge could not do that. | Read the sentence beside it, then try again. | till | 2026-10-23 |
| TILL_SCREEN_ONLY | 403 | Shop screens only | Only a shop screen can be changed from the counter. | Pick one of the paired screens. | till | 2026-10-23 |
| TILL_SEND_REFUSED | 403 | Counter bill not sent | That counter bill could not be sent as it is. | The counter keeps it; send the rest. | chits | 2026-10-23 |
| TILL_SERIES_COLLISION | 409 | Bill number already used | Another counter already used that bill number. | The bill stays on this counter, unsent; it is given its own number next time. | chits | 2026-10-23 |
| TILL_SIGN_IN_FIRST | 403 | Sign in first | Sign in as the shop to do this. | Sign in, then try again. | till | 2026-10-23 |
| TOKEN_INVALID | 401 | Token invalid | PENDING | - | auth | 2026-10-22 |
| UNCLAIMED | 409 | Not claimed yet | That business has not claimed its place yet, so it cannot say yes. | Ask it to claim its place first. | network | 2026-10-23 |
| USER_ID_ENTITY_ONLY | 403 | User ID is the business’s | A User ID belongs to the business, not to a person. | You sign in as key@business; that cannot be changed here. | entities | 2026-10-22 |
| USER_ID_IMMUTABLE | 409 | User ID cannot change | A User ID cannot be changed once it is set. | Change the business name instead; the User ID stays. | entities | 2026-10-22 |
| USER_ID_INVALID | 400 | User ID not usable | Choose a User ID that can be used. | Read the sentence shown and try another. | entities | 2026-10-22 |
| USER_ID_TAKEN | 409 | User ID taken | That User ID is already taken. | Choose another; it cannot be changed later. | entities | 2026-10-22 |
| VAULT_CHANGED | 409 | Vault changed | Changed since you opened it — reload? | Reload the vault, then save again. | governance | 2026-10-23 |
| VAULT_ENC_UNCONFIGURED | 503 | Vault enc unconfigured | PENDING | - | identity-docs | 2026-10-22 |
| VAULT_VERSION_REQUIRED | 409 | Vault version required | This screen is older than the vault — reload it, then save. | Reload the screen, then save. | governance | 2026-10-22 |
| VERIFICATION_FAILED | 422 | Registry check failed | That registry number could not be confirmed. | Check the number and try again. | governance | 2026-10-23 |
| VIEW_ONLY | varies | View only | Your login can only view. | Ask the owner for edit access. | crm-groups | 2026-10-22 |
| VISIBILITY_CAPPED | 403 | Catalogue visibility closed | The catalogue cannot be that open for this business. | The sentence names who closed it; ask them. | entities | 2026-10-23 |
| VISIBILITY_NOT_MIGRATED | 409 | Visibility not migrated | This database does not accept network visibility yet. | Apply the pending database update, then build again. | entities | 2026-10-22 |
| WORKBOOK_CUT | 413 | Workbook cut | This sheet is bigger than we read, so only part of it was read and nothing was imported. | Delete unused columns, or split the sheet, and upload again. | products | 2026-10-22 |
| WORK_BAD_REQUEST | 400 | Work request not valid | That list request is not valid. | Ask for one view at a time. | work | 2026-10-23 |
| WORK_STAFF_ONLY | 403 | Staff only | Sign in as staff to see Tasks and Orders. | Sign in with a staff login. | work | 2026-10-23 |
| WRITER_THREW | varies | Writer threw | PENDING | - | signin-events | 2026-10-22 |
| WRONG_SCOPE | varies | Wrong scope | PENDING | - | verdict | 2026-10-22 |
| WRONG_VALUE | 422 | Field not valid | A field has a value of the wrong kind. | Use the kind of value the field asks for. | validate | 2026-10-22 |
| YEAR_CLOSED | 409 | Year closed | That financial year is closed. | Use a date in the open year. | books | 2026-10-22 |
| YEAR_CLOSE_REFUSED | 422 | Year cannot close yet | The year cannot be closed yet. | Read the reasons shown and fix each one. | books | 2026-10-23 |
| CODE_NOT_ASKED | 400 | No code asked for | Ask for a code first — none was sent to that phone or email at this shop. | Tap "Send code", then type the code you get. | catalogue | 2026-10-23 |
| CONTACT_INVALID | 422 | Phone or email not usable | Enter one phone number or one email — not both, and in a form we can send to. | Check the number or the address and try again. | catalogue | 2026-10-23 |
| IDEMPOTENCY_KEY_REQUIRED | 422 | Idempotency key required | The order came without its one-time mark, so nothing was sent. | Reload the shop page and try again. | idempotency | 2026-10-23 |
| NETWORK_READ_FAILED | 503 | Network not read | We could not read who is in the network just now. Nothing was changed. | Try again in a minute. | network-membership | 2026-10-23 |
| NO_MATCHING_PRODUCTS | 404 | No matching products | None of those products is sold in this network. | Go back to the store and choose again. | catalogue | 2026-10-23 |
| NO_OPERATOR | 409 | Network has no operator | This network has nobody to take the order just now. | Tell the store; try again later. | catalogue | 2026-10-23 |
| ORDER_EMPTY | 400 | Order is empty | The order has nothing in it. | Add something to the cart and send it again. | catalogue | 2026-10-23 |
| ORDER_REJECTED | 409/422 | Order not accepted | The shop could not take this order as it is — the reason says which item. | Change that item and send the order again. | catalogue | 2026-10-23 |
| OTP_WRONG | 400 | Wrong code | That code is not right. | Check the code and type it again; the message says how many tries are left. | otp | 2026-10-23 |
| SHOP_CLOSED | 403 | Shop closed | This shop is closed and is not taking orders just now. | Try again when the shop opens. | catalogue | 2026-10-23 |
| SUBMISSION_REJECTED | 422/503 | Form not accepted | The form could not be sent as it is — the reason says what to fix. | Fix what it names and send it again; if it says try again, wait a minute. | catalogue | 2026-10-23 |
| SUPPORT_NOT_TAKEN | 502 | Report not delivered | Your report did not reach the shop. | Contact the shop another way for now. | catalogue | 2026-10-23 |
| CHIT_BAD_REQUEST | 400 | Chit request not accepted | That chit request could not be done. | Read the message, fix what it names and try again. | chits | 2026-10-23 |
| CHIT_CANNOT_WITHDRAW | 409 | Cannot withdraw | This chit cannot be withdrawn from where it is. | Raise a dispute on it if something is wrong. | chits | 2026-10-23 |
| CHIT_CONFLICT | 409 | Chit not in that state | The chit is not in a state that allows that. | Look at the chit again, then try once more. | chits | 2026-10-23 |
| CHIT_INVALID | 400 | Chit details not valid | Something on the chit is missing or not valid. | Read the list of fields it names, fix them and try again. | chits | 2026-10-23 |
| CHIT_NOT_A_BILL | 409 | Not a bill | Only a bill you received says what its goods are for. | Open a bill you received. | chits | 2026-10-23 |
| CHIT_NOT_MIGRATED | 503 | Chits update still to run | This part of chits is not ready on this server yet. | Try again after the next update. | chits | 2026-10-23 |
| CHIT_NOT_PERMITTED | 403 | Not allowed on this chit | This login is not allowed to do that on this chit. | Ask the owner for the right access, or open the chit from the side that holds it. | chits | 2026-10-23 |
| CHIT_NO_BRIDGE_ID | 409 | Shop has no ChitBridge address | This shop has no ChitBridge address yet, so this cannot be recorded. | Open Settings, set the shop address, then send the bill again. | chits | 2026-10-23 |
| CHIT_PRIORITY_LOCKED | 409 | Customer priority already set | The customer priority on this chit is set once and cannot change. | Leave it as it is. | chits | 2026-10-23 |
| CHIT_REASON_REQUIRED | 400 | A reason is needed | An urgent priority needs a reason. | Write the reason and try again. | chits | 2026-10-23 |
| CHIT_TOO_MANY | 400 | Too many at once | That is more than can be done in one go. | Send fewer, then repeat for the rest. | chits | 2026-10-23 |
| CHIT_UNPROCESSABLE | 422 | Chit refused | That was understood but cannot be done as it stands. | Read the sentence shown and fix what it names. | chits | 2026-10-23 |
| CHIT_VALUE_NOT_ACCEPTED | 409 | Value not accepted | The database does not accept one of those values yet. | Try again after the next update. | chits | 2026-10-23 |
| DISPUTES_TABLE_MISSING | 500 | Disputes not set up | Disputes are not set up on this server yet. | Tell us; the update has to be run. | chits | 2026-10-23 |
| DISPUTE_ALREADY_RESOLVED | 400 | Dispute already resolved | That dispute is already resolved. | Nothing more to do. | chits | 2026-10-23 |
| DISPUTE_EXISTS | 400 | Dispute already open | You already have an open dispute of that kind on this chit. | Open the existing dispute instead. | chits | 2026-10-23 |
| LINE_BELOW_DELIVERED | 409 | Below what was delivered | That would take the line below what has been delivered. | Record a negative delivery first. | chits | 2026-10-23 |
| LINE_DELIVERED | 409 | Line already delivered | That line has been delivered, so it cannot be changed this way. | Record a negative delivery to take it back. | chits | 2026-10-23 |
| LINE_UNIT_LOCKED | 409 | Unit locked | The unit cannot change once something has been delivered. | Leave the unit as it is. | chits | 2026-10-23 |
| PAYMENT_ABOVE_QUOTE | 422 | Above the quoted amount | The amount received is above what the bill asked for. | Add a note saying why, or record the quoted amount. | chits | 2026-10-23 |
| PAYMENT_TENDER_ON_BILL | 422 | The tender is on the bill | This bill carries its own payment, so it cannot be marked paid here. | Record money received later at the counter, against the bill. | chits | 2026-10-23 |
| co_held_record | 409 | A record both parties hold | This chit is a record both parties hold, so it cannot be deleted. | Archive it instead. | chits | 2026-10-23 |
| code_already_used | 409 | Code already used | That code was already used. | Use the order that was made the first time. | chits | 2026-10-23 |
| dispute_open | 409 | A dispute is open | A dispute is open on this chit. | Resolve it first. | chits | 2026-10-23 |
| disputes_unknown | 503 | Could not check disputes | Could not check for open disputes. | Try again in a moment. | chits | 2026-10-23 |
| reason_required | 400 | A reason is needed to reject | Say why you are rejecting this bill. | Write the reason and try again. | chits | 2026-10-23 |
| status_conflict | 409 | Status changed under you | Someone else just changed this chit. | Look at it again, then try once more. | chits | 2026-10-23 |
| ANSWERED | 409 | Already answered | Not found, or already answered: an answer is given once. | Refresh the list. | crm | 2026-10-23 |
| BAD_AFTER | 400 | Bad day word | Pick one of the days offered. | Choose a day from the list. | crm | 2026-10-23 |
| BAD_ASSIGNEE | 400 | Not on your team | That person is not on your team. | Pick someone from your team. | crm | 2026-10-23 |
| BAD_BEFORE | 400 | Bad time | Give the time as a date. | Pick a date and try again. | crm | 2026-10-23 |
| BAD_CHANNEL | 400 | Bad channel | Channel is phone, sms, whatsapp, email or chitbridge. | Pick one of those. | crm | 2026-10-23 |
| BAD_DUE | 400 | Bad due day | Pick a day from today. | Choose today or a later day. | crm | 2026-10-23 |
| BAD_GROUP | 400 | Not a stage | That is not one of the stages. | Pick a stage from the list. | crm | 2026-10-23 |
| BAD_ID | 400 | Not a valid id | That is not a valid id. | Open it again from the list. | crm | 2026-10-23 |
| BAD_KEY | 400 | Not a segment | That is not a segment or a group. | Pick one from the list. | crm | 2026-10-23 |
| BAD_KIND | 400 | Unknown grouping | That grouping is not known. | Use the buttons on the screen. | crm | 2026-10-23 |
| BAD_NAME | 400 | Bad name | Give a name. A group name is up to 40 letters, digits, spaces, - & /. | Check the name and try again. | crm | 2026-10-23 |
| BAD_OUTCOME | 400 | Bad outcome | Pick what happened on the call. | Tap one of the outcome buttons. | crm | 2026-10-23 |
| BAD_PURPOSE | 400 | Bad purpose | Purpose is service or marketing. | Pick one of those. | crm | 2026-10-23 |
| CHANNEL_NOT_SENDABLE | 400 | Channel not sendable | Only WhatsApp can be sent from here today. | Use WhatsApp. | crm | 2026-10-23 |
| CONSENT_WITHDRAWN | 403 | Consent withdrawn | They took back their consent. | Do not message them on this channel. | crm | 2026-10-23 |
| CRM_BAD_REQUEST | 400 | Bad request | What was sent is not in the form CRM expects. | Send the fields as one JSON object, each once. | crm | 2026-10-23 |
| GROUPS_NOT_MIGRATED | 409 | Groups not set up | Named groups are not set up here yet. | Try again after the next update. | crm | 2026-10-23 |
| HAS_DUES | 409 | Open dues | There are open dues on this party. | Settle the dues first, then remove them. | crm | 2026-10-23 |
| IS_CUSTOMER | 409 | Already a customer | They are a customer now, so there is no lead stage to move. | Nothing to do. | crm | 2026-10-23 |
| MINT_REFUSED | varies | Could not add | They could not be added. | Check the name and phone and try again. | crm | 2026-10-23 |
| NEED_DAY | 400 | Day needed | Say when to follow up. | Pick a day. | crm | 2026-10-23 |
| NOTHING_TO_DO | 400 | Nothing to do | Say who to add or remove. | Pick at least one customer. | crm | 2026-10-23 |
| NOT_ASSIGNEE | 403 | Not the assignee | Only the owner or the assignee can hand this on. | Ask the owner or the person it is assigned to. | crm | 2026-10-23 |
| NO_ROWS | 400 | No rows | There are no rows to import. | Choose a file with at least one lead. | crm | 2026-10-23 |
| NO_TEXT | 400 | No message | Write the message. | Type the message and send again. | crm | 2026-10-23 |
| OPTED_OUT | 403 | Opted out | They asked not to be messaged on this channel. | Use another way, or leave them. | crm | 2026-10-23 |
| PRIVACY_NOT_MIGRATED | 503 | Privacy not set up | Consent and privacy requests are not set up here yet. | Try again after the next update. | crm | 2026-10-23 |
| PURPOSE_FIXED | 400 | Offers only | A message to a group is an offer, so it needs their consent for offers. | Send only to people who agreed to offers. | crm | 2026-10-23 |
| REFUSED | varies | Refused | That could not be done as asked. | Read the line shown, change what you sent and try again. | crm | 2026-10-23 |
| SAID_NO | 403 | Said no | They said no to this. | Leave them be, unless they say yes later. | crm | 2026-10-23 |
| TOO_LONG | 400 | Message too long | The message is too long. | Shorten it and send again. | crm | 2026-10-23 |
| TOO_MANY | 400 | Too many | That is too many at a time. | Send fewer, or make a smaller group. | crm | 2026-10-23 |
| TOO_MANY_GROUPS | 400 | Too many groups | A customer can be in at most 20 groups. | Take them out of one group first. | crm | 2026-10-23 |
<!-- codes:end -->
