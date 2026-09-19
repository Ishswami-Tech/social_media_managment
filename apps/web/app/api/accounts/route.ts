import { json, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = (req: Request) =>
  withOrg(req, "accounts:view", async (ctx) => {
    const accounts = await prisma.socialAccount.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: [{ platform: "asc" }, { displayName: "asc" }],
      select: {
        id: true,
        platform: true,
        accountType: true,
        displayName: true,
        username: true,
        avatarUrl: true,
        profileUrl: true,
        status: true,
        capabilities: true,
        requireApproval: true,
        lastError: true,
        createdAt: true,
      },
    });
    return json({ accounts });
  });
