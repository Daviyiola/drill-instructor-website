# Cost and reliability console steps

No console setting or production data is changed by this repository pass.

## Student prices

### Stripe Dashboard

For both the ACT and SAT products, create new recurring USD Prices at $5.99
monthly and $49.99 annually. Stripe Prices are immutable: do not edit or archive
the currently referenced Price until the new IDs are configured and tested.
Set `STRIPE_PRICE_ACT_MONTHLY`, `STRIPE_PRICE_ACT_ANNUAL`,
`STRIPE_PRICE_SAT_MONTHLY`, and `STRIPE_PRICE_SAT_ANNUAL` to the matching four
`price_...` IDs. Never share one bootcamp's Price ID with the other bootcamp.
Existing subscriptions continue on their existing Price; this code does not
silently migrate or reprice them. Use an explicit Stripe subscription schedule
or customer-approved migration if they should move later.

### App Store Connect

Confirm the identifiers listed in `MOBILE_STORE_BILLING_SETUP.md` use one
auto-renewable subscription group per bootcamp: ACT monthly/annual together,
and SAT monthly/annual together. Do not place ACT and SAT in the same group,
because that would prevent a customer from holding both subscriptions. Set the
two monthly products to the local tier equivalent of $5.99 USD and the two
annual products to the equivalent of $49.99 USD. Review Apple's price-change
notice/consent treatment before choosing whether existing subscribers retain
their current price.

### Google Play Console

For `act_premium` and `sat_premium`, confirm active `monthly` and `annual` base
plans at the local-market equivalents of $5.99 and $49.99. Do not swap base-plan
IDs or products. Choose the existing-subscriber price migration behavior in
Play Console explicitly; source changes alone do not reprice renewals.

## Firebase App Check

1. Register the web, iOS, and Android apps in Firebase App Check.
2. Configure reCAPTCHA Enterprise for web, App Attest with DeviceCheck fallback
   for iOS, and Play Integrity for Android.
3. During local development use Firebase's official App Check debug provider
   and register only developer debug tokens in the Firebase console. Do not
   commit debug tokens.
4. Configure `NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY` and release the web
   client, which then sends `X-Firebase-AppCheck`. Leave enforcement disabled
   and monitor App Check metrics.
5. Add Firebase App Check token acquisition to the native iOS and Android
   authorized-request bridge before enforcing this shared boundary. The native
   client does not yet ship that SDK integration, so enabling enforcement now
   would break legitimate mobile users.
6. After supported web and native client versions have propagated, set the Functions runtime
   environment value to `APP_CHECK_ENFORCEMENT=required` and redeploy. The
   shared authenticated request boundary then fails closed on missing or invalid
   App Check tokens. Stripe, Apple, and Google webhook endpoints retain their
   provider-signature verification and are not gated by client App Check.

## Realtime Database indexes

Deploy the reviewed RTDB rules separately when ready. They keep the existing
deny-all client access while adding indexes for `users.uid`, attempt timestamps,
challenge expiry, challenge-key expiry, and Stripe subscription ownership.
Rules are not deployed by a Functions or web deployment. Before redesigning the
remaining broad scheduled jobs, create and backfill dedicated due-item and
aggregate projections in code and validate them in an emulator; do not loosen
the deny-all client rules.
