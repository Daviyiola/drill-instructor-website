# Stripe billing setup

The application uses hosted Stripe Checkout for monthly and annual
subscriptions, and Stripe Customer Portal for billing management. Each
subscription unlocks one bootcamp.

## Which environment file owns each value?

There are three separate configuration scopes:

| Location | Used by | Put here |
| --- | --- | --- |
| Root `.env.local` | Next.js in the browser | Existing `NEXT_PUBLIC_FIREBASE_*` values |
| `functions/.env.drill-instructor-pro` | Deployed Cloud Functions | Web return URL and four non-secret Stripe Price ids |
| Firebase Secret Manager | Selected Cloud Functions only | Stripe secret API key and webhook signing secret |

Continue using the root `.env.local`. Do not move or remove its existing
Firebase values. This integration uses hosted Checkout, so the browser does not
need a Stripe publishable key.

Never put an `sk_test_...`, `sk_live_...`, or `whsec_...` value in either
dotenv file. Firebase binds those secrets only to the Functions that need them.

## Decisions already encoded

- Canceling retains access through the current paid period.
- A refund is recorded in subscription history, but does not automatically
  remove access. Access follows the Stripe subscription status and paid-through
  date.
- A failed renewal receives one seven-day `past_due` grace period. `unpaid`,
  `incomplete_expired`, `paused`, and fully canceled subscriptions do not grant
  paid access.
- Scheduled customer cancellation retains access because Stripe keeps the
  subscription `active` until its paid period ends.
- Stripe, not the browser, determines successful payment and entitlement.
- No Stripe secret or publishable key belongs in the web `.env.local` file.

## Phase A: test-mode configuration

### 1. Open or create the Stripe account

Sign in to Stripe and keep the Dashboard in test mode or a sandbox. Do not use
live-mode keys or products during the first integration test.

Live payments will later require completing Stripe's business verification and
adding the LLC's settlement bank account. That is not required to build the
test-mode integration.

### 2. Create the products and recurring prices

Open Stripe's Product catalog. Create two products:

- `Drill Instructor ACT Bootcamp`
- `Drill Instructor SAT Bootcamp`

Add two recurring prices to each product:


| Bootcamp | Billing period | Price |
| --- | --- | ---: |
| ACT | Monthly | $6.99 USD |
| ACT | Annual | $49.99 USD |
| SAT | Monthly | $6.99 USD |
| SAT | Annual | $49.99 USD |

Use USD, recurring pricing, and a fixed per-unit amount. Do not create a single
shared price for ACT and SAT because the server maps each subscription to one
bootcamp.

After saving each price, copy its `price_...` identifier. The product's
`prod_...` identifier is not used by the application.

### 3. Create the Functions environment file

From the repository root:

```powershell
Copy-Item -LiteralPath "functions\.env.example" `
  -Destination "functions\.env.drill-instructor-pro"
```

Open `functions/.env.drill-instructor-pro` and enter the four test-mode Price
ids:

```dotenv
WEB_APP_URL=http://localhost:3000
STRIPE_PRICE_ACT_MONTHLY=price_replace_me
STRIPE_PRICE_ACT_ANNUAL=price_replace_me
STRIPE_PRICE_SAT_MONTHLY=price_replace_me
STRIPE_PRICE_SAT_ANNUAL=price_replace_me
```

`WEB_APP_URL` must be only an origin: no `/app`, query string, or trailing
application path. Use `http://localhost:3000` while testing the local Next.js
site. Replace it with the real HTTPS web origin before launch.

This project-specific file is gitignored.

### 4. Store the Stripe test secret key

In Stripe test mode, open Developers/API keys and reveal the test secret key.
It begins with `sk_test_`.

From the repository root, run:

```powershell
firebase functions:secrets:set STRIPE_SECRET_KEY --project drill-instructor-pro
```

Paste the key only into the masked Firebase prompt. Do not paste it into chat,
source code, `.env.local`, or `functions/.env.drill-instructor-pro`.

### 5. Register the test webhook

In Stripe Workbench/Webhooks, create an account webhook destination using:

```text
https://us-central1-drill-instructor-pro.cloudfunctions.net/stripeWebhookHttps
```

Subscribe it to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `invoice.finalization_failed`
- `refund.created`

It is okay that the URL is not deployed yet. Reveal and copy this endpoint's
test-mode signing secret; it begins with `whsec_`. Then run:

```powershell
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project drill-instructor-pro
```

Paste the signing secret into the masked prompt. A webhook secret is specific
to that endpoint and Stripe mode; it is not the Stripe API key.

### 6. Configure Customer Portal

In Stripe's Customer Portal settings:

- Enable payment-method updates.
- Enable invoice-history viewing.
- Allow customers to cancel subscriptions.
- Set cancellation to the end of the current billing period.
- Save the test-mode portal configuration.

In Billing revenue-recovery settings:

- Enable Smart Retries.
- Enable failed-payment and expiring-card emails.
- Include a Customer Portal link for payment-method correction.
- After retries are exhausted, cancel the subscription instead of leaving it
  indefinitely `past_due`.

The server also enforces paid-through access from the subscription period, but
the Portal setting ensures the customer-facing cancellation flow matches it.

### 7. Deploy the billing Functions

```powershell
firebase deploy --only "functions:createStripeCheckoutSessionHttps,functions:createStripeBillingPortalSessionHttps,functions:getStudentSubscriptionHistoryHttps,functions:getSubscriptionStatusHttps,functions:stripeWebhookHttps,functions:reconcileStripeSubscriptions" --project drill-instructor-pro
```

The selected HTTP Functions are configured for public network invocation.
Application endpoints still require a valid Firebase bearer token. The webhook
does not use a Firebase login; it verifies Stripe's signature against the raw
request body.

### 8. Test the complete flow

1. Start the web app with `npm run dev`.
2. Sign in as a student.
3. Open ACT or SAT, then Subscription.
4. Choose Monthly or Annual and continue to Stripe.
5. In test mode, use card number `4242 4242 4242 4242`, any future expiry,
   any three-digit CVC, and a valid postal code.
6. Confirm that Stripe returns to the subscription page.
7. Confirm that Current access becomes active and Payment completed appears in
   Subscription history.
8. Select Manage billing and schedule cancellation.
9. Confirm that the application shows the paid-through date and retains access.
10. In Stripe, open the payment and issue a test refund. Confirm that the refund
    appears in history without independently removing access.
11. In Stripe Workbench, inspect the webhook deliveries and confirm they return
    HTTP 200.
12. Use a Stripe Billing simulation/test clock to verify renewal, failed
    renewal, seven-day grace, recovery, and terminal cancellation behavior.

The expected RTDB server-owned records are:

- `stripeCustomers/{studentId}`: Stripe Customer mapping
- `stripeCustomerIndex/{customerId}`: reverse lookup for webhooks
- `stripeSubscriptions/{subscriptionId}`: subscription ownership/status index
- `users/{studentId}/testdata/{bootcamp}/license`: current signed entitlement
- `subscriptionEvents/{studentId}/{bootcamp}`: access and billing history
- `stripeWebhookEvents/{stripeEventId}`: processed-event audit marker
- `stripeReconciliationRuns/{runTimestamp}`: daily reconciliation health log

The daily `reconcileStripeSubscriptions` schedule retrieves Stripe's current
state for every indexed subscription and repairs the RTDB license/index. This
protects access state if webhook delivery is delayed or exhausted.

No card number or payment-method payload is stored in RTDB.

## Phase B: switch to live payments

Do this only after test mode passes:

1. Complete Stripe account activation for the LLC and settlement bank account.
2. Create the same two products and four recurring prices in live mode.
3. Replace the four test `price_...` values in
   `functions/.env.drill-instructor-pro` with the live Price ids.
4. Replace `WEB_APP_URL` with the production HTTPS origin.
5. Set `STRIPE_SECRET_KEY` again using the live `sk_live_...` key.
6. Create a live-mode webhook destination with the same URL and all listed
   events.
7. Set `STRIPE_WEBHOOK_SECRET` again using that live endpoint's `whsec_...`.
8. Configure the live Customer Portal separately.
9. Redeploy all five billing Functions.
10. Make one low-risk live purchase and verify Checkout, history, Portal, and
    cancellation before announcing availability.
