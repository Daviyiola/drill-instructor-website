"use client";

import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {rankForPoints, rankImage, ranks} from "@/lib/ranks";
import type {ResolvedAccount} from "@/lib/types/account";
import AppShell from "./AppShell";
import AppBackLink from "./AppBackLink";
import {useAuth} from "./AuthProvider";
import EducatorShell from "@/components/educator/EducatorShell";

export default function RanksPage() {
  const router = useRouter();
  const {user, loading, educatorWorkspace} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user || educatorWorkspace) return;
    callFunction<ResolvedAccount>(user, "resolveSignInAccountHttps", {
      preferredRole: "student",
    })
      .then(setAccount)
      .catch((reason) => setError((reason as Error).message));
  }, [educatorWorkspace, user]);

  if (!account && !educatorWorkspace) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-slate-600">
        {error || "Loading ranks…"}
      </div>
    );
  }

  const educatorMode = Boolean(educatorWorkspace);
  const points = Number(
    account?.profile.totalPoints || account?.profile.points || 0,
  );
  const current = rankForPoints(points);
  const promotionProgress = current.nextMinimum
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            ((points - current.minimum) /
              (current.nextMinimum - current.minimum)) *
              100,
          ),
        ),
      )
    : 100;

  const content = (
    <>
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

        {!educatorMode && <section className="mt-7 grid items-center gap-6 rounded-[2rem] bg-brand-green p-6 text-white shadow-soft sm:grid-cols-[auto_1fr] sm:p-8">
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
            <div className="mt-5 max-w-xl">
              <div className="flex items-center justify-between gap-3 text-xs text-white/70">
                <span>
                  {current.nextMinimum
                    ? `Progress to ${ranks[current.number]?.name || "next rank"}`
                    : "Highest rank achieved"}
                </span>
                <span>{promotionProgress}%</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-brand-gold transition-[width]"
                  style={{width: `${promotionProgress}%`}}
                />
              </div>
            </div>
          </div>
        </section>}

        <div className="mt-6 space-y-3">
          {ranks.map((rank) => {
            const active = !educatorMode && rank.number === current.number;
            const achieved = educatorMode || points >= rank.minimum;
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
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    {educatorMode ? "Reference" : active ? "Current" : achieved ? "Achieved" : "Keep training"}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
  if (educatorWorkspace) return <EducatorShell workspace={educatorWorkspace}>{content}</EducatorShell>;
  return <AppShell profile={account!.profile}>{content}</AppShell>;
}
