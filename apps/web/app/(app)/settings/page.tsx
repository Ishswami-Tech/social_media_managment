import { requireCapability } from "@/lib/session";
import { prisma } from "@/lib/db";
import { selectableModels } from "@/lib/ai";
import { DEFAULT_OVERRIDES, ROLE_MATRIX, CAPABILITIES } from "@platform/rbac";
import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "@/components/forms/settings-form";
import { SkillsManager } from "@/components/forms/skills-manager";
import { PluginsManager } from "@/components/forms/plugins-manager";
import { listOrganizationSkills } from "@/lib/skills";
import { listOrganizationPlugins } from "@/lib/plugins";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireCapability("org:settings");
  const [settings, models, keys, rawConnections] = await Promise.all([
    prisma.organizationSettings.findUnique({ where: { organizationId: ctx.organization.id } }),
    selectableModels(ctx.organization.id),
    prisma.organizationAIKey.findMany({
      where: { organizationId: ctx.organization.id },
      select: { provider: true, label: true, active: true },
    }),
    prisma.organizationAIConnection.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const connections = rawConnections.map((c) => ({
    ...c,
    lastTestedAt: c.lastTestedAt?.toISOString() ?? null,
  }));
  const [skills, plugins] = await Promise.all([
    listOrganizationSkills(ctx.organization.id).then((rows) => rows.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() }))),
    listOrganizationPlugins(ctx.organization.id).then((rows) =>
      rows.map((p) => ({ ...p, lastTestedAt: p.lastTestedAt?.toISOString() ?? null, updatedAt: p.updatedAt.toISOString() })),
    ),
  ]);
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
        connections={connections}
        configurable={configurable}
      />
      <div className="mt-4" id="skills">
        <SkillsManager skills={skills} />
      </div>
      <div className="mt-4" id="plugins">
        <PluginsManager plugins={plugins} />
      </div>
    </>
  );
}
