# Error codes (API-STANDARD S14, owner cb-api)

One row per code the API can answer. The table is the master; `docs/error-codes.json` is generated from it (`node tools/error-codes.cjs --write`).
`node tools/error-codes.cjs --check` fails on a duplicate code, an empty cell, a drifted json, or a `code: 'X'` in the code that is not a row.

- `shopkeeper` is the plain sentence a person sees: what happened and what to do, inside the copy budget, no jargon. `PENDING` means the owning area has not written it yet; the ratchet counts PENDING rows down and never up.
- `status` is read from the code that raises it (`varies` when none sits beside the literal). `owner_area` is the file that raises it until the owning area is named. `hint` is `-` until written.
- A code is never reused for another meaning and never deleted: deprecate it. Reuse before add: `node C:/dev/seams.cjs <word>`, then this table.

<!-- codes:start -->
| code | status | title | shopkeeper | hint | owner_area | since |
|---|---|---|---|---|---|---|
| ADVICE_EXISTS | 404/409 | Advice exists | PENDING | - | books | 2026-10-22 |
| ALL_REFUSED | varies | All refused | PENDING | - | marketing-results | 2026-10-22 |
| ALL_SENT | varies | All sent | PENDING | - | verdict | 2026-10-22 |
| ALREADY_PAID | 409 | Already paid | PENDING | - | books | 2026-10-22 |
| ALREADY_REVERSED | 409 | Already reversed | PENDING | - | books | 2026-10-22 |
| AMBIGUOUS_NAME | 409 | Ambiguous name | PENDING | - | signin | 2026-10-22 |
| ASSIST_GATED | varies | Assist gated | PENDING | - | assist | 2026-10-22 |
| ASSIST_SIGN_IN | 503 | Assist sign in | PENDING | - | assist | 2026-10-22 |
| AUTO_TOKEN | varies | Auto token | PENDING | - | auth | 2026-10-22 |
| BAD_PERIOD | 400 | Bad period | PENDING | - | till-summary | 2026-10-22 |
| BAD_PHONE | 400 | Bad phone | PENDING | - | counters | 2026-10-22 |
| BILL_NOT_RECORDED | varies | Bill not recorded | PENDING | - | till | 2026-10-22 |
| BODY_TOO_LARGE | 413 | Too large | What you sent is too big to accept. | Send less at a time. | api | 2026-10-22 |
| BOOKS_BAD_REQUEST | varies | Books bad request | PENDING | - | books | 2026-10-22 |
| BOOKS_NOT_MIGRATED | 404/503 | Books not migrated | PENDING | - | books | 2026-10-22 |
| CAPABILITY_OFF | varies | Capability off | PENDING | - | connectors | 2026-10-22 |
| CATALOGUE_STORE_MISSING | 503 | Catalogue store missing | PENDING | - | assist | 2026-10-22 |
| CHIT_NOT_DELIVERED | 503 | Chit not delivered | PENDING | - | connectors | 2026-10-22 |
| CHOOSE_IDENTITY | 409 | Choose identity | PENDING | - | signin | 2026-10-22 |
| CLAIM_RECORDED | 409 | Claim recorded | PENDING | - | reward-store | 2026-10-22 |
| CONFIRM_REMOVE | 400 | Confirm remove | PENDING | - | actors | 2026-10-22 |
| CONSENT_UNREADABLE | varies | Consent unreadable | PENDING | - | whatsapp-out | 2026-10-22 |
| CONTAINER_STORE_MISSING | 403/503 | Container store missing | PENDING | - | assist | 2026-10-22 |
| COST_BLIND | varies | Cost blind | PENDING | - | cost | 2026-10-22 |
| COUNTER_CLOSED | 401 | Counter closed | PENDING | - | auth | 2026-10-22 |
| COUNTER_HELD | varies | Counter held | PENDING | - | counters | 2026-10-22 |
| COUNTRY_SETUP_PENDING | varies | Country setup pending | PENDING | - | country-setup | 2026-10-22 |
| COVER_CONFLICT | varies | Cover conflict | PENDING | - | actors | 2026-10-22 |
| CRM_NOT_MIGRATED | 503 | Crm not migrated | PENDING | - | crm | 2026-10-22 |
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
| CURRENCY_ENTITY_ONLY | 403 | Currency entity only | PENDING | - | entities | 2026-10-22 |
| CURRENCY_MALFORMED | varies | Currency malformed | PENDING | - | govresolve | 2026-10-22 |
| CURRENCY_NOT_ALLOWED | varies | Currency not allowed | PENDING | - | govresolve | 2026-10-22 |
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
| FOLDER_IS_VIEW | 400 | Folder is view | PENDING | - | folders | 2026-10-22 |
| FOLDER_WRONG_SIDE | varies | Folder wrong side | PENDING | - | folders | 2026-10-22 |
| FX_RATE_MISSING | varies | Fx rate missing | PENDING | - | forms | 2026-10-22 |
| FX_RATE_OF_DAY | varies | Fx rate of day | PENDING | - | forms | 2026-10-22 |
| HANDOFF_STORE_MISSING | 503 | Handoff store missing | PENDING | - | assist | 2026-10-22 |
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
| INTERNAL | 500 | Something went wrong | Something went wrong on our side. Try again in a moment. | If it keeps happening, tell us the request id. | api | 2026-10-22 |
| INVALID_INPUT | 422 | Input not valid | Some of what was sent is missing or not valid. | Fix the fields listed and send it again. | validate | 2026-10-22 |
| INVALID_KEY_REQUEST | 400 | Key request not valid | That key cannot be made as asked. | Pick a listed kind, and revoke a key if you have twenty. | keys | 2026-10-22 |
| IN_USE | 409 | In use | PENDING | - | schemas | 2026-10-22 |
| KEY_CANNOT_MANAGE_KEYS | 403 | A key cannot manage keys | A key cannot make or remove keys. Sign in as a person. | Sign in to the shop and do it there. | keys | 2026-10-22 |
| KEY_CANNOT_SIGN_IN | 403 | Key cannot sign in | PENDING | - | signin | 2026-10-22 |
| KEY_NOT_FOUND | 404 | Key not found | There is no key with that id in this shop. | Refresh the list of keys. | keys | 2026-10-22 |
| KEY_UNKNOWN | 401 | Key unknown | PENDING | - | connectors | 2026-10-22 |
| LAB_CHIT_LIVE_SHOP | 409 | Lab chit live shop | PENDING | - | chits | 2026-10-22 |
| LEADS_NOT_MIGRATED | 503 | Leads not migrated | PENDING | - | crm | 2026-10-22 |
| LOCKED | 409 | Locked | PENDING | - | schemas | 2026-10-22 |
| MAX_TASKS_OVER_ENTITY | varies | Max tasks over entity | PENDING | - | actors | 2026-10-22 |
| MIGRATION | 409 | Migration | PENDING | - | schemas | 2026-10-22 |
| MISSING_FIELD | 422 | Field missing | A needed field was left out. | Fill in the field named and send it again. | validate | 2026-10-22 |
| MKT_NOT_MIGRATED | varies | Mkt not migrated | PENDING | - | channels | 2026-10-22 |
| MSG_ABOVE_CEILING | 409 | Msg above ceiling | PENDING | - | folders | 2026-10-22 |
| MSG_FIXED | 409 | Msg fixed | PENDING | - | folders | 2026-10-22 |
| NAME_THE_PERSON | 400 | Name the person | PENDING | - | actors | 2026-10-22 |
| NETWORK_ORDERS_OFF | 403 | Network orders off | PENDING | - | catalogue | 2026-10-22 |
| NOTIF_DISMISS_NOT_MIGRATED | 503 | Notif dismiss not migrated | PENDING | - | notifications | 2026-10-22 |
| NOT_BOARD_WRITER | 403 | Not board writer | PENDING | - | testing | 2026-10-22 |
| NOT_FOR_COUNTRY | varies | Not for country | PENDING | - | integrations | 2026-10-22 |
| NOT_FOUND | 404 | Not found | We could not find that. | Check the address or the name and try again. | api | 2026-10-22 |
| NOT_PAIRED | varies | Not paired | PENDING | - | verdict | 2026-10-22 |
| NOT_PLATFORM | 403 | Platform only | That kind of key is made by the platform, not by a shop. | Pick one of the kinds listed. | keys | 2026-10-22 |
| NOT_PLATFORM_ROOT | 403 | Not platform root | PENDING | - | platformroot | 2026-10-22 |
| NOT_THIS_NETWORK | 403 | Not this network | PENDING | - | catalogue | 2026-10-22 |
| NOT_WRITTEN | varies | Not written | PENDING | - | signin-events | 2026-10-22 |
| NOT_YET | varies | Not yet | PENDING | - | integrations | 2026-10-22 |
| NOT_YET_FOR_COUNTRY | varies | Not yet for country | PENDING | - | integrations | 2026-10-22 |
| NO_ACCOUNT | varies | No account | PENDING | - | signin | 2026-10-22 |
| SIGNIN_REFUSED | 400 | Sign-in refused | That sign-in didn't work. Check the details and try again. | Check the details and try again. | signin | 2026-10-22 |
| NO_BUYERS | varies | No buyers | PENDING | - | marketing-results | 2026-10-22 |
| NO_CONSENT | varies | No consent | PENDING | - | marketing-results | 2026-10-22 |
| NO_COUNTRY | 400/422 | No country | PENDING | - | assist | 2026-10-22 |
| NO_COUNTRY_PACK | varies | No country pack | PENDING | - | country-setup | 2026-10-22 |
| NO_DEVICE | 400 | No device | PENDING | - | person-session | 2026-10-22 |
| NO_KEY | 401 | No key | PENDING | - | connectors | 2026-10-22 |
| NO_MONEY | 422 | No money | PENDING | - | catalogue-view | 2026-10-22 |
| NO_PHONE | varies | No phone | PENDING | - | crm-groups | 2026-10-22 |
| NO_PLATFORM_ROOT | 404 | No platform root | PENDING | - | platformroot | 2026-10-22 |
| NO_SENDS | varies | No sends | PENDING | - | marketing-results | 2026-10-22 |
| NO_SHOP_COPY | varies | No shop copy | PENDING | - | verdict | 2026-10-22 |
| NO_SUCH_NETWORK | 400/404 | No such network | PENDING | - | catalogue | 2026-10-22 |
| NO_TEMPLATE | varies | No template | PENDING | - | marketing-results | 2026-10-22 |
| NO_TOKEN | varies | No token | PENDING | - | marketing-results | 2026-10-22 |
| OFFER_CLASH | 409 | Offer clash | PENDING | - | offer-clash | 2026-10-22 |
| OFFLINE | varies | Offline | PENDING | - | verdict | 2026-10-22 |
| OK | varies | Ok | PENDING | - | crm-groups | 2026-10-22 |
| ORIGIN_NOT_ALLOWED | 403 | Origin not allowed | This address is not allowed to call the service. | Use the shop app, or ask us to allow your address. | platform | 2026-10-22 |
| OTP_EXPIRED | 400/429 | Otp expired | PENDING | - | iddoc-verify | 2026-10-22 |
| OTP_LOCKED | 400/429 | Otp locked | PENDING | - | iddoc-verify | 2026-10-22 |
| OVER_LIMIT | 409 | Over limit | PENDING | - | chits | 2026-10-22 |
| OWNER_ONLY | 403 | Owner only | Only the owner can do this. | Ask the owner of the shop to do it. | people | 2026-10-22 |
| PACK_NO_FILE | 404/409 | Pack no file | PENDING | - | books | 2026-10-22 |
| PAGE_UNKNOWN | varies | Page unknown | PENDING | - | mint | 2026-10-22 |
| PENETRATION_STORE_MISSING | 503 | Penetration store missing | PENDING | - | assist | 2026-10-22 |
| PERIOD_LOCKED | 409 | Period locked | PENDING | - | books | 2026-10-22 |
| PHONE_DELIVERY_NOT_CONFIGURED | varies | Phone delivery not configured | PENDING | - | iddoc-verify | 2026-10-22 |
| PIN | varies | Pin | PENDING | - | country | 2026-10-22 |
| PLATFORM_BOUND | varies | Platform bound | PENDING | - | entities | 2026-10-22 |
| POPULATION_BOUNDARY | 409 | Test and live cannot mix | A test business cannot trade with a real one. | Use a test counterparty. | rail | 2026-10-22 |
| QTY_OK | varies | Qty ok | PENDING | - | line-guard | 2026-10-22 |
| REGION_STORE_MISSING | 403/404/503 | Region store missing | PENDING | - | assist | 2026-10-22 |
| REPEAT_NOT_MIGRATED | varies | Repeat not migrated | PENDING | - | repeat-supply | 2026-10-22 |
| REQUEST_TIMEOUT | 503 | Request timeout | PENDING | - | limits | 2026-10-22 |
| REQUIRED | 409 | Required | PENDING | - | schemas | 2026-10-22 |
| ROOT_HANDLE_NEEDED | varies | Root handle needed | PENDING | - | network-build-run | 2026-10-22 |
| ROOT_HANDLE_TAKEN | varies | Root handle taken | PENDING | - | network-build-run | 2026-10-22 |
| ROOT_HANDLE_UNUSABLE | varies | Root handle unusable | PENDING | - | network-build-run | 2026-10-22 |
| SENDING | varies | Sending | PENDING | - | verdict | 2026-10-22 |
| SESSION_EXPIRED | 401 | Session expired | PENDING | - | person-session | 2026-10-22 |
| SESSION_NOT_LISTED | 503 | Session not listed | PENDING | - | identity-auth | 2026-10-22 |
| SESSION_UPGRADE | varies | Session upgrade | PENDING | - | auth | 2026-10-22 |
| SHOP_REFUSING | varies | Shop refusing | PENDING | - | verdict | 2026-10-22 |
| SIGN_IN | 403 | Sign in | PENDING | - | crm | 2026-10-22 |
| SIGN_IN_FIRST | 401/409 | Sign in first | PENDING | - | catalogue | 2026-10-22 |
| SOURCE_STORE_MISSING | 503 | Source store missing | PENDING | - | assist | 2026-10-22 |
| SRA_NOT_MIGRATED | 503 | Sra not migrated | PENDING | - | governance | 2026-10-22 |
| STATEMENT_TIMEOUT | 503 | Took too long | This took too long and was stopped. | Try again; if it keeps happening, tell us. | platform | 2026-10-22 |
| STORAGE_FULL | varies | Storage full | PENDING | - | verdict | 2026-10-22 |
| SUSPENSE_NOT_NIL | 409 | Suspense not nil | PENDING | - | books | 2026-10-22 |
| SWITCHED_OFF | 400/404 | Switched off | PENDING | - | actors | 2026-10-22 |
| TASKS_TO_ROUTE | 400 | Tasks to route | PENDING | - | actors | 2026-10-22 |
| TAX_FAILED | 500 | Tax failed | PENDING | - | tax | 2026-10-22 |
| TAX_ID_BAD | varies | Tax id bad | PENDING | - | profile | 2026-10-22 |
| TERMS_NOT_MIGRATED | 503 | Terms not migrated | PENDING | - | books | 2026-10-22 |
| TILL_CLAIM_MISMATCH | varies | Till claim mismatch | PENDING | - | holder | 2026-10-22 |
| TILL_SEND_REFUSED | 403 | Till send refused | PENDING | - | chits | 2026-10-22 |
| TILL_SERIES_COLLISION | varies | Till series collision | PENDING | - | chits | 2026-10-22 |
| TOKEN_INVALID | 401 | Token invalid | PENDING | - | auth | 2026-10-22 |
| USER_ID_ENTITY_ONLY | 403 | User id entity only | PENDING | - | entities | 2026-10-22 |
| USER_ID_IMMUTABLE | 409 | User id immutable | PENDING | - | entities | 2026-10-22 |
| USER_ID_INVALID | 400 | User id invalid | PENDING | - | entities | 2026-10-22 |
| USER_ID_TAKEN | 409 | User id taken | PENDING | - | entities | 2026-10-22 |
| VAULT_ENC_UNCONFIGURED | 503 | Vault enc unconfigured | PENDING | - | identity-docs | 2026-10-22 |
| VAULT_VERSION_REQUIRED | varies | Vault version required | PENDING | - | governance | 2026-10-22 |
| VIEW_ONLY | varies | View only | PENDING | - | crm-groups | 2026-10-22 |
| VISIBILITY_NOT_MIGRATED | 409 | Visibility not migrated | PENDING | - | entities | 2026-10-22 |
| WORKBOOK_CUT | varies | Workbook cut | PENDING | - | products | 2026-10-22 |
| WRITER_THREW | varies | Writer threw | PENDING | - | signin-events | 2026-10-22 |
| WRONG_SCOPE | varies | Wrong scope | PENDING | - | verdict | 2026-10-22 |
| WRONG_VALUE | 422 | Field not valid | A field has a value of the wrong kind. | Use the kind of value the field asks for. | validate | 2026-10-22 |
| YEAR_CLOSED | 409 | Year closed | PENDING | - | books | 2026-10-22 |
<!-- codes:end -->
