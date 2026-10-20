import Link from "next/link";
import { canAssignRole, CAPABILITIES, DEFAULT_OVERRIDES, ROLE_MATRIX } from "@platform/rbac";
import { ORG_ROLES } from "@platform/types";
import { requireOrg, type OrgContext } from "@/lib/session";
import { prisma } from "@/lib/db";
import { selectableModels } from "@/lib/ai";
import { listOrganizationSkills } from "@/lib/skills";
import { listOrganizationPlugins } from "@/lib/plugins";
import { mediaUrl } from "@/lib/services/media";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { AISettings, type OrganizationSettingsValues } from "@/components/settings/ai-settings";
import { AutomationSettings } from "@/components/settings/automation-settings";
import { BrandForm } from "@/components/forms/brand-form";
import { TeamManager } from "@/components/forms/team-manager";
import { MediaUploader } from "@/components/forms/media-uploader";
import { SkillsManager } from "@/components/forms/skills-manager";
import { PluginsManager } from "@/components/forms/plugins-manager";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Settings" };

const TABS = [
  { key: "brand", label: "Brand voice" },
  { key: "team", label: "Team" },
  { key: "ai", label: "AI" },
  { key: "automation", label: "Automation" },
  { key: "media", label: "Media" },
] as const;

type Tab = (typeof TABS)[number];

/** AI and automation hold organization-wide configuration; the rest is open to every member. */
function visibleTabs(ctx: OrgContext): Tab[] {
  const canConfigure = ctx.can("org:settings");
  return TABS.filter((t) => canConfigure || (t.key !== "ai" && t.key !== "automation"));
}

/** `OrganizationSettings.agentAllowedModels` is free-form JSON; keep only "PROVIDER::model" strings. */
function readAllowedModels(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireOrg();
  const { tab } = await searchParams;
  const tabs = visibleTabs(ctx);
  const active = tabs.find((t) => t.key === tab) ?? tabs[0] ?? TABS[0];

  return (
    <>
      <PageHeader title="Settings" description="How your brand sounds, who can do what, and how much runs on its own." />
      <nav className="mb-6 flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              t.key === active.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {active.key === "brand" && <BrandTab ctx={ctx} />}
      {active.key === "team" && <TeamTab ctx={ctx} />}
      {active.key === "ai" && <AITab ctx={ctx} />}
      {active.key === "automation" && <AutomationTab ctx={ctx} />}
      {active.key === "media" && <MediaTab ctx={ctx} />}
    </>
  );
}

async function BrandTab({ ctx }: { ctx: OrgContext }) {
  const brand =
    (await prisma.brand.findFirst({
      where: { organizationId: ctx.organization.id, isDefault: true },
      include: { knowledge: true },
    })) ??
    (await prisma.brand.findFirst({ where: { organizationId: ctx.organization.id }, include: { knowledge: true } }));
  return (
    <section className="grid gap-4">
      <p className="text-sm text-muted-foreground">Everything here is used when the AI writes for this organization.</p>
      <BrandForm
        canEdit={ctx.can("org:settings")}
        brand={
          brand
            ? {
                id: brand.id,
                name: brand.name,
                industry: brand.industry ?? "",
                audience: brand.audience ?? "",
                tone: brand.tone ?? "",
                language: brand.language,
                rules: (brand.rules as { do?: string[]; dont?: string[]; bannedPhrases?: string[] } | null) ?? {},
                voiceExamples: brand.voiceExamples,
                knowledge: brand.knowledge.map((k) => ({ title: k.title ?? "", content: k.content })),
              }
            : null
        }
        defaultName={ctx.organization.name}
      />
    </section>
  );
}

async function TeamTab({ ctx }: { ctx: OrgContext }) {
  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId: ctx.organization.id },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invitation.findMany({
      where: { organizationId: ctx.organization.id, status: "pending" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const assignable = ORG_ROLES.filter((r) => canAssignRole(ctx.actor, r, { overrides: ctx.overrides }));
  return (
    <section className="grid gap-4">
      <p className="text-sm text-muted-foreground">Roles decide what each person can do. Fine-tune them under Automation.</p>
      <TeamManager
        currentUserId={ctx.user.id}
        canManage={ctx.can("org:members")}
        assignableRoles={assignable}
        members={members.map((m) => ({
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          status: m.status,
        }))}
        invitations={invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt?.toISOString() ?? null,
        }))}
      />
    </section>
  );
}

/** Shared by the AI and automation tabs: every save posts the whole settings object. */
async function loadSettings(ctx: OrgContext): Promise<OrganizationSettingsValues> {
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: ctx.organization.id },
  });
  return {
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
    agentPublishMode: settings?.agentPublishMode ?? "APPROVAL_REQUIRED",
    agentAssurance: settings?.agentAssurance ?? "JUDGE_ONLY",
    agentRunMaxCents: settings?.agentRunMaxCents ?? 200,
    agentMonthlyBudgetCents: settings?.agentMonthlyBudgetCents ?? 5000,
    agentMaxActiveRuns: settings?.agentMaxActiveRuns ?? 5,
    agentAllowedModels: readAllowedModels(settings?.agentAllowedModels),
    agentCouncilSize: settings?.agentCouncilSize ?? 3,
  };
}

async function AITab({ ctx }: { ctx: OrgContext }) {
  if (!ctx.can("org:settings")) return null;
  // Providers and their keys belong to the platform, not to an organization:
  // they are managed once in Super Admin and shared by every tenant.
  const [settings, models] = await Promise.all([loadSettings(ctx), selectableModels(ctx.organization.id)]);
  const [skills, plugins] = await Promise.all([
    listOrganizationSkills(ctx.organization.id).then((rows) =>
      rows.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() })),
    ),
    listOrganizationPlugins(ctx.organization.id).then((rows) =>
      rows.map((p) => ({
        ...p,
        lastTestedAt: p.lastTestedAt?.toISOString() ?? null,
        updatedAt: p.updatedAt.toISOString(),
      })),
    ),
  ]);
  return (
    <section className="grid gap-4">
      <AISettings settings={settings} models={models} />
      <div id="skills">
        <SkillsManager skills={skills} />
      </div>
      <div id="plugins">
        <PluginsManager plugins={plugins} />
      </div>
    </section>
  );
}

async function AutomationTab({ ctx }: { ctx: OrgContext }) {
  if (!ctx.can("org:settings")) return null;
  const [settings, models] = await Promise.all([loadSettings(ctx), selectableModels(ctx.organization.id)]);
  const configurable = Object.fromEntries(
    (Object.keys(ROLE_MATRIX) as (keyof typeof ROLE_MATRIX)[]).map((role) => [
      role,
      CAPABILITIES.filter((c) => ROLE_MATRIX[role][c] === "CONFIGURED"),
    ]),
  );
  return (
    <AutomationSettings
      organization={ctx.organization}
      settings={settings}
      models={models}
      configurable={configurable}
    />
  );
}

async function MediaTab({ ctx }: { ctx: OrgContext }) {
  const assets = await prisma.mediaAsset.findMany({
    where: { organizationId: ctx.organization.id, status: { not: "PENDING_UPLOAD" } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const items = await Promise.all(
    assets.map(async (a) => ({
      ...a,
      thumb: a.kind === "IMAGE" || a.kind === "GIF" ? await mediaUrl(a, "thumbnail") : null,
    })),
  );
  return (
    <section className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Images and videos you can attach to a post.</p>
        {ctx.can("media:upload") && <MediaUploader />}
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
        {items.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No files yet.</p>}
        {items.map((a) => (
          <Card key={a.id} className="gap-2 overflow-hidden py-0">
            <div className="flex aspect-square items-center justify-center bg-muted">
              {a.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumb} alt={a.altText ?? a.fileName} className="size-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground uppercase">{a.kind}</span>
              )}
            </div>
            <CardContent className="px-3 pb-3">
              <p className="truncate text-xs font-medium" title={a.fileName}>
                {a.fileName}
              </p>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {a.width && a.height ? `${a.width}×${a.height} · ` : ""}
                  {(a.size / 1024).toFixed(0)} KB
                </span>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {a.source === "AI_GENERATED" ? "AI · " : ""}
                {formatDate(a.createdAt, { dateStyle: "short" })}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
