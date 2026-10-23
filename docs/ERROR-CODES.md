# Error codes (API-STANDARD S14, owner cb-api)

One row per code the API can answer. The table is the master; `docs/error-codes.json` is generated from it (`node tools/error-codes.cjs --write`).
`node tools/error-codes.cjs --check` fails on a duplicate code, an empty cell, a drifted json, or a `code: 'X'` in the code that is not a row.

- `shopkeeper` is the plain sentence a person sees: what happened and what to do, inside the copy budget, no jargon. `PENDING` means the owning area has not written it yet; the ratchet counts PENDING rows down and never up.
- `status` is read from the code that raises it (`varies` when none sits beside the literal). `owner_area` is the file that raises it until the owning area is named. `hint` is `-` until written.
- A code is never reused for another meaning and never deleted: deprecate it. Reuse before add: `node C:/dev/seams.cjs <word>`, then this table.

<!-- codes:start -->
| code | status | title | shopkeeper | hint | owner_area | since |
|---|---|---|---|---|---|---|
| ADVICE_EXISTS | 409 | Advice already recorded | An advice is already recorded for this payment. | Open the payment to see it. | books | 2026-10-22 |
| ALL_REFUSED | varies | All refused | PENDING | - | marketing-results | 2026-10-22 |
| ALL_SENT | varies | All sent | PENDING | - | verdict | 2026-10-22 |
| ALREADY_PAID | 409 | Already paid | This looks like a payment you already recorded. | Check the list, then confirm if it is really a new one. | books | 2026-10-22 |
| ALREADY_RECORDED | 409 | Already recorded | That is already recorded. | Refresh the list: it is already there. | books | 2026-10-23 |
| ALREADY_REVERSED | 409 | Already reversed | This entry was already reversed. | Open the reversal to see it. | books | 2026-10-22 |
| AMBIGUOUS_NAME | 409 | Ambiguous name | PENDING | - | signin | 2026-10-22 |
| ANSWERED | 409 | Request already answered | That request is not there, or it was already answered. | Refresh the list: an answer is given once. | crm | 2026-10-23 |
| ASSIST_GATED | varies | Assist gated | PENDING | - | assist | 2026-10-22 |
| ASSIST_SIGN_IN | 503 | Assist sign in | PENDING | - | assist | 2026-10-22 |
| AUTO_TOKEN | varies | Auto token | PENDING | - | auth | 2026-10-22 |
| BAD_AFTER | 400 | Day not understood | That day is not one the follow-up knows. | Pick today, tomorrow, in 3 days or next week. | crm | 2026-10-23 |
| BAD_ASSIGNEE | 400 | Person not on the team | That person is not on your team. | Pick someone from your team. | crm | 2026-10-23 |
| BAD_BEFORE | 400 | Time not understood | The time to look before is not a time. | Send a date and time, or leave it out. | crm | 2026-10-23 |
| BAD_CHANNEL | 400 | Channel not known | The channel must be phone, sms, whatsapp, email or chitbridge. | Pick one of those channels. | crm | 2026-10-23 |
| BAD_DUE | 400 | Day not a date | The day for the follow-up is not a date. | Pick a day on the calendar. | crm | 2026-10-23 |
| BAD_FLAG | 400 | Flag not true or false | priceIncludesTax must be true or false. | Send true or false. | tax | 2026-10-23 |
| BAD_GROUP | 400 | Stage not known | That is not one of the stages. | Pick a stage from the list. | crm | 2026-10-23 |
| BAD_ID | 400 | Id not valid | That is not a valid id. | Open the record from the list and try again. | crm | 2026-10-23 |
| BAD_KEY | 400 | Segment not known | That is not a segment or a group. | Pick a segment or group from the list. | crm | 2026-10-23 |
| BAD_KIND | 400 | Kind not known | The kind must be call, visit, message or note. | Pick one of those kinds. | crm | 2026-10-23 |
| BAD_NAME | 400 | Name needed | Give it a name. | Type a name and save again. | crm | 2026-10-23 |
| BAD_OUTCOME | 400 | Call outcome needed | Pick what happened on the call. | Tap one of the outcome buttons. | crm | 2026-10-23 |
| BAD_PERIOD | 400 | Bad period | PENDING | - | till-summary | 2026-10-22 |
| BAD_PHONE | 400 | Bad phone | PENDING | - | counters | 2026-10-22 |
| BAD_PRICE | 400 | Price below zero | A line has a price below 0. | Send a price of 0 or more. | tax | 2026-10-23 |
| BAD_PURPOSE | 400 | Purpose not known | The purpose must be service or marketing. | Pick service or marketing. | crm | 2026-10-23 |
| BAD_QTY | 400 | Quantity not above zero | A line needs a quantity above 0. | Send a quantity above 0 on every line. | tax | 2026-10-23 |
| BAD_RATE | 400 | Tax rate out of range | A line has a tax rate outside 0 to 100 percent. | Send a rate from 0 to 100. | tax | 2026-10-23 |
| BILL_NOT_RECORDED | varies | Bill not recorded | PENDING | - | till | 2026-10-22 |
| BODY_TOO_LARGE | 413 | Too large | What you sent is too big to accept. | Send less at a time. | api | 2026-10-22 |
| BOOKS_BAD_REQUEST | 400 | Ledger needs an answer | The ledger needs one more answer before it can do that. | Read the question shown and answer it. | books | 2026-10-22 |
| BOOKS_CONFLICT | 409 | Ledger cannot take that | The ledger cannot take that as it stands. | Read the sentence shown, fix it and try again. | books | 2026-10-23 |
| BOOKS_ENGINE | 503 | Ledger calculations unavailable | The ledger calculations are not available yet. | Try again later. If it stays, tell us. | books | 2026-10-23 |
| BOOKS_NOT_MIGRATED | 503 | Ledger update pending | This cannot be saved yet: a database update is still to arrive. | Try again after the next update. | books | 2026-10-22 |
| BOOKS_REFUSED | 422 | Ledger refused | The ledger refused that, and the sentence says why. | Fix what the sentence says and try again. | books | 2026-10-23 |
| CAPABILITY_OFF | varies | Capability off | PENDING | - | connectors | 2026-10-22 |
| CATALOGUE_STORE_MISSING | 503 | Catalogue store missing | PENDING | - | assist | 2026-10-22 |
| CHANNEL_NOT_SENDABLE | 400 | Channel cannot send | We cannot send on that channel yet. | Pick a channel that can send. | crm | 2026-10-23 |
| CHIT_NOT_DELIVERED | 503 | Chit not delivered | PENDING | - | connectors | 2026-10-22 |
| CHOOSE_IDENTITY | 409 | Choose identity | PENDING | - | signin | 2026-10-22 |
| CLAIM_RECORDED | 409 | Claim recorded | PENDING | - | reward-store | 2026-10-22 |
| COMBO_INVALID | 400 | Combo needs groups | A combo needs at least one group, each with a name and options. | Add a group with an option and save again. | combo-templates | 2026-10-23 |
| COMBO_NAME_INVALID | 400 | Combo needs a name | A saved combo needs a name of up to 120 characters. | Type a name you will look for later. | combo-templates | 2026-10-23 |
| COMBO_PRICE_INVALID | 400 | Combo price not valid | The price must be a number and cannot be negative. | Type a price of 0 or more, or leave it empty. | combo-templates | 2026-10-23 |
| COMBO_PRICE_REQUIRED | 400 | Combo price needed | Give this combo a price before pushing it as a new product. | Set the price, then push again. | combo-templates | 2026-10-23 |
| COMBO_REFUSED | 400 | Combo refused | This combo cannot be saved as it stands. | Read the sentence shown and fix it. | combo-templates | 2026-10-23 |
| COMMENT_ONLY | 403 | Comment only | Your access is comment-only. | Ask the owner for edit access. | books | 2026-10-23 |
| COMPARE_NOT_ALLOWED | 403 | Compare not allowed | Only the owner or the shop's auditor may compare the books. | Ask the owner. | books | 2026-10-23 |
| CONFIRM_REMOVE | 400 | Confirm remove | PENDING | - | actors | 2026-10-22 |
| CONNECTOR_HAS_NO_KEY | 400 | Connector has no key | This connector was set up without a key, so there is nothing to approve. | Download the kit again while signed in as the owner. | integrations | 2026-10-23 |
| CONSENT_UNREADABLE | varies | Consent unreadable | PENDING | - | whatsapp-out | 2026-10-22 |
| CONTAINER_STORE_MISSING | 403/503 | Container store missing | PENDING | - | assist | 2026-10-22 |
| COST_BLIND | 403 | Cost and price hidden from you | Your access does not include cost or price, so you cannot change them. | Ask the owner to grant "Sees costs". | cost | 2026-10-22 |
| COUNTER_CLOSED | 401 | Counter closed | PENDING | - | auth | 2026-10-22 |
| COUNTER_HELD | varies | Counter held | PENDING | - | counters | 2026-10-22 |
| COUNTRY_SETUP_PENDING | 422 | Country setup pending | Finish the country setup before using the ledger. | Open Country setup and complete it. | country-setup | 2026-10-22 |
| COVER_CONFLICT | varies | Cover conflict | PENDING | - | actors | 2026-10-22 |
| CRM_NOT_MIGRATED | 503 | Customer list update pending | This part of the customer list is not ready yet. | Try again after the next update. | crm | 2026-10-22 |
| CURRENCY_ENTITY_ONLY | 403 | Currency entity only | PENDING | - | entities | 2026-10-22 |
| CURRENCY_MALFORMED | varies | Currency malformed | PENDING | - | govresolve | 2026-10-22 |
| CURRENCY_NOT_ALLOWED | varies | Currency not allowed | PENDING | - | govresolve | 2026-10-22 |
| CURRENCY_NOT_THE_LEDGERS | 422 | Wrong money for this ledger | This payment is in a different money from the ledger's. | Use the ledger's own money. | books | 2026-10-23 |
| DEVICE_MISMATCH | 401 | Device mismatch | PENDING | - | auth | 2026-10-22 |
| DEVICE_REVOKED | 401/403 | Device revoked | PENDING | - | person-session | 2026-10-22 |
| DEVICE_TO_REFUSED | varies | Device to refused | PENDING | - | connectors | 2026-10-22 |
| DISPUTES_NOT_SET_UP | varies | Disputes not set up | PENDING | - | chits | 2026-10-22 |
| DISPUTE_TARGET_NOT_PARTY | 400 | Dispute target not party | PENDING | - | chits | 2026-10-22 |
| DSP | varies | Dsp | PENDING | - | folder-inventory | 2026-10-22 |
| DUPLICATE_PARTY | 409 | Duplicate party | PENDING | - | relationships | 2026-10-22 |
| EMAIL_DELIVERY_NOT_CONFIGURED | varies | Email delivery not configured | PENDING | - | employee-code | 2026-10-22 |
| EMAIL_TAKEN | varies | Email taken | PENDING | - | actors | 2026-10-22 |
| EMPLOYEE_EMAIL_REQUIRED | varies | Employee email required | PENDING | - | employee-code | 2026-10-22 |
| EXISTS | 409 | Already on your list | They are already on your list. | Open the existing entry instead. | crm | 2026-10-23 |
| FOLDER_IS_VIEW | 400 | Folder is view | PENDING | - | folders | 2026-10-22 |
| FOLDER_WRONG_SIDE | varies | Folder wrong side | PENDING | - | folders | 2026-10-22 |
| FX_RATE_MISSING | 422 | Exchange rate missing | There is no exchange rate for that day. | Add the rate for that day, then try again. | forms | 2026-10-22 |
| FX_RATE_OF_DAY | varies | Fx rate of day | PENDING | - | forms | 2026-10-22 |
| GROUPS_NOT_MIGRATED | 503 | Groups update pending | Groups are not ready yet. | Try again after the next update. | crm | 2026-10-23 |
| HANDOFF_STORE_MISSING | 503 | Handoff store missing | PENDING | - | assist | 2026-10-22 |
| HAS_DUES | 409 | Open dues | There are open dues on this party, so it cannot be removed. | Settle the dues first. | crm | 2026-10-23 |
| IDEMPOTENCY_CONFLICT | 422 | Idempotency conflict | PENDING | - | idempotency | 2026-10-22 |
| IDEMPOTENCY_IN_PROGRESS | 409 | Idempotency in progress | PENDING | - | idempotency | 2026-10-22 |
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
| INVALID_INPUT | 422 | Input not valid | Some of what was sent is missing or not valid. | Fix the fields listed and send it again. | validate | 2026-10-22 |
| INVALID_KEY_REQUEST | 400 | Key request not valid | That key cannot be made as asked. | Pick a listed kind, and revoke a key if you have twenty. | keys | 2026-10-22 |
| INVOICE_BAD_REQUEST | 400 | Invoice needs lines | The invoice needs at least one line. | Send the lines to invoice. | invoice | 2026-10-23 |
| IN_USE | 409 | In use | PENDING | - | schemas | 2026-10-22 |
| IS_CUSTOMER | 409 | Already a customer | They are a customer now, so they have no lead stage. | Leave their stage as it is. | crm | 2026-10-23 |
| ITEM_NOT_FOUND | 422 | Item not on the shelf | A line names an item this shop does not sell. | Check the item id or code. | tax | 2026-10-23 |
| KEY_CANNOT_DECIDE | 403 | A key cannot decide this | A connector cannot decide this on its own. Sign in as a person. | Sign in to the shop and do it there. | integrations | 2026-10-23 |
| KEY_CANNOT_MANAGE_KEYS | 403 | A key cannot manage keys | A key cannot make or remove keys. Sign in as a person. | Sign in to the shop and do it there. | keys | 2026-10-22 |
| KEY_CANNOT_SIGN_IN | 403 | Key cannot sign in | PENDING | - | signin | 2026-10-22 |
| KEY_NOT_FOUND | 404 | Key not found | There is no key with that id in this shop. | Refresh the list of keys. | keys | 2026-10-22 |
| KEY_UNKNOWN | 401 | Key unknown | PENDING | - | connectors | 2026-10-22 |
| LAB_CHIT_LIVE_SHOP | 409 | Lab chit live shop | PENDING | - | chits | 2026-10-22 |
| LEADS_NOT_MIGRATED | 503 | Leads update pending | Leads are not ready yet. | Try again after the next update. | crm | 2026-10-22 |
| LEDGER_OFF | 404 | Ledger switched off | This shop has not switched the ledger on. | The owner can switch it on. | books | 2026-10-23 |
| LINES_REQUIRED | 400 | Lines needed | Send at least one line with a quantity and a unit price. | Add the lines to evaluate and send again. | offers | 2026-10-23 |
| LOCKED | 409 | Locked | PENDING | - | schemas | 2026-10-22 |
| MAX_TASKS_OVER_ENTITY | varies | Max tasks over entity | PENDING | - | actors | 2026-10-22 |
| MIGRATION | 409 | Migration | PENDING | - | schemas | 2026-10-22 |
| MINT_REFUSED | varies | Could not add them | They could not be added to your list. | Read the sentence shown and fix it. | crm | 2026-10-23 |
| MISSING_FIELD | 422 | Field missing | A needed field was left out. | Fill in the field named and send it again. | validate | 2026-10-22 |
| MKT_NOT_MIGRATED | varies | Who came back update pending | Who came back arrives after the next update. | Try again after the next update. | channels | 2026-10-22 |
| MSG_ABOVE_CEILING | 409 | Msg above ceiling | PENDING | - | folders | 2026-10-22 |
| MSG_FIXED | 409 | Msg fixed | PENDING | - | folders | 2026-10-22 |
| NAME_THE_PERSON | 400 | Name the person | PENDING | - | actors | 2026-10-22 |
| NEED_DAY | 400 | Day needed | This outcome needs a day for the next call. | Pick a day. | crm | 2026-10-23 |
| NETWORK_NOTHING_TO_CHANGE | 409 | Stores already up to date | Your stores already have every change. | Nothing to publish. | network-offers | 2026-10-23 |
| NETWORK_NOTHING_WAITING | 409 | Nothing waiting | Nothing is waiting to be published. | Publish a change first. | network-offers | 2026-10-23 |
| NETWORK_NOT_ADOPTED | 409 | Catalogue not sold here | This store does not sell that catalogue. | Join the network catalogue first. | network-offers | 2026-10-23 |
| NETWORK_ORDERS_OFF | 403 | Network orders off | PENDING | - | catalogue | 2026-10-22 |
| NETWORK_PRICE_MISSING | 409 | No brand price | The brand has no price for that product. | Ask the brand to suggest a price. | network-offers | 2026-10-23 |
| NETWORK_READ_FAILED | 503 | Network could not be read | We could not read who is in the network just now. Nothing was changed. | Try again in a minute. | network-offers | 2026-10-23 |
| NETWORK_REFUSED | 409 | Network step refused | The network cannot take that step as it stands. | Read the sentence shown and fix it. | network-offers | 2026-10-23 |
| NETWORK_REQUEST_INVALID | 400 | Network request not valid | That request is not valid: the sentence says what to change. | Fix what the sentence says and send again. | network-offers | 2026-10-23 |
| NOTHING_TO_DO | 400 | Nothing to change | Say who to add or remove. | Pick at least one customer. | crm | 2026-10-23 |
| NOTIF_DISMISS_NOT_MIGRATED | 503 | Notif dismiss not migrated | PENDING | - | notifications | 2026-10-22 |
| NOT_ASSIGNEE | 403 | Only owner or assignee | Only the owner or the person it is given to can hand this on. | Ask the owner. | crm | 2026-10-23 |
| NOT_BOARD_WRITER | 403 | Not board writer | PENDING | - | testing | 2026-10-22 |
| NOT_FOR_COUNTRY | varies | Not for your country | This is not offered for a shop in your country. | The message names what to use instead. | integrations | 2026-10-22 |
| NOT_FOUND | 404 | Not found | We could not find that. | Check the address or the name and try again. | api | 2026-10-22 |
| NOT_PAIRED | varies | Not paired | PENDING | - | verdict | 2026-10-22 |
| NOT_PLATFORM | 403 | Platform only | That kind of key is made by the platform, not by a shop. | Pick one of the kinds listed. | keys | 2026-10-22 |
| NOT_PLATFORM_ROOT | 403 | Not platform root | PENDING | - | platformroot | 2026-10-22 |
| NOT_THIS_NETWORK | 403 | Not this network | PENDING | - | catalogue | 2026-10-22 |
| NOT_WRITTEN | varies | Not written | PENDING | - | signin-events | 2026-10-22 |
| NOT_YET | 409 | Not built yet | This connector is not built yet. | Use the File connector (CSV) or the Counter, and ask for it under Help. | integrations | 2026-10-22 |
| NOT_YET_FOR_COUNTRY | 409 | Not yet for your country | This connector is not ready for your country yet. | Use the File connector (CSV) or the Counter. | integrations | 2026-10-22 |
| NO_ACCOUNT | varies | No account | PENDING | - | signin | 2026-10-22 |
| NO_BUYERS | varies | No buyers | PENDING | - | marketing-results | 2026-10-22 |
| NO_CONSENT | 403 | No consent yet | They have not agreed to offers on that channel. | Ask them first. | marketing-results | 2026-10-22 |
| NO_COUNTRY | 422 | No country set | This shop has no country set. | Set the country in Country setup. | assist | 2026-10-22 |
| NO_COUNTRY_PACK | 422 | Country not supported yet | We do not have the rules for this shop's country yet. | Tell us the country. We add countries one at a time. | country-setup | 2026-10-22 |
| NO_DEVICE | 400 | No device | PENDING | - | person-session | 2026-10-22 |
| NO_KEY | 401 | No key | PENDING | - | connectors | 2026-10-22 |
| NO_LINES | 400 | No lines sent | Send at least one line. | Add a line and send again. | tax | 2026-10-23 |
| NO_MONEY | 422 | No money set | This shop has not said which money its books are kept in. | Set the money in Country setup. | catalogue-view | 2026-10-22 |
| NO_PHONE | varies | No phone | PENDING | - | crm-groups | 2026-10-22 |
| NO_PLATFORM_ROOT | 404 | No platform root | PENDING | - | platformroot | 2026-10-22 |
| NO_PRICE | 422 | No price for a line | A line has no price on the shelf and none was sent. | Set its price on the shelf, or send one. | tax | 2026-10-23 |
| NO_ROWS | 400 | Nothing to import | There is nothing to import. | Choose a file with at least one row. | crm | 2026-10-23 |
| NO_SENDS | varies | No sends | PENDING | - | marketing-results | 2026-10-22 |
| NO_SHOP_COPY | varies | No shop copy | PENDING | - | verdict | 2026-10-22 |
| NO_STREAM_NAMED | 400 | No stream named | Pick at least one stream to hand over. | Choose who carries products, stock or orders, then save. | integrations | 2026-10-23 |
| NO_SUCH_NETWORK | 400/404 | No such network | PENDING | - | catalogue | 2026-10-22 |
| NO_TEMPLATE | varies | No template | PENDING | - | marketing-results | 2026-10-22 |
| NO_TEXT | 400 | Message needed | Write the message. | Type the message and send again. | crm | 2026-10-23 |
| NO_TOKEN | varies | No token | PENDING | - | marketing-results | 2026-10-22 |
| OFFER_CLASH | 409 | Offer clash | PENDING | - | offer-clash | 2026-10-22 |
| OFFER_ENDS_BEFORE_START | 400 | Offer ends before it starts | The offer would end before it starts. | Pick an end after the start. | network-offers | 2026-10-23 |
| OFFER_NOT_LIVE | 409 | Offer not live | Make the offer live before releasing it to your stores. | Make it live, then release. | network-offers | 2026-10-23 |
| OFFER_NOT_RELEASED | 409 | Offer never released | That offer was never released to your stores. | Release it first. | network-offers | 2026-10-23 |
| OFFER_UNKNOWN | 400 | Offer not known | That is not an offer. | Pick an offer from the list. | network-offers | 2026-10-23 |
| OFFLINE | varies | Offline | PENDING | - | verdict | 2026-10-22 |
| OK | varies | Ok | PENDING | - | crm-groups | 2026-10-22 |
| OPTED_OUT | 403 | They opted out | They asked not to be messaged on that channel. | Do not message them there. | crm | 2026-10-23 |
| ORIGIN_NOT_ALLOWED | 403 | Origin not allowed | This address is not allowed to call the service. | Use the shop app, or ask us to allow your address. | platform | 2026-10-22 |
| OTP_EXPIRED | 400/429 | Otp expired | PENDING | - | iddoc-verify | 2026-10-22 |
| OTP_LOCKED | 400/429 | Otp locked | PENDING | - | iddoc-verify | 2026-10-22 |
| OVER_LIMIT | 409 | Over limit | PENDING | - | chits | 2026-10-22 |
| OWNER_ONLY | 403 | Owner only | Only the owner can do this. | Ask the owner of the shop to do it. | people | 2026-10-22 |
| PACK_NO_FILE | 409 | Pack has no file | This pack has no file to download. | Build it again, download it, then confirm. | books | 2026-10-22 |
| PAGE_UNKNOWN | varies | Page unknown | PENDING | - | mint | 2026-10-22 |
| PENETRATION_STORE_MISSING | 503 | Penetration store missing | PENDING | - | assist | 2026-10-22 |
| PERIOD_LOCKED | 409 | Month locked | That month is locked. | Use a date in an open month, or ask the owner to unlock it. | books | 2026-10-22 |
| PHONE_DELIVERY_NOT_CONFIGURED | varies | Phone delivery not configured | PENDING | - | iddoc-verify | 2026-10-22 |
| PIN | varies | Pin | PENDING | - | country | 2026-10-22 |
| PLATFORM_BOUND | varies | Platform bound | PENDING | - | entities | 2026-10-22 |
| POLICY_NOT_VALID | 400 | Policy not known | The policy must be opt_in or opt_out. | Pick one of the two. | network-offers | 2026-10-23 |
| POPULATION_BOUNDARY | 409 | Test and live cannot mix | A test business cannot trade with a real one. | Use a test counterparty. | rail | 2026-10-22 |
| PRIVACY_NOT_MIGRATED | 503 | Privacy update pending | Privacy requests are not ready yet. | Try again after the next update. | crm | 2026-10-23 |
| PRODUCT_INVALID | 400 | Product not valid | The product made from this combo is not valid. | Read the sentence shown and fix the combo. | combo-templates | 2026-10-23 |
| PURPOSE_FIXED | 400 | Purpose fixed | The purpose of this send cannot be changed. | Send it for the purpose shown. | crm | 2026-10-23 |
| QTY_OK | varies | Qty ok | PENDING | - | line-guard | 2026-10-22 |
| READ_ONLY | 403 | View only | Your access is view-only. | Ask the owner for edit access. | books | 2026-10-23 |
| REFUSED | varies | Refused | That cannot be done as it stands. | Read the sentence shown. | crm | 2026-10-23 |
| REGION_STORE_MISSING | 403/404/503 | Region store missing | PENDING | - | assist | 2026-10-22 |
| REPEAT_NOT_MIGRATED | varies | Repeat not migrated | PENDING | - | repeat-supply | 2026-10-22 |
| REQUEST_TIMEOUT | 503 | Request timeout | PENDING | - | limits | 2026-10-22 |
| REQUIRED | 409 | Required | PENDING | - | schemas | 2026-10-22 |
| RETURN_FROM_RAIL | 422 | Return comes from bills | Your return is made from your bills, not from these books. | Use the GST page. | books | 2026-10-23 |
| ROOT_HANDLE_NEEDED | varies | Root handle needed | PENDING | - | network-build-run | 2026-10-22 |
| ROOT_HANDLE_TAKEN | varies | Root handle taken | PENDING | - | network-build-run | 2026-10-22 |
| ROOT_HANDLE_UNUSABLE | varies | Root handle unusable | PENDING | - | network-build-run | 2026-10-22 |
| SAID_NO | 403 | They said no | They said no to offers on that channel. | Do not send offers there. | crm | 2026-10-23 |
| SENDING | varies | Sending | PENDING | - | verdict | 2026-10-22 |
| SESSION_EXPIRED | 401 | Session expired | PENDING | - | person-session | 2026-10-22 |
| SESSION_NOT_LISTED | 503 | Session not listed | PENDING | - | identity-auth | 2026-10-22 |
| SESSION_ONLY | 403 | Sign in as a person | Network offers are managed by a signed-in person. | Sign in as a person, not with a key. | network-offers | 2026-10-23 |
| SESSION_UPGRADE | varies | Session upgrade | PENDING | - | auth | 2026-10-22 |
| SHOP_REFUSING | varies | Shop refusing | PENDING | - | verdict | 2026-10-22 |
| SIGNIN_REFUSED | 400 | Sign-in refused | That sign-in didn't work. Check the details and try again. | Check the details and try again. | signin | 2026-10-22 |
| SIGN_IN | 403 | Sign in as a person | Sign in as a person to use this: a counter key cannot. | Sign in and try again. | crm | 2026-10-22 |
| SIGN_IN_FIRST | 401/409 | Sign in first | PENDING | - | catalogue | 2026-10-22 |
| SIGN_IN_FOR_LEDGER | 403 | Sign in as a person | Sign in as a person to use the ledger. | A counter or device key cannot use the ledger. | books | 2026-10-23 |
| SOURCE_STORE_MISSING | 503 | Source store missing | PENDING | - | assist | 2026-10-22 |
| SRA_NOT_MIGRATED | 503 | Sra not migrated | PENDING | - | governance | 2026-10-22 |
| STATEMENT_TIMEOUT | 503 | Took too long | This took too long and was stopped. | Try again; if it keeps happening, tell us. | platform | 2026-10-22 |
| STORAGE_FULL | varies | Storage full | PENDING | - | verdict | 2026-10-22 |
| SUSPENSE_NOT_NIL | 409 | Suspense not nil | The suspense account must be nil before the year can close. | Clear the difference in the opening balances. | books | 2026-10-22 |
| SWITCHED_OFF | 400/404 | Switched off | PENDING | - | actors | 2026-10-22 |
| TASKS_TO_ROUTE | 400 | Tasks to route | PENDING | - | actors | 2026-10-22 |
| TAX_FAILED | 500 | Tax could not be worked out | We could not work out the tax just now. | Try again in a moment. If it keeps happening, tell us the request id. | tax | 2026-10-22 |
| TAX_ID_BAD | varies | Tax id bad | PENDING | - | profile | 2026-10-22 |
| TERMS_NOT_MIGRATED | 503 | Terms update pending | Terms arrive after the next update. | Try again after the update. | books | 2026-10-22 |
| TILL_CLAIM_MISMATCH | varies | Till claim mismatch | PENDING | - | holder | 2026-10-22 |
| TILL_SEND_REFUSED | 403 | Till send refused | PENDING | - | chits | 2026-10-22 |
| TILL_SERIES_COLLISION | varies | Till series collision | PENDING | - | chits | 2026-10-22 |
| TOKEN_INVALID | 401 | Token invalid | PENDING | - | auth | 2026-10-22 |
| TOO_LONG | 400 | Message too long | The message is too long. | Shorten the message. | crm | 2026-10-23 |
| TOO_MANY | 400 | Too many rows | There are too many rows in one go. | Send up to 500 rows at a time. | crm | 2026-10-23 |
| TOO_MANY_GROUPS | 400 | Too many groups | A customer can be in only a few groups. | Take them out of one first. | crm | 2026-10-23 |
| USER_ID_ENTITY_ONLY | 403 | User id entity only | PENDING | - | entities | 2026-10-22 |
| USER_ID_IMMUTABLE | 409 | User id immutable | PENDING | - | entities | 2026-10-22 |
| USER_ID_INVALID | 400 | User id invalid | PENDING | - | entities | 2026-10-22 |
| USER_ID_TAKEN | 409 | User id taken | PENDING | - | entities | 2026-10-22 |
| VALIDATION_FAILED | 400 | Fields not valid | Some of what was sent is missing or not valid. | Fix the fields listed and send again. | validate | 2026-10-23 |
| VAULT_ENC_UNCONFIGURED | 503 | Vault enc unconfigured | PENDING | - | identity-docs | 2026-10-22 |
| VAULT_VERSION_REQUIRED | varies | Vault version required | PENDING | - | governance | 2026-10-22 |
| VIEW_ONLY | 403 | View only | Your login can only view. | Ask the owner for edit access. | crm-groups | 2026-10-22 |
| VISIBILITY_NOT_MIGRATED | 409 | Visibility not migrated | PENDING | - | entities | 2026-10-22 |
| WITHDRAWN | 403 | They withdrew consent | They withdrew their consent to offers on that channel. | Do not send offers there. | crm | 2026-10-23 |
| WORKBOOK_CUT | varies | Workbook cut | PENDING | - | products | 2026-10-22 |
| WRITER_THREW | varies | Writer threw | PENDING | - | signin-events | 2026-10-22 |
| WRONG_SCOPE | varies | Wrong scope | PENDING | - | verdict | 2026-10-22 |
| WRONG_VALUE | 422 | Field not valid | A field has a value of the wrong kind. | Use the kind of value the field asks for. | validate | 2026-10-22 |
| YEAR_CLOSED | 409 | Year closed | That financial year is closed. | Use a date in the open year. | books | 2026-10-22 |
| YEAR_CLOSE_REFUSED | 422 | Year cannot close yet | The year cannot be closed yet. | Read the reasons shown and fix each one. | books | 2026-10-23 |
<!-- codes:end -->
