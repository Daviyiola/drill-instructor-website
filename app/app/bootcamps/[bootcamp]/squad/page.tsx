import SquadChallenges from "@/components/app/SquadChallenges";

export default async function SquadChallengesPage({
  params,
}: {
  params: Promise<{bootcamp: string}>;
}) {
  const {bootcamp} = await params;
  return <SquadChallenges bootcamp={bootcamp.toLowerCase()} />;
}
