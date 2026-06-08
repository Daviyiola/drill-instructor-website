"use client";

import { FormEvent, useState } from "react";

const interestOptions = [
  "Student / parent access",
  "School plan",
  "Educator use",
  "Access codes",
  "Other",
];

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [interest, setInterest] = useState(interestOptions[0]);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStatus("sending");
    setErrorMessage("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          interest,
          message,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not send message.");
      }

      setStatus("sent");
      setName("");
      setEmail("");
      setInterest(interestOptions[0]);
      setMessage("");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not send message. Please email us directly."
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[2rem] border border-slate-200 bg-white p-7 shadow-sm"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Name</span>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-brand-blue"
            placeholder="Your name"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-brand-blue"
            placeholder="you@example.com"
          />
        </label>
      </div>

      <label className="mt-5 block">
        <span className="text-sm font-medium text-slate-700">
          I’m interested in
        </span>
        <select
          value={interest}
          onChange={(event) => setInterest(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-blue"
        >
          {interestOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>

      <label className="mt-5 block">
        <span className="text-sm font-medium text-slate-700">Message</span>
        <textarea
          required
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="mt-2 min-h-36 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-brand-blue"
          placeholder="Tell us what you need."
        />
      </label>

      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-6 rounded-2xl bg-brand-navy px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending" ? "Sending..." : "Send Message"}
      </button>

      {status === "sent" && (
        <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
          Message sent. Thanks — we’ll get back to you soon.
        </p>
      )}

      {status === "error" && (
        <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          {errorMessage} You can also email us directly at
          hello@drillinstructor.app.
        </p>
      )}
    </form>
  );
}