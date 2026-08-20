# Android Release Runbook

Last updated: August 12, 2026

## Locked identity

| Item | Value |
| --- | --- |
| Application ID | `com.drillinstructor.app` |
| Firebase Android App ID | `1:975311339573:android:0bd0a1ffc912415223f17c` |
| Version | `1.0.0` |
| Version code | `1` |
| Compile/target SDK | Android 16 / API 36 |
| Minimum SDK | Android 9 / API 28 |

## Current artifacts

- Signed Play bundle: `Drill_Instructor/release-artifacts/Drill-Instructor-1.0.0-1.aab`
- Signed sideload APK: `Drill_Instructor/release-artifacts/Drill-Instructor-1.0.0-1.apk`
- Upload keystore: `Drill_Instructor/.secrets/android/drill-instructor-upload.p12`
- Local credentials: `Drill_Instructor/.secrets/android/keystore.properties`
- Firebase configuration: `Drill_Instructor/android/google-services.json`

The `.secrets` and `release-artifacts` directories are deliberately ignored by the native repository. Never commit the keystore or its password.

## Upload certificate

- Alias: `drill-instructor-upload`
- SHA-1: `12:60:AB:94:6A:82:1B:10:04:FB:FE:97:93:D9:EB:B7:A2:0C:26:FC`
- SHA-256: `5D:DB:89:04:1C:87:F3:28:60:3E:1F:69:45:0F:D6:AF:E5:7F:19:94:66:E7:C4:88:1D:3E:B0:AC:1C:52:41:63`
- Expiration: December 28, 2053

Google Play App Signing should be enabled. This local key is the upload key; Google holds the separate app-signing key used for installs delivered to users.

## Required backup before upload

Copy both files below to at least two secure locations, one of which is outside this computer:

1. `drill-instructor-upload.p12`
2. `keystore.properties`

Suitable locations include an encrypted password manager attachment and an encrypted external/cloud backup. Losing the upload key creates a recovery process; losing both the key and password prevents ordinary update signing.

## One-command release build

After incrementing `PRODUCT_VERSION_CODE` (and normally `PRODUCT_VERSION_NAME`) in `Drill_Instructor/CMakeLists.txt`, run from the native project directory:

```powershell
.\scripts\build-android-release.ps1
```

Before doing a long build, validate paths, credentials, version parsing, and artifact naming with:

```powershell
.\scripts\build-android-release.ps1 -ValidateOnly
```

The script:

- Reads the version directly from `CMakeLists.txt`.
- Uses `.secrets/android/felgo-license-{versionCode}.txt` when present, otherwise the installed Felgo user license.
- Validates API 36, Felgo, NDK, build tools, and upload-key files.
- Configures the resource-embedded publish build.
- Produces and signs the AAB and APK.
- Verifies both signatures and prints SHA-256 file hashes.
- Restores the exact development `qml/config.json` even after a failed build.
- Refuses to overwrite an existing version unless `-Overwrite` is explicitly supplied.

Use `-Overwrite` only while rebuilding the same local version before it has been uploaded to Play. Once an AAB version code has reached Play Console, increment the version code instead.

## Build modes

Development remains the default:

```powershell
cmake -S Drill_Instructor -B <development-build-directory>
```

The automation wraps this underlying publish build:

```powershell
cmake -S Drill_Instructor -B <release-build-directory> `
  -DDRILL_INSTRUCTOR_PUBLISH=ON
cmake --build <release-build-directory> --target aab --config Release
```

Felgo rewrites `qml/config.json` for the selected configuration. After producing a release, restore/reconfigure the development build so the source copy reads `"stage": "test"` for Felgo Live.

## First Play Console upload

1. Create the app as **Drill Instructor** with default language English (United States).
2. Choose **App**, **Free**, and accept the declarations.
3. Open **Testing > Internal testing**.
4. Create an internal release and enable **Play App Signing**.
5. Upload `Drill-Instructor-1.0.0-1.aab`.
6. Add tester email addresses or a Google Group.
7. Save, review, and roll out the internal release.
8. Install from the Play-generated opt-in link; do not validate only with a locally installed APK.

Use `https://drillinstructorprep.com/account-deletion` for the account-deletion
URL requested by the Play Console Data Safety form. The public page verifies
ownership through a short-lived email link before deletion; authenticated users
can continue using the faster in-app Profile flow.

## Baseline smoke test

- Fresh install and first launch without Felgo Live.
- Student sign-up, verification, sign-in, and sign-out.
- Educator sign-in and approval/pending routing.
- Bootcamp loading and account preferences.
- Solo drill creation, resume, submission, results, and review.
- Content-pack download, offline drill, queued submission, and later synchronization.
- Bookmarks, Test Records, analytics, squads, and assignments.
- Contact form and password reset.
- Account deletion.

## Version discipline

Every Play upload must have a strictly higher `PRODUCT_VERSION_CODE`. Keep the user-facing `PRODUCT_VERSION_NAME` semantic, for example `1.0.1`, while incrementing the integer version code for every uploaded bundle—even discarded internal-test builds.


powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\build-android-release.ps1" -Overwrite

cd /d C:\Users\david\dev\drill-instructor-website\Drill_Instructor
adb install -r ".\release-artifacts\Drill-Instructor-1.0.0-1.apk"
