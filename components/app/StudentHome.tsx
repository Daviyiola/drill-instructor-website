"use client";

import { signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { callFunction } from "@/lib/api/client";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {bootcampFullName} from "@/lib/bootcamps/catalog";
import type {
  BootcampSummary,
} from "@/lib/types/account";
import AppShell from "./AppShell";
import { useAuth } from "./AuthProvider";
import EmailVerificationCard from "./EmailVerificationCard";

function bootcampId(value: string | BootcampSummary) {
  return typeof value === "string" ? value : value.id;
}

function bootcampName(value: string | BootcampSummary) {
  const id = bootcampId(value);
  if (typeof value !== "string" && value.name) return value.name;
  return id.toUpperCase();
}

export default function StudentHome() {
  const router = useRouter();
  const {
    user,
    loading,
    configured,
    account,
    bootcamps,
    appDataLoading,
    appDataError,
    updateBootcamps,
  } = useAuth();
  const [updatingBootcamp, setUpdatingBootcamp] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  const visible = useMemo(() => {
    if (!bootcamps) return [];
    const allowed = new Set(bootcamps.visibleBootcamps);
    return bootcamps.availableBootcamps.filter((item) =>
      allowed.has(bootcampId(item)),
    );
  }, [bootcamps]);

  async function hideBootcamp(id: string) {
    if (!user || !bootcamps) return;
    setUpdatingBootcamp(id);
    try {
      const result = await callFunction<{
        ok: true;
        visibleBootcamps: string[];
      }, { bootcamp: string; visible: boolean }>(
        user,
        "setBootcampVisibilityHttps",
        { bootcamp: id, visible: false },
      );
      updateBootcamps({
        ...bootcamps,
        visibleBootcamps: result.visibleBootcamps,
      });
    } finally {
      setUpdatingBootcamp("");
    }
  }

  if (!configured || loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-6">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-2xl bg-brand-green" />
          <p className="mt-4 text-sm font-semibold text-slate-600">
            Preparing your training ground…
          </p>
        </div>
      </div>
    );
  }

  if ((!account || !bootcamps) && appDataError) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-6">
        <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-7 text-center shadow-soft">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-gold/25 font-black text-brand-green">
            !
          </div>
          <h1 className="mt-5 text-xl font-bold">We couldn’t load your account</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{appDataError}</p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-12 rounded-2xl bg-brand-green px-5 text-sm font-bold text-white"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={async () => {
                await signOut(getFirebaseAuth());
                router.replace("/app/sign-in");
              }}
              className="min-h-12 rounded-2xl border border-slate-200 px-5 text-sm font-bold text-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (appDataLoading || !account || !bootcamps) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-6">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-2xl bg-brand-green" />
          <p className="mt-4 text-sm font-semibold text-slate-600">
            Preparing your training ground…
          </p>
        </div>
      </div>
    );
  }

  if (account.role !== "student") {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-6 text-center text-sm text-slate-600">
        This account is registered as an educator. The educator workspace will
        be connected during the educator implementation phase.
      </div>
    );
  }

  const firstName = account.profile.firstName || "Student";

  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {/* <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green/65">
              Student command center
            </p> */}
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Welcome back, {firstName}.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Choose a bootcamp to begin training.
            </p>
          </div>
          <Link
            href="/app/bootcamps"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-brand-green px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-darkolive"
          >
            + Add test type
          </Link>
        </header>

        {!account.emailVerified && <div className="mt-6"><EmailVerificationCard compact /></div>}

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Your bootcamps</h2>
            <span className="rounded-full bg-brand-gold/25 px-3 py-1 text-xs font-bold text-brand-green">
              {visible.length} active
            </span>
          </div>

          {visible.length ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((item) => {
                const id = bootcampId(item);
                const entitled = bootcamps.entitledBootcamps.includes(id);
                return (
                  <div
                    key={id}
                    className="group relative min-h-64 overflow-hidden rounded-[2rem] bg-slate-900 text-left text-white shadow-soft"
                  >
                    <img
                      src={`/app-assets/bootcamp-${id}.png`}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                    <Link
                      href={`/app/bootcamps/${id}`}
                      className="absolute inset-0 z-10 rounded-[2rem] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-brand-gold"
                      aria-label={`Open ${bootcampName(item)} bootcamp`}
                    />
                    <div className="pointer-events-none relative flex h-full flex-col p-6 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">
                          {entitled ? "Full access" : "Practice access"}
                        </span>
                      </div>
                      <div className="mt-auto">
                        <h3 className="mt-2 text-4xl font-black tracking-tight">
                          {bootcampName(item)}
                        </h3>
                        <p className="mt-3 text-sm font-medium leading-5 text-white/75">
                          {bootcampFullName(id)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={updatingBootcamp === id}
                      onClick={() => hideBootcamp(id)}
                      className="absolute right-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/45 text-lg text-white backdrop-blur hover:bg-red-700 disabled:opacity-50"
                      aria-label={`Hide ${bootcampName(item)} bootcamp`}
                      title="Hide bootcamp"
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[2rem] border border-dashed border-brand-green/30 bg-white p-8 text-center sm:p-12">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-gold/25 text-lg font-black text-brand-green">
                +
              </div>
              <h3 className="mt-5 text-xl font-bold">No bootcamps selected yet</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                Add ACT or SAT to begin.
              </p>
              <Link href="/app/bootcamps" className="mt-5 inline-flex min-h-11 items-center rounded-2xl bg-brand-green px-5 text-sm font-bold text-white">
                Add a bootcamp
              </Link>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
