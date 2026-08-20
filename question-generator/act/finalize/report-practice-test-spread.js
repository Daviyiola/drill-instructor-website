"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repositoryRoot = path.resolve(__dirname, "../../..");
const filename = path.join(repositoryRoot, "functions", "data", "actData.js");
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(filename, "utf8"), context, {filename});
const subjects = vm.runInContext("getSubjects()", context, {filename});
const clean = (value) => String(value || "").replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ").trim();

subjects.forEach((subject) => {
  const rows = Object.keys(subject).filter((key) => /^\d+$/u.test(key))
      .map((key) => ({id: Number(key), ...subject[key]}));
  console.log(`\n### ${subject.subject}`);
  const tests = [...new Set(rows.map((question) => question.practiceYear))]
      .sort((left, right) => left - right);
  tests.forEach((practiceTest) => {
    const questions = rows.filter((question) => question.practiceYear === practiceTest);
    const modules = questions.reduce((counts, question) => {
      counts[question.module] = (counts[question.module] || 0) + 1;
      return counts;
    }, {});
    console.log(`T${practiceTest} ${questions.length} :: ${Object.entries(modules)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([module, count]) => `${module}=${count}`).join(" | ")}`);
    if (!["Science", "English"].includes(subject.subject)) return;
    const groups = new Map();
    questions.forEach((question) => {
      const key = String(question.passage || "").trim() ||
        (question.imageSources || []).join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(question);
    });
    [...groups.values()].forEach((group, index) => {
      console.log(`  G${index + 1} [${group.length}] ${clean(group[0].passage).slice(0, 95)}`);
    });
  });
});
