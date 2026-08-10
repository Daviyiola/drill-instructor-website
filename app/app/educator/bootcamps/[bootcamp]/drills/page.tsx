import EducatorDrills from "@/components/educator/EducatorDrills";
export default async function Page({params}: {params: Promise<{bootcamp: string}>}) { const {bootcamp} = await params; return <EducatorDrills bootcamp={bootcamp.toLowerCase()} />; }
