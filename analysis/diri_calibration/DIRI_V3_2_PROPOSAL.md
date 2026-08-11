# DIRI 3.2 launch calculation

## Decision

DIRI should remain a 90-day **estimated readiness** signal, but accuracy must anchor
the score. Consistency and breadth should confirm that performance is repeatable;
they should not be able to rescue weak performance. Timing should only apply a
small penalty for sustained slow pacing and should never add points.

This proposal uses only fields already present in canonical analytics attempts:
correct, attempted, active time, submission date, subject/module rows, session
count, and practice-test identifiers. The catalog supplies available subjects,
modules, and practice tests. A fixed subject timing table supplies official pacing
targets instead of using the timer selected by the student or educator.

## Eligibility and evidence

- Window: trailing 90 days.
- Overall DIRI: at least 100 graded attempts.
- Focused-subject DIRI: at least 60 graded attempts in that subject.
- Pending assignments may contribute activity and breadth but not mastery.
- Evidence ceiling:
  - Overall: 80 at 100 attempts, rising linearly to 100 at 400 attempts.
  - Focused subject: 80 at 60 attempts, rising linearly to 100 at 240 attempts.
- Confidence remains separate from score and combines attempts, active weeks, and
  breadth. Even perfect performance on only 100 questions is capped at 80.

## Declared exam subjects

Overall DIRI is evaluated against the student's server-owned subject preference
for that bootcamp, rather than every possible catalog subject. ACT accepts three
or four available subjects; SAT uses its complete two-subject catalog. A student
who has not configured a preference defaults conservatively to every currently
available catalog subject.

The declared subject set also filters the overall Suggested Practice list. A
focused-subject analytics view still calculates a separate one-subject DIRI.
Changing the declaration does not rewrite attempts; it changes which subject rows
are included in the next calculation.

Evidence floors prevent a selected but unpracticed subject from being hidden:

- DIRI 85+ requires at least 20 graded attempts in every declared subject.
- DIRI 90+ requires at least 40 graded attempts in every declared subject.
- Attempts from unselected subjects do not increase overall DIRI evidence,
  consistency, coverage, or mastery.

## Pillar 1: Mastery

Mastery is the primary signal.

1. Weight graded questions by recency using a 45-day half-life.
2. Calculate recency-weighted overall accuracy.
3. Calculate recency-weighted accuracy for each subject with at least 20 attempts
   (10 for a focused-subject DIRI).
4. Let the subject floor be the weakest eligible subject.

```text
Mastery = 80% × weighted overall accuracy
        + 20% × weakest meaningful subject accuracy
```

This prevents a very strong subject from completely concealing a weak subject.
It still avoids using unstable five-question module percentages as a major score
input.

## Pillar 2: Consistency

Volume is evidence, not consistency. Consistency should measure calendar spread.

```text
Active-week score = min(active weeks / 10, 1) × 100
Active-day score  = min(active days / 24, 1) × 100
Freshness score   = 100 × 0.5 ^ (days since latest practice / 14)

Consistency = 50% × active-week score
            + 30% × active-day score
            + 20% × freshness score
```

Ten active weeks means the learner practiced during most of the 90-day window.
Twenty-four active days remains an excellent target, but it cannot compensate for
cramming because active weeks carry more weight.

## Pillar 3: Breadth

Breadth remains progressive, but is calculated within each subject before the
results are combined.

- Required subjects: one additional subject per 40 total attempts, capped by the
  bootcamp catalog. A subject is meaningful after 10 attempts.
- Required modules: one additional module per 25 attempts in that subject. A
  module is meaningful after five attempts.
- Required practice tests: one additional practice test per five sessions in that
  subject, capped by the catalog.
- Calculate module and practice-test completion ratios separately for each
  meaningful subject, cap each subject at 100%, then average the subject ratios.

```text
Breadth = subject-coverage ratio
        × (45% base subject breadth
           + 35% mean within-subject module breadth
           + 20% mean within-subject practice-test breadth)
```

Multiplying by subject coverage prevents extra English breadth from compensating
for narrow Mathematics or Science practice.

## Timing guardrail

Timing does not add points. It subtracts at most five points using the learner's
actual active time against fixed exam-derived subject targets.

- At or below 115% of target pace: no penalty.
- 115%–150%: linear penalty from zero to three points.
- 150%–200%: linear penalty from three to five points.
- Above 200%: five-point maximum penalty.

The target table in the prototype uses ACT English 42 seconds/question, ACT Math
66.7, ACT Science 60, SAT Reading and Writing 71.1, and SAT Math 95.5. Before
production, extended-time accommodations need an explicit policy; otherwise the
timing penalty should be disabled for accommodated learners.

## Composite and non-compensation rules

```text
Weighted composite = 65% × Mastery
                   + 20% × Consistency
                   + 15% × Breadth

Anchored composite = min(weighted composite, Mastery + 5)

DIRI = min(anchored composite − pacing penalty, evidence ceiling)
```

Minimum floors prevent one excellent pillar from concealing a material weakness:

- Ready (85+) requires Mastery at least 80, Consistency at least 50, and Breadth
  at least 60, plus 20 attempts in every declared subject.
- DIRI 90+ requires Mastery at least 88, Consistency at least 80, Breadth at least
  80, at least 300 overall attempts (180 for a focused-subject score), and 40
  attempts in every declared subject.

The API should return the active limiting constraints so the UI can explain why a
score is capped instead of presenting a mysterious plateau.

## Stress-test results

| Hypothetical account | Proposed DIRI | Interpretation |
|---|---:|---|
| 90% accuracy, 300 questions, 15 consecutive days | 84.3 | Almost; practice is concentrated into three weeks |
| 90% accuracy, 300 questions, 15 days distributed across the window | 91.5 | High estimated readiness |
| 90% accuracy, 400 questions, 20 distributed days | 92.1 | High estimated readiness |
| 85% accuracy, 500 questions, excellent consistency/breadth | 89.5 | Ready, but below the 90 threshold |
| 90% accuracy, 500 questions crammed into one day | 78.6 | Not Ready |
| 90% accuracy, strong work but latest practice 60 days ago | 83.5 | Almost; stale evidence |
| 90% accuracy, one module/test per subject | 84.9 | Capped below Ready for narrow breadth |
| 90% accuracy confined to one of several declared ACT subjects | Below 85 | Missing declared-subject evidence prevents Ready |
| 95%/95%/60% across ACT subjects | 83.7 | Weak subject prevents Ready |
| 100% accuracy, 100 questions across five weeks | 80.0 maximum | Evidence is not mature enough for Ready |
| 70% accuracy, 600 questions, perfect consistency/breadth | 75.2 | Cannot be inflated to high readiness |
| 90% accuracy, excellent evidence, more than 2× target time | 88.5 | Ready with maximum pacing penalty |

All prototype checks passed: score bounds, minimum-evidence gating, accuracy
monotonicity, reward for distributed practice, cramming rejection, stale-practice
rejection, and prevention of a 90 score from weak accuracy.

## What a 90 now entails

A typical route to 90 is approximately:

- At least 88% recency-weighted mastery with no materially weak subject.
- At least 300 graded questions.
- Practice distributed across roughly 10 active weeks.
- Around 15–20 active days, depending on accuracy and breadth.
- At least 80 breadth, including appropriate module and practice-test variety in
  every included subject.
- Recent practice and pacing reasonably close to official timing.

Fifteen days can still be enough when they are distributed across the 90-day
window. Fifteen consecutive days are deliberately not equivalent.

## Important limitations

- This is internally calibrated against logical behavior, not real exam outcomes.
- Question difficulty is not calibrated. SAT raw accuracy is especially limited
  because the official digital SAT uses adaptive modules and item-response methods.
- The score should not be marketed as an official ACT/SAT score prediction.
- Thresholds should be re-estimated once there are enough consenting learners with
  practice histories and official outcomes.
- Monitor score distributions by bootcamp, subject, accommodation status, source,
  and dataset version before changing public bands.

## Launch implementation

DIRI 3.2 is the sole displayed launch calculation. DIRI 3.1 is retained only as
an executable research reference. Web and native clients display the same
server-owned result and share the declared subject preference. Native may cache
the most recent canonical result for offline display but does not recalculate it.
Historical outputs must retain their formula version when persisted or exported.
