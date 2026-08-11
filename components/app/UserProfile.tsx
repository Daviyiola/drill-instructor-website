"use client";

import {signOut} from "firebase/auth";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {FormEvent, useEffect, useState} from "react";
import {callFunction} from "@/lib/api/client";
import {getFirebaseAuth} from "@/lib/firebase/client";
import type {
  DrillInstructorProfile,
  ResolvedAccount,
} from "@/lib/types/account";
import AppShell from "./AppShell";
import {useAuth} from "./AuthProvider";
import EmailVerificationCard from "./EmailVerificationCard";
import {AVATAR_COUNT, avatarAssetUrl, safeAvatarNumber} from "@/lib/profile/avatars";

interface CountryOption {
  name: string;
  states: string[];
}

interface EditableProfile {
  firstName: string;
  lastName: string;
  avatarNumber: number;
  profilePermissions: boolean;
  platoonPermissions: boolean;
  corpsName: string;
  battalionName: string;
  platoonName: string;
}

type ChallengeAudience = "anyone" | "squad_only" | "nobody";

interface BlockedStudent {
  id: string;
  firstName: string;
  lastName: string;
  schoolName: string;
  blockedAt: number;
}

const challengeAudienceCopy: Record<ChallengeAudience, {title: string; body: string}> = {
  anyone: {
    title: "Anyone",
    body: "Any discoverable student may add and challenge you.",
  },
  squad_only: {
    title: "My squad only",
    body: "Only students you have personally added to your squad may challenge you.",
  },
  nobody: {
    title: "Nobody",
    body: "Do not accept new friendly challenges.",
  },
};

function profileForm(profile: DrillInstructorProfile): EditableProfile {
  return {
    firstName: String(profile.firstName || ""),
    lastName: String(profile.lastName || ""),
    avatarNumber: safeAvatarNumber(
      profile.avatarNumber || profile.avaterNumber || 1,
    ),
    profilePermissions: profile.profilePermissions === true,
    platoonPermissions: profile.platoonPermissions === true,
    corpsName: String(profile.corpsName || ""),
    battalionName: String(profile.battalionName || ""),
    platoonName: String(profile.platoonName || ""),
  };
}

function withCurrent(values: string[], current: string) {
  return current && !values.includes(current) ? [current, ...values] : values;
}

export default function UserProfile() {
  const router = useRouter();
  const {user, loading} = useAuth();
  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [form, setForm] = useState<EditableProfile | null>(null);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [schools, setSchools] = useState<string[]>([]);
  const [unitOpen, setUnitOpen] = useState(false);
  const [unitDraft, setUnitDraft] = useState({
    corpsName: "",
    battalionName: "",
    platoonName: "",
  });
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [deleteStage, setDeleteStage] = useState<0 | 1 | 2>(0);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [challengeAudience, setChallengeAudience] =
    useState<ChallengeAudience>("anyone");
  const [savedChallengeAudience, setSavedChallengeAudience] =
    useState<ChallengeAudience>("anyone");
  const [blockedCount, setBlockedCount] = useState(0);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedStudents, setBlockedStudents] = useState<BlockedStudent[]>([]);
  const [socialBusy, setSocialBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/app/sign-in");
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      callFunction<ResolvedAccount>(user, "resolveSignInAccountHttps", {
        preferredRole: "student",
        includeStats: true,
      }),
      callFunction<{
        ok: true;
        settings: {challengeAudience: ChallengeAudience};
        blockedCount: number;
      }>(user, "getStudentSocialSettingsHttps", {}),
    ])
      .then(([nextAccount, social]) => {
        setAccount(nextAccount);
        setForm(profileForm(nextAccount.profile));
        setChallengeAudience(social.settings.challengeAudience);
        setSavedChallengeAudience(social.settings.challengeAudience);
        setBlockedCount(social.blockedCount);
      })
      .catch((reason) => setError((reason as Error).message));
  }, [user]);

  useEffect(() => {
    fetch("/app-data/countries-states.json")
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load countries");
        return response.json() as Promise<CountryOption[]>;
      })
      .then(setCountries)
      .catch((reason) => setError((reason as Error).message));
  }, []);

  useEffect(() => {
    if (
      !unitOpen ||
      !user ||
      !unitDraft.corpsName ||
      !unitDraft.battalionName
    ) {
      setSchools([]);
      return;
    }

    let cancelled = false;
    setLoadingSchools(true);
    callFunction<
      {ok: true; schools: Array<{name: string}>},
      {country: string; state: string}
    >(user, "listSchoolsHttps", {
      country: unitDraft.corpsName,
      state: unitDraft.battalionName,
    })
      .then((response) => {
        if (!cancelled) {
          setSchools(response.schools.map((school) => school.name));
        }
      })
      .catch((reason) => {
        if (!cancelled) setError((reason as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingSchools(false);
      });

    return () => {
      cancelled = true;
    };
  }, [unitDraft.battalionName, unitDraft.corpsName, unitOpen, user]);

  function update<K extends keyof EditableProfile>(
    key: K,
    value: EditableProfile[K],
  ) {
    setForm((current) => (current ? {...current, [key]: value} : current));
    setSaved("");
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!user || !account || !form || saving || !account.emailVerified) return;
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    if (!firstName || !lastName) {
      setError("First and last name are required.");
      return;
    }

    setSaving(true);
    setSaved("");
    setError("");
    try {
      const original = profileForm(account.profile);
      const unitChanged =
        original.corpsName !== form.corpsName ||
        original.battalionName !== form.battalionName ||
        original.platoonName !== form.platoonName;

      if (unitChanged) {
        if (!form.corpsName) {
          throw new Error("Choose a corps or country before saving.");
        }
        await callFunction<
          {
            ok: true;
            selected: {country: string; state: string; school: string};
          },
          {country: string; state: string; school: string}
        >(user, "joinUnitHttps", {
          country: form.corpsName,
          state: form.battalionName,
          school: form.platoonName,
        });
      }

      const response = await callFunction<
        {ok: true; profile: EditableProfile},
        {
          firstName: string;
          lastName: string;
          avatarNumber: number;
          profilePermissions: boolean;
          platoonPermissions: boolean;
        }
      >(user, "updateStudentProfileHttps", {
        firstName,
        lastName,
        avatarNumber: form.avatarNumber,
        profilePermissions: form.profilePermissions,
        platoonPermissions: form.platoonPermissions,
      });

      if (challengeAudience !== savedChallengeAudience) {
        const socialResponse = await callFunction<{
          ok: true;
          settings: {challengeAudience: ChallengeAudience};
        }, {challengeAudience: ChallengeAudience}>(
          user,
          "updateStudentSocialSettingsHttps",
          {challengeAudience},
        );
        setChallengeAudience(socialResponse.settings.challengeAudience);
        setSavedChallengeAudience(socialResponse.settings.challengeAudience);
      }

      const nextForm = {
        ...form,
        ...response.profile,
        corpsName: form.corpsName,
        battalionName: form.battalionName,
        platoonName: form.platoonName,
      };
      setForm(nextForm);
      setAccount({
        ...account,
        profile: {
          ...account.profile,
          ...nextForm,
          avaterNumber: nextForm.avatarNumber,
        },
      });
      setSaved("Your profile has been updated.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    if (!user || deleteText.trim().toUpperCase() !== "DELETE" || deleting) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      await callFunction<{ok: true}, {confirmText: "DELETE"}>(
        user,
        "deleteAccountHttps",
        {confirmText: "DELETE"},
      );
      await signOut(getFirebaseAuth()).catch(() => undefined);
      router.replace("/app/sign-in?deleted=1");
    } catch (reason) {
      setError((reason as Error).message);
      setDeleteStage(0);
      setDeleting(false);
    }
  }

  async function openBlockedStudents() {
    if (!user || socialBusy || blockedCount < 1) return;
    setSocialBusy(true);
    setError("");
    try {
      const response = await callFunction<{
        ok: true;
        blockedStudents: BlockedStudent[];
      }>(user, "getBlockedStudentsHttps", {});
      setBlockedStudents(response.blockedStudents);
      setBlockedOpen(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSocialBusy(false);
    }
  }

  async function unblockStudent(student: BlockedStudent) {
    if (!user || socialBusy) return;
    setSocialBusy(true);
    setError("");
    try {
      await callFunction(user, "unblockStudentHttps", {studentId: student.id});
      const next = blockedStudents.filter((row) => row.id !== student.id);
      setBlockedStudents(next);
      setBlockedCount(next.length);
      if (!next.length) setBlockedOpen(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSocialBusy(false);
    }
  }

  if (!account || !form) {
    return (
      <div className="grid min-h-screen place-items-center bg-brand-mist px-6 text-center text-sm text-slate-600">
        {error || "Loading your profile…"}
      </div>
    );
  }

  const name =
    [form.firstName, form.lastName].filter(Boolean).join(" ") || "Student";
  const avatarUrl = avatarAssetUrl(form.avatarNumber);
  const points = Number(account.profile.totalPoints || account.profile.points || 0);
  const countryNames = withCurrent(
    countries.map((country) => country.name),
    unitDraft.corpsName,
  );
  const draftStates =
    countries.find((country) => country.name === unitDraft.corpsName)?.states ||
    [];
  const stateNames = withCurrent(draftStates, unitDraft.battalionName);
  const schoolNames = withCurrent(schools, unitDraft.platoonName);

  return (
    <AppShell profile={{...account.profile, ...form}}>
      <form
        onSubmit={saveProfile}
        className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10"
      >
        <Link
          href="/app"
          className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-brand-green"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-5 w-5 fill-none stroke-current"
            strokeWidth="1.8"
          >
            <path
              d="m14.5 6.5-5.5 5.5 5.5 5.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Bootcamps
        </Link>

        <section className="mt-6 rounded-[2rem] bg-brand-green p-6 text-white sm:p-8">
          <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
            <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full bg-white/10 p-2">
              <img
                src={avatarUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-gold">
                Student profile
              </p>
              <h1 className="mt-2 truncate text-3xl font-semibold">{name}</h1>
              <p className="mt-2 text-sm text-white/70">
                {account.profile.currentRank || "Recruit"} ·{" "}
                {points.toLocaleString()} points
              </p>
             
            </div>
          </div>
        </section>

        {!account.emailVerified && <div className="mt-6"><EmailVerificationCard /></div>}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="flex flex-col gap-6">
            <section className="order-2 rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-8">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
                Personal details
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                Your account
              </h2>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="text-sm text-slate-700">
                  First name
                  <input
                    disabled={!account.emailVerified}
                    value={form.firstName}
                    onChange={(event) => update("firstName", event.target.value)}
                    maxLength={60}
                    required
                    className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-slate-950 outline-none focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Last name
                  <input
                    disabled={!account.emailVerified}
                    value={form.lastName}
                    onChange={(event) => update("lastName", event.target.value)}
                    maxLength={60}
                    required
                    className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 px-4 text-slate-950 outline-none focus:border-brand-green focus:ring-4 focus:ring-brand-green/10"
                  />
                </label>
                <label className="text-sm text-slate-700 sm:col-span-2">
                  Email
                  <input
                    value={String(account.profile.email || user?.email || "")}
                    disabled
                    className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 text-slate-500"
                  />
                </label>
              </div>
            </section>

            <section className="order-3 rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
                    Training unit
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                    Platoon, battalion and corps
                  </h2>
                </div>
                <button
                  type="button"
                  disabled={!account.emailVerified}
                  onClick={() => {
                    setError("");
                    setUnitDraft({
                      corpsName: form.corpsName,
                      battalionName: form.battalionName,
                      platoonName: form.platoonName,
                    });
                    setUnitOpen(true);
                  }}
                  className="min-h-11 rounded-2xl border border-brand-green/25 px-4 text-sm text-brand-green"
                >
                  Change unit
                </button>
              </div>
              <dl className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  ["Platoon", form.platoonName || "Not joined"],
                  ["Battalion", form.battalionName || "Not selected"],
                  ["Corps", form.corpsName || "Not selected"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-brand-mist p-4">
                    <dt className="text-xs uppercase tracking-wider text-slate-400">
                      {label}
                    </dt>
                    <dd className="mt-2 break-words text-sm text-slate-900">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="order-1 rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-8">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
                Avatar
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                Choose your profile badge
              </h2>
              <div className="mt-6 grid grid-cols-5 gap-3 sm:grid-cols-10">
                {Array.from({length: AVATAR_COUNT}, (_, index) => index + 1).map(
                  (avatar) => (
                    <button
                      key={avatar}
                      type="button"
                      disabled={!account.emailVerified}
                      onClick={() => update("avatarNumber", avatar)}
                      aria-label={`Choose avatar ${avatar}`}
                      aria-pressed={form.avatarNumber === avatar}
                      className={`aspect-square rounded-2xl p-1 transition ${
                        form.avatarNumber === avatar
                          ? "bg-brand-gold ring-2 ring-brand-green ring-offset-2"
                          : "bg-brand-mist hover:bg-brand-gold/20"
                      }`}
                    >
                      <img
                        src={avatarAssetUrl(avatar)}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    </button>
                  ),
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-8">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
                Permissions
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                Privacy and school access
              </h2>
              <div className="mt-6 space-y-4">
                <PermissionToggle
                  checked={form.profilePermissions}
                  onChange={(checked) =>
                    account.emailVerified && update("profilePermissions", checked)
                  }
                  title="Profile discovery"
                  body="Show my name and rank in leaderboards and squad search. Test answers and private analytics are never exposed by this setting."
                />
                <PermissionToggle
                  checked={form.platoonPermissions}
                  onChange={(checked) =>
                    account.emailVerified && update("platoonPermissions", checked)
                  }
                  title="School learning access"
                  body="Allow my joined school to assign tests and view learning analytics such as scores, timing, subjects and modules."
                />
                <button
                  type="button"
                  disabled={!account.emailVerified || socialBusy}
                  onClick={() => setChallengeOpen(true)}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl bg-brand-mist p-4 text-left disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-medium text-slate-900">
                      Friendly challenges
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      {challengeAudienceCopy[challengeAudience].title} · Control who may send you a challenge.
                    </span>
                  </span>
                  <span aria-hidden className="text-xl text-brand-green">›</span>
                </button>
                {blockedCount > 0 && (
                  <button
                    type="button"
                    disabled={socialBusy}
                    onClick={() => void openBlockedStudents()}
                    className="flex w-full items-center justify-between gap-4 rounded-2xl bg-brand-mist p-4 text-left disabled:opacity-50"
                  >
                    <span>
                      <span className="block text-sm font-medium text-slate-900">
                        Blocked accounts · {blockedCount}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        Review accounts you have blocked.
                      </span>
                    </span>
                    <span aria-hidden className="text-xl text-brand-green">›</span>
                  </button>
                )}
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-8">
              <button
                type="submit"
                disabled={saving || !account.emailVerified}
                className="min-h-14 w-full rounded-2xl bg-brand-green px-5 text-sm text-white transition hover:bg-brand-darkolive disabled:opacity-50"
              >
                {saving ? "Saving changes…" : "Save profile"}
              </button>
              {saved && (
                <p
                  role="status"
                  className="mt-4 rounded-2xl bg-green-50 p-4 text-sm text-green-800"
                >
                  {saved}
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700"
                >
                  {error}
                </p>
              )}
            </section>

            <section className="rounded-[2rem] border border-red-200 bg-red-50 p-6">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-red-500">
                Account deletion
              </p>
              <h2 className="mt-2 text-xl font-semibold text-red-950">
                Delete Drill Instructor account
              </h2>
              <p className="mt-3 text-sm leading-6 text-red-800/75">
                Permanently removes your profile, saved progress, cloud drills,
                unit membership and sign-in access. This cannot be undone.
              </p>
              <button
                type="button"
                onClick={() => setDeleteStage(1)}
                className="mt-5 min-h-11 rounded-2xl border border-red-300 bg-white px-4 text-sm text-red-700"
              >
                Delete account
              </button>
            </section>
          </div>
        </div>
      </form>

      {unitOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-5 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="unit-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"
          >
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">
              Training unit
            </p>
            <h2
              id="unit-title"
              className="mt-2 text-2xl font-semibold text-slate-950"
            >
              Join your school hierarchy
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Corps represents your country, battalion your state or region,
              and platoon your school.
            </p>
            <div className="mt-6 space-y-5">
              <label className="block text-sm text-slate-700">
                Corps / country
                <select
                  value={unitDraft.corpsName}
                  onChange={(event) => {
                    setUnitDraft({
                      corpsName: event.target.value,
                      battalionName: "",
                      platoonName: "",
                    });
                  }}
                  className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4"
                >
                  <option value="">Choose country</option>
                  {countryNames.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-700">
                Battalion / state
                <select
                  value={unitDraft.battalionName}
                  onChange={(event) => {
                    setUnitDraft((current) => ({
                      ...current,
                      battalionName: event.target.value,
                      platoonName: "",
                    }));
                  }}
                  disabled={!unitDraft.corpsName || stateNames.length === 0}
                  className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 disabled:bg-slate-100"
                >
                  <option value="">Choose state or region</option>
                  {stateNames.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-700">
                Platoon / school
                <select
                  value={unitDraft.platoonName}
                  onChange={(event) =>
                    setUnitDraft((current) => ({
                      ...current,
                      platoonName: event.target.value,
                    }))
                  }
                  disabled={!unitDraft.battalionName || loadingSchools}
                  className="mt-2 min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 disabled:bg-slate-100"
                >
                  <option value="">
                    {loadingSchools
                      ? "Loading schools…"
                      : schoolNames.length
                        ? "Choose school"
                        : "No listed school"}
                  </option>
                  {schoolNames.map((school) => (
                    <option key={school} value={school}>
                      {school}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setUnitOpen(false)}
                className="min-h-12 rounded-2xl border border-slate-200 px-4 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!unitDraft.corpsName}
                onClick={() => {
                  update("corpsName", unitDraft.corpsName);
                  update("battalionName", unitDraft.battalionName);
                  update("platoonName", unitDraft.platoonName);
                  setUnitOpen(false);
                }}
                className="min-h-12 rounded-2xl bg-brand-green px-4 text-sm text-white disabled:opacity-50"
              >
                Use this unit
              </button>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-400">
              The membership change is finalized when you save your profile.
            </p>
          </section>
        </div>
      )}

      {deleteStage > 0 && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-5 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"
          >
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-red-500">
              Permanent action
            </p>
            <h2
              id="delete-title"
              className="mt-2 text-2xl font-semibold text-slate-950"
            >
              {deleteStage === 1
                ? "Delete your account?"
                : "Final confirmation"}
            </h2>
            {deleteStage === 1 ? (
              <p className="mt-4 text-sm leading-6 text-slate-600">
                Your Drill Instructor profile, saved progress, unit membership
                and sign-in access will be permanently removed.
              </p>
            ) : (
              <>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Type <strong>DELETE</strong> to confirm. There is no recovery
                  after this step.
                </p>
                <input
                  autoFocus
                  value={deleteText}
                  onChange={(event) => setDeleteText(event.target.value)}
                  className="mt-5 min-h-12 w-full rounded-2xl border border-red-300 px-4 text-center tracking-[0.16em] outline-none focus:ring-4 focus:ring-red-100"
                />
              </>
            )}
            <div className="mt-7 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleteStage(0);
                  setDeleteText("");
                }}
                className="min-h-12 rounded-2xl border border-slate-200 px-4 text-sm text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  deleting ||
                  (deleteStage === 2 &&
                    deleteText.trim().toUpperCase() !== "DELETE")
                }
                onClick={() => {
                  if (deleteStage === 1) setDeleteStage(2);
                  else void deleteAccount();
                }}
                className="min-h-12 rounded-2xl bg-red-700 px-4 text-sm text-white disabled:opacity-50"
              >
                {deleting
                  ? "Deleting…"
                  : deleteStage === 1
                    ? "Continue"
                    : "Delete forever"}
              </button>
            </div>
          </section>
        </div>
      )}

      {challengeOpen && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-5 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="challenge-pref-title" className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">Privacy</p>
            <h2 id="challenge-pref-title" className="mt-2 text-2xl font-semibold text-slate-950">Who can challenge you?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">Choose who may send you a new friendly challenge. Existing squad connections are not removed.</p>
            <div className="mt-6 space-y-3">
              {(Object.keys(challengeAudienceCopy) as ChallengeAudience[]).map((value) => {
                const option = challengeAudienceCopy[value];
                return <button key={value} type="button" disabled={socialBusy} onClick={() => { setChallengeAudience(value); setSaved(""); }} className={`w-full rounded-2xl border p-4 text-left transition ${challengeAudience === value ? "border-brand-green bg-brand-mist" : "border-slate-200 hover:border-brand-green/50"}`}>
                  <span className="flex items-start gap-3">
                    <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${challengeAudience === value ? "border-brand-green" : "border-slate-300"}`}>
                      {challengeAudience === value && <span className="h-2.5 w-2.5 rounded-full bg-brand-green" />}
                    </span>
                    <span><span className="block text-sm font-medium text-slate-950">{option.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.body}</span></span>
                  </span>
                </button>;
              })}
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">Your selection will be applied when you save your profile.</p>
            <button type="button" disabled={socialBusy} onClick={() => setChallengeOpen(false)} className="mt-6 min-h-11 w-full rounded-2xl border border-slate-200 text-sm text-slate-700">Close</button>
          </section>
        </div>
      )}

      {blockedOpen && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-5 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="blocked-title" className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-green/60">Privacy</p>
            <h2 id="blocked-title" className="mt-2 text-2xl font-semibold text-slate-950">Blocked accounts</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">Unblocking does not restore previous squad membership or challenges.</p>
            <div className="mt-6 space-y-3">
              {blockedStudents.map((student) => <div key={student.id} className="flex items-center justify-between gap-4 rounded-2xl bg-brand-mist p-4">
                <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-950">{[student.firstName, student.lastName].filter(Boolean).join(" ") || "Unavailable account"}</p>{student.schoolName && <p className="mt-1 truncate text-xs text-slate-500">{student.schoolName}</p>}</div>
                <button type="button" disabled={socialBusy} onClick={() => void unblockStudent(student)} className="min-h-9 shrink-0 rounded-xl border border-brand-green px-3 text-xs text-brand-green disabled:opacity-50">UNBLOCK</button>
              </div>)}
            </div>
            <button type="button" disabled={socialBusy} onClick={() => setBlockedOpen(false)} className="mt-6 min-h-11 w-full rounded-2xl border border-slate-200 text-sm text-slate-700">Close</button>
          </section>
        </div>
      )}
    </AppShell>
  );
}

function PermissionToggle({
  checked,
  onChange,
  title,
  body,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  body: string;
}) {
  return (
    <label className="flex cursor-pointer gap-4 rounded-2xl bg-brand-mist p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-brand-green peer-focus-visible:ring-4 peer-focus-visible:ring-brand-green/20 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5"
      />
      <span>
        <span className="block text-sm font-medium text-slate-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {body}
        </span>
      </span>
    </label>
  );
}
