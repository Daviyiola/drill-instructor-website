import {notFound} from "next/navigation";
import EducatorBootcampAbout from "@/components/educator/EducatorBootcampAbout";

export default async function Page({params}: {params: Promise<{bootcamp: string}>}) {
  const {bootcamp} = await params;
  if (!(["act", "sat"] as string[]).includes(bootcamp)) notFound();
  return <EducatorBootcampAbout bootcamp={bootcamp} />;
}
