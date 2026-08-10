"use client";

import Link from "next/link";
import {useEffect, useState} from "react";
import BrandLogo from "@/components/BrandLogo";

export interface AccountMenuItem {
  href: string;
  label: string;
  detail: string;
}

export default function TopAccountBar({
  homeHref,
  name,
  subtitle,
  avatarUrl,
  items,
  onSignOut,
}: {
  homeHref: string;
  name: string;
  subtitle: string;
  avatarUrl: string;
  items: AccountMenuItem[];
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return <>
    <header className="sticky top-0 z-50 border-b-2 border-brand-gold/65 bg-gradient-to-r from-brand-green via-brand-green to-brand-darkolive text-white shadow-sm">
      <div className="relative mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
        <Link href={homeHref} className="flex items-center gap-3 text-white" aria-label="Drill Instructor bootcamps">
          <span className="rounded-xl bg-white p-1 shadow-sm"><BrandLogo size={38} /></span>
          <span className="text-sm font-semibold uppercase tracking-[0.16em] sm:text-base">Drill Instructor</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label="Open account menu"
          aria-expanded={open}
          className="grid h-12 w-12 place-items-center rounded-full border-2 border-brand-gold/80 bg-white p-1 shadow-sm ring-2 ring-white/10 transition duration-200 hover:-translate-y-0.5 hover:border-brand-gold hover:shadow-lg"
        >
          <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-contain" />
        </button>
      </div>
    </header>

    {open && <div className="fixed inset-0 z-[70]">
      <button type="button" aria-label="Close account menu" className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
      <section className="di-account-menu-in absolute right-3 top-[5rem] max-h-[calc(100vh-6rem)] w-[calc(100%-1.5rem)] max-w-sm overflow-y-auto rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-2xl sm:right-6">
        <div className="flex items-center gap-4 rounded-2xl bg-brand-mist p-4">
          <img src={avatarUrl} alt="" className="h-14 w-14 rounded-full object-contain" />
          <div className="min-w-0">
            <p className="truncate text-base font-medium text-slate-950">{name}</p>
            <p className="mt-1 truncate text-sm text-slate-500">{subtitle}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto grid h-9 w-9 place-items-center rounded-full text-2xl font-light text-slate-500 transition hover:bg-white" aria-label="Close account menu">×</button>
        </div>
        <nav className="mt-3 divide-y divide-slate-100" aria-label="Account menu">
          {items.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="group flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-brand-green/10">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.detail}</span>
            </span>
            <span className="ml-auto text-xl font-light text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-green" aria-hidden>›</span>
          </Link>)}
        </nav>
        <button type="button" onClick={() => void onSignOut()} className="mt-3 min-h-11 w-full rounded-xl bg-red-50 px-4 text-left text-sm font-medium text-red-700 transition hover:bg-red-100">Sign out</button>
      </section>
    </div>}
  </>;
}
