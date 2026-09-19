import { json, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = (req: Request) =>
  withOrg(req, "whatsapp:view", async (ctx) =>
    json({
      templates: await prisma.whatsAppTemplate.findMany({
        where: { organizationId: ctx.organization.id },
        orderBy: { name: "asc" },
      }),
    }),
  );
