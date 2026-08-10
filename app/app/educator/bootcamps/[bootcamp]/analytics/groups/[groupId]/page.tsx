import EducatorGroupAnalytics from "@/components/educator/EducatorGroupAnalytics";
export default async function Page({params, searchParams}: {params: Promise<{bootcamp: string; groupId: string}>; searchParams: Promise<{rawGroupId?: string; scope?: string; name?: string}>}) { const [{bootcamp, groupId}, query] = await Promise.all([params, searchParams]); return <EducatorGroupAnalytics bootcamp={bootcamp.toLowerCase()} rawGroupId={query.rawGroupId || decodeURIComponent(groupId)} scope={query.scope || "admin"} fallbackName={query.name || "Group analytics"} />; }

