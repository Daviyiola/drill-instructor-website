"use client";

import {useRouter} from "next/navigation";
import {useAuth} from "./AuthProvider";

function safeLocalPath(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "";
}

export default function AppBackLink({
  className = "",
  label = "Back",
  fallbackHref,
}: {
  className?: string;
  label?: string;
  fallbackHref?: string;
}) {
  const router = useRouter();
  const {account} = useAuth();
  const fallback = fallbackHref ||
    (account?.role === "educator" ? "/app/educator/bootcamps" : "/app");

  function goBack() {
    const returnTo = safeLocalPath(new URLSearchParams(window.location.search).get("returnTo"));
    if (returnTo) {
      router.push(returnTo);
      return;
    }
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallback);
  }

  return <button type="button" onClick={goBack} className={`inline-flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700 ${className}`}>
    <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm transition hover:bg-brand-green/10">
      <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
    </span>
    {label}
  </button>;
}
