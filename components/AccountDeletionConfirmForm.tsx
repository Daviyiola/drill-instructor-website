"use client";

import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {FormEvent, useState} from "react";

const functionsBase = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL ||
  "https://us-central1-drill-instructor-pro.cloudfunctions.net";

const errorMessages: Record<string, string> = {
  INVALID_OR_EXPIRED_LINK: "This confirmation link is invalid, expired, or has already been used.",
  SOLE_SUPER_ADMIN_CANNOT_DELETE: "Another school super administrator must be assigned before this educator account can be deleted.",
  ACCOUNT_PROFILE_NOT_FOUND: "We could not find an active Drill Instructor profile for this account.",
};

export default function AccountDeletionConfirmForm() {
  const token = useSearchParams().get("token") || "";
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"idle" | "deleting" | "deleted" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("deleting");
    setError("");
    try {
      const response = await fetch(`${functionsBase}/confirmAccountDeletionHttps`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({token, confirmText: confirmation}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || "UNABLE_TO_DELETE_ACCOUNT");
      }
      setStatus("deleted");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(errorMessages[code] || "We couldn’t delete the account. Please try again or contact support.");
      setStatus("error");
    }
  }

  if (!token) {
    return <Notice text="This confirmation link is incomplete." />;
  }

  if (status === "deleted") {
    return (
      <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50 p-7 sm:p-8">
        <h2 className="text-2xl font-medium text-emerald-950">Account deleted</h2>
        <p className="mt-3 text-sm leading-6 text-emerald-900/80">
          Your Drill Instructor sign-in and associated account data have been removed. Data that must be retained for legal, security, billing, backup, or school-record purposes follows our Privacy Policy.
        </p>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-2xl border border-emerald-800 px-5 text-sm font-medium text-emerald-950 hover:bg-emerald-100">
          RETURN HOME
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-[2rem] border border-red-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="rounded-2xl bg-red-50 p-5">
        <h2 className="text-xl font-medium text-red-950">This action is permanent</h2>
        <p className="mt-2 text-sm leading-6 text-red-900/80">
          Your sign-in, profile, personal practice records, bookmarks, social connections, and account entitlements will be removed. This cannot be undone.
        </p>
      </div>

      <label className="mt-6 block">
        <span className="text-sm font-medium text-slate-800">Type DELETE to confirm</span>
        <input
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm uppercase outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/10"
          placeholder="DELETE"
        />
      </label>

      <button
        type="submit"
        disabled={confirmation.trim().toUpperCase() !== "DELETE" || status === "deleting"}
        className="mt-6 min-h-12 w-full rounded-2xl bg-red-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "deleting" ? "DELETING ACCOUNT…" : "PERMANENTLY DELETE ACCOUNT"}
      </button>

      {status === "error" && (
        <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{error}</p>
      )}
    </form>
  );
}

function Notice({text}: {text: string}) {
  return (
    <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-7 text-sm leading-6 text-amber-950">
      {text} <Link href="/account-deletion" className="font-medium underline underline-offset-4">Request a new link.</Link>
    </div>
  );
}
