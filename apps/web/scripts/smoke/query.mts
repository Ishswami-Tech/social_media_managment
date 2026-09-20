import "dotenv/config";
import { prisma } from "@platform/database";
const what = process.argv[2];
if (what === "invitation") {
  const i = await prisma.invitation.findFirst({ where: { organizationId: process.env.ORG_ID! } });
  console.log(i?.id ?? "");
} else if (what === "audit") {
  const n = await prisma.auditLog.count();
  const acts = (await prisma.auditLog.findMany({ select: { action: true }, distinct: ["action"] }))
    .map((a) => a.action)
    .sort()
    .join(",");
  console.log(`${n} ${acts}`);
} else if (what === "webhooks") {
  const rows = await prisma.webhookEvent.findMany({ select: { status: true, error: true } });
  console.log(rows.map((r) => `${r.status}${r.error ? ":" + r.error : ""}`).join("|"));
}
await prisma.$disconnect();
