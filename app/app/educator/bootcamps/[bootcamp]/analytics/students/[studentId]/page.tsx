import StudentAnalyticsPage from "@/components/app/StudentAnalyticsPage";
export default async function Page({params, searchParams}: {params: Promise<{bootcamp: string; studentId: string}>; searchParams: Promise<{name?: string}>}) { const [{bootcamp, studentId}, query] = await Promise.all([params, searchParams]); return <StudentAnalyticsPage bootcamp={bootcamp.toLowerCase()} educatorStudentId={decodeURIComponent(studentId)} educatorStudentName={query.name || ""} />; }

