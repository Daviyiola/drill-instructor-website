"use strict";

/**
 * Explicit allowlist of development accounts that may be marked verified.
 *
 * Add either an email address or Firebase Auth UID. Email is usually easier:
 *   {email: "student-test@example.com"},
 *   {uid: "firebase-auth-uid"},
 *
 * Never add real customer accounts to this file.
 * Then open PowerShell/terminal in:
 * cd C:\Users\david\dev\drill-instructor-website\functions
 * If needed, authenticate once:
 * gcloud auth application-default login
 * Preview without changing anything:
 * npm run test-users:verify -- --project drill-instructor-pro
 * Apply after reviewing the preview:
 * npm run test-users:verify -- --project drill-instructor-pro --apply
 */
module.exports = [
  {email: "seunodu@gmail.com"},
  // {email: "educator-test@example.com"},
];
