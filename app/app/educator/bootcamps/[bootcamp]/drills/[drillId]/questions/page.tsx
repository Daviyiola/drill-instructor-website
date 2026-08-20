import EducatorPublishedQuestions from "@/components/educator/EducatorPublishedQuestions";

export default async function Page({params}: {params: Promise<{bootcamp: string; drillId: string}>}) {
  const {bootcamp, drillId} = await params;
  return <EducatorPublishedQuestions bootcamp={bootcamp.toLowerCase()} drillId={drillId} />;
}
