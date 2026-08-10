"use client";

type SignupRole = "student" | "educator";

export default function SignupWelcomeModal({
  role,
  onClose,
}: {
  role: SignupRole;
  onClose: () => void;
}) {
  const educator = role === "educator";

  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signup-welcome-title"
    >
      <section className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-brand-mist shadow-2xl">
        <div className="overflow-y-auto px-6 pb-4 pt-7 text-center sm:px-9">
          <img
            src={`/app-assets/ranks/Rank${educator ? 9 : 1}.png`}
            alt=""
            className="mx-auto h-36 w-36 object-contain sm:h-44 sm:w-44"
          />
          <h1
            id="signup-welcome-title"
            className="mt-2 text-2xl font-semibold tracking-tight text-slate-950"
          >
            {educator ? "EDUCATOR ACCESS" : "WELCOME RECRUIT"}
          </h1>

          {educator ? (
            <div className="mx-auto mt-5 max-w-md space-y-4 text-left text-sm leading-6 text-slate-700 sm:text-base">
              <p>Welcome to Drill Instructor Educator Access, a structured platform designed to help educators guide, monitor, and strengthen student preparation for standardized tests.</p>
              <p>Each test type on Drill Instructor is organized as a <strong>bootcamp</strong>. Select a bootcamp to oversee student participation, track performance, and support learning at scale.</p>
              <p>As an educator, you help to provide direction, insight, and accountability. Use performance data and progress trends to identify strengths, address gaps, and help students advance with confidence.</p>
              <p>Welcome aboard,</p>
              <p><strong>The Drill Instructor Team</strong></p>
            </div>
          ) : (
            <div className="mx-auto mt-5 max-w-md space-y-4 text-left text-sm leading-6 text-slate-700 sm:text-base">
              <p><strong>Congratulations</strong> on joining Drill Instructor, your ultimate tool for conquering standardized tests with a military-themed twist!</p>
              <p>Take charge of your preparation with fully customized tests. Each test type is referred to as a <strong>bootcamp</strong>. Select your preferred bootcamp to begin.</p>
              <p>Every question you answer earns you valuable points. These points help you rise in rank, from <strong>Recruit</strong> to <strong>General</strong>. So aim high and strive for excellence!</p>
              <p>Welcome aboard,</p>
              <p><strong>The Drill Instructor Team</strong></p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200/80 bg-white/70 p-4 sm:px-9">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="min-h-12 w-full rounded-2xl border border-slate-900 bg-white px-6 text-sm font-semibold text-slate-950 transition hover:bg-brand-green hover:text-white focus:outline-none focus:ring-4 focus:ring-brand-green/20"
          >
            CLOSE
          </button>
        </div>
      </section>
    </div>
  );
}
