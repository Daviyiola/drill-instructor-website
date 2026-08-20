import BootcampAboutContent from "@/components/app/BootcampAboutContent";

export default function EducatorBootcampAbout({bootcamp}: {bootcamp: string}) {
  const name = bootcamp.toUpperCase();
  return <BootcampAboutContent bootcamp={bootcamp} backHref={`/app/educator/bootcamps/${bootcamp}`} backLabel={`${name} dashboard`} />;
}
