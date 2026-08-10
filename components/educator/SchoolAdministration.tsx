"use client";

import {useEffect, useMemo, useState} from "react";
import {useAuth} from "@/components/app/AuthProvider";
import AppBackLink from "@/components/app/AppBackLink";
import {callFunction} from "@/lib/api/client";
import type {AdminAuditLog, AdminEducator, SchoolAdminSnapshot} from "@/lib/types/educator";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";

type AuditResponse = {ok: true; logs: AdminAuditLog[]; nextCursor: string | null};
type Access = NonNullable<AdminEducator["access"]>;
export default function SchoolAdministration() {
  const {user, educatorWorkspace} = useAuth();
  const [data, setData] = useState<SchoolAdminSnapshot | null>(null);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminEducator | null>(null);
  const [draft, setDraft] = useState<{status: string; adminAccess: boolean; access: Access} | null>(null);
  const [tab, setTab] = useState<"educators" | "audit">("educators");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!user) return;
    setError("");
    try {
      const [snapshot, audit] = await Promise.all([
        callFunction<SchoolAdminSnapshot>(user, "getSchoolAdminSnapshotHttps", {}, {retryTransient: true}),
        callFunction<AuditResponse>(user, "getSchoolAdminAuditLogsHttps", {limit: 30}, {retryTransient: true}),
      ]);
      setData(snapshot); setLogs(audit.logs); setNextCursor(audit.nextCursor);
    } catch (reason) { setError((reason as Error).message); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const educators = useMemo(() => (data?.educators || []).filter((row) => (filter === "all" || row.status === filter) && `${row.firstName} ${row.lastName} ${row.email}`.toLowerCase().includes(query.toLowerCase())), [data, filter, query]);
  const names = useMemo(() => Object.fromEntries((data?.educators || []).map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim() || row.email])), [data]);

  function edit(row: AdminEducator) {
    setSelected(row);
    setDraft({status: row.status, adminAccess: row.adminAccess, access: structuredClone(row.access || {})});
  }
  function toggleMap(section: "bootcamps" | "groups" | "students", key: string, checked: boolean) {
    if (!draft) return;
    const current = {...(draft.access[section] || {})};
    if (checked) current[key] = true; else delete current[key];
    setDraft({...draft, access: {...draft.access, [section]: current}});
  }
  function toggleSubject(bootcamp: string, subject: string, checked: boolean) {
    if (!draft) return;
    const byBootcamp = {...(draft.access.subjectsByBootcamp || {})};
    const current = {...(byBootcamp[bootcamp] || {})};
    if (checked) current[subject] = true; else delete current[subject];
    byBootcamp[bootcamp] = current;
    setDraft({...draft, access: {...draft.access, subjectsByBootcamp: byBootcamp}});
  }

  async function save() {
    if (!user || !selected || !draft) return;
    setBusy(true); setError("");
    try {
      await callFunction(user, "updateSchoolEducatorAccessHttps", {targetEducatorId: selected.id, status: draft.status, adminAccess: draft.adminAccess, access: draft.access});
      setSelected(null); setDraft(null); await load();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }
  async function moreLogs() {
    if (!user || !nextCursor) return;
    setBusy(true);
    try { const response = await callFunction<AuditResponse>(user, "getSchoolAdminAuditLogsHttps", {limit: 30, cursor: nextCursor}); setLogs((current) => [...current, ...response.logs]); setNextCursor(response.nextCursor); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  if (!data && !error) return <div className="mx-auto max-w-7xl px-6 py-10"><div className="h-96 animate-pulse rounded-[2rem] bg-white" /></div>;
  if (!educatorWorkspace?.caller.adminAccess && !educatorWorkspace?.caller.superAdmin) return <div className="p-10 text-center">Administration access is required.</div>;
  const plan = data?.plan;
  return <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
    <AppBackLink className="mb-5" />
    {busy && <BrandedLoadingOverlay label="Updating school administration" />}
    <p className="text-xs uppercase tracking-[.2em] text-brand-green/60">School-wide workspace</p><h1 className="mt-2 text-3xl font-semibold">Administration</h1><p className="mt-2 text-sm text-slate-600">Manage educator approval, access, and your school plan.</p>
    {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[["Plan", plan?.status || "--"], ["Educators", `${plan?.educatorSeatsUsed || 0}/${plan?.educatorSeatLimit || "∞"}`], ["Students", String(data?.students.length || 0)], ["Groups", String(data?.schoolGroups.length || 0)], ["Bootcamps", String(Object.values(plan?.bootcamps || {}).filter((row) => row.enabled).length)]].map(([label, value]) => <article key={label} className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-xs uppercase tracking-wider text-brand-green/60">{label}</p><p className="mt-3 text-2xl capitalize">{value}</p></article>)}</section>
    <div className="mt-7 flex gap-2"><button onClick={() => setTab("educators")} className={`rounded-xl px-4 py-2 text-sm ${tab === "educators" ? "bg-brand-green text-white" : "bg-white"}`}>Educators</button><button onClick={() => setTab("audit")} className={`rounded-xl px-4 py-2 text-sm ${tab === "audit" ? "bg-brand-green text-white" : "bg-white"}`}>Audit history</button></div>
    {tab === "educators" ? <section className="mt-5"><div className="flex gap-3"><select value={filter} onChange={(event) => setFilter(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3"><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search educators" className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4" /></div><div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white"><div className="hidden grid-cols-[1.5fr_repeat(3,1fr)_auto] gap-4 bg-brand-green px-5 py-3 text-xs uppercase text-white md:grid"><span>Educator</span><span>Status</span><span>Role</span><span>Students</span><span>Access</span></div>{educators.map((row) => <div key={row.id} className="grid gap-2 border-t border-slate-100 px-5 py-4 first:border-0 md:grid-cols-[1.5fr_repeat(3,1fr)_auto] md:items-center"><div><p className="text-sm">{row.firstName} {row.lastName}</p><p className="text-xs text-slate-500">{row.email}</p></div><span className="text-sm capitalize">{row.status}</span><span className="text-sm">{row.superAdmin ? "Super admin" : row.adminAccess ? "Admin" : "Educator"}</span><span className="text-sm">{row.studentCount || 0}</span><button onClick={() => edit(row)} className="min-h-9 rounded-xl border border-slate-300 px-3 text-sm">Manage</button></div>)}</div></section> : <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white">{logs.map((row) => <article key={row.id} className="border-t border-slate-100 p-5 first:border-0"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm">{names[row.actorEducatorId] || "School administrator"} updated {names[row.targetEducatorId] || "an educator"}</p><time className="text-xs text-slate-500">{row.createdAt ? new Date(row.createdAt).toLocaleString() : ""}</time></div><p className="mt-1 text-xs capitalize text-slate-500">{row.action.replaceAll(/([A-Z])/g, " $1")}</p></article>)}{nextCursor && <button onClick={() => void moreLogs()} className="min-h-12 w-full border-t border-slate-100 text-sm text-brand-green">LOAD MORE</button>}{!logs.length && <p className="p-8 text-center text-sm text-slate-500">No permission changes recorded yet.</p>}</section>}
    {selected && draft && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4"><section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] bg-white p-6"><div className="flex justify-between gap-4"><div><h2 className="text-2xl font-medium">{selected.firstName} {selected.lastName}</h2><p className="text-sm text-slate-500">{selected.email}</p></div><button onClick={() => setSelected(null)} className="h-9 w-9 rounded-full bg-brand-mist text-xl">×</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm">Approval<select value={draft.status} disabled={selected.id === data?.caller.educatorId} onChange={(event) => setDraft({...draft, status: event.target.value})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><label className="flex items-end gap-3 rounded-xl border border-slate-200 p-3 text-sm"><input type="checkbox" checked={draft.adminAccess} disabled={!data?.caller.superAdmin || selected.id === data.caller.educatorId || selected.superAdmin} onChange={(event) => setDraft({...draft, adminAccess: event.target.checked})} />School administrator</label></div><AccessSection title="Bootcamps" values={Object.keys(plan?.bootcamps || {}).filter((key) => plan?.bootcamps[key].enabled)} selected={draft.access.bootcamps || {}} onToggle={(key, checked) => toggleMap("bootcamps", key, checked)} />{Object.entries(data?.subjectCatalogByBootcamp || {}).map(([bootcamp, subjects]) => <AccessSection key={bootcamp} title={`${bootcamp.toUpperCase()} subjects`} values={subjects} selected={draft.access.subjectsByBootcamp?.[bootcamp] || {}} onToggle={(key, checked) => toggleSubject(bootcamp, key, checked)} />)}<AccessSection title="School groups" values={(data?.schoolGroups || []).map((row) => row.rawGroupId || row.id)} labels={Object.fromEntries((data?.schoolGroups || []).map((row) => [row.rawGroupId || row.id, row.name]))} selected={draft.access.groups || {}} onToggle={(key, checked) => toggleMap("groups", key, checked)} /><AccessSection title="Students" values={(data?.students || []).map((row) => row.id)} labels={Object.fromEntries((data?.students || []).map((row) => [row.id, `${row.firstName} ${row.lastName}`]))} selected={draft.access.students || {}} onToggle={(key, checked) => toggleMap("students", key, checked)} /><div className="mt-6 grid grid-cols-2 gap-3"><button onClick={() => setSelected(null)} className="min-h-12 rounded-xl border border-slate-300">CANCEL</button><button onClick={() => void save()} className="min-h-12 rounded-xl bg-brand-green text-white">SAVE ACCESS</button></div></section></div>}
  </div>;
}

function AccessSection({title, values, selected, labels = {}, onToggle}: {title: string; values: string[]; selected: Record<string, boolean>; labels?: Record<string, string>; onToggle: (key: string, checked: boolean) => void}) {
  return <fieldset className="mt-5 rounded-2xl bg-brand-mist p-4"><legend className="px-1 text-sm font-medium">{title}</legend><div className="mt-2 grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2"><label className="flex gap-2 text-sm"><input type="checkbox" checked={selected.all === true} onChange={(event) => onToggle("all", event.target.checked)} />All</label>{values.map((value) => <label key={value} className="flex gap-2 text-sm"><input type="checkbox" checked={selected[value] === true} disabled={selected.all === true} onChange={(event) => onToggle(value, event.target.checked)} />{labels[value] || value}</label>)}</div></fieldset>;
}
