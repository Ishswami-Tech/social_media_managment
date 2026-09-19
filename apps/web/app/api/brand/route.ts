import { z } from "zod";
import { json, notFound, parseBody, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

const brandInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  industry: z.string().max(120).optional(),
  audience: z.string().max(1000).optional(),
  tone: z.string().max(500).optional(),
  language: z.string().max(10).default("en"),
  rules: z
    .object({
      do: z.array(z.string().max(200)).default([]),
      dont: z.array(z.string().max(200)).default([]),
      bannedPhrases: z.array(z.string().max(100)).default([]),
    })
    .optional(),
  voiceExamples: z.array(z.string().max(3000)).max(10).default([]),
  isDefault: z.boolean().default(true),
  knowledge: z
    .array(
      z.object({
        title: z.string().max(200).optional(),
        content: z.string().min(1).max(20_000),
        sourceType: z.enum(["DOCUMENT", "URL", "POST", "NOTE"]).default("NOTE"),
        sourceKey: z.string().max(500).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const GET = (req: Request) =>
  withOrg(req, "accounts:view", async (ctx) =>
    json({
      brands: await prisma.brand.findMany({
        where: { organizationId: ctx.organization.id },
        include: { knowledge: { select: { id: true, title: true, sourceType: true, createdAt: true } } },
      }),
    }),
  );

export const PUT = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const input = await parseBody(req, brandInput);
    if (input.id) {
      const existing = await prisma.brand.findFirst({ where: { id: input.id, organizationId: ctx.organization.id } });
      if (!existing) throw notFound("Brand");
    }
    if (input.isDefault)
      await prisma.brand.updateMany({ where: { organizationId: ctx.organization.id }, data: { isDefault: false } });
    const data = {
      name: input.name,
      industry: input.industry,
      audience: input.audience,
      tone: input.tone,
      language: input.language,
      rules: input.rules,
      voiceExamples: input.voiceExamples,
      isDefault: input.isDefault,
    };
    const brand = input.id
      ? await prisma.brand.update({ where: { id: input.id }, data })
      : await prisma.brand.create({ data: { ...data, organizationId: ctx.organization.id } });
    if (input.knowledge) {
      await prisma.brandKnowledge.deleteMany({ where: { brandId: brand.id } });
      await prisma.brandKnowledge.createMany({
        data: input.knowledge.map((k, i) => ({
          brandId: brand.id,
          title: k.title,
          content: k.content,
          sourceType: k.sourceType,
          sourceKey: k.sourceKey ?? `note-${i}`,
        })),
      });
    }
    await audit(ctx, "brand.save", "Brand", brand.id, undefined, req);
    return json({ brand });
  });
