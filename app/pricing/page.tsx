import PageShell from "@/components/PageShell";

export const metadata = {
  title: "Pricing",
  description:
    "Flexible Drill Instructor access for students and educators.",
};

const planCards = [
  {
    title: "Free",
    eyebrow: "Try Drill Instructor",
    price: "$0",
    cadence: "",
    desc: "For students who want to explore Drill Instructor before upgrading.",
    items: [
      "Limited practice access",
      "Practice Tests 1–2",
      "Basic review tools",
      "Limited progress tracking",
    ],
    highlighted: false,
  },
  {
    title: "Premium Student",
    eyebrow: "For students and parents",
    price: "$6.99",
    cadence: "/ month ($49.99 per year)",
    desc: "For independent students preparing for one selected exam program.",
    items: [
      "1 selected exam program",
      "Full access to practice questions and explanations",
      "Join challenges and compare progress with friends",
      "Bookmark tough questions and review them later",
    ],
    highlighted: true,
  },
  {
    title: "Educator",
    eyebrow: "For tutors and educators",
    price: "$99",
    cadence: "/ year",
    desc: "For educators who want to organize practice and monitor linked students.",
    items: [
      "1 selected exam program",
      "Unlimited linked students",
      "Groups and assignments",
      "Submission review",
      "Student progress monitoring",
      "Student premium access sold separately",
    ],
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <PageShell>
      <section className="bg-gradient-to-b from-brand-mist to-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 lg:py-20">
          <div className="max-w-3xl">
            <div className="text-sm font-semibold text-brand-olive">Pricing</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              Simple access for students and educators.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Start with free practice, unlock one selected exam program as a
              student, or organize practice and assignments as an educator.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-5 sm:px-6">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {planCards.map((plan) => (
            <div
              key={plan.title}
              className={`relative rounded-[2rem] border p-7 shadow-sm ${
                plan.highlighted
                  ? "border-brand-olive bg-white ring-4 ring-brand-olive/10"
                  : "border-slate-200 bg-white"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute right-5 top-5 rounded-full bg-brand-olive px-3 py-1 text-xs font-semibold text-white">
                  Popular
                </div>
              )}

              <div className="text-sm font-semibold text-brand-olive">
                {plan.eyebrow}
              </div>

              <h2 className="mt-3 text-2xl font-semibold text-slate-950">
                {plan.title}
              </h2>

              <div className="mt-5">
                <span className="text-3xl font-semibold text-brand-green">
                  {plan.price}
                </span>
                {plan.cadence && (
                  <span className="text-sm font-medium text-slate-500">
                    {" "}
                    {plan.cadence}
                  </span>
                )}
              </div>

              <p className="mt-4 min-h-16 text-sm leading-6 text-slate-600">
                {plan.desc}
              </p>

              <div className="mt-6 space-y-3">
                {plan.items.map((item) => (
                  <div key={item} className="flex gap-3 text-sm text-slate-700">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-gold" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>

            </div>
          ))}
        </div>

        <div className="mt-10 rounded-[2rem] border border-slate-200 bg-slate-50 p-6 text-sm leading-7 text-slate-600">
          <span className="font-semibold text-slate-950">Note:</span> Premium
          Student and Educator each include one selected exam program. Educator
          access allows progress monitoring and assignments, but student premium
          content is purchased separately through individual subscriptions or
          school-issued access codes.
        </div>
      </section>
    </PageShell>
  );
}
