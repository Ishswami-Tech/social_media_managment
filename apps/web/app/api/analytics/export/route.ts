import { z } from "zod";
import { ApiError, parseQuery, withOrg } from "@/lib/api";
import { audit } from "@/lib/audit";
import { featureEnabled } from "@/lib/flags";
import { exportRows, toCsv } from "@/lib/services/analytics";

export const GET = (req: Request) =>
  withOrg(req, "analytics:view", async (ctx) => {
    if (!(await featureEnabled("analytics_export", ctx.organization.id)))
      throw new ApiError(403, "Analytics export is not enabled for this organization", "feature_disabled");
    const { days } = parseQuery(req, z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }));
    const rows = await exportRows(ctx.organization.id, new Date(Date.now() - days * 86_400_000));
    await audit(ctx, "analytics.export", "AnalyticsSnapshot", null, { days, rows: rows.length }, req);
    return new Response(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="analytics-${ctx.organization.slug}-${days}d.csv"`,
      },
    });
  });
