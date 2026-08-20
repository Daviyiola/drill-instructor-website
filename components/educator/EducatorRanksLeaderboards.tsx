"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import AppBackLink from "@/components/app/AppBackLink";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction} from "@/lib/api/client";
import {rankForUnitScore, ranks, rankImage, unitRankImage} from "@/lib/ranks";
import EducatorShell from "./EducatorShell";

interface UnitRanking {
  name: string;
  score: number;
  totalPoints: number;
  parent: string;
  level: "platoon" | "battalion" | "corps";
}

type View = "ranks" | "leaderboards";
type UnitView = "battalion" | "corps";

export default function EducatorRanksLeaderboards() {
  const router = useRouter();
  const {user, loading, educatorWorkspace} = useAuth();
  const [view, setView] = useState<View>("ranks");
  const [unitView, setUnitView] = useState<UnitView>("battalion");
  const [units, setUnits] = useState<UnitRanking[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [loadedUnits, setLoadedUnits] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (view !== "leaderboards" || !user || loadedUnits) return;
    setLoadingUnits(true);
    setError("");
    callFunction<{ok: true; rankings: UnitRanking[]}>(
      user,
      "getUnitRankingsHttps",
      {},
    )
      .then((response) => {
        setUnits(response.rankings || []);
        setLoadedUnits(true);
      })
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setLoadingUnits(false));
  }, [loadedUnits, user, view]);

  const visibleUnits = useMemo(
    () => units.filter((unit) => unit.level === unitView),
    [unitView, units],
  );

  if (loading || !user || !educatorWorkspace) {
    return <BrandedLoadingOverlay label="Loading ranks and leaderboards" />;
  }

  return <EducatorShell workspace={educatorWorkspace}>
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
      <AppBackLink className="mb-5" fallbackHref="/app/educator/bootcamps" />
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">Training community</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ranks &amp; Leaderboards</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Explore the student rank path and see how school communities are progressing together.
      </p>

      <div className="mt-7 grid grid-cols-2 rounded-2xl border-2 border-brand-green bg-white p-1">
        {(["ranks", "leaderboards"] as const).map((item) => <button
          key={item}
          type="button"
          onClick={() => setView(item)}
          className={`min-h-12 rounded-xl text-sm font-medium capitalize transition ${view === item ? "bg-brand-green text-white" : "text-slate-500 hover:bg-brand-green/10"}`}
        >{item}</button>)}
      </div>

      {view === "ranks" && <div className="mt-6 space-y-3">
        {ranks.map((rank) => <article key={rank.number} className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <img src={rankImage(rank.number)} alt="" className="h-20 w-20 object-contain" />
          <div>
            <h2 className="text-lg font-semibold uppercase">{rank.name}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{rank.description}</p>
          </div>
        </article>)}
      </div>}

      {view === "leaderboards" && <>
        <label className="mt-6 block max-w-sm text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          Leaderboard
          <span className="relative mt-2 block">
            <select value={unitView} onChange={(event) => setUnitView(event.target.value as UnitView)} className="min-h-12 w-full appearance-none rounded-2xl border-2 border-brand-green bg-white px-4 pr-11 text-sm font-medium text-slate-900 outline-none transition focus:ring-4 focus:ring-brand-green/10">
              <option value="battalion">Battalion</option>
              <option value="corps">Corps</option>
            </select>
            <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-green"><path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </label>

        {error && <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {loadingUnits ? <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading standings…</div> :
          <div className="mt-6 space-y-3">
            {visibleUnits.map((unit, index) => {
              const rank = rankForUnitScore(unit.score);
              return <article key={`${unit.level}-${unit.name}`} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-mist text-sm font-semibold text-brand-green">{index + 1}</span>
                <img src={unitRankImage(rank.number)} alt="" className="h-16 w-16 object-contain" />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{unit.name}</h2>
                  <p className="mt-1 truncate text-xs text-slate-500">{unit.parent || "Global corps"}</p>
                </div>
              </article>;
            })}
            {!visibleUnits.length && !error && <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="text-lg font-medium">No {unitView} rankings available</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">School and location membership determine which standings are visible.</p>
            </div>}
          </div>}
      </>}
    </div>
  </EducatorShell>;
}
