"use client";

import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import type {EducatorDrillRow, EducatorDrillsResponse} from "@/lib/types/educator";
import {useAuth} from "@/components/app/AuthProvider";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";

function shortDate(value?: string) {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], {month: "short", day: "numeric", year: "numeric"});
}

export default function EducatorDrills({bootcamp}: {bootcamp: string}) {
  const {user} = useAuth();
  const [data, setData] = useState<EducatorDrillsResponse | null>(null);
  const [scope, setScope] = useState<"own" | "school">("own");
  const [filter, setFilter] = useState<EducatorDrillRow["status"] | "archive">("draft");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{row: EducatorDrillRow; action: "delete" | "close" | "reopen" | "archive" | "restore"} | null>(null);
  async function load() {
    if (!user) return;
    setError("");
    try {
      const response = await callFunction<EducatorDrillsResponse>(user, "getEducatorDrillsHttps", {bootcamp, scope}, {retryTransient: true});
      setData(response);
    } catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bootcamp, scope, user]);
  const rows = useMemo(() => (data?.drills || []).filter((row) => {
    const inView = filter === "archive"
      ? row.status === "closed" && row.archived === true
      : row.status === filter && row.archived !== true;
    return inView && `${row.title} ${row.blueprintSummary?.subjectsText || ""}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [data, filter, query]);
  const counts = useMemo(() => ({
    draft: data?.drills.filter((r) => r.status === "draft").length || 0,
    published: data?.drills.filter((r) => r.status === "published").length || 0,
    closed: data?.drills.filter((r) => r.status === "closed" && r.archived !== true).length || 0,
    archive: data?.drills.filter((r) => r.status === "closed" && r.archived === true).length || 0,
  }), [data]);

  async function duplicate(row: EducatorDrillRow) {
    if (!user) return; setBusy(row.drillId); setError("");
    try { const response = await callFunction<{ok: true; drillId: string}>(user, "duplicateEducatorDrillHttps", {bootcamp, drillId: row.drillId}); await load(); window.location.href = `/app/educator/bootcamps/${bootcamp}/drills/${response.drillId}/edit`; }
    catch (reason) { setError((reason as Error).message); setBusy(""); }
  }
  async function mutate() {
    if (!user || !confirm) return;
    const {row, action} = confirm; setBusy(row.drillId); setError(""); setConfirm(null);
    try {
      if (action === "delete") await callFunction(user, "deleteEducatorDrillDraftHttps", {bootcamp, drillId: row.drillId});
      else if (action === "archive" || action === "restore") await callFunction(user, "setEducatorDrillArchivedHttps", {bootcamp, drillId: row.drillId, archived: action === "archive"});
      else await callFunction(user, "updateEducatorDrillStatusHttps", {bootcamp, drillId: row.drillId, action});
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  }

  const primaryActionClass = "inline-flex min-h-10 items-center rounded-xl border-[2.5px] border-brand-green bg-brand-green px-4 text-sm text-white transition-colors hover:bg-brand-green/90";
  const secondaryActionClass = "inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-700 transition-colors hover:border-brand-green/40 hover:bg-brand-green/10 hover:text-brand-green";
  const dangerActionClass = "inline-flex min-h-10 items-center rounded-xl border border-red-200 bg-white px-4 text-sm text-red-700 transition-colors hover:border-red-300 hover:bg-red-50";

  return <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
    {busy && <BrandedLoadingOverlay label="Updating drill" />}
    <Link href={`/app/educator/bootcamps/${bootcamp}`} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>{bootcamp.toUpperCase()} home</Link>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[.2em] text-brand-green/65">Assignment workshop</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Drills</h1><p className="mt-2 text-sm text-slate-600">Build question sets, assign students, and inspect submissions.</p></div><div className="flex flex-wrap gap-2"><Link href={`/app/educator/bootcamps/${bootcamp}/browse`} className="inline-flex min-h-12 items-center rounded-2xl border border-brand-green bg-white px-5 text-sm text-brand-green transition-colors hover:bg-brand-green/10">BROWSE QUESTIONS</Link><Link href={`/app/educator/bootcamps/${bootcamp}/drills/new`} className="inline-flex min-h-12 items-center rounded-2xl bg-brand-green px-5 text-sm text-white transition-colors hover:bg-brand-green/90">CREATE DRILL</Link></div></div>
    <div className="mt-7 flex flex-wrap gap-3">
      <div className="flex flex-wrap gap-2">{(["draft", "published", "closed", "archive"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-xl px-4 py-2 text-sm capitalize transition-colors ${filter === value ? "bg-brand-green text-white" : "bg-white text-slate-600 hover:bg-brand-green/10 hover:text-brand-green"}`}>{value} ({counts[value]})</button>)}</div>
      {(data?.caller.adminAccess || data?.caller.superAdmin) && <label className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 text-xs text-slate-500">
        <span>Viewing</span>
        <select value={scope} onChange={(event) => setScope(event.target.value as "own" | "school")} className="bg-transparent text-xs text-slate-700 outline-none">
          <option value="own">My drills</option>
          <option value="school">School-wide</option>
        </select>
      </label>}
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search drills" className="min-h-10 min-w-56 flex-1 rounded-xl border border-slate-200 bg-white px-4 outline-none focus:border-brand-green" />
    </div>
    {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {!data ? <div className="mt-6 h-72 animate-pulse rounded-3xl bg-white" /> : rows.length ? <div className="mt-6 grid gap-4 xl:grid-cols-2">{rows.map((row) => {
      const assigned = Number(row.assignedCount || 0);
      const submitted = Number(row.submittedCount || 0);
      return <article key={row.drillId} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wider text-brand-green/60">{row.archived ? "archived" : row.status}{row.isPastDue ? " · past due" : ""}</p><h2 className="mt-2 text-xl font-medium">{row.title}</h2><p className="mt-2 text-sm text-slate-500">{row.blueprintSummary?.subjectsText || "No subjects"} · {row.blueprintSummary?.questionCount || 0} questions{row.status !== "draft" ? ` · ${submitted}/${assigned} submitted` : ""}</p></div><span className="rounded-full bg-brand-mist px-3 py-1 text-xs">{shortDate(row.dueAt)}</span></div>
        <div className="mt-5 flex flex-wrap gap-2">{row.status === "draft" ? <>
          <Link href={`/app/educator/bootcamps/${bootcamp}/drills/${row.drillId}/edit`} className={primaryActionClass}>Edit</Link>
          <Link href={`/app/educator/bootcamps/${bootcamp}/drills/${row.drillId}/edit?stage=assign`} className={secondaryActionClass}>Assign</Link>
          <button onClick={() => duplicate(row)} className={secondaryActionClass}>Duplicate</button>
          <button onClick={() => setConfirm({row, action: "delete"})} className={dangerActionClass}>Delete</button>
        </> : <>
          <Link href={`/app/educator/bootcamps/${bootcamp}/drills/${row.drillId}`} className={primaryActionClass}>Dashboard</Link>
          <button onClick={() => duplicate(row)} className={secondaryActionClass}>Duplicate</button>
          <button onClick={() => setConfirm({row, action: row.status === "closed" ? "reopen" : "close"})} className={secondaryActionClass}>{row.status === "closed" ? "Reopen" : "Close"}</button>
          {row.status === "closed" && <button onClick={() => setConfirm({row, action: row.archived ? "restore" : "archive"})} className={secondaryActionClass}>{row.archived ? "Restore" : "Archive"}</button>}
        </>}</div>
      </article>;
    })}</div> : <div className="mt-6 rounded-3xl bg-white p-8 text-center text-sm text-slate-500">{filter === "archive" ? "Your archive is empty." : "No drills match this view."}</div>}
    {confirm && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4"><section className="w-full max-w-md rounded-[2rem] bg-white p-6 text-center"><h2 className="text-xl font-medium capitalize">{confirm.action} {confirm.row.title}?</h2><p className="mt-3 text-sm text-slate-600">{confirm.action === "delete" ? "This draft cannot be recovered." : confirm.action === "close" ? "Students cannot continue it, and submitted scores will be released." : confirm.action === "reopen" ? "Unfinished students will be able to continue with a new due date." : confirm.action === "archive" ? "This closed drill will move out of your regular drill views." : "This drill will return to your Closed inbox."}</p><div className="mt-6 grid grid-cols-2 gap-3"><button onClick={() => setConfirm(null)} className="min-h-11 rounded-xl border border-slate-300 transition-colors hover:bg-slate-50">CANCEL</button><button onClick={mutate} className="min-h-11 rounded-xl bg-brand-green text-white transition-colors hover:bg-brand-green/90">CONFIRM</button></div></section></div>}
  </div>;
}
