# ACT Answer-Choice Repair Report

Date: 2026-08-20

## Scope

- Repaired the existing ACT Reading bank and English Topic Development items.
- Replaced implausible or structurally weak distractors with passage-grounded alternatives.
- Preserved every correct-answer position and verified every configured answer key.
- Replaced `Additional reasoning step:` with the next numbered reasoning step.
- Added generation-time checks for severe answer-length leakage and repeated batch-level bias.

The length audit measures visible characters after removing supported HTML. It is a diagnostic, not a quality score: a correct answer may naturally be longest sometimes, but it should not be a dependable test-taking strategy.

## Before and after

| Area | Metric | Before | After |
|---|---:|---:|---:|
| Reading (288 questions) | Expected accuracy from always choosing a longest option | 89.6% | 27.7% |
| Reading | Correct answer uniquely longest | 88.9% | 26.7% |
| Reading | Expected accuracy from always choosing a shortest option | Not previously audited | 34.2% |
| Reading | Correct answer at least 10 characters longer | 215 | 35 |
| Reading | `Additional reasoning step:` labels | 100 | 0 |
| English, all modules (400 questions) | Expected accuracy from always choosing a longest option | 35.8% | 24.2% |
| English, all modules | Correct answer uniquely longest | 30.5% | 18.3% |
| English, all modules | Expected accuracy from always choosing a shortest option | Not previously audited | 32.6% |
| English Topic Development (89 questions) | Expected accuracy from always choosing a longest option | 88.2% | 36.0% |
| English Topic Development | Correct answer uniquely longest | 86.5% | 31.5% |
| English Topic Development | Correct answer at least 10 characters longer | 72 | 6 |

Mean English option lengths are now nearly equal: 47.6 visible characters for correct choices and 47.8 for distractors. Reading correct choices average 87.4 characters and distractors average 90.8. The first Reading practice test now has a balanced form-level distribution: 22.2% expected accuracy from the longest-choice strategy and 26.4% from the shortest-choice strategy.

## Editorial standard used

Distractors now target recognizable mistakes rather than merely being shorter or obviously false:

- a true detail with the wrong scope;
- an incomplete reading of the passage;
- a reversed causal relationship;
- an overstatement of qualified evidence;
- a relevant detail that does not serve the stated rhetorical purpose;
- a conclusion that is plausible but unsupported.

Options within a question are kept parallel in syntax, specificity, qualification, and visible length where the content permits. They are not padded with empty wording solely to equalize character counts.

## Reproducible checks

From `functions/`:

```text
npm.cmd run question:apply-option-repairs
npm.cmd run question:audit-options
npm.cmd run question:audit
npm.cmd run content:build
```

The primary repair manifest is `question-reviews/act-option-choice-repairs.json`; final form-level balancing is recorded in `question-reviews/act-reading-form-balance-repairs.json`. The apply command is idempotent and guards editorial edits with the exact question text.

## Verification

- Question-bank audit: 1,492 questions, 0 errors, 0 warnings.
- Content build: ACT and SAT artifacts built successfully.
- Functions lint: passed.
- Functions tests: 169 of 171 passed. The two failures are pre-existing/stale checks outside this repair: a DIRI monotonicity test and the academic-pilot snapshot whose selected IDs no longer match the current renumbered bank.
- No content pack was published and no Functions were deployed.
