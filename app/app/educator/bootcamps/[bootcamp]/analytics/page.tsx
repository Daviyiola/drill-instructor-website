import EducatorAnalyticsGateway from "@/components/educator/EducatorAnalyticsGateway";
export default async function Page({params}: {params: Promise<{bootcamp: string}>}) { const {bootcamp} = await params; return <EducatorAnalyticsGateway bootcamp={bootcamp.toLowerCase()} />; }

