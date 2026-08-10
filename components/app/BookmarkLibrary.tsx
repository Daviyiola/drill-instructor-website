"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useMemo, useState} from "react";
import {ApiError, callFunction} from "@/lib/api/client";
import {rankImage} from "@/lib/ranks";
import {questionImageUrls} from "@/lib/drills/images";
import {questionText} from "@/lib/drills/text";
import type {ResolvedAccount} from "@/lib/types/account";
import type {
  DrillBookmark,
  DrillResult,
} from "@/lib/types/drill";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";
import QuestionRichText from "./QuestionRichText";

interface SquadProfile {
  id: string;
  firstName: string;
  lastName: string;
  platoonName: string;
  rankNum: number;
}

interface ChallengeSubjectDraft {
  subject: string;
  questionCount: number;
  timeLimitMin: number;
}

async function hydrateBookmarkAnswers(
  user: NonNullable<ReturnType<typeof useAuth>["user"]>,
  bookmarks: DrillBookmark[],
) {
  const sessionIds = [...new Set(
    bookmarks
      .filter((bookmark) => !bookmark.answerAvailable)
      .map((bookmark) => bookmark.sourceSessionId)
      .filter(Boolean),
  )];
  const results = await Promise.allSettled(
    sessionIds.map((sessionId) =>
      callFunction<{ok: true; result: DrillResult}, {sessionId: string}>(
        user,
        "getStudentDrillResultHttps",
        {sessionId},
      ),
    ),
  );
  const answerMap = new Map<string, DrillResult["answers"][number]>();
  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.result.answers.forEach((answer) => {
      answerMap.set(`${result.value.result.sessionId}\u0000${answer.id}`, answer);
    });
  });
  return bookmarks.map((bookmark) => {
    if (bookmark.answerAvailable) return bookmark;
    const answer = answerMap.get(
      `${bookmark.sourceSessionId}\u0000${bookmark.id}`,
    );
    if (!answer) return bookmark;
    return {
      ...bookmark,
      correctIndex: answer.correctIndex,
      explanation: answer.explanation,
      answerAvailable: true,
    };
  });
}

export default function BookmarkLibrary({bootcamp}: {bootcamp: string}) {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [bookmarks, setBookmarks] = useState<DrillBookmark[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [showModuleFilter, setShowModuleFilter] = useState(false);
  const [explanations, setExplanations] = useState<Record<string, boolean>>({});
  const [reference, setReference] = useState<DrillBookmark | null>(null);
  const [flashcardOpen, setFlashcardOpen] = useState(false);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardRevealed, setFlashcardRevealed] = useState(false);
  const [flashcardOrder, setFlashcardOrder] = useState<string[]>([]);
  const [groupBookmark, setGroupBookmark] = useState<DrillBookmark | null>(null);
  const [groupDraft, setGroupDraft] = useState<string[]>([]);
  const [newGroup, setNewGroup] = useState("");
  const [groupPendingDelete, setGroupPendingDelete] = useState("");
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [challengeDeck, setChallengeDeck] = useState<Record<string, boolean>>(
    {},
  );
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeStep, setChallengeStep] = useState<
    "summary" | "recipients" | "sent"
  >("summary");
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [squad, setSquad] = useState<SquadProfile[]>([]);
  const [recipients, setRecipients] = useState<Record<string, boolean>>({});
  const [sendingChallenge, setSendingChallenge] = useState(false);
  const [challengeSubjects, setChallengeSubjects] = useState<
    ChallengeSubjectDraft[]
  >([]);
  const [expiryDays, setExpiryDays] = useState(1);
  const [removing, setRemoving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setError("");
    setBookmarksLoading(true);
    Promise.all([
      callFunction<ResolvedAccount>(user, "resolveSignInAccountHttps", {
        preferredRole: "student",
      }, {retryTransient: true}),
      callFunction<
        {ok: true; bookmarks: DrillBookmark[]},
        {bootcamp: string}
      >(user, "getStudentBookmarksHttps", {bootcamp}, {retryTransient: true}),
    ])
      .then(async ([nextAccount, response]) => {
        const hydrated = await hydrateBookmarkAnswers(
          user,
          response.bookmarks,
        );
        if (cancelled) return;
        setBookmarks(hydrated);
        // Do not expose the library until both its account shell and its
        // bookmark rows are ready. Otherwise the initial empty array flashes
        // the "No matching bookmarks" state before the request completes.
        setAccount(nextAccount);
      })
      .catch((reason) => {
        if (cancelled) return;
        if (reason instanceof ApiError && reason.status === 403) {
          router.replace(`/app/bootcamps/${bootcamp}/subscription`);
          return;
        }
        setError((reason as Error).message);
      })
      .finally(() => {
        if (!cancelled) setBookmarksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bootcamp, router, user]);

  const subjects = useMemo(
    () => [...new Set(bookmarks.map((bookmark) => bookmark.subject))],
    [bookmarks],
  );
  const groups = useMemo(
    () => [...new Set(bookmarks.flatMap((bookmark) => bookmark.groups || []))],
    [bookmarks],
  );
  const availableModules = useMemo(
    () =>
      subject === "all"
        ? []
        : [
            ...new Set(
              bookmarks
                .filter((bookmark) => bookmark.subject === subject)
                .map((bookmark) => bookmark.module || "General"),
            ),
          ].sort(),
    [bookmarks, subject],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bookmarks.filter((bookmark) => {
      if (subject !== "all" && bookmark.subject !== subject) return false;
      if (
        selectedModules.length &&
        !selectedModules.includes(bookmark.module || "General")
      ) {
        return false;
      }
      if (
        groupFilter !== "all" &&
        !(bookmark.groups || []).includes(groupFilter)
      ) {
        return false;
      }
      if (!needle) return true;
      return [
        bookmark.prompt,
        bookmark.subject,
        bookmark.module,
        ...bookmark.options,
      ].some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [bookmarks, groupFilter, query, selectedModules, subject]);
  const selectedChallengeBookmarks = bookmarks.filter(
    (bookmark) => challengeDeck[bookmark.id],
  );
  const flashcards = flashcardOrder.length
    ? flashcardOrder
        .map((id) => bookmarks.find((bookmark) => bookmark.id === id))
        .filter((bookmark): bookmark is DrillBookmark => Boolean(bookmark))
    : visible;
  const flashcard = flashcards[flashcardIndex] || flashcards[0];
  const flashcardHasReference = Boolean(
    flashcard &&
      (flashcard.passage ||
        questionImageUrls(flashcard.imageSources, flashcard.bootcamp).length),
  );

  function selectSubject(nextSubject: string) {
    setSubject(nextSubject);
    setSelectedModules([]);
    setShowModuleFilter(false);
  }

  async function removeBookmark(bookmark: DrillBookmark) {
    if (!user || !bookmark.sourceSessionId) return;
    setRemoving(bookmark.id);
    setError("");
    try {
      await callFunction(user, "setStudentBookmarkHttps", {
        sessionId: bookmark.sourceSessionId,
        questionId: bookmark.id,
        bookmarked: false,
      });
      setBookmarks((rows) => rows.filter((row) => row.id !== bookmark.id));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setRemoving("");
    }
  }

  function openGroupEditor(bookmark: DrillBookmark) {
    setGroupBookmark(bookmark);
    setGroupDraft(bookmark.groups || []);
    setNewGroup("");
  }

  async function saveGroups() {
    if (!user || !groupBookmark) return;
    const groups = [...new Set([
      ...groupDraft,
      ...(newGroup.trim() ? [newGroup.trim()] : []),
    ])];
    setError("");
    try {
      await callFunction(user, "setStudentBookmarkGroupsHttps", {
        bootcamp,
        questionId: groupBookmark.id,
        groups,
      });
      setBookmarks((rows) =>
        rows.map((row) =>
          row.id === groupBookmark.id ? {...row, groups} : row,
        ),
      );
      setGroupBookmark(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function deleteGroup() {
    if (!user || !groupPendingDelete) return;
    setDeletingGroup(true);
    setError("");
    try {
      await callFunction(user, "deleteStudentBookmarkGroupHttps", {
        bootcamp,
        group: groupPendingDelete,
      });
      setBookmarks((rows) => rows.map((row) => ({
        ...row,
        groups: (row.groups || []).filter((group) => group !== groupPendingDelete),
      })));
      setGroupDraft((current) =>
        current.filter((group) => group !== groupPendingDelete),
      );
      if (groupFilter === groupPendingDelete) setGroupFilter("all");
      setGroupPendingDelete("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setDeletingGroup(false);
    }
  }

  async function openChallenge() {
    if (!user || !account || !selectedChallengeBookmarks.length) return;
    const versions = [
      ...new Set(
        selectedChallengeBookmarks.map((bookmark) => bookmark.datasetVersion),
      ),
    ];
    if (versions.length !== 1) {
      setError("Choose bookmarked questions from one question-bank version.");
      return;
    }
    const subjectNames = [
      ...new Set(
        selectedChallengeBookmarks.map((bookmark) => bookmark.subject),
      ),
    ];
    setChallengeSubjects(
      subjectNames.map((subjectName) => {
        const count = selectedChallengeBookmarks.filter(
          (bookmark) => bookmark.subject === subjectName,
        ).length;
        return {
          subject: subjectName,
          questionCount: count,
          timeLimitMin: Math.max(5, count * 2),
        };
      }),
    );
    setExpiryDays(1);
    setSquad([]);
    setRecipients({});
    setChallengeStep("summary");
    setChallengeOpen(true);
    setChallengeLoading(true);
    setError("");
    try {
      const ids = await callFunction<{ok: true; memberIds: string[]}>(
        user,
        "getMySquadMemberIdsHttps",
        {},
      );
      const memberIds = ids.memberIds.filter(
        (id) => id !== account.customUserId,
      );
      const profiles = await callFunction<
        {ok: true; results: SquadProfile[]},
        {memberIds: string[]; audience: "challenge_picker"}
      >(user, "getSquadProfilesHttps", {
        memberIds,
        audience: "challenge_picker",
      });
      setSquad(profiles.results);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setChallengeLoading(false);
    }
  }

  async function sendChallenge() {
    if (!user || !selectedChallengeBookmarks.length) return;
    const recipientIds = Object.keys(recipients).filter((id) => recipients[id]);
    if (!recipientIds.length) return;
    const versions = [
      ...new Set(
        selectedChallengeBookmarks.map((bookmark) => bookmark.datasetVersion),
      ),
    ];
    if (versions.length !== 1) {
      setError("Choose bookmarked questions from one question-bank version.");
      setChallengeOpen(false);
      return;
    }
    const blueprint = {
      bootcamp,
      datasetVersion: versions[0],
      subjects: challengeSubjects.map((subjectDraft) => {
        const subjectName = subjectDraft.subject;
        const rows = selectedChallengeBookmarks.filter(
          (bookmark) => bookmark.subject === subjectName,
        );
        return {
          subject: subjectName,
          numQ: rows.length,
          timeLimitMin: subjectDraft.timeLimitMin,
          questionIds: rows.map((row) => row.id),
          filters: {
            practiceYearCsv: [
              ...new Set(rows.map((row) => row.practiceYear)),
            ].join(","),
            modulesCsv: [
              ...new Set(rows.map((row) => row.module).filter(Boolean)),
            ].join("|"),
          },
        };
      }),
    };
    setSendingChallenge(true);
    setError("");
    try {
      await callFunction(user, "createChallengeHttps", {
        recipients: recipientIds,
        blueprint,
        ttlMinutes: expiryDays * 24 * 60,
        creatorHasPlayed: false,
      });
      setChallengeStep("sent");
      setChallengeDeck({});
    } catch (reason) {
      setError((reason as Error).message);
      setChallengeOpen(false);
    } finally {
      setSendingChallenge(false);
    }
  }

  if (!account || bookmarksLoading) {
    if (!error) {
      return <BrandedLoadingOverlay label="Loading bookmarks" fixed={false} />;
    }
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-slate-600">
        {error || "Loading bookmarks…"}
      </div>
    );
  }

  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
        <Link
          href={`/app/bootcamps/${bootcamp}`}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
            <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
          </span>
          {bootcamp.toUpperCase()} bootcamp
        </Link>

        <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-green/60">
              Review library
            </p>
            <h1 className="mt-2 text-3xl font-black">Bookmarks</h1>
            <p className="mt-2 text-sm text-slate-600">
              Search, organize, review, or turn saved questions into a friendly
              challenge.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!visible.length}
              onClick={() => {
                setFlashcardIndex(0);
                setFlashcardRevealed(false);
                setFlashcardOrder(visible.map((bookmark) => bookmark.id));
                setFlashcardOpen(true);
              }}
              className="min-h-11 rounded-2xl border border-brand-green bg-white px-4 text-sm font-black text-brand-green disabled:opacity-40"
            >
              Flashcard mode
            </button>
            <button
              type="button"
              disabled={!selectedChallengeBookmarks.length || challengeLoading}
              onClick={openChallenge}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-brand-green px-4 text-sm font-black text-white disabled:opacity-60"
            >
              {challengeLoading && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
                  aria-hidden
                />
              )}
              {challengeLoading
                ? "Preparing challenge…"
                : `Challenge squad (${selectedChallengeBookmarks.length})`}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search questions, answers, or modules"
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-brand-mist/45 px-4 text-sm outline-none focus:border-brand-green"
          />
          <div className="mt-4 flex gap-2 overflow-x-auto">
            {["all", ...subjects].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => selectSubject(item)}
                className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${
                  subject === item
                    ? "bg-brand-green text-white"
                    : "bg-brand-mist text-slate-600"
                }`}
              >
                {item === "all" ? "All subjects" : item}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={subject === "all"}
              onClick={() => setShowModuleFilter(true)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40"
            >
              {subject === "all"
                ? "Choose a subject for modules"
                : selectedModules.length
                  ? `Modules (${selectedModules.length})`
                  : "All modules"}
            </button>
            {groups.length > 0 && (
              <select
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"
                aria-label="Filter bookmark group"
              >
                <option value="all">All groups</option>
                {groups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            )}
            <span className="ml-auto self-center text-xs font-bold text-slate-400">
              {visible.length} shown
            </span>
          </div>
        </div>

        {error && (
          <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-4">
          {visible.map((bookmark) => {
            const images = questionImageUrls(
              bookmark.imageSources,
              bookmark.bootcamp,
            );
            const hasReference =
              images.length > 0 || Boolean(bookmark.passage);
            const explanationOpen = Boolean(explanations[bookmark.id]);
            return (
              <article
                key={`${bookmark.datasetVersion}-${bookmark.id}`}
                className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-brand-green">
                      {bookmark.subject}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {bookmark.module || "General"}
                    </p>
                    {(bookmark.groups || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(bookmark.groups || []).map((group) => (
                          <span
                            key={group}
                            className="rounded-full bg-brand-gold/20 px-2 py-1 text-[10px] font-bold text-brand-green"
                          >
                            {group}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setChallengeDeck((current) => ({
                          ...current,
                          [bookmark.id]: !current[bookmark.id],
                        }))
                      }
                      className={`min-h-10 rounded-xl border px-3 text-xs font-bold ${
                        challengeDeck[bookmark.id]
                          ? "border-brand-green bg-brand-green text-white"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {challengeDeck[bookmark.id] ? "In challenge" : "Challenge"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openGroupEditor(bookmark)}
                      className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600"
                    >
                      Groups
                    </button>
                    <button
                      type="button"
                      disabled={
                        removing === bookmark.id || !bookmark.sourceSessionId
                      }
                      onClick={() => removeBookmark(bookmark)}
                      className="group relative grid h-10 w-10 place-items-center rounded-xl border border-brand-gold bg-brand-gold/20 text-lg text-brand-green disabled:opacity-45"
                      aria-label="Remove bookmark"
                    >
                      ★
                      <span className="pointer-events-none absolute -top-9 right-0 hidden whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-lg group-hover:block group-focus-visible:block">
                        Remove bookmark
                      </span>
                    </button>
                  </div>
                </div>

                <p className="mt-5 whitespace-pre-wrap text-lg font-normal leading-8 text-slate-800">
                  {questionText(bookmark.prompt)}
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {bookmark.options.map((option, optionIndex) => (
                    <div
                      key={optionIndex}
                      className={`flex gap-3 rounded-xl border p-3 text-sm leading-6 ${
                        explanationOpen &&
                        bookmark.answerAvailable &&
                        optionIndex === bookmark.correctIndex
                          ? "border-green-300 bg-green-50 text-green-900"
                          : "border-slate-200 bg-brand-mist/45"
                      }`}
                    >
                      <span className="font-black">
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span className="whitespace-pre-wrap">
                        {questionText(option)}
                      </span>
                    </div>
                  ))}
                </div>

                {explanationOpen && (
                  <div className="mt-5 rounded-2xl bg-brand-gold/15 p-5">
                    <p className="text-xs font-black uppercase tracking-wider text-brand-green">
                      Explanation
                    </p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                      {bookmark.answerAvailable ? (
                        questionText(bookmark.explanation || "") ? (
                          <QuestionRichText value={bookmark.explanation || ""} />
                        ) : (
                          "No explanation is available for this question."
                        )
                      ) : (
                        "The answer becomes available after the source drill is submitted."
                      )}
                    </p>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExplanations((current) => ({
                        ...current,
                        [bookmark.id]: !current[bookmark.id],
                      }))
                    }
                    className="min-h-10 rounded-xl bg-brand-green px-4 text-xs font-black text-white"
                  >
                    {explanationOpen ? "Hide explanation" : "Show explanation"}
                  </button>
                  {hasReference && (
                    <button
                      type="button"
                      onClick={() => setReference(bookmark)}
                      className="min-h-10 rounded-xl border border-brand-green px-4 text-xs font-black text-brand-green"
                    >
                      View reference
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {!visible.length && (
          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-lg font-black">No matching bookmarks</p>
            <p className="mt-2 text-sm text-slate-500">
              Adjust the search or filters, or save more questions during a
              drill.
            </p>
          </div>
        )}
      </div>

      {showModuleFilter && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-brand-green/60">
                  {subject}
                </p>
                <h2 className="mt-1 text-xl font-black">Filter modules</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowModuleFilter(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl"
              >
                ×
              </button>
            </div>
            <div className="mt-5 max-h-80 space-y-2 overflow-y-auto">
              {availableModules.map((module) => {
                const checked = selectedModules.includes(module);
                return (
                  <label
                    key={module}
                    className="flex cursor-pointer items-center gap-3 rounded-xl bg-brand-mist p-3 text-sm font-semibold"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedModules((current) =>
                          checked
                            ? current.filter((item) => item !== module)
                            : [...current, module],
                        )
                      }
                      className="h-4 w-4 accent-brand-green"
                    />
                    {module}
                  </label>
                );
              })}
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setSelectedModules([])}
                className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-bold"
              >
                Show all
              </button>
              <button
                type="button"
                onClick={() => setShowModuleFilter(false)}
                className="min-h-11 flex-1 rounded-xl bg-brand-green text-sm font-black text-white"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {reference && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-brand-green/60">
                  Reference
                </p>
                <p className="mt-1 text-sm font-bold">{reference.subject}</p>
              </div>
              <button
                type="button"
                onClick={() => setReference(null)}
                className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl"
                aria-label="Close reference"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(90vh-5rem)] space-y-5 overflow-y-auto p-5 sm:p-7">
              {questionImageUrls(
                reference.imageSources,
                reference.bootcamp,
              ).map(
                (image, imageIndex) => (
                  <img
                    key={image}
                    src={image}
                    alt={`Question reference ${imageIndex + 1}`}
                    className="mx-auto max-h-[62vh] max-w-full rounded-2xl object-contain"
                  />
                ),
              )}
              {reference.passage && (
                <div className="whitespace-pre-wrap rounded-2xl bg-brand-mist p-5 text-base leading-8 text-slate-700">
                  {questionText(reference.passage)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {flashcardOpen && flashcard && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-brand-green p-4">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center py-4">
            <div className="mb-4 flex items-center justify-between text-white">
              <div className="flex items-center gap-3">
                <p className="text-sm font-bold">
                  Card {flashcardIndex + 1} of {flashcards.length}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const currentId = flashcard.id;
                    const shuffled = [...flashcardOrder];
                    for (
                      let index = shuffled.length - 1;
                      index > 0;
                      index -= 1
                    ) {
                      const swapIndex = Math.floor(
                        Math.random() * (index + 1),
                      );
                      [shuffled[index], shuffled[swapIndex]] = [
                        shuffled[swapIndex],
                        shuffled[index],
                      ];
                    }
                    let nextIndex = flashcardIndex;
                    if (shuffled.length > 1) {
                      nextIndex =
                        (flashcardIndex +
                          1 +
                          Math.floor(Math.random() * (shuffled.length - 1))) %
                        shuffled.length;
                      if (shuffled[nextIndex] === currentId) {
                        const replacement = shuffled.findIndex(
                          (id) => id !== currentId,
                        );
                        [shuffled[nextIndex], shuffled[replacement]] = [
                          shuffled[replacement],
                          shuffled[nextIndex],
                        ];
                      }
                    }
                    setFlashcardOrder(shuffled);
                    setFlashcardIndex(nextIndex);
                    setFlashcardRevealed(false);
                  }}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-black hover:bg-white/20"
                  aria-label="Shuffle flashcards"
                >
                  🎲 Shuffle
                </button>
              </div>
              <button
                type="button"
                onClick={() => setFlashcardOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl"
                aria-label="Close flashcard mode"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(100vh-12rem)] min-h-[430px] overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl sm:p-10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-wider text-brand-green">
                  {flashcard.subject} · {flashcard.module || "General"}
                </p>
                {flashcardHasReference && (
                  <button
                    type="button"
                    onClick={() => setReference(flashcard)}
                    className="min-h-10 rounded-xl border border-brand-green/20 bg-brand-mist px-4 text-xs font-black text-brand-green"
                  >
                    View reference
                  </button>
                )}
              </div>
              <p className="mt-6 whitespace-pre-wrap text-xl leading-9 text-slate-800">
                {questionText(flashcard.prompt)}
              </p>
              {flashcardRevealed ? (
                <div className="mt-7">
                  {flashcard.answerAvailable &&
                    Number.isInteger(flashcard.correctIndex) && (
                      <div className="rounded-2xl border border-green-300 bg-green-50 p-5">
                        <p className="text-xs font-black uppercase tracking-wider text-green-800">
                          Correct answer
                        </p>
                        <p className="mt-2 text-base leading-7 text-green-950">
                          {String.fromCharCode(
                            65 + Number(flashcard.correctIndex),
                          )}
                          .{" "}
                          {questionText(
                            flashcard.options[
                              Number(flashcard.correctIndex)
                            ],
                          )}
                        </p>
                      </div>
                    )}
                  <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-600">
                    {flashcard.answerAvailable ? (
                      questionText(flashcard.explanation || "") ? (
                        <QuestionRichText value={flashcard.explanation || ""} />
                      ) : (
                        "No explanation is available."
                      )
                    ) : (
                      "Answer feedback is available after the source drill is submitted."
                    )}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setFlashcardRevealed(true)}
                  className="mt-8 min-h-12 rounded-2xl bg-brand-green px-6 text-sm font-black text-white"
                >
                  Reveal answer
                </button>
              )}
            </div>
            <div className="mt-4 flex justify-between gap-3">
              <button
                type="button"
                disabled={flashcardIndex === 0}
                onClick={() => {
                  setFlashcardIndex((value) => Math.max(0, value - 1));
                  setFlashcardRevealed(false);
                }}
                className="min-h-12 rounded-2xl bg-white px-8 text-sm font-black text-brand-green disabled:opacity-35"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={flashcardIndex === flashcards.length - 1}
                onClick={() => {
                  setFlashcardIndex((value) =>
                    Math.min(flashcards.length - 1, value + 1),
                  );
                  setFlashcardRevealed(false);
                }}
                className="min-h-12 rounded-2xl bg-brand-gold px-8 text-sm font-black text-brand-green disabled:opacity-35"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {groupBookmark && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-black">Organize bookmark</h2>
            <p className="mt-1 text-sm text-slate-500">
              Add this question to one or more groups.
            </p>
            <div className="mt-5 max-h-52 space-y-2 overflow-y-auto">
              {groups.map((group) => {
                const checked = groupDraft.includes(group);
                return (
                  <div
                    key={group}
                    className="flex items-center gap-3 rounded-xl bg-brand-mist p-3 text-sm font-semibold"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setGroupDraft((current) =>
                            checked
                              ? current.filter((item) => item !== group)
                              : [...current, group],
                          )
                        }
                        className="h-4 w-4 accent-brand-green"
                      />
                      <span className="truncate">{group}</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setGroupPendingDelete(group)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${group} group`}
                      title="Delete group"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
            <input
              value={newGroup}
              onChange={(event) => setNewGroup(event.target.value)}
              maxLength={40}
              placeholder="Create a new group"
              className="mt-4 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setGroupBookmark(null)}
                className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveGroups}
                className="min-h-11 flex-1 rounded-xl bg-brand-green text-sm font-black text-white"
              >
                Save 
              </button>
            </div>
          </div>
        </div>
      )}

      {groupPendingDelete && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-semibold">Delete group?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              “{groupPendingDelete}” will be removed from every bookmark in this bootcamp. Your bookmarked questions will remain saved.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={deletingGroup}
                onClick={() => setGroupPendingDelete("")}
                className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingGroup}
                onClick={deleteGroup}
                className="min-h-11 flex-1 rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-50"
              >
                {deletingGroup ? "Deleting…" : "Delete group"}
              </button>
            </div>
          </div>
        </div>
      )}

      {challengeOpen && challengeStep === "summary" && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/55 p-4">
          <div className="mx-auto flex min-h-full max-w-xl items-center py-4">
            <div className="w-full rounded-3xl bg-white p-6 shadow-2xl">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
                Confirm challenge
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                Review the squad drill
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Set a fair time for each subject before choosing who receives
                the challenge.
              </p>

              <div className="mt-5 space-y-3">
                {challengeSubjects.map((subjectDraft) => (
                  <div
                    key={subjectDraft.subject}
                    className="grid gap-3 rounded-2xl bg-brand-mist p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {subjectDraft.subject}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {subjectDraft.questionCount} question
                        {subjectDraft.questionCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <label className="text-xs text-slate-500 sm:text-right">
                      Time allowance
                      <span className="mt-1 flex items-center gap-2">
                        <input
                          type="number"
                          min={5}
                          max={180}
                          value={subjectDraft.timeLimitMin}
                          onChange={(event) => {
                            const value = Math.max(
                              5,
                              Math.min(180, Number(event.target.value) || 5),
                            );
                            setChallengeSubjects((current) =>
                              current.map((item) =>
                                item.subject === subjectDraft.subject
                                  ? {...item, timeLimitMin: value}
                                  : item,
                              ),
                            );
                          }}
                          className="h-10 w-20 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900"
                        />
                        <span>min</span>
                      </span>
                    </label>
                  </div>
                ))}
              </div>

              <label className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4">
                <span>
                  <span className="block text-sm font-medium text-slate-900">
                    Challenge expires in
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Incomplete attempts close automatically.
                  </span>
                </span>
                <select
                  value={expiryDays}
                  onChange={(event) => setExpiryDays(Number(event.target.value))}
                  className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal"
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                </select>
              </label>

              {error && (
                <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </p>
              )}

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setChallengeOpen(false)}
                  className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={challengeLoading || Boolean(error)}
                  onClick={() => setChallengeStep("recipients")}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-green px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {challengeLoading && (
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"
                      aria-hidden
                    />
                  )}
                  {challengeLoading ? "Loading squadmates…" : "Choose squad mates"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {challengeOpen && challengeStep !== "summary" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            {challengeStep === "sent" ? (
              <div className="py-6 text-center">
                <p className="text-3xl">✓</p>
                <h2 className="mt-3 text-2xl font-black">Challenge sent</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Your squadmates have {expiryDays} day
                  {expiryDays === 1 ? "" : "s"} to complete it.
                </p>
                <button
                  type="button"
                  onClick={() => setChallengeOpen(false)}
                  className="mt-6 min-h-11 rounded-xl bg-brand-green px-6 text-sm font-black text-white"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setChallengeStep("summary")}
                  className="mb-2 inline-flex min-h-8 items-center gap-1 text-sm font-medium text-brand-green"
                >
                  <span aria-hidden>‹</span> Challenge details
                </button>
                <h2 className="text-xl font-normal">Challenge squadmates</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedChallengeBookmarks.length} bookmarked question
                  {selectedChallengeBookmarks.length === 1 ? "" : "s"} ·{" "}
                  {expiryDays} day{expiryDays === 1 ? "" : "s"}
                </p>
                <div className="mt-5 max-h-72 space-y-2 overflow-y-auto">
                  {squad.map((member) => {
                    const checked = Boolean(recipients[member.id]);
                    const name =
                      [member.firstName, member.lastName]
                        .filter(Boolean)
                        .join(" ") || "Squadmate";
                    return (
                      <label
                        key={member.id}
                        className="flex cursor-pointer items-center gap-3 rounded-xl bg-brand-mist p-3"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setRecipients((current) => ({
                              ...current,
                              [member.id]: !current[member.id],
                            }))
                          }
                          className="h-4 w-4 accent-brand-green"
                        />
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white p-1">
                          <img
                            src={rankImage(Number(member.rankNum) || 1)}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        </span>
                        <span>
                          <span className="block text-sm font-normal">{name}</span>
                          <span className="text-xs text-slate-500">
                            {member.platoonName || "Squad"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {!squad.length && (
                    <p className="rounded-xl bg-brand-mist p-5 text-center text-sm text-slate-500">
                      No visible squadmates are available.
                    </p>
                  )}
                </div>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setChallengeStep("summary")}
                    className="min-h-11 flex-1 rounded-xl border border-slate-200 text-sm font-normal"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={
                      sendingChallenge ||
                      !Object.values(recipients).some(Boolean)
                    }
                    onClick={sendChallenge}
                    className="min-h-11 flex-1 rounded-xl bg-brand-green text-sm font-medium text-white disabled:opacity-40"
                  >
                    {sendingChallenge ? "Sending…" : "Send challenge"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
