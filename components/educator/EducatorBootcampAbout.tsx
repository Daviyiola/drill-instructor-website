"use client";

import Link from "next/link";
import {bootcampAbout} from "@/lib/bootcamps/about";

export default function EducatorBootcampAbout({bootcamp}: {bootcamp: string}) {
  const content = bootcampAbout[bootcamp];
  const name = bootcamp.toUpperCase();
  return <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10">
    <Link href={`/app/educator/bootcamps/${bootcamp}`} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>{name} dashboard</Link>
    <header className="mt-6 overflow-hidden rounded-[2rem] bg-brand-green px-6 py-8 text-white sm:px-9 sm:py-10"><p className="text-xs uppercase tracking-[.22em] text-brand-gold">Bootcamp guide</p><h1 className="mt-3 text-4xl font-semibold">About {name}</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-white/75">{content.intro}</p></header>
    <div className="mt-6 space-y-3">{content.sections.map((section, index) => <details key={section.title} open={index === 0} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white"><summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 text-base"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-mist text-xs text-brand-green">{String(index + 1).padStart(2, "0")}</span><span>{section.title}</span><span className="ml-auto text-xl text-slate-400 transition group-open:rotate-45">+</span></summary><div className="border-t border-slate-100 px-5 py-5 text-[15px] leading-7 text-slate-600 sm:pl-[5.5rem]">{section.paragraphs.map((paragraph) => <p key={paragraph} className="not-first:mt-4">{paragraph}</p>)}{section.bullets && <ul className="mt-4 space-y-2">{section.bullets.map((item) => <li key={item} className="flex gap-3"><span className="mt-2.5 h-1.5 w-1.5 rounded-full bg-brand-gold" /><span>{item}</span></li>)}</ul>}</div></details>)}</div>
  </div>;
}
