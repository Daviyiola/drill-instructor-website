"use client";

import {onAuthStateChanged, type User} from "firebase/auth";
import Link from "next/link";
import {useEffect, useState} from "react";
import ContactForm from "@/components/ContactForm";
import BrandLogo from "@/components/BrandLogo";
import {callFunction} from "@/lib/api/client";
import {getFirebaseAuth, isFirebaseConfigured} from "@/lib/firebase/client";
import type {ResolvedAccount} from "@/lib/types/account";

export default function SupportPage() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [returnTo, setReturnTo] = useState("/");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("returnTo") === "/app") {
      setReturnTo("/app");
    }
    if (!isFirebaseConfigured()) return;
    return onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      setUser(nextUser);
      if (!nextUser) return;
      setName(nextUser.displayName || "");
      callFunction<ResolvedAccount>(nextUser, "resolveSignInAccountHttps", {
        includeStats: false,
      }, {retryTransient: true})
        .then((account) => {
          setName([account.profile.firstName, account.profile.lastName]
            .filter(Boolean).join(" ") || nextUser.displayName || "");
        })
        .catch(() => {});
    });
  }, []);

  return (
    <main className="min-h-screen bg-brand-mist px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <Link href={returnTo} className="inline-flex items-center gap-2 text-sm text-slate-700 transition hover:text-brand-green">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm" aria-hidden="true">
              <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
            </span>
            Back
          </Link>
          <Link href="/" aria-label="Drill Instructor home"><BrandLogo size={42} /></Link>
        </div>
        <section className="mt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-green/65">Help & support</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">How can we help?</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Send us a message and we’ll respond by email.</p>
          <div className="mt-7"><ContactForm initialName={name} initialEmail={user?.email || ""} firebaseUser={user} /></div>
        </section>
      </div>
    </main>
  );
}
