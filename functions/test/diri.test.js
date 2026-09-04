"use strict";
/* eslint-disable max-len, require-jsdoc */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {buildCatalog} = require("../handlers/_studentDrill");
const {DIRI_FORMULA_VERSION, readiness} = require("../handlers/_diri");
const {preferenceDescriptor, validatePreference} =
  require("../handlers/_diriPreferences");
const {buildHistory} = require("../../analysis/diri_calibration/runDiriV32Design");

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const catalog = buildCatalog("act");

function score(options, focusedSubject = "") {
  return readiness(buildHistory({bootcamp: "act", ...options}), catalog, NOW,
      focusedSubject);
}

test("launch DIRI is versioned and requires minimum evidence", () => {
  assert.equal(DIRI_FORMULA_VERSION, "diri-3.2");
  assert.equal(score({attempted: 99, accuracy: 100, sessions: 10,
    daySpacing: 7, subjects: ["English"]}, "English").status,
  "insufficient_data");
  const minimum = score({attempted: 100, accuracy: 100, sessions: 5,
    daySpacing: 7, subjects: ["English"]}, "English");
  assert.equal(minimum.status, "estimated");
  assert.equal(minimum.evidenceCeiling, 80);
  assert.ok(minimum.score <= 80);
  assert.ok(minimum.confidence < 1);
});

test("subject DIRI unlocks independently after two section equivalents", () => {
  const selected = ["Mathematics", "Reading", "Science"];
  const math = buildHistory({bootcamp: "act", attempted: 90, accuracy: 90,
    sessions: 6, daySpacing: 5, subjects: ["Mathematics"]});
  const science = buildHistory({bootcamp: "act", attempted: 80, accuracy: 90,
    sessions: 6, daySpacing: 5, subjects: ["Science"]});
  const shortReading = buildHistory({bootcamp: "act", attempted: 71,
    accuracy: 90, sessions: 6, daySpacing: 5, subjects: ["Reading"]});
  const lastReading = buildHistory({bootcamp: "act", attempted: 1,
    accuracy: 100, sessions: 1, daySpacing: 0, subjects: ["Reading"]});

  assert.equal(readiness(math, catalog, NOW, "Mathematics").status,
      "estimated");
  const locked = readiness(math.concat(science, shortReading), catalog, NOW,
      "", selected);
  assert.equal(locked.status, "insufficient_data");
  assert.equal(locked.requiredAttempts, 242);
  assert.equal(readiness(math.concat(science, shortReading, lastReading),
      catalog, NOW, "", selected).status, "estimated");
});

test("SAT uses two canonical section equivalents per selected subject", () => {
  const satCatalog = buildCatalog("sat");
  const readingWriting = buildHistory({bootcamp: "sat", attempted: 108,
    accuracy: 90, sessions: 8, daySpacing: 4, subjects: ["Read. & Writ."]});
  const shortMath = buildHistory({bootcamp: "sat", attempted: 87,
    accuracy: 90, sessions: 8, daySpacing: 4, subjects: ["Math"]});
  const lastMath = buildHistory({bootcamp: "sat", attempted: 1,
    accuracy: 100, sessions: 1, daySpacing: 0, subjects: ["Math"]});
  assert.equal(readiness(readingWriting.concat(shortMath), satCatalog, NOW)
      .status, "insufficient_data");
  const unlocked = readiness(readingWriting.concat(shortMath, lastMath),
      satCatalog, NOW);
  assert.equal(unlocked.status, "estimated");
  assert.equal(unlocked.requiredAttempts, 196);
});

test("exceptional SAT readiness requires three section equivalents per subject", () => {
  const satCatalog = buildCatalog("sat");
  const readingWriting = buildHistory({bootcamp: "sat", attempted: 162,
    accuracy: 95, sessions: 10, daySpacing: 8,
    subjects: ["Read. & Writ."], moduleBreadth: "all", testBreadth: "all"});
  const math = buildHistory({bootcamp: "sat", attempted: 132,
    accuracy: 95, sessions: 10, daySpacing: 8,
    subjects: ["Math"], moduleBreadth: "all", testBreadth: "all"});
  const result = readiness(readingWriting.concat(math), satCatalog, NOW);
  assert.ok(result.score >= 90);
  assert.equal(result.contributingAttempts, 294);
  assert.equal(result.constraints.length, 0);
});

test("a DIRI of 90 always satisfies every launch guardrail", () => {
  const results = [];
  for (const attempted of [100, 150, 200, 300, 400, 600]) {
    for (const accuracy of [50, 60, 70, 75, 80, 85, 90, 95, 100]) {
      for (const sessions of [1, 5, 10, 15, 20, 24]) {
        for (const daySpacing of [0, 1, 3, 6]) {
          results.push(score({attempted, accuracy, sessions, daySpacing}));
        }
      }
    }
  }
  results.filter((row) => row.score >= 90).forEach((row) => {
    assert.ok(row.contributingAttempts >= 300);
    assert.ok(row.pillars.performance >= 88);
    assert.ok(row.pillars.consistency >= 80);
    assert.ok(row.pillars.coverage >= 80);
    assert.equal(row.constraints.length, 0);
  });
  assert.ok(results.some((row) => row.score >= 90),
      "90 must remain achievable under exceptional evidence");
});

test("weak accuracy cannot be rescued by perfect activity or breadth", () => {
  const result = score({attempted: 600, accuracy: 70, sessions: 24,
    daySpacing: 3, moduleBreadth: "all", testBreadth: "all"});
  assert.ok(result.score < 80);
  assert.ok(result.constraints.includes("mastery_below_ready_floor"));
});

test("distributed practice outranks cramming with identical work", () => {
  const common = {attempted: 500, accuracy: 90, sessions: 24};
  const crammed = score({...common, daysAgo: Array(24).fill(0)});
  const distributed = score({...common, daySpacing: 3});
  assert.ok(distributed.score > crammed.score + 8);
  assert.ok(crammed.score < 85);
  assert.ok(distributed.pillars.consistency > crammed.pillars.consistency);
});

test("stale evidence and narrow coverage cannot remain Ready", () => {
  const stale = score({attempted: 500, accuracy: 90, sessions: 24,
    daysAgo: Array.from({length: 24}, (_, index) => 60 + index)});
  const narrow = score({attempted: 500, accuracy: 90, sessions: 24,
    daySpacing: 3, moduleBreadth: 1, testBreadth: 1});
  const oneSubject = score({attempted: 500, accuracy: 90, sessions: 24,
    daySpacing: 3, subjects: ["Mathematics"]});
  assert.ok(stale.score < 85);
  assert.ok(narrow.score < 85);
  assert.ok(oneSubject.score < 85);
  assert.ok(narrow.constraints.includes("breadth_below_ready_floor"));
});

test("one weak subject prevents aggregate excellence", () => {
  const result = score({attempted: 450, sessions: 24, daySpacing: 3,
    accuracyBySubject: {English: 95, Mathematics: 95, Science: 60}});
  assert.ok(result.score < 85);
  assert.ok(result.diagnostics.weakestSubjectAccuracy < 65);
});

test("timing cannot add points and generous configured timers cannot game DIRI", () => {
  const common = {attempted: 400, accuracy: 90, sessions: 20, daySpacing: 4};
  const onPace = score(common);
  const veryFast = score({...common, secondsPerQuestion: 15,
    allocatedSecondsPerQuestion: 600});
  const slow = score({...common, secondsPerQuestion: 150,
    allocatedSecondsPerQuestion: 600});
  assert.equal(veryFast.score, onPace.score);
  assert.equal(veryFast.diagnostics.pacingPenalty, 0);
  assert.equal(slow.diagnostics.pacingPenalty, 5);
  assert.ok(slow.score < onPace.score);
});

test("focused DIRI ignores unrelated-subject activity", () => {
  const math = buildHistory({bootcamp: "act", attempted: 80, accuracy: 90,
    sessions: 8, daySpacing: 7, subjects: ["Mathematics"]});
  const science = buildHistory({bootcamp: "act", attempted: 300, accuracy: 50,
    sessions: 20, daySpacing: 3, subjects: ["Science"]});
  const alone = readiness(math, catalog, NOW, "Mathematics");
  const combined = readiness(math.concat(science), catalog, NOW, "Mathematics");
  assert.deepEqual(combined, alone);
});

test("declared ACT subjects define readiness without penalizing an omitted option", () => {
  const fourSubjectCatalog = {subjects: [
    ...catalog.subjects,
    {name: "Reading", modules: ["Reading"], practiceYears: [1, 2, 3, 4]},
  ]};
  const selected = ["English", "Mathematics", "Science"];
  const history = buildHistory({
    bootcamp: "act",
    attempted: 450,
    accuracy: 92,
    sessions: 24,
    daySpacing: 3,
    subjects: selected,
    moduleBreadth: "all",
    testBreadth: "all",
  });
  const tailored = readiness(
      history, fourSubjectCatalog, NOW, "", selected);
  const allFour = readiness(history, fourSubjectCatalog, NOW, "", [
    "English", "Mathematics", "Science", "Reading",
  ]);
  assert.ok(tailored.score >= 90);
  assert.deepEqual(tailored.selectedSubjects, selected);
  assert.equal(allFour.status, "insufficient_data");
  assert.ok(allFour.constraints.includes(
      "minimum_subject_evidence_not_met"));
});

test("ACT preference accepts three or four valid catalog subjects", () => {
  const fourSubjectCatalog = {subjects: [
    "English", "Mathematics", "Science", "Reading",
  ].map((name) => ({name}))};
  const defaultPreference = preferenceDescriptor(
      "act", fourSubjectCatalog, null);
  assert.equal(defaultPreference.minimumSubjects, 3);
  assert.equal(defaultPreference.maximumSubjects, 4);
  assert.deepEqual(validatePreference("act", fourSubjectCatalog, [
    "mathEMATICS", "Reading", "English",
  ]).selectedSubjects, ["Mathematics", "Reading", "English"]);
  assert.throws(() => validatePreference("act", fourSubjectCatalog, [
    "Mathematics", "English",
  ]), /between 3 and 4/);
});

test("small accuracy improvements cannot reduce DIRI", () => {
  const base = buildHistory({bootcamp: "act", attempted: 400, accuracy: 50,
    sessions: 20, daySpacing: 4});
  let previous = -1;
  for (let accuracy = 50; accuracy <= 100; accuracy += 1) {
    const history = structuredClone(base);
    history.forEach((attempt) => {
      attempt.subjects.forEach((row) => {
        row.correct = Math.floor(row.attempted * accuracy / 100);
        row.wrong = row.attempted - row.correct;
      });
    });
    const current = readiness(history, catalog, NOW).score;
    assert.ok(current >= previous, `${accuracy}% produced ${current} after ${previous}`);
    previous = current;
  }
});

test("native analytics never substitutes its older local DIRI formula", () => {
  const root = path.resolve(__dirname, "../..");
  const nested = path.join(root, "Drill_Instructor");
  const nativeRoot = fs.existsSync(nested) ? nested :
    path.join(root, "..", "drill_instructor_app");
  const student = fs.readFileSync(path.join(nativeRoot,
      "qml/Student/Bootcamps/Analytics.qml"), "utf8");
  const educator = fs.readFileSync(path.join(nativeRoot,
      "qml/Instructor/Bootcamps/EducatorStudentAnalytics.qml"), "utf8");
  assert.ok(student.includes("applyCachedCanonicalReadiness()"));
  assert.equal(student.includes("buildReadinessV2(diriRows)"), false);
  assert.equal(educator.includes("buildReadinessV2(diriRows)"), false);
});
