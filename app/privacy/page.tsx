import LegalDocumentPage from "@/components/legal/LegalDocumentPage";
import {privacyDocument} from "@/lib/legal/policies";

export const metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Drill Instructor.",
};

export const sections = privacyDocument.sections;

export default function PrivacyPage() {
  return <LegalDocumentPage document={privacyDocument} alternateHref="/terms" alternateLabel="View Terms of Use" />;
}
