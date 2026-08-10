"use client";

import Link from "next/link";
import {FormEvent, useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {useAuth} from "@/components/app/AuthProvider";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import {questionText} from "@/lib/drills/text";

type Summary = {totalQ: number; attempted: number; correct: number; wrong: number; unanswered: number; usedSec: number; meanSec: number; points: number; accuracyPct: number};
type StudentRow = {studentId: string; studentName: string; status: string; assignedAt: string; startedAt: string; submittedAt: string; attemptId: string; summary: Summary};
type Submissions = {ok: true; drill: {drillId: string; title: string; instructions: string; status: string; assignedCount: number; startedCount: number; submittedCount: number; lateCount: number; dueAt: string}; students: StudentRow[]};
type OptionPerformance = {label?: string; answer?: string; option?: string; count: number; percentage?: number; isCorrect?: boolean};
type Agg = {name?: string; subject?: string; module?: string; questionId?: string; question?: string; blueprintIndex?: number; attempted?: number; correct?: number; accuracyPct?: number; avgTimeSec?: number; avgAttempted?: number; avgCorrect?: number; avgAccuracyPct?: number; avgMeanSec?: number; correctPct?: number; options?: OptionPerformance[]; optionDistribution?: OptionPerformance[]};
type Analytics = {ok: true; overall: Agg & {completionPct: number; averageAccuracy?: number; averageTimeSec?: number}; subjects: Agg[]; modules: Agg[]; questions: Agg[]};
type Draft = {ok: true; full: {title: string; instructions: string; dueAt: string; settings: {scorePolicy?: string; correctionPolicy?: string; shuffleQuestions?: boolean}; release: {scoreReleasedAt?: string | null; correctionsReleasedAt?: string | null} | null}};
type StudentSortKey = "name" | "status" | "accuracy" | "avgTime";
type BreakdownSortKey = "name" | "module" | "score" | "accuracy" | "avgTime";
type SortDirection = "asc" | "desc";

function time(value: number) {
  const sec = Math.max(0, Math.round(value || 0));
  return sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
}

function studentAverageTime(row: StudentRow) {
  return Number(row.summary.meanSec ||
    (row.summary.attempted > 0 ? row.summary.usedSec / row.summary.attempted : 0));
}

function mixedCase(value: string) {
  const words = String(value || "General").trim().toLocaleLowerCase().split(/\s+/);
  const minor = new Set(["and", "or", "of", "the", "in", "to", "for"]);
  return words.map((word, index) => index > 0 && minor.has(word) ? word :
    word.replace(/^([a-z])/, (letter) => letter.toLocaleUpperCase())).join(" ");
}

export default function EducatorDrillDashboard({bootcamp, drillId}: {bootcamp: string; drillId: string}) {
  const {user} = useAuth();
  const [submissions, setSubmissions] = useState<Submissions | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<"students" | "subjects" | "modules" | "questions">("students");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [studentSort, setStudentSort] = useState<{key: StudentSortKey; direction: SortDirection}>({key: "name", direction: "asc"});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState<"score" | "corrections" | null>(null);
  const [settings, setSettings] = useState({title: "", instructions: "", dueAt: "", scorePolicy: "immediate", correctionPolicy: "manual", shuffleQuestions: true});

  async function load() {
    if (!user) return;
    setError("");
    try {
      const [submissionData, analyticsData, draftData] = await Promise.all([
        callFunction<Submissions>(user, "getEducatorDrillSubmissionsHttps", {bootcamp, drillId}, {retryTransient: true}),
        callFunction<Analytics>(user, "getEducatorDrillAnalyticsHttps", {bootcamp, drillId}, {retryTransient: true}),
        callFunction<Draft>(user, "getEducatorDrillDraftHttps", {bootcamp, drillId}, {retryTransient: true}),
      ]);
      setSubmissions(submissionData);
      setAnalytics(analyticsData);
      setDraft(draftData);
      const dueAt = draftData.full.dueAt;
      setSettings({
        title: draftData.full.title,
        instructions: draftData.full.instructions,
        dueAt: dueAt ? new Date(new Date(dueAt).getTime() - new Date(dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
        scorePolicy: draftData.full.settings.scorePolicy || "immediate",
        correctionPolicy: draftData.full.settings.correctionPolicy || "manual",
        shuffleQuestions: draftData.full.settings.shuffleQuestions !== false,
      });
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bootcamp, drillId, user]);
  const studentRows = useMemo(() => {
    const rows = (submissions?.students || []).filter((row) =>
      (filter === "all" || row.status === filter) && row.studentName.toLowerCase().includes(query.toLowerCase()));
    return [...rows].sort((a, b) => {
      let comparison = 0;
      if (studentSort.key === "name") comparison = a.studentName.localeCompare(b.studentName);
      else if (studentSort.key === "status") comparison = a.status.localeCompare(b.status);
      else if (studentSort.key === "accuracy") comparison = Number(a.summary.accuracyPct || 0) - Number(b.summary.accuracyPct || 0);
      else comparison = studentAverageTime(a) - studentAverageTime(b);
      if (comparison === 0) comparison = a.studentName.localeCompare(b.studentName);
      return studentSort.direction === "asc" ? comparison : -comparison;
    });
  }, [filter, query, studentSort, submissions]);

  function sortStudents(key: StudentSortKey) {
    setStudentSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await callFunction(user, "updateEducatorDrillSettingsHttps", {
        bootcamp, drillId, title: settings.title, instructions: settings.instructions,
        dueAt: settings.dueAt ? new Date(settings.dueAt).toISOString() : "",
        settings: {scorePolicy: settings.scorePolicy, correctionPolicy: settings.correctionPolicy, shuffleQuestions: settings.shuffleQuestions, shuffleOptions: false},
      });
      setSettingsOpen(false);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!user || !confirmRelease) return;
    setBusy(true);
    try {
      await callFunction(user, "releaseEducatorAssignmentHttps", {bootcamp, drillId, target: confirmRelease});
      setConfirmRelease(null);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const drill = submissions?.drill;
  const overall = analytics?.overall;
  const releaseState = draft?.full.release;

  return <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
    {busy && <BrandedLoadingOverlay label="Updating assignment" />}
    <Link href={`/app/educator/bootcamps/${bootcamp}/drills`} className="inline-flex items-center gap-2 text-sm text-slate-700">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>Drills
    </Link>
    {!drill && !error ? <div className="mt-6 h-80 animate-pulse rounded-3xl bg-white" /> : <>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs uppercase tracking-[.2em] text-brand-green/65">{drill?.status}</p><h1 className="mt-2 text-3xl font-semibold">{drill?.title || "Drill dashboard"}</h1><p className="mt-2 text-sm text-slate-600">{drill?.instructions || "Submission and performance overview."}</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setSettingsOpen(true)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm">Settings</button>
          {!releaseState?.scoreReleasedAt && <button onClick={() => setConfirmRelease("score")} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm">Release scores</button>}
          {!releaseState?.correctionsReleasedAt && <button onClick={() => setConfirmRelease("corrections")} className="min-h-11 rounded-xl bg-brand-green px-4 text-sm text-white">Release corrections</button>}
        </div>
      </div>
      {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[["Submitted", `${drill?.submittedCount || 0}/${drill?.assignedCount || 0}`], ["Completion", `${Math.round(Number(overall?.completionPct || 0))}%`], ["Average accuracy", `${Math.round(Number(overall?.accuracyPct ?? overall?.avgAccuracyPct ?? overall?.averageAccuracy ?? 0))}%`], ["Average time", time(Number(overall?.avgTimeSec ?? overall?.avgMeanSec ?? overall?.averageTimeSec ?? 0))]].map(([label, value]) => <article key={label} className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-xs uppercase tracking-wider text-brand-green/60">{label}</p><p className="mt-3 text-3xl font-medium">{value}</p></article>)}
      </section>
      <div className="mt-7 flex flex-wrap gap-2">{(["students", "subjects", "modules", "questions"] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={`rounded-xl px-4 py-2 text-sm capitalize ${tab === value ? "bg-brand-green text-white" : "bg-white text-slate-600"}`}>{value}</button>)}</div>
      {tab === "students" ? <section className="mt-5">
        <div className="flex gap-3"><select value={filter} onChange={(event) => setFilter(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3"><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="started">Started</option><option value="assigned">Not started</option><option value="late">Late</option></select><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search students" className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4" /></div>
        <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] table-fixed text-left">
            <colgroup><col className="w-[30%]" /><col className="w-[18%]" /><col className="w-[17%]" /><col className="w-[18%]" /><col className="w-[17%]" /></colgroup>
            <thead className="bg-brand-green text-xs uppercase text-white"><tr>
              <SortableHeader label="Name" sortKey="name" current={studentSort} onSort={sortStudents} />
              <SortableHeader label="Status" sortKey="status" current={studentSort} onSort={sortStudents} />
              <SortableHeader label="Accuracy" sortKey="accuracy" current={studentSort} onSort={sortStudents} />
              <SortableHeader label="Avg Time" sortKey="avgTime" current={studentSort} onSort={sortStudents} />
              <th className="px-5 py-3 font-normal">Details</th>
            </tr></thead>
            <tbody>{studentRows.map((row) => <tr key={row.studentId} className="border-t border-slate-100 text-sm">
              <td className="px-5 py-4 font-medium">{row.studentName}</td>
              <td className="px-5 py-4 capitalize">{row.status}</td>
              <td className="px-5 py-4">{row.status === "submitted" ? `${Math.round(Number(row.summary.accuracyPct || 0))}%` : "--"}</td>
              <td className="px-5 py-4 text-slate-600">{row.status === "submitted" ? time(studentAverageTime(row)) : "--"}</td>
              <td className="px-5 py-4">{row.status === "submitted" ? <Link href={`/app/educator/bootcamps/${bootcamp}/drills/${drillId}/students/${encodeURIComponent(row.studentId)}?attemptId=${encodeURIComponent(row.attemptId)}`} className="inline-flex min-h-9 items-center rounded-xl border border-slate-300 px-3 text-sm hover:border-brand-green">Open</Link> : "--"}</td>
            </tr>)}{!studentRows.length && <tr><td colSpan={5} className="p-8 text-center text-sm text-slate-500">No students match this view.</td></tr>}</tbody>
          </table>
        </div>
      </section> : <Breakdown rows={tab === "subjects" ? analytics?.subjects || [] : tab === "modules" ? analytics?.modules || [] : analytics?.questions || []} kind={tab} />}
    </>}
    {settingsOpen && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4"><form onSubmit={saveSettings} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-white p-6"><div className="flex justify-between"><h2 className="text-2xl font-medium">Assignment settings</h2><button type="button" onClick={() => setSettingsOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-brand-mist text-xl">×</button></div><label className="mt-5 block text-sm">Title<input value={settings.title} onChange={(event) => setSettings({...settings, title: event.target.value})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label><label className="mt-4 block text-sm">Instructions<textarea value={settings.instructions} onChange={(event) => setSettings({...settings, instructions: event.target.value})} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 p-3" /></label><label className="mt-4 block text-sm">Due date<input type="datetime-local" value={settings.dueAt} onChange={(event) => setSettings({...settings, dueAt: event.target.value})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm">Score policy<select value={settings.scorePolicy} onChange={(event) => setSettings({...settings, scorePolicy: event.target.value})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3"><option value="immediate">Immediate</option><option value="on_due_date">On due date</option><option value="manual">Manual</option></select></label><label className="text-sm">Correction policy<select value={settings.correctionPolicy} onChange={(event) => setSettings({...settings, correctionPolicy: event.target.value})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3"><option value="immediate">Immediate</option><option value="on_due_date">On due date</option><option value="manual">Manual</option></select></label></div><button className="mt-6 min-h-12 w-full rounded-2xl bg-brand-green text-white">SAVE SETTINGS</button></form></div>}
    {confirmRelease && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4"><section className="w-full max-w-md rounded-[2rem] bg-white p-6 text-center"><h2 className="text-xl font-medium">Release {confirmRelease}?</h2><p className="mt-3 text-sm text-slate-600">This is irreversible.{confirmRelease === "corrections" ? " Scores will also be released." : " Corrections remain restricted."}</p><div className="mt-6 grid grid-cols-2 gap-3"><button onClick={() => setConfirmRelease(null)} className="min-h-11 rounded-xl border border-slate-300">CANCEL</button><button onClick={release} className="min-h-11 rounded-xl bg-brand-green text-white">RELEASE</button></div></section></div>}
  </div>;
}

function SortableHeader({label, sortKey, current, onSort}: {label: string; sortKey: StudentSortKey; current: {key: StudentSortKey; direction: SortDirection}; onSort: (key: StudentSortKey) => void}) {
  const active = current.key === sortKey;
  return <th className="px-5 py-3 font-normal" aria-sort={active ? (current.direction === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1.5 text-left uppercase hover:text-brand-gold">
      {label}<span aria-hidden="true" className={active ? "opacity-100" : "opacity-35"}>{active && current.direction === "desc" ? "↓" : "↑"}</span>
    </button>
  </th>;
}

function Breakdown({rows, kind}: {rows: Agg[]; kind: string}) {
  const questions = kind === "questions";
  const [sort, setSort] = useState<{key: BreakdownSortKey; direction: SortDirection}>({key: "name", direction: "asc"});
  const [selectedQuestion, setSelectedQuestion] = useState<null | {row: Agg; index: number; attempted: number; correct: number; accuracy: number; name: string}>(null);
  const normalized = rows.map((row, index) => {
    const attempted = Number(row.attempted ?? row.avgAttempted ?? 0);
    const correct = Number(row.correct ?? row.avgCorrect ?? 0);
    const accuracy = Number(row.accuracyPct ?? row.correctPct ?? row.avgAccuracyPct ?? 0);
    const averageTime = Number(row.avgTimeSec ?? row.avgMeanSec ?? 0);
    const name = questions
      ? `${row.subject || "Question"} · Q${Number(row.blueprintIndex || index + 1)}`
      : kind === "modules"
        ? mixedCase(String(row.module || row.name || "General"))
        : String(row.subject || row.name || "Subject");
    return {row, index, attempted, correct, accuracy, averageTime, name};
  }).sort((a, b) => {
    let comparison = 0;
    if (sort.key === "name") comparison = a.name.localeCompare(b.name);
    else if (sort.key === "module") comparison = String(a.row.module || "").localeCompare(String(b.row.module || ""));
    else if (sort.key === "score") comparison = a.correct - b.correct || a.attempted - b.attempted;
    else if (sort.key === "accuracy") comparison = a.accuracy - b.accuracy;
    else comparison = a.averageTime - b.averageTime;
    if (comparison === 0) comparison = a.name.localeCompare(b.name);
    return sort.direction === "asc" ? comparison : -comparison;
  });

  function updateSort(key: BreakdownSortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  const headers: Array<{label: string; key: BreakdownSortKey}> = questions ? [
    {label: "Question", key: "name"}, {label: "Module", key: "module"},
    {label: "Score", key: "score"}, {label: "Accuracy", key: "accuracy"},
  ] : [
    {label: kind === "modules" ? "Module" : "Subject", key: "name"},
    {label: "Score", key: "score"}, {label: "Accuracy", key: "accuracy"},
    {label: "Avg Time", key: "avgTime"},
  ];

  return <>
    <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200 bg-white">
      <table className="w-full min-w-[680px] table-fixed text-left">
        {questions
          ? <colgroup><col className="w-[32%]" /><col className="w-[22%]" /><col className="w-[16%]" /><col className="w-[16%]" /><col className="w-[14%]" /></colgroup>
          : <colgroup><col className="w-[38%]" /><col className="w-[24%]" /><col className="w-[19%]" /><col className="w-[19%]" /></colgroup>}
        <thead className="bg-brand-green text-xs uppercase text-white"><tr>{headers.map((header) => <BreakdownHeader key={header.key} label={header.label} sortKey={header.key} current={sort} onSort={updateSort} />)}{questions && <th className="px-5 py-3 font-normal">Details</th>}</tr></thead>
        <tbody>{normalized.map(({row, index, attempted, correct, accuracy, averageTime, name}) =>
          <tr
            key={String(row.questionId || row.module || row.subject || row.name || index)}
            className="border-t border-slate-100 text-sm"
          >
            <td className="px-5 py-4">{name}</td>
            <td className="px-5 py-4">{questions ? mixedCase(String(row.module || "General")) : `${correct}/${attempted}`}</td>
            <td className="px-5 py-4">{questions ? `${correct}/${attempted}` : attempted > 0 ? `${Math.round(accuracy)}%` : "--"}</td>
            <td className="px-5 py-4">{questions ? attempted > 0 ? `${Math.round(accuracy)}%` : "--" : attempted > 0 ? time(averageTime) : "--"}</td>
            {questions && <td className="px-5 py-4"><button type="button" onClick={() => setSelectedQuestion({row, index, attempted, correct, accuracy, name})} className="inline-flex min-h-9 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs hover:border-brand-green">OPEN</button></td>}
          </tr>
        )}{!normalized.length && <tr><td colSpan={questions ? 5 : 4} className="p-8 text-center text-sm text-slate-500">No submitted data yet.</td></tr>}</tbody>
      </table>
    </div>
    {selectedQuestion && <QuestionPerformanceModal detail={selectedQuestion} onClose={() => setSelectedQuestion(null)} />}
  </>;
}

function BreakdownHeader({label, sortKey, current, onSort}: {label: string; sortKey: BreakdownSortKey; current: {key: BreakdownSortKey; direction: SortDirection}; onSort: (key: BreakdownSortKey) => void}) {
  const active = current.key === sortKey;
  return <th className="px-5 py-3 font-normal" aria-sort={active ? (current.direction === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1.5 text-left uppercase hover:text-brand-gold">
      {label}<span aria-hidden="true" className={active ? "opacity-100" : "opacity-35"}>{active && current.direction === "desc" ? "↓" : "↑"}</span>
    </button>
  </th>;
}

function QuestionPerformanceModal({detail, onClose}: {detail: {row: Agg; index: number; attempted: number; correct: number; accuracy: number; name: string}; onClose: () => void}) {
  const {row, attempted, correct, accuracy, name} = detail;
  const options = row.optionDistribution || row.options || [];
  return <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label={`${name} performance`}>
    <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close question details" />
    <section className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs uppercase tracking-[.18em] text-brand-green/60">Question performance</p><h2 className="mt-2 text-2xl font-medium">{name}</h2><p className="mt-1 text-sm text-slate-500">{mixedCase(String(row.module || "General"))}</p></div>
        <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-mist text-xl" aria-label="Close">×</button>
      </div>
      <div className="mt-6 rounded-2xl bg-brand-mist p-5"><p className="text-xs uppercase tracking-wider text-brand-green/60">Question</p><p className="mt-3 whitespace-pre-wrap text-base leading-7 text-slate-800">{questionText(String(row.question || name))}</p></div>
      <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs uppercase text-slate-500">Score</p><p className="mt-2 text-2xl">{correct}/{attempted}</p></div><div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs uppercase text-slate-500">Accuracy</p><p className="mt-2 text-2xl">{attempted > 0 ? `${Math.round(accuracy)}%` : "--"}</p></div></div>
      <div className="mt-6"><h3 className="text-sm font-medium uppercase tracking-wider text-brand-green">Options</h3>
        {options.length ? <div className="mt-3 space-y-3">{options.map((option, optionIndex) => {
          const percentage = Number(option.percentage ?? (attempted > 0 ? Number(option.count || 0) * 100 / attempted : 0));
          return <div key={`${option.label || optionIndex}-${option.answer || option.option || ""}`} className={`rounded-2xl border p-4 ${option.isCorrect ? "border-green-300 bg-green-50" : "border-slate-200 bg-white"}`}>
            <div className="flex items-start justify-between gap-4"><p className="text-sm leading-6"><span className="mr-2 font-medium">{option.label || String.fromCharCode(65 + optionIndex)}.</span>{questionText(String(option.answer || option.option || "Option"))}</p><span className="shrink-0 text-sm text-slate-600">{Number(option.count || 0)}/{attempted} · {Math.round(percentage)}%</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${option.isCorrect ? "bg-brand-green" : "bg-brand-gold"}`} style={{width: `${Math.max(0, Math.min(100, percentage))}%`}} /></div>
          </div>;
        })}</div> : <p className="mt-3 rounded-2xl bg-brand-mist p-5 text-sm text-slate-600">No option selections are available yet.</p>}
      </div>
      <button type="button" onClick={onClose} className="mt-7 min-h-12 w-full rounded-2xl border border-slate-300 bg-white text-sm hover:border-brand-green">CLOSE</button>
    </section>
  </div>;
}
