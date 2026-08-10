"use client";

import {FormEvent, useEffect, useState} from "react";
import type {User} from "firebase/auth";

const supportUrl = `${process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL || "https://us-central1-drill-instructor-pro.cloudfunctions.net"}/submitSupportRequestHttps`;

export default function ContactForm({
  initialName = "",
  initialEmail = "",
  firebaseUser = null,
}: {
  initialName?: string;
  initialEmail?: string;
  firebaseUser?: User | null;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [receiptSent, setReceiptSent] = useState(false);

  useEffect(() => {
    if (initialName) setName(initialName);
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail, initialName]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage("");
    setReceiptSent(false);
    try {
      const idToken = firebaseUser ? await firebaseUser.getIdToken() : "";
      const response = await fetch(supportUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? {Authorization: `Bearer ${idToken}`} : {}),
        },
        body: JSON.stringify({name, email, message}),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not send message.");
      }
      setReceiptSent(data.receiptSent === true);
      setStatus("sent");
      setMessage("");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Could not send message.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Name</span>
          <input required value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-brand-olive" placeholder="Your name" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-brand-olive" placeholder="you@example.com" />
        </label>
      </div>
      <label className="mt-5 block">
        <span className="text-sm font-medium text-slate-700">How can we help?</span>
        <textarea required value={message} onChange={(event) => setMessage(event.target.value)} className="mt-2 min-h-36 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-brand-olive" placeholder="Tell us what you need." />
      </label>
      <button type="submit" disabled={status === "sending"} className="mt-6 rounded-2xl bg-brand-green px-5 py-3 text-sm font-semibold text-white hover:bg-brand-darkolive disabled:cursor-not-allowed disabled:opacity-60">
        {status === "sending" ? "Sending…" : "Send message"}
      </button>
      {status === "sent" && <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">{receiptSent ? "Message sent. We emailed you a copy and will get back to you soon." : "Message sent. We’ll get back to you soon."}</p>}
      {status === "error" && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{errorMessage}</p>}
    </form>
  );
}
