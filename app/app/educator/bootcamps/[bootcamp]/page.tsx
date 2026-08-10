import EducatorBootcampOverview from "@/components/educator/EducatorBootcampOverview";
export default async function Page({params}: {params: Promise<{bootcamp: string}>}) {
  const {bootcamp} = await params;
  return <EducatorBootcampOverview bootcamp={bootcamp.toLowerCase()} />;
}

