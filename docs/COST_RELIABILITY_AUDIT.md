# Firebase cost, reliability, and student pricing audit

Date: 2026-09-04

Scope: `drill-instructor-website` and sibling `drill_instructor_app`. This pass
changes local source only. It does not deploy, publish, alter a live console,
or migrate/delete production records.

## Executive result

The verified web price discrepancy was $6.99 monthly on the website versus
$5.99 in the native fallback catalog. Student web pricing is now sourced from
one catalog at $5.99 monthly and $49.99 annually. Stripe cadence/bootcamp
selection and Apple/Google identifiers are separately cataloged and tested.
External product prices remain a dashboard verification item; source code
cannot prove or change a store's configured renewal price.

For a representative 30-minute, 40-question ACT session, the repository's
measurement script reports:

| Metric | Previous flow | Revised flow | Reduction |
| --- | ---: | ---: | ---: |
| Autosave requests | 229 | 40 | 82.53% |
| Full-session reads during autosave | 229 | 0 | 100% |
| Approximate autosave RTDB download | 30,397,460 B | 85,760 B | 99.72% |
| Approximate autosave RTDB writes | 314,417 B | 57,440 B | 81.73% |
| Newly completed session storage | 269,042 B | 8,256 B | 96.93% |

These are serialized-payload estimates from current ACT content, not Firebase
billing exports. They omit HTTP overhead and the previous repeated full-user
profile read, making the download comparison conservative. Reproduce with
`node functions/scripts/measureDrillCost.js`.

At the supplied rates, after the shared free quota:

| Scale | Previous | Revised |
| --- | ---: | ---: |
| Download per completed representative session | $0.030397 | $0.00008576 |
| Download per 10,000 such sessions | $303.9746 | $0.8576 |
| Storage per 10,000 retained completed sessions/month | $13.4521 | $0.4128 |

Writes do not have a rate in the requested model. Fewer requests also reduce
Function invocation and execution exposure, but no dollar saving is claimed
without production billing and latency measurements.

## Student drill lifecycle and data map

1. The web setup UI calls `createStudentDrillSessionHttps`, or the assignment
   and challenge entry points create the equivalent session. The server checks
   Firebase Auth, the custom student mapping, bootcamp-specific entitlement,
   content version, allowed subjects, limits, and question selection. It sends
   only public question fields; correct indexes and explanations are removed.
2. The active v3 session is split across:
   - `/studentDrills/{studentId}/{sessionId}`: server-owned session/config and
     the selected active question payload needed by current grading contracts;
   - `/studentDrillMetadata/{studentId}/{sessionId}`: owner, status, bootcamp,
     question IDs, and timer limits used for cheap autosave authorization;
   - `/studentDrillProgress/{studentId}/{sessionId}`: attempt-only progress
     plus hashed per-client monotonic sequence state.
3. `QuestionRunner.tsx` maintains answers, bookmarks, flags, timing, and current
   position locally. It accumulates only changed keys, sends nothing for a
   no-op, saves at most every 45 seconds, and flushes on navigation, pause,
   visibility loss, page hide, and submission. Failed patches are merged back
   into the dirty set. Submission always sends the complete current attempt,
   so it does not depend on a preceding autosave completing.
4. `saveStudentDrillProgressHttps` reads the small UID mapping and metadata,
   validates ownership/status/question IDs/timers/allowed fields and a 64 KiB
   progress limit, then atomically checks the client sequence and merges only
   supplied dirty fields in the lightweight progress node. It does not read
   the active question payload. The model conservatively charges each
   transaction as a full end-of-drill progress-node read/write.
   A legacy session without metadata is read once and split lazily.
5. `submitStudentDrillHttps` reads the owned active session, sanitizes the full
   latest client attempt, grades only on the server, and transactionally claims
   submission. The durable v3 session replaces full questions with ordered
   `questionRefs` and stores only answer selection, correctness, timing, and
   bookmark/flag state in its result. Progress/sequence nodes are cleared.
6. Compact `/users/{studentId}/statsIndex/{sessionId}` and
   `/users/{studentId}/stats/{sessionId}` rows power history and analytics.
   Challenge completion and educator assignment release/summary paths are
   updated after the submission claim. Existing point, streak, entitlement,
   release-date, and duplicate-submission behavior remains in place.
7. Result/review endpoints join a v3 attempt to the exact
   `bootcamp + datasetVersion + correctionRevision` content pack. Current and
   archived content packs are supported. Legacy v2 sessions/results remain
   self-contained and bypass hydration. Unreleased assignment corrections do
   not load or return archived answer content.
8. The native app keeps its local-first/offline pack behavior. Pinned versions
   and correction revisions select either bundled/current data or immutable
   archived packs. Its existing offline submission schema remains accepted;
   the web normalization does not invalidate queued native attempts. Current
   history sync sends only unsynced session IDs because the server deliberately
   ignores client-computed snapshot JSON and trusts its own graded record.
   The endpoint retains a bounded 8 MiB compatibility allowance for released
   clients that still upload up to 50 complete local snapshots.

RTDB client rules remain deny-all. All of these paths are accessed through
authenticated HTTPS Functions/Admin SDK code; the revised rule files add only
query indexes and do not expose question or answer material.

## Pricing implementation

- `lib/billing/catalog.ts` is the authoritative website display catalog:
  monthly 599 cents and annual 4,999 cents.
- `functions/handlers/_billingCatalog.js` is the server product catalog. Its
  exact ACT/SAT and monthly/annual environment keys prevent cross-bootcamp or
  cross-cadence substitution in Checkout.
- The Store catalog has exact Apple product IDs and Google product/base-plan
  pairs. Existing entitlement validation still requires the matching
  bootcamp; the correction changes no entitlement record and performs no
  subscriber migration.
- Native `StoreProductCatalog.js` centralizes identifiers. StoreKit/Google Play
  returned localized metadata remains authoritative in QML. When unavailable,
  the UI says the price is available in the store instead of inventing a USD
  price.
- Educator pricing and unrelated products were not changed.

The code-side price correction is complete. The new-customer price is not
fully operational until the four Stripe environment variables reference
Prices configured at $5.99/$49.99 and App Store Connect/Google Play have the
matching store prices. See `COST_RELIABILITY_CONSOLE_STEPS.md`.

## Scheduled and broad-read audit

| Job | Verified current read pattern | Result of this pass |
| --- | --- | --- |
| `reconcileStripeSubscriptions` | Previously loaded the complete subscription index, then used only the first 1,000 rows | Now reads up to ten resumable 100-row key-ordered pages and rotates a checkpoint, preserving the 1,000/run ceiling without downloading the root |
| `aggregateUnitPoints` | Hourly full `/units/corps` and `/users` reads | Deferred: replace with points/membership event projections and a repair backfill before removing the authoritative scan |
| `cleanupExpiredChallenges` | Hourly `expiresAt <= now` queries include all historically expired challenges/keys; participant inbox rows are read per due open challenge | Deferred: add a dedicated due/open queue and retention policy first; limiting the existing query can starve open rows behind old expired rows |
| `closeExpiredEducatorDrills` | Every four hours downloads all `/schools` | Deferred: maintain `/educatorDrillsDue/{dueBucket}/...` on publish/reschedule and process bounded buckets, with an idempotent repair job |

The revised RTDB rules add indexes for user UID lookup, stats timestamps,
challenge expiry, challenge-key expiry, and Stripe ownership. Index deployment
is a separate reviewed console/CLI action.

## Abuse and reliability controls

- A shared 1 MiB HTTP body limit rejects oversized JSON/raw requests early;
  progress has a stricter 64 KiB semantic limit. Native history sync alone has
  a bounded 8 MiB old-client override; the current client sends IDs only.
- Additional public HTTPS exports now use the repository's bounded instance
  options. Provider webhooks retain signature verification.
- Web App Check token support and server verification are implemented behind
  `APP_CHECK_ENFORCEMENT`. Enforcement must remain disabled until native iOS
  and Android token integration ships, or legitimate mobile traffic will fail.
- Development-only autosave logs report approximate read/write byte counts and
  schema mode only. They do not log student IDs, answers, auth tokens, or PII.
- Per-session client sequence state is capped at 16 hashed clients so repeated
  arbitrary client identifiers cannot grow the progress record without bound.
- A pre-existing `minInstances: 1` on the store purchase-context function was
  preserved because it belongs to unrelated in-progress work. Review its idle
  cost against measured latency before changing it.

## Compatibility and migration

No production migration is required for this phase and none was run. New web,
assignment, and challenge active sessions use split progress storage. Legacy
active sessions are recognized and receive metadata/progress lazily on their
first save. Legacy submitted results render from their embedded snapshot. New
v3 results hydrate from the pinned immutable content version.

The critical retention invariant is that every referenced dataset/correction
archive must remain available for as long as historical review is promised.
Content archives should never be overwritten in place. If future cleanup or a
full historical conversion is desired, build a separately reviewed,
idempotent, dry-run, batched, resumable migration and validate every referenced
question before deleting embedded content.

## Deferred storage work and risks

- Active sessions still retain selected full questions until submission. This
  avoids a high-risk grading contract rewrite; completed v3 sessions are the
  measured storage win.
- Educator attempt detail currently retains both `answers` and `snapshot`, and
  native offline submissions retain their legacy full snapshots. Normalize
  those only after every educator/native review consumer supports pinned-pack
  hydration.
- A page-hide HTTP flush is best effort. The ordinary recovery window is now
  up to 45 seconds, mitigated by transition flushes; submission carries the
  complete live state.
- Per-client sequencing prevents retries/out-of-order writes from one runner.
  Concurrent tabs have distinct clients and therefore merge dirty child keys;
  whichever tab last edits the same key wins. A true single-session lease is a
  future product decision.
- App Check is prepared but not enforced, so billing abuse remains only
  partially mitigated until supported native releases propagate.
- The due-index/event-projection work above remains the principal scheduled
  download opportunity.

## Local validation

- Website TypeScript: `npx tsc --noEmit`
- Website production build: `npm run build`
- Functions lint: `npm run lint`
- Focused Node tests cover pricing/product boundaries, entitlement continuity,
  dirty/no-op progress, malformed/oversized progress, unknown IDs, legacy
  compatibility, stale and concurrent sequencing, and submission using the
  latest local answers. This focused set passes 71/71.
- Native catalog assertions: `node scripts/test-store-pricing-catalog.js`
- RTDB emulator validation could not run on this machine because Java is not
  installed. Native compilation could not run because CMake is unavailable.
- After correcting the stale-review vulnerability, the full Functions suite
  runs 239 tests: 238 pass and one is skipped when the ignored
  `.content-packs` build output is absent. The content-pack assertion still
  runs whenever the generated artifact exists. The academic gate now passes
  with all 24 current questions bound to their exact content fingerprints.

## Follow-up diff review findings

A line-by-line follow-up review found and corrected four reliability hazards
in this broad change:

1. Lazy conversion of a legacy active session used non-transactional writes
   that could replace progress saved concurrently. Metadata and initial
   progress now use create-if-absent transactions.
2. A submission could be durably claimed before metadata/progress cleanup; a
   retry previously returned the result without repairing that secondary
   state. Duplicate submission paths now reconcile submitted metadata and
   clear obsolete progress/sequence data idempotently.
3. A page-hide flush could queue behind an ordinary fetch that the browser then
   canceled. Keepalive flushes now supersede the pending request with its
   in-flight changes merged with newer dirty changes.
4. The shared 1 MiB body boundary could reject released native history clients
   that upload full local snapshots. The current native client now sends only
   IDs, while that single endpoint has the bounded compatibility override
   described above.
5. Google Play product loading could display one promotional offer but purchase
   another offer token for the same base plan. Both paths now prefer the base
   plan itself, with the same deterministic fallback when only offers exist.

The subsequent academic-gate review found that `legacyId` values were
positional and had been reused after the banks changed. The review fixture has
now been fully regenerated from the supplied independent judgments, and the
gate verifies exact dataset versions plus SHA-256 fingerprints covering all
academically meaningful fields. See `question-reviews/ACADEMIC_PILOT_V1.md`
for the root cause and stable immutable-ID recommendation.

## Recommended commits

1. `fix(billing): centralize student prices and product identifiers`
2. `feat(drills): split and sequence dirty web progress autosaves`
3. `feat(drills): compact completed results with pinned content hydration`
4. `chore(firebase): add indexes, request caps, and App Check preparation`
5. `perf(functions): paginate Stripe reconciliation`
6. `test(docs): add cost measurements, compatibility tests, and operator steps`

Because both worktrees contained unrelated edits before this pass, stage these
commits by explicit path/hunk and review overlaps in the billing/bootstrap,
Functions index, and native subscription files. Do not use a blanket add.
