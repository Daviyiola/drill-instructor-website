import type {Metadata} from "next";
import Link from "next/link";
import {Suspense} from "react";
import AccountDeletionConfirmForm from "@/components/AccountDeletionConfirmForm";
import BrandLogo from "@/components/BrandLogo";

export const metadata: Metadata = {
  title: "Confirm Account Deletion",
  description: "Confirm permanent deletion of your Drill Instructor account.",
};

export default function ConfirmAccountDeletionPage() {
  return (
    <main className="min-h-screen bg-brand-mist px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <div className="flex justify-center"><Link href="/" aria-label="Drill Instructor home"><BrandLogo size={48} /></Link></div>
        <header className="mt-9 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-red-700/70">Final confirmation</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Confirm account deletion</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">Review the consequences carefully before continuing.</p>
        </header>
        <div className="mt-7">
          <Suspense fallback={<div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-sm text-slate-600">Loading confirmation…</div>}>
            <AccountDeletionConfirmForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
