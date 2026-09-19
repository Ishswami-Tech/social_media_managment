import { NextResponse } from "next/server";
import { withOrg } from "@/lib/api";
import { startConnect } from "@/lib/services/oauth";

export const GET = (req: Request) =>
  withOrg(req, "accounts:connect", async (ctx) => {
    const redirectTo = new URL(req.url).searchParams.get("redirectTo") ?? "/accounts";
    const url = await startConnect(ctx, "META", redirectTo.startsWith("/") ? redirectTo : "/accounts");
    return NextResponse.redirect(url);
  });
