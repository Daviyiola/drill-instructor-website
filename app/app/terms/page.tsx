import AppDocumentPage from "@/components/app/AppDocumentPage";
import {termsDocument} from "@/lib/legal/policies";

export default function Page() {
  return <AppDocumentPage {...termsDocument} alternateHref="/app/privacy" alternateLabel="View Privacy Policy" />;
}
