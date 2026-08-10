import {notFound} from "next/navigation";
import StudentAnalyticsPage from "@/components/app/StudentAnalyticsPage";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{bootcamp: string}>;
}) {
  const {bootcamp} = await params;
  if (!["act", "sat"].includes(bootcamp)) notFound();
  return <StudentAnalyticsPage bootcamp={bootcamp} />;
}
