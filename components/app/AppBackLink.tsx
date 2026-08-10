"use client";

import Link from "next/link";
import {useAuth} from "./AuthProvider";

export default function AppBackLink({className = ""}: {className?: string}) {
  const {account} = useAuth();
  const href = account?.role === "educator" ? "/app/educator/bootcamps" : "/app";
  return <Link href={href} className={`inline-flex min-h-10 items-center gap-2 text-sm font-medium text-brand-green ${className}`}>
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.8">
      <path d="m14.5 6.5-5.5 5.5 5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    Bootcamps
  </Link>;
}
