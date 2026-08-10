import {notFound} from "next/navigation";
import BootcampAbout from "@/components/app/BootcampAbout";

export default async function BootcampAboutPage({
  params,
}: {
  params: Promise<{bootcamp: string}>;
}) {
  const {bootcamp} = await params;
  if (!["act", "sat"].includes(bootcamp)) notFound();
  return <BootcampAbout bootcamp={bootcamp} />;
}
