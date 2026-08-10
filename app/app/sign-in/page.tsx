"use client";

import {signInWithEmailAndPassword} from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/app/AuthProvider";
import BrandLogo from "@/components/BrandLogo";
import { getFirebaseAuth } from "@/lib/firebase/client";

function friendlyAuthError(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (code.includes("invalid-credential")) return "That email or password wasn’t recognized.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a moment and try again.";
  if (code.includes("network-request-failed")) return "Check your connection and try again.";
  return "Sign-in could not be completed. Please try again.";
}

export default function SignInPage() {
  const router = useRouter();
  const { user, loading, configured, missingConfig } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && user) router.replace("/app");
  }, [loading, router, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      router.replace("/app");
    } catch (signInError) {
      setError(friendlyAuthError(signInError));
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword() {
    setError("");
    setMessage("");
    if (!email.trim()) {
      setError("Enter your email first, then choose “Forgot password?”");
      return;
    }
    setResetting(true);
    try {
      const base = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL?.replace(/\/+$/, "") ||
        `https://${process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION}-${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.cloudfunctions.net`;
      const response = await fetch(`${base}/sendPasswordResetHttps`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({email: email.trim()}),
      });
      const payload = await response.json().catch(() => ({})) as {error?: string};
      if (!response.ok) throw new Error(payload.error || "RESET_FAILED");
      setMessage("Password reset instructions have been sent if that account exists.");
    } catch {
      setError("We couldn’t send the reset email right now. Check your connection and try again.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="di-app grid min-h-screen bg-brand-mist lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative hidden overflow-hidden bg-brand-green p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -left-28 top-1/3 h-80 w-80 rounded-full border-[55px] border-white/5" />
        <div className="absolute -right-20 -top-24 h-96 w-96 rounded-full bg-brand-gold/10" />
        <Link href="/" className="relative flex items-center gap-3">
          <span className="rounded-2xl bg-white p-1"><BrandLogo size={44} /></span>
          <span className="text-sm font-black uppercase tracking-[0.2em]">
            Drill Instructor
          </span>
        </Link>
        <div className="relative z-10 my-auto max-w-sm">
          {/* <p className="text-xs font-bold uppercase tracking-[0.28em] text-brand-gold">
            PRACTICE. REVIEW. IMPROVE.
          </p> */}
          <h1 className="mt-5 text-5xl font-black leading-[1.05] tracking-tight">
            Focus the work.
            <br />
            Build the score.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-white/70">
            Prepare for your next exam with focused drills, useful review, and progress you can see.
          </p>
        </div>
        <img
          src="/app-assets/soldier-jump-tire.png"
          alt="Student completing a tire drill"
          className="absolute bottom-0 right-3 h-[58vh] max-h-[460px] w-auto object-contain opacity-95"
        />
         <p className="text-xs font-bold uppercase tracking-[0.28em] text-brand-gold">
          PRACTICE. REVIEW. IMPROVE.
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-10 inline-flex items-center gap-3 lg:hidden">
            <BrandLogo size={44} />
            <span className="text-sm font-black uppercase tracking-[0.18em] text-brand-green">
              Drill Instructor
            </span>
          </Link>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green/65">
              Student sign in
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight">Welcome back.</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Sign in to access your Drill Instructor bootcamps.
            </p>

            {!configured ? (
              <div className="mt-7 rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-4">
                <p className="text-sm font-bold text-brand-green">Connection setup required</p>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  Add the Firebase web configuration before signing in. Missing values: {missingConfig.join(", ")}.
                </p>
              </div>
            ) : (
              <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="text-sm font-bold text-slate-700">Email</span>
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-brand-mist px-4 text-base outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
                    placeholder="you@example.com"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-slate-700">Password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-brand-mist px-4 text-base outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
                    placeholder="Your password"
                  />
                </label>

                {error && (
                  <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
                {message && (
                  <p role="status" className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800">
                    {message}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting || resetting}
                  className="min-h-12 w-full rounded-2xl bg-brand-green px-5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-darkolive disabled:cursor-wait disabled:opacity-65"
                >
                  {submitting ? "Signing in…" : "Sign in"}
                </button>
                <button
                  type="button"
                  onClick={resetPassword}
                  disabled={submitting || resetting}
                  className="w-full text-sm font-semibold text-brand-green underline-offset-4 hover:underline disabled:cursor-wait disabled:opacity-60"
                >
                  {resetting ? "Sending reset email…" : "Forgot password?"}
                </button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-slate-500">
            Need an account? <Link href="/app/sign-up" className="font-bold text-brand-green hover:underline">Create one</Link> as a student or educator.
          </p>
        </div>
      </section>
    </main>
  );
}
