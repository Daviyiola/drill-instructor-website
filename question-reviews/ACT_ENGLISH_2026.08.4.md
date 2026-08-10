# ACT English academic review

The complete 100-question ACT English bank was reviewed in five internal
batches of 20 questions. Each item was evaluated against its full passage,
underlined context, answer choices, configured key, and explanation. The four
approved corrections were subsequently applied to ACT dataset `2026.08.5`.

## Outcome

- 97 questions have one defensible configured answer without a material
  answer-choice defect.
- Question 8 is invalid because the sentence proposed for deletion is relevant
  to the paragraph, but no answer choice gives that defensible rationale.
- Questions 35 and 74 are ambiguous because two choices are logically
  defensible in their current contexts.
- Question 79 has the intended best answer, but that replacement nearly repeats
  the preceding sentence and should be rewritten before release.
- The remaining 97 explanations adequately support their configured answers. The
  three ambiguous/invalid explanations overstate the uniqueness of their keys.
- The deterministic audit found 0 English errors.
- One non-functional outer-whitespace warning remains in option 2 of Question
  85. It does not affect display, meaning, or grading and may be removed during
  the broader formatting cleanup.
- The passages and explanations use supported portable rich-text markup and
  remain candidates for the planned markup normalization pass.

## Applied corrections

| Question | Finding | Applied correction |
| --- | --- | --- |
| 8 | The paragraph concerns participant errors **and procedures that make the collection dependable**. Keeping seed packets at a controlled temperature is one such procedure, so deleting the sentence as a distraction is not defensible. None of the previous “No” choices stated the relevant rationale. | Replaced option 2 with “No, because the storage condition is another procedure intended to protect the returned seeds' viability,” keyed that option, and rewrote the explanation around the paragraph's safeguards. |
| 35 | Both “but” and “so” can logically join the clauses: the readability objection can contrast with the detailed design, or arise because its narrow detail would be hard to see. | Retain “but” as the key and replace the “so” choice with “because several residents argued that the narrow lines would be difficult to see from passing buses,” which reverses the intended dependency and is unambiguously incorrect. |
| 74 | The diagram-label sentence works naturally both before the mechanism is described (Point A) and after the motions are described (Point B). The explanation's preference for Point B does not invalidate Point A. | Change the proposed sentence to “A nearby exhibition diagram identified those moving parts as the feed lever, cutting arm, and return spring.” The phrase “those moving parts” then requires placement at Point B. Retain Point B as the key and update the explanation. |
| 79 | The keyed replacement repeats the immediately preceding claim that the documentary turned a private collection into a resource for studying neighborhood change. | Replace it with a nonredundant sentence such as “By introducing the recordings through broadcasts, classroom copies, and archive programs, the documentary gave residents several ways to use Mercer's record of neighborhood change.” Retain the current key. |

## Review coverage

The review covered all thirteen current English modules:

- Sentence Structure
- Conciseness and Redundancy
- Punctuation
- Word Choice and Diction
- Transitions and Logical Relationships
- Pronouns
- Organization and Cohesion
- Topic Development
- Modifiers and Comparisons
- Verb Tense and Form
- Idioms and Prepositions
- Style and Tone
- Subject-Verb Agreement

The structured artifact `act-english-review-progress.json` contains the full
100-answer review record and all four findings. There are no missing questions.
Because the configured keys were visible during the initial consistency pass,
this record should not be represented as a separately blinded second-reviewer
certification; the subsequent pass deliberately challenged the rhetoric and
organization items for competing defensible answers.
All four proposals have been applied to `functions/data/actData.js`. ACT
dataset `2026.08.5` has been built locally but has not been published,
activated, or deployed.
