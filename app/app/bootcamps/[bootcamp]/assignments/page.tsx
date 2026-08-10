import StudentAssignments from "@/components/app/StudentAssignments";
export default async function Page({params}: {params: Promise<{bootcamp: string}>}) {
  const {bootcamp} = await params;
  return <StudentAssignments bootcamp={bootcamp.toLowerCase()} />;
}

