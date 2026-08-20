import PageShell from "@/components/PageShell";
import type {LegalDocument} from "@/lib/legal/policies";
import LegalNavigation from "./LegalNavigation";

export default function LegalDocumentPage({document, alternateHref, alternateLabel}: {document: LegalDocument; alternateHref: string; alternateLabel: string}) {
  return (
    <PageShell>
      <article className="mx-auto max-w-3xl px-5 py-16 sm:px-6">
        <LegalNavigation alternateHref={alternateHref} alternateLabel={alternateLabel} />
        <p className="mt-8 text-sm font-semibold text-brand-olive">{document.title}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">{document.title}</h1>
        <p className="mt-4 text-sm text-slate-500">Last updated: {document.updated}</p>
        <div className="mt-10 space-y-4 text-slate-700">
          {document.introduction.map((paragraph) => <p key={paragraph} className="leading-7">{paragraph}</p>)}
        </div>
        <div className="mt-10 space-y-6 text-slate-700">
          {document.sections.map((section) => (
            <section key={section.title} className="border-t border-slate-200 pt-6">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph) => <p key={paragraph} className="leading-7">{paragraph}</p>)}
              </div>
            </section>
          ))}
        </div>
      </article>
    </PageShell>
  );
}
