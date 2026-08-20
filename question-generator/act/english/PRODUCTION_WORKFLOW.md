# ACT English Production Workflow

## Locked form contract

Each Drill Instructor ACT English practice test contains 50 questions:

- Four `LONG` passage bundles with 10 ordered questions each.
- Two `SHORT` passage bundles with 5 ordered questions each.
- Passage bundles may be shuffled during final form assembly.
- Questions inside a passage bundle must remain together and in target order.
- `practiceYear` remains the placeholder value `1` during generation. Final values are assigned only after forms are assembled and approved.

## Source preparation

Validate the source corpus:

```powershell
node question-generator/act/english/validate-source.js
```

Prepare one UTF-8 source input with valid `<u>...</u>` tags:

```powershell
node question-generator/act/english/prepare-source.js 1
```

Source 17 is excluded because it duplicates Source 4. Do not generate from it. If the final production target requires the missing two long-passage variants, create independent form-gap blueprints rather than deriving four variants from the duplicated source architecture.

## Passage production

For every eligible source:

1. Run Prompt 1 with the prepared source JSON, including its binding `passageClass` and `requiredQuestionCount`.
2. Accept up to two genuinely distinct, source-safe blueprints. Do not force Blueprint B.
3. Run Prompt 2 separately for each accepted blueprint.
4. Run Prompt 3 and repair or regenerate any failed asset.
5. Run Prompt 4 only after the passage asset passes.
6. Run Prompt 5 and repair or replace failed questions.
7. Store the approved files together:

```text
work/source-01/blueprint-a/
  passage.json
  passage-verification.json
  questions.jsfrag
  question-verification.json
  final.jsfrag
```

Validate the completed bundle:

```powershell
node question-generator/act/english/validate-generated-bundle.js question-generator/act/english/work/source-01/blueprint-a
```

An optional starting export key may be supplied as the second argument.

## Full-form assembly

Select six approved bundles satisfying the locked contract and validate them together:

```powershell
node question-generator/act/english/validate-form.js `
  <long-bundle-1> <long-bundle-2> <long-bundle-3> <long-bundle-4> `
  <short-bundle-1> <short-bundle-2>
```

The form validator checks:

- Four long and two short passages.
- Exactly 50 questions.
- Informational, argumentative, and narrative coverage.
- ACT reporting-category balance.
- Difficulty guardrails.
- Correct-answer position balance.
- Duplicate generated titles.

After validation, run the same source-similarity editorial review used for ACT Reading. Compare wording, entities, examples, subject matter, conceptual theme, paragraph-function sequence, rhetorical architecture, and overall disguised-rewrite risk. Red batches must be regenerated before import.

## Import and release

Only after complete forms pass:

1. Shuffle passage bundles, never individual questions.
2. Assign consecutive dataset keys.
3. Assign final `practiceYear` values by complete 50-question form.
4. Replace each `{{shared_passage}}` placeholder with that bundle's approved `student_passage`.
5. Run the general question-bank audit and content build.
6. Review rendered passages, questions, answers, explanations, and navigation in web and native clients.
7. Increment the ACT dataset version and use the established content release command only after approval.

No generation, import, dataset-version change, content-pack publication, or Functions deployment is part of source/prompt preparation.
