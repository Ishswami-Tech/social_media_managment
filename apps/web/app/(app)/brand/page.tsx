import { requireOrg } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import { BrandForm } from "@/components/forms/brand-form";

export const metadata = { title: "Brand" };

export default async function BrandPage() {
  const ctx = await requireOrg();
  const brand =
    (await prisma.brand.findFirst({
      where: { organizationId: ctx.organization.id, isDefault: true },
      include: { knowledge: true },
    })) ??
    (await prisma.brand.findFirst({ where: { organizationId: ctx.organization.id }, include: { knowledge: true } }));
  return (
    <>
      <PageHeader
        title="Brand voice & knowledge"
        description="Everything here is injected into AI generation for this organization only."
      />
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
    </>
  );
}
