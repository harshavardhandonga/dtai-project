import { WorkspaceClient } from "@/components/workspace/WorkspaceClient";

export default async function ClaimWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceClient claimId={id} />;
}
