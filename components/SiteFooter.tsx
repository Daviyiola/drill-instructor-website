import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-8 text-sm text-slate-600 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-slate-900">Drill Instructor</div>
            <div className="mt-1 text-slate-500">A product of Davola Technologies LLC.</div>
            <div className="mt-1 text-slate-500">© {new Date().getFullYear()} Drill Instructor. All rights reserved.</div>
          </div>

          <div className="flex flex-wrap gap-4">
            <Link className="hover:text-slate-950" href="/company">Company</Link>
            <Link className="hover:text-slate-950" href="/schools">Schools</Link>
            <Link className="hover:text-slate-950" href="/pricing">Pricing</Link>
            <Link className="hover:text-slate-950" href="/contact">Contact</Link>
            <Link className="hover:text-slate-950" href="/privacy">Privacy</Link>
            <Link className="hover:text-slate-950" href="/terms">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
