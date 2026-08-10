"use client";

import {useRouter} from "next/navigation";
import {useEffect, useMemo, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {rankForPoints, rankForUnitScore, rankImage} from "@/lib/ranks";
import type {ResolvedAccount} from "@/lib/types/account";
import AppShell from "./AppShell";
import AppBackLink from "./AppBackLink";
import {useAuth} from "./AuthProvider";

interface SquadProfile {
  id: string;
  firstName: string;
  lastName: string;
  totalPoints: number;
  platoonName: string;
}

interface UnitRanking {
  name: string;
  score: number;
  totalPoints: number;
  parent: string;
  level: "platoon" | "battalion" | "corps";
}

type LeaderboardTab = "squad" | "battalion" | "corps";

function customIdPrefix(email: string) {
  return `user_${email.toLowerCase().replace(/[.\s,#$[\]\\/]/g, "")}`;
}

export default function Leaderboards() {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [tab, setTab] = useState<LeaderboardTab>("squad");
  const [squad, setSquad] = useState<SquadProfile[]>([]);
  const [units, setUnits] = useState<UnitRanking[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SquadProfile[]>([]);
  const [selected, setSelected] = useState<SquadProfile | null>(null);
  const [removing, setRemoving] = useState<SquadProfile | null>(null);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  async function load() {
    if (!user) return;
    setError("");
    try {
      const nextAccount = await callFunction<ResolvedAccount>(
        user,
        "resolveSignInAccountHttps",
        {preferredRole: "student"},
      );
      const memberResponse = await callFunction<
        {ok: true; memberIds: string[]}
      >(user, "getMySquadMemberIdsHttps", {});
      const [profilesResponse, rankingResponse] = await Promise.allSettled([
        callFunction<{ok: true; results: SquadProfile[]}>(
          user,
          "getSquadProfilesHttps",
          {memberIds: memberResponse.memberIds},
        ),
        callFunction<{ok: true; rankings: UnitRanking[]}>(
          user,
          "getUnitRankingsHttps",
          {},
        ),
      ]);
      setAccount(nextAccount);
      setSquad(
        profilesResponse.status === "fulfilled"
          ? profilesResponse.value.results.sort(
              (a, b) => Number(b.totalPoints) - Number(a.totalPoints),
            )
          : [],
      );
      setUnits(
        rankingResponse.status === "fulfilled"
          ? rankingResponse.value.rankings
          : [],
      );
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || !manageOpen || query.trim().length < 5) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await callFunction<
          {ok: true; results: SquadProfile[]},
          {prefix: string; role: "student"}
        >(user, "searchUsersByPrefixHttps", {
          prefix: customIdPrefix(query.trim()),
          role: "student",
        });
        const currentIds = new Set(squad.map((row) => row.id));
        setResults(
          response.results.filter(
            (row) =>
              row.id !== account?.customUserId && !currentIds.has(row.id),
          ),
        );
      } catch (reason) {
        setError((reason as Error).message);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [account?.customUserId, manageOpen, query, squad, user]);

  const visibleUnits = useMemo(
    () => units.filter((row) => row.level === tab),
    [tab, units],
  );

  async function addMember() {
    if (!user || !selected) return;
    setMutating(true);
    try {
      await callFunction(user, "addSquadMemberHttps", {
        memberId: selected.id,
      });
      setSelected(null);
      setQuery("");
      setManageOpen(false);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMutating(false);
    }
  }

  async function removeMember() {
    if (!user || !removing) return;
    setMutating(true);
    try {
      await callFunction(user, "removeSquadMemberHttps", {
        memberId: removing.id,
      });
      setRemoving(null);
      await load();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setMutating(false);
    }
  }

  if (!account) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-5 text-center text-sm font-semibold text-slate-600">
        {error || "Loading leaderboards…"}
      </div>
    );
  }

  return (
    <AppShell profile={account.profile}>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10">
        <AppBackLink className="mb-5" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-green/60">
              Friendly competition
            </p>
            <h1 className="mt-2 text-3xl font-black">Leaderboards</h1>
            <p className="mt-2 text-sm text-slate-600">
              Compare your squad and the units you train with.
            </p>
          </div>
          {tab === "squad" && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="min-h-11 rounded-2xl bg-brand-green px-5 text-sm font-black text-white"
            >
              Add squad member
            </button>
          )}
        </div>

        <div className="mt-7 grid grid-cols-3 rounded-2xl border-2 border-brand-green bg-white p-1">
          {(["squad", "battalion", "corps"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`min-h-12 rounded-xl text-xs font-black uppercase tracking-wider sm:text-sm ${
                tab === item
                  ? "bg-brand-green text-white"
                  : "text-slate-500"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-5 rounded-2xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-3">
          {tab === "squad" &&
            squad.map((member, index) => {
              const rank = rankForPoints(member.totalPoints);
              const isSelf = member.id === account.customUserId;
              return (
                <div
                  key={member.id}
                  className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center sm:p-5"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-mist text-sm font-black text-brand-green">
                    {index + 1}
                  </span>
                  <img
                    src={rankImage(rank.number)}
                    alt=""
                    className="h-16 w-16 object-contain"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-lg font-black">
                      {[member.firstName, member.lastName]
                        .filter(Boolean)
                        .join(" ") || "Squad member"}
                      {isSelf && (
                        <span className="ml-2 text-xs text-brand-green">
                          You
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {rank.name.toUpperCase()}
                      {member.platoonName ? ` · ${member.platoonName}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Points
                      </p>
                      <p className="text-lg font-black">
                        {Number(member.totalPoints || 0).toLocaleString()}
                      </p>
                    </div>
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => setRemoving(member)}
                        className="mt-1 text-xs font-bold text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

          {tab !== "squad" &&
            visibleUnits.map((unit, index) => {
              const rank = rankForUnitScore(unit.score);
              return (
                <div
                  key={`${unit.level}-${unit.name}`}
                  className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center sm:p-5"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-mist text-sm font-black text-brand-green">
                    {index + 1}
                  </span>
                  <img
                    src={rankImage(rank.number)}
                    alt=""
                    className="h-16 w-16 object-contain"
                  />
                  <div>
                    <p className="text-lg font-black">{unit.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {unit.parent || "Global corps"} · {rank.name}
                    </p>
                  </div>
                  <div className="sm:text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Score
                    </p>
                    <p className="text-lg font-black">
                      {Math.round(Number(unit.score || 0))}%
                    </p>
                  </div>
                </div>
              );
            })}
        </div>

        {((tab === "squad" && !squad.length) ||
          (tab !== "squad" && !visibleUnits.length)) && (
          <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-lg font-black">
              {tab === "squad"
                ? "Build your squad"
                : `No ${tab} rankings available`}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {tab === "squad"
                ? "Search for friends by email and add them to your personal leaderboard."
                : "Your school and location membership determine which unit rankings are visible."}
            </p>
          </div>
        )}
      </div>

      {manageOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4">
          <div className="mx-auto flex min-h-full max-w-2xl items-center py-5">
            <div className="w-full rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-brand-green/60">
                    Squad discovery
                  </p>
                  <h2 className="mt-2 text-2xl font-black">
                    Search for a new squad member
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setManageOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-full bg-brand-mist text-xl"
                  aria-label="Close squad search"
                >
                  ×
                </button>
              </div>
              <input
                type="email"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(null);
                }}
                placeholder="Search by email"
                className="mt-6 min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-sm outline-none focus:border-brand-green"
              />
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                {results.map((member) => {
                  const rank = rankForPoints(member.totalPoints);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelected(member)}
                      className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border p-3 text-left ${
                        selected?.id === member.id
                          ? "border-brand-green bg-brand-mist"
                          : "border-slate-200"
                      }`}
                    >
                      <img
                        src={rankImage(rank.number)}
                        alt=""
                        className="h-12 w-12 object-contain"
                      />
                      <div>
                        <p className="font-black">
                          {[member.firstName, member.lastName]
                            .filter(Boolean)
                            .join(" ")}
                        </p>
                        <p className="text-xs text-slate-500">
                          {rank.name} ·{" "}
                          {Number(member.totalPoints).toLocaleString()} points
                        </p>
                      </div>
                      <span className="text-sm font-black text-brand-green">
                        {selected?.id === member.id ? "Selected" : "Choose"}
                      </span>
                    </button>
                  );
                })}
                {searching && (
                  <p className="p-6 text-center text-sm text-slate-500">
                    Searching…
                  </p>
                )}
                {!searching && query.trim().length >= 5 && !results.length && (
                  <p className="p-6 text-center text-sm text-slate-500">
                    No searchable students found for that email.
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={!selected || mutating}
                onClick={() => void addMember()}
                className="mt-5 min-h-12 w-full rounded-2xl bg-brand-green text-sm font-black text-white disabled:opacity-40"
              >
                {mutating ? "Adding…" : "Add member"}
              </button>
            </div>
          </div>
        </div>
      )}

      {removing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 text-center shadow-2xl">
            <h2 className="text-2xl font-black">Remove squad member?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Remove {[removing.firstName, removing.lastName].join(" ")} from
              your personal squad?
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRemoving(null)}
                className="min-h-12 rounded-2xl border border-slate-200 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mutating}
                onClick={() => void removeMember()}
                className="min-h-12 rounded-2xl bg-red-700 text-sm font-black text-white"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
