"use client";

import Link from "next/link";
import {useRouter, useSearchParams} from "next/navigation";
import {FormEvent, useEffect, useMemo, useState} from "react";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import QuestionRichText from "@/components/app/QuestionRichText";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction} from "@/lib/api/client";
import {questionImageUrls} from "@/lib/drills/images";
import {questionText} from "@/lib/drills/text";
import type {DrillCatalog} from "@/lib/types/drill";

type BankQuestion = {
  id: string;
  subject: string;
  module: string;
  practiceTest: number;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  passage: string;
  imageSources: string[];
  groups?: string[];
  bookmarkedAt?: string;
};

type BookmarkResponse = {
  ok: true;
  datasetVersion: string;
  correctionRevision: number;
  bookmarks: BankQuestion[];
  unavailableCount: number;
};

type DraftForSelection = {
  drillId: string;
  title: string;
  instructions: string;
  dueAt: string;
  settings: {
    scorePolicy?: "immediate" | "on_due_date" | "manual";
    correctionPolicy?: "immediate" | "on_due_date" | "manual";
    shuffleQuestions?: boolean;
  };
  blueprint: null | {
    bootcamp: string;
    datasetVersion: string;
    correctionRevision: number;
    totalQuestions: number;
    subjects: Array<{
      subject: string;
      questionIds: string[];
      timeLimitMin: number;
      filters: {practiceYearCsv: string; modulesCsv: string};
    }>;
  };
};

type Config = {
  subject: string;
  modules: string[];
  practiceTests: number[];
  questionCount: number;
  shuffleQuestions: boolean;
};

type SelectionTarget = {
  subject: string;
  kind: "practiceTests" | "modules";
};

function mixedCase(value: string) {
  return String(value || "General")
    .toLowerCase()
    .replace(/(^|[\s/&-])\p{L}/gu, (letter) => letter.toUpperCase());
}

function referenceImages(bootcamp: string, sources: string[]) {
  return questionImageUrls(sources, bootcamp);
}

export default function EducatorQuestionLibrary({
  bootcamp,
  initialMode = "browse",
}: {
  bootcamp: string;
  initialMode?: "browse" | "bookmarks";
}) {
  const {user} = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnDrillId = searchParams.get("draftId") || "";
  const autoBrowse = searchParams.get("autobrowse") === "1" ||
    searchParams.get("setup") === "1";
  const startInSetup = autoBrowse;
  const requestedReturnPath = searchParams.get("returnTo") || "";
  const bootcampHomePath = `/app/educator/bootcamps/${bootcamp}`;
  const drillsPath = `${bootcampHomePath}/drills`;
  const standaloneReturnPath = requestedReturnPath === bootcampHomePath ||
    requestedReturnPath === drillsPath ? requestedReturnPath : bootcampHomePath;
  const drillConfigKey = user && returnDrillId ?
    `di.educatorDrillConfig.${user.uid}.${bootcamp}.${returnDrillId}` : "";
  const safeReturnPath = requestedReturnPath.startsWith(
    `/app/educator/bootcamps/${bootcamp}/drills/`,
  ) ? requestedReturnPath :
    `/app/educator/bootcamps/${bootcamp}/drills/${returnDrillId}/edit?stage=questions`;
  const configureReturnPath = returnDrillId ?
    `/app/educator/bootcamps/${bootcamp}/drills/${returnDrillId}/edit?stage=configure` :
    `/app/educator/bootcamps/${bootcamp}/browse`;
  const [catalog, setCatalog] = useState<DrillCatalog | null>(null);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [questionCache, setQuestionCache] =
    useState<Record<string, BankQuestion>>({});
  const [returnDraft, setReturnDraft] = useState<DraftForSelection | null>(null);
  const [datasetVersion, setDatasetVersion] = useState("");
  const [correctionRevision, setCorrectionRevision] = useState(0);
  const [bookmarkIds, setBookmarkIds] = useState<Record<string, boolean>>({});
  const [bookmarkGroups, setBookmarkGroups] = useState<Record<string, string[]>>({});
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [practiceTestFilter, setPracticeTestFilter] = useState("all");
  const [draftFilter, setDraftFilter] = useState<"all" | "in">("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [explanations, setExplanations] = useState<Record<string, boolean>>({});
  const [showModuleFilter, setShowModuleFilter] = useState(false);
  const [selectionTarget, setSelectionTarget] =
    useState<SelectionTarget | null>(null);
  const [selectionQuery, setSelectionQuery] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [reference, setReference] = useState<BankQuestion | null>(null);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [groupQuestion, setGroupQuestion] = useState<BankQuestion | null>(null);
  const [groupDraft, setGroupDraft] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [groupPendingDelete, setGroupPendingDelete] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [returnDraftLoaded, setReturnDraftLoaded] = useState(!returnDrillId);
  const [autoBrowseStarted, setAutoBrowseStarted] = useState(false);

  function rememberQuestions(rows: BankQuestion[]) {
    setQuestionCache((current) => ({
      ...current,
      ...Object.fromEntries(rows.map((question) => [question.id, question])),
    }));
  }

  useEffect(() => {
    if (!user) return;
    setBusy(true);
    Promise.all([
      callFunction<{ok: true; catalog: DrillCatalog; datasetVersion: string; correctionRevision: number}>(
        user,
        "getEducatorQuestionBankHttps",
        {bootcamp, limit: 1},
        {retryTransient: true},
      ),
      callFunction<BookmarkResponse>(
        user,
        "getEducatorBookmarksHttps",
        {bootcamp},
        {retryTransient: true},
      ),
    ])
      .then(([bank, saved]) => {
        setCatalog(bank.catalog);
        setDatasetVersion(bank.datasetVersion);
        setCorrectionRevision(bank.correctionRevision);
        setBookmarkIds(Object.fromEntries(saved.bookmarks.map((row) => [row.id, true])));
        setBookmarkGroups(Object.fromEntries(saved.bookmarks.map((row) => [row.id, row.groups || []])));
        setUnavailableCount(saved.unavailableCount || 0);
        if (initialMode === "browse" && drillConfigKey) {
          try {
            const stored = JSON.parse(
              sessionStorage.getItem(drillConfigKey) || "null",
            );
            if (Array.isArray(stored) && stored.length) {
              let remainingQuestions = 500;
              const configured = stored.flatMap((row) => {
                const info = bank.catalog.subjects.find(
                  (subject) => subject.name === String(row.subject || ""),
                );
                if (!info || remainingQuestions < 1) return [];
                const target = Math.max(1, Number(row.questionCount || 1));
                const questionCount = Math.min(
                  Number(info.questionCount || 300),
                  300,
                  target * 3,
                  remainingQuestions,
                );
                remainingQuestions -= questionCount;
                return [{
                  subject: info.name,
                  modules: Array.isArray(row.modules) ? row.modules : [],
                  practiceTests: Array.isArray(row.practiceTests) ?
                    row.practiceTests.map(Number).filter(Number.isFinite) : [],
                  questionCount,
                  shuffleQuestions: row.shuffleQuestions === true,
                }];
              });
              if (configured.length) setConfigs(configured);
            }
          } catch {
            // The normal blank library setup remains available.
          }
        }
        if (initialMode === "bookmarks") {
          setQuestions(saved.bookmarks);
          rememberQuestions(saved.bookmarks);
          setDatasetVersion(saved.datasetVersion || bank.datasetVersion);
          setCorrectionRevision(saved.correctionRevision ?? bank.correctionRevision);
        }
      })
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setBusy(false));
  }, [bootcamp, drillConfigKey, initialMode, user]);

  useEffect(() => {
    if (!user || initialMode !== "browse" || !returnDrillId) return;
    setBusy(true);
    callFunction<{ok: true; full: DraftForSelection}>(
      user,
      "getEducatorDrillDraftHttps",
      {bootcamp, drillId: returnDrillId},
      {retryTransient: true},
    ).then(async (response) => {
      const draft = response.full;
      setReturnDraft(draft);
      const questionIds = (draft.blueprint?.subjects || [])
        .flatMap((row) => row.questionIds || []);
      if (!questionIds.length) return;
      const bank = await callFunction<{
        ok: true;
        datasetVersion: string;
        correctionRevision: number;
        questions: BankQuestion[];
      }>(user, "getEducatorQuestionBankHttps", {
        bootcamp,
        questionIds,
        limit: 500,
      }, {retryTransient: true});
      const bankById = new Map(
        bank.questions.map((question) => [question.id, question]),
      );
      const hydrated = questionIds.flatMap((questionId) => {
        const question = bankById.get(questionId);
        return question ? [{
          ...question,
          groups: bookmarkGroups[question.id] || [],
        }] : [];
      });
      if (!startInSetup) setQuestions(hydrated);
      rememberQuestions(hydrated);
      setSelectedIds(Object.fromEntries(
        hydrated.map((question) => [question.id, true]),
      ));
      setDatasetVersion(bank.datasetVersion);
      setCorrectionRevision(bank.correctionRevision || 0);
    }).catch((reason) => setError((reason as Error).message))
      .finally(() => {
        setReturnDraftLoaded(true);
        setBusy(false);
      });
  // Bookmark groups are presentation metadata and do not need to restart
  // exact draft hydration when the bookmark request finishes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootcamp, initialMode, returnDrillId, startInSetup, user]);

  useEffect(() => {
    if (!autoBrowse || autoBrowseStarted || !returnDraftLoaded || busy ||
        initialMode !== "browse" || !catalog || !configs.length ||
        questions.length) return;
    setAutoBrowseStarted(true);
    void generateQuestions();
    // generateQuestions intentionally runs once from the inherited builder
    // configuration; subsequent browsing changes remain educator-controlled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBrowse, autoBrowseStarted, busy, catalog, configs.length,
    initialMode, questions.length, returnDraftLoaded]);

  const subjects = useMemo(
    () => [...new Set(questions.map((question) => question.subject))],
    [questions],
  );
  const practiceTests = useMemo(
    () => [...new Set(questions.map((question) => question.practiceTest))]
      .sort((a, b) => a - b),
    [questions],
  );
  const filterSubjects = useMemo(
    () => [...new Set(questions.filter((question) => {
      if (practiceTestFilter !== "all" &&
          question.practiceTest !== Number(practiceTestFilter)) return false;
      if (draftFilter === "in" && !selectedIds[question.id]) return false;
      return true;
    }).map((question) => question.subject))],
    [draftFilter, practiceTestFilter, questions, selectedIds],
  );
  const availableModules = useMemo(
    () => [...new Set(questions
      .filter((question) => subject === "all" || question.subject === subject)
      .filter((question) => practiceTestFilter === "all" ||
        question.practiceTest === Number(practiceTestFilter))
      .filter((question) => draftFilter === "all" ||
        selectedIds[question.id])
      .map((question) => question.module || "General"))].sort(),
    [draftFilter, practiceTestFilter, questions, selectedIds, subject],
  );
  const groups = useMemo(
    () => [...new Set(questions.flatMap((question) => question.groups || []))].sort(),
    [questions],
  );
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return questions.filter((question) => {
      if (subject !== "all" && question.subject !== subject) return false;
      if (selectedModules.length && !selectedModules.includes(question.module || "General")) return false;
      if (practiceTestFilter !== "all" && question.practiceTest !== Number(practiceTestFilter)) return false;
      if (draftFilter === "in" && !selectedIds[question.id]) return false;
      if (groupFilter !== "all" && !(question.groups || []).includes(groupFilter)) return false;
      if (!term) return true;
      return [
        question.prompt,
        question.subject,
        question.module,
        question.explanation,
        ...question.options,
      ].some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [draftFilter, groupFilter, practiceTestFilter, query, questions, selectedIds, selectedModules, subject]);
  const selectedQuestions = useMemo(
    () => Object.keys(selectedIds)
      .filter((questionId) => selectedIds[questionId] && questionCache[questionId])
      .map((questionId) => questionCache[questionId]),
    [questionCache, selectedIds],
  );
  const selectionConfig = selectionTarget ?
    configs.find((row) => row.subject === selectionTarget.subject) : null;
  const selectionInfo = selectionTarget ?
    catalog?.subjects.find((row) => row.name === selectionTarget.subject) :
    null;
  const selectionOptions: Array<string | number> = selectionTarget?.kind ===
    "practiceTests" ?
    (selectionInfo?.availablePracticeYears ||
      selectionInfo?.practiceYears || []) :
    (selectionInfo?.modules || []);
  const filteredSelectionOptions = selectionOptions.filter((option) =>
    String(option).toLowerCase().includes(selectionQuery.trim().toLowerCase()),
  );
  const allVisibleOptionsSelected = filteredSelectionOptions.length > 0 &&
    filteredSelectionOptions.every((option) => selectedOption(option));

  function toggleSubject(subjectName: string) {
    const current = configs.find((row) => row.subject === subjectName);
    if (current) {
      setConfigs((rows) => rows.filter((row) => row.subject !== subjectName));
      return;
    }
    const info = catalog?.subjects.find((row) => row.name === subjectName);
    if (!info) return;
    const practiceTests = info.availablePracticeYears ||
      info.practiceYears || [];
    setConfigs((rows) => [...rows, {
      subject: subjectName,
      modules: [...info.modules],
      practiceTests: [...practiceTests],
      questionCount: Math.min(20, Number(info.questionCount || 20)),
      shuffleQuestions: false,
    }]);
  }

  function patchConfig(subjectName: string, patch: Partial<Config>) {
    setConfigs((rows) => rows.map((row) => row.subject === subjectName ? {...row, ...patch} : row));
  }

  function openSelection(target: SelectionTarget) {
    setSelectionQuery("");
    setSelectionTarget(target);
  }

  function selectedOption(option: string | number) {
    if (!selectionConfig || !selectionTarget) return false;
    return selectionTarget.kind === "practiceTests" ?
      selectionConfig.practiceTests.includes(Number(option)) :
      selectionConfig.modules.includes(String(option));
  }

  function toggleSelectionOption(option: string | number) {
    if (!selectionConfig || !selectionTarget) return;
    if (selectionTarget.kind === "practiceTests") {
      const test = Number(option);
      const current = selectionConfig.practiceTests;
      patchConfig(selectionConfig.subject, {
        practiceTests: current.includes(test) ?
          current.filter((row) => row !== test) :
          [...current, test].sort((a, b) => a - b),
      });
      return;
    }
    const module = String(option);
    const current = selectionConfig.modules;
    patchConfig(selectionConfig.subject, {
      modules: current.includes(module) ?
        current.filter((row) => row !== module) : [...current, module],
    });
  }

  function toggleVisibleOptions() {
    if (!selectionConfig || !selectionTarget) return;
    if (selectionTarget.kind === "practiceTests") {
      const visible = filteredSelectionOptions.map(Number);
      patchConfig(selectionConfig.subject, {
        practiceTests: allVisibleOptionsSelected ?
          selectionConfig.practiceTests.filter((test) =>
            !visible.includes(test)) :
          [...new Set([...selectionConfig.practiceTests, ...visible])]
            .sort((a, b) => a - b),
      });
      return;
    }
    const visible = filteredSelectionOptions.map(String);
    patchConfig(selectionConfig.subject, {
      modules: allVisibleOptionsSelected ?
        selectionConfig.modules.filter((module) =>
          !visible.includes(module)) :
        [...new Set([...selectionConfig.modules, ...visible])],
    });
  }

  async function generateQuestions() {
    if (!user || !configs.length) return;
    const incomplete = configs.find((row) => {
      const info = catalog?.subjects.find((item) => item.name === row.subject);
      const tests = info?.availablePracticeYears || info?.practiceYears || [];
      return (tests.length > 0 && row.practiceTests.length === 0) ||
        ((info?.modules.length || 0) > 0 && row.modules.length === 0);
    });
    if (incomplete) {
      setError(`Choose at least one practice test and module for ${incomplete.subject}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await callFunction<{
        ok: true;
        blueprint: {datasetVersion: string; correctionRevision: number};
        preview: BankQuestion[];
      }>(user, "buildEducatorDrillBlueprintHttps", {
        bootcamp,
        subjects: configs.map((row) => ({...row, timeLimitMin: Math.max(1, row.questionCount)})),
      });
      const browsed = response.preview.map((question) => ({
        ...question,
        groups: bookmarkGroups[question.id] || [],
      }));
      setQuestions(returnDrillId ? [
        ...selectedQuestions.filter((selectedQuestion) =>
          !browsed.some((question) => question.id === selectedQuestion.id)),
        ...browsed,
      ] : browsed);
      rememberQuestions(browsed);
      setDatasetVersion(response.blueprint.datasetVersion);
      setCorrectionRevision(response.blueprint.correctionRevision || 0);
      if (!returnDrillId) setSelectedIds({});
      setQuery("");
      setSubject("all");
      setSelectedModules([]);
      setPracticeTestFilter("all");
      setDraftFilter("all");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleBookmark(question: BankQuestion) {
    if (!user) return;
    const bookmarked = !bookmarkIds[question.id];
    setBookmarkIds((value) => ({...value, [question.id]: bookmarked}));
    try {
      await callFunction(user, "setEducatorBookmarkHttps", {bootcamp, questionId: question.id, bookmarked});
      if (!bookmarked && initialMode === "bookmarks") {
        setQuestions((rows) => rows.filter((row) => row.id !== question.id));
        setSelectedIds((value) => {
          const next = {...value};
          delete next[question.id];
          return next;
        });
      }
      if (!bookmarked) {
        setBookmarkGroups((value) => {
          const next = {...value};
          delete next[question.id];
          return next;
        });
      }
    } catch (reason) {
      setBookmarkIds((value) => ({...value, [question.id]: !bookmarked}));
      setError((reason as Error).message);
    }
  }

  function openGroupEditor(question: BankQuestion) {
    setGroupQuestion(question);
    setGroupDraft(question.groups || []);
    setNewGroup("");
  }

  async function saveGroups() {
    if (!user || !groupQuestion) return;
    const pendingQuestion = groupQuestion;
    const added = newGroup.trim();
    const nextGroups = [...new Set([...groupDraft, ...(added ? [added] : [])])];
    setGroupQuestion(null);
    setSaving(true);
    try {
      await callFunction(user, "setEducatorBookmarkGroupsHttps", {
        bootcamp,
        questionId: pendingQuestion.id,
        groups: nextGroups,
      });
      setQuestions((rows) => rows.map((row) => row.id === pendingQuestion.id ? {...row, groups: nextGroups} : row));
      setBookmarkGroups((value) => ({...value, [pendingQuestion.id]: nextGroups}));
    } catch (reason) {
      setGroupQuestion(pendingQuestion);
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup() {
    if (!user || !groupPendingDelete) return;
    const deleted = groupPendingDelete;
    setGroupPendingDelete("");
    setSaving(true);
    try {
      await callFunction(user, "deleteEducatorBookmarkGroupHttps", {bootcamp, group: deleted});
      setQuestions((rows) => rows.map((row) => ({
        ...row,
        groups: (row.groups || []).filter((group) => group !== deleted),
      })));
      setBookmarkGroups((value) => Object.fromEntries(
        Object.entries(value).map(([questionId, questionGroups]) => [
          questionId,
          questionGroups.filter((group) => group !== deleted),
        ]),
      ));
      setGroupDraft((rows) => rows.filter((group) => group !== deleted));
      if (groupFilter === deleted) setGroupFilter("all");
    } catch (reason) {
      setGroupPendingDelete(deleted);
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft(event?: FormEvent) {
    event?.preventDefault();
    if (!user || !selectedQuestions.length ||
        (!returnDrillId && !draftName.trim())) return;
    if (!returnDrillId) setShowNameDialog(false);
    setSaving(true);
    const grouped = new Map<string, BankQuestion[]>();
    selectedQuestions.forEach((question) => grouped.set(
      question.subject,
      [...(grouped.get(question.subject) || []), question],
    ));
    try {
      const previousTimes = new Map(
        (returnDraft?.blueprint?.subjects || []).map((row) => [
          row.subject,
          Number(row.timeLimitMin || 0),
        ]),
      );
      await callFunction(user, "saveEducatorDrillDraftHttps", {
        drillId: returnDrillId || undefined,
        bootcamp,
        title: returnDraft?.title || draftName.trim(),
        instructions: returnDraft?.instructions || "",
        dueAt: returnDraft?.dueAt || "",
        settings: {
          scorePolicy: returnDraft?.settings.scorePolicy || "immediate",
          correctionPolicy: returnDraft?.settings.correctionPolicy || "manual",
          shuffleQuestions: returnDraft?.settings.shuffleQuestions !== false,
          shuffleOptions: false,
        },
        blueprint: {
          bootcamp,
          datasetVersion,
          correctionRevision,
          totalQuestions: selectedQuestions.length,
          subjects: [...grouped.entries()].map(([subjectName, rows]) => ({
            subject: subjectName,
            questionIds: rows.map((row) => row.id),
            timeLimitMin: previousTimes.get(subjectName) ||
              Math.max(1, rows.length),
            filters: {
              practiceYearCsv: [...new Set(rows.map((row) => row.practiceTest))].join(","),
              modulesCsv: [...new Set(rows.map((row) => row.module))].join(","),
            },
          })),
        },
      });
      router.push(returnDrillId ? safeReturnPath :
        `/app/educator/bootcamps/${bootcamp}/drills`);
    } catch (reason) {
      setError((reason as Error).message);
      setSaving(false);
      if (!returnDrillId) setShowNameDialog(true);
    }
  }

  if (busy) {
    return <BrandedLoadingOverlay label={initialMode === "bookmarks" ? "Loading educator bookmarks" : "Loading question catalog"} fixed={false} />;
  }

  if (autoBrowse && !autoBrowseStarted && !questions.length) {
    return <BrandedLoadingOverlay label="Preparing question bank" fixed={false} />;
  }

  if (initialMode === "browse" && !questions.length) {
    return <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
      <Link href={autoBrowse ? configureReturnPath : returnDrillId ? safeReturnPath : standaloneReturnPath} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>{autoBrowse ? "Back to configure" : returnDrillId ? "Return to drill" : standaloneReturnPath === drillsPath ? "Drills" : `${bootcamp.toUpperCase()} home`}</Link>
      <header className="mt-6"><p className="text-xs uppercase tracking-[.2em] text-brand-green/65">Question library</p><h1 className="mt-2 text-3xl font-semibold">Browse questions</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Choose subjects, practice tests, modules, and the maximum number of questions you want to inspect.</p></header>
      {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(catalog?.subjects || []).map((catalogSubject, subjectIndex) => {
          const active = configs.some((row) => row.subject === catalogSubject.name);
          return <button key={catalogSubject.name} type="button" onClick={() => toggleSubject(catalogSubject.name)} className={`relative min-h-40 overflow-hidden rounded-3xl border p-5 text-left transition ${active ? "border-brand-green bg-brand-green text-white shadow-soft" : "border-slate-200 bg-white hover:border-brand-green/35"}`}><span className={`absolute left-4 top-4 grid h-8 w-8 place-items-center rounded-full border text-lg ${active ? "border-white bg-white text-brand-green" : "border-brand-green/30 text-brand-green"}`}>{active ? "✓" : "+"}</span><p className={`mt-11 text-xs uppercase tracking-wider ${active ? "text-white/65" : "text-brand-green/60"}`}>Subject {subjectIndex + 1}</p><p className="mt-2 text-xl font-medium">{catalogSubject.name}</p><p className={`mt-2 text-sm ${active ? "text-white/70" : "text-slate-500"}`}>{catalogSubject.questionCount} questions · {catalogSubject.modules.length} modules</p></button>;
        })}
      </section>
      <section className="mt-6 space-y-4">{configs.map((config) => {
        const info = catalog?.subjects.find((row) => row.name === config.subject);
        const practiceTests = info?.availablePracticeYears ||
          info?.practiceYears || [];
        return <article key={config.subject} className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><p className="text-lg font-medium">{config.subject}</p><p className="mt-1 text-xs text-slate-500">Choose at least one practice test and module.</p></div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-3 text-sm text-slate-600">Maximum questions<input type="number" min={1} max={Math.min(300, Number(info?.questionCount || 300))} value={config.questionCount} onChange={(event) => patchConfig(config.subject, {questionCount: Math.max(1, Number(event.target.value || 1))})} className="h-11 w-20 rounded-xl border border-slate-200 px-3 text-center outline-none focus:border-brand-green" /></label>
              <div className="flex items-center gap-3">
                <span><span className="block text-sm text-slate-700">Randomize</span></span>
                <button type="button" role="switch" aria-label={`Randomize ${config.subject} questions`} aria-checked={config.shuffleQuestions} onClick={() => patchConfig(config.subject, {shuffleQuestions: !config.shuffleQuestions})} className={`relative h-8 w-14 rounded-full transition ${config.shuffleQuestions ? "bg-brand-green" : "bg-slate-300"}`}><span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${config.shuffleQuestions ? "left-7" : "left-1"}`} /></button>
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => openSelection({subject: config.subject, kind: "practiceTests"})} className="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-brand-mist/45 px-4 text-left transition hover:border-brand-green/40 hover:bg-brand-green/5">
              <span><span className="block text-xs font-medium uppercase tracking-wider text-brand-green/60">Practice tests</span><span className="mt-1 block text-sm text-slate-700">{config.practiceTests.length} of {practiceTests.length} selected</span></span>
              <span aria-hidden className="text-xl text-brand-green">›</span>
            </button>
            <button type="button" onClick={() => openSelection({subject: config.subject, kind: "modules"})} className="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-brand-mist/45 px-4 text-left transition hover:border-brand-green/40 hover:bg-brand-green/5">
              <span><span className="block text-xs font-medium uppercase tracking-wider text-brand-green/60">Modules</span><span className="mt-1 block text-sm text-slate-700">{config.modules.length} of {info?.modules.length || 0} selected</span></span>
              <span aria-hidden className="text-xl text-brand-green">›</span>
            </button>
          </div>
        </article>;
      })}</section>
      <button type="button" disabled={!configs.length} onClick={() => void generateQuestions()} className="mt-6 min-h-14 w-full rounded-2xl bg-brand-green px-6 text-sm text-white transition hover:bg-brand-green/90 disabled:bg-slate-300">BROWSE QUESTIONS</button>
      {selectionTarget && selectionConfig && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4">
        <section className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
            <div><p className="text-xs uppercase tracking-wider text-brand-green/60">{selectionTarget.subject}</p><h2 className="mt-1 text-xl font-medium">Select {selectionTarget.kind === "practiceTests" ? "practice tests" : "modules"}</h2><p className="mt-1 text-xs text-slate-500">Choose one or more options for this subject.</p></div>
            <button type="button" onClick={() => setSelectionTarget(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-mist text-xl" aria-label="Close selector">×</button>
          </header>
          <div className="border-b border-slate-100 p-4 sm:px-6">
            <input autoFocus type="search" value={selectionQuery} onChange={(event) => setSelectionQuery(event.target.value)} placeholder={`Search ${selectionTarget.kind === "practiceTests" ? "tests" : "modules"}`} className="min-h-11 w-full rounded-xl border border-slate-200 bg-brand-mist/40 px-4 text-sm outline-none focus:border-brand-green" />
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={toggleVisibleOptions} disabled={!filteredSelectionOptions.length} className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-40">{allVisibleOptionsSelected ? "UNSELECT ALL" : "SELECT ALL"}</button><span className="ml-auto self-center text-xs text-slate-400">{selectionTarget.kind === "practiceTests" ? selectionConfig.practiceTests.length : selectionConfig.modules.length} selected</span></div>
          </div>
          <div className={`min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 ${selectionTarget.kind === "practiceTests" ? "grid auto-rows-min grid-cols-2 gap-2 sm:grid-cols-3" : "space-y-2"}`}>
            {filteredSelectionOptions.map((option) => <label key={String(option)} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 bg-brand-mist/55 p-3 text-sm hover:border-brand-green/30"><input type="checkbox" checked={selectedOption(option)} onChange={() => toggleSelectionOption(option)} className="h-4 w-4 shrink-0 accent-brand-green" /><span className="min-w-0 break-words">{selectionTarget.kind === "practiceTests" ? `Test ${option}` : mixedCase(String(option))}</span></label>)}
            {!filteredSelectionOptions.length && <p className="col-span-full py-10 text-center text-sm text-slate-500">No matching options.</p>}
          </div>
          <footer className="border-t border-slate-100 p-4 sm:px-6"><button type="button" onClick={() => setSelectionTarget(null)} className="min-h-11 w-full rounded-xl bg-brand-green text-sm text-white">DONE</button></footer>
        </section>
      </div>}
    </main>;
  }

  return <main className="min-h-screen bg-brand-mist px-4 py-6 sm:px-6 lg:px-8">
    {saving && <BrandedLoadingOverlay label="Updating question library" />}
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {initialMode === "browse" ? autoBrowse ? <button type="button" onClick={() => router.push(configureReturnPath)} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>Back to configure</button> : <button type="button" onClick={() => setQuestions([])} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>Browse questions</button> : <Link href={`/app/educator/bootcamps/${bootcamp}`} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>{bootcamp.toUpperCase()} home</Link>}
        <button type="button" disabled={!selectedQuestions.length} onClick={() => returnDrillId ? void saveDraft() : setShowNameDialog(true)} className="min-h-11 rounded-2xl bg-brand-green px-5 text-sm text-white transition hover:bg-brand-green/90 disabled:bg-slate-300">{returnDrillId ? `DONE — RETURN TO DRILL (${selectedQuestions.length})` : `SAVE DRAFT (${selectedQuestions.length})`}</button>
      </div>
      <header className="mt-6"><p className="text-xs uppercase tracking-[.18em] text-brand-green/60">Question library</p><h1 className="mt-2 text-3xl font-semibold">{initialMode === "bookmarks" ? "Educator bookmarks" : "Browse questions"}</h1><p className="mt-2 text-sm text-slate-600">Search, filter, review explanations, and collect questions into a draft.</p></header>
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions, answers, or modules" className="min-h-12 w-full rounded-2xl border border-slate-200 bg-brand-mist/45 px-4 text-sm outline-none focus:border-brand-green" />
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
          <div className="flex shrink-0 rounded-xl bg-brand-mist p-1">
            <button type="button" onClick={() => {setDraftFilter("all"); setSelectedModules([]);}} className={`rounded-lg px-3 py-2 text-xs ${draftFilter === "all" ? "bg-brand-green text-white shadow-sm" : "text-slate-600"}`}>Question bank</button>
            <button type="button" onClick={() => {setDraftFilter("in"); setSelectedModules([]);}} className={`rounded-lg px-3 py-2 text-xs ${draftFilter === "in" ? "bg-brand-green text-white shadow-sm" : "text-slate-600"}`}>Selected</button>
          </div>
          <span className="h-7 w-px shrink-0 bg-slate-200" />
          {["all", ...filterSubjects].map((item) => <button key={item} type="button" onClick={() => {setSubject(item); setSelectedModules([]);}} className={`shrink-0 rounded-full px-3 py-2 text-xs ${subject === item ? "bg-brand-green text-white" : "bg-brand-mist text-slate-600"}`}>{item === "all" ? "All subjects" : item}</button>)}
        </div>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={() => setShowModuleFilter(true)} className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600">{selectedModules.length ? `Modules (${selectedModules.length})` : "All modules"}</button>
          <select aria-label="Filter by practice test" value={practiceTestFilter} onChange={(event) => {setPracticeTestFilter(event.target.value); setSelectedModules([]);}} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><option value="all">All practice tests</option>{practiceTests.map((test) => <option key={test} value={test}>Practice test {test}</option>)}</select>
          {groups.length > 0 && <select aria-label="Filter by bookmark group" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"><option value="all">All groups</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select>}
          <span className="ml-auto shrink-0 self-center pl-2 text-xs text-slate-400">{visible.length} shown</span>
        </div>
      </div>
      {unavailableCount > 0 && <p className="mt-4 rounded-2xl bg-brand-gold/15 p-3 text-xs text-slate-600">{unavailableCount} retired bookmark{unavailableCount === 1 ? " is" : "s are"} hidden.</p>}
      {error && <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <div className="mt-6 space-y-4">{visible.map((question) => {
        const questionIndex = questions.findIndex((row) => row.id === question.id) + 1;
        const explanationOpen = Boolean(explanations[question.id]);
        const images = referenceImages(bootcamp, question.imageSources);
        const hasReference = images.length > 0 || Boolean(question.passage);
        return <article id={`educator-question-${question.id}`} key={question.id} className="scroll-mt-5 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><button type="button" onClick={() => setShowMap(true)} className="text-sm text-brand-green underline decoration-1 underline-offset-4">Question {questionIndex} of {questions.length}</button><p className="mt-3 text-xs uppercase tracking-wider text-brand-green">{question.subject}</p><p className="mt-1 text-xs text-slate-500">{mixedCase(question.module)} · Practice test {question.practiceTest}</p>{Boolean(question.groups?.length) && <div className="mt-2 flex flex-wrap gap-1.5">{question.groups?.map((group) => <span key={group} className="rounded-full bg-brand-gold/20 px-2 py-1 text-[10px] text-brand-green">{group}</span>)}</div>}</div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSelectedIds((value) => ({...value, [question.id]: !value[question.id]}))} className={`min-h-10 rounded-xl border px-3 text-xs transition ${selectedIds[question.id] ? "border-brand-green bg-brand-green text-white" : "border-slate-200 text-slate-600 hover:border-brand-green"}`}>{selectedIds[question.id] ? "In draft" : "Add to draft"}</button>{bookmarkIds[question.id] && <button type="button" onClick={() => openGroupEditor(question)} className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs text-slate-600 hover:border-brand-green">Groups</button>}<button type="button" onClick={() => void toggleBookmark(question)} className={`grid h-10 w-10 place-items-center rounded-xl border text-lg ${bookmarkIds[question.id] ? "border-brand-gold bg-brand-gold/20 text-brand-green" : "border-slate-200 text-slate-500"}`} aria-label={bookmarkIds[question.id] ? "Remove bookmark" : "Bookmark question"}>{bookmarkIds[question.id] ? "★" : "☆"}</button></div></div>
          <p className="mt-5 whitespace-pre-wrap text-lg font-normal leading-8 text-slate-800">{questionText(question.prompt)}</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">{question.options.map((option, optionIndex) => <div key={optionIndex} className={`flex gap-3 rounded-xl border p-3 text-sm leading-6 ${explanationOpen && optionIndex === question.answerIndex ? "border-green-300 bg-green-50 text-green-900" : "border-slate-200 bg-brand-mist/45"}`}><span className="font-medium">{String.fromCharCode(65 + optionIndex)}</span><span className="whitespace-pre-wrap">{questionText(option)}</span></div>)}</div>
          {explanationOpen && <div className="mt-5 rounded-2xl bg-brand-gold/15 p-5"><p className="text-xs uppercase tracking-wider text-brand-green">Explanation</p><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{questionText(question.explanation) ? <QuestionRichText value={question.explanation} /> : "No explanation is available for this question."}</p></div>}
          <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => setExplanations((value) => ({...value, [question.id]: !value[question.id]}))} className="min-h-10 rounded-xl bg-brand-green px-4 text-xs text-white">{explanationOpen ? "Hide explanation" : "Show explanation"}</button>{hasReference && <button type="button" onClick={() => setReference(question)} className="min-h-10 rounded-xl border border-brand-green px-4 text-xs text-brand-green">View reference</button>}</div>
        </article>;
      })}</div>
      {!visible.length && <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="text-lg font-medium">No matching questions</p><p className="mt-2 text-sm text-slate-500">Adjust the search or filters.</p>{initialMode === "bookmarks" && !questions.length && <Link href={`/app/educator/bootcamps/${bootcamp}/browse`} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-brand-green px-4 text-sm text-white">BROWSE QUESTIONS</Link>}</div>}
    </div>

    {showModuleFilter && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-wider text-brand-green/60">{subject === "all" ? "All subjects" : subject}</p><h2 className="mt-1 text-xl font-medium">Filter modules</h2></div><button type="button" onClick={() => setShowModuleFilter(false)} className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl">×</button></div><button type="button" onClick={() => setSelectedModules([])} className="mt-5 w-full rounded-xl border border-slate-200 p-3 text-left text-sm">All modules</button><div className="mt-2 max-h-80 space-y-2 overflow-y-auto">{availableModules.map((module) => <label key={module} className="flex cursor-pointer items-center gap-3 rounded-xl bg-brand-mist p-3 text-sm"><input type="checkbox" checked={selectedModules.includes(module)} onChange={() => setSelectedModules((rows) => rows.includes(module) ? rows.filter((row) => row !== module) : [...rows, module])} className="h-4 w-4 accent-brand-green" />{mixedCase(module)}</label>)}</div><button type="button" onClick={() => setShowModuleFilter(false)} className="mt-5 min-h-11 w-full rounded-xl bg-brand-green text-sm text-white">APPLY</button></div></div>}

    {showMap && <div className="fixed inset-0 z-50 bg-black/35"><button type="button" className="absolute inset-0 h-full w-full" onClick={() => setShowMap(false)} aria-label="Close question navigator" /><aside className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-wider text-brand-green/60">Question navigator</p><h2 className="mt-1 text-xl font-medium">Jump to a question</h2></div><button type="button" onClick={() => setShowMap(false)} className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl">×</button></div><div className="mt-6 space-y-7">{subjects.map((subjectName) => <section key={subjectName}><div className="mb-3 flex items-center gap-3"><h3 className="text-sm font-medium">{subjectName}</h3><span className="h-px flex-1 bg-slate-200" /></div><div className="grid grid-cols-6 gap-2">{questions.map((question, questionIndex) => ({question, questionIndex})).filter((row) => row.question.subject === subjectName).map(({question, questionIndex}) => <button key={question.id} type="button" onClick={() => {document.getElementById(`educator-question-${question.id}`)?.scrollIntoView({behavior: "smooth", block: "start"}); setShowMap(false);}} className={`relative aspect-square rounded-xl border text-xs ${selectedIds[question.id] ? "border-brand-green bg-brand-green text-white" : "border-slate-200 bg-brand-mist text-slate-700"}`}>{questionIndex + 1}{bookmarkIds[question.id] && <span className="absolute -right-1 -top-1 text-[10px] text-brand-green">★</span>}</button>)}</div></section>)}</div></aside></div>}

    {reference && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[2rem] bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-xs uppercase tracking-wider text-brand-green/60">Reference</p><p className="mt-1 text-sm font-medium">{reference.subject} - {mixedCase(reference.module)}</p></div><button type="button" onClick={() => setReference(null)} className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl">×</button></div><div className="max-h-[calc(90vh-5rem)] space-y-5 overflow-y-auto p-5 sm:p-7">{referenceImages(bootcamp, reference.imageSources).map((image, imageIndex) => <img key={image} src={image} alt={`Question reference ${imageIndex + 1}`} className="mx-auto max-h-[62vh] max-w-full rounded-2xl object-contain" />)}{reference.passage && <div className="whitespace-pre-wrap rounded-2xl bg-brand-mist p-5 text-base leading-8 text-slate-700">{questionText(reference.passage)}</div>}</div></div></div>}

    {showNameDialog && <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4"><form onSubmit={saveDraft} className="w-full max-w-md rounded-[2rem] bg-white p-6"><p className="text-xs uppercase tracking-wider text-brand-green/60">Save selected questions</p><h2 className="mt-2 text-xl font-medium">Name this draft</h2><p className="mt-2 text-sm text-slate-500">Complete timing, instructions, due date, and release settings from the Draft inbox.</p><input autoFocus maxLength={120} value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Draft name" className="mt-5 min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-brand-green" /><div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={() => setShowNameDialog(false)} className="min-h-11 rounded-xl border border-slate-300">CANCEL</button><button type="submit" disabled={!draftName.trim()} className="min-h-11 rounded-xl bg-brand-green text-white disabled:bg-slate-300">SAVE DRAFT</button></div></form></div>}

    {groupQuestion && <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-medium">Organize bookmark</h2><p className="mt-1 text-sm text-slate-500">Add this question to one or more groups.</p><div className="mt-5 max-h-52 space-y-2 overflow-y-auto">{groups.map((group) => {const checked = groupDraft.includes(group); return <div key={group} className="flex items-center gap-3 rounded-xl bg-brand-mist p-3 text-sm"><label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"><input type="checkbox" checked={checked} onChange={() => setGroupDraft((rows) => checked ? rows.filter((row) => row !== group) : [...rows, group])} className="h-4 w-4 accent-brand-green" /><span className="truncate">{group}</span></label><button type="button" onClick={() => setGroupPendingDelete(group)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${group} group`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6" /></svg></button></div>;})}</div><input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} maxLength={40} placeholder="Create a new group" className="mt-4 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /><div className="mt-5 flex gap-3"><button type="button" onClick={() => setGroupQuestion(null)} className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm">CANCEL</button><button type="button" onClick={() => void saveGroups()} className="min-h-11 flex-1 rounded-xl bg-brand-green text-sm text-white">SAVE</button></div></div></div>}

    {groupPendingDelete && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4"><div className="w-full max-w-sm rounded-3xl bg-white p-6"><h2 className="text-xl font-medium">Delete group?</h2><p className="mt-2 text-sm leading-6 text-slate-500">“{groupPendingDelete}” will be removed from every educator bookmark in this bootcamp. The questions remain bookmarked.</p><div className="mt-6 flex gap-3"><button type="button" onClick={() => setGroupPendingDelete("")} className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm">CANCEL</button><button type="button" onClick={() => void deleteGroup()} className="min-h-11 flex-1 rounded-xl bg-red-600 text-sm text-white">DELETE GROUP</button></div></div></div>}
  </main>;
}
