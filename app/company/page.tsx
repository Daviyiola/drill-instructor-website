import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import PageShell from "@/components/PageShell";

export const metadata = {
  title: "Davola Technologies LLC",
  description:
    "Davola Technologies LLC is the Tennessee technology company that develops and operates Drill Instructor.",
};

export default function CompanyPage() {
  return (
    <PageShell>
      <section className="overflow-hidden bg-gradient-to-b from-brand-mist to-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-24">
          <div className="max-w-3xl">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-brand-green/70">Company</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Davola Technologies LLC
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              We build practical software for learning, organizational operations,
              and connected environments, with an emphasis on clarity and useful
              real-world outcomes.
            </p>
          </div>

          <div className="relative rounded-[2rem] border border-brand-green/15 bg-brand-green p-8 text-white shadow-soft sm:p-10">
            <div className="absolute right-8 top-8 h-24 w-24 rounded-full bg-brand-gold/20 blur-2xl" />
            <p className="relative text-sm font-medium uppercase tracking-[0.18em] text-brand-gold">Our focus</p>
            <p className="relative mt-4 text-2xl leading-9">
              Thoughtful products for people, organizations, and the environments
              they use every day.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-6 lg:py-20">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-brand-green/70">Our work</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            Products built around real workflows.
          </h2>
          <p className="mt-4 leading-7 text-slate-600">
            Davola Technologies develops products at different stages of growth,
            from active platforms to emerging research and prototypes.
          </p>
        </div>

        <div className="mt-9 grid gap-6 lg:grid-cols-2">
          <article className="flex h-full flex-col rounded-[2rem] border border-slate-200 bg-white p-7 shadow-soft sm:p-9">
            <div className="flex items-center gap-4">
              <BrandLogo size={64} />
              <div>
                <h3 className="text-2xl font-semibold text-slate-950">Drill Instructor</h3>
                <p className="mt-1 text-sm text-slate-500">Practice. Review. Improve.</p>
              </div>
            </div>
            <p className="mt-7 max-w-3xl leading-7 text-slate-600">
              Drill Instructor is an exam-preparation, practice, assignment, and
              analytics platform for students, educators, and schools. It combines
              focused exam-style practice with useful review tools and clear
              performance insight.
            </p>
            <div className="mt-auto pt-7">
              <Link
                href="/"
                className="inline-flex rounded-2xl bg-brand-green px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-darkolive"
              >
                Visit Drill Instructor
              </Link>
            </div>
          </article>

          <article className="flex h-full flex-col rounded-[2rem] border border-slate-200 bg-white p-7 shadow-soft sm:p-9">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#eef5f7] p-2.5">
                <img
                  src="/app-assets/church-admin-logo.svg"
                  alt=""
                  className="h-full w-full object-contain"
                />
              </div>
              <div>
                <h3 className="text-2xl font-semibold text-slate-950">Church Admin</h3>
                <p className="mt-1 text-sm text-slate-500">Church operations simplified.</p>
              </div>
            </div>
            <p className="mt-7 leading-7 text-slate-600">
              A modern administrative workspace for churches to manage members,
              attendance, income, expenses, permissions, and reporting through
              clear, dependable workflows.
            </p>
            <div className="mt-auto pt-7">
              <a
                href="https://churchadmins.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-2xl border border-brand-green px-5 py-3 text-sm font-semibold text-brand-green transition hover:bg-brand-green hover:text-white"
              >
                Visit Church Admin
              </a>
            </div>
          </article>
        </div>

        <article className="mt-6 rounded-[2rem] border border-brand-gold/40 bg-[#fffaf0] p-7 sm:p-9">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/70">
            Research and emerging work
          </p>
          <div className="mt-4 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <h3 className="text-2xl font-semibold text-slate-950">Interactive Digital Twin Platform</h3>
              <p className="mt-3 max-w-3xl leading-7 text-slate-600">
                An evolving platform exploring real-time occupancy and indoor
                environmental monitoring through connected sensors and spatially
                contextualized building data.
              </p>
            </div>
            <a
              href="https://etsu-digital-twin.onrender.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-2xl border border-brand-green px-5 py-3 text-sm font-semibold text-brand-green transition hover:bg-brand-green hover:text-white"
            >
              View project
            </a>
          </div>
        </article>
      </section>

      <section className="border-y border-slate-200 bg-brand-mist">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 sm:px-6 md:grid-cols-3">
          <div className="rounded-3xl bg-white p-6">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-green/65">Legal entity</p>
            <p className="mt-3 text-lg text-slate-900">Davola Technologies LLC</p>
          </div>
          <div className="rounded-3xl bg-white p-6">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-green/65">Based in</p>
            <p className="mt-3 text-lg text-slate-900">Tennessee, United States</p>
          </div>
          <div className="rounded-3xl bg-white p-6">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-green/65">Contact</p>
            <a
              href="mailto:hello@davolatechnologies.com"
              className="mt-3 block break-all text-lg text-brand-green underline decoration-brand-green/30 underline-offset-4 hover:decoration-brand-green"
            >
              hello@davolatechnologies.com
            </a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="flex flex-col gap-5 rounded-[2rem] border border-slate-200 bg-white p-7 sm:flex-row sm:items-center sm:justify-between sm:p-9">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">Company information</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Review the policies governing Drill Instructor or contact our team.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link className="text-brand-green underline underline-offset-4" href="/support">Contact us</Link>
            <Link className="text-brand-green underline underline-offset-4" href="/privacy">Privacy</Link>
            <Link className="text-brand-green underline underline-offset-4" href="/terms">Terms</Link>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
