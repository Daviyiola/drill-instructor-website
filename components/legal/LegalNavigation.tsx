"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";

export default function LegalNavigation({alternateHref, alternateLabel}: {alternateHref: string; alternateLabel: string}) {
  const router = useRouter();

  function goBack() {
    const returnTo = new URLSearchParams(window.location.search).get("returnTo");
    const safeReturnTo = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "";
    if (safeReturnTo) {
      router.push(safeReturnTo);
    } else if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return <div className="flex items-center justify-between gap-4">
    <button type="button" onClick={goBack} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm transition hover:bg-brand-green/10">
        <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
      </span>
      Back
    </button>
    <Link href={alternateHref} className="rounded-xl border border-brand-green/30 bg-white px-4 py-2 text-sm font-medium text-brand-green transition hover:bg-brand-green/10">
      {alternateLabel}
    </Link>
  </div>;
}
