import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { DEFAULT_OVERRIDES, ROLE_MATRIX, CAPABILITIES } from "@platform/rbac";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "@/components/forms/settings-form";
import { ConnectorSettings } from "@/components/forms/connector-settings";
import { connectorStatus } from "@/lib/research";
import { CONNECTOR_INFO } from "@platform/research";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireCapability("org:settings");
  const [settings, models, keys] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { organizationId: ctx.organization.id } }),
    prisma.aIProviderConfig.findMany({
      where: { active: true },
      orderBy: [{ provider: "asc" }, { priority: "asc" }],
      select: { provider: true, model: true, displayName: true, capabilities: true },
    }),
    prisma.organizationAIKey.findMany({
      where: { organizationId: ctx.organization.id },
      select: { provider: true, label: true, active: true },
    }),
  ]);
  const connectors = (await connectorStatus(ctx.organization.id)).map((c) => ({ ...c, ...CONNECTOR_INFO[c.id] }));
  const configurable = Object.fromEntries(
    (Object.keys(ROLE_MATRIX) as (keyof typeof ROLE_MATRIX)[]).map((role) => [
      role,
      CAPABILITIES.filter((c) => ROLE_MATRIX[role][c] === "CONFIGURED"),
    ]),
  );
  return (
    <>
      <PageHeader
        title="Organization settings"
        description="Approval workflow, AI defaults, bring-your-own keys and configurable permissions."
      />
      <SettingsForm
        organization={ctx.organization}
        settings={{
          timezone: settings?.timezone ?? "UTC",
          requireApproval: settings?.requireApproval ?? true,
          whatsappRequireHumanApproval: settings?.whatsappRequireHumanApproval ?? true,
          aiDefaultProvider: settings?.aiDefaultProvider ?? null,
          aiDefaultModel: settings?.aiDefaultModel ?? null,
          aiImageProvider: settings?.aiImageProvider ?? null,
          aiImageModel: settings?.aiImageModel ?? null,
          aiRetainPrompts: settings?.aiRetainPrompts ?? true,
          permissionOverrides:
            (settings?.permissionOverrides as Record<string, string[]> | null) ??
            (DEFAULT_OVERRIDES as Record<string, string[]>),
        }}
        models={models}
        keys={keys}
        configurable={configurable}
      />
      <div className="mt-4">
        <ConnectorSettings connectors={connectors} />
      </div>
    </>
  );
}
