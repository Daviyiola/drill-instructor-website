# Academic review pilot v1

The current blind pilot contains 24 questions: four from every current ACT/SAT
subject. The selection is repeatable through the `academic-pilot-v1` seed.

## Current outcome

All 24 independently determined answer indexes matched the configured answers.
The structured verdicts and question-specific notes are stored in
`academic-pilot-v1.json`. No proposed change has been applied to a production
question. The Math 166 note recommends a more precise module label, but the
review intentionally does not encode or apply that metadata change.

Every committed review is bound to the current question with a SHA-256 content
fingerprint. The fingerprint covers bootcamp, dataset version, subject, module,
practice test, prompt, passage, ordered options, configured answer and index,
explanation, and ordered image references. Any change to those fields requires
a new review even if the question retains the same `legacyId`.

## Root cause of the stale-review incident

`legacyId` is not immutable. The normalizer constructs it as
`subject + "#" + sourceId`, where `sourceId` is the numeric object key inside a
subject bank. The canonical `id` is derived from the same positional key. In
commit `d5edc9b`, the question banks were replaced extensively while those keys
were reused. The same commit changed the configured content versions from ACT
and SAT `2026.08.5` to ACT `2026.08.4` and SAT `2026.08.2`, while the committed
review metadata remained at ACT `2026.08.2` and SAT `2026.08.1`. The review file
was expanded from 20 to 24 records without regenerating the existing reviews.
The previous test compared only the ordered `legacyId` list, so reused IDs
silently inherited unrelated verdicts.

The gate now checks exact dataset versions, missing and duplicate records, and
the complete content fingerprint. A reused ID can no longer inherit approval.

## Stable-ID recommendation

Add an authored, immutable, globally unique question ID to each source record
and preserve it across reordering, module moves, and releases. Generate a new
ID whenever one question is replaced by a different academic item. Treat the
current positional IDs as compatibility aliases only. Release tooling should
reject missing/duplicate immutable IDs and require dataset versions to move
forward whenever academically meaningful content changes. Fingerprints should
remain the review gate even after stable IDs are introduced because legitimate
edits to an existing question still require renewed approval.

## Rubric calibration

- Review the blind prompt, passage, options, and references before opening the
  configured answer key.
- Exact string failures remain deterministic findings even when an academic
  answer is semantically correct.
- A concise explanation may still be `strong` when it is self-contained and
  fully establishes the answer.
- Proposed changes are review suggestions only and never mutate source banks
  automatically.
