import AppDocumentPage from "@/components/app/AppDocumentPage";
import {privacyDocument} from "@/lib/legal/policies";

export default function Page() {
  return <AppDocumentPage {...privacyDocument} alternateHref="/app/terms" alternateLabel="View Terms of Use" />;
}
