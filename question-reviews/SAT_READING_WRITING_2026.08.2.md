# SAT Reading and Writing academic review

The full 120-question SAT Reading and Writing bank was reviewed in six internal
batches of 20. Each item was solved without first consulting its configured
answer or explanation. The approved corrections were subsequently applied to
SAT dataset `2026.08.3`.

## Outcome

- 113 configured answers are defensible.
- 5 configured answers are wrong or belong to an invalid item.
- 1 item is ambiguous because two options are equivalent.
- 1 item is not verifiable from the information provided.
- 17 otherwise-correct questions have explanations that cite the wrong option
  number. Some of those explanations explicitly reject the actual correct
  option, so they should be treated as incorrect rather than cosmetic typos.
- Every question contains portable but legacy HTML markup, primarily `<br>` in
  explanations. It renders, but all 120 remain formatting-cleanup candidates.

## Release-blocking academic defects

| Question | Finding | Recommended correction |
| --- | --- | --- |
| 25 | No grammatically valid option; `However` leaves a comma splice. | Replace the keyed option with `Although`. |
| 27 | The keyed completion creates `it it emphasized`. | Remove the extra `it` from the stem. |
| 28 | The completion question has no blank. | Rewrite the stem so `immersed in` has an insertion point. |
| 86 | The key says `In contrast`; the passage and its own explanation require `Specifically`. | Change the key to `Specifically`. |
| 101 | `For instance` and `For example` are equivalent; the explanation names an option that does not exist. | Replace one duplicate transition and rewrite the explanation. |
| 108 | The sentence requires possessive `argument’s`, not `argument`. | Change the key and explanation. |
| 111 | The claimed effect of unspecified “neural signaling” cannot be derived from the prompt. | Add the experimental observation needed to infer `hesitantly`. |

## Explanation-only defects

Questions 11, 15, 16, 17, 23, 26, 34, 52, 54, 55, 66, 87, 91, 99, 105,
114, and 118 have correct stored answer text but incorrect option numbering in
their explanations. The safest correction is to remove numbered references and
name the answer text directly, which also makes explanations resilient if
options are reordered later.

## Non-blocking wording polish

- Question 37 repeats `convinced` in both the setup and answer; `persuaded` is
  cleaner.
- Question 75 uses the disputed construction `comprised of`; `composed of`
  avoids a needless usage issue.
- Question 103 should hyphenate `energy-producing`.

The structured independent answers, verdict defaults, exceptions, and proposed
changes are in `sat-reading-writing-2026.08.2.json`. The proposals have been
applied to `functions/data/satData.js`; the resulting `2026.08.3` pack has been
built and validated locally but has not been published or deployed.
