"use client";

import Link from "next/link";
import {useRouter} from "next/navigation";
import {FormEvent, useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {STUDENT_WEB_PLAN_LIST} from "@/lib/billing/catalog";
import type {ResolvedAccount} from "@/lib/types/account";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";

interface SubscriptionStatus {
  status: "success";
  hasActiveLicense: boolean;
  plan: string;
  bootcamp: string;
  activationDate: string;
  expirationDate: string;
  source: string;
  stripeManaged: boolean;
  cancelAtPeriodEnd: boolean;
  subscriptionStatus: string;
  paymentNeedsAttention: boolean;
  paymentGraceEndsAt: string;
}

interface ActivationResponse {
  status: "success";
  plan: string;
  bootcamp: string;
  activationDate: string;
  expirationDate: string;
}

interface CheckoutPlan {
  id: "monthly" | "annual";
  name: string;
  price: string;
  cadence: string;
  detail: string;
}

interface SubscriptionEvent {
  id: string;
  type: string;
  source: string;
  status: string;
  planType: string;
  activationDate: string;
  expirationDate: string;
  amount: number;
  currency: string;
  invoiceId: string;
  receiptUrl: string;
  invoicePdf: string;
  cancelAtPeriodEnd: boolean;
  recordedAt: string;
}

const planByLength: Record<number, string> = {
  10: "monthly",
  12: "quarterly",
  16: "yearly",
};

const checkoutPlans: CheckoutPlan[] = [
  {
    ...STUDENT_WEB_PLAN_LIST[0],
    price: STUDENT_WEB_PLAN_LIST[0].displayPrice,
    cadence: STUDENT_WEB_PLAN_LIST[0].cadenceLabel,
    detail: "Flexible access that renews each month.",
  },
  {
    ...STUDENT_WEB_PLAN_LIST[1],
    price: STUDENT_WEB_PLAN_LIST[1].displayPrice,
    cadence: STUDENT_WEB_PLAN_LIST[1].cadenceLabel,
    detail: "Save $21.89 compared with 12 monthly payments.",
  },
];

function cleanCode(value: string) {
  return value.replace(/[.,#$[\]/]/g, "").trim().toLowerCase();
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

function activationError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("active license already exists")) {
    return "You already have active access to this bootcamp.";
  }
  if (
    normalized.includes("code already used") ||
    normalized.includes("claimed")
  ) {
    return "This access code has already been used.";
  }
  if (normalized.includes("code not found")) {
    return "That access code was not found. Check it and try again.";
  }
  if (normalized.includes("unauthorized")) {
    return "Your session could not be verified. Please sign in again.";
  }
  return message || "The access code could not be activated.";
}

function historyLabel(event: SubscriptionEvent) {
  const labels: Record<string, string> = {
    subscription_activated: "Access activated",
    subscription_updated: "Subscription updated",
    cancellation_scheduled: "Cancellation scheduled",
    subscription_ended: "Subscription ended",
    invoice_paid: "Payment completed",
    invoice_payment_failed: "Payment failed",
    payment_action_required: "Payment authentication required",
    invoice_finalization_failed: "Invoice could not be finalized",
    payment_refunded: "Payment refunded",
  };
  return labels[event.type] || titleCase(event.type || "Subscription event");
}

function money(amount: number, currency: string) {
  if (!amount || !currency) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export default function BootcampSubscription({
  bootcamp,
}: {
  bootcamp: string;
}) {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [subscription, setSubscription] =
    useState<SubscriptionStatus | null>(null);
  const [history, setHistory] = useState<SubscriptionEvent[]>([]);
  const [code, setCode] = useState("");
  const [activating, setActivating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [upgradeConfirming, setUpgradeConfirming] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const normalizedCode = useMemo(() => cleanCode(code), [code]);
  const detectedPlan = planByLength[normalizedCode.length] || "";

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      try {
        const nextAccount = await callFunction<ResolvedAccount>(
          user!,
          "resolveSignInAccountHttps",
          {preferredRole: "student"},
        );
        const [nextStatus, nextHistory] = await Promise.all([
          callFunction<
            SubscriptionStatus,
            {userId: string; bootcamp: string}
          >(user!, "getSubscriptionStatusHttps", {
            userId: nextAccount.customUserId,
            bootcamp,
          }),
          callFunction<
            {ok: true; events: SubscriptionEvent[]},
            {bootcamp: string}
          >(user!, "getStudentSubscriptionHistoryHttps", {bootcamp}).catch(
            () => ({ok: true as const, events: []}),
          ),
        ]);
        if (!cancelled) {
          setAccount(nextAccount);
          setSubscription(nextStatus);
          setHistory(nextHistory.events);
          const query = new URLSearchParams(window.location.search);
          const checkout = query.get("checkout");
          const upgrade = query.get("upgrade");
          if (checkout === "success" || upgrade === "success") {
            setCheckoutNotice(
              upgrade === "success"
                ? "Upgrade confirmed. Annual access is updating as Stripe confirms it."
                : "Payment completed. Access updates as Stripe confirms it.",
            );
            window.setTimeout(async () => {
              try {
                const [refreshedStatus, refreshedHistory] = await Promise.all([
                  callFunction<
                    SubscriptionStatus,
                    {userId: string; bootcamp: string}
                  >(user!, "getSubscriptionStatusHttps", {
                    userId: nextAccount.customUserId,
                    bootcamp,
                  }),
                  callFunction<
                    {ok: true; events: SubscriptionEvent[]},
                    {bootcamp: string}
                  >(
                    user!,
                    "getStudentSubscriptionHistoryHttps",
                    {bootcamp},
                  ).catch(() => ({ok: true as const, events: []})),
                ]);
                if (!cancelled) {
                  setSubscription(refreshedStatus);
                  setHistory(refreshedHistory.events);
                  if (refreshedStatus.hasActiveLicense) {
                    setCheckoutNotice(
                      upgrade === "success" &&
                        refreshedStatus.plan.toLowerCase() === "annual"
                        ? "Upgrade complete. Your annual access is active."
                        : "Payment confirmed. Your bootcamp access is active.",
                    );
                  }
                }
              } catch (_) {
                // The webhook can still complete after the next page refresh.
              }
            }, 2500);
          } else if (checkout === "cancelled") {
            setCheckoutNotice("Checkout was cancelled. No payment was taken.");
          }
        }
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [bootcamp, user]);

  function requestActivation(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!detectedPlan) {
      setError("Enter a valid Drill Instructor access code.");
      return;
    }
    setConfirming(true);
  }

  async function activate() {
    if (!user || !account || !detectedPlan || activating) return;
    setActivating(true);
    setError("");
    try {
      const result = await callFunction<
        ActivationResponse,
        {
          code: string;
          planType: string;
          bootcamp: string;
          userId: string;
        }
      >(
        user,
        "verifyAccessCodeHttps",
        {
          code: normalizedCode,
          planType: detectedPlan,
          bootcamp,
          userId: account.customUserId,
        },
        {retryTransient: true},
      );
      setSubscription({
        ...result,
        hasActiveLicense: true,
        source: "access_code",
        stripeManaged: false,
        cancelAtPeriodEnd: false,
        subscriptionStatus: "active",
        paymentNeedsAttention: false,
        paymentGraceEndsAt: "",
      });
      setCode("");
      setConfirming(false);
      setNotice(
        `${titleCase(result.plan)} access is now active for ${bootcamp.toUpperCase()}.`,
      );
      callFunction<
        {ok: true; events: SubscriptionEvent[]},
        {bootcamp: string}
      >(user, "getStudentSubscriptionHistoryHttps", {bootcamp})
        .then((response) => setHistory(response.events))
        .catch(() => undefined);
    } catch (reason) {
      setConfirming(false);
      setError(activationError((reason as Error).message));
    } finally {
      setActivating(false);
    }
  }

  async function confirmCheckout() {
    if (!checkoutPlan || !user || checkoutLoading) return;
    setCheckoutLoading(true);
    setError("");
    try {
      const response = await callFunction<
        {ok: true; url: string},
        {bootcamp: string; planType: string}
      >(user, "createStripeCheckoutSessionHttps", {
        bootcamp,
        planType: checkoutPlan.id,
      });
      window.location.assign(response.url);
    } catch (reason) {
      setCheckoutPlan(null);
      setError((reason as Error).message);
      setCheckoutLoading(false);
    }
  }

  async function openBillingPortal() {
    if (!user || portalLoading) return;
    setPortalLoading(true);
    setError("");
    try {
      const response = await callFunction<
        {ok: true; url: string},
        {bootcamp: string}
      >(user, "createStripeBillingPortalSessionHttps", {bootcamp});
      window.location.assign(response.url);
    } catch (reason) {
      setError((reason as Error).message);
      setPortalLoading(false);
    }
  }

  async function upgradeToAnnual() {
    if (!user || upgradeLoading) return;
    setUpgradeLoading(true);
    setError("");
    try {
      const response = await callFunction<
        {ok: true; url: string},
        {bootcamp: string; action: "upgrade_annual"}
      >(user, "createStripeBillingPortalSessionHttps", {
        bootcamp,
        action: "upgrade_annual",
      });
      window.location.assign(response.url);
    } catch (reason) {
      setUpgradeConfirming(false);
      setError((reason as Error).message);
      setUpgradeLoading(false);
    }
  }

  if (!account || !subscription) {
    if (!error) {
      return (
        <BrandedLoadingOverlay
          label="Checking your subscription"
          fixed={false}
        />
      );
    }
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-6 text-center text-sm text-slate-600">
        {error || "Checking your bootcamp access…"}
      </div>
    );
  }

  const name = bootcamp.toUpperCase();
  const recoverableStripeStatuses = new Set([
    "active",
    "incomplete",
    "past_due",
    "paused",
    "trialing",
    "unpaid",
  ]);
  const hasRecoverableStripeSubscription =
    subscription.stripeManaged &&
    recoverableStripeStatuses.has(subscription.subscriptionStatus);
  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <Link
          href={`/app/bootcamps/${bootcamp}`}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-700"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm">
            <span className="h-2.5 w-2.5 rotate-45 border-b-[3px] border-l-[3px] border-brand-green" />
          </span>
          {name} home
        </Link>

        <header className="mt-6">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-green/65">
            {name} bootcamp
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Subscription
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Access applies to this bootcamp only. Redeem an organization code
            or subscribe through secure Stripe Checkout.
          </p>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-[2rem] bg-brand-green p-6 text-white shadow-soft sm:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-gold">
              Current access
            </p>
            <h2 className="mt-3 text-2xl font-semibold">
              {subscription.hasActiveLicense
                ? `${titleCase(subscription.plan)} plan`
                : "No active subscription"}
            </h2>
            {subscription.hasActiveLicense ? (
              <>
                <dl className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-white/55">
                      Activated
                    </dt>
                    <dd className="mt-1 text-sm">
                      {formatDate(subscription.activationDate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-white/55">
                      {subscription.cancelAtPeriodEnd
                        ? "Access through"
                        : "Renews or expires"}
                    </dt>
                    <dd className="mt-1 text-sm">
                      {formatDate(subscription.expirationDate)}
                    </dd>
                  </div>
                </dl>
                {subscription.cancelAtPeriodEnd && (
                  <p className="mt-5 rounded-2xl bg-white/10 p-4 text-sm leading-6 text-white/80">
                    Cancellation is scheduled. Your access remains active
                    through the paid period shown above.
                  </p>
                )}
                {subscription.paymentNeedsAttention && (
                  <p className="mt-5 rounded-2xl bg-brand-gold/20 p-4 text-sm leading-6 text-white">
                    Your latest payment needs attention. Access remains
                    available through {formatDate(
                      subscription.paymentGraceEndsAt,
                    )}. Update your payment method to avoid interruption.
                  </p>
                )}
                {subscription.stripeManaged && (
                  <div className="mt-6 flex flex-wrap gap-3">
                    {subscription.plan.toLowerCase() === "monthly" &&
                      !subscription.paymentNeedsAttention &&
                      !subscription.cancelAtPeriodEnd && (
                        <button
                          type="button"
                          onClick={() => setUpgradeConfirming(true)}
                          disabled={upgradeLoading}
                          className="min-h-12 rounded-2xl bg-brand-gold px-5 text-sm text-brand-green transition hover:bg-brand-gold/90 disabled:opacity-50"
                        >
                          Upgrade to annual
                        </button>
                      )}
                  <button
                    type="button"
                    onClick={() => void openBillingPortal()}
                    disabled={portalLoading}
                    className="min-h-12 rounded-2xl border border-white/25 px-5 text-sm text-white transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {portalLoading ? "Opening billing…" : "Manage billing"}
                  </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="mt-4 text-sm leading-6 text-white/70">
                  {subscription.paymentNeedsAttention
                    ? "Your payment grace period has ended. Update your billing information to restore access."
                    : `You can still use the included free practice tests. Activate a code to unlock the complete ${name} question bank.`}
                </p>
                {hasRecoverableStripeSubscription && (
                  <button
                    type="button"
                    onClick={() => void openBillingPortal()}
                    disabled={portalLoading}
                    className="mt-6 min-h-12 rounded-2xl border border-white/25 px-5 text-sm text-white transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {portalLoading ? "Opening billing..." : "Update billing"}
                  </button>
                )}
              </>
            )}

            <div className="mt-8 border-t border-white/15 pt-6">
              <p className="text-sm font-medium">Bootcamp access includes</p>
              <ul className="mt-4 space-y-3 text-sm text-white/75">
                {[
                  "The complete practice-test library",
                  "Module-focused drills and corrections",
                  "Squad challenges and comparisons",
                  "Progress records and performance breakdowns",
                ].map((benefit) => (
                  <li key={benefit} className="flex gap-3">
                    <span className="text-brand-gold" aria-hidden>
                      ✓
                    </span>
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="mx-auto max-w-xl">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
                Access code
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                Redeem organization access
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Enter the code supplied by your school, educator, or
                organization. A code can only be activated once.
              </p>

              <form onSubmit={requestActivation} className="mt-7">
                <label
                  htmlFor="access-code"
                  className="text-sm font-medium text-slate-700"
                >
                  Access code
                </label>
                <input
                  id="access-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  disabled={
                    activating ||
                    subscription.hasActiveLicense ||
                    hasRecoverableStripeSubscription
                  }
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Enter access code"
                  className="mt-2 min-h-14 w-full rounded-2xl border border-slate-300 px-4 text-center text-base tracking-[0.12em] text-slate-950 outline-none transition focus:border-brand-green focus:ring-4 focus:ring-brand-green/10 disabled:bg-slate-100"
                />
                {/* <div className="mt-2 min-h-5 text-center text-xs text-slate-500">
                  {detectedPlan
                    ? `${titleCase(detectedPlan)} code detected`
                    : code
                      ? "Check the code length and characters."
                      : ""}
                </div> */}
                <button
                  type="submit"
                  disabled={
                    activating ||
                    subscription.hasActiveLicense ||
                    hasRecoverableStripeSubscription ||
                    !normalizedCode
                  }
                  className="mt-4 min-h-14 w-full rounded-2xl bg-brand-green px-5 text-sm font-medium text-white transition hover:bg-brand-darkolive disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {subscription.hasActiveLicense
                    ? "Access already active"
                    : hasRecoverableStripeSubscription
                      ? "Manage current subscription"
                    : "Activate code"}
                </button>
              </form>

              {notice && (
                <p
                  role="status"
                  className="mt-5 rounded-2xl bg-green-50 p-4 text-sm text-green-800"
                >
                  {notice}
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700"
                >
                  {error}
                </p>
              )}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
                Individual plans
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                Choose your {name} access
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                One subscription unlocks this bootcamp. Checkout and recurring
                billing are securely handled by Stripe.
              </p>
            </div>
            <span className="rounded-full bg-brand-gold/20 px-3 py-1.5 text-xs text-brand-green">
              Secure checkout
            </span>
          </div>

          <div className="mt-7 grid gap-4 lg:grid-cols-2">
            {checkoutPlans.map((plan) => (
              <article
                key={plan.id}
                className={`relative overflow-hidden rounded-3xl border p-6 ${
                  plan.id === "annual"
                    ? "border-brand-green bg-brand-mist"
                    : "border-slate-200 bg-white"
                }`}
              >
                {plan.id === "annual" && (
                  <span className="absolute right-5 top-5 rounded-full bg-brand-green px-3 py-1 text-xs text-white">
                    Best value
                  </span>
                )}
                <p className="text-sm font-medium text-brand-green">
                  {plan.name}
                </p>
                <div className="mt-4 flex items-end gap-2">
                  <p className="text-4xl font-semibold tracking-tight text-slate-950">
                    {plan.price}
                  </p>
                  <p className="pb-1 text-sm text-slate-500">{plan.cadence}</p>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  {plan.detail}
                </p>
                <button
                  type="button"
                  disabled={
                    subscription.hasActiveLicense ||
                    hasRecoverableStripeSubscription
                  }
                  onClick={() => {
                    setCheckoutNotice("");
                    setCheckoutPlan(plan);
                  }}
                  className={`mt-6 min-h-12 w-full rounded-2xl px-5 text-sm transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    plan.id === "annual"
                      ? "bg-brand-green text-white hover:bg-brand-darkolive"
                      : "border border-brand-green text-brand-green hover:bg-brand-mist"
                  }`}
                >
                  {subscription.hasActiveLicense
                    ? "Access already active"
                    : hasRecoverableStripeSubscription
                      ? "Manage current subscription"
                    : `Choose ${plan.name.toLowerCase()}`}
                </button>
              </article>
            ))}
          </div>
          {checkoutNotice && (
            <p
              role="status"
              className="mt-5 rounded-2xl bg-green-50 p-4 text-sm text-green-800"
            >
              {checkoutNotice}
            </p>
          )}
        </section>

        <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
            Subscription history
          </p>
          {history.length ? (
            <div className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200">
              {history.map((event) => {
                const amount = money(event.amount, event.currency);
                const documentUrl = event.invoicePdf || event.receiptUrl;
                return (
                  <article
                    key={event.id}
                    className="grid gap-3 bg-white p-5 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-medium text-slate-900">
                          {historyLabel(event)}
                        </h2>
                        <span className="rounded-full bg-brand-mist px-2.5 py-1 text-[11px] text-brand-green">
                          {event.source === "stripe"
                            ? "Card"
                            : "Access code"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDate(event.recordedAt)}
                        {event.planType
                          ? ` · ${titleCase(event.planType)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 sm:justify-end">
                      {amount && (
                        <span className="text-sm font-medium text-slate-900">
                          {amount}
                        </span>
                      )}
                      {documentUrl && (
                        <a
                          href={documentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-brand-green underline decoration-1 underline-offset-4"
                        >
                          Receipt
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-3xl bg-brand-mist p-6 text-center">
              <h2 className="text-lg font-semibold text-slate-900">
                No subscription history yet
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Access-code activations, card payments, renewals, cancellations,
                and refunds will appear here.
              </p>
            </div>
          )}
        </section>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-5 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="activate-code-title"
            className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"
          >
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
              Confirm activation
            </p>
            <h2
              id="activate-code-title"
              className="mt-2 text-2xl font-semibold text-slate-950"
            >
              Unlock {name}?
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              {/* This {titleCase(detectedPlan)} access code will be permanently */}
              This access code will be permanently
              assigned to your {name} bootcamp account.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={activating}
                onClick={() => setConfirming(false)}
                className="min-h-12 rounded-2xl border border-slate-200 px-4 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={activating}
                onClick={() => void activate()}
                className="min-h-12 rounded-2xl bg-brand-green px-4 text-sm text-white disabled:opacity-50"
              >
                {activating ? "Activating…" : "Activate"}
              </button>
            </div>
          </section>
        </div>
      )}

      {checkoutPlan && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-5 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-plan-title"
            className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"
          >
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
              Confirm plan
            </p>
            <h2
              id="checkout-plan-title"
              className="mt-2 text-2xl font-semibold text-slate-950"
            >
              Choose {checkoutPlan.name.toLowerCase()} {name} access?
            </h2>
            <div className="mt-5 rounded-2xl bg-brand-mist p-4">
              <div className="flex items-end justify-between gap-4">
                <span className="text-sm text-slate-600">
                  {checkoutPlan.name} subscription
                </span>
                <span className="text-xl font-semibold text-slate-950">
                  {checkoutPlan.price}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Renews {checkoutPlan.id === "monthly" ? "monthly" : "annually"}{" "}
                until cancelled.
              </p>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              You will review the final amount and payment details in secure
              checkout before being charged.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={checkoutLoading}
                onClick={() => setCheckoutPlan(null)}
                className="min-h-12 rounded-2xl border border-slate-200 px-4 text-sm text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={checkoutLoading}
                onClick={() => void confirmCheckout()}
                className="min-h-12 rounded-2xl bg-brand-green px-4 text-sm text-white disabled:opacity-50"
              >
                {checkoutLoading ? "Opening checkout…" : "Continue"}
              </button>
            </div>
          </section>
        </div>
      )}

      {upgradeConfirming && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-5 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="upgrade-plan-title"
            className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"
          >
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
              Annual upgrade
            </p>
            <h2
              id="upgrade-plan-title"
              className="mt-2 text-2xl font-semibold text-slate-950"
            >
              Switch {name} to annual?
            </h2>
            <div className="mt-5 rounded-2xl bg-brand-mist p-4">
              <div className="flex items-end justify-between gap-4">
                <span className="text-sm text-slate-600">
                  Annual subscription
                </span>
                <span className="text-xl font-semibold text-slate-950">
                  {STUDENT_WEB_PLAN_LIST[1].displayPrice}/year
                </span>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Stripe will credit the unused part of your monthly plan and show
              the exact amount due before you approve the change. Your annual
              billing year begins on the upgrade date.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={upgradeLoading}
                onClick={() => setUpgradeConfirming(false)}
                className="min-h-12 rounded-2xl border border-slate-200 px-4 text-sm text-slate-700 disabled:opacity-50"
              >
                Keep monthly
              </button>
              <button
                type="button"
                disabled={upgradeLoading}
                onClick={() => void upgradeToAnnual()}
                className="min-h-12 rounded-2xl bg-brand-green px-4 text-sm text-white disabled:opacity-50"
              >
                {upgradeLoading ? "Opening Stripe..." : "Review upgrade"}
              </button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
