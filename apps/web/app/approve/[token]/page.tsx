import Link from "next/link";
import { dayLabel, initials, timeLabel } from "@/lib/utils";
import { requireUser } from "@/lib/session";
import { inspectToken } from "@/lib/agent/tokens";
import { ApprovalPage } from "@/components/forms/approval-page";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Campaign approval" };
export const dynamic = "force-dynamic";

function Message({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-8">
      <h1 className="font-display text-[24px] leading-tight font-bold tracking-[-0.02em]">{title}</h1>
      <p className="text-[15px] text-muted-foreground">{description}</p>
      <Button asChild variant="outline" className="self-start">
        <Link href="/home">Open the app</Link>
      </Button>
    </div>
  );
}

/**
 * Read-only confirmation page for an emailed approval link. Inspecting a token
 * never mutates anything; the decision is a POST from the client component.
 */
export default async function ApproveTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const session = await requireUser();
  const { token } = await params;
  const inspection = await inspectToken(token);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col bg-background sm:my-6 sm:min-h-0 sm:overflow-hidden sm:rounded-[20px] sm:border sm:border-border">
      <div className="flex items-center gap-2.5 px-5 pt-5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-foreground font-display text-[12px] font-bold text-background">
          {initials(inspection?.run.organizationName ?? "Social AI")}
        </span>
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold">{inspection?.run.organizationName ?? "Social AI"}</span>
          <span className="text-[12px] text-muted-foreground">Approval link · single use</span>
        </span>
      </div>
      {!inspection ? (
        <Message
          title="This approval link is not valid"
          description="It may have been mistyped or already removed. Open the campaign from the app instead."
        />
      ) : inspection.expired ? (
        <Message
          title="This approval link has expired"
          description="Approval links are valid for 7 days. You can still decide from the campaign page."
        />
      ) : inspection.consumed ? (
        <Message
          title="This approval link has already been used"
          description="Each link works once. Open the campaign to see the decision that was recorded."
        />
      ) : inspection.userId !== session.user.id ? (
        <Message
          title="This link was issued to someone else"
          description="Approval links are personal. Ask for your own link, or decide from the campaign page."
        />
      ) : inspection.run.status !== "AWAITING_APPROVAL" ? (
        <Message
          title="This campaign is no longer awaiting approval"
          description={`It is now ${inspection.run.status.replaceAll("_", " ").toLowerCase()}.`}
        />
      ) : (
        <ApprovalPage token={token} runId={inspection.runId} run={inspection.run} accounts={inspection.run.accounts} expiresAt={inspection.expiresAt} goesOutLabel={inspection.run.scheduledAt ? `${dayLabel(inspection.run.scheduledAt, inspection.timeZone)}, ${timeLabel(inspection.run.scheduledAt, inspection.timeZone)}` : "right after you approve"} />
      )}
    </main>
  );
}
