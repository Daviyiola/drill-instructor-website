import StudentAnalyticsPage from "@/components/app/StudentAnalyticsPage";

export default async function Page({params, searchParams}: {params: Promise<{bootcamp: string; studentId: string}>; searchParams: Promise<{name?: string; returnTo?: string}>}) {
  const [{bootcamp, studentId}, query] = await Promise.all([params, searchParams]);
  const normalizedBootcamp = bootcamp.toLowerCase();
  const expectedPrefix = `/app/educator/bootcamps/${normalizedBootcamp}/analytics/groups/`;
  const returnTo = query.returnTo?.startsWith(expectedPrefix) ? query.returnTo : "";
  return <StudentAnalyticsPage bootcamp={normalizedBootcamp} educatorStudentId={decodeURIComponent(studentId)} educatorStudentName={query.name || ""} educatorBackHref={returnTo} />;
}
