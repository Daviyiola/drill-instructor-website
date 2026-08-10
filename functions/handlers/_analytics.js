"use strict";

const {summarizeDays} = require("./_streaks");
/* eslint-disable require-jsdoc, max-len */

const METRIC_VERSION = "analytics-v1";
const DIRI_FORMULA_VERSION = "diri-3.1";
const RELEASE_POLICIES = new Set(["immediate", "on_due_date", "manual"]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function iso(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function round(value, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function normalizeRelease(release) {
  if (!release) return null;
  const scorePolicy = RELEASE_POLICIES.has(release.scorePolicy) ?
    release.scorePolicy : "immediate";
  const correctionPolicy = RELEASE_POLICIES.has(release.correctionPolicy) ?
    release.correctionPolicy : "manual";
  return {
    scorePolicy,
    correctionPolicy,
    scoreReleasedAt: iso(release.scoreReleasedAt),
    correctionsReleasedAt: iso(release.correctionsReleasedAt),
  };
}

function policyReleased(policy, releasedAt, dueAt, now = Date.now()) {
  if (releasedAt && Date.parse(releasedAt) <= now) return true;
  if (policy === "immediate") return true;
  return policy === "on_due_date" && Boolean(dueAt) &&
    Date.parse(dueAt) <= now;
}

function resolveAssignmentRelease(release, dueAt, now = Date.now()) {
  const normalized = normalizeRelease(release) || {
    scorePolicy: "immediate",
    correctionPolicy: "manual",
    scoreReleasedAt: null,
    correctionsReleasedAt: null,
  };
  const correctionsReleased = policyReleased(
      normalized.correctionPolicy,
      normalized.correctionsReleasedAt,
      dueAt,
      now,
  );
  // A closed assignment stamps scoreReleasedAt. A due assignment always
  // releases its score, even when corrections remain educator-controlled.
  const dueReached = Boolean(dueAt) && Date.parse(dueAt) <= now;
  const scoreReleased = correctionsReleased || dueReached || policyReleased(
      normalized.scorePolicy,
      normalized.scoreReleasedAt,
      dueAt,
      now,
  );
  return {...normalized, scoreReleased, correctionsReleased};
}

function analyticsBreakdown(row) {
  return {
    subject: String(row.subject || "General"),
    ...(row.module ? {module: String(row.module)} : {}),
    totalQuestions: number(row.totalQ !== undefined ?
      row.totalQ : row.totalQuestions),
    attempted: number(row.attempted),
    correct: number(row.correct),
    wrong: number(row.wrong),
    unanswered: number(row.unanswered),
    activeTimeSec: number(row.usedSec !== undefined ?
      row.usedSec : row.activeTimeSec),
    allocatedTimeSec: number(row.timeLimitSec !== undefined ?
      row.timeLimitSec : row.allocatedTimeSec),
  };
}

function analyticsAttemptFromResult({
  result,
  session,
  studentId,
  source,
  sourceId,
  schoolId,
  release,
  dueAt,
}) {
  const subjects = (result.subjects || []).map(analyticsBreakdown);
  const activeTimeSec = subjects.reduce(
      (sum, row) => sum + row.activeTimeSec,
      0,
  );
  return {
    attemptId: String(result.sessionId || session.sessionId),
    studentId: String(studentId),
    bootcamp: String(result.bootcamp || session.bootcamp || "").toLowerCase(),
    source,
    sourceId: String(sourceId || result.sessionId || session.sessionId),
    ...(schoolId ? {schoolId: String(schoolId)} : {}),
    ...(dueAt ? {dueAt: String(dueAt)} : {}),
    submittedAt: String(result.createdAt || new Date().toISOString()),
    bootcampSubmittedAt: `${String(
        result.bootcamp || session.bootcamp || "",
    ).toLowerCase()}|${String(result.createdAt || new Date().toISOString())}`,
    activity: {
      totalQuestions: number(result.summary && result.summary.totalQ),
      attempted: number(result.summary && result.summary.attempted),
      activeTimeSec,
      elapsedTimeSec: number(result.summary && result.summary.usedSec),
    },
    performance: {
      correct: number(result.summary && result.summary.correct),
      wrong: number(result.summary && result.summary.wrong),
      unanswered: number(result.summary && result.summary.unanswered),
      points: number(result.summary && result.summary.points),
    },
    subjects,
    modules: (result.modules || []).map(analyticsBreakdown),
    practiceYears: [...new Set((session.questions || [])
        .map((question) => number(question.practiceYear))
        .filter(Boolean))],
    practiceYearsBySubject: (session.questions || []).reduce(
        (bySubject, question) => {
          const subject = String(question.subject || "").trim();
          const year = number(question.practiceYear);
          if (!subject || !year) return bySubject;
          bySubject[subject] = [...new Set(
              (bySubject[subject] || []).concat(year),
          )].sort((a, b) => a - b);
          return bySubject;
        },
        {},
    ),
    release: source === "assignment" ? normalizeRelease(release) : null,
    metricVersion: METRIC_VERSION,
  };
}

function scoreIsVisible(attempt, now = Date.now()) {
  if (attempt.source !== "assignment") return true;
  return resolveAssignmentRelease(
      attempt.release,
      attempt.dueAt || null,
      now,
  ).scoreReleased;
}

function projectAttempt(attempt, {educator = false, now = Date.now()} = {}) {
  const visible = educator || scoreIsVisible(attempt, now);
  return {
    ...attempt,
    performance: visible ? attempt.performance : null,
    subjects: (attempt.subjects || []).map((row) => ({
      ...row,
      correct: visible ? row.correct : null,
      wrong: visible ? row.wrong : null,
    })),
    modules: (attempt.modules || []).map((row) => ({
      ...row,
      correct: visible ? row.correct : null,
      wrong: visible ? row.wrong : null,
    })),
    scoreVisible: visible,
  };
}

function sumRows(rows) {
  const summary = rows.reduce((total, row) => ({
    totalQuestions: total.totalQuestions + number(row.totalQuestions),
    attempted: total.attempted + number(row.attempted),
    correct: total.correct + number(row.correct),
    wrong: total.wrong + number(row.wrong),
    unanswered: total.unanswered + number(row.unanswered),
    activeTimeSec: total.activeTimeSec + number(row.activeTimeSec),
    allocatedTimeSec: total.allocatedTimeSec + number(row.allocatedTimeSec),
  }), {
    totalQuestions: 0,
    attempted: 0,
    correct: 0,
    wrong: 0,
    unanswered: 0,
    activeTimeSec: 0,
    allocatedTimeSec: 0,
  });
  return {
    ...summary,
    accuracy: summary.attempted ?
      round(summary.correct / summary.attempted * 100) : null,
    averageTimeSec: summary.attempted ?
      round(summary.activeTimeSec / summary.attempted) : null,
  };
}

function aggregateBreakdowns(attempts, key) {
  const groups = new Map();
  attempts.forEach((attempt) => {
    if (!attempt.scoreVisible) return;
    (attempt[key] || []).forEach((row) => {
      const id = key === "modules" ?
        `${row.subject}\u0000${row.module}` : row.subject;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(row);
    });
  });
  return [...groups.entries()].map(([id, rows]) => ({
    ...(key === "modules" ? {
      subject: id.split("\u0000")[0],
      module: id.split("\u0000")[1],
    } : {subject: id}),
    ...sumRows(rows),
    sampleSize: rows.reduce((sum, row) => sum + number(row.attempted), 0),
  })).sort((a, b) => b.sampleSize - a.sampleSize);
}

function dayKey(value, timezone = "UTC") {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const get = (type) => parts.find((part) => part.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch (_) {
    return new Date(value).toISOString().slice(0, 10);
  }
}

function streaks(days, now, timezone) {
  const summary = summarizeDays(
      Object.fromEntries([...new Set(days)].map((day) => [day, true])),
      {now, timezone},
  );
  return {current: summary.current, best: summary.best};
}

function periodOverview(attempts) {
  const visible = attempts.filter((attempt) => attempt.scoreVisible);
  const performance = visible.reduce((total, attempt) => ({
    correct: total.correct + number(attempt.performance.correct),
    wrong: total.wrong + number(attempt.performance.wrong),
    points: total.points + number(attempt.performance.points),
  }), {correct: 0, wrong: 0, points: 0});
  const activity = attempts.reduce((total, attempt) => ({
    attempts: total.attempts + number(attempt.activity.attempted),
    activeTimeSec: total.activeTimeSec + number(attempt.activity.activeTimeSec),
    sessions: total.sessions + 1,
  }), {attempts: 0, activeTimeSec: 0, sessions: 0});
  const gradedAttempts = performance.correct + performance.wrong;
  return {
    accuracy: gradedAttempts ? round(performance.correct / gradedAttempts * 100) : null,
    attempts: activity.attempts,
    gradedAttempts,
    activeTimeSec: activity.activeTimeSec,
    averageTimeSec: activity.attempts ?
      round(activity.activeTimeSec / activity.attempts) : null,
    sessions: activity.sessions,
    points: performance.points,
  };
}

function trend(attempts, startAt, endAt, timezone, granularity) {
  const bucketMs = granularity === "month" ? 28 * 86400000 :
    granularity === "week" ? 7 * 86400000 : 86400000;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const buckets = [];
  for (let cursor = start; cursor <= end; cursor += bucketMs) {
    const upper = Math.min(end + 1, cursor + bucketMs);
    const rows = attempts.filter((attempt) => {
      const submitted = Date.parse(attempt.submittedAt);
      return submitted >= cursor && submitted < upper;
    });
    const overview = periodOverview(rows);
    buckets.push({
      startAt: new Date(cursor).toISOString(),
      label: granularity === "day" ? dayKey(cursor, timezone) :
        `${dayKey(cursor, timezone)}–${dayKey(upper - 1, timezone)}`,
      accuracy: overview.accuracy,
      attempts: overview.attempts,
      activeTimeSec: overview.activeTimeSec,
      averageTimeSec: overview.averageTimeSec,
      sessions: overview.sessions,
      points: overview.points,
    });
  }
  return buckets;
}

function readiness(attempts, catalog, now = Date.now(), focusedSubject = "") {
  const cutoff = now - 90 * 86400000;
  const recent = attempts.filter((attempt) => Date.parse(attempt.submittedAt) >= cutoff);
  const visible = recent.filter((attempt) => attempt.scoreVisible !== false);
  const gradedRows = visible.flatMap((attempt) => (attempt.subjects || [])
      .filter((row) => !focusedSubject || row.subject === focusedSubject));
  const totals = sumRows(gradedRows);
  const minimum = focusedSubject ? 40 : 100;
  if (totals.attempted < minimum) {
    return {
      status: "insufficient_data",
      score: null,
      confidence: round(Math.min(1, totals.attempted / minimum), 2),
      contributingAttempts: totals.attempted,
      requiredAttempts: minimum,
      includedSubjects: [...new Set(gradedRows.map((row) => row.subject))],
      formulaVersion: DIRI_FORMULA_VERSION,
      pillars: null,
    };
  }
  const accuracy = totals.accuracy || 0;
  const pacingRatios = gradedRows.filter((row) => row.attempted > 0)
      .map((row) => {
        const actual = row.activeTimeSec / row.attempted;
        const allocation = row.allocatedTimeSec && row.totalQuestions ?
          row.allocatedTimeSec / row.totalQuestions : 60;
        return Math.min(1, allocation / Math.max(1, actual));
      });
  const pacing = pacingRatios.length ?
    pacingRatios.reduce((sum, value) => sum + value, 0) / pacingRatios.length * 100 : 50;
  const performance = accuracy * .8 + pacing * .2;
  const days = recent.map((row) => dayKey(row.submittedAt));
  const activeDays = new Set(days).size;
  const freshDays = recent.length ?
    Math.max(0, (now - Math.max(...recent.map((row) => Date.parse(row.submittedAt)))) / 86400000) : 90;
  const volume = Math.min(100, 100 * Math.log1p(totals.attempted) / Math.log1p(500));
  const consistency = .45 * volume + .35 * Math.min(100, activeDays / 24 * 100) +
    .2 * Math.max(0, 100 - freshDays * 2.5);
  const catalogSubjects = (catalog && catalog.subjects || [])
      .filter((row) => !focusedSubject || row.name === focusedSubject);
  const includedSubjects = [...new Set(gradedRows.map((row) => row.subject))];
  // Coverage is progressive: it assesses breadth relative to the amount of
  // work completed, rather than requiring a student to touch the whole catalog.
  // Pending assignments intentionally participate here as activity/coverage,
  // though their scores remain absent from Performance.
  const coverageAttempts = recent.reduce((sum, attempt) => sum +
    number(attempt.activity && attempt.activity.attempted), 0);
  const expectedDistinct = (volume, cadence, available) => available ?
    Math.min(available, 1 + Math.floor(Math.max(0, volume - 1) / cadence)) : 0;
  const recentSubjectAttempts = {};
  const recentModuleAttempts = {};
  recent.forEach((attempt) => {
    (attempt.subjects || []).forEach((row) => {
      recentSubjectAttempts[row.subject] = number(recentSubjectAttempts[row.subject]) +
        number(row.attempted);
    });
    (attempt.modules || []).forEach((row) => {
      const key = `${row.subject}\u0000${row.module}`;
      recentModuleAttempts[key] = number(recentModuleAttempts[key]) +
        number(row.attempted);
    });
  });
  const subjectRequired = expectedDistinct(coverageAttempts, 40, catalogSubjects.length);
  const meaningfulSubjects = catalogSubjects.filter((row) =>
    number(recentSubjectAttempts[row.name]) >= 10).length;
  const subjectCoverage = subjectRequired ?
    Math.min(1, meaningfulSubjects / subjectRequired) : 0;
  let modulesRequired = 0;
  let meaningfulModules = 0;
  let testsRequired = 0;
  let meaningfulTests = 0;
  catalogSubjects.forEach((catalogSubject) => {
    const subject = catalogSubject.name;
    const subjectAttempts = number(recentSubjectAttempts[subject]);
    const availableModules = catalogSubject.modules || [];
    const requiredModules = expectedDistinct(subjectAttempts, 20,
        availableModules.length);
    modulesRequired += requiredModules;
    meaningfulModules += availableModules.filter((module) =>
      number(recentModuleAttempts[`${subject}\u0000${module}`]) >= 5).length;

    const subjectSessions = recent.filter((attempt) => (attempt.subjects || [])
        .some((row) => row.subject === subject && number(row.attempted) > 0));
    const availableTests = catalogSubject.practiceYears || [];
    const requiredTests = expectedDistinct(subjectSessions.length, 5,
        availableTests.length);
    testsRequired += requiredTests;
    const usedTests = new Set(subjectSessions.flatMap((attempt) =>
      (attempt.practiceYearsBySubject &&
       attempt.practiceYearsBySubject[subject]) || attempt.practiceYears || []));
    meaningfulTests += [...usedTests].filter((year) =>
      availableTests.includes(year)).length;
  });
  const moduleCoverage = modulesRequired ?
    Math.min(1, meaningfulModules / modulesRequired) : 0;
  const yearCoverage = testsRequired ?
    Math.min(1, meaningfulTests / testsRequired) : 0;
  const coverage = (subjectCoverage * .4 + moduleCoverage * .3 + yearCoverage * .3) * 100;
  const score = round(performance * .4 + consistency * .3 + coverage * .3);
  return {
    status: "estimated",
    score,
    band: score >= 85 ? "Ready" : score >= 70 ? "Almost" :
      score >= 55 ? "Building" : "Foundation",
    confidence: round(Math.min(1, .55 + totals.attempted / 1000), 2),
    contributingAttempts: totals.attempted,
    requiredAttempts: minimum,
    includedSubjects,
    formulaVersion: DIRI_FORMULA_VERSION,
    pillars: {
      performance: round(performance),
      consistency: round(consistency),
      coverage: round(coverage),
    },
  };
}

function aggregateAnalytics(rawAttempts, options, catalog, now = Date.now()) {
  const start = Date.parse(options.startAt);
  const end = Date.parse(options.endAt);
  const subject = String(options.subject || "");
  const source = String(options.source || "all");
  const bootcampAttempts = rawAttempts
      // Development cutover: ignore old statsIndex list rows. Canonical rows
      // always carry source, submittedAt and nested activity metrics.
      .filter((attempt) => attempt && attempt.activity && attempt.source &&
        attempt.submittedAt)
      .map((attempt) => projectAttempt(attempt, {
        now,
        educator: options.educator === true,
      }))
      .filter((attempt) => attempt.bootcamp === options.bootcamp);
  let prepared = bootcampAttempts
      .filter((attempt) => source === "all" || attempt.source === source)
      .filter((attempt) => !subject || (attempt.subjects || [])
          .some((row) => row.subject === subject));
  if (subject) {
    prepared = prepared.map((attempt) => {
      const subjects = (attempt.subjects || [])
          .filter((row) => row.subject === subject);
      const modules = (attempt.modules || [])
          .filter((row) => row.subject === subject);
      const activity = sumRows(subjects);
      const performance = attempt.scoreVisible ? {
        correct: activity.correct,
        wrong: activity.wrong,
        unanswered: activity.unanswered,
        points: activity.correct * 3 + activity.wrong,
      } : null;
      return {
        ...attempt,
        activity: {
          totalQuestions: activity.totalQuestions,
          attempted: activity.attempted,
          activeTimeSec: activity.activeTimeSec,
          elapsedTimeSec: activity.activeTimeSec,
        },
        performance,
        subjects,
        modules,
      };
    });
  }
  const current = prepared.filter((attempt) => {
    const submitted = Date.parse(attempt.submittedAt);
    return submitted >= start && submitted <= end;
  });
  const currentOverview = periodOverview(current);
  const days = current.map((attempt) => dayKey(
      attempt.submittedAt,
      options.timezone,
  ));
  const subjectRows = aggregateBreakdowns(current, "subjects");
  const moduleRows = aggregateBreakdowns(current, "modules");
  // Coverage is activity-facing, so pending-score assignments count here even
  // while their accuracy stays out of score-facing subject/module aggregates.
  const coveredSubjects = new Set();
  const coveredModules = new Set();
  const coveredPracticeTests = new Set();
  current.forEach((attempt) => {
    (attempt.subjects || []).forEach((row) => {
      if (number(row.attempted) > 0 && row.subject) {
        coveredSubjects.add(String(row.subject));
      }
    });
    (attempt.modules || []).forEach((row) => {
      if (number(row.attempted) > 0 && row.subject && row.module) {
        coveredModules.add(`${row.subject}\u0000${row.module}`);
      }
    });
    (attempt.practiceYears || []).map(number).filter(Boolean)
        .forEach((practiceTest) => coveredPracticeTests.add(practiceTest));
  });
  const moduleFocusAreas = moduleRows
      .sort((a, b) =>
        (a.accuracy === null ? 101 : a.accuracy) -
        (b.accuracy === null ? 101 : b.accuracy))
      .slice(0, 6).map((row) => ({
        level: "module",
        subject: row.subject,
        module: row.module,
        accuracy: row.accuracy,
        sampleSize: row.sampleSize,
        drillConfig: {
          bootcamp: options.bootcamp,
          subject: row.subject,
          modules: [row.module],
          questionCount: Math.min(20, Math.max(10, row.sampleSize)),
        },
      }));
  const subjectFocusAreas = subjectRows
      .sort((a, b) =>
        (a.accuracy === null ? 101 : a.accuracy) -
        (b.accuracy === null ? 101 : b.accuracy))
      .slice(0, 6).map((row) => ({
        level: "subject",
        subject: row.subject,
        module: "",
        accuracy: row.accuracy,
        sampleSize: row.sampleSize,
        drillConfig: {
          bootcamp: options.bootcamp,
          subject: row.subject,
          modules: [],
          questionCount: Math.min(20, Math.max(10, row.sampleSize)),
        },
      }));
  return {
    overview: {
      ...currentOverview,
      activeDays: new Set(days).size,
      subjectCount: coveredSubjects.size,
      moduleCount: coveredModules.size,
      practiceTestCount: coveredPracticeTests.size,
    },
    trend: trend(current, options.startAt, options.endAt,
        options.timezone, options.granularity),
    subjects: subjectRows,
    modules: moduleRows,
    // Keep both levels available. A subject recommendation is not a fallback for
    // a module recommendation: the client can show subjects in its overall view
    // and modules when the student drills into a subject.
    focusAreas: moduleFocusAreas,
    subjectFocusAreas,
    moduleFocusAreas,
    // DIRI always uses the complete recent bootcamp window, irrespective of
    // date range or source filters. A subject focus deliberately recalculates
    // the readiness signal for that subject, matching the native analytics UI.
    readiness: readiness(bootcampAttempts, catalog, now, options.subject),
    activity: {
      ...streaks(days, now, options.timezone),
      days: [...new Set(days)].sort().map((day) => ({
        day,
        sessions: days.filter((value) => value === day).length,
      })),
    },
    excludedPendingScores: current.filter((attempt) => !attempt.scoreVisible).length,
    metricVersion: METRIC_VERSION,
    generatedAt: new Date(now).toISOString(),
  };
}

/**
 * Compact, answer-free session coordinates for native client caches.
 * @param {Object[]} rawAttempts canonical statsIndex rows
 * @param {Object} options analytics request options
 * @return {Object[]} session coordinates within the requested display range
 */
function activitySessions(rawAttempts, options) {
  const start = Date.parse(options.startAt);
  const end = Date.parse(options.endAt);
  const source = String(options.source || "all");
  const subject = String(options.subject || "").trim().toLowerCase();
  return rawAttempts.filter((attempt) => attempt && attempt.activity &&
      attempt.source && attempt.submittedAt &&
      String(attempt.bootcamp || "").toLowerCase() === options.bootcamp)
      .filter((attempt) => {
        const submitted = Date.parse(attempt.submittedAt);
        return submitted >= start && submitted <= end;
      })
      .filter((attempt) => source === "all" || attempt.source === source)
      .filter((attempt) => !subject || (attempt.subjects || []).some((row) =>
        String(row.subject || "").toLowerCase() === subject &&
        number(row.attempted) > 0))
      .map((attempt) => ({
        attemptId: String(attempt.attemptId || attempt.sourceId || ""),
        submittedAt: String(attempt.submittedAt),
        source: String(attempt.source),
        subjects: [...new Set((attempt.subjects || [])
            .filter((row) => number(row.attempted) > 0)
            .map((row) => String(row.subject || "").trim())
            .filter(Boolean))],
        practiceYears: [...new Set((attempt.practiceYears || [])
            .map(number).filter(Boolean))].sort((a, b) => a - b),
      })).filter((row) => Boolean(row.attemptId));
}

const GROUP_THRESHOLD_METRICS = new Set([
  "attempts", "correct", "accuracy", "avgTime",
]);

function groupThresholdMetric(value) {
  const metric = String(value || "accuracy");
  return GROUP_THRESHOLD_METRICS.has(metric) ? metric : "accuracy";
}

function defaultGroupThreshold(metric) {
  if (metric === "attempts") return 20;
  if (metric === "correct") return 15;
  if (metric === "avgTime") return 90;
  return 60;
}

function groupMetricValue(row, metric) {
  const attempted = number(row && (row.attempted !== undefined ?
    row.attempted : row.overview && row.overview.attempts));
  if (!attempted) return null;
  const correct = number(row && (row.correct !== undefined ?
    row.correct : row.overview && row.overview.accuracy !== null ?
      attempted * number(row.overview.accuracy) / 100 : 0));
  const activeTimeSec = number(row && (row.activeTimeSec !== undefined ?
    row.activeTimeSec : row.overview && row.overview.activeTimeSec));
  if (metric === "attempts") return attempted;
  if (metric === "correct") return correct;
  if (metric === "avgTime") return activeTimeSec / attempted;
  return correct / attempted * 100;
}

function groupMetricPasses(value, metric, threshold) {
  if (value === null) return false;
  return metric === "avgTime" ? value <= threshold : value >= threshold;
}

function compactStudentAnalytics(row) {
  return {
    studentId: row.studentId,
    analytics: {
      overview: row.analytics.overview,
      subjects: row.analytics.subjects,
      modules: row.analytics.modules,
      metricVersion: row.analytics.metricVersion,
      generatedAt: row.analytics.generatedAt,
    },
  };
}

function groupComprehension(students, combinedRows, level, metric, threshold) {
  return combinedRows.map((combined) => {
    const subject = String(combined.subject || "General");
    const module = level === "modules" ?
      String(combined.module || "General") : "";
    const below = [];
    const noData = [];
    let met = 0;

    students.forEach((student) => {
      const rows = student.analytics[level] || [];
      const row = rows.find((candidate) =>
        String(candidate.subject || "General") === subject &&
        (level !== "modules" ||
          String(candidate.module || "General") === module));
      const value = groupMetricValue(row, metric);
      if (value === null) {
        noData.push(student.studentId);
      } else if (groupMetricPasses(value, metric, threshold)) {
        met += 1;
      } else {
        below.push({studentId: student.studentId, value: round(value)});
      }
    });

    const total = students.length;
    return {
      id: level === "modules" ? `${subject}\u0000${module}` : subject,
      name: level === "modules" ? module : subject,
      subject,
      ...(level === "modules" ? {module} : {}),
      percentMet: total ? round(met / total * 100) : 0,
      met,
      total,
      below,
      noData,
    };
  }).sort((left, right) => left.percentMet - right.percentMet ||
    right.noData.length - left.noData.length ||
    left.name.localeCompare(right.name));
}

function aggregateGroup(studentAttempts, options, catalog, now = Date.now()) {
  const combined = aggregateAnalytics(
      Object.values(studentAttempts).flat(),
      {...options, educator: true},
      catalog,
      now,
  );
  const students = Object.entries(studentAttempts).map(([studentId, attempts]) => ({
    studentId,
    analytics: aggregateAnalytics(attempts, options, catalog, now),
  }));
  const contributing = students.filter((row) => row.analytics.overview.gradedAttempts > 0);
  const correct = contributing.reduce((sum, row) => sum +
    row.analytics.overview.accuracy / 100 * row.analytics.overview.gradedAttempts, 0);
  const attempted = contributing.reduce((sum, row) => sum +
    row.analytics.overview.gradedAttempts, 0);
  const accuracies = contributing.map((row) => row.analytics.overview.accuracy)
      .sort((a, b) => a - b);
  const median = accuracies.length ? (accuracies.length % 2 ?
    accuracies[Math.floor(accuracies.length / 2)] :
    (accuracies[accuracies.length / 2 - 1] + accuracies[accuracies.length / 2]) / 2) : null;
  const thresholdMetric = groupThresholdMetric(options.thresholdMetric);
  const threshold = number(options.threshold !== undefined ?
    options.threshold : defaultGroupThreshold(thresholdMetric));
  const overallRows = students.map((row) => ({
    studentId: row.studentId,
    value: groupMetricValue({overview: row.analytics.overview}, thresholdMetric),
  }));
  const overallWithData = overallRows.filter((row) => row.value !== null);
  const overallMeeting = overallWithData.filter((row) =>
    groupMetricPasses(row.value, thresholdMetric, threshold));
  return {
    questionWeightedAccuracy: attempted ? round(correct / attempted * 100) : null,
    medianStudentAccuracy: median === null ? null : round(median),
    contributingStudentCount: contributing.length,
    percentageMeetingThreshold: students.length ? round(
        overallMeeting.length / students.length * 100,
    ) : null,
    belowThresholdStudents: overallWithData.filter((row) =>
      !groupMetricPasses(row.value, thresholdMetric, threshold))
        .map((row) => row.studentId),
    noDataStudents: overallRows.filter((row) => row.value === null)
        .map((row) => row.studentId),
    overview: combined.overview,
    trend: combined.trend,
    subjects: combined.subjects,
    modules: combined.modules,
    threshold,
    thresholdMetric,
    comprehension: {
      metric: thresholdMetric,
      threshold,
      subjects: groupComprehension(
          students, combined.subjects, "subjects", thresholdMetric, threshold),
      modules: groupComprehension(
          students, combined.modules, "modules", thresholdMetric, threshold),
    },
    students: students.map(compactStudentAnalytics),
  };
}

module.exports = {
  DIRI_FORMULA_VERSION,
  METRIC_VERSION,
  aggregateAnalytics,
  activitySessions,
  aggregateGroup,
  groupComprehension,
  analyticsAttemptFromResult,
  normalizeRelease,
  projectAttempt,
  readiness,
  resolveAssignmentRelease,
  scoreIsVisible,
};
