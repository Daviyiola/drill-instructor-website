import QuestionRunner from "@/components/app/QuestionRunner";

export default async function ActiveDrillPage({
  params,
}: {
  params: Promise<{sessionId: string}>;
}) {
  const {sessionId} = await params;
  return <QuestionRunner sessionId={sessionId} />;
}
