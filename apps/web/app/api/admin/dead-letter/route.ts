import { z } from "zod";
import { listDeadLetters, retryDeadLetter } from "@platform/queue";
import { json, parseBody, withSuperAdmin } from "@/lib/api";
import { auditPlatform } from "@/lib/audit";
import { queues } from "@/lib/queue";

export const GET = (req: Request) =>
  withSuperAdmin(req, async () => json({ items: await listDeadLetters(queues()) }));

export const POST = (req: Request) =>
  withSuperAdmin(req, async (session) => {
    const { id } = await parseBody(req, z.object({ id: z.string().min(1).max(200) }));
    const result = await retryDeadLetter(queues(), id);
    await auditPlatform(session.user.id, "admin.dead_letter.retry", "DeadLetter", id, { ...result });
    return json({ ok: true, ...result });
  });
