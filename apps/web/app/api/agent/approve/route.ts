import { z } from "zod";
import { json, parseBody, withUser } from "@/lib/api";
import { consumeToken } from "@/lib/agent/tokens";

const approveInput = z.object({
  token: z.string().min(16).max(128),
  decision: z.enum(["APPROVED", "REJECTED"]),
  accountIds: z.array(z.string().min(1)).max(10).default([]),
  comment: z.string().trim().max(2000).optional(),
});

/** Consumes a single-use approval link. The signed-in user must be the token holder. */
export const POST = (req: Request) =>
  withUser(req, async (session) => {
    const input = await parseBody(req, approveInput);
    const run = await consumeToken(input.token, input.decision, input.accountIds, session.user.id, input.comment);
    return json({ run: { id: run.id, status: run.status } });
  });
