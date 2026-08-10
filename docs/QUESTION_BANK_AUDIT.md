# Question-bank audit workflow

The audit command inspects the ACT and SAT authoring banks without changing
them:

```powershell
cd functions
npm.cmd run question:audit
```

Reports are written to:

- `.question-audits/question-bank-audit.json`
- `.question-audits/question-bank-audit.md`

Use `--bootcamp act` or `--bootcamp sat` to inspect one bank. Use `--strict`
to return a failing exit status when deterministic errors exist:

```powershell
npm.cmd run question:audit -- --bootcamp act --strict
```

The deterministic pass checks required content, four-option answer integrity,
duplicate options and questions, metadata, image files, text encoding, and the
portable rich-text subset. Short explanations are warnings rather than proof
of an academic defect.

Each JSON question contains an untouched `manualReview` object. A later human
or model review fills that object with an independently determined answer,
answer and explanation verdicts, confidence, notes, and proposed changes.
Deterministic findings and academic judgments therefore remain distinguishable.

The audit never edits a question bank, increments a content version, publishes
a content pack, or deploys Functions.
