import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { FeatureFlags } from "@/components/forms/admin-feature-flags";

export const metadata = { title: "Feature flags" };

export default async function AdminFlags() {
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  return (
    <>
      <PageHeader title="Feature flags" description="Global toggles with optional per-organization allow-lists." />
      <FeatureFlags
        flags={flags.map((f) => ({
          key: f.key,
          description: f.description ?? "",
          enabled: f.enabled,
          organizationIds: f.organizationIds,
        }))}
      />
    </>
  );
}
