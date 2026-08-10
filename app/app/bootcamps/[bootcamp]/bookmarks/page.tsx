import {notFound} from "next/navigation";
import BookmarkLibrary from "@/components/app/BookmarkLibrary";

export default async function BootcampBookmarksPage({
  params,
}: {
  params: Promise<{bootcamp: string}>;
}) {
  const {bootcamp} = await params;
  if (!["act", "sat"].includes(bootcamp)) notFound();
  return <BookmarkLibrary bootcamp={bootcamp} />;
}
