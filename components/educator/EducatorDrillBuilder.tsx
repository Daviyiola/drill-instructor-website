"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { callFunction } from "@/lib/api/client";
import { isFutureLocalDateTime, minimumFutureLocalDateTime } from "@/lib/dates/futureDueDate";
import { questionImageUrls } from "@/lib/drills/images";
import { questionText } from "@/lib/drills/text";
import type { DrillCatalog } from "@/lib/types/drill";
import type {
  EducatorGroup,
  EducatorRosterResponse,
} from "@/lib/types/educator";
import { useAuth } from "@/components/app/AuthProvider";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import QuestionRichText from "@/components/app/QuestionRichText";

type Policy = "immediate" | "on_due_date" | "manual";
type SubjectConfig = {
  subject: string;
  modules: string[];
  practiceTests: number[];
  questionCount: number;
  timeLimitMin: number;
};
type ConfigSelectionTarget = {
  subject: string;
  kind: "practiceTests" | "modules";
};
type Blueprint = {
  bootcamp: string;
  datasetVersion: string;
  correctionRevision: number;
  subjects: Array<{
    subject: string;
    questionIds: string[];
    timeLimitMin: number;
    filters: { practiceYearCsv: string; modulesCsv: string };
  }>;
  totalQuestions: number;
};
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
};
type BankResponse = {
  ok: true;
  datasetVersion: string;
  correctionRevision: number;
  catalog: DrillCatalog;
  questions: BankQuestion[];
  nextCursor: string | null;
  totalMatching: number;
};
type DraftResponse = {
  ok: true;
  full: {
    drillId: string;
    title: string;
    instructions: string;
    dueAt: string;
    settings: {
      scorePolicy?: Policy;
      correctionPolicy?: Policy;
      shuffleQuestions?: boolean;
    };
    blueprint: Blueprint | null;
  };
};

function localDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function policyLabel(policy: Policy) {
  if (policy === "immediate") return "Immediately";
  if (policy === "on_due_date") return "On due date";
  return "Manual";
}

function normalizeCatalog(value: DrillCatalog): DrillCatalog {
  return {
    ...value,
    subjects: (value?.subjects || []).map((subject) => ({
      ...subject,
      modules: Array.isArray(subject.modules) ? subject.modules : [],
      practiceYears: Array.isArray(subject.practiceYears)
        ? subject.practiceYears
        : [],
      availablePracticeYears: Array.isArray(subject.availablePracticeYears)
        ? subject.availablePracticeYears
        : Array.isArray(subject.practiceYears)
          ? subject.practiceYears
          : [],
    })),
  };
}

function subjectArtwork(subject: string) {
  const normalized = subject.toLowerCase();
  if (normalized.includes("math")) {
    return "/app-assets/drills/Mathematics.png";
  }
  if (
    normalized.includes("science") ||
    normalized.includes("biology") ||
    normalized.includes("chemistry") ||
    normalized.includes("physics")
  ) {
    return "/app-assets/drills/Biology.png";
  }
  return "/app-assets/drills/English.png";
}

function PracticeTestRange({
  availableYears,
  selectedYears,
  onChange,
}: {
  availableYears: number[];
  selectedYears: number[];
  onChange: (years: number[]) => void;
}) {
  const years = [...availableYears].sort((a, b) => a - b);
  if (!years.length) {
    return (
      <p className="text-xs text-slate-500">No practice tests available.</p>
    );
  }
  const selected = selectedYears.length ? selectedYears : years;
  const firstSelected = Math.min(...selected);
  const lastSelected = Math.max(...selected);
  const lowIndex = Math.max(0, years.indexOf(firstSelected));
  const highIndex = Math.max(lowIndex, years.indexOf(lastSelected));
  const denominator = Math.max(1, years.length - 1);
  const lowPct = (lowIndex / denominator) * 100;
  const highPct = (highIndex / denominator) * 100;

  function setRange(nextLow: number, nextHigh: number) {
    onChange(years.slice(nextLow, nextHigh + 1));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-600">Practice tests</p>
        <p className="text-xs font-medium text-brand-green">
          {years[lowIndex] === years[highIndex]
            ? `Test ${years[lowIndex]}`
            : `Tests ${years[lowIndex]}–${years[highIndex]}`}
        </p>
      </div>
      <div className="relative mt-3 h-8">
        <div className="absolute inset-x-1 top-3 h-2 rounded-full bg-white" />
        <div
          className="absolute top-3 h-2 rounded-full bg-brand-green"
          style={{ left: `${lowPct}%`, right: `${100 - highPct}%` }}
        />
        <input
          type="range"
          min={0}
          max={years.length - 1}
          value={lowIndex}
          onChange={(event) =>
            setRange(Math.min(Number(event.target.value), highIndex), highIndex)
          }
          aria-label="First practice test"
          className="di-range absolute inset-0 w-full"
        />
        <input
          type="range"
          min={0}
          max={years.length - 1}
          value={highIndex}
          onChange={(event) =>
            setRange(lowIndex, Math.max(Number(event.target.value), lowIndex))
          }
          aria-label="Last practice test"
          className="di-range absolute inset-0 w-full"
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>{years[0]}</span>
        <span>{years[years.length - 1]}</span>
      </div>
    </div>
  );
}

export default function EducatorDrillBuilder({
  bootcamp,
  drillId = "",
}: {
  bootcamp: string;
  drillId?: string;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStage = searchParams.get("stage");
  const [stage, setStage] = useState(
    requestedStage === "assign" ? 4 :
      requestedStage === "questions" ? 3 :
        requestedStage === "configure" ? 2 : 1,
  );
  const [savedDrillId, setSavedDrillId] = useState(drillId);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [minimumDueAt, setMinimumDueAt] = useState("");
  const [scorePolicy, setScorePolicy] = useState<Policy>("immediate");
  const [correctionPolicy, setCorrectionPolicy] = useState<Policy>("manual");
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [catalog, setCatalog] = useState<DrillCatalog | null>(null);
  const [configs, setConfigs] = useState<SubjectConfig[]>([]);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [questionFlow, setQuestionFlow] = useState<"choice" | "auto">("choice");
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [preview, setPreview] = useState<BankQuestion[]>([]);
  const [previewQuestion, setPreviewQuestion] = useState<BankQuestion | null>(
    null,
  );
  const [bank, setBank] = useState<BankQuestion[]>([]);
  const [bankCursor, setBankCursor] = useState<string | null>(null);
  const [bankSubject, setBankSubject] = useState("");
  const [bankModule, setBankModule] = useState("");
  const [bankTest, setBankTest] = useState(0);
  const [selected, setSelected] = useState<Record<string, BankQuestion>>({});
  const [bankCorrectionRevision, setBankCorrectionRevision] = useState(0);
  const [roster, setRoster] = useState<EducatorRosterResponse | null>(null);
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [groupKeys, setGroupKeys] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientPicker, setRecipientPicker] =
    useState<"students" | "groups" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [publishResult, setPublishResult] = useState("");
  const [confirmAssignment, setConfirmAssignment] = useState(false);

  useEffect(() => setMinimumDueAt(minimumFutureLocalDateTime()), []);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [configSelectionTarget, setConfigSelectionTarget] =
    useState<ConfigSelectionTarget | null>(null);
  const [configSelectionQuery, setConfigSelectionQuery] = useState("");
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState("");

  const localDraftKey = user
    ? `di.educatorDrillBuilder.${user.uid}.${bootcamp}.${drillId || "new"}`
    : "";
  const questionConfigKey = (id: string) =>
    user ? `di.educatorDrillConfig.${user.uid}.${bootcamp}.${id}` : "";

  useEffect(() => {
    if (!user || drillId) {
      setDraftHydrated(true);
      return;
    }
    try {
      const stored = JSON.parse(localStorage.getItem(localDraftKey) || "null");
      if (stored && typeof stored === "object") {
        setTitle(String(stored.title || ""));
        setInstructions(String(stored.instructions || ""));
        setDueAt(String(stored.dueAt || ""));
        if (
          ["immediate", "on_due_date", "manual"].includes(stored.scorePolicy)
        ) {
          setScorePolicy(stored.scorePolicy);
        }
        if (
          ["immediate", "on_due_date", "manual"].includes(
            stored.correctionPolicy,
          )
        ) {
          setCorrectionPolicy(stored.correctionPolicy);
        }
        setShuffleQuestions(stored.shuffleQuestions !== false);
        setConfigs(Array.isArray(stored.configs) ? stored.configs : []);
        setMode(stored.mode === "manual" ? "manual" : "auto");
        if (
          searchParams.get("stage") !== "assign" &&
          Number(stored.stage) >= 1 &&
          Number(stored.stage) <= 3
        ) {
          setStage(Number(stored.stage));
        }
        setAutosaveStatus("Draft restored");
      }
    } catch {
      localStorage.removeItem(localDraftKey);
    }
    setDraftHydrated(true);
  }, [drillId, localDraftKey, searchParams, user]);

  useEffect(() => {
    if (!user || !draftHydrated || drillId) return;
    setAutosaveStatus("Saving…");
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        localDraftKey,
        JSON.stringify({
          title,
          instructions,
          dueAt,
          scorePolicy,
          correctionPolicy,
          shuffleQuestions,
          configs,
          mode,
          stage: Math.min(stage, 3),
          updatedAt: new Date().toISOString(),
        }),
      );
      setAutosaveStatus("Saved on this device");
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    configs,
    correctionPolicy,
    draftHydrated,
    drillId,
    dueAt,
    instructions,
    localDraftKey,
    mode,
    scorePolicy,
    shuffleQuestions,
    stage,
    title,
    user,
  ]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      callFunction<BankResponse>(
        user,
        "getEducatorQuestionBankHttps",
        { bootcamp, limit: 1 },
        { retryTransient: true },
      ),
      callFunction<EducatorRosterResponse>(
        user,
        "getEducatorRosterHttps",
        { bootcamp },
        { retryTransient: true },
      ),
      ...(drillId
        ? [
            callFunction<DraftResponse>(
              user,
              "getEducatorDrillDraftHttps",
              { bootcamp, drillId },
              { retryTransient: true },
            ),
          ]
        : []),
    ])
      .then(async ([bankInfo, rosterInfo, existing]) => {
        const nextCatalog = normalizeCatalog(bankInfo.catalog);
        setCatalog(nextCatalog);
        setBankCorrectionRevision(bankInfo.correctionRevision);
        setRoster(rosterInfo);
        if (existing) {
          setTitle(existing.full.title);
          setInstructions(existing.full.instructions);
          setDueAt(localDate(existing.full.dueAt));
          setScorePolicy(existing.full.settings.scorePolicy || "immediate");
          setCorrectionPolicy(
            existing.full.settings.correctionPolicy || "manual",
          );
          setShuffleQuestions(
            existing.full.settings.shuffleQuestions !== false,
          );
          if (existing.full.blueprint) {
            setBlueprint(existing.full.blueprint);
            const blueprintConfigs = existing.full.blueprint.subjects.map(
              (row) => ({
                subject: row.subject,
                modules: row.filters.modulesCsv.split(",").filter(Boolean),
                practiceTests: row.filters.practiceYearCsv
                  .split(",")
                  .map(Number)
                  .filter(Boolean),
                questionCount: row.questionIds.length,
                timeLimitMin: row.timeLimitMin,
              }),
            );
            let restoredConfigs = blueprintConfigs;
            try {
              const storedConfig = JSON.parse(
                sessionStorage.getItem(questionConfigKey(drillId)) || "null",
              );
              if (Array.isArray(storedConfig) && storedConfig.length) {
                restoredConfigs = storedConfig;
              }
            } catch {
              // The exact blueprint remains a safe fallback.
            }
            setConfigs(restoredConfigs);
            const questionIds = existing.full.blueprint.subjects
              .flatMap((row) => row.questionIds || []);
            if (questionIds.length) {
              const hydrated = await callFunction<BankResponse>(
                user,
                "getEducatorQuestionBankHttps",
                {bootcamp, questionIds, limit: 500},
                {retryTransient: true},
              );
              const hydratedById = new Map(
                hydrated.questions.map((question) => [question.id, question]),
              );
              const exactQuestions = questionIds
                .map((questionId) => hydratedById.get(questionId))
                .filter((question): question is BankQuestion => Boolean(question));
              setPreview(exactQuestions);
              setSelected(Object.fromEntries(
                exactQuestions.map((question) => [question.id, question]),
              ));
            }
          }
        }
      })
      .catch((reason) => setError((reason as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootcamp, drillId, user]);

  const currentCatalog = (subject: string) =>
    catalog?.subjects.find((row) => row.name === subject);
  const configSelectionConfig = configSelectionTarget
    ? configs.find((row) => row.subject === configSelectionTarget.subject)
    : null;
  const configSelectionInfo = configSelectionTarget
    ? currentCatalog(configSelectionTarget.subject)
    : null;
  const configSelectionOptions: Array<string | number> =
    configSelectionTarget?.kind === "practiceTests"
      ? configSelectionInfo?.availablePracticeYears || []
      : configSelectionInfo?.modules || [];
  const filteredConfigSelectionOptions = configSelectionOptions.filter(
    (option) =>
      String(option)
        .toLowerCase()
        .includes(configSelectionQuery.trim().toLowerCase()),
  );
  const allVisibleConfigOptionsSelected =
    filteredConfigSelectionOptions.length > 0 &&
    filteredConfigSelectionOptions.every((option) =>
      isConfigOptionSelected(option),
    );
  const totalQuestions =
    blueprint?.totalQuestions ||
    Object.keys(selected).length ||
    configs.reduce((sum, row) => sum + row.questionCount, 0);
  const totalTime = configs.reduce((sum, row) => sum + row.timeLimitMin, 0);
  const visibleStudents = useMemo(
    () =>
      (roster?.students || []).filter((row) =>
        `${row.firstName} ${row.lastName}`
          .toLowerCase()
          .includes(recipientSearch.toLowerCase()),
      ),
    [recipientSearch, roster],
  );
  const visibleGroups = useMemo(
    () =>
      (roster?.groups || []).filter((row) =>
        row.name.toLowerCase().includes(recipientSearch.toLowerCase()),
      ),
    [recipientSearch, roster],
  );

  function openRecipientPicker(kind: "students" | "groups") {
    setRecipientSearch("");
    setRecipientPicker(kind);
  }

  function updateConfig(index: number, patch: Partial<SubjectConfig>) {
    setConfigs((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    setBlueprint(null);
  }
  function openConfigSelection(target: ConfigSelectionTarget) {
    setConfigSelectionQuery("");
    setConfigSelectionTarget(target);
  }
  function isConfigOptionSelected(option: string | number) {
    if (!configSelectionConfig || !configSelectionTarget) return false;
    return configSelectionTarget.kind === "practiceTests"
      ? configSelectionConfig.practiceTests.includes(Number(option))
      : configSelectionConfig.modules.includes(String(option));
  }
  function toggleConfigOption(option: string | number) {
    if (!configSelectionConfig || !configSelectionTarget) return;
    const index = configs.findIndex(
      (row) => row.subject === configSelectionConfig.subject,
    );
    if (index < 0) return;
    if (configSelectionTarget.kind === "practiceTests") {
      const value = Number(option);
      const current = configSelectionConfig.practiceTests;
      updateConfig(index, {
        practiceTests: current.includes(value)
          ? current.filter((row) => row !== value)
          : [...current, value].sort((a, b) => a - b),
      });
      return;
    }
    const value = String(option);
    const current = configSelectionConfig.modules;
    updateConfig(index, {
      modules: current.includes(value)
        ? current.filter((row) => row !== value)
        : [...current, value],
    });
  }
  function toggleAllVisibleConfigOptions() {
    if (!configSelectionConfig || !configSelectionTarget) return;
    const index = configs.findIndex(
      (row) => row.subject === configSelectionConfig.subject,
    );
    if (index < 0) return;
    if (configSelectionTarget.kind === "practiceTests") {
      const visible = filteredConfigSelectionOptions.map(Number);
      updateConfig(index, {
        practiceTests: allVisibleConfigOptionsSelected
          ? configSelectionConfig.practiceTests.filter(
              (test) => !visible.includes(test),
            )
          : [...new Set([...configSelectionConfig.practiceTests, ...visible])]
              .sort((a, b) => a - b),
      });
      return;
    }
    const visible = filteredConfigSelectionOptions.map(String);
    updateConfig(index, {
      modules: allVisibleConfigOptionsSelected
        ? configSelectionConfig.modules.filter(
            (module) => !visible.includes(module),
          )
        : [...new Set([...configSelectionConfig.modules, ...visible])],
    });
  }
  function toggleSubject(subject: string) {
    const existingIndex = configs.findIndex((row) => row.subject === subject);
    if (existingIndex >= 0) {
      setConfigs((rows) => rows.filter((row) => row.subject !== subject));
      setBlueprint(null);
      return;
    }
    const source = currentCatalog(subject);
    if (!source) return;
    setConfigs((rows) => [
      ...rows,
      {
        subject,
        modules: [...source.modules],
        practiceTests: source.availablePracticeYears,
        questionCount: Math.min(20, source.questionCount),
        timeLimitMin: 30,
      },
    ]);
    setBlueprint(null);
  }
  function validateDetails() {
    if (!title.trim()) return "Enter a drill title.";
    if (dueAt && !isFutureLocalDateTime(dueAt))
      return "Choose a due date in the future.";
    if (
      (scorePolicy === "on_due_date" || correctionPolicy === "on_due_date") &&
      !dueAt
    )
      return "A due date is required for due-date release.";
    return "";
  }

  function validateConfiguration() {
    if (!configs.length) return "Select at least one subject.";
    const incomplete = configs.find((row) => {
      const info = currentCatalog(row.subject);
      return (
        row.questionCount < 1 ||
        row.timeLimitMin < 1 ||
        ((info?.availablePracticeYears.length || 0) > 0 &&
          row.practiceTests.length === 0) ||
        ((info?.modules.length || 0) > 0 && row.modules.length === 0)
      );
    });
    return incomplete
      ? `Complete the question setup for ${incomplete.subject}.`
      : "";
  }

  async function navigateStage(nextStage: number) {
    setError("");
    if (nextStage === 1) {
      setStage(1);
      return;
    }
    const detailsError = validateDetails();
    if (detailsError) {
      setError(detailsError);
      setStage(1);
      return;
    }
    if (nextStage === 2) {
      setStage(2);
      return;
    }
    const configurationError = validateConfiguration();
    if (configurationError) {
      setError(configurationError);
      setStage(2);
      return;
    }
    if (nextStage === 3) {
      if (!blueprint) {
        setError("Generate or select questions before opening the review step.");
        setStage(2);
        return;
      }
      setStage(3);
      return;
    }
    const exact = blueprint;
    if (!exact) {
      setError("Add questions before continuing to Assign.");
      setStage(3);
      return;
    }
    await saveDraft(true);
  }

  async function buildAutomatic() {
    if (!user) return;
    const message = validateDetails();
    if (message) {
      setError(message);
      return;
    }
    const configurationError = validateConfiguration();
    if (configurationError) {
      setError(configurationError);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await callFunction<{
        ok: true;
        blueprint: Blueprint;
        preview: BankQuestion[];
      }>(user, "buildEducatorDrillBlueprintHttps", {
        bootcamp,
        subjects: configs,
      });
      setBlueprint(response.blueprint);
      setPreview(response.preview);
      setSelected(Object.fromEntries(
        response.preview.map((question) => [question.id, question]),
      ));
      setStage(3);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function blueprintForQuestions(rows: BankQuestion[]) {
    if (!rows.length || !catalog) return null;
    const grouped = new Map<string, BankQuestion[]>();
    rows.forEach((question) => grouped.set(question.subject, [
      ...(grouped.get(question.subject) || []),
      question,
    ]));
    const subjects = [...grouped.entries()].map(([subject, questions]) => {
      const old = blueprint?.subjects.find((row) => row.subject === subject);
      const config = configs.find((row) => row.subject === subject);
      return {
        subject,
        questionIds: questions.map((question) => question.id),
        timeLimitMin: old?.timeLimitMin || config?.timeLimitMin ||
          Math.max(1, questions.length),
        filters: {
          practiceYearCsv: [...new Set(
            questions.map((question) => question.practiceTest),
          )].join(","),
          modulesCsv: [...new Set(
            questions.map((question) => question.module),
          )].join(","),
        },
      };
    });
    return {
      bootcamp,
      datasetVersion: blueprint?.datasetVersion || catalog.datasetVersion,
      correctionRevision: blueprint?.correctionRevision ||
        bankCorrectionRevision,
      subjects,
      totalQuestions: rows.length,
    };
  }

  function removeQuestion(questionId: string) {
    const remaining = preview.filter((question) => question.id !== questionId);
    setPreview(remaining);
    setSelected(Object.fromEntries(
      remaining.map((question) => [question.id, question]),
    ));
    setBlueprint(blueprintForQuestions(remaining));
  }

  async function openQuestionLibrary() {
    if (!user) return;
    const message = validateDetails();
    if (message) {
      setError(message);
      setStage(1);
      return;
    }
    const configurationError = validateConfiguration();
    if (configurationError) {
      setError(configurationError);
      setStage(2);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await callFunction<{ok: true; drillId: string}>(
        user,
        "saveEducatorDrillDraftHttps",
        {
          drillId: savedDrillId || undefined,
          bootcamp,
          title: title.trim(),
          instructions: instructions.trim(),
          dueAt: dueAt ? new Date(dueAt).toISOString() : "",
          settings: {
            scorePolicy,
            correctionPolicy,
            shuffleQuestions,
            shuffleOptions: false,
          },
          blueprint,
        },
      );
      setSavedDrillId(response.drillId);
      if (localDraftKey) localStorage.removeItem(localDraftKey);
      const configKey = questionConfigKey(response.drillId);
      if (configKey) {
        sessionStorage.setItem(configKey, JSON.stringify(configs));
      }
      const returnTo =
        `/app/educator/bootcamps/${bootcamp}/drills/` +
        `${response.drillId}/edit?stage=questions`;
      router.push(
        `/app/educator/bootcamps/${bootcamp}/browse?draftId=` +
        `${encodeURIComponent(response.drillId)}&autobrowse=1&returnTo=` +
        encodeURIComponent(returnTo),
      );
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  }
  async function loadBank(reset = false) {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const response = await callFunction<BankResponse>(
        user,
        "getEducatorQuestionBankHttps",
        {
          bootcamp,
          subject: bankSubject,
          module: bankModule,
          practiceTest: bankTest || undefined,
          cursor: reset ? undefined : bankCursor || undefined,
          limit: 50,
        },
        { retryTransient: true },
      );
      setCatalog(normalizeCatalog(response.catalog));
      setBankCorrectionRevision(response.correctionRevision);
      setBank(reset ? response.questions : [...bank, ...response.questions]);
      setBankCursor(response.nextCursor);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function manualBlueprint() {
    if (!catalog || !Object.keys(selected).length) return null;
    const grouped = new Map<string, BankQuestion[]>();
    Object.values(selected).forEach((question) =>
      grouped.set(question.subject, [
        ...(grouped.get(question.subject) || []),
        question,
      ]),
    );
    const subjects = [...grouped.entries()].map(([subject, questions]) => {
      const config = configs.find((row) => row.subject === subject);
      return {
        subject,
        questionIds: questions.map((q) => q.id),
        timeLimitMin: config?.timeLimitMin || 30,
        filters: {
          practiceYearCsv: [
            ...new Set(questions.map((q) => q.practiceTest)),
          ].join(","),
          modulesCsv: [...new Set(questions.map((q) => q.module))].join(","),
        },
      };
    });
    return {
      bootcamp,
      datasetVersion: catalog.datasetVersion,
      correctionRevision: bankCorrectionRevision,
      subjects,
      totalQuestions: Object.keys(selected).length,
    };
  }
  async function saveDraft(goToAssign = false) {
    if (!user) return;
    const message = validateDetails();
    if (message) {
      setError(message);
      return;
    }
    const exact = blueprint;
    if (!exact) {
      setError("Build or select the questions before saving.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await callFunction<{ ok: true; drillId: string }>(
        user,
        "saveEducatorDrillDraftHttps",
        {
          drillId: savedDrillId || undefined,
          bootcamp,
          title: title.trim(),
          instructions: instructions.trim(),
          dueAt: dueAt ? new Date(dueAt).toISOString() : "",
          settings: {
            scorePolicy,
            correctionPolicy,
            shuffleQuestions,
            shuffleOptions: false,
          },
          blueprint: exact,
        },
      );
      setSavedDrillId(response.drillId);
      setBlueprint(exact);
      if (goToAssign) setStage(4);
      else setPublishResult("Draft saved.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reviewAssignment(event: FormEvent) {
    event.preventDefault();
    if (!studentIds.length && !groupKeys.length) {
      setError("Choose at least one student or group.");
      return;
    }
    setError("");
    setConfirmAssignment(true);
  }

  async function publish() {
    if (!user || !savedDrillId) return;
    setConfirmAssignment(false);
    setBusy(true);
    setError("");
    try {
      const response = await callFunction<{
        ok: true;
        assignedCount: number;
        rejected: unknown[];
      }>(user, "publishEducatorDrillAssignmentHttps", {
        bootcamp,
        drillId: savedDrillId,
        studentIds,
        groupKeys,
      });
      setPublishResult(
        `Assigned to ${response.assignedCount} student${response.assignedCount === 1 ? "" : "s"}.${response.rejected?.length ? ` ${response.rejected.length} target(s) were not eligible.` : ""}`,
      );
      if (localDraftKey) localStorage.removeItem(localDraftKey);
      window.setTimeout(
        () =>
          router.push(
            `/app/educator/bootcamps/${bootcamp}/drills/${savedDrillId}`,
          ),
        900,
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
      {busy && (
        <BrandedLoadingOverlay
          label={stage === 4 ? "Publishing assignment" : "Preparing drill"}
        />
      )}
      <Link
        href={`/app/educator/bootcamps/${bootcamp}/drills`}
        className="inline-flex items-center gap-2 text-sm text-slate-700"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
          <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
        </span>
        Drills
      </Link>
      <header className="mt-6">
        <p className="text-xs uppercase tracking-[.2em] text-brand-green/65">
          Drill builder
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          {savedDrillId ? "Edit drill" : "Create a drill"}
        </h1>
      </header>
      <ol className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-white p-2 sm:grid-cols-4">
        {["Details", "Configure", "Questions", "Assign"].map((label, index) => (
          <li key={label} className="min-w-0">
            <button
              type="button"
              onClick={() => void navigateStage(index + 1)}
              aria-current={stage === index + 1 ? "step" : undefined}
              className={`min-h-11 w-full rounded-xl px-2 text-center text-sm transition ${stage === index + 1 ? "bg-brand-green text-white" : "text-slate-500 hover:bg-brand-mist hover:text-brand-green"}`}
            >
              {index + 1}. {label}
            </button>
          </li>
        ))}
      </ol>
      {autosaveStatus && !drillId && (
        <p className="mt-2 text-right text-xs text-slate-400">
          {autosaveStatus}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {publishResult && (
        <p className="mt-5 rounded-2xl bg-brand-green/10 p-4 text-sm text-brand-green">
          {publishResult}
        </p>
      )}

      {stage === 1 && (
        <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <label className="text-sm">
              Title
              <input
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4"
              />
            </label>
            <label className="text-sm">
              Due date (optional)
              <input
                type="datetime-local"
                value={dueAt}
                min={minimumDueAt || undefined}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4"
              />
            </label>
          </div>
          <label className="mt-5 block text-sm">
            Instructions
            <textarea
              maxLength={1200}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="mt-2 min-h-28 w-full rounded-2xl border border-slate-200 p-4"
            />
          </label>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <label className="text-sm">
              Release scores
              <select
                value={scorePolicy}
                onChange={(e) => setScorePolicy(e.target.value as Policy)}
                className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4"
              >
                <option value="immediate">Immediately</option>
                <option value="on_due_date">On due date</option>
                <option value="manual">Manually</option>
              </select>
            </label>
            <label className="text-sm">
              Release corrections
              <select
                value={correctionPolicy}
                onChange={(e) => setCorrectionPolicy(e.target.value as Policy)}
                className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 px-4"
              >
                <option value="immediate">Immediately</option>
                <option value="on_due_date">On due date</option>
                <option value="manual">Manually</option>
              </select>
            </label>
          </div>
          <label className="mt-5 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={shuffleQuestions}
              onChange={(e) => setShuffleQuestions(e.target.checked)}
              className="h-4 w-4 accent-[#4B5320]"
            />
            Shuffle questions for each student
          </label>
          <button
            onClick={() => {
              const message = validateDetails();
              if (message) setError(message);
              else {
                setError("");
                setStage(2);
              }
            }}
            className="mt-7 min-h-12 w-full rounded-2xl bg-brand-green text-sm text-white"
          >
            CONTINUE TO CONFIGURE
          </button>
        </section>
      )}

      {stage === 2 && false && preview.length === 0 && questionFlow === "choice" && (
        <section className="mt-6">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[.18em] text-brand-green/60">
              Build the question set
            </p>
            <h2 className="mt-2 text-2xl font-medium">How would you like to begin?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Generate a balanced set from the question bank or choose every question yourself.
            </p>
          </div>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setQuestionFlow("auto")}
              className="group min-h-64 overflow-hidden rounded-[2rem] border-2 border-transparent bg-white p-7 text-left shadow-sm transition hover:border-brand-green hover:shadow-soft"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-green text-xl text-white">↻</span>
              <h3 className="mt-8 text-2xl font-medium">Auto-generate questions</h3>
              <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">
                Choose subjects, practice tests, modules, question counts, and timing. Inspect the exact set before assigning it.
              </p>
              <span className="mt-7 inline-flex text-sm text-brand-green">CONFIGURE QUESTION SET →</span>
            </button>
            <button
              type="button"
              onClick={() => void openQuestionLibrary()}
              className="group min-h-64 overflow-hidden rounded-[2rem] border-2 border-transparent bg-brand-green p-7 text-left text-white shadow-sm transition hover:border-brand-gold hover:shadow-soft"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-2xl text-brand-green">+</span>
              <h3 className="mt-8 text-2xl font-medium">Choose your own questions</h3>
              <p className="mt-3 max-w-md text-sm leading-6 text-white/70">
                Open the full question library, review answers and explanations, then return here with your selections.
              </p>
              <span className="mt-7 inline-flex text-sm text-brand-gold">OPEN QUESTION LIBRARY →</span>
            </button>
          </div>
        </section>
      )}

      {stage === 2 && (
        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[.18em] text-brand-green/60">Question setup</p>
              <h2 className="mt-2 text-2xl font-medium">Configure the drill</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Choose the source pools, target question count, and timing. The target guides automatic generation; manual selection can finish above or below it.</p>
            </div>
            <span className="rounded-full bg-brand-gold/20 px-3 py-2 text-xs text-brand-green">Target: {configs.reduce((sum, row) => sum + row.questionCount, 0)} questions</span>
          </div>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(catalog?.subjects || []).map((catalogSubject, subjectIndex) => {
                const active = configs.some((config) => config.subject === catalogSubject.name);
                return <button key={catalogSubject.name} type="button" onClick={() => toggleSubject(catalogSubject.name)} className={`relative min-h-40 overflow-hidden rounded-3xl border p-5 text-left transition ${active ? "border-brand-green bg-brand-green text-white shadow-soft" : "border-slate-200 bg-white hover:border-brand-green/35"}`}>
                  <span className={`absolute left-4 top-4 grid h-8 w-8 place-items-center rounded-full border text-lg ${active ? "border-white bg-white text-brand-green" : "border-brand-green/30 text-brand-green"}`}>{active ? "✓" : "+"}</span>
                  <p className={`mt-11 text-xs uppercase tracking-wider ${active ? "text-white/65" : "text-brand-green/60"}`}>Subject {subjectIndex + 1}</p>
                  <p className="mt-2 text-xl font-medium">{catalogSubject.name}</p>
                  <p className={`mt-2 text-sm ${active ? "text-white/70" : "text-slate-500"}`}>{catalogSubject.questionCount} questions · {catalogSubject.modules.length} modules</p>
                </button>;
              })}
          </div>
          {configs.length ? <div className="mt-6 space-y-4">{configs.map((config, index) => {
                const info = currentCatalog(config.subject);
                if (!info) return null;
                return <article key={config.subject} className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-lg font-medium">{config.subject}</p><p className="mt-1 text-xs text-slate-500">Choose at least one practice test and module.</p></div><button type="button" onClick={() => toggleSubject(config.subject)} className="rounded-xl px-3 py-2 text-xs text-red-700 transition hover:bg-red-50">Remove</button></div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm text-slate-600">Target questions<input type="number" min={1} max={Math.min(300, info.questionCount)} value={config.questionCount} onChange={(event) => updateConfig(index, {questionCount: Math.max(1, Number(event.target.value || 1))})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-brand-green" /></label>
                    <label className="text-sm text-slate-600">Time (minutes)<input type="number" min={1} max={300} value={config.timeLimitMin} onChange={(event) => updateConfig(index, {timeLimitMin: Math.max(1, Number(event.target.value || 1))})} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3 outline-none focus:border-brand-green" /></label>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button type="button" onClick={() => openConfigSelection({subject: config.subject, kind: "practiceTests"})} className="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-brand-mist/45 px-4 text-left transition hover:border-brand-green/40 hover:bg-brand-green/5"><span><span className="block text-xs font-medium uppercase tracking-wider text-brand-green/60">Practice tests</span><span className="mt-1 block text-sm text-slate-700">{config.practiceTests.length} of {info.availablePracticeYears.length} selected</span></span><span aria-hidden className="text-xl text-brand-green">›</span></button>
                    <button type="button" onClick={() => openConfigSelection({subject: config.subject, kind: "modules"})} className="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-brand-mist/45 px-4 text-left transition hover:border-brand-green/40 hover:bg-brand-green/5"><span><span className="block text-xs font-medium uppercase tracking-wider text-brand-green/60">Modules</span><span className="mt-1 block text-sm text-slate-700">{config.modules.length} of {info.modules.length} selected</span></span><span aria-hidden className="text-xl text-brand-green">›</span></button>
                  </div>
                </article>;
              })}</div> : <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center"><p className="text-lg font-medium">Select a subject to begin</p><p className="mt-2 text-sm text-slate-500">Your question and timing controls will appear here.</p></div>}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <button type="button" onClick={() => void buildAutomatic()} disabled={!configs.length} className="min-h-28 rounded-[1.75rem] bg-brand-green p-5 text-left text-white transition hover:bg-brand-green/90 disabled:bg-slate-300"><span className="text-lg font-medium">Auto-generate questions</span><span className="mt-2 block text-sm leading-6 text-white/70">Build the target-sized set from this configuration, then inspect every question.</span></button>
            <button type="button" onClick={() => void openQuestionLibrary()} disabled={!configs.length} className="min-h-28 rounded-[1.75rem] border-2 border-brand-green bg-white p-5 text-left text-brand-green transition hover:bg-brand-green/5 disabled:border-slate-200 disabled:text-slate-400"><span className="text-lg font-medium">Select questions yourself</span><span className="mt-2 block text-sm leading-6 text-slate-500">Browse through the question bank with questions up to three times your target.</span></button>
          </div>
        </section>
      )}

      {stage === 3 && preview.length > 0 && (
        <section className="mt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="text-xs uppercase tracking-[.18em] text-brand-green/60">Selected question set</p><h2 className="mt-2 text-2xl font-medium">Inspect the questions</h2><p className="mt-1 text-sm text-slate-500">{preview.length} questions</p></div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void openQuestionLibrary()} className="min-h-11 rounded-xl border border-brand-green bg-white px-4 text-xs text-brand-green transition hover:bg-brand-green/5">ADD OR BROWSE QUESTIONS</button>
              <button type="button" onClick={() => setConfirmRegenerate(true)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-xs text-slate-600 transition hover:border-brand-gold">DISCARD & AUTO-GENERATE</button>
            </div>
          </div>
          <div className="mt-6 grid gap-3 lg:grid-cols-2">{preview.map((question, questionIndex) => <article key={question.id} className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <button type="button" onClick={() => setPreviewQuestion(question)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-mist text-sm text-brand-green underline decoration-1 underline-offset-2">{questionIndex + 1}</button>
            <button type="button" onClick={() => setPreviewQuestion(question)} className="min-w-0 flex-1 text-left"><p className="text-xs text-brand-green/70">{question.subject} · {question.module} · Test {question.practiceTest}</p><p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-700">{questionText(question.prompt)}</p></button>
            <button type="button" onClick={() => removeQuestion(question.id)} className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-700 hover:bg-red-50">Remove</button>
          </article>)}</div>
          <button type="button" onClick={() => void saveDraft(true)} className="mt-6 min-h-14 w-full rounded-2xl bg-brand-green text-sm text-white">SAVE DRAFT & CONTINUE TO ASSIGN</button>
        </section>
      )}

      {stage === 2 && false && (
        <section className="mt-6">
          <div className="grid grid-cols-2 rounded-2xl bg-white p-1 sm:max-w-md">
            <button
              onClick={() => setMode("auto")}
              className={`min-h-11 rounded-xl text-sm ${mode === "auto" ? "bg-brand-green text-white" : "text-slate-500"}`}
            >
              Auto generate
            </button>
            <button
              onClick={() => {
                setMode("manual");
                if (!bank.length) void loadBank(true);
              }}
              className={`min-h-11 rounded-xl text-sm ${mode === "manual" ? "bg-brand-green text-white" : "text-slate-500"}`}
            >
              Choose questions
            </button>
          </div>
          {mode === "auto" ? (
            <div className="mt-6 grid gap-7 xl:grid-cols-[1fr_1.05fr]">
              <section>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-medium uppercase tracking-[0.15em]">
                      Subjects
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Choose the subjects included in this assignment.
                    </p>
                  </div>
                  <span className="rounded-full bg-brand-gold/20 px-3 py-2 text-xs text-brand-green">
                    {configs.length} selected
                  </span>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {(catalog?.subjects || []).map((subject, index) => {
                    const active = configs.some(
                      (config) => config.subject === subject.name,
                    );
                    return (
                      <button
                        key={subject.name}
                        type="button"
                        onClick={() => toggleSubject(subject.name)}
                        className={`relative min-h-44 overflow-visible rounded-[1.75rem] border-2 p-5 pr-[42%] text-left transition ${active ? "border-brand-gold bg-brand-green text-white shadow-soft" : "border-transparent bg-white text-slate-900 shadow-sm hover:border-brand-green/30"}`}
                      >
                        <span
                          className={`absolute left-4 top-4 grid h-8 w-8 place-items-center rounded-full border text-sm font-medium ${active ? "border-white bg-white text-brand-green" : "border-slate-200"}`}
                        >
                          {active ? "✓" : "+"}
                        </span>
                        <span className="mt-10 block text-xs uppercase tracking-wider opacity-60">
                          Subject {String(index + 1).padStart(2, "0")}
                        </span>
                        <h3 className="mt-5 text-xl font-medium sm:text-2xl">
                          {subject.name}
                        </h3>
                        <img
                          src={subjectArtwork(subject.name)}
                          alt=""
                          className="pointer-events-none absolute -right-3 bottom-2 h-[88%] w-[46%] object-contain object-bottom"
                        />
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-medium uppercase tracking-[0.15em]">
                      Assignment plan
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Fine-tune the selected question sets.
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {configs.reduce((sum, row) => sum + row.questionCount, 0)}{" "}
                    questions
                  </span>
                </div>

                {configs.length ? (
                  <div className="mt-5 space-y-5">
                    {configs.map((config, index) => {
                      const info = currentCatalog(config.subject);
                      if (!info) return null;
                      return (
                        <article
                          key={config.subject}
                          className="rounded-3xl bg-brand-mist p-5"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="font-medium">
                              {config.subject.toUpperCase()}
                            </h3>
                            <button
                              type="button"
                              onClick={() => toggleSubject(config.subject)}
                              className="text-xs text-red-700"
                            >
                              Remove
                            </button>
                          </div>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2">
                            <label className="text-xs text-slate-600">
                              Questions
                              <input
                                type="number"
                                min={1}
                                max={Math.min(300, info.questionCount)}
                                value={config.questionCount}
                                onChange={(event) =>
                                  updateConfig(index, {
                                    questionCount: Number(event.target.value),
                                  })
                                }
                                className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900"
                              />
                            </label>
                            <label className="text-xs text-slate-600">
                              Time (minutes)
                              <input
                                type="number"
                                min={1}
                                max={300}
                                value={config.timeLimitMin}
                                onChange={(event) =>
                                  updateConfig(index, {
                                    timeLimitMin: Number(event.target.value),
                                  })
                                }
                                className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900"
                              />
                            </label>
                          </div>
                          <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white/55 p-4">
                            <PracticeTestRange
                              availableYears={info.availablePracticeYears}
                              selectedYears={config.practiceTests}
                              onChange={(practiceTests) =>
                                updateConfig(index, { practiceTests })
                              }
                            />
                          </div>
                          <details className="mt-4">
                            <summary className="cursor-pointer text-xs text-brand-green">
                              Customize modules
                            </summary>
                            <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                              {info.modules.map((module) => {
                                const checked = config.modules.includes(module);
                                return (
                                  <button
                                    key={module}
                                    type="button"
                                    onClick={() =>
                                      updateConfig(index, {
                                        modules: checked
                                          ? config.modules.filter(
                                              (item) => item !== module,
                                            )
                                          : [...config.modules, module],
                                      })
                                    }
                                    className={`rounded-full px-3 py-2 text-[11px] ${checked ? "bg-brand-green text-white" : "border border-slate-200 bg-white text-slate-600"}`}
                                  >
                                    {module}
                                  </button>
                                );
                              })}
                            </div>
                          </details>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid min-h-72 place-items-center text-center">
                    <div>
                      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-gold/25 text-xl text-brand-green">
                        +
                      </div>
                      <p className="mt-4 font-medium">
                        Select a subject to begin
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Your assignment plan will appear here.
                      </p>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={buildAutomatic}
                  disabled={!configs.length}
                  className="mt-6 min-h-12 w-full rounded-2xl bg-brand-green text-sm text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  GENERATE QUESTIONS
                </button>
              </section>
            </div>
          ) : (
            <div className="mt-5">
              <div className="flex flex-wrap gap-3 rounded-2xl bg-white p-4">
                <select
                  value={bankSubject}
                  onChange={(e) => {
                    setBankSubject(e.target.value);
                    setBankModule("");
                  }}
                  className="min-h-11 rounded-xl border border-slate-200 px-3"
                >
                  <option value="">All subjects</option>
                  {catalog?.subjects.map((row) => (
                    <option key={row.name}>{row.name}</option>
                  ))}
                </select>
                <select
                  value={bankModule}
                  onChange={(e) => setBankModule(e.target.value)}
                  className="min-h-11 rounded-xl border border-slate-200 px-3"
                >
                  <option value="">All modules</option>
                  {currentCatalog(bankSubject)?.modules.map((row) => (
                    <option key={row}>{row}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  value={bankTest}
                  onChange={(e) => setBankTest(Number(e.target.value))}
                  placeholder="Practice test"
                  className="min-h-11 w-36 rounded-xl border border-slate-200 px-3"
                />
                <button
                  onClick={() => loadBank(true)}
                  className="min-h-11 rounded-xl bg-brand-green px-4 text-sm text-white"
                >
                  Apply
                </button>
                <span className="ml-auto self-center text-sm text-slate-500">
                  {Object.keys(selected).length} selected
                </span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {bank.map((question) => (
                  <article
                    key={question.id}
                    className={`rounded-2xl border p-4 ${selected[question.id] ? "border-brand-green bg-brand-green/5" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[question.id])}
                        onChange={() =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (next[question.id]) delete next[question.id];
                            else next[question.id] = question;
                            return next;
                          })
                        }
                        className="mt-1 h-4 w-4 accent-[#4B5320]"
                      />
                      <div className="min-w-0">
                        <p className="text-xs text-brand-green/70">
                          {question.subject} · {question.module} · Test{" "}
                          {question.practiceTest}
                        </p>
                        <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">
                          {questionText(question.prompt)}
                        </p>
                        <button
                          onClick={() => setPreviewQuestion(question)}
                          className="mt-3 text-xs text-brand-green underline"
                        >
                          Preview
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {bankCursor && (
                <button
                  onClick={() => loadBank(false)}
                  className="mt-4 min-h-11 w-full rounded-xl border border-slate-300 bg-white text-sm"
                >
                  Load more
                </button>
              )}
              <button
                onClick={() => {
                  const exact = manualBlueprint();
                  if (!exact) setError("Select at least one question.");
                  else {
                    setBlueprint(exact);
                    setPreview(Object.values(selected));
                    void saveDraft(true);
                  }
                }}
                className="mt-5 min-h-12 w-full rounded-2xl bg-brand-green text-sm text-white"
              >
                SAVE QUESTIONS & CONTINUE
              </button>
            </div>
          )}
          {mode === "auto" && preview.length > 0 && (
            <div className="mt-6 rounded-3xl bg-brand-mist p-5">
              <div className="flex justify-between">
                <h2 className="text-lg font-medium">
                  Preview ({preview.length})
                </h2>
                <span className="text-sm text-slate-500">
                  Version {blueprint?.datasetVersion}
                </span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {preview.slice(0, 20).map((question) => (
                  <button
                    key={question.id}
                    onClick={() => setPreviewQuestion(question)}
                    className="rounded-2xl bg-white p-4 text-left"
                  >
                    <p className="text-xs text-brand-green/70">
                      {question.subject} · {question.module}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm">
                      {questionText(question.prompt)}
                    </p>
                  </button>
                ))}
              </div>
              <button
                onClick={() => saveDraft(true)}
                className="mt-5 min-h-12 w-full rounded-2xl bg-brand-green text-sm text-white"
              >
                SAVE DRAFT & ASSIGN
              </button>
            </div>
          )}
        </section>
      )}

      {stage === 4 && (
        <form
          onSubmit={reviewAssignment}
          className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6"
        >
          <div className="rounded-2xl bg-brand-mist p-5">
            <p className="text-xs uppercase tracking-wider text-brand-green/60">
              Assignment summary
            </p>
            <h2 className="mt-2 text-xl font-medium">
              {title || "Untitled drill"}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {configs.map((row) => <span key={row.subject} className="rounded-full border border-brand-green/15 bg-white/80 px-3 py-1.5 text-xs text-brand-green">{row.subject}</span>)}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/80 p-3"><dt className="text-[10px] uppercase tracking-wider text-slate-400">Questions</dt><dd className="mt-1 text-base text-slate-800">{totalQuestions}</dd></div>
              <div className="rounded-2xl bg-white/80 p-3"><dt className="text-[10px] uppercase tracking-wider text-slate-400">Time</dt><dd className="mt-1 text-base text-slate-800">{totalTime} min</dd></div>
              <div className="col-span-2 rounded-2xl bg-white/80 p-3 sm:col-span-1"><dt className="text-[10px] uppercase tracking-wider text-slate-400">Due</dt><dd className="mt-1 text-sm text-slate-800">{dueAt ? new Date(dueAt).toLocaleString([], {dateStyle: "medium", timeStyle: "short"}) : "No due date"}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full bg-white/70 px-3 py-2">Scores: <span className="text-slate-800">{policyLabel(scorePolicy)}</span></span>
              <span className="rounded-full bg-white/70 px-3 py-2">Corrections: <span className="text-slate-800">{policyLabel(correctionPolicy)}</span></span>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <button type="button" onClick={() => openRecipientPicker("students")} className="group flex min-h-28 items-center justify-between gap-5 rounded-3xl border border-slate-200 bg-white p-5 text-left transition hover:border-brand-green hover:bg-brand-green/5">
              <span><span className="block text-xs uppercase tracking-[.16em] text-brand-green/60">Recipients</span><span className="mt-2 block text-xl font-medium">Students ({studentIds.length})</span><span className="mt-1 block text-sm text-slate-500">{roster?.students.length || 0} available</span></span>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-mist text-2xl text-brand-green transition group-hover:bg-brand-green group-hover:text-white">›</span>
            </button>
            <button type="button" onClick={() => openRecipientPicker("groups")} className="group flex min-h-28 items-center justify-between gap-5 rounded-3xl border border-slate-200 bg-white p-5 text-left transition hover:border-brand-green hover:bg-brand-green/5">
              <span><span className="block text-xs uppercase tracking-[.16em] text-brand-green/60">Recipients</span><span className="mt-2 block text-xl font-medium">Groups ({groupKeys.length})</span><span className="mt-1 block text-sm text-slate-500">{roster?.groups.length || 0} available</span></span>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-mist text-2xl text-brand-green transition group-hover:bg-brand-green group-hover:text-white">›</span>
            </button>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStage(3)}
              className="min-h-12 rounded-2xl border border-slate-300"
            >
              BACK
            </button>
            <button
              type="submit"
              className="min-h-12 rounded-2xl bg-brand-green text-white"
            >
              REVIEW & ASSIGN
            </button>
          </div>
        </form>
      )}

      {recipientPicker && (
        <div className="fixed inset-0 z-[115] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label={`Select ${recipientPicker}`}>
          <section className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div><p className="text-xs uppercase tracking-[.16em] text-brand-green/60">Assign drill</p><h2 className="mt-1 text-2xl font-medium">Select {recipientPicker}</h2><p className="mt-1 text-sm text-slate-500">{recipientPicker === "students" ? studentIds.length : groupKeys.length} selected</p></div>
              <button type="button" onClick={() => setRecipientPicker(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-mist text-xl" aria-label="Close recipient selector">×</button>
            </header>
            <div className="border-b border-slate-100 p-4 sm:px-6">
              <input autoFocus type="search" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder={`Search ${recipientPicker}`} className="min-h-11 w-full rounded-xl border border-slate-200 bg-brand-mist/40 px-4 text-sm outline-none focus:border-brand-green" />
              {recipientPicker === "groups" && <p className="mt-3 rounded-xl bg-brand-gold/15 px-4 py-3 text-xs leading-5 text-slate-600">Selecting a group automatically adds every student currently in that group. Students selected more than once are included only once.</p>}
            </div>
            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-4 sm:px-6">
              {recipientPicker === "students" ? visibleStudents.map((student) => (
                <label key={student.id} className="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm">
                  <input type="checkbox" checked={studentIds.includes(student.id)} onChange={() => setStudentIds(studentIds.includes(student.id) ? studentIds.filter((id) => id !== student.id) : [...studentIds, student.id])} className="h-4 w-4 shrink-0 accent-[#4B5320]" />
                  <span>{student.firstName} {student.lastName}</span>
                </label>
              )) : visibleGroups.map((group: EducatorGroup) => {
                const key = `${group.scope}:${group.rawGroupId || group.id}`;
                return <label key={group.id} className="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm"><input type="checkbox" checked={groupKeys.includes(key)} onChange={() => setGroupKeys(groupKeys.includes(key) ? groupKeys.filter((id) => id !== key) : [...groupKeys, key])} className="h-4 w-4 shrink-0 accent-[#4B5320]" /><span className="min-w-0 flex-1">{group.name}</span><span className="shrink-0 text-xs text-slate-400">{group.memberCount} students</span></label>;
              })}
              {recipientPicker === "students" && !visibleStudents.length && <p className="py-10 text-center text-sm text-slate-500">No matching students.</p>}
              {recipientPicker === "groups" && !visibleGroups.length && <p className="py-10 text-center text-sm text-slate-500">No matching groups.</p>}
            </div>
            <footer className="border-t border-slate-100 p-4 sm:px-6"><button type="button" onClick={() => setRecipientPicker(null)} className="min-h-12 w-full rounded-xl bg-brand-green text-sm text-white">DONE</button></footer>
          </section>
        </div>
      )}

      {configSelectionTarget && configSelectionConfig && (
        <div className="fixed inset-0 z-[115] grid place-items-center bg-black/55 p-4">
          <section className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div><p className="text-xs uppercase tracking-wider text-brand-green/60">{configSelectionTarget.subject}</p><h2 className="mt-1 text-xl font-medium">Select {configSelectionTarget.kind === "practiceTests" ? "practice tests" : "modules"}</h2><p className="mt-1 text-xs text-slate-500">Choose one or more options for this subject.</p></div>
              <button type="button" onClick={() => setConfigSelectionTarget(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-mist text-xl" aria-label="Close selector">×</button>
            </header>
            <div className="border-b border-slate-100 p-4 sm:px-6">
              <input autoFocus type="search" value={configSelectionQuery} onChange={(event) => setConfigSelectionQuery(event.target.value)} placeholder={`Search ${configSelectionTarget.kind === "practiceTests" ? "tests" : "modules"}`} className="min-h-11 w-full rounded-xl border border-slate-200 bg-brand-mist/40 px-4 text-sm outline-none focus:border-brand-green" />
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={toggleAllVisibleConfigOptions} disabled={!filteredConfigSelectionOptions.length} className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600 disabled:opacity-40">{allVisibleConfigOptionsSelected ? "UNSELECT ALL" : "SELECT ALL"}</button><span className="ml-auto self-center text-xs text-slate-400">{configSelectionTarget.kind === "practiceTests" ? configSelectionConfig.practiceTests.length : configSelectionConfig.modules.length} selected</span></div>
            </div>
            <div className={`min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 ${configSelectionTarget.kind === "practiceTests" ? "grid auto-rows-min grid-cols-2 gap-2 sm:grid-cols-3" : "space-y-2"}`}>
              {filteredConfigSelectionOptions.map((option) => <label key={String(option)} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 bg-brand-mist/55 p-3 text-sm hover:border-brand-green/30"><input type="checkbox" checked={isConfigOptionSelected(option)} onChange={() => toggleConfigOption(option)} className="h-4 w-4 shrink-0 accent-[#4B5320]" /><span className="min-w-0 break-words">{configSelectionTarget.kind === "practiceTests" ? `Test ${option}` : String(option)}</span></label>)}
              {!filteredConfigSelectionOptions.length && <p className="col-span-full py-10 text-center text-sm text-slate-500">No matching options.</p>}
            </div>
            <footer className="border-t border-slate-100 p-4 sm:px-6"><button type="button" onClick={() => setConfigSelectionTarget(null)} className="min-h-11 w-full rounded-xl bg-brand-green text-sm text-white">DONE</button></footer>
          </section>
        </div>
      )}

      {confirmRegenerate && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/50 p-4">
          <section className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
            <p className="text-xs uppercase tracking-[.16em] text-brand-green/60">Replace question set</p>
            <h2 className="mt-2 text-2xl font-medium">Discard these questions?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              A new random set will use the current subject, module, practice-test, count, and timing configuration. Your existing set remains intact if generation fails.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setConfirmRegenerate(false)} className="min-h-12 rounded-2xl border border-slate-300 bg-white text-sm">CANCEL</button>
              <button type="button" onClick={() => {
                setConfirmRegenerate(false);
                if (configs.length) void buildAutomatic();
                else {
                  setPreview([]);
                  setSelected({});
                  setBlueprint(null);
                  setQuestionFlow("auto");
                }
              }} className="min-h-12 rounded-2xl bg-brand-green text-sm text-white">GENERATE NEW SET</button>
            </div>
          </section>
        </div>
      )}

      {confirmAssignment && (
        <div
          className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Review assignment"
        >
          <section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[.18em] text-brand-green/60">
                  Final check
                </p>
                <h2 className="mt-2 text-2xl font-medium">Ready to assign?</h2>
              </div>
              <button
                type="button"
                onClick={() => setConfirmAssignment(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="mt-5 rounded-2xl bg-brand-mist p-5">
              <h3 className="text-lg font-medium">{title}</h3>
              <p className="mt-2 text-sm text-slate-600">
                {configs.map((row) => row.subject).join(", ")} ·{" "}
                {totalQuestions} questions · {totalTime} minutes
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {dueAt
                  ? `Due ${new Date(dueAt).toLocaleString()}`
                  : "No due date"}
              </p>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">Students</dt>
                <dd className="mt-1 text-xl">{studentIds.length}</dd>
              </div>
              <div className="rounded-2xl border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">Groups</dt>
                <dd className="mt-1 text-xl">{groupKeys.length}</dd>
              </div>
              <div className="rounded-2xl border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">Scores</dt>
                <dd className="mt-1 capitalize">
                  {scorePolicy.replaceAll("_", " ")}
                </dd>
              </div>
              <div className="rounded-2xl border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">Corrections</dt>
                <dd className="mt-1 capitalize">
                  {correctionPolicy.replaceAll("_", " ")}
                </dd>
              </div>
            </dl>
            <p className="mt-5 text-sm leading-6 text-slate-500">
              Group members and directly selected students will be de-duplicated
              by the server before publishing.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfirmAssignment(false)}
                className="min-h-12 rounded-2xl border border-slate-300 bg-white text-sm transition hover:border-brand-green"
              >
                GO BACK
              </button>
              <button
                type="button"
                onClick={() => void publish()}
                className="min-h-12 rounded-2xl bg-brand-green text-sm text-white transition hover:bg-brand-green/90"
              >
                ASSIGN NOW
              </button>
            </div>
          </section>
        </div>
      )}

      {previewQuestion && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4">
          <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] bg-white p-6">
            <div className="flex justify-between">
              <p className="text-xs text-brand-green">
                {previewQuestion.subject} · {previewQuestion.module} · Test{" "}
                {previewQuestion.practiceTest}
              </p>
              <button
                onClick={() => setPreviewQuestion(null)}
                className="grid h-9 w-9 place-items-center rounded-full bg-brand-mist text-xl"
              >
                ×
              </button>
            </div>
            {previewQuestion.passage && (
              <div className="mt-4 rounded-2xl bg-brand-mist p-4 whitespace-pre-line text-sm">
                {questionText(previewQuestion.passage)}
              </div>
            )}
            <p className="mt-5 whitespace-pre-line text-base leading-7">
              {questionText(previewQuestion.prompt)}
            </p>
            {questionImageUrls(previewQuestion.imageSources, bootcamp).map((src) => (
              <img
                key={src}
                src={src}
                alt="Question reference"
                className="mt-4 max-h-80 w-full object-contain"
              />
            ))}
            <div className="mt-5 space-y-2">
              {previewQuestion.options.map((option, index) => (
                <div
                  key={index}
                  className={`rounded-xl border p-3 text-sm ${index === previewQuestion.answerIndex ? "border-green-400 bg-green-50" : "border-slate-200"}`}
                >
                  {String.fromCharCode(65 + index)}. {questionText(option)}
                </div>
              ))}
            </div>
            {previewQuestion.explanation && (
              <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm">
                <p className="text-xs uppercase tracking-wider text-amber-800">
                  Explanation
                </p>
                <p className="mt-2 whitespace-pre-line leading-6">
                  <QuestionRichText value={previewQuestion.explanation} />
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
