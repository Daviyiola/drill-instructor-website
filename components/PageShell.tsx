import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export default function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white text-slate-950">
      <SiteHeader />
      {children}
      <SiteFooter />
    </main>
  );
}
