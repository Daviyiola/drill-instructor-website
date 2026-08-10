import {notFound} from "next/navigation";
import TestRecords from "@/components/app/TestRecords";

export default async function BootcampRecordsPage({
  params,
}: {
  params: Promise<{bootcamp: string}>;
}) {
  const {bootcamp} = await params;
  if (!["act", "sat"].includes(bootcamp)) notFound();
  return <TestRecords bootcamp={bootcamp} />;
}
