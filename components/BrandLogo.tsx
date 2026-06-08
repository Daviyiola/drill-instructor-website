export default function BrandLogo({ size = 42 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-label="Drill Instructor logo"
    >
      <img
        src="/boots.png"
        alt="Drill Instructor logo"
        className="h-full w-full object-contain"
      />
    </div>
  );
}