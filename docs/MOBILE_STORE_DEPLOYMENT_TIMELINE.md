# Mobile Store Deployment Timeline

Last updated: August 12, 2026

## Current rollout status

- Google Play organization setup and website verification completed.
- Apple organization verification remains in progress.
- Android package ID confirmed as `com.drillinstructor.app`.
- Android API 36 and Build Tools 36 installed locally.
- Felgo development and publish builds separated through `DRILL_INSTRUCTOR_PUBLISH`.
- Publish QML/resources compile successfully.
- Release manifest reduced to Internet and network-state permissions.
- Firebase Android app registered as `1:975311339573:android:0bd0a1ffc912415223f17c`.
- Permanent upload key created and its SHA-1/SHA-256 fingerprints registered with Firebase.
- First signed AAB produced at `Drill_Instructor/release-artifacts/Drill-Instructor-1.0.0-1.aab`.
- Public account-deletion request and email-confirmation flow deployed; web route is `/account-deletion`.
- Remaining Gate 1 work: back up the upload key, install and smoke-test the standalone release, then upload the AAB to Play Internal Testing.

## Objective

Release Drill Instructor through Google Play first, followed by the Apple App Store. The Android release can be prepared entirely from the current Windows environment. Final iOS compilation, signing, StoreKit/APNs testing, and TestFlight distribution require access to a modern Mac or a compatible macOS cloud build environment.

## Locked application identity

| Item | Value |
| --- | --- |
| Public app name | Drill Instructor |
| Website | `drillinstructorprep.com` |
| Android application ID | `com.drillinstructor.app` |
| iOS bundle ID | `com.drillinstructor.app` |

The application identifier does not need to match the website domain. Keep `com.drillinstructor.app`; changing it would require new Firebase registrations and updates to signing, StoreKit, APNs, and related configuration without providing a meaningful benefit.

## Week 0: Business verification and accounts

Start immediately because external verification may take longer than engineering work.

- Look up the LLC through Apple's official D-U-N-S lookup.
- If it is not listed, request a free D-U-N-S number from Dun & Bradstreet.
- Confirm that the legal name, address, telephone number, and website match the LLC records exactly.
- Enroll in the Apple Developer Program as an organization.
- Create a Google Play organization developer account.
- Use an email address on the `drillinstructorprep.com` domain where possible.
- Complete Apple agreements, banking, and tax information.
- Complete the Google organization and payments-profile verification.

Expected external timing:

- Existing D-U-N-S record: lookup may be immediate.
- New D-U-N-S record: allow up to five business days.
- D&B-to-Apple synchronization: allow up to two additional business days.
- Apple/Google organization verification: variable and outside the engineering schedule.

### Gate 0

- D-U-N-S number confirmed.
- Both organization developer accounts created or under active verification.
- `com.drillinstructor.app` reserved in the applicable consoles.

## Days 1–4: Android release baseline

Create a genuine standalone Android release before adding store billing.

- Change Felgo configuration from `test` to `publish`.
- Add the production Felgo project license key.
- Compile QML and JavaScript into Qt resources.
- Load `qrc:/qml/Main.qml` in production.
- Clean duplicated Android manifest entries.
- Audit and minimize Android permissions.
- Target Android 16/API 36.
- Generate a permanent Android upload/signing key.
- Store encrypted backups of the signing key and its credentials.
- Produce a signed release AAB and an installable release APK.
- Confirm that the app runs without Felgo Live or Qt Creator.
- Confirm that full question banks and unused development files are not bundled accidentally.

Release smoke test:

- Sign up, verify email, sign in, and sign out.
- Load bootcamps and account preferences.
- Start, resume, submit, and review a solo drill.
- Download and delete a content pack.
- Complete an offline drill and synchronize it.
- Open bookmarks, Test Records, analytics, squads, and assignments.
- Delete an account.

### Gate 1

A signed standalone Android build authenticates, starts and submits drills, restores offline state, and runs without development tooling.

## Days 4–7: Google Play internal testing

- Create the Play Console app with `com.drillinstructor.app`.
- Upload the baseline AAB to Internal Testing.
- Add internal testers and license testers.
- Install the Play-delivered build on physical devices.
- Test at least one older/lower-memory Android device and one current device.
- Configure Firebase crash reporting before expanding the test group.
- Fix release-only packaging, permission, networking, and asset-loading failures.

### Gate 2

The Play-delivered internal build completes the release smoke test without a critical crash or data-loss defect.

## Week 2: Mobile subscriptions

Add billing after the baseline app identity and release package work.

- Create ACT and SAT monthly and annual subscription products in Play Console.
- Add the native Play Billing bridge exposed to QML.
- Add a shared purchase interface that can later support StoreKit.
- Send every purchase token to a Cloud Function for verification.
- Never grant premium access based solely on a client success callback.
- Extend the existing entitlement system with `google_play` and `apple_app_store` providers.
- Keep `stripe` and school-issued `access_code` entitlements distinct.
- Implement Restore Purchases.
- Handle pending purchases, failed payments, cancellation, expiration, grace periods, refunds, revocation, and monthly-to-annual changes.
- Add idempotent verification and subscription-history records.
- Configure Google Real-time Developer Notifications.

Billing test matrix:

- New monthly purchase.
- New annual purchase.
- Monthly-to-annual upgrade.
- Reinstallation and restoration.
- Renewal.
- Cancellation with access retained until period end.
- Failed payment and recovery.
- Refund and revocation.
- Existing Stripe entitlement.
- Existing school access-code entitlement.
- Attempted duplicate or overlapping subscription.

### Gate 3

No mobile purchase changes entitlement state until the server independently verifies it, and all retry paths are idempotent.

## Week 2: Notifications and deep links

Notifications can be developed alongside billing but do not block the first Android internal build.

- Integrate Firebase Cloud Messaging on Android.
- Store tokens per user and device installation.
- Refresh rotated tokens and delete invalid tokens.
- Disassociate tokens on sign-out from shared devices.
- Add notification preferences.
- Add deep-link routing for challenges, assignments, released results, and subscriptions.
- Keep sensitive scores, answers, and school data out of lock-screen payloads.
- Add local, opt-in practice reminders separately from server pushes.

Initial remote notifications:

- New squad challenge or reinvitation.
- Challenge participant completed.
- New assignment and due-soon reminder.
- Score or corrections released.
- Subscription approaching expiration.
- Content-pack update available.

## End of Week 2: Android closed test

- Expand to approximately five to ten trusted testers.
- Run a focused five-to-seven-day test rather than waiting idly for two weeks.
- Exercise different networks, airplane mode, interrupted downloads, background timers, account switching, and reinstalls.
- Record defects by severity and block production only for critical/high-severity failures.
- Prepare the Play listing in parallel:
  - App icon and feature graphic.
  - Phone/tablet screenshots.
  - Description and category.
  - Content rating.
  - Privacy policy.
  - Data Safety form.
- Public account-deletion URL.
- Account-deletion URL: `https://drillinstructorprep.com/account-deletion`.
  - Support contact information.

An organization account is not subject to the mandatory 12-person, 14-day closed-test requirement applied to newly created personal accounts. Testing remains a product-quality gate.

### Gate 4

- No unresolved critical defect.
- Purchase and entitlement reconciliation is reliable.
- Offline submissions reconcile with canonical server results.
- Store listing and policy forms are complete.

## Week 3: Android production submission

- Upload the release candidate.
- Use staged rollout, beginning around 5–10% where available.
- Monitor crashes, failed sign-ins, purchase verification, offline synchronization, content downloads, and notification-token failures.
- Increase rollout only after the first cohort remains stable.

Google advises allowing up to seven days or longer in exceptional cases for review, although internal-test builds and many reviews complete sooner.

## Parallel iOS dependency: macOS access

The following can be prepared on Windows: shared QML UI, server verification, entitlement contracts, product identifiers, notification payloads, and most purchase-state logic.

The following require macOS/Xcode or an appropriately configured cloud macOS builder:

- Generating and validating the final Xcode project.
- Compiling with Xcode 26 and the iOS 26 SDK.
- Code signing and provisioning.
- StoreKit sandbox testing.
- APNs entitlement and token testing.
- Creating an archive and uploading to TestFlight/App Store Connect.
- Diagnosing native iOS build and runtime failures.

Preferred options, in order:

1. A modern Mac Mini or MacBook capable of running Xcode 26.
2. Temporary access to a physical/rented Mac for the first integration.
3. Felgo Cloud Builds or macOS CI after one interactive local build succeeds.

Do not make the first StoreKit/APNs integration depend entirely on remote build logs if interactive Xcode access can be arranged.

## Weeks 3–5: iOS release and TestFlight

- Install Xcode 26 and a compatible Felgo/Qt iOS kit.
- Generate and clean the Xcode project.
- Configure signing for `com.drillinstructor.app`.
- Add In-App Purchase and Push Notifications capabilities.
- Remove unused camera, microphone, contacts, Bluetooth, location, and photo usage declarations.
- Add and validate the iOS privacy manifest.
- Create ACT and SAT subscription groups/products in App Store Connect.
- Test purchase states first with a local StoreKit configuration.
- Configure the real Apple sandbox products and tester accounts.
- Implement StoreKit transaction verification through the backend.
- Configure App Store Server Notifications.
- Create an APNs authentication key and upload it to Firebase.
- Test notifications and deep links on a physical iPhone.
- Archive and upload the build to TestFlight.
- Run the same functional, offline, billing, restoration, and account-deletion matrix used on Android.

### Gate 5

The TestFlight build passes purchase, restoration, notification, offline, synchronization, and deletion testing on physical iPhones.

## Weeks 5–6: Apple submission

Prepare:

- App Store screenshots and metadata.
- Privacy disclosures and age rating.
- Privacy policy, support URL, and account-deletion path.
- A ready-to-use student reviewer account.
- A pre-approved educator reviewer account.
- A sample assignment and populated analytics.
- Review notes explaining school access codes, individual store subscriptions, offline content packs, educator approval, and how to reach every gated feature.

Apple reports that 90% of submissions are reviewed in under 24 hours. For the first release, reserve two to four days and additional time for any rejection/resubmission cycle.

### Gate 6

- Apple review has full access to every core feature.
- The first subscriptions are submitted with the app as required.
- No incomplete, placeholder, or inaccessible workflow remains in the submitted build.

## Launch order

1. Google Play Internal Testing.
2. Google Play closed test.
3. Apple TestFlight.
4. Google Play staged production release.
5. Apple App Store submission.
6. Increase Android rollout after monitoring.
7. Release iOS after approval.

Android and iOS do not need to launch on the same day. Android should not be delayed solely because macOS hardware is unavailable.

## Immediate next actions

### Owner

- Look up/request the LLC D-U-N-S number.
- Begin Apple and Google organization enrollment.
- Confirm access to the `drillinstructorprep.com` domain email and business telephone number.
- Decide how macOS access will be obtained before the iOS integration phase.

### Engineering

- Convert the Felgo Android project to a publish/QRC build.
- Audit the final Android permissions and manifest.
- Target API 36.
- Establish signing and artifact-handling procedures.
- Produce the first standalone Android release build.

## Timeline interpretation

The six-week horizon is a conservative end-to-end schedule for two public stores, billing, notifications, beta testing, business verification, and review buffers. It is not six weeks before the first usable build.

The first Android internal-test build is targeted within several working days once signing and Felgo publish configuration are available. A production Android submission may be achievable in approximately two to three weeks if account verification, billing integration, and testing proceed cleanly.
