"use client";

import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction} from "@/lib/api/client";
import {formatSchoolDate, formatSchoolDateTime} from "@/lib/dates/schoolTime";
import type {
  AdminAuditLog,
  AdminEducator,
  EducatorPlan,
  SchoolAdminSnapshot,
} from "@/lib/types/educator";

type AuditResponse = {ok: true; logs: AdminAuditLog[]; nextCursor: string | null};
type Access = NonNullable<AdminEducator["access"]>;
type EducatorStatus = AdminEducator["status"];
type Draft = {status: EducatorStatus; adminAccess: boolean; access: Access};
type Step = 1 | 2 | 3;
type AdminPanel = "school" | "plan" | "students" | "groups" | null;
type SchoolSettingsResponse = Pick<SchoolAdminSnapshot, "school" | "policies" | "syncedAt"> & {ok: true};

const statusCopy: Record<EducatorStatus, {title: string; detail: string; tone: string}> = {
  pending: {title: "Awaiting approval", detail: "Keep this request on hold while the school verifies it.", tone: "border-amber-200 bg-amber-50 text-amber-900"},
  approved: {title: "Approve educator", detail: "Grant access to the educator workspace using the permissions you select.", tone: "border-green-200 bg-green-50 text-green-900"},
  rejected: {title: "Remove access", detail: "Block the educator from entering this school's workspace.", tone: "border-red-200 bg-red-50 text-red-900"},
};

function enabledBootcamps(plan?: EducatorPlan) {
  return Object.keys(plan?.bootcamps || {}).filter((key) => plan?.bootcamps[key]?.enabled);
}

function recommendedAccess(data: SchoolAdminSnapshot): Access {
  const bootcamps: Record<string, boolean> = {};
  const subjectsByBootcamp: Record<string, Record<string, boolean>> = {};
  for (const bootcamp of enabledBootcamps(data.plan)) {
    bootcamps[bootcamp] = true;
    subjectsByBootcamp[bootcamp] = {all: true};
  }
  return {bootcamps, subjectsByBootcamp, students: {all: true}, groups: {all: true}, platoons: {}};
}

function selectedKeys(map?: Record<string, boolean>) {
  return Object.keys(map || {}).filter((key) => key !== "all" && map?.[key] === true);
}

function hasContentAccess(access: Access, data: SchoolAdminSnapshot) {
  return enabledBootcamps(data.plan).some((bootcamp) => {
    const hasBootcamp = access.bootcamps?.all === true || access.bootcamps?.[bootcamp] === true;
    const subjects = access.subjectsByBootcamp?.[bootcamp] || {};
    return hasBootcamp && (subjects.all === true || selectedKeys(subjects).length > 0);
  });
}

function accessSummary(access: Access, data: SchoolAdminSnapshot) {
  const bootcamps = enabledBootcamps(data.plan).filter((key) => access.bootcamps?.all === true || access.bootcamps?.[key] === true);
  const subjectCount = bootcamps.reduce((total, key) => {
    const map = access.subjectsByBootcamp?.[key] || {};
    return total + (map.all === true ? (data.subjectCatalogByBootcamp[key] || []).length : selectedKeys(map).length);
  }, 0);
  const students = access.students?.all === true ? "All students" : `${selectedKeys(access.students).length} students`;
  const groups = access.groups?.all === true ? "All groups" : `${selectedKeys(access.groups).length} groups`;
  return {bootcamps, subjectCount, students, groups};
}

function statusLabel(status: EducatorStatus) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Access removed";
  return "Pending";
}

function availableTimezones(current?: string) {
  const fallback = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Africa/Lagos", "Africa/Accra", "Africa/Johannesburg", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "UTC"];
  const enhancedIntl = Intl as typeof Intl & {supportedValuesOf?: (key: "timeZone") => string[]};
  return Array.from(new Set([current || "", ...(enhancedIntl.supportedValuesOf?.("timeZone") || fallback)])).filter(Boolean);
}

function administrationBackTarget(returnTo?: string) {
  const value = String(returnTo || "");
  const match = value.match(/^\/app\/educator\/bootcamps\/([^/]+)$/);
  if (match) return {href: value, label: `${match[1].toUpperCase()} overview`};
  return {href: "/app/educator/bootcamps", label: "Bootcamps"};
}

export default function SchoolAdministration({returnTo}: {returnTo?: string}) {
  const {user, educatorWorkspace} = useAuth();
  const backTarget = administrationBackTarget(returnTo);
  const [data, setData] = useState<SchoolAdminSnapshot | null>(null);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminEducator | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [tab, setTab] = useState<"educators" | "audit">("educators");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [panel, setPanel] = useState<AdminPanel>(null);
  const [panelQuery, setPanelQuery] = useState("");
  const [settingsDraft, setSettingsDraft] = useState({timezone: "America/New_York", educatorRegistrationOpen: false, studentEnrollmentOpen: true});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!user) return;
    setError("");
    const cacheKey = `di.educator.admin:${user.uid}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null") as
        {snapshot: SchoolAdminSnapshot; audit: AuditResponse} | null;
      if (cached?.snapshot && cached?.audit) {
        setData(cached.snapshot);
        setLogs(cached.audit.logs || []);
        setNextCursor(cached.audit.nextCursor || null);
      }
    } catch { /* optional browser cache */ }
    try {
      const [snapshot, audit] = await Promise.all([
        callFunction<SchoolAdminSnapshot>(user, "getSchoolAdminSnapshotHttps", {}, {retryTransient: true}),
        callFunction<AuditResponse>(user, "getSchoolAdminAuditLogsHttps", {limit: 30}, {retryTransient: true}),
      ]);
      setData(snapshot);
      setLogs(audit.logs);
      setNextCursor(audit.nextCursor);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({snapshot, audit})); } catch { /* optional browser cache */ }
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const educators = useMemo(() => (data?.educators || []).filter((row) => {
    const matchesStatus = filter === "all" || row.status === filter;
    const text = `${row.firstName} ${row.lastName} ${row.email}`.toLowerCase();
    return matchesStatus && text.includes(query.trim().toLowerCase());
  }), [data, filter, query]);
  const names = useMemo(() => Object.fromEntries((data?.educators || []).map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim() || row.email])), [data]);
  const pendingCount = (data?.educators || []).filter((row) => row.status === "pending").length;

  function openEducator(row: AdminEducator) {
    if (!data) return;
    const existing = structuredClone(row.access || {}) as Access;
    const shouldRecommend = row.status === "pending" && !hasContentAccess(existing, data);
    setSelected(row);
    setDraft({status: row.status, adminAccess: row.adminAccess, access: shouldRecommend ? recommendedAccess(data) : existing});
    setStep(1);
    setStudentQuery("");
    setGroupQuery("");
  }

  function setStatus(status: EducatorStatus) {
    if (!draft || !data) return;
    const firstApproval = selected?.status !== "approved" && status === "approved";
    setDraft({...draft, status, access: firstApproval && !hasContentAccess(draft.access, data) ? recommendedAccess(data) : draft.access});
  }

  function applyRecommended() {
    if (!draft || !data) return;
    const fullAccess = recommendedAccess(data);
    setDraft({...draft, access: {
      ...draft.access,
      bootcamps: fullAccess.bootcamps,
      subjectsByBootcamp: fullAccess.subjectsByBootcamp,
    }});
  }

  function toggleBootcamp(bootcamp: string, checked: boolean) {
    if (!draft) return;
    const bootcamps = {...(draft.access.bootcamps || {})};
    const subjectsByBootcamp = {...(draft.access.subjectsByBootcamp || {})};
    delete bootcamps.all;
    if (checked) {
      bootcamps[bootcamp] = true;
      if (!subjectsByBootcamp[bootcamp] || selectedKeys(subjectsByBootcamp[bootcamp]).length === 0) subjectsByBootcamp[bootcamp] = {all: true};
    } else {
      delete bootcamps[bootcamp];
      delete subjectsByBootcamp[bootcamp];
    }
    setDraft({...draft, access: {...draft.access, bootcamps, subjectsByBootcamp}});
  }

  function toggleSubject(bootcamp: string, subject: string, checked: boolean) {
    if (!draft) return;
    const subjectsByBootcamp = {...(draft.access.subjectsByBootcamp || {})};
    const current = {...(subjectsByBootcamp[bootcamp] || {})};
    if (subject === "all") {
      subjectsByBootcamp[bootcamp] = checked ? {all: true} : {};
    } else {
      delete current.all;
      if (checked) current[subject] = true; else delete current[subject];
      subjectsByBootcamp[bootcamp] = current;
    }
    setDraft({...draft, access: {...draft.access, subjectsByBootcamp}});
  }

  function setScope(section: "students" | "groups", all: boolean) {
    if (!draft) return;
    setDraft({...draft, access: {...draft.access, [section]: all ? {all: true} : {}}});
  }

  function togglePerson(section: "students" | "groups", key: string, checked: boolean) {
    if (!draft) return;
    const current = {...(draft.access[section] || {})};
    delete current.all;
    if (checked) current[key] = true; else delete current[key];
    setDraft({...draft, access: {...draft.access, [section]: current}});
  }

  async function save() {
    if (!user || !selected || !draft || !data) return;
    if (draft.status === "approved" && !hasContentAccess(draft.access, data)) {
      setError("Choose at least one exam and one subject before approving this educator.");
      setStep(2);
      return;
    }
    const pendingSelected = selected;
    const pendingDraft = draft;
    setSelected(null);
    setDraft(null);
    setBusy(true);
    setError("");
    try {
      await callFunction(user, "updateSchoolEducatorAccessHttps", {
        targetEducatorId: pendingSelected.id,
        status: pendingDraft.status,
        adminAccess: pendingDraft.adminAccess,
        access: pendingDraft.access,
        accessMode: "custom",
      });
      await load();
    } catch (reason) {
      setSelected(pendingSelected);
      setDraft(pendingDraft);
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function moreLogs() {
    if (!user || !nextCursor) return;
    setBusy(true);
    try {
      const response = await callFunction<AuditResponse>(user, "getSchoolAdminAuditLogsHttps", {limit: 30, cursor: nextCursor});
      setLogs((current) => [...current, ...response.logs]);
      setNextCursor(response.nextCursor);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openPanel(nextPanel: Exclude<AdminPanel, null>) {
    if (!data) return;
    setPanelQuery("");
    setSettingsDraft({
      timezone: data.school.timezone || "America/New_York",
      educatorRegistrationOpen: data.policies?.educatorRegistrationOpen === true,
      studentEnrollmentOpen: data.policies?.studentEnrollmentOpen !== false,
    });
    setPanel(nextPanel);
  }

  async function saveSchoolSettings() {
    if (!user || !data?.caller.superAdmin) return;
    const returnPanel = panel;
    setPanel(null);
    setBusy(true);
    setError("");
    try {
      const response = await callFunction<SchoolSettingsResponse>(user, "updateSchoolSettingsHttps", settingsDraft);
      setData((current) => current ? {...current, school: response.school, policies: response.policies, syncedAt: response.syncedAt} : current);
      try { sessionStorage.removeItem(`di.educator.admin:${user.uid}`); } catch { /* optional browser cache */ }
      await load();
    } catch (reason) {
      setPanel(returnPanel);
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <div className="mx-auto max-w-7xl px-6 py-10"><div className="h-96 animate-pulse rounded-[2rem] bg-white" /></div>;
  if (!educatorWorkspace?.caller.adminAccess && !educatorWorkspace?.caller.superAdmin) return <div className="p-10 text-center">Administration access is required.</div>;

  const plan = data?.plan;
  const approvedCount = (data?.educators || []).filter((row) => row.status === "approved").length;
  return <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
    <Link href={backTarget.href} className="group mb-5 inline-flex min-h-10 items-center gap-2 text-sm text-slate-700 transition hover:text-brand-green">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white shadow-sm transition group-hover:bg-brand-mist">
        <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
      </span>
      {backTarget.label}
    </Link>
    {busy && <BrandedLoadingOverlay label="Updating school administration" />}
    <p className="text-xs uppercase tracking-[.2em] text-brand-green/60">School-wide workspace</p>
    <h1 className="mt-2 text-3xl font-semibold">Administration</h1>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Manage educator approval and access to exams, subjects, students, and groups.</p>
    {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <AdminCard label="School overview" value={data?.school.name || "School"} detail={data?.policies?.studentEnrollmentOpen === false || data?.policies?.educatorRegistrationOpen === false ? "Registration restricted" : `${data?.school.state || ""}, ${data?.school.country || ""}`} onClick={() => openPanel("school")} tone={data?.policies?.studentEnrollmentOpen === false || data?.policies?.educatorRegistrationOpen === false ? "amber" : "default"} />
      <AdminCard label="Plan" value={plan?.status || "--"} detail={`${enabledBootcamps(plan).length} active ${enabledBootcamps(plan).length === 1 ? "exam" : "exams"}`} onClick={() => openPanel("plan")} />
      <AdminCard label="Educators" value={String(approvedCount)} detail={`${plan?.educatorSeatsUsed || approvedCount}/${plan?.educatorSeatLimit || "Unlimited"} seats used`} onClick={() => { setFilter("approved"); setTab("educators"); document.getElementById("educator-directory")?.scrollIntoView({behavior: "smooth"}); }} />
      <AdminCard label="Students" value={String(data?.students.length || 0)} detail="View the school roster" onClick={() => openPanel("students")} />
      <AdminCard label="Groups" value={String(data?.schoolGroups.length || 0)} detail="View school-managed groups" onClick={() => openPanel("groups")} />
    </section>

    {pendingCount > 0 && <button type="button" onClick={() => { setFilter("pending"); setTab("educators"); }} className="mt-6 flex w-full items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left transition hover:border-amber-300">
      <span><span className="block text-sm font-medium text-amber-950">{pendingCount} educator {pendingCount === 1 ? "request needs" : "requests need"} review</span><span className="mt-1 block text-xs text-amber-800">Review the request and choose the educator's school access.</span></span><span className="text-sm text-amber-900">REVIEW</span>
    </button>}

    <div id="educator-directory" className="mt-7 flex scroll-mt-6 gap-2">
      <button onClick={() => setTab("educators")} className={`rounded-xl px-4 py-2 text-sm transition ${tab === "educators" ? "bg-brand-green text-white" : "bg-white hover:bg-brand-mist"}`}>Educators</button>
      <button onClick={() => setTab("audit")} className={`rounded-xl px-4 py-2 text-sm transition ${tab === "audit" ? "bg-brand-green text-white" : "bg-white hover:bg-brand-mist"}`}>Audit history</button>
    </div>

    {tab === "educators" ? <section className="mt-5">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <select value={filter} onChange={(event) => setFilter(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3"><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Access removed</option></select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search educators" className="min-h-11 rounded-xl border border-slate-200 bg-white px-4" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {educators.map((row) => {
          const summary = data ? accessSummary(row.access || {}, data) : null;
          const incomplete = row.status === "approved" && data && !hasContentAccess(row.access || {}, data) && !row.adminAccess && !row.superAdmin;
          return <article key={row.id} className={`rounded-3xl border bg-white p-5 ${incomplete ? "border-amber-300" : "border-slate-200"}`}>
            <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-lg font-medium text-slate-950">{row.firstName} {row.lastName}</p><p className="mt-1 truncate text-xs text-slate-500">{row.email}</p></div><StatusPill status={row.status} /></div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600"><span className="rounded-full bg-brand-mist px-3 py-1.5">{row.superAdmin ? "Super admin" : row.adminAccess ? "Administrator" : "Educator"}</span><span className="rounded-full bg-brand-mist px-3 py-1.5">{summary?.bootcamps.length || 0} exams</span><span className="rounded-full bg-brand-mist px-3 py-1.5">{summary?.subjectCount || 0} subjects</span><span className="rounded-full bg-brand-mist px-3 py-1.5">{row.studentCount || 0} visible students</span></div>
            {incomplete && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Exam and subject access is required before this educator can use the workspace.</p>}
            <button type="button" onClick={() => openEducator(row)} className="mt-5 min-h-11 w-full rounded-xl border border-brand-green text-sm text-brand-green transition hover:bg-brand-mist">{row.status === "pending" ? "REVIEW REQUEST" : "MANAGE ACCESS"}</button>
          </article>;
        })}
      </div>
      {!educators.length && <p className="mt-4 rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No educators match this view.</p>}
    </section> : <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white">
      {logs.map((row) => <article key={row.id} className="border-t border-slate-100 p-5 first:border-0"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm">{names[row.actorEducatorId] || "School administrator"} updated {row.action === "updateSchoolSettings" ? "school settings" : names[row.targetEducatorId] || "an educator"}</p><time className="text-xs text-slate-500">{row.createdAt ? formatSchoolDateTime(row.createdAt, educatorWorkspace?.school) : ""}</time></div><p className="mt-1 text-xs capitalize text-slate-500">{row.action.replaceAll(/([A-Z])/g, " $1")}</p></article>)}
      {nextCursor && <button onClick={() => void moreLogs()} className="min-h-12 w-full border-t border-slate-100 text-sm text-brand-green">LOAD MORE</button>}
      {!logs.length && <p className="p-8 text-center text-sm text-slate-500">No permission changes recorded yet.</p>}
    </section>}

    {selected && draft && data && <AccessWizard
      data={data}
      selected={selected}
      draft={draft}
      step={step}
      setStep={setStep}
      setDraft={setDraft}
      setStatus={setStatus}
      applyRecommended={applyRecommended}
      toggleBootcamp={toggleBootcamp}
      toggleSubject={toggleSubject}
      setScope={setScope}
      togglePerson={togglePerson}
      studentQuery={studentQuery}
      setStudentQuery={setStudentQuery}
      groupQuery={groupQuery}
      setGroupQuery={setGroupQuery}
      onClose={() => { setSelected(null); setDraft(null); setError(""); }}
      onSave={() => void save()}
    />}
    {panel && data && <AdministrationPanel
      panel={panel}
      data={data}
      query={panelQuery}
      setQuery={setPanelQuery}
      settings={settingsDraft}
      setSettings={setSettingsDraft}
      onClose={() => setPanel(null)}
      onSave={() => void saveSchoolSettings()}
    />}
  </div>;
}

function AdminCard({label, value, detail, onClick, tone = "default"}: {label: string; value: string; detail: string; onClick: () => void; tone?: "default" | "green" | "amber"}) {
  const toneClass = tone === "amber" ? "border-amber-200 bg-amber-50" : tone === "green" ? "border-green-200 bg-green-50/60" : "border-slate-200 bg-white";
  return <button type="button" onClick={onClick} className={`min-h-36 rounded-3xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-green/45 hover:shadow-md ${toneClass}`}><span className="block text-xs uppercase tracking-wider text-brand-green/60">{label}</span><span className="mt-3 block truncate text-2xl capitalize text-slate-950">{value}</span><span className="mt-2 block text-xs leading-5 text-slate-500">{detail}</span></button>;
}

function AdministrationPanel({panel, data, query, setQuery, settings, setSettings, onClose, onSave}: {
  panel: Exclude<AdminPanel, null>;
  data: SchoolAdminSnapshot;
  query: string;
  setQuery: (value: string) => void;
  settings: {timezone: string; educatorRegistrationOpen: boolean; studentEnrollmentOpen: boolean};
  setSettings: (value: {timezone: string; educatorRegistrationOpen: boolean; studentEnrollmentOpen: boolean}) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const isSuperAdmin = data.caller.superAdmin;
  const students = data.students.filter((row) => `${row.firstName} ${row.lastName} ${row.currentRank}`.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) => `${left.lastName} ${left.firstName}`.localeCompare(`${right.lastName} ${right.firstName}`));
  const groups = data.schoolGroups.filter((row) => `${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const titles = {school: "School overview", plan: "School plan", students: "Students", groups: "School groups"};
  const canSave = panel === "school" && isSuperAdmin;
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="admin-panel-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
    <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7"><div><p className="text-xs uppercase tracking-[.18em] text-brand-green/60">Administration</p><h2 id="admin-panel-title" className="mt-1 text-2xl font-medium">{titles[panel]}</h2></div><button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl transition hover:bg-slate-200">×</button></header>
    <div className="overflow-y-auto px-5 py-6 sm:px-7">
      {panel === "school" && <div className="space-y-4"><ReadOnlyField label="School name" value={data.school.name} /><div className="grid gap-4 sm:grid-cols-2"><ReadOnlyField label="State" value={data.school.state} /><ReadOnlyField label="Country" value={data.school.country} /></div><label className="block"><span className="text-xs uppercase tracking-wider text-slate-500">Timezone</span><select disabled={!isSuperAdmin} value={settings.timezone} onChange={(event) => setSettings({...settings, timezone: event.target.value})} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 disabled:bg-brand-mist disabled:text-slate-500">{availableTimezones(settings.timezone).map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</select></label><div className="border-t border-slate-100 pt-5"><h3 className="text-lg font-medium">Registration permissions</h3><p className="mt-1 text-xs leading-5 text-slate-500">Control whether new students and educators can join this school.</p><div className="mt-4 space-y-3"><PolicyToggle disabled={!isSuperAdmin} checked={settings.educatorRegistrationOpen} onChange={(checked) => setSettings({...settings, educatorRegistrationOpen: checked})} title="Allow educator registration" detail="New educators may register using this school's ID. Existing educator accounts are not affected when this is turned off." /><PolicyToggle disabled={!isSuperAdmin} checked={settings.studentEnrollmentOpen} onChange={(checked) => setSettings({...settings, studentEnrollmentOpen: checked})} title="Allow students to join this school" detail="The school appears during unit selection and may appear in school rankings. Existing student memberships remain active when this is turned off." /></div></div>{!isSuperAdmin && <p className="rounded-xl bg-brand-mist p-3 text-xs leading-5 text-slate-600">Only a super administrator can change the timezone or registration permissions. School identity is view only.</p>}</div>}
      {panel === "plan" && <PlanPanel data={data} />}
      {(panel === "students" || panel === "groups") && <div><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${panel}`} className="min-h-12 w-full rounded-xl border border-slate-200 px-4" /><div className="mt-4 space-y-2">
        {panel === "students" && students.map((student, index) => <article key={student.id} className="flex items-center gap-4 rounded-2xl bg-brand-mist p-4"><span className="w-7 shrink-0 text-center text-xs text-slate-400">{index + 1}</span><div className="min-w-0"><p className="truncate text-sm text-slate-950">{student.lastName}, {student.firstName}</p><p className="mt-1 text-xs capitalize text-slate-500">{student.currentRank.toLowerCase()}</p></div></article>)}
        {panel === "groups" && groups.map((group) => <article key={group.rawGroupId || group.id} className="rounded-2xl bg-brand-mist p-4"><div className="flex items-center justify-between gap-4"><p className="truncate text-sm text-slate-950">{group.name}</p><span className="shrink-0 text-xs text-slate-500">{group.memberCount} {group.memberCount === 1 ? "student" : "students"}</span></div>{group.description && <p className="mt-1 text-xs text-slate-500">{group.description}</p>}</article>)}
        {((panel === "students" && !students.length) || (panel === "groups" && !groups.length)) && <p className="rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">No {panel} match your search.</p>}
      </div></div>}
    </div>
    <footer className={`grid gap-3 border-t border-slate-100 px-5 py-4 sm:px-7 ${canSave ? "grid-cols-2" : "grid-cols-1"}`}><button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-slate-300 text-sm transition hover:bg-brand-mist">CLOSE</button>{canSave && <button type="button" onClick={onSave} className="min-h-12 rounded-xl bg-brand-green text-sm text-white transition hover:bg-brand-darkolive">SAVE CHANGES</button>}</footer>
  </section></div>;
}

function ReadOnlyField({label, value}: {label: string; value: string}) {
  return <div><p className="text-xs uppercase tracking-wider text-slate-500">{label}</p><p className="mt-2 min-h-12 rounded-xl bg-brand-mist px-4 py-3 text-sm text-slate-800">{value || "Not set"}</p></div>;
}

function PolicyToggle({checked, disabled, onChange, title, detail}: {checked: boolean; disabled: boolean; onChange: (checked: boolean) => void; title: string; detail: string}) {
  return <label className={`flex items-start justify-between gap-5 rounded-2xl border p-4 sm:p-5 ${checked ? "border-green-200 bg-green-50/60" : "border-amber-200 bg-amber-50"} ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}><span><span className="block text-sm text-slate-950">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{detail}</span></span><input type="checkbox" role="switch" disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#4B5320]" /></label>;
}

function PlanPanel({data}: {data: SchoolAdminSnapshot}) {
  const bootcamps = Object.entries(data.plan.bootcamps || {});
  return <div className="space-y-3">{bootcamps.map(([bootcamp, entry]) => <article key={bootcamp} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-4"><p className="text-base uppercase text-slate-950">{bootcamp}</p><span className={`rounded-full px-3 py-1 text-xs ${entry.enabled ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}>{entry.enabled ? "Enabled" : "Disabled"}</span></div><div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2"><p>Active: {formatSchoolDate(entry.startAt, data.school)}</p><p>Expires: {formatSchoolDate(entry.endAt, data.school)}</p></div></article>)}{!bootcamps.length && <p className="rounded-2xl bg-brand-mist p-6 text-center text-sm text-slate-500">No exams are included in this plan.</p>}</div>;
}

function StatusPill({status}: {status: EducatorStatus}) {
  const classes = status === "approved" ? "bg-green-50 text-green-800" : status === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800";
  return <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${classes}`}>{statusLabel(status)}</span>;
}

function AccessWizard({data, selected, draft, step, setStep, setDraft, setStatus, applyRecommended, toggleBootcamp, toggleSubject, setScope, togglePerson, studentQuery, setStudentQuery, groupQuery, setGroupQuery, onClose, onSave}: {
  data: SchoolAdminSnapshot;
  selected: AdminEducator;
  draft: Draft;
  step: Step;
  setStep: (step: Step) => void;
  setDraft: (draft: Draft) => void;
  setStatus: (status: EducatorStatus) => void;
  applyRecommended: () => void;
  toggleBootcamp: (bootcamp: string, checked: boolean) => void;
  toggleSubject: (bootcamp: string, subject: string, checked: boolean) => void;
  setScope: (section: "students" | "groups", all: boolean) => void;
  togglePerson: (section: "students" | "groups", key: string, checked: boolean) => void;
  studentQuery: string;
  setStudentQuery: (value: string) => void;
  groupQuery: string;
  setGroupQuery: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const summary = accessSummary(draft.access, data);
  const targetIsSelf = selected.id === data.caller.educatorId;
  const canChangeAdmin = data.caller.superAdmin && !targetIsSelf && !selected.superAdmin;
  const activeBootcamps = enabledBootcamps(data.plan);
  const visibleStudents = data.students.filter((row) => `${row.firstName} ${row.lastName}`.toLowerCase().includes(studentQuery.toLowerCase()));
  const visibleGroups = data.schoolGroups.filter((row) => row.name.toLowerCase().includes(groupQuery.toLowerCase()));
  const canOpenStep = (target: Step) => target === 1 || draft.status === "approved";

  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5">
    <section role="dialog" aria-modal="true" aria-labelledby="access-title" className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
      <header className="border-b border-slate-100 px-5 py-5 sm:px-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-brand-green/60">Educator access</p><h2 id="access-title" className="mt-1 text-2xl font-medium">{selected.firstName} {selected.lastName}</h2><p className="mt-1 text-sm text-slate-500">{selected.email}</p></div><button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl transition hover:bg-slate-200">×</button></div>
        <nav aria-label="Access setup" className="mt-5 grid grid-cols-3 gap-2">
          {([{id: 1, label: "Status"}, {id: 2, label: "Exams & subjects"}, {id: 3, label: "Students & groups"}] as {id: Step; label: string}[]).map((item) => <button key={item.id} type="button" disabled={!canOpenStep(item.id)} onClick={() => canOpenStep(item.id) && setStep(item.id)} className={`rounded-xl px-2 py-3 text-xs transition sm:text-sm ${step === item.id ? "bg-brand-green text-white" : "bg-brand-mist text-slate-600 hover:bg-slate-200 disabled:opacity-40"}`}><span className="mr-1 opacity-70">{item.id}.</span>{item.label}</button>)}
        </nav>
      </header>

      <div className="overflow-y-auto px-5 py-6 sm:px-7">
        {step === 1 && <div>
          <h3 className="text-xl font-medium">Choose account status</h3><p className="mt-2 text-sm leading-6 text-slate-500">Choose whether this educator can enter the school workspace. Approved educators also require exam, subject, and roster access.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">{(["approved", "pending", "rejected"] as EducatorStatus[]).map((status) => <button key={status} type="button" disabled={targetIsSelf} onClick={() => setStatus(status)} className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${draft.status === status ? statusCopy[status].tone : "border-slate-200 hover:border-brand-green/40"}`}><span className="block text-sm font-medium">{statusCopy[status].title}</span><span className="mt-2 block text-xs leading-5 opacity-80">{statusCopy[status].detail}</span></button>)}</div>
          <label className={`mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 p-4 ${!canChangeAdmin ? "opacity-60" : ""}`}><input type="checkbox" checked={draft.adminAccess} disabled={!canChangeAdmin} onChange={(event) => setDraft({...draft, adminAccess: event.target.checked})} className="mt-0.5 h-4 w-4 accent-[#4B5320]" /><span><span className="block text-sm font-medium">School administrator</span><span className="mt-1 block text-xs leading-5 text-slate-500">Administrators can manage school-wide educators and automatically have access to the school workspace. Only a super administrator can change this role.</span></span></label>
          {draft.status === "rejected" && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm leading-6 text-red-800">Saving will remove this educator's school workspace access. Their historical school records are not deleted.</p>}
        </div>}

        {step === 2 && <div>
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-xl font-medium">Exams and subjects</h3><p className="mt-2 text-sm leading-6 text-slate-500">Choose the exam workspaces and subjects this educator may access.</p></div><button type="button" onClick={applyRecommended} className="min-h-10 rounded-xl border border-brand-green px-4 text-xs text-brand-green transition hover:bg-brand-mist">SELECT ALL EXAMS & SUBJECTS</button></div>
          <div className="mt-5 space-y-4">{activeBootcamps.map((bootcamp) => {
            const checked = draft.access.bootcamps?.all === true || draft.access.bootcamps?.[bootcamp] === true;
            const subjects = data.subjectCatalogByBootcamp[bootcamp] || [];
            const subjectMap = draft.access.subjectsByBootcamp?.[bootcamp] || {};
            return <article key={bootcamp} className={`rounded-2xl border p-4 transition ${checked ? "border-brand-green/40 bg-brand-mist/70" : "border-slate-200"}`}>
              <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={checked} onChange={(event) => toggleBootcamp(bootcamp, event.target.checked)} className="h-4 w-4 accent-[#4B5320]" /><span><span className="block text-base font-medium uppercase">{bootcamp}</span><span className="block text-xs text-slate-500">{subjects.length} available subjects</span></span></label>
              {checked && <div className="mt-4 border-t border-brand-green/10 pt-4"><label className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs"><input type="checkbox" checked={subjectMap.all === true} onChange={(event) => toggleSubject(bootcamp, "all", event.target.checked)} className="accent-[#4B5320]" />All subjects</label><div className="mt-3 flex flex-wrap gap-2">{subjects.map((subject) => <label key={subject} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs ${subjectMap.all === true || subjectMap[subject] === true ? "border-brand-green bg-white text-brand-green" : "border-slate-200 bg-white text-slate-600"}`}><input type="checkbox" checked={subjectMap.all === true || subjectMap[subject] === true} disabled={subjectMap.all === true} onChange={(event) => toggleSubject(bootcamp, subject, event.target.checked)} className="accent-[#4B5320]" />{subject}</label>)}</div></div>}
            </article>;
          })}</div>
          {!hasContentAccess(draft.access, data) && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Choose at least one exam and one subject.</p>}
        </div>}

        {step === 3 && <div>
          <h3 className="text-xl font-medium">Students and groups</h3><p className="mt-2 text-sm leading-6 text-slate-500">Choose the students and school groups this educator may access.</p>
          <ScopePanel title="Students" detail="Students who allow school learning access" all={draft.access.students?.all === true} allLabel={`All eligible students (${data.students.length})`} onScope={(all) => setScope("students", all)} query={studentQuery} setQuery={setStudentQuery}>
            {visibleStudents.map((student) => <ChoiceRow key={student.id} checked={draft.access.students?.[student.id] === true} onChange={(checked) => togglePerson("students", student.id, checked)} title={`${student.lastName}, ${student.firstName}`} detail={student.platoonName || undefined} />)}
          </ScopePanel>
          <ScopePanel title="School groups" detail="Groups this educator can use when assigning work" all={draft.access.groups?.all === true} allLabel={`All school groups (${data.schoolGroups.length})`} onScope={(all) => setScope("groups", all)} query={groupQuery} setQuery={setGroupQuery}>
            {visibleGroups.map((group) => <ChoiceRow key={group.rawGroupId || group.id} checked={draft.access.groups?.[group.rawGroupId || group.id] === true} onChange={(checked) => togglePerson("groups", group.rawGroupId || group.id, checked)} title={group.name} detail={`${group.memberCount} ${group.memberCount === 1 ? "student" : "students"}`} />)}
          </ScopePanel>
          <section className="mt-5 rounded-2xl bg-brand-green p-5 text-white"><p className="text-xs uppercase tracking-[.16em] text-brand-gold">Access summary</p><p className="mt-3 text-lg">{summary.bootcamps.map((item) => item.toUpperCase()).join(", ") || "No exams"} · {summary.subjectCount} subjects</p><p className="mt-2 text-sm text-white/75">{summary.students} · {summary.groups} · {draft.adminAccess ? "Administrator" : "Educator"}</p></section>
        </div>}
      </div>

      <footer className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:px-7">
        <button type="button" onClick={() => step === 1 ? onClose() : setStep((step - 1) as Step)} className="min-h-12 rounded-xl border border-slate-300 text-sm transition hover:bg-brand-mist">{step === 1 ? "CANCEL" : "BACK"}</button>
        {draft.status === "approved" && step < 3 ? <button type="button" disabled={step === 2 && !hasContentAccess(draft.access, data)} onClick={() => setStep((step + 1) as Step)} className="min-h-12 rounded-xl bg-brand-green text-sm text-white transition hover:bg-brand-darkolive disabled:opacity-40">CONTINUE</button> : <button type="button" onClick={onSave} className={`min-h-12 rounded-xl text-sm text-white transition ${draft.status === "rejected" ? "bg-red-700 hover:bg-red-800" : "bg-brand-green hover:bg-brand-darkolive"}`}>{selected.status === "pending" && draft.status === "approved" ? "APPROVE EDUCATOR" : draft.status === "rejected" ? "REMOVE ACCESS" : "SAVE CHANGES"}</button>}
      </footer>
    </section>
  </div>;
}

function ScopePanel({title, detail, all, allLabel, onScope, query, setQuery, children}: {title: string; detail: string; all: boolean; allLabel: string; onScope: (all: boolean) => void; query: string; setQuery: (value: string) => void; children: React.ReactNode}) {
  return <section className="mt-5 rounded-2xl border border-slate-200 p-4"><div><h4 className="font-medium">{title}</h4><p className="mt-1 text-xs text-slate-500">{detail}</p></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => onScope(true)} className={`rounded-xl border p-3 text-left text-sm ${all ? "border-brand-green bg-brand-mist text-brand-green" : "border-slate-200"}`}>{allLabel}</button><button type="button" onClick={() => onScope(false)} className={`rounded-xl border p-3 text-left text-sm ${!all ? "border-brand-green bg-brand-mist text-brand-green" : "border-slate-200"}`}>Selected only</button></div>{!all && <div className="mt-4"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} className="min-h-10 w-full rounded-xl border border-slate-200 px-3 text-sm" /><div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{children}</div></div>}</section>;
}

function ChoiceRow({checked, onChange, title, detail}: {checked: boolean; onChange: (checked: boolean) => void; title: string; detail?: string}) {
  return <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-brand-mist p-3"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#4B5320]" /><span className="min-w-0"><span className="block truncate text-sm text-slate-900">{title}</span>{detail && <span className="mt-0.5 block truncate text-xs text-slate-500">{detail}</span>}</span></label>;
}
