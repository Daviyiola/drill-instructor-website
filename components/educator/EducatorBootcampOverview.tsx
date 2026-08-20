"use client";

import Link from "next/link";
import {notFound} from "next/navigation";
import {useAuth} from "@/components/app/AuthProvider";

export default function EducatorBootcampOverview({bootcamp}: {bootcamp: string}) {
  const {educatorWorkspace: workspace} = useAuth();
  if (!workspace) return null;
  if (!workspace.bootcamps.includes(bootcamp)) notFound();
  const canAdmin = workspace.caller.adminAccess || workspace.caller.superAdmin;
  const cards = [
    {href: `browse?returnTo=${encodeURIComponent(`/app/educator/bootcamps/${bootcamp}`)}`, eyebrow: "Question Library", title: "Browse questions", detail: "Review explanations and collect questions into a draft."},
    {href: "bookmarks", eyebrow: "Bookmarks", title: "Saved questions", detail: "Return to useful questions and build from your saved list."},
    {href: "students", eyebrow: "Students & Groups", title: "Your roster", detail: "Find students and organize assignment groups."},
    {href: "drills", eyebrow: "Drills", title: "Assignments", detail: "Build, publish, and review educator drills."},
    {href: "analytics", eyebrow: "Analytics", title: "Performance Insights", detail: "Explore student and group progress."},
  ];
  return <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <Link href="/app/educator/bootcamps" className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>Bootcamps</Link>
    <section className="relative mt-6 min-h-72 overflow-hidden rounded-[2.25rem] text-white shadow-soft">
      <img src={`/app-assets/bootcamp-${bootcamp}.png`} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="relative max-w-xl p-7 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)] sm:p-10"><p className="text-xs uppercase tracking-[.24em] text-brand-gold">Educator bootcamp</p><h1 className="mt-3 text-5xl font-semibold">{bootcamp.toUpperCase()}</h1><p className="mt-4 text-sm leading-6 text-white/90">Manage assigned students, publish focused practice, and review performance.</p><Link href={`/app/educator/bootcamps/${bootcamp}/about`} className="mt-7 inline-flex min-h-12 items-center rounded-2xl bg-white px-5 text-sm font-medium text-brand-green drop-shadow-none">About {bootcamp.toUpperCase()}</Link></div>
    </section>
    <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map((card) => <Link key={card.href} href={`/app/educator/bootcamps/${bootcamp}/${card.href}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"><p className="text-xs uppercase tracking-wider text-brand-green/60">{card.eyebrow}</p><p className="mt-3 text-lg font-medium">{card.title}</p><p className="mt-2 text-sm leading-5 text-slate-500">{card.detail}</p></Link>)}
      {canAdmin && <Link href="/app/educator/admin" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-green/30"><p className="text-xs uppercase tracking-wider text-brand-green/60">Administration</p><p className="mt-3 text-lg font-medium">School access</p><p className="mt-2 text-sm leading-5 text-slate-500">Approve educators and manage permissions.</p></Link>}
    </section>
  </div>;
}
