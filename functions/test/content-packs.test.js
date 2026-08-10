"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {contentVersionFor} = require("../data/contentVersions");
const {
  filterQuestions: filterEducatorQuestions,
} = require("../handlers/educatorQuestionBankHttps");
const {
  CORRECTION_REVISION,
  buildCatalog,
  canonicalPracticeTest,
  datasetVersionFor,
  hasUsableAuthoredActTestLabels,
  normalizedQuestions,
} = require("../handlers/_studentDrill");

test("canonical content coordinates are bootcamp-scoped", () => {
  assert.equal(datasetVersionFor("act"),
      contentVersionFor("act").datasetVersion);
  assert.equal(datasetVersionFor("sat"),
      contentVersionFor("sat").datasetVersion);
  assert.equal(datasetVersionFor("utme"), "");
  assert.equal(CORRECTION_REVISION, 0);
});

test("Functions initialize the production content-pack bucket", () => {
  const indexSource = fs.readFileSync(
      path.join(__dirname, "..", "index.js"), "utf8",
  );
  assert.match(
      indexSource,
      /storageBucket:\s*"drill-instructor-pro\.firebasestorage\.app"/,
  );
});

test("ACT deterministic test relabeling matches the source plan", () => {
  const questions = normalizedQuestions("act");
  const expected = {
    Mathematics: [45, 45, 45, 45, 45, 45, 45, 45, 10],
    Science: [40, 40, 40, 40, 8],
    English: [50, 50],
  };
  for (const [subject, counts] of Object.entries(expected)) {
    const actual = counts.map((_, index) => questions.filter((question) =>
      question.subject === subject && question.practiceYear === index + 1,
    ).length);
    assert.deepEqual(actual, counts);
  }
  assert.equal(questions.some((question) =>
    question.subject === "Reading"), false);
});

test("authored labels take precedence over ACT fallback grouping", () => {
  assert.equal(canonicalPracticeTest("act", "Mathematics", 46, 7), 7);
  assert.equal(canonicalPracticeTest("act", "Science", 41, "3"), 3);
  assert.equal(canonicalPracticeTest("act", "English", 51, 0), 2);
  assert.equal(canonicalPracticeTest("sat", "Math", 1, 4), 4);
});

test("ACT accepts distributed authored labels and rejects placeholders", () => {
  assert.equal(hasUsableAuthoredActTestLabels(
      [{practiceYear: 1}, {practiceYear: 1}, {practiceYear: 2}],
      "Mathematics",
  ), true);
  assert.equal(hasUsableAuthoredActTestLabels(
      Array.from({length: 46}, () => ({practiceYear: 1})),
      "Mathematics",
  ), false);
  assert.equal(hasUsableAuthoredActTestLabels(
      [{practiceYear: 3}, {practiceYear: 3}], "Science",
  ), true);
});

test("canonical questions expose stable ids and relative WebP assets", () => {
  for (const bootcamp of ["act", "sat"]) {
    const questions = normalizedQuestions(bootcamp);
    assert.ok(questions.length > 0);
    assert.equal(new Set(questions.map((row) => row.id)).size,
        questions.length);
    assert.equal(new Set(questions.map((row) => row.legacyId)).size,
        questions.length);
    assert.ok(questions.every((row) =>
      Array.isArray(row.imageSources) && row.imageSources.every((asset) =>
        /^assets\/[A-Za-z0-9_-]+\.webp$/.test(asset))));
    const catalog = buildCatalog(bootcamp);
    assert.equal(catalog.datasetVersion,
        contentVersionFor(bootcamp).datasetVersion);
    assert.equal(catalog.correctionRevision,
        contentVersionFor(bootcamp).correctionRevision);
  }
});

test("educator draft hydration preserves exact saved order", () => {
  const available = normalizedQuestions("act").slice(0, 3);
  const requested = [available[2].id, available[0].id];
  const hydrated = filterEducatorQuestions("act", {questionIds: requested});
  assert.deepEqual(hydrated.map((question) => question.id), requested);
});

test("ACT preserves every multi-image reference as an ordered array", () => {
  const questions = normalizedQuestions("act");
  const multiImage = questions.filter((row) => row.imageSources.length > 1);
  assert.equal(multiImage.length, 162);
  const firstScience = questions.find((row) => row.id === "science_1");
  assert.deepEqual(firstScience.imageSources, [
    "assets/Sci1.webp",
    "assets/Sci2.webp",
    "assets/Sci3.webp",
  ]);
});

test("native and web delivery sources use imageSources arrays", () => {
  const root = path.join(__dirname, "..", "..");
  const nativeManager = fs.readFileSync(path.join(
      root, "Drill_Instructor", "qml", "Components",
      "ContentPackManager.qml",
  ), "utf8");
  const webImages = fs.readFileSync(path.join(
      root, "lib", "drills", "images.ts",
  ), "utf8");
  assert.match(nativeManager, /function cachedCloudAssets\(/);
  assert.match(nativeManager, /function protectBookmarkAssets\(/);
  assert.match(webImages, /Array\.isArray\(source\)/);
});

test("native free manifests expose only Tests 1 and 2", () => {
  for (const bootcamp of ["act", "sat"]) {
    const filename = path.join(
        __dirname, "..", "..", "Drill_Instructor", "assets",
        "content-free", bootcamp, "manifest.json",
    );
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    assert.deepEqual(manifest.freePracticeTests, [1, 2]);
    assert.ok(manifest.catalog.length > 0);
    assert.ok(manifest.catalog.every((subject) =>
      subject.practiceYears.every((value) => value === 1 || value === 2)));
    assert.equal(
        manifest.chunks.reduce((sum, chunk) =>
          sum + Number(chunk.questionCount || 0), 0),
        manifest.questionCount,
    );
  }
});

test("native package excludes duplicate full banks and image trees", () => {
  const nativeRoot = path.join(__dirname, "..", "..", "Drill_Instructor");
  const oldDataRoot = path.join(
      nativeRoot, "qml", "Student", "Bootcamps", "Data",
  );
  assert.equal(fs.existsSync(path.join(oldDataRoot, "actData.js")), false);
  assert.equal(fs.existsSync(path.join(oldDataRoot, "satData.js")), false);

  const cmake = fs.readFileSync(
      path.join(nativeRoot, "CMakeLists.txt"), "utf8",
  );
  assert.match(cmake, /assets\/images\/SAT\//);
  assert.match(cmake, /assets\/images\/\(Math\|Sci\)/);
  assert.match(cmake, /assets\/content-free/);
});

test("revision-zero artifacts contain an empty cumulative overlay", () => {
  for (const bootcamp of ["act", "sat"]) {
    const filename = path.join(
        __dirname, "..", "..", ".content-packs", bootcamp,
        contentVersionFor(bootcamp).datasetVersion,
        "corrections", "0.json",
    );
    const correction = JSON.parse(fs.readFileSync(filename, "utf8"));
    assert.equal(correction.cumulative, true);
    assert.equal(correction.revision, 0);
    assert.deepEqual(correction.changes, {});
  }
});

test("native solo creation sends the shared subjects contract", () => {
  const filename = path.join(
      __dirname, "..", "..", "Drill_Instructor", "qml", "Student",
      "Bootcamps", "Drills.qml",
  );
  const qml = fs.readFileSync(filename, "utf8");
  assert.match(qml, /config:\s*\{\s*subjects:\s*config\s*\}/);
  assert.doesNotMatch(qml, /bootcamp:\s*bootcampId,\s*config:\s*config/);
});

test("native drill resume waits for StackView transitions", () => {
  const nativeRoot = path.join(
      __dirname, "..", "..", "Drill_Instructor", "qml",
  );
  const main = fs.readFileSync(path.join(nativeRoot, "Main.qml"), "utf8");
  const drills = fs.readFileSync(path.join(
      nativeRoot, "Student", "Bootcamps", "Drills.qml",
  ), "utf8");

  assert.match(main, /if \(mainStack\.busy\)/);
  assert.match(main, /function pushPageWhenReady\(path, params\)/);
  assert.match(main, /pushEnter:\s*Transition\s*\{[\s\S]*?duration:\s*220/);
  assert.match(main, /replaceEnter:\s*Transition\s*\{[\s\S]*?duration:\s*220/);
  assert.doesNotMatch(
      main,
      /push(?:Enter|Exit):\s*Transition\s*\{[\s\S]*?duration:\s*0/,
  );
  assert.match(
      drills,
      /appRoot\.pushPageWhenReady\(Qt\.resolvedUrl\("Questions\.qml"\)/,
  );
});

test("native content and active-drill modals use explicit close actions",
    () => {
      const qmlRoot = path.join(
          __dirname, "..", "..", "Drill_Instructor", "qml",
      );
      const bootcampsRoot = path.join(
          qmlRoot, "Student", "Bootcamps",
      );
      const drills = fs.readFileSync(
          path.join(bootcampsRoot, "Drills.qml"), "utf8",
      );
      const squad = fs.readFileSync(
          path.join(bootcampsRoot, "SquadDrills.qml"), "utf8",
      );

      assert.doesNotMatch(drills, /closePolicy\s*:/);
      assert.doesNotMatch(squad, /closePolicy\s*:/);
      for (const filename of [
        path.join(bootcampsRoot, "Analytics.qml"),
        path.join(qmlRoot, "Instructor", "Bootcamps", "Drills.qml"),
        path.join(
            qmlRoot, "Instructor", "Bootcamps", "EducatorStudentAnalytics.qml",
        ),
      ]) {
        assert.doesNotMatch(
            fs.readFileSync(filename, "utf8"),
            /closePolicy\s*:/,
        );
      }
      assert.match(drills, /onClicked:\s*contentPackModal\.close\(\)/);
      assert.match(drills, /onClicked:\s*contentUpdateReminder\.close\(\)/);
      assert.match(squad, /onClicked:\s*activeDrillChoice\.close\(\)/);
    });

test("native expired sessions use one guarded finish path", () => {
  const bootcampsRoot = path.join(
      __dirname, "..", "..", "Drill_Instructor", "qml", "Student",
      "Bootcamps",
  );
  const questions = fs.readFileSync(
      path.join(bootcampsRoot, "Questions.qml"), "utf8",
  );

  assert.match(questions, /function promptForExpiredSession\(\)/);
  assert.match(
      questions,
      /if \(hasFinalizedSession \|\| expiryPromptShown\) return/,
  );
  assert.doesNotMatch(
      questions,
      /endQuizOverlay\.open\(\)[\s\S]{0,120}submitAndFinish\("timeout"\)/,
  );
  assert.match(
      questions,
      /selectedOptionsDataModel[\s\S]{0,500}DBHelper\.discardActiveDrill/,
  );
  assert.match(questions, /function pauseSessionForLifecycle\(\)/);
  assert.match(questions, /function resumeSessionFromLifecycle\(\)/);
});

test("native review navigator avoids iOS anchor and color binding loops",
    () => {
      const review = fs.readFileSync(path.join(
          __dirname, "..", "..", "Drill_Instructor", "qml", "Student",
          "Bootcamps", "Review.qml",
      ), "utf8");

      assert.match(review, /verticalCenter:\s*subjectHeader\.verticalCenter/);
      assert.match(
          review,
          /tileColor\s*=\s*reviewPage\.reviewNavigatorColor\(index\)/,
      );
      assert.match(
          review,
          /tileTextColor\s*=\s*reviewPage\.reviewNavigatorTextColor\(index\)/,
      );
    });
