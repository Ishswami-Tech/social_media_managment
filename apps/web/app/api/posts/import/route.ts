import { json, parseBody, withOrg, badRequest, conflict } from "@/lib/api";
import { prisma } from "@/lib/db";
import { bulkImportInput } from "@/lib/post-import";

/** An import is atomic and creates drafts only; publishing keeps its normal approval flow. */
export const POST = (req: Request) =>
  withOrg(req, "content:create", async (ctx) => {
    const input = await parseBody(req, bulkImportInput);
    const prefix = `csv:${input.importId}:`;
    const result = await prisma.$transaction(
      async (tx) => {
        const previous = await tx.post.findMany({
          where: { organizationId: ctx.organization.id, createdById: ctx.user.id, sourceRef: { startsWith: prefix } },
          select: { id: true },
        });
        if (previous.length) return { posts: previous, reused: true };
        const accounts = await tx.socialAccount.findMany({
          where: { organizationId: ctx.organization.id, id: { in: input.accountIds } },
        });
        if (accounts.length !== input.accountIds.length) throw badRequest("Select accounts from this workspace");
        if (accounts.some((a) => a.status !== "CONNECTED"))
          throw conflict("Reconnect the selected accounts before importing");
        const posts = [];
        for (const [index, row] of input.rows.entries()) {
          posts.push(
            await tx.post.create({
              data: {
                organizationId: ctx.organization.id,
                createdById: ctx.user.id,
                title: row.title || null,
                masterText: row.text,
                tags: row.tags,
                scheduledAt: row.scheduledAt ? new Date(row.scheduledAt) : null,
                timezone: ctx.settings.timezone,
                sourceRef: `${prefix}${index}`,
                status: "DRAFT",
                approvalStatus: "NOT_REQUIRED",
                autoPublishOnApproval: false,
                variants: {
                  create: accounts.map((account) => ({
                    socialAccountId: account.id,
                    platform: account.platform,
                    text: row.text,
                  })),
                },
              },
              select: { id: true },
            }),
          );
        }
        await tx.auditLog.create({
          data: {
            organizationId: ctx.organization.id,
            actorUserId: ctx.user.id,
            action: "post.import",
            resourceType: "Post",
            resourceId: input.importId,
            metadata: { count: posts.length, accountIds: input.accountIds },
          },
        });
        return { posts, reused: false };
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
    return json(result, { status: result.reused ? 200 : 201 });
  });
