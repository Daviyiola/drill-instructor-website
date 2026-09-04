export type StudentBillingCadence = "monthly" | "annual";

export const STUDENT_WEB_PLANS = Object.freeze({
  monthly: Object.freeze({
    id: "monthly" as const,
    name: "Monthly",
    amountCents: 599,
    displayPrice: "$5.99",
    cadenceLabel: "per month",
  }),
  annual: Object.freeze({
    id: "annual" as const,
    name: "Annual",
    amountCents: 4999,
    displayPrice: "$49.99",
    cadenceLabel: "per year",
  }),
});

export const STUDENT_WEB_PLAN_LIST = [
  STUDENT_WEB_PLANS.monthly,
  STUDENT_WEB_PLANS.annual,
] as const;
