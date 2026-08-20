import LegalDocumentPage from "@/components/legal/LegalDocumentPage";
import {termsDocument} from "@/lib/legal/policies";

export const metadata = {
  title: "Terms of Use",
  description: "Terms of Use for Drill Instructor.",
};

export const sections = termsDocument.sections;

export default function TermsPage() {
  return <LegalDocumentPage document={termsDocument} alternateHref="/privacy" alternateLabel="View Privacy Policy" />;
}
