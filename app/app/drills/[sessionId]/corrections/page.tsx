import DrillCorrections from "@/components/app/DrillCorrections";

export default async function DrillCorrectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{sessionId: string}>;
  searchParams: Promise<{from?: string}>;
}) {
  const {sessionId} = await params;
  const {from} = await searchParams;
  return (
    <DrillCorrections
      sessionId={sessionId}
      fromRecords={from === "records"}
      fromChallenges={from === "challenges"}
    />
  );
}
