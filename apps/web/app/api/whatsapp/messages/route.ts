import { json, parseBody, withOrg } from "@/lib/api";
import { sendMessage, sendMessageInput } from "@/lib/services/whatsapp";

export const POST = (req: Request) =>
  withOrg(req, "whatsapp:reply", async (ctx) => {
    const input = await parseBody(req, sendMessageInput);
    return json({ message: await sendMessage(ctx, input) }, { status: 201 });
  });
