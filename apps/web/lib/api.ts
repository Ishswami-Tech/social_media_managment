import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { TenantIsolationError } from "@platform/database";
import { ForbiddenError, type Capability } from "@platform/rbac";
import { InvalidTransitionError } from "@platform/types";
import { ProviderError } from "@platform/social-core";
import { AIError } from "@platform/ai-core";
import { logger, errorInfo } from "./logger";
import { assertCapability, getOrgContext, getSession, isSuperAdmin, type OrgContext } from "./session";
import type { Session } from "./auth";

export { ApiError, badRequest, conflict, notFound } from "./errors";
import { ApiError, badRequest } from "./errors";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError)
    return NextResponse.json(
      { error: e.code, message: e.message, details: e.details },
      { status: e.status, headers: e.headers },
    );
  if (e instanceof ZodError)
    return NextResponse.json(
      { error: "validation", message: "Invalid request", details: z.treeifyError(e) },
      { status: 400 },
    );
  if (e instanceof ForbiddenError)
    return NextResponse.json({ error: "forbidden", message: e.message, capability: e.capability }, { status: 403 });
  if (e instanceof InvalidTransitionError)
    return NextResponse.json({ error: "invalid_transition", message: e.message }, { status: 409 });
  if (e instanceof ProviderError)
    return NextResponse.json(
      { error: "provider", code: e.code, message: e.message, retryable: e.retryable },
      { status: e.retryable ? 502 : 400 },
    );
  if (e instanceof AIError)
    return NextResponse.json({ error: "ai", code: e.code, message: e.message }, { status: e.retryable ? 502 : 400 });
  if (e instanceof TenantIsolationError) {
    logger.error("tenant isolation violation", errorInfo(e));
    return NextResponse.json({ error: "internal", message: "Internal error" }, { status: 500 });
  }
  logger.error("unhandled api error", errorInfo(e));
  return NextResponse.json({ error: "internal", message: "Internal error" }, { status: 500 });
}

type Handler<C> = (ctx: C, req: Request) => Promise<Response>;

/** Route wrapper: any thrown error becomes a well-formed JSON response. */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Requires an authenticated user. */
export async function withUser(req: Request, fn: Handler<Session>): Promise<Response> {
  try {
    const session = await getSession();
    if (!session) throw new ApiError(401, "Authentication required", "unauthenticated");
    return await fn(session, req);
  } catch (e) {
    return errorResponse(e);
  }
}

/** Requires an active organization and, optionally, a capability within it. */
export async function withOrg(req: Request, capability: Capability | null, fn: Handler<OrgContext>): Promise<Response> {
  try {
    const session = await getSession();
    if (!session) throw new ApiError(401, "Authentication required", "unauthenticated");
    const ctx = await getOrgContext(session);
    if (!ctx) throw new ApiError(403, "No active organization", "no_organization");
    if (capability) assertCapability(ctx, capability);
    return await fn(ctx, req);
  } catch (e) {
    return errorResponse(e);
  }
}

/** Requires a platform Super Admin. */
export async function withSuperAdmin(req: Request, fn: Handler<Session>): Promise<Response> {
  try {
    const session = await getSession();
    if (!session) throw new ApiError(401, "Authentication required", "unauthenticated");
    if (!isSuperAdmin(session.user)) throw new ApiError(403, "Super Admin required", "forbidden");
    return await fn(session, req);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: Request, schema: z.ZodType<T>): T {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

export function requestMeta(req: Request) {
  return {
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null,
    userAgent: req.headers.get("user-agent"),
  };
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
