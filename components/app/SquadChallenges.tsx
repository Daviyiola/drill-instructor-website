"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useMemo, useState} from "react";
import {ApiError, callFunction} from "@/lib/api/client";
import type {ResolvedAccount} from "@/lib/types/account";
import type {
  ChallengeStage,
  DrillSession,
  StudentChallengeDetail,
  StudentChallengeParticipant,
  StudentChallengeResult,
  StudentChallengeRow,
} from "@/lib/types/drill";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";
import {avatarAssetUrl} from "@/lib/profile/avatars";

const stages: Array<{id: ChallengeStage; label: string}> = [
  {id: "incoming", label: "Incoming"},
  {id: "accepted", label: "Accepted"},
  {id: "completed", label: "Completed"},
];

const stageStyles: Record<ChallengeStage, {bar: string; badge: string}> = {
  incoming: {bar: "bg-sky-600", badge: "bg-sky-50 text-sky-800"},
  accepted: {bar: "bg-green-700", badge: "bg-green-50 text-green-800"},
  completed: {bar: "bg-purple-700", badge: "bg-purple-50 text-purple-800"},
};

function relativeExpiry(value: string) {
  const milliseconds = Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "Expired";
  const hours = Math.floor(milliseconds / 3600000);
  if (hours >= 24) {
    const days = Math.ceil(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} left`;
  }
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} left`;
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000));
  return `${minutes} min left`;
}

function duration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function challengeSummaryText(row: StudentChallengeRow) {
  const subjects = Math.max(0, Number(row.subjectCount || 0));
  const questions = Math.max(0, Number(row.questionCount || 0));
  const minutes = Math.max(0, Number(row.totalTimeMin || 0));
  return [
    `${subjects} ${subjects === 1 ? "subject" : "subjects"}`,
    `${questions} ${questions === 1 ? "question" : "questions"}`,
    `${minutes} min`,
  ].join(" · ");
}

function accuracyColor(accuracy: number) {
  if (accuracy >= 70) return "#4B5320";
  if (accuracy >= 45) return "#E8B44B";
  return "#B42318";
}

function participantStatusLabel(participant: StudentChallengeParticipant) {
  if (participant.completed) return "Completed";
  if (participant.status === "not_completed") return "Not completed";
  if (participant.status === "declined") return "Declined";
  if (participant.status === "accepted") return "Accepted";
  if (participant.status === "pending") return "Invited";
  return "Waiting";
}

function ParticipantTracker({
  participants,
  canReinvite,
  reinvitingId,
  onReinvite,
}: {
  participants: StudentChallengeParticipant[];
  canReinvite: boolean;
  reinvitingId: string;
  onReinvite: (participant: StudentChallengeParticipant) => void;
}) {
  if (!participants.length) return null;
  const completeCount = participants.filter((row) => row.completed).length;
  return (
    <section className="mt-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-green/60">
            Your challenge
          </p>
          <h3 className="mt-1 text-base font-semibold">Squad progress</h3>
        </div>
        <p className="text-sm text-slate-500">
          {completeCount} of {participants.length} completed
        </p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {participants.map((participant) => (
          <div
            key={participant.customId}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"
          >
            <img
              src={avatarAssetUrl(participant.avatarNumber)}
              alt=""
              className="h-11 w-11 rounded-xl bg-brand-mist object-contain"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {participant.displayName}
                {participant.role === "creator" && (
                  <span className="ml-1 text-xs font-normal text-slate-400">
                    (you)
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {participant.currentRank || "Squad member"}
              </p>
            </div>
            <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                  participant.completed
                    ? "bg-green-50 text-green-800"
                    : participant.status === "declined" ||
                        participant.status === "not_completed"
                      ? "bg-red-50 text-red-700"
                      : "bg-amber-50 text-amber-800"
                }`}
              >
                {participantStatusLabel(participant)}
              </span>
              {canReinvite && participant.status === "declined" &&
                participant.reinviteCount < 2 && (
                <button
                  type="button"
                  disabled={reinvitingId === participant.customId}
                  onClick={() => onReinvite(participant)}
                  className="text-xs font-semibold text-brand-green underline decoration-1 underline-offset-2 disabled:opacity-50"
                >
                  {reinvitingId === participant.customId
                    ? "Re-inviting…"
                    : "Re-invite"}
                </button>
              )}
              {participant.status === "declined" &&
                participant.reinviteCount >= 2 && (
                  <span className="text-[10px] text-slate-400">
                    Re-invite limit reached
                  </span>
                )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ParticipantResultModal({
  result,
  onClose,
}: {
  result: StudentChallengeResult;
  onClose: () => void;
}) {
  const [breakdownMode, setBreakdownMode] = useState<"subject" | "module">(
    "subject",
  );
  const accuracy = result.attempted
    ? Math.round((result.correct / result.attempted) * 100)
    : 0;
  const breakdowns = breakdownMode === "subject"
    ? result.subjects
    : result.modules;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/70 p-4">
      <div className="mx-auto flex min-h-full w-full max-w-4xl items-center py-5">
        <section className="w-full overflow-hidden rounded-[2rem] bg-white shadow-2xl">
          <header className="bg-brand-green p-6 text-white sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <img
                  src={avatarAssetUrl(result.avatarNumber)}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-2xl bg-white/10 object-contain"
                />
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/65">
                    Participant result
                  </p>
                  <h2 className="mt-1 truncate text-2xl font-semibold">
                    {result.displayName}
                  </h2>
                  <p className="mt-1 text-sm text-white/70">
                    {result.currentRank || "Squad member"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-xl"
                aria-label="Close participant result"
              >
                ×
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Accuracy", `${accuracy}%`],
                ["Score", `${result.correct}/${result.attempted}`],
                ["Points", String(result.points)],
                ["Total time", duration(result.usedSec)],
                ["Avg / question", duration(result.averageTimeSec)],
                ["Unanswered", String(result.unanswered)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-white/10 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-white/60">
                    {label}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </header>

          <div className="p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold">Breakdown</h3>
              <div className="grid grid-cols-2 rounded-xl bg-brand-mist p-1">
                {(["subject", "module"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setBreakdownMode(mode)}
                    className={`rounded-lg px-4 py-2 text-xs font-medium capitalize ${
                      breakdownMode === mode
                        ? "bg-white text-brand-green shadow-sm"
                        : "text-slate-500"
                    }`}
                  >
                    {mode}s
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {breakdowns.map((row, index) => {
                const rowAccuracy = row.attempted
                  ? Math.round((row.correct / row.attempted) * 100)
                  : 0;
                return (
                  <div
                    key={`${row.subject}-${row.module || "subject"}-${index}`}
                    className="grid grid-cols-2 gap-x-5 gap-y-3 rounded-2xl border border-slate-200 bg-brand-mist p-4 sm:grid-cols-[minmax(0,1fr)_repeat(4,auto)] sm:items-center sm:gap-7"
                  >
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <p className="truncate text-sm font-medium">
                        {row.module || row.subject || "General"}
                      </p>
                      {row.module && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {row.subject}
                        </p>
                      )}
                    </div>
                    {[
                      ["Score", `${row.correct}/${row.attempted}`],
                      ["Accuracy", `${rowAccuracy}%`],
                      ["Time", duration(row.usedSec)],
                      ["Avg", duration(row.averageTimeSec)],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[10px] uppercase text-slate-400">
                          {label}
                        </p>
                        <p className="mt-0.5 text-sm font-medium">{value}</p>
                      </div>
                    ))}
                  </div>
                );
              })}
              {!breakdowns.length && (
                <p className="rounded-2xl bg-brand-mist p-6 text-center text-sm text-slate-500">
                  No {breakdownMode} breakdown was recorded for this result.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function SquadChallenges({bootcamp}: {bootcamp: string}) {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [rows, setRows] = useState<StudentChallengeRow[]>([]);
  const [stage, setStage] = useState<ChallengeStage>("incoming");
  const [selected, setSelected] = useState<StudentChallengeRow | null>(null);
  const [detail, setDetail] = useState<StudentChallengeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [reinviteTarget, setReinviteTarget] =
    useState<StudentChallengeParticipant | null>(null);
  const [reinvitingId, setReinvitingId] = useState("");
  const [selectedResult, setSelectedResult] =
    useState<StudentChallengeResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [blockTarget, setBlockTarget] = useState<StudentChallengeRow | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  async function loadChallenges() {
    if (!user) return;
    setError("");
    try {
      const [nextAccount, response] = await Promise.all([
        callFunction<ResolvedAccount>(
          user,
          "resolveSignInAccountHttps",
          {preferredRole: "student"},
        ),
        callFunction<
          {ok: true; challenges: StudentChallengeRow[]},
          {bootcamp: string}
        >(user, "getStudentChallengesHttps", {bootcamp}),
      ]);
      setAccount(nextAccount);
      setRows(response.challenges);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        router.replace(`/app/bootcamps/${bootcamp}/subscription`);
        return;
      }
      setError((reason as Error).message);
    }
  }

  useEffect(() => {
    void loadChallenges();
  }, [user, bootcamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(
    () => rows.filter((row) => row.stage === stage),
    [rows, stage],
  );

  async function openDetail(row: StudentChallengeRow) {
    if (!user) return;
    setSelected(row);
    if (row.stage === "incoming") return;
    setDetailLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await callFunction<
        {ok: true; challenge: StudentChallengeDetail},
        {challengeId: string}
      >(user, "getStudentChallengeHttps", {
        challengeId: row.challengeId,
      });
      setDetail(response.challenge);
    } catch (reason) {
      setError((reason as Error).message);
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function reinviteParticipant() {
    if (!user || !selected || !reinviteTarget) return;
    const recipient = reinviteTarget;
    setReinvitingId(recipient.customId);
    setError("");
    setNotice("");
    try {
      const response = await callFunction<
        {ok: true; state: "pending"; reinviteCount: number},
        {challengeId: string; recipientCustomId: string}
      >(user, "reinviteStudentChallengeParticipantHttps", {
          challengeId: selected.challengeId,
          recipientCustomId: recipient.customId,
        });
      setDetail((current) =>
        current
          ? {
              ...current,
              participants: current.participants.map((participant) =>
                participant.customId === recipient.customId
                  ? {
                      ...participant,
                      status: "pending",
                      completed: false,
                      reinviteCount: response.reinviteCount,
                    }
                  : participant,
              ),
            }
          : current,
      );
      setNotice(`${recipient.displayName} has been invited again.`);
      setReinviteTarget(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setReinvitingId("");
    }
  }

  async function decide(decision: "accept" | "reject") {
    if (!user || !selected) return;
    setMutating(true);
    setError("");
    try {
      await callFunction(user, "decideChallengeHttps", {
        challengeId: selected.challengeId,
        decision,
        ...(decision === "reject" ? {reason: "user_declined"} : {}),
      });
      setSelected(null);
      if (decision === "accept") setStage("accepted");
      await loadChallenges();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMutating(false);
    }
  }

  async function blockSender() {
    if (!user || !blockTarget || mutating) return;
    setMutating(true);
    setError("");
    try {
      await callFunction(user, "blockStudentHttps", {
        studentId: blockTarget.senderCustomId,
      });
      setBlockTarget(null);
      setSelected(null);
      setNotice("This account has been blocked.");
      await loadChallenges();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMutating(false);
    }
  }

  async function startChallenge() {
    if (!user || !detail) return;
    setMutating(true);
    setError("");
    try {
      const response = await callFunction<
        {ok: true; session: DrillSession},
        {challengeId: string}
      >(user, "createStudentChallengeSessionHttps", {
        challengeId: detail.challengeId,
      });
      localStorage.setItem(
        `di.activeSession.${response.session.bootcamp}`,
        response.session.sessionId,
      );
      router.push(`/app/drills/${response.session.sessionId}`);
    } catch (reason) {
      setError((reason as Error).message);
      setMutating(false);
    }
  }

  if (!account) {
    if (!error) {
      return (
        <BrandedLoadingOverlay
          label="Loading friendly challenges"
          fixed={false}
        />
      );
    }
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-slate-600">
        {error || "Loading squad drills…"}
      </div>
    );
  }

  const emptyCopy = {
    incoming: [
      "No incoming challenges",
      "When a squad mate challenges you, it will appear here.",
    ],
    accepted: [
      "Nothing accepted yet",
      "Challenges you accept and challenges you send appear here.",
    ],
    completed: [
      "No completed challenges yet",
      "Finished and expired challenge scoreboards appear here.",
    ],
  }[stage];

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

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-green/60">
              Train together
            </p>
            <h1 className="mt-2 text-3xl font-black">Squad Drills</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
              Accept friendly challenges, finish the same question set, and
              compare results when everyone is done.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadChallenges()}
            className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-brand-green"
          >
            Refresh
          </button>
        </div>

        <div className="mt-7 grid grid-cols-3 rounded-2xl border-2 border-brand-green bg-white p-1">
          {stages.map((item) => {
            const count = rows.filter((row) => row.stage === item.id).length;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setStage(item.id)}
                className={`min-h-12 rounded-xl px-3 text-xs font-black uppercase tracking-wider transition sm:text-sm ${
                  stage === item.id
                    ? "bg-brand-green text-white"
                    : "text-slate-500"
                }`}
              >
                {item.label}
                {count > 0 && (
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${
                      stage === item.id
                        ? "bg-white/15 text-white"
                        : "bg-brand-mist text-slate-600"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        )}

        {notice && (
          <p className="mt-5 rounded-2xl bg-green-50 p-4 text-sm text-green-800">
            {notice}
          </p>
        )}

        <div className="mt-6 space-y-4">
          {visible.map((row) => {
            const style = stageStyles[row.stage];
            return (
              <button
                key={row.challengeId}
                type="button"
                onClick={() => void openDetail(row)}
                className="relative w-full overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 pl-7 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft sm:p-6 sm:pl-8"
              >
                <span
                  className={`absolute inset-y-0 left-0 w-2 ${style.bar}`}
                />
                <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <img
                    src={avatarAssetUrl(row.senderAvatarNumber)}
                    alt=""
                    className="h-16 w-16 rounded-2xl bg-brand-mist object-contain"
                  />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {row.role === "sender" ? "Challenge sent" : "From"}
                    </p>
                    <p className="mt-1 truncate text-lg font-black">
                      {row.role === "sender" ? "Your challenge" : row.senderDisplay}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {challengeSummaryText(row)}
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${style.badge}`}
                    >
                      {row.status}
                    </span>
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      {row.stage === "completed"
                        ? `Ended ${new Date(
                            row.completedAt || row.expiresAt,
                          ).toLocaleDateString()}`
                        : relativeExpiry(row.expiresAt)}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {!visible.length && (
          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-xl font-black">{emptyCopy[0]}</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {emptyCopy[1]}
            </p>
            {stage === "incoming" && (
              <Link
                href={`/app/bootcamps/${bootcamp}/bookmarks`}
                className="mt-5 inline-flex min-h-11 items-center rounded-2xl bg-brand-green px-5 text-sm font-black text-white"
              >
                Build a challenge from bookmarks
              </Link>
            )}
          </div>
        )}
      </div>

      {selected?.stage === "incoming" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-7">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-brand-mist">
              <img
                src={avatarAssetUrl(selected.senderAvatarNumber)}
                alt=""
                className="h-16 w-16 object-contain"
              />
            </div>
            <p className="mt-5 text-center text-xs font-black uppercase tracking-[0.18em] text-brand-green/60">
              Challenge invite
            </p>
            <h2 className="mt-2 text-center text-2xl font-black">
              Train with {selected.senderDisplay}?
            </h2>
            <p className="mt-3 text-center text-sm leading-6 text-slate-600">
              You will both answer the same questions. Results unlock after
              everyone finishes or the challenge expires.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={mutating}
                onClick={() => void decide("reject")}
                className="min-h-12 rounded-2xl border border-slate-200 text-sm font-bold text-slate-700"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={mutating}
                onClick={() => void decide("accept")}
                className="min-h-12 rounded-2xl bg-brand-green text-sm font-black text-white disabled:opacity-50"
              >
                {mutating ? "Saving…" : "Accept"}
              </button>
            </div>
            <button
              type="button"
              disabled={mutating}
              onClick={() => setSelected(null)}
              className="mt-3 min-h-10 w-full text-xs font-bold text-slate-400"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={mutating}
              onClick={() => {
                setBlockTarget(selected);
                setSelected(null);
              }}
              className="mt-1 min-h-9 w-full text-xs text-red-700 underline decoration-1 underline-offset-4"
            >
              Block this user
            </button>
          </div>
        </div>
      )}

      {blockTarget && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="block-title" className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-7">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-red-600">Privacy</p>
            <h2 id="block-title" className="mt-2 text-2xl font-semibold text-slate-950">Block {blockTarget.senderDisplay}?</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">This user will no longer be able to find, add, or challenge you. You will also stop seeing each other in shared challenge results.</p>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button type="button" disabled={mutating} onClick={() => setBlockTarget(null)} className="min-h-12 rounded-2xl border border-slate-200 text-sm text-slate-700">Cancel</button>
              <button type="button" disabled={mutating} onClick={() => void blockSender()} className="min-h-12 rounded-2xl bg-red-700 text-sm text-white disabled:opacity-50">{mutating ? "Blocking…" : "Block"}</button>
            </div>
          </section>
        </div>
      )}

      {selected && selected.stage !== "incoming" && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4">
          <div className="mx-auto flex min-h-full w-full max-w-3xl items-center py-5">
            <div className="w-full rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-green/60">
                    {selected.stage === "completed"
                      ? "Challenge results"
                      : "Accepted challenge"}
                  </p>
                  <h2 className="mt-2 text-2xl font-black">
                    {selected.bootcamp.toUpperCase()} squad drill
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setDetail(null);
                  }}
                  className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl"
                  aria-label="Close challenge"
                >
                  ×
                </button>
              </div>

              {detailLoading && (
                <p className="mt-8 text-center text-sm font-semibold text-slate-500">
                  Loading challenge…
                </p>
              )}

              {detail && selected.stage === "accepted" && (
                <>
                  <div className="mt-6 space-y-3">
                    {detail.subjects.map((subject) => (
                      <div
                        key={subject.subject}
                        className="grid gap-3 rounded-2xl bg-brand-mist p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                      >
                        <p className="font-black">{subject.subject}</p>
                        <p className="text-sm text-slate-600">
                          {subject.numQ} questions
                        </p>
                        <p className="text-sm font-bold text-brand-green">
                          {subject.timeLimitMin} min
                        </p>
                      </div>
                    ))}
                  </div>
                  {detail.role === "sender" && (
                    <ParticipantTracker
                      participants={detail.participants}
                      canReinvite={
                        detail.status === "open" &&
                        Date.parse(detail.expiresAt) > Date.now()
                      }
                      reinvitingId={reinvitingId}
                      onReinvite={setReinviteTarget}
                    />
                  )}
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Participants
                      </p>
                      <p className="mt-1 text-xl font-black">
                        {detail.participantCount}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Expires
                      </p>
                      <p className="mt-1 text-sm font-black">
                        {relativeExpiry(detail.expiresAt)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={mutating}
                    onClick={() => void startChallenge()}
                    className="mt-6 min-h-13 w-full rounded-2xl bg-brand-green px-6 text-base font-black text-white disabled:opacity-50"
                  >
                    {mutating
                      ? "Preparing challenge…"
                      : detail.sessionId
                        ? "Resume challenge"
                        : "Start challenge"}
                  </button>
                </>
              )}

              {detail && selected.stage === "completed" && (
                <>
                  {detail.role === "sender" && (
                    <ParticipantTracker
                      participants={detail.participants}
                      canReinvite={
                        detail.status === "open" &&
                        Date.parse(detail.expiresAt) > Date.now()
                      }
                      reinvitingId={reinvitingId}
                      onReinvite={setReinviteTarget}
                    />
                  )}
                  {detail.results.length ? (
                    <div className="mt-6 space-y-3">
                      {detail.results.map((result, index) => {
                        const accuracy = result.attempted
                          ? Math.round(
                              (result.correct / result.attempted) * 100,
                            )
                          : 0;
                        const accent = accuracyColor(accuracy);
                        return (
                          <div
                            key={result.customId}
                            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-brand-mist p-4 pl-6"
                          >
                            <span
                              className="absolute inset-y-0 left-0 w-1.5"
                              style={{backgroundColor: accent}}
                            />
                            <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,auto)_auto] sm:items-center sm:gap-5">
                              <div className="col-span-3 flex min-w-0 items-center gap-3 sm:col-span-1">
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-xs font-black text-brand-green">
                                  {index + 1}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate font-black">
                                    {result.displayName}
                                  </p>
                                  <p className="truncate text-xs text-slate-500">
                                    {result.currentRank || "Squad member"}
                                  </p>
                                </div>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-slate-400">
                                  Score
                                </p>
                                <p className="font-normal">
                                  {result.correct}/{result.attempted}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-slate-400">
                                  Accuracy
                                </p>
                                <p className="font-normal">{accuracy}%</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-slate-400">
                                  Time
                                </p>
                                <p className="font-normal">
                                  {duration(result.usedSec)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedResult(result)}
                                className="col-span-3 min-h-10 rounded-xl border border-brand-green/25 bg-white px-3 text-xs font-medium text-brand-green sm:col-span-1"
                              >
                                View details
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-6 rounded-2xl bg-brand-mist p-6 text-center">
                      <p className="font-black">Results are still locked</p>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        The scoreboard appears when everyone completes the
                        challenge or it expires.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {reinviteTarget && selected && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4">
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-7">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-mist">
              <img
                src={avatarAssetUrl(reinviteTarget.avatarNumber)}
                alt=""
                className="h-14 w-14 object-contain"
              />
            </div>
            <p className="mt-5 text-center text-xs font-medium uppercase tracking-[0.16em] text-brand-green/60">
              Re-invite squad mate
            </p>
            <h2 className="mt-2 text-center text-2xl font-semibold">
              Invite {reinviteTarget.displayName} again?
            </h2>
            <p className="mt-3 text-center text-sm leading-6 text-slate-600">
              Their declined invitation will return to the incoming tab. The
              questions and original challenge deadline will stay the same.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={Boolean(reinvitingId)}
                onClick={() => setReinviteTarget(null)}
                className="min-h-12 rounded-2xl border border-slate-200 text-sm font-semibold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(reinvitingId)}
                onClick={() => void reinviteParticipant()}
                className="min-h-12 rounded-2xl bg-brand-green text-sm font-semibold text-white disabled:opacity-50"
              >
                {reinvitingId ? "Re-inviting…" : "Send again"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedResult && (
        <ParticipantResultModal
          result={selectedResult}
          onClose={() => setSelectedResult(null)}
        />
      )}
    </AppShell>
  );
}
