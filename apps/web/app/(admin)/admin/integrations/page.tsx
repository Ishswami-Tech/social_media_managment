import { PageHeader } from "@/components/app/page-header";
import { AIModelTable } from "@/components/forms/admin-ai-models";
import { ProviderConnections } from "@/components/forms/admin-providers";
import { platformAIConsole } from "@/lib/services/platform-ai";

export const metadata = { title: "AI providers" };

export default async function AdminIntegrations() {
  const { connections, envProviders, models } = await platformAIConsole();

  return (
    <>
      <PageHeader
        title="AI providers"
        description="Connect the AI services this platform runs on. Their models show up below, ready to price and route."
      />
      <div className="grid gap-4">
        <ProviderConnections connections={connections} envProviders={envProviders} />
        <AIModelTable models={models} />
      </div>
    </>
  );
}
