import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { PostImport } from "@/components/forms/post-import";

export const metadata = { title: "Import posts" };

export default async function ImportPostsPage() {
  const ctx = await requireCapability("content:create");
  const accounts = await prisma.socialAccount.findMany({
    where: { organizationId: ctx.organization.id, status: "CONNECTED" },
    select: { id: true, platform: true, displayName: true, capabilities: true },
    orderBy: { platform: "asc" },
  });
  return (
    <>
      <PageHeader
        title="Import posts"
        description="Bring a content plan into your workspace, review it, then schedule it across your accounts."
      />
      <PostImport
        timezone={ctx.settings.timezone}
        accounts={accounts.map((account) => {
          const capabilities = account.capabilities as {
            text?: { maxLength?: number };
            media?: { required?: boolean };
          } | null;
          return {
            id: account.id,
            platform: account.platform,
            displayName: account.displayName,
            mediaRequired: !!capabilities?.media?.required,
            maxLength: capabilities?.text?.maxLength ?? 3000,
          };
        })}
      />
    </>
  );
}
