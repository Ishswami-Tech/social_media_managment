import { prisma } from "@/lib/db";
import { errorInfo, logger } from "@/lib/logger";

export interface PromptVersionInput {
  key: string;
  version: number;
  hash: string;
  template: string;
}

export interface PromptSyncResult {
  synced: number;
  failed: { key: string; version: number; error: string }[];
}

/**
 * Mirrors the pipeline's prompt registry into `PromptVersion` so any run can
 * be reproduced from the prompt hashes recorded on its events and drafts.
 * Rows are immutable: an existing hash is left untouched, and a template that
 * changed without bumping its version is reported instead of overwritten.
 */
export async function syncPromptVersions(prompts: readonly PromptVersionInput[]): Promise<PromptSyncResult> {
  const results = await Promise.all(
    prompts.map(async (p) => {
      try {
        const existing = await prisma.promptVersion.findUnique({
          where: { key_version: { key: p.key, version: p.version } },
          select: { hash: true },
        });
        if (existing && existing.hash !== p.hash) {
          return { key: p.key, version: p.version, error: `template changed but version ${p.version} already stored` };
        }
        if (!existing) {
          await prisma.promptVersion.create({
            data: { key: p.key, version: p.version, hash: p.hash, template: p.template, active: true },
          });
        }
        return undefined;
      } catch (e) {
        return { key: p.key, version: p.version, error: errorInfo(e).message };
      }
    }),
  );
  const failed = results.filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (failed.length > 0) logger.warn("prompt versions not synced", { failed });
  return { synced: prompts.length - failed.length, failed };
}
