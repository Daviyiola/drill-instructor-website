import EducatorDrillDashboard from "@/components/educator/EducatorDrillDashboard";
export default async function Page({params}: {params: Promise<{bootcamp: string; drillId: string}>}) { const {bootcamp, drillId} = await params; return <EducatorDrillDashboard bootcamp={bootcamp.toLowerCase()} drillId={drillId} />; }
