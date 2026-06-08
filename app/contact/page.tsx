import PageShell from "@/components/PageShell";
import ContactForm from "@/components/ContactForm";

export const metadata = {
  title: "Contact",
  description:
    "Contact Drill Instructor for student access, school plans, pricing, or demos.",
};

export default function ContactPage() {
  return (
    <PageShell>
      <section className="bg-gradient-to-b from-brand-mist to-white">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6 lg:py-20">
          <div className="max-w-3xl">
            <div className="text-sm font-semibold text-brand-blue">Contact</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              Let’s talk about Drill Instructor.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Reach out for student access, school plans, launch pricing, access
              codes, or demo requests.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-3xl justify-center px-5 pt-8 pb-24 sm:px-6 sm:pt-10 sm:pb-28">
        <div className="w-full">
          <ContactForm />
        </div>
      </section>
    </PageShell>
  );
}
