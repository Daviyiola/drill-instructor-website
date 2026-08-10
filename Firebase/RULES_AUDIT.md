# Realtime Database Server-Only Rollout

Last updated: 2026-08-09

## Decision

Firebase Realtime Database is now treated as an internal server datastore.
Web and native clients authenticate with Firebase Auth and call authenticated
HTTPS Functions; they do not read or write RTDB directly.

The local deployed and candidate rule files both use:

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

The Firebase Admin SDK used by trusted Cloud Functions bypasses client security
rules, so this policy does not block server handlers.

## Client migrations completed

- Student profile edits use `updateStudentProfileHttps`.
- Educator profile edits use `updateEducatorProfileHttps`.
- Native bootcamp streak refresh uses `getMyBootcampsHttps` and retains its
  SQLite fallback.
- Native challenge inbox/detail/results use `getStudentChallengesHttps` and
  `getStudentChallengeHttps`, retaining the SQLite challenge cache.
- Legacy educator approval polling uses
  `checkEducatorApprovalStatusHttps`.
- The generic QML direct-RTDB helpers were removed from `Main.qml`.
- The web application already used HTTPS Functions for application data.

`qml/Firebase/Firebase.qml` is an unused Felgo sample component. It is excluded
from the active-client static test and would receive permission-denied responses
under these rules if opened.

## Automated checks

`Firebase/test/rtdb-rules.test.js` verifies that anonymous, student, and
educator client contexts cannot read or write profiles, history, school data,
drills, challenges, roles, designations, licenses, or access codes.

`Firebase/test/no-direct-rtdb-client.test.js` scans active web and native source
directories and fails if direct Firebase Database imports, URLs, or the removed
QML helper names are reintroduced.

Run the candidate suite with:

```powershell
npm.cmd run test:rules:candidate
```

## Production rollout order

1. Deploy the Functions used by the migrated native paths.
2. Rebuild and smoke-test the native app against those Functions while the old
   production rules are still available as rollback compatibility.
3. Back up the currently deployed rules.
4. Deploy the deny-all RTDB rules.
5. Smoke-test sign-in, student/educator profile saves, streaks, squad inbox and
   challenge details, and educator approval polling.

Do not deploy the deny-all rules before installing the rebuilt native client;
an older native build still containing direct RTDB calls would lose those
features immediately.

## Commands

Deploy the migrated Functions first:

```powershell
firebase.cmd deploy --only "functions:updateStudentProfileHttps,functions:updateEducatorProfileHttps,functions:getMyBootcampsHttps,functions:getStudentChallengesHttps,functions:getStudentChallengeHttps,functions:checkEducatorApprovalStatusHttps" --project drill-instructor-pro
```

After the rebuilt native client passes its smoke test, deploy rules:

```powershell
firebase.cmd deploy --only database --project drill-instructor-pro
```

