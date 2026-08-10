import {notFound} from "next/navigation";
import DrillSetup from "@/components/app/DrillSetup";

export default async function DrillSetupPage({
  params,
}: {
  params: Promise<{bootcamp: string}>;
}) {
  const {bootcamp} = await params;
  if (!["act", "sat"].includes(bootcamp)) notFound();
  return <DrillSetup bootcamp={bootcamp} />;
}
