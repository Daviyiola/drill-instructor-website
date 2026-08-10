import EducatorDrillBuilder from "@/components/educator/EducatorDrillBuilder";
export default async function Page({params}: {params: Promise<{bootcamp: string}>}) { const {bootcamp} = await params; return <EducatorDrillBuilder bootcamp={bootcamp.toLowerCase()} />; }

