# Native content-pack rollout

## Production status — 2026-07-30

- ACT and SAT `2026.07.1`, correction revision `0`, are active in
  `contentPackRegistry`.
- All four immutable Storage objects were uploaded with generation-zero
  overwrite protection and verified sizes, CRCs, and SHA-256 metadata.
- `CONTENT_PACK_GRANT_SECRET` version 3 is enabled; superseded versions 1 and
  2 are disabled.
- The Functions runtime has explicit object-viewer and self-signing access.
- The four APIs below are deployed and ACTIVE in `us-central1`.
- CORS preflights return 204, unauthenticated calls return 401, direct pack
  reads return 403, and direct unauthenticated registry reads return 401.

The remaining release work is rebuilding the Felgo client and executing the
on-device Wi-Fi/cellular, offline completion, resume, deletion, and sync smoke
matrix.

## What is implemented

- `functions/data/actData.js` and `functions/data/satData.js` are the only
  full-bank authoring files.
- `functions/data/contentCorrections.js` is the cumulative correction
  authoring source for the active base versions.
- `npm run content:build` validates and deterministically produces ACT/SAT
  `2026.07.1` base ZIPs, revision-zero overlays, registry metadata, and the
  native Tests 1-2 resources.
- Full native ACT/SAT banks and their original question-image trees are
  excluded from the application package.
- The native repository downloads, validates, activates, updates, and removes
  packs; creates local solo papers; checkpoints one active drill; queues
  offline submissions; and resumes cloud or local papers.
- The server issues signed descriptors/grants and grades delayed attempts from
  the exact retained pack version and cumulative correction revision.
- Educator auto-building and manual question selection use authenticated
  server APIs rather than the native bank.

## Build and inspect artifacts

From `functions/`:

```powershell
npm.cmd run content:build
```

The publishable output is deliberately ignored by Git:

```text
.content-packs/registry.candidate.json
.content-packs/act/2026.07.1/base/pack.zip
.content-packs/act/2026.07.1/corrections/0.json
.content-packs/sat/2026.07.1/base/pack.zip
.content-packs/sat/2026.07.1/corrections/0.json
```

The native free resources are generated under
`Drill_Instructor/assets/content-free/{act,sat}` and should be included in the
native build.

## One-time Firebase setup

Create a strong random HMAC secret. Do not place it in `.env.local`:

```powershell
firebase.cmd functions:secrets:set CONTENT_PACK_GRANT_SECRET --project drill-instructor-pro
```

The Functions runtime service account must be able to read the private pack
objects and sign short-lived V4 URLs. Grant the runtime identity object-viewer
access to the bucket and `iam.serviceAccounts.signBlob` on its own service
account (normally through Service Account Token Creator). Keep
`content-packs/**` denied by client Storage rules; downloads use signed URLs.

## Publish without exposing a partial release

Authenticate Application Default Credentials, then run from `functions/`:

```powershell
npm.cmd run content:publish -- --project drill-instructor-pro
```

To publish only one bootcamp after building the candidate artifacts, pass the
bootcamp explicitly. This avoids touching immutable objects belonging to an
unchanged bootcamp:

```powershell
npm.cmd run content:publish -- --project drill-instructor-pro --bootcamp act
```

## Automated full release

For a new base dataset version, run the guarded release command from the
repository root:

```powershell
npm.cmd run content:release -- --bootcamp act --project drill-instructor-pro
```

Use `--bootcamp sat` for SAT. The command validates the bootcamp and the native
schema version, builds both candidate artifacts, publishes and activates only
the selected bootcamp, deploys the question-dependent Functions sequentially
in small batches, and verifies the live RTDB registry. Function discovery is
given 60 seconds instead of Firebase CLI's 10-second default. It stops
immediately if any stage fails. Publishing happens before Function deployment,
so a failure after the publish stage must be treated as a partial release and
the same command should be rerun after resolving the deployment error.

The publisher verifies and skips matching immutable objects, uploads missing
objects with generation preconditions, and only then updates
`contentPackRegistry/{bootcamp}`. Re-running against different bytes at an
existing immutable path fails instead of overwriting history.

Never delete an old base ZIP or correction object while a delayed native
submission might reference it.

## Deploy the backend

Deploy these endpoints after the secret and IAM permissions exist:

```powershell
firebase.cmd deploy --only "functions:getStudentContentPackHttps,functions:submitOfflineStudentDrillHttps,functions:getEducatorQuestionBankHttps,functions:buildEducatorDrillBlueprintHttps" --project drill-instructor-pro
```

No RTDB client permission is required for `contentPackRegistry`; all access is
through Admin SDK Functions. Existing Storage rules already allow public reads
only for `question-images/**` and deny direct reads of `content-packs/**`.

## Release order and smoke test

1. Build twice and confirm registry hashes are identical.
2. Publish the immutable base packs and revision zero.
3. Deploy the four Functions.
4. Call the descriptor as an unlicensed student: metadata should be present,
   while `package` and `offlineGrant` are null.
5. Call it with an active ACT/SAT entitlement: verify the signed ZIP downloads
   and expires after roughly 15 minutes.
6. On a rebuilt native client, test free offline Tests 1-2, a paid downloaded
   test, app termination/resume, delayed sync, pack deletion, and a cloud
   challenge/assignment completed after disconnecting.
7. Inspect the packaged APK/IPA and confirm the deleted `actData.js` and
   `satData.js` banks and original ACT/SAT image trees are absent.

## Publishing a correction

Corrections are cumulative and immutable. Revision `N` must contain every
change relative to its base version, not merely the delta from `N-1`.
Reassignment of subject, module, or practice test requires a new base version.
After uploading and verifying the cumulative JSON, advance the registry's
`latestCorrectionRevision` and correction object metadata. Active sessions
stay pinned; bookmarks are updated locally when the overlay arrives; disabled
questions are excluded from newly built papers.

In the current revision-zero release both correction maps are empty. Before a
future revision is published, bump `correctionRevision`, add every cumulative
change to `contentCorrections.js`, rebuild, and repeat the deterministic/hash
checks. The build rejects correction IDs that do not exist, metadata moves,
invalid corrected answers, and missing replacement image references.

## Rollback

Do not overwrite or delete objects. Point the registry back to a previously
verified base/revision, then deploy a client/server fix if the schema changed.
Already-started sessions continue using their pinned version and revision.
