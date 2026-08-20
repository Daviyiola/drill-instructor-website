"use client";

import {FormEvent, useState} from "react";

const functionsBase = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL ||
  "https://us-central1-drill-instructor-pro.cloudfunctions.net";

export default function AccountDeletionRequestForm() {
  const [email, setEmail] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!acknowledged) return;
    setStatus("sending");
    try {
      const response = await fetch(`${functionsBase}/requestAccountDeletionHttps`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({email}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok !== true) throw new Error("request_failed");
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-[2rem] border border-emerald-200 bg-emerald-50 p-7">
        <h2 className="text-xl font-medium text-emerald-950">Check your email</h2>
        <p className="mt-3 text-sm leading-6 text-emerald-900/80">
          If that address belongs to a Drill Instructor account, we sent a confirmation link. It expires in 30 minutes.
        </p>
        <p className="mt-3 text-sm leading-6 text-emerald-900/80">
          Nothing will be deleted unless the link is opened and the final deletion is confirmed.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <label className="block">
        <span className="text-sm font-medium text-slate-800">Account email</span>
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-brand-green focus:ring-2 focus:ring-brand-green/10"
          placeholder="you@example.com"
        />
      </label>

      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-brand-mist p-4">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-1 h-4 w-4 accent-brand-green"
        />
        <span className="text-sm leading-6 text-slate-700">
          I understand that deleting my account does not automatically cancel a subscription managed by Google Play, Apple, or another payment provider.
        </span>
      </label>

      <button
        type="submit"
        disabled={!acknowledged || status === "sending"}
        className="mt-6 min-h-12 w-full rounded-2xl bg-red-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "sending" ? "SENDING CONFIRMATION…" : "REQUEST ACCOUNT DELETION"}
      </button>

      {status === "error" && (
        <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          We couldn’t submit the request. Please try again or contact support.
        </p>
      )}
    </form>
  );
}
