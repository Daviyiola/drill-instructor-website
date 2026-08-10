import {notFound} from "next/navigation";
import BootcampSubscription from "@/components/app/BootcampSubscription";

export default async function BootcampSubscriptionPage({
  params,
}: {
  params: Promise<{bootcamp: string}>;
}) {
  const {bootcamp} = await params;
  if (!["act", "sat"].includes(bootcamp)) notFound();
  return <BootcampSubscription bootcamp={bootcamp} />;
}
