"use client";

import Link from "next/link";
import {useRouter, useSearchParams} from "next/navigation";
import {useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import type {ResolvedAccount} from "@/lib/types/account";
import type {
  DrillCatalog,
  DrillSession,
  DrillSubjectConfig,
} from "@/lib/types/drill";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";

function subjectArtwork(subject: string) {
  const normalized = subject.toLowerCase();
  if (normalized.includes("math")) {
    return "/app-assets/drills/Mathematics.png";
  }
  if (normalized.includes("science")) {
    return "/app-assets/drills/Science.png";
  }
  if (normalized.includes("reading")) {
    return "/app-assets/drills/Reading.png";
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
        <p className="text-xs font-bold text-slate-600">Practice tests</p>
        <p className="text-xs font-black text-brand-green">
          {years[lowIndex] === years[highIndex]
            ? `Test ${years[lowIndex]}`
            : `Tests ${years[lowIndex]} – ${years[highIndex]}`}
        </p>
      </div>
      <div className="relative mt-3 h-8">
        <div className="absolute inset-x-1 top-3 h-2 rounded-full bg-white" />
        <div
          className="absolute top-3 h-2 rounded-full bg-brand-green"
          style={{left: `${lowPct}%`, right: `${100 - highPct}%`}}
        />
        <input
          type="range"
          min={0}
          max={years.length - 1}
          step={1}
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
          step={1}
          value={highIndex}
          onChange={(event) =>
            setRange(lowIndex, Math.max(Number(event.target.value), lowIndex))
          }
          aria-label="Last practice test"
          className="di-range absolute inset-0 w-full"
        />
      </div>
      <div className="flex justify-between text-[10px] font-bold text-slate-400">
        <span>{years[0]}</span>
        <span>{years[years.length - 1]}</span>
      </div>
    </div>
  );
}

export default function DrillSetup({bootcamp}: {bootcamp: string}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [catalog, setCatalog] = useState<DrillCatalog | null>(null);
  const [selected, setSelected] = useState<Record<string, DrillSubjectConfig>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [prefillApplied, setPrefillApplied] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      callFunction<ResolvedAccount>(user, "resolveSignInAccountHttps", {
        preferredRole: "student",
      }),
      callFunction<DrillCatalog, {bootcamp: string}>(
        user,
        "getStudentDrillCatalogHttps",
        {bootcamp},
        {retryTransient: true},
      ),
    ])
      .then(([nextAccount, nextCatalog]) => {
        setAccount(nextAccount);
        setCatalog(nextCatalog);
      })
      .catch((reason) => setError((reason as Error).message));
  }, [bootcamp, user]);

  useEffect(() => {
    if (!catalog || prefillApplied) return;
    const requestedSubject = searchParams.get("subject") || "";
    const source = catalog.subjects.find((row) =>
      row.name.toLowerCase() === requestedSubject.toLowerCase());
    if (source) {
      const requestedModules = (searchParams.get("modules") || "")
          .split(",").map((value) => value.trim())
          .filter((value) => source.modules.includes(value));
      const requestedCount = Number(searchParams.get("count") || 10);
      setSelected({
        [source.name]: {
          subject: source.name,
          questionCount: Math.min(
              source.questionCount,
              Math.max(1, Number.isFinite(requestedCount) ? requestedCount : 10),
          ),
          timeLimitMin: 30,
          modules: requestedModules,
          practiceYears: source.availablePracticeYears,
        },
      });
    }
    setPrefillApplied(true);
  }, [catalog, prefillApplied, searchParams]);

  const chosen = useMemo(() => Object.values(selected), [selected]);

  function toggleSubject(subjectName: string) {
    if (!catalog) return;
    setSelected((current) => {
      if (current[subjectName]) {
        const next = {...current};
        delete next[subjectName];
        return next;
      }
      if (Object.keys(current).length >= 4) return current;
      const source = catalog.subjects.find((row) => row.name === subjectName)!;
      return {
        ...current,
        [subjectName]: {
          subject: subjectName,
          questionCount: Math.min(20, source.questionCount),
          timeLimitMin: 30,
          modules: [],
          practiceYears: source.availablePracticeYears,
        },
      };
    });
  }

  function updateConfig(subject: string, patch: Partial<DrillSubjectConfig>) {
    setSelected((current) => ({
      ...current,
      [subject]: {...current[subject], ...patch},
    }));
  }

  async function createDrill() {
    if (!user || chosen.length === 0) return;
    setCreating(true);
    setError("");
    try {
      const response = await callFunction<
        {ok: true; session: DrillSession},
        {bootcamp: string; config: {subjects: DrillSubjectConfig[]}}
      >(user, "createStudentDrillHttps", {
        bootcamp,
        config: {subjects: chosen},
      });
      localStorage.setItem(
        `di.activeSession.${bootcamp}`,
        response.session.sessionId,
      );
      router.push(`/app/drills/${response.session.sessionId}`);
    } catch (reason) {
      setError((reason as Error).message);
      setCreating(false);
    }
  }

  if (!account || !catalog) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center">
        <p className="text-sm font-semibold text-slate-600">
          {error || "Loading drill options…"}
        </p>
      </div>
    );
  }

  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
        <Link
          href={`/app/bootcamps/${bootcamp}`}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
            <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
          </span>
          {bootcamp.toUpperCase()} bootcamp
        </Link>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green/60">
              Solo drill
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Build your drill.
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Choose up to four subjects, then customize the training set.
            </p>
          </div>
          <span className="rounded-full bg-brand-gold/25 px-4 py-2 text-xs font-bold text-brand-green">
            {catalog.licensed ? "Full practice library" : "Practice tests 1 – 2"}
          </span>
        </div>

        <div className="mt-8 grid gap-7 xl:grid-cols-[1fr_1.05fr]">
          <section>
            <h2 className="text-sm font-black uppercase tracking-[0.15em]">
              Subjects
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {catalog.subjects.map((subject, index) => {
                const active = Boolean(selected[subject.name]);
                return (
                  <button
                    key={subject.name}
                    type="button"
                    onClick={() => toggleSubject(subject.name)}
                    className={`relative min-h-44 overflow-visible rounded-[1.75rem] border-2 p-5 pr-[42%] text-left transition ${
                      active
                        ? "border-brand-gold bg-brand-green text-white shadow-soft"
                        : "border-transparent bg-white text-slate-900 shadow-sm hover:border-brand-green/30"
                    }`}
                  >
                    <span className={`absolute left-4 top-4 grid h-8 w-8 place-items-center rounded-full border text-sm font-black ${
                      active ? "border-white bg-white text-brand-green" : "border-slate-200"
                    }`}>
                      {active ? "✓" : "+"}
                    </span>
                    <span className="mt-10 block text-xs font-bold uppercase tracking-wider opacity-60">
                      Subject 0{index + 1}
                    </span>
                    <h3 className="mt-5 text-xl font-black sm:text-2xl">
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
            <div>
              <h2 className="text-sm font-black uppercase tracking-[0.15em]">
                Drill plan
              </h2>
            </div>

            {chosen.length ? (
              <div className="mt-5 space-y-5">
                {chosen.map((row) => {
                  const source = catalog.subjects.find((item) => item.name === row.subject)!;
                  return (
                    <article key={row.subject} className="rounded-3xl bg-brand-mist p-5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-black">{row.subject.toUpperCase()}</h3>
                        <button type="button" onClick={() => toggleSubject(row.subject)} className="text-xs font-bold text-red-700">
                          Remove
                        </button>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="text-xs font-bold text-slate-600">
                          Questions
                          <input
                            type="number"
                            min={5}
                            max={Math.min(40, source.questionCount)}
                            value={row.questionCount}
                            onChange={(event) => updateConfig(row.subject, {questionCount: Number(event.target.value)})}
                            className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900"
                          />
                        </label>
                        <label className="text-xs font-bold text-slate-600">
                          Time (minutes)
                          <input
                            type="number"
                            min={5}
                            max={120}
                            value={row.timeLimitMin}
                            onChange={(event) => updateConfig(row.subject, {timeLimitMin: Number(event.target.value)})}
                            className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-slate-900"
                          />
                        </label>
                      </div>
                      <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white/55 p-4">
                        <PracticeTestRange
                          availableYears={source.availablePracticeYears}
                          selectedYears={row.practiceYears}
                          onChange={(practiceYears) =>
                            updateConfig(row.subject, {practiceYears})
                          }
                        />
                      </div>
                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs font-bold text-brand-green">
                          Customize modules
                        </summary>
                        <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                          {source.modules.map((module) => {
                            const checked = row.modules.includes(module);
                            return (
                              <button
                                key={module}
                                type="button"
                                onClick={() => updateConfig(row.subject, {
                                  modules: checked
                                    ? row.modules.filter((item) => item !== module)
                                    : [...row.modules, module],
                                })}
                                className={`rounded-full px-3 py-2 text-[11px] font-semibold ${
                                  checked ? "bg-brand-green text-white" : "border border-slate-200 bg-white text-slate-600"
                                }`}
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
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-gold/25 text-xl font-black text-brand-green">+</div>
                  <p className="mt-4 font-bold">Select a subject to begin</p>
                  <p className="mt-1 text-sm text-slate-500">Your customized drill plan will appear here.</p>
                </div>
              </div>
            )}

            {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button
              type="button"
              disabled={!chosen.length || creating}
              onClick={createDrill}
              className="mt-6 min-h-13 w-full rounded-2xl bg-brand-green px-6 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? "Preparing questions…" : "START DRILL"}
            </button>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
