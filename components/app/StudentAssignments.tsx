"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import type {DrillSession} from "@/lib/types/drill";
import type {StudentAssignment, StudentAssignmentsResponse} from "@/lib/types/educator";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";

function dateLabel(value: string) {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function AssignmentCard({row, busy, onOpen}: {row: StudentAssignment; busy: boolean; onOpen: () => void}) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs uppercase tracking-wider text-brand-green/65">{row.status === "submitted" ? "Submitted" : row.status === "late" ? "Late" : row.status === "started" ? "In progress" : "Assigned"}</p><h2 className="mt-2 text-lg font-medium text-slate-950">{row.title}</h2><p className="mt-1 text-sm text-slate-500">From {row.createdByName}</p></div>
      <span className={`rounded-full px-3 py-1 text-xs ${row.status === "late" ? "bg-red-50 text-red-700" : row.status === "submitted" ? "bg-brand-green/10 text-brand-green" : "bg-brand-gold/15 text-brand-green"}`}>{row.status}</span>
    </div>
    {row.instructions && <p className="mt-4 text-sm leading-6 text-slate-600">{row.instructions}</p>}
    <p className="mt-4 text-xs text-slate-500">{row.subjects?.length ? row.subjects.join(", ") : "Subject details available when opened"}</p>
    <dl className="mt-3 grid grid-cols-3 gap-3 rounded-2xl bg-brand-mist p-4 text-sm">
      <div><dt className="text-xs text-slate-500">Questions</dt><dd className="mt-1 text-slate-900">{row.questionCount}</dd></div>
      <div><dt className="text-xs text-slate-500">Time</dt><dd className="mt-1 text-slate-900">{row.totalTimeMin} min</dd></div>
      <div><dt className="text-xs text-slate-500">Due</dt><dd className="mt-1 text-slate-900">{dateLabel(row.dueAt)}</dd></div>
    </dl>
    <button type="button" disabled={busy} onClick={onOpen} className="mt-5 min-h-11 w-full rounded-2xl bg-brand-green px-5 text-sm font-medium text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60">{busy ? "OPENING…" : row.status === "submitted" ? "VIEW RESULT" : row.status === "started" ? "RESUME ASSIGNMENT" : "START ASSIGNMENT"}</button>
  </article>;
}

export default function StudentAssignments({bootcamp}: {bootcamp: string}) {
  const router = useRouter();
  const {user, account, loading} = useAuth();
  const [rows, setRows] = useState<StudentAssignment[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setLoadingRows(true);
    callFunction<StudentAssignmentsResponse, {bootcamp: string}>(user, "getStudentEducatorDrillAssignmentsHttps", {bootcamp}, {retryTransient: true, signal: controller.signal})
      .then((response) => setRows(response.assignments || []))
      .catch((reason) => { if ((reason as Error).name !== "AbortError") setError((reason as Error).message); })
      .finally(() => setLoadingRows(false));
    return () => controller.abort();
  }, [bootcamp, user]);

  const sections = useMemo(() => [
    {title: "Due or active", rows: rows.filter((row) => row.status === "assigned" || row.status === "started")},
    {title: "Late", rows: rows.filter((row) => row.status === "late")},
    {title: "Submitted", rows: rows.filter((row) => row.status === "submitted")},
  ].filter((section) => section.rows.length), [rows]);

  async function open(row: StudentAssignment) {
    if (!user) return;
    if (row.status === "submitted" && row.sessionId) {
      router.push(`/app/drills/${row.sessionId}/results?from=assignments`);
      return;
    }
    setBusy(row.drillId); setError("");
    try {
      const response = await callFunction<{ok: true; session: DrillSession}, {drillId: string}>(user, "createStudentAssignmentSessionHttps", {drillId: row.drillId});
      if (!response.session?.sessionId) throw new Error("The assignment session could not be created.");
      localStorage.setItem(`di.activeSession.${bootcamp}`, response.session.sessionId);
      router.push(`/app/drills/${response.session.sessionId}`);
    } catch (reason) { setError((reason as Error).message); setBusy(""); }
  }

  if (!account) return <BrandedLoadingOverlay label="Loading assignments" />;
  return <AppShell profile={account.profile}><div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <Link href={`/app/bootcamps/${bootcamp}`} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>{bootcamp.toUpperCase()} home</Link>
    <header className="mt-6"><p className="text-xs uppercase tracking-[.2em] text-brand-green/65">School work</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Assignments</h1><p className="mt-2 text-sm text-slate-600">Start required drills, resume active work, and view submitted results when released.</p></header>
    {error && <p role="alert" className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {loadingRows ? <div className="mt-8 grid gap-4 md:grid-cols-2"><div className="h-64 animate-pulse rounded-3xl bg-white" /><div className="h-64 animate-pulse rounded-3xl bg-white" /></div> : sections.length === 0 ? <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No assignments are waiting for you.</div> : sections.map((section) => <section key={section.title} className="mt-8"><h2 className="text-lg font-medium">{section.title}</h2><div className="mt-4 grid gap-4 lg:grid-cols-2">{section.rows.map((row) => <AssignmentCard key={row.drillId} row={row} busy={busy === row.drillId} onOpen={() => open(row)} />)}</div></section>)}
  </div>{busy && <BrandedLoadingOverlay label="Preparing assignment" />}</AppShell>;
}
