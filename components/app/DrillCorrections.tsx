"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {questionImageUrls} from "@/lib/drills/images";
import {questionText} from "@/lib/drills/text";
import type {
  DrillAnswerResult,
  DrillBookmark,
  DrillCatalog,
  DrillResult,
} from "@/lib/types/drill";
import {useAuth} from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";
import QuestionRichText from "./QuestionRichText";

type ReviewStatus = "all" | "correct" | "incorrect" | "unanswered";

function wasAttempted(answer: DrillAnswerResult) {
  return (
    Number.isInteger(answer.selectedIndex) &&
    Number(answer.selectedIndex) >= 0 &&
    Number(answer.selectedIndex) < answer.options.length
  );
}

function answerStatus(answer: DrillAnswerResult) {
  if (!wasAttempted(answer)) return "unanswered";
  return answer.isCorrect ? "correct" : "incorrect";
}

function statusLabel(answer: DrillAnswerResult) {
  const status = answerStatus(answer);
  return status === "unanswered"
    ? "Unanswered"
    : status === "correct"
      ? "Correct"
      : "Incorrect";
}

function mixedCase(value: string) {
  const words = String(value || "General")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/);
  const minorWords = new Set(["and", "or", "of", "the", "in", "to", "for"]);
  return words
    .map((word, index) =>
      index > 0 && minorWords.has(word)
        ? word
        : word.replace(/^([a-z])/, (letter) => letter.toLocaleUpperCase()),
    )
    .join(" ");
}

export default function DrillCorrections({
  sessionId,
  fromRecords = false,
  fromChallenges = false,
  initialResult,
  educatorContext,
}: {
  sessionId: string;
  fromRecords?: boolean;
  fromChallenges?: boolean;
  initialResult?: DrillResult;
  educatorContext?: {
    studentName: string;
    drillTitle: string;
    submittedAt: string;
    resultHref: string;
    dashboardHref: string;
  };
}) {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [result, setResult] = useState<DrillResult | null>(initialResult || null);
  const [index, setIndex] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [mapSubject, setMapSubject] = useState("all");
  const [mapStatus, setMapStatus] = useState<ReviewStatus>("all");
  const [bookmarks, setBookmarks] = useState<Record<string, boolean>>({});
  const [subscriptionActive, setSubscriptionActive] = useState<boolean | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialResult) setResult(initialResult);
  }, [initialResult]);

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (initialResult) return;
    if (!user) return;
    callFunction<{ok: true; result: DrillResult}, {sessionId: string; correctionsOnly: boolean}>(
      user,
      "getStudentDrillResultHttps",
      {sessionId, correctionsOnly: true},
      {retryTransient: true},
    )
      .then((response) => setResult(response.result))
      .catch((reason) => setError((reason as Error).message));
  }, [initialResult, sessionId, user]);

  useEffect(() => {
    if (educatorContext) return;
    if (!user || !result?.bootcamp) return;
    callFunction<DrillCatalog, {bootcamp: string}>(
      user,
      "getStudentDrillCatalogHttps",
      {bootcamp: result.bootcamp},
    )
      .then(async (catalog) => {
        setSubscriptionActive(catalog.licensed);
        if (!catalog.licensed) {
          setBookmarks({});
          return;
        }
        const response = await callFunction<
          {ok: true; bookmarks: DrillBookmark[]},
          {bootcamp: string}
        >(user, "getStudentBookmarksHttps", {bootcamp: result.bootcamp});
        setBookmarks(
          Object.fromEntries(
            response.bookmarks.map((bookmark) => [bookmark.id, true]),
          ),
        );
      })
      .catch(() => setSubscriptionActive(false));
  }, [educatorContext, result?.bootcamp, user]);

  const subjects = useMemo(
    () => [
      ...new Set(
        (result?.answers || [])
          .filter((answer) => Boolean(educatorContext) || wasAttempted(answer))
          .map((answer) => answer.subject),
      ),
    ],
    [educatorContext, result],
  );
  const reviewAnswers = useMemo(
    () => (result?.answers || []).filter(
      (answer) => Boolean(educatorContext) || wasAttempted(answer),
    ),
    [educatorContext, result],
  );

  if (!result) {
    if (!error) {
      return <BrandedLoadingOverlay label="Loading corrections" fixed={false} />;
    }
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-slate-600">
        {error || "Loading corrections…"}
      </div>
    );
  }

  if (!reviewAnswers.length) {
    return (
      <main className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center">
        <div className="max-w-md rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-black">No corrections to review</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {educatorContext ?
              "No question-level submission data is available for this attempt." :
              "Only answered questions appear in corrections."}
          </p>
          <Link
            href={educatorContext?.resultHref || `/app/drills/${sessionId}/results${
              fromChallenges
                ? "?from=challenges"
                : fromRecords
                  ? "?from=records"
                  : ""
            }`}
            className="mt-6 inline-flex min-h-12 items-center rounded-2xl bg-brand-green px-6 text-sm font-black text-white"
          >
            Back to results
          </Link>
        </div>
      </main>
    );
  }

  const current = reviewAnswers[index];
  const answerCount = reviewAnswers.length;
  const images = questionImageUrls(current.imageSources, result.bootcamp);
  const hasReference = images.length > 0 || Boolean(current.passage);
  const progress = ((index + 1) / answerCount) * 100;
  const currentStatus = answerStatus(current);
  const paperQuestionCount = Math.max(
    answerCount,
    Number(result.summary?.totalQ || 0),
  );
  const originalQuestionNumber =
    Number(current.position || 0) || index + 1;

  const subjectGroups = subjects
    .map((subject) => ({
      subject,
      questions: reviewAnswers
        .map((answer, questionIndex) => ({answer, questionIndex}))
        .filter(({answer}) => answer.subject === subject)
        .filter(({answer}) => {
          if (mapStatus === "correct") {
            return answerStatus(answer) === "correct";
          }
          if (mapStatus === "incorrect") {
            return answerStatus(answer) === "incorrect";
          }
          if (mapStatus === "unanswered") {
            return answerStatus(answer) === "unanswered";
          }
          return true;
        }),
    }))
    .filter((group) => mapSubject === "all" || group.subject === mapSubject)
    .filter((group) => group.questions.length > 0);
  const mapStatuses: ReviewStatus[] = educatorContext ?
    ["all", "correct", "incorrect", "unanswered"] :
    ["all", "correct", "incorrect"];
  const mapLegend: Array<[string, string]> = [
    ["border border-green-300 bg-green-50", "Correct"],
    ["border border-red-300 bg-red-50", "Incorrect"],
    ...(educatorContext ? [[
      "border border-slate-300 bg-slate-100",
      "Unanswered",
    ] as [string, string]] : []),
  ];

  function move(nextIndex: number) {
    setIndex(Math.max(0, Math.min(answerCount - 1, nextIndex)));
    setShowReference(false);
  }

  async function toggleBookmark() {
    if (!user || !result) return;
    if (subscriptionActive !== true) {
      router.push(`/app/bootcamps/${result.bootcamp}/subscription`);
      return;
    }
    const bookmarked = !bookmarks[current.id];
    setBookmarks((value) => ({...value, [current.id]: bookmarked}));
    try {
      await callFunction(user, "setStudentBookmarkHttps", {
        sessionId,
        questionId: current.id,
        bookmarked,
      });
    } catch (reason) {
      setBookmarks((value) => ({...value, [current.id]: !bookmarked}));
      setError((reason as Error).message);
    }
  }

  return (
    <main className="min-h-screen bg-[#eef1f4] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-black/10 bg-white">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center px-4 sm:px-8">
          <div className="w-full">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-green transition-all"
                style={{width: `${progress}%`}}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-8">
        <Link
          href={educatorContext?.resultHref || `/app/drills/${sessionId}/results${
            fromChallenges
              ? "?from=challenges"
              : fromRecords
                ? "?from=records"
                : ""
          }`}
          className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-700"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
            <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
          </span>
          Back to results
        </Link>

        {educatorContext && (
          <section className="mb-5 rounded-[2rem] border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-7">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-green/60">
              Student submission
            </p>
            <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
              <div>
                <h1 className="text-2xl font-normal text-slate-950">{educatorContext.studentName}</h1>
                <p className="mt-1 text-sm text-slate-600">{educatorContext.drillTitle}</p>
              </div>
              <p className="text-xs text-slate-500">
                Submitted {new Date(educatorContext.submittedAt).toLocaleString()}
              </p>
            </div>
          </section>
        )}

        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-[#fafafa] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-5 py-4 sm:px-8">
            <button
              type="button"
              onClick={() => setShowMap(true)}
              className="text-sm font-semibold text-brand-green underline decoration-1 underline-offset-4 sm:text-base"
            >
              Question: {originalQuestionNumber} of {paperQuestionCount}
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
              {!educatorContext && <button
                type="button"
                onClick={toggleBookmark}
                className={`group relative grid h-10 w-10 place-items-center rounded-xl border text-lg ${
                  subscriptionActive !== true
                    ? "border-slate-200 bg-slate-100 text-slate-400"
                    : bookmarks[current.id]
                    ? "border-brand-gold bg-brand-gold/20 text-brand-green"
                    : "border-slate-200 bg-white text-slate-500"
                }`}
                aria-label={
                  subscriptionActive !== true
                    ? "Subscribe to bookmark"
                    : bookmarks[current.id]
                    ? "Remove bookmark"
                    : "Bookmark question"
                }
              >
                {bookmarks[current.id] ? "★" : "☆"}
                <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 shadow-lg group-hover:block group-focus-visible:block">
                  {subscriptionActive !== true
                    ? "Subscribe to bookmark"
                    : bookmarks[current.id]
                      ? "Remove bookmark"
                      : "Bookmark"}
                </span>
              </button>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-y border-slate-100 bg-white px-5 py-4 sm:px-8">
            <span
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-black ${
                currentStatus === "correct"
                  ? "bg-green-100 text-green-800"
                  : currentStatus === "incorrect"
                    ? "bg-red-100 text-red-700"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {originalQuestionNumber}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">
                {current.subject} - {mixedCase(current.module || "General")}
              </p>
              <p
                className={`mt-0.5 text-xs ${
                  currentStatus === "correct"
                    ? "text-green-700"
                    : currentStatus === "incorrect"
                      ? "text-red-600"
                      : "text-slate-500"
                }`}
              >
                {statusLabel(current)}
                {current.timeSpentSec ? ` · ${current.timeSpentSec}s` : ""}
              </p>
            </div>
          </div>

          <div className="p-5 sm:p-8 lg:p-10">
            <p className="max-w-4xl whitespace-pre-wrap text-lg font-normal leading-8 text-slate-800 sm:text-xl sm:leading-9">
              {questionText(current.prompt)}
            </p>

            <div className="mt-7 max-w-4xl space-y-3">
              {current.options.map((option, optionIndex) => (
                <div
                  key={optionIndex}
                  className={`flex min-h-14 items-center gap-4 rounded-2xl border p-4 ${
                    optionIndex === current.correctIndex
                      ? "border-green-300 bg-green-50"
                      : optionIndex === current.selectedIndex
                        ? "border-red-300 bg-red-50"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <span className="text-sm font-black">
                    {String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span className="whitespace-pre-wrap text-sm leading-6 sm:text-base">
                    {questionText(option)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 max-w-4xl rounded-2xl bg-brand-gold/15 p-5">
              <p className="text-xs font-black uppercase tracking-wider text-brand-green">
                Explanation
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700 sm:text-base">
                {questionText(current.explanation) ? (
                  <QuestionRichText value={current.explanation} />
                ) : (
                  "No explanation is available for this question yet."
                )}
              </p>
            </div>

            {error && (
              <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-8 grid grid-cols-1 gap-2 min-[280px]:grid-cols-2 sm:gap-3">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index - 1)}
                className="min-h-12 w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-2 text-sm font-normal disabled:opacity-35 sm:px-8"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={index === answerCount - 1}
                onClick={() => move(index + 1)}
                className="min-h-12 w-full min-w-0 rounded-2xl bg-brand-green px-2 text-sm font-normal text-white disabled:opacity-35 sm:px-9"
              >
                Next
              </button>
            </div>
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
                <p className="mt-1 text-sm font-bold">
                  {current.subject} - {mixedCase(current.module || "General")}
                </p>
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
                <img
                  key={image}
                  src={image}
                  alt={`Question reference ${imageIndex + 1}`}
                  className="mx-auto max-h-[62vh] max-w-full rounded-2xl object-contain"
                />
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
          aria-label="Review question map"
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
                  Review navigator
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

            <div className="mt-5 flex gap-2 overflow-x-auto">
              {["all", ...subjects].map((subject) => (
                <button
                  key={subject}
                  type="button"
                  onClick={() => setMapSubject(subject)}
                  className={`shrink-0 rounded-full px-3 py-2 text-[11px] font-bold ${
                    mapSubject === subject
                      ? "bg-brand-green text-white"
                      : "bg-brand-mist text-slate-600"
                  }`}
                >
                  {subject === "all" ? "All subjects" : subject}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {mapStatuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setMapStatus(status)}
                  className={`rounded-full px-3 py-2 text-[11px] font-bold capitalize ${
                    mapStatus === status
                      ? "bg-brand-gold text-brand-green"
                      : "bg-brand-mist text-slate-600"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-600">
              {mapLegend.map(([color, label]) => (
                <span key={label} className="inline-flex items-center gap-2">
                  <span className={`h-3 w-3 rounded-full ${color}`} />
                  {label}
                </span>
              ))}
            </div>

            <div className="mt-6 space-y-7">
              {subjectGroups.map((group) => (
                <section key={group.subject}>
                  <div className="mb-3 flex items-center gap-3">
                    <h3 className="text-sm font-black">{group.subject}</h3>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {group.questions.map(({answer, questionIndex}) => {
                      const originalQuestionNumber =
                        Number(answer.position || 0) || questionIndex + 1;
                      const itemStatus = answerStatus(answer);
                      return (
                        <button
                          key={answer.id}
                          type="button"
                          onClick={() => {
                            move(questionIndex);
                            setShowMap(false);
                          }}
                          className={`relative aspect-square rounded-xl text-xs font-black ${
                            itemStatus === "correct"
                              ? "border border-green-300 bg-green-50 text-green-800"
                              : itemStatus === "incorrect"
                                ? "border border-red-300 bg-red-50 text-red-700"
                                : "border border-slate-300 bg-slate-100 text-slate-600"
                          } ${
                            questionIndex === index
                              ? "ring-2 ring-brand-green ring-offset-2"
                              : ""
                          }`}
                        >
                          {originalQuestionNumber}
                          {!educatorContext && bookmarks[answer.id] && (
                            <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-white text-[9px] text-brand-green shadow-sm">
                              ★
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!subjectGroups.length && (
                <p className="rounded-2xl bg-brand-mist p-5 text-sm text-slate-500">
                  No questions match these filters.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
