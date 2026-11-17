# Rotate the JWT secret (3 steps, no one signed out)

Why it is safe: tokens are signed with `JWT_SECRET`; the API accepts a token signed by `JWT_SECRET` or `JWT_SECRET_PREV`
(`lib/jwt-verify.js`). A person whose token was signed by the old secret keeps working until it expires.
The longest session is 30 days (D3), so the old secret is kept that long.

In Railway: project chitbridge-api, Variables.

1. **Keep the old secret.** Copy the current value of `JWT_SECRET` into a new variable `JWT_SECRET_PREV`. Do not deploy yet.
2. **Set the new secret.** Change `JWT_SECRET` to a new random value of at least 32 characters
   (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). Deploy. New sign-ins use the new secret;
   existing ones keep working. Check: sign in and use the app. Requests carried by the old secret show `kind:'rotated'` in the request log.
3. **After 30 days, remove `JWT_SECRET_PREV`.** Deploy. Anyone still holding a token from the old secret signs in again.
   Before this, check the log: no `kind:'rotated'` in the last day means nobody is carried by it.

Roll back: put the old value back into `JWT_SECRET` and remove `JWT_SECRET_PREV`. Nothing is stored in the database.

Note: connector API keys (`kind:'api_key'`) are also signed with `JWT_SECRET`. Any that live past the 30 days need to be
re-issued (Settings > Integrations) before step 3, or they stop working when `JWT_SECRET_PREV` is removed.
