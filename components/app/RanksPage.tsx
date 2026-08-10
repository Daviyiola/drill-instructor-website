"use client";

import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {rankForPoints, rankImage, ranks} from "@/lib/ranks";
import type {ResolvedAccount} from "@/lib/types/account";
import AppShell from "./AppShell";
import AppBackLink from "./AppBackLink";
import {useAuth} from "./AuthProvider";

export default function RanksPage() {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    callFunction<ResolvedAccount>(user, "resolveSignInAccountHttps", {
      preferredRole: "student",
    })
      .then(setAccount)
      .catch((reason) => setError((reason as Error).message));
  }, [user]);

  if (!account) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-slate-600">
        {error || "Loading ranks…"}
      </div>
    );
  }

  const points = Number(
    account.profile.totalPoints || account.profile.points || 0,
  );
  const current = rankForPoints(points);

  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10">
        <AppBackLink className="mb-5" />
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-green/60">
          Promotion path
        </p>
        <h1 className="mt-2 text-3xl font-black">Ranks</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
          Every graded answer earns points. Keep training to rise from Recruit
          to General.
        </p>

        <section className="mt-7 grid items-center gap-6 rounded-[2rem] bg-brand-green p-6 text-white shadow-soft sm:grid-cols-[auto_1fr_auto] sm:p-8">
          <img
            src={rankImage(current.number)}
            alt=""
            className="h-28 w-28 object-contain"
          />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-white/55">
              Current rank
            </p>
            <h2 className="mt-2 text-3xl font-black uppercase">
              {current.name}
            </h2>
            <p className="mt-2 text-sm text-white/70">
              {points.toLocaleString()} total points
            </p>
          </div>
          {current.nextMinimum && (
            <div className="rounded-2xl bg-white/10 p-4 sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                Next promotion
              </p>
              <p className="mt-1 text-xl font-black">
                {(current.nextMinimum - points).toLocaleString()}
              </p>
              <p className="text-xs text-white/60">points remaining</p>
            </div>
          )}
        </section>

        <div className="mt-6 space-y-3">
          {ranks.map((rank) => {
            const active = rank.number === current.number;
            const achieved = points >= rank.minimum;
            return (
              <article
                key={rank.number}
                className={`grid gap-4 rounded-3xl border p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center ${
                  active
                    ? "border-brand-green bg-white shadow-soft"
                    : "border-slate-200 bg-transparent"
                }`}
              >
                <img
                  src={rankImage(rank.number)}
                  alt=""
                  className={`h-20 w-20 object-contain ${
                    achieved ? "" : "grayscale opacity-45"
                  }`}
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black uppercase">
                      {rank.name}
                    </h2>
                    {active && (
                      <span className="rounded-full bg-brand-gold px-2.5 py-1 text-[10px] font-black uppercase text-brand-green">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {rank.description}
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Starts at
                  </p>
                  <p className="mt-1 font-black">
                    {rank.minimum.toLocaleString()} pts
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
