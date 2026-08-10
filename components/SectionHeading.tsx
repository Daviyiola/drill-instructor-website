export default function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      {eyebrow ? (
        <div className="text-sm font-semibold text-brand-olive">
          {eyebrow}
        </div>
      ) : null}

      <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        {title}
      </h2>

      {description ? (
        <p className="mt-4 max-w-4xl text-base leading-7 text-slate-600">
          {description}
        </p>
      ) : null}
    </div>
  );
}