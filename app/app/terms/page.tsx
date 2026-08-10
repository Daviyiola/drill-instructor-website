import AppDocumentPage from "@/components/app/AppDocumentPage";
import {sections} from "@/app/terms/page";

export default function Page() {
  return <AppDocumentPage title="Terms of Use" updated="June 8, 2026" introduction={[
    "These Terms of Use govern your access to and use of Drill Instructor, including our website, applications, services, content, question banks, assignments, analytics, and related features.",
    "By creating an account or using Drill Instructor, you agree to these Terms. If you do not agree, do not use Drill Instructor.",
  ]} sections={sections} />;
}
