/**
 * Live progress for one campaign, as Server-Sent Events.
 *
 * The worker runs in another process and leaves a trail of `AgentRunEvent`
 * rows behind, so this route tails those rows: a `snapshot` on connect, then an
 * `event` message per new row and a `status` message whenever the run moves or
 * spends more, until the run settles (or fifteen minutes pass). The worker also
 * pokes a Redis channel after every write, which makes the next look at the
 * database immediate, and pushes `partial` messages with a model's text so far,
 * which are forwarded as they are. Without Redis the poll alone still works.
 *
 * Every read is scoped by `organizationId`, including the event rows, which are
 * reached through their run.
 */
import type { AgentRunStatus } from "@platform/types";
import type { ProgressAccount } from "@platform/agent-council/progress";
import { notFound, withOrg } from "@/lib/api";
import { prisma } from "@/lib/db";
import { PROGRESS_EVENT_LIMIT, progressEventSelect, toProgressAccount, toProgressEvent } from "@/lib/agent/progress";
import { liveBus, runChannel, type LiveMessage } from "@/lib/agent/live";

export const dynamic = "force-dynamic";

/** How often the database is asked for new rows. */
const POLL_MS = 1_500;
/** A comment line so proxies and browsers keep the connection open. */
const HEARTBEAT_MS = 15_000;
/** Nothing legitimate runs longer than this; the client reconnects if it does. */
const MAX_STREAM_MS = 15 * 60_000;

/** Statuses where the worker has stopped touching this run. */
const SETTLED: ReadonlySet<AgentRunStatus> = new Set<AgentRunStatus>([
  "AWAITING_APPROVAL",
  "APPROVED",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "PAUSED",
]);

interface RunState {
  status: AgentRunStatus;
  currentStep: string | null;
  spentCents: number;
  maxCents: number;
  claimCount: number;
}

async function readState(runId: string, organizationId: string): Promise<RunState | null> {
  const run = await prisma.agentRun.findFirst({
    where: { id: runId, organizationId },
    select: {
      status: true,
      currentStep: true,
      spentCents: true,
      maxCents: true,
      _count: { select: { claims: true } },
    },
  });
  if (!run) return null;
  return {
    status: run.status,
    currentStep: run.currentStep,
    spentCents: run.spentCents,
    maxCents: run.maxCents,
    claimCount: run._count.claims,
  };
}

export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withOrg(req, "ai:generate", async (ctx) => {
    const { id } = await params;
    const organizationId = ctx.organization.id;

    const state = await readState(id, organizationId);
    if (!state) throw notFound("Campaign");

    const [accountRows, recent] = await Promise.all([
      prisma.agentRunAccount.findMany({
        where: { runId: id, run: { organizationId } },
        select: {
          id: true,
          platform: true,
          decision: true,
          finalText: true,
          editedText: true,
          socialAccount: { select: { displayName: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.agentRunEvent.findMany({
        where: { runId: id, run: { organizationId } },
        select: progressEventSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PROGRESS_EVENT_LIMIT,
      }),
    ]);

    const accounts: ProgressAccount[] = accountRows.map(toProgressAccount);
    const history = [...recent].reverse();

    const encoder = new TextEncoder();
    let release: (() => void) | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const timers: {
          poll?: ReturnType<typeof setTimeout>;
          beat?: ReturnType<typeof setInterval>;
          unsubscribe?: () => Promise<void>;
        } = {};

        const stop = () => {
          if (closed) return;
          closed = true;
          if (timers.poll) clearTimeout(timers.poll);
          if (timers.beat) clearInterval(timers.beat);
          if (timers.unsubscribe) void timers.unsubscribe();
          req.signal.removeEventListener("abort", stop);
          try {
            controller.close();
          } catch {
            // The consumer already went away; nothing left to close.
          }
        };
        release = stop;

        /** Returns false once the connection is gone, so callers can bail out. */
        const write = (chunk: string): boolean => {
          if (closed) return false;
          try {
            controller.enqueue(encoder.encode(chunk));
            return true;
          } catch {
            stop();
            return false;
          }
        };
        const send = (name: string, data: unknown): boolean =>
          write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

        // Cursor over (createdAt, id): rows sharing the newest timestamp are
        // remembered by id so a second row written in the same millisecond is
        // still delivered exactly once.
        const newest = history[history.length - 1];
        let cursor: Date | null = newest?.createdAt ?? null;
        let cursorIds = new Set(
          history.filter((e) => e.createdAt.getTime() === newest?.createdAt.getTime()).map((e) => e.id),
        );
        let last: RunState = state;
        const deadline = Date.now() + MAX_STREAM_MS;

        send("snapshot", {
          status: last.status,
          currentStep: last.currentStep,
          spentCents: last.spentCents,
          maxCents: last.maxCents,
          claimCount: last.claimCount,
          accounts,
          events: history.map(toProgressEvent),
        });

        const drain = async (): Promise<boolean> => {
          const rows = await prisma.agentRunEvent.findMany({
            where: { runId: id, run: { organizationId }, ...(cursor ? { createdAt: { gte: cursor } } : {}) },
            select: progressEventSelect,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          });
          const fresh = rows.filter((r) => !cursorIds.has(r.id));
          if (fresh.length === 0) return true;
          const top = fresh[fresh.length - 1];
          if (top) {
            cursor = top.createdAt;
            cursorIds = new Set(
              rows.filter((r) => r.createdAt.getTime() === top.createdAt.getTime()).map((r) => r.id),
            );
          }
          for (const row of fresh) if (!send("event", toProgressEvent(row))) return false;
          return true;
        };

        let ticking = false;
        let again = false;
        const schedule = () => {
          if (closed) return;
          if (timers.poll) clearTimeout(timers.poll);
          timers.poll = setTimeout(() => void tick(), POLL_MS);
        };
        const tick = async (): Promise<void> => {
          if (closed) return;
          // A poke during a read means the database has more; look again right after.
          if (ticking) {
            again = true;
            return;
          }
          ticking = true;
          if (timers.poll) clearTimeout(timers.poll);
          try {
            const current = await readState(id, organizationId);
            if (!current) return stop();
            if (!(await drain())) return;
            const moved =
              current.status !== last.status ||
              current.spentCents !== last.spentCents ||
              current.currentStep !== last.currentStep;
            last = current;
            if (moved && !send("status", current)) return;
            if (SETTLED.has(current.status) || Date.now() > deadline) return stop();
          } catch {
            // A transient database problem should not kill the page; the client
            // reconnects (and falls back to polling) on its own.
            return stop();
          } finally {
            ticking = false;
          }
          if (again) {
            again = false;
            return void tick();
          }
          schedule();
        };

        if (SETTLED.has(last.status)) {
          stop();
          return;
        }

        timers.beat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
        req.signal.addEventListener("abort", stop);
        liveBus()
          .subscribe(runChannel(id), (message) => {
            const m = message as LiveMessage;
            if (m.type === "partial") send("partial", m);
            else void tick();
          })
          .then((unsubscribe) => {
            if (closed) void unsubscribe();
            else timers.unsubscribe = unsubscribe;
          })
          .catch(() => {
            // No Redis: the poll below still delivers everything, just later.
          });
        timers.poll = setTimeout(() => void tick(), POLL_MS);
      },
      cancel() {
        release?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        // Nginx and friends buffer responses by default, which defeats the point.
        "X-Accel-Buffering": "no",
      },
    });
  });
