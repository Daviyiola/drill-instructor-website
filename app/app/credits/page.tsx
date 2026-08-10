"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";
import AppBackLink from "@/components/app/AppBackLink";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import {useAuth} from "@/components/app/AuthProvider";

const artists = [
  {name: "brgfx", href: "https://www.freepik.com/author/brgfx"},
  {name: "macrovector_official", href: "https://www.freepik.com/author/macrovector-official"},
  {name: "upklyak", href: "https://www.freepik.com/author/upklyak"},
];

export default function Page() {
  const router = useRouter();
  const {user, loading, account} = useAuth();
  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);
  if (loading || !user || !account) return <BrandedLoadingOverlay label="Loading credits" />;

  return <main className="min-h-screen bg-brand-mist px-5 py-10 text-slate-950 sm:px-8 sm:py-14">
    <article className="mx-auto max-w-3xl">
      <AppBackLink />
      <section className="mt-7 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-green/65">Acknowledgements</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Credits</h1>
        <p className="mt-5 leading-7 text-slate-600">Vector and illustration artwork used throughout Drill Instructor is sourced from <a href="https://www.freepik.com" target="_blank" rel="noreferrer" className="font-medium text-brand-green underline underline-offset-4">Freepik</a>. We are grateful to the artists whose work helps bring the training experience to life.</p>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">{artists.map((artist) => <a key={artist.name} href={artist.href} target="_blank" rel="noreferrer" className="rounded-2xl border border-slate-200 px-4 py-4 text-sm font-medium transition hover:border-brand-green hover:bg-brand-mist">{artist.name}<span className="ml-2 text-slate-400" aria-hidden>↗</span></a>)}</div>
      </section>
    </article>
  </main>;
}
