# Drill Instructor

The Drill Instructor web application and Firebase backend.

## Repository boundary

This repository contains:

- The Next.js marketing site and authenticated student/educator web app.
- Firebase Functions and canonical question-bank data under `functions/`.
- Firebase configuration, RTDB rules, and rules tests.
- Web assets and content publishing scripts.

The Felgo native client is maintained in the separate
`drill_instructor_app` repository. For integrated local development, clone that
repository into `Drill_Instructor/` inside this workspace. The directory is
ignored by this repository, so its files and build output are never included in
web commits or Vercel deployments.

Some content-pack build checks and the bundled-free-pack generator expect that
local two-repository layout:

```text
drill-instructor-website/
  functions/
  app/
  Drill_Instructor/       # separate drill_instructor_app Git checkout
```

The normal web build does not require the native checkout.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Copy `.env.example` to `.env.local` and populate the public Firebase web
configuration. Keep server credentials in Firebase Functions secrets; do not
place Stripe, Resend, support-email, or other server secrets in `.env.local`.

## Validation

Run the production web build before publishing:

```bash
npm run build
```

Firebase Functions, content releases, and rules have their own commands and
deployment lifecycle. Deploying the Next.js application to Vercel does not
deploy Firebase Functions or Firebase rules.

## Vercel

Connect Vercel to this repository, keep the project root at the repository
root, and add the `NEXT_PUBLIC_FIREBASE_*` values from `.env.local` to the
Vercel project environment variables. Do not upload `.env.local`.

Vercel should use the standard commands:

- Install: `npm install`
- Build: `npm run build`
- Framework preset: Next.js
