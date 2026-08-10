import EducatorDrillBuilder from "@/components/educator/EducatorDrillBuilder";
export default async function Page({params}: {params: Promise<{bootcamp: string; drillId: string}>}) { const {bootcamp, drillId} = await params; return <EducatorDrillBuilder bootcamp={bootcamp.toLowerCase()} drillId={drillId} />; }

