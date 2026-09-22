import Link from "next/link";
import { requireUser } from "@/lib/session";
import { inspectToken } from "@/lib/agent/tokens";
import { ApprovalPage } from "@/components/forms/approval-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Campaign approval" };
export const dynamic = "force-dynamic";

function Message({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/agent">Go to campaigns</Link>
        </Button>
      </CardContent>
    </Card>
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
    <main className="mx-auto grid w-full max-w-2xl gap-4 p-4 md:p-8">
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
        <ApprovalPage token={token} run={inspection.run} accounts={inspection.run.accounts} />
      )}
    </main>
  );
}
