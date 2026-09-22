"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [loading, setLoading] = useState(false);

  async function accept() {
    setLoading(true);
    const { data, error } = await authClient.organization.acceptInvitation({ invitationId });
    setLoading(false);
    if (error) return toast.error(error.message ?? "Could not accept invitation");
    if (data?.member.organizationId)
      await authClient.organization.setActive({ organizationId: data.member.organizationId });
    toast.success("Welcome aboard");
    router.push("/home");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization invitation</CardTitle>
        <CardDescription>
          {session
            ? `Signed in as ${session.user.email}`
            : "Sign in or create an account with the invited email to continue."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {isPending ? null : session ? (
          <Button onClick={accept} disabled={loading}>
            {loading ? "Joining…" : "Accept invitation"}
          </Button>
        ) : (
          <>
            <Button onClick={() => router.push(`/login?next=/accept-invitation/${invitationId}`)}>Sign in</Button>
            <Button variant="outline" onClick={() => router.push("/register")}>
              Create account
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
