import { NewSiteWizard } from "@/components/new-site-wizard";
import { requireUser } from "@/lib/auth";

export default async function NewSitePage() {
  await requireUser();
  return <NewSiteWizard />;
}
