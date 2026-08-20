"use client";

import Link from "next/link";
import {useEffect} from "react";
import {useRouter} from "next/navigation";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";
import AppBackLink from "./AppBackLink";
import {useAuth} from "./AuthProvider";

interface DocumentSection {
  title: string;
  body: string[];
}

export default function AppDocumentPage({title, updated, introduction, sections, alternateHref, alternateLabel}: {title: string; updated: string; introduction: string[]; sections: DocumentSection[]; alternateHref: string; alternateLabel: string}) {
  const router = useRouter();
  const {user, loading, account} = useAuth();
  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);
  if (loading || !user || !account) return <BrandedLoadingOverlay label={`Loading ${title.toLowerCase()}`} />;

  return <main className="min-h-screen bg-brand-mist text-slate-950">
    <article className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex items-center justify-between gap-4">
        <AppBackLink />
        <Link href={alternateHref} className="rounded-xl border border-brand-green/30 bg-white px-4 py-2 text-sm font-medium text-brand-green transition hover:bg-brand-green/10">{alternateLabel}</Link>
      </div>
      <p className="mt-7 text-xs font-medium uppercase tracking-[0.2em] text-brand-green/65">Drill Instructor</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm text-slate-500">Last updated: {updated}</p>
      <div className="mt-8 space-y-4 text-slate-700">{introduction.map((paragraph) => <p key={paragraph} className="leading-7">{paragraph}</p>)}</div>
      <div className="mt-10 space-y-7">{sections.map((section) => <section key={section.title} className="border-t border-slate-200 pt-6">
        <h2 className="text-2xl font-medium tracking-tight">{section.title}</h2>
        <div className="mt-3 space-y-3 text-slate-700">{section.body.map((paragraph) => <p key={paragraph} className="leading-7">{paragraph}</p>)}</div>
      </section>)}</div>
    </article>
  </main>;
}
