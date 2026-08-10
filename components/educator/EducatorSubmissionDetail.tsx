"use client";

import {useEffect, useMemo, useState} from "react";
import DrillCorrections from "@/components/app/DrillCorrections";
import DrillResults from "@/components/app/DrillResults";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction} from "@/lib/api/client";
import {questionText} from "@/lib/drills/text";
import type {DrillAnswerResult, DrillBreakdown, DrillResult} from "@/lib/types/drill";

type Breakdown = {
  subject?: string;
  module?: string;
  totalQ?: number;
  attempted?: number;
  correct?: number;
  wrong?: number;
  unanswered?: number;
  usedSec?: number;
  timeSec?: number;
  time_sec?: number;
  meanSec?: number;
  averageTimeSec?: number;
  accuracyPct?: number;
};

type Answer = {
  questionId: string;
  index: number;
  originalIndex?: number;
  subject: string;
  module: string;
  question: string;
  selectedAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  selectedOptionIdx: number;
  timeTakenMs: number;
  option1: string;
  option2: string;
  option3: string;
  option4: string;
  explanation: string;
  payload: Record<string, unknown>;
};

type Detail = {
  ok: true;
  drill: {title: string; bootcamp: string};
  student: {studentName: string; avatarNumber: number};
  attempt: {
    attemptId: string;
    submittedAt: string;
    startedAt?: string;
    summary: Breakdown & {points: number};
    subjects: Breakdown[];
    modules: Breakdown[];
    answers: Answer[];
  };
};

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function breakdown(row: Breakdown): DrillBreakdown {
  const attempted = number(row.attempted);
  const correct = number(row.correct);
  const totalQ = number(row.totalQ) || attempted;
  const usedSec = number(row.usedSec || row.timeSec || row.time_sec);
  return {
    subject: String(row.subject || "General"),
    module: row.module ? String(row.module) : undefined,
    totalQ,
    attempted,
    correct,
    wrong: number(row.wrong) || Math.max(0, attempted - correct),
    unanswered: number(row.unanswered) || Math.max(0, totalQ - attempted),
    scorePct: attempted > 0 ? Math.round((correct / attempted) * 1000) / 10 : 0,
    usedSec,
    averageTimeSec: number(row.averageTimeSec || row.meanSec) ||
      (attempted > 0 ? usedSec / attempted : 0),
  };
}

function matchingOption(options: string[], answer: string) {
  const target = questionText(answer);
  return target ? options.findIndex((option) => questionText(option) === target) : -1;
}

function answerResult(row: Answer, fallbackPosition: number): DrillAnswerResult {
  const payload = row.payload || {};
  const options = [row.option1, row.option2, row.option3, row.option4].filter(Boolean);
  const selectedByText = matchingOption(options, row.selectedAnswer);
  const explicitSelected = number(row.selectedOptionIdx);
  const selectedIndex = row.selectedAnswer
    ? selectedByText >= 0
      ? selectedByText
      : explicitSelected >= 0 && explicitSelected < options.length
        ? explicitSelected
        : null
    : null;
  const correctIndex = matchingOption(options, row.correctAnswer);
  const prompt = String(payload.prompt || payload.question || payload.questionText || row.question || "");
  return {
    id: row.questionId,
    sourceId: String(payload.sourceId || payload.source_id || row.questionId),
    subject: row.subject || String(payload.subject || "General"),
    module: row.module || String(payload.module || "General"),
    practiceYear: number(payload.practiceYear || payload.practiceTest || payload.practice_year),
    prompt,
    passage: String(payload.passage || payload.reference || ""),
    imageSources: Array.isArray(payload.imageSources)
      ? payload.imageSources.map(String)
      : String(payload.imageSource || payload.image || payload.asset || "")
          .split("|").filter(Boolean),
    options,
    position: number(row.originalIndex || row.index) || fallbackPosition,
    selectedIndex,
    correctIndex,
    isCorrect: row.isCorrect === true,
    timeSpentSec: Math.max(0, Math.round(number(row.timeTakenMs) / 1000)),
    explanation: row.explanation || String(payload.explanation || payload.solution || ""),
  };
}

function resultFromDetail(detail: Detail): DrillResult {
  const summary = detail.attempt.summary;
  const totalQ = number(summary.totalQ) || detail.attempt.answers.length;
  const attempted = number(summary.attempted);
  const correct = number(summary.correct);
  const submittedAt = detail.attempt.submittedAt || new Date().toISOString();
  return {
    sessionId: detail.attempt.attemptId,
    mode: "assignment",
    bootcamp: detail.drill.bootcamp,
    datasetVersion: "assignment",
    takenAt: submittedAt,
    createdAt: detail.attempt.startedAt || submittedAt,
    summary: {
      totalQ,
      attempted,
      correct,
      wrong: number(summary.wrong) || Math.max(0, attempted - correct),
      unanswered: number(summary.unanswered) || Math.max(0, totalQ - attempted),
      points: number(summary.points),
      scorePct: attempted > 0 ? Math.round((correct / attempted) * 1000) / 10 : 0,
      usedSec: number(summary.usedSec),
    },
    subjects: detail.attempt.subjects.map(breakdown),
    modules: detail.attempt.modules.map(breakdown),
    answers: detail.attempt.answers.map((answer, index) => answerResult(answer, index + 1)),
  };
}

export default function EducatorSubmissionDetail({
  bootcamp,
  drillId,
  studentId,
  attemptId,
  review = false,
}: {
  bootcamp: string;
  drillId: string;
  studentId: string;
  attemptId: string;
  review?: boolean;
}) {
  const {user} = useAuth();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    callFunction<Detail>(user, "getEducatorDrillSubmissionDetailHttps", {
      bootcamp,
      drillId,
      studentId,
      attemptId,
    }, {retryTransient: true}).then(setData).catch((reason) => setError((reason as Error).message));
  }, [attemptId, bootcamp, drillId, studentId, user]);

  const result = useMemo(() => data ? resultFromDetail(data) : null, [data]);

  if (!data || !result) {
    if (!error) return <BrandedLoadingOverlay label={review ? "Loading corrections" : "Loading student result"} fixed={false} />;
    return <div className="grid min-h-[60vh] place-items-center p-6 text-sm text-red-700">{error}</div>;
  }

  const encodedStudent = encodeURIComponent(studentId);
  const encodedAttempt = encodeURIComponent(attemptId);
  const dashboardHref = `/app/educator/bootcamps/${bootcamp}/drills/${drillId}`;
  const resultHref = `${dashboardHref}/students/${encodedStudent}?attemptId=${encodedAttempt}`;
  const reviewHref = `${dashboardHref}/students/${encodedStudent}/review?attemptId=${encodedAttempt}`;
  const sharedContext = {
    studentName: data.student.studentName,
    drillTitle: data.drill.title,
    submittedAt: data.attempt.submittedAt,
    dashboardHref,
  };

  return review ? (
    <DrillCorrections
      sessionId={attemptId}
      initialResult={result}
      educatorContext={{...sharedContext, resultHref}}
    />
  ) : (
    <DrillResults
      sessionId={attemptId}
      initialResult={result}
      educatorContext={{...sharedContext, reviewHref}}
    />
  );
}
