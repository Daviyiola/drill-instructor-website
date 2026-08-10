"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";
import ContactForm from "@/components/ContactForm";
import EducatorShell from "@/components/educator/EducatorShell";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";
import AppBackLink from "./AppBackLink";

export default function SignedInContact() {
  const router = useRouter();
  const {
    user,
    loading,
    account,
    educatorWorkspace,
    appDataLoading,
  } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace("/support");
    if (
      !loading &&
      account?.role === "educator" &&
      account.approvalStatus !== "approved"
    ) {
      router.replace("/support?returnTo=/app&from=pending");
    }
  }, [account, loading, router, user]);

  if (!user || loading || appDataLoading || !account) {
    return <BrandedLoadingOverlay label="Loading contact form" />;
  }

  const name = [account.profile.firstName, account.profile.lastName]
    .filter(Boolean)
    .join(" ") || user.displayName || "";

  const content = (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
      <AppBackLink className="mb-5" />
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-green/65">
          Help &amp; support
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          How can we help?
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Send us a message and we’ll respond by email.
        </p>
        <div className="mt-7">
          <ContactForm
            initialName={name}
            initialEmail={user.email || String(account.profile.email || "")}
            firebaseUser={user}
          />
        </div>
      </section>
    </div>
  );

  if (account.role === "educator") {
    if (!educatorWorkspace) {
      return <BrandedLoadingOverlay label="Loading educator workspace" />;
    }
    return <EducatorShell workspace={educatorWorkspace}>{content}</EducatorShell>;
  }

  return <AppShell profile={account.profile}>{content}</AppShell>;
}
