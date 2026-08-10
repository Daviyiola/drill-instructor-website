import BrandLogo from "@/components/BrandLogo";

export default function BrandedLoadingOverlay({
  label = "Loading page",
  fixed = true,
}: {
  label?: string;
  fixed?: boolean;
}) {
  return (
    <div
      className={`z-[90] grid place-items-center bg-slate-950/60 p-5 backdrop-blur-[3px] ${
        fixed ? "fixed inset-0" : "min-h-screen"
      }`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="w-full max-w-xs rounded-[2rem] border border-white/15 bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-brand-mist">
          <BrandLogo size={58} />
        </div>
        <p className="mt-5 text-sm font-medium text-slate-700">{label}</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="di-loading-sweep h-full w-[42%] rounded-full bg-brand-green" />
        </div>
      </div>
    </div>
  );
}
