"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import { callFunction } from "@/lib/api/client";
import { questionImageUrls } from "@/lib/drills/images";
import { questionText } from "@/lib/drills/text";
import type {DrillCatalog, DrillResult, DrillSession} from "@/lib/types/drill";
import type {StreakSummary} from "@/lib/types/account";
import { useAuth } from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";

function clock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

interface RunnerState {
  answers: Record<string, number>;
  bookmarks: Record<string, boolean>;
  flags: Record<string, boolean>;
  questionTimes: Record<string, number>;
  timers: Record<string, number>;
  index: number;
}

export default function QuestionRunner({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { user, loading, updateStreak } = useAuth();
  const [session, setSession] = useState<DrillSession | null>(null);
  const [subscriptionActive, setSubscriptionActive] = useState<boolean | null>(
    null,
  );
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [bookmarks, setBookmarks] = useState<Record<string, boolean>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [questionTimes, setQuestionTimes] = useState<Record<string, number>>(
    {},
  );
  const [timers, setTimers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [showReference, setShowReference] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [timeoutComplete, setTimeoutComplete] = useState(false);
  const [timeoutDestination, setTimeoutDestination] = useState("");
  const [, setSaveState] = useState<"saved" | "saving" | "offline">(
    "saved",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const stateRef = useRef<RunnerState>({
    answers,
    bookmarks,
    flags,
    questionTimes,
    timers,
    index,
  });
  const timeoutHandledForSubject = useRef("");

  useEffect(() => {
    stateRef.current = {
      answers,
      bookmarks,
      flags,
      questionTimes,
      timers,
      index,
    };
  }, [answers, bookmarks, flags, index, questionTimes, timers]);

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    callFunction<
      {
        ok: true;
        session?: DrillSession;
        status?: string;
        mode?: string;
        challengeId?: string;
      },
      { sessionId: string }
    >(
      user,
      "getStudentDrillSessionHttps",
      { sessionId },
      { retryTransient: true },
    )
      .then(async (response) => {
        if (response.status === "submitted") {
          if (response.challengeId) {
            callFunction(
              user,
              "completeChallengeHttps",
              {
                challengeId: response.challengeId,
                sessionId,
              },
              {retryTransient: true},
            )
              .finally(() =>
                router.replace(
                  `/app/drills/${sessionId}/results?from=challenges`,
                ),
              );
            return;
          }
          router.replace(`/app/drills/${sessionId}/results`);
          return;
        }
        if (!response.session) {
          throw new Error("The drill session could not be loaded.");
        }
        const next = response.session;
        setSession(next);
        setAnswers(next.answers || {});
        setBookmarks(next.bookmarks || {});
        setFlags(next.flags || {});
        setQuestionTimes(next.questionTimes || {});
        setTimers(next.timers || {});
        setIndex(
          Math.max(
            0,
            next.questions.findIndex(
              (question) => question.id === next.currentQuestionId,
            ),
          ),
        );
        localStorage.setItem(`di.activeSession.${next.bootcamp}`, sessionId);
        callFunction<DrillCatalog, {bootcamp: string}>(
          user,
          "getStudentDrillCatalogHttps",
          {bootcamp: next.bootcamp},
        )
          .then((catalog) => setSubscriptionActive(catalog.licensed))
          .catch(() => setSubscriptionActive(false));
      })
      .catch((reason) => setError((reason as Error).message));
  }, [router, sessionId, user]);

  const save = useCallback(async () => {
    if (!user || !session) return;
    const state = stateRef.current;
    setSaveState("saving");
    try {
      await callFunction(user, "saveStudentDrillProgressHttps", {
        sessionId,
        answers: state.answers,
        bookmarks: state.bookmarks,
        flags: state.flags,
        questionTimes: state.questionTimes,
        timers: state.timers,
        currentQuestionId: session.questions[state.index]?.id || "",
      });
      setSaveState("saved");
    } catch {
      setSaveState("offline");
    }
  }, [session, sessionId, user]);

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(save, 12000);
    return () => window.clearInterval(interval);
  }, [save, session]);

  const current = session?.questions[index];
  const currentSubject = current?.subject || "";

  useEffect(() => {
    if (!session || !current || submitting || timeoutComplete) return;
    const interval = window.setInterval(() => {
      setTimers((value) => {
        const next = {
          ...value,
          [current.subject]: Math.max(
            0,
            Number(value[current.subject] || 0) - 1,
          ),
        };
        stateRef.current.timers = next;
        return next;
      });
      setQuestionTimes((value) => {
        const next = {
          ...value,
          [current.id]: Number(value[current.id] || 0) + 1,
        };
        stateRef.current.questionTimes = next;
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [current, session, submitting, timeoutComplete]);

  const subjects = useMemo(
    () => [
      ...new Set(session?.questions.map((question) => question.subject) || []),
    ],
    [session],
  );
  const answeredCount = Object.keys(answers).length;

  function move(nextIndex: number) {
    if (!session) return;
    const safeIndex = Math.min(
      session.questions.length - 1,
      Math.max(0, nextIndex),
    );
    setIndex(safeIndex);
    stateRef.current.index = safeIndex;
    window.setTimeout(save, 0);
  }

  function answerQuestion(questionId: string, optionIndex: number) {
    setAnswers((value) => {
      const next = { ...value, [questionId]: optionIndex };
      stateRef.current.answers = next;
      window.setTimeout(save, 0);
      return next;
    });
  }

  function toggleFlag(questionId: string) {
    setFlags((value) => {
      const next = { ...value };
      if (next[questionId]) delete next[questionId];
      else next[questionId] = true;
      stateRef.current.flags = next;
      window.setTimeout(save, 0);
      return next;
    });
  }

  async function toggleBookmark(questionId: string) {
    if (!user || !session) return;
    if (subscriptionActive !== true) {
      router.push(`/app/bootcamps/${session.bootcamp}/subscription`);
      return;
    }
    const bookmarked = !bookmarks[questionId];
    setBookmarks((value) => {
      const next = { ...value, [questionId]: bookmarked };
      stateRef.current.bookmarks = next;
      return next;
    });
    try {
      await callFunction(user, "setStudentBookmarkHttps", {
        sessionId,
        questionId,
        bookmarked,
      });
      await save();
    } catch (reason) {
      setBookmarks((value) => {
        const next = { ...value, [questionId]: !bookmarked };
        stateRef.current.bookmarks = next;
        return next;
      });
      setError((reason as Error).message);
    }
  }

  async function submitDrill(timedOut = false) {
    if (!user || !session || !current) return;
    setSubmitting(true);
    setError("");
    setShowSubmit(false);
    try {
      const state = stateRef.current;
      const activeQuestion = session.questions[state.index] || current;
      const response = await callFunction<
        {
          ok: true;
          result: DrillResult;
          challengeId?: string;
          streak?: StreakSummary;
        },
        Record<string, unknown>
      >(user, "submitStudentDrillHttps", {
        sessionId,
        answers: state.answers,
        bookmarks: state.bookmarks,
        flags: state.flags,
        questionTimes: state.questionTimes,
        timers: state.timers,
        currentQuestionId: activeQuestion.id,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      });
      if (response.streak) {
        updateStreak(session.bootcamp, response.streak);
      }
      if (session.challengeId || response.challengeId) {
        await callFunction(
          user,
          "completeChallengeHttps",
          {
            challengeId: session.challengeId || response.challengeId,
            sessionId,
          },
          {retryTransient: true},
        );
      }
      localStorage.removeItem(`di.activeSession.${session.bootcamp}`);
      const destination = `/app/drills/${sessionId}/results${
        session.challengeId || response.challengeId ? "?from=challenges" : ""
      }`;
      if (timedOut) {
        setTimeoutDestination(destination);
        setTimeoutComplete(true);
        setSubmitting(false);
      } else {
        router.push(destination);
      }
    } catch (reason) {
      setError(
        session.challengeId
          ? `Your result was saved, but the challenge could not sync. ${
              (reason as Error).message
            } Submit again to retry.`
          : (reason as Error).message,
      );
      setSubmitting(false);
      if (timedOut) timeoutHandledForSubject.current = "";
    }
  }

  function confirmSubmit() {
    void submitDrill(false);
  }

  useEffect(() => {
    if (!session || !current || submitting || timeoutComplete) return;
    if (!subjects.every((subject) =>
      Object.prototype.hasOwnProperty.call(timers, subject),
    )) return;
    const remaining = Number(timers[current.subject] || 0);
    if (remaining > 0) {
      timeoutHandledForSubject.current = "";
      return;
    }
    if (timeoutHandledForSubject.current === current.subject) return;
    timeoutHandledForSubject.current = current.subject;

    const nextSubject = subjects.find((subject) =>
      subject !== current.subject && Number(timers[subject] || 0) > 0,
    );
    if (nextSubject) {
      const nextIndex = session.questions.findIndex(
        (question) => question.subject === nextSubject,
      );
      if (nextIndex >= 0) move(nextIndex);
      return;
    }

    void submitDrill(true);
  }, [current, session, subjects, submitting, timeoutComplete, timers]);

  if (error && !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-red-700">
        {error}
      </div>
    );
  }
  if (!session || !current) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist text-sm font-semibold text-slate-600">
        Preparing your drill…
      </div>
    );
  }

  const images = questionImageUrls(current.imageSources, session.bootcamp);
  const hasReference = images.length > 0 || Boolean(current.passage);
  const remaining = timers[currentSubject] ?? 0;
  const progress = ((index + 1) / session.questions.length) * 100;
  const subjectGroups = subjects.map((subject) => ({
    subject,
    questions: session.questions
      .map((question, questionIndex) => ({ question, questionIndex }))
      .filter(({ question }) => question.subject === subject),
  }));

  return (
    <main className="min-h-screen bg-[#eef1f4] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-black/10 bg-white">
        <div className="flex min-h-16 items-center gap-4 px-4 sm:px-6">
          <Link
            href={`/app/bootcamps/${session.bootcamp}`}
            aria-label="Leave drill"
            className="shrink-0"
            onClick={() => void save()}
          >
            <BrandLogo size={42} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-green transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center px-4 py-7 sm:px-8">
        <section className="w-full rounded-[2rem] border border-slate-200 bg-[#fafafa] p-5 shadow-sm sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowMap(true)}
              className="text-sm font-semibold text-brand-green underline decoration-1 underline-offset-4 sm:text-base"
            >
              Question: {index + 1} of {session.questions.length}
            </button>
            <div className="flex items-center gap-2">
              {hasReference && (
                <button
                  type="button"
                  onClick={() => setShowReference(true)}
                  className="min-h-10 rounded-xl border border-brand-green/20 bg-white px-3 text-xs font-bold text-brand-green"
                >
                  View reference
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleFlag(current.id)}
                className={`group relative grid h-10 w-10 place-items-center rounded-xl border text-lg ${
                  flags[current.id]
                    ? "border-amber-400 bg-amber-100 text-amber-800"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
                aria-label={flags[current.id] ? "Remove flag" : "Flag question"}
              >
                {flags[current.id] ? "⚑" : "⚐"}
                <span className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-lg group-hover:block group-focus-visible:block">
                  {flags[current.id] ? "Remove flag" : "Flag"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => toggleBookmark(current.id)}
                className={`group relative grid h-10 w-10 place-items-center rounded-xl border text-lg ${
                  subscriptionActive !== true
                    ? "border-slate-200 bg-slate-100 text-slate-400"
                    : bookmarks[current.id]
                      ? "border-brand-gold bg-brand-gold/20 text-brand-green"
                      : "border-slate-200 bg-white text-slate-500"
                }`}
                aria-label={
                  subscriptionActive !== true
                    ? "Subscribe to use bookmarks"
                    : bookmarks[current.id]
                      ? "Remove bookmark"
                      : "Bookmark question"
                }
              >
                {bookmarks[current.id] ? "★" : "☆"}
                <span className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-lg group-hover:block group-focus-visible:block">
                  {subscriptionActive !== true
                    ? "Subscribe to bookmark"
                    : bookmarks[current.id]
                      ? "Remove bookmark"
                      : "Bookmark"}
                </span>
              </button>
              <div
                className={`grid h-10 min-w-20 place-items-center rounded-xl px-3 text-sm font-black tabular-nums ${
                  remaining < 60
                    ? "bg-red-50 text-red-700"
                    : "bg-brand-gold/20 text-brand-green"
                }`}
                aria-label="Time remaining"
              >
                {clock(remaining)}
              </div>
            </div>
          </div>

          <h1 className="mt-7 whitespace-pre-wrap text-lg font-normal leading-7 text-slate-800 sm:text-xl sm:leading-8">
            {questionText(current.prompt)}
          </h1>

          <div className="mt-8 space-y-3">
            {current.options.map((option, optionIndex) => {
              const selected = answers[current.id] === optionIndex;
              return (
                <button
                  key={`${current.id}-${optionIndex}`}
                  type="button"
                  onClick={() => answerQuestion(current.id, optionIndex)}
                  className={`flex min-h-14 w-full items-center gap-4 rounded-2xl border-2 p-4 text-left transition ${
                    selected
                      ? "border-brand-green bg-brand-green text-white shadow-sm"
                      : "border-slate-200 bg-white hover:border-brand-green/35"
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black ${
                      selected
                        ? "bg-white text-brand-green"
                        : "bg-brand-mist text-slate-600"
                    }`}
                  >
                    {String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span className="whitespace-pre-wrap text-base font-normal leading-6">
                    {questionText(option)}
                  </span>
                </button>
              );
            })}
          </div>

          {error && (
            <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-8 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => move(index - 1)}
              className="min-h-12 justify-self-start rounded-2xl border border-slate-200 bg-white px-8 text-lg font-normal disabled:opacity-35"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setShowSubmit(true)}
              className="min-h-12 w-full min-w-40 rounded-2xl border-2 border-brand-green px-10 text-lg font-black text-brand-green sm:min-w-60"
            >
              Submit
            </button>
            {index < session.questions.length - 1 && (
              <button
                type="button"
                onClick={() => move(index + 1)}
                className="min-h-12 justify-self-end rounded-2xl bg-brand-green px-9 text-lg font-normal text-white"
              >
                Next
              </button>
            )}
          </div>
        </section>
      </div>

      {showReference && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Question reference"
        >
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-brand-green/60">
                  Reference
                </p>
                <p className="mt-1 text-sm font-bold">{currentSubject}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowReference(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl"
                aria-label="Close reference"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(90vh-5rem)] space-y-5 overflow-y-auto p-5 sm:p-7">
              {images.map((image, imageIndex) => (
                <a
                  key={image}
                  href={image}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                >
                  <img
                    src={image}
                    alt={`Question reference ${imageIndex + 1}`}
                    className="mx-auto max-h-[62vh] max-w-full rounded-2xl object-contain"
                  />
                </a>
              ))}
              {current.passage && (
                <div className="whitespace-pre-wrap rounded-2xl bg-brand-mist p-5 text-base leading-8 text-slate-700">
                  {questionText(current.passage)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showMap && (
        <div
          className="fixed inset-0 z-50 bg-black/35"
          role="dialog"
          aria-modal="true"
          aria-label="Question map"
        >
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setShowMap(false)}
            aria-label="Close question map"
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-green/60">
                  Navigation
                </p>
                <h2 className="mt-1 text-xl font-black">Question map</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowMap(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl"
                aria-label="Close question map"
              >
                ×
              </button>
            </div>
            <div className="mt-6 space-y-7">
              {subjectGroups.map((group) => (
                <section key={group.subject}>
                  <div className="mb-3 flex items-center gap-3">
                    <h3 className="text-sm font-black">{group.subject}</h3>
                    <span className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs text-slate-400">
                      {group.questions.filter(({question}) => answers[question.id] !== undefined).length}/{group.questions.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {group.questions.map(({ question, questionIndex }, localIndex) => (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => {
                          move(questionIndex);
                          setShowMap(false);
                        }}
                        className={`relative aspect-square rounded-xl text-xs font-black ${
                          flags[question.id]
                            ? "bg-amber-300 text-amber-950"
                            : questionIndex === index
                              ? "bg-brand-gold text-brand-green ring-2 ring-brand-green"
                              : answers[question.id] !== undefined
                                ? "bg-brand-green text-white"
                                : "bg-brand-mist text-slate-500"
                        }`}
                      >
                        {localIndex + 1}
                        {bookmarks[question.id] && (
                          <span className="absolute -right-1 -top-1 rounded bg-white p-0.5 text-brand-green shadow-sm">
                            ★
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="mt-7 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-2xl bg-brand-mist p-4">
                <p className="text-slate-500">Answered</p>
                <p className="mt-1 text-xl font-black">{answeredCount}</p>
              </div>
              <div className="rounded-2xl bg-brand-mist p-4">
                <p className="text-slate-500">Flagged</p>
                <p className="mt-1 text-xl font-black">
                  {Object.keys(flags).length}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMap(false);
                setShowSubmit(true);
              }}
              className="mt-6 min-h-12 w-full rounded-2xl border-2 border-brand-green text-sm font-black text-brand-green"
            >
              Submit drill
            </button>
          </aside>
        </div>
      )}

      {showSubmit && (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-title"
        >
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-7">
            
            <h2
              id="submit-title"
              className="mt-5 text-center text-2xl font-black"
            >
              Submit this drill?
            </h2>
            <p className="mt-3 text-center text-sm leading-6 text-slate-600">
              You answered {answeredCount} of {session.questions.length}{" "}
              questions.
              {session.questions.length - answeredCount > 0 &&
                ` ${session.questions.length - answeredCount} unanswered question(s) will remain ungraded.`}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setShowSubmit(false)}
                className="min-h-12 rounded-2xl border border-slate-200 text-base font-normal text-slate-700"
              >
                Keep working
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={confirmSubmit}
                className="min-h-12 rounded-2xl bg-brand-green text-base font-normal text-white disabled:opacity-50"
              >
                {submitting ? "Grading…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {timeoutComplete && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="timeout-title"
        >
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 text-center shadow-2xl sm:p-7">
            <h2 id="timeout-title" className="text-2xl font-bold text-slate-950">
              Time&apos;s up
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Your drill has ended and your answers have been submitted.
            </p>
            <button
              type="button"
              onClick={() => router.push(timeoutDestination)}
              className="mt-6 min-h-12 w-full rounded-2xl bg-brand-green px-5 text-base font-semibold text-white"
            >
              View results
            </button>
          </div>
        </div>
      )}
      {submitting && <BrandedLoadingOverlay label="Grading your drill" />}
    </main>
  );
}
