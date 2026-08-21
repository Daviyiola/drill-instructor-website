"use client";

import Link from "next/link";
import {useEffect, useMemo, useRef, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {useAuth} from "@/components/app/AuthProvider";

type GatewayRow = {
  id: string; rawGroupId?: string; scope?: string; ownerEducatorId?: string;
  firstName?: string; lastName?: string; name?: string; platoonName?: string;
  attempted: number; correct: number; accuracyPct: number; sessions: number;
  totalTimeSec: number; avgTimeSec: number; lastTakenAt: string;
  studentCount?: number; activeStudentCount?: number;
};
type GatewayResponse = {ok: true; students: GatewayRow[]; groups: GatewayRow[]; syncedAt: string};
type SortKey = "name" | "attempted" | "accuracy" | "averagetime" | "sessions";

function time(seconds: number) {
  const value = Math.max(0, Math.round(seconds || 0));
  return value >= 60 ? `${Math.floor(value / 60)}m ${value % 60}s` : `${value}s`;
}

function rowName(row: GatewayRow) {
  return row.name || `${row.firstName || ""} ${row.lastName || ""}`.trim();
}

function sortValue(row: GatewayRow, key: SortKey) {
  if (key === "name") return rowName(row).toLocaleLowerCase();
  if (key === "accuracy") return Number(row.accuracyPct || 0);
  if (key === "averagetime") return Number(row.avgTimeSec || 0);
  return Number(row[key] || 0);
}

export default function EducatorAnalyticsGateway({bootcamp}: {bootcamp: string}) {
  const {user} = useAuth();
  const [tab, setTab] = useState<"students" | "groups">("students");
  const [range, setRange] = useState("90d");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [orderBy, setOrderBy] = useState<"asc" | "desc">("asc");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<GatewayResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(25);
  const requestId = useRef(0);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    const cacheKey = `di.educator.analytics-gateway:${user.uid}:${bootcamp}:${range}`;
    let cached = false;
    try {
      const value = sessionStorage.getItem(cacheKey);
      if (value) {
        setData(JSON.parse(value) as GatewayResponse);
        cached = true;
      }
    } catch { /* optional browser cache */ }
    setBusy(!cached); setError("");
    callFunction<GatewayResponse>(user, "getEducatorAnalyticsGatewayHttps", {bootcamp, range}, {retryTransient: true, signal: controller.signal})
      .then((response) => {
        if (requestId.current !== currentRequest) return;
        setData(response);
        try { sessionStorage.setItem(cacheKey, JSON.stringify(response)); } catch { /* optional browser cache */ }
      }).catch((reason) => {
        if (controller.signal.aborted || requestId.current !== currentRequest) return;
        setError((reason as Error).message);
      }).finally(() => {
        if (requestId.current === currentRequest) setBusy(false);
      });
    return () => controller.abort();
  }, [bootcamp, range, user]);
  const rows = useMemo(() => {
    const direction = orderBy === "asc" ? 1 : -1;
    return (data?.[tab] || [])
      .filter((row) => `${row.name || ""} ${row.firstName || ""} ${row.lastName || ""}`.toLowerCase().includes(query.trim().toLowerCase()))
      .slice()
      .sort((a, b) => {
        const av = sortValue(a, sortBy);
        const bv = sortValue(b, sortBy);
        if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * direction;
        return (Number(av) - Number(bv)) * direction;
      });
  }, [data, orderBy, query, sortBy, tab]);
  const visibleRows = rows.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(25);
  }, [data, query, tab]);

  function changeSort(nextSort: SortKey) {
    if (sortBy === nextSort) {
      setOrderBy((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortBy(nextSort);
    setOrderBy("asc");
  }

  function sortHeader(label: string, key: SortKey) {
    const active = sortBy === key;
    return <div role="columnheader"
      aria-sort={active ? orderBy === "asc" ? "ascending" : "descending" : "none"}>
      <button type="button" onClick={() => changeSort(key)}
        className="inline-flex items-center gap-1.5 text-left uppercase transition hover:text-brand-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        {label}
        <span aria-hidden className={active ? "opacity-100" : "opacity-35"}>
          {active && orderBy === "desc" ? "↓" : "↑"}
        </span>
      </button>
    </div>;
  }

  return <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
    <Link href={`/app/educator/bootcamps/${bootcamp}`} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>{bootcamp.toUpperCase()} home</Link>
    <header className="mt-6"><p className="text-xs uppercase tracking-[.2em] text-brand-green/65">Performance Insights</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Analytics</h1><p className="mt-2 text-sm text-slate-600">Choose a student or group to open the full analytics view.</p></header>
    <div className="mt-7 flex flex-wrap items-center gap-3"><div className="grid min-w-64 grid-cols-2 rounded-2xl bg-white p-1">{(["students", "groups"] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={`min-h-10 rounded-xl text-sm capitalize ${tab === value ? "bg-brand-green text-white" : "text-slate-500"}`}>{value}</button>)}</div><select value={range} onChange={(event) => setRange(event.target.value)} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4"><option value="14d">14 days</option><option value="30d">30 days</option><option value="90d">90 days</option><option value="all">All time</option></select><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab}`} className="min-h-11 min-w-56 flex-1 rounded-2xl border border-slate-200 bg-white px-4 outline-none focus:border-brand-green" /></div>
    {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <div className="mt-6 overflow-x-auto rounded-3xl border border-slate-200 bg-white">
      <div className="hidden min-w-[860px] grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(110px,1fr))_90px] items-center gap-4 bg-brand-green px-5 py-3 text-xs uppercase tracking-wider text-white md:grid">
        {sortHeader(tab === "students" ? "Student" : "Group", "name")}
        {sortHeader("Attempts", "attempted")}
        {sortHeader("Accuracy", "accuracy")}
        {sortHeader("Mean", "averagetime")}
        {sortHeader("Sessions", "sessions")}
        <span>Details</span>
      </div>
      {busy && !data ? <div className="h-72 animate-pulse bg-white" /> : visibleRows.length ? visibleRows.map((row) => {
        const display = row.name || `${row.firstName || ""} ${row.lastName || ""}`.trim();
        const href = tab === "students" ? `/app/educator/bootcamps/${bootcamp}/analytics/students/${encodeURIComponent(row.id)}?name=${encodeURIComponent(display)}` : `/app/educator/bootcamps/${bootcamp}/analytics/groups/${encodeURIComponent(row.id)}?rawGroupId=${encodeURIComponent(row.rawGroupId || row.id)}&scope=${encodeURIComponent(row.scope || "admin")}&name=${encodeURIComponent(display)}`;
        return <div key={`${tab}-${row.id}`} className="grid gap-3 border-t border-slate-100 px-5 py-4 first:border-t-0 md:min-w-[860px] md:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(110px,1fr))_90px] md:items-center md:gap-4"><div><p className="text-sm font-medium">{display}</p><p className="mt-1 text-xs text-slate-500">{tab === "groups" ? `${row.activeStudentCount || 0}/${row.studentCount || 0} active students` : row.platoonName}</p></div><div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:contents"><p className="text-sm tabular-nums"><span className="text-xs text-slate-500 md:hidden">Attempts: </span>{row.attempted}</p><p className="text-sm tabular-nums"><span className="text-xs text-slate-500 md:hidden">Accuracy: </span>{row.attempted ? `${Math.round(row.accuracyPct)}%` : "--"}</p><p className="text-sm tabular-nums"><span className="text-xs text-slate-500 md:hidden">Mean: </span>{time(row.avgTimeSec)}</p><p className="text-sm tabular-nums"><span className="text-xs text-slate-500 md:hidden">Sessions: </span>{row.sessions}</p><Link href={href} className="inline-flex min-h-9 w-[90px] items-center justify-center rounded-xl border border-slate-300 px-3 text-sm hover:border-brand-green">Open</Link></div></div>;
      }) : !busy && data ? <p className="p-8 text-center text-sm text-slate-500">No {tab} match this view.</p> : null}
      {visibleCount < rows.length && <div className="border-t border-slate-100 p-4 text-center"><button type="button" onClick={() => setVisibleCount((count) => count + 25)} className="min-h-10 rounded-xl border border-slate-300 px-5 text-sm transition hover:border-brand-green hover:bg-brand-mist">LOAD MORE</button><p className="mt-2 text-xs text-slate-400">Showing {visibleRows.length} of {rows.length}</p></div>}
    </div>
  </div>;
}
