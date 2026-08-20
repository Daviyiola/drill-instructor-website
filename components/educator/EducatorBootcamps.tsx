"use client";

import Link from "next/link";
import {useAuth} from "@/components/app/AuthProvider";
import {bootcampFullName} from "@/lib/bootcamps/catalog";

export default function EducatorBootcamps() {
  const {educatorWorkspace: workspace} = useAuth();
  if (!workspace) return null;
  return <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <header>
      {/* <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-green/65">Educator bootcamps</p> */}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{workspace.school.name}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">Manage students, assignments, and performance for each authorized test.</p>
    </header>
    {workspace.bootcamps.length === 0 ? <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No bootcamps have been assigned to your educator account.</div> :
      <div className="mt-8 grid gap-5 md:grid-cols-2">{workspace.bootcamps.map((bootcamp) => <Link key={bootcamp} href={`/app/educator/bootcamps/${bootcamp}`} className="group relative min-h-64 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-soft">
        <img src={`/app-assets/bootcamp-${bootcamp}.png`} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
        <div className="absolute inset-x-0 bottom-0 p-6 text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]"><p className="text-xs uppercase tracking-[.18em] text-brand-gold">Bootcamp</p><h2 className="mt-2 text-4xl font-semibold">{bootcamp.toUpperCase()}</h2><p className="mt-2 text-sm text-white/90">{bootcampFullName(bootcamp)}</p></div>
      </Link>)}</div>}
  </div>;
}
