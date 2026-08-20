import Link from "next/link";
import {bootcampAbout} from "@/lib/bootcamps/about";

export default function BootcampAboutContent({bootcamp, backHref, backLabel, drillHref}: {bootcamp: string; backHref: string; backLabel: string; drillHref?: string}) {
  const content = bootcampAbout[bootcamp];
  const name = bootcamp.toUpperCase();
  if (!content) return <div className="mx-auto max-w-5xl px-5 py-12 text-sm text-slate-600">This bootcamp guide is not available yet.</div>;

  return <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <Link href={backHref} className="inline-flex items-center gap-2 text-sm text-slate-700"><span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm"><span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" /></span>{backLabel}</Link>
    <header className="relative mt-6 overflow-hidden rounded-[2rem] bg-brand-green px-6 py-8 text-white shadow-soft sm:px-9 sm:py-10">
      <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[38px] border-white/5" />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-brand-gold">Bootcamp guide</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">About {name}</h1>
        <p className="mt-2 text-sm text-white/60">{content.fullName}</p>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-white/80">{content.intro}</p>
        <div className="mt-7 grid grid-cols-3 gap-2 sm:max-w-2xl sm:gap-3">{content.facts.map((fact) => <div key={fact.label} className="rounded-2xl border border-white/15 bg-white/10 px-3 py-3 backdrop-blur-sm sm:px-4"><p className="text-base font-semibold text-brand-gold sm:text-lg">{fact.value}</p><p className="mt-1 text-[10px] leading-4 text-white/65 sm:text-xs">{fact.label}</p></div>)}</div>
      </div>
    </header>
    <div className="mt-6 grid gap-3 md:grid-cols-2">{content.sections.map((section, index) => <details key={section.title} open={index === 0} className="group self-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-5 marker:hidden sm:px-6"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-mist text-xs font-medium text-brand-green">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0"><span className="block text-base font-medium text-slate-900">{section.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{section.summary}</span></span><span className="ml-auto mt-1 text-xl font-light text-slate-400 transition group-open:rotate-45" aria-hidden>+</span></summary>
      <div className="border-t border-slate-100 px-5 py-5 text-[15px] leading-7 text-slate-600 sm:px-6">{section.paragraphs.map((paragraph) => <p key={paragraph} className="not-first:mt-4">{paragraph}</p>)}{section.bullets && <ul className="mt-4 space-y-2.5">{section.bullets.map((item) => <li key={item} className="flex gap-3"><span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold" /><span>{item}</span></li>)}</ul>}</div>
    </details>)}</div>
    {drillHref && <div className="mt-7 flex flex-col gap-3 rounded-2xl border border-brand-green/15 bg-brand-green/5 p-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm leading-6 text-slate-600">Ready to turn the guide into focused practice?</p><Link href={drillHref} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-green px-5 text-sm font-medium text-white transition hover:bg-brand-darkolive">Build a drill</Link></div>}
  </div>;
}
