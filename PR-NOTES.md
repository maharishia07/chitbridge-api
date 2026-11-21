# fix/signin-1128 — plan (M1, M3, M5 of VERIFY-GF-MONEY-SECURITY). No change to an existing decision; no migration.
1. M1: lib/signin-code.js storeCode and lib/identity-auth.js issueOtp keep otp_attempts while the old code is unexpired (the issueShopperOtp CASE, lib/otp.js:55); zero only when no live code. The per-account budget is the DB-kept otp_attempts of the code window (5 wrong per live code, however often it is asked for).
2. M3: PIN lock becomes timed. pin_locked_at stays the marker; lock lasts 15 min x 2^(pin_attempts-5), cap 24 h; attempts are kept until a right PIN, so each relock doubles. Expired lock is cleared in verifyPin before counting. Owner unlock = existing reset-pin (routes/actors.js).
3. M5a: POST /pin is first-time only; an actor who already has a PIN gets 409 PIN_ALREADY_SET and must use PUT /api/actors/change-pin (needs the current PIN) or an owner reset.
4. M5b: absolute session lifetime: sessions carry `born` (first sign-in); renew refuses past 30 d (till 90 d) with SESSION_EXPIRED.
5. M5c: surface 'till' is honoured only on a device that holds a till pairing (policy_flags.devices[d].till, written by lib/api-keys.js); otherwise the session is a 'web' one.
Tests: tests/signin-otp-budget-m1.test.cjs, tests/pin-timed-lock-m3.test.cjs, tests/session-limits-m5.test.cjs (one attack scenario each).
Not done: 6-digit PIN (a sign-in contract change, web), per-account DB budget across codes (needs a column: only if Athi wants beyond the code window).
