"use client";

import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import {callFunction} from "@/lib/api/client";
import type {ResolvedAccount} from "@/lib/types/account";
import AppShell from "./AppShell";
import BootcampAboutContent from "./BootcampAboutContent";
import {useAuth} from "./AuthProvider";

export default function BootcampAbout({bootcamp}: {bootcamp: string}) {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [error, setError] = useState("");
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
      <BootcampAboutContent bootcamp={bootcamp} backHref={`/app/bootcamps/${bootcamp}`} backLabel={`${name} home`} drillHref={`/app/bootcamps/${bootcamp}/drills`} />
    </AppShell>
  );
}
