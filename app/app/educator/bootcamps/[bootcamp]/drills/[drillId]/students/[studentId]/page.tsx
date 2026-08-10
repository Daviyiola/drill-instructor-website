import EducatorSubmissionDetail from "@/components/educator/EducatorSubmissionDetail";
export default async function Page({params, searchParams}: {params: Promise<{bootcamp: string; drillId: string; studentId: string}>; searchParams: Promise<{attemptId?: string}>}) { const [{bootcamp, drillId, studentId}, query] = await Promise.all([params, searchParams]); return <EducatorSubmissionDetail bootcamp={bootcamp.toLowerCase()} drillId={drillId} studentId={decodeURIComponent(studentId)} attemptId={query.attemptId || ""} />; }

