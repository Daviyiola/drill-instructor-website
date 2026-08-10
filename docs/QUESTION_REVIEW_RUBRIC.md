# Academic question-review rubric

## Review order

Reviewers must use this order for every question:

1. Read the prompt, passage, options, and references without using the stored
   answer or explanation.
2. Solve the question independently and record an answer.
3. Compare the independent answer with the configured answer.
4. Read and assess the explanation.
5. Record confidence, wording, and formatting judgments.

This order reduces the chance that a plausible-looking stored answer biases the
independent solution.

## Answer verdict

- `correct`: one defensible answer exists and it matches the configured option.
- `incorrect`: one defensible answer exists and it does not match the configured
  option.
- `ambiguous`: multiple answers are defensible or necessary information is
  missing.
- `unverifiable`: the reviewer cannot verify the answer, usually because a
  reference is unavailable or specialist/source material is required.

## Explanation verdict

- `strong`: correct, self-contained, efficient, and teaches the relevant idea.
- `adequate`: correct and sufficient, with only optional improvements.
- `thin`: reaches the answer but skips reasoning a learner likely needs.
- `incorrect`: contains a false claim, invalid step, or contradicts the answer.
- `missing`: no meaningful explanation is present.

Steps are encouraged when they improve comprehension; they are not required for
a short verbal question that is clearer as one paragraph.

## Wording verdict

- `clear`: the prompt and options have one reasonable interpretation.
- `minor_edit`: meaning is recoverable, but grammar, notation, or phrasing
  should be polished.
- `ambiguous`: wording permits materially different interpretations.
- `invalid`: the stated information is impossible or cannot produce a valid
  option.

## Formatting verdict

- `clean`: readable with the current portable renderer.
- `cleanup`: readable, but legacy markup or notation should be normalized.
- `blocking`: formatting changes the meaning or prevents solving.

## Confidence

- `high`: independently solved or directly supported by the supplied passage.
- `medium`: the answer is likely, but one interpretive or rendering assumption
  remains.
- `low`: specialist verification, a better reference, or a second reviewer is
  required.

## Proposed changes

Review records may propose changes to the prompt, options, answer, explanation,
passage, or images. They must never edit production data automatically. Changes
are applied only after approval through the normal dataset or correction-release
workflow.
