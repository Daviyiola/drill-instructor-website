"use client";

import {signOut} from "firebase/auth";
import Link from "next/link";
import {useEffect} from "react";
import {useRouter} from "next/navigation";
import {useAuth} from "@/components/app/AuthProvider";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import {getFirebaseAuth} from "@/lib/firebase/client";
import EducatorShell from "./EducatorShell";

export default function EducatorGate({children}: {children: React.ReactNode}) {
  const router = useRouter();
  const {user, loading, account, educatorWorkspace, appDataLoading, appDataError} = useAuth();
  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
    else if (!loading && account?.role === "student") router.replace("/app");
    else if (!loading && account?.role === "educator" && (account.approvalStatus !== "approved" || !account.emailVerified)) router.replace("/app");
  }, [account, loading, router, user]);

  if (user && account?.role === "educator" && appDataError && !appDataLoading && !educatorWorkspace) {
    return <main className="grid min-h-screen place-items-center bg-brand-mist p-6"><section className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-7 text-center"><p className="text-xs uppercase tracking-[.2em] text-brand-green/60">Educator access</p><h1 className="mt-3 text-2xl font-semibold">Your workspace access changed</h1><p className="mt-3 text-sm leading-6 text-slate-600">{appDataError}. Check with your school administrator, then sign in again after your access is restored.</p><div className="mt-6 grid gap-3 sm:grid-cols-2"><Link href="/support?returnTo=/app" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300">CONTACT SUPPORT</Link><button onClick={async () => { sessionStorage.clear(); await signOut(getFirebaseAuth()); router.replace("/app/sign-in"); }} className="min-h-11 rounded-xl bg-brand-green text-white">SIGN OUT</button></div></section></main>;
  }
  if (!user || loading || appDataLoading || !account || !educatorWorkspace) {
    return <BrandedLoadingOverlay label={appDataError || "Loading educator workspace"} />;
  }
  return <EducatorShell workspace={educatorWorkspace}>{children}</EducatorShell>;
}
