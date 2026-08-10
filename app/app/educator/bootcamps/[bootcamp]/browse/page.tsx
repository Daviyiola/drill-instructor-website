import EducatorQuestionLibrary from "@/components/educator/EducatorQuestionLibrary";

export default async function Page({params}: {params: Promise<{bootcamp: string}>}) {
  const {bootcamp} = await params;
  return <EducatorQuestionLibrary bootcamp={bootcamp.toLowerCase()} />;
}
