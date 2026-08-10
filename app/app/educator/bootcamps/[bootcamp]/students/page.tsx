import EducatorRoster from "@/components/educator/EducatorRoster";
export default async function Page({params}: {params: Promise<{bootcamp: string}>}) {
  const {bootcamp} = await params;
  return <EducatorRoster bootcamp={bootcamp.toLowerCase()} />;
}
