/**
 * Single-use approval links for Agent Council runs.
 *
 * A token is 32 random bytes (base64url). Only its sha256 hash is stored,
 * bound to run + organization + user + accountIds, valid for 7 days. GET
 * (`inspectToken`) never mutates; POST (`consumeToken`) marks it consumed in
 * the same statement that checks it is still unused, then applies the
 * decision with the token holder's real permissions.
 */
import { createHash, randomBytes } from "node:crypto";
import { DEFAULT_OVERRIDES, can, type OrgPermissionOverrides } from "@platform/rbac";
import { isOrgRole } from "../auth-access";
import { prisma } from "../db";
import { sendEmail } from "../email";
import { getEnv } from "../env";
import { ApiError, conflict, notFound } from "../errors";
import { logger, errorInfo } from "../logger";
import { applyAccountDecision, type DecisionActor } from "./runs";

export const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_APPROVERS_NOTIFIED = 10;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function issueApprovalToken(
  runId: string,
  userId: string,
  organizationId: string,
  accountIds: readonly string[],
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await prisma.agentApprovalToken.create({
    data: {
      runId,
      userId,
      organizationId,
      tokenHash: hashToken(raw),
      accountIds: [...accountIds],
      expiresAt: new Date(Date.now() + APPROVAL_TOKEN_TTL_MS),
    },
  });
  return raw;
}

export interface TokenInspection {
  runId: string;
  organizationId: string;
  userId: string;
  accountIds: string[];
  expired: boolean;
  consumed: boolean;
  /** ISO; when the link stops working. */
  expiresAt: string;
  /** The organization's time zone, for showing the publish time. */
  timeZone: string;
  run: {
    topic: string;
    goal: string;
    status: string;
    organizationName: string;
    /** ISO publish time once approved, when the run has one. */
    scheduledAt: string | null;
    accounts: {
      id: string;
      platform: string;
      displayName: string;
      finalText: string | null;
      finalHashtags: string[];
      mediaConcept: string | null;
      decision: string;
      /** Winning draft's blind score out of 10, when judged. */
      verdict: number | null;
      checksClear: boolean | null;
    }[];
  };
}

function winnerFacts(draft: { judgeScore: number | null; checks: unknown } | undefined): { verdict: number | null; checksClear: boolean | null } {
  const checks = draft?.checks as { ok?: unknown } | null | undefined;
  return {
    verdict: typeof draft?.judgeScore === "number" ? Math.round((draft.judgeScore / 6) * 10) / 10 : null,
    checksClear: checks && typeof checks === "object" ? checks.ok === true : null,
  };
}

/** Read-only view used by the confirmation page. Returns null for unknown tokens. */
export async function inspectToken(raw: string): Promise<TokenInspection | null> {
  if (!raw || raw.length > 128) return null;
  const token = await prisma.agentApprovalToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: {
      run: {
        select: {
          topic: true,
          goal: true,
          status: true,
          scheduledAt: true,
          organization: { select: { name: true, settings: { select: { timezone: true } } } },
          accounts: {
            select: {
              id: true,
              platform: true,
              finalText: true,
              finalHashtags: true,
              mediaConcept: true,
              decision: true,
              winnerDraftId: true,
              drafts: { select: { id: true, judgeScore: true, checks: true } },
              socialAccount: { select: { displayName: true } },
            },
          },
        },
      },
    },
  });
  if (!token) return null;
  const allowed = new Set(token.accountIds);
  return {
    runId: token.runId,
    organizationId: token.organizationId,
    userId: token.userId,
    accountIds: token.accountIds,
    expired: token.expiresAt.getTime() < Date.now(),
    consumed: token.consumedAt !== null,
    expiresAt: token.expiresAt.toISOString(),
    timeZone: token.run.organization.settings?.timezone ?? "UTC",
    run: {
      topic: token.run.topic,
      goal: token.run.goal,
      status: token.run.status,
      organizationName: token.run.organization.name,
      scheduledAt: token.run.scheduledAt?.toISOString() ?? null,
      accounts: token.run.accounts
        .filter((a) => allowed.size === 0 || allowed.has(a.id))
        .map((a) => ({
          id: a.id,
          platform: a.platform,
          displayName: a.socialAccount.displayName,
          finalText: a.finalText,
          finalHashtags: a.finalHashtags,
          mediaConcept: a.mediaConcept,
          decision: a.decision,
          ...winnerFacts(a.drafts.find((d) => d.id === a.winnerDraftId)),
        })),
    },
  };
}

async function actorForMember(organizationId: string, userId: string): Promise<DecisionActor> {
  const [member, settings, user] = await Promise.all([
    prisma.member.findUnique({ where: { organizationId_userId: { organizationId, userId } } }),
    prisma.organizationSettings.findUnique({ where: { organizationId }, select: { permissionOverrides: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  if (!member || member.status === "SUSPENDED")
    throw new ApiError(403, "You are no longer a member of this organization", "forbidden");
  return {
    userId,
    organizationId,
    role: isOrgRole(member.role) ? member.role : undefined,
    isSuperAdmin: user?.role === "admin",
    overrides: (settings?.permissionOverrides as OrgPermissionOverrides | null) ?? DEFAULT_OVERRIDES,
    impersonatedBy: null,
  };
}

/**
 * Consume the token and apply the decision. The signed-in user must be the
 * token holder; permission is evaluated from their current membership, not
 * from the moment the email was sent.
 */
export async function consumeToken(
  raw: string,
  decision: "APPROVED" | "REJECTED",
  accountIds: readonly string[],
  actorUserId: string,
  comment?: string,
) {
  const tokenHash = hashToken(raw);
  const token = await prisma.agentApprovalToken.findUnique({
    where: { tokenHash },
    include: { run: { select: { status: true } } },
  });
  if (!token) throw notFound("Approval link");
  if (token.userId !== actorUserId)
    throw new ApiError(403, "This approval link was issued to a different user", "forbidden");
  if (token.consumedAt) throw conflict("This approval link has already been used");
  if (token.expiresAt.getTime() < Date.now()) throw new ApiError(410, "This approval link has expired", "expired");
  if (token.run.status !== "AWAITING_APPROVAL") throw conflict("Campaign is no longer awaiting approval");
  const allowed = new Set(token.accountIds);
  const chosen = accountIds.length ? [...new Set(accountIds)] : token.accountIds;
  if (allowed.size > 0 && chosen.some((id) => !allowed.has(id)))
    throw new ApiError(403, "This approval link does not cover one of the selected accounts", "forbidden");
  if (chosen.length === 0) throw conflict("Nothing to decide");

  // Single use: the update only succeeds if nobody consumed it in the meantime.
  const consumed = await prisma.agentApprovalToken.updateMany({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw conflict("This approval link has already been used");

  const actor = await actorForMember(token.organizationId, actorUserId);
  return applyAccountDecision(actor, token.runId, { accountIds: chosen, decision, comment }, "email");
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

/**
 * Email every member who can approve (at most 10) a personal single-use link.
 * The worker calls this when a run enters AWAITING_APPROVAL. Never throws.
 */
export async function notifyAwaitingApproval(runId: string): Promise<{ notified: number }> {
  try {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        organization: { select: { name: true, settings: { select: { permissionOverrides: true } } } },
        accounts: { select: { id: true, platform: true, socialAccount: { select: { displayName: true } } } },
      },
    });
    if (!run || run.status !== "AWAITING_APPROVAL") return { notified: 0 };
    const members = await prisma.member.findMany({
      where: { organizationId: run.organizationId, status: "ACTIVE" },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    const overrides = (run.organization.settings?.permissionOverrides as OrgPermissionOverrides | null) ?? DEFAULT_OVERRIDES;
    const approvers = members
      .filter((m) => {
        const role = isOrgRole(m.role) ? m.role : undefined;
        if (!can({ userId: m.userId, role }, "content:approve", { overrides })) return false;
        // Creators may not approve their own run unless OWNER/ADMIN (same rule as posts).
        if (m.userId === run.createdById && role !== "OWNER" && role !== "ADMIN") return false;
        return true;
      })
      .slice(0, MAX_APPROVERS_NOTIFIED);
    const accountIds = run.accounts.map((a) => a.id);
    const baseUrl = getEnv().APP_URL.replace(/\/$/, "");
    const targets = run.accounts.map((a) => `${a.platform}: ${a.socialAccount.displayName}`).join(", ");
    let notified = 0;
    for (const m of approvers) {
      const raw = await issueApprovalToken(run.id, m.userId, run.organizationId, accountIds);
      const link = `${baseUrl}/approve/${raw}`;
      const text = [
        `Hi ${m.user.name},`,
        "",
        `A campaign in ${run.organization.name} is ready for your review.`,
        `Topic: ${run.topic}`,
        `Goal: ${run.goal}`,
        `Accounts: ${targets}`,
        "",
        `Review and approve or reject: ${link}`,
        "",
        "This link is personal, single-use and expires in 7 days. Nothing is published until you decide.",
      ].join("\n");
      const result = await sendEmail({
        to: m.user.email,
        subject: `Campaign ready for approval: ${run.topic.slice(0, 80)}`,
        text,
      });
      if (result.delivered) notified += 1;
    }
    await prisma.agentRunEvent.create({
      data: {
        runId,
        step: "notify",
        status: "SUCCEEDED",
        output: { approvers: approvers.length, delivered: notified },
      },
    });
    return { notified };
  } catch (e) {
    logger.warn("approval notification failed", { runId, ...errorInfo(e) });
    return { notified: 0 };
  }
}
