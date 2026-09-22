import Link from "next/link";
import type { AgentAssurance, AgentPublishMode } from "@platform/types";
import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { AgentCampaignForm } from "@/components/forms/agent-campaign-form";
import { Button } from "@/components/ui/button";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const ctx = await requireCapability("ai:generate");
  const [accounts, settings] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId: ctx.organization.id, status: "CONNECTED" },
      select: { id: true, platform: true, displayName: true, username: true, agentAutoPublish: true },
      orderBy: [{ platform: "asc" }, { displayName: "asc" }],
    }),
    prisma.organizationSettings.findUnique({
      where: { organizationId: ctx.organization.id },
      select: { agentPublishMode: true, agentAssurance: true, agentRunMaxCents: true, timezone: true },
    }),
  ]);

  const publishMode: AgentPublishMode = settings?.agentPublishMode ?? "APPROVAL_REQUIRED";
  const assurance: AgentAssurance = settings?.agentAssurance ?? "JUDGE_ONLY";
  const canAutomatic = ctx.can("content:publish") && publishMode === "AUTOMATIC";

  return (
    <>
      <PageHeader
        title="New campaign"
        description="The council researches the topic, drafts one recommendation per account and stops for your decision."
      >
        <Button asChild variant="outline">
          <Link href="/agent">Back to campaigns</Link>
        </Button>
      </PageHeader>
      <AgentCampaignForm
        accounts={accounts}
        defaults={{
          assurance,
          publishMode,
          maxCents: settings?.agentRunMaxCents ?? 200,
          timezone: settings?.timezone ?? "UTC",
        }}
        canAutomatic={canAutomatic}
      />
    </>
  );
}
