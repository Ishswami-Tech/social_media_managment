import { z } from "zod";
import { CONNECTOR_IDS, CONNECTOR_INFO } from "@platform/research";
import { json, parseBody, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { connectorStatus, setConnectorKey } from "@/lib/research";

export const GET = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) =>
    json({ connectors: (await connectorStatus(ctx.organization.id)).map((c) => ({ ...c, ...CONNECTOR_INFO[c.id] })) }),
  );

export const POST = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { connector, apiKey } = await parseBody(
      req,
      z.object({ connector: z.enum(CONNECTOR_IDS), apiKey: z.string().min(8).max(500) }),
    );
    const row = await setConnectorKey(ctx, connector, apiKey);
    await audit(ctx, "connector.key.set", "OrganizationConnector", row.id, { connector }, req);
    return json({ connector: row }, { status: 201 });
  });

export const DELETE = (req: Request) =>
  withOrg(req, "org:settings", async (ctx) => {
    const { connector } = await parseBody(req, z.object({ connector: z.enum(CONNECTOR_IDS) }));
    await prisma.organizationConnector.deleteMany({ where: { organizationId: ctx.organization.id, connector } });
    await audit(ctx, "connector.key.delete", "OrganizationConnector", null, { connector }, req);
    return json({ ok: true });
  });
