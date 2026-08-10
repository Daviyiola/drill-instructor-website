"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { callFunction } from "@/lib/api/client";
import AppShell from "./AppShell";
import { useAuth } from "./AuthProvider";

const launchBootcamps = ["act", "sat"];

export default function BootcampManager() {
  const router = useRouter();
  const {
    user,
    loading,
    account,
    bootcamps,
    appDataLoading,
    appDataError,
    updateBootcamps,
  } = useAuth();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  async function setVisible(id: string, visible: boolean) {
    if (!user || !bootcamps) return;
    setBusy(id);
    setError("");
    try {
      const result = await callFunction<
        { ok: true; visibleBootcamps: string[] },
        { bootcamp: string; visible: boolean }
      >(user, "setBootcampVisibilityHttps", { bootcamp: id, visible });
      updateBootcamps({
        ...bootcamps,
        visibleBootcamps: result.visibleBootcamps,
      });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (loading || appDataLoading || !account || !bootcamps) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist">
        <p className="text-sm font-semibold text-slate-600">
          {error || "Loading bootcamps…"}
        </p>
      </div>
    );
  }

  const available = launchBootcamps.filter((id) =>
    bootcamps.availableBootcamps.some((item) =>
      typeof item === "string" ? item === id : item.id === id,
    ),
  );

  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <Link href="/app" className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
            <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
          </span>
          Your bootcamps
        </Link>
        <header className="mt-6">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green/65">
            Bootcamp catalog
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Choose your test.
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Add or hide a bootcamp without changing your access or history.
          </p>
        </header>

        {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {available.map((id) => {
            const visible = bootcamps.visibleBootcamps.includes(id);
            return (
              <article key={id} className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-soft">
                <div className="relative h-52">
                  <img src={`/app-assets/bootcamp-${id}.png`} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent" />
                  <h2 className="absolute bottom-5 left-5 text-4xl font-black text-white">{id.toUpperCase()}</h2>
                </div>
                <div className="flex items-center justify-between gap-4 p-5">
                  <div>
                    <p className="font-bold">{visible ? "Added to your bootcamps" : "Available to add"}</p>
                    <p className="mt-1 text-sm text-slate-500">{visible ? "You can hide it from the main page." : "Add it to your main bootcamp page."}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy === id}
                    onClick={() => setVisible(id, !visible)}
                    className={`min-h-11 shrink-0 rounded-2xl px-4 text-sm font-bold disabled:opacity-50 ${
                      visible ? "border border-slate-200 text-slate-700" : "bg-brand-green text-white"
                    }`}
                  >
                    {visible ? "Hide" : "Add"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
