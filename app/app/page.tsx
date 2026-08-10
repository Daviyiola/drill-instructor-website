"use client";

import {signOut} from "firebase/auth";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect, useState} from "react";
import StudentHome from "@/components/app/StudentHome";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import SignupWelcomeModal from "@/components/app/SignupWelcomeModal";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction} from "@/lib/api/client";
import {getFirebaseAuth} from "@/lib/firebase/client";
import {
  type VerificationEmailResponse,
  verificationRequestError,
} from "@/lib/profile/emailVerification";

const drillImages = [
  "/app-assets/drills/English.png",
  "/app-assets/drills/Mathematics.png",
  "/app-assets/drills/Biology.png",
];

export default function StudentAppPage() {
  const router = useRouter();
  const {account, appDataLoading, appDataError, user, refreshAccount} = useAuth();
  const [drillImageIndex, setDrillImageIndex] = useState(0);
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [approvalNotice, setApprovalNotice] = useState("");
  const [signupWelcomeRole, setSignupWelcomeRole] = useState<
    "student" | "educator" | null
  >(null);

  useEffect(() => {
    const rotation = window.setInterval(() => {
      setDrillImageIndex((current) => (current + 1) % drillImages.length);
    }, 2800);
    return () => window.clearInterval(rotation);
  }, []);

  useEffect(() => {
    const savedRole = sessionStorage.getItem("di.signupWelcomeRole");
    if (savedRole === "student" || savedRole === "educator") {
      setSignupWelcomeRole(savedRole);
    }
  }, []);

  function closeSignupWelcome() {
    sessionStorage.removeItem("di.signupWelcomeRole");
    setSignupWelcomeRole(null);
  }

  useEffect(() => {
    if (account?.role === "educator" && account.approvalStatus === "approved" && account.emailVerified) {
      router.replace("/app/educator/bootcamps");
    }
  }, [account, router]);

  if (!user || appDataLoading) {
    return <BrandedLoadingOverlay label="Loading your account" />;
  }

  // StudentHome owns the account-load error and retry UI. Previously this
  // page intercepted a failed account resolution first and left the branded
  // loading overlay visible forever because `account` remained null.
  if (!account) {
    return appDataError ? <StudentHome /> :
      <BrandedLoadingOverlay label="Loading your account" />;
  }

  if (account.role === "educator") {
    const approvalPending = account.approvalStatus !== "approved";
    const verificationPending = !account.emailVerified;
    const pending = approvalPending || verificationPending;
    const platoonName = account.profile.platoonName || account.schoolName ||
      "Your educator account";

    if (!pending) return <BrandedLoadingOverlay label="Opening educator workspace" />;

    async function checkApprovalStatus() {
      if (!user || checkingApproval) return;
      setCheckingApproval(true);
      setApprovalNotice("");
      try {
        const response = await callFunction<{
          ok: true;
          approvalStatus: "pending" | "approved" | "rejected";
          emailVerified: boolean;
          accessReady: boolean;
        }>(user, "checkEducatorApprovalStatusHttps", {});
        if (response.accessReady) {
          await refreshAccount();
          router.replace("/app/educator/bootcamps");
          return;
        }
        if (!response.emailVerified && response.approvalStatus !== "approved") setApprovalNotice("Verify your email and wait for your school’s approval.");
        else if (!response.emailVerified) setApprovalNotice("Your school approved access. Verify your email to continue.");
        else setApprovalNotice(response.approvalStatus === "rejected" ? "Your request was not approved. Contact your school administrator." : "Your email is verified. School approval is still pending.");
      } catch (reason) {
        setApprovalNotice((reason as Error).message ||
          "Unable to check approval status.");
      } finally {
        setCheckingApproval(false);
      }
    }

    return (
      <>
      <main className="di-app min-h-screen overflow-hidden bg-brand-mist px-5 py-10 sm:grid sm:place-items-center">
        <section className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <div className="relative h-64 w-full sm:h-80">
            <img
              key={drillImages[drillImageIndex]}
              src={drillImages[drillImageIndex]}
              alt="Drill Instructor subject training illustration"
              className="di-educator-drill-in absolute inset-0 mx-auto h-full max-w-full object-contain"
            />
          </div>

          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand-green/65">
            Educator account
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {pending ? platoonName : "Educator access confirmed"}
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-700 sm:text-base">
            {approvalPending && verificationPending
              ? "Verify your email and wait for school approval before opening your educator workspace."
              : verificationPending
                ? "Your school approved access. Verify your email to open the educator workspace."
                : "Your email is verified. Your school administrator still needs to approve access."}
          </p>

          {approvalNotice && (
            <p className="mt-5 max-w-xl rounded-2xl border border-brand-gold/50 bg-white/70 px-4 py-3 text-sm text-slate-700">
              {approvalNotice}
            </p>
          )}

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {pending && (
              <button
                type="button"
                onClick={checkApprovalStatus}
                disabled={checkingApproval}
                className="min-h-11 rounded-xl bg-brand-green px-5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-65"
              >
                {checkingApproval ? "CHECKING…" : "CHECK STATUS"}
              </button>
            )}
            {verificationPending && (
              <button type="button" disabled={checkingApproval} onClick={async () => {
                setCheckingApproval(true); setApprovalNotice("");
                try {
                  const response = await callFunction<VerificationEmailResponse>(
                    user, "sendAccountVerificationHttps", {reason: "resend"},
                  );
                  if (response.emailVerified) {
                    const next = await refreshAccount();
                    if (next?.approvalStatus === "approved") {
                      router.replace("/app/educator/bootcamps");
                    } else {
                      setApprovalNotice("Your email is verified. School approval is still pending.");
                    }
                  } else if (response.emailSent) {
                    setApprovalNotice("Verification email sent. Check your inbox and spam folder.");
                  } else {
                    setApprovalNotice("No email was sent. Please try again.");
                  }
                } catch (reason) { setApprovalNotice(verificationRequestError(reason)); }
                finally { setCheckingApproval(false); }
              }} className="min-h-11 rounded-xl border border-brand-green bg-white px-5 text-sm font-semibold text-brand-green disabled:opacity-60">RESEND EMAIL</button>
            )}
            <Link
              href="/support?returnTo=/app&from=pending"
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-900 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              HELP
            </Link>
            <button
              type="button"
              onClick={async () => {
                await signOut(getFirebaseAuth());
                router.replace("/app/sign-in");
              }}
              className="min-h-11 rounded-xl border border-slate-900 bg-white px-5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            >
              SIGN OUT
            </button>
          </div>
        </section>
      </main>
      {signupWelcomeRole === "educator" && (
        <SignupWelcomeModal role="educator" onClose={closeSignupWelcome} />
      )}
      </>
    );
  }

  return <>
    <StudentHome />
    {signupWelcomeRole === "student" && (
      <SignupWelcomeModal role="student" onClose={closeSignupWelcome} />
    )}
  </>;
}
