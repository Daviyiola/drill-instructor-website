"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {callFunction} from "@/lib/api/client";
import type {ResolvedAccount} from "@/lib/types/account";
import type {DrillHistoryRow} from "@/lib/types/drill";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";

function duration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [
    ...(hours ? [String(hours).padStart(2, "0")] : []),
    String(minutes).padStart(2, "0"),
    String(remainder).padStart(2, "0"),
  ].join(":");
}

function accuracyColor(accuracy: number) {
  if (accuracy >= 70) return "#4B5320";
  if (accuracy >= 45) return "#C49124";
  return "#B42318";
}

export default function TestRecords({bootcamp}: {bootcamp: string}) {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [records, setRecords] = useState<DrillHistoryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      callFunction<ResolvedAccount>(user, "resolveSignInAccountHttps", {
        preferredRole: "student",
      }, {retryTransient: true}),
      callFunction<
        {ok: true; history: DrillHistoryRow[]; nextCursor: string | null},
        {bootcamp: string; limit: number}
      >(user, "getStudentDrillHistoryHttps", {bootcamp, limit: 25}, {retryTransient: true}),
    ])
      .then(([nextAccount, response]) => {
        setAccount(nextAccount);
        setRecords(response.history);
        setNextCursor(response.nextCursor || null);
      })
      .catch((reason) => setError((reason as Error).message));
  }, [bootcamp, user]);

  async function loadMoreRecords() {
    if (!user || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const response = await callFunction<
        {ok: true; history: DrillHistoryRow[]; nextCursor: string | null},
        {bootcamp: string; limit: number; cursor: string}
      >(user, "getStudentDrillHistoryHttps", {
        bootcamp,
        limit: 25,
        cursor: nextCursor,
      });
      setRecords((current) => [...current, ...response.history]);
      setNextCursor(response.nextCursor || null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  if (!account) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-slate-600">
        {error || "Loading test records…"}
      </div>
    );
  }

  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10">
        <Link
          href={`/app/bootcamps/${bootcamp}`}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
            <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
          </span>
          {bootcamp.toUpperCase()} bootcamp
        </Link>
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-green/60">
            Training history
          </p>
          <h1 className="mt-2 text-3xl font-black">Test records</h1>
          <p className="mt-2 text-sm text-slate-600">
            Open any completed drill to see its full results.
          </p>
        </div>

        {error && (
          <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-4">
          {records.map((record) => {
            const attempted = Number(record.attempted || 0);
            const scorePending = record.scoreStatus === "pending";
            const correct = scorePending ? 0 : Number(record.correct || 0);
            const accuracy =
              attempted > 0 ? Math.floor((correct / attempted) * 100) : 0;
            const accent = scorePending ? "#E8B44B" : accuracyColor(accuracy);
            return (
              <Link
                key={record.sessionId}
                href={scorePending ? "#" :
                  `/app/drills/${record.sessionId}/results?from=records`}
                aria-disabled={scorePending}
                onClick={(event) => scorePending && event.preventDefault()}
                className="relative block overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 pl-7 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft sm:p-6 sm:pl-8"
                style={{borderColor: accent}}
              >
                <span
                  className="absolute inset-y-0 left-0 w-2"
                  style={{backgroundColor: accent}}
                />
                <div className="grid gap-5 sm:grid-cols-[1fr_repeat(4,minmax(90px,.45fr))] sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black">
                      {new Date(record.takenAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                    {record.source === "assignment" && (
                      <span className="rounded-full bg-brand-mist px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                        Assignment
                      </span>
                    )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(record.takenAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  {[
                    ["Score", scorePending ? "Score pending" :
                      attempted ? `${correct}/${attempted}` : "—"],
                    ["Accuracy", scorePending ? "—" :
                      attempted ? `${accuracy}%` : "—"],
                    ["Time", duration(record.duration_sec)],
                    ["Points", scorePending ? "—" : String(record.points || 0)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {label}
                      </p>
                      <p className="mt-1 text-base font-normal">{value}</p>
                    </div>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>

        {nextCursor && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={loadMoreRecords}
              disabled={loadingMore}
              className="min-h-11 rounded-2xl border border-brand-green/20 bg-white px-6 text-sm font-semibold text-brand-green shadow-sm disabled:opacity-60"
            >
              {loadingMore ? "Loading more…" : "Load more records"}
            </button>
          </div>
        )}

        {!records.length && (
          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-lg font-black">No records found</p>
            <p className="mt-2 text-sm text-slate-500">
              Complete a drill to generate your first test record.
            </p>
            <Link
              href={`/app/bootcamps/${bootcamp}/drills`}
              className="mt-5 inline-flex min-h-11 items-center rounded-2xl bg-brand-green px-5 text-sm font-black text-white"
            >
              Start a drill
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}
