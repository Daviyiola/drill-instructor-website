"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../../..");
const dataFile = path.join(root, "functions", "data", "satData.js");
const archiveDirectory = path.join(__dirname, "archive");
const reportFile = path.join(__dirname, "final-layout-report.json");

const SUBJECT_PLAN = {
  Math: {sourceCount: 180, testCount: 4, testSize: 44},
  "Read. & Writ.": {sourceCount: 120, testCount: 2, testSize: 54},
};
const ARCHIVE_KEYS = {
  Math: new Set([125, 137, 140, 175]),
  "Read. & Writ.": new Set([13, 51, 65, 79, 91, 95, 96, 103, 112, 114, 116, 118]),
};

function loadSubjects() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(dataFile, "utf8"), context, {filename: dataFile});
  return vm.runInContext("getSubjects()", context, {filename: dataFile});
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

function templateKey(question) {
  return String(question.question || "").replace(/<[^>]+>/gu, " ").toLowerCase()
      .replace(/\d+(?:\.\d+)?/gu, "#")
      .replace(/\b[a-z]\b/gu, "v")
      .replace(/[^a-z#]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function distribute(subjectName, rows) {
  const plan = SUBJECT_PLAN[subjectName];
  const archiveKeys = ARCHIVE_KEYS[subjectName];
  const archived = rows.filter((question) => archiveKeys.has(question._oldKey));
  const active = rows.filter((question) => !archiveKeys.has(question._oldKey));
  const expectedArchive = plan.sourceCount - plan.testCount * plan.testSize;
  if (archived.length !== expectedArchive || active.length !== plan.testCount * plan.testSize) {
    throw new Error(`${subjectName}: invalid active/archive selection`);
  }

  const tests = Array.from({length: plan.testCount}, () => []);
  const plannedTotals = Array(plan.testCount).fill(0);
  const templateCounts = Array.from({length: plan.testCount}, () => ({}));
  const modules = new Map();
  active.forEach((question) => {
    if (!modules.has(question.module)) modules.set(question.module, []);
    modules.get(question.module).push(question);
  });

  [...modules.entries()].sort((left, right) =>
    right[1].length - left[1].length || left[0].localeCompare(right[0]),
  ).forEach(([module, questions]) => {
    const base = Math.floor(questions.length / plan.testCount);
    const remainder = questions.length % plan.testCount;
    const quota = Array(plan.testCount).fill(base);
    [...Array(plan.testCount).keys()].sort((left, right) =>
      plannedTotals[left] - plannedTotals[right] ||
      hash(`${subjectName}:${module}:${left}`) - hash(`${subjectName}:${module}:${right}`),
    ).slice(0, remainder).forEach((test) => { quota[test] += 1; });
    quota.forEach((count, test) => { plannedTotals[test] += count; });

    questions.sort((left, right) => left._oldKey - right._oldKey).forEach((question, ordinal) => {
      const family = templateKey(question);
      const test = [...Array(plan.testCount).keys()].filter((index) => quota[index] > 0)
          .sort((left, right) =>
            (templateCounts[left][family] || 0) - (templateCounts[right][family] || 0) ||
            tests[left].length - tests[right].length ||
            ((left - ordinal + plan.testCount) % plan.testCount) -
              ((right - ordinal + plan.testCount) % plan.testCount),
          )[0];
      tests[test].push(question);
      quota[test] -= 1;
      templateCounts[test][family] = (templateCounts[test][family] || 0) + 1;
    });
  });

  tests.forEach((test, testIndex) => {
    if (test.length !== plan.testSize) {
      throw new Error(`${subjectName} test ${testIndex + 1} has ${test.length}; expected ${plan.testSize}`);
    }
    const ordered = [];
    const remaining = [...test];
    let previousModule = "";
    while (remaining.length) {
      const counts = remaining.reduce((result, question) => {
        result[question.module] = (result[question.module] || 0) + 1;
        return result;
      }, {});
      remaining.sort((left, right) =>
        (left.module === previousModule ? 1 : 0) - (right.module === previousModule ? 1 : 0) ||
        counts[right.module] - counts[left.module] ||
        hash(`${subjectName}:${testIndex}:${left._oldKey}`) - hash(`${subjectName}:${testIndex}:${right._oldKey}`));
      const next = remaining.shift();
      ordered.push(next);
      previousModule = next.module;
    }
    tests[testIndex] = ordered;
  });
  return {tests, archived};
}

function cleanQuestion(question, practiceYear) {
  const result = {...question, practiceYear};
  delete result._oldKey;
  return result;
}

function subjectObject(name, tests) {
  const result = {subject: name};
  let key = 1;
  tests.forEach((test, testIndex) => test.forEach((question) => {
    result[key] = cleanQuestion(question, testIndex + 1);
    key += 1;
  }));
  return result;
}

function serialize(value, depth = 0) {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((item) => `${childIndent}${serialize(item, depth + 1)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (Object.prototype.hasOwnProperty.call(value, "subject")) {
      entries.sort(([left], [right]) =>
        left === "subject" ? -1 : right === "subject" ? 1 : Number(left) - Number(right));
    }
    if (!entries.length) return "{}";
    return `{\n${entries.map(([key, item]) => {
      const label = /^(?:[A-Za-z_$][\w$]*|\d+)$/u.test(key) ? key : JSON.stringify(key);
      return `${childIndent}${label}: ${serialize(item, depth + 1)}`;
    }).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function serializedSubjects(subjects) {
  return `function getSubjects() {\n  return allSubjects;\n}\n\nvar allSubjects = ${serialize(subjects)};\n`;
}

function breakdown(tests) {
  return tests.map((test, index) => ({
    practiceTest: index + 1,
    questions: test.length,
    modules: test.reduce((counts, question) => {
      counts[question.module] = (counts[question.module] || 0) + 1;
      return counts;
    }, {}),
  }));
}

function archiveReason(subject, key) {
  if (subject === "Math") {
    if ([125, 140].includes(key)) return "Redundant median template";
    if (key === 137) return "Redundant linear-expression template";
    return "Redundant basic quadratic-roots template";
  }
  const reasons = {
    13: "Parallel pronunciation/grammar construction",
    51: "Parallel fossil-comparison notes construction",
    65: "Parallel participatory-art vocabulary construction",
    79: "Parallel radioactive-emission grammar construction",
    91: "Parallel publication-and-book notes construction",
    95: "Parallel editorial-control vocabulary construction",
    96: "Parallel migration-support main-purpose construction",
    103: "Parallel plant-organelle punctuation construction",
    112: "Parallel persistent-material sentence-completion construction",
    114: "Parallel transportation-distance notes construction",
    116: "Parallel collaborative-authorship comparison construction",
    118: "Parallel military-code-talker notes construction",
  };
  return reasons[key] || "High template redundancy";
}

function main() {
  const subjects = loadSubjects();
  const byName = Object.fromEntries(subjects.map((subject) => [subject.subject, subject]));
  const counts = Object.fromEntries(Object.entries(byName).map(([name, subject]) => [name, rowsFor(subject).length]));
  const isFinal = Object.entries(SUBJECT_PLAN).every(([name, plan]) =>
    counts[name] === plan.testCount * plan.testSize &&
    rowsFor(byName[name]).every((question) =>
      Number.isInteger(question.practiceYear) && question.practiceYear >= 1 && question.practiceYear <= plan.testCount));
  if (isFinal) {
    const formatted = serializedSubjects(subjects);
    if (fs.readFileSync(dataFile, "utf8") !== formatted) fs.writeFileSync(dataFile, formatted);
    console.log("SAT practice tests are already finalized; no content changed.");
    return;
  }
  Object.entries(SUBJECT_PLAN).forEach(([name, plan]) => {
    if (!byName[name] || counts[name] !== plan.sourceCount) {
      throw new Error(`${name} has ${counts[name] || 0} source questions; expected ${plan.sourceCount}`);
    }
  });

  const results = Object.fromEntries(Object.keys(SUBJECT_PLAN).map((name) =>
    [name, distribute(name, rowsFor(byName[name]))]));
  const finalSubjects = subjects.map((subject) =>
    subjectObject(subject.subject, results[subject.subject].tests));
  const source = serializedSubjects(finalSubjects);
  const check = {};
  vm.createContext(check);
  vm.runInContext(source, check, {filename: dataFile});

  fs.mkdirSync(archiveDirectory, {recursive: true});
  Object.entries(results).forEach(([subject, result]) => {
    const filename = subject === "Math" ? "math-unused.json" : "reading-writing-unused.json";
    fs.writeFileSync(path.join(archiveDirectory, filename), `${JSON.stringify({
      subject,
      reason: "Surplus questions archived during final official-size SAT form balancing.",
      questions: result.archived.map((question) => {
        const record = {...question, archivedFromQuestion: question._oldKey,
          archiveReason: archiveReason(subject, question._oldKey)};
        delete record._oldKey;
        return record;
      }),
    }, null, 2)}\n`);
  });
  fs.writeFileSync(reportFile, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    policy: "Fresh canonical numbering; no old-to-new ID mapping retained.",
    subjects: Object.fromEntries(Object.entries(results).map(([name, result]) =>
      [name, breakdown(result.tests)])),
    archived: Object.fromEntries(Object.entries(results).map(([name, result]) =>
      [name, result.archived.length])),
  }, null, 2)}\n`);
  fs.writeFileSync(dataFile, source);
  Object.entries(results).forEach(([name, result]) =>
    console.log(`${name}: ${result.tests.length} x ${result.tests[0].length}; archived ${result.archived.length}`));
}

main();
