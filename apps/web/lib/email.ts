import { getEnv } from "./env";
import { logger, errorInfo } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Transactional email. Uses Resend's HTTP API when RESEND_API_KEY is set;
 * otherwise the message is logged so operators can forward it (development).
 */
export async function sendEmail(msg: EmailMessage): Promise<{ delivered: boolean }> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    logger.info("email (not delivered: RESEND_API_KEY unset)", { to: msg.to, subject: msg.subject, text: msg.text });
    return { delivered: false };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? "Social AI Platform <no-reply@example.com>",
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { delivered: true };
  } catch (e) {
    logger.error("email delivery failed", { to: msg.to, subject: msg.subject, ...errorInfo(e) });
    return { delivered: false };
  }
}
