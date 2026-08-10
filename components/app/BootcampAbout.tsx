"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {bootcampAbout} from "@/lib/bootcamps/about";
import type {ResolvedAccount} from "@/lib/types/account";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";

export default function BootcampAbout({bootcamp}: {bootcamp: string}) {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [error, setError] = useState("");
  const content = bootcampAbout[bootcamp];
  const name = bootcamp.toUpperCase();

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
      <div className="grid min-h-screen place-items-center bg-brand-mist px-6 text-center text-sm text-slate-600">
        {error || `Loading ${name} guide…`}
      </div>
    );
  }

  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <Link
          href={`/app/bootcamps/${bootcamp}`}
          className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-brand-green"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8">
            <path d="m14.5 6.5-5.5 5.5 5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {name} home
        </Link>

        <header className="mt-6 overflow-hidden rounded-[2rem] bg-brand-green px-6 py-8 text-white sm:px-9 sm:py-10">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-brand-gold">
            Bootcamp guide
          </p>
          <h1 className="mt-3 text-4xl font-bold">About {name}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-white/75">
            {content.intro}
          </p>
        </header>

        <div className="mt-6 space-y-3">
          {content.sections.map((section, index) => (
            <details
              key={section.title}
              open={index === 0}
              className="group overflow-hidden rounded-2xl border border-slate-200 bg-white"
            >
              <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 text-base font-medium text-slate-900 marker:hidden sm:px-6">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-mist text-xs text-brand-green">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{section.title}</span>
                <span className="ml-auto text-xl font-normal text-slate-400 transition group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <div className="border-t border-slate-100 px-5 py-5 text-[15px] leading-7 text-slate-600 sm:px-6 sm:pl-[5.5rem]">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="not-first:mt-4">{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul className="mt-4 space-y-2">
                    {section.bullets.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          ))}
        </div>

        <div className="mt-7 flex flex-col gap-3 rounded-2xl border border-brand-green/15 bg-brand-green/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-slate-600">
            Ready to turn the guide into focused practice?
          </p>
          <Link
            href={`/app/bootcamps/${bootcamp}/drills`}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-green px-5 text-sm font-semibold text-white"
          >
            Build a drill
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
