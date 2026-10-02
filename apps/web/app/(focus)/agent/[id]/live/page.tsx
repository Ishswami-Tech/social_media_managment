import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/session";
import { ApiError } from "@/lib/errors";
import { getRun } from "@/lib/agent/runs";
import { detailToRunInitial } from "@/lib/agent/progress";
import { resolveAuth } from "@/lib/ai";
import { providerHealthSummary } from "@/lib/agent/provider-health";
import { CouncilLive, type CouncilProvider } from "@/components/agent/council-room";

export const metadata = { title: "Council Room" };

/** Errors older than this no longer colour a provider. */
const PROVIDER_ERROR_WINDOW_MS = 30 * 60_000;

async function providers(organizationId: string): Promise<CouncilProvider[]> {
  const [{ available }, health] = await Promise.all([resolveAuth(organizationId), providerHealthSummary()]);
  const now = Date.now();
  return available.map((provider) => {
    const h = health.find((r) => r.provider === provider);
    if (h?.open) return { provider, state: "cooling", reason: h.lastError ?? undefined };
    const recent = h?.lastFailureAt ? now - Date.parse(h.lastFailureAt) < PROVIDER_ERROR_WINDOW_MS : false;
    if (recent && h?.lastError && h.failureCount > 0) return { provider, state: "failing", reason: h.lastError };
    return { provider, state: "ok" };
  });
}

/** The council at its round table: live while it works, a replay afterwards. */
export default async function CouncilLivePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCapability(["ai:generate", "content:approve"]);
  const { id } = await params;
  let run: Awaited<ReturnType<typeof getRun>>;
  try {
    run = await getRun(ctx, id);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  return (
    <CouncilLive
      runId={run.id}
      topic={run.topic}
      initial={detailToRunInitial(run)}
      canManage={ctx.can("content:create")}
      claims={run.claims.map((c) => ({ id: c.id, statement: c.statement, status: c.status, sourceTitle: c.sourceTitle, sourceUrl: c.sourceUrl }))}
      providers={await providers(ctx.organization.id).catch(() => [])}
    />
  );
}
