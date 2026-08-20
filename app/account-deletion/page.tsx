import type {Metadata} from "next";
import Link from "next/link";
import AccountDeletionRequestForm from "@/components/AccountDeletionRequestForm";
import BrandLogo from "@/components/BrandLogo";

export const metadata: Metadata = {
  title: "Delete Your Account",
  description: "Request deletion of your Drill Instructor account and associated personal data.",
};

export default function AccountDeletionPage() {
  return (
    <main className="min-h-screen bg-brand-mist px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-700 transition hover:text-brand-green">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm" aria-hidden="true">
              <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
            </span>
            Back
          </Link>
          <Link href="/" aria-label="Drill Instructor home"><BrandLogo size={42} /></Link>
        </div>

        <header className="mt-10">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-green/65">Account and data</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Delete your Drill Instructor account</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
            If you can sign in, deleting your account from Profile is faster. Use this page if you no longer have the app or cannot access that screen.
          </p>
        </header>

        <section className="mt-7 grid gap-4 sm:grid-cols-2">
          <InfoCard title="What is deleted" text="Your authentication account, profile, personal practice records, bookmarks, social connections, and account entitlements." />
          <InfoCard title="What may be retained" text="Limited billing, security, backup, or school-controlled education records when legally or operationally required." />
        </section>

        <div className="mt-7"><AccountDeletionRequestForm /></div>

        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
          Cancel active Google Play, Apple, or other externally managed subscriptions with that provider before deleting your account. Account deletion alone may not stop external billing.
        </div>

        <p className="mt-6 text-center text-sm text-slate-600">
          Need help? <Link href="/support" className="font-medium text-brand-green underline underline-offset-4">Contact support</Link> or review our <Link href="/privacy" className="font-medium text-brand-green underline underline-offset-4">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}

function InfoCard({title, text}: {title: string; text: string}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-medium text-slate-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}
