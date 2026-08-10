"use client";

import Link from "next/link";
import {FormEvent, useEffect, useMemo, useState} from "react";
import {useAuth} from "@/components/app/AuthProvider";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import {callFunction} from "@/lib/api/client";
import type {EducatorGroup, EducatorRosterResponse} from "@/lib/types/educator";

type GroupDraft = {group?: EducatorGroup; name: string; description: string; scope: "admin" | "educator"; memberIds: string[]};

function titleCase(value: string) {
  return String(value || "Recruit").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rankNumber(points: number) {
  if (points < 100) return 1;
  if (points < 250) return 2;
  if (points < 450) return 3;
  if (points < 800) return 4;
  if (points < 1300) return 5;
  if (points < 1950) return 6;
  if (points < 3000) return 7;
  if (points < 4500) return 8;
  if (points < 7000) return 9;
  return 10;
}

export default function EducatorRoster({bootcamp}: {bootcamp: string}) {
  const {user, educatorWorkspace} = useAuth();
  const [data, setData] = useState<EducatorRosterResponse | null>(null);
  const [tab, setTab] = useState<"students" | "groups">("students");
  const [groupScope, setGroupScope] = useState<"all" | "admin" | "educator">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "points">("name");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<EducatorGroup | null>(null);

  async function refresh(showBusy = true) {
    if (!user) return;
    if (showBusy) setBusy(true);
    setError("");
    try {
      const response = await callFunction<EducatorRosterResponse, {bootcamp: string}>(user, "getEducatorRosterHttps", {bootcamp}, {retryTransient: true});
      setData(response);
      sessionStorage.setItem(`di.educator.roster:${user.uid}:${bootcamp}`, JSON.stringify(response));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      if (showBusy) setBusy(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    try {
      const cached = sessionStorage.getItem(`di.educator.roster:${user.uid}:${bootcamp}`);
      if (cached) setData(JSON.parse(cached));
    } catch { /* optional cache */ }
    void refresh(!data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootcamp, user]);

  const students = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(data?.students || [])]
      .filter((row) => !needle || `${row.firstName} ${row.lastName} ${row.currentRank}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === "points" ? b.totalPoints - a.totalPoints : `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  }, [data, query, sort]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.groups || []).filter((row) => (groupScope === "all" || row.scope === groupScope) && (!needle || `${row.name} ${row.description}`.toLowerCase().includes(needle)));
  }, [data, groupScope, query]);

  const groupStudents = useMemo(() => {
    const needle = memberQuery.trim().toLowerCase();
    return [...(data?.students || [])]
      .filter((row) => !needle || `${row.firstName} ${row.lastName} ${row.currentRank}`.toLowerCase().includes(needle))
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  }, [data, memberQuery]);

  const canAdmin = educatorWorkspace?.caller.adminAccess || educatorWorkspace?.caller.superAdmin;

  function openGroup(group?: EducatorGroup) {
    setMemberQuery("");
    setDraft({group, name: group?.name || "", description: group?.description || "", scope: group?.scope || "educator", memberIds: group?.memberIds || []});
  }

  function toggleMember(studentId: string) {
    if (!draft) return;
    setDraft({...draft, memberIds: draft.memberIds.includes(studentId) ? draft.memberIds.filter((id) => id !== studentId) : [...draft.memberIds, studentId]});
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    if (!user || !draft) return;
    setBusy(true); setError("");
    try {
      await callFunction(user, draft.group ? "updateEducatorGroupHttps" : "createEducatorGroupHttps", {
        ...(draft.group ? {groupId: draft.group.rawGroupId || draft.group.id, scope: draft.group.scope, newScope: draft.scope} : {}),
        name: draft.name, description: draft.description, scope: draft.scope, memberIds: draft.memberIds,
      });
      setDraft(null);
      await refresh(false);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function removeGroup() {
    if (!user || !confirmDelete) return;
    setBusy(true); setError("");
    try {
      await callFunction(user, "deleteEducatorGroupHttps", {groupId: confirmDelete.rawGroupId || confirmDelete.id, scope: confirmDelete.scope});
      setConfirmDelete(null);
      await refresh(false);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
    {busy && <BrandedLoadingOverlay label={draft ? "Saving group" : "Refreshing roster"} />}
    <Link href={`/app/educator/bootcamps/${bootcamp}`} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>{bootcamp.toUpperCase()} home</Link>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[.2em] text-brand-green/65">Roster</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Students and Groups</h1><p className="mt-2 text-sm text-slate-600">Only students and groups authorized for your account appear here.</p></div><button onClick={() => refresh()} className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm hover:border-brand-green">Refresh</button></div>
    <div className="mt-7 grid grid-cols-2 rounded-2xl bg-white p-1 sm:max-w-md">{(["students", "groups"] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={`min-h-11 rounded-xl text-sm capitalize ${tab === value ? "bg-brand-green text-white" : "text-slate-500"}`}>{value} ({value === "students" ? data?.students.length || 0 : data?.groups.length || 0})</button>)}</div>
    <div className="mt-5 flex flex-wrap gap-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab}`} className="min-h-11 min-w-64 flex-1 rounded-2xl border border-slate-200 bg-white px-4 outline-none focus:border-brand-green" />{tab === "students" ? <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4"><option value="name">Name</option><option value="points">Points</option></select> : <><select value={groupScope} onChange={(event) => setGroupScope(event.target.value as typeof groupScope)} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4"><option value="all">All groups</option><option value="admin">School groups</option><option value="educator">My groups</option></select><button onClick={() => openGroup()} className="min-h-11 rounded-2xl bg-brand-green px-5 text-sm text-white">New group</button></>}</div>
    {error && <p role="alert" className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    {!data ? <div className="mt-6 h-72 animate-pulse rounded-3xl bg-white" /> : tab === "students" ? <div className="mt-6 space-y-3">{students.length ? students.map((student, index) => { const points = Number(student.totalPoints || 0); return <article key={student.id} className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-green/45 hover:shadow-md sm:gap-4 sm:px-5"><span className="w-7 shrink-0 text-center text-sm tabular-nums text-slate-400">{index + 1}</span><img src={`/app-assets/ranks/Rank${rankNumber(points)}.png`} alt="" className="h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16" /><div className="min-w-0"><h2 className="truncate text-base font-medium text-slate-950">{student.firstName} {student.lastName}</h2><p className="mt-1 truncate text-sm text-slate-500">{titleCase(student.currentRank)} · {points.toLocaleString()} points</p></div></article>; }) : <p className="rounded-3xl bg-white p-8 text-center text-sm text-slate-500">No students match this search.</p>}</div> : <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{groups.length ? groups.map((group) => { const editable = group.scope === "educator" || canAdmin; return <article key={group.id} className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-brand-green/60">{group.scope === "admin" ? "School group" : "My group"}</p><h2 className="mt-2 text-lg font-medium">{group.name}</h2></div><span className="rounded-full bg-brand-mist px-3 py-1 text-xs">{group.memberCount} students</span></div><p className="mt-3 min-h-10 text-sm text-slate-500">{group.description || "No description"}</p>{editable && <div className="mt-5 flex justify-end gap-3"><button onClick={() => openGroup(group)} className="min-h-10 min-w-24 rounded-xl border border-slate-300 px-5 text-sm transition hover:border-brand-green hover:bg-brand-mist">Edit</button><button onClick={() => setConfirmDelete(group)} className="min-h-10 min-w-24 rounded-xl border border-red-200 px-5 text-sm text-red-700 transition hover:bg-red-50">Delete</button></div>}</article>; }) : <p className="col-span-full rounded-3xl bg-white p-8 text-center text-sm text-slate-500">No groups match this filter.</p>}</div>}

    {draft && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4"><form onSubmit={saveGroup} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-wider text-brand-green/60">Group editor</p><h2 className="mt-2 text-2xl font-medium">{draft.group ? "Edit group" : "Create group"}</h2></div><button type="button" onClick={() => setDraft(null)} className="grid h-9 w-9 place-items-center rounded-full bg-brand-mist text-xl" aria-label="Close">×</button></div><label className="mt-5 block text-sm">Name<input required maxLength={100} value={draft.name} onChange={(event) => setDraft({...draft, name: event.target.value})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label><label className="mt-4 block text-sm">Description<textarea maxLength={240} value={draft.description} onChange={(event) => setDraft({...draft, description: event.target.value})} className="mt-2 min-h-24 w-full rounded-xl border border-slate-200 p-3" /></label><label className="mt-4 block text-sm">Group type<select value={draft.scope} disabled={!canAdmin && draft.scope === "admin"} onChange={(event) => setDraft({...draft, scope: event.target.value as GroupDraft["scope"]})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3"><option value="educator">My group</option>{canAdmin && <option value="admin">School group</option>}</select></label>
      <fieldset className="mt-5"><legend className="text-sm">Members ({draft.memberIds.length})</legend><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search students" className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-4 text-sm outline-none focus:border-brand-green" /><div className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200">{groupStudents.length ? groupStudents.map((student) => { const points = Number(student.totalPoints || 0); return <label key={student.id} className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-2 transition hover:bg-brand-mist"><input type="checkbox" checked={draft.memberIds.includes(student.id)} onChange={() => toggleMember(student.id)} className="h-4 w-4 shrink-0 accent-[#4B5320]" /><img src={`/app-assets/ranks/Rank${rankNumber(points)}.png`} alt="" className="h-11 w-11 shrink-0 object-contain" /><span className="min-w-0 truncate text-sm font-medium text-slate-950">{student.firstName} {student.lastName}</span></label>; }) : <p className="p-6 text-center text-sm text-slate-500">No students match this search.</p>}</div></fieldset><button type="submit" className="mt-6 min-h-12 w-full rounded-2xl bg-brand-green text-sm text-white">SAVE GROUP</button></form></div>}
    {confirmDelete && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-[2rem] bg-white p-6 text-center"><h2 className="text-xl font-medium">Delete {confirmDelete.name}?</h2><p className="mt-3 text-sm text-slate-600">This removes the group, not its students.</p><div className="mt-6 grid grid-cols-2 gap-3"><button onClick={() => setConfirmDelete(null)} className="min-h-11 rounded-xl border border-slate-300">CANCEL</button><button onClick={removeGroup} className="min-h-11 rounded-xl bg-red-700 text-white">DELETE</button></div></section></div>}
  </div>;
}
