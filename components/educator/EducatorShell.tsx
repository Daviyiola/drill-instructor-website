"use client";

import {signOut} from "firebase/auth";
import {usePathname, useRouter} from "next/navigation";
import {MouseEvent, useEffect, useState} from "react";
import {getFirebaseAuth} from "@/lib/firebase/client";
import type {EducatorWorkspace} from "@/lib/types/educator";
import {avatarAssetUrl, safeAvatarNumber} from "@/lib/profile/avatars";
import BrandedLoadingOverlay from "@/components/app/BrandedLoadingOverlay";
import TopAccountBar from "@/components/app/TopAccountBar";

function routeLabel(path: string) {
  if (path.includes("/admin")) return "Loading school administration";
  if (path.includes("/profile")) return "Loading your profile";
  if (path.includes("/contact")) return "Loading support";
  if (path.includes("/credits")) return "Loading credits";
  if (path.includes("/terms")) return "Loading terms";
  if (path.includes("/privacy")) return "Loading privacy policy";
  return "Loading educator workspace";
}

function isEducatorHomeSurface(pathname: string) {
  return pathname === "/app/educator" || pathname === "/app/educator/bootcamps" ||
    /^\/app\/educator\/bootcamps\/[^/]+$/.test(pathname);
}

export default function EducatorShell({workspace, children}: {workspace: EducatorWorkspace; children: React.ReactNode}) {
  const pathname = usePathname();
  const router = useRouter();
  const [routeLoading, setRouteLoading] = useState("");
  const name = [workspace.educator.firstName, workspace.educator.lastName].filter(Boolean).join(" ") || "Educator";
  const avatarUrl = avatarAssetUrl(safeAvatarNumber(workspace.educator.avatarNumber));
  const canAdmin = workspace.caller.adminAccess || workspace.caller.superAdmin;
  const showTopBar = isEducatorHomeSurface(pathname);

  useEffect(() => setRouteLoading(""), [pathname]);

  function trackNavigation(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest("a");
    if (!anchor || anchor.target === "_blank") return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin === window.location.origin && destination.pathname.startsWith("/app") && destination.pathname !== pathname) setRouteLoading(routeLabel(destination.pathname));
  }

  async function handleSignOut() {
    sessionStorage.clear();
    await signOut(getFirebaseAuth());
    router.replace("/app/sign-in");
  }

  const items = [
    {href: "/app/educator/profile", label: "My profile", detail: "Identity and school membership"},
    ...(canAdmin ? [{href: "/app/educator/admin", label: "Administration", detail: "School access and permissions"}] : []),
    {href: "/app/terms", label: "Terms of use", detail: "Rules for using Drill Instructor"},
    {href: "/app/privacy", label: "Privacy policy", detail: "How school and account data is handled"},
    {href: "/app/credits", label: "Credits", detail: "Artwork acknowledgements"},
    {href: "/app/contact", label: "Help & support", detail: "Questions, feedback, or support"},
  ];

  return <div className="di-app min-h-screen bg-brand-mist text-slate-950" onClickCapture={trackNavigation}>
    {showTopBar && <TopAccountBar homeHref="/app/educator/bootcamps" name={name} subtitle={workspace.school.name} avatarUrl={avatarUrl} items={items} onSignOut={handleSignOut} />}
    <main>{children}</main>
    {routeLoading && <BrandedLoadingOverlay label={routeLoading} />}
  </div>;
}
