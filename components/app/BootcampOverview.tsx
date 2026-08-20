"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";

export default function BootcampOverview({bootcamp}: {bootcamp: string}) {
  const router = useRouter();
  const {
    user,
    loading,
    account,
    bootcamps,
    appDataLoading,
    appDataError,
  } = useAuth();
  const [activeSessionId, setActiveSessionId] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    setActiveSessionId(
      localStorage.getItem(`di.activeSession.${bootcamp}`) || "",
    );
  }, [bootcamp]);

  if (!account) {
    if (loading || appDataLoading || !appDataError) {
      return <BrandedLoadingOverlay label="Loading bootcamp" fixed={false} />;
    }
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-6 text-center text-sm font-medium text-slate-600">
        {appDataError || "Loading bootcamp…"}
      </div>
    );
  }

  const name = bootcamp.toUpperCase();
  const licensed = bootcamps?.entitledBootcamps.includes(bootcamp) === true;
  const streak = bootcamps?.streaks?.[bootcamp];
  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <Link
          href="/app"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
            <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
          </span>
          Bootcamps
        </Link>

        <section className="relative mt-6 min-h-72 overflow-hidden rounded-[2.25rem] text-white shadow-soft">
          <img
            src={`/app-assets/bootcamp-${bootcamp}.png`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="relative max-w-xl p-7 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)] sm:p-10">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-brand-gold">
              Bootcamp
            </p>
            <h1 className="mt-3 text-5xl font-bold">{name}</h1>
            <p className="mt-4 text-sm leading-6 text-white/75">
              Focused practice, review, and progress for your {name} preparation.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href={`/app/bootcamps/${bootcamp}/about`}
                className="inline-flex min-h-12 items-center rounded-2xl bg-white px-5 text-sm font-semibold text-brand-green"
              >
                About {name}
              </Link>
              <div className="flex min-h-12 items-center gap-4 text-white">
                <div className="flex items-center gap-1.5" aria-label="Current streak">
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    className="h-5 w-5 shrink-0 fill-current"
                  >
                    <path d="M13.1 1.7 4.8 13.1c-.5.7 0 1.6.8 1.6h5l-.7 7c-.1 1.1 1.3 1.6 1.9.7l7.4-11.5c.4-.7-.1-1.5-.9-1.5h-4.5l1.1-6.8c.2-1.1-1.2-1.7-1.8-.9Z" />
                  </svg>
                  <span className="text-lg font-bold leading-none">
                    {streak?.current || 0}
                  </span>
                </div>
                <div className="flex items-center gap-1.5" aria-label="Best streak">
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    className="h-5 w-5 shrink-0 fill-current"
                  >
                    <path d="M18 3h3a1 1 0 0 1 1 1v2c0 3.1-2.2 5.7-5.2 6.3A6 6 0 0 1 13 15.9V19h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.1a6 6 0 0 1-3.8-3.6A6.5 6.5 0 0 1 2 6V4a1 1 0 0 1 1-1h3V2h12v1Zm0 2v4.9A4.5 4.5 0 0 0 20 6V5h-2ZM6 5H4v1a4.5 4.5 0 0 0 2 3.9V5Z" />
                  </svg>
                  <span className="text-lg font-bold leading-none">
                    {streak?.best || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link
            href={
              activeSessionId
                ? `/app/drills/${activeSessionId}`
                : `/app/bootcamps/${bootcamp}/drills`
            }
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-brand-green/60">
              Resume
            </p>
            <p className="mt-3 text-lg font-semibold">
              {activeSessionId ? "Active drill" : "No active drill"}
            </p>
            <p className="mt-2 text-sm leading-5 text-slate-500">
              {activeSessionId
                ? "Continue from your last saved question."
                : "Build a drill to start training."}
            </p>
          </Link>
          <Link
            href={
              licensed
                ? `/app/bootcamps/${bootcamp}/bookmarks`
                : `/app/bootcamps/${bootcamp}/subscription`
            }
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wider text-brand-green/60">
                Bookmarks
              </p>
              {!licensed && (
                <span className="text-xs text-slate-400" aria-label="Subscription required">
                  Locked
                </span>
              )}
            </div>
            <p className="mt-3 text-lg font-semibold">
              {licensed ? "Saved questions" : "Saved questions"}
            </p>
            <p className="mt-2 text-sm leading-5 text-slate-500">
              {licensed
                ? "Saved questions from this bootcamp."
                : "Subscribe to save and organize questions."}
            </p>
          </Link>
          <Link
            href={`/app/bootcamps/${bootcamp}/records`}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-brand-green/60">
              Test records
            </p>
            <p className="mt-3 text-lg font-semibold">
              Drill history
            </p>
            <p className="mt-2 text-sm leading-5 text-slate-500">
              Review past scores and results.
            </p>
          </Link>
          <Link
            href={`/app/bootcamps/${bootcamp}/subscription`}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"
          >
            <p className="text-xs font-medium uppercase tracking-wider text-brand-green/60">
              Subscribe
            </p>
            <p className="mt-3 text-lg font-semibold">Manage Plans</p>
            <p className="mt-2 text-sm leading-5 text-slate-500">
              {licensed
                ? "Your full bootcamp access is active."
                : "Redeem a code or choose a monthly or annual plan."}
            </p>
          </Link>
          <Link
            href={`/app/bootcamps/${bootcamp}/analytics`}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wider text-brand-green/60">
                Analytics
              </p>
            </div>
            <p className="mt-3 text-lg font-semibold">Performance insights</p>
            <p className="mt-2 text-sm leading-5 text-slate-500">
              View trends, timing, and focus areas.
            </p>
          </Link>
          <Link
            href={
              licensed
                ? `/app/bootcamps/${bootcamp}/squad`
                : `/app/bootcamps/${bootcamp}/subscription`
            }
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wider text-brand-green/60">
                Friendly challenge
              </p>
              {!licensed && (
                <span className="text-xs text-slate-400" aria-label="Subscription required">
                  Locked
                </span>
              )}
            </div>
            <p className="mt-3 text-lg font-semibold">
              {licensed ? "Squad Challenges" : "Squad Challenges"}
            </p>
            <p className="mt-2 text-sm leading-5 text-slate-500">
              {licensed
                ? "Accept drills and compare results with your squad."
                : "Subscribe to send and accept squad drills."}
            </p>
          </Link>
          <Link
            href={licensed
              ? `/app/bootcamps/${bootcamp}/assignments`
              : `/app/bootcamps/${bootcamp}/subscription`}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wider text-brand-green/60">Assignments</p>
              {!licensed && <span className="text-xs text-slate-400" aria-label="Subscription required">Locked</span>}
            </div>
            <p className="mt-3 text-lg font-semibold">School drills</p>
            <p className="mt-2 text-sm leading-5 text-slate-500">{licensed ? "Open work assigned by your educators." : "Subscribe to open school assignments."}</p>
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
