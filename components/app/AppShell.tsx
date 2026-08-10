"use client";

import {signOut} from "firebase/auth";
import {usePathname, useRouter} from "next/navigation";
import {MouseEvent, useEffect, useState} from "react";
import type {DrillInstructorProfile} from "@/lib/types/account";
import {getFirebaseAuth} from "@/lib/firebase/client";
import {avatarAssetUrl} from "@/lib/profile/avatars";
import BrandedLoadingOverlay from "./BrandedLoadingOverlay";
import TopAccountBar from "./TopAccountBar";

function displayName(profile: DrillInstructorProfile) {
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Student";
}

function isStudentHomeSurface(pathname: string) {
  return pathname === "/app" || pathname === "/app/bootcamps" ||
    /^\/app\/bootcamps\/[^/]+$/.test(pathname);
}

function loadingLabel(pathname: string) {
  if (pathname.includes("/leaderboards")) return "Loading leaderboards";
  if (pathname.includes("/ranks")) return "Loading ranks";
  if (pathname.includes("/profile")) return "Loading your profile";
  if (pathname.includes("/contact")) return "Loading support";
  if (pathname.includes("/credits")) return "Loading credits";
  if (pathname.includes("/terms")) return "Loading terms";
  if (pathname.includes("/privacy")) return "Loading privacy policy";
  if (pathname.includes("/bootcamps/")) return "Loading bootcamp";
  return "Loading bootcamps";
}

export default function AppShell({profile, children}: {profile: DrillInstructorProfile; children: React.ReactNode}) {
  const pathname = usePathname();
  const router = useRouter();
  const [routeLoading, setRouteLoading] = useState("");
  const name = displayName(profile);
  const avatarUrl = avatarAssetUrl(profile.avatarNumber || profile.avaterNumber || 1);
  const showTopBar = isStudentHomeSurface(pathname);

  useEffect(() => setRouteLoading(""), [pathname]);

  function handleNavigation(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest("a");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin === window.location.origin && destination.pathname.startsWith("/app") && destination.pathname !== pathname) {
      setRouteLoading(loadingLabel(destination.pathname));
    }
  }

  async function handleSignOut() {
    sessionStorage.clear();
    await signOut(getFirebaseAuth());
    router.replace("/app/sign-in");
  }

  const items = [
    {href: "/app/profile", label: "My profile", detail: "Account and training identity"},
    {href: "/app/leaderboards", label: "Leaderboards", detail: "Squad and unit standings"},
    {href: "/app/ranks", label: "Ranks", detail: "Recruit-to-General progression"},
    {href: "/app/terms", label: "Terms of use", detail: "Rules for using Drill Instructor"},
    {href: "/app/privacy", label: "Privacy policy", detail: "How your information is handled"},
    {href: "/app/credits", label: "Credits", detail: "Artwork acknowledgements"},
    {href: "/app/contact", label: "Help & support", detail: "Questions, feedback, or support"},
  ];

  return <div className="di-app min-h-screen bg-brand-mist text-slate-950" onClickCapture={handleNavigation}>
    {showTopBar && <TopAccountBar homeHref="/app" name={name} subtitle={profile.currentRank || "Student"} avatarUrl={avatarUrl} items={items} onSignOut={handleSignOut} />}
    <main>{children}</main>
    {routeLoading && <BrandedLoadingOverlay label={routeLoading} />}
  </div>;
}
