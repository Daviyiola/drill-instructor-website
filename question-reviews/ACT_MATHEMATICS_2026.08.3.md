# ACT Mathematics academic review

The complete 370-question ACT Mathematics bank was reviewed in nineteen
internal batches of 20 or fewer questions. Every item was solved independently
before its configured answer and explanation were examined. The approved
corrections were subsequently applied to ACT dataset `2026.08.4`.

## Outcome

- 361 questions have a correct configured answer and no answer-choice defect.
- 2 questions have an incorrect configured key even though the correct option is present.
- 4 questions are invalid because the mathematically correct result is absent from the options.
- 3 questions are ambiguous because two options are mathematically equivalent.
- 4 explanations are mathematically incorrect while their configured keys are correct.
- 1 additional explanation contains a variable-name typo.
- All 370 questions still contain readable legacy HTML markup and remain formatting-cleanup candidates.

## Release-blocking answer and option defects

| Question | Finding | Recommended correction |
| --- | --- | --- |
| 33 | The system gives `x = 18/5`; the explanation agrees, but no option matches. | Replace option 0 (`6`) with `18/5` and retain option 0 as the key. |
| 34 | The system gives `x + y = 54/7`; the explanation agrees, but no option matches. | Replace option 2 (`6`) with `54/7` and retain option 2 as the key. |
| 72 | The required volume is `63 1/3 ft³`, so `79.166...` bags must be rounded up to 80. | Change the key from option 1 (`67`) to option 3 (`80`); the worked solution already reaches 80. |
| 147 | `2/5` and `6/15` are equivalent, producing two correct choices. | Replace option 2 (`6/15`) with a unique distractor such as `1/5`. |
| 150 | Options 0 and 2 simplify to the same expression. | Replace option 2 with a unique distractor such as `(5z² - 9z + 4)/z³`. |
| 241 | The diagram places `VW` between `VY` and `VZ`, making `∠WVZ = 90° - 52° = 38°`; the prompt and configured 142° conflict with the diagram. | Say that ray `VW` lies between rays `VY` and `VZ`, key option 3 (`38°`), and rewrite the explanation using subtraction. |
| 274 | Division gives `w = 14/5 - (8/5)i`; the explanation agrees, but no option matches. | Replace option 0's imaginary coefficient `-16/5` with `-8/5` and retain option 0 as the key. |
| 277 | The second and third choices are equivalent because `cos 145° = -cos 35°`. | Replace the second choice with a unique distractor, leaving the third choice as the unique correct answer. |
| 323 | The calculation gives `220/9 ≈ 24.44`, so 25 bags are required; 25 is absent and the configured answer is 28. | Replace option 1 (`28`) with `25`, retain option 1 as the key, and add the missing final answer sentence. |

## Explanation-only corrections

| Question | Finding | Recommended correction |
| --- | --- | --- |
| 21 | Step 1 says `d² = -6`; subtracting 9 actually gives `d² = -16`. | Correct Step 1 while retaining `4i`. |
| 67 | The explanation incorrectly halves the full outside-circle region below diagonal `QS`. | Use `(50 - 12.5π) + 12.5π = 50`; retain option 2. |
| 68 | The explanation incorrectly treats the shaded outside-circle region as `3/8` of all outside-circle area. | Use `(72 - 18π) + 9π = 72 - 9π ≈ 43.7`; retain option 3. |
| 339 | Step 2 says `b = 4` instead of `a = 4`. | Correct the variable name only. |

The structured artifact `act-math-review-progress.json` contains the complete
370-answer independent record and all thirteen findings. It has no missing
questions; its only non-null key disagreements are Questions 72 and 241, while
the seven null answers correspond exactly to the invalid or duplicate-choice
items listed above. The proposals have been applied to
`functions/data/actData.js`; dataset `2026.08.4` has been built locally but has
not been published, activated, or deployed.
