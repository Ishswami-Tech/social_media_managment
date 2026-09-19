import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { logger, errorInfo } from "@/lib/logger";
import { completeConnect } from "@/lib/services/oauth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const app = getEnv().APP_URL;
  try {
    const result = await completeConnect("LINKEDIN", {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
    });
    const dest = new URL(result.redirectTo, app);
    dest.searchParams.set("connected", String(result.connected.length));
    return NextResponse.redirect(dest);
  } catch (e) {
    logger.warn("oauth callback failed", { provider: "LINKEDIN", ...errorInfo(e) });
    const dest = new URL("/accounts", app);
    dest.searchParams.set("error", (e as Error).message.slice(0, 200));
    return NextResponse.redirect(dest);
  }
}
