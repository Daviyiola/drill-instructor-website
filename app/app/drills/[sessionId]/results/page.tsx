import DrillResults from "@/components/app/DrillResults";

export default async function DrillResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{sessionId: string}>;
  searchParams: Promise<{from?: string}>;
}) {
  const {sessionId} = await params;
  const {from} = await searchParams;
  return (
    <DrillResults
      sessionId={sessionId}
      fromRecords={from === "records"}
      fromChallenges={from === "challenges"}
    />
  );
}
