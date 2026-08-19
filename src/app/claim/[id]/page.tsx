import { WorkspaceClient } from "@/components/workspace/WorkspaceClient";

export default function ClaimWorkspacePage({ params }: { params: { id: string } }) {
  return <WorkspaceClient claimId={params.id} />;
}
