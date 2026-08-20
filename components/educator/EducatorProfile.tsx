"use client";

import {signOut} from "firebase/auth";
import {FormEvent, useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {useAuth} from "@/components/app/AuthProvider";
import {callFunction} from "@/lib/api/client";
import {getFirebaseAuth} from "@/lib/firebase/client";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import AppBackLink from "@/components/app/AppBackLink";
import {AVATAR_COUNT, avatarAssetUrl, safeAvatarNumber} from "@/lib/profile/avatars";

export default function EducatorProfile() {
  const router = useRouter();
  const {user, educatorWorkspace: workspace, refreshEducatorWorkspace} = useAuth();
  const [form, setForm] = useState({firstName: "", lastName: "", avatarNumber: 1});
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Updating your profile");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deleteStage, setDeleteStage] = useState<0 | 1 | 2>(0);
  const [deleteText, setDeleteText] = useState("");

  useEffect(() => {
    if (!workspace) return;
    setForm({firstName: workspace.educator.firstName, lastName: workspace.educator.lastName, avatarNumber: safeAvatarNumber(workspace.educator.avatarNumber)});
  }, [workspace]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || busy) return;
    if (!form.firstName.trim() || !form.lastName.trim()) { setError("First and last name are required."); return; }
    setBusyLabel("Updating your profile"); setBusy(true); setError(""); setMessage("");
    try {
      await callFunction(user, "updateEducatorProfileHttps", {...form, firstName: form.firstName.trim(), lastName: form.lastName.trim()});
      await refreshEducatorWorkspace();
      setMessage("Your profile has been updated.");
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  }

  async function removeAccount() {
    if (!user || deleteText.trim().toUpperCase() !== "DELETE" || busy) return;
    setDeleteStage(0);
    setBusyLabel("Deleting your account");
    setBusy(true); setError("");
    try {
      await callFunction(user, "deleteAccountHttps", {confirmText: "DELETE"});
      sessionStorage.clear();
      await signOut(getFirebaseAuth()).catch(() => undefined);
      router.replace("/app/sign-in?deleted=1");
    } catch (reason) { setError((reason as Error).message); setDeleteStage(2); setBusy(false); }
  }

  if (!workspace) return null;
  return <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 lg:px-10">
    {busy && <BrandedLoadingOverlay label={busyLabel} />}
    <AppBackLink className="mb-5" />
    <p className="text-xs uppercase tracking-[.2em] text-brand-green/60">Educator account</p>
    <h1 className="mt-2 text-3xl font-semibold">Your profile</h1>
    <p className="mt-2 text-sm text-slate-600">Manage your identity. School membership and permissions are controlled by your school.</p>
    <form onSubmit={save} className="mt-7 grid gap-6 lg:grid-cols-[18rem_1fr]">
      <section className="rounded-[2rem] bg-brand-green p-6 text-center text-white">
        <img src={avatarAssetUrl(form.avatarNumber)} alt="Selected avatar" className="mx-auto h-32 w-32 rounded-full bg-white/10 object-contain" />
        <p className="mt-4 text-lg">{form.firstName || "Educator"} {form.lastName}</p>
        <p className="mt-1 text-sm text-white/65">{workspace.educator.email}</p>
        <label className="mt-5 block text-left text-xs uppercase tracking-wider text-white/65">Avatar<select value={form.avatarNumber} onChange={(event) => setForm({...form, avatarNumber: Number(event.target.value)})} className="mt-2 min-h-11 w-full rounded-xl border border-white/15 bg-white px-3 text-slate-900">{Array.from({length: AVATAR_COUNT}, (_, index) => <option key={index + 1} value={index + 1}>Avatar {index + 1}</option>)}</select></label>
      </section>
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">First name<input value={form.firstName} onChange={(event) => setForm({...form, firstName: event.target.value})} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4" /></label><label className="text-sm">Last name<input value={form.lastName} onChange={(event) => setForm({...form, lastName: event.target.value})} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4" /></label></div>
        <div className="mt-6 rounded-2xl bg-brand-mist p-5"><p className="text-xs uppercase tracking-wider text-brand-green/60">School affiliation</p><p className="mt-2 text-lg">{workspace.school.name}</p><p className="mt-1 text-sm text-slate-500">{workspace.school.state}, {workspace.school.country}</p><p className="mt-3 text-xs text-slate-500">Contact a school administrator to change your access.</p></div>
        {message && <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="mt-6 min-h-12 w-full rounded-2xl bg-brand-green text-sm text-white">SAVE PROFILE</button>
      </section>
    </form>
    <section className="mt-7 rounded-[2rem] border border-red-100 bg-white p-6"><h2 className="text-xl font-medium">Delete account</h2><p className="mt-2 text-sm text-slate-600">This permanently removes your account. The final school super administrator cannot delete their account until another is assigned.</p><button onClick={() => setDeleteStage(1)} className="mt-5 min-h-11 rounded-xl border border-red-200 px-4 text-sm text-red-700">DELETE ACCOUNT</button></section>
    {deleteStage > 0 && <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/45 p-4"><section className="w-full max-w-md rounded-[2rem] bg-white p-6"><h2 className="text-xl font-medium">{deleteStage === 1 ? "Delete your account?" : "Final confirmation"}</h2>{deleteStage === 1 ? <p className="mt-3 text-sm text-slate-600">Your profile and access will be permanently removed.</p> : <label className="mt-4 block text-sm">Type DELETE to continue<input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 px-3" /></label>}<div className="mt-6 grid grid-cols-2 gap-3"><button onClick={() => { setDeleteStage(0); setDeleteText(""); }} className="min-h-11 rounded-xl border border-slate-300">CANCEL</button><button onClick={() => deleteStage === 1 ? setDeleteStage(2) : void removeAccount()} disabled={deleteStage === 2 && deleteText.trim().toUpperCase() !== "DELETE"} className="min-h-11 rounded-xl bg-red-600 text-white disabled:opacity-40">{deleteStage === 1 ? "CONTINUE" : "DELETE"}</button></div></section></div>}
  </div>;
}
