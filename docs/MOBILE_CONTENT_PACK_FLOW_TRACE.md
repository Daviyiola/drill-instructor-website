# Mobile Content-Pack Question Flow Trace

## Purpose

This document maps every current mobile path that creates, resolves, orders,
displays, persists, reviews, or reuses questions. It defines the seams for
adding downloadable JSON content packs without rewriting the question UI or
breaking solo drills, squad challenges, educator assignments, results,
reviews, and bookmarks.

The intended storage boundary is:

- Versioned JSON chunks contain an installed bootcamp question bank.
- SQLite stores installation metadata, bookmark snapshots, active-session
  checkpoints, completed result snapshots, and pending uploads.
- A session snapshot owns the exact questions and assets required after a
  drill starts.
- Cloud sessions continue to be server-owned and contain no answer keys while
  active.

## Canonical concepts

### Question identity

There are currently three related identifiers:

- Mobile legacy blueprint ID: `Subject#sourceId`.
- Server normalized ID: `subject_key_sourceId`.
- Dataset source ID: the original numeric/object key in `actData.js` or
  `satData.js`.

The server currently accepts legacy `#` and `::` IDs by extracting the final
source ID. A content pack must preserve all three explicitly. It must not
derive identity from question text because corrections would change the ID.

Recommended normalized pack fields:

```json
{
  "id": "mathematics_42",
  "legacyId": "Mathematics#42",
  "sourceId": "42",
  "subject": "Mathematics"
}
```

### Question display model

`Questions.qml`, `Review.qml`, and `DrillQuestionSelector.qml` expect a
flattened row with approximately these fields:

```text
questionId, sourceId/localQid, subject, module, practiceYear,
question, option1..option4, correctAnswer, explanation,
passage, imageSource, selectedOption, selectedAnswer
```

The pack reader should normalize into this shape once. Pages should not each
reconstruct it independently.

### Blueprint

A blueprint identifies an exact ordered paper:

```text
bootcamp
datasetVersion
subjects[]
  subject
  numQ
  timeLimitMin
  questionIds[]
  filters.practiceYearCsv
  filters.modulesCsv
```

Filters describe how a paper was built. `questionIds` are the authoritative
paper after selection and shuffling.

## Current entry paths

### 1. Solo drill — online

```text
Drills.qml
  -> serverDrillConfig()
  -> createStudentDrillHttps
  -> server buildPaper()
  -> server smartSelectQuestions()
  -> publicSession without keys/explanations
  -> Questions.qml(useCloudSession=true, questionMode=1)
  -> loadCloudDrillSession()
  -> saveStudentDrillProgressHttps
  -> submitStudentDrillHttps
  -> server grading and result snapshot
```

This path should remain unchanged by content packs. Installed packs are not a
reason to move an online drill back to client grading.

### 2. Solo drill — current bundled offline fallback

```text
Drills.qml
  -> selectionIsAvailableOffline() permits practice tests 1 and 2
  -> Questions.qml(useCloudSession=false, questionMode=1)
  -> BootcampModel.loadBootcampData()
  -> Qt.include(actData.js/satData.js)
  -> loadAllQuizQuestions()
  -> filter by subject, year, and module
  -> smartSelectQuestions()
  -> buildCurrentBlueprint()
  -> local answering and grading
  -> finalizeSessionCommit()
  -> best-effort uploadSessionSnapshot()
```

This is the primary content-pack replacement path. The pack implementation
should return the same selected paper shape that `Questions.qml` already
consumes.

Do not add JSON-file parsing, pack lookup, or asset-directory rules directly
to `Questions.qml`.

### 3. Squad challenge — creator

A challenge blueprint can originate from:

- A completed result in `Results.qml`.
- Selected corrections/bookmarks in `Review.qml`.
- A bookmark deck built in `Review.qml`.

The review pages build an exact blueprint from already hydrated question
snapshots. `createChallengeHttps` stores that blueprint and its ordered IDs.

Creating a challenge therefore should not require an installed pack. The
source result/bookmark already owns the question identity and payload needed
to create the blueprint.

### 4. Squad challenge — recipient

```text
SquadDrills.qml
  -> accept challenge
  -> createStudentChallengeSessionHttps
  -> server challengePaper() resolves blueprint IDs
  -> publicSession without keys/explanations
  -> Questions.qml(useCloudSession=true, questionMode=2)
  -> submitStudentDrillHttps
```

This currently requires connectivity to start and does not use the bundled
dataset on the recipient's device. A downloaded content pack is not required
for this path unless a later release explicitly supports starting a challenge
offline.

The server must retain every dataset version until no open challenge or
allowed pending submission can reference it.

### 5. Educator drill — construction

`DrillBuilder.qml` currently loads the bundled JS question bank directly. It:

- Builds subject/module/year configuration.
- Filters candidates.
- Performs stimulus-aware selection.
- Shuffles stimulus groups.
- Stores exact legacy question IDs in the blueprint.

`DrillQuestionSelector.qml` also loads the bundled JS directly. It:

- Resolves selected blueprint IDs.
- Builds an available candidate pool.
- Hydrates full question payloads for educator review.
- Adds/removes questions and rebuilds the blueprint.

Both pages must eventually use the shared question repository. They must not
each learn how to locate and parse pack files.

Educator construction is allowed to require connectivity when no matching
pack is installed. It can use a cloud catalog/question endpoint as a fallback.

### 6. Educator assignment — student

```text
SquadDrills.qml
  -> createStudentAssignmentSessionHttps
  -> server assignmentPaper() resolves exact blueprint IDs
  -> publicSession without keys/explanations
  -> Questions.qml(useCloudSession=true, questionMode=3)
  -> submitStudentDrillHttps
  -> server grading and release-policy enforcement
```

Assignments currently require connectivity to start. Once loaded, their
question payload is held in memory. Submission can be queued, but there is not
yet a durable active-session checkpoint containing the entire in-progress
paper.

To make “loaded online, completed offline” reliable across app restarts, the
session itself must be checkpointed locally when received and after material
progress changes.

### 7. Results and review

`Review.qml` has three independent sources:

1. `session_answers.question_payload_json` for locally persisted sessions.
2. A passed `currentSnapshot.answers[].questionPayload` for cloud/educator
   results.
3. `bookmark_payloads` for the bookmark experience.

Review should never reopen the current installed content pack to reconstruct
a completed paper. The result/session snapshot is the historical source of
truth. This prevents later corrections or pack deletion from rewriting what a
student originally saw.

Corrections released by the server are a separate result projection and may
deliberately provide corrected explanation/answer content.

### 8. Bookmarks

`bookmark_payloads` already stores full local question snapshots. The local
bookmark page loads these rows directly and does not need the question bank.

Cloud bookmark records should remain lightweight pointers for cross-device
restoration. When online, the app can hydrate a pointer from the matching
versioned server bank and store the resulting payload in SQLite.

An image used by a bookmark must be copied into bookmark-owned asset storage
or retained by an asset reference. Deleting a pack must not break a bookmark.

## Selection and ordering rules that must be preserved

The same stimulus-aware algorithm exists in three places:

- Mobile solo fallback in `Questions.qml`.
- Educator auto-generation in `DrillBuilder.qml`.
- Server solo generation in `_studentDrill.js`.

Its behavior is:

1. Filter candidates by subject, practice test, and module.
2. Group questions sharing a passage or image.
3. Treat questions without a shared stimulus independently.
4. Shuffle groups, not questions inside a group.
5. If the final group does not fit, select a consecutive window.
6. Preserve the resulting order in the blueprint.

This algorithm should be moved into one shared mobile JavaScript module for
offline/educator generation. Server tests should use identical deterministic
fixtures to prevent behavior drift.

For resume and challenge equality, selection randomness happens only when the
paper is first built. Resuming always uses the stored ordered question IDs.

## Shuffling ownership

- Online solo: server selects and orders the paper.
- Offline solo: local pack service selects and orders it once.
- Squad challenge: creator blueprint order is authoritative.
- Assignment: educator blueprint selects questions; per-student question
  shuffling is applied once when the session is created or first loaded.
- Review/results/bookmarks: never reshuffle unless the student explicitly
  activates flashcard shuffle; that shuffle is presentation-only.

The educator `shuffleOptions` setting is currently persisted but is not
applied by the mobile question runner. This is deliberately deferred because
it is not required for the content-pack or offline-practice release. If it is
implemented later, the per-session option permutation must be stored so
resume, grading, review, and server submission agree on selected indices.

## Persistence findings

### Existing strengths

- Final local sessions store question snapshots in
  `session_answers.question_payload_json`.
- Cloud result snapshots can be cached in `session_snapshots`.
- Bookmark payloads are independent of the question bank.
- Failed educator submissions are stored in
  `pending_educator_drill_submissions`.
- Cloud answers are keyed by stable server question ID.

### Decision: one active drill per device

The local fallback persists its full paper only during final submission.
Closing the app during an in-progress local drill does not currently guarantee
that the paper, ordering, selected answers, timers, flags, and asset references
can be restored.

The mobile app will permit one active drill at a time across solo, squad, and
educator-assignment modes. This is a device-local invariant rather than one
active drill per bootcamp.

The active drill should use a singleton SQLite row with two distinct payloads:

- `paper_json`: the immutable canonical session/paper written once when the
  drill starts.
- `progress_json`: the small mutable answer, timing, navigation, bookmark, and
  flag state updated throughout the drill.

Keeping these separate prevents every answer from rewriting the complete
question paper. An associated session-cache directory owns any images needed
by that active paper.

A new active-session checkpoint should contain:

```text
sessionId
source: bundled | pack | cloud
mode: solo | challenge | assignment
bootcamp
datasetVersion
correctionRevision
ordered question snapshots
answer map
bookmark/flag map
question timing
subject timers
current question ID
created/updated timestamps
submission state
```

Checkpoint writes should be debounced and transactional.

Recommended table shape:

```text
active_drill
  singleton_id = 1
  session_id
  bootcamp
  mode
  transport
  dataset_version
  correction_revision
  paper_json
  progress_json
  asset_directory
  status
  created_at
  updated_at
```

The single row can be replaced only after the current drill has been
submitted, durably queued, or explicitly discarded.

### Active-drill navigation behavior

- Pressing the normal Drills icon while an active drill exists resumes it
  immediately instead of opening the drill builder.
- Resuming restores the exact question order, current question, selected
  answers, flags, bookmarks, per-question timing, and subject timers.
- Starting a squad challenge or educator assignment while another drill is
  active shows a choice to resume the current drill, cancel, or discard it and
  start the selected activity.
- An active drill from another bootcamp still resumes because the invariant is
  device-wide. The app restores that drill's bootcamp context before opening
  the question runner.
- Discarding requires confirmation and removes the active row and its
  session-cache assets.
- Successful submission clears the active row only after the result or pending
  upload has been stored durably.
- A failed online submission leaves either the active row in a retryable
  `submission_pending` state or transfers it atomically to a generic pending
  submission queue before allowing another drill.

Progress should be checkpointed after answer changes, bookmark/flag changes,
subject changes, and material timer changes, as well as when the application
moves to an inactive/background state. Frequent events should update only
`progress_json` through a short debounce.

## Asset ownership

Question payloads store an `imageSource`, but ownership is currently implicit.
Pack deletion therefore needs an explicit asset boundary.

At session creation:

1. Snapshot every selected question.
2. Copy only referenced local pack images into
   `session-cache/{sessionId}/`.
3. Rewrite the session's image references to its cache paths.
4. Persist the session checkpoint.

At bookmark creation:

1. Persist the full bookmark payload.
2. Copy referenced images into bookmark-owned storage, preferably keyed by
   content hash.

At pack deletion:

- Hide the pack immediately from new offline drill creation.
- Remove its JSON chunks and unowned image directory.
- Retain session and bookmark assets.
- Clear session assets only after the result is safely synchronized or the
  session is explicitly discarded.

Question and review pages currently contain separate image-resolution logic.
This must become one resolver supporting:

```text
https/http URL
qrc bundled asset
installed pack asset
session-cache asset
bookmark asset
```

## Shared mobile seam

Introduce one content repository/service with an asynchronous API. The exact
QML implementation can be a singleton/service object backed by small JS
helpers, but pages should depend only on these operations:

```text
getCatalog(bootcamp)
getInstalledPack(bootcamp)
buildLocalPaper(bootcamp, config)
hydrateBlueprint(bootcamp, datasetVersion, questionIds)
getQuestion(bootcamp, datasetVersion, questionId)
resolveAsset(questionOrSnapshot, assetPath)
```

`buildLocalPaper` should return a canonical local session rather than a raw
dataset array. This allows the main runner to converge on one entry contract:

```text
Questions.qml(session=<canonical session>, transport=cloud|local)
```

The transport controls saving/submission behavior. It should replace the
current overloaded `useCloudSession` boolean gradually.

## Safe implementation order

1. Extract pure question normalization, stimulus grouping, selection, and ID
   helpers without changing current behavior.
2. Add regression fixtures comparing mobile and server paper generation.
3. Add canonical session serialization, the singleton active-drill table, and
   route guards/resume navigation.
4. Centralize question image/asset resolution.
5. Generate versioned JSON manifests/chunks from the existing JS source.
6. Add pack download, verification, atomic installation, and deletion.
7. Change only the solo offline fallback to use `buildLocalPaper`.
8. Move educator builder and selector dataset access to the repository.
9. Add bookmark/session asset ownership and cleanup.
10. Add correction overlays after the base versioned pack lifecycle is stable.

Cloud solo, squad, and assignment session endpoints should remain operational
throughout this sequence.

## Regression checklist

### Paper generation

- Subject, module, and practice-test filters produce the same candidates.
- Requested question limits are respected.
- Passage/image groups remain consecutive.
- Blueprint question order exactly matches displayed order.
- Stable IDs survive corrections and pack updates.

### Solo

- Online drill creation and server grading remain unchanged.
- Bundled tests 1 and 2 remain available without a downloaded pack.
- Downloaded packs unlock their available practice tests offline.
- Offline submission queues and later grades against the pinned dataset.
- App restart restores the exact paper, answers, timers, flags, and position.

### Squad

- Result and bookmark challenges preserve exact IDs and ordering.
- Recipients receive the same paper.
- Cloud images/passages still resolve without an installed pack.
- Expired and completed challenges remain unaffected by pack cleanup.

### Educator

- Auto-generated assignment blueprint matches current filtering behavior.
- Manual question selector resolves selected and available pools.
- Student sessions never expose answer keys before submission.
- Question shuffle is stable across resume.
- Option shuffle is deferred; if introduced later, it stores a stable
  permutation.
- Pending assignment submissions survive restart and pack deletion.

### Review and bookmarks

- Completed review renders from its snapshot, not the latest pack.
- Bookmark payloads remain usable after pack deletion.
- Bookmark and session images remain available while offline.
- Explicit flashcard shuffle changes presentation order and displayed index.

### Content lifecycle

- Interrupted download never replaces a valid installed pack.
- Checksums are verified before activation.
- Manual update can override Wi-Fi-only automatic update policy.
- Deleting a pack immediately prevents new offline drills from using it.
- Active session and bookmark assets are not deleted.
- Old server dataset versions remain gradeable while submissions may be
  pending.
