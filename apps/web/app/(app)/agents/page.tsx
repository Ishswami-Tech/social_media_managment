import { requireCapability } from "@/lib/session";
import { loadTeam } from "@/lib/agent/team";
import { PageHeader } from "@/components/app/page-header";
import { TeamBoard } from "@/components/agent/team-board";

export const metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

/** The council as a team: who is on duty, what each agent has done this week, and everything they said. */
export default async function AgentsPage() {
  const ctx = await requireCapability("accounts:view");
  const team = await loadTeam(ctx.organization.id);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Your agents"
        description="Seven agents work every post: research, angle, three writers, review, a blind judge and an editor. This is the team, live."
      />
      <TeamBoard initial={team} />
    </div>
  );
}
