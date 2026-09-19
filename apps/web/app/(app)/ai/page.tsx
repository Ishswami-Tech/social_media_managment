import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveAuth } from "@/lib/ai";
import { PageHeader } from "@/components/app/page-header";
import { AIStudio } from "@/components/forms/ai-studio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata = { title: "AI Studio" };

export default async function AIStudioPage() {
  const ctx = await requireCapability("ai:generate");
  const [{ available }, models, brands] = await Promise.all([
    resolveAuth(ctx.organization.id),
    prisma.aIProviderConfig.findMany({ where: { active: true }, orderBy: [{ provider: "asc" }, { priority: "asc" }] }),
    prisma.brand.findMany({
      where: { organizationId: ctx.organization.id },
      select: { id: true, name: true, isDefault: true },
    }),
  ]);
  return (
    <>
      <PageHeader
        title="AI Studio"
        description="Generate copy, images, hooks, hashtags and content calendars with your brand voice."
      />
      {available.length === 0 && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>No AI provider configured</AlertTitle>
          <AlertDescription>
            Add a platform key (Super Admin) or bring your own key under Settings → AI.
          </AlertDescription>
        </Alert>
      )}
      <AIStudio
        models={models
          .filter((m) => available.includes(m.provider))
          .map((m) => ({
            provider: m.provider,
            model: m.model,
            displayName: m.displayName,
            capabilities: m.capabilities,
          }))}
        brands={brands}
        canImage={ctx.can("ai:image")}
      />
    </>
  );
}
