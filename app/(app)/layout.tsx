import { WorkspaceShell } from "@/components/workspace-shell";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <WorkspaceShell user={{ email: user.email, is_admin: user.is_admin }}>
      {children}
    </WorkspaceShell>
  );
}
