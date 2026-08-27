# Mobile Store Billing Setup

The Functions backend now verifies Apple and Google subscriptions and derives
one canonical signed Drill Instructor license across `access_code`, `stripe`,
`app_store`, `play_store`, and `admin` entitlements. It does not create store
products or implement the native purchase sheet.

## Product catalog

Apple products:

- `com.drillinstructor.app.act.monthly`
- `com.drillinstructor.app.act.annual`
- `com.drillinstructor.app.sat.monthly`
- `com.drillinstructor.app.sat.annual`

Google products:

- `act_premium`, base plans `monthly` and `annual`
- `sat_premium`, base plans `monthly` and `annual`

`getStoreCatalogHttps` returns these identifiers and safe metadata. StoreKit
and Play Billing remain authoritative for localized titles and prices.

## Shared native flow

1. Authenticate with Firebase.
2. Call `getStorePurchaseContextHttps`.
3. Apple: attach the returned UUID as StoreKit 2 `appAccountToken`.
4. Google: attach the returned value using `setObfuscatedAccountId`.
5. Present products and localized prices returned by the store SDK.
6. After a completed purchase, send the signed StoreKit 2 transaction JWS to
   `verifyApplePurchaseHttps`, or send `productId` and `purchaseToken` to
   `verifyGooglePlayPurchaseHttps`.
7. Refresh `getSubscriptionStatusHttps`. Never unlock from the client purchase
   result alone.

For Apple restoration, enumerate StoreKit 2 current entitlements and submit
each verified transaction JWS through `verifyApplePurchaseHttps`. A separate
restore endpoint is not needed for this contract.

Deleting a Drill Instructor account does not cancel App Store or Google Play
subscriptions. The deletion confirmation UI must direct customers to cancel
those subscriptions in the corresponding store first.

## Apple configuration

Non-secret environment values:

```text
APPLE_BUNDLE_ID=com.drillinstructor.app
APPLE_APP_ID=<numeric App Apple ID>
APPLE_ENVIRONMENT=Production
```

Download Apple's current public root certificates from Apple PKI. Convert each
DER certificate to base64 and store a JSON array (or comma-separated list) as:

```text
firebase functions:secrets:set APPLE_ROOT_CERTIFICATES_BASE64
```

Configure App Store Server Notifications V2 to POST to:

```text
https://us-central1-drill-instructor-pro.cloudfunctions.net/appleStoreNotificationsHttps
```

The current implementation verifies client and notification JWS locally and
does not call the App Store Server API. Therefore issuer ID, key ID, and the
`.p8` private key are not currently required. They will be required if a future
server-side transaction-history or restore endpoint is added; never commit
them.

Use `APPLE_ENVIRONMENT=Sandbox` for a sandbox-only deployment. Production
verification requires `APPLE_APP_ID` and fails closed when configuration or
certificate verification is unavailable.

## Google Play configuration

Non-secret environment values:

```text
GOOGLE_PLAY_PACKAGE_NAME=com.drillinstructor.app
GOOGLE_PLAY_PUBSUB_AUDIENCE=https://us-central1-drill-instructor-pro.cloudfunctions.net/googlePlayNotificationsHttps
GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT=<authenticated-push-service-account-email>
```

Generate and store a high-entropy HMAC secret:

```text
firebase functions:secrets:set STORE_TOKEN_HASH_SECRET
```

Enable the Google Play Android Developer API. Link the Functions runtime
service account in Play Console and grant the minimum subscription-order
permissions required to read and acknowledge purchases.

Create the Real-time Developer Notifications Pub/Sub topic. Configure an
authenticated push subscription targeting `googlePlayNotificationsHttps`,
using the exact audience and service-account email above. Grant the Google Play
service agent permission to publish to the topic.

The backend uses `purchases.subscriptionsv2.get`, grants only verified paid
through states, and acknowledges eligible initial purchases after entitlement
persistence. `PENDING`, paused, on-hold, expired, unsupported, mismatched, and
unowned purchases fail closed.

## Server-owned records

```text
userEntitlements/{userId}/{bootcamp}/{provider}
storeTransactions/{provider}/{transactionKey}
storeTransactionsByUser/{userId}/{bootcamp}/{provider}/{transactionKey}
storePurchaseSecrets/play_store/{tokenHash}
storeNotificationEvents/{provider}/{notificationId}
```

RTDB client rules must deny reads and writes to all of these paths. The raw
Google purchase token exists only in the server-private operational path so
the backend can reconcile it with Google. Public APIs return provider names,
status, renewal flags, and expiration dates only.

## Pre-deployment checks

```text
cd functions
npm ci
npm run lint
node --test test/stripe-billing.test.js test/store-billing.test.js
npm test
```

No Function should be deployed until the required environment values, secrets,
Apple certificates, Play Console permissions, and authenticated Pub/Sub push
identity are configured.
