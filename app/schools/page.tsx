import Link from "next/link";
import PageShell from "@/components/PageShell";
import SectionHeading from "@/components/SectionHeading";

const schoolFeatures = [
  "Educator accounts and approval workflow",
  "Student roster and group organization",
  "Practice assignments for individuals or groups",
  "Submission and score visibility",
  "Access codes for school-supported rollout",
  "Mobile and desktop app access",
];

export const metadata = {
  title: "For Schools",
  description: "Bring organized test preparation to students and educators with Drill Instructor school plans.",
};

export default function SchoolsPage() {
  return (
    <PageShell>
      <section className="bg-gradient-to-b from-brand-mist to-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 lg:py-20">
          <div className="max-w-3xl">
            <div className="text-sm font-semibold text-brand-blue">For Schools & Educators</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              Organized practice for classrooms, groups, and school programs.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Drill Instructor helps schools support test preparation with focused student practice, educator assignments, group management, and simple access control.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className="rounded-2xl bg-brand-navy px-5 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800">
                Request School Info
              </Link>
              <Link href="/pricing" className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-900 hover:bg-slate-50">
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6">
        <SectionHeading
          title="Designed for simple rollout"
          description="Schools can start with a focused group of students and educators, then expand as usage grows."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schoolFeatures.map((feature) => (
            <div key={feature} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex gap-3">
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-brand-gold" />
                <p className="text-sm leading-6 text-slate-700">{feature}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-brand-mist/70">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-16 sm:px-6 lg:grid-cols-3">
          {[
            { title: "Assign", desc: "Educators create or select practice and assign it to students or groups." },
            { title: "Complete", desc: "Students complete work through the app and review their results." },
            { title: "Support", desc: "Educators identify completion, scores, and topics that need more attention." },
          ].map((item) => (
            <div key={item.title} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h3 className="text-lg font-semibold text-slate-950">{item.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
