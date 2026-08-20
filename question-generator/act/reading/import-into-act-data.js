"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const datasetFile = path.resolve(root, "../../../functions/data/actData.js");
const stagingFile = path.join(root, "staging/reading-generated-19-288.jsfrag");
const fields = ["skill_tested", "question", "option1", "option2", "option3", "option4", "correctAnswer", "explanation", "practiceYear", "difficulty", "module", "imageSources", "passage"];
const bridgeSkill = "Relate two systems that make complex stage-lighting decisions repeatable.";

function parseFragment(file) {
  return vm.runInNewContext(`(${fs.readFileSync(file, "utf8").trim()})`, Object.create(null), {timeout: 3000, codeGeneration: {strings: false, wasm: false}});
}

function serializeQuestion(number, question, newline) {
  const lines = [`    ${number}: {`];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(question, field)) throw new Error(`Question ${number} is missing ${field}.`);
    lines.push(`      ${field}: ${JSON.stringify(question[field])},`);
  }
  lines.push("    },");
  return lines.join(newline);
}

function cloneQuestion(question) {
  const copy = {};
  for (const field of fields) copy[field] = question[field];
  return copy;
}

const staged = parseFragment(stagingFile);
const generatedNumbers = Object.keys(staged).map(Number).sort((a, b) => a - b);
const expected = Array.from({length: 270}, (_, index) => index + 19);
if (JSON.stringify(generatedNumbers) !== JSON.stringify(expected)) throw new Error(`Expected staged Reading questions 19-288; received ${generatedNumbers[0]}-${generatedNumbers.at(-1)} (${generatedNumbers.length}).`);

let source = fs.readFileSync(datasetFile, "utf8");
const newline = source.includes("\r\n") ? "\r\n" : "\n";
const subjects = vm.runInNewContext(`${source}${newline}allSubjects`, Object.create(null), {timeout: 8000, codeGeneration: {strings: false, wasm: false}});
const reading = subjects.find((subject) => subject.subject === "Reading");
if (!reading) throw new Error("Could not load the existing Reading subject.");

const alreadyExpanded = reading[9] && reading[9].skill_tested === bridgeSkill;
const secondPassageStart = alreadyExpanded ? 10 : 9;
const legacy = {};
for (let number = 1; number <= 8; number += 1) legacy[number] = cloneQuestion(reading[number]);

legacy[9] = {
  skill_tested: bridgeSkill,
  question: "The written lighting plans in the fifth paragraph and the numbered cue marks in the final paragraph are most similar in that both:",
  option1: "eliminate the need for trained lighting operators.",
  option2: "require every theater to own identical equipment.",
  option3: "preserve broad washes as the only acceptable lighting method.",
  option4: "convert design choices into repeatable instructions that other people can carry out consistently.",
  correctAnswer: "convert design choices into repeatable instructions that other people can carry out consistently.",
  explanation: "<b>Step 1:</b> Written lighting plans allowed unfamiliar theaters to reproduce rehearsed transitions.<br><br><b>Step 2:</b> Numbered cue marks allowed an operator separated from the designer to execute and revise exact changes.<br><br><b>Step 3:</b> Both systems translate a designer's intentions into instructions that remain usable across people, places, and performances.<br><br><b>Answer:</b> convert design choices into repeatable instructions that other people can carry out consistently.",
  practiceYear: 1, difficulty: "Hard", module: "Sequence and Relationships", imageSources: [], passage: reading[1].passage,
};

for (let offset = 0; offset < 8; offset += 1) legacy[10 + offset] = cloneQuestion(reading[secondPassageStart + offset]);
legacy[18] = {
  skill_tested: "Select evidence showing that a technical solution acquired later expressive purposes.",
  question: "Which detail most directly supports the passage's claim that lateral crossings gained purposes beyond the production limits that first encouraged them?",
  option1: "Early cameras commonly rested on heavy supports before a scene began.",
  option2: "The boardinghouse set had three doors, only two of which were well illuminated.",
  option3: "Improved lenses and lighting eventually made deeper sets practical.",
  option4: "After equipment became more flexible, crossings still helped editors preserve direction and helped filmmakers suggest anticipation or reluctance.",
  correctAnswer: "After equipment became more flexible, crossings still helped editors preserve direction and helped filmmakers suggest anticipation or reluctance.",
  explanation: "<b>Step 1:</b> The earlier paragraphs connect lateral crossings to fixed cameras, shallow sets, and restricted lighting.<br><br><b>Step 2:</b> Later equipment weakens those constraints, yet the fifth paragraph identifies editing continuity and expressive attitude as continuing uses.<br><br><b>Step 3:</b> Continued use for these new reasons is the clearest evidence that the convention acquired purposes beyond its original technical problem.<br><br><b>Answer:</b> After equipment became more flexible, crossings still helped editors preserve direction and helped filmmakers suggest anticipation or reluctance.",
  practiceYear: 1, difficulty: "Hard", module: "Central Ideas and Themes", imageSources: [], passage: reading[secondPassageStart].passage,
};

const complete = {...legacy, ...staged};
const completeNumbers = Object.keys(complete).map(Number).sort((a, b) => a - b);
const completeExpected = Array.from({length: 288}, (_, index) => index + 1);
if (JSON.stringify(completeNumbers) !== JSON.stringify(completeExpected)) throw new Error("The complete Reading bank is not contiguous from 1 through 288.");

const readingMarker = `${newline}  {${newline}    subject: "Reading",`;
const readingStart = source.indexOf(readingMarker);
if (readingStart < 0) throw new Error("Could not locate the Reading subject in actData.js.");
const serialized = completeNumbers.map((number) => serializeQuestion(number, complete[number], newline)).join(newline);
source = `${source.slice(0, readingStart)}${newline}  {${newline}    subject: "Reading",${newline}${serialized}${newline}  }${newline}];${newline}`;
fs.writeFileSync(datasetFile, source, "utf8");
console.log("Imported two nine-question legacy passages plus generated Reading questions 19-288 into actData.js.");
