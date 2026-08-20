"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import type {
  DrillAnswerResult,
  DrillBreakdown,
  DrillCatalog,
  DrillCredit,
  DrillResult,
} from "@/lib/types/drill";
import {useAuth} from "./AuthProvider";
import ResultChallengeComposer from "./ResultChallengeComposer";

function duration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0));
  return safe < 60
    ? `${safe}s`
    : `${Math.floor(safe / 60)}m ${String(safe % 60).padStart(2, "0")}s`;
}

function scoreColor(score: number) {
  if (score >= 70) return "#4B5320";
  if (score >= 45) return "#E8B44B";
  return "#B71C1C";
}

function mixedCase(value: string) {
  const words = String(value || "General")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/);
  const minorWords = new Set(["and", "or", "of", "the", "in", "to", "for"]);
  return words
    .map((word, index) =>
      index > 0 && minorWords.has(word)
        ? word
        : word.replace(/^([a-z])/, (letter) => letter.toLocaleUpperCase()),
    )
    .join(" ");
}

function wasAttempted(answer: DrillAnswerResult) {
  return (
    Number.isInteger(answer.selectedIndex) &&
    Number(answer.selectedIndex) >= 0 &&
    Number(answer.selectedIndex) < answer.options.length
  );
}

function buildModuleBreakdowns(answers: DrillAnswerResult[]) {
  const groups = new Map<string, DrillAnswerResult[]>();
  answers.forEach((answer) => {
    const module = String(answer.module || "General").trim() || "General";
    const key = `${answer.subject}\u0000${module}`;
    groups.set(key, [...(groups.get(key) || []), answer]);
  });
  return [...groups.entries()].map(([key, rows]) => {
    const [subject, module] = key.split("\u0000");
    const attemptedRows = rows.filter(wasAttempted);
    const correct = attemptedRows.filter((row) => row.isCorrect).length;
    const usedSec = attemptedRows.reduce(
      (total, row) => total + Math.max(0, Number(row.timeSpentSec || 0)),
      0,
    );
    return {
      subject,
      module,
      totalQ: rows.length,
      attempted: attemptedRows.length,
      correct,
      wrong: attemptedRows.length - correct,
      unanswered: rows.length - attemptedRows.length,
      scorePct: attemptedRows.length
        ? Math.round((correct / attemptedRows.length) * 1000) / 10
        : 0,
      usedSec,
      averageTimeSec: attemptedRows.length
        ? Math.round((usedSec / attemptedRows.length) * 10) / 10
        : 0,
    };
  });
}

function BreakdownRows({
  rows,
  showModule = false,
}: {
  rows: DrillBreakdown[];
  showModule?: boolean;
}) {
  if (!rows.length) {
    return (
      <p className="rounded-2xl bg-brand-mist p-5 text-sm text-slate-600">
        This breakdown will appear for drills graded with the updated drill
        service.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {rows.map((row, index) => (
        <div
          key={`${row.subject}-${row.module || ""}-${index}`}
          className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(110px,.55fr)_minmax(110px,.55fr)] sm:items-stretch"
        >
          <div className="min-w-0 rounded-xl bg-brand-green px-4 py-3 text-white sm:px-5">
            <p className="truncate text-sm font-normal">
              {showModule ? mixedCase(row.module || "General") : row.subject}
            </p>
          </div>
          <div className="rounded-xl bg-brand-green px-4 py-3 text-white sm:text-center">
            <p className="text-[10px] font-normal uppercase tracking-wider text-white/60 sm:hidden">
              Attempt score
            </p>
            <p className="text-base font-normal">
              {row.correct}/{row.attempted}
              <span className="ml-2 text-xs font-normal text-white/65">
                {row.attempted > 0
                  ? Math.round((row.correct / row.attempted) * 100)
                  : 0}%
              </span>
            </p>
          </div>
          <div className="rounded-xl bg-brand-green px-4 py-3 text-white sm:text-center">
            <p className="text-[10px] font-normal uppercase tracking-wider text-white/60 sm:hidden">
              Total time
            </p>
            <p className="text-base font-normal">
              {duration(row.usedSec || 0)}
              <span className="ml-2 text-xs font-normal text-white/65">
                {duration(
                  row.averageTimeSec ||
                    (row.attempted > 0 ? (row.usedSec || 0) / row.attempted : 0),
                )} mean
              </span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DrillResults({
  sessionId,
  fromRecords = false,
  fromChallenges = false,
  initialResult,
  educatorContext,
}: {
  sessionId: string;
  fromRecords?: boolean;
  fromChallenges?: boolean;
  initialResult?: DrillResult;
  educatorContext?: {
    studentName: string;
    drillTitle: string;
    submittedAt: string;
    dashboardHref: string;
    reviewHref: string;
  };
}) {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [result, setResult] = useState<DrillResult | null>(initialResult || null);
  const [credit, setCredit] = useState<DrillCredit | null>(null);
  const [view, setView] = useState<"subject" | "module">("subject");
  const [moduleSubject, setModuleSubject] = useState("");
  const [showChallenge, setShowChallenge] = useState(false);
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialResult) setResult(initialResult);
  }, [initialResult]);

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (initialResult) return;
    if (!user) return;
    callFunction<
      {ok: true; result: DrillResult; credit: DrillCredit | null},
      {sessionId: string}
    >(user, "getStudentDrillResultHttps", {sessionId}, {retryTransient: true})
      .then((response) => {
        setResult(response.result);
        setCredit(response.credit);
        callFunction<DrillCatalog, {bootcamp: string}>(
          user,
          "getStudentDrillCatalogHttps",
          {bootcamp: response.result.bootcamp},
        )
          .then((catalog) => setSubscriptionActive(catalog.licensed))
          .catch(() => setSubscriptionActive(false));
      })
      .catch((reason) => setError((reason as Error).message));
  }, [initialResult, sessionId, user]);

  const moduleSubjects = useMemo(
    () => [
      ...new Set(
        buildModuleBreakdowns(result?.answers || []).map((row) => row.subject),
      ),
    ],
    [result],
  );
  const derivedModules = useMemo(
    () => buildModuleBreakdowns(result?.answers || []),
    [result],
  );

  useEffect(() => {
    if (view !== "module" || !moduleSubjects.length) return;
    if (!moduleSubjects.includes(moduleSubject)) {
      setModuleSubject(moduleSubjects[0]);
    }
  }, [moduleSubject, moduleSubjects, view]);

  if (!result) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-slate-600">
        {error || "Preparing your results…"}
      </div>
    );
  }

  const summary = result.summary;
  const accuracy =
    summary.attempted > 0
      ? Math.round((summary.correct / summary.attempted) * 100)
      : 0;
  const accent = scoreColor(accuracy);
  const activeUsedSec = result.subjects?.length
    ? result.subjects.reduce(
        (total, subject) => total + Math.max(0, Number(subject.usedSec || 0)),
        0,
      )
    : result.answers?.length
      ? result.answers.reduce(
          (total, answer) =>
            total + Math.max(0, Number(answer.timeSpentSec || 0)),
          0,
        )
      : summary.usedSec;
  const attemptedMean =
    summary.attempted > 0 ? activeUsedSec / summary.attempted : 0;
  const modules = derivedModules.length ? derivedModules : result.modules || [];
  const filteredModules = modules.filter((row) =>
    moduleSubject ? row.subject === moduleSubject : true,
  );
  const rows = view === "subject" ? result.subjects || [] : filteredModules;
  const canShareResult = !educatorContext && result.mode !== "assignment";

  return (
    <main className="min-h-screen bg-brand-mist text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className={`mx-auto flex h-16 max-w-7xl items-center px-5 sm:px-8 ${educatorContext ? "justify-between gap-4" : "justify-center"}`}>
          <p className="text-xl font-black tracking-tight text-brand-green sm:text-2xl">
            RESULTS
          </p>
          {educatorContext && (
            <Link
              href={educatorContext.dashboardHref}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-700 transition hover:border-brand-green/35 hover:bg-brand-mist sm:px-4 sm:text-sm"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-mist">
                <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
              </span>
              <span className="hidden sm:inline">Back to drill dashboard</span>
              <span className="sm:hidden">Dashboard</span>
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:py-10">
        {educatorContext && (
          <section className="mb-7 rounded-[2rem] border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-7">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-green/60">
              Student submission
            </p>
            <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
              <div>
                <h1 className="text-2xl font-normal text-slate-950">{educatorContext.studentName}</h1>
                <p className="mt-1 text-sm text-slate-600">{educatorContext.drillTitle}</p>
              </div>
              <p className="text-xs text-slate-500">
                Submitted {new Date(educatorContext.submittedAt).toLocaleString()}
              </p>
            </div>
          </section>
        )}
        <section className="mx-auto w-full max-w-5xl">
          <div className="flex flex-col items-center gap-5 lg:flex-row lg:justify-center lg:gap-9">
            <div className="mx-auto w-full max-w-[290px]">
              <div className="relative mx-auto h-36 w-72 max-w-full overflow-hidden">
                <div
                  className="absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full"
                  style={{
                    background: `conic-gradient(from 270deg, ${accent} 0deg ${accuracy * 1.8}deg, #d9d1cf ${accuracy * 1.8}deg 180deg, transparent 180deg 360deg)`,
                  }}
                />
                <div className="absolute left-1/2 top-9 h-56 w-56 -translate-x-1/2 rounded-full bg-brand-mist" />
                <div className="absolute inset-x-0 bottom-1 text-center">
                  <p className="text-5xl font-normal text-slate-950">
                    {accuracy}%
                  </p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                    Attempted accuracy
                  </p>
                </div>
              </div>
              <div className="mt-4 flex justify-center gap-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{backgroundColor: accent}}
                  />
                  Correct
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-[#d9d1cf]" />
                  Incorrect
                </span>
              </div>
            </div>

            <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  values: [
                    `${summary.correct}/${summary.attempted}`,
                    "Attempted score",
                    `${summary.correct}/${summary.totalQ}`,
                    "Overall score",
                  ],
                },
                {
                  values: [
                    duration(attemptedMean),
                    "Mean time",
                    duration(activeUsedSec),
                    "Total time",
                  ],
                },
                {
                  values: [
                    String(summary.points),
                    "Points",
                    String(summary.unanswered),
                    "Unanswered",
                  ],
                },
              ].map((metric, metricIndex) => (
                <div
                  key={metricIndex}
                  className="grid grid-cols-2 rounded-2xl bg-white px-4 py-4 text-center text-slate-950 shadow-sm sm:grid-cols-1 sm:py-5"
                >
                  <div>
                    <p className="text-2xl font-normal">{metric.values[0]}</p>
                    <p className="mt-1 text-[10px] font-normal uppercase tracking-wider text-slate-500">
                      {metric.values[1]}
                    </p>
                  </div>
                  {metric.values[2] && (
                    <div className="border-l border-slate-100 sm:mt-4 sm:border-l-0 sm:border-t sm:pt-4">
                      <p className="text-2xl font-normal">{metric.values[2]}</p>
                      <p className="mt-1 text-[10px] font-normal uppercase tracking-wider text-slate-500">
                        {metric.values[3]}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* {credit && (
            <p className="mt-5 text-center text-xs text-slate-500">
              {credit.deltaPoints > 0
                ? `${credit.deltaPoints} points added`
                : "Result recorded"}{" "}
              · {credit.creditMode === "paid" ? "full access" : "practice access"}
            </p>
          )} */}
        </section>

        <section className="mt-7 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-brand-green/60">
                Performance detail
              </p>
              <h2 className="mt-2 text-xl font-black">
                {view === "subject" ? "Subject breakdown" : "Module breakdown"}
              </h2>
            </div>
            <div className="inline-flex w-fit rounded-xl bg-brand-mist p-1">
              {(["subject", "module"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setView(item)}
                  className={`rounded-lg px-4 py-2 text-xs font-black uppercase tracking-wider ${
                    view === item
                      ? "bg-white text-brand-green shadow-sm"
                      : "text-slate-500"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {view === "module" && moduleSubjects.length > 1 && (
            <div className="mt-5 flex gap-2 overflow-x-auto">
              {moduleSubjects.map((subject) => (
                <button
                  key={subject}
                  type="button"
                  onClick={() => setModuleSubject(subject)}
                  className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-bold ${
                    moduleSubject === subject
                      ? "bg-brand-gold text-brand-green"
                      : "bg-brand-mist text-slate-600"
                  }`}
                >
                  {subject}
                </button>
              ))}
            </div>
          )}

          <div className="mt-5">
            <div className="mb-2 hidden grid-cols-[minmax(0,1.4fr)_minmax(110px,.55fr)_minmax(110px,.55fr)] gap-2 text-center sm:grid">
              <p className="rounded-xl bg-brand-mist px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                {view === "subject" ? "Subject" : "Module"}
              </p>
              <p className="rounded-xl bg-brand-mist px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Attempt score</p>
              <p className="rounded-xl bg-brand-mist px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-500">Total time</p>
            </div>
            <BreakdownRows rows={rows} showModule={view === "module"} />
          </div>
        </section>

        {educatorContext ? (
          <div className="mt-14 grid gap-3 sm:grid-cols-2">
            <Link
              href={educatorContext.reviewHref}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-950 bg-white px-6 text-base font-bold uppercase tracking-wide text-slate-950 transition-colors hover:bg-brand-green hover:text-white"
            >
              REVIEW
            </Link>
            <Link
              href={educatorContext.dashboardHref}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-950 bg-white px-6 text-base font-bold uppercase tracking-wide text-slate-950 transition-colors hover:bg-brand-green hover:text-white"
            >
              DRILL DASHBOARD
            </Link>
          </div>
        ) : <div className="mt-14 grid gap-3 sm:grid-cols-3">
          <Link
            href={`/app/drills/${sessionId}/corrections${
              fromChallenges
                ? "?from=challenges"
                : fromRecords
                  ? "?from=records"
                  : ""
            }`}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-950 bg-white px-6 text-base font-bold uppercase tracking-wide text-slate-950 transition-colors hover:bg-brand-green hover:text-white"
          >
            REVIEW
          </Link>
          <button
            type="button"
            disabled={!canShareResult}
            onClick={() => {
              if (!canShareResult) return;
              if (!subscriptionActive) {
                router.push(`/app/bootcamps/${result.bootcamp}/subscription`);
                return;
              }
              setShowChallenge(true);
            }}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-950 bg-white px-6 text-base font-bold uppercase tracking-wide text-slate-950 transition-colors hover:bg-brand-green hover:text-white disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-white"
          >
            {!canShareResult
              ? "NOT SHAREABLE"
              : subscriptionActive ? "CHALLENGE" : "UNLOCK CHALLENGES"}
          </button>
          <Link
            href={
              fromRecords
                ? `/app/bootcamps/${result.bootcamp}/records`
                : `/app/bootcamps/${result.bootcamp}`
            }
            className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-slate-950 bg-white px-5 text-base font-bold uppercase tracking-wide text-slate-950 transition-colors hover:bg-brand-green hover:text-white"
          >
            BACK
          </Link>
        </div>}
      </div>
      {showChallenge && (
        <ResultChallengeComposer
          result={result}
          onClose={() => setShowChallenge(false)}
        />
      )}
    </main>
  );
}
