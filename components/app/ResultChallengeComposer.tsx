"use client";

import {useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {rankImage} from "@/lib/ranks";
import type {ResolvedAccount} from "@/lib/types/account";
import type {DrillResult} from "@/lib/types/drill";
import {useAuth} from "./AuthProvider";

interface SquadProfile {
  id: string;
  firstName: string;
  lastName: string;
  platoonName: string;
  rankNum: number;
}

function challengeBlueprint(result: DrillResult) {
  const subjects = [...new Set(result.answers.map((answer) => answer.subject))];
  return {
    bootcamp: result.bootcamp,
    datasetVersion: result.datasetVersion,
    subjects: subjects.map((subject) => {
      const answers = result.answers.filter(
        (answer) => answer.subject === subject,
      );
      const summary = result.subjects.find((row) => row.subject === subject);
      return {
        subject,
        numQ: answers.length,
        timeLimitMin: Math.max(
          5,
          Math.round(Number(summary?.timeLimitSec || 0) / 60) ||
            Math.ceil(answers.length * 1.5),
        ),
        questionIds: answers.map((answer) => answer.id),
        filters: {
          practiceYearCsv: [
            ...new Set(answers.map((answer) => answer.practiceYear)),
          ].join(","),
          modulesCsv: [
            ...new Set(answers.map((answer) => answer.module).filter(Boolean)),
          ].join(","),
        },
      };
    }),
  };
}

export default function ResultChallengeComposer({
  result,
  onClose,
}: {
  result: DrillResult;
  onClose: () => void;
}) {
  const {user} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [squad, setSquad] = useState<SquadProfile[]>([]);
  const [loadingSquad, setLoadingSquad] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expiryDays, setExpiryDays] = useState(1);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const blueprint = useMemo(() => challengeBlueprint(result), [result]);

  useEffect(() => {
    if (!user) return;
    setLoadingSquad(true);
    setError("");
    Promise.all([
      callFunction<ResolvedAccount>(user, "resolveSignInAccountHttps", {
        preferredRole: "student",
      }),
      callFunction<{ok: true; memberIds: string[]}>(
        user,
        "getMySquadMemberIdsHttps",
        {},
      ),
    ])
      .then(async ([nextAccount, memberResponse]) => {
        setAccount(nextAccount);
        const profiles = await callFunction<
          {ok: true; results: SquadProfile[]}
        >(user, "getSquadProfilesHttps", {
          memberIds: memberResponse.memberIds,
          audience: "challenge_picker",
        });
        setSquad(
          profiles.results
            .filter((profile) => profile.id !== nextAccount.customUserId),
        );
      })
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoadingSquad(false));
  }, [user]);

  async function sendChallenge() {
    if (!user) return;
    const recipients = Object.keys(selected).filter((id) => selected[id]);
    if (!recipients.length) return;
    setSending(true);
    setError("");
    try {
      await callFunction(user, "createChallengeHttps", {
        recipients,
        blueprint,
        ttlMinutes: expiryDays * 24 * 60,
        creatorHasPlayed: true,
        creatorSnapshot: result,
        sourceSessionId: result.sessionId,
      });
      setSent(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSending(false);
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 p-4">
      <div className="mx-auto flex min-h-full max-w-2xl items-center py-5">
        <div className="w-full rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
                Friendly challenge
              </p>
              <h2 className="mt-2 text-2xl font-normal">
                Challenge squadmates
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                They will receive the exact question set you just completed.
                Your result is already locked in.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-mist text-xl"
              aria-label="Close challenge sender"
            >
              ×
            </button>
          </div>

          {sent ? (
            <div className="mt-8 rounded-3xl bg-brand-mist p-8 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-green text-2xl text-white">
                ✓
              </div>
              <h3 className="mt-4 text-xl font-black">Challenge sent</h3>
              <p className="mt-2 text-sm text-slate-600">
                It will appear in your Accepted squad drills while your
                squadmates complete it.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 min-h-11 rounded-2xl bg-brand-green px-6 text-sm font-black text-white"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="mt-6 max-h-80 space-y-2 overflow-y-auto">
                {loadingSquad ? (
                  <div className="flex min-h-32 items-center justify-center gap-3 rounded-2xl bg-brand-mist p-5 text-sm text-slate-600">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-green/25 border-t-brand-green" />
                    Loading squadmates…
                  </div>
                ) : squad.map((member) => {
                  const checked = Boolean(selected[member.id]);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() =>
                        setSelected((current) => ({
                          ...current,
                          [member.id]: !current[member.id],
                        }))
                      }
                      className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border p-3 text-left ${
                        checked
                          ? "border-brand-green bg-brand-mist"
                          : "border-slate-200"
                      }`}
                    >
                      <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-mist p-1">
                        <img
                          src={rankImage(Number(member.rankNum) || 1)}
                          alt=""
                          className="h-full w-full object-contain"
                        />
                      </span>
                      <div>
                        <p className="font-normal">
                          {[member.firstName, member.lastName]
                            .filter(Boolean)
                            .join(" ")}
                        </p>
                        <p className="text-xs text-slate-500">
                          {member.platoonName || "Squadmate"}
                        </p>
                      </div>
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-md border text-xs font-medium ${
                          checked
                            ? "border-brand-green bg-brand-green text-white"
                            : "border-slate-300 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    </button>
                  );
                })}
                {account && !squad.length && (
                  <p className="rounded-2xl bg-brand-mist p-6 text-center text-sm leading-6 text-slate-500">
                    Add squad members from Leaderboards before sending a
                    challenge.
                  </p>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand-mist p-4">
                <div>
                  <p className="text-[10px] font-normal uppercase tracking-wider text-slate-400">
                    Challenge expires in
                  </p>
                  <p className="mt-1 text-sm font-normal">
                    {expiryDays} day{expiryDays === 1 ? "" : "s"}
                  </p>
                </div>
                <select
                  value={expiryDays}
                  onChange={(event) =>
                    setExpiryDays(Number(event.target.value))
                  }
                  className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal"
                >
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                </select>
              </div>

              {error && (
                <p className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="button"
                disabled={!selectedCount || sending}
                onClick={() => void sendChallenge()}
                className="mt-5 min-h-12 w-full rounded-2xl bg-brand-green text-sm font-medium text-white disabled:opacity-40"
              >
                {sending
                  ? "Sending…"
                  : `Send challenge${
                      selectedCount ? ` (${selectedCount})` : ""
                    }`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
