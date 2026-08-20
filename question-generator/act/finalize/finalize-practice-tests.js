"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repositoryRoot = path.resolve(__dirname, "../../..");
const dataFile = path.join(repositoryRoot, "functions", "data", "actData.js");
const archiveDirectory = path.join(__dirname, "archive");
const reportFile = path.join(__dirname, "final-layout-report.json");
const englishWorkDirectory = path.join(repositoryRoot, "question-generator", "act", "english", "work");

const TEST_COUNTS = {
  Mathematics: 8,
  Science: 4,
  English: 8,
  Reading: 8,
};

// One literal duplicate plus nine especially repetitive template variants.
// Diagram-only prompts are deliberately not treated as duplicates.
const MATH_ARCHIVE_KEYS = new Set([22, 28, 30, 44, 62, 70, 82, 168, 283, 337]);

function loadSubjects() {
  const source = fs.readFileSync(dataFile, "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, {filename: dataFile, timeout: 10000});
  return vm.runInContext("getSubjects()", context, {filename: dataFile, timeout: 10000});
}

function rowsFor(subject) {
  return Object.keys(subject).filter((key) => /^\d+$/u.test(key))
      .map((key) => ({...subject[key], _oldKey: Number(key)}));
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function stimulusKey(question) {
  const passage = String(question.passage || "").trim();
  if (passage) return `passage:${passage}`;
  const images = Array.isArray(question.imageSources) ? question.imageSources : [];
  if (images.length) return `images:${images.join("|")}`;
  return `question:${question._oldKey}`;
}

function stimulusGroups(rows) {
  const groups = new Map();
  rows.forEach((question) => {
    const key = stimulusKey(question);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(question);
  });
  return [...groups.entries()].map(([key, questions]) => ({
    key,
    questions: questions.sort((left, right) => left._oldKey - right._oldKey),
    firstKey: Math.min(...questions.map((question) => question._oldKey)),
  }));
}

function balancedMath(rows) {
  const archived = rows.filter((question) => MATH_ARCHIVE_KEYS.has(question._oldKey));
  const active = rows.filter((question) => !MATH_ARCHIVE_KEYS.has(question._oldKey));
  if (archived.length !== 10 || active.length !== 360) {
    throw new Error(`Mathematics expected 360 active and 10 archived; got ${active.length} and ${archived.length}`);
  }

  const tests = Array.from({length: 8}, () => []);
  const totals = Array(8).fill(0);
  const difficultyCounts = Array.from({length: 8}, () => ({}));
  const modules = new Map();
  active.forEach((question) => {
    if (!modules.has(question.module)) modules.set(question.module, []);
    modules.get(question.module).push(question);
  });

  [...modules.entries()].sort((left, right) =>
    right[1].length - left[1].length || left[0].localeCompare(right[0]),
  ).forEach(([module, questions]) => {
    const base = Math.floor(questions.length / 8);
    const remainder = questions.length % 8;
    const quota = Array(8).fill(base);
    const extraTests = [...Array(8).keys()].sort((left, right) =>
      totals[left] - totals[right] ||
      hash(`${module}:${left}`) - hash(`${module}:${right}`),
    ).slice(0, remainder);
    extraTests.forEach((test) => { quota[test] += 1; });
    quota.forEach((count, test) => { totals[test] += count; });

    const lastSourceKey = Array(8).fill(-1000);
    questions.sort((left, right) => left._oldKey - right._oldKey)
        .forEach((question, questionIndex) => {
          const candidates = [...Array(8).keys()].filter((test) => quota[test] > 0)
              .sort((left, right) => {
                const leftSibling = Math.abs(lastSourceKey[left] - question._oldKey) <= 2 ? 1 : 0;
                const rightSibling = Math.abs(lastSourceKey[right] - question._oldKey) <= 2 ? 1 : 0;
                const difficulty = String(question.difficulty || "Unknown");
                return leftSibling - rightSibling ||
                  (difficultyCounts[left][difficulty] || 0) - (difficultyCounts[right][difficulty] || 0) ||
                  tests[left].length - tests[right].length ||
                  ((left - questionIndex + 8) % 8) - ((right - questionIndex + 8) % 8);
              });
          const test = candidates[0];
          tests[test].push(question);
          quota[test] -= 1;
          lastSourceKey[test] = question._oldKey;
          const difficulty = String(question.difficulty || "Unknown");
          difficultyCounts[test][difficulty] = (difficultyCounts[test][difficulty] || 0) + 1;
        });
  });

  tests.forEach((test, index) => {
    if (test.length !== 45) throw new Error(`Mathematics test ${index + 1} has ${test.length}, expected 45`);
    const ordered = [];
    const remaining = [...test];
    let previousModule = "";
    while (remaining.length) {
      const moduleCounts = remaining.reduce((counts, question) => {
        counts[question.module] = (counts[question.module] || 0) + 1;
        return counts;
      }, {});
      remaining.sort((left, right) => {
        const leftRepeat = left.module === previousModule ? 1 : 0;
        const rightRepeat = right.module === previousModule ? 1 : 0;
        return leftRepeat - rightRepeat ||
          moduleCounts[right.module] - moduleCounts[left.module] ||
          hash(`math:${index}:${left._oldKey}`) - hash(`math:${index}:${right._oldKey}`);
      });
      const next = remaining.shift();
      ordered.push(next);
      previousModule = next.module;
    }
    tests[index] = ordered;
  });
  return {tests, archived};
}

function scienceDomain(group) {
  const text = String(group.questions[0].passage || "").toLowerCase();
  if (/beetle|snail|seedling|algae|yeast|fermentation|digestion|lake|reed|marsh/u.test(text)) return "Life and environmental science";
  if (/filter|carbon|dye|detergent|film|phosphate|desalination/u.test(text)) return "Chemistry and materials";
  return "Physics and engineering";
}

function balancedScience(rows) {
  const groups = stimulusGroups(rows).map((group) => ({...group, domain: scienceDomain(group)}));
  if (groups.length !== 28 || groups.some((group) => group.questions.length !== 6)) {
    throw new Error("Science expected 28 six-question stimulus groups");
  }
  const tests = Array.from({length: 4}, () => []);
  const domains = Array.from({length: 4}, () => ({}));
  // These four stimuli present competing models, sources, or viewpoints.
  const viewpointStarts = new Set([31, 37, 127, 133]);
  const isViewpoints = (group) => viewpointStarts.has(group.firstKey);
  const viewpoints = groups.filter(isViewpoints);
  const remaining = groups.filter((group) => !isViewpoints(group));
  if (viewpoints.length !== 4) throw new Error(`Science expected 4 conflicting-viewpoint groups; got ${viewpoints.length}`);
  viewpoints.sort((left, right) => left.firstKey - right.firstKey).forEach((group, test) => {
    tests[test].push(group);
    domains[test][group.domain] = 1;
  });
  remaining.sort((left, right) =>
    hash(`science:${left.key}`) - hash(`science:${right.key}`),
  ).forEach((group) => {
    const test = [...Array(4).keys()].filter((index) => tests[index].length < 7)
        .sort((left, right) =>
          (domains[left][group.domain] || 0) - (domains[right][group.domain] || 0) ||
          tests[left].length - tests[right].length || left - right,
        )[0];
    tests[test].push(group);
    domains[test][group.domain] = (domains[test][group.domain] || 0) + 1;
  });

  const archived = [];
  const flattened = tests.map((test, testIndex) => {
    if (test.length !== 7) throw new Error(`Science test ${testIndex + 1} expected 7 stimulus groups`);
    const shorten = [...test].sort((left, right) =>
      hash(`science-prune:${testIndex}:${left.key}`) - hash(`science-prune:${testIndex}:${right.key}`),
    ).slice(0, 2);
    shorten.forEach((group) => {
      const moduleCounts = group.questions.reduce((counts, question) => {
        counts[question.module] = (counts[question.module] || 0) + 1;
        return counts;
      }, {});
      const candidate = [...group.questions].sort((left, right) =>
        moduleCounts[right.module] - moduleCounts[left.module] || right._oldKey - left._oldKey,
      )[0];
      group.questions = group.questions.filter((question) => question !== candidate);
      archived.push(candidate);
    });
    const orderedGroups = [...test].sort((left, right) =>
      hash(`science-order:${testIndex}:${left.key}`) - hash(`science-order:${testIndex}:${right.key}`),
    );
    return orderedGroups.flatMap((group) => group.questions);
  });
  flattened.forEach((test, index) => {
    if (test.length !== 40) throw new Error(`Science test ${index + 1} has ${test.length}, expected 40`);
  });
  return {tests: flattened, archived, domains};
}

function balancedEnglish(rows) {
  const groups = stimulusGroups(rows);
  const bySize = new Map();
  groups.forEach((group) => {
    if (!bySize.has(group.questions.length)) bySize.set(group.questions.length, []);
    bySize.get(group.questions.length).push(group);
  });
  const take = (size, count, salt) => {
    const bucket = bySize.get(size) || [];
    bucket.sort((left, right) => hash(`${salt}:${left.key}`) - hash(`${salt}:${right.key}`));
    if (bucket.length < count) throw new Error(`English needs ${count} passage groups of size ${size}`);
    return bucket.splice(0, count);
  };
  const tests = [];
  for (let index = 0; index < 4; index += 1) {
    tests.push([
      ...take(10, 2, `hybrid-10-${index}`),
      ...take(5, 1, `hybrid-5-${index}`),
      ...take(8, 2, `hybrid-8-${index}`),
      ...take(9, 1, `hybrid-9-${index}`),
    ]);
  }
  for (let index = 4; index < 8; index += 1) {
    tests.push([
      ...take(10, 4, `standard-10-${index}`),
      ...take(5, 2, `standard-5-${index}`),
    ]);
  }
  if ([...bySize.values()].some((bucket) => bucket.length)) throw new Error("English left unassigned passage groups");
  separateEnglishSourceSiblings(tests);
  return tests.map((groups, index) => groups
      .sort((left, right) => hash(`english-order:${index}:${left.key}`) - hash(`english-order:${index}:${right.key}`))
      .flatMap((group) => group.questions));
}

function englishSourceMap() {
  const result = new Map();
  if (!fs.existsSync(englishWorkDirectory)) return result;
  fs.readdirSync(englishWorkDirectory).filter((name) => /^source-\d+$/u.test(name))
      .forEach((source) => ["blueprint-a", "blueprint-b"].forEach((blueprint) => {
        const filename = path.join(englishWorkDirectory, source, blueprint, "passage.json");
        if (!fs.existsSync(filename)) return;
        const record = JSON.parse(fs.readFileSync(filename, "utf8"));
        if (record.student_passage) result.set(record.student_passage, source);
      }));
  return result;
}

function separateEnglishSourceSiblings(tests) {
  const sourcesByPassage = englishSourceMap();
  const sourceFor = (group) => sourcesByPassage.get(group.questions[0].passage) || null;
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    for (let testIndex = 0; testIndex < tests.length; testIndex += 1) {
      const sources = tests[testIndex].map(sourceFor).filter(Boolean);
      const duplicate = sources.find((source, index) => sources.indexOf(source) !== index);
      if (!duplicate) continue;
      const movingIndex = tests[testIndex].findIndex((group) => sourceFor(group) === duplicate);
      const moving = tests[testIndex][movingIndex];
      const targetSources = new Set(tests[testIndex].filter((_, index) => index !== movingIndex).map(sourceFor).filter(Boolean));
      let swap = null;
      for (let otherIndex = 0; otherIndex < tests.length && !swap; otherIndex += 1) {
        if (otherIndex === testIndex) continue;
        const otherSources = new Set(tests[otherIndex].map(sourceFor).filter(Boolean));
        if (otherSources.has(duplicate)) continue;
        for (let groupIndex = 0; groupIndex < tests[otherIndex].length; groupIndex += 1) {
          const candidate = tests[otherIndex][groupIndex];
          const candidateSource = sourceFor(candidate);
          if (candidate.questions.length !== moving.questions.length) continue;
          if (candidateSource && targetSources.has(candidateSource)) continue;
          swap = {otherIndex, groupIndex, candidate};
          break;
        }
      }
      if (!swap) throw new Error(`Unable to separate English sibling passages for ${duplicate}`);
      tests[testIndex][movingIndex] = swap.candidate;
      tests[swap.otherIndex][swap.groupIndex] = moving;
      changed = true;
    }
    if (!changed) return;
  }
  throw new Error("English sibling-passage separation did not converge");
}

function readingCategory(group) {
  const text = String(group.questions[0].passage || "").replace(/<[^>]+>/gu, "").trim().toUpperCase();
  return text.split(":", 1)[0];
}

function balancedReading(rows) {
  const groups = stimulusGroups(rows);
  const categories = new Map();
  groups.forEach((group) => {
    const category = readingCategory(group);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(group);
  });
  const expected = {HUMANITIES: 8, "NATURAL SCIENCE": 8, "PAIRED PASSAGES": 8, "SOCIAL SCIENCE": 6, "LITERARY NARRATIVE": 2};
  Object.entries(expected).forEach(([category, count]) => {
    const actual = (categories.get(category) || []).length;
    if (actual !== count) throw new Error(`Reading ${category} expected ${count} passages; got ${actual}`);
    categories.get(category).sort((left, right) => hash(`reading:${category}:${left.key}`) - hash(`reading:${category}:${right.key}`));
  });
  const fourth = [...categories.get("SOCIAL SCIENCE"), ...categories.get("LITERARY NARRATIVE")]
      .sort((left, right) => hash(`reading-fourth:${left.key}`) - hash(`reading-fourth:${right.key}`));
  return Array.from({length: 8}, (_, index) => {
    const groupsForTest = [
      categories.get("HUMANITIES")[index],
      categories.get("NATURAL SCIENCE")[index],
      categories.get("PAIRED PASSAGES")[index],
      fourth[index],
    ];
    const rotation = index % groupsForTest.length;
    return [...groupsForTest.slice(rotation), ...groupsForTest.slice(0, rotation)]
        .flatMap((group) => group.questions);
  });
}

function cleanQuestion(question, practiceYear) {
  const result = {...question, practiceYear};
  delete result._oldKey;
  return result;
}

function subjectObject(name, tests) {
  const subject = {subject: name};
  let index = 1;
  tests.forEach((test, testIndex) => test.forEach((question) => {
    subject[index] = cleanQuestion(question, testIndex + 1);
    index += 1;
  }));
  return subject;
}

function breakdown(tests) {
  return tests.map((test, index) => ({
    practiceTest: index + 1,
    questions: test.length,
    modules: test.reduce((counts, question) => {
      counts[question.module] = (counts[question.module] || 0) + 1;
      return counts;
    }, {}),
    difficulties: test.reduce((counts, question) => {
      const difficulty = String(question.difficulty || "Unknown");
      counts[difficulty] = (counts[difficulty] || 0) + 1;
      return counts;
    }, {}),
  }));
}

function archiveRecord(question, reason) {
  const result = {...question, archivedFromQuestion: question._oldKey, archiveReason: reason};
  delete result._oldKey;
  return result;
}

function serializeJavaScript(value, depth = 0) {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((item) => `${childIndent}${serializeJavaScript(item, depth + 1)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (Object.prototype.hasOwnProperty.call(value, "subject")) {
      entries.sort(([left], [right]) =>
        (left === "subject" ? -1 : right === "subject" ? 1 : Number(left) - Number(right)));
    }
    if (!entries.length) return "{}";
    return `{\n${entries.map(([key, item]) => {
      const property = /^(?:[A-Za-z_$][\w$]*|\d+)$/u.test(key) ? key : JSON.stringify(key);
      return `${childIndent}${property}: ${serializeJavaScript(item, depth + 1)}`;
    }).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function serializeSubjects(subjects) {
  return `function getSubjects() {\n  return allSubjects;\n}\n\nvar allSubjects = ${serializeJavaScript(subjects)};\n`;
}

function main() {
  const sourceSubjects = loadSubjects();
  const byName = Object.fromEntries(sourceSubjects.map((subject) => [subject.subject, subject]));
  Object.keys(TEST_COUNTS).forEach((subject) => {
    if (!byName[subject]) throw new Error(`Missing ACT subject ${subject}`);
  });

  const sourceCounts = Object.fromEntries(Object.entries(byName).map(([name, subject]) =>
    [name, rowsFor(subject).length]));
  const finalCounts = {Mathematics: 360, Science: 160, English: 400, Reading: 288};
  const isAlreadyFinal = Object.entries(finalCounts).every(([name, count]) =>
    sourceCounts[name] === count && rowsFor(byName[name]).every((question) =>
      Number.isInteger(question.practiceYear) &&
      question.practiceYear >= 1 && question.practiceYear <= TEST_COUNTS[name]));
  if (isAlreadyFinal) {
    const currentEnglishTests = Array.from({length: TEST_COUNTS.English}, (_, index) =>
      stimulusGroups(rowsFor(byName.English).filter((question) => question.practiceYear === index + 1)));
    separateEnglishSourceSiblings(currentEnglishTests);
    const repairedEnglish = subjectObject("English", currentEnglishTests.map((groups) =>
      groups.flatMap((group) => group.questions)));
    const repairedSubjects = sourceSubjects.map((subject) =>
      subject.subject === "English" ? repairedEnglish : subject);
    const formatted = serializeSubjects(repairedSubjects);
    if (fs.existsSync(reportFile)) {
      const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
      report.subjects = Object.fromEntries(repairedSubjects.map((subject) => {
        const rows = rowsFor(subject);
        const tests = Array.from({length: TEST_COUNTS[subject.subject]}, (_, index) =>
          rows.filter((question) => question.practiceYear === index + 1));
        return [subject.subject, breakdown(tests)];
      }));
      const reportSource = `${JSON.stringify(report, null, 2)}\n`;
      if (fs.readFileSync(reportFile, "utf8") !== reportSource) {
        fs.writeFileSync(reportFile, reportSource);
      }
    }
    if (fs.readFileSync(dataFile, "utf8") !== formatted) {
      fs.writeFileSync(dataFile, formatted);
      console.log("ACT practice tests were already finalized; normalized JavaScript formatting only.");
    } else {
      console.log("ACT practice tests are already finalized; no files changed.");
    }
    return;
  }
  const expectedSourceCounts = {Mathematics: 370, Science: 168, English: 400, Reading: 288};
  Object.entries(expectedSourceCounts).forEach(([name, count]) => {
    if (sourceCounts[name] !== count) {
      throw new Error(`${name} has ${sourceCounts[name]} source questions; expected ${count}. Refusing to archive or renumber an unexpected bank.`);
    }
  });

  const math = balancedMath(rowsFor(byName.Mathematics));
  const science = balancedScience(rowsFor(byName.Science));
  const english = balancedEnglish(rowsFor(byName.English));
  const reading = balancedReading(rowsFor(byName.Reading));
  const testsBySubject = {
    Mathematics: math.tests,
    Science: science.tests,
    English: english,
    Reading: reading,
  };
  Object.entries(testsBySubject).forEach(([subject, tests]) => {
    if (tests.length !== TEST_COUNTS[subject]) throw new Error(`${subject} has ${tests.length} tests`);
    const expectedSize = {Mathematics: 45, Science: 40, English: 50, Reading: 36}[subject];
    tests.forEach((test, index) => {
      if (test.length !== expectedSize) throw new Error(`${subject} test ${index + 1} has ${test.length}; expected ${expectedSize}`);
    });
  });

  const finalSubjects = sourceSubjects.map((subject) =>
    subjectObject(subject.subject, testsBySubject[subject.subject]));
  const serialized = serializeSubjects(finalSubjects);
  const verificationContext = {};
  vm.createContext(verificationContext);
  vm.runInContext(serialized, verificationContext, {filename: dataFile, timeout: 10000});

  fs.mkdirSync(archiveDirectory, {recursive: true});
  fs.writeFileSync(path.join(archiveDirectory, "math-unused.json"), `${JSON.stringify({
    subject: "Mathematics",
    reason: "Removed during final eight-form balancing because the bank contained ten questions beyond 8 x 45; selections prioritize literal or strong template redundancy.",
    questions: math.archived.map((question) => archiveRecord(question, question._oldKey === 283 ? "Literal duplicate prompt" : "High template redundancy")),
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(archiveDirectory, "science-unused.json"), `${JSON.stringify({
    subject: "Science",
    reason: "Removed to preserve exactly four 40-question forms while keeping every stimulus group represented by five or six questions.",
    questions: science.archived.map((question) => archiveRecord(question, "Stimulus-group balancing")),
  }, null, 2)}\n`);
  fs.writeFileSync(reportFile, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    policy: "Fresh canonical numbering; no old-to-new ID mapping retained.",
    subjects: Object.fromEntries(Object.entries(testsBySubject).map(([subject, tests]) => [subject, breakdown(tests)])),
    archived: {Mathematics: math.archived.length, Science: science.archived.length},
    scienceDomains: science.domains,
  }, null, 2)}\n`);
  fs.writeFileSync(dataFile, serialized);
  console.log("Finalized ACT practice tests:");
  Object.entries(testsBySubject).forEach(([subject, tests]) =>
    console.log(`- ${subject}: ${tests.length} x ${tests[0].length}`));
  console.log(`Archived ${math.archived.length} Mathematics and ${science.archived.length} Science questions.`);
}

main();
