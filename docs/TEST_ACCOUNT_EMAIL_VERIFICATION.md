# Verifying development accounts

This utility marks explicitly listed Firebase Authentication test accounts as
email verified. It does not send email and does not modify RTDB profiles.

## 1. Add test accounts

Edit `functions/scripts/testVerifiedUsers.config.js`:

```js
module.exports = [
  {email: "student-one@example.com"},
  {email: "educator-one@example.com"},
  // A UID may be used when an account has no convenient test email:
  {uid: "firebase-auth-uid"},
];
```

Never add real customer accounts.

## 2. Authenticate the Admin SDK

The script uses Application Default Credentials. On a development machine,
run this once if those credentials are not already configured:

```powershell
gcloud auth application-default login
```

## 3. Preview

From the `functions` directory:

```powershell
npm run test-users:verify -- --project drill-instructor-pro
```

The default is a dry run. It prints `WOULD VERIFY` without changing Firebase.

## 4. Apply

After checking the preview:

```powershell
npm run test-users:verify -- --project drill-instructor-pro --apply
```

The command reports verified, already-verified, missing, and invalid accounts.
It is safe to run repeatedly.

Afterward, use **CHECK STATUS** or **I'VE VERIFIED** in the client, or sign out
and back in, so the client refreshes its cached account status.
