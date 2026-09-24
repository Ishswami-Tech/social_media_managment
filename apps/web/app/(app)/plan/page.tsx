import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { listPlans } from "@/lib/agent/plan";
import { PageHeader } from "@/components/app/page-header";
import { PlanBoard } from "@/components/forms/plan-board";

export const metadata = { title: "Plan" };

/** A month of posts, shaped like a funnel, each one a click away from becoming a campaign. */
export default async function PlanPage() {
  const ctx = await requireCapability("ai:generate");
  const organizationId = ctx.organization.id;
  const [accounts, plans] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { organizationId, status: "CONNECTED" },
      select: { id: true, platform: true, displayName: true },
      orderBy: [{ platform: "asc" }, { displayName: "asc" }],
    }),
    listPlans(organizationId),
  ]);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Plan"
        description="Tell the planner what the month should achieve. It lays out posts that build awareness, prove results and make the offer, using your story bank."
      />
      <PlanBoard accounts={accounts} plans={plans} canStart={ctx.can("ai:generate")} />
    </div>
  );
}
