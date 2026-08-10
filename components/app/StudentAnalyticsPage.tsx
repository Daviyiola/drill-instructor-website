"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useMemo, useRef, useState} from "react";
import {callFunction} from "@/lib/api/client";
import type {
  DrillCatalog,
  AnalyticsBreakdown,
  StudentAnalytics,
} from "@/lib/types/drill";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";

type Preset = "7" | "30" | "90" | "all" | "custom";
export type AnalyticsTrendMetric = "attempts" | "accuracy" | "averageTimeSec" | "sessions" | "points";

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function rangeFor(preset: Preset, customStart: string, customEnd: string) {
  const end = preset === "custom" ? new Date(`${customEnd}T23:59:59.999`) :
    new Date();
  const start = preset === "custom" ? new Date(`${customStart}T00:00:00`) :
    preset === "all" ? new Date("2020-01-01T00:00:00Z") :
      new Date(end.getTime() - (Number(preset) - 1) * 86400000);
  return {startAt: start.toISOString(), endAt: end.toISOString()};
}

export function analyticsDuration(seconds: number | null) {
  if (seconds === null) return "--";
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours ? `${hours}h ${minutes}m` :
    minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function readinessColors(value: StudentAnalytics["readiness"]) {
  const score = Math.round(value.score || 0);
  if (value.status === "insufficient_data") {
    return {card: "#F1F1F1", badge: "#E57373"};
  }
  if (score < 55) return {card: "#FFE0CC", badge: "#E57373"};
  if (score < 70) return {card: "#FFE0CC", badge: "#FFB380"};
  if (score < 85) return {card: "#FFF2CC", badge: "#FFD966"};
  return {card: "#CFE8CF", badge: "#8BC48B"};
}

type Recommendation = {
  title: string;
  subject: string;
  modules: string[];
  questionCount: number;
  reason: string;
  priority: number;
  signalCount: number;
  attempted: number;
};

function recommendationsFor(
  rows: AnalyticsBreakdown[],
  level: "subject" | "module",
  _activeDays: number,
): Recommendation[] {
  const volumeTarget = level === "subject" ? 10 : 5;
  return rows.map((row) => {
    const attempted = Number(row.attempted || 0);
    const accuracy = attempted > 0 ? Number(row.correct || 0) * 100 / attempted : null;
    const meanSeconds = attempted > 0 ? Number(row.activeTimeSec || 0) / attempted : 0;
    const signals: Array<{priority: number; label: string}> = [];
    const consider = (priority: number, label: string) => signals.push({priority, label});

    if (!attempted) {
      consider(100, "Answer more to build confidence");
    } else {
      if (accuracy! < 30) consider(100, "Rebuild core skills for accuracy");
      else if (accuracy! < 50) consider(85, "Slow down to improve accuracy");
      else if (accuracy! < 65) consider(70, "Tighten details for better accuracy");

      if (meanSeconds > 120) consider(95, "Build speed with timed practice");
      else if (meanSeconds > 90) consider(75, "Build pace with timed practice");
      else if (meanSeconds < 25 && accuracy! < 75) consider(80, "Pause before choosing answers");

      if (attempted < volumeTarget) consider(65, "Answer more to build confidence");
    }

    signals.sort((left, right) => right.priority - left.priority);
    const topSignals = signals.slice(0, 3);
    return {
      title: level === "module" ? row.module || "General" : row.subject,
      subject: row.subject,
      modules: level === "module" && row.module ? [row.module] : [],
      questionCount: Math.min(20, Math.max(10, attempted)),
      reason: topSignals.map((signal) => signal.label).join(" · "),
      priority: topSignals[0]?.priority || 0,
      signalCount: topSignals.length,
      attempted,
    };
  }).filter((row) => row.signalCount > 0)
    .sort((left, right) => right.priority - left.priority ||
      right.signalCount - left.signalCount || left.attempted - right.attempted ||
      left.title.localeCompare(right.title))
    .slice(0, 4);
}

export function AnalyticsTrendChart({
  data,
  metric,
}: {
  data: StudentAnalytics["trend"];
  metric: AnalyticsTrendMetric;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  useEffect(() => {
    setSelectedIndex(null);
  }, [data, metric]);
  useEffect(() => {
    if (selectedIndex === null) return;
    const dismissOnNonPointPress = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-chart-point]")) return;
      setSelectedIndex(null);
    };
    document.addEventListener("pointerdown", dismissOnNonPointPress);
    return () => document.removeEventListener("pointerdown", dismissOnNonPointPress);
  }, [selectedIndex]);

  const formattedValue = (value: number) => {
    if (metric === "accuracy") return `${Math.round(value)}%`;
    if (metric === "averageTimeSec") return analyticsDuration(value);
    return String(Math.round(value));
  };
  const valueFor = (row: StudentAnalytics["trend"][number]) =>
    Number(row[metric] ?? 0);
  const values = data.map(valueFor);
  const rawCeiling = Math.max(1, ...values);
  const magnitude = 10 ** Math.floor(Math.log10(rawCeiling));
  const ceiling = metric === "accuracy" ? 100 :
    Math.ceil(rawCeiling / magnitude) * magnitude;
  // Use a fixed-ratio SVG coordinate system. This keeps point markers circular
  // at every viewport width instead of stretching them into ovals.
  const plot = {left: 54, right: 620, top: 36, bottom: 226};
  const points = data.map((row, index) => {
    const value = valueFor(row);
    const x = data.length < 2 ? (plot.left + plot.right) / 2 :
      plot.left + index / (data.length - 1) * (plot.right - plot.left);
    const y = plot.bottom - value / ceiling * (plot.bottom - plot.top);
    return {...row, value, x, y};
  });
  const yTicks = [0, .25, .5, .75, 1].map((ratio) => ({
    value: ceiling * ratio,
    y: plot.bottom - ratio * (plot.bottom - plot.top),
  }));
  const tickCount = Math.min(5, points.length);
  const xTicks = Array.from({length: tickCount}, (_, tick) =>
    points[Math.round(tick * (points.length - 1) / Math.max(1, tickCount - 1))],
  );
  const dateLabel = (point: typeof points[number]) => {
    const date = new Date(point.startAt);
    return Number.isNaN(date.getTime()) ? point.label :
      new Intl.DateTimeFormat(undefined, {month: "short", day: "numeric"}).format(date);
  };
  const selected = selectedIndex === null ? null :
    points[Math.min(Math.max(selectedIndex, 0), Math.max(0, points.length - 1))];
  return (
    <div className="relative">
      {selected && (
        <button
          type="button"
          onClick={() => setSelectedIndex(null)}
          className="absolute right-0 top-0 z-10 rounded-lg border border-black bg-white px-3 py-2 text-left text-xs shadow-sm"
          aria-label="Dismiss chart detail"
        >
          <p className="font-semibold text-slate-900">{selected.label}</p>
          <p className="mt-0.5 text-slate-600">
            {metric === "attempts" ? "Questions" :
              metric === "averageTimeSec" ? "Mean time" :
                metric.charAt(0).toUpperCase() + metric.slice(1)}: {formattedValue(selected.value)}
          </p>
        </button>
      )}
      <svg
        viewBox="0 0 640 276"
        className="h-auto w-full"
        role="img"
        aria-label={`${metric} trend for the selected period`}
        preserveAspectRatio="xMidYMid meet"
      >
        {yTicks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={tick.y}
              y2={tick.y}
              stroke="#dbe2ea"
              strokeWidth="1"
            />
            <text x={plot.left - 10} y={tick.y + 4} textAnchor="end"
              fontSize="11" fill="#64748b">
              {formattedValue(tick.value)}
            </text>
          </g>
        ))}
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom}
          stroke="#94a3b8" strokeWidth="1" />
        <polyline
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="#4B5320"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point) => (
          <circle
            key={point.startAt}
            cx={point.x}
            cy={point.y}
            r={point === selected ? "4.5" : "3.2"}
            fill="#4B5320"
            stroke="white"
            strokeWidth="1.5"
            tabIndex={0}
            role="button"
            data-chart-point="true"
            aria-label={`${point.label}: ${formattedValue(point.value)}`}
            onClick={() => setSelectedIndex(points.indexOf(point))}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedIndex(points.indexOf(point));
              }
            }}
          >
            <title>{`${point.label}: ${formattedValue(point.value)}`}</title>
          </circle>
        ))}
        {xTicks.map((point) => (
          <g key={`axis-${point.startAt}`}>
            <line x1={point.x} x2={point.x} y1={plot.bottom} y2={plot.bottom + 1.5}
              stroke="#94a3b8" strokeWidth="1" />
            <text x={point.x} y="252" textAnchor="middle" fontSize="11" fill="#64748b">
              {dateLabel(point)}
            </text>
          </g>
        ))}
      </svg>
      <ul className="sr-only">
        {points.map((point) => (
          <li key={point.startAt}>
            {point.label}: {formattedValue(point.value)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Readiness({
  value,
  onExplain,
}: {
  value: StudentAnalytics["readiness"];
  onExplain: () => void;
}) {
  const score = Math.round(value.score || 0);
  const colors = readinessColors(value);
  return (
    <div className="w-full rounded-[14px] p-px shadow-[0_3px_0_rgba(0,0,0,0.10)]"
      style={{background: colors.card}}>
      <button type="button" onClick={onExplain}
        className="w-full rounded-[13px] border border-black/15 p-4 text-left transition hover:-translate-y-0.5"
        style={{background: colors.card}}>
        <span className="flex items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[12px] border-2 border-black text-xl font-semibold text-black"
            style={{background: colors.badge}}>
            {value.status === "insufficient_data" ? "--" : `${score}%`}
          </span>
          <span>
            <span className="block text-lg font-semibold text-black">
              {value.status === "insufficient_data" ? "Not enough data" : value.band}
            </span>
            <span className="mt-1 block text-sm leading-5 text-slate-700">
              {value.status === "insufficient_data" ?
                "Not enough recent questions to calculate a reliable Readiness Index." :
                `Confidence ${Math.round(value.confidence * 100)}% · Tap to learn about DIRI.`}
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}

export default function StudentAnalyticsPage({
  bootcamp,
  educatorStudentId = "",
  educatorStudentName = "",
}: {
  bootcamp: string;
  educatorStudentId?: string;
  educatorStudentName?: string;
}) {
  const router = useRouter();
  const {user, loading, account, educatorWorkspace} = useAuth();
  const educatorMode = Boolean(educatorStudentId);
  const [catalog, setCatalog] = useState<DrillCatalog | null>(null);
  const [analytics, setAnalytics] = useState<StudentAnalytics | null>(null);
  const [preset, setPreset] = useState<Preset>("30");
  const [source, setSource] = useState("all");
  const [subject, setSubject] = useState("");
  const [metric, setMetric] = useState<AnalyticsTrendMetric>("attempts");
  const [openSubject, setOpenSubject] = useState("");
  const [customStart, setCustomStart] = useState(inputDate(
      new Date(Date.now() - 29 * 86400000),
  ));
  const [customEnd, setCustomEnd] = useState(inputDate(new Date()));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [diriOpen, setDiriOpen] = useState(false);
  const [rhythmWindowDays, setRhythmWindowDays] = useState(365);
  const analyticsRequest = useRef(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    const updateRhythmWindow = () => {
      setRhythmWindowDays(window.innerWidth >= 1280 ? 365 :
        window.innerWidth >= 768 ? 270 : 90);
    };
    updateRhythmWindow();
    window.addEventListener("resize", updateRhythmWindow);
    return () => window.removeEventListener("resize", updateRhythmWindow);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (educatorMode) {
      const subjects = educatorWorkspace?.subjectsByBootcamp[bootcamp] || [];
      setCatalog({
        ok: true,
        bootcamp,
        datasetVersion: "",
        licensed: true,
        freePracticeYears: [],
        subjects: subjects.map((name) => ({
          name, modules: [], practiceYears: [], availablePracticeYears: [],
          questionCount: 0,
        })),
      });
      return;
    }
    callFunction<DrillCatalog, {bootcamp: string}>(
      user, "getStudentDrillCatalogHttps", {bootcamp},
    ).then(setCatalog).catch((reason) => setError((reason as Error).message));
  }, [bootcamp, educatorMode, educatorWorkspace, user]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const requestId = analyticsRequest.current + 1;
    analyticsRequest.current = requestId;
    setError("");
    const range = rangeFor(preset, customStart, customEnd);
    const rangeDays = Math.ceil(
      (Date.parse(range.endAt) - Date.parse(range.startAt) + 1) / 86400000,
    );
    // Presets are deliberately part of the key instead of their millisecond
    // timestamps, which change on every render and would defeat caching.
    const cacheKey = `di.analytics.v2:${educatorStudentId || "self"}:${bootcamp}:${preset}:${customStart}:${customEnd}:${source}:${subject}`;
    let hasCachedAnalytics = false;
    try {
      const cached = window.sessionStorage.getItem(cacheKey);
      if (cached) {
        setAnalytics(JSON.parse(cached) as StudentAnalytics);
        hasCachedAnalytics = true;
      }
    } catch {
      // Storage is an optional speed improvement, never a dependency.
    }
    setBusy(!hasCachedAnalytics);
    const endpoint = educatorMode ?
      "getEducatorStudentAnalyticsHttps" : "getStudentAnalyticsHttps";
    callFunction<StudentAnalytics | {ok: true; analytics: StudentAnalytics}>(user, endpoint, {
      bootcamp,
      ...(educatorMode ? {studentId: educatorStudentId} : {}),
      ...range,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      source,
      subject,
      granularity: rangeDays > 180 ? "month" : rangeDays > 30 ? "week" : "day",
    }, {signal: controller.signal}).then((response) => {
      if (analyticsRequest.current !== requestId) return;
      const next = "analytics" in response ? response.analytics : response;
      setAnalytics(next);
      try {
        window.sessionStorage.setItem(cacheKey, JSON.stringify(next));
      } catch {
        // Storage quotas and private browsing should not affect analytics.
      }
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || analyticsRequest.current !== requestId) return;
      setError((reason as Error).message);
    }).finally(() => {
      if (analyticsRequest.current === requestId) setBusy(false);
    });
    return () => controller.abort();
  }, [bootcamp, customEnd, customStart, educatorMode, educatorStudentId, preset, source, subject, user]);

  const modules = useMemo(() => analytics?.modules || [], [analytics]);
  const attemptedModules = useMemo(
    () => modules.filter((row) => row.attempted > 0),
    [modules],
  );
  if (!account || !analytics) {
    if (!error) return <BrandedLoadingOverlay label="Loading analytics" />;
    return <div className="grid min-h-screen place-items-center p-6">{error}</div>;
  }

  const subjectCount = analytics.overview.subjectCount ?? analytics.subjects.length;
  const moduleCount = analytics.overview.moduleCount ?? modules.length;
  const practiceTestCount = analytics.overview.practiceTestCount ?? 0;
  const kpis = [
    ["Accuracy", analytics.overview.accuracy === null ? "--" :
      `${Math.round(analytics.overview.accuracy)}%`,
      `${Math.round(analytics.overview.gradedAttempts * (analytics.overview.accuracy || 0) / 100)}/${analytics.overview.gradedAttempts} scored`],
    ["Questions", String(analytics.overview.attempts),
      `${subjectCount} ${subjectCount === 1 ? "subject" : "subjects"}`],
    ["Mean time", analyticsDuration(analytics.overview.averageTimeSec),
      `Total time: ${analyticsDuration(analytics.overview.activeTimeSec)}`],
    ["Sessions", String(analytics.overview.sessions),
      `Points: ${analytics.overview.points}`],
    ["Practice tests", String(practiceTestCount),
      `${moduleCount} ${moduleCount === 1 ? "module" : "modules"}`],
  ];
  const recommendationLevel = subject ? "module" : "subject";
  const recommendationRows = subject ?
    modules.filter((row) => row.subject === subject) : analytics.subjects;
  const recommendations = recommendationsFor(
    recommendationRows,
    recommendationLevel,
    analytics.overview.activeDays,
  );
  const diriColors = readinessColors(analytics.readiness);
  const rhythmRange = rangeFor(preset, customStart, customEnd);
  const rhythmSessions = new Map(
    analytics.activity.days.map((day) => [day.day, day.sessions]),
  );
  const calendarDays: Array<{day: string; sessions: number} | null> = [];
  const rhythmEnd = new Date(rhythmRange.endAt);
  const selectedRhythmStart = new Date(rhythmRange.startAt);
  const rhythmStart = new Date(Math.max(
      selectedRhythmStart.getTime(),
      rhythmEnd.getTime() - (rhythmWindowDays - 1) * 86400000,
  ));
  const leadingBlankDays = (rhythmStart.getUTCDay() + 6) % 7;
  calendarDays.push(...Array.from({length: leadingBlankDays}, () => null));
  for (let cursor = new Date(Date.UTC(
      rhythmStart.getUTCFullYear(),
      rhythmStart.getUTCMonth(),
      rhythmStart.getUTCDate(),
  )); cursor <= rhythmEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    calendarDays.push({day, sessions: rhythmSessions.get(day) || 0});
  }
  const calendarColumns = Math.max(1, Math.ceil(calendarDays.length / 7));
  const monthMarkers = calendarDays.flatMap((day, index) => {
    if (!day) return [];
    const date = new Date(`${day.day}T00:00:00Z`);
    const previous = calendarDays[index - 1];
    const previousMonth = previous ? new Date(`${previous.day}T00:00:00Z`).getUTCMonth() : -1;
    if (index !== leadingBlankDays && date.getUTCMonth() === previousMonth) return [];
    return [{
      label: new Intl.DateTimeFormat(undefined, {month: "short"}).format(date),
      column: Math.floor(index / 7) + 1,
    }];
  });

  const content = (
    <>
      {busy && <BrandedLoadingOverlay label="Refreshing analytics" />}
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              href={educatorMode ? `/app/educator/bootcamps/${bootcamp}/analytics` : `/app/bootcamps/${bootcamp}`}
              className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
                <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
              </span>
              {educatorMode ? "Analytics directory" : `${bootcamp.toUpperCase()} bootcamp`}
            </Link>
            <h1 className="mt-4 text-4xl font-semibold">{educatorMode ? educatorStudentName || "Student analytics" : "Analytics"}</h1>
            <p className="mt-2 text-sm text-slate-500">
              See what is improving, where time goes, and what to train next.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Date range">
            {(["7", "30", "90", "all", "custom"] as Preset[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPreset(value)}
                className={`rounded-xl px-3 py-2 text-sm ${preset === value ?
                  "bg-brand-green text-white" : "bg-white text-slate-600"}`}
              >
                {value === "all" ? "All time" : value === "custom" ?
                  "Custom" : `${value} days`}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3 rounded-2xl bg-white p-4 shadow-sm">
          {preset === "custom" && (
            <>
              <input
                aria-label="Start date"
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(event) => setCustomStart(event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                aria-label="End date"
                type="date"
                value={customEnd}
                min={customStart}
                max={inputDate(new Date())}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </>
          )}
          <select
            aria-label="Practice source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All activity</option>
            <option value="solo">Solo drills</option>
            <option value="challenge">Squad challenges</option>
            <option value="assignment">Assignments</option>
          </select>
          <select
            aria-label="Subject"
            value={subject}
            onChange={(event) => {
              const nextSubject = event.target.value;
              setSubject(nextSubject);
              setOpenSubject(nextSubject);
            }}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">All subjects</option>
            {catalog?.subjects.map((row) => (
              <option key={row.name} value={row.name}>{row.name}</option>
            ))}
          </select>
        </div>

        {error && <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {analytics.excludedPendingScores > 0 && (
          <div className="mt-5 rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-4 text-sm text-slate-700">
            {analytics.excludedPendingScores} submitted assignment
            {analytics.excludedPendingScores === 1 ? " is" : "s are"} included
            in activity totals but excluded from performance until scores are released.
          </div>
        )}

        <div className="mt-6"><Readiness value={analytics.readiness} onExplain={() => setDiriOpen(true)} /></div>

        <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
          {kpis.map(([label, value, note], index) => (
            <div key={label} className={`rounded-2xl border border-black/10 bg-white p-3 shadow-[0_2px_0_rgba(0,0,0,0.08)] sm:p-4 ${index === 4 ? "hidden xl:block" : ""}`}>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
              <p className="mt-1 text-xs leading-4 text-slate-500">{note}</p>
            </div>
          ))}
        </section>

        <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-medium">Performance trend</h2>
              <p className="mt-1 text-sm text-slate-500">Your practice across the selected period.</p>
            </div>
            <select
              aria-label="Trend metric"
              value={metric}
              onChange={(event) => setMetric(event.target.value as AnalyticsTrendMetric)}
              className="rounded-xl border-2 border-slate-300 bg-brand-mist px-3 py-2 text-sm text-slate-800"
            >
              <option value="attempts">Questions</option>
              <option value="accuracy">Accuracy</option>
              <option value="averageTimeSec">Mean time</option>
              <option value="sessions">Sessions</option>
              <option value="points">Points</option>
            </select>
          </div>
          <div className="mt-6"><AnalyticsTrendChart data={analytics.trend} metric={metric} /></div>
        </section>

        <div className="mt-6 grid gap-6">
          <section className="rounded-[2rem] bg-brand-mist p-5 sm:p-7">
            <h2 className="text-xl font-medium">Suggested practice</h2>
            <p className="mt-1 text-sm text-slate-500">
              {subject ? `Focused on ${subject} modules.` :
                "Prioritized by accuracy, pacing, and practice volume."}
            </p>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {recommendations.map((row) => (
                <div key={`${row.subject}-${row.modules.join("-")}`} className="rounded-2xl bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{row.title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{row.reason}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{row.attempted} attempted</span>
                  </div>
                  {!educatorMode && <Link
                      href={`/app/bootcamps/${bootcamp}/drills?subject=${encodeURIComponent(row.subject)}&modules=${encodeURIComponent(row.modules.join(","))}&count=${row.questionCount}`}
                      className="mt-4 inline-flex rounded-xl bg-brand-green px-4 py-2 text-xs text-white"
                    >Build this drill</Link>}
                </div>
              ))}
              {!recommendations.length && (
                <p className="rounded-2xl bg-white p-5 text-sm text-slate-500">
                  Keep practicing to unlock a clearer next step.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-medium">
                  {openSubject ? `${openSubject} modules` : "Subjects"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {openSubject ? "Module performance in this subject." :
                    "Tap a subject to view its modules."}
                </p>
              </div>
              {openSubject && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenSubject("");
                    setSubject("");
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-brand-mist"
                >
                  <span aria-hidden className="text-lg leading-none">×</span>
                  All subjects
                </button>
              )}
            </div>
            <div className="mt-5">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(72px,.35fr)_minmax(72px,.35fr)] gap-2 text-xs font-semibold uppercase tracking-wide text-white sm:grid-cols-[minmax(0,1.35fr)_minmax(72px,.36fr)_minmax(72px,.36fr)_minmax(82px,.45fr)_minmax(82px,.48fr)]">
                <span className="rounded-xl border border-black/15 bg-brand-green px-4 py-3">
                  {openSubject ? "Module" : "Subject"}
                </span>
                <span className="rounded-xl border border-black/15 bg-brand-green px-3 py-3 text-center">Score</span>
                <span className="rounded-xl border border-black/15 bg-brand-green px-3 py-3 text-center">Accuracy</span>
                <span className="hidden rounded-xl border border-black/15 bg-brand-green px-3 py-3 text-center sm:block">Mean Time</span>
                <span className="hidden rounded-xl border border-black/15 bg-brand-green px-3 py-3 text-center sm:block">Total Time</span>
              </div>
              <div className="mt-2 space-y-2">
                {(openSubject ? attemptedModules.filter((row) => row.subject === openSubject) :
                  analytics.subjects).map((row) => {
                  const isModule = Boolean(openSubject);
                  return (
                    <button
                      key={isModule ? `${row.subject}-${row.module}` : row.subject}
                    type="button"
                    disabled={isModule}
                    onClick={() => {
                      if (isModule) return;
                      setSubject(row.subject);
                      setOpenSubject(row.subject);
                    }}
                    className="grid w-full grid-cols-[minmax(0,1fr)_minmax(72px,.35fr)_minmax(72px,.35fr)] gap-2 text-left sm:grid-cols-[minmax(0,1.35fr)_minmax(72px,.36fr)_minmax(72px,.36fr)_minmax(82px,.45fr)_minmax(82px,.48fr)]"
                  >
                      <span className={`rounded-xl bg-brand-mist px-4 py-3 text-sm text-slate-900 ${isModule ? "" : "font-semibold"}`}>
                        {isModule ? row.module : row.subject}
                      </span>
                      <span className="rounded-xl bg-brand-mist px-3 py-3 text-center text-sm text-slate-900">
                        {row.correct}/{row.attempted}
                      </span>
                      <span className="rounded-xl bg-brand-mist px-3 py-3 text-center text-sm text-slate-900">
                        {row.accuracy === null ? "--" : `${Math.round(row.accuracy)}%`}
                      </span>
                      <span className="hidden rounded-xl bg-brand-mist px-3 py-3 text-center text-sm text-slate-900 sm:block">
                        {analyticsDuration(row.averageTimeSec)}
                      </span>
                      <span className="hidden rounded-xl bg-brand-mist px-3 py-3 text-center text-sm text-slate-900 sm:block">
                        {analyticsDuration(row.activeTimeSec)}
                      </span>
                    </button>
                  );
                })}
                {!(openSubject ? attemptedModules.filter((row) => row.subject === openSubject) :
                  analytics.subjects).length && (
                  <p className="rounded-2xl bg-brand-mist p-5 text-sm text-slate-500">
                    No released performance in this range.
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-medium">Study rhythm</h2>
              <p className="mt-1 text-sm text-slate-500">Every submitted activity counts, including pending assignments.</p>
            </div>
            {/* <p className="text-sm text-slate-600">
              <strong className="text-2xl font-medium text-slate-900">{analytics.activity.current}</strong> current · {analytics.activity.best} best
            </p> */}
          </div>
          <div className="mt-6 overflow-x-auto pb-2" aria-label="Activity calendar">
            <div className="flex min-w-max gap-2">
              <div className="grid grid-rows-7 gap-1 pt-5 text-[10px] text-slate-400">
                {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((label, index) => (
                  <span key={index} className="flex h-3 items-center">{label}</span>
                ))}
              </div>
              <div>
                <div
                  className="grid h-5 gap-1 text-[10px] text-slate-400"
                  style={{gridTemplateColumns: `repeat(${calendarColumns}, 12px)`}}
                >
                  {monthMarkers.map((marker) => (
                    <span key={`${marker.label}-${marker.column}`}
                      style={{gridColumnStart: marker.column}}>
                      {marker.label}
                    </span>
                  ))}
                </div>
                <div
                  className="grid grid-flow-col grid-rows-7 gap-1"
                  style={{gridTemplateColumns: `repeat(${calendarColumns}, 12px)`}}
                >
                  {calendarDays.map((day, index) => (
                    <div
                      key={day ? day.day : `blank-${index}`}
                      title={day ? `${day.day}: ${day.sessions} session${day.sessions === 1 ? "" : "s"}` : ""}
                      aria-label={day ? `${day.day}: ${day.sessions} sessions` : undefined}
                      className={`h-3 w-3 rounded-[3px] ${!day ? "bg-transparent" :
                        day.sessions > 2 ? "bg-brand-green" :
                          day.sessions > 1 ? "bg-brand-green/70" :
                            day.sessions ? "bg-brand-green/35" : "bg-slate-100"}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      {diriOpen && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-5 backdrop-blur-sm"
          role="presentation"
          onMouseDown={() => setDiriOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="diri-title"
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-8"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="rounded-[14px] border border-black/15 p-4"
              style={{backgroundColor: diriColors.card}}>
              <div className="flex items-center gap-4">
                <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-[12px] border-2 border-black text-xl font-semibold"
                  style={{backgroundColor: diriColors.badge}}>
                  {analytics.readiness.status === "insufficient_data" ? "--" :
                    `${Math.round(analytics.readiness.score || 0)}%`}
                </span>
                <div>
                  <h2 id="diri-title" className="font-semibold leading-5">
                    Drill Instructor<br />Readiness Index (DIRI)
                  </h2>
                  <p className="mt-1 text-sm text-slate-700">
                    {analytics.readiness.status === "insufficient_data" ?
                      "Not enough recent data to calculate a reliable readiness index." :
                      analytics.readiness.band}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-6 space-y-5 text-sm leading-6 text-slate-700">
              <p>
                The <strong>Drill Instructor Readiness Index (DIRI)</strong> is a way
                of summarizing recent learning activity into one clear measure of
                preparation. It does not predict results or promise outcomes; it simply
                reflects how consistent, balanced, and effective recent practice has been.
              </p>
              <p>
                DIRI draws from three main metrics. <strong>Performance</strong> captures
                accuracy and pacing during practice. <strong>Consistency</strong> measures
                how steadily sessions have been completed over time. <strong>Coverage</strong>
                looks at how well effort has been distributed across subjects and topics.
                Each part matters, and together they provide a realistic picture of current readiness.
              </p>
              <p>
                Since preparation is never static, DIRI evaluates only the most recent
                <strong> 90 days</strong> of activity. It looks at what has actually happened
                within that window, not a lifetime total, so that the score represents present
                form rather than old habits. When focused on one subject, DIRI recalculates
                around that area alone, allowing a closer look at individual progress.
              </p>
              <p>
                DIRI is best read as an internal indicator. It does not measure readiness
                in absolute terms, but when viewed over about 90 days, scores approaching or
                exceeding 90% tend to indicate consistent and well-rounded preparation.
              </p>
            </div>
            <div className="mt-6 text-center">
              <button type="button" onClick={() => setDiriOpen(false)}
                className="rounded-xl border border-black bg-white px-6 py-2 text-sm font-semibold text-black">
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
  if (educatorMode) return content;
  return <AppShell profile={account.profile}>{content}</AppShell>;
}
