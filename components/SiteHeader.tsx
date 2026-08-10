import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

const navItems = [
  { label: "Features", href: "/#features" },
  { label: "For Schools", href: "/schools" },
  { label: "Pricing", href: "/pricing" },
];

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3" aria-label="Drill Instructor home">
          <BrandLogo size={54} />
          <div>
            <div className="text-base font-semibold leading-tight text-slate-950">Drill Instructor</div>
            <div className="text-xs text-slate-500">Practice. Review. Improve.</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {navItems.map((item) => (
            <Link key={item.href} className="text-sm font-medium text-slate-600 hover:text-slate-950" href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/app/sign-in"
          className="rounded-2xl bg-brand-green px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-darkolive"
        >
          Get Started
        </Link>
      </div>
    </header>
  );
}
