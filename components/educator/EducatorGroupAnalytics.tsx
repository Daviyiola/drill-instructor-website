"use client";

import Link from "next/link";
import {useEffect, useMemo, useRef, useState} from "react";
import {
  AnalyticsTrendChart,
  analyticsDuration,
  type AnalyticsTrendMetric,
} from "@/components/app/StudentAnalyticsPage";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction} from "@/lib/api/client";
import type {
  AnalyticsBreakdown,
  AnalyticsOverview,
  StudentAnalytics,
} from "@/lib/types/drill";

type DatePreset = "7" | "30" | "90" | "custom";
type GroupTrendMetric = Exclude<AnalyticsTrendMetric, "points">;
type ThresholdMetric = "attempts" | "correct" | "accuracy" | "avgTime";

type ThresholdValue = {
  studentId: string;
  value: number;
};

type ComprehensionRow = {
  id: string;
  name: string;
  subject: string;
  module?: string;
  percentMet: number;
  met: number;
  total: number;
  below: ThresholdValue[];
  noData: string[];
};

type GroupAnalytics = {
  questionWeightedAccuracy: number | null;
  medianStudentAccuracy: number | null;
  contributingStudentCount: number;
  percentageMeetingThreshold: number | null;
  belowThresholdStudents: string[];
  noDataStudents: string[];
  overview: AnalyticsOverview;
  trend: StudentAnalytics["trend"];
  subjects: AnalyticsBreakdown[];
  modules: AnalyticsBreakdown[];
  threshold: number;
  thresholdMetric: ThresholdMetric;
  comprehension: {
    metric: ThresholdMetric;
    threshold: number;
    subjects: ComprehensionRow[];
    modules: ComprehensionRow[];
  };
};

type GroupResponse = {
  ok: true;
  group: {name: string; studentCount: number};
  students: Array<{
    id: string;
    firstName: string;
    lastName: string;
  }>;
  analytics: GroupAnalytics;
};

const DAY_MS = 86400000;
const thresholdDefaults: Record<ThresholdMetric, number> = {
  attempts: 20,
  correct: 15,
  accuracy: 60,
  avgTime: 90,
};

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(
  preset: DatePreset,
  customStart: string,
  customEnd: string,
) {
  const end = preset === "custom" ?
    new Date(`${customEnd}T23:59:59.999`) : new Date();
  const start = preset === "custom" ?
    new Date(`${customStart}T00:00:00`) :
    new Date(end.getTime() - (Number(preset) - 1) * DAY_MS);
  return {startAt: start.toISOString(), endAt: end.toISOString()};
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (character) =>
    character.toUpperCase());
}

function thresholdLabel(metric: ThresholdMetric) {
  if (metric === "attempts") return "Question attempts";
  if (metric === "correct") return "Correct answers";
  if (metric === "avgTime") return "Average time";
  return "Accuracy";
}

function thresholdValue(value: number, metric: ThresholdMetric) {
  if (metric === "accuracy") return `${Math.round(value)}%`;
  if (metric === "avgTime") return analyticsDuration(value);
  return String(Math.round(value));
}

function thresholdRule(metric: ThresholdMetric, threshold: number) {
  if (metric === "avgTime") {
    return `${analyticsDuration(threshold)} or faster`;
  }
  const suffix = metric === "accuracy" ? "%" : "";
  return `${Math.round(threshold)}${suffix} or higher`;
}

export default function EducatorGroupAnalytics({
  bootcamp,
  rawGroupId,
  scope,
  fallbackName,
}: {
  bootcamp: string;
  rawGroupId: string;
  scope: string;
  fallbackName: string;
}) {
  const {user} = useAuth();
  const [preset, setPreset] = useState<DatePreset>("30");
  const [customStart, setCustomStart] = useState(inputDate(
    new Date(Date.now() - 29 * DAY_MS),
  ));
  const [customEnd, setCustomEnd] = useState(inputDate(new Date()));
  const [focusSubject, setFocusSubject] = useState("");
  const [trendMetric, setTrendMetric] =
    useState<GroupTrendMetric>("attempts");
  const [thresholdMetric, setThresholdMetric] =
    useState<ThresholdMetric>("accuracy");
  const [thresholdInput, setThresholdInput] = useState("60");
  const [appliedThreshold, setAppliedThreshold] = useState(60);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [data, setData] = useState<GroupResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    const range = dateRange(preset, customStart, customEnd);
    const rangeDays = Math.max(1, Math.ceil(
      (Date.parse(range.endAt) - Date.parse(range.startAt)) / DAY_MS,
    ));
    setBusy(true);
    setError("");
    callFunction<GroupResponse>(user, "getEducatorGroupAnalyticsHttps", {
      bootcamp,
      rawGroupId,
      scope,
      ...range,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      source: "all",
      subject: focusSubject,
      granularity: rangeDays > 180 ? "month" :
        rangeDays > 30 ? "week" : "day",
      thresholdMetric,
      threshold: appliedThreshold,
    }, {signal: controller.signal}).then((response) => {
      if (requestId.current !== currentRequest) return;
      setData(response);
      setExpanded(new Set());
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || requestId.current !== currentRequest) {
        return;
      }
      setError((reason as Error).message || "Unable to load group analytics.");
    }).finally(() => {
      if (requestId.current === currentRequest) setBusy(false);
    });
    return () => controller.abort();
  }, [
    appliedThreshold,
    bootcamp,
    customEnd,
    customStart,
    focusSubject,
    preset,
    rawGroupId,
    scope,
    thresholdMetric,
    user,
  ]);

  const names = useMemo(() => new Map(
    (data?.students || []).map((student) => [
      student.id,
      `${student.firstName} ${student.lastName}`.trim() || "Student",
    ]),
  ), [data]);

  if (!data && busy) {
    return <BrandedLoadingOverlay label="Loading group analytics" fixed={false} />;
  }

  const analytics = data?.analytics;
  if (!analytics) {
    return <div className="grid min-h-[70vh] place-items-center p-6 text-sm text-red-700">{error || "No group analytics are available."}</div>;
  }

  const overview = analytics.overview;
  const groupName = data?.group.name || fallbackName;
  const studentCount = data?.group.studentCount || 0;
  const comprehensionRows = focusSubject ?
    analytics.comprehension.modules.filter((row) =>
      row.subject.toLowerCase() === focusSubject.toLowerCase()) :
    analytics.comprehension.subjects;
  const attentionRows = comprehensionRows.filter((row) =>
    row.below.length > 0 || row.noData.length > 0);
  const correct = overview.accuracy === null ? 0 : Math.round(
    overview.gradedAttempts * overview.accuracy / 100,
  );
  const itemCount = focusSubject ? analytics.modules.length :
    analytics.subjects.length;
  const kpis = [
    [
      "Accuracy",
      overview.accuracy === null ? "--" : `${Math.round(overview.accuracy)}%`,
      `Weighted score: ${correct}/${overview.gradedAttempts}`,
    ],
    [
      "Questions",
      String(overview.attempts),
      `${itemCount} ${focusSubject ?
        itemCount === 1 ? "module" : "modules" :
        itemCount === 1 ? "subject" : "subjects"}`,
    ],
    [
      "Mean time",
      analyticsDuration(overview.averageTimeSec),
      `Total time: ${analyticsDuration(overview.activeTimeSec)}`,
    ],
    [
      "Sessions",
      String(overview.sessions),
      `${analytics.contributingStudentCount}/${studentCount} students${
        analytics.medianStudentAccuracy === null ? "" :
          ` · ${Math.round(analytics.medianStudentAccuracy)}% median`}`,
    ],
  ];

  function changeThresholdMetric(metric: ThresholdMetric) {
    const next = thresholdDefaults[metric];
    setThresholdMetric(metric);
    setThresholdInput(String(next));
    setAppliedThreshold(next);
  }

  function applyThreshold() {
    const raw = Number(thresholdInput);
    const maximum = thresholdMetric === "accuracy" ? 100 :
      thresholdMetric === "avgTime" ? 3600 : 100000;
    const next = Number.isFinite(raw) ?
      Math.min(maximum, Math.max(0, Math.round(raw))) :
      thresholdDefaults[thresholdMetric];
    setThresholdInput(String(next));
    setAppliedThreshold(next);
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
      {busy && <BrandedLoadingOverlay label="Refreshing group analytics" />}

      <Link href={`/app/educator/bootcamps/${bootcamp}/analytics`}
        className="inline-flex items-center gap-2 text-sm text-slate-700 transition hover:text-brand-green">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
          <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
        </span>
        Analytics directory
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs uppercase tracking-[.2em] text-brand-green/65">Group analytics</p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            {focusSubject ? `${groupName} · ${titleCase(focusSubject)}` : groupName}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            See group performance, comprehension, and students needing support.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Date range">
          {(["7", "30", "90", "custom"] as DatePreset[]).map((value) => (
            <button key={value} type="button" onClick={() => setPreset(value)}
              className={`rounded-xl px-3 py-2 text-sm transition ${preset === value ?
                "bg-brand-green text-white" :
                "bg-white text-slate-600 hover:bg-brand-mist"}`}>
              {value === "custom" ? "Custom" : `${value} days`}
            </button>
          ))}
        </div>
      </div>

      {preset === "custom" && (
        <div className="mt-5 flex flex-wrap gap-3 rounded-2xl bg-white p-4 shadow-sm">
          <input aria-label="Start date" type="date" value={customStart}
            max={customEnd} onChange={(event) => setCustomStart(event.target.value)}
            className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm" />
          <input aria-label="End date" type="date" value={customEnd}
            min={customStart} max={inputDate(new Date())}
            onChange={(event) => setCustomEnd(event.target.value)}
            className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm" />
        </div>
      )}

      {error && <p role="alert" className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([label, value, note]) => (
          <article key={label}
            className="rounded-2xl border border-black/10 bg-white p-3 shadow-[0_2px_0_rgba(0,0,0,0.08)] sm:p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
            <p className="mt-1 text-xs leading-4 text-slate-500">{note}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-medium">Performance trend</h2>
            <p className="mt-1 text-sm text-slate-500">Combined group activity across the selected period.</p>
          </div>
          <select aria-label="Trend metric" value={trendMetric}
            onChange={(event) => setTrendMetric(event.target.value as GroupTrendMetric)}
            className="rounded-xl border-2 border-slate-300 bg-brand-mist px-3 py-2 text-sm text-slate-800">
            <option value="attempts">Questions</option>
            <option value="accuracy">Accuracy</option>
            <option value="averageTimeSec">Mean time</option>
            <option value="sessions">Sessions</option>
          </select>
        </div>
        <div className="mt-6">
          <AnalyticsTrendChart data={analytics.trend} metric={trendMetric} />
        </div>
      </section>

      <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-medium">Comprehension threshold</h2>
            <p className="mt-1 text-sm text-slate-500">
              Count students meeting {thresholdLabel(thresholdMetric).toLowerCase()} of {thresholdRule(thresholdMetric, appliedThreshold)}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={thresholdMetric}
              onChange={(event) => changeThresholdMetric(event.target.value as ThresholdMetric)}
              className="min-h-11 rounded-xl border border-slate-300 bg-brand-mist px-3 text-sm">
              <option value="attempts">Question attempts</option>
              <option value="correct">Correct answers</option>
              <option value="accuracy">Accuracy</option>
              <option value="avgTime">Average time (seconds)</option>
            </select>
            <input aria-label="Threshold value" inputMode="numeric"
              value={thresholdInput}
              onChange={(event) => setThresholdInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyThreshold();
              }}
              className="min-h-11 w-24 rounded-xl border border-slate-300 px-3 text-center text-sm" />
            <button type="button" onClick={applyThreshold}
              className="min-h-11 rounded-xl bg-brand-green px-5 text-sm text-white transition hover:bg-brand-darkolive">
              APPLY
            </button>
          </div>
        </div>
      </section>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-4 bg-brand-green px-5 py-4 text-white">
            <div>
              <h2 className="text-lg font-medium">
                {focusSubject ? `${titleCase(focusSubject)} modules` : "Group comprehension"}
              </h2>
              <p className="mt-1 text-xs text-white/75">Percentage of all group members meeting the threshold.</p>
            </div>
            {focusSubject && (
              <button type="button" onClick={() => setFocusSubject("")}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/35 text-xl transition hover:bg-white/10"
                aria-label="Show all subjects">×</button>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {comprehensionRows.map((row) => (
              <button key={row.id} type="button" disabled={Boolean(focusSubject)}
                onClick={() => {
                  if (!focusSubject) setFocusSubject(row.subject);
                }}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 text-left transition enabled:hover:bg-brand-mist">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-950">{titleCase(row.name)}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {row.met} of {row.total} meet threshold · {row.noData.length} no data
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-lg font-medium text-brand-green">{Math.round(row.percentMet)}%</span>
                  {!focusSubject && <span aria-hidden className="text-slate-400">›</span>}
                </span>
              </button>
            ))}
            {!comprehensionRows.length && (
              <p className="p-7 text-center text-sm text-slate-500">No group activity is available in this range.</p>
            )}
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-brand-mist p-5 sm:p-6">
          <h2 className="text-lg font-medium">Needs attention</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Students below the selected threshold and students without activity.
          </p>
          <div className="mt-4 space-y-3">
            {attentionRows.map((row) => {
              const isOpen = expanded.has(row.id);
              const previewIds = [
                ...row.below.map((student) => student.studentId),
                ...row.noData,
              ].slice(0, 3);
              return (
                <article key={row.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <button type="button" onClick={() => toggleExpanded(row.id)}
                    className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-white/60"
                    aria-expanded={isOpen}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{titleCase(row.name)}</span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {previewIds.map((id) => names.get(id) || "Student").join(", ") || "No students"}
                        {row.below.length + row.noData.length > 3 ?
                          ` +${row.below.length + row.noData.length - 3} more` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-brand-green">{isOpen ? "LESS" : "MORE"}</span>
                  </button>
                  {isOpen && (
                    <div className="grid gap-4 border-t border-slate-100 p-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-wider text-brand-green/65">Below threshold</p>
                        <div className="mt-2 space-y-2">
                          {row.below.map((student) => (
                            <Link key={student.studentId}
                              href={`/app/educator/bootcamps/${bootcamp}/analytics/students/${encodeURIComponent(student.studentId)}?name=${encodeURIComponent(names.get(student.studentId) || "Student")}`}
                              className="flex items-center justify-between gap-3 rounded-xl bg-brand-mist px-3 py-2 text-sm transition hover:ring-1 hover:ring-brand-green/30">
                              <span className="truncate">{names.get(student.studentId) || "Student"}</span>
                              <span className="shrink-0 text-xs text-slate-500">{thresholdValue(student.value, thresholdMetric)}</span>
                            </Link>
                          ))}
                          {!row.below.length && <p className="text-sm text-slate-400">None</p>}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wider text-brand-green/65">No data</p>
                        <div className="mt-2 space-y-2">
                          {row.noData.map((studentId) => (
                            <Link key={studentId}
                              href={`/app/educator/bootcamps/${bootcamp}/analytics/students/${encodeURIComponent(studentId)}?name=${encodeURIComponent(names.get(studentId) || "Student")}`}
                              className="block truncate rounded-xl bg-brand-mist px-3 py-2 text-sm transition hover:ring-1 hover:ring-brand-green/30">
                              {names.get(studentId) || "Student"}
                            </Link>
                          ))}
                          {!row.noData.length && <p className="text-sm text-slate-400">None</p>}
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
            {!attentionRows.length && (
              <p className="rounded-2xl bg-white p-5 text-sm text-slate-500">
                Everyone with activity meets this threshold.
              </p>
            )}
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">
            Every visible group member is included in the denominator. No data means the student has no attempt in that subject or module during this period.
          </p>
        </section>
      </div>
    </main>
  );
}
