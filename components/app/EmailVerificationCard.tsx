"use client";

import {useState} from "react";
import {callFunction} from "@/lib/api/client";
import {
  type VerificationEmailResponse,
  verificationRequestError,
} from "@/lib/profile/emailVerification";
import {useAuth} from "./AuthProvider";

export default function EmailVerificationCard({compact = false}: {compact?: boolean}) {
  const {user, account, refreshAccount} = useAuth();
  const [busy, setBusy] = useState<"send" | "check" | "">("");
  const [notice, setNotice] = useState("");
  const [verifiedLocally, setVerifiedLocally] = useState(false);
  if (!user || !account || account.emailVerified || verifiedLocally) return null;

  async function resend() {
    setBusy("send"); setNotice("");
    try {
      const response = await callFunction<VerificationEmailResponse>(
        user!, "sendAccountVerificationHttps", {reason: "resend"},
      );
      if (response.emailVerified) {
        setVerifiedLocally(true);
        await refreshAccount();
      } else if (response.emailSent) {
        setNotice("Verification email sent. Check your inbox and spam folder.");
      } else {
        setNotice("No email was sent. Please try again.");
      }
    } catch (error) { setNotice(verificationRequestError(error)); }
    finally { setBusy(""); }
  }
  async function check() {
    setBusy("check"); setNotice("");
    try {
      const next = await refreshAccount();
      if (next?.emailVerified) setVerifiedLocally(true);
      else setNotice("Your email is not verified yet.");
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(""); }
  }

  return <section className={`rounded-2xl border border-brand-gold/60 bg-brand-gold/10 ${compact ? "p-4" : "p-5"}`}>
    <h2 className="text-base font-semibold text-slate-950">Verify your email</h2>
    <p className="mt-1 text-sm leading-6 text-slate-700">You can keep practicing, but you won't be able to edit your profile until your email is verified.</p>
    {notice && <p className="mt-2 text-sm text-slate-700">{notice}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={resend} disabled={!!busy} className="min-h-10 rounded-xl bg-brand-green px-4 text-xs font-semibold text-white disabled:opacity-60">{busy === "send" ? "SENDING…" : "RESEND EMAIL"}</button>
      <button type="button" onClick={check} disabled={!!busy} className="min-h-10 rounded-xl border border-brand-green bg-white px-4 text-xs font-semibold text-brand-green disabled:opacity-60">{busy === "check" ? "CHECKING…" : "I’VE VERIFIED"}</button>
    </div>
  </section>;
}
