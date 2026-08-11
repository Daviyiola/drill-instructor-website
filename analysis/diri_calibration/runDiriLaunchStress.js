"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {buildCatalog} = require("../../functions/handlers/_studentDrill");
const {DIRI_FORMULA_VERSION, readiness} = require("../../functions/handlers/_diri");
const {buildHistory} = require("./runDiriV32Design");

const NOW = Date.parse("2026-08-11T12:00:00.000Z");
const catalogs = {act: buildCatalog("act"), sat: buildCatalog("sat")};

function evaluate(options, focusedSubject = "") {
  const bootcamp = options.bootcamp || "act";
  return readiness(buildHistory(options), catalogs[bootcamp], NOW, focusedSubject);
}

const namedScenarios = [
  {id: "minimum-perfect", attempted: 100, accuracy: 100, sessions: 5, daySpacing: 7},
  {id: "balanced-90-consecutive", attempted: 300, accuracy: 90, sessions: 15},
  {id: "balanced-90-distributed", attempted: 300, accuracy: 90, sessions: 15,
    daySpacing: 6},
  {id: "balanced-90-mature", attempted: 400, accuracy: 90, sessions: 20,
    daySpacing: 4},
  {id: "crammed-90", attempted: 500, accuracy: 90, sessions: 24,
    daysAgo: Array(24).fill(0)},
  {id: "stale-90", attempted: 500, accuracy: 90, sessions: 24,
    daysAgo: Array.from({length: 24}, (_, index) => 60 + index)},
  {id: "narrow-90", attempted: 500, accuracy: 90, sessions: 24,
    daySpacing: 3, moduleBreadth: 1, testBreadth: 1},
  {id: "one-subject-90", attempted: 500, accuracy: 90, sessions: 24,
    daySpacing: 3, subjects: ["Mathematics"]},
  {id: "weak-subject", attempted: 450, sessions: 24, daySpacing: 3,
    accuracyBySubject: {English: 95, Mathematics: 95, Science: 60}},
  {id: "disciplined-70", attempted: 600, accuracy: 70, sessions: 24,
    daySpacing: 3, moduleBreadth: "all", testBreadth: "all"},
  {id: "slow-90", attempted: 500, accuracy: 90, sessions: 24,
    daySpacing: 3, secondsPerQuestion: 150},
  {id: "sat-balanced-90", bootcamp: "sat", attempted: 400, accuracy: 90,
    sessions: 20, daySpacing: 4},
].map((scenario) => ({id: scenario.id, inputs: scenario,
  result: evaluate(scenario)}));

const grid = [];
for (const bootcamp of ["act", "sat"]) {
  for (const attempted of [99, 100, 150, 200, 300, 400, 600]) {
    for (const accuracy of [40, 50, 60, 65, 70, 75, 80, 85, 88, 90, 95, 100]) {
      for (const sessions of [1, 5, 10, 15, 20, 24]) {
        for (const pattern of ["crammed", "consecutive", "distributed", "stale"]) {
          const options = {bootcamp, attempted, accuracy, sessions};
          if (pattern === "crammed") options.daysAgo = Array(sessions).fill(0);
          if (pattern === "consecutive") options.daySpacing = 1;
          if (pattern === "distributed") options.daySpacing = sessions > 1 ?
            Math.max(1, Math.floor(84 / (sessions - 1))) : 0;
          if (pattern === "stale") options.daysAgo = Array.from(
              {length: sessions}, (_, index) => 60 + index);
          const result = evaluate(options);
          grid.push({bootcamp, attempted, accuracy, sessions, pattern,
            status: result.status, score: result.score,
            confidence: result.confidence,
            performance: result.pillars && result.pillars.performance,
            consistency: result.pillars && result.pillars.consistency,
            coverage: result.pillars && result.pillars.coverage,
            constraints: result.constraints || []});
        }
      }
    }
  }
}

const estimated = grid.filter((row) => row.status === "estimated");
const scores90 = estimated.filter((row) => row.score >= 90);
const ready = estimated.filter((row) => row.score >= 85);
const checks = {
  finiteAndBounded: estimated.every((row) => Number.isFinite(row.score) &&
    row.score >= 0 && row.score <= 100),
  belowMinimumIsInsufficient: grid.filter((row) => row.attempted < 100)
      .every((row) => row.status === "insufficient_data"),
  every90MeetsGuardrails: scores90.every((row) => row.attempted >= 300 &&
    row.performance >= 88 && row.consistency >= 80 && row.coverage >= 80 &&
    row.constraints.length === 0),
  everyReadyMeetsFloors: ready.every((row) => row.performance >= 80 &&
    row.consistency >= 50 && row.coverage >= 60),
  weakAccuracyNeverExceptional: estimated.filter((row) => row.accuracy <= 75)
      .every((row) => row.score < 90),
  crammingAt90NotReady: estimated.filter((row) => row.pattern === "crammed" &&
    row.accuracy === 90).every((row) => row.score < 85),
  staleAt90NotReady: estimated.filter((row) => row.pattern === "stale" &&
    row.accuracy === 90).every((row) => row.score < 85),
  exceptionalIsAchievable: scores90.length > 0,
};

const summary = {
  formulaVersion: DIRI_FORMULA_VERSION,
  generatedAt: new Date().toISOString(),
  simulationNow: new Date(NOW).toISOString(),
  gridRows: grid.length,
  estimatedRows: estimated.length,
  readyRows: ready.length,
  exceptionalRows: scores90.length,
  scoreRange: estimated.length ? {
    minimum: Math.min(...estimated.map((row) => row.score)),
    maximum: Math.max(...estimated.map((row) => row.score)),
  } : null,
  checks,
  namedScenarios,
  grid,
};

const target = path.join(__dirname, "diri-3.2-launch-stress-results.json");
fs.writeFileSync(target, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({...summary, grid: undefined}, null, 2));

