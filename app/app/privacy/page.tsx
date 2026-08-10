import AppDocumentPage from "@/components/app/AppDocumentPage";
import {sections} from "@/app/privacy/page";

export default function Page() {
  return <AppDocumentPage title="Privacy Policy" updated="June 8, 2026" introduction={[
    "This Privacy Policy explains how Drill Instructor collects, uses, stores, shares, and protects information across our applications and services.",
    "Drill Instructor is designed for students, educators, schools, and exam-preparation communities. Because the service may involve students and minors, we take student privacy seriously.",
  ]} sections={sections} />;
}
