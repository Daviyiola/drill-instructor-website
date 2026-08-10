# Academic review pilot v1

The first blind pilot reviewed 20 questions: four from every current ACT/SAT
subject. All five deterministic-error questions were included. The selection is
repeatable through the `academic-pilot-v1` seed.

## Outcome

- 16 questions have academically correct configured answers.
- 2 ACT Mathematics questions have correct mathematics but duplicate correct
  options, making the multiple-choice item invalid.
- SAT Math 50 is invalid: `√(13/5)` cannot be a cosine, the explanation changes
  the expression to `√13/5`, and that corrected value is not an exact option.
- SAT Reading and Writing 25 has no grammatically valid option. `However` leaves
  a comma splice; the sentence requires a subordinating conjunction such as
  `Although`.
- SAT Math 166 and 171 are mathematically correct but fail the production exact
  answer match because hyphen-minus and Unicode minus are mixed.

## Rubric calibration

- Exact string failures stay in deterministic findings even when the academic
  answer is semantically correct.
- Duplicate correct options receive `ambiguous` answer and `invalid` wording
  verdicts.
- Impossible premises or no-valid-option questions receive `incorrect` answer
  and explanation verdicts plus `invalid` wording.
- Valid legacy markup receives `cleanup`; notation that changes the mathematics
  receives `blocking`.
- A concise explanation can be `adequate`; numbered steps are required only
  when they materially improve instruction.

The complete structured verdicts and proposed changes are stored in
`academic-pilot-v1.json`. No proposals have been applied to the source banks.
