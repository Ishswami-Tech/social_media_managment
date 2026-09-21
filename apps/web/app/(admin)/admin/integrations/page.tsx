import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { PageHeader } from "@/components/app/page-header";
import { AIModelTable } from "@/components/forms/admin-ai-models";
import { RefreshModelsButton } from "@/components/forms/admin-refresh-models";

export const metadata = { title: "AI providers" };

export default async function AdminIntegrations() {
  const env = getEnv();
  const models = await prisma.aIProviderConfig.findMany({ orderBy: [{ provider: "asc" }, { priority: "asc" }] });

  return (
    <>
      <PageHeader
        title="AI providers & models"
        description="Platform keys come from the environment; the catalogue controls routing, defaults and cost estimation."
      />
      <div className="mb-4 grid gap-3">
        <div className="flex items-center justify-between rounded-md border p-3 text-sm">
          <div>
            <span className="font-medium">Refresh models</span>
            <span className="block text-xs text-muted-foreground">Fetch live model lists from each provider API.</span>
          </div>
          <RefreshModelsButton />
        </div>
      </div>
      <AIModelTable
        models={models.map((m) => ({ ...m, createdAt: undefined, updatedAt: undefined }))}
        platformKeys={{
          OPENAI: !!env.OPENAI_API_KEY,
          ANTHROPIC: !!env.ANTHROPIC_API_KEY,
          GOOGLE: !!env.GOOGLE_AI_API_KEY,
        }}
      />
    </>
  );
}
