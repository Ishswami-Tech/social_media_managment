import { json, withSuperAdmin } from "@/lib/api";
import { clearLiveModelCache, platformAISources, platformSourceModels } from "@/lib/ai";
import { auditPlatform } from "@/lib/audit";
import { prisma } from "@/lib/db";

/**
 * Re-reads every platform source and writes what it finds into the AIProviderConfig
 * overlay: new models arrive with zero pricing, models that are still served are
 * re-activated, and pricing already entered by hand is left alone.
 */
export const POST = (req: Request) =>
  withSuperAdmin(req, async (session) => {
    clearLiveModelCache();
    const sources = await platformAISources();
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    const failed: string[] = [];

    for (const source of sources) {
      const models = await platformSourceModels(source);
      if (models.length === 0) {
        failed.push(source.origin);
        continue;
      }
      for (const m of models) {
        const key = `${source.provider}::${m.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = await prisma.aIProviderConfig.findUnique({
          where: { provider_model: { provider: source.provider, model: m.id } },
          select: { id: true },
        });
        if (existing) {
          await prisma.aIProviderConfig.update({
            where: { id: existing.id },
            data: { displayName: m.displayName, capabilities: m.capabilities, active: true },
          });
          updated++;
        } else {
          await prisma.aIProviderConfig.create({
            data: {
              provider: source.provider,
              model: m.id,
              displayName: m.displayName,
              capabilities: m.capabilities,
              active: true,
              priority: 100,
              inputCostPerM: 0,
              outputCostPerM: 0,
              imageCost: 0,
            },
          });
          created++;
        }
      }
    }

    await auditPlatform(session.user.id, "admin.ai_model.refresh", "AIProviderConfig", null, {
      sources: sources.length,
      discovered: seen.size,
      created,
      updated,
      failed: failed.length,
    });

    return json({ ok: true, sources: sources.length, discovered: seen.size, created, updated, failed });
  });
