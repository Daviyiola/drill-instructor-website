import Link from "next/link";
import PageShell from "@/components/PageShell";
import SectionHeading from "@/components/SectionHeading";

const audienceCards = [
  {
    title: "For Students",
    desc: "Practice by subject, review missed questions, bookmark difficult items, and build better study habits over time.",
  },
  {
    title: "For Parents",
    desc: "Support preparation with a tool that makes practice, review, and progress easier to follow.",
  },
  {
    title: "For Schools",
    desc: "Bring organized practice to groups with educator assignments, student access, and clear completion tracking.",
  },
];

const features = [
  {
    title: "Focused practice",
    desc: "Students work through structured practice sets by exam, subject, or assigned topic.",
  },
  {
    title: "Mistake review",
    desc: "Completed work becomes useful review material, helping students understand what went wrong.",
  },
  {
    title: "Bookmarks",
    desc: "Students can save difficult questions and return to them during later study sessions.",
  },
  {
    title: "Progress tracking",
    desc: "Scores, attempts, streaks, and review history help students see steady improvement.",
  },
  {
    title: "Educator assignments",
    desc: "Educators can assign practice to students or groups when Drill Instructor is used through a school plan.",
  },
  {
    title: "School access codes",
    desc: "Schools and authorized partners can provide access through simple codes.",
  },
];

const steps = [
  {
    number: "01",
    title: "Choose a practice path",
    desc: "Students start with focused practice by exam, subject, or topic.",
  },
  {
    number: "02",
    title: "Practice and review",
    desc: "Students complete questions, check explanations, and revisit missed or bookmarked items.",
  },
  {
    number: "03",
    title: "Track progress",
    desc: "Students, parents, and educators can see completion, scores, and areas that need more attention.",
  },
];

export default function HomePage() {
  return (
    <PageShell>
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-mist to-white">
        <div className="absolute left-1/2 top-10 h-80 w-80 -translate-x-1/2 rounded-full bg-brand-gold/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-20 lg:pt-20">
          <div>
            {/* <div className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              Standardized tests practice support
            </div> */}
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
              Practice smarter for the tests that matter.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
              Drill Instructor helps students prepare with focused practice,
              mistake review, bookmarks, and clear progress tracking — so
              studying feels more organized and consistent.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-500">
              Built for students preparing independently, parents supporting at
              home, and educators organizing practice for groups.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/contact"
                className="inline-flex items-center justify-center rounded-2xl bg-brand-navy px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Get Started
              </Link>
              <Link
                href="/schools"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
              >
                For Schools
              </Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-soft">
            <div className="rounded-[1.5rem] border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-950">
                    Student Progress
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Analytics preview
                  </div>
                </div>

                <div className="rounded-full bg-brand-gold/20 px-3 py-1 text-xs font-semibold text-slate-700">
                  Demo
                </div>
              </div>

              {/* KPI cards */}
              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  { label: "Accuracy", value: "76%", sub: "274/360 correct" },
                  {
                    label: "Sessions",
                    value: "20",
                    sub: "Points: 908",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="text-xs text-slate-500">{item.label}</div>
                    <div className="mt-1 text-xl font-semibold text-slate-950">
                      {item.value}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.sub}
                    </div>
                  </div>
                ))}
              </div>

              {/* Suggested practice */}
              <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-950">
                  Suggested Practice
                </div>

                <div className="mt-3 space-y-2">
                  {[
                    { subject: "Algebra", reason: "Low accuracy" },
                    { subject: "Data Analysis", reason: "Needs more attempts" },
                  ].map((item) => (
                    <div
                      key={item.subject}
                      className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2"
                    >
                      <div className="text-sm font-semibold text-slate-800">
                        {item.subject}
                      </div>
                      <div className="text-xs text-slate-500">
                        {item.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subjects list */}
              <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-slate-950">
                  Subjects
                </div>

                <div className="space-y-2">
                  {[
                    { name: "Math", score: "78%", time: "1m 08s" },
                    // { name: "Reading", score: "84%", time: "58s" },
                    // { name: "Writing", score: "69%", time: "1m 21s" },
                  ].map((subject) => (
                    <div
                      key={subject.name}
                      className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2"
                    >
                      <div className="text-sm font-semibold text-slate-800">
                        {subject.name}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>{subject.score}</span>
                        <span>{subject.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {audienceCards.map((card) => (
            <div
              key={card.title}
              className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h3 className="text-lg font-semibold text-slate-950">
                {card.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {card.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="bg-brand-mist/70">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6">
          <SectionHeading
            eyebrow="Features"
            title="Focused practice without the confusion"
            description="A simple set of tools for practicing, reviewing, and staying consistent — whether a student is preparing alone or through a school plan."
          />

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="text-base font-semibold text-slate-950">
                  {feature.title}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title="Practice, review, improve"
          description="Drill Instructor is designed around the study loop students actually need: focused work, useful feedback, and steady progress."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="rounded-3xl border border-slate-200 p-6"
            >
              <div className="text-sm font-bold text-brand-blue">
                {step.number}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-950">
                {step.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16 sm:px-6">
        <div className="rounded-[2rem] bg-brand-navy px-6 py-10 text-white sm:px-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                Ready to bring more structure to test prep?
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">
                Reach out to learn more about student access, school plans,
                launch pricing, or using access codes for your organization.
              </p>
            </div>
            <Link
              href="/contact"
              className="inline-flex justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-brand-navy hover:bg-slate-100"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
