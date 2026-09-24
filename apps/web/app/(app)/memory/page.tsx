import { requireCapability } from "@/lib/session";
import { listAccountMemories, listStories } from "@/lib/services/memory";
import { PageHeader } from "@/components/app/page-header";
import { MemoryForm } from "@/components/forms/memory-form";
import { StoryBank } from "@/components/forms/story-bank";

export const metadata = { title: "Memory" };

/**
 * Everything the agents know: the story bank shared by every account, then
 * one editable brain per connected account with what the learning loop found.
 */
export default async function MemoryPage() {
  const ctx = await requireCapability("accounts:view");
  const organizationId = ctx.organization.id;
  const [stories, memories] = await Promise.all([listStories(organizationId), listAccountMemories(organizationId)]);
  const canEdit = ctx.can("org:settings");

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Memory"
        description="What the AI knows about your business and each account. Correct it, add to it, and it shows up in the next post."
      />
      <StoryBank stories={stories} canEdit={canEdit} />
      {memories.length === 0 ? (
        <p className="text-sm text-muted-foreground">Connect an account to give the AI something to remember.</p>
      ) : (
        memories.map((memory) => <MemoryForm key={memory.account.id} memory={memory} canEdit={canEdit} />)
      )}
    </div>
  );
}
