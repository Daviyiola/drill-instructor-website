"use client";

import {
  createUserWithEmailAndPassword,
  deleteUser,
} from "firebase/auth";
import Link from "next/link";
import {FormEvent, useState} from "react";
import BrandLogo from "@/components/BrandLogo";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction, ApiError} from "@/lib/api/client";
import {getFirebaseAuth} from "@/lib/firebase/client";

type Role = "student" | "educator";

function friendlyError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "ACCESS_DENIED") {
      return "This school designation is not authorized for educator registration.";
    }
    if (error.code === "SCHOOL_RECORD_INCOMPLETE") {
      return "School Record is incomplete. Please contact your school administrator.";
    }
    if (error.status === 409) return "An account with this email already exists.";
    return "We could not finish setting up your account. Please try again.";
  }
  const code = typeof error === "object" && error && "code" in error ?
    String(error.code) : "";
  if (code.includes("email-already-in-use")) return "An account with this email already exists.";
  if (code.includes("weak-password")) return "Use a password with at least six characters.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("network-request-failed")) return "Check your connection and try again.";
  return "We could not create your account. Please try again.";
}

export default function SignUpPage() {
  const {configured, missingConfig} = useAuth();
  const [role, setRole] = useState<Role>("student");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!termsAccepted) {
      setError("Please accept the Terms of Use before creating an account.");
      return;
    }
    if (!firstName.trim() || (role === "student" && !lastName.trim())) {
      setError("Enter your name to continue.");
      return;
    }
    if (role === "educator" && !schoolId.trim()) {
      setError("Enter your school designation ID.");
      return;
    }
    if (password.length < 6) {
      setError("Use a password with at least six characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    setSubmitting(true);
    let createdUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>["user"] | null = null;
    try {
      const credential = await createUserWithEmailAndPassword(
        getFirebaseAuth(), email.trim(), password,
      );
      createdUser = credential.user;
      const avatarNumber = Math.floor(Math.random() * 14) + 1;
      const common = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        avaterNumber: avatarNumber,
      };

      if (role === "student") {
        await callFunction(createdUser, "bootstrapAccountHttps", {
          ...common,
          restoreWanted: true,
        });
      } else {
        await callFunction(createdUser, "bootstrapEducatorAccountHttps", {
          ...common,
          schoolId: schoolId.trim(),
        });
      }

      // A single server-owned welcome + verification message serves both
      // clients and keeps branding/delivery behavior consistent. Await the
      // request before replacing the document; otherwise navigation can
      // cancel the POST after its CORS preflight. Email delivery remains
      // non-fatal because the account is already durable and the app exposes
      // a resend action for unverified users.
      try {
        await callFunction(createdUser, "sendAccountVerificationHttps", {
          reason: "signup",
        });
      } catch {
        // Do not roll back a valid account because email delivery failed.
      }
      sessionStorage.setItem("di.signupWelcomeRole", role);
      // Firebase signs the user in before the server bootstrap has finished.
      // Start the authenticated shell in a fresh document only after the
      // profile and UID mapping are durable, so AuthProvider cannot race the
      // bootstrap request and cache ACCOUNT_PROFILE_NOT_FOUND.
      window.location.replace("/app");
    } catch (reason) {
      setError(friendlyError(reason));
      if (createdUser) {
        await deleteUser(createdUser).catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="di-app min-h-screen bg-brand-mist px-5 py-10 sm:px-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/" className="inline-flex items-center gap-3 text-brand-green">
          <BrandLogo size={44} />
          <span className="text-sm font-black uppercase tracking-[0.18em]">Drill Instructor</span>
        </Link>

        <div className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-soft sm:p-9">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-green/65">Create your account</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Your training starts here.</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Students can begin practice right away. Educators join their school&apos;s approval queue.</p>

          {!configured ? (
            <p className="mt-7 rounded-2xl bg-brand-gold/10 p-4 text-sm text-brand-green">Firebase setup is incomplete: {missingConfig.join(", ")}.</p>
          ) : (
            <form className="mt-7 space-y-5" onSubmit={submit}>
              <fieldset>
                <legend className="text-sm font-semibold text-slate-700">I&apos;m joining as a</legend>
                <div className="mt-2 grid grid-cols-2 rounded-2xl bg-brand-mist p-1">
                  {(["student", "educator"] as Role[]).map((option) => (
                    <button key={option} type="button" onClick={() => setRole(option)} className={`min-h-11 rounded-xl px-4 text-sm font-semibold capitalize transition ${role === option ? "bg-brand-green text-white shadow-sm" : "text-slate-500"}`}>{option}</button>
                  ))}
                </div>
              </fieldset>

              {role === "educator" && <Field label="School designation ID" value={schoolId} onChange={setSchoolId} autoComplete="organization" />}
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="First name" value={firstName} onChange={setFirstName} autoComplete="given-name" />
                <Field label={role === "student" ? "Last name" : "Last name"} value={lastName} onChange={setLastName} autoComplete="family-name" required={role === "student"} />
              </div>
              <Field label="Email" value={email} onChange={setEmail} autoComplete="email" type="email" />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Password" value={password} onChange={setPassword} autoComplete="new-password" type="password" />
                <Field label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" type="password" />
              </div>

              <label className="flex items-start gap-3 text-sm leading-5 text-slate-600">
                <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-[#4B5320]" />
                <span>I agree to the <Link className="font-semibold text-brand-green underline" href="/terms">Terms of Use and Privacy Policy</Link>.</span>
              </label>
              {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={submitting} className="min-h-12 w-full rounded-2xl bg-brand-green px-5 text-sm font-bold text-white transition hover:bg-brand-darkolive disabled:cursor-wait disabled:opacity-65">
                {submitting ? "Creating account…" : role === "educator" ? "Request educator access" : "Create student account"}
              </button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">Already have an account? <Link href="/app/sign-in" className="font-semibold text-brand-green underline">Sign in</Link></p>
      </div>
    </main>
  );
}

function Field({label, value, onChange, type = "text", autoComplete, required = true}: {label: string; value: string; onChange: (next: string) => void; type?: string; autoComplete: string; required?: boolean}) {
  return <label className="block"><span className="text-sm font-semibold text-slate-700">{label}</span><input type={type} value={value} required={required} autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-brand-mist px-4 text-base outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10" /></label>;
}
