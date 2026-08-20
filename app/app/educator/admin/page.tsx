import SchoolAdministration from "@/components/educator/SchoolAdministration";

export default async function Page({searchParams}: {searchParams: Promise<{returnTo?: string}>}) {
  const {returnTo} = await searchParams;
  return <SchoolAdministration returnTo={returnTo} />;
}
