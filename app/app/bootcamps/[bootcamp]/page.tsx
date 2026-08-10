import { notFound } from "next/navigation";
import BootcampOverview from "@/components/app/BootcampOverview";

export default async function BootcampPage({
  params,
}: {
  params: Promise<{ bootcamp: string }>;
}) {
  const { bootcamp } = await params;
  if (!["act", "sat"].includes(bootcamp)) notFound();
  return <BootcampOverview bootcamp={bootcamp} />;
}
