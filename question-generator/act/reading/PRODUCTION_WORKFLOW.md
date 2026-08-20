# ACT Reading production workflow

## Scope

The source file contains 15 passage groups with 9 question stems per group. The production target is two materially distinct original passages and 9 original questions per passage, for 30 passages and 270 new questions numbered 19 through 288. Questions 1–18 contain the two preexisting Reading passages, expanded to nine questions each.

The sources are suitable as ACT-style architecture references. They provide direct-detail, inference, vocabulary, structure, central-idea, chronology/relationship, character, and paired-passage patterns. They are not clean generation inputs: they also contain copyrighted attribution, printed line numbers, OCR/encoding damage, and publisher-specific language. Prompt 1 therefore treats source content as analysis-only.

Source 2 includes a graph and three graph-dependent stems. This run is deliberately text-only. The graph and its dependent stems are excluded from the blueprint; the replacement passage must create enough textual density for all 9 questions.

## Batch contract

Each batch uses the source and numbering in `batch-manifest.json` and runs the five prompts in `prompt.txt`:

1. Extract two viable, materially distinct blueprints: A and B.
2. Generate one original 650–850 word passage asset from each blueprint.
3. Verify and revise the passage until it is ready.
4. Generate 9 questions: 3 Medium, 4 Hard, and 2 Very Hard.
5. Verify the questions and emit a complete corrected importable batch.

Store intermediate artifacts by source so the run can resume without relying on conversation context:

```text
work/source-01/blueprints.json
work/source-01/blueprint-a/passage.json
work/source-01/blueprint-a/passage-verification.json
work/source-01/blueprint-a/questions.jsfrag
work/source-01/blueprint-a/question-verification.txt
work/source-01/blueprint-a/final.jsfrag
work/source-01/blueprint-b/passage.json
work/source-01/blueprint-b/passage-verification.json
work/source-01/blueprint-b/questions.jsfrag
work/source-01/blueprint-b/question-verification.txt
work/source-01/blueprint-b/final.jsfrag
```

Only `final.jsfrag` is eligible for import. Update the manifest status after each completed source.

## Required quality gates

- Passage is original and does not preserve source names, wording, facts in the same sequence, quotations, or narrative situation.
- Blueprint A and Blueprint B produce genuinely different assets, not renamed versions of the same passage.
- Passage has no attribution, copyright notice, printed line number, OCR artifact, or generated visual.
- Passage uses `<br><br>` between paragraphs and no literal double quotation marks inside its string value.
- Final question records use unquoted numeric and field keys.
- Every record uses `imageSources: []` and `passage: "{{shared_passage}}"`.
- Explanations use plain `Step 1:`, `Step 2:`, optional `Step 3:`, and `Answer:` labels separated by `<br><br>`; those labels are not bold.
- Each keyed answer exactly matches one option and is uniquely defensible from the passage.
- Question modules use the canonical Reading module list.
- The batch contains exactly 3 Medium, 4 Hard, and 2 Very Hard questions.
- Hard and Very Hard labels reflect reasoning depth, not confusing language.

Run the deterministic batch validator before import:

```powershell
node question-generator/act/reading/validate-generated-batch.js path/to/final.jsfrag 19
```

Replace `19` with that source's `startQuestionNumber`.

After all 30 batches are complete, normalize answer positions, materialize the verification artifacts, and run the corpus-wide audit/stager:

```powershell
node question-generator/act/reading/balance-option-positions.js
node question-generator/act/reading/materialize-verification-artifacts.js
node question-generator/act/reading/audit-and-stage.js
```

The final command validates all batches together, checks passage lengths and type metadata, detects exact source overlap and duplicate full question records, verifies contiguous numbering, hydrates the passage placeholders, and writes:

```text
staging/reading-generated-19-288.jsfrag
staging/passage-index.json
staging/AUDIT_REPORT.md
```

The staging fragment is for human import review. The commands above do not modify `functions/data/actData.js`, publish a content pack, deploy Functions, or write to Firebase.

After the staged fragment passes human review, import it into the existing Reading subject with:

```powershell
node question-generator/act/reading/import-into-act-data.js
```

The importer expands the two original eight-question passages to nine questions each, preserves those complete legacy sets as questions 1–18, replaces any previously imported generated range with questions 19–288, and is safe to rerun without creating duplicates. Then validate the complete dataset and locally build the candidate content artifacts:

```powershell
cd functions
npm.cmd run content:build
```

Building is local only. Publishing the candidate content pack and deploying question-delivery Functions remain separate, explicit release operations.

## Permissions

Generation, local review, validation, and staging need only write access to this repository. They do not require Firebase, Google Cloud, Storage, deployment, or production database access.

Publishing later is a separate operation and requires the existing authenticated Firebase/Google Cloud setup. No generated batch should be published automatically during the production run.

If a separate API-driven unattended runner is introduced, provide its model API key through an environment variable or secret store, never in this directory. The current Codex workflow does not require such a key, but it must progress in checkpointed batches rather than relying on one oversized response.
