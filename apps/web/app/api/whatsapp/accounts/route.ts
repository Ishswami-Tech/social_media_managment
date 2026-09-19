import { json, parseBody, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";
import { connectWhatsAppAccount, connectWhatsAppInput } from "@/lib/services/whatsapp";

export const GET = (req: Request) =>
  withOrg(req, "whatsapp:view", async (ctx) =>
    json({
      accounts: await prisma.whatsAppAccount.findMany({
        where: { organizationId: ctx.organization.id },
        select: {
          id: true,
          wabaId: true,
          phoneNumberId: true,
          displayPhoneNumber: true,
          verifiedName: true,
          qualityRating: true,
          status: true,
          createdAt: true,
        },
      }),
    }),
  );

export const POST = (req: Request) =>
  withOrg(req, "whatsapp:manage", async (ctx) => {
    const input = await parseBody(req, connectWhatsAppInput);
    const account = await connectWhatsAppAccount(ctx, input);
    return json(
      {
        account: { id: account.id, displayPhoneNumber: account.displayPhoneNumber, verifiedName: account.verifiedName },
      },
      { status: 201 },
    );
  });
