"use strict";

/* eslint-disable max-len, require-jsdoc */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {aggregateAnalytics} = require("../handlers/_analytics");
const {buildCatalog} = require("../handlers/_studentDrill");
const {assignmentPaper} = require("../handlers/studentAssignmentsHttps");
const {
  PERSONAS,
  SCHOOL_ID,
  generateScenario,
  validateScenario,
} = require("../scripts/riverviewDemoScenario");

const ANCHOR = "2026-08-20T16:00:00.000Z";

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function scenario() {
  return generateScenario({anchor: ANCHOR});
}

test("Riverview scenario is deterministic and meets acceptance checks", () => {
  const first = scenario();
  const second = scenario();
  assert.equal(digest(first.data), digest(second.data));
  assert.deepEqual(first.report, second.report);
  assert.deepEqual(validateScenario(first), {ok: true, errors: []});
  assert.equal(first.report.counts.students, 14);
  assert.equal(first.report.counts.educators, 4);
  assert.equal(first.report.counts.sessions, 255);
  assert.deepEqual(first.report.group.readingInferenceAt60, {meeting: 10, below: 3, noData: 1});
});

test("Riverview writes only canonical attempts and complete result snapshots", () => {
  const generated = scenario();
  assert.equal(Object.keys(generated.data).some((key) => key.includes("analyticsAttempts")), false);
  PERSONAS.forEach((persona) => {
    const user = generated.data[`users/${persona.id}`];
    const sessions = generated.data[`studentDrills/${persona.id}`];
    assert.equal(Object.keys(user.statsIndex || {}).length, Object.keys(user.stats || {}).length);
    Object.values(user.stats || {}).forEach((record) => {
      const session = sessions[record.sessionId];
      assert.ok(session && session.result);
      assert.equal(record.resultPath, `studentDrills/${persona.id}/${record.sessionId}/result`);
      assert.deepEqual(record.summary, session.result.summary);
    });
  });
});

test("Riverview login students have useful squad and block fixtures", () => {
  const scenario = generateScenario({anchor: ANCHOR});
  const amina = scenario.data["users/user_demo_riverview_06"].squadMembers;
  const grace = scenario.data["users/user_demo_riverview_07"].squadMembers;
  assert.equal(Object.keys(amina).length, 4);
  assert.equal(Object.keys(grace).length, 4);
  assert.equal(amina.user_demo_riverview_07, true);
  assert.equal(grace.user_demo_riverview_06, true);
  assert.ok(scenario.data["studentSocial/user_demo_riverview_06/blocks/user_demo_riverview_09"]);
  assert.ok(scenario.data["studentSocial/user_demo_riverview_07/blocks/user_demo_riverview_08"]);
  assert.equal(scenario.data["studentSocialBlockedBy/user_demo_riverview_10/user_demo_riverview_07"], true);
});

test("Riverview login students have completed challenge history", () => {
  const generated = scenario();
  const challengeIds = [
    "challenge_demo_riverview_ethan_grace_01",
    "challenge_demo_riverview_grace_ethan_02",
  ];
  challengeIds.forEach((challengeId) => {
    const challenge = generated.data[`challenges/${challengeId}`];
    const results = generated.data[`challengeResults/${challengeId}`];
    assert.equal(challenge.status, "completed");
    assert.equal(challenge.reveal, true);
    assert.equal(Object.keys(results).length, 3);
    Object.entries(results).forEach(([studentId, row]) => {
      const session = generated.data[`studentDrills/${studentId}`][row.sessionId];
      assert.equal(session.mode, "challenge");
      assert.equal(session.challengeId, challengeId);
      assert.deepEqual(row.snapshot, session.result);
    });
  });
  assert.equal(Object.keys(generated.data["users/user_demo_riverview_06"].userChallenges).length, 2);
  assert.equal(Object.keys(generated.data["users/user_demo_riverview_07"].userChallenges).length, 2);
});

test("Riverview stays closed while contributing to unit rankings", () => {
  const generated = scenario();
  assert.equal(generated.data[`schools/${SCHOOL_ID}`].studentRegistrationOpen, false);
  assert.equal(generated.data[`schools/${SCHOOL_ID}`].educatorRegistrationOpen, false);
  assert.equal(generated.data[`designations/${SCHOOL_ID}`], false);
  assert.equal(generated.data["units/corps/United States/Tennessee/Riverview High School"].platoonPermissions, true);
  [...PERSONAS, ...require("../scripts/riverviewDemoScenario").EDUCATORS]
      .forEach((identity) => assert.match(identity.email, /^[a-z]+_[a-z]+@riverview\.demo$/));
});

test("Riverview assignment states and release policies are internally coherent", () => {
  const generated = scenario();
  const school = generated.data[`schools/${SCHOOL_ID}`];
  const drills = Object.values(school.educatorDrills);
  assert.equal(drills.length, 3);
  const baseline = drills.find((row) => row.title === "ACT Baseline Skills Check");
  const reading = drills.find((row) => row.title === "Reading: Evidence and Inference");
  const science = drills.find((row) => row.title === "Science: Data and Experiments");
  assert.equal(baseline.status, "closed");
  assert.ok(baseline.release.scoreReleasedAt);
  assert.equal(baseline.release.correctionsReleasedAt, null);
  assert.equal(reading.release.scorePolicy, "immediate");
  assert.equal(science.release.scorePolicy, "manual");
  assert.equal(science.release.scoreReleasedAt, null);
  const statuses = Object.values(science.assignedStudents).reduce((rows, row) => ({...rows, [row.status]: (rows[row.status] || 0) + 1}), {});
  assert.deepEqual(statuses, {submitted: 8, assigned: 4, started: 2});
  drills.forEach((drill) => {
    const paper = assignmentPaper(drill);
    assert.ok(paper.questions.length > 0);
    assert.equal(paper.questions.length, drill.questionIds.length);
  });
  assert.equal(Object.keys(generated.data["users/user_demo_riverview_06"].assignedDrills).length, 3);
  assert.equal(Object.keys(generated.data["users/user_demo_riverview_07"].assignedDrills).length, 3);
});

test("Riverview produces natural DIRI evidence states", () => {
  const generated = scenario();
  const catalog = buildCatalog("act");
  const analyticsFor = (name) => {
    const student = generated.report.students.find((row) => row.name === name);
    return aggregateAnalytics(generated.attemptsByStudent[student.id], {
      bootcamp: "act",
      startAt: new Date(Date.parse(ANCHOR) - 90 * 86400000).toISOString(),
      endAt: ANCHOR,
      timezone: "America/New_York",
      source: "all",
      subject: "",
      granularity: "week",
      diriSubjects: ["English", "Mathematics", "Reading", "Science"],
    }, catalog, Date.parse(ANCHOR));
  };
  assert.equal(analyticsFor("Owen Fields").readiness.status, "insufficient_data");
  assert.equal(analyticsFor("Lena Park").readiness.status, "insufficient_data");
  assert.equal(analyticsFor("Maya Chen").readiness.status, "estimated");
  assert.equal(analyticsFor("Grace Holloway").readiness.status, "estimated");
  const graceMath = analyticsFor("Grace Holloway").subjects.find((row) => row.subject === "Mathematics");
  assert.ok(graceMath.attempted > 0);
  assert.ok(graceMath.accuracy < 65);
});
