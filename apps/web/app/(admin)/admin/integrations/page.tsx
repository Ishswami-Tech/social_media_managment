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
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        {[
          ["Tavily search", !!env.TAVILY_API_KEY],
          ["Brave search", !!env.BRAVE_SEARCH_API_KEY],
        ].map(([name, ok]) => (
          <div key={String(name)} className="flex items-center justify-between rounded-md border p-3 text-sm">
            <span>
              <span className="font-medium">{String(name)}</span>
              <span className="block text-xs text-muted-foreground">
                Platform-level research connector key (organizations may bring their own).
              </span>
            </span>
            <span className={ok ? "text-emerald-600" : "text-muted-foreground"}>
              {ok ? "key configured" : "no platform key"}
            </span>
          </div>
        ))}
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
