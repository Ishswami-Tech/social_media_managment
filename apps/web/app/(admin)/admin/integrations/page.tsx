import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { PageHeader } from "@/components/app/page-header";
import { AIModelTable } from "@/components/forms/admin-ai-models";

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
