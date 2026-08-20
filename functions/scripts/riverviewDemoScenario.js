/* eslint-disable max-len, require-jsdoc, brace-style, block-spacing */

const crypto = require("crypto");
const {
  analyticsAttemptFromResult,
} = require("../handlers/_analytics");
const {
  correctionRevisionFor,
  datasetVersionFor,
  gradeSession,
  normalizedQuestions,
  questionStimulusKey,
  subjectTimerKey,
} = require("../handlers/_studentDrill");
const {nextStreakNode} = require("../handlers/_streaks");

const SEED_ID = "riverview-v1";
const SCHOOL_ID = "riverview_demo_2026";
const SCHOOL_NAME = "Riverview High School";
const GROUP_ID = "demo_squad";
const EXPECTED_DATASET_VERSION = "2026.08.4";
const TIMEZONE = "America/New_York";
const BOOTCAMP = "act";
const SUBJECTS = ["English", "Mathematics", "Reading", "Science"];

const PERSONAS = [
  {slug: "maya_chen", firstName: "Maya", lastName: "Chen", sessions: 21, base: {English: .92, Mathematics: .91, Reading: .91, Science: .92}},
  {slug: "avery_stone", firstName: "Avery", lastName: "Stone", sessions: 19, base: {English: .88, Mathematics: .87, Reading: .86, Science: .87}},
  {slug: "elias_turner", firstName: "Elias", lastName: "Turner", sessions: 17, base: {English: .77, Mathematics: .93, Reading: .69, Science: .91}, modules: {"Reading|Inference and Implication": .55}},
  {slug: "sofia_ramirez", firstName: "Sofia", lastName: "Ramirez", sessions: 17, base: {English: .93, Mathematics: .66, Reading: .90, Science: .69}},
  {slug: "noah_bennett", firstName: "Noah", lastName: "Bennett", sessions: 17, base: {English: .84, Mathematics: .86, Reading: .82, Science: .76}, modules: {"Science|Experimental Design": .20}},
  {slug: "ethan_brooks", firstName: "Ethan", lastName: "Brooks", sessions: 15, auth: true, base: {English: .75, Mathematics: .71, Reading: .73, Science: .70}},
  {slug: "grace_holloway", firstName: "Grace", lastName: "Holloway", sessions: 19, auth: true, base: {English: .73, Mathematics: .61, Reading: .66, Science: .72}},
  {slug: "caleb_morgan", firstName: "Caleb", lastName: "Morgan", sessions: 16, base: {English: .68, Mathematics: .74, Reading: .72, Science: .70}, modules: {"English|Transitions and Logical Relationships": .54, "English|Organization and Cohesion": .58, "Reading|Inference and Implication": .78}},
  {slug: "priya_shah", firstName: "Priya", lastName: "Shah", sessions: 15, base: {English: .61, Mathematics: .55, Reading: .59, Science: .53}, modules: {"Reading|Inference and Implication": .48, "Mathematics|Ratios, Rates and Proportions": .44, "Mathematics|Quadratic Expressions": .46, "Science|Data Representation": .45, "Science|Scientific Conclusions": .47}},
  {slug: "miles_carter", firstName: "Miles", lastName: "Carter", sessions: 15, base: {English: .76, Mathematics: .78, Reading: .68, Science: .75}, modules: {"Reading|Inference and Implication": .55}},
  {slug: "zoe_williams", firstName: "Zoe", lastName: "Williams", sessions: 15, base: {English: .84, Mathematics: .81, Reading: .82, Science: .67}, modules: {"Science|Data Analysis and Trends": .48}},
  {slug: "theo_jackson", firstName: "Theo", lastName: "Jackson", sessions: 31, base: {English: .77, Mathematics: .76, Reading: .75, Science: .76}},
  {slug: "lena_park", firstName: "Lena", lastName: "Park", sessions: 3, base: {English: .82, Mathematics: .77, Reading: .80, Science: .79}},
  {slug: "owen_fields", firstName: "Owen", lastName: "Fields", sessions: 0, base: {English: .70, Mathematics: .70, Reading: .70, Science: .70}},
].map((row, index) => ({
  ...row,
  index: index + 1,
  id: `user_demo_riverview_${String(index + 1).padStart(2, "0")}`,
  email: `${row.slug}@riverview.demo`,
}));

const EDUCATORS = [
  {slug: "renee_foster", firstName: "Renee", lastName: "Foster", subjects: SUBJECTS, admin: true, superAdmin: true},
  {slug: "marcus_hale", firstName: "Marcus", lastName: "Hale", subjects: ["English", "Reading"]},
  {slug: "dana_okafor", firstName: "Dana", lastName: "Okafor", subjects: ["Mathematics"]},
  {slug: "evelyn_price", firstName: "Evelyn", lastName: "Price", subjects: ["Science"]},
].map((row, index) => ({
  ...row,
  index: index + 1,
  id: `educator_demo_riverview_${String(index + 1).padStart(2, "0")}`,
  uid: `auth_demo_riverview_educator_${String(index + 1).padStart(2, "0")}`,
  email: `${row.slug}@riverview.demo`,
}));

const ASSIGNMENTS = [
  {id: "drill_demo_riverview_baseline", title: "ACT Baseline Skills Check", owner: 0, dueDayAgo: 52, assignedDayAgo: 62, submissionDayAgo: 55, status: "closed", subjects: SUBJECTS, count: 20, submitted: 11, scorePolicy: "manual", correctionPolicy: "manual", scoreReleased: true},
  {id: "drill_demo_riverview_reading", title: "Reading: Evidence and Inference", owner: 1, dueDayAgo: -3, assignedDayAgo: 14, submissionDayAgo: 7, status: "published", subjects: ["Reading"], modules: ["Inference and Implication", "Textual Details", "Central Ideas and Themes"], count: 15, submitted: 10, scorePolicy: "immediate", correctionPolicy: "manual"},
  {id: "drill_demo_riverview_science", title: "Science: Data and Experiments", owner: 3, dueDayAgo: -7, assignedDayAgo: 4, submissionDayAgo: 2, status: "published", subjects: ["Science"], modules: ["Data Analysis and Trends", "Data Representation", "Experimental Design", "Scientific Conclusions"], count: 16, submitted: 8, started: 2, scorePolicy: "manual", correctionPolicy: "manual"},
];

function hashSeed(value) {
  return crypto.createHash("sha256").update(String(value)).digest().readUInt32LE(0);
}

function rngFor(value) {
  let state = hashSeed(value);
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isoAt(anchorMs, dayAgo, hour = 19, minute = 0) {
  const date = new Date(anchorMs - (dayAgo * 86400000));
  // Seed dates are presentation fixtures. Setting UTC afternoon/evening keeps
  // them on the intended local date across Eastern daylight/standard time.
  date.setUTCHours(hour + 4, minute, 0, 0);
  return date.toISOString();
}

function rankForPoints(points) {
  if (points < 100) return "Recruit";
  if (points < 250) return "Corporal";
  if (points < 450) return "Sergeant";
  if (points < 800) return "Warrant Officer";
  if (points < 1300) return "Lieutenant";
  if (points < 1950) return "Captain";
  if (points < 3000) return "Major";
  if (points < 4500) return "Colonel";
  if (points < 7000) return "Major General";
  return "General";
}

function accuracyFor(persona, subject, module, dayAgo) {
  let value = persona.modules && persona.modules[`${subject}|${module}`] !== undefined ? persona.modules[`${subject}|${module}`] : persona.base[subject];
  if (persona.slug === "grace_holloway" && subject === "Reading" && module === "Inference and Implication") {
    value = dayAgo >= 60 ? .47 : dayAgo >= 30 ? .58 : .74;
  } else if (persona.slug === "grace_holloway" && subject === "Reading") {
    value += dayAgo >= 60 ? -.07 : dayAgo >= 30 ? 0 : .08;
  }
  if (persona.slug === "caleb_morgan" && subject === "Mathematics") {
    value = dayAgo >= 60 ? .84 : dayAgo >= 30 ? .73 : .59;
    if (["Plane Geometry", "Functions and Graphs"].includes(module)) value -= .08;
  }
  return clamp(value, .30, .97);
}

function paceBaseline(subject) {
  return {English: 38, Mathematics: 68, Reading: 55, Science: 52}[subject] || 55;
}

function personaPace(persona) {
  if (persona.slug === "theo_jackson") return .88;
  if (persona.slug === "priya_shah") return 1.18;
  if (persona.slug === "lena_park") return 1.08;
  return 1 + ((persona.index % 5) - 2) * .035;
}

function questionGroups(questions) {
  const groups = new Map();
  questions.forEach((question) => {
    const key = questionStimulusKey(question) || `question:${question.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(question);
  });
  return [...groups.values()].map((rows) => rows.sort((a, b) => String(a.id).localeCompare(String(b.id))));
}

function buildPools(questions) {
  const pools = {};
  SUBJECTS.forEach((subject) => {
    const subjectQuestions = questions.filter((question) => question.subject === subject && !question.disabled);
    pools[subject] = {
      all: questionGroups(subjectQuestions),
      modules: {},
      tests: [...new Set(subjectQuestions.map((question) => Number(question.practiceYear)).filter(Boolean))].sort((a, b) => a - b),
    };
    [...new Set(subjectQuestions.map((question) => question.module))].forEach((module) => {
      pools[subject].modules[module] = questionGroups(subjectQuestions.filter((question) => question.module === module));
    });
  });
  return pools;
}

function chooseGroup({pools, subject, module, practiceYear, used, cursor, seed}) {
  let groups = pools[subject].modules[module] || pools[subject].all;
  const matchingTest = groups.filter((group) => group.some((question) => Number(question.practiceYear) === Number(practiceYear)));
  if (matchingTest.length) groups = matchingTest;
  if (!groups.length) return [];
  const start = hashSeed(seed) % groups.length;
  for (let offset = 0; offset < groups.length; offset++) {
    const group = groups[(start + cursor.value + offset) % groups.length];
    if (group.some((question) => !used.has(question.id))) {
      cursor.value += offset + 1;
      return group;
    }
  }
  used.clear();
  const group = groups[(start + cursor.value) % groups.length];
  cursor.value += 1;
  return group;
}

function selectPaper({pools, persona, sessionIndex, subjects, modulesBySubject = {}, targetCount, usedByStudent, seed}) {
  const selected = [];
  const selectedIds = new Set();
  const perSubject = Math.max(1, Math.floor(targetCount / subjects.length));
  subjects.forEach((subject, subjectIndex) => {
    const modules = modulesBySubject[subject] && modulesBySubject[subject].length ? modulesBySubject[subject] : Object.keys(pools[subject].modules).filter((module) => ![
      "Systems of equations", "Character and Relationship Analysis", "Conflicting Viewpoints",
    ].includes(module));
    const preferred = preferredModule(persona, subject, modules, sessionIndex + subjectIndex);
    const testList = pools[subject].tests;
    const practiceYear = testList[(sessionIndex + subjectIndex + persona.index) % testList.length];
    const used = usedByStudent[subject] || (usedByStudent[subject] = new Set());
    const cursor = {value: sessionIndex + subjectIndex};
    while (selected.filter((question) => question.subject === subject).length < perSubject) {
      const module = modules[(modules.indexOf(preferred) + cursor.value) % modules.length] || preferred;
      const group = chooseGroup({pools, subject, module, practiceYear, used, cursor, seed: `${seed}|${subject}|${module}`});
      if (!group.length) break;
      group.forEach((question) => {
        if (!selectedIds.has(question.id) && selected.filter((row) => row.subject === subject).length < perSubject + 2) {
          selected.push(question);
          selectedIds.add(question.id);
          used.add(question.id);
        }
      });
      if (cursor.value > 1000) break;
    }
  });
  return selected.slice(0, Math.max(targetCount, selected.length));
}

function preferredModule(persona, subject, modules, index) {
  const targets = {
    elias_turner: {Reading: "Inference and Implication"},
    noah_bennett: {Science: "Experimental Design"},
    grace_holloway: {Reading: "Inference and Implication"},
    caleb_morgan: {Mathematics: index % 2 ? "Plane Geometry" : "Functions and Graphs"},
    priya_shah: {Mathematics: index % 2 ? "Ratios, Rates and Proportions" : "Quadratic Expressions", Science: index % 2 ? "Data Representation" : "Scientific Conclusions", Reading: "Inference and Implication"},
    miles_carter: {Reading: "Inference and Implication"},
    zoe_williams: {Science: "Data Analysis and Trends"},
    sofia_ramirez: {English: index % 3 === 0 ? "Punctuation" : index % 3 === 1 ? "Sentence Structure" : "Organization and Cohesion"},
  };
  const chosen = targets[persona.slug] && targets[persona.slug][subject];
  return modules.includes(chosen) ? chosen : modules[index % modules.length];
}

function buildSubmission({persona, questions, sessionId, startedAt, source = "solo", sourceId = sessionId, schoolId = "", dueAt = "", release = null, rng}) {
  const startedMs = Date.parse(startedAt);
  const answers = {};
  const questionTimes = {};
  const answerGroups = new Map();
  questions.forEach((question, index) => {
    const accuracy = accuracyFor(persona, question.subject, question.module, Math.round((ANCHOR_CONTEXT - startedMs) / 86400000));
    const leaveBlank = rng() < (persona.slug === "priya_shah" ? .055 : persona.slug === "lena_park" ? .04 : .018);
    if (!leaveBlank) {
      const key = `${question.subject}|${accuracy}`;
      if (!answerGroups.has(key)) answerGroups.set(key, {accuracy, rows: []});
      answerGroups.get(key).rows.push({question, order: rng()});
    }
    const jitter = .78 + (rng() * .48);
    questionTimes[question.id] = Math.max(8, Math.round(paceBaseline(question.subject) * personaPace(persona) * jitter));
    if (index === questions.length - 1 && persona.slug === "theo_jackson") questionTimes[question.id] = Math.round(questionTimes[question.id] * .75);
  });
  answerGroups.forEach(({accuracy, rows}) => {
    rows.sort((a, b) => a.order - b.order);
    const correctCount = rows.length >= 5 ? Math.round(rows.length * accuracy) : null;
    rows.forEach(({question}, index) => {
      const correct = correctCount === null ? rng() < accuracy : index < correctCount;
      answers[question.id] = correct ? question.correctIndex :
        (question.correctIndex + 1 + Math.floor(rng() * Math.max(1, question.options.length - 1))) % question.options.length;
    });
  });
  const config = SUBJECTS.filter((subject) => questions.some((question) => question.subject === subject)).map((subject) => {
    const count = questions.filter((question) => question.subject === subject).length;
    return {
      subject,
      modules: [...new Set(questions.filter((question) => question.subject === subject).map((question) => question.module))],
      practiceYears: [...new Set(questions.filter((question) => question.subject === subject).map((question) => Number(question.practiceYear)).filter(Boolean))],
      questionCount: count,
      timeLimitMin: Math.max(5, Math.ceil((count * paceBaseline(subject) * 1.35) / 60)),
    };
  });
  const timers = Object.fromEntries(config.map((row) => [subjectTimerKey(row.subject), row.timeLimitMin * 60]));
  const activeSec = Object.values(questionTimes).reduce((sum, value) => sum + value, 0);
  const endedMs = startedMs + ((activeSec + 18) * 1000);
  const session = {
    sessionId,
    studentId: persona.id,
    status: "active",
    mode: source === "assignment" ? "assignment" :
      source === "challenge" ? "challenge" : "solo",
    transport: "cloud",
    bootcamp: BOOTCAMP,
    datasetVersion: datasetVersionFor(BOOTCAMP),
    correctionRevision: correctionRevisionFor(BOOTCAMP),
    config,
    questions,
    answers,
    questionTimes,
    timers,
    createdAt: startedMs,
    updatedAt: startedMs,
    ...(source === "assignment" ? {schoolId, assignmentId: sourceId} : {}),
    ...(source === "challenge" ? {challengeId: sourceId} : {}),
  };
  const result = gradeSession(session, answers, timers, endedMs);
  const submitted = {
    ...session,
    status: "submitted",
    submittedAt: result.createdAt,
    updatedAt: endedMs,
    result,
    credit: {deltaPoints: result.summary.points, totalPoints: 0, rank: ""},
  };
  const analytics = analyticsAttemptFromResult({result, session, studentId: persona.id, source, sourceId, schoolId, release, dueAt});
  analytics.credited = true;
  const stats = {
    type: "results_snapshot", v: 2, attemptId: sessionId, sessionId,
    bootcamp: BOOTCAMP, source, sourceId, submittedAt: result.createdAt,
    takenAt: result.createdAt, createdAt: result.createdAt,
    datasetVersion: session.datasetVersion, summary: result.summary,
    subjects: result.subjects, modules: result.modules,
    resultPath: `studentDrills/${persona.id}/${sessionId}/result`,
    gradingVersion: "server-v1",
  };
  return {session: submitted, result, analytics, stats};
}

function soloDayAgo(index, count, personaIndex) {
  const ratio = (index + .5) / Math.max(1, count);
  let min;
  let span;
  if (ratio < .20) { min = 60; span = 30; } else if (ratio < .50) { min = 30; span = 30; } else { min = 0; span = 30; }
  const within = ((index * 17) + (personaIndex * 11)) % span;
  return min + within;
}

function subjectsForSession(persona, index) {
  if (persona.slug === "grace_holloway" && (index <= 8 || index % 2 === 1)) {
    return ["Reading"];
  }
  if (persona.slug === "grace_holloway") {
    // Keep Reading as Grace's visible improvement story without making her
    // overall record artificially one-dimensional. Her remaining sessions
    // rotate through the other ACT subjects so both the current three-subject
    // default and the four-subject DIRI preference have credible evidence.
    const supportingSubjects = ["English", "Mathematics", "Science"];
    return [supportingSubjects[Math.floor(Math.max(0, index - 10) / 2) %
      supportingSubjects.length]];
  }
  const primary = SUBJECTS[(index + persona.index) % SUBJECTS.length];
  const subjects = [primary];
  if ((index + persona.index) % 5 === 0) subjects.push(SUBJECTS[(SUBJECTS.indexOf(primary) + 1) % SUBJECTS.length]);
  // Every evidence-bearing student gets repeated inference sessions. This is
  // deliberate because that module is the school demo's threshold narrative.
  if (index % 7 === 0 && !subjects.includes("Reading")) subjects[0] = "Reading";
  return [...new Set(subjects)];
}

function buildRelease(assignment, assignedAt, dueAt) {
  const releasedAt = assignment.scoreReleased ? isoAt(Date.parse(assignedAt), -2, 12) : null;
  return {
    scorePolicy: assignment.scorePolicy,
    correctionPolicy: assignment.correctionPolicy,
    scoreReleasedAt: releasedAt,
    correctionsReleasedAt: null,
  };
}

function makeProfile(persona, points, streak) {
  return {
    uid: persona.auth ? `auth_demo_riverview_student_${String(persona.index).padStart(2, "0")}` : persona.id,
    customUserId: persona.id,
    firstName: persona.firstName,
    lastName: persona.lastName,
    email: persona.email,
    userType: "student",
    accountType: "student",
    country: "United States",
    corps: "United States",
    corpsName: "United States",
    state: "Tennessee",
    battalion: "Tennessee",
    battalionName: "Tennessee",
    platoon: SCHOOL_NAME,
    platoonName: SCHOOL_NAME,
    platoonId: SCHOOL_ID,
    platoonPermissions: true,
    profilePermissions: true,
    challengeAudience: "squad_only",
    avaterNumber: ((persona.index - 1) % 14) + 1,
    bootcamps: {act: true},
    points,
    totalPoints: points,
    currentRank: rankForPoints(points),
    streaks: {act: streak},
    demoSeedId: SEED_ID,
  };
}

let ANCHOR_CONTEXT = Date.now();

function generateScenario(options = {}) {
  const anchor = new Date(options.anchor || new Date().toISOString());
  if (!Number.isFinite(anchor.getTime())) throw new Error("Invalid seed anchor");
  anchor.setUTCHours(16, 0, 0, 0);
  const anchorMs = anchor.getTime();
  ANCHOR_CONTEXT = anchorMs;
  const questions = normalizedQuestions(BOOTCAMP);
  const datasetVersion = datasetVersionFor(BOOTCAMP);
  const correctionRevision = correctionRevisionFor(BOOTCAMP);
  if (datasetVersion !== EXPECTED_DATASET_VERSION) {
    throw new Error(`Local ACT version ${datasetVersion} does not match expected ${EXPECTED_DATASET_VERSION}`);
  }
  const pools = buildPools(questions);
  const data = {};
  const attemptsByStudent = Object.fromEntries(PERSONAS.map((persona) => [persona.id, []]));
  const sessionsByStudent = Object.fromEntries(PERSONAS.map((persona) => [persona.id, {}]));
  const statsByStudent = Object.fromEntries(PERSONAS.map((persona) => [persona.id, {}]));
  const usedByStudent = Object.fromEntries(PERSONAS.map((persona) => [persona.id, {}]));

  PERSONAS.forEach((persona) => {
    for (let index = 0; index < persona.sessions; index++) {
      const dayAgo = soloDayAgo(index, persona.sessions, persona.index);
      const startedAt = isoAt(anchorMs, dayAgo, dayAgo % 6 === 0 ? 14 : 18 + (index % 3), (index * 13) % 55);
      const subjects = subjectsForSession(persona, index);
      const targetCount = persona.slug === "grace_holloway" &&
        !(subjects.length === 1 && subjects[0] === "Reading") ?
        22 : 8 + ((index + persona.index) % 7);
      const modulesBySubject = {};
      if (persona.slug === "grace_holloway" && subjects.length === 1 && subjects[0] === "Reading") modulesBySubject.Reading = ["Inference and Implication"];
      if (persona.slug === "noah_bennett" && subjects.includes("Science")) modulesBySubject.Science = ["Experimental Design"];
      const paper = selectPaper({pools, persona, sessionIndex: index, subjects, modulesBySubject, targetCount, usedByStudent: usedByStudent[persona.id], seed: `${SEED_ID}|${persona.id}|solo|${index}`});
      const sessionId = `demo_rv_${String(persona.index).padStart(2, "0")}_solo_${String(index + 1).padStart(3, "0")}`;
      const built = buildSubmission({persona, questions: paper, sessionId, startedAt, rng: rngFor(sessionId)});
      sessionsByStudent[persona.id][sessionId] = built.session;
      statsByStudent[persona.id][sessionId] = built.stats;
      attemptsByStudent[persona.id].push(built.analytics);
    }
  });

  const assignmentNodes = {};
  const assignmentAttempts = {};
  ASSIGNMENTS.forEach((assignment, assignmentIndex) => {
    const assignedAt = isoAt(anchorMs, assignment.assignedDayAgo, 9);
    const dueAt = isoAt(anchorMs, assignment.dueDayAgo, 23, 59);
    const modulesBySubject = assignment.modules ? {[assignment.subjects[0]]: assignment.modules} : {};
    const blueprintPaper = selectPaper({pools, persona: PERSONAS[0], sessionIndex: 100 + assignmentIndex, subjects: assignment.subjects, modulesBySubject, targetCount: assignment.count, usedByStudent: {}, seed: `${SEED_ID}|${assignment.id}|blueprint`});
    const assignmentConfig = configForQuestions(blueprintPaper);
    const blueprint = blueprintForQuestions(blueprintPaper, datasetVersion, correctionRevision);
    const totalTimeMin = assignmentConfig.reduce((sum, row) => sum + row.timeLimitMin, 0);
    const release = buildRelease(assignment, assignedAt, dueAt);
    const assignedStudents = {};
    const latestAttempts = {};
    const educatorRows = {};
    const submittedPersonas = assignmentIndex === 1 ?
      [PERSONAS[0], PERSONAS[1], PERSONAS[2], PERSONAS[3], PERSONAS[5], PERSONAS[6], PERSONAS[7], PERSONAS[8], PERSONAS[9], PERSONAS[10]] : assignmentIndex === 2 ?
      [PERSONAS[0], PERSONAS[1], PERSONAS[2], PERSONAS[4], PERSONAS[5], PERSONAS[6], PERSONAS[8], PERSONAS[10]] :
      PERSONAS.slice(0, assignment.submitted);
    const startedIds = assignment.started ? [PERSONAS[7].id, PERSONAS[11].id] : [];
    PERSONAS.forEach((persona) => {
      const isSubmitted = submittedPersonas.some((row) => row.id === persona.id);
      const isStarted = startedIds.includes(persona.id);
      const inbox = {
        type: "educator_drill", drillId: assignment.id, schoolId: SCHOOL_ID, bootcamp: BOOTCAMP,
        title: assignment.title, instructions: assignmentIndex === 0 ? "Complete this baseline so your educators can understand where to focus support." : assignmentIndex === 1 ? "Use evidence from each passage to support your answer." : "Interpret the data and evaluate how each investigation was designed.",
        createdByEducatorId: EDUCATORS[assignment.owner].id,
        createdByName: `${EDUCATORS[assignment.owner].firstName} ${EDUCATORS[assignment.owner].lastName}`,
        assignedAt, dueAt, status: isSubmitted ? "submitted" : isStarted ? "started" : "assigned",
        startedAt: "", submittedAt: "", attemptId: "", sessionId: "",
        questionCount: blueprintPaper.length, totalTimeMin,
        subjects: assignmentConfig.map((row) => row.subject), release,
      };
      assignedStudents[persona.id] = {studentId: persona.id, assignedAt, status: inbox.status};
      data[`users/${persona.id}/assignedDrills/${assignment.id}`] = inbox;
      if (isSubmitted) {
        const started = isoAt(anchorMs, assignment.submissionDayAgo + ((persona.index % 3) / 10), 17 + (persona.index % 4), (persona.index * 7) % 50);
        const sessionId = `demo_rv_${String(persona.index).padStart(2, "0")}_asg_${assignmentIndex + 1}`;
        const paper = blueprintPaper.map((question) => ({...question}));
        const built = buildSubmission({persona, questions: paper, sessionId, startedAt: started, source: "assignment", sourceId: assignment.id, schoolId: SCHOOL_ID, dueAt, release, rng: rngFor(sessionId)});
        sessionsByStudent[persona.id][sessionId] = built.session;
        statsByStudent[persona.id][sessionId] = built.stats;
        attemptsByStudent[persona.id].push(built.analytics);
        assignedStudents[persona.id] = {...assignedStudents[persona.id], status: "submitted", startedAt: started, submittedAt: built.result.createdAt, attemptId: sessionId, sessionId, summary: built.result.summary};
        data[`users/${persona.id}/assignedDrills/${assignment.id}`] = {...inbox, status: "submitted", startedAt: started, submittedAt: built.result.createdAt, attemptId: sessionId, sessionId};
        latestAttempts[persona.id] = {attemptId: sessionId, studentId: persona.id, submittedAt: built.result.createdAt, summary: built.result.summary};
        if (!educatorRows[persona.id]) educatorRows[persona.id] = {};
        educatorRows[persona.id][sessionId] = {
          attemptId: sessionId, drillId: assignment.id, schoolId: SCHOOL_ID, bootcamp: BOOTCAMP,
          studentId: persona.id, submittedAt: built.result.createdAt, startedAt: started, dueAt,
          summary: built.result.summary, subjects: built.result.subjects, modules: built.result.modules,
          answers: built.result.answers, snapshot: built.result, gradingVersion: "server-v1",
        };
      } else if (isStarted) {
        const sessionId = `demo_rv_${String(persona.index).padStart(2, "0")}_asg_${assignmentIndex + 1}`;
        const startedMs = Date.parse(isoAt(anchorMs, 1, 19));
        sessionsByStudent[persona.id][sessionId] = {
          sessionId, studentId: persona.id, status: "active", mode: "assignment", transport: "cloud",
          bootcamp: BOOTCAMP, datasetVersion, correctionRevision, schoolId: SCHOOL_ID, assignmentId: assignment.id,
          config: assignmentConfig, questions: blueprintPaper, answers: {}, questionTimes: {},
          timers: Object.fromEntries(assignmentConfig.map((row) => [subjectTimerKey(row.subject), row.timeLimitMin * 60])),
          createdAt: startedMs, updatedAt: startedMs,
        };
        const startedAt = new Date(startedMs).toISOString();
        assignedStudents[persona.id] = {...assignedStudents[persona.id], status: "started", startedAt, sessionId};
        data[`users/${persona.id}/assignedDrills/${assignment.id}`] = {...inbox, status: "started", startedAt, sessionId};
      }
    });
    const submissions = Object.values(latestAttempts);
    const summary = assignmentSummary(submissions);
    assignmentNodes[assignment.id] = {
      drillId: assignment.id, schoolId: SCHOOL_ID, ownerEducatorId: EDUCATORS[assignment.owner].id,
      ownerEducatorName: `${EDUCATORS[assignment.owner].firstName} ${EDUCATORS[assignment.owner].lastName}`,
      createdByEducatorId: EDUCATORS[assignment.owner].id,
      createdByName: `${EDUCATORS[assignment.owner].firstName} ${EDUCATORS[assignment.owner].lastName}`,
      bootcamp: BOOTCAMP, title: assignment.title,
      instructions: assignmentIndex === 0 ? "Complete this baseline so your educators can understand where to focus support." : assignmentIndex === 1 ? "Use evidence from each passage to support your answer." : "Interpret the data and evaluate how each investigation was designed.",
      status: assignment.status, createdAt: assignedAt, updatedAt: assignedAt, publishedAt: assignedAt,
      dueAt, closedAt: assignment.status === "closed" ? isoAt(anchorMs, assignment.dueDayAgo - 2, 16) : "",
      release, scoreReleasePolicy: assignment.scorePolicy, correctionReleasePolicy: assignment.correctionPolicy,
      datasetVersion, correctionRevision, questionIds: blueprintPaper.map((question) => question.id),
      blueprint,
      config: assignmentConfig, shuffleQuestions: true,
      settings: {scorePolicy: assignment.scorePolicy, correctionPolicy: assignment.correctionPolicy, shuffleQuestions: true, shuffleOptions: false},
      summary: {assignedCount: PERSONAS.length, startedCount: assignment.started || 0, submittedCount: summary.submitted, averageAccuracy: summary.accuracy, averageTimeSec: summary.averageTimeSec},
      assignmentSummary: summary,
      assignedStudents, latestAttempts, demoSeedId: SEED_ID,
    };
    assignmentAttempts[assignment.id] = educatorRows;
  });

  const challengeSpecs = [
    {
      id: "challenge_demo_riverview_ethan_grace_01",
      creatorId: PERSONAS[5].id,
      participantIds: [PERSONAS[5].id, PERSONAS[6].id, PERSONAS[0].id],
      subjects: ["Mathematics"],
      count: 10,
      completedDayAgo: 18,
    },
    {
      id: "challenge_demo_riverview_grace_ethan_02",
      creatorId: PERSONAS[6].id,
      participantIds: [PERSONAS[6].id, PERSONAS[5].id, PERSONAS[11].id],
      subjects: ["Science"],
      count: 10,
      completedDayAgo: 6,
    },
  ];
  const challengeFixtures = [];
  challengeSpecs.forEach((spec, challengeIndex) => {
    const creator = PERSONAS.find((row) => row.id === spec.creatorId);
    const paper = selectPaper({
      pools,
      persona: creator,
      sessionIndex: 200 + challengeIndex,
      subjects: spec.subjects,
      modulesBySubject: {},
      targetCount: spec.count,
      usedByStudent: {},
      seed: `${SEED_ID}|${spec.id}|blueprint`,
    });
    const blueprint = blueprintForQuestions(
        paper, datasetVersion, correctionRevision);
    const createdAt = isoAt(anchorMs, spec.completedDayAgo + 2, 18);
    const expiresAt = isoAt(anchorMs, spec.completedDayAgo - 5, 23, 59);
    const participantResults = {};
    spec.participantIds.forEach((participantId, participantIndex) => {
      const persona = PERSONAS.find((row) => row.id === participantId);
      const startedAt = isoAt(
          anchorMs, spec.completedDayAgo + (participantIndex / 20),
          18 + participantIndex, (participantIndex * 11) % 50);
      const sessionId = `demo_rv_${String(persona.index).padStart(2, "0")}_challenge_${challengeIndex + 1}`;
      const built = buildSubmission({
        persona,
        questions: paper.map((question) => ({...question})),
        sessionId,
        startedAt,
        source: "challenge",
        sourceId: spec.id,
        rng: rngFor(sessionId),
      });
      sessionsByStudent[persona.id][sessionId] = built.session;
      statsByStudent[persona.id][sessionId] = built.stats;
      attemptsByStudent[persona.id].push(built.analytics);
      participantResults[persona.id] = built;
    });
    challengeFixtures.push({
      ...spec,
      creator,
      blueprint,
      createdAt,
      expiresAt,
      participantResults,
    });
  });

  const studentProfiles = {};
  const streaks = {};
  PERSONAS.forEach((persona) => {
    const attempts = attemptsByStudent[persona.id].sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
    let streak = {};
    attempts.forEach((attempt) => {
      if (attempt.activity.attempted > 0) streak = nextStreakNode(streak, {submittedAt: attempt.submittedAt, now: anchorMs, timezone: TIMEZONE});
    });
    const points = attempts.reduce((sum, attempt) => sum + attempt.performance.points, 0);
    const node = streak.summary ? streak : nextStreakNode({}, {now: anchorMs, timezone: TIMEZONE});
    studentProfiles[persona.id] = makeProfile(persona, points, node);
    streaks[persona.id] = node;
    Object.values(sessionsByStudent[persona.id]).forEach((session) => {
      if (session.credit) session.credit = {...session.credit, totalPoints: points, rank: rankForPoints(points)};
    });
  });

  const planStart = isoAt(anchorMs, 0, 0);
  const planEnd = new Date(anchorMs + (365 * 86400000)).toISOString();
  const memberMap = Object.fromEntries(PERSONAS.map((persona) => [persona.id, true]));
  const groupMembers = Object.fromEntries(PERSONAS.map((persona) => [persona.id, true]));
  const educatorSchoolRows = {};
  const educatorProfiles = {};
  const challengeInboxes = Object.fromEntries(
      PERSONAS.map((persona) => [persona.id, {}]));
  challengeFixtures.forEach((fixture) => {
    const creatorProfile = studentProfiles[fixture.creatorId];
    const resultTree = {};
    let latestCompletedAt = fixture.createdAt;
    fixture.participantIds.forEach((participantId) => {
      const profile = studentProfiles[participantId];
      const built = fixture.participantResults[participantId];
      const summary = built.result.summary || {};
      latestCompletedAt = String(built.result.createdAt || latestCompletedAt);
      challengeInboxes[participantId][fixture.id] = {
        role: participantId === fixture.creatorId ? "sender" : "recipient",
        status: "completed",
        bootcamp: BOOTCAMP,
        datasetVersion,
        correctionRevision,
        senderCustomId: fixture.creatorId,
        senderCurrentRank: creatorProfile.currentRank,
        senderDisplay: `${fixture.creator.firstName} ${fixture.creator.lastName}`,
        senderAvatarNumber: fixture.creator.index,
        createdAt: fixture.createdAt,
        expiresAt: fixture.expiresAt,
        completedAt: built.result.createdAt,
        sessionId: built.session.sessionId,
      };
      resultTree[participantId] = {
        correct: Number(summary.correct || 0),
        wrong: Number(summary.wrong || 0),
        unanswered: Number(summary.unanswered || 0),
        attempted: Number(summary.attempted || 0),
        totalQ: Number(summary.totalQ || 0),
        usedSec: Number(summary.usedSec || 0),
        timeMs: Number(summary.usedSec || 0) * 1000,
        points: Number(summary.points || 0),
        finishedAt: built.result.createdAt,
        sessionId: built.session.sessionId,
        snapshot: built.result,
        participant: {
          displayName: `${profile.firstName} ${profile.lastName}`,
          avaterNumber: profile.avaterNumber,
          currentRank: profile.currentRank,
        },
      };
    });
    data[`challenges/${fixture.id}`] = {
      challengeId: fixture.id,
      bootcamp: BOOTCAMP,
      datasetVersion,
      correctionRevision,
      subjects: fixture.blueprint.subjects,
      createdAt: fixture.createdAt,
      expiresAt: fixture.expiresAt,
      completedAt: latestCompletedAt,
      createdByCustomId: fixture.creatorId,
      participantsCustomIds: fixture.participantIds,
      status: "completed",
      reveal: true,
      demoSeedId: SEED_ID,
    };
    data[`challengeResults/${fixture.id}`] = resultTree;
  });
  EDUCATORS.forEach((educator) => {
    const access = {
      bootcamps: {act: true},
      subjectsByBootcamp: {act: Object.fromEntries(educator.subjects.map((subject) => [subject, true]))},
      students: {all: true}, groups: {all: true, [GROUP_ID]: true}, platoons: {},
    };
    educatorSchoolRows[educator.id] = {educatorId: educator.id, firstName: educator.firstName, lastName: educator.lastName, displayName: `${educator.firstName} ${educator.lastName}`, email: educator.email, status: "approved", approved: true, adminAccess: Boolean(educator.admin), superAdmin: Boolean(educator.superAdmin), access, approvedAt: planStart, demoSeedId: SEED_ID};
    educatorProfiles[educator.id] = {uid: educator.uid, customUserId: educator.id, firstName: educator.firstName, lastName: educator.lastName, email: educator.email, userType: "educator", accountType: "educator", schoolID: SCHOOL_ID, schoolId: SCHOOL_ID, schoolName: SCHOOL_NAME, corpsName: "United States", battalionName: "Tennessee", platoonName: SCHOOL_NAME, approvalStatus: "approved", status: "approved", approved: true, adminAccess: Boolean(educator.admin), superAdmin: Boolean(educator.superAdmin), avatarNumber: educator.index, avaterNumber: educator.index, bootcamps: {act: true}, subjectsByBootcamp: {act: educator.subjects}, demoSeedId: SEED_ID};
  });

  const school = {
    id: SCHOOL_ID, schoolId: SCHOOL_ID, name: SCHOOL_NAME, country: "United States", state: "Tennessee", timezone: TIMEZONE,
    registrationOpen: false, studentRegistrationOpen: false, educatorRegistrationOpen: false,
    plan: {status: "active", startAt: planStart, endAt: planEnd, educatorSeatLimit: 10, bootcamps: {act: {enabled: true, startAt: planStart, endAt: planEnd}}},
    educators: educatorSchoolRows,
    groups: {admin: {[GROUP_ID]: {groupId: GROUP_ID, name: "Demo Squad", ownerEducatorId: EDUCATORS[0].id, schoolWide: true, createdAt: planStart, updatedAt: planStart, members: groupMembers, demoSeedId: SEED_ID}}},
    educatorDrills: assignmentNodes,
    educatorDrillAttempts: assignmentAttempts,
    demoSeedId: SEED_ID,
  };

  data[`schools/${SCHOOL_ID}`] = school;
  data[`designations/${SCHOOL_ID}`] = false;
  data[`units/corps/United States/Tennessee/${SCHOOL_NAME}`] = {
    // This switch controls leaderboard participation only. Registration stays
    // closed through the school and designation records above.
    platoonPermissions: true,
    registrationOpen: false,
    demoSeedId: SEED_ID,
    members: memberMap,
    totalPoints: Object.values(studentProfiles).reduce((sum, profile) => sum + profile.points, 0),
  };
  Object.entries(educatorProfiles).forEach(([id, profile]) => { data[`educators/${id}`] = profile; data[`roles/${id}`] = "educator"; data[`uidToCustom/${profile.uid}/educator`] = id; });
  PERSONAS.forEach((persona) => {
    const profile = studentProfiles[persona.id];
    const demoSquadMembers = persona.slug === "ethan_brooks" ?
      {
        user_demo_riverview_01: true,
        user_demo_riverview_04: true,
        user_demo_riverview_07: true,
        user_demo_riverview_12: true,
      } :
      persona.slug === "grace_holloway" ?
        {
          user_demo_riverview_01: true,
          user_demo_riverview_02: true,
          user_demo_riverview_06: true,
          user_demo_riverview_12: true,
        } : {};
    const assignedDrills = Object.fromEntries(ASSIGNMENTS.map((assignment) => {
      const path = `users/${persona.id}/assignedDrills/${assignment.id}`;
      const row = data[path];
      delete data[path];
      return [assignment.id, row];
    }));
    data[`users/${persona.id}`] = {...profile, squadMembers: demoSquadMembers,
      userChallenges: challengeInboxes[persona.id],
      assignedDrills, statsIndex: Object.fromEntries(attemptsByStudent[persona.id]
          .map((attempt) => [attempt.attemptId, attempt])),
      stats: statsByStudent[persona.id]};
    data[`studentDrills/${persona.id}`] = sessionsByStudent[persona.id];
    data[`studentSocial/${persona.id}/settings`] = {challengeAudience: "squad_only", profilePublic: true, updatedAt: planStart};
    data[`roles/${persona.id}`] = "student";
    if (persona.auth) data[`uidToCustom/${profile.uid}/student`] = persona.id;
  });

  // Deliberately keep blocked students outside the corresponding squads so
  // both demo logins can exercise block/unblock without inconsistent fixtures.
  data["studentSocial/user_demo_riverview_06/blocks/user_demo_riverview_09"] = {createdAt: planStart};
  data["studentSocialBlockedBy/user_demo_riverview_09/user_demo_riverview_06"] = true;
  data["studentSocial/user_demo_riverview_07/blocks/user_demo_riverview_08"] = {createdAt: planStart};
  data["studentSocialBlockedBy/user_demo_riverview_08/user_demo_riverview_07"] = true;
  data["studentSocial/user_demo_riverview_07/blocks/user_demo_riverview_10"] = {createdAt: planStart};
  data["studentSocialBlockedBy/user_demo_riverview_10/user_demo_riverview_07"] = true;

  const report = buildReport({anchor, questions, datasetVersion, correctionRevision, attemptsByStudent, assignmentNodes, studentProfiles});
  return {seedId: SEED_ID, anchor: anchor.toISOString(), datasetVersion, correctionRevision, data, report, personas: PERSONAS, educators: EDUCATORS, attemptsByStudent, assignmentNodes};
}

function configForQuestions(questions) {
  return SUBJECTS.filter((subject) => questions.some((question) => question.subject === subject)).map((subject) => {
    const rows = questions.filter((question) => question.subject === subject);
    return {subject, modules: [...new Set(rows.map((question) => question.module))], practiceYears: [...new Set(rows.map((question) => Number(question.practiceYear)).filter(Boolean))], questionCount: rows.length, timeLimitMin: Math.max(5, Math.ceil((rows.length * paceBaseline(subject) * 1.35) / 60))};
  });
}

function blueprintForQuestions(questions, datasetVersion, correctionRevision) {
  return {
    datasetVersion,
    correctionRevision,
    subjects: configForQuestions(questions).map((config) => ({
      subject: config.subject,
      timeLimitMin: config.timeLimitMin,
      questionCount: config.questionCount,
      modules: config.modules,
      practiceYears: config.practiceYears,
      questionIds: questions.filter((question) => question.subject === config.subject).map((question) => question.id),
    })),
  };
}

function assignmentSummary(rows) {
  const summaries = rows.map((row) => row.summary || {});
  const submitted = rows.length;
  const attempted = summaries.reduce((sum, row) => sum + Number(row.attempted || 0), 0);
  const correct = summaries.reduce((sum, row) => sum + Number(row.correct || 0), 0);
  const usedSec = summaries.reduce((sum, row) => sum + Number(row.usedSec || 0), 0);
  return {submitted, accuracy: attempted ? round((correct / attempted) * 100) : 0, averageTimeSec: submitted ? Math.round(usedSec / submitted) : 0};
}

function visiblePerformance(attempt) {
  if (attempt.source !== "assignment") return true;
  const release = attempt.release || {};
  return release.scorePolicy === "immediate" || Boolean(release.scoreReleasedAt);
}

function aggregateRows(attempts, filter = () => true) {
  const rows = attempts.filter(filter);
  const attempted = rows.reduce((sum, row) => sum + row.activity.attempted, 0);
  const correct = rows.reduce((sum, row) => sum + row.performance.correct, 0);
  return {sessions: rows.length, attempted, correct, accuracy: attempted ? round((correct / attempted) * 100) : null};
}

function buildReport({anchor, questions, datasetVersion, correctionRevision, attemptsByStudent, assignmentNodes, studentProfiles}) {
  const students = PERSONAS.map((persona) => {
    const attempts = attemptsByStudent[persona.id];
    const visible = attempts.filter(visiblePerformance);
    const overall = aggregateRows(visible);
    const inference = aggregateRows(visible, (attempt) => attempt.modules.some((row) => row.subject === "Reading" && row.module === "Inference and Implication" && row.attempted > 0));
    const inferenceRows = visible.flatMap((attempt) => attempt.modules.filter((row) => row.subject === "Reading" && row.module === "Inference and Implication"));
    const inferenceAttempted = inferenceRows.reduce((sum, row) => sum + row.attempted, 0);
    const inferenceCorrect = inferenceRows.reduce((sum, row) => sum + row.correct, 0);
    return {
      id: persona.id, name: `${persona.firstName} ${persona.lastName}`, sessions: attempts.length,
      attempted: overall.attempted, accuracy: overall.accuracy, points: studentProfiles[persona.id].points,
      rank: studentProfiles[persona.id].currentRank,
      readingInference: {attempted: inferenceAttempted, correct: inferenceCorrect, accuracy: inferenceAttempted ? round((inferenceCorrect / inferenceAttempted) * 100) : null, sessions: inference.sessions},
    };
  });
  const allVisible = Object.values(attemptsByStudent).flat().filter(visiblePerformance);
  const group = aggregateRows(allVisible);
  const threshold = students.reduce((acc, student) => {
    if (!student.readingInference.attempted) acc.noData += 1;
    else if (student.readingInference.accuracy >= 60) acc.meeting += 1;
    else acc.below += 1;
    return acc;
  }, {meeting: 0, below: 0, noData: 0});
  return {
    seedId: SEED_ID, schoolId: SCHOOL_ID, anchor: anchor.toISOString(), rangeStart: new Date(anchor.getTime() - (90 * 86400000)).toISOString(),
    datasetVersion, correctionRevision, catalogQuestions: questions.length,
    counts: {students: PERSONAS.length, educators: EDUCATORS.length, groups: 1, sessions: Object.values(attemptsByStudent).flat().length, assignments: Object.keys(assignmentNodes).length},
    group: {attempted: group.attempted, accuracy: group.accuracy, readingInferenceAt60: threshold}, students,
  };
}

function validateScenario(scenario) {
  const errors = [];
  const {report, data, attemptsByStudent} = scenario;
  const anchorMs = Date.parse(scenario.anchor);
  if (report.counts.students !== 14) errors.push("Expected exactly 14 students");
  if (report.counts.educators !== 4) errors.push("Expected exactly four educators");
  if (report.counts.sessions < 240 || report.counts.sessions > 280) errors.push(`Expected 240-280 sessions, got ${report.counts.sessions}`);
  if (report.group.readingInferenceAt60.meeting !== 10 || report.group.readingInferenceAt60.below !== 3 || report.group.readingInferenceAt60.noData !== 1) errors.push(`Reading inference threshold mismatch: ${JSON.stringify(report.group.readingInferenceAt60)}`);
  if (report.group.accuracy < 74 || report.group.accuracy > 79) errors.push(`Group accuracy ${report.group.accuracy}% is outside 74-79%`);
  const windowCounts = [7, 30, 60, 90].map((days) => Object.values(attemptsByStudent).flat().filter((attempt) => {
    const age = (anchorMs - Date.parse(attempt.submittedAt)) / 86400000;
    return age >= 0 && age <= days;
  }).length);
  if (new Set(windowCounts).size !== windowCounts.length) errors.push(`7/30/60/90-day totals are not distinct: ${windowCounts.join(", ")}`);
  const distribution = Object.values(attemptsByStudent).flat().reduce((value, attempt) => {
    const age = (anchorMs - Date.parse(attempt.submittedAt)) / 86400000;
    if (age >= 60) value.old += 1;
    else if (age >= 30) value.middle += 1;
    else if (age >= 0) value.recent += 1;
    return value;
  }, {old: 0, middle: 0, recent: 0});
  const completed = distribution.old + distribution.middle + distribution.recent;
  if (distribution.old / completed < .15 || distribution.old / completed > .25) errors.push(`Old-session distribution is ${round(distribution.old / completed * 100)}%`);
  if (distribution.middle / completed < .25 || distribution.middle / completed > .36) errors.push(`Middle-session distribution is ${round(distribution.middle / completed * 100)}%`);
  if (distribution.recent / completed < .44 || distribution.recent / completed > .57) errors.push(`Recent-session distribution is ${round(distribution.recent / completed * 100)}%`);
  const questionIds = new Set(normalizedQuestions(BOOTCAMP).filter((question) => !question.disabled).map((question) => question.id));
  PERSONAS.forEach((persona) => {
    const sessions = data[`studentDrills/${persona.id}`] || {};
    Object.values(sessions).filter((session) => session.status === "submitted").forEach((session) => {
      session.questions.forEach((question) => { if (!questionIds.has(question.id)) errors.push(`Unknown/disabled question ${question.id}`); });
      const summary = session.result.summary;
      if (summary.correct + summary.wrong !== summary.attempted) errors.push(`${session.sessionId} attempted mismatch`);
      if (summary.attempted + summary.unanswered !== summary.totalQ) errors.push(`${session.sessionId} total mismatch`);
      if (summary.points !== (3 * summary.correct) + summary.wrong) errors.push(`${session.sessionId} points mismatch`);
      const subjectTotal = session.result.subjects.reduce((sum, row) => sum + row.totalQ, 0);
      if (subjectTotal !== summary.totalQ) errors.push(`${session.sessionId} subject total mismatch`);
    });
    (attemptsByStudent[persona.id] || []).forEach((attempt) => {
      if (attempt.performance.correct + attempt.performance.wrong !== attempt.activity.attempted) errors.push(`${attempt.attemptId} analytics attempted mismatch`);
      if (attempt.activity.attempted + attempt.performance.unanswered !== attempt.activity.totalQuestions) errors.push(`${attempt.attemptId} analytics total mismatch`);
    });
    const user = data[`users/${persona.id}`];
    const expectedPoints = (attemptsByStudent[persona.id] || []).reduce((sum, attempt) => sum + attempt.performance.points, 0);
    if (user.points !== expectedPoints) errors.push(`${persona.id} profile points mismatch`);
    if (user.totalPoints !== expectedPoints) errors.push(`${persona.id} roster points mismatch`);
    if (user.corpsName !== "United States" || user.battalionName !== "Tennessee" || user.platoonName !== SCHOOL_NAME) errors.push(`${persona.id} school aliases mismatch`);
    if (user.currentRank !== rankForPoints(expectedPoints)) errors.push(`${persona.id} rank mismatch`);
    const statsCount = Object.keys(user.stats || {}).length;
    if (statsCount !== (attemptsByStudent[persona.id] || []).length) errors.push(`${persona.id} Test Records count mismatch`);
  });
  const metric = (slug, subject, module, minAge, maxAge) => {
    const persona = PERSONAS.find((row) => row.slug === slug);
    const rows = (attemptsByStudent[persona.id] || []).filter((attempt) => {
      const age = (anchorMs - Date.parse(attempt.submittedAt)) / 86400000;
      return age >= minAge && age < maxAge;
    }).flatMap((attempt) => (attempt.modules || []).filter((row) => row.subject === subject && (!module || row.module === module)));
    const attempted = rows.reduce((sum, row) => sum + row.attempted, 0);
    const correct = rows.reduce((sum, row) => sum + row.correct, 0);
    return {attempted, accuracy: attempted ? correct / attempted * 100 : null};
  };
  const grace = [[60, 91], [30, 60], [0, 30]].map(([min, max]) => metric("grace_holloway", "Reading", "Inference and Implication", min, max));
  if (!(grace[0].attempted >= 15 && grace[0].accuracy >= 45 && grace[0].accuracy <= 55 && grace[1].accuracy >= 55 && grace[1].accuracy <= 62 && grace[2].accuracy >= 70 && grace[2].accuracy <= 80 && grace[0].accuracy < grace[1].accuracy && grace[1].accuracy < grace[2].accuracy)) errors.push(`Grace improvement slope mismatch: ${JSON.stringify(grace)}`);
  const caleb = [[60, 91], [30, 60], [0, 30]].map(([min, max]) => metric("caleb_morgan", "Mathematics", "", min, max));
  if (!(caleb[0].attempted && caleb[1].attempted && caleb[2].attempted && caleb[0].accuracy > caleb[1].accuracy && caleb[1].accuracy > caleb[2].accuracy)) errors.push(`Caleb Math decline mismatch: ${JSON.stringify(caleb)}`);
  const zoe = metric("zoe_williams", "Science", "Data Analysis and Trends", 0, 91);
  const noah = metric("noah_bennett", "Science", "Experimental Design", 0, 91);
  if (!zoe.attempted || zoe.accuracy >= 60) errors.push(`Zoe Data Analysis signal mismatch: ${JSON.stringify(zoe)}`);
  if (!noah.attempted || noah.accuracy >= 60) errors.push(`Noah Experimental Design signal mismatch: ${JSON.stringify(noah)}`);
  const priyaStudent = report.students.find((row) => row.name === "Priya Shah");
  if (!priyaStudent || priyaStudent.accuracy >= 65) errors.push("Priya is not below the overall comprehension threshold");
  const lenaStudent = report.students.find((row) => row.name === "Lena Park");
  const owenStudent = report.students.find((row) => row.name === "Owen Fields");
  if (!lenaStudent || lenaStudent.attempted >= 100) errors.push("Lena no longer has naturally low evidence");
  if (!owenStudent || owenStudent.attempted !== 0) errors.push("Owen should have no completed evidence");
  const school = data[`schools/${SCHOOL_ID}`];
  const unit = data[`units/corps/United States/Tennessee/${SCHOOL_NAME}`];
  if (Object.keys(unit.members || {}).length !== 14 || Object.values(unit.members || {}).some((value) => value !== true)) errors.push("School unit membership is not a 14-member true map");
  EDUCATORS.forEach((educator) => {
    const profile = data[`educators/${educator.id}`];
    const row = school.educators[educator.id];
    if (profile.schoolID !== SCHOOL_ID || profile.schoolId !== SCHOOL_ID) errors.push(`${educator.id} school aliases mismatch`);
    if (row.status !== "approved" || row.access.bootcamps.act !== true || !row.access.subjectsByBootcamp || !row.access.subjectsByBootcamp.act) errors.push(`${educator.id} workspace access mismatch`);
    if (Boolean(row.adminAccess) !== Boolean(educator.admin) || Boolean(row.superAdmin) !== Boolean(educator.superAdmin)) errors.push(`${educator.id} admin flags mismatch`);
  });
  Object.values(school.educatorDrills || {}).forEach((drill) => {
    const submitted = Object.values(drill.assignedStudents || {}).filter((row) => row.status === "submitted");
    const attempts = Object.values(school.educatorDrillAttempts && school.educatorDrillAttempts[drill.drillId] || {}).flatMap((value) => Object.values(value || {}));
    if (submitted.length !== attempts.length || submitted.length !== Number(drill.assignmentSummary && drill.assignmentSummary.submitted || 0)) errors.push(`${drill.drillId} assignment summary mismatch`);
  });
  if (Object.keys(data).some((path) => path.includes("analyticsAttempts"))) errors.push("Legacy analyticsAttempts path was generated");
  return {ok: errors.length === 0, errors};
}

module.exports = {
  ASSIGNMENTS,
  BOOTCAMP,
  EDUCATORS,
  EXPECTED_DATASET_VERSION,
  GROUP_ID,
  PERSONAS,
  SCHOOL_ID,
  SCHOOL_NAME,
  SEED_ID,
  SUBJECTS,
  TIMEZONE,
  generateScenario,
  rankForPoints,
  validateScenario,
};
