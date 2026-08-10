# ACT Science academic review

The complete 168-question ACT Science bank was reviewed in nine internal
batches of 20 or fewer questions. Each item was evaluated against its passage,
visual data, answer choices, configured key, and explanation.

## Outcome

- All 168 questions have a correct configured answer.
- All 168 questions have one unique correct choice.
- All 168 explanations adequately support the configured answer.
- No scientifically invalid, ambiguous, or ungradable items were found.
- No answer-key, option, prompt, or explanation corrections are required.
- The deterministic audit found 0 errors across ACT.
- Science has 18 minor outer-whitespace warnings, affecting the shared passage
  text for Questions 121-126 and 139-150. These do not affect rendering,
  grading, or meaning and may be cleaned up with the broader formatting pass.
- All Science passages and explanations contain supported portable rich-text
  markup and remain candidates for the planned markup normalization pass.

## Review coverage

The review covered all six Science modules:

- Data Representation
- Data Analysis and Trends
- Experimental Design
- Scientific Conclusions and Predictions
- Conflicting Viewpoints
- Research Summaries

It also checked every referenced Science visual for a valid asset reference.
The structured artifact `act-science-review-progress.json` contains the full
168-answer review record. There are no missing answers or academic
findings. Because no content correction is required, ACT dataset `2026.08.4`
was not changed, rebuilt, published, activated, or deployed by this review.

## Adversarial second pass

After the English ambiguity review exposed the difference between a plausible
stored answer and a uniquely defensible one, Science received a separate
adversarial pass against the unchanged Science content in ACT dataset
`2026.08.5`. This was not represented as an independently blinded review,
because the configured keys were already known.

The second pass attempted to disprove every key, with extra attention to the 43
prediction/conclusion items, 13 experimental-design items, 9 conflicting-
viewpoint items, and all calculations derived from tables and figures. It found:

- No competing defensible answer.
- No unsupported interpolation or extrapolation.
- No experimental-variable or causal-language defect.
- No conflicting-viewpoint item whose evidence supports another choice.
- No key drift from the original 168-answer record.
- No duplicate normalized choices.
- No missing answer references in explanations.
- 28 internally consistent stimulus groups and no missing Science assets in the
  rebuilt ACT `2026.08.5` staging pack.

The original conclusion therefore stands: no Science content correction is
required.
